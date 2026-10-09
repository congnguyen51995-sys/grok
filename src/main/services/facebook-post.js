/**
 * Facebook Graph API — upload & publish a video as a Reel to a Page.
 *
 * Flow (Reels Chunked Upload):
 *   1. POST /{page-id}/video_reels  → upload_phase=start  → {video_id, upload_url}
 *   2. POST {upload_url}            → upload binary         → {success:true}
 *   3. POST /{page-id}/video_reels  → upload_phase=finish  → {success:true}
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const GV = 'v21.0';

function apiUrl(endpoint) {
  return `https://graph.facebook.com/${GV}${endpoint}`;
}

/** Simple HTTPS GET/POST helper — no extra deps. */
function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url);
    const lib      = parsed.protocol === 'https:' ? https : http;
    const isPost   = opts.method === 'POST';
    const body     = opts.body || null;

    const reqOpts = {
      hostname : parsed.hostname,
      path     : parsed.pathname + parsed.search,
      method   : opts.method || 'GET',
      headers  : opts.headers || {},
    };

    if (isPost && body) {
      if (Buffer.isBuffer(body)) {
        reqOpts.headers['Content-Length'] = body.length;
      } else {
        const enc = Buffer.from(body, 'utf8');
        reqOpts.headers['Content-Length'] = enc.length;
        // replace body with buffer
      }
    }

    const r = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode, data: null, raw });
        }
      });
    });

    r.on('error', reject);

    if (body) {
      if (Buffer.isBuffer(body)) {
        r.write(body);
      } else {
        r.write(body, 'utf8');
      }
    }
    r.end();
  });
}

/** POST JSON to Graph API */
async function graphPost(endpoint, params, token) {
  const qs  = new URLSearchParams({ access_token: token, ...params });
  const url = apiUrl(endpoint);
  const r = await req(url, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body    : qs.toString(),
  });
  if (r.data?.error) throw new Error(`FB API: ${r.data.error.message}`);
  return r.data;
}

/** GET Graph API */
async function graphGet(endpoint, params, token) {
  const qs  = new URLSearchParams({ access_token: token, ...params });
  const url = apiUrl(endpoint) + '?' + qs.toString();
  const r = await req(url);
  if (r.data?.error) throw new Error(`FB API: ${r.data.error.message}`);
  return r.data;
}

/**
 * Upload binary to the resumable upload URL (step 2).
 * Facebook uses a PUT-like POST with raw binary body and special headers.
 */
function uploadBinary(uploadUrl, filePath, token, onProgress) {
  return new Promise((resolve, reject) => {
    const stat  = fs.statSync(filePath);
    const total = stat.size;
    const parsed = new URL(uploadUrl);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const reqOpts = {
      hostname : parsed.hostname,
      path     : parsed.pathname + parsed.search,
      method   : 'POST',
      headers  : {
        'Authorization'   : `OAuth ${token}`,
        'offset'          : '0',
        'file_size'       : String(total),
        'Content-Type'    : 'application/octet-stream',
        'Content-Length'  : total,
      },
    };

    const r = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const data = JSON.parse(raw);
          if (data.error) return reject(new Error('Upload lỗi: ' + data.error.message));
          resolve(data);
        } catch {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ success: true });
          else reject(new Error(`Upload HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
      });
    });

    r.on('error', reject);

    let uploaded = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      uploaded += chunk.length;
      r.write(chunk);
      if (onProgress) onProgress(Math.round(uploaded / total * 100));
    });
    stream.on('end', () => r.end());
    stream.on('error', reject);
  });
}

/**
 * Lấy danh sách Pages của user token.
 * Returns array of {id, name, access_token}
 */
async function getPages(userToken) {
  const data = await graphGet('/me/accounts', { fields: 'id,name,access_token,category' }, userToken);
  return data.data || [];
}

/**
 * Đổi authorization code (từ OAuth callback) → short-lived user token.
 */
async function exchangeCode(code, appId, appSecret, redirectUri) {
  const url = apiUrl('/oauth/access_token') + '?' + new URLSearchParams({
    client_id     : appId,
    client_secret : appSecret,
    redirect_uri  : redirectUri,
    code,
  });
  const r = await req(url);
  if (r.data?.error) throw new Error('OAuth: ' + r.data.error.message);
  return r.data; // {access_token, token_type}
}

/**
 * Đổi short-lived user token → long-lived user token (60 ngày).
 * Cần app_id và app_secret từ Meta Developer.
 */
async function exchangeToken(shortToken, appId, appSecret) {
  const url = apiUrl('/oauth/access_token') + '?' + new URLSearchParams({
    grant_type        : 'fb_exchange_token',
    client_id         : appId,
    client_secret     : appSecret,
    fb_exchange_token : shortToken,
  });
  const r = await req(url);
  if (r.data?.error) throw new Error('Đổi token lỗi: ' + r.data.error.message);
  return r.data; // {access_token, token_type, expires_in}
}

/**
 * Kiểm tra token: trả về info (app_id, expires_at, scopes, page_id…).
 */
async function debugToken(token) {
  const url = apiUrl('/debug_token') + '?' + new URLSearchParams({
    input_token  : token,
    access_token : token,
  });
  const r = await req(url);
  return r.data?.data || r.data;
}

/**
 * Đăng Reel lên Page.
 *
 * @param {object} opts
 * @param {string} opts.pageId       - Page ID (e.g. "100067757863586")
 * @param {string} opts.pageToken    - Page Access Token
 * @param {string} opts.videoPath    - Local mp4 path
 * @param {string} opts.description  - Caption / description
 * @param {function} opts.onLog      - (msg: string) => void
 * @param {function} opts.onProgress - (pct: number) => void
 * @returns {Promise<{post_id: string}>}
 */
async function postReel({ pageId, pageToken, videoPath, description, onLog, onProgress }) {
  onLog   = onLog   || (() => {});
  onProgress = onProgress || (() => {});

  if (!fs.existsSync(videoPath)) throw new Error('File không tồn tại: ' + videoPath);

  // Step 1: initialize upload session
  onLog('📤 Khởi tạo upload session...');
  const stat = fs.statSync(videoPath);
  const init = await graphPost(`/${pageId}/video_reels`, {
    upload_phase : 'start',
    file_size    : String(stat.size),
  }, pageToken);

  const { video_id, upload_url } = init;
  if (!video_id || !upload_url) throw new Error('Không nhận được video_id / upload_url');
  onLog(`  video_id = ${video_id}`);

  // Step 2: upload binary
  onLog('📤 Đang upload video...');
  await uploadBinary(upload_url, videoPath, pageToken, (pct) => {
    onProgress(pct);
    if (pct % 20 === 0) onLog(`  Upload ${pct}%`);
  });
  onLog('  Upload xong ✓');

  // Step 3: publish
  onLog('🚀 Đăng Reel...');
  const pub = await graphPost(`/${pageId}/video_reels`, {
    upload_phase  : 'finish',
    video_id,
    video_state   : 'PUBLISHED',
    description   : description || '',
    privacy       : JSON.stringify({ value: 'EVERYONE' }),
  }, pageToken);

  onLog(`  FB response: ${JSON.stringify(pub)}`);

  // Chờ Facebook xử lý xong (processing + copyright check + publishing)
  onLog('⏳ Chờ Facebook xử lý video...');
  const deadline = Date.now() + 5 * 60 * 1000; // tối đa 5 phút
  let published = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8000));
    try {
      const st = await graphGet(`/${video_id}`, { fields: 'status' }, pageToken);
      const vs = st?.status?.video_status;
      const pp = st?.status?.publishing_phase?.status;
      onLog(`  Trạng thái: ${vs} | publish: ${pp}`);
      if (vs === 'ready' || pp === 'complete' || pp === 'published') {
        published = true;
        break;
      }
      if (vs === 'error' || pp === 'failed') {
        onLog(`  ❌ Video lỗi xử lý`);
        break;
      }
    } catch(e) { onLog(`  (check: ${e.message})`); break; }
  }

  if (published) onLog('✅ Video đã publish thành công!');
  else onLog('⚠️ Hết thời gian chờ — video có thể vẫn đang xử lý trên Facebook');

  return { video_id, ...pub };
}

/**
 * Đăng bình luận vào video/post sau khi upload xong.
 * videoId: video_id trả về từ postReel
 */
async function postComment(videoId, message, pageToken) {
  const data = await graphPost(`/${videoId}/comments`, { message }, pageToken);
  return data; // {id: "comment_id"}
}

module.exports = { postReel, postComment, getPages, debugToken, exchangeToken, exchangeCode };
