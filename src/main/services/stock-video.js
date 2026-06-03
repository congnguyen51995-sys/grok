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
// provider: 'pexels' | 'pixabay' | 'both'
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
        if (!apiKey) return { success: false, error: `Chưa cấu hình API key ${provider || ''}` };
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
