/**
 * Whisper Web Worker — chạy trong renderer, không block UI thread.
 *
 * FIX Electron (file:// protocol):
 *   - WASM files từ onnxruntime-web không được Vite copy vào dist/
 *   - Tính đường dẫn tuyệt đối tới node_modules từ vị trí worker
 *   - numThreads = 1 → dùng ort-wasm-simd.wasm, không cần SharedArrayBuffer
 *   - Fallback CDN nếu local không được
 */
import { pipeline, env } from '@xenova/transformers';

// ── Fix đường dẫn WASM cho Electron ─────────────────────────────────────────
// Vite plugin (copyOrtWasmPlugin) đã copy *.wasm vào dist/assets/
// Worker cũng nằm ở dist/assets/ → dùng cùng thư mục (new URL('./', import.meta.url))
(function setupWasm() {
  try {
    // Cùng thư mục với worker (dist/assets/) — nơi Vite đã copy .wasm vào
    const wasmDir = new URL('./', import.meta.url).href;
    env.backends.onnx.wasm.wasmPaths = wasmDir;
    console.log('[Whisper] WASM path:', wasmDir);
  } catch (_) {
    // Fallback: CDN
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
    console.log('[Whisper] WASM path (CDN fallback)');
  }
  // Tắt multi-threading → dùng ort-wasm-simd.wasm → không cần SharedArrayBuffer
  env.backends.onnx.wasm.numThreads = 1;
  env.allowLocalModels = false;
})();

// ── Singleton pipeline ────────────────────────────────────────────────────────
let transcriber = null;

async function getTranscriber(onProgress) {
  if (transcriber) return transcriber;
  transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny',          // ~150 MB, multilingual (vi/en/...)
    { progress_callback: onProgress }
  );
  return transcriber;
}

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', async ({ data }) => {
  const { type, id } = data;

  // ── Tải model ─────────────────────────────────────────────────────────────
  if (type === 'load') {
    try {
      await getTranscriber((p) => {
        self.postMessage({ type: 'load_progress', progress: p });
      });
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      console.error('[Whisper Worker] Load error:', err);
      self.postMessage({ type: 'load_error', error: err.message || String(err) });
    }
    return;
  }

  // ── Transcribe 1 đoạn audio ───────────────────────────────────────────────
  if (type === 'transcribe') {
    const { audio, sampling_rate } = data;
    try {
      const tr = await getTranscriber((p) => {
        self.postMessage({ type: 'load_progress', progress: p });
      });

      const result = await tr(
        { array: audio, sampling_rate },
        {
          language: null,          // auto-detect
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
        }
      );

      self.postMessage({ type: 'result', id, result });
    } catch (err) {
      console.error('[Whisper Worker] Transcribe error:', err);
      self.postMessage({ type: 'error', id, error: err.message || String(err) });
    }
    return;
  }
});
