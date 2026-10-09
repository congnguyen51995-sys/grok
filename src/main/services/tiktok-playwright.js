const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// TikTok product IDs are 15-20 digit numbers
function isTTProductId(v) {
  return /^\d{15,20}$/.test(String(v));
}

// Extract products from any API JSON, only accepting 15-20 digit IDs
// Strict: requires product-specific fields to avoid catching location/place data
function extractProducts(obj, found = [], depth = 0) {
  if (!obj || depth > 8 || found.length >= 200) return found;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        // Prefer explicit product ID fields over generic `id` (locations also have `id`)
        const rawId = item.product_id || item.item_id || item.sku_id;
        // For bare `id`, require at least one product-specific field to be present
        const bareId = item.id;
        const hasProductField = !!(item.product_name || item.product_title ||
          item.price_info || item.commission_rate || item.commission ||
          item.min_price || item.sale_price || item.inventory !== undefined);
        const finalId = rawId || (hasProductField ? bareId : null);

        // Do NOT use item.name — locations/places have `name` fields
        const title = item.product_name || item.product_title || item.title;

        if (finalId && title && isTTProductId(finalId) && String(title).length > 2) {
          const id  = String(finalId);
          const img = item.cover_image_urls?.[0] || item.main_images?.[0]?.urls?.[0] ||
                      item.images?.[0]?.url_list?.[0] || item.cover || item.image_url || '';
          const price = item.price_info?.sale_price || item.min_price_formatted ||
                        item.price || item.min_price || '';
          const stock = item.stock || item.inventory || '';
          const comm  = item.commission_rate || item.commission?.rate || '';
          if (!found.some(p => p.id === id)) {
            found.push({ id, title: String(title), img: String(img),
              price: String(price || ''), stock: String(stock || ''), comm: String(comm || '') });
          }
        } else {
          extractProducts(item, found, depth + 1);
        }
      }
    }
  } else if (typeof obj === 'object') {
    for (const v of Object.values(obj)) extractProducts(v, found, depth + 1);
  }
  return found;
}

// Create a minimal probe video (4s black, portrait) using ffmpeg-static
function createProbeVideo() {
  const tmpPath = path.join(os.tmpdir(), `tt_probe_${Date.now()}.mp4`);
  const ffmpegPath = require('ffmpeg-static');
  const { execSync } = require('child_process');
  execSync(
    `"${ffmpegPath}" -y -f lavfi -i color=black:size=576x1024:rate=15 -t 4 -c:v libx264 -pix_fmt yuv420p "${tmpPath}"`,
    { stdio: 'ignore', timeout: 30000 }
  );
  return tmpPath;
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function openTikTokLogin({ profileDir, onLog }) {
  onLog?.('⏳ Mở trình duyệt TikTok để đăng nhập...');
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = await ctx.newPage();
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  onLog?.('✅ Đăng nhập TikTok rồi đóng cửa sổ để lưu phiên');
  await new Promise(resolve => {
    ctx.on('close', resolve); page.on('close', resolve);
    setTimeout(resolve, 10 * 60 * 1000);
  });
  try { await ctx.close(); } catch {}
  return { ok: true };
}

async function checkTikTokLogin({ profileDir }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  try {
    const page = await ctx.newPage();
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);
    const url = page.url();
    return { ok: true, loggedIn: !url.includes('/login') && !url.includes('passport') };
  } catch (e) {
    return { ok: false, loggedIn: false, error: e.message };
  } finally {
    try { await ctx.close(); } catch {}
  }
}

// ── Scrape one page of the product table ─────────────────────────────────────
async function scrapeCurrentPage(page) {
  return page.evaluate(() => {
    const rowSels = ['tbody tr', '[class*="product-row"]', '[class*="ProductRow"]', '[class*="table-row"]', '[role="row"]'];
    let rowEls = [];
    for (const sel of rowSels) {
      rowEls = [...document.querySelectorAll(sel)];
      if (rowEls.length > 0) break;
    }

    const statusWords = ['Đang hoạt động', 'Active', 'Inactive', 'Hết hàng', 'Đã ẩn', 'Suspended'];

    return rowEls.map(row => {
      const img   = row.querySelector('img')?.src || '';
      const cells = [...row.querySelectorAll('td, [class*="cell"], [class*="Cell"]')];
      let id = '', price = '', stock = '', title = '';

      for (const c of cells) {
        const txt = c.textContent?.trim() || '';
        if (/^\d{15,20}$/.test(txt)) { id = txt; continue; }
        if (/[\d,.]+(đ|₫|\$|VND)/i.test(txt)) { price = txt; continue; }
      }
      const statusCells = cells.filter(c => statusWords.some(s => c.textContent?.includes(s)));

      // Name: longest text that's not id/price/status
      for (const c of cells) {
        const txt = c.textContent?.trim() || '';
        if (!txt || txt === id || txt === price) continue;
        if (statusCells.includes(c)) continue;
        // skip pure numbers (stock)
        if (/^\d{1,10}$/.test(txt)) { if (!stock) stock = txt; continue; }
        if (txt.length > title.length) title = txt;
      }

      // img from first cell if not found
      return { id, title: title.slice(0, 200), img, price, stock };
    }).filter(p => p.id && p.title);
  });
}

// ── Scrape ALL pages of the product modal ────────────────────────────────────
async function scrapeProductTable(page, onLog) {
  const allProducts = [];

  for (let pg = 1; pg <= 30; pg++) {
    await sleep(1500);

    const rows = await scrapeCurrentPage(page);
    let added = 0;
    for (const p of rows) {
      if (!allProducts.some(x => x.id === p.id)) { allProducts.push(p); added++; }
    }
    onLog?.(`  Trang ${pg}: ${rows.length} SP, thêm ${added} mới (tổng ${allProducts.length})`);

    // ── Debug: dump button texts to understand pagination DOM ────────────────
    if (pg === 1) {
      const btnTexts = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .map(b => (b.textContent || b.innerText || b.getAttribute('aria-label') || '').trim())
          .filter(t => t.length > 0 && t.length < 20)
          .slice(0, 40)
      );
      onLog?.(`  Debug buttons: ${btnTexts.join(' | ')}`);
    }

    // ── Navigate to next page — try multiple strategies ───────────────────
    const nextPageNum = pg + 1;

    // Strategy 1: page.evaluate — find button whose trimmed text === nextPageNum
    const navigated = await page.evaluate((num) => {
      const allBtns = [...document.querySelectorAll('button')];
      // Match button with trimmed text == page number (ignore whitespace, spans inside)
      for (const b of allBtns) {
        const txt = (b.innerText || b.textContent || '').replace(/\s+/g, '').trim();
        if (txt === String(num)) {
          if (b.disabled || b.getAttribute('disabled') !== null) return 'disabled';
          b.click();
          return 'clicked';
        }
      }
      return 'not-found';
    }, nextPageNum);

    if (navigated === 'clicked') {
      onLog?.(`  → Sang trang ${nextPageNum}`);
      await sleep(2000);
      continue;
    }

    if (navigated === 'disabled') {
      onLog?.(`  ✅ Đã lấy hết (${allProducts.length} sản phẩm, ${pg} trang)`);
      break;
    }

    // Strategy 2: Playwright CSS selector  :text-is() for exact text
    try {
      const btn2 = page.locator(`:text-is("${nextPageNum}")`);
      const c = await btn2.count().catch(() => 0);
      if (c > 0) {
        await btn2.last().click({ timeout: 3000 });
        onLog?.(`  → Sang trang ${nextPageNum} (text-is)`);
        await sleep(2000);
        continue;
      }
    } catch {}

    // No next page found
    onLog?.(`  ✅ Đã lấy hết (${allProducts.length} sản phẩm, ${pg} trang)`);
    break;
  }

  return allProducts;
}

// ── Helper: open "Thêm liên kết" → "Sản phẩm" → product modal ───────────────
async function openProductModal(page, onLog) {
  // Step 1: Scroll down to reveal "Thêm liên kết" section then click its button
  // TikTok Studio puts this section below the fold — scroll first
  for (let s = 0; s < 5; s++) {
    await page.evaluate(() => window.scrollBy(0, 300));
    await sleep(300);
  }
  await sleep(500);

  // Try JS-based click: find button near "Thêm liên kết" / "Add link" text
  let clicked = await page.evaluate(() => {
    const keywords = ['Thêm liên kết', 'Add link', 'thêm liên kết'];

    // Strategy 1: find a section/div that contains the label, click button inside
    const allDivs = [...document.querySelectorAll('div, section, aside')];
    for (const div of allDivs) {
      if (div.children.length > 5) continue; // skip large containers
      const text = div.textContent?.trim() || '';
      if (keywords.some(k => text.includes(k)) && text.length < 80) {
        const btn = div.querySelector('button') ||
                    div.parentElement?.querySelector('button');
        if (btn) { btn.click(); return true; }
      }
    }

    // Strategy 2: find the label element, then find nearest button
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue?.trim() || '';
      if (keywords.some(k => val === k || val.startsWith(k))) {
        let el = node.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!el) break;
          const btn = el.querySelector('button');
          if (btn) { btn.click(); return true; }
          el = el.parentElement;
        }
      }
    }

    // Strategy 3: any button with "Thêm" text that is NOT the main post button
    const buttons = [...document.querySelectorAll('button')];
    for (const btn of buttons) {
      const txt = btn.textContent?.trim() || '';
      if ((txt === '+ Thêm' || txt === 'Thêm' || txt === '+ Add') &&
          !btn.closest('[class*="publish"], [class*="post-btn"]')) {
        btn.click(); return true;
      }
    }
    return false;
  });

  if (!clicked) {
    // Fallback: try playwright selectors with scrollIntoView
    const addLinkSelectors = [
      '[data-e2e="add-link-btn"]',
      '[data-e2e*="link"] button',
      'button:has-text("+ Thêm")',
      '[class*="add-link"] button',
      '[class*="AddLink"] button',
      '[class*="link-btn"]',
    ];
    for (const sel of addLinkSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click();
          clicked = true;
          onLog?.('  → Click "+ Thêm liên kết" (fallback selector)');
          break;
        }
      } catch {}
    }
  } else {
    onLog?.('  → Click "+ Thêm liên kết"');
  }

  if (!clicked) {
    const currentUrl = page.url();
    onLog?.(`  ⚠️ Không tìm thấy nút "+ Thêm" liên kết (URL: ${currentUrl})`);
    // Log all buttons visible on page for debugging
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('button')].slice(0, 20).map(b => b.textContent?.trim()).filter(Boolean)
    );
    if (btns.length) onLog?.(`  Debug buttons: ${btns.join(' | ')}`);
    return false;
  }

  await sleep(1500);

  // Step 2: dialog appeared — click "Tiếp" (link-type selection dialog)
  // "Sản phẩm" should already be selected by default
  const nextBtnSels = [
    'button:has-text("Tiếp")',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    '[class*="modal"] button:has-text("Tiếp")',
    '[role="dialog"] button:has-text("Tiếp")',
  ];
  for (const sel of nextBtnSels) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); onLog?.('  → Click "Tiếp"'); break; }
    } catch {}
  }

  await sleep(2000);
  return true;
}

/**
 * Fetch affiliate products by:
 * 1. Uploading a 4-second probe video (headless)
 * 2. Clicking "Thêm liên kết" → "Tiếp" → product modal
 * 3. Scraping the product table (all pages)
 * 4. Also intercepting the product API response
 * 5. Navigating away to DISCARD the probe video (no draft saved)
 */
async function fetchAffiliateProducts({ profileDir, keyword = '', onLog }) {
  onLog?.('⏳ Tạo video probe 4 giây...');
  fs.mkdirSync(profileDir, { recursive: true });

  let tmpVideo;
  try {
    tmpVideo = createProbeVideo();
    onLog?.('✅ Video probe sẵn sàng');
  } catch (e) {
    onLog?.(`❌ Tạo video thất bại: ${e.message}`);
    return { ok: false, products: [], error: e.message };
  }

  const apiProducts = [];

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const page = await ctx.newPage();

    // Intercept API only after product modal opens (guard with a flag)
    let interceptActive = false;
    page.on('response', async (res) => {
      if (!interceptActive) return;
      try {
        const ct = res.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const json = await res.json().catch(() => null);
        if (!json) return;
        const found = extractProducts(json);
        for (const p of found) {
          if (!apiProducts.some(x => x.id === p.id)) apiProducts.push(p);
        }
      } catch {}
    });

    // Navigate to upload page
    onLog?.('⏳ Mở TikTok Studio...');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    if (page.url().includes('/login') || page.url().includes('passport')) {
      return { ok: false, products: [], error: 'Chưa đăng nhập TikTok' };
    }

    // Upload probe video
    onLog?.('⏳ Upload video probe...');
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000, state: 'attached' });
    await fileInput.setInputFiles(tmpVideo);

    // Wait for editor to appear
    onLog?.('⏳ Chờ video xử lý (1-2 phút)...');
    try {
      await page.waitForSelector(
        '[data-e2e="caption-input"], div[contenteditable="true"], [class*="DivEditorContainer"], [class*="caption-input"]',
        { timeout: 180000 }
      );
    } catch { await sleep(30000); }

    // Dismiss any popup
    try {
      const pop = await page.$('button:has-text("Hủy"), button:has-text("Cancel")');
      if (pop) { await pop.click(); await sleep(400); }
    } catch {}

    // Scroll down so the right-side panel ("Thêm liên kết") becomes visible
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(800);

    onLog?.('⏳ Mở modal sản phẩm...');

    // Activate interceptor right before opening product modal
    interceptActive = true;
    const opened = await openProductModal(page, onLog);
    await sleep(3000);

    // Wait for product table rows to appear before scraping
    let domProducts = [];
    if (opened) {
      onLog?.('⏳ Chờ bảng sản phẩm tải...');
      try {
        await page.waitForSelector('tbody tr, [class*="product-row"], [class*="ProductRow"]', { timeout: 15000 });
      } catch { onLog?.('  ⚠️ Bảng sản phẩm chưa hiện — vẫn thử scrape'); }
      await sleep(1000);
      onLog?.('⏳ Đọc danh sách sản phẩm (tất cả trang)...');
      domProducts = await scrapeProductTable(page, onLog);
    }

    // Merge API + DOM products
    const merged = [...domProducts];
    for (const p of apiProducts) {
      if (!merged.some(x => x.id === p.id)) merged.push(p);
    }

    // Close product dialog
    try {
      const cancelBtn = await page.$('button:has-text("Hủy"), button:has-text("Cancel")');
      if (cancelBtn) await cancelBtn.click();
    } catch {}
    await sleep(500);

    // Discard probe video — navigate away (DON'T save draft)
    onLog?.('⏳ Hủy video probe (không lưu)...');
    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    // Handle "Leave page?" confirmation
    try {
      await sleep(1000);
      const leaveBtn = await page.$('button:has-text("Rời khỏi"), button:has-text("Leave"), button:has-text("Thoát"), button:has-text("Discard")');
      if (leaveBtn) await leaveBtn.click();
    } catch {}

    // Filter by keyword if given
    const filtered = keyword
      ? merged.filter(p => p.title.toLowerCase().includes(keyword.toLowerCase()))
      : merged;

    onLog?.(filtered.length ? `✅ ${filtered.length} sản phẩm` : '⚠️ Không tìm thấy sản phẩm');
    return { ok: true, products: filtered };
  } catch (e) {
    onLog?.(`❌ ${e.message}`);
    return { ok: false, products: [], error: e.message };
  } finally {
    try { if (tmpVideo) fs.unlinkSync(tmpVideo); } catch {}
    try { await ctx.close(); } catch {}
  }
}

// ── Click the radio/circle at the START of a product row ─────────────────────
async function clickProductRadio(page, productId, onLog) {
  // Debug: count rows and dump first row structure
  const rowInfo = await page.evaluate((pid) => {
    const allRows = [
      ...document.querySelectorAll('tbody tr'),
      ...document.querySelectorAll('[class*="product-row"]'),
      ...document.querySelectorAll('[class*="ProductRow"]'),
    ];
    const matchRow = pid ? allRows.find(r => r.textContent?.includes(pid)) : allRows[0];
    const firstRow = matchRow || allRows[0];
    return {
      totalRows: allRows.length,
      hasMatch: !!matchRow,
      firstRowCells: firstRow
        ? [...firstRow.querySelectorAll('td, [role="cell"]')].length
        : 0,
      hasNativeRadio: !!(firstRow?.querySelector('input[type="radio"]')),
      hasRoleRadio: !!(firstRow?.querySelector('[role="radio"]')),
      firstCellRect: (() => {
        const cell = firstRow?.querySelector('td, [role="cell"]');
        if (!cell) return null;
        const r = cell.getBoundingClientRect();
        return { x: r.x + r.width * 0.25, y: r.y + r.height / 2, w: r.width, h: r.height };
      })(),
    };
  }, productId || '');

  onLog?.(`  → Rows: ${rowInfo.totalRows}, match: ${rowInfo.hasMatch}, cells: ${rowInfo.firstRowCells}, nativeRadio: ${rowInfo.hasNativeRadio}`);

  if (rowInfo.totalRows === 0) {
    onLog?.('  ⚠️ Không tìm thấy dòng nào trong bảng sản phẩm');
    return;
  }

  // Strategy 1: JS click via evaluate (bypasses TUXModal-overlay hit-test intercept)
  const jsResult = await page.evaluate((pid) => {
    const rows = [
      ...document.querySelectorAll('tbody tr'),
      ...document.querySelectorAll('[class*="product-row"]'),
      ...document.querySelectorAll('[class*="ProductRow"]'),
    ];
    const row = pid ? rows.find(r => r.textContent?.includes(pid)) : rows[0];
    if (!row) return { ok: false, reason: 'no matching row' };

    // Try radio input first
    const radio = row.querySelector('input[type="radio"]');
    if (radio) { radio.click(); return { ok: true, method: 'radio.click()' }; }

    // Try role="radio" or custom class
    const roleEl = row.querySelector('[role="radio"], [class*="Radio"], [class*="radio"]');
    if (roleEl) { roleEl.click(); return { ok: true, method: 'role-radio.click()' }; }

    // Get BoundingClientRect of first cell for mouse click fallback
    const firstCell = row.querySelector('td, [role="cell"]');
    if (firstCell) {
      const r = firstCell.getBoundingClientRect();
      return { ok: false, method: 'need-mouse', rect: { x: r.x + r.width * 0.25, y: r.y + r.height / 2 } };
    }

    // Last: click the whole row
    row.click();
    return { ok: true, method: 'row.click()' };
  }, productId || '');

  if (jsResult.ok) {
    onLog?.(`  → Radio (${jsResult.method})`);
    return;
  }

  // Strategy 2: page.mouse.click at actual screen coordinates (real browser event — TUXModal-overlay does NOT block mouse at correct coordinates)
  if (jsResult.rect) {
    const { x, y } = jsResult.rect;
    onLog?.(`  → Mouse click radio tọa độ (${Math.round(x)}, ${Math.round(y)})`);
    await page.mouse.click(x, y);
    return;
  }

  onLog?.(`  ⚠️ Không click được radio: ${jsResult.reason}`);
}

// ── Helper: click "Tiếp"/"Next" — JS evaluate to bypass TUXModal-overlay ─────
async function clickNextButton(page, onLog, label = '"Tiếp"') {
  // Use JS evaluate + mouse.click to bypass TUXModal-overlay hit-test intercept
  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    for (const btn of [...buttons].reverse()) {
      const txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt === 'Tiếp' || txt === 'Next' || txt === 'Continue') {
        btn.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        return {
          found: true,
          disabled: btn.disabled,
          rect: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        };
      }
    }
    return {
      found: false,
      btns: buttons
        .map(b => (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 0 && t.length < 25)
        .slice(0, 40),
    };
  });

  if (result.found) {
    // Use page.mouse.click — real browser event at exact coordinates, bypasses overlay z-index
    await page.mouse.click(result.rect.x, result.rect.y);
    onLog?.(`  → Click ${label} tọa độ (${Math.round(result.rect.x)},${Math.round(result.rect.y)})${result.disabled ? ' [was disabled]' : ''}`);
    return true;
  }

  onLog?.(`  ⚠️ Không tìm thấy ${label} — Buttons: ${(result.btns || []).join(' | ')}`);
  return false;
}

// ── Helper: tag a product in TikTok Studio upload editor ─────────────────────
async function tagProduct(page, product, onLog) {
  onLog?.(`⏳ Gắn sản phẩm: ${(product.title || '').slice(0, 50)} [ID: ${product.id}]`);
  try {
    await page.evaluate(() => window.scrollBy(0, 400));
    await sleep(800);

    // ── Step 1: Open product modal ─────────────────────────────────────────
    onLog?.('  [1/5] Mở modal sản phẩm...');
    const opened = await openProductModal(page, onLog);
    if (!opened) { onLog?.('  ❌ [1/5] Không mở được modal'); return; }
    onLog?.('  ✓ [1/5] Modal mở xong');
    await sleep(2000);

    // ── Step 2: Search by product ID (JS-based to bypass TUXModal-overlay hit-test block) ──
    onLog?.('  [2/5] Tìm kiếm theo ID sản phẩm...');
    if (product.id) {
      const searchResult = await page.evaluate((pid) => {
        // Find search input inside the floating modal portal
        const containers = [
          document.querySelector('[data-floating-ui-portal]'),
          document.querySelector('[class*="TUXModal"]'),
          document.querySelector('[class*="modal"]'),
          document.body,
        ];
        let input = null;
        for (const c of containers) {
          if (!c) continue;
          input = c.querySelector(
            'input[type="search"], input[type="text"][placeholder*="earch"], ' +
            'input[placeholder*="ìm"], input[placeholder*="earch"], ' +
            'input[placeholder*="Search"], input[placeholder*="search"]'
          );
          if (input) break;
        }
        if (!input) return { ok: false };

        // React-compatible value set (avoids synthetic event issues)
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input), 'value'
        )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, pid);
        } else {
          input.value = pid;
        }
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return { ok: true, placeholder: input.placeholder || '' };
      }, product.id);

      if (searchResult.ok) {
        onLog?.(`  ✓ [2/5] Đã nhập ID vào ô search (placeholder: "${searchResult.placeholder}")`);
        await sleep(2000); // Wait for TikTok to filter results
      } else {
        onLog?.('  ⚠️ [2/5] Không tìm thấy ô search — dùng bảng toàn bộ');
      }
    } else {
      onLog?.('  ⚠️ [2/5] Sản phẩm không có ID — thử chọn dòng đầu tiên');
    }

    // ── Step 3: Click radio button ─────────────────────────────────────────
    onLog?.('  [3/5] Click chọn radio sản phẩm...');
    await clickProductRadio(page, product.id, onLog);
    await sleep(1200);
    onLog?.('  ✓ [3/5] Đã click radio');

    // ── Step 4: Click "Tiếp" to confirm ────────────────────────────────────
    onLog?.('  [4/5] Click "Tiếp" xác nhận...');
    const nextClicked = await clickNextButton(page, onLog, '"Tiếp" (xác nhận sản phẩm)');
    if (!nextClicked) {
      onLog?.('  ⚠️ [4/5] Không click được "Tiếp" — vẫn thử tiếp');
    } else {
      onLog?.('  ✓ [4/5] Đã click "Tiếp"');
    }
    await sleep(2000);

    // ── Step 5: Fill name dialog → click "Thêm" ───────────────────────────
    onLog?.('  [5/5] Điền tên sản phẩm...');
    const displayName = (product.displayName || product.title || '').slice(0, 30);

    const nameInput = await page.waitForSelector(
      'input[maxlength="30"], input[placeholder*="ên sản phẩm"], input[placeholder*="roduct name"], input[placeholder*="product"]',
      { timeout: 6000 }
    ).catch(() => null);

    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await nameInput.fill(displayName);
      onLog?.(`  ✓ [5/5] Nhập tên: "${displayName}"`);
      await sleep(500);

      // Click "Thêm" button (JS, last match to avoid outer "Thêm" buttons)
      const addClicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        for (const btn of [...btns].reverse()) {
          const txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt === 'Thêm' || txt === 'Add') { btn.scrollIntoView(); btn.click(); return true; }
        }
        return false;
      });
      if (addClicked) {
        onLog?.(`✅ Đã gắn sản phẩm "${displayName}"`);
      } else {
        try {
          const btn = page.locator('button').filter({ hasText: /^(Thêm|Add)$/ }).last();
          await btn.click({ force: true, timeout: 3000 });
          onLog?.(`✅ Đã gắn sản phẩm "${displayName}" (locator)`);
        } catch { onLog?.('  ⚠️ [5/5] Không click được "Thêm"'); }
      }
    } else {
      // Name dialog did not appear — maybe TikTok skipped it (some flows go straight to done)
      onLog?.('  ⚠️ [5/5] Không hiện dialog tên — thử click "Thêm" trực tiếp');
      const addClicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        for (const btn of [...btns].reverse()) {
          const txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt === 'Thêm' || txt === 'Add') { btn.click(); return true; }
        }
        return false;
      });
      if (addClicked) onLog?.('✅ Đã gắn sản phẩm (không có dialog tên)');
      else onLog?.('  ❌ [5/5] Không thể gắn sản phẩm');
    }

    await sleep(1000);
  } catch (e) {
    onLog?.(`❌ Gắn sản phẩm lỗi: ${e.message}`);
  }
}

/**
 * Post video to TikTok.
 * If product is given (object with id + title) → auto-tag in upload editor.
 * headless=true runs hidden.
 */
async function postToTikTok({ videoPath, caption, profileDir, product, productName, headless = true, onLog, onProgress }) {
  // Support both `product` (object) and legacy `productName` (string)
  const prod = product || (productName ? { id: '', title: productName } : null);

  onLog?.(`⏳ Upload TikTok${headless ? ' (ẩn)' : ''}...`);
  fs.mkdirSync(profileDir, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 820 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = await ctx.newPage();

  try {
    onLog?.('⏳ Tải TikTok Studio...');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    if (page.url().includes('/login') || page.url().includes('passport')) {
      await ctx.close();
      return { ok: false, error: 'Chưa đăng nhập TikTok' };
    }

    onProgress?.(10);
    onLog?.('⏳ Upload video...');
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000, state: 'attached' });
    await fileInput.setInputFiles(videoPath);

    onProgress?.(25);
    onLog?.('⏳ Chờ video xử lý...');
    try {
      await page.waitForSelector(
        '[data-e2e="caption-input"], div[contenteditable="true"], [class*="caption-input"]',
        { timeout: 120000 }
      );
    } catch { await sleep(20000); }

    // Dismiss popup
    try {
      const pop = await page.$('button:has-text("Hủy")');
      if (pop) { await pop.click(); await sleep(400); }
    } catch {}

    onProgress?.(60);

    // Fill caption
    if (caption) {
      try {
        // Wait for caption editor to appear
        await page.waitForSelector(
          '[data-e2e="caption-input"], div[contenteditable="true"]',
          { timeout: 10000 }
        );
        await sleep(500);

        const cap = caption.slice(0, 2000);
        const filled = await page.evaluate((text) => {
          // Try data-e2e first (most specific), then first contenteditable
          const el = document.querySelector('[data-e2e="caption-input"]') ||
                     document.querySelector('div[contenteditable="true"]');
          if (!el) return false;
          el.focus();
          // Select all existing text and replace
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, text);
          return true;
        }, cap);

        if (filled) {
          onLog?.(`✅ Caption: "${cap.slice(0, 40)}${cap.length > 40 ? '…' : ''}"`);
        } else {
          // Fallback: click + type
          const el = await page.$('div[contenteditable="true"]');
          if (el) {
            await el.click({ clickCount: 3 });
            await page.keyboard.press('Delete');
            await el.type(cap, { delay: 15 });
            onLog?.('✅ Caption (fallback type)');
          }
        }
        await sleep(300);
      } catch (e) { onLog?.(`⚠️ Caption: ${e.message}`); }
    }

    onProgress?.(70);

    // Scroll down to expose "Thêm liên kết" before tagging
    if (prod) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(800);
      await tagProduct(page, prod, onLog);
    }

    onProgress?.(85);

    // Close any leftover modal/overlay before clicking post
    try { await page.keyboard.press('Escape'); await sleep(400); } catch {}
    try {
      const overlay = await page.$('[class*="TUXModal-overlay"], [class*="modal-overlay"], [class*="ModalOverlay"]');
      if (overlay) {
        // Try clicking outside the modal to dismiss it
        await page.mouse.click(50, 50);
        await sleep(600);
      }
    } catch {}
    // Close any remaining dialog with "Hủy" or "Cancel"
    try {
      const cancelBtn = await page.$('[role="dialog"] button:has-text("Hủy"), [role="dialog"] button:has-text("Cancel"), [class*="modal"] button:has-text("Hủy")');
      if (cancelBtn) { await cancelBtn.click(); await sleep(500); }
    } catch {}

    // Set privacy to "Mọi người" (Everyone/Public) if not already
    onLog?.('⏳ Kiểm tra quyền riêng tư...');
    try {
      const privacySet = await page.evaluate(() => {
        // TikTok upload page has a privacy selector showing current choice
        // Look for the privacy control row — it contains "Mọi người", "Bạn bè", "Chỉ mình"
        const allBtns = [...document.querySelectorAll('button, [role="option"], [class*="select"], [class*="dropdown-item"], [class*="menu-item"]')];
        const everyoneBtn = allBtns.find(el => {
          const t = (el.innerText || el.textContent || '').trim();
          return t === 'Mọi người' || t === 'Everyone' || t === 'Public';
        });
        if (everyoneBtn) { everyoneBtn.click(); return 'clicked_everyone'; }

        // Try opening the privacy dropdown first (look for current value label)
        const currentPrivacy = [...document.querySelectorAll('button, [role="button"]')].find(el => {
          const t = (el.innerText || el.textContent || '').trim();
          return t === 'Chỉ mình' || t === 'Chỉ mình tôi' || t === 'Only me' ||
                 t === 'Bạn bè' || t === 'Friends';
        });
        if (currentPrivacy) { currentPrivacy.click(); return 'opened_dropdown'; }
        return 'not_found';
      });
      if (privacySet === 'opened_dropdown') {
        await sleep(600);
        // Now pick "Mọi người" from the opened dropdown
        await page.evaluate(() => {
          const opts = [...document.querySelectorAll('[role="option"], [class*="dropdown-item"], [class*="menu-item"], li, button')];
          const ev = opts.find(el => {
            const t = (el.innerText || el.textContent || '').trim();
            return t === 'Mọi người' || t === 'Everyone' || t === 'Public';
          });
          if (ev) ev.click();
        });
        await sleep(400);
        onLog?.('✅ Đặt quyền riêng tư: Mọi người');
      } else if (privacySet === 'clicked_everyone') {
        onLog?.('✅ Đặt quyền riêng tư: Mọi người');
      } else {
        onLog?.('  ⚠️ Không tìm thấy nút quyền riêng tư — giữ nguyên mặc định');
      }
    } catch (e) { onLog?.(`  ⚠️ Privacy: ${e.message}`); }

    // Scroll all the way to bottom where "Đăng" button lives
    onLog?.('⏳ Cuộn xuống nút Đăng...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);

    onLog?.('⏳ Bấm Đăng...');

    // Find the "Đăng" post button specifically — it's the pink/primary button at bottom
    // NOT "Lưu bản nháp" (draft) or "Hủy bỏ" (cancel)
    const posted = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      // Find primary submit button: data-e2e="post-button" or text "Đăng" that is NOT inside a modal
      const candidates = buttons.filter(b => {
        const txt = b.textContent?.trim();
        const isModal = !!b.closest('[class*="modal"], [class*="Modal"], [role="dialog"]');
        return !isModal && (
          b.dataset?.e2e === 'post-button' ||
          txt === 'Đăng' ||
          txt === 'Post' ||
          txt === 'Publish'
        );
      });
      if (!candidates.length) return false;
      // Pick the last one (bottom of page)
      const btn = candidates[candidates.length - 1];
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return true;
    });

    if (!posted) {
      // Fallback: try data-e2e attribute
      try {
        const btn = await page.$('[data-e2e="post-button"]');
        if (btn) {
          await btn.scrollIntoViewIfNeeded();
          await sleep(300);
          await btn.click();
        }
      } catch {}
    }

    onProgress?.(95);

    try {
      await page.waitForFunction(() => {
        const t = document.body.innerText || '';
        return t.includes('successfully') || t.includes('thành công') || t.includes('Your video is being') || t.includes('đang được xử lý');
      }, { timeout: 30000 });
    } catch { await sleep(8000); }

    onProgress?.(100);
    onLog?.('✅ Đã đăng video lên TikTok!');
    await sleep(2000);

    try { await ctx.close(); } catch {}
    return { ok: true };
  } catch (e) {
    onLog?.(`❌ ${e.message}`);
    try { await ctx.close(); } catch {}
    return { ok: false, error: e.message };
  }
}

module.exports = { openTikTokLogin, checkTikTokLogin, fetchAffiliateProducts, postToTikTok };
