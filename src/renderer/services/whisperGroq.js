/**
 * whisperGroq.js — Transcribe audio qua Groq Whisper Large v3 Turbo
 * Dùng key hệ thống `fluxy_groq_api_keys` với rotation khi bị 429
 */

const LS_GROQ_KEYS = 'fluxy_groq_api_keys';

export function loadGroqKeysForWhisper() {
  try { return JSON.parse(localStorage.getItem(LS_GROQ_KEYS) || '[]'); } catch { return []; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Thử 1 chunk. Dừng sớm sau 3 rate limit liên tiếp (không cần thử hết keys)
async function tryChunk(keys, keyIdx, filePath, startSec, durSec, onLog) {
  const MAX_RL = Math.min(3, keys.length); // thử tối đa 3 key trước khi kết luận all-rate-limit
  let rlCount = 0;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (keyIdx + attempt) % keys.length;
    const res = await window.electronAPI.groqWhisperChunk({
      filePath, startSec, durationSec: durSec, apiKey: keys[idx],
    });

    if (res.ok) {
      return { ok: true, newKeyIdx: idx, segments: res.segments, fullText: res.fullText };
    }

    if (res.status === 429 || (res.error || '').includes('429') || (res.error || '').toLowerCase().includes('rate')) {
      rlCount++;
      onLog?.(`🔄 Key ${idx + 1} rate limit → thử key khác...`);
      // Sau 3 lần rate limit liên tiếp → chờ reset, không thử tiếp 24 key còn lại
      if (rlCount >= MAX_RL) return { allRateLimit: true };
      continue;
    }

    return { ok: false, error: res.error };
  }
  return { allRateLimit: true };
}

export async function transcribeGroqChunked(
  filePath,
  totalDuration,
  onProgress,
  onChunkDone,
  onLog,
) {
  const keys = loadGroqKeysForWhisper();
  if (!keys.length) throw new Error('Không có Groq API key — vào Cài đặt để thêm');

  const CHUNK_SECS  = 30;
  const MAX_WAIT_CYCLES = 3; // tối đa chờ 3 lần × 62s = ~3 phút
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const allSegments = [];
  let   fullText    = '';
  let   keyIdx      = 0;

  for (let idx = 0; idx < totalChunks; idx++) {
    const startSec = idx * CHUNK_SECS;
    const durSec   = Math.min(CHUNK_SECS, totalDuration - startSec);

    onLog?.(`📤 Đoạn ${idx+1}/${totalChunks} (${durSec.toFixed(0)}s) → Groq Whisper...`);
    onProgress?.(`${idx+1}/${totalChunks}`);

    let succeeded = false;

    for (let waitCycle = 0; waitCycle <= MAX_WAIT_CYCLES; waitCycle++) {
      const result = await tryChunk(keys, keyIdx, filePath, startSec, durSec, onLog, idx, totalChunks);

      if (result.ok) {
        keyIdx = result.newKeyIdx;
        allSegments.push(...result.segments);
        fullText += result.fullText + ' ';
        onLog?.(`✅ Đoạn ${idx+1}: ${result.segments.length} câu`);
        onChunkDone?.(idx+1, totalChunks, result.segments.length, null);
        succeeded = true;
        break;
      }

      if (result.allRateLimit) {
        if (waitCycle < MAX_WAIT_CYCLES) {
          const waitSec = 62 + waitCycle * 10; // 62s, 72s, 82s
          onLog?.(`⏳ Tất cả ${keys.length} key đều rate limit — chờ ${waitSec}s để Groq reset (${waitCycle+1}/${MAX_WAIT_CYCLES})...`);
          await sleep(waitSec * 1000);
        } else {
          onLog?.(`⚠ Đoạn ${idx+1}: hết key sau ${MAX_WAIT_CYCLES} lần chờ — bỏ qua`);
          onChunkDone?.(idx+1, totalChunks, 0, 'Rate limit exhausted');
        }
        continue;
      }

      // Lỗi khác (không phải rate limit)
      onLog?.(`⚠ Đoạn ${idx+1} thất bại: ${result.error}`);
      onChunkDone?.(idx+1, totalChunks, 0, result.error);
      break;
    }

    if (!succeeded && !onChunkDone) {
      onChunkDone?.(idx+1, totalChunks, 0, 'Hết key / thất bại');
    }
  }

  return { segments: allSegments, fullText: fullText.trim(), language: 'vi' };
}
