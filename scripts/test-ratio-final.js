/**
 * test-ratio-final.js — xác nhận fix pointer events
 * Mô phỏng đúng logic extension: đổi từ 9:16 → 16:9
 */
const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');

const PROFILE = path.join(os.homedir(), 'AppData/Roaming/fluxy-thanh-cong-media/chrome-profiles/grok_chrome_0');
const CHROME  = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME, headless: false,
        args: ['--disable-blink-features=AutomationControlled','--no-first-run','--window-size=1280,900'],
        ignoreDefaultArgs: ['--enable-automation'], viewport: null,
    });
    let page = browser.pages()[0] || await browser.newPage();
    if (!page.url().includes('grok.com/imagine')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(4000);
    }
    await sleep(2000);

    // Click Hình ảnh tab
    await page.evaluate(async () => {
        const b = Array.from(document.querySelectorAll('button'))
            .find(b => (b.innerText||'').trim().toLowerCase() === 'hình ảnh');
        if (b) { b.click(); await new Promise(r => setTimeout(r, 2000)); }
    });
    await sleep(2000);

    const result = await page.evaluate(async () => {
        const sleep  = ms => new Promise(r => setTimeout(r, ms));
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const isVis  = el => el.checkVisibility
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : !!el.offsetParent;

        const openDropdown = btn => {
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }));
            btn.dispatchEvent(new MouseEvent('mousedown',     { bubbles: true, cancelable: true, button: 0 }));
            btn.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, isPrimary: true }));
            btn.dispatchEvent(new MouseEvent('mouseup',       { bubbles: true, cancelable: true, button: 0 }));
            btn.dispatchEvent(new MouseEvent('click',         { bubbles: true, cancelable: true, button: 0 }));
        };

        const findToggle = () => Array.from(document.querySelectorAll('button'))
            .find(b => RATIOS.some(r => (b.innerText||'').trim().startsWith(r)) && isVis(b) && !b.closest('[role=menu]'));

        // ── Bước 1: Set về 9:16 ──────────────────────────────────────────
        const t1 = findToggle();
        const ratioInitial = (t1?.innerText||'').trim();
        let ratioAfterSet = ratioInitial;
        if (t1 && !ratioInitial.startsWith('9:16')) {
            openDropdown(t1); await sleep(900);
            const opt = Array.from(document.querySelectorAll('*')).find(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith('9:16') && t.length < 25 && isVis(el) && el !== t1;
            });
            if (opt) { opt.click(); await sleep(600); }
            ratioAfterSet = (findToggle()?.innerText||'').trim();
        }

        // ── Bước 2: Đổi sang 16:9 với pointer events ─────────────────────
        const TARGET = '16:9';
        const t2 = findToggle();
        if (!t2) return { err: 'toggle-not-found', ratioInitial, ratioAfterSet };

        const beforeVisible = new Set(
            Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(TARGET) && t.length < 25 && isVis(el);
            })
        );

        openDropdown(t2); await sleep(900);

        // Kiểm tra dropdown đã mở chưa
        const wrapper = t2.closest('[data-state]');
        const dropdownState = wrapper ? wrapper.getAttribute('data-state') : 'no-wrapper';

        // Tìm option (3 tier)
        let found = null, tier = null;

        // Tier 1: data-state=open containers
        const openContainers = Array.from(document.querySelectorAll('[data-state="open"]'));
        for (const scope of openContainers) {
            const items = Array.from(scope.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(TARGET) && t.length < 25 && isVis(el);
            });
            if (items.length > 0) { found = items[0]; tier = 'Tier1-data-state-open'; break; }
        }

        // Tier 2: newly visible
        if (!found) {
            const newlyVis = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(TARGET) && t.length < 25 && isVis(el) && !beforeVisible.has(el);
            });
            if (newlyVis.length > 0) { found = newlyVis[0]; tier = 'Tier2-newly-visible'; }
        }

        // Tier 3: any visible except toggle itself
        if (!found) {
            const anyVis = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim();
                return t.startsWith(TARGET) && t.length < 25 && isVis(el) && el !== t2;
            });
            if (anyVis.length > 0) { found = anyVis[0]; tier = 'Tier3-any-visible'; }
        }

        if (!found) {
            // Debug: liệt kê tất cả
            const allWith16 = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText||'').trim(); return t.startsWith(TARGET) && t.length < 25;
            }).map(el => ({ tag: el.tagName, text: (el.innerText||'').trim(), vis: isVis(el), html: el.outerHTML.substring(0, 120) }));
            return { err: 'option-not-found', tier: null, ratioInitial, ratioAfterSet, dropdownState, allWith16 };
        }

        found.click(); await sleep(600);
        const ratioFinal = (findToggle()?.innerText||'').trim();
        return {
            ok: true, tier,
            ratioInitial, ratioAfterSet, dropdownState,
            clickedTag: found.tagName,
            clickedText: (found.innerText||'').trim().substring(0, 30),
            clickedHTML: found.outerHTML.substring(0, 150),
            ratioFinal,
            success: ratioFinal.startsWith(TARGET),
        };
    });

    console.log('\n══ KẾT QUẢ TEST ══════════════════════════════════════');
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
        console.log('\n' + (result.success ? '✅ THÀNH CÔNG' : '❌ THẤT BẠI') + ` — Tỉ lệ cuối: "${result.ratioFinal}"`);
    }
    console.log('══════════════════════════════════════════════════════');

    await sleep(4000);
    await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
