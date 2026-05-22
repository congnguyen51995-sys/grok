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

console.log("🚀 Fluxy Extension V2.3 - Multi-tab parallel jobs");

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
            let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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

        if (data.fetchUrl) {
            fetchUrlViaChrome(data.fetchUrl);
        }

        if (data.downloadVideo) {
            downloadVideoViaChrome(data.downloadVideo);
        }
    } catch (e) {}
}, 1000);

// TẢI URL QUA CHROME MAIN WORLD (để bypass hạn chế network của Electron)
let isFetchingUrl = false;
async function fetchUrlViaChrome(url) {
    if (isFetchingUrl) return;
    isFetchingUrl = true;
    try {
        let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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
        let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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
        let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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

// SNIFFER: Bắt Bearer token & cookie từ labs.google
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        const isAisandboxApi = details.url.includes("aisandbox-pa.googleapis.com");
        const isLabsGoogle = details.url.includes("labs.google") || details.url.includes("googleapis.com");
        if (!isLabsGoogle) return;

        if (!isAisandboxApi && Date.now() - lastSentTime < 3000) return;

        const auth = details.requestHeaders.find(h => h.name.toLowerCase() === 'authorization');
        if (auth && auth.value.includes("Bearer")) {
            const bearer = auth.value.replace("Bearer ", "");
            if (bearer.length > 50) {
                lastSentTime = Date.now();
                chrome.cookies.getAll({ url: "https://labs.google" }, (cookies) => {
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    sendToServer({
                        bearerToken: bearer,
                        cookie: cookieStr,
                        userAgent: navigator.userAgent,
                        headers: details.requestHeaders
                    });
                });
            }
        }
    },
    { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]
);

// LẤY MÃ RECAPTCHA
async function fetchRecaptcha(action) {
    let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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
            console.log(`✅ Lấy thành công reCaptcha (Action: ${action})`);
            sendToServer({ recaptchaToken: result[0].result, action: action });
        }
    } catch (e) {}
}

// QUÉT PROJECT ID
setInterval(async () => {
    let [tab] = await chrome.tabs.query({ url: "*://labs.google/*" });
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
            sendToServer({ projectId: res[0].result });
        }
    }).catch(() => {});
}, 2000);

// NHẬN SỰ KIỆN TỪ CONTENT SCRIPT (Veo)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CAUS_FOUND" && message.data) {
        fetch("http://127.0.0.1:3000/api/save-caus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ causList: message.data })
        }).catch(() => {});
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
