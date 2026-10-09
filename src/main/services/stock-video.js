/**
 * Stock Video Service — Pexels, Pixabay & DVIDS
 * Dùng cho Audio-to-Video: search + download clip stock miễn phí
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Tìm kiếm Pixabay ────────────────────────────────────────────────────────
function searchPixabay(keyword, apiKey, perPage = 5) {
    const q   = encodeURIComponent((keyword || 'nature').trim().slice(0, 100));
    // Lấy thêm để bù cho các clip bị loại (portrait / quá nhỏ)
    const fetchPer = Math.min(perPage * 2, 50);
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${q}&per_page=${fetchPer}&video_type=film&safesearch=true&min_width=1280`;

    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.statusCode === 429) return reject(new Error('Pixabay rate limit — thử lại sau'));
                    if (res.statusCode !== 200) return reject(new Error(`Pixabay HTTP ${res.statusCode}`));
                    const json = JSON.parse(data);
                    const hits = json.hits || [];
                    const results = hits.map(hit => {
                        const v = hit.videos || {};
                        // Chỉ chọn file LANDSCAPE (width > height) — ưu tiên large → medium → small → tiny
                        const sizes = ['large', 'medium', 'small', 'tiny'];
                        let file = null;
                        for (const sz of sizes) {
                            const f = v[sz];
                            if (f?.url && f.width > 0 && f.height > 0 && f.width > f.height) {
                                file = f;
                                break;
                            }
                        }
                        if (!file) return null; // bỏ qua clip portrait
                        return {
                            id: String(hit.id),
                            url: file.url,
                            width: file.width,
                            height: file.height,
                            duration: hit.duration,
                            thumbnail: `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg`,
                            provider: 'pixabay',
                            tags: hit.tags || '',
                        };
                    }).filter(Boolean).slice(0, perPage); // giới hạn lại đúng số lượng yêu cầu
                    resolve(results);
                } catch (e) { reject(new Error(`Pixabay parse: ${e.message}\n${data.slice(0, 200)}`)); }
            });
        }).on('error', e => reject(new Error(`Pixabay request: ${e.message}`)));
    });
}

// ─── Tìm kiếm Pexels ─────────────────────────────────────────────────────────
function searchPexels(keyword, apiKey, perPage = 5) {
    const q = encodeURIComponent((keyword || 'nature').trim().slice(0, 100));
    // orientation=landscape + size=large đảm bảo API trả về video ngang 16:9
    const fetchPer = Math.min(perPage * 2, 80);

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.pexels.com',
            path: `/videos/search?query=${q}&per_page=${fetchPer}&orientation=landscape&size=large`,
            method: 'GET',
            headers: { Authorization: apiKey },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.statusCode === 429) return reject(new Error('Pexels rate limit — thử lại sau'));
                    if (res.statusCode !== 200) return reject(new Error(`Pexels HTTP ${res.statusCode}`));
                    const json = JSON.parse(data);
                    const videos = json.videos || [];
                    const results = videos.map(video => {
                        // Chỉ lấy video landscape (width > height) — double check dù đã có orientation=landscape
                        if (video.width <= video.height) return null;

                        // Chọn file: landscape + HD (1280-1920), tránh 4K nặng
                        const files = (video.video_files || [])
                            .filter(f => f.width > 0 && f.height > 0 && f.width > f.height) // chỉ landscape files
                            .sort((a, b) => b.width - a.width);
                        const file = files.find(f => f.width >= 1280 && f.width <= 1920 && f.quality !== '4k')
                            || files.find(f => f.width >= 1280)
                            || files[0];
                        if (!file?.link) return null;
                        return {
                            id: String(video.id),
                            url: file.link,
                            width: file.width,
                            height: file.height,
                            duration: video.duration,
                            thumbnail: video.image || '',
                            provider: 'pexels',
                            tags: (video.tags || []).join(', '),
                        };
                    }).filter(Boolean).slice(0, perPage);
                    resolve(results);
                } catch (e) { reject(new Error(`Pexels parse: ${e.message}`)); }
            });
        });
        req.on('error', e => reject(new Error(`Pexels request: ${e.message}`)));
        req.end();
    });
}

// ─── Tìm kiếm DVIDS (video quân sự Mỹ, public domain, liên quan nhất trước) ──
// Public key cài sẵn (chỉ đọc) — dùng khi người dùng chưa lưu key riêng trong Cài đặt
const DEFAULT_DVIDS_KEY = 'key-6ab75f1e17922';
// B-roll DVIDS thường 1-4 phút → bỏ clip quá dài (720p 3000k ≈ 22MB/phút)
const DVIDS_MAX_DURATION = 240;

// DVIDS API đôi khi treo/504 → timeout để không chặn cả batch, caller sẽ fallback Pexels/Pixabay
const DVIDS_TIMEOUT_MS = 30000;

function dvidsGet(pathAndQuery) {
    return new Promise((resolve, reject) => {
        const req = https.get(`https://api.dvidshub.net${pathAndQuery}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 403) return reject(new Error('DVIDS API key không hợp lệ'));
                if (res.statusCode !== 200) return reject(new Error(`DVIDS HTTP ${res.statusCode}`));
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`DVIDS parse: ${e.message}`)); }
            });
        });
        req.setTimeout(DVIDS_TIMEOUT_MS, () => req.destroy(new Error('DVIDS timeout')));
        req.on('error', e => reject(new Error(`DVIDS request: ${e.message}`)));
    });
}

// DVIDS thường trả bitrate=0 → lấy từ tên file (...-1280x720-3000k.mp4), không có thì tính từ size
function dvidsKbps(f, duration) {
    if (f.bitrate > 0) return f.bitrate;
    const m = String(f.src).match(/-(\d+)k\.mp4(\?|$)/i);
    if (m) return parseInt(m[1], 10);
    return f.size > 0 && duration > 0 ? Math.round(f.size * 8 / duration / 1000) : Infinity;
}

// Chọn mp4 ngang ≥1280px, bitrate ≤4000k (bản gốc/1080p 6000-9000k rất nặng)
function pickDvidsFile(files, duration) {
    const landscape = (files || []).filter(f => f.src && f.width > f.height).map(f => ({ ...f, kbps: dvidsKbps(f, duration) }));
    const hd = landscape.filter(f => f.width >= 1280);
    const light = hd.filter(f => f.kbps <= 4000).sort((a, b) => (b.width - a.width) || (b.kbps - a.kbps));
    return light[0]
        || hd.sort((a, b) => a.kbps - b.kbps)[0]
        || landscape.sort((a, b) => (b.width - a.width) || (b.kbps - a.kbps))[0] || null;
}

// Không dùng cho B-roll: người nói trước camera, bản tin có MC
const DVIDS_SKIP_CATEGORIES = new Set(['Interviews', 'Newscasts', 'PSA', 'Package']);

async function searchDvids(keyword, apiKey, perPage = 5) {
    const kw  = (keyword || 'military').trim().slice(0, 100);
    const q   = encodeURIComponent(kw);
    const key = encodeURIComponent(apiKey);
    // sort=date trả video mới nhất chỉ cần nhắc keyword trong mô tả (vd buổi họp an toàn) → lạc đề.
    // sort=score + category=B-Roll ra đúng cảnh quay thô của vũ khí được tìm.
    const base = `/search?api_key=${key}&q=${q}&type=video&sort=score&aspect_ratio=16:9&max_results=${Math.min(Math.max(perPage * 4, 20), 50)}`;
    let results = (await dvidsGet(`${base}&category=B-Roll`)).results || [];
    if (results.length < perPage * 2) {
        const more = (await dvidsGet(base).catch(() => ({}))).results || [];
        const seen = new Set(results.map(r => r.id));
        results = results.concat(more.filter(r => !seen.has(r.id)));
    }

    // Tên riêng/model (HIMARS, F-35, M1A2...) có trong tiêu đề → đưa lên đầu
    const strong = kw.split(/\s+/).filter(t => /[A-Z0-9]/.test(t) && t.length >= 2).map(t => t.toLowerCase());
    const titleHit = r => strong.some(t => `${r.title} ${r.keywords || ''}`.toLowerCase().includes(t));
    const candidates = results
        .filter(r => !DVIDS_SKIP_CATEGORIES.has(r.category) && r.duration >= 5 && r.duration <= DVIDS_MAX_DURATION)
        .sort((a, b) => titleHit(b) - titleHit(a))
        .slice(0, perPage);

    const assets = await Promise.all(candidates.map(r =>
        dvidsGet(`/asset?id=${encodeURIComponent(r.id)}&api_key=${key}`).then(a => a.results).catch(() => null)));

    return assets.map(a => {
        // duration ở /search đôi khi lệch /asset → lọc lại theo asset
        if (!a || a.duration > DVIDS_MAX_DURATION) return null;
        const file = pickDvidsFile(a.files, a.duration);
        if (!file) return null;
        const credit = (a.credit || []).map(c => [c.rank, c.name].filter(Boolean).join(' ')).join(', ');
        return {
            id: String(a.id).replace(/^video:/, ''),
            url: file.src,
            width: file.width,
            height: file.height,
            duration: a.duration,
            startSec: a.time_start > 0 ? a.time_start : 0,
            thumbnail: a.image || '',
            provider: 'dvids',
            tags: a.keywords || '',
            title: a.title || '',
            date: a.date || '',
            credit: `DVIDS${credit ? ` — ${credit}` : ''}`,
            pageUrl: a.url || '',
        };
    }).filter(Boolean)
      .sort((a, b) => (b.width >= 1280) - (a.width >= 1280)); // footage SD cũ xuống cuối
}

// ─── Xen kẽ 2 mảng: [a0,b0,a1,b1,...] để kết quả đa dạng hơn ────────────────
function interleave(a, b) {
    const out = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (i < a.length) out.push(a[i]);
        if (i < b.length) out.push(b[i]);
    }
    return out;
}

// ─── Public: search ──────────────────────────────────────────────────────────
// provider: 'pexels' | 'pixabay' | 'dvids' | 'both'  ('both' = Pexels + Pixabay; DVIDS chỉ khi gọi riêng)
// Khi provider === 'both': apiKey = { pexels: '...', pixabay: '...' }
async function searchStockVideo({ keyword, provider, apiKey, perPage = 5 }) {
    try {
        if (provider === 'both') {
            const { pexels: pexKey, pixabay: pxbKey } = (typeof apiKey === 'object' ? apiKey : {});
            if (!pexKey && !pxbKey) return { success: false, error: 'Chưa cấu hình API key nào (Pexels/Pixabay)' };

            // Chạy song song — nếu 1 bên thiếu key thì bỏ qua (resolve [])
            const [pexRes, pxbRes] = await Promise.all([
                pexKey  ? searchPexels(keyword, pexKey, perPage).catch(() => [])   : Promise.resolve([]),
                pxbKey  ? searchPixabay(keyword, pxbKey, perPage).catch(() => [])  : Promise.resolve([]),
            ]);

            // Xen kẽ kết quả 2 nguồn: Pexels[0], Pixabay[0], Pexels[1], Pixabay[1]...
            const merged = interleave(pexRes, pxbRes);

            // Loại trùng id trong trường hợp hiếm
            const seen = new Set();
            const results = merged.filter(v => {
                const key = `${v.provider}:${v.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            if (!results.length) return { success: false, error: 'Cả Pexels lẫn Pixabay đều không có kết quả', results: [] };
            return { success: true, results };
        }

        // Single provider
        if (provider === 'dvids' && !apiKey) apiKey = DEFAULT_DVIDS_KEY;
        if (!apiKey) return { success: false, error: `Chưa cấu hình API key ${provider || ''}` };
        const results = provider === 'pexels'  ? await searchPexels(keyword, apiKey, perPage)
                      : provider === 'dvids'   ? await searchDvids(keyword, apiKey, perPage)
                      : await searchPixabay(keyword, apiKey, perPage);
        return { success: true, results };
    } catch (e) {
        return { success: false, error: e.message, results: [] };
    }
}

// ─── Public: download clip ────────────────────────────────────────────────────
async function downloadStockClip({ url, destPath, tempName }) {
    if (!url) return { success: false, error: 'Thiếu URL' };
    // Không truyền destPath → file tạm vào thư mục temp của hệ thống (renderer không có process.env.TEMP)
    if (!destPath) destPath = path.join(require('os').tmpdir(), tempName || `stock_tmp_${Date.now()}.mp4`);
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
        await new Promise((resolve, reject) => {
            const followRedirect = (reqUrl, depth = 0) => {
                if (depth > 5) return reject(new Error('Too many redirects'));
                const parsed = new URL(reqUrl);
                const req = https.request({
                    hostname: parsed.hostname,
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                }, (res) => {
                    if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                        return followRedirect(res.headers.location, depth + 1);
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    const ws = fs.createWriteStream(destPath);
                    res.pipe(ws);
                    ws.on('finish', resolve);
                    ws.on('error', reject);
                });
                req.on('error', reject);
                req.end();
            };
            followRedirect(url);
        });

        const size = fs.statSync(destPath).size;
        if (size < 10_000) {
            try { fs.unlinkSync(destPath); } catch {}
            return { success: false, error: `File quá nhỏ: ${size} bytes — URL có thể hết hạn` };
        }
        return { success: true, filePath: destPath, size };
    } catch (e) {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        return { success: false, error: e.message };
    }
}

module.exports = { searchStockVideo, downloadStockClip };
