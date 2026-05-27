'use strict';
/**
 * proxy-manager.js
 * Quản lý danh sách proxy xoay cho VeoEngine.
 * Hỗ trợ HTTP/HTTPS proxy qua CONNECT tunnel — không cần thư viện thêm.
 */

const net   = require('net');
const tls   = require('tls');
const https = require('https');

// ─── Proxy entry shape ────────────────────────────────────────────────────────
// { url: 'http://user:pass@host:port', label: '', enabled: true, failCount: 0, lastFailMs: 0 }

class ProxyManager {
    constructor() {
        this._proxies  = [];
        this._enabled  = false;
        this._rr       = 0;  // round-robin cursor
    }

    // ── Getters ───────────────────────────────────────────────────────────────
    get enabled()  { return this._enabled; }
    get proxies()  { return this._proxies; }

    // ── Serialise / deserialise ───────────────────────────────────────────────
    toJSON() {
        return { enabled: this._enabled, proxies: this._proxies };
    }

    load(data) {
        if (!data) return;
        try {
            const d = typeof data === 'string' ? JSON.parse(data) : data;
            this._enabled = !!d.enabled;
            this._proxies = Array.isArray(d.proxies)
                ? d.proxies.map(p => ({
                    url:        p.url     || '',
                    label:      p.label   || '',
                    enabled:    p.enabled !== false,
                    failCount:  p.failCount  || 0,
                    lastFailMs: p.lastFailMs || 0,
                }))
                : [];
        } catch {}
    }

    // ── Management ────────────────────────────────────────────────────────────
    setEnabled(v) {
        this._enabled = !!v;
    }

    setProxies(list) {
        this._proxies = (list || []).map(p => ({
            url:        (typeof p === 'string' ? p : p.url)?.trim() || '',
            label:      (typeof p === 'string' ? '' : p.label) || '',
            enabled:    typeof p === 'string' ? true : p.enabled !== false,
            failCount:  typeof p === 'string' ? 0 : (p.failCount || 0),
            lastFailMs: typeof p === 'string' ? 0 : (p.lastFailMs || 0),
        })).filter(p => p.url);
        this._rr = 0;
    }

    // ── Rotation ──────────────────────────────────────────────────────────────
    /**
     * Trả về URL proxy tiếp theo (round-robin).
     * Bỏ qua proxy bị disable hoặc quá nhiều lỗi liên tiếp.
     * Trả về null nếu proxy tắt hoặc không có proxy hợp lệ.
     */
    getNext() {
        if (!this._enabled || this._proxies.length === 0) return null;
        const active = this._proxies.filter(p => p.enabled && p.failCount < 5);
        if (active.length === 0) {
            // Reset fail count và thử lại từ đầu
            this._proxies.forEach(p => { if (p.enabled) p.failCount = 0; });
            const retry = this._proxies.filter(p => p.enabled);
            if (retry.length === 0) return null;
            const entry = retry[this._rr % retry.length];
            this._rr++;
            return entry.url;
        }
        const entry = active[this._rr % active.length];
        this._rr++;
        return entry.url;
    }

    markSuccess(url) {
        const p = this._findProxy(url);
        if (p) { p.failCount = 0; }
    }

    markFailed(url) {
        const p = this._findProxy(url);
        if (p) { p.failCount++; p.lastFailMs = Date.now(); }
    }

    _findProxy(url) {
        return this._proxies.find(p => p.url === url);
    }

    // ── Test a single proxy ───────────────────────────────────────────────────
    static async testProxy(rawUrl, timeoutMs = 8000) {
        const TEST_HOST = 'labs.google';
        const TEST_PORT = 443;

        let pUrl = (rawUrl || '').trim();
        if (!pUrl) return { ok: false, error: 'URL trống' };
        if (!/^https?:\/\//i.test(pUrl)) pUrl = 'http://' + pUrl;

        let proxy;
        try { proxy = new URL(pUrl); }
        catch { return { ok: false, error: 'URL proxy không hợp lệ' }; }

        const proxyHost = proxy.hostname;
        const proxyPort = parseInt(proxy.port) || 80;
        const authB64 = proxy.username
            ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
            : null;
        const authLine = authB64 ? `\r\nProxy-Authorization: Basic ${authB64}` : '';

        return new Promise(resolve => {
            let settled = false;
            const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
            const t0 = Date.now();

            const timer = setTimeout(() => {
                settle({ ok: false, ms: timeoutMs, error: 'Timeout kết nối proxy' });
            }, timeoutMs);

            const socket = net.connect(proxyPort, proxyHost, () => {
                socket.write(
                    `CONNECT ${TEST_HOST}:${TEST_PORT} HTTP/1.1\r\n` +
                    `Host: ${TEST_HOST}:${TEST_PORT}${authLine}\r\n\r\n`
                );
                socket.once('data', (chunk) => {
                    clearTimeout(timer);
                    socket.destroy();
                    const resp = chunk.toString();
                    if (/HTTP\/1\.[01] 200/i.test(resp)) {
                        settle({ ok: true, ms: Date.now() - t0 });
                    } else {
                        settle({ ok: false, ms: Date.now() - t0, error: resp.split('\r\n')[0] });
                    }
                });
            });

            socket.once('error', (e) => {
                clearTimeout(timer);
                settle({ ok: false, ms: Date.now() - t0, error: e.message });
            });
            socket.setTimeout(timeoutMs, () => {
                clearTimeout(timer);
                socket.destroy();
                settle({ ok: false, ms: timeoutMs, error: 'TCP timeout' });
            });
        });
    }
}

// ─── HttpsProxyAgent ─────────────────────────────────────────────────────────
/**
 * Extends https.Agent để route HTTPS qua HTTP CONNECT proxy tunnel.
 * Compatible với Node.js https.request (option `agent`).
 */
class HttpsProxyAgent extends https.Agent {
    constructor(proxyUrl) {
        super({ keepAlive: false });
        let pUrl = (proxyUrl || '').trim();
        if (!/^https?:\/\//i.test(pUrl)) pUrl = 'http://' + pUrl;
        this._proxy = new URL(pUrl);
    }

    createConnection(options, callback) {
        const proxyHost = this._proxy.hostname;
        const proxyPort = parseInt(this._proxy.port) || 80;
        const targetHost = options.hostname || options.host || '';
        const targetPort = options.port || 443;

        const authB64 = this._proxy.username
            ? Buffer.from(`${decodeURIComponent(this._proxy.username)}:${decodeURIComponent(this._proxy.password)}`).toString('base64')
            : null;
        const authLine = authB64 ? `\r\nProxy-Authorization: Basic ${authB64}` : '';

        const socket = net.connect(proxyPort, proxyHost);

        socket.setTimeout(15000, () => {
            socket.destroy();
            callback(new Error(`Proxy TCP timeout (${proxyHost}:${proxyPort})`));
        });

        socket.once('connect', () => {
            socket.write(
                `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
                `Host: ${targetHost}:${targetPort}${authLine}\r\n\r\n`
            );

            const onData = (chunk) => {
                socket.removeListener('data', onData);
                const resp = chunk.toString();
                if (/HTTP\/1\.[01] 200/i.test(resp)) {
                    // CONNECT OK → TLS handshake
                    const tlsOpts = {
                        socket,
                        servername: options.servername || targetHost,
                        rejectUnauthorized: options.rejectUnauthorized !== false,
                    };
                    const tlsSocket = tls.connect(tlsOpts);
                    tlsSocket.once('secureConnect', () => callback(null, tlsSocket));
                    tlsSocket.once('error', (e) => callback(new Error(`TLS qua proxy: ${e.message}`)));
                } else {
                    socket.destroy();
                    callback(new Error(`Proxy CONNECT từ chối: ${resp.split('\r\n')[0]}`));
                }
            };
            socket.on('data', onData);
        });

        socket.once('error', (e) => callback(new Error(`Proxy TCP: ${e.message}`)));
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const proxyManager = new ProxyManager();

module.exports = { ProxyManager, HttpsProxyAgent, proxyManager };
