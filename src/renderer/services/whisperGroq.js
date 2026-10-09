/**
 * whisperGroq.js — Transcribe audio qua Groq Whisper Large v3 Turbo
 * Dùng key hệ thống `fluxy_groq_api_keys` với rotation khi bị 429
 */

const LS_GROQ_KEYS = 'fluxy_groq_api_keys';

export function loadGroqKeysForWhisper() {
  try { return JSON.parse(localStorage.getItem(LS_GROQ_KEYS) || '[]'); } catch { return []; }
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
    for (let attempt = 0; attempt < keys.length; attempt++) {
      const apiKey = keys[(keyIdx + attempt) % keys.length];
      const res = await window.electronAPI.groqWhisperChunk({
        filePath, startSec, durationSec: durSec, apiKey,
      });

      if (res.ok) {
        keyIdx = (keyIdx + attempt) % keys.length;
        allSegments.push(...res.segments);
        fullText += res.fullText + ' ';
        onLog?.(`  ✅ Đoạn ${idx+1}: ${res.segments.length} câu`);
        onChunkDone?.(idx+1, totalChunks, res.segments.length, null);
        succeeded = true;
        break;
      }

      // 429 rate limit → thử key kế tiếp
      if (res.status === 429 || (res.error || '').includes('429')) {
        onLog?.(`  🔄 Key ${attempt+1} rate limit → thử key khác...`);
        continue;
      }

      // Lỗi khác → log và bỏ chunk này
      onLog?.(`  ⚠ Đoạn ${idx+1} thất bại: ${res.error}`);
      onChunkDone?.(idx+1, totalChunks, 0, res.error);
      break;
    }

    if (!succeeded) {
      onChunkDone?.(idx+1, totalChunks, 0, 'Hết key / thất bại');
    }
  }

  return { segments: allSegments, fullText: fullText.trim(), language: 'vi' };
}
