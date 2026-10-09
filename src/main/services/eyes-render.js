/**
 * Eyes Challenge Renderer — viral Facebook Reels format
 * Cơ chế THẬT: outlines CỐ ĐỊNH ở vị trí đúng,
 * con vật QUAY VÒNG (orbit) theo quỹ đạo ellipse.
 * Khán giả bấm dừng khi con vật khớp outline.
 */
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');

const ffmpegPath  = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const W = 1080, H = 1920;
const WORK_DIR = path.join(require('os').tmpdir(), 'eyes_orbit_tmp');

// ── FFmpeg helpers ─────────────────────────────────────────────────────────────

const runFF = (args) => new Promise((resolve, reject) => {
  const proc = spawn(ffmpegPath, ['-y', ...args], { windowsHide: true });
  let err = '';
  proc.stderr.on('data', d => { err += d.toString(); });
  proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(-800))));
});

const runFFprobe = (args) => new Promise((resolve, reject) => {
  const proc = spawn(ffprobePath, args, { windowsHide: true });
  let out = '', err = '';
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', d => { err += d.toString(); });
  proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.slice(-200))));
});

const getW = async (fp) => {
  const s = await runFFprobe([
    '-v', 'quiet', '-select_streams', 'v:0',
    '-show_entries', 'stream=width', '-of', 'csv=p=0', fp,
  ]);
  return parseInt(s, 10);
};

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// ── Image processing ───────────────────────────────────────────────────────────

// Scale + pad to EXACT sz×sz transparent square
async function fitImage(inp, out, sz) {
  await runFF([
    '-i', inp,
    '-vf', [
      `scale='min(${sz}\\,iw)':'min(${sz}\\,ih)':force_original_aspect_ratio=decrease`,
      'format=rgba',
      `pad=${sz}:${sz}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
    ].join(','),
    '-frames:v', '1', out,
  ]);
}

// Colored stroke ring (sr px) around alpha PNG → (sz+sr*2)² RGBA
async function addStrokeToPng(inp, out, hex = 'ef4444', sr = 10) {
  const w = await getW(inp);
  const p = w + sr * 2;
  const f = [
    `[0:v]format=rgba,pad=${p}:${p}:${sr}:${sr}:color=0x00000000,split=3[a][b][bg]`,
    `[a]alphaextract,format=gray,boxblur=${sr}:1,geq=r='255*gt(r(X\\,Y)\\,10)'[thick]`,
    `[b]alphaextract,format=gray,geq=r='255*gt(r(X\\,Y)\\,10)'[orig]`,
    `[thick][orig]blend=all_mode=difference,format=gray[ring]`,
    `color=c=#${hex}:size=${p}x${p},format=rgba[col]`,
    `[col][ring]alphamerge[stroke]`,
    `[stroke][bg]overlay=format=auto`,
  ].join(';');
  await runFF(['-i', inp, '-filter_complex', f, '-frames:v', '1', out]);
}

// Hollow outline only — transparent interior
async function addShellPng(inp, out, hex = 'ef4444', sr = 10) {
  const w = await getW(inp);
  const p = w + sr * 2;
  const f = [
    `[0:v]format=rgba,pad=${p}:${p}:${sr}:${sr}:color=0x00000000,split=2[a][b]`,
    `[a]alphaextract,format=gray,boxblur=${sr}:1,geq=r='255*gt(r(X\\,Y)\\,10)'[thick]`,
    `[b]alphaextract,format=gray,geq=r='255*gt(r(X\\,Y)\\,10)'[orig]`,
    `[thick][orig]blend=all_mode=difference,format=gray[ring]`,
    `color=c=#${hex}:size=${p}x${p},format=rgba[col]`,
    `[col][ring]alphamerge`,
  ].join(';');
  await runFF(['-i', inp, '-filter_complex', f, '-frames:v', '1', out]);
}

async function createBackground(out) {
  await runFF([
    '-f', 'lavfi', '-i', `color=c=white:size=${W}x${H}:rate=1:duration=0.1`,
    '-vf', `geq=r='200+X/${W}*12':g='218+X/${W}*8':b='240'`,
    '-frames:v', '1', out,
  ]);
}

// ── Layout: home positions (center px) ────────────────────────────────────────

function getHomePositions(n) {
  const x1 = 40, x2 = W - 40;
  const cols = n <= 2 ? 1 : 2;
  const rows = Math.ceil(n / cols);

  // Chiều cao grid cố định theo số hàng, căn giữa tại H/2=960
  const gridH = n === 2 ? 1300 : (rows === 1 ? 900 : 1200);
  const y1 = Math.round((H - gridH) / 2);
  const y2 = y1 + gridH;

  const cw = (x2 - x1) / cols;
  const ch = gridH / rows;

  return Array.from({ length: n }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // n=3 last lone item: center horizontally
    const cx = (n === 3 && row === rows - 1 && n % cols !== 0)
      ? (x1 + x2) / 2
      : x1 + (col + 0.5) * cw;
    const cy = y1 + (row + 0.5) * ch;
    return { cx: Math.round(cx), cy: Math.round(cy) };
  });
}

// ── Main render ───────────────────────────────────────────────────────────────

async function renderEyesVideo({
  plan = {}, assetPaths,
  voicePath,                // legacy single-file TTS
  voiceIntroPath,           // intro: question part
  voiceOutroPath,           // outro: countdown + reveal (delayed to near orbit end)
  bgmPath, outputPath, onLog = console.log,
}) {
  ensureDir(WORK_DIR);
  const job = path.join(WORK_DIR, `j${Date.now()}`);
  ensureDir(job);

  const { outlineColor = 'red' } = plan;
  const strokeHex = outlineColor === 'blue' ? '3b82f6' : 'ef4444';

  const valid = (assetPaths || []).filter(Boolean);
  const n = valid.length;
  if (n < 2 || n > 4) throw new Error('Cần 2–4 ảnh');

  // Item size & padding — phóng to vừa khớp màn hình
  const ITEM_SZ = n === 2 ? 560 : n === 3 ? 440 : 400;
  const SR      = 10;
  const PNG_SZ  = ITEM_SZ + SR * 2;   // exact square after stroke
  const HALF    = PNG_SZ / 2;

  // ── Timing ──────────────────────────────────────────────────────────────────
  //   0 – ORBIT_START : static ở vị trí đúng (khán giả thấy đáp án trước)
  //   ORBIT_START – ORBIT_END : orbit N vòng × 2s/vòng
  //   ORBIT_END – TOTAL : static reveal (2s)
  const ORBIT_START  = 1.0;
  const ORBIT_PERIOD = 2.0;   // giây/vòng
  const OUTRO_STATIC = 2.0;   // giây reveal cuối
  // Random tổng video 20–25s, số vòng tự tính từ thời gian orbit
  const TARGET_TOTAL  = 20 + Math.floor(Math.random() * 6);  // 20,21,22,23,24,25
  const ORBIT_DUR_RAW = TARGET_TOTAL - ORBIT_START - OUTRO_STATIC;
  // Round về bội số của ORBIT_PERIOD để items về đúng vị trí home
  const ORBIT_REVS = Math.round(ORBIT_DUR_RAW / ORBIT_PERIOD);
  const ORBIT_END  = ORBIT_START + ORBIT_REVS * ORBIT_PERIOD;
  const TOTAL      = ORBIT_END + OUTRO_STATIC;
  // Clockwise: dùng -ω → items từ RIGHT vào top (giống video mẫu)
  const OMEGA = -(2 * Math.PI / ORBIT_PERIOD);  // ≈ -π rad/s (CW)

  onLog(`[Eyes] ${n} ảnh | sz=${ITEM_SZ}px | orbit CW × ${ORBIT_REVS} vòng | tổng ${TOTAL.toFixed(1)}s`);

  // ── Home positions ──────────────────────────────────────────────────────────
  const homes = getHomePositions(n);

  // Orbit center = centroid of home positions
  const Cx = homes.reduce((s, p) => s + p.cx, 0) / n;
  const Cy = homes.reduce((s, p) => s + p.cy, 0) / n;

  // Max spread from center (for ellipse radii)
  const maxH = Math.max(...homes.map(p => Math.abs(p.cx - Cx)));
  const maxV = Math.max(...homes.map(p => Math.abs(p.cy - Cy)));

  // n=2 → wide flat ellipse so items exit screen at sides (dramatic effect)
  // n≥3 → diagonal ellipse through grid corners (stays mostly on screen)
  const Rx = n === 2 ? W * 0.83 : (maxH || 1) * Math.SQRT2;
  const Ry = (maxV || 1) * (n === 2 ? 1.0 : Math.SQRT2);

  // Initial phase per item: angle where item starts on orbit = home position
  // Using y = Cy - Ry*sin(φ) → sin(φ) = (Cy - cy)/Ry
  // Using x = Cx + Rx*cos(φ) → cos(φ) = (cx - Cx)/Rx
  const phis = homes.map(p =>
    Math.atan2((Cy - p.cy) / Ry, (p.cx - Cx) / Rx)
  );

  onLog(`[Eyes] center=(${Cx.toFixed(0)},${Cy.toFixed(0)}) Rx=${Rx.toFixed(0)} Ry=${Ry.toFixed(0)}`);
  phis.forEach((φ, i) => onLog(`  item${i}: cx=${homes[i].cx} cy=${homes[i].cy} φ=${(φ * 180 / Math.PI).toFixed(1)}°`));

  // ── Process images ──────────────────────────────────────────────────────────
  const animalPngs = [], shellPngs = [];
  for (let i = 0; i < n; i++) {
    const sc = path.join(job, `${i}s.png`);
    const im = path.join(job, `${i}i.png`);
    const sh = path.join(job, `${i}h.png`);
    try {
      await fitImage(valid[i], sc, ITEM_SZ);
      await addStrokeToPng(sc, im, strokeHex, SR);
      await addShellPng(sc, sh, strokeHex, SR);
      animalPngs.push(im);
      shellPngs.push(sh);
      onLog(`[Eyes] Ảnh ${i + 1}/${n} ✓`);
    } catch (e) {
      onLog(`[Eyes] Ảnh ${i + 1} lỗi: ${e.message.slice(0, 100)}`);
      const fb = fs.existsSync(sc) ? sc : valid[i];
      animalPngs.push(fb);
      shellPngs.push(fb);
    }
  }

  const bgPath = path.join(job, 'bg.png');
  await createBackground(bgPath);
  onLog('[Eyes] Nền ✓');

  // ── Build FFmpeg filter_complex ─────────────────────────────────────────────
  const dur = String(TOTAL + 1);
  const ins = [
    '-loop', '1', '-t', dur, '-i', bgPath,
    ...shellPngs.flatMap(p  => ['-loop', '1', '-t', dur, '-i', p]),
    ...animalPngs.flatMap(p => ['-loop', '1', '-t', dur, '-i', p]),
  ];

  const fp = [];
  let last = '0:v';

  // Layer 1: shells at FIXED home positions (always visible)
  for (let i = 0; i < n; i++) {
    const sx  = Math.round(homes[i].cx - HALF);
    const sy  = Math.round(homes[i].cy - HALF);
    const tag = `sh${i}`;
    fp.push(`[${last}][${i + 1}:v]overlay=x=${sx}:y=${sy}[${tag}]`);
    last = tag;
  }

  // Layer 2: orbiting animal images (on top)
  // x(t) = Cx + Rx * cos(ω*(t-Ts) + φ) - HALF
  // y(t) = Cy - Ry * sin(ω*(t-Ts) + φ) - HALF
  // ω < 0 → clockwise
  // N≥3: also apply rotate=ω*(t-Ts) so items spin like a Ferris wheel
  for (let i = 0; i < n; i++) {
    const idx = n + 1 + i;
    const φ   = phis[i].toFixed(8);
    const hx  = (homes[i].cx - HALF).toFixed(1);
    const hy  = (homes[i].cy - HALF).toFixed(1);
    const PSZ = HALF.toFixed(1);
    const OM  = OMEGA.toFixed(8);         // negative (CW)
    const TS  = ORBIT_START.toFixed(1);
    const TE  = ORBIT_END.toFixed(1);
    const CX  = Cx.toFixed(2);
    const CY  = Cy.toFixed(2);
    const RX  = Rx.toFixed(2);
    const RY  = Ry.toFixed(2);

    const angle = `(${OM}*(t-${TS})+${φ})`;
    const xOrb  = `${CX}+${RX}*cos(${angle})-${PSZ}`;
    const yOrb  = `${CY}-${RY}*sin(${angle})-${PSZ}`;

    // Static before/after orbit, orbiting during [ORBIT_START, ORBIT_END]
    const xExpr = `if(lt(t\\,${TS})\\,${hx}\\,if(lt(t\\,${TE})\\,${xOrb}\\,${hx}))`;
    const yExpr = `if(lt(t\\,${TS})\\,${hy}\\,if(lt(t\\,${TE})\\,${yOrb}\\,${hy}))`;

    const tag = `an${i}`;

    // Rotate ALL items as they orbit (Ferris wheel spin) — tăng độ khó cho mọi số lượng vật
    const rotExpr = `if(lt(t\\,${TS})\\,0\\,if(lt(t\\,${TE})\\,${OM}*(t-${TS})\\,0))`;
    const rotTag  = `ar${i}`;
    fp.push(`[${idx}:v]rotate=angle='${rotExpr}':out_w=iw:out_h=ih:c=0x00000000[${rotTag}]`);
    fp.push(`[${last}][${rotTag}]overlay=x='${xExpr}':y='${yExpr}'[${tag}]`);
    last = tag;
  }

  // ── Render video (no audio) ──────────────────────────────────────────────────
  const flt = fp.join(';');
  const scriptPath = path.join(job, 'f.txt');
  fs.writeFileSync(scriptPath, flt, 'utf8');

  const noAudioOut = path.join(job, 'video_noaudio.mp4');
  const videoArgs = [
    '-y', ...ins,
    '-filter_complex_script', scriptPath,
    '-map', `[${last}]`,
    '-t', String(TOTAL), '-r', '30',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-an',
    '-movflags', '+faststart',
    noAudioOut,
  ];

  onLog('[Eyes] Render video...');
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, videoArgs, { windowsHide: true });
    let errBuf = '';
    proc.stderr.on('data', d => {
      const s = d.toString();
      errBuf += s;
      const line = s.split(/[\r\n]/).find(l => l.includes('frame=') || l.includes('time='));
      if (line) onLog('[FFmpeg] ' + line.trim());
    });
    proc.on('close', code => {
      try { fs.unlinkSync(scriptPath); } catch (_) {}
      code === 0 ? resolve() : reject(new Error('FFmpeg lỗi:\n' + errBuf.slice(-1500)));
    });
  });
  onLog('[Eyes] Video xong, đang mux audio...');

  // ── Build combined audio ─────────────────────────────────────────────────────
  const introSrc  = voiceIntroPath || voicePath || null;
  const outroSrc  = voiceOutroPath || null;
  const hasIntro  = !!(introSrc  && fs.existsSync(introSrc)  && fs.statSync(introSrc).size  > 512);
  const hasOutro  = !!(outroSrc  && fs.existsSync(outroSrc)  && fs.statSync(outroSrc).size  > 512);
  const hasB      = !!(bgmPath   && fs.existsSync(bgmPath));

  onLog(`[Audio] intro=${hasIntro} outro=${hasOutro} bgm=${hasB}`);

  let audioTrackPath = null;

  if (hasIntro || hasB) {
    audioTrackPath = path.join(job, 'audio_final.mp3');

    if (hasIntro && hasOutro) {
      // Step A: combine intro + 4s silence + outro
      const SILENCE_DUR = 4;
      const combinedVoice = path.join(job, 'voice_combined.mp3');
      await runFF([
        '-i', introSrc,
        '-f', 'lavfi', '-t', String(SILENCE_DUR), '-i', 'anullsrc=r=44100:cl=stereo',
        '-i', outroSrc,
        '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
        '-map', '[out]', '-ar', '44100', '-ac', '2', '-b:a', '128k',
        combinedVoice,
      ]);
      onLog(`[Audio] intro+silence+outro → ${fs.statSync(combinedVoice).size} bytes`);

      if (hasB) {
        // Mix combined voice (delayed 0.5s) + bgm
        await runFF([
          '-i', combinedVoice,
          '-i', bgmPath,
          '-filter_complex',
          `[0:a]adelay=500|500,volume=1.4[v];[1:a]volume=0.09,aloop=loop=-1:size=0[b];[v][b]amix=inputs=2:duration=first[out]`,
          '-map', '[out]', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          audioTrackPath,
        ]);
      } else {
        // Voice only (delayed 0.5s)
        await runFF([
          '-i', combinedVoice,
          '-filter_complex', `[0:a]adelay=500|500,volume=1.4[out]`,
          '-map', '[out]', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          audioTrackPath,
        ]);
      }
    } else if (hasIntro && hasB) {
      await runFF([
        '-i', introSrc,
        '-i', bgmPath,
        '-filter_complex',
        `[0:a]adelay=500|500,volume=1.4[v];[1:a]volume=0.09,aloop=loop=-1:size=0[b];[v][b]amix=inputs=2:duration=first[out]`,
        '-map', '[out]', '-ar', '44100', '-ac', '2', '-b:a', '128k',
        audioTrackPath,
      ]);
    } else if (hasIntro) {
      await runFF([
        '-i', introSrc,
        '-filter_complex', `[0:a]adelay=500|500,volume=1.4[out]`,
        '-map', '[out]', '-ar', '44100', '-ac', '2', '-b:a', '128k',
        audioTrackPath,
      ]);
    } else {
      // bgm only
      await runFF([
        '-i', bgmPath,
        '-filter_complex', `[0:a]volume=0.09,aloop=loop=-1:size=0[out]`,
        '-map', '[out]', '-t', String(TOTAL), '-ar', '44100', '-ac', '2', '-b:a', '128k',
        audioTrackPath,
      ]);
    }

    onLog(`[Audio] track → ${fs.statSync(audioTrackPath).size} bytes`);
  }

  // ── Mux audio into video ─────────────────────────────────────────────────────
  if (audioTrackPath && fs.existsSync(audioTrackPath)) {
    await runFF([
      '-i', noAudioOut,
      '-i', audioTrackPath,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ]);
    onLog('[Eyes] Mux xong!');
  } else {
    // No audio — just rename
    fs.copyFileSync(noAudioOut, outputPath);
    onLog('[Eyes] Không có audio — chỉ video.');
  }

  onLog(`[Eyes] ✅ → ${outputPath}`);
  try { fs.rmSync(job, { recursive: true, force: true }); } catch (_) {}
  return { success: true, outputPath };
}

module.exports = { renderEyesVideo };
