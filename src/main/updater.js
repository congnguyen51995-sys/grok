/**
 * Auto-updater – kiểm tra phiên bản mới từ Google Drive
 *
 * Cách dùng:
 *   1. Upload version.json lên Google Drive, lấy FILE_ID
 *   2. Thay VERSION_JSON_FILE_ID bên dưới
 *   3. Khi build bản mới: upload installer .exe lên Drive, cập nhật version.json
 */

const { app, ipcMain }  = require('electron');
const https              = require('https');
const http               = require('http');
const fs                 = require('fs');
const path               = require('path');
const os                 = require('os');
const { spawn }          = require('child_process');

// ─── CẤU HÌNH – thay FILE_ID của version.json trên Google Drive ──────────────
const VERSION_JSON_FILE_ID = '1mTDb2JKNZHBD3CUkHMQItlhSghJ4gyqp';
const VERSION_CHECK_URL =
  `https://drive.usercontent.google.com/download?id=${VERSION_JSON_FILE_ID}&export=download&confirm=t`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentVersion() {
  return app.getVersion(); // đọc từ package.json
}

// So sánh "1.2.3" vs "1.1.0" → 1 nếu v1 > v2, -1 nếu v1 < v2, 0 nếu bằng
function compareVersions(v1, v2) {
  const p1 = String(v1 || '0').split('.').map(Number);
  const p2 = String(v2 || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0, b = p2[i] || 0;
    if (a > b) return  1;
    if (a < b) return -1;
  }
  return 0;
}

// Fetch JSON từ URL (tự xử lý redirect Google Drive)
function fetchJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from version server')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// Tải file với progress callback, tự xử lý redirect
function downloadFile(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 300000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, onProgress, redirectCount + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file   = fs.createWriteStream(destPath);

      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0) onProgress(Math.round(received / total * 100));
      });
      res.on('end',   () => { file.end(); resolve(); });
      res.on('error', err => { file.destroy(); reject(err); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

// ─── Core logic ───────────────────────────────────────────────────────────────

let _mainWindow    = null;
let _updateInfo    = null;  // { newVersion, releaseNotes, downloadUrl }
let _installerPath = null;

async function checkForUpdates(mainWindow) {
  _mainWindow = mainWindow;
  try {
    const info = await fetchJson(VERSION_CHECK_URL);
    if (!info?.version || !info?.downloadUrl) return;

    const current = getCurrentVersion();
    if (compareVersions(info.version, current) > 0) {
      _updateInfo = {
        currentVersion: current,
        newVersion:     info.version,
        releaseNotes:   info.releaseNotes || '',
        downloadUrl:    info.downloadUrl,
      };
      // Thông báo renderer biết có bản mới (renderer tự trigger tải)
      mainWindow?.webContents?.send('update:available', _updateInfo);
      console.log(`[Updater] Bản mới: v${info.version} (hiện tại: v${current}) — bắt đầu tải tự động...`);

      // Tự tải ngay sau 3s (đợi app ổn định)
      setTimeout(() => _autoDownload(mainWindow), 3000);
    } else {
      console.log(`[Updater] Đang dùng bản mới nhất (v${current})`);
    }
  } catch (e) {
    console.warn('[Updater] Kiểm tra thất bại:', e.message);
  }
}

async function _autoDownload(mainWindow) {
  if (!_updateInfo?.downloadUrl) return;
  const destPath = path.join(os.tmpdir(), `FluxySetup_v${_updateInfo.newVersion}.exe`);

  // Đã tải xong từ trước
  if (_installerPath && fs.existsSync(_installerPath)) {
    mainWindow?.webContents?.send('update:downloaded', { installerPath: _installerPath });
    return;
  }

  try {
    await downloadFile(
      _updateInfo.downloadUrl,
      destPath,
      (pct) => mainWindow?.webContents?.send('update:progress', { percent: pct })
    );
    _installerPath = destPath;
    console.log(`[Updater] Tải xong: ${destPath}`);
    mainWindow?.webContents?.send('update:downloaded', { installerPath: destPath });
  } catch (e) {
    console.warn('[Updater] Tải thất bại:', e.message);
    mainWindow?.webContents?.send('update:download-error', { error: e.message });
    // Thử lại sau 2 phút
    setTimeout(() => _autoDownload(mainWindow), 2 * 60 * 1000);
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerUpdaterHandlers() {
  // Renderer yêu cầu tải bản mới
  ipcMain.handle('update:download', async () => {
    if (!_updateInfo?.downloadUrl) return { success: false, error: 'Không có thông tin bản cập nhật' };

    const destPath = path.join(os.tmpdir(), `FluxySetup_v${_updateInfo.newVersion}.exe`);

    // Nếu đã tải xong trước đó
    if (_installerPath && fs.existsSync(_installerPath)) {
      return { success: true, ready: true };
    }

    try {
      await downloadFile(
        _updateInfo.downloadUrl,
        destPath,
        (pct) => {
          _mainWindow?.webContents?.send('update:progress', { percent: pct });
        }
      );
      _installerPath = destPath;
      return { success: true, ready: true };
    } catch (e) {
      if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  // Renderer yêu cầu cài đặt (chạy installer rồi thoát app)
  ipcMain.handle('update:install', () => {
    if (!_installerPath || !fs.existsSync(_installerPath)) {
      return { success: false, error: 'File installer không tồn tại' };
    }
    try {
      spawn(_installerPath, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 1000);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Renderer muốn kiểm tra thủ công
  ipcMain.handle('update:check', async () => {
    if (!_mainWindow) return;
    await checkForUpdates(_mainWindow);
    return _updateInfo || null;
  });
}

module.exports = { checkForUpdates, registerUpdaterHandlers };
