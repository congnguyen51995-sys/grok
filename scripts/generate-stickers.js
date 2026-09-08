/**
 * Generate animated GIF sticker buttons for LIKE, SUBSCRIBE, VIP, SHARE, FOLLOW
 * Uses FFmpeg lavfi source + drawbox + drawtext → animated GIF
 * Run: node scripts/generate-stickers.js
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpeg = require('ffmpeg-static');
const OUT_DIR = path.join(__dirname, '../assets/stickers');
fs.mkdirSync(OUT_DIR, { recursive: true });

const FONT = 'C\\\\:/Windows/Fonts/arialbd.ttf'; // bold, escaped for FFmpeg

// 320x90 px, 2s loop, 15fps, animated pulse effect
const buttons = [
  {
    file: 'like_btn.gif',
    text: 'LIKE',
    bg: '0x1565C0',       // blue YouTube like
    icon: null,
    w: 200, h: 80,
  },
  {
    file: 'subscribe_btn.gif',
    text: 'SUBSCRIBE',
    bg: '0xCC0000',       // YouTube red
    icon: null,
    w: 280, h: 80,
  },
  {
    file: 'follow_btn.gif',
    text: 'FOLLOW',
    bg: '0x1DA1F2',       // Twitter blue
    icon: null,
    w: 220, h: 80,
  },
  {
    file: 'share_btn.gif',
    text: 'SHARE',
    bg: '0x00875A',       // green
    icon: null,
    w: 200, h: 80,
  },
  {
    file: 'vip_badge.gif',
    text: 'VIP',
    bg: '0xFFD700',       // gold
    textColor: '0x000000',
    w: 150, h: 80,
  },
  {
    file: 'hot_badge.gif',
    text: 'HOT',
    bg: '0xFF3300',       // orange-red
    icon: null,
    w: 150, h: 80,
  },
  {
    file: 'new_badge.gif',
    text: 'NEW',
    bg: '0x00CC44',       // green
    icon: null,
    w: 150, h: 80,
  },
];

const DURATION = 2;   // seconds per loop
const FPS = 12;
const FRAMES = DURATION * FPS;

for (const btn of buttons) {
  const outPath = path.join(OUT_DIR, btn.file);
  const W = btn.w;
  const H = btn.h;
  const textColor = btn.textColor || '0xFFFFFF';
  const fontSize = Math.round(H * 0.42);
  const bgAlpha = btn.bg;

  // Animated filter: pulsing scale via drawbox alpha oscillation
  // Frame-based: scale(t) = 1 + 0.03*sin(2*pi*t/DURATION)
  // We use FFmpeg expression: alpha = 0.85 + 0.15*sin(2*PI*t/2)
  const cornerR = 14; // corner radius trick via multiple drawbox layers

  // rounded corners: draw a slightly-padded filled box then cut corners with bg color
  // Simple approach: layered boxes to approximate rounded rect
  const boxFilter = [
    // main box
    `drawbox=x=0:y=${cornerR}:w=${W}:h=${H - cornerR * 2}:color=${bgAlpha}FF:t=fill`,
    `drawbox=x=${cornerR}:y=0:w=${W - cornerR * 2}:h=${H}:color=${bgAlpha}FF:t=fill`,
    // corner circles (approximate with boxes)
    `drawbox=x=${cornerR - 2}:y=${cornerR - 2}:w=${4}:h=${4}:color=${bgAlpha}FF:t=fill`,
    `drawbox=x=${W - cornerR - 2}:y=${cornerR - 2}:w=${4}:h=${4}:color=${bgAlpha}FF:t=fill`,
    `drawbox=x=${cornerR - 2}:y=${H - cornerR - 2}:w=${4}:h=${4}:color=${bgAlpha}FF:t=fill`,
    `drawbox=x=${W - cornerR - 2}:y=${H - cornerR - 2}:w=${4}:h=${4}:color=${bgAlpha}FF:t=fill`,
  ].join(',');

  // Animated glow: outer box that pulses alpha
  const glowFilter = `drawbox=x=2:y=2:w=${W - 4}:h=${H - 4}:color=${textColor}:t=2`;

  // Text centered
  const textFilter = `drawtext=text='${btn.text}':fontfile=${FONT}:fontcolor=${textColor}FF:fontsize=${fontSize}:x=(${W}-tw)/2:y=(${H}-th)/2`;

  // combine: start from transparent, draw box, draw text
  const vf = [
    `scale=${W}:${H}`,
    boxFilter,
    glowFilter,
    textFilter,
  ].join(',');

  console.log(`Generating ${btn.file} (${W}x${H})...`);
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black@0:s=${W}x${H}:r=${FPS}:d=${DURATION}`,
      '-vf', vf,
      '-loop', '0',          // infinite loop GIF
      '-f', 'gif',
      outPath,
    ], { stdio: 'pipe' });
    console.log(`  ✓ ${outPath}`);
  } catch (e) {
    console.error(`  ✗ ${btn.file}: ${e.stderr?.toString()?.slice(-300) || e.message}`);
  }
}

console.log('\nDone! Files in assets/stickers/');
