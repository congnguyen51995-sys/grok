/**
 * Chạy bên trong Electron process để compile main.js → main.jsc
 * Gọi bởi: electron scripts/compile-bytecode.js
 */
const { app } = require('electron');

app.whenReady().then(async () => {
  const bytenode = require('bytenode');
  const path     = require('path');
  const fs       = require('fs');

  const ROOT   = path.join(__dirname, '..');
  const OUT    = path.join(ROOT, 'build-protected');

  fs.mkdirSync(OUT, { recursive: true });

  try {
    await bytenode.compileFile({
      filename : path.join(ROOT, 'src', 'main', 'main.js'),
      output   : path.join(OUT, 'main.jsc'),
    });
    console.log('  ✅ main.jsc compiled successfully');
  } catch (e) {
    console.error('  ❌ Bytecode compile failed:', e.message);
    process.exitCode = 1;
  }

  app.quit();
});
