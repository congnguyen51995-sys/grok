import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from './keyRotation.js';

const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
const LLM_MODEL        = 'gemini-2.5-flash';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// ─── 1. Transcribe 1 chunk audio via Gemini multimodal ───────────────────────
// Timeout 90s/lần dùng config.httpOptions.timeout của SDK (@google/genai v1.x).
// SDK dùng AbortController nội bộ → hủy HTTP connection thực sự.
// Khác Promise.race (chỉ bỏ qua result chứ không cancel fetch) — đã thử và thất bại.
const TRANSCRIBE_TIMEOUT_MS = 90_000; // 90 giây mỗi attempt

export async function transcribeAudio(apiKeys, base64, mimeType, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });

    let response;
    try {
      response = await ai.models.generateContent({
        model: TRANSCRIBE_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64, mimeType } },
            {
              text: `Transcribe in original spoken language (no translation). Return ONLY JSON:
{"text":"full transcript","segments":[{"start":0.0,"end":3.5,"text":"sentence"},...]}`
            }
          ]
        }],
        config: {
          maxOutputTokens: 8192, // tăng từ 3000 → tránh JSON bị cắt giữa chừng với audio dài
          thinkingConfig: { thinkingBudget: 0 }, // tắt thinking → tiết kiệm token, nhanh hơn
          // SDK-level timeout: hủy HTTP request sau 90s nếu Gemini không phản hồi
          httpOptions: { timeout: TRANSCRIBE_TIMEOUT_MS }
        }
      });
    } catch (e) {
      // Chuẩn hóa mọi dạng timeout / abort → TRANSCRIBE_TIMEOUT
      // để retryOnError (outer) xử lý retry thay vì keyRotation
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

    // Dùng brace-counting thay vì greedy regex:
    // Greedy /\{[\s\S]*\}/ lấy tới dấu } CUỐI CÙNG → fail khi Gemini thêm text sau JSON
    // Brace-counting dừng đúng tại } kết thúc object đầu tiên hợp lệ
    const parsed = extractFirstJSON(raw);
    if (!parsed) throw new Error(`Không parse được JSON từ Gemini: ${raw.slice(0, 200)}`);
    const segments = (parsed.segments || [])
      .map(s => ({ start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0, text: (s.text || '').trim() }))
      .filter(s => s.text);

    const fullText = parsed.text || segments.map(s => s.text).join(' ');
    if (segments.length === 0 && fullText) {
      segments.push({ start: 0, end: -1, text: fullText });
    }
    return { fullText, segments };
  // maxCycles: 2 — transcription quan trọng, cho phép 2 vòng
  // TRANSCRIBE_TIMEOUT là "lỗi khác" → keyRotation throw ngay, retryOnError xử lý retry.
  }, apiKeys, { onSwitch, maxCycles: 2 });
}

// ─── 1b. Transcribe toàn bộ audio — chunk 90s, xử lý tuần tự (PARALLEL = 1) ──
// PARALLEL = 1 để tránh double-hit cùng API key khi nhiều key từ cùng 1 project.
// Nếu PARALLEL = 2, cả 2 chunk đều thử key[0] đồng thời → quota cạn 2× nhanh hơn.
// onLog(msg) — live log từng bước nhỏ (extract xong, heartbeat, retry, kết quả từng chunk)
export async function transcribeAudioChunked(apiKeys, totalDuration, extractChunkFn, onProgress, onChunkDone, onLog) {
  const CHUNK_SECS  = 90;
  const keys        = (apiKeys || []).map(k => (k || '').trim()).filter(Boolean);
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);

  // PARALLEL = số key có sẵn, tối đa 8.
  // Mỗi chunk được giao 1 key riêng (xoay vòng theo idx) → không đụng nhau.
  // 1 key → tuần tự; 6 key → 6 chunk song song cùng lúc → nhanh 6×.
  const PARALLEL = Math.min(keys.length || 1, 8, totalChunks);

  const allSegments = [];
  let fullText = '';

  const fmt = sec => `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;

  for (let i = 0; i < totalChunks; i += PARALLEL) {
    // ── Tập hợp slots trong batch này ─────────────────────────────────────────
    const slots = [];
    for (let p = 0; p < PARALLEL && (i + p) < totalChunks; p++) {
      const idx      = i + p;
      const startSec = idx * CHUNK_SECS;
      const durSec   = Math.min(CHUNK_SECS, totalDuration - startSec);
      // Mỗi chunk bắt đầu từ key khác nhau — tránh nhiều chunk cùng dùng key[0]
      const keyStart = keys.length > 1 ? idx % keys.length : 0;
      slots.push({ idx, startSec, durSec, keyStart });
    }

    const rangeStr = slots.length > 1
      ? `${slots[0].idx + 1}–${slots[slots.length - 1].idx + 1}`
      : `${slots[0].idx + 1}`;
    onProgress?.(`Phần ${rangeStr}/${totalChunks}: ${fmt(slots[0].startSec)}–${fmt(slots[slots.length-1].startSec + slots[slots.length-1].durSec)}`);

    // ── Extract audio song song ────────────────────────────────────────────────
    const extracted = await Promise.all(
      slots.map(slot =>
        extractChunkFn(slot.startSec, slot.durSec)
          .then(r => {
            if (r?.success !== false) {
              onLog?.(`  📤 Đoạn ${slot.idx + 1}/${totalChunks} (${Math.round(slot.durSec)}s) [key${slot.keyStart + 1}] → Gemini...`);
            }
            return { ...slot, ...r };
          })
          .catch(e => ({ ...slot, success: false, error: e.message }))
      )
    );

    // ── Transcribe song song — mỗi chunk dùng key riêng ──────────────────────
    // Dùng Map để giữ thứ tự khi gộp segment (chunk nhanh hơn có thể về trước)
    const batchMap = new Map(); // idx → { offsetSegs, textChunk } | { err }

    await Promise.all(
      extracted.map(ex => {
        if (!ex.success) {
          const msg = `Lỗi extract: ${ex.error}`;
          batchMap.set(ex.idx, { err: msg });
          onChunkDone?.(ex.idx + 1, totalChunks, 0, msg);
          return Promise.resolve();
        }

        // Xoay keys để chunk này bắt đầu từ key của nó, fallback sang key tiếp theo
        const rotatedKeys = keys.length > 1
          ? [...keys.slice(ex.keyStart), ...keys.slice(0, ex.keyStart)]
          : keys;

        // Heartbeat mỗi 15s — cho thấy đang chờ Gemini phản hồi
        let elapsed = 0;
        const heartbeat = setInterval(() => {
          elapsed += 15;
          onLog?.(`  ⏳ Đoạn ${ex.idx + 1}/${totalChunks}: Gemini đang xử lý... (${elapsed}s)`);
        }, 15_000);

        // retryOnError: 2 lần (1 retry) — tổng tối đa 2×90s rồi bỏ chunk
        return retryOnError(
          () => transcribeAudio(rotatedKeys, ex.base64, ex.mimeType, null),
          2, 3000
        )
        .then(r => {
          clearInterval(heartbeat);

          // Tính offset segment về timeline gốc
          const chunkEnd = ex.startSec + ex.durSec;
          const offsetSegs = (r.segments || []).map(s => ({
            start: parseFloat((Math.min(s.start, ex.durSec) + ex.startSec).toFixed(3)),
            end:   s.end === -1 ? chunkEnd
                                : parseFloat((Math.min(s.end, ex.durSec) + ex.startSec).toFixed(3)),
            text:  s.text
          })).filter(s => s.text && s.end > s.start);

          batchMap.set(ex.idx, { offsetSegs, textChunk: r.fullText || '' });
          onChunkDone?.(ex.idx + 1, totalChunks, offsetSegs.length);
        })
        .catch(e => {
          clearInterval(heartbeat);
          const errMsg = e.message.includes('TRANSCRIBE_TIMEOUT')
            ? `Timeout — Gemini không phản hồi sau 90s, bỏ qua đoạn này`
            : e.message;
          batchMap.set(ex.idx, { err: errMsg });
          onChunkDone?.(ex.idx + 1, totalChunks, 0, errMsg);
        });
      })
    );

    // ── Gộp kết quả theo đúng thứ tự chunk ───────────────────────────────────
    for (const slot of slots) {
      const res = batchMap.get(slot.idx);
      if (!res || res.err) continue;
      allSegments.push(...res.offsetSegs);
      if (res.textChunk) fullText += (fullText ? ' ' : '') + res.textChunk;
    }

    // Delay nhỏ giữa các batch để tránh RPM spike
    if (i + PARALLEL < totalChunks) await sleep(500);
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
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunkStart = i * chunkDuration;
    const chunkEnd   = Math.min((i + 1) * chunkDuration, totalAudioSeconds);

    const rawTexts = segments
      .filter(seg => seg.start < chunkEnd && seg.end > chunkStart)
      .map(seg => seg.text);

    // Bước 1: Loại bỏ subtitle trùng liên tiếp (cùng text, khác timestamp)
    // VD: sub#40 "Don't miss a single one." và sub#41 "Don't miss a single one." → giữ 1
    const norm       = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();
    const dedupTexts = rawTexts.filter((t, idx) => idx === 0 || norm(t) !== norm(rawTexts[idx - 1]));

    // Bước 2: Làm sạch stutter/lặp trong text đã ghép
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
  const sampled = sampleTranscriptForContext(fullTranscript, 10000);

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Analyze this audio/video transcript to build a comprehensive content profile for video prompt generation.
${fullTranscript.length > 10000 ? `(Note: This is a sampled excerpt from a long video — intro, 6 evenly-spaced middle samples, and outro)\n` : ''}
TRANSCRIPT:
${sampled}

Return ONLY valid JSON (no markdown):
{
  "topic": "main topic in 1 sentence",
  "tone": "content tone (e.g. educational, motivational, storytelling, news, documentary)",
  "key_entities": ["person/brand/place/concept that appear repeatedly"],
  "visual_themes": ["dominant visual themes to represent this content"],
  "narrative_arc": "overall narrative structure description",
  "recommended_visual_style": "cinematography and visual style recommendation",
  "context_summary": "2-3 sentence summary giving full context for each scene prompt generation"
}`
        }]
      }],
      config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } }
    });

    const raw = (response?.text || '').trim();
    const parsed = extractFirstJSON(raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim());
    if (!parsed) throw new Error(`Không parse được JSON phân tích tổng quát: ${raw.slice(0, 200)}`);
    return parsed;
  // maxCycles: 1 — overall analysis: thử mỗi key 1 lần, fail fast để không đốt quota
  }, apiKeys, { onSwitch, maxCycles: 1 });
}

// ─── 4. Tạo Veo prompt cho 1 chunk ───────────────────────────────────────────
export async function generateVeoPrompt(apiKeys, chunk, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };

  const contextBlock = overallContext ? `
CONTENT CONTEXT (use this to keep prompts consistent and accurate):
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Visual themes: ${(overallContext.visual_themes || []).join(', ')}
- Recommended style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}
` : '';

  const systemInstruction = `You are an expert Video Prompt Engineer for Google Veo 3 video generation.

Write ONE complete, detailed Veo_Video_Prompt for a ${targetDuration}-second scene.
${contextBlock}
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
  // maxCycles: 1 — prompt gen: thử mỗi key 1 lần, skip nếu tất cả fail (không đốt quota)
  }, apiKeys, { onSwitch, maxCycles: 1 });
}

// ─── 5a. Tạo Veo prompt cho nhiều scene trong 1 API call ─────────────────────
// Gộp N scene → 1 request → nhận JSON array N prompts → tiết kiệm 5× số request
async function generateVeoPromptBatch(apiKeys, chunks, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };
  const contextBlock = overallContext ? `
CONTENT CONTEXT (keep all prompts consistent with this):
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Visual themes: ${(overallContext.visual_themes || []).join(', ')}
- Recommended style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}
` : '';

  const systemInstruction = `You are an expert Video Prompt Engineer for Google Veo 3 video generation.
${contextBlock}
For each scene provided, write ONE complete Veo_Video_Prompt for a ${targetDuration}-second clip.

━━━ 🚫 VEO CONTENT POLICY — MANDATORY, ZERO EXCEPTIONS ━━━
Google Veo will REJECT prompts containing: graphic violence, blood, gore, weapons used violently, murder, torture, execution; adult/sexual content, nudity; hate speech, racism; drug use; terrorism, bombs; disturbing imagery.

⛔ PROMINENT PEOPLE RULE — ABSOLUTE BAN (causes PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED):
NEVER write the real name of ANY real person. Replace with their role/occupation:
• Any celebrity, politician, athlete, musician, actor, business leader, historical figure → use role only
• Examples: "Elon Musk" → "a tech entrepreneur" | "Obama" → "a world leader" | "Taylor Swift" → "a famous singer" | "Ronaldo" → "a world-class athlete" | "Einstein" → "a scientist" | "Sơn Tùng" → "a popular singer"
• Speaker/narrator names in audio → "a presenter", "a speaker", "the narrator"
• ANY "Firstname Lastname" of a real person → replace with occupation/role description
This rule applies even if the audio explicitly names the person — describe their ROLE, never their NAME.

CRITICAL RULE — REFRAME SENSITIVE AUDIO INTO SAFE VISUALS:
When dialogue/narration contains sensitive or figurative language, translate the EMOTION and NARRATIVE INTENT into a safe visual — do NOT literally visualize violent/sensitive words.

Reframing examples (APPLY TO ALL SCENES):
• "killed it / crushed it" → triumphant performer, team celebrating, athlete winning
• "going to war / battle / fight" → determined teamwork, intense training, fierce dedication
• "blood sweat and tears" → sweating hands on work, exhausted-but-determined face, tears of joy
• "explosion of sales / bomb deal" → soaring bar charts, confetti celebration, fireworks over city
• "cut throat / knife the competition" → chess strategy, intense negotiation, competitor analysis
• "overdose of success / high on results" → mountain summit elation, team cheering, euphoric celebration
• "massacre / slaughter (market/results)" → dramatic stock charts, newspaper montage, financial transformation
• "drugs / medication" → doctor with patient, pharmacy, medical breakthrough, healthcare setting
• "death / dying / kill (old ways)" → old technology replaced by new, transformation montage, rebirth imagery
• "war / military / soldiers (business context)" → strategic boardroom, mission briefing, business team deployment
If content is narrative fiction, visualize tastefully with implied action and emotional close-ups — never graphic detail.

━━━ EACH PROMPT MUST INCLUDE ALL 9 ELEMENTS ━━━
1. SUBJECT & ACTION — specific subject and what they are doing
2. ENVIRONMENT/SETTING — location, indoor/outdoor, background details
3. CAMERA MOVEMENT — dolly in/out, pan, orbit, tracking, crane, aerial, handheld, etc.
4. LIGHTING — direction, quality, time of day, artificial/natural
5. COLOR PALETTE — dominant colors and overall tone
6. VISUAL STYLE — cinematic, documentary, photorealistic, hyper-real, etc.
7. MOOD/ATMOSPHERE — emotional quality of the scene
8. AUDIO CUES — ambient sounds, music tone, voice-over style (Veo 3 native audio)
9. END TAG — always close with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"

━━━ RULES ━━━
- STRICT ALIGNMENT: every object/action/number in dialogue MUST appear in the prompt (safely reframed if sensitive).
- DYNAMIC MOVEMENT: chain camera movements for 2+ ideas: "Starts with X, then pans to Y, reveals Z"
- PACING: ${pacingMap[targetDuration] || pacingMap[8]}
- NUMBERS/DATA: visualize as glowing holographic overlays or floating infographics.
- LANGUAGE: 100% English output only. Translate from ANY input language.

━━━ OUTPUT FORMAT ━━━
Return ONLY a valid JSON array with exactly ${chunks.length} strings — one prompt per scene, in order:
["<prompt for scene 1>", "<prompt for scene 2>", ...]
No markdown, no extra text, no explanation outside the JSON array.`;

  const scenesText = chunks.map(c =>
    `Scene ${c.scene} | Time: ${c.time}\nDialogue: "${c.exactText}"`
  ).join('\n\n---\n\n');

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `${scenesText}\n\nWrite ONE complete Veo_Video_Prompt for EACH of the ${chunks.length} scenes above.\nReturn ONLY a JSON array of ${chunks.length} prompt strings, in order.`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: chunks.length * 450,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7
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
  // maxCycles: 1 — batch prompt gen: 1 vòng qua tất cả key, fail fast
  }, apiKeys, { onSwitch, maxCycles: 1 });
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
          const fallback = {
            sceneNumber:    chunk.scene,
            timeEstimation: chunk.time,
            dialogue:       chunk.exactText,
            veoVideoPrompt: 'Cinematic establishing shot, smooth camera movement, aspect ratio 16:9, cinematic shot',
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
      }, apiKeys, { maxCycles: 1 });
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
