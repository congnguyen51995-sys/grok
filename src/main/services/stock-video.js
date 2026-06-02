/**
 * Stock Video Service — Pexels & Pixabay
 * Dùng cho Audio-to-Video: search + download clip stock miễn phí
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Tìm kiếm Pixabay ────────────────────────────────────────────────────────
function searchPixabay(keyword, apiKey, perPage = 5) {
    const q   = encodeURIComponent((keyword || 'nature').trim().slice(0, 100));
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${q}&per_page=${perPage}&video_type=film&safesearch=true`;

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
                        const file = v.large || v.medium || v.small || v.tiny;
                        if (!file?.url) return null;
                        return {
                            id: String(hit.id),
                            url: file.url,
                            width: file.width,
                            height: file.height,
                            duration: hit.duration, // giây
                            thumbnail: `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg`,
                            provider: 'pixabay',
                            tags: hit.tags || '',
                        };
                    }).filter(Boolean);
                    resolve(results);
                } catch (e) { reject(new Error(`Pixabay parse: ${e.message}\n${data.slice(0, 200)}`)); }
            });
        }).on('error', e => reject(new Error(`Pixabay request: ${e.message}`)));
    });
}

// ─── Tìm kiếm Pexels ─────────────────────────────────────────────────────────
function searchPexels(keyword, apiKey, perPage = 5) {
    const q = encodeURIComponent((keyword || 'nature').trim().slice(0, 100));

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.pexels.com',
            path: `/videos/search?query=${q}&per_page=${perPage}&orientation=landscape`,
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
                        const files = (video.video_files || []).sort((a, b) => b.width - a.width);
                        // Ưu tiên 1280×720 HD, tránh 4K quá nặng
                        const file = files.find(f => f.width >= 1280 && f.width <= 1920 && f.quality !== '4k') || files[0];
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
                    }).filter(Boolean);
                    resolve(results);
                } catch (e) { reject(new Error(`Pexels parse: ${e.message}`)); }
            });
        });
        req.on('error', e => reject(new Error(`Pexels request: ${e.message}`)));
        req.end();
    });
}

// ─── Public: search ──────────────────────────────────────────────────────────
async function searchStockVideo({ keyword, provider, apiKey, perPage = 5 }) {
    if (!apiKey) return { success: false, error: `Chưa cấu hình API key ${provider || ''}` };
    try {
        const results = provider === 'pexels'
            ? await searchPexels(keyword, apiKey, perPage)
            : await searchPixabay(keyword, apiKey, perPage);
        return { success: true, results };
    } catch (e) {
        return { success: false, error: e.message, results: [] };
    }
}

// ─── Public: download clip ────────────────────────────────────────────────────
async function downloadStockClip({ url, destPath }) {
    if (!url) return { success: false, error: 'Thiếu URL' };
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
