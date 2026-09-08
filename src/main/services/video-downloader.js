const { ipcMain, app } = require('electron');
const { spawn }        = require('child_process');
const path             = require('path');
const fs               = require('fs');
const https            = require('https');
const http             = require('http');

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

function getYtDlpDir()  { return path.join(app.getPath('userData'), 'tools'); }
function getYtDlpPath() { return path.join(getYtDlpDir(), 'yt-dlp.exe'); }

function findYtDlp() {
  const local = getYtDlpPath();
  if (fs.existsSync(local)) return local;
  try {
    const inRes = path.join(process.resourcesPath, 'yt-dlp.exe');
    if (fs.existsSync(inRes)) return inRes;
  } catch {}
  return null;
}

function checkYtDlp() {
  const ytdlp = findYtDlp();
  if (!ytdlp) return Promise.resolve({ ok: false });
  return new Promise((resolve) => {
    const proc = spawn(ytdlp, ['--version']);
    let version = '';
    proc.stdout.on('data', d => { version += d.toString().trim(); });
    proc.on('close', code => resolve(code === 0 ? { ok: true, path: ytdlp, version } : { ok: false }));
    proc.on('error', () => resolve({ ok: false }));
  });
}

function downloadFile(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, onProgress, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0) onProgress(Math.round(received / total * 100));
      });
      res.on('end', () => { file.end(); resolve(); });
      res.on('error', err => { file.destroy(); reject(err); });
      file.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function setupYtDlp(onProgress) {
  fs.mkdirSync(getYtDlpDir(), { recursive: true });
  const dest = getYtDlpPath();
  await downloadFile(YTDLP_RELEASE, dest, onProgress);
  return { ok: true, path: dest };
}

async function ensureYtDlp() {
  const found = findYtDlp();
  if (found) return found;
  fs.mkdirSync(getYtDlpDir(), { recursive: true });
  await downloadFile(YTDLP_RELEASE, getYtDlpPath(), () => {});
  return getYtDlpPath();
}

function getVideoInfo(url) {
  return ensureYtDlp().then(ytdlp => new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, [
      '--no-playlist', '--dump-json', '--no-warnings',
      '--socket-timeout', '15',
      url,
    ]);
    let json = '';
    let errOut = '';
    proc.stdout.on('data', d => { json += d.toString(); });
    proc.stderr.on('data', d => { errOut += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        const msg = errOut.split('\n').find(l => l.includes('ERROR:')) || errOut.split('\n')[0] || `Lỗi ${code}`;
        return reject(new Error(msg.replace('ERROR: ', '')));
      }
      try {
        // yt-dlp may output multiple JSON lines (playlist) — take first
        const firstLine = json.trim().split('\n')[0];
        const data = JSON.parse(firstLine);
        const heights = new Set();
        (data.formats || []).forEach(f => { if (f.height && f.vcodec !== 'none') heights.add(f.height); });
        const sortedHeights = [...heights].sort((a, b) => b - a).filter(h => h <= 4320).slice(0, 5);
        resolve({
          title:     data.title      || 'Không có tiêu đề',
          thumbnail: data.thumbnail  || '',
          duration:  data.duration   || 0,
          channel:   data.uploader   || data.channel || '',
          viewCount: data.view_count || 0,
          heights:   sortedHeights,
          ext:       data.ext        || 'mp4',
        });
      } catch (e) { reject(new Error('Lỗi phân tích dữ liệu: ' + e.message)); }
    });
    proc.on('error', e => reject(new Error(`Không thể chạy yt-dlp: ${e.message}`)));
  }));
}

function buildArgs(url, outputTemplate, quality, format, useCookies = false) {
  const args = [
    '--no-playlist', '--newline', '--no-warnings',
    '-o', outputTemplate,
    // Chống throttle / ngắt kết nối giữa chừng
    '--retries', '15',
    '--fragment-retries', '15',
    '--retry-sleep', 'linear=1::3',   // tăng dần 1s → 3s giữa retries
    '--socket-timeout', '30',
    '--concurrent-fragments', '4',
    '--extractor-retries', '5',
    // Giả browser để tránh 403 — YouTube kiểm tra User-Agent
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    // player_client web_creator ít bị chặn hơn android/ios trên server mới của YT
    '--extractor-args', 'youtube:player_client=web,default',
  ];
  // Khi bị 403: thử dùng cookie từ browser để xác thực
  // Firefox trước vì Chrome v127+ dùng DPAPI encryption mới mà yt-dlp chưa hỗ trợ
  if (useCookies) {
    args.push('--cookies-from-browser', 'firefox');
  }
  if (format === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    if (quality === 'best') {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
    } else {
      const h = parseInt(quality);
      args.push('-f', `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`, '--merge-output-format', 'mp4');
    }
  }
  args.push(url);
  return args;
}

// [download]  45.6% of 123.45MiB at 5.00MiB/s ETA 00:20
function parseProgressLine(line) {
  const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\S]+)\s+at\s+([\S]+)\s+ETA\s+([\S]+)/);
  if (m) return { percent: parseFloat(m[1]), size: m[2], speed: m[3], eta: m[4] };
  const dest = line.match(/\[download\] Destination:\s*(.+)/);
  if (dest) return { filename: path.basename(dest[1].trim()) };
  const already = line.match(/\[download\] (.+) has already been downloaded/);
  if (already) return { percent: 100, already: true };
  return null;
}

let _activeProc  = null;           // single download
const _batchProcs = new Map();      // id → proc (parallel batch)

function runYtDlp(ytdlp, args, mainWindow, progressChannel = 'downloader:progress', itemId = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, args);
    if (itemId === null) _activeProc = proc;
    else _batchProcs.set(itemId, proc);

    let errOut = '', lastFile = '';

    proc.stdout.on('data', (d) => {
      d.toString().split('\n').forEach(line => {
        const prog = parseProgressLine(line.trim());
        if (!prog) return;
        if (prog.filename) lastFile = prog.filename;
        const payload = { ...prog, filename: lastFile };
        if (itemId !== null) payload.id = itemId;
        mainWindow?.webContents?.send(progressChannel, payload);
      });
    });

    proc.stderr.on('data', d => { errOut += d.toString(); });

    proc.on('close', (code) => {
      if (itemId === null) _activeProc = null;
      else _batchProcs.delete(itemId);
      if (code === 0 || code === null) resolve({ success: true, cancelled: code === null, errOut });
      else reject(Object.assign(new Error(
        (errOut.split('\n').find(l => l.includes('ERROR:')) || `Lỗi thoát ${code}`).replace('ERROR: ', '')
      ), { errOut }));
    });
    proc.on('error', e => {
      if (itemId === null) _activeProc = null;
      else _batchProcs.delete(itemId);
      reject(new Error(`yt-dlp: ${e.message}`));
    });
  });
}

async function startDownload({ url, outputFolder, quality, format }, mainWindow) {
  const ytdlp = await ensureYtDlp();
  const outputTemplate = path.join(outputFolder, '%(title)s.%(ext)s');
  try {
    return await runYtDlp(ytdlp, buildArgs(url, outputTemplate, quality, format, false), mainWindow);
  } catch (err) {
    const needsAuth = err.errOut && (
      err.errOut.includes('403') || err.errOut.includes('Forbidden') ||
      err.errOut.includes('Sign in') || err.errOut.includes('sign in') ||
      err.errOut.includes('authentication') || err.errOut.includes('cookies') ||
      err.errOut.includes('HTTP Error 401') || err.errOut.includes('login') ||
      err.errOut.includes('age') || err.errOut.includes('Premium') ||
      err.errOut.includes('DPAPI') || err.errOut.includes('decrypt')
    );
    if (!needsAuth) throw err;
    mainWindow?.webContents?.send('downloader:progress', { status: '🍪 Cần xác thực — thử lại với cookie trình duyệt...' });
    return await runYtDlp(ytdlp, buildArgs(url, outputTemplate, quality, format, true), mainWindow);
  }
}

async function startBatchDownload(items, mainWindow) {
  const ytdlp = await ensureYtDlp();

  const results = await Promise.allSettled(items.map(async (item) => {
    const outputTemplate = path.join(item.outputFolder, '%(title)s.%(ext)s');
    const send = (extra) => mainWindow?.webContents?.send('downloader:batch-progress', { id: item.id, ...extra });
    try {
      await runYtDlp(ytdlp, buildArgs(item.url, outputTemplate, item.quality, item.format, false),
        mainWindow, 'downloader:batch-progress', item.id);
      return { id: item.id, success: true };
    } catch (err) {
      const is403 = err.errOut && (
        err.errOut.includes('403') || err.errOut.includes('Forbidden') ||
        err.errOut.includes('Sign in') || err.errOut.includes('sign in') ||
        err.errOut.includes('authentication') || err.errOut.includes('cookies') ||
        err.errOut.includes('HTTP Error 401') || err.errOut.includes('login') ||
        err.errOut.includes('age') || err.errOut.includes('Premium') ||
        err.errOut.includes('DPAPI') || err.errOut.includes('decrypt')
      );
      if (!is403) return { id: item.id, success: false, error: err.message };
      send({ status: '🍪 403 → thử cookie...' });
      try {
        await runYtDlp(ytdlp, buildArgs(item.url, outputTemplate, item.quality, item.format, true),
          mainWindow, 'downloader:batch-progress', item.id);
        return { id: item.id, success: true };
      } catch (e2) {
        return { id: item.id, success: false, error: e2.message };
      }
    }
  }));

  return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });
}

function cancelDownload() {
  if (_activeProc) { _activeProc.kill(); _activeProc = null; }
}

function cancelBatch() {
  for (const proc of _batchProcs.values()) { try { proc.kill(); } catch {} }
  _batchProcs.clear();
}

function registerDownloaderHandlers(mainWindow) {
  ipcMain.handle('downloader:check', () => checkYtDlp());

  ipcMain.handle('downloader:setup', async () => {
    try {
      await setupYtDlp(pct => mainWindow?.webContents?.send('downloader:setup-progress', { percent: pct }));
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('downloader:info', async (_, url) => {
    try   { return { success: true, data: await getVideoInfo(url) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('downloader:start', async (_, opts) => {
    try   { return await startDownload(opts, mainWindow); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('downloader:cancel', () => { cancelDownload(); return { success: true }; });

  ipcMain.handle('downloader:batch-start', async (_, items) => {
    try   { return await startBatchDownload(items, mainWindow); }
    catch (e) { return items.map(i => ({ id: i.id, success: false, error: e.message })); }
  });

  ipcMain.handle('downloader:batch-cancel', () => { cancelBatch(); return { success: true }; });

  ipcMain.handle('downloader:batch-pause', (_, id) => {
    const proc = _batchProcs.get(id);
    if (proc) { try { proc.kill(); } catch {} _batchProcs.delete(id); }
    return { success: true };
  });

  ipcMain.handle('downloader:batch-resume', async (_, item) => {
    let ytdlp; try { ytdlp = await ensureYtDlp(); } catch(e) { return { id: item.id, success: false, error: e.message }; }
    const outputTemplate = path.join(item.outputFolder, '%(title)s.%(ext)s');
    try {
      await runYtDlp(ytdlp, buildArgs(item.url, outputTemplate, item.quality, item.format, false),
        mainWindow, 'downloader:batch-progress', item.id);
      return { id: item.id, success: true };
    } catch (err) {
      const is403 = err.errOut && (
        err.errOut.includes('403') || err.errOut.includes('Forbidden') ||
        err.errOut.includes('Sign in') || err.errOut.includes('sign in') ||
        err.errOut.includes('authentication') || err.errOut.includes('cookies') ||
        err.errOut.includes('HTTP Error 401') || err.errOut.includes('login') ||
        err.errOut.includes('age') || err.errOut.includes('Premium') ||
        err.errOut.includes('DPAPI') || err.errOut.includes('decrypt')
      );
      if (!is403) return { id: item.id, success: false, error: err.message };
      mainWindow?.webContents?.send('downloader:batch-progress', { id: item.id, status: '🍪 403 → thử cookie...' });
      try {
        await runYtDlp(ytdlp, buildArgs(item.url, outputTemplate, item.quality, item.format, true),
          mainWindow, 'downloader:batch-progress', item.id);
        return { id: item.id, success: true };
      } catch (e2) {
        return { id: item.id, success: false, error: e2.message };
      }
    }
  });
}

module.exports = { registerDownloaderHandlers };
