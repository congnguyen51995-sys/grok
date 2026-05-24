const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, shell } = electron;
const protocol = electron.protocol;
const session = electron.session;
const path = require('path');
const fs = require('fs');
const { checkForUpdates, registerUpdaterHandlers } = require('./updater');
const { registerDownloaderHandlers }               = require('./services/video-downloader');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-infobars');
app.commandLine.appendSwitch('disable-extensions-except', '');
app.commandLine.appendSwitch('force-fieldtrials', '');

const { DatabaseService }     = require('./services/database');
const { QueueManager }        = require('./services/queue-manager');
const { PlaywrightEngine }    = require('./services/playwright-engine');
const { openLoginWindow, checkLogin, syncToElectronSession, findChromePath } = require('./services/chrome-profile-manager');
const { VeoEngine }           = require('./services/veo-engine'); 

// ==================== KHỞI TẠO LOCAL SERVER (EXPRESS) ====================
const express = require('express');
const cors = require('cors');

const expressApp = express();
expressApp.use(cors());
expressApp.use(express.json({ limit: '50mb' }));

global.googleLabsAuth = {
    bearerToken: '',
    cookie: '',
    userAgent: '',
    causList: [],
    projectId: '',
    recaptchaToken: '',
    recaptchaAction: 'IMAGE_GENERATION',
    needRecaptcha: false,
    rawHeaders: [],
    resolveMediaRequest: null,
    resolvedMediaUrl: null,
    pendingImageUpload: null,   // đường dẫn ảnh chờ Extension upload
    uploadedMediaId: null,      // UUID trả về từ Extension sau khi upload
    pendingVideoGen: null,      // {url, payload} chờ Extension thực thi
    videoGenResult: null,       // kết quả từ Extension sau khi gọi video gen API
    // ── DOWNLOAD VIDEO QUA EXTENSION (Chrome full-session) ─────────────────────
    pendingVideoDownload: null, // mediaName cần tải — Extension phát hiện và tải về
    videoDownloadDone: false,   // Extension set true khi xong
    videoDownloadError: null,   // Extension set error string nếu lỗi
    videoDownloadPath: null,    // đường dẫn file tạm Extension đã lưu (nếu có)
};

// 1. Hứng Token, Cookie & VÂN TAY từ Extension
expressApp.post('/update-token', (req, res) => {
    const data = req.body;
    if (data.bearerToken) global.googleLabsAuth.bearerToken = data.bearerToken;
    if (data.cookie) global.googleLabsAuth.cookie = data.cookie;
    if (data.userAgent) global.googleLabsAuth.userAgent = data.userAgent;
    if (data.projectId) global.googleLabsAuth.projectId = data.projectId;
    if (data.recaptchaToken) global.googleLabsAuth.recaptchaToken = data.recaptchaToken;
    if (data.headers) global.googleLabsAuth.rawHeaders = data.headers; // Hấp thụ vân tay
    
    console.log("-> [AutoFlow] Da nhan duoc du lieu moi tu Extension!"); // Fix lỗi font
    res.json({ success: true });
});

// 2. Trạm kiểm tra lệnh
expressApp.get('/api/check-request', (req, res) => {
    const needsToken = global.googleLabsAuth.needRecaptcha;
    const tokenAction = global.googleLabsAuth.recaptchaAction || 'IMAGE_GENERATION';
    const doReload = !!global.googleLabsAuth.pendingReload;
    if (needsToken) {
        global.googleLabsAuth.needRecaptcha = false;
    }
    if (doReload) {
        global.googleLabsAuth.pendingReload = false; // clear sau khi gửi lệnh 1 lần
    }
    res.json({
        reload: doReload,
        needToken: needsToken,
        tokenAction: tokenAction,
        resolveMediaUrl: global.googleLabsAuth.resolveMediaRequest || null,
        needImageUpload: !!global.googleLabsAuth.pendingImageUpload,
        needVideoGen: !!global.googleLabsAuth.pendingVideoGen,
        downloadVideo: global.googleLabsAuth.pendingVideoDownload || null
    });
});

// Cấp dữ liệu ảnh (base64) cho Extension upload
expressApp.get('/api/get-upload-image-data', (req, res) => {
    const imgPath = global.googleLabsAuth.pendingImageUpload;
    if (!imgPath || !fs.existsSync(imgPath)) {
        return res.status(404).json({ error: 'No pending upload' });
    }
    const fileData = fs.readFileSync(imgPath);
    const base64 = fileData.toString('base64');
    res.json({
        base64,
        projectId: global.googleLabsAuth.projectId,
        bearerToken: global.googleLabsAuth.bearerToken
    });
});

// Cấp payload video gen cho Extension thực thi qua MAIN world
expressApp.get('/api/get-pending-video-gen', (req, res) => {
    if (!global.googleLabsAuth.pendingVideoGen) {
        return res.status(404).json({ error: 'No pending video gen' });
    }
    res.json(global.googleLabsAuth.pendingVideoGen);
});

// Nhận kết quả video gen từ Extension
expressApp.post('/api/save-video-gen-result', (req, res) => {
    if (req.body) {
        global.googleLabsAuth.videoGenResult = req.body;
        global.googleLabsAuth.pendingVideoGen = null;
    }
    res.json({ ok: true });
});

// Nhận mediaId sau khi Extension upload thành công
expressApp.post('/api/save-media-id', (req, res) => {
    if (req.body && req.body.mediaId) {
        global.googleLabsAuth.uploadedMediaId = req.body.mediaId;
        global.googleLabsAuth.pendingImageUpload = null;
    }
    res.json({ ok: true });
});

// Nhận URL video đã được resolve từ Extension
expressApp.post('/api/save-media-url', (req, res) => {
    if (req.body && req.body.url) {
        global.googleLabsAuth.resolvedMediaUrl = req.body.url;
    }
    res.json({ success: true });
});

// ── DOWNLOAD VIDEO QUA EXTENSION ─────────────────────────────────────────────
// Extension tải video bytes (Chrome full-session) và gửi về qua endpoint này.
// Dùng express.raw để nhận binary data trực tiếp (không qua JSON parse).
expressApp.post('/api/save-video-download',
    (req, res, next) => {
        // Nếu content-type là application/octet-stream: đọc raw buffer
        if (req.headers['content-type'] === 'application/octet-stream') {
            let chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                req.rawBody = Buffer.concat(chunks);
                next();
            });
        } else {
            next();
        }
    },
    (req, res) => {
        const buf = req.rawBody || (req.body instanceof Buffer ? req.body : null);
        if (buf && buf.length > 0) {
            // Nhận raw binary bytes từ Extension
            const os = require('os');
            const tempPath = path.join(os.tmpdir(), `veo_dl_${Date.now()}.mp4`);
            try {
                fs.writeFileSync(tempPath, buf);
                global.googleLabsAuth.videoDownloadPath = tempPath;
                global.googleLabsAuth.videoDownloadDone = true;
                global.googleLabsAuth.pendingVideoDownload = null;
                return res.json({ ok: true, size: buf.length });
            } catch (e) {
                global.googleLabsAuth.videoDownloadError = e.message;
                global.googleLabsAuth.pendingVideoDownload = null;
                return res.status(500).json({ error: e.message });
            }
        }
        // Nhận đường dẫn file từ chrome.downloads (Extension dùng chrome.downloads.download)
        if (req.body && req.body.path) {
            global.googleLabsAuth.videoDownloadPath = req.body.path; // đường dẫn file đã tải
            global.googleLabsAuth.videoDownloadDone = true;
            global.googleLabsAuth.pendingVideoDownload = null;
            return res.json({ ok: true });
        }
        // Fallback: Extension gửi URL thay vì bytes/path
        if (req.body && req.body.url) {
            global.googleLabsAuth.videoDownloadPath = req.body.url;
            global.googleLabsAuth.videoDownloadDone = true;
            global.googleLabsAuth.pendingVideoDownload = null;
        }
        res.json({ ok: true });
    }
);

expressApp.post('/api/video-download-error', (req, res) => {
    global.googleLabsAuth.videoDownloadError = req.body?.error || 'Extension download failed';
    global.googleLabsAuth.videoDownloadDone = false;
    global.googleLabsAuth.pendingVideoDownload = null;
    res.json({ ok: true });
});

expressApp.post('/api/save-caus', (req, res) => {
    if (req.body && req.body.causList) {
        global.googleLabsAuth.causList = [...new Set([...global.googleLabsAuth.causList, ...req.body.causList])];
    }
    res.json({ success: true });
});

expressApp.get('/api/system-status', (req, res) => {
    const licInfo = getLicenseInfo();
    res.json({
        extensionConnected: !!global.googleLabsAuth?.bearerToken,
        credits: "24870",
        license: { isActive: licInfo.isActive, daysLeft: licInfo.daysLeft }
    });
});

expressApp.listen(3000, () => {
    console.log("-> AutoFlow Local Server dang chay o cong 3000..."); // Fix lỗi font
});

// ==================== ELECTRON APP LIFECYCLE VÀ CÁC CHỨC NĂNG CÒN LẠI ====================
let mainWindow = null;
let db = null;
let queueManager = null;
let playwrightEngine = null;
let profilesBaseDir = null;

// ── OMNIVOICE BACKEND PROCESS ─────────────────────────────────────────────────
let omniVoiceProc     = null;
let omniVoiceStarting = false;

if (protocol && protocol.registerSchemesAsPrivileged) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'local', privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true } }]);
}

async function initializeServices() {
  try {
    profilesBaseDir = path.join(app.getPath('userData'), 'chrome-profiles');
    if (!fs.existsSync(profilesBaseDir)) fs.mkdirSync(profilesBaseDir, { recursive: true });

    db = new DatabaseService(app.getPath('userData'));
    await db.init();

    const savedDownloadsDir = await db.getSetting('downloadsDir', null);
    const downloadsDir = savedDownloadsDir || path.join(app.getPath('documents'), 'GrokStudio_Downloads');

    playwrightEngine = new PlaywrightEngine({
      downloadsDir, profilesBaseDir, db,
      onProgress: (jobId, progress) => { db.updateJobStatus(jobId, 'RUNNING', progress); mainWindow?.webContents.send('job-progress', { jobId, progress }); },
      onComplete: (jobId, result) => { db.updateJobComplete(jobId, result.localPath, result.grokUrl); mainWindow?.webContents.send('job-complete', { jobId, ...result }); },
      onError: (jobId, error) => { db.updateJobError(jobId, error.message); mainWindow?.webContents.send('job-error', { jobId, error: error.message }); }
    });

    const savedConcurrency = parseInt(await db.getSetting('concurrency', '1'));
    queueManager = new QueueManager({ db, playwrightEngine, concurrency: savedConcurrency });
    await queueManager.init();
  } catch (error) { throw error; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 600,
    title: 'Grok Auto Studio', icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false, allowRunningInsecureContent: true },
    titleBarStyle: 'default', backgroundColor: '#0f172a', show: false 
  });
  mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => mainWindow = null);
}

function setupIpcHandlers() {
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('db:get-jobs', async () => db.getAllJobs());
  ipcMain.handle('db:create-job', async (event, jobData) => { const jobId = await db.createJob(jobData); queueManager.addJob(await db.getJobById(jobId)); return jobId; });
  ipcMain.handle('db:delete-job', async (event, id) => { await db.deleteJob(id); return true; });
  ipcMain.handle('db:retry-job', async (event, id) => { const job = await db.retryJob(id); if (job) queueManager.addJob(job); return true; });
  ipcMain.handle('db:count-jobs', async (event, status) => db.countByStatus(status));

  ipcMain.handle('settings:get-concurrency', async () => parseInt(await db.getSetting('concurrency', '1')));
  ipcMain.handle('settings:set-concurrency', async (event, value) => { const num = parseInt(value) || 1; await db.setSetting('concurrency', num.toString()); queueManager.setConcurrency(num); return num; });
  ipcMain.handle('settings:get', async (event, key, defaultValue) => db.getSetting(key, defaultValue));
  ipcMain.handle('settings:set', async (event, key, value) => { await db.setSetting(key, value); return true; });

  ipcMain.handle('browser:open-login', async (event, profileId) => {
    try {
      const result = await openLoginWindow(profileId, profilesBaseDir);
      if (result.cookieCount > 0) await syncToElectronSession(profileId, profilesBaseDir, session.fromPartition(profileId ? `persist:grok-${profileId}` : 'persist:grok'));
      return { success: true, cookieCount: result.cookieCount };
    } catch (e) { throw e; }
  });
  ipcMain.handle('browser:close', async () => { if (playwrightEngine && typeof playwrightEngine.close === 'function') await playwrightEngine.close(); return true; });
  ipcMain.handle('browser:run-via-cdp', async (event, jobId, cdpPort) => { await playwrightEngine.executeJobViaRealChrome(await db.getJobById(jobId), cdpPort || 9222); return true; });
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths.length > 0) { await db.setSetting('downloadsDir', result.filePaths[0]); if (playwrightEngine && typeof playwrightEngine.setDownloadsDir === 'function') playwrightEngine.setDownloadsDir(result.filePaths[0]); return result.filePaths[0]; }
    return null;
  });
  ipcMain.handle('settings:get-downloads-dir', async () => await db.getSetting('downloadsDir', null) || path.join(app.getPath('documents'), 'GrokStudio_Downloads'));
  ipcMain.handle('dialog:select-file', async (event, type) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: type === 'video' ? [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'webm'] }] : [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    return (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
  });
  ipcMain.handle('browser:check-login', async (event, profileId) => {
    const chromeStatus = checkLogin(profileId, profilesBaseDir); if (chromeStatus.isLoggedIn) return chromeStatus;
    try { const cookies = await session.fromPartition(profileId ? `persist:grok-${profileId}` : 'persist:grok').cookies.get({ url: 'https://grok.com' }); return { isLoggedIn: cookies.length > 0, cookieCount: cookies.length }; } catch (_) { return { isLoggedIn: false, cookieCount: 0 }; }
  });
  ipcMain.handle('browser:check-all-logins', async (event, profileIds) => {
    const result = {};
    for (const pid of (profileIds || [])) {
      const chromeStatus = checkLogin(pid, profilesBaseDir); if (chromeStatus.isLoggedIn) { result[pid] = chromeStatus; continue; }
      try { const cookies = await session.fromPartition(`persist:grok-${pid}`).cookies.get({ url: 'https://grok.com' }); result[pid] = { isLoggedIn: cookies.length > 0, cookieCount: cookies.length }; } catch (_) { result[pid] = { isLoggedIn: false, cookieCount: 0 }; }
    }
    return result;
  });

  ipcMain.handle('shell:open-folder', async (event, folderPath) => { await shell.openPath(folderPath); return true; });
  ipcMain.handle('shell:open-file', async (event, filePath) => { await shell.openPath(filePath); return true; });
  ipcMain.handle('shell:open-external', async (event, url) => { await shell.openExternal(url); return true; });

  // Mở thư mục Extension để khách cài vào Chrome
  ipcMain.handle('extension:open-folder', async () => {
    const extPath = app.isPackaged
        ? path.join(process.resourcesPath, 'FluxyExtension')
        : path.join(app.getAppPath(), 'FluxyExtension-main');
    if (fs.existsSync(extPath)) {
        await shell.openPath(extPath);
        return { success: true, path: extPath };
    }
    return { success: false, error: 'Không tìm thấy thư mục Extension: ' + extPath };
  });

  // ── AUDIO TO VIDEO ───────────────────────────────────────────────────────
  ipcMain.handle('dialog:select-audio-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio/Video', extensions: ['mp3','wav','ogg','flac','aac','m4a','mp4','mov','avi','mkv','webm'] }]
    });
    return (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
  });

  ipcMain.handle('file:write-text', async (event, { content, filePath }) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, filePath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('dialog:save-text-file', async (event, { content, filename, filePath }) => {
    // Nếu có filePath cụ thể → ghi thẳng, không mở dialog
    if (filePath) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return { success: true, filePath };
      } catch (e) { return { success: false, error: e.message }; }
    }
    // Không có filePath → mở dialog để user chọn nơi lưu
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename || 'export.txt',
      filters: [{ name: 'Text / SRT', extensions: ['txt','json','md','srt'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, filePath: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle('audio:prepare', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'File không tồn tại' };
      return new Promise((resolve) => {
        const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath];
        const proc = spawn(ffprobePath, args);
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.on('close', () => {
          try {
            const meta = JSON.parse(out);
            const duration = parseFloat(meta?.format?.duration || '0');
            resolve({ success: true, duration });
          } catch { resolve({ success: false, error: 'Không đọc được thông tin file' }); }
        });
        proc.on('error', e => resolve({ success: false, error: e.message }));
      });
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('audio:extract', async (event, filePath) => {
    const os = require('os');
    // Dùng MP3 32kbps mono 16kHz — cân bằng giữa kích thước và độ chính xác timestamp
    // MP3 có delay cố định (~26ms LAME encoder delay) → Gemini transcribe chính xác hơn OGG Vorbis 16kbps
    const tmpFile = path.join(os.tmpdir(), `fluxy_audio_${Date.now()}.mp3`);
    try {
      await new Promise((resolve, reject) => {
        const args = [
          '-y', '-i', filePath,
          '-vn',           // bỏ video
          '-ac', '1',      // mono
          '-ar', '16000',  // 16kHz (đủ cho speech recognition)
          '-ab', '32k',    // 32kbps (đủ chất lượng, file nhỏ)
          '-f', 'mp3',
          tmpFile
        ];
        const proc = spawn(ffmpegPath, args);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
        proc.on('error', reject);
      });
      const buf = fs.readFileSync(tmpFile);
      const base64 = buf.toString('base64');
      const compressedSize = buf.length;
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      return { success: true, base64, mimeType: 'audio/mp3', compressedSize };
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  // ── TRÍCH XUẤT 1 ĐOẠN AUDIO THEO THỜI GIAN (cho chunked transcribe) ──────
  ipcMain.handle('audio:extract-chunk', async (event, { filePath, startSec, durationSec }) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `fluxy_chunk_${Date.now()}.mp3`);
    try {
      await new Promise((resolve, reject) => {
        // -ss trước -i = fast seek (không chính xác tuyệt đối nhưng đủ cho từng chunk 60s)
        const args = [
          '-y',
          '-ss', String(startSec),
          '-t',  String(durationSec),
          '-i',  filePath,
          '-vn', '-ac', '1', '-ar', '16000', '-ab', '32k', '-f', 'mp3',
          tmpFile
        ];
        const proc = spawn(ffmpegPath, args);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
        proc.on('error', reject);
      });
      const buf = fs.readFileSync(tmpFile);
      const base64 = buf.toString('base64');
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      return { success: true, base64, mimeType: 'audio/mp3', size: buf.length };
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  // ── LƯU AUDIO ELEVENLABS (base64 → MP3 file) ───────────────────────────
  ipcMain.handle('elevenlabs:save-audio', async (event, { base64, outputPath }) => {
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(base64, 'base64');
      fs.writeFileSync(outputPath, buf);
      return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── ELEVENLABS SYSTEM KEYS & CREDIT ENGINE ──────────────────────────────────
  const EL_SYSTEM_KEYS = [
    'sk_d037e14dac611d20e11327f1fa9bb3fb5c27cfbd80bf0839','sk_e96fe3d85bdc6b8caf0ccf9f143b07155eaed2e815b559f6',
    'sk_f15662c3978c91d4234fef0236ac7e94fa370bef95f01319','sk_1a673e6a932eb6b2ef864be3f15e310112bbe985e65d623f',
    'sk_f8f50eb005b06c82ade5df44649c3f05252b12bb07df507b','sk_eae46467d7d0a6edde5d773033564b6e06232f318e5e742f',
    'sk_14e1d5b8fe08d672dcb79277ec22ddf011fe9e9e49123ed9','sk_6e86cf5b66cadee7d2b2584187793765b1619edabcddbcc8',
    'sk_cdbc5e74482ce108b3f9e203cd4c35922d94a8e30d1b7dfe','sk_cc143aaa5fd18068faeac92157a3513d5dabcaa9f3f59900',
    'sk_cfa9a6feb4f36553da20d5cf9bcffdd2f4dc909b7bdea8ce','sk_ebe0bf176bd93540a24546234de6bb10067c327b887a7238',
    'sk_7b406235a157afa15f7c469685256fd5f4a8ddc622aff5ff','sk_f7621f44bc5f2b456881920b9a5583ac554c35a17fd01479',
    'sk_86e30ff41a11c52d961c93772e233339a69d86fe43fb413e','sk_4a61632a9712f006e875f2510148badcbc3c098f8b48d963',
    'sk_e2ec63ea164df7eca6e965d199ee152d4c133a64ec72c403','sk_1f014e2023bd147ea52ec138ee084c1941af5670ba5c4a1f',
    'sk_94203b55be8a89a7c48f2771f63175758b43e8cf79b7280e','sk_00040874c98db0cb67e8faa0d72d5116f5306d675afea3c9',
    'sk_bdf8819bd53800d7f0fda482e7b246eb2981c87f2c9c21ca','sk_afc4dfce7dd74f4ce63cbe7892991b8a853582a81345e72c',
    'sk_d7eae2150bff94d394e140283a6a5b05d401aa1d1ae90971','sk_0f9ee8cec356de320ba1b510091dd7a774ec5f23bbd51764',
    'sk_fc145bac3a1ebfb07b715c04cfaffe676ab70dd6740be5ea','sk_09661224b4e8dc507986cd367bbcd747d1bef9a52987cb1b',
    'sk_65ae5d1a06f9f9ebbef392cfb791af1084ebd6fc3f4fb48c','sk_3e5e96831b0696385fd739460697bdbf27bd0cd3fe0ef38f',
    'sk_a5265e193c60c880c646a2c48bb8965e0bc9f1b84bc7f7af','sk_03e5e21649a8f2e5d4a9e5c38ba735dcec20fff6be00e531',
    'sk_60b6e43603bd2fdf63b1b829c664f305cc6d5e370104d199','sk_0527c0a61e1d789c07d1b1c0dc78811329acd7dbd7c56ab6',
    'sk_b5892aee12b316f37db1fdc040b26fc57fbca5a1ad460128','sk_9d2cfeb96512257d6e09fc48f17fef788c0e6f0b3d3302a6',
    'sk_882390ff21db573124b972419831bdd95859d76a36375242','sk_dc17e3723309f39d5ffbedab21134e6eb99389022d915682',
    'sk_bc4bb50537313b2b694cd10c5a419fd652fe948386f9bc49','sk_f690d80539ea8dc2202f268b3fce1f4a6074930006521c6a',
    'sk_a3a1921f552d81568787cb8a909c91a947fdb999191bd8cc','sk_68bf4cf20b8ce79f31f4f5102e0aba0ff7dad7ee6e8cf402',
    'sk_10d639d8591c8ecf462aa548e0a43e390f65ce95e0194e52','sk_2f80bf77abf0891badb7066fcb3b062ac536d33c60ff0280',
    'sk_c6fe2d4cdffb6dfdaca3d6f162811f31db7c665f7e65407e','sk_9bc9762f13628c319ba56513422dda21b1177cf91c1a43a3',
    'sk_74d98ebadc712f1e668aae97b8220160eb5868695f078cfe','sk_8880fcc48a9abe554b09f65662f16ea6525e60ff0fcd7b7b',
    'sk_42273599e2dd0daaed9bf92001af92487005591a1d6d7608','sk_eafb2af71f8eea507d3b0bb633f462dedc3a81c1f8d56c92',
    'sk_f057be4770423c7e1dac4ae3602ad35b00ed951a1549e693','sk_12532e4aa43bc7af83347ca5c120461ef407c3200bb905eb',
    'sk_a0c6595fc8486f87a4d5e6b49f05f7d52e43ce2048956393','sk_1f163e494ae0b5581240664d4270881fa6e7912b6cb8cad3',
    'sk_8ee77f142b9501a8f61eb33821ad829db26c0203d6edba3b','sk_0228f4d7604544ab13e2ea05cf6e08920e81049e7c9a44cf',
    'sk_0f958de1b3903e91ba0f10fe78da47d86a283037f1abf922','sk_2e62de1e16f717e78742fc7c798481635222f0510264a34b',
    'sk_38913e8947937470114dd16ef3f41490ae2781bc90287b7e','sk_fa46a73eb957611c9fa75a5bbc550b4b5cfe07adbac70670',
    'sk_3e1ded34f02216f7f3d516ec4f86c3ea2a9fe797b3bdb2ef','sk_a0266dd9c9c1fd8c7c7a93f35a1c234a5ee77414f10526ef',
    'sk_afd4e0782e4e129ba03ca3092d3be12c1ecd046dee865cfe','sk_1f5d8f4c8adb097a6f14ae711a8e1073ec887b561c136397',
    'sk_7eba821637e81e0bd008d9a26fc9d21cb12f97b0df730a00','sk_0b4f82e214a5e63b56f218821774f751c4bed96b3da9030a',
    'sk_3f348f55fd5c2b0fc00ea2f2ec64ce04800b7af50a96e066','sk_f4cbe2cd7771251ad518b9836aca78491a4d009342836fa7',
    'sk_e988e038e5e2022a2e349ad023f6389a1a2c1bb55f9accfa','sk_3f048376d8cf30a50356a9874b096b5c20ac0c76fffbdd3c',
    'sk_ab9be394b1e2f60f18bb755716626b4e4fa812570c61d8b8','sk_7d0082927da3e168783c6203a398048d4b9da102af661d95',
    'sk_4d1d8f560d866338df40981af9129101fc9abb3370800d35','sk_b16fe5f238085ecbacda135683fbc932a2c77ec59922db91',
    'sk_530bf88097c1b04c661bedbb18c08451dd4a8dfc5964ef7c','sk_617e68d5cafaa55ca44fec978700029dbab632299fa9918d',
    'sk_e3b723c8d2464f669e652e83f30c361bc5812052e458b30f','sk_24bd7f0d3d826b544385c88624be0575f697d8a9117c5175',
    'sk_75a8de0ff818c06cfae0fa674ab8becb39580a8e59346fbb','sk_224f4aa5620539d2c41cf979431f6073e550b39863bd2ccb',
    'sk_467e30bfa0d9cda0b9311b91349cf5bbde2c0abf976880d1','sk_cf53cc112b228d78396a867a3fc4526ddb85012586ad2acb',
    'sk_8dce7fc3ae3e40111440e190af0812b9cda067fc5f057929','sk_21c11db39ace231e3e6d206b03d01dedf50b1399c9cdd67e',
    'sk_6a0a2a27f4203ee4e1ad9f16b29ad66fb5dab65ed1249dd6','sk_e7fa34547491d3be584395babae49d79692e028e2c65109f',
    'sk_d072503a3e9349b537cd7f898fce46d003de3a6ad052fbfd','sk_c16b5b4f6a4c321e425ee862a7d51d4b2e7e3e2b63259210',
    'sk_352ba0f47bbc22b451736f148515bd1b37f91c9862fe619e','sk_a26bb7387bf1b8a9a7c18d5fdb56a4ab4d74a0ae98e6454e',
    'sk_e51d80d118db3b2fe70b67df44c94e4edc4b863458670a9c','sk_79ea5e0f42501b0d87437366c49f8cdf63ce29560d74d689',
    'sk_6a60edc0db0871374a5a3af427d40b405b9f7870ee61b813','sk_cec109257d83e2d1258bf2f8204049a6f3a5d3d020f675f0',
    'sk_fb2b17a6d6cdf7ab8e07bd0df043639b4913852d346f5175','sk_66fe52b8f216fe5b358ad2a4dc98a036d549b081275158de',
    'sk_ea77ef1b5e90901744d5c62354e2fe1c027326c0f90e5533','sk_8641d6b610c5c88136abf5748bf44991d3d0936888489e31',
    'sk_88c4126992f1f4b690f3dda8e6c233f323c9334ff92e1ed6','sk_7ced4dda255e840b3bb396fec146b4d4c5a9b7b1784a14c2',
    'sk_3942572ae27a6a14cdf94accce2b244f6fb1fd8d7537e4e3','sk_d6a46304510b82d8622680e0cbf38d2e5d98f693324f769f',
    'sk_55c7d5cb7a9dc358acecf71a99d13bd3d5ae67b500a5bdd7','sk_48e9780f54d33b0809ec696d0c8376f46e831c97a8781611',
    'sk_39a2fca79d27d2c059a36e954a37f8c591a68ca619dcc57c','sk_11e24b5d19bb0eb416ec77950497ace45036eafc80adb4f3',
    'sk_78b7f0c60629a0ceb4a7224ec64953de658e223e54c61235','sk_4294a2a216048b37d2efa8308f72a7285dd8a5cb786102ee',
    'sk_df739192f22fb1e3bb4df07e7ecd2c78595256568a448bbd','sk_96746fcb37b71822743f5c98a010f47322f7a7a58a8343c4',
    'sk_78f442702e635185c5d32fc77f2a99f65eb1ce24e91074f9','sk_d58bccef10687a5a3beaad344a0bae1844b8549b093de7b8',
    'sk_1b7e37a7cb59990b906ee2f1fa2e939c39ab401f71a74884','sk_fdb79186d9c238bef8efaa0f2833f0330a11c5b676cbd3a7',
    'sk_83b8270ef568fb7fbd680a2889fc0d375f39ef7b41573f10','sk_46115ab3e6139d20d877295b707fac1f84cb9ba819844b4a',
    'sk_155b5c4e4e2262e8fdebefbb0274e50345d135fb40662693','sk_733e64046f987b9ea27f037511a184e8e2df40bc904782fb',
    'sk_30fd717b6f2a57029fa4c17136dd8c72a69e2c06d1fa0037','sk_d442bb8a95e8c05ded0942661d90998f48d0dffaba0243c1',
    'sk_84bc9e2eff0381acfc907db71b5c58f543c6961c62683704','sk_29b439334aacfed288d0b00cee7f5b634f94ad4db1a35c8a',
    'sk_9ade568b3ad3098e7b9940a14ad35889fe200f8c42e09005','sk_8d9cf2b1ea68ccac22874aad31078a53eb1e4316f4febbf2',
    'sk_cd8ec329e2e7e808bc578f4c82d56dd7f81c48eb4b5e77e3','sk_84cc6626cfac0e72eb9efaf6a07e4f4a28eeb76bf914355d',
    'sk_ed314fee4dfe261d4761f2fa74eb2bdd6463669672e4547f','sk_d41d8656fe51f321876ba0e1dd2cfd16a1636850b3ef63b3',
    'sk_91a4f74bbbcff4e73a092342f9d92fdd9b102a82a9487785','sk_e4608af8857973835770e66a40deb7a0ff33d6b8b34b4916',
    'sk_485f6d0e6b6c669dced6902f9756fa235e7642c556a66dc0','sk_7eb53f480111a783b2067dcddebd0053ade4bdabafa7a8d8',
    'sk_f4150bb20ef3e0f567778bdcb7d5a7365bd0dcd5c14fde3a','sk_f1c09c9422513d9a2169e7182b3356056e4475884a22eb7f',
    'sk_6bde059b46bbc7261c3fd4b0cae336bec9bfc5e0c2d1e393','sk_8222856d91144fe3b104d6a7e7f79e3f91329f7d82e7028f',
    'sk_8f536d10c12cedd32813095526c6b74b00e136fd23d257dc','sk_d437cb91ff054dd7d06b155d99dbe9ed17082a8162b61682',
    'sk_86a36f1d54bf1e60030de24b256050938564ce1cadff7d0c','sk_203558d43877edf93295a07a1f0963d18cd936bc2e5fb821',
    'sk_c46372c5e99d7111eef0010642d746ecd56bc353bddfe7a5','sk_91575d10185ce87a13013bad701b9d7e727984e300ba39f9',
    'sk_6a7b164e0bbb07e418185c8baee5221ef26a48749c1566ab','sk_4278e2aeb94dd7c129161db9d12e3b0fcc72f5296726aed0',
    'sk_6d9ff0ada9f1a0a099a0fc7c886d13b40d48f335ef6c0c22','sk_885a0d2047112d8238c77f00d6152627ce312fce9e522f7f',
    'sk_e307db4d5e34c98d982efb9ae34ee70d9012c904e3834c43','sk_9a4a3c733d3e89bc55bed756f4c948de7afc3e625c800234',
    'sk_93c9e3aea346988d73afa1f59b8a53f12ac886106c0e2c8d','sk_9b0eba25ca8fb742e34b036617a58a2479ea67ef1d6aaa80',
    'sk_3f8f1044a0ca091af5062f0fd4a8c3ebdf1abd7085c3cd17','sk_ae4d4c20d51d9b844a5d5e6009588682d3c5416f8b74c6c9',
    'sk_a35db205472493fc5cecb9d275dc372810ea54b38b6da5c3','sk_6849d0bcb816fd7f9334f96125fd18b3f93614f21238d386',
    'sk_6658ba581a434edad6161d49d07dea9032177efaa3864149','sk_631be3914ef21de3c2c844ba4f0df74d111c6b8f19895043',
    'sk_b7891e678fd58b08098462d9e171de6ea376b93aa759909f','sk_046fd650e49dc996c886ec11bad147d37bfcb0265479258f',
    'sk_348d6d79fbf0a30440df6f545b5b7c06a9d852afc354b430','sk_f6f8709c16a9296d7d6184c5d3ba5aa7acd33802af14c696',
    'sk_7e55a1e76faadd08c784a3b86d2286c1ed1ba3c1c0fab222','sk_dbafc436c08a16c8ce5a9738252ff988ec8bfac1adcd27e5',
    'sk_a0c9983897e7d5f6f269dcf5275dafab863b6e32513ac55d','sk_2867bbf3fd42c88a295c5637d92afb3df6a67e837b5116a4',
    'sk_db1f9a650db662cac2d59b268f0cae87b9592a317a459e43','sk_0f453ab7dc6a02ff8259e022a0adb3763642b8dab484bc1b',
    'sk_8586b65ba3434297c20974423107557f7d6d0270543a5a8c','sk_6d229a728823d0ae84efc5f96bdf3269547b9045eb3e7988',
    'sk_44556565a60c4240dcec278c98f17b325ae8fdb9d9a36887','sk_ea4d10a48af609d3409bbf4c2ff611c2bce024a3469bd17c',
    'sk_dbb6eb588c203b3a2aca276b4224b0a4d912f8136d0205a3','sk_8a3a717889b9b66b3a6af353ce66cc32178f9d45ad4cbb0c',
    'sk_6680588d5098a6d9afa6a96815c6c2b0bc0c10f7ae85c659','sk_122535967065fd2b5e97914f68f9bcebce88855cfd2b73cc',
    'sk_d804ed96a1424091ce4f38abbe55d56f14c647e82ba34bc2','sk_058480f9ed5af05e442b939931543ae8e207532115f46bf4',
    'sk_6222d50bb99504afc8b4a3803429d22a37b71e4bd82a3ace','sk_de23d9cc3c2566cd00a25258a8a584265450f923a10b2e13',
    'sk_8f848a12001fe3c290948296b70b7deb1755dc839caed115','sk_ec2177a5f5da603eab6ca36c3e77a3e1075364c8bd2f7915',
    'sk_cd945f532ad8ca0b9b9ce56117a4a9fdb60ad044413a2424','sk_41107340b1d28ae4ffac6ca06ad8a1dc7569486f971aabef',
    'sk_672897ef3625b928183493fc0850169c208060874b031a1f','sk_e6703ce2ee05f8693951154031f2cbf8acebef03c4f4c419',
    'sk_8e7f2592b68eb3090460ebd7a8934246821b03ff0d79d746','sk_393100b893533550a7d70de675d6e7500be20b8baf45e1ab',
    'sk_6c859d1758db2ac6028d7c5f8f8c089bed44a0b102a590b2','sk_687485fb0415c4a00de4a7ef4d804693d41039e732f5510b',
    'sk_bf863320b5098d953fd280161faf32e701edd653a3827cbe','sk_c63ccb692d7c39a5fab07f0b58130a72a9d3d80e007aa6b0',
    'sk_9739cfb132777a195124d6d5a0b7b658d4f4283f1fa5a7f0','sk_ddf9d4f9c904c2a6c1e68774adca653d1a6a5d38d03a5d8f',
    'sk_cf6e558566f49d9787d8004c80eaf2f8f0ee90e717485987','sk_ec983f93a7a97421c502521702eb3369a3f58cc814a51f7a',
    'sk_221411cbf1ea9252c44660bb32f84217bdd6885a8e7b8226','sk_adc439aac937c16e38707bd7ca84eade1774bc189b58e84d',
    'sk_1e9fa4e4b159091c910b09403ce3fcb1bfa68b72793b0b4b','sk_ee0f028ae1e026af241c3feea9559ca59d429b3f4ceca073',
    'sk_6dec0972883302f4cdbc6af3cd25104fb63484aabf98527e','sk_1c45c5a7c471bac4eac2581e8c69fda53f2dd7de1096166e',
    'sk_7092012ca634f46593c74a72d4346fcd272ddcc9ffb94f37','sk_a8656f20309c4d6eecaade57f9defc770decf644e482981d',
    'sk_d776e017d922507d8ff689a8d5b3fc2c58c0763f4b95a178','sk_fd5af6041400c8ce20625ceae7b6564b044f9b62b788a13f',
    'sk_3b33f69656d0fd2186ff32fef48c8d4e78bb726d0019b615','sk_2c50d0d7b7de68ee9552f132078299c60857d72e4d5c4f95',
    'sk_f03aef235a01117214bdd14da346867451a4fb3c86dc1752','sk_470487decf99ff168df92fa8b3ea9202fecf3702eed2d441',
    'sk_af44e794525fba164fbfb211045e8ffc29713dc12bc70329','sk_70987ca1d4b306c82753ef817cc68a92c942b71e0d9ce6ac',
    'sk_f56c46da9ef89dd4a37daf6e90c92f259b2242456424b97a','sk_66072d7dba388ffc56fb9a7de4266cfab73e425a4ca1cd67',
    'sk_8a0eed19236b1febd3f9b946dcc2f12ffbad9e61f813d6b5','sk_ed09351f61d50ce89d9298cd55d3e2f1f6c6bef9d5365528',
    'sk_071b51d68ab54d2956a1bfd58f56fb24088cff175d2bd156','sk_a9e371c9b1cd2baea5194710bd084dd1310224f532224601',
    'sk_2e853e6cbc287f348866506286d37f54267007fe9e23ef4c','sk_5e8aedba2945df108867fe647d5007c4bbf6c7f12e74a2e6',
    'sk_26c1dfb8f278912199ffcc16ae13313f443b9fa6a1912744','sk_fd3118cd57e168ba3001f0eb13f7469c38e36825b8ce79dd',
    'sk_3e41753911c8b307c35b7d6b1c76a0ba7c6a192bcc6e9ba7','sk_ae070444f1c657fdb384817048c6e4bff5f9e3ba7c43cc9e',
    'sk_5fb828864cfac06384cce8e8305eb8dfb687f0a214234cce','sk_a87bdb2722e0dacf768a0d45d0070a6da4373d44b2e495e3',
    'sk_7e79156966b5f008f8b0a56afc0c4a118de68e13d2e531d3','sk_dcde842f2e8d73582ddbd68d0b202f47ce892ba01ca68258',
    'sk_8dfe3100482e8d532e1d07357489ac92f76cd812f63072d7','sk_6a2364fcb63bd88b58ebc103361c602634b4023c80bc4838',
    'sk_6a3e25eb0de1a304a5d596ac593c5162ad6093ec9619da5e','sk_fcad7ef5d5f78892134a6e893d1a906a2a9a358873847a7d',
    'sk_51700ac14d96715d3ab7f8faad920530eced4ac15d9f78d1','sk_9265a9071f6f9a76ac86aedc1ec82ec8cdd673c96c368e9f',
    'sk_bb3bd7f203648f30bc2421531cfa3f64a9b740a511a08950',
  ].filter((k, i, a) => k && a.indexOf(k) === i); // deduplicate

  const elKeyCache = new Map(); // key → {remaining, limit, status, lastChecked}
  const EL_CACHE_TTL = 55 * 60 * 1000; // 55 phút
  const EL_SCAN_DATE_FILE = path.join(app.getPath('userData'), 'el_scan_date.json');
  function elIsScannedToday() {
    try {
      if (fs.existsSync(EL_SCAN_DATE_FILE)) {
        const d = JSON.parse(fs.readFileSync(EL_SCAN_DATE_FILE, 'utf8'));
        return d.date === new Date().toISOString().slice(0, 10);
      }
    } catch (_) {}
    return false;
  }
  function elSaveScanDate() {
    try { fs.writeFileSync(EL_SCAN_DATE_FILE, JSON.stringify({ date: new Date().toISOString().slice(0, 10) }), 'utf8'); } catch (_) {}
  }

  // ── Voice log sender ──────────────────────────────────────────────────────
  const sendVoiceLog = (text, type = 'info') => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice-log', { time: new Date().toLocaleTimeString(), text, type });
    }
  };

  async function elCheckSingleKey(key, force = false) {
    const cached = elKeyCache.get(key);
    if (!force && cached && Date.now() - cached.lastChecked < EL_CACHE_TTL) return cached;
    try {
      // 1. Kiểm tra subscription lấy thông tin credit
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': key }, signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) {
        const d = { remaining: 0, limit: 0, status: 'invalid', lastChecked: Date.now() };
        elKeyCache.set(key, d); return d;
      }
      const sub = await res.json();
      const remaining = (sub.character_limit || 0) - (sub.character_count || 0);
      if (remaining <= 0) {
        const d = { remaining: 0, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'quota', lastChecked: Date.now() };
        elKeyCache.set(key, d); return d;
      }
      // 2. Lấy danh sách voice của chính key này (không dùng voice cố định)
      let testVoiceId = null;
      try {
        const vCtrl = new AbortController();
        const vt = setTimeout(() => vCtrl.abort(), 9000);
        const vRes = await fetch('https://api.elevenlabs.io/v1/voices?page_size=1', {
          headers: { 'xi-api-key': key }, signal: vCtrl.signal
        });
        clearTimeout(vt);
        if (!vRes.ok) {
          // Key không truy cập được API voices → invalid
          const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'invalid', lastChecked: Date.now() };
          elKeyCache.set(key, d); return d;
        }
        const vData = await vRes.json();
        testVoiceId = vData.voices && vData.voices[0]?.voice_id || null;
      } catch (_) { /* bỏ qua lỗi mạng khi lấy voices, dùng fallback */ }
      if (!testVoiceId) {
        // Không lấy được voice → không thể xác nhận, đánh dấu invalid để an toàn
        const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'invalid', lastChecked: Date.now() };
        elKeyCache.set(key, d); return d;
      }
      // 3. Thử TTS 1 ký tự với voice thực của account này
      const ttsCtrl = new AbortController();
      const tt = setTimeout(() => ttsCtrl.abort(), 15000);
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${testVoiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', 'accept': 'audio/mpeg' },
        body: JSON.stringify({ text: '.', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: false } }),
        signal: ttsCtrl.signal
      });
      clearTimeout(tt);
      if (!ttsRes.ok) {
        const st = ttsRes.status === 429 ? 'quota' : 'invalid';
        const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: st, lastChecked: Date.now() };
        elKeyCache.set(key, d); return d;
      }
      // TTS thành công → key thực sự hoạt động
      const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'valid', lastChecked: Date.now() };
      elKeyCache.set(key, d); return d;
    } catch (e) {
      const d = { remaining: 0, limit: 0, status: 'error', lastChecked: Date.now() };
      elKeyCache.set(key, d); return d;
    }
  }

  // Lấy key tốt nhất (ưu tiên nhiều credit nhất, bỏ qua excludeKeys)
  async function elGetBestKey(userKeys = [], excludeKeys = new Set()) {
    // 1. Lấy từ cache: valid + còn credit + chưa hết hạn
    const allKeys = [...EL_SYSTEM_KEYS, ...userKeys.map(k => k.key || k)];
    const fromCache = allKeys
      .filter(k => !excludeKeys.has(k))
      .map(k => ({ key: k, info: elKeyCache.get(k) }))
      .filter(({ info }) => info && info.status === 'valid' && info.remaining > 100 && Date.now() - info.lastChecked < EL_CACHE_TTL)
      .sort((a, b) => b.info.remaining - a.info.remaining);
    if (fromCache.length > 0) return fromCache[0].key;
    // 2. Quét batch 20 key system chưa check
    const unchecked = EL_SYSTEM_KEYS.filter(k => !elKeyCache.has(k) && !excludeKeys.has(k)).slice(0, 20);
    if (unchecked.length > 0) {
      await Promise.allSettled(unchecked.map(k => elCheckSingleKey(k)));
      const fresh = EL_SYSTEM_KEYS
        .filter(k => !excludeKeys.has(k))
        .map(k => ({ key: k, info: elKeyCache.get(k) }))
        .filter(({ info }) => info && info.status === 'valid' && info.remaining > 100)
        .sort((a, b) => b.info.remaining - a.info.remaining);
      if (fresh.length > 0) return fresh[0].key;
    }
    // 3. Re-check key hết hạn cache
    const stale = EL_SYSTEM_KEYS.filter(k => {
      const c = elKeyCache.get(k);
      return c && Date.now() - c.lastChecked >= EL_CACHE_TTL && !excludeKeys.has(k);
    }).slice(0, 25);
    if (stale.length > 0) {
      await Promise.allSettled(stale.map(k => elCheckSingleKey(k)));
      const refreshed = EL_SYSTEM_KEYS
        .filter(k => !excludeKeys.has(k))
        .map(k => ({ key: k, info: elKeyCache.get(k) }))
        .filter(({ info }) => info && info.status === 'valid' && info.remaining > 100)
        .sort((a, b) => b.info.remaining - a.info.remaining);
      if (refreshed.length > 0) return refreshed[0].key;
    }
    // 4. Fallback: user keys
    const validUser = userKeys.find(k => !excludeKeys.has(k.key || k) && (k.status === 'valid' || !k.status) && (k.remaining || 0) > 0);
    if (validUser) return validUser.key || validUser;
    return null;
  }

  ipcMain.handle('elevenlabs:system-status', () => {
    const total = EL_SYSTEM_KEYS.length;
    const scanned = EL_SYSTEM_KEYS.filter(k => elKeyCache.has(k)).length;
    const valid = EL_SYSTEM_KEYS.filter(k => { const c = elKeyCache.get(k); return c && c.status === 'valid' && c.remaining > 0; }).length;
    const totalRemaining = EL_SYSTEM_KEYS.reduce((s, k) => { const c = elKeyCache.get(k); return s + (c?.remaining || 0); }, 0);
    return { total, scanned, valid, totalRemaining };
  });

  ipcMain.handle('elevenlabs:scan-credits', async (event) => {
    const BATCH = 12;
    for (let i = 0; i < EL_SYSTEM_KEYS.length; i += BATCH) {
      const batch = EL_SYSTEM_KEYS.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(k => elCheckSingleKey(k, true))); // force=true: bỏ qua cache, test lại hoàn toàn
      const done = Math.min(i + BATCH, EL_SYSTEM_KEYS.length);
      try { event.sender.send('el-scan-progress', done, EL_SYSTEM_KEYS.length); } catch (_) {}
      if (i + BATCH < EL_SYSTEM_KEYS.length) await new Promise(r => setTimeout(r, 300));
    }
    elSaveScanDate();
    const valid = EL_SYSTEM_KEYS.filter(k => { const c = elKeyCache.get(k); return c && c.status === 'valid' && c.remaining > 0; }).length;
    const totalRemaining = EL_SYSTEM_KEYS.reduce((s, k) => { const c = elKeyCache.get(k); return s + (c?.remaining || 0); }, 0);
    return { total: EL_SYSTEM_KEYS.length, scanned: EL_SYSTEM_KEYS.length, valid, totalRemaining };
  });

  ipcMain.handle('elevenlabs:should-auto-scan', () => !elIsScannedToday());

  ipcMain.handle('elevenlabs:read-keys-file', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
        title: 'Chọn file chứa API keys ElevenLabs (mỗi key 1 dòng)'
      });
      if (result.canceled || !result.filePaths[0]) return { success: false, keys: [] };
      const content = fs.readFileSync(result.filePaths[0], 'utf8');
      const keys = [...new Set(content.split(/[\r\n,;\s]+/).map(k => k.trim()).filter(k => k.startsWith('sk_') && k.length > 20))];
      return { success: true, keys };
    } catch (e) { return { success: false, keys: [], error: e.message }; }
  });

  // ── Hàm TTS dùng chung (ElevenLabs, key rotation không giới hạn) ──────────
  async function doElevenLabsTTS(text, voiceId, stability, similarity, style, userKeys, logFn) {
    const log = (msg, type = 'info') => { if (logFn) logFn(msg, type); sendVoiceLog(msg, type); };
    const triedKeys = new Set();
    let attempt = 0;
    let invalidCount = 0, quotaCount = 0, networkCount = 0, otherCount = 0;
    // Thử liên tục cho đến khi hết key hoặc gặp lỗi nội dung (422)
    while (true) {
      const bestKey = await elGetBestKey(userKeys || [], triedKeys);
      if (!bestKey) break; // hết key khả dụng
      triedKeys.add(bestKey);
      attempt++;
      const keyTag = `[${bestKey.substring(0,8)}...]`;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 90000);
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': bestKey, 'Content-Type': 'application/json', 'accept': 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: (stability||50)/100, similarity_boost: (similarity||75)/100, style: (style||0)/100, use_speaker_boost: true } }),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) {
          const cached = elKeyCache.get(bestKey) || {};
          if (res.status === 401) {
            elKeyCache.set(bestKey, { ...cached, status: 'invalid', remaining: 0, lastChecked: Date.now() });
            log(`⚠️ Key ${keyTag} không hợp lệ (401) → chuyển key tiếp...`, 'warn');
            invalidCount++; continue;
          }
          if (res.status === 429) {
            elKeyCache.set(bestKey, { ...cached, status: 'quota', remaining: 0, lastChecked: Date.now() });
            log(`⚠️ Key ${keyTag} hết quota (429) → chuyển key tiếp...`, 'warn');
            quotaCount++; continue;
          }
          if (res.status === 422) {
            const errText = await res.text().catch(() => '');
            const msg = `Lỗi nội dung văn bản (422): ${errText.substring(0, 200)}`;
            log(`❌ ${msg}`, 'error');
            return { success: false, error: msg };
          }
          const errText = await res.text().catch(() => '');
          log(`⚠️ Key ${keyTag} HTTP ${res.status} → chuyển key tiếp...`, 'warn');
          otherCount++; continue;
        }
        // ✅ Thành công
        const arrayBuf = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString('base64');
        const c = elKeyCache.get(bestKey);
        if (c) elKeyCache.set(bestKey, { ...c, remaining: Math.max(0, c.remaining - text.length) });
        const isSys = EL_SYSTEM_KEYS.includes(bestKey);
        const retryNote = attempt > 1 ? ` (thử ${attempt} key)` : '';
        const keyInfo = `${isSys ? '🔑 Hệ thống' : '👤 Cá nhân'} ${keyTag}${retryNote}`;
        log(`✅ Thành công · ${keyInfo}`, 'success');
        return { success: true, base64, keyInfo };
      } catch (e) {
        log(`⚠️ Key ${keyTag} lỗi mạng: ${e.message} → chuyển key tiếp...`, 'warn');
        networkCount++; continue;
      }
    }
    // Tất cả key đã thử hết
    const parts = [];
    if (invalidCount) parts.push(`${invalidCount} hết hạn`);
    if (quotaCount) parts.push(`${quotaCount} hết quota`);
    if (networkCount) parts.push(`${networkCount} lỗi mạng`);
    if (otherCount) parts.push(`${otherCount} lỗi khác`);
    const errMsg = `Đã thử ${attempt} key${parts.length ? ` (${parts.join(', ')})` : ''} — không có key nào thành công.`;
    log(`❌ ${errMsg}`, 'error');
    return { success: false, error: errMsg };
  }

  ipcMain.handle('elevenlabs:tts', async (event, { text, voiceId, stability, similarity, style, userKeys }) => {
    return await doElevenLabsTTS(text, voiceId, stability, similarity, style, userKeys);
  });

  // ElevenLabs TTS với SRT timing + tự động tăng tốc độ + log đầy đủ
  ipcMain.handle('elevenlabs:tts-srt', async (event, { segments, voiceId, stability, similarity, style, userKeys, outputPath }) => {
    const tempDir = path.join(app.getPath('temp'), `grok_el_srt_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const sendProg = (done, total, txt) => {
      if (mainWindow) mainWindow.webContents.send('tts-srt-progress', { done, total, text: txt });
    };
    sendVoiceLog(`⚡ [ElevenLabs] Bắt đầu SRT — ${segments.length} đoạn`, 'info');
    try {
      const timedSegs = [];
      let lastKeyInfo = '';
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        sendProg(i, segments.length, `ElevenLabs: đoạn ${i + 1}/${segments.length}...`);
        sendVoiceLog(`  ▶ Đoạn ${i + 1}/${segments.length}: "${seg.text.substring(0, 50)}${seg.text.length > 50 ? '...' : ''}"`, 'info');
        // Dùng chung doElevenLabsTTS — đã có key rotation, retry, log chi tiết
        const ttsResult = await doElevenLabsTTS(seg.text, voiceId, stability, similarity, style, userKeys);
        if (!ttsResult.success) throw new Error(`Đoạn ${i + 1}: ${ttsResult.error}`);
        lastKeyInfo = ttsResult.keyInfo || lastKeyInfo;
        const rawPath = path.join(tempDir, `seg_${i}_raw.mp3`);
        const finalPath = path.join(tempDir, `seg_${i}_final.mp3`);
        fs.writeFileSync(rawPath, Buffer.from(ttsResult.base64, 'base64'));
        const audioDurSec = await getTTSAudioDuration(rawPath);
        const slotDurSec = (seg.endMs - seg.startMs) / 1000;
        if (audioDurSec > 0 && slotDurSec > 0 && audioDurSec > slotDurSec * 1.05) {
          const ratio = Math.min(audioDurSec / slotDurSec, 3.0);
          sendVoiceLog(`  ⚡ Tăng tốc đoạn ${i + 1}: ${audioDurSec.toFixed(2)}s → ${slotDurSec.toFixed(2)}s (x${ratio.toFixed(2)})`, 'warn');
          await adjustTTSSpeed(rawPath, finalPath, ratio);
          timedSegs.push({ path: finalPath, startMs: seg.startMs });
        } else {
          fs.copyFileSync(rawPath, finalPath);
          timedSegs.push({ path: finalPath, startMs: seg.startMs });
        }
      }
      sendProg(segments.length, segments.length, 'Đang ghép audio...');
      sendVoiceLog(`🔗 Ghép ${timedSegs.length} đoạn audio...`, 'info');
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await mergeTimedAudioSegments(timedSegs, outputPath);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      sendVoiceLog(`✅ [ElevenLabs] Đã lưu: ${outputPath}`, 'success');
      return { success: true, path: outputPath, keyInfo: lastKeyInfo };
    } catch (e) {
      sendVoiceLog(`❌ [ElevenLabs] Lỗi: ${e.message}`, 'error');
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('elevenlabs:get-voices', async (event, userKeys) => {
    const bestKey = await elGetBestKey(userKeys || []);
    if (!bestKey) return { success: false, error: 'Không có key hợp lệ' };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': bestKey }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { success: true, voices: data.voices || [] };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── ZALO TTS ENGINE ──────────────────────────────────────────────────────────
  const ZALO_TTS_ENDPOINT = 'https://api.zalo.ai/v1/tts/synthesize';

  async function doZaloTTS(text, speakerId, speed, apiKey) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    const body = new URLSearchParams({
      input: text,
      speaker_id: speakerId.toString(),
      speed: (speed || 1).toString(),
      encode_type: '0'
    });
    const res = await fetch(ZALO_TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error_code !== 0) {
      const err = new Error(data.error_message || `Lỗi Zalo TTS: ${data.error_code}`);
      err.code = data.error_code;
      throw err;
    }
    const audioUrl = data.data?.url;
    if (!audioUrl) throw new Error('Không nhận được URL audio từ Zalo TTS');
    const audioCtrl = new AbortController();
    const at = setTimeout(() => audioCtrl.abort(), 30000);
    const audioRes = await fetch(audioUrl, { signal: audioCtrl.signal });
    clearTimeout(at);
    if (!audioRes.ok) throw new Error(`Tải audio Zalo thất bại: ${audioRes.status}`);
    return Buffer.from(await audioRes.arrayBuffer());
  }

  ipcMain.handle('zalotts:preview', async (_e, { speakerId, apiKey }) => {
    try {
      const previewTexts = {
        '1': 'Xin chào, tôi là giọng Nữ miền Bắc.',
        '2': 'Xin chào, tôi là giọng Nam miền Bắc.',
        '3': 'Xin chào, tôi là giọng Nữ miền Nam.',
        '4': 'Xin chào, tôi là giọng Nam miền Nam.',
        '5': 'Xin chào, tôi là giọng Nữ miền Trung.',
      };
      const text = previewTexts[String(speakerId)] || 'Xin chào';
      const buf = await doZaloTTS(text, speakerId, 1.0, apiKey);
      return { success: true, base64: buf.toString('base64') };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('zalotts:check-key', async (event, key) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const body = new URLSearchParams({ input: 'xin chào', speaker_id: '1', speed: '1', encode_type: '0' });
      const res = await fetch(ZALO_TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'apikey': key, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      if (data.error_code === 0) return { valid: true };
      if (data.error_code === -14 || data.error_code === 14) return { valid: false, quota: true, error: 'Hết hạn mức tháng này' };
      return { valid: false, error: data.error_message || `Lỗi ${data.error_code}` };
    } catch (e) { return { valid: false, error: e.message }; }
  });

  ipcMain.handle('zalotts:generate', async (event, { text, speakerId, speed, apiKey, outputPath }) => {
    try {
      sendVoiceLog(`🔵 [Zalo TTS] Bắt đầu · ${text.length} ký tự · giọng ID: ${speakerId}`, 'info');
      const buf = await doZaloTTS(text, speakerId, speed, apiKey);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, buf);
      sendVoiceLog(`✅ [Zalo TTS] Đã lưu: ${outputPath}`, 'success');
      return { success: true, path: outputPath };
    } catch (e) {
      sendVoiceLog(`❌ [Zalo TTS] Lỗi: ${e.message}`, 'error');
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('zalotts:generate-srt', async (event, { segments, speakerId, speed, apiKey, outputPath }) => {
    const tempDir = path.join(app.getPath('temp'), `grok_zalo_srt_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const sendProg = (done, total, txt) => {
      if (mainWindow) mainWindow.webContents.send('zalo-srt-progress', { done, total, text: txt });
    };
    sendVoiceLog(`🔵 [Zalo TTS] Bắt đầu SRT — ${segments.length} đoạn`, 'info');
    try {
      const timedSegs = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        sendProg(i, segments.length, `Zalo TTS: đoạn ${i + 1}/${segments.length}...`);
        sendVoiceLog(`  ▶ Đoạn ${i + 1}/${segments.length}: "${seg.text.substring(0, 50)}${seg.text.length > 50 ? '...' : ''}"`, 'info');
        const rawPath = path.join(tempDir, `seg_${i}_raw.mp3`);
        const finalPath = path.join(tempDir, `seg_${i}_final.mp3`);
        const buf = await doZaloTTS(seg.text, speakerId, speed, apiKey);
        fs.writeFileSync(rawPath, buf);
        const audioDurSec = await getTTSAudioDuration(rawPath);
        const slotDurSec = (seg.endMs - seg.startMs) / 1000;
        if (audioDurSec > 0 && slotDurSec > 0 && audioDurSec > slotDurSec * 1.05) {
          const ratio = Math.min(audioDurSec / slotDurSec, 3.0);
          sendVoiceLog(`  ⚡ Tăng tốc đoạn ${i + 1}: x${ratio.toFixed(2)}`, 'warn');
          await adjustTTSSpeed(rawPath, finalPath, ratio);
          timedSegs.push({ path: finalPath, startMs: seg.startMs });
        } else {
          fs.copyFileSync(rawPath, finalPath);
          timedSegs.push({ path: finalPath, startMs: seg.startMs });
        }
      }
      sendProg(segments.length, segments.length, 'Đang ghép audio...');
      sendVoiceLog(`🔗 [Zalo TTS] Ghép ${timedSegs.length} đoạn...`, 'info');
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await mergeTimedAudioSegments(timedSegs, outputPath);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      sendVoiceLog(`✅ [Zalo TTS] Đã lưu: ${outputPath}`, 'success');
      return { success: true, path: outputPath };
    } catch (e) {
      sendVoiceLog(`❌ [Zalo TTS] Lỗi: ${e.message}`, 'error');
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: e.message };
    }
  });

  // ── LƯU AUDIO MP3 TỪ VIDEO ─────────────────────────────────────────────
  ipcMain.handle('video:save-audio', async (event, { inputPath, outputFolder, outputPath: customOutputPath }) => {
    try {
      if (!fs.existsSync(inputPath)) return { success: false, error: 'File nguồn không tồn tại' };
      const outFile = customOutputPath || (() => {
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
        const baseName = path.basename(inputPath, path.extname(inputPath));
        return path.join(outputFolder, `${baseName}_audio_goc.mp3`);
      })();
      const outDir = path.dirname(outFile);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const args = ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-ar', '44100', '-ab', '192k', '-ac', '2', outFile];
      const result = await new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => resolve({ ok: code === 0, stderr }));
        proc.on('error', e => resolve({ ok: false, stderr: e.message }));
      });
      if (!result.ok) return { success: false, error: result.stderr.slice(-300) };
      return { success: true, filePath: outFile };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── VIRAL VIDEO AI ───────────────────────────────────────────────────────
  ipcMain.handle('viral:create-proxy', async (event, videoPath) => {
    try {
      if (!fs.existsSync(videoPath)) return { success: false, error: 'File không tồn tại' };
      const tmpDir = require('os').tmpdir();
      const proxyPath = path.join(tmpDir, `viral_proxy_${Date.now()}.mp4`);
      const args = ['-y', '-i', videoPath, '-vf', "scale='min(iw,320)':-2", '-vcodec', 'libx264', '-crf', '32', '-preset', 'ultrafast', '-acodec', 'aac', '-b:a', '32k', '-t', '600', proxyPath];
      const result = await runFFmpeg(args);
      if (!result.ok || !fs.existsSync(proxyPath)) return { success: false, error: 'Không thể tạo proxy: ' + result.stderr.slice(-200) };
      const base64 = fs.readFileSync(proxyPath).toString('base64');
      fs.unlinkSync(proxyPath);
      return { success: true, base64 };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('viral:cut-segment', async (event, { inputPath, startTime, endTime, outputFolder, index, aspectRatio }) => {
    try {
      if (!fs.existsSync(inputPath)) return { success: false, error: 'File nguồn không tồn tại' };
      if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
      const outputPath = path.join(outputFolder, `viral_short_${index + 1}.mp4`);
      const cropFilter = aspectRatio === '1:1'
        ? "crop='min(iw,ih):min(iw,ih):(iw-min(iw,ih))/2:(ih-min(iw,ih))/2'"
        : aspectRatio === '16:9'
        ? "crop='if(gt(iw/ih,16/9),ih*16/9,iw):if(gt(iw/ih,16/9),ih,iw*9/16):(iw-if(gt(iw/ih,16/9),ih*16/9,iw))/2:(ih-if(gt(iw/ih,16/9),ih,iw*9/16))/2'"
        : "crop='ih*9/16:ih:(iw-ih*9/16)/2:0'";
      const args = ['-y', '-i', inputPath, '-ss', String(startTime), '-to', String(endTime), '-vf', cropFilter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '128k', outputPath];
      const result = await runFFmpeg(args);
      if (!result.ok || !fs.existsSync(outputPath)) return { success: false, error: 'FFmpeg lỗi: ' + result.stderr.slice(-300) };
      return { success: true, outputPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── OMNIVOICE BACKEND AUTO-START ───────────────────────────────────────────
  const sendOvLog = (text, type = 'info') => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('omnivoice-log', { time: new Date().toLocaleTimeString(), text, type });
    }
  };

  // Đường dẫn mặc định: trong thư mục tool (cạnh file exe hoặc trong app folder dev)
  function getDefaultOvDir() {
    if (app.isPackaged) {
      // Packaged: cạnh file exe, thư mục OmniVoice-Studio-main
      return path.join(path.dirname(app.getPath('exe')), 'OmniVoice-Studio-main');
    }
    // Dev mode: trong project grok folder
    return path.join(app.getAppPath(), 'OmniVoice-Studio-main');
  }

  // Tìm uv ở các vị trí cài đặt phổ biến trên Windows/Mac/Linux
  function findUvExecutable() {
    const h  = process.env.USERPROFILE || process.env.HOME || '';
    const ad = process.env.APPDATA  || '';
    const la = process.env.LOCALAPPDATA || '';

    // Đọc PATH từ registry Windows (user PATH, không bị giới hạn bởi Electron env)
    const registryPaths = [];
    try {
      const { execSync } = require('child_process');
      const regOut = execSync('reg query "HKCU\\Environment" /v PATH 2>nul', { encoding: 'utf8', timeout: 3000 });
      const match = regOut.match(/PATH\s+REG(?:_EXPAND)?_SZ\s+(.+)/i);
      if (match) {
        const regPathStr = match[1].trim();
        // Expand %USERPROFILE%, %APPDATA%, etc.
        const expanded = regPathStr
          .replace(/%USERPROFILE%/gi, h)
          .replace(/%APPDATA%/gi, ad)
          .replace(/%LOCALAPPDATA%/gi, la);
        for (const p of expanded.split(';')) {
          const t = p.trim();
          if (t) registryPaths.push(path.join(t, 'uv.exe'), path.join(t, 'uv'));
        }
      }
    } catch (_) {}

    const candidates = [
      ...registryPaths,                              // từ registry PATH
      path.join(h, '.local', 'bin', 'uv.exe'),      // official uv installer (Windows)
      path.join(h, '.local', 'bin', 'uv'),           // official uv installer (Linux/Mac)
      path.join(ad,  'uv', 'bin', 'uv.exe'),        // uv AppData\Roaming
      path.join(la,  'uv', 'bin', 'uv.exe'),        // uv AppData\Local
      path.join(h, '.cargo', 'bin', 'uv.exe'),      // cargo install
      path.join(h, '.cargo', 'bin', 'uv'),
      // Python Scripts thư mục — nếu pip install uv
      path.join(la, 'Programs', 'Python', 'Python312', 'Scripts', 'uv.exe'),
      path.join(la, 'Programs', 'Python', 'Python311', 'Scripts', 'uv.exe'),
      path.join(la, 'Programs', 'Python', 'Python310', 'Scripts', 'uv.exe'),
      '/usr/local/bin/uv',
      '/opt/homebrew/bin/uv',
      '/usr/bin/uv',
    ].filter(Boolean);

    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
    return null;
  }

  // Đọc pyvenv.cfg để lấy đường dẫn Python gốc (bỏ qua uv shim)
  function readVenvHomePython(venvDir) {
    try {
      const cfgPath = path.join(venvDir, 'pyvenv.cfg');
      if (!fs.existsSync(cfgPath)) return null;
      const cfg = fs.readFileSync(cfgPath, 'utf8');
      const homeMatch = cfg.match(/^home\s*=\s*(.+)$/im);
      if (!homeMatch) return null;
      const home = homeMatch[1].trim();
      const candidates = [
        path.join(home, 'python.exe'),  // Windows
        path.join(home, 'python3'),     // Mac/Linux
        path.join(home, 'python'),      // Linux
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } catch (_) {}
    return null;
  }

  // Chọn lệnh khởi động: ưu tiên uvicorn.exe từ .venv (fully venv-aware), fallback nhiều cấp
  function resolveStartCommand(backendDir) {
    const mainScript = path.join(backendDir, 'backend', 'main.py');
    const venvDir    = path.join(backendDir, '.venv');

    if (fs.existsSync(venvDir)) {
      // Option A: uvicorn.exe trong venv — cách tốt nhất, tự động load toàn bộ .pth files
      const uvicornWin  = path.join(venvDir, 'Scripts', 'uvicorn.exe');
      const uvicornUnix = path.join(venvDir, 'bin', 'uvicorn');
      const uvicornExe  = fs.existsSync(uvicornWin)  ? uvicornWin
                        : fs.existsSync(uvicornUnix) ? uvicornUnix : null;
      if (uvicornExe) {
        return {
          cmd: uvicornExe,
          args: ['backend.main:app', '--host', '127.0.0.1', '--port', '3900'],
          method: 'uvicorn-exe',
        };
      }

      // Option B: home Python + site.addsitedir — load đúng .pth files, chạy main.py như __main__
      const homePy = readVenvHomePython(venvDir);
      if (homePy) {
        const siteWin  = path.join(venvDir, 'Lib', 'site-packages');
        const siteUnix = path.join(venvDir, 'lib',
          `python${process.version.replace(/^v/, '').split('.').slice(0, 2).join('.')}`,
          'site-packages');
        const sitePkgs = fs.existsSync(siteWin) ? siteWin : siteUnix;
        // Dùng -c: thêm venv site-packages vào sys.path (xử lý .pth), rồi chạy main.py
        const pyCode = [
          `import sys, os, site, runpy`,
          `sys.path.insert(0, ${JSON.stringify(backendDir)})`,
          `site.addsitedir(${JSON.stringify(sitePkgs)})`,
          `os.environ.setdefault('VIRTUAL_ENV', ${JSON.stringify(venvDir)})`,
          `runpy.run_path(${JSON.stringify(mainScript)}, run_name='__main__')`,
        ].join('; ');
        return {
          cmd: homePy,
          args: ['-c', pyCode],
          method: 'pyvenv-home-site',
          extraEnv: {
            VIRTUAL_ENV: venvDir,
            PATH: path.join(venvDir, 'Scripts') + path.delimiter + (process.env.PATH || ''),
          },
        };
      }

      // Option C: thử shim trực tiếp (nếu venv tạo bằng system Python thì shim OK)
      const venvWin  = path.join(venvDir, 'Scripts', 'python.exe');
      const venvUnix = path.join(venvDir, 'bin', 'python');
      if (fs.existsSync(venvWin))  return { cmd: venvWin,  args: [mainScript], method: 'venv-shim-win' };
      if (fs.existsSync(venvUnix)) return { cmd: venvUnix, args: [mainScript], method: 'venv-shim-unix' };
    }

    // Fallback: uv run
    const uvPath = findUvExecutable();
    if (uvPath) return { cmd: uvPath, args: ['run', 'python', mainScript], method: 'uv-found' };
    return { cmd: 'uv', args: ['run', 'python', mainScript], method: 'uv-shell' };
  }

  ipcMain.handle('omnivoice:start', async (event, opts = {}) => {
    if (omniVoiceProc && !omniVoiceProc.killed) {
      return { success: true, alreadyRunning: true, pid: omniVoiceProc.pid };
    }
    const defaultDir = getDefaultOvDir();
    const backendDir = opts.path || (db ? await db.getSetting('omnivoiceDir', defaultDir) : defaultDir);

    if (!fs.existsSync(backendDir)) {
      return {
        success: false,
        error: `Không tìm thấy thư mục OmniVoice:\n${backendDir}\n\nHãy bấm "Đổi đường dẫn" để chọn đúng thư mục OmniVoice-Studio-main.`
      };
    }

    const { cmd, args, method, extraEnv = {} } = resolveStartCommand(backendDir);
    sendOvLog(`🚀 Đang khởi động OmniVoice...`, 'info');
    sendOvLog(`📁 Thư mục: ${backendDir}`, 'info');
    if (method === 'uvicorn-exe') {
      sendOvLog(`🦄 Dùng uvicorn.exe từ .venv`, 'info');
    } else if (method === 'pyvenv-home-site') {
      sendOvLog(`🐍 Python: ${path.basename(path.dirname(cmd))} + site.addsitedir`, 'info');
    } else if (method === 'pyvenv-home') {
      sendOvLog(`🐍 Python: ${path.basename(path.dirname(cmd))} (pyvenv.cfg home)`, 'info');
    } else if (method.startsWith('venv-shim')) {
      sendOvLog(`🐍 Dùng .venv shim Python`, 'info');
    } else if (method === 'uv-found') {
      sendOvLog(`⚡ Tìm thấy uv: ${cmd}`, 'info');
    } else {
      sendOvLog(`⚡ Thử gọi uv qua PATH...`, 'info');
    }

    omniVoiceStarting = true;
    try {
      omniVoiceProc = spawn(cmd, args, {
        cwd: backendDir,
        shell: method === 'uv-shell',
        windowsHide: true,
        detached: false,
        env: { ...process.env, ...extraEnv }
      });
      omniVoiceProc.stdout.on('data', d => {
        const t = d.toString().trim();
        if (t) sendOvLog(t, 'info');
      });
      omniVoiceProc.stderr.on('data', d => {
        const t = d.toString().trim();
        if (t) {
          // Uvicorn/FastAPI log to stderr — đa số là INFO bình thường
          const type = /\b(error|traceback|exception)\b/i.test(t) ? 'error' : 'info';
          sendOvLog(t, type);
        }
      });
      omniVoiceProc.on('close', code => {
        omniVoiceStarting = false;
        omniVoiceProc = null;
        if (code !== 0 && code !== null) {
          sendOvLog(`⚠️ OmniVoice đã dừng (exit ${code})`, 'warn');
        }
      });
      omniVoiceProc.on('error', err => {
        omniVoiceStarting = false;
        omniVoiceProc = null;
        let hint = '';
        if (err.code === 'ENOENT') {
          hint = method.startsWith('venv')
            ? '\n→ .venv chưa được tạo. Chạy: uv sync trong thư mục OmniVoice'
            : '\n→ Không tìm thấy uv. Cài tại: https://docs.astral.sh/uv/';
        }
        sendOvLog(`❌ ${err.message}${hint}`, 'error');
      });
      return { success: true, pid: omniVoiceProc.pid, method };
    } catch (e) {
      omniVoiceStarting = false;
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('omnivoice:stop', () => {
    if (omniVoiceProc && !omniVoiceProc.killed) {
      try { omniVoiceProc.kill('SIGTERM'); } catch (_) { try { omniVoiceProc.kill(); } catch (_2) {} }
      omniVoiceProc = null;
      omniVoiceStarting = false;
      sendOvLog('🛑 OmniVoice đã được dừng thủ công', 'warn');
      return { success: true };
    }
    return { success: false, error: 'Không có process đang chạy' };
  });

  ipcMain.handle('omnivoice:status', () => ({
    running:  !!(omniVoiceProc && !omniVoiceProc.killed),
    starting: omniVoiceStarting,
    pid:      omniVoiceProc?.pid || null
  }));

  ipcMain.handle('omnivoice:get-dir', async () => {
    const defaultDir = getDefaultOvDir();
    return db ? await db.getSetting('omnivoiceDir', defaultDir) : defaultDir;
  });

  ipcMain.handle('omnivoice:set-dir', async (event, dir) => {
    if (db) await db.setSetting('omnivoiceDir', dir);
    return { success: true };
  });

  ipcMain.handle('omnivoice:select-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Chọn thư mục OmniVoice-Studio-main'
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const dir = result.filePaths[0];
      if (db) await db.setSetting('omnivoiceDir', dir);
      return { success: true, dir };
    }
    return { success: false };
  });
}

function setupProtocol() {
  protocol.registerFileProtocol('local', (request, callback) => {
    try { const decodedPath = decodeURIComponent(request.url.replace('local://', '')).replace(/^\//, ''); fs.existsSync(decodedPath) ? callback({ path: decodedPath }) : callback({ error: -6 }); } catch (error) { callback({ error: -2 }); }
  });
}

app.whenReady().then(async () => {
  try {
    await initializeServices();
    setupIpcHandlers();
    registerUpdaterHandlers();
    setupProtocol();
    createWindow();
    const mainWin = BrowserWindow.getAllWindows()[0];
    registerDownloaderHandlers(mainWin);
    setTimeout(() => checkForUpdates(mainWin), 5000);
  } catch (error) { dialog.showErrorBox('Khởi động thất bại', error.message); app.quit(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async () => {
  if (omniVoiceProc && !omniVoiceProc.killed) {
    try { omniVoiceProc.kill(); } catch (_) {}
    omniVoiceProc = null;
  }
  if (queueManager) await queueManager.stop();
  if (db) db.close();
});
process.on('uncaughtException', (error) => console.error(error));
process.on('unhandledRejection', (reason) => console.error(reason));

const myCrypto = require('crypto'); const myOs = require('os'); const myFs = require('fs'); const myPath = require('path');
const SECRET_SALT = "GROK_STUDIO_PRO_VIP_2026_SECRET"; const LICENSE_FILE = myPath.join(app.getPath('userData'), 'license.json');
function getHWID() { let mac = ''; const nets = myOs.networkInterfaces(); for (const name of Object.keys(nets)) { for (const net of nets[name]) { if (!net.internal && net.mac !== '00:00:00:00:00:00') { mac = net.mac; break; } } if (mac) break; } return myCrypto.createHash('sha256').update(mac || 'FALLBACK').digest('hex').substring(0, 32).toUpperCase(); }
function verifyKeyWithTime(keyToTest) { try { const parts = keyToTest.split('-'); if (parts.length !== 2) return { valid: false, message: 'Định dạng Key không hợp lệ!' }; const expiryMs = parseInt(parts[0], 16); if (Date.now() > expiryMs) return { valid: false, message: 'Key đã hết hạn!' }; if (parts[1] === myCrypto.createHmac('sha256', SECRET_SALT).update(getHWID() + parts[0]).digest('hex').toUpperCase().substring(0, 16)) { const daysLeft = Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)); return { valid: true, daysLeft }; } return { valid: false, message: 'Key không đúng với máy này!' }; } catch (e) { return { valid: false, message: 'Lỗi giải mã!' }; } }
function getLicenseInfo() { try { if (myFs.existsSync(LICENSE_FILE)) { const data = JSON.parse(myFs.readFileSync(LICENSE_FILE, 'utf8')); if (data.key) { const check = verifyKeyWithTime(data.key); if (check.valid) return { isActive: true, daysLeft: check.daysLeft }; } } } catch (e) {} return { isActive: false, daysLeft: 0 }; }
ipcMain.handle('auth:get-hwid', () => getHWID());
ipcMain.handle('auth:check-license', () => { const info = getLicenseInfo(); return { valid: info.isActive, daysLeft: info.daysLeft }; });
ipcMain.handle('auth:activate', (event, key) => { const check = verifyKeyWithTime(key.trim()); if (check.valid) { myFs.writeFileSync(LICENSE_FILE, JSON.stringify({ key: key.trim() })); return { success: true }; } return { success: false, message: check.message }; });

// ── GEMINI TTS ───────────────────────────────────────────────────────────────
ipcMain.handle('gemini:tts', async (event, { text, voiceName, apiKey, outputFolder, projectName }) => {
    try {
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

        const https = require('https');
        const bodyBuf = Buffer.from(JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
            }
        }), 'utf-8');

        const { status, body } = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
            }, res => {
                const chunks = [];
                res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(60000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
            req.write(bodyBuf); req.end();
        });

        const json = JSON.parse(body);
        if (status !== 200) return { success: false, error: json?.error?.message || `HTTP ${status}` };

        // Tìm audio trong TẤT CẢ candidates và parts (không chỉ parts[0])
        let audioB64 = null;
        for (const cand of (json?.candidates || [])) {
            for (const part of (cand?.content?.parts || [])) {
                if (part?.inlineData?.data) { audioB64 = part.inlineData.data; break; }
            }
            if (audioB64) break;
        }
        if (!audioB64) {
            const reason = json?.candidates?.[0]?.finishReason || 'no_audio';
            return { success: false, error: `Gemini không trả về audio (${reason})` };
        }

        // PCM raw → WAV (24000Hz, mono, 16-bit)
        const pcm = Buffer.from(audioB64, 'base64');
        const SAMPLE_RATE = 24000, NUM_CH = 1, BPS_BITS = 16, BPS_BYTES = BPS_BITS / 8;
        const hdr = Buffer.alloc(44);
        hdr.write('RIFF', 0);    hdr.writeUInt32LE(36 + pcm.length, 4);
        hdr.write('WAVE', 8);    hdr.write('fmt ', 12);
        hdr.writeUInt32LE(16, 16);   hdr.writeUInt16LE(1, 20);     // PCM format
        hdr.writeUInt16LE(NUM_CH, 22);
        hdr.writeUInt32LE(SAMPLE_RATE, 24);
        hdr.writeUInt32LE(SAMPLE_RATE * NUM_CH * BPS_BYTES, 28);
        hdr.writeUInt16LE(NUM_CH * BPS_BYTES, 32);
        hdr.writeUInt16LE(BPS_BITS, 34);
        hdr.write('data', 36);   hdr.writeUInt32LE(pcm.length, 40);

        const wavBuf = Buffer.concat([hdr, pcm]);
        const safeName = (projectName || 'gemini_tts').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeName}_${Date.now()}.wav`;
        const filePath = path.join(outputFolder, fileName);
        fs.writeFileSync(filePath, wavBuf);

        return { success: true, path: filePath, fileName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── GEMINI TTS SRT — Song song theo số key, dãn cách batch để tránh rate limit ──
ipcMain.handle('gemini:tts-srt', async (event, { segments, voiceName, apiKey, apiKeys, outputPath }) => {
    try {
        const https = require('https');
        const SAMPLE_RATE    = 24000;
        const BPS            = 2;        // 16-bit PCM mono
        const MIN_KEY_DELAY  = 6300;     // ms tối thiểu giữa 2 lần dùng cùng 1 key (10 RPM = 6s)
        const SEG_TIMEOUT    = 35000;    // ms timeout 1 request TTS (35s là đủ)
        const MAX_RETRY      = 3;        // thử tối đa 3 lần/đoạn trước khi bỏ qua

        // Thu thập tất cả key có sẵn
        const keys = Array.isArray(apiKeys) && apiKeys.length > 0
            ? apiKeys : (apiKey ? [apiKey] : []);
        if (!keys.length) throw new Error('Không có API Key Gemini');

        const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));

        // ── Gửi progress tới renderer (progress bar) và log (activity log) ──
        let doneCount = 0;
        const sendProgress = (done, total, text) => {
            try { event.sender.send('gemini-srt-progress', { done, total, text }); } catch (_) {}
        };
        const sendLog = (text) => {
            try { event.sender.send('gemini-srt-log', text); } catch (_) {}
        };

        // ── Gọi Gemini TTS 1 đoạn (1 key cụ thể) ──
        const callGeminiTTS = (text, keyIdx) => new Promise((resolve, reject) => {
            const key = keys[keyIdx % keys.length];
            const bodyBuf = Buffer.from(JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
                }
            }), 'utf-8');
            const req = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
            }, res => {
                const chunks = [];
                res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                        if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
                        if (res.statusCode !== 200) return reject(new Error(json?.error?.message || `HTTP ${res.statusCode}`));
                        if (json?.promptFeedback?.blockReason) return reject(new Error(`BLOCKED`));
                        let b64 = null;
                        for (const cand of (json?.candidates || [])) {
                            for (const part of (cand?.content?.parts || [])) {
                                if (part?.inlineData?.data) { b64 = part.inlineData.data; break; }
                            }
                            if (b64) break;
                        }
                        if (!b64) return reject(new Error('NO_AUDIO'));
                        resolve(Buffer.from(b64, 'base64'));
                    } catch (e) { reject(e); }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(SEG_TIMEOUT, () => { req.destroy(); reject(new Error('TIMEOUT')); });
            req.write(bodyBuf); req.end();
        });

        // ── Xử lý 1 segment với 1 key, exponential backoff khi rate-limit ──
        // Trả về true nếu thành công, false nếu skip (BLOCKED/rỗng), null nếu thất bại
        const processSingleSegment = async (segIdx, keyIdx, maxRetry, logPrefix) => {
            const seg       = segments[segIdx];
            const cleanText = (seg.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanText) return false; // rỗng → skip

            for (let attempt = 0; attempt < maxRetry; attempt++) {
                // Rate limit: chờ đủ MIN_KEY_DELAY kể từ lần dùng key này trước
                const wait = Math.max(0, keyLastUsed[keyIdx] + MIN_KEY_DELAY - Date.now());
                if (wait > 0) await sleepMs(wait);
                keyLastUsed[keyIdx] = Date.now();

                try {
                    pcmResults[segIdx] = await callGeminiTTS(cleanText, keyIdx);
                    return true; // thành công
                } catch (err) {
                    const msg = err.message || '';
                    if (msg === 'BLOCKED') {
                        sendProgress(doneCount, segments.length, `⚠️ ${logPrefix}${segIdx+1} bị chặn nội dung → bỏ qua`);
                        return false; // skip vĩnh viễn
                    }
                    if (msg === 'RATE_LIMIT') {
                        // Exponential backoff: lần 1→10s, lần 2→20s, lần 3→40s, lần 4→60s
                        const backoff = Math.min(60000, 10000 * Math.pow(2, attempt));
                        keyLastUsed[keyIdx] = Date.now() + backoff;
                        sendProgress(doneCount, segments.length,
                            `⏳ key#${keyIdx+1} rate-limit (lần ${attempt+1}) → chờ ${backoff/1000}s...`);
                        await sleepMs(backoff);
                    } else if (msg === 'TIMEOUT') {
                        sendProgress(doneCount, segments.length,
                            `⏱️ ${logPrefix}${segIdx+1} timeout (lần ${attempt+1}/${maxRetry})`);
                        await sleepMs(3000);
                    } else {
                        sendProgress(doneCount, segments.length,
                            `🔄 ${logPrefix}${segIdx+1} [${msg.slice(0,25)}] lần ${attempt+1}/${maxRetry}`);
                        await sleepMs(2000);
                    }
                }
            }
            return null; // thất bại hết retry
        };

        // ── Parallel worker: mỗi key 1 worker, chạy song song ──────────────────
        // Tốc độ = ceil(segments/N) × 6.3s thay vì segments × 6.3s
        const N = keys.length;
        const pcmResults   = new Array(segments.length).fill(null);
        const keyLastUsed  = new Array(N).fill(0);

        const estMin = Math.ceil(Math.ceil(segments.length / N) * MIN_KEY_DELAY / 60000);
        sendProgress(0, segments.length,
            `🚀 ${segments.length} đoạn · ${N} key song song · ≈${estMin} phút`);
        sendLog(`🎤 Lồng tiếng ${voiceName}: ${segments.length} đoạn · ${N} key · ≈${estMin} phút`);

        const runWorker = async (keyIdx) => {
            for (let i = keyIdx; i < segments.length; i += N) {
                const r = await processSingleSegment(i, keyIdx, MAX_RETRY, '');
                doneCount++;
                if (r === true) {
                    const pct = Math.round(doneCount / segments.length * 100);
                    sendProgress(doneCount, segments.length,
                        `✅ ${doneCount}/${segments.length} (${pct}%)`);
                    if (doneCount % 5 === 0 || doneCount === segments.length) {
                        sendLog(`  🎤 ${doneCount}/${segments.length} (${pct}%)`);
                    }
                } else if (r === null) {
                    sendProgress(doneCount, segments.length,
                        `⚠️ ${i+1}/${segments.length} thất bại → đánh dấu retry`);
                }
            }
        };

        // Pass 1: tất cả N worker chạy song song
        await Promise.all(Array.from({ length: N }, (_, k) => runWorker(k)));

        // ── Pass 2: Retry các segment thất bại (pcmResults[i] vẫn là null) ──────
        // Lý do: rate-limit trong Pass 1 có thể làm mất hàng loạt segment cuối
        // Pass 2 chờ quota API nạp lại (30s) rồi thử lại tuần tự
        const failedIndices = segments
            .map((seg, i) => ({i, text: (seg.text||'').trim()}))
            .filter(({i, text}) => pcmResults[i] === null && text.length > 0)
            .map(({i}) => i);

        if (failedIndices.length > 0) {
            sendLog(`⚠️ Pass 1 thất bại: ${failedIndices.length} đoạn — chờ 30s rồi retry...`);
            sendProgress(doneCount, segments.length,
                `⏳ ${failedIndices.length} đoạn thất bại → chờ 30s rồi retry...`);
            await sleepMs(30000); // chờ API quota nạp lại

            // Reset keyLastUsed để không bị carry-over penalty từ Pass 1
            keyLastUsed.fill(0);
            doneCount = 0; // reset counter cho Pass 2

            sendLog(`🔄 Pass 2: Retry ${failedIndices.length} đoạn thất bại...`);

            // Phân đoạn thất bại cho từng key (interleaved)
            const retryWorker = async (keyIdx) => {
                for (let ri = keyIdx; ri < failedIndices.length; ri += N) {
                    const segIdx = failedIndices[ri];
                    const r = await processSingleSegment(segIdx, keyIdx, MAX_RETRY + 2, '[retry] ');
                    doneCount++;
                    if (r === true) {
                        sendLog(`  ✅ [retry] đoạn ${segIdx+1} OK (${doneCount}/${failedIndices.length})`);
                    } else {
                        sendLog(`  ❌ [retry] đoạn ${segIdx+1} vẫn thất bại → im lặng`);
                    }
                    sendProgress(doneCount, failedIndices.length,
                        `🔄 Retry ${doneCount}/${failedIndices.length}`);
                }
            };

            await Promise.all(Array.from({ length: N }, (_, k) => retryWorker(k)));

            const stillFailed = failedIndices.filter(i => pcmResults[i] === null).length;
            sendLog(`📊 Kết quả: ${segments.length - stillFailed}/${segments.length} đoạn có audio · ${stillFailed} im lặng`);
        } else {
            sendLog(`✅ Pass 1 hoàn tất: 100% (${segments.length}/${segments.length}) đoạn có audio`);
        }

        // ── Ghép PCM theo timeline CỐ ĐỊNH — mỗi segment đặt đúng vị trí startMs ──
        // Không dùng currentMs tracking để tránh drift khi TTS dài hơn window SRT
        sendProgress(segments.length, segments.length, '🔧 Ghép audio theo timeline...');

        const lastSeg    = segments[segments.length - 1];
        const totalMs    = (lastSeg.endMs || lastSeg.startMs + 3000) + 500; // thêm 0.5s buffer
        const totalBytes = Math.ceil(totalMs * SAMPLE_RATE / 1000) * BPS;
        const pcmBuffer  = Buffer.alloc(totalBytes, 0); // toàn im lặng trước

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const pcm = pcmResults[i];
            if (!pcm || pcm.length === 0) continue;
            // Vị trí byte chính xác theo startMs của SRT — không bao giờ drift
            const startByte = Math.floor(seg.startMs * SAMPLE_RATE / 1000) * BPS;
            // Giới hạn: chỉ ghi đến cuối window (endMs) hoặc cuối buffer
            const windowMs   = (seg.endMs || seg.startMs + 3000) - seg.startMs;
            const maxBytes   = Math.min(
                Math.floor(windowMs * SAMPLE_RATE / 1000) * BPS, // giới hạn window SRT
                totalBytes - startByte                            // giới hạn buffer
            );
            if (maxBytes > 0) pcm.copy(pcmBuffer, startByte, 0, maxBytes);
        }

        // ── Xuất WAV ──
        sendProgress(segments.length, segments.length, '💾 Đang lưu file WAV...');
        const hdr = Buffer.alloc(44);
        hdr.write('RIFF', 0);  hdr.writeUInt32LE(36 + pcmBuffer.length, 4);
        hdr.write('WAVE', 8);  hdr.write('fmt ', 12);
        hdr.writeUInt32LE(16, 16);              hdr.writeUInt16LE(1, 20);
        hdr.writeUInt16LE(1, 22);               hdr.writeUInt32LE(SAMPLE_RATE, 24);
        hdr.writeUInt32LE(SAMPLE_RATE * BPS, 28); hdr.writeUInt16LE(BPS, 32);
        hdr.writeUInt16LE(16, 34);              hdr.write('data', 36);
        hdr.writeUInt32LE(pcmBuffer.length, 40);

        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outputPath, Buffer.concat([hdr, pcmBuffer]));

        return { success: true, path: outputPath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── TRỘN AUDIO: giảm tiếng gốc + chồng voice lồng tiếng ──────────────────────
ipcMain.handle('video:mixAudio', async (event, { videoPath, audioPath, outputPath, videoVol = 0.7, audioVol = 1.0 }) => {
    try {
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const args = [
            '-y', '-i', videoPath, '-i', audioPath,
            '-filter_complex',
            `[0:a]volume=${videoVol}[orig];[1:a]volume=${audioVol}[dub];[orig][dub]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
            '-map', '0:v:0', '-map', '[aout]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
            outputPath
        ];
        const result = await runFFmpeg(args);
        if (!result.ok || !fs.existsSync(outputPath)) return { success: false, error: result.stderr.slice(-400) };
        return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
});

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); const cryptoNode = require('crypto');
if (typeof global.crypto === 'undefined') global.crypto = cryptoNode.webcrypto || cryptoNode;
function createTTSInstance() { return new MsEdgeTTS(); }
ipcMain.handle('tts:get-voices', async () => { try { const tts = createTTSInstance(); const voices = await tts.getVoices(); if (voices && voices.length > 0) return voices; throw new Error("Empty list"); } catch (error) { return [ { ShortName: "vi-VN-HoaiMyNeural", Gender: "Female", Locale: "vi-VN" }, { ShortName: "vi-VN-NamMinhNeural", Gender: "Male", Locale: "vi-VN" } ]; } });
ipcMain.handle('tts:generate', async (event, { text, voice, outputPath }) => { try { const dir = path.dirname(outputPath); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); const tts = createTTSInstance(); await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3); return new Promise(async (resolve) => { try { const { audioStream } = await tts.toStream(text); const fileStream = fs.createWriteStream(outputPath); audioStream.on('data', (chunk) => fileStream.write(chunk)); audioStream.on('close', () => { fileStream.end(); resolve({ success: true, path: outputPath }); }); audioStream.on('error', (err) => { fileStream.end(); resolve({ success: false, error: err.message }); }); } catch (streamErr) { resolve({ success: false, error: streamErr.message }); } }); } catch (err) { return { success: false, error: err.message }; } });
ipcMain.handle('tts:preview', async (event, voiceName) => { try { const tempPath = path.join(app.getPath('temp'), `grok_preview_${Date.now()}.mp3`); const tts = createTTSInstance(); await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3); return new Promise(async (resolve) => { try { const { audioStream } = await tts.toStream("Xin chào, đây là giọng đọc thử nghiệm."); const fileStream = fs.createWriteStream(tempPath); audioStream.on('data', (chunk) => fileStream.write(chunk)); audioStream.on('close', () => { fileStream.end(); resolve({ success: true, path: tempPath }); }); audioStream.on('error', () => resolve({ success: false })); } catch (e) { resolve({ success: false }); } }); } catch (err) { return { success: false }; } });

const ffmpegPath = require('ffmpeg-static'); const { spawn } = require('child_process'); const ffprobePath = require('ffprobe-static').path;

// ==================== TTS SRT HELPERS ====================

// Get audio duration via ffprobe
const getTTSAudioDuration = (filePath) => new Promise((resolve) => {
    const proc = spawn(ffprobePath, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve(parseFloat(out.trim()) || 0));
    proc.on('error', () => resolve(0));
});

// Adjust audio speed using FFmpeg atempo (chains for ratios outside 0.5–2.0)
const adjustTTSSpeed = (inputPath, outputPath, ratio) => new Promise((resolve, reject) => {
    const buildAtempo = (r) => {
        const steps = [];
        let rem = r;
        while (rem > 2.0) { steps.push('atempo=2.0'); rem /= 2.0; }
        while (rem < 0.5) { steps.push('atempo=0.5'); rem /= 0.5; }
        steps.push(`atempo=${rem.toFixed(4)}`);
        return steps.join(',');
    };
    const filter = buildAtempo(ratio);
    const proc = spawn(ffmpegPath, ['-y', '-i', inputPath, '-filter:a', filter, '-c:a', 'libmp3lame', '-q:a', '4', outputPath]);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`atempo failed code ${code}`)));
    proc.on('error', reject);
});

// Generate TTS audio stream to file (Edge TTS)
const edgeTTSToFile = (text, voice, outputPath) => new Promise(async (resolve, reject) => {
    try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = await tts.toStream(text);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const fileStream = fs.createWriteStream(outputPath);
        audioStream.on('data', chunk => fileStream.write(chunk));
        audioStream.on('close', () => { fileStream.end(); resolve(); });
        audioStream.on('error', err => { fileStream.destroy(); reject(err); });
    } catch (e) { reject(e); }
});

// Merge timed audio segments using FFmpeg adelay+amix
const mergeTimedAudioSegments = (segments, outputPath) => new Promise((resolve, reject) => {
    // segments: [{path, startMs}]
    if (segments.length === 0) return reject(new Error('No segments'));
    if (segments.length === 1) {
        // Just copy the single file with proper delay if needed
        if (segments[0].startMs === 0) {
            fs.copyFileSync(segments[0].path, outputPath);
            return resolve();
        }
        // Add silence before
        const delayMs = Math.round(segments[0].startMs);
        const proc = spawn(ffmpegPath, ['-y', '-i', segments[0].path,
            '-filter:a', `adelay=${delayMs}|${delayMs}`, '-c:a', 'libmp3lame', '-q:a', '4', outputPath]);
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`merge failed code ${code}`)));
        proc.on('error', reject);
        return;
    }
    const inputArgs = segments.flatMap(s => ['-i', s.path]);
    const filterParts = segments.map((s, i) => {
        const d = Math.round(s.startMs);
        return `[${i}]adelay=${d}|${d}[a${i}]`;
    });
    const mixInputs = segments.map((_, i) => `[a${i}]`).join('');
    const filterComplex = `${filterParts.join(';')};${mixInputs}amix=inputs=${segments.length}:duration=longest:normalize=0`;
    const args = ['-y', ...inputArgs, '-filter_complex', filterComplex, '-c:a', 'libmp3lame', '-q:a', '4', outputPath];
    const proc = spawn(ffmpegPath, args);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`merge failed code ${code}`)));
    proc.on('error', reject);
});

// IPC: Edge TTS with SRT segment timing + auto speed adjustment
ipcMain.handle('tts:generate-srt', async (event, { segments, voice, outputPath }) => {
    const tempDir = path.join(app.getPath('temp'), `grok_tts_srt_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const vLog = (text, type = 'info') => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice-log', { time: new Date().toLocaleTimeString(), text, type }); };
    const sendProg = (done, total, text) => { if (mainWindow) mainWindow.webContents.send('tts-srt-progress', { done, total, text }); };
    vLog(`🎙️ [Edge TTS] Bắt đầu SRT — ${segments.length} đoạn · giọng: ${voice.split('-').pop()}`, 'info');
    try {
        const timedSegs = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            sendProg(i, segments.length, `Đang tạo đoạn ${i + 1}/${segments.length}...`);
            vLog(`  ▶ Đoạn ${i + 1}/${segments.length}: "${seg.text.substring(0, 50)}${seg.text.length > 50 ? '...' : ''}"`, 'info');
            const rawPath = path.join(tempDir, `seg_${i}_raw.mp3`);
            const finalPath = path.join(tempDir, `seg_${i}_final.mp3`);
            await edgeTTSToFile(seg.text, voice, rawPath);
            const audioDurSec = await getTTSAudioDuration(rawPath);
            const slotDurSec = (seg.endMs - seg.startMs) / 1000;
            if (audioDurSec > 0 && slotDurSec > 0 && audioDurSec > slotDurSec * 1.05) {
                const ratio = Math.min(audioDurSec / slotDurSec, 3.0);
                vLog(`  ⚡ Tăng tốc đoạn ${i + 1}: ${audioDurSec.toFixed(2)}s → ${slotDurSec.toFixed(2)}s (x${ratio.toFixed(2)})`, 'warn');
                await adjustTTSSpeed(rawPath, finalPath, ratio);
                timedSegs.push({ path: finalPath, startMs: seg.startMs });
            } else {
                fs.copyFileSync(rawPath, finalPath);
                timedSegs.push({ path: finalPath, startMs: seg.startMs });
            }
        }
        sendProg(segments.length, segments.length, 'Đang ghép audio...');
        vLog(`🔗 Ghép ${timedSegs.length} đoạn audio...`, 'info');
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await mergeTimedAudioSegments(timedSegs, outputPath);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        vLog(`✅ [Edge TTS] Đã lưu: ${outputPath}`, 'success');
        return { success: true, path: outputPath };
    } catch (e) {
        vLog(`❌ [Edge TTS] Lỗi: ${e.message}`, 'error');
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        return { success: false, error: e.message };
    }
});

// ==================== VEO STUDIO ====================
ipcMain.handle('veo:run', async (event, jobData) => {
    try {
        const sendLog = (text, type = 'info') => { if (mainWindow) mainWindow.webContents.send('veo-log', { time: new Date().toLocaleTimeString(), text, type }); };
        return await VeoEngine.run(jobData, sendLog);
    } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('veo:check-cookie', async (event, cookieStr) => { try { return await VeoEngine.checkCookie(cookieStr); } catch (error) { return { success: false, error: error.message }; } });

ipcMain.handle('veo:extend', async (event, jobData) => {
    try {
        const sendLog = (text, type = 'info') => { if (mainWindow) mainWindow.webContents.send('veo-log', { time: new Date().toLocaleTimeString(), text, type }); };
        return await VeoEngine.runExtend(jobData, sendLog);
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('veo:extend-chain', async (event, jobData) => {
    try {
        const sendLog = (text, type = 'info') => { if (mainWindow) mainWindow.webContents.send('veo-log', { time: new Date().toLocaleTimeString(), text, type }); };
        return await VeoEngine.runExtendChain(jobData, sendLog);
    } catch (error) { return { success: false, error: error.message }; }
});

// ==================== VIDEO EDITOR ====================
const sendVideoLog = (text, type = 'info') => {
    if (mainWindow) mainWindow.webContents.send('video-log', { time: new Date().toLocaleTimeString(), text, type });
};

// Hàm lấy width/height của video bằng ffprobe
const getVideoDimensions = (filePath) => new Promise((resolve) => {
    const proc = spawn(ffprobePath, ['-v', 'quiet', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => {
        const parts = out.trim().split('x');
        const w = parseInt(parts[0]);
        const h = parseInt(parts[1]);
        if (w > 0 && h > 0) resolve({ width: w, height: h });
        else resolve(null);
    });
    proc.on('error', () => resolve(null));
});

// Hàm lấy duration video chính xác bằng ffprobe (ưu tiên stream duration)
const getVideoDuration = (filePath) => new Promise((resolve) => {
    const proc = spawn(ffprobePath, ['-v', 'quiet', '-select_streams', 'v:0',
        '-show_entries', 'stream=duration', '-of', 'csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => {
        const d = parseFloat(out.trim());
        if (!isNaN(d) && d > 0) return resolve(d);
        // fallback: format duration
        const p2 = spawn(ffprobePath, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
        let o2 = '';
        p2.stdout.on('data', d => o2 += d);
        p2.on('close', () => resolve(parseFloat(o2.trim()) || 0));
        p2.on('error', () => resolve(0));
    });
    proc.on('error', () => resolve(0));
});

// Đọc danh sách video trong thư mục
ipcMain.handle('video:read-folder', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) return [];
        const videoExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];
        return fs.readdirSync(folderPath)
            .filter(f => videoExts.includes(path.extname(f).toLowerCase()))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map(f => {
                const filePath = path.join(folderPath, f);
                const stat = fs.statSync(filePath);
                return { name: f, path: filePath, size: (stat.size / 1024 / 1024).toFixed(1) + ' MB' };
            });
    } catch (e) { return []; }
});

// Cắt video thành nhiều phần
ipcMain.handle('video:cut', async (event, { inputPath, segmentTime, outputFolder }) => {
    try {
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
        const baseName = path.basename(inputPath, path.extname(inputPath));
        sendVideoLog(`Bắt đầu cắt: ${path.basename(inputPath)} → mỗi ${segmentTime}s`);
        return new Promise((resolve) => {
            const outputPattern = path.join(outputFolder, `${baseName}_%03d.mp4`);
            const args = ['-y', '-i', inputPath, '-c', 'copy', '-map', '0',
                '-f', 'segment', '-segment_time', segmentTime.toString(), '-reset_timestamps', '1', outputPattern];
            const proc = spawn(ffmpegPath, args);
            proc.stderr.on('data', d => { const t = d.toString().match(/time=[\d:.]+/)?.[0]; if (t) sendVideoLog(`Đang cắt: ${t}`); });
            proc.on('close', (code) => {
                if (code === 0) {
                    const files = fs.readdirSync(outputFolder)
                        .filter(f => f.startsWith(baseName + '_') && f.endsWith('.mp4'))
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                        .map(f => ({ name: f, path: path.join(outputFolder, f) }));
                    sendVideoLog(`✅ Cắt xong: ${files.length} phần`, 'success');
                    resolve({ success: true, files });
                } else resolve({ success: false, error: `FFmpeg lỗi (code ${code})` });
            });
            proc.on('error', err => resolve({ success: false, error: err.message }));
        });
    } catch (e) { return { success: false, error: e.message }; }
});

// ── ÉP PHỤ ĐỀ (HARDSUB) VÀO VIDEO ──────────────────────────────────────────
// Bảng màu chữ ASS (&HAABBGGRR — alpha=00 opaque)
const SUB_COLOR_MAP = {
    'white':    '00FFFFFF', // Trắng
    'yellow':   '0000FFFF', // Vàng
    'gold':     '0000D7FF', // Vàng đậm
    'orange':   '0000A5FF', // Cam
    'red':      '000000FF', // Đỏ
    'pink':     '00CBC0FF', // Hồng
    'purple':   '00800080', // Tím
    'green':    '0000FF00', // Xanh lá
    'cyan':     '00FFFF00', // Xanh ngọc
    'blue':     '00FF0000', // Xanh lam
    'skyblue':  '00FF8040', // Xanh da trời
    'cream':    '00C0F0FF', // Kem trắng
};

// Bảng hiệu ứng chữ (chuỗi force_style fragment)
const SUB_EFFECT_MAP = {
    'outline':        'OutlineColour=&H00000000,Outline=2,Shadow=0',               // Viền đen
    'outline_thick':  'OutlineColour=&H00000000,Outline=4,Shadow=0',               // Viền đen dày
    'shadow':         'OutlineColour=&H00000000,Outline=0,Shadow=3',               // Bóng đổ
    'outline_shadow': 'OutlineColour=&H00000000,Outline=2,Shadow=2',               // Viền + Bóng
    'bold_pop':       'Bold=1,OutlineColour=&H00000000,Outline=3,Shadow=3',        // Nổi bật mạnh
    'glow_white':     'OutlineColour=&H55FFFFFF,Outline=5,Shadow=0',               // Phát sáng trắng
    'glow_yellow':    'OutlineColour=&H550000FF,Outline=5,Shadow=0',               // Phát sáng vàng (Note: ASS yellow = 0000FFFF)
    'box':            'BorderStyle=3,BackColour=&H90000000,Outline=1,Shadow=0',    // Nền mờ đen
    'box_white':      'BorderStyle=3,BackColour=&H90FFFFFF,Outline=0,Shadow=0',    // Nền mờ trắng
    'none':           'Outline=0,Shadow=0',                                         // Không hiệu ứng
};

ipcMain.handle('video:burnSubtitles', async (event, { videoPath, srtContent, outputFolder, outputPath: customOutputPath, style }) => {
    const srtTmp = path.join(require('os').tmpdir(), `fluxy_sub_${Date.now()}.srt`);
    try {
        fs.writeFileSync(srtTmp, srtContent, 'utf8');
        const baseName = path.basename(videoPath, path.extname(videoPath));
        const outDir = outputFolder || path.dirname(videoPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        // Dùng outputPath do renderer truyền vào nếu có, không thì tự đặt tên
        const outPath = customOutputPath || path.join(outDir, `${baseName}_phu_de.mp4`);

        const fontSize    = style?.fontSize  || 24;
        const colorHex    = SUB_COLOR_MAP[style?.color] || '00FFFFFF';
        const effectStr   = SUB_EFFECT_MAP[style?.effect] || SUB_EFFECT_MAP['outline'];
        const alignment   = style?.position === 'top' ? 8 : 2;

        // Escape path Windows cho subtitles filter: \ → /, : → \:
        const srtEscaped = srtTmp.replace(/\\/g, '/').replace(/:/g, '\\:');
        const forceStyle = `FontSize=${fontSize},PrimaryColour=&H${colorHex},Alignment=${alignment},MarginV=20,${effectStr}`;

        sendVideoLog(`🔥 Đang ép phụ đề → ${path.basename(outPath)}...`);
        const result = await runFFmpeg([
            '-y', '-i', videoPath,
            '-vf', `subtitles='${srtEscaped}':force_style='${forceStyle}'`,
            '-c:a', 'copy', '-preset', 'fast', outPath
        ]);
        try { fs.unlinkSync(srtTmp); } catch (_) {}

        if (!result.ok) {
            sendVideoLog(`❌ Lỗi ép phụ đề: ${result.stderr.slice(-300)}`, 'error');
            return { success: false, error: result.stderr.slice(-500) };
        }
        sendVideoLog(`✅ Ép phụ đề xong: ${path.basename(outPath)}`, 'success');
        return { success: true, path: outPath };
    } catch (e) {
        try { fs.unlinkSync(srtTmp); } catch (_) {}
        return { success: false, error: e.message };
    }
});

// ── THAY THẾ AUDIO VIDEO (tắt tiếng video + ghép audio gốc vào) ─────────────
ipcMain.handle('video:replaceAudio', async (event, { videoPath, audioPath, outputFolder }) => {
    try {
        const baseName = path.basename(videoPath, path.extname(videoPath));
        const outDir = outputFolder || path.dirname(videoPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, `${baseName}_final.mp4`);

        sendVideoLog(`🎵 Đang ghép audio gốc vào video...`);
        // -map 0:v:0 → lấy video từ file 1 (merged video)
        // -map 1:a:0 → lấy audio từ file 2 (original audio)
        // -shortest  → cắt theo track ngắn hơn
        const result = await runFFmpeg([
            '-y',
            '-i', videoPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            outPath
        ]);

        if (!result.ok) {
            sendVideoLog(`❌ Lỗi thay audio: ${result.stderr.slice(-300)}`, 'error');
            return { success: false, error: result.stderr.slice(-500) };
        }
        sendVideoLog(`✅ Ghép audio gốc xong: ${path.basename(outPath)}`, 'success');
        return { success: true, path: outPath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Helper: chạy 1 lệnh ffmpeg, trả về Promise<{ok, stderr}>
function runFFmpeg(args) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => resolve({ ok: code === 0, stderr }));
        proc.on('error', err => resolve({ ok: false, stderr: err.message }));
    });
}

// Ghép video với trim và hiệu ứng chuyển cảnh
ipcMain.handle('video:merge', async (event, { files, trimStart, trimEnd, transition, outputFolder, outputName }) => {
    const tempDir = path.join(outputFolder, '_merge_tmp');
    try {
        if (!files || files.length < 2) return { success: false, error: 'Cần ít nhất 2 video' };
        const outputPath = path.join(outputFolder, outputName + '.mp4');
        const noTransition = transition === 'Không có';
        const isRandom = transition === 'Ngẫu nhiên';
        const hasTrim = trimStart > 0 || trimEnd > 0;
        sendVideoLog(`Ghép ${files.length} video → ${outputName}.mp4`);

        const allEffects = ['fade', 'dissolve', 'slideright', 'wipeleft', 'circleopen', 'slideleft', 'wiperight'];
        const xfadeMap = {
            'Fade (Mờ dần)': 'fade', 'Dissolve (Hòa tan)': 'dissolve',
            'Slide Right': 'slideright', 'Wipe Left': 'wipeleft',
            'Circle Open (Viral)': 'circleopen'
        };
        const xDur = 0.3;
        const getEffect = () => {
            if (isRandom) return Math.random() < 0.5 ? allEffects[Math.floor(Math.random() * allEffects.length)] : null;
            return xfadeMap[transition] || null;
        };

        // ── CASE 1: không hiệu ứng + không trim → concat demuxer cực nhanh ────
        if (noTransition && !hasTrim) {
            const listFile = path.join(outputFolder, '_concat_list.txt');
            fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n'));
            return new Promise((resolve) => {
                const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath];
                const proc = spawn(ffmpegPath, args);
                proc.stderr.on('data', d => { const t = d.toString().match(/time=[\d:.]+/)?.[0]; if (t) sendVideoLog(`Render: ${t}`); });
                proc.on('close', (code) => {
                    try { fs.unlinkSync(listFile); } catch (_) {}
                    if (code === 0) { sendVideoLog('✅ Ghép xong!', 'success'); resolve({ success: true, path: outputPath }); }
                    else resolve({ success: false, error: `FFmpeg lỗi (code ${code})` });
                });
                proc.on('error', err => resolve({ success: false, error: err.message }));
            });
        }

        // ── CASE 2: có trim, không hiệu ứng → re-encode + concat filter ─────────
        if (noTransition && hasTrim) {
            const durations = await Promise.all(files.map(getVideoDuration));
            const inputs = files.flatMap(f => ['-i', f]);
            const parts = [], vIn = [], aIn = [];
            for (let i = 0; i < files.length; i++) {
                const dur = durations[i] || 10;
                const tEnd = Math.max(dur - trimEnd, trimStart + 0.5);
                parts.push(`[${i}:v]trim=start=${trimStart}:end=${tEnd},setpts=PTS-STARTPTS[v${i}]`);
                parts.push(`[${i}:a]atrim=start=${trimStart}:end=${tEnd},asetpts=PTS-STARTPTS[a${i}]`);
                vIn.push(`[v${i}]`); aIn.push(`[a${i}]`);
            }
            parts.push(`${vIn.join('')}concat=n=${files.length}:v=1:a=0[vout]`);
            parts.push(`${aIn.join('')}concat=n=${files.length}:v=0:a=1[aout]`);
            return new Promise((resolve) => {
                const proc = spawn(ffmpegPath, ['-y', ...inputs, '-filter_complex', parts.join(';'),
                    '-map', '[vout]', '-map', '[aout]',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-r', '30',
                    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
                    '-c:a', 'aac', '-ar', '44100', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
                let stderrBuf = '';
                proc.stderr.on('data', d => { stderrBuf += d; const t = d.toString().match(/time=[\d:.]+/)?.[0]; if (t) sendVideoLog(`Render: ${t}`); });
                proc.on('close', code => {
                    if (code === 0) { sendVideoLog('✅ Ghép xong!', 'success'); resolve({ success: true, path: outputPath }); }
                    else {
                        const last = stderrBuf.split('\n').reverse().find(l => l.trim()) || `code ${code}`;
                        sendVideoLog(`❌ Lỗi: ${last}`, 'error');
                        resolve({ success: false, error: last });
                    }
                });
                proc.on('error', err => resolve({ success: false, error: err.message }));
            });
        }

        // ── CASE 3: có hiệu ứng → incremental approach (mỗi xfade = 1 lệnh ffmpeg riêng) ──
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const durations = await Promise.all(files.map(getVideoDuration));

        // Tham số encode chuẩn — yuv420p High profile, tương thích mọi player/thiết bị
        const ENC_V = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                       '-r', '30', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0'];
        const ENC_A = ['-c:a', 'aac', '-ar', '44100', '-b:a', '192k'];
        const ENC_VA = [...ENC_V, ...ENC_A];

        // Hàm concat nhiều clip đã normalize thành 1 segment (re-encode đảm bảo timing liên tục)
        const concatSegment = async (clipPaths, outFile) => {
            if (clipPaths.length === 1) return { ok: true };
            const n = clipPaths.length;
            const inputs = clipPaths.flatMap(f => ['-i', f]);
            const vParts = clipPaths.map((_, j) => `[${j}:v]`).join('');
            const aParts = clipPaths.map((_, j) => `[${j}:a]`).join('');
            const flt = `${vParts}concat=n=${n}:v=1:a=0[vout];${aParts}concat=n=${n}:v=0:a=1[aout]`;
            return runFFmpeg(['-y', ...inputs, '-filter_complex', flt,
                '-map', '[vout]', '-map', '[aout]', ...ENC_VA, outFile]);
        };

        // Bước 1: Normalize + trim từng clip → chuẩn hóa FPS=30, AR=44100, yuv420p
        // Scale tất cả về cùng resolution với clip đầu tiên để tránh concat lỗi khi mix 720p/1080p
        sendVideoLog('Bước 1/3: Chuẩn hóa clips...');
        const refDims = await getVideoDimensions(files[0]);
        const targetW = refDims ? (refDims.width % 2 === 0 ? refDims.width : refDims.width - 1) : 0;
        const targetH = refDims ? (refDims.height % 2 === 0 ? refDims.height : refDims.height - 1) : 0;
        const scaleStr = targetW > 0
            ? `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1`
            : `scale=trunc(iw/2)*2:trunc(ih/2)*2`;
        if (targetW > 0) sendVideoLog(`  Target resolution: ${targetW}x${targetH}`);

        const normFiles = [];
        for (let i = 0; i < files.length; i++) {
            const normPath = path.join(tempDir, `norm_${i}.mp4`);
            normFiles.push(normPath);
            const dur = durations[i] || 10;
            const tEnd = Math.max(dur - trimEnd, trimStart + 0.5);
            let filterStr;
            if (hasTrim) {
                filterStr = `[0:v]trim=start=${trimStart}:end=${tEnd},setpts=PTS-STARTPTS,${scaleStr},fps=30,format=yuv420p[vout];[0:a]atrim=start=${trimStart}:end=${tEnd},asetpts=PTS-STARTPTS[aout]`;
            } else {
                filterStr = `[0:v]setpts=PTS-STARTPTS,${scaleStr},fps=30,format=yuv420p[vout];[0:a]asetpts=PTS-STARTPTS[aout]`;
            }
            const res = await runFFmpeg(['-y', '-i', files[i], '-filter_complex', filterStr,
                '-map', '[vout]', '-map', '[aout]', ...ENC_VA, normPath]);
            if (!res.ok) {
                // Thử lại với anullsrc nếu clip không có audio stream
                const noAudioFilter = hasTrim
                    ? `[0:v]trim=start=${trimStart}:end=${tEnd},setpts=PTS-STARTPTS,${scaleStr},fps=30,format=yuv420p[vout]`
                    : `[0:v]setpts=PTS-STARTPTS,${scaleStr},fps=30,format=yuv420p[vout]`;
                const res2 = await runFFmpeg(['-y', '-i', files[i],
                    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
                    '-filter_complex', noAudioFilter,
                    '-map', '[vout]', '-map', '1:a',
                    '-shortest', ...ENC_VA, normPath]);
                if (!res2.ok) {
                    const last = res.stderr.split('\n').reverse().find(l => l.trim()) || 'unknown';
                    sendVideoLog(`❌ Lỗi normalize clip ${i}: ${last}`, 'error');
                    return { success: false, error: `Normalize clip ${i} thất bại: ${last}` };
                }
                sendVideoLog(`  Clip ${i + 1}/${files.length} ✓ (silent → thêm audio trống)`);
                continue;
            }
            sendVideoLog(`  Clip ${i + 1}/${files.length} ✓`);
        }

        // Bước 2: Quyết định effect cho từng cặp (Ngẫu nhiên = 50% có hiệu ứng, 50% cắt thẳng)
        const effects = [];
        for (let i = 1; i < files.length; i++) {
            const eff = getEffect();
            effects.push(eff);
            if (eff === null) sendVideoLog(`  Cặp ${i}: cắt thẳng`);
            else sendVideoLog(`  Cặp ${i}: [${eff}]`);
        }

        // Bước 3: Nhóm các clip liên tiếp không có xfade → concat thành segment
        // Dùng concat FILTER (re-encode) thay vì concat demuxer để timestamp liên tục
        sendVideoLog('Bước 2/3: Tạo segments...');
        const segments = [];    // [{file, dur}]
        const segEffects = [];  // xfade effect sau mỗi segment

        const makeSegment = async (clipPaths, label) => {
            if (clipPaths.length === 1) {
                const dur = await getVideoDuration(clipPaths[0]);
                return { file: clipPaths[0], dur };
            }
            const segFile = path.join(tempDir, `seg_${label}.mp4`);
            const res = await concatSegment(clipPaths, segFile);
            if (!res.ok) throw new Error(`Segment concat thất bại (${label})`);
            const dur = await getVideoDuration(segFile);
            return { file: segFile, dur };
        };

        let segStart = 0;
        for (let i = 0; i < effects.length; i++) {
            if (effects[i] !== null) {
                const seg = await makeSegment(normFiles.slice(segStart, i + 1), `${segStart}_${i}`);
                segments.push(seg);
                segEffects.push(effects[i]);
                segStart = i + 1;
            }
        }
        // Segment cuối (tất cả clip còn lại)
        const lastSeg = await makeSegment(normFiles.slice(segStart), `${segStart}_last`);
        segments.push(lastSeg);

        // Bước 4: Chain xfade giữa các segment (với fallback cắt thẳng nếu lỗi)
        sendVideoLog('Bước 3/3: Áp dụng hiệu ứng chuyển cảnh...');
        let currentFile = segments[0].file;
        let currentDur = segments[0].dur;

        for (let s = 0; s < segEffects.length; s++) {
            const eff = segEffects[s];
            const next = segments[s + 1];
            const isLast = s === segEffects.length - 1;
            const outFile = isLast ? outputPath : path.join(tempDir, `xfade_${s}.mp4`);
            const offset = Math.max(0, currentDur - xDur);

            sendVideoLog(`  Xfade ${s}→${s+1}: [${eff}] offset=${offset.toFixed(2)}s`);
            const filterStr = [
                `[0:v][1:v]xfade=transition=${eff}:duration=${xDur}:offset=${offset.toFixed(3)}[vout]`,
                `[0:a][1:a]acrossfade=d=${xDur}[aout]`
            ].join(';');
            const res = await runFFmpeg(['-y', '-i', currentFile, '-i', next.file,
                '-filter_complex', filterStr,
                '-map', '[vout]', '-map', '[aout]',
                ...ENC_VA, '-movflags', '+faststart', outFile]);

            if (!res.ok) {
                // Fallback: cắt thẳng thay vì fail toàn bộ
                sendVideoLog(`  ⚠️ Xfade [${eff}] lỗi → dùng cắt thẳng`, 'info');
                const fallbackRes = await concatSegment([currentFile, next.file], outFile);
                if (!fallbackRes.ok) {
                    const last = res.stderr.split('\n').reverse().find(l => l.trim()) || 'unknown';
                    sendVideoLog(`❌ Lỗi ghép cặp ${s}: ${last}`, 'error');
                    return { success: false, error: `Ghép cặp ${s} thất bại: ${last}` };
                }
                currentDur += next.dur; // không có overlap khi cắt thẳng
            } else {
                currentDur += next.dur - xDur;
            }
            currentFile = outFile;
        }

        sendVideoLog('✅ Ghép xong!', 'success');
        return { success: true, path: outputPath };

    } catch (e) {
        return { success: false, error: e.message };
    } finally {
        // Dọn dẹp temp
        try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
});

// Trích xuất ảnh từ video
ipcMain.handle('video:extract-images', async (event, { inputPath, interval, outputFolder }) => {
    try {
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
        const baseName = path.basename(inputPath, path.extname(inputPath));
        sendVideoLog(`Trích xuất ảnh: ${path.basename(inputPath)}, cứ ${interval}s/ảnh`);
        return new Promise((resolve) => {
            const outputPattern = path.join(outputFolder, `${baseName}_%04d.jpg`);
            const fps = 1 / interval;
            const args = ['-y', '-i', inputPath, '-vf', `fps=${fps}`, '-q:v', '2', outputPattern];
            const proc = spawn(ffmpegPath, args);
            proc.stderr.on('data', d => { const t = d.toString().match(/time=[\d:.]+/)?.[0]; if (t) sendVideoLog(`Đang xử lý: ${t}`); });
            proc.on('close', (code) => {
                if (code === 0) {
                    const imgs = fs.readdirSync(outputFolder)
                        .filter(f => f.startsWith(baseName + '_') && f.endsWith('.jpg'))
                        .sort().map(f => ({ name: f, path: path.join(outputFolder, f) }));
                    sendVideoLog(`✅ Trích xuất xong: ${imgs.length} ảnh`, 'success');
                    resolve({ success: true, files: imgs });
                } else resolve({ success: false, error: `FFmpeg lỗi (code ${code})` });
            });
            proc.on('error', err => resolve({ success: false, error: err.message }));
        });
    } catch (e) { return { success: false, error: e.message }; }
});