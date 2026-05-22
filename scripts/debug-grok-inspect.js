/**
 * debug-grok-inspect.js
 * Kết nối Chrome qua CDP, scan DOM grok.com/imagine để tìm:
 *   - Mode buttons (Hình ảnh / Video)
 *   - Aspect ratio buttons + dropdown options
 *   - Quality / Speed buttons
 *   - Editor input
 *   - Submit button
 * Kết quả lưu vào: scripts/debug_grok_result.json
 *
 * Usage:
 *   node scripts/debug-grok-inspect.js            ← spawn Chrome mới
 *   node scripts/debug-grok-inspect.js --cdp-port=9222  ← attach Chrome đã mở
 */

const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');

const OUT_FILE  = path.join(__dirname, 'debug_grok_result.json');
const args      = process.argv.slice(2);
const cdpArg    = args.find(a => a.startsWith('--cdp-port='));
const CDP_PORT  = cdpArg ? parseInt(cdpArg.split('=')[1]) : null;

const PROFILE_DIR = `C:\\Users\\Vu Anh\\AppData\\Roaming\\fluxy-thanh-cong-media\\chrome-profiles\\grok_chrome_0`;
const EXT_PATH    = path.join(__dirname, '..', 'src', 'main', 'resources', 'grok-worker');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  FLUXY DEBUG — Grok.com DOM Inspector');
    console.log('══════════════════════════════════════════════════════\n');

    let browser;
    let ownedProcess = null;

    if (CDP_PORT) {
        // Attach vào Chrome đã mở với remote-debugging-port
        console.log(`📡 Attach Chrome tại localhost:${CDP_PORT}...`);
        try {
            browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
            console.log('✅ Đã kết nối!\n');
        } catch(e) {
            console.error('❌ Không kết nối được:', e.message);
            console.log('   → Đảm bảo Chrome đã được mở với --remote-debugging-port=' + CDP_PORT);
            process.exit(1);
        }
    } else {
        // Spawn Chrome mới
        console.log('🚀 Spawn Chrome mới với profile grok_chrome_0...');
        const newPort = 9222;
        ownedProcess = spawn(CHROME_PATH, [
            `--load-extension=${EXT_PATH}`,
            `--disable-extensions-except=${EXT_PATH}`,
            `--user-data-dir=${PROFILE_DIR}`,
            `--remote-debugging-port=${newPort}`,
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            'https://grok.com/imagine',
        ], { detached: false, stdio: 'ignore' });
        console.log(`   PID: ${ownedProcess.pid} — chờ khởi động 5s...`);
        await sleep(5000);
        browser = await chromium.connectOverCDP(`http://localhost:${newPort}`);
        console.log('✅ Đã kết nối!\n');
    }

    const ctx  = browser.contexts()[0] || await browser.newContext();
    const pages = ctx.pages();
    let page   = pages.find(p => p.url().includes('grok.com')) || pages[0];

    if (!page) {
        page = await ctx.newPage();
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else if (!page.url().includes('grok.com/imagine')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    console.log(`📄 URL hiện tại: ${page.url()}`);
    await sleep(4000);

    // ── Kiểm tra login ────────────────────────────────────────────────────────
    const loginStatus = await page.evaluate(() => {
        const body = document.body.innerText || '';
        return {
            isLoggedIn: !body.includes('Sign in') && !body.includes('Log in') && !body.includes('Đăng nhập'),
            title: document.title,
        };
    });
    console.log(`\n👤 Login: ${loginStatus.isLoggedIn ? '✅ ĐÃ ĐĂNG NHẬP' : '❌ CHƯA ĐĂNG NHẬP'} — "${loginStatus.title}"`);

    if (!loginStatus.isLoggedIn) {
        console.log('\n⚠  Chưa đăng nhập. Hãy login trên Chrome rồi nhấn ENTER ở đây...');
        await new Promise(r => process.stdin.once('data', r));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(4000);
    }

    // ── SCAN DOM ──────────────────────────────────────────────────────────────
    console.log('\n🔍 Scan DOM...\n');

    const domData = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll(
            'button, div[role="button"], [role="tab"], [role="radio"], [role="menuitem"], a[href]'
        )).filter(el => el.offsetParent !== null);

        const btnInfos = allBtns.map(el => ({
            tag:       el.tagName,
            text:      (el.innerText || el.textContent || '').trim().substring(0, 60),
            ariaLabel: el.getAttribute('aria-label') || null,
            ariaRole:  el.getAttribute('role') || null,
            ariaSelected: el.getAttribute('aria-selected') || null,
            classList: [...el.classList].join(' ').substring(0, 80),
            href:      el.tagName === 'A' ? el.getAttribute('href') : null,
        })).filter(b => b.text || b.ariaLabel);

        // Editor
        const editors = ['.ProseMirror', '[contenteditable="true"]', 'textarea'].map(sel => ({
            sel, found: !!document.querySelector(sel),
            tag: document.querySelector(sel)?.tagName,
            cls: document.querySelector(sel)?.className?.substring(0, 60),
        }));

        // Tìm mode buttons
        const MODES = ['Hình ảnh', 'Image', 'Video', 'video', 'Ảnh', 'Tạo ảnh', 'Tạo video'];
        const modeBtns = btnInfos.filter(b => MODES.some(m => b.text === m || b.ariaLabel?.includes(m)));

        // Tìm ratio buttons + dropdowns
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9','4:3','3:4','4:5'];
        const ratioBtns = btnInfos.filter(b =>
            RATIOS.some(r => b.text.startsWith(r) || b.text.includes(r)) ||
            (b.ariaLabel || '').toLowerCase().includes('ratio') ||
            (b.ariaLabel || '').toLowerCase().includes('tỷ lệ') ||
            (b.ariaLabel || '').toLowerCase().includes('khung hình')
        );

        // Tìm quality/speed buttons
        const QUALITIES = ['Tốc độ', 'Chất lượng', 'Speed', 'Fast', 'Quality', 'Normal', 'High', 'Best'];
        const qualityBtns = btnInfos.filter(b =>
            QUALITIES.some(q => b.text === q || b.text.includes(q)) ||
            (b.ariaLabel || '').toLowerCase().includes('quality') ||
            (b.ariaLabel || '').toLowerCase().includes('speed')
        );

        // Tìm submit button
        const submitBtns = allBtns.filter(b =>
            b.getAttribute('type') === 'submit' ||
            (b.getAttribute('aria-label') || '').toLowerCase().includes('send') ||
            (b.getAttribute('aria-label') || '').toLowerCase().includes('gửi') ||
            (b.getAttribute('aria-label') || '').toLowerCase().includes('submit') ||
            (b.getAttribute('aria-label') || '').toLowerCase().includes('tạo')
        ).map(el => ({
            tag: el.tagName, text: el.innerText?.trim(),
            ariaLabel: el.getAttribute('aria-label'),
            disabled: el.disabled,
        }));

        return {
            url: window.location.href,
            editors,
            modeBtns,
            ratioBtns,
            qualityBtns,
            submitBtns,
            allButtonTexts: [...new Set(btnInfos.map(b => b.text || b.ariaLabel).filter(Boolean))].slice(0, 60),
        };
    });

    // In kết quả
    console.log('── EDITOR ─────────────────────────────────────────────');
    domData.editors.forEach(e => console.log(`  ${e.found ? '✅' : '❌'} ${e.sel} → <${e.tag}> .${e.cls}`));

    console.log('\n── MODE BUTTONS ────────────────────────────────────────');
    if (domData.modeBtns.length === 0) {
        console.log('  ❌ Không tìm thấy mode button (Hình ảnh / Video)');
    } else {
        domData.modeBtns.forEach(b => console.log(`  ✅ "${b.text}" | aria="${b.ariaLabel}" | role=${b.ariaRole} | selected=${b.ariaSelected}`));
    }

    console.log('\n── RATIO BUTTONS ───────────────────────────────────────');
    if (domData.ratioBtns.length === 0) {
        console.log('  ❌ Không tìm thấy ratio button');
        console.log('  → Cần click mode trước, sau đó ratio button mới hiện');
    } else {
        domData.ratioBtns.forEach(b => console.log(`  ✅ "${b.text}" | aria="${b.ariaLabel}" | role=${b.ariaRole}`));
    }

    console.log('\n── QUALITY BUTTONS ─────────────────────────────────────');
    if (domData.qualityBtns.length === 0) {
        console.log('  ❌ Không tìm thấy quality/speed button');
    } else {
        domData.qualityBtns.forEach(b => console.log(`  ✅ "${b.text}" | aria="${b.ariaLabel}"`));
    }

    console.log('\n── ALL BUTTON TEXTS ────────────────────────────────────');
    console.log(' ', domData.allButtonTexts.join(' | '));

    // ── THỬ CLICK MODE VIDEO để xem ratio buttons xuất hiện ─────────────────
    console.log('\n\n🧪 Thử click "Video" mode để xem ratio buttons thay đổi...');
    const clickResult = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const allEl = Array.from(document.querySelectorAll('button, div[role="button"], [role="tab"]'))
            .filter(el => el.offsetParent !== null);
        const videoBtn = allEl.find(el => {
            const t = (el.innerText || '').trim();
            return t === 'Video' || t === 'video' || t === 'Tạo video';
        });
        if (!videoBtn) return { ok: false, reason: 'Không tìm thấy Video button' };
        videoBtn.click();
        await sleep(2000);

        // Scan lại ratio buttons
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9','4:3','3:4'];
        const allBtns2 = Array.from(document.querySelectorAll('button, div[role="button"], [role="radio"], [role="option"]'))
            .filter(el => el.offsetParent !== null);
        const ratiosFound = allBtns2
            .filter(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) ||
                (b.getAttribute('aria-label')||'').toLowerCase().includes('ratio'))
            .map(b => ({
                text: (b.innerText||b.textContent||'').trim().substring(0,30),
                ariaLabel: b.getAttribute('aria-label'),
                role: b.getAttribute('role'),
                tag: b.tagName,
            }));

        // Tất cả buttons sau khi click Video
        const allTexts = [...new Set(allBtns2.map(b => (b.innerText||'').trim()).filter(t => t && t.length < 40))];

        return { ok: true, videoBtn: videoBtn.innerText?.trim(), ratiosFound, allTextsAfter: allTexts.slice(0, 50) };
    });

    console.log(`   Video click: ${clickResult.ok ? '✅' : '❌'} ${clickResult.reason || `"${clickResult.videoBtn}"`}`);
    if (clickResult.ratiosFound?.length > 0) {
        console.log('   Ratio buttons sau khi click Video:');
        clickResult.ratiosFound.forEach(b => console.log(`     "${b.text}" | aria="${b.ariaLabel}" | tag=${b.tag}`));
    } else {
        console.log('   Ratio buttons vẫn không thấy sau khi click Video');
    }
    if (clickResult.allTextsAfter) {
        console.log('   Buttons sau Video click:', clickResult.allTextsAfter.join(' | '));
    }

    // ── THỬ CLICK ratio button (ví dụ: "16:9") để xem dropdown ─────────────
    console.log('\n\n🧪 Thử click ratio button và xem dropdown options...');
    const ratioResult = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9','4:3','3:4'];
        const allBtns = Array.from(document.querySelectorAll('button, div[role="button"], [role="radio"], [role="combobox"]'))
            .filter(el => el.offsetParent !== null);

        const ratioBtn = allBtns.find(b => {
            const t = (b.innerText || '').trim();
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return RATIOS.some(r => t.startsWith(r)) || label.includes('ratio') || label.includes('tỷ lệ');
        });

        if (!ratioBtn) return { ok: false, reason: 'Không tìm thấy ratio trigger button', ratioBtnTexts: allBtns.map(b=>(b.innerText||'').trim()).filter(t=>t).slice(0,30) };

        const beforeText = (ratioBtn.innerText || '').trim();
        ratioBtn.click();
        await sleep(1500);

        // Scan toàn bộ elements mới hiện ra
        const allAfter = Array.from(document.querySelectorAll(
            'button, li, [role="menuitem"], [role="option"], [role="radio"], [role="listitem"], [role="menuitemradio"]'
        )).filter(el => el.offsetParent !== null);

        const options = allAfter
            .filter(b => RATIOS.some(r => (b.innerText||b.textContent||'').trim().includes(r)))
            .map(b => ({
                text: (b.innerText || b.textContent || '').trim().substring(0, 40),
                tag: b.tagName,
                role: b.getAttribute('role'),
                ariaLabel: b.getAttribute('aria-label'),
                selected: b.getAttribute('aria-checked') || b.getAttribute('aria-selected'),
            }));

        document.body.click(); // đóng dropdown
        return { ok: true, ratioBtn: beforeText, options };
    });

    console.log(`   Ratio btn: ${ratioResult.ok ? '✅' : '❌'} ${ratioResult.reason || `"${ratioResult.ratioBtn}"`}`);
    if (ratioResult.options?.length > 0) {
        console.log('   Dropdown options:');
        ratioResult.options.forEach(o => console.log(`     "${o.text}" | tag=${o.tag} | role=${o.role} | selected=${o.selected}`));
    } else if (!ratioResult.ok) {
        console.log('   Buttons đang thấy:', (ratioResult.ratioBtnTexts||[]).join(' | '));
    }

    // ── Lưu kết quả ──────────────────────────────────────────────────────────
    const result = {
        timestamp:   new Date().toISOString(),
        loginStatus,
        dom:         domData,
        videoModeTest: clickResult,
        ratioTest:   ratioResult,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log(`\n💾 Kết quả lưu tại: ${OUT_FILE}`);

    console.log('\n✅ Scan xong! Chrome vẫn mở để bạn quan sát.');
    console.log('   Nhấn CTRL+C để thoát.\n');
    await new Promise(() => {});
})().catch(err => {
    console.error('\n❌ LỖI:', err.message);
    process.exit(1);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
