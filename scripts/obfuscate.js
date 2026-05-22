/**
 * Obfuscate renderer (dist/assets) trước electron-builder.
 * Chỉ obfuscate dist/ — KHÔNG đụng src/main/ (tránh double-obfuscate file gốc).
 * ASAR đã bảo vệ src/main/ khi đóng gói.
 */
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs   = require('fs');
const path = require('path');

const OPTIONS = {
  compact:                          true,
  controlFlowFlattening:            false,
  deadCodeInjection:                false,
  debugProtection:                  false,
  disableConsoleOutput:             false,
  identifierNamesGenerator:         'hexadecimal',
  log:                              false,
  numbersToExpressions:             true,
  renameGlobals:                    false,
  selfDefending:                    false,
  simplify:                         true,
  splitStrings:                     false,
  stringArray:                      true,
  stringArrayCallsTransform:        true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding:              ['base64'],
  stringArrayIndexShift:            true,
  stringArrayRotate:                true,
  stringArrayShuffle:               true,
  stringArrayWrappersCount:         2,
  stringArrayWrappersChainedCalls:  true,
  stringArrayWrappersType:          'function',
  stringArrayThreshold:             0.75,
  unicodeEscapeSequence:            false,
};

function obfuscateFile(filePath) {
  const code   = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, OPTIONS);
  fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
  console.log('  ✅', path.relative(process.cwd(), filePath));
}

function walkDir(dir, ext = '.js') {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, ext);
    else if (entry.isFile() && entry.name.endsWith(ext)) obfuscateFile(full);
  }
}

const ROOT = path.join(__dirname, '..');

// Chỉ obfuscate renderer — dist/ được tạo mới mỗi lần vite build nên an toàn
console.log('\n🔐 Obfuscating renderer (dist/assets)...');
walkDir(path.join(ROOT, 'dist', 'assets'));

console.log('\n✅ Obfuscation complete!\n');
