// ── SW LIFECYCLE: skipWaiting PHẢI nằm trong install event (không phải top-level) ──
// Calling at top-level runs AFTER the install event, so flag may not be set in time.
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// SW-PING DEBUG: gửi ngay khi SW bắt đầu để confirm SW đang load
fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: "SW_START_V2.2" })
}).catch(() => {});

// Dùng 127.0.0.1 thay localhost để tránh Chrome resolve sang ::1 (IPv6) trên Windows
const SERVER_API = "http://127.0.0.1:3000/update-token";
const CHECK_API = "http://127.0.0.1:3000/api/check-request";
const SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

console.log("🚀 Fluxy Extension V2.6 - Cookie + AT token (batchexecute) support");

// ══ webRequest: bắt URL video từ flow.google.com (đáng tin cậy hơn fetch interceptor) ══
// Lưu { url, ts } cho mọi request video file từ tab flow.google.com
let _capturedR2VUrls = [];

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Chỉ quan tâm request từ tab flow.google.com (initiator = trang gọi request)
        const isFlowTab = details.initiator?.includes('flow.google.com')
            || details.initiator?.includes('labs.google');
        if (!isFlowTab) return;

        const url = details.url;
        // Match: flow-content.google (video R2V/voice), storage.googleapis.com, .mp4, .m3u8
        const isVideoUrl = url.includes('flow-content.google/video/')
            || url.includes('flow-content.google/image/')
            || url.includes('storage.googleapis.com/ais-sandbox')
            || url.includes('storage.googleapis.com/ais-')
            || url.includes('/ais-proxy/')
            || url.includes('lh3.googleusercontent.com/ais')
            || (url.includes('googleusercontent.com') && /\.(mp4|m3u8|webm)/.test(url))
            || /\.mp4(\?|#|$)/.test(url)
            || /\.m3u8(\?|#|$)/.test(url)
            || /\.webm(\?|#|$)/.test(url);
        if (!isVideoUrl) return;

        if (!_capturedR2VUrls.some(c => c.url === url)) {
            _capturedR2VUrls.push({ url, ts: Date.now() });
            console.log('🎯 webRequest: video URL:', url.substring(0, 100));
            // Dọn cũ >30 phút
            const cutoff = Date.now() - 30 * 60 * 1000;
            _capturedR2VUrls = _capturedR2VUrls.filter(c => c.ts >= cutoff);
        }
    },
    { urls: ['<all_urls>'] }
);

let lastSentTime = 0;

function sendToServer(data) {
    fetch(SERVER_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    }).catch(() => {});
}

// Mồi nhử để Extension lấy token
function triggerAuthRequest() {
    fetch('https://labs.google/fx/api/trpc/videoFx.getUserSettings?input=%7B%22json%22%3Anull%7D').catch(() => {});
}

// Tìm tab labs.google hoặc flow.google.com (ưu tiên labs.google)
async function findActiveTab() {
    let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
    if (!tab) [tab] = await chrome.tabs.query({ url: "*://flow.google.com/*" });
    return tab || null;
}

// ══════════════════════════════════════════════════════════════════
// GROK.COM — Xử lý bởi Chrome ẩn riêng (grok-worker Extension)
// FluxyExtension chỉ xử lý Veo/Labs.google, không cần code Grok ở đây
// ══════════════════════════════════════════════════════════════════

// [Toàn bộ Grok gen code đã chuyển sang grok-worker/worker.js — chạy trong Chrome ẩn riêng]

// Lắng nghe lệnh từ Tool Node.js
setInterval(async () => {
    try {
        const res = await fetch(CHECK_API);
        const data = await res.json();

        if (data.reload) {
            let tab = await findActiveTab();
            if (tab) {
                console.log("🔄 Tool yêu cầu F5 làm mới dữ liệu...");
                chrome.tabs.reload(tab.id, {}, () => {
                    setTimeout(() => {
                        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: triggerAuthRequest });
                    }, 5000);
                });
            }
        }

        // needGrokGen: handled by hidden Chrome (grok-worker extension)

        if (data.needToken) {
            fetchRecaptcha(data.tokenAction || 'VIDEO_GENERATION');
        }

        if (data.resolveMediaUrl) {
            resolveMediaUrl(data.resolveMediaUrl);
        }

        if (data.needImageUpload) {
            uploadImageViaPage();
        }

        if (data.needVideoGen) {
            executeVideoGen();
        }

        if (data.needFlowImageGen) {
            executeFlowImageGen();
        }

        if (data.needFlowVideoGen) {
            executeFlowVideoGen();
        }

        if (data.needFlowR2VGen) {
            executeFlowR2VGen();
        }

        if (data.fetchUrl) {
            fetchUrlViaChrome(data.fetchUrl);
        }

        if (data.downloadVideo) {
            downloadVideoViaChrome(data.downloadVideo);
        }
    } catch (e) {}
}, 1000);

// TẠO ẢNH QUA FLOW.GOOGLE.COM BATCHEXECUTE (MAIN world — session đầy đủ)
let isGeneratingFlowImage = false;
async function executeFlowImageGen() {
    if (isGeneratingFlowImage) return;
    isGeneratingFlowImage = true;
    const SAVE_URL = 'http://127.0.0.1:3000/api/save-flow-image-result';
    try {
        let tab = await findActiveTab();
        if (!tab) {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_TAB' }) }).catch(() => {});
            return;
        }
        const dataRes = await fetch('http://127.0.0.1:3000/api/get-pending-flow-image');
        if (!dataRes.ok) { console.log('❌ Không lấy được flow image gen data'); return; }
        const genParams = await dataRes.json();
        if (!genParams || !genParams.prompt) { console.log('❌ Thiếu params flow image gen'); return; }

        console.log(`🎨 Flow image gen: "${genParams.prompt.substring(0, 40)}..." model=${genParams.model} aspectCode=${genParams.aspectCode}`);

        // Đọc AT tốt nhất từ sniffer (capture từ Angular's native batchexecute requests)
        const { lastGoodAt, lastGoodAtTs } = await chrome.storage.local.get(['lastGoodAt', 'lastGoodAtTs']);
        const snifferAt = (lastGoodAt && lastGoodAt.startsWith('AIQ-') && (Date.now() - (lastGoodAtTs || 0)) < 1800000) ? lastGoodAt : null;
        if (snifferAt) {
            console.log('[flow-img] Using sniffer AT (from Angular native call), len=', snifferAt.length, ' age=', Math.round((Date.now() - lastGoodAtTs) / 1000), 's');
            genParams.atToken = snifferAt;
        } else {
            console.log('[flow-img] No sniffer AT (Angular hasnt made any batchexecute call yet)');
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (p) => {
                try {
                    const SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
                    const BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
                    const projectId = p.projectId;

                    // Lấy bl/fsid từ page scripts; AT từ window._flowAuthData (live) hoặc page scripts
                    // ƯU TIÊN: p.bl/p.fsid từ FLOW_AUTH_FOUND (capture từ batchexecute thật) > page script extraction
                    let bl = '', fsid = '', pageAt = '';
                    {
                        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
                        // bl: ưu tiên p.bl từ FLOW_AUTH_FOUND (capture từ batchexecute thật)
                        // fallback sang page scripts nếu p.bl rỗng
                        if (p.bl && p.bl.startsWith('boq_')) {
                            bl = p.bl;
                        } else {
                            const m2 = scripts.match(/"bl"\s*:\s*"(boq_[^"]+)"|boq_[a-z0-9_-]+_\d{8}\.\d{2}[^"'\s]*/);
                            bl = m2 ? (m2[1] || m2[0]) : (p.bl || '');
                        }
                        // fsid: ưu tiên p.fsid từ FLOW_AUTH_FOUND
                        if (p.fsid && p.fsid.length > 3) {
                            fsid = p.fsid;
                        } else {
                            const m3 = scripts.match(/"FdrFJe"\s*:\s*"(-?\d+)"|"f\.sid"\s*:\s*"(-?\d+)"/);
                            fsid = m3 ? (m3[1] || m3[2] || '') : '';
                        }
                        // Đọc AT mới nhất từ window._flowAuthData (content_main.js cập nhật mỗi lần intercept)
                        const liveAt = (window._flowAuthData?.at || '').startsWith('AIQ-') ? window._flowAuthData.at : '';
                        const mAt = scripts.match(/"xsrf"\s*,\s*"(AIQ-[^"]+)"|"SNlM0e"\s*:\s*"(AIQ-[^"]+)"/);
                        const htmlAt = mAt ? (mAt[1] || mAt[2] || '') : '';
                        pageAt = liveAt || htmlAt;
                        console.log('[flow-img] bl=', bl.substring(0,50), ' fsid=', fsid.substring(0,15), ' liveAt_len=', liveAt.length, ' htmlAt_len=', htmlAt.length);
                    }

                    const mkReqid = () => String(Math.floor(Math.random() * 9000000) + 1000000);
                    const mkParams = (rpcid) => {
                        const q = new URLSearchParams({ rpcids: rpcid, bl, hl: 'vi', rt: 'c', 'source-path': `/project/${projectId}`, _reqid: mkReqid() });
                        if (fsid) q.set('f.sid', fsid);
                        return q.toString();
                    };
                    const mkHeaders = () => ({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1', 'origin': 'https://flow.google.com' });

                    // Bước 1: AT token — ưu tiên: sniffer AT (từ Angular native) > pageAt (live) > cachedAt
                    // p.atToken được set bởi veo-engine (từ FLOW_AUTH_FOUND) HOẶC từ sniffer lastGoodAt (Angular native)
                    const cachedAt = (p.atToken && p.atToken.startsWith('AIQ-')) ? p.atToken : '';
                    let at = cachedAt || pageAt;  // snifferAt (qua cachedAt) ưu tiên hơn pageAt
                    if (!at || !at.startsWith('AIQ-')) {
                        return { error: 'NO_AT: không có AT hợp lệ. Hãy refresh flow.google.com và đợi 30 giây.' };
                    }
                    console.log('[flow-img] using AT len=', at.length, ' src=', pageAt ? 'page/_flowAuthData' : 'cachedToken');

                    // Bước 2: Get reCAPTCHA
                    const rcToken = await new Promise((resolve, reject) => {
                        if (!window.grecaptcha?.enterprise) { reject(new Error('no_grecaptcha')); return; }
                        window.grecaptcha.enterprise.execute(SITEKEY, { action: 'IMAGE_GENERATION' })
                            .then(resolve).catch(reject);
                    });

                    console.log('[flow-img] rcToken obtained, len=', rcToken?.length, ' valid=', (rcToken?.length > 100));
                    if (!rcToken || rcToken.length < 50) return { error: 'rcToken invalid/too_short: len=' + (rcToken?.length || 0) };

                    // Bước 3: as29s — đăng ký session UUID, đồng thời lấy fresh AT từ response
                    const uuid1 = crypto.randomUUID().toUpperCase();
                    const uuid2 = crypto.randomUUID().toUpperCase();
                    const uuid3 = crypto.randomUUID().toUpperCase();
                    const seed = Math.floor(Math.random() * 2147483647);
                    const as29sFreq = JSON.stringify([[['as29s', JSON.stringify([uuid3]), null, 'generic']]]);
                    const as29sRespText = await fetch(`${BASE}?${mkParams('as29s')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(as29sFreq)}&at=${encodeURIComponent(at)}`
                    }).then(r => r.text()).catch(() => '');

                    // Server thường trả fresh AT trong response body của bất kỳ batchexecute nào
                    {
                        const atFromAs29s = as29sRespText.match(/"xsrf","(AIQ-[^"]+)"/);
                        if (atFromAs29s && atFromAs29s[1].length >= 30) {
                            const freshAt = atFromAs29s[1];
                            console.log('[flow-img] Fresh AT from as29s response! old_len=', at.length, ' new_len=', freshAt.length, ' new=', freshAt.substring(0,25));
                            at = freshAt;
                        } else {
                            // Fallback: re-read từ content_main.js (async update có thể đã xong)
                            const latestAt = (window._flowAuthData?.at || '').startsWith('AIQ-') ? window._flowAuthData.at : '';
                            if (latestAt && latestAt !== at) {
                                console.log('[flow-img] AT updated by content_main! old_len=', at.length, ' new_len=', latestAt.length);
                                at = latestAt;
                            } else {
                                console.log('[flow-img] AT unchanged before ogiZ0b, len=', at.length, ' as29s_resp_first200=', as29sRespText.substring(0,200));
                            }
                        }
                    }

                    // Bước 3.5: maseQ — upload reference image (nếu có), lấy server image UUID
                    let refImageCell = null; // null = không có ảnh tham chiếu
                    let maseQStatus = p.referenceImageBase64 ? 'pending' : 'not_requested';
                    if (p.referenceImageBase64) {
                        try {
                            console.log('[maseQ] Uploading reference image, base64 len=', p.referenceImageBase64.length);
                            const mUUID1 = crypto.randomUUID().toUpperCase();
                            const mUUID2 = crypto.randomUUID().toUpperCase();
                            const refFilename = p.referenceImageFilename || 'reference.jpeg';
                            const refExt = refFilename.split('.').pop().toLowerCase();
                            const refMime = refExt === 'png' ? 'image/png' : refExt === 'webp' ? 'image/webp' : 'image/jpeg';
                            // maseQ[0] = aspectRow (same structure as ogiZ0b), NOT [[rcToken,1]]
                            const maseAspectRow = [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]];
                            const maseInner = [maseAspectRow, p.referenceImageBase64, refMime, 1,
                                null, null, null, null, refFilename, null, mUUID1, mUUID2];
                            const maseFreq = JSON.stringify([[['maseQ', JSON.stringify(maseInner), null, 'generic']]]);
                            const maseRespText = await fetch(`${BASE}?${mkParams('maseQ')}`, {
                                method: 'POST', credentials: 'include', headers: mkHeaders(),
                                body: `f.req=${encodeURIComponent(maseFreq)}&at=${encodeURIComponent(at)}`
                            }).then(r => r.text()).catch(e => { console.error('[maseQ] fetch error', e); return ''; });

                            // Parse batchexecute response để lấy server image UUID
                            let maseDataStr = null;
                            const maseStripped = maseRespText.replace(/^\)\]}'[\n\r]+/, '');
                            let mPos = 0;
                            while (mPos < maseStripped.length) {
                                const mNl = maseStripped.indexOf('\n', mPos);
                                if (mNl < 0) break;
                                const mLen = parseInt(maseStripped.substring(mPos, mNl).trim(), 10);
                                if (isNaN(mLen) || mLen <= 0) { mPos = mNl + 1; continue; }
                                const mChunk = maseStripped.substring(mNl + 1, mNl + 1 + mLen);
                                try {
                                    const mParsed = JSON.parse(mChunk);
                                    for (const item of (mParsed || [])) {
                                        if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === 'maseQ' && item[2]) {
                                            maseDataStr = item[2]; break;
                                        }
                                    }
                                } catch (_) {
                                    const cm = mChunk.match(/"wrb\.fr","maseQ","((?:[^"\\]|\\.)*)"/);
                                    if (cm) { try { maseDataStr = JSON.parse('"' + cm[1] + '"'); } catch(__) {} }
                                }
                                mPos = mNl + 1 + mLen;
                                if (maseDataStr) break;
                            }
                            if (!maseDataStr) {
                                const mFallback = maseRespText.match(/"wrb\.fr","maseQ","((?:[^"\\]|\\.)*)"/);
                                if (mFallback) { try { maseDataStr = JSON.parse('"' + mFallback[1] + '"'); } catch(_) {} }
                            }

                            if (maseDataStr) {
                                // Server UUID là chuỗi dạng "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" trong response
                                const uuidMatch = maseDataStr.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                                if (uuidMatch) {
                                    const serverImageUUID = uuidMatch[1];
                                    refImageCell = [[serverImageUUID, null, null, null, 1]];
                                    maseQStatus = 'success:' + serverImageUUID.substring(0, 8);
                                    console.log('[maseQ] Got server image UUID:', serverImageUUID);
                                } else {
                                    maseQStatus = 'no_uuid. dataStr=' + maseDataStr.substring(0, 120);
                                    console.warn('[maseQ] No UUID found in response, proceeding without reference. dataStr=', maseDataStr.substring(0, 200));
                                }
                            } else {
                                maseQStatus = 'no_data. http=' + maseRespText.substring(0, 120);
                                console.warn('[maseQ] No data in response, proceeding without reference. body=', maseRespText.substring(0, 200));
                            }
                        } catch (maseErr) {
                            maseQStatus = 'error:' + maseErr.message;
                            console.error('[maseQ] Error uploading reference image:', maseErr);
                            // Tiếp tục không có ảnh tham chiếu thay vì fail hoàn toàn
                        }
                    }

                    // Bước 4: ogiZ0b — cấu trúc native (confirmed from F12, cả 16:9 lẫn 9:16)
                    console.log('[ogiZ0b] DEBUG at=', at.substring(0,25), ' bl=', bl.substring(0,40), ' fsid=', fsid.substring(0,15), ' projectId=', projectId, ' aspectCode=', p.aspectCode, ' model=', p.model, ' rcToken_len=', rcToken?.length, ' hasRefImg=', !!refImageCell);
                    // Native payload structure confirmed from F12 (both 16:9 and 9:16):
                    // aspectRow[1] = 22 always (constant, not aspect code!)
                    // row0[4] = p.aspectCode: 1:1=1, 9:16=2, 16:9=3, 4:3=4, 3:4=5
                    // row0[2] = null without reference, [["serverUUID",null,null,null,1]] with reference
                    const aspectRow = [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]];
                    // row0: [null, null, refImgOrNull, seed, aspectCode, model, null, aspectRow, [[[prompt]]], null×3, uuid1, uuid2] = 14 elements
                    const row0 = [null, null, refImageCell, seed, p.aspectCode, p.model, null,
                        aspectRow,
                        [[[p.prompt]]],
                        null, null, null, uuid1, uuid2];
                    // inner: [null, [row0], count, aspectRow, [uuid3]] — row0 wrapped in array!
                    const inner = [null, [row0], 1, aspectRow, [uuid3]];
                    const ogiFreq = JSON.stringify([[['ogiZ0b', JSON.stringify(inner), null, 'generic']]]);
                    const ogiRes = await fetch(`${BASE}?${mkParams('ogiZ0b')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(ogiFreq)}&at=${encodeURIComponent(at)}`
                    });
                    const body = await ogiRes.text();

                    // Parse batchexecute response (decimal chunk lengths, not hex!)
                    const stripped = body.replace(/^\)\]}'[\n\r]+/, '');
                    let pos = 0, dataStr = null;
                    while (pos < stripped.length) {
                        const nl = stripped.indexOf('\n', pos);
                        if (nl < 0) break;
                        const lenStr = stripped.substring(pos, nl).trim();
                        const len = parseInt(lenStr, 10); // decimal, not hex!
                        if (isNaN(len) || len <= 0) { pos = nl + 1; continue; }
                        const chunk = stripped.substring(nl + 1, nl + 1 + len);
                        try {
                            const parsed = JSON.parse(chunk);
                            for (const item of (parsed || [])) {
                                if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === 'ogiZ0b' && item[2]) {
                                    dataStr = item[2]; break;
                                }
                            }
                        } catch (_) {
                            // Chunk may have concatenated JSON arrays — try regex extraction
                            const cm = chunk.match(/"wrb\.fr","ogiZ0b","((?:[^"\\]|\\.)*)"/);
                            if (cm) { try { dataStr = JSON.parse('"' + cm[1] + '"'); } catch(__) {} }
                        }
                        pos = nl + 1 + len;
                        if (dataStr) break;
                    }
                    // Regex fallback on full body in case chunk parser missed it
                    if (!dataStr) {
                        const m = body.match(/"wrb\.fr","ogiZ0b","((?:[^"\\]|\\.)*)"/);
                        if (m) { try { dataStr = JSON.parse('"' + m[1] + '"'); } catch(_) {} }
                    }
                    if (!dataStr) return { error: `ogiZ0b no data. body=${body.substring(0, 150)}` };

                    // Unescape unicode-escaped URL chars (\u003d → =, \u0026 → &, \u002f → /)
                    const unescapeUrl = (s) => s
                        .replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&')
                        .replace(/\\u002f/gi, '/').replace(/\\\//g, '/');

                    // Extract all image URLs from response
                    const rawData = JSON.stringify(JSON.parse(dataStr));
                    const urlPattern = /https:\\?\/\\?\/flow-content\.google\\?\/image\\?\/[^\s"\\]+/g;
                    const rawUrls = rawData.match(urlPattern) || [];
                    const downloadUrls = rawUrls.map(u => unescapeUrl(u)).filter(u => u.startsWith('https://'));

                    if (!downloadUrls.length) {
                        // Fallback: regex trực tiếp trên body
                        const fallback = body.match(/https:\/\/flow-content\.google\/image\/[^\s"\\]+/g);
                        if (fallback && fallback.length) {
                            downloadUrls.push(...fallback.map(u => unescapeUrl(u)));
                        }
                    }
                    if (!downloadUrls.length) return { error: 'no_download_url. dataStr=' + dataStr.substring(0, 200) };

                    // Debug: log tất cả URLs từ ogiZ0b
                    console.log('[ogiZ0b] ALL extracted URLs:', downloadUrls.map(u => u.substring(0, 120)));

                    // Bước 5: as29s(MEDIA_UUID) → lấy URL full-resolution
                    // Helper tìm URL trong bất kỳ cấu trúc JSON nào
                    const findAllUrls = (obj, pat) => {
                        const found = [];
                        if (typeof obj === 'string' && pat.test(obj)) found.push(obj);
                        if (Array.isArray(obj)) for (const x of obj) found.push(...findAllUrls(x, pat));
                        return found;
                    };
                    const urlPat = /^https:\/\/(?:flow-content\.google|storage\.googleapis\.com|lh\d+\.googleusercontent\.com)/;

                    const finalDownloadUrls = [];
                    for (const cdnUrl of downloadUrls) {
                        const mUuid = (cdnUrl.match(/\/image\/([0-9a-f][0-9a-f-]{30,})\?/i) || [])[1];
                        if (!mUuid) { finalDownloadUrls.push(cdnUrl); continue; }
                        try {
                            const dlFreq = JSON.stringify([[['as29s', JSON.stringify([mUuid]), null, 'generic']]]);
                            const dlR = await fetch(`${BASE}?${mkParams('as29s')}`, {
                                method: 'POST', credentials: 'include', headers: mkHeaders(),
                                body: `f.req=${encodeURIComponent(dlFreq)}&at=${encodeURIComponent(at)}`
                            });
                            const dlBody = await dlR.text();
                            let fullUrl = cdnUrl;
                            const dlm = dlBody.match(/"wrb\.fr","as29s","((?:[^"\\]|\\.)*)"/);
                            if (dlm) {
                                const dlDataStr = JSON.parse('"' + dlm[1] + '"');
                                const dlData = JSON.parse(dlDataStr);
                                // Debug: log toàn bộ cấu trúc as29s để tìm URL đúng
                                console.log('[as29s] dlData raw (500 chars):', JSON.stringify(dlData).substring(0, 500));
                                console.log('[as29s] [5][12]=', String(dlData?.[5]?.[12] || '').substring(0, 100));
                                console.log('[as29s] [6][0][13]=', String(dlData?.[6]?.[0]?.[13] || '').substring(0, 100));
                                // Thử path đã biết trước
                                const knownUrl = dlData?.[5]?.[12] || dlData?.[6]?.[0]?.[13];
                                if (typeof knownUrl === 'string' && knownUrl.startsWith('https://')) {
                                    fullUrl = knownUrl;
                                } else {
                                    // Tìm bất kỳ URL nào trong response khác với cdnUrl
                                    const allFound = findAllUrls(dlData, urlPat).map(unescapeUrl).filter(u => u.startsWith('https://'));
                                    console.log('[as29s] all found URLs:', allFound.map(u => u.substring(0, 100)));
                                    const best = allFound.find(u => u !== cdnUrl) || allFound[0];
                                    if (best) fullUrl = best;
                                }
                            } else {
                                console.log('[as29s] wrb.fr not found in dlBody, preview:', dlBody.substring(0, 200));
                            }
                            console.log('[as29s DL] mUuid=', mUuid.substring(0,8), '→ fullUrl=', fullUrl.substring(0, 100));
                            finalDownloadUrls.push(fullUrl);
                        } catch(e) { console.log('[as29s] error:', e.message); finalDownloadUrls.push(cdnUrl); }
                    }
                    const resultUrls = finalDownloadUrls.length ? finalDownloadUrls : downloadUrls;
                    return { downloadUrls: resultUrls, downloadUrl: resultUrls[0], uuid2, maseQStatus };
                } catch (e) { return { error: e.message }; }
            },
            args: [genParams]
        });

        const res = result?.[0]?.result;
        if (res?.error) {
            console.log('❌ Flow image gen lỗi:', res.error);
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: res.error }) });
        } else if (res?.downloadUrl) {
            const urls = res.downloadUrls || [res.downloadUrl];
            console.log(`✅ Flow image gen OK — chrome.downloads tải ${urls.length} ảnh (cần browser session cho flow-content.google)...`);
            const downloadedPaths = [];
            for (const url of urls) {
                console.log('  📥 Tải URL:', url.substring(0, 100));
                try {
                    const tempName = `fluxy_flow_${Date.now()}_${Math.random().toString(36).slice(2,6)}.webp`;
                    const downloadId = await new Promise((resolve, reject) => {
                        chrome.downloads.download({ url, filename: tempName, saveAs: false, conflictAction: 'uniquify' }, (id) => {
                            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                            else resolve(id);
                        });
                    });
                    await new Promise((resolve, reject) => {
                        const t = setTimeout(() => { chrome.downloads.onChanged.removeListener(fn); reject(new Error('timeout_60s')); }, 60000);
                        const fn = (delta) => {
                            if (delta.id !== downloadId) return;
                            if (delta.state?.current === 'complete') { clearTimeout(t); chrome.downloads.onChanged.removeListener(fn); resolve(); }
                            if (delta.state?.current === 'interrupted') { clearTimeout(t); chrome.downloads.onChanged.removeListener(fn); reject(new Error('interrupted:' + (delta.error?.current || ''))); }
                        };
                        chrome.downloads.onChanged.addListener(fn);
                    });
                    const [item] = await chrome.downloads.search({ id: downloadId });
                    downloadedPaths.push({ url, filePath: item.filename });
                    chrome.downloads.erase({ id: downloadId });
                    console.log(`  ✅ Xong: ${item.filename}`);
                } catch(e) {
                    downloadedPaths.push({ url, error: e.message });
                    console.log('  ❌ Lỗi:', e.message);
                }
            }
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ downloadUrl: res.downloadUrl, downloadUrls: urls, uuid2: res.uuid2, downloadedPaths, maseQStatus: res.maseQStatus }) });
        } else {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_RESULT' }) });
        }
    } catch (e) {
        console.log('Lỗi executeFlowImageGen:', e.message);
        await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) }).catch(() => {});
    } finally {
        isGeneratingFlowImage = false;
    }
}

// TẠO VIDEO QUA FLOW.GOOGLE.COM BATCHEXECUTE (MAIN world — browser session đầy đủ)
let isGeneratingFlowVideo = false;
async function executeFlowVideoGen() {
    if (isGeneratingFlowVideo) return;
    isGeneratingFlowVideo = true;
    const SAVE_URL = 'http://127.0.0.1:3000/api/save-flow-video-result';
    try {
        let tab = await findActiveTab();
        if (!tab) {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_TAB' }) }).catch(() => {});
            return;
        }
        const dataRes = await fetch('http://127.0.0.1:3000/api/get-pending-flow-video');
        if (!dataRes.ok) { console.log('❌ Không lấy được flow video data'); return; }
        const genParams = await dataRes.json();
        if (!genParams || !genParams.prompt) { console.log('❌ Thiếu params flow video gen'); return; }

        console.log(`🎬 Flow video gen: "${genParams.prompt.substring(0, 40)}..." model=${genParams.modelCode} dur=${genParams.duration}s`);

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (p) => {
                try {
                    const SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
                    const BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
                    const projectId = p.projectId;

                    // Lấy bl/fsid từ page scripts; AT từ window._flowAuthData (live) hoặc page scripts
                    let bl = p.bl || '', fsid = p.fsid || '', pageAt = '';
                    {
                        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
                        const m2 = scripts.match(/"bl"\s*:\s*"([^"]+)"|boq_[a-z0-9_-]+_\d{8}\.\d{2}_p\d+/);
                        if (m2) bl = m2[1] || m2[0];
                        const m3 = scripts.match(/"FdrFJe"\s*:\s*"(-?\d+)"|"f\.sid"\s*:\s*"(-?\d+)"/);
                        if (m3) fsid = m3[1] || m3[2] || '';
                        const liveAt = (window._flowAuthData?.at || '').startsWith('AIQ-') ? window._flowAuthData.at : '';
                        const mAt = scripts.match(/"xsrf"\s*,\s*"(AIQ-[^"]+)"|"SNlM0e"\s*:\s*"(AIQ-[^"]+)"/);
                        const htmlAt = mAt ? (mAt[1] || mAt[2] || '') : '';
                        pageAt = liveAt || htmlAt;
                    }

                    const mkReqid = () => String(Math.floor(Math.random() * 9000000) + 1000000);
                    const mkParams = (rpcid) => {
                        const q = new URLSearchParams({ rpcids: rpcid, bl, hl: 'vi', rt: 'c', 'source-path': `/project/${projectId}`, _reqid: mkReqid() });
                        if (fsid) q.set('f.sid', fsid);
                        return q.toString();
                    };
                    const mkHeaders = () => ({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1', 'origin': 'https://flow.google.com' });

                    const parseBatch = (body, rpcid) => {
                        const stripped = body.replace(/^\)\]}'[\n\r]+/, '');
                        let pos = 0, dataStr = null;
                        while (pos < stripped.length) {
                            const nl = stripped.indexOf('\n', pos);
                            if (nl < 0) break;
                            const lenStr = stripped.substring(pos, nl).trim();
                            const len = parseInt(lenStr, 10);
                            if (isNaN(len) || len <= 0) { pos = nl + 1; continue; }
                            const chunk = stripped.substring(nl + 1, nl + 1 + len);
                            try {
                                const parsed = JSON.parse(chunk);
                                for (const item of (parsed || [])) {
                                    if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcid && item[2]) {
                                        dataStr = item[2]; break;
                                    }
                                }
                            } catch (_) {
                                const re = new RegExp('"wrb\\.fr","' + rpcid + '","((?:[^"\\\\]|\\\\.)*)"');
                                const cm = chunk.match(re);
                                if (cm) { try { dataStr = JSON.parse('"' + cm[1] + '"'); } catch(__) {} }
                            }
                            pos = nl + 1 + len;
                            if (dataStr) break;
                        }
                        if (!dataStr) {
                            const re = new RegExp('"wrb\\.fr","' + rpcid + '","((?:[^"\\\\]|\\\\.)*)"');
                            const m = body.match(re);
                            if (m) { try { dataStr = JSON.parse('"' + m[1] + '"'); } catch(_) {} }
                        }
                        return dataStr;
                    };

                    // AT token — ưu tiên: page HTML → nzlxg (với cached AT) → cached
                    const cachedAt = (p.atToken && p.atToken.startsWith('AIQ-')) ? p.atToken : '';
                    let at = '';
                    if (pageAt) {
                        at = pageAt;
                    } else {
                        const nzFreq = JSON.stringify([[['nzlxg', '[]', null, 'generic']]]);
                        let nzBody = `f.req=${encodeURIComponent(nzFreq)}`;
                        if (cachedAt) nzBody += `&at=${encodeURIComponent(cachedAt)}`;
                        const nzResp = await fetch(`${BASE}?${mkParams('nzlxg')}`, {
                            method: 'POST', credentials: 'include', headers: mkHeaders(),
                            body: nzBody
                        }).then(r => r.text()).catch(() => '');
                        const atMatch = nzResp.match(/"xsrf","(AIQ-[^"]+)"/);
                        if (atMatch) {
                            at = atMatch[1];
                        } else if (cachedAt) {
                            at = cachedAt;
                        } else {
                            return { error: 'NO_AT: mở flow.google.com để capture token. nzResp=' + nzResp.substring(0, 80) };
                        }
                    }

                    // reCAPTCHA
                    const rcToken = await new Promise((resolve, reject) => {
                        if (!window.grecaptcha?.enterprise) { reject(new Error('no_grecaptcha')); return; }
                        window.grecaptcha.enterprise.execute(SITEKEY, { action: 'VIDEO_GENERATION' })
                            .then(resolve).catch(reject);
                    });

                    // as29s
                    const uuid1 = crypto.randomUUID().toUpperCase();
                    const uuid2 = crypto.randomUUID().toUpperCase();
                    const uuid3 = crypto.randomUUID().toUpperCase();
                    const seed = Math.floor(Math.random() * 2147483647);
                    const as29sFreq = JSON.stringify([[['as29s', JSON.stringify([uuid3]), null, 'generic']]]);
                    await fetch(`${BASE}?${mkParams('as29s')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(as29sFreq)}&at=${encodeURIComponent(at)}`
                    }).catch(() => {});

                    // YhhmEf — structure confirmed from F12 (multiple tests):
                    // - duration is encoded IN the model code (e.g. "veo_3_1_t2v_lite_4s_low_priority")
                    // - task[2] = video aspect code (9:16=1, 16:9=2)
                    // - inner[2][1] = 2 (fixed constant, not duration)
                    const aspectRow = [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]];
                    const task = [
                        [null, null, [[[p.prompt]]]],
                        p.modelCode,    // already includes duration suffix (baked in veo-engine)
                        p.aspectCode,   // video aspect: 9:16=1, 16:9=2
                        null,
                        [null, null, null, null, uuid1, uuid2]
                    ];
                    const inner = [[task], aspectRow, [uuid3, 2]]; // 2 = fixed constant
                    const yhFreq = JSON.stringify([[['YhhmEf', JSON.stringify(inner), null, 'generic']]]);
                    const yhRes = await fetch(`${BASE}?${mkParams('YhhmEf')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(yhFreq)}&at=${encodeURIComponent(at)}`
                    });
                    const yhBody = await yhRes.text();
                    if (!yhRes.ok) return { error: `YhhmEf HTTP ${yhRes.status}: ${yhBody.substring(0, 300)}` };

                    const yhData = parseBatch(yhBody, 'YhhmEf');
                    if (!yhData) return { error: `YhhmEf no data. yhBody=${yhBody.substring(0, 300)}` };

                    // Tách operation ID và mediaId từ response
                    let operationId = null, mediaId = null;
                    try {
                        const parsed = typeof yhData === 'string' ? JSON.parse(yhData) : yhData;
                        const str = JSON.stringify(parsed);
                        // UUID pattern — first UUID = operationId (dùng cho jwpduf polling)
                        const uuidM = str.match(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
                        if (uuidM) operationId = uuidM[1];
                        // Long string pattern (>20 chars, alphanumeric)
                        if (!operationId) {
                            const longM = str.match(/"([A-Za-z0-9_\-]{20,})"/);
                            if (longM) operationId = longM[1];
                        }
                        // Array[0] direct
                        if (!operationId && Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].length > 8) {
                            operationId = parsed[0];
                        }
                        // mediaId từ parsed[3][0][0] — tuple [mediaId, projId, workflowId, "CAE"]
                        // T2V: workflowId === operationId, mediaId KHÁC operationId (dùng cho as29s + URL path)
                        if (Array.isArray(parsed?.[3]?.[0]) && typeof parsed[3][0][0] === 'string' && parsed[3][0][0].includes('-')) {
                            mediaId = parsed[3][0][0];
                        }
                        // Fallback: UUID thứ 2 trong response (khác operationId)
                        if (!mediaId && operationId) {
                            const allUuids = [...str.matchAll(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi)].map(m => m[1]);
                            mediaId = allUuids.find(u => u !== operationId) || null;
                        }
                    } catch(e) {}
                    if (!operationId) return { error: `YhhmEf: không tìm thấy operationId. data=${JSON.stringify(yhData).substring(0, 200)}` };

                    return { operationId, mediaId, at };
                } catch (e) { return { error: e.message }; }
            },
            args: [genParams]
        });

        const res = result?.[0]?.result;
        if (res?.error) {
            console.log('❌ Flow video gen lỗi:', res.error);
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: res.error }) });
        } else if (res?.operationId) {
            console.log('✅ YhhmEf OK, operationId:', res.operationId.substring(0, 20), '..., mediaId:', (res.mediaId || 'none').substring(0, 8));
            // Thêm T2V vào Extension poller — wid=operationId (T2V: workflowId===operationId)
            _pendingR2V.set(res.operationId, {
                pid: genParams.projectId,
                bl: genParams.bl || '',
                fsid: genParams.fsid || '',
                at: res.at,
                wid: res.operationId,
                mid: res.mediaId || null,
                isT2V: true,
                genStartTs: Date.now(),
                tabId: tab.id,
                startTime: Date.now()
            });
            ensureR2VPoller();
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: res.operationId, at: res.at }) });
        } else {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_RESULT' }) });
        }
    } catch (e) {
        console.log('Lỗi executeFlowVideoGen:', e.message);
        await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) }).catch(() => {});
    } finally {
        isGeneratingFlowVideo = false;
    }
}

// ══ SHARED R2V POLLER: 1 loop xử lý TẤT CẢ pending operations (thay vì N IIFE riêng biệt) ══
const _pendingR2V = new Map(); // opId → { pid, bl, fsid, at, wid, genStartTs, tabId, startTime }
let _r2vPollerActive = false;

async function ensureR2VPoller() {
    if (_r2vPollerActive) return;
    _r2vPollerActive = true;
    const SAVE_VIDEO = 'http://127.0.0.1:3000/api/save-flow-r2v-video';

    let _pollIter = 0;
    while (_pendingR2V.size > 0) {
        await new Promise(r => setTimeout(r, 3000));
        _pollIter++;
        const now = Date.now();
        console.log(`[Poller] ▶ iter=${_pollIter} pending=${_pendingR2V.size}`);

        // Timeout: loại ops quá 10 phút
        for (const [opId, p] of _pendingR2V) {
            if (now - p.startTime > 600000) {
                console.log(`[R2V ${opId.substring(0,8)}] ❌ Timeout 10 phút`);
                _pendingR2V.delete(opId);
            }
        }
        if (_pendingR2V.size === 0) break;

        // ── Method A: webRequest SW-level (chỉ nhận video URL, không nhận image) ──
        const unclaimedCaptures = _capturedR2VUrls.filter(c => !c.claimedBy);
        for (const cap of unclaimedCaptures) {
            if (!cap.url.includes('flow-content.google')) continue;
            for (const [opId, p] of _pendingR2V) {
                if (!cap.url.includes(opId) || cap.claimedBy) continue;
                cap.claimedBy = opId;
                if (cap.url.includes('/video/')) {
                    // Video URL trực tiếp → tải về ngay
                    console.log(`[R2V ${opId.substring(0,8)}] ✅ A-webRequest VIDEO: ${cap.url.substring(0,70)}`);
                    _pendingR2V.delete(opId);
                    fetch(SAVE_VIDEO, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ operationId: opId, videoUrl: cap.url }) }).catch(()=>{});
                } else if (cap.url.includes('/image/')) {
                    // Thumbnail image → video ĐÃ XONG → đánh dấu để poll as29s gấp
                    console.log(`[R2V ${opId.substring(0,8)}] 🖼️ Thumbnail detected → poll as29s ngay`);
                    p.thumbnailDetected = true;
                }
            }
        }
        if (_pendingR2V.size === 0) break;

        // ── Method C + E: MAIN world executeScript (1 call cho TẤT CẢ pending ops) ──
        const byTab = new Map();
        for (const [opId, p] of _pendingR2V) {
            if (!byTab.has(p.tabId)) byTab.set(p.tabId, []);
            byTab.get(p.tabId).push({
                opId, pid: p.pid, bl: p.bl, fsid: p.fsid, at: p.at, wid: p.wid, mid: p.mid,
                isT2V: p.isT2V || false,
                genStartTs: p.genStartTs,
                elapsedMs: now - p.startTime,
                thumbnailDetected: p.thumbnailDetected || false
            });
        }
        for (const [tabId, ops] of byTab) {
            try {
                const pr = await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: async (pendingOps) => {
                        if (!window._fluxyOpClaimed) window._fluxyOpClaimed = {};
                        const results = {};
                        const claimed = new Set(Object.values(window._fluxyOpClaimed));
                        const captured = window._fluxyCapturedUrls || [];

                        // Method C: _fluxyCapturedUrls — chỉ nhận video URL (không nhận image)
                        for (const p of pendingOps) {
                            if (window._fluxyOpClaimed[p.opId]) {
                                results[p.opId] = { url: window._fluxyOpClaimed[p.opId], method: 'C_recall' };
                                continue;
                            }
                            const exact = captured.find(c => c.url.includes(p.mid || p.opId) && c.url.includes('/video/') && !claimed.has(c.url));
                            if (exact) {
                                window._fluxyOpClaimed[p.opId] = exact.url;
                                claimed.add(exact.url);
                                window._fluxyCapturedUrls = captured.filter(c => c.url !== exact.url);
                                results[p.opId] = { url: exact.url, method: 'C_exact' };
                            }
                        }

                        // Method F+D: Scan DOM thumbnails → trigger Angular to load video URL
                        const thumbUuids = new Set();
                        const needHover = pendingOps.filter(p => !results[p.opId]);
                        try {
                            document.querySelectorAll('img[src*="flow-content.google/image/"]').forEach(img => {
                                const m = img.src.match(/flow-content\.google\/image\/([0-9a-f-]{36})/i);
                                if (!m) return;
                                const imgOpId = m[1].toLowerCase();
                                thumbUuids.add(imgOpId);

                                const matchOp = needHover.find(p => (p.mid || p.opId).toLowerCase() === imgOpId);
                                if (!matchOp || results[matchOp.opId]) return;

                                // Method D1: Angular component scan — tìm videoUrl trong component state
                                try {
                                    let el = img;
                                    for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
                                        const comp = window.ng?.getComponent?.(el) || window.ng?.getContext?.(el);
                                        if (!comp) continue;
                                        const str = JSON.stringify(comp);
                                        const vm = str.match(/"(https:\/\/flow-content\.google\/video\/[^"]{36,})"/);
                                        if (vm) {
                                            const url = vm[1].replace(/\\\//g,'/').replace(/\\u003d/g,'=').replace(/\\u0026/g,'&');
                                            window._fluxyOpClaimed[matchOp.opId] = url;
                                            results[matchOp.opId] = { url, method: 'D_ng_comp' };
                                            return;
                                        }
                                    }
                                } catch(_) {}

                                if (results[matchOp.opId]) return;

                                // Method D2: Hover/click trigger → Angular sẽ load video URL → content_main.js capture
                                try {
                                    const card = img.closest('li, article, [class*="media-item"], [class*="card"], [class*="gallery-item"]')
                                                 || img.parentElement?.parentElement || img.parentElement;
                                    if (card) {
                                        card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
                                        card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
                                        // Try clicking play button if found
                                        const playBtn = card.querySelector('[aria-label*="lay" i], [class*="play" i]:not(img), [data-testid*="play" i], button');
                                        if (playBtn && playBtn.tagName === 'BUTTON') playBtn.click();
                                    }
                                } catch(_) {}
                            });
                        } catch(_) {}

                        // Method E+F: as29s — dùng workflowId từ capture hoặc tự gọi jwpduf lấy wid
                        const needPoll = pendingOps.filter(p => !results[p.opId]);
                        if (needPoll.length > 0) {
                            const BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
                            const _decodeUrl = s => s
                                .replace(/\\\//g,'/')
                                .replace(/\\{1,2}u003d/g,'=')
                                .replace(/\\{1,2}u0026/g,'&')
                                .replace(/\\{1,2}u002f/g,'/')
                                .replace(/\\+$/, '');
                            const _extractVideoUrl = txt => {
                                const m = txt.match(/"(https:(?:\\\/|\/){2}flow-content\.google\/(?:video|image)\/[^"]{10,})"/)
                                    || txt.match(/"(https:(?:\\\/|\/){2}storage\.googleapis\.com\/ais-[^"]{10,})"/)
                                    || txt.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.mp4[^"]{0,800})"/)
                                    || txt.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.m3u8[^"]{0,300})"/)
                                    || txt.match(/"(https:(?:\\\/|\/){2}[^"]{5,}\.webm[^"]{0,300})"/)
                                    || txt.match(/"(https:(?:\\\/|\/){2}lh3\.googleusercontent\.com\/ais[^"]{10,})"/);
                                return m ? _decodeUrl(m[1]) : null;
                            };
                            const pollOne = async (p) => {
                                try {
                                    const liveAt = window._flowAuthData?.at || p.at;
                                    const liveBl = window._flowAuthData?.bl || p.bl || '';
                                    const liveFsid = window._flowAuthData?.fsid || p.fsid || '';
                                    const hdrs = {'content-type':'application/x-www-form-urlencoded;charset=UTF-8','x-same-domain':'1','origin':'https://flow.google.com'};
                                    const mkUsp = (rpc) => {
                                        const u = new URLSearchParams({ rpcids:rpc, bl:liveBl, hl:'vi', rt:'c', 'source-path':`/project/${p.pid}`, 'soc-app':'1','soc-platform':'1','soc-device':'1' });
                                        if (liveFsid) u.set('f.sid', liveFsid);
                                        return u;
                                    };

                                    // T2V: thử jwpduf + WuwhI song song (cả 2 đều cần cookie → gọi từ Extension)
                                    if (p.isT2V) {
                                        // Attempt 1: jwpduf — khi video done sẽ có URL
                                        const jfreq = JSON.stringify([[['jwpduf', JSON.stringify([p.opId]), null, 'generic']]]);
                                        const jresp = await fetch(`${BASE}?${mkUsp('jwpduf')}`, { method:'POST', credentials:'include', headers:hdrs, body:`f.req=${encodeURIComponent(jfreq)}&at=${encodeURIComponent(liveAt)}` });
                                        const jtxt = await jresp.text();
                                        const jUrl = _extractVideoUrl(jtxt);
                                        if (jUrl) {
                                            window._fluxyOpClaimed[p.opId] = jUrl;
                                            return { opId: p.opId, url: jUrl, method: 'T2V_jwpduf', debug: null };
                                        }

                                        // Attempt 2: WuwhI với mediaId — download endpoint (nếu có mediaId)
                                        if (p.mid) {
                                            try {
                                                const wPayload = JSON.stringify([
                                                    ['FLOW_DOWNLOAD', [null, null, null, 'MEDIA_ID', p.mid, 'VIDEO_DOWNLOAD_RESOLUTION', 'ORIGINAL_VIDEO']],
                                                    ['ASSET_DOWNLOAD', [null, null, null, 'MEDIA_ID', p.mid]]
                                                ]);
                                                const wfreq = JSON.stringify([[['WuwhI', wPayload, null, 'generic']]]);
                                                const wresp = await fetch(`${BASE}?${mkUsp('WuwhI')}`, { method:'POST', credentials:'include', headers:hdrs, body:`f.req=${encodeURIComponent(wfreq)}&at=${encodeURIComponent(liveAt)}` });
                                                const wtxt = await wresp.text();
                                                const wUrl = _extractVideoUrl(wtxt);
                                                if (wUrl) {
                                                    window._fluxyOpClaimed[p.opId] = wUrl;
                                                    return { opId: p.opId, url: wUrl, method: 'T2V_WuwhI', debug: null };
                                                }
                                                const wErrM = wtxt.match(/\["e",(\d+)/);
                                                const wDebug = `WuwhI http=${wresp.status} err=${wErrM?wErrM[1]:'?'} resp=${wtxt.substring(0,100)}`;
                                                const jErrM = jtxt.match(/\["e",(\d+)/);
                                                return { opId: p.opId, url: null, method: 'T2V_null', debug: `jwpduf_err=${jErrM?jErrM[1]:'?'} ${wDebug}` };
                                            } catch(we) {
                                                const jErrM = jtxt.match(/\["e",(\d+)/);
                                                return { opId: p.opId, url: null, method: 'T2V_null', debug: `jwpduf_err=${jErrM?jErrM[1]:'?'} WuwhI_err=${we.message}` };
                                            }
                                        }

                                        const errM = jtxt.match(/\["e",(\d+)/);
                                        return { opId: p.opId, url: null, method: 'T2V_jwpduf_null', debug: `err=${errM?errM[1]:'?'} http=${jresp.status} resp=${jtxt.substring(0,150)}` };
                                    }

                                    // R2V: lấy workflowId rồi gọi as29s
                                    let capturedWid = p.wid || window._fluxyWorkflowIds?.[p.mid || p.opId] || window._fluxyWorkflowIds?.[p.opId] || null;
                                    if (!capturedWid) {
                                        try {
                                            const jfreq = JSON.stringify([[['jwpduf', JSON.stringify([p.opId]), null, 'generic']]]);
                                            const jbody = `f.req=${encodeURIComponent(jfreq)}&at=${encodeURIComponent(liveAt)}`;
                                            const jresp = await fetch(`${BASE}?${mkUsp('jwpduf')}`, { method:'POST', credentials:'include', headers:hdrs, body:jbody });
                                            const jtxt = await jresp.text();
                                            const jm = jtxt.match(/\\"([0-9a-f-]{36})\\",\\"[0-9a-f-]{36}\\",\\"([0-9a-f-]{36})\\",\\"CAE\\"/i)
                                                     || jtxt.match(/"([0-9a-f-]{36})","[0-9a-f-]{36}","([0-9a-f-]{36})","CAE"/i);
                                            if (jm && jm[1].toLowerCase() === p.opId.toLowerCase()) {
                                                capturedWid = jm[2];
                                                if (!window._fluxyWorkflowIds) window._fluxyWorkflowIds = {};
                                                window._fluxyWorkflowIds[p.opId] = capturedWid;
                                            }
                                        } catch(_) {}
                                    }

                                    if (!capturedWid) {
                                        return { opId: p.opId, url: null, method: 'skip_no_wid', debug: null };
                                    }

                                    // Gọi as29s với workflowId đúng
                                    const freq = JSON.stringify([[['as29s', JSON.stringify([p.mid || p.opId, p.pid, capturedWid, 'CAE']), null, 'generic']]]);
                                    const body = `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(liveAt)}`;
                                    const resp = await fetch(`${BASE}?${mkUsp('as29s')}`, { method:'POST', credentials:'include', headers:hdrs, body });
                                    const txt = await resp.text();
                                    const videoUrl = _extractVideoUrl(txt);
                                    if (videoUrl) {
                                        window._fluxyOpClaimed[p.opId] = videoUrl;
                                        return { opId: p.opId, url: videoUrl, method: 'F_as29s', debug: null };
                                    }
                                    const errM = txt.match(/\["e",(\d+)/);
                                    return { opId: p.opId, url: null, method: 'F_null', debug: `mid=${(p.mid||p.opId).substring(0,8)} wid=${capturedWid.substring(0,8)} err=${errM?errM[1]:'?'} resp=${txt.substring(0,120)}` };
                                } catch(e) {
                                    return { opId: p.opId, url: null, method: 'F_err', debug: e.message };
                                }
                            };
                            const batchResults = await Promise.allSettled(needPoll.map(pollOne));
                            for (const r of batchResults) {
                                if (r.status === 'fulfilled' && r.value) results[r.value.opId] = r.value;
                            }
                        }
                        return results;
                    },
                    args: [ops]
                });
                const results = pr?.[0]?.result || {};
                for (const [opId, result] of Object.entries(results)) {
                    if (result?.url) {
                        console.log(`[R2V ${opId.substring(0,8)}] ✅ ${result.method}: ${result.url.substring(0,70)}`);
                        _pendingR2V.delete(opId);
                        fetch(SAVE_VIDEO, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ operationId: opId, videoUrl: result.url }) }).catch(()=>{});
                    } else if (result?.debug) {
                        // Log as29s response vào SW console để debug
                        console.log(`[R2V ${opId.substring(0,8)}] ❌ ${result.method}: ${result.debug}`);
                    }
                }
            } catch(e) {
                try { await chrome.tabs.get(tabId); } catch(_) {
                    for (const [opId, p] of _pendingR2V) { if (p.tabId === tabId) _pendingR2V.delete(opId); }
                }
            }
        }
    }
    _r2vPollerActive = false;
}

// TẠO VIDEO R2V (INGREDIENTS) QUA FLOW.GOOGLE.COM BATCHEXECUTE (MZZa6b)
let isGeneratingFlowR2V = false;
async function executeFlowR2VGen() {
    if (isGeneratingFlowR2V) return;
    isGeneratingFlowR2V = true;
    const SAVE_URL = 'http://127.0.0.1:3000/api/save-flow-r2v-result';
    try {
        let tab = await findActiveTab();
        if (!tab) {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_TAB' }) }).catch(() => {});
            return;
        }
        const dataRes = await fetch('http://127.0.0.1:3000/api/get-pending-flow-r2v');
        if (!dataRes.ok) { console.log('❌ Không lấy được flow r2v data'); return; }
        const genParams = await dataRes.json();
        if (!genParams || !genParams.prompt) { console.log('❌ Thiếu params flow r2v gen'); return; }

        console.log(`🎬 Flow R2V gen: "${genParams.prompt.substring(0, 40)}..." model=${genParams.modelCode}`);

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (p) => {
                try {
                    const SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
                    const BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
                    const projectId = p.projectId;

                    let bl = p.bl || '', fsid = p.fsid || '', pageAt = '';
                    {
                        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
                        const m2 = scripts.match(/"bl"\s*:\s*"([^"]+)"|boq_[a-z0-9_-]+_\d{8}\.\d{2}_p\d+/);
                        if (m2) bl = m2[1] || m2[0];
                        const m3 = scripts.match(/"FdrFJe"\s*:\s*"(-?\d+)"|"f\.sid"\s*:\s*"(-?\d+)"/);
                        if (m3) fsid = m3[1] || m3[2] || '';
                        const liveAt = (window._flowAuthData?.at || '').startsWith('AIQ-') ? window._flowAuthData.at : '';
                        const mAt = scripts.match(/"xsrf"\s*,\s*"(AIQ-[^"]+)"|"SNlM0e"\s*:\s*"(AIQ-[^"]+)"/);
                        const htmlAt = mAt ? (mAt[1] || mAt[2] || '') : '';
                        pageAt = liveAt || htmlAt;
                    }

                    const mkReqid = () => String(Math.floor(Math.random() * 9000000) + 1000000);
                    const mkParams = (rpcid) => {
                        const q = new URLSearchParams({ rpcids: rpcid, bl, hl: 'vi', rt: 'c', 'source-path': `/project/${projectId}`, _reqid: mkReqid() });
                        if (fsid) q.set('f.sid', fsid);
                        return q.toString();
                    };
                    const mkHeaders = () => ({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1', 'origin': 'https://flow.google.com' });

                    const parseBatch = (body, rpcid) => {
                        const stripped = body.replace(/^\)\]}'[\n\r]+/, '');
                        let pos = 0, dataStr = null;
                        while (pos < stripped.length) {
                            const nl = stripped.indexOf('\n', pos);
                            if (nl < 0) break;
                            const lenStr = stripped.substring(pos, nl).trim();
                            const len = parseInt(lenStr, 10);
                            if (isNaN(len) || len <= 0) { pos = nl + 1; continue; }
                            const chunk = stripped.substring(nl + 1, nl + 1 + len);
                            try {
                                const parsed = JSON.parse(chunk);
                                for (const item of (parsed || [])) {
                                    if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcid && item[2]) {
                                        dataStr = item[2]; break;
                                    }
                                }
                            } catch (_) {
                                const re = new RegExp('"wrb\\.fr","' + rpcid + '","((?:[^"\\\\]|\\\\.)*)"');
                                const cm = chunk.match(re);
                                if (cm) { try { dataStr = JSON.parse('"' + cm[1] + '"'); } catch(__) {} }
                            }
                            pos = nl + 1 + len;
                            if (dataStr) break;
                        }
                        if (!dataStr) {
                            const re = new RegExp('"wrb\\.fr","' + rpcid + '","((?:[^"\\\\]|\\\\.)*)"');
                            const m = body.match(re);
                            if (m) { try { dataStr = JSON.parse('"' + m[1] + '"'); } catch(_) {} }
                        }
                        return dataStr;
                    };

                    // AT token
                    const cachedAt = (p.atToken && p.atToken.startsWith('AIQ-')) ? p.atToken : '';
                    let at = '';
                    if (pageAt) {
                        at = pageAt;
                    } else {
                        const nzFreq = JSON.stringify([[['nzlxg', '[]', null, 'generic']]]);
                        let nzBody = `f.req=${encodeURIComponent(nzFreq)}`;
                        if (cachedAt) nzBody += `&at=${encodeURIComponent(cachedAt)}`;
                        const nzResp = await fetch(`${BASE}?${mkParams('nzlxg')}`, {
                            method: 'POST', credentials: 'include', headers: mkHeaders(), body: nzBody
                        }).then(r => r.text()).catch(() => '');
                        const atMatch = nzResp.match(/"xsrf","(AIQ-[^"]+)"/);
                        if (atMatch) {
                            at = atMatch[1];
                        } else if (cachedAt) {
                            at = cachedAt;
                        } else {
                            return { error: 'NO_AT: mở flow.google.com. nzResp=' + nzResp.substring(0, 80) };
                        }
                    }

                    // reCAPTCHA
                    const rcToken = await new Promise((resolve, reject) => {
                        if (!window.grecaptcha?.enterprise) { reject(new Error('no_grecaptcha')); return; }
                        window.grecaptcha.enterprise.execute(SITEKEY, { action: 'VIDEO_GENERATION' })
                            .then(resolve).catch(reject);
                    });

                    const uuid1 = crypto.randomUUID().toUpperCase();
                    const uuid2 = crypto.randomUUID().toUpperCase();
                    const uuid3 = crypto.randomUUID().toUpperCase();
                    const aspectRow = [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]];

                    // as29s (session init)
                    const as29sFreq = JSON.stringify([[['as29s', JSON.stringify([uuid3]), null, 'generic']]]);
                    await fetch(`${BASE}?${mkParams('as29s')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(as29sFreq)}&at=${encodeURIComponent(at)}`
                    }).catch(() => {});

                    // maseQ — upload ingredient images → get server UUIDs (max 7 confirmed from F12)
                    const parseMaseUUID = (respText) => {
                        const stripped2 = respText.replace(/^\)\]}'[\n\r]+/, '');
                        let mPos = 0;
                        while (mPos < stripped2.length) {
                            const nl = stripped2.indexOf('\n', mPos);
                            if (nl < 0) break;
                            const lenStr = stripped2.substring(mPos, nl).trim();
                            const len = parseInt(lenStr, 10);
                            if (isNaN(len) || len <= 0) { mPos = nl + 1; continue; }
                            const chunk = stripped2.substring(nl + 1, nl + 1 + len);
                            try {
                                const mParsed = JSON.parse(chunk);
                                for (const item of (mParsed || [])) {
                                    if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === 'maseQ' && item[2]) {
                                        const uuidMatch = item[2].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                                        if (uuidMatch) return uuidMatch[0];
                                    }
                                }
                            } catch (_) {
                                const cm = chunk.match(/"wrb\.fr","maseQ","((?:[^"\\]|\\.)*)"/);
                                if (cm) {
                                    try {
                                        const s = JSON.parse('"' + cm[1] + '"');
                                        const uuidMatch = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                                        if (uuidMatch) return uuidMatch[0];
                                    } catch(__) {}
                                }
                            }
                            mPos = nl + 1 + len;
                        }
                        const mFallback = respText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                        return mFallback ? mFallback[0] : null;
                    };

                    const imagesData = p.ingredientImagesData || [];
                    const imageUUIDs = [];
                    for (let iIdx = 0; iIdx < imagesData.length; iIdx++) {
                        const { base64: imgBase64, filename: imgFilename } = imagesData[iIdx];
                        const mUUID1 = crypto.randomUUID().toUpperCase();
                        const mUUID2 = crypto.randomUUID().toUpperCase();
                        const refExt = imgFilename.split('.').pop().toLowerCase();
                        const refMime = refExt === 'png' ? 'image/png' : refExt === 'webp' ? 'image/webp' : 'image/jpeg';
                        const maseInner = [aspectRow, imgBase64, refMime, 1,
                            null, null, null, null, imgFilename, null, mUUID1, mUUID2];
                        const maseFreq = JSON.stringify([[['maseQ', JSON.stringify(maseInner), null, 'generic']]]);
                        const maseRespText = await fetch(`${BASE}?${mkParams('maseQ')}`, {
                            method: 'POST', credentials: 'include', headers: mkHeaders(),
                            body: `f.req=${encodeURIComponent(maseFreq)}&at=${encodeURIComponent(at)}`
                        }).then(r => r.text()).catch(e => { console.error('[maseQ r2v] error', e); return ''; });
                        const uuid = parseMaseUUID(maseRespText);
                        if (!uuid) return { error: `maseQ r2v: ảnh ${iIdx + 1} không lấy được UUID. resp=${maseRespText.substring(0, 150)}` };
                        console.log(`[maseQ r2v] ảnh ${iIdx + 1}/${imagesData.length} UUID:`, uuid);
                        imageUUIDs.push(uuid);
                    }
                    if (imageUUIDs.length === 0) return { error: 'maseQ r2v: không có UUID nào' };

                    // MZZa6b — Ingredients r2v (confirmed from F12):
                    // task[1] = [[null, uuid1], [null, uuid2], ...] — all ingredient images
                    // task[2] = modelCode, task[3] = aspectCode, task[7] = [[voiceId]] when voice set
                    // voiceId must be lowercase (confirmed from F12: "achernar" not "Achernar")
                    const task = [
                        [null, null, [[[p.prompt]]]],
                        imageUUIDs.map(u => [null, u]),
                        p.modelCode,
                        p.aspectCode,
                        null,
                        [null, null, null, null, uuid1, uuid2],
                        null,
                        p.voiceId ? [[p.voiceId.toLowerCase()]] : null
                    ];
                    const inner = [[task], aspectRow, [uuid3, 2]];
                    const mzzFreq = JSON.stringify([[['MZZa6b', JSON.stringify(inner), null, 'generic']]]);
                    const mzzRes = await fetch(`${BASE}?${mkParams('MZZa6b')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(mzzFreq)}&at=${encodeURIComponent(at)}`
                    });
                    const mzzBody = await mzzRes.text();
                    if (!mzzRes.ok) return { error: `MZZa6b HTTP ${mzzRes.status}: ${mzzBody.substring(0, 300)}` };

                    const mzzData = parseBatch(mzzBody, 'MZZa6b');
                    if (!mzzData) return { error: `MZZa6b no data. body=${mzzBody.substring(0, 300)}` };

                    let operationId = null;
                    let workflowId = null;
                    let _allUuids = [];
                    try {
                        const parsed = typeof mzzData === 'string' ? JSON.parse(mzzData) : mzzData;
                        const str = JSON.stringify(parsed);
                        // Lấy TẤT CẢ UUID từ response để tìm workflowId
                        const allUuids = [...str.matchAll(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi)].map(m => m[1]);
                        _allUuids = allUuids.map(u => u.substring(0, 8));
                        operationId = allUuids[0] || null;
                        // workflowId = UUID đầu tiên không phải operationId và không phải projectId
                        workflowId = allUuids.find(u => u !== operationId && u !== p.projectId) || null;
                        if (!operationId) {
                            const longM = str.match(/"([A-Za-z0-9_\-]{20,})"/);
                            if (longM) operationId = longM[1];
                        }
                        if (!operationId && Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].length > 8) {
                            operationId = parsed[0];
                        }
                    } catch(e) {}
                    if (!operationId) return { error: `MZZa6b: không tìm thấy operationId. data=${JSON.stringify(mzzData).substring(0, 200)}` };

                    return { operationId, workflowId, at, _allUuids };
                } catch (e) { return { error: e.message }; }
            },
            args: [genParams]
        });

        const res = result?.[0]?.result;
        if (res?.error) {
            console.log('❌ Flow R2V gen lỗi:', res.error);
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: res.error }) });
        } else if (res?.operationId) {
            const _opId = res.operationId;
            console.log(`✅ MZZa6b OK, opId:${_opId.substring(0,8)}, wid:${res.workflowId?.substring(0,8)||'null'}, allUuids:[${res._allUuids?.join(',')||''}]`);
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: _opId, at: res.at }) });
            // Thêm vào shared poller (không tạo IIFE riêng nữa)
            _pendingR2V.set(_opId, {
                pid: genParams.projectId,
                bl: genParams.bl || '',
                fsid: genParams.fsid || '',
                at: res.at,
                wid: res.workflowId || null,
                genStartTs: Date.now(),
                tabId: tab.id,
                startTime: Date.now()
            });
            ensureR2VPoller();
        } else {
            await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_RESULT' }) });
        }
    } catch (e) {
        console.log('Lỗi executeFlowR2VGen:', e.message);
        await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) }).catch(() => {});
    } finally {
        isGeneratingFlowR2V = false;
    }
}

// TẢI URL QUA CHROME MAIN WORLD (để bypass hạn chế network của Electron)
let isFetchingUrl = false;
async function fetchUrlViaChrome(url) {
    if (isFetchingUrl) return;
    isFetchingUrl = true;
    try {
        let tab = await findActiveTab();
        if (!tab) {
            await fetch('http://127.0.0.1:3000/api/save-fetch-result', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'NO_TAB' })
            }).catch(() => {});
            return;
        }
        console.log(`📥 Tải URL qua MAIN world: ${url.substring(0, 80)}...`);
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (fetchUrl) => {
                try {
                    const res = await fetch(fetchUrl, { credentials: 'include' });
                    if (!res.ok) return { error: `HTTP ${res.status}` };
                    const blob = await res.blob();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({
                            base64: reader.result.split(',')[1],
                            mimeType: blob.type
                        });
                        reader.onerror = () => resolve({ error: 'FileReader error' });
                        reader.readAsDataURL(blob);
                    });
                } catch (e) { return { error: e.message }; }
            },
            args: [url]
        });
        const data = result?.[0]?.result;
        if (data?.base64) {
            console.log(`✅ Extension tải URL OK (${Math.round(data.base64.length * 0.75 / 1024)}KB)`);
        } else {
            console.log('❌ Extension tải URL thất bại:', data?.error);
        }
        await fetch('http://127.0.0.1:3000/api/save-fetch-result', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || { error: 'NO_RESULT' })
        });
    } catch (e) {
        console.log('Lỗi fetchUrlViaChrome:', e.message);
        await fetch('http://127.0.0.1:3000/api/save-fetch-result', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: e.message })
        }).catch(() => {});
    } finally {
        isFetchingUrl = false;
    }
}

// UPLOAD ẢNH QUA MAIN WORLD của tab labs.google
let isUploading = false;
async function uploadImageViaPage() {
    if (isUploading) return;
    isUploading = true;
    try {
        let tab = await findActiveTab();
        if (!tab) {
            console.log('❌ Không tìm thấy tab labs.google để upload ảnh');
            await fetch('http://127.0.0.1:3000/api/save-media-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: 'FAILED' }) }).catch(() => {});
            return;
        }

        const dataRes = await fetch('http://127.0.0.1:3000/api/get-upload-image-data');
        if (!dataRes.ok) { console.log('❌ Không lấy được image data'); return; }
        const { base64, projectId, bearerToken } = await dataRes.json();
        if (!base64 || !projectId) { console.log('❌ Thiếu base64 hoặc projectId'); return; }

        console.log(`🖼️ Upload ảnh qua MAIN world (${Math.round(base64.length / 1024)}KB)...`);

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (imageBase64, pid, bearer) => {
                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
                    const res = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/uploadImage', {
                        method: 'POST',
                        credentials: 'include',
                        headers: headers,
                        body: JSON.stringify({
                            clientContext: { projectId: pid, tool: 'PINHOLE' },
                            imageBytes: imageBase64
                        })
                    });
                    if (!res.ok) {
                        const errText = await res.text().catch(() => '');
                        return { error: `HTTP ${res.status}: ${errText.substring(0, 200)}` };
                    }
                    const data = await res.json();
                    return { mediaId: data?.media?.name || null, mediaDebug: JSON.stringify(data?.media || {}).substring(0, 300) };
                } catch (e) { return { error: e.message }; }
            },
            args: [base64, projectId, bearerToken || null]
        });

        const resultData = result?.[0]?.result;
        const mediaId = resultData?.mediaId || null;
        if (resultData?.error) {
            console.log('❌ Upload MAIN world lỗi:', resultData.error);
        } else if (mediaId) {
            console.log('✅ Upload ảnh MAIN world OK:', mediaId, '| media obj:', resultData.mediaDebug);
        }
        await fetch('http://127.0.0.1:3000/api/save-media-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaId: mediaId || 'FAILED', mediaDebug: resultData?.mediaDebug || '' })
        });
    } catch (e) {
        console.log('Lỗi uploadImageViaPage:', e.message);
        await fetch('http://127.0.0.1:3000/api/save-media-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: 'FAILED' }) }).catch(() => {});
    } finally {
        isUploading = false;
    }
}

// THỰC THI VIDEO GEN QUA MAIN WORLD
let isGeneratingVideo = false;
async function executeVideoGen() {
    if (isGeneratingVideo) return;
    isGeneratingVideo = true;
    try {
        let tab = await findActiveTab();
        if (!tab) {
            console.log('❌ Không tìm thấy tab labs.google để gọi video gen');
            await fetch('http://127.0.0.1:3000/api/save-video-gen-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_TAB' }) }).catch(() => {});
            return;
        }

        const dataRes = await fetch('http://127.0.0.1:3000/api/get-pending-video-gen');
        if (!dataRes.ok) { console.log('❌ Không lấy được video gen data'); return; }
        const { url, payload, bearerToken } = await dataRes.json();
        if (!url || !payload) { console.log('❌ Thiếu url hoặc payload'); return; }

        console.log(`🎬 Gọi video gen qua MAIN world: ${url.substring(url.lastIndexOf('/') + 1)}...`);

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (apiUrl, apiPayload, bearer) => {
                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
                    const res = await fetch(apiUrl, {
                        method: 'POST',
                        credentials: 'include',
                        headers: headers,
                        body: JSON.stringify(apiPayload)
                    });
                    const text = await res.text();
                    if (!res.ok) return { error: `HTTP ${res.status}: ${text.substring(0, 300)}` };
                    try { return { data: JSON.parse(text) }; } catch(e) { return { error: 'JSON parse fail: ' + text.substring(0, 200) }; }
                } catch (e) { return { error: e.message }; }
            },
            args: [url, payload, bearerToken || null]
        });

        const resultData = result?.[0]?.result;
        if (resultData?.error) {
            console.log('❌ Video gen MAIN world lỗi:', resultData.error);
            await fetch('http://127.0.0.1:3000/api/save-video-gen-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: resultData.error }) });
        } else if (resultData?.data) {
            console.log('✅ Video gen MAIN world OK');
            await fetch('http://127.0.0.1:3000/api/save-video-gen-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: resultData.data }) });
        } else {
            await fetch('http://127.0.0.1:3000/api/save-video-gen-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NO_RESULT' }) });
        }
    } catch (e) {
        console.log('Lỗi executeVideoGen:', e.message);
        await fetch('http://127.0.0.1:3000/api/save-video-gen-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) }).catch(() => {});
    } finally {
        isGeneratingVideo = false;
    }
}

// TẢI VIDEO 1080P QUA CHROME.DOWNLOADS (Chrome native — xử lý flow-content.google đúng cách)
// Electron net.fetch không decode được binary protocol 2PINHOLE của flow-content.google CDN.
// chrome.downloads.download() dùng Chrome download stack đầy đủ → tải video thành công.
let isDownloadingVideo = false;
async function downloadVideoViaChrome(mediaName) {
    if (isDownloadingVideo) return;
    isDownloadingVideo = true;
    console.log(`📥 Bắt đầu tải video 1080p qua chrome.downloads: ${mediaName}`);
    try {
        // Dùng URL tRPC trực tiếp — chrome.downloads sẽ follow 307 redirect và xử lý flow-content.google
        const tRPCUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
        const filename = `veo_1080p_${Date.now()}.mp4`;

        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: tRPCUrl,
                filename: filename,
                saveAs: false,
                conflictAction: 'uniquify'
            }, (id) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(id);
                }
            });
        });

        console.log(`⬇️ Download ID: ${downloadId}, chờ hoàn thành...`);

        // Chờ download hoàn thành (tối đa 5 phút)
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                chrome.downloads.onChanged.removeListener(listener);
                reject(new Error('chrome.downloads timeout sau 300s'));
            }, 300000);

            function listener(delta) {
                if (delta.id !== downloadId) return;
                if (delta.state?.current === 'complete') {
                    clearTimeout(timer);
                    chrome.downloads.onChanged.removeListener(listener);
                    resolve();
                } else if (delta.state?.current === 'interrupted') {
                    clearTimeout(timer);
                    chrome.downloads.onChanged.removeListener(listener);
                    const errReason = delta.error?.current || 'INTERRUPTED';
                    reject(new Error(`Download bị gián đoạn: ${errReason}`));
                }
            }
            chrome.downloads.onChanged.addListener(listener);
        });

        // Lấy đường dẫn file đã tải
        const items = await new Promise(resolve => chrome.downloads.search({ id: downloadId }, resolve));
        const filePath = items?.[0]?.filename;

        if (!filePath) {
            throw new Error('Không lấy được đường dẫn file sau khi tải');
        }

        console.log(`✅ chrome.downloads hoàn thành: ${filePath}`);
        await fetch('http://127.0.0.1:3000/api/save-video-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        }).catch(() => {});

    } catch (e) {
        console.log('❌ Lỗi downloadVideoViaChrome:', e.message);
        await fetch('http://127.0.0.1:3000/api/video-download-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: e.message })
        }).catch(() => {});
    } finally {
        isDownloadingVideo = false;
    }
}

// RESOLVE VIDEO URL: Extension service worker có <all_urls> permission → bypass CORS → follow redirect tự do
// Service worker gọi với credentials:include để gửi cookie labs.google → nhận 307 → lấy signed URL
let isResolvingMedia = false;
async function resolveMediaUrl(mediaName) {
    if (isResolvingMedia) return;
    isResolvingMedia = true;
    try {
        const targetUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
        const res = await fetch(targetUrl, { redirect: 'follow', credentials: 'include' });
        const finalUrl = res.url;
        if (finalUrl && finalUrl !== targetUrl) {
            await fetch('http://127.0.0.1:3000/api/save-media-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: finalUrl })
            });
            console.log('✅ Resolve video URL OK:', finalUrl.substring(0, 100));
        } else {
            console.log('❌ Không redirect — status:', res.status, '| url:', finalUrl?.substring(0, 80));
        }
    } catch (e) {
        console.log('Lỗi resolve media URL:', e.message);
    } finally {
        isResolvingMedia = false;
    }
}

// SNIFFER: Bắt f.req + at= từ batchexecute — capture AT hợp lệ mà Angular đang dùng
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (!details.url.includes('flow.google.com') || !details.url.includes('batchexecute')) return;
        try {
            const rpcFromUrl = (details.url.match(/rpcids=([^&]+)/) || [])[1] || 'unknown';
            let freqStr = null;
            let atFromBody = null;
            const fd = details.requestBody?.formData;
            if (fd && fd['f.req']) {
                const arr = fd['f.req'];
                freqStr = Array.isArray(arr) ? arr[0] : arr;
                atFromBody = fd['at'] ? (Array.isArray(fd['at']) ? fd['at'][0] : fd['at']) : null;
            }
            if (!freqStr && details.requestBody?.raw?.length) {
                let fullBody = '';
                for (const r of details.requestBody.raw) {
                    fullBody += new TextDecoder().decode(new Uint8Array(r.bytes));
                }
                const mAt = fullBody.match(/(?:^|&)at=([^&]{20,60})/);
                if (mAt) atFromBody = decodeURIComponent(mAt[1]);
                const m = fullBody.match(/f\.req=([^&]{0,3000})/);
                if (m) freqStr = decodeURIComponent(m[1]);
            }

            // Lưu AT hợp lệ — CHỈ từ Angular's native calls, không từ RPCs của mình
            const ourOwnRpcs = ['as29s', 'ogiZ0b', 'nzlxg', 'YhhmEf', 'jwpduf', 'SPrCad'];
            const isOurRpc = ourOwnRpcs.some(r => rpcFromUrl.includes(r));
            if (!isOurRpc && atFromBody && atFromBody.startsWith('AIQ-') && atFromBody.length >= 30) {
                chrome.storage.local.get('lastGoodAt', (data) => {
                    if (!data.lastGoodAt || data.lastGoodAt !== atFromBody) {
                        console.log('[sniffer] Captured Angular native AT, len=', atFromBody.length, ' rpc=', rpcFromUrl);
                        chrome.storage.local.set({ lastGoodAt: atFromBody, lastGoodAtTs: Date.now(), lastGoodAtRpc: rpcFromUrl });
                    }
                });
            }

            if (!freqStr) return;
            if (freqStr.includes('ogiZ0b') || freqStr.includes('YhhmEf') || freqStr.includes('jwpduf') || freqStr.includes('SPrCad')) {
                const rpc = freqStr.includes('ogiZ0b') ? 'ogiZ0b' : freqStr.includes('YhhmEf') ? 'YhhmEf' : freqStr.includes('SPrCad') ? 'SPrCad' : 'jwpduf';
                const snippet = freqStr.substring(0, 5000);
                chrome.storage.local.set({ ['capturedFreq_' + rpc]: snippet, capturedFreqTs: Date.now() });
                fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rpc, freq: snippet, ts: Date.now() })
                }).catch(() => {});
            }
        } catch(e) {}
    },
    { urls: ['*://flow.google.com/*batchexecute*'] },
    ['requestBody']
);

// SNIFFER: Bắt Bearer token (labs.google) hoặc Cookie từ batchexecute (flow.google.com)
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const isAisandboxApi = details.url.includes("aisandbox-pa.googleapis.com");
        const isBatchexecute = details.url.includes("flow.google.com") && details.url.includes("batchexecute");
        const isLabsGoogle = details.url.includes("labs.google") || details.url.includes("googleapis.com");
        if (!isLabsGoogle && !isBatchexecute) return;

        if (!isAisandboxApi && !isBatchexecute && Date.now() - lastSentTime < 3000) return;

        const auth = details.requestHeaders.find(h => h.name.toLowerCase() === 'authorization');
        // Bearer token (labs.google / googleapis.com)
        if (auth && auth.value.includes("Bearer")) {
            const bearer = auth.value.replace("Bearer ", "");
            if (bearer.length > 50) {
                lastSentTime = Date.now();
                chrome.cookies.getAll({ url: "https://labs.google" }, (labsCookies) => {
                    const labsCookieStr = (labsCookies || []).map(c => `${c.name}=${c.value}`).join('; ');
                    if (labsCookieStr) {
                        sendToServer({ bearerToken: bearer, cookie: labsCookieStr, userAgent: navigator.userAgent, headers: details.requestHeaders });
                    } else {
                        chrome.cookies.getAll({ url: "https://flow.google.com" }, (flowCookies) => {
                            const flowCookieStr = (flowCookies || []).map(c => `${c.name}=${c.value}`).join('; ');
                            sendToServer({ bearerToken: bearer, cookie: flowCookieStr, userAgent: navigator.userAgent, headers: details.requestHeaders });
                        });
                    }
                });
            }
        }

        // Cookie-based auth từ batchexecute (flow.google.com) — gửi cookie ngay qua webRequest
        if (isBatchexecute && Date.now() - lastSentTime > 5000) {
            const cookieHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
            if (cookieHeader && cookieHeader.value.length > 30) {
                lastSentTime = Date.now();
                const cookieStr = cookieHeader.value;
                const sapisidMatch = cookieStr.match(/SAPISID=([^;]+)/);
                const sapisid = sapisidMatch ? sapisidMatch[1].trim() : '';
                // Gửi cookie ngay — AT token sẽ đến sau qua FLOW_AUTH_FOUND
                sendToServer({ cookie: cookieStr, sapisid, atToken: 'cookie_captured' });
                console.log(`✅ [Sniffer] batchexecute cookie captured — len=${cookieStr.length} sapisid=${sapisid.substring(0,10)}...`);
            }
        }
    },
    { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]
);

// LẤY MÃ RECAPTCHA — dùng window.grecaptcha.enterprise trực tiếp qua Extension
async function fetchRecaptcha(action) {
    let tab = await findActiveTab();
    if (!tab) return;
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: (key, rcAction) => {
                return new Promise((resolve) => {
                    if (window.grecaptcha && window.grecaptcha.enterprise) {
                        window.grecaptcha.enterprise.execute(key, { action: rcAction })
                            .then(resolve).catch(() => resolve(null));
                    } else {
                        resolve(null);
                    }
                });
            },
            args: [SITE_KEY, action]
        });
        if (result[0] && result[0].result) {
            console.log(`✅ reCaptcha OK qua Extension (Action: ${action})`);
            sendToServer({ recaptchaToken: result[0].result, action });
        }
    } catch (e) {}
}

// Poll recaptcha request từ veo-engine (Node.js direct flow approach)
setInterval(async () => {
    try {
        const r = await fetch('http://127.0.0.1:3000/api/need-flow-recaptcha');
        if (!r.ok) return;
        const d = await r.json();
        if (d.needed) await fetchRecaptcha(d.action || 'IMAGE_GENERATION');
    } catch (_) {}
}, 1000);

// QUÉT PROJECT ID + COOKIE (mỗi 2s — gửi cả cookie để xác nhận kết nối)
setInterval(async () => {
    let tab = await findActiveTab();
    if (!tab) return;
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            if (window.location.href.includes("/project/")) {
                const match = window.location.href.match(/project\/([a-f0-9\-]{36})/);
                return match ? match[1] : null;
            }
            const links = document.querySelectorAll('a[href*="/project/"]');
            for (let link of links) {
                const match = link.getAttribute('href').match(/project\/([a-f0-9\-]{36})/);
                if (match) return match[1];
            }
            return null;
        }
    }).then(res => {
        if (res[0] && res[0].result) {
            const projectId = res[0].result;
            // Lấy cookie từ flow.google.com để xác nhận kết nối
            chrome.cookies.getAll({ url: 'https://flow.google.com' }, (cookies) => {
                const cookieStr = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
                const sapisid = cookies?.find(c => c.name === 'SAPISID')?.value || '';
                sendToServer({
                    projectId,
                    cookie: cookieStr || undefined,
                    sapisid: sapisid || undefined,
                    // Không gửi atToken ở đây để tránh overwrite AT token thật từ FLOW_AUTH_FOUND
                });
            });
        }
    }).catch(() => {});
}, 2000);

// NHẬN SỰ KIỆN TỪ CONTENT SCRIPT (Veo / flow.google.com)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAUS_FOUND" && message.data) {
        fetch("http://127.0.0.1:3000/api/save-caus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ causList: message.data })
        }).catch(() => {});
    }

    // Bearer token bắt từ MAIN world (labs.google fallback)
    if (message.type === "BEARER_FOUND" && message.data && message.data.length > 50) {
        const bearer = message.data;
        const tabUrl = sender?.url || '';
        const cookieUrl = tabUrl.includes('flow.google.com') ? 'https://flow.google.com' : 'https://labs.google';
        chrome.cookies.getAll({ url: cookieUrl }, (cookies) => {
            const cookieStr = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
            sendToServer({ bearerToken: bearer, cookie: cookieStr });
            console.log(`✅ Bearer token bắt từ MAIN world (${cookieUrl}) — ${bearer.substring(0, 20)}...`);
        });
    }

    // AT + BL token từ MAIN world (flow.google.com — cookie-based auth)
    if (message.type === "FLOW_AUTH_FOUND" && message.data?.at) {
        const { at, bl, fsid } = message.data;
        chrome.cookies.getAll({ url: 'https://flow.google.com' }, (cookies) => {
            const cookieStr = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
            const sapisid = cookies?.find(c => c.name === 'SAPISID')?.value || '';
            sendToServer({ atToken: at, bl: bl || '', fsid: fsid || '', cookie: cookieStr, sapisid });
            console.log(`✅ AT token — at=${at.substring(0, 20)}... bl=${bl.substring(0, 30)}... fsid=${fsid?.substring(0,15) || '?'}`);
        });
    }
});


// ══════════════════════════════════════════════════════════════════
// GROK.COM — Extension thay thế hoàn toàn Playwright Chrome ẩn
// Hỗ trợ: TEXT_TO_IMAGE | TEXT_TO_VIDEO | IMAGE_TO_VIDEO | REF_TO_VIDEO
// ══════════════════════════════════════════════════════════════════

// ── AUTO-RELOAD: tự reload extension khi background.js thay đổi ──────────────
let _knownExtVersion = null;
setInterval(async () => {
    try {
        const res  = await fetch("http://127.0.0.1:3000/grok/api/ext-version");
        const data = await res.json();
        if (_knownExtVersion === null) { _knownExtVersion = data.version; return; }
        if (data.version !== _knownExtVersion) {
            console.log("[Grok] Extension đã cập nhật — reload...");
            chrome.runtime.reload();
        }
    } catch (_) {}
}, 5000);

const GROK_UPDATE_TOKEN   = "http://127.0.0.1:3000/grok/update-token";
const GROK_CHECK_API      = "http://127.0.0.1:3000/grok/api/check-request";
const GROK_SAVE_RESULT    = "http://127.0.0.1:3000/grok/api/save-job-result";
const GROK_SAVE_ERROR     = "http://127.0.0.1:3000/grok/api/save-job-error";
const GROK_REGISTER_EXT   = "http://127.0.0.1:3000/grok/api/register-extension";
const GROK_ACCOUNT_STATUS = "http://127.0.0.1:3000/grok/api/account-status";

let grokLastTokenSent = 0;

// ── ACCOUNT IDENTITY ──────────────────────────────────────────────────────────
let myAccountIdx  = null;   // assigned by server after registration
let cooldownUntil = 0;      // timestamp — bỏ qua job nếu chưa hết cooldown

async function registerSelf() {
    try {
        let instanceId;
        try {
            const stored = await chrome.storage.local.get('fluxy_instance_id');
            instanceId = stored.fluxy_instance_id;
        } catch(_) {}
        if (!instanceId) {
            instanceId = crypto.randomUUID();
            chrome.storage.local.set({ fluxy_instance_id: instanceId }).catch(() => {});
        }
        const res  = await fetch(GROK_REGISTER_EXT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId })
        });
        const data = await res.json();
        myAccountIdx = data.accountIdx;
        console.log("[Grok] Đã đăng ký account #" + myAccountIdx + " (instanceId=" + instanceId.substring(0,8) + "...)");
        fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ step: "REGISTERED idx=" + myAccountIdx })
        }).catch(()=>{});
        // Hiện số tài khoản trên icon extension — user biết extension đang hoạt động
        chrome.action.setBadgeText({ text: "#" + myAccountIdx });
        chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
        chrome.action.setTitle({ title: "Fluxy - Tài khoản #" + myAccountIdx + " (Đang kết nối)" });
        // Heartbeat ngay sau đăng ký — xác nhận kết nối và cập nhật lastSeen
        fetch(GROK_CHECK_API + "?accountIdx=" + myAccountIdx + "&heartbeat=1").catch(() => {});
        // Sau khi đăng ký xong → poll job ngay (không chờ setInterval 2.5s)
        runPoller().catch(() => {});
    } catch (e) {
        console.warn("[Grok] register-extension thất bại:", e.message, "— thử lại sau 5s");
        fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ step: "REGISTER_FAIL err=" + e.message })
        }).catch(()=>{});
        chrome.action.setBadgeText({ text: "ERR" }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }).catch(() => {});
        setTimeout(registerSelf, 5000);
    }
}
registerSelf();

// ── KEEPALIVE: MV3 service worker bị Chrome tắt sau 30s idle ─────────────────
// chrome.alarms đảm bảo service worker được đánh thức lại mỗi 25s, duy trì setInterval
chrome.alarms.create('fluxy-keepalive', { periodInMinutes: 0.5 });  // 30 giây (minimum Chrome cho phép)

// Chrome API ping mỗi 20s — chrome.storage call giữ SW sống (fetch tới 127.0.0.1 không đủ)
setInterval(() => {
    chrome.storage.local.set({ '_sw_heartbeat': Date.now() }).catch(() => {});
    if (myAccountIdx !== null) {
        fetch(GROK_CHECK_API + "?accountIdx=" + myAccountIdx + "&heartbeat=1").catch(() => {});
    }
}, 20000);
// Alarm handler thống nhất (gộp keepalive + poller — tránh duplicate listener)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'fluxy-keepalive') return;
    // QUAN TRỌNG: return Promise để Chrome giữ SW sống cho đến khi Promise resolve
    // Nếu return undefined (synchronous), Chrome có thể kill SW ngay lập tức
    if (myAccountIdx === null) {
        // registerSelf → sau khi xong sẽ gọi runPoller() ngay (xem registerSelf())
        return registerSelf().catch(() => {});
    }
    // Heartbeat đồng thời
    fetch(GROK_CHECK_API + "?accountIdx=" + myAccountIdx + "&heartbeat=1").catch(() => {});
    // Poll job ngay sau khi wake-up — return Promise giữ SW sống
    return runPoller().catch(() => {});
});

// ── HEARTBEAT: ping server mỗi 15s để giữ lastSeen luôn tươi ─────────────────
setInterval(async () => {
    if (myAccountIdx === null) return;
    try {
        await fetch(GROK_CHECK_API + "?accountIdx=" + myAccountIdx + "&heartbeat=1");
    } catch (_) {}
}, 15000);

// ── SNIFFER: Bắt cookie & token từ grok.com ──────────────────────────────────
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (!details.url.includes("grok.com") && !details.url.includes("x.ai")) return;
        if (Date.now() - grokLastTokenSent < 10000) return;
        const headers = details.requestHeaders || [];
        const cookie = headers.find(h => h.name.toLowerCase() === "cookie")?.value || "";
        const csrf   = headers.find(h => h.name.toLowerCase() === "x-csrf-token")?.value || "";
        const auth   = headers.find(h => h.name.toLowerCase() === "authorization")?.value || "";
        if (cookie.length > 30) {
            grokLastTokenSent = Date.now();
            fetch(GROK_UPDATE_TOKEN, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cookie, csrfToken: csrf, authToken: auth, rawHeaders: headers, accountIdx: myAccountIdx })
            }).catch(() => {});
            console.log("[Grok] Token sniffed OK, cookie length:", cookie.length, "accountIdx:", myAccountIdx);
        }
    },
    { urls: ["*://grok.com/*", "*://*.x.ai/*"] },
    ["requestHeaders", "extraHeaders"]
);

// ── WORKER TAB POOL: mỗi slot có tab riêng để chạy song song ─────────────────
const workerTabPool = {};  // slotIdx → tabId

async function ensureWorkerTab(slotIdx) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Đóng tab cũ trong slot (nếu còn tồn tại) trước khi mở tab mới
    const oldTabId = workerTabPool[slotIdx];
    if (oldTabId !== undefined) {
        try {
            await chrome.tabs.remove(oldTabId);
        } catch (_) {}
        delete workerTabPool[slotIdx];
    }

    // Mở tab mới sạch
    console.log("[Grok Slot " + slotIdx + "] Mo tab moi grok.com/imagine...");
    let tab;
    try {
        tab = await chrome.tabs.create({ url: "https://grok.com/imagine", active: false });
    } catch (tabErr) {
        fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ step: "TAB_CREATE_FAIL slot=" + slotIdx, error: tabErr.message })
        }).catch(()=>{});
        throw tabErr;
    }
    fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ step: "TAB_CREATED slot=" + slotIdx + " tabId=" + tab.id })
    }).catch(()=>{});
    workerTabPool[slotIdx] = tab.id;

    // Hàm force navigate về /imagine + clear template state
    const forceBackToImagine = async () => {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN",
            func: () => {
                // Xóa state template trong localStorage/sessionStorage
                try {
                    const toRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && (k.toLowerCase().includes("template") || k.toLowerCase().includes("imagine"))) toRemove.push(k);
                    }
                    toRemove.forEach(k => localStorage.removeItem(k));
                } catch (_) {}
                try { sessionStorage.clear(); } catch (_) {}
                // Navigate về /imagine
                window.location.href = "https://grok.com/imagine";
            }
        }).catch(async () => {
            await chrome.tabs.update(tab.id, { url: "https://grok.com/imagine", active: false });
        });
    };

    // Hàm đóng dialog bằng nhiều cách (kể cả position-based)
    const closeAnyDialog = async () => {
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN",
            func: () => {
                // Kiểm tra có dialog/modal thực sự không trước khi làm gì
                const hasDialog = !!document.querySelector(
                    "[role='dialog'], [data-radix-dialog-content], [data-radix-alert-dialog-content], .modal, [class*='Modal']"
                );

                // Log tất cả buttons để debug
                const allBtns = Array.from(document.querySelectorAll("button, [role='button'], a[role='button']"));
                const visibleBtns = allBtns.filter(b => {
                    const r = b.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
                });
                const btnInfo = visibleBtns.slice(0, 12).map(b => ({
                    tag: b.tagName, text: (b.innerText||"").trim().substring(0,25),
                    aria: b.getAttribute("aria-label")||"",
                    top: Math.round(b.getBoundingClientRect().top),
                    right: Math.round(window.innerWidth - b.getBoundingClientRect().right),
                }));
                console.log("[Grok] hasDialog=" + hasDialog + " Buttons:", JSON.stringify(btnInfo));

                if (!hasDialog) return "no-dialog-visible";

                // Approach 1: Escape
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));

                // Approach 2: aria-label close variants
                const closeAttrs = ["Close", "close", "Đóng", "đóng", "Dismiss", "dismiss", "Cancel", "cancel", "×", "✕"];
                for (const attr of closeAttrs) {
                    const el = document.querySelector(`[aria-label='${attr}']`);
                    if (el) { el.click(); return "closed-by-aria:" + attr; }
                }

                // Approach 3: data attributes
                const dataAttrs = ["[data-radix-dialog-close]","[data-dialog-close]","[data-dismiss]","[data-close]"];
                for (const sel of dataAttrs) {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return "closed-by-data:" + sel; }
                }

                // Approach 4: Position-based — chỉ khi có dialog VÀ button ở góc trên-phải của DIALOG (không phải page header)
                // Tìm trong phạm vi dialog trước
                const dialogEl = document.querySelector("[role='dialog'],[data-radix-dialog-content]");
                if (dialogEl) {
                    const dialogBtns = Array.from(dialogEl.querySelectorAll("button,[role='button']")).filter(b => {
                        const r = b.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                    const closeInDialog = dialogBtns.find(b => {
                        const r = b.getBoundingClientRect();
                        const dr = dialogEl.getBoundingClientRect();
                        // Button ở góc trên-phải của dialog (không phải page)
                        return r.right > dr.right - 60 && r.top < dr.top + 60;
                    });
                    if (closeInDialog) {
                        closeInDialog.click();
                        return "closed-by-dialog-corner top=" + Math.round(closeInDialog.getBoundingClientRect().top);
                    }
                }

                // Approach 5: Click overlay/backdrop
                const backdrop = document.querySelector("[data-radix-dialog-overlay],[class*='overlay'],[class*='backdrop'],[class*='Overlay']");
                if (backdrop) { backdrop.click(); return "closed-by-backdrop"; }

                return "dialog-found-but-no-close-btn btns=" + visibleBtns.length;
            }
        }).catch(() => [{ result: "script-error" }]);
        const r = result?.[0]?.result || "";
        fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ step: "CLOSE_DIALOG: " + r })
        }).catch(()=>{});
        return r;
    };

    // Chờ trang load xong và không bị kẹt ở template
    let waited = 0;
    let redirectCount = 0;
    while (waited < 25000) {
        await sleep(1000); waited += 1000;
        try {
            const t = await chrome.tabs.get(tab.id);
            const url = t.url || "";
            if (t.status !== "complete") continue;
            if (!url.includes("grok.com")) continue;

            if (url.includes("/templates/") || url.includes("/template")) {
                redirectCount++;
                console.log("[Grok Slot " + slotIdx + "] Template URL (#" + redirectCount + "): " + url.substring(0, 80));
                fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
                    method:"POST", headers:{"Content-Type":"application/json"},
                    body: JSON.stringify({ step: "TEMPLATE_URL #" + redirectCount + " url=" + url.substring(0, 60) })
                }).catch(()=>{});
                // Lần 1: thử close dialog
                // Lần 2+: force navigate với clear localStorage
                if (redirectCount === 1) {
                    await closeAnyDialog();
                    await sleep(1500);
                } else {
                    await forceBackToImagine();
                    await sleep(3000);
                }
            } else if (url.endsWith("/imagine") || url.includes("/imagine?") || url.includes("/imagine#") || url.match(/\/imagine$/)) {
                // Đang ở /imagine — OK
                await closeAnyDialog();  // đóng bất kỳ modal nào còn lại
                await sleep(600);
                break;
            } else {
                // URL khác — navigate về /imagine
                await chrome.tabs.update(tab.id, { url: "https://grok.com/imagine", active: false });
                await sleep(2500);
            }
        } catch (_) { break; }
    }
    return await chrome.tabs.get(tab.id).catch(() => tab);
}

// ════════════════════════════════════════════════════════════════════════════
// [MODULE 1] TEXT TO IMAGE
// ════════════════════════════════════════════════════════════════════════════
async function grokTextToImage(tab, job) {
    const { jobId, prompt, aspectRatio, imageSpeed, imageQuality, imageCount } = job;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ping = (step) => fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ step: "IMG_" + step, jobId })
    }).catch(()=>{});

    ping("START tab=" + tab.id + " url=" + (tab.url||"?").substring(0,60));

    // Đóng mọi popup/modal đang mở (template upload dialog, cookie banner, v.v.)
    // Thử tối đa 3 lần, mỗi lần đợi 800ms
    for (let attempt = 0; attempt < 3; attempt++) {
        const currentTab = await chrome.tabs.get(tab.id).catch(() => null);
        if (currentTab && (currentTab.url||"").includes("/templates/")) {
            // Vẫn còn ở template URL — navigate về /imagine
            await chrome.tabs.update(tab.id, { url: "https://grok.com/imagine", active: false });
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN",
            func: async () => {
                const sleep = ms => new Promise(r => setTimeout(r, ms));
                // Nhấn Escape nhiều lần
                for (let i = 0; i < 3; i++) {
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
                    await sleep(150);
                }
                await sleep(300);
                // Click tất cả nút đóng dialog có thể có
                const closeSelectors = [
                    "button[aria-label='Close']", "button[aria-label='Đóng']",
                    "button[aria-label='close']", "button[aria-label='dismiss']",
                    "[data-radix-dialog-close]", "[data-dialog-close]",
                    "[role='dialog'] button[type='button']",
                    "button.close", ".modal-close",
                    "[role='dialog'] button:has(svg)",
                ];
                for (const sel of closeSelectors) {
                    try {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                el.click(); await sleep(100);
                            }
                        }
                    } catch (_) {}
                }
                // Kiểm tra còn dialog không
                const hasDialog = !!document.querySelector("[role='dialog'], .modal, [data-radix-dialog-content]");
                return hasDialog;
            }
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
    }

    // Snapshot lastSrc trước khi gen (như Playwright cũ)
    const snapR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: () => {
            // Snapshot TẤT CẢ img srcs hiện tại — dùng để tránh nhận nhầm ảnh cũ/placeholder
            const imgs = Array.from(document.querySelectorAll("img")).filter(i => i.clientWidth > 100);
            return { allSrcs: imgs.map(i => i.src), count: imgs.length };
        }
    }).catch(() => [{ result: { allSrcs: [], count: 0 } }]);
    const { allSrcs: beforeSrcs } = snapR[0]?.result || { allSrcs: [] };
    console.log("[Grok IMG] Snapshot imgs:", beforeSrcs.length, "srcs");

    // Click Hình ảnh + chọn tỉ lệ + tốc độ + chất lượng + số ảnh + gõ prompt + submit
    const trigR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async (promptText, ratioTarget, imageSpeed, imageQuality, imageCount) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const allBtns = () => Array.from(document.querySelectorAll("button,[role=button]"));
            const isVis = el => el.checkVisibility ? el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) : !!el.offsetParent;

            // 1. Click tab Hình ảnh
            const imgTab = allBtns().find(b => ["hình ảnh","image","images"].includes((b.innerText||"").trim().toLowerCase()));
            if (imgTab) { imgTab.click(); await sleep(1200); }

            // 2. Chọn tỉ lệ — hai cách: direct (inline buttons) hoặc dropdown
            let ratioDebug = "no-ratio";
            if (ratioTarget) {
                await sleep(400);
                const RATIOS = ["1:1","2:3","3:2","9:16","16:9"];

                // Helper: kiểm tra element có thực sự hiển thị không
                const isVisible = el => el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());

                // Cách 1: Direct click — chỉ tìm interactive elements ĐANG HIỆN (visible) ngoài menu
                const interactiveEls = Array.from(document.querySelectorAll(
                    "button, [role='button'], [role='radio'], [role='option'], [role='menuitem'], [role='tab']"
                ));
                const directMatches = interactiveEls.filter(el => {
                    const t = (el.innerText||el.textContent||"").trim();
                    return t.startsWith(ratioTarget)
                        && !el.closest("[role='menu']") && !el.closest("[role='listbox']") && !el.closest("[role='dialog']")
                        && isVisible(el);
                });

                if (directMatches.length > 0) {
                    directMatches[0].click();
                    await sleep(500);
                    ratioDebug = "direct→" + ratioTarget;
                } else {
                    // Cách 2: Dropdown — tìm toggle → click mở menu → click option
                    const toggle = Array.from(document.querySelectorAll("button, div[role='button'], [role='button']"))
                        .find(b => RATIOS.some(r => (b.innerText||b.textContent||"").trim().startsWith(r))
                                   && !b.closest("[role='menu']") && !b.closest(".menu") && isVisible(b));
                    if (toggle) {
                        const currentRatio = (toggle.innerText||toggle.textContent||"").trim();
                        if (currentRatio.startsWith(ratioTarget)) {
                            ratioDebug = "already-" + currentRatio;
                        } else {
                            toggle.click();
                            await sleep(900);

                            // Ưu tiên 1: tìm trong menu/listbox/popper container
                            const menuContainers = Array.from(document.querySelectorAll(
                                "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-floating-ui-portal], [data-headlessui-state], [data-state='open']"
                            ));
                            let found = null;
                            for (const scope of menuContainers) {
                                const items = Array.from(scope.querySelectorAll("*")).filter(el => {
                                    const t = (el.innerText||el.textContent||"").trim();
                                    return t.startsWith(ratioTarget) && isVisible(el);
                                });
                                if (items.length > 0) { found = items[0]; break; }
                            }
                            // Ưu tiên 2: bất kỳ element VISIBLE khớp text (loại toggle và ProseMirror)
                            if (!found) {
                                const anyVisible = Array.from(document.querySelectorAll("*")).filter(el => {
                                    const t = (el.innerText||el.textContent||"").trim();
                                    return t.startsWith(ratioTarget)
                                        && el !== toggle && !el.closest(".ProseMirror") && !el.closest("[contenteditable]")
                                        && isVisible(el);
                                });
                                if (anyVisible.length > 0) found = anyVisible[0];
                            }

                            if (found) {
                                found.click();
                                await sleep(500);
                                ratioDebug = "dropdown→" + ratioTarget;
                            } else {
                                document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                                ratioDebug = "option-not-found";
                            }
                        }
                    } else { ratioDebug = "toggle-not-found"; }
                }
            }

            // 2b. Chế độ tạo ảnh — tìm nút Tốc độ / Chất lượng
            // Tìm trong TẤT CẢ elements có text (không chỉ button) vì có thể là label/div/span
            {
                const speedMap = {
                    fast:    ["tốc độ", "speed", "fast", "nhanh"],
                    quality: ["chất lượng", "quality", "high quality", "hd"],
                };
                const targetSpeed = imageSpeed || "fast";
                const keywords = speedMap[targetSpeed] || speedMap.fast;

                // Log tất cả elements có text liên quan để debug
                const allInteractive = Array.from(document.querySelectorAll(
                    "button,[role=button],[role=radio],[role=tab],label,a"
                ));
                const visInteractive = allInteractive.filter(isVis);
                const allTexts = visInteractive.map(b => (b.innerText||"").trim().toLowerCase()).filter(t => t.length > 0 && t.length < 30);
                console.log("[Grok IMG] All interactive texts:", JSON.stringify(allTexts.slice(0, 20)));

                // Tìm button khớp keyword (dùng includes để linh hoạt)
                const modeBtn = visInteractive.find(b => {
                    const t = (b.innerText||"").trim().toLowerCase();
                    return keywords.some(k => t.includes(k)) && !b.closest(".ProseMirror") && !b.closest("[contenteditable]");
                });

                if (modeBtn) {
                    modeBtn.click();
                    await sleep(500);
                    console.log("[Grok IMG] Mode btn clicked:", (modeBtn.innerText||"").trim(), "for speed:", targetSpeed);
                } else {
                    console.log("[Grok IMG] Mode btn NOT FOUND for:", targetSpeed, "keywords:", keywords, "texts:", JSON.stringify(allTexts.slice(0, 15)));
                }
            }

            // 2d. Số ảnh
            if (imageCount && imageCount > 1) {
                const countBtn = allBtns().find(b => {
                    const t = (b.innerText||"").trim();
                    return (t === String(imageCount) || t === imageCount + " ảnh" || t === imageCount + " images") && isVis(b);
                });
                if (countBtn) { countBtn.click(); await sleep(400); }
            }

            // 3. Paste toàn bộ prompt 1 lần vào ProseMirror
            const editor = document.querySelector(".ProseMirror,[contenteditable=true]");
            if (!editor) return { ok: false, typed: "", ratioDebug };
            editor.focus(); await sleep(200);
            document.execCommand("selectAll");
            await sleep(80);
            document.execCommand("insertText", false, promptText);
            await sleep(300);
            let typed = editor.innerText?.trim() || "";

            // 4. Submit — click nút "Gửi", fallback Ctrl+Enter
            await sleep(300);
            const sendBtn = Array.from(document.querySelectorAll('button,[role=button]'))
                .find(b => {
                    const aria = (b.getAttribute('aria-label')||'').toLowerCase();
                    return (aria === 'gửi' || aria === 'send') && !b.disabled;
                });
            if (sendBtn) { sendBtn.click(); }
            else {
                editor.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,code:"Enter",ctrlKey:true,bubbles:true,cancelable:true}));
                await sleep(80);
                editor.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",keyCode:13,code:"Enter",ctrlKey:true,bubbles:true}));
            }
            await sleep(1000);
            return { ok: typed.length >= 1, typed: typed.substring(0,80), ratioDebug };
        },
        args: [prompt, aspectRatio || "", imageSpeed || "fast", null, imageCount || 1]
    }).catch(e => [{ result: { ok: false, typed: "", ratioDebug: e.message } }]);

    const trig = trigR[0]?.result || {};
    console.log("[Grok IMG] Trigger: ok=" + trig.ok + " typed=\"" + trig.typed + "\" ratio=" + trig.ratioDebug);
    ping("TRIGGER ok=" + trig.ok + " typed=" + (trig.typed||"").substring(0,20) + " ratio=" + trig.ratioDebug);
    if (!trig.ok || !trig.typed) throw new Error("Không gõ được prompt vào editor.");

    // Poll chờ generation xong (tối đa 3 phút)
    // Chờ tối thiểu 30s trước khi kiểm tra xong — grok cần ít nhất 15-25s để gen ảnh
    const deadline = Date.now() + 180000;
    const MIN_WAIT_MS = 30000;  // 30s minimum
    const triggerTime = Date.now();
    let attempt = 0;
    let everGenerating = false;
    while (Date.now() < deadline) {
        await sleep(4000); attempt++;
        const pollR = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN",
            func: (knownSrcs) => {
                const knownSet = new Set(knownSrcs);
                const allImgs = Array.from(document.querySelectorAll("img")).filter(i => i.clientWidth > 100 && i.complete && i.naturalWidth > 50);
                // Chỉ tìm ảnh MỚI (không có trong snapshot trước khi submit)
                const newImgs = allImgs.filter(i => !knownSet.has(i.src));
                const bodyTxt = (document.body.innerText||"").toLowerCase();
                const cancelBtnExists = !!document.querySelector(
                    "button[aria-label*='Hủy'],button[aria-label*='Cancel'],button[aria-label*='Stop'],button[aria-label*='Dừng'],button[aria-label*='stop'],button[aria-label*='cancel']"
                );
                const isGenerating = cancelBtnExists
                    || bodyTxt.includes("đang tạo")
                    || bodyTxt.includes("generating")
                    || bodyTxt.includes("creating")
                    || !!document.querySelector("[role='progressbar'],[class*='progress'],[class*='spinner']");
                const isModerated = bodyTxt.includes("content moderated") || bodyTxt.includes("try a different idea") || bodyTxt.includes("not able to");
                // Log tất cả ảnh mới (để debug URL pattern)
                const newImgDebug = newImgs.slice(0, 4).map(i => ({ w: i.naturalWidth, src: i.src.substring(0, 100) }));
                // Ảnh đủ chất lượng: naturalWidth >= 512 (ảnh thật grok gen ra)
                // Sau 90s fallback chấp nhận bất kỳ kích thước >= 100px
                const validNewImg = newImgs.find(i => i.naturalWidth >= 512);
                return {
                    hasNewImg: !!validNewImg,
                    isModerated, isGenerating,
                    totalImgs: allImgs.length,
                    newImgCount: newImgs.length,
                    newImgSrc: validNewImg ? validNewImg.src.substring(0, 100) : "",
                    newImgW: validNewImg ? validNewImg.naturalWidth : 0,
                    newImgDebug,
                };
            },
            args: [beforeSrcs]
        }).catch(() => [{ result: { hasNewImg: false, isModerated: false, isGenerating: false, totalImgs: 0, newImgCount: 0 } }]);
        const poll = pollR[0]?.result || {};
        if (poll.isGenerating) everGenerating = true;
        const elapsed = Date.now() - triggerTime;
        const canFinish = elapsed >= MIN_WAIT_MS;
        // Sau 90s fallback: chấp nhận bất kỳ ảnh mới nào (dù nhỏ)
        const fallbackOk = elapsed >= 90000 && poll.newImgCount > 0;
        const isFinished = canFinish && !poll.isGenerating && (poll.hasNewImg || fallbackOk);
        if (attempt % 2 === 0 || poll.isGenerating || isFinished || poll.newImgDebug?.length > 0) {
            console.log("[Grok IMG] Poll #" + attempt + " +" + Math.round(elapsed/1000) + "s: isGen=" + poll.isGenerating + " done=" + isFinished + " new=" + poll.newImgCount + "(w=" + poll.newImgW + ") imgs=" + JSON.stringify(poll.newImgDebug||[]));
            ping("POLL#" + attempt + " +t=" + Math.round(elapsed/1000) + "s gen=" + poll.isGenerating + " done=" + isFinished + " new=" + poll.newImgCount + " w=" + poll.newImgW + (poll.newImgDebug?.length ? " url=" + (poll.newImgDebug[0]?.src||"").substring(0,60) : ""));
        }
        if (poll.isModerated) throw new Error("Bị chặn: Vi phạm chính sách nội dung Grok.");
        if (isFinished) { console.log("[Grok IMG] Generation xong! Đang lấy ảnh..."); ping("DONE w=" + poll.newImgW); break; }
    }

    // Lấy ảnh — dùng beforeSrcs để tìm ảnh MỚI được tạo ra
    // Chờ thêm 8s để ảnh full-res load xong trên CDN
    await new Promise(r => setTimeout(r, 8000));
    const extractR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async (knownSrcs) => {
            try {
                const knownSet = new Set(knownSrcs);
                const allImgs = Array.from(document.querySelectorAll("img")).filter(img => img.clientWidth > 100);
                // Ưu tiên ảnh MỚI (không trong snapshot), rộng nhất
                const newImgs = allImgs.filter(i => !knownSet.has(i.src) && i.naturalWidth > 50);
                const imgs = newImgs.length > 0 ? newImgs : allImgs;
                if (imgs.length === 0) return { error: "no-imgs" };
                // Chọn ảnh rộng nhất (chất lượng cao nhất)
                imgs.sort((a, b) => (b.naturalWidth || 0) - (a.naturalWidth || 0));
                // Log tất cả ảnh mới để debug
                const imgDebug = imgs.slice(0, 5).map(i => ({ w: i.naturalWidth, src: i.src.substring(0, 120) }));
                const targetUrl = imgs[0].src;
                const bestW = imgs[0].naturalWidth;
                if (targetUrl.startsWith("data:image/")) {
                    const b64 = targetUrl.split(",")[1];
                    const ext = targetUrl.match(/data:image\/([a-zA-Z]+);/)?.[1] || "png";
                    return { b64, ext, bestW, imgDebug };
                }
                const res = await fetch(targetUrl);
                const blob = await res.blob();
                return await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({ b64: reader.result.split(",")[1], ext: "png", bestW, imgDebug });
                    reader.readAsDataURL(blob);
                });
            } catch(err) { return { error: err.message }; }
        },
        args: [beforeSrcs]
    }).catch(() => [{ result: { error: "script-error" } }]);

    const mediaData = extractR[0]?.result;
    ping("EXTRACT b64len=" + (mediaData?.b64?.length || 0) + " bestW=" + (mediaData?.bestW || 0) + " imgs=" + JSON.stringify(mediaData?.imgDebug || []));
    if (!mediaData || !mediaData.b64) throw new Error("Không thể trích xuất dữ liệu ảnh. err=" + (mediaData?.error || "unknown"));
    console.log("[Grok IMG] Lấy ảnh OK — ext=" + mediaData.ext + " w=" + mediaData.bestW + " b64 length=" + mediaData.b64.length + " imgDebug=" + JSON.stringify(mediaData.imgDebug || []));
    // Trả về dạng data:image/... để grok-api-engine.js xử lý nhất quán
    return { success: true, images: ["data:" + mediaData.ext + ";base64," + mediaData.b64], jobId, mediaType: "IMAGE" };
}

// ════════════════════════════════════════════════════════════════════════════
// [MODULE 2,3,4] VIDEO: TEXT_TO_VIDEO | IMAGE_TO_VIDEO | REF_TO_VIDEO
// ════════════════════════════════════════════════════════════════════════════
async function grokVideoJob(tab, job) {
    const { jobId, prompt, aspectRatio, duration, quality, mode, imageBase64, imagesBase64 } = job;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const modeUp = (mode || "TEXT_TO_VIDEO").toUpperCase().replace(/\s+/g, "_");
    const isI2V  = modeUp === "IMAGE_TO_VIDEO";
    const isR2V  = modeUp === "REF_TO_VIDEO";
    console.log("[Grok VID] " + modeUp + " | ratio=" + aspectRatio + " dur=" + duration + "s quality=" + quality);

    // 1. Click tab Video
    await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async () => {
            const btns = Array.from(document.querySelectorAll("button,[role=button]"));
            const vt = btns.find(b => (b.innerText||"").trim().toLowerCase() === "video");
            if (vt) { vt.click(); await new Promise(r=>setTimeout(r,2000)); }
        }
    }).catch(()=>{});
    await sleep(2000);

    // 2. Settings (TRICK 16:9 trước để unlock 10s, giống Playwright cũ)
    const setR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async (ar, dur, qual) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const allBtns = () => Array.from(document.querySelectorAll("button,[role=button]"));
            // pickRatio — copy logic Playwright: danh sách cố định + loại trừ menu + chỉ click nếu cần + .last()
            const RATIOS = ["1:1","2:3","3:2","9:16","16:9"];
            const isVis = el => el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());
            const pickRatio = async (target) => {
                const toggle = Array.from(document.querySelectorAll("button, div[role='button'], [role='button']"))
                    .find(b => RATIOS.some(r => (b.innerText||"").trim().startsWith(r))
                               && !b.closest("[role='menu']") && !b.closest(".menu") && isVis(b));
                if (!toggle) return "toggle-not-found";
                const cur = (toggle.innerText||"").trim();
                if (cur.startsWith(target)) return "already-" + cur;
                // Visibility diff: ghi nhận element ĐANG HIỆN TRƯỚC khi mở dropdown
                const beforeVisible = new Set(
                    Array.from(document.querySelectorAll("*")).filter(el => {
                        const t = (el.innerText||"").trim();
                        return t.startsWith(target) && t.length < 25 && isVis(el);
                    })
                );
                toggle.click();
                await sleep(900);
                // Ưu tiên 1: container dropdown (không dùng role=dialog tránh nhầm cookie popup)
                const menuContainers = Array.from(document.querySelectorAll(
                    "[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper], [data-floating-ui-portal], [data-headlessui-state], [data-state='open']"
                ));
                let found = null;
                for (const scope of menuContainers) {
                    const items = Array.from(scope.querySelectorAll("*")).filter(el => {
                        const t = (el.innerText||"").trim();
                        return t.startsWith(target) && t.length < 25 && isVis(el);
                    });
                    if (items.length > 0) { found = items[0]; break; }
                }
                // Ưu tiên 2: Visibility diff — element MỚI HIỆN sau khi dropdown mở
                if (!found) {
                    const newlyVisible = Array.from(document.querySelectorAll("*")).filter(el => {
                        const t = (el.innerText||"").trim();
                        return t.startsWith(target) && t.length < 25
                            && !beforeVisible.has(el) && isVis(el);
                    });
                    if (newlyVisible.length > 0) found = newlyVisible[0];
                }
                // Ưu tiên 3: bất kỳ element VISIBLE khớp text (loại toggle và ProseMirror)
                if (!found) {
                    const anyVisible = Array.from(document.querySelectorAll("*")).filter(el => {
                        const t = (el.innerText||"").trim();
                        return t.startsWith(target) && t.length < 25
                            && el !== toggle && !el.closest(".ProseMirror") && !el.closest("[contenteditable]")
                            && isVis(el);
                    });
                    if (anyVisible.length > 0) found = anyVisible[0];
                }
                if (found) { found.click(); await sleep(500); return "OK → " + target; }
                document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                return "option-not-found";
            };
            // TRICK: ép 16:9 để unlock nút 10s (giống Playwright cũ)
            await pickRatio("16:9"); await sleep(500);
            // Duration
            if (dur) { const d=allBtns().find(b=>(b.innerText||"").trim()===dur+"s"); if(d){d.click();await sleep(500);} }
            // Quality
            if (qual) { const q=allBtns().find(b=>(b.innerText||"").trim().toLowerCase()===qual.toLowerCase()); if(q){q.click();await sleep(500);} }
            // Đặt tỉ lệ thực (nếu khác 16:9)
            let rd = "kept-16:9";
            if (ar && ar !== "16:9") rd = await pickRatio(ar);
            return rd;
        },
        args: [aspectRatio || "16:9", parseInt(duration) || 5, quality || ""]
    }).catch(()=>[{result:"error"}]);
    console.log("[Grok VID] Settings:", setR[0]?.result);
    await sleep(500);

    // 3. Upload ảnh (IMAGE_TO_VIDEO / REF_TO_VIDEO)
    if ((isI2V || isR2V)) {
        const filesToUpload = isR2V ? (imagesBase64 || []) : (imageBase64 ? [imageBase64] : []);
        if (filesToUpload.length > 0) {
            const upR = await chrome.scripting.executeScript({
                target: { tabId: tab.id }, world: "MAIN",
                func: async (b64List) => {
                    const sleep = ms => new Promise(r => setTimeout(r, ms));
                    const files = b64List.map((b64, i) => {
                        const pts = b64.split(","); const mime = pts[0].match(/:(.*?);/)?.[1]||"image/jpeg";
                        const ext = mime.split("/")[1]||"jpg";
                        const bytes = Uint8Array.from(atob(pts[1]), c => c.charCodeAt(0));
                        return new File([bytes], "img_"+(i+1)+"."+ext, { type: mime });
                    });
                    // Tìm input[type=file] — grok có thể ẩn sau button upload
                    let inp = document.querySelector("input[type=file]");
                    if (!inp) {
                        // Thử click nút upload để lộ input
                        const upBtn = Array.from(document.querySelectorAll("button,[role=button],[data-testid]"))
                            .find(b => {
                                const t = (b.innerText||b.getAttribute("aria-label")||"").toLowerCase();
                                return t.includes("upload")||t.includes("image")||t.includes("ảnh")||t.includes("photo");
                            });
                        if (upBtn) { upBtn.click(); await sleep(1000); }
                        inp = document.querySelector("input[type=file]");
                    }
                    if (!inp) return { ok: false, reason: "No file input found" };
                    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
                    try { Object.defineProperty(inp, "files", { value: dt.files, configurable: true }); } catch(_) {}
                    inp.dispatchEvent(new Event("change",{bubbles:true}));
                    inp.dispatchEvent(new Event("input",{bubbles:true}));
                    await sleep(5000 + files.length * 2000);
                    return { ok: true, count: files.length };
                },
                args: [filesToUpload]
            }).catch(e=>[{result:{ok:false,reason:e.message}}]);
            const up = upR[0]?.result || {};
            console.log("[Grok VID] Upload: ok=" + up.ok + " count=" + up.count + " " + (up.reason||""));
            if (!up.ok) throw new Error("Lỗi upload ảnh: " + (up.reason || "unknown"));
            await sleep(3000);
        }
    }

    // 4. Gõ prompt + submit
    const pR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async (promptText, numRefImgs) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const editor = document.querySelector(".ProseMirror,[contenteditable=true]");
            if (!editor) return { ok: false };
            editor.focus(); await sleep(300);

            // Gõ từng ký tự để kích hoạt autocomplete của ProseMirror / React
            const typeChars = async (text, charDelay = 40) => {
                for (const ch of text) {
                    editor.dispatchEvent(new KeyboardEvent("keydown",{key:ch,bubbles:true,cancelable:true}));
                    document.execCommand("insertText", false, ch);
                    editor.dispatchEvent(new KeyboardEvent("keyup",{key:ch,bubbles:true}));
                    await sleep(charDelay);
                }
            };

            // REF tag — gõ @Image i từng ký tự → autocomplete mở → Enter chọn → Space xác nhận
            for (let i = 1; i <= numRefImgs; i++) {
                await typeChars("@Image " + i, 50);
                await sleep(800); // chờ dropdown autocomplete hiện
                editor.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,code:"Enter",bubbles:true,cancelable:true}));
                await sleep(400);
                document.execCommand("insertText", false, " ");
                await sleep(300);
            }

            // Paste toàn bộ prompt 1 lần
            document.execCommand("insertText", false, promptText);
            await sleep(300);
            let typed = editor.innerText?.trim() || "";

            // Submit — click nút "Gửi" (aria-label="Gửi" hoặc "Send"), fallback Ctrl+Enter
            await sleep(300);
            const sendBtn = Array.from(document.querySelectorAll('button,[role=button]'))
                .find(b => {
                    const aria = (b.getAttribute('aria-label')||'').toLowerCase();
                    return (aria === 'gửi' || aria === 'send') && !b.disabled;
                });
            if (sendBtn) {
                sendBtn.click();
            } else {
                // fallback: Ctrl+Enter
                editor.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",keyCode:13,code:"Enter",ctrlKey:true,bubbles:true,cancelable:true}));
                await sleep(80);
                editor.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",keyCode:13,code:"Enter",ctrlKey:true,bubbles:true}));
            }
            await sleep(1000);
            return { ok: typed.length >= 1, typed: typed.substring(0,80) };
        },
        args: [prompt || "", isR2V ? (imagesBase64||[]).length : 0]
    }).catch(e=>[{result:{ok:false}}]);
    const pr = pR[0]?.result || {};
    console.log("[Grok VID] Prompt: ok=" + pr.ok + " typed=\"" + pr.typed + "\"");
    if (!pr.ok) throw new Error("Không gõ được prompt vào editor (video).");

    // 5. Poll chờ video xuất hiện (tối đa 35 phút)
    const deadline = Date.now() + 2100000;
    let attempt = 0;
    while (Date.now() < deadline) {
        await sleep(15000); attempt++;
        const pollR = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: "MAIN",
            func: () => {
                const txt = (document.body.innerText||"").replace(/\s+/g," ");
                let pct = 10;
                const m = txt.match(/(?:Đang tạo|Generating)[^\d]*(\d{1,3})\s*%/i)||txt.match(/(\d{1,3})\s*%/g);
                if (m) pct = Array.isArray(m) ? parseInt(m[m.length-1]) : parseInt(m[1]);
                const isGen = txt.includes("Đang tạo")||txt.toLowerCase().includes("generating")||txt.includes("Hủy");
                const hasAB = txt.includes("Bạn thích")||txt.includes("Bỏ qua");
                const isMod = txt.toLowerCase().includes("content moderated")||txt.toLowerCase().includes("try a different idea");
                const vids = document.querySelectorAll("video");
                let hasVid = false; for(const v of vids){if(v.src||v.currentSrc||v.querySelector("source")?.src){hasVid=true;break;}}
                return { pct, isGenerating:isGen, isFinished:hasAB||(hasVid&&(!isGen||pct===100)), isModerated:isMod };
            }
        }).catch(()=>[{result:{pct:10,isGenerating:false,isFinished:false,isModerated:false}}]);
        const poll = pollR[0]?.result || {};
        if (attempt % 3 === 0) console.log("[Grok VID] Poll #" + attempt + ": pct=" + poll.pct + "% gen=" + poll.isGenerating + " done=" + poll.isFinished);
        if (poll.isModerated) throw new Error("Bị chặn: Vi phạm chính sách nội dung Grok.");
        if (poll.isFinished) { console.log("[Grok VID] Video xong!"); break; }
    }

    // 6. Click Bỏ qua (A/B test)
    await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async () => {
            await new Promise(r=>setTimeout(r,2000));
            const skip = Array.from(document.querySelectorAll("button")).find(b=>(b.innerText||"").toLowerCase().includes("bỏ qua"));
            if (skip) { skip.click(); await new Promise(r=>setTimeout(r,2000)); }
        }
    }).catch(()=>{});
    await new Promise(r=>setTimeout(r,2000));

    // 7. Fetch video blob → base64 trong page context
    const vidR = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: async () => {
            const vids = Array.from(document.querySelectorAll("video"));
            if (vids.length === 0) return null;
            const vid = vids[vids.length - 1];
            const url = vid.src || vid.currentSrc || vid.querySelector("source")?.src;
            if (!url || (!url.startsWith("blob:") && !url.startsWith("http"))) return null;
            const res = await fetch(url);
            const blob = await res.blob();
            return await new Promise(r => { const rd=new FileReader(); rd.onloadend=()=>r(rd.result); rd.readAsDataURL(blob); });
        }
    }).catch(()=>[{result:null}]);

    const videoB64 = vidR[0]?.result;
    if (!videoB64) throw new Error("Không lấy được video từ trang.");
    console.log("[Grok VID] Video size: " + Math.round(videoB64.length/1024) + "KB");
    return { success: true, video: videoB64, jobId, mediaType: "VIDEO" };
}

// ════════════════════════════════════════════════════════════════════════════
// JOB EXECUTOR CHÍNH — hỗ trợ N worker song song
// ════════════════════════════════════════════════════════════════════════════
const workerSlots   = new Set();   // các slot đang chạy
let   workerMaxCount = 5;          // mặc định 5 tab song song (server có thể giảm theo queue size)

async function executeGrokJob(job, slotIdx) {
    const mode = (job.mode || "TEXT_TO_IMAGE").toUpperCase().replace(/\s+/g, "_");
    console.log("[Grok Slot " + slotIdx + "] Job #" + job.jobId + " | mode=" + mode + " | ratio=" + job.aspectRatio + " | \"" + (job.prompt||"").substring(0,40) + "\"");
    fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ step: "EXECUTE_JOB slot=" + slotIdx + " mode=" + mode, jobId: job.jobId })
    }).catch(()=>{});
    const tab = await ensureWorkerTab(slotIdx);
    if (mode.includes("VIDEO")) return await grokVideoJob(tab, job);
    return await grokTextToImage(tab, job);
}

function getFreeSlot(maxW) {
    for (let i = 0; i < maxW; i++) {
        if (!workerSlots.has(i)) return i;
    }
    return -1;
}

// ── POLLER: mỗi 2.5s — khởi chạy tất cả slot trống ngay khi có job ──────────
// NOTE: setInterval hoạt động khi SW đang sống, alarm đảm bảo SW được đánh thức lại
async function runPoller() {
    // Chưa đăng ký account hoặc đang trong cooldown → không nhận job
    if (myAccountIdx === null) return;
    if (Date.now() < cooldownUntil) return;

    const maxW = workerMaxCount;
    while (workerSlots.size < maxW) {
        const slot = getFreeSlot(maxW);
        if (slot === -1) break;

        workerSlots.add(slot);

        (async () => {
            try {
                const url  = GROK_CHECK_API + "?accountIdx=" + myAccountIdx;
                const res  = await fetch(url);
                if (!res.ok) { workerSlots.delete(slot); return; }
                const data = await res.json();
                if (_pollerTick % 20 === 0 || data.job) {
                    fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ step: "CHECK_RESP slot=" + slot + " job=" + (data.job ? data.job.jobId : "null") + " conc=" + (data.concurrency || "?") })
                    }).catch(() => {});
                }
                if (!data.job) { workerSlots.delete(slot); return; }

                // Cập nhật concurrency từ server (= số prompt còn trong hàng đợi, tối đa 5)
                if (data.concurrency) workerMaxCount = Math.min(5, Math.max(1, parseInt(data.concurrency) || 1));
                else if (data.job.concurrency) workerMaxCount = Math.min(5, Math.max(1, parseInt(data.job.concurrency) || 1));
                console.log("[Grok #" + myAccountIdx + "] Slot " + slot + " nhận job:", data.job.jobId, "| workers:", workerMaxCount);
                fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
                    method:"POST", headers:{"Content-Type":"application/json"},
                    body: JSON.stringify({ step: "POLL_GOT_JOB slot=" + slot + " myIdx=" + myAccountIdx, jobId: data.job.jobId })
                }).catch(()=>{});
                // Badge xanh nhấp nháy — đang chạy
                chrome.action.setBadgeText({ text: "⏳" }).catch(() => {});
                chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" }).catch(() => {});

                executeGrokJob(data.job, slot)
                    .then(result => {
                        chrome.action.setBadgeText({ text: "OK" }).catch(() => {});
                        chrome.action.setBadgeBackgroundColor({ color: "#10b981" }).catch(() => {});
                        setTimeout(() => chrome.action.setBadgeText({ text: "#" + myAccountIdx }).catch(() => {}), 3000);
                        return fetch(GROK_SAVE_RESULT, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...result, accountIdx: myAccountIdx })
                        });
                    })
                    .catch(err => {
                        console.error("[Grok #" + myAccountIdx + " Slot " + slot + "] Lỗi:", err.message);
                        // Phát hiện hết quota → báo cooldown
                        const isQuota = /rate.?limit|too many|quota|limit reached|out of credit|daily limit|exhausted/i.test(err.message);
                        if (isQuota) {
                            const cooldownMs = 10 * 60 * 1000; // 10 phút
                            cooldownUntil = Date.now() + cooldownMs;
                            console.warn("[Grok #" + myAccountIdx + "] Hết quota! Cooldown 10 phút.");
                            fetch(GROK_ACCOUNT_STATUS, {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ accountIdx: myAccountIdx, cooldownMs })
                            }).catch(() => {});
                        }
                        return fetch(GROK_SAVE_ERROR, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                error: err.message,
                                jobId: data.job.jobId,
                                accountIdx: myAccountIdx,
                                isQuota: isQuota || false,
                                originalJob: isQuota ? data.job : undefined  // re-queue nếu hết quota
                            })
                        });
                    })
                    .finally(() => {
                        // Đóng tab sau khi job xong — tab sẽ được mở FRESH cho job tiếp theo
                        // (tránh snapshot lastSrc bị sai khi tab cũ còn ảnh/video của prompt trước)
                        if (workerTabPool[slot] !== undefined) {
                            chrome.tabs.remove(workerTabPool[slot]).catch(() => {});
                            delete workerTabPool[slot];
                        }
                        workerSlots.delete(slot);
                        // Poll ngay sau khi job xong — tránh Chrome kill SW trong khoảng chờ setInterval
                        runPoller().catch(() => {});
                    });
            } catch (e) { workerSlots.delete(slot); }
        })();
    }
}
let _pollerTick = 0;
setInterval(() => {
    _pollerTick++;
    // Tick đầu tiên — xác nhận setInterval đang chạy
    if (_pollerTick === 1 || _pollerTick % 10 === 0) {
        fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step: "TICK#" + _pollerTick + " slots=" + workerSlots.size + " acct=" + myAccountIdx })
        }).catch(() => {});
    }
    runPoller();
}, 2500);  // Fast polling khi SW đang sống (alarm giữ SW alive)

// Capture YhhmEf (video gen) and jwpduf (video poll) POST bodies for analysis
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.method !== 'POST') return;
        const isVideoGen = details.url.includes('YhhmEf');
        const isVideoPoll = details.url.includes('jwpduf');
        if (!isVideoGen && !isVideoPoll) return;
        const raw = details.requestBody && details.requestBody.raw;
        if (!raw || !raw.length) return;
        try {
            const bodyBytes = raw.map(r => new Uint8Array(r.bytes));
            let fullBody = '';
            bodyBytes.forEach(b => { fullBody += new TextDecoder().decode(b); });
            const freqMatch = fullBody.match(/f\.req=([^&]{0,5000})/);
            if (!freqMatch) return;
            const decoded = decodeURIComponent(freqMatch[1]);
            if (isVideoGen) {
                chrome.storage.local.set({ capturedVideoGenBody: decoded.substring(0, 3000) });
                console.log('[FLUXY] Captured YhhmEf (video gen) body:', decoded.substring(0, 200));
                fetch('http://127.0.0.1:3000/api/debug-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: 'YhhmEf', body: decoded.substring(0, 3000) }) }).catch(() => {});
            } else {
                chrome.storage.local.set({ capturedVideoPollBody: decoded.substring(0, 3000) });
                console.log('[FLUXY] Captured jwpduf (video poll) body:', decoded.substring(0, 200));
                fetch('http://127.0.0.1:3000/api/debug-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag: 'jwpduf', body: decoded.substring(0, 3000) }) }).catch(() => {});
            }
        } catch(e) { console.error('[FLUXY] video webRequest capture error:', e); }
    },
    { urls: ['https://flow.google.com/*'] },
    ['requestBody']
);

// TEMP: Capture ogiZ0b POST body to find Nano Banana 2 Lite model code
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.method !== 'POST') return;
        if (!details.url.includes('ogiZ0b')) return;
        const raw = details.requestBody && details.requestBody.raw;
        if (!raw || !raw.length) return;
        try {
            const bodyBytes = raw.map(r => new Uint8Array(r.bytes));
            let fullBody = '';
            bodyBytes.forEach(b => { fullBody += new TextDecoder().decode(b); });
            const freqMatch = fullBody.match(/f\.req=([^&]{0,3000})/);
            if (!freqMatch) return;
            const decoded = decodeURIComponent(freqMatch[1]);
            const modelMatch = decoded.match(/,3,"([A-Z_0-9]{2,30})"/);
            if (modelMatch) {
                const modelCode = modelMatch[1];
                chrome.storage.local.set({ capturedFlowModel: modelCode, capturedFlowBody: decoded.substring(0, 500) });
                console.log('[FLUXY] Captured Flow model code:', modelCode);
            }
        } catch(e) { console.error('[FLUXY] webRequest capture error:', e); }
    },
    { urls: ['https://flow.google.com/*'] },
    ['requestBody']
);
