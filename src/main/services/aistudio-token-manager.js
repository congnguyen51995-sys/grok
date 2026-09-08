/**
 * AI Studio Token Manager
 * Mở Google AI Studio trong Playwright, bắt OAuth token từ network request,
 * dùng token đó để gọi Gemini API với image generation (không cần API key).
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const TOKEN_CACHE_FILE = path.join(require('os').tmpdir(), 'fluxy_aistudio_token.json');
const AI_STUDIO_URL = 'https://aistudio.google.com/';

// Pattern để bắt OAuth token từ header Authorization trong request của AI Studio
const GEMINI_API_HOSTS = ['generativelanguage.googleapis.com', 'autopush-generativelanguage.sandbox.googleapis.com'];

let _browser = null;
let _context = null;
let _capturedToken = null;
let _tokenExpiry = 0;
let _profileDir = null;

function log(msg) { console.log(`[AIStudio] ${msg}`); }

function saveTokenCache(token) {
  try {
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({ token, expiry: Date.now() + 55 * 60 * 1000 }));
  } catch {}
}

function loadTokenCache() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
    if (data.expiry > Date.now() + 60_000) return data.token;
  } catch {}
  return null;
}

async function _launchBrowser(profileDir, onStatus) {
  if (_browser && _browser.isConnected()) return;

  _profileDir = profileDir || path.join(require('os').homedir(), '.fluxy_aistudio_profile');
  if (!fs.existsSync(_profileDir)) fs.mkdirSync(_profileDir, { recursive: true });

  onStatus?.('🌐 Đang mở Chrome để kết nối AI Studio...');
  _context = await chromium.launchPersistentContext(_profileDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 800 },
  });
  _browser = _context.browser() || { isConnected: () => !!_context };

  // Intercept network để bắt OAuth token
  _context.on('request', (req) => {
    try {
      const url = req.url();
      const isGemini = GEMINI_API_HOSTS.some(h => url.includes(h));
      if (!isGemini) return;
      const auth = req.headers()['authorization'] || req.headers()['x-goog-api-key'];
      if (auth && auth.startsWith('Bearer ')) {
        const token = auth.replace('Bearer ', '').trim();
        if (token !== _capturedToken) {
          _capturedToken = token;
          _tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 phút
          saveTokenCache(token);
          log(`✅ Đã bắt OAuth token mới (...${token.slice(-8)})`);
        }
      }
    } catch {}
  });
}

/**
 * Mở AI Studio và đợi user gửi 1 request để bắt token.
 * onStatus(msg) — callback cập nhật trạng thái cho UI
 * onToken(token) — callback khi có token
 */
async function connectAndCaptureToken({ profileDir, onStatus, onToken } = {}) {
  // Thử load cache trước
  const cached = loadTokenCache();
  if (cached) {
    _capturedToken = cached;
    onStatus?.('✅ Token từ cache còn hiệu lực — sẵn sàng tạo ảnh!');
    onToken?.(cached);
    return cached;
  }

  await _launchBrowser(profileDir, onStatus);

  const pages = _context.pages();
  const page = pages.length > 0 ? pages[0] : await _context.newPage();
  await page.bringToFront();

  onStatus?.('🔑 Vui lòng login Google và thử generate bất kỳ nội dung trong AI Studio...');
  await page.goto(AI_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // Đợi token được bắt (max 5 phút)
  onStatus?.('⏳ Đang chờ token... Hãy thử tạo 1 prompt bất kỳ trong AI Studio');
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (_capturedToken) {
        clearInterval(check);
        onStatus?.('✅ Đã bắt được OAuth token — sẵn sàng tạo ảnh!');
        onToken?.(_capturedToken);
        resolve(_capturedToken);
      }
    }, 1000);
    setTimeout(() => {
      clearInterval(check);
      reject(new Error('Timeout 5 phút — không bắt được token. Hãy thử generate gì đó trong AI Studio'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Lấy token hiện tại, tự động refresh nếu sắp hết hạn
 */
async function getToken({ profileDir, onStatus } = {}) {
  // Token còn hiệu lực (còn hơn 2 phút)
  if (_capturedToken && _tokenExpiry > Date.now() + 2 * 60 * 1000) return _capturedToken;

  // Thử cache
  const cached = loadTokenCache();
  if (cached) { _capturedToken = cached; _tokenExpiry = Date.now() + 55 * 60 * 1000; return cached; }

  // Cần refresh — trigger 1 request từ AI Studio
  if (!_context) await _launchBrowser(profileDir, onStatus);

  onStatus?.('🔄 Token hết hạn — đang refresh...');
  try {
    const pages = _context.pages();
    const page = pages.length > 0 ? pages[0] : await _context.newPage();
    // Ping AI Studio để trigger network request có auth header
    await page.evaluate(() => {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { credentials: 'include' }).catch(() => {});
    });
  } catch {}

  // Đợi token mới (max 10s)
  await new Promise(r => setTimeout(r, 3000));
  if (_capturedToken && _tokenExpiry > Date.now()) return _capturedToken;

  throw new Error('Không lấy được token — vui lòng kết nối lại AI Studio');
}

/**
 * Tạo ảnh dùng OAuth token từ AI Studio
 * model: tên model (vd: 'gemini-3.1-flash-image')
 * prompt: text prompt
 * numImages: số ảnh
 * aspectRatio: '16:9', '1:1', etc.
 */
async function generateImage({ model, prompt, numImages = 1, aspectRatio = '1:1', onStatus } = {}) {
  const token = await getToken({ onStatus });

  const results = [];
  const calls = Array.from({ length: numImages }, async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Token hết hạn → xóa cache và throw để caller retry
      if (res.status === 401) { _capturedToken = null; _tokenExpiry = 0; }
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    for (const p of (data?.candidates?.[0]?.content?.parts || [])) {
      if (p.inline_data?.data) {
        results.push({ b64: p.inline_data.data, mime: p.inline_data.mime_type || 'image/jpeg' });
      }
    }
  });

  await Promise.all(calls);
  if (!results.length) throw new Error('API không trả về ảnh — thử prompt khác');
  return results;
}

function closeBrowser() {
  _context?.close().catch(() => {});
  _context = null;
  _browser = null;
}

function getStatus() {
  return {
    hasToken: !!_capturedToken && _tokenExpiry > Date.now(),
    tokenExpiry: _tokenExpiry,
    browserOpen: !!_context,
  };
}

module.exports = { connectAndCaptureToken, getToken, generateImage, closeBrowser, getStatus };
