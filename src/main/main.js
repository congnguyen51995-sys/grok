const electron = require('electron');
const { app, BrowserWindow, ipcMain, dialog, shell } = electron;
const protocol = electron.protocol;
const session = electron.session;
const path = require('path');
const fs = require('fs');

// Registry auto-start: mỗi TTS block đăng ký hàm start của mình
const _ttsAutoStartRegistry = [];

// ── GPU auto-detection ─────────────────────────────────────────────────────
let _gpuDevice = null; // 'cuda' | 'directml' | 'cpu'
function detectGPU() {
  if (_gpuDevice) return Promise.resolve(_gpuDevice);
  const { execFile } = require('child_process');
  return new Promise(resolve => {
    // Ưu tiên NVIDIA CUDA
    execFile('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (!err && stdout.trim()) {
          const gpuName = stdout.trim().split('\n')[0].trim();
          _gpuDevice = 'cuda';
          console.log(`[GPU] CUDA detected: ${gpuName} → Python processes will use cuda`);
        } else if (process.platform === 'win32') {
          // DirectML: DX12 GPU (NVIDIA/AMD/Intel) — fallback an toàn trên Windows
          _gpuDevice = 'directml';
          console.log('[GPU] No CUDA → using DirectML (DX12 GPU)');
        } else {
          _gpuDevice = 'cpu';
          console.log('[GPU] No GPU detected → CPU only');
        }
        resolve(_gpuDevice);
      }
    );
  });
}
// Chạy detection ngay lúc khởi động
detectGPU();
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
const { searchStockVideo, downloadStockClip } = require('./services/stock-video');
const RvcEngine = require('./services/rvc-engine');
const aiStudio  = require('./services/aistudio-token-manager');
const { writeGeneratedFiles, renderVideo: remotionRenderVideo, renderThumbnail, generateIllustration, mixAudioWithDucking, getDefaultOutputDir, getSystemPrompt, REMOTION_DIR: REMOTION_DIR_MAIN } = require('./services/remotion-render');

// ==================== KHỞI TẠO LOCAL SERVER (EXPRESS) ====================
const express = require('express');
const cors = require('cors');

const expressApp = express();
expressApp.use(cors());
expressApp.use(express.json({ limit: '50mb' }));

global.googleLabsAuth = {
    bearerToken: '',
    atToken: '',     // anti-CSRF token từ batchexecute (flow.google.com)
    bl: '',          // build label từ batchexecute URL
    fsid: '',        // f.sid session ID từ batchexecute URL
    sapisid: '',     // SAPISID cookie value
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
    pendingImageUpload: null,       // đường dẫn ảnh chờ Extension upload
    imageUploadTriggered: false,    // guard: Extension chỉ nhận lệnh upload 1 lần
    uploadedMediaId: null,          // UUID trả về từ Extension sau khi upload
    pendingVideoGen: null,          // {url, payload} chờ Extension thực thi
    videoGenTriggered: false,       // guard: Extension chỉ nhận lệnh gen 1 lần — tránh gọi API 2 lần
    videoGenResult: null,           // kết quả từ Extension sau khi gọi video gen API
    pendingFlowImageGen: null,      // params chờ Extension tạo ảnh qua flow.google.com batchexecute
    flowImageGenTriggered: false,   // guard: chỉ nhận lệnh 1 lần
    flowImageGenResult: null,       // kết quả download URL từ Extension
    pendingFlowVideoGen: null,      // params chờ Extension trigger YhhmEf video gen
    flowVideoGenTriggered: false,
    flowVideoGenResult: null,
    pendingFlowR2VGen: null,        // params chờ Extension trigger MZZa6b r2v gen
    flowR2VGenTriggered: false,
    flowR2VGenResult: null,
    // ── DOWNLOAD VIDEO QUA EXTENSION (Chrome full-session) ─────────────────────
    pendingVideoDownload: null,     // mediaName cần tải — Extension phát hiện và tải về
    videoDownloadTriggered: false,  // guard: Extension chỉ tải 1 lần — tránh download 2 lần
    videoDownloadDone: false,       // Extension set true khi xong
    videoDownloadError: null,       // Extension set error string nếu lỗi
    videoDownloadPath: null,        // đường dẫn file tạm Extension đã lưu (nếu có)
};

// 1. Hứng Token, Cookie & VÂN TAY từ Extension
expressApp.post('/update-token', (req, res) => {
    const data = req.body;
    if (data.bearerToken) global.googleLabsAuth.bearerToken = data.bearerToken;
    if (data.atToken && data.atToken.startsWith('AIQ-')) global.googleLabsAuth.atToken = data.atToken;
    if (data.bl) global.googleLabsAuth.bl = data.bl;
    if (data.fsid) global.googleLabsAuth.fsid = data.fsid;
    if (data.sapisid) global.googleLabsAuth.sapisid = data.sapisid;
    if (data.cookie) global.googleLabsAuth.cookie = data.cookie;
    if (data.userAgent) global.googleLabsAuth.userAgent = data.userAgent;
    if (data.projectId) global.googleLabsAuth.projectId = data.projectId;
    if (data.recaptchaToken) global.googleLabsAuth.recaptchaToken = data.recaptchaToken;
    if (data.headers) global.googleLabsAuth.rawHeaders = data.headers;
    
    const auth = global.googleLabsAuth;
    console.log(`-> [AutoFlow] Extension data: projectId=${!!auth.projectId} atToken=${!!auth.atToken} bearer=${!!auth.bearerToken} cookie=${auth.cookie?.length||0}chars`);
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
        // Chỉ gửi lệnh needImageUpload 1 lần — sau khi Extension nhận lệnh, đặt cờ triggered
        // để các poll tiếp theo không kích hoạt upload lần 2 (tránh cùng ảnh được upload 2 lần)
        needImageUpload: (global.googleLabsAuth.pendingImageUpload && !global.googleLabsAuth.imageUploadTriggered)
            ? (global.googleLabsAuth.imageUploadTriggered = true, true)
            : false,
        // Chỉ gửi lệnh needVideoGen 1 lần — KHÔNG để Extension gọi Veo API 2 lần cho cùng 1 prompt
        // Đây là nguyên nhân "1 prompt tạo ra 2 video": Extension poll nhanh thấy needVideoGen=true 2 lần
        needVideoGen: (global.googleLabsAuth.pendingVideoGen && !global.googleLabsAuth.videoGenTriggered)
            ? (global.googleLabsAuth.videoGenTriggered = true, true)
            : false,
        needFlowImageGen: (global.googleLabsAuth.pendingFlowImageGen && !global.googleLabsAuth.flowImageGenTriggered)
            ? (global.googleLabsAuth.flowImageGenTriggered = true, true)
            : false,
        needFlowVideoGen: (global.googleLabsAuth.pendingFlowVideoGen && !global.googleLabsAuth.flowVideoGenTriggered)
            ? (global.googleLabsAuth.flowVideoGenTriggered = true, true)
            : false,
        needFlowR2VGen: (global.googleLabsAuth.pendingFlowR2VGen && !global.googleLabsAuth.flowR2VGenTriggered)
            ? (global.googleLabsAuth.flowR2VGenTriggered = true, true)
            : false,
        // Chỉ gửi lệnh downloadVideo 1 lần — sau khi Extension nhận, đặt cờ triggered
        // để các poll tiếp theo không kích hoạt chrome.downloads lần 2 (tránh file trùng)
        downloadVideo: (global.googleLabsAuth.pendingVideoDownload && !global.googleLabsAuth.videoDownloadTriggered)
            ? (global.googleLabsAuth.videoDownloadTriggered = true, global.googleLabsAuth.pendingVideoDownload)
            : null
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json(global.googleLabsAuth.pendingVideoGen);
});

// Nhận kết quả video gen từ Extension
expressApp.post('/api/save-video-gen-result', (req, res) => {
    if (req.body) {
        global.googleLabsAuth.videoGenResult = req.body;
        global.googleLabsAuth.pendingVideoGen = null;
        global.googleLabsAuth.videoGenTriggered = false; // reset để lần gọi tiếp theo hoạt động bình thường
    }
    res.json({ ok: true });
});

// Flow recaptcha request (từ veo-engine, extension fetch token và trả về)
expressApp.get('/api/need-flow-recaptcha', (req, res) => {
    const auth = global.googleLabsAuth;
    const needed = !!(auth.needRecaptcha);
    const action = auth.recaptchaAction || 'IMAGE_GENERATION';
    if (needed) auth.needRecaptcha = false;
    res.json({ needed, action });
});

// Flow.google.com image gen qua Extension
expressApp.get('/api/get-pending-flow-image', (req, res) => {
    const p = global.googleLabsAuth.pendingFlowImageGen;
    if (!p) return res.status(404).json({ error: 'No pending flow image gen' });
    res.json(p);
});
expressApp.post('/api/save-flow-image-result', (req, res) => {
    if (req.body) {
        global.googleLabsAuth.flowImageGenResult = req.body;
        global.googleLabsAuth.pendingFlowImageGen = null;
        global.googleLabsAuth.flowImageGenTriggered = false;
    }
    res.json({ ok: true });
});

// Flow.google.com video gen qua Extension (YhhmEf từ browser MAIN world)
expressApp.get('/api/get-pending-flow-video', (req, res) => {
    const p = global.googleLabsAuth.pendingFlowVideoGen;
    if (!p) return res.status(404).json({ error: 'No pending flow video gen' });
    res.json(p);
});
expressApp.post('/api/save-flow-video-result', (req, res) => {
    if (req.body) {
        global.googleLabsAuth.flowVideoGenResult = req.body;
    }
    res.json({ ok: true });
});

// Flow.google.com r2v (Ingredients) gen qua Extension (MZZa6b từ browser MAIN world)
expressApp.get('/api/get-pending-flow-r2v', (req, res) => {
    const p = global.googleLabsAuth.pendingFlowR2VGen;
    if (!p) return res.status(404).json({ error: 'No pending flow r2v gen' });
    res.json(p);
});
expressApp.post('/api/save-flow-r2v-result', (req, res) => {
    if (req.body) {
        global.googleLabsAuth.flowR2VGenResult = req.body;
    }
    res.json({ ok: true });
});
// Extension poll jwpduf thành công → lưu videoUrl để veo-engine lấy
expressApp.post('/api/save-flow-r2v-video', (req, res) => {
    const { operationId, videoUrl } = req.body || {};
    if (operationId && videoUrl) {
        if (!global.googleLabsAuth.pendingR2VVideoUrls) global.googleLabsAuth.pendingR2VVideoUrls = {};
        global.googleLabsAuth.pendingR2VVideoUrls[operationId] = videoUrl;
        console.log(`[R2V] Extension poll → videoUrl saved for opId ${operationId.substring(0, 16)}...`);
    }
    res.json({ ok: true });
});

// Debug: nhận f.req body từ Extension để phân tích aspect code
let _capturedRpcBodies = [];
expressApp.post('/api/capture-rpc-body', (req, res) => {
    if (req.body) {
        const entry = { ...req.body, capturedAt: new Date().toISOString() };
        _capturedRpcBodies.push(entry);
        if (_capturedRpcBodies.length > 20) _capturedRpcBodies = _capturedRpcBodies.slice(-20);
        console.log(`[RPC CAPTURE] ${entry.rpc} @ ${entry.capturedAt}`);
        console.log(`[RPC CAPTURE] freq preview: ${(entry.freq || '').substring(0, 500)}`);
    }
    res.json({ ok: true });
});
expressApp.get('/api/get-captured-rpc', (req, res) => {
    res.json({ bodies: _capturedRpcBodies });
});

// Nhận mediaId sau khi Extension upload thành công
expressApp.post('/api/save-media-id', (req, res) => {
    if (req.body && req.body.mediaId) {
        global.googleLabsAuth.uploadedMediaId = req.body.mediaId;
        global.googleLabsAuth.pendingImageUpload = null;
        global.googleLabsAuth.imageUploadTriggered = false; // reset để lần upload tiếp theo hoạt động bình thường
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

// Debug log từ Extension — lưu request body của YhhmEf/jwpduf để phân tích
const _debugLogs = [];
expressApp.post('/api/debug-log', (req, res) => {
    if (req.body) {
        const entry = { ts: Date.now(), ...req.body };
        _debugLogs.push(entry);
        if (_debugLogs.length > 50) _debugLogs.shift();
        console.log(`[DEBUG-LOG] tag=${entry.tag} body_len=${(entry.body||'').length}`);
    }
    res.json({ ok: true });
});
expressApp.get('/api/debug-log', (req, res) => {
    res.json({ logs: _debugLogs.slice(-10) });
});
// Ext version endpoint — cho phép Extension auto-reload khi version thay đổi
let _extVersionCounter = 1;
expressApp.get('/grok/api/ext-version', (req, res) => {
    res.json({ version: String(_extVersionCounter) });
});
expressApp.post('/grok/api/ext-version/bump', (req, res) => {
    _extVersionCounter++;
    res.json({ version: String(_extVersionCounter) });
});
// Các grok API routes — cần thiết cho Extension worker
expressApp.post('/grok/update-token', (req, res) => { res.json({ ok: true }); });
expressApp.post('/grok/api/sw-ping', (req, res) => { res.json({ ok: true }); });
expressApp.get('/grok/api/check-request', (req, res) => { res.json({ ok: true }); });
expressApp.post('/grok/api/save-job-result', (req, res) => { res.json({ ok: true }); });
expressApp.post('/grok/api/save-job-error', (req, res) => { res.json({ ok: true }); });
expressApp.post('/grok/api/register-extension', (req, res) => { res.json({ accountIdx: 1 }); });
expressApp.get('/grok/api/account-status', (req, res) => { res.json({ ok: true }); });

expressApp.get('/api/system-status', (req, res) => {
    const licInfo = getLicenseInfo();
    res.json({
        extensionConnected: !!(global.googleLabsAuth?.bearerToken || global.googleLabsAuth?.atToken || global.googleLabsAuth?.projectId),
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

    queueManager = new QueueManager({ db, playwrightEngine });
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

  // Hiển thị window ngay khi renderer render xong lần đầu
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools();

  // Fallback 1: did-finish-load — đảm bảo show nếu ready-to-show bị bỏ lỡ
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show(); }, 300);
  });

  // Fallback 2: timeout 4s — phòng trường hợp cả 2 event trên đều không fire
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show(); }, 4000);

  mainWindow.on('closed', () => mainWindow = null);
}

function setupIpcHandlers() {
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('app:get-system-gemini-keys', () => {
    try {
      const p = path.join(__dirname, 'system-keys.json');
      if (!fs.existsSync(p)) return [];
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(data.gemini) ? data.gemini : [];
    } catch { return []; }
  });
  ipcMain.handle('veo:upload-image', async (event, { imgPath, taskId }) => {
    const sendLog = (text, type = 'info') => mainWindow?.webContents.send('veo-log', { type, text });
    try {
      const mediaId = await VeoEngine.uploadImageAPI(imgPath, sendLog, taskId || 'dna_upload', 'DNA');
      return { ok: !!mediaId, mediaId: mediaId || null };
    } catch (e) {
      sendLog(`[JOBID:${taskId || 'dna_upload'}] ❌ Upload lỗi: ${e.message}`, 'error');
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('veo:clear-upload-cache', () => { VeoEngine.clearUploadCache(); return { ok: true }; });
  ipcMain.handle('image:save-base64', async (event, { base64, filePath }) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buf);
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
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
    let filters;
    if (type && typeof type === 'object' && type.filters) {
      // Gọi với object { filters: [...] } trực tiếp
      filters = type.filters;
    } else {
      filters =
        type === 'video' ? [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] :
        type === 'audio' ? [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'] }] :
        type === 'srt'   ? [{ name: 'Subtitle', extensions: ['srt', 'vtt'] }] :
                           [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }];
    }
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
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

  // Kiểm tra extension đã kết nối Google Labs chưa
  ipcMain.handle('labs:check-auth', () => {
    const auth = global.googleLabsAuth;
    // Connected nếu có atToken, bearerToken, HOẶC projectId (extension đang hoạt động trên flow.google.com)
    const connected = !!(auth?.atToken || auth?.bearerToken || auth?.projectId);
    return { connected, projectId: auth?.projectId || '' };
  });

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

  // Chọn nhiều file audio/video cùng lúc (cho batch mode)
  ipcMain.handle('dialog:select-multiple-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio/Video', extensions: ['mp3','wav','ogg','flac','aac','m4a','mp4','mov','avi','mkv','webm'] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    return result.filePaths.map(p => ({ name: require('path').basename(p), path: p }));
  });

  ipcMain.handle('file:write-text', async (event, { content, filePath, path: pathAlias }) => {
    const targetPath = filePath || pathAlias;
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf8');
      return { success: true, filePath: targetPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── AI Studio Token Manager ───────────────────────────────────────────────
  ipcMain.handle('aistudio:connect', async () => {
    return new Promise((resolve) => {
      aiStudio.connectAndCaptureToken({
        profileDir: path.join(app.getPath('userData'), 'aistudio_profile'),
        onStatus: (msg) => mainWindow?.webContents?.send('aistudio:status', msg),
        onToken: (token) => {
          mainWindow?.webContents?.send('aistudio:status', '✅ Đã kết nối AI Studio!');
          resolve({ success: true });
        },
      }).catch(e => {
        mainWindow?.webContents?.send('aistudio:status', `❌ ${e.message}`);
        resolve({ success: false, error: e.message });
      });
    });
  });

  ipcMain.handle('aistudio:status', async () => aiStudio.getStatus());

  ipcMain.handle('aistudio:generate-image', async (event, { model, prompt, numImages, aspectRatio }) => {
    try {
      const imgs = await aiStudio.generateImage({
        model, prompt, numImages, aspectRatio,
        onStatus: (msg) => mainWindow?.webContents?.send('aistudio:status', msg),
      });
      return { success: true, imgs };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('aistudio:disconnect', async () => {
    aiStudio.closeBrowser();
    return { success: true };
  });

  ipcMain.handle('file:write-base64', async (event, { base64, filePath }) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
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
  // Tách nhạc nền — giữ lại Vocals (giọng nói + SFX), bỏ nhạc instrumental
  // Trả về tempVideo: video gốc với audio được thay bằng Vocals-only track
  ipcMain.handle('audio:separate-vocals', async (event, { inputPath, outputDir, model }) => {
    const { spawn: spawnProc } = require('child_process');
    const scriptPath = path.join(__dirname, 'audio_separate.py');
    const mdl = model || 'htdemucs_ft';
    const sepDir = path.join(app.getPath('temp'), `sep_${Date.now()}`);
    fs.mkdirSync(sepDir, { recursive: true });

    // 1. Tách nhạc bằng Python
    const sepResult = await new Promise((resolve) => {
      let out = '', err = '';
      const gpuDev = _gpuDevice || 'cpu';
      const proc = spawnProc('python3', [scriptPath, inputPath, sepDir, mdl], { env: { ...process.env, FLUXY_GPU_DEVICE: gpuDev } });
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => err += d);
      proc.on('close', code => {
        try {
          const jsonLine = out.trim().split('\n').filter(l => l.trim().startsWith('{')).pop() || '{}';
          const result = JSON.parse(jsonLine);
          if (result.error) return resolve({ success: false, error: result.error });
          return resolve({ success: true, vocals: result.vocals, instrumental: result.instrumental });
        } catch (_) {
          resolve({ success: false, error: err.slice(-400) || `exit ${code}` });
        }
      });
      proc.on('error', e => resolve({ success: false, error: e.message }));
    });

    if (!sepResult.success || !sepResult.vocals) {
      try { fs.rmSync(sepDir, { recursive: true, force: true }); } catch (_) {}
      return sepResult;
    }

    // 2. Tạo temp video: giữ video gốc, thay audio = Vocals track
    const tempVideoPath = path.join(sepDir, `vocals_video_${Date.now()}.mp4`);
    try {
      await new Promise((resolve, reject) => {
        const args = ['-y', '-i', inputPath, '-i', sepResult.vocals,
          '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', tempVideoPath];
        const proc = spawnProc(ffmpegPath, args);
        proc.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}`)));
        proc.on('error', reject);
      });
      return { success: true, vocals: sepResult.vocals, instrumental: sepResult.instrumental, tempVideo: tempVideoPath, sepDir };
    } catch (e) {
      try { fs.rmSync(sepDir, { recursive: true, force: true }); } catch (_) {}
      return { success: false, error: `Ghép video thất bại: ${e.message}` };
    }
  });

  ipcMain.handle('fs:delete-temp-dir', async (_e, dirPath) => {
    try { fs.rmSync(dirPath, { recursive: true, force: true }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('audio:extract-chunk', async (event, { filePath, startSec, durationSec, tempo }) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `fluxy_chunk_${Date.now()}.mp3`);
    try {
      await new Promise((resolve, reject) => {
        // -ss trước -i = fast seek (không chính xác tuyệt đối nhưng đủ cho từng chunk 60s)
        const audioFilters = tempo && tempo !== 1 ? ['-af', `atempo=${tempo}`] : [];
        const args = [
          '-y',
          '-ss', String(startSec),
          '-t',  String(durationSec),
          '-i',  filePath,
          '-vn', '-ac', '1', '-ar', '16000', '-ab', '32k',
          ...audioFilters,
          '-f', 'mp3',
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

  // ── WHISPER LOCAL TRANSCRIPTION (Node.js worker_thread, không block renderer) ─
  (() => {
    const { Worker: NodeWorker } = require('worker_threads');
    const workerThreadPath = path.join(__dirname, 'workers/whisper-thread.js');

    // Singleton worker — load model 1 lần, tái dùng cho tất cả chunks
    let _whisperWorker = null;
    let _pendingCbs    = new Map();

    function getWhisperWorker(senderWebContents) {
      if (_whisperWorker) return _whisperWorker;

      const wasmDir   = path.join(__dirname, '../../dist/assets');
      const cacheDir  = path.join(app.getPath('userData'), 'whisper-cache');
      const ffmpegBin = require('ffmpeg-static');

      _whisperWorker = new NodeWorker(workerThreadPath, {
        workerData: { ffmpegPath: ffmpegBin, wasmDir, cacheDir },
      });

      _whisperWorker.on('message', (msg) => {
        if (msg.type === 'model_progress' || msg.type === 'log') {
          // Forward progress to renderer
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send('whisper:progress', msg);
          }
        } else if (msg.type === 'model_ready') {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send('whisper:progress', { type: 'model_ready' });
          }
        } else if (msg.type === 'result' || msg.type === 'error') {
          const cb = _pendingCbs.get(msg.id);
          if (cb) {
            _pendingCbs.delete(msg.id);
            if (msg.type === 'result') cb.resolve(msg.result);
            else cb.reject(new Error(msg.error));
          }
        }
      });

      _whisperWorker.on('error', (err) => {
        console.error('[WhisperThread] Worker error:', err);
        // Reject all pending
        _pendingCbs.forEach(cb => cb.reject(err));
        _pendingCbs.clear();
        _whisperWorker = null; // allow recreation
      });

      _whisperWorker.on('exit', (code) => {
        if (code !== 0) console.warn('[WhisperThread] Worker exited with code', code);
        _whisperWorker = null;
      });

      return _whisperWorker;
    }

    ipcMain.handle('whisper:transcribe-chunk', async (event, { filePath, startSec, durationSec }) => {
      const id = `${Date.now()}_${Math.random()}`;
      return new Promise((resolve, reject) => {
        _pendingCbs.set(id, { resolve, reject });
        const worker = getWhisperWorker(event.sender);
        worker.postMessage({ type: 'transcribe', id, filePath, startSec, durationSec });
      })
        .then(result  => ({ success: true,  result }))
        .catch(err    => ({ success: false, error: err.message }));
    });

    ipcMain.handle('whisper:preload-model', async (event) => {
      try {
        const worker = getWhisperWorker(event.sender);
        worker.postMessage({ type: 'preload' });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  })();

  // ── LƯU AUDIO ELEVENLABS (base64 → MP3 file) ───────────────────────────
  ipcMain.handle('elevenlabs:save-audio', async (event, { base64, base64Parts, outputPath }) => {
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let buf;
      if (base64Parts && base64Parts.length > 0) {
        buf = Buffer.concat(base64Parts.map(b => Buffer.from(b, 'base64')));
      } else {
        buf = Buffer.from(base64, 'base64');
      }
      fs.writeFileSync(outputPath, buf);
      return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Nối nhiều file audio (MP3) với gap tùy chỉnh ─────────────────────────────
  ipcMain.handle('elevenlabs:merge-audio', async (event, { files, gapMs = 500, outputPath }) => {
    const tempDir = path.join(app.getPath('temp'), `el_merge_${Date.now()}`);
    try {
      if (!files || files.length < 1) return { success: false, error: 'Không có file' };
      fs.mkdirSync(tempDir, { recursive: true });
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      // Nếu chỉ 1 file → copy thẳng
      if (files.length === 1) {
        fs.copyFileSync(files[0], outputPath);
        return { success: true, path: outputPath };
      }

      // Tạo file silence gap (nếu gapMs > 0)
      let silencePath = null;
      if (gapMs > 0) {
        silencePath = path.join(tempDir, 'silence.mp3');
        const silRes = await runFFmpeg([
          '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
          '-t', String(gapMs / 1000),
          '-c:a', 'libmp3lame', '-b:a', '128k', '-y', silencePath
        ]);
        if (!silRes.ok) silencePath = null; // bỏ silence nếu fail
      }

      // Tạo concat list
      const listFile = path.join(tempDir, 'concat.txt');
      const lines = [];
      for (let i = 0; i < files.length; i++) {
        lines.push(`file '${files[i].replace(/'/g, "'\\''")}'`);
        if (silencePath && i < files.length - 1) {
          lines.push(`file '${silencePath.replace(/'/g, "'\\''")}'`);
        }
      }
      fs.writeFileSync(listFile, lines.join('\n'), 'utf8');

      // Concat
      const concatRes = await runFFmpeg([
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c', 'copy', '-y', outputPath
      ]);

      if (!concatRes.ok) return { success: false, error: concatRes.stderr.slice(-300) };
      return { success: true, path: outputPath };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
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

  async function elFetch(url, opts = {}) {
    return fetch(url, opts);
  }
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
      const res = await elFetch('https://api.elevenlabs.io/v1/user/subscription', {
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
      // 2. Kiểm tra quyền truy cập voices API (không test TTS để tránh bị flag)
      try {
        const vCtrl = new AbortController();
        const vt = setTimeout(() => vCtrl.abort(), 9000);
        const vRes = await elFetch('https://api.elevenlabs.io/v1/voices?page_size=1', {
          headers: { 'xi-api-key': key }, signal: vCtrl.signal
        });
        clearTimeout(vt);
        if (!vRes.ok) {
          const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'invalid', lastChecked: Date.now() };
          elKeyCache.set(key, d); return d;
        }
      } catch (_) { /* bỏ qua lỗi mạng tạm thời */ }
      // Subscription OK + voices API OK → key hợp lệ (không test TTS)
      const d = { remaining, limit: sub.character_limit || 0, used: sub.character_count || 0, status: 'valid', lastChecked: Date.now() };
      elKeyCache.set(key, d); return d;
    } catch (e) {
      const d = { remaining: 0, limit: 0, status: 'error', lastChecked: Date.now() };
      elKeyCache.set(key, d); return d;
    }
  }

  // Thời gian cooldown cho key bị suspended (2 giờ) và invalid (24 giờ)
  const EL_SUSPEND_COOLDOWN = 2 * 60 * 60 * 1000;   // 2 giờ
  const EL_INVALID_COOLDOWN = 24 * 60 * 60 * 1000;  // 24 giờ

  // Lấy key tốt nhất (ưu tiên nhiều credit nhất, bỏ qua excludeKeys)
  async function elGetBestKey(userKeys = [], excludeKeys = new Set()) {
    const allKeys = [...EL_SYSTEM_KEYS, ...userKeys.map(k => k.key || k)];

    // Reset suspended/invalid keys đã hết cooldown về 'unchecked' để thử lại
    for (const k of allKeys) {
      const c = elKeyCache.get(k);
      if (!c) continue;
      if (c.status === 'suspended' && Date.now() - c.lastChecked >= EL_SUSPEND_COOLDOWN) {
        elKeyCache.delete(k); // xóa cache → sẽ re-check lại
      } else if (c.status === 'invalid' && Date.now() - c.lastChecked >= EL_INVALID_COOLDOWN) {
        elKeyCache.delete(k);
      }
    }

    // 1. Lấy từ cache: valid + còn credit + chưa hết hạn
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
        const res = await elFetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': bestKey, 'Content-Type': 'application/json', 'accept': 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: (stability||50)/100, similarity_boost: (similarity||75)/100, style: (style||0)/100, use_speaker_boost: true } }),
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) {
          const cached = elKeyCache.get(bestKey) || {};
          if (res.status === 401) {
            // Kiểm tra nếu là "unusual_activity" → đánh dấu suspended, thử key khác
            let errBody = '';
            try { errBody = await res.text(); } catch (_) {}
            const isUnusual = /unusual_activity|free.*tier.*disabled/i.test(errBody);
            elKeyCache.set(bestKey, { ...cached, status: isUnusual ? 'suspended' : 'invalid', remaining: 0, lastChecked: Date.now() });
            log(`⚠️ Key ${keyTag} ${isUnusual ? 'bị tạm khóa (unusual activity)' : 'không hợp lệ (401)'} → chuyển key tiếp...`, 'warn');
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

  // ── Clone giọng ElevenLabs (Instant Voice Cloning) ───────────────────────
  ipcMain.handle('elevenlabs:clone-voice', async (event, { name, description, filePaths, userKeys }) => {
    const triedKeys = new Set();
    while (true) {
      const bestKey = await elGetBestKey(userKeys || [], triedKeys);
      if (!bestKey) return { success: false, error: 'Hết key khả dụng. Thêm key hợp lệ để dùng tính năng này.' };
      triedKeys.add(bestKey);
      try {
        const FormData = require('form-data');
        const form = new FormData();
        form.append('name', name || 'Cloned Voice');
        if (description) form.append('description', description);
        for (const fp of filePaths) {
          form.append('files', fs.createReadStream(fp), require('path').basename(fp));
        }
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 120000);
        const res = await elFetch('https://api.elevenlabs.io/v1/voices/add', {
          method: 'POST',
          headers: { 'xi-api-key': bestKey, ...form.getHeaders() },
          body: form,
          signal: ctrl.signal
        });
        clearTimeout(t);
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (res.status === 401 || res.status === 403) {
            elKeyCache.set(bestKey, { ...(elKeyCache.get(bestKey) || {}), status: 'invalid' });
            continue;
          }
          if (res.status === 422) return { success: false, error: `Lỗi 422: ${errText.slice(0, 300)}` };
          if (res.status === 429) {
            elKeyCache.set(bestKey, { ...(elKeyCache.get(bestKey) || {}), status: 'quota' });
            continue;
          }
          return { success: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
        }
        const data = await res.json();
        const isSys = EL_SYSTEM_KEYS.includes(bestKey);
        return { success: true, voiceId: data.voice_id, name: name, keyInfo: `${isSys ? '🔑 Hệ thống' : '👤 Cá nhân'} [${bestKey.substring(0,8)}...]` };
      } catch (e) {
        if (e.name === 'AbortError') { triedKeys.add(bestKey); continue; }
        return { success: false, error: e.message };
      }
    }
  });

  // ── Xoá giọng clone ElevenLabs ───────────────────────────────────────────
  ipcMain.handle('elevenlabs:delete-voice', async (event, { voiceId, userKeys }) => {
    const bestKey = await elGetBestKey(userKeys || [], new Set());
    if (!bestKey) return { success: false, error: 'Không có key khả dụng' };
    try {
      const res = await elFetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        method: 'DELETE', headers: { 'xi-api-key': bestKey }
      });
      return res.ok ? { success: true } : { success: false, error: `HTTP ${res.status}` };
    } catch (e) { return { success: false, error: e.message }; }
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
      const res = await elFetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': bestKey }, signal: ctrl.signal });
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
      let args;
      if (aspectRatio === '9:16') {
        // Giữ nguyên toàn bộ frame gốc, đặt vào canvas 9:16 với nền blur
        // bg: scale fill 1080x1920 rồi blur mạnh
        // fg: scale fit width=1080, giữ tỉ lệ gốc → hiển thị đầy đủ
        const filterComplex = [
          '[0:v]split[a][b]',
          '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:4[bg]',
          '[b]scale=1080:-2[fg]',
          '[bg][fg]overlay=(W-w)/2:(H-h)/2[v]',
        ].join(';');
        args = [
          '-y', '-ss', String(startTime), '-to', String(endTime), '-i', inputPath,
          '-filter_complex', filterComplex,
          '-map', '[v]', '-map', '0:a?',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-c:a', 'aac', '-b:a', '128k',
          outputPath,
        ];
      } else if (aspectRatio === '1:1') {
        const cropFilter = "crop='min(iw,ih):min(iw,ih):(iw-min(iw,ih))/2:(ih-min(iw,ih))/2'";
        args = ['-y', '-ss', String(startTime), '-to', String(endTime), '-i', inputPath, '-vf', cropFilter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '128k', outputPath];
      } else {
        // 16:9: crop center
        const cropFilter = "crop='if(gt(iw/ih,16/9),ih*16/9,iw):if(gt(iw/ih,16/9),ih,iw*9/16):(iw-if(gt(iw/ih,16/9),ih*16/9,iw))/2:(ih-if(gt(iw/ih,16/9),ih,iw*9/16))/2'";
        args = ['-y', '-ss', String(startTime), '-to', String(endTime), '-i', inputPath, '-vf', cropFilter, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '128k', outputPath];
      }
      const result = await runFFmpeg(args);
      if (!result.ok || !fs.existsSync(outputPath)) return { success: false, error: 'FFmpeg lỗi: ' + result.stderr.slice(-300) };
      return { success: true, outputPath };
    } catch (e) { return { success: false, error: e.message }; }
  });


}

function setupProtocol() {
  protocol.registerFileProtocol('local', (request, callback) => {
    try { const decodedPath = decodeURIComponent(request.url.replace('local://', '')).replace(/^\//, ''); fs.existsSync(decodedPath) ? callback({ path: decodedPath }) : callback({ error: -6 }); } catch (error) { callback({ error: -2 }); }
  });
}

// Đọc file ảnh local → base64 data URL (dùng cho canvas preview)
ipcMain.handle('read-image-as-dataurl', (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', svg:'image/svg+xml' }[ext] || 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch(_) { return null; }
});

app.whenReady().then(async () => {
  try {
    await initializeServices();
    setupIpcHandlers();
    registerUpdaterHandlers();
    setupProtocol();
    createWindow();
    const mainWin = BrowserWindow.getAllWindows()[0];
    registerDownloaderHandlers(mainWin);
    // Auto-check update sau 5s để app ổn định trước
    setTimeout(() => checkForUpdates(mainWin), 5000);
    // Auto-start tất cả TTS server đã cài sau 4s (để renderer load xong)
    setTimeout(() => {
      const win = BrowserWindow.getAllWindows()[0];
      for (const { name, startFn } of _ttsAutoStartRegistry) {
        startFn(win).catch(e => console.log(`[auto-start] ${name} lỗi:`, e.message));
      }
    }, 4000);
  } catch (error) { dialog.showErrorBox('Khởi động thất bại', error.message); app.quit(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// ── Detect GPU (dùng chung cho tất cả TTS engine) ─────────────────────────
// Trả về: 'nvidia' | 'amd' | 'intel_arc' | 'cpu'
async function detectGpuType() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('wmic path win32_VideoController get Name /value', {
      encoding: 'utf8', timeout: 6000, windowsHide: true
    });
    const names = (out.match(/Name=(.+)/gi) || []).map(l => l.replace(/^Name=/i,'').trim().toLowerCase());
    const gpuStr = names.join(' ');
    if (/nvidia|geforce|quadro|rtx\s*\d|gtx\s*\d|tesla/.test(gpuStr)) return 'nvidia';
    if (/amd|radeon|rx\s*\d|vega|firepro/.test(gpuStr)) return 'amd';
    if (/intel.*arc|intel.*xe\s*graphics/.test(gpuStr)) return 'intel_arc';
    return 'cpu';
  } catch(_) { return 'cpu'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// VIENEU TTS — Local Vietnamese TTS (on-device, GGUF Q8, voice cloning)
// ══════════════════════════════════════════════════════════════════════════════
{
  const https  = require('https');
  const http   = require('http');
  let _customVieNeuDir = null;
  (async () => {
    try {
      const v = await db.getSetting('vieneu_dir', null);
      if (v && fs.existsSync(v)) _customVieNeuDir = v;
    } catch (_) {}
  })();
  const getVieNeuDir = () => _customVieNeuDir || path.join(app.getPath('userData'), 'vieneu_env');

  const VIENEU_DIR   = () => getVieNeuDir();
  const PYTHON_DIR   = () => path.join(getVieNeuDir(), 'python');
  const PYTHON_EXE   = () => path.join(getVieNeuDir(), 'python', 'python.exe');
  const MODEL_CACHE  = () => path.join(getVieNeuDir(), 'models');
  const SYNTH_SCRIPT = () => path.join(getVieNeuDir(), 'synth.py');
  const VOICES_SCRIPT= () => path.join(getVieNeuDir(), 'list_voices.py');
  const STATUS_FILE  = () => path.join(getVieNeuDir(), 'setup_done.json');

  const PY_VERSION   = '3.11.9';
  const PY_ZIP_URL   = `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`;
  const PY_ZIP_PATH  = () => path.join(getVieNeuDir(), 'python_embed.zip');
  const GETPIP_URL   = 'https://bootstrap.pypa.io/get-pip.py';
  const GETPIP_PATH  = () => path.join(getVieNeuDir(), 'get-pip.py');

  let _vieNeuSetupAbort = false;
  let _vieNeuSynthProc  = null;

  function sendVieNeuProgress(step, percent, message) {
    try {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('vieneu-progress', { step, percent, message });
    } catch (_) {}
  }

  function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const get  = url.startsWith('https') ? https : http;
      get.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) { file.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        res.on('data', chunk => {
          done += chunk.length;
          file.write(chunk);
          if (total > 0) sendVieNeuProgress('download', Math.round(done / total * 100), `Tải ${Math.round(done/1048576)}/${Math.round(total/1048576)} MB...`);
        });
        res.on('end', () => { file.end(() => resolve()); });
        res.on('error', err => { file.destroy(); reject(err); });
      }).on('error', err => { file.destroy(); reject(err); });
    });
  }

  const TORCH_SHORT_DIR = 'C:\\FV\\t'; // path ngắn cố định để tránh WinError 206

  // ── Cài onnxruntime GPU variant sau khi vieneu đã cài onnxruntime CPU ─────
  async function _installOnnxruntimeGpu(pyExe, gpuType, progress) {
    if (gpuType === 'cpu') return; // không cần làm gì
    const { spawn: _sp } = require('child_process');
    const run = (args, label) => new Promise((res, rej) => {
      if (progress) progress('install', null, label);
      const p = _sp(pyExe, args, { windowsHide: true, env: { ...process.env } });
      let stderr = '';
      p.stderr.on('data', d => { stderr += d.toString(); });
      p.on('close', code => code === 0 ? res() : rej(new Error(stderr.slice(-600) || `exit ${code}`)));
      p.on('error', rej);
    });

    try {
      // Bỏ onnxruntime CPU để tránh xung đột
      await run(['-m', 'pip', 'uninstall', 'onnxruntime', '-y', '-q'], 'Gỡ onnxruntime CPU...');
    } catch(_) {}

    if (gpuType === 'nvidia') {
      await run(['-m', 'pip', 'install', 'onnxruntime-gpu', '--no-warn-script-location', '-q'],
        'Cài onnxruntime-gpu (CUDA)...');
    } else {
      // AMD hoặc Intel Arc → DirectML (Windows DirectX)
      await run(['-m', 'pip', 'install', 'onnxruntime-directml', '--no-warn-script-location', '-q'],
        `Cài onnxruntime-directml (${gpuType === 'amd' ? 'AMD' : 'Intel Arc'} DirectML)...`);
    }
  }

  // Cài torch+torchaudio CPU — tự fallback sang path ngắn nếu WinError 206
  async function _installTorchSafe(pyExe, progress) {
    const { spawn: _sp } = require('child_process');
    const run = (args) => new Promise((res, rej) => {
      const p = _sp(pyExe, args, { windowsHide: true, env: { ...process.env } });
      let stderr = '';
      p.stderr.on('data', d => { stderr += d.toString(); });
      p.on('close', code => code === 0 ? res() : rej(new Error(stderr.slice(-800) || `exit ${code}`)));
      p.on('error', rej);
    });

    const isPathTooLong = (msg) => msg.includes('206') || msg.toLowerCase().includes('too long') || msg.toLowerCase().includes('filename or extension');

    // Luôn cài vào path ngắn C:\FV\t để tránh WinError 206 (path > 260 ký tự)
    // --ignore-installed: bỏ qua bước pip tự uninstall torch cũ (tránh lỗi no RECORD file)
    if (progress) progress('install', 45, `Cài torch vào ${TORCH_SHORT_DIR}...`);
    try { require('fs').mkdirSync(TORCH_SHORT_DIR, { recursive: true }); } catch(_) {}

    // Xóa thủ công torch cũ trong site-packages (nếu cài dở, không có RECORD)
    try {
      const sitePkg = require('child_process').execFileSync(pyExe,
        ['-c', 'import site; print(site.getsitepackages()[0])'],
        { encoding: 'utf8', timeout: 10000 }).trim();
      const _fs2 = require('fs'), _pt2 = require('path');
      for (const entry of (_fs2.readdirSync(sitePkg) || [])) {
        if (/^torch(audio|gen|vision)?[-.]?/i.test(entry)) {
          try { _fs2.rmSync(_pt2.join(sitePkg, entry), { recursive: true, force: true }); } catch(_) {}
        }
      }
    } catch(_) {}

    await run(['-m', 'pip', 'install', 'torch==2.1.0', 'torchaudio==2.1.0',
      '--index-url', 'https://download.pytorch.org/whl/cpu',
      '--ignore-installed',
      '--no-warn-script-location', '-q',
      '--target', TORCH_SHORT_DIR]);

    // Ghim numpy<2 — torch 2.1.0 được compile cho NumPy 1.x, không chạy được với NumPy 2.x
    try { await run(['-m', 'pip', 'install', 'numpy<2', '-q', '--force-reinstall']); } catch(_) {}

    if (progress) progress('install', 65, `✅ Torch + numpy<2 cài xong`);
  }

  function runPython(args, env = {}, _pyExeOverride) {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile(_pyExeOverride || PYTHON_EXE(), args, {
        env: { ...process.env, HF_HOME: MODEL_CACHE(), TRANSFORMERS_OFFLINE: '0', ...env },
        timeout: 0,
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      });
    });
  }

  function writeSynthScripts() {
    fs.mkdirSync(VIENEU_DIR(), { recursive: true });
    const _ffmpegBin = (() => { try { return require('ffmpeg-static'); } catch(_) { return 'ffmpeg'; } })();
    const _modelCache = MODEL_CACHE();

    fs.writeFileSync(SYNTH_SCRIPT(), `
import sys, json, os, warnings, tempfile, subprocess, shutil
warnings.filterwarnings('ignore')
# Torch có thể được cài ở path ngắn C:\\FV\\t để tránh WinError 206
_torch_short = r'C:\\FV\\t'
if os.path.isdir(_torch_short) and _torch_short not in sys.path:
    sys.path.insert(0, _torch_short)
os.environ['HF_HOME'] = r'${_modelCache.replace(/\\/g, '\\\\')}'
from vieneu import Vieneu

FFMPEG      = shutil.which('ffmpeg') or r'${_ffmpegBin.replace(/\\/g, '\\\\')}'
MAX_REF_SEC = 15    # 15s ref audio: đủ đặc trưng giọng, an toàn RAM
TARGET_SR   = 16000 # VieNeu yêu cầu 16kHz
MAX_CHUNK   = 300   # ký tự/chunk — đủ nhỏ để tránh decoder OOM

def log(msg):
    print(msg, file=sys.stderr, flush=True)

# ── Chuẩn hóa ref audio ──────────────────────────────────────────────────────
def prepare_ref_audio(path, max_sec=MAX_REF_SEC):
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp_path = tmp.name; tmp.close()
    try:
        ret = subprocess.run(
            [FFMPEG, '-y', '-i', path, '-t', str(max_sec),
             '-ar', str(TARGET_SR), '-ac', '1', '-sample_fmt', 's16', tmp_path],
            capture_output=True, timeout=60)
        if ret.returncode == 0: return tmp_path
    except Exception: pass
    try:
        import soundfile as sf, numpy as np
        data, sr = sf.read(path)
        if data.ndim > 1: data = data.mean(axis=1)
        if sr != TARGET_SR:
            try:
                from scipy.signal import resample_poly
                from math import gcd
                g = gcd(TARGET_SR, sr)
                data = resample_poly(data, TARGET_SR // g, sr // g); sr = TARGET_SR
            except Exception: pass
        max_s = int(sr * max_sec)
        if len(data) > max_s: data = data[:max_s]
        sf.write(tmp_path, data, sr, subtype='PCM_16')
        return tmp_path
    except Exception: pass
    return path

# ── Tách text thành chunks <= MAX_CHUNK ký tự tại ranh giới câu ─────────────
def split_text(text, max_chars=MAX_CHUNK):
    NL = chr(10)
    ENDERS = set('.!?…')
    sentences, buf = [], ''
    for i, ch in enumerate(text):
        buf += ch
        if ch in ENDERS:
            nxt = text[i+1] if i+1 < len(text) else ''
            if nxt not in ENDERS:
                sentences.append(buf.strip()); buf = ''
        elif ch == NL:
            if buf.strip(): sentences.append(buf.strip())
            buf = ''
    if buf.strip(): sentences.append(buf.strip())

    chunks, cur = [], ''
    for s in sentences:
        if not s: continue
        if len(cur) + len(s) + 1 <= max_chars:
            cur = (cur + ' ' + s).strip() if cur else s
        else:
            if cur: chunks.append(cur)
            while len(s) > max_chars:
                cut = s.rfind(',', 0, max_chars)
                if cut < 10: cut = s.rfind(' ', 0, max_chars)
                if cut < 10: cut = max_chars
                chunks.append(s[:cut].strip()); s = s[cut:].strip()
            cur = s
    if cur: chunks.append(cur)
    return [c for c in chunks if c.strip()]

# ── Ghép nhiều WAV bằng ffmpeg concat demuxer (không tốn RAM) ───────────────
def concat_wavs_ffmpeg(wav_paths, out_path):
    list_file = tempfile.NamedTemporaryFile(suffix='.txt', delete=False, mode='w', encoding='utf-8')
    for p in wav_paths:
        list_file.write(f"file '{p.replace(chr(39), chr(39)+chr(92)+chr(39)+chr(39))}'" + chr(10))
    list_file.close()
    try:
        subprocess.run(
            [FFMPEG, '-y', '-f', 'concat', '-safe', '0', '-i', list_file.name,
             '-c', 'copy', out_path],
            capture_output=True, timeout=600, check=True)
    finally:
        try: os.unlink(list_file.name)
        except: pass

# ── Synthesize 1 chunk → temp WAV ───────────────────────────────────────────
def infer_one(tts, text, tmp_dir, idx, **kwargs):
    tmp_path = os.path.join(tmp_dir, f'chunk_{idx:05d}.wav')
    audio = tts.infer(text=text, **kwargs)
    tts.save(audio, tmp_path)
    return tmp_path

# ── Main synthesize: chunks → temp WAVs → concat ────────────────────────────
def synthesize_all(tts, text, out_path, **kwargs):
    chunks = split_text(text)
    total  = len(chunks)
    if total == 0:
        log('⚠️ Không có text để tổng hợp')
        return
    log(f'📄 {len(text)} ký tự → {total} đoạn')
    tmp_dir = tempfile.mkdtemp(prefix='vieneu_chunks_')
    wav_paths = []
    try:
        for i, chunk in enumerate(chunks, 1):
            pct = int(i / total * 100)
            log(f'🔊 [{i}/{total}] {pct}% — {chunk[:50]}{"…" if len(chunk)>50 else ""}')
            wav_paths.append(infer_one(tts, chunk, tmp_dir, i, **kwargs))
        if len(wav_paths) == 1:
            import shutil as _sh; _sh.copy2(wav_paths[0], out_path)
        else:
            log(f'🔗 Ghép {len(wav_paths)} đoạn...')
            concat_wavs_ffmpeg(wav_paths, out_path)
    finally:
        for p in wav_paths:
            try: os.unlink(p)
            except: pass
        try: os.rmdir(tmp_dir)
        except: pass

# ── Đọc cmd từ file (tránh ENAMETOOLONG với text dài) ───────────────────────
_arg1 = sys.argv[1]
if os.path.isfile(_arg1):
    with open(_arg1, 'r', encoding='utf-8') as _f:
        cmd = json.loads(_f.read())
    try: os.unlink(_arg1)
    except: pass
else:
    cmd = json.loads(_arg1)

model_id  = cmd.get('modelId')
text      = cmd['text']
out_path  = cmd['outputPath']
voice_id  = cmd.get('voiceId')
ref_audio = cmd.get('refAudio')
ref_text  = cmd.get('refText', '')

try:
    import onnxruntime as _ort
    _provs = _ort.get_available_providers()
    if 'CUDAExecutionProvider' in _provs: log('🎮 ONNX GPU: CUDA (NVIDIA)')
    elif 'DmlExecutionProvider' in _provs: log('🎮 ONNX GPU: DirectML (AMD/Intel)')
    else: log('🖥️ ONNX: CPU only')
except: pass

log('⚙️ Tải model VieNeu...')
tts = Vieneu(model=model_id) if model_id else Vieneu()
log('✅ Model sẵn sàng')

os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)

if ref_audio:
    log(f'🎤 Chuẩn hóa ref audio ({os.path.basename(ref_audio)})...')
    prepared_ref = prepare_ref_audio(ref_audio)
    log('🧠 Clone giọng + tổng hợp...')
    synthesize_all(tts, text, out_path, ref_audio=prepared_ref, ref_text=ref_text)
    if prepared_ref != ref_audio:
        try: os.unlink(prepared_ref)
        except: pass
elif voice_id:
    log(f'🔊 Giọng preset: {voice_id}')
    vd = tts.get_preset_voice(voice_id)
    synthesize_all(tts, text, out_path, voice=vd)
else:
    synthesize_all(tts, text, out_path)

log('✅ Xong!')
print(json.dumps({'success': True, 'path': out_path}))
`, 'utf8');

    fs.writeFileSync(VOICES_SCRIPT(), `
import sys, json, os, warnings
warnings.filterwarnings('ignore')
os.environ['HF_HOME'] = r'${_modelCache.replace(/\\/g, '\\\\')}'
from vieneu import Vieneu
tts = Vieneu()
voices = tts.list_preset_voices()
print(json.dumps(voices))
`, 'utf8');
  }

  const MODEL_IDS = {
    q4:      'pnnbao-ump/VieNeu-TTS-q4-gguf',
    q8:      'pnnbao-ump/VieNeu-TTS-q8-gguf',
    pytorch: 'pnnbao-ump/VieNeu-TTS',
  };

  async function setupVieNeu(modelKey = 'q4') {
    _vieNeuSetupAbort = false;
    const _vDir = VIENEU_DIR();
    const _pyDir = PYTHON_DIR();
    const _pyExe = PYTHON_EXE();
    const _pyZip = PY_ZIP_PATH();
    const _getPip = GETPIP_PATH();
    const _statusFile = STATUS_FILE();
    const _modelCacheDir = MODEL_CACHE();

    fs.mkdirSync(_vDir, { recursive: true });
    fs.mkdirSync(_modelCacheDir, { recursive: true });

    // ── 1. Download Python embeddable ──────────────────────────────────────────
    if (!fs.existsSync(_pyExe)) {
      // Dọn thư mục python cũ nếu có (tránh file rác từ lần cài trước)
      if (fs.existsSync(_pyDir)) {
        const { execSync: _es } = require('child_process');
        try { _es(`rd /s /q "${_pyDir}"`, { shell: true, timeout: 30000 }); } catch (_) {}
      }
      if (fs.existsSync(_pyZip)) { try { fs.unlinkSync(_pyZip); } catch (_) {} }

      sendVieNeuProgress('download', 0, 'Tải Python 3.11 (~27MB)...');
      await downloadFile(PY_ZIP_URL, _pyZip);
      if (_vieNeuSetupAbort) throw new Error('Đã hủy');

      // ── 2. Giải nén ──────────────────────────────────────────────────────────
      sendVieNeuProgress('extract', 0, 'Giải nén Python...');
      {
        const { execSync } = require('child_process');
        fs.mkdirSync(_pyDir, { recursive: true });
        execSync(`powershell -NonInteractive -Command "Expand-Archive -Path '${_pyZip}' -DestinationPath '${_pyDir}' -Force"`, { timeout: 180000 });
      }
      fs.unlinkSync(_pyZip);

      // Kiểm tra python.exe có thực sự tồn tại sau khi giải nén không
      if (!fs.existsSync(_pyExe)) throw new Error('Giải nén Python thất bại — python.exe không tìm thấy sau khi extract');

      // ── 3. Fix _pth để enable site-packages ──────────────────────────────────
      const pthFile = fs.readdirSync(_pyDir).find(f => f.match(/python\d+\._pth$/));
      if (pthFile) {
        const pthPath = path.join(_pyDir, pthFile);
        let pthContent = fs.readFileSync(pthPath, 'utf8');
        pthContent = pthContent.replace('#import site', 'import site');
        fs.writeFileSync(pthPath, pthContent);
      }
    }

    // ── 4. Cài pip ─────────────────────────────────────────────────────────────
    const pipExe = path.join(_pyDir, 'Scripts', 'pip.exe');
    if (!fs.existsSync(pipExe)) {
      sendVieNeuProgress('pip', 10, 'Tải get-pip.py...');
      await downloadFile(GETPIP_URL, _getPip);
      sendVieNeuProgress('pip', 20, 'Cài pip...');
      await runPython([_getPip, '--no-warn-script-location'], {}, _pyExe);
      if (fs.existsSync(_getPip)) fs.unlinkSync(_getPip);
    }

    // ── 5a. Detect GPU ────────────────────────────────────────────────────────
    sendVieNeuProgress('install', 20, 'Quét card đồ họa...');
    const gpuType = await detectGpuType();
    const gpuLabel = { nvidia:'NVIDIA (CUDA)', amd:'AMD (DirectML)', intel_arc:'Intel Arc (DirectML)', cpu:'CPU' }[gpuType] || 'CPU';
    sendVieNeuProgress('install', 22, `Phát hiện: ${gpuLabel}`);

    // ── 5b. Cài vieneu + onnxruntime GPU ─────────────────────────────────────
    sendVieNeuProgress('install', 25, 'Cài vieneu (ONNX, ~100MB)...');
    await runPython(['-m', 'pip', 'install', 'vieneu', '--no-warn-script-location', '-q'], {}, _pyExe);

    if (gpuType !== 'cpu') {
      sendVieNeuProgress('install', 35, `Cài onnxruntime cho ${gpuLabel}...`);
      try {
        await _installOnnxruntimeGpu(_pyExe, gpuType, (_, __, msg) => sendVieNeuProgress('install', 35, msg));
        sendVieNeuProgress('install', 40, `✅ ONNX GPU (${gpuLabel}) sẵn sàng`);
      } catch(e) {
        sendVieNeuProgress('install', 40, `⚠️ GPU install thất bại, fallback CPU: ${e.message?.slice(0,80)}`);
      }
    }

    // Ghim numpy<2 ngay sau vieneu — tránh numpy 2.x không tương thích với torch 2.1.0
    sendVieNeuProgress('install', 42, 'Ghim numpy<2 (tương thích torch 2.1.0)...');
    try { await runPython(['-m', 'pip', 'install', 'numpy<2', '-q', '--force-reinstall'], {}, _pyExe); } catch(_) {}

    sendVieNeuProgress('install', 45, 'Cài torch + torchaudio CPU (~300MB, cần cho voice cloning)...');
    // Bật LongPath trước để tránh WinError 206 trên Windows 10 chưa bật
    try { require('child_process').execSync('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f', { windowsHide: true, stdio: 'ignore' }); } catch(_) {}
    await _installTorchSafe(_pyExe, sendVieNeuProgress);

    // ── 6. Viết script synth ───────────────────────────────────────────────────
    writeSynthScripts();

    // ── 7. Warm-up: tải model lần đầu ─────────────────────────────────────────
    const modelId   = MODEL_IDS[modelKey] || MODEL_IDS.q4;
    const modelSize = modelKey === 'q4' ? '~200MB' : modelKey === 'q8' ? '~400MB' : '~1GB';
    sendVieNeuProgress('model', 65, `Tải model VieNeu (${modelSize}, chỉ lần đầu)...`);
    const warmupScript = `
import os, warnings
warnings.filterwarnings('ignore')
os.environ['HF_HOME'] = r'${_modelCacheDir.replace(/\\/g, '\\\\')}'
from vieneu import Vieneu
tts = Vieneu(model='${modelId}')
audio = tts.infer(text='Xin chào')
print('OK')
`;
    const warmupPath = path.join(_vDir, '_warmup.py');
    fs.writeFileSync(warmupPath, warmupScript);
    await runPython([warmupPath], {}, _pyExe);
    fs.unlinkSync(warmupPath);

    // ── 8. Lưu trạng thái đã cài xong ─────────────────────────────────────────
    fs.writeFileSync(_statusFile, JSON.stringify({ version: '1.0', model: modelKey, modelId, gpuType, date: Date.now() }));
    sendVieNeuProgress('done', 100, 'VieNeu sẵn sàng!');
  }

  ipcMain.handle('vieneu:check-status', async () => {
    try {
      const pyExe = PYTHON_EXE();
      const pyOk = fs.existsSync(pyExe);
      const statusOk = fs.existsSync(STATUS_FILE());
      // Nếu status file còn nhưng python.exe mất → xóa status để force reinstall
      if (statusOk && !pyOk) {
        try { fs.unlinkSync(STATUS_FILE()); } catch (_) {}
      }
      let gpuType = 'cpu';
      if (statusOk) { try { gpuType = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')).gpuType || 'cpu'; } catch(_) {} }
      return { installed: statusOk && pyOk, pythonReady: pyOk, dir: VIENEU_DIR(), gpuType };
    } catch (_) { return { installed: false, pythonReady: false }; }
  });

  ipcMain.handle('vieneu:get-dir', async () => VIENEU_DIR());
  ipcMain.handle('vieneu:set-dir', async (event, dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) return { success: false, error: 'Thư mục không tồn tại' };
    await db.setSetting('vieneu_dir', dirPath);
    _customVieNeuDir = dirPath;
    const pyExe = path.join(dirPath, 'python', 'python.exe');
    const statusFile = path.join(dirPath, 'setup_done.json');
    return { success: true, installed: fs.existsSync(pyExe) && fs.existsSync(statusFile) };
  });

  ipcMain.handle('vieneu:find-install', async () => {
    const { execSync } = require('child_process');

    // Lấy danh sách ổ đĩa trên Windows
    let drives = ['C', 'D', 'E', 'F', 'G'];
    try {
      const out = execSync('wmic logicaldisk get caption', { timeout: 5000, encoding: 'utf8' });
      const found = out.match(/[A-Z]:/g);
      if (found) drives = [...new Set(found.map(d => d[0]))];
    } catch (_) {}

    // Các subpath phổ biến để tìm vieneu_env
    const subpaths = [
      'vieneu_env',
      'fluxy-thanh-cong-media\\vieneu_env',
      path.join(process.env.APPDATA || '', 'fluxy-thanh-cong-media', 'vieneu_env'),
      path.join(process.env.LOCALAPPDATA || '', 'fluxy-thanh-cong-media', 'vieneu_env'),
      path.join(app.getPath('userData'), 'vieneu_env'),
    ];

    // Thêm các đường dẫn trực tiếp từ ổ đĩa
    for (const d of drives) {
      subpaths.push(`${d}:\\vieneu_env`);
      subpaths.push(`${d}:\\fluxy-thanh-cong-media\\vieneu_env`);
      subpaths.push(`${d}:\\GrokStudio\\vieneu_env`);
      subpaths.push(`${d}:\\Tools\\vieneu_env`);
      subpaths.push(`${d}:\\App\\vieneu_env`);
      subpaths.push(`${d}:\\Users\\${process.env.USERNAME || ''}\\AppData\\Roaming\\fluxy-thanh-cong-media\\vieneu_env`);
      subpaths.push(`${d}:\\Users\\${process.env.USERNAME || ''}\\AppData\\Local\\fluxy-thanh-cong-media\\vieneu_env`);
    }

    for (const candidate of subpaths) {
      if (!candidate) continue;
      try {
        const pyExe = path.join(candidate, 'python', 'python.exe');
        const statusFile = path.join(candidate, 'setup_done.json');
        if (fs.existsSync(pyExe) && fs.existsSync(statusFile)) {
          await db.setSetting('vieneu_dir', candidate);
          _customVieNeuDir = candidate;
          return { found: true, dir: candidate };
        }
      } catch (_) {}
    }

    // Thử dùng PowerShell where.exe để tìm python.exe liên quan đến vieneu
    try {
      const out = execSync(
        `powershell -NonInteractive -Command "Get-ChildItem -Path (Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root) -Filter 'setup_done.json' -Recurse -ErrorAction SilentlyContinue -Depth 5 | Select-Object -First 3 -ExpandProperty DirectoryName"`,
        { timeout: 20000, encoding: 'utf8' }
      );
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
      for (const dir of lines) {
        const pyExe = path.join(dir, 'python', 'python.exe');
        if (fs.existsSync(pyExe)) {
          await db.setSetting('vieneu_dir', dir);
          _customVieNeuDir = dir;
          return { found: true, dir };
        }
      }
    } catch (_) {}

    return { found: false };
  });

  ipcMain.handle('vieneu:setup', async (event, opts = {}) => {
    try {
      await setupVieNeu(opts?.model || 'q4');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vieneu:cancel-setup', () => { _vieNeuSetupAbort = true; return { ok: true }; });

  // ── Nâng cấp onnxruntime lên GPU (không cần cài lại Python/model) ──────────
  ipcMain.handle('vieneu:upgrade-gpu', async (event) => {
    const send = (msg) => { try { event.sender.send('vieneu-progress', { stage: 'gpu', pct: 0, msg }); } catch(_) {} };
    try {
      const pyExe = PYTHON_EXE();
      if (!fs.existsSync(pyExe)) return { ok: false, error: 'VieNeu chưa cài — hãy cài trước' };

      send('🔍 Quét card đồ họa...');
      const gpuType = await detectGpuType();
      const gpuLabel = { nvidia:'NVIDIA (CUDA)', amd:'AMD (DirectML)', intel_arc:'Intel Arc (DirectML)', cpu:'CPU' }[gpuType] || 'CPU';
      send(`Phát hiện: ${gpuLabel}`);

      if (gpuType === 'cpu') {
        send('⚠️ Không tìm thấy GPU tương thích (NVIDIA/AMD/Intel Arc). Vẫn dùng CPU.');
        return { ok: true, gpuType, msg: 'CPU — không có GPU tương thích' };
      }

      await _installOnnxruntimeGpu(pyExe, gpuType, (_, __, msg) => send(msg));

      // Cập nhật status file
      const sf = STATUS_FILE();
      if (fs.existsSync(sf)) {
        try {
          const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
          st.gpuType = gpuType;
          fs.writeFileSync(sf, JSON.stringify(st));
        } catch(_) {}
      }

      send(`✅ Nâng cấp xong! VieNeu sẽ dùng ${gpuLabel}`);
      return { ok: true, gpuType };
    } catch(e) {
      send(`❌ Lỗi: ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  // ── Reset hoàn toàn: xóa sạch vieneu_env + C:\FV\t rồi cho cài lại từ đầu ─
  ipcMain.handle('vieneu:reset', async (event) => {
    const send = (msg) => { try { event.sender.send('vieneu-progress', { stage: 'reset', pct: 0, msg }); } catch(_) {} };
    try {
      _vieNeuSetupAbort = true; // dừng setup đang chạy nếu có

      // Kill tất cả tiến trình python đang chạy từ vieneu_env để giải phóng file lock
      send('⏹️ Đang dừng tiến trình Python...');
      try {
        require('child_process').execSync('taskkill /F /IM python.exe /T', { windowsHide: true, stdio: 'ignore' });
      } catch(_) {}
      // Chờ OS giải phóng handle
      await new Promise(r => setTimeout(r, 1500));

      const _fs = require('fs');
      const rmSafe = async (dir) => {
        if (!_fs.existsSync(dir)) return;
        // Thử xóa, nếu bị lock thì đợi và thử lại 3 lần
        for (let i = 0; i < 3; i++) {
          try { _fs.rmSync(dir, { recursive: true, force: true }); return; } catch(e) {
            if (i === 2) throw e;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      };

      send('🗑️ Đang xóa thư mục VieNeu...');
      await rmSafe(VIENEU_DIR());
      send('🗑️ Đang xóa torch cache...');
      await rmSafe(TORCH_SHORT_DIR);

      _vieNeuSetupAbort = false;
      send('✅ Xóa sạch xong — sẵn sàng cài lại từ đầu');
      return { success: true };
    } catch (e) {
      send(`❌ Lỗi xóa: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // ── Auto-repair: quét và cài lại torch/torchaudio nếu thiếu ───────────────
  ipcMain.handle('vieneu:repair-torch', async (event) => {
    const send = (msg, type = 'info') => { try { event.sender.send('vieneu:repair-log', { msg, type }); } catch(_) {} };
    try {
      const pyExe = PYTHON_EXE();
      if (!require('fs').existsSync(pyExe)) return { success: false, error: 'Chưa cài VieNeu. Hãy cài VieNeu trước.' };

      send('🔍 Kiểm tra torch...');
      // Bật long path
      try { require('child_process').execSync('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f', { windowsHide: true, stdio: 'ignore' }); send('✅ Đã bật Windows LongPath'); } catch(_) { send('⚠️ Không bật được LongPath (không có quyền admin) — sẽ dùng path ngắn thay thế'); }

      // Kiểm tra torch có hoạt động không
      let torchOk = false;
      try {
        const checkScript = `import sys\n_p='${TORCH_SHORT_DIR.replace(/\\/g,'\\\\')}';\nimport os\nif os.path.isdir(_p) and _p not in sys.path: sys.path.insert(0,_p)\nimport torch; print('ok')`;
        const out = require('child_process').execFileSync(pyExe, ['-c', checkScript], { encoding: 'utf8', timeout: 15000 });
        torchOk = out.trim() === 'ok';
      } catch(_) {}

      if (torchOk) { send('✅ Torch đã hoạt động — không cần cài lại', 'success'); return { success: true, message: 'Torch OK' }; }

      send('⚙️ Torch chưa hoạt động — đang dọn phiên bản cũ...');

      // Xóa thủ công torch trong site-packages (cài dở → không có RECORD → pip uninstall lỗi)
      try {
        const sitePkg = require('child_process').execFileSync(pyExe,
          ['-c', 'import site; print(site.getsitepackages()[0])'],
          { encoding: 'utf8', timeout: 10000 }).trim();
        const _fs = require('fs'), _pt = require('path');
        for (const entry of (_fs.readdirSync(sitePkg) || [])) {
          if (/^torch(audio|gen|vision)?[-.]?/i.test(entry)) {
            try { _fs.rmSync(_pt.join(sitePkg, entry), { recursive: true, force: true }); send(`🗑️ Xóa: ${entry}`); } catch(_) {}
          }
        }
      } catch(e) { send(`⚠️ Dọn dẹp: ${e.message}`); }

      // Xóa C:\FV\t nếu cài dở lần trước
      try { require('fs').rmSync(TORCH_SHORT_DIR, { recursive: true, force: true }); send(`🗑️ Xóa ${TORCH_SHORT_DIR} cũ`); } catch(_) {}

      send('⬇️ Đang cài torch==2.1.0 + torchaudio==2.1.0 (~300MB)...');
      await _installTorchSafe(pyExe, (_, __, msg) => send(msg));

      send('📦 Ghim numpy<2 (tương thích torch 2.1.0)...');
      await new Promise(res => {
        try { const { spawn: sp } = require('child_process'); sp(pyExe, ['-m', 'pip', 'install', 'numpy<2', '-q', '--force-reinstall']).on('close', res).on('error', res); } catch(_) { res(); }
      });

      send('🔄 Cập nhật script tổng hợp...');
      writeSynthScripts();

      send('✅ Hoàn tất! Torch + numpy sẵn sàng.', 'success');
      return { success: true };
    } catch (e) {
      send(`❌ Lỗi: ${e.message}`, 'error');
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vieneu:get-voices', async () => {
    try {
      writeSynthScripts();
      const out = await runPython([VOICES_SCRIPT()]);
      return { success: true, voices: JSON.parse(out) };
    } catch (e) { return { success: false, voices: [], error: e.message }; }
  });

  // Tìm đoạn giọng đọc đầu tiên, extract WAV cho VieNeu + MP3 nén nhỏ cho Gemini
  ipcMain.handle('vieneu:find-speech-ref', async (event, { filePath }) => {
    const os = require('os');
    const { spawn: _spawn } = require('child_process');
    const _ffmpeg  = require('ffmpeg-static');
    const _ffprobe = require('ffprobe-static').path;

    try {
      // 1. Dùng silencedetect chỉ trên 120s đầu — dừng sớm, không cần scan cả file
      const silenceLog = await new Promise((res) => {
        const p = _spawn(_ffmpeg, [
          '-t', '120',           // chỉ xử lý 120s đầu
          '-i', filePath,
          '-af', 'silencedetect=noise=-38dB:d=0.3',
          '-f', 'null', '-'
        ]);
        let log = '';
        p.stderr.on('data', d => {
          log += d.toString();
          // Dừng sớm ngay khi tìm thấy silence_end đầu tiên
          if (log.includes('silence_end')) p.kill();
        });
        p.on('close', () => res(log));
        p.on('error', () => res(''));
      });

      // 2. Parse silence_end đầu tiên = điểm bắt đầu có tiếng
      let speechStart = 0;
      const m = silenceLog.match(/silence_end:\s*([\d.]+)/);
      if (m) speechStart = parseFloat(m[1]) || 0;

      // Giới hạn trong 120s
      speechStart = Math.min(speechStart, 110);

      const ts = Date.now();

      // 3a. Extract 15s → WAV 16kHz mono cho VieNeu (sweet spot chất lượng clone)
      const refPath = path.join(app.getPath('userData'), `vieneu_ref_${ts}.wav`);
      await new Promise((res, rej) => {
        const p = _spawn(_ffmpeg, [
          '-y', '-ss', String(speechStart), '-t', '15',
          '-i', filePath,
          '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16',
          refPath
        ]);
        p.on('close', code => code === 0 ? res() : rej(new Error('ffmpeg wav lỗi')));
        p.on('error', rej);
      });

      // refPath (WAV 16kHz) được dùng trực tiếp để transcribe — đảm bảo khớp với audio clone
      return { success: true, refPath, transcribePath: refPath, speechStart: Math.round(speechStart) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Chạy synth Python với streaming stderr → gửi log về renderer real-time
  function runSynthStreaming(args, sender) {
    return new Promise((resolve, reject) => {
      const { spawn: _sp } = require('child_process');
      const _exe = PYTHON_EXE(), _mc = MODEL_CACHE();
      const proc = _sp(_exe, args, {
        env: { ...process.env, HF_HOME: _mc, TRANSFORMERS_OFFLINE: '0',
               PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      });
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      _vieNeuSynthProc = proc;
      let stdout = '', stderr = '';

      // Filter các dòng log hữu ích, bỏ qua warning lặp lại
      const SKIP = /UserWarning|FutureWarning|DeprecationWarning|HF_TOKEN|unauthenticated/i;
      const sendLog = (line) => {
        line = line.trim();
        if (!line || SKIP.test(line)) return;
        if (!sender.isDestroyed()) sender.send('vieneu-log', line);
      };

      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => {
        const chunk = d;
        stderr += chunk;
        chunk.split('\n').forEach(sendLog);
      });

      proc.on('close', (code) => {
        _vieNeuSynthProc = null;
        if (code !== 0) return reject(new Error(stderr.slice(-2000) || `Exit ${code}`));
        resolve(stdout.trim());
      });
      proc.on('error', (e) => { _vieNeuSynthProc = null; reject(e); });
    });
  }

  ipcMain.handle('vieneu:synthesize', async (event, { text, outputPath, voiceId, refAudio, refText }) => {
    const sender = event.sender;
    const log = (msg) => { if (!sender.isDestroyed()) sender.send('vieneu-log', msg); };
    try {
      writeSynthScripts();
      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });
      let modelId = MODEL_IDS.q4;
      try {
        const st = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8'));
        modelId = st.modelId || MODEL_IDS[st.model] || MODEL_IDS.q4;
      } catch (_) {}

      // Normalize 8.3 short path (VUANH~1) → long path để libsndfile đọc được
      let refAudioNorm = refAudio;
      if (refAudio) {
        if (!fs.existsSync(refAudio)) {
          log(`⚠️ Ref audio không tồn tại (${path.basename(refAudio)}) — chạy không clone`);
          refAudioNorm = null;
        } else {
          try { refAudioNorm = fs.realpathSync.native(refAudio); } catch (_) {}
        }
      }

      log(refAudioNorm ? '🎤 Chuẩn bị ref audio clone...' : '🔊 Khởi tạo model TTS...');
      if (refAudioNorm) log(`📂 Ref: ${path.basename(refAudioNorm)}`);

      const _cmdJson = JSON.stringify({ text, outputPath, voiceId, refAudio: refAudioNorm, refText, modelId });
      const _cmdFile = path.join(app.getPath('userData'), `vieneu_cmd_${Date.now()}.json`);
      fs.writeFileSync(_cmdFile, _cmdJson, 'utf8');
      let out;
      try {
        out = await runSynthStreaming([SYNTH_SCRIPT(), _cmdFile], sender);
      } catch (synthErr) {
        try { fs.unlinkSync(_cmdFile); } catch(_) {}
        // Auto-fix: cài torch nếu thiếu
        const needsTorch = synthErr.message && (
          synthErr.message.includes("No module named 'torch'") ||
          synthErr.message.includes("No module named 'torchaudio'") ||
          synthErr.message.includes("No module named 'torchgen'")
        );
        if (needsTorch) {
          log('⚙️ Thiếu torch/torchaudio — đang tự cài phiên bản tương thích (~300MB)...');
          const pyExe = PYTHON_EXE();
          const { spawn: _spawnPip } = require('child_process');
          // Bật LongPath để tránh WinError 206
          try { require('child_process').execSync('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f', { windowsHide: true, stdio: 'ignore' }); } catch(_) {}
          // Gỡ torch/torchaudio cũ trước nếu có (tránh version conflict)
          await new Promise((res) => {
            const pip = _spawnPip(pyExe, ['-m', 'pip', 'uninstall', 'torch', 'torchaudio', '-y', '-q']);
            pip.on('close', () => res()); pip.on('error', () => res());
          });
          await _installTorchSafe(pyExe, null);
          log('✅ Torch 2.1.0 + torchaudio 2.1.0 cài xong — thử lại...');
          writeSynthScripts();
          const _cmdFile2 = path.join(app.getPath('userData'), `vieneu_cmd_${Date.now()}.json`);
          fs.writeFileSync(_cmdFile2, _cmdJson, 'utf8');
          out = await runSynthStreaming([SYNTH_SCRIPT(), _cmdFile2], sender);
        } else {
          throw synthErr;
        }
      }

      log('💾 Lưu file audio...');
      const result = JSON.parse(out);
      if (result.success) log(`✅ Xong → ${path.basename(result.path || outputPath)}`);
      return result;
    } catch (e) {
      log(`❌ Lỗi: ${e.message.split('\n').slice(-3).join(' ')}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vieneu:cancel', () => {
    try { if (_vieNeuSynthProc) { _vieNeuSynthProc.kill(); _vieNeuSynthProc = null; } } catch (_) {}
    return { ok: true };
  });

  // SRT mode: tổng hợp từng segment → ghép thành 1 file audio (giống edge TTS SRT)
  ipcMain.handle('vieneu:synthesize-srt', async (event, { segments, voiceId, refAudio, refText, outputPath }) => {
    try {
      writeSynthScripts();
      // Normalize 8.3 short path cho refAudio
      if (refAudio) { try { refAudio = fs.realpathSync.native(refAudio); } catch (_) {} }

      const tmpDir = path.join(app.getPath('userData'), `vieneu_srt_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      let modelId = MODEL_IDS.q4;
      try { const st = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')); modelId = st.modelId || MODEL_IDS[st.model] || MODEL_IDS.q4; } catch (_) {}

      // ffprobe để đo duration audio
      let ffprobeBin = 'ffprobe';
      try { ffprobeBin = require('ffprobe-static').path; } catch (_) {
        try { ffprobeBin = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'); } catch (_) {}
      }
      const { execFile } = require('child_process');
      const execP = (cmd, args) => new Promise((res, rej) =>
        execFile(cmd, args, { timeout: 180000 }, (e, out) => e ? rej(new Error(e.message)) : res(out))
      );
      const getAudioDuration = async (filePath) => {
        try {
          const out = await execP(ffprobeBin, ['-v','error','-show_entries','format=duration','-of','csv=p=0', filePath]);
          const d = parseFloat(out.trim());
          return isNaN(d) ? 0 : d;
        } catch (_) { return 0; }
      };

      const segFiles = [];
      for (let i = 0; i < segments.length; i++) {
        const seg     = segments[i];
        // Renderer gửi startMs/endMs (milliseconds)
        const startMs = seg.startMs ?? seg.start ?? 0;
        const endMs   = seg.endMs   ?? seg.end   ?? startMs;
        const segDurSec = Math.max(0.1, (endMs - startMs) / 1000);
        const text    = (seg.text || '').trim();
        const segPath = path.join(tmpDir, `seg_${String(i).padStart(4,'0')}.wav`);

        if (!text) { segFiles.push({ path: null, startMs, endMs }); continue; }

        // Tổng hợp giọng nói — ghi cmd ra file để tránh ENAMETOOLONG (text dài)
        const _srtCmdFile = path.join(app.getPath('userData'), `vieneu_srt_${Date.now()}.json`);
        fs.writeFileSync(_srtCmdFile, JSON.stringify({ text, outputPath: segPath, voiceId, refAudio, refText, modelId }), 'utf8');
        await runPython([SYNTH_SCRIPT(), _srtCmdFile]);

        if (!fs.existsSync(segPath)) { segFiles.push({ path: null, startMs, endMs }); continue; }

        // Đo duration thực tế của audio
        const audioDurSec = await getAudioDuration(segPath);

        let finalPath = segPath;
        // Chỉ tăng tốc khi audio DÀI hơn slot — KHÔNG bao giờ làm chậm (ratio < 1 = giữ nguyên 1x)
        if (audioDurSec > 0.05 && audioDurSec > segDurSec + 0.05) {
          const ratio    = audioDurSec / segDurSec; // luôn > 1 ở đây
          const adjusted = path.join(tmpDir, `seg_${String(i).padStart(4,'0')}_adj.wav`);
          try {
            const buildAtempo = (r) => {
              const steps = [];
              let rem = r;
              while (rem > 2.0) { steps.push('atempo=2.0'); rem /= 2.0; }
              steps.push(`atempo=${rem.toFixed(4)}`);
              return steps.join(',');
            };
            await execP(ffmpegPath, ['-y','-i',segPath,'-filter:a',buildAtempo(ratio),'-c:a','pcm_s16le',adjusted]);
            finalPath = adjusted;
          } catch (_) {}
        }

        segFiles.push({ path: finalPath, startMs, endMs });

        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('vieneu-srt-progress', { done: i + 1, total: segments.length, text: text.slice(0,40) });
      }

      // Ghép tất cả segment vào đúng vị trí timestamp
      const validSegs = segFiles.filter(sf => sf.path);
      if (validSegs.length === 0) return { success: false, error: 'Không có segment nào tổng hợp được' };

      const totalMs  = segFiles[segFiles.length - 1].endMs + 500;
      const inputs   = [];
      const filterParts = [];
      validSegs.forEach((sf, idx) => {
        inputs.push('-i', sf.path);
        filterParts.push(`[${idx}:a]adelay=${sf.startMs}|${sf.startMs}[a${idx}]`);
      });
      const mixInputs   = validSegs.map((_, i) => `[a${i}]`).join('');
      const filterComplex = filterParts.join(';') + `;${mixInputs}amix=inputs=${validSegs.length}:duration=longest:normalize=0[out]`;

      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });
      await execP(ffmpegPath, [
        '-y', ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-t', (totalMs / 1000).toFixed(3),
        '-c:a', 'libmp3lame', '-q:a', '3',
        outputPath,
      ]);

      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
  });
}
// ── END VIENEU TTS ────────────────────────────────────────────────────────────

// ── GPT-SoVITS TTS ───────────────────────────────────────────────────────────
{
  const http  = require('http');
  const https = require('https');
  const { spawn, execFile } = require('child_process');

  const GPT_SOVITS_KEY  = 'gptsovits_server_url';
  const GPT_REF_KEY     = 'gptsovits_ref_voices';
  const GPT_SOVITS_DIR  = () => _gsvCustomDir || path.join(app.getPath('userData'), 'gptsovits_env');
  const GSV_STATUS_FILE = () => path.join(GPT_SOVITS_DIR(), 'gsv_install.json');

  let _gsvCustomDir   = null;
  let _gsvServerProc  = null;
  let _gsvInstallAbort = false;
  // Load custom dir từ db + fallback scan các vị trí thường gặp
  const _gsvDirReady = (async () => {
    try {
      const v = await db.getSetting('gptsovits_custom_dir', null);
      if (v && fs.existsSync(v) && fs.existsSync(path.join(v, 'gsv_install.json'))) {
        _gsvCustomDir = v; return;
      }
    } catch(_) {}
    // Fallback: quét các vị trí phổ biến
    const candidates = [
      path.join(app.getAppPath(), '..', 'assets', 'gpt'),
      path.join(app.getAppPath(), 'assets', 'gpt'),
      path.join(path.dirname(app.getPath('exe')), 'assets', 'gpt'),
      path.join('D:\\', 'GPT-SoVITS'),
      path.join('D:\\', 'Tools', 'GPT-SoVITS'),
      path.join(app.getPath('userData'), 'gptsovits_env'),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(path.join(c, 'gsv_install.json'))) {
          _gsvCustomDir = c;
          await db.setSetting('gptsovits_custom_dir', c).catch(() => {});
          return;
        }
      } catch(_) {}
    }
  })();

  function gsvSend(event, type, pct, msg) {
    try { if (!event.sender.isDestroyed()) event.sender.send('gptsovits-setup-progress', { type, pct, msg }); } catch(_) {}
  }

  function downloadFileStreaming(urlStr, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const doGet = (u) => {
        const mod = u.startsWith('https') ? https : http;
        mod.get(u, { headers: { 'User-Agent': 'GrokStudio/1.0' } }, (res) => {
          if ([301,302,303,307,308].includes(res.statusCode)) return doGet(res.headers.location);
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          const total = parseInt(res.headers['content-length'] || '0');
          let done = 0;
          res.on('data', chunk => { done += chunk.length; file.write(chunk); if (onProgress && total > 0) onProgress(done, total); });
          res.on('end', () => file.end(() => resolve()));
          res.on('error', reject);
        }).on('error', reject);
      };
      doGet(urlStr);
    });
  }

  function ghGet(urlPath) {
    return new Promise((res, rej) => {
      https.get(`https://api.github.com${urlPath}`,
        { headers: { 'User-Agent': 'GrokStudio/1.0', 'Accept': 'application/vnd.github+json' } },
        (r) => {
          if ([301,302].includes(r.statusCode)) return ghGet(r.headers.location).then(res).catch(rej);
          const c = []; r.on('data', d => c.push(d)); r.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString())); } catch(e) { rej(e); } });
        }
      ).on('error', rej);
    });
  }

  async function findReleaseWithAsset() {
    // 1. Thử GitHub API assets trước (các bản cũ có đính kèm)
    for (let page = 1; page <= 3; page++) {
      let releases;
      try { releases = await ghGet(`/repos/RVC-Boss/GPT-SoVITS/releases?per_page=10&page=${page}`); } catch(_) { break; }
      if (!Array.isArray(releases) || releases.length === 0) break;
      for (const rel of releases) {
        const assets = rel.assets || [];
        const asset =
          assets.find(a => a.name.match(/\.(zip|7z)$/i) && a.size > 50*1024*1024) ||
          assets.find(a => a.name.match(/\.(zip|7z)$/i));
        if (asset) return { release: rel, asset: { name: asset.name, browser_download_url: asset.browser_download_url, size: asset.size } };
      }
    }
    return null;
  }

  async function scrapeHFDownloadUrl() {
    // Scrape trang releases GitHub để tìm link HuggingFace / hf-mirror
    return new Promise((resolve) => {
      https.get('https://github.com/RVC-Boss/GPT-SoVITS/releases',
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } },
        (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf8');
            // Tìm link hf-mirror (nhanh hơn ở VN) hoặc huggingface
            const mirrors = [
              /href="(https:\/\/hf-mirror\.com\/[^"]*\.7z[^"]*)"/gi,
              /href="(https:\/\/huggingface\.co\/[^"]*\.7z[^"]*)"/gi,
              /href="(https:\/\/www\.modelscope\.cn\/[^"]*\.7z[^"]*)"/gi,
            ];
            for (const re of mirrors) {
              const m = re.exec(html);
              if (m) { resolve({ url: m[1], name: m[1].split('/').pop().split('?')[0] }); return; }
            }
            resolve(null);
          });
          res.on('error', () => resolve(null));
        }
      ).on('error', () => resolve(null));
    });
  }

  ipcMain.handle('gptsovits:check-install', async () => {
    try {
      await _gsvDirReady; // đảm bảo custom dir đã load từ db
      if (!fs.existsSync(GSV_STATUS_FILE())) return { installed: false };
      const st = JSON.parse(fs.readFileSync(GSV_STATUS_FILE(), 'utf8'));
      const base2 = path.join(GPT_SOVITS_DIR(), st.rootDir || '');
      const apiScript = path.join(base2, 'api_v2.py');
      if (!fs.existsSync(apiScript)) return { installed: false };
      return { installed: true, version: st.version, serverRunning: !!_gsvServerProc };
    } catch(_) { return { installed: false }; }
  });

  ipcMain.handle('gptsovits:install', async (event, { installDir } = {}) => {
    _gsvInstallAbort = false;
    // Dùng thư mục user chọn, hoặc default userData
    if (installDir && fs.existsSync(installDir)) {
      _gsvCustomDir = installDir;
      await db.setSetting('gptsovits_custom_dir', installDir);
    }
    const dir = GPT_SOVITS_DIR();
    fs.mkdirSync(dir, { recursive: true });

    try {
      gsvSend(event, 'fetch', 2, 'Đang tìm link tải về...');
      let dlUrl, dlName, tag = 'latest';

      const found = await findReleaseWithAsset();
      if (found) {
        dlUrl  = found.asset.browser_download_url;
        dlName = found.asset.name;
        tag    = found.release.tag_name || 'latest';
        gsvSend(event, 'download', 5, `Tìm thấy bản ${tag} trên GitHub`);
      } else {
        // Scrape trang releases để lấy link HuggingFace/hf-mirror
        gsvSend(event, 'fetch', 8, 'Không có GitHub asset, đang tìm link HuggingFace...');
        const scraped = await scrapeHFDownloadUrl();
        if (!scraped) throw new Error('Không tìm thấy link tải. Hãy tải thủ công tại github.com/RVC-Boss/GPT-SoVITS/releases rồi chọn folder.');
        dlUrl  = scraped.url;
        dlName = scraped.name;
        gsvSend(event, 'download', 10, `Tìm thấy: ${dlName} (hf-mirror)`);
      }
      const asset = { browser_download_url: dlUrl, name: dlName };

      gsvSend(event, 'download', 12, `File: ${asset.name} (~3-5GB, vui lòng chờ...)`);
      if (_gsvInstallAbort) throw new Error('Đã hủy');

      const dlPath = path.join(dir, asset.name);
      let _lastPct = -1;
      await downloadFileStreaming(asset.browser_download_url, dlPath, (done, total) => {
        if (_gsvInstallAbort) return;
        const pct = Math.round(done / total * 55) + 12;
        if (pct !== _lastPct) { // chỉ gửi khi % thay đổi
          _lastPct = pct;
          gsvSend(event, 'download', pct, `Tải về: ${(done/1024/1024/1024).toFixed(2)}/${(total/1024/1024/1024).toFixed(2)} GB`);
        }
      });
      if (_gsvInstallAbort) throw new Error('Đã hủy');

      gsvSend(event, 'extract', 66, 'Giải nén (có thể mất vài phút)...');

      if (asset.name.endsWith('.zip')) {
        // Dùng AdmZip hoặc PowerShell
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(dlPath);
          zip.extractAllTo(dir, true);
        } catch(_) {
          // Fallback: PowerShell Expand-Archive
          await new Promise((res, rej) => {
            const ps = spawn('powershell', ['-Command', `Expand-Archive -Path "${dlPath}" -DestinationPath "${dir}" -Force`], { windowsHide: true });
            ps.on('close', c => c === 0 ? res() : rej(new Error(`PowerShell exit ${c}`)));
          });
        }
      } else if (asset.name.endsWith('.7z')) {
        // Download 7zr.exe nếu chưa có
        const zrPath = path.join(dir, '7zr.exe');
        if (!fs.existsSync(zrPath)) {
          gsvSend(event, 'extract', 66, 'Tải 7zr.exe để giải nén...');
          await downloadFileStreaming('https://www.7-zip.org/a/7zr.exe', zrPath, () => {});
        }
        await new Promise((res, rej) => {
          const proc = spawn(zrPath, ['x', dlPath, `-o${dir}`, '-y'], { windowsHide: true });
          proc.on('close', c => c === 0 ? res() : rej(new Error(`7zr exit ${c}`)));
          proc.on('error', rej);
        });
      }

      // Tìm thư mục root chứa api_v2.py
      const entries = fs.readdirSync(dir);
      let rootDir = '';
      for (const e of entries) {
        const full = path.join(dir, e);
        if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'api_v2.py'))) {
          rootDir = e; break;
        }
      }

      gsvSend(event, 'done', 95, 'Xóa file nén...');
      try { fs.unlinkSync(dlPath); } catch(_) {}

      fs.writeFileSync(GSV_STATUS_FILE(), JSON.stringify({ version: tag, rootDir, date: Date.now() }));
      gsvSend(event, 'done', 100, `✅ GPT-SoVITS ${tag} đã cài xong!`);
      return { ok: true };
    } catch(e) {
      gsvSend(event, 'error', 0, `❌ ${e.message}`);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('gptsovits:cancel-install', () => { _gsvInstallAbort = true; return { ok: true }; });

  // Cho phép user chỉ định folder GPT-SoVITS đã có sẵn
  ipcMain.handle('gptsovits:set-folder', async (event, folderPath) => {
    if (!folderPath || !fs.existsSync(folderPath)) return { ok: false, error: 'Thư mục không tồn tại' };
    // Tìm api_v2.py trong folder hoặc subfolder
    let rootDir = '';
    let apiScript = path.join(folderPath, 'api_v2.py');
    if (!fs.existsSync(apiScript)) {
      // Tìm trong subfolder
      try {
        const entries = fs.readdirSync(folderPath);
        for (const e of entries) {
          const sub = path.join(folderPath, e);
          if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, 'api_v2.py'))) {
            rootDir = e; apiScript = path.join(sub, 'api_v2.py'); break;
          }
        }
      } catch(_) {}
    }
    if (!fs.existsSync(apiScript)) return { ok: false, error: 'Không tìm thấy api_v2.py trong thư mục này' };
    // Lưu config với folderPath làm install dir
    _gsvCustomDir = folderPath;
    await db.setSetting('gptsovits_custom_dir', folderPath);
    fs.writeFileSync(path.join(folderPath, 'gsv_install.json'), JSON.stringify({ version: 'manual', rootDir, date: Date.now() }));
    return { ok: true };
  });

  async function _startGsvServer(logFn, onStop) {
    if (_gsvServerProc) return { ok: true, msg: 'Server đang chạy' };
    await _gsvDirReady;
    const st = JSON.parse(fs.readFileSync(GSV_STATUS_FILE(), 'utf8'));
    const base = path.join(GPT_SOVITS_DIR(), st.rootDir || '');
    const apiScript = path.join(base, 'api_v2.py');
    const pyExe = ['python_embeded', 'runtime'].map(d => path.join(base, d, 'python.exe')).find(p => fs.existsSync(p)) || 'python';
    if (!fs.existsSync(apiScript)) throw new Error('Chưa cài GPT-SoVITS');
    logFn('🚀 Khởi động GPT-SoVITS server...');
    const runtimeDir = path.join(base, 'runtime');
    const gpuType = await detectGpuType();
    const spawnEnv = {
      ...process.env,
      PATH: runtimeDir + path.delimiter + (process.env.PATH || ''),
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
      // NVIDIA: để PyTorch trong runtime tự dùng CUDA; không set CUDA_VISIBLE_DEVICES=-1
      // AMD/CPU: ẩn CUDA để tránh lỗi init
      ...(gpuType === 'nvidia' ? {} : { CUDA_VISIBLE_DEVICES: '-1' }),
    };
    if (gpuType === 'nvidia') logFn('🎮 GPU: NVIDIA detected — GPT-SoVITS sẽ dùng CUDA');
    else if (gpuType === 'amd') logFn('🎮 GPU: AMD detected — GPT-SoVITS chạy CPU (ROCm chỉ hỗ trợ Linux)');
    else logFn('🖥️ Chạy CPU mode');
    _gsvServerProc = spawn(pyExe, ['api_v2.py'], { cwd: base, windowsHide: false, env: spawnEnv });
    const _gsvLog = (d) => {
      const lines = d.toString().split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        // Ẩn tqdm progress bars (reset theo từng câu, gây nhầm lẫn)
        if (/^\s*\d+%\s*\|/.test(t)) continue;
        // Ẩn các dòng info thừa
        if (/^(False|True)\s+(False|True)/.test(t)) continue;
        if (/^Set seed to/.test(t)) continue;
        if (/^(Parallel|Bucket) (Inference|Processing) Mode/.test(t)) continue;
        if (/^Actual Input (Reference|Target) Text:/.test(t)) continue;
        if (/^Actual Input Target Text \(after/.test(t)) continue;
        if (/^\[['"]/.test(t)) continue; // arrays của sentences
        logFn(t);
      }
    };
    _gsvServerProc.stdout.on('data', _gsvLog);
    _gsvServerProc.stderr.on('data', _gsvLog);
    _gsvServerProc.on('close', (c) => { _gsvServerProc = null; if (onStop) onStop(c); });
    let waited = 0;
    while (waited < 60000) {
      await new Promise(r => setTimeout(r, 2000)); waited += 2000;
      try {
        const r = await new Promise((res, rej) => { http.get('http://127.0.0.1:9880/', { timeout: 1500 }, (r) => res(r.statusCode)).on('error', rej); });
        if (r === 200 || r === 404 || r === 405) { logFn('✅ Server sẵn sàng tại http://127.0.0.1:9880'); return { ok: true }; }
      } catch(_) {}
      logFn(`⏳ Chờ server... ${waited/1000}s`);
    }
    throw new Error('Timeout chờ server');
  }

  // Đăng ký auto-start khi app mở
  _ttsAutoStartRegistry.push({ name: 'GPT-SoVITS', startFn: async (win) => {
    try {
      if (_gsvServerProc) return;
      await _gsvDirReady;
      if (!_gsvCustomDir) return; // Chưa cài
      const statusFile = GSV_STATUS_FILE();
      if (!fs.existsSync(statusFile)) return;
      const logFn = (msg) => { try { win?.webContents?.send('gptsovits-log', msg); } catch(_) {} };
      await _startGsvServer(logFn, () => { try { win?.webContents?.send('gptsovits-server-stopped', {}); } catch(_) {} });
    } catch(e) { console.log('[GSV auto-start]', e.message); }
  }});

  ipcMain.handle('gptsovits:start-server', async (event) => {
    if (_gsvServerProc) return { ok: true, msg: 'Server đang chạy' };
    try {
      const send = (msg) => { try { if (!event.sender.isDestroyed()) event.sender.send('gptsovits-log', msg); } catch(_) {} };
      const onStop = (c) => { try { if (!event.sender.isDestroyed()) event.sender.send('gptsovits-server-stopped', { code: c }); } catch(_) {} };
      return await _startGsvServer(send, onStop);
    } catch(e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('gptsovits:stop-server', () => {
    if (_gsvServerProc) { try { _gsvServerProc.kill(); } catch(_) {} _gsvServerProc = null; }
    return { ok: true };
  });

  // Cắt 1 đoạn ~3s từ giữa audio, transcribe, trả về {path, text, name}
  ipcMain.handle('gptsovits:split-ref-audio', async (event, { audioPath, lang = 'auto' }) => {
    try {
      await _gsvDirReady;
      const st = JSON.parse(fs.readFileSync(GSV_STATUS_FILE(), 'utf8'));
      const base = path.join(GPT_SOVITS_DIR(), st.rootDir || '');
      const pyExe = ['python_embeded', 'runtime'].map(d => path.join(base, d, 'python.exe')).find(p => fs.existsSync(p)) || 'python';
      const runtimeDir = path.join(base, 'runtime');
      const spawnEnv = { ...process.env, PATH: runtimeDir + path.delimiter + (process.env.PATH || ''), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
      const send = (msg) => { try { if (!event.sender.isDestroyed()) event.sender.send('gptsovits-log', msg); } catch(_) {} };

      const refDir = path.join(GPT_SOVITS_DIR(), 'ref_audio_chunks');
      fs.mkdirSync(refDir, { recursive: true });
      const baseName = path.basename(audioPath, path.extname(audioPath));
      const outPath = path.join(refDir, `${baseName}_ref.wav`);

      // Lấy thời lượng
      const ffprobeBin = (() => { try { return require('ffprobe-static').path; } catch(_) { return ffmpegPath?.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1') || 'ffprobe'; } })();
      const duration = await new Promise((res) => {
        require('child_process').execFile(ffprobeBin, ['-v','quiet','-print_format','json','-show_streams', audioPath], { timeout: 15000 }, (e, out) => {
          try { res(parseFloat(JSON.parse(out).streams[0].duration) || 0); } catch(_) { res(0); }
        });
      });

      // Cắt 5s từ giây thứ 1 — GPT-SoVITS cần ref audio ngắn 3-10s
      const startSec = duration > 3 ? 1 : 0;
      const cutLen = Math.min(5, Math.max(duration - startSec, 1));
      await new Promise((res, rej) => {
        require('child_process').execFile(ffmpegPath, ['-y','-i',audioPath,'-ss',String(startSec),'-t',String(cutLen),'-ar','16000','-ac','1', outPath], { timeout: 30000 }, (e) => e ? rej(e) : res());
      });
      send(`✂️ Đã cắt ${cutLen}s từ giây ${startSec}`);

      // Transcribe đoạn 3s
      send('🎙️ Nhận diện lời thoại...');
      const script = `
import sys, os
os.chdir(r"${base.replace(/\\/g,'\\\\')}")
try:
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8", download_root=r"${path.join(base,'tools','asr','models').replace(/\\/g,'\\\\')}")
    lang_arg = None if "${lang}" == "auto" else "${lang}"
    segments, info = model.transcribe(r"${outPath.replace(/\\/g,'\\\\')}", language=lang_arg, beam_size=5)
    print("".join(s.text for s in segments).strip())
except Exception as e:
    print("ERR:" + str(e), file=sys.stderr); sys.exit(1)
`;
      const text = await new Promise((res) => {
        let out = '', err = '';
        const proc = require('child_process').spawn(pyExe, ['-c', script], { env: spawnEnv, cwd: base });
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => res(code === 0 ? out.trim() : ''));
      });
      const autoName = baseName.replace(/_\d{13}$/, '').replace(/_/g, ' ');
      send(`✅ Transcript: ${text.slice(0,60)}`);
      return { ok: true, path: outPath, text, name: autoName };
    } catch(e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('gptsovits:transcribe', async (event, { audioPath, lang = 'auto' }) => {
    try {
      await _gsvDirReady;
      const st = JSON.parse(fs.readFileSync(GSV_STATUS_FILE(), 'utf8'));
      const base = path.join(GPT_SOVITS_DIR(), st.rootDir || '');
      const pyExe = ['python_embeded', 'runtime'].map(d => path.join(base, d, 'python.exe')).find(p => fs.existsSync(p)) || 'python';
      const runtimeDir = path.join(base, 'runtime');
      const spawnEnv = { ...process.env, PATH: runtimeDir + path.delimiter + (process.env.PATH || ''), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

      // Script inline dùng faster_whisper
      const script = `
import sys, os
os.chdir(r"${base.replace(/\\/g,'\\\\')}")
try:
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cpu", compute_type="int8", download_root=r"${path.join(base,'tools','asr','models').replace(/\\/g,'\\\\')}")
    lang_arg = None if "${lang}" == "auto" else "${lang}"
    segments, info = model.transcribe(r"${audioPath.replace(/\\/g,'\\\\')}", language=lang_arg, beam_size=5)
    print("".join(s.text for s in segments).strip())
except Exception as e:
    print("ERR:" + str(e), file=sys.stderr)
    sys.exit(1)
`;
      const result = await new Promise((resolve, reject) => {
        let out = '', err = '';
        const proc = require('child_process').spawn(pyExe, ['-c', script], { env: spawnEnv, cwd: base });
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.split('\n').pop() || 'Transcribe failed')));
      });
      return { ok: true, text: result };
    } catch(e) { return { ok: false, error: e.message }; }
  });

  async function getGptSoVITSUrl() {
    try { const v = await db.getSetting(GPT_SOVITS_KEY, null); if (v) return v.replace(/\/$/, ''); } catch (_) {}
    return 'http://127.0.0.1:9880';
  }

  function httpPostJson(urlStr, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);
      const req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Timeout ${timeoutMs/1000}s`)); });
      req.write(data); req.end();
    });
  }

  function httpGet(urlStr) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(urlStr, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(new Error('Timeout 10s')); });
    });
  }

  ipcMain.handle('gptsovits:get-config', async () => {
    const url = await getGptSoVITSUrl();
    let refs = [];
    try { refs = JSON.parse(await db.getSetting(GPT_REF_KEY, '[]')); } catch (_) {}
    const outputFolder = await db.getSetting('gptsovits_output_folder', '').catch(() => '');
    return { url, refs, outputFolder };
  });

  ipcMain.handle('gptsovits:save-output-folder', async (_, folder) => {
    await db.setSetting('gptsovits_output_folder', folder);
    return { ok: true };
  });

  ipcMain.handle('gptsovits:set-url', async (_, url) => {
    await db.setSetting(GPT_SOVITS_KEY, url || 'http://127.0.0.1:9880');
    return { ok: true };
  });

  ipcMain.handle('gptsovits:test-connection', async () => {
    try {
      const base = await getGptSoVITSUrl();
      const r = await httpGet(base + '/');
      if (r.status === 200 || r.status === 404 || r.status === 405) return { ok: true };
      return { ok: false, error: `HTTP ${r.status}` };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('gptsovits:save-ref', async (_, { name, refAudioPath, refText, lang }) => {
    let refs = [];
    try { refs = JSON.parse(await db.getSetting(GPT_REF_KEY, '[]')); } catch (_) {}
    const id = Date.now().toString(36);
    refs.push({ id, name, refAudioPath, refText, lang: lang || 'vi' });
    await db.setSetting(GPT_REF_KEY, JSON.stringify(refs));
    return { ok: true, id };
  });

  ipcMain.handle('gptsovits:delete-ref', async (_, id) => {
    let refs = [];
    try { refs = JSON.parse(await db.getSetting(GPT_REF_KEY, '[]')); } catch (_) {}
    refs = refs.filter(r => r.id !== id);
    await db.setSetting(GPT_REF_KEY, JSON.stringify(refs));
    return { ok: true };
  });

  // Chia text thành các đoạn ≤ maxChars ký tự, ưu tiên cắt tại dấu câu
  function splitTextChunks(text, maxChars = 150) {
    // Cắt tại dấu câu: . ! ? 。！？\n
    const sentenceRe = /[^.!?。！？\n]+[.!?。！？\n]*/g;
    const sentences = text.match(sentenceRe) || [text];
    const chunks = [];
    let cur = '';
    for (const s of sentences) {
      if (cur.length + s.length > maxChars && cur.length > 0) {
        chunks.push(cur.trim());
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(c => c.length > 0);
  }

  // Ghép nhiều WAV buffer thành 1 (giữ header từ buffer đầu, append raw PCM từ các buffer sau)
  function concatWavBuffers(buffers) {
    if (buffers.length === 1) return buffers[0];
    const WAV_HEADER = 44;
    const header = buffers[0].slice(0, WAV_HEADER);
    const pcmParts = buffers.map(b => b.slice(WAV_HEADER));
    const totalPcm = pcmParts.reduce((a, b) => a + b.length, 0);
    const out = Buffer.allocUnsafe(WAV_HEADER + totalPcm);
    header.copy(out, 0);
    // Cập nhật kích thước trong WAV header
    out.writeUInt32LE(36 + totalPcm, 4);  // ChunkSize
    out.writeUInt32LE(totalPcm, 40);       // Subchunk2Size
    let offset = WAV_HEADER;
    for (const p of pcmParts) { p.copy(out, offset); offset += p.length; }
    return out;
  }

  ipcMain.handle('gptsovits:synthesize', async (event, { text, outputPath, refAudioPath, refText, lang, refLang, speed }) => {
    const sender = event.sender;
    const log = (msg) => { try { if (!sender.isDestroyed()) sender.send('gptsovits-log', msg); } catch (_) {} };
    try {
      const base = await getGptSoVITSUrl();
      const GSV_LANGS = { vi:'auto', en:'en', zh:'auto', ja:'auto', ko:'auto', yue:'yue' };
      const ttsLang = GSV_LANGS[lang] || 'auto';
      const promptLang = GSV_LANGS[refLang || lang] || 'auto';
      const hasRef = refAudioPath && fs.existsSync(refAudioPath);
      const refPathFwd = hasRef ? refAudioPath.replace(/\\/g, '/') : '';

      // Chia text thành chunks 150 ký tự để xử lý từng đoạn
      const chunks = splitTextChunks(text, 150);
      log(`🎙️ TTS ${chunks.length} đoạn | ${text.length} ký tự | ref: ${refAudioPath ? path.basename(refAudioPath) : 'none'} | lang: ${lang}→${refLang||lang}`);

      const wavBuffers = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        log(`[${i+1}/${chunks.length}] "${chunk.slice(0,40)}..."`);
        const body = {
          text: chunk,
          text_lang: ttsLang,
          ref_audio_path: refPathFwd,
          prompt_text: hasRef ? (refText?.trim() || '') : '',
          prompt_lang: hasRef ? promptLang : ttsLang,
          top_k: 5, top_p: 1.0, temperature: 1.0,
          speed_factor: speed || 1.0,
          media_type: 'wav', streaming_mode: false,
          text_split_method: 'cut3', batch_size: 1,
        };
        const r = await httpPostJson(base + '/tts', body, 600000);
        if (r.status !== 200) {
          let msg = `HTTP ${r.status}`;
          try { const p = JSON.parse(r.body.toString()); msg = p.Exception || p.detail || p.message || msg; } catch (_) { msg = r.body?.toString?.()?.slice(0,200) || msg; }
          log(`❌ TTS error đoạn ${i+1}: ${msg}`);
          throw new Error(msg);
        }
        wavBuffers.push(r.body);
        log(`✅ Đoạn ${i+1}/${chunks.length} xong`);
      }

      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, concatWavBuffers(wavBuffers));
      log(`✅ Hoàn thành → ${path.basename(outputPath)}`);
      return { success: true, path: outputPath };
    } catch (e) {
      log(`❌ ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  // Synthesize segments with SRT timing (giống vieneu:synthesize-srt)
  ipcMain.handle('gptsovits:synthesize-srt', async (event, { segments, refAudioPath, refText, lang, refLang, speed, outputPath }) => {
    const sender = event.sender;
    const log = (msg) => { try { if (!sender.isDestroyed()) sender.send('gptsovits-log', msg); } catch (_) {} };
    const send = (done, total, text) => { try { if (!sender.isDestroyed()) sender.send('gptsovits-srt-progress', { done, total, text }); } catch (_) {} };
    try {
      const base = await getGptSoVITSUrl();
      const tmpDir = path.join(app.getPath('userData'), `gsovits_srt_${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      let ffprobeBin = 'ffprobe';
      try { ffprobeBin = require('ffprobe-static').path; } catch (_) {
        try { ffprobeBin = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'); } catch (_) {}
      }
      const { execFile } = require('child_process');
      const execP = (cmd, args) => new Promise((res, rej) =>
        execFile(cmd, args, { timeout: 60000 }, (e, out) => e ? rej(new Error(e.message)) : res(out))
      );

      const wavPaths = [];
      const startMs  = [];
      let cursor = 0;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const outWav = path.join(tmpDir, `seg_${i}.wav`);
        send(i, segments.length, seg.text?.slice(0, 30));
        log(`[${i+1}/${segments.length}] ${seg.text?.slice(0,40)}...`);

        const GSV_LANGS2 = { vi:'auto', en:'en', zh:'auto', ja:'auto', ko:'auto', yue:'yue' };
        const ttsLang2 = GSV_LANGS2[lang] || 'auto';
        const promptLang2 = GSV_LANGS2[refLang || lang] || 'auto';
        const hasRef2 = refAudioPath && fs.existsSync(refAudioPath);
        const refPathFwd2 = hasRef2 ? refAudioPath.replace(/\\/g, '/') : '';
        const body = {
          text: seg.text, text_lang: ttsLang2,
          ref_audio_path: refPathFwd2,
          prompt_text: hasRef2 ? (refText?.trim() || '') : '',
          prompt_lang: hasRef2 ? promptLang2 : ttsLang2,
          top_k: 5, top_p: 1.0, temperature: 1.0,
          speed_factor: speed || 1.0, media_type: 'wav', streaming_mode: false,
          text_split_method: 'cut3', batch_size: 1,
        };
        const r = await httpPostJson(base + '/tts', body, 600000);
        if (r.status !== 200) throw new Error(`Segment ${i}: HTTP ${r.status}`);
        fs.writeFileSync(outWav, r.body);

        // Đo duration
        let durMs = 0;
        try {
          const probeOut = await execP(ffprobeBin, ['-v','error','-show_entries','format=duration','-of','json', outWav]);
          durMs = Math.round(parseFloat(JSON.parse(probeOut).format.duration) * 1000);
        } catch (_) {}

        startMs.push(cursor);
        wavPaths.push(outWav);
        cursor += durMs || 2000;
      }
      send(segments.length, segments.length, 'Ghép audio...');
      log('🎞️ Ghép audio...');

      // ffmpeg amix
      const inputs = [];
      const filterParts = [];
      wavPaths.forEach((p, idx) => {
        inputs.push('-i', p);
        filterParts.push(`[${idx}:a]adelay=${startMs[idx]}|${startMs[idx]}[a${idx}]`);
      });
      const mixInputs = wavPaths.map((_, i) => `[a${i}]`).join('');
      const filterComplex = filterParts.join(';') + `;${mixInputs}amix=inputs=${wavPaths.length}:duration=longest:normalize=0[out]`;
      const dir = path.dirname(outputPath);
      fs.mkdirSync(dir, { recursive: true });
      await execP(ffmpegPath, ['-y', ...inputs, '-filter_complex', filterComplex, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '3', outputPath]);

      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      log(`✅ Xong → ${path.basename(outputPath)}`);
      return { success: true, path: outputPath };
    } catch (e) {
      log(`❌ ${e.message}`);
      return { success: false, error: e.message };
    }
  });
}
// ── END GPT-SoVITS TTS ───────────────────────────────────────────────────────

// ── KOKORO TTS ────────────────────────────────────────────────────────────────
{
  const http = require('http');
  const KOKORO_PORT        = 8008;
  const KOKORO_ASSETS      = path.join(__dirname, '..', '..', 'assets', 'kokorotts');
  const KOKORO_SERVER_SCRIPT = path.join(__dirname, 'kokoro_server.py');
  let _kokoroProc = null;

  const VI_ID_MAP = {
    vi_co_gai_hoat_ngon:  'vi-VN-HoaiMyNeural',
    vi_gai_nho_ngot:      'vi-VN-HoaiMyNeural',
    vi_nu_pho_thong:      'vi-VN-HoaiMyNeural',
    vi_thanh_nien_tu_tin: 'vi-VN-NamMinhNeural',
    vi_gai_be:            'vi-VN-HoaiMyNeural',
    vi_mai:               'vi-VN-HoaiMyNeural',
    vi_minh:              'vi-VN-NamMinhNeural',
  };

  const kokoroFetch = (method, endpoint, body = null) => new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = http.request({ hostname: '127.0.0.1', port: KOKORO_PORT, path: endpoint, method, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.headers['content-type']?.includes('audio')) {
          resolve({ audio: buf, ok: true });
        } else {
          try { resolve({ json: JSON.parse(buf.toString()), ok: res.statusCode < 300 }); }
          catch (_) { resolve({ json: { error: buf.toString() }, ok: false }); }
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });

  ipcMain.handle('kokoro:check-status', async () => {
    const modelsReady = fs.existsSync(path.join(KOKORO_ASSETS, 'kokoro-v1.0.onnx'))
                     && fs.existsSync(path.join(KOKORO_ASSETS, 'voices-v1.0.bin'));
    let serverRunning = false;
    try {
      const r = await Promise.race([
        kokoroFetch('GET', '/health'),
        new Promise((_, rej) => setTimeout(() => rej(), 1000)),
      ]);
      serverRunning = r?.json?.status === 'ok';
    } catch (_) {}
    return { modelsReady, serverRunning };
  });

  ipcMain.handle('kokoro:start-server', async (event) => {
    if (_kokoroProc) return { success: true, already: true };
    const sender = event.sender;
    const sendLog = (msg) => { try { if (!sender.isDestroyed()) sender.send('kokoro-log', msg); } catch (_) {} };

    // Find Python
    const { execSync } = require('child_process');
    let pyExe = null;
    for (const cmd of ['python', 'python3']) {
      try { execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 3000 }); pyExe = cmd; break; } catch (_) {}
    }
    if (!pyExe) return { success: false, error: 'Không tìm thấy Python. Cài Python 3.9+ và thêm vào PATH.' };

    const gpuDev = await detectGPU();
    return new Promise((resolve) => {
      const env = { ...process.env, PYTHONPATH: KOKORO_ASSETS, KOKORO_MODEL_DIR: KOKORO_ASSETS, KOKORO_PORT: String(KOKORO_PORT), FLUXY_GPU_DEVICE: gpuDev };
      sendLog(`🚀 Khởi động Kokoro server... [GPU: ${gpuDev}]`);
      _kokoroProc = spawn(pyExe, [KOKORO_SERVER_SCRIPT], { env, stdio: 'pipe' });
      let resolved = false;
      const done = (r) => { if (!resolved) { resolved = true; resolve(r); } };

      _kokoroProc.stdout.on('data', d => {
        const txt = d.toString().trim();
        if (txt) sendLog(txt);
        if (txt.includes('Ready')) done({ success: true });
      });
      _kokoroProc.stderr.on('data', d => { const t = d.toString().trim(); if (t) sendLog(`[err] ${t}`); });
      _kokoroProc.on('close', () => { _kokoroProc = null; sendLog('⚠️ Server đã dừng'); done({ success: false, error: 'Server stopped' }); });
      _kokoroProc.on('error', e => { _kokoroProc = null; done({ success: false, error: e.message }); });
      setTimeout(() => done({ success: false, error: 'Timeout 60s — kiểm tra Python + kokoro_onnx' }), 60000);
    });
  });

  ipcMain.handle('kokoro:stop-server', async () => {
    if (_kokoroProc) { try { _kokoroProc.kill(); } catch (_) {} _kokoroProc = null; }
    return { success: true };
  });

  // Đăng ký auto-start khi app mở (chỉ nếu model đã có sẵn)
  _ttsAutoStartRegistry.push({ name: 'Kokoro TTS', startFn: async (win) => {
    try {
      if (_kokoroProc) return;
      const modelsReady = fs.existsSync(path.join(KOKORO_ASSETS, 'kokoro-v1.0.onnx'))
                       && fs.existsSync(path.join(KOKORO_ASSETS, 'voices-v1.0.bin'));
      if (!modelsReady) return;

      const { execSync } = require('child_process');
      let pyExe = null;
      for (const py of ['python', 'python3']) {
        try { execSync(`${py} --version`, { timeout: 3000, stdio: 'ignore' }); pyExe = py; break; } catch (_) {}
      }
      if (!pyExe) return;

      const sendLog = (msg) => { try { win?.webContents?.send('kokoro-log', msg); } catch (_) {} };
      sendLog('🚀 Auto-start Kokoro TTS server...');
      const gpuDev = await detectGPU();
      const env = { ...process.env, PYTHONPATH: KOKORO_ASSETS, KOKORO_MODEL_DIR: KOKORO_ASSETS, KOKORO_PORT: String(KOKORO_PORT), FLUXY_GPU_DEVICE: gpuDev };
      _kokoroProc = spawn(pyExe, [KOKORO_SERVER_SCRIPT], { env, stdio: 'pipe' });
      _kokoroProc.stdout.on('data', d => { const t = d.toString().trim(); if (t) sendLog(t); });
      _kokoroProc.stderr.on('data', d => { const t = d.toString().trim(); if (t) sendLog(`[err] ${t}`); });
      _kokoroProc.on('close', () => { _kokoroProc = null; sendLog('⚠️ Kokoro server đã dừng'); });
      _kokoroProc.on('error', e => { _kokoroProc = null; console.log('[Kokoro auto-start]', e.message); });
    } catch (e) { console.log('[Kokoro auto-start]', e.message); }
  }});

  // Shared: đảm bảo Kokoro server đang chạy, tự start nếu chưa
  async function ensureKokoroServer(sendLog) {
    // Kiểm tra server health
    try {
      const h = await Promise.race([
        kokoroFetch('GET', '/health'),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1500)),
      ]);
      if (h?.json?.status === 'ok') return true;
    } catch (_) {}

    // Server chưa chạy → tự start
    if (_kokoroProc) return true; // đang start, chờ thêm
    const modelsReady = fs.existsSync(path.join(KOKORO_ASSETS, 'kokoro-v1.0.onnx'))
                     && fs.existsSync(path.join(KOKORO_ASSETS, 'voices-v1.0.bin'));
    if (!modelsReady) throw new Error('Kokoro model chưa cài — tải model vào assets/kokorotts/');

    const { execSync } = require('child_process');
    let pyExe = null;
    for (const py of ['python', 'python3']) {
      try { execSync(`${py} --version`, { timeout: 3000, stdio: 'ignore' }); pyExe = py; break; } catch (_) {}
    }
    if (!pyExe) throw new Error('Không tìm thấy Python. Cài Python 3.9+ và thêm vào PATH.');

    sendLog('🚀 Tự khởi động Kokoro server...');
    const gpuDev = _gpuDevice || await detectGPU();
    const env = { ...process.env, PYTHONPATH: KOKORO_ASSETS, KOKORO_MODEL_DIR: KOKORO_ASSETS, KOKORO_PORT: String(KOKORO_PORT), FLUXY_GPU_DEVICE: gpuDev };

    await new Promise((resolve, reject) => {
      _kokoroProc = spawn(pyExe, [KOKORO_SERVER_SCRIPT], { env, stdio: 'pipe' });
      let resolved = false;
      const done = (ok, err) => { if (!resolved) { resolved = true; ok ? resolve() : reject(new Error(err)); } };
      _kokoroProc.stdout.on('data', d => {
        const t = d.toString().trim();
        if (t) sendLog(t);
        if (t.includes('Ready')) done(true);
      });
      _kokoroProc.stderr.on('data', d => { const t = d.toString().trim(); if (t) sendLog(`[err] ${t}`); });
      _kokoroProc.on('close', () => { _kokoroProc = null; done(false, 'Server dừng bất ngờ'); });
      _kokoroProc.on('error', e => { _kokoroProc = null; done(false, e.message); });
      setTimeout(() => done(false, 'Timeout 60s khởi động Kokoro'), 60000);
    });
    return true;
  }

  ipcMain.handle('kokoro:synthesize', async (event, { text, voice, speed = 1.0, outputPath }) => {
    const sender = event.sender;
    const sendLog = (msg) => { try { if (!sender.isDestroyed()) sender.send('kokoro-log', msg); } catch (_) {} };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Giọng Việt (VI_ID_MAP) hoặc voice bắt đầu bằng 'vi_' → Edge TTS
    const edgeVoice = VI_ID_MAP[voice];
    if (edgeVoice) {
      sendLog(`🇻🇳 Giọng Việt → Edge TTS (${edgeVoice})`);
      try {
        const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
        const tts = new MsEdgeTTS();
        await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        await new Promise((res, rej) => {
          const readable = tts.toStream(text);
          const chunks = [];
          readable.on('data', d => chunks.push(d));
          readable.on('end', () => { fs.writeFileSync(outputPath, Buffer.concat(chunks)); res(); });
          readable.on('error', rej);
        });
        sendLog(`✅ Lưu: ${path.basename(outputPath)}`);
        return { success: true, path: outputPath };
      } catch (e) { sendLog(`❌ ${e.message}`); return { success: false, error: e.message }; }
    }

    // Kokoro EN/JA/ZH/KO — đảm bảo server đang chạy
    try {
      await ensureKokoroServer(sendLog);
    } catch (startErr) {
      return { success: false, error: startErr.message };
    }

    // Fallback voice nếu ID không hợp lệ
    const VALID_KOKORO_IDS = new Set([
      'af_heart','af_bella','af_nicole','af_sarah','af_sky','am_adam','am_michael',
      'bf_emma','bf_isabella','bm_george','bm_lewis',
      'jf_alpha','jf_gongitsune','jm_kurosawa','jm_nezha',
      'zf_xiaobei','zf_xiaoni','zf_xiaoxiao','zm_yunxi',
      'kf_dawon','km_hyunwoo',
      'ff_siwis','ef_dora','hf_alpha',
    ]);
    const safeVoice = VALID_KOKORO_IDS.has(voice) ? voice : 'af_heart';
    if (safeVoice !== voice) sendLog(`⚠️ Voice "${voice}" không hợp lệ → dùng af_heart`);

    sendLog(`🎙️ Kokoro: ${safeVoice} · ${text.length} ký tự`);
    try {
      const r = await kokoroFetch('POST', '/v1/audio/speech', { input: text, voice: safeVoice, speed, model: 'kokoro' });
      if (!r.ok || !r.audio) throw new Error(r.json?.error || 'Server lỗi');
      fs.writeFileSync(outputPath, r.audio);
      sendLog(`✅ Lưu: ${path.basename(outputPath)}`);
      return { success: true, path: outputPath };
    } catch (e) { sendLog(`❌ ${e.message}`); return { success: false, error: e.message }; }
  });
}
// ── END KOKORO TTS ────────────────────────────────────────────────────────────

// ── CHATTERBOX TTS ────────────────────────────────────────────────────────────
{
  const { spawn, execFile } = require('child_process');
  const AdmZipCb = (() => { try { return require('adm-zip'); } catch (_) { return null; } })();

  const CB_DIR        = path.join(app.getPath('userData'), 'chatterbox_env');
  const CB_PY_DIR     = path.join(CB_DIR, 'python');
  const CB_PY_EXE     = path.join(CB_PY_DIR, 'python.exe');
  const CB_SERVER_DIR = path.join(CB_DIR, 'server');
  const CB_STATUS     = path.join(CB_DIR, 'setup_done.json');
  const CB_MODEL_CACHE= path.join(CB_DIR, 'models');

  const CB_PY_VER     = '3.10.11';
  const CB_PY_URL     = `https://www.python.org/ftp/python/${CB_PY_VER}/python-${CB_PY_VER}-embed-amd64.zip`;
  const CB_SERVER_URL = 'https://github.com/devnen/Chatterbox-TTS-Server/archive/refs/heads/main.zip';

  let cbProc = null;
  let _cbAbort = false;

  const sendCbLog = (text, level = 'info') => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('chatterbox-log', { text, level, time: Date.now() });
  };
  const sendCbProgress = (step, pct, message) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('chatterbox-progress', { step, pct, message });
  };

  // Download dùng PowerShell — tự động theo redirect, xử lý HTTPS/GitHub
  function dlFileCb(url, dest, label = '') {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      const ps = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${dest}' -UseBasicParsing`;
      // Poll file size để hiện progress
      let pollId = setInterval(() => {
        try {
          const sz = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
          if (sz > 0) sendCbProgress('download', -1, `Đang tải ${label}... ${(sz/1048576).toFixed(1)} MB`);
        } catch (_) {}
      }, 1000);
      execFile('powershell.exe', ['-NonInteractive', '-Command', ps], { timeout: 15 * 60 * 1000 }, (err, _stdout, stderr) => {
        clearInterval(pollId);
        if (err) return reject(new Error((stderr || err.message).slice(0, 300)));
        if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000)
          return reject(new Error(`File tải về rỗng hoặc lỗi: ${dest}`));
        resolve();
      });
    });
  }

  function runCbPy(args, cwd) {
    const wd = cwd || CB_SERVER_DIR;
    return new Promise((resolve, reject) => {
      execFile(CB_PY_EXE, args, {
        cwd: wd,
        env: { ...process.env, HF_HOME: CB_MODEL_CACHE, HF_HUB_CACHE: CB_MODEL_CACHE, PYTHONIOENCODING: 'utf-8' },
        timeout: 0, maxBuffer: 30 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).slice(-800)));
        resolve(stdout.trim());
      });
    });
  }

  function extractZip(zipPath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    // Dùng PowerShell để tránh lỗi AdmZip với các file ZIP lớn hoặc có ký tự đặc biệt
    const { execSync } = require('child_process');
    execSync(`powershell -NonInteractive -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { timeout: 180000 });
  }

  async function setupChatterbox() {
    _cbAbort = false;
    fs.mkdirSync(CB_DIR, { recursive: true });
    fs.mkdirSync(CB_MODEL_CACHE, { recursive: true });
    // Xóa file zip cũ bị lỗi nếu còn sót
    for (const f of ['py_embed.zip', 'server.zip', 'get-pip.py']) {
      try { const fp = path.join(CB_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }

    // 1. Python 3.10.11 embeddable
    if (!fs.existsSync(CB_PY_EXE)) {
      sendCbProgress('download', 0, 'Tải Python 3.10.11 (~8MB)...');
      const pyZip = path.join(CB_DIR, 'py_embed.zip');
      await dlFileCb(CB_PY_URL, pyZip, 'Python 3.10');
      if (_cbAbort) throw new Error('Đã hủy');
      sendCbProgress('extract', 2, 'Giải nén Python...');
      extractZip(pyZip, CB_PY_DIR);
      fs.unlinkSync(pyZip);
      // Fix _pth: enable site-packages
      const pthFile = fs.readdirSync(CB_PY_DIR).find(f => /python\d+\._pth$/.test(f));
      if (pthFile) {
        const pthPath = path.join(CB_PY_DIR, pthFile);
        fs.writeFileSync(pthPath, fs.readFileSync(pthPath, 'utf8').replace('#import site', 'import site'));
      }
    }

    // 2. Pip
    const pipExe = path.join(CB_PY_DIR, 'Scripts', 'pip.exe');
    if (!fs.existsSync(pipExe)) {
      sendCbProgress('pip', 5, 'Cài pip...');
      const getPip = path.join(CB_DIR, 'get-pip.py');
      await dlFileCb('https://bootstrap.pypa.io/get-pip.py', getPip, 'get-pip.py');
      await runCbPy([getPip, '--no-warn-script-location'], CB_DIR);
      try { fs.unlinkSync(getPip); } catch (_) {}
    }

    // 3. Download server source
    if (!fs.existsSync(path.join(CB_SERVER_DIR, 'server.py'))) {
      sendCbProgress('download', 10, 'Tải Chatterbox-TTS-Server (~2MB)...');
      const srvZip = path.join(CB_DIR, 'server.zip');
      await dlFileCb(CB_SERVER_URL, srvZip, 'Chatterbox-TTS-Server');
      if (_cbAbort) throw new Error('Đã hủy');
      sendCbProgress('extract', 15, 'Giải nén server...');
      const tmpDir = path.join(CB_DIR, '_srv_tmp');
      extractZip(srvZip, tmpDir);
      fs.unlinkSync(srvZip);
      // GitHub zip extracts to Chatterbox-TTS-Server-main/
      const inner = fs.readdirSync(tmpDir).find(d => d.startsWith('Chatterbox-TTS-Server'));
      if (inner) {
        const { execSync } = require('child_process');
        fs.mkdirSync(CB_SERVER_DIR, { recursive: true });
        execSync(`xcopy "${path.join(tmpDir, inner)}" "${CB_SERVER_DIR}" /E /I /Y /Q`, { timeout: 30000 });
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    // 4. Install requirements (CPU)
    sendCbProgress('install', 20, 'Cài PyTorch + dependencies (~500MB, mất 5-10 phút)...');
    const reqFile = path.join(CB_SERVER_DIR, 'requirements.txt');
    await runCbPy(['-m', 'pip', 'install', '-r', reqFile, '--no-warn-script-location', '-q', '--progress-bar', 'off'], CB_DIR);
    if (_cbAbort) throw new Error('Đã hủy');

    // 5. Install chatterbox library (devnen fork)
    sendCbProgress('install', 80, 'Cài thư viện Chatterbox...');
    await runCbPy(['-m', 'pip', 'install', '--no-deps',
      'git+https://github.com/devnen/chatterbox-v2.git@master',
      '--no-warn-script-location', '-q'], CB_DIR);

    fs.writeFileSync(CB_STATUS, JSON.stringify({ version: '1.0', date: Date.now() }));
    sendCbProgress('done', 100, 'Chatterbox TTS cài đặt xong! Đang khởi động server...');
  }

  const cbStartServer = () => {
    if (cbProc && !cbProc.killed) return;
    sendCbLog('🚀 Khởi động Chatterbox TTS Server...', 'info');
    sendCbLog('⏳ Lần đầu cần tải model ~1.5GB từ HuggingFace, xin chờ...', 'info');
    // Embedded Python bỏ qua PYTHONPATH — dùng runpy để __file__ được định nghĩa đúng
    const serverPy = path.join(CB_SERVER_DIR, 'server.py').replace(/\\/g, '\\\\');
    const startScript = `import sys, runpy; sys.path.insert(0, r'${CB_SERVER_DIR}'); runpy.run_path(r'${serverPy}', run_name='__main__')`;
    cbProc = spawn(CB_PY_EXE, ['-c', startScript], {
      cwd: CB_SERVER_DIR,
      env: {
        ...process.env,
        HF_HOME: CB_MODEL_CACHE,
        HF_HUB_CACHE: CB_MODEL_CACHE,
        PYTHONIOENCODING: 'utf-8',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        HF_HUB_DISABLE_PROGRESS_BARS: '0',
        HF_ENDPOINT: 'https://hf-mirror.com',
      },
      windowsHide: true,
    });
    cbProc.stdout?.on('data', d => { const t = d.toString().trim(); if (t) sendCbLog(t, 'info'); });
    cbProc.stderr?.on('data', d => { const t = d.toString().trim(); if (t) sendCbLog(t, 'warn'); });
    cbProc.on('exit', code => { cbProc = null; sendCbLog(`Server thoát (code ${code})`, 'warn'); });
    cbProc.on('error', err => { cbProc = null; sendCbLog(`Lỗi: ${err.message}`, 'error'); });
  };

  ipcMain.handle('chatterbox:check-status', () => ({
    installed: fs.existsSync(CB_STATUS),
    running: !!(cbProc && !cbProc.killed),
  }));

  ipcMain.handle('chatterbox:setup', async () => {
    try { await setupChatterbox(); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('chatterbox:cancel-setup', () => { _cbAbort = true; return { ok: true }; });

  ipcMain.handle('chatterbox:repair', async () => {
    try {
      sendCbProgress('install', 0, 'Cài các package còn thiếu...');
      const missingPkgs = ['s3tokenizer', 'conformer', 'vocos', 'resemble-enhance'];
      for (let i = 0; i < missingPkgs.length; i++) {
        const pkg = missingPkgs[i];
        sendCbProgress('install', Math.round((i / missingPkgs.length) * 90), `Cài ${pkg}...`);
        try {
          await runCbPy(['-m', 'pip', 'install', pkg, '--no-warn-script-location', '-q', '--progress-bar', 'off'], CB_DIR);
        } catch (e) {
          sendCbLog(`⚠️ ${pkg}: ${e.message.slice(0, 100)}`, 'warn');
        }
      }
      sendCbProgress('done', 100, 'Repair xong! Thử khởi động lại server...');
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('chatterbox:start', async () => {
    if (!fs.existsSync(CB_STATUS)) return { success: false, needSetup: true };
    if (cbProc && !cbProc.killed) return { alreadyRunning: true };
    cbStartServer();
    return { success: true };
  });

  ipcMain.handle('chatterbox:stop', async () => {
    if (cbProc && !cbProc.killed) { cbProc.kill(); cbProc = null; }
    return { ok: true };
  });

  app.on('before-quit', () => { if (cbProc && !cbProc.killed) cbProc.kill(); });
}
// ── END CHATTERBOX TTS ────────────────────────────────────────────────────────

// ── CHATTERBOX: synthesize-srt (per-segment với timing) ─────────────────────
ipcMain.handle('chatterbox:synthesize-srt', async (event, { segments, outputPath, language = 'en', voiceMode = 'predefined', predefinedVoiceId, referenceAudioFilename }) => {
  const CB_BASE = 'http://localhost:8004';
  const { execFile } = require('child_process');
  const http = require('http');
  const cbHttpPost = (url, bodyObj) => new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } };
    const urlObj = new URL(url);
    const req = http.request({ hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, ...opts }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });

  let ffprobeBin = 'ffprobe';
  try { ffprobeBin = require('ffprobe-static').path; } catch (_) {
    try { ffprobeBin = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'); } catch (_) {}
  }
  const execP = (cmd, args) => new Promise((res, rej) =>
    execFile(cmd, args, { timeout: 180000 }, (e, out) => e ? rej(new Error(e.message)) : res(out))
  );
  const getAudioDuration = async (filePath) => {
    try {
      const out = await execP(ffprobeBin, ['-v','error','-show_entries','format=duration','-of','csv=p=0', filePath]);
      const d = parseFloat(out.trim());
      return isNaN(d) ? 0 : d;
    } catch (_) { return 0; }
  };
  const buildAtempo = (r) => {
    const steps = [];
    let rem = r;
    while (rem > 2.0) { steps.push('atempo=2.0'); rem /= 2.0; }
    steps.push(`atempo=${rem.toFixed(4)}`);
    return steps.join(',');
  };

  try {
    const tmpDir = path.join(require('os').tmpdir(), `cb_srt_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const segFiles = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const startMs = seg.startMs ?? seg.start ?? 0;
      const endMs   = seg.endMs   ?? seg.end   ?? startMs;
      const segDurSec = Math.max(0.1, (endMs - startMs) / 1000);
      const text = (seg.text || '').trim();
      const segPath = path.join(tmpDir, `seg_${String(i).padStart(4,'0')}.wav`);

      if (!text) { segFiles.push({ path: null, startMs, endMs }); continue; }

      try {
        const body = { text, voice_mode: voiceMode, language, speed_factor: 1.0, output_format: 'wav' };
        if (voiceMode === 'predefined' && predefinedVoiceId) body.predefined_voice_id = predefinedVoiceId;
        if (voiceMode === 'clone' && referenceAudioFilename) body.reference_audio_filename = referenceAudioFilename;

        const buf = await cbHttpPost(`${CB_BASE}/tts`, body);
        fs.writeFileSync(segPath, buf);
      } catch (e) {
        console.warn(`[Chatterbox SRT] seg ${i} lỗi: ${e.message}`);
        segFiles.push({ path: null, startMs, endMs }); continue;
      }

      if (!fs.existsSync(segPath)) { segFiles.push({ path: null, startMs, endMs }); continue; }

      const audioDurSec = await getAudioDuration(segPath);
      let finalPath = segPath;
      if (audioDurSec > 0.05 && audioDurSec > segDurSec + 0.05) {
        const ratio = audioDurSec / segDurSec;
        const adjusted = path.join(tmpDir, `seg_${String(i).padStart(4,'0')}_adj.wav`);
        try {
          await execP(ffmpegPath, ['-y','-i',segPath,'-filter:a',buildAtempo(ratio),'-c:a','pcm_s16le',adjusted]);
          finalPath = adjusted;
        } catch (_) {}
      }

      segFiles.push({ path: finalPath, startMs, endMs });

      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('chatterbox-srt-progress', { done: i + 1, total: segments.length, text: text.slice(0, 40) });
    }

    const validSegs = segFiles.filter(sf => sf.path);
    if (validSegs.length === 0) return { success: false, error: 'Không có segment nào tổng hợp được' };

    const totalMs = segFiles[segFiles.length - 1].endMs + 500;
    const inputs = [];
    const filterParts = [];
    validSegs.forEach((sf, idx) => {
      inputs.push('-i', sf.path);
      filterParts.push(`[${idx}:a]adelay=${sf.startMs}|${sf.startMs}[a${idx}]`);
    });
    const mixInputs = validSegs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = filterParts.join(';') + `;${mixInputs}amix=inputs=${validSegs.length}:duration=longest:normalize=0[out]`;

    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    await execP(ffmpegPath, [
      '-y', ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-t', (totalMs / 1000).toFixed(3),
      '-c:a', 'libmp3lame', '-q:a', '3',
      outputPath,
    ]);

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return { success: true, path: outputPath };
  } catch (e) { return { success: false, error: e.message }; }
});
// ── END CHATTERBOX synthesize-srt ────────────────────────────────────────────


app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async () => {
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

// ── GEMINI QUOTA TRACKER ─────────────────────────────────────────────────────
// Track chars used per key per day — reset tự động mỗi ngày
// Free tier: 10,000 tokens/ngày/key ≈ 40,000 ký tự/key
// ~160 từ/phút, ~5 ký tự/từ → 40k chars ≈ 50 phút audio/key
const GEMINI_FREE_TOKENS_PER_DAY = 10000;
const CHARS_PER_TOKEN = 4;
const CHARS_PER_KEY_PER_DAY = GEMINI_FREE_TOKENS_PER_DAY * CHARS_PER_TOKEN; // 40,000

let _gmQuota = { date: '', keys: {} }; // key → { charsUsed, exhausted }

function _gmQuotaToday() {
    const today = new Date().toISOString().slice(0, 10);
    if (_gmQuota.date !== today) { _gmQuota = { date: today, keys: {} }; }
    return _gmQuota;
}
function _gmKeyHash(key) { return key.slice(-8); } // dùng 8 ký tự cuối để nhận dạng
function gmQuotaTrackChars(key, chars) {
    const q = _gmQuotaToday();
    const h = _gmKeyHash(key);
    if (!q.keys[h]) q.keys[h] = { charsUsed: 0, exhausted: false };
    q.keys[h].charsUsed += chars;
}
function gmQuotaMarkExhausted(key) {
    const q = _gmQuotaToday();
    const h = _gmKeyHash(key);
    if (!q.keys[h]) q.keys[h] = { charsUsed: CHARS_PER_KEY_PER_DAY, exhausted: false };
    q.keys[h].exhausted = true;
    q.keys[h].charsUsed = Math.max(q.keys[h].charsUsed, CHARS_PER_KEY_PER_DAY);
}
// Trả về index của key còn nhiều token nhất hôm nay (chưa exhausted, charsUsed thấp nhất)
function gmPickBestKeyIdx(allKeys) {
    const q = _gmQuotaToday();
    let bestIdx = 0, bestRemaining = -1;
    for (let i = 0; i < allKeys.length; i++) {
        const h = _gmKeyHash(allKeys[i]);
        const kq = q.keys[h];
        if (kq?.exhausted) continue; // bỏ qua key đã hết
        const used = kq?.charsUsed || 0;
        const remaining = CHARS_PER_KEY_PER_DAY - used;
        if (remaining > bestRemaining) { bestRemaining = remaining; bestIdx = i; }
    }
    return bestIdx;
}

function gmQuotaGetStatus(allKeys) {
    const q = _gmQuotaToday();
    const total = allKeys.length;
    let exhaustedCount = 0, totalCharsUsed = 0;
    for (const key of allKeys) {
        const h = _gmKeyHash(key);
        const kq = q.keys[h];
        if (kq) {
            totalCharsUsed += kq.charsUsed;
            if (kq.exhausted) exhaustedCount++;
        }
    }
    const totalCapacity  = total * CHARS_PER_KEY_PER_DAY;
    const charsRemaining = Math.max(0, totalCapacity - totalCharsUsed);
    // ~160 từ/phút × 5 ký tự/từ = 800 ký tự/phút audio
    const minutesRemaining = Math.round(charsRemaining / 800);
    return { total, exhausted: exhaustedCount, available: total - exhaustedCount,
             charsUsed: totalCharsUsed, charsRemaining, totalCapacity, minutesRemaining };
}

ipcMain.handle('gemini:quota-status', (_, { apiKeys }) => {
    const keys = Array.isArray(apiKeys) ? apiKeys : [];
    return gmQuotaGetStatus(keys);
});

// ── GEMINI TTS ───────────────────────────────────────────────────────────────
ipcMain.handle('gemini:tts', async (event, { text, voiceName, apiKey, apiKeys, outputFolder, projectName, ttsModel }) => {
    try {
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

        const https  = require('https');
        const os     = require('os');
        const keys   = Array.isArray(apiKeys) && apiKeys.length ? apiKeys : (apiKey ? [apiKey] : []);
        if (!keys.length) return { success: false, error: 'Không có API Key Gemini' };

        const model    = ttsModel || 'gemini-2.5-flash-preview-tts';
        const MAX_CHARS = 3000; // 3k chars/chunk — cắt hết câu, an toàn nhất
        const SAMPLE_RATE = 24000, NUM_CH = 1, BPS = 2; // 16-bit PCM mono

        const isQuota = (msg) => msg && (
            msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('rate') || msg.includes('429') ||
            msg.includes('free_tier_input_token') ||
            msg.includes('denied access') || msg.includes('PERMISSION_DENIED') ||
            msg.includes('API_KEY_INVALID') || msg.includes('disabled') ||
            msg.includes('billing') || msg.includes('not enabled')
        );

        // ── Chia text tại ranh giới câu, mỗi chunk <= MAX_CHARS ─────────────
        const splitChunks = (txt, maxChars) => {
            const ENDERS = new Set(['.', '!', '?', '…', '\n']);
            const chunks = [], len = txt.length;
            let start = 0;
            while (start < len) {
                if (len - start <= maxChars) { chunks.push(txt.slice(start).trim()); break; }
                let cut = start + maxChars;
                // tìm ngược về ranh giới câu gần nhất
                for (let j = cut; j > start + maxChars * 0.5; j--) {
                    if (ENDERS.has(txt[j])) { cut = j + 1; break; }
                }
                chunks.push(txt.slice(start, cut).trim());
                start = cut;
            }
            return chunks.filter(c => c.length > 0);
        };

        // ── Gọi API 1 chunk với key riêng, xoay key CHỈ KHI quota/lỗi ────────
        // startKeyIdx: key bắt đầu cho chunk này (mỗi chunk dùng key khác nhau song song)
        const callChunk = async (chunkText, startKeyIdx = 0) => {
            const bodyBuf = Buffer.from(JSON.stringify({
                contents: [{ parts: [{ text: chunkText }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
                }
            }), 'utf-8');

            let localKeyIdx = startKeyIdx;
            // Tối đa 1 lần thử mỗi key, không retry vô hạn
            const maxAttempts = Math.min(keys.length + 2, 8);
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const key = keys[localKeyIdx % keys.length];
                let result;
                try {
                    result = await new Promise((resolve, reject) => {
                        let settled = false;
                        const done = (val, isErr) => {
                            if (settled) return;
                            settled = true;
                            isErr ? reject(val) : resolve(val);
                        };
                        const req = https.request({
                            hostname: 'generativelanguage.googleapis.com',
                            path: `/v1beta/models/${model}:generateContent?key=${key}`,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }
                        }, res => {
                            const bufs = [];
                            res.on('data', c => bufs.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                            res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(bufs).toString('utf-8') }));
                            res.on('error', e => done(e, true));
                        });
                        req.on('error', e => done(e, true));
                        req.setTimeout(180000, () => { req.destroy(); done(new Error('TIMEOUT'), true); });
                        req.write(bodyBuf); req.end();
                    });
                } catch (err) {
                    localKeyIdx++;
                    if (attempt < maxAttempts - 1) continue;
                    throw new Error(`Chunk thất bại sau ${maxAttempts} lần: ${err.message}`);
                }

                const { status, body } = result;
                let json;
                try { json = JSON.parse(body); } catch (_) { json = {}; }

                if (status !== 200) {
                    const errMsg = json?.error?.message || `HTTP ${status}`;
                    // 401/403 = key này không hợp lệ → rotate sang key tiếp (không throw ngay)
                    if (status === 401 || status === 403 || (errMsg && (errMsg.includes('UNAUTHENTICATED') || errMsg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || errMsg.includes('PERMISSION_DENIED')))) {
                        try { event.sender.send('gemini-tts-log', `⚠️ Key #${localKeyIdx+1} không hợp lệ (${status}) → thử key tiếp...`); } catch (_) {}
                        localKeyIdx++;
                        if (attempt < maxAttempts - 1) continue;
                        throw new Error(`Tất cả ${maxAttempts} key đều không hợp lệ cho Gemini TTS — kiểm tra Gemini API key`);
                    }
                    if (isQuota(errMsg)) gmQuotaMarkExhausted(key);
                    localKeyIdx++;
                    if (attempt < maxAttempts - 1) continue;
                    throw new Error(errMsg);
                }

                let b64 = null;
                for (const cand of (json?.candidates || []))
                    for (const part of (cand?.content?.parts || []))
                        if (part?.inlineData?.data) { b64 = part.inlineData.data; break; }
                if (!b64) {
                    localKeyIdx++;
                    if (attempt < maxAttempts - 1) continue;
                    throw new Error(`Gemini không trả về audio (${json?.candidates?.[0]?.finishReason || 'no_audio'})`);
                }

                gmQuotaTrackChars(key, chunkText.length);
                return Buffer.from(b64, 'base64'); // PCM raw
            }
            throw new Error('Tất cả key đều thất bại sau nhiều lần thử');
        };

        // ── PCM buffer → WAV buffer ──────────────────────────────────────────
        const toWav = (pcm) => {
            const hdr = Buffer.alloc(44);
            hdr.write('RIFF', 0);    hdr.writeUInt32LE(36 + pcm.length, 4);
            hdr.write('WAVE', 8);    hdr.write('fmt ', 12);
            hdr.writeUInt32LE(16, 16);   hdr.writeUInt16LE(1, 20);
            hdr.writeUInt16LE(NUM_CH, 22);
            hdr.writeUInt32LE(SAMPLE_RATE, 24);
            hdr.writeUInt32LE(SAMPLE_RATE * NUM_CH * BPS, 28);
            hdr.writeUInt16LE(NUM_CH * BPS, 32);
            hdr.writeUInt16LE(BPS * 8, 34);
            hdr.write('data', 36);   hdr.writeUInt32LE(pcm.length, 40);
            return Buffer.concat([hdr, pcm]);
        };

        // ── Ghép nhiều WAV bằng ffmpeg concat (không tốn RAM) ───────────────
        const concatWavs = (wavPaths, outPath) => new Promise((resolve, reject) => {
            const listFile = path.join(os.tmpdir(), `gm_tts_list_${Date.now()}.txt`);
            // Dùng forward slash và escape single quote theo chuẩn ffmpeg concat trên Windows
            const lines = wavPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
            fs.writeFileSync(listFile, lines, 'utf8');
            const ffmpegBin = (() => { try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; } })();
            const { spawn: _sp } = require('child_process');
            const proc = _sp(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath], { windowsHide: true });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d; });
            proc.on('close', code => {
                try { fs.unlinkSync(listFile); } catch (_) {}
                if (code === 0) resolve(); else reject(new Error('ffmpeg concat lỗi: ' + stderr.slice(-500)));
            });
            proc.on('error', reject);
        });

        // ── Main: chia chunk → TTS → ghép ───────────────────────────────────
        const sendProgress = (done, total, chunkText) => {
            try { event.sender.send('gemini-tts-progress', { done, total, text: chunkText?.slice(0, 50) }); } catch (_) {}
        };

        const chunks = splitChunks(text, MAX_CHARS);
        const rawName = (projectName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
        const ts = Date.now();

        // Tách tên + đuôi file người dùng nhập (hỗ trợ .wav và .mp3)
        let baseName, outExt;
        if (rawName) {
            const dotIdx = rawName.lastIndexOf('.');
            if (dotIdx > 0 && ['.wav','.mp3'].includes(rawName.slice(dotIdx).toLowerCase())) {
                baseName = rawName.slice(0, dotIdx);
                outExt   = rawName.slice(dotIdx).toLowerCase();
            } else {
                baseName = rawName;
                outExt   = '.wav'; // mặc định WAV nếu không ghi đuôi
            }
        } else {
            baseName = `gemini_tts_${ts}`;
            outExt   = '.wav';
        }

        const finalFileName = `${baseName}${outExt}`;
        const finalFilePath = path.join(outputFolder, finalFileName);
        // WAV trung gian — luôn tạo WAV trước, convert sang MP3 sau nếu cần
        const wavPath = outExt === '.mp3' ? path.join(outputFolder, `${baseName}_tmp_${ts}.wav`) : finalFilePath;

        // Sticky key: chọn key còn nhiều token nhất hôm nay → dùng xuyên suốt
        // Sau mỗi chunk cập nhật lại nếu key hiện tại bị exhausted → chuyển key tốt nhất tiếp theo
        let stickyKeyIdx = gmPickBestKeyIdx(keys);

        if (chunks.length === 1) {
            sendProgress(0, 1, chunks[0]);
            try { event.sender.send('gemini-tts-log', `🔊 TTS đoạn 1/1 (${chunks[0].length} ký tự)...`); } catch (_) {}
            const pcm = await callChunk(chunks[0], stickyKeyIdx);
            fs.writeFileSync(wavPath, toWav(pcm));
            sendProgress(1, 1, '');
        } else {
            const tmpDir2 = os.tmpdir();
            const tmpPaths = chunks.map((_, i) => path.join(tmpDir2, `gm_tts_chunk_${ts}_${i}.wav`));
            sendProgress(0, chunks.length, `${chunks.length} đoạn (key #${stickyKeyIdx+1})...`);
            try {
                // TUẦN TỰ — 1 key cố định xuyên suốt để giọng đồng nhất
                // Khi key hiện tại lỗi: thử lần lượt các key còn lại cho đến khi thành công
                const deadKeySet = new Set(); // key bị block vĩnh viễn trong session này
                for (let i = 0; i < chunks.length; i++) {
                    try { event.sender.send('gemini-tts-log', `🔊 TTS đoạn ${i+1}/${chunks.length} (${chunks[i].length} ký tự)...`); } catch (_) {}
                    let pcm = null;
                    let lastErr = null;
                    // Thử từ stickyKeyIdx, xoay qua tất cả key cho đến khi thành công
                    for (let attempt = 0; attempt < keys.length; attempt++) {
                        const tryIdx = (stickyKeyIdx + attempt) % keys.length;
                        if (deadKeySet.has(tryIdx)) continue;
                        try {
                            pcm = await callChunk(chunks[i], tryIdx);
                            stickyKeyIdx = tryIdx; // ghi nhớ key thành công
                            break;
                        } catch (err) {
                            lastErr = err;
                            const msg = (err.message || '').toLowerCase();
                            const isPermanent = msg.includes('denied access') || msg.includes('permission_denied') ||
                                               msg.includes('api_key_invalid') || msg.includes('401') ||
                                               msg.includes('unauthenticated') || msg.includes('not enabled') ||
                                               msg.includes('disabled');
                            if (isPermanent) deadKeySet.add(tryIdx);
                            try { event.sender.send('gemini-tts-log', `🔄 Key #${tryIdx+1} lỗi${isPermanent?' (vĩnh viễn)':''}, thử key tiếp...`); } catch (_) {}
                        }
                    }
                    if (!pcm) throw new Error(`Tất cả ${keys.length} key đều thất bại ở đoạn ${i+1}: ${lastErr?.message || 'unknown'}`);
                    fs.writeFileSync(tmpPaths[i], toWav(pcm));
                    sendProgress(i + 1, chunks.length, chunks[i]);
                }
                await concatWavs(tmpPaths, wavPath);
            } finally {
                for (const p of tmpPaths) try { fs.unlinkSync(p); } catch (_) {}
            }
        }

        // Convert WAV → MP3 nếu người dùng chọn đuôi .mp3
        if (outExt === '.mp3') {
            const ffmpegBin = (() => { try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; } })();
            await new Promise((resolve, reject) => {
                const { spawn: _sp } = require('child_process');
                const proc = _sp(ffmpegBin, ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', finalFilePath], { windowsHide: true });
                let stderr = '';
                proc.stderr?.on('data', d => { stderr += d; });
                proc.on('close', code => {
                    try { fs.unlinkSync(wavPath); } catch (_) {}
                    if (code === 0) resolve(); else reject(new Error('ffmpeg MP3 lỗi: ' + stderr.slice(-300)));
                });
                proc.on('error', reject);
            });
        }

        return { success: true, path: finalFilePath, fileName: finalFileName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── GHÉP NHIỀU FILE WAV THÀNH 1 (dùng cho Truyện Audio TTS) ─────────────────
ipcMain.handle('audio:concat-wavs', async (event, { files, outputPath, deleteAfter }) => {
    try {
        if (!files?.length) return { success: false, error: 'Không có file' };
        if (files.length === 1) {
            if (outputPath && outputPath !== files[0]) {
                try { fs.renameSync(files[0], outputPath); } catch (_) { fs.copyFileSync(files[0], outputPath); fs.unlinkSync(files[0]); }
                return { success: true, path: outputPath };
            }
            return { success: true, path: files[0] };
        }
        const listFile = path.join(app.getPath('userData'), `wav_list_${Date.now()}.txt`);
        const listContent = files.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listFile, listContent, 'utf8');
        const ffmpegBin = (() => { try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; } })();
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        await new Promise((resolve, reject) => {
            const { spawn: _sp } = require('child_process');
            const proc = _sp(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath], { windowsHide: true });
            let stderr = '';
            proc.stderr?.on('data', d => { stderr += d; });
            proc.on('close', code => {
                try { fs.unlinkSync(listFile); } catch (_) {}
                if (code === 0) resolve();
                else reject(new Error('ffmpeg concat: ' + stderr.slice(-400)));
            });
            proc.on('error', reject);
        });
        if (deleteAfter) {
            for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} }
        }
        return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── VIDEO SCAN SUBTITLES — OCR sub cứng từ frame video bằng EasyOCR ──────────
// ── TÌM PYTHON ────────────────────────────────────────────────────────────
function findPython() {
    const { execSync } = require('child_process');
    const candidates = ['python', 'python3', 'py'];
    for (const cmd of candidates) {
        try {
            const out = execSync(`${cmd} --version`, { timeout: 5000, stdio: ['pipe','pipe','pipe'] }).toString();
            if (out.includes('Python')) return cmd;
        } catch(_) {}
    }
    return null;
}

ipcMain.handle('ocr:install-easyocr', async () => {
    const sendLog = (msg, type = 'info') => mainWindow?.webContents.send('review-film-log', { msg, type });
    const sendProg = (pct, text) => mainWindow?.webContents.send('ocr-install-progress', { pct, text });
    const { exec } = require('child_process');

    const python = findPython();
    if (!python) {
        sendLog('❌ Không tìm thấy Python — hãy cài Python 3.8+ từ python.org', 'error');
        return { success: false, error: 'PYTHON_NOT_FOUND' };
    }
    sendLog(`🐍 Dùng Python: ${python}`, 'info');
    sendProg(10, 'Đang cài EasyOCR...');

    return new Promise((resolve) => {
        exec(`${python} -m pip install easyocr --quiet`, { timeout: 300000 }, (err, stdout, stderr) => {
            if (err) {
                sendLog(`❌ Cài EasyOCR thất bại: ${err.message?.slice(0, 200)}`, 'error');
                resolve({ success: false, error: err.message });
            } else {
                sendProg(100, 'Hoàn tất!');
                sendLog('✅ EasyOCR đã cài xong — chạy lại Review Phim để quét sub!', 'success');
                resolve({ success: true });
            }
        });
    });
});

// STUB giữ tương thích (không dùng nữa nhưng tránh IPC 404)
ipcMain.handle('ocr:check-tesseract', async () => {
    const t = findTesseract();
    if (!t) return { installed: false };
    const { execSync } = require('child_process');
    try {
        const out = execSync(`"${t}" --list-langs 2>&1`, { timeout: 5000 }).toString();
        const langs = out.split('\n').map(l => l.trim()).filter(Boolean);
        return { installed: true, path: t, langs, hasChinese: langs.some(l => l.startsWith('chi')) };
    } catch(_) { return { installed: true, path: t, langs: [], hasChinese: false }; }
});

ipcMain.handle('ocr:install-tesseract', async () => {
    return { success: false, error: 'Tesseract đã bị thay thế bằng EasyOCR. Dùng ocr:install-easyocr.' };
});

ipcMain.handle('video:scan-subtitles', async (event, { videoPath, fpsScan = 1 }) => {
    const os = require('os');
    const { execSync, execFile } = require('child_process');

    const sendLog = (msg, type = 'info') => mainWindow?.webContents.send('review-film-log', { msg, type });

    const tmpDir = path.join(os.tmpdir(), `ocr_scan_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {} };

    try {
        // Đọc duration
        let duration = 0;
        try {
            const probe = execSync(`"${ffprobePath}" -v quiet -print_format json -show_format "${videoPath}"`, { timeout: 10000 }).toString();
            duration = parseFloat(JSON.parse(probe)?.format?.duration || 0);
        } catch(_) {}
        if (!duration) return { success: false, error: 'Không đọc được thời lượng video' };

        const interval = 1 / fpsScan;

        // Extract frame: crop 20% dưới, scale 2x, grayscale
        sendLog(`🔍 Extract frame @ ${fpsScan}fps...`);
        try {
            execSync(
                `"${ffmpegPath}" -y -i "${videoPath}" -vf "fps=${fpsScan},crop=in_w:in_h*0.22:0:in_h*0.78,scale=iw*2:-2,format=gray" -q:v 1 "${tmpDir}\\frame_%05d.jpg"`,
                { timeout: 300000 }
            );
        } catch(e) {
            sendLog(`❌ FFmpeg lỗi: ${e.message?.slice(0, 100)}`, 'error');
            throw e;
        }

        const frameFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort();
        const totalF = frameFiles.length;
        if (totalF === 0) return { success: false, segments: [] };
        sendLog(`📷 ${totalF} frame — bắt đầu EasyOCR...`);

        // Tìm Python
        const python = findPython();
        if (!python) {
            cleanup();
            return { success: false, error: 'PYTHON_NOT_FOUND' };
        }

        // Đường dẫn script EasyOCR
        const scriptPath = path.join(__dirname, 'ocr_easyocr.py');
        if (!fs.existsSync(scriptPath)) {
            cleanup();
            return { success: false, error: 'OCR_SCRIPT_NOT_FOUND' };
        }

        sendLog(`🐍 Chạy EasyOCR (lần đầu tải model ~50MB, chờ chút)...`, 'info');

        // Chạy Python script, lắng nghe stderr để log tiến độ
        const ocrResult = await new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            const proc = require('child_process').spawn(python, [scriptPath, tmpDir, 'ch_sim,en'], {
                timeout: 600000,
            });
            proc.stdout.on('data', d => { stdout += d.toString(); });
            proc.stderr.on('data', d => {
                const line = d.toString().trim();
                if (line.startsWith('PROGRESS:')) {
                    sendLog(`📷 OCR: ${line.replace('PROGRESS:', '')}`, 'info');
                } else if (line) {
                    stderr += line + '\n';
                }
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    // Kiểm tra lỗi easyocr chưa cài
                    try {
                        const parsed = JSON.parse(stdout.trim());
                        if (parsed?.error === 'easyocr_not_installed') {
                            return resolve({ error: 'EASYOCR_NOT_INSTALLED' });
                        }
                    } catch(_) {}
                    return reject(new Error(`Python exit ${code}: ${stderr.slice(0, 300)}`));
                }
                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch(e) {
                    reject(new Error('JSON parse lỗi từ EasyOCR: ' + stdout.slice(0, 200)));
                }
            });
            proc.on('error', reject);
        });

        cleanup();

        if (ocrResult?.error === 'EASYOCR_NOT_INSTALLED') {
            return { success: false, error: 'EASYOCR_NOT_INSTALLED' };
        }

        // ocrResult là mảng [{file, text}, ...]
        if (!Array.isArray(ocrResult)) return { success: false, segments: [] };

        // Gán timestamp cho mỗi frame theo thứ tự
        const results = ocrResult.map((r, fi) => r.text || '');

        // Group frames liên tiếp cùng text → segments
        const segments = [];
        let curText = '', startFi = 0;
        for (let fi = 0; fi <= totalF; fi++) {
            const text = (results[fi] || '').trim();
            if (text !== curText) {
                if (curText) segments.push({
                    text: curText,
                    startMs: Math.round(startFi * interval * 1000),
                    endMs:   Math.round(fi * interval * 1000),
                });
                curText = text; startFi = fi;
            }
        }

        const nonEmpty = results.filter(t => t).length;
        sendLog(`🔎 ${nonEmpty}/${totalF} frame có text — ${segments.length} đoạn`, nonEmpty > 0 ? 'info' : 'warn');

        // Sanity check
        const maxReasonableSegs = Math.ceil(duration / 2);
        if (segments.length > maxReasonableSegs) {
            sendLog(`⚠️ ${segments.length} segment > ${maxReasonableSegs} (max hợp lý) — kết quả OCR là noise, bỏ qua`, 'warn');
            return { success: false, segments: [] };
        }

        if (segments.length > 0) {
            segments.slice(0, 3).forEach((s, i) => sendLog(`  [${i+1}] ${s.text.slice(0, 70)}`, 'info'));
        }
        return { success: true, segments };

    } catch(e) {
        cleanup();
        return { success: false, error: e.message };
    }
});

// ── GEMINI TRANSLATE SRT — Dịch từng segment, key rotation, đảm bảo không mất đoạn ──
ipcMain.handle('gemini:translate-srt', async (event, { segments, targetLang, targetLangCode, apiKeys }) => {
    const https = require('https');
    const keys = (apiKeys || []).map(k => (k||'').trim()).filter(Boolean);
    if (!keys.length) return { success: false, error: 'Chưa có Gemini API key' };

    const sendLog = (msg, type = 'info') => mainWindow?.webContents.send('review-film-log', { msg, type });
    const results = [];
    let keyIdx = Math.floor(Math.random() * keys.length);

    const callGemini = (key, text) => new Promise((resolve, reject) => {
        const prompt = `Translate the following subtitle line into ${targetLang} (language code: ${targetLangCode}).\nRules:\n- Output ONLY the translated text in ${targetLang}\n- Do NOT output Chinese, do NOT keep the original language\n- Do NOT add explanations, quotes, or any extra text\n- If the text is already in ${targetLang}, output it unchanged\n\nText to translate:\n${text}`;
        const body = Buffer.from(JSON.stringify({
            systemInstruction: { parts: [{ text: `You are a professional subtitle translator. You MUST translate ALL input into ${targetLang} (${targetLangCode}). Never output Chinese or the source language. Output only the translated subtitle text.` }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
        }), 'utf-8');
        const req = https.request({
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
        }, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (res.statusCode === 429) return resolve({ quota: true });
                    if (res.statusCode !== 200) return resolve({ err: `HTTP ${res.statusCode}` });
                    const out = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                    resolve({ text: out });
                } catch(e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); resolve({ err: 'timeout' }); });
        req.end(body);
    });

    sendLog(`🌐 Dịch ${segments.length} đoạn — key 1→câu 1, key 2→câu 2... (${keys.length} key song song)`);

    const resultArr = new Array(segments.length).fill(null);

    // Chia thành batch: mỗi batch = keys.length câu, gửi song song (key[i] → seg[batchStart+i])
    for (let batchStart = 0; batchStart < segments.length; batchStart += keys.length) {
        const batchSegs = segments.slice(batchStart, batchStart + keys.length);

        await Promise.all(batchSegs.map(async (seg, bi) => {
            const segIdx = batchStart + bi;
            const key = keys[bi % keys.length];
            let translated = null;
            let waitMs = 10000;

            // Thử tuần tự: mỗi key tối đa 3 lần, sau 3 lần fail → đổi sang key tiếp theo
            for (let ki = 0; ki < keys.length && !translated; ki++) {
                const curKey = keys[(bi + ki) % keys.length];
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const res = await callGemini(curKey, seg.text);
                        if (res.quota || res.err) {
                            if (attempt < 2) await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
                            continue;
                        }
                        if (res.text) { translated = res.text; break; }
                    } catch(_) {
                        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
                    }
                }
                if (!translated) sendLog(`  🔄 Câu ${segIdx+1}: key ${(bi+ki)%keys.length+1} fail 3 lần → đổi key tiếp`, 'warn');
            }

            resultArr[segIdx] = translated
                ? { ...seg, text: translated }
                : { ...seg, _failedTranslation: true };
        }));

        const done = Math.min(batchStart + keys.length, segments.length);
        sendLog(`  ✅ ${done}/${segments.length} câu xong`);
    }

    const failed = resultArr.filter(r => r._failedTranslation).length;
    if (failed > 0) sendLog(`⚠️ ${failed} câu vẫn thất bại sau tất cả retry — giữ text gốc`, 'warn');
    sendLog(`✅ Dịch xong: ${segments.length - failed}/${segments.length} câu sang ${targetLang}`, 'success');
    return { success: true, segments: resultArr };
});

// ── GEMINI TTS SRT — Song song theo số key, dãn cách batch để tránh rate limit ──
ipcMain.handle('gemini:tts-srt', async (event, { segments, voiceName, apiKey, apiKeys, outputPath, ttsModel }) => {
    try {
        const https = require('https');
        const SAMPLE_RATE    = 24000;
        const BPS            = 2;        // 16-bit PCM mono
        const MIN_KEY_DELAY  = 6500;     // ms tối thiểu giữa 2 lần dùng cùng 1 key (10 RPM = 6s/key)
        const SEG_TIMEOUT    = 40000;    // ms timeout 1 request TTS
        const MAX_RETRY      = 3;        // thử tối đa 3 lần/đoạn trước khi bỏ qua
        const MAX_CONCURRENT = 8;        // giới hạn tối đa 8 request song song dù có nhiều key hơn

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
                systemInstruction: {
                    parts: [{ text: 'You are a professional narrator. Speak in ONE consistent voice, tone, pace, and pitch throughout ALL text. Never alter your vocal style between sentences. Maintain identical voice characteristics as if recording one continuous narration session.' }]
                },
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
                    temperature: 0
                }
            }), 'utf-8');
            const req = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${ttsModel || 'gemini-2.5-flash-preview-tts'}:generateContent?key=${key}`,
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

        // ── Xử lý 1 segment, xoay key khi retry để tận dụng mọi key có sẵn ──
        // Trả về true nếu thành công, false nếu skip (BLOCKED/rỗng), null nếu thất bại
        const processSingleSegment = async (segIdx, startKeyIdx, maxRetry, logPrefix) => {
            const seg       = segments[segIdx];
            const cleanText = (seg.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            if (!cleanText) return false; // rỗng → skip

            for (let attempt = 0; attempt < maxRetry; attempt++) {
                // Xoay key theo attempt: lần 1 dùng startKey, lần 2 dùng key tiếp theo, v.v.
                const curKeyIdx = (startKeyIdx + attempt) % N;
                // Rate limit: chờ đủ MIN_KEY_DELAY kể từ lần dùng key này trước
                const wait = Math.max(0, keyLastUsed[curKeyIdx] + MIN_KEY_DELAY - Date.now());
                if (wait > 0) await sleepMs(wait);
                keyLastUsed[curKeyIdx] = Date.now();

                try {
                    pcmResults[segIdx] = await callGeminiTTS(cleanText, curKeyIdx);
                    return true; // thành công
                } catch (err) {
                    const msg = err.message || '';
                    if (msg === 'BLOCKED') {
                        sendProgress(doneCount, segments.length, `⚠️ ${logPrefix}${segIdx+1} bị chặn nội dung → bỏ qua`);
                        return false; // skip vĩnh viễn
                    }
                    if (msg === 'RATE_LIMIT') {
                        const backoff = Math.min(60000, 10000 * Math.pow(2, attempt));
                        keyLastUsed[curKeyIdx] = Date.now() + backoff;
                        sendProgress(doneCount, segments.length,
                            `⏳ key#${curKeyIdx+1} rate-limit (lần ${attempt+1}) → thử key#${(curKeyIdx+1)%N+1}...`);
                        // Không sleep dài — chuyển sang key tiếp theo ngay
                    } else if (msg === 'TIMEOUT') {
                        sendProgress(doneCount, segments.length,
                            `⏱️ ${logPrefix}${segIdx+1} timeout key#${curKeyIdx+1} → thử key#${(curKeyIdx+1)%N+1}`);
                        await sleepMs(1000);
                    } else {
                        sendProgress(doneCount, segments.length,
                            `🔄 ${logPrefix}${segIdx+1} key#${curKeyIdx+1} [${msg.slice(0,25)}] → thử key tiếp`);
                        await sleepMs(500);
                    }
                }
            }
            return null; // thất bại hết retry
        };

        // ── Parallel worker: mỗi key 1 worker, chạy song song ──────────────────
        // Shuffle keys trước — tránh nhiều session cùng dùng key #0 một lúc
        for (let i = keys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [keys[i], keys[j]] = [keys[j], keys[i]];
        }
        const N = keys.length;
        // Giới hạn số worker song song — quá nhiều key gửi cùng lúc vẫn bị Gemini chặn toàn bộ
        const WORKERS = Math.min(N, MAX_CONCURRENT);
        const pcmResults   = new Array(segments.length).fill(null);
        const keyLastUsed  = new Array(N).fill(0);

        const estMin = Math.ceil(Math.ceil(segments.length / WORKERS) * MIN_KEY_DELAY / 60000);
        sendProgress(0, segments.length,
            `🚀 ${segments.length} đoạn · ${WORKERS}/${N} key song song · ≈${estMin} phút`);
        sendLog(`🎤 Lồng tiếng ${voiceName}: ${segments.length} đoạn · ${WORKERS}/${N} key · ≈${estMin} phút`);

        const runWorker = async (workerIdx) => {
            const keyIdx = workerIdx % N;
            for (let i = workerIdx; i < segments.length; i += WORKERS) {
                const r = await processSingleSegment(i, keyIdx, Math.max(N * 2, MAX_RETRY), '');
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

        // Pass 1: WORKERS worker song song (giới hạn MAX_CONCURRENT)
        await Promise.all(Array.from({ length: WORKERS }, (_, k) => runWorker(k)));

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
                    const r = await processSingleSegment(segIdx, keyIdx, Math.max(N * 3, MAX_RETRY + 2), '[retry] ');
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
            let pcm = pcmResults[i];
            if (!pcm || pcm.length === 0) continue;

            // Vị trí byte chính xác theo startMs của SRT — không bao giờ drift
            const startByte = Math.floor(seg.startMs * SAMPLE_RATE / 1000) * BPS;
            const windowMs  = (seg.endMs || seg.startMs + 3000) - seg.startMs;
            const maxBytes  = Math.min(
                pcm.length,
                Math.floor(windowMs * SAMPLE_RATE / 1000) * BPS,
                totalBytes - startByte
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

        const successCount = pcmResults.filter(p => p !== null).length;
        if (successCount === 0) {
            return { success: false, error: `Toàn bộ ${segments.length} đoạn TTS thất bại — kiểm tra API key Gemini và quota` };
        }

        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outputPath, Buffer.concat([hdr, pcmBuffer]));

        return { success: true, path: outputPath, successCount, total: segments.length };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── TRỘN AUDIO: giảm tiếng gốc + chồng voice lồng tiếng ──────────────────────
ipcMain.handle('video:mixAudio', async (event, { videoPath, audioPath, outputPath, videoVol = 0.7, audioVol = 1.0, extraAudioPath, extraAudioVol = 1.0 }) => {
    try {
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        let args;
        if (extraAudioPath && fs.existsSync(extraAudioPath)) {
            // 3-track mix: video audio (mute/low) + TTS + nhạc nền (instrumental)
            args = [
                '-y', '-i', videoPath, '-i', audioPath, '-i', extraAudioPath,
                '-filter_complex',
                `[0:a]volume=${videoVol}[orig];[1:a]volume=${audioVol}[dub];[2:a]volume=${extraAudioVol}[music];[orig][dub][music]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=1[aout]`,
                '-map', '0:v:0', '-map', '[aout]',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                outputPath
            ];
        } else {
            args = [
                '-y', '-i', videoPath, '-i', audioPath,
                '-filter_complex',
                `[0:a]volume=${videoVol}[orig];[1:a]volume=${audioVol}[dub];[orig][dub]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:asc=1[aout]`,
                '-map', '0:v:0', '-map', '[aout]',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                outputPath
            ];
        }
        const result = await runFFmpeg(args);
        if (!result.ok || !fs.existsSync(outputPath)) return { success: false, error: result.stderr.slice(-400) };
        return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
});

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); const cryptoNode = require('crypto');
if (typeof global.crypto === 'undefined') global.crypto = cryptoNode.webcrypto || cryptoNode;
function createTTSInstance() { return new MsEdgeTTS(); }

// Split long text into chunks at natural boundaries to bypass Edge TTS service limits
function splitTextForTTS(text, maxChars = 3000) {
    if (text.length <= maxChars) return [text];
    const chunks = [];
    const paragraphs = text.split(/\n\n+/);
    let current = '';
    for (const para of paragraphs) {
        const sep = current ? '\n\n' : '';
        if (current.length + sep.length + para.length > maxChars) {
            if (current.trim()) { chunks.push(current.trim()); current = ''; }
            if (para.length > maxChars) {
                // Split oversized paragraph by sentence boundaries
                const sentences = para.split(/(?<=[.!?।。！？])\s+/);
                for (const sent of sentences) {
                    const sp = current ? ' ' : '';
                    if (current.length + sp.length + sent.length > maxChars) {
                        if (current.trim()) { chunks.push(current.trim()); current = ''; }
                    }
                    current += (current ? ' ' : '') + sent;
                }
            } else { current = para; }
        } else { current += sep + para; }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(c => c.trim());
}

// Generate TTS stream to file (self-contained, no external variable dependency)
/** Wrap plain text in SSML <prosody> nếu có pitch/rate khác 0 */
function buildEdgeInput(text, voice, pitch = 0, rate = 0) {
    if (pitch === 0 && rate === 0) return { input: text, isSsml: false };
    const lang = voice.split('-').slice(0, 2).join('-');
    const pitchStr = pitch > 0 ? `+${pitch}st` : pitch < 0 ? `${pitch}st` : '';
    const rateStr  = rate  > 0 ? `+${rate}%`  : rate  < 0 ? `${rate}%`  : '';
    const prosodyAttrs = [pitchStr ? `pitch="${pitchStr}"` : '', rateStr ? `rate="${rateStr}"` : ''].filter(Boolean).join(' ');
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody ${prosodyAttrs}>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</prosody></voice></speak>`;
    return { input: ssml, isSsml: true };
}

function edgeTTSChunk(text, voice, outputPath, pitch = 0, rate = 0) {
    return new Promise(async (resolve, reject) => {
        try {
            const { MsEdgeTTS: MET, OUTPUT_FORMAT: OF } = require('msedge-tts');
            const tts = new MET();
            await tts.setMetadata(voice, OF.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            const { input, isSsml } = buildEdgeInput(text, voice, pitch, rate);
            const { audioStream } = await tts.toStream(input, isSsml);
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const fileStream = fs.createWriteStream(outputPath);
            audioStream.on('data', chunk => fileStream.write(chunk));
            audioStream.on('close', () => { fileStream.end(); resolve(); });
            audioStream.on('error', err => { fileStream.destroy(); reject(err); });
        } catch (e) { reject(e); }
    });
}

ipcMain.handle('tts:get-voices', async () => { try { const tts = createTTSInstance(); const voices = await tts.getVoices(); if (voices && voices.length > 0) return voices; throw new Error("Empty list"); } catch (error) { return [ { ShortName: "vi-VN-HoaiMyNeural", Gender: "Female", Locale: "vi-VN" }, { ShortName: "vi-VN-NamMinhNeural", Gender: "Male", Locale: "vi-VN" } ]; } });

ipcMain.handle('tts:generate', async (event, { text, voice, outputPath, pitch = 0, rate = 0 }) => {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const vLog = (msg, type = 'info') => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice-log', { time: new Date().toLocaleTimeString(), text: msg, type }); } catch(_) {} };
        const chunks = splitTextForTTS(text, 3000);
        if (chunks.length === 1) {
            // Short text — direct single request
            return new Promise(async (resolve) => {
                try {
                    const tts = createTTSInstance();
                    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
                    const { input, isSsml } = buildEdgeInput(text, voice, pitch, rate);
                    const { audioStream } = await tts.toStream(input, isSsml);
                    const fileStream = fs.createWriteStream(outputPath);
                    audioStream.on('data', (chunk) => fileStream.write(chunk));
                    audioStream.on('close', () => { fileStream.end(); resolve({ success: true, path: outputPath }); });
                    audioStream.on('error', (err) => { fileStream.end(); resolve({ success: false, error: err.message }); });
                } catch (streamErr) { resolve({ success: false, error: streamErr.message }); }
            });
        }
        // Long text — split into chunks, generate each, then concat
        vLog(`🎙️ [Edge TTS] Văn bản dài (${text.length} ký tự) → chia thành ${chunks.length} đoạn`, 'info');
        const tmpDir = require('path').join(require('os').tmpdir(), `edge_tts_${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const chunkPaths = [];
        try {
            for (let i = 0; i < chunks.length; i++) {
                const chunkPath = require('path').join(tmpDir, `chunk_${i}.mp3`);
                vLog(`🎙️ [Edge TTS] Xử lý đoạn ${i + 1}/${chunks.length} (${chunks[i].length} ký tự)...`, 'info');
                await edgeTTSChunk(chunks[i], voice, chunkPath, pitch, rate);
                chunkPaths.push(chunkPath);
            }
            // Concatenate all chunks with ffmpeg
            const ffmpegBin = require('ffmpeg-static');
            const { spawnSync: spawnS } = require('child_process');
            if (chunkPaths.length === 1) {
                fs.copyFileSync(chunkPaths[0], outputPath);
            } else {
                const listFile = require('path').join(tmpDir, 'concat.txt');
                fs.writeFileSync(listFile, chunkPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
                const res = spawnS(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath]);
                if (res.status !== 0) throw new Error((res.stderr || res.stdout || Buffer.alloc(0)).toString().slice(-300) || 'ffmpeg concat thất bại');
            }
            vLog(`✅ [Edge TTS] Ghép ${chunks.length} đoạn hoàn tất → ${outputPath}`, 'success');
            return { success: true, path: outputPath };
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    } catch (err) { return { success: false, error: err.message }; }
});
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

// IPC: điều chỉnh tốc độ audio bằng atempo (dùng cho Review Phim sync)
ipcMain.handle('audio:adjust-tempo', async (_e, { inputPath, outputPath, ratio }) => {
    try {
        const dir = require('path').dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        await adjustTTSSpeed(inputPath, outputPath, ratio);
        return { success: true, path: outputPath };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── TÁCH GIỌNG / NHẠC NỀN bằng FFmpeg ────────────────────────────────────────
ipcMain.handle('audio:separate', async (_e, { inputPath, outputFolder, mode }) => {
    // mode: 'music' = giữ nhạc, bỏ giọng | 'vocals' = giữ giọng, bỏ nhạc
    const ffmpegPath = require('./services/ffmpeg-path').getFFmpegPath?.() || 'ffmpeg';
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);

    fs.mkdirSync(outputFolder, { recursive: true });

    const outputPath = path.join(outputFolder, `${base}_${mode === 'music' ? 'nhac_nen' : 'giong_noi'}.mp3`);

    // FFmpeg stereo vocal removal:
    // Giọng thường nằm ở center channel (giống nhau ở L và R)
    // Trừ 2 kênh → lấy phần side (nhạc nền)
    // Cộng 2 kênh → lấy phần center (giọng)
    const filter = mode === 'music'
        ? 'pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c1-0.5*c0'  // nhạc nền (side)
        : 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1';  // giọng (center)

    const args = [
        '-y', '-i', inputPath,
        '-af', filter,
        '-b:a', '192k',
        outputPath,
    ];

    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args, { windowsHide: true });
        let errOut = '';
        proc.stderr.on('data', d => { errOut += d.toString(); });
        proc.on('close', code => {
            if (code === 0) resolve({ success: true, outputPath });
            else resolve({ success: false, error: errOut.split('\n').filter(l => l.includes('Error') || l.includes('Invalid')).join(' ') || `exit ${code}` });
        });
        proc.on('error', e => resolve({ success: false, error: e.message }));
    });
});

// Generate TTS audio stream to file (Edge TTS) — có timeout 30s + retry 2 lần
const edgeTTSToFile = async (text, voice, outputPath, timeoutMs = 30000, isSsml = false) => {
    const attempt = () => new Promise(async (res, rej) => {
        try {
            const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
            const tts = new MsEdgeTTS();
            await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
            const { audioStream } = await tts.toStream(text, isSsml);
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const fileStream = fs.createWriteStream(outputPath);
            const timer = setTimeout(() => {
                fileStream.destroy();
                rej(new Error(`Edge TTS timeout ${timeoutMs / 1000}s`));
            }, timeoutMs);
            audioStream.on('data', chunk => fileStream.write(chunk));
            audioStream.on('close', () => { clearTimeout(timer); fileStream.end(); res(); });
            audioStream.on('error', err => { clearTimeout(timer); fileStream.destroy(); rej(err); });
        } catch (e) { rej(e); }
    });

    try { await attempt(); return; } catch (_) {}
    await new Promise(r => setTimeout(r, 2000));
    await attempt(); // lần 2 — nếu vẫn lỗi thì throw
};

// Run ffmpeg with filter_complex via script file (avoids Windows 8191-char cmd limit)
const ffmpegFilterScript = (inputArgs, filterComplex, outputArgs, scriptPath) => new Promise((resolve, reject) => {
    fs.writeFileSync(scriptPath, filterComplex, 'utf8');
    const args = ['-y', ...inputArgs, '-filter_complex_script', scriptPath, ...outputArgs];
    const proc = spawn(ffmpegPath, args);
    proc.on('close', code => {
        try { fs.unlinkSync(scriptPath); } catch (_) {}
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`));
    });
    proc.on('error', err => { try { fs.unlinkSync(scriptPath); } catch (_) {} reject(err); });
});

// Merge timed audio segments using FFmpeg adelay+amix in batches of BATCH_SIZE
// to avoid holding hundreds of streams in RAM simultaneously.
const mergeTimedAudioSegments = async (segments, outputPath) => {
    const BATCH_SIZE = 30;
    if (segments.length === 0) throw new Error('No segments');

    const runBatch = async (segs, dest) => {
        if (segs.length === 1) {
            const d = Math.round(segs[0].startMs);
            if (d === 0) { fs.copyFileSync(segs[0].path, dest); return; }
            await new Promise((res, rej) => {
                const p = spawn(ffmpegPath, ['-y', '-i', segs[0].path, '-filter:a', `adelay=${d}|${d}`, '-c:a', 'libmp3lame', '-q:a', '4', dest]);
                p.on('close', c => c === 0 ? res() : rej(new Error(`adelay exit ${c}`))); p.on('error', rej);
            });
            return;
        }
        const inputArgs = segs.flatMap(s => ['-i', s.path]);
        const filterParts = segs.map((s, i) => `[${i}]adelay=${Math.round(s.startMs)}|${Math.round(s.startMs)}[a${i}]`);
        const mixInputs = segs.map((_, i) => `[a${i}]`).join('');
        const fc = `${filterParts.join(';')};${mixInputs}amix=inputs=${segs.length}:duration=longest:normalize=0`;
        await ffmpegFilterScript(inputArgs, fc, ['-c:a', 'libmp3lame', '-q:a', '4', dest], dest + '.fscript.txt');
    };

    if (segments.length <= BATCH_SIZE) {
        await runBatch(segments, outputPath);
        return;
    }

    // Split into batches, merge each batch to intermediate, then merge intermediates
    const tmpDir = path.dirname(outputPath);
    const batches = [];
    for (let i = 0; i < segments.length; i += BATCH_SIZE) batches.push(segments.slice(i, i + BATCH_SIZE));

    const intermediatePaths = [];
    try {
        for (let b = 0; b < batches.length; b++) {
            const dest = path.join(tmpDir, `_batch_${b}_${Date.now()}.mp3`);
            await runBatch(batches[b], dest);
            intermediatePaths.push({ path: dest, startMs: 0 }); // timing already baked in
        }
        // Final merge of intermediates (no delay needed — timing already embedded)
        if (intermediatePaths.length === 1) {
            fs.copyFileSync(intermediatePaths[0].path, outputPath);
        } else {
            const inputArgs = intermediatePaths.flatMap(s => ['-i', s.path]);
            const mixInputs = intermediatePaths.map((_, i) => `[${i}]`).join('');
            const fc = `${mixInputs}amix=inputs=${intermediatePaths.length}:duration=longest:normalize=0`;
            await ffmpegFilterScript(inputArgs, fc, ['-c:a', 'libmp3lame', '-q:a', '4', outputPath], outputPath + '.fscript2.txt');
        }
    } finally {
        for (const p of intermediatePaths) { try { fs.unlinkSync(p.path); } catch (_) {} }
    }
};

// IPC: Edge TTS with SRT segment timing + auto speed adjustment
ipcMain.handle('tts:generate-srt', async (event, { segments, voice, outputPath, pitch = 0, rate = 0 }) => {
    const tempDir = path.join(app.getPath('temp'), `grok_tts_srt_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const vLog = (text, type = 'info') => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice-log', { time: new Date().toLocaleTimeString(), text, type }); };
    const sendProg = (done, total, text) => { if (mainWindow) mainWindow.webContents.send('tts-srt-progress', { done, total, text }); };
    vLog(`🎙️ [Edge TTS] Bắt đầu SRT — ${segments.length} đoạn · giọng: ${voice.split('-').pop()}${pitch !== 0 ? ` · tone${pitch > 0 ? '+' : ''}${pitch}st` : ''}`, 'info');
    try {
        const timedSegs = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            sendProg(i, segments.length, `Đoạn ${i + 1}/${segments.length}: "${seg.text.substring(0, 30)}..."`);
            vLog(`  ▶ [${i + 1}/${segments.length}] "${seg.text.substring(0, 50)}${seg.text.length > 50 ? '...' : ''}"`, 'info');
            const rawPath = path.join(tempDir, `seg_${i}_raw.mp3`);
            const finalPath = path.join(tempDir, `seg_${i}_final.mp3`);
            let segOk = false;
            try {
                const { input, isSsml } = buildEdgeInput(seg.text, voice, pitch, rate);
                await edgeTTSToFile(input, voice, rawPath, 20000, isSsml);
                segOk = true;
            } catch (segErr) {
                vLog(`  ⚠️ Đoạn ${i + 1} lỗi (${segErr.message.slice(0, 50)}) — bỏ qua, tiếp tục`, 'warn');
            }
            if (i < segments.length - 1) await new Promise(r => setTimeout(r, 300));
            if (!segOk) continue; // bỏ qua đoạn lỗi, dùng khoảng lặng
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
ipcMain.handle('veo:check-cookie', async (event, cookieStr) => { try { return await VeoEngine.checkCookie(cookieStr); } catch (error) { return { success: false, error: error.message }; } })
ipcMain.handle('veo:pause',  () => { VeoEngine.pause();  return { ok: true }; });
ipcMain.handle('veo:resume', () => { VeoEngine.resume(); return { ok: true }; });;

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

// ── Stock Video (Pexels / Pixabay) ───────────────────────────────────────────
ipcMain.handle('stock-video:search',   async (e, params) => searchStockVideo(params));
ipcMain.handle('stock-video:download', async (e, params) => downloadStockClip(params));

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

// ── Trim / Loop clip to exact duration ───────────────────────────────────────
// Dùng cho Stock Video flow: trim/loop + scale chuẩn hóa resolution trong 1 pass
// targetW, targetH: nếu truyền vào → scale+pad về đúng kích thước (16:9 standard)
ipcMain.handle('video:trim-loop', async (event, { inputPath, duration, outputPath, targetW, targetH, startTime }) => {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Dùng float chính xác (toFixed 3) — KHÔNG Math.round để tránh drift tích lũy 400+ chunk
        const dur = Math.max(0.5, Number(duration));
        const durStr = dur.toFixed(3); // VD: "10.337" thay vì "10"
        const ssArgs = (startTime != null && Number(startTime) > 0) ? ['-ss', String(Number(startTime).toFixed(3))] : [];

        // Nếu có target resolution → scale+pad để chuẩn hóa (tất cả clip cùng kích thước → concat copy nhanh)
        // Dùng letterbox pad để giữ tỷ lệ gốc, điền đen nếu cần
        const vf = (targetW && targetH)
            ? `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
              `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,` +
              `setsar=1,fps=30,format=yuv420p`
            : `fps=30,format=yuv420p`;

        const args = [
            '-y',
            ...ssArgs,
            '-i', inputPath,
            '-t', durStr,
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-ar', '44100', '-b:a', '128k', '-ac', '2',
            '-movflags', '+faststart',
            outputPath,
        ];
        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);
            let errOut = '';
            proc.stderr.on('data', d => { errOut += d.toString(); });
            proc.on('close', code => {
                if (code === 0) resolve({ success: true, filePath: outputPath });
                else resolve({ success: false, error: `FFmpeg code ${code}: ${errOut.slice(-300)}` });
            });
            proc.on('error', err => resolve({ success: false, error: err.message }));
        });
    } catch (e) { return { success: false, error: e.message }; }
});

// ── CẮT CLIP RE-ENCODE CRF 18 (cho Review Phim) ─────────────────────────────
// crf 18 ≈ visually lossless, thay đổi fingerprint so với bản gốc
ipcMain.handle('video:cut-lossless', async (_e, { inputPath, startTime, duration, outputPath }) => {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ss   = Number(startTime || 0).toFixed(3);
        const durS = Number(duration  || 10).toFixed(3);
        const args = [
            '-y', '-ss', ss, '-i', inputPath, '-t', durS,
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
            '-movflags', '+faststart',
            outputPath,
        ];
        const r = await runFFmpeg(args);
        if (r.ok && fs.existsSync(outputPath)) return { success: true, path: outputPath };
        return { success: false, error: r.stderr?.slice(-300) };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── MIX AUDIO TTS VÀO VIDEO CLIP (cho Review Phim) ──────────────────────────
ipcMain.handle('video:mix-audio', async (event, { videoPath, audioPath, outputPath }) => {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Lấy duration của TTS audio để giới hạn video
        const args = [
            '-y',
            '-i', videoPath,
            '-i', audioPath,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', '128k',
            '-shortest',   // kết thúc khi audio hết
            '-movflags', '+faststart',
            outputPath,
        ];
        return await new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);
            let err = '';
            proc.stderr.on('data', d => err += d.toString());
            proc.on('close', code => {
                if (code === 0 && fs.existsSync(outputPath)) resolve({ success: true, path: outputPath });
                else resolve({ success: false, error: err.slice(-300) });
            });
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
    // Lưu SRT vào thư mục output (tránh temp path có space/ký tự đặc biệt trên Windows)
    const outDir = outputFolder || path.dirname(videoPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const ts = Date.now();
    const srtTmp = path.join(outDir, `_tmp_sub_${ts}.srt`);
    const assTmp = path.join(outDir, `_tmp_sub_${ts}.ass`);

    const cleanup = () => {
        try { if (fs.existsSync(srtTmp)) fs.unlinkSync(srtTmp); } catch (_) {}
        try { if (fs.existsSync(assTmp)) fs.unlinkSync(assTmp); } catch (_) {}
    };

    try {
        // Ghi SRT với UTF-8 BOM để đảm bảo encoding đúng (tiếng Việt, ký tự đặc biệt)
        fs.writeFileSync(srtTmp, '﻿' + srtContent, 'utf8');

        const baseName = path.basename(videoPath, path.extname(videoPath));
        const outPath  = customOutputPath || path.join(outDir, `${baseName}_phu_de.mp4`);

        const fontSize   = style?.fontSize  || 24;
        const colorHex   = SUB_COLOR_MAP[style?.color] || '00FFFFFF';
        const effectStr  = SUB_EFFECT_MAP[style?.effect] || SUB_EFFECT_MAP['outline'];
        const alignment  = style?.position === 'top' ? 8 : 2;
        const forceStyle = `FontSize=${fontSize},PrimaryColour=&H${colorHex},Alignment=${alignment},MarginV=20,${effectStr}`;

        sendVideoLog(`🔥 Đang ép phụ đề → ${path.basename(outPath)}...`);

        // Helper: escape path cho FFmpeg filter (Windows)
        const escapeFfPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

        let result;

        // ── Phương án 1: SRT → ASS rồi dùng ass filter (ổn định nhất trên Windows) ──
        const convResult = await runFFmpeg(['-y', '-i', srtTmp, assTmp]);
        if (convResult.ok && fs.existsSync(assTmp)) {
            sendVideoLog('  📝 Dùng ASS filter (phương án ưu tiên)...');
            const assEsc = escapeFfPath(assTmp);
            result = await runFFmpeg([
                '-y', '-i', videoPath,
                '-vf', `ass='${assEsc}':force_style='${forceStyle}'`,
                '-c:a', 'copy', '-preset', 'fast', outPath
            ]);
        }

        // ── Phương án 2: subtitles filter + charenc UTF-8 (fallback) ──
        if (!result || !result.ok) {
            sendVideoLog('  📝 Thử subtitles filter (UTF-8)...');
            const srtEsc = escapeFfPath(srtTmp);
            result = await runFFmpeg([
                '-y', '-i', videoPath,
                '-vf', `subtitles='${srtEsc}':charenc=UTF-8:force_style='${forceStyle}'`,
                '-c:a', 'copy', '-preset', 'fast', outPath
            ]);
        }

        // ── Phương án 3: subtitles không charenc (last resort) ──
        if (!result || !result.ok) {
            sendVideoLog('  📝 Thử subtitles filter (last resort)...');
            const srtEsc = escapeFfPath(srtTmp);
            result = await runFFmpeg([
                '-y', '-i', videoPath,
                '-vf', `subtitles='${srtEsc}'`,
                '-c:a', 'copy', '-preset', 'fast', outPath
            ]);
        }

        cleanup();

        if (!result.ok) {
            sendVideoLog(`❌ Lỗi ép phụ đề: ${result.stderr.slice(-300)}`, 'error');
            return { success: false, error: result.stderr.slice(-500) };
        }

        // Kiểm tra file output có kích thước hợp lệ
        const outSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
        if (outSize < 10000) {
            sendVideoLog('❌ File output quá nhỏ — có thể ép phụ đề thất bại', 'error');
            return { success: false, error: 'File output không hợp lệ (quá nhỏ)' };
        }

        sendVideoLog(`✅ Ép phụ đề xong: ${path.basename(outPath)}`, 'success');
        return { success: true, path: outPath };
    } catch (e) {
        cleanup();
        return { success: false, error: e.message };
    }
});

// ── GHÉP TẤT CẢ CLIP STOCK + CHÈN AUDIO GỐC, ĐẢM BẢO DURATION KHỚP ──────────
// Flow: probe audio duration → concat clips (-c copy) → sync duration → mux audio
// Đảm bảo video output = audio duration chính xác (không thừa, không thiếu)
ipcMain.handle('video:concat-audio', async (event, { clips, audioPath, outputFolder, outputName }) => {
    const outDir   = outputFolder || path.dirname(clips[0] || '.');
    const tmpDir   = path.join(outDir, '_concat_tmp');
    const listFile = path.join(tmpDir, 'concat.txt');
    const vidOnly  = path.join(tmpDir, 'video_only.mp4');
    const vidSynced = path.join(tmpDir, 'video_synced.mp4');
    const finalOut = path.join(outDir, (outputName || `final_${Date.now()}`) + '.mp4');

    // Helper: probe duration bằng ffprobe
    const probeDuration = (filePath) => new Promise((resolve) => {
        const proc = spawn(ffprobePath, [
            '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', filePath
        ]);
        let out = '';
        proc.stdout.on('data', d => out += d);
        proc.on('close', () => resolve(parseFloat(out.trim()) || 0));
        proc.on('error', () => resolve(0));
    });

    try {
        if (!clips || clips.length === 0) return { success: false, error: 'Không có clip nào' };
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        // ── Bước 0: Probe audio duration (chuẩn đích) ─────────────────────
        const audioDur = await probeDuration(audioPath);
        sendVideoLog(`[FFmpeg] Audio gốc: ${audioDur.toFixed(3)}s — ghép ${clips.length} clip...`);

        // ── Bước 1: Ghi concat list ────────────────────────────────────────
        const lines = clips.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
        fs.writeFileSync(listFile, lines, 'utf8');

        // ── Bước 2: Concat demuxer (-c copy, không re-encode) ──────────────
        sendVideoLog(`[FFmpeg] Concat ${clips.length} clip (copy mode)...`);
        const concatResult = await runFFmpeg([
            '-y', '-f', 'concat', '-safe', '0',
            '-i', listFile,
            '-c', 'copy',
            vidOnly,
        ]);
        if (!concatResult.ok) {
            sendVideoLog(`❌ Concat lỗi: ${concatResult.stderr.slice(-300)}`, 'error');
            return { success: false, error: `Concat thất bại: ${concatResult.stderr.slice(-400)}` };
        }

        const videoDur = await probeDuration(vidOnly);
        const diff = videoDur - audioDur;
        sendVideoLog(`[FFmpeg] Video concat: ${videoDur.toFixed(3)}s | Audio: ${audioDur.toFixed(3)}s | Diff: ${diff > 0 ? '+' : ''}${diff.toFixed(3)}s`);

        // ── Bước 3: Đồng bộ duration video → audio ────────────────────────
        let syncedVidPath = vidOnly;

        if (audioDur > 0 && Math.abs(diff) > 0.1) { // chỉ xử lý nếu lệch > 0.1s
            if (diff > 0.1) {
                // Video DÀI hơn audio → trim video về đúng audio duration
                sendVideoLog(`[FFmpeg] Video dài hơn ${diff.toFixed(2)}s → trim về ${audioDur.toFixed(3)}s...`);
                const trimRes = await runFFmpeg([
                    '-y', '-i', vidOnly,
                    '-t', audioDur.toFixed(3),
                    '-c', 'copy',
                    vidSynced,
                ]);
                if (trimRes.ok) syncedVidPath = vidSynced;
                else sendVideoLog(`⚠️ Trim duration lỗi — dùng video gốc`);

            } else if (diff < -0.1) {
                // Video NGẮN hơn audio → loop clip cuối để kéo dài
                const shortage = (-diff).toFixed(3);
                sendVideoLog(`[FFmpeg] Video ngắn hơn ${(-diff).toFixed(2)}s → loop clip cuối để bù...`);
                // Thêm duration tổng vào concat list cuối cùng bằng cách loop vidOnly
                const extendRes = await runFFmpeg([
                    '-y',
                    '-stream_loop', '-1',   // loop file vô hạn
                    '-i', vidOnly,
                    '-t', audioDur.toFixed(3), // cắt đúng audio duration
                    '-c', 'copy',
                    vidSynced,
                ]);
                if (extendRes.ok) syncedVidPath = vidSynced;
                else sendVideoLog(`⚠️ Extend duration lỗi — dùng video gốc`);
            }
        } else {
            sendVideoLog(`✅ Duration khớp (lệch < 0.1s), không cần sync`);
        }

        // ── Bước 4: Mux audio gốc vào video đã sync ──────────────────────
        // -c:v copy    → không re-encode video
        // -c:a aac     → encode audio gốc → aac
        // -t audioDur  → đảm bảo output = đúng audio duration (phòng trường hợp còn lệch nhỏ)
        sendVideoLog(`[FFmpeg] Mux audio gốc → ${path.basename(finalOut)}...`);
        const muxArgs = [
            '-y',
            '-i', syncedVidPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
            '-map', '0:v:0',
            '-map', '1:a:0',
        ];
        if (audioDur > 0) muxArgs.push('-t', audioDur.toFixed(3)); // hard cap theo audio
        muxArgs.push('-movflags', '+faststart', finalOut);

        const muxResult = await runFFmpeg(muxArgs);
        if (!muxResult.ok) {
            sendVideoLog(`❌ Mux audio lỗi: ${muxResult.stderr.slice(-300)}`, 'error');
            return { success: false, error: `Mux audio thất bại: ${muxResult.stderr.slice(-400)}` };
        }

        // Verify output duration
        const outDur = await probeDuration(finalOut);
        const sizeMB = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
        sendVideoLog(`✅ Hoàn tất! ${path.basename(finalOut)} — ${outDur.toFixed(2)}s / ${audioDur.toFixed(2)}s (${sizeMB} MB)`, 'success');
        return { success: true, path: finalOut, videoDur: outDur, audioDur };
    } catch (e) {
        sendVideoLog(`❌ concat-audio lỗi: ${e.message}`, 'error');
        return { success: false, error: e.message };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
});

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

// Helper: áp dụng atempo lên PCM buffer (16-bit signed LE, 24kHz mono)
// ratio > 1.0 = tăng tốc; không bao giờ chậm hơn 1x
async function applyAtempoToPCM(pcmBuf, ratio) {
    if (ratio <= 1.0) return pcmBuf; // không chậm
    const os = require('os');
    const id = `${Date.now()}_${Math.floor(Math.random()*9999)}`;
    const inWav  = path.join(os.tmpdir(), `tts_atempo_in_${id}.wav`);
    const outRaw = path.join(os.tmpdir(), `tts_atempo_out_${id}.raw`);
    try {
        // Ghi WAV header + raw PCM
        const SR = 24000, CH = 1, BITS = 16;
        const hdr = Buffer.alloc(44);
        hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcmBuf.length, 4);
        hdr.write('WAVE', 8); hdr.write('fmt ', 12);
        hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
        hdr.writeUInt16LE(CH, 22); hdr.writeUInt32LE(SR, 24);
        hdr.writeUInt32LE(SR * CH * (BITS / 8), 28); hdr.writeUInt16LE(CH * (BITS / 8), 32);
        hdr.writeUInt16LE(BITS, 34); hdr.write('data', 36);
        hdr.writeUInt32LE(pcmBuf.length, 40);
        fs.writeFileSync(inWav, Buffer.concat([hdr, pcmBuf]));

        // Build atempo chain (mỗi filter max 2.0)
        const filters = [];
        let rem = ratio;
        while (rem > 2.0) { filters.push('atempo=2.0'); rem /= 2.0; }
        filters.push(`atempo=${rem.toFixed(4)}`);

        const r = await runFFmpeg([
            '-y', '-i', inWav,
            '-af', filters.join(','),
            '-ar', String(SR), '-ac', String(CH), '-f', 's16le', outRaw
        ]);
        if (!r.ok || !fs.existsSync(outRaw)) return pcmBuf;
        return fs.readFileSync(outRaw);
    } catch (_) { return pcmBuf; }
    finally {
        try { fs.unlinkSync(inWav);  } catch (_) {}
        try { fs.unlinkSync(outRaw); } catch (_) {}
    }
}

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
            fs.writeFileSync(listFile, files.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n'), 'utf8');
            return new Promise((resolve) => {
                const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath];
                const proc = spawn(ffmpegPath, args);
                let stderrBuf = '';
                proc.stderr.on('data', d => {
                    stderrBuf += d.toString();
                    const t = d.toString().match(/time=[\d:.]+/)?.[0];
                    if (t) sendVideoLog(`Render: ${t}`);
                });
                proc.on('close', (code) => {
                    try { fs.unlinkSync(listFile); } catch (_) {}
                    if (code === 0) { sendVideoLog('✅ Ghép xong!', 'success'); resolve({ success: true, path: outputPath }); }
                    else {
                        const lastLine = stderrBuf.split('\n').reverse().find(l => l.trim()) || '';
                        const errMsg = `FFmpeg lỗi (code ${code}): ${lastLine.slice(0, 300)}`;
                        sendVideoLog(`❌ ${errMsg}`, 'error');
                        resolve({ success: false, error: errMsg });
                    }
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

// Lấy 1 frame tại thời điểm cụ thể (dùng cho preview sub zone)
ipcMain.handle('video:extract-frame', async (event, { inputPath, timeOffset = 30 }) => {
    try {
        const outPath = path.join(require('os').tmpdir(), `frame_preview_${Date.now()}.jpg`);
        const { execSync } = require('child_process');
        execSync(`"${ffmpegPath}" -y -ss ${timeOffset} -i "${inputPath}" -vframes 1 -q:v 2 "${outPath}"`, { timeout: 15000 });
        if (!fs.existsSync(outPath)) throw new Error('Không lấy được frame');
        const b64 = fs.readFileSync(outPath).toString('base64');
        try { fs.unlinkSync(outPath); } catch (_) {}
        return { ok: true, base64: b64 };
    } catch (e) {
        return { ok: false, error: e.message };
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
// ── Tự động phát hiện và xóa logo/watermark từ thư mục ảnh ─────────────────
ipcMain.handle('watermark:auto-remove', async (event, { folder }) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'watermark_auto.py');
        const python = spawn('python', [scriptPath, folder]);
        let settled = false;
        const done = (val) => { if (!settled) { settled = true; resolve(val); } };

        python.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
                if (line.startsWith('REGIONS:')) {
                    try {
                        const regions = JSON.parse(line.slice(8));
                        event.sender.send('watermark-log', { type: 'regions', regions });
                    } catch (_) {}
                } else if (line.startsWith('TOTAL:')) {
                    const total = parseInt(line.slice(6));
                    event.sender.send('watermark-log', { type: 'total', total });
                } else if (line.startsWith('PROGRESS:')) {
                    const [d, t] = line.slice(9).split('/');
                    event.sender.send('watermark-log', { type: 'progress', done: parseInt(d), total: parseInt(t) });
                } else if (line.startsWith('INFO:')) {
                    event.sender.send('watermark-log', { type: 'info', text: line.slice(5) });
                } else if (line.startsWith('ERROR:')) {
                    event.sender.send('watermark-log', { type: 'error', text: line.slice(6) });
                } else if (line.startsWith('DONE:')) {
                    try {
                        const result = JSON.parse(line.slice(5));
                        done({ success: true, ...result });
                    } catch (_) { done({ success: true }); }
                }
            }
        });

        python.stderr.on('data', (data) => {
            const txt = data.toString().trim();
            if (txt) event.sender.send('watermark-log', { type: 'error', text: txt.slice(0, 200) });
        });

        python.on('error', (err) => {
            done({ success: false, error: `Python not found: ${err.message}` });
        });

        python.on('close', (code) => {
            if (code !== 0) done({ success: false, error: `Exit code ${code}` });
            else done({ success: true });
        });
    });
});

// ── Cắt xén cạnh ảnh để loại bỏ logo thay vì fill màu ───────────────────────
ipcMain.handle('watermark:auto-crop', async (event, { folder }) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'watermark_auto.py');
        const python = spawn('python', [scriptPath, folder, '--crop']);
        let settled = false;
        const done = (val) => { if (!settled) { settled = true; resolve(val); } };

        python.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
                if (line.startsWith('REGIONS:')) {
                    try {
                        const regions = JSON.parse(line.slice(8));
                        event.sender.send('watermark-log', { type: 'regions', regions });
                    } catch (_) {}
                } else if (line.startsWith('TOTAL:')) {
                    const total = parseInt(line.slice(6));
                    event.sender.send('watermark-log', { type: 'total', total });
                } else if (line.startsWith('PROGRESS:')) {
                    const [d, t] = line.slice(9).split('/');
                    event.sender.send('watermark-log', { type: 'progress', done: parseInt(d), total: parseInt(t) });
                } else if (line.startsWith('INFO:')) {
                    event.sender.send('watermark-log', { type: 'info', text: line.slice(5) });
                } else if (line.startsWith('ERROR:')) {
                    event.sender.send('watermark-log', { type: 'error', text: line.slice(6) });
                } else if (line.startsWith('DONE:')) {
                    try {
                        const result = JSON.parse(line.slice(5));
                        done({ success: true, ...result });
                    } catch (_) { done({ success: true }); }
                }
            }
        });

        python.stderr.on('data', (data) => {
            const txt = data.toString().trim();
            if (txt) event.sender.send('watermark-log', { type: 'error', text: txt.slice(0, 200) });
        });

        python.on('error', (err) => { done({ success: false, error: `Python not found: ${err.message}` }); });
        python.on('close', (code) => {
            if (code !== 0) done({ success: false, error: `Exit code ${code}` });
            else done({ success: true });
        });
    });
});

// ── Chỉ phát hiện vùng logo, không sửa ảnh ───────────────────────────────────
ipcMain.handle('watermark:detect-only', async (event, { folder }) => {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, 'watermark_auto.py');
        const python = spawn('python', [scriptPath, folder, '--detect-only']);
        let output = '';
        python.stdout.on('data', (d) => { output += d.toString(); });
        python.on('error', (err) => resolve({ success: false, error: err.message, regions: [] }));
        python.on('close', () => {
            const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
            let regions = [];
            let imgSize = null;
            for (const line of lines) {
                if (line.startsWith('REGIONS:')) {
                    try { regions = JSON.parse(line.slice(8)); } catch (_) {}
                } else if (line.startsWith('IMG_SIZE:')) {
                    imgSize = line.slice(9);
                }
            }
            resolve({ success: true, regions, imgSize });
        });
    });
});

// ── Tái tạo video: xóa logo + cắt đoạn + ghép + lọc 4K ─────────────────────
ipcMain.handle('video:recreate', async (event, { videoPath, outputFolder, zoomPct = 5, apply4K = true, channelName = '', wmOpacity = 20, wmCycle = 60, varSpeed = false, varSpeedLevel = 'medium', pitchShift = 0, stereoFlip = false, bgNoise = false, bgNoiseLevel = 3, bgNoiseFile = '', bgNoiseColor = 'pink', audioVolume = 100, kenBurns = 'none', randomCut = true, hFlip = false, grainNoise = false, grainLevel = 5, randomMeta = true, gpuMode = 'auto', colorShift = false, colorShiftLevel = 'medium', randomPosCrop = false, randomFps = false, slightRotate = false, hueRotate = false, audioEQ = false, subRemove = false, subHeight = 10, subWidth = 100, subHOffset = 0, subPosition = 'bottom', subStyle = 'blur', vignette = false, videoPad = false, audioCompress = false, audioReverb = false, audioChorus = false, brightnessJitter = false, colorChannelShift = false, temporalBlend = false, perspectiveWarp = false, audioDither = false, rvcEnabled = false, rvcModelPath = '', rvcIndexPath = '', rvcPitch = 0, rvcF0Method = 'pm', targetDurEnabled = false, targetDurMinutes = 0, outputResolution = 'source', trimStart = 0, trimEnd = 0, preDetectedLogoRegions = null, preDetectedImgW = null, preDetectedImgH = null, outputFileName = '' }) => {
    const sendLog = (msg, type = 'info', stepNum) => {
        mainWindow?.webContents.send('video-recreate-log', { msg, type, ...(stepNum !== undefined && { stepNum }) });
    };

    const runFFmpeg = (args) => new Promise((resolve, reject) => {
        const p = spawn(ffmpegPath, args, { windowsHide: true });
        let stderr = '';
        p.stderr?.on('data', d => { stderr += d.toString(); });
        p.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-200)}`)));
        p.on('error', reject);
    });

    try {
        // ── Bước 0: Get video info ─────────────────────────────────────────────
        sendLog('📊 Đang phân tích video...', 'info', 0);
        const probeInfo = await new Promise((resolve, reject) => {
            const p = spawn(ffprobePath, ['-v','quiet','-print_format','json','-show_format','-show_streams', videoPath], { windowsHide: true });
            let out = '';
            p.stdout.on('data', d => out += d);
            p.on('close', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } });
            p.on('error', reject);
        });
        const rawDuration = parseFloat(probeInfo.format?.duration || 0);
        const vs = probeInfo.streams?.find(s => s.codec_type === 'video') || {};
        const as = probeInfo.streams?.find(s => s.codec_type === 'audio') || {};
        const audioChannels = as.channels || 2;

        // Trim đầu / cuối video — cắt trước khi chạy pipeline
        const trimStartSec = Math.max(0, parseFloat(trimStart || 0));
        const trimEndSec   = Math.max(0, parseFloat(trimEnd   || 0));
        const trimOffset   = trimStartSec;                                  // điểm bắt đầu thực tế
        const duration     = Math.max(1, rawDuration - trimStartSec - trimEndSec); // thời lượng sau cắt
        if (trimStartSec > 0 || trimEndSec > 0) {
            sendLog(`✂ Cắt đầu ${trimStartSec}s + cuối ${trimEndSec}s — thời lượng còn lại: ${duration.toFixed(1)}s`, 'info', 1);
        }
        sendLog(`✅ Duration: ${rawDuration.toFixed(1)}s → ${duration.toFixed(1)}s (sau cắt) | ${vs.width || '?'}x${vs.height || '?'} | ${(vs.r_frame_rate || '?')} fps | audio ${audioChannels}ch`, 'success', 0);

        if (duration < 1) throw new Error('Video quá ngắn hoặc không đọc được thông tin (sau cắt đầu/cuối)');

        // ── Kiểm tra dung lượng đĩa trước khi encode ────────────────────────────
        const outDrive = path.resolve(outputFolder).slice(0, 2).toUpperCase();
        try {
            const { execSync } = require('child_process');
            const wmicOut = execSync(`wmic logicaldisk where "DeviceID='${outDrive}'" get FreeSpace /value`, { encoding: 'utf8', timeout: 5000 });
            const freeMatch = wmicOut.match(/FreeSpace=(\d+)/);
            if (freeMatch) {
                const freeGB   = parseInt(freeMatch[1]) / (1024 ** 3);
                const pixCount = (vs.width || 1920) * (vs.height || 1080);
                const mbPerSec = pixCount > 3000000 ? 3 : pixCount > 1000000 ? 1.5 : 0.8; // 4K→3, 1440p→1.5, 1080p→0.8
                const needGB   = (duration * mbPerSec * 2) / 1024; // ×2 vì 2-pass temp
                sendLog(`💾 Ổ ${outDrive}: còn ${freeGB.toFixed(1)}GB | ước tính cần ${needGB.toFixed(1)}GB`, 'info');
                if (freeGB < needGB + 1) throw new Error(`Không đủ dung lượng ổ ${outDrive}: còn ${freeGB.toFixed(1)}GB, ước tính cần ít nhất ${(needGB + 1).toFixed(1)}GB`);
            }
        } catch(diskErr) {
            if (diskErr.message.startsWith('Không đủ')) throw diskErr;
            sendLog(`⚠ Không kiểm tra được dung lượng đĩa: ${diskErr.message}`, 'info');
        }

        // ── GPU encoder — CRF/QP tự động theo resolution ─────────────────────────
        // outputResolution: 'source'=giữ nguyên, '1080p'=force 1080p, '4k'=force 4K
        const srcVidH = vs.height || 1080;
        const srcVidW = vs.width  || 1920;
        let vidH, vidW;
        if (outputResolution === '1080p') {
            vidH = 1080; vidW = srcVidH > srcVidW ? 608 : 1920; // portrait → 608x1080, landscape → 1920x1080
            // Giữ đúng tỷ lệ gốc
            vidW = Math.round(srcVidW / srcVidH * vidH / 2) * 2;
            sendLog(`📺 Đầu ra: 1080p (${vidW}x${vidH}) — nguồn: ${srcVidW}x${srcVidH}`, 'info');
        } else if (outputResolution === '4k') {
            vidH = 2160; vidW = Math.round(srcVidW / srcVidH * vidH / 2) * 2;
            sendLog(`📺 Đầu ra: 4K (${vidW}x${vidH}) — nguồn: ${srcVidW}x${srcVidH}`, 'info');
        } else {
            vidH = srcVidH; vidW = srcVidW;
        }
        const autoCrf = vidH >= 2160 ? 22 : vidH >= 1440 ? 20 : 18;
        sendLog(`🎯 CRF tự động: ${autoCrf} (${vidW}x${vidH})`, 'info');
        // -bf 0: tắt B-frames → DTS luôn = PTS → không bị container DTS offset → audio/video sync
        const nvencArgs = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'constqp', '-qp', String(autoCrf), '-bf', '0', '-c:a', 'aac', '-ar', '44100', '-b:a', '192k'];
        const amfArgs   = ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(autoCrf), '-qp_p', String(autoCrf + 2), '-bf', '0', '-c:a', 'aac', '-ar', '44100', '-b:a', '192k'];
        const qsvArgs   = ['-c:v', 'h264_qsv', '-global_quality', String(autoCrf), '-preset', 'fast', '-c:a', 'aac', '-ar', '44100', '-b:a', '192k'];
        const cpuPreset = duration > 600 ? 'veryfast' : 'fast'; // video >10 phút dùng veryfast
        const cpuArgs   = ['-c:v', 'libx264', '-crf', String(autoCrf), '-preset', cpuPreset, '-bf', '0', '-c:a', 'aac', '-ar', '44100', '-b:a', '192k'];
        let encArgs = cpuArgs;
        let hwEncType = 'cpu'; // 'cpu' | 'amf' | 'nvenc' | 'qsv'
        if (gpuMode === 'nvenc') {
            encArgs = nvencArgs; hwEncType = 'nvenc';
            sendLog('🟢 NVIDIA NVENC — áp đặt thẳng, không test', 'success');
        } else if (gpuMode === 'amf') {
            encArgs = amfArgs; hwEncType = 'amf';
            sendLog('🔴 AMD AMF — áp đặt thẳng, không test', 'success');
        } else if (gpuMode === 'qsv') {
            encArgs = qsvArgs; hwEncType = 'qsv';
            sendLog('🔵 Intel QSV — áp đặt thẳng, không test', 'success');
        } else if (gpuMode === 'cpu') {
            sendLog('⚪ CPU libx264 — người dùng chọn CPU', 'info');
        } else {
            // auto: thực sự test encode từng GPU — không chỉ kiểm tra danh sách
            const testEncode = (codec, extraArgs) => new Promise(resolve => {
                const args = [
                    '-f', 'lavfi', '-i', 'color=black:s=64x64:r=1:d=0.1',
                    '-c:v', codec, ...extraArgs,
                    '-frames:v', '1', '-f', 'null', '-'
                ];
                const ep = spawn(ffmpegPath, args, { windowsHide: true });
                let err = '';
                ep.stderr?.on('data', d => { err += d; });
                ep.on('close', code => resolve(code === 0));
                ep.on('error', () => resolve(false));
            });
            try {
                if (await testEncode('h264_nvenc', ['-preset', 'p4', '-tune', 'hq', '-rc', 'constqp', '-qp', '18'])) {
                    encArgs = nvencArgs; hwEncType = 'nvenc';
                    sendLog('🚀 NVIDIA NVENC — render nhanh ~5-10x so với CPU', 'success');
                } else if (await testEncode('h264_amf', ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'])) {
                    encArgs = amfArgs; hwEncType = 'amf';
                    sendLog('🚀 AMD AMF — tăng tốc GPU AMD', 'success');
                } else if (await testEncode('h264_qsv', ['-global_quality', '18', '-preset', 'fast'])) {
                    encArgs = qsvArgs; hwEncType = 'qsv';
                    sendLog('🚀 Intel QSV — tăng tốc GPU Intel', 'success');
                } else {
                    sendLog('💻 CPU libx264 — không phát hiện GPU tương thích, dùng CPU', 'info');
                }
            } catch(_) { sendLog('💻 CPU libx264 (GPU check thất bại)', 'info'); }
        }

        // ── Bước 1: Trích frame để detect logo — seek-based parallel extraction ──
        // fps= filter phải decode toàn bộ video → rất chậm với video dài/4K/60fps
        // Thay bằng N lần -ss seek song song → nhảy thẳng đến keyframe, không cần decode toàn video
        sendLog('🖼 Trích xuất khung hình để phát hiện logo...', 'info', 1);
        const tempDir = path.join(outputFolder, `_rc_tmp_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // 15 frames: 5 intro (đầu video) + 5 middle + 5 outro (cuối video)
        // Để detect logo động xuất hiện ở đầu, giữa VÀ cuối video riêng lẻ
        // Không dùng hwaccel: lấy 15 frame nhỏ không đáng GPU init overhead
        const INTRO_END   = Math.min(8, duration * 0.08);
        const OUTRO_START = Math.max(duration - 8, duration * 0.92);
        const introSeeks  = Array.from({length: 5}, (_, i) => 0.5 + (INTRO_END  - 0.5) * i / 4);
        const outroSeeks  = Array.from({length: 5}, (_, i) => OUTRO_START + (duration - 0.5 - OUTRO_START) * i / 4);
        const midS = INTRO_END + 1, midE = OUTRO_START - 1;
        const midSeeks = midE > midS
            ? Array.from({length: 5}, (_, i) => midS + (midE - midS) * (i + 0.5) / 5)
            : [duration / 2];
        const seekTimes = [...introSeeks, ...midSeeks, ...outroSeeks]
            .map(t => Math.max(0.1, Math.min(duration - 0.1, t)));
        const nFrames = seekTimes.length;
        const FRAME_TIMEOUT_MS = 20000; // 20s timeout mỗi frame — tránh hang vô thời hạn
        const seekAndExtract = (ts, idx) => new Promise(resolve => {
            const outFile = path.join(tempDir, `f${String(idx + 1).padStart(4, '0')}.jpg`);
            const p = spawn(ffmpegPath, [
                '-ss', ts.toFixed(2), '-i', videoPath,
                '-vframes', '1', '-vf', 'scale=640:-1', '-q:v', '4', '-y', outFile,
            ], { windowsHide: true });
            const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch(_) {} resolve(); }, FRAME_TIMEOUT_MS);
            p.on('close', () => { clearTimeout(timer); resolve(); });
            p.on('error', () => { clearTimeout(timer); resolve(); });
        });
        // Chạy song song — tổng thời gian ≈ thời gian 1 seek đơn lẻ
        await Promise.all(seekTimes.map((ts, i) => seekAndExtract(ts, i)));
        const frameCount = fs.readdirSync(tempDir).filter(f => f.endsWith('.jpg')).length;
        sendLog(`✅ Trích ${frameCount}/${nFrames} frame xong`, 'success', 1);

        // ── Bước 2: Detect logo — Python OpenCV ──────────────────────────────────
        let logoRegions = [];
        let detectedImgW = 640;
        let detectedImgH = Math.round(640 / (srcVidW / srcVidH));

        if (preDetectedLogoRegions !== null) {
            // Dùng kết quả detect đã có từ lần trước (multi-output: không detect lại)
            logoRegions = preDetectedLogoRegions;
            if (preDetectedImgW !== null) detectedImgW = preDetectedImgW;
            if (preDetectedImgH !== null) detectedImgH = preDetectedImgH;
            sendLog(`♻ Dùng lại kết quả detect logo (${logoRegions.length} vùng) — bỏ qua detect`, 'info', 2);
        }

        if (preDetectedLogoRegions === null) {
            // ── Python OpenCV: variance analysis ────────────────────────────────
            sendLog('🔍 OpenCV đang phát hiện logo...', 'info', 2);
            const pyScript = path.join(__dirname, 'watermark_auto.py');
            try {
                const pyOut = await new Promise((resolve) => {
                    const p = spawn('python', [pyScript, tempDir, '--detect-dynamic'], { windowsHide: true });
                    let out = '';
                    p.stdout.on('data', d => out += d);
                    p.stderr.on('data', () => {});
                    p.on('close', () => resolve(out));
                    p.on('error', () => resolve(''));
                });
                const rm = pyOut.match(/REGIONS:(\[.*?\])/);
                const sm = pyOut.match(/IMG_SIZE:(\d+)x(\d+)/);
                if (sm) { detectedImgW = parseInt(sm[1]); detectedImgH = parseInt(sm[2]); }
                if (rm) { logoRegions = JSON.parse(rm[1]); }
                if (logoRegions.length > 0) {
                    sendLog(`✅ Phát hiện ${logoRegions.length} vùng logo: ${logoRegions.map(r=>r.pos).join(', ')}`, 'success', 2);
                } else {
                    sendLog('ℹ Không phát hiện logo rõ — chỉ cắt đoạn + lọc', 'info', 2);
                }
            } catch(e) {
                sendLog(`⚠ Detect lỗi: ${e.message}`, 'info', 2);
            }
        }

        // ── Bước 3: Tính vùng crop bảo toàn tỷ lệ khung hình gốc ──────────────
        sendLog('✂ Đang xóa logo + cắt đoạn + ghép...', 'info', 3);

        // vidW và vidH đã khai báo ở trên (GPU encoder section, có tính outputResolution)
        const aspectRatio = vidW / vidH;
        const orientation = aspectRatio > 1.2 ? 'ngang' : aspectRatio < 0.85 ? 'dọc' : 'vuông';
        sendLog(`📐 Kích thước đầu ra: ${vidW}x${vidH} | AR ${aspectRatio.toFixed(3)} (${orientation})`, 'info', 3);

        // Tỉ lệ scale từ detected-frame coords → source video coords
        const scaleX = srcVidW / detectedImgW;
        const scaleY = srcVidH / detectedImgH;

        // Logo bị loại hoàn toàn bằng crop bên dưới — không cần delogo/drawbox
        // Crop dịch cửa sổ sang phía đối diện với logo → logo rơi ra ngoài khung, scale lại = zoom tự nhiên

        // ── Lớp 2: Crop/zoom — tính margin đủ để logo ra ngoài rìa crop ────────
        // Compute yêu cầu tối thiểu từng cạnh để cắt hết logo (không chỉ offset)
        const CROP_PAD = 18; // extra pixels ngoài rìa logo để an toàn
        let reqLeft = 0, reqRight = 0, reqTop = 0, reqBot = 0;
        for (const r of logoRegions) {
            const lx1 = Math.floor(r.x * scaleX);
            const lx2 = Math.ceil((r.x + r.w) * scaleX);
            const ly1 = Math.floor(r.y * scaleY);
            const ly2 = Math.ceil((r.y + r.h) * scaleY);
            const lcx = (lx1 + lx2) / 2;
            const lcy = (ly1 + ly2) / 2;
            // Logo nửa trái → phải dịch crop sang phải (cắt phần trái)
            if (lcx < srcVidW / 2) reqLeft  = Math.max(reqLeft,  lx2 + CROP_PAD);
            else                    reqRight = Math.max(reqRight, srcVidW - lx1 + CROP_PAD);
            if (lcy < srcVidH / 2) reqTop   = Math.max(reqTop,   ly2 + CROP_PAD);
            else                    reqBot   = Math.max(reqBot,   srcVidH - ly1 + CROP_PAD);
        }

        // Crop tổng = max(zoom yêu cầu, logo yêu cầu)
        const zoomFrac  = Math.max(0.03, Math.min(0.20, zoomPct / 100));
        const minFromZoomX = Math.floor(srcVidW * zoomFrac);
        const minFromZoomY = Math.floor(srcVidH * zoomFrac);
        const totalRemX = Math.max(minFromZoomX, reqLeft + reqRight);
        const totalRemY = Math.max(minFromZoomY, reqTop  + reqBot);

        // Đồng bộ tỉ lệ cắt 2 trục về cùng % để giữ đúng AR gốc
        // (lấy trục cần cắt nhiều hơn làm chuẩn, cắt thêm trục kia cho đồng đều)
        const remXFrac = totalRemX / srcVidW;
        const remYFrac = totalRemY / srcVidH;
        const remFrac  = Math.max(remXFrac, remYFrac);           // tỉ lệ đồng bộ
        const syncRemX = Math.ceil(srcVidW * remFrac);
        const syncRemY = Math.ceil(srcVidH * remFrac);

        // Giới hạn không crop quá 40% để tránh video bị méo nặng
        let cropW = Math.max(Math.floor(srcVidW * 0.60), srcVidW - syncRemX);
        let cropH = Math.max(Math.floor(srcVidH * 0.60), srcVidH - syncRemY);
        cropW -= cropW % 2;
        cropH -= cropH % 2;

        // Kiểm tra AR sau cùng — nếu vẫn lệch do clamp 60% thì ép về AR gốc
        {
            const srcAR = srcVidW / srcVidH;
            const curAR = cropW / cropH;
            if (Math.abs(curAR / srcAR - 1) > 0.005) {
                // Giữ cropW, tính lại cropH theo AR gốc (hoặc ngược lại)
                const h = Math.round(cropW / srcAR);
                if (h >= srcVidH * 0.60 && h <= srcVidH) {
                    cropH = h - (h % 2);
                } else {
                    const w = Math.round(cropH * srcAR);
                    cropW = Math.max(Math.floor(srcVidW * 0.60), w) - (w % 2);
                }
            }
        }

        // Tính cropX/Y: đặt cửa sổ crop sao cho logo nằm ngoài rìa
        // Khi không detect được logo → lệch crop về phía trên-giữa:
        //   toàn bộ phần cắt dọc dồn về TOP (logo thường ở góc trên)
        //   phần cắt ngang căn giữa (logo ở cả 2 bên → không thiên về đâu)
        const totalRemY_val = srcVidH - cropH; // tổng px cần cắt theo chiều dọc
        let cropX, cropY;
        if (reqLeft > 0 && reqRight === 0) {
            cropX = reqLeft;
        } else if (reqRight > 0 && reqLeft === 0) {
            cropX = 0;
        } else {
            cropX = Math.floor((srcVidW - cropW) / 2);
        }
        if (reqTop > 0 && reqBot === 0) {
            cropY = reqTop;
        } else if (reqBot > 0 && reqTop === 0) {
            cropY = 0;
        } else if (logoRegions.length === 0) {
            // Không detect logo → dồn phần cắt dọc về phía trên để xóa logo góc
            cropY = totalRemY_val; // cắt hết từ trên, giữ nguyên phần dưới
        } else {
            cropY = Math.floor((srcVidH - cropH) / 2);
        }
        // Clamp để không vượt bounds
        cropX = Math.max(0, Math.min(cropX, srcVidW - cropW));
        cropY = Math.max(0, Math.min(cropY, srcVidH - cropH));

        if (logoRegions.length > 0) {
            sendLog(`✂ Crop để xóa logo: ${cropW}x${cropH} tại (${cropX},${cropY}) [yêu cầu L=${reqLeft} R=${reqRight} T=${reqTop} B=${reqBot}]`, 'info', 3);
        }
        sendLog(`✂ Zoom ${((1 - cropW/srcVidW) * 100).toFixed(1)}%: crop ${cropW}x${cropH} tại (${cropX},${cropY}) → scale ${vidW}x${vidH}`, 'info', 3);

        // Crop dịch cửa sổ để logo rơi ngoài rìa → scale lại về kích thước gốc = zoom tự nhiên
        const zoomFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${vidW}:${vidH}`;

        // ── Random Position Crop: lệch tâm ngẫu nhiên 3-8% sau bước scale ──────
        let posCropVf = '';
        if (randomPosCrop) {
            const pct = 0.03 + Math.random() * 0.05;          // 3-8%
            const shiftX = Math.floor(vidW * pct);
            const shiftY = Math.floor(vidH * pct);
            const dx = Math.floor(Math.random() * shiftX);
            const dy = Math.floor(Math.random() * shiftY);
            const cw  = vidW - shiftX;
            const ch  = vidH - shiftY;
            posCropVf = `,crop=${cw}:${ch}:${dx}:${dy},scale=${vidW}:${vidH}`;
            sendLog(`📐 Random Crop lệch tâm: offset dx=${dx} dy=${dy} (${(pct * 100).toFixed(1)}%)`, 'info');
        }

        // Parse fps sớm — dùng cho cả setpts sau select lẫn Ken Burns
        // FRAME_RATE variable không dùng được sau select (VFR stream → FRAME_RATE=0 → division by zero khi init)
        // VP9/webm VFR: r_frame_rate có thể là '0/1' hoặc '1000/1' (timebase) → invalid
        // Dùng avg_frame_rate làm fallback, cuối cùng về 30fps
        const parseFps = (str) => {
            if (!str) return 0;
            const [n, d] = str.split('/').map(Number);
            if (!d || !n) return 0;
            const v = n / d;
            return (v > 0 && v <= 120) ? v : 0; // >120fps = bất thường (timebase), bỏ qua
        };
        const sourceFpsNum = parseFps(vs.r_frame_rate) || parseFps(vs.avg_frame_rate) || 30;
        const sourceFps = sourceFpsNum.toFixed(6);

        // ── Cắt đoạn: dùng concat demuxer (file .txt) thay vì select=between() ──
        // Lý do: select=between() với video 1 giờ sinh 600+ expr → args quá dài → ENAMETOOLONG.
        // Concat demuxer đọc segments từ file → không bị giới hạn, hỗ trợ video dài tùy ý.
        // Dùng os.tmpdir() — luôn là path ASCII ngắn (C:\Users\...\AppData\Local\Temp).
        // KHÔNG dùng userData (có thể bị AV quarantine) hay outputFolder (có thể chứa Unicode
        // từ tên thư mục của khách → FFmpeg concat demuxer không đọc được path Unicode trên Windows).
        const concatPath = path.join(require('os').tmpdir(), `_fluxy_segs_${Date.now()}_${Math.random().toString(36).slice(2,7)}.txt`);
        let segs = [];
        // trimOffset = trimStartSec: tất cả inpoint/outpoint dịch về phía trước theo offset này
        if (randomCut) {
            const srcFpsNum = parseFloat(sourceFps);
            const frameDur = 1 / srcFpsNum;
            const MAX_SEGS = 50;
            const minSegLen = duration < 60 ? 3 : Math.max(8, duration / MAX_SEGS * 0.8);
            const maxSegExtra = duration < 60 ? 3 : Math.max(7, duration / MAX_SEGS * 0.4);
            let tc = 0;
            while (tc < duration - 2) {
                const segLen = minSegLen + Math.random() * maxSegExtra;
                const cutFrames = 2 + Math.floor(Math.random() * 4);
                const cutLen = cutFrames * frameDur;
                const sFrame = Math.round((trimOffset + tc) * srcFpsNum);
                const eRaw   = Math.min(trimOffset + tc + segLen - cutLen, trimOffset + duration - 0.1);
                const eFrame = Math.round(eRaw * srcFpsNum);
                const s   = parseFloat((sFrame / srcFpsNum).toFixed(6));
                const e   = parseFloat((eFrame / srcFpsNum).toFixed(6));
                const dur = parseFloat(((eFrame - sFrame) / srcFpsNum).toFixed(6));
                if (e - s > 1) segs.push({ s, e, sFrame, eFrame, dur });
                if (segs.length >= MAX_SEGS) break;
                tc += segLen;
            }
            sendLog(`✂ Micro-cut: ${segs.length} điểm${trimOffset > 0 ? ` (offset +${trimOffset}s)` : ''}`, 'info', 3);
        } else {
            const srcFpsNum2 = parseFloat(sourceFps);
            const eFull    = parseFloat((trimOffset + duration - 0.05).toFixed(4));
            const eFrameFull = Math.round(eFull * srcFpsNum2);
            const sFrameFull = Math.round(trimOffset * srcFpsNum2);
            const durFull  = parseFloat(((eFrameFull - sFrameFull) / srcFpsNum2).toFixed(6));
            segs.push({ s: parseFloat(trimOffset.toFixed(6)), e: eFull, sFrame: sFrameFull, eFrame: eFrameFull, dur: durFull });
        }
        // totalVideoDur: tổng duration chính xác của tất cả segments (tính từ frame boundary)
        // Dùng cho trim=end trong finalVf để cắt đúng sau fps filter, tránh VFR tail bleed
        const totalVideoDur = parseFloat(segs.reduce((acc, sg) => acc + sg.dur, 0).toFixed(6));
        // Ghi file concat — FFmpeg đọc từ file, không qua args → không bị ENAMETOOLONG
        if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
        const safeVidPath = videoPath.replace(/\\/g, '/');
        const concatContent = segs.map(sg =>
            `file '${safeVidPath}'\ninpoint ${sg.s}\noutpoint ${sg.e}`
        ).join('\n');
        fs.writeFileSync(concatPath, concatContent, 'utf8');
        // targetFps: tính trước để dùng trong cutVf. randomFps thay đổi FPS qua filter (không dùng -r)
        let targetFps = sourceFps;
        if (randomFps) {
            const baseFps2 = parseFloat(sourceFps);
            // Dùng sourceFps làm base (không dùng 30/60 cứng): tránh duplicate frame (25→30fps)
            // hay drop frame (60→30fps) gây lip sync "giật" dù PTS đúng
            const offset2  = (0.15 + Math.random() * 1.35) * (Math.random() > 0.5 ? 1 : -1);
            targetFps = String(Math.max(24, baseFps2 + offset2).toFixed(2));
        }
        // Với concat demuxer: không cần select/aselect — cắt xử lý ở input level.
        // setpts=PTS-STARTPTS: reset timestamp. fps=targetFps: normalize VFR → CFR tại đúng fps mục tiêu
        // N/FRAME_RATE/TB: renumber frame PTS tuyến tính → đóng gap sau select filter
        // (setpts=PTS-STARTPTS để gap, fps filter sẽ freeze frame tại gap — SAI)
        // fps=${targetFps} thay thế setpts=N/FRAME_RATE/TB — xử lý đúng cả CFR lẫn VFR
        // FRAME_RATE=0 với VFR video → setpts=N/0/TB = lỗi. fps filter tự xử lý VFR → CFR
        // setpts=PTS-STARTPTS sau fps: reset video PTS về 0 sau concat demuxer
        // Concat demuxer với inpoint>0 (trimStart) output video PTS bắt đầu tại ~trimStart giây
        // Audio dùng asetpts=N/SR/TB đã reset về 0 → nếu không reset video thì lệch trimStart giây
        const cutVf  = `fps=${targetFps},setpts=PTS-STARTPTS`;
        // asetpts=PTS-STARTPTS: trừ PTS đầu tiên — cùng cách reset với video (PTS-STARTPTS)
        // → audio và video đều reset về 0 từ cùng 1 reference point → sync khi có trim lẫn không trim
        const cutAf  = 'asetpts=PTS-STARTPTS';
        const k4Vf  = ''; // không filter thêm — giữ chất lượng gốc, đầu vào thế nào ra thế ấy

        // ── Color Shift: lệch tông màu ngẫu nhiên (eq filter) ─────────────────
        let colorVf = '';
        if (colorShift) {
            const cRanges = {
                subtle: { contrast: [0.990, 1.010], sat: [0.970, 1.030], bri: [-0.010, 0.010] },
                medium: { contrast: [0.980, 1.030], sat: [0.950, 1.050], bri: [-0.020, 0.020] },
                strong: { contrast: [0.960, 1.050], sat: [0.900, 1.100], bri: [-0.030, 0.030] },
            };
            const r = cRanges[colorShiftLevel] || cRanges.medium;
            const rndRange = (a, b) => (a + Math.random() * (b - a)).toFixed(4);
            const cont = rndRange(...r.contrast);
            const sat  = rndRange(...r.sat);
            const bri  = rndRange(...r.bri);
            colorVf = `,eq=contrast=${cont}:saturation=${sat}:brightness=${bri}`;
            sendLog(`🎨 Color Shift (${colorShiftLevel}): contrast=${cont} sat=${sat} bri=${bri}`, 'info');
        }

        // ── Ken Burns effect (zoompan) ─────────────────────────────────────────
        // zoompan là CPU-only, cực chậm trên 4K video dài → tự động tắt nếu > 20 phút hoặc 4K
        let kbVf = '';
        if (kenBurns !== 'none') {
            const isHeavy = (srcVidH >= 2160 || duration > 1200); // source 4K hoặc > 20 phút
            if (isHeavy) {
                sendLog(`⚠ Ken Burns tắt tự động — video 4K/dài (${Math.round(duration/60)}min): quá chậm trên CPU`, 'info');
            } else {
                const fps = parseFloat(sourceFps);
                const totalFrames = Math.max(1, Math.ceil(duration * fps));
                if (kenBurns === 'zoom-in') {
                    const zStep = (0.05 / totalFrames).toFixed(8);
                    // fps=targetFps: fix zoompan defaulting to 25fps → causes 2.4x video slowdown vs audio
                    kbVf = `,zoompan=z=min(1+on*${zStep}\\,1.05):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:fps=${targetFps}:s=${vidW}x${vidH}`;
                    sendLog(`🎬 Ken Burns Zoom-In: ${totalFrames} frames`, 'info');
                } else if (kenBurns === 'pan-lr') {
                    const panStep = ((vidW * 0.04) / totalFrames).toFixed(5);
                    kbVf = `,zoompan=z=1.04:x=min(on*${panStep}\\,iw*0.04):y=ih/2-(ih/zoom/2):d=1:fps=${targetFps}:s=${vidW}x${vidH}`;
                    sendLog(`🎬 Ken Burns Pan L→R: ${totalFrames} frames`, 'info');
                }
                sendLog('⚠ Ken Burns làm chậm render — vui lòng chờ', 'info');
            }
        }

        // ── Biến tốc ngẫu nhiên — constant factor, apply đồng thời video + audio ──
        // Dùng setpts/atempo constant thay vì sin-wave để tránh A/V drift.
        // Sin-wave chỉ thay đổi video PTS, audio chạy thẳng → lệch tích lũy ~0.2s.
        let spdVf = '';
        let spdAf = '';
        let varSpeedFactor = 1.0;
        if (varSpeed) {
            // Giảm range xuống ±0.7% (medium) để không nghe thấy tốc độ thay đổi
            const ranges = { light: [0.995, 1.005], medium: [0.993, 1.007], strong: [0.990, 1.010] };
            const [lo, hi] = ranges[varSpeedLevel] || ranges.medium;
            varSpeedFactor = lo + Math.random() * (hi - lo);
        }

        // ── Tăng tốc theo thời lượng mục tiêu ──────────────────────────────────
        let targetSpeedFactor = 1.0;
        if (targetDurEnabled && targetDurMinutes > 0) {
            targetSpeedFactor = duration / (targetDurMinutes * 60);
            // Clamp 0.5x – 4x để tránh artifacts quá nặng
            targetSpeedFactor = Math.max(0.5, Math.min(4.0, targetSpeedFactor));
            const newDurMin = (duration / targetSpeedFactor / 60).toFixed(1);
            sendLog(`⏩ Tăng tốc mục tiêu: ${targetSpeedFactor.toFixed(3)}x → thời lượng ~${newDurMin} phút`, 'info');
        }

        const combinedSpeed = varSpeedFactor * targetSpeedFactor;
        if (combinedSpeed !== 1.0) {
            spdVf = `,setpts=PTS/${combinedSpeed.toFixed(6)}`;
            // Audio: atempo chỉ hỗ trợ 0.5–2.0, chain nhiều filter nếu ngoài range
            const buildAtempo = (spd) => {
                const steps = [];
                let rem = spd;
                while (rem > 2.0) { steps.push('atempo=2.0'); rem /= 2.0; }
                while (rem < 0.5) { steps.push('atempo=0.5'); rem /= 0.5; }
                steps.push(`atempo=${rem.toFixed(6)}`);
                return steps.join(',');
            };
            spdAf = `,${buildAtempo(combinedSpeed)}`;
            if (varSpeed || (targetDurEnabled && targetDurMinutes > 0)) {
                const pct = ((combinedSpeed - 1) * 100).toFixed(2);
                sendLog(`🔀 Tốc độ tổng: ${combinedSpeed.toFixed(4)}x (${pct >= 0 ? '+' : ''}${pct}%)`, 'info');
            }
        }

        // finalAf sẽ được build sau khi tất cả filter vars được khai báo bên dưới

        // Watermark tên kênh di chuyển ngẫu nhiên (Lissajous — 2 sóng sin tần số lệch nhau)
        let wmVf = '';
        if (channelName) {
            // Escape không dùng single quotes: \\ cho backslash, \: cho colon, \ (space) cho space, \, cho comma
            const safeText = channelName
                .replace(/\\/g, '\\\\')
                .replace(/:/g, '\\:')
                .replace(/,/g, '\\,')
                .replace(/ /g, '\\ ')
                .replace(/'/g, "\\'");
            const op  = (wmOpacity / 100).toFixed(2);
            const spd = wmCycle === 60 ? 0.5 : wmCycle === 40 ? 1.0 : 2.0;
            const p   = 30;
            const fx  = (0.073 * spd).toFixed(5);
            const fy  = (0.103 * spd).toFixed(5);
            const xE  = `(W-tw)/2+((W-tw)/2-${p})*sin(${fx}*2*PI*t)`;
            const yE  = `(H-th)/2+((H-th)/2-${p})*sin(${fy}*2*PI*t+1.3)`;
            // fontfile: thử arial trước, nếu không có thì bỏ qua (tránh Error initializing filters)
            const fontArg = fs.existsSync('C:/Windows/Fonts/arial.ttf')
                ? `fontfile=C\\:/Windows/Fonts/arial.ttf:`
                : fs.existsSync('C:/Windows/Fonts/Arial.ttf')
                    ? `fontfile=C\\:/Windows/Fonts/Arial.ttf:`
                    : '';
            wmVf = `,drawtext=${fontArg}text=${safeText}:fontsize=36:fontcolor=white@${op}:shadowcolor=black@0.5:shadowx=2:shadowy=2:x=${xE}:y=${yE}`;
            sendLog(`✍ Watermark kênh "${channelName}" — opacity ${wmOpacity}%, tốc độ ${spd}x`, 'info');
        }

        // hflip đặt trước watermark để chữ watermark không bị lật
        const hflipVf = hFlip ? ',hflip' : '';
        // Film grain: noise động theo thời gian (allf=t)
        const grainVf = grainNoise ? `,noise=alls=${grainLevel}:allf=t` : '';

        // ── Xoay góc nhẹ (Slight Rotate) — phá DCT hash toàn frame ─────────────
        // 0.1-0.5° → mắt không thấy, nhưng mọi pixel thay đổi → ContentID thất bại
        let rotateVf = '';
        if (slightRotate) {
            const deg = (0.1 + Math.random() * 0.4) * (Math.random() > 0.5 ? 1 : -1);
            const rad = (deg * Math.PI / 180).toFixed(6);
            // rotate + crop lại đúng kích thước để không có viền đen
            rotateVf = `,rotate=${rad}:ow=iw:oh=ih:c=black`;
            sendLog(`🔄 Xoay góc: ${deg > 0 ? '+' : ''}${deg.toFixed(2)}° (tàng hình, phá pixel hash)`, 'info');
        }

        // ── Hue Rotation — xoay màu 3-10° ────────────────────────────────────────
        // hue=h=X: xoay toàn bộ màu sắc → RGB thay đổi nhưng video trông vẫn tự nhiên
        let hueVf = '';
        if (hueRotate) {
            const hueDeg = (3 + Math.random() * 7) * (Math.random() > 0.5 ? 1 : -1);
            hueVf = `,hue=h=${hueDeg.toFixed(2)}`;
            sendLog(`🎨 Hue rotation: ${hueDeg > 0 ? '+' : ''}${hueDeg.toFixed(1)}° (phá color fingerprint)`, 'info');
        }

        // ── Xóa vùng phụ đề (Sub Remove) ────────────────────────────────────────
        // delogo: inpaint từ pixel xung quanh — tự nhiên hơn black bar với nền phức tạp
        // drawbox: che đen — đơn giản, nhanh, không bị artifact
        let subRemoveVf = '';
        if (subRemove) {
            const subH  = Math.max(4, Math.floor(vidH * (subHeight || 10) / 100));
            const subW  = Math.max(10, Math.floor(vidW * (subWidth  || 100) / 100));
            const subX  = Math.floor(vidW * (subHOffset || 0) / 100);
            const subY  = subPosition === 'top' ? 0 : vidH - subH;
            if (subStyle === 'black') {
                subRemoveVf = `,drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=black:t=fill`;
            } else if (subStyle === 'blur') {
                subRemoveVf = `,split[_sv][_sb];[_sb]crop=${subW}:${subH}:${subX}:${subY},boxblur=lr=15:lp=2[_sbc];[_sv][_sbc]overlay=${subX}:${subY}`;
            } else {
                subRemoveVf = `,drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=black@0.85:t=fill`;
            }
            sendLog(`📝 Xóa phụ đề: ${subStyle} | ${subPosition} | ${subW}×${subH}px tại (${subX},${subY})`, 'info');
        }

        // ── Vignette — làm tối 4 góc, thay đổi histogram toàn frame ────────────
        let vignetteVf = '';
        if (vignette) {
            const angle = (0.08 + Math.random() * 0.18).toFixed(4); // 0.08-0.26 rad — tàng hình
            vignetteVf = `,vignette=angle=${angle}:mode=forward:eval=init`;
            sendLog(`🌑 Vignette: angle=${angle}rad — tối góc nhẹ, thay đổi hash vùng rìa`, 'info');
        }

        // ── Color Channel Mixer — biến đổi RGB toán học, ZERO spatial interpolation ──
        // colorchannelmixer: mỗi pixel R/G/B = tổ hợp tuyến tính của R/G/B gốc
        // KHÁC rgbashift (dịch pixel → blur/CA): cái này là phép nhân ma trận → sắc nét 100%
        // 0.1-0.3% cross-mixing: hoàn toàn vô hình nhưng thay đổi mọi pixel → phá perceptual hash
        let channelShiftVf = '';
        if (colorChannelShift) {
            const mix = (0.001 + Math.random() * 0.002).toFixed(4); // 0.1-0.3%
            const m = parseFloat(mix);
            const rr = (1 - m).toFixed(4), gg = (1 - m).toFixed(4), bb = (1 - m).toFixed(4);
            // Cross-mix với dấu ngẫu nhiên để mỗi video có ma trận khác nhau
            const sg1 = Math.random() > 0.5 ? m : -m;
            const sg2 = Math.random() > 0.5 ? m : -m;
            channelShiftVf = `,colorchannelmixer=rr=${rr}:rg=${sg1.toFixed(4)}:rb=${(-sg1).toFixed(4)}:gr=${sg2.toFixed(4)}:gg=${gg}:gb=${(-sg2).toFixed(4)}:br=${(-sg2*0.5).toFixed(4)}:bg=${(sg1*0.5).toFixed(4)}:bb=${bb}`;
            sendLog(`🌈 Color Matrix: cross-mix ${(m*100).toFixed(2)}% — phá pixel hash, zero blur`, 'info');
        }

        // perspectiveWarp đã bị loại bỏ — perspective filter dùng bilinear resampling toàn frame
        // → làm mờ toàn bộ hình ảnh, giống như scale xuống 480p rồi scale lên lại
        // colorchannelmixer ở trên đã đủ để phá scene detection hash
        let perspectiveVf = '';

        // ── Frame Noise cực nhỏ — phá temporal fingerprint, KHÔNG ảnh hưởng độ sắc nét ──
        // noise=alls=2 = biên độ 2/255 (~0.8%) — mắt không thấy, nhưng thay đổi hash từng frame
        // Chỉ bật nếu grainNoise tắt (nếu grainNoise bật thì đã có noise rồi, không cần thêm)
        let temporalBlendVf = '';
        if (temporalBlend && !grainNoise) {
            temporalBlendVf = `,noise=alls=2:allf=u`;
            sendLog(`⏱ Frame Noise 2/255 — phá temporal hash`, 'info');
        } else if (temporalBlend && grainNoise) {
            sendLog(`⏱ Frame Noise: bỏ qua — grainNoise đã bật (tránh stack noise)`, 'info');
        }

        // ── Padding đầu/cuối — lệch toàn bộ timestamp, phá Content ID timeline ──
        // tpad: thêm frame đen trước/sau video
        // adelay + apad: đệm audio khớp với video
        let padVf = '';
        let padStartAf = '';
        let padEndAf   = '';
        let padStartSec = 0;
        let padEndSec   = 0;
        if (videoPad) {
            // tpad is applied AFTER setpts=PTS/varSpeedFactor, so effective frame duration = 1/(targetFps*varSpeedFactor)
            // Use tpad=start=N (exact frame count) instead of start_duration (rounds up → audio ahead)
            // adelay = round(N/effectiveFps*1000) ms matches tpad within <0.5ms
            const effectiveFps = parseFloat(targetFps) * varSpeedFactor;
            const padStartFrames = Math.round((0.3 + Math.random() * 0.5) * effectiveFps);
            const padEndFrames   = Math.round((0.3 + Math.random() * 0.5) * effectiveFps);
            padStartSec = parseFloat((padStartFrames / effectiveFps).toFixed(6));
            padEndSec   = parseFloat((padEndFrames   / effectiveFps).toFixed(6));
            padVf = `,tpad=start=${padStartFrames}:start_mode=add:stop=${padEndFrames}:stop_mode=add`;
            const startMs = Math.round(padStartSec * 1000);
            padStartAf = `,adelay=delays=${startMs}|${startMs}`;
            padEndAf   = `,apad=pad_dur=${padEndSec}`;
            sendLog(`⬛ Padding: +${padStartSec}s (${padStartFrames}f) đầu +${padEndSec}s (${padEndFrames}f) cuối`, 'info');
        }

        // ── Audio Compressor ngẫu nhiên — thay đổi dynamic envelope waveform ───
        // acompressor: nén biên độ theo threshold/ratio ngẫu nhiên
        // Pitch/EQ thay đổi tần số, compressor thay đổi hình dạng waveform theo thời gian
        let compAf = '';
        if (audioCompress) {
            const threshold = -(12 + Math.random() * 6).toFixed(1);   // -12 đến -18 dB — chỉ bắt peaks mạnh
            const ratio     = (1.2 + Math.random() * 0.6).toFixed(1); // 1.2:1 đến 1.8:1 — nhẹ, giữ dynamic
            const attack    = (15 + Math.random() * 15).toFixed(0);   // 15-30ms — không bắt transient
            const release   = (150 + Math.random() * 150).toFixed(0); // 150-300ms — release chậm, không pumping
            const makeup    = (1.5 + Math.random() * 1.0).toFixed(1); // +1.5-2.5dB — bù nhẹ, loudnorm lo phần còn lại
            compAf = `,acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}:makeup=${makeup}`;
            sendLog(`🎛 Compressor: ${threshold}dB / ${ratio}:1 / makeup=+${makeup}dB`, 'info');
        }

        // ── Audio Reverb — echo ngẫu nhiên nhẹ, thay đổi spectral envelope tail ────
        // aecho: in_gain/out_gain/delay/decay — delay ngắn 15-35ms để không nghe thấy tiếng lặp
        let reverbAf = '';
        if (audioReverb) {
            const delay = (8 + Math.random() * 7).toFixed(0);       // 8-15ms — cực ngắn
            const decay = (0.01 + Math.random() * 0.02).toFixed(3); // 0.01-0.03 — gần như không nghe thấy
            reverbAf = `,aecho=0.99:0.5:${delay}:${decay}`;         // out_gain=0.5 — giảm mạnh tiếng vọng
            sendLog(`🔊 Reverb: delay=${delay}ms decay=${decay} — phá spectral tail`, 'info');
        }

        // ── Audio Chorus — phase modulation cực nhẹ ─────────────────────────────
        let chorusAf = '';
        if (audioChorus) {
            const depth = (0.05 + Math.random() * 0.05).toFixed(3); // 0.05-0.10 — cực nhẹ
            const speed = (0.3 + Math.random() * 0.2).toFixed(2);   // 0.3-0.5 Hz
            chorusAf = `,chorus=in_gain=0.99:out_gain=0.99:delays=15:decays=${depth}:speeds=${speed}:depths=${depth}`;
            sendLog(`🎵 Chorus: depth=${depth} speed=${speed}Hz — phá phase pattern`, 'info');
        }

        // ── Brightness/Contrast jitter — thay đổi luminance distribution DCT block ─
        let brightnessVf = '';
        if (brightnessJitter) {
            const br = ((Math.random() * 0.04 - 0.02)).toFixed(4);  // ±0.02
            const ct = (1.0 + (Math.random() * 0.1 - 0.05)).toFixed(4); // 0.95-1.05
            brightnessVf = `,eq=brightness=${br}:contrast=${ct}`;
            sendLog(`💡 Brightness jitter: brightness=${br} contrast=${ct}`, 'info');
        }

        // ── Audio EQ — chỉnh bass/treble ngẫu nhiên ─────────────────────────────
        // equalizer: 2 dải tần số, gain ±2-4dB → waveform khác nhưng tai không nghe rõ
        let eqAf = '';
        if (audioEQ) {
            const bassGain   = ((Math.random() * 1.5 + 1.5) * (Math.random() > 0.5 ? 1 : -1)).toFixed(2); // ±1.5-3dB
            const trebleGain = ((Math.random() * 1.5 + 1.5) * (Math.random() > 0.5 ? 1 : -1)).toFixed(2); // ±1.5-3dB
            const bassFreq   = (80 + Math.floor(Math.random() * 40)).toFixed(0);   // 80-120 Hz
            const trebleFreq = (8000 + Math.floor(Math.random() * 4000)).toFixed(0); // 8-12 kHz
            eqAf = `,equalizer=f=${bassFreq}:t=o:w=1.0:g=${bassGain},equalizer=f=${trebleFreq}:t=o:w=1.0:g=${trebleGain}`;
            sendLog(`🎚 Audio EQ: bass${bassGain > 0 ? '+' : ''}${bassGain}dB@${bassFreq}Hz, treble${trebleGain > 0 ? '+' : ''}${trebleGain}dB@${trebleFreq}Hz`, 'info');
        }

        // ── Audio filter: tất cả trong 1 chuỗi, xử lý cùng video trong 1 filter_complex ──
        let finalAf = cutAf; // asetpts=PTS-STARTPTS — reset audio về 0, khớp với video
        // Resample về 44100Hz trước mọi xử lý — tránh rubberband chạy trên 96kHz gây pre-echo
        finalAf += `,aresample=44100:resampler=swr`;
        // Ép mono trước rubberband: phase vocoder synthesis L/R độc lập → correlation drop về 0 → tiếng vang
        // Nguồn video thường là mono-to-stereo (L≈R), xử lý mono giữ nguyên tính chất âm thanh gốc
        finalAf += `,aformat=channel_layouts=mono`;
        if (pitchShift !== 0) {
            const pitchRatio = Math.pow(2, pitchShift / 12).toFixed(6);
            if (combinedSpeed !== 1.0) {
                // Gộp tempo + pitch vào 1 rubberband call — tránh WSOLA + phase vocoder chạy nối tiếp gây tiếng nhại
                finalAf += `,rubberband=pitch=${pitchRatio}:tempo=${combinedSpeed.toFixed(6)}`;
            } else {
                finalAf += `,rubberband=pitch=${pitchRatio}`;
            }
            // Reset PTS sau rubberband: filter có inherent latency (xử lý theo chunk)
            // → frame đầu output bị delay → audio lag so với video
            finalAf += `,asetpts=N/SR/TB`;
        } else if (combinedSpeed !== 1.0) {
            finalAf += spdAf; // atempo thuần — không có pitch shift, không cần rubberband
        }
        // stereoFlip: swap L↔R → vô nghĩa với mono, bỏ qua
        if (audioEQ) finalAf += eqAf;
        if (audioCompress) finalAf += compAf;
        if (audioReverb) finalAf += reverbAf;
        if (audioChorus) finalAf += chorusAf;
        if (audioVolume !== 100) finalAf += `,volume=${(audioVolume / 100).toFixed(3)}`;
        // loudnorm/dynaudnorm đều có lookahead buffer gây audio trễ so với video — bỏ hẳn
        // rubberband + EQ + compressor ở trên đã xử lý volume đủ, không cần normalize thêm
        // Expand mono → stereo L=R — tương thích player, tránh tiếng vang do L≠R phase divergence
        finalAf += `,aformat=channel_layouts=stereo`;
        if (videoPad) finalAf += `${padStartAf}${padEndAf}`;
        // apad: đảm bảo audio không ngắn hơn video — rubberband có tail latency có thể mất vài frame cuối
        // whole_dur = expectedDur + 0.5s buffer: nếu audio đủ dài thì apad không làm gì, nếu ngắn thì thêm silence
        const expectedAudioDur = parseFloat(((totalVideoDur / combinedSpeed) + padStartSec + padEndSec + 0.5).toFixed(3));
        finalAf += `,apad=whole_dur=${expectedAudioDur}`;
        sendLog(`🔊 Audio filter: ${finalAf}`, 'info');

        // ── Random FPS — áp dụng trong filter chain, KHÔNG dùng -r ở output ────
        // Bug cũ: -r outFps ở output mâu thuẫn với fps=sourceFps trong filter
        // FFmpeg VFR mode (default mới): ghi metadata "outFps" nhưng frames vẫn ở timing sourceFps
        // → video play chậm hơn outFps/sourceFps lần → audio LUÔN chạy trước video
        // Ví dụ: sourceFps=24, outFps=30 → video chậm 20%, sau 5 phút audio lệch 60 giây!
        // Fix: fps filter trong cutVf tạo frames đúng timing outFps từ đầu → output FPS tự khớp
        // -video_track_timescale: fix drift khi targetFps không chuẩn (e.g., 30.05)
        // Vấn đề: MP4 default timescale 90000, 90000/30.05=2993.34 → làm tròn 2993 → video chạy ở
        // 30.073fps thực tế thay vì 30.05fps → lệch 0.077% → sau 120s drift 92ms audio/video
        // Fix: timescale = fps*100 → 3005/30.05=100 chính xác, không có rounding error
        const videoTimescale = Math.round(parseFloat(targetFps) * 100);
        // -r targetFps: báo encoder đúng FPS đầu ra
        // -fps_mode cfr: buộc FFmpeg timestamp đều frames trước khi đưa vào encoder
        //   → AMF/NVENC/QSV nhận frames đã đúng timing → không còn drop frame hay lệch tốc độ
        //   → Thay thế cho workaround CPU fallback cũ
        const randomFpsArgs = ['-r', targetFps, '-fps_mode', 'cfr', '-video_track_timescale', String(videoTimescale)];
        if (randomFps) {
            sendLog(`🎞 FPS ngẫu nhiên: ${targetFps} fps (gốc: ${parseFloat(sourceFps).toFixed(2)}) — timescale=${videoTimescale}`, 'info');
        }

        // cutVf = setpts=PTS-STARTPTS — reset timestamp sau concat demuxer
        // Auto-disable CPU-heavy filters cho 4K output hoặc video dài — vẫn còn 20+ layer chống BQ
        const isHeavyVideo = vidH >= 2160 || duration > 1800;
        const grainVfFinal    = isHeavyVideo ? '' : grainVf;
        const vignetteVfFinal = isHeavyVideo ? '' : vignetteVf;
        if (isHeavyVideo && (grainNoise || vignette)) {
            sendLog(`⚡ 4K output/long: tắt noise+vignette filter để tăng tốc (còn 20+ layer chống BQ khác)`, 'info');
        }
        // zoomFilter đã bao gồm: delogo + crop(source dims) + scale(output dims vidW×vidH)
        const finalVf = `${zoomFilter}${posCropVf},${cutVf}${k4Vf}${colorVf}${brightnessVf}${hueVf}${perspectiveVf}${channelShiftVf}${kbVf}${hflipVf}${rotateVf}${grainVfFinal}${vignetteVfFinal}${spdVf}${subRemoveVf}${wmVf}${padVf}${temporalBlendVf},format=yuv420p`;

        // Dùng concat demuxer (file inpoint/outpoint) làm input thay vì split+trim trong filter_complex
        // Lợi ích: filter_complex chỉ còn post-processing (~10 nodes), không còn 200+ nodes gây OOM
        // concatPath đã ghi sẵn ở trên với inpoint/outpoint của từng segment
        const filterComplex = [
            `[0:v]${finalVf}[vout]`,
            `[0:a]${finalAf}[aout]`,
        ].join(';');
        const useRealNoise = bgNoise && bgNoiseFile && fs.existsSync(bgNoiseFile);
        sendLog(`🔍 [DEBUG] concat demuxer: ${segs.length} segs, totalDur=${totalVideoDur}s | filterComplex: ${filterComplex.substring(0, 200)}...`, 'info');

        // Hard limit ở output: tránh VFR tail bleed (pkt_duration 20-27s của frame cuối source)
        // dù filter nào cũng không diệt được → -t cắt chính xác sau tất cả filter
        // Formula: totalVideoDur/speed + padStart + padEnd + 0.5s buffer (fps quant ≤ 0.05s, VFR ≥ 15s)
        // -t: hard limit khớp chính xác với audio formula (cùng totalVideoDur / speed + pad)
        // Buffer=0: formula giống hệt audio → diff ≈ 0.023s (1 AAC frame) thay vì 20s VFR
        const expectedVideoDur = parseFloat(((totalVideoDur / combinedSpeed) + padStartSec + padEndSec).toFixed(3));
        const durLimitArgs = ['-t', String(expectedVideoDur)];
        sendLog(`🔍 [DEBUG] -t=${expectedVideoDur}s (totalDur=${totalVideoDur}/${combinedSpeed.toFixed(6)} + pad=${padStartSec}+${padEndSec})`, 'info');

        const srcBaseName = path.basename(videoPath, path.extname(videoPath)).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
        const finalFileName = outputFileName || `${srcBaseName}_reup.mp4`;
        const outputPath = path.join(outputFolder, finalFileName);

        // ── Metadata ngẫu nhiên ────────────────────────────────────────────────
        const DEVICES = [
            { make: 'Apple',   model: 'iPhone 15 Pro',      software: 'iOS 17.5.1' },
            { make: 'Samsung', model: 'SM-S928B',           software: 'Android 14' },
            { make: 'Google',  model: 'Pixel 8 Pro',        software: 'Android 14' },
            { make: 'Xiaomi',  model: 'Xiaomi 14 Pro',      software: 'Android 13' },
            { make: 'Apple',   model: 'iPhone 14',          software: 'iOS 17.4.1' },
            { make: 'OPPO',    model: 'CPH2581',            software: 'Android 13' },
        ];
        let metaArgs = ['-map_metadata', '-1'];  // xóa metadata gốc
        if (randomMeta) {
            const dev = DEVICES[Math.floor(Math.random() * DEVICES.length)];
            const randMs  = Math.floor(Math.random() * 180 * 24 * 3600 * 1000);
            const randDate = new Date(Date.now() - randMs).toISOString();
            metaArgs = [
                '-map_metadata', '-1',
                '-metadata', `make=${dev.make}`,
                '-metadata', `model=${dev.model}`,
                '-metadata', `software=${dev.software}`,
                '-metadata', `creation_time=${randDate}`,
                '-metadata', 'encoder=',
                '-metadata', 'comment=',
            ];
            sendLog(`🔒 Metadata giả: ${dev.make} ${dev.model} (${randDate.slice(0,10)})`, 'info');
        }

        // ── Ghi filterComplex ra file để tránh ENAMETOOLONG (Windows limit ~32KB) ──
        // -filter_complex_script đọc từ file, không qua command-line args
        const fcScriptPath = path.join(require('os').tmpdir(), `_fluxy_fc_${Date.now()}_${Math.random().toString(36).slice(2,7)}.txt`);
        fs.writeFileSync(fcScriptPath, filterComplex, 'utf8');
        const fcArgs = ['-filter_complex_script', fcScriptPath];

        // ── Build FFmpeg args ──────────────────────────────────────────────────
        const spawnFfmpeg = (args) => new Promise((resolve, reject) => {
            // -threads 0: tất cả cores cho codec (decode/encode)
            // -filter_threads 0: tất cả cores cho từng filter riêng lẻ (scale, eq, colorchannelmixer...)
            // -filter_complex_threads 0: tất cả cores cho toàn bộ filter graph
            const p = spawn(ffmpegPath, ['-threads', '0', '-filter_threads', '0', '-filter_complex_threads', '0', ...args], { windowsHide: true });
            const errChunks = [];   // giữ toàn bộ stderr để debug
            let lastLogTime = 0;
            let lastTimeStr = '';
            p.stderr.on('data', d => {
                const chunk = d.toString();
                errChunks.push(chunk);
                // Throttle progress log: mỗi 4 giây 1 lần
                const now = Date.now();
                if (now - lastLogTime >= 4000) {
                    const m = chunk.match(/time=(\d+:\d+:\d+\.\d+)/g);
                    if (m) { lastTimeStr = m[m.length - 1]; sendLog(`⏳ ${lastTimeStr}`, 'progress', 3); lastLogTime = now; }
                }
            });
            p.on('close', code => {
                if (code === 0) return resolve();
                const fullErr = errChunks.join('');
                // Lấy dòng lỗi thực sự: tìm "Error" hoặc "Invalid" hoặc "failed"
                const errLines = fullErr.split('\n').filter(l => /error|invalid|failed|cannot|unable/i.test(l)).slice(-8).join(' | ');
                reject(new Error(`FFmpeg exit ${code}: ${errLines || fullErr.slice(-500)}`));
            });
            p.on('error', reject);
        });

        // Dùng concat demuxer làm input chính — trim đã xử lý ở demux level
        // hwaccel d3d11va không hoạt động tốt với AV1 trên AMD + concat demuxer → bỏ
        const concatInputArgs = ['-f', 'concat', '-safe', '0', '-i', concatPath];

        if (bgNoise) {
            // bgNoise cần pass riêng để mix noise — video+audio đã sync từ pass 1
            const tempPath = outputPath.replace(/\.mp4$/, '_tmp.mp4');
            sendLog('🎬 Pass 1/2: Xử lý video + audio...', 'info', 3);
            await spawnFfmpeg([
                ...concatInputArgs,
                ...fcArgs,
                '-map', '[vout]', '-map', '[aout]',
                ...encArgs, ...randomFpsArgs, ...durLimitArgs, '-y', tempPath,
            ]);
            sendLog('🔊 Pass 2/2: Trộn tiếng ồn nền...', 'info', 3);
            let pass2Fc, pass2Inputs;
            if (useRealNoise) {
                const noiseVol = (bgNoiseLevel * 0.01).toFixed(4);
                pass2Fc = `[0:a]volume=1[amain];[1:a]volume=${noiseVol}[anoise];[amain][anoise]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
                pass2Inputs = ['-i', tempPath, '-i', bgNoiseFile];
                sendLog(`🎵 Trộn âm thanh thực: ${path.basename(bgNoiseFile)} vol=${bgNoiseLevel}%`, 'info');
            } else {
                const noiseAmp = (bgNoiseLevel * 0.005).toFixed(5);
                const safeColor = (bgNoiseColor === 'brown') ? 'brown' : 'pink';
                // mono noise → amerge stereo đồng nhất: tránh 2 kênh noise độc lập tạo stereo width → tiếng vang giả
                pass2Fc = `[0:a]volume=1[amain];anoisesrc=color=${safeColor}:amplitude=${noiseAmp}:r=44100,aformat=channel_layouts=mono[nmono];[nmono]asplit[n0][n1];[n0][n1]amerge=inputs=2[anoise];[amain][anoise]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
                pass2Inputs = ['-i', tempPath];
            }
            await spawnFfmpeg([
                ...pass2Inputs, '-filter_complex', pass2Fc,
                '-map', '0:v', '-map', '[aout]',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                ...metaArgs, '-movflags', '+faststart', '-y', outputPath,
            ]);
            try { fs.unlinkSync(`\\\\?\\${tempPath}`); } catch(_) { try { fs.unlinkSync(tempPath); } catch(_2) {} }
        } else {
            await spawnFfmpeg([
                ...concatInputArgs,
                ...fcArgs,
                '-map', '[vout]', '-map', '[aout]',
                ...encArgs, ...randomFpsArgs, ...metaArgs, ...durLimitArgs, '-movflags', '+faststart', '-y', outputPath,
            ]);
        }
        // ── Dọn dẹp toàn bộ file tạm sau khi hoàn thành ────────────────────────
        const cleanLong = (p) => {
            if (!p) return;
            try { fs.unlinkSync(`\\\\?\\${p}`); } catch(_) {
                try { fs.unlinkSync(p); } catch(_2) {}
            }
        };
        const cleanDirLong = (p) => {
            if (!p) return;
            try { fs.rmSync(`\\\\?\\${p}`, { recursive: true, force: true }); } catch(_) {
                try { fs.rmSync(p, { recursive: true, force: true }); } catch(_2) {}
            }
        };
        cleanLong(fcScriptPath);                                    // _fc_*.txt
        cleanLong(concatPath);                                      // _segs_*.txt
        cleanDirLong(tempDir);                                      // _rc_tmp_*/ (frames)
        cleanLong(outputPath.replace(/\.mp4$/, '_tmp.mp4'));        // *_tmp.mp4 legacy
        // Quét sạch mọi file _segs_*.txt và thư mục _rc_tmp_* còn sót trong outputFolder
        try {
            for (const f of fs.readdirSync(outputFolder)) {
                const fp = path.join(outputFolder, f);
                if (f.startsWith('_segs_') && f.endsWith('.txt')) cleanLong(fp);
                if (f.startsWith('_rc_tmp_')) cleanDirLong(fp);
            }
        } catch(_) {}

        // Auto-check video vs audio duration để verify sync (non-fatal)
        try {
            // Dùng \\?\ prefix để ffprobe đọc đúng path Unicode/dài trên Windows
            const probePath = outputPath.startsWith('\\\\?\\') ? outputPath : `\\\\?\\${outputPath}`;
            const probeV = await new Promise((res) => {
                const p = spawn(ffprobePath, ['-v','error','-select_streams','v:0','-show_entries','stream=duration','-of','csv=p=0', probePath]);
                let o=''; p.stdout.on('data',d=>o+=d); p.on('close',()=>res(parseFloat(o)||0)); p.on('error',()=>res(0));
            });
            const probeA = await new Promise((res) => {
                const p = spawn(ffprobePath, ['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','csv=p=0', probePath]);
                let o=''; p.stdout.on('data',d=>o+=d); p.on('close',()=>res(parseFloat(o)||0)); p.on('error',()=>res(0));
            });
            if (probeV > 0 || probeA > 0) {
                const diff = Math.abs(probeV - probeA);
                const status = diff < 0.1 ? '✅ SYNC OK' : `⚠ SYNC LỆCH ${diff.toFixed(3)}s`;
                sendLog(`📊 ${status} — video=${probeV.toFixed(3)}s audio=${probeA.toFixed(3)}s diff=${diff.toFixed(3)}s`, diff < 0.1 ? 'info' : 'warn');
            }
        } catch(_) {}
        // ── RVC Voice Conversion (post-process) ────────────────────────────────
        if (rvcEnabled) {
            sendLog('🎤 Voice Transform: Đang biến đổi audio...', 'info');
            const py = RvcEngine.findPython();
            if (!py) throw new Error('Voice Transform: Python không tìm thấy — cài Python 3.10+ từ python.org');

            const rvcAudioIn  = outputPath.replace(/\.mp4$/, '_vt_in.wav');
            const rvcAudioOut = outputPath.replace(/\.mp4$/, '_vt_out.wav');
            const rvcFinal    = outputPath.replace(/\.mp4$/, '_vt_final.mp4');

            // Trích xuất audio từ video đã recreate
            await spawnFfmpeg(['-i', outputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-y', rvcAudioIn]);

            // Chạy voice transform (pedalboard)
            await RvcEngine.runInfer(py, {
                input:    rvcAudioIn,
                output:   rvcAudioOut,
                model:    '',
                index:    '',
                pitch:    rvcPitch || 0,
                f0Method: rvcF0Method || 'medium', // mode: light/medium/strong
            }, sendLog);

            // Ghép audio mới vào video
            await spawnFfmpeg([
                '-i', outputPath, '-i', rvcAudioOut,
                '-c:v', 'copy', '-map', '0:v', '-map', '1:a',
                '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-y', rvcFinal,
            ]);

            // Thay thế file output
            try { fs.unlinkSync(outputPath); } catch(_) {}
            fs.renameSync(rvcFinal, outputPath);

            // Dọn file tạm
            try { fs.unlinkSync(rvcAudioIn);  } catch(_) {}
            try { fs.unlinkSync(rvcAudioOut); } catch(_) {}

            sendLog('✅ RVC: Chuyển đổi giọng hoàn tất — fingerprint audio đã thay đổi', 'success');
        }

        sendLog(`✅ Hoàn tất! File: ${outputPath}`, 'success', 5);

        // ── Dọn dẹp file thừa sau khi thành công ─────────────────────────────
        const delLong = (p) => {
            try {
                if (!p) return;
                const longP = p.startsWith('\\\\?\\') ? p : `\\\\?\\${p}`;
                if (fs.existsSync(longP)) fs.unlinkSync(longP);
            } catch(_) {}
        };
        try { if (typeof tempDir !== 'undefined') fs.rmSync(`\\\\?\\${tempDir}`, { recursive: true, force: true }); } catch(_) {}
        if (typeof fcScriptPath !== 'undefined') delLong(fcScriptPath);
        if (typeof concatPath !== 'undefined') delLong(concatPath);
        // Xóa file _tmp.mp4 trung gian nếu còn sót
        if (typeof outputPath !== 'undefined') delLong(outputPath.replace(/\.mp4$/, '_tmp.mp4'));

        return { ok: true, path: outputPath, logoRegions, detectedImgW, detectedImgH };
    } catch(e) {
        sendLog(`❌ Lỗi: ${e.message}\n${e.stack?.split('\n').slice(0,3).join(' | ')}`, 'error');
        const delLong = (p) => {
            try {
                if (!p) return;
                const longP = p.startsWith('\\\\?\\') ? p : `\\\\?\\${p}`;
                if (require('fs').existsSync(longP)) require('fs').unlinkSync(longP);
            } catch(_) {}
        };
        if (typeof fcScriptPath !== 'undefined') delLong(fcScriptPath);
        if (typeof concatPath !== 'undefined') delLong(concatPath);
        if (typeof outputPath !== 'undefined') {
            delLong(outputPath.replace(/\.mp4$/, '_tmp.mp4'));
            // Chỉ xóa output nếu file không tồn tại hoặc rỗng (0 byte) — tránh xóa file đã render xong
            try {
                const outStat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
                if (!outStat || outStat.size === 0) delLong(outputPath);
            } catch(_) {}
        }
        try { if (typeof tempDir !== 'undefined') fs.rmSync(`\\\\?\\${tempDir}`, { recursive: true, force: true }); } catch(_) {}
        return { ok: false, error: e.message };
    }
});

// ── Xóa file tạm (stock_raw, ...) ────────────────────────────────────────────
ipcMain.handle('fs:delete-file', async (event, filePath) => {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fs:rename-file', async (event, { from, to }) => {
    try {
        if (!fs.existsSync(from)) return { success: false, error: 'Source not found' };
        // Thử rename trước (nhanh, cùng ổ đĩa)
        try {
            fs.renameSync(from, to);
            return { success: true };
        } catch (_) {}
        // Fallback: copy + delete (khác ổ đĩa hoặc path Unicode)
        fs.copyFileSync(from, to);
        try { fs.unlinkSync(from); } catch(_) {}
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── RVC: kiểm tra Python + rvc-python ────────────────────────────────────────
ipcMain.handle('rvc:check', async () => {
    const py = RvcEngine.findPython();
    if (!py) return { ok: false, error: 'Python không tìm thấy — cài Python 3.10+ từ python.org' };
    try {
        const res = await RvcEngine.checkDeps(py, null);
        return { ok: true, ...res };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// ── RVC: cài rvc-python + torch qua pip ──────────────────────────────────────
ipcMain.handle('rvc:install', async () => {
    const py = RvcEngine.findPython();
    if (!py) return { ok: false, error: 'Python không tìm thấy — cài Python 3.10+ từ python.org' };
    const sendLog = (msg, type = 'info') => mainWindow?.webContents.send('video-recreate-log', { msg, type });
    try {
        await RvcEngine.installDeps(py, sendLog);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// ── RVC: chọn file model .pth ─────────────────────────────────────────────────
ipcMain.handle('rvc:browse-model', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Chọn model RVC (.pth)',
        filters: [{ name: 'RVC Model', extensions: ['pth'] }],
        properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
});

// ── RVC: chọn file index .index (tuỳ chọn) ────────────────────────────────────
ipcMain.handle('rvc:browse-index', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Chọn file index RVC (.index) — tuỳ chọn',
        filters: [{ name: 'RVC Index', extensions: ['index'] }],
        properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
});

// ── Tạo thư mục ──────────────────────────────────────────────────────────────
ipcMain.handle('fs:create-folder', async (event, folderPath) => {
    try {
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

// ── Liệt kê files trong thư mục (để xóa stock clips sau merge) ──────────────
ipcMain.handle('fs:list-files', async (event, folderPath) => {
    try {
        if (!fs.existsSync(folderPath)) return { success: true, files: [] };
        const files = fs.readdirSync(folderPath).map(f => path.join(folderPath, f));
        return { success: true, files };
    } catch (e) { return { success: false, error: e.message, files: [] }; }
});

ipcMain.handle('fs:read-text-file', async (_e, filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { success: true, content };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('fs:read-file', async (_e, filePath) => {
    try { return fs.readFileSync(filePath, 'utf8'); } catch(e) { return null; }
});
ipcMain.handle('fs:read-file-base64', async (_e, filePath) => {
    try {
        const buf = fs.readFileSync(filePath);
        return buf.toString('base64');
    } catch (e) { return null; }
});

// ── NÉN AUDIO CHO TRANSCRIBE GEMINI (mono 16kHz 32kbps MP3 → ~14MB/giờ) ──────
ipcMain.handle('audio:compress-for-transcribe', async (_e, { inputPath }) => {
    try {
        const tmpOut = path.join(app.getPath('userData'), `compress_${Date.now()}.mp3`);
        await runFFmpeg([
            '-y', '-i', inputPath,
            '-ac', '1',           // mono
            '-ar', '16000',       // 16kHz — đủ cho speech recognition
            '-b:a', '32k',        // 32kbps → ~14MB/giờ audio
            '-map_metadata', '-1',
            tmpOut
        ]);
        const buf = fs.readFileSync(tmpOut);
        // Lấy duration của audio gốc
        let duration = 0;
        try {
            const probe = require('child_process').spawnSync(require('ffprobe-static').path,
                ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', inputPath]);
            duration = parseFloat(probe.stdout?.toString().trim()) || 0;
        } catch (_) {}
        try { fs.unlinkSync(tmpOut); } catch (_) {}
        return { success: true, base64: buf.toString('base64'), size: buf.length, duration };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ── NÉN VIDEO CHO UPLOAD GEMINI (480p, audio mono 32k, crf 40 → ~1-2MB/clip) ─
ipcMain.handle('video:compress-for-upload', async (_e, { inputPath, outputPath }) => {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const result = await runFFmpeg([
            '-y', '-i', inputPath,
            '-vf', "scale='min(480,iw)':-2",
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40',
            '-c:a', 'aac', '-b:a', '32k', '-ac', '1', '-ar', '22050', // mono 32k — AI cần nghe lời thoại
            '-movflags', '+faststart',
            outputPath,
        ]);
        if (result.ok && fs.existsSync(outputPath)) {
            const { size } = fs.statSync(outputPath);
            return { success: true, outputPath, sizeMB: (size / 1024 / 1024).toFixed(1) };
        }
        return { success: false, error: result.stderr?.slice(-300) };
    } catch (e) { return { success: false, error: e.message }; }
});

const _findYtDlpBin = () => {
    const local = path.join(app.getPath('userData'), 'tools', 'yt-dlp.exe');
    if (fs.existsSync(local)) return local;
    try { const r = path.join(process.resourcesPath, 'yt-dlp.exe'); if (fs.existsSync(r)) return r; } catch (_) {}
    return null;
};

// Tự động download yt-dlp nếu chưa có, trả về path
const _ytdlpAutoInstalling = { promise: null };
let _currentYtDlProc = null;
ipcMain.handle('youtube:abort-download', () => { if (_currentYtDlProc?._abort) _currentYtDlProc._abort(); });
const _ensureYtDlpBin = () => {
    const found = _findYtDlpBin();
    if (found) return Promise.resolve(found);
    // Tránh download 2 lần song song
    if (_ytdlpAutoInstalling.promise) return _ytdlpAutoInstalling.promise;
    const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    const dest = path.join(app.getPath('userData'), 'tools', 'yt-dlp.exe');
    const https = require('https');
    const http  = require('http');
    const downloadWithRedirect = (url, toPath, hops = 0) => new Promise((resolve, reject) => {
        if (hops > 10) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { timeout: 180000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
                return downloadWithRedirect(res.headers.location, toPath, hops + 1).then(resolve).catch(reject);
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const file = require('fs').createWriteStream(toPath);
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve(toPath)));
            file.on('error', reject);
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
    });
    try { require('fs').mkdirSync(path.join(app.getPath('userData'), 'tools'), { recursive: true }); } catch (_) {}
    _ytdlpAutoInstalling.promise = downloadWithRedirect(YTDLP_URL, dest)
        .then(p => { _ytdlpAutoInstalling.promise = null; return p; })
        .catch(e => { _ytdlpAutoInstalling.promise = null; throw e; });
    return _ytdlpAutoInstalling.promise;
};

// ── BILIBILI SEARCH & DOWNLOAD ────────────────────────────────────────────────
ipcMain.handle('bilibili:search', async (_e, { keyword, page = 1 }) => {
    const { BrowserWindow: BW, session: electronSession } = require('electron');
    const biliSession = electronSession.fromPartition('persist:bilibili', { cache: true });

    // Set UA
    try {
        biliSession.webRequest.onBeforeSendHeaders((details, cb) => {
            const h = { ...details.requestHeaders };
            h['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
            h['Accept-Language'] = 'zh-CN,zh;q=0.9';
            cb({ requestHeaders: h });
        });
    } catch (_) {}

    const searchUrl = `https://search.bilibili.com/video?keyword=${encodeURIComponent(keyword)}&page=${page}&order=totalrank`;

    let win = null;
    try {
        win = new BW({
            width: 1280, height: 900,
            show: false, skipTaskbar: true,
            webPreferences: { session: biliSession, nodeIntegration: false, contextIsolation: true },
        });
        win.webContents.setAudioMuted(true);

        await win.loadURL(searchUrl);
        // Chờ React render xong
        await new Promise(r => setTimeout(r, 3000));

        const items = await win.webContents.executeJavaScript(`
            (function() {
                const results = [];
                const seen = new Set();

                // Bilibili search result cards
                const cards = document.querySelectorAll(
                    '.bili-video-card, .search-video-card, [class*="video-item"], [class*="card-box"], li[class*="video"]'
                );

                for (const card of cards) {
                    // Link + bvid
                    const a = card.querySelector('a[href*="/video/BV"], a[href*="/video/av"]');
                    if (!a) continue;
                    const m = (a.href || '').match(/\\/video\\/(BV\\w+|av\\d+)/);
                    if (!m) continue;
                    const bvid = m[1];
                    if (seen.has(bvid)) continue;
                    seen.add(bvid);

                    // Thumbnail
                    const img = card.querySelector('img[src], img[data-src]');
                    let thumbnail = img?.src || img?.dataset?.src || img?.getAttribute('data-v-src') || '';
                    if (thumbnail && !thumbnail.startsWith('http')) thumbnail = 'https:' + thumbnail;

                    // Title
                    const titleEl = card.querySelector('[class*="title"], h3, .bili-video-card__info--tit');
                    const title = (titleEl?.textContent || a.textContent || '').trim();

                    // Duration
                    const durEl = card.querySelector('[class*="duration"], [class*="time"], .bili-video-card__stats--duration');
                    let duration = 0;
                    if (durEl) {
                        const parts = durEl.textContent.trim().split(':').map(Number);
                        if (parts.length === 2) duration = parts[0]*60 + parts[1];
                        else if (parts.length === 3) duration = parts[0]*3600 + parts[1]*60 + parts[2];
                    }

                    // Author + mid
                    const authorEl = card.querySelector('[class*="author"], [class*="up-name"], [class*="uploader"]');
                    const author = authorEl?.textContent?.trim() || '';
                    const authorA = card.querySelector('a[href*="space.bilibili.com"]');
                    const midMatch = (authorA?.href || '').match(/space\\.bilibili\\.com\\/(\\d+)/);
                    const mid = midMatch ? midMatch[1] : '';

                    // Play count
                    const playEl = card.querySelector('[class*="play"],[class*="view"],[class*="stat"]');
                    const playText = playEl?.textContent?.trim() || '';
                    let play = 0;
                    if (playText) {
                        const t = playText.replace(/[^0-9.万亿]/g, '');
                        if (playText.includes('万')) play = parseFloat(t) * 10000;
                        else if (playText.includes('亿')) play = parseFloat(t) * 100000000;
                        else play = parseInt(t) || 0;
                    }

                    results.push({
                        bvid,
                        url: 'https://www.bilibili.com/video/' + bvid,
                        title, thumbnail, duration, author, mid, play
                    });
                    if (results.length >= 20) break;
                }
                return results;
            })();
        `);

        win.close(); win = null;

        if (items && items.length > 0) return { items };

        // Fallback: thử intercept XHR từ trang (lấy từ window.__INITIAL_STATE__ hoặc API response)
        return { error: 'Không tìm thấy video. Bilibili có thể đã thay đổi cấu trúc trang.' };

    } catch (e) {
        if (win && !win.isDestroyed()) win.close();
        return { error: `Lỗi: ${e.message}` };
    }
});

ipcMain.handle('bilibili:channelVideos', async (_e, { mid, page = 1 }) => {
    const { BrowserWindow: BW, session: electronSession } = require('electron');
    const biliSession = electronSession.fromPartition('persist:bilibili', { cache: true });
    const channelUrl = `https://space.bilibili.com/${mid}/video?tid=0&page=${page}&keyword=&order=pubdate`;
    let win = null;
    try {
        win = new BW({
            width: 1280, height: 900,
            show: false, skipTaskbar: true,
            webPreferences: { session: biliSession, nodeIntegration: false, contextIsolation: true },
        });
        win.webContents.setAudioMuted(true);
        await win.loadURL(channelUrl);
        await new Promise(r => setTimeout(r, 3500));
        const data = await win.webContents.executeJavaScript(`
            (function() {
                const results = [];
                const seen = new Set();
                const cards = document.querySelectorAll('.bili-video-card, [class*="small-item"], [class*="video-item"]');
                for (const card of cards) {
                    const a = card.querySelector('a[href*="/video/BV"]');
                    if (!a) continue;
                    const m = (a.href || '').match(/\\/video\\/(BV\\w+)/);
                    if (!m || seen.has(m[1])) continue;
                    seen.add(m[1]);
                    const img = card.querySelector('img');
                    let thumbnail = img?.src || img?.dataset?.src || '';
                    if (thumbnail && !thumbnail.startsWith('http')) thumbnail = 'https:' + thumbnail;
                    const titleEl = card.querySelector('[class*="title"], h3');
                    const title = (titleEl?.textContent || a.title || '').trim();
                    const durEl = card.querySelector('[class*="duration"], [class*="length"]');
                    let duration = 0;
                    if (durEl) {
                        const parts = durEl.textContent.trim().split(':').map(Number);
                        if (parts.length === 2) duration = parts[0]*60 + parts[1];
                        else if (parts.length === 3) duration = parts[0]*3600 + parts[1]*60 + parts[2];
                    }
                    results.push({ bvid: m[1], url: 'https://www.bilibili.com/video/' + m[1], title, thumbnail, duration });
                }
                // Lấy tên kênh
                const nameEl = document.querySelector('.name, [class*="username"], [class*="user-name"]');
                const channelName = nameEl?.textContent?.trim() || '';
                // Tổng số trang
                const totalEl = document.querySelector('[class*="be-pager-total"]');
                const totalText = totalEl?.textContent || '';
                const totalMatch = totalText.match(/\\d+/);
                const totalPages = totalMatch ? parseInt(totalMatch[0]) : 1;
                return { results, channelName, totalPages };
            })();
        `);
        win.close(); win = null;
        if (data?.results?.length > 0) return { items: data.results, channelName: data.channelName, totalPages: data.totalPages };
        return { error: 'Không tìm thấy video trong kênh này.' };
    } catch (e) {
        if (win && !win.isDestroyed()) win.close();
        return { error: e.message };
    }
});

ipcMain.handle('bilibili:download', async (_e, { url, outputFolder, quality = 'best', bvid }) => {
    let ytdlpPath;
    try { ytdlpPath = await _ensureYtDlpBin(); } catch (e) { return { success: false, error: `Không tải được yt-dlp: ${e.message}` }; }

    // Ưu tiên H.264 (avc1) — tương thích mọi máy Windows, tránh HEVC cần mua codec
    const h = quality === 'best' ? '' : `[height<=${quality}]`;
    const qualityFormat = [
        `bestvideo[vcodec^=avc1]${h}+bestaudio/bestvideo[vcodec^=avc]${h}+bestaudio`,
        `bestvideo[ext=mp4]${h}+bestaudio[ext=m4a]/bestvideo${h}+bestaudio`,
        `best${h}`,
    ].join('/');

    const outputTemplate = path.join(outputFolder, '%(title)s.%(ext)s');
    const args = [
        url,
        '-f', qualityFormat,
        '-o', outputTemplate,
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--newline',
    ];

    return new Promise((resolve) => {
        const proc = spawn(ytdlpPath, args, { windowsHide: true });
        let stderr = '';
        let outputFilePath = '';

        const parseProgress = (line) => {
            const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\s*\S+\/s)\s+ETA\s+(\S+)/);
            if (m) {
                try {
                    _e.sender.send('downloader:progress', {
                        _sourceId: bvid,
                        percent: parseFloat(m[1]),
                        speed: m[2],
                        eta: m[3],
                    });
                } catch (_) {}
            }
            // Ghi nhận đường dẫn file từ [Merger] hoặc [download] Destination
            const destM = line.match(/(?:\[Merger\] Merging formats into|Destination:)\s+"?(.+\.mp4)"?/);
            if (destM) outputFilePath = destM[1].trim().replace(/^"|"$/g, '');
        };

        proc.stdout.on('data', d => d.toString().split('\n').forEach(parseProgress));
        proc.stderr.on('data', d => {
            const txt = d.toString();
            stderr += txt;
            txt.split('\n').forEach(parseProgress);
        });

        proc.on('close', code => {
            if (code === 0) {
                // Tìm file .mp4 mới nhất trong outputFolder
                let finalPath = outputFilePath;
                if (!finalPath || !fs.existsSync(finalPath)) {
                    try {
                        const files = fs.readdirSync(outputFolder)
                            .filter(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'))
                            .map(f => ({ f, t: fs.statSync(path.join(outputFolder, f)).mtimeMs }))
                            .sort((a, b) => b.t - a.t);
                        if (files.length > 0) finalPath = path.join(outputFolder, files[0].f);
                    } catch (_) {}
                }
                resolve({ success: true, outputPath: finalPath });
            } else {
                resolve({ success: false, error: stderr.split('\n').find(l => l.includes('ERROR:'))?.replace('ERROR: ','') || stderr.slice(-300) || `Exit ${code}` });
            }
        });
        proc.on('error', e => resolve({ success: false, error: e.message }));
    });
});

// ── YOUTUBE CHANNEL FETCHER ───────────────────────────────────────────────────
ipcMain.handle('youtube:channel-videos', async (_e, { channelUrl, limit = 50 }) => {
    let ytdlpPath;
    try { ytdlpPath = await _ensureYtDlpBin(); } catch (e) { return { success: false, error: `Không tải được yt-dlp: ${e.message}` }; }

    // Lấy tên kênh bằng query riêng (--print playlist_uploader lấy 1 entry đủ nhanh)
    const getChannelName = () => new Promise(res => {
        const p = spawn(ytdlpPath, [
            '--flat-playlist', '--playlist-end', '1', '--no-warnings',
            '--print', '%(uploader)s\n%(channel)s',
            channelUrl,
        ], { windowsHide: true });
        let o = '';
        const t = setTimeout(() => { try { p.kill(); } catch(_) {} res(''); }, 15000);
        p.stdout.on('data', d => o += d.toString());
        p.on('close', () => {
            clearTimeout(t);
            const names = o.trim().split('\n').map(s => s.trim()).filter(s => s && s !== 'NA');
            res(names[0] || '');
        });
        p.on('error', () => { clearTimeout(t); res(''); });
    });

    const args = [
        '--flat-playlist',
        '--print', '%(id)s|||%(title)s|||%(duration)s|||%(view_count)s|||%(thumbnail)s|||%(upload_date)s',
        '--playlist-end', String(limit),
        '--no-warnings',
        channelUrl,
    ];

    // Chạy song song: lấy danh sách video + lấy tên kênh
    return new Promise(resolve => {
        const channelNamePromise = getChannelName();
        const proc = spawn(ytdlpPath, args, { windowsHide: true });
        let out = '', err = '';
        const timer = setTimeout(() => { try { proc.kill(); } catch(_) {} resolve({ success: false, error: 'Timeout 60s. Kiểm tra URL kênh.' }); }, 60000);
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', async () => {
            clearTimeout(timer);
            if (!out.trim()) return resolve({ success: false, error: err.slice(-300) || 'Không lấy được danh sách.' });
            const videos = out.trim().split('\n')
                .map(line => {
                    const [id, title, dur, views, , date] = line.split('|||');
                    const vid = id?.trim();
                    return {
                        id: vid,
                        title: title?.trim() || '(no title)',
                        duration: parseInt(dur) || 0,
                        views: parseInt(views) || 0,
                        thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '',
                        uploadDate: date?.trim() || '',
                        url: `https://www.youtube.com/watch?v=${vid}`,
                    };
                })
                .filter(v => v.id && v.id !== 'NA');
            const channelName = await channelNamePromise;
            resolve({ success: true, videos, channelName });
        });
        proc.on('error', e => { clearTimeout(timer); resolve({ success: false, error: e.message }); });
    });
});

ipcMain.handle('youtube:download-best', async (_e, { url, outputDir, videoId, quality = 'best' }) => {
    let ytdlpPath;
    try { ytdlpPath = await _ensureYtDlpBin(); } catch (e) { return { success: false, error: `Không tải được yt-dlp: ${e.message}` }; }

    const h = (quality && quality !== 'best') ? `[height<=${quality}]` : '';
    const qualityFormat = [
        `bestvideo[vcodec^=avc1]${h}+bestaudio/bestvideo[vcodec^=avc]${h}+bestaudio`,
        `bestvideo[ext=mp4]${h}+bestaudio[ext=m4a]/bestvideo${h}+bestaudio`,
        `best${h}`,
    ].join('/');
    const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');

    const isBotBlock = (s) => s && (s.includes('Sign in') || s.includes('bot') || s.includes('confirm you') || s.includes('cookies'));

    const buildArgs = (withCookies = false) => {
        const a = [
            url, '-f', qualityFormat,
            '-o', outputTemplate,
            '--merge-output-format', 'mp4',
            '--no-playlist', '--newline',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            '--extractor-args', 'youtube:player_client=web,default',
            '--retries', '5', '--fragment-retries', '5',
        ];
        if (withCookies) a.push('--cookies-from-browser', 'chrome');
        return a;
    };

    const runProc = (args) => new Promise(resolve => {
        const proc = spawn(ytdlpPath, args, { windowsHide: true });
        _currentYtDlProc = proc;
        let stderr = '', outputFilePath = '', aborted = false;

        const parseLine = (line) => {
            const pm = line.match(/\[download\]\s+([\d.]+)%\s+of\s+[\d.~]+\S+\s+at\s+([\d.]+\s*\S+\/s)\s+ETA\s+(\S+)/);
            if (pm) { try { _e.sender.send('youtube:download-progress', { videoId, percent: parseFloat(pm[1]), speed: pm[2], eta: pm[3] }); } catch(_) {} }
            const dm = line.match(/(?:\[Merger\] Merging formats into|Destination:)\s+"?(.+\.mp4)"?/);
            if (dm) outputFilePath = dm[1].trim().replace(/^"|"$/g, '');
        };

        proc.stdout.on('data', d => d.toString().split('\n').forEach(parseLine));
        proc.stderr.on('data', d => { const t = d.toString(); stderr += t; t.split('\n').forEach(parseLine); });
        proc.on('close', code => {
            _currentYtDlProc = null;
            if (aborted) { resolve({ success: false, error: 'aborted', aborted: true }); return; }
            if (code === 0) {
                let finalPath = outputFilePath;
                if (!finalPath || !fs.existsSync(finalPath)) {
                    try {
                        const files = fs.readdirSync(outputDir)
                            .filter(f => /\.(mp4|mkv|webm)$/i.test(f))
                            .map(f => ({ f, t: fs.statSync(path.join(outputDir, f)).mtimeMs }))
                            .sort((a, b) => b.t - a.t);
                        if (files.length) finalPath = path.join(outputDir, files[0].f);
                    } catch(_) {}
                }
                resolve({ success: true, outputPath: finalPath });
            } else {
                const errLine = stderr.split('\n').find(l => l.includes('ERROR:'))?.replace('ERROR: ','') || stderr.slice(-400) || `Exit ${code}`;
                resolve({ success: false, error: errLine, botBlock: isBotBlock(stderr) });
            }
        });
        proc.on('error', e => { _currentYtDlProc = null; resolve({ success: false, error: e.message }); });
        proc._abort = () => { aborted = true; try { proc.kill('SIGTERM'); } catch(_) {} };
    });

    // Lần 1: không cookie
    let result = await runProc(buildArgs(false));
    if (!result.success && !result.aborted && result.botBlock) {
        // Bị bot-check → thử lại với cookie Chrome
        try { _e.sender.send('youtube:download-progress', { videoId, percent: 0, speed: '', eta: '🍪 Bị bot-check → thử lại với cookie Chrome...' }); } catch(_) {}
        result = await runProc(buildArgs(true));
        // Nếu Chrome không có cookie → thử Edge
        if (!result.success && !result.aborted && result.botBlock) {
            const edgeArgs = buildArgs(false);
            edgeArgs.push('--cookies-from-browser', 'edge');
            result = await runProc(edgeArgs);
        }
    }
    return result;
});

// ── STORY LOOP: Veo single generate ──────────────────────────────────────────
// Tạo 1 video ngắn từ 1 prompt để dùng làm background loop
ipcMain.handle('veo:generate-single', async (event, { prompt, duration, aspectRatio, taskId, model, outputFolder: callerFolder }) => {
  try {
    const outputFolder = callerFolder || path.join(app.getPath('documents'), 'GrokStudio_Downloads', 'StoryLoop');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    const tid = taskId || `storyloop_${Date.now()}`;
    const logs = [];
    const sendLog = (msg) => {
      logs.push(msg);
      mainWindow?.webContents?.send('storyloop:log', { taskId: tid, msg });
      // Forward sang mc-studio:log để MCStudioPanel cũng nhận được
      if (taskId?.startsWith('mc_') || taskId?.startsWith('bg_') || taskId?.startsWith('vmc_')) {
        mainWindow?.webContents?.send('mc-studio:log', { taskId: tid, msg });
      }
    };

    const veoResult = await VeoEngine.run({
      mediaType: 'text-to-video',
      tasks: [{ id: tid, prompt, duration: duration || '8s', aspectRatio: aspectRatio || '16:9' }],
      aspectRatio: aspectRatio || '16:9',
      model: model || 'Veo 3.1 - Lite [Lower Priority]',
      genCount: 1,
      quality: '1K',
      outputFolder,
      duration: duration || '8s',
    }, sendLog);

    if (!veoResult?.success) return { success: false, error: veoResult?.error || 'Veo thất bại' };
    const files = Array.isArray(veoResult.files) ? veoResult.files : [];
    const good = files.find(r => !r.isError && (r.filePath || r.videoPath));
    if (!good) {
      const err = files.find(r => r.isError)?.error || 'Veo không tạo được video';
      return { success: false, error: err };
    }
    return { success: true, videoPath: good.filePath || good.videoPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── STORY LOOP: ffmpeg loop video để khớp audio duration ─────────────────────
ipcMain.handle('ffmpeg:loop-video-for-audio', async (event, { videoPath, audioPath, outputPath }) => {
  const { spawn: spawnSync } = require('child_process');
  const ffmpegBin = require('ffmpeg-static');
  const ffprobeBin = require('ffprobe-static').path;
  const os = require('os');

  try {
    // Lấy duration của audio
    const audioDur = await new Promise((resolve) => {
      const p = spawnSync(ffprobeBin, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath]);
      let out = '';
      p.stdout.on('data', d => out += d);
      p.on('close', () => resolve(parseFloat(out.trim()) || 0));
      p.on('error', () => resolve(0));
    });

    if (!audioDur) return { success: false, error: 'Không đọc được duration audio' };

    // Lấy duration video gốc
    const videoDur = await new Promise((resolve) => {
      const p = spawnSync(ffprobeBin, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath]);
      let out = '';
      p.stdout.on('data', d => out += d);
      p.on('close', () => resolve(parseFloat(out.trim()) || 0));
      p.on('error', () => resolve(0));
    });

    if (!videoDur) return { success: false, error: 'Không đọc được duration video' };

    const loopCount = Math.ceil(audioDur / videoDur) + 1;

    // Dùng ffmpeg stream_loop để loop video, trim theo audio duration, ghép audio
    const out = outputPath || path.join(app.getPath('documents'), `story_loop_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      // -stream_loop -1 = loop vô hạn, -t = trim theo audio duration
      const args = [
        '-y',
        '-stream_loop', '-1', '-i', videoPath,
        '-i', audioPath,
        '-t', String(audioDur),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest',
        out,
      ];
      const proc = spawnSync(ffmpegBin, args);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
      proc.on('error', reject);
    });

    return { success: true, outputPath: out };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── BG VIDEO FOLDER: ghép ngẫu nhiên từ thư mục → khớp audio duration ──────
ipcMain.handle('mc:concat-random-bg', async (event, { folderPath, audioDuration, audioPath, outputPath }) => {
  const { spawn: sp2 } = require('child_process');
  const ffmpegBin = require('ffmpeg-static');
  const ffprobeBin = require('ffprobe-static').path;
  const os = require('os');

  const getDur = (p) => new Promise(resolve => {
    const pr = sp2(ffprobeBin, ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', p]);
    let out = ''; pr.stdout.on('data', d => out += d);
    pr.on('close', () => resolve(parseFloat(out.trim()) || 0));
    pr.on('error', () => resolve(0));
  });

  try {
    // Probe audio duration nếu chưa biết
    if ((!audioDuration || audioDuration <= 0) && audioPath) {
      audioDuration = await getDur(audioPath);
    }
    if (!audioDuration || audioDuration <= 0) audioDuration = 300;

    const VIDEO_EXTS = new Set(['.mp4','.mov','.avi','.mkv','.webm','.m4v','.wmv']);
    const allFiles = fs.readdirSync(folderPath)
      .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .map(f => path.join(folderPath, f));

    if (!allFiles.length) return { success: false, error: 'Không có file video trong thư mục' };

    // Lấy duration tất cả file trước
    const videosWithDur = [];
    for (const f of allFiles) {
      const d = await getDur(f);
      if (d > 0) videosWithDur.push({ path: f, dur: d });
    }
    if (!videosWithDur.length) return { success: false, error: 'Không đọc được duration video trong thư mục' };

    // Pick ngẫu nhiên từng video (có thể lặp lại) cho đến khi đủ duration
    let totalDur = 0;
    const chosen = [];
    const avgDur = videosWithDur.reduce((s, v) => s + v.dur, 0) / videosWithDur.length || 10;
    // MAX_PICKS = số lần tối thiểu cần pick + buffer lớn, không bao giờ bị cắt ngắn
    const MAX_PICKS = Math.max(videosWithDur.length * 20, Math.ceil((audioDuration + 60) / avgDur) * 2);
    while (totalDur < audioDuration + 5 && chosen.length < MAX_PICKS) {
      const pick = videosWithDur[Math.floor(Math.random() * videosWithDur.length)];
      chosen.push(pick);
      totalDur += pick.dur;
    }

    if (!chosen.length) return { success: false, error: 'Không chọn được video nào' };

    // Tạo concat list
    const tmpDir = path.join(os.tmpdir(), `fluxy_bgfolder_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const concatList = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(concatList, chosen.map(f => `file '${f.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');

    const out = outputPath || path.join(tmpDir, `bg_concat_${Date.now()}.mp4`);

    // Concat rồi trim đúng audioDuration
    await new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-f', 'concat', '-safe', '0', '-i', concatList,
        '-t', String(audioDuration),
        '-an', '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        out
      ];
      const pr = sp2(ffmpegBin, args);
      let stderr = ''; pr.stderr.on('data', d => stderr += d);
      pr.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg concat exit ${c}: ${stderr.slice(-200)}`)));
      pr.on('error', reject);
    });

    return { success: true, outputPath: out, count: chosen.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── STORY LOOP: path helper ───────────────────────────────────────────────────
ipcMain.handle('path:join-downloads', async (event, filename) => {
  const downloadsDir = await db.getSetting('downloadsDir', null) || path.join(app.getPath('documents'), 'GrokStudio_Downloads');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
  return path.join(downloadsDir, filename);
});

ipcMain.handle('shell:open-path', async (event, filePath) => {
  await shell.openPath(path.dirname(filePath));
  return true;
});

// ── Crop-zoom video để che logo Veo góc dưới phải ────────────────────────────
// Zoom vào 15% rồi crop từ góc trên-trái → cắt mất góc dưới-phải (chứa logo)
ipcMain.handle('ffmpeg:crop-zoom', async (event, { inputPath, outputPath, zoomPct = 15 }) => {
  try {
    const scale = 1 + zoomPct / 100;
    // scale up, rồi crop lấy vùng top-left (bỏ phần bottom-right chứa logo)
    const vf = `scale=iw*${scale.toFixed(3)}:ih*${scale.toFixed(3)},crop=iw/${scale.toFixed(3)}:ih/${scale.toFixed(3)}:0:0`;
    const result = await runFFmpeg([
      '-y', '-i', inputPath,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'copy',
      outputPath,
    ]);
    if (!result.ok) return { success: false, error: result.stderr?.slice(-300) };
    return { success: true, outputPath };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── BG STUDIO: Tạo ảnh tĩnh nền (text-to-image) ──────────────────────────────
ipcMain.handle('bg:generate-image', async (event, { prompt, model, outputFolder: callerFolder, taskId }) => {
  try {
    const outputFolder = callerFolder || path.join(app.getPath('documents'), 'GrokStudio_Downloads', 'MCStudio');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
    const tid = taskId || `bgimg_${Date.now()}`;
    const sendLog = (msg) => mainWindow?.webContents?.send('mc-studio:log', { taskId: tid, msg });
    const veoResult = await VeoEngine.run({
      mediaType: 'Image',
      tasks: [{ id: tid, prompt }],
      model: model || 'Imagen 4',
      genCount: 1,
      quality: '1K',
      outputFolder,
    }, sendLog);
    if (!veoResult?.success) return { success: false, error: veoResult?.error };
    const files = Array.isArray(veoResult.files) ? veoResult.files : [];
    const good = files.find(r => !r.isError && (r.filePath || r.videoPath));
    if (!good) return { success: false, error: files.find(r => r.isError)?.error || 'Không tạo được ảnh' };
    return { success: true, imagePath: good.filePath || good.videoPath };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── BG STUDIO: I2V từ ảnh tĩnh → video nền cố định khung hình ───────────────
ipcMain.handle('bg:generate-i2v', async (event, { imagePath, prompt, duration, aspectRatio, taskId, model, outputFolder: callerFolder }) => {
  try {
    const outputFolder = callerFolder || path.join(app.getPath('documents'), 'GrokStudio_Downloads', 'MCStudio');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
    const tid = taskId || `bgi2v_${Date.now()}`;
    const sendLog = (msg) => mainWindow?.webContents?.send('mc-studio:log', { taskId: tid, msg });
    // Prompt i2v: chỉ định minimal motion để giữ khung cố định
    const i2vPrompt = `${prompt}, extremely minimal motion, static locked-off shot, only ambient atmosphere, no camera movement whatsoever, perfectly loopable`;
    const veoResult = await VeoEngine.run({
      mediaType: 'image-to-video',
      tasks: [{ id: tid, prompt: i2vPrompt, ingredientImages: [imagePath], duration: duration || '8s', aspectRatio: aspectRatio || '16:9' }],
      aspectRatio: aspectRatio || '16:9',
      model: model || 'Veo 3.1 - Lite [Lower Priority]',
      genCount: 1,
      quality: '1K',
      outputFolder,
      duration: duration || '8s',
    }, sendLog);
    if (!veoResult?.success) return { success: false, error: veoResult?.error };
    const files = Array.isArray(veoResult.files) ? veoResult.files : [];
    const good = files.find(r => !r.isError && (r.filePath || r.videoPath));
    if (!good) return { success: false, error: files.find(r => r.isError)?.error || 'I2V thất bại' };
    return { success: true, videoPath: good.filePath || good.videoPath };
  } catch (e) { return { success: false, error: e.message }; }
});

// Kiểm tra extension đã kết nối chưa (có bearerToken + cookie)
ipcMain.handle('veo:check-connection', () => {
  const auth = global.googleLabsAuth;
  const connected = !!(auth?.bearerToken && auth?.cookie);
  return { connected };
});

// ── STORY PIPELINE: Script generation helper ──────────────────────────────────
// Gọi Gemini từ main process để chia câu + tạo narrator script
// (renderer tự gọi Gemini API để sinh script — handler này chỉ xử lý TTS+SRT)

// ── STORY PIPELINE: TTS từng câu + đo duration + build SRT + merge audio ──────
ipcMain.handle('story:tts-with-srt', async (event, { sentences, voice, outputDir, pitch = 0, rate = 0 }) => {
  const { MsEdgeTTS: METT, OUTPUT_FORMAT: OF } = require('msedge-tts');
  const { spawnSync: spSync } = require('child_process');
  const ffmpegBin = require('ffmpeg-static');
  const ffprobeBin = require('ffprobe-static').path;
  const os = require('os');

  const tmpDir = path.join(os.tmpdir(), `story_tts_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const getAudioDuration = (filePath) => {
    const res = spSync(ffprobeBin, ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', filePath]);
    return parseFloat((res.stdout || '').toString().trim()) || 0;
  };

  // Dùng 1 instance duy nhất cho toàn bộ file để giữ cùng giọng (cùng WebSocket session)
  const sharedTTS = new METT();
  await sharedTTS.setMetadata(voice, OF.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const ttsChunk = (text, outPath) => new Promise((resolve, reject) => {
    const { input, isSsml } = buildEdgeInput(text, voice, pitch, rate);
    sharedTTS.toStream(input, isSsml).then(({ audioStream }) => {
      const ws = fs.createWriteStream(outPath);
      audioStream.on('data', d => ws.write(d));
      audioStream.on('close', () => { ws.end(); resolve(); });
      audioStream.on('error', reject);
    }).catch(reject);
  });

  const secToSRTTime = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    const ms = Math.round((s % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${sec},${ms}`;
  };

  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const chunkPaths = [];
    const srtLines = [];
    let cursor = 0; // cumulative seconds

    mainWindow?.webContents?.send('story-pipeline:progress', { step: 'tts', total: sentences.length, done: 0 });

    for (let i = 0; i < sentences.length; i++) {
      const sent = sentences[i].trim();
      if (!sent) continue;

      const chunkPath = path.join(tmpDir, `s${i}.mp3`);
      await ttsChunk(sent, chunkPath);

      const dur = getAudioDuration(chunkPath);
      const start = cursor;
      const end = cursor + dur;

      srtLines.push(`${i + 1}\n${secToSRTTime(start)} --> ${secToSRTTime(end)}\n${sent}\n`);
      chunkPaths.push(chunkPath);
      cursor = end;

      mainWindow?.webContents?.send('story-pipeline:progress', { step: 'tts', total: sentences.length, done: i + 1 });
    }

    // Merge tất cả audio chunks
    const audioOut = path.join(outputDir, `story_audio_${Date.now()}.mp3`);
    if (chunkPaths.length === 1) {
      fs.copyFileSync(chunkPaths[0], audioOut);
    } else {
      const listFile = path.join(tmpDir, 'concat.txt');
      fs.writeFileSync(listFile, chunkPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
      const res = spSync(ffmpegBin, ['-y','-f','concat','-safe','0','-i',listFile,'-c','copy', audioOut]);
      if (res.status !== 0) throw new Error('Merge audio thất bại');
    }

    // Lưu SRT
    const srtOut = path.join(outputDir, `story_audio_${Date.now()}.srt`);
    fs.writeFileSync(srtOut, srtLines.join('\n'), 'utf8');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    return { success: true, audioPath: audioOut, srtPath: srtOut, srtContent: srtLines.join('\n'), totalDuration: cursor };
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return { success: false, error: e.message };
  }
});

// ── MC STUDIO: Tạo 1 clip MC green screen bằng Veo Ingredients ───────────────
ipcMain.handle('mc:generate-clip', async (event, { mcImagePath, prompt, emotionId, emotionName, model, mode, outputFolder: callerFolder }) => {
  try {
    const outputFolder = callerFolder || path.join(app.getPath('documents'), 'GrokStudio_Downloads', 'MCStudio');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    const taskId = `mc_${emotionName}_${Date.now()}`;
    const sendLog = (msg) => mainWindow?.webContents?.send('mc-studio:log', { taskId, msg });

    // mode='ingredients': dùng ảnh MC làm ingredient (image-to-video)
    // mode='t2v': text-to-video thuần, bỏ qua ảnh MC
    const useIngredients = mode !== 't2v' && !!mcImagePath;
    const mediaType = useIngredients ? 'image-to-video' : 'text-to-video';

    const veoResult = await VeoEngine.run({
      mediaType,
      tasks: [{
        id: taskId,
        prompt,
        ...(useIngredients ? { ingredientImages: [mcImagePath] } : {}),
        duration: '8s',
        aspectRatio: '9:16',
      }],
      aspectRatio: '9:16',
      model: model || 'Veo 3.1 - Lite [Lower Priority]',
      genCount: 1,
      quality: '1K',
      outputFolder,
      duration: '8s',
    }, sendLog);

    if (!veoResult?.success) return { success: false, error: veoResult?.error || 'Veo thất bại', emotionId, emotionName };
    const files = Array.isArray(veoResult.files) ? veoResult.files : [];
    const good = files.find(r => !r.isError && (r.filePath || r.videoPath));
    if (!good) {
      const err = files.find(r => r.isError)?.error || 'Veo không tạo được clip MC';
      return { success: false, error: err, emotionId, emotionName };
    }
    return { success: true, videoPath: good.filePath || good.videoPath, emotionId, emotionName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── MC STUDIO: ffmpeg chroma key + overlay MC lên video nền theo timeline ─────
ipcMain.handle('mc:composite-video', async (event, { bgVideoPath, audioPath, mcClips, emotionTimeline, mcWidthPct=28, mcPosX=16, mcPosY=82, mcStaticPath, mcStaticIsVideo, sceneVideoPath, sceneImagePath, sceneWidthPct=65, sceneVideoPosX=65.5, sceneVideoPosY=50, logoPath, logoSize, logoPosX=88, logoPosY=5, channelName='', chNameOpacity=0.3, chNameFontSize='large', chNameColor='ffffff', chNamePosX=50, chNamePosY=50, mcVariant=1, outputPath, subtitleEnabled=false, subtitleSRT='', subtitlePosY=85, subtitleFontSize='medium', subtitleColor='#ffffff', subtitleBg=true, subtitleStroke=true, videoEffect='none', subtitleBoxW=70, mcFrameStyle='none', sceneFrameStyle='none', mcDisabled=false, showWaveform=false, waveStyle='bars', waveWidthPct=80, waveHeightPct=6, grainNoise=false, grainLevel=18, subAnimation='none', subtitlePreset='classic', outputAspect='16:9', stickers=[] }) => {
  const { spawn: sp } = require('child_process');
  const ffmpegBin = require('ffmpeg-static');
  const ffprobeBin = require('ffprobe-static').path;
  const os = require('os');

  const tmpDir = path.join(os.tmpdir(), `fluxy_mc_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const getVideoDuration = (p) => new Promise(resolve => {
    const proc = sp(ffprobeBin, ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', p]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve(parseFloat(out.trim()) || 0));
    proc.on('error', () => resolve(0));
  });

  const runFFmpeg = (args, opts = {}) => new Promise((resolve, reject) => {
    const proc = sp(ffmpegBin, args, opts);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', reject);
  });

  try {
    mainWindow?.webContents?.send('mc-studio:log', { msg: '⚙️ Lấy thông tin video...' });

    const bgDuration = await getVideoDuration(bgVideoPath);
    mainWindow?.webContents?.send('mc-studio:log', { msg: `📐 bgDuration=${bgDuration?.toFixed(2)}s path=${path.basename(bgVideoPath)}` });
    if (!bgDuration) throw new Error('Không đọc được duration video nền');
    const bgDims = await getVideoDimensions(bgVideoPath);

    // Nếu outputAspect=9:16 nhưng video nền không phải portrait → convert trước
    const is916 = outputAspect === '9:16';
    const targetBgW = is916 ? 1080 : (bgDims?.width || 1920);
    const targetBgH = is916 ? 1920 : (bgDims?.height || 1080);
    const bgNeedsConvert = bgDims && is916 && bgDims.width > bgDims.height;

    let resolvedBgPath = bgVideoPath;
    if (bgNeedsConvert) {
      mainWindow?.webContents?.send('mc-studio:log', { msg: '🔄 Convert video nền sang 9:16...' });
      const convertedBg = path.join(tmpDir, `bg_916_${Date.now()}.mp4`);
      await runFFmpeg([
        '-y', '-i', bgVideoPath,
        '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
        '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', convertedBg,
      ]);
      resolvedBgPath = convertedBg;
    }

    const bgW = targetBgW;
    const bgH = targetBgH;

    // Dùng resolvedBgPath thay bgVideoPath từ đây
    bgVideoPath = resolvedBgPath;

    const CANVAS_H = 540; // canvas preview height reference

    // Scale factor trực tiếp từ mcWidthPct
    const scalePct = mcWidthPct / 100;

    // ── BƯỚC 1: Tạo MC timeline video (bỏ qua khi MC tắt) ──
    let mcFull = null;
    if (!mcDisabled) {
      mainWindow?.webContents?.send('mc-studio:log', { msg: '📋 Đang tạo MC timeline video...' });

      const segFiles = [];
      for (let i = 0; i < emotionTimeline.length; i++) {
        const seg = emotionTimeline[i];
        const clipPath = mcClips[seg.emotionId];
        if (!clipPath || !fs.existsSync(clipPath)) {
          const fallback = mcClips.find(c => c && fs.existsSync(c));
          if (!fallback) continue;
          mcClips[seg.emotionId] = fallback;
        }

        const segDur = seg.end - seg.start;
        const clipDur = await getVideoDuration(mcClips[seg.emotionId] || mcClips.find(c => c));
        const loopCount = Math.ceil(segDur / (clipDur || 8)) + 1;
        const segOut = path.join(tmpDir, `seg_${i}.mp4`);

        await runFFmpeg([
          '-y',
          '-stream_loop', String(loopCount),
          '-i', mcClips[seg.emotionId] || mcClips.find(c => c),
          '-t', String(segDur),
          '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
          segOut,
        ]);
        segFiles.push(segOut);
      }

      if (!segFiles.length) throw new Error('Không có segment MC nào hợp lệ');

      const concatList = path.join(tmpDir, 'concat.txt');
      fs.writeFileSync(concatList, segFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
      mcFull = path.join(tmpDir, 'mc_full.mp4');

      mainWindow?.webContents?.send('mc-studio:log', { msg: `🔗 Concat ${segFiles.length} segments...` });
      await runFFmpeg([
        '-y', '-f', 'concat', '-safe', '0',
        '-i', concatList,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
        mcFull,
      ]);
    }

    // ── BƯỚC 2: Chroma key + Scale + Overlay MC + Logo lên video nền + ghép audio ──
    mainWindow?.webContents?.send('mc-studio:log', { msg: '🎨 Chroma key + Overlay...' });

    // Vị trí MC từ drag (% → biểu thức ffmpeg, căn trái-trên của box MC)
    const mcOverlayExpr = `x=W*${(mcPosX/100).toFixed(4)}-w/2:y=H*${(mcPosY/100).toFixed(4)}-h/2`;

    // Logo
    const logoPct = logoSize === 'large' ? 0.18 : logoSize === 'medium' ? 0.12 : 0.08;
    const logoPosExpr = `x=W*${(logoPosX/100).toFixed(4)}-w/2:y=H*${(logoPosY/100).toFixed(4)}-h/2`;

    // Kích thước chữ tên kênh — % của bgW để khớp canvas preview
    const chFontSizePct = chNameFontSize === 'large' ? 0.05 : chNameFontSize === 'medium' ? 0.035 : 0.025;
    const chFontSizePx = Math.round(bgW * chFontSizePct);
    // Vị trí từ drag → ffmpeg expression
    // Clamp để text không ra ngoài frame
    // Dấu , trong biểu thức hàm phải escape thành \, trong filter_complex_script
    const chNameX = `max(0\\,min(W-tw\\,W*${(chNamePosX/100).toFixed(4)}-tw/2))`;
    const chNameY = `max(0\\,min(H-th\\,H*${(chNamePosY/100).toFixed(4)}-th/2))`;
    // Ghi text ra file tạm để tránh escaping issue với ký tự đặc biệt + tiếng Việt
    const chNameTxtFile = path.join(tmpDir, 'chname.txt');
    if (channelName) fs.writeFileSync(chNameTxtFile, channelName.trim(), 'utf8');
    // Copy font vào tmpDir → dùng relative path "font.ttf" để tránh escaping issue với drive letter
    const vnFonts = ['C:/Windows/Fonts/arial.ttf','C:/Windows/Fonts/tahoma.ttf','C:/Windows/Fonts/segoeui.ttf'];
    const srcFont = vnFonts.find(f => fs.existsSync(f)) || '';
    let fontFile = '';
    if (srcFont) {
      const fontDest = path.join(tmpDir, 'font.ttf');
      try { fs.copyFileSync(srcFont, fontDest); fontFile = 'font.ttf'; } catch (_) {}
    }

    // Nếu có ảnh tĩnh → convert thành video loop trước khi composite
    let resolvedSceneVideoPath = sceneVideoPath || null;
    if (!resolvedSceneVideoPath && sceneImagePath && fs.existsSync(sceneImagePath)) {
      mainWindow?.webContents?.send('mc-studio:log', { msg: '🖼️ Convert ảnh tĩnh → video loop...' });
      const imgVideoPath = path.join(tmpDir, `scene_img_${Date.now()}.mp4`);
      await runFFmpeg([
        '-loop', '1', '-i', sceneImagePath,
        '-t', String(bgDuration),
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-an', '-y', imgVideoPath,
      ]);
      resolvedSceneVideoPath = imgVideoPath;
    }

    const out = outputPath || path.join(app.getPath('documents'), `mc_overlay_${Date.now()}.mp4`);
    const hasChannelName = !!(channelName && channelName.trim());
    const hasSceneVideo  = !!(resolvedSceneVideoPath && fs.existsSync(resolvedSceneVideoPath));
    const hasLogo        = !!(logoPath && fs.existsSync(logoPath));
    // Stickers emoji (dataURL) → ghi ra file PNG tạm
    const resolvedStickers = await Promise.all((stickers || []).map(async (s, i) => {
      if (s.isDataUrl && s.path?.startsWith('data:')) {
        const b64 = s.path.split(',')[1];
        if (!b64) return null;
        const tmpPng = path.join(tmpDir, `sticker_emoji_${i}.png`);
        fs.writeFileSync(tmpPng, Buffer.from(b64, 'base64'));
        return { ...s, path: tmpPng };
      }
      return s;
    }));
    const validStickers = resolvedStickers.filter(s => s?.path && fs.existsSync(s.path));

    // Input indices: 0=bg, 1=mc_full, 2=audio, 3=scene(opt), 4or3=logo(opt), then stickers
    // Input indices phụ thuộc vào mcDisabled (MC input bị bỏ khi tắt)
    const sceneIdx = mcDisabled ? 2 : 3;
    const logoIdx  = hasSceneVideo ? sceneIdx + 1 : sceneIdx;
    const stickerBaseIdx = logoIdx + (hasLogo ? 1 : 0);

    const sceneWPct = sceneWidthPct / 100;
    const scenePxW = Math.round(bgW * sceneWPct);
    const scenePosExpr = `x=W*${(sceneVideoPosX/100).toFixed(4)}-w/2:y=H*${(sceneVideoPosY/100).toFixed(4)}-h/2`;

    // filter_complex chain:
    // [0:v] → overlay scene video → [after_scene] → overlay MC → [after_mc] → logo → drawtext
    const filterParts = [];

    let bgLabel = '0:v';

    // Helper: áp frame border style vào 1 video label
    const buildFrameFilter = (inLabel, outLabel, style, pxW) => {
      const brd = Math.max(3, Math.round(pxW * 0.014));
      if (!style || style === 'none') {
        filterParts.push(`[${inLabel}]null[${outLabel}]`);
      } else if (style === 'white') {
        filterParts.push(`[${inLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFFFFFF,pad=iw+4:ih+4:2:2:color=0x111111[${outLabel}]`);
      } else if (style === 'gold') {
        filterParts.push(`[${inLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFFD700,pad=iw+4:ih+4:2:2:color=0x5C3D00[${outLabel}]`);
      } else if (style === 'silver') {
        filterParts.push(`[${inLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xC0C0C0,pad=iw+4:ih+4:2:2:color=0x444444[${outLabel}]`);
      } else if (style === 'neon_blue') {
        filterParts.push(`[${inLabel}]split[__nb_a_${outLabel}][__nb_b_${outLabel}];[__nb_a_${outLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0x00CFFF,gblur=sigma=${Math.round(brd*1.5)}[__nb_gl_${outLabel}];[__nb_gl_${outLabel}][__nb_b_${outLabel}]overlay=${brd}:${brd},pad=iw+4:ih+4:2:2:color=0x0044AA[${outLabel}]`);
      } else if (style === 'neon_pink') {
        filterParts.push(`[${inLabel}]split[__np_a_${outLabel}][__np_b_${outLabel}];[__np_a_${outLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFF2D78,gblur=sigma=${Math.round(brd*1.5)}[__np_gl_${outLabel}];[__np_gl_${outLabel}][__np_b_${outLabel}]overlay=${brd}:${brd},pad=iw+4:ih+4:2:2:color=0x7700AA[${outLabel}]`);
      } else if (style === 'neon_green') {
        filterParts.push(`[${inLabel}]split[__ng_a_${outLabel}][__ng_b_${outLabel}];[__ng_a_${outLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0x00FF88,gblur=sigma=${Math.round(brd*1.5)}[__ng_gl_${outLabel}];[__ng_gl_${outLabel}][__ng_b_${outLabel}]overlay=${brd}:${brd},pad=iw+4:ih+4:2:2:color=0x005533[${outLabel}]`);
      } else if (style === 'fire') {
        filterParts.push(`[${inLabel}]split[__fi_a_${outLabel}][__fi_b_${outLabel}];[__fi_a_${outLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFF4500,gblur=sigma=${Math.round(brd*2)}[__fi_gl_${outLabel}];[__fi_gl_${outLabel}][__fi_b_${outLabel}]overlay=${brd}:${brd},pad=iw+2:ih+2:1:1:color=0xFF8C00[${outLabel}]`);
      } else if (style === 'gradient_purple') {
        filterParts.push(`[${inLabel}]split[__gp_a_${outLabel}][__gp_b_${outLabel}];[__gp_a_${outLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0x8800FF,gblur=sigma=${Math.round(brd*1.5)}[__gp_gl_${outLabel}];[__gp_gl_${outLabel}][__gp_b_${outLabel}]overlay=${brd}:${brd},pad=iw+4:ih+4:2:2:color=0x00CCFF[${outLabel}]`);
      } else if (style === 'rainbow') {
        filterParts.push(`[${inLabel}]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFF4500,pad=iw+3:ih+3:1:1:color=0x9900FF,pad=iw+3:ih+3:2:2:color=0x00CCFF[${outLabel}]`);
      } else {
        filterParts.push(`[${inLabel}]null[${outLabel}]`);
      }
    };

    // Helper áp frame style (dùng cho cả scene và MC)
    const applyVideoEffect = (inLabel, outLabel, effect, pxW) => {
      const brd = Math.max(4, Math.round(pxW * 0.014));
      if (effect === 'glow') {
        filterParts.push(`[${inLabel}]split[_gw_a][_gw_b];[_gw_a]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0xFFAA00,gblur=sigma=6[_gw_gl];[_gw_gl][_gw_b]overlay=${brd}:${brd}[${outLabel}]`);
      } else if (effect === 'frame') {
        const b2 = Math.max(6, Math.round(pxW * 0.018));
        filterParts.push(`[${inLabel}]pad=iw+${b2*2}:ih+${b2*2}:${b2}:${b2}:color=0xFFFFFF,pad=iw+4:ih+4:2:2:color=0x111111[${outLabel}]`);
      } else if (effect === 'neon') {
        filterParts.push(`[${inLabel}]split[_ne_a][_ne_b];[_ne_a]pad=iw+${brd*2}:ih+${brd*2}:${brd}:${brd}:color=0x8800FF,gblur=sigma=8[_ne_gl];[_ne_gl][_ne_b]overlay=${brd}:${brd},pad=iw+4:ih+4:2:2:color=0x00CCFF[${outLabel}]`);
      } else if (effect === 'shadow') {
        const sh = Math.max(6, Math.round(pxW * 0.016));
        filterParts.push(`[${inLabel}]split[_sh_a][_sh_b];[_sh_a]pad=iw+${sh}:ih+${sh}:0:0:color=0x000000,gblur=sigma=10,colorchannelmixer=aa=0.6[_sh_sl];[_sh_sl][_sh_b]overlay=0:0[${outLabel}]`);
      } else {
        filterParts.push(`[${inLabel}]null[${outLabel}]`);
      }
    };

    if (hasSceneVideo) {
      const sceneGrainFilter = grainNoise ? `,noise=alls=${Math.max(5, Math.min(50, grainLevel || 18))}:allf=t` : '';
      filterParts.push(`[${sceneIdx}:v]scale=${scenePxW}:-2${sceneGrainFilter}[scene_raw]`);
      // Hiệu ứng cảnh động (videoEffect)
      applyVideoEffect('scene_raw', 'scene_eff', videoEffect, scenePxW);
      // Thêm frame style riêng cho cảnh động (sceneFrameStyle)
      buildFrameFilter('scene_eff', 'scene_scaled', sceneFrameStyle, scenePxW);
      filterParts.push(`[${bgLabel}][scene_scaled]overlay=${scenePosExpr}[after_scene]`);
      bgLabel = 'after_scene';
    }

    // Mỗi bản MC có hue shift + grain nhỏ khác nhau để tránh content ID
    let lastLabel = bgLabel; // default: sau scene (hoặc bg nếu không có scene)
    if (!mcDisabled) {
      const mcHueShift = (mcVariant * 7 + 3) % 30;
      const mcGrain    = 2 + (mcVariant % 3);
      const mcPxW = Math.round(bgW * scalePct);
      filterParts.push(`[1:v]scale=${mcPxW}:-2,noise=alls=${mcGrain}:allf=t[mc_scaled]`);
      filterParts.push(`[mc_scaled]chromakey=color=0x00FF00:similarity=0.22:blend=0.05[mc_ck]`);
      buildFrameFilter('mc_ck', 'mc_framed', mcFrameStyle, mcPxW);
      filterParts.push(`[${bgLabel}][mc_framed]overlay=${mcOverlayExpr}[after_mc]`);
      lastLabel = 'after_mc';
    }
    if (hasLogo) {
      filterParts.push(`[${logoIdx}:v]scale=${Math.round(bgW * logoPct)}:-2[logo_scaled]`);
      filterParts.push(`[${lastLabel}][logo_scaled]overlay=${logoPosExpr}[after_logo]`);
      lastLabel = 'after_logo';
    }
    // Sticker overlays (ảnh tĩnh PNG/JPG + GIF) với xóa nền + opacity
    validStickers.forEach((s, i) => {
      const isGif   = s.path.toLowerCase().endsWith('.gif');
      const sW      = Math.round(bgW * ((s.sizePct||15) / 100));
      const posExpr = `x=W*${(s.pos.x/100).toFixed(4)}-w/2:y=H*${(s.pos.y/100).toFixed(4)}-h/2`;
      const inputIdx   = stickerBaseIdx + i;
      const rawLabel   = `stk_raw_${i}`;
      const scaledLabel= `stk_scaled_${i}`;
      const outLabel   = `after_stk_${i}`;
      const opacity    = (s.opacity ?? 100) / 100;
      const threshold  = ((s.bgThreshold ?? 20) / 100).toFixed(3);
      const similarity = (Math.min((s.bgThreshold ?? 20) + 10, 60) / 100).toFixed(3);

      // Scale + loop GIF
      if (isGif) {
        filterParts.push(`[${inputIdx}:v]scale=${sW}:-2,loop=loop=-1:size=999:start=0[${rawLabel}]`);
      } else {
        filterParts.push(`[${inputIdx}:v]scale=${sW}:-2[${rawLabel}]`);
      }

      // Xóa nền
      const bgr = s.bgRemove || 'none';
      if (bgr === 'white') {
        filterParts.push(`[${rawLabel}]colorkey=0xFFFFFF:${threshold}:${similarity}[${scaledLabel}]`);
      } else if (bgr === 'black') {
        filterParts.push(`[${rawLabel}]colorkey=0x000000:${threshold}:${similarity}[${scaledLabel}]`);
      } else if (bgr === 'green') {
        filterParts.push(`[${rawLabel}]chromakey=0x00FF00:${threshold}:${similarity}[${scaledLabel}]`);
      } else if (bgr === 'auto') {
        // Tự động: thử xóa góc pixel đầu tiên làm màu nền
        filterParts.push(`[${rawLabel}]colorkey=0xFFFFFF:0.25:0.05,colorkey=0x000000:0.25:0.05[${scaledLabel}]`);
      } else {
        filterParts.push(`[${rawLabel}]null[${scaledLabel}]`);
      }

      // Overlay + opacity (eof_action=repeat: PNG sticker single-frame lặp lại, không cắt ngắn video)
      if (opacity < 1) {
        filterParts.push(`[${lastLabel}][${scaledLabel}]overlay=${posExpr}:eof_action=repeat:alpha=premultiplied,format=yuva420p,colorchannelmixer=aa=${opacity.toFixed(3)}[${outLabel}]`);
      } else {
        filterParts.push(`[${lastLabel}][${scaledLabel}]overlay=${posExpr}:eof_action=repeat[${outLabel}]`);
      }
      lastLabel = outLabel;
    });
    if (hasChannelName) {
      // textfile= + fontfile= đều dùng relative path (cwd=tmpDir) → tránh drive-letter escaping issue
      const fontPart = fontFile ? `:fontfile=${fontFile}` : '';
      filterParts.push(
        `[${lastLabel}]drawtext=textfile=chname.txt${fontPart}:fontcolor=0x${chNameColor}@${chNameOpacity.toFixed(2)}:fontsize=${chFontSizePx}:x=${chNameX}:y=${chNameY}[out]`
      );
    } else {
      filterParts.push(`[${lastLabel}]null[out]`);
    }

    // Khi mcDisabled: không cần input MC, index scene/logo dịch lên 1
    const ffmpegArgs = ['-y', '-stream_loop', '-1', '-i', bgVideoPath]; // 0: bg
    if (!mcDisabled) ffmpegArgs.push('-stream_loop', '-1', '-i', mcFull); // 1: MC (nếu bật)
    ffmpegArgs.push('-i', audioPath); // 1 or 2: audio
    const sceneInputIdx = mcDisabled ? 2 : 3;
    const logoInputIdx  = hasSceneVideo ? sceneInputIdx + 1 : sceneInputIdx;
    if (hasSceneVideo) ffmpegArgs.push('-stream_loop', '-1', '-i', resolvedSceneVideoPath);
    if (hasLogo) ffmpegArgs.push('-i', logoPath);
    validStickers.forEach(s => {
      if (s.path.toLowerCase().endsWith('.gif')) {
        ffmpegArgs.push('-stream_loop', '-1', '-i', s.path);
      } else {
        ffmpegArgs.push('-i', s.path);
      }
    });

    // fcScriptPath khai báo sẵn — ghi sau khi scale đã được thêm vào filterParts
    const fcScriptPath = path.join(tmpDir, 'filter_complex.txt');
    const fcScriptFwd = fcScriptPath.replace(/\\/g, '/');

    // Detect GPU encoder để tăng tốc encode — đặc biệt quan trọng khi video dài hàng tiếng
    const detectEncoder = () => new Promise(resolve => {
      // Thử NVENC, AMF, QSV lần lượt; nếu không có thì dùng libx264 ultrafast
      const testEnc = (codec, extraArgs) => new Promise(res => {
        const p = sp(ffmpegBin, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', ...extraArgs, '-vcodec', codec, '-f', 'null', '-'], { stdio: 'pipe' });
        p.on('close', code => res(code === 0));
        p.on('error', () => res(false));
      });
      (async () => {
        if (await testEnc('h264_nvenc', ['-preset', 'p1'])) return resolve(['h264_nvenc', '-preset', 'p1', '-rc', 'constqp', '-qp', '22']);
        if (await testEnc('h264_amf',  ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24'])) return resolve(['h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24']);
        if (await testEnc('h264_qsv',  ['-preset', 'veryfast', '-global_quality', '22'])) return resolve(['h264_qsv', '-preset', 'veryfast', '-global_quality', '22']);
        resolve(['libx264', '-preset', 'ultrafast', '-crf', '22']);
      })();
    });
    const [encCodec, ...encExtraArgs] = await detectEncoder();
    mainWindow?.webContents?.send('mc-studio:log', { msg: `🎬 Encoder: ${encCodec} (video dài ${Math.round(bgDuration/60)} phút — dùng encoder nhanh nhất)` });

    // Scale xuống 720p để render nhanh — MC Studio không cần full res
    const maxOutH = 720;
    const actualH = bgH > maxOutH ? maxOutH : bgH;
    const actualW = Math.round(bgW * actualH / bgH) % 2 === 0
      ? Math.round(bgW * actualH / bgH)
      : Math.round(bgW * actualH / bgH) + 1; // đảm bảo chẵn
    if (bgH > maxOutH) {
        const last = filterParts.length - 1;
        filterParts[last] = filterParts[last].replace(/\[out\]$/, '[out_raw]');
        filterParts.push(`[out_raw]scale=${actualW}:${actualH}[out]`);
    }
    // Ghi filter_complex sau khi đã thêm scale
    fs.writeFileSync(fcScriptPath, filterParts.join(';'), 'utf8');

    ffmpegArgs.push(
      '-t', String(bgDuration),
      '-filter_complex_script', fcScriptFwd,
      '-map', '[out]',
      '-map', `${mcDisabled ? 1 : 2}:a:0`,
      '-c:v', encCodec, ...encExtraArgs,
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
      out,
    );

    if (hasLogo) mainWindow?.webContents?.send('mc-studio:log', { msg: `🏷️ Logo @ (${logoPosX.toFixed(0)}%,${logoPosY.toFixed(0)}%)` });
    if (hasChannelName) mainWindow?.webContents?.send('mc-studio:log', { msg: `📝 Tên kênh: "${channelName}" mờ ${Math.round(chNameOpacity*100)}%` });
    // cwd=tmpDir để textfile=chname.txt resolve đúng relative path
    const compositeStderr = await runFFmpeg(ffmpegArgs, { cwd: tmpDir });
    // Post-check duration
    const outDur = await getVideoDuration(out);
    if (outDur < bgDuration * 0.5) {
      mainWindow?.webContents?.send('mc-studio:log', { msg: `⚠️ Output duration ${outDur?.toFixed(2)}s ngắn hơn expected ${bgDuration?.toFixed(2)}s! FFmpeg stderr: ${compositeStderr?.slice(-500)}` });
    }

    // ── Burn waveform vào scene video area (hoặc bottom-center nếu không có scene) ──
    if (showWaveform) {
      try {
        mainWindow?.webContents?.send('mc-studio:log', { msg: `🎵 Burn sóng âm thanh...` });
        const waveOut = out.replace(/(\.[^.]+)$/, '_wave$1');
        // Dùng actualW/actualH (sau scale 720p) để tọa độ overlay đúng
        let wvW, wvH, wvX, wvY;
        if (resolvedSceneVideoPath) {
          // Nằm ở đáy scene video — tọa độ theo actual dimensions
          const scW = Math.round(actualW * sceneWidthPct / 100);
          const scH = Math.round(scW * 9 / 16);
          const scX = Math.round(actualW * sceneVideoPosX / 100 - scW / 2);
          const scY = Math.round(actualH * sceneVideoPosY / 100 - scH / 2);
          wvW = Math.round(scW * (waveWidthPct / 100));
          wvH = Math.max(10, Math.round(scH * (waveHeightPct / 100)));
          wvX = Math.max(0, scX + Math.round((scW - wvW) / 2));
          wvY = Math.max(0, Math.min(actualH - wvH - 2, scY + scH - wvH - Math.round(scH * 0.02)));
        } else {
          // Không có scene → bottom-center toàn video
          wvW = Math.round(actualW * (waveWidthPct / 100));
          wvH = Math.max(10, Math.round(actualH * (waveHeightPct / 100)));
          wvX = Math.round((actualW - wvW) / 2);
          wvY = Math.min(actualH - wvH - 4, Math.round(actualH * 0.78));
        }
        // Map waveStyle → showwaves mode + color
        const waveMap = {
          bars:   { mode: 'cline',  color: 'purple|pink',    scale: 'sqrt' },
          mirror: { mode: 'cline',  color: 'cyan|0x6366f1',  scale: 'lin' },
          line:   { mode: 'line',   color: '0xFBBF24',       scale: 'sqrt' },
          wave:   { mode: 'p2p',    color: '0x34D399',       scale: 'lin' },
          dots:   { mode: 'point',  color: '0xFB7185',       scale: 'sqrt' },
          fill:   { mode: 'line',   color: '0xF97316|0xEF4444', scale: 'sqrt' },
          circle: { mode: 'cline',  color: 'rainbow',        scale: 'lin' },
        };
        const wm = waveMap[waveStyle] || waveMap.bars;
        await runFFmpeg([
          '-y', '-i', out,
          '-filter_complex',
          `[0:a]showwaves=s=${wvW}x${wvH}:mode=${wm.mode}:colors=${wm.color}:scale=${wm.scale}[waves];[0:v][waves]overlay=${wvX}:${wvY}`,
          '-c:v', 'libx264', '-c:a', 'copy', '-preset', 'fast', waveOut
        ]);
        if (fs.existsSync(waveOut) && fs.statSync(waveOut).size > 10000) {
          fs.renameSync(waveOut, out);
          mainWindow?.webContents?.send('mc-studio:log', { msg: `✅ Sóng âm thanh đã burn` });
        }
      } catch (e) {
        mainWindow?.webContents?.send('mc-studio:log', { msg: `⚠️ Burn sóng âm thất bại: ${e.message?.slice(0,80)}`, level: 'warn' });
      }
    }

    // ── Burn subtitle vào video nếu có SRT ──
    let finalOut = out;
    // Lưu SRT ra cùng thư mục output trước khi burn
    if (subtitleSRT && subtitleSRT.trim()) {
      try {
        const outDir2 = path.dirname(outputPath);
        const srtOutName = path.basename(outputPath).replace(/(\.[^.]+)$/, '.srt');
        fs.writeFileSync(path.join(outDir2, srtOutName), subtitleSRT, 'utf8');
        mainWindow?.webContents?.send('mc-studio:log', { msg: `📄 SRT đã lưu: ${srtOutName}` });
      } catch (_) {}
    }
    if (subtitleEnabled && subtitleSRT && subtitleSRT.trim()) {
      const srtPath = path.join(tmpDir, 'subtitle.srt');
      // Chỉ cleanup nhẹ: đánh lại số thứ tự, bỏ cue rỗng — GIỮ NGUYÊN timing gốc từ SRT
      const cleanSRT = (raw) => {
        const blocks = raw.trim().split(/\n\s*\n/);
        const out = [];
        let idx = 1;
        for (const block of blocks) {
          const lines = block.trim().split('\n');
          const timeLine = lines.find(l => l.includes('-->'));
          if (!timeLine) continue;
          const textLines = lines.filter(l => !l.includes('-->') && !/^\d+$/.test(l.trim()));
          const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          out.push(`${idx}\n${timeLine.trim()}\n${text}`);
          idx++;
        }
        return out.join('\n\n');
      };
      const cleanedSRT = cleanSRT(subtitleSRT);
      mainWindow?.webContents?.send('mc-studio:log', { msg: `📄 SRT: ${cleanedSRT.split('\n\n').length} cue` });
      fs.writeFileSync(srtPath, cleanedSRT, 'utf8');
      const subtitledOut = out.replace(/(\.[^.]+)$/, '_sub$1');
      // Dùng PlayResX/Y = video resolution thực → mọi đơn vị đều là pixel
      // Dùng actualW/actualH (sau scale) để ASS coordinates đúng với video thực
      const subFsPx = subtitleFontSize === 'large' ? 22 : subtitleFontSize === 'small' ? 13 : 17;
      const subFsVideo = Math.round(subFsPx * actualH / CANVAS_H);
      const subColor = (subtitleColor || '#ffffff').replace('#','');
      const bgAlpha = subtitleBg ? '80' : '00';
      const outline = subtitleStroke ? Math.round(actualH / 540) : 0;
      const marginV = Math.round(actualH * (1 - subtitlePosY / 100));
      const halfBoxPx = Math.round(actualW * (subtitleBoxW / 100) / 2);
      const marginH = Math.max(0, Math.round(actualW / 2) - halfBoxPx);

      const parseSRTtoASS = (srtRaw) => {
        // SRT: HH:MM:SS,mmm → ASS: H:MM:SS.cc (centiseconds, 2 digits)
        const toASS = (t) => {
          const [hms, ms = '000'] = t.trim().split(',');
          const cs = Math.floor(Number(ms) / 10).toString().padStart(2, '0');
          const [h, m, s] = hms.split(':');
          return `${Number(h)}:${m}:${s}.${cs}`;
        };
        const blocks = srtRaw.trim().split(/\n\s*\n/);
        const events = blocks.map(b => {
          const lines = b.trim().split('\n');
          const timeLine = lines.find(l => l.includes('-->'));
          if (!timeLine) return null;
          const [s, e] = timeLine.split('-->').map(x => toASS(x.trim()));
          const txt = lines.filter(l => !l.includes('-->') && !/^\d+$/.test(l.trim())).join(' ').trim();
          let tag = '';
          if (subAnimation === 'fade') tag = '{\\fad(200,150)}';
          else if (subAnimation === 'slide') tag = '{\\fad(300,150)\\blur3\\t(0,300,\\blur0)}';
          else if (subAnimation === 'pop') tag = '{\\fad(100,100)\\t(0,200,\\fscx110\\fscy110)\\t(200,350,\\fscx100\\fscy100)}';
          else if (subAnimation === 'glow') tag = '{\\fad(200,200)\\blur4\\t(0,400,\\blur1)}';
          return txt ? `Dialogue: 0,${s},${e},Default,,0,0,0,,${tag}${txt}` : null;
        }).filter(Boolean);

        // Preset → ASS style flags
        const presetFont = subtitlePreset === 'typewriter' ? 'Courier New' : subtitlePreset === 'cinematic' ? 'Georgia' : 'Arial';
        const presetBold = (subtitlePreset === 'bold' || subtitlePreset === 'classic') ? -1 : 0; // -1=bold in ASS
        const presetItalic = subtitlePreset === 'cinematic' ? -1 : 0;
        const presetShadow = subtitlePreset === 'neon' ? 2 : 0;
        const presetBgAlpha = subtitleBg ? (subtitlePreset === 'neon' ? 'A0' : bgAlpha) : '00';

        return [
          '[Script Info]',
          `PlayResX: ${actualW}`,
          `PlayResY: ${actualH}`,
          'ScriptType: v4.00+',
          '',
          '[V4+ Styles]',
          'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
          `Style: Default,${presetFont},${subFsVideo},&H00${subColor},&H000000FF,&H00000000,&H${presetBgAlpha}000000,${presetBold},${presetItalic},0,0,100,100,0,0,1,${outline},${presetShadow},2,${marginH},${marginH},${marginV},1`,
          '',
          '[Events]',
          'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
          ...events,
        ].join('\n');
      };

      const assTmp = subtitledOut.replace(/(\.[^.]+)$/, '_tmp.ass');
      let subOk = false;
      try {
        const assContent = parseSRTtoASS(fs.readFileSync(srtPath, 'utf8'));
        fs.writeFileSync(assTmp, assContent, 'utf8');
        const assEsc = assTmp.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/ /g, '\\ ');
        await runFFmpeg(['-y', '-i', out, '-vf', `ass='${assEsc}'`, '-c:a', 'copy', '-preset', 'fast', subtitledOut]);
        subOk = true;
      } catch (_) {}
      if (!subOk) {
        try {
          // Fallback: subtitles filter với path ngắn
          const srtShort = path.join(os.tmpdir(), `sub_${Date.now()}.srt`);
          fs.copyFileSync(srtPath, srtShort);
          const srtShortFwd = srtShort.replace(/\\/g, '/').replace(/:/g, '\\:');
          const forceStyle = `FontSize=${subFsVideo},PrimaryColour=&H00${subColor},BackColour=&H${bgAlpha}000000,Outline=${outline},Shadow=0,Alignment=2,MarginV=${marginV},MarginL=${marginH},MarginR=${marginH}`;
          await runFFmpeg(['-y', '-i', out, '-vf', `subtitles='${srtShortFwd}':charenc=UTF-8:force_style='${forceStyle}'`, '-c:a', 'copy', '-preset', 'fast', subtitledOut]);
          try { fs.unlinkSync(srtShort); } catch(_) {}
          subOk = true;
        } catch (_) {}
      }
      try { if (fs.existsSync(assTmp)) fs.unlinkSync(assTmp); } catch (_) {}
      if (subOk && fs.existsSync(subtitledOut) && fs.statSync(subtitledOut).size > 10000) {
        fs.renameSync(subtitledOut, out);
        finalOut = out;
        mainWindow?.webContents?.send('mc-studio:log', { msg: `✅ Phụ đề đã burn vào video` });
      } else {
        mainWindow?.webContents?.send('mc-studio:log', { msg: `⚠️ Burn phụ đề thất bại — xuất video không có sub`, level: 'warn' });
      }
    }

    // Film grain đã được áp vào scene video trong filter_complex (sceneGrainFilter) — không post-process toàn video

        // Dọn tmp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    mainWindow?.webContents?.send('mc-studio:log', { msg: `✅ Composite xong: ${finalOut}` });
    return { success: true, outputPath: finalOut };
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return { success: false, error: e.message };
  }
});

// ── SCENE VIDEO: chọn ngẫu nhiên từ thư mục + reup + trim/loop khớp audio ──
ipcMain.handle('scene:prepare-video', async (event, { folderPath, videoPath: singleVideoPath, outputFolder: callerFolder, audioPath, reup = {} }) => {
  try {
    const { spawn: sp } = require('child_process');
    const ffmpegBin  = require('ffmpeg-static');
    const ffprobeBin = require('ffprobe-static').path;
    const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm|m4v|flv)$/i;

    let srcPath, pickedName;
    if (folderPath) {
      const files = fs.readdirSync(folderPath).filter(f => VIDEO_EXTS.test(f));
      if (!files.length) return { success: false, error: 'Không có video trong thư mục' };
      pickedName = files[Math.floor(Math.random() * files.length)];
      srcPath = path.join(folderPath, pickedName);
    } else if (singleVideoPath) {
      srcPath = singleVideoPath;
      pickedName = path.basename(singleVideoPath);
    } else {
      return { success: false, error: 'Không có nguồn video' };
    }

    const outDir = callerFolder || path.dirname(srcPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const sendLog = (msg) => mainWindow?.webContents?.send('mc-studio:log', { msg });

    const getDur = (p) => new Promise(resolve => {
      const proc = sp(ffprobeBin, ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', p]);
      let out2 = ''; proc.stdout.on('data', d => out2 += d);
      proc.on('close', () => resolve(parseFloat(out2.trim()) || 0));
      proc.on('error', () => resolve(0));
    });
    const runFF = (args) => new Promise((resolve, reject) => {
      const proc = sp(ffmpegBin, args);
      let err = ''; proc.stderr.on('data', d => err += d);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`)));
      proc.on('error', reject);
    });

    const audioDur = audioPath ? await getDur(audioPath) : 0;
    const videoDur = await getDur(srcPath);
    if (!videoDur) return { success: false, error: 'Không đọc được duration video' };
    sendLog(`🎞️ Scene: ${pickedName} (${videoDur.toFixed(1)}s) → target ${audioDur.toFixed(1)}s`);

    // Loop/trim video khớp audio — video only
    const loopedPath = path.join(outDir, `scene_looped_${Date.now()}.mp4`);
    const targetDur = audioDur > 0 ? audioDur : videoDur;
    const needsLoop = audioDur > 0 && videoDur < audioDur;
    const loopCount = needsLoop ? Math.ceil(audioDur / videoDur) + 1 : 0;
    // Luôn encode lại để đảm bảo timestamp sạch cho bước reup sau
    // Cap resolution: 4K → 1080p, giữ tỉ lệ gốc; 720p trở xuống giữ nguyên
    const capVf = ['-vf', "scale=-2:'min(ih,1080)'"];
    const loopArgs = needsLoop
      ? ['-y', '-stream_loop', String(loopCount), '-i', srcPath, '-t', String(targetDur), '-an', ...capVf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', loopedPath]
      : ['-y', '-i', srcPath, '-t', String(targetDur), '-an', ...capVf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', loopedPath];
    await runFF(loopArgs);
    sendLog(`✅ Loop/trim scene xong: ${targetDur.toFixed(1)}s`);

    // Áp reup filter
    const { hFlip=false, colorShift=true, colorShiftLevel='medium', zoomPct=5,
            varSpeed=true, varSpeedLevel='medium', hueRotate=true,
            grainNoise=true, grainLevel=5, randomFps=true,
            slightRotate=false, randomPosCrop=true } = reup;

    const reupPath = path.join(outDir, `scene_reup_${Date.now()}.mp4`);
    const vFilters = [];

    // Zoom/crop: scale UP trước → crop (tránh dimension lẻ)
    if (zoomPct > 0) {
      const z = 1 + zoomPct / 100;
      const zS = z.toFixed(3);
      const oxPct = randomPosCrop ? (Math.random() * (1 - 1/z)).toFixed(4) : ((1 - 1/z) / 2).toFixed(4);
      const oyPct = randomPosCrop ? (Math.random() * (1 - 1/z)).toFixed(4) : ((1 - 1/z) / 2).toFixed(4);
      // scale lên z lần → crop về kích thước gốc bằng offset %
      vFilters.push(`scale=trunc(iw*${zS}/2)*2:trunc(ih*${zS}/2)*2,crop=iw/${zS}:ih/${zS}:iw*${oxPct}:ih*${oyPct}`);
    }
    if (hFlip) vFilters.push('hflip');
    if (slightRotate) { const a = (Math.random()>0.5?1:-1)*(0.5+Math.random()*1.5); vFilters.push(`rotate=${a.toFixed(2)}*PI/180:ow=iw:oh=ih:fillcolor=black`); }
    if (colorShift) { const eq = colorShiftLevel==='strong'?'eq=brightness=0.05:saturation=1.4:contrast=1.15':colorShiftLevel==='light'?'eq=brightness=0.02:saturation=1.1:contrast=1.05':'eq=brightness=0.03:saturation=1.25:contrast=1.1'; vFilters.push(eq); }
    if (hueRotate) vFilters.push(`hue=h=${(5+Math.random()*15).toFixed(1)}`);
    if (grainNoise) vFilters.push(`noise=alls=${Math.min(grainLevel*3,30)}:allf=t`);
    if (varSpeed) { const f = varSpeedLevel==='strong'?(0.85+Math.random()*0.1):varSpeedLevel==='light'?(0.97+Math.random()*0.04):(0.92+Math.random()*0.07); vFilters.push(`setpts=${(1/f).toFixed(4)}*PTS`); }
    // Đảm bảo output có even dimensions để libx264 không lỗi
    vFilters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');

    const fps = randomFps ? [23.976,24,25,29.97,30][Math.floor(Math.random()*5)] : 30;
    const ffArgs = [
      '-y', '-i', loopedPath,
      '-vf', vFilters.join(','),
      '-r', String(fps),
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-max_muxing_queue_size', '1024',
      reupPath,
    ];

    sendLog('🎨 Áp reup filter cho scene video...');
    await runFF(ffArgs);
    sendLog(`✅ Scene reup xong: ${path.basename(reupPath)}`);
    try { fs.unlinkSync(loopedPath); } catch (_) {}

    return { success: true, videoPath: reupPath, pickedName };
  } catch (e) { return { success: false, error: e.message }; }
});


// ── CAPCUT EDITOR: Export video từ timeline ───────────────────────────────
ipcMain.handle('capcut_export', async (event, { outPath, outW, outH, fps, projectName, videoClips=[], audioClips=[], textClips=[], imageClips=[] }) => {
  const ffmpegBin = require('ffmpeg-static');
  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), `capcut_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const send = (msg) => { try { event.sender.send('capcut:log', { msg }); } catch (_) {} };

  const runFF = (args) => new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(ffmpegBin, args);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`)));
    proc.on('error', reject);
  });

  try {
    const totalDur = Math.max(
      ...videoClips.map(c => c.start + c.duration),
      ...audioClips.map(c => c.start + c.duration),
      ...textClips.map(c => c.start + c.duration),
      10,
    );

    send(`📐 Kích thước: ${outW}x${outH} @${fps}fps, thời lượng: ${totalDur.toFixed(1)}s`);

    // Step 1: Tạo nền đen (canvas)
    const basePath = path.join(tmpDir, 'base.mp4');
    send('🎨 Tạo nền đen...');
    await runFF([
      '-y', '-f', 'lavfi', '-i', `color=c=black:size=${outW}x${outH}:rate=${fps}`,
      '-t', String(totalDur), '-c:v', 'libx264', '-preset', 'ultrafast', basePath,
    ]);

    // Step 2: Xử lý từng video clip
    let currentVideo = basePath;
    for (let i = 0; i < videoClips.length; i++) {
      const cl = videoClips[i];
      if (!cl.path || !fs.existsSync(cl.path)) continue;
      send(`🎬 Xử lý video clip ${i+1}/${videoClips.length}: ${path.basename(cl.path)}`);
      const clOut = path.join(tmpDir, `vcl_${i}.mp4`);
      const overlayOut = path.join(tmpDir, `vov_${i}.mp4`);

      // Build vf filters
      const vfParts = [`scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`];
      if (cl.filter) vfParts.push(cl.filter);
      const eqParts = [];
      if (cl.brightness) eqParts.push(`brightness=${cl.brightness}`);
      if (cl.contrast)   eqParts.push(`contrast=${1+cl.contrast}`);
      if (cl.saturation) eqParts.push(`saturation=${1+cl.saturation}`);
      if (eqParts.length) vfParts.push(`eq=${eqParts.join(':')}`);
      const speed = cl.speed || 1;
      if (speed !== 1) vfParts.push(`setpts=${(1/speed).toFixed(4)}*PTS`);

      // Extract + process clip
      await runFF([
        '-y',
        '-ss', String(cl.trimStart||0),
        '-i', cl.path,
        '-t', String(cl.duration / speed),
        '-vf', vfParts.join(','),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
        clOut,
      ]);

      // Overlay onto canvas at cl.start
      await runFF([
        '-y', '-i', currentVideo, '-i', clOut,
        '-filter_complex', `[0:v][1:v]overlay=0:0:enable='between(t,${cl.start},${cl.start+cl.duration})'[v]`,
        '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast',
        overlayOut,
      ]);
      currentVideo = overlayOut;
    }

    // Step 3: Burn text subtitles
    let videoWithText = currentVideo;
    if (textClips.length > 0) {
      send(`📝 Burn ${textClips.length} text clip...`);
      // Build drawtext filters
      const dtFilters = textClips.map(cl => {
        const x = `(w*${(cl.posX||50)/100}-text_w/2)`;
        const y = `(h*${(cl.posY||85)/100}-text_h/2)`;
        const color = cl.color || 'ffffff';
        const size = cl.size || 36;
        const bold = cl.bold ? ':style=Bold' : '';
        const boxStr = cl.stroke ? `:borderw=3:bordercolor=black` : '';
        const safeText = (cl.content||'').replace(/'/g, "\'").replace(/:/g, '\:');
        return `drawtext=text='${safeText}':x=${x}:y=${y}:fontsize=${size}:fontcolor=0x${color}${boxStr}:enable='between(t,${cl.start},${cl.start+cl.duration})'`;
      }).join(',');

      const textOut = path.join(tmpDir, 'with_text.mp4');
      await runFF([
        '-y', '-i', videoWithText,
        '-vf', dtFilters,
        '-c:v', 'libx264', '-preset', 'ultrafast',
        textOut,
      ]);
      videoWithText = textOut;
    }

    // Step 4: Mix audio
    let finalPath = outPath;
    const hasAudio = audioClips.length > 0 || videoClips.some(c => c.volume > 0 && fs.existsSync(c.path||''));
    if (hasAudio) {
      send('🔊 Mix audio...');
      const mixInputs = [];
      const amixParts = [];
      let idx = 0;

      // Audio from video clips
      for (const cl of videoClips) {
        if (!cl.path || !fs.existsSync(cl.path) || (cl.volume||1) <= 0) continue;
        mixInputs.push('-i', cl.path);
        const vol = (cl.volume||1) * (cl.speed||1 === 1 ? 1 : 1);
        amixParts.push(`[${idx}:a]adelay=${Math.round(cl.start*1000)}|${Math.round(cl.start*1000)},volume=${vol}[a${idx}]`);
        idx++;
      }
      // Pure audio clips
      for (const cl of audioClips) {
        if (!cl.path || !fs.existsSync(cl.path)) continue;
        mixInputs.push('-i', cl.path);
        amixParts.push(`[${idx}:a]adelay=${Math.round(cl.start*1000)}|${Math.round(cl.start*1000)},volume=${cl.volume||1}[a${idx}]`);
        idx++;
      }

      if (idx > 0) {
        const audioOut = path.join(tmpDir, 'final_audio.wav');
        const mergeStr = `${amixParts.join(';')};${Array.from({length:idx},(_,i)=>`[a${i}]`).join('')}amix=inputs=${idx}:normalize=0[aout]`;
        await runFF([
          '-y', ...mixInputs,
          '-filter_complex', mergeStr,
          '-map', '[aout]', '-t', String(totalDur), audioOut,
        ]);
        const withAudio = path.join(tmpDir, 'final_with_audio.mp4');
        await runFF([
          '-y', '-i', videoWithText, '-i', audioOut,
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-t', String(totalDur), withAudio,
        ]);
        finalPath = outPath;
        await runFF(['-y', '-i', withAudio, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy', outPath]);
      } else {
        await runFF(['-y', '-i', videoWithText, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-an', outPath]);
      }
    } else {
      await runFF(['-y', '-i', videoWithText, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-an', outPath]);
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    send(`✅ Xuất xong: ${path.basename(outPath)}`);
    return { success: true, outPath };
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    return { success: false, error: e.message };
  }
});

ipcMain.handle('capcut:get-duration', async (_, { path: filePath }) => {
  const ffprobeBin = require('ffprobe-static').path;
  return new Promise(resolve => {
    const { spawn } = require('child_process');
    const proc = spawn(ffprobeBin, ['-v','quiet','-show_entries','format=duration','-of','csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve({ duration: parseFloat(out.trim()) || 0 }));
    proc.on('error', () => resolve({ duration: 0 }));
  });
});

// ── CAPCUT API SERVER ─────────────────────────────────────────────────────────
let _capcutServerProc = null;

ipcMain.handle('capcut:start-server', async (event, { serverPath: srvPath }) => {
  if (_capcutServerProc) return { success: true, port: 9000 };
  const { spawn: _spawn } = require('child_process');
  const serverScript = path.join(srvPath, 'capcut_server.py');
  if (!fs.existsSync(serverScript)) {
    return { success: false, error: `Không tìm thấy capcut_server.py tại: ${srvPath}` };
  }
  return new Promise(resolve => {
    let resolved = false;
    const done = (res) => { if (!resolved) { resolved = true; resolve(res); } };
    _capcutServerProc = _spawn('python', [serverScript], { cwd: srvPath, windowsHide: true });
    const onData = (d) => {
      const msg = d.toString();
      try { event.sender.send('capcut:server-log', msg); } catch(_) {}
      if (msg.includes('Running on') || msg.includes('Serving Flask') || msg.includes('9000')) {
        done({ success: true, port: 9000 });
      }
    };
    _capcutServerProc.stdout.on('data', onData);
    _capcutServerProc.stderr.on('data', onData);
    _capcutServerProc.on('error', e => { _capcutServerProc = null; done({ success: false, error: e.message }); });
    _capcutServerProc.on('close', () => { _capcutServerProc = null; });
    setTimeout(() => done({ success: true, port: 9000 }), 4000);
  });
});

ipcMain.handle('capcut:stop-server', () => {
  if (_capcutServerProc) { try { _capcutServerProc.kill('SIGTERM'); } catch(_) {} _capcutServerProc = null; }
  return { success: true };
});

ipcMain.handle('capcut:server-status', () => ({ running: !!_capcutServerProc }));

ipcMain.handle('capcut:select-file', async (_, { filters, multiple = false }) => {
  const { dialog } = require('electron');
  const props = multiple ? ['openFile', 'multiSelections'] : ['openFile'];
  const result = await dialog.showOpenDialog({ properties: props, filters: filters || [{ name: 'All Files', extensions: ['*'] }] });
  if (result.canceled || !result.filePaths.length) return multiple ? [] : null;
  return multiple ? result.filePaths : result.filePaths[0];
});

// ── REMOTION RENDER ──────────────────────────────────────────────────────────
ipcMain.handle('remotion:get-system-prompt', () => getSystemPrompt());

ipcMain.handle('remotion:render-code', async (event, { code, outputFilename, outputDir }) => {
  const send = (msg) => { try { event.sender.send('remotion:log', msg); } catch (_) {} };
  try {
    send('📝 Đang ghi file component...');
    const compositionId = writeGeneratedFiles(code);
    send(`🎬 Composition ID: ${compositionId}`);
    const outPath = await remotionRenderVideo(compositionId, outputFilename, send, outputDir || null);
    return { ok: true, path: outPath };
  } catch (err) {
    send(`❌ Lỗi: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('remotion:get-default-output-dir', () => getDefaultOutputDir());

ipcMain.handle('remotion:select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục xuất video',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('remotion:open-dir', async (_, dirPath) => {
  await shell.openPath(dirPath || getDefaultOutputDir());
  return true;
});

ipcMain.handle('remotion:open-video', async (_, filePath) => {
  await shell.openPath(filePath);
  return true;
});

// Trả về đường dẫn public folder của remotion project (để TTS lưu audio)
ipcMain.handle('remotion:get-public-dir', () => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const publicDir = path.join(REMOTION_DIR, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  return publicDir;
});

// Copy file vào remotion/public/{destName} (mặc định narration.wav)
ipcMain.handle('remotion:copy-audio-to-public', async (_, { srcPath, destName }) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const publicDir = path.join(REMOTION_DIR, 'public');
  const destPath = path.join(publicDir, destName || 'narration.wav');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Resolve relative paths từ Remotion public dir (VeoEngine trả về relative path)
  const resolvedSrc = path.isAbsolute(srcPath) ? srcPath : path.join(publicDir, srcPath);

  // Nếu src và dest là cùng một file thì không cần copy
  if (path.resolve(resolvedSrc) === path.resolve(destPath)) return { success: true, destPath };

  // Video: transcode sang H.264 30fps CFR để Remotion render mượt (tránh giật frame)
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(resolvedSrc);
  if (isVideo) {
    try {
      const ffmpegPath = require('ffmpeg-static');
      await new Promise((res, rej) => {
        const proc = require('child_process').spawn(ffmpegPath, [
          '-y', '-i', resolvedSrc,
          // Force 30fps CFR — bắt buộc để Remotion không bị giật khi FPS khác nhau
          '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-r', '30',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-profile:v', 'high', '-level', '4.1',
          '-pix_fmt', 'yuv420p',         // Chrome/Puppeteer cần yuv420p
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
          '-movflags', '+faststart',
          destPath,
        ], { stdio: 'ignore' });
        proc.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
        proc.on('error', rej);
      });
      return { success: true, destPath };
    } catch (_) {
      fs.copyFileSync(resolvedSrc, destPath);
    }
  } else {
    fs.copyFileSync(resolvedSrc, destPath);
  }
  return { success: true, destPath };
});

// Copy file (ảnh/video AI) vào thư mục output để user truy cập trực tiếp
ipcMain.handle('agent:copy-file-to-output', async (_, { src, dest }) => {
  try {
    if (!src || !dest) return { success: false };
    const { REMOTION_DIR } = require('./services/remotion-render');
    // Resolve relative src từ Remotion public nếu cần
    const resolvedSrc = path.isAbsolute(src) ? src : path.join(REMOTION_DIR, 'public', src);
    if (!fs.existsSync(resolvedSrc)) return { success: false, error: 'src not found' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(resolvedSrc, dest);
    return { success: true, destPath: dest };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Copy reference images → remotion/public/ref_N.ext để Gemini code có thể dùng staticFile()
ipcMain.handle('remotion:copy-ref-images-to-public', async (_, { filePaths }) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const publicDir = path.join(REMOTION_DIR, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  const results = [];
  for (let i = 0; i < filePaths.length; i++) {
    const src = filePaths[i];
    const ext = path.extname(src).toLowerCase() || '.jpg';
    const destName = `ref_${i}${ext}`;
    const destPath = path.join(publicDir, destName);
    try { fs.copyFileSync(src, destPath); results.push(destName); }
    catch (e) { results.push(null); }
  }
  return { success: true, files: results };
});

const _refExtMime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', mp4:'video/mp4', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', webm:'video/webm' };

ipcMain.handle('remotion:select-reference-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh/video tham chiếu cho AI',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Ảnh & Video', extensions: ['jpg','jpeg','png','webp','gif','mp4','mov','avi','mkv','webm'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map(fp => {
    const ext = path.extname(fp).slice(1).toLowerCase();
    return { path: fp, name: path.basename(fp), mimeType: _refExtMime[ext] || 'application/octet-stream', size: fs.statSync(fp).size };
  });
});

// Chỉ dùng cho ảnh nhỏ (≤ 10MB) để preview thumbnail
ipcMain.handle('remotion:read-file-base64', async (_, filePath) => {
  const stat = fs.statSync(filePath);
  if (stat.size > 10 * 1024 * 1024) return null; // quá lớn, không đọc
  return fs.readFileSync(filePath).toString('base64');
});

// Upload file lên Gemini File API từ main process (tránh IPC limit với file lớn)
// Tự động kiểm tra và cài đặt Remotion dependencies nếu thiếu
ipcMain.handle('remotion:check-setup', async (event) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const send = (msg) => { try { event.sender.send('remotion:setup-log', msg); } catch (_) {} };
  const results = { nodeModules: false, installed: false };

  // Kiểm tra node_modules
  const nodeModulesPath = path.join(REMOTION_DIR, 'node_modules');
  results.nodeModules = fs.existsSync(nodeModulesPath);

  if (!results.nodeModules) {
    send('📦 Remotion chưa có node_modules — đang chạy npm install...');
    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install'], { cwd: REMOTION_DIR, shell: true });
      proc.stdout.on('data', d => send(d.toString().trimEnd()));
      proc.stderr.on('data', d => send(d.toString().trimEnd()));
      proc.on('close', code => {
        if (code === 0) { results.installed = true; send('✅ npm install hoàn tất!'); resolve(); }
        else reject(new Error(`npm install thất bại (exit ${code})`));
      });
      proc.on('error', err => reject(new Error(`Không chạy được npm: ${err.message}. Cài Node.js tại nodejs.org`)));
    }).catch(err => { send(`❌ ${err.message}`); results.error = err.message; });
  }
  return results;
});

ipcMain.handle('remotion:upload-to-gemini-file-api', async (event, { filePath, mimeType, apiKey }) => {
  const send = (msg) => { try { event.sender.send('remotion:upload-progress', { filePath, msg }); } catch (_) {} };
  const os = require('os');

  // Nén video trước khi upload nếu là video và > 30MB
  let uploadPath = filePath;
  let uploadMime = mimeType;
  let tmpCompressed = null;

  if (mimeType.startsWith('video/')) {
    const originalSize = fs.statSync(filePath).size;
    const COMPRESS_THRESHOLD = 30 * 1024 * 1024; // 30MB
    if (originalSize > COMPRESS_THRESHOLD) {
      send(`🗜 Video lớn (${(originalSize / 1024 / 1024).toFixed(1)} MB), đang nén...`);
      tmpCompressed = path.join(os.tmpdir(), `remotion_ref_${Date.now()}.mp4`);
      await new Promise((resolve, reject) => {
        const args = [
          '-y', '-i', filePath,
          '-vf', 'scale=-2:720',
          '-c:v', 'libx264', '-crf', '28', '-preset', 'fast',
          '-c:a', 'aac', '-b:a', '128k',
          tmpCompressed,
        ];
        const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg thoát code ${code}`)));
        proc.on('error', reject);
      });
      const compressedSize = fs.statSync(tmpCompressed).size;
      send(`✅ Nén xong: ${(originalSize / 1024 / 1024).toFixed(1)} MB → ${(compressedSize / 1024 / 1024).toFixed(1)} MB`);
      uploadPath = tmpCompressed;
      uploadMime = 'video/mp4';
    }
  }

  const fileSize = fs.statSync(uploadPath).size;
  const fileName = path.basename(uploadPath);
  send(`📤 Khởi tạo upload ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

  try {
  // Bước 1: bắt đầu resumable upload session
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileSize),
        'X-Goog-Upload-Header-Content-Type': uploadMime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: fileName } }),
    }
  );
  if (!initRes.ok) throw new Error(`Khởi tạo upload lỗi ${initRes.status}: ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini không trả về upload URL');

  // Bước 2: upload toàn bộ file
  send('📤 Đang truyền dữ liệu lên Gemini...');
  const fileBuffer = fs.readFileSync(uploadPath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(fileSize),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: fileBuffer,
  });
  if (!uploadRes.ok) throw new Error(`Upload lỗi ${uploadRes.status}: ${await uploadRes.text()}`);
  const uploadData = await uploadRes.json();
  let fileInfo = uploadData.file;

  // Bước 3: chờ Gemini xử lý (cần thiết cho video)
  if (uploadMime.startsWith('video/')) {
    send('⏳ Gemini đang xử lý video...');
    let attempts = 0;
    while (fileInfo.state === 'PROCESSING' && attempts < 60) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileInfo.name}?key=${apiKey}`
      );
      fileInfo = await pollRes.json();
      attempts++;
      send(`⏳ Xử lý video... ${attempts * 3}s`);
    }
    if (fileInfo.state === 'FAILED') throw new Error('Gemini xử lý video thất bại');
  }

  send(`✅ Upload xong: ${fileName}`);
  return { uri: fileInfo.uri, mimeType: uploadMime };
  } finally {
    if (tmpCompressed) try { fs.unlinkSync(tmpCompressed); } catch (_) {}
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AI VIDEO REMIXER — Pipeline handlers
// ══════════════════════════════════════════════════════════════════════════════

// Probe video metadata via ffprobe
ipcMain.handle('remixer:probe-video', async (_, { videoPath }) => {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath];
    const proc = spawn(ffprobePath, args, { stdio: 'pipe' });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe thất bại'));
      try {
        const info = JSON.parse(out);
        const vs = info.streams?.find(s => s.codec_type === 'video') || {};
        const fmt = info.format || {};
        const [num, den] = (vs.r_frame_rate || '30/1').split('/').map(Number);
        resolve({
          duration: parseFloat(fmt.duration || 0),
          size: parseInt(fmt.size || 0),
          fps: Math.round((num || 30) / (den || 1)),
          width: vs.width || 1920,
          height: vs.height || 1080,
          bitrate: parseInt(fmt.bit_rate || 0),
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
});

// Probe audio duration
ipcMain.handle('remixer:get-audio-duration', async (_, { audioPath }) => {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', audioPath];
    const proc = spawn(ffprobePath, args, { stdio: 'pipe' });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return resolve(0);
      try { resolve(parseFloat(JSON.parse(out).format?.duration || 0)); } catch { resolve(0); }
    });
    proc.on('error', () => resolve(0));
  });
});

// Cut a clip from original video (no audio — narration is separate track)
ipcMain.handle('remixer:cut-clip', async (event, { inputPath, startSec, endSec, outputPath }) => {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const dur = Math.max(0.1, endSec - startSec);
    // -ss before -i = fast seek; -c copy = lossless, no re-encode
    const args = ['-y', '-ss', String(startSec), '-i', inputPath, '-t', String(dur), '-c', 'copy', '-an', outputPath];
    const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Cut clip thất bại: ${stderr.slice(-300)}`));
    });
    proc.on('error', reject);
  });
});

// Write edit-plan.json to remotion/src/remixer/
ipcMain.handle('remixer:write-plan', async (_, { plan }) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const planPath = path.join(REMOTION_DIR, 'src', 'remixer', 'edit-plan.json');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
  return { success: true, planPath };
});

// Render remixer video via Remotion CLI
ipcMain.handle('remixer:render', async (event, { outputPath }) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const stripAnsi = (s) => s.replace(/\x1B\[[\d;]*[A-Za-z]/g, '').replace(/\x1B[()][0-9A-Za-z]/g, '');
    const qp = (p) => (p.includes(' ') ? `"${p}"` : p);
    const entryFile = path.join('src', 'remixer', 'RemixerIndex.jsx');
    const args = ['remotion', 'render', qp(entryFile), 'RemixerVideo', qp(outputPath)];
    event.sender.send('remixer:log', `▶ npx ${args.join(' ')}`);
    event.sender.send('remixer:log', `📁 Output: ${outputPath}`);
    // Chỉ gửi mốc 10% thay vì mỗi frame; strip ANSI
    let lastRendM = -1, lastEncM = -1;
    const sink = (raw) => {
      const line = stripAnsi(raw.toString()).trimEnd();
      if (!line || /^\s*$|^Bundling|webpack|compiled|chunk|asset size|module|entrypoint/i.test(line)) return;
      const rm = line.match(/Rendered\s+(\d+)\/(\d+)/i);
      if (rm) {
        const cur = parseInt(rm[1]), tot = parseInt(rm[2]);
        if (tot > 0) {
          const pct = Math.floor((cur / tot) * 100);
          const ms = Math.floor(pct / 10) * 10;
          if (ms === lastRendM && cur !== tot) return;
          lastRendM = ms;
          const eta = line.match(/time remaining:\s*(.+)/i)?.[1] || '';
          event.sender.send('remixer:log', `⚙️ Render ${cur}/${tot} (${pct}%)${eta ? ' · còn ' + eta : ''}`);
          return;
        }
      }
      const em = line.match(/Encoded\s+(\d+)\/(\d+)/i);
      if (em) {
        const cur = parseInt(em[1]), tot = parseInt(em[2]);
        if (tot > 0) {
          const pct = Math.floor((cur / tot) * 100);
          const ms = Math.floor(pct / 10) * 10;
          if (ms === lastEncM && cur !== tot) return;
          lastEncM = ms;
          event.sender.send('remixer:log', `🔧 Encode ${cur}/${tot} (${pct}%)`);
          return;
        }
      }
      event.sender.send('remixer:log', line);
    };
    const proc = spawn('npx', args, { cwd: REMOTION_DIR, shell: true });
    proc.stdout.on('data', d => sink(d));
    proc.stderr.on('data', d => sink(d));
    proc.on('close', code => {
      if (code === 0) resolve({ success: true, outputPath });
      else reject(new Error(`Remotion exited code ${code}`));
    });
    proc.on('error', err => reject(new Error(`npx error: ${err.message}`)));
  });
});

// Get default remixer output directory
ipcMain.handle('remixer:get-output-dir', () => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const dir = path.join(REMOTION_DIR, 'out', 'remixer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
});

// ── AGENT: Generate illustration via Remotion still ──────────────────────────
// ── Audio ducking: mix video voice + background music with sidechain compress ──
ipcMain.handle('agent:mix-audio-ducking', async (event, { videoPath, musicPath, outputPath, options }) => {
  try {
    const result = await mixAudioWithDucking(videoPath, musicPath, outputPath, options || {});
    return { success: true, outputPath: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Mix SFX list vào video bằng ffmpeg ─────────────────────────────────────────
ipcMain.handle('agent:mix-sfx-list', async (event, { videoPath, sfxList, outputPath }) => {
  try {
    if (!sfxList?.length) return { success: false, error: 'No SFX' };
    const _ffmpeg = require('ffmpeg-static');
    const { spawn: _spawn } = require('child_process');
    const https = require('https');

    // Thư mục cache SFX tải từ Pixabay
    const sfxDir = path.join(__dirname, '..', '..', 'assets', 'sfx');
    fs.mkdirSync(sfxDir, { recursive: true });
    const pixabayKey = await db.getSetting('pixabay_api_key', '');

    // Map sfx_id → từ khóa tìm kiếm Pixabay
    const SFX_KEYWORDS = {
      whoosh_01: 'whoosh fast', whoosh_02: 'whoosh medium', whoosh_03: 'swoosh heavy',
      reverse_whoosh_01: 'reverse whoosh', reverse_whoosh_02: 'whoosh riser',
      riser_01: 'riser build up', riser_02: 'tension riser',
      downlifter_01: 'downlifter drop', pop_01: 'pop click', pop_02: 'pop bubble',
      impact_01: 'impact hit', impact_02: 'impact boom', impact_03: 'impact explosion',
      deep_hit_01: 'deep bass hit', deep_hit_02: 'thud deep',
      bass_drop_01: 'bass drop', metal_hit_01: 'metal clang', metal_hit_02: 'metallic impact',
      drone_01: 'drone cinematic', drone_02: 'dark drone ambient',
      heartbeat_01: 'heartbeat', heartbeat_02: 'heartbeat fast',
      mechanical_01: 'mechanical click', mechanical_02: 'machine noise',
      page_01: 'page turn', paper_01: 'paper rustle',
      glitch_01: 'glitch digital', scan_01: 'scan beep', buzz_01: 'electric buzz',
      tick_01: 'clock tick', notification_01: 'notification ding',
      success_01: 'success achievement chime', error_01: 'error fail beep',
      birds_01: 'birds chirping', rain_01: 'rain ambient', wind_01: 'wind ambient',
    };

    // Resolve sfx_id → đường dẫn file, tải từ Pixabay Sounds nếu chưa có cache
    const resolveSfxFile = async (sfxId) => {
      if (!sfxId) return null;
      const cached = path.join(sfxDir, `${sfxId}.mp3`);
      if (fs.existsSync(cached) && fs.statSync(cached).size > 1024) return cached;
      if (!pixabayKey) return null;
      try {
        const kw = SFX_KEYWORDS[sfxId] || sfxId.replace(/_\d+$/, '').replace(/_/g, ' ');
        const apiUrl = `https://pixabay.com/api/sounds/?key=${pixabayKey}&q=${encodeURIComponent(kw)}&per_page=5`;
        const data = await new Promise((resolve, reject) => {
          const req = https.get(apiUrl, res => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', d => { buf += d; });
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
            res.on('error', reject);
          });
          req.on('error', reject);
          req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
        });
        const hits = data?.hits || [];
        if (!hits.length) return null;
        const audioUrl = hits[0].previewURL;
        if (!audioUrl) return null;
        await new Promise((resolve, reject) => {
          const dl = (url, redirects = 0) => {
            if (redirects > 3) { reject(new Error('too many redirects')); return; }
            https.get(url, res => {
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                dl(res.headers.location, redirects + 1); return;
              }
              const file = fs.createWriteStream(cached);
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
              res.on('error', err => { fs.unlink(cached, () => {}); reject(err); });
            }).on('error', err => { fs.unlink(cached, () => {}); reject(err); });
          };
          dl(audioUrl);
        });
        return fs.existsSync(cached) && fs.statSync(cached).size > 1024 ? cached : null;
      } catch (_) { return null; }
    };

    // Build ffmpeg filter: amix each SFX file at its timestamp
    const inputs = ['-i', videoPath];
    const filters = [];
    let addedCount = 0; // số SFX thực sự được thêm vào

    for (const sfx of sfxList) {
      let sfxFile = sfx.file || sfx.path;
      // Resolve sfx_id → file nếu chưa có đường dẫn trực tiếp
      if (!sfxFile || !fs.existsSync(sfxFile)) {
        sfxFile = await resolveSfxFile(sfx.id || sfx.sfx_id);
      }
      if (!sfxFile || !fs.existsSync(sfxFile)) continue; // bỏ qua, KHÔNG tăng index
      const inputIdx = addedCount + 1; // ffmpeg input index (0=video, 1..n=sfx)
      const atSec = sfx.at_sec ?? sfx.at ?? 0;
      const vol = sfx.volume ?? 0.65;
      inputs.push('-i', sfxFile);
      filters.push(`[${inputIdx}:a]adelay=${Math.round(atSec * 1000)}|${Math.round(atSec * 1000)},volume=${vol}[sfx${inputIdx}]`);
      addedCount++;
    }

    if (addedCount === 0) return { success: false, error: 'No valid SFX files found' };

    // Mix original audio với tất cả SFX streams
    const sfxStreams = Array.from({ length: addedCount }, (_, i) => `[sfx${i + 1}]`);
    const mixInputs = `[0:a]${sfxStreams.join('')}`;
    const fullFilter = [...filters, `${mixInputs}amix=inputs=${addedCount + 1}:duration=first:dropout_transition=0[aout]`].join(';');

    const args = [
      '-y', ...inputs,
      '-filter_complex', fullFilter,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      const proc = _spawn(_ffmpeg, args);
      proc.on('close', c => c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}`)));
      proc.on('error', reject);
    });

    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('agent:render-illustration', async (event, { narration, topic, style, segId, apiKey, outputDir, refImagePaths = [], format }) => {
  const logs = [];
  const sendLog = (msg) => {
    logs.push(msg);
    event.sender.send('agent:illustration-log', { segId, msg });
  };
  try {
    const filePath = await generateIllustration({ narration, topic, style, segId, apiKey, outputDir, refImagePaths, format, sendLog });
    return { success: true, file: filePath };
  } catch (err) {
    return { success: false, error: err.message, logs };
  }
});

// ── AGENT: Find background music by mood ─────────────────────────────────────
ipcMain.handle('agent:find-music', async (_, mood) => {
  const musicDir = path.join(__dirname, '..', '..', 'assets', 'music');
  fs.mkdirSync(musicDir, { recursive: true });

  const moodKeywords = {
    upbeat:     ['upbeat','happy','energetic','fun','positive','bright'],
    dramatic:   ['dramatic','intense','powerful','tension','action'],
    calm:       ['calm','peaceful','gentle','soft','relax','ambient'],
    inspiring:  ['inspiring','motivational','uplifting','hope','success'],
    mysterious: ['mysterious','dark','suspense','eerie','unknown'],
    cinematic:  ['cinematic','epic','orchestral','film','score'],
    emotional:  ['emotional','sad','touching','heartfelt','tender'],
    corporate:  ['corporate','business','professional','tech','clean'],
    epic:       ['epic','grand','powerful','majestic','triumphant'],
    lofi:       ['lofi','lo-fi','chill','study','relaxed','mellow'],
  };
  const keywords = moodKeywords[mood] || [mood];

  // 1. Check local cache first
  const allFiles = fs.readdirSync(musicDir).filter(f => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f));
  const matched = allFiles.find(f => keywords.some(kw => f.toLowerCase().includes(kw)));
  if (matched) return path.join(musicDir, matched);
  if (allFiles.length > 0) return path.join(musicDir, allFiles[Math.floor(Math.random() * allFiles.length)]);

  const https = require('https');
  const httpsGet = (url) => new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
  const downloadToFile = (audioUrl, destPath) => new Promise((resolve, reject) => {
    const dl = (url, redirects = 0) => {
      if (redirects > 5) { reject(new Error('too many redirects')); return; }
      https.get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          dl(res.headers.location, redirects + 1); return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        res.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
    };
    dl(audioUrl);
  });

  // 2. Tìm nhạc trên Pixabay Sounds API (ưu tiên nếu có key)
  const pixabayKey = await db.getSetting('pixabay_api_key', '');
  if (pixabayKey) {
    try {
      const q = keywords.slice(0, 2).join(' ');
      const apiUrl = `https://pixabay.com/api/sounds/?key=${pixabayKey}&q=${encodeURIComponent(q)}&per_page=5`;
      const data = await httpsGet(apiUrl);
      const hits = data?.hits || [];
      if (hits.length) {
        const track = hits[0];
        const audioUrl = track.previewURL;
        if (audioUrl) {
          const safeMood = (mood || 'music').replace(/[^a-z0-9]/gi, '_');
          const destPath = path.join(musicDir, `${safeMood}_pixabay_${track.id}.mp3`);
          await downloadToFile(audioUrl, destPath);
          if (fs.existsSync(destPath) && fs.statSync(destPath).size > 10000) return destPath;
        }
      }
    } catch (_) { /* tiếp tục fallback */ }
  }

  // 3. Fallback: Jamendo free music (Creative Commons, no key needed)
  try {
    const jamendoQuery = keywords.slice(0, 2).join('+');
    const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=5847f5bd&format=json&limit=3&tags=${encodeURIComponent(jamendoQuery)}&audioformat=mp31&include=musicinfo&boost=popularity_month`;
    const data = await httpsGet(jamendoUrl);

    const tracks = data?.results || [];
    if (!tracks.length) return null;

    const track = tracks[0];
    const audioUrl = track.audio;
    if (!audioUrl) return null;

    const safeMood = (mood || 'music').replace(/[^a-z0-9]/gi, '_');
    const trackId = track.id || Date.now();
    const destPath = path.join(musicDir, `${safeMood}_jamendo_${trackId}.mp3`);
    await downloadToFile(audioUrl, destPath);

    return destPath;
  } catch (_) {
    // Music not available — video will render without background music
    return null;
  }
});

// ── AGENT: Save reference images from base64 to temp disk ────────────────────
ipcMain.handle('agent:save-ref-images', async (_, { images }) => {
  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), 'fluxy-agent-refs');
  fs.mkdirSync(tmpDir, { recursive: true });
  const paths = [];
  for (const img of (images || [])) {
    if (!img.mimeType?.startsWith('image/')) continue;
    const ext = img.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const filePath = path.join(tmpDir, `ref_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(img.data, 'base64'));
    paths.push(filePath);
  }
  return { success: true, paths };
});

// ── AGENT: Acquire B-roll (search local → AI generate fallback) ──────────────
ipcMain.handle('agent:acquire-broll', async (_, { query, segmentId, durationSec, mode = 'video', veoModel = 'Veo 3.1 - Lite [Lower Priority]', refImagePaths = [], voiceId = null }) => {
  const { REMOTION_DIR } = require('./services/remotion-render');
  const brollPublicDir = path.join(REMOTION_DIR, 'public', 'broll');
  if (!fs.existsSync(brollPublicDir)) fs.mkdirSync(brollPublicDir, { recursive: true });

  const destName = `seg_${String(segmentId).padStart(3, '0')}.mp4`;
  const destPath = path.join(brollPublicDir, destName);

  // ffprobe helper — reuse ffprobePath already defined at module scope
  const getVideoDur = (p) => new Promise(res => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', p];
    const proc = spawn(ffprobePath, args, { stdio: 'pipe' });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', () => { try { res(parseFloat(JSON.parse(out).format?.duration || 0)); } catch { res(0); } });
    proc.on('error', () => res(0));
  });

  // 1. Search local assets/broll/ by keyword match
  const localBrollDir = path.join(__dirname, '..', '..', 'assets', 'broll');
  if (fs.existsSync(localBrollDir)) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const files = fs.readdirSync(localBrollDir).filter(f => /\.(mp4|mov|webm|mkv)$/i.test(f));
    const match = files.find(f => {
      const name = f.toLowerCase().replace(/[_\-]/g, ' ');
      return queryWords.some(w => name.includes(w));
    });
    if (match) {
      const srcPath = path.join(localBrollDir, match);
      fs.copyFileSync(srcPath, destPath);
      const dur = await getVideoDur(destPath);
      return { success: true, file: `broll/${destName}`, duration: dur };
    }
  }

  // 2. Also search remotion/public/broll/ for previously generated clips
  const existingFiles = fs.existsSync(brollPublicDir)
    ? fs.readdirSync(brollPublicDir).filter(f => /\.(mp4|mov|webm)$/i.test(f))
    : [];
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const existMatch = existingFiles.find(f => {
    const name = f.toLowerCase().replace(/[_\-]/g, ' ');
    return queryWords.some(w => name.includes(w));
  });
  if (existMatch) {
    const srcPath = path.join(brollPublicDir, existMatch);
    if (srcPath !== destPath) fs.copyFileSync(srcPath, destPath);
    const dur = await getVideoDur(destPath);
    return { success: true, file: `broll/${destName}`, duration: dur };
  }

  // 3. Generate via VeoEngine — requires Chrome extension connected
  try {
    const auth = global.googleLabsAuth;
    // Image mode: Flow API (ogiZ0b) chỉ cần cookie + atToken/projectId, KHÔNG cần bearerToken
    // Video mode: cần cookie hoặc bearerToken (VeoEngine tự chọn path)
    const hasImageAuth = auth?.cookie && (auth?.atToken || auth?.projectId);
    const hasVideoAuth = auth?.cookie || auth?.bearerToken;
    if (mode === 'image' ? hasImageAuth : hasVideoAuth) {
      const taskId = `broll_${segmentId}_${Date.now()}`;

      if (mode === 'image') {
        // Tạo ảnh AI (nhanh hơn T2V)
        if (!auth.projectId) return { success: false, error: 'Chưa có projectId — F5 Google Labs' };
        const imagesDir = path.join(REMOTION_DIR, 'public', 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        const aiPrompt = `${query}, cinematic still, professional photography, high quality, no text overlay, no watermark`;
        // Try with reference images first; if fail → fallback without
        const refAttempts = refImagePaths?.length > 0 ? [refImagePaths, []] : [[]];
        for (const refs of refAttempts) {
          const imgTask = { id: taskId, prompt: aiPrompt };
          if (refs.length) imgTask.referenceImages = refs;
          let imgResult;
          try {
            imgResult = await VeoEngine.run({
              mediaType: 'Image',
              tasks: [imgTask],
              model: 'Nano Banana Pro',
              genCount: '1x',
              quality: '1K',
              outputFolder: imagesDir,
              aspectRatio: '16:9',
            }, () => {});
          } catch (e) {
            console.warn('[agent:acquire-broll] Image attempt with refs failed:', e?.message);
            continue;
          }
          if (imgResult?.success) {
            const files = Array.isArray(imgResult.files) ? imgResult.files : [];
            const good = files.find(r => !r.isError && r.filePath);
            if (good) {
              const imgName = `broll_seg_${String(segmentId).padStart(3, '0')}${path.extname(good.filePath) || '.png'}`;
              const imgDest = path.join(imagesDir, imgName);
              try { fs.renameSync(good.filePath, imgDest); } catch { fs.copyFileSync(good.filePath, imgDest); try { fs.unlinkSync(good.filePath); } catch (_) {} }
              return { success: true, type: 'ai_image', file: `images/${imgName}`, absolutePath: imgDest };
            }
          }
        }
      } else {
        // Tạo video T2V/R2V — fallback: with ingredients first, then without
        const isOmni = veoModel.includes('Omni');
        const durSec = isOmni ? Math.min(10, Math.ceil(durationSec || 10)) : Math.min(8, Math.ceil(durationSec || 8));

        // Build base prompt
        let aiPrompt = `${query}, cinematic documentary footage, professional camera work, smooth motion, no text overlay, no watermark`;

        const refAttempts = refImagePaths?.length > 0 ? [refImagePaths, []] : [[]];
        for (const refs of refAttempts) {
          const videoTask = {
            id: taskId,
            prompt: aiPrompt,
            duration: `${durSec}s`,
            aspectRatio: '16:9',
          };
          if (refs.length) videoTask.ingredientImages = refs;
          if (voiceId) videoTask.voiceId = voiceId; // always apply voiceId when provided
          let veoResult;
          try {
            veoResult = await VeoEngine.run({
              mediaType: 'Video',
              tasks: [videoTask],
              model: veoModel,
              genCount: 1,
              quality: '720p',
              outputFolder: brollPublicDir,
              duration: `${durSec}s`,
              aspectRatio: '16:9',
            }, () => {});
          } catch (e) {
            console.warn('[agent:acquire-broll] Video attempt with refs failed:', e?.message);
            continue;
          }
          if (veoResult?.success) {
            const files = Array.isArray(veoResult.files) ? veoResult.files : [];
            const good = files.find(r => !r.isError && (r.filePath || r.videoPath));
            if (good) {
              const srcPath = good.filePath || good.videoPath;
              if (srcPath !== destPath) {
                try { fs.renameSync(srcPath, destPath); } catch { fs.copyFileSync(srcPath, destPath); try { fs.unlinkSync(srcPath); } catch (_) {} }
              }
              const dur = await getVideoDur(destPath);
              return { success: true, type: 'broll', file: `broll/${destName}`, duration: dur };
            }
          }
        }
      }
    }
  } catch (veoErr) {
    console.error('[agent:acquire-broll] VeoEngine error:', veoErr?.message || veoErr);
  }

  // Auth chưa set → extension chưa kết nối Google Labs
  const auth2 = global.googleLabsAuth;
  const noAuth = !auth2?.atToken && !auth2?.bearerToken && !auth2?.projectId;
  return {
    success: false,
    error: noAuth
      ? 'Extension chưa kết nối Google VideoFX — Mở Chrome → flow.google.com với FluxyExtension bật → F5 để bắt Token'
      : 'Veo không tạo được file — kiểm tra Google Labs đang mở và Extension hoạt động',
  };
});

// ── Voice preview via Flow no0P6 RPC ─────────────────────────────────────────
ipcMain.handle('voice:preview', async (_, { voiceId, text = 'xin chào' }) => {
  const auth = global.googleLabsAuth;
  if (!auth?.cookie || !auth?.projectId) {
    return { success: false, error: 'Extension chưa kết nối Google Labs' };
  }
  try {
    // Voice ID must be capitalized: "Rasalgethi" not "rasalgethi"
    const capVoice = voiceId.charAt(0).toUpperCase() + voiceId.slice(1);
    const innerData = JSON.stringify([
      [[text, [[capVoice, `${capVoice} tuỳ chỉnh`]], 'gemini_v4s_tts_flow', null, 2]],
      [null, 22, null, null, null, auth.projectId, null, null, null, null, ['', 1]]
    ]);
    const freq = JSON.stringify([[['no0P6', innerData, null, 'generic']]]);
    const atToken = auth.atToken || auth.at || '';
    const raw = await VeoEngine.flowBatchPost('no0P6', freq, auth, atToken);
    if (!raw) return { success: false, error: 'Không nhận được response' };

    // Parse batchexecute response: find "wrb.fr","no0P6","<data>"
    const stripped = raw.replace(/^\)\]}'[\r\n]+/, '');
    const match = stripped.match(/"wrb\.fr","no0P6","((?:[^"\\]|\\.)*)"/);
    if (!match) return { success: false, error: 'Không parse được response' };
    const jsonStr = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch { return { success: false, error: 'JSON parse lỗi' }; }

    // Response structure: [[audioBase64, mimeType, ...], ...]
    const audioB64 = parsed?.[0]?.[0] || parsed?.[0] || null;
    if (!audioB64 || typeof audioB64 !== 'string') return { success: false, error: 'Không có audio trong response' };
    return { success: true, audioBase64: audioB64, mimeType: 'audio/mp3' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Thumbnail render via Remotion renderStill ─────────────────────────────────
ipcMain.handle('agent:render-thumbnail', async (_, { thumbnailData, outputPath }) => {
  try {
    const finalPath = await renderThumbnail({ thumbnailData, outputPath });
    return { success: true, path: finalPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Cleanup output dir — keep final video, SEO txt, thumbnail ─────────────────
ipcMain.handle('agent:cleanup-output', async (_, { outputDir, keepFiles = [], seoText, seoPath }) => {
  try {
    // Write SEO text file if provided
    if (seoText && seoPath) {
      fs.mkdirSync(path.dirname(seoPath), { recursive: true });
      fs.writeFileSync(seoPath, seoText, 'utf8');
    }

    // Delete remotion/public temp dirs
    const { REMOTION_DIR } = require('./services/remotion-render');
    const dirsToClean = ['tts', 'broll', 'images'].map(d => path.join(REMOTION_DIR, 'public', d));
    for (const dir of dirsToClean) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
        }
      }
    }

    // Delete intermediate video files in outputDir (keep keepFiles)
    const keepSet = new Set(keepFiles.map(f => path.resolve(f)));
    if (outputDir && fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir).filter(f => /\.(mp4|mov|wav|jpg|jpeg|png|webm|ts|aac|m4a)$/i.test(f));
      for (const f of files) {
        const full = path.resolve(path.join(outputDir, f));
        if (!keepSet.has(full)) {
          try { fs.unlinkSync(full); } catch (_) {}
        }
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

