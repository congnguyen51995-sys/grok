import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from './keyRotation.js';

let TRANSCRIBE_MODEL = 'gemini-3-flash-preview';
let LLM_MODEL        = 'gemini-3-flash-preview';
export function setAudioToVideoLLMModel(model) { if (model) { LLM_MODEL = model; TRANSCRIBE_MODEL = model; } }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SharedKeyPool — pool chung cho nhiều slot song song ────────────────────
// Mỗi key chỉ được dùng bởi 1 slot tại 1 thời điểm (inFlight).
// Key bị quota sẽ vào cooldown, slot tự động lấy key tiếp theo còn trống.
class SharedKeyPool {
  constructor(keys) {
    this._keys   = keys;
    this._inFlight = new Set();   // indices đang dùng
    this._cooldown = new Map();   // idx -> expiry ms
    this._dead     = new Set();   // indices bị invalid vĩnh viễn
  }
  // Lấy key tiếp theo không bị busy/cooldown/dead. Bắt đầu tìm từ preferFrom.
  acquire(preferFrom = 0) {
    const now = Date.now();
    for (let i = 0; i < this._keys.length; i++) {
      const idx = (preferFrom + i) % this._keys.length;
      if (this._dead.has(idx))     continue;
      if (this._inFlight.has(idx)) continue;
      const cd = this._cooldown.get(idx) || 0;
      if (now < cd)                continue;
      this._inFlight.add(idx);
      return { idx, key: this._keys[idx] };
    }
    return null; // tất cả bận
  }
  release(idx, cooldownMs = 0) {
    this._inFlight.delete(idx);
    if (cooldownMs > 0) this._cooldown.set(idx, Date.now() + cooldownMs);
  }
  markDead(idx) { this._dead.add(idx); this._inFlight.delete(idx); }
  get liveCount() { return this._keys.length - this._dead.size; }
  // Chờ cho đến khi có key free (poll mỗi 200ms, timeout 3 phút)
  async waitAcquire(preferFrom = 0, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const k = this.acquire(preferFrom);
      if (k) return k;
      await sleep(200);
    }
    throw new Error('SharedKeyPool timeout: tất cả key đều bị rate-limit quá lâu');
  }
}

// ─── Auto-retry helper ─────────────────────────────────────────────────────────
// Dùng cho lỗi tạm thời (Gemini trả rỗng, JSON lỗi, network timeout).
// KHÔNG thay thế retryWithKeyRotation — dùng bổ sung bên ngoài để vòng lặp
// key-rotation chạy lại từ đầu sau khi đã ngủ một lúc.
async function retryOnError(fn, maxAttempts = 3, baseDelayMs = 2000) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        console.warn(`[audioToVideo retry ${attempt + 1}/${maxAttempts - 1}]`, e.message);
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// ─── JSON extractor an toàn ────────────────────────────────────────────────────
// Dùng brace-counting để tìm JSON object đầu tiên hợp lệ trong chuỗi bất kỳ.
// Khắc phục 2 vấn đề của greedy regex /\{[\s\S]*\}/:
//   1. Gemini thêm text/commentary SAU JSON → greedy lấy quá dài → JSON.parse lỗi
//      "Unexpected non-whitespace character after JSON at position N"
//   2. maxOutputTokens bị đụng → JSON bị cắt giữa chừng → greedy lấy nửa chừng
function extractFirstJSON(raw) {
  if (!raw) return null;
  // Thử parse toàn bộ trước (trường hợp sạch nhất)
  try { return JSON.parse(raw); } catch {}
  // Brace-counting: dừng đúng tại } kết thúc object đầu tiên
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr  = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape)           { escape = false; continue; }
    if (ch === '\\')      { escape = true;  continue; }
    if (ch === '"')       { inStr = !inStr; continue; }
    if (inStr)            { continue; }
    if (ch === '{')         depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(raw.slice(start, i + 1)); } catch {}
        // Nếu vẫn lỗi (nội dung bên trong bị hỏng) → thử tìm object tiếp theo
        const next = raw.indexOf('{', i + 1);
        if (next === -1) return null;
        return extractFirstJSON(raw.slice(next));
      }
    }
  }
  return null; // JSON bị cắt giữa chừng (maxTokens đụng)
}

// ─── 1a. Transcribe 1 chunk với 1 key cụ thể (không tự rotate) ─────────────
async function transcribeAudioSingle(key, base64, mimeType, model) {
  const ai = new GoogleGenAI({ apiKey: key });
  let response;
  try {
    response = await ai.models.generateContent({
      model: model || TRANSCRIBE_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { data: base64, mimeType } },
        { text: `Transcribe in original spoken language (no translation). Return ONLY JSON:\n{"text":"full transcript","segments":[{"start":0.0,"end":3.5,"text":"sentence"},...]}`}
      ]}],
      config: {
        maxOutputTokens: 8192,
        ...(/gemini-2\.5/.test(model || TRANSCRIBE_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        httpOptions: { timeout: 45_000 }
      }
    });
  } catch (e) {
    const emsg = (e?.message || '').toLowerCase();
    if (e?.name === 'AbortError' || emsg.includes('timeout') || emsg.includes('timed out') ||
        emsg.includes('aborted') || e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT') {
      throw new Error(`TRANSCRIBE_TIMEOUT: ${e.message}`);
    }
    throw e;
  }
  const raw = (response?.text || '').trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/i,'').trim();
  if (!raw) throw new Error('Gemini trả về rỗng khi transcribe audio');
  const parsed = extractFirstJSON(raw);
  if (!parsed) throw new Error(`Không parse được JSON: ${raw.slice(0,200)}`);
  const segments = (parsed.segments || [])
    .map(s => ({ start: parseFloat(s.start)||0, end: parseFloat(s.end)||0, text:(s.text||'').trim() }))
    .filter(s => s.text);
  const fullText = parsed.text || segments.map(s => s.text).join(' ');
  if (segments.length === 0 && fullText) segments.push({ start:0, end:-1, text:fullText });
  return { fullText, segments };
}

// Phân loại lỗi Gemini để SharedKeyPool xử lý đúng
function classifyGeminiError(e) {
  const msg = (e?.message || '').toLowerCase();
  let raw = ''; try { raw = JSON.stringify(e).toLowerCase(); } catch { raw = msg; }
  const is429 = raw.includes('"code":429') || raw.includes('"code": 429') || msg.includes('429') ||
    raw.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate limit') ||
    msg.includes('rate_limit') || msg.includes('too many requests') || msg.includes('exceeded') ||
    msg.includes('tokens per') || msg.includes('requests per') || msg.includes('daily limit') || msg.includes('billing');
  const isDead = raw.includes('"code":403') || raw.includes('"code": 403') || raw.includes('"code":401') ||
    raw.includes('"code": 401') || msg.includes('permission_denied') || msg.includes('unauthorized') ||
    msg.includes('unauthenticated') || msg.includes('invalid api key') || msg.includes('api key not valid') ||
    msg.includes('access_token_type_unsupported') || raw.includes('access_token_type_unsupported') ||
    msg.includes('not_found') || raw.includes('"code":404') || raw.includes('"status":"not_found"');
  const isTimeout = msg.includes('transcribe_timeout');
  return { is429, isDead, isTimeout };
}

// ─── 1. Transcribe 1 chunk audio via Gemini multimodal ───────────────────────
// Timeout 90s/lần dùng config.httpOptions.timeout của SDK (@google/genai v1.x).
// SDK dùng AbortController nội bộ → hủy HTTP connection thực sự.
// Khác Promise.race (chỉ bỏ qua result chứ không cancel fetch) — đã thử và thất bại.
const TRANSCRIBE_TIMEOUT_MS = 45_000; // 45 giây mỗi attempt

export async function transcribeAudio(apiKeys, base64, mimeType, onSwitch, model = null, scriptText = null) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });

    // Nếu có kịch bản sẵn → chỉ hỏi Gemini về TIMING, text lấy từ kịch bản
    // Nếu không → transcribe thông thường
    const promptText = scriptText && scriptText.trim()
      ? `You have the exact script that was read aloud in this audio. Your ONLY task is to find accurate timestamps for each sentence — do NOT change or paraphrase the text.

EXACT SCRIPT (use this text verbatim):
"""
${scriptText.slice(0, 6000)}
"""

Listen to the audio and align each sentence/phrase to its timestamp. Split long sentences at natural pauses.
Return ONLY valid JSON — all start/end must be positive numbers in seconds:
{"segments":[{"start":0.0,"end":4.2,"text":"exact sentence from script"},...]}`
      : `Transcribe in original spoken language (no translation). Return ONLY JSON:
{"text":"full transcript","segments":[{"start":0.0,"end":3.5,"text":"sentence"},...]}`

    let response;
    try {
      response = await ai.models.generateContent({
        model: model || TRANSCRIBE_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64, mimeType } },
            { text: promptText }
          ]
        }],
        config: {
          maxOutputTokens: 8192,
          ...(/gemini-2\.5/.test(model || TRANSCRIBE_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          httpOptions: { timeout: TRANSCRIBE_TIMEOUT_MS }
        }
      });
    } catch (e) {
      const emsg = (e?.message || '').toLowerCase();
      if (
        e?.name === 'AbortError'                      ||
        emsg.includes('timeout')                      ||
        emsg.includes('timed out')                    ||
        emsg.includes('aborted')                      ||
        emsg.includes('abort')                        ||
        e?.code === 'ECONNRESET'                      ||
        e?.code === 'ETIMEDOUT'                       ||
        e?.code === 'UND_ERR_CONNECT_TIMEOUT'
      ) {
        throw new Error(`TRANSCRIBE_TIMEOUT: Gemini không phản hồi sau ${TRANSCRIBE_TIMEOUT_MS / 1000}s (${e.message})`);
      }
      throw e;
    }

    const raw = (response?.text || '').trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    if (!raw) throw new Error('Gemini trả về rỗng khi transcribe audio');

    const parsed = extractFirstJSON(raw);
    if (!parsed) throw new Error(`Không parse được JSON từ Gemini: ${raw.slice(0, 200)}`);

    let segments = (parsed.segments || [])
      .map(s => ({ start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0, text: (s.text || '').trim() }))
      .filter(s => s.text);

    // Kiểm tra segments có timestamp hợp lệ không
    const hasValidTimestamps = segments.length > 1 && segments.every(s => s.end > 0 && s.end > s.start);
    if (hasValidTimestamps) {
      const fullText = parsed.text || segments.map(s => s.text).join(' ');
      return { fullText, segments };
    }

    // Timestamps không hợp lệ → retry nội bộ tối đa 2 lần với prompt khác nhau
    const retryPrompts = [
      // Retry 1: chỉ yêu cầu timestamps, không quan tâm text
      `Listen to this audio carefully and return ONLY valid timestamps in JSON format.
Every start and end must be a POSITIVE number in seconds (not -1, not 0 for end).
{"segments":[{"start":0.0,"end":3.5,"text":"spoken sentence here"},{"start":3.5,"end":8.2,"text":"next sentence"},...]
Cover the ENTIRE audio from beginning to end. No segment should have end <= start or end = -1.`,
      // Retry 2: chia nhỏ hơn, yêu cầu mỗi 5 giây một segment
      `Transcribe this audio. Return JSON with segments every ~5 seconds.
CRITICAL: end must always be GREATER than start. No -1 values allowed.
{"segments":[{"start":0.0,"end":5.0,"text":"..."},{"start":5.0,"end":10.0,"text":"..."},...]}`
    ];

    for (let r = 0; r < retryPrompts.length; r++) {
      await sleep(1500);
      try {
        const retryResp = await ai.models.generateContent({
          model: model || TRANSCRIBE_MODEL,
          contents: [{ role: 'user', parts: [
            { inlineData: { data: base64, mimeType } },
            { text: retryPrompts[r] }
          ]}],
          config: {
            maxOutputTokens: 8192,
            ...(/gemini-2\.5/.test(model || TRANSCRIBE_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            httpOptions: { timeout: TRANSCRIBE_TIMEOUT_MS }
          }
        });
        const retryRaw = (retryResp?.text || '').trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/i,'').trim();
        const retryParsed = extractFirstJSON(retryRaw);
        if (!retryParsed) continue;
        const retrySegs = (retryParsed.segments || [])
          .map(s => ({ start: parseFloat(s.start)||0, end: parseFloat(s.end)||0, text:(s.text||'').trim() }))
          .filter(s => s.text && s.end > s.start && s.end > 0);
        if (retrySegs.length > 1) {
          // Nếu có scriptText → thay text từ script vào theo thứ tự (giữ timing thật)
          if (scriptText && scriptText.trim()) {
            const scriptSentences = scriptText.trim().split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
            retrySegs.forEach((seg, i) => {
              if (scriptSentences[i]) seg.text = scriptSentences[i];
            });
          }
          return { fullText: retrySegs.map(s => s.text).join(' '), segments: retrySegs };
        }
      } catch (_) { /* tiếp tục retry */ }
    }

    // Tất cả retry thất bại → throw để caller biết, không fake timestamp
    throw new Error('TIMESTAMP_FAILED: Gemini không tạo được timestamp hợp lệ sau 3 lần thử. Vui lòng thử lại.');
  }, apiKeys, { onSwitch, maxCycles: 2 });
}

// ─── 1b. Transcribe toàn bộ audio — dùng SharedKeyPool, tất cả key dùng chung ──
// Mỗi slot song song lấy key từ pool chung. Key nào bị quota thì cooldown 60s,
// slot tự động chờ key khác còn trống → không bao giờ 2 slot tranh cùng 1 key.
// Chunk lỗi được retry tuần tự sau khi batch hoàn tất.
export async function transcribeAudioChunked(apiKeys, totalDuration, extractChunkFn, onProgress, onChunkDone, onLog, tempoFactor = 1, model = null) {
  const CHUNK_SECS  = 60;
  const keys        = (apiKeys || []).map(k => (k || '').trim()).filter(Boolean);
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const PARALLEL    = Math.min(keys.length || 1, 8, totalChunks);

  const allSegments = [];
  let fullText = '';
  const fmt = sec => `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;

  // Pool chung cho toàn bộ session transcription
  const pool = new SharedKeyPool(keys);

  // Helper: transcribe 1 chunk với SharedKeyPool, tự động rotate khi quota
  const transcribeWithPool = async (ex) => {
    let lastKeyIdx = 0;
    let attempts   = 0;
    const MAX_ATTEMPTS = keys.length * 3; // tối đa 3 vòng qua tất cả key

    while (attempts < MAX_ATTEMPTS) {
      const ke = await pool.waitAcquire(lastKeyIdx);
      const chunkLabel = `Đoạn ${ex.idx + 1}/${totalChunks}`;
      onLog?.(`  📤 ${chunkLabel} [key${ke.idx + 1}/${keys.length}] → Gemini...`);
      let heartbeat;
      try {
        let elapsed = 0;
        heartbeat = setInterval(() => {
          elapsed += 15;
          onLog?.(`  ⏳ ${chunkLabel} [key${ke.idx + 1}]: đang xử lý... (${elapsed}s)`);
        }, 15_000);

        const r = await transcribeAudioSingle(ke.key, ex.base64, ex.mimeType, model);
        clearInterval(heartbeat);
        pool.release(ke.idx, 0); // thành công, không cooldown

        const chunkEnd  = ex.startSec + ex.durSec;
        const offsetSegs = (r.segments || []).map(s => ({
          start: parseFloat((Math.min(s.start * tempoFactor, ex.durSec) + ex.startSec).toFixed(3)),
          end:   s.end === -1 ? chunkEnd : parseFloat((Math.min(s.end * tempoFactor, ex.durSec) + ex.startSec).toFixed(3)),
          text:  s.text
        })).filter(s => s.text && s.end > s.start);
        return { offsetSegs, textChunk: r.fullText || '' };

      } catch (err) {
        clearInterval(heartbeat);
        const { is429, isDead, isTimeout } = classifyGeminiError(err);

        if (isDead) {
          onLog?.(`  ⚠️ Đoạn ${ex.idx + 1}: key${ke.idx + 1} không hợp lệ (401/403/404) — bỏ key này`);
          pool.markDead(ke.idx);
          if (pool.liveCount === 0) throw new Error('Tất cả key đều không hợp lệ');
          lastKeyIdx = ke.idx + 1;
        } else if (is429) {
          onLog?.(`  🔄 Đoạn ${ex.idx + 1}: key${ke.idx + 1} bị quota → thử key khác`);
          pool.release(ke.idx, 61_000); // cooldown 61s
          lastKeyIdx = ke.idx + 1;
        } else if (isTimeout) {
          pool.release(ke.idx, 0);
          onLog?.(`  ⏱️ Đoạn ${ex.idx + 1}: timeout, thử lại...`);
          lastKeyIdx = ke.idx;
        } else {
          pool.release(ke.idx, 0);
          throw err; // lỗi không xử lý được
        }
      }
      attempts++;
    }
    throw new Error(`Đoạn ${ex.idx + 1}: đã thử ${MAX_ATTEMPTS} lần vẫn thất bại`);
  };

  for (let i = 0; i < totalChunks; i += PARALLEL) {
    const slots = [];
    for (let p = 0; p < PARALLEL && (i + p) < totalChunks; p++) {
      const idx      = i + p;
      const startSec = idx * CHUNK_SECS;
      const durSec   = Math.min(CHUNK_SECS, totalDuration - startSec);
      slots.push({ idx, startSec, durSec });
    }

    const rangeStr = slots.length > 1
      ? `${slots[0].idx + 1}–${slots[slots.length - 1].idx + 1}`
      : `${slots[0].idx + 1}`;
    onProgress?.(`Phần ${rangeStr}/${totalChunks}: ${fmt(slots[0].startSec)}–${fmt(slots[slots.length-1].startSec + slots[slots.length-1].durSec)}`);

    // ── Extract audio song song ─────────────────────────────────────────────
    const extracted = await Promise.all(
      slots.map(slot =>
        extractChunkFn(slot.startSec, slot.durSec)
          .then(r => ({ ...slot, ...r }))
          .catch(e => ({ ...slot, success: false, error: e.message }))
      )
    );

    // ── Transcribe song song với SharedKeyPool ──────────────────────────────
    const batchMap = new Map();
    await Promise.all(
      extracted.map(ex => {
        if (ex.success === false) {
          const msg = `Lỗi extract: ${ex.error}`;
          batchMap.set(ex.idx, { err: msg });
          onChunkDone?.(ex.idx + 1, totalChunks, 0, msg);
          return Promise.resolve();
        }
        return transcribeWithPool(ex)
          .then(res => {
            batchMap.set(ex.idx, res);
            onChunkDone?.(ex.idx + 1, totalChunks, res.offsetSegs.length);
          })
          .catch(e => {
            const errMsg = e.message || String(e);
            batchMap.set(ex.idx, { err: errMsg });
            onChunkDone?.(ex.idx + 1, totalChunks, 0, errMsg);
          });
      })
    );

    // ── Gộp kết quả theo đúng thứ tự chunk ────────────────────────────────
    for (const slot of slots) {
      const res = batchMap.get(slot.idx);
      if (!res || res.err) continue;
      allSegments.push(...res.offsetSegs);
      if (res.textChunk) fullText += (fullText ? ' ' : '') + res.textChunk;
    }

    // Delay nhỏ giữa các batch
    if (i + PARALLEL < totalChunks) await sleep(300);
  }

  return { fullText, segments: allSegments };
}

// ─── Loại bỏ từ/câu lặp trong transcript (stutter TTS hoặc sub trùng timestamp) ──
// VD: "But here's the But here's the cold" → "But here's the cold"
//     "Don't miss a single one. Don't miss a single one." → "Don't miss a single one."
//     "and and avoid" → "and avoid"
function cleanDialogueText(text) {
  if (!text || typeof text !== 'string') return text;
  let s = text.replace(/\s+/g, ' ').trim();

  // Pass 1: Xóa stutter-restart — cùng N từ liên tiếp (n=7 xuống 2)
  for (let n = 7; n >= 2; n--) {
    const w    = `[\\w'’\\-]+`;
    const grp  = `(?:${w}\\s+){${n - 1}}${w}`;
    const re   = new RegExp(`(${grp})[,.]?\\s+\\1`, 'gi');
    let prev;
    do { prev = s; s = s.replace(re, '$1'); } while (s !== prev);
  }

  // Pass 2: Xóa từ đơn lặp liên tiếp (kể cả có dấu phẩy giữa)
  // "and, and" → "and"  |  "scientific, scientific" → "scientific"
  s = s.replace(/\b(\w+)[,.]?\s+\1\b/gi, '$1');

  // Pass 3: Xóa câu/mệnh đề trùng liên tiếp
  const parts   = s.split(/(?<=[.!?])\s+/);
  const norm    = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();
  const deduped = parts.filter((p, i) => i === 0 || norm(p) !== norm(parts[i - 1]));

  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── 2. Chia audio thành chunks theo timeline cố định (port từ Python) ────────
export function createTimeBasedChunks(segments, totalAudioSeconds, chunkDuration = 8) {
  const totalChunks = Math.ceil(totalAudioSeconds / chunkDuration);
  const norm = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();

  // Tiền xử lý: expand các segment quá dài (span > 30s) thành sub-segments
  // để tránh 1 segment phủ toàn bộ chunks → mọi chunk nhận full text
  const expandedSegs = [];
  for (const seg of segments) {
    const segDur = (seg.end || 0) - (seg.start || 0);
    if (segDur > 30 && seg.text && seg.text.trim()) {
      // Chia proportionally theo từ
      const words = seg.text.trim().split(/\s+/);
      const subCount = Math.ceil(segDur / chunkDuration);
      const wordsPerSub = Math.ceil(words.length / subCount);
      for (let si = 0; si < subCount; si++) {
        const subStart = seg.start + (si / subCount) * segDur;
        const subEnd   = seg.start + ((si + 1) / subCount) * segDur;
        const subWords = words.slice(si * wordsPerSub, (si + 1) * wordsPerSub);
        if (subWords.length > 0) {
          expandedSegs.push({ start: subStart, end: subEnd, text: subWords.join(' ') });
        }
      }
    } else {
      expandedSegs.push(seg);
    }
  }

  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkStart = i * chunkDuration;
    const chunkEnd   = Math.min((i + 1) * chunkDuration, totalAudioSeconds);

    const rawTexts = expandedSegs
      .filter(seg => seg.start < chunkEnd && seg.end > chunkStart)
      .map(seg => seg.text);

    const dedupTexts = rawTexts.filter((t, idx) => idx === 0 || norm(t) !== norm(rawTexts[idx - 1]));
    const joined = dedupTexts.length > 0
      ? cleanDialogueText(dedupTexts.join(' '))
      : '[Không có lời thoại - Âm thanh môi trường]';

    chunks.push({
      scene:     i + 1,
      time:      `${chunkStart}s - ${chunkEnd}s`,
      timeStart: chunkStart,
      timeEnd:   chunkEnd,
      exactText: joined,
    });
  }

  return chunks;
}

// ─── 2b. Chia audio thành chunks tự nhiên theo câu nói (5–15s mỗi chunk) ──────
// Dùng cho Stock Video mode: không ép mỗi cảnh bằng nhau,
// thay vào đó cắt tại ranh giới câu / khoảng lặng, giữ trong 5–15s.
export function createNaturalChunks(segments, totalAudioSeconds, minDur = 5, maxDur = 15) {
  const norm = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();

  const buildChunk = (sceneNum, start, end, segs) => {
    const rawTexts = segs.map(s => s.text);
    const deduped  = rawTexts.filter((t, i) => i === 0 || norm(t) !== norm(rawTexts[i - 1]));
    const joined   = deduped.length > 0
      ? cleanDialogueText(deduped.join(' '))
      : '[Không có lời thoại - Âm thanh môi trường]';
    return {
      scene:     sceneNum,
      time:      `${start.toFixed(1)}s - ${end.toFixed(1)}s`,
      timeStart: start,
      timeEnd:   end,
      exactText: joined,
    };
  };

  // Không có segments → chia cố định 8s
  if (!segments?.length) {
    const count = Math.ceil(totalAudioSeconds / 8);
    return Array.from({ length: count }, (_, i) => {
      const s = i * 8, e = Math.min((i + 1) * 8, totalAudioSeconds);
      return buildChunk(i + 1, s, e, []);
    });
  }

  const chunks = [];
  let sceneNum  = 1;
  let gStart    = 0;
  let gSegs     = [];

  for (let i = 0; i < segments.length; i++) {
    const seg     = segments[i];
    const nextSeg = segments[i + 1];
    gSegs.push(seg);

    const dur        = seg.end - gStart;
    const pause      = nextSeg ? (nextSeg.start - seg.end) : 999;
    const isSentEnd  = /[.!?।]$/.test(seg.text.trim());
    const isLast     = i === segments.length - 1;
    const goodBreak  = dur >= minDur && (isSentEnd || pause > 0.8 || isLast);
    const forceBreak = dur >= maxDur;

    if (goodBreak || forceBreak) {
      const endTime = isLast ? Math.max(seg.end, totalAudioSeconds) : seg.end;
      chunks.push(buildChunk(sceneNum++, gStart, endTime, [...gSegs]));
      gStart = nextSeg?.start ?? endTime;
      gSegs  = [];
    }
  }

  // Phần im lặng còn lại sau đoạn nói cuối
  if (gStart < totalAudioSeconds) {
    if (gSegs.length > 0) {
      chunks.push(buildChunk(sceneNum, gStart, totalAudioSeconds, gSegs));
    } else if (chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      last.timeEnd = totalAudioSeconds;
      last.time    = `${last.timeStart.toFixed(1)}s - ${totalAudioSeconds.toFixed(1)}s`;
    } else {
      chunks.push(buildChunk(1, gStart, totalAudioSeconds, []));
    }
  }

  return chunks;
}

// ─── Lấy mẫu transcript thông minh để phân tích context toàn video ───────────
// Với video dài (1-2h), transcript có thể 100k+ chars. Thay vì chỉ đọc 8000 chars đầu
// (chỉ phản ánh ~10 phút đầu), lấy mẫu phân bổ đều: intro + middle samples + outro.
function sampleTranscriptForContext(fullText, maxChars = 10000) {
  if (!fullText) return '';
  if (fullText.length <= maxChars) return fullText;

  const INTRO  = 2500; // mở đầu — thường giới thiệu chủ đề
  const OUTRO  = 1200; // kết thúc — kết luận, call-to-action
  const MIDDLE = maxChars - INTRO - OUTRO - 200; // ~6100 chars cho phần giữa

  const intro  = fullText.slice(0, INTRO);
  const outro  = fullText.slice(-OUTRO);
  const body   = fullText.slice(INTRO, fullText.length - OUTRO);

  // 6 mẫu phân bổ đều từ phần giữa (~1000 chars mỗi mẫu)
  const N = 6;
  const sampleLen = Math.floor(MIDDLE / N);
  const step = Math.floor(body.length / N);
  let mid = '';
  for (let i = 0; i < N; i++) {
    const pos = i * step;
    mid += body.slice(pos, pos + sampleLen);
    if (i < N - 1) mid += '\n[...]\n';
  }

  return `${intro}\n[...]\n${mid}\n[...]\n${outro}`;
}

// ─── 3. Phân tích tổng quát toàn bộ transcript ───────────────────────────────
export async function analyzeOverallContent(apiKeys, fullTranscript, onSwitch) {
  // Lấy mẫu thông minh — bao phủ toàn bộ video thay vì chỉ đọc phần đầu
  const sampled = sampleTranscriptForContext(fullTranscript, 12000);

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a master filmmaker and story analyst. Read this audio/video transcript as a COMPLETE STORY and build a deep cinematic profile for generating a cohesive film — not isolated clips, but connected scenes with narrative depth.
${fullTranscript.length > 10000 ? `(Note: This is a sampled excerpt — intro, evenly-spaced middle samples, and outro)\n` : ''}
TRANSCRIPT:
${sampled}

Before returning JSON, think about:
1. What is the CORE EMOTIONAL JOURNEY? (How does the audience feel from beginning to end?)
2. What STORY ARC is being told? (Setup → Conflict → Climax → Resolution or another structure)
3. What do characters MEAN by what they SAY? (Subtext, desire, fear)
4. What VISUAL MOTIFS would unify this as one film?
5. How should LIGHTING and COLOR shift across the story arc to reflect emotional changes?

Return ONLY valid JSON (no markdown, no extra text):
{
  "topic": "main topic in 1 sentence",
  "tone": "content tone (e.g. horror, thriller, motivational, documentary, romantic)",
  "key_entities": ["person/brand/place/concept appearing repeatedly"],
  "visual_themes": ["dominant visual themes to represent this content"],
  "narrative_arc": "overall narrative structure in 2-3 sentences",
  "recommended_visual_style": "cinematography and visual style recommendation",
  "context_summary": "2-3 sentence summary giving full context for scene prompt generation",
  "emotional_journey": "complete emotional arc from first scene to last (e.g. hope → dread → despair → survival)",
  "story_acts": [
    {
      "act": 1,
      "name": "Setup",
      "time_range": "0s-Xs",
      "description": "what happens in this act",
      "dominant_emotion": "e.g. tension, curiosity",
      "visual_tone": "e.g. cold blue desaturated light, or warm golden tones"
    }
  ],
  "character_descriptions": [
    {
      "role": "protagonist / narrator / antagonist / secondary",
      "visual_description": "detailed physical description for visual consistency: gender, age, clothing, hair, distinguishing features — specific enough for image generation. Use generic role descriptors, never real names.",
      "emotional_arc": "how this character changes emotionally across the story"
    }
  ],
  "narrative_beats": [
    {
      "beat_type": "inciting_incident | rising_action | midpoint | dark_moment | climax | resolution",
      "approximate_time": "e.g. 30s",
      "description": "what happens at this beat",
      "dialogue_anchor": "the exact line of dialogue that marks this beat (empty string if none)",
      "visual_suggestion": "how to visualize this beat cinematically"
    }
  ],
  "visual_motifs": [
    {
      "motif": "e.g. shadows, running, reflections",
      "meaning": "what it represents thematically",
      "how_to_show": "specific visual direction"
    }
  ],
  "character_background_sync": "ONE concise paragraph describing the protagonist's appearance AND the consistent environment/setting, written for copy-paste into every scene prompt to ensure visual continuity"
}`
        }]
      }],
      config: { maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 0 } }
    });

    const raw = (response?.text || '').trim();
    const parsed = extractFirstJSON(raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim());
    if (!parsed) throw new Error(`Không parse được JSON phân tích tổng quát: ${raw.slice(0, 200)}`);
    return parsed;
  // maxCycles: 2 — thử hết key 1 lần, chờ 15s, thử lại 1 lần nữa
  }, apiKeys, { onSwitch, maxCycles: 2 });
}

// ─── 3b. Gemini + Stock: Phân tích sâu transcript → nhân vật + scene-per-segment ─────
/**
 * Phân tích transcript bằng Gemini:
 *   Lần 1 (context): lấy topic / nhân vật / setting / style
 *   Lần 2+ (batch 60 segment): sinh imagePrompt + videoPrompt cho từng segment
 *
 * @param {string[]}  apiKeys    - Gemini API keys
 * @param {Array}     segments   - Whisper segments [{text, startTime, endTime}]
 * @param {string}    fullText   - toàn bộ lời thoại
 * @param {string}    scriptText - (tùy chọn) kịch bản có sẵn để căn chỉnh
 * @param {Function}  onSwitch
 * @returns {{ topic, tone, characters[], mainSetting, visualStyle, scenes[] }}
 */
export async function analyzeForGeminiStock(apiKeys, segments, fullText, scriptText, onSwitch) {
  const sampled = fullText.length > 6000
    ? fullText.slice(0, 3000) + '\n...\n' + fullText.slice(-1500)
    : fullText;
  const scriptBlock = scriptText?.trim()
    ? `\n\nKịch bản có sẵn (căn chỉnh cảnh theo kịch bản này):\n${scriptText.slice(0, 4000)}`
    : '';

  // ── Bước 1: context tổng quát ─────────────────────────────────────────────
  const ctx = await retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text:
        `Analyze this audio transcript for video production.

TRANSCRIPT:
${sampled}
${scriptBlock}

Return ONLY valid JSON (no markdown):
{
  "topic": "main topic in 1 sentence",
  "tone": "educational|motivational|storytelling|news|comedy|documentary",
  "characters": [
    {
      "name": "character name or Narrator",
      "description": "detailed visual: age, gender, ethnicity, clothing, hairstyle, facial features — specific enough for image generation",
      "role": "main|secondary"
    }
  ],
  "mainSetting": "primary visual setting description (e.g. modern office, dense jungle, city street at night)",
  "visualStyle": "recommended cinematography style (e.g. photorealistic, cinematic, documentary)"
}` }] }],
      config: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
    });
    const raw = (res?.text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = extractFirstJSON(raw);
    if (!parsed) throw new Error('Cannot parse context JSON: ' + raw.slice(0, 120));
    return parsed;
  }, apiKeys, { onSwitch, maxCycles: 2 });

  // ── Bước 2: scene per segment (batch 60) ──────────────────────────────────
  const MAX_PER_CALL = 60;
  const fallbackScene = {
    imagePrompt: `${ctx.mainSetting || 'cinematic scene'}, dramatic lighting, 4K professional photography`,
    videoPrompt: `Slow cinematic pan across ${ctx.mainSetting || 'the scene'}, atmospheric mood, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`
  };
  const allScenes = new Array(segments.length).fill(null);

  const ctxBlock = [
    ctx.topic   ? `Topic: ${ctx.topic}` : '',
    ctx.tone    ? `Tone: ${ctx.tone}` : '',
    ctx.mainSetting ? `Main setting: ${ctx.mainSetting}` : '',
    ctx.visualStyle ? `Style: ${ctx.visualStyle}` : '',
    (ctx.characters || []).length ? `Characters: ${ctx.characters.map(c => `${c.name} — ${c.description}`).join('; ')}` : ''
  ].filter(Boolean).join('\n');

  for (let start = 0; start < segments.length; start += MAX_PER_CALL) {
    const batch = segments.slice(start, start + MAX_PER_CALL);
    const segList = batch.map((s, idx) => {
      const t0 = typeof s.startTime === 'number' ? s.startTime.toFixed(1) : (s.start || 0);
      const t1 = typeof s.endTime   === 'number' ? s.endTime.toFixed(1)   : (s.end   || 0);
      return `${start + idx + 1}. [${t0}s-${t1}s] "${(s.text || '').slice(0, 180)}"`;
    }).join('\n');

    const scenesPrompt = `Create video scene descriptions for each dialogue segment below.

CONTEXT:
${ctxBlock}
${scriptBlock}

SEGMENTS:
${segList}

Rules:
- imagePrompt: describe the SCENE visually (subject, environment, lighting, camera angle) — 1-2 sentences in English
- videoPrompt: describe MOTION (camera movement, character action, environment dynamics) — 1-2 sentences, end with: safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot
- Match visuals to what is being SAID in that segment
- If character is mentioned/speaking → include their visual appearance (not name) in scene
- Keep SFW, no violence

Return ONLY a JSON array with exactly ${batch.length} objects:
[{"imagePrompt":"...","videoPrompt":"..."}, ...]`;

    try {
      const batchScenes = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const res = await ai.models.generateContent({
          model: LLM_MODEL,
          contents: [{ role: 'user', parts: [{ text: scenesPrompt }] }],
          config: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
        });
        const raw = (res?.text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        const m = raw.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('No JSON array in response');
        const arr = JSON.parse(m[0]);
        if (!Array.isArray(arr)) throw new Error('Not an array');
        return arr;
      }, apiKeys, { onSwitch, maxCycles: 2 });

      batchScenes.forEach((sc, idx) => { if (sc) allScenes[start + idx] = sc; });
    } catch (e) {
      console.warn('[analyzeForGeminiStock] batch scenes failed:', e.message);
    }
  }

  const scenes = allScenes.map(s => s || fallbackScene);
  return { ...ctx, scenes };
}

// ─── 3b. AI sinh từ khóa stock video từ transcript (1 lần gọi, batch tất cả chunk) ───
/**
 * Dùng Gemini để phân tích nội dung từng đoạn transcript và sinh ra
 * 2-3 từ khóa tiếng Anh có tính hình ảnh để tìm stock video phù hợp.
 *
 * @param {string[]} apiKeys - Gemini API keys
 * @param {Array}    chunks  - timeChunks array (mỗi phần tử có .exactText)
 * @param {object}   overallCtx - kết quả analyzeOverallContent (topic, visual_themes, ...)
 * @param {Function} onSwitch
 * @returns {string[]} - mảng keyword string, 1 phần tử cho mỗi chunk
 */
export async function generateStockKeywordsAI(apiKeys, chunks, overallCtx, onSwitch) {
  const contextBlock = overallCtx ? `
Content topic: ${overallCtx.topic || ''}
Tone: ${overallCtx.tone || ''}
Visual themes: ${(overallCtx.visual_themes || []).join(', ')}
Key entities: ${(overallCtx.key_entities || []).join(', ')}` : '';

  // Giới hạn 60 segment mỗi lần gọi để tránh quá token
  const MAX_PER_CALL = 60;
  const fallbackKw = (overallCtx?.topic || 'nature landscape')
    .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).slice(0, 3).join(' ') || 'nature landscape';

  const results = new Array(chunks.length).fill(fallbackKw);

  for (let start = 0; start < chunks.length; start += MAX_PER_CALL) {
    const batch = chunks.slice(start, start + MAX_PER_CALL);
    const segmentList = batch.map((ch, idx) => {
      const text = (ch.exactText || '').trim().slice(0, 200);
      return `${start + idx + 1}. "${text || '[no text]'}"`;
    }).join('\n');

    const prompt = `You are a stock video search expert. Given audio transcript segments, suggest 2-3 English keywords per segment to find relevant stock footage on Pexels/Pixabay.
${contextBlock}

Rules:
- Keywords must be in ENGLISH (translate if needed)
- Choose VISUAL concepts that represent the scene (e.g. "business meeting office", "mountain sunrise hiking", "city traffic night")
- Prefer concrete, searchable nouns over abstract words
- If segment mentions a person/action/place → use that as keyword
- If segment is unclear/short → use overall content theme

Segments:
${segmentList}

Return ONLY a JSON array with exactly ${batch.length} strings, one per segment:
["keyword1 keyword2", "keyword3 keyword4", ...]`;

    try {
      const batchResult = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: LLM_MODEL,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
        });
        const raw = (response?.text || '').trim()
          .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        // Tìm mảng JSON
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (!arrMatch) throw new Error(`Gemini không trả về JSON array: ${raw.slice(0, 200)}`);
        const arr = JSON.parse(arrMatch[0]);
        if (!Array.isArray(arr)) throw new Error('Kết quả không phải array');
        return arr;
      }, apiKeys, { onSwitch, maxCycles: 2 });

      batchResult.forEach((kw, idx) => {
        const clean = (kw || '').toString().trim().slice(0, 80);
        if (clean) results[start + idx] = clean;
      });
    } catch (e) {
      console.warn('[generateStockKeywordsAI] batch failed:', e.message);
      // giữ nguyên fallback cho batch này
    }
  }

  return results;
}

// ─── 4. Tạo Veo prompt cho 1 chunk ───────────────────────────────────────────
export async function generateVeoPrompt(apiKeys, chunk, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };

  const ctx = overallContext || {};
  const acts = ctx.story_acts || [];
  const beats = ctx.narrative_beats || [];
  const chars = ctx.character_descriptions || [];
  const motifs = ctx.visual_motifs || [];
  const _forcedStyle = ctx.recommended_visual_style || '';

  // Find story position for this chunk
  const chunkTimeSeconds = parseFloat((chunk.time || '0').split('-')[0]) || 0;
  const currentAct = acts.find(a => {
    const [s, e] = (a.time_range || '0s-9999s').replace(/s/g, '').split('-').map(Number);
    return chunkTimeSeconds >= s && chunkTimeSeconds <= (e || 9999);
  });
  const nearestBeat = beats.find(b => {
    const bt = parseFloat((b.approximate_time || '0').replace(/s/g, ''));
    return Math.abs(bt - chunkTimeSeconds) < targetDuration * 2;
  });

  const storyPositionBlock = (currentAct || nearestBeat) ? `
STORY POSITION FOR THIS SCENE:
${currentAct ? `Current Act: Act ${currentAct.act} "${currentAct.name}" | Dominant emotion: ${currentAct.dominant_emotion} | Visual tone: ${currentAct.visual_tone}` : ''}
${nearestBeat ? `Narrative beat: [${nearestBeat.beat_type.toUpperCase()}] ${nearestBeat.description}${nearestBeat.visual_suggestion ? ' | Visual: ' + nearestBeat.visual_suggestion : ''}` : ''}
` : '';

  const storyArcBlock = (acts.length || chars.length) ? `
STORY ARC CONTEXT:
Emotional journey: ${ctx.emotional_journey || ctx.narrative_arc || ''}
${chars.length ? `Characters: ${chars.map(c => `[${c.role}]: ${c.visual_description}`).join(' | ')}` : ''}
${motifs.length ? `Visual motifs: ${motifs.map(m => `${m.motif} (${m.meaning})`).join(', ')}` : ''}
` : '';

  const contextBlock = ctx.topic ? `
CONTENT CONTEXT:
- Topic: ${ctx.topic}
- Tone: ${ctx.tone || ''}
- Visual themes: ${(ctx.visual_themes || []).join(', ')}
- Summary: ${ctx.context_summary || ''}${ctx.character_background_sync ? `
- CHARACTER & BACKGROUND SYNC (CRITICAL): ${ctx.character_background_sync}` : ''}${_forcedStyle ? `
⚠️ MANDATORY VISUAL STYLE: ${_forcedStyle}` : ''}
${storyArcBlock}${storyPositionBlock}` : '';

  const systemInstruction = `You are a master filmmaker and Veo 3 prompt engineer creating ONE scene in a cohesive film.

Write ONE complete, detailed Veo_Video_Prompt for a ${targetDuration}-second scene.
${contextBlock}
━━━ CINEMATIC LAW — VISUAL-DIALOGUE ALIGNMENT ━━━
Ask: "What does this dialogue MEAN emotionally? What does the speaker truly want or fear?"
Encode THAT meaning into the visuals — not just someone talking:
• Fear/dread in words → shadows encroaching, character small in frame, cold light
• Determination/defiance → low-angle shot, harsh directional light, character dominant
• Grief/loss → empty space, desaturated palette, rain or mist, isolated character
• Revelation/twist → sudden spatial shift, jarring angle change, new environment
• Hope/turning point → lighting shifts cold to warm, character moves toward light source
• Danger/flight → handheld camera urgency, fragmented shadows, rapid movement
Show the EMOTIONAL TRUTH of the dialogue, not the literal words.

━━━ 🚫 VEO CONTENT POLICY — MANDATORY, ZERO EXCEPTIONS ━━━
Google Veo will REJECT prompts containing: graphic violence, blood, gore, weapons used violently, murder, torture, execution; adult/sexual content, nudity; hate speech, racism; drug use/manufacture; terrorism, bombs; disturbing or traumatic imagery.

⛔ PROMINENT PEOPLE RULE — ABSOLUTE BAN (causes PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED):
NEVER use the real name of ANY real person in a prompt — no celebrities, politicians, athletes, musicians, actors, business leaders, historical figures, or any named real human being.
ALWAYS replace with a generic role description:
• Speaker/narrator name (e.g. "John Smith says...") → "a speaker", "the presenter", "a narrator"
• Celebrity name (e.g. "Elon Musk", "Taylor Swift", "Cristiano Ronaldo") → "a tech entrepreneur", "a famous singer", "a world-class athlete"
• Politician (e.g. "Obama", "Trump", "Biden") → "a world leader", "a government official"
• Historical figure (e.g. "Einstein", "Gandhi", "Newton") → "a scientist", "a visionary leader"
• Any "Firstname Lastname" pattern of a real person → replace with their occupation/role
RULE: If the audio mentions a real person by name, describe ONLY their ROLE and ACTION, never their name.

CRITICAL RULE — REFRAME SENSITIVE AUDIO INTO SAFE VISUALS:
When the dialogue/narration contains sensitive, violent, or figurative language, you MUST reinterpret it as a safe, cinematic visual metaphor. Do NOT literally visualize the words — translate the EMOTION and NARRATIVE INTENT instead.

Examples of required reframing:
• "killed it / crushed it / destroyed the competition" → triumphant performer on stage, team celebrating victory, athlete crossing finish line in first place
• "going to war / battle / fight for it" → determined professionals in focused teamwork, athletes training intensely, people working with fierce dedication
• "blood, sweat and tears" → close-up of sweating hands gripping a tool, exhausted but determined face, tears of joy at achievement
• "exploding sales / bomb of a deal" → bar charts soaring upward, fireworks celebration, confetti falling on happy business team
• "cut throat competition / knifing the rival" → chess pieces being strategically moved, competitor analysis on screens, intense boardroom negotiation
• "overdose of success / high on results" → person exhilarated on mountain summit, team cheering with raised fists, euphoric celebration
• "massacre / slaughter in the market" → bold downward stock chart with dramatic lighting, newspaper headlines spinning, financial crisis montage
• "drugs / medication changed my life" → doctor in white coat with patient, pharmacy with clean clinical setting, medical breakthrough visualization
• "death / dying industry / kill the old way" → old rusty machinery being replaced by modern technology, transformation montage, phoenix rising metaphor

If content is clearly fictional/narrative (film plot, story), visualize it tastefully with implied action, not graphic detail.
Always prioritize EMOTIONAL TRUTH over literal translation of words.

━━━ REQUIRED PROMPT STRUCTURE (ALL elements must be present) ━━━
A complete Veo prompt MUST include ALL of the following in one flowing paragraph:

1. SUBJECT & ACTION — Who/what is the main subject? What are they doing? Be specific.
2. ENVIRONMENT/SETTING — Where is the scene? (indoor/outdoor, location type, background details)
3. CAMERA MOVEMENT — Exact camera technique: dolly in, slow pan left/right, aerial zoom out, tracking shot, crane shot, push-in, pull-back, orbit, handheld shake, static locked shot, etc.
4. LIGHTING — Natural/artificial, direction (front/back/side lit), quality (soft/harsh), time of day (golden hour, midday, night, neon-lit, etc.)
5. COLOR PALETTE — Dominant colors, tone (warm/cool/desaturated/vivid/cinematic)
6. VISUAL STYLE — Film look: cinematic, documentary, hyper-real, stylized, photorealistic, etc.
7. MOOD/ATMOSPHERE — Emotional quality: tense, uplifting, melancholic, epic, serene, mysterious
8. AUDIO CUES (Veo 3 native audio) — Ambient sounds, music tone, voice-over style, sound effects relevant to the scene
9. END TAG — Always close with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"

━━━ CONTENT ALIGNMENT RULES ━━━
- STRICT ALIGNMENT: Every key object, action, or number mentioned in the dialogue MUST appear visually in the prompt.
- DYNAMIC MOVEMENT: For 2+ ideas in dialogue, chain camera movements:
  "Starts with [Scene A], then camera pans to [Scene B], transitioning to [Scene C]"
  Transition keywords: "Starts with", "then camera pans", "quickly zooms to", "transitions to", "reveals", "pulls back to reveal"
- PACING FOR ${targetDuration}s: ${pacingMap[targetDuration] || pacingMap[8]}
- DATA/NUMBERS: Visualize as glowing holographic overlays, floating infographics, or on-screen text.
- NO STATIC SCENES when dialogue contains 2+ distinct ideas.

━━━ LANGUAGE RULE (ZERO TOLERANCE) ━━━
- Output MUST BE 100% IN ENGLISH — translate meaning from ANY input language.
- NO non-English words anywhere in the output.

Return ONLY the Veo_Video_Prompt string. No JSON, no numbering, no label, no explanations. Just the prompt paragraph.`;

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Scene ${chunk.scene} | Time: ${chunk.time}

DIALOGUE/NARRATION TO VISUALIZE:
"${chunk.exactText}"

Write ONE complete Veo_Video_Prompt for this ${targetDuration}-second scene.
REMINDER: Include ALL 9 required elements — Subject, Environment, Camera Movement, Lighting, Color Palette, Visual Style, Mood, Audio Cues, and end with "aspect ratio 16:9, cinematic shot".`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7
      }
    });

    const raw = (response?.text || '').trim();
    // Strip markdown code fences if Gemini wraps output
    const prompt = raw
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (!prompt) throw new Error('Gemini trả về rỗng khi tạo prompt');
    // Sanity check: prompt must end with cinematic tag (ensure it's not truncated)
    if (!prompt.toLowerCase().includes('cinematic') && prompt.length < 80)
      throw new Error('Prompt quá ngắn hoặc bị cắt — thử lại');
    return prompt;
  // maxCycles: 2 — 66 calls max (giảm từ 165), có 1 lần chờ 15s để rate-limit reset
  }, apiKeys, { onSwitch, maxCycles: 2 });
}

// ─── 5a. Tạo Veo prompt cho nhiều scene trong 1 API call ─────────────────────
// Gộp N scene → 1 request → nhận JSON array N prompts → tiết kiệm 5× số request
async function generateVeoPromptBatch(apiKeys, chunks, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };

  // Build rich cinematic context from story arc analysis
  const ctx = overallContext || {};
  const acts = ctx.story_acts || [];
  const beats = ctx.narrative_beats || [];
  const motifs = ctx.visual_motifs || [];
  const chars = ctx.character_descriptions || [];

  const storyArcBlock = (acts.length || beats.length) ? `
━━━ FILM STORY ARC (USE TO MAINTAIN NARRATIVE CONTINUITY) ━━━
EMOTIONAL JOURNEY: ${ctx.emotional_journey || ctx.narrative_arc || ''}
STORY ACTS:
${acts.map(a => `  Act ${a.act} "${a.name}" [${a.time_range}]: ${a.description} | Emotion: ${a.dominant_emotion} | Visual tone: ${a.visual_tone}`).join('\n')}
${beats.length ? `KEY NARRATIVE BEATS:
${beats.map(b => `  [${b.approximate_time}] ${b.beat_type.toUpperCase()}: ${b.description}${b.dialogue_anchor ? ` → triggered by: "${b.dialogue_anchor}"` : ''}${b.visual_suggestion ? ` | Visual: ${b.visual_suggestion}` : ''}`).join('\n')}` : ''}
${motifs.length ? `VISUAL MOTIFS (weave in naturally):
${motifs.map(m => `  • ${m.motif}: ${m.meaning} → ${m.how_to_show}`).join('\n')}` : ''}
${chars.length ? `CHARACTER VISUAL DESCRIPTIONS (use for consistency):
${chars.map(c => `  [${c.role}]: ${c.visual_description} | Arc: ${c.emotional_arc}`).join('\n')}` : ''}
` : '';

  const contextBlock = ctx.topic ? `
━━━ CONTENT CONTEXT (keep all prompts consistent) ━━━
Topic: ${ctx.topic}
Tone: ${ctx.tone || ''}
Visual themes: ${(ctx.visual_themes || []).join(', ')}
Recommended style: ${ctx.recommended_visual_style || ''}
Summary: ${ctx.context_summary || ''}${ctx.character_background_sync ? `
CHARACTER & BACKGROUND SYNC (CRITICAL — copy into EVERY scene): ${ctx.character_background_sync}` : ''}
` : '';

  const systemInstruction = `You are a master filmmaker and Veo 3 prompt engineer. Your goal is to generate a COHESIVE FILM — not disconnected clips, but scenes that flow together with narrative depth and visual continuity.
${contextBlock}${storyArcBlock}
━━━ CINEMATIC LAW — VISUAL-DIALOGUE ALIGNMENT ━━━
When a character speaks or narrates, ask: "What does this line MEAN emotionally? What does the speaker truly want or fear?"
Then encode THAT meaning into the visuals — not just show someone talking:
• Dialogue expressing fear/dread → environment mirrors it: cold light, shadows encroaching, character small in frame
• Dialogue of determination → low-angle empowering shot, harsh directional light, character dominant in frame
• Dialogue revealing a lie/secret → averted gaze, tight close-up on tension, environmental contrast (warmth vs cold)
• Dialogue of grief/loss → empty space, desaturated palette, rain or mist, character isolated
• Dialogue of revelation/twist → sudden spatial shift, jarring angle, new environment revealed
• Dialogue of hope/turning point → lighting shifts from cold to warm, character moves toward light
• Narrative moment of danger/chase → handheld urgency, fragmented environment, rapid shadows
The prompt must SHOW what the dialogue MEANS — not just describe the literal words.

━━━ SCENE CONTINUITY ━━━
Each scene's lighting, color, and character emotional state must match WHERE IT FALLS in the story arc.
If a scene is in Act 1 (Setup), visuals should feel grounded and establishing.
If a scene is in Act 2 (Conflict/Rising Action), visuals should feel tense and unstable.
If a scene is in Act 3 (Climax/Resolution), visuals should reflect the emotional peak or release.
Character appearance and environment must remain CONSISTENT across all scenes.

━━━ 🚫 VEO CONTENT POLICY — MANDATORY, ZERO EXCEPTIONS ━━━
Google Veo will REJECT prompts containing: graphic violence, blood, gore, weapons used violently, murder, torture, execution; adult/sexual content, nudity; hate speech, racism; drug use; terrorism, bombs; disturbing imagery.

⛔ PROMINENT PEOPLE RULE — ABSOLUTE BAN (causes PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED):
NEVER write the real name of ANY real person. Replace with role/occupation only.
• Any celebrity, politician, athlete, musician, actor, historical figure → use role description
• Speaker/narrator names → "a presenter", "a speaker", "the narrator"
This rule applies even if the audio names the person — describe their ROLE, never their NAME.

REFRAME SENSITIVE AUDIO INTO SAFE VISUALS:
Translate EMOTION and NARRATIVE INTENT into safe cinematic visuals:
• "killed it / crushed it" → triumphant, team celebrating, winning athlete
• "going to war / battle / fight" → determined teamwork, fierce dedication, strategic intensity
• "blood sweat and tears" → sweating hands, exhausted-but-determined face, tears of joy
• "explosion / bomb deal" → soaring charts, confetti, fireworks celebration
• "death / dying / kill (old ways)" → transformation montage, old replaced by new, rebirth
• Narrative fiction with violence → implied action, emotional close-ups, never graphic detail

━━━ EACH PROMPT MUST INCLUDE ALL 9 ELEMENTS ━━━
1. SUBJECT & ACTION — specific subject, what they are doing, emotional state shown in body language
2. ENVIRONMENT/SETTING — location, indoor/outdoor, background details matching story arc stage
3. CAMERA MOVEMENT — specific technique expressing the scene's emotion (dolly, orbit, handheld, crane, etc.)
4. LIGHTING — direction, quality, time of day — must match the act's visual tone
5. COLOR PALETTE — dominant colors reflecting current emotional beat of the story
6. VISUAL STYLE — cinematic, documentary, photorealistic, etc. (consistent across all scenes)
7. MOOD/ATMOSPHERE — emotional quality matching the narrative position
8. AUDIO CUES — ambient sounds, music tone, voice-over style matching story beat
9. END TAG — always close with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"

━━━ RULES ━━━
- STRICT CONTENT ALIGNMENT: every key object/action in dialogue MUST appear visually (safely reframed if sensitive)
- DYNAMIC MOVEMENT: chain camera movements for 2+ ideas: "Starts with X, then pans to Y, reveals Z"
- PACING: ${pacingMap[targetDuration] || pacingMap[8]}
- UNIQUE: each prompt must be visually distinct — different angle, action, composition
- LANGUAGE: 100% English output only

━━━ OUTPUT FORMAT ━━━
Return ONLY a valid JSON array with exactly ${chunks.length} strings — one prompt per scene, in order:
["<prompt for scene 1>", "<prompt for scene 2>", ...]
No markdown, no extra text outside the JSON array.`;

  // Annotate each chunk with its story act and nearest narrative beat
  const scenesText = chunks.map(c => {
    const timeSeconds = parseFloat((c.time || '0').split('-')[0]) || 0;
    const currentAct = acts.find(a => {
      const [s, e] = (a.time_range || '0s-9999s').replace(/s/g, '').split('-').map(Number);
      return timeSeconds >= s && timeSeconds <= (e || 9999);
    });
    const nearestBeat = beats.find(b => {
      const bt = parseFloat((b.approximate_time || '0').replace(/s/g, ''));
      return Math.abs(bt - timeSeconds) < targetDuration * 2;
    });
    const arcHint = [
      currentAct ? `[Act ${currentAct.act}: ${currentAct.name} | Emotion: ${currentAct.dominant_emotion} | Visual: ${currentAct.visual_tone}]` : '',
      nearestBeat ? `[Narrative beat: ${nearestBeat.beat_type} — ${nearestBeat.description}]` : '',
    ].filter(Boolean).join(' ');
    return `Scene ${c.scene} | Time: ${c.time}${arcHint ? '\n' + arcHint : ''}\nDialogue: "${c.exactText}"`;
  }).join('\n\n---\n\n');

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `${scenesText}\n\nWrite ONE complete Veo_Video_Prompt for EACH of the ${chunks.length} scenes above. Apply the CINEMATIC LAW — make each prompt show what the dialogue MEANS emotionally, not just the literal words. Maintain visual continuity across all scenes.\nReturn ONLY a JSON array of ${chunks.length} prompt strings, in order.`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: chunks.length * 500,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.65
      }
    });

    const raw = (response?.text || '').trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('Batch: không tìm thấy JSON array trong kết quả');

    const prompts = JSON.parse(arrMatch[0]);
    if (!Array.isArray(prompts) || prompts.length !== chunks.length)
      throw new Error(`Batch: nhận ${prompts?.length ?? 0} prompts thay vì ${chunks.length}`);

    return prompts.map(p =>
      String(p).replace(/^["']|["']$/g, '').trim()
    );
  }, apiKeys, { onSwitch, maxCycles: 2 });
}

// ─── Tạo fallback prompt từ dialogue khi tất cả key fail ─────────────────────
// Dùng chính text của chunk để prompt vẫn liên quan đến audio, không bị lệch cảnh
function buildFallbackPrompt(chunk) {
  const text = (chunk.exactText || '').trim();
  const isSilent = !text || text.startsWith('[Không') || text.startsWith('[No') || text.length < 5;

  if (isSilent) {
    return 'Cinematic wide establishing shot with smooth dolly movement, warm natural lighting, calm documentary visual style, peaceful ambient setting, no people, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot';
  }

  // Dùng tối đa 120 ký tự đầu của dialogue làm visual concept
  const concept = text.slice(0, 120).replace(/["""'']/g, '').trim();

  // Xác định tone từ nội dung
  const lower = concept.toLowerCase();
  const isQuestion  = lower.includes('?') || lower.match(/\b(what|why|how|when|where|who|did|do|does|is|are|was|were)\b/);
  const isExcited   = lower.includes('!') || lower.match(/\b(amazing|incredible|fantastic|great|best|love|excited|happy|yes)\b/);
  const isSerious   = lower.match(/\b(problem|issue|challenge|difficult|hard|fail|wrong|bad|crisis|important)\b/);
  const mood = isExcited ? 'uplifting cinematic' : isSerious ? 'dramatic cinematic' : isQuestion ? 'curious exploratory' : 'smooth cinematic';

  return `${mood} scene conveying the essence of: "${concept}". Medium shot with smooth camera movement, warm natural lighting, relevant symbolic or environmental imagery matching the mood and topic, clean professional framing, no text on screen, no real people or celebrities, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`;
}

// ─── 5b. Xử lý toàn bộ chunks — dynamic batch + parallel 2, fallback đơn lẻ ──
// Batch size tự động theo độ dài video:
//   ≤ 100 scenes  → batch 5  (an toàn, JSON nhỏ, ít lỗi)
//   101–300       → batch 10 (2× nhanh hơn)
//   > 300         → batch 20 (4× nhanh hơn, dùng cho video 1-2h)
// Parallel: chạy 2 batch cùng lúc → giảm thêm ~2× thời gian tổng
export async function analyzeScenes(apiKeys, chunks, targetDuration, overallContext, onSceneProgress, onSceneReady) {
  const n = chunks.length;
  const BATCH     = n > 300 ? 20 : n > 100 ? 10 : 5;
  const PARALLEL  = 2;    // 2 batch song song — tận dụng nhiều API key
  const DELAY_MS  = 600;  // delay giữa các cặp batch (ngắn hơn vì batch đã lớn hơn)

  // Chia toàn bộ chunks thành các batch group
  const batchGroups = [];
  for (let i = 0; i < n; i += BATCH) {
    batchGroups.push({ startIdx: i, chunks: chunks.slice(i, i + BATCH) });
  }

  // Mảng results giữ nguyên thứ tự — index theo scene
  const results = new Array(n);

  // Hàm xử lý 1 batch group, trả về mảng sceneData[] theo thứ tự
  const processBatchGroup = async (group) => {
    const { startIdx, chunks: batchChunks } = group;
    onSceneProgress?.(startIdx + 1, n);

    let batchPrompts = null;
    try {
      batchPrompts = await retryOnError(
        () => generateVeoPromptBatch(
          apiKeys, batchChunks, targetDuration, overallContext,
          ({ fromIdx, toIdx }) => onSceneProgress?.(startIdx + 1, n, `Key ${fromIdx + 1}→${toIdx + 1}`)
        ),
        2, 3000
      );
    } catch (batchErr) {
      console.warn('[analyzeScenes] Batch lỗi sau retry, fallback đơn lẻ:', batchErr.message);
    }

    for (let j = 0; j < batchChunks.length; j++) {
      const chunk    = batchChunks[j];
      const absIdx   = startIdx + j;
      onSceneProgress?.(absIdx + 1, n);

      if (batchPrompts && batchPrompts[j]) {
        const sceneData = {
          sceneNumber:    chunk.scene,
          timeEstimation: chunk.time,
          dialogue:       chunk.exactText,
          veoVideoPrompt: batchPrompts[j],
        };
        results[absIdx] = sceneData;
        onSceneReady?.(sceneData, false);
      } else {
        // Fallback: gọi đơn lẻ
        try {
          const veoPrompt = await retryOnError(
            () => generateVeoPrompt(
              apiKeys, chunk, targetDuration, overallContext,
              ({ fromIdx, toIdx }) => onSceneProgress?.(absIdx + 1, n, `Key ${fromIdx + 1}→${toIdx + 1}`)
            ),
            3, 2500
          );
          const sceneData = {
            sceneNumber:    chunk.scene,
            timeEstimation: chunk.time,
            dialogue:       chunk.exactText,
            veoVideoPrompt: veoPrompt,
          };
          results[absIdx] = sceneData;
          onSceneReady?.(sceneData, false);
        } catch (e) {
          // Fallback dùng dialogue text để prompt vẫn khớp với audio tại timestamp này
          const fallback = {
            sceneNumber:    chunk.scene,
            timeEstimation: chunk.time,
            dialogue:       chunk.exactText,
            veoVideoPrompt: buildFallbackPrompt(chunk),
            error:          e.message,
          };
          results[absIdx] = fallback;
          onSceneReady?.(fallback, true);
        }
      }
    }
  };

  // Chạy PARALLEL batch cùng lúc, từng nhóm PARALLEL batch
  for (let i = 0; i < batchGroups.length; i += PARALLEL) {
    const wave = batchGroups.slice(i, i + PARALLEL);
    await Promise.all(wave.map(g => processBatchGroup(g)));
    if (i + PARALLEL < batchGroups.length) await sleep(DELAY_MS);
  }

  // Lọc bỏ slot undefined (nếu có lỗi extract nào đó)
  return results.filter(Boolean);
}

// ─── 5b. analyzeScenesContinuity — Story Bible mode ─────────────────────────
// Flow:
//   Bước 0: Gemini đọc full transcript → tạo Story Bible JSON (nhân vật, bối cảnh, style)
//   Bước 1+: Mỗi scene: "Viewer đang NGHE [audio] → SHOW visual minh họa đúng nội dung đó"
//            + kế thừa Story Bible → nhân vật/bối cảnh nhất quán
export async function analyzeScenesContinuity(
  apiKeys, chunks, targetDuration, overallContext, fullText,
  onSceneProgress, onSceneReady
) {
  const n = chunks.length;
  const BATCH    = n > 150 ? 12 : n > 60 ? 10 : 6;
  const DELAY_MS = 500;

  const pacingMap = {
    5:  '5s: FAST, SHARP action. Quick cuts. High energy.',
    8:  '8s: Standard cinematic pace. Mix action and establishing shots.',
    10: '10s: SLOW, SMOOTH pan/zoom. Rich detail. Contemplative.'
  };

  // ── Bước 0: Tạo Story Bible JSON từ full transcript ────────────────────────
  const trimmedTx = (fullText || '').slice(0, 10000);
  let bible = null; // structured JSON
  let bibleText = ''; // fallback prose

  onSceneProgress?.(0, n, 'Đang tạo Story Bible...');
  try {
    const rawBible = await retryWithKeyRotation(async (key) => {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: LLM_MODEL,
        contents: [{ role: 'user', parts: [{ text: `You are a visual Story Bible creator for Google Veo 3 video generation.

Analyze this audio/video transcript and create a STRUCTURED STORY BIBLE in JSON format.
This bible will be used to generate consistent Veo video prompts for EVERY scene.

TRANSCRIPT:
${trimmedTx}

${overallContext ? `OVERALL CONTEXT: ${overallContext.topic || ''} | ${overallContext.tone || ''} | ${overallContext.context_summary || ''}` : ''}
${overallContext?.character_background_sync ? `USER CHARACTER NOTES: ${overallContext.character_background_sync}` : ''}

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "story title",
  "genre": "genre/style (e.g. documentary, drama, tutorial, storytelling)",
  "visual_style": "detailed Veo visual style: camera type, film grain, color grade, lighting style",
  "color_palette": "primary colors that define the mood throughout",
  "characters": [
    {
      "role": "safe role name for Veo (NO real names — e.g. 'the narrator', 'the hero', 'the mentor')",
      "keywords": ["name variations that appear in transcript to identify this character"],
      "visual": "detailed physical description: age, gender, appearance, clothing, distinctive features — consistent across ALL scenes"
    }
  ],
  "locations": [
    {
      "name": "location name",
      "keywords": ["words in transcript that indicate this location"],
      "visual": "detailed visual description: architecture, lighting, atmosphere, props"
    }
  ],
  "narrative_arc": {
    "opening": "visual tone for first 20% of video",
    "rising": "visual tone for middle 60%",
    "climax_resolution": "visual tone for final 20%"
  },
  "recurring_motifs": ["3-5 visual symbols/themes repeated throughout"],
  "camera_style": "preferred camera movements and shot types"
}` }] }],
        config: { maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.4 }
      });
      return (res?.text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    }, apiKeys, { maxCycles: 2 });

    const m = rawBible.match(/\{[\s\S]*\}/);
    if (m) bible = JSON.parse(m[0]);
    bibleText = rawBible;
  } catch (e) {
    console.warn('[StoryBible] Tạo JSON thất bại, dùng prose fallback:', e.message);
    bibleText = overallContext
      ? `Topic: ${overallContext.topic || ''}. Tone: ${overallContext.tone || ''}. Style: ${overallContext.recommended_visual_style || 'cinematic'}. Summary: ${overallContext.context_summary || ''}.`
      : 'Cinematic documentary style. Maintain visual consistency.';
  }

  // ── Build character lookup: keyword → visual description ──────────────────
  // Dùng khi resolve tên nhân vật trong audio transcript → visual description
  const charLookup = []; // [{keywords: [], role: '', visual: ''}]
  if (bible?.characters) {
    bible.characters.forEach(c => {
      charLookup.push({
        keywords: (c.keywords || []).map(k => k.toLowerCase()),
        role: c.role || '',
        visual: c.visual || '',
      });
    });
  }

  const resolveCharacters = (text) => {
    // Thay tên nhân vật trong transcript bằng visual description từ bible
    let resolved = text;
    charLookup.forEach(({ keywords, role, visual }) => {
      keywords.forEach(kw => {
        if (kw && resolved.toLowerCase().includes(kw)) {
          resolved = resolved.replace(new RegExp(kw, 'gi'), `${role} (${visual.slice(0, 80)})`);
        }
      });
    });
    return resolved;
  };

  const locationLookup = (bible?.locations || []).map(l => ({
    keywords: (l.keywords || []).map(k => k.toLowerCase()),
    name: l.name || '',
    visual: l.visual || '',
  }));

  const resolveLocation = (text) => {
    for (const loc of locationLookup) {
      if (loc.keywords.some(k => k && text.toLowerCase().includes(k))) {
        return loc.visual;
      }
    }
    return '';
  };

  // ── Compact bible summary cho system prompt ────────────────────────────────
  const bibleCompact = bible ? [
    `GENRE: ${bible.genre || ''}`,
    `VISUAL STYLE: ${bible.visual_style || ''}`,
    `COLOR PALETTE: ${bible.color_palette || ''}`,
    `CAMERA: ${bible.camera_style || ''}`,
    bible.characters?.length ? `CHARACTERS:\n${bible.characters.map(c => `  - ${c.role}: ${c.visual}`).join('\n')}` : '',
    bible.locations?.length  ? `LOCATIONS:\n${bible.locations.map(l => `  - ${l.name}: ${l.visual}`).join('\n')}` : '',
    bible.recurring_motifs?.length ? `MOTIFS: ${bible.recurring_motifs.join(', ')}` : '',
  ].filter(Boolean).join('\n') : bibleText;

  // ── System prompt cố định ─────────────────────────────────────────────────
  const BASE_SYSTEM = `You are an expert Voice-Synced Narrative Video Prompt Engineer for Google Veo 3.

━━━ STORY BIBLE ━━━
${bibleCompact}

━━━ VOICE-VIDEO SYNC RULE (MOST IMPORTANT) ━━━
Each scene has an AUDIO TRANSCRIPT — what the viewer is HEARING.
Your job: write a visual prompt that ILLUSTRATES exactly what is being said/narrated.
- If audio says "she walks into the forest" → show that character entering a forest
- If audio is explaining a concept → show that concept visually with metaphors
- If audio is emotional narration → show faces, environments that FEEL that emotion
- The visual must make sense WITH the audio, not just be thematically similar

━━━ CONSISTENCY RULES ━━━
- Use character descriptions from Story Bible whenever that character is in the scene
- Use location descriptions from Story Bible for settings
- Maintain visual style, color palette, camera style throughout ALL scenes
- Characters must look IDENTICAL across every scene (same clothes, age, features)

━━━ 🚫 VEO CONTENT POLICY ━━━
NEVER: graphic violence, blood, weapons, adult content, nudity, hate speech, drugs, terrorism.
⛔ PROMINENT PEOPLE: NEVER use real person names. Replace: "Elon Musk" → "a visionary tech entrepreneur".
REFRAME: "killed it" → "dominated the stage", "war" → "intense competition".

━━━ PROMPT STRUCTURE ━━━
[Character(s) doing action that matches audio] + [Setting from bible] + [Camera movement] + [Lighting] + [Color] + [Mood] + [Style]. Safe for all audiences, family-friendly.

PACING: ${pacingMap[targetDuration] || pacingMap[8]}
LANGUAGE: 100% English.`;

  // ── Build narrative position per scene ────────────────────────────────────
  const totalScenes = n;
  const getNarrativePhase = (idx) => {
    const pct = idx / totalScenes;
    if (!bible?.narrative_arc) return '';
    if (pct < 0.2) return `NARRATIVE: Opening — ${bible.narrative_arc.opening || 'Establish the world'}`;
    if (pct < 0.8) return `NARRATIVE: Rising action — ${bible.narrative_arc.rising || 'Build tension'}`;
    return `NARRATIVE: Climax/Resolution — ${bible.narrative_arc.climax_resolution || 'Resolve and conclude'}`;
  };

  // ── Batch groups ──────────────────────────────────────────────────────────
  const batchGroups = [];
  for (let i = 0; i < n; i += BATCH) {
    batchGroups.push({ startIdx: i, chunks: chunks.slice(i, i + BATCH) });
  }

  const results     = new Array(n);
  const donePrompts = [];

  const processBatch = async (group, batchIdx) => {
    const { startIdx, chunks: batchChunks } = group;
    onSceneProgress?.(startIdx + 1, n);

    // Continuity context: 4 prompt gần nhất
    const prevSnippets = donePrompts.slice(-4)
      .map((p, i) => `S${startIdx - Math.min(donePrompts.length, 4) + i + 1}: ${p.slice(0, 90)}`)
      .join('\n');
    const continuityBlock = prevSnippets
      ? `PREVIOUS SCENES (continue seamlessly):\n${prevSnippets}`
      : 'OPENING SCENES — establish the visual world from Story Bible.';

    // Build scene list with character/location resolution
    const scenesText = batchChunks.map(c => {
      const phase = getNarrativePhase(c.scene - 1);
      const locVisual = resolveLocation(c.exactText);
      return `Scene ${c.scene} [${c.time}]${phase ? ` (${phase})` : ''}:
AUDIO (what viewer HEARS): "${c.exactText}"
${locVisual ? `SETTING HINT: ${locVisual}` : ''}`;
    }).join('\n\n');

    const userMsg = `${continuityBlock}

${scenesText}

For EACH scene above:
1. READ the audio transcript carefully — understand what is being said/narrated
2. RESOLVE which Story Bible characters and locations are present
3. WRITE a Veo prompt where the VISUAL directly illustrates the audio content
4. ENSURE character appearances match Story Bible exactly

Return ONLY a JSON array of exactly ${batchChunks.length} English Veo prompt strings:
["<prompt 1>", "<prompt 2>", ...]`;

    const systemInstruction = BASE_SYSTEM;

    let batchPrompts = null;
    try {
      batchPrompts = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const res = await ai.models.generateContent({
          model: LLM_MODEL,
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          config: {
            systemInstruction,
            maxOutputTokens: batchChunks.length * 480,
            thinkingConfig: { thinkingBudget: 0 },
            temperature: 0.6
          }
        });
        const raw = (res?.text || '').trim()
          .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        const m = raw.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('Không tìm thấy JSON array');
        const arr = JSON.parse(m[0]);
        if (!Array.isArray(arr) || arr.length !== batchChunks.length)
          throw new Error(`Nhận ${arr?.length ?? 0}/${batchChunks.length} prompts`);
        return arr.map(p => String(p).replace(/^["']|["']$/g, '').trim());
      }, apiKeys, {
        onSwitch: ({ fromIdx, toIdx }) => onSceneProgress?.(startIdx + 1, n, `Key ${fromIdx + 1}→${toIdx + 1}`),
        maxCycles: 2
      });
    } catch (batchErr) {
      console.warn(`[StoryBible] Batch ${batchIdx} lỗi, fallback đơn lẻ:`, batchErr.message);
    }

    for (let j = 0; j < batchChunks.length; j++) {
      const chunk  = batchChunks[j];
      const absIdx = startIdx + j;
      onSceneProgress?.(absIdx + 1, n);

      if (batchPrompts?.[j]) {
        const sd = {
          sceneNumber: chunk.scene, timeEstimation: chunk.time,
          dialogue: chunk.exactText, veoVideoPrompt: batchPrompts[j],
        };
        results[absIdx] = sd;
        donePrompts.push(batchPrompts[j]);
        onSceneReady?.(sd, false);
      } else {
        try {
          const phase = getNarrativePhase(chunk.scene - 1);
          const locVisual = resolveLocation(chunk.exactText);
          const singleMsg = `Scene ${chunk.scene} [${chunk.time}]${phase ? ` (${phase})` : ''}:
AUDIO (what viewer HEARS): "${chunk.exactText}"
${locVisual ? `SETTING: ${locVisual}` : ''}
${prevSnippets ? `PREVIOUS: ${donePrompts.slice(-2).map(p => p.slice(0, 80)).join(' → ')}` : ''}

Write ONE Veo prompt that visually illustrates this audio. Return ONLY the prompt string.`;
          const veoPrompt = await retryWithKeyRotation(async (key) => {
            const ai = new GoogleGenAI({ apiKey: key });
            const res = await ai.models.generateContent({
              model: LLM_MODEL,
              contents: [{ role: 'user', parts: [{ text: singleMsg }] }],
              config: { systemInstruction, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.6 }
            });
            return (res?.text || '').trim().replace(/^["']|["']$/g, '');
          }, apiKeys, {
            onSwitch: ({ fromIdx, toIdx }) => onSceneProgress?.(absIdx + 1, n, `Key ${fromIdx + 1}→${toIdx + 1}`),
            maxCycles: 2
          });
          const sd = {
            sceneNumber: chunk.scene, timeEstimation: chunk.time,
            dialogue: chunk.exactText, veoVideoPrompt: veoPrompt,
          };
          results[absIdx] = sd;
          donePrompts.push(veoPrompt);
          onSceneReady?.(sd, false);
        } catch (e) {
          const fb = {
            sceneNumber: chunk.scene, timeEstimation: chunk.time,
            dialogue: chunk.exactText, veoVideoPrompt: buildFallbackPrompt(chunk), error: e.message,
          };
          results[absIdx] = fb;
          donePrompts.push(fb.veoVideoPrompt);
          onSceneReady?.(fb, true);
        }
      }
    }
  };

  for (let i = 0; i < batchGroups.length; i++) {
    await processBatch(batchGroups[i], i);
    if (i < batchGroups.length - 1) await sleep(DELAY_MS);
  }

  return results.filter(Boolean);
}

// ─── 6. Trích xuất keyword tìm kiếm stock video ──────────────────────────────
// Input: mảng chunks (có .exactText), overallContext
// Output: mảng keyword string (English, 2-3 từ, searchable trên Pexels/Pixabay)
// Batch 30 cảnh/call → 300 cảnh chỉ cần 10 API call (~10 giây)
export async function extractStockKeywords(apiKeys, chunks, overallContext, onProgress) {
  const BATCH = 30;
  const results = new Array(chunks.length);

  // Fallback keyword khi extract thất bại
  const ctxThemes = (overallContext?.visual_themes || []).filter(Boolean);
  const fallbackKw = (idx) => ctxThemes[idx % ctxThemes.length] || overallContext?.topic?.split(' ').slice(0, 3).join(' ') || 'nature landscape';

  const contextHint = overallContext
    ? `Topic: ${overallContext.topic || ''}. Visual themes: ${(overallContext.visual_themes || []).join(', ')}.`
    : '';

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);

    try {
      await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const items = batch
          .map((c, j) => `${i + j + 1}. "${(c.exactText || '').slice(0, 150)}"`)
          .join('\n');

        const response = await ai.models.generateContent({
          model: LLM_MODEL,
          contents: [{
            role: 'user',
            parts: [{
              text: `${contextHint ? `Context: ${contextHint}\n` : ''}You are helping find stock footage. For each scene, extract 2-3 English search keywords suitable for Pexels/Pixabay video search. Keywords must be concrete, visual, and searchable (e.g. "busy city street", "mountain sunrise", "scientist laboratory"). Avoid abstract words.

Scenes:
${items}

Return ONLY a JSON array of exactly ${batch.length} keyword strings:
["keyword", "keyword", ...]`
            }]
          }],
          config: { maxOutputTokens: batch.length * 20, thinkingConfig: { thinkingBudget: 0 } }
        });

        const raw = (response?.text || '').trim()
          .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)[0]);
        if (!Array.isArray(arr)) throw new Error('Không nhận được JSON array');

        for (let j = 0; j < batch.length; j++) {
          results[i + j] = (arr[j] || '').trim() || fallbackKw(i + j);
        }
      }, apiKeys, { maxCycles: 2 });
    } catch (e) {
      // Fallback đơn giản từ transcript text
      for (let j = 0; j < batch.length; j++) {
        if (!results[i + j]) {
          const words = (batch[j]?.exactText || '')
            .replace(/[^a-zA-Z\s]/g, ' ').split(/\s+/)
            .filter(w => w.length > 4).slice(0, 3).join(' ');
          results[i + j] = words || fallbackKw(i + j);
        }
      }
    }

    onProgress?.(Math.min(i + BATCH, chunks.length), chunks.length);
    if (i + BATCH < chunks.length) await sleep(400);
  }

  return results.map((kw, i) => kw || fallbackKw(i));
}

// ─── 5. Export helpers ────────────────────────────────────────────────────────
export function exportToTxt(scenes) {
  return scenes.map(s => s.veoVideoPrompt.replace(/\n+/g, ' ').trim()).join('\n');
}

export function exportToJson(scenes, meta) {
  return JSON.stringify({ ...meta, total_scenes: scenes.length, scenes }, null, 2);
}

export function exportToMarkdown(scenes, meta) {
  let md = `# Audio to Video Prompts\n\n`;
  md += `**File:** ${meta.fileName || 'N/A'}  \n`;
  md += `**Duration:** ${meta.duration || 0}s  \n`;
  md += `**Total Scenes:** ${scenes.length}  \n`;
  md += `**Scene Duration:** ${meta.sceneDuration || 8}s/scene  \n\n---\n\n`;

  for (const s of scenes) {
    md += `## Scene ${s.sceneNumber}\n\n`;
    md += `**Time:** ${s.timeEstimation}  \n`;
    md += `**Dialogue:** ${s.dialogue}  \n\n`;
    md += `**Veo Prompt:**\n\`\`\`\n${s.veoVideoPrompt}\n\`\`\`\n\n---\n\n`;
  }
  return md;
}
