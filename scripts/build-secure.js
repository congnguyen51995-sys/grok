/**
 * FLUXY SECURE BUILD v2.3.0
 * Pipeline:
 *   1. Vite build renderer → dist/
 *   2. Obfuscate + AES-256-CBC encrypt src/main → build-protected/main/
 *      (bootstrap.js, crypto-loader.js, preload.js → obfuscate ONLY, not encrypted)
 *   3. electron-builder đóng gói từ build-protected/ → release/
 *
 * src/ không bị đụng — file gốc luôn nguyên vẹn.
 */

const { execSync }         = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');
const crypto               = require('crypto');
const fs                   = require('fs');
const path                 = require('path');

const ROOT          = path.join(__dirname, '..');
const SRC_MAIN      = path.join(ROOT, 'src', 'main');
const PROTECTED_DIR = path.join(ROOT, 'build-protected', 'main');

// ── Encryption config (phải khớp với crypto-loader.js) ───────────────────────
const _ENC_SEED = 'FLX-TCM-2026-SECURE-KEY-V2';
const _ENC_SALT = 'fluxy-thanhcong-2026';
const MARKER    = 'FLUXY_ENC_V2:';

function deriveKey() {
  return crypto.scryptSync(_ENC_SEED, _ENC_SALT, 32);
}

function encryptCode(plaintext) {
  const key     = deriveKey();
  const iv      = crypto.randomBytes(16);
  const cipher  = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return MARKER + iv.toString('base64') + ':' + enc.toString('base64');
}

// ── Obfuscation options ───────────────────────────────────────────────────────
const OBF_OPTIONS = {
  compact                            : true,
  controlFlowFlattening              : false,
  deadCodeInjection                  : false,
  debugProtection                    : false,
  disableConsoleOutput               : false,
  identifierNamesGenerator           : 'hexadecimal',
  log                                : false,
  numbersToExpressions               : true,
  renameGlobals                      : false,
  selfDefending                      : false,
  simplify                           : true,
  splitStrings                       : false,
  stringArray                        : true,
  stringArrayCallsTransform          : true,
  stringArrayCallsTransformThreshold : 0.5,
  stringArrayEncoding                : ['base64'],
  stringArrayIndexShift              : true,
  stringArrayRotate                  : true,
  stringArrayShuffle                 : true,
  stringArrayWrappersCount           : 2,
  stringArrayWrappersChainedCalls    : true,
  stringArrayWrappersType            : 'function',
  stringArrayThreshold               : 0.75,
  unicodeEscapeSequence              : false,
};

function obfuscate(code) {
  return JavaScriptObfuscator.obfuscate(code, OBF_OPTIONS).getObfuscatedCode();
}

// Files loaded directly by Electron (not via require hook) → obfuscate ONLY
const OBFUSCATE_ONLY = new Set(['bootstrap.js', 'crypto-loader.js', 'preload.js']);

// Files that use page.evaluate(fn) — obfuscating breaks fn serialization into Chrome context
// because string-array helpers (_0x...) are Node.js-scoped and don't exist in browser
// → encrypt ONLY (AES-256 is sufficient protection)
const ENCRYPT_ONLY = new Set(['playwright-engine.js']);

function processFile(srcFile, dstFile) {
  const rel      = path.relative(SRC_MAIN, srcFile);
  const basename = path.basename(srcFile);
  const code     = fs.readFileSync(srcFile, 'utf8');

  fs.mkdirSync(path.dirname(dstFile), { recursive: true });

  if (OBFUSCATE_ONLY.has(basename)) {
    // obfuscate only — readable by Electron entry loader
    const obfCode = obfuscate(code);
    fs.writeFileSync(dstFile, obfCode, 'utf8');
    console.log('  🔀', rel, '(obfuscated)');
  } else if (ENCRYPT_ONLY.has(basename)) {
    // encrypt only — page.evaluate(fn) serializes fn to string, obfuscation would
    // inject Node.js-scoped helpers (_0x...) that don't exist in Chrome context
    const encCode = encryptCode(code);
    fs.writeFileSync(dstFile, encCode, 'utf8');
    console.log('  🔒', rel, '(encrypted only — page.evaluate safe)');
  } else {
    // obfuscate then AES-256-CBC encrypt
    const obfCode = obfuscate(code);
    const encCode = encryptCode(obfCode);
    fs.writeFileSync(dstFile, encCode, 'utf8');
    console.log('  🔐', rel, '(obfuscated + encrypted)');
  }
}

function getAllJsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())                               result.push(...getAllJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full);
  }
  return result;
}

function processAllMainFiles() {
  for (const srcFile of getAllJsFiles(SRC_MAIN)) {
    const rel     = path.relative(SRC_MAIN, srcFile);
    const dstFile = path.join(PROTECTED_DIR, rel);
    processFile(srcFile, dstFile);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║     FLUXY SECURE BUILD v2.4.1 PIPELINE            ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// Step 1: Clean build-protected
console.log('🗂️  Cleaning build-protected...');
const BUILD_ROOT = path.join(ROOT, 'build-protected');
if (fs.existsSync(BUILD_ROOT)) fs.rmSync(BUILD_ROOT, { recursive: true });
fs.mkdirSync(PROTECTED_DIR, { recursive: true });

// Step 2: Vite build renderer
console.log('\n📦  [1/3] Building renderer (Vite)...');
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

// Step 3: Obfuscate + encrypt main process files
console.log('\n🔐  [2/3] Obfuscating + Encrypting main process (src/main → build-protected)...');
console.log('  Legend: 🔀 obfuscated only  |  🔐 obfuscated + AES-256 encrypted');
processAllMainFiles();

// Step 4: electron-builder
console.log('\n📦  [3/3] Packaging with electron-builder...');
execSync(
  `npx electron-builder --config "${path.join(__dirname, 'electron-builder-secure.json')}"`,
  { cwd: ROOT, stdio: 'inherit' }
);

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║  ✅ SECURE BUILD v2.4.1 COMPLETE → release/      ║');
console.log('╚══════════════════════════════════════════════════╝\n');
