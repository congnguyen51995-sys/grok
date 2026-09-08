const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const { spawn } = require('child_process');

const REMOTION_DIR   = path.join('D:\\TOOL REUP\\remotion');
const GENERATED_DIR  = path.join(REMOTION_DIR, 'src', 'generated');
const OUT_DIR        = path.join(REMOTION_DIR, 'out');

function ensureDirs() {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  if (!fs.existsSync(OUT_DIR))        fs.mkdirSync(OUT_DIR,        { recursive: true });
}

const SYSTEM_PROMPT = `You are a Remotion 4.x React video code generator specialized in CREATIVE SCENE ILLUSTRATION.

OUTPUT FORMAT: Return ONLY a JSX code block, no explanations.
Wrap code in \`\`\`jsx ... \`\`\`

REQUIRED EXPORTS:
- export const GeneratedVideo = () => { ... }
- export const COMPOSITION_ID = "GeneratedVideo"
- export const COMPOSITION_WIDTH = <use exact value from user request>
- export const COMPOSITION_HEIGHT = <use exact value from user request>
- export const COMPOSITION_FPS = 30
- export const COMPOSITION_DURATION_FRAMES = 150

ALLOWED IMPORTS (ONLY these):
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Series, Easing, Img, staticFile } from 'remotion';

FONT: Be Vietnam Pro is already loaded via CSS. Use fontFamily: "'Be Vietnam Pro', sans-serif" on ALL text. Do NOT add any <style> tag or @import for fonts.

STYLE: inline styles only. Colors via hex. All Vietnamese text must be written exactly as-is (UTF-8).

━━━ SCENE ILLUSTRATION RULES ━━━
Your job is to create a CINEMATIC SCENE that visualizes the narration content.
Layer order from back to front: (1) background → (2) character/subject → (3) text overlay

SCENE STRUCTURE:
1. BACKGROUND (AbsoluteFill): Rich gradient or environment matching mood.
   Use CSS gradients, geometric shapes, animated particles. NO plain solid color.
2. CHARACTER (centered, floating): see CHARACTER TEMPLATE below.
3. TEXT OVERLAY (bottom 30%): Semi-transparent dark card + bold heading + subtitle.

━━━ REFERENCE IMAGE — MANDATORY TEMPLATE ━━━
When ref images are provided, you MUST use this EXACT pattern — no variation:

\`\`\`jsx
// CORRECT: single centered character figure
<div style={{position:'absolute', bottom:'28%', left:'50%', transform:'translateX(-50%)',
             height:'62%', display:'flex', alignItems:'flex-end', justifyContent:'center',
             filter:'drop-shadow(0 8px 32px rgba(0,0,0,0.6))'}}>
  <Img src={staticFile('ref_0.jpg')}
       style={{height:'100%', width:'auto', objectFit:'contain',
               transform:\`translateY(\${Math.sin(frame/40*Math.PI)*5}px)\`}} />
</div>
\`\`\`

ABSOLUTE PROHIBITIONS with ref images:
❌ NEVER display ref image in a grid, flex-wrap, or repeated layout
❌ NEVER use ref image as background wallpaper (no position:absolute+width:100%+height:100% on the Img)
❌ NEVER create multiple copies of the same ref image
❌ NEVER put ref image inside a map() or array loop
The ref image = ONE PERSON standing in front of a background. That is all.

━━━ ANIMATION PATTERNS ━━━
const clamp = { extrapolateLeft:'clamp', extrapolateRight:'clamp' };
- Fade in:  interpolate(frame, [0,20], [0,1], clamp)
- Slide up: interpolate(frame, [0,25], [40,0], clamp)   (translateY)
- Breathe:  1 + Math.sin(frame / 30 * Math.PI) * 0.012  (scaleY)
- Float:    Math.sin(frame / 45 * Math.PI) * 5           (translateY px)
- Zoom:     interpolate(frame, [0,150], [1, 1.06], clamp) (scale, Ken Burns)

MULTI-SCENE: use <Sequence from={N} durationInFrames={M}> for timed sections.

Build cinematic, emotionally resonant scenes. Every frame should look like a high-quality social media visual.`;

function writeGeneratedFiles(componentCode) {
  ensureDirs();

  // Extract composition ID from code (fallback to 'GeneratedVideo')
  const idMatch = componentCode.match(/COMPOSITION_ID\s*=\s*["'`](\w+)["'`]/);
  const compositionId = idMatch ? idMatch[1] : 'GeneratedVideo';

  // Write the component file
  fs.writeFileSync(path.join(GENERATED_DIR, 'CurrentVideo.jsx'), componentCode, 'utf8');

  // Write a root that imports index.css from parent and registers the component
  const rootCode = `import React from 'react';
import { Composition } from 'remotion';
import '../index.css';
import {
  GeneratedVideo,
  COMPOSITION_ID,
  COMPOSITION_WIDTH,
  COMPOSITION_HEIGHT,
  COMPOSITION_FPS,
  COMPOSITION_DURATION_FRAMES,
} from './CurrentVideo.jsx';

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID || 'GeneratedVideo'}
    component={GeneratedVideo}
    width={COMPOSITION_WIDTH  || 1920}
    height={COMPOSITION_HEIGHT || 1080}
    fps={COMPOSITION_FPS || 30}
    durationInFrames={COMPOSITION_DURATION_FRAMES || 180}
  />
);
`;
  fs.writeFileSync(path.join(GENERATED_DIR, 'GeneratedRoot.jsx'), rootCode, 'utf8');

  // Write entry point
  const indexCode = `import { registerRoot } from 'remotion';
import { RemotionRoot } from './GeneratedRoot.jsx';
registerRoot(RemotionRoot);
`;
  fs.writeFileSync(path.join(GENERATED_DIR, 'GeneratedIndex.jsx'), indexCode, 'utf8');

  return compositionId;
}

// Strip ANSI color codes từ Remotion output
const stripAnsi = (s) => s.replace(/\x1B\[[\d;]*[A-Za-z]/g, '').replace(/\x1B[()][0-9A-Za-z]/g, '');

// Lọc log Remotion: chỉ giữ mốc 10% thay vì mỗi frame, strip ANSI
function makeRenderSink(sendLog) {
  let lastRendMilestone = -1;
  let lastEncMilestone  = -1;
  return (raw) => {
    const line = stripAnsi(raw.toString()).trimEnd();
    if (!line) return;
    // "Rendered 560/9000" — lọc còn mốc 10%
    const rm = line.match(/Rendered\s+(\d+)\/(\d+)/i);
    if (rm) {
      const cur = parseInt(rm[1]), tot = parseInt(rm[2]);
      if (tot > 0) {
        const pct = Math.floor((cur / tot) * 100);
        const milestone = Math.floor(pct / 10) * 10;
        if (milestone === lastRendMilestone && cur !== tot) return;
        lastRendMilestone = milestone;
        const eta = line.match(/time remaining:\s*(.+)/i)?.[1] || '';
        sendLog(`⚙️ Render ${cur}/${tot} (${pct}%)${eta ? ' · còn ' + eta : ''}`);
        return;
      }
    }
    // "Encoded 8900/9000" — lọc còn mốc 10%
    const em = line.match(/Encoded\s+(\d+)\/(\d+)/i);
    if (em) {
      const cur = parseInt(em[1]), tot = parseInt(em[2]);
      if (tot > 0) {
        const pct = Math.floor((cur / tot) * 100);
        const milestone = Math.floor(pct / 10) * 10;
        if (milestone === lastEncMilestone && cur !== tot) return;
        lastEncMilestone = milestone;
        sendLog(`🔧 Encode ${cur}/${tot} (${pct}%)`);
        return;
      }
    }
    // Bỏ bundle/webpack noise
    if (/^\s*$|^Bundling|^Creating bundle|webpack|compiled|chunk|asset size|module|entrypoint/i.test(line)) return;
    sendLog(line);
  };
}

// Bọc path trong dấu nháy kép nếu có khoảng trắng (Windows shell: true)
const qp = (p) => (p.includes(' ') ? `"${p}"` : p);

// outputDir: thư mục người dùng chọn, fallback về OUT_DIR mặc định
function renderVideo(compositionId, outputFilename, sendLog, outputDir) {
  return new Promise((resolve, reject) => {
    ensureDirs();
    const targetDir = outputDir || OUT_DIR;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const outPath   = path.join(targetDir, outputFilename);
    const entryFile = path.join('src', 'generated', 'GeneratedIndex.jsx');

    // Remotion 4.x: output là positional arg thứ 3, không dùng --output flag
    // Bọc path có khoảng trắng trong dấu nháy kép (Windows shell:true)
    const args = ['remotion', 'render', qp(entryFile), compositionId, qp(outPath)];

    sendLog(`▶ npx ${args.join(' ')}`);
    sendLog(`📁 Output: ${outPath}`);

    const sink = makeRenderSink(sendLog);
    const proc = spawn('npx', args, { cwd: REMOTION_DIR, shell: true });

    proc.stdout.on('data', d => sink(d));
    proc.stderr.on('data', d => sink(d));

    proc.on('close', code => {
      if (code === 0) {
        sendLog(`✅ Render hoàn tất: ${outputFilename}`);
        resolve(outPath);
      } else {
        reject(new Error(`Remotion exited with code ${code}`));
      }
    });

    proc.on('error', err => reject(new Error(`Không chạy được npx: ${err.message}`)));
  });
}

// ─── Illustration system ──────────────────────────────────────────────────────

const ILLUSTRATION_PROMPT = `You are an expert Remotion 4.x React STILL IMAGE illustrator.
Generate a beautiful, professional illustration as a single static React component.

OUTPUT FORMAT: Return ONLY a JSX code block. Wrap in \`\`\`jsx ... \`\`\`

REQUIRED EXPORTS:
- export const GeneratedVideo = () => { ... }
- export const COMPOSITION_ID = "GeneratedVideo"
- export const COMPOSITION_WIDTH = <use exact value from user request>
- export const COMPOSITION_HEIGHT = <use exact value from user request>
- export const COMPOSITION_FPS = 30
- export const COMPOSITION_DURATION_FRAMES = 1

ALLOWED IMPORTS (ONLY these):
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

NO animations, NO useCurrentFrame, NO Audio, NO external URLs.
Use Img + staticFile() ONLY for reference images listed in the prompt (ref_0.jpg etc).
Everything must be pure JSX + inline styles (no Tailwind, no CSS files).

FONT: Be Vietnam Pro is pre-loaded. Use fontFamily: "'Be Vietnam Pro', sans-serif" on ALL text. Do NOT add any <style> tag or Google Fonts import.

VISUAL DESIGN RULES:
- Create a visually STUNNING still image that perfectly illustrates the scene content
- Use emoji as icons/decorations (large, 60-120px font-size)
- Rich gradient backgrounds: linear-gradient or radial-gradient
- Clear typography hierarchy: huge headline, medium subtext, small detail
- Use geometric shapes via div with borderRadius, transform (skew, rotate)
- Add decorative elements: circles, lines, cards, badges, tags
- Dark themes preferred: deep navy (#0a0e1a), dark slate (#0f172a), rich purple (#1a0533)
- Accent colors: electric blue (#3b82f6), neon green (#10b981), hot pink (#ec4899), gold (#f59e0b)
- Use Vietnamese text exactly as provided (UTF-8 characters must be preserved as-is)
- Layout should fill the entire frame with no empty space
- Visual style: modern, bold, editorial — like a premium social media graphic

CONTENT RULES:
- The illustration MUST directly visualize what the narration/topic describes
- Extract 2-3 KEY POINTS from the narration and feature them prominently
- Include the scene topic as the hero headline (large, bold, centered)
- Add supporting visual metaphors via emoji + short labels
- Show data/numbers prominently if the content has statistics
- Make text readable: white on dark bg, or dark on light bg with good contrast

━━━ REFERENCE IMAGE RULE (CRITICAL) ━━━
If ref_0.jpg (or ref_N.jpg) is listed in the prompt, use EXACTLY this pattern:

// LAYER 1: background gradient (AbsoluteFill)
// LAYER 2: character — ONE centered figure
<div style={{position:'absolute', bottom:'25%', left:'50%', transform:'translateX(-50%)',
             height:'60%', display:'flex', alignItems:'flex-end'}}>
  <Img src={staticFile('ref_0.jpg')}
       style={{height:'100%', width:'auto', objectFit:'contain',
               filter:'drop-shadow(0 12px 40px rgba(0,0,0,0.7))'}} />
</div>
// LAYER 3: text overlay card at bottom

FORBIDDEN with ref images:
❌ Do NOT display the image as a grid or in multiple copies
❌ Do NOT use width:'100%' height:'100%' on the Img (that makes it a wallpaper)
❌ Do NOT use map(), array, or repeat the Img tag more than once per ref file
❌ Do NOT put ref image inside a flex-wrap container that creates a collage
ONE ref = ONE figure in ONE scene. Period.`;

// Gọi Gemini API trực tiếp (không qua renderer)
function callGeminiDirect(apiKey, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 8192 },
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = https.request(options, (res) => {
      res.setEncoding('utf8');
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(chunks.join(''));
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Extract JSX từ markdown code block
function extractJsx(text) {
  const m = text.match(/```(?:jsx|js|javascript|tsx)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

// renderStill: render 1 frame ra PNG/JPEG
function renderStill(compositionId, outputPath, sendLog = () => {}) {
  return new Promise((resolve, reject) => {
    ensureDirs();
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const entryFile = path.join('src', 'generated', 'GeneratedIndex.jsx');
    const args = ['remotion', 'still', qp(entryFile), compositionId, qp(outputPath), '--frame=0'];

    sendLog(`🖼️ npx ${args.join(' ')}`);
    const proc = spawn('npx', args, { cwd: REMOTION_DIR, shell: true });
    let stderr = '';
    proc.stdout.on('data', d => sendLog(stripAnsi(d.toString()).trim()));
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) {
        sendLog(`✅ Still: ${outputPath}`);
        resolve(outputPath);
      } else {
        reject(new Error(`renderStill failed (${code}): ${stripAnsi(stderr).slice(0, 300)}`));
      }
    });
    proc.on('error', err => reject(err));
  });
}

function formatToDimensions(format) {
  switch ((format || '9:16').trim()) {
    case '16:9':  return { w: 1920, h: 1080, desc: 'landscape horizontal 16:9 (1920×1080)' };
    case '1:1':   return { w: 1080, h: 1080, desc: 'square 1:1 (1080×1080)' };
    case '4:5':   return { w: 1080, h: 1350, desc: 'portrait 4:5 (1080×1350)' };
    case '9:16':
    default:      return { w: 1080, h: 1920, desc: 'portrait vertical 9:16 (1080×1920)' };
  }
}

// JSON data prompt — Gemini chỉ trả data, không viết code
const ILLUSTRATION_JSON_PROMPT = `You are a creative director for social media videos. Your job is to design the visual data for a scene.

Return ONLY a valid JSON object (no markdown, no explanation). Schema:
{
  "background": "CSS gradient string, e.g. 'linear-gradient(135deg,#04091a 0%,#0c1540 100%)'",
  "accent": "#hexcolor — main accent color matching the mood/topic",
  "heading": "Short impactful headline (Vietnamese, max 8 words, bold statement)",
  "subtext": "Supporting sentence (Vietnamese, max 15 words)",
  "badges": [
    { "icon": "emoji", "label": "short label (Vietnamese, max 4 words)" }
  ],
  "stats": [
    { "value": "73%", "label": "short label (Vietnamese)" }
  ],
  "character_file": "ref_0.jpg or null"
}

Rules:
- badges: 2-4 items, each with relevant emoji + key concept from narration
- stats: 0-3 items, ONLY if narration contains actual numbers/percentages
- background: rich dark gradient, match mood (finance=navy/gold, health=dark-green, tech=dark-blue/purple, love=dark-rose)
- accent: vivid color that pops on dark background
- heading: extract the CORE MESSAGE from narration — hook, emotion, key insight
- character_file: "ref_0.jpg" if ref images exist, otherwise null
- All text in Vietnamese, UTF-8 correct`;

// Tạo JSX từ IllustrationScene component template + JSON data
function buildIllustrationJsx(data, dim, copiedRefs) {
  const charFile = copiedRefs.length > 0 ? copiedRefs[0] : null;
  const illustData = { ...data, character_file: charFile || data.character_file || null };
  const dataStr = JSON.stringify(illustData, null, 2);

  return `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Img, staticFile } from 'remotion';

const FONT = "'Be Vietnam Pro', Arial, sans-serif";

export const GeneratedVideo = () => {
  const frame = useCurrentFrame();
  const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
  const data = ${dataStr};

  const fadeIn  = interpolate(frame, [0, 20], [0, 1], cl);
  const slideUp = interpolate(frame, [0, 25], [40, 0], cl);
  const breatheY = Math.sin((frame / 45) * Math.PI) * 6;
  const breatheS = 1 + Math.sin((frame / 30) * Math.PI) * 0.012;

  const accent = data.accent || '#6366f1';
  const bg     = data.background || 'linear-gradient(135deg,#04091a 0%,#0c1540 100%)';
  const badges = Array.isArray(data.badges) ? data.badges.slice(0, 4) : [];
  const stats  = Array.isArray(data.stats)  ? data.stats.slice(0, 3)  : [];

  return (
    <AbsoluteFill style={{ background: bg, overflow: 'hidden', fontFamily: FONT }}>
      {/* Glow orb */}
      <div style={{ position: 'absolute', width: 700, height: 700, borderRadius: '50%',
        background: \`radial-gradient(circle, \${accent}22 0%, transparent 70%)\`,
        top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      <div style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300,
        borderRadius: '50%', border: \`2px solid \${accent}20\` }} />

      {/* Character ref — single centered figure */}
      {data.character_file && (
        <div style={{ position: 'absolute', bottom: '28%', left: '50%',
          transform: \`translateX(-50%) translateY(\${breatheY}px) scaleY(\${breatheS})\`,
          height: '58%', display: 'flex', alignItems: 'flex-end',
          filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.65))' }}>
          <Img src={staticFile(data.character_file)}
            style={{ height: '100%', width: 'auto', objectFit: 'contain' }} />
        </div>
      )}

      {/* Badges left */}
      {badges.length > 0 && (
        <div style={{ position: 'absolute', left: 60, top: '18%',
          display: 'flex', flexDirection: 'column', gap: 18,
          opacity: fadeIn, transform: \`translateY(\${slideUp}px)\` }}>
          {badges.map((b, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
              border: \`1.5px solid \${accent}55\`, borderRadius: 14,
              padding: '12px 22px', maxWidth: 340,
            }}>
              <span style={{ fontSize: 30 }}>{b.icon || '✦'}</span>
              <span style={{ color: '#fff', fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{b.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stats right */}
      {stats.length > 0 && (
        <div style={{ position: 'absolute', right: 60, top: '18%',
          display: 'flex', flexDirection: 'column', gap: 18,
          opacity: fadeIn, transform: \`translateY(\${slideUp}px)\` }}>
          {stats.map((s, i) => {
            const p = interpolate(frame, [i * 10, i * 10 + 40], [0, 1], cl);
            return (
              <div key={i} style={{
                background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
                border: \`1.5px solid \${accent}65\`, borderRadius: 14,
                padding: '14px 28px', textAlign: 'center', minWidth: 170, opacity: p,
              }}>
                <div style={{ color: accent, fontSize: 42, fontWeight: 900 }}>{s.value}</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 18, marginTop: 4 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom text card */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '36px 60px 52px',
        background: 'linear-gradient(0deg,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.55) 70%,transparent 100%)',
        opacity: fadeIn, transform: \`translateY(\${slideUp}px)\` }}>
        {data.heading && (
          <div style={{ color: accent, fontSize: ${dim.w > dim.h ? 52 : 46}, fontWeight: 900, lineHeight: 1.15,
            textShadow: \`0 0 40px \${accent}60\`, marginBottom: 14 }}>
            {data.heading}
          </div>
        )}
        {data.subtext && (
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 26, fontWeight: 400, lineHeight: 1.55 }}>
            {data.subtext}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const COMPOSITION_ID             = 'GeneratedVideo';
export const COMPOSITION_WIDTH          = ${dim.w};
export const COMPOSITION_HEIGHT         = ${dim.h};
export const COMPOSITION_FPS            = 30;
export const COMPOSITION_DURATION_FRAMES = 150;
`;
}

// Pipeline mới: sceneData → Gemini JSON → template JSX → renderStill → PNG
async function generateIllustration({ narration, topic, style, segId, apiKey, outputDir, refImagePaths = [], format, sendLog = () => {} }) {
  // Copy ref images to remotion/public/
  const copiedRefs = [];
  if (refImagePaths?.length > 0) {
    const publicDir = path.join(REMOTION_DIR, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    for (let i = 0; i < refImagePaths.length; i++) {
      const src = refImagePaths[i];
      if (!src || !fs.existsSync(src)) continue;
      const ext = path.extname(src) || '.jpg';
      const destName = `ref_${i}${ext}`;
      try { fs.copyFileSync(src, path.join(publicDir, destName)); copiedRefs.push(destName); } catch (_) {}
    }
  }

  const dim = formatToDimensions(format);
  const refInfo = copiedRefs.length > 0
    ? `\nRef images available: ${copiedRefs.join(', ')} — set character_file to "${copiedRefs[0]}"`
    : '\nNo ref images — set character_file to null';

  const userPrompt = `Scene ${segId}: "${topic || ''}"
Narration: "${narration || ''}"
Visual style: ${style || 'modern dark cinematic'}
Format: ${dim.desc}${refInfo}

Extract key visuals from the narration. Return JSON only.`;

  sendLog(`🎨 Gemini thiết kế illustration cảnh ${segId}${copiedRefs.length ? ` (${copiedRefs.length} ref)` : ''}...`);

  // Lấy JSON data từ Gemini
  let data = {};
  try {
    const raw = await callGeminiDirect(apiKey, ILLUSTRATION_JSON_PROMPT, userPrompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) data = JSON.parse(jsonMatch[0]);
  } catch (e) {
    sendLog(`⚠️ Gemini JSON parse lỗi: ${e.message} — dùng data mặc định`);
  }

  // Fallback defaults nếu JSON thiếu
  if (!data.heading) data.heading = topic || narration?.slice(0, 40) || 'Nội dung video';
  if (!data.accent)  data.accent  = '#6366f1';
  if (!data.background) data.background = 'linear-gradient(135deg,#04091a 0%,#0c1540 100%)';
  if (!Array.isArray(data.badges)) data.badges = [];
  if (!Array.isArray(data.stats))  data.stats  = [];

  // Build JSX từ template cố định (không bao giờ fail vì syntax error)
  const jsx = buildIllustrationJsx(data, dim, copiedRefs);
  writeGeneratedFiles(jsx);

  const outDir = outputDir || OUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `illustration_seg_${String(segId).padStart(3, '0')}.png`);

  sendLog(`🖼️ Remotion render illustration cảnh ${segId}...`);
  await renderStill('GeneratedVideo', outPath, sendLog);
  return outPath;
}

// ── Audio Auto-Ducking via FFmpeg sidechaincompress ──────────────
// videoPath: rendered video with TTS audio
// musicPath: background music file
// outputPath: final mixed output
// options: { voiceVol=1, musicVol=0.18, threshold=0.02, ratio=8, attack=80, release=600 }
function mixAudioWithDucking(videoPath, musicPath, outputPath, options = {}) {
  const { voiceVol = 1, musicVol = 0.18, threshold = 0.02, ratio = 8, attack = 80, release = 600 } = options;

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-i', videoPath,
      '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex',
      [
        // Voice channel at full volume, split for content + sidechain
        `[0:a]volume=${voiceVol}[voice]`,
        `[voice]asplit=2[voice_out][voice_sc]`,
        // Music at base volume
        `[1:a]volume=${musicVol}[music_in]`,
        // Sidechain compress: duck music when voice is loud
        `[music_in][voice_sc]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[music_ducked]`,
        // Mix both
        `[voice_out][music_ducked]amix=inputs=2:duration=first:dropout_transition=2[final_audio]`,
      ].join(';'),
      '-map', '0:v',
      '-map', '[final_audio]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, { shell: true });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        // Fallback: simple mix without ducking if sidechaincompress not available
        const fallbackArgs = [
          '-i', videoPath,
          '-stream_loop', '-1', '-i', musicPath,
          '-filter_complex', `[0:a]volume=${voiceVol}[v];[1:a]volume=${musicVol}[m];[v][m]amix=inputs=2:duration=first:dropout_transition=2[out]`,
          '-map', '0:v', '-map', '[out]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y', outputPath,
        ];
        const fallback = spawn('ffmpeg', fallbackArgs, { shell: true });
        let stderr2 = '';
        fallback.stderr.on('data', d => { stderr2 += d.toString(); });
        fallback.on('close', code2 => {
          if (code2 === 0 && fs.existsSync(outputPath)) resolve(outputPath);
          else reject(new Error(`Audio mix failed: ${stripAnsi(stderr2).slice(0, 300)}`));
        });
        fallback.on('error', err => reject(err));
      }
    });
    proc.on('error', err => reject(err));
  });
}

function getDefaultOutputDir() { ensureDirs(); return OUT_DIR; }
function getSystemPrompt()     { return SYSTEM_PROMPT; }

// ── YouTube Thumbnail — 1920×1080, renderStill frame 0 ───────────────────────
function buildThumbnailJsx(data, publicImageName) {
  const dataStr = JSON.stringify(data, null, 2);
  const hasImg = !!publicImageName;
  const imgFile = hasImg ? JSON.stringify(publicImageName) : 'null'; // e.g. "thumbnail_bg.jpg"
  const layout = data.layout || 'character_right';

  return `import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

const FONT = "'Be Vietnam Pro', Arial, sans-serif";

export const GeneratedVideo = () => {
  const data = ${dataStr};
  const accent = data.accent || '#f97316';
  const bg = data.background || 'linear-gradient(135deg,#0a0015 0%,#1a0030 50%,#000a20 100%)';
  const layout = data.layout || 'character_right';
  const hasImg = ${hasImg};
  const imgFile = ${imgFile}; // filename inside remotion/public/

  // Text zone width: 55% nếu có nhân vật, 90% nếu không
  const textW = hasImg ? (layout === 'character_center' ? '80%' : '55%') : '88%';
  const textLeft = hasImg && layout === 'character_left' ? '48%' : 60;
  const charLeft = layout === 'character_left' ? 0 : 'auto';
  const charRight = layout === 'character_right' ? 0 : 'auto';

  // Title font size
  const titleLen = (data.title || '').length;
  const titleSize = titleLen > 35 ? 82 : titleLen > 22 ? 100 : 124;

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, overflow: 'hidden' }}>

      {/* ── Background character image ─────────────────────────────────── */}
      {hasImg && (
        <img
          src={staticFile(imgFile)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: layout === 'character_left' ? 0 : 'auto',
            right: layout === 'character_right' ? 0 : layout === 'character_center' ? 'auto' : 'auto',
            width: layout === 'character_center' ? '100%' : '58%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top center',
          }}
        />
      )}

      {/* ── Gradient overlay (text readability) ───────────────────────── */}
      {hasImg && layout === 'character_right' && (
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(to right, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.85) 48%, rgba(0,0,0,0.15) 72%, transparent 100%)' }} />
      )}
      {hasImg && layout === 'character_left' && (
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(to left, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.85) 48%, rgba(0,0,0,0.15) 72%, transparent 100%)' }} />
      )}
      {hasImg && layout === 'character_center' && (
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.75) 100%)' }} />
      )}

      {/* ── Ambient glow (accent color) ───────────────────────────────── */}
      <div style={{ position:'absolute',
        left: layout === 'character_right' ? -60 : 'auto',
        right: layout === 'character_left' ? -60 : 'auto',
        top:'50%', transform:'translateY(-50%)',
        width:500, height:500, borderRadius:'50%',
        background:\`radial-gradient(circle, \${accent}22 0%, transparent 70%)\`,
        pointerEvents:'none' }} />

      {/* ── Left accent bar ───────────────────────────────────────────── */}
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:14,
        background:\`linear-gradient(180deg, \${accent}, \${accent}55)\` }} />

      {/* ── TEXT ZONE ─────────────────────────────────────────────────── */}
      <div style={{
        position:'absolute',
        top:0, bottom:0,
        left: typeof textLeft === 'number' ? textLeft : textLeft,
        width: textW,
        display:'flex', flexDirection:'column', justifyContent:'center',
        padding: layout === 'character_center' ? '0 10%' : '0',
      }}>

        {/* Badge */}
        {data.badge && (
          <div style={{
            display:'inline-flex', alignSelf:'flex-start',
            background: accent, color:'#000',
            fontWeight:900, fontSize:36, letterSpacing:'0.05em',
            padding:'10px 28px', borderRadius:8,
            marginBottom:32,
            boxShadow:\`0 4px 24px \${accent}88\`,
            textTransform:'uppercase',
          }}>
            {data.badge}
          </div>
        )}

        {/* Main title */}
        <div style={{
          fontSize: titleSize, fontWeight:900, color:'#fff',
          lineHeight:1.1, letterSpacing:'-0.02em',
          textShadow:'0 2px 32px rgba(0,0,0,0.95), 0 0 60px rgba(0,0,0,0.7)',
          marginBottom: data.highlight ? 24 : 0,
        }}>
          {data.title || 'Video Title'}
        </div>

        {/* Highlight */}
        {data.highlight && (
          <div style={{
            fontSize: Math.round(titleSize * 0.56), fontWeight:900,
            color: accent, lineHeight:1.1,
            textShadow:\`0 0 32px \${accent}88, 0 2px 16px rgba(0,0,0,0.9)\`,
            letterSpacing:'-0.01em',
          }}>
            {data.highlight}
          </div>
        )}
      </div>

      {/* ── Bottom vignette ───────────────────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:140,
        background:'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)' }} />

    </AbsoluteFill>
  );
};

export const COMPOSITION_ID              = 'GeneratedVideo';
export const COMPOSITION_WIDTH           = 1920;
export const COMPOSITION_HEIGHT          = 1080;
export const COMPOSITION_FPS            = 30;
export const COMPOSITION_DURATION_FRAMES = 2;
`;
}

async function renderThumbnail({ thumbnailData, outputPath, sendLog = () => {} }) {
  const publicDir = path.join(REMOTION_DIR, 'public');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  let publicImageName = null;
  const charImg = thumbnailData.characterImage;

  if (charImg) {
    // Case 1: relative path từ remotion/public/ (ví dụ "images/broll_seg_9999.png")
    // → file đã nằm trong public/, dùng trực tiếp làm staticFile name
    if (!path.isAbsolute(charImg)) {
      const absCheck = path.join(publicDir, charImg);
      if (fs.existsSync(absCheck)) {
        publicImageName = charImg; // staticFile('images/broll_seg_9999.png')
        sendLog(`📁 Using existing public image: ${charImg}`);
      }
    }
    // Case 2: absolute path → copy vào remotion/public/thumbnail_bg.ext
    if (!publicImageName && path.isAbsolute(charImg) && fs.existsSync(charImg)) {
      const ext = path.extname(charImg) || '.jpg';
      publicImageName = `thumbnail_bg${ext}`;
      fs.copyFileSync(charImg, path.join(publicDir, publicImageName));
      sendLog(`📁 Copied character image → remotion/public/${publicImageName}`);
    }
  }

  const jsx = buildThumbnailJsx(thumbnailData, publicImageName);
  writeGeneratedFiles(jsx);
  if (!fs.existsSync(path.dirname(outputPath))) fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  sendLog('🖼️ Remotion render thumbnail...');
  await renderStill('GeneratedVideo', outputPath, sendLog);
  return outputPath;
}

module.exports = { writeGeneratedFiles, renderVideo, renderStill, renderThumbnail, generateIllustration, mixAudioWithDucking, getDefaultOutputDir, getSystemPrompt, REMOTION_DIR };
