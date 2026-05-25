const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const https = require('https');

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

        const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr).toString();

        // Dùng Node.js https thuần — tránh net::ERR_FAILED từ Electron/Chromium net stack
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const reqOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers,
            };
            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); } catch { resolve(data); }
                    } else {
                        if (res.statusCode === 403 && data.includes('reCAPTCHA')) {
                            const e = new Error('RECAPTCHA_EXPIRED');
                            e.isRecaptchaExpired = true;
                            return reject(e);
                        }
                        reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 100)}`));
                    }
                });
            });
            req.on('error', (e) => reject(new Error(`Node.js fetch error: ${e.message}`)));
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
                    // Jitter ngẫu nhiên 2–5s sau khi nhận token, trước khi release lock
                    // → mỗi lệnh API cách nhau ít nhất 2s, tối đa 5s, không đều đặn
                    await VeoEngine.randDelay(2000, 5000);
                    resolve(token);
                } catch (e) {
                    reject(e);
                    throw e; // re-throw để chain tiếp theo vẫn chạy được
                }
            }).catch(() => {}); // absorb để không block lock với unhandled rejection
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

    static mapVideoModelKeyR2V(modelName, duration) {
        // Omni Flash dùng prefix "abra" — r2v có duration suffix
        if (modelName === 'Omni Flash') {
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
        // R2V (Ingredients) endpoint chỉ hỗ trợ 1 tier quality — không có ultra/1080p
        return `veo_3_1_r2v_${tier}_${isLowPriority ? 'low_priority' : 'relaxed'}`;
    }

    static generateIngredientsPayload(prompt, aspectRatio, model, projectId, recaptchaToken, ingredientMediaIds, voiceId = null, duration = '8s') {
        const sessionId = `;${Date.now()}`;
        const req = {
            "aspectRatio": this.mapAspectRatioForVideo(aspectRatio),
            "textInput": {
                "structuredPrompt": {
                    "parts": [{ "text": prompt }]
                }
            },
            "videoModelKey": this.mapVideoModelKeyR2V(model, duration),
            "metadata": {},
            "seed": Math.floor(Math.random() * 99999),
            "referenceImages": ingredientMediaIds.map(id => ({
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
        if (modelName === 'Omni Flash') {
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

        // T2V — 8s là model mặc định (không có duration suffix); 4s/6s có suffix
        // 1080p KHÔNG dùng key 'ultra' — dùng key 720p thường, upsample code sẽ xử lý 1080p sau
        const dur = (duration || '8s').replace(/[^0-9]/g, '') || '8';
        if (dur === '8') return `veo_3_1_t2v_${tier}_${prio}`;
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
            const MAX_WORKERS = 3;
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
                // Reset triggered flag TRƯỚC khi set pendingImageUpload — đảm bảo Extension nhận được lệnh mới
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

            const data = await this.fetchAPI('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', 'POST', body);

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

        // Dùng Node.js https.request — không follow redirect, đọc Location header trực tiếp
        const { location: locationHeader, status, body: bodyText } = await new Promise((resolve, reject) => {
            const parsedUrl = new URL(tRPCUrl);
            const reqOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers,
            };
            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve({
                    location: res.headers['location'] || null,
                    status: res.statusCode,
                    body: data
                }));
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

        if (useAuth && !isGCSUrl) {
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

        // Dùng Node.js https.request — tránh net::ERR_FAILED từ Electron net stack
        const { statusCode, contentType, resStream } = await new Promise((resolve, reject) => {
            const followRedirect = (reqUrl, depth = 0) => {
                if (depth > 5) return reject(new Error('Quá nhiều redirect'));
                const parsedUrl = new URL(reqUrl);
                const reqHeaders = options.headers || {};
                const reqOptions = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: reqHeaders,
                };
                const req = https.request(reqOptions, (res) => {
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

        // Xác định đúng extension từ Content-Type
        let finalPath = destPath;
        if (contentType.includes('image/webp') && !destPath.endsWith('.webp')) {
            finalPath = destPath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        } else if (contentType.includes('image/jpeg') && !destPath.endsWith('.jpg')) {
            finalPath = destPath.replace(/\.(png|webp)$/i, '.jpg');
        }

        const fileStream = fs.createWriteStream(finalPath);
        await pipeline(resStream, fileStream);

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

                        // Upload ảnh tham chiếu TRƯỚC — tránh token hết hạn trong lúc upload
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

                        // Lấy token SAU khi upload xong → bắn API ngay, token còn mới
                        // Tự động retry tối đa 3 lần nếu token hết hạn; nếu vẫn fail → auto F5 rồi retry thêm
                        const imageApiUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${auth.projectId}/flowMedia:batchGenerateImages`;
                        let genRes;
                        let imgAutoReloaded = false;
                        for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                            const imgRecaptchaToken = await VeoEngine.acquireRecaptcha('IMAGE_GENERATION', task.id, sendLog);
                            sendLog(`[JOBID:${task.id}] Bắn lệnh tạo ảnh lên AI Sandbox${tokenTry > 1 ? ` (lần ${tokenTry})` : ''}...`, 'info');
                            const payload = this.generateImagePayload(task.prompt, aspectRatio, genCount, auth.projectId, imgRecaptchaToken, model, referenceImageIds);
                            try {
                                genRes = await this.fetchAPI(imageApiUrl, 'POST', payload);
                                break; // thành công → thoát loop
                            } catch (e) {
                                if (e.isRecaptchaExpired && tokenTry < 3) {
                                    sendLog(`[JOBID:${task.id}] ⚠️ Token hết hạn, tự động lấy token mới (${tokenTry}/3)...`, 'info');
                                    await VeoEngine.randDelay(2000, 4000);
                                    continue;
                                }
                                if (e.isRecaptchaExpired && !imgAutoReloaded) {
                                    imgAutoReloaded = true;
                                    const ok = await this.reloadLabsAndWait(sendLog, task.id);
                                    if (ok) { tokenTry = 0; continue; } // reset → thử lại từ lần 1
                                }
                                if (e.isRecaptchaExpired) throw new Error("Token hết hạn — đã tự động F5 Google Labs nhưng vẫn lỗi. Vui lòng thử lại sau.");
                                throw e;
                            }
                        }

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
                        // DNA tham chiếu (task.id bắt đầu bằng dna_c) → tên TC_image_N để không trùng ảnh cảnh
                        const imgPrefix = String(task.id || '').startsWith('dna_c') ? 'TC_image' : 'image';
                        for (let i = 0; i < generatedMedia.length; i++) {
                            const imgData = generatedMedia[i];
                            const suffix = generatedMedia.length > 1 ? `_${i + 1}` : '';
                            const fileName = `${imgPrefix}_${getSeqNum(task)}${suffix}.png`;
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
                        const _imgFp = path.join(outputFolder, downloadedFiles[0]);
                        sendLog(`[JOBID:${task.id}]|PATH:${_imgFp}`, 'job_success');
                        results.push({ id: task.id, prompt: task.prompt, filePath: _imgFp, mediaId: mediaGenerationIds[0] || null });

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
                                if (task.voiceId) sendLog(`[JOBID:${task.id}] 🎙️ Giọng: ${task.voiceId}`, 'info');
                                let ingr1AutoReloaded = false;
                                for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                    const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                    const ingredPayload = this.generateIngredientsPayload(task.prompt, aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds, task.voiceId || null, duration);
                                    sendLog(`[JOBID:${task.id}] Gửi lệnh Ingredients Video qua API${tokenTry > 1 ? ` (lần ${tokenTry})` : ''}...`, 'info');
                                    try {
                                        genRes = await this.fetchAPI(INGRED_URL, 'POST', ingredPayload);
                                        if (!genRes) throw new Error('Ingredients gen thất bại');
                                        sendLog(`[JOBID:${task.id}] ✅ Ingredients gen API OK`, 'success');
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
                                    const mediaId = await this.uploadImageViaExtension(task.ingredientImages[iIdx], sendLog, task.id, `Ingredient ${iIdx + 1}`);
                                    if (mediaId) ingredientMediaIds.push(mediaId);
                                }
                                if (ingredientMediaIds.length === 0) throw new Error("Không có ảnh Ingredient hợp lệ.");
                                if (task.voiceId) sendLog(`[JOBID:${task.id}] 🎙️ Giọng: ${task.voiceId}`, 'info');
                                let ingr2AutoReloaded = false;
                                for (let tokenTry = 1; tokenTry <= 3; tokenTry++) {
                                    const ingredRecaptcha = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                    const ingredPayload = this.generateIngredientsPayload(task.prompt, aspectRatio, model, auth.projectId, ingredRecaptcha, ingredientMediaIds, task.voiceId || null, duration);
                                    try {
                                        // Gọi qua Extension MAIN world (cùng session với upload) — tránh Media not found
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
                                // I2V: gọi trực tiếp qua fetchAPI (Node.js https, cùng bearer token + cookie)
                                // Không qua Extension lock → nhiều task I2V chạy song song được
                                sendLog(`[JOBID:${task.id}] Gửi lệnh Render I2V API...`, 'info');
                                let i2vRetry = 0;
                                let i2vAutoReloaded = false;
                                while (i2vRetry < 3) {
                                    try {
                                        const videoRecaptchaToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                        const videoPayload = this.generateVideoPayload(task.prompt, aspectRatio, model, duration, auth.projectId, videoRecaptchaToken, startImageId, endImageId, quality);
                                        genRes = await this.fetchAPI(VIDEO_GEN_URL, 'POST', videoPayload);
                                        if (!genRes) throw new Error('I2V gen thất bại');
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
                                            await new Promise(r => setTimeout(r, 12000));
                                        } else { throw e; }
                                    }
                                }
                            } else {
                                // T2V: gọi qua Extension MAIN world (Chrome session đầy đủ) — tránh 500 do session validation
                                sendLog(`[JOBID:${task.id}] Gửi lệnh Render Video API...`, 'info');
                                let t2vRetry = 0;
                                let t2vAutoReloaded = false;
                                while (t2vRetry < 3) {
                                    try {
                                        const freshToken = await VeoEngine.acquireRecaptcha('VIDEO_GENERATION', task.id, sendLog);
                                        const freshPayload = this.generateVideoPayload(task.prompt, aspectRatio, model, duration, auth.projectId, freshToken, startImageId, endImageId, quality);
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
                    sendLog(`[JOBID:${task.id}] Lỗi: ${error.message}`, 'error');
                    sendLog(`[JOBID:${task.id}]`, 'job_fail');
                    results.push({ id: task.id, prompt: task.prompt, isError: true });
                }
            };

            const executeWorkers = async () => {
                const workers = [];
                for (let i = 0; i < tasks.length; i++) {
                    const task = tasks[i];
                    while (activeJobs >= MAX_WORKERS) await new Promise(r => setTimeout(r, 1000));
                    activeJobs++;
                    // Stagger ngẫu nhiên 8–18s giữa mỗi lần khởi động task
                    // Task đầu tiên không cần chờ; từ task thứ 2 trở đi mới delay
                    if (i > 0) await VeoEngine.randDelay(8000, 18000);
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