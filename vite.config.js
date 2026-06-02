import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// ── Copy WASM runtime files cho onnxruntime-web (Whisper local) ──────────────
// Electron dùng file:// protocol → cần WASM files nằm trong dist/assets/
// cùng thư mục với whisper.worker-XXX.js để path tương đối hoạt động.
function copyOrtWasmPlugin() {
  return {
    name: 'copy-ort-wasm',
    closeBundle() {
      const src  = path.resolve('node_modules/onnxruntime-web/dist');
      const dest = path.resolve('dist/assets');
      if (!fs.existsSync(src) || !fs.existsSync(dest)) return;
      let count = 0;
      fs.readdirSync(src)
        .filter(f => f.endsWith('.wasm'))
        .forEach(f => {
          fs.copyFileSync(path.join(src, f), path.join(dest, f));
          count++;
        });
      if (count) console.log(`[copy-ort-wasm] Đã copy ${count} file .wasm → dist/assets/`);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyOrtWasmPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
  // ── @xenova/transformers: không để Vite pre-bundle (dùng WASM riêng) ────
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
  worker: {
    format: 'es',  // Web Worker dùng ESM (cần cho import.meta.url)
  },
});
