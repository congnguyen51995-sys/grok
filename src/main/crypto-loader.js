/**
 * Runtime AES-256-CBC decryption hook.
 * Must be required FIRST (via bootstrap.js).
 * Intercepts Node.js require() for encrypted .js files.
 */
const Module = require('module');
const fs     = require('fs');
const crypto = require('crypto');

const MARKER = 'FLUXY_ENC_V2:';
const _P1 = 'FLX-TCM-2026';
const _P2 = '-SECURE-KEY-V2';
const _SALT = 'fluxy-thanhcong-2026';

function _deriveKey() {
  return crypto.scryptSync(_P1 + _P2, _SALT, 32);
}

function _decrypt(raw) {
  const data     = raw.slice(MARKER.length);
  const sep      = data.indexOf(':');
  const iv       = Buffer.from(data.slice(0, sep), 'base64');
  const enc      = Buffer.from(data.slice(sep + 1), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', _deriveKey(), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const _orig = Module._extensions['.js'];
Module._extensions['.js'] = function (mod, filename) {
  let raw;
  try { raw = fs.readFileSync(filename, 'utf8'); } catch (_) { return _orig(mod, filename); }
  if (raw.startsWith(MARKER)) {
    mod._compile(_decrypt(raw), filename);
  } else {
    _orig(mod, filename);
  }
};
