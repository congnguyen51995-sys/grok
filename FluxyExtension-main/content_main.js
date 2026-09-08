console.log("AutoFlow V66 Main World Interceptor Loaded — Cookie + AT token (batchexecute)");

// ── Scan response body cho video URL (R2V voice video) ──────────────────────────
// Chạy ở document_start → bắt MỌI response từ đầu, kể cả load trang ban đầu
// Chỉ capture URL từ các domain Google AI video đã biết (tránh false positive từ banner/promo)
const _FLUXY_VIDEO_DOMAINS = ['flow-content.google/video/', 'flow-content.google/image/', 'storage.googleapis.com/ais-', 'lh3.googleusercontent.com/ais'];
function _fluxyIsVideoUrl(url) {
    return _FLUXY_VIDEO_DOMAINS.some(d => url.includes(d));
}
function _fluxyCapture(txt) {
    if (!txt || txt.length < 20) return;
    // Bắt video/image URL từ MỌI response
    const pats = [
        /"(https:(?:\\\/|\/){2}flow-content\.google\/(?:video|image)\/[^"]{10,})"/g,
        /"(https:(?:\\\/|\/){2}storage\.googleapis\.com\/ais-[^"]{10,})"/g,
        /"(https:(?:\\\/|\/){2}lh3\.googleusercontent\.com\/ais[^"]{10,})"/g,
    ];
    for (const pat of pats) {
        for (const m of txt.matchAll(pat)) {
            const raw = m[1]
                .replace(/\\\//g,'/')
                .replace(/\\{1,2}u003d/g,'=')
                .replace(/\\{1,2}u0026/g,'&')
                .replace(/\\{1,2}u002f/g,'/')
                .replace(/\\+$/, '');
            if (!raw.includes('?')) continue;
            if (!window._fluxyCapturedUrls) window._fluxyCapturedUrls = [];
            if (!window._fluxyCapturedUrls.some(c => c.url === raw)) {
                window._fluxyCapturedUrls.push({ url: raw, ts: Date.now() });
                console.log('[Fluxy] captured:', raw.substring(0, 90));
            }
        }
    }
    // Bắt workflowId từ MỌI response chứa pattern [mediaId, projId, workflowId, "CAE"]
    // Gồm cả tRARke, HTrJv, jwpduf, as29s, v.v.
    try {
        const _wfPat = /\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"[0-9a-f-]{36}\\",\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"CAE\\"/gi;
        for (const wm of txt.matchAll(_wfPat)) {
            const _mid = wm[1], _wid = wm[2];
            if (!window._fluxyWorkflowIds) window._fluxyWorkflowIds = {};
            if (!window._fluxyWorkflowIds[_mid]) {
                window._fluxyWorkflowIds[_mid] = _wid;
                console.log('[Fluxy] wid captured:', _wid.substring(0,8), 'for:', _mid.substring(0,8));
            }
        }
    } catch(_) {}
}

// ── Intercept HTMLMediaElement.src setter → bắt URL video gán vào <video> ──
(function() {
    const _d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (_d?.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            get: _d.get,
            set: function(val) {
                if (val && typeof val === 'string' && !val.startsWith('blob:') && !val.startsWith('data:') && _fluxyIsVideoUrl(val)) {
                    _fluxyCapture('"' + val + '"');
                }
                return _d.set.call(this, val);
            },
            configurable: true,
        });
    }
})();

// ── Intercept EventSource (SSE) → bắt real-time update từ Flow ──
(function() {
    if (typeof EventSource === 'undefined') return;
    const _O = EventSource;
    function _FES(url, opts) {
        const es = opts ? new _O(url, opts) : new _O(url);
        es.addEventListener('message', function(evt) {
            try { if (evt.data) _fluxyCapture(evt.data); } catch(_) {}
        });
        return es;
    }
    _FES.prototype = _O.prototype;
    _FES.CONNECTING = 0; _FES.OPEN = 1; _FES.CLOSED = 2;
    window.EventSource = _FES;
})();

// ── Intercept WebSocket → bắt message chứa URL video ──
(function() {
    if (typeof WebSocket === 'undefined') return;
    const _O = WebSocket;
    function _FWS(url, protocols) {
        const ws = protocols != null ? new _O(url, protocols) : new _O(url);
        ws.addEventListener('message', function(evt) {
            try { if (typeof evt.data === 'string') _fluxyCapture(evt.data); } catch(_) {}
        });
        return ws;
    }
    _FWS.prototype = _O.prototype;
    _FWS.CONNECTING = 0; _FWS.OPEN = 1; _FWS.CLOSING = 2; _FWS.CLOSED = 3;
    window.WebSocket = _FWS;
})();

// ── MutationObserver: bắt <video src="..."> được thêm vào DOM ──
(function() {
    function _chk(n) {
        if (!n || !n.tagName) return;
        const vids = n.tagName === 'VIDEO' ? [n] : Array.from(n.querySelectorAll ? n.querySelectorAll('video[src]') : []);
        for (const v of vids) {
            if (v.src && !v.src.startsWith('blob:') && !v.src.startsWith('data:') && _fluxyIsVideoUrl(v.src)) {
                _fluxyCapture('"' + v.src + '"');
            }
        }
    }
    const _obs = new MutationObserver(function(muts) {
        for (const m of muts) {
            for (let i = 0; i < m.addedNodes.length; i++) _chk(m.addedNodes[i]);
            if (m.type === 'attributes' && m.target.tagName === 'VIDEO') _chk(m.target);
        }
    });
    _obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();

const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');

    // ── Bắt AT token từ batchexecute (flow.google.com — cookie-based auth) ───
    // Xử lý cả absolute URL (https://flow.google.com/...) lẫn relative URL (/_/AiSandbox...)
    const isFlowBatch = (url.includes('flow.google.com') && url.includes('batchexecute')) ||
                        (url.includes('batchexecute') && url.includes('AiSandbox'));
    if (isFlowBatch) {
        try {
            const body = args[1]?.body;
            let at = null;
            if (body) {
                if (typeof body === 'string') {
                    at = new URLSearchParams(body).get('at');
                } else if (body instanceof URLSearchParams) {
                    at = body.get('at');
                } else if (body instanceof FormData) {
                    at = body.get('at');
                }
            }
            let bl = '', fsid = '';
            try {
                const absUrl = url.startsWith('/') ? (window.location.origin + url) : url;
                bl = new URL(absUrl).searchParams.get('bl') || '';
                fsid = new URL(absUrl).searchParams.get('f.sid') || '';
            } catch (_) {}
            if (at && at.length > 10) {
                window._flowAuthData = { at, bl, fsid };
                window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at, bl, fsid } }));
                console.log('[AutoFlow] Captured batchexecute AT len=', at.length, ' bl=', bl.substring(0,40), ' fsid=', fsid.substring(0,15));
            }
        } catch (_) {}
    }

    // ── Bắt Bearer token từ googleapis.com outgoing (labs.google fallback) ──
    if (url.includes('googleapis.com') || url.includes('labs.google')) {
        try {
            const init = args[1];
            let bearer = null;
            if (init?.headers) {
                const h = init.headers;
                if (typeof h.get === 'function') {
                    bearer = h.get('authorization') || h.get('Authorization');
                } else if (typeof h === 'object') {
                    bearer = h['authorization'] || h['Authorization'];
                }
            }
            if (bearer && bearer.startsWith('Bearer ') && bearer.length > 57) {
                window.dispatchEvent(new CustomEvent('AutoFlow_BEARER', { detail: bearer.replace('Bearer ', '') }));
            }
        } catch (_) {}
    }

    const response = await originalFetch.apply(this, args);

    // ── Scan MỌI response từ flow.google.com cho video URL ──────────────────────
    if (response.ok) {
        const isFlowOrigin = url.includes('flow.google.com') || url.includes('labs.google') || url.includes('googleapis.com');
        if (isFlowOrigin) {
            try {
                const respClone = response.clone();
                respClone.text().then(respText => { _fluxyCapture(respText); }).catch(() => {});
            } catch (_) {}
        }
    }

    // ── Bắt AT mới + jwpduf workflowId từ RESPONSE batchexecute ────────────
    if (isFlowBatch && response.ok) {
        try {
            const respClone2 = response.clone();
            respClone2.text().then(respText => {
                const atMatch = respText.match(/"xsrf","(AIQ-[^"]+)"/);
                if (atMatch && atMatch[1].length > 20) {
                    const newAt = atMatch[1];
                    if (!window._flowAuthData || newAt !== window._flowAuthData.at) {
                        window._flowAuthData = {
                            at: newAt,
                            bl: window._flowAuthData?.bl || bl,
                            fsid: window._flowAuthData?.fsid || fsid
                        };
                        console.log('[AutoFlow] Fresh AT from RESPONSE, len=', newAt.length, ' bl=', (window._flowAuthData.bl || '').substring(0,40));
                        window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at: newAt, bl: window._flowAuthData.bl, fsid: window._flowAuthData.fsid } }));
                    }
                }
                // Bắt workflowId từ jwpduf FETCH response (Angular dùng fetch, không phải XHR)
                try {
                    const _absUrl = url.startsWith('/') ? (window.location.origin + url) : url;
                    if (new URL(_absUrl).searchParams.get('rpcids') === 'jwpduf') {
                        // Pattern trong raw batchexecute text: \"mediaId\",\"projId\",\"workflowId\",\"CAE\"
                        const _jwpPat = /\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"[0-9a-f-]{36}\\",\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"CAE\\"/gi;
                        for (const _jm of respText.matchAll(_jwpPat)) {
                            const _mid = _jm[1], _wid = _jm[2];
                            if (!window._fluxyWorkflowIds) window._fluxyWorkflowIds = {};
                            if (!window._fluxyWorkflowIds[_mid]) {
                                window._fluxyWorkflowIds[_mid] = _wid;
                                console.log('[Fluxy] fetch jwpduf wid:', _wid.substring(0,8), 'for:', _mid.substring(0,8));
                            }
                        }
                    }
                } catch(_) {}
            }).catch(() => {});
        } catch (_) {}
    }

    // ── Bắt CAUS token từ response ─────────────────────────────────────────────
    if (url.includes('aisandbox-pa.googleapis.com')) {
        console.log("AutoFlow: Intercepting Fetch to -> ", url);
        const clone = response.clone();
        clone.text().then(text => processCausText(text)).catch(e => { console.error("AutoFlow Clone Error", e); });
    }
    return response;
};

const originalXhrOpen = XMLHttpRequest.prototype.open;
const originalXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalXhrOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (...args) {
    // Bắt AT token từ XHR batchexecute (absolute và relative URL)
    const _isFlowBatch = this._url && (
        (this._url.includes('flow.google.com') && this._url.includes('batchexecute')) ||
        (this._url.includes('batchexecute') && this._url.includes('AiSandbox'))
    );
    if (_isFlowBatch) {
        try {
            const body = args[0];
            let at = null;
            if (body) {
                if (typeof body === 'string') {
                    at = new URLSearchParams(body).get('at');
                } else if (body instanceof URLSearchParams) {
                    at = body.get('at');
                } else if (body instanceof FormData) {
                    at = body.get('at');
                }
            }
            let bl = '', fsid = '';
            try {
                const absUrl = this._url.startsWith('/') ? (window.location.origin + this._url) : this._url;
                bl = new URL(absUrl).searchParams.get('bl') || '';
                fsid = new URL(absUrl).searchParams.get('f.sid') || '';
            } catch (_) {}
            if (at && at.length > 10) {
                window._flowAuthData = { at, bl, fsid };
                window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at, bl, fsid } }));
            }
        } catch (_) {}
    }

    // Bắt workflowId từ as29s XHR REQUEST body (Flow gọi khi video hoàn thành)
    if (_isFlowBatch) {
        try {
            const absUrl = this._url.startsWith('/') ? (window.location.origin + this._url) : this._url;
            const rpcids = new URL(absUrl).searchParams.get('rpcids');
            if (rpcids === 'as29s' && args[0]) {
                const freq = new URLSearchParams(typeof args[0] === 'string' ? args[0] : '').get('f.req');
                if (freq) {
                    const outer = JSON.parse(freq);
                    const inner = JSON.parse(outer?.[0]?.[0]?.[1] || '[]');
                    // inner = [mediaId, projectId, workflowId, stepId]
                    if (inner.length >= 3 && typeof inner[2] === 'string' && inner[2].includes('-')) {
                        if (!window._fluxyWorkflowIds) window._fluxyWorkflowIds = {};
                        window._fluxyWorkflowIds[inner[0]] = inner[2];
                        window._fluxyProjectWorkflowId = inner[2];
                        console.log('[Fluxy] workflowId captured:', inner[2].substring(0,8), 'for media:', inner[0].substring(0,8));
                    }
                }
            }
        } catch(_) {}
    }

    this.addEventListener('load', function () {
        // Lấy response text — handle cả text lẫn arraybuffer (gRPC-Web / protobuf)
        let _rt = '';
        try {
            if (this.responseText) {
                _rt = this.responseText;
            } else if (this.responseType === 'arraybuffer' && this.response instanceof ArrayBuffer) {
                _rt = new TextDecoder('utf-8', { fatal: false }).decode(this.response);
            }
        } catch (_) {}

        // Scan MỌI response từ Google/Flow cho video URL
        if (_rt) {
            const _xu = this._url || '';
            const _isGoogle = _xu.includes('flow.google.com') || _xu.includes('googleapis.com') || _xu.includes('labs.google') || _xu.includes('AiSandbox');
            if (_isGoogle) {
                try { _fluxyCapture(_rt); } catch(_) {}
            }
        }

        // Bắt AT mới từ batchexecute XHR response
        if (_isFlowBatch && _rt) {
            try {
                const atMatch = _rt.match(/"xsrf","(AIQ-[^"]+)"/);
                if (atMatch && atMatch[1].length > 20) {
                    const newAt = atMatch[1];
                    if (!window._flowAuthData || newAt !== window._flowAuthData.at) {
                        let bl2 = '', fsid2 = '';
                        try {
                            const absUrl2 = this._url.startsWith('/') ? (window.location.origin + this._url) : this._url;
                            bl2 = new URL(absUrl2).searchParams.get('bl') || window._flowAuthData?.bl || '';
                            fsid2 = new URL(absUrl2).searchParams.get('f.sid') || window._flowAuthData?.fsid || '';
                        } catch (_) {}
                        window._flowAuthData = { at: newAt, bl: bl2, fsid: fsid2 };
                        console.log('[AutoFlow] Fresh AT from XHR RESPONSE, len=', newAt.length);
                        window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at: newAt, bl: bl2, fsid: fsid2 } }));
                    }
                }
            } catch (_) {}
        }
        // Bắt workflowId từ jwpduf RESPONSE (Angular poll → [mediaId, projectId, workflowId, "CAE"])
        if (_isFlowBatch && _rt) {
            try {
                const _rpcUrl = this._url.startsWith('/') ? (window.location.origin + this._url) : this._url;
                if (new URL(_rpcUrl).searchParams.get('rpcids') === 'jwpduf') {
                    // Raw batchexecute text có dạng: \"mediaId\",\"projId\",\"workflowId\",\"CAE\"
                    const _jwpPat = /\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"[0-9a-f-]{36}\\",\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\",\\"CAE\\"/gi;
                    for (const _jm of _rt.matchAll(_jwpPat)) {
                        const _mid = _jm[1], _wid = _jm[2];
                        if (!window._fluxyWorkflowIds) window._fluxyWorkflowIds = {};
                        if (!window._fluxyWorkflowIds[_mid]) {
                            window._fluxyWorkflowIds[_mid] = _wid;
                            console.log('[Fluxy] jwpduf wid:', _wid.substring(0,8), 'for:', _mid.substring(0,8));
                        }
                    }
                }
            } catch(_) {}
        }

        if (this._url && this._url.includes('aisandbox-pa.googleapis.com')) {
            console.log("AutoFlow: Intercepting XHR to -> ", this._url);
            if (_rt) processCausText(_rt);
        }
    });
    return originalXhrSend.apply(this, args);
};

function processCausText(text) {
    const matches = text.match(/CAUS[A-Za-z0-9_-]{30,}/g);
    if (matches && matches.length > 0) {
        console.log("AutoFlow: CAPTURED DIRECT CAUS!", matches);
        window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [...new Set(matches)] }));
    }

    if (text.includes('"projectId"') && (text.includes('"workflowId"') || text.includes('"name"'))) {
        try {
            const mediaMatch = text.match(/"name"\s*:\s*"([0-9a-f-]{36})"/);
            const projectMatch = text.match(/"projectId"\s*:\s*"([0-9a-f-]{36})"/);
            const workflowMatch = text.match(/"workflowId"\s*:\s*"([0-9a-f-]{36})"/);
            const stepMatch = text.match(/"workflowStepId"\s*:\s*"([^"]+)"/);

            if (mediaMatch && projectMatch && workflowMatch) {
                const mediaId = mediaMatch[1];
                const projectId = projectMatch[1];
                const workflowId = workflowMatch[1];
                const stepId = stepMatch ? stepMatch[1] : 'CAE';

                const buf = [];
                buf.push(0x08, 0x05);
                buf.push(0x12, projectId.length);
                for (let i = 0; i < projectId.length; i++) buf.push(projectId.charCodeAt(i));
                buf.push(0x1a, mediaId.length);
                for (let i = 0; i < mediaId.length; i++) buf.push(mediaId.charCodeAt(i));
                buf.push(0x22, stepId.length);
                for (let i = 0; i < stepId.length; i++) buf.push(stepId.charCodeAt(i));
                buf.push(0x2a, workflowId.length);
                for (let i = 0; i < workflowId.length; i++) buf.push(workflowId.charCodeAt(i));

                const b64 = btoa(String.fromCharCode.apply(null, buf)).replace(/=+$/, '');
                console.log("AutoFlow: RECONSTRUCTED CAUS FROM JSON!", b64);
                window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [b64] }));
            }
        } catch (e) { console.error("AutoFlow CAUS Build Error", e); }
    }
}

function buildCausString(projectId, mediaId, workflowId, stepId = 'CAE') {
    const buf = [];
    buf.push(0x08, 0x05);
    buf.push(0x12, projectId.length);
    for (let i = 0; i < projectId.length; i++) buf.push(projectId.charCodeAt(i));
    buf.push(0x1a, mediaId.length);
    for (let i = 0; i < mediaId.length; i++) buf.push(mediaId.charCodeAt(i));
    buf.push(0x22, stepId.length);
    for (let i = 0; i < stepId.length; i++) buf.push(stepId.charCodeAt(i));
    buf.push(0x2a, workflowId.length);
    for (let i = 0; i < workflowId.length; i++) buf.push(workflowId.charCodeAt(i));
    return btoa(String.fromCharCode.apply(null, buf)).replace(/=+$/, '');
}

// Quét project ID từ URL và DOM
setInterval(() => {
    const loc = window.location.href;
    const projectMatch = loc.match(/project\/([0-9a-f-]{36})/);
    const mediaMatch = loc.match(/edit\/([0-9a-f-]{36})/);

    let workflowId = null;
    let fallbackRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

    if (projectMatch && mediaMatch && document.body) {
        let rootState = document.body.innerHTML;
        let m;
        while ((m = fallbackRegex.exec(rootState)) !== null) {
            let id = m[1];
            if (id !== projectMatch[1] && id !== mediaMatch[1]) {
                workflowId = id;
                break;
            }
        }

        if (workflowId) {
            const b64 = buildCausString(projectMatch[1], mediaMatch[1], workflowId, 'CAE');
            window.dispatchEvent(new CustomEvent('AutoFlow_CAUS', { detail: [b64] }));
        }
    }
}, 3000);
