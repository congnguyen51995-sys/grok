const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const { net } = require('electron');

// Mutex để serialize các Extension upload — kênh pendingImageUpload/uploadedMediaId
let _extensionUploadLock = Promise.resolve();
// Mutex để serialize Extension API calls (video gen) — kênh pendingVideoGen/videoGenResult
let _extensionApiLock = Promise.resolve();
// Mutex để serialize recaptcha acquisition (global.googleLabsAuth.recaptchaToken là shared state)
let _recaptchaLock = Promise.resolve();
// Mutex để serialize resolveMediaViaExtension — kênh resolveMediaRequest/resolvedMediaUrl
let _resolveMediaLock = Promise.resolve();

class VeoEngine {

    static async checkCookie() {
        try {
            const TIMEOUT = 15000;
            const INTERVAL = 500;
            const start = Date.now();
            while (Date.now() - start < TIMEOUT) {
                const auth = global.googleLabsAuth;
                if (auth && auth.bearerToken && auth.cookie) {
                    return { success: true, credits: "API Mode (Sẵn sàng)" };
                }
                await new Promise(r => setTimeout(r, INTERVAL));
            }
            return { success: false, error: "Chưa có Token. Hãy F5 trang Google Labs để Extension bắt dữ liệu!" };
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

        const options = { method, headers };
        if (body) options.body = typeof body === 'string' ? body : JSON.stringify(body);

        const response = await net.fetch(url, options);
        if (!response.ok) {
            const errText = await response.text();
            if (response.status === 403 && errText.includes("reCAPTCHA")) {
                throw new Error("Mã bảo vệ hết hạn. Mẹo: Hãy ra trình duyệt F5 lại tab Google Labs và bấm Tạo Ảnh ngay!");
            }
            throw new Error(`API Error ${response.status}: ${errText.substring(0, 100)}`);
        }
        return await response.json();
    }

    // Serialize recaptcha acquisition qua mutex — tránh race condition khi nhiều job chạy song song
    static acquireRecaptcha(action, jobId, sendLog) {
        return new Promise((resolve, reject) => {
            _recaptchaLock = _recaptchaLock.then(async () => {
                try {
                    if (sendLog) sendLog(`[JOBID:${jobId}] Đang lấy mã bảo mật ReCaptcha...`, 'info');
                    global.googleLabsAuth.recaptchaAction = action;
                    global.googleLabsAuth.recaptchaToken = null;
                    global.googleLabsAuth.needRecaptcha = true;
                    let wait = 0;
                    while (!global.googleLabsAuth.recaptchaToken && wait < 15) {
                        await new Promise(r => setTimeout(r, 1000));
                        wait++;
                    }
                    const token = global.googleLabsAuth.recaptchaToken;
                    if (!token) {
                        const err = new Error("Lấy mã ReCaptcha thất bại. Hãy F5 trang Google Labs.");
                        reject(err);
                        throw err;
                    }
                    resolve(token);
                } catch (e) {
                    reject(e);
                    throw e; // re-throw để chain tiếp theo vẫn chạy được
                }
            }).catch(() => {}); // absorb để không block lock với unhandled rejection
        });
    }

    static mapModelName(modelName) {
        const map = {
            'Nano Banana Pro': 'GEM_PIX_2',
            'Nano Banana 2': 'NARWHAL',
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
        const outputCount = parseInt(genCount?.replace(/x/ig, '')) || 1;
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
                "batchId": crypto.randomUUID()
            },
            "requests": requests,
            "useNewMedia": true
        };
    }

    static mapAspectRatioForVideo(aspectRatio) {
        const map = {
            '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
            '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
            '1:1':  'VIDEO_ASPECT_RATIO_SQUARE',
        };
        return map[aspectRatio] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    }

    static mapVideoModelKeyR2V(modelName) {
        const tierMap = {
            'Veo 3.1 - Lite (Fast)':            'lite',
            'Veo 3.1 - Fast (Balanced)':         'fast',
            'Veo 3.1 - Quality (High)':          'quality',
            'Veo 3.1 - Lite [Lower Priority]':   'lite',
            'Veo 3.1 - Fast [Lower Priority]':   'fast',
        };
        const tier = tierMap[modelName] || 'lite';
        const isLowPriority = modelName.includes('[Lower Priority]');
        return `veo_3_1_r2v_${tier}_${isLowPriority ? 'low_priority' : 'relaxed'}`;
    }

    static generateIngredientsPayload(prompt, aspectRatio, model, projectId, recaptchaToken, ingredientMediaIds) {
        const sessionId = `;${Date.now()}`;
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
            "requests": [{
                "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
                "textInput": {
                    "structuredPrompt": {
                        "parts": [{ "text": prompt }]
                    }
                },
                "videoModelKey": this.mapVideoModelKeyR2V(model),
                "metadata": {},
                "seed": Math.floor(Math.random() * 99999),
                "referenceImages": ingredientMediaIds.map(id => ({
                    "mediaId": id,
                    "imageUsageType": "IMAGE_USAGE_TYPE_ASSET"
                }))
            }],
            "useV2ModelConfig": true
        };
    }

    // videoModelKey mã hoá tier + duration + quality
    // ultra_relaxed = 1080p (không có duration cố định)
    // {dur}s_relaxed  = 720p với duration cụ thể (4s / 6s / 8s)
    static mapVideoModelKey(modelName, duration, isI2V = false, hasEndImage = false, quality = '720p') {
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
            if (hasEndImage) {
                // fl (start+end): 1080p → fl_ultra_*, 720p → {dur}s_fl_*
                if (is1080p) return `veo_3_1_i2v_s_${tier}_fl_ultra_${prio}`;
                const dur = (duration || '4s').replace(/[^0-9]/g, '') || '4';
                return `veo_3_1_i2v_s_${tier}_${dur}s_fl_${prio}`;
            }
            // Start only: 1080p → ultra_*, 720p → {dur}s_*
            if (is1080p) return `veo_3_1_i2v_s_${tier}_ultra_${prio}`;
            const dur = (duration || '4s').replace(/[^0-9]/g, '') || '4';
            return `veo_3_1_i2v_s_${tier}_${dur}s_${prio}`;
        }

        // T2V
        if (is1080p) return `veo_3_1_t2v_${tier}_ultra_${prio}`;
        const dur = (duration || '4s').replace(/[^0-9]/g, '') || '4';
        return `veo_3_1_t2v_${tier}_${dur}s_${prio}`;
    }

    static generateVideoPayload(prompt, aspectRatio, model, duration, projectId, recaptchaToken, startImageId, endImageId, quality = '720p') {
        const sessionId = `;${Date.now()}`;
        const isI2V = !!startImageId;
        const hasEndImage = !!endImageId;
        const request = {
            "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
            "seed": Math.floor(Math.random() * 99999),
            "textInput": {
                "structuredPrompt": {
                    "parts": [{ "text": prompt }]
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

    // Upload ảnh qua Chrome Extension (MAIN world) để có đầy đủ session googleapis.com
    static uploadImageViaExtension(imgPath, sendLog, taskId, frameName) {
        if (!imgPath || !fs.existsSync(imgPath)) return Promise.resolve(null);
        // Serialize qua _extensionUploadLock — kênh pendingImageUpload/uploadedMediaId chỉ xử lý 1 upload tại 1 lúc
        return new Promise((resolve) => {
            _extensionUploadLock = _extensionUploadLock.then(async () => {
                sendLog(`[JOBID:${taskId}] Đang upload ${frameName} qua Extension (MAIN world)...`, 'info');
                global.googleLabsAuth.pendingImageUpload = imgPath;
                global.googleLabsAuth.uploadedMediaId = null;

                let waited = 0;
                while (!global.googleLabsAuth.uploadedMediaId && waited < 30) {
                    await new Promise(r => setTimeout(r, 1000));
                    waited++;
                }

                const mediaId = global.googleLabsAuth.uploadedMediaId;
                global.googleLabsAuth.pendingImageUpload = null;
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
                global.googleLabsAuth.pendingVideoGen = {
                    url: apiUrl,
                    payload: payload,
                    bearerToken: global.googleLabsAuth.bearerToken
                };
                global.googleLabsAuth.videoGenResult = null;

                let waited = 0;
                while (!global.googleLabsAuth.videoGenResult && waited < timeoutSec) {
                    await new Promise(r => setTimeout(r, 1000));
                    waited++;
                }

                const result = global.googleLabsAuth.videoGenResult;
                global.googleLabsAuth.pendingVideoGen = null;
                global.googleLabsAuth.videoGenResult = null;

                if (!result) {
                    sendLog(`[JOBID:${taskId}] ⚠️ Extension ${label} timeout sau ${waited}s`, 'error');
                    resolve(null); return;
                }
                if (result.error) {
                    sendLog(`[JOBID:${taskId}] ❌ Extension ${label} lỗi: ${result.error}`, 'error');
                    resolve(null); return;
                }
                resolve(result.data);
            }).catch(() => resolve(null));
        });
    }

    // Gọi video gen API qua Chrome Extension (MAIN world) — cùng session với upload, tránh "Media not found"
    static async generateVideoViaExtension(apiUrl, payload, sendLog, taskId) {
        sendLog(`[JOBID:${taskId}] Gửi lệnh Render Video qua Extension (MAIN world)...`, 'info');
        // Timeout 90s — Google API đôi khi phản hồi chậm (30–60s), cần đủ thời gian
        const data = await this.callApiViaExtension(apiUrl, payload, sendLog, taskId, 'VideoGen', 90);
        if (data) sendLog(`[JOBID:${taskId}] ✅ Video gen via Extension OK`, 'success');
        return data;
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

            const response = await net.fetch('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', {
                method: 'POST',
                headers: {
                    'authorization': `Bearer ${auth.bearerToken}`,
                    'cookie': auth.cookie,
                    'content-type': 'application/json',
                    'origin': 'https://labs.google',
                    'referer': 'https://labs.google/'
                },
                body
            });

            if (!response.ok) {
                const errText = await response.text();
                sendLog(`[JOBID:${taskId}] Lỗi upload ảnh tham chiếu (${response.status}): ${errText.substring(0, 150)}`, 'error');
                return null;
            }

            const data = await response.json();
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

    static async uploadImageAPI(imgPath, sendLog, taskId, frameName) {
        if (!imgPath || !fs.existsSync(imgPath)) return null;
        sendLog(`[JOBID:${taskId}] Đang upload ${frameName} frame...`, 'info');

        try {
            const auth = global.googleLabsAuth;
            const fileData = fs.readFileSync(imgPath);
            const base64Image = fileData.toString('base64');

            const body = JSON.stringify({
                "clientContext": {
                    "projectId": auth.projectId,
                    "tool": "PINHOLE"
                },
                "imageBytes": base64Image
            });

            const response = await net.fetch('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', {
                method: 'POST',
                headers: {
                    'authorization': `Bearer ${auth.bearerToken}`,
                    'cookie': auth.cookie,
                    'content-type': 'application/json',
                    'origin': 'https://labs.google',
                    'referer': 'https://labs.google/'
                },
                body
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
            }

            const data = await response.json();

            // Response: {"media": {"name": "<uuid>", "projectId": "...", ...}}
            const imageId = data?.media?.name || data?.name || data?.imageId || data?.id;
            if (!imageId) throw new Error(`Không lấy được ID từ response: ${JSON.stringify(data).substring(0, 150)}`);

            // Xác nhận projectId trong response khớp với auth.projectId
            const responseProjectId = data?.media?.projectId;
            if (responseProjectId && responseProjectId !== auth.projectId) {
                sendLog(`[JOBID:${taskId}] ⚠️ ProjectId mismatch! upload:${responseProjectId} vs auth:${auth.projectId}`, 'error');
            }

            sendLog(`[JOBID:${taskId}] ✅ Upload ${frameName} OK`, 'success');
            return imageId;
        } catch (error) {
            sendLog(`[JOBID:${taskId}] Lỗi Upload ${frameName}: ${error.message}`, 'error');
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

    static async downloadMedia(url, destPath, useAuth = false) {
        if (!url || typeof url !== 'string') throw new Error(`URL không hợp lệ: ${url}`);
        const auth = global.googleLabsAuth;
        const options = { redirect: 'follow' };
        if (useAuth && !url.includes('storage.googleapis.com') && !url.includes('lh3.googleusercontent.com')) {
            options.headers = {
                'authorization': `Bearer ${auth.bearerToken}`,
                'cookie': auth.cookie,
                'origin': 'https://labs.google',
                'referer': 'https://labs.google/',
                'user-agent': auth.userAgent || ''
            };
        }
        const response = await net.fetch(url, options);
        if (!response.ok) throw new Error(`Lỗi tải file, Status: ${response.status}`);

        // Xác định đúng extension từ Content-Type
        const contentType = response.headers.get('content-type') || '';
        let finalPath = destPath;
        if (contentType.includes('image/webp') && !destPath.endsWith('.webp')) {
            finalPath = destPath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        } else if (contentType.includes('image/jpeg') && !destPath.endsWith('.jpg')) {
            finalPath = destPath.replace(/\.(png|webp)$/i, '.jpg');
        }

        const stream = require('stream');
        const fileStream = fs.createWriteStream(finalPath);
        await pipeline(stream.Readable.fromWeb(response.body), fileStream);

        // Kiểm tra file hợp lệ (> 1KB, không phải HTML error page)
        const fileSize = fs.statSync(finalPath).size;
        if (fileSize < 1000) {
            fs.unlinkSync(finalPath);
            throw new Error(`Response không hợp lệ (${fileSize} bytes)`);
        }

        // Trả về path thực tế (có thể khác destPath nếu đổi extension)
        return finalPath;
    }

    static async run(jobData, sendLog) {
        const { mediaType, tasks, aspectRatio, model, genCount, quality = '1K', outputFolder, duration } = jobData;
        let results = [];

        try {
            if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });
            const check = await this.checkCookie();
            if (!check.success) throw new Error(check.error);

            sendLog(`Khởi động động cơ API...`, 'info');

            const MAX_WORKERS = 5;
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

            const processTask = async (task) => {
                sendLog(`[JOBID:${task.id}]`, 'job_start');
                
                try {
                    const auth = global.googleLabsAuth;

                    if (mediaType === 'Image') {
                        if (!auth.projectId) {
                            throw new Error("Chưa nhận được mã Workspace ID. Hãy F5 tab Google Labs để Extension quét lại!");
                        }

                        const imgRecaptchaToken = await VeoEngine.acquireRecaptcha('IMAGE_GENERATION', task.id, sendLog);

                        // Upload ảnh tham chiếu (nếu có)
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

                        sendLog(`[JOBID:${task.id}] Bắn lệnh tạo ảnh lên AI Sandbox...`, 'info');

                        const imageApiUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia:batchGenerateImages`;
                        const payload = this.generateImagePayload(task.prompt, aspectRatio, genCount, auth.projectId, imgRecaptchaToken, model, referenceImageIds);
                        const genRes = await this.fetchAPI(imageApiUrl, 'POST', payload);

                        // Thử nhiều cấu trúc response khác nhau từ API
                        let generatedMedia = genRes.generatedMedia;

                        if (!generatedMedia || generatedMedia.length === 0) {
                            if (Array.isArray(genRes.responses)) {
                                generatedMedia = genRes.responses.flatMap(r => r.generatedMedia || []);
                            }
                        }
                        if (!generatedMedia || generatedMedia.length === 0) {
                            generatedMedia = genRes.mediaGenerationResult?.generatedMedia || [];
                        }
                        if (!generatedMedia || generatedMedia.length === 0) {
                            generatedMedia = genRes.images || genRes.media || genRes.results || [];
                        }

                        if (!generatedMedia || generatedMedia.length === 0) {
                            if (genRes.error) throw new Error(genRes.error.message || "Bị từ chối do vi phạm chính sách");
                            throw new Error(`API không trả về ảnh. Response keys: [${Object.keys(genRes).join(', ')}]`);
                        }

                        sendLog(`[JOBID:${task.id}] Nhận thành công ${generatedMedia.length} ảnh, đang tải về...`, 'progress');

                        const downloadedFiles = [];
                        const mediaGenerationIds = []; // Thu thập UUID gốc để dùng trực tiếp làm Ingredients
                        for (let i = 0; i < generatedMedia.length; i++) {
                            const imgData = generatedMedia[i];
                            const suffix = generatedMedia.length > 1 ? `_${i + 1}` : '';
                            const fileName = `image_${getSeqNum(task)}${suffix}.png`;
                            const filePath = path.join(outputFolder, fileName);

                            const causToken = imgData.image?.generatedImage?.mediaGenerationId;
                            const mediaName = imgData.name;
                            if (causToken) mediaGenerationIds.push(causToken);

                            // Quét toàn bộ imgData để tìm URL ẩn
                            const scannedUrls = this.findUrlsInObject(imgData);

                            // Danh sách URL thử theo thứ tự ưu tiên
                            const attempts = [];
                            // URL được quét từ response (ưu tiên cao nhất)
                            scannedUrls.forEach(u => attempts.push({ url: u, auth: u.includes('googleapis.com') }));
                            // lh3 serving với =s0 (đã hoạt động trước đó)
                            if (causToken) {
                                attempts.push({ url: `https://lh3.googleusercontent.com/ais-proxy/${causToken}=s0`, auth: false });
                            }
                            if (mediaName) {
                                attempts.push({ url: `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia/${mediaName}?alt=media`, auth: true });
                            }
                            if (causToken) {
                                attempts.push({ url: `https://aisandbox-pa.googleapis.com/v1/flowMedia/${causToken}:download`, auth: true });
                            }

                            let downloaded = false;
                            for (const attempt of attempts) {
                                try {
                                    const savedPath = await this.downloadMedia(attempt.url, filePath, attempt.auth);
                                    // downloadMedia trả về path thực tế (có thể đổi extension WebP/JPG)
                                    const actualFileName = path.basename(savedPath);
                                    downloadedFiles.push(actualFileName);
                                    downloaded = true;
                                    break;
                                } catch (_) {}
                            }

                            if (!downloaded) {
                                sendLog(`[JOBID:${task.id}] Không tải được ảnh [${i}] — bỏ qua.`, 'info');
                            }
                        }

                        if (downloadedFiles.length === 0) throw new Error("Không tải được ảnh nào từ server. Thử lại hoặc đổi model.");

                        sendLog(`[JOBID:${task.id}] Lưu thành công: ${downloadedFiles.join(', ')}`, 'success');
                        sendLog(`[JOBID:${task.id}]`, 'job_success');
                        results.push({ id: task.id, prompt: task.prompt, filePath: path.join(outputFolder, downloadedFiles[0]), mediaId: mediaGenerationIds[0] || null });

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

                            if (task.ingredientMediaIds && task.ingredientMediaIds.length > 0) {
                                // UUID từ batchGenerateImages (Electron) — gọi Ingredients gen trực tiếp qua Electron
                                // Không cần Extension vì UUID đã thuộc project, auth token hợp lệ là đủ
                                ingredientMediaIds = task.ingredientMediaIds;
                                sendLog(`[JOBID:${task.id}] Dùng ${ingredientMediaIds.length} ảnh DNA từ project (UUID sẵn có)...`, 'info');
                                const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                const ingredPayload = this.generateIngredientsPayload(task.prompt, aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds);
                                sendLog(`[JOBID:${task.id}] Gửi lệnh Ingredients Video qua API...`, 'info');
                                genRes = await this.fetchAPI(INGRED_URL, 'POST', ingredPayload);
                                if (!genRes) throw new Error('Ingredients gen thất bại');
                                sendLog(`[JOBID:${task.id}] ✅ Ingredients gen API OK`, 'success');
                            } else {
                                // Upload ảnh local qua Extension rồi gen qua Extension (cùng Chrome session)
                                sendLog(`[JOBID:${task.id}] Uploading ${task.ingredientImages.length} Ingredient image(s)...`, 'info');
                                for (let iIdx = 0; iIdx < task.ingredientImages.length; iIdx++) {
                                    const mediaId = await this.uploadImageViaExtension(task.ingredientImages[iIdx], sendLog, task.id, `Ingredient ${iIdx + 1}`);
                                    if (mediaId) ingredientMediaIds.push(mediaId);
                                }
                                if (ingredientMediaIds.length === 0) throw new Error("Không có ảnh Ingredient hợp lệ.");
                                const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                const ingredPayload = this.generateIngredientsPayload(task.prompt, aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds);
                                // Gọi qua Extension MAIN world (cùng session với upload) — tránh Media not found
                                genRes = await this.generateVideoViaExtension(INGRED_URL, ingredPayload, sendLog, task.id);
                                if (!genRes) throw new Error('Extension Ingredients gen thất bại');
                            }
                        } else {
                            // === T2V / I2V FLOW ===
                            if (task.startImage) {
                                startImageId = await this.uploadImageViaExtension(task.startImage, sendLog, task.id, 'Start');
                            }
                            if (task.endImage) {
                                endImageId = await this.uploadImageViaExtension(task.endImage, sendLog, task.id, 'End');
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
                                // I2V: lấy recaptcha 1 lần rồi gọi qua Extension MAIN world (cùng session với upload)
                                const videoRecaptchaToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                const videoPayload = this.generateVideoPayload(task.prompt, aspectRatio, model, duration, auth.projectId, videoRecaptchaToken, startImageId, endImageId, quality);
                                genRes = await this.generateVideoViaExtension(VIDEO_GEN_URL, videoPayload, sendLog, task.id);
                                if (!genRes) throw new Error('Extension video gen thất bại');
                            } else {
                                // T2V: lấy recaptcha MỚI trước mỗi lần thử (tránh token hết hạn khi server chậm)
                                sendLog(`[JOBID:${task.id}] Gửi lệnh Render Video API...`, 'info');
                                let t2vRetry = 0;
                                while (t2vRetry < 3) {
                                    try {
                                        const freshToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                        const freshPayload = this.generateVideoPayload(task.prompt, aspectRatio, model, duration, auth.projectId, freshToken, startImageId, endImageId, quality);
                                        genRes = await this.fetchAPI(VIDEO_GEN_URL, 'POST', freshPayload);
                                        break;
                                    } catch (e) {
                                        const msg = e.message || '';
                                        if ((msg.includes('500') || msg.includes('503')) && t2vRetry < 2) {
                                            t2vRetry++;
                                            sendLog(`[JOBID:${task.id}] ⚠️ Server lỗi, thử lại ${t2vRetry}/2 (lấy mã mới)...`, 'info');
                                            await new Promise(r => setTimeout(r, 5000));
                                        } else { throw e; }
                                    }
                                }
                            }
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
                                sendLog(`[JOBID:${task.id}]`, 'job_success');
                                results.push({ id: task.id, prompt: task.prompt, filePath: vfp });
                                videoSaved = true;
                            }
                        }

                        if (!videoSaved) {
                            if (!generationIds && !operationName) {
                                throw new Error("Không nhận được Generation ID từ server.");
                            }

                            sendLog(`[JOBID:${task.id}] Đang Render Video trên server...`, 'info');

                            let mediaUrl = null; let isDone = false; let pollCount = 0;
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
                                    // Lấy URL qua tRPC endpoint getMediaUrlRedirect (307 redirect → actual URL)
                                    const mediaName = firstItem.name || generationIds[0];
                                    mediaUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
                                    isDone = true;
                                } else if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
                                    const errMsg = firstItem.error?.message || firstItem.errorMessage
                                        || firstItem.mediaMetadata?.mediaStatus?.errorMessage
                                        || firstItem.mediaMetadata?.errorMessage
                                        || JSON.stringify(firstItem).substring(0, 200)
                                        || "Server từ chối render.";
                                    throw new Error(errMsg);
                                } else {
                                    const pct = firstItem.progressPercent || firstItem.progress || Math.floor((pollCount / 36) * 100);
                                    sendLog(`[JOBID:${task.id}] ${Math.min(pct, 99)}% (${st || 'PENDING'})`, 'progress');
                                }
                            }

                            if (!mediaUrl) throw new Error("Không lấy được URL video sau khi render xong.");

                            // Lấy signed URL qua Extension MAIN world (Chrome có đầy đủ cookie/session)
                            // Extension fetch labs.google → follow 307 → trả về URL thực trên flow-content.google
                            sendLog(`[JOBID:${task.id}] 100% - Đang lấy link tải Video qua Extension...`, 'progress');
                            const mediaName4dl = mediaUrl.split('?name=')[1] || generationIds?.[0] || '';
                            const resolvedUrl = await this.resolveMediaViaExtension(mediaName4dl);
                            sendLog(`[JOBID:${task.id}] Đang tải Video...`, 'info');
                            const videoFileName = `video_${getSeqNum(task)}.mp4`;
                            const videoFilePath = path.join(outputFolder, videoFileName);
                            await this.downloadMedia(resolvedUrl, videoFilePath, false);
                            sendLog(`[JOBID:${task.id}] Lưu thành công: ${videoFileName}`, 'success');
                            sendLog(`[JOBID:${task.id}]`, 'job_success');
                            results.push({ id: task.id, prompt: task.prompt, filePath: videoFilePath });
                        }
                    }

                } catch (error) {
                    sendLog(`[JOBID:${task.id}] Lỗi: ${error.message}`, 'error');
                    sendLog(`[JOBID:${task.id}]`, 'job_fail');
                    results.push({ id: task.id, prompt: task.prompt, isError: true });
                }
            };

            const executeWorkers = async () => {
                const workers = [];
                for (let task of tasks) {
                    while (activeJobs >= MAX_WORKERS) await new Promise(r => setTimeout(r, 1000));
                    activeJobs++;
                    await new Promise(r => setTimeout(r, 3000)); 
                    const worker = processTask(task).finally(() => { activeJobs--; });
                    workers.push(worker);
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