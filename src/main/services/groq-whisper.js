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
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileEntry.name}"; filename="${fileEntry.filename}"\r\nContent-Type: ${fileEntry.contentType}\r\n\r\n`
  ));
  parts.push(fileEntry.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function postGroqWhisper(apiKey, wavData) {
  return new Promise((resolve, reject) => {
    const boundary = 'GWB' + Date.now().toString(16);
    const body = buildMultipart(boundary, {
      model:                       'whisper-large-v3-turbo',
      language:                    'vi',
      response_format:             'verbose_json',
      'timestamp_granularities[]': 'segment',
    }, {
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
  ipcMain.handle('groq:whisper-chunk', async (_, { filePath, startSec, durationSec, apiKey }) => {
    let wavPath = null;
    try {
      wavPath = await extractWavChunk(filePath, startSec, durationSec);
      const wavData = fs.readFileSync(wavPath);
      const result  = await postGroqWhisper(apiKey, wavData);

      const segments = (result.segments || [])
        .map(s => ({
          start: startSec + (s.start ?? 0),
          end:   startSec + (s.end   ?? 0),
          text:  (s.text || '').trim(),
        }))
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
