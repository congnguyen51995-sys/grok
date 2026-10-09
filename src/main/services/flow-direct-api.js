'use strict';

// flow-direct-api.js — gọi flow.google.com batchexecute trực tiếp từ Node.js
// Dùng cookie export từ browser, KHÔNG cần Playwright, KHÔNG cần extension

const { fetch: undiciFetch } = require('undici');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BATCH_BASE = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute';

// Dùng Electron session để inject cookies vào Chromium's native cookie store
// → session.fetch() tự gửi cookies đúng chuẩn browser (không set Cookie header thủ công)
// Electron 28 có session.fetch() available

let _flowSession = null;
let _sessionCookieKey = null; // simple cache key

async function getFlowSession(cookies) {
    const { session } = require('electron');
    // Dùng partition riêng để không ảnh hưởng tới app session
    if (!_flowSession) _flowSession = session.fromPartition('memory:flow-direct-api');
    const sess = _flowSession;

    // Chỉ re-inject khi cookies thay đổi
    const cKey = cookies.length + '_' + (cookies[0]?.value || '').substring(0, 12);
    if (_sessionCookieKey === cKey) return sess;
    _sessionCookieKey = cKey;

    // Xóa cookies google cũ trong session
    for (const dom of ['google.com', 'flow.google.com']) {
        const old = await sess.cookies.get({ domain: dom }).catch(() => []);
        for (const c of old) {
            await sess.cookies.remove(`https://${dom}`, c.name).catch(() => {});
        }
    }
    // Inject cookies mới
    let ok = 0, fail = 0;
    for (const c of cookies) {
        try {
            const dom = (c.domain || 'google.com').replace(/^\./, '');
            await sess.cookies.set({
                url: `https://${dom}/`,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                secure: !!c.secure,
                httpOnly: !!c.httpOnly,
                expirationDate: c.expirationDate || undefined,
                sameSite: c.sameSite === 'no_restriction' ? 'no_restriction'
                        : c.sameSite === 'strict' ? 'strict' : 'lax',
            });
            ok++;
        } catch (_) { fail++; }
    }
    console.log(`[FlowDirect] session cookies inject: ok=${ok} fail=${fail}`);
    return sess;
}

// sessionFetch: dùng Electron session để gọi URL (dùng cho checkCookiesValid và download)
async function sessionFetch(url, options, cookies, sendLog) {
    try {
        const sess = await getFlowSession(cookies);
        if (typeof sess.fetch !== 'function') throw new Error('session.fetch not available');
        const hdrs = { ...(options.headers || {}) };
        delete hdrs.cookie; delete hdrs.Cookie;
        return await sess.fetch(url, { ...options, headers: hdrs });
    } catch (e) {
        sendLog?.(`[FlowDirect] sessionFetch lỗi: ${e.message} → fallback undici`);
        return undiciFetch(url, options);
    }
}

// Playwright browser/page — reuse giữa các lần gọi
let _pwBrowser = null;
let _pwPage = null;
let _pwKey = null;
let _capturedPageAt = null;
let _capturedPageBl = null;
let _capturedPageFsid = null;

// (không cần click queue nữa — dùng response interception, không cần sequential)

async function getPlaywrightPage(projectId, cookies, sendLog) {
    const { chromium } = require('playwright');
    const key = `${projectId}_${cookies.length}_${(cookies[0]?.value || '').substring(0, 8)}`;

    // Reuse nếu cùng project+cookies và page còn sống
    if (_pwBrowser && _pwPage && !_pwPage.isClosed() && _pwKey === key) {
        sendLog?.('[FlowDirect] Reuse Playwright page');
        return _pwPage;
    }

    // Đóng browser cũ
    if (_pwBrowser) { await _pwBrowser.close().catch(() => {}); _pwBrowser = null; _pwPage = null; }

    sendLog?.('[FlowDirect] Playwright: launch Chrome...');
    _pwBrowser = await chromium.launch({
        headless: false,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--window-position=-32000,-32000',
            '--window-size=1,1',
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ],
    });

    const context = await _pwBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'vi-VN',
    });

    // Ẩn navigator.webdriver
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
    });

    // Inject cookies
    const pwCookies = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.google.com',
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expires: c.expirationDate || -1,
        sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
    }));
    await context.addCookies(pwCookies);

    _pwPage = await context.newPage();
    _pwKey = key;
    _capturedPageAt = null;
    _capturedPageBl = null;
    _capturedPageFsid = null;

    // Intercept batchexecute responses của PAGE tự gọi — capture AT, BL, FSID
    _pwPage.on('response', async response => {
        if (!response.url().includes('batchexecute')) return;
        const status = response.status();
        const body = await response.text().catch(() => '');
        sendLog?.(`[FlowDirect] Page batchexecute HTTP ${status}: ${body.substring(0, 80)}`);
        if (status === 200) {
            const atM = body.match(/"xsrf","(AIQ-[^"]+)"/);
            if (atM && !_capturedPageAt) { _capturedPageAt = atM[1]; sendLog?.(`[FlowDirect] Captured AT: ${atM[1].substring(0, 20)}`); }
        }
    });

    sendLog?.('[FlowDirect] Playwright: load flow page...');
    await _pwPage.goto(`https://flow.google.com/project/${projectId}`, {
        waitUntil: 'domcontentloaded',  // networkidle never fires — Angular polls batchexecute continuously
        timeout: 30000,
    });

    const finalUrl = _pwPage.url();
    if (finalUrl.includes('accounts.google.com') || finalUrl.includes('ServiceLogin')) {
        throw new Error('COOKIE_EXPIRED: redirect sang accounts.google.com — export lại cookie');
    }

    // Đợi thêm để page JS hoàn tất auth handshake với Google
    await _pwPage.waitForTimeout(2000);

    return _pwPage;
}

// Chạy fetch() bên trong Playwright page context — trả { status, text, ok }
async function pageRpc(page, url, opts = {}) {
    return page.evaluate(async ([u, o]) => {
        try {
            const r = await fetch(u, {
                method: o.method || 'GET',
                headers: o.headers || {},
                body: o.body != null ? o.body : undefined,
                credentials: 'include',
            });
            return { status: r.status, text: await r.text(), ok: r.ok };
        } catch (e) {
            return { status: 0, text: e.message, ok: false };
        }
    }, [url, opts]);
}

// Đọc BL + FSID từ WIZ_global_data của page đã load
async function getPageTokensFromWindow(page) {
    try {
        return await page.evaluate(() => {
            const wiz = window.WIZ_global_data || {};
            return { bl: wiz.cfb2h || '', fsid: String(wiz['f.sid'] || '') };
        });
    } catch (_) {
        return { bl: '', fsid: '' };
    }
}

// Cookies quan trọng nhất — hết hạn 1 trong số này → session chết
const KEY_SESSION_COOKIES = ['__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS', 'SAPISID'];

// Kiểm tra expiry date client-side (nhanh, không cần network)
function checkCookieExpiry(cookies) {
    const now = Date.now() / 1000;
    for (const name of KEY_SESSION_COOKIES) {
        const c = cookies.find(x => x.name === name);
        if (c && c.expirationDate && c.expirationDate < now) {
            const expDate = new Date(c.expirationDate * 1000).toLocaleDateString('vi-VN');
            return { expired: true, cookie: name, expiredAt: expDate };
        }
    }
    return { expired: false };
}

// Kiểm tra cookie còn sống hay không (expiry + network check)
async function checkCookiesValid(cookies) {
    if (!cookies?.length) return { valid: false, reason: 'Chưa có cookie — vào Settings để nhập' };

    const expiry = checkCookieExpiry(cookies);
    if (expiry.expired) {
        return { valid: false, reason: `Cookie "${expiry.cookie}" đã hết hạn từ ${expiry.expiredAt} — export lại từ CocCoc` };
    }

    const cookieHeader = buildCookieHeader(cookies);
    const authHeader = buildAuthHeader(cookies);
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const resp = await undiciFetch('https://flow.google.com/', {
            headers: {
                'Cookie': cookieHeader,
                'Authorization': authHeader || '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'vi-VN,vi;q=0.9',
            },
            redirect: 'follow',
            signal: ctrl.signal,
        });
        clearTimeout(t);

        const finalUrl = resp.url || '';
        if (finalUrl.includes('accounts.google.com') || finalUrl.includes('/signin') || finalUrl.includes('ServiceLogin')) {
            return { valid: false, reason: 'Cookie đã hết phiên — đăng nhập lại CocCoc và export cookie mới' };
        }
        if (resp.status === 401 || resp.status === 403) {
            return { valid: false, reason: `Không có quyền truy cập (HTTP ${resp.status}) — thử export cookie mới` };
        }
        if (resp.status >= 500) {
            return { valid: false, reason: `Server lỗi (HTTP ${resp.status}) — thử lại sau` };
        }
        return { valid: true };
    } catch (e) {
        if (e.name === 'AbortError') return { valid: false, reason: 'Timeout khi kiểm tra kết nối' };
        return { valid: false, reason: `Lỗi mạng: ${e.message}` };
    }
}

// Build Cookie header từ JSON array (export từ browser)
function buildCookieHeader(cookies) {
    return cookies
        .filter(c => {
            const dom = (c.domain || '').replace(/^\./, '');
            return dom === 'google.com' || dom === 'flow.google.com';
        })
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
}

// SAPISIDHASH cho Authorization header
function buildAuthHeader(cookies) {
    const c = cookies.find(c => c.name === '__Secure-3PAPISID') ||
              cookies.find(c => c.name === 'SAPISID');
    if (!c) return null;
    const ts = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash('sha1')
        .update(`${ts} ${c.value} https://flow.google.com`)
        .digest('hex');
    return `SAPISIDHASH ${ts}_${hash}`;
}

// Helper: extract VIDEO URL từ batchexecute response text (chỉ /video/ path, không /image/)
function extractVideoUrl(txt) {
    for (const rpc of ['as29s', 'WuwhI']) {
        const m = txt.match(new RegExp(`"wrb\\.fr","${rpc}","((?:[^"\\\\]|\\\\.)*)"`));
        if (m) {
            try {
                const inner = JSON.parse(JSON.parse('"' + m[1] + '"'));
                const str = JSON.stringify(inner);
                // Chỉ match /video/ — không lấy /image/ (là ảnh input của R2V)
                const um = str.match(/"(https:\/\/flow-content\.google\/video\/[^"]{10,})"/);
                if (um) return um[1].replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
            } catch (_) {}
        }
    }
    // Fallback: direct match chỉ /video/ path
    const aggrM = txt.match(/https:(?:\/|\\\/){2}flow-content\.google(?:\/|\\\/)video(?:\/|\\\/)[^\s"'\\]{10,}/);
    if (aggrM) {
        return aggrM[0]
            .replace(/\\\//g, '/').replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&')
            .split(/["'\s\\]/)[0];
    }
    return null;
}

// Lấy AT + BL + FSID bằng cách GET project page
async function fetchPageTokens(projectId, cookies, sendLog) {
    try {
        const resp = await sessionFetch(`https://flow.google.com/project/${projectId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
            },
            redirect: 'follow',
        }, cookies, sendLog);
        const finalUrl = resp.url || '';
        if (finalUrl.includes('accounts.google.com') || finalUrl.includes('ServiceLogin')) {
            throw new Error('COOKIE_EXPIRED: redirect sang accounts.google.com — cookie hết phiên');
        }
        const html = await resp.text();
        let at = null, bl = '', fsid = '';
        const atM = html.match(/"xsrf"\s*,\s*"(AIQ-[^"]+)"/)
                 || html.match(/"SNlM0e"\s*:\s*"(AIQ-[^"]+)"/);
        if (atM) at = atM[1];
        const blM = html.match(/"cfb2h"\s*:\s*"([^"]+)"/) || html.match(/"bl"\s*:\s*"([^"]+)"/);
        if (blM) bl = blM[1];
        const fsidM = html.match(/"FdrFJe"\s*:\s*"(-?\d+)"/) || html.match(/"f\.sid"\s*:\s*"(-?\d+)"/);
        if (fsidM) fsid = fsidM[1];
        return { at, bl, fsid };
    } catch (e) {
        if (e.message.startsWith('COOKIE_EXPIRED')) throw e;
        return { at: null, bl: '', fsid: '' };
    }
}

// Trigger T2V — load trang thật trong Playwright Chrome ẩn, gọi fetch() từ page context
async function triggerT2VViaNode({ prompt, modelCode, aspectCode, projectId, cookies, sendLog }) {
    // Bước 1: Load trang flow trong Playwright Chrome (headless:false, off-screen)
    const win = await getPlaywrightPage(projectId, cookies, sendLog);

    // Headers cho batchexecute — chỉ set những gì browser không tự set
    // (origin, referer, user-agent là forbidden headers trong page.evaluate fetch — browser tự set)
    const baseHdrs = {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1',
    };

    const mkParams = (rpc, bl, fsid) => {
        const u = new URLSearchParams({
            rpcids: rpc, bl: bl || '', hl: 'vi', rt: 'c',
            'source-path': `/project/${projectId}`,
            'soc-app': '1', 'soc-platform': '1', 'soc-device': '1',
        });
        if (fsid) u.set('f.sid', fsid);
        return u.toString();
    };

    // Bước 2: Lấy BL + FSID từ WIZ_global_data + debug log
    const wizRaw = await win.evaluate(() => {
        const w = window.WIZ_global_data || {};
        return { bl: w.cfb2h || '', fsid: String(w['f.sid'] || w.FdrFJe || ''), keys: Object.keys(w).join(',') };
    }).catch(() => ({ bl: '', fsid: '', keys: '' }));
    const { bl, fsid } = wizRaw;
    sendLog?.(`[FlowDirect] WIZ: BL=${bl.substring(0, 25)} FSID=${fsid || 'empty'} keys=${wizRaw.keys.substring(0, 80)}`);

    // Bước 3: Lấy AT — ưu tiên từ intercepted page response, fallback nzlxg
    let at = _capturedPageAt;
    if (!at) {
        // Thử lấy AT từ WIZ_global_data.SNlM0e (Angular embed)
        const pageAt = await win.evaluate(() => {
            const w = window.WIZ_global_data || {};
            if (w.SNlM0e) return w.SNlM0e;
            for (const s of document.querySelectorAll('script')) {
                const m = (s.textContent || '').match(/"(?:SNlM0e|xsrf)":"(AIQ-[^"]+)"/);
                if (m) return m[1];
            }
            return null;
        }).catch(() => null);
        if (pageAt) {
            at = pageAt;
            sendLog?.(`[FlowDirect] AT từ page state: ${at.substring(0, 20)}...`);
        }
    } else {
        sendLog?.(`[FlowDirect] AT từ page batchexecute: ${at.substring(0, 20)}...`);
    }

    if (!at) {
        // Last resort: tự gọi nzlxg
        sendLog?.('[FlowDirect] nzlxg (page context)...');
        const nzFreq = JSON.stringify([[['nzlxg', '[]', null, 'generic']]]);
        const nzResult = await pageRpc(win, `${BATCH_BASE}?${mkParams('nzlxg', bl, fsid)}`, {
            method: 'POST', headers: baseHdrs,
            body: `f.req=${encodeURIComponent(nzFreq)}`,
        });
        sendLog?.(`[FlowDirect] nzlxg HTTP ${nzResult.status} | body: ${nzResult.text.substring(0, 120)}`);
        if (nzResult.status === 401) throw new Error(`nzlxg 401 — cookie không đủ cho batchexecute. body=${nzResult.text.substring(0, 80)}`);
        if (nzResult.status === 403) throw new Error(`nzlxg 403 — không có quyền. body=${nzResult.text.substring(0, 80)}`);
        const atM = nzResult.text.match(/"xsrf","(AIQ-[^"]+)"/);
        if (!atM) throw new Error(`NO_AT: nzlxg không trả AT. resp=${nzResult.text.substring(0, 200)}`);
        at = atM[1];
    }
    sendLog?.(`[FlowDirect] AT: ${at.substring(0, 20)}...`);

    // Bước 4: as29s pre-register uuid3
    const uuid1 = crypto.randomUUID().toUpperCase();
    const uuid2 = crypto.randomUUID().toUpperCase();
    const uuid3 = crypto.randomUUID().toUpperCase();
    const myUuids = new Set([uuid1.toLowerCase(), uuid2.toLowerCase(), uuid3.toLowerCase()]);

    const as29sPreFreq = JSON.stringify([[['as29s', JSON.stringify([uuid3]), null, 'generic']]]);
    await pageRpc(win, `${BATCH_BASE}?${mkParams('as29s', bl, fsid)}`, {
        method: 'POST', headers: baseHdrs,
        body: `f.req=${encodeURIComponent(as29sPreFreq)}&at=${encodeURIComponent(at)}`,
    }).catch(() => {});

    // Bước 5: YhhmEf để bắt đầu generation
    const aspectRow = [null, 22, null, null, null, projectId, null, null, null, null, ['', 1]];
    const task = [
        [null, null, [[[prompt]]]],
        modelCode,
        aspectCode,
        null,
        [null, null, null, null, uuid1, uuid2],
    ];
    const inner = [[task], aspectRow, [uuid3, 2]];
    const yhFreq = JSON.stringify([[['YhhmEf', JSON.stringify(inner), null, 'generic']]]);

    sendLog?.('[FlowDirect] YhhmEf (page context)...');
    const yhResult = await pageRpc(win, `${BATCH_BASE}?${mkParams('YhhmEf', bl, fsid)}`, {
        method: 'POST', headers: baseHdrs,
        body: `f.req=${encodeURIComponent(yhFreq)}&at=${encodeURIComponent(at)}`,
    });
    sendLog?.(`[FlowDirect] YhhmEf HTTP ${yhResult.status}`);
    if (yhResult.status === 401) throw new Error('COOKIE_EXPIRED: YhhmEf 401 — cookie hết phiên');
    if (!yhResult.ok && yhResult.status !== 0) throw new Error(`YhhmEf HTTP ${yhResult.status}: ${yhResult.text.substring(0, 300)}`);

    const yhBody = yhResult.text;
    sendLog?.(`[FlowDirect] YhhmEf resp: ${yhBody.substring(0, 150)}`);

    // Parse operationId, mediaId, workflowId, serverPid
    const allUuids = [...yhBody.matchAll(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi)].map(m => m[1]);
    const serverUuids = allUuids.filter(u => !myUuids.has(u.toLowerCase()));
    const operationId = serverUuids[0] || null;
    if (!operationId) throw new Error(`Không tìm thấy operationId. body=${yhBody.substring(0, 400)}`);

    let mediaId = null, workflowId = null, serverPid = null;
    try {
        const wm = yhBody.match(/"wrb\.fr","YhhmEf","((?:[^"\\]|\\.)*)"/);
        if (wm) {
            const parsed = JSON.parse(JSON.parse('"' + wm[1] + '"'));
            const isServer = s => typeof s === 'string' && s.includes('-') && !myUuids.has(s.toLowerCase());
            if (Array.isArray(parsed?.[3]?.[0])) {
                if (isServer(parsed[3][0][0])) mediaId = parsed[3][0][0];
                if (isServer(parsed[3][0][1])) serverPid = parsed[3][0][1];
                if (isServer(parsed[3][0][2])) workflowId = parsed[3][0][2];
            }
        }
    } catch (_) {}
    if (!mediaId && serverUuids[1]) mediaId = serverUuids[1];

    sendLog?.(`[FlowDirect] YhhmEf OK: opId=${operationId.substring(0, 8)} mediaId=${(mediaId || 'n/a').substring(0, 8)}`);
    return { operationId, mediaId, workflowId, serverPid, at, bl, fsid, win };
}

// Poll jwpduf → as29s từ Node.js
async function pollForVideoUrl({ operationId, mediaId, workflowId, serverPid, projectId, cookies, at, bl, fsid, win: passedWin, sendLog, maxWaitMs = 600000 }) {
    const pid = serverPid || projectId;
    let liveAt = at, liveBl = bl, liveFsid = fsid;

    // Lấy/reuse Playwright page
    const win = (passedWin && !passedWin.isClosed?.())
        ? passedWin
        : await getPlaywrightPage(pid, cookies, sendLog);

    // Nếu không có AT → lấy từ nzlxg qua page context
    if (!liveAt) {
        sendLog?.('[FlowDirect] Poll: lấy AT qua nzlxg...');
        const { bl: wb, fsid: wf } = await getPageTokensFromWindow(win);
        if (wb) liveBl = wb;
        if (wf) liveFsid = wf;
        const nzFreq = JSON.stringify([[['nzlxg', '[]', null, 'generic']]]);
        const mkP = (rpc) => {
            const u = new URLSearchParams({ rpcids: rpc, bl: liveBl || '', hl: 'vi', rt: 'c', 'source-path': `/project/${pid}`, 'soc-app': '1', 'soc-platform': '1', 'soc-device': '1' });
            if (liveFsid) u.set('f.sid', liveFsid);
            return u.toString();
        };
        const nzR = await pageRpc(win, `${BATCH_BASE}?${mkP('nzlxg')}`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' },
            body: `f.req=${encodeURIComponent(nzFreq)}`,
        });
        const atM2 = nzR.text.match(/"xsrf","(AIQ-[^"]+)"/);
        if (atM2) liveAt = atM2[1];
    }

    const pollHdrs = {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1',
    };

    const mkParams = (rpc) => {
        const u = new URLSearchParams({
            rpcids: rpc, bl: liveBl || '', hl: 'vi', rt: 'c',
            'source-path': `/project/${pid}`,
            'soc-app': '1', 'soc-platform': '1', 'soc-device': '1',
        });
        if (liveFsid) u.set('f.sid', liveFsid);
        return u.toString();
    };

    const callRpc = async (rpc, payload) => {
        const freqBody = JSON.stringify([[[rpc, JSON.stringify(payload), null, 'generic']]]);
        const body = `f.req=${encodeURIComponent(freqBody)}&at=${encodeURIComponent(liveAt || '')}`;
        const result = await pageRpc(win, `${BATCH_BASE}?${mkParams(rpc)}`, {
            method: 'POST', headers: pollHdrs, body,
        });
        return result.text;
    };

    const startTime = Date.now();
    let capturedWid = workflowId || null;

    while (Date.now() - startTime < maxWaitMs) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await new Promise(r => setTimeout(r, elapsed < 30 ? 5000 : 10000));
        sendLog?.(`[FlowDirect] Poll ${elapsed}s | opId=${operationId.substring(0, 8)} wid=${(capturedWid || 'none').substring(0, 8)}`);

        try {
            // jwpduf để lấy workflowId (và kiểm tra URL)
            if (!capturedWid) {
                const jtxt = await callRpc('jwpduf', [operationId]);
                const jUrl = extractVideoUrl(jtxt);
                if (jUrl) {
                    sendLog?.(`[FlowDirect] jwpduf URL! ${jUrl.substring(0, 60)}`);
                    return jUrl;
                }
                const jm = jtxt.match(/\\"([0-9a-f-]{36})\\",\\"[0-9a-f-]{36}\\",\\"([0-9a-f-]{36})\\",\\"CAE\\"/i)
                         || jtxt.match(/"([0-9a-f-]{36})","[0-9a-f-]{36}","([0-9a-f-]{36})","CAE"/i);
                if (jm) {
                    capturedWid = jm[2];
                    sendLog?.(`[FlowDirect] workflowId: ${capturedWid.substring(0, 8)}`);
                }
            }

            // as29s với đúng args
            const mid = mediaId || operationId;
            const wid = capturedWid || operationId;
            const atxt = await callRpc('as29s', [mid, pid, wid, 'CAE']);
            const aUrl = extractVideoUrl(atxt);
            if (aUrl) {
                sendLog?.(`[FlowDirect] as29s URL! ${aUrl.substring(0, 60)}`);
                return aUrl;
            }

            const errM = atxt.match(/\["e",(\d+)/);
            const errCode = errM ? parseInt(errM[1]) : 0;
            if (errCode && errCode !== 4 && mediaId) {
                // Retry với opId thay mediaId
                const atxt2 = await callRpc('as29s', [operationId, pid, wid, 'CAE']);
                const aUrl2 = extractVideoUrl(atxt2);
                if (aUrl2) return aUrl2;
            }
        } catch (e) {
            sendLog?.(`[FlowDirect] Poll error: ${e.message}`);
        }
    }

    throw new Error(`FlowDirect timeout: video chưa xong sau ${Math.round(maxWaitMs / 60000)} phút`);
}

// Download video về file local bằng cookie
async function downloadVideoWithCookies({ videoUrl, cookies, destPath, sendLog }) {
    sendLog?.(`[FlowDirect] Download: ${videoUrl.substring(0, 80)}`);

    const resp = await sessionFetch(videoUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://flow.google.com/',
            'Origin': 'https://flow.google.com',
        },
    }, cookies, sendLog);

    if (!resp.ok) throw new Error(`Download HTTP ${resp.status} ${resp.statusText}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 1000) throw new Error(`File quá nhỏ (${buffer.length} bytes) — có thể auth fail`);

    fs.writeFileSync(destPath, buffer);
    sendLog?.(`[FlowDirect] Download OK: ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${destPath}`);
    return destPath;
}

// ── R2V capture: undiciFetch với explicit Cookie + Origin + Authorization ──
// session.fetch() (Electron) block Origin header (forbidden) → Google trả 401.
// undiciFetch (Node.js undici) không có forbidden headers → set Origin tự do.
async function captureR2VVideoUrl({ wid, operationId, projectId, cookies, sendLog, timeoutMs = 110000 }) {
    sendLog?.(`[R2V-Direct] Init: opId=${(operationId || '').substring(0, 8)} wid=${(wid || '?').substring(0, 8)}`);

    const cookieHeader = buildCookieHeader(cookies);
    const authHeader = buildAuthHeader(cookies);

    const baseHdrs = {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-same-domain': '1',
        'Origin': 'https://flow.google.com',
        'Referer': `https://flow.google.com/project/${projectId}`,
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9',
    };
    if (authHeader) baseHdrs['Authorization'] = authHeader;

    const mkParams = (rpc) => new URLSearchParams({
        rpcids: rpc, bl: '', hl: 'vi', rt: 'c',
        'source-path': `/project/${projectId}`,
        'soc-app': '1', 'soc-platform': '1', 'soc-device': '1',
    }).toString();

    // Lấy AT qua nzlxg (undici — không bị block Origin header)
    const nzFreq = JSON.stringify([[['nzlxg', '[]', null, 'generic']]]);
    const fetchAt = async () => {
        const r = await undiciFetch(`${BATCH_BASE}?${mkParams('nzlxg')}`, {
            method: 'POST', headers: baseHdrs,
            body: `f.req=${encodeURIComponent(nzFreq)}`,
        });
        const txt = await r.text();
        sendLog?.(`[R2V-Direct] nzlxg HTTP ${r.status}: ${txt.substring(0, 80)}`);
        const m = txt.match(/"xsrf","(AIQ-[^"]+)"/);
        return m ? m[1] : null;
    };

    sendLog?.('[R2V-Direct] nzlxg (undici)...');
    let liveAt = await fetchAt();
    if (!liveAt) throw new Error('[R2V-Direct] nzlxg không trả AT — kiểm tra cookie & mạng');
    sendLog?.(`[R2V-Direct] AT OK, bắt đầu poll as29s`);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        await new Promise(r => setTimeout(r, elapsed === 0 ? 4000 : elapsed < 30 ? 5000 : 10000));

        sendLog?.(`[R2V-Direct] Poll ${Math.round((Date.now() - start) / 1000)}s | opId=${(operationId || '').substring(0, 8)}`);

        try {
            const payload = [operationId, projectId, wid || operationId, 'CAE'];
            const freq = JSON.stringify([[['as29s', JSON.stringify(payload), null, 'generic']]]);
            const reqBody = `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(liveAt)}`;

            const resp = await undiciFetch(`${BATCH_BASE}?${mkParams('as29s')}`, {
                method: 'POST', headers: baseHdrs, body: reqBody,
            });
            const txt = await resp.text();
            sendLog?.(`[R2V-Direct] as29s HTTP ${resp.status}: ${txt.substring(0, 120)}`);

            if (resp.status === 401) {
                const newAt = await fetchAt().catch(() => null);
                if (newAt) { liveAt = newAt; sendLog?.('[R2V-Direct] AT refreshed'); }
                continue;
            }

            const url = extractVideoUrl(txt);
            if (url) return url;
        } catch (e) {
            sendLog?.(`[R2V-Direct] Error: ${e.message}`);
        }
    }

    throw new Error(`R2V-Direct timeout: wid=${(wid || '?').substring(0, 8)}`);
}

// Entry point chính: tạo T2V và download — hoàn toàn từ Node.js, không extension
async function generateT2VDirect({ prompt, modelCode, aspectCode, projectId, cookies, sendLog, outputDir }) {
    if (!cookies?.length) throw new Error('Chưa có cookies — export từ CocCoc và lưu vào Settings');

    sendLog?.(`[FlowDirect] T2V: prompt="${prompt.substring(0, 40)}" model=${modelCode} pid=${projectId.substring(0, 8)}`);

    // 1. Trigger generation (opens Playwright Chrome, returns page as win)
    const genResult = await triggerT2VViaNode({ prompt, modelCode, aspectCode, projectId, cookies, sendLog });

    // 2. Poll cho đến khi có URL (reuse cùng window)
    const videoUrl = await pollForVideoUrl({
        operationId: genResult.operationId,
        mediaId: genResult.mediaId,
        workflowId: genResult.workflowId,
        serverPid: genResult.serverPid,
        projectId,
        cookies,
        at: genResult.at,
        bl: genResult.bl,
        fsid: genResult.fsid,
        win: genResult.win,
        sendLog,
    });

    // 3. Download về local
    const filename = `flow_t2v_${genResult.operationId.substring(0, 8)}_${Date.now()}.mp4`;
    const destPath = path.join(outputDir || os.tmpdir(), filename);
    await downloadVideoWithCookies({ videoUrl, cookies, destPath, sendLog });

    return { videoUrl, localPath: destPath, operationId: genResult.operationId };
}

module.exports = {
    generateT2VDirect,
    triggerT2VViaNode,
    pollForVideoUrl,
    captureR2VVideoUrl,
    downloadVideoWithCookies,
    buildCookieHeader,
    buildAuthHeader,
    fetchPageTokens,
    extractVideoUrl,
    checkCookiesValid,
    checkCookieExpiry,
};
