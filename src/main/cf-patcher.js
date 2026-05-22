/**
 * cf-patcher.js — Stealth injection cho Electron BrowserWindow.
 * Được load qua session.setPreloads([cfPatcherPath]) nên chạy trước MỌI script của trang.
 * Dùng kỹ thuật inject <script> để patch main world (vượt contextIsolation).
 */
const patch = document.createElement('script');
patch.textContent = `(function() {
  'use strict';

  // ── 1. navigator.webdriver ──────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (_) {}

  // ── 2. Xóa CDP/automation artifacts ────────────────────────────────────
  const cdcKeys = Object.keys(window).filter(k => k.startsWith('cdc_') || k.includes('selenium') || k.includes('webdriver'));
  cdcKeys.forEach(k => { try { delete window[k]; } catch (_) {} });
  // Xóa process của Node/Electron khỏi main world
  try { if (window.process?.type) delete window.process; } catch (_) {}

  // ── 3. window.chrome giống Chrome thật ─────────────────────────────────
  if (!window.chrome || typeof window.chrome.runtime === 'undefined') {
    const chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED:'disabled', INSTALLED:'installed', NOT_INSTALLED:'not_installed' },
        RunningState: { CANNOT_RUN:'cannot_run', READY_TO_RUN:'ready_to_run', RUNNING:'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        installState: () => {},
        runningState: () => 'cannot_run',
      },
      runtime: {
        OnInstalledReason: { INSTALL:'install', UPDATE:'update', CHROME_UPDATE:'chrome_update', SHARED_MODULE_UPDATE:'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE:'app_update', OS_UPDATE:'os_update', PERIODIC:'periodic' },
        PlatformArch: { ARM:'arm', ARM64:'arm64', X86_32:'x86-32', X86_64:'x86-64', MIPS:'mips', MIPS64:'mips64' },
        PlatformNaclArch: { ARM:'arm', X86_32:'x86-32', X86_64:'x86-64', MIPS:'mips', MIPS64:'mips64' },
        PlatformOs: { ANDROID:'android', CROS:'cros', LINUX:'linux', MAC:'mac', OPENBSD:'openbsd', WIN:'win' },
        RequestUpdateCheckStatus: { THROTTLED:'throttled', NO_UPDATE:'no_update', UPDATE_AVAILABLE:'update_available' },
        connect: () => {},
        sendMessage: () => {},
        id: undefined,
      },
      csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now(), tran: 15 }; },
      loadTimes: function() {
        return {
          requestTime: Date.now() / 1000 - 1,
          startLoadTime: Date.now() / 1000 - 0.8,
          commitLoadTime: Date.now() / 1000 - 0.5,
          finishDocumentLoadTime: Date.now() / 1000 - 0.2,
          finishLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000 - 0.1,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      },
    };
    try { Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true }); }
    catch (_) { window.chrome = chrome; }
  }

  // ── 4. navigator.plugins giống Chrome Windows ───────────────────────────
  try {
    const plugins = [
      { name: 'PDF Viewer',        filename: 'internal-pdf-viewer',        description: 'Portable Document Format', suffixes: 'pdf', type: 'application/pdf' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer',        description: '',                          suffixes: 'pdf', type: 'application/pdf' },
      { name: 'Chromium PDF Viewer',filename:'internal-pdf-viewer',        description: '',                          suffixes: 'pdf', type: 'application/pdf' },
      { name: 'Microsoft Edge PDF Viewer',filename:'internal-pdf-viewer',  description: '',                          suffixes: 'pdf', type: 'application/pdf' },
      { name: 'WebKit built-in PDF',filename:'internal-pdf-viewer',        description: '',                          suffixes: 'pdf', type: 'application/pdf' },
    ];
    const pluginArray = plugins.map((p, i) => {
      const mt = { type: p.type, suffixes: p.suffixes, description: p.description, enabledPlugin: null };
      const plugin = { name: p.name, filename: p.filename, description: p.description, length: 1, item: () => mt, namedItem: () => mt };
      mt.enabledPlugin = plugin;
      return plugin;
    });
    pluginArray.item = (i) => pluginArray[i];
    pluginArray.namedItem = (n) => pluginArray.find(p => p.name === n);
    pluginArray.refresh = () => {};
    Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, configurable: true });
  } catch (_) {}

  // ── 5. navigator.mimeTypes ──────────────────────────────────────────────
  try {
    const mimeTypes = [
      { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: navigator.plugins[0] },
      { type: 'text/pdf',        suffixes: 'pdf', description: '', enabledPlugin: navigator.plugins[0] },
    ];
    mimeTypes.item = (i) => mimeTypes[i];
    mimeTypes.namedItem = (n) => mimeTypes.find(m => m.type === n);
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypes, configurable: true });
  } catch (_) {}

  // ── 6. navigator.languages ──────────────────────────────────────────────
  try { Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'], configurable: true }); } catch (_) {}

  // ── 7. navigator.hardwareConcurrency & deviceMemory ────────────────────
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); } catch (_) {}
  try { Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8, configurable: true }); } catch (_) {}

  // ── 8. navigator.connection ─────────────────────────────────────────────
  try {
    const conn = { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false };
    Object.defineProperty(navigator, 'connection', { get: () => conn, configurable: true });
  } catch (_) {}

  // ── 9. window.outerWidth / outerHeight giống trình duyệt thật ──────────
  try {
    if (!window.outerWidth || window.outerWidth === 0)
      Object.defineProperty(window, 'outerWidth',  { get: () => window.innerWidth  + 16, configurable: true });
    if (!window.outerHeight || window.outerHeight === 0)
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });
  } catch (_) {}

  // ── 10. screen.colorDepth ───────────────────────────────────────────────
  try { Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true }); } catch (_) {}

  // ── 11. Permissions API ─────────────────────────────────────────────────
  try {
    const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (perm) => {
        if (perm.name === 'notifications') return Promise.resolve({ state: 'denied', onchange: null });
        return origQuery(perm);
      };
    }
  } catch (_) {}

  // ── 12. WebGL vendor/renderer (ẩn Electron/SwiftShader) ─────────────────
  try {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';               // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
    const getParam2 = WebGL2RenderingContext?.prototype?.getParameter;
    if (getParam2) {
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return 'Intel Inc.';
        if (param === 37446) return 'Intel Iris OpenGL Engine';
        return getParam2.call(this, param);
      };
    }
  } catch (_) {}

  // ── 13. Tắt notification automation leak ────────────────────────────────
  try {
    if (window.Notification) {
      Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
    }
  } catch (_) {}

})();`;
document.documentElement.appendChild(patch);
patch.remove();
