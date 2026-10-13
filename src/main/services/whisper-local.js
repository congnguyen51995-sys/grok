'use strict';
const { ipcMain } = require('electron');
const path        = require('path');
const fs          = require('fs');
const os          = require('os');
const { spawn }   = require('child_process');

function getFFmpeg() {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}

const PYTHON = path.join(__dirname, '../../../assets/gpt/GPT-SoVITS-v2pro-20250604/runtime/python.exe');
const SCRIPT  = path.join(__dirname, '../../../assets/whisper_local.py');

function extractWav(filePath, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outPath];
    const p = spawn(getFFmpeg(), args);
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`)));
    p.on('error', reject);
  });
}

function runWhisper(wavPath, language, modelSize = 'small') {
  return new Promise((resolve, reject) => {
    const langArg = language || 'auto';
    const args = [SCRIPT, wavPath, langArg, modelSize];
    const p = spawn(PYTHON, args, { env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => {
      try {
        const parsed = JSON.parse(out.trim());
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed);
      } catch {
        reject(new Error(`whisper parse error (exit ${code}): ${(err || out).slice(-300)}`));
      }
    });
    p.on('error', reject);
  });
}

// Semaphore: chỉ cho WHISPER_MAX_CONCUR process Whisper chạy cùng lúc
// (Whisper là CPU-bound — chạy 5 cùng lúc chậm hơn chạy 1 rồi đến cái tiếp theo)
const WHISPER_MAX_CONCUR = 1;
let _whisperRunning = 0;
const _whisperQueue  = [];
function acquireWhisperSlot() {
  return new Promise(resolve => {
    const tryAcquire = () => {
      if (_whisperRunning < WHISPER_MAX_CONCUR) { _whisperRunning++; resolve(); }
      else _whisperQueue.push(tryAcquire);
    };
    tryAcquire();
  });
}
function releaseWhisperSlot() {
  _whisperRunning--;
  if (_whisperQueue.length) _whisperQueue.shift()();
}

function registerWhisperLocalHandlers() {
  // Transcribe toàn bộ video/audio bằng local faster-whisper
  ipcMain.handle('whisper:local-transcribe', async (_, { filePath, language, modelSize }) => {
    let wavPath = null;
    await acquireWhisperSlot(); // đợi slot trống (tối đa WHISPER_MAX_CONCUR cùng lúc)
    try {
      if (!fs.existsSync(PYTHON)) return { ok: false, error: 'GPT-SoVITS runtime không tìm thấy' };
      if (!fs.existsSync(SCRIPT))  return { ok: false, error: 'whisper_local.py không tìm thấy' };

      wavPath = path.join(os.tmpdir(), `wl_${Date.now()}.wav`);
      await extractWav(filePath, wavPath);

      const result = await runWhisper(wavPath, language, modelSize || 'small');
      const rawSegs = result.segments || [];

      // Chuẩn hoá sang cùng format như groq:whisper-chunk
      const segments = rawSegs
        .map(s => {
          const firstWord = (s.words || []).find(w => w.word);
          const speechStart = firstWord ? firstWord.start : s.start;
          return {
            start:       s.start,
            end:         s.end,
            speechStart: speechStart,
            text:        (s.text || '').trim(),
          };
        })
        .filter(s => s.text.length > 1);

      return { ok: true, segments, fullText: segments.map(s => s.text).join(' '), language: result.language };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      if (wavPath) try { fs.unlinkSync(wavPath); } catch {}
      releaseWhisperSlot();
    }
  });
}

module.exports = { registerWhisperLocalHandlers };
