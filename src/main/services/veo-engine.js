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


// Mutex để serialize recaptcha acquisition (global.googleLabsAuth.recaptchaToken là shared state)
let _recaptchaLock = Promise.resolve();

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
        // Extension đã download qua chrome.downloads → copy vào outputFolder rồi xóa file temp
        if (url.startsWith('file://')) {
            const localPath = url.replace(/^file:\/\//i, '');
            console.log(`[downloadMedia] file:// → copy from ${localPath} → ${destPath}`);
            const fs = require('fs');
            fs.copyFileSync(localPath, destPath);
            try { fs.unlinkSync(localPath); } catch (_) {} // xóa file temp trong Chrome Downloads
            return;
        }
        const auth = global.googleLabsAuth;
        const options = { redirect: 'follow' };

        const isGCSUrl = url.includes('storage.googleapis.com') || url.includes('lh3.googleusercontent.com');
        const isLabsUrl = url.includes('labs.google');
        const isFlowContent = url.includes('flow-content.google');
        const isGooglevideo = url.includes('googlevideo.com/videoplayback');

        if (isGooglevideo) {
            // Self-authenticated URL (expire/ei/ip params baked in) — chỉ cần User-Agent thông thường
            options.headers = {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
                'referer': 'https://flow.google.com/',
            };
        } else if (isFlowContent) {
            // URL ?alt=media không có Expires/X-Goog-Signature → cần cookies .google TLD (Chrome không gửi từ Node.js)
            // Thử aisandbox Bearer-token URL trước — đáng tin cậy hơn từ Node.js
            const isUnsignedAltMedia = url.includes('?alt=media') && !url.includes('Expires=') && !url.includes('X-Goog-Signature');
            if (isUnsignedAltMedia && auth?.bearerToken && auth?.projectId) {
                const midM = url.match(/\/video\/([0-9a-f-]{8,})/);
                if (midM) {
                    const aisUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia/${midM[1]}?alt=media`;
                    console.log(`[downloadMedia] unsigned alt=media → try aisandbox: ${aisUrl.substring(0, 80)}`);
                    try {
                        return await VeoEngine.downloadMedia(aisUrl, destPath, true);
                    } catch(e2) {
                        console.log(`[downloadMedia] aisandbox failed (${e2.message}), fallback cookies...`);
                    }
                }
            }
            // flow-content.google signed URL hoặc fallback cookie
            const fcCookie = auth?.flowContentCookie || auth?.cookie || '';
            const hasCookie = !!fcCookie;
            console.log(`[downloadMedia] flow-content.google — fcCookie=${!!(auth?.flowContentCookie)} flow_cookie=${!!(auth?.cookie)} len=${fcCookie.length}`);
            options.headers = {
                'user-agent': auth?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'referer': 'https://flow.google.com/',
                'origin': 'https://flow.google.com',
                ...(hasCookie ? { 'cookie': fcCookie } : {})
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
