/**
 * Whisper Node.js Worker Thread
 * Chạy trong worker_threads (main process, không phải renderer)
 * → Hoàn toàn tách biệt khỏi Electron renderer
 *
 * Root cause fix:
 *   Trong Electron worker_thread, onnxruntime-node (native) chạy inference
 *   gần như tức thì và trả về kết quả rỗng (silent failure).
 *   Fix: Force dùng onnxruntime-web (WASM) bằng cách patch process.release.name
 *   trước khi import @xenova/transformers (transformers chọn backend tại module
 *   evaluation time dựa vào process.release.name === 'node').
 *
 *   BUG thứ hai: wasmPaths phải là đường dẫn filesystem, KHÔNG phải file:// URL.
 *   ort-web.node.js (Node.js build của onnxruntime-web) ghép wasmPaths với CWD
 *   như một path string, nên file:// URL sẽ tạo ra đường dẫn sai.
 */
'use strict';

const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const os   = require('os');

// workerData = { ffmpegPath, wasmDir, cacheDir }
const { ffmpegPath, wasmDir, cacheDir } = workerData || {};

let _pipeline = null;

// ── Tải @xenova/transformers — force WASM backend ────────────────────────────
async function loadTransformers() {
  if (_pipeline) return _pipeline;

  // ⚡ Bước 1: Patch process.release.name → 'electron-worker'
  //   @xenova/transformers/src/backends/onnx.js kiểm tra:
  //     if (process?.release?.name === 'node') { ONNX = ONNX_NODE; }
  //   Khi chạy trong Electron worker_thread, ONNX_NODE (onnxruntime-node native)
  //   bị silent-fail → inference trả về rỗng ngay lập tức.
  //   Patch này buộc transformers dùng ONNX_WEB (onnxruntime-web WASM) thay thế.
  const origRelease = process.release;
  let patchApplied  = false;
  try {
    Object.defineProperty(process, 'release', {
      value:        { ...origRelease, name: 'electron-worker' },
      configurable: true,
      enumerable:   true,
    });
    patchApplied = true;
    parentPort.postMessage({ type: 'log', msg: `[patch] release.name → '${process.release.name}'` });
  } catch (e) {
    parentPort.postMessage({ type: 'log', msg: `[patch] thất bại: ${e.message}` });
  }

  // Bước 2: Import transformers (ONNX_WEB được chọn vì release.name !== 'node')
  const { pipeline, env } = await import('@xenova/transformers');

  // Bước 3: Khôi phục release.name ngay sau import
  if (patchApplied) {
    try {
      Object.defineProperty(process, 'release', {
        value:        origRelease,
        configurable: true,
        enumerable:   true,
      });
    } catch (_) {}
  }
  parentPort.postMessage({ type: 'log', msg: `[patch] restored → '${process.release?.name}'` });

  // Cache model vào userData
  if (cacheDir) {
    env.cacheDir = cacheDir;
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  }

  // ⚡ Bước 4: Cấu hình WASM path bằng ĐƯỜNG DẪN FILESYSTEM (không phải file:// URL)
  //   ort-web.node.js ghép wasmPaths với CWD như string, nên cần path tuyệt đối thực sự.
  //   Nếu dùng file:// URL, nó sẽ tạo ra đường dẫn sai như "D:\...\file:\D:\...\ort-wasm.wasm"
  env.backends.onnx.wasm.numThreads = 1;
  try {
    const ortDir  = path.dirname(require.resolve('onnxruntime-web/package.json'));
    const distDir = path.join(ortDir, 'dist');
    if (fs.existsSync(distDir)) {
      const wasmFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.wasm'));
      parentPort.postMessage({ type: 'log', msg: `[wasm] ${distDir} — ${wasmFiles.length} files` });
      if (wasmFiles.length > 0) {
        // Dùng path.sep để đúng separator Windows/Unix
        env.backends.onnx.wasm.wasmPaths = distDir + path.sep;
        parentPort.postMessage({ type: 'log', msg: `[wasm] wasmPaths = ${env.backends.onnx.wasm.wasmPaths}` });
      }
    }
  } catch (e) {
    parentPort.postMessage({ type: 'log', msg: `[wasm] path error: ${e.message}` });
  }

  env.allowLocalModels = false;

  parentPort.postMessage({ type: 'log', msg: '🔄 Creating Whisper pipeline (WASM mode)...' });

  _pipeline = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny',
    {
      quantized: true,
      progress_callback: (p) => {
        parentPort.postMessage({ type: 'model_progress', progress: p });
      }
    }
  );

  // Warmup để xác minh WASM inference thực sự chạy
  parentPort.postMessage({ type: 'log', msg: '🔥 Warmup 1s...' });
  const warmupT = Date.now();
  try {
    const silence  = new Float32Array(16000);
    silence[0]     = 0.1;
    silence[8000]  = -0.1;
    const warmupR  = await _pipeline(silence, { language: 'en', task: 'transcribe' });
    const ms       = Date.now() - warmupT;
    const ok       = ms > 300;
    parentPort.postMessage({
      type: 'log',
      msg:  `${ok ? '✅' : '⚠️'} Warmup: ${ms}ms, text="${(warmupR.text || '').trim()}" ${ok ? '' : '← QUÁ NHANH!'}`,
    });
  } catch (e) {
    parentPort.postMessage({ type: 'log', msg: `Warmup lỗi: ${e.message}` });
  }

  parentPort.postMessage({ type: 'model_ready' });
  return _pipeline;
}

// ── Trích xuất audio thành WAV 16kHz mono ─────────────────────────────────────
function extractWAV(filePath, startSec, durationSec, id) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `fluxy_w_${Date.now()}.wav`);
    const args = [
      '-y',
      '-ss', String(startSec),
      '-t',  String(durationSec),
      '-i',  filePath,
      '-vn', '-ac', '1', '-ar', '16000',
      '-f',  'wav',
      tmpFile,
    ];
    const proc = spawn(ffmpegPath, args);
    let errBuf = '';
    proc.stderr.on('data', d => { errBuf += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exit ${code}: ${errBuf.slice(-300)}`));
        return;
      }
      try {
        if (!fs.existsSync(tmpFile)) {
          reject(new Error(`FFmpeg no output: ${errBuf.slice(-200)}`)); return;
        }
        const stat = fs.statSync(tmpFile);
        parentPort.postMessage({ type: 'log', id, msg: `WAV: ${(stat.size/1024).toFixed(0)} KB` });

        if (stat.size < 1000) {
          try { fs.unlinkSync(tmpFile); } catch (_) {}
          reject(new Error(`WAV quá nhỏ: ${stat.size} bytes`));
          return;
        }

        // Kiểm tra biên độ tối đa
        const buf = fs.readFileSync(tmpFile);
        let dataOff = 44; // fallback WAV data offset
        let pos = 12;
        while (pos + 8 < Math.min(buf.length, 256)) {
          const id2 = buf.slice(pos, pos + 4).toString('ascii');
          const sz  = buf.readUInt32LE(pos + 4);
          if (id2 === 'data') { dataOff = pos + 8; break; }
          pos += 8 + sz;
        }
        const nSamples = Math.floor((buf.length - dataOff) / 2);

        // Chuyển 16-bit PCM → Float32Array ([-1, 1])
        // Đồng thời kiểm tra maxAmp
        const float32 = new Float32Array(nSamples);
        let maxAmp = 0;
        for (let i = 0; i < nSamples; i++) {
          const s = buf.readInt16LE(dataOff + i * 2) / 32768.0;
          float32[i] = s;
          if (Math.abs(s) > maxAmp) maxAmp = Math.abs(s);
        }

        // Dọn dẹp WAV ngay sau khi đọc xong
        try { fs.unlinkSync(tmpFile); } catch (_) {}

        parentPort.postMessage({ type: 'log', id, msg: `Samples: ${nSamples}, maxAmp: ${maxAmp.toFixed(4)}` });
        resolve({ nSamples, maxAmp, float32 });
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
parentPort.on('message', async (msg) => {
  const { type, id } = msg;

  // ── Preload model ───────────────────────────────────────────────────────
  if (type === 'preload') {
    try {
      await loadTransformers();
    } catch (err) {
      parentPort.postMessage({ type: 'error', id, error: err.message || String(err) });
    }
    return;
  }

  // ── Transcribe 1 chunk ──────────────────────────────────────────────────
  if (type === 'transcribe') {
    const { filePath, startSec, durationSec } = msg;
    try {
      const tr = await loadTransformers();

      // 1. Trích xuất WAV → Float32Array (WAV tự xóa trong extractWAV)
      parentPort.postMessage({ type: 'log', id, msg: `🔧 Extracting WAV (${durationSec}s @ ${startSec}s)...` });
      const { nSamples, maxAmp, float32 } = await extractWAV(filePath, startSec, durationSec, id);

      if (maxAmp < 0.0005) {
        parentPort.postMessage({ type: 'log', id, msg: '⚠️ Audio quá nhỏ, bỏ qua' });
        parentPort.postMessage({ type: 'result', id, result: { text: '', chunks: [] } });
        return;
      }

      // 2. Chạy Whisper — truyền Float32Array trực tiếp (tránh dùng AudioContext)
      //    Trong WASM/browser mode, truyền file path sẽ cần AudioContext (không có).
      //    Truyền Float32Array/{ array, sampling_rate } bypass audio loading hoàn toàn.
      parentPort.postMessage({ type: 'log', id, msg: `🤖 Whisper: ${nSamples} samples, maxAmp=${maxAmp.toFixed(3)}` });
      const t0 = Date.now();

      // ⚠️ Truyền Float32Array trực tiếp — KHÔNG dùng { array, sampling_rate }.
      //    WhisperFeatureExtractor dùng aud.length và aud.subarray() trực tiếp.
      //    { array, sampling_rate } sẽ có .length = undefined → vòng while skip → 0 chunks.
      const result = await tr(
        float32,              // Float32Array — whisper-tiny mặc định 16kHz
        {
          language:          null,   // auto-detect
          task:              'transcribe',
          return_timestamps: true,
          chunk_length_s:    30,
          stride_length_s:   5,
        }
      );

      const elapsed    = Date.now() - t0;
      const chunkCount = result.chunks?.length || 0;
      const textPrev   = (result.text || '').slice(0, 100);

      parentPort.postMessage({
        type: 'log', id,
        msg: `${elapsed < 1000 ? '⚠️ FAST' : '✅'} ${elapsed}ms | ${chunkCount} chunks | "${textPrev}"`,
      });

      parentPort.postMessage({ type: 'result', id, result });
    } catch (err) {
      parentPort.postMessage({ type: 'error', id, error: err.message || String(err) });
    }
    return;
  }
});
