/**
 * test-ratio-live.js
 */
const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const PROFILE = path.join(os.homedir(), 'AppData/Roaming/fluxy-thanh-cong-media/chrome-profiles/grok_chrome_0');
const CHROME  = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET  = '16:9';
const SHOTS   = path.join(__dirname, '..', 'debug', 'live_shots');

const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

async function runTest() {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  LIVE RATIO TEST — grok.com/imagine');
    console.log('══════════════════════════════════════════════════════\n');

    const browser = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME,
        headless: false,
        args: ['--disable-blink-features=AutomationControlled','--no-first-run','--window-size=1280,900'],
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: null,
    });

    let page = browser.pages()[0];
    if (!page) page = await browser.newPage();

    console.log('[1] URL hiện tại:', page.url());

    if (!page.url().includes('grok.com')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
    } else if (!page.url().includes('/imagine')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
    }
    await sleep(2000);
    console.log('[1] URL sau navigate:', page.url());
    await page.screenshot({ path: path.join(SHOTS, '00_start.png') });

    // Click Hình ảnh tab
    await page.evaluate(async () => {
        const btns = Array.from(document.querySelectorAll('button,[role=button]'));
        const t = btns.find(b => ['hình ảnh','image'].includes((b.innerText||'').trim().toLowerCase()));
        if (t) { t.click(); await new Promise(r => setTimeout(r, 2000)); }
    });
    await sleep(2000);

    // ── Scan trạng thái ban đầu ───────────────────────────────────────────
    const state1 = await page.evaluate(() => {
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null);

        const allBtns = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]')).filter(isVis);
        const ratioEls = allBtns.filter(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));
        const toggle = ratioEls[0];

        const allVisibleTexts = allBtns.map(b => (b.innerText||'').trim().substring(0,30)).filter(t=>t).slice(0,30);
        return {
            toggleText: toggle ? (toggle.innerText||'').trim() : null,
            toggleHTML: toggle ? toggle.outerHTML.substring(0,200) : null,
            allRatioEls: ratioEls.map(b => ({ tag:b.tagName, text:(b.innerText||'').trim().substring(0,25), html:b.outerHTML.substring(0,150) })),
            allVisibleBtns: allVisibleTexts,
            isLoggedIn: !document.body.innerText.includes('Sign in'),
        };
    });

    console.log('\n[2] Login:', state1.isLoggedIn ? '✅' : '❌ CHƯA ĐĂNG NHẬP');
    console.log('[2] Toggle:', state1.toggleText, '|', state1.toggleHTML);
    console.log('[2] Ratio elements:', state1.allRatioEls.length);
    state1.allRatioEls.forEach(e => console.log('   ', e.tag, JSON.stringify(e.text), e.html));
    console.log('[2] All visible buttons:', state1.allVisibleBtns.join(' | '));

    if (!state1.isLoggedIn) {
        console.log('\n❌ Chưa đăng nhập! Profile này chưa có session grok.com.');
        await page.screenshot({ path: path.join(SHOTS, '01_not_logged_in.png') });
        await browser.close(); return;
    }
    await page.screenshot({ path: path.join(SHOTS, '01_initial.png') });

    // ── Nếu chưa ở 9:16, đổi về 9:16 trước ──────────────────────────────
    if (!state1.toggleText || !state1.toggleText.startsWith('9:16')) {
        console.log('\n[3] Set ratio về 9:16 để test...');
        const setR = await page.evaluate(async () => {
            const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const isVis = el => el.checkVisibility
                ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                : (el.offsetParent !== null);
            const toggle = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis).find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));
            if (!toggle) return { err: 'toggle-not-found' };
            toggle.click(); await sleep(1000);
            const opt = Array.from(document.querySelectorAll('*')).find(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith('9:16') && t.length < 25 && isVis(el) && el !== toggle;
            });
            if (!opt) return { err: 'no-9:16-option', count: Array.from(document.querySelectorAll('*')).filter(el=>(el.innerText||'').trim().startsWith('9:16')).length };
            opt.click(); await sleep(600);
            const t2 = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis).find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));
            return { ok: true, now: (t2?.innerText||'').trim() };
        });
        console.log('   Kết quả set 9:16:', JSON.stringify(setR));
        await sleep(800);
        await page.screenshot({ path: path.join(SHOTS, '02_set_9x16.png') });
    }

    // ── Ghi snapshot visibility TRƯỚC khi mở dropdown ────────────────────
    console.log(`\n[4] Snapshot elements "${TARGET}" visible TRƯỚC click toggle...`);
    const before = await page.evaluate((tgt) => {
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null);
        return Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText||'').trim();
            return t.startsWith(tgt) && t.length < 25 && isVis(el);
        }).map(el => ({ tag:el.tagName, text:(el.innerText||'').trim(), html:el.outerHTML.substring(0,150) }));
    }, TARGET);
    console.log(`   ${before.length} element(s) visible với text "${TARGET}":`, before.map(e=>e.text));

    // ── Click toggle ──────────────────────────────────────────────────────
    console.log('\n[5] Click toggle...');
    await page.evaluate(() => {
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null);
        const toggle = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
            .filter(isVis).find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));
        if (toggle) toggle.click();
        else console.log('[DEBUG] toggle not found for click');
    });
    await sleep(1200);
    await page.screenshot({ path: path.join(SHOTS, '03_dropdown_open.png') });
    console.log('   📸 Screenshot: debug/live_shots/03_dropdown_open.png');

    // ── Scan toàn DOM sau khi dropdown mở ────────────────────────────────
    console.log(`\n[6] Scan DOM SAU khi mở dropdown, tìm "${TARGET}"...`);
    const after = await page.evaluate((tgt) => {
        const isVis = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : (el.offsetParent !== null);

        const allWithText = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = (el.innerText||'').trim();
            return t.startsWith(tgt) && t.length < 25;
        }).map(el => ({
            tag: el.tagName, text: (el.innerText||'').trim(), vis: isVis(el),
            role: el.getAttribute('role'),
            rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })(),
            html: el.outerHTML.substring(0, 250),
        }));

        const menuContainers = Array.from(document.querySelectorAll(
            '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[data-floating-ui-portal],[data-headlessui-state],[data-state="open"]'
        )).map(el => ({
            tag: el.tagName, role: el.getAttribute('role'),
            dataAttrs: [...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>`${a.name}="${a.value}"`).join(' ').substring(0,150),
            vis: isVis(el), innerText: (el.innerText||'').substring(0,200),
        }));

        const visibleNow = allWithText.filter(e => e.vis);
        return { allWithText, visibleNow, menuContainers };
    }, TARGET);

    console.log(`   Tổng elements có text "${TARGET}": ${after.allWithText.length} (${after.visibleNow.length} visible)`);
    after.allWithText.forEach(e => {
        console.log(`   [${e.tag}] "${e.text}" vis=${e.vis} rect={${e.rect.w}x${e.rect.h} top:${e.rect.top}} role=${e.role}`);
        console.log(`      HTML: ${e.html}`);
    });
    console.log(`\n   Menu containers: ${after.menuContainers.length}`);
    after.menuContainers.forEach(c => console.log(`   [${c.tag}] role=${c.role} | ${c.dataAttrs} | vis=${c.vis} | text: "${c.innerText.substring(0,80)}"`));

    // ── Thử click option ──────────────────────────────────────────────────
    if (after.visibleNow.length > 0) {
        console.log(`\n[7] Tìm thấy ${after.visibleNow.length} element visible — thử click...`);
        const clickR = await page.evaluate((tgt) => {
            const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
            const isVis = el => el.checkVisibility
                ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                : (el.offsetParent !== null);
            const toggle = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis).find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));

            const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(tgt) && t.length < 25 && isVis(el) && el !== toggle;
            });
            if (!candidates.length) return { ok: false, reason: 'no candidates excluding toggle' };
            candidates[0].click();
            return { ok: true, clicked: (candidates[0].innerText||'').trim(), tag: candidates[0].tagName };
        }, TARGET);
        console.log('   Click result:', JSON.stringify(clickR));

        await sleep(800);
        await page.screenshot({ path: path.join(SHOTS, '04_after_click.png') });

        const finalState = await page.evaluate(() => {
            const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
            const isVis = el => el.checkVisibility
                ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                : (el.offsetParent !== null);
            const t = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]'))
                .filter(isVis).find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && !b.closest('[role="menu"]'));
            return (t?.innerText||'').trim();
        });
        const success = finalState.startsWith(TARGET);
        console.log(`\n  KẾT QUẢ CUỐI: Toggle = "${finalState}"`);
        console.log(`  ${success ? '✅ THÀNH CÔNG' : '❌ THẤT BẠI'}`);
    } else {
        console.log(`\n[7] ❌ KHÔNG TÌM THẤY element visible có text "${TARGET}" sau khi dropdown mở`);
        console.log('   → Dropdown có thể không mở được, hoặc logic tìm toggle sai');
    }

    console.log('\nĐóng sau 5 giây...');
    await sleep(5000);
    await browser.close();
}

runTest().catch(e => { console.error('LỖI FATAL:', e.message, e.stack); process.exit(1); });
