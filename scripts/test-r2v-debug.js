/**
 * test-r2v-debug.js v3 — tìm submit button thực sự
 */
const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const PROFILE = path.join(os.homedir(), 'AppData/Roaming/fluxy-thanh-cong-media/chrome-profiles/grok_chrome_0');
const CHROME  = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS   = path.join(__dirname, '..', 'debug', 'r2v_shots');
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const TEST_IMAGES = [
    path.join(__dirname, '..', 'debug', 'live_shots', '00_start.png'),
    path.join(__dirname, '..', 'debug', 'live_shots', '01_initial.png'),
];

if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
fs.readdirSync(SHOTS).forEach(f => fs.unlinkSync(path.join(SHOTS, f)));
let shotIdx = 0;
const shot = async (page, name) => {
    const p = path.join(SHOTS, `${String(shotIdx++).padStart(2,'0')}_${name}.png`);
    await page.screenshot({ path: p });
    console.log(`  📸 ${path.basename(p)}`);
};

(async () => {
    console.log('\n══ TEST R2V v3 ═══════════════════════════════════════════════');

    const browser = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME, headless: false,
        args: ['--disable-blink-features=AutomationControlled','--no-first-run','--window-size=1400,900'],
        ignoreDefaultArgs: ['--enable-automation'], viewport: null,
    });
    const page = browser.pages()[0] || await browser.newPage();

    // 1. Navigate
    if (!page.url().includes('grok.com/imagine')) {
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);
    } else { await sleep(2000); }
    console.log('[1] URL:', page.url(), '| loggedIn:', await page.evaluate(() => !!document.querySelector('[data-testid="user-avatar"], button[aria-label*="account" i], button[aria-label*="profile" i]') || !document.body.innerText.includes('Đăng nhập')));
    await shot(page, 'start');

    // 2. Click Video tab
    await page.evaluate(async () => {
        const b = Array.from(document.querySelectorAll('button,[role=button]')).find(b => (b.innerText||'').trim().toLowerCase() === 'video');
        if (b) { b.click(); await new Promise(r=>setTimeout(r,2500)); }
    });
    await sleep(2000);
    await shot(page, 'video_tab');

    // 3. Scan DOM đầy đủ trong Video tab
    console.log('\n[3] DOM scan trong Video tab:');
    const domInfo = await page.evaluate(() => {
        const isVis = el => el.checkVisibility ? el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) : !!el.offsetParent;
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]')).map(el => ({
            accept: el.accept, multiple: el.multiple, vis: isVis(el), style: el.style.cssText.substring(0,80)
        }));
        const allVisBtns = Array.from(document.querySelectorAll('button,[role=button]'))
            .filter(b => isVis(b))
            .map(b => ({
                text: (b.innerText||'').trim().substring(0,40),
                ariaLabel: b.getAttribute('aria-label')||'',
                type: b.type||'',
                classes: b.className.substring(0,80),
                hasSvg: !!b.querySelector('svg')
            }));
        const editors = Array.from(document.querySelectorAll('.ProseMirror,[contenteditable=true]')).map(e => ({
            tag: e.tagName, classes: e.className.substring(0,60),
            placeholder: e.getAttribute('data-placeholder')||'',
            text: (e.innerText||'').substring(0,50)
        }));
        return { fileInputs, allVisBtns, editors };
    });
    console.log('  file inputs:', domInfo.fileInputs.length, domInfo.fileInputs);
    console.log('  editors:', domInfo.editors);
    console.log('  all visible buttons:');
    domInfo.allVisBtns.forEach(b => console.log(`    text="${b.text}" aria="${b.ariaLabel}" svg=${b.hasSvg} cls="${b.classes.substring(0,50)}"`));

    // 4. Settings
    console.log('\n[4] Settings...');
    await page.evaluate(async () => {
        const sleep = ms => new Promise(r=>setTimeout(r,ms));
        const isVis = el => el.checkVisibility ? el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) : !!el.offsetParent;
        const RATIOS = ['1:1','2:3','3:2','9:16','16:9'];
        const d5 = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='5s');
        if (d5) { d5.click(); await sleep(400); }
        const toggle = Array.from(document.querySelectorAll('button,[role=button]'))
            .find(b => RATIOS.some(r=>(b.innerText||'').trim().startsWith(r)) && !b.closest('[role=menu]') && isVis(b));
        if (toggle && !(toggle.innerText||'').trim().startsWith('16:9')) {
            const rc = toggle.getBoundingClientRect();
            const cx = rc.left+rc.width/2, cy = rc.top+rc.height/2;
            ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt =>
                toggle.dispatchEvent(new (evt.startsWith('pointer')?PointerEvent:MouseEvent)(evt,{bubbles:true,cancelable:true,isPrimary:true,button:0,clientX:cx,clientY:cy})));
            await sleep(900);
            const opt = Array.from(document.querySelectorAll('[data-state=open] *')).find(el => (el.innerText||'').trim().startsWith('16:9') && isVis(el));
            if (opt) { opt.click(); await sleep(500); }
        }
    });
    await shot(page, 'settings');

    // 5. Upload
    console.log('\n[5] Upload ảnh...');
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGES);
    await sleep(6000);
    await shot(page, 'after_upload');

    // 6. Type @Image + prompt
    console.log('\n[6] Click editor & gõ...');
    const editor = page.locator('.ProseMirror,[contenteditable=true]').last();
    await editor.click();
    await sleep(500);

    for (let i = 1; i <= TEST_IMAGES.length; i++) {
        await page.keyboard.type(`@Image ${i}`, { delay: 60 });
        await sleep(800);
        await page.keyboard.press('Enter');
        await sleep(400);
        await page.keyboard.type(' ');
        await sleep(200);
    }
    await page.keyboard.type('A woman walking slowly in a beautiful garden', { delay: 25 });
    await sleep(500);
    await shot(page, 'before_submit');

    // 7. Scan TẤT CẢ buttons sau khi có nội dung trong editor
    console.log('\n[7] Scan buttons SAU khi editor có nội dung:');
    const btnScan = await page.evaluate(() => {
        const isVis = el => el.checkVisibility ? el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) : !!el.offsetParent;
        return Array.from(document.querySelectorAll('button,[role=button],[type=submit]'))
            .filter(b => isVis(b))
            .map(b => ({
                text: (b.innerText||'').trim().substring(0,50),
                aria: (b.getAttribute('aria-label')||'').substring(0,50),
                type: b.type,
                disabled: b.disabled,
                classes: b.className.substring(0,100),
                hasSvg: !!b.querySelector('svg'),
                rect: (() => { const r = b.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
                html: b.outerHTML.substring(0,200)
            }));
    });
    btnScan.forEach(b => {
        if (b.text || b.aria || b.type === 'submit') {
            console.log(`  btn: text="${b.text}" aria="${b.aria}" type=${b.type} disabled=${b.disabled} svg=${b.hasSvg} at(${b.rect})`);
        }
    });

    // 8. Tìm submit button — ưu tiên: type=submit, aria có send/submit/create, near editor position
    const editorRect = await page.evaluate(() => {
        const ed = document.querySelector('.ProseMirror,[contenteditable=true]');
        if (!ed) return null;
        const r = ed.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    });
    console.log('\n  Editor rect:', editorRect);

    // Thử nhiều cách submit
    let submitted = false;

    // Cách 1: type=submit button
    const submitBtn = btnScan.find(b => b.type === 'submit' && !b.disabled);
    if (submitBtn) {
        console.log('\n[8a] Click type=submit button:', submitBtn.text, submitBtn.aria);
        await page.evaluate(() => {
            const b = document.querySelector('button[type=submit]:not([disabled])');
            if (b) b.click();
        });
        submitted = true;
    }

    // Cách 2: button có aria-label chứa send/create/generate
    if (!submitted) {
        const sendBtn = btnScan.find(b => !b.disabled && (
            b.aria.toLowerCase().includes('send') || b.aria.toLowerCase().includes('create') ||
            b.aria.toLowerCase().includes('generate') || b.aria.toLowerCase().includes('submit') ||
            b.aria.toLowerCase().includes('gửi') || b.aria.toLowerCase().includes('tạo')
        ));
        if (sendBtn) {
            console.log('\n[8b] Click aria button:', sendBtn.text, sendBtn.aria);
            await page.evaluate((aria) => {
                const b = Array.from(document.querySelectorAll('button,[role=button]'))
                    .find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes(aria.toLowerCase()));
                if (b) b.click();
            }, sendBtn.aria);
            submitted = true;
        }
    }

    // Cách 3: SVG button NGAY BÊN PHẢI hoặc BÊN DƯỚI editor (nút send thường là icon)
    if (!submitted && editorRect) {
        const nearButtons = btnScan.filter(b => {
            const [pos] = b.rect.split(' ');
            const [bx, by] = pos.split(',').map(Number);
            // Nằm trong vùng ±200px quanh editor
            return b.hasSvg && !b.disabled && !b.text &&
                bx > editorRect.x - 50 && by > editorRect.y - 50 &&
                bx < editorRect.x + editorRect.w + 100 && by < editorRect.bottom + 100;
        });
        console.log('\n  SVG buttons near editor:', nearButtons.length);
        nearButtons.forEach(b => console.log('    -', b.rect, b.html.substring(0,100)));

        if (nearButtons.length > 0) {
            // Click button gần nhất với góc phải dưới editor (thường là nút send)
            const best = nearButtons.sort((a, b) => {
                const [ax, ay] = a.rect.split(' ')[0].split(',').map(Number);
                const [bx, by] = b.rect.split(' ')[0].split(',').map(Number);
                // Ưu tiên: gần góc phải dưới editor
                const aDist = Math.abs(ax - (editorRect.x + editorRect.w)) + Math.abs(ay - editorRect.bottom);
                const bDist = Math.abs(bx - (editorRect.x + editorRect.w)) + Math.abs(by - editorRect.bottom);
                return aDist - bDist;
            })[0];
            console.log('\n[8c] Click SVG button nearest to editor:', best.rect, best.html.substring(0,150));
            const [pos] = best.rect.split(' ');
            const [bx, by] = pos.split(',').map(Number);
            await page.mouse.click(bx + 10, by + 10);
            submitted = true;
        }
    }

    // Cách 4: Ctrl+Enter hoặc Shift+Enter
    if (!submitted) {
        console.log('\n[8d] Thử Ctrl+Enter...');
        await editor.click();
        await page.keyboard.press('Control+Enter');
        submitted = true;
    }

    await sleep(4000);
    await shot(page, 'after_submit');

    // 9. Kiểm tra kết quả
    const state = await page.evaluate(() => {
        const txt = (document.body.innerText||'').replace(/\s+/g,' ');
        return {
            isGenerating: txt.includes('Đang tạo')||txt.toLowerCase().includes('generating')||txt.includes('Hủy'),
            isError: txt.toLowerCase().includes('error')||txt.toLowerCase().includes('content moderated'),
            text: txt.substring(0,400)
        };
    });
    console.log('\n[9] Sau submit:');
    console.log('  isGenerating:', state.isGenerating);
    console.log('  isError:', state.isError);
    console.log('  text:', state.text.substring(0,300));

    if (state.isGenerating) {
        console.log('\n✅ ĐANG GENERATING! Poll...');
        for (let i = 1; i <= 15; i++) {
            await sleep(15000);
            const p = await page.evaluate(() => {
                const txt = (document.body.innerText||'').replace(/\s+/g,' ');
                const pctM = txt.match(/(\d{1,3})\s*%/g);
                return {
                    isErr: txt.toLowerCase().includes('error')||txt.toLowerCase().includes('content moderated'),
                    isDone: txt.includes('Bỏ qua') || (document.querySelectorAll('video').length > 0 && !txt.includes('Đang tạo')),
                    isGen: txt.includes('Đang tạo')||txt.toLowerCase().includes('generating'),
                    pct: pctM?pctM[pctM.length-1]:'?%'
                };
            });
            console.log(`  Poll #${i}: gen=${p.isGen} done=${p.isDone} err=${p.isErr} pct=${p.pct}`);
            if (p.isErr) { await shot(page, 'error'); break; }
            if (p.isDone) { await shot(page, 'done'); console.log('  🎉 VIDEO XONG!'); break; }
        }
    }

    await shot(page, 'final');
    console.log('\n══ XONG — xem debug/r2v_shots/ ══════════════════════════════');
    await sleep(20000);
    await browser.close();
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
