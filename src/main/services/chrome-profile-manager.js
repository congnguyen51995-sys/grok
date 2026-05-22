/**
 * chrome-profile-manager.js
 *
 * Kiến trúc "Child Process + CDP Connection":
 *   1. child_process.spawn() mở chrome.exe trực tiếp — Chrome không biết mình bị điều khiển
 *   2. Playwright chỉ KẾT NỐI qua CDP sau khi Chrome đã chạy (connectOverCDP)
 *   3. Init script xóa navigator.webdriver ngay khi page load
 *
 * Tại sao tàng hình hơn launchPersistentContext:
 *   - Không có cờ --no-sandbox (gây cảnh báo "Unsupported command-line flag")
 *   - Playwright không inject vào quá trình khởi chạy — Chrome y chang Chrome thật
 *   - CDP chỉ "nhìn vào" browser, không sửa launch flags
 */

const path      = require('path');
const fs        = require('fs');
const net       = require('net');
const { spawn } = require('child_process');

// ── Tìm Chrome trên Windows ──────────────────────────────────────────────────
function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
    // Brave — fingerprint tốt, cũng vượt Cloudflare
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    // Edge Chromium — last resort
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

// ── Kiểm tra port có đang bị chiếm không ────────────────────────────────────
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

// ── Tìm port CDP trống, bắt đầu từ 9222 ─────────────────────────────────────
async function findFreePort(startPort = 9222) {
  for (let port = startPort; port <= startPort + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `Không tìm được port trống (đã thử ${startPort}–${startPort + 20}).\n` +
    'Hãy đóng các cửa sổ Chrome/Chromium đang chạy rồi thử lại.'
  );
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Mở Chrome bằng child_process, kết nối Playwright qua CDP ────────────────
/**
 * @param {string|number} profileId
 * @param {string}        profilesBaseDir  — thư mục chứa các profile data
 * @returns {Promise<{success, profileId, userDataDir, cookieCount}>}
 */
async function openLoginWindow(profileId, profilesBaseDir) {
  const { chromium } = require('playwright');

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'Không tìm thấy Google Chrome trên máy tính.\n' +
      'Hãy cài Chrome tại: https://www.google.com/chrome/'
    );
  }

  const userDataDir = path.join(profilesBaseDir, `profile_${profileId}`);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  // ── Bước 1: Kiểm tra & chọn port CDP ──────────────────────────────────────
  const cdpPort = await findFreePort(9222);
  console.log(`[Profile ${profileId}] CDP port: ${cdpPort}`);
  console.log(`[Profile ${profileId}] Chrome: ${chromePath}`);
  console.log(`[Profile ${profileId}] Data dir: ${userDataDir}`);

  // ── Bước 2: Spawn chrome.exe — KHÔNG dùng Playwright để khởi chạy ─────────
  // Tuyệt đối không dùng --no-sandbox: gây cảnh báo và là tín hiệu automation
  const chromeProcess = spawn(
    chromePath,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'https://grok.com',
    ],
    { detached: false, stdio: 'ignore' }
  );

  chromeProcess.on('error', (err) => {
    console.error(`[Profile ${profileId}] Chrome spawn error: ${err.message}`);
  });
  console.log(`[Profile ${profileId}] Chrome started (PID: ${chromeProcess.pid})`);

  // ── Bước 3: Chờ Chrome khởi động xong (DevTools endpoint cần vài giây) ────
  await delay(3000);

  // ── Bước 4: Playwright kết nối qua CDP (không launch, chỉ attach) ──────────
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
  } catch (err) {
    try { chromeProcess.kill(); } catch (_) {}
    throw new Error(
      `Không thể kết nối CDP tới Chrome (port ${cdpPort}).\n` +
      `Nguyên nhân: ${err.message}\n` +
      'Thử khởi động lại tool và đảm bảo Chrome đã được mở.'
    );
  }

  // ── Bước 5: Lấy page từ context hiện có ───────────────────────────────────
  const contexts = browser.contexts();
  const context  = contexts[0] ?? null;
  if (!context) {
    try { chromeProcess.kill(); } catch (_) {}
    throw new Error('Không tìm thấy browser context sau khi kết nối CDP.');
  }

  const existingPages = context.pages();
  const page = existingPages.length > 0 ? existingPages[0] : await context.newPage();

  // ── Bước 6: Tiêm script xóa dấu vết webdriver ─────────────────────────────
  // addInitScript: áp dụng cho mọi navigation trong tương lai
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  // evaluate: áp dụng ngay cho trang đang mở (one-shot)
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  } catch (_) {}

  // Tự động áp dụng cho mọi tab mới user mở thêm
  context.on('page', async (newPage) => {
    try {
      await newPage.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
    } catch (_) {}
  });

  // ── Bước 7: Lưu cookies định kỳ trong lúc user đăng nhập ──────────────────
  const authFile = path.join(userDataDir, 'auth_state.json');

  const saveState = async (label) => {
    try {
      const state       = await context.storageState();
      const allCookies  = state.cookies || [];
      const grokCookies = allCookies.filter(
        (c) =>
          c.domain?.includes('grok.com')    ||
          c.domain?.includes('x.com')       ||
          c.domain?.includes('twitter.com')
      );
      fs.writeFileSync(
        authFile,
        JSON.stringify({ profileId, cookies: grokCookies, allCookies, savedAt: Date.now() }, null, 2)
      );
      if (grokCookies.length > 0) {
        console.log(`[Profile ${profileId}] [${label}] Saved ${grokCookies.length} cookies`);
      }
      return grokCookies.length;
    } catch (_) {
      return 0;
    }
  };

  // Lưu mỗi 8 giây (đảm bảo không mất dữ liệu nếu Chrome đóng đột ngột)
  const saveInterval = setInterval(() => saveState('periodic'), 8000);

  // Lưu ngay khi bất kỳ tab nào đóng — quan trọng khi user đóng tab cuối cùng
  for (const p of context.pages()) {
    p.on('close', () => saveState('page-close'));
  }
  context.on('page', (newPage) => {
    newPage.on('close', () => saveState('page-close'));
  });

  // ── Bước 8: Chờ user đóng Chrome, resolve khi CDP ngắt kết nối ───────────
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;

      clearInterval(saveInterval);

      let cookieCount = 0;
      try {
        if (fs.existsSync(authFile)) {
          const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));
          cookieCount = (saved.cookies || []).length;
        }
      } catch (_) {}

      console.log(`[Profile ${profileId}] Hoàn tất: ${cookieCount} cookies đã lưu`);
      try { chromeProcess.kill(); } catch (_) {}
      resolve({ success: true, profileId, userDataDir, cookieCount });
    };

    // CDP ngắt kết nối = Chrome đã đóng
    browser.on('disconnected', cleanup);

    // Phòng trường hợp process exit trước khi CDP event kịp fire
    chromeProcess.on('exit', () => setTimeout(cleanup, 500));
  });
}

// ── Kiểm tra đã đăng nhập chưa (đọc file, không mở browser) ──────────────────
function checkLogin(profileId, profilesBaseDir) {
  const authFile = path.join(profilesBaseDir, `profile_${profileId}`, 'auth_state.json');
  if (!fs.existsSync(authFile)) return { isLoggedIn: false, cookieCount: 0 };
  try {
    const state        = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const now          = Date.now() / 1000;
    const validCookies = (state.cookies || []).filter(
      (c) => c.expires === -1 || c.expires > now
    );
    return { isLoggedIn: validCookies.length > 0, cookieCount: validCookies.length };
  } catch (_) {
    return { isLoggedIn: false, cookieCount: 0 };
  }
}

// ── Sync cookies → Electron session ──────────────────────────────────────────
async function syncToElectronSession(profileId, profilesBaseDir, electronSession) {
  const authFile = path.join(profilesBaseDir, `profile_${profileId}`, 'auth_state.json');
  if (!fs.existsSync(authFile)) return 0;

  let state;
  try { state = JSON.parse(fs.readFileSync(authFile, 'utf8')); }
  catch (_) { return 0; }

  const cookies = state.allCookies || state.cookies || [];
  let synced = 0;

  for (const c of cookies) {
    try {
      const domain = (c.domain || '').startsWith('.') ? c.domain.slice(1) : c.domain;
      if (!domain) continue;
      await electronSession.cookies.set({
        url:            `https://${domain}`,
        name:           c.name,
        value:          c.value,
        domain:         c.domain,
        path:           c.path  || '/',
        secure:         !!c.secure,
        httpOnly:       !!c.httpOnly,
        sameSite:       normalizeSameSite(c.sameSite),
        expirationDate: c.expires > 0 ? c.expires : undefined,
      });
      synced++;
    } catch (_) {}
  }

  console.log(`[Profile ${profileId}] Synced ${synced}/${cookies.length} cookies → Electron session`);
  return synced;
}

function normalizeSameSite(val) {
  const v = (val || '').toLowerCase();
  if (v === 'strict')         return 'strict';
  if (v === 'lax')            return 'lax';
  if (v === 'no_restriction') return 'no_restriction';
  return 'no_restriction';
}

module.exports = { findChromePath, isPortFree, findFreePort, openLoginWindow, checkLogin, syncToElectronSession };
