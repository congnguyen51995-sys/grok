/**
 * debug-quick-scan.js — Spawn Chrome + scan DOM grok.com/imagine rồi thoát
 */
const { chromium } = require('playwright');
const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');

const PROFILE = path.join('C:', 'Users', 'Vu Anh', 'AppData', 'Roaming', 'fluxy-thanh-cong-media', 'chrome-profiles', 'grok_chrome_0');
const EXT     = path.join(__dirname, '..', 'src', 'main', 'resources', 'grok-worker');
const CHROME  = path.join('C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const PORT    = 9223;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    console.log('🚀 Spawn Chrome với profile grok_chrome_0...');
    const proc = spawn(CHROME, [
        `--load-extension=${EXT}`,
        `--disable-extensions-except=${EXT}`,
        `--user-data-dir=${PROFILE}`,
        `--remote-debugging-port=${PORT}`,
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run', '--no-default-browser-check',
        'https://grok.com/imagine',
    ], { detached: false, stdio: 'ignore' });
    console.log(`   PID: ${proc.pid}`);

    console.log('   Chờ 8s khởi động...');
    await sleep(8000);

    console.log('📡 Kết nối CDP...');
    const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
    const ctx     = browser.contexts()[0] || await browser.newContext();
    const pages   = ctx.pages();
    let page      = pages.find(p => p.url().includes('grok.com')) || pages[0];
    if (!page) page = await ctx.newPage();
    if (!page.url().includes('grok.com')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    console.log('   Chờ trang load 5s...');
    await sleep(5000);
    console.log(`📄 URL: ${page.url()}`);

    // ── SCAN 1: Trạng thái ban đầu ─────────────────────────────────────────
    const scan1 = await page.evaluate(() => {
        const allEl = Array.from(document.querySelectorAll(
            'button, div[role="button"], [role="tab"], [role="radio"], [role="option"], span[role], a'
        )).filter(el => el.offsetParent !== null);

        return {
            url: window.location.href,
            buttonTexts: [...new Set(allEl.map(b => (b.innerText||'').trim()).filter(t => t && t.length < 60))],
            ariaLabels:  [...new Set(allEl.map(b => b.getAttribute('aria-label')).filter(Boolean))],
            isLoggedIn:  !document.body.innerText.includes('Sign in') && !document.body.innerText.includes('Log in') && !document.body.innerText.includes('Đăng nhập'),
            pageTextTop: document.body.innerText.substring(0, 1000),
        };
    });

    console.log('\n=== LOGIN ===');
    console.log(scan1.isLoggedIn ? '✅ Đã đăng nhập' : '❌ Chưa đăng nhập');

    console.log('\n=== BUTTON TEXTS (ban đầu) ===');
    scan1.buttonTexts.forEach(t => console.log(`  - "${t}"`));

    console.log('\n=== ARIA LABELS ===');
    scan1.ariaLabels.forEach(t => console.log(`  - "${t}"`));

    // ── SCAN 2: Click "Hình ảnh" / "Image" → xem ratio + quality buttons ────
    console.log('\n\n🧪 Click Image mode...');
    const scan2 = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const allEl = () => Array.from(document.querySelectorAll(
            'button, div[role="button"], [role="tab"]'
        )).filter(el => el.offsetParent !== null);

        const imgBtn = allEl().find(el => {
            const t = (el.innerText||'').trim();
            return t === 'Hình ảnh' || t === 'Image' || t === 'Ảnh';
        });
        if (imgBtn) { imgBtn.click(); await sleep(2000); }

        const after = allEl().map(b => ({
            text: (b.innerText||'').trim().substring(0, 50),
            ariaLabel: b.getAttribute('aria-label'),
            role: b.getAttribute('role'),
            ariaSelected: b.getAttribute('aria-selected'),
        })).filter(b => b.text || b.ariaLabel);

        return { clicked: !!imgBtn, btnText: imgBtn?.innerText?.trim(), afterButtons: after };
    });

    console.log(`  Image btn clicked: ${scan2.clicked ? '✅ "' + scan2.btnText + '"' : '❌ không tìm thấy'}`);
    if (scan2.clicked) {
        console.log('  Buttons sau Image click:');
        scan2.afterButtons.forEach(b => console.log(`    "${b.text}" | aria="${b.ariaLabel}" | role=${b.role} | sel=${b.ariaSelected}`));
    }

    // ── SCAN 3: Click ratio button → xem dropdown options ───────────────────
    console.log('\n\n🧪 Click ratio button...');
    const scan3 = await page.evaluate(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9','4:3','3:4'];

        const allEl = Array.from(document.querySelectorAll(
            'button, div[role="button"], [role="combobox"], select'
        )).filter(el => el.offsetParent !== null);

        const ratioBtn = allEl.find(b => {
            const t = (b.innerText||'').trim();
            const label = (b.getAttribute('aria-label')||'').toLowerCase();
            return RATIOS.some(r => t.startsWith(r)) ||
                label.includes('ratio') || label.includes('tỷ lệ') || label.includes('khung hình') ||
                label.includes('aspect');
        });

        if (!ratioBtn) {
            // Không tìm thấy, list tất cả buttons có SVG (thường là icon buttons)
            const iconBtns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null && b.querySelector('svg'));
            return {
                ok: false,
                reason: 'Không tìm thấy ratio button',
                iconButtons: iconBtns.map(b => ({
                    ariaLabel: b.getAttribute('aria-label'),
                    title: b.getAttribute('title'),
                    text: (b.innerText||'').trim().substring(0, 30),
                })).filter(b => b.ariaLabel || b.title),
            };
        }

        const info = {
            text: (ratioBtn.innerText||'').trim(),
            ariaLabel: ratioBtn.getAttribute('aria-label'),
            tag: ratioBtn.tagName,
            role: ratioBtn.getAttribute('role'),
        };
        ratioBtn.click();
        await sleep(1500);

        // Tìm options
        const opts = Array.from(document.querySelectorAll(
            'button, li, [role="menuitem"], [role="option"], [role="radio"], [role="listitem"], [role="menuitemradio"]'
        )).filter(el => el.offsetParent !== null)
        .filter(el => RATIOS.some(r => (el.innerText||el.textContent||'').trim().includes(r)))
        .map(el => ({
            text: (el.innerText||el.textContent||'').trim().substring(0, 40),
            tag: el.tagName, role: el.getAttribute('role'),
            ariaChecked: el.getAttribute('aria-checked'),
        }));

        // Tất cả elements mới hiện ra (dropdown items)
        const allAfter = Array.from(document.querySelectorAll(
            '[role="menu"] *, [role="listbox"] *, [role="dialog"] *, ul li'
        )).filter(el => el.offsetParent !== null)
        .map(el => (el.innerText||el.textContent||'').trim().substring(0, 40))
        .filter(t => t);

        document.body.click();
        return { ok: true, ratioBtn: info, options: opts, dropdownItems: [...new Set(allAfter)].slice(0, 30) };
    });

    if (scan3.ok) {
        console.log(`  Ratio btn: "${scan3.ratioBtn.text}" | aria="${scan3.ratioBtn.ariaLabel}" | ${scan3.ratioBtn.tag}`);
        console.log('  Options trong dropdown:');
        scan3.options.forEach(o => console.log(`    "${o.text}" | ${o.tag} role=${o.role} checked=${o.ariaChecked}`));
        if (scan3.dropdownItems.length) {
            console.log('  Tất cả dropdown items:', scan3.dropdownItems.join(' | '));
        }
    } else {
        console.log(`  ❌ ${scan3.reason}`);
        console.log('  Icon buttons (có SVG):');
        (scan3.iconButtons||[]).forEach(b => console.log(`    aria="${b.ariaLabel}" | title="${b.title}" | text="${b.text}"`));
    }

    // ── Lưu kết quả ─────────────────────────────────────────────────────────
    const result = { scan1, scan2, scan3, timestamp: new Date().toISOString() };
    fs.writeFileSync(
        path.join(__dirname, 'debug_grok_result.json'),
        JSON.stringify(result, null, 2)
    );
    console.log('\n💾 Lưu: scripts/debug_grok_result.json');
    proc.kill();
    console.log('✅ Done');
    process.exit(0);
}

run().catch(e => {
    console.error('\n❌ ERROR:', e.message);
    try { require('child_process').execSync('taskkill /F /IM chrome.exe /T'); } catch(_) {}
    process.exit(1);
});
