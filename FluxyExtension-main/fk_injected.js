/**
 * fk_injected.js — Injected into MAIN world on flow.google.com
 * Has access to window.grecaptcha and the hijack bypass from fk_hijack_bypass.js.
 *
 * reCAPTCHA minting strategy:
 *   1. PRISTINE path: fk_hijack_bypass.js captured the real execute — calls directly
 *   2. OBJECT.ASSIGN NEUTER: fallback when pristine is unavailable but trap is detected
 *   3. WIDGET path: legacy fallback — graceful degradation
 */
const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// ─── TRPC Response Monitor ─────────────────────────────────
const _originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await _originalFetch.apply(this, args);
  try {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('/fx/api/trpc/') && response.ok) {
      const clone = response.clone();
      clone.text().then(text => {
        if (text.includes('storage.googleapis.com/ai-sandbox-videofx/')) {
          window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', {
            detail: { url, body: text },
          }));
        }
      }).catch(() => {});
    }
  } catch {}
  return response;
};


let captchaMintTail = Promise.resolve();

function resolveSitekey() {
  try {
    const cfg = window.___grecaptcha_cfg || {};
    const clients = cfg.clients || {};
    for (const k of Object.keys(clients)) {
      const c = clients[k];
      if (c && c.sitekey) return c.sitekey;
    }
  } catch (e) {}
  return SITE_KEY;
}

function waitReady(timeout = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { window.grecaptcha?.enterprise?.ready?.(fin); } catch (e) {}
    setTimeout(fin, timeout);
  });
}

const _realObjectAssign = Object.assign;

async function executeWithAssignNeuter(sitekey, action) {
  const targetAction = action;

  Object.assign = function (target, ...sources) {
    const result = _realObjectAssign.call(this, target, ...sources);
    if (result && typeof result === 'object' &&
        result.action === 'extension_hijack_detected') {
      result.action = targetAction;
    }
    return result;
  };

  try {
    await waitReady(2500);
    const token = await Promise.race([
      window.grecaptcha.enterprise.execute(sitekey, { action }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
    ]);
    return token ? String(token) : null;
  } finally {
    Object.assign = _realObjectAssign;
  }
}

async function executeWithPristine(sitekey, action) {
  const pristine = window.__fluxy_hijack?.pristine;
  if (typeof pristine !== 'function') return null;
  const token = await Promise.race([
    pristine(sitekey, { action }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
  ]);
  return token ? String(token) : null;
}

let _widgetPromise = null;
function ensureWidget(sitekey) {
  if (_widgetPromise) return _widgetPromise;
  _widgetPromise = (async () => {
    await waitReady(5000);
    let host = document.getElementById('fluxy-recaptcha-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'fluxy-recaptcha-host';
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
      document.documentElement.appendChild(host);
    }
    return await new Promise((resolve, reject) => {
      try {
        const widgetId = window.grecaptcha.enterprise.render(host, {
          sitekey,
          size: 'invisible',
          callback: () => {},
          'error-callback': (m) => reject(new Error('render_error: ' + m)),
        });
        resolve(widgetId);
      } catch (e) {
        reject(new Error('render_threw: ' + (e && e.message || e)));
      }
    });
  })().catch((e) => { _widgetPromise = null; throw e; });
  return _widgetPromise;
}

async function executeWithRetry(sitekey, action, attempts = 2) {
  let lastErr = null;
  const hijack = window.__fluxy_hijack;
  const hasPristine = typeof hijack?.pristine === 'function';
  const knownTrapped = !!hijack?.trapped;

  for (let i = 0; i < attempts; i++) {
    try {
      if (hasPristine) {
        const token = await executeWithPristine(sitekey, action);
        if (token) return token;
        lastErr = new Error('pristine_empty_token');
      }
      else if (knownTrapped) {
        const token = await executeWithAssignNeuter(sitekey, action);
        if (token) return token;
        lastErr = new Error('assign_neuter_empty_token');
      }
      else {
        await waitReady(2500);
        const widgetId = await ensureWidget(sitekey);
        const token = await Promise.race([
          window.grecaptcha.enterprise.execute(widgetId, { action }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
        ]);
        if (token) return String(token);
        lastErr = new Error('empty_token');
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw lastErr || new Error('execute_failed');
}

async function mintCaptcha(pageAction) {
  const previous = captchaMintTail.catch(() => {});
  let release;
  captchaMintTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    await waitForGrecaptcha();
    return await executeWithRetry(resolveSitekey(), pageAction);
  } finally {
    release();
  }
}

window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    const token = await mintCaptcha(pageAction);
    const hijack = window.__fluxy_hijack;
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: {
        requestId,
        token,
        bypassPath: typeof hijack?.pristine === 'function'
          ? `pristine(${hijack.source})`
          : hijack?.trapped ? 'assign_neuter' : 'legacy_widget',
      },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});

function waitForGrecaptcha(timeout = 22000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.__fluxy_hijack?.pristine) return resolve();
      if (window.grecaptcha?.enterprise?.execute) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('grecaptcha not available'));
      setTimeout(check, 200);
    };
    check();
  });
}
