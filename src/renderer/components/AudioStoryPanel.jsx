/**
 * MCStudioPanel — Phase 1-4: Cài đặt → Tạo Audio → Dựng Video → SEO
 * Khôi phục từ build 5.1.9 (Aug 15, 2026)
 * Phase 1: Cài đặt (video nền, hiệu ứng, sóng âm, phụ đề, tên kênh, logo, reup)
 * Phase 2: Tạo Audio (script AI / YTB / dán text + TTS → SRT tự động)
 * Phase 3: Dựng Video (loop → reup → composite)
 * Phase 4: SEO & Thumbnail tự động
 * Right panel: Canvas preview tương tác + Log
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import { transcribeAudio } from '../services/audioToVideo.js';
import { generateSeoMetadata } from './CreatorStudio';

const LS_GEMINI_KEYS  = 'fluxy_gemini_api_keys';
const LS_GEMINI_MODEL = 'mc_studio_gemini_model';
const LS_ASP_PROJECTS = 'asp_projects'; // AudioStoryPanel saved projects
function loadKeys()        { try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS)  || '[]'); } catch { return []; } }
function loadGeminiModel() { return localStorage.getItem(LS_GEMINI_MODEL) || 'gemini-3.5-flash'; }
function loadAspProjects() { try { return JSON.parse(localStorage.getItem(LS_ASP_PROJECTS) || '{}'); } catch { return {}; } }

// ─── Story constants (giống CreatorStudio) ────────────────────────────────────
const AUDIO_GENRES = ['Tiên hiệp / Tu tiên','Kiếm hiệp / Wuxia','Ngôn tình / Lãng mạn','Trinh thám / Huyền bí','Kinh dị / Tâm lý','Lịch sử / Dã sử','Khoa học viễn tưởng','Hành động / Phiêu lưu','Gia đấu / Cung đấu','Tổng tài / CEO'];
const AUDIO_TONES  = ['Mạch lạc, cuốn hút, nhiều cảm xúc','Hài hước, nhẹ nhàng, vui tươi','Huyền bí, kịch tính, căng thẳng','Lãng mạn, ngọt ngào, sâu lắng','Bi tráng, anh hùng, sử thi','Tối tăm, u ám, nhiều twist'];
const AUDIO_LANGS  = ['Tiếng Việt','English','Tiếng Trung (giản thể)','日本語 (Tiếng Nhật)','한국어'];
const AUDIO_TARGETS = [
  { label:'50K',  value:50000  },
  { label:'80K',  value:80000  },
  { label:'100K', value:100000 },
  { label:'150K', value:150000 },
];
const CHARS_PER_CHUNK = 5500;

function normalizeYtUrl(url) {
  let id = null;
  const s = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  if (s) id = s[1];
  if (!id) { const m = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/); if (m) id = m[1]; }
  if (!id) { const m = url.match(/[?&]v=([a-zA-Z0-9_-]+)/); if (m) id = m[1]; }
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

// ─── TTS voices ───────────────────────────────────────────────────────────────
const MC_EDGE_VOICES = [
  { id: 'vi-VN-HoaiMyNeural',  label: '🇻🇳 Hoài My (Nữ)'    },
  { id: 'vi-VN-NamMinhNeural', label: '🇻🇳 Nam Minh (Nam)'   },
  { id: 'en-US-JennyNeural',   label: '🇺🇸 Jenny (Female)'   },
  { id: 'en-US-GuyNeural',     label: '🇺🇸 Guy (Male)'       },
  { id: 'en-GB-SoniaNeural',   label: '🇬🇧 Sonia (Female)'   },
  { id: 'zh-CN-XiaoxiaoNeural',label: '🇨🇳 Xiaoxiao (Nữ)'   },
  { id: 'zh-CN-YunxiNeural',   label: '🇨🇳 Yunxi (Nam)'      },
  { id: 'ja-JP-NanamiNeural',  label: '🇯🇵 Nanami (Nữ)'     },
  { id: 'ko-KR-SunHiNeural',   label: '🇰🇷 SunHi (Nữ)'     },
];

const MC_GEMINI_VOICES = [
  { id: 'Aoede',   label: 'Aoede — Nữ, ấm áp'    },
  { id: 'Kore',    label: 'Kore — Nữ, rõ ràng'   },
  { id: 'Leda',    label: 'Leda — Nữ, dịu dàng'  },
  { id: 'Sulafat', label: 'Sulafat — Nữ, thân thiện' },
  { id: 'Charon',  label: 'Charon — Nam, trung tính' },
  { id: 'Fenrir',  label: 'Fenrir — Nam, mạnh mẽ' },
  { id: 'Puck',    label: 'Puck — Nam, linh hoạt' },
  { id: 'Orus',    label: 'Orus — Nam, uy quyền'  },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash'       },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',   label: 'Gemini 3.1 Flash Lite'   },
  { id: 'gemini-3.5-flash',        label: 'Gemini 3.5 Flash'        },
];

// ─── Tạo kịch bản người đọc từ truyện thô ────────────────────────────────────
function buildNarratorScript(raw) {
  return raw
    // Xóa dấu phân cách chương: ──── CHƯƠNG 5 ────
    .replace(/─{3,}[^─\n]*─{3,}/g, '')
    // Xóa [CHƯƠNG X: tên] và CHƯƠNG X: tên trên một dòng riêng
    .replace(/\[CHƯƠNG\s+\d+[^\]]*\]/gi, '')
    .replace(/^chương\s+\d+[^\n]*/gim, '')
    // Xóa markdown heading ## / ### ...
    .replace(/^#{1,6}\s+/gm, '')
    // Xóa bold/italic markdown **text** *text*
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    // Xóa ghi chú meta cuối chương
    .replace(/\(\s*hết\s*chương[^)]*\)/gi, '')
    .replace(/\[\s*còn\s*tiếp[^\]]*\]/gi, '')
    .replace(/\[\s*hết[^\]]*\]/gi, '')
    // Xóa dòng trống thừa (giữ tối đa 1 dòng trống)
    .replace(/\n{3,}/g, '\n\n')
    // Xóa khoảng trắng đầu/cuối dòng
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function splitIntoSentences(text, maxLen = 200) {
  const raw = text.split(/(?<=[.!?。！？…\n])\s+/).map(s => s.trim()).filter(Boolean);
  const result = [];  let buf = '';
  for (const s of raw) {
    if ((buf + ' ' + s).length > maxLen && buf) { result.push(buf.trim()); buf = s; }
    else { buf = buf ? buf + ' ' + s : s; }
  }
  if (buf.trim()) result.push(buf.trim());
  return result;
}

function splitChunks(text, maxLen = 3000) {
  const parts = text.split(/(?<=[.!?。！？\n])\s+/);
  const chunks = [];  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > maxLen && cur) { chunks.push(cur.trim()); cur = p; }
    else { cur = cur ? cur + ' ' + p : p; }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

function parseSRT(txt) {
  return txt.trim().split(/\n\s*\n/).map(block => {
    const lines = block.trim().split('\n');
    if (lines.length < 3) return null;
    const m = lines[1]?.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!m) return null;
    const toSec = t => { const [h,mi,s] = t.replace(',','.').split(':'); return +h*3600 + +mi*60 + +s; };
    return { index: parseInt(lines[0]), start: toSec(m[1]), end: toSec(m[2]), text: lines.slice(2).join(' ').trim() };
  }).filter(Boolean);
}

function secondsToSRT(s) {
  const h=Math.floor(s/3600), mi=Math.floor(s%3600/60), sec=Math.floor(s%60), ms=Math.round(s%1*1000);
  return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function TBtn({ active, onClick, children, cls='' }) {
  return (
    <button onClick={onClick}
      className={`px-2 py-1 rounded text-[10px] font-medium transition ${active ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} ${cls}`}>
      {children}
    </button>
  );
}
function SzBtn({ value, current, onChange, label }) {
  return (
    <button onClick={() => onChange(value)}
      className={`px-2 py-1 rounded text-[10px] font-medium transition ${current===value ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
      {label}
    </button>
  );
}
function Section({ title, titleCls='text-slate-400', children }) {
  return (
    <section className="space-y-2">
      <h3 className={`text-[9px] font-bold uppercase tracking-wider ${titleCls}`}>{title}</h3>
      {children}
    </section>
  );
}

// ─── Canvas preview ───────────────────────────────────────────────────────────
function CanvasPreview({ outputAspect, mcPos, scenePos, logoPos, chNamePos, subtitlePos,
  channelName, chNameColor, chNameFontSize, chNameOpacity,
  subtitleEnabled, subtitleColor, subtitleBg, subtitlePreset, subtitleFontSize, subAnimation,
  showWaveform, waveStyle,
  videoEffect, sceneFrameStyle,
  onDragMC, onDragScene, onDragLogo, onDragChName, onDragSubtitle,
  logoFile, sceneVideo, sceneFolder, sceneImage, bgVideoFile, bgFolder }) {

  const canvasRef    = useRef(null);
  const videoRef     = useRef(null);
  const dragging     = useRef(null);
  const sceneBounds  = useRef({ x: 0, y: 0, w: 0, h: 0 }); // bounds ảnh scene, dùng cho waveform animate
  const is916 = outputAspect === '9:16';
  const CW = is916 ? 270 : 480;
  const CH = is916 ? 480 : 270;

  const pct2px = (pos, cw, ch) => ({ x: pos.x / 100 * cw, y: pos.y / 100 * ch });
  const px2pct = (x, y, cw, ch) => ({ x: Math.max(0, Math.min(100, x / cw * 100)), y: Math.max(0, Math.min(100, y / ch * 100)) });
  const fsSz = { small: 10, medium: 13, large: 17 };

  // Load ảnh → HTMLImageElement (qua IPC base64)
  const loadImg = async (filePath) => {
    if (!filePath) return null;
    try {
      const dataUrl = await window.electronAPI?.readImageAsDataUrl?.(filePath);
      if (!dataUrl) return null;
      return await new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    } catch { return null; }
  };

  // Canvas chỉ vẽ overlay (scene image, logo, text, waveform) — video nền dùng <video> element
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      const [sceneImg, logoImg] = await Promise.all([
        sceneImage?.path ? loadImg(sceneImage.path) : Promise.resolve(null),
        logoFile?.path   ? loadImg(logoFile.path)   : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, CW, CH);

      // Nền tối khi không có video (bgFolder / không có gì)
      if (!bgVideoFile) {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, CW, CH);
        if (bgFolder) {
          ctx.fillStyle = '#334155'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
          ctx.fillText('📁 ' + (bgFolder.name || 'Thư mục nền'), CW/2, CH/2);
          ctx.textAlign = 'left';
        } else {
          ctx.fillStyle = '#1e293b';
          for (let x = 20; x < CW; x += 20) for (let y = 20; y < CH; y += 20) { ctx.beginPath(); ctx.arc(x, y, 0.5, 0, Math.PI*2); ctx.fill(); }
        }
      }

      // Ảnh tĩnh scene — thu nhỏ ở scenePos, lưu bounds cho waveform
      let sBox = null; // { x, y, w, h } — bounds của scene frame
      if (sceneImg) {
        const sp = pct2px(scenePos, CW, CH);
        const maxW = CW * 0.65;
        const ratio = sceneImg.naturalWidth > 0 ? sceneImg.naturalWidth / sceneImg.naturalHeight : 16/9;
        const sw = maxW, sh = sw / ratio;
        sBox = { x: sp.x - sw/2, y: sp.y - sh/2, w: sw, h: sh };
        ctx.drawImage(sceneImg, sBox.x, sBox.y, sw, sh);
      } else if (sceneVideo || sceneFolder || bgVideoFile) {
        // Không có ảnh scene riêng → waveform ở vùng dưới canvas
        const sp = pct2px(scenePos, CW, CH);
        if (sceneVideo || sceneFolder) {
          const sw = CW * 0.65, sh = sw * (is916 ? 9/16 : 16/9);
          sBox = { x: sp.x - sw/2, y: sp.y - sh/2, w: sw, h: sh };
          ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.5;
          ctx.strokeRect(sBox.x, sBox.y, sw, sh);
          ctx.fillStyle = 'rgba(124,58,237,0.2)';
          ctx.fillRect(sBox.x, sBox.y, sw, sh);
          ctx.fillStyle = '#a78bfa'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
          ctx.fillText('SCENE VIDEO', sp.x, sp.y + 3); ctx.textAlign = 'left';
        }
      }
      // Lưu bounds vào ref để animate loop dùng
      if (sBox) {
        sceneBounds.current = sBox;
      } else {
        // Fallback: dải waveform ở dưới cùng canvas
        sceneBounds.current = { x: CW * 0.1, y: CH * 0.84, w: CW * 0.8, h: CH * 0.12 };
      }

      // sceneFrameStyle — viền khung xung quanh scene image
      if (sBox && sceneFrameStyle && sceneFrameStyle !== 'none') {
        const { x, y, w, h } = sBox;
        ctx.save();
        if (sceneFrameStyle === 'frame') {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
          ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
        } else if (sceneFrameStyle === 'glow') {
          ctx.shadowColor = 'rgba(255,200,50,0.9)'; ctx.shadowBlur = 10;
          ctx.strokeStyle = 'rgba(255,200,50,0.8)'; ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
        } else if (sceneFrameStyle === 'neon') {
          ctx.shadowColor = 'rgba(0,220,255,1)'; ctx.shadowBlur = 12;
          ctx.strokeStyle = 'rgba(0,220,255,0.9)'; ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(180,100,255,0.7)'; ctx.lineWidth = 1;
          ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
        }
        ctx.restore();
      }

      // videoEffect — hiệu ứng trên toàn khung
      if (videoEffect && videoEffect !== 'none') {
        ctx.save();
        if (videoEffect === 'frame') {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4;
          ctx.strokeRect(2, 2, CW - 4, CH - 4);
        } else if (videoEffect === 'glow') {
          const grad = ctx.createLinearGradient(0, 0, CW, CH);
          grad.addColorStop(0, 'rgba(255,200,0,0.15)');
          grad.addColorStop(1, 'rgba(255,100,0,0.08)');
          ctx.fillStyle = grad; ctx.fillRect(0, 0, CW, CH);
          ctx.strokeStyle = 'rgba(255,200,0,0.4)'; ctx.lineWidth = 3;
          ctx.strokeRect(0, 0, CW, CH);
        } else if (videoEffect === 'color') {
          ctx.fillStyle = 'rgba(100,60,200,0.12)'; ctx.fillRect(0, 0, CW, CH);
        } else if (videoEffect === 'dark') {
          const vign = ctx.createRadialGradient(CW/2, CH/2, CH*0.2, CW/2, CH/2, CH*0.8);
          vign.addColorStop(0, 'rgba(0,0,0,0)');
          vign.addColorStop(1, 'rgba(0,0,0,0.45)');
          ctx.fillStyle = vign; ctx.fillRect(0, 0, CW, CH);
        }
        ctx.restore();
      }

      // Logo
      if (logoFile) {
        const lp = pct2px(logoPos, CW, CH);
        const ls = 36;
        if (logoImg) {
          const r = logoImg.width / logoImg.height;
          ctx.drawImage(logoImg, lp.x - ls*r/2, lp.y - ls/2, ls*r, ls);
        } else {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5;
          ctx.strokeRect(lp.x - ls/2, lp.y - ls/2, ls, ls);
          ctx.fillStyle = 'rgba(245,158,11,0.2)';
          ctx.fillRect(lp.x - ls/2, lp.y - ls/2, ls, ls);
          ctx.fillStyle = '#fbbf24'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
          ctx.fillText('LOGO', lp.x, lp.y + 3); ctx.textAlign = 'left';
        }
      }

      // Channel name (📺 TÊN KÊNH)
      if (channelName) {
        const cp = pct2px(chNamePos, CW, CH);
        const fs = fsSz[chNameFontSize] || 13;
        ctx.save();
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.globalAlpha = (chNameOpacity ?? 90) / 100;
        // stroke outline
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
        ctx.strokeText(channelName.slice(0, 24), cp.x, cp.y);
        ctx.fillStyle = chNameColor || '#ffffff';
        ctx.fillText(channelName.slice(0, 24), cp.x, cp.y);
        ctx.restore();
      }

      // Subtitle (✏️ HIỆU ỨNG PHỤ ĐỀ)
      if (subtitleEnabled) {
        const sp = pct2px(subtitlePos, CW, CH);
        const boxW = CW * 0.7;
        const subFs = fsSz[subtitleFontSize] || 10;
        const subText = 'Ví dụ phụ đề SRT...';
        ctx.save();
        ctx.textAlign = 'center';
        // nền mờ
        if (subtitleBg !== false) {
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(sp.x - boxW/2, sp.y - subFs - 2, boxW, subFs + 6);
        }
        // stroke
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
        ctx.font = `bold ${subFs}px sans-serif`;
        ctx.strokeText(subText, sp.x, sp.y);
        ctx.fillStyle = subtitleColor || '#ffffff';
        ctx.fillText(subText, sp.x, sp.y);
        // label animation style
        if (subAnimation && subAnimation !== 'none') {
          ctx.font = `7px monospace`; ctx.fillStyle = 'rgba(255,200,50,0.8)';
          ctx.fillText(`[${subAnimation}]`, sp.x, sp.y - subFs - 4);
        }
        ctx.restore();
      }

      // Waveform — bên trong scene bounds
      if (showWaveform) {
        const sb = sceneBounds.current;
        const pad = 4, barCount = 20;
        const waveAreaW = sb.w - pad*2, waveAreaH = sb.h * 0.22;
        const barW = waveAreaW / barCount;
        const waveX = sb.x + pad, waveY = sb.y + sb.h - pad;
        ctx.fillStyle = 'rgba(236,72,153,0.85)';
        for (let i = 0; i < barCount; i++) {
          const h = waveAreaH * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.5)));
          if (waveStyle === 'mirror') ctx.fillRect(waveX+i*barW, waveY-h/2, barW-1, h);
          else if (waveStyle === 'line') ctx.fillRect(waveX+i*barW, waveY-1, barW-1, 2);
          else if (waveStyle === 'dots') { ctx.beginPath(); ctx.arc(waveX+i*barW+barW/2, waveY-h, 2, 0, Math.PI*2); ctx.fill(); }
          else ctx.fillRect(waveX+i*barW, waveY-h, barW-1, h);
        }
      }
    })();
    return () => { cancelled = true; };
  });

  // Animate waveform
  useEffect(() => {
    if (!showWaveform) return;
    let raf;
    const animate = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Re-trigger draw via state would cause too many re-renders
      // Just animate waveform bars directly
      const ctx = canvas.getContext('2d');
      const sb = sceneBounds.current;
      const pad = 4, barCount = 20;
      const waveAreaW = sb.w - pad*2, waveAreaH = sb.h * 0.22;
      const barW = waveAreaW / barCount;
      const waveX = sb.x + pad, waveY = sb.y + sb.h - pad;
      ctx.clearRect(waveX - 2, waveY - waveAreaH - 2, waveAreaW + 4, waveAreaH + 4);
      ctx.fillStyle = 'rgba(236,72,153,0.85)';
      for (let i = 0; i < barCount; i++) {
        const h = waveAreaH * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + Date.now() * 0.001)));
        if (waveStyle === 'mirror') ctx.fillRect(waveX+i*barW, waveY-h/2, barW-1, h);
        else if (waveStyle === 'circle') { ctx.beginPath(); ctx.arc(waveX+i*barW+barW/2, waveY-h, h/2, 0, Math.PI*2); ctx.fill(); }
        else if (waveStyle === 'dots')   { ctx.beginPath(); ctx.arc(waveX+i*barW+barW/2, waveY-h, 2, 0, Math.PI*2); ctx.fill(); }
        else if (waveStyle === 'fill')   { ctx.fillRect(waveX+i*barW, waveY-h, barW-1, h); ctx.fillStyle='rgba(236,72,153,0.15)'; ctx.fillRect(waveX+i*barW, sb.y, barW-1, sb.h); ctx.fillStyle='rgba(236,72,153,0.85)'; }
        else ctx.fillRect(waveX+i*barW, waveY-h, barW-1, h);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [showWaveform, waveStyle, CW, CH]);

  const getHit = (mx, my) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CW / rect.width, scaleY = CH / rect.height;
    const cx = (mx - rect.left) * scaleX, cy = (my - rect.top) * scaleY;
    const hit = (pos, r = 16) => { const p = pct2px(pos, CW, CH); return Math.hypot(cx-p.x, cy-p.y) < r; };
    if (channelName && hit(chNamePos, 30)) return 'chName';
    if (subtitleEnabled && hit(subtitlePos, 20)) return 'subtitle';
    if (logoFile && hit(logoPos, 16)) return 'logo';
    if (sceneVideo || sceneFolder || sceneImage) { if (hit(scenePos, 30)) return 'scene'; }
    if (hit(mcPos, 24)) return 'mc';
    return null;
  };

  const onMouseDown = (e) => {
    const type = getHit(e.clientX, e.clientY);
    if (!type) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CW / rect.width, scaleY = CH / rect.height;
    dragging.current = {
      type,
      startX: e.clientX, startY: e.clientY,
      origPos: type === 'mc' ? { ...mcPos } : type === 'scene' ? { ...scenePos }
        : type === 'logo' ? { ...logoPos } : type === 'chName' ? { ...chNamePos } : { ...subtitlePos },
      scaleX, scaleY,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const { type, startX, startY, origPos, scaleX, scaleY } = dragging.current;
      const dx = (e.clientX - startX) * scaleX, dy = (e.clientY - startY) * scaleY;
      const newPos = px2pct(pct2px(origPos, CW, CH).x + dx, pct2px(origPos, CW, CH).y + dy, CW, CH);
      if (type === 'mc')       onDragMC(newPos);
      else if (type === 'scene')   onDragScene(newPos);
      else if (type === 'logo')    onDragLogo(newPos);
      else if (type === 'chName')  onDragChName(newPos);
      else if (type === 'subtitle')onDragSubtitle(newPos);
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [CW, CH, mcPos, scenePos, logoPos, chNamePos, subtitlePos, onDragMC, onDragScene, onDragLogo, onDragChName, onDragSubtitle]);

  // local:// đã đăng ký trong Electron — dùng thay file:// để tránh security block
  const bgVideoSrc = bgVideoFile?.path
    ? 'local:///' + bgVideoFile.path.replace(/\\/g, '/')
    : null;

  return (
    <div className="w-full h-full flex items-center justify-center">
      {/* Canvas làm anchor kích thước, video + overlay absolute bên trong */}
      <div style={{ position: 'relative', display: 'inline-block', maxHeight: '100%', maxWidth: '100%', lineHeight: 0 }}>
        {/* Canvas (in-flow) → xác định kích thước container */}
        <canvas ref={canvasRef} width={CW} height={CH}
          className="rounded-lg border border-slate-700 block"
          style={{ cursor: 'grab', background: '#0f172a',
            width: is916 ? 'auto' : '100%',
            height: is916 ? '100%' : 'auto',
            maxWidth: '100%', maxHeight: '100%', display: 'block' }}
          onMouseDown={onMouseDown} />
        {/* Layer 0: Video nền — absolute, phía sau canvas overlay */}
        {bgVideoSrc && (
          <video ref={videoRef} src={bgVideoSrc} autoPlay loop muted playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', zIndex: -1, borderRadius: 8 }}
          />
        )}
        <div style={{ position: 'absolute', bottom: 4, right: 4, pointerEvents: 'none' }}
          className="text-[8px] text-slate-400 bg-black/50 px-1 rounded">
          ↕↔ Kéo để định vị · {outputAspect}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function AudioStoryPanel() {
  // ─── Phase ────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(1);

  // ─── Gemini model ─────────────────────────────────────────────────────────
  const [geminiModel, setGeminiModel] = useState(loadGeminiModel);

  // ─── Story writing (giống CreatorStudio AudioStoryPanel) ──────────────────
  const [storyMode,      setStoryMode]      = useState('create'); // 'create' | 'rewrite'
  const [storyTitle,     setStoryTitle]     = useState('');
  const [storyGenre,     setStoryGenre]     = useState(AUDIO_GENRES[0]);
  const [storyTone,      setStoryTone]      = useState(AUDIO_TONES[0]);
  const [storyLang,      setStoryLang]      = useState(AUDIO_LANGS[0]);
  const [targetChars,    setTargetChars]    = useState(80000);
  const [customChars,    setCustomChars]    = useState('');
  const [synopsis,       setSynopsis]       = useState('');
  const [outline,        setOutline]        = useState('');
  const [storyText,      setStoryText]      = useState('');
  const [narratorScript, setNarratorScript] = useState(''); // kịch bản người đọc (đã làm sạch)
  const [isGen,          setIsGen]          = useState(false);
  const [storyPhase,     setStoryPhase]     = useState(''); // 'outline' | 'writing' | 'done'
  const [storyProgress,  setStoryProgress]  = useState({ done:0, total:0, chapter:0, totalChapters:0 });
  const [storyError,     setStoryError]     = useState('');
  const [ytRewriteUrl,   setYtRewriteUrl]   = useState('');
  const [analyzed,       setAnalyzed]       = useState(null);
  const [isAnalyzing,    setIsAnalyzing]    = useState(false);
  const stopRef    = useRef(false);
  const storyRef   = useRef(null);

  // ─── TTS ──────────────────────────────────────────────────────────────────
  const [ttsEngine,      setTtsEngine]      = useState(() => localStorage.getItem('mc_studio_tts_engine') || 'edge');
  const [ttsVoice,       setTtsVoice]       = useState(() => localStorage.getItem('mc_studio_tts_voice')  || 'vi-VN-HoaiMyNeural');
  const [ttsPitch,       setTtsPitch]       = useState(0);  // semitones
  const [ttsRate,        setTtsRate]        = useState(0);  // %
  const [ttsVnVoice,     setTtsVnVoice]     = useState(() => localStorage.getItem('mc_studio_tts_vn_voice') || '');
  const [vnSavedVoices,  setVnSavedVoices]  = useState(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices')||'[]'); } catch { return []; } });
  const [vnBuiltinVoices,setVnBuiltinVoices]= useState([]);
  // GPT-SoVITS TTS state
  const [gsvRefs,        setGsvRefs]        = useState([]);
  const [gsvSelectedRef, setGsvSelectedRef] = useState('');
  const [gsvRefAudio,    setGsvRefAudio]    = useState('');
  const [gsvRefText,     setGsvRefText]     = useState('');
  const [gsvLang,        setGsvLang]        = useState('vi');
  const [gsvSpeed,       setGsvSpeed]       = useState(1.0);
  const [creatingAudio,  setCreatingAudio]  = useState(false);
  const [audioProgress,  setAudioProgress]  = useState({ done:0, total:0 });
  const [audioFile,      setAudioFile]      = useState(null);
  const [srtFile,        setSrtFile]        = useState(null);
  const [ttsStatus,      setTtsStatus]      = useState('');
  const ttsAbortRef = useRef(false);

  // ─── Video settings ───────────────────────────────────────────────────────
  const [bgVideoFile,  setBgVideoFile]  = useState(null);
  const [bgFolder,     setBgFolder]     = useState(null);
  const [sceneVideo,   setSceneVideo]   = useState(null);
  const [sceneFolder,  setSceneFolder]  = useState(null);
  const [sceneImage,   setSceneImage]   = useState(null);
  const [outputAspect, setOutputAspect] = useState(() => localStorage.getItem('mc_output_aspect') || '16:9');

  // ─── Effect settings ──────────────────────────────────────────────────────
  const [videoEffect,     setVideoEffect]     = useState('none');
  const [mcFrameStyle,    setMcFrameStyle]    = useState('none');
  const [mcWidthPct,      setMcWidthPct]      = useState(30);
  const [mcPos,           setMcPos]           = useState({ x:65.5, y:50 });

  const [sceneFrameStyle, setSceneFrameStyle] = useState('none');
  const [sceneWidthPct,   setSceneWidthPct]   = useState(40);
  const [scenePos,        setScenePos]        = useState({ x:30, y:50 });

  const [logoFile,   setLogoFile]   = useState(null);
  const [logoSize,   setLogoSize]   = useState('medium');
  const [logoPos,    setLogoPos]    = useState({ x:10, y:10 });

  const [channelName,    setChannelName]    = useState('');
  const [chNameColor,    setChNameColor]    = useState('#ffffff');
  const [chNameFontSize, setChNameFontSize] = useState('medium');
  const [chNameOpacity,  setChNameOpacity]  = useState(90);
  const [chNamePos,      setChNamePos]      = useState({ x:50, y:5 });

  const [showWaveform,  setShowWaveform]  = useState(true);
  const [waveStyle,     setWaveStyle]     = useState('bars');
  const [waveWidthPct,  setWaveWidthPct]  = useState(80);
  const [waveHeightPct, setWaveHeightPct] = useState(12);
  const [filmGrain,     setFilmGrain]     = useState(false);
  const [grainLevel,    setGrainLevel]    = useState(5);

  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitlePreset,  setSubtitlePreset]  = useState('classic');
  const [subAnimation,    setSubAnimation]    = useState('none');
  const [subtitleFontSize,setSubtitleFontSize]= useState('medium');
  const [subtitleColor,   setSubtitleColor]   = useState('#ffffff');
  const [subtitleBg,      setSubtitleBg]      = useState(true);
  const [subtitleStroke,  setSubtitleStroke]  = useState(true);
  const [subtitlePos,     setSubtitlePos]     = useState({ x:50, y:85 });
  const [subtitleBoxW,    setSubtitleBoxW]    = useState(70);


  // ─── Output / Composite ───────────────────────────────────────────────────
  const [compositeStatus, setCompositeStatus] = useState('idle');
  const [finalVideo,      setFinalVideo]      = useState(null);

  // ─── SEO ──────────────────────────────────────────────────────────────────
  const [seoData,   setSeoData]   = useState(null);
  const [seoStatus, setSeoStatus] = useState('idle');

  // ─── Log ──────────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);

  // ─── Project presets ──────────────────────────────────────────────────────
  const [projectName,    setProjectName]    = useState('');
  const [projects,       setProjects]       = useState(loadAspProjects); // { name: settingsObj }
  const [projectDirty,   setProjectDirty]   = useState(false); // có thay đổi chưa lưu
  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [...prev.slice(-299), { id: Date.now()+Math.random(), msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs]);

  // ─── Load VieNeu ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI?.getVieNeuBuiltinVoices?.()?.then(v => { if (v?.length) setVnBuiltinVoices(v); }).catch(() => {});
    window.electronAPI?.gptSoVITSGetConfig?.().then(r => { if (r?.refs) setGsvRefs(r.refs); }).catch(() => {});
  }, []);

  // ─── File pickers ─────────────────────────────────────────────────────────
  const pickBgVideo   = async () => { const p = await window.electronAPI?.selectFile('video'); if (p) { setBgVideoFile({ path:p, name:p.split(/[\\/]/).pop() }); setBgFolder(null); addLog(`✅ Video nền: ${p.split(/[\\/]/).pop()}`); } };
  const pickBgFolder  = async () => { const p = await window.electronAPI?.selectFolder?.(); if (p) { setBgFolder({ path:p, name:p.split(/[\\/]/).pop() }); setBgVideoFile(null); addLog(`✅ Thư mục nền: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneVid  = async () => { const p = await window.electronAPI?.selectFile('video'); if (p) { setSceneVideo({ path:p, name:p.split(/[\\/]/).pop() }); setSceneFolder(null); setSceneImage(null); addLog(`✅ Scene: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneDir  = async () => { const p = await window.electronAPI?.selectFolder?.(); if (p) { setSceneFolder({ path:p, name:p.split(/[\\/]/).pop() }); setSceneVideo(null); setSceneImage(null); addLog(`✅ Scene thư mục: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneImg  = async () => { const p = await window.electronAPI?.selectFile('image'); if (p) { setSceneImage({ path:p, name:p.split(/[\\/]/).pop() }); setSceneVideo(null); setSceneFolder(null); addLog(`✅ Ảnh tĩnh: ${p.split(/[\\/]/).pop()}`); } };
  const pickLogo      = async () => { const p = await window.electronAPI?.selectFile('image'); if (p) { setLogoFile({ path:p, name:p.split(/[\\/]/).pop() }); addLog(`✅ Logo: ${p.split(/[\\/]/).pop()}`); } };

  // ─── Project preset helpers ───────────────────────────────────────────────
  const collectSettings = () => ({
    // TTS
    ttsEngine, ttsVoice, ttsPitch, ttsRate, ttsVnVoice, gsvSelectedRef, gsvLang, gsvSpeed,
    // Video layout
    bgVideoFile, bgFolder, sceneVideo, sceneFolder, sceneImage, outputAspect,
    videoEffect, mcFrameStyle, mcWidthPct, mcPos, sceneFrameStyle, sceneWidthPct, scenePos,
    logoFile, logoSize, logoPos,
    channelName, chNameColor, chNameFontSize, chNameOpacity, chNamePos,
    // Waveform
    showWaveform, waveStyle, waveWidthPct, waveHeightPct,
    // Effects
    filmGrain, grainLevel,
    // Subtitle
    subtitleEnabled, subtitlePreset, subAnimation, subtitleFontSize,
    subtitleColor, subtitleBg, subtitleStroke, subtitlePos, subtitleBoxW,
  });

  const saveProject = (name) => {
    if (!name.trim()) return;
    const updated = { ...projects, [name.trim()]: collectSettings() };
    setProjects(updated);
    localStorage.setItem(LS_ASP_PROJECTS, JSON.stringify(updated));
    setProjectDirty(false);
    addLog(`💾 Đã lưu dự án "${name.trim()}"`, 'success');
  };

  const loadProject = (name) => {
    const s = projects[name];
    if (!s) return;
    // TTS
    if (s.ttsEngine   != null) setTtsEngine(s.ttsEngine);
    if (s.ttsVoice    != null) setTtsVoice(s.ttsVoice);
    if (s.ttsPitch     != null) setTtsPitch(s.ttsPitch);
    if (s.ttsRate      != null) setTtsRate(s.ttsRate);
    if (s.ttsVnVoice  != null) setTtsVnVoice(s.ttsVnVoice);
    if (s.gsvSelectedRef != null) setGsvSelectedRef(s.gsvSelectedRef);
    if (s.gsvLang     != null) setGsvLang(s.gsvLang);
    if (s.gsvSpeed    != null) setGsvSpeed(s.gsvSpeed);
    // Video layout
    if (s.bgVideoFile  != null) setBgVideoFile(s.bgVideoFile);
    if (s.bgFolder     != null) setBgFolder(s.bgFolder);
    if (s.sceneVideo   != null) setSceneVideo(s.sceneVideo);
    if (s.sceneFolder  != null) setSceneFolder(s.sceneFolder);
    if (s.sceneImage   != null) setSceneImage(s.sceneImage);
    if (s.outputAspect != null) setOutputAspect(s.outputAspect);
    if (s.videoEffect  != null) setVideoEffect(s.videoEffect);
    if (s.mcFrameStyle != null) setMcFrameStyle(s.mcFrameStyle);
    if (s.mcWidthPct   != null) setMcWidthPct(s.mcWidthPct);
    if (s.mcPos        != null) setMcPos(s.mcPos);
    if (s.sceneFrameStyle != null) setSceneFrameStyle(s.sceneFrameStyle);
    if (s.sceneWidthPct   != null) setSceneWidthPct(s.sceneWidthPct);
    if (s.scenePos     != null) setScenePos(s.scenePos);
    if (s.logoFile     != null) setLogoFile(s.logoFile);
    if (s.logoSize     != null) setLogoSize(s.logoSize);
    if (s.logoPos      != null) setLogoPos(s.logoPos);
    if (s.channelName  != null) setChannelName(s.channelName);
    if (s.chNameColor  != null) setChNameColor(s.chNameColor);
    if (s.chNameFontSize != null) setChNameFontSize(s.chNameFontSize);
    if (s.chNameOpacity != null) setChNameOpacity(s.chNameOpacity);
    if (s.chNamePos    != null) setChNamePos(s.chNamePos);
    // Waveform
    if (s.showWaveform != null) setShowWaveform(s.showWaveform);
    if (s.waveStyle    != null) setWaveStyle(s.waveStyle);
    if (s.waveWidthPct != null) setWaveWidthPct(s.waveWidthPct);
    if (s.waveHeightPct!= null) setWaveHeightPct(s.waveHeightPct);
    // Effects
    if (s.filmGrain    != null) setFilmGrain(s.filmGrain);
    if (s.grainLevel   != null) setGrainLevel(s.grainLevel);
    // Subtitle
    if (s.subtitleEnabled != null) setSubtitleEnabled(s.subtitleEnabled);
    if (s.subtitlePreset  != null) setSubtitlePreset(s.subtitlePreset);
    if (s.subAnimation    != null) setSubAnimation(s.subAnimation);
    if (s.subtitleFontSize!= null) setSubtitleFontSize(s.subtitleFontSize);
    if (s.subtitleColor   != null) setSubtitleColor(s.subtitleColor);
    if (s.subtitleBg      != null) setSubtitleBg(s.subtitleBg);
    if (s.subtitleStroke  != null) setSubtitleStroke(s.subtitleStroke);
    if (s.subtitlePos     != null) setSubtitlePos(s.subtitlePos);
    if (s.subtitleBoxW    != null) setSubtitleBoxW(s.subtitleBoxW);
    setProjectName(name);
    setProjectDirty(false);
    addLog(`📂 Đã tải dự án "${name}"`, 'success');
  };

  const deleteProject = (name) => {
    const updated = { ...projects };
    delete updated[name];
    setProjects(updated);
    localStorage.setItem(LS_ASP_PROJECTS, JSON.stringify(updated));
    if (projectName === name) setProjectName('');
  };
  const pickAudio     = async () => { const p = await window.electronAPI?.selectFile('audio'); if (p) { setAudioFile({ path:p, name:p.split(/[\\/]/).pop() }); addLog(`✅ Audio: ${p.split(/[\\/]/).pop()}`); } };

  // ─── TTS engine change ────────────────────────────────────────────────────
  const changeTtsEngine = (eng) => {
    setTtsEngine(eng); localStorage.setItem('mc_studio_tts_engine', eng);
    const defs = { edge:'vi-VN-HoaiMyNeural', gemini:'Aoede', vieneu:'', gptsovits:'' };
    setTtsVoice(defs[eng]||''); localStorage.setItem('mc_studio_tts_voice', defs[eng]||'');
  };

  // ─── Phân tích video YouTube ──────────────────────────────────────────────
  const handleAnalyzeYt = async () => {
    const keys = loadKeys();
    if (!ytRewriteUrl.trim() || !keys.length) return;
    setIsAnalyzing(true); setStoryError(''); setAnalyzed(null);
    addLog('🔍 Phân tích video YouTube...', 'info');
    try {
      const cleanUrl = normalizeYtUrl(ytRewriteUrl.trim());
      const videoPart = { fileData: { fileUri: cleanUrl } };
      const meta = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const res = await ai.models.generateContent({
          model: geminiModel,
          contents: [{ role:'user', parts:[videoPart, { text:`Phân tích video. Trả về JSON THUẦN:\n{"title":"...","genre":"chọn 1 trong: ${AUDIO_GENRES.join('|')}","tone":"chọn 1 trong: ${AUDIO_TONES.join('|')}","lang":"chọn 1 trong: ${AUDIO_LANGS.join('|')}","synopsis":"tóm tắt 3-5 câu"}` }] }],
          config: { temperature:0.2, maxOutputTokens:1024 },
        });
        const txt = (res.text||'').replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
        const match = txt.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Gemini không trả về JSON');
        return JSON.parse(match[0]);
      }, keys, { maxCycles:2 });

      let originalScript = '';
      try {
        originalScript = await retryWithKeyRotation(async (key) => {
          const ai = new GoogleGenAI({ apiKey: key });
          const res = await ai.models.generateContent({
            model: geminiModel,
            contents: [{ role:'user', parts:[videoPart, { text:'Ghi lại TOÀN BỘ lời thoại/lời kể trong video theo đúng ngôn ngữ gốc. Chỉ ghi nội dung được nói, không thêm ghi chú. Bắt đầu ngay:' }] }],
            config: { temperature:0.1, maxOutputTokens:16384 },
          });
          return res.text || '';
        }, keys, { maxCycles:2 });
      } catch (e) { addLog(`⚠️ Lấy transcript lỗi: ${e.message}`, 'warn'); }

      const result = { ...meta, originalScript };
      setAnalyzed(result);
      if (result.title) setStoryTitle(result.title);
      if (result.genre && AUDIO_GENRES.includes(result.genre)) setStoryGenre(result.genre);
      if (result.tone  && AUDIO_TONES.includes(result.tone))   setStoryTone(result.tone);
      if (result.lang  && AUDIO_LANGS.includes(result.lang))   setStoryLang(result.lang);
      if (result.synopsis) setSynopsis(result.synopsis);
      addLog('✅ Phân tích xong! Điền thêm thông tin rồi nhấn Viết Truyện.', 'success');
    } catch (e) { setStoryError(e.message); addLog(`❌ ${e.message}`, 'error'); }
    setIsAnalyzing(false);
  };

  // ─── Tạo outline ──────────────────────────────────────────────────────────
  const generateOutline = async (keys, effectiveTarget, totalChapters) => {
    const isRewrite = storyMode === 'rewrite' && analyzed?.originalScript;
    const prompt = isRewrite
      ? `Bạn là tác giả chuyên nghiệp viết truyện audio.\nKịch bản gốc:\n===\n${analyzed.originalScript}\n===\n\nTạo outline ${totalChapters} chương để VIẾT LẠI thành truyện dài hơn.\nTiêu đề: ${storyTitle||analyzed.title||'Câu chuyện'}\nThể loại: ${storyGenre}\nPhong cách: ${storyTone}\nNgôn ngữ: ${storyLang}\nTổng: ${effectiveTarget.toLocaleString()} ký tự\n\nĐỊNH DẠNG:\n[CHƯƠNG 1: <tên>]\nNội dung: ...\nĐiểm nhấn: ...`
      : `Bạn là tác giả chuyên nghiệp viết truyện audio ${storyGenre}.\nTạo outline chi tiết:\n\nTiêu đề: ${storyTitle||'Câu chuyện không tên'}\nThể loại: ${storyGenre}\nPhong cách: ${storyTone}\nNGÔN NGỮ BẮT BUỘC: ${storyLang}\nTóm tắt: ${synopsis||'Tự sáng tác câu chuyện hấp dẫn'}\nSố chương: ${totalChapters}\nTổng: ${effectiveTarget.toLocaleString()} ký tự (~${Math.round(effectiveTarget/totalChapters).toLocaleString()} ký tự/chương)\n\nYÊU CẦU:\n- Mỗi chương: tên, tóm tắt 3-5 câu, điểm cliffhanger\n- Arc nhân vật rõ ràng\n\nĐỊNH DẠNG:\n[CHƯƠNG 1: <tên>]\nNội dung: ...\nĐiểm nhấn: ...`;
    return retryWithKeyRotation(async (key) => {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: geminiModel,
        contents: [{ role:'user', parts:[{ text:prompt }] }],
        config: { temperature:0.8, maxOutputTokens:8192 },
      });
      return res.text || '';
    }, keys, { maxCycles:3 });
  };

  // ─── Viết từng chương (streaming) ─────────────────────────────────────────
  const writeChapter = async (keys, chapterNum, totalChaps, outlineText, prevContext, accumulatedChars, effectiveTarget) => {
    const isFirst = chapterNum === 1;
    const isLast  = chapterNum === totalChaps;
    const charsLeft = effectiveTarget - accumulatedChars;
    const charsThisChap = Math.min(CHARS_PER_CHUNK + 500, charsLeft + 1000);
    const isRewrite = storyMode === 'rewrite' && analyzed?.originalScript;
    const contextBlock = !isFirst && prevContext ? `\n\n===ĐOẠN KẾT CHƯƠNG TRƯỚC===\n${prevContext}\n===HẾT NGỮ CẢNH===\n` : '';
    const rewriteNote  = isRewrite ? '\nLƯU Ý: Phát triển từ kịch bản gốc YouTube. KHÔNG sao chép nguyên văn.\n' : '';
    const isViet = storyLang.toLowerCase().includes('việt');
    const langPrefix = !isViet ? `⚠️ VIẾT HOÀN TOÀN BẰNG ${storyLang}. KHÔNG dùng tiếng Việt.\n\n` : '';
    const langSuffix = !isViet ? `\n\n⚠️ NHẮC LẠI: Chỉ viết bằng ${storyLang}.` : '';
    const prompt = `${langPrefix}Tác giả chuyên nghiệp thể loại ${storyGenre}.\nNGÔN NGỮ: ${storyLang}\nPhong cách: ${storyTone}\nTiêu đề: ${storyTitle||'Câu chuyện'}\n${rewriteNote}\nOUTLINE:\n${outlineText}${contextBlock}\nNHIỆM VỤ: Viết CHƯƠNG ${chapterNum}/${totalChaps}. Mục tiêu: ~${charsThisChap.toLocaleString()} ký tự.\n${isLast ? 'Chương CUỐI — kết thúc hoàn chỉnh.' : 'Kết thúc tạo tò mò cho chương sau.'}\n\nQUY TẮC:\n1. KHÔNG viết tiêu đề chương — viết thẳng nội dung\n2. KHÔNG [còn tiếp], (hết chương), ghi chú meta\n3. Đối thoại tự nhiên, miêu tả nội tâm sâu\n4. ${isFirst ? 'Mở đầu ấn tượng, cuốn hút' : 'Tiếp nối mượt mà từ chương trước'}${langSuffix}\nBắt đầu viết ngay:`;
    let chapText = '';
    await retryWithKeyRotation(async (key) => {
      const ai = new GoogleGenAI({ apiKey: key });
      const stream = await ai.models.generateContentStream({
        model: geminiModel,
        contents: [{ role:'user', parts:[{ text:prompt }] }],
        config: { temperature:0.85, maxOutputTokens:8192 },
      });
      for await (const chunk of stream) {
        if (stopRef.current) break;
        const txt = chunk.text || '';
        chapText += txt;
        setStoryText(prev => prev + txt);
        setStoryProgress(p => ({ ...p, done: p.done + txt.length }));
        if (storyRef.current) storyRef.current.scrollTop = storyRef.current.scrollHeight;
      }
    }, keys, { maxCycles:3 });
    return chapText;
  };

  // ─── Orchestrator viết truyện ─────────────────────────────────────────────
  const handleWriteStory = async () => {
    const keys = loadKeys();
    if (!keys.length) { addLog('❌ Cần Gemini API key', 'error'); return null; }
    stopRef.current = false;
    setIsGen(true); setStoryText(''); setOutline(''); setStoryError(''); setStoryPhase('outline');
    addLog('📖 Tạo outline...', 'info');
    try {
      const effectiveTarget = customChars ? parseInt(customChars) || targetChars : targetChars;
      const totalChapters   = Math.max(3, Math.ceil(effectiveTarget / CHARS_PER_CHUNK));
      setStoryProgress({ done:0, total:effectiveTarget, chapter:0, totalChapters });
      const outlineText = await generateOutline(keys, effectiveTarget, totalChapters);
      setOutline(outlineText);
      addLog(`✅ Outline: ${totalChapters} chương. Bắt đầu viết...`, 'success');
      setStoryPhase('writing');
      let accumulated = 0;
      let prevContext  = '';
      let fullText = '';
      for (let i = 1; i <= totalChapters && !stopRef.current; i++) {
        setStoryProgress(p => ({ ...p, chapter:i }));
        addLog(`✏️ Viết chương ${i}/${totalChapters}...`, 'info');
        const sep = i > 1 ? `\n\n${'─'.repeat(20)} CHƯƠNG ${i} ${'─'.repeat(20)}\n\n` : '';
        if (i > 1) setStoryText(prev => prev + sep);
        fullText += sep;
        const chapText = await writeChapter(keys, i, totalChapters, outlineText, prevContext, accumulated, effectiveTarget);
        fullText += chapText;
        accumulated += chapText.length;
        prevContext = chapText.slice(-600);
        addLog(`✅ Chương ${i}: ${chapText.length.toLocaleString()} ký tự (tổng: ${accumulated.toLocaleString()})`, 'success');
      }
      setStoryPhase('done');
      addLog(`🎉 Hoàn thành! Tổng: ${accumulated.toLocaleString()} ký tự`, 'success');
      // Tự động tạo kịch bản người đọc
      const narScript = buildNarratorScript(fullText);
      setNarratorScript(narScript);
      addLog(`📖 Kịch bản người đọc: ${narScript.length.toLocaleString()} ký tự (đã làm sạch)`, 'success');
      setIsGen(false);
      return fullText; // trả về để handleRunAll chain tiếp
    } catch (e) { setStoryError(e.message); addLog(`❌ ${e.message}`, 'error'); setIsGen(false); return null; }
  };

  // ─── Create Audio + SRT ───────────────────────────────────────────────────
  const handleCreateAudio = async (textOverride) => {
    // Ưu tiên: textOverride → narratorScript → storyText
    const text = (textOverride || narratorScript || storyText).trim();
    if (!text) { addLog('❌ Cần kịch bản/văn bản để tạo audio', 'error'); return; }
    const keys = loadKeys();
    const outputDir = await window.electronAPI?.joinDownloadsPath('MCStudio') || 'MCStudio';
    ttsAbortRef.current = false;
    setCreatingAudio(true); setAudioFile(null); setSrtFile(null); setTtsStatus('');
    try {
      let audioPath = null, srtContent = null;

      if (ttsEngine === 'edge') {
        const sentences = splitIntoSentences(text);
        addLog(`🎙️ Edge TTS: ${sentences.length} câu → ${ttsVoice.split('-').pop()}`);
        setAudioProgress({ done:0, total:sentences.length });
        const res = await window.electronAPI?.storyTTSWithSRT({ sentences, voice:ttsVoice, outputDir, pitch:ttsPitch, rate:ttsRate });
        if (!res?.success) throw new Error(res?.error || 'Edge TTS thất bại');
        audioPath = res.audioPath; srtContent = res.srtContent;
        setAudioProgress({ done:sentences.length, total:sentences.length });
        addLog(`✅ Edge TTS xong (${res.totalDuration?.toFixed(0)}s)`, 'success');

      } else if (ttsEngine === 'gemini') {
        if (!keys.length) throw new Error('Cần Gemini API key');
        const chunks = splitChunks(text, 3000);
        addLog(`🎵 Gemini TTS: ${text.length.toLocaleString()} ký tự → ~${chunks.length} đoạn...`);
        setAudioProgress({ done:0, total:chunks.length });
        const onProg = window.electronAPI?.onGeminiTTSProgress?.((p) => setAudioProgress({ done:p.done, total:p.total }));
        window.electronAPI?.onGeminiTTSLog?.((t) => addLog(t));
        const outPath = `${outputDir}\\story_gemini_${Date.now()}.wav`;
        const res = await window.electronAPI?.geminiTTS({ text, voiceName:ttsVoice, apiKeys:keys, outputFolder:outputDir, projectName:outPath });
        if (typeof onProg === 'function') onProg();
        if (!res?.success) throw new Error(res?.error || 'Gemini TTS thất bại');
        audioPath = res.path;
        addLog(`✅ Gemini TTS xong`, 'success');

      } else if (ttsEngine === 'vieneu') {
        const chunks = splitChunks(text, 2000);
        addLog(`🎵 VieNeu TTS: ${chunks.length} đoạn...`);
        setAudioProgress({ done:0, total:chunks.length });
        const parts = [];
        for (let i = 0; i < chunks.length && !ttsAbortRef.current; i++) {
          setTtsStatus(`Đoạn ${i+1}/${chunks.length} · VieNeu TTS...`);
          const tmpPath = `${outputDir}\\vieneu_chunk_${i}_${Date.now()}.wav`;
          const res = await window.electronAPI?.vieNeuSynthesize({ text:chunks[i], voiceId:ttsVnVoice||undefined, outputPath:tmpPath });
          if (res?.success) parts.push(res.path||tmpPath); else addLog(`⚠️ Đoạn ${i+1}: ${res?.error||'?'}`, 'warn');
          setAudioProgress({ done:i+1, total:chunks.length });
        }
        if (!parts.length) throw new Error('VieNeu không tạo được audio');
        setTtsStatus(`🔧 Ghép ${parts.length} đoạn...`);
        const mergedPath = `${outputDir}\\story_vieneu_${Date.now()}.wav`;
        const concatRes = await window.electronAPI?.concatWavFiles({ files:parts, outputPath:mergedPath, deleteAfter:true });
        audioPath = concatRes?.success ? concatRes.path : parts[parts.length-1];
        addLog(`✅ VieNeu xong`, 'success');

      } else if (ttsEngine === 'gptsovits') {
        if (!gsvRefAudio) throw new Error('GPT-SoVITS: Cần chọn reference audio trước');

        // Kiểm tra server, tự khởi động nếu cần
        addLog('🔍 Kiểm tra GPT-SoVITS server...', 'info');
        const srvStatus = await window.electronAPI?.gptSoVITSGetConfig?.();
        if (!srvStatus?.serverRunning) {
          addLog('⚠️ Server chưa chạy — đang khởi động GPT-SoVITS...', 'warn');
          setTtsStatus('🚀 Đang khởi động GPT-SoVITS server...');
          const startRes = await window.electronAPI?.gptSoVITSStartServer?.();
          if (!startRes?.ok) throw new Error(`Không khởi động được GPT-SoVITS server: ${startRes?.msg || 'không rõ lỗi'}`);
          addLog('✅ GPT-SoVITS server đã sẵn sàng', 'success');
          setTtsStatus('');
        } else {
          addLog('✅ Server đang chạy', 'success');
        }

        // Lắng nghe log từ main process
        const unsubGsvLog = window.electronAPI?.onGptSoVITSLog?.((msg) => {
          addLog(`[GSV] ${msg}`, msg.startsWith('❌') ? 'error' : msg.startsWith('⚠') ? 'warn' : 'info');
          if (msg.includes('/')) setTtsStatus(msg.slice(0, 60));
        });

        const chunks = splitChunks(text, 1500);
        addLog(`🎵 GPT-SoVITS TTS: ${chunks.length} đoạn · ref: ${gsvRefAudio.split(/[\\/]/).pop()} · lang: ${gsvLang} · speed: ${gsvSpeed}x`);
        setAudioProgress({ done:0, total:chunks.length });
        const parts = [];
        for (let i = 0; i < chunks.length && !ttsAbortRef.current; i++) {
          setTtsStatus(`Đoạn ${i+1}/${chunks.length} · GPT-SoVITS (chờ server)...`);
          addLog(`⏳ Gửi đoạn ${i+1}/${chunks.length} (${chunks[i].length} ký tự)...`, 'info');
          const tmpPath = `${outputDir}\\gsovits_chunk_${i}_${Date.now()}.wav`;
          const res = await window.electronAPI?.gptSoVITSSynthesize?.({ text:chunks[i], outputPath:tmpPath, refAudioPath:gsvRefAudio, refText:gsvRefText, lang:gsvLang, speed:gsvSpeed });
          if (res?.success) {
            parts.push(res.path||tmpPath);
            addLog(`✅ Đoạn ${i+1}/${chunks.length} xong`, 'success');
          } else {
            addLog(`⚠️ Đoạn ${i+1}: ${res?.error||'?'}`, 'warn');
          }
          setAudioProgress({ done:i+1, total:chunks.length });
        }
        if (typeof unsubGsvLog === 'function') unsubGsvLog();
        if (!parts.length) throw new Error('GPT-SoVITS không tạo được audio');
        setTtsStatus(`🔧 Ghép ${parts.length} đoạn...`);
        const mergedPath = `${outputDir}\\story_gsovits_${Date.now()}.wav`;
        const concatRes = await window.electronAPI?.concatWavFiles({ files:parts, outputPath:mergedPath, deleteAfter:true });
        audioPath = concatRes?.success ? concatRes.path : parts[parts.length-1];
        addLog(`✅ GPT-SoVITS xong`, 'success');
      }

      if (audioPath) setAudioFile({ path:audioPath, name:audioPath.split(/[\\/]/).pop() });

      // Transcribe → SRT (nếu không phải Edge TTS)
      if (audioPath && !srtContent && ttsEngine !== 'edge' && keys.length) {
        addLog('🗜️ Nén audio trước khi gửi Gemini...', 'info');
        let base64Data, mimeType;
        const compressed = await window.electronAPI?.compressAudioForTranscribe?.({ inputPath:audioPath });
        if (compressed?.success) {
          base64Data = compressed.base64; mimeType = 'audio/mpeg';
          addLog(`📦 Đã nén: ${(compressed.size/1024/1024).toFixed(1)} MB`, 'info');
        } else {
          base64Data = await window.electronAPI?.readFileBase64(audioPath);
          const ext = audioPath.split('.').pop().toLowerCase();
          mimeType = { mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4' }[ext] || 'audio/mpeg';
        }
        addLog('🎧 Transcribe audio → SRT...', 'info');
        try {
          const segs = await transcribeAudio(async (key) => {
            const ai = new GoogleGenAI({ apiKey:key });
            const res = await ai.models.generateContent({
              model: loadGeminiModel(),
              contents: [{ role:'user', parts:[{ inlineData:{ mimeType, data:base64Data } },{ text:'Transcribe this audio into SRT subtitle format with accurate timestamps. Output ONLY valid SRT format.' }] }],
              config: { maxOutputTokens:8192 },
            });
            return res?.text || '';
          }, keys);
          if (segs?.length) {
            srtContent = segs.map((s,i) => `${i+1}\n${secondsToSRT(s.start)} --> ${secondsToSRT(s.end)}\n${s.text.trim()}\n`).join('\n');
            addLog(`✅ SRT chính xác: ${segs.length} cue`, 'success');
          }
        } catch (e) { addLog(`⚠️ Transcribe lỗi: ${e.message}`, 'warn'); }
      }

      if (srtContent) {
        const srtPath = audioPath?.replace(/\.[^.]+$/, '_transcribed.srt');
        if (srtPath) await window.electronAPI?.writeFile({ path:srtPath, content:srtContent });
        setSrtFile({ path:srtPath||'', content:srtContent, name:(srtPath||'subtitles.srt').split(/[\\/]/).pop() });
        addLog(`✅ SRT: ${(srtPath||'').split(/[\\/]/).pop()}`, 'success');
      }

      addLog('✅ Phase 2 xong — chuyển sang Dựng Video', 'success');
      setPhase(3);
    } catch (e) { addLog(`❌ ${e.message}`, 'error'); setCreatingAudio(false); setTtsStatus(''); setAudioProgress({ done:0, total:0 }); throw e; }
    setCreatingAudio(false); setTtsStatus(''); setAudioProgress({ done:0, total:0 });
  };

  // ─── Build video ──────────────────────────────────────────────────────────
  // ─── Chạy tất cả: Viết truyện → Tạo Audio + SRT ─────────────────────────
  const [runAllStep, setRunAllStep] = useState(''); // '' | 'writing' | 'audio' | 'done'
  const handleRunAll = async () => {
    if (storyMode === 'upload') { addLog('❌ Chế độ Upload không hỗ trợ chạy tất cả', 'error'); return; }
    stopRef.current = false; ttsAbortRef.current = false;
    let textToUse = storyText.trim();

    if (storyMode === 'create' || storyMode === 'rewrite') {
      const keys = loadKeys();
      if (!keys.length) { addLog('❌ Cần Gemini API key', 'error'); return; }
      setRunAllStep('writing');
      addLog('🚀 [1/2] Viết truyện...', 'success');
      const generated = await handleWriteStory();
      if (!generated) { setRunAllStep(''); addLog('⛔ Dừng — viết truyện thất bại', 'error'); return; }
      if (stopRef.current) { setRunAllStep(''); addLog('⛔ Dừng bởi người dùng', 'warn'); return; }
      // Dùng narrator script (đã được set trong handleWriteStory)
      textToUse = buildNarratorScript(generated);
    } else if (storyMode === 'paste') {
      // Paste mode: làm sạch text đã dán
      textToUse = buildNarratorScript(storyText);
    }

    setRunAllStep('audio');
    addLog('🚀 [2/2] Tạo Audio + SRT...', 'success');
    try {
      await handleCreateAudio(textToUse);
    } catch (e) {
      setRunAllStep('');
      addLog(`⛔ Dừng — tạo audio thất bại: ${e.message}`, 'error');
      return;
    }
    setRunAllStep('done');
    addLog('✅ Hoàn tất tất cả! Chuyển sang Dựng Video.', 'success');
    setPhase(3);
  };

  const handleBuildVideo = async () => {
    if (!audioFile?.path) { addLog('❌ Cần audio trước', 'error'); return; }
    const bgPath = bgFolder?.path ? '__bg_folder__' : bgVideoFile?.path || null;
    if (!bgPath) { addLog('❌ Cần chọn video nền hoặc thư mục nền', 'error'); return; }
    addLog('🚀 Chạy dựng video...', 'success');
    await runComposite(bgPath, audioFile.path, srtFile?.content || null);
  };

  const runComposite = async (bgPathArg, audioPath, srtContent) => {
    setCompositeStatus('compositing');
    const tempFiles = [];
    const outputDir = await window.electronAPI?.joinDownloadsPath('MCStudio') || 'MCStudio';
    try {
      let bgPath = bgPathArg;
      if (bgPath === '__bg_folder__' && bgFolder?.path) {
        addLog('📁 Ghép video nền ngẫu nhiên từ thư mục...', 'info');
        const res = await window.electronAPI?.concatRandomBg({ folderPath:bgFolder.path, audioPath, outputPath: audioPath.replace(/(\.[^.]+)$/, '_bgconcat.mp4') });
        if (!res?.success) { addLog(`❌ Ghép nền thất bại: ${res?.error}`, 'error'); setCompositeStatus('idle'); return; }
        bgPath = res.outputPath; tempFiles.push(bgPath);
        addLog(`✅ Ghép ${res.count} video nền xong`, 'success');
      }

      addLog('🔁 Loop video nền khớp độ dài audio...');
      const loopedPath = bgPath.replace(/(\.[^.]+)$/, '_looped$1');
      const loopRes = await window.electronAPI?.ffmpegLoopVideo({ videoPath:bgPath, audioPath, outputPath:loopedPath });
      let finalBgPath = bgPath;
      if (loopRes?.success && loopRes.outputPath) { finalBgPath = loopRes.outputPath; tempFiles.push(finalBgPath); addLog(`✅ Loop xong`); }
      else addLog(`⚠️ Loop lỗi — dùng video gốc`, 'warn');

      let sceneVideoPath = sceneVideo?.path || null;
      if (sceneFolder?.path) {
        addLog('🎞️ Chuẩn bị scene video...');
        const sc = await window.electronAPI?.scenePrepareVideo({ folderPath:sceneFolder.path, outputFolder:outputDir, audioPath });
        if (sc?.success) { sceneVideoPath = sc.videoPath; tempFiles.push(sceneVideoPath); addLog(`✅ Scene xong: ${sc.pickedName}`, 'success'); }
        else addLog(`⚠️ Scene lỗi: ${sc?.error}`, 'warn');
      } else if (sceneVideo?.path) {
        sceneVideoPath = sceneVideo.path;
      }

      addLog('🎬 Composite video hoàn chỉnh...');
      const finalPath = `${outputDir}\\mc_final_v1_${Date.now()}.mp4`;
      const res = await window.electronAPI?.mcCompositeVideo({
        bgVideoPath: finalBgPath,
        audioPath,
        mcClips: [],
        emotionTimeline: [{ emotionId:0, start:0, end:9999 }],
        mcWidthPct, mcPosX:mcPos.x, mcPosY:mcPos.y,
        mcStaticPath:null, mcStaticIsVideo:false, mcDisabled:true,
        sceneVideoPath,
        sceneImagePath: sceneImage?.path || null,
        sceneWidthPct, sceneVideoPosX:scenePos.x, sceneVideoPosY:scenePos.y,
        logoPath: logoFile?.path || null,
        logoSize, logoPosX:logoPos.x, logoPosY:logoPos.y,
        channelName: channelName.trim(),
        chNameOpacity, chNameFontSize,
        chNameColor: chNameColor.replace('#',''),
        chNamePosX:chNamePos.x, chNamePosY:chNamePos.y,
        mcVariant: 1,
        outputPath: finalPath,
        videoEffect, mcFrameStyle, sceneFrameStyle,
        subtitleEnabled: subtitleEnabled && !!(srtContent || srtFile?.content),
        subtitleSRT: srtContent || srtFile?.content || '',
        subtitlePosY: subtitlePos.y,
        subtitleBoxW, subtitleFontSize,
        subtitleColor, subtitleBg, subtitleStroke,
        subAnimation, subtitlePreset,
        showWaveform, waveStyle, waveWidthPct, waveHeightPct,
        grainNoise: filmGrain, grainLevel,
        outputAspect,
        muteBg: true,
      });

      if (res?.success) {
        setFinalVideo(res.outputPath);
        addLog(`✅ Hoàn tất: ${res.outputPath.split(/[\\/]/).pop()}`, 'success');
        if (srtContent) {
          const base = res.outputPath.split(/[\\/]/).pop().replace(/(\.[^.]+)$/,'');
          const dir  = res.outputPath.replace(/[\\/][^\\/]+$/,'');
          await window.electronAPI?.writeFile({ path:`${dir}\\${base}.srt`, content:srtContent });
          addLog(`📄 SRT lưu: ${base}.srt`, 'success');
        }
        setCompositeStatus('done');
        addLog('🗑️ Dọn dẹp file trung gian...');
        for (const f of tempFiles) { try { await window.electronAPI?.deleteFile(f); } catch {} }
        addLog('📝 Tự động tạo SEO & Thumbnail...', 'info');
        setPhase(4);
        await handleAutoSEO(res.outputPath.replace(/[\\/][^\\/]+$/,''));
      } else {
        addLog(`❌ Composite lỗi: ${res?.error}`, 'error');
        setCompositeStatus('idle');
        for (const f of tempFiles) { try { await window.electronAPI?.deleteFile(f); } catch {} }
      }
    } catch (e) {
      addLog(`❌ ${e.message}`, 'error');
      setCompositeStatus('idle');
      for (const f of tempFiles) { try { await window.electronAPI?.deleteFile(f); } catch {} }
    }
  };

  // ─── Auto SEO ─────────────────────────────────────────────────────────────
  const handleAutoSEO = async (outputDir) => {
    const keys = loadKeys();
    if (!keys.length) { setSeoData({ error:'Chưa có Gemini API key.' }); setSeoStatus('done'); return; }
    const content = srtFile?.content || storyText || '';
    if (!content) { setSeoData({ error:'Chưa có nội dung kịch bản.' }); setSeoStatus('done'); return; }
    setSeoStatus('loading'); setSeoData(null);
    try {
      const langMap = { 'tiếng việt':'vi', vietnamese:'vi', english:'en', 'tiếng anh':'en', japanese:'ja', korean:'ko', chinese:'zh', 'tiếng trung':'zh' };
      const lang = langMap[(storyLang||'').toLowerCase()] || 'vi';
      const textForSeo = content.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->')).join(' ').slice(0,4000);
      const result = await generateSeoMetadata(keys, textForSeo, lang, channelName||'Kênh của tôi', null, null);
      const ti = result?.thumbnailPrompts?.[0] || {};
      const data = {
        titles: (result?.titles||[]).map(t => typeof t==='object'?t.title:t).filter(Boolean),
        description: result?.description || '',
        tags: result?.tags || '',
        thumbText: ti.overlayText||'',
        thumbPromptWithText: ti.promptWithText||'',
        thumbPromptNoText:   ti.promptWithoutText||'',
      };
      setSeoData(data); setSeoStatus('done');
      if (outputDir) {
        const lines = ['=== TIÊU ĐỀ VIDEO ===', ...data.titles.map((t,i)=>`${i+1}. ${t}`), '', '=== CHỮ TRÊN THUMBNAIL ===', data.thumbText, '', '=== MÔ TẢ SEO ===', data.description, '', '=== TAGS ===', data.tags, '', '=== THUMBNAIL PROMPT (CÓ CHỮ) ===', data.thumbPromptWithText, '', '=== THUMBNAIL PROMPT (KHÔNG CHỮ) ===', data.thumbPromptNoText].join('\n');
        await window.electronAPI?.writeFile({ path:`${outputDir}\\seo_${Date.now()}.txt`, content:lines });
        addLog('✅ SEO đã lưu file', 'success');
      }
    } catch (e) { setSeoData({ error:e.message }); setSeoStatus('done'); addLog(`⚠️ SEO lỗi: ${e.message}`, 'warn'); }
  };

  // ─── Drag callbacks (memoized) ────────────────────────────────────────────
  const onDragMC       = useCallback(p => setMcPos(p),        []);
  const onDragScene    = useCallback(p => setScenePos(p),     []);
  const onDragLogo     = useCallback(p => setLogoPos(p),      []);
  const onDragChName   = useCallback(p => setChNamePos(p),    []);
  const onDragSubtitle = useCallback(p => setSubtitlePos(p),  []);

  // ─────────────────────────────────────────────────────────────────────────
  const PHASES = [
    { id:1, label:'⚙️ Cài đặt'   },
    { id:2, label:'🎙️ Tạo Audio' },
    { id:3, label:'🎬 Dựng Video' },
    { id:4, label:'📊 SEO'        },
  ];

  return (
    <div className="flex w-full h-full bg-[#0a0f1e] text-slate-200 text-[11px] overflow-hidden">

      {/* ══ LEFT PANEL — settings ════════════════════════════════════════════ */}
      <div className="flex flex-col w-[360px] shrink-0 border-r border-slate-800/60 overflow-hidden bg-[#0d1424]">

        {/* ── Project preset bar ── */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 shrink-0 bg-[#0a1120] border-b border-slate-800/80">
          {/* Dropdown chọn dự án */}
          <select value={projectName}
            onChange={e => { if (e.target.value) loadProject(e.target.value); else { setProjectName(''); setProjectDirty(false); } }}
            className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:outline-none focus:border-indigo-500 truncate">
            <option value="">📁 Chọn dự án...</option>
            {Object.keys(projects).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {/* Input tên dự án mới */}
          <input value={projectName} onChange={e => { setProjectName(e.target.value); setProjectDirty(true); }}
            placeholder="Tên dự án..."
            className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
          />
          {/* Lưu */}
          <button onClick={() => { if (!projectName.trim()) { alert('Nhập tên dự án trước!'); return; } saveProject(projectName); }}
            title="Lưu cài đặt hiện tại vào dự án này"
            className={`px-2 py-1 rounded text-[10px] font-bold transition border ${projectDirty ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500' : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'}`}>
            💾
          </button>
          {/* Xóa */}
          {projectName && projects[projectName] && (
            <button onClick={() => { if (confirm(`Xóa dự án "${projectName}"?`)) deleteProject(projectName); }}
              title="Xóa dự án này"
              className="px-2 py-1 rounded text-[10px] font-bold bg-red-900/30 hover:bg-red-800/50 text-red-400 border border-red-800/30 transition">
              🗑
            </button>
          )}
        </div>

        {/* Phase tabs */}
        <div className="flex shrink-0 bg-slate-900 border-b border-slate-800">
          {PHASES.map(p => (
            <button key={p.id} onClick={() => setPhase(p.id)}
              className={`flex-1 py-2.5 text-[10px] font-bold transition border-b-2 ${phase===p.id ? 'border-indigo-500 bg-slate-800 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Status pills */}
        <div className="flex gap-1.5 px-3 py-1.5 shrink-0 border-b border-slate-800 bg-slate-900/40">
          {[{ l:'Kịch bản', ok:!!storyText },{ l:'Audio', ok:!!audioFile },{ l:'SRT', ok:!!srtFile }].map(({ l, ok }) => (
            <span key={l} className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium ${ok ? 'bg-green-900/50 text-green-400' : 'bg-slate-800 text-slate-600'}`}>
              {ok ? '✓' : '—'} {l}
            </span>
          ))}
        </div>

        {/* Phase content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* ════ PHASE 1 — CÀI ĐẶT ════════════════════════════════════ */}
          {phase === 1 && <>

            <Section title="📁 Video & Xuất" titleCls="text-teal-400">
              <div className="grid grid-cols-3 gap-1">
                <button onClick={pickBgVideo}  className={`py-1.5 rounded text-[10px] transition ${bgVideoFile ? 'bg-teal-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>🎬 File nền</button>
                <button onClick={pickBgFolder} className={`py-1.5 rounded text-[10px] transition ${bgFolder    ? 'bg-teal-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>📂 Thư mục nền</button>
                <button onClick={pickSceneImg} className={`py-1.5 rounded text-[10px] transition ${sceneImage  ? 'bg-amber-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>🖼️ Ảnh tĩnh</button>
              </div>
              {(bgVideoFile||bgFolder) && (
                <div className="flex items-center gap-1 text-teal-400 text-[9px]">
                  <span className="truncate flex-1">{bgVideoFile?.name||bgFolder?.name}</span>
                  <button onClick={() => { setBgVideoFile(null); setBgFolder(null); }} className="text-slate-500 hover:text-red-400">✕</button>
                </div>
              )}
              {sceneImage && (
                <div className="flex items-center gap-1 text-amber-400 text-[9px]">
                  <span className="truncate flex-1">{sceneImage.name}</span>
                  <button onClick={() => setSceneImage(null)} className="text-slate-500 hover:text-red-400">✕</button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 shrink-0">Tỉ lệ:</span>
                {['16:9','9:16'].map(v => (
                  <button key={v} onClick={() => { setOutputAspect(v); localStorage.setItem('mc_output_aspect',v); }}
                    className={`px-3 py-1 rounded text-[10px] transition ${outputAspect===v ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>{v}</button>
                ))}
              </div>
            </Section>

            <Section title="✨ Hiệu ứng cảnh động" titleCls="text-pink-400">
              <div className="flex gap-1 flex-wrap">
                {[['none','Không'],['frame','Khung trắng'],['glow','Glow vàng'],['color','Màu sắc'],['dark','Tối dần']].map(([v,l]) => (
                  <TBtn key={v} active={videoEffect===v} onClick={() => setVideoEffect(v)}>{l}</TBtn>
                ))}
              </div>
            </Section>

            <Section title="🖼️ Khung viên cảnh động" titleCls="text-orange-400">
              <div className="flex gap-1 flex-wrap">
                {[['none','Không'],['frame','Khung viên'],['glow','Glow'],['neon','Neon']].map(([v,l]) => (
                  <TBtn key={v} active={sceneFrameStyle===v} onClick={() => setSceneFrameStyle(v)}>{l}</TBtn>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 shrink-0">Cảnh: {sceneWidthPct}%</span>
                <input type="range" min={10} max={90} value={sceneWidthPct} onChange={e => setSceneWidthPct(+e.target.value)} className="flex-1 accent-orange-500" />
              </div>
            </Section>

            <Section title="🎵 Sóng âm thanh" titleCls="text-pink-400">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500">Hiển thị sóng âm</span>
                <button onClick={() => setShowWaveform(v => !v)}
                  className={`px-2.5 py-0.5 rounded text-[9px] font-bold transition ${showWaveform ? 'bg-pink-700 text-white' : 'bg-slate-700 text-slate-500'}`}>
                  {showWaveform ? 'ON' : 'OFF'}
                </button>
              </div>
              {showWaveform && <>
                <div className="flex gap-1 flex-wrap">
                  {[['bars','📊 Bars'],['mirror','📀 Mirror'],['line','📈 Line'],['wave','〰️ Wave'],['dots','⚫ Dots'],['fill','🌊 Fill'],['circle','🔵 Circle']].map(([v,l]) => (
                    <TBtn key={v} active={waveStyle===v} onClick={() => setWaveStyle(v)}>{l}</TBtn>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">↔ Rộng: {waveWidthPct}%</div>
                    <input type="range" min={20} max={100} value={waveWidthPct} onChange={e => setWaveWidthPct(+e.target.value)} className="w-full accent-pink-500" />
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">↕ Cao: {waveHeightPct}%</div>
                    <input type="range" min={2} max={20} value={waveHeightPct} onChange={e => setWaveHeightPct(+e.target.value)} className="w-full accent-pink-500" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={filmGrain} onChange={e => setFilmGrain(e.target.checked)} className="accent-yellow-400 w-3 h-3" />
                    <span className="text-[9px]">🎞️ Film Grain</span>
                  </label>
                  {filmGrain && <>
                    <input type="range" min={1} max={20} value={grainLevel} onChange={e => setGrainLevel(+e.target.value)} className="flex-1 accent-yellow-400" />
                    <span className="text-[9px] text-slate-400">{grainLevel}</span>
                  </>}
                </div>
              </>}
            </Section>

            <Section title="✏️ Hiệu ứng phụ đề" titleCls="text-yellow-400">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500">Phụ đề SRT</span>
                <button onClick={() => setSubtitleEnabled(v => !v)}
                  className={`px-2.5 py-0.5 rounded text-[9px] font-bold transition ${subtitleEnabled ? 'bg-yellow-700 text-white' : 'bg-slate-700 text-slate-500'}`}>
                  {subtitleEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              {subtitleEnabled && <>
                <div className="flex gap-1 flex-wrap">
                  {[['classic','Classic'],['bold','Đậm'],['neon','Neon'],['cinematic','Điện ảnh']].map(([v,l]) => (
                    <TBtn key={v} active={subtitlePreset===v} onClick={() => setSubtitlePreset(v)}>{l}</TBtn>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[['none','Không'],['fade','Fade in/out'],['slide','Slide up'],['glow','Glow']].map(([v,l]) => (
                    <TBtn key={v} active={subAnimation===v} onClick={() => setSubAnimation(v)}>{l}</TBtn>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-500 shrink-0">Cỡ chữ:</span>
                  {[['small','S'],['medium','M'],['large','L']].map(([v,l]) => (
                    <SzBtn key={v} value={v} current={subtitleFontSize} onChange={setSubtitleFontSize} label={l} />
                  ))}
                  <input type="color" value={subtitleColor} onChange={e => setSubtitleColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0" title="Màu chữ" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={subtitleBg} onChange={e => setSubtitleBg(e.target.checked)} className="accent-green-500 w-3 h-3" />
                    <span className="text-[9px]">Nền mờ (hộp đen)</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={subtitleStroke} onChange={e => setSubtitleStroke(e.target.checked)} className="accent-green-500 w-3 h-3" />
                    <span className="text-[9px]">Viền chữ đen</span>
                  </label>
                </div>
                <div className="text-[9px] text-slate-600 italic">💡 Bấm ▶ góc phải canvas để xem sync phụ đề</div>
              </>}
            </Section>

            <Section title="📺 Tên kênh" titleCls="text-blue-400">
              <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="Nhập tên kênh..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-500" />
              <div className="flex items-center gap-2 flex-wrap">
                <input type="color" value={chNameColor} onChange={e => setChNameColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0" title="Màu tên kênh" />
                {[['small','S'],['medium','M'],['large','L']].map(([v,l]) => (
                  <SzBtn key={v} value={v} current={chNameFontSize} onChange={setChNameFontSize} label={l} />
                ))}
                <span className="text-[9px] text-slate-500 ml-auto">Độ mờ:</span>
                <input type="range" min={0} max={100} value={chNameOpacity} onChange={e => setChNameOpacity(+e.target.value)} className="w-20 accent-blue-500" />
                <span className="text-[9px] text-slate-400">{chNameOpacity}%</span>
              </div>
            </Section>

            <Section title="🖼️ Logo" titleCls="text-yellow-400">
              <div className="flex items-center gap-2">
                <button onClick={pickLogo} className={`px-3 py-1.5 rounded text-[10px] transition ${logoFile ? 'bg-yellow-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                  {logoFile ? `🖼️ ${logoFile.name.slice(0,18)}` : '🖼️ Chọn logo'}
                </button>
                {logoFile && <button onClick={() => setLogoFile(null)} className="text-slate-500 hover:text-red-400">✕</button>}
              </div>
              {logoFile && (
                <div className="flex gap-1">
                  {[['small','S'],['medium','M'],['large','L'],['xlarge','XL']].map(([v,l]) => (
                    <SzBtn key={v} value={v} current={logoSize} onChange={setLogoSize} label={l} />
                  ))}
                </div>
              )}
            </Section>

            <button onClick={() => setPhase(2)} className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition">
              Tiếp theo → Tạo Audio
            </button>
          </>}

          {/* ════ PHASE 2 — TẠO AUDIO ══════════════════════════════════ */}
          {phase === 2 && <>

            {/* ── NÚT CHẠY TẤT CẢ ── */}
            {storyMode !== 'upload' && (
              <div className="relative">
                <button
                  onClick={handleRunAll}
                  disabled={isGen || creatingAudio || runAllStep !== ''}
                  className={`w-full py-3 rounded-xl font-bold text-[13px] transition shadow-lg
                    ${(isGen || creatingAudio || runAllStep !== '')
                      ? 'bg-slate-700 text-slate-400 cursor-wait'
                      : 'bg-gradient-to-r from-violet-600 via-indigo-600 to-teal-600 hover:from-violet-500 hover:via-indigo-500 hover:to-teal-500 text-white'}`}>
                  {runAllStep === 'writing' ? `⏳ [1/2] Đang viết truyện...`
                    : runAllStep === 'audio' ? `⏳ [2/2] Đang tạo audio...`
                    : '🚀 Bắt đầu Tất Cả — Viết Truyện → Audio → SRT'}
                </button>
                {(isGen || creatingAudio) && runAllStep !== '' && (
                  <button onClick={() => { stopRef.current = true; ttsAbortRef.current = true; }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-red-300 text-[10px]">⏹</button>
                )}
                {storyMode === 'paste' && (
                  <div className="text-[9px] text-slate-500 text-center mt-1">Chế độ Dán text: bỏ qua viết truyện, tạo audio từ text đã dán</div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 text-[9px] text-slate-600">
              <div className="flex-1 border-t border-slate-800" />
              <span>hoặc chạy từng bước bên dưới</span>
              <div className="flex-1 border-t border-slate-800" />
            </div>

            {/* ── Gemini Model ── */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[9px] text-slate-500 shrink-0">Model:</span>
              <select value={geminiModel} onChange={e => { setGeminiModel(e.target.value); localStorage.setItem(LS_GEMINI_MODEL, e.target.value); }}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-500">
                {GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>

            {/* ── Mode: Tự sáng tác / Viết lại YTB / Dán text / Upload audio ── */}
            <div className="flex gap-1">
              {[['create','✏️ Tự sáng tác'],['rewrite','📺 Viết lại YTB'],['paste','📋 Dán text'],['upload','📂 Audio']].map(([v,l]) => (
                <button key={v} onClick={() => setStoryMode(v)}
                  className={`flex-1 py-1.5 rounded text-[9px] font-bold transition ${storyMode===v ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-500 hover:bg-slate-600'}`}>{l}</button>
              ))}
            </div>

            {/* ── Create / Rewrite: thông tin truyện ── */}
            {(storyMode === 'create' || storyMode === 'rewrite') && <>
              {storyMode === 'rewrite' && (
                <div className="space-y-1">
                  <input value={ytRewriteUrl} onChange={e => setYtRewriteUrl(e.target.value)}
                    placeholder="URL video YouTube cần viết lại..."
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-purple-500" />
                  <button onClick={handleAnalyzeYt} disabled={isAnalyzing || !ytRewriteUrl.trim()}
                    className={`w-full py-1.5 rounded text-[9px] font-bold transition ${isAnalyzing ? 'bg-purple-900 text-purple-400 animate-pulse' : 'bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-40'}`}>
                    {isAnalyzing ? '⏳ Đang phân tích...' : '🔍 Phân tích video → Tự điền thông tin'}
                  </button>
                  {analyzed && <div className="text-[9px] text-green-400 bg-green-900/20 rounded px-2 py-1">✅ Đã phân tích: {analyzed.title?.slice(0,40)}</div>}
                </div>
              )}

              {/* Tiêu đề */}
              <input value={storyTitle} onChange={e => setStoryTitle(e.target.value)} placeholder="Tiêu đề truyện (tuỳ chọn)..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-indigo-500" />

              {/* Thể loại + Phong cách */}
              <div className="grid grid-cols-2 gap-1">
                <select value={storyGenre} onChange={e => setStoryGenre(e.target.value)}
                  className="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-indigo-500">
                  {AUDIO_GENRES.map(g => <option key={g}>{g}</option>)}
                </select>
                <select value={storyTone} onChange={e => setStoryTone(e.target.value)}
                  className="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-indigo-500">
                  {AUDIO_TONES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              {/* Ngôn ngữ */}
              <select value={storyLang} onChange={e => setStoryLang(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-indigo-500">
                {AUDIO_LANGS.map(l => <option key={l}>{l}</option>)}
              </select>

              {/* Độ dài mục tiêu */}
              <div>
                <div className="text-[9px] text-slate-500 mb-1">Độ dài mục tiêu</div>
                <div className="grid grid-cols-4 gap-1 mb-1">
                  {AUDIO_TARGETS.map(t => (
                    <button key={t.value} onClick={() => { setTargetChars(t.value); setCustomChars(''); }}
                      className={`py-1.5 rounded text-[10px] font-bold transition ${targetChars===t.value && !customChars ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <input value={customChars} onChange={e => setCustomChars(e.target.value)} placeholder="Tuỳ chỉnh (VD: 120000)"
                  className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-amber-500" />
                <div className="text-[8px] text-slate-600 mt-0.5">
                  {(() => {
                    const eff = customChars ? parseInt(customChars)||targetChars : targetChars;
                    const chaps = Math.max(3, Math.ceil(eff / CHARS_PER_CHUNK));
                    return `${chaps} chương · ~${(eff/1000).toFixed(0)}K ký tự`;
                  })()}
                </div>
              </div>

              {/* Tóm tắt */}
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={2}
                placeholder="Tóm tắt ý tưởng câu chuyện (để trống để AI tự sáng tác)..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[10px] resize-none focus:outline-none focus:border-purple-500" />

              {/* Story progress */}
              {isGen && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-purple-300">
                    <span>{storyPhase === 'outline' ? '📖 Tạo outline...' : `✏️ Chương ${storyProgress.chapter}/${storyProgress.totalChapters}`}</span>
                    <span>{storyProgress.total > 0 ? `${(storyProgress.done/1000).toFixed(1)}K / ${(storyProgress.total/1000).toFixed(0)}K` : ''}</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1">
                    <div className="bg-purple-500 h-1 rounded-full transition-all" style={{ width:`${storyProgress.total > 0 ? Math.min(100, storyProgress.done/storyProgress.total*100) : 0}%` }} />
                  </div>
                </div>
              )}
              {storyError && <div className="text-[9px] text-red-400 bg-red-900/20 rounded px-2 py-1">{storyError}</div>}

              <div className="flex gap-1">
                <button onClick={handleWriteStory} disabled={isGen}
                  className={`flex-1 py-2 rounded-xl font-bold text-[11px] transition ${isGen ? 'bg-purple-900 text-purple-300 cursor-wait animate-pulse' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}>
                  {isGen ? `⏳ ${storyPhase === 'outline' ? 'Tạo outline...' : `Viết ch.${storyProgress.chapter}...`}` : '✨ Viết Truyện Ngay'}
                </button>
                {isGen && <button onClick={() => { stopRef.current = true; }} className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-red-800 text-[10px]">⏹</button>}
              </div>

              {/* Story text preview */}
              {storyText && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] text-slate-500">📝 Truyện gốc · {storyText.length.toLocaleString()} ký tự</span>
                    <button onClick={() => { setStoryText(''); setNarratorScript(''); }} className="text-[9px] text-slate-600 hover:text-red-400">✕ Xóa</button>
                  </div>
                  <textarea ref={storyRef} value={storyText} onChange={e => setStoryText(e.target.value)} rows={4}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[10px] resize-none focus:outline-none focus:border-purple-500 font-mono" />
                </div>
              )}

              {/* Narrator script (kịch bản người đọc) */}
              {narratorScript && (
                <div className="border border-emerald-800/50 rounded-lg p-2 bg-emerald-950/20">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-bold text-emerald-400">🎙️ Kịch bản người đọc · {narratorScript.length.toLocaleString()} ký tự</span>
                    <div className="flex gap-1">
                      <button onClick={() => { const ns = buildNarratorScript(storyText||narratorScript); setNarratorScript(ns); addLog('🔄 Đã tạo lại kịch bản người đọc', 'info'); }}
                        className="text-[9px] text-slate-500 hover:text-emerald-400 transition">↺ Tạo lại</button>
                      <button onClick={() => setNarratorScript('')} className="text-[9px] text-slate-600 hover:text-red-400">✕</button>
                    </div>
                  </div>
                  <textarea value={narratorScript} onChange={e => setNarratorScript(e.target.value)} rows={5}
                    className="w-full bg-slate-900 border border-emerald-800/30 rounded px-2 py-1.5 text-[10px] resize-none focus:outline-none focus:border-emerald-500 font-mono" />
                  <div className="text-[8px] text-emerald-700 mt-1">💡 TTS sẽ dùng kịch bản này thay vì truyện gốc. Có thể sửa trực tiếp.</div>
                </div>
              )}

              {/* Nút tạo narrator script thủ công (khi có truyện nhưng chưa có narrator) */}
              {storyText && !narratorScript && !isGen && (
                <button onClick={() => { const ns = buildNarratorScript(storyText); setNarratorScript(ns); addLog(`📖 Kịch bản người đọc: ${ns.length.toLocaleString()} ký tự`, 'success'); }}
                  className="w-full py-1.5 rounded bg-emerald-800/40 hover:bg-emerald-700/50 text-emerald-300 text-[10px] font-bold border border-emerald-800/30 transition">
                  📖 Tạo Kịch Bản Người Đọc
                </button>
              )}
            </>}

            {/* ── Paste text ── */}
            {storyMode === 'paste' && (
              <textarea value={storyText} onChange={e => setStoryText(e.target.value)} rows={10}
                placeholder="Dán văn bản truyện vào đây..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] resize-none focus:outline-none focus:border-indigo-500" />
            )}

            {/* ── Upload audio ── */}
            {storyMode === 'upload' && (
              <div className="space-y-2">
                <button onClick={pickAudio} className={`w-full py-2 rounded-xl text-[11px] font-bold transition ${audioFile ? 'bg-teal-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                  {audioFile ? `✅ ${audioFile.name}` : '📂 Chọn file audio sẵn có'}
                </button>
                {audioFile && (
                  <button onClick={() => setPhase(3)} className="w-full py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-[11px] transition">
                    Tiếp → Dựng Video
                  </button>
                )}
              </div>
            )}

            {/* ── TTS Engine (hiện khi có text) ── */}
            {storyMode !== 'upload' && <>
              <div className="border-t border-slate-800 pt-2">
                <Section title="🎙️ Engine TTS" titleCls="text-emerald-400">
                  <div className="grid grid-cols-2 gap-1">
                    {[['edge','Edge TTS','bg-emerald-600'],['gemini','Gemini TTS','bg-purple-600'],['vieneu','VieNeu','bg-blue-600'],['gptsovits','GPT-SoVITS','bg-pink-600']].map(([e,l,cls]) => (
                      <button key={e} onClick={() => changeTtsEngine(e)} disabled={creatingAudio}
                        className={`py-1.5 rounded text-[10px] font-bold transition ${ttsEngine===e ? cls+' text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>{l}</button>
                    ))}
                  </div>
                  {ttsEngine === 'edge' && (
                    <select value={ttsVoice} onChange={e => { setTtsVoice(e.target.value); localStorage.setItem('mc_studio_tts_voice', e.target.value); }} disabled={creatingAudio}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-500">
                      {MC_EDGE_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  )}
                  {ttsEngine === 'gemini' && (
                    <select value={ttsVoice} onChange={e => { setTtsVoice(e.target.value); localStorage.setItem('mc_studio_tts_voice', e.target.value); }} disabled={creatingAudio}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-purple-500">
                      {MC_GEMINI_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  )}
                  {(ttsEngine === 'edge' || ttsEngine === 'gemini') && (
                    <div className="bg-slate-900/60 border border-slate-800 rounded px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 w-12 shrink-0">🎵 Tone</span>
                        <input type="range" min={-12} max={12} step={1} value={ttsPitch} onChange={e => setTtsPitch(+e.target.value)} className="flex-1 accent-indigo-500 h-1" disabled={creatingAudio} />
                        <span className={`text-[10px] font-bold w-8 text-right tabular-nums ${ttsPitch > 0 ? 'text-indigo-400' : ttsPitch < 0 ? 'text-red-400' : 'text-slate-500'}`}>{ttsPitch > 0 ? `+${ttsPitch}` : ttsPitch}st</span>
                        {ttsPitch !== 0 && <button onClick={() => setTtsPitch(0)} className="text-[9px] text-slate-600 hover:text-slate-400">↺</button>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 w-12 shrink-0">⚡ Tốc</span>
                        <input type="range" min={-50} max={50} step={5} value={ttsRate} onChange={e => setTtsRate(+e.target.value)} className="flex-1 accent-blue-500 h-1" disabled={creatingAudio} />
                        <span className={`text-[10px] font-bold w-8 text-right tabular-nums ${ttsRate > 0 ? 'text-blue-400' : ttsRate < 0 ? 'text-orange-400' : 'text-slate-500'}`}>{ttsRate > 0 ? `+${ttsRate}` : ttsRate}%</span>
                        {ttsRate !== 0 && <button onClick={() => setTtsRate(0)} className="text-[9px] text-slate-600 hover:text-slate-400">↺</button>}
                      </div>
                    </div>
                  )}
                  {ttsEngine === 'vieneu' && (
                    <select value={ttsVnVoice} onChange={e => { setTtsVnVoice(e.target.value); localStorage.setItem('mc_studio_tts_vn_voice', e.target.value); }} disabled={creatingAudio}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-blue-500">
                      <option value="">— Giọng mặc định —</option>
                      {vnSavedVoices.length > 0 && <optgroup label="⭐ Giọng Clone">{vnSavedVoices.map(v => <option key={`c_${v.id}`} value={`clone:${v.id}`}>{v.name||v.id}</option>)}</optgroup>}
                      {vnBuiltinVoices?.length > 0 && <optgroup label="🔊 Giọng cố định">{vnBuiltinVoices.map(([desc,id]) => <option key={id} value={id}>{desc}</option>)}</optgroup>}
                    </select>
                  )}
                  {ttsEngine === 'gptsovits' && (
                    <div className="space-y-2">
                      {/* Saved refs */}
                      {gsvRefs.length > 0 && (
                        <select value={gsvSelectedRef} onChange={e => {
                          const id = e.target.value; setGsvSelectedRef(id);
                          const r = gsvRefs.find(x => x.id === id);
                          if (r) { setGsvRefAudio(r.refAudioPath); setGsvRefText(r.refText); setGsvLang(r.lang||'vi'); }
                        }} disabled={creatingAudio} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-pink-500">
                          <option value="">— Chọn giọng đã lưu —</option>
                          {gsvRefs.map(r => <option key={r.id} value={r.id}>{r.name} ({r.lang})</option>)}
                        </select>
                      )}
                      {/* Manual ref audio */}
                      <button onClick={async () => {
                        const r = await window.electronAPI?.showOpenDialog?.({ filters:[{name:'Audio',extensions:['wav','mp3','flac']}], properties:['openFile'] });
                        if (r?.filePaths?.[0]) { setGsvRefAudio(r.filePaths[0]); setGsvSelectedRef(''); }
                      }} disabled={creatingAudio} className={`w-full py-1.5 rounded text-[10px] font-bold transition ${gsvRefAudio ? 'bg-pink-900/40 text-pink-300 border border-pink-700' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                        {gsvRefAudio ? `🎵 ${gsvRefAudio.split(/[\\/]/).pop()}` : '📂 Chọn audio mẫu (WAV/MP3)'}
                      </button>
                      {gsvRefAudio && (
                        <input value={gsvRefText} onChange={e => setGsvRefText(e.target.value)} disabled={creatingAudio}
                          placeholder="Transcript audio mẫu..." className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-pink-500" />
                      )}
                      <div className="flex gap-2">
                        <select value={gsvLang} onChange={e => setGsvLang(e.target.value)} disabled={creatingAudio}
                          className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-pink-500">
                          {[['vi','Tiếng Việt'],['zh','Tiếng Trung'],['en','English'],['ja','日本語'],['ko','한국어']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-400">Speed</span>
                          <input type="range" min={0.5} max={2} step={0.05} value={gsvSpeed} onChange={e => setGsvSpeed(+e.target.value)} disabled={creatingAudio} className="w-16 accent-pink-500 h-1" />
                          <span className="text-[10px] text-pink-400 tabular-nums">{gsvSpeed.toFixed(2)}x</span>
                        </div>
                      </div>
                    </div>
                  )}
                </Section>

                {/* TTS progress */}
                {creatingAudio && audioProgress.total > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] text-slate-400 mb-1">
                      <span>{ttsStatus || `${audioProgress.done}/${audioProgress.total}`}</span>
                      <span>{Math.round(audioProgress.done/audioProgress.total*100)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1">
                      <div className="bg-emerald-500 h-1 rounded-full transition-all" style={{ width:`${audioProgress.total ? audioProgress.done/audioProgress.total*100:0}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex gap-1 mt-2">
                  <button onClick={handleCreateAudio} disabled={creatingAudio || !storyText.trim()}
                    className={`flex-1 py-2 rounded-xl font-bold text-[11px] transition ${creatingAudio ? 'bg-emerald-900 text-emerald-400 cursor-wait animate-pulse' : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
                    {creatingAudio ? '⏳ Đang tạo audio...' : '🎙️ Tạo Audio + SRT'}
                  </button>
                  {creatingAudio && <button onClick={() => { ttsAbortRef.current=true; }} className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-red-800 text-[10px]">⏹</button>}
                </div>

                {(audioFile||srtFile) && (
                  <div className="space-y-0.5 pt-2 border-t border-slate-800">
                    {audioFile && <div className="text-[9px] text-green-400">🎵 {audioFile.name}</div>}
                    {srtFile   && <div className="text-[9px] text-green-400">📄 {srtFile.name}</div>}
                    {audioFile && <button onClick={() => setPhase(3)} className="w-full py-1.5 mt-1 rounded bg-teal-700 hover:bg-teal-600 text-white font-bold text-[10px] transition">Tiếp → Dựng Video →</button>}
                  </div>
                )}
              </div>
            </>}
          </>}

          {/* ════ PHASE 3 — DỰNG VIDEO ══════════════════════════════════ */}
          {phase === 3 && <>
            <div className="space-y-1.5 text-[9px]">
              {[
                [(bgVideoFile||bgFolder), bgVideoFile?.name||bgFolder?.name||'Chưa chọn', 'Video nền'],
                [audioFile, audioFile?.name||'Chưa có', 'Audio'],
                [srtFile,   srtFile?.name||'Không có',  'SRT'],
              ].map(([ok, name, label]) => (
                <div key={label} className={`flex items-center gap-2 ${ok ? 'text-green-400' : label==='SRT' ? 'text-slate-500' : 'text-red-400'}`}>
                  {ok ? '✅' : label==='SRT' ? '○' : '❌'} {label}: <span className="truncate">{name}</span>
                </div>
              ))}
            </div>

            <div className="text-[9px] text-slate-500 bg-slate-900/60 rounded p-2 border border-slate-800">
              Loop → Reup → Chroma key → Composite
            </div>

            {compositeStatus === 'compositing' && (
              <div className="flex items-center gap-2 text-indigo-300 text-[10px] animate-pulse py-2">
                <span className="animate-spin inline-block">⏳</span> Đang xử lý video...
              </div>
            )}

            {compositeStatus === 'done' && finalVideo && (
              <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-3 space-y-1">
                <div className="text-green-400 font-bold">✅ Hoàn tất!</div>
                <div className="text-green-300 text-[10px] truncate">{finalVideo.split(/[\\/]/).pop()}</div>
              </div>
            )}

            <button onClick={handleBuildVideo}
              disabled={compositeStatus==='compositing' || !(bgVideoFile||bgFolder) || !audioFile}
              className={`w-full py-2.5 rounded-xl font-bold text-[12px] transition ${compositeStatus==='compositing' ? 'bg-slate-700 text-slate-400 cursor-wait' : 'bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
              {compositeStatus==='compositing' ? '⏳ Đang dựng...' : '🚀 Dựng Video'}
            </button>

            {!(bgVideoFile||bgFolder) && <div className="text-[9px] text-yellow-500">⚠️ Quay lại Phase 1 để chọn video nền</div>}
            {!audioFile && <div className="text-[9px] text-yellow-500">⚠️ Quay lại Phase 2 để tạo audio</div>}
          </>}

          {/* ════ PHASE 4 — SEO & THUMBNAIL ════════════════════════════ */}
          {phase === 4 && <>
            {seoStatus === 'loading' && <div className="flex items-center gap-2 text-purple-300 text-[10px] animate-pulse py-2"><span className="animate-spin">⏳</span> Đang tạo SEO...</div>}
            {seoData?.error && <div className="text-red-400 text-[10px] bg-red-900/20 rounded p-2">{seoData.error}</div>}
            {seoData && !seoData.error && <>
              {seoData.titles?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] font-bold text-yellow-400 uppercase">🎯 Tiêu đề</div>
                  {seoData.titles.map((t,i) => (
                    <div key={i} className="bg-slate-900 rounded p-2 text-[10px] text-slate-200 border border-slate-800">
                      <span className="text-slate-500 mr-1">{i+1}.</span>{t}
                    </div>
                  ))}
                </div>
              )}
              {seoData.thumbText && <>
                <div className="text-[9px] font-bold text-pink-400 uppercase">🎨 Chữ Thumbnail</div>
                <div className="bg-slate-900 rounded p-2 text-[10px] text-slate-200 border border-slate-800">{seoData.thumbText}</div>
              </>}
              {seoData.description && <>
                <div className="text-[9px] font-bold text-blue-400 uppercase">📝 Mô tả SEO</div>
                <div className="bg-slate-900 rounded p-2 text-[10px] text-slate-400 border border-slate-800 whitespace-pre-wrap max-h-28 overflow-y-auto">{seoData.description}</div>
              </>}
              {seoData.tags && <>
                <div className="text-[9px] font-bold text-green-400 uppercase">🏷️ Tags</div>
                <div className="bg-slate-900 rounded p-2 text-[10px] text-slate-400 border border-slate-800">{seoData.tags}</div>
              </>}
              {seoData.thumbPromptWithText && <>
                <div className="text-[9px] font-bold text-orange-400 uppercase">🖼️ Thumbnail Prompt (có chữ)</div>
                <div className="bg-slate-900 rounded p-2 text-[10px] text-slate-400 border border-slate-800">{seoData.thumbPromptWithText}</div>
              </>}
              {seoData.thumbPromptNoText && <>
                <div className="text-[9px] font-bold text-orange-400 uppercase">🖼️ Thumbnail Prompt (không chữ)</div>
                <div className="bg-slate-900 rounded p-2 text-[10px] text-slate-400 border border-slate-800">{seoData.thumbPromptNoText}</div>
              </>}
              <button onClick={() => handleAutoSEO()} className="w-full py-2 rounded-xl bg-purple-700 hover:bg-purple-600 text-white font-bold text-[11px] transition">
                🔄 Tạo lại SEO
              </button>
            </>}
          </>}

        </div>{/* end phase content */}
      </div>{/* end left panel */}

      {/* ══ RIGHT PANEL — preview + log ════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080d17]">

        {/* ── Top bar: title + status chips ── */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 bg-[#0d1424]">
          <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-widest">🖥️ Preview</span>
          <span className="text-[8px] text-slate-700 bg-slate-800 px-1.5 py-0.5 rounded">{outputAspect}</span>
          <div className="flex gap-2 ml-auto">
            {[
              [audioFile,            '🎵', audioFile?.name?.slice(0,18)||'audio', 'text-green-400'],
              [srtFile,              '📄', 'SRT',                                 'text-emerald-400'],
              [bgVideoFile||bgFolder,'🎬', (bgVideoFile?.name||bgFolder?.name)?.slice(0,14)||'nền', 'text-teal-400'],
              [finalVideo,           '✅', finalVideo?.split(/[\\/]/).pop().slice(0,18)||'output', 'text-yellow-400'],
            ].map(([ok, ico, label, cls], i) => (
              <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded ${ok ? cls+' bg-slate-800/80' : 'text-slate-700 bg-slate-900/40'}`}>
                {ico} {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Canvas — chiếm toàn bộ phần còn lại ── */}
        <div className="flex-1 min-h-0 p-4 flex w-full overflow-hidden">
          <CanvasPreview
            outputAspect={outputAspect}
            mcPos={mcPos} scenePos={scenePos} logoPos={logoPos}
            chNamePos={chNamePos} subtitlePos={subtitlePos}
            channelName={channelName} chNameColor={chNameColor} chNameFontSize={chNameFontSize}
            chNameOpacity={chNameOpacity}
            subtitleEnabled={subtitleEnabled} subtitleColor={subtitleColor}
            subtitleBg={subtitleBg} subtitlePreset={subtitlePreset}
            subtitleFontSize={subtitleFontSize} subAnimation={subAnimation}
            showWaveform={showWaveform} waveStyle={waveStyle}
            videoEffect={videoEffect} sceneFrameStyle={sceneFrameStyle}
            logoFile={logoFile} sceneVideo={null} sceneFolder={null} sceneImage={sceneImage}
            bgVideoFile={bgVideoFile} bgFolder={bgFolder}
            onDragMC={onDragMC} onDragScene={onDragScene} onDragLogo={onDragLogo}
            onDragChName={onDragChName} onDragSubtitle={onDragSubtitle}
          />
        </div>

        {/* ── Log — chiều cao cố định 180px ── */}
        <div className="shrink-0 h-[180px] flex flex-col border-t border-slate-800/60">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d1424] border-b border-slate-800/40 shrink-0">
            <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">Log</span>
            <span className="text-[8px] text-slate-700 ml-auto">{logs.length} dòng</span>
            <button onClick={() => setLogs([])} className="text-[8px] text-slate-600 hover:text-slate-400 transition">🗑️</button>
            {finalVideo && (
              <button onClick={() => window.electronAPI?.shell?.showItemInFolder?.(finalVideo)}
                className="px-2 py-0.5 rounded bg-green-800/60 hover:bg-green-700 text-green-300 font-bold text-[8px] transition">
                📂 Mở output
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[9px] leading-relaxed">
            {logs.length === 0
              ? <div className="text-slate-800 text-center mt-6">Chưa có log...</div>
              : logs.map(l => (
                <div key={l.id} className={`${l.type==='error' ? 'text-red-400' : l.type==='success' ? 'text-green-400' : l.type==='warn' ? 'text-yellow-400' : 'text-slate-500'}`}>
                  <span className="text-slate-800 mr-1">{l.time}</span>{l.msg}
                </div>
              ))
            }
            <div ref={logEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}
