const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Chuyển file_index (số hoặc chuỗi như "r2v_ts_scene4_a1") → số thứ tự 1-based
function getGrokSeqNum(fileIndex) {
    if (typeof fileIndex === 'number' && fileIndex > 0) return fileIndex;
    const s = String(fileIndex || '');
    const sceneM = s.match(/scene(\d+)/);  if (sceneM)  return parseInt(sceneM[1])  + 1;
    const trailM = s.match(/_(\d+)(?:_a\d+)?$/); if (trailM) return parseInt(trailM[1]) + 1;
    return null;
}

class PlaywrightEngine {
  constructor(options) {
    this.downloadsDir    = options.downloadsDir;
    this.profilesBaseDir = options.profilesBaseDir;
    this.debugDir        = path.join(path.dirname(this.downloadsDir), 'debug_screenshots');
    this.db              = options.db;
    this.onProgress      = options.onProgress || (() => {});
    this.onComplete      = options.onComplete || (() => {});
    this.onError         = options.onError || (() => {});
    this.chromePool      = new Map();
    this.profileJobCount = new Map(); 
    this.initPromises    = new Map(); 

    if (!fs.existsSync(this.downloadsDir)) fs.mkdirSync(this.downloadsDir, { recursive: true });
    if (!fs.existsSync(this.debugDir)) fs.mkdirSync(this.debugDir, { recursive: true });
  }

  _buildFileName(job, type, ext) {
    const seq = getGrokSeqNum(job.file_index);
    const prefix = type === 'image' ? 'image' : 'video';
    return seq ? `${prefix}_${seq}.${ext}` : `${prefix}_${job.id}.${ext}`;
  }

  async _ensureChrome(profileId) {
    if (this.initPromises.has(profileId)) return await this.initPromises.get(profileId);
    const existing = this.chromePool.get(profileId);
    if (existing?.process?.exitCode === null && existing.browser) return existing;

    const initTask = async () => {
        const { findChromePath } = require('./chrome-profile-manager');
        const chromePath = findChromePath();
        
        let port = 9300 + Math.floor(Math.random() * 100);
        const isPortFree = (p) => new Promise(res => {
            const s = net.createServer();
            s.unref(); s.once('error', () => res(false));
            s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
        });
        while (!(await isPortFree(port))) port++;

        const userDataDir = path.join(this.profilesBaseDir, `profile_${profileId}`);
        const proc = spawn(chromePath, [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${userDataDir}`,
          '--disable-blink-features=AutomationControlled',
          
          // --- THỦ THUẬT ẨN CHROME HOÀN TOÀN CHỐNG CLOUDFLARE ---
          '--window-position=-32000,-32000', 
          '--start-minimized',               
          
          // --- TẮT TOÀN BỘ ÂM THANH TRÌNH DUYỆT ĐỂ CHỐNG ỒN ---
          '--mute-audio',
          // ---------------------------------------------------

          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--hide-crash-restore-bubble',
          '--disable-features=Translate', 
          '--disable-translate',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1280,1024',
        ], { detached: false, stdio: 'ignore' });

        const entry = { process: proc, port, browser: null };
        this.chromePool.set(profileId, entry);
        await sleep(4000);
        entry.browser = await chromium.connectOverCDP(`http://localhost:${port}`);
        return entry;
    };
    this.initPromises.set(profileId, initTask());
    try { return await this.initPromises.get(profileId); } finally { this.initPromises.delete(profileId); }
  }

  // =========================================================================================
  // ⚙️ TRỢ LÝ CLICKER CHUNG (ĐÃ VÁ LỖI 10s CHO 9:16)
  // =========================================================================================
  async _applySettings(page, job, isVideo) {
      const aspectRatio = job.aspectRatio || job.aspect_ratio;
      const quality = job.quality || job.resolution;
      const duration = job.duration;

      console.log(`[Job ${job.id}] Cài đặt thông số: Tỉ lệ [${aspectRatio || 'Mặc định'}]` + (isVideo ? ` | Dài [${duration ? duration+'s' : 'Mặc định'}] | Nét [${quality || 'Mặc định'}]` : ''));

      try {
          // Hàm tiện ích: Chỉ click thay đổi nếu tỉ lệ hiện tại khác tỉ lệ mục tiêu
          const pickRatio = async (targetRatio) => {
              if (!targetRatio) return;
              const currentRatioText = await page.evaluate(() => {
                  const ratios = ['1:1', '2:3', '3:2', '9:16', '16:9'];
                  const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                  const btn = btns.find(b => ratios.some(r => b.innerText.trim().startsWith(r)) && !b.closest('[role="menu"]') && !b.closest('.menu'));
                  return btn ? btn.innerText.trim() : null;
              });

              if (currentRatioText && !currentRatioText.startsWith(targetRatio)) {
                  // Mở Menu chọn Tỉ lệ
                  await page.locator('button, div[role="button"]').filter({ hasText: currentRatioText }).first().click({ timeout: 2000 }).catch(()=>{});
                  await sleep(800); 
                  // Bấm vào Tỉ lệ mong muốn
                  await page.getByText(targetRatio).last().click({ timeout: 2000 }).catch(()=>{});
                  await sleep(500);
              }
          };

          if (isVideo) {
              // BƯỚC 1: TRICK GIẢI MÃ GROK - Ép chọn 16:9 trước để mở khóa nút 10s
              await pickRatio('16:9');
              await sleep(500);

              // BƯỚC 2: Chọn thời lượng (10s) và chất lượng (High)
              if (duration) {
                  await page.getByText(`${duration}s`, { exact: true }).last().click({ timeout: 1500 }).catch(()=>{});
                  await sleep(500);
              }
              if (quality) {
                  await page.getByText(quality, { exact: true }).last().click({ timeout: 1500 }).catch(()=>{});
                  await sleep(500);
              }

              // BƯỚC 3: Trả về đúng Tỉ lệ khung hình người dùng cần (Ví dụ: 9:16)
              if (aspectRatio && aspectRatio !== '16:9') {
                  await pickRatio(aspectRatio);
              }
          } else {
              // Nếu là Ảnh thì cứ chọn tỉ lệ bình thường, không cần trick
              await pickRatio(aspectRatio);
          }
      } catch (err) {
          console.warn(`[Job ${job.id}] ⚠️ Cảnh báo: Không thể tự click chọn thông số, chạy bằng mặc định.`);
      }
  }

  // =========================================================================================
  // 🧭 ROUTER ĐIỀU PHỐI TỔNG
  // =========================================================================================
  async executeJobViaChrome(job) {
    const profileId = job.profile_id || 1;
    let page = null;

    const count = this.profileJobCount.get(profileId) || 0;
    this.profileJobCount.set(profileId, count + 1);

    try {
      this.onProgress(job.id, 2);
      if (count > 0) await sleep(2000 * count);

      const { browser } = await this._ensureChrome(profileId);
      const context = browser.contexts()[0];
      page = await context.newPage();

      console.log(`[Job ${job.id}] Đang mở grok.com/imagine...`);
      await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000); 
      this.onProgress(job.id, 5);

      const mode = (job.mode || '').toUpperCase().replace(/\s+/g, '_');
      
      if (mode === 'TEXT_TO_VIDEO') {
          await this._handleTextToVideo(page, job);
      } 
      else if (mode === 'TEXT_TO_IMAGE') {
          await this._handleTextToImage(page, job);
      } 
      else if (mode === 'IMAGE_TO_VIDEO') {
          await this._handleImageToVideo(page, job);
      }
      else if (mode === 'REF_TO_VIDEO') {
          await this._handleReferenceToVideo(page, job);
      }
      else if (mode === 'VIDEO_EXTEND') {
          await this._handleVideoExtend(page, job);
      }
      else {
          throw new Error(`Chế độ [${job.mode}] chưa được hệ thống hỗ trợ!`);
      }

    } catch (error) {
      console.error(`[Job ${job.id}] LỖI QUY TRÌNH: ${error.message}`);
      this.onError(job.id, error);
    } finally {
      await page?.close();
      const rem = (this.profileJobCount.get(profileId) || 1) - 1;
      this.profileJobCount.set(profileId, rem);
      if (rem <= 0) {
          const entry = this.chromePool.get(profileId);
          if (entry) {
              await entry.browser?.close();
              entry.process.kill();
              this.chromePool.delete(profileId);
          }
      }
    }
  }

  // =========================================================================================
  // 📽️ [MODULE 1] TEXT TO VIDEO
  // =========================================================================================
  async _handleTextToVideo(page, job) {
      console.log(`[Job ${job.id}] Khởi động Module: TEXT TO VIDEO`);
      await page.getByText('Video', { exact: true }).first().click().catch(() => {});
      await sleep(2000);

      await this._applySettings(page, job, true);

      const editor = page.locator('.ProseMirror, [contenteditable="true"], textarea').last();
      await editor.click();
      
      if (job.prompt) {
          await editor.fill(job.prompt);
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
      }

      await sleep(1000);
      await page.keyboard.press('Enter');
      
      this.onProgress(job.id, 10);
      console.log(`[Job ${job.id}] Đã gửi Prompt. Bắt đầu theo dõi đa luồng...`);

      let isDone = false;
      let lastPct = 10;

      for (let i = 1; i <= 150; i++) {
        await sleep(15000); 
        console.log(`\n[Job ${job.id}] ⏳ Radar quét lần ${i}...`);

        try {
            const data = await Promise.race([
                page.evaluate(() => {
                    const text = document.body.textContent || '';
                    const cleanText = text.replace(/\s+/g, ' ');
                    let pct = 10;
                    const match = cleanText.match(/(?:Đang tạo|Generating|Tạo)[^\d]*(\d{1,3})\s*%/i) || cleanText.match(/(\d{1,3})\s*%/g);
                    if (match) pct = Array.isArray(match) ? parseInt(match[match.length - 1]) : parseInt(match[1]);

                    const isGenerating = cleanText.includes('Đang tạo') || cleanText.toLowerCase().includes('generating') || cleanText.includes('Hủy');
                    const hasABTest = cleanText.includes('Bạn thích giữ video nào hơn') || cleanText.includes('Bỏ qua');
                    const isModerated = cleanText.toLowerCase().includes('content moderated') || cleanText.toLowerCase().includes('try a different idea');

                    let hasMediaReady = false;
                    const vids = document.querySelectorAll('video');
                    if (vids.length > 0) {
                        const lastVid = vids[vids.length - 1];
                        if (lastVid.src || lastVid.currentSrc || lastVid.poster) hasMediaReady = true;
                    }

                    return { pct, isFinished: hasABTest || (hasMediaReady && (!isGenerating || pct === 100)), isModerated, isGenerating };
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tab bị nghẽn')), 5000))
            ]);

            if (data.isModerated) {
                throw new Error("Bị chặn: Vi phạm chính sách nội dung của Grok (Content Moderated).");
            }
            if (i >= 10 && !data.isGenerating && !data.isFinished) {
                throw new Error("Lỗi: Quá 10 lần quét không thấy phản hồi, tự động tắt Tab để chống treo máy.");
            }

            if (data.isFinished) {
                console.log(`[Job ${job.id}] 🎉 ĐÃ XONG! Màn hình đã xuất hiện Video.`);
                isDone = true;
                this.onProgress(job.id, 99);
                break; 
            }

            if (data.pct > lastPct && data.pct <= 100) {
                lastPct = data.pct;
                this.onProgress(job.id, lastPct);
            } else if (lastPct < 90) {
                lastPct += 2;
                this.onProgress(job.id, lastPct);
            }
        } catch (checkError) {
            if (checkError.message.includes('Lỗi') || checkError.message.includes('Bị chặn')) throw checkError; 
            console.warn(`[Job ${job.id}] ⚠️ Khựng nhẹ do Tab chạy ngầm. Bỏ qua và quét tiếp...`);
            await page.evaluate(() => window.focus()).catch(()=>{});
        }
      }

      if (!isDone) throw new Error("Timeout: Chờ quá lâu mà Video không hiện ra.");

      await sleep(2000);
      await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const skipBtn = btns.find(b => (b.innerText || '').toLowerCase().includes('bỏ qua'));
          if (skipBtn) skipBtn.click();
      }).catch(() => {});
      await sleep(2000);

      const mediaData = await page.evaluate(async () => {
          try {
              let targetUrl = '';
              const vids = Array.from(document.querySelectorAll('video'));
              if (vids.length === 0) return null;
              const vid = vids[vids.length - 1];
              targetUrl = vid.src || vid.currentSrc || (vid.querySelector('source')?.src);

              if (!targetUrl || (!targetUrl.startsWith('blob:') && !targetUrl.startsWith('http'))) return null;

              const res = await fetch(targetUrl);
              const blob = await res.blob();
              return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve({ b64: reader.result.split(',')[1], ext: 'mp4' });
                  reader.readAsDataURL(blob);
              });
          } catch (err) { return null; }
      });

      if (mediaData && mediaData.b64) {
          const fileName = this._buildFileName(job, 'video', mediaData.ext);
          const localPath = path.join(this.downloadsDir, fileName);
          fs.writeFileSync(localPath, Buffer.from(mediaData.b64, 'base64'));
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      } else {
          const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
          const clicked = await page.evaluate(() => {
              const dlBtns = Array.from(document.querySelectorAll('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]'));
              if (dlBtns.length > 0) { dlBtns[dlBtns.length - 1].click(); return true; }
              return false;
          });
          if (!clicked) {
             await page.locator('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]').last().click({ force: true }).catch(()=>{});
          }
          const download = await downloadPromise;
          const fileName = this._buildFileName(job, 'video', 'mp4');
          const localPath = path.join(this.downloadsDir, fileName);
          await download.saveAs(localPath);
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      }
  }

  // =========================================================================================
  // 🖼️ [MODULE 2] TEXT TO IMAGE
  // =========================================================================================
  async _handleTextToImage(page, job) {
      console.log(`[Job ${job.id}] Khởi động Module: TEXT TO IMAGE`);
      await page.getByText('Hình ảnh', { exact: true }).first().click().catch(() => {});
      await sleep(2000);

      await this._applySettings(page, job, false);

      const initialLastImgSrc = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img')).filter(img => img.clientWidth > 100);
          return imgs.length > 0 ? imgs[imgs.length - 1].src : null;
      }).catch(() => null);

      const editor = page.locator('.ProseMirror, [contenteditable="true"], textarea').last();
      await editor.click();
      
      if (job.prompt) {
          await editor.fill(job.prompt);
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
      }

      await sleep(1000);
      await page.keyboard.press('Enter');
      
      this.onProgress(job.id, 10);
      let isDone = false, lastPct = 10;

      for (let i = 1; i <= 60; i++) {
        await sleep(10000); 
        try {
            const data = await page.evaluate(({ initialLastImgSrc }) => {
                const text = document.body.innerText || ''; 
                const cleanText = text.replace(/\s+/g, ' ');
                let pct = 10;
                const match = cleanText.match(/(?:Đang tạo|Generating|Tạo)[^\d]*(\d{1,3})\s*%/i) || cleanText.match(/(\d{1,3})\s*%/g);
                if (match) pct = Array.isArray(match) ? parseInt(match[match.length - 1]) : parseInt(match[1]);

                const imgs = Array.from(document.querySelectorAll('img')).filter(img => img.clientWidth > 100);
                const currentLastImgSrc = imgs.length > 0 ? imgs[imgs.length - 1].src : null;
                
                const isGenerating = !!document.querySelector('button[aria-label*="Hủy" i], button[aria-label*="Cancel" i]') || cleanText.includes('Đang tạo');
                const isModerated = cleanText.toLowerCase().includes('content moderated') || cleanText.toLowerCase().includes('try a different idea');
                const isFinished = !isGenerating && (currentLastImgSrc && currentLastImgSrc !== initialLastImgSrc);
                
                return { pct, isFinished, isModerated, isGenerating };
            }, { initialLastImgSrc });

            if (data.isModerated) {
                throw new Error("Bị chặn: Vi phạm chính sách nội dung của Grok (Content Moderated).");
            }
            if (i >= 10 && !data.isGenerating && !data.isFinished) {
                throw new Error("Lỗi: Quá 10 lần quét không thấy phản hồi, tự động tắt Tab để chống treo máy.");
            }

            if (data.isFinished) { isDone = true; this.onProgress(job.id, 99); break; }
            if (data.pct > lastPct && data.pct <= 100) {
                lastPct = data.pct; this.onProgress(job.id, lastPct);
            } else if (lastPct < 90) { lastPct += 5; this.onProgress(job.id, lastPct); }
        } catch (err) {
            if (err.message.includes('Lỗi') || err.message.includes('Bị chặn')) throw err;
            console.warn(`[Job ${job.id}] ⚠️ Máy khựng nhẹ...`); 
        }
      }

      if (!isDone) throw new Error("Timeout: Chờ quá lâu Ảnh không hiện ra.");

      await sleep(2000);
      const mediaData = await page.evaluate(async () => {
          try {
              const imgs = Array.from(document.querySelectorAll('img')).filter(img => img.clientWidth > 100);
              if (imgs.length === 0) return null;
              const targetUrl = imgs[imgs.length - 1].src;
              if (targetUrl.startsWith('data:image/')) {
                  const b64 = targetUrl.split(',')[1];
                  const ext = targetUrl.match(/data:image\/([a-zA-Z]+);/)?.[1] || 'png';
                  return { b64, ext };
              }
              const res = await fetch(targetUrl);
              const blob = await res.blob();
              return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve({ b64: reader.result.split(',')[1], ext: 'png' });
                  reader.readAsDataURL(blob);
              });
          } catch (err) { return null; }
      });

      if (mediaData && mediaData.b64) {
          const fileName = this._buildFileName(job, 'image', mediaData.ext);
          const localPath = path.join(this.downloadsDir, fileName);
          fs.writeFileSync(localPath, Buffer.from(mediaData.b64, 'base64'));
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'image' });
      } else { throw new Error("Không thể trích xuất dữ liệu ảnh."); }
  }

  // =========================================================================================
  // 🎥 [MODULE 3] IMAGE TO VIDEO
  // =========================================================================================
  async _handleImageToVideo(page, job) {
      console.log(`[Job ${job.id}] Khởi động Module: IMAGE TO VIDEO`);
      await page.getByText('Video', { exact: true }).first().click().catch(() => {});
      await sleep(2000);
      await this._applySettings(page, job, true);

      if (job.image_file && fs.existsSync(job.image_file)) {
          try {
              const fileInput = page.locator('input[type="file"]');
              if (await fileInput.count() > 0) {
                  await fileInput.first().setInputFiles(job.image_file);
              } else {
                  const [fileChooser] = await Promise.all([
                      page.waitForEvent('filechooser', { timeout: 10000 }),
                      page.locator('button').filter({ hasNotText: /^[a-zA-Z]/ }).first().click()
                  ]);
                  await fileChooser.setFiles(job.image_file);
              }
              await sleep(5000); 
          } catch (e) {
              throw new Error(`Lỗi tải ảnh lên: ${e.message}`);
          }
      } else {
          throw new Error("Cần ảnh cho chế độ Image to Video.");
      }

      const editor = page.locator('.ProseMirror, [contenteditable="true"], textarea').last();
      await editor.click();
      
      if (job.prompt) {
          await editor.fill(job.prompt);
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
      }

      await sleep(1000);
      await page.keyboard.press('Enter');
      
      await sleep(2000); 
      await page.keyboard.press('Escape').catch(()=>{}); 
      await sleep(500);
      await page.mouse.click(10, 10).catch(()=>{}); 
      await sleep(1000);

      this.onProgress(job.id, 10);
      let isDone = false, lastPct = 10;

      for (let i = 1; i <= 150; i++) {
        await sleep(15000); 
        try {
            const data = await Promise.race([
                page.evaluate(() => {
                    const text = document.body.textContent || '';
                    const cleanText = text.replace(/\s+/g, ' ');
                    let pct = 10;
                    const match = cleanText.match(/(?:Đang tạo|Generating|Tạo)[^\d]*(\d{1,3})\s*%/i) || cleanText.match(/(\d{1,3})\s*%/g);
                    if (match) pct = Array.isArray(match) ? parseInt(match[match.length - 1]) : parseInt(match[1]);

                    const isGenerating = cleanText.includes('Đang tạo') || cleanText.toLowerCase().includes('generating') || cleanText.includes('Hủy');
                    const hasABTest = cleanText.includes('Bạn thích giữ video nào hơn') || cleanText.includes('Bỏ qua');
                    const isModerated = cleanText.toLowerCase().includes('content moderated') || cleanText.toLowerCase().includes('try a different idea');

                    let hasMediaReady = false;
                    const vids = document.querySelectorAll('video');
                    if (vids.length > 0) {
                        const lastVid = vids[vids.length - 1];
                        if (lastVid.src || lastVid.currentSrc || lastVid.poster) hasMediaReady = true;
                    }
                    return { pct, isFinished: hasABTest || (hasMediaReady && (!isGenerating || pct === 100)), isModerated, isGenerating };
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tab nghẽn')), 5000))
            ]);

            if (data.isModerated) {
                throw new Error("Bị chặn: Vi phạm chính sách nội dung của Grok (Content Moderated).");
            }
            if (i >= 10 && !data.isGenerating && !data.isFinished) {
                throw new Error("Lỗi: Quá 10 lần quét không thấy phản hồi, tự động tắt Tab để chống treo máy.");
            }

            if (data.isFinished) { isDone = true; this.onProgress(job.id, 99); break; }
            if (data.pct > lastPct && data.pct <= 100) { lastPct = data.pct; this.onProgress(job.id, lastPct); } 
            else if (lastPct < 90) { lastPct += 2; this.onProgress(job.id, lastPct); }
        } catch (e) { 
            if (e.message.includes('Lỗi') || e.message.includes('Bị chặn')) throw e;
            await page.evaluate(() => window.focus()).catch(()=>{}); 
        }
      }

      if (!isDone) throw new Error("Timeout Video.");

      await sleep(2000);
      await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const skipBtn = btns.find(b => (b.innerText || '').toLowerCase().includes('bỏ qua'));
          if (skipBtn) skipBtn.click();
      }).catch(() => {});
      await sleep(2000);

      const mediaData = await page.evaluate(async () => {
          try {
              const vids = Array.from(document.querySelectorAll('video'));
              if (vids.length === 0) return null;
              const vid = vids[vids.length - 1];
              let targetUrl = vid.src || vid.currentSrc || (vid.querySelector('source')?.src);
              if (!targetUrl || (!targetUrl.startsWith('blob:') && !targetUrl.startsWith('http'))) return null;
              const res = await fetch(targetUrl);
              const blob = await res.blob();
              return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve({ b64: reader.result.split(',')[1], ext: 'mp4' });
                  reader.readAsDataURL(blob);
              });
          } catch (err) { return null; }
      });

      if (mediaData && mediaData.b64) {
          const fileName = this._buildFileName(job, 'video', mediaData.ext);
          const localPath = path.join(this.downloadsDir, fileName);
          fs.writeFileSync(localPath, Buffer.from(mediaData.b64, 'base64'));
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      } else {
          const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
          const clicked = await page.evaluate(() => {
              const dlBtns = Array.from(document.querySelectorAll('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]'));
              if (dlBtns.length > 0) { dlBtns[dlBtns.length - 1].click(); return true; }
              return false;
          });
          if (!clicked) await page.locator('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]').last().click({ force: true }).catch(()=>{});
          const download = await downloadPromise;
          const fileName = this._buildFileName(job, 'video', 'mp4');
          const localPath = path.join(this.downloadsDir, fileName);
          await download.saveAs(localPath);
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      }
  }

  // =========================================================================================
  // 📚 [MODULE 4] REFERENCE TO VIDEO
  // =========================================================================================
  async _handleReferenceToVideo(page, job) {
      console.log(`[Job ${job.id}] Khởi động Module: REFERENCE TO VIDEO`);
      
      await page.getByText('Video', { exact: true }).first().click().catch(() => {});
      await sleep(2000);
      await this._applySettings(page, job, true);

      let imagesToUpload = [];
      if (job.image_file) {
          try {
              imagesToUpload = JSON.parse(job.image_file);
          } catch (e) {
              imagesToUpload = [job.image_file]; 
          }
      }

      if (imagesToUpload.length > 0) {
          console.log(`[Job ${job.id}] Đang tải lên ${imagesToUpload.length} ảnh tham chiếu...`);
          try {
              const fileInput = page.locator('input[type="file"]');
              if (await fileInput.count() > 0) {
                  await fileInput.first().setInputFiles(imagesToUpload);
              } else {
                  const [fileChooser] = await Promise.all([
                      page.waitForEvent('filechooser', { timeout: 10000 }),
                      page.locator('button').filter({ hasNotText: /^[a-zA-Z]/ }).first().click()
                  ]);
                  await fileChooser.setFiles(imagesToUpload);
              }
              await sleep(3000 + (imagesToUpload.length * 2000)); 
          } catch (e) {
              throw new Error(`Lỗi tải ảnh tham chiếu lên: ${e.message}`);
          }
      } else {
          throw new Error("Chế độ Reference to Video yêu cầu phải có ít nhất 1 file ảnh.");
      }

      const editor = page.locator('.ProseMirror, [contenteditable="true"], textarea').last();
      await editor.click();

      if (imagesToUpload.length > 0) {
          for (let i = 1; i <= imagesToUpload.length; i++) {
              await page.keyboard.type(`@Image ${i}`, { delay: 50 });
              await sleep(800); 
              await page.keyboard.press('Enter'); 
              await sleep(300);
              await page.keyboard.type(' ', { delay: 10 }); 
          }
      }

      if (job.prompt) {
          await editor.fill(job.prompt);
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
      }

      await sleep(1000);
      await page.keyboard.press('Enter');
      
      await sleep(2000); 
      await page.keyboard.press('Escape').catch(()=>{}); 
      await sleep(500);
      await page.mouse.click(10, 10).catch(()=>{}); 
      await sleep(1000);

      this.onProgress(job.id, 10);
      console.log(`[Job ${job.id}] Đã tag xong ảnh & Prompt. Bắt đầu theo dõi Radar...`);

      let isDone = false;
      let lastPct = 10;

      for (let i = 1; i <= 150; i++) {
        await sleep(15000); 
        console.log(`\n[Job ${job.id}] ⏳ Radar Ref2Video quét lần ${i}...`);

        try {
            const data = await Promise.race([
                page.evaluate(() => {
                    const text = document.body.textContent || '';
                    const cleanText = text.replace(/\s+/g, ' ');
                    
                    let pct = 10;
                    const match = cleanText.match(/(?:Đang tạo|Generating|Tạo)[^\d]*(\d{1,3})\s*%/i) || cleanText.match(/(\d{1,3})\s*%/g);
                    if (match) {
                        pct = Array.isArray(match) ? parseInt(match[match.length - 1]) : parseInt(match[1]);
                    }

                    const isGenerating = cleanText.includes('Đang tạo') || cleanText.toLowerCase().includes('generating') || cleanText.includes('Hủy');
                    const hasABTest = cleanText.includes('Bạn thích giữ video nào hơn') || cleanText.includes('Bỏ qua');
                    const isModerated = cleanText.toLowerCase().includes('content moderated') || cleanText.toLowerCase().includes('try a different idea');
                    
                    let hasMediaReady = false;
                    const vids = document.querySelectorAll('video');
                    if (vids.length > 0) {
                        const lastVid = vids[vids.length - 1];
                        if (lastVid.src || lastVid.currentSrc || lastVid.poster) hasMediaReady = true;
                    }

                    return { pct, isFinished: hasABTest || (hasMediaReady && (!isGenerating || pct === 100)), isModerated, isGenerating };
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tab bị nghẽn')), 5000))
            ]);

            if (data.isModerated) {
                throw new Error("Bị chặn: Vi phạm chính sách nội dung của Grok (Content Moderated).");
            }
            if (i >= 10 && !data.isGenerating && !data.isFinished) {
                throw new Error("Lỗi: Quá 10 lần quét không thấy phản hồi, tự động tắt Tab để chống treo máy.");
            }

            if (data.isFinished) {
                console.log(`[Job ${job.id}] 🎉 ĐÃ XONG! Màn hình đã xuất hiện Video.`);
                isDone = true;
                this.onProgress(job.id, 99);
                break; 
            }

            if (data.pct > lastPct && data.pct <= 100) {
                lastPct = data.pct;
                this.onProgress(job.id, lastPct);
            } else {
                if (lastPct < 90) {
                    lastPct += 2;
                    this.onProgress(job.id, lastPct);
                }
            }
        } catch (checkError) {
            if (checkError.message.includes('Lỗi') || checkError.message.includes('Bị chặn')) throw checkError;
            console.warn(`[Job ${job.id}] ⚠️ Tab ngầm khựng nhẹ. Đang khắc phục...`);
            await page.evaluate(() => window.focus()).catch(()=>{});
        }
      }

      if (!isDone) throw new Error("Timeout: Chờ quá lâu mà Video không hiện ra.");

      await sleep(2000);

      await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const skipBtn = btns.find(b => (b.innerText || '').toLowerCase().includes('bỏ qua'));
          if (skipBtn) skipBtn.click();
      }).catch(() => {});
      
      await sleep(2000);

      console.log(`[Job ${job.id}] Đang rút link tải trực tiếp...`);
      const mediaData = await page.evaluate(async () => {
          try {
              let targetUrl = '';
              const vids = Array.from(document.querySelectorAll('video'));
              if (vids.length === 0) return null;
              const vid = vids[vids.length - 1];
              targetUrl = vid.src || vid.currentSrc || (vid.querySelector('source')?.src);

              if (!targetUrl || (!targetUrl.startsWith('blob:') && !targetUrl.startsWith('http'))) return null;

              const res = await fetch(targetUrl);
              const blob = await res.blob();
              return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve({ b64: reader.result.split(',')[1], ext: 'mp4' });
                  reader.readAsDataURL(blob);
              });
          } catch (err) { return null; }
      });

      if (mediaData && mediaData.b64) {
          const fileName = this._buildFileName(job, 'video', mediaData.ext);
          const localPath = path.join(this.downloadsDir, fileName);
          fs.writeFileSync(localPath, Buffer.from(mediaData.b64, 'base64'));

          console.log(`[Job ${job.id}] 📥 TẢI THÀNH CÔNG (Hút link): ${localPath}`);
          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      } else {
          console.log(`[Job ${job.id}] Rút link thất bại, chuyển sang Click nút Tải...`);
          const downloadPromise = page.waitForEvent('download', { timeout: 45000 });
          
          const clicked = await page.evaluate(() => {
              const dlBtns = Array.from(document.querySelectorAll('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]'));
              if (dlBtns.length > 0) {
                  dlBtns[dlBtns.length - 1].click();
                  return true;
              }
              return false;
          });

          if (!clicked) {
             await page.locator('[aria-label*="tải" i], [aria-label*="download" i], [title*="tải" i]').last().click({ force: true }).catch(()=>{});
          }

          const download = await downloadPromise;
          const fileName = this._buildFileName(job, 'video', 'mp4');
          const localPath = path.join(this.downloadsDir, fileName);
          
          await download.saveAs(localPath);
          console.log(`[Job ${job.id}] 📥 TẢI THÀNH CÔNG (Click): ${localPath}`);

          this.onProgress(job.id, 100);
          this.onComplete(job.id, { localPath, grokUrl: page.url(), fileType: 'video' });
      }
  }

  async _handleVideoExtend(page, job) {
      throw new Error("Chế độ Video Extend chưa được kích hoạt!");
  }

}

module.exports = { PlaywrightEngine };