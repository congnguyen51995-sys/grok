console.log("AutoFlow V70 Main World Interceptor — AT token + recaptcha only");

// ── Intercept grecaptcha.enterprise.execute → bắt action+sitekey cho image gen ──
(function() {
    let _orig = null;

    function _isOurWrapper(fn) {
        if (!fn) return false;
        const n = fn.name || '';
        return n === 'fluxyRcWrapper' || n.includes('fluxyRcWrapper');
    }

    // Reject Google's anti-extension poison wrapper: (e,f)=>d(e,{...f,action:"extension_hijack_detected"})
    // If accepted as _orig, it creates a circular: arrowFn→d(=wrapper)→_callOrig→arrowFn→∞
    function _isHijackWrapper(fn) {
        if (!fn) return false;
        try { return fn.toString().includes('extension_hijack_detected'); } catch(_) { return false; }
    }

    // Gọi _orig với TEMP-REPLACE: tạm thay execute = _orig (plain value) trước khi gọi
    // Lý do: _orig có thể gọi enterprise.execute nội bộ. Nếu execute là getter→wrapper thì đệ quy vô hạn.
    // Temp-replace đảm bảo _orig thấy enterprise.execute = _orig (bản thân), không phải wrapper.
    function _callOrig(sitekey, params) {
        const grc = window.grecaptcha?.enterprise;
        if (!grc || !_orig || _isOurWrapper(_orig) || _isHijackWrapper(_orig))
            return Promise.reject(new Error('orig_invalid'));
        const savedDesc = Object.getOwnPropertyDescriptor(grc, 'execute');
        let result;
        try {
            // TEMP-REPLACE: expose _orig as plain value so self-check (enterprise.execute===_orig) succeeds
            Object.defineProperty(grc, 'execute', { value: _orig, writable: true, configurable: true });
            result = _orig.call(grc, sitekey, params);
            // Capture lazy-init: if _orig replaced itself with realImpl
            const nd = Object.getOwnPropertyDescriptor(grc, 'execute');
            if (nd?.value && nd.value !== _orig && !_isOurWrapper(nd.value) && !_isHijackWrapper(nd.value)) {
                console.log('[Fluxy-RC] _orig upgraded to impl:', nd.value.name || 'anon');
                _orig = nd.value;
            }
        } finally {
            // Restore wrapper accessor
            try {
                const w = _makeWrapper();
                Object.defineProperty(grc, 'execute', {
                    get: () => w,
                    set: _makeSetter(),
                    configurable: true
                });
            } catch(_) {}
        }
        return Promise.resolve(result);
    }

    function _makeSetter() {
        return (newFn) => {
            if (!newFn || _isOurWrapper(newFn)) return;
            // Reject Google's anti-extension wrapper — if accepted, creates circular reference
            if (_isHijackWrapper(newFn)) {
                console.log('[Fluxy-RC] rejected hijack-detect wrapper, _orig unchanged');
                return;
            }
            _orig = newFn;
            console.log('[Fluxy-RC] execute replaced, new _orig:', newFn.name || 'anon');
        };
    }

    function _makeWrapper() {
        return function fluxyRcWrapper(sitekey, params) {
            const action = params?.action || '?';
            const isHijackDetect = action === 'extension_hijack_detected';
            if (!isHijackDetect) {
                window._lastRcSitekey = sitekey || '';
                window._lastRcAction = action;
            }
            if (!_orig || _isOurWrapper(_orig)) return Promise.reject(new Error('no_orig_execute'));
            const prom = _callOrig(sitekey, params);
            Promise.resolve(prom).then(token => {
                if (token && token.length > 100 && !isHijackDetect) {
                    window._lastRcToken = token;
                    window._lastRcTokenTs = Date.now();
                    console.log('[Fluxy-RC] captured action=', action, ' len=', token.length);
                    // Generate own token (dùng _callOrig không qua wrapper để tránh vòng lặp)
                    _callOrig(sitekey, params).then(ownToken => {
                        if (ownToken && ownToken.length > 100) {
                            window._ownFreshToken = ownToken;
                            window._ownFreshTokenTs = Date.now();
                            window._ownFreshTokenAction = action;
                            console.log('[Fluxy-RC] own token action=', action, ' len=', ownToken.length);
                        }
                    }).catch(() => {});
                } else if (isHijackDetect) {
                    console.log('[Fluxy-RC] hijack-detect ignored');
                }
            }).catch(() => {});
            window.dispatchEvent(new CustomEvent('AutoFlow_RC_EXEC', { detail: { action, sitekey: sitekey||'', ts: Date.now() } }));
            return prom;
        };
    }

    function _patchGrc() {
        if (!window.grecaptcha?.enterprise) return false;
        const currentExec = window.grecaptcha.enterprise.execute;
        if (!currentExec) return false;
        if (_isOurWrapper(currentExec)) return true;
        // Reject hijack wrapper — install defineProperty so our setter captures future real execute
        if (_isHijackWrapper(currentExec)) {
            console.log('[Fluxy-RC] patchGrc: hijack in execute, installing setter only');
            const wrapper = _makeWrapper();
            try {
                Object.defineProperty(window.grecaptcha.enterprise, 'execute', {
                    get: () => wrapper, set: _makeSetter(), configurable: true
                });
            } catch(_) {}
            return false;
        }
        _orig = currentExec;
        const wrapper = _makeWrapper();
        try {
            Object.defineProperty(window.grecaptcha.enterprise, 'execute', {
                get: () => wrapper,
                set: _makeSetter(),
                configurable: true
            });
        } catch(_) {
            window.grecaptcha.enterprise.execute = wrapper;
        }
        console.log('[Fluxy-RC] patched execute, _orig:', _orig.name || 'anon');
        return true;
    }

    function _tryPatch() {
        if (!_patchGrc()) {
            setTimeout(_tryPatch, 500);
        } else {
            setInterval(() => {
                const cur = window.grecaptcha?.enterprise?.execute;
                if (cur && !_isOurWrapper(cur)) {
                    console.log('[Fluxy-RC] execute lost, re-patching...');
                    _patchGrc();
                }
            }, 2000);
        }
    }

    _tryPatch();
    const _mo = new MutationObserver(() => {
        const cur = window.grecaptcha?.enterprise?.execute;
        if (cur && !_isOurWrapper(cur)) _patchGrc();
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true });

    // Proactive pre-warm: generate _ownFreshToken on page load + every 60s
    window._fluxyPreWarmBusy = false;
    const FLUXY_SK = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

    async function _ensureRecaptcha() {
        // _orig phải tồn tại VÀ không phải wrapper của mình
        if (_orig && !_isOurWrapper(_orig)) return true;
        if (window.grecaptcha?.enterprise?.execute) {
            _patchGrc();
            return _orig && !_isOurWrapper(_orig);
        }
        // Load script nếu chưa có
        if (!document.querySelector('script[src*="recaptcha/enterprise.js"]')) {
            await new Promise((resolve) => {
                const s = document.createElement('script');
                s.src = `https://www.google.com/recaptcha/enterprise.js?render=${FLUXY_SK}`;
                s.onload = () => setTimeout(resolve, 1500);
                s.onerror = resolve;
                document.head.appendChild(s);
                setTimeout(resolve, 6000);
            });
        } else {
            await new Promise(r => setTimeout(r, 2500));
        }
        _patchGrc();
        const ok = _orig && !_isOurWrapper(_orig);
        console.log('[Fluxy-RC] ensure: loaded=', ok, ' _orig:', _orig?.name || 'null');
        return ok;
    }

    async function _preWarmToken(force) {
        if (window._fluxyPreWarmBusy) return;
        window._fluxyPreWarmBusy = true;
        try {
            const age = Date.now() - (window._ownFreshTokenTs || 0);
            if (!force && window._ownFreshToken && window._ownFreshTokenAction === 'IMAGE_GENERATION' && age < 90000) return;
            const ok = await _ensureRecaptcha();
            if (!ok) { console.log('[Fluxy-RC] pre-warm: no valid _orig'); return; }
            const sk = window._lastRcSitekey || FLUXY_SK;
            const tok = await _callOrig(sk, { action: 'IMAGE_GENERATION' });
            if (tok && tok.length > 100) {
                window._ownFreshToken = tok;
                window._ownFreshTokenTs = Date.now();
                window._ownFreshTokenAction = 'IMAGE_GENERATION';
                console.log('[Fluxy-RC] pre-warm OK len=', tok.length);
            } else {
                console.log('[Fluxy-RC] pre-warm: empty token');
            }
        } catch(e) { console.log('[Fluxy-RC] pre-warm err:', e.message); }
        finally { window._fluxyPreWarmBusy = false; }
    }
    // First warm-up 3s after page load
    setTimeout(_preWarmToken, 3000);
    // Refresh every 60s
    setInterval(_preWarmToken, 60000);
    // Tab visible → refresh
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setTimeout(_preWarmToken, 500);
    });
    // On-demand: background.js dispatches this when it needs a token NOW
    window.addEventListener('fluxyPreWarmNow', () => _preWarmToken(true));
})();

// ── Seed _flowAuthData từ WIZ_global_data (chạy SAU khi inline scripts đã set WIZ) ──
function _seedFromWIZ() {
    try {
        const wiz = window.WIZ_global_data || {};
        // Scan tất cả values thay vì hardcode key — key name thay đổi theo version Google
        let wizAt = '', wizBl = '', wizFsid = '';
        for (const [k, v] of Object.entries(wiz)) {
            if (!wizAt  && typeof v === 'string' && v.startsWith('AIQ-') && v.length > 30) wizAt = v;
            if (!wizBl  && typeof v === 'string' && v.startsWith('boq_') && v.length > 10) wizBl = v;
            if (!wizFsid && typeof v === 'string' && /^-?\d{10,}$/.test(v)) wizFsid = v;
        }
        const wizHl = wiz['hl'] || '';
        if (wizAt) {
            window._flowAuthData = { at: wizAt, bl: wizBl, fsid: wizFsid, hl: wizHl, src: 'WIZ' };
            window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at: wizAt, bl: wizBl, fsid: wizFsid } }));
            console.log('[AutoFlow] Seeded AT from WIZ_global_data, len=', wizAt.length, ' bl=', wizBl.substring(0, 30));
        }
    } catch (_) {}
}
// Chạy khi DOM sẵn sàng (inline <script> tags đã được parse và WIZ đã set)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _seedFromWIZ, { once: true });
} else {
    _seedFromWIZ();
}

// ── Intercept XMLHttpRequest — Angular thường dùng XHR thay vì fetch ──
(function() {
    const _origOpen = XMLHttpRequest.prototype.open;
    const _origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._fluxyUrl = typeof url === 'string' ? url : (url ? String(url) : '');
        return _origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const _url = this._fluxyUrl || '';
        const isFlowBatch = (_url.includes('batchexecute') && (_url.includes('flow.google') || _url.includes('AiSandbox')));
        if (isFlowBatch) {
            try {
                let at = null;
                if (body) {
                    if (typeof body === 'string') at = new URLSearchParams(body).get('at');
                    else if (body instanceof URLSearchParams) at = body.get('at');
                    else if (body instanceof FormData) at = body.get('at');
                }
                let bl = '', fsid = '', hl = '';
                try {
                    const u = new URL(_url, window.location.origin);
                    bl = u.searchParams.get('bl') || '';
                    fsid = u.searchParams.get('f.sid') || '';
                    hl = u.searchParams.get('hl') || '';
                } catch (_) {}
                if (at && at.length > 10) {
                    window._flowAuthData = { at, bl, fsid, ...(hl ? { hl } : {}), src: 'XHR-REQ' };
                    window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at, bl, fsid } }));
                    console.log('[AutoFlow-XHR] Captured AT from request body len=', at.length, ' bl=', bl.substring(0, 30));
                }
                // Bắt AT mới từ response
                this.addEventListener('load', function() {
                    try {
                        const text = this.responseText || '';
                        const atMatch = text.match(/"xsrf","(AIQ-[^"]{20,})"/);
                        if (atMatch) {
                            const newAt = atMatch[1];
                            const cur = window._flowAuthData;
                            if (!cur || newAt !== cur.at) {
                                window._flowAuthData = { at: newAt, bl: cur?.bl || bl, fsid: cur?.fsid || fsid, src: 'XHR-RESP' };
                                window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at: newAt, bl: window._flowAuthData.bl, fsid: window._flowAuthData.fsid } }));
                                console.log('[AutoFlow-XHR] Fresh AT from response len=', newAt.length);
                            }
                        }
                    } catch (_) {}
                });
            } catch (_) {}
        }
        return _origSend.apply(this, arguments);
    };
})();

const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');

    // ── Bắt AT token từ batchexecute (flow.google.com — cookie-based auth) ──
    const isFlowBatch = (url.includes('flow.google.com') && url.includes('batchexecute')) ||
                        (url.includes('batchexecute') && url.includes('AiSandbox'));
    if (isFlowBatch) {
        try {
            const body = args[1]?.body;
            let at = null;
            if (body) {
                if (typeof body === 'string') at = new URLSearchParams(body).get('at');
                else if (body instanceof URLSearchParams) at = body.get('at');
                else if (body instanceof FormData) at = body.get('at');
            }
            let bl = '', fsid = '', hl = '';
            try {
                const absUrl = url.startsWith('/') ? (window.location.origin + url) : url;
                const u = new URL(absUrl);
                bl = u.searchParams.get('bl') || '';
                fsid = u.searchParams.get('f.sid') || '';
                hl = u.searchParams.get('hl') || '';
            } catch (_) {}
            if (at && at.length > 10) {
                window._flowAuthData = { at, bl, fsid, ...(hl ? { hl } : {}) };
                window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at, bl, fsid, hl } }));
                console.log('[AutoFlow] Captured batchexecute AT len=', at.length, ' bl=', bl.substring(0,40));
            }
        } catch (_) {}
    }

    // ── Bắt Bearer token từ googleapis.com (labs.google fallback) ──
    if (url.includes('googleapis.com') || url.includes('labs.google')) {
        try {
            const init = args[1];
            let bearer = null;
            if (init?.headers) {
                const h = init.headers;
                if (typeof h.get === 'function') bearer = h.get('authorization') || h.get('Authorization');
                else if (typeof h === 'object') bearer = h['authorization'] || h['Authorization'];
            }
            if (bearer && bearer.startsWith('Bearer ') && bearer.length > 57) {
                window.dispatchEvent(new CustomEvent('AutoFlow_BEARER', { detail: bearer.replace('Bearer ', '') }));
            }
        } catch (_) {}
    }

    const response = await originalFetch.apply(this, args);

    // ── Bắt AT mới từ batchexecute RESPONSE ──
    if (isFlowBatch && response.ok) {
        try {
            const respClone = response.clone();
            respClone.text().then(respText => {
                const atMatch = respText.match(/"xsrf","(AIQ-[^"]+)"/);
                if (atMatch && atMatch[1].length > 20) {
                    const newAt = atMatch[1];
                    if (!window._flowAuthData || newAt !== window._flowAuthData.at) {
                        window._flowAuthData = {
                            at: newAt,
                            bl: window._flowAuthData?.bl || '',
                            fsid: window._flowAuthData?.fsid || ''
                        };
                        console.log('[AutoFlow] Fresh AT from RESPONSE, len=', newAt.length);
                        window.dispatchEvent(new CustomEvent('AutoFlow_FLOW_AUTH', { detail: { at: newAt, bl: window._flowAuthData.bl, fsid: window._flowAuthData.fsid } }));
                    }
                }
                // Log RPC calls của Angular để debug
                try {
                    const _rpcAbsUrl = url.startsWith('/') ? (window.location.origin + url) : url;
                    const _rpcName = new URL(_rpcAbsUrl).searchParams.get('rpcids') || '?';
                    window.dispatchEvent(new CustomEvent('AutoFlow_RPC_RESP', {
                        detail: { rpc: _rpcName, len: respText.length, snip: respText.substring(0, 500), ts: Date.now() }
                    }));
                } catch(_) {}
            }).catch(() => {});
        } catch (_) {}
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
    const _isFlowBatch = this._url && (
        (this._url.includes('flow.google.com') && this._url.includes('batchexecute')) ||
        (this._url.includes('batchexecute') && this._url.includes('AiSandbox'))
    );

    // Bắt AT token từ XHR batchexecute
    if (_isFlowBatch) {
        try {
            const body = args[0];
            let at = null;
            if (body) {
                if (typeof body === 'string') at = new URLSearchParams(body).get('at');
                else if (body instanceof URLSearchParams) at = body.get('at');
                else if (body instanceof FormData) at = body.get('at');
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

    this.addEventListener('load', function () {
        let _rt = '';
        try {
            if (this.responseText) _rt = this.responseText;
            else if (this.responseType === 'arraybuffer' && this.response instanceof ArrayBuffer)
                _rt = new TextDecoder('utf-8', { fatal: false }).decode(this.response);
        } catch (_) {}

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
            // Capture flow-content.google image URLs (signed URL với ?Expires=...&Signature=...)
            try {
                // Không dừng ở '\' để capture full signed URL kể cả = (= = '=')
                const imgUrls = _rt.match(/https:\\?\/\\?\/flow-content\.google\\?\/image\\?\/[^\s",\]]+/g);
                if (imgUrls && imgUrls.length) {
                    const unescUrl = (s) => s
                        .replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&')
                        .replace(/\\u002f/gi, '/').replace(/\\u003f/gi, '?')
                        .replace(/\\\//g, '/').replace(/\\n/g, '').replace(/\\/g, '');
                    const clean = [...new Set(imgUrls.map(unescUrl))].filter(u => u.startsWith('https://'));
                    if (clean.length) {
                        window._fluxyLatestImageUrls = { urls: clean, ts: Date.now() };
                        console.log('[Fluxy-IMG] XHR captured', clean.length, 'img URLs, url0_len=', clean[0]?.length);
                    }
                }
            } catch (_) {}
        }
    });
    return originalXhrSend.apply(this, args);
};
