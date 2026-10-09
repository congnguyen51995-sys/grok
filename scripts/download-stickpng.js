/**
 * StickPNG Downloader
 * Tải ảnh PNG trong suốt từ stickpng.com về thư mục local
 *
 * Cách dùng:
 *   node scripts/download-stickpng.js
 *   node scripts/download-stickpng.js --out D:\EyesAssets --pages 3
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ── Cấu hình ──────────────────────────────────────────────────────────────────

const OUT_DIR    = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'D:\\EyesAssets';

const MAX_PAGES  = process.argv.includes('--pages')
  ? parseInt(process.argv[process.argv.indexOf('--pages') + 1])
  : 2; // mỗi category tải tối đa 2 trang = ~24 ảnh

const DELAY_MS   = 600; // delay giữa các request (lịch sự với server)

// Danh sách category — thêm/bỏ tùy ý
const CATEGORIES = [
  // Động vật đã có — giữ lại để tải thêm ảnh mới nếu thiếu
  'animals/chickens',
  'animals/ducks',
  'animals/sheep',
  'animals/goats',
  'animals/dogs',
  'animals/cats',
  'animals/horses',
  'animals/pigs',
  'animals/cows',
  'animals/elephants',
  'animals/lions',
  'animals/tigers',
  'animals/foxes',
  'animals/rabbits',
  'animals/penguins',
  'animals/donkeys',
  'animals/bears',
  'animals/parrots',
  // Động vật MỚI
  'animals/giraffes',
  'animals/zebras',
  'animals/monkeys',
  'animals/wolves',
  'animals/deer',
  'animals/camels',
  'animals/kangaroos',
  'animals/crocodiles',
  'animals/owls',
  'animals/turtles',
  'animals/flamingos',
  'animals/frogs',
  'animals/dolphins',
  'animals/hamsters',
  'animals/squirrels',
  'animals/snakes',
  // Trái cây đã có
  'food/fruits/avocados',
  'food/fruits/apples',
  'food/fruits/strawberries',
  'food/fruits/oranges',
  'food/fruits/bananas',
  'food/fruits/kiwi',
  // Trái cây MỚI
  'food/fruits/watermelons',
  'food/fruits/grapes',
  'food/fruits/mangoes',
  'food/fruits/pineapples',
  'food/fruits/lemons',
  'food/fruits/pears',
  'food/fruits/cherries',
  'food/fruits/peaches',
  'food/fruits/coconuts',
  'food/fruits/melons',
  'food/fruits/blueberries',
  'food/fruits/raspberries',
  // Đồ uống thương hiệu nổi tiếng
  'food/drinks/cola',
  'food/drinks/fanta',
  'food/drinks/juice',
  'food/drinks/milk',
  'food/drinks/coca-cola',
  'food/drinks/pepsi',
  'food/drinks/sprite',
  'food/drinks/7up',
  'food/drinks/red-bull',
  'food/drinks/monster-energy',
  'food/drinks/starbucks',
  'food/drinks/beer',
  'food/drinks/water',
  'food/drinks/tea',
  'food/drinks/coffee',
  // Rau củ
  'food/vegetables/carrots',
  'food/vegetables/corn',
  'food/vegetables/broccoli',
  'food/vegetables/tomatoes',
  // iPhone & điện thoại
  'electronics/phones/iphones',
  'electronics/phones/samsung-phones',
  'electronics/phones',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fetchText(reqUrl) {
  return new Promise((resolve, reject) => {
    const mod = reqUrl.startsWith('https') ? https : http;
    const req = mod.get(reqUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) { resolve('skip'); return; }
    const mod = fileUrl.startsWith('https') ? https : http;
    const tmp = destPath + '.tmp';
    const file = fs.createWriteStream(tmp);
    const req = mod.get(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    }, (res) => {
      if (res.statusCode !== 200) { file.close(); fs.unlink(tmp, () => {}); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); fs.renameSync(tmp, destPath); resolve('ok'); });
    });
    req.on('error', e => { file.close(); fs.unlink(tmp, () => {}); reject(e); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Parse HTML lấy {id, name} từ category page
function parseCategory(html, catSlug) {
  const results = [];
  // Thumb URLs chứa ID
  const thumbRe = /assets\.stickpng\.com\/thumbs\/([0-9a-f]{24})\.png/g;
  // Link slugs chứa tên ảnh
  const linkRe  = new RegExp(`img/${catSlug}/([a-z0-9-]+)`, 'g');

  const ids   = [];
  const names = [];

  let m;
  while ((m = thumbRe.exec(html)) !== null) ids.push(m[1]);
  while ((m = linkRe.exec(html))  !== null) names.push(m[1]);

  const len = Math.min(ids.length, names.length || ids.length);
  for (let i = 0; i < len; i++) {
    results.push({ id: ids[i], name: names[i] || ids[i] });
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function downloadCategory(cat) {
  const catName = cat.split('/').pop();
  const outSub  = path.join(OUT_DIR, catName);
  fs.mkdirSync(outSub, { recursive: true });

  let total = 0;
  console.log(`\n📂 [${cat}] → ${outSub}`);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageUrl = `https://www.stickpng.com/cat/${cat}${page > 1 ? `?page=${page}` : ''}`;

    let html;
    try {
      html = await fetchText(pageUrl);
    } catch (e) {
      console.log(`  ⚠️  Trang ${page} lỗi: ${e.message}`);
      break;
    }

    const items = parseCategory(html, cat);
    if (!items.length) {
      console.log(`  ℹ️  Trang ${page}: không có ảnh, dừng.`);
      break;
    }

    console.log(`  📄 Trang ${page}: ${items.length} ảnh`);

    for (const item of items) {
      const imgUrl  = `https://assets.stickpng.com/images/${item.id}.png`;
      const outFile = path.join(outSub, `${item.name}.png`);

      try {
        const res = await downloadFile(imgUrl, outFile);
        if (res === 'skip') {
          process.stdout.write('.');
        } else {
          process.stdout.write('✓');
          total++;
        }
      } catch (e) {
        process.stdout.write('✗');
      }
      await sleep(DELAY_MS);
    }
    process.stdout.write('\n');
    await sleep(DELAY_MS * 2);
  }

  return total;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('═══════════════════════════════════════');
  console.log('  StickPNG Downloader');
  console.log(`  Thư mục lưu : ${OUT_DIR}`);
  console.log(`  Số trang/cat: ${MAX_PAGES} (~${MAX_PAGES * 12} ảnh/danh mục)`);
  console.log(`  Danh mục    : ${CATEGORIES.length}`);
  console.log('═══════════════════════════════════════');

  let grandTotal = 0;
  for (const cat of CATEGORIES) {
    try {
      const n = await downloadCategory(cat);
      grandTotal += n;
    } catch (e) {
      console.error(`  ❌ ${cat}: ${e.message}`);
    }
  }

  console.log(`\n✅ Hoàn tất! Đã tải ${grandTotal} ảnh mới → ${OUT_DIR}`);
}

main().catch(console.error);
