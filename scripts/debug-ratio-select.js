/**
 * debug-ratio-select.js
 * Test CHÍNH XÁC logic chọn tỉ lệ khung hình trên grok.com/imagine
 * Kết nối Chrome đang mở qua CDP, mô phỏng y hệt background.js extension
 *
 * Usage:
 *   node scripts/debug-ratio-select.js             (attach Chrome cổng 9222-9240)
 *   node scripts/debug-ratio-select.js --port=9222
 *   node scripts/debug-ratio-select.js --target=16:9
 */

const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');

const args     = process.argv.slice(2);
const portArg  = args.find(a => a.startsWith('--port='));
const targetArg= args.find(a => a.startsWith('--target='));
const PORT     = portArg  ? parseInt(portArg.split('=')[1])  : null;
const TARGET   = targetArg? targetArg.split('=')[1]          : '16:9';
const OUT_DIR  = path.join(__dirname, '..', 'debug');
const SHOTS_DIR= path.join(OUT_DIR, 'ratio_shots');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

;(async () => {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  FLUXY DEBUG — Ratio Selection Test');
    console.log(`  Target ratio: "${TARGET}"`);
    console.log('══════════════════════════════════════════════════════════════\n');

    if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

    // ── Tìm Chrome đang chạy ────────────────────────────────────────────────
    let browser = null;
    const PORTS = PORT ? [PORT] : [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9400];

    for (const p of PORTS) {
        try {
            browser = await chromium.connectOverCDP(`http://localhost:${p}`, { timeout: 2000 });
            console.log(`✅ Kết nối Chrome tại port ${p}`);
            break;
        } catch (_) {}
    }

    if (!browser) {
        console.error('❌ Không tìm thấy Chrome đang chạy với remote debugging!');
        console.error('   → Chạy debug_chay.bat trước để mở Chrome với DevTools');
        console.error('   → Hoặc thêm --remote-debugging-port=9222 vào Chrome shortcut');
        process.exit(1);
    }

    // ── Tìm tab grok.com ─────────────────────────────────────────────────────
    const ctx   = browser.contexts()[0];
    const pages = ctx.pages();
    let page    = pages.find(p => p.url().includes('grok.com'));

    if (!page) {
        console.log('⚠  Không thấy tab grok.com, tạo tab mới...');
        page = await ctx.newPage();
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
    } else {
        console.log(`📄 Tab grok.com: ${page.url()}`);
        if (!page.url().includes('/imagine')) {
            await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(3000);
        }
    }

    // ── STEP 1: Click "Hình ảnh" tab ────────────────────────────────────────
    console.log('\n── BƯỚC 1: Click tab Hình ảnh ─────────────────────────────────');
    await page.evaluate(async () => {
        const btns = Array.from(document.querySelectorAll('button,[role=button]'));
        const imgTab = btns.find(b => ['hình ảnh','image','images'].includes((b.innerText||'').trim().toLowerCase()));
        if (imgTab) { imgTab.click(); await new Promise(r => setTimeout(r, 2000)); }
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(SHOTS_DIR, '01_after_img_tab.png') });
    console.log('📸 Screenshot: debug/ratio_shots/01_after_img_tab.png');

    // ── STEP 2: Scan DOM trước khi làm gì ───────────────────────────────────
    console.log('\n── BƯỚC 2: Scan DOM — tìm ratio buttons ───────────────────────');
    const scanResult = await page.evaluate((target) => {
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());

        // Tất cả interactive elements hiển thị
        const allVisible = Array.from(document.querySelectorAll(
            'button, [role="button"], [role="radio"], [role="option"], [role="menuitem"], [role="tab"], div[tabindex], li[tabindex]'
        )).filter(isVis);

        // Buttons có text ratio
        const ratioEls = allVisible.filter(el => {
            const t = (el.innerText||'').trim();
            return RATIOS.some(r => t.startsWith(r)) && t.length < 30;
        }).map(el => ({
            tag: el.tagName,
            text: (el.innerText||'').trim().substring(0, 40),
            role: el.getAttribute('role'),
            classList: el.className.substring(0, 80),
            rect: el.getBoundingClientRect(),
            insideMenu: !!(el.closest('[role="menu"]') || el.closest('[role="listbox"]')),
            ariaLabel: el.getAttribute('aria-label'),
            outerHTML: el.outerHTML.substring(0, 200),
        }));

        // Tìm toggle button (hiển tỉ lệ hiện tại)
        const toggle = allVisible.find(b =>
            RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) &&
            !b.closest('[role="menu"]') && !b.closest('.menu')
        );

        // Tất cả elements trong DOM có text target ratio (kể cả ẩn)
        const allWithTarget = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText||'').trim();
            return t.startsWith(target) && t.length < 30;
        }).map(el => ({
            tag: el.tagName,
            text: (el.innerText||'').trim().substring(0, 30),
            visible: isVis(el),
            offsetParent: !!el.offsetParent,
            rect: el.getBoundingClientRect(),
            classList: el.className.substring(0, 60),
        }));

        return {
            ratioElsCount: ratioEls.length,
            ratioEls,
            toggleText: toggle ? (toggle.innerText||'').trim() : null,
            toggleTag: toggle ? toggle.tagName : null,
            toggleClass: toggle ? toggle.className.substring(0, 80) : null,
            allWithTargetCount: allWithTarget.length,
            allWithTarget,
        };
    }, TARGET);

    console.log(`   Ratio elements hiển thị: ${scanResult.ratioElsCount}`);
    scanResult.ratioEls.forEach(e => console.log(`     [${e.tag}] "${e.text}" | role=${e.role} | inMenu=${e.insideMenu}`));
    console.log(`\n   Toggle button: ${scanResult.toggleText ? `"${scanResult.toggleText}" (${scanResult.toggleTag})` : '❌ KHÔNG TÌM THẤY'}`);
    if (scanResult.toggleClass) console.log(`   Toggle class: ${scanResult.toggleClass}`);
    console.log(`\n   Tất cả elements (kể cả ẩn) có text bắt đầu "${TARGET}": ${scanResult.allWithTargetCount}`);
    scanResult.allWithTarget.forEach(e =>
        console.log(`     [${e.tag}] "${e.text}" | visible=${e.visible} | offsetParent=${e.offsetParent} | rect={w:${Math.round(e.rect.width)},h:${Math.round(e.rect.height)},top:${Math.round(e.rect.top)}}`)
    );

    if (!scanResult.toggleText) {
        console.log('\n⚠  KHÔNG TÌM THẤY TOGGLE BUTTON! Kiểm tra thêm tất cả buttons...');
        const allBtns = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button,[role=button]'))
                .filter(el => el.offsetParent !== null)
                .map(el => (el.innerText||'').trim().substring(0, 40))
                .filter(t => t.length > 0);
            return [...new Set(btns)].slice(0, 40);
        });
        console.log('   Buttons visible:', allBtns.join(' | '));
        process.exit(0);
    }

    // ── STEP 3: Ghi snapshot visible TRƯỚC khi click toggle ─────────────────
    console.log('\n── BƯỚC 3: Ghi snapshot TRƯỚC khi click toggle ────────────────');
    const beforeSnapshot = await page.evaluate((target) => {
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());
        return Array.from(document.querySelectorAll('*'))
            .filter(el => { const t = (el.innerText||'').trim(); return t.startsWith(target) && t.length < 30 && isVis(el); })
            .length;
    }, TARGET);
    console.log(`   Elements visible với text "${TARGET}" TRƯỚC click: ${beforeSnapshot}`);

    // ── STEP 4: Click toggle ─────────────────────────────────────────────────
    console.log('\n── BƯỚC 4: Click toggle button ─────────────────────────────────');
    await page.evaluate(async (target) => {
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());
        const toggle = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
            .filter(isVis)
            .find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]') && !b.closest('.menu'));
        if (toggle) toggle.click();
    }, TARGET);
    await sleep(1200);
    await page.screenshot({ path: path.join(SHOTS_DIR, '02_after_toggle_click.png') });
    console.log('📸 Screenshot: debug/ratio_shots/02_after_toggle_click.png');

    // ── STEP 5: Scan DOM SAU khi click toggle ───────────────────────────────
    console.log('\n── BƯỚC 5: Scan DOM SAU khi click toggle ──────────────────────');
    const afterResult = await page.evaluate((target) => {
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());

        // 1. Menu containers
        const menuContainers = Array.from(document.querySelectorAll(
            '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-floating-ui-portal], [data-headlessui-state], [data-state="open"]'
        ));

        // 2. Tất cả elements visible có text bắt đầu target
        const visibleNow = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText||'').trim();
            return t.startsWith(target) && t.length < 30 && isVis(el);
        }).map(el => ({
            tag: el.tagName,
            text: (el.innerText||'').trim().substring(0, 40),
            role: el.getAttribute('role'),
            classList: el.className.substring(0, 80),
            rect: el.getBoundingClientRect(),
            insideMenu: !!(el.closest('[role="menu"]') || el.closest('[role="listbox"]')),
            outerHTML: el.outerHTML.substring(0, 300),
        }));

        // 3. Tất cả elements bất kể visible/ẩn
        const allNow = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText||'').trim();
            return t.startsWith(target) && t.length < 30;
        }).length;

        // 4. Tất cả visible interactive
        const allInteractiveVisible = Array.from(document.querySelectorAll(
            'button, li, [role="menuitem"], [role="option"], [role="radio"], [role="menuitemradio"], [role="listitem"]'
        )).filter(isVis).map(el => ({
            tag: el.tagName,
            text: (el.innerText||'').trim().substring(0, 40),
            role: el.getAttribute('role'),
        })).filter(e => e.text).slice(0, 30);

        // 5. HTML của menu containers
        const menuHtml = menuContainers.map(el => ({
            tag: el.tagName,
            role: el.getAttribute('role'),
            dataAttr: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}="${a.value}"`).join(' ').substring(0,100),
            isVisible: isVis(el),
            innerText: (el.innerText||'').substring(0, 200),
        }));

        return {
            menuContainerCount: menuContainers.length,
            menuContainers: menuHtml,
            visibleNowCount: visibleNow.length,
            visibleNow,
            allNowCount: allNow,
            allInteractiveVisible,
        };
    }, TARGET);

    console.log(`   Menu containers: ${afterResult.menuContainerCount}`);
    afterResult.menuContainers.forEach(m => console.log(`     [${m.tag}] role=${m.role} | ${m.dataAttr} | visible=${m.isVisible}\n     text: "${m.innerText.substring(0,80)}"`));

    console.log(`\n   Elements VISIBLE với text "${TARGET}" SAU click: ${afterResult.visibleNowCount}`);
    afterResult.visibleNow.forEach(e => {
        console.log(`     [${e.tag}] "${e.text}" | role=${e.role} | inMenu=${e.insideMenu}`);
        console.log(`       rect: {w:${Math.round(e.rect.width)},h:${Math.round(e.rect.height)},top:${Math.round(e.rect.top)}}`);
        console.log(`       HTML: ${e.outerHTML.substring(0, 150)}`);
    });

    console.log(`\n   Tổng elements (kể cả ẩn) có text "${TARGET}": ${afterResult.allNowCount}`);
    console.log(`\n   Interactive elements đang hiện:`);
    afterResult.allInteractiveVisible.forEach(e => console.log(`     [${e.tag}] "${e.text}" | role=${e.role}`));

    if (afterResult.visibleNowCount === 0) {
        console.log('\n❌ KHÔNG TÌM THẤY ELEMENT NÀO VISIBLE! Dropdown có thể chưa mở.');
        console.log('   Nguyên nhân có thể:');
        console.log('   1. Toggle button bị tìm sai (click nhầm element không mở dropdown)');
        console.log('   2. Dropdown dùng CSS animation chưa xong sau 1.2s');
        console.log('   3. Dropdown dùng portal ở DOM location khác');
        await page.screenshot({ path: path.join(SHOTS_DIR, '02b_debug_no_options.png') });
    } else {
        // ── STEP 6: Click option target ─────────────────────────────────────
        console.log('\n── BƯỚC 6: Click option target ─────────────────────────────────');
        const clickResult = await page.evaluate(async (target) => {
            const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
            const isVis = el => el.checkVisibility
                ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                : (el.offsetParent !== null && (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })());
            const toggle = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis)
                .find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]') && !b.closest('.menu'));

            // Tìm visible element với text target, loại toggle chính nó
            const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(target) && t.length < 30 && isVis(el) && el !== toggle;
            });
            if (candidates.length === 0) return { ok: false, reason: 'no candidates after filtering toggle' };
            const chosen = candidates[0];
            chosen.click();
            await new Promise(r => setTimeout(r, 600));
            const toggleNow = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis)
                .find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]') && !b.closest('.menu'));
            return {
                ok: true,
                clicked: (chosen.innerText||'').trim().substring(0, 30),
                toggleAfter: toggleNow ? (toggleNow.innerText||'').trim() : null,
            };
        }, TARGET);

        console.log(`   Click result: ${clickResult.ok ? '✅' : '❌'} ${clickResult.reason || ''}`);
        if (clickResult.clicked) console.log(`   Đã click: "${clickResult.clicked}"`);
        if (clickResult.toggleAfter) console.log(`   Toggle SAU click: "${clickResult.toggleAfter}"`);
        const success = clickResult.toggleAfter && clickResult.toggleAfter.startsWith(TARGET);
        console.log(`\n   KẾT QUẢ: ${success ? '✅ THÀNH CÔNG — tỉ lệ đã đổi thành ' + TARGET : '❌ THẤT BẠI — tỉ lệ không đổi'}`);
        await page.screenshot({ path: path.join(SHOTS_DIR, '03_after_option_click.png') });
        console.log('📸 Screenshot: debug/ratio_shots/03_after_option_click.png');
    }

    // ── Lưu full report JSON ─────────────────────────────────────────────────
    const report = { timestamp: new Date().toISOString(), target: TARGET, beforeSnapshot, scanResult, afterResult };
    fs.writeFileSync(path.join(OUT_DIR, 'ratio_debug_result.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n💾 Full report: debug/ratio_debug_result.json`);
    console.log('📁 Screenshots: debug/ratio_shots/');
    console.log('\n✅ Debug xong! Nhấn Ctrl+C để thoát.\n');
    await new Promise(() => {});

})().catch(err => { console.error('\n❌ LỖI:', err.message); process.exit(1); });
