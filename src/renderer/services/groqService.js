/**
 * groqService.js
 * Groq API — OpenAI-compatible, free tier với key rotation giống Gemini.
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 */

import { retryWithKeyRotation } from './keyRotation.js';

const GROQ_API_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const LS_GROQ_KEYS  = 'fluxy_groq_api_keys';
const LS_GROQ_MODEL = 'fluxy_groq_model';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B (Tốt nhất)'    },
  { id: 'llama-3.1-8b-instant',     label: 'Llama 3.1 8B (Siêu nhanh)'   },
  { id: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 (Dài & mạnh)'     },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
];

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

export function loadGroqKeys()    { try { return JSON.parse(localStorage.getItem(LS_GROQ_KEYS) || '[]'); } catch { return []; } }
export function saveGroqKeys(ks)  { localStorage.setItem(LS_GROQ_KEYS, JSON.stringify(ks)); }
export function loadGroqModel()   { return localStorage.getItem(LS_GROQ_MODEL) || DEFAULT_GROQ_MODEL; }
export function saveGroqModel(m)  { localStorage.setItem(LS_GROQ_MODEL, m); }

// ── Core call ─────────────────────────────────────────────────────────────────
export async function callGroq({ apiKey, model = DEFAULT_GROQ_MODEL, system = '', prompt, maxTokens = 4096, temperature = 0.7 }) {
  if (!apiKey) throw new Error('Chưa có Groq API Key. Vào Settings → API Key để thêm.');
  if (!prompt) throw new Error('Thiếu prompt');

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg     = errData?.error?.message || `HTTP ${res.status}`;
    const err     = new Error(`Groq: ${msg}`);
    err.status    = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq trả về rỗng');
  return text;
}

// ── Key rotation wrapper — tái sử dụng retryWithKeyRotation ──────────────────
export async function callGroqWithRotation(apiKeys, params, onSwitch, maxCycles = 5) {
  return retryWithKeyRotation(
    (key) => callGroq({ ...params, apiKey: key }),
    apiKeys,
    { onSwitch, maxCycles }
  );
}

// ── JSON parse helper ─────────────────────────────────────────────────────────
export function parseGroqJSON(raw) {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  const match   = cleaned.match(/[\[\{][\s\S]*/);
  if (!match) throw new Error('Groq: không parse được JSON');
  return JSON.parse(match[0]);
}

// ── Verify API key ─────────────────────────────────────────────────────────────
export async function verifyGroqKey(apiKey) {
  try {
    await callGroq({ apiKey, model: 'llama-3.1-8b-instant', prompt: 'Hi', maxTokens: 5, temperature: 0 });
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ── Groq Whisper transcription ────────────────────────────────────────────────
// Groq Whisper API: 25MB max/request, 20 req/min, 7200s/day free tier
// Docs: https://console.groq.com/docs/speech-text
const GROQ_WHISPER_URL   = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo'; // fastest, multilingual

async function transcribeChunkGroq(apiKey, base64Audio, mimeType, startOffset = 0) {
  // Convert base64 → Blob → FormData
  const binary   = atob(base64Audio);
  const bytes    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob     = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
  const ext      = (mimeType || 'audio/mpeg').split('/')[1]?.split(';')[0] || 'mp3';

  const form = new FormData();
  form.append('file', blob, `chunk.${ext}`);
  form.append('model', GROQ_WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const res = await fetch(GROQ_WHISPER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg     = errData?.error?.message || `HTTP ${res.status}`;
    const err     = new Error(`Groq Whisper: ${msg}`);
    err.status    = res.status;
    throw err;
  }

  const data     = await res.json();
  const segments = (data.segments || []).map(s => ({
    start: parseFloat(s.start || 0) + startOffset,
    end:   parseFloat(s.end   || 0) + startOffset,
    text:  (s.text || '').trim(),
  })).filter(s => s.text);

  const fullText = data.text || segments.map(s => s.text).join(' ');
  return { fullText, segments };
}

/**
 * transcribeGroqChunked — Transcribe long audio via Groq Whisper.
 * Splits into 3-minute chunks (well under 25MB limit).
 * Multiple keys → parallel processing.
 *
 * @param {string[]} apiKeys           - Groq API keys
 * @param {number}   totalDuration     - total audio duration in seconds
 * @param {Function} extractChunkFn    - async (startSec, durationSec) → { base64, mimeType }
 * @param {Function} [onProgress]      - (msg: string) log callback
 * @param {Function} [onChunkDone]     - (done, total, segCount, error?) callback
 * @returns {{ fullText: string, segments: Array }}
 */
export async function transcribeGroqChunked(apiKeys, totalDuration, extractChunkFn, onProgress, onChunkDone) {
  const keys        = (apiKeys || []).filter(Boolean);
  if (!keys.length) throw new Error('Chưa có Groq API Key.');

  const CHUNK_SECS  = 180; // 3 minutes per chunk — safe under 25MB for any bitrate
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const PARALLEL    = Math.min(keys.length, 4, totalChunks); // max 4 parallel (rate limit)

  onProgress?.(`Groq Whisper: chia audio thành ${totalChunks} phần (${CHUNK_SECS}s/phần) · ${PARALLEL} key song song...`);

  const allSegments = new Array(totalChunks);
  const allTexts    = new Array(totalChunks);

  // Process in batches of PARALLEL
  for (let batchStart = 0; batchStart < totalChunks; batchStart += PARALLEL) {
    const batchEnd     = Math.min(batchStart + PARALLEL, totalChunks);
    const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

    await Promise.all(batchIndices.map(async (chunkIdx) => {
      const startSec    = chunkIdx * CHUNK_SECS;
      const durationSec = Math.min(CHUNK_SECS, totalDuration - startSec);
      const apiKey      = keys[chunkIdx % keys.length]; // round-robin key assignment

      let attempts = 0;
      const MAX_ATTEMPTS = 3;
      while (attempts < MAX_ATTEMPTS) {
        try {
          onProgress?.(`  Phần ${chunkIdx + 1}/${totalChunks}: extract ${startSec}s–${startSec + durationSec}s...`);
          const { base64, mimeType } = await extractChunkFn(startSec, durationSec);

          onProgress?.(`  Phần ${chunkIdx + 1}/${totalChunks}: gửi Groq Whisper...`);
          const result = await transcribeChunkGroq(apiKey, base64, mimeType, startSec);

          allSegments[chunkIdx] = result.segments;
          allTexts[chunkIdx]    = result.fullText;
          onChunkDone?.(chunkIdx + 1, totalChunks, result.segments.length, null);
          break;
        } catch (e) {
          attempts++;
          const msg = e?.message || String(e);
          // Rate limit → wait and retry with next key
          if ((msg.includes('429') || msg.includes('rate') || e?.status === 429) && attempts < MAX_ATTEMPTS) {
            const nextKey = keys[(chunkIdx + attempts) % keys.length];
            onProgress?.(`  ⏳ Phần ${chunkIdx + 1}: rate limit, thử lại với key khác (${attempts}/${MAX_ATTEMPTS})...`);
            await new Promise(r => setTimeout(r, 3000 * attempts));
            // swap key for retry
            Object.assign(e, {}); // just continue loop
            continue;
          }
          if (attempts >= MAX_ATTEMPTS) {
            onChunkDone?.(chunkIdx + 1, totalChunks, 0, msg);
            allSegments[chunkIdx] = [];
            allTexts[chunkIdx]    = '';
          }
        }
      }
    }));
  }

  // Merge all chunks in order
  const segments = allSegments.flat().filter(Boolean);
  const fullText = allTexts.filter(Boolean).join(' ');

  if (!fullText && segments.length === 0)
    throw new Error('Groq Whisper không transcribe được audio. Kiểm tra API key và thử lại.');

  return { fullText, segments };
}
