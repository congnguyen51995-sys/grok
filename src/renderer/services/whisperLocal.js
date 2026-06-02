/**
 * whisperLocal.js — Transcription cục bộ dùng Whisper
 *
 * Architecture (v2 — Main Process):
 *   Renderer gọi IPC → Main process worker_thread (whisper-thread.js) xử lý
 *   → Hoàn toàn tách biệt khỏi renderer → không crash UI
 *
 *   Main process worker_thread:
 *   - Dùng @xenova/transformers (Node.js context)
 *   - onnxruntime-web WASM chạy trong Node.js worker thread
 *   - FFmpeg extract audio → Float32Array PCM → Whisper inference
 *   - Model cache tại userData/whisper-cache (~150 MB, tải 1 lần)
 */

// ── Lắng nghe progress events từ main process ────────────────────────────────
let _progressListener = null;

function setupProgressListener(onModelProgress, onLog) {
  // Remove cũ nếu có
  if (_progressListener) {
    window.electronAPI.removeAllListeners?.('whisper:progress');
    _progressListener = null;
  }

  _progressListener = (msg) => {
    if (msg.type === 'model_progress') {
      const p = msg.progress || {};
      if (p.status === 'downloading' || p.status === 'progress') {
        const pct = Math.round(p.progress || 0);
        const mb  = ((p.loaded || 0) / 1048576).toFixed(1);
        const tot = ((p.total  || 0) / 1048576).toFixed(0);
        const txt = `⬇️ Tải model Whisper: ${pct}% (${mb}/${tot} MB)`;
        onModelProgress?.(txt);
        onLog?.(txt);
      } else if (p.status === 'loading') {
        const txt = '🔄 Đang nạp model Whisper vào bộ nhớ...';
        onModelProgress?.(txt);
        onLog?.(txt);
      } else if (p.status === 'loaded' || p.status === 'ready') {
        onLog?.('✅ Model Whisper sẵn sàng!');
      }
    } else if (msg.type === 'model_ready') {
      onLog?.('✅ Model Whisper sẵn sàng!');
    } else if (msg.type === 'log') {
      onLog?.(`  ${msg.msg}`);
    }
  };

  window.electronAPI.onWhisperProgress(_progressListener);
}

// ── transcribeLocalChunked ────────────────────────────────────────────────────
/**
 * Transcribe toàn bộ file theo chunks 90s.
 * Gọi IPC → main process worker_thread chạy Whisper cục bộ.
 *
 * @param {string}   filePath      - đường dẫn file audio/video
 * @param {number}   totalDuration - tổng thời lượng (giây)
 * @param {Function} onProgress    - (msg: string) → void
 * @param {Function} onChunkDone   - (done, total, segCount, errMsg|null) → void
 * @param {Function} onLog         - (msg: string) → void
 * @param {Function} onModelProgress - (msg: string) → void (model download)
 */
export async function transcribeLocalChunked(
  filePath,
  totalDuration,
  onProgress,
  onChunkDone,
  onLog,
  onModelProgress
) {
  // Đăng ký listener progress trước khi gọi IPC
  setupProgressListener(onModelProgress, onLog);

  const CHUNK_SECS  = 30;   // 30s = 1 Whisper context window; WASM ~3-6s/chunk, mỗi chunk có progress update riêng
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const allSegments = [];
  let   fullText    = '';

  for (let idx = 0; idx < totalChunks; idx++) {
    const startSec = idx * CHUNK_SECS;
    const durSec   = Math.min(CHUNK_SECS, totalDuration - startSec);

    onLog?.(`📤 Đoạn ${idx + 1}/${totalChunks} (${durSec.toFixed(0)}s) → Whisper cục bộ...`);
    onProgress?.(`${idx + 1}/${totalChunks}`);

    try {
      // Gọi main process → worker_thread (non-blocking với IPC)
      const res = await window.electronAPI.whisperTranscribeChunk({
        filePath,
        startSec,
        durationSec: durSec,
      });

      if (!res.success) throw new Error(res.error || 'Whisper trả về lỗi không xác định');

      // Parse segments, offset về thời gian tuyệt đối
      const chunks   = res.result?.chunks || [];
      const segments = chunks
        .map(c => ({
          start: startSec + (c.timestamp?.[0] ?? 0),
          end:   startSec + (c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 2),
          text:  (c.text || '').trim(),
        }))
        .filter(s => s.text.length > 1);

      allSegments.push(...segments);
      fullText += (res.result?.text || '').trim() + ' ';

      onLog?.(`  ✅ Đoạn ${idx + 1}/${totalChunks}: ${segments.length} câu`);
      onChunkDone?.(idx + 1, totalChunks, segments.length, null);
    } catch (err) {
      onLog?.(`  ⚠️ Đoạn ${idx + 1}/${totalChunks}: ${err.message}`);
      onChunkDone?.(idx + 1, totalChunks, 0, err.message);
      // Tiếp tục chunk tiếp theo, không dừng hẳn
    }
  }

  // Cleanup listener
  window.electronAPI.removeAllListeners?.('whisper:progress');
  _progressListener = null;

  if (!allSegments.length && !fullText.trim()) {
    throw new Error(
      'Whisper không nhận ra được lời nói. Kiểm tra chất lượng audio hoặc thử Gemini.'
    );
  }

  return {
    segments: allSegments,
    fullText:  fullText.trim(),
    language: 'auto',
  };
}
