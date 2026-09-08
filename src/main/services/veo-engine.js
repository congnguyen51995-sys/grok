const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const https = require('https');

// Convert WebP/PNG → JPEG dùng Electron nativeImage (main process only)
function convertToJpeg(srcPath, quality = 92) {
    try {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromPath(srcPath);
        if (img.isEmpty()) return srcPath; // không đọc được → giữ nguyên
        const jpegBuf = img.toJPEG(quality);
        const jpgPath = srcPath.replace(/\.(webp|png|bmp)$/i, '.jpg');
        fs.writeFileSync(jpgPath, jpegBuf);
        if (jpgPath !== srcPath) {
            try { fs.unlinkSync(srcPath); } catch (_) {}
        }
        return jpgPath;
    } catch (_) {
        return srcPath; // fallback: giữ nguyên nếu convert lỗi
    }
}

// ── Veo Prompt Sanitizer — chặn PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED ──
// Chạy trong main process TRƯỚC khi gửi prompt lên Veo API (lớp phòng thủ cuối)
const _VEO_SAFE_SUFFIX = ', no real people, no celebrities, no public figures, safe for all audiences, family-friendly';

// Từ khoá vi phạm chính sách Veo — thay thế bằng từ an toàn
const _POLICY_REPLACEMENTS = [
  // Vị thành niên / trẻ em trong ngữ cảnh nhạy cảm
  [/\b(minor|minors|underage|child|children|kid|kids|teen|teens|teenager|teenagers|juvenile|toddler|baby|infant|boy|girl)\b/gi, 'person'],
  [/\b(young\s+(girl|boy|woman|man|person))\b/gi, 'person'],
  [/\b(little\s+(girl|boy|kid|child))\b/gi, 'person'],
  // Bạo lực / vũ khí
  [/\b(kill|killing|murder|murdered|shoot|shooting|stab|stabbing|weapon|weapons|gun|guns|rifle|knife|bomb|explosion|violence|violent|blood|bloody|gore|dead body|corpse)\b/gi, ''],
  // Nội dung người lớn
  [/\b(nude|naked|explicit|sexual|sexy|seductive|erotic|porn|pornographic|lingerie|swimsuit|bikini|underwear|intimate|sensual)\b/gi, ''],
  // Cờ bạc / ma túy
  [/\b(gambling|casino|drug|drugs|cocaine|marijuana|alcohol|drunk|intoxicated|cigarette|smoking|weed|heroin|meth)\b/gi, ''],
  // Nội dung thù ghét / phân biệt
  [/\b(racist|racism|hate|hatred|discriminat\w+|slur|offensive|extremist|terrorist|terrorism)\b/gi, ''],
];

function sanitizeVeoPrompt(prompt) {
  if (!prompt) return prompt;
  let p = String(prompt);
  _PERSON_NAMES_RE.forEach(re => { p = p.replace(re, 'a person'); });
  // Thay thế từ vi phạm chính sách
  _POLICY_REPLACEMENTS.forEach(([re, replacement]) => { p = p.replace(re, replacement); });
  // Thêm suffix nếu chưa có
  if (!p.includes('no real people') && !p.includes('no celebrities')) p += _VEO_SAFE_SUFFIX;
  return p.replace(/\s{2,}/g, ' ').trim();
}

const _PERSON_NAMES_RE = [
  // Công nghệ / Kinh doanh
  /\b(Elon Musk|Musk|Jeff Bezos|Bezos|Bill Gates|Gates|Steve Jobs|Jobs|Mark Zuckerberg|Zuckerberg|Tim Cook|Sundar Pichai|Sam Altman|Jack Ma|Warren Buffett|Buffett|Jensen Huang)\b/gi,
  // Chính trị
  /\b(Joe Biden|Biden|Donald Trump|Trump|Barack Obama|Obama|Hillary Clinton|Clinton|Vladimir Putin|Putin|Xi Jinping|Jinping|Boris Johnson|Emmanuel Macron|Macron|Angela Merkel|Merkel|Justin Trudeau|Trudeau|Volodymyr Zelensky|Zelensky|Narendra Modi|Modi)\b/gi,
  // Giải trí / Nhạc
  /\b(Taylor Swift|Swift|Beyoncé|Beyonce|Justin Bieber|Bieber|Adele|Ed Sheeran|Rihanna|Lady Gaga|Gaga|Eminem|Drake|Ariana Grande|Grande|Billie Eilish|Eilish|The Weeknd|Bruno Mars|Sơn Tùng|Son Tung|Mỹ Tâm)\b/gi,
  /\b(Tom Hanks|Hanks|Leonardo DiCaprio|DiCaprio|Brad Pitt|Pitt|Angelina Jolie|Jolie|Scarlett Johansson|Johansson|Robert Downey|Will Smith|Keanu Reeves|Tom Cruise|Cruise)\b/gi,
  // Thể thao
  /\b(Cristiano Ronaldo|Ronaldo|Lionel Messi|Messi|LeBron James|LeBron|Michael Jordan|Jordan|Kobe Bryant|Kobe|Neymar|Roger Federer|Federer|Serena Williams|Usain Bolt|Tiger Woods|Muhammad Ali|Ali|Pelé|Pele)\b/gi,
  // Lịch sử / Học thuật
  /\b(Albert Einstein|Einstein|Isaac Newton|Newton|Stephen Hawking|Hawking|Nikola Tesla|Tesla|Charles Darwin|Darwin|Nelson Mandela|Mandela|Mahatma Gandhi|Gandhi|Martin Luther King|Abraham Lincoln|Lincoln|Winston Churchill|Churchill|Napoleon|Julius Caesar|Caesar|Cleopatra|Shakespeare)\b/gi,
  // Mô tả nhận dạng được
  /\b(founder|co-founder|CEO|owner|creator|inventor)\s+of\s+(Tesla|SpaceX|Apple|Google|Facebook|Meta|Amazon|Microsoft|Twitter|YouTube|Netflix|Uber|Airbnb|OpenAI|PayPal|eBay)\b/gi,
  /\b(world'?s?\s+)?(richest|most famous|most powerful|wealthiest|most influential)\s+(person|man|woman|billionaire|entrepreneur|athlete|leader)\b/gi,
  // Tước hiệu + tên
  /\b(President|CEO|CFO|CTO|Chairman|Senator|Governor|Prime Minister)\s+[A-Z][a-z]+\b/g,
  /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sir|Dame)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
];


// Mutex để serialize các Extension upload — kênh pendingImageUpload/uploadedMediaId
let _extensionUploadLock = Promise.resolve();
// Mutex để serialize Extension API calls (video gen) — kênh pendingVideoGen/videoGenResult
let _extensionApiLock = Promise.resolve();
// Mutex để serialize recaptcha acquisition (global.googleLabsAuth.recaptchaToken là shared state)
let _recaptchaLock = Promise.resolve();
// Mutex để serialize resolveMediaViaExtension — kênh resolveMediaRequest/resolvedMediaUrl
let _resolveMediaLock = Promise.resolve();
// Mutex để serialize downloadViaExtension — kênh pendingVideoDownload là single slot
let _downloadViaExtLock = Promise.resolve();

class VeoEngine {
    static _paused = false;
    static pause()  { this._paused = true;  console.log('[VeoEngine] paused'); }
    static resume() { this._paused = false; console.log('[VeoEngine] resumed'); }
    static clearUploadCache() { VeoEngine._imageUploadCache.clear(); console.log('[VeoEngine] upload cache cleared'); }

    // Mutex cho Flow Extension calls — chỉ 1 task được ghi pending* tại một thời điểm
    // (extension chỉ xử lý 1 lệnh, nhiều worker ghi đè nhau → sai kết quả)
    static _flowExtMutexQueue = Promise.resolve();
    static _withFlowExtMutex(fn) {
        let release;
        const prev = VeoEngine._flowExtMutexQueue;
        VeoEngine._flowExtMutexQueue = new Promise(r => { release = r; });
        return prev.then(() => fn()).finally(() => release());
    }


    static async checkCookie() {
        try {
            const TIMEOUT = 15000;
            const INTERVAL = 500;
            const start = Date.now();
            while (Date.now() - start < TIMEOUT) {
                const auth = global.googleLabsAuth;
                // Chấp nhận: bearer (cũ) HOẶC cookie + projectId (flow.google.com mới)
                if (auth && (auth.bearerToken || (auth.cookie && auth.projectId))) {
                    return { success: true, credits: "API Mode (Sẵn sàng)" };
                }
                await new Promise(r => setTimeout(r, INTERVAL));
            }
            return { success: false, error: "Chưa kết nối Extension. Mở Chrome → flow.google.com → bật FluxyExtension." };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async fetchAPI(url, method = 'POST', body = null) {
        const auth = global.googleLabsAuth;
        if (!auth || !auth.bearerToken) throw new Error("Mất kết nối Token từ Extension");

        const headers = {};

        // Hấp thụ toàn bộ vân tay mạng từ Chrome
        if (auth.rawHeaders && Array.isArray(auth.rawHeaders)) {
            auth.rawHeaders.forEach(h => {
                const name = h.name.toLowerCase();
                if (!['content-length', 'accept-encoding', 'host', 'connection'].includes(name)) {
                    headers[name] = h.value;
                }
            });
        }

        // Bổ sung các Header thiết yếu
        if (!headers['accept']) headers['accept'] = '*/*';
        if (!headers['content-type']) headers['content-type'] = 'application/json';
        headers['authorization'] = `Bearer ${auth.bearerToken}`;
        if (!headers['cookie']) headers['cookie'] = auth.cookie;
        if (!headers['origin']) headers['origin'] = 'https://labs.google';
        if (!headers['referer']) headers['referer'] = 'https://labs.google/';
        if (!headers['user-agent']) headers['user-agent'] = auth.userAgent;

        const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr).toString();

        // API calls luôn dùng kết nối trực tiếp — proxy chỉ dùng cho CAPTCHA (CapSolver)
        // Proxy không trả về response HTTPS đúng cách → gây treo vô hạn
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const req = https.request({
                hostname: parsedUrl.hostname,
                path:     parsedUrl.pathname + parsedUrl.search,
                method,
                headers,
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); } catch { resolve(data); }
                    } else {
                        if (res.statusCode === 403 && data.includes('reCAPTCHA')) {
                            // Xóa token ngay → acquireRecaptcha sẽ request token mới thay vì tái dùng token hỏng
                            global.googleLabsAuth.recaptchaToken = null;
                            const e = new Error('RECAPTCHA_EXPIRED');
                            e.isRecaptchaExpired = true;
                            return reject(e);
                        }
                        if (res.statusCode === 401 || (res.statusCode === 403 && !data.includes('reCAPTCHA'))) {
                            // Bearer token hết hạn — cần F5 Google Labs để Extension capture token mới
                            global.googleLabsAuth.bearerToken = null;
                            global.googleLabsAuth.recaptchaToken = null;
                            const e = new Error(`BEARER_TOKEN_EXPIRED:${res.statusCode}`);
                            e.isBearerExpired = true;
                            e.isRecaptchaExpired = true; // dùng lại cơ chế reload hiện có
                            return reject(e);
                        }
                        const errBody = data.substring(0, 300);
                        console.error(`[fetchAPI] ${res.statusCode} → ${errBody}`);
                        const err = new Error(`API Error ${res.statusCode}: ${errBody}`);
                        err.statusCode = res.statusCode;
                        reject(err);
                    }
                });
            });
            req.on('error', reject);
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    // Random delay helper — dùng cho anti-spam jitter
    static randDelay(minMs, maxMs) {
        const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return new Promise(r => setTimeout(r, ms));
    }

    // Serialize recaptcha acquisition qua mutex — tránh race condition khi nhiều job chạy song song
    static acquireRecaptcha(action, jobId, sendLog) {
        return new Promise((resolve, reject) => {
            _recaptchaLock = _recaptchaLock.then(async () => {
                try {
                    if (sendLog) sendLog(`[JOBID:${jobId}] Đang lấy mã bảo mật ReCaptcha...`, 'info');
                    global.googleLabsAuth.recaptchaAction = action;
                    // Token single-use: phải xóa để Extension cấp token MỚI cho mỗi request
                    global.googleLabsAuth.recaptchaToken = null;
                    global.googleLabsAuth.needRecaptcha = true;

                    // Timeout 60s, mỗi 5s re-signal nếu Extension SW bị Chrome kill
                    let wait = 0;
                    while (!global.googleLabsAuth.recaptchaToken && wait < 60) {
                        await new Promise(r => setTimeout(r, 1000));
                        wait++;
                        // Re-signal mỗi 5s — phòng Extension SW bị kill giữa chừng không nhận được lệnh
                        if (wait % 5 === 0 && !global.googleLabsAuth.recaptchaToken) {
                            global.googleLabsAuth.needRecaptcha = true;
                            if (sendLog) sendLog(`[JOBID:${jobId}] ⏳ Chờ ReCaptcha (${wait}s) — re-signal Extension...`, 'info');
                        }
                    }
                    const token = global.googleLabsAuth.recaptchaToken;
                    if (!token) {
                        const err = new Error("Lấy mã ReCaptcha thất bại sau 60s. Kiểm tra Extension đang mở tab Google Labs.");
                        reject(err);
                        throw err;
                    }
                    // Jitter ngẫu nhiên 1–3s sau khi nhận token, trước khi release lock
                    await VeoEngine.randDelay(1000, 3000);
                    resolve(token);
                } catch (e) {
                    reject(e);
                    throw e;
                }
            }).catch(() => {});
        });
    }

    // Tự động F5 tab Google Labs khi token hết hạn, chờ auth mới được Extension capture
    static async reloadLabsAndWait(sendLog, taskId) {
        if (sendLog) sendLog(`[JOBID:${taskId}] 🔄 Token hết hạn — tự động F5 Google Labs, vui lòng chờ...`, 'info');
        const oldToken = global.googleLabsAuth.bearerToken;
        global.googleLabsAuth.pendingReload = true;
        global.googleLabsAuth.recaptchaToken = null; // xoá token cũ ngay
        // Chờ tối đa 35s để Extension reload xong và auth mới được capture
        for (let i = 0; i < 35; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const newToken = global.googleLabsAuth.bearerToken;
            if (newToken && newToken !== oldToken) {
                if (sendLog) sendLog(`[JOBID:${taskId}] ✅ Google Labs đã reload xong — tiếp tục job...`, 'success');
                return true;
            }
        }
        if (sendLog) sendLog(`[JOBID:${taskId}] ⚠️ Reload Google Labs timeout 35s — vui lòng F5 thủ công rồi thử lại`, 'error');
        return false;
    }

    static mapModelName(modelName) {
        const map = {
            'Nano Banana Pro': 'GEM_PIX_2',
            'Nano Banana 2': 'NARWHAL',
            'Nano Banana 2 Lite': 'HARBOR_SEAL',
            'Imagen 4': 'IMAGEN_3_5',
        };
        return map[modelName] || 'GEM_PIX_2';
    }

    static mapAspectRatioForImage(aspectRatio) {
        const map = {
            '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
            '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
            '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
            '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_4_3',
            '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_3_4'
        };
        return map[aspectRatio] || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    }

    static generateImagePayload(prompt, aspectRatio, genCount, workspaceProjectId, recaptchaToken, modelName, referenceImageIds = []) {
        const sessionId = `;${Date.now()}`;
        const outputCount = parseInt(String(genCount ?? '1').replace(/x/ig, '')) || 1;
        const imageModelName = this.mapModelName(modelName);

        // Xây dựng imageInputs từ danh sách UUID ảnh tham chiếu đã upload
        const imageInputs = referenceImageIds.map(id => ({
            "imageInputType": "IMAGE_INPUT_TYPE_REFERENCE",
            "name": id
        }));

        const requests = [];
        for (let i = 0; i < outputCount; i++) {
            requests.push({
                "imageAspectRatio": this.mapAspectRatioForImage(aspectRatio),
                "imageInputs": imageInputs,
                "imageModelName": imageModelName,
                "structuredPrompt": {
                    "parts": [{ "text": prompt }]
                },
                "seed": Math.floor(Math.random() * 1000000)
            });
        }

        return {
            "clientContext": {
                "projectId": workspaceProjectId, // Đúng ID phòng F12
                "tool": "PINHOLE",               // Trả lại tên PINHOLE chuẩn xác
                "sessionId": sessionId,
                "recaptchaContext": {
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
                    "token": recaptchaToken || ""
                }
            },
            "mediaGenerationContext": {
                "batchId": crypto.randomUUID(),
                "audioFailurePreference": "BLOCK_SILENCED_VIDEOS"
            },
            "requests": requests,
            "useNewMedia": true
        };
    }

    // ── flow.google.com batchexecute helpers ──────────────────────────────────

    static mapAspectCodeForFlow(aspectRatio) {
        // Image (ogiZ0b) aspect codes — confirmed from F12: 16:9=3, 9:16=2.
        // aspectRow[1] is always 22 (constant). row0[4] carries the actual aspect code.
        const map = {
            '1:1':  1,
            '9:16': 2,
            '16:9': 3,
            '4:3':  4,
            '3:4':  5
        };
        return map[aspectRatio] !== undefined ? map[aspectRatio] : 3;
    }

    static mapVideoAspectCodeForFlow(aspectRatio) {
        // Video (YhhmEf) aspect codes — confirmed from F12: 16:9=2, 9:16=1.
        // Goes into task[2], NOT into aspectRow (aspectRow[1] is always 22).
        const map = {
            '9:16': 1,
            '16:9': 2,
            '1:1':  0,
        };
        return map[aspectRatio] !== undefined ? map[aspectRatio] : 2;
    }

    static fetchBatchexecute(rpcid, freqJsonStr, timeoutMs = 90000, atOverride = null) {
        return new Promise((resolve, reject) => {
            const auth = global.googleLabsAuth;
            const atToken = atOverride || auth.atToken;
            if (!atToken || !auth.cookie) return reject(new Error('Thiếu at token hoặc cookie cho flow.google.com'));
            const projectId = auth.projectId || '';
            const params = new URLSearchParams({ rpcids: rpcid, bl: auth.bl || '', hl: 'vi', rt: 'c' });
            if (auth.fsid) params.set('f.sid', auth.fsid);
            if (projectId) params.set('source-path', `/project/${projectId}`);
            const urlPath = `/_/AiSandboxAngularFrontend/data/batchexecute?${params.toString()}`;
            const body = `f.req=${encodeURIComponent(freqJsonStr)}&at=${encodeURIComponent(atToken)}`;
            const headers = {
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'cookie': auth.cookie,
                'origin': 'https://flow.google.com',
                'referer': `https://flow.google.com/project/${projectId}`,
                'user-agent': auth.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
                'accept': '*/*',
                'x-same-domain': '1',
                'content-length': Buffer.byteLength(body).toString()
            };
            let req;
            const timer = setTimeout(() => { try { req && req.destroy(); } catch (_) {} reject(new Error(`batchexecute ${rpcid} timeout ${timeoutMs}ms`)); }, timeoutMs);
            try {
                req = https.request({ hostname: 'flow.google.com', path: urlPath, method: 'POST', headers }, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        clearTimeout(timer);
                        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
                        else reject(new Error(`batchexecute ${rpcid} HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    });
                });
                req.on('error', e => { clearTimeout(timer); reject(e); });
                req.write(body);
                req.end();
            } catch (e) { clearTimeout(timer); reject(e); }
        });
    }

    static parseBatchexecuteResponse(body, rpcid) {
        const stripped = body.replace(/^\)\]}'[\n\r]+/, '');
        const chunks = [];
        let pos = 0;
        while (pos < stripped.length) {
            const nl = stripped.indexOf('\n', pos);
            if (nl < 0) break;
            const lenStr = stripped.substring(pos, nl).trim();
            const len = parseInt(lenStr, 10); // decimal, not hex!
            if (isNaN(len) || len <= 0) { pos = nl + 1; continue; }
            const jsonStr = stripped.substring(nl + 1, nl + 1 + len);
            try { chunks.push(JSON.parse(jsonStr)); } catch (_) {}
            pos = nl + 1 + len;
        }
        for (const chunk of chunks) {
            if (!Array.isArray(chunk)) continue;
            for (const item of chunk) {
                if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcid && item[2]) {
                    try { return JSON.parse(item[2]); } catch (_) { return item[2]; }
                }
            }
        }
        return null;
    }

    // Fetch AT token từ flow.google.com HTML (Node.js https, không cần browser)
    static async fetchFlowAt(auth) {
        if (!auth.cookie) return null;
        const https = require('https');
        const projectId = auth.projectId || '';
        const html = await new Promise(resolve => {
            const req = https.request({
                hostname: 'flow.google.com',
                path: projectId ? `/project/${projectId}` : '/',
                method: 'GET',
                headers: {
                    'Cookie': auth.cookie,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'vi-VN,vi;q=0.9'
                }
            }, res => {
                let data = '';
                res.on('data', c => { data += c; if (data.length > 600000) req.destroy(); });
                res.on('end', () => resolve(data));
            });
            req.on('error', () => resolve(''));
            req.setTimeout(12000, () => { req.destroy(); resolve(''); });
            req.end();
        });
        // Google WIZ apps embed XSRF token as "SNlM0e":"AIQ-..."
        const m = html.match(/"SNlM0e":"(AIQ-[^"]+)"|"xsrf","(AIQ-[^"]+)"/) ||
                  html.match(/\bAIQ-([A-Za-z0-9_\-]{20,}:\d{10,})/);
        return m ? (m[1] || m[2] || (m[0].startsWith('AIQ-') ? m[0] : null)) : null;
    }

    // POST batchexecute từ Node.js với cookie + AT
    static async flowBatchPost(rpcid, freq, auth, at) {
        const https = require('https');
        const bl = auth.bl || '';
        const fsid = auth.fsid || '';
        const projectId = auth.projectId || '';
        const mkReqid = () => String(Math.floor(Math.random() * 9000000) + 1000000);
        const params = new URLSearchParams({ rpcids: rpcid, bl, hl: 'vi', rt: 'c', 'source-path': `/project/${projectId}`, _reqid: mkReqid() });
        if (fsid) params.set('f.sid', fsid);
        const body = `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(at)}`;
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Content-Length': Buffer.byteLength(body),
            'Cookie': auth.cookie || '',
            'x-same-domain': '1',
            'Origin': 'https://flow.google.com',
            'Referer': `https://flow.google.com/project/${projectId}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
        };
        return new Promise(resolve => {
            const req = https.request({
                hostname: 'flow.google.com',
                path: `/_/AiSandboxAngularFrontend/data/batchexecute?${params}`,
                method: 'POST', headers
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve(data));
            });
            req.on('error', () => resolve(''));
            req.setTimeout(90000, () => { req.destroy(); resolve(''); });
            req.write(body);
            req.end();
        });
    }

    // Parse ogiZ0b response: trả về { downloadUrls, uuid2 } hoặc { error }
    static parseOgiZ0bResponse(body) {
        const unescapeUrl = s => s.replace(/\\u003d/gi,'=').replace(/\\u0026/gi,'&').replace(/\\u002f/gi,'/').replace(/\\\//g,'/');
        let dataStr = null;
        const stripped = body.replace(/^\)\]}'[\n\r]+/, '');
        let pos = 0;
        while (pos < stripped.length) {
            const nl = stripped.indexOf('\n', pos);
            if (nl < 0) break;
            const len = parseInt(stripped.substring(pos, nl).trim(), 10);
            if (isNaN(len) || len <= 0) { pos = nl + 1; continue; }
            const chunk = stripped.substring(nl + 1, nl + 1 + len);
            try {
                for (const item of (JSON.parse(chunk) || [])) {
                    if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === 'ogiZ0b' && item[2]) { dataStr = item[2]; break; }
                }
            } catch (_) {
                const cm = chunk.match(/"wrb\.fr","ogiZ0b","((?:[^"\\]|\\.)*)"/);
                if (cm) { try { dataStr = JSON.parse('"' + cm[1] + '"'); } catch(__) {} }
            }
            pos = nl + 1 + len;
            if (dataStr) break;
        }
        if (!dataStr) {
            const m = body.match(/"wrb\.fr","ogiZ0b","((?:[^"\\]|\\.)*)"/);
            if (m) { try { dataStr = JSON.parse('"' + m[1] + '"'); } catch(_) {} }
        }
        if (!dataStr) return { error: `ogiZ0b no data. body=${body.substring(0, 150)}` };
        // Check for [3] error
        if (body.includes('"ogiZ0b",null,null,null,[3]')) return { error: 'ogiZ0b [3] — AT token không hợp lệ' };
        const rawData = JSON.stringify(JSON.parse(dataStr));
        const urlPattern = /https:\\?\/\\?\/flow-content\.google\\?\/image\\?\/[^\s"\\]+/g;
        const urls = (rawData.match(urlPattern) || []).map(u => unescapeUrl(u)).filter(u => u.startsWith('https://'));
        if (!urls.length) return { error: 'no_download_url. dataStr=' + dataStr.substring(0, 200) };
        // Extract uuid2 from URL
        const uuid2Match = urls[0].match(/\/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\?/i);
        return { downloadUrls: urls, downloadUrl: urls[0], uuid2: uuid2Match ? uuid2Match[1] : '' };
    }

    // Full-resolution download via as29s (Node.js)
    static async getFullResUrl(cdnUrl, auth, at) {
        const mUuid = (cdnUrl.match(/\/image\/([0-9a-f][0-9a-f-]{30,})\?/i) || [])[1];
        if (!mUuid) return cdnUrl;
        try {
            const dlFreq = JSON.stringify([[['as29s', JSON.stringify([mUuid]), null, 'generic']]]);
            const dlBody = await VeoEngine.flowBatchPost('as29s', dlFreq, auth, at);
            const dlm = dlBody.match(/"wrb\.fr","as29s","((?:[^"\\]|\\.)*)"/);
            if (dlm) {
                const dlData = JSON.parse(JSON.parse('"' + dlm[1] + '"'));
                const u = dlData?.[5]?.[12] || dlData?.[6]?.[0]?.[13];
                if (typeof u === 'string' && u.startsWith('https://')) return u;
            }
        } catch(_) {}
        return cdnUrl;
    }

    static async generateImageViaFlow(prompt, aspectRatio, genCount, modelName, sendLog, taskId, referenceImagePaths = []) {
        const auth = global.googleLabsAuth;
        const count = parseInt(String(genCount ?? '1').replace(/x/ig, '')) || 1;
        const model = this.mapModelName(modelName);
        const aspectCode = this.mapAspectCodeForFlow(aspectRatio);
        const projectId = auth.projectId;
        console.log(`[VeoEngine] generateImageViaFlow via Extension: aspectRatio="${aspectRatio}" → aspectCode=${aspectCode} model=${model} refImages=${referenceImagePaths.length}`);
        sendLog(`[JOBID:${taskId}] 🧠 Flow model: "${modelName}" → API code: "${model}"`, 'info');

        // Đọc ảnh tham chiếu đầu tiên (nếu có) thành base64 để maseQ upload trong extension
        let referenceImageBase64 = null;
        let referenceImageFilename = null;
        if (referenceImagePaths.length > 0) {
            try {
                const fsr = require('fs');
                const refPath = referenceImagePaths[0];
                const refBuf = fsr.readFileSync(refPath);
                referenceImageBase64 = refBuf.toString('base64');
                referenceImageFilename = require('path').basename(refPath);
                sendLog(`[JOBID:${taskId}] 🖼️ Flow: Dùng ảnh tham chiếu: ${referenceImageFilename} (${(refBuf.length / 1024).toFixed(0)} KB)`, 'info');
            } catch (e) {
                sendLog(`[JOBID:${taskId}] ⚠️ Không đọc được ảnh tham chiếu: ${e.message}`, 'warn');
            }
        }

        const results = [];
        for (let i = 0; i < count; i++) {
            if (i > 0) await VeoEngine.randDelay(3000, 5000);
            sendLog(`[JOBID:${taskId}] 🎨 Flow: Tạo ảnh${count > 1 ? ` (${i + 1}/${count})` : ''}${referenceImageBase64 ? ' (có ảnh tham chiếu)' : ''}...`, 'info');

            // Mutex: chỉ 1 task được dùng Extension tại một thời điểm (tránh ghi đè pendingFlowImageGen)
            const timeoutMs = referenceImageBase64 ? 90000 : 60000;
            const extResult = await VeoEngine._withFlowExtMutex(async () => {
                auth.flowImageGenResult = null;
                auth.flowImageGenTriggered = false;
                auth.pendingFlowImageGen = {
                    prompt, model, aspectCode,
                    projectId, atToken: auth.atToken || '',
                    bl: auth.bl || '', fsid: auth.fsid || '', count: 1,
                    ...(referenceImageBase64 ? { referenceImageBase64, referenceImageFilename } : {})
                };
                let waited = 0;
                while (!auth.flowImageGenResult && waited < timeoutMs) {
                    await new Promise(r => setTimeout(r, 1000));
                    waited += 1000;
                }
                auth.pendingFlowImageGen = null;
                auth.flowImageGenTriggered = false;
                const res = auth.flowImageGenResult;
                auth.flowImageGenResult = null;
                if (!res) throw new Error(`Extension timeout — không phản hồi sau ${timeoutMs / 1000}s. Hãy mở flow.google.com trong Chrome.`);
                if (res.error) throw new Error(`Flow image gen lỗi: ${res.error}`);
                return res;
            });


            // Log maseQ (ảnh tham chiếu) status để debug
            if (extResult.maseQStatus && extResult.maseQStatus !== 'not_requested') {
                const ok = extResult.maseQStatus.startsWith('success');
                sendLog(`[JOBID:${taskId}] ${ok ? '✅' : '⚠️'} maseQ upload: ${extResult.maseQStatus}`, ok ? 'success' : 'warn');
            }

            const downloadedPaths = extResult.downloadedPaths || [];
            const downloadUrls = extResult.downloadUrls || (extResult.downloadUrl ? [extResult.downloadUrl] : []);
            const fss = require('fs');

            // Ưu tiên file đã tải (chrome.downloads), fallback về URL HTTP
            let added = 0;
            for (const dp of downloadedPaths) {
                const hasFile = dp.filePath && fss.existsSync(dp.filePath);
                results.push({
                    downloadUrl: dp.url || downloadUrls[0] || '',
                    uuid2: extResult.uuid2 || '',
                    imageData: hasFile ? { fromFilePath: true, filePath: dp.filePath, mimeType: 'image/webp' } : null
                });
                added++;
            }
            if (added === 0 && downloadUrls.length > 0) {
                results.push({ downloadUrl: downloadUrls[0], uuid2: extResult.uuid2 || '', imageData: null });
            }
        }
        return results;
    }

    // ── Flow.google.com r2v (Ingredients) model codes ────────────────────────
    // 8s confirmed: "veo_3_1_r2v_lite_low_priority"; 4s/6s inferred from t2v pattern
    static mapFlowR2VModelCode(modelName, duration) {
        const dur = parseInt(String(duration || '8').replace(/[^0-9]/g, '')) || 8;
        if (modelName === 'Veo 3.1 - Lite [Lower Priority]' || modelName === 'Veo 3.1 – Lite [Lower Priority]') {
            if (dur === 4) return 'veo_3_1_r2v_lite_4s_low_priority';
            if (dur === 6) return 'veo_3_1_r2v_lite_6s_low_priority';
            return 'veo_3_1_r2v_lite_low_priority'; // 8s default
        }
        if (modelName === 'Omni 1.1 Flash') {
            return `abra_r2v_${dur}s`;
        }
        return 'veo_3_1_r2v_lite_low_priority';
    }

    // ── Flow.google.com video model codes ────────────────────────────────────
    static mapFlowVideoModelCode(modelName, duration) {
        // Duration is ENCODED IN the model code string (confirmed from F12):
        // 4s → "veo_3_1_t2v_lite_4s_low_priority"
        // 8s → "veo_3_1_t2v_lite_low_priority" (no suffix = default)
        // 6s → "veo_3_1_t2v_lite_6s_low_priority" (inferred, unconfirmed)
        const dur = parseInt(String(duration || '8').replace(/[^0-9]/g, '')) || 8;
        if (modelName === 'Veo 3.1 - Lite [Lower Priority]' || modelName === 'Veo 3.1 – Lite [Lower Priority]') {
            if (dur === 4) return 'veo_3_1_t2v_lite_4s_low_priority';
            if (dur === 6) return 'veo_3_1_t2v_lite_6s_low_priority';
            return 'veo_3_1_t2v_lite_low_priority'; // 8s default (no suffix)
        }
        if (modelName === 'Omni 1.1 Flash') {
            // Pattern confirmed from F12: abra_t2v_{N}s
            return `abra_t2v_${dur}s`;
        }
        return 'veo_3_1_t2v_lite_low_priority';
    }

    // ── Video gen via flow.google.com: Extension triggers YhhmEf, Node.js polls jwpduf ──
    static async generateVideoViaFlowBatchexecute(prompt, aspectRatio, modelName, duration, sendLog, taskId) {
        const auth = global.googleLabsAuth;
        const projectId = auth.projectId;
        const aspectCode = this.mapVideoAspectCodeForFlow(aspectRatio); // video-specific: 16:9=2, 9:16=1
        const dur = parseInt((duration || '8s').replace(/[^0-9]/g, '')) || 8;
        const modelCode = this.mapFlowVideoModelCode(modelName, dur); // dur baked into model code

        sendLog(`[JOBID:${taskId}] Flow video via Extension: model=${modelCode} dur=${dur}s aspect=${aspectCode}`, 'info');

        // Mutex: chỉ 1 task được dùng Extension tại một thời điểm (tránh ghi đè pendingFlowVideoGen)
        // Mutex giải phóng SAU KHI lấy được operationId, trước khi poll → các task khác có thể dùng Extension song song với polling
        sendLog(`[JOBID:${taskId}] Đang gửi lệnh qua Extension — chờ operationId...`, 'info');
        const { operationId, extAt } = await VeoEngine._withFlowExtMutex(async () => {
            auth.flowVideoGenResult = null;
            auth.flowVideoGenTriggered = false;
            auth.pendingFlowVideoGen = {
                prompt, aspectCode, modelCode, projectId, duration: dur,
                atToken: auth.atToken || '', bl: auth.bl || '', fsid: auth.fsid || ''
            };
            let waited = 0;
            while (!auth.flowVideoGenResult && waited < 60000) {
                await new Promise(r => setTimeout(r, 1000));
                waited += 1000;
            }
            auth.pendingFlowVideoGen = null;
            auth.flowVideoGenTriggered = false;
            const res = auth.flowVideoGenResult;
            auth.flowVideoGenResult = null;
            if (!res) throw new Error('Extension timeout 60s — không phản hồi YhhmEf trigger');
            if (res.error) throw new Error(`YhhmEf Extension lỗi: ${res.error}`);
            const opId = res.operationId;
            if (!opId) throw new Error(`Extension không trả về operationId. Result: ${JSON.stringify(res).substring(0, 150)}`);
            sendLog(`[JOBID:${taskId}] YhhmEf OK — operationId: ${opId.substring(0, 24)}... Đang poll jwpduf...`, 'info');
            return { operationId: opId, extAt: res.at };
        });

        // Chỉ chờ Extension poll via as29s (Extension có cookie, backend không có → jwpduf 502)
        let videoUrl = null;
        const T2V_MAX_POLLS = 120; // 120 × 5s = 600s = 10 phút
        for (let poll = 0; poll < T2V_MAX_POLLS; poll++) {
            await new Promise(r => setTimeout(r, 5000));

            if (auth.pendingR2VVideoUrls?.[operationId]) {
                videoUrl = auth.pendingR2VVideoUrls[operationId];
                delete auth.pendingR2VVideoUrls[operationId];
                sendLog(`[JOBID:${taskId}] Extension poll T2V thành công: ${videoUrl.slice(0, 80)}...`, 'info');
                break;
            }

            if (poll % 6 === 5) {
                const pct = Math.min(95, Math.round(poll * 100 / T2V_MAX_POLLS));
                sendLog(`[JOBID:${taskId}] ${pct}% — Đang render video (Extension đang poll)...`, 'progress');
            }
        }

        // Kiểm tra lần cuối Extension poll
        if (!videoUrl && auth.pendingR2VVideoUrls?.[operationId]) {
            videoUrl = auth.pendingR2VVideoUrls[operationId];
            delete auth.pendingR2VVideoUrls[operationId];
        }

        if (!videoUrl) throw new Error('Video gen timeout 360s — không nhận được URL từ jwpduf');
        return { videoUrl };
    }

    // ── R2V (Ingredients) via Flow.google.com: Extension uploads images + triggers MZZa6b, Node.js polls jwpduf ──
    // ingredientImages: array of local file paths (max 7, confirmed from F12)
    static async generateR2VViaFlowBatchexecute(prompt, ingredientImages, aspectRatio, modelName, duration, sendLog, taskId, voiceId) {
        const fs = require('fs');
        const path = require('path');
        const auth = global.googleLabsAuth;
        const projectId = auth.projectId;
        const aspectCode = this.mapVideoAspectCodeForFlow(aspectRatio);
        const dur = parseInt((duration || '8s').replace(/[^0-9]/g, '')) || 8;
        const modelCode = this.mapFlowR2VModelCode(modelName, dur);

        // Omni 1.1 Flash supports up to 7 reference images; Veo 3.1 Lite supports up to 3
        const MAX_REF = modelName === 'Omni 1.1 Flash' ? 7 : 3;
        const imgs = (Array.isArray(ingredientImages) ? ingredientImages : [ingredientImages]).slice(0, MAX_REF);
        sendLog(`[JOBID:${taskId}] Flow R2V via Extension (MZZa6b): ${imgs.length} ảnh | model=${modelCode} dur=${dur}s aspect=${aspectCode}`, 'info');

        const ingredientImagesData = imgs.map(imgPath => ({
            base64: fs.readFileSync(imgPath).toString('base64'),
            filename: path.basename(imgPath)
        }));

        // Mutex: chỉ 1 task được dùng Extension tại một thời điểm (tránh ghi đè pendingFlowR2VGen)
        // Mutex giải phóng sau khi lấy được operationId, trước khi poll → polling chạy song song
        sendLog(`[JOBID:${taskId}] Đang upload ảnh + gửi MZZa6b qua Extension — chờ operationId...`, 'info');
        const { operationId, extAt: r2vExtAt } = await VeoEngine._withFlowExtMutex(async () => {
            auth.flowR2VGenResult = null;
            auth.flowR2VGenTriggered = false;
            auth.pendingFlowR2VGen = {
                prompt, aspectCode, modelCode, projectId, duration: dur,
                ingredientImagesData, voiceId: voiceId || null,
                atToken: auth.atToken || '', bl: auth.bl || '', fsid: auth.fsid || ''
            };
            let waited = 0;
            while (!auth.flowR2VGenResult && waited < 90000) {
                await new Promise(r => setTimeout(r, 1000));
                waited += 1000;
            }
            auth.pendingFlowR2VGen = null;
            auth.flowR2VGenTriggered = false;
            const res = auth.flowR2VGenResult;
            auth.flowR2VGenResult = null;
            if (!res) throw new Error('Extension timeout 90s — không phản hồi MZZa6b trigger');
            if (res.error) throw new Error(`MZZa6b Extension lỗi: ${res.error}`);
            const opId = res.operationId;
            if (!opId) throw new Error(`Extension không trả về operationId. Result: ${JSON.stringify(res).substring(0, 150)}`);
            sendLog(`[JOBID:${taskId}] MZZa6b OK — operationId: ${opId.substring(0, 24)}... Đang poll jwpduf...`, 'info');
            return { operationId: opId, extAt: res.at };
        });

        // Poll jwpduf từ Node.js — mutex đã giải phóng, các task khác có thể dùng Extension
        let currentAt = r2vExtAt || auth.atToken;
        let videoUrl = null;
        const MAX_R2V_POLLS = 100; // 500s (~8.3 phút) — R2V với voice cần thêm thời gian
        for (let poll = 0; poll < MAX_R2V_POLLS; poll++) {
            await new Promise(r => setTimeout(r, 5000));

            // Kiểm tra Extension đã poll được URL chưa (từ /api/save-flow-r2v-video)
            if (auth.pendingR2VVideoUrls?.[operationId]) {
                videoUrl = auth.pendingR2VVideoUrls[operationId];
                delete auth.pendingR2VVideoUrls[operationId];
                sendLog(`[JOBID:${taskId}] Extension poll thành công: ${videoUrl.slice(0, 80)}...`, 'info');
                break;
            }

            // Refresh AT mỗi 10 polls (~50s) để tránh AT hết hạn
            if (poll > 0 && poll % 10 === 0) {
                try { const freshAt = await VeoEngine.fetchFlowAt(auth); if (freshAt) currentAt = freshAt; } catch (_) {}
            }

            const pollInner = JSON.stringify([operationId]);
            const pollFreq = JSON.stringify([[['jwpduf', pollInner, null, 'generic']]]);

            let pollRawBody;
            try {
                pollRawBody = await VeoEngine.fetchBatchexecute('jwpduf', pollFreq, 30000, currentAt);
            } catch (e) {
                sendLog(`[JOBID:${taskId}] Poll R2V ${poll + 1} lỗi: ${(e.message || '').substring(0, 100)}`, 'info');
                continue;
            }

            if (!pollRawBody) continue;

            // Match: flow-content.google (R2V voice), storage ais-sandbox, .mp4, .m3u8, lh3 ais
            const rawUrlMatch = pollRawBody.match(/"(https:(?:\\\/|\/){2}flow-content\.google\/(?:video|image)\/[^"]{10,})"/)
                || pollRawBody.match(/"(https:(?:\\\/|\/){2}storage\.googleapis\.com\/ais-[^"]{10,})"/)
                || pollRawBody.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.mp4[^"]{0,800})"/)
                || pollRawBody.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.m3u8[^"]{0,300})"/)
                || pollRawBody.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.webm[^"]{0,300})"/)
                || pollRawBody.match(/"(https:(?:\\\/|\/){2}lh3\.googleusercontent\.com\/ais[^"]{10,})"/);
            if (rawUrlMatch) {
                videoUrl = rawUrlMatch[1]
                    .replace(/\\u003d/g, '=').replace(/\\u0026/g, '&')
                    .replace(/\\u002f/g, '/').replace(/\\\//g, '/');
                break;
            }

            if (poll % 6 === 5) {
                const pct = Math.min(95, Math.round(poll * 100 / MAX_R2V_POLLS));
                sendLog(`[JOBID:${taskId}] ${pct}% — Đang render video R2V...`, 'progress');
            }
        }

        // Kiểm tra lần cuối Extension poll
        if (!videoUrl && auth.pendingR2VVideoUrls?.[operationId]) {
            videoUrl = auth.pendingR2VVideoUrls[operationId];
            delete auth.pendingR2VVideoUrls[operationId];
        }

        if (!videoUrl) throw new Error('R2V gen timeout 500s — không nhận được URL từ jwpduf');
        return { videoUrl };
    }

    static mapAspectRatioForVideo(aspectRatio) {
        const map = {
            '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
            '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
            '1:1':  'VIDEO_ASPECT_RATIO_SQUARE',
        };
        return map[aspectRatio] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    }

    static mapVideoModelKeyR2V(modelName, duration) {
        // Omni Flash dùng prefix "abra" — r2v có duration suffix
        if (modelName === 'Omni 1.1 Flash') {
            const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
            return `abra_r2v_${dur}s`;
        }

        const tierMap = {
            'Veo 3.1 - Lite (Fast)':            'lite',
            'Veo 3.1 - Fast (Balanced)':         'fast',
            'Veo 3.1 - Quality (High)':          'quality',
            'Veo 3.1 - Lite [Lower Priority]':   'lite',
            'Veo 3.1 - Fast [Lower Priority]':   'fast',
        };
        const tier = tierMap[modelName] || 'lite';
        const isLowPriority = modelName.includes('[Lower Priority]');
        const prio = isLowPriority ? 'low_priority' : 'relaxed';
        const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
        // 8s = không có suffix duration; 4s/6s = thêm _s_ và ${dur}s
        if (dur === '8') return `veo_3_1_r2v_${tier}_${prio}`;
        return `veo_3_1_r2v_s_${tier}_${dur}s_${prio}`;
    }

    static generateIngredientsPayload(prompt, aspectRatio, model, projectId, recaptchaToken, ingredientMediaIds, voiceId = null, duration = '8s') {
        const sessionId = `;${Date.now()}`;
        const finalPrompt = this.applyOmniPrompt(prompt, model);
        // Omni 1.1 Flash hỗ trợ max 7 ref; Veo 3.1 Lite max 3
        const MAX_REF = model === 'Omni 1.1 Flash' ? 7 : 3;
        const safeIds = (ingredientMediaIds || []).slice(0, MAX_REF);
        const req = {
            "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
            "textInput": {
                "structuredPrompt": {
                    "parts": [{ "text": finalPrompt }]
                }
            },
            "videoModelKey": this.mapVideoModelKeyR2V(model, duration),
            "metadata": {},
            "seed": Math.floor(Math.random() * 99999),
            "referenceImages": safeIds.map(id => ({
                "mediaId": id,
                "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"
            }))
        };
        if (voiceId) req.referenceAudio = [{ "mediaId": voiceId }];
        return {
            "mediaGenerationContext": {
                "batchId": crypto.randomUUID(),
                "audioFailurePreference": "BLOCK_SILENCED_VIDEOS"
            },
            "clientContext": {
                "projectId": projectId,
                "tool": "PINHOLE",
                "userPaygateTier": "PAYGATE_TIER_TWO",
                "sessionId": sessionId,
                "recaptchaContext": {
                    "token": recaptchaToken || "",
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            "requests": [req],
            "useV2ModelConfig": true
        };
    }

    // videoModelKey mã hoá tier + duration + quality
    // ultra_relaxed = 1080p (không có duration cố định)
    // {dur}s_relaxed  = 720p với duration cụ thể (4s / 6s / 8s)
    static mapVideoModelKey(modelName, duration, isI2V = false, hasEndImage = false, quality = '720p') {
        // Omni Flash dùng prefix "abra" hoàn toàn khác — chỉ hỗ trợ T2V
        if (modelName === 'Omni 1.1 Flash') {
            const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
            return `abra_t2v_${dur}s`;
        }

        const tierMap = {
            'Veo 3.1 - Lite (Fast)':            'lite',
            'Veo 3.1 - Fast (Balanced)':         'fast',
            'Veo 3.1 - Quality (High)':          'quality',
            'Veo 3.1 - Lite [Lower Priority]':   'lite',
            'Veo 3.1 - Fast [Lower Priority]':   'fast',
        };
        const tier = tierMap[modelName] || 'fast';
        const is1080p = quality === '1080p';
        // Lower Priority dùng 'low_priority' thay vì 'relaxed' — cùng pattern với R2V
        const isLowPriority = modelName.includes('[Lower Priority]');
        const prio = isLowPriority ? 'low_priority' : 'relaxed';

        if (isI2V) {
            // 8s = no _s_, no duration suffix; 4s/6s = with _s_, with duration suffix
            if (hasEndImage) {
                if (is1080p) return `veo_3_1_i2v_${tier}_fl_ultra_${prio}`;
                const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
                if (dur === '8') return `veo_3_1_i2v_${tier}_fl_${prio}`;
                return `veo_3_1_i2v_s_${tier}_${dur}s_fl_${prio}`;
            }
            if (is1080p) return `veo_3_1_i2v_${tier}_ultra_${prio}`;
            const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
            if (dur === '8') return `veo_3_1_i2v_${tier}_${prio}`;
            return `veo_3_1_i2v_s_${tier}_${dur}s_${prio}`;
        }

        // T2V — 8s là model mặc định (không có duration suffix); 4s/6s có suffix
        // 1080p KHÔNG dùng key 'ultra' — dùng key 720p thường, upsample code sẽ xử lý 1080p sau
        const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
        if (dur === '8') return `veo_3_1_t2v_${tier}_${prio}`;
        return `veo_3_1_t2v_${tier}_${dur}s_${prio}`;
    }

    static OMNI_ANTI_REPEAT = `\n\n[SPEECH INSTRUCTION: Read every word of the dialogue exactly as written, once and only once. Never repeat, stutter, loop, or duplicate any word, syllable, or phrase under any circumstances.]`;

    static applyOmniPrompt(prompt, model) {
        if (model !== 'Omni 1.1 Flash') return prompt;
        if (prompt.includes('SPEECH:') || prompt.includes('SPEECH INSTRUCTION')) return prompt;
        return prompt + this.OMNI_ANTI_REPEAT;
    }

    static generateVideoPayload(prompt, aspectRatio, model, duration, projectId, recaptchaToken, startImageId, endImageId, quality = '720p') {
        const sessionId = `;${Date.now()}`;
        const isI2V = !!startImageId;
        const hasEndImage = !!endImageId;
        const finalPrompt = this.applyOmniPrompt(prompt, model);
        const request = {
            "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
            "seed": Math.floor(Math.random() * 99999),
            "textInput": {
                "structuredPrompt": {
                    "parts": [{ "text": finalPrompt }]
                }
            },
            "videoModelKey": this.mapVideoModelKey(model, duration, isI2V, hasEndImage, quality),
            "metadata": {}
        };
        // startImage luôn có khi I2V
        if (startImageId) request.startImage = {
            mediaId: startImageId,
            cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 }
        };
        // endImage: chỉ thêm khi có end frame (dùng model key fl = first-last)
        if (endImageId) request.endImage = {
            mediaId: endImageId,
            cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 }
        };

        return {
            "mediaGenerationContext": {
                "batchId": crypto.randomUUID(),
                "audioFailurePreference": "BLOCK_SILENCED_VIDEOS"
            },
            "clientContext": {
                "projectId": projectId,
                "tool": "PINHOLE",
                "userPaygateTier": "PAYGATE_TIER_TWO",
                "sessionId": sessionId,
                "recaptchaContext": {
                    "token": recaptchaToken || "",
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            "requests": [request],
            "useV2ModelConfig": true
        };
    }

    static generateUpsamplePayload(mediaId, workflowId, aspectRatio, projectId, recaptchaToken) {
        return {
            "mediaGenerationContext": {
                "batchId": crypto.randomUUID(),
                "audioFailurePreference": "BLOCK_SILENCED_VIDEOS"
            },
            "clientContext": {
                "projectId": projectId,
                "tool": "PINHOLE",
                "userPaygateTier": "PAYGATE_TIER_TWO",
                "sessionId": `;${Date.now()}`,
                "recaptchaContext": {
                    "token": recaptchaToken || "",
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            "requests": [{
                "resolution": "VIDEO_RESOLUTION_1080P",
                "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
                "videoModelKey": "veo_3_1_upsampler_1080p",
                "metadata": { "workflowId": workflowId },
                "seed": Math.floor(Math.random() * 99999),
                "videoInput": { "mediaId": mediaId }
            }],
            "useV2ModelConfig": true
        };
    }

    // ─── Extend Video payload ────────────────────────────────────────────────────
    static mapExtendModelKey(modelName) {
        const tierMap = {
            'Veo 3.1 - Lite (Fast)':            'lite',
            'Veo 3.1 - Fast (Balanced)':         'fast',
            'Veo 3.1 - Quality (High)':          'quality',
            'Veo 3.1 - Lite [Lower Priority]':   'lite',
            'Veo 3.1 - Fast [Lower Priority]':   'fast',
        };
        const tier = tierMap[modelName] || 'lite';
        const prio = modelName.includes('[Lower Priority]') ? 'low_priority' : 'relaxed';
        return `veo_3_1_extension_${tier}_${prio}`;
    }

    static generateExtendPayload(prompt, aspectRatio, model, mediaId, workflowId, projectId, recaptchaToken) {
        return {
            "mediaGenerationContext": {
                "batchId": crypto.randomUUID(),
                "audioFailurePreference": "BLOCK_SILENCED_VIDEOS"
            },
            "clientContext": {
                "projectId": projectId,
                "tool": "PINHOLE",
                "userPaygateTier": "PAYGATE_TIER_TWO",
                "sessionId": `;${Date.now()}`,
                "recaptchaContext": {
                    "token": recaptchaToken || "",
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB"
                }
            },
            "requests": [{
                "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
                "textInput": {
                    "structuredPrompt": {
                        "parts": [{ "text": prompt }]
                    }
                },
                "videoModelKey": this.mapExtendModelKey(model),
                "metadata": { "workflowId": workflowId },
                "seed": Math.floor(Math.random() * 99999),
                "videoInput": { "mediaId": mediaId }
            }],
            "useV2ModelConfig": true
        };
    }

    // ─── Run Extend ──────────────────────────────────────────────────────────────
    // jobData: { tasks: [{ id, mediaId, workflowId, prompt, fileIndex }], aspectRatio, model, outputFolder }
    static async runExtend(jobData, sendLog) {
        const { tasks, aspectRatio, model, outputFolder } = jobData;
        const results = [];

        try {
            if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
            const check = await this.checkCookie();
            if (!check.success) throw new Error(check.error);

            sendLog('🎬 Khởi động Extend Video Engine...', 'info');

            const EXTEND_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoExtendVideo';
            const MAX_WORKERS = 8;
            let activeJobs = 0;

            const getSeqNum = (task) => {
                if (typeof task.fileIndex === 'number' && task.fileIndex > 0) return task.fileIndex;
                const id = String(task.id || '');
                const m = id.match(/_(\d+)(?:_r\d+)?$/);
                return m ? parseInt(m[1]) + 1 : 1;
            };

            const processTask = async (task) => {
                sendLog(`[JOBID:${task.id}]`, 'job_start');
                try {
                    const auth = global.googleLabsAuth;
                    if (!auth?.projectId) throw new Error('Chưa có projectId — hãy F5 tab Google Labs.');

                    // Dùng projectId từ task nếu có (user tự nhập), fallback auth.projectId
                    const projectId = task.projectId || auth.projectId;
                    const workflowId = task.workflowId;
                    const mediaId    = task.mediaId;

                    if (!mediaId)    throw new Error('Thiếu Media ID của video nguồn.');
                    if (!workflowId) throw new Error('Thiếu Workflow ID.');

                    sendLog(`[JOBID:${task.id}] 🔗 Extend từ mediaId: ${mediaId.slice(0,8)}... | wf: ${workflowId.slice(0,8)}...`, 'info');

                    // Lấy recaptcha
                    const token = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                    const payload = this.generateExtendPayload(
                        task.prompt || 'Continue the scene naturally.',
                        aspectRatio, model, mediaId, workflowId, projectId, token
                    );

                    // Gọi Extend API qua Extension (cần Chrome session đầy đủ)
                    sendLog(`[JOBID:${task.id}] Gửi lệnh Extend Video...`, 'info');
                    const genRes = await this.generateVideoViaExtension(EXTEND_URL, payload, sendLog, task.id);
                    if (!genRes) throw new Error('Extension Extend gen thất bại hoặc timeout');
                    sendLog(`[JOBID:${task.id}] ✅ Extend API OK`, 'success');

                    // Trích generationId từ media[].name (giống Ingredients/I2V)
                    let generationIds = null;
                    if (Array.isArray(genRes.media) && genRes.media.length > 0) {
                        const ids = genRes.media.map(m => m.name).filter(Boolean);
                        if (ids.length > 0) generationIds = ids;
                    }
                    if (!generationIds) throw new Error('Không nhận được Generation ID từ Extend API.');

                    sendLog(`[JOBID:${task.id}] ⏳ Đang Render Extend Video trên server...`, 'info');

                    // Poll status (giống flow video thường)
                    const videoFileName = `extend_${getSeqNum(task)}.mp4`;
                    const videoFilePath = path.join(outputFolder, videoFileName);
                    let mediaUrl = null; let isDone = false; let pollCount = 0;
                    let isUpsampled = false; let origMediaName = null; let resolvedUpsMediaName = null;

                    while (!isDone && pollCount < 72) {
                        pollCount++;
                        await new Promise(r => setTimeout(r, 5000));

                        let statusRes;
                        try {
                            const pollPayload = { media: generationIds.map(id => ({ name: id, projectId })) };
                            const POLL_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
                            statusRes = await this.fetchAPI(POLL_URL, 'POST', pollPayload);
                        } catch (pollErr) {
                            const msg = pollErr.message || '';
                            if (msg.includes('503') || msg.includes('429')) continue;
                            throw pollErr;
                        }

                        const mediaItems = statusRes.media || statusRes.responses || [];
                        if (!mediaItems.length) continue;
                        const item = mediaItems[0];
                        const status = item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus
                            || item?.status || item?.state || '';

                        if (status.includes('FAILED') || status.includes('ERROR')) {
                            throw new Error(`Extend render thất bại: ${status}`);
                        }

                        if (status.includes('SUCCEEDED') || status.includes('COMPLETE') || status === 'DONE') {
                            isDone = true;
                            // Lấy mediaName để download (giống flow upscale)
                            const mi = mediaItems[0];
                            const causToken = mi?.mediaMetadata?.mediaStatus?.causalVideoToken;
                            const mediaName4dl = causToken || generationIds[0];

                            sendLog(`[JOBID:${task.id}] 100% - Đang tải Extend Video...`, 'progress');

                            // Multi-strategy download (silent first 2, tRPC direct 3, Extension là fallback)
                            let dlDone = false;
                            const dlStrategies = [
                                { label: 'aisandbox ?alt=media', silent: true, fn: async () => {
                                    const directUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia/${mediaName4dl}?alt=media`;
                                    return VeoEngine.downloadMedia(directUrl, videoFilePath, true);
                                }},
                                { label: 'aisandbox :download', silent: true, fn: async () => {
                                    const downloadUrl = `https://aisandbox-pa.googleapis.com/v1/flowMedia/${mediaName4dl}:download`;
                                    return VeoEngine.downloadMedia(downloadUrl, videoFilePath, true);
                                }},
                                // tRPC redirect trực tiếp Node.js — KHÔNG cần Chrome Extension
                                { label: 'tRPC redirect direct', silent: false, fn: async () => {
                                    const directUrl = await VeoEngine.resolveMediaUrlDirect(mediaName4dl);
                                    sendLog(`[JOBID:${task.id}] 🔗 tRPC direct → ${directUrl.slice(0, 80)}`, 'info');
                                    return VeoEngine.downloadMedia(directUrl, videoFilePath, false);
                                }},
                                { label: 'Extension chrome.downloads', fn: () => this.downloadViaExtension(mediaName4dl, videoFilePath) },
                            ];

                            for (let si = 0; si < dlStrategies.length && !dlDone; si++) {
                                const { label, silent, fn } = dlStrategies[si];
                                try {
                                    await fn();
                                    dlDone = true;
                                } catch (e) {
                                    if (si < dlStrategies.length - 1) {
                                        if (!silent) sendLog(`[JOBID:${task.id}] ⚠️ [${label}] thất bại: ${(e.message||'').slice(0,80)}`, 'info');
                                    } else {
                                        throw new Error(`Không tải được Extend video: ${(e.message||'').slice(0,80)}`);
                                    }
                                }
                            }
                        } else {
                            const pct = item?.mediaMetadata?.mediaStatus?.progressPercent || '';
                            sendLog(`[JOBID:${task.id}] ${pct ? pct + '% ' : ''}(${status || 'ACTIVE'})`, 'progress');
                        }
                    }

                    if (!isDone) throw new Error('Extend Video timeout sau 6 phút.');

                    sendLog(`[JOBID:${task.id}] Lưu thành công: ${videoFileName}`, 'success');
                    sendLog(`[JOBID:${task.id}]`, 'job_success');
                    results.push({ id: task.id, filePath: videoFilePath });

                } catch (error) {
                    sendLog(`[JOBID:${task.id}] Lỗi: ${error.message}`, 'error');
                    sendLog(`[JOBID:${task.id}]`, 'job_fail');
                    results.push({ id: task.id, isError: true, error: error.message });
                }
            };

            // Chạy song song MAX_WORKERS task
            const workers = [];
            for (const task of tasks) {
                while (activeJobs >= MAX_WORKERS) await new Promise(r => setTimeout(r, 1000));
                activeJobs++;
                await new Promise(r => setTimeout(r, 3000)); // delay nhỏ giữa các lần gọi API
                const w = processTask(task).finally(() => activeJobs--);
                workers.push(w);
            }
            await Promise.all(workers);
            return { success: true, files: results };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ─── Extend Chain: T2V (prompt 1) → Extend (prompt 2, 3, ...) liên tiếp ───
    // jobData: { prompts:[], aspectRatio, t2vModel, t2vDuration, t2vQuality, extendModel, outputFolder }
    static async runExtendChain(jobData, sendLog) {
        const { prompts, aspectRatio, t2vModel, t2vDuration, t2vQuality, extendModel, outputFolder } = jobData;
        if (!prompts?.length) return { success: false, error: 'Không có prompt nào.' };

        const results = [];
        try {
            if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
            const check = await this.checkCookie();
            if (!check.success) throw new Error(check.error);

            const auth = global.googleLabsAuth;
            const projectId = auth.projectId;
            if (!projectId) throw new Error('Chưa có projectId — hãy F5 Google Labs.');

            const POLL_URL    = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
            const EXTEND_URL  = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoExtendVideo';

            // ── Helper: poll cho đến khi SUCCEEDED/SUCCESSFUL, trả về { mediaId, causToken } ──
            const pollUntilDone = async (generationIds, stepId) => {
                let isDone = false; let pollCount = 0;
                let finalMediaId = generationIds[0];
                let causToken = null;
                let lastLogKey = '';
                while (!isDone && pollCount < 90) {
                    pollCount++;
                    await new Promise(r => setTimeout(r, 5000));
                    let statusRes;
                    try {
                        statusRes = await this.fetchAPI(POLL_URL, 'POST', {
                            media: generationIds.map(id => ({ name: id, projectId }))
                        });
                    } catch (e) {
                        const m = e.message || '';
                        if (m.includes('503') || m.includes('429')) continue;
                        throw e;
                    }
                    const items = statusRes.media || statusRes.responses || [];
                    if (!items.length) continue;
                    const item = items[0];
                    const status = item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus || item?.status || '';
                    if (status.includes('FAILED') || status.includes('ERROR')) throw new Error(`Render thất bại (step ${stepId}): ${status}`);
                    // SUCCE khớp cả SUCCEEDED lẫn SUCCESSFUL
                    if (status.includes('SUCCE') || status.includes('COMPLETE') || status === 'DONE') {
                        isDone = true;
                        causToken = item?.mediaMetadata?.mediaStatus?.causalVideoToken || null;
                    } else {
                        const pct = item?.mediaMetadata?.mediaStatus?.progressPercent || '';
                        const logKey = `${pct}|${status}`;
                        if (logKey !== lastLogKey) {
                            sendLog(`[step ${stepId}] ${pct ? pct + '% ' : ''}(${status || 'ACTIVE'})`, 'info');
                            lastLogKey = logKey;
                        }
                    }
                }
                if (!isDone) throw new Error(`Timeout khi chờ render (step ${stepId}).`);
                return { mediaId: finalMediaId, causToken };
            };

            // ── Helper: download với multi-strategy ──
            const downloadVideo = async (mediaId4dl, causToken, videoFilePath, stepId, pid) => {
                let dlDone = false;
                const mName = causToken || mediaId4dl;
                const strategies = [
                    { silent: true,  fn: async () => VeoEngine.downloadMedia(`https://aisandbox-pa.googleapis.com/v1/projects/${pid}/flowMedia/${mName}?alt=media`, videoFilePath, true) },
                    { silent: true,  fn: async () => VeoEngine.downloadMedia(`https://aisandbox-pa.googleapis.com/v1/flowMedia/${mName}:download`, videoFilePath, true) },
                    // tRPC redirect trực tiếp Node.js — KHÔNG cần Chrome Extension
                    { silent: false, fn: async () => {
                        const directUrl = await VeoEngine.resolveMediaUrlDirect(mName);
                        return VeoEngine.downloadMedia(directUrl, videoFilePath, false);
                    }},
                    { silent: false, fn: () => this.downloadViaExtension(mName, videoFilePath) },
                ];
                for (let si = 0; si < strategies.length && !dlDone; si++) {
                    try { await strategies[si].fn(); dlDone = true; }
                    catch (e) {
                        if (si === strategies.length - 1) throw new Error(`Không tải được video (step ${stepId}): ${(e.message||'').slice(0,80)}`);
                    }
                }
            };

            // ══════════════════════════════════════════════════════════════════════
            // STEP 1: T2V — Prompt đầu tiên tạo video gốc
            // ══════════════════════════════════════════════════════════════════════
            sendLog(`🎬 [Step 1/${prompts.length}] T2V: "${prompts[0].slice(0,60)}..."`, 'info');
            const T2V_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
            const t2vToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', 'ext_chain_1', sendLog);
            const t2vPayload = this.generateVideoPayload(
                prompts[0], aspectRatio, t2vModel, t2vDuration, projectId, t2vToken, null, null, t2vQuality
            );

            let t2vGenRes;
            const MAX_T2V_RETRY = 3;
            for (let t2vRetry = 0; t2vRetry < MAX_T2V_RETRY; t2vRetry++) {
                t2vGenRes = await this.generateVideoViaExtension(T2V_URL, t2vPayload, sendLog, 'ext_chain_1');
                if (t2vGenRes) break; // thành công
                // Thất bại — lỗi HTTP đã được log bên trong generateVideoViaExtension
                if (t2vRetry < MAX_T2V_RETRY - 1) {
                    sendLog(`⚠️ T2V thất bại, thử lại ${t2vRetry + 1}/${MAX_T2V_RETRY - 1} sau 15s...`, 'info');
                    await new Promise(r => setTimeout(r, 15000));
                    const freshToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', 'ext_chain_1', sendLog);
                    const freshPayload = this.generateVideoPayload(prompts[0], aspectRatio, t2vModel, t2vDuration, projectId, freshToken, null, null, t2vQuality);
                    Object.assign(t2vPayload, freshPayload);
                }
            }
            if (!t2vGenRes) {
                const lastErr = global.googleLabsAuth._lastExtError || '';
                const hint = /401|403|unauthorized|forbidden/i.test(lastErr)
                    ? ' → Phiên hết hạn, hãy F5 Google Labs rồi thử lại.'
                    : lastErr ? ` (${lastErr})` : ' — hãy F5 Google Labs rồi thử lại.';
                throw new Error(`Extension T2V thất bại sau 3 lần thử${hint}`);
            }

            // Trích generationIds và workflowId từ T2V response
            let genIds = null;
            if (Array.isArray(t2vGenRes.media) && t2vGenRes.media.length > 0) {
                genIds = t2vGenRes.media.map(m => m.name).filter(Boolean);
            }
            if (!genIds && Array.isArray(t2vGenRes.operations)) {
                genIds = t2vGenRes.operations.map(op => op.operation?.name || op.name).filter(Boolean);
            }
            if (!genIds) throw new Error('T2V không trả về Generation ID.');

            // workflowId từ workflows[] trong response
            let currentWorkflowId = t2vGenRes.workflows?.[0]?.name || null;

            sendLog(`⏳ [Step 1] Đang render T2V (workflowId: ${currentWorkflowId?.slice(0,8) || 'unknown'}...)`, 'info');
            const { mediaId: t2vMediaId, causToken: t2vCausToken } = await pollUntilDone(genIds, 1);

            const t2vFileName = `extend_chain_1.mp4`;
            const t2vFilePath = path.join(outputFolder, t2vFileName);
            sendLog(`[Step 1] 100% — Tải T2V video...`, 'info');
            await downloadVideo(t2vMediaId, t2vCausToken, t2vFilePath, 1, projectId);
            sendLog(`✅ [Step 1] Lưu thành công: ${t2vFileName}`, 'success');
            results.push({ step: 1, filePath: t2vFilePath, mediaId: t2vMediaId });

            // currentMediaId cho bước extend tiếp theo
            let currentMediaId = t2vMediaId;

            // Nếu workflowId chưa có từ response, dừng extend và thông báo
            if (!currentWorkflowId) {
                sendLog('⚠️ Không lấy được workflowId từ T2V — bỏ qua các bước extend.', 'info');
                return { success: true, files: results };
            }

            // ══════════════════════════════════════════════════════════════════════
            // STEP 2+: Extend lần lượt với các prompts còn lại
            // ══════════════════════════════════════════════════════════════════════
            for (let i = 1; i < prompts.length; i++) {
                const step = i + 1;
                const stepPrompt = prompts[i];
                const stepId = `ext_chain_${step}`;

                sendLog(`🔁 [Step ${step}/${prompts.length}] Extend: "${stepPrompt.slice(0,60)}..."`, 'info');
                sendLog(`   ↳ mediaId nguồn: ${currentMediaId.slice(0,8)}... | wf: ${currentWorkflowId.slice(0,8)}...`, 'info');

                const extToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', stepId, sendLog);
                const extPayload = this.generateExtendPayload(
                    stepPrompt, aspectRatio, extendModel,
                    currentMediaId, currentWorkflowId, projectId, extToken
                );

                sendLog(`[Step ${step}] Gửi lệnh Extend...`, 'info');
                let extGenRes = null;
                for (let extRetry = 0; extRetry < 3; extRetry++) {
                    extGenRes = await this.generateVideoViaExtension(EXTEND_URL, extPayload, sendLog, stepId);
                    if (extGenRes) break;
                    if (extRetry < 2) {
                        sendLog(`⚠️ Extend step ${step} thất bại, thử lại ${extRetry + 1}/2 sau 15s...`, 'info');
                        await new Promise(r => setTimeout(r, 15000));
                        const retryToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', stepId, sendLog);
                        const retryPayload = this.generateExtendPayload(stepPrompt, aspectRatio, extendModel, currentMediaId, currentWorkflowId, projectId, retryToken);
                        Object.assign(extPayload, retryPayload);
                    }
                }
                if (!extGenRes) throw new Error(`Extend step ${step} thất bại sau 3 lần thử.`);
                sendLog(`✅ [Step ${step}] Extend API OK`, 'success');

                let extGenIds = null;
                if (Array.isArray(extGenRes.media) && extGenRes.media.length > 0) {
                    extGenIds = extGenRes.media.map(m => m.name).filter(Boolean);
                }
                if (!extGenIds) throw new Error(`Step ${step}: Không nhận được Generation ID từ Extend API.`);

                // workflowId vẫn là workflow gốc (extend trong cùng workflow)
                const wfFromExt = extGenRes.workflows?.[0]?.name;
                if (wfFromExt) currentWorkflowId = wfFromExt;

                sendLog(`⏳ [Step ${step}] Đang render Extend...`, 'info');
                const { mediaId: extMediaId, causToken: extCausToken } = await pollUntilDone(extGenIds, step);

                const extFileName = `extend_chain_${step}.mp4`;
                const extFilePath = path.join(outputFolder, extFileName);
                sendLog(`[Step ${step}] 100% — Tải Extend video...`, 'info');
                await downloadVideo(extMediaId, extCausToken, extFilePath, step, projectId);
                sendLog(`✅ [Step ${step}] Lưu thành công: ${extFileName}`, 'success');

                results.push({ step, filePath: extFilePath, mediaId: extMediaId });

                // Cập nhật mediaId cho bước tiếp theo
                currentMediaId = extMediaId;
            }

            sendLog(`🎉 Hoàn thành! ${results.length} video đã tạo liên tiếp.`, 'success');
            return { success: true, files: results };

        } catch (error) {
            sendLog(`❌ ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // Upload ảnh qua Chrome Extension (MAIN world) để có đầy đủ session googleapis.com
    static uploadImageViaExtension(imgPath, sendLog, taskId, frameName) {
        if (!imgPath || !fs.existsSync(imgPath)) return Promise.resolve(null);
        // Serialize qua _extensionUploadLock — kênh pendingImageUpload/uploadedMediaId chỉ xử lý 1 upload tại 1 lúc
        return new Promise((resolve) => {
            _extensionUploadLock = _extensionUploadLock.then(async () => {
                sendLog(`[JOBID:${taskId}] Đang upload ${frameName} qua Extension (MAIN world)...`, 'info');
                global.googleLabsAuth.imageUploadTriggered = false;
                global.googleLabsAuth.uploadedMediaId = null;
                global.googleLabsAuth.pendingImageUpload = imgPath;

                let waited = 0;
                while (!global.googleLabsAuth.uploadedMediaId && waited < 30) {
                    await new Promise(r => setTimeout(r, 1000));
                    waited++;
                }

                const mediaId = global.googleLabsAuth.uploadedMediaId;
                global.googleLabsAuth.pendingImageUpload = null;
                global.googleLabsAuth.imageUploadTriggered = false; // reset sau khi xong
                global.googleLabsAuth.uploadedMediaId = null;

                if (mediaId && mediaId !== 'FAILED') {
                    sendLog(`[JOBID:${taskId}] ✅ Upload ${frameName} via Extension OK: ${mediaId}`, 'success');
                    resolve(mediaId); return;
                }

                sendLog(`[JOBID:${taskId}] ⚠️ Extension upload thất bại sau ${waited}s`, 'error');
                resolve(null);
            }).catch(() => resolve(null));
        });
    }

    // Gọi bất kỳ API nào qua Chrome Extension (MAIN world) — cùng session với upload, tránh "Media not found"
    static callApiViaExtension(apiUrl, payload, sendLog, taskId, label = 'API', timeoutSec = 30) {
        // Serialize qua _extensionApiLock — kênh pendingVideoGen/videoGenResult chỉ xử lý 1 request tại 1 lúc
        return new Promise((resolve) => {
            _extensionApiLock = _extensionApiLock.then(async () => {
                // Reset triggered flag TRƯỚC khi set pendingVideoGen — đảm bảo Extension nhận được lệnh mới
                global.googleLabsAuth.videoGenTriggered = false;
                global.googleLabsAuth.videoGenResult = null;
                global.googleLabsAuth.pendingVideoGen = {
                    url: apiUrl,
                    payload: payload,
                    bearerToken: global.googleLabsAuth.bearerToken
                };

                let waited = 0;
                while (!global.googleLabsAuth.videoGenResult && waited < timeoutSec) {
                    await new Promise(r => setTimeout(r, 1000));
                    waited++;
                }

                const result = global.googleLabsAuth.videoGenResult;
                global.googleLabsAuth.pendingVideoGen = null;
                global.googleLabsAuth.videoGenTriggered = false; // reset sau khi xong
                global.googleLabsAuth.videoGenResult = null;

                if (!result) {
                    sendLog(`[JOBID:${taskId}] ⚠️ Extension ${label} timeout sau ${waited}s — hãy F5 Google Labs để làm mới phiên`, 'error');
                    resolve({ _extError: `Timeout sau ${waited}s — hãy F5 Google Labs` }); return;
                }
                if (result.error) {
                    const errDetail = String(result.error);
                    sendLog(`[JOBID:${taskId}] ❌ Extension ${label} lỗi: ${errDetail}`, 'error');
                    // Gợi ý re-auth nếu là lỗi HTTP 401/403
                    if (/401|403|unauthorized|forbidden/i.test(errDetail)) {
                        sendLog(`[JOBID:${taskId}] 💡 Phiên Google Labs đã hết hạn — hãy F5 Google Labs rồi thử lại`, 'error');
                    }
                    resolve({ _extError: errDetail }); return;
                }
                resolve(result.data);
            }).catch((e) => resolve({ _extError: e?.message || 'lock error' }));
        });
    }

    // Gọi video gen API qua Chrome Extension (MAIN world) — cùng session với upload, tránh "Media not found"
    static async generateVideoViaExtension(apiUrl, payload, sendLog, taskId) {
        sendLog(`[JOBID:${taskId}] Gửi lệnh Render Video qua Extension (MAIN world)...`, 'info');
        // Timeout 90s — Google API đôi khi phản hồi chậm (30–60s), cần đủ thời gian
        const res = await this.callApiViaExtension(apiUrl, payload, sendLog, taskId, 'VideoGen', 90);
        // res có thể là: data object (thành công), { _extError } (lỗi), hoặc null
        if (res && res._extError) {
            // Lưu lỗi cuối cùng vào global để caller có thể đọc
            global.googleLabsAuth._lastExtError = res._extError;
            // Phát hiện lỗi reCAPTCHA từ Extension — throw isRecaptchaExpired để caller tự động retry/reload
            if (/reCAPTCHA|recaptcha|evaluation.failed|UNUSUAL_ACTIVITY/i.test(String(res._extError))) {
                sendLog(`[JOBID:${taskId}] ⚠️ Extension: reCAPTCHA bị từ chối (UNUSUAL_ACTIVITY) — tự động F5 và thử lại...`, 'info');
                global.googleLabsAuth.recaptchaToken = null; // xóa token hỏng
                const e = new Error('RECAPTCHA_EXPIRED');
                e.isRecaptchaExpired = true;
                throw e;
            }
            return null;
        }
        if (res) {
            sendLog(`[JOBID:${taskId}] ✅ Video gen via Extension OK`, 'success');
            global.googleLabsAuth._lastExtError = null;
        }
        return res || null;
    }

    static async uploadReferenceImage(imgPath, sendLog, taskId) {
        if (!imgPath || !fs.existsSync(imgPath)) return null;
        try {
            const auth = global.googleLabsAuth;
            const fileData = fs.readFileSync(imgPath);
            const fileName = path.basename(imgPath);

            sendLog(`[JOBID:${taskId}] Đang upload ảnh tham chiếu: ${fileName}`, 'info');

            // Format đúng từ F12: gửi JSON với imageBytes là base64
            const base64Image = fileData.toString('base64');
            const body = JSON.stringify({
                "clientContext": {
                    "projectId": auth.projectId,
                    "tool": "PINHOLE"
                },
                "imageBytes": base64Image
            });

            let data;
            try {
                data = await this.fetchAPI('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', 'POST', body);
            } catch (fetchErr) {
                sendLog(`[JOBID:${taskId}] Lỗi upload ảnh tham chiếu (${fetchErr.message.substring(0, 150)})`, 'error');
                return null;
            }
            // Response: {"media": {"name": "<uuid>", ...}}
            const imageId = data?.media?.name || data?.name || data?.imageId || data?.id;
            if (imageId) {
                sendLog(`[JOBID:${taskId}] ✅ Upload ảnh tham chiếu OK: ${imageId}`, 'success');
            } else {
                sendLog(`[JOBID:${taskId}] ⚠️ Upload OK nhưng không có ID. Response: ${JSON.stringify(data).substring(0, 200)}`, 'error');
            }
            return imageId || null;
        } catch (error) {
            sendLog(`[JOBID:${taskId}] Lỗi upload ảnh tham chiếu: ${error.message}`, 'error');
            return null;
        }
    }

    // cache mediaId theo đường dẫn file, tránh upload lại ảnh đã có
    static _imageUploadCache = new Map();

    static async uploadImageAPI(imgPath, sendLog, taskId, frameName) {
        if (!imgPath || !fs.existsSync(imgPath)) return null;

        // reuse mediaId nếu ảnh này đã từng upload trong phiên này
        if (VeoEngine._imageUploadCache.has(imgPath)) {
            const cachedId = VeoEngine._imageUploadCache.get(imgPath);
            sendLog(`[JOBID:${taskId}] ♻️ Dùng lại ${frameName} frame đã upload (${cachedId.slice(-8)})`, 'info');
            return cachedId;
        }

        sendLog(`[JOBID:${taskId}] Đang upload ${frameName} frame...`, 'info');

        const doUpload = async () => {
            const auth = global.googleLabsAuth;
            const fileData = fs.readFileSync(imgPath);
            const base64Image = fileData.toString('base64');
            const body = JSON.stringify({
                "clientContext": { "projectId": auth.projectId, "tool": "PINHOLE" },
                "imageBytes": base64Image
            });
            const data = await this.fetchAPI('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', 'POST', body);
            sendLog(`[JOBID:${taskId}] 🔍 Upload response: ${JSON.stringify(data).substring(0, 300)}`, 'info');
            const rawId = data?.media?.name || data?.name || data?.imageId || data?.id;
            // Trích UUID cuối nếu trả về full path như "projects/xxx/media/uuid"
            const imageId = rawId?.includes('/') ? rawId.split('/').pop() : rawId;
            if (!imageId) throw new Error(`Không lấy được ID từ response: ${JSON.stringify(data).substring(0, 150)}`);
            sendLog(`[JOBID:${taskId}] 🆔 Upload mediaId: ${imageId}`, 'info');
            const responseProjectId = data?.media?.projectId;
            if (responseProjectId && responseProjectId !== global.googleLabsAuth.projectId) {
                sendLog(`[JOBID:${taskId}] ⚠️ ProjectId mismatch! upload:${responseProjectId} vs auth:${global.googleLabsAuth.projectId}`, 'error');
            }
            VeoEngine._imageUploadCache.set(imgPath, imageId);
            sendLog(`[JOBID:${taskId}] ✅ Upload ${frameName} OK`, 'success');
            return imageId;
        };

        try {
            return await doUpload();
        } catch (error) {
            if (error.isBearerExpired) {
                sendLog(`[JOBID:${taskId}] 🔄 Bearer token hết hạn khi upload ${frameName} — tự động F5 Google Labs...`, 'warn');
                const ok = await this.reloadLabsAndWait(sendLog, taskId);
                if (ok) {
                    try { return await doUpload(); } catch (e2) {
                        sendLog(`[JOBID:${taskId}] ❌ Upload ${frameName} thất bại sau reload: ${e2.message}`, 'error');
                        return null;
                    }
                }
            }
            sendLog(`[JOBID:${taskId}] ❌ Lỗi Upload ${frameName}: ${error.message}`, 'error');
            return null;
        }
    }

    static findUrlsInObject(obj, depth = 0) {
        if (depth > 6 || !obj || typeof obj !== 'object') return [];
        const found = [];
        for (const [, v] of Object.entries(obj)) {
            if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('gs://'))) {
                found.push(v);
            } else if (typeof v === 'object') {
                found.push(...this.findUrlsInObject(v, depth + 1));
            }
        }
        return found;
    }

    // Extension tải video bytes qua Chrome (full-session) và ghi vào destPath.
    // Serialize qua mutex — pendingVideoDownload là single-slot, không thể chạy song song.
    static downloadViaExtension(mediaName, destPath) {
        return new Promise((outerResolve, outerReject) => {
            _downloadViaExtLock = _downloadViaExtLock.then(() =>
                new Promise((innerResolve) => { // innerResolve LUÔN được gọi để không block chain
                    const auth = global.googleLabsAuth;
                    auth.videoDownloadTriggered = false; // reset trước mỗi download mới — tránh cờ cũ block
                    auth.pendingVideoDownload   = mediaName;
                    auth.videoDownloadDone      = false;
                    auth.videoDownloadError     = null;
                    auth.videoDownloadPath      = null;

                    const done = (err, result) => {
                        auth.pendingVideoDownload = null;
                        innerResolve(); // mở lock cho job tiếp theo
                        if (err) outerReject(err);
                        else outerResolve(result);
                    };

                    let waited = 0;
                    const MAX_WAIT = 180; // 3 phút / download
                    const timer = setInterval(async () => {
                        waited++;
                        if (auth.videoDownloadDone) {
                            clearInterval(timer);
                            const src = auth.videoDownloadPath;
                            auth.videoDownloadDone = false;
                            auth.videoDownloadPath = null;

                            if (src && fs.existsSync(src)) {
                                try {
                                    fs.copyFileSync(src, destPath);
                                    try { fs.unlinkSync(src); } catch {}
                                    const sz = fs.statSync(destPath).size;
                                    if (sz < 1000) {
                                        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                                        return done(new Error(`Extension download quá nhỏ: ${sz} bytes`));
                                    }
                                    return done(null, destPath);
                                } catch (e) { return done(e); }
                            }
                            if (src && (src.startsWith('https://') || src.startsWith('http://'))) {
                                try {
                                    await VeoEngine.downloadMedia(src, destPath, false);
                                    return done(null, destPath);
                                } catch (e) { return done(e); }
                            }
                            return done(new Error('Extension download done nhưng không có file/URL'));
                        }
                        if (auth.videoDownloadError) {
                            clearInterval(timer);
                            const err = auth.videoDownloadError;
                            auth.videoDownloadError = null;
                            return done(new Error(`Extension download lỗi: ${err}`));
                        }
                        if (waited >= MAX_WAIT) {
                            clearInterval(timer);
                            return done(new Error('Extension chrome.downloads timeout sau 180s'));
                        }
                    }, 1000);
                })
            ).catch(() => {}); // absorb để không break chain
        });
    }

    static resolveMediaViaExtension(mediaName) {
        // Serialize qua mutex — nhiều jobs hoàn thành cùng lúc không ghi đè resolveMediaRequest
        return new Promise((resolve, reject) => {
            _resolveMediaLock = _resolveMediaLock.then(async () => {
                try {
                    // Yêu cầu Chrome Extension MAIN world resolve URL (Chrome có session đầy đủ)
                    global.googleLabsAuth.resolveMediaRequest = mediaName;
                    global.googleLabsAuth.resolvedMediaUrl = null;

                    let waited = 0;
                    while (!global.googleLabsAuth.resolvedMediaUrl && waited < 25) {
                        await new Promise(r => setTimeout(r, 1000));
                        waited++;
                    }

                    const url = global.googleLabsAuth.resolvedMediaUrl;
                    global.googleLabsAuth.resolveMediaRequest = null;
                    global.googleLabsAuth.resolvedMediaUrl = null;

                    if (url) { resolve(url); return; }
                    const err = new Error('Extension không resolve được video URL sau 25 giây');
                    reject(err); throw err;
                } catch (e) { reject(e); throw e; }
            }).catch(() => {});
        });
    }

    // Lấy URL thực từ labs.google tRPC mà KHÔNG để Chrome fetch/consume token.
    // Dùng redirect:'manual' trong Electron để đọc Location header trực tiếp.
    // Nếu thành công → trả về flow-content.google URL chưa bị consume → download ngay.
    static async resolveMediaUrlDirect(mediaName) {
        const tRPCUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
        const headers = VeoEngine.buildFullAuthHeaders();

        // Luôn dùng kết nối trực tiếp — tRPC URL resolve không cần qua proxy
        const { location: locationHeader, status, body: bodyText } = await new Promise((resolve, reject) => {
            const parsedUrl = new URL(tRPCUrl);
            const req = https.request({
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers,
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    resolve({ location: res.headers['location'] || null, status: res.statusCode, body: data });
                });
            });
            req.on('error', (e) => reject(new Error(`https.request failed: ${e.message}`)));
            req.end();
        });

        // Ưu tiên 1: Location header (307/302 redirect)
        if (locationHeader && locationHeader.startsWith('http')) return locationHeader;

        // Ưu tiên 2: body JSON (nếu server trả 200 JSON)
        try {
            if (bodyText && bodyText.length > 0) {
                const extracted = VeoEngine.extractUrlFromJson(bodyText);
                if (extracted) return extracted;
            }
        } catch {}

        throw new Error(`resolveMediaUrlDirect: status=${status}, no location/url`);
    }

    // Xây dựng headers đầy đủ giống Chrome (dùng cho labs.google và các URL cần session đầy đủ)
    static buildFullAuthHeaders() {
        const auth = global.googleLabsAuth;
        const headers = {};
        if (auth.rawHeaders && Array.isArray(auth.rawHeaders)) {
            auth.rawHeaders.forEach(h => {
                const name = h.name.toLowerCase();
                if (!['content-length', 'accept-encoding', 'host', 'connection'].includes(name)) {
                    headers[name] = h.value;
                }
            });
        }
        headers['authorization']  = `Bearer ${auth.bearerToken}`;
        if (!headers['cookie'])      headers['cookie']      = auth.cookie;
        if (!headers['origin'])      headers['origin']      = 'https://labs.google';
        if (!headers['referer'])     headers['referer']     = 'https://labs.google/';
        if (!headers['user-agent'])  headers['user-agent']  = auth.userAgent || '';
        return headers;
    }

    // Trích xuất URL video từ body JSON nhỏ (tRPC / Google API wrapper)
    // Trả về URL string nếu tìm thấy, null nếu không
    static extractUrlFromJson(text) {
        try {
            const json = JSON.parse(text);
            // Thử các cấu trúc phổ biến của tRPC và Google API
            const candidates = [
                json?.[0]?.result?.data,
                json?.[0]?.result?.data?.url,
                json?.result?.data,
                json?.result?.data?.url,
                json?.data?.url,
                json?.url,
                json?.videoUrl,
                json?.mediaUrl,
                json?.downloadUrl,
            ];
            for (const c of candidates) {
                if (typeof c === 'string' && (c.startsWith('https://') || c.startsWith('http://'))) return c;
            }
        } catch {}
        return null;
    }

    static async downloadMedia(url, destPath, useAuth = false) {
        if (!url || typeof url !== 'string') throw new Error(`URL không hợp lệ: ${url}`);
        const auth = global.googleLabsAuth;
        const options = { redirect: 'follow' };

        const isGCSUrl = url.includes('storage.googleapis.com') || url.includes('lh3.googleusercontent.com');
        const isLabsUrl = url.includes('labs.google');
        const isFlowContent = url.includes('flow-content.google');

        if (isFlowContent) {
            // Signed CDN URL (Expires+KeyName+Signature) — auth nằm trong URL, không cần cookie/bearer
            options.headers = {
                'user-agent': auth?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };
        } else if (useAuth && !isGCSUrl) {
            // Nếu là labs.google URL: dùng full Chrome headers để tránh bị block
            // Nếu là URL khác (flow-content, v.v.): dùng auth cơ bản
            if (isLabsUrl) {
                options.headers = this.buildFullAuthHeaders();
            } else {
                options.headers = {
                    'authorization': `Bearer ${auth.bearerToken}`,
                    'cookie': auth.cookie,
                    'origin': 'https://labs.google',
                    'referer': 'https://labs.google/',
                    'user-agent': auth.userAgent || ''
                };
            }
        }

        // Download luôn dùng kết nối trực tiếp — proxy chỉ cần cho API tạo nội dung
        // File đã tạo xong, tải về bằng Bearer token là đủ, không cần IP khớp proxy
        const { statusCode, contentType, resStream } = await new Promise((resolve, reject) => {
            const followRedirect = (reqUrl, depth = 0) => {
                if (depth > 5) return reject(new Error('Quá nhiều redirect'));
                const parsedUrl = new URL(reqUrl);
                const req = https.request({
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: options.headers || {},
                }, (res) => {
                    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers['location']) {
                        return followRedirect(res.headers['location'], depth + 1);
                    }
                    resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] || '', resStream: res });
                });
                req.on('error', reject);
                req.end();
            };
            followRedirect(url);
        });

        if (statusCode < 200 || statusCode >= 300) {
            throw new Error(`Lỗi tải file, Status: ${statusCode}`);
        }

        // Luôn lưu ảnh tĩnh dưới dạng .jpg — convert từ webp/png nếu cần
        let finalPath = destPath;
        if (!contentType.includes('video/') && !destPath.endsWith('.jpg')) {
            finalPath = destPath.replace(/\.(png|webp|bmp|jpeg)$/i, '.jpg');
        }

        const fileStream = fs.createWriteStream(finalPath);
        await pipeline(resStream, fileStream);

        // Nếu server trả về WebP/PNG content nhưng đã lưu với tên .jpg → convert
        if (contentType.includes('image/webp') || contentType.includes('image/png')) {
            finalPath = convertToJpeg(finalPath);
        }

        // Kiểm tra file hợp lệ (> 1KB, không phải HTML error page)
        const fileSize = fs.statSync(finalPath).size;
        if (fileSize < 1000) {
            // Thử parse JSON để tìm URL thực (tRPC / Google API wrapper trả về JSON thay vì redirect)
            try {
                const bodyText = fs.readFileSync(finalPath, 'utf-8').trim();
                fs.unlinkSync(finalPath);
                const extractedUrl = VeoEngine.extractUrlFromJson(bodyText);
                if (extractedUrl) {
                    // Tải lại từ URL thực tìm được trong JSON
                    return await VeoEngine.downloadMedia(extractedUrl, destPath, false);
                }
                throw new Error(`Response không hợp lệ (${fileSize} bytes): ${bodyText.slice(0, 120)}`);
            } catch (e) {
                if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
                throw e;
            }
        }

        // Trả về path thực tế (có thể khác destPath nếu đổi extension)
        return finalPath;
    }

    // Upscale ảnh bằng ffmpeg sau khi tải về (1K=native, 2K=2048px cạnh dài, 4K=4096px)
    static async upscaleImage(filePath, quality, aspectRatio) {
        if (!quality || quality === '1K') return filePath;
        const targetPx = quality === '4K' ? 4096 : 2048;
        const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
        const scaleFilter = isPortrait ? `scale=-2:${targetPx}` : `scale=${targetPx}:-2`;
        const ext = path.extname(filePath);
        const tmpPath = filePath.replace(ext, `_up${ext}`);
        const ffmpegBin = (() => { try { return require('ffmpeg-static'); } catch(_) { return 'ffmpeg'; } })();
        await new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const proc = spawn(ffmpegBin, ['-y', '-i', filePath, '-vf', scaleFilter, '-q:v', '2', tmpPath]);
            proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg upscale exit ${code}`)));
            proc.on('error', reject);
        });
        fs.unlinkSync(filePath);
        fs.renameSync(tmpPath, filePath);
        return filePath;
    }

    static async run(jobData, sendLog) {
        const { mediaType, tasks, aspectRatio, model, genCount, quality = '1K', outputFolder, duration } = jobData;
        let results = [];

        try {
            if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
            const check = await this.checkCookie();
            if (!check.success) throw new Error(check.error);

            sendLog(`Khởi động động cơ API...`, 'info');

            // _tmplMode dùng API trực tiếp (không qua Extension/ReCaptcha) → cho phép nhiều luồng hơn
            const hasTmplMode = tasks.some(t => t._tmplMode);
            const hasIngredients = tasks.some(t => t.ingredientMediaIds?.length || t.ingredientImages?.length);
            const MAX_WORKERS = 8;
            let activeJobs = 0;

            // Trả về số thứ tự 1-based từ task.fileIndex hoặc task.id
            const getSeqNum = (task) => {
                if (typeof task.fileIndex === 'number' && task.fileIndex > 0) return task.fileIndex;
                const id = String(task.id || '');
                const vidM  = id.match(/^vid_(\d+)/);   if (vidM)  return parseInt(vidM[1])  + 1;
                const dnaM  = id.match(/^dna_c(\d+)/);  if (dnaM)  return parseInt(dnaM[1])  + 1;
                const trailM = id.match(/_(\d+)(?:_r\d+)?$/); if (trailM) return parseInt(trailM[1]) + 1;
                return 1;
            };

            // Wrapper retry 500/503/429 với exponential backoff (tối đa 4 lần)
            const fetchWithRetry = async (url, method, body, label, taskId) => {
                let delay = 5000;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    try {
                        return await VeoEngine.fetchAPI(url, method, body);
                    } catch (e) {
                        const code = e.statusCode;
                        const retryable = code === 500 || code === 503 || code === 429;
                        if (retryable && attempt < 4) {
                            const waitSec = code === 429 ? Math.max(delay / 1000, 30) : delay / 1000;
                            sendLog(`[JOBID:${taskId}] ⚠ ${label} lỗi ${code}${code === 429 ? ' (quota throttle)' : ''} — thử lại sau ${waitSec}s (lần ${attempt}/3)`, 'info');
                            await new Promise(r => setTimeout(r, waitSec * 1000));
                            delay = Math.min(delay * 2, 60000);
                            continue;
                        }
                        throw e;
                    }
                }
            };

            const processTask = async (task) => {
                // Nếu đang bị tạm dừng → báo lỗi ngay để waitAllDone resolve sớm
                if (VeoEngine._paused) {
                    sendLog(`[JOBID:${task.id}] ⏸ Tạm dừng`, 'error');
                    sendLog(`[JOBID:${task.id}]`, 'job_fail');
                    results.push({ id: task.id, isError: true, error: 'paused' });
                    return;
                }
                sendLog(`[JOBID:${task.id}]`, 'job_start');

                try {
                    const auth = global.googleLabsAuth;

                    if (mediaType === 'Image') {
                        if (!auth.projectId) {
                            throw new Error("Chưa nhận được mã Workspace ID. Hãy F5 tab Google Labs để Extension quét lại!");
                        }

                        if (auth.cookie && (auth.atToken || auth.projectId)) {
                            // ── FLOW API: flow.google.com batchexecute (ogiZ0b) ────────
                            // maseQ upload ảnh tham chiếu xảy ra bên trong extension (background.js)
                            const flowResults = await this.generateImageViaFlow(
                                sanitizeVeoPrompt(task.prompt), aspectRatio, genCount, model, sendLog, task.id,
                                task.referenceImages || []
                            );
                            const imgPrefixF = String(task.id || '').startsWith('dna_c') ? 'TC_image' : 'image';
                            const downloadedFiles = [];
                            const mediaGenerationIds = [];
                            for (let i = 0; i < flowResults.length; i++) {
                                const { downloadUrl, uuid2, imageData } = flowResults[i];
                                const suffix = flowResults.length > 1 ? `_${i + 1}` : '';
                                const fileName = `${imgPrefixF}_${getSeqNum(task)}${suffix}.jpg`;
                                let filePath = path.join(outputFolder, fileName);
                                mediaGenerationIds.push(uuid2);
                                try {
                                    const fss = require('fs');
                                    fss.mkdirSync(path.dirname(filePath), { recursive: true });
                                    if (imageData?.fromFilePath && imageData?.filePath && fss.existsSync(imageData.filePath)) {
                                        // chrome.downloads tải về temp (thường WebP) → copy rồi convert sang jpg
                                        fss.copyFileSync(imageData.filePath, filePath);
                                        try { fss.unlinkSync(imageData.filePath); } catch(_) {}
                                        filePath = convertToJpeg(filePath);
                                        downloadedFiles.push(path.basename(filePath));
                                    } else {
                                        const savedPath = await this.downloadMedia(downloadUrl, filePath, false);
                                        downloadedFiles.push(path.basename(savedPath));
                                    }
                                } catch (e) {
                                    sendLog(`[JOBID:${task.id}] Không tải được ảnh [${i}]: ${(e.message || '').slice(0, 80)}`, 'info');
                                }
                            }
                            if (downloadedFiles.length === 0) throw new Error('Không tải được ảnh nào từ flow.google.com. Thử lại hoặc đổi model.');
                            sendLog(`[JOBID:${task.id}] Lưu thành công: ${downloadedFiles.join(', ')}`, 'success');
                            const _imgFpF = path.join(outputFolder, downloadedFiles[0]);
                            sendLog(`[JOBID:${task.id}]|PATH:${_imgFpF}`, 'job_success');
                            results.push({ id: task.id, prompt: task.prompt, filePath: _imgFpF, mediaId: mediaGenerationIds[0] || null });

                        } else {
                            // ── OLD API: aisandbox-pa.googleapis.com ───────────────────
                            // Upload ảnh tham chiếu qua Labs API TRƯỚC — tránh token hết hạn
                            const referenceImageIds = [];
                            if (task.referenceImages && task.referenceImages.length > 0) {
                                sendLog(`[JOBID:${task.id}] Đang upload ${task.referenceImages.length} ảnh tham chiếu...`, 'info');
                                for (const imgPath of task.referenceImages) {
                                    const imgId = await this.uploadReferenceImage(imgPath, sendLog, task.id);
                                    if (imgId) referenceImageIds.push(imgId);
                                }
                                if (referenceImageIds.length > 0) {
                                    sendLog(`[JOBID:${task.id}] ✅ Đã upload ${referenceImageIds.length} ảnh tham chiếu`, 'success');
                                }
                            }
                            const imageApiUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia:batchGenerateImages`;
                            let genRes;
                            let imgAutoReloaded = false;
                            for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                const imgRecaptchaToken = await VeoEngine.acquireRecaptcha('IMAGE_GENERATION', task.id, sendLog);
                                sendLog(`[JOBID:${task.id}] Bắn lệnh tạo ảnh lên AI Sandbox${tokenTry > 1 ? ` (lần ${tokenTry})` : ''}...`, 'info');
                                const payload = this.generateImagePayload(sanitizeVeoPrompt(task.prompt), aspectRatio, genCount, auth.projectId, imgRecaptchaToken, model, referenceImageIds);
                                try {
                                    genRes = await this.fetchAPI(imageApiUrl, 'POST', payload);
                                    break;
                                } catch (e) {
                                    if (e.isRecaptchaExpired && tokenTry < 3) {
                                        sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, tự động lấy token mới (${tokenTry}/3)...`, 'info');
                                        await VeoEngine.randDelay(2000, 4000);
                                        continue;
                                    }
                                    if (e.isRecaptchaExpired && !imgAutoReloaded) {
                                        imgAutoReloaded = true;
                                        const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                        if (ok) { tokenTry = 0; continue; }
                                    }
                                    if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi. Vui lòng thử lại sau.");
                                    throw e;
                                }
                            }

                            let generatedMedia = genRes.generatedMedia;
                            if (!generatedMedia || generatedMedia.length === 0) {
                                if (Array.isArray(genRes.responses)) generatedMedia = genRes.responses.flatMap(r => r.generatedMedia || []);
                            }
                            if (!generatedMedia || generatedMedia.length === 0) generatedMedia = genRes.mediaGenerationResult?.generatedMedia || [];
                            if (!generatedMedia || generatedMedia.length === 0) generatedMedia = genRes.images || genRes.media || genRes.results || [];
                            if (!generatedMedia || generatedMedia.length === 0) {
                                if (genRes.error) throw new Error(genRes.error.message || "Bị từ chối do vi phạm chính sách");
                                throw new Error(`API không trả về ảnh. Response keys: [${Object.keys(genRes).join(', ')}]`);
                            }

                            sendLog(`[JOBID:${task.id}] Nhận thành công ${generatedMedia.length} ảnh, đang tải về...`, 'progress');

                            const downloadedFiles = [];
                            const mediaGenerationIds = [];
                            const imgPrefix = String(task.id || '').startsWith('dna_c') ? 'TC_image' : 'image';
                            for (let i = 0; i < generatedMedia.length; i++) {
                                const imgData = generatedMedia[i];
                                const suffix = generatedMedia.length > 1 ? `_${i + 1}` : '';
                                const fileName = `${imgPrefix}_${getSeqNum(task)}${suffix}.png`;
                                const filePath = path.join(outputFolder, fileName);

                                const causToken = imgData.image?.generatedImage?.mediaGenerationId;
                                const mediaName = imgData.name;
                                const flowMediaUUID = mediaName?.split('/').pop();
                                if (flowMediaUUID && flowMediaUUID.includes('-')) {
                                    mediaGenerationIds.push(flowMediaUUID);
                                } else if (causToken) {
                                    mediaGenerationIds.push(causToken);
                                }

                                const scannedUrls = this.findUrlsInObject(imgData);
                                const attempts = [];
                                scannedUrls.forEach(u => attempts.push({ url: u, auth: u.includes('googleapis.com') }));
                                if (causToken) attempts.push({ url: `https://lh3.googleusercontent.com/ais-proxy/${causToken}=s0`, auth: false });
                                if (mediaName) attempts.push({ url: `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia/${mediaName}?alt=media`, auth: true });
                                if (causToken) attempts.push({ url: `https://aisandbox-pa.googleapis.com/v1/flowMedia/${causToken}:download`, auth: true });

                                let downloaded = false;
                                for (const attempt of attempts) {
                                    try {
                                        const savedPath = await this.downloadMedia(attempt.url, filePath, attempt.auth);
                                        downloadedFiles.push(path.basename(savedPath));
                                        downloaded = true;
                                        break;
                                    } catch (_) {}
                                }
                                if (!downloaded) sendLog(`[JOBID:${task.id}] Không tải được ảnh [${i}] — bỏ qua.`, 'info');
                            }

                            if (downloadedFiles.length === 0) throw new Error("Không tải được ảnh nào từ server. Thử lại hoặc đổi model.");
                            sendLog(`[JOBID:${task.id}] Lưu thành công: ${downloadedFiles.join(', ')}`, 'success');
                            const _imgFp = path.join(outputFolder, downloadedFiles[0]);
                            sendLog(`[JOBID:${task.id}]|PATH:${_imgFp}`, 'job_success');
                            results.push({ id: task.id, prompt: task.prompt, filePath: _imgFp, mediaId: mediaGenerationIds[0] || null });
                        }

                    } else {
                        // LUỒNG TẠO VIDEO
                        global.googleLabsAuth.recaptchaAction = 'VIDEO_GENERATION';
                        let startImageId = null; let endImageId = null;
                        let isIngredients = false; let isI2V = false;
                        let genRes;

                        if ((task.ingredientImages && task.ingredientImages.length > 0) || (task.ingredientMediaIds && task.ingredientMediaIds.length > 0)) {
                            // === INGREDIENTS FLOW ===
                            isIngredients = true;
                            let ingredientMediaIds = [];
                            const INGRED_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages';

                            if (auth.cookie && auth.projectId && task.ingredientImages && task.ingredientImages.length > 0 && !task._tmplMode) {
                                // === FLOW API PATH (MZZa6b) — dùng Chrome session, không cần Labs token ===
                                // MZZa6b hỗ trợ voice natively: task[7] = [[voiceId]]
                                const imgNames = task.ingredientImages.map(p => p?.split(/[\\/]/).pop() || '?').join(', ');
                                sendLog(`[JOBID:${task.id}] Flow R2V (MZZa6b): [${imgNames}] | model=${model} ${duration} | ${aspectRatio}${task.voiceId ? ' | voice=' + task.voiceId : ''}`, 'info');
                                const { videoUrl: r2vFlowUrl } = await this.generateR2VViaFlowBatchexecute(
                                    sanitizeVeoPrompt(task.prompt), task.ingredientImages, aspectRatio, model, duration, sendLog, task.id, task.voiceId
                                );
                                genRes = { _flowVideoUrl: r2vFlowUrl };
                            } else if (task._tmplMode && task.ingredientImages && task.ingredientImages.length > 0) {
                                // === TEMPLATE MODE: upload via API (bearer token, cached) → gen via fetchAPI trực tiếp ===
                                // Dùng cho TemplateVideoPanel — tránh Extension lock bottleneck khi 79 task song song
                                sendLog(`[JOBID:${task.id}] [Template] Upload ${task.ingredientImages.length} ảnh qua API...`, 'info');
                                for (let iIdx = 0; iIdx < task.ingredientImages.length; iIdx++) {
                                    const imgPath = task.ingredientImages[iIdx];
                                    const fname = imgPath?.split(/[\\/]/).pop() || '?';
                                    const mediaId = await this.uploadImageAPI(imgPath, sendLog, task.id, `Frame${iIdx + 1}(${fname})`);
                                    if (mediaId) ingredientMediaIds.push(mediaId);
                                }
                                if (ingredientMediaIds.length === 0) throw new Error('Không upload được ảnh nào.');
                                let tmplAutoReloaded = false;
                                for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                    const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                    const ingredPayload = this.generateIngredientsPayload(sanitizeVeoPrompt(task.prompt), aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds, null, duration);
                                    try {
                                        genRes = await this.generateVideoViaExtension(INGRED_URL, ingredPayload, sendLog, task.id);
                                        if (!genRes) throw new Error('Template Ingredients gen thất bại');
                                        break;
                                    } catch (e) {
                                        if (e.isRecaptchaExpired && tokenTry < 3) {
                                            sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, lấy token mới (${tokenTry}/3)...`, 'info');
                                            await VeoEngine.randDelay(2000, 4000); continue;
                                        }
                                        if (e.isRecaptchaExpired && !tmplAutoReloaded) {
                                            tmplAutoReloaded = true;
                                            const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                            if (ok) { tokenTry = 0; continue; }
                                        }
                                        sendLog(`[JOBID:${task.id}] ❌ lỗi (lần ${tokenTry}): ${(e.message||'unknown').slice(0, 150)}`, 'error');
                                        throw e;
                                    }
                                }
                            } else if (task.ingredientMediaIds && task.ingredientMediaIds.length > 0) {
                                // UUID có sẵn — upload đã được thực hiện trước, gen qua Extension
                                ingredientMediaIds = task.ingredientMediaIds;
                                sendLog(`[JOBID:${task.id}] Dùng ${ingredientMediaIds.length} ảnh DNA (UUID sẵn có)...`, 'info');
                                if (task.voiceId) sendLog(`[JOBID:${task.id}] 🎙️ Giọng: ${task.voiceId}`, 'info');
                                const _sanitizedPrompt = sanitizeVeoPrompt(task.prompt);
                                let ingr1AutoReloaded = false;
                                for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                    const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                    const ingredPayload = this.generateIngredientsPayload(_sanitizedPrompt, aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds, task.voiceId || null, duration);
                                    try {
                                        genRes = await this.generateVideoViaExtension(INGRED_URL, ingredPayload, sendLog, task.id);
                                        if (!genRes) throw new Error('Ingredients gen thất bại');
                                        break;
                                    } catch (e) {
                                        if (e.isRecaptchaExpired && tokenTry < 3) {
                                            sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, lấy token mới (${tokenTry}/3)...`, 'info');
                                            await VeoEngine.randDelay(2000, 4000); continue;
                                        }
                                        if (e.isRecaptchaExpired && !ingr1AutoReloaded) {
                                            ingr1AutoReloaded = true;
                                            const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                            if (ok) { tokenTry = 0; continue; }
                                        }
                                        if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi. Vui lòng thử lại sau.");
                                        throw e;
                                    }
                                }
                            } else {
                                // Upload ảnh local qua Extension rồi gen qua Extension (cùng Chrome session)
                                sendLog(`[JOBID:${task.id}] Uploading ${task.ingredientImages.length} Ingredient image(s)...`, 'info');
                                for (let iIdx = 0; iIdx < task.ingredientImages.length; iIdx++) {
                                    const imgPathForLog = task.ingredientImages[iIdx]?.split(/[\\/]/).pop() || '?';
                                    sendLog(`[JOBID:${task.id}] → Ingredient ${iIdx + 1}: ${imgPathForLog}`, 'info');
                                    const mediaId = await this.uploadImageAPI(task.ingredientImages[iIdx], sendLog, task.id, `Ingredient${iIdx + 1}`);
                                    if (mediaId) ingredientMediaIds.push(mediaId);
                                }
                                if (ingredientMediaIds.length === 0) throw new Error("Không có ảnh Ingredient hợp lệ.");
                                if (task.voiceId) sendLog(`[JOBID:${task.id}] 🎙️ Giọng: ${task.voiceId}`, 'info');
                                let ingr2AutoReloaded = false;
                                for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                    const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                    const ingredPayload = this.generateIngredientsPayload(sanitizeVeoPrompt(task.prompt), aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds, task.voiceId || null, duration);
                                    try {
                                        // Gọi qua Extension MAIN world — tránh Media not found
                                        genRes = await this.generateVideoViaExtension(INGRED_URL, ingredPayload, sendLog, task.id);
                                        if (!genRes) throw new Error('Extension Ingredients gen thất bại');
                                        break;
                                    } catch (e) {
                                        if (e.isRecaptchaExpired && tokenTry < 3) {
                                            sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, lấy token mới (${tokenTry}/3)...`, 'info');
                                            await VeoEngine.randDelay(2000, 4000); continue;
                                        }
                                        if (e.isRecaptchaExpired && !ingr2AutoReloaded) {
                                            ingr2AutoReloaded = true;
                                            const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                            if (ok) { tokenTry = 0; continue; }
                                        }
                                        if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi. Vui lòng thử lại sau.");
                                        throw e;
                                    }
                                }
                            }
                        } else {
                            // === T2V / I2V FLOW ===
                            if (task.startImage) {
                                // I2V: upload trực tiếp qua API (Node.js https, không qua Extension lock)
                                // → nhiều task I2V chạy song song, không bị serialize
                                startImageId = await this.uploadImageAPI(task.startImage, sendLog, task.id, 'Start');
                            }
                            if (task.endImage) {
                                endImageId = await this.uploadImageAPI(task.endImage, sendLog, task.id, 'End');
                            }

                            // Chọn endpoint theo loại: T2V / I2V start only / I2V start+end
                            isI2V = !!startImageId;
                            let VIDEO_GEN_URL;
                            if (!isI2V) {
                                VIDEO_GEN_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
                            } else if (endImageId) {
                                VIDEO_GEN_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage';
                            } else {
                                VIDEO_GEN_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage';
                            }

                            if (isI2V) {
                                // I2V: gọi qua Extension MAIN world (Chrome session đầy đủ) — tránh 500 do session validation
                                sendLog(`[JOBID:${task.id}] Gửi lệnh Render I2V API...`, 'info');
                                let i2vRetry = 0;
                                let i2vAutoReloaded = false;
                                while (i2vRetry < 3) {
                                    try {
                                        const videoRecaptchaToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                        const videoPayload = this.generateVideoPayload(sanitizeVeoPrompt(task.prompt), aspectRatio, model, duration, auth.projectId, videoRecaptchaToken, startImageId, endImageId, quality);
                                        genRes = await this.generateVideoViaExtension(VIDEO_GEN_URL, videoPayload, sendLog, task.id);
                                        if (!genRes) throw new Error('I2V gen thất bại hoặc timeout');
                                        break;
                                    } catch (e) {
                                        const msg = e.message || '';
                                        if (e.isRecaptchaExpired && !i2vAutoReloaded) {
                                            i2vAutoReloaded = true;
                                            sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, tự động lấy token mới...`, 'info');
                                            const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                            if (ok) { i2vRetry = 0; continue; }
                                        }
                                        if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi.");
                                        if ((msg.includes('500') || msg.includes('503') || msg.includes('timeout')) && i2vRetry < 2) {
                                            i2vRetry++;
                                            sendLog(`[JOBID:${task.id}] ⚠️ Server lỗi, thử lại ${i2vRetry}/2 (lấy mã mới)...`, 'info');
                                            await new Promise(r => setTimeout(r, 5000));
                                        } else { throw e; }
                                    }
                                }
                            } else {
                                // T2V
                                const isFlowVideoMode = !auth.bearerToken && auth.cookie && auth.projectId;
                                if (isFlowVideoMode) {
                                    // flow.google.com batchexecute path (YhhmEf → jwpduf)
                                    sendLog(`[JOBID:${task.id}] Tạo video qua flow.google.com batchexecute...`, 'info');
                                    const { videoUrl: flowVideoUrl } = await VeoEngine.generateVideoViaFlowBatchexecute(
                                        sanitizeVeoPrompt(task.prompt), aspectRatio, model, duration, sendLog, task.id
                                    );
                                    genRes = { _flowVideoUrl: flowVideoUrl };
                                } else {
                                    // aisandbox-pa path via Extension (needs Bearer token)
                                    sendLog(`[JOBID:${task.id}] Gửi lệnh Render Video API...`, 'info');
                                    let t2vRetry = 0;
                                    let t2vAutoReloaded = false;
                                    while (t2vRetry < 3) {
                                        try {
                                            const freshToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                            const freshPayload = this.generateVideoPayload(sanitizeVeoPrompt(task.prompt), aspectRatio, model, duration, auth.projectId, freshToken, startImageId, endImageId, quality);
                                            genRes = await this.generateVideoViaExtension(VIDEO_GEN_URL, freshPayload, sendLog, task.id);
                                            if (!genRes) throw new Error('Extension T2V gen thất bại hoặc timeout');
                                            break;
                                        } catch (e) {
                                            const msg = e.message || '';
                                            if (e.isRecaptchaExpired && !t2vAutoReloaded) {
                                                t2vAutoReloaded = true;
                                                sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, tự động lấy token mới...`, 'info');
                                                const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                                if (ok) { t2vRetry = 0; continue; }
                                            }
                                            if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi.");
                                            if ((msg.includes('500') || msg.includes('503') || msg.includes('timeout')) && t2vRetry < 2) {
                                                t2vRetry++;
                                                sendLog(`[JOBID:${task.id}] ⚠️ Server lỗi, thử lại ${t2vRetry}/2 (lấy mã mới)...`, 'info');
                                                await new Promise(r => setTimeout(r, 12000));
                                            } else { throw e; }
                                        }
                                    }
                                }
                            }
                        }

                        // Flow batchexecute video — already has final URL, download directly
                        if (genRes && genRes._flowVideoUrl) {
                            const vfn = `video_${getSeqNum(task)}.mp4`;
                            const vfp = path.join(outputFolder, vfn);
                            sendLog(`[JOBID:${task.id}] 100% — Đang tải Video từ flow.google.com...`, 'progress');
                            await VeoEngine.downloadMedia(genRes._flowVideoUrl, vfp, false);
                            sendLog(`[JOBID:${task.id}] Lưu thành công: ${vfn}`, 'success');
                            sendLog(`[JOBID:${task.id}]|PATH:${vfp}`, 'job_success');
                            results.push({ id: task.id, prompt: task.prompt, filePath: vfp });
                            return;
                        }

                        // Trích generationIds — I2V dùng media[].name (UUID), T2V dùng operations[].operation.name
                        let generationIds = null;

                        // Kiểm tra media[] trước — T2V low_priority, I2V và Ingredients đều trả về media[].name (UUID)
                        if (Array.isArray(genRes.media) && genRes.media.length > 0) {
                            const ids = genRes.media.map(m => m.name).filter(Boolean);
                            if (ids.length > 0) generationIds = ids;
                        }

                        if (!generationIds && Array.isArray(genRes.operations) && genRes.operations.length > 0) {
                            const ids = genRes.operations.map(op => op.operation?.name || op.name).filter(Boolean);
                            if (ids.length > 0) generationIds = ids;
                        }
                        if (!generationIds && genRes.generationIds?.length > 0) generationIds = genRes.generationIds;
                        if (!generationIds && Array.isArray(genRes.responses)) {
                            const ids = genRes.responses.map(r => r.generationId || r.id).filter(Boolean);
                            if (ids.length > 0) generationIds = ids;
                        }
                        if (!generationIds && genRes.generationId) generationIds = [genRes.generationId];

                        const operationName = !generationIds ? (genRes.name || genRes.operationId) : null;
                        const generatedVideos = genRes.generatedMedia || genRes.videos || genRes.results || [];

                        let videoSaved = false;

                        // Nếu API trả về ngay lập tức (sync)
                        if (generatedVideos.length > 0) {
                            const videoData = generatedVideos[0];
                            const syncVideoUrl = videoData.media?.video?.url || videoData.media?.uri
                                || videoData.url || videoData.uri;
                            if (syncVideoUrl) {
                                sendLog(`[JOBID:${task.id}] 100% - Đang tải Video...`, 'progress');
                                const vfn = `video_${getSeqNum(task)}.mp4`;
                                const vfp = path.join(outputFolder, vfn);
                                await this.downloadMedia(syncVideoUrl, vfp, true);
                                sendLog(`[JOBID:${task.id}] Lưu thành công: ${vfn}`, 'success');
                                sendLog(`[JOBID:${task.id}]|PATH:${vfp}`, 'job_success');
                                results.push({ id: task.id, prompt: task.prompt, filePath: vfp });
                                videoSaved = true;
                            }
                        }

                        if (!videoSaved) {
                            if (!generationIds && !operationName) {
                                throw new Error("Không nhận được Generation ID từ server.");
                            }

                            sendLog(`[JOBID:${task.id}] Đang Render Video trên server...`, 'info');

                            // Pre-compute output path
                            const videoFileName = `video_${getSeqNum(task)}.mp4`;
                            const videoFilePath = path.join(outputFolder, videoFileName);

                            let mediaUrl = null; let isDone = false; let pollCount = 0; let resolvedUpsMediaName = null;
                            while (!isDone && pollCount < 72) {
                                pollCount++;
                                await new Promise(r => setTimeout(r, 5000));

                                let statusRes;
                                try {
                                    if (generationIds) {
                                        const pollPayload = { media: generationIds.map(id => ({ name: id, projectId: auth.projectId })) };
                                        const POLL_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
                                        // Poll luôn qua Electron — poll chỉ cần auth token hợp lệ, không cần Chrome session
                                        statusRes = await this.fetchAPI(POLL_URL, 'POST', pollPayload);
                                    } else {
                                        statusRes = await this.fetchAPI(
                                            `https://aisandbox-pa.googleapis.com/v1/${operationName}`, 'GET'
                                        );
                                    }
                                } catch (pollErr) {
                                    // 503/429: server tạm bận — bỏ qua lần này, thử lại ở vòng tiếp
                                    const msg = pollErr.message || '';
                                    if (msg.includes('503') || msg.includes('429') || msg.includes('unavailable')) {
                                        sendLog(`[JOBID:${task.id}] ⚠️ Server bận (${msg.substring(0, 40)}), thử lại...`, 'info');
                                        continue;
                                    }
                                    throw pollErr; // lỗi thực sự → throw
                                }

                                // Parse batchCheckAsyncVideoGenerationStatus
                                // Response: {"media":[{"name":"...","mediaMetadata":{...},...}]}
                                const mediaItems = statusRes.media || statusRes.statuses || statusRes.videos || statusRes.results || [];
                                const firstItem = mediaItems[0] || statusRes;

                                // Status path thực tế: media[0].mediaMetadata.mediaStatus.mediaGenerationStatus
                                const rawSt = firstItem.mediaMetadata?.mediaStatus?.mediaGenerationStatus
                                    || firstItem.status
                                    || firstItem.mediaMetadata?.status
                                    || firstItem.state
                                    || statusRes.state
                                    || '';
                                const st = rawSt.toUpperCase().replace('MEDIA_GENERATION_STATUS_', '');

                                if (st === 'SUCCESSFUL' || st === 'SUCCEEDED' || st === 'COMPLETED' || st === 'DONE' || statusRes.done === true) {
                                    const mediaName = firstItem.name || generationIds[0];
                                    const workflowIdDone = firstItem.workflowId || '';

                                    // ── 1080p Upsample (chỉ T2V / I2V / Ingredients sau khi 720p xong) ──
                                    if (quality === '1080p' && mediaName && workflowIdDone) {
                                        sendLog(`[JOBID:${task.id}] 🔼 Bắt đầu upscale 1080p...`, 'info');
                                        try {
                                            const upsToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                            const upsPayload = this.generateUpsamplePayload(mediaName, workflowIdDone, aspectRatio, auth.projectId, upsToken);
                                            const UPS_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo';
                                            const upsRes = await this.fetchAPI(UPS_URL, 'POST', upsPayload);
                                            // Lấy upsMediaName từ response hoặc dùng convention _upsampled
                                            const upsMediaFromRes = (upsRes?.media?.[0]?.name) || (upsRes?.operations?.[0]?.operation?.name);
                                            const upsMediaName = upsMediaFromRes || `${mediaName}_upsampled`;
                                            sendLog(`[JOBID:${task.id}] ⏳ Chờ upscale 1080p hoàn thành... (${upsMediaName})`, 'info');

                                            // Poll status qua aisandbox API — KHÔNG dùng resolveMediaViaExtension
                                            // để tránh consume flow-content.google token trước khi download
                                            let upsReady = false;
                                            for (let u = 0; u < 36 && !upsReady; u++) {
                                                await new Promise(r => setTimeout(r, 5000));
                                                try {
                                                    const upsPollPayload = {
                                                        media: [{ name: upsMediaName, projectId: auth.projectId }]
                                                    };
                                                    const upsPollRes = await this.fetchAPI(
                                                        'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus',
                                                        'POST', upsPollPayload
                                                    );
                                                    const upsItems = upsPollRes?.media || upsPollRes?.statuses || [];
                                                    const upsFirst = upsItems[0] || upsPollRes;
                                                    const upsRawSt = upsFirst?.mediaMetadata?.mediaStatus?.mediaGenerationStatus
                                                        || upsFirst?.status || upsFirst?.mediaMetadata?.status
                                                        || upsFirst?.state || upsPollRes?.state || '';
                                                    const upsSt = upsRawSt.toUpperCase().replace('MEDIA_GENERATION_STATUS_', '');
                                                    if (upsSt === 'SUCCESSFUL' || upsSt === 'SUCCEEDED' || upsSt === 'COMPLETED' || upsSt === 'DONE') {
                                                        upsReady = true;
                                                        resolvedUpsMediaName = upsMediaName;
                                                        // Thử trích xuất URL GCS trực tiếp từ status response
                                                        const directGcsUrl = upsFirst?.video?.url || upsFirst?.video?.uri
                                                            || upsFirst?.mediaMetadata?.video?.url || upsFirst?.mediaMetadata?.video?.uri
                                                            || upsFirst?.uri || null;
                                                        mediaUrl = directGcsUrl || `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${upsMediaName}`;
                                                        sendLog(`[JOBID:${task.id}] ✅ Upscale 1080p sẵn sàng${directGcsUrl ? ' (GCS URL trực tiếp)' : ''}, chuẩn bị tải...`, 'success');
                                                    } else if (upsSt && upsSt !== 'PENDING' && upsSt !== 'RUNNING' && upsSt !== 'IN_PROGRESS' && upsSt !== '') {
                                                        sendLog(`[JOBID:${task.id}] ⏳ Upscale: ${upsSt}`, 'info');
                                                    }
                                                } catch (_) {
                                                    // Status API có thể không accept upsMediaName → fallback resolveMediaViaExtension
                                                    try {
                                                        const testUrl = await this.resolveMediaViaExtension(upsMediaName);
                                                        if (testUrl) {
                                                            upsReady = true;
                                                            resolvedUpsMediaName = upsMediaName;
                                                            mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${upsMediaName}`;
                                                            sendLog(`[JOBID:${task.id}] ✅ Upscale 1080p sẵn sàng (resolve check)`, 'success');
                                                        }
                                                    } catch (_2) {}
                                                }
                                            }
                                            if (upsReady) {
                                                // đã set mediaUrl ở trên
                                            } else {
                                                sendLog(`[JOBID:${task.id}] ⚠️ Upscale timeout — tải 720p thay thế`, 'info');
                                                mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
                                            }
                                        } catch (upsErr) {
                                            sendLog(`[JOBID:${task.id}] ⚠️ Upscale lỗi (${upsErr.message?.substring(0,60)}) — tải 720p thay thế`, 'info');
                                            mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
                                        }
                                    } else {
                                        mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
                                    }
                                    isDone = true;
                                } else if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
                                    const errDetail = firstItem.error?.message || firstItem.errorMessage
                                        || firstItem.mediaMetadata?.mediaStatus?.errorMessage
                                        || firstItem.mediaMetadata?.errorMessage
                                        || firstItem.mediaMetadata?.mediaStatus?.statusDetail
                                        || '';
                                    sendLog(`[JOBID:${task.id}] 🔍 Raw FAILED: ${JSON.stringify(firstItem).substring(0, 300)}`, 'warn');
                                    const errMsg = errDetail
                                        ? `Veo render thất bại (${st}): ${errDetail.substring(0, 150)}`
                                        : `Veo render thất bại — trạng thái: ${st}. Có thể do prompt vi phạm chính sách hoặc ảnh không hợp lệ.`;
                                    throw new Error(errMsg);
                                } else {
                                    const pct = firstItem.progressPercent || firstItem.progress || Math.floor((pollCount / 36) * 100);
                                    sendLog(`[JOBID:${task.id}] ${Math.min(pct, 99)}% (${st || 'PENDING'})`, 'progress');
                                }
                            }

                            if (!mediaUrl) throw new Error("Không lấy được URL video sau khi render xong.");

                            // ── Tải video qua các chiến lược ─────────────────────────────────────
                            sendLog(`[JOBID:${task.id}] 100% - Đang tải Video...`, 'progress');
                            // mediaUrl có thể là tRPC URL (?name=...) hoặc GCS URL trực tiếp
                            const mediaName4dl = mediaUrl.split('?name=')[1] || resolvedUpsMediaName || generationIds?.[0] || '';
                            const isUpsampled   = mediaName4dl.endsWith('_upsampled');
                            const origMediaName = isUpsampled ? mediaName4dl.replace(/_upsampled$/, '') : null;

                            // Nếu mediaUrl là GCS/storage URL trực tiếp → tải ngay không cần strategy
                            const isDirectUrl = mediaUrl.startsWith('https://storage.googleapis.com') || mediaUrl.startsWith('https://lh3.googleusercontent.com');
                            if (isDirectUrl) {
                                sendLog(`[JOBID:${task.id}] 🔗 GCS URL trực tiếp, tải ngay...`, 'info');
                                await VeoEngine.downloadMedia(mediaUrl, videoFilePath, false);
                                sendLog(`[JOBID:${task.id}] Lưu thành công: ${videoFileName}`, 'success');
                                sendLog(`[JOBID:${task.id}]|PATH:${videoFilePath}`, 'job_success');
                                results.push({ id: task.id, prompt: task.prompt, filePath: videoFilePath });
                                return; // kết thúc processTask
                            }

                            let dlDone = false;
                            const dlStrategies = [
                                // 1. aisandbox-pa API trực tiếp — thử ngầm, không log khi thất bại
                                { label: 'aisandbox ?alt=media', silent: true, fn: async () => {
                                    const directUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia/${mediaName4dl}?alt=media`;
                                    return VeoEngine.downloadMedia(directUrl, videoFilePath, true);
                                }},
                                // 2. aisandbox download endpoint — thử ngầm, không log khi thất bại
                                { label: 'aisandbox :download', silent: true, fn: async () => {
                                    const downloadUrl = `https://aisandbox-pa.googleapis.com/v1/flowMedia/${mediaName4dl}:download`;
                                    return VeoEngine.downloadMedia(downloadUrl, videoFilePath, true);
                                }},
                                // 3. tRPC redirect trực tiếp Node.js — KHÔNG cần Chrome Extension
                                // Gọi labs.google tRPC, đọc Location header 307 → lấy flow-content.google URL thực → download ngay
                                { label: 'tRPC redirect direct', silent: false, fn: async () => {
                                    const directUrl = await VeoEngine.resolveMediaUrlDirect(mediaName4dl);
                                    sendLog(`[JOBID:${task.id}] 🔗 tRPC direct → ${directUrl.slice(0, 80)}`, 'info');
                                    return VeoEngine.downloadMedia(directUrl, videoFilePath, false);
                                }},
                                // 4. Extension MAIN world fetch — Chrome renderer có thể đọc PINHOLE stream (fallback cuối)
                                { label: 'Extension chrome.downloads', fn: () => this.downloadViaExtension(mediaName4dl, videoFilePath) },
                                // 5. Fallback 720p — tải video 720p gốc khi mọi cách đều thất bại
                                { label: 'fallback 720p', fn: async () => {
                                    if (!isUpsampled || !origMediaName) throw new Error('not upsampled, no 720p fallback');
                                    sendLog(`[JOBID:${task.id}] ⚠️ Không tải được 1080p — tải 720p thay thế...`, 'info');
                                    const u720 = await this.resolveMediaViaExtension(origMediaName);
                                    return this.downloadMedia(u720, videoFilePath, false);
                                }},
                            ];

                            for (let si = 0; si < dlStrategies.length && !dlDone; si++) {
                                const { label, silent, fn } = dlStrategies[si];
                                try {
                                    await fn();
                                    dlDone = true;
                                } catch (e) {
                                    const shortMsg = (e.message || '').slice(0, 80);
                                    if (si < dlStrategies.length - 1) {
                                        // Chỉ log lỗi nếu strategy không phải "silent" (ngầm)
                                        if (!silent) {
                                            sendLog(`[JOBID:${task.id}] ⚠️ [${label}] thất bại: ${shortMsg}`, 'info');
                                        }
                                    } else {
                                        throw new Error(`Không tải được video 1080p: ${shortMsg}`);
                                    }
                                }
                            }

                            sendLog(`[JOBID:${task.id}] Lưu thành công: ${videoFileName}`, 'success');
                            sendLog(`[JOBID:${task.id}]|PATH:${videoFilePath}`, 'job_success');
                            results.push({ id: task.id, prompt: task.prompt, filePath: videoFilePath });
                        }
                    }

                } catch (error) {
                    const rawMsg = error.message || '';
                    let friendlyMsg = rawMsg;
                    // Bắt lỗi CAE (Content Advisory Error) — Veo từ chối nội dung
                    try {
                        const parsed = typeof rawMsg === 'string' && rawMsg.includes('workflowStepId') ? JSON.parse(rawMsg) : null;
                        if (parsed?.workflowStepId === 'CAE') {
                            friendlyMsg = '⚠️ Veo từ chối nội dung (CAE) — ảnh hoặc prompt vi phạm chính sách. Bỏ qua nhóm này.';
                        } else if (parsed?.workflowStepId) {
                            friendlyMsg = `⚠️ Veo báo lỗi nội dung [${parsed.workflowStepId}] — bỏ qua nhóm này.`;
                        }
                    } catch (_) {}
                    if (!friendlyMsg || friendlyMsg === rawMsg) {
                        if (/401|403|unauthorized|forbidden/i.test(rawMsg)) friendlyMsg = '🔒 Token hết hạn hoặc không có quyền — cần F5 Google Labs.';
                        else if (/timeout|ETIMEDOUT/i.test(rawMsg)) friendlyMsg = '⏱️ Quá thời gian chờ — mạng chậm hoặc Veo bận.';
                        else if (/policy|safety/i.test(rawMsg)) friendlyMsg = '⚠️ Vi phạm chính sách nội dung — bỏ qua nhóm này.';
                        else friendlyMsg = rawMsg.slice(0, 120);
                    }
                    sendLog(`[JOBID:${task.id}] ❌ ${friendlyMsg}`, 'error');
                    sendLog(`[JOBID:${task.id}]`, 'job_fail');
                    results.push({ id: task.id, prompt: task.prompt, isError: true, error: rawMsg });
                }
            };

            // Fail tất cả task chưa dispatch (khi bị pause) → event job_fail đến renderer → waitAllDone resolve
            const failRemaining = (fromIndex) => {
                for (let j = fromIndex; j < tasks.length; j++) {
                    const t = tasks[j];
                    sendLog(`[JOBID:${t.id}] ⏸ Tạm dừng`, 'error');
                    sendLog(`[JOBID:${t.id}]`, 'job_fail');
                    results.push({ id: t.id, isError: true, error: 'paused' });
                }
            };

            const executeWorkers = async () => {
                // 8 workers song song cho cả ảnh lẫn video
                const workers = [];
                for (let i = 0; i < tasks.length; i++) {
                    // Nếu đang bị pause → fail toàn bộ task còn lại và thoát ngay
                    if (VeoEngine._paused) { failRemaining(i); break; }

                    // Chờ slot trống, kiểm tra pause mỗi 500ms
                    while (activeJobs >= MAX_WORKERS) {
                        if (VeoEngine._paused) { failRemaining(i); return Promise.all(workers); }
                        await new Promise(r => setTimeout(r, 500));
                    }
                    if (VeoEngine._paused) { failRemaining(i); break; }

                    activeJobs++;
                    if (i > 0) await new Promise(r => setTimeout(r, 1500));
                    const w = processTask(tasks[i]).finally(() => { activeJobs--; });
                    workers.push(w);
                }
                await Promise.all(workers);
            };

            await executeWorkers();
            return { success: true, files: results };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = { VeoEngine };