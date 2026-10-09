/**
 * Render nhanh (hybrid) cho video AI Agent — thay vì để Chrome vẽ lại MỌI khung hình:
 *  - Cảnh stock / ảnh AI: dùng thẳng file gốc qua FFmpeg (cắt, co giãn, zoom nhẹ)
 *  - Cảnh graphic/text: Remotion render gộp 1 lần; phụ đề: Remotion vẽ thành PNG trong suốt (giữ nguyên kiểu)
 *  - Ghép: FFmpeg xfade theo nhóm, rồi 1 lần mã hóa cuối kèm giọng đọc + nhạc nền + SFX
 * Timeline khớp edit-plan: cảnh i bắt đầu ở startFrame, giọng đọc bắt đầu cùng lúc.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { REMOTION_DIR, remotionEnv } = require('./remotion-render');

const PLAN_PATH  = path.join(REMOTION_DIR, 'src', 'remixer', 'edit-plan.json');
const PUBLIC_DIR = path.join(REMOTION_DIR, 'public');
const ENTRY      = 'src/remixer/RemixerIndex.jsx';
const FPS = 30;
const TRANS_FRAMES = 14;   // = TRANS_IN của RemixerVideo
const GROUP_SIZE   = 12;   // số cảnh mỗi lần xfade (giới hạn số file mở cùng lúc)
const INTER_ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p'];

const XFADE = {
  fade: 'fade', slide_left: 'slideleft', slide_right: 'slideright', slide_up: 'slideup', slide_down: 'slidedown',
  zoom_in: 'zoomin', zoom_out: 'fade', whip: 'smoothleft', glitch: 'pixelize', blur: 'hblur',
};

function run(cmd, args, { cwd, env, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env, shell, windowsHide: true });
    let err = '';
    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', d => { err = (err + d.toString()).slice(-4000); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exit ${code}: ${err.replace(/\x1B\[[\d;]*m/g, '').trim().slice(-600)}`)));
  });
}
const ff = (args, opts) => run(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', ...args], opts);
const qp = (p) => (p.includes(' ') ? `"${p}"` : p);
const resolveAsset = (f) => (path.isAbsolute(f) ? f : path.join(PUBLIC_DIR, f));

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; await fn(items[k], k); }
  }));
}

function kindOf(seg) {
  const v = seg.visual || {};
  if (v.file && ['broll', 'ai_video', 'original'].includes(v.type)) return 'video';
  if (v.file && ['ai_image', 'image'].includes(v.type)) return 'image';
  return 'remotion';
}

// Zoom chậm như Remotion (scale 1→z hoặc z→1). Dùng perspective (nội suy dưới 1 pixel, tính lại mỗi khung):
// cách cũ scale theo pixel chẵn + crop giữa làm ảnh đứng yên rồi nhảy nấc (đo: 77/139 khung đứng yên) → giật, nhức mắt
function zoomFilter(motion, zoom, frames) {
  const z = Math.max(0, (zoom || 1.07) - 1);
  if (motion === 'static' || z === 0) return null;
  const s = motion === 'zoom_out' ? `(1+${z}*(1-in/${frames}))` : `(1+${z}*in/${frames})`;
  const m = `((1-1/${s})/2)`;   // phần lề bị cắt mỗi bên (tỷ lệ)
  return `perspective=x0='W*${m}':y0='H*${m}':x1='W-W*${m}':y1='H*${m}':x2='W*${m}':y2='H-H*${m}':x3='W-W*${m}':y3='H-H*${m}':interpolation=cubic:eval=frame`;
}

// Phụ đề PNG trong suốt: hiện 0.33s, trượt lên 18px, ẩn 0.27s trước khi cảnh kết thúc
function captionOverlay(vLabel, capIdx, dur) {
  const out = Math.max(0.4, dur - 0.27);
  return [
    `[${capIdx}:v]format=rgba,fade=in:st=0:d=0.33:alpha=1,fade=out:st=${out.toFixed(3)}:d=0.27:alpha=1[cap]`,
    `[${vLabel}][cap]overlay=x=0:y='18*max(0,1-t/0.4)':eof_action=pass:format=auto[vo]`,
  ];
}

// Viền đen có sẵn trong clip (DVIDS hay quay khung điện ảnh) → dò bằng cropdetect vài giây giữa đoạn dùng.
// Chỉ cắt khi viền rõ (>3%) và phần giữ lại ≥ 60% mỗi chiều — cảnh đêm tối không bị cắt nhầm.
function detectLetterbox(file, atSec) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-ss', String(Math.max(0, atSec)), '-i', file, '-t', '3',
      '-vf', 'fps=2,cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const all = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
      const size = err.match(/, (\d{3,5})x(\d{3,5})[, ]/);
      if (!all.length || !size) return resolve(null);
      const [, w, h, x, y] = all[all.length - 1].map(Number);
      const iw = +size[1], ih = +size[2];
      const trims = w < iw * 0.97 || h < ih * 0.97;
      resolve(trims && w >= iw * 0.6 && h >= ih * 0.6 ? `crop=${w}:${h}:${x}:${y}` : null);
    });
  });
}

async function buildVideoClip(sc, W, H, captionPng) {
  const v = sc.seg.visual;
  const L = sc.Lf / FPS;
  const start = v.startSec || 0;
  const letterbox = await detectLetterbox(resolveAsset(v.file), start + 1);
  const avail = v.duration ? Math.max(0.5, v.duration - start) : null;
  const rate = avail && avail < L ? Math.max(0.25, avail / L) : 1;   // clip ngắn hơn cảnh → phát chậm lại
  const B = v.brightness ?? 0.85;
  const chain = [
    rate < 1 ? `setpts=PTS/${rate.toFixed(4)}` : null,
    `fps=${FPS}`,
    letterbox,
    `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`,
    zoomFilter(v.motion || 'slow_zoom', v.zoom ?? 1.08, sc.Lf),
    `colorchannelmixer=rr=${B}:gg=${B}:bb=${B}`,
    `tpad=stop_mode=clone:stop_duration=${L.toFixed(3)}`,
    'setsar=1', 'format=yuv420p',
  ].filter(Boolean).join(',');
  const inputs = [...(start > 0 ? ['-ss', start.toFixed(3)] : []), '-i', resolveAsset(v.file)];
  let fc = `[0:v]${chain}[v]`;
  let map = '[v]';
  if (captionPng) {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', L.toFixed(3), '-i', captionPng);
    fc += ';' + captionOverlay('v', 1, sc.durF / FPS).join(';');
    map = '[vo]';
  }
  await ff([...inputs, '-filter_complex', fc, '-map', map, '-frames:v', String(sc.Lf), '-an', ...INTER_ENC, sc.clip]);
}

async function buildImageClip(sc, W, H, captionPng) {
  const v = sc.seg.visual;
  const L = sc.Lf / FPS;
  const B = v.brightness ?? 1;
  const chain = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`,
    zoomFilter(v.motion || 'ken_burns', v.zoom ?? 1.07, sc.Lf),
    B !== 1 ? `colorchannelmixer=rr=${B}:gg=${B}:bb=${B}` : null,
    'setsar=1', 'format=yuv420p',
  ].filter(Boolean).join(',');
  const inputs = ['-loop', '1', '-framerate', String(FPS), '-t', L.toFixed(3), '-i', resolveAsset(v.file)];
  let fc = `[0:v]${chain}[v]`;
  let map = '[v]';
  if (captionPng) {
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', L.toFixed(3), '-i', captionPng);
    fc += ';' + captionOverlay('v', 1, sc.durF / FPS).join(';');
    map = '[vo]';
  }
  await ff([...inputs, '-filter_complex', fc, '-map', map, '-frames:v', String(sc.Lf), '-an', ...INTER_ENC, sc.clip]);
}

// Remotion render (tái dùng lệnh render chính: GPU, cache giới hạn, TEMP ở ổ D)
// publicDir rỗng: cảnh graphic/text + phụ đề không dùng file nào trong public; để mặc định thì Remotion
// chép cả thư mục public (toàn bộ clip stock, có khi >1GB) mỗi lần render → mất 1–2 phút vô ích
async function remotionRender(composition, out, extra, concurrency, publicDir) {
  const args = ['remotion', 'render', ENTRY, composition, qp(out), '--gl=angle',
    ...(publicDir ? [`--public-dir=${qp(publicDir)}`] : []),
    '--offthreadvideo-cache-size-in-bytes=536870912', `--concurrency=${concurrency}`, ...extra];
  await run('npx', args, { cwd: REMOTION_DIR, env: remotionEnv(), shell: true });
}

async function buildAudio(plan, totalSec, out) {
  const inputs = [];
  const parts = [];
  let k = 0;
  for (const seg of plan.segments) {
    const f = seg.narration?.file;
    if (!f || !fs.existsSync(resolveAsset(f))) continue;
    const ms = Math.round((seg.startFrame / FPS) * 1000);
    inputs.push('-i', resolveAsset(f));
    parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${k}]`);
    k++;
  }
  const bg = plan.bgMusic?.musicFile;
  if (bg && fs.existsSync(resolveAsset(bg))) {
    inputs.push('-stream_loop', '-1', '-i', resolveAsset(bg));
    parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${plan.bgMusic.volume ?? 0.1},atrim=0:${totalSec.toFixed(3)}[a${k}]`);
    k++;
  }
  for (const s of plan.sfxList || []) {
    const f = path.join(PUBLIC_DIR, 'sfx', `${s.id}.wav`);
    const at = s.at_sec ?? s.at ?? 0;
    if (!s.id || !fs.existsSync(f) || at >= totalSec) continue;
    const ms = Math.round(at * 1000);
    inputs.push('-i', f);
    parts.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${s.volume ?? 0.65},atrim=0:${s.duration_sec || 4},adelay=${ms}|${ms}[a${k}]`);
    k++;
  }
  if (!k) {
    await ff(['-f', 'lavfi', '-t', totalSec.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo', '-c:a', 'aac', '-b:a', '192k', out]);
    return;
  }
  const mix = `${Array.from({ length: k }, (_, i) => `[a${i}]`).join('')}amix=inputs=${k}:normalize=0:duration=longest,apad,atrim=0:${totalSec.toFixed(3)}[aout]`;
  const script = out + '.filter.txt';
  fs.writeFileSync(script, [...parts, mix].join(';\n'));
  await ff([...inputs, '-filter_complex_script', script, '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', out]);
}

// xfade tuần tự: clips [{file, startF (tương đối), Lf, transition}] → 1 file
async function xfadeConcat(clips, out, { finalArgs = [], extraInputs = [], extraMap = [], scriptPath = out + '.filter.txt' } = {}) {
  const inputs = clips.flatMap(c => ['-i', c.file]);
  const lines = clips.map((_, k) => `[${k}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${k}]`);
  let prev = 'v0';
  for (let k = 1; k < clips.length; k++) {
    const t = clips[k].transition;
    const d = t === 'cut' || !XFADE[t] ? 1 / FPS : TRANS_FRAMES / FPS;
    lines.push(`[${prev}][v${k}]xfade=transition=${XFADE[t] || 'fade'}:duration=${d.toFixed(4)}:offset=${(clips[k].startF / FPS).toFixed(4)}[x${k}]`);
    prev = `x${k}`;
  }
  const totalF = clips[clips.length - 1].startF + clips[clips.length - 1].Lf;
  lines.push(`[${prev}]null[vout]`);
  const script = scriptPath;
  fs.writeFileSync(script, lines.join(';\n'));
  await ff([...inputs, ...extraInputs, '-filter_complex_script', script, '-map', '[vout]', ...extraMap,
    '-frames:v', String(totalF), ...(finalArgs.length ? finalArgs : [...INTER_ENC, '-an']), out]);
}

// planOverride: render 1 plan khác (vd thử nghiệm) — ghi tạm vào edit-plan.json cho Remotion, xong trả lại file gốc
async function hybridRender({ outputPath, log = () => {}, concurrency = 2, planOverride = null }) {
  const t0 = Date.now();
  const originalText = fs.readFileSync(PLAN_PATH, 'utf8');
  const plan = planOverride || JSON.parse(originalText);
  const planText = planOverride ? JSON.stringify(planOverride, null, 2) : originalText;
  if (planOverride) fs.writeFileSync(PLAN_PATH, planText, 'utf8');
  const W = plan.project?.width || 1920, H = plan.project?.height || 1080;
  const segs = plan.segments || [];
  if (!segs.length) throw new Error('edit-plan trống');

  // Không dùng thư mục có dấu chấm (.render-tmp): Remotion coi đó là "đuôi file" và từ chối xuất dãy ảnh
  const work = path.join(REMOTION_DIR, 'render_hybrid_tmp', `job_${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  const emptyPublic = path.join(work, 'public_empty');
  fs.mkdirSync(emptyPublic, { recursive: true });
  try {
    // Mỗi cảnh (trừ cảnh cuối) dài thêm TRANS_FRAMES để xfade chồng lên mà không làm lệch timeline
    const scenes = segs.map((seg, i) => {
      const durF = Math.max(1, seg.durationFrames || 30);
      return {
        seg, i, kind: kindOf(seg), durF,
        Lf: durF + (i < segs.length - 1 ? TRANS_FRAMES : 0),
        startF: seg.startFrame ?? 0,
        transition: seg.transition || 'fade',
        clip: path.join(work, `scene_${String(i).padStart(3, '0')}.mp4`),
      };
    });
    const totalF = scenes[scenes.length - 1].startF + scenes[scenes.length - 1].durF;
    const totalSec = totalF / FPS;
    const remotionScenes = scenes.filter(s => s.kind === 'remotion');
    log(`⚙️ Render nhanh: ${scenes.length} cảnh — ${scenes.length - remotionScenes.length} cảnh dùng thẳng file gốc, ${remotionScenes.length} cảnh graphic/text qua Remotion`);

    // 1) Phụ đề → PNG trong suốt (render với plan gốc, 1 khung = 1 câu)
    const CAPTION_TYPES = new Set(['broll', 'ai_video', 'original', 'ai_image', 'image', 'illustration']);
    const captioned = segs.filter(s => s.caption && CAPTION_TYPES.has(s.visual?.type));
    const capPng = {};
    if (captioned.length) {
      log(`⚙️ Render nhanh: vẽ ${captioned.length} phụ đề...`);
      const capDir = path.join(work, 'captions');
      await remotionRender('CaptionSheet', capDir, ['--sequence', '--image-format=png', `--frames=0-${captioned.length - 1}`], concurrency, emptyPublic);
      const files = fs.readdirSync(capDir).filter(f => f.endsWith('.png'))
        .sort((a, b) => parseInt(a.match(/(\d+)\.png$/)[1], 10) - parseInt(b.match(/(\d+)\.png$/)[1], 10));
      captioned.forEach((s, k) => { if (files[k]) capPng[s.id] = path.join(capDir, files[k]); });
    }

    // 2–4 chạy song song (độc lập nhau): Remotion vẽ graphic/text | FFmpeg dựng cảnh stock/ảnh | trộn âm thanh
    // 2) Cảnh graphic/text: Remotion render gộp 1 lần (plan tạm: chỉ các cảnh này, nối tiếp, không tiếng)
    const graphicsTask = (async () => {
      if (!remotionScenes.length) return;
      log(`⚙️ Render nhanh: Remotion vẽ ${remotionScenes.length} cảnh graphic/text (song song với dựng cảnh)...`);
      let cur = 0;
      const tmpSegs = remotionScenes.map(sc => {
        const seg = { ...sc.seg, startFrame: cur, durationFrames: sc.Lf, transition: 'cut', caption: null };
        delete seg.narration;
        sc.offF = cur;
        cur += sc.Lf;
        return seg;
      });
      const tmpPlan = { ...plan, project: { ...plan.project, noOverlap: true, totalFrames: cur }, bgMusic: null, sfxList: [], segments: tmpSegs };
      const gfx = path.join(work, 'graphics.mp4');
      fs.writeFileSync(PLAN_PATH, JSON.stringify(tmpPlan, null, 2), 'utf8');
      try {
        await remotionRender('RemixerVideo', gfx, ['--muted', '--crf=16', '--x264-preset=ultrafast'], concurrency, emptyPublic);
      } finally {
        fs.writeFileSync(PLAN_PATH, planText, 'utf8');
      }
      await pool(remotionScenes, 4, sc => ff(['-ss', (sc.offF / FPS).toFixed(4), '-i', gfx, '-frames:v', String(sc.Lf),
        '-vf', `fps=${FPS},setsar=1,format=yuv420p`, '-an', ...INTER_ENC, sc.clip]));
      log('⚙️ Render nhanh: xong cảnh graphic/text');
    })();

    // 3) Cảnh stock / ảnh AI: FFmpeg trực tiếp từ file gốc
    const direct = scenes.filter(s => s.kind !== 'remotion');
    let done = 0;
    const clipsTask = pool(direct, 3, async sc => {
      const cap = capPng[sc.seg.id];
      try {
        if (sc.kind === 'video') await buildVideoClip(sc, W, H, cap);
        else await buildImageClip(sc, W, H, cap);
      } catch (e) {
        throw new Error(`cảnh #${sc.seg.id} (${sc.kind}): ${e.message}`);
      }
      done++;
      if (done % 10 === 0 || done === direct.length) log(`⚙️ Render nhanh: dựng cảnh ${done}/${direct.length}`);
    });

    // 4) Âm thanh: giọng đọc đúng mốc cảnh + nhạc nền + SFX
    const audio = path.join(work, 'audio.m4a');
    const audioTask = buildAudio(plan, totalSec, audio);

    await Promise.all([graphicsTask, clipsTask, audioTask]);

    // 5) Ghép: xfade theo nhóm → ghép các nhóm + âm thanh → mã hóa 1 lần cuối
    log('⚙️ Render nhanh: ghép cảnh + chuyển cảnh...');
    const groups = [];
    for (let g = 0; g < scenes.length; g += GROUP_SIZE) groups.push(scenes.slice(g, g + GROUP_SIZE));
    const groupClips = [];
    await pool(groups, 2, async (grp, gi) => {
      const base = grp[0].startF;
      const file = path.join(work, `group_${String(gi).padStart(2, '0')}.mp4`);
      if (grp.length === 1) fs.copyFileSync(grp[0].clip, file);
      else await xfadeConcat(grp.map(sc => ({ file: sc.clip, startF: sc.startF - base, Lf: sc.Lf, transition: sc.transition })), file);
      groupClips[gi] = { file, startF: base, Lf: grp[grp.length - 1].startF + grp[grp.length - 1].Lf - base, transition: grp[0].transition };
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const finalEnc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart'];
    const audioIdx = groupClips.length;
    await xfadeConcat(groupClips, outputPath, {
      extraInputs: ['-i', audio], extraMap: ['-map', `${audioIdx}:a`], finalArgs: finalEnc,
      scriptPath: path.join(work, 'final.filter.txt'),
    });
    log(`⚙️ Render nhanh xong: ${Math.round(totalSec)}s video trong ${Math.round((Date.now() - t0) / 1000)}s`);
    return { success: true, outputPath };
  } finally {
    if (planOverride) { try { fs.writeFileSync(PLAN_PATH, originalText, 'utf8'); } catch (_) {} }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { hybridRender };
