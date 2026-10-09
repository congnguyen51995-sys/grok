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

// Export Google cookies ngay khi SW khởi động
setTimeout(() => exportGoogleCookiesToServer().catch(() => {}), 3000);

// Dùng 127.0.0.1 thay localhost để tránh Chrome resolve sang ::1 (IPv6) trên Windows
const SERVER_API = "http://127.0.0.1:3000/update-token";
const CHECK_API = "http://127.0.0.1:3000/api/check-request";
const SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

console.log("🚀 Fluxy Extension V3.19 - Image gen (ogiZ0b native format) + AT sniffer + Grok text-to-image");

// Export Google cookies → Electron server để Playwright dùng login flow.google.com
let _lastCookieExport = 0;
async function exportGoogleCookiesToServer() {
    const now = Date.now();
    if (now - _lastCookieExport < 60000) return; // rate-limit: export tối đa 1 lần/phút
    _lastCookieExport = now;
    try {
        const all = await chrome.cookies.getAll({});
        const google = all.filter(c => {
            const d = (c.domain || '').replace(/^\./, '');
            return d === 'google.com' || d.endsWith('.google.com') || d.endsWith('.google');
        });
        if (!google.length) return;
        await fetch('http://127.0.0.1:3000/api/save-flow-cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookies: google }),
        });
        console.log(`[CookieExport] ${google.length} Google cookies → server`);
    } catch (_) {}
}

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

// Tìm tab flow.google.com: ưu tiên project page (có recaptcha) > gallery > labs.google
async function findActiveTab() {
    let [tab] = await chrome.tabs.query({ url: "*://flow.google.com/project/*" });
    if (!tab) [tab] = await chrome.tabs.query({ url: "*://flow.google.com/*" });
    if (!tab) [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
    if (tab) console.log('[findTab] url=', tab.url?.substring(0, 60));
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

        if (data.needImageUpload) {
            uploadImageViaPage();
        }

        if (data.needFlowImageGen) {
            executeFlowImageGen();
        }

        if (data.fetchUrl) {
            fetchUrlViaChrome(data.fetchUrl);
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
        // Nếu chưa có, đợi tối đa 10s để Angular call batchexecute lần đầu
        const _readSnifferAt = async () => {
            const d = await chrome.storage.local.get(['lastGoodAt', 'lastGoodAtTs', 'flowAuth']);
            const lga = d.lastGoodAt;
            const lgt = d.lastGoodAtTs || 0;
            if (lga && lga.startsWith('AIQ-') && (Date.now() - lgt) < 1800000) return { at: lga, ts: lgt };
            // Fallback: flowAuth (từ FLOW_AUTH_FOUND message)
            const fa = d.flowAuth;
            if (fa?.at && fa.at.startsWith('AIQ-') && (Date.now() - (fa.ts || 0)) < 1800000) return { at: fa.at, ts: fa.ts || 0 };
            return null;
        };
        let snifferResult = await _readSnifferAt();
        if (!snifferResult) {
            console.log('[flow-img] No sniffer AT yet — polling up to 10s for Angular batchexecute...');
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 1000));
                snifferResult = await _readSnifferAt();
                if (snifferResult) { console.log('[flow-img] Got AT after', i+1, 's poll'); break; }
            }
        }
        if (snifferResult) {
            console.log('[flow-img] Using sniffer AT len=', snifferResult.at.length, ' age=', Math.round((Date.now() - snifferResult.ts) / 1000), 's');
            genParams.atToken = snifferResult.at;
        } else {
            console.log('[flow-img] Still no sniffer AT after 10s — will try WIZ/live in page');
        }

        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async (p) => {
                try {
                    const SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
                    const BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';
                    const projectId = p.projectId;

                    // ── Lấy AT / bl / fsid theo thứ tự ưu tiên ──────────────────
                    // 1. window.WIZ_global_data  — Google nhúng ngay khi trang load, luôn mới nhất
                    //    Scan TẤT CẢ values thay vì hardcode key (key name thay đổi theo version)
                    // 2. window._flowAuthData    — content_main.js capture từ batchexecute live
                    // 3. p.atToken / p.bl / p.fsid — từ FLOW_AUTH_FOUND (có thể stale)
                    // 4. Aggressive regex trong inline <script> tags — fallback cuối

                    const _scanWIZ = () => {
                        const wiz = window.WIZ_global_data || {};
                        let at = '', bl = '', fsid = '', hl = wiz['hl'] || '';
                        for (const [k, v] of Object.entries(wiz)) {
                            if (!at   && typeof v === 'string' && v.startsWith('AIQ-') && v.length > 30) at = v;
                            if (!bl   && typeof v === 'string' && v.startsWith('boq_') && v.length > 10) bl = v;
                            if (!fsid && typeof v === 'string' && /^-?\d{10,}$/.test(v)) fsid = v;
                        }
                        return { at, bl, fsid, hl };
                    };
                    let wizData = _scanWIZ();

                    const _getLive = () => ({
                        at:   (window._flowAuthData?.at || '').startsWith('AIQ-') ? window._flowAuthData.at   : '',
                        bl:   (window._flowAuthData?.bl || '').startsWith('boq_') ? window._flowAuthData.bl   : '',
                        fsid: window._flowAuthData?.fsid || '',
                        hl:   window._flowAuthData?.hl   || ''
                    });
                    let liveData = _getLive();

                    const _scanHtml = () => {
                        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
                        // Aggressive pattern — tìm AIQ- ở bất kỳ đâu trong script
                        const mAt   = scripts.match(/"(AIQ-[A-Za-z0-9_\-]{30,})"/);
                        const mBl   = scripts.match(/"(boq_[A-Za-z0-9_\-]{10,})"/);
                        const mFsid = scripts.match(/"(-?\d{10,})"/);
                        return { at: mAt?.[1] || '', bl: mBl?.[1] || '', fsid: mFsid?.[1] || '' };
                    };

                    // Bước 1: AT — nếu chưa có, đợi tối đa 8s để Angular khởi tạo
                    const cachedAt = (p.atToken && p.atToken.startsWith('AIQ-')) ? p.atToken : '';
                    let at = cachedAt || liveData.at || wizData.at;
                    if (!at) {
                        const htmlData = _scanHtml();
                        at = htmlData.at;
                        if (!at) {
                            // Đợi Angular gọi batchexecute lần đầu (populate _flowAuthData)
                            for (let i = 0; i < 4; i++) {
                                await new Promise(r => setTimeout(r, 2000));
                                liveData = _getLive();
                                wizData  = _scanWIZ();
                                at = liveData.at || wizData.at;
                                console.log('[flow-img] wait AT retry', i+1, ' live=', !!liveData.at, ' wiz=', !!wizData.at);
                                if (at) break;
                            }
                        }
                    }
                    const _dbg = {
                        url: window.location.href,
                        cachedAt: !!cachedAt, liveAt: !!liveData.at, wizAt: !!wizData.at,
                        wizKeys: Object.keys(window.WIZ_global_data || {}).length,
                        flowAuthData: !!window._flowAuthData,
                        scriptCount: document.querySelectorAll('script').length,
                        wizSample: Object.entries(window.WIZ_global_data || {}).slice(0,5).map(([k,v])=>`${k}:${String(v).substring(0,15)}`).join('|')
                    };
                    console.log('[flow-img] AT sources: cached=', !!cachedAt, ' live=', !!liveData.at, ' wiz=', !!wizData.at, ' → len=', at?.length || 0, ' dbg=', JSON.stringify(_dbg));
                    if (!at || !at.startsWith('AIQ-')) {
                        return { error: `NO_AT [${_dbg.url.substring(0,50)}] wizKeys=${_dbg.wizKeys} wizAT=${_dbg.wizAt} live=${_dbg.liveAt} wiz=${_dbg.wizSample}` };
                    }

                    // Bước 2: bl
                    const htmlFallback = _scanHtml();
                    let bl = '';
                    if      (p.bl             && p.bl.startsWith('boq_'))           bl = p.bl;
                    else if (liveData.bl      && liveData.bl.startsWith('boq_'))    bl = liveData.bl;
                    else if (wizData.bl       && wizData.bl.startsWith('boq_'))     bl = wizData.bl;
                    else if (htmlFallback.bl  && htmlFallback.bl.startsWith('boq_'))bl = htmlFallback.bl;

                    // Bước 3: fsid
                    let fsid = '';
                    if      (p.fsid           && p.fsid.length > 3)    fsid = p.fsid;
                    else if (liveData.fsid    && liveData.fsid.length > 3) fsid = liveData.fsid;
                    else if (wizData.fsid     && wizData.fsid.length > 3)  fsid = wizData.fsid;
                    else if (htmlFallback.fsid && htmlFallback.fsid.length > 3) fsid = htmlFallback.fsid;

                    const _pageHl = wizData.hl || liveData.hl || 'vi';
                    console.log('[flow-img] bl=', bl.substring(0,50), ' fsid=', fsid.substring(0,15), ' hl=', _pageHl);

                    const mkReqid = () => String(Math.floor(Math.random() * 9000000) + 1000000);
                    const mkParams = (rpcid) => {
                        const q = new URLSearchParams({ rpcids: rpcid, bl, hl: _pageHl, rt: 'c', 'source-path': `/project/${projectId}`, _reqid: mkReqid() });
                        if (fsid) q.set('f.sid', fsid);
                        return q.toString();
                    };
                    const mkHeaders = () => ({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1', 'origin': 'https://flow.google.com' });

                    // ogiZ0b — native Angular format, trả URL trực tiếp (không cần poll)
                    // rcToken: _ownFreshToken (pre-warmed) → _lastRcToken (Angular captured) → on-demand trigger
                    const _getToken = () => {
                        const ownTs = window._ownFreshTokenTs || 0;
                        if (window._ownFreshToken && window._ownFreshTokenAction === 'IMAGE_GENERATION' && (Date.now()-ownTs) < 90000) {
                            const t = window._ownFreshToken; window._ownFreshToken = null; return t;
                        }
                        const lastTs = window._lastRcTokenTs || 0;
                        if (window._lastRcToken && window._lastRcAction === 'IMAGE_GENERATION' && (Date.now()-lastTs) < 90000) {
                            const t = window._lastRcToken; window._lastRcToken = null; return t;
                        }
                        return null;
                    };
                    let rcToken = _getToken();
                    if (!rcToken) {
                        // Trigger on-demand pre-warm, retry mỗi 2s tối đa 12 giây
                        for (let i = 0; i < 6; i++) {
                            window.dispatchEvent(new CustomEvent('fluxyPreWarmNow'));
                            await new Promise(r => setTimeout(r, 2000));
                            rcToken = _getToken();
                            const dbg = { grcLoaded: !!window.grecaptcha?.enterprise?.execute, patched: window.grecaptcha?.enterprise?.execute?.name === 'fluxyRcWrapper', ownToken: !!window._ownFreshToken, busy: !!window._fluxyPreWarmBusy };
                            console.log('[ogiZ0b] retry', i+1, JSON.stringify(dbg));
                            if (rcToken) { console.log('[ogiZ0b] got token after', (i+1)*2, 's'); break; }
                        }
                    }
                    if (!rcToken) return { error: 'NO_RC_TOKEN: mở tab flow.google.com, đợi 5 giây rồi thử lại' };

                    const seed = Math.floor(Math.random() * 2147483647);
                    const uuid1 = crypto.randomUUID().toUpperCase();
                    const uuid2 = crypto.randomUUID().toUpperCase();
                    const uuid3 = crypto.randomUUID().toUpperCase();

                    // Native Angular ogiZ0b payload (reverse-engineered from live capture)
                    const ogiInner = [null, [
                        [null, null, null, seed, 3, p.model, null,
                            [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]],
                            [[[p.prompt]]],
                            null, null, null, uuid1, uuid2
                        ]
                    ], 1,
                    [null, 22, null, null, null, projectId, null, null, null, null, [rcToken, 1]],
                    [uuid3]
                    ];
                    const ogiFreq = JSON.stringify([[['ogiZ0b', JSON.stringify(ogiInner), null, 'generic']]]);

                    console.log('[ogiZ0b] seed=', seed, ' model=', p.model, ' rcToken_len=', rcToken.length, ' uuid1=', uuid1.substring(0,8));
                    const ogiRes = await fetch(`${BASE}?${mkParams('ogiZ0b')}`, {
                        method: 'POST', credentials: 'include', headers: mkHeaders(),
                        body: `f.req=${encodeURIComponent(ogiFreq)}&at=${encodeURIComponent(at)}`
                    });
                    const ogiBody = await ogiRes.text();
                    console.log('[ogiZ0b] http=', ogiRes.status, ' len=', ogiBody.length, ' pre=', ogiBody.substring(0, 150));

                    if (ogiBody.includes('"ogiZ0b",null,null,null,[7]')) return { error: 'ogiZ0b [7] PERMISSION_DENIED — tài khoản không có quyền tạo ảnh' };
                    if (ogiBody.includes('"ogiZ0b",null,null,null,[3]')) return { error: 'ogiZ0b [3] AT token không hợp lệ — refresh flow.google.com' };
                    if (ogiBody.includes('"ogiZ0b",null,null,null,[2]')) return { error: 'ogiZ0b [2] rcToken không hợp lệ — đợi 60s rồi thử lại' };

                    // Extract flow-content.google signed URL (không dừng ở '\' để giữ = = '=')
                    const imgRaw = ogiBody.match(/https:\\?\/\\?\/flow-content\.google\\?\/image\\?\/[^\s",\]]+/g) || [];
                    const unesc = s => s
                        .replace(/\\u003d/gi,'=').replace(/\\u0026/gi,'&')
                        .replace(/\\u002f/gi,'/').replace(/\\u003f/gi,'?')
                        .replace(/\\\//g,'/').replace(/\\n/g,'').replace(/\\/g,'');
                    const downloadUrls = [...new Set(imgRaw.map(unesc))].filter(u => u.startsWith('https://'));
                    console.log('[ogiZ0b] extracted URLs:', downloadUrls.length, ' url0_len=', downloadUrls[0]?.length, ' url0_snip=', downloadUrls[0]?.substring(0,100));

                    if (!downloadUrls.length) return { error: 'ogiZ0b no URL — len=' + ogiBody.length + ' pre=' + ogiBody.substring(50, 250) };
                    return { downloadUrls, downloadUrl: downloadUrls[0], uuid2: uuid1, maseQStatus: 'n/a' };
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

// ══ FETCH INTERCEPTOR: inject vào page để nghe lén MỌI batchexecute response ══
async function injectFetchInterceptor(tabId, operationId) {
    const genStartTs = Date.now();
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (opId, startTs) => {
                if (window._fluxyFetchIntercepted) {
                    // Already installed — update opId và xóa URL cũ (capture trước gen này)
                    if (opId && !window._fluxyInterceptOpIds.includes(opId)) window._fluxyInterceptOpIds.push(opId);
                    // Xóa URL stale — chỉ giữ URL capture trong 10s cuối (tránh video cũ trên trang)
                    window._fluxyCapturedUrls = (window._fluxyCapturedUrls || []).filter(c => c.ts >= startTs - 10000);
                    return 'already_patched';
                }
                window._fluxyFetchIntercepted = true;
                window._fluxyInterceptOpIds = opId ? [opId] : [];
                window._fluxyCapturedUrls = [];

                const sentUrls = new Set();

                function extractVideoUrl(text) {
                    const dec = s => s.replace(/\\\//g,'/').replace(/\\{1,2}u003d/g,'=').replace(/\\{1,2}u0026/g,'&');
                    // 1. Structured parse: wrb.fr as29s envelope
                    try {
                        const wm = text.match(/"wrb\.fr","as29s","((?:[^"\\]|\\.)*)"/);
                        if (wm) {
                            const inner = JSON.parse(JSON.parse('"' + wm[1] + '"'));
                            const cands = [inner?.[5]?.[12], inner?.[6]?.[0]?.[13],
                                           inner?.[0]?.[5]?.[12], inner?.[0]?.[6]?.[0]?.[13]];
                            for (const u of cands) {
                                if (typeof u === 'string' && u.startsWith('https')) return dec(u);
                            }
                        }
                    } catch(_) {}
                    // 2. Structured parse: wrb.fr WuwhI envelope
                    try {
                        const wm2 = text.match(/"wrb\.fr","WuwhI","((?:[^"\\]|\\.)*)"/);
                        if (wm2) {
                            const inner2 = JSON.parse(JSON.parse('"' + wm2[1] + '"'));
                            const str2 = JSON.stringify(inner2);
                            const um2 = str2.match(/"(https:\/\/flow-content\.google\/(?:video|image)\/[^"]{10,})"/);
                            if (um2) return dec(um2[1]);
                        }
                    } catch(_) {}
                    // 3. Aggressive: bất kỳ flow-content.google URL trong text
                    const aggrM = text.match(/https:(?:\/|\\\/){2}flow-content\.google(?:\/|\\\/)[^\s"'\\]{10,}/);
                    if (aggrM) {
                        const u = aggrM[0].replace(/\\\//g,'/').replace(/\\u003d/gi,'=').replace(/\\u0026/gi,'&').split(/["'\s\\]/)[0];
                        if (u.length > 30) return u;
                    }
                    // 4. Single-encoded URL patterns
                    const patterns = [
                        /"(https:\/\/flow-content\.google\/video\/[^"]{10,})"/,
                        /"(https:\/\/storage\.googleapis\.com\/ais-[^"]{10,}\.mp4[^"]{0,300})"/,
                        /"(https:\/\/[^"]{5,}\.mp4(?:\?[^"]{0,300})?)"/,
                        /"(https:\/\/[^"]{5,}\.webm(?:\?[^"]{0,300})?)"/,
                        /"(https:\/\/lh3\.googleusercontent\.com\/ais[^"]{10,})"/,
                    ];
                    // 5. Double-encoded (backslash-slash)
                    const patterns2 = [
                        /\\"(https:\\\/\\\/flow-content\.google\\\/video\\\/[^\\"]{10,})\\"/,
                        /\\"(https:\\\/\\\/[^\\"]{5,}\.mp4[^\\"]{0,300})\\"/,
                        /\\"(https:\\\/\\\/storage\.googleapis\.com\\\/ais-[^\\"]{10,})\\"/,
                    ];
                    for (const p of patterns) { const m = text.match(p); if (m) return dec(m[1]); }
                    for (const p of patterns2) { const m = text.match(p); if (m) return dec(m[1]); }
                    return null;
                }

                function onResponse(text, source) {
                    if (!text || text.length < 20) return;
                    const url = extractVideoUrl(text);
                    if (!url || sentUrls.has(url)) return;
                    sentUrls.add(url);
                    const opId = window._fluxyInterceptOpIds[0] || 'intercepted';
                    console.log('[FLUXY INTERCEPT] 🎯 Video URL captured from', source, ':', url.substring(0, 100));
                    // Push vào _fluxyCapturedUrls — SW poller sẽ đọc và save (CSP chặn fetch trực tiếp)
                    window._fluxyCapturedUrls.push({ url, ts: Date.now() });
                }

                // Patch window.fetch
                const _origFetch = window.fetch;
                window.fetch = async function(resource, init) {
                    const resp = await _origFetch.call(this, resource, init);
                    const reqUrl = typeof resource === 'string' ? resource : resource?.url || '';
                    if (reqUrl.includes('batchexecute') || reqUrl.includes('AiSandboxAngular')) {
                        resp.clone().text().then(txt => onResponse(txt, 'fetch')).catch(() => {});
                    }
                    return resp;
                };

                // Patch XMLHttpRequest
                const _origOpen = XMLHttpRequest.prototype.open;
                const _origSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function(m, u, ...a) {
                    this._fluxyReqUrl = u;
                    return _origOpen.call(this, m, u, ...a);
                };
                XMLHttpRequest.prototype.send = function(...a) {
                    if (this._fluxyReqUrl && (this._fluxyReqUrl.includes('batchexecute') || this._fluxyReqUrl.includes('AiSandboxAngular'))) {
                        this.addEventListener('load', function() { onResponse(this.responseText, 'xhr'); });
                    }
                    return _origSend.call(this, ...a);
                };

                console.log('[FLUXY] ✅ Fetch interceptor installed — watching batchexecute responses');
                return 'installed';
            },
            args: [operationId || null, genStartTs]
        });
        console.log(`✅ injectFetchInterceptor tab=${tabId} result=${result?.[0]?.result}`);
    } catch (e) {
        console.log(`⚠️ injectFetchInterceptor failed: ${e.message}`);
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
                const mAt = fullBody.match(/(?:^|&)at=([^&]+)/);
                if (mAt && mAt[1].length >= 20) atFromBody = decodeURIComponent(mAt[1]);
                const m = fullBody.match(/f\.req=([^&]{0,3000})/);
                if (m) freqStr = decodeURIComponent(m[1]);
            }

            // Lưu AT hợp lệ — CHỈ từ Angular's native calls, không từ RPCs của mình
            const ourOwnRpcs = ['as29s', 'ogiZ0b', 'WuwhI', 'nzlxg', 'SPrCad'];
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
            if (freqStr.includes('WuwhI') || freqStr.includes('ogiZ0b') || freqStr.includes('SPrCad')) {
                const rpc = freqStr.includes('WuwhI') ? 'WuwhI' : freqStr.includes('ogiZ0b') ? 'ogiZ0b' : 'SPrCad';
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
        // Lưu vào storage để SW có thể đọc khi tạo ảnh
        chrome.storage.local.set({ flowAuth: { at, bl: bl || '', fsid: fsid || '', ts: Date.now() } });
        // Nếu AT này tốt hơn lastGoodAt hiện tại, cập nhật luôn
        chrome.storage.local.get('lastGoodAt', d => {
            if (!d.lastGoodAt || !d.lastGoodAt.startsWith('AIQ-')) {
                chrome.storage.local.set({ lastGoodAt: at, lastGoodAtTs: Date.now(), lastGoodAtRpc: 'FLOW_AUTH_FOUND' });
            }
        });
        chrome.cookies.getAll({ url: 'https://flow.google.com' }, (cookies) => {
            const cookieStr = (cookies || []).map(c => `${c.name}=${c.value}`).join('; ');
            const sapisid = cookies?.find(c => c.name === 'SAPISID')?.value || '';
            sendToServer({ atToken: at, bl: bl || '', fsid: fsid || '', cookie: cookieStr, sapisid });
            console.log(`✅ AT token — at=${at.substring(0, 20)}... bl=${bl.substring(0, 30)}... fsid=${fsid?.substring(0,15) || '?'}`);
        });
    }

    // WuwhI/jwpduf complete response body — video đã 100%, reload tab để bắt signed URL
    if (message.type === "JWPDUF_COMPLETE_BODY" && message.data?.raw) {
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'JWPDUF_COMPLETE_RAW', raw: message.data.raw.substring(0, 3000), ts: Date.now() })
        }).catch(_=>{});
    }

    // Video blob created in page (Angular dùng MSE/blob URL)
    if (message.type === "VIDEO_BLOB_CREATED") {
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'VIDEO_BLOB_CREATED', blobUrl: message.data?.blobUrl, type: message.data?.type, size: message.data?.size, ts: Date.now() })
        }).catch(_=>{});
    }

    // Video src directly set (not blob)
    if (message.type === "VIDEO_SRC_SET") {
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'VIDEO_SRC_SET', src: message.data?.src, ts: Date.now() })
        }).catch(_=>{});
    }

    // Fetch to flow-content.google captured from page — reveals auth mechanism
    if (message.type === "FC_REQUEST_CAPTURED") {
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'FC_REQUEST', url: message.data?.url, method: message.data?.method, credentials: message.data?.credentials, headers: message.data?.headers, ts: Date.now() })
        }).catch(_=>{});
    }

    // v5.59: grecaptcha action capture — POST to Electron so it appears in Veo Log
    if (message.type === "RC_EXEC_CAPTURED") {
        const action = message.data?.action || '?';
        const sk = (message.data?.sitekey || '').substring(0, 10);
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'RC_EXEC', action, sitekey_pfx: sk, ts: Date.now() })
        }).catch(_=>{});
    }

    // v5.55: Angular batchexecute RPC log
    if (message.type === "RPC_RESP_DEBUG") {
        const rpc = message.data?.rpc || '?';
        const len = message.data?.len || 0;
        fetch('http://127.0.0.1:3000/api/capture-rpc-body', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'ANGULAR_BATCH_RPC', rpcid: rpc, len, snip: message.data?.snip?.substring(0, 500), ts: Date.now() })
        }).catch(_=>{});
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
// Re-inject fetch interceptor khi tab reload (tránh mất capture sau khi user reload trang flow)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    // Export cookies khi bất kỳ tab flow.google.com nào load xong
    if (tab?.url?.includes('flow.google.com') || tab?.url?.includes('labs.google')) {
        exportGoogleCookiesToServer().catch(() => {});
    }
});

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
// JOB EXECUTOR CHÍNH — hỗ trợ N worker song song
// ════════════════════════════════════════════════════════════════════════════
const workerSlots   = new Set();   // các slot đang chạy
let   workerMaxCount = 5;          // mặc định 5 tab song song (server có thể giảm theo queue size)

async function executeGrokJob(job, slotIdx) {
    console.log("[Grok Slot " + slotIdx + "] Job #" + job.jobId + " | ratio=" + job.aspectRatio + " | \"" + (job.prompt||"").substring(0,40) + "\"");
    fetch("http://127.0.0.1:3000/grok/api/sw-ping", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ step: "EXECUTE_JOB slot=" + slotIdx, jobId: job.jobId })
    }).catch(()=>{});
    const tab = await ensureWorkerTab(slotIdx);
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

// Capture WuwhI POST body (previously ogiZ0b) for debugging
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.method !== 'POST') return;
        if (!details.url.includes('WuwhI') && !details.url.includes('ogiZ0b')) return;
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

// ══════════════════════════════════════════════════════════════
// FLUXY AGENT BRIDGE — WebSocket kết nối Python agent port 9222
// Handles: batch_rpc (batchexecute proxy), solve_captcha, api_request, trpc_request
// ══════════════════════════════════════════════════════════════

const FLUXY_AGENT_WS_URL = 'ws://127.0.0.1:9222';
const FK_FLOW_URLS = ['https://flow.google.com/*', 'https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'];
const FK_FLOW_TAB_URL = 'https://flow.google.com/';
const FK_CAPTCHA_SLOT = '__CAPTCHA__';
const FK_MAX_RPC_TEXT = 32000000;

let fkWs = null;
let fkFlowKey = null;
let fkState = 'off';
let fkManualDisconnect = false;
let fkCallbackSecret = null;
let fkMetrics = { requestCount: 0, successCount: 0, failedCount: 0, lastError: null, tokenCapturedAt: null };
let fkRequestLog = [];

chrome.storage.local.get(['fkFlowKey', 'fkMetrics'], (d) => {
  if (d.fkFlowKey) fkFlowKey = d.fkFlowKey;
  if (d.fkMetrics) Object.assign(fkMetrics, d.fkMetrics);
  fkConnect();
});

function fkConnect() {
  if (fkManualDisconnect) return;
  if (fkWs?.readyState === WebSocket.CONNECTING || fkWs?.readyState === WebSocket.OPEN) return;
  try {
    fkWs = new WebSocket(FLUXY_AGENT_WS_URL);
  } catch(e) { fkScheduleReconnect(); return; }
  fkWs.onopen = () => {
    console.log('[FluxyAgent] Connected to Python agent');
    chrome.alarms.clear('fk-reconnect');
    fkSetState('idle');
    fkWs.send(JSON.stringify({
      type: 'extension_ready', flowKeyPresent: !!fkFlowKey,
      extensionVersion: chrome.runtime.getManifest().version, flowUrlSupported: true,
      tokenAge: fkFlowKey && fkMetrics.tokenCapturedAt ? Date.now() - fkMetrics.tokenCapturedAt : null,
    }));
    if (fkFlowKey) fkWs.send(JSON.stringify({ type: 'token_captured', flowKey: fkFlowKey }));
  };
  fkWs.onmessage = async ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if      (msg.method === 'batch_rpc')     await fkHandleBatchRpc(msg);
      else if (msg.method === 'api_request')   await fkHandleApiRequest(msg);
      else if (msg.method === 'trpc_request')  await fkHandleTrpcRequest(msg);
      else if (msg.method === 'solve_captcha') await fkHandleSolveCaptcha(msg);
      else if (msg.method === 'get_status') {
        fkSendToAgent({ id: msg.id, result: { state: fkState, flowKeyPresent: !!fkFlowKey, metrics: fkMetrics } });
      } else if (msg.type === 'callback_secret') {
        fkCallbackSecret = msg.secret;
        chrome.storage.local.set({ fkCallbackSecret: msg.secret });
      }
    } catch(e) { console.error('[FluxyAgent] message error:', e); }
  };
  fkWs.onclose = () => { fkSetState('off'); if (!fkManualDisconnect) fkScheduleReconnect(); };
  fkWs.onerror = () => { fkMetrics.lastError = 'WS_ERROR'; };
}

function fkScheduleReconnect() { chrome.alarms.create('fk-reconnect', { delayInMinutes: 0.083 }); }
function fkSetState(s) { fkState = s; chrome.runtime.sendMessage({ type: 'FK_STATUS_PUSH' }).catch(() => {}); }

function fkSendToAgent(msg) {
  if (msg.id) {
    fetch('http://127.0.0.1:8100/api/ext/callback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg),
    }).catch(() => { if (fkWs?.readyState === WebSocket.OPEN) fkWs.send(JSON.stringify(msg)); });
    return;
  }
  if (fkWs?.readyState === WebSocket.OPEN) fkWs.send(JSON.stringify(msg));
}

function fkAddRequestLog(entry) {
  fkRequestLog.unshift(entry);
  if (fkRequestLog.length > 100) fkRequestLog.pop();
  chrome.runtime.sendMessage({ type: 'REQUEST_LOG_UPDATE', log: fkRequestLog }).catch(() => {});
}
function fkUpdateRequestLog(id, updates) {
  const entry = fkRequestLog.find(e => e.id === id);
  if (entry) Object.assign(entry, updates);
  chrome.runtime.sendMessage({ type: 'REQUEST_LOG_UPDATE', log: fkRequestLog }).catch(() => {});
}

// ─── reCAPTCHA ─────────────────────────────────────────────

async function fkRequestCaptchaFromTab(tabId, requestId, pageAction) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_CAPTCHA', requestId, pageAction });
  } catch(e) {
    const msg = e?.message || '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['fk_content.js'] });
      await new Promise(r => setTimeout(r, 200));
      return await chrome.tabs.sendMessage(tabId, { type: 'GET_CAPTCHA', requestId, pageAction });
    }
    throw e;
  }
}

async function fkReviveTabIfNeeded(tab) {
  if (!tab?.discarded) return tab;
  try { await chrome.tabs.reload(tab.id); await new Promise(r => setTimeout(r, 2500)); return await chrome.tabs.get(tab.id); } catch { return null; }
}

async function fkSolveCaptcha(requestId, captchaAction) {
  let tabs = await chrome.tabs.query({ url: FK_FLOW_URLS });
  if (!tabs.length) {
    try {
      const opened = await chrome.tabs.create({ url: FK_FLOW_TAB_URL, active: false });
      await new Promise(r => setTimeout(r, 3000));
      tabs = [opened?.id ? await chrome.tabs.get(opened.id).catch(() => null) : null].filter(Boolean);
    } catch(e) { return { error: e.message || 'NO_FLOW_TAB' }; }
  }
  const errors = [];
  for (const candidate of tabs) {
    const tab = await fkReviveTabIfNeeded(candidate);
    if (!tab) continue;
    try {
      const resp = await Promise.race([
        fkRequestCaptchaFromTab(tab.id, requestId, captchaAction),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 30000)),
      ]);
      if (!resp?.token) { errors.push(resp?.error || 'NO_TOKEN'); continue; }
      return resp;
    } catch(e) {
      errors.push(e?.message || '');
    }
  }
  try {
    const rt = await chrome.tabs.create({ url: FK_FLOW_TAB_URL, active: false });
    await new Promise(r => setTimeout(r, 3000));
    const target = await chrome.tabs.get(rt.id);
    const result = await Promise.race([
      fkRequestCaptchaFromTab(target.id, requestId, captchaAction),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 30000)),
    ]);
    try { await chrome.tabs.remove(rt.id); } catch {}
    return result;
  } catch(e) { return { error: e?.message || errors[0] || 'NO_FLOW_TAB' }; }
}

async function fkHandleSolveCaptcha(msg) {
  const { id, params } = msg;
  const result = await fkSolveCaptcha(id, params?.captchaAction || 'VIDEO_GENERATION');
  fkMetrics.requestCount++;
  if (result?.token) fkMetrics.successCount++;
  else { fkMetrics.failedCount++; fkMetrics.lastError = result?.error || 'NO_TOKEN'; }
  chrome.storage.local.set({ fkMetrics });
  fkSendToAgent({ id, result });
}

// ─── Batch RPC runner ──────────────────────────────────────

async function fkRunBatchRpc(cmd) {
  const tabs = await chrome.tabs.query({ url: FK_FLOW_URLS });
  let candidate = tabs.find(t => !t.discarded) || tabs[0];
  if (!candidate) {
    try {
      const opened = await chrome.tabs.create({ url: FK_FLOW_TAB_URL, active: false });
      await new Promise(r => setTimeout(r, 5000));
      candidate = opened?.id ? await chrome.tabs.get(opened.id).catch(() => null) : null;
    } catch(e) { return { error: e?.message || 'NO_FLOW_TAB' }; }
    if (!candidate) return { error: 'NO_FLOW_TAB' };
  }
  const tab = await fkReviveTabIfNeeded(candidate);
  if (!tab) return { error: 'FLOW_TAB_DISCARDED' };

  let freq = cmd.freq;
  if (cmd.captchaAction) {
    const solved = await fkSolveCaptcha(cmd.id, cmd.captchaAction);
    if (!solved?.token) return { error: `CAPTCHA_FAILED: ${solved?.error || 'no token'}` };
    freq = freq.split(FK_CAPTCHA_SLOT).join(solved.token);
  }

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    args: [cmd.rpcid, freq, FK_MAX_RPC_TEXT, cmd.match || null],
    func: async (rpcid, freqStr, maxText, match) => {
      const wiz = globalThis.WIZ_global_data || {};
      const at = wiz.SNlM0e;
      const sid = wiz.FdrFJe;
      const bl = wiz.cfb2h;
      if (!at) return { error: 'NO_AT_TOKEN' };
      const reqid = Math.floor(Math.random() * 900000) + 100000;
      const sourcePath = location.pathname || '/';
      const hl = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
      const url = `/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
        `&source-path=${encodeURIComponent(sourcePath)}&bl=${encodeURIComponent(bl || '')}` +
        `&f.sid=${encodeURIComponent(sid || '')}&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;
      const resp = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' },
        body: new URLSearchParams({ 'f.req': freqStr, at }),
      });
      const text = await resp.text();
      if (match) {
        const found = text.indexOf(match);
        return { status: resp.status, matched: found !== -1, text: found === -1 ? '' : text.slice(found, found + 800) };
      }
      return { status: resp.status, text: text.slice(0, maxText) };
    },
  });

  return injected?.result || { error: 'NO_INJECTION_RESULT' };
}

const FK_RPC_LABELS = { ogiZ0b:'Gen Image', eb1hJf:'Gen Video', YhhmEf:'Gen Video (text)', nprQif:'Gen Video (chain)', MZZa6b:'Gen Video (refs)', maseQ:'Upload Image', SPrCad:'Upscale Image', jHPbke:'Create Project', jwpduf:'Poll Operation', Zzl0ze:'Project Media', as29s:'Get Media' };

async function fkHandleBatchRpc(msg) {
  const { id, params } = msg;
  const { rpcid, freq, captchaAction, match } = params || {};
  if (!rpcid || !freq) { fkSendToAgent({ id, status: 400, error: 'INVALID_BATCH_RPC' }); return; }
  fkSetState('running');
  const hasCaptcha = !!captchaAction;
  if (hasCaptcha) {
    fkMetrics.requestCount++;
    fkAddRequestLog({ id, type: FK_RPC_LABELS[rpcid] || `RPC:${rpcid}`, time: new Date().toISOString(), status: 'processing', error: null, url: rpcid, payloadSummary: freq.slice(0, 200) });
  }
  try {
    const out = await fkRunBatchRpc({ id, rpcid, freq, captchaAction, match });
    if (out.error) {
      if (hasCaptcha) { fkMetrics.failedCount++; fkMetrics.lastError = out.error; fkUpdateRequestLog(id, { status: 'failed', error: out.error }); }
      fkSendToAgent({ id, status: 502, error: out.error });
    } else {
      if (hasCaptcha) { fkMetrics.successCount++; fkMetrics.lastError = null; fkUpdateRequestLog(id, { status: 'success', httpStatus: out.status, responseSummary: (out.text || '').slice(0, 300) }); }
      fkSendToAgent({ id, status: out.status, data: out.text });
    }
  } catch(e) {
    const err = e?.message || 'BATCH_RPC_FAILED';
    if (hasCaptcha) { fkMetrics.failedCount++; fkMetrics.lastError = err; fkUpdateRequestLog(id, { status: 'failed', error: err }); }
    fkSendToAgent({ id, status: 500, error: err });
  }
  chrome.storage.local.set({ fkMetrics });
  fkSetState('idle');
}

async function fkHandleTrpcRequest(msg) {
  const { id, params } = msg;
  const { url, method = 'POST', headers = {}, body, responseMode = 'json' } = params;
  if (!url || !url.startsWith('https://labs.google/')) { fkSendToAgent({ id, error: 'INVALID_TRPC_URL' }); return; }
  fkSetState('running');
  const fetchHeaders = { 'Content-Type': 'application/json', ...headers };
  if (fkFlowKey) fetchHeaders['authorization'] = `Bearer ${fkFlowKey}`;
  try {
    const resp = await fetch(url, { method, headers: fetchHeaders, body: body ? JSON.stringify(body) : undefined, credentials: 'include' });
    let data;
    if (responseMode === 'url') { data = { url: resp.url, contentType: resp.headers.get('content-type') }; await resp.body?.cancel(); }
    else { data = await resp.json(); }
    fkSendToAgent({ id, status: resp.status, data });
  } catch(e) { fkSendToAgent({ id, error: e.message || 'TRPC_FETCH_FAILED' }); }
  fkSetState('idle');
}

async function fkHandleApiRequest(msg) {
  const { id, params } = msg;
  const { url, method, headers, body, captchaAction } = params;
  if (!url || !url.startsWith('https://aisandbox-pa.googleapis.com/')) { fkSendToAgent({ id, error: 'INVALID_URL' }); return; }
  fkSetState('running');
  const hasCaptcha = !!captchaAction;
  if (hasCaptcha) fkMetrics.requestCount++;
  try {
    let captchaToken = null;
    if (captchaAction) {
      const cr = await fkSolveCaptcha(id, captchaAction);
      captchaToken = cr?.token || null;
      if (!captchaToken) {
        const err = cr?.error || 'CAPTCHA_FAILED';
        if (hasCaptcha) { fkMetrics.failedCount++; fkMetrics.lastError = `CAPTCHA_FAILED: ${err}`; }
        chrome.storage.local.set({ fkMetrics });
        fkSendToAgent({ id, status: 403, error: `CAPTCHA_FAILED: ${err}` });
        fkSetState('idle'); return;
      }
    }
    let finalBody = body;
    if (captchaToken && finalBody) {
      finalBody = JSON.parse(JSON.stringify(finalBody));
      if (finalBody.clientContext?.recaptchaContext) finalBody.clientContext.recaptchaContext.token = captchaToken;
      if (finalBody.requests) for (const req of finalBody.requests) { if (req.clientContext?.recaptchaContext) req.clientContext.recaptchaContext.token = captchaToken; }
    }
    const fetchHeaders = { ...(headers || {}) };
    if (fkFlowKey) fetchHeaders['authorization'] = `Bearer ${fkFlowKey}`;
    const response = await fetch(url, { method: method || 'POST', headers: fetchHeaders, credentials: 'include', body: method === 'GET' ? undefined : JSON.stringify(finalBody) });
    const responseText = await response.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }
    fkSendToAgent({ id, status: response.status, data: responseData });
    if (hasCaptcha) { if (response.ok) fkMetrics.successCount++; else { fkMetrics.failedCount++; fkMetrics.lastError = `API_${response.status}`; } }
  } catch(e) {
    fkSendToAgent({ id, status: 500, error: e.message || 'API_REQUEST_FAILED' });
    if (hasCaptcha) { fkMetrics.failedCount++; fkMetrics.lastError = e.message; }
  }
  chrome.storage.local.set({ fkMetrics });
  fkSetState('idle');
}

// ─── Message handlers for FlowKit bridge ───────────────────

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === 'FK_STATUS') {
    reply({ connected: fkWs?.readyState === WebSocket.OPEN, flowKeyPresent: !!fkFlowKey, state: fkState, metrics: fkMetrics });
    return true;
  }
  if (msg.type === 'REQUEST_LOG') {
    reply({ log: fkRequestLog });
    return true;
  }
  if (msg.type === 'OPEN_FLOW_TAB') {
    chrome.tabs.query({ url: FK_FLOW_URLS }).then(tabs => {
      if (tabs.length) { chrome.tabs.update(tabs[0].id, { active: true }); reply({ ok: true, tabId: tabs[0].id }); }
      else chrome.tabs.create({ url: FK_FLOW_TAB_URL }).then(tab => reply({ ok: true, tabId: tab.id })).catch(e => reply({ error: e.message }));
    }).catch(e => reply({ error: e.message }));
    return true;
  }
  if (msg.type === 'TRPC_MEDIA_URLS') {
    if (fkWs?.readyState === WebSocket.OPEN) {
      try {
        const urlRegex = /https:\/\/storage\.googleapis\.com\/ai-sandbox-videofx\/(?:image|video)\/[0-9a-f-]{36}\?[^"'\s]+/g;
        const matches = (msg.body || '').match(urlRegex) || [];
        const urlMap = {};
        for (const rawUrl of matches) {
          const url = rawUrl.replace(/\\u0026/g, '&').replace(/\\/g, '');
          const m = url.match(/\/(image|video)\/([0-9a-f-]{36})\?/);
          if (m) urlMap[m[2]] = { mediaType: m[1], url, mediaId: m[2] };
        }
        const entries = Object.values(urlMap);
        if (entries.length) fkWs.send(JSON.stringify({ type: 'media_urls_refresh', urls: entries }));
      } catch {}
    }
    reply({ ok: true });
    return true;
  }
});

// ─── Bearer token capture (flow.google.com) ────────────────

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details?.requestHeaders?.length) return;
    const authHeader = details.requestHeaders.find(h => h.name?.toLowerCase() === 'authorization');
    const value = authHeader?.value || '';
    if (!value.startsWith('Bearer ya29.')) return;
    const token = value.replace(/^Bearer\s+/i, '').trim();
    if (!token) return;
    fkFlowKey = token;
    fkMetrics.tokenCapturedAt = Date.now();
    chrome.storage.local.set({ fkFlowKey, fkMetrics });
    if (fkWs?.readyState === WebSocket.OPEN) fkWs.send(JSON.stringify({ type: 'token_captured', flowKey: fkFlowKey }));
  },
  { urls: ['https://aisandbox-pa.googleapis.com/*', 'https://labs.google/*'] },
  ['requestHeaders', 'extraHeaders']
);

// ─── Alarm handlers for FlowKit bridge ────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fk-reconnect') fkConnect();
  if (alarm.name === 'fk-keepAlive') {
    if (fkWs?.readyState === WebSocket.OPEN) fkWs.send(JSON.stringify({ type: 'ping' }));
    else fkConnect();
  }
});

chrome.alarms.create('fk-keepAlive', { periodInMinutes: 0.4 });

console.log('[FluxyAgent] FlowKit bridge loaded v5.71');
