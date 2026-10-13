/**
 * groq-whisper.js — Groq Whisper Large v3 Turbo transcription
 * Nhận chunk audio → extract WAV → POST Groq API → trả về segments có timestamp
 */
'use strict';

const { ipcMain } = require('electron');
const path        = require('path');
const fs          = require('fs');
const https       = require('https');
const os          = require('os');
const { spawn }   = require('child_process');

function getFFmpeg() {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}

// Phát hiện thời điểm GIỌNG NÓI thực sự bắt đầu trong N giây đầu file.
// Lọc dải tần giọng người (200–3500 Hz) trước khi silencedetect
// → nhạc nền bass/treble nặng không kích hoạt false-positive.
// Trả về giây đầu tiên có giọng nói (0 nếu không phát hiện được).
function detectSpeechOnset(filePath, probeSec = 20) {
  return new Promise((resolve) => {
    const ffmpeg = getFFmpeg();
    const args = [
      '-ss', '0', '-t', String(probeSec),
      '-i', filePath,
      // highpass 200Hz cắt bass nhạc, lowpass 3500Hz cắt treble/hihat
      // silencedetect: -38dB threshold, chờ ít nhất 0.15s liên tục
      '-af', 'highpass=f=200,lowpass=f=3500,silencedetect=noise=-38dB:duration=0.15',
      '-f', 'null', '-',
    ];
    const proc = spawn(ffmpeg, args);
    let out = '';
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      // silence_end = lúc im lặng kết thúc → giọng nói bắt đầu
      const ends   = [...out.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const starts = [...out.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      if (ends.length > 0) {
        // Ưu tiên silence_end đầu tiên có khoảng im lặng dài (>1s) → bỏ qua nhạc ngắn xen kẽ
        const longSilenceEnd = ends.find((e, i) => {
          const silStart = starts[i] ?? 0;
          return (e - silStart) >= 1.0;
        });
        const onset = longSilenceEnd ?? ends[0];
        resolve(Math.max(0, onset - 0.05)); // buffer 50ms
      } else {
        resolve(0); // không có silence → tiếng nói ngay từ đầu
      }
    });
    proc.on('error', () => resolve(0));
  });
}

function extractWavChunk(filePath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `groq_asr_${Date.now()}.wav`);
    const args = [
      '-y', '-ss', String(startSec), '-t', String(durationSec),
      '-i', filePath,
      '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', tmpFile,
    ];
    const proc = spawn(getFFmpeg(), args);
    let errBuf = '';
    proc.stderr.on('data', d => { errBuf += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${errBuf.slice(-200)}`));
      if (!fs.existsSync(tmpFile)) return reject(new Error('ffmpeg no output'));
      resolve(tmpFile);
    });
    proc.on('error', reject);
  });
}

function buildMultipart(boundary, fields, fileEntry) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${v}\r\n`
      ));
    }
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileEntry.name}"; filename="${fileEntry.filename}"\r\nContent-Type: ${fileEntry.contentType}\r\n\r\n`
  ));
  parts.push(fileEntry.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function postGroqWhisper(apiKey, wavData, language) {
  return new Promise((resolve, reject) => {
    const boundary = 'GWB' + Date.now().toString(16);
    const fields = {
      model:                       'whisper-large-v3',
      response_format:             'verbose_json',
      'timestamp_granularities[]': ['segment', 'word'],
    };
    if (language) fields.language = language; // omit when undefined → Groq auto-detects
    const body = buildMultipart(boundary, fields, {
      name: 'file', filename: 'audio.wav', contentType: 'audio/wav', data: wavData,
    });

    const opts = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/audio/transcriptions',
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 90000,
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const msg = (() => { try { return JSON.parse(raw)?.error?.message || raw.slice(0, 200); } catch { return raw.slice(0, 200); } })();
          const err = new Error(`Groq ${res.statusCode}: ${msg}`);
          err.status = res.statusCode;
          return reject(err);
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Parse error: ' + raw.slice(0, 100))); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout 90s')); });
    req.write(body);
    req.end();
  });
}

function registerGroqWhisperHandlers() {
  ipcMain.handle('groq:whisper-chunk', async (_, { filePath, startSec, durationSec, apiKey, language }) => {
    let wavPath = null;
    try {
      // Với chunk đầu tiên (startSec=0), dùng silence detection để biết intro im lặng bao lâu
      // Làm floor cho speechStart của segment 1 — tránh TTS phát trong khoảng silence đầu tập
      let episodeSpeechFloor = 0;
      if (startSec === 0) {
        episodeSpeechFloor = await detectSpeechOnset(filePath, Math.min(durationSec, 20)).catch(() => 0);
      }

      wavPath = await extractWavChunk(filePath, startSec, durationSec);
      const wavData = fs.readFileSync(wavPath);
      const result  = await postGroqWhisper(apiKey, wavData, language);

      const words = result.words || [];
      const segments = (result.segments || [])
        .map((s, idx) => {
          const segStart = startSec + (s.start ?? 0);
          const segEnd   = startSec + (s.end   ?? 0);
          // Tìm từ đầu tiên trong segment → dùng làm thời điểm thực nhân vật mở miệng nói
          const firstWord = words.find(w => {
            const ws = startSec + (w.start ?? 0);
            return ws >= segStart - 0.05 && ws < segEnd;
          });
          let speechStart = firstWord ? startSec + (firstWord.start ?? 0) : segStart;
          // Segment đầu tiên: đảm bảo không phát trước lúc intro kết thúc
          if (idx === 0 && episodeSpeechFloor > 0) {
            speechStart = Math.max(speechStart, episodeSpeechFloor);
          }
          return {
            start:       segStart,
            end:         segEnd,
            speechStart,
            text:        (s.text || '').trim(),
          };
        })
        .filter(s => s.text.length > 1);

      return { ok: true, segments, fullText: (result.text || '').trim() };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    } finally {
      if (wavPath) try { fs.unlinkSync(wavPath); } catch {}
    }
  });
}

module.exports = { registerGroqWhisperHandlers };
