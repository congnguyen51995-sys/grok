/**
 * HorrorStoryPanel v4 — AI Horror Video Editor (Remotion + Segments + Preview)
 * Video gốc → chia segments → Gemini code 1 lần → render từng phần → xem trước → ghép
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import { transcribeLocalChunked } from '../services/whisperLocal.js';
import { transcribeGroqChunked, loadGroqKeysForWhisper } from '../services/whisperGroq.js';
import {
  Film, Play, Pause, FolderOpen, Loader2, CheckCircle2, AlertCircle,
  Sparkles, Send, RotateCcw, Code2, Terminal, ChevronDown, ChevronUp,
  Wand2, Clapperboard, X, Check, Youtube, Scissors,
  Layers, RefreshCw, Maximize2,
} from 'lucide-react';

// ─ Constants ─────────────────────────────────────────────────────────────────
const LS_GEMINI_KEYS  = 'fluxy_gemini_api_keys';
const LS_OUT_DIR      = 'horror_remotion_output_dir';
const LS_MODEL        = 'horror_remotion_model';
const LS_CHANNEL      = 'horror_remotion_channel';
const LS_ORIENT       = 'horror_remotion_orient';
const LS_EFFECTS      = 'horror_remotion_effects';
const LS_LAST_CODE    = 'horror_remotion_last_code';
const LS_LB_TOP       = 'horror_lb_top';
const LS_LB_BOT       = 'horror_lb_bot';
const LS_LB_TOP_TXT   = 'horror_lb_top_txt';
const LS_LB_BOT_TXT   = 'horror_lb_bot_txt';
const LS_DEFAULT_INSTR = 'horror_default_instruction';
const LS_CROP_X        = 'horror_crop_x';

const DEFAULT_INSTRUCTION = `TẠO VIDEO EDIT KIỂU CHUYÊN NGHIỆP — REACTIVE THEO LỜI THOẠI, NHIỀU LỚP TEXT ĐỘNG:

━━ TEXT ANIMATIONS (bắt buộc tất cả) ━━
1. TYPEWRITER SUBTITLE: mỗi câu thoại → text xuất hiện từng chữ
   charCount = Math.floor(interpolate(frame,[sf,sf+seg.text.length*1.8],[0,seg.text.length],{extrapolateRight:'clamp'}))
   style: bottom 15%, fontSize 21, color #fff, textShadow "0 0 6px #ff2200", borderLeft "3px solid #cc0000", bg rgba(0,0,0,0.72)
   ⚠️ VÙNG bottom 0%–14% CHỈ DÀNH CHO LOWER THIRD — subtitle KHÔNG ĐƯỢC đặt trong vùng này

2. CHAPTER TITLE: 3–5 lần — tên nhân vật/địa điểm/sự kiện kinh dị lấy từ transcript
   Fade in 20fr, hold, fade out — fontSize 46, fontWeight 900, color #ff2200, textShadow "0 0 24px #ff0000", uppercase, center

3. SCENE CARD GÓC TRÊN TRÁI: "📍 [địa điểm]" hoặc "⏰ [giờ]" slide từ trái — 3–4 lần
   translateX interpolate(frame,[ap,ap+16],[-200,0]) — fontSize 14, bg rgba(0,0,0,0.88), borderLeft "3px solid #f00"

4. HIGHLIGHT WORD: từ khóa kinh dị nổi bật CENTER, scale pop
   scale = interpolate(frame,[s,s+8,s+20,s+28],[0,1.2,1,0]) — fontSize 60+, textShadow đỏ rực

5. LOWER THIRD: tóm tắt cảnh — position absolute, bottom 0, left 0, right 0, height 44, bg linear-gradient(90deg,#cc0000,#000), slide từ trái: translateX interpolate(frame,[ap,ap+20],[-1200,0])
   ⚠️ LOWER THIRD luôn ở bottom 0 — KHÔNG được đặt cao hơn bottom 14% để tránh đè subtitle

━━ KEYWORD VISUAL REACTIONS (reactive theo từng từ trong transcript) ━━
Scan SUBTITLES, tại frame mỗi segment có chứa TỪ KHÓA → kích hoạt effect trong ~20–30 frames.
Dùng hàm matchKw(text, list) = list.some(w => text.toLowerCase().includes(w)) để kiểm tra.

NHÓM 1 — CHẾT/MÁU/NGUY HIỂM: máu,chết,giết,xác,dao,súng,thương,nạn,thịt,vết,đỏ,ngã
→ RED_FLASH: bg rgba(180,0,0, interpolate(f,[0,3,12,22],[0,0.5,0.4,0],extrap:'clamp'))

NHÓM 2 — MA/ÂM/TỐI: ma,hồn,linh,quỷ,tối,đêm,bóng,âm,mờ,khuya,nhà hoang,lạnh,lặng,im,vắng,rùng
→ DARK_SURGE: vignette tối đột ngột + bg rgba(0,0,0,opacity interpolate(f,[0,5,15,25],[0,0.55,0.45,0]))

NHÓM 3 — SỢ HÃI (chỉ từ rõ ràng, KHÔNG dùng "run"/"lạnh"): sợ,kinh hãi,hoảng loạn,khóc thét,hoảng sợ,mồ hôi,run rẩy,toát mồ hôi
→ DARK_PULSE nhẹ: vignette opacity interpolate(f,[0,5,15,25],[0,0.4,0.35,0]) — KHÔNG shake/translate (tránh giật)

NHÓM 4 — HÉT RÕ RÀNG (chỉ từ cực mạnh, không dùng từ phổ biến): hét,thét,gào,rú,la hét,thét lên
→ WHITE_FLASH nhẹ: opacity 0→0.25→0 trong 10fr — KHÔNG zoom/scale (tránh giật)

NHÓM 5 — HÀNH ĐỘNG/ĐỔ ĐUỔI: chạy,trốn,đuổi,nhảy,vọt,lao,nhanh,vội,gấp
→ MOTION_BLUR: filter blur(1.5px) nhịp 8fr — KHÔNG dùng scaleX để tránh jitter

NHÓM 6 — BẤT NGỜ/CĂNG THẲNG (chỉ từ thực sự bất ngờ, KHÔNG dùng "lúc đó"/"khi đó"/"tự nhiên"):
bỗng,đột nhiên,thình lình,bỗng nhiên,bỗng dưng,chợt nghe,đột ngột
→ SUSPENSE_FLASH: vignette nhanh tối 6fr rồi sáng lại — KHÔNG shake/translate (tránh giật)

⚠️ FALLBACK MẶC ĐỊNH — áp dụng kể cả khi KHÔNG có từ khóa nào:
Chỉ dùng 2 effect tĩnh sau (KHÔNG dùng transform/translate/shake):
- Pulse vignette nhẹ: vignette opacity sin(frame*0.035)*0.12+0.12
- Flicker ánh sáng: brightness interpolate(frame%60,[0,2,7,15,22,30],[1,0.97,1.01,0.98,1,0.99])
→ ⛔ TUYỆT ĐỐI KHÔNG có "Subtle shake thường trực" hay bất kỳ translateX/translateY nào trong FALLBACK — gây jitter liên tục khi render

⛔ KHÔNG BAO GIỜ apply translateX/translateY/transform lên thẳng phần tử <Video> hay div bọc trực tiếp nó
  — Nếu cần shake/motion: CHỈ apply lên AbsoluteFill wrapper NGOÀI CÙNG để toàn bộ frame (video + subtitle + overlay) di chuyển đồng bộ
  — Apply transform lên riêng Video → MC bị giật còn subtitle/overlay đứng yên = jitter rõ ràng

⛔ TUYỆT ĐỐI KHÔNG dùng AudioContext, Web Audio API, oscillator, createOscillator trong code
  — Remotion render headless bằng Chromium thật: AudioContext chạy và ghi âm vào video → gây âm thanh lạ vang vọng
  — KHÔNG có useEffect nào gọi AudioContext, playHorrorSting, hay bất kỳ audio synthesis nào`;


const GEMINI_MODELS = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite' },
];

const ASPECT_OPTIONS = [
  { value: 'portrait',  label: '📱 9:16',  width: 1080, height: 1920 },
  { value: 'landscape', label: '🖥️ 16:9', width: 1920, height: 1080 },
  { value: 'square',    label: '⬛ 1:1',  width: 1080, height: 1080 },
];

const HORROR_PRESETS = [
  { id: 'color_dark',    cat: 'color',   label: '🌑 Tối huyền bí',      prompt: 'CSS filter trên Video: brightness(0.83) contrast(1.4) saturate(0.5)' },
  { id: 'color_horror',  cat: 'color',   label: '🩸 Kinh dị đậm',       prompt: 'CSS filter: hue-rotate(200deg) saturate(0.28) contrast(1.55) brightness(0.79) — tone đỏ/lạnh' },
  { id: 'color_fog',     cat: 'color',   label: '🌫️ Sương mù âm u',      prompt: 'CSS filter: grayscale(0.45) contrast(1.1) brightness(0.93) sepia(0.12)' },
  { id: 'color_cinema',  cat: 'color',   label: '🎬 Cinematic teal',     prompt: 'CSS filter: contrast(1.25) saturate(0.78) hue-rotate(-5deg) brightness(0.92)' },
  { id: 'vignette',      cat: 'overlay', label: '🔲 Vignette tối',       prompt: 'AbsoluteFill: background radial-gradient(ellipse at center, transparent 48%, rgba(0,0,0,0.9) 100%), pointerEvents none' },
  { id: 'grain',         cat: 'overlay', label: '📽️ Film grain',         prompt: 'Film grain: SVG feTurbulence baseFrequency 0.68 numOctaves 4, div overlay opacity 0.16 mixBlendMode overlay' },
  { id: 'flicker',       cat: 'overlay', label: '⚡ Nhấp nháy đèn',      prompt: 'Light flicker: opacity = interpolate(frame%60,[0,3,7,12,22,30,52,60],[0,0.09,0.02,0.11,0.08,0.03,0.07,0]) — đèn chập chờn' },
  { id: 'red_pulse',     cat: 'overlay', label: '🩸 Xung đỏ ám',         prompt: 'Red pulse: AbsoluteFill background rgba(170,0,0,1), opacity = Math.sin(frame/45*Math.PI)*0.065+0.065' },
  { id: 'cold_overlay',  cat: 'overlay', label: '💨 Lạnh xanh âm',       prompt: 'Cold blue: AbsoluteFill background rgba(0,20,80,0.07) + opacity sin nhẹ mỗi 120 frame' },
  { id: 'zoom_in',       cat: 'motion',  label: '🔍 Zoom vào chậm',      prompt: 'Ken Burns: div bọc Video, transform scale từ 1.0 → 1.09 qua interpolate(frame,[0,totalFrames],[1.0,1.09])' },
  { id: 'zoom_out',      cat: 'motion',  label: '🔎 Zoom ra chậm',       prompt: 'Ken Burns: scale từ 1.09 → 1.0 qua interpolate(frame,[0,totalFrames],[1.09,1.0])' },
  { id: 'slight_shake',  cat: 'motion',  label: '📳 Run rẩy nhẹ',        prompt: 'Camera shake: transform translateX(sin(frame*0.11)*2.5px) translateY(cos(frame*0.09)*1.5px)' },
  { id: 'horror_title',  cat: 'text',    label: '💀 Tiêu đề horror',     prompt: 'Tiêu đề: frame 60-210, font Georgia serif 52px bold trắng, textShadow "0 0 12px #ff0000,0 0 28px #800000", opacity fade 60→90 / 180→210, top center padding 70px' },
  { id: 'watermark',     cat: 'text',    label: '©️ Watermark kênh',      prompt: 'Watermark góc dưới phải: channelName, 13px bold, rgba(255,255,255,0.55), position absolute bottom 20 right 20' },
  { id: 'lower_third',   cat: 'text',    label: '📊 Lower third',        prompt: 'Lower third: slide từ trái vào frame 30-70 qua interpolate translateX, tên kênh + tagline, bg linear-gradient đỏ/đen, height 52, bottom 28%' },
  { id: 'subscribe_end', cat: 'text',    label: '🔔 Subscribe end card', prompt: 'Subscribe 5s cuối: "ĐĂNG KÝ KÊNH" + channelName, opacity fade totalFrames-150→-120, font 28px bold, center, glow đỏ' },
  { id: 'speed_slow',    cat: 'speed',   label: '🎵 Giọng chậm 0.95x',   prompt: '<Video playbackRate={0.95} /> — QUAN TRỌNG: khi dùng playbackRate, tất cả subtitle frame phải tính: frameStart=Math.round(word.start/0.95*fps), frameEnd=Math.round(word.end/0.95*fps)' },
  { id: 'speed_fast',    cat: 'speed',   label: '🎵 Giọng nhanh 1.05x',  prompt: '<Video playbackRate={1.05} /> — QUAN TRỌNG: khi dùng playbackRate, tất cả subtitle frame phải tính: frameStart=Math.round(word.start/1.05*fps), frameEnd=Math.round(word.end/1.05*fps)' },
];

const CAT_META = {
  color:   { label: '🎨 Màu sắc',      order: 0 },
  overlay: { label: '🌟 Hiệu ứng',     order: 1 },
  motion:  { label: '🎬 Chuyển động',   order: 2 },
  text:    { label: '📝 Văn bản',       order: 3 },
  speed:   { label: '🎵 Tốc độ phát',  order: 4 },
};

// ─ Helpers ────────────────────────────────────────────────────────────────────
const loadKeys  = () => { try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS) || '[]'); } catch { return []; } };
const fmtSize   = (b) => b < 1048576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`;
const fmtSec    = (s) => { const m = Math.floor(s/60); const ss = Math.round(s%60); return `${m}:${String(ss).padStart(2,'0')}`; };
const fileUrl   = (p) => p ? 'file:///' + p.replace(/\\/g, '/') : '';

// Auto-select Groq Whisper khi có key, fallback về local Whisper
async function doTranscribe(filePath, durationSec, onProgress, onChunkDone, onLog, onModelProgress) {
  const groqKeys = loadGroqKeysForWhisper();
  if (groqKeys.length) {
    onLog?.('🚀 Groq Whisper Large v3 Turbo (cloud)...');
    return transcribeGroqChunked(filePath, durationSec, onProgress, onChunkDone, onLog);
  }
  onLog?.('🖥️ Whisper cục bộ (local tiny)...');
  return transcribeLocalChunked(filePath, durationSec, onProgress, onChunkDone, onLog, onModelProgress);
}

// Format transcript [{start, end, text}] thành text cho Gemini prompt
function formatTranscript(segs) {
  if (!segs || !segs.length) return '';
  return segs.map(s => `[${fmtSec(s.start)} → ${fmtSec(s.end)}] ${s.text}`).join('\n');
}

function extractCode(raw) {
  // Find all fenced code blocks — take the largest (Gemini sometimes outputs examples before the full component)
  const matches = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  if (matches.length) {
    const largest = matches.reduce((a, b) => a[1].length >= b[1].length ? a : b);
    return largest[1].trim();
  }
  // Fallback: strip opening and closing fence lines
  return raw.trim()
    .replace(/^```[^\n]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

function patchCodeDuration(code, durationSec) {
  const frames = Math.round(durationSec * 30);
  return code
    .replace(/(COMPOSITION_DURATION_FRAMES\s*=\s*)\d+/g, `$1${frames}`)
    .replace(/(durationInFrames:\s*)\d+/g, `$1${frames}`);
}

// Xóa startFrom khỏi <Video src=...input.mp4...> — startFrom đẩy seek vượt EOF → delayRender treo
// Đồng thời đảm bảo endAt={frames-1} để không render frame cuối vượt duration
function patchCodeVideoSafe(code, durationSec) {
  const frames = Math.round(durationSec * 30);
  const safe = frames - 1;
  // Strip startFrom attribute từ bất kỳ <Video> nào
  let patched = code.replace(/<Video(\s[^>]*?)startFrom=\{[^}]+\}([^>]*?)>/g, '<Video$1$2>');
  // Đảm bảo endAt={safe} — nếu đã có endAt thì replace, nếu chưa có thì inject vào trước '>'
  patched = patched.replace(/<Video(\s[^>]*?)endAt=\{[^}]+\}/g, `<Video$1endAt={${safe}}`);
  // Nếu <Video src="...input.mp4..." chưa có endAt, thêm vào
  patched = patched.replace(/(<Video\b(?![^>]*endAt)[^>]*?)(\/?>)/g, (m, open, close) => {
    if (!open.includes('input.mp4')) return m; // chỉ fix Video chính
    return `${open} endAt={${safe}}${close}`;
  });
  return patched;
}

function patchCodeSubtitles(code, segs, speedRate = 1) {
  if (!code.includes('SUBTITLE_PLACEHOLDER')) return code;
  // Khi video dùng playbackRate={r}, video chạy chậm hơn/nhanh hơn timeline.
  // Tại Remotion frame F, video ở giây: F/fps * r → subtitle ở giây T xuất hiện tại frame T/r*fps.
  // Vì Gemini tính frame = start * fps (không biết r), ta chia timestamp cho r trước khi inject.
  const rate = speedRate !== 1 ? speedRate : 1;
  const data = segs && segs.length
    ? JSON.stringify(segs.map(s => ({ start: +(s.start / rate).toFixed(2), end: +(s.end / rate).toFixed(2), text: s.text.trim() })))
    : '[]';
  // Gemini có thể bọc trong nháy đơn, nháy đôi, hoặc bare — handle cả 3
  return code
    .replace(/"SUBTITLE_PLACEHOLDER"/g, data)
    .replace(/'SUBTITLE_PLACEHOLDER'/g, data)
    .replace(/SUBTITLE_PLACEHOLDER/g,   data);
}

// Xóa các block destructuring JSON không hợp lệ mà Gemini đôi khi sinh ra:
// const [{"start":0,...},...] = [...];  ← SWC lỗi "Unexpected token numeric literal"
function sanitizeGeneratedCode(code) {
  if (!code) return code;
  const lines = code.split('\n');
  const out = [];
  let skipDepth = 0;
  let skipping = false;
  let skipAudioDepth = 0;
  let skipAudioBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // Strip AudioContext (gây vang vọng khi Remotion headless render)
    if (/const audioCtxRef\s*=/.test(trimmed) && /AudioContext/i.test(trimmed)) continue;
    if (/^function playHorrorSting/.test(trimmed)) { skipAudioBlock = true; skipAudioDepth = 0; }
    if (skipAudioBlock) {
      for (const ch of line) { if (ch === '{') skipAudioDepth++; else if (ch === '}') skipAudioDepth--; }
      if (skipAudioDepth <= 0 && trimmed.endsWith('}')) { skipAudioBlock = false; }
      continue;
    }
    if (/playHorrorSting\(/.test(trimmed)) continue;

    // Strip uninitialized const (từ chunk join boundary: "const foo" không có = value)
    if (/^const\s+[A-Za-z_$][\w$]*\s*;?\s*$/.test(trimmed)) continue;

    // Detect: const [ bắt đầu bằng JSON object có numeric value → invalid destructuring
    if (!skipping && /^const\s*\[/.test(trimmed) && /\{"[^"]+"\s*:\s*[\d-]/.test(trimmed)) {
      skipping = true;
      skipDepth = 0;
      for (const ch of line) {
        if (ch === '[' || ch === '(') skipDepth++;
        else if (ch === ']' || ch === ')') skipDepth--;
      }
      if (skipDepth <= 0) skipping = false;
      continue;
    }
    if (skipping) {
      for (const ch of line) {
        if (ch === '[' || ch === '(') skipDepth++;
        else if (ch === ']' || ch === ')') skipDepth--;
      }
      if (skipDepth <= 0) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// Kiểm tra JSX có đầy đủ không (Gemini đôi khi cắt ngang khi gần max token)
function isCodeComplete(code) {
  if (!code || code.length < 200) return false;
  if (!code.includes('export default')) return false;
  const lines = code.trimEnd().split('\n');
  const last3 = lines.slice(-3).join('\n');
  // Case 1: standalone export cuối file — "export default GeneratedVideo;"
  if (/export\s+default\s+\w+\s*;?\s*$/.test(last3)) return true;
  // Case 2: "export default function" style — kiểm tra số {} cân bằng
  // Nếu cân bằng và dòng cuối là } thì component đã đóng hoàn toàn
  if (code.includes('export default function')) {
    let braces = 0;
    for (const ch of code) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
    }
    const lastLine = lines.filter(l => l.trim()).pop()?.trim() || '';
    if (braces === 0 && lastLine === '}') return true;
  }
  return false;
}

async function callGeminiStream(apiKeys, prompt, model, refParts, onChunk, { startKeyOffset = 0 } = {}) {
  // Xoay mảng key để completion retry dùng key khác key vừa bị truncate
  const keys = apiKeys || [];
  const rotated = keys.length > 1 && startKeyOffset > 0
    ? [...keys.slice(startKeyOffset % keys.length), ...keys.slice(0, startKeyOffset % keys.length)]
    : keys;
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const parts = [...(refParts || []), { text: prompt }];
    const stream = await ai.models.generateContentStream({
      model,
      contents: [{ role: 'user', parts }],
      config: { temperature: 0.7, maxOutputTokens: 16384 },
    });
    let full = '';
    for await (const chunk of stream) {
      const t = chunk.text || '';
      if (t) { full += t; onChunk(t); }
    }
    return full;
  }, rotated);
}

// ─ LogPanel ───────────────────────────────────────────────────────────────────
function LogPanel({ logs, open, onToggle, onClear }) {
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, open]);
  return (
    <div className={`bg-[#060a12] border-t border-slate-800 flex flex-col transition-all duration-300 shrink-0 ${open ? 'h-44' : 'h-9'}`}>
      <div className="flex items-center justify-between px-4 h-9 cursor-pointer select-none hover:bg-slate-900/60" onClick={onToggle}>
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          <Terminal className="w-3.5 h-3.5" /> Render Log
          {logs.length > 0 && !open && <span className="bg-slate-700 text-slate-300 text-[9px] px-1.5 py-0.5 rounded-full">{logs.length}</span>}
        </span>
        <div className="flex gap-2">
          {open && <button onClick={e => { e.stopPropagation(); onClear(); }} className="text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded">Xóa</button>}
          {open ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronUp className="w-3 h-3 text-slate-600" />}
        </div>
      </div>
      {open && (
        <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] font-mono space-y-0.5 custom-scrollbar">
          {logs.map((l, i) => (
            <div key={i} className={
              l.startsWith('✅') ? 'text-emerald-400' : l.startsWith('❌') ? 'text-red-400' :
              l.startsWith('▶') ? 'text-sky-400' : l.startsWith('🎬') || l.startsWith('📝') ? 'text-violet-400' :
              l.startsWith('📤') || l.startsWith('⏳') ? 'text-amber-400' : l.startsWith('✂') ? 'text-cyan-400' :
              l.startsWith('🎤') || l.startsWith('  🔤') || l.startsWith('  📢') ? 'text-purple-400' : 'text-slate-400'
            }>{l}</div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

// ─ Preview Player ─────────────────────────────────────────────────────────────
function VideoControls({ videoRef, src, playing, setPlaying, progress, setProgress, duration, label, onExpand }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
      {/* Label */}
      {label && (
        <div className="absolute top-2 left-2 bg-black/70 text-[10px] text-rose-400 font-bold px-2 py-0.5 rounded-lg pointer-events-none">{label}</div>
      )}
      {/* Expand button */}
      <button onClick={onExpand}
        className="absolute top-2 right-2 bg-black/70 hover:bg-black/90 text-[10px] text-white px-2 py-0.5 rounded-lg pointer-events-auto flex items-center gap-1 transition-colors">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
        Phóng to
      </button>
      {/* Controls bar */}
      <div className="px-3 pb-2 pt-8 bg-gradient-to-t from-black/80 to-transparent pointer-events-auto">
        <input type="range" min={0} max={duration || 1} step={0.1} value={progress}
          onChange={e => { const t = Number(e.target.value); if (videoRef.current) videoRef.current.currentTime = t; setProgress(t); }}
          className="w-full h-1 accent-rose-500 cursor-pointer" />
        <div className="flex items-center justify-between mt-1.5">
          <button onClick={() => { if (videoRef.current) { playing ? videoRef.current.pause() : videoRef.current.play(); } }}
            className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-rose-700 hover:bg-rose-600 px-2.5 py-1 rounded-lg transition-all">
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {playing ? 'Dừng' : 'Phát'}
          </button>
          <span className="text-[10px] text-slate-400 font-mono">{fmtSec(progress)} / {fmtSec(duration)}</span>
          <button onClick={() => window.electronAPI?.remotionOpenVideo?.(src)}
            className="text-[10px] text-slate-400 hover:text-white border border-slate-700 px-2 py-1 rounded-lg transition-colors">
            Mở ngoài
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewPlayer({ src, label }) {
  const videoRef    = useRef(null);
  const modalRef    = useRef(null);
  const [playing,   setPlaying]   = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [duration,  setDuration]  = useState(0);
  const [expanded,  setExpanded]  = useState(false);
  const [mPlaying,  setMPlaying]  = useState(false);
  const [mProgress, setMProgress] = useState(0);
  const [mDuration, setMDuration] = useState(0);

  useEffect(() => {
    setPlaying(false); setProgress(0); setDuration(0);
    setExpanded(false);
    if (videoRef.current) videoRef.current.load();
  }, [src]);

  // Sync modal video when opened + ESC to close
  useEffect(() => {
    if (expanded && modalRef.current) { modalRef.current.load(); }
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
    if (expanded) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!src) return (
    <div className="w-full h-14 bg-[#060a12] rounded-xl border border-slate-800 flex items-center justify-center gap-2 text-slate-700">
      <Film className="w-5 h-5 opacity-30" />
      <p className="text-[11px]">Preview sẽ hiện ở đây sau khi render xong</p>
    </div>
  );

  return (
    <>
      {/* Inline preview */}
      <div className="w-full rounded-xl overflow-hidden border border-slate-700 bg-black relative group cursor-pointer"
        onClick={() => setExpanded(true)}>
        <video
          ref={videoRef}
          src={fileUrl(src)}
          className="w-full max-h-48 object-contain"
          onTimeUpdate={e => setProgress(e.target.currentTime)}
          onLoadedMetadata={e => setDuration(e.target.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={e => e.stopPropagation()}
        />
        <VideoControls videoRef={videoRef} src={src} playing={playing} setPlaying={setPlaying}
          progress={progress} setProgress={setProgress} duration={duration}
          label={label} onExpand={() => setExpanded(true)} />
      </div>

      {/* Fullscreen modal */}
      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/92 flex flex-col items-center justify-center"
          onClick={() => setExpanded(false)}>
          <div className="relative w-full max-w-5xl px-4" onClick={e => e.stopPropagation()}>
            {/* Close */}
            <button onClick={() => setExpanded(false)}
              className="absolute -top-10 right-4 text-slate-400 hover:text-white flex items-center gap-1.5 text-[12px] transition-colors">
              <X className="w-4 h-4" /> Đóng (ESC)
            </button>
            {label && (
              <div className="absolute -top-10 left-4 text-[12px] text-rose-400 font-bold">{label}</div>
            )}
            {/* Big video */}
            <div className="relative group rounded-2xl overflow-hidden border border-slate-700 bg-black">
              <video
                ref={modalRef}
                src={fileUrl(src)}
                className="w-full max-h-[80vh] object-contain"
                onTimeUpdate={e => setMProgress(e.target.currentTime)}
                onLoadedMetadata={e => setMDuration(e.target.duration)}
                onPlay={() => setMPlaying(true)}
                onPause={() => setMPlaying(false)}
                onEnded={() => setMPlaying(false)}
                autoPlay
              />
              <VideoControls videoRef={modalRef} src={src} playing={mPlaying} setPlaying={setMPlaying}
                progress={mProgress} setProgress={setMProgress} duration={mDuration}
                label={null} onExpand={() => {}} />
            </div>
            {/* Progress bar big */}
            <div className="mt-3 px-2">
              <input type="range" min={0} max={mDuration || 1} step={0.1} value={mProgress}
                onChange={e => { const t = Number(e.target.value); if (modalRef.current) modalRef.current.currentTime = t; setMProgress(t); }}
                className="w-full h-1.5 accent-rose-500 cursor-pointer" />
              <div className="flex items-center justify-between mt-2">
                <button onClick={() => { if (modalRef.current) { mPlaying ? modalRef.current.pause() : modalRef.current.play(); } }}
                  className="flex items-center gap-2 text-[12px] font-bold text-white bg-rose-700 hover:bg-rose-600 px-4 py-1.5 rounded-xl transition-all">
                  {mPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {mPlaying ? 'Dừng' : 'Phát'}
                </button>
                <span className="text-[12px] text-slate-400 font-mono">{fmtSec(mProgress)} / {fmtSec(mDuration)}</span>
                <button onClick={() => window.electronAPI?.remotionOpenVideo?.(src)}
                  className="text-[12px] text-slate-400 hover:text-white border border-slate-600 px-3 py-1.5 rounded-xl transition-colors">
                  Mở trong media player
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─ Segment Grid ───────────────────────────────────────────────────────────────
const SEG_META = {
  pending:      { icon: '⌛', cls: 'text-slate-600  bg-slate-800/50    border-slate-700' },
  trimming:     { icon: '✂️', cls: 'text-cyan-400   bg-cyan-900/20     border-cyan-700/60' },
  transcribing: { icon: '🎤', cls: 'text-purple-400 bg-purple-900/20   border-purple-700/60' },
  generating:   { icon: '🤖', cls: 'text-violet-400 bg-violet-900/20   border-violet-700/60' },
  rendering:    { icon: '🎞️', cls: 'text-amber-400  bg-amber-900/20    border-amber-700/60' },
  done:         { icon: '✅', cls: 'text-emerald-400 bg-emerald-900/20  border-emerald-700/60' },
  error:        { icon: '❌', cls: 'text-red-400    bg-red-900/20      border-red-700/60' },
};

function SegmentGrid({ segments, activeIdx, onSelect, onRerenderOne, isBusy }) {
  if (!segments.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {segments.map((seg, i) => {
        const m = SEG_META[seg.status] || SEG_META.pending;
        const active = i === activeIdx;
        return (
          <button key={seg.id}
            onClick={() => seg.videoPath && onSelect(i)}
            title={`Phần ${i+1}: ${fmtSec(seg.startSec)} → ${fmtSec(seg.endSec)}`}
            className={`relative flex flex-col items-center px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-all
              ${m.cls} ${seg.videoPath ? 'cursor-pointer hover:scale-105' : 'cursor-default'}
              ${active ? 'ring-2 ring-rose-500 scale-105' : ''}`}>
            <span className="text-[12px]">{m.icon}</span>
            <span>P.{i+1}</span>
            <span className="text-[8px] font-mono opacity-60">{fmtSec(seg.durationSec)}</span>
            {seg.videoPath && !isBusy && (
              <span onClick={e => { e.stopPropagation(); onRerenderOne(i); }}
                title="Re-render" className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-slate-700 hover:bg-rose-700 rounded-full flex items-center justify-center cursor-pointer transition-colors">
                <RefreshCw className="w-2 h-2 text-white" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─ Letterbox Adjuster ────────────────────────────────────────────────────────
function LetterboxAdjuster({ frameUrl, topPct, bottomPct, onTop, onBottom, topText, bottomText, onTopText, onBottomText }) {
  return (
    <div className="space-y-2">
      {/* Frame preview with draggable black bars */}
      <div className="relative w-full rounded-lg overflow-hidden border border-slate-700 select-none"
        style={{ aspectRatio: '16/9', background: '#000' }}>
        {frameUrl
          ? <img src={frameUrl} className="w-full h-full object-cover" draggable={false} />
          : <div className="w-full h-full flex items-center justify-center text-slate-700 text-[10px]">
              <Film className="w-5 h-5 mr-1.5 opacity-30" /> Chọn video để xem preview khung
            </div>
        }
        {/* Top black bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center px-2 overflow-hidden transition-all"
          style={{ height: `${topPct}%`, background: 'rgba(0,0,0,0.96)', minHeight: topPct > 0 ? 4 : 0 }}>
          {topText && topPct > 4 && (
            <span className="text-white font-bold truncate" style={{ fontSize: Math.max(7, topPct * 0.9) }}>
              {topText}
            </span>
          )}
        </div>
        {/* Bottom black bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end px-2 overflow-hidden transition-all"
          style={{ height: `${bottomPct}%`, background: 'rgba(0,0,0,0.96)', minHeight: bottomPct > 0 ? 4 : 0 }}>
          {bottomText && bottomPct > 4 && (
            <span className="text-white font-bold truncate" style={{ fontSize: Math.max(7, bottomPct * 0.9) }}>
              {bottomText}
            </span>
          )}
        </div>
        {/* Percentage labels */}
        {topPct > 0 && (
          <div className="absolute left-1 pointer-events-none" style={{ top: `${topPct/2}%`, transform: 'translateY(-50%)' }}>
            <span className="text-[8px] text-rose-400 font-mono bg-black/50 px-1 rounded">{topPct}%</span>
          </div>
        )}
        {bottomPct > 0 && (
          <div className="absolute left-1 pointer-events-none" style={{ bottom: `${bottomPct/2}%`, transform: 'translateY(50%)' }}>
            <span className="text-[8px] text-rose-400 font-mono bg-black/50 px-1 rounded">{bottomPct}%</span>
          </div>
        )}
      </div>

      {/* Sliders */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-14 shrink-0">▲ Trên</span>
          <input type="range" min={0} max={28} value={topPct}
            onChange={e => onTop(Number(e.target.value))}
            className="flex-1 h-1 accent-rose-500 cursor-pointer" />
          <span className="text-[10px] text-rose-400 font-mono w-7 text-right">{topPct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-14 shrink-0">▼ Dưới</span>
          <input type="range" min={0} max={28} value={bottomPct}
            onChange={e => onBottom(Number(e.target.value))}
            className="flex-1 h-1 accent-rose-500 cursor-pointer" />
          <span className="text-[10px] text-rose-400 font-mono w-7 text-right">{bottomPct}%</span>
        </div>
      </div>

      {/* Preset buttons */}
      <div className="flex gap-1.5">
        {[{l:'Tắt',t:0,b:0},{l:'Nhẹ 10%',t:10,b:10},{l:'Cinema 14%',t:14,b:14},{l:'Rộng 20%',t:20,b:20}].map(p => (
          <button key={p.l} onClick={() => { onTop(p.t); onBottom(p.b); }}
            className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all ${topPct===p.t&&bottomPct===p.b ? 'bg-rose-800/60 border-rose-600 text-rose-200' : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-rose-700/50'}`}>
            {p.l}
          </button>
        ))}
      </div>

      {/* Text labels */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <p className="text-[9px] text-slate-600 mb-0.5">Chữ trên (tập/phần...)</p>
          <input value={topText} onChange={e => onTopText(e.target.value)}
            placeholder="TẬP 620 - PHẦN 13"
            className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[10px] rounded px-2 py-1 focus:outline-none focus:border-rose-500 placeholder-slate-700" />
        </div>
        <div>
          <p className="text-[9px] text-slate-600 mb-0.5">Chữ dưới (kênh/credit)</p>
          <input value={bottomText} onChange={e => onBottomText(e.target.value)}
            placeholder="CHUYỆN MA CHỦ 3 DUY"
            className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[10px] rounded px-2 py-1 focus:outline-none focus:border-rose-500 placeholder-slate-700" />
        </div>
      </div>
    </div>
  );
}

// ─ Crop Adjuster ─────────────────────────────────────────────────────────────
// Hiển thị frame 16:9 với overlay khung crop (1:1 hoặc 9:16), kéo trái/phải
// objectPositionX: 0=trái … 50=giữa … 100=phải
const CROP_BOX_PCT = {
  square:   56.25,  // 1080/1920 × 100  (16:9 → 1:1)
  portrait: 31.64,  // 1080/(1920×1.778) × 100  (16:9 → 9:16)
};

function CropAdjuster({ frameUrl, orientation, posX, onPosX }) {
  const boxW = CROP_BOX_PCT[orientation] ?? 100; // % width của crop box trong preview
  const maxLeft = 100 - boxW;                    // khoảng di chuyển tối đa (%)
  const boxLeft = (posX / 100) * maxLeft;         // vị trí left thực tế (%)

  const presets = [
    { label: '◀ Trái',  v: 0   },
    { label: '⬛ Giữa', v: 50  },
    { label: '▶ Phải',  v: 100 },
  ];

  return (
    <div className="space-y-2">
      {/* Frame preview với crop overlay */}
      <div className="relative w-full rounded-lg overflow-hidden border border-slate-700 select-none"
        style={{ aspectRatio: '16/9', background: '#000' }}>
        {frameUrl
          ? <img src={frameUrl} className="w-full h-full object-cover pointer-events-none" draggable={false} />
          : <div className="w-full h-full flex items-center justify-center text-slate-700 text-[10px]">
              <Film className="w-5 h-5 mr-1.5 opacity-30" /> Chọn video để xem preview khung cắt
            </div>
        }
        {/* Overlay tối bên TRÁI crop box */}
        <div className="absolute top-0 bottom-0 left-0 bg-black/65 transition-all"
          style={{ width: `${boxLeft}%` }} />
        {/* Crop box — viền sáng, trong suốt */}
        <div className="absolute top-0 bottom-0 border-2 border-rose-400 transition-all"
          style={{ left: `${boxLeft}%`, width: `${boxW}%` }}>
          {/* Label góc trên trái */}
          <div className="absolute top-1 left-1 bg-black/70 text-[9px] text-rose-300 font-bold px-1.5 py-0.5 rounded">
            {orientation === 'square' ? '1:1' : '9:16'} · {Math.round(posX)}%
          </div>
          {/* Đường dọc giữa (căn chỉnh) */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-rose-400/30" />
        </div>
        {/* Overlay tối bên PHẢI crop box */}
        <div className="absolute top-0 bottom-0 right-0 bg-black/65 transition-all"
          style={{ width: `${maxLeft - boxLeft}%` }} />
      </div>

      {/* Slider */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 shrink-0">◀</span>
        <input type="range" min={0} max={100} step={1} value={posX}
          onChange={e => onPosX(Number(e.target.value))}
          className="flex-1 h-1.5 accent-rose-500 cursor-pointer" />
        <span className="text-[9px] text-slate-500 shrink-0">▶</span>
      </div>

      {/* Preset nhanh */}
      <div className="flex gap-1.5">
        {presets.map(p => (
          <button key={p.label} onClick={() => onPosX(p.v)}
            className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all ${Math.abs(posX - p.v) < 2 ? 'bg-rose-800/60 border-rose-600 text-rose-200' : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-rose-700/50'}`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─ Main Component ─────────────────────────────────────────────────────────────
export default function HorrorStoryPanel() {
  // Source
  const [srcVideo,      setSrcVideo]      = useState(null);
  const [ytUrl,         setYtUrl]         = useState('');
  const [ytPhase,       setYtPhase]       = useState('idle');
  const [ytLog,         setYtLog]         = useState('');

  // Effects
  const [effects, setEffects] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_EFFECTS) || '["color_dark","vignette","horror_title","watermark"]')); }
    catch { return new Set(['color_dark','vignette','horror_title','watermark']); }
  });

  // Settings
  const [channelName,      setChannelName]      = useState(() => localStorage.getItem(LS_CHANNEL) || '@ThanhCongMedia');
  const [defaultInstruction, setDefaultInstruction] = useState(() => localStorage.getItem(LS_DEFAULT_INSTR) ?? DEFAULT_INSTRUCTION);
  const [orientation,   setOrientation]   = useState(() => localStorage.getItem(LS_ORIENT) || 'portrait');
  const [model,         setModel]         = useState(() => { const s = localStorage.getItem(LS_MODEL); return GEMINI_MODELS.find(m => m.id === s) ? s : 'gemini-3.5-flash'; });
  const [outputDir,     setOutputDir]     = useState(() => localStorage.getItem(LS_OUT_DIR) || '');

  // Crop adjuster (objectPosition X: 0=left … 50=center … 100=right)
  const [cropX,         setCropX]         = useState(() => Number(localStorage.getItem(LS_CROP_X) ?? 50));

  // Trim đầu / cuối nguồn trước khi xử lý
  const [trimStartSec,   setTrimStartSec]   = useState(0);
  const [trimEndSec,     setTrimEndSec]     = useState(0);
  // Pitch shift để lách Content ID
  const [pitchShiftOn,   setPitchShiftOn]   = useState(true);

  // Letterbox
  const [bgReplaceEnabled, setBgReplaceEnabled] = useState(false);
  const [bgImagePath,      setBgImagePath]      = useState('');
  const [bgVideoPath,      setBgVideoPath]      = useState('');
  const [bgType,           setBgType]           = useState('image'); // 'image' | 'video'
  const [bgEdgeSoftness,   setBgEdgeSoftness]   = useState(8);
  const [flipMid,          setFlipMid]          = useState(false); // scaleX(-1) cho đoạn giữa
  const bgSegRef = useRef(null); // cache MediaPipe instance

  const [lbEnabled,     setLbEnabled]     = useState(false);
  const [lbTop,         setLbTop]         = useState(() => Number(localStorage.getItem(LS_LB_TOP) || 14));
  const [lbBot,         setLbBot]         = useState(() => Number(localStorage.getItem(LS_LB_BOT) || 14));
  const [lbTopText,     setLbTopText]     = useState(() => localStorage.getItem(LS_LB_TOP_TXT) || '');
  const [lbBotText,     setLbBotText]     = useState(() => localStorage.getItem(LS_LB_BOT_TXT) || '');
  const [frameDataUrl,  setFrameDataUrl]  = useState(null);

  // Segments
  const [segments,      setSegments]      = useState([]);
  const [activeSegIdx,  setActiveSegIdx]  = useState(null);
  const [finalPath,     setFinalPath]     = useState(null);
  const [chatVideoPath, setChatVideoPath] = useState(null); // video từ chat (không qua segment)

  // Chat / code
  const [messages,      setMessages]      = useState([]);
  const [chatInput,     setChatInput]     = useState('');
  const [generatedCode, setGeneratedCode] = useState(() => localStorage.getItem(LS_LAST_CODE) || '');
  const [streamBuffer,  setStreamBuffer]  = useState('');
  const [phase,         setPhase]         = useState('idle');
  const [codeOpen,      setCodeOpen]      = useState(false);
  const [logs,          setLogs]          = useState([]);
  const [logOpen,       setLogOpen]       = useState(false);
  const [systemPrompt,  setSystemPrompt]  = useState('');
  // Tiến độ render tổng: { seg, total, pct, step }
  const [renderStatus,  setRenderStatus]  = useState({ seg: 0, total: 0, pct: 0, step: '' });

  const chatEndRef = useRef(null);
  const abortRef   = useRef(false);

  useEffect(() => {
    window.electronAPI?.remotionGetSystemPrompt?.().then(p => setSystemPrompt(p || ''));
    if (!localStorage.getItem(LS_OUT_DIR)) {
      window.electronAPI?.remotionGetDefaultOutputDir?.().then(d => { if (d) { setOutputDir(d); localStorage.setItem(LS_OUT_DIR, d); } });
    }
    const unsub = window.electronAPI?.onRemotionLog?.((l) => {
      setLogs(prev => [...prev.slice(-499), l]);
      // Parse "Rendered 560/9000 (62%)" hoặc "Encoded 8900/9000 (99%)" để cập nhật tiến độ
      const rm = l.match(/(?:Render|⚙️ Render)\s+(\d+)\/(\d+)\s*\((\d+)%\)/i);
      if (rm) {
        const pct = parseInt(rm[3]);
        setRenderStatus(s => ({ ...s, pct, step: `Render ${rm[1]}/${rm[2]}` }));
        return;
      }
      const em = l.match(/(?:Encode|🔧 Encode)\s+(\d+)\/(\d+)\s*\((\d+)%\)/i);
      if (em) {
        const pct = parseInt(em[3]);
        setRenderStatus(s => ({ ...s, pct, step: `Encode ${em[1]}/${em[2]}` }));
      }
    });
    return () => unsub?.();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamBuffer]);

  const addLog = useCallback((msg) => setLogs(prev => [...prev.slice(-499), msg]), []);

  // ── Toggle effect ─────────────────────────────────────────────────────────
  const toggleEffect = (id) => setEffects(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    localStorage.setItem(LS_EFFECTS, JSON.stringify([...next]));
    return next;
  });

  // ── Select video ──────────────────────────────────────────────────────────
  const handleSelectVideo = async () => {
    const info = await window.electronAPI?.remotionSelectSourceVideo?.();
    if (!info) return;
    setSrcVideo({ ...info, status: 'ready', uploadedUri: null });
    setGeneratedCode(''); setMessages([]); setPhase('idle');
    setSegments([]); setActiveSegIdx(null); setFinalPath(null);
    setCropX(50); localStorage.setItem(LS_CROP_X, '50');
    localStorage.removeItem(LS_LAST_CODE);
    // Auto-extract first frame for letterbox/crop preview
    setFrameDataUrl(null);
    window.electronAPI?.horrorExtractFrame?.({ videoPath: info.path, timeSec: 1 })
      .then(res => { if (res?.ok) setFrameDataUrl(res.dataUrl); })
      .catch(() => {});
  };

  // ── YouTube download ──────────────────────────────────────────────────────
  const handleDownloadYT = async () => {
    if (!ytUrl.trim() || ytPhase === 'downloading') return;
    if (!outputDir) { setYtLog('⚠ Chọn thư mục xuất trước'); return; }
    setYtPhase('downloading'); setYtLog('⏳ Đang tải...');
    try {
      const unsub = window.electronAPI?.onYtDownloadProgress?.((p) => {
        if (p.percent != null) setYtLog(`⏳ ${p.percent.toFixed(0)}% | ${p.speed || ''} ETA ${p.eta || ''}`);
        else if (p.eta) setYtLog(`⏳ ${p.eta}`);
      });
      const res = await window.electronAPI?.ytDownloadBest?.({ url: ytUrl.trim(), outputDir, quality: '1080' });
      if (typeof unsub === 'function') unsub();
      if (res?.success) { setYtLog('✅ Xong! Chọn file vừa tải.'); setYtPhase('done'); }
      else { setYtLog(`❌ ${res?.error || 'Lỗi'}`); setYtPhase('error'); }
    } catch (e) { setYtLog(`❌ ${e.message}`); setYtPhase('error'); }
  };

  // ── Build prompt ──────────────────────────────────────────────────────────
  const buildHorrorPrompt = (durationSec, extraNote = '', transcriptSegs = []) => {
    const asp = ASPECT_OPTIONS.find(a => a.value === orientation) || ASPECT_OPTIONS[0];
    // Hard cap: không bao giờ generate code render > 10 phút (18000 frames) trong 1 lần
    const cappedSec = Math.min(durationSec, 600);
    const frames = Math.round(cappedSec * 30);
    const selectedList = HORROR_PRESETS.filter(p => effects.has(p.id)).map(p => `• ${p.label}: ${p.prompt}`).join('\n');

    const letterboxSection = lbEnabled ? `
• 🎬 Letterbox cinematic (ĐẶT CUỐI CÙNG, zIndex 50, che trên tất cả):
  - Thanh đen TRÊN: AbsoluteFill top:0, height:"${lbTop}%", background:"#000", display:flex, alignItems:center, paddingLeft:20
    ${lbTopText ? `text trong thanh: "${lbTopText}", fontSize:Math.max(10, Math.round(${asp.height}*${lbTop}/100*0.35)), fontWeight:"bold", color:"#fff", opacity:0.88, letterSpacing:"0.08em"` : '(không có text)'}
  - Thanh đen DƯỚI: AbsoluteFill bottom:0, top:auto, height:"${lbBot}%", background:"#000", display:flex, alignItems:center, justifyContent:flex-end, paddingRight:20
    ${lbBotText ? `text trong thanh: "${lbBotText}", fontSize:Math.max(10, Math.round(${asp.height}*${lbBot}/100*0.32)), fontWeight:"bold", color:"#fff", opacity:0.82` : '(không có text)'}` : '';

    return `${systemPrompt ? systemPrompt + '\n\n' : ''}═══ HORROR VIDEO EDITOR — REMOTION ═══
Video nguồn đã copy vào public/input.mp4 (${cappedSec.toFixed(1)}s).
const channelName = "${channelName}";

IMPORT BẮT BUỘC: import { AbsoluteFill, Video, useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
const frame = useCurrentFrame();
const { durationInFrames: totalFrames } = useVideoConfig();

⚠️ BẮT BUỘC: <Video> PHẢI LÀ ELEMENT ĐẦU TIÊN trong return(), trước mọi overlay:
return (
  <AbsoluteFill ...>
    <AbsoluteFill style={{transform:...}}><Video src={staticFile('input.mp4')} endAt={totalFrames-1} style={{width:'100%',height:'100%',objectFit:'cover'${orientation === 'square' ? '' : `,objectPosition:'${cropX}% 50%'`},...colorFilter}} /></AbsoluteFill>
    {/* overlays sau */}
  </AbsoluteFill>
);
${orientation === 'square' ? '(Video đã cắt 1:1 — KHÔNG cần objectPosition)' : `(objectPosition '${cropX}% 50%' = vị trí đã chọn — GIỮ NGUYÊN)`}
⚠️ QUY TẮC VIDEO BẮT BUỘC — VI PHẠM SẼ LỖI:
- KHÔNG dùng startFrom trên <Video> (không được phép trừ khi thực sự cần bắt đầu từ giữa clip)
- endAt={totalFrames - 1} BẮT BUỘC — tránh seek vượt EOF → Chromium treo delayRender
- KHÔNG dùng Sequence with from > totalFrames/2 để wrap <Video>
⚠️ QUAN TRỌNG VỀ ÂM THANH:
- TUYỆT ĐỐI KHÔNG thêm muted, volume={0}, hay bất kỳ thuộc tính nào tắt âm thanh vào <Video>
- Video phải GIỮ NGUYÊN âm thanh gốc (giọng đọc, nhạc nền)
- Không import hay dùng <Audio> riêng — âm thanh lấy từ <Video> tự động
Mỗi overlay là AbsoluteFill riêng đặt TRÊN Video (pointerEvents:'none').

HIỆU ỨNG CẦN ÁP DỤNG (tất cả, không bỏ sót):
${selectedList || 'Hiệu ứng horror cơ bản'}${letterboxSection}

[DỮ LIỆU TRANSCRIPT — DÙNG ĐỂ TẠO TEXT ĐỘNG]
const SUBTITLES = SUBTITLE_PLACEHOLDER;
(SUBTITLE_PLACEHOLDER sẽ được inject tự động — KHÔNG thay đổi tên này)

Dùng SUBTITLES để tạo CÁC HÀM TEXT ĐỘNG sau (tự viết, không copy template):

// Helper: tìm câu đang nói ở frame hiện tại
const cur = SUBTITLES.find(s => frame >= s.start*30 && frame < s.end*30);

Tạo ÍT NHẤT 3 loại text layer khác nhau từ SUBTITLES:
A) TypewriterSub: câu thoại xuất hiện từng chữ, style horror (glow đỏ, border trái đỏ)
B) SceneCard: 3–4 địa điểm/thời gian trích từ transcript, slide từ trái góc trên
C) HighlightWord: 2–3 từ khóa quan trọng nhất, nổi bật với scale animation — ĐẶT position:'absolute', top:'12%' (KHÔNG dùng justifyContent:center/alignItems:center để tránh che MC ở giữa màn hình)
Bonus: ChapterTitle (tiêu đề chương, đặt top:'8%'), LowerThird (thanh tóm tắt, đặt bottom:'22%' trên subtitle)

${transcriptSegs.length ? `[LỜI THOẠI TRONG VIDEO — Whisper đã phiên âm chính xác]
${formatTranscript(transcriptSegs)}

Phân tích SUBTITLES để:
① Trích TÊN NHÂN VẬT, ĐỊA ĐIỂM, THỜI GIAN → dùng cho ChapterTitle và SceneCard
② Scan từng s.text tìm từ khóa nhóm máu/tối/sợ/hét/chạy → kích hoạt effect tương ứng tại frame s.start*30
③ Chọn 2–3 segment có nội dung drama cao nhất → HighlightWord
④ NHÂN VẬT NÓI GÌ → màn hình thể hiện điều đó: nói "bóng tối" thì tối lại, nói "máu" thì đỏ flash, nói "chạy" thì rung lắc
⑤ Mỗi text/effect đồng bộ chính xác theo s.start và s.end (nhân 30 để ra frame)
` : ''}YÊU CẦU MẶC ĐỊNH (luôn thực hiện):
${defaultInstruction}${extraNote ? `\n\nYÊU CẦU BỔ SUNG: ${extraNote}` : ''}

[RÀNG BUỘC — KHÔNG THAY ĐỔI]
COMPOSITION_WIDTH = ${asp.width}
COMPOSITION_HEIGHT = ${asp.height}
COMPOSITION_FPS = 30
COMPOSITION_DURATION_FRAMES = ${frames}
${flipMid ? `FLIP_MID = true
→ Thêm wrapper AbsoluteFill bao quanh <Video> với style={{ transform: frame >= Math.floor(totalFrames/3) && frame < Math.floor(totalFrames*2/3) ? 'scaleX(-1)' : 'none' }}
   (lật ngang MC ở đoạn giữa 1/3 → 2/3 duration)` : ''}
⚠️ VỀ TEXT LAYERS: KHÔNG đặt bất kỳ text/overlay nào tại center màn hình (tránh che mặt MC)
   Text/overlay phải ở: top ≤ 25% HOẶC bottom ≥ 75% (phần thân dưới) HOẶC góc cạnh
⚠️ CHỈ TRẢ VỀ CODE JSX THUẦN — KHÔNG GIẢI THÍCH, KHÔNG ĐÁNH SỐ, KHÔNG COMMENT THỪA.
⚠️ COMPACT: gộp các const nhỏ thành 1 dòng, không xuống hàng không cần thiết. Mục tiêu < 220 dòng.
⚠️ KẾT THÚC BẮT BUỘC bằng dòng: export default GeneratedVideo;
Bắt đầu bằng: import { AbsoluteFill, ... } from 'remotion';`;
  };

  // ── Gemini generate code ──────────────────────────────────────────────────
  // _truncatedCode: code gốc đang bị cắt (nếu đây là completion pass)
  // _keyOffset: vị trí bắt đầu trong mảng key (để mỗi pass dùng key khác)
  const generateCode = async (prompt, refParts, aiMsgId, _truncatedCode = null, _keyOffset = 0) => {
    const keys = loadKeys();
    let buffer = '';
    const raw = await callGeminiStream(keys, prompt, model, refParts, (chunk) => {
      buffer += chunk; setStreamBuffer(buffer);
    }, { startKeyOffset: _keyOffset });
    let part = sanitizeGeneratedCode(extractCode(raw));

    // Nếu là completion pass: ghép code gốc + phần đuôi vừa nhận
    let code = _truncatedCode ? (_truncatedCode + '\n' + part) : part;
    if (_truncatedCode) {
      addLog(`✅ Ghép code: ${_truncatedCode.split('\n').length} dòng + ${part.split('\n').length} dòng (key #${(_keyOffset % keys.length) + 1})`);
    }

    // Nếu code vẫn bị cắt → completion pass với key TIẾP THEO
    if (!isCodeComplete(code)) {
      const nextOffset = _keyOffset + 1;
      // Tránh loop vô tận: tối đa 2 lần completion (lần 1 + lần 2)
      if (nextOffset > 2) {
        addLog(`⚠ Code vẫn bị cắt sau ${nextOffset} pass — dừng lại`);
      } else {
        const keyLabel = keys.length > 1 ? ` (xoay sang key #${(nextOffset % keys.length) + 1})` : '';
        addLog(`⚠ Code bị cắt (${code.split('\n').length} dòng) — tiếp tục${keyLabel}...`);
        const completionPrompt = `Code Remotion JSX bị cắt ngang. Trả về PHẦN CÒN THIẾU:

\`\`\`jsx
${code.split('\n').slice(-15).join('\n')}
\`\`\`
(15 dòng cuối để biết context — ĐỪNG lặp lại phần này)

Yêu cầu:
- Đóng đủ JSX tags còn mở, đóng return(), đóng function
- Dòng cuối: export default GeneratedVideo;
- CHỈ code phần còn thiếu, KHÔNG giải thích`;
        return generateCode(completionPrompt, [], aiMsgId, code, nextOffset);
      }
    }

    setStreamBuffer('');
    setGeneratedCode(code);
    localStorage.setItem(LS_LAST_CODE, code);
    if (aiMsgId) setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'rendering' } : m));
    return code;
  };

  // ── Render one segment ────────────────────────────────────────────────────
  const renderSegment = async (code, segIndex, durationSec, subtitles = []) => {
    if (!code || code.trimStart().startsWith('```')) return { ok: false, error: 'Gemini trả về markdown thô — extractCode thất bại' };
    // Accept cả function declaration và arrow function
    const hasFunction = code.includes('function') || /const\s+\w+\s*=\s*(async\s*)?\(/.test(code) || code.includes('=>');
    if (!code.includes('import') || !hasFunction) return { ok: false, error: 'Gemini trả về văn bản thay vì code — thử gửi lại' };
    if (!isCodeComplete(code)) return { ok: false, error: `Code JSX bị cắt (${code.split('\n').length} dòng) — Gemini chưa hoàn thành` };
    // Bắt buộc phải có <Video> (staticFile) — thiếu là màn hình đen, không âm thanh
    if (!code.includes('staticFile') && !code.includes('<Video')) return { ok: false, error: 'Code thiếu <Video> component — màn hình sẽ đen. Gemini quên video nguồn.' };
    // Detect playbackRate từ code để điều chỉnh subtitle timing
    const rateMatch = code.match(/playbackRate=\{([\d.]+)\}/);
    const speedRate = rateMatch ? parseFloat(rateMatch[1]) : 1;
    const patchedCode = patchCodeSubtitles(patchCodeVideoSafe(patchCodeDuration(code, durationSec), durationSec), subtitles, speedRate);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return window.electronAPI?.remotionRenderCode?.({
      code: patchedCode,
      outputFilename: `horror_seg${segIndex}_${ts}.mp4`,
      outputDir: outputDir || undefined,
    });
  };

  // ── MediaPipe background replacement ─────────────────────────────────────
  // Tạo ảnh nền horror bằng AI (Pollinations miễn phí hoặc Gemini)
  const [bgGenLoading, setBgGenLoading] = useState(false);
  const generateBgImage = async () => {
    setBgGenLoading(true);
    try {
      // Randomize prompt để mỗi lần tạo ra ảnh khác nhau
      const BG_SCENES = [
        'haunted ancient vietnamese house interior, altar with incense, red candles dripping wax, dusty cobwebs, green mist',
        'dark abandoned temple deep in jungle, stone pillars, fireflies, moonlight through cracks, overgrown vines',
        'eerie vietnamese cemetery at night, tombstones, will-o-wisp floating lights, thick fog, bare twisted trees',
        'dilapidated old mansion corridor, peeling wallpaper, flickering oil lamp, shadows of figures, cracked mirror',
        'dark forest path at midnight, gnarled roots, pale moonlight, floating paper lanterns, dense fog',
        'flooded haunted basement, murky water reflection, broken pipes, single swinging lightbulb, decaying walls',
        'ancient vietnamese pagoda at night, red paper lanterns, incense smoke, lotus pond, mysterious silhouette',
        'crumbling war bunker, rusted iron doors, faint candlelight, water dripping, scattered old photos',
        'misty river at dusk, ghost boat with lanterns, willow trees, dark water reflection, vietnamese countryside',
        'decrepit village house, rotting wood floor, spirit offerings on altar, smoke and ash, night time',
      ];
      const BG_MOODS = ['deep shadows and volumetric fog', 'blood-red moonlight', 'sickly green supernatural glow', 'cold blue ghost light', 'amber candlelight flickering'];
      const scene = BG_SCENES[Math.floor(Math.random() * BG_SCENES.length)];
      const mood  = BG_MOODS[Math.floor(Math.random() * BG_MOODS.length)];
      const prompt = `horror background: ${scene}, ${mood}, no people, no text, cinematic 4K, ultra detailed, scary atmosphere, vertical composition`;
      addLog(`🎨 Prompt: ${scene.slice(0, 50)}...`);
      let b64, mime;
      // Thử Gemini image gen — thử lần lượt các model, xoay vòng keys
      const keys = loadKeys();
      const imgModels = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-2.0-flash-preview-image-generation'];
      outer: for (const imgModel of imgModels) {
        for (const key of keys.slice(0, 3)) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: key });
            const resp = await ai.models.generateContent({
              model: imgModel,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              config: { responseModalities: ['TEXT', 'IMAGE'] },
            });
            const part = resp?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
            if (part) { b64 = part.inlineData.data; mime = part.inlineData.mimeType || 'image/png'; addLog(`✅ Gemini ${imgModel} tạo ảnh xong`); break outer; }
          } catch (e) {
            const msg = e.message?.slice(0, 60) || '';
            if (msg.includes('404')) break; // model không tồn tại → thử model khác
            addLog(`⚠ Gemini ${imgModel}: ${msg}`);
          }
        }
      }
      // Pollinations fallback — thử không chỉ model (default free), rồi turbo, flux-schnell
      if (!b64) {
        const seed = Math.floor(Math.random() * 99999);
        // Dùng đúng cách gọi như Imagen3Studio (gptimage = DALL-E 3 qua Pollinations)
        const polModels = ['gptimage', 'flux', 'turbo'];
        for (const m of polModels) {
          try {
            addLog(`🎨 Pollinations ${m}...`);
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${m}&width=1080&height=1920&seed=${seed}&nologo=true&enhance=false&safe=false`;
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!res.ok) { addLog(`⚠ ${m}: HTTP ${res.status}`); continue; }
            const blob = await res.blob();
            if (!blob.type.startsWith('image/')) { addLog(`⚠ ${m}: không trả về ảnh`); continue; }
            mime = blob.type;
            b64 = await new Promise((r, rej) => { const rd = new FileReader(); rd.onload = () => r(rd.result.split(',')[1]); rd.onerror = rej; rd.readAsDataURL(blob); });
            addLog(`✅ Pollinations ${m} xong`);
            break;
          } catch (e) { addLog(`⚠ ${m}: ${e.message}`); }
        }
        if (!b64) throw new Error('Không tạo được ảnh — thử lại sau ít phút');
      }
      const saveRes = await window.electronAPI?.horrorBgSaveGenerated?.({ b64, mime });
      if (saveRes?.ok) { setBgImagePath(saveRes.path); addLog('✅ Ảnh nền AI đã tạo xong'); }
      else throw new Error(saveRes?.error || 'Lỗi lưu ảnh');
    } catch (e) { addLog(`❌ Tạo ảnh nền thất bại: ${e.message}`); }
    finally { setBgGenLoading(false); }
  };

  const loadSelfieSegmentation = () => new Promise((resolve, reject) => {
    if (window.SelfieSegmentation) return resolve(window.SelfieSegmentation);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js';
    s.onload = () => resolve(window.SelfieSegmentation);
    s.onerror = () => reject(new Error('Không tải được MediaPipe CDN'));
    document.head.appendChild(s);
  });

  const replaceBg = async (videoPath) => {
    const hasBg = bgType === 'video' ? !!bgVideoPath : !!bgImagePath;
    if (!bgReplaceEnabled || !hasBg) return videoPath;
    addLog('🎭 Trích xuất frames...');
    const extractRes = await window.electronAPI?.horrorBgExtractFrames?.({ videoPath });
    if (!extractRes?.ok) { addLog(`⚠ Thay nền thất bại: ${extractRes?.error} — bỏ qua`); return videoPath; }
    const { tmpDir, outDir, count, fps, width, height } = extractRes;
    addLog(`📐 ${width}×${height} @ ${fps}fps — ${count} frames`);

    // Nếu nền động: extract frames của video nền
    let bgFramesDir = null;
    let bgFrameCount = 0;
    if (bgType === 'video') {
      addLog('🎬 Trích xuất frames video nền...');
      const vfRes = await window.electronAPI?.horrorBgExtractVideoFrames?.({ videoPath: bgVideoPath, fps });
      if (!vfRes?.ok) { addLog(`⚠ Extract video nền thất bại: ${vfRes?.error} — bỏ qua thay nền`); return videoPath; }
      bgFramesDir = vfRes.framesDir;
      bgFrameCount = vfRes.count;
      addLog(`✅ Video nền: ${bgFrameCount} frames — sẽ lặp vòng`);
    }

    // Khởi tạo MediaPipe (cache để tránh tải lại)
    if (!bgSegRef.current) {
      addLog('⏳ Tải MediaPipe...');
      const SelfieSegmentation = await loadSelfieSegmentation();
      const seg = new SelfieSegmentation({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${f}`,
      });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      bgSegRef.current = seg;
      addLog('✅ MediaPipe sẵn sàng');
    }
    const seg = bgSegRef.current;

    // Load ảnh nền tĩnh (chỉ khi dùng image mode)
    let bgImg = null;
    if (bgType === 'image') {
      bgImg = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Không load được ảnh nền'));
        img.src = `file:///${bgImagePath.replace(/\\/g, '/')}`;
      });
    }

    // Canvas reuse (tránh GC mỗi frame)
    const outCanvas    = document.createElement('canvas');
    const personCanvas = document.createElement('canvas');
    const maskCanvas   = document.createElement('canvas');
    outCanvas.width = personCanvas.width = maskCanvas.width = width;
    outCanvas.height = personCanvas.height = maskCanvas.height = height;
    const outCtx    = outCanvas.getContext('2d');
    const personCtx = personCanvas.getContext('2d');
    const maskCtx   = maskCanvas.getContext('2d');

    let segMask = null;
    seg.onResults(r => { segMask = r.segmentationMask; });

    const loadImg = (src) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });

    for (let i = 1; i <= count; i++) {
      if (abortRef.current) {
        await window.electronAPI?.horrorBgCleanup?.({ tmpDir, outDir });
        if (bgFramesDir) await window.electronAPI?.horrorBgCleanup?.({ tmpDir: bgFramesDir });
        throw new Error('Đã huỷ');
      }
      const frameSrc = `file:///${(tmpDir + '/frame_' + String(i).padStart(6,'0') + '.jpg').replace(/\\/g,'/')}`;
      const frameImg = await loadImg(frameSrc);
      if (!frameImg) continue;

      // Lấy frame nền: tĩnh hoặc từ video nền (lặp vòng)
      let currentBg = bgImg;
      if (bgType === 'video' && bgFramesDir && bgFrameCount > 0) {
        const bgIdx = ((i - 1) % bgFrameCount) + 1;
        const bgSrc = `file:///${(bgFramesDir + '/frame_' + String(bgIdx).padStart(6,'0') + '.jpg').replace(/\\/g,'/')}`;
        currentBg = await loadImg(bgSrc);
      }

      segMask = null;
      await seg.send({ image: frameImg });

      outCtx.clearRect(0, 0, width, height);
      if (currentBg) outCtx.drawImage(currentBg, 0, 0, width, height);

      if (segMask) {
        // Mask mờ viền
        maskCtx.clearRect(0, 0, width, height);
        if (bgEdgeSoftness > 0) maskCtx.filter = `blur(${bgEdgeSoftness}px)`;
        maskCtx.drawImage(segMask, 0, 0, width, height);
        maskCtx.filter = 'none';
        // Person = frame nguồn cắt theo mask
        personCtx.clearRect(0, 0, width, height);
        personCtx.drawImage(frameImg, 0, 0);
        personCtx.globalCompositeOperation = 'destination-in';
        personCtx.drawImage(maskCanvas, 0, 0);
        personCtx.globalCompositeOperation = 'source-over';
        outCtx.drawImage(personCanvas, 0, 0);
      } else {
        outCtx.drawImage(frameImg, 0, 0);
      }

      const dataUrl = outCanvas.toDataURL('image/jpeg', 0.93);
      await window.electronAPI?.horrorBgSaveFrame?.({ outDir, frameIndex: i, dataUrl });

      if (i % 60 === 0 || i === count) {
        const pct = Math.round(i / count * 100);
        setRenderStatus(s => ({ ...s, pct, step: `Thay nền ${i}/${count}` }));
        addLog(`🎭 Frame ${i}/${count} (${pct}%)`);
      }
    }

    addLog('🎬 Ghép video...');
    const outPath = videoPath.replace(/\.mp4$/i, `_bg${Date.now()}.mp4`);
    const reassembleRes = await window.electronAPI?.horrorBgReassemble?.({ outDir, videoPath, outputPath: outPath, fps });
    // Cleanup tất cả temp dirs
    await window.electronAPI?.horrorBgCleanup?.({ tmpDir, outDir });
    if (bgFramesDir) await window.electronAPI?.horrorBgCleanup?.({ tmpDir: bgFramesDir });
    if (!reassembleRes?.ok) { addLog(`⚠ Ghép thất bại: ${reassembleRes?.error}`); return videoPath; }
    addLog('✅ Thay nền xong!');
    return outPath;
  };

  // ── Apply effects (handles single + multi-segment) ────────────────────────
  const handleApplyEffects = async () => {
    if (!srcVideo || isBusy) return;
    const keys = loadKeys();
    if (!keys.length) { alert('Chưa có Gemini API key. Vào Cài đặt để thêm.'); return; }
    abortRef.current = false;

    let srcPath    = srcVideo.path;
    let totalSec   = srcVideo.durationSec || 60;

    // Reset UI trước — để log pre-crop/pre-trim hiện rõ và không bị xóa
    setMessages([]); setGeneratedCode(''); setPhase('generating');
    setStreamBuffer(''); setLogs([]); setLogOpen(true);
    setFinalPath(null); setActiveSegIdx(null); setChatVideoPath(null);

    // Pre-trim đầu / cuối nếu được yêu cầu
    if (trimStartSec > 0 || trimEndSec > 0) {
      const effDur = Math.max(1, totalSec - trimStartSec - trimEndSec);
      addLog(`✂️ Pre-trim: bỏ ${trimStartSec}s đầu + ${trimEndSec}s cuối → còn ${effDur.toFixed(1)}s`);
      setRenderStatus({ seg: 0, total: 0, pct: 0, step: 'Pre-trim...' });
      const ptRes = await window.electronAPI?.horrorPreTrim?.({
        inputPath: srcPath, startSec: trimStartSec, durationSec: effDur,
      });
      if (ptRes?.ok) { srcPath = ptRes.path; totalSec = effDur; addLog('✅ Pre-trim xong'); }
      else addLog(`⚠ Pre-trim thất bại: ${ptRes?.error} — dùng video gốc`);
    }

    // Pre-crop về đúng aspect ratio trước khi BG Replace — giảm pixel/frame, tăng tốc đáng kể
    if (orientation === 'square') {
      addLog(`✂️ Pre-crop: cắt video về 1:1 trước BG Replace (-44% pixel)...`);
      setRenderStatus({ seg: 0, total: 0, pct: 0, step: 'Pre-crop 1:1...' });
      const pcRes = await window.electronAPI?.horrorPreCrop?.({
        inputPath: srcPath, outputAspect: 'square', cropX,
      });
      if (pcRes?.ok) { srcPath = pcRes.path; addLog(`✅ Pre-crop xong — ${pcRes.path.split('\\').pop()}`); }
      else addLog(`❌ Pre-crop thất bại: ${pcRes?.error || 'không rõ'} — dùng video gốc`);
    }

    const seg = { id: 0, startSec: 0, endSec: totalSec, durationSec: totalSec, status: 'pending', videoPath: null, trimPath: null, subtitles: [] };
    setSegments([seg]);

    const userMsgId = Date.now();
    const aiMsgId   = userMsgId + 1;
    const effectNames = [...effects].map(id => HORROR_PRESETS.find(p => p.id === id)?.label || id).join(', ');
    setMessages([
      { id: userMsgId, role: 'user', content: `🎬 Apply ${effects.size} effects (${fmtSec(totalSec)}): ${effectNames}` },
      { id: aiMsgId,   role: 'ai',   content: '', phase: 'generating' },
    ]);
    localStorage.setItem(LS_MODEL, model);

    if (abortRef.current) { addLog('⛔ Đã huỷ'); return; }
    setRenderStatus({ seg: 1, total: 1, pct: 0, step: 'Chuẩn bị...' });
    addLog(`\n▶ Xử lý video: ${fmtSec(totalSec)}`);

    // 1. BG Replace + Transcribe + Gemini — tất cả song song
    const doReplaceBg = async () => {
      const _hasBg = bgType === 'video' ? !!bgVideoPath : !!bgImagePath;
      if (!bgReplaceEnabled || !_hasBg) return srcPath;
      setRenderStatus(s => ({ ...s, pct: 0, step: 'Thay nền' }));
      addLog('🎭 Thay nền AI...');
      try { return await replaceBg(srcPath); }
      catch (e) { addLog(`⚠ Thay nền lỗi: ${e.message} — dùng video gốc`); return srcPath; }
    };

    const doTranscribeAndCode = async () => {
      setSegments(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: 'transcribing' } : s));
      addLog('🎤 Whisper phân tích âm thanh...');
      let subs = [];
      try {
        const tr = await doTranscribe(
          srcPath, totalSec,
          (msg) => addLog(`  📢 ${msg}`),
          (done, total, count) => { if (total > 1) addLog(`  🔤 Chunk ${done}/${total}: ${count} câu`); },
          (msg) => addLog(msg),
          (msg) => addLog(`  📦 ${msg}`),
        );
        subs = tr?.segments || [];
        addLog(`✅ Transcribe xong: ${subs.length} câu`);
      } catch (e) { addLog(`⚠ Whisper thất bại: ${e.message}`); }

      // Gemini bắt đầu ngay sau Transcribe (song song với BG Replace)
      setRenderStatus(s => ({ ...s, pct: 0, step: 'Gemini AI' }));
      setSegments(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: 'generating' } : s));
      addLog('🤖 Gemini viết code horror (song song với thay nền)...');
      try {
        const code = await generateCode(buildHorrorPrompt(totalSec, '', subs), [], aiMsgId);
        addLog(`✅ Code xong (${code.split('\n').length} dòng)`);
        return { subs, code };
      } catch (e) {
        addLog(`❌ Gemini thất bại: ${e.message}`);
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'error', content: e.message } : m));
        setPhase('error'); setStreamBuffer('');
        throw e;
      }
    };

    const _bgActive = bgReplaceEnabled && (bgType === 'video' ? !!bgVideoPath : !!bgImagePath);
    addLog(`⚡ Song song: ${_bgActive ? 'Thay nền + ' : ''}Transcribe + Gemini...`);
    let bgPath, subs, sharedCode;
    try {
      let transcodeResult;
      [bgPath, transcodeResult] = await Promise.all([doReplaceBg(), doTranscribeAndCode()]);
      subs = transcodeResult.subs;
      sharedCode = transcodeResult.code;
    } catch {
      setSegments(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: 'error' } : s));
      return;
    }
    seg.subtitles = subs;

    // 2. Copy → public/input.mp4
    addLog('📋 Copy vào public/input.mp4...');
    await window.electronAPI?.remotionCopyVideoToPublic?.({ srcPath: bgPath });

    // 3. Render
    setRenderStatus(s => ({ ...s, pct: 0, step: 'Remotion render' }));
    setSegments(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: 'rendering' } : s));
    addLog('🎞️ Render...');
    setPhase('rendering');

    const result = await renderSegment(sharedCode, 0, totalSec, subs);

    let finalPath = null;
    if (result?.ok) {
      finalPath = result.path;
      if (pitchShiftOn) {
        addLog('🎵 Pitch shift...');
        const psRes = await window.electronAPI?.horrorPitchShift?.({ inputPath: finalPath });
        if (psRes?.ok) { finalPath = psRes.path; addLog('✅ Pitch shift xong'); }
        else addLog(`⚠ Pitch shift lỗi: ${psRes?.error}`);
      }
      addLog(`✅ Xong → ${finalPath}`);
      seg.videoPath = finalPath; seg.status = 'done';
      setSegments([{ ...seg, status: 'done', videoPath: finalPath, subtitles: subs }]);
      setActiveSegIdx(0);
    } else {
      addLog(`❌ Render thất bại: ${result?.error || '?'}`);
      setSegments(prev => prev.map((s, idx) => idx === 0 ? { ...s, status: 'error' } : s));
    }

    setPhase('done');
    setRenderStatus({ seg: 0, total: 0, pct: 0, step: '' });
    setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'done' } : m));
    addLog('\n✅ Hoàn thành!');

    // Dọn cache kể cả khi render thất bại — giữ lại file kết quả nếu có
    window.electronAPI?.horrorCleanupCache?.({ keepPaths: finalPath ? [finalPath] : [] }).then(r => {
      if (r?.ok) addLog(`🧹 Dọn cache: xóa ${r.removed} file, giải phóng ${r.mb} MB`);
    });
  };

  // ── Re-render 1 segment ───────────────────────────────────────────────────
  const handleRerenderSegment = async (segIdx) => {
    if (!generatedCode || isBusy) return;
    const seg = segments[segIdx];
    if (!seg) return;
    setPhase('rendering'); setLogOpen(true);
    setSegments(prev => prev.map((s, i) => i === segIdx ? { ...s, status: 'rendering' } : s));
    addLog(`🔄 Re-render phần ${segIdx+1}...`);
    const srcPath = seg.trimPath || srcVideo?.path;
    if (srcPath) await window.electronAPI?.remotionCopyVideoToPublic?.({ srcPath });
    const result = await renderSegment(generatedCode, segIdx, seg.durationSec, seg.subtitles || []);
    if (result?.ok) {
      setSegments(prev => prev.map((s, i) => i === segIdx ? { ...s, status: 'done', videoPath: result.path } : s));
      setActiveSegIdx(segIdx); setFinalPath(null);
      addLog(`✅ Phần ${segIdx+1} re-render xong`);
    } else {
      setSegments(prev => prev.map((s, i) => i === segIdx ? { ...s, status: 'error' } : s));
      addLog(`❌ ${result?.error || 'Thất bại'}`);
    }
    setPhase('done');
  };

  // ── Chat (iterative refinement) ───────────────────────────────────────────
  const handleChat = async () => {
    const userMsg = chatInput.trim();
    // Cho phép gửi khi chatInput rỗng nếu có defaultInstruction (chỉ dùng lệnh mặc định)
    if (isBusy) return;
    if (!userMsg && !defaultInstruction.trim()) return;
    setChatInput('');
    const keys = loadKeys();
    if (!keys.length || !srcVideo) {
      const ts = Date.now();
      setMessages(prev => [...prev,
        { id: ts, role: 'user', content: userMsg || '[Lệnh mặc định]' },
        { id: ts+1, role: 'ai', content: !srcVideo ? 'Chọn video nguồn trước.' : 'Cần Gemini API key.', phase: 'error' },
      ]); return;
    }
    const userMsgId = Date.now(), aiMsgId = userMsgId + 1;
    const displayMsg = userMsg || `[Lệnh mặc định] ${defaultInstruction.slice(0, 60)}${defaultInstruction.length > 60 ? '...' : ''}`;
    setMessages(prev => [...prev,
      { id: userMsgId, role: 'user', content: displayMsg },
      { id: aiMsgId,   role: 'ai',   content: '', phase: 'generating' },
    ]);
    setPhase('generating'); setStreamBuffer(''); setLogOpen(true);

    // Dùng segment đang active nếu có, ngược lại dùng cả video
    const activeSeg   = segments[activeSegIdx];
    const rawDuration = srcVideo.durationSec || 60;
    const durationSec = activeSeg ? activeSeg.durationSec : rawDuration;

    let workPath = activeSeg?.trimPath || srcVideo.path;
    addLog(`📋 Copy vào public/input.mp4...`);
    const copyRes = await window.electronAPI?.remotionCopyVideoToPublic?.({ srcPath: workPath });
    if (!copyRes?.success) addLog(`⚠ Copy thất bại: ${copyRes?.error || 'unknown'} — dùng video cũ trong public`);
    else addLog('✅ Copy xong');

    // Transcribe audio (chỉ khi tạo code lần đầu — không tốn thêm thời gian khi edit code)
    let chatSubtitles = activeSeg?.subtitles || [];
    if (!generatedCode && !activeSeg) {
      addLog('🎤 Whisper phân tích âm thanh...');
      try {
        const tr = await doTranscribe(
          workPath,
          durationSec,
          (msg) => addLog(`  📢 ${msg}`),
          (done, total, count) => { if (total > 1) addLog(`  🔤 Chunk ${done}/${total}: ${count} câu`); },
          (msg) => addLog(msg),
          (msg) => addLog(`  📦 ${msg}`),
        );
        chatSubtitles = tr?.segments || [];
        addLog(`✅ Transcribe xong: ${chatSubtitles.length} câu`);
      } catch (e) {
        addLog(`⚠ Whisper thất bại: ${e.message} — bỏ qua subtitle`);
      }
    }

    const combinedRequest = defaultInstruction
      ? `${defaultInstruction}${userMsg ? `\n${userMsg}` : ''}`
      : userMsg;
    let finalPrompt = generatedCode
      ? `[CODE REMOTION HIỆN TẠI — giữ nguyên tất cả hiệu ứng, cập nhật theo yêu cầu]\n\`\`\`jsx\n${generatedCode}\n\`\`\`\n\n[YÊU CẦU MẶC ĐỊNH — luôn đảm bảo]\n${defaultInstruction}${userMsg ? `\n\n[YÊU CẦU BỔ SUNG]\n${userMsg}` : ''}\n\nTrả về CODE JSX HOÀN CHỈNH. Không giải thích.`
      : buildHorrorPrompt(durationSec, combinedRequest, chatSubtitles);

    try {
      const code = await generateCode(finalPrompt, [], aiMsgId);
      setPhase('rendering');
      const segIdx = activeSegIdx ?? 0;
      const result = await renderSegment(code, segIdx, durationSec, chatSubtitles);
      if (result?.ok) {
        if (activeSeg) {
          setSegments(prev => prev.map((s, i) => i === segIdx ? { ...s, status: 'done', videoPath: result.path } : s));
          setActiveSegIdx(segIdx);
        } else {
          // Không có segment đang active → lưu vào chatVideoPath để hiện preview
          setChatVideoPath(result.path);
        }
        setFinalPath(null); setPhase('done');
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'done', videoPath: result.path } : m));
      } else {
        setPhase('error');
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'error', content: result?.error || 'Render thất bại' } : m));
      }
    } catch (e) {
      setPhase('error'); setStreamBuffer('');
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase: 'error', content: e.message } : m));
    }
  };

  // ── Other ─────────────────────────────────────────────────────────────────
  const handleNewSession = () => {
    setMessages([]); setGeneratedCode(''); setPhase('idle');
    setSegments([]); setActiveSegIdx(null); setFinalPath(null);
    setChatVideoPath(null);
    setLogs([]); setChatInput(''); setStreamBuffer('');
    localStorage.removeItem(LS_LAST_CODE);
  };

  const handleClearVideo = () => {
    setSrcVideo(null); setFrameDataUrl(null); handleNewSession();
  };

  const handleSelectOutputDir = async () => {
    const dir = await window.electronAPI?.remotionSelectOutputDir?.();
    if (dir) { setOutputDir(dir); localStorage.setItem(LS_OUT_DIR, dir); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const isBusy     = phase === 'generating' || phase === 'rendering';
  const donePaths  = segments.filter(s => s.status === 'done' && s.videoPath).map(s => s.videoPath);
  const previewSrc = finalPath
    || (activeSegIdx !== null ? segments[activeSegIdx]?.videoPath : null)
    || chatVideoPath;
  const previewLbl = finalPath ? '🎬 Video cuối'
    : activeSegIdx !== null   ? '🎬 Kết quả'
    : chatVideoPath           ? '🎬 Preview chat'
    : null;
  const grouped = Object.entries(CAT_META)
    .sort((a,b) => a[1].order - b[1].order)
    .map(([cat, meta]) => ({ cat, ...meta, presets: HORROR_PRESETS.filter(p => p.cat === cat) }));

  return (
    <div className="flex w-full h-full bg-[#0a0f18] text-slate-200 font-sans overflow-hidden">

      {/* ── LEFT ── */}
      <div className="w-[340px] shrink-0 bg-[#0d1424] border-r border-slate-800 flex flex-col h-full overflow-y-auto custom-scrollbar">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-[14px] font-black text-white flex items-center gap-2"><Wand2 className="w-4 h-4 text-rose-400" /> Horror Editor</h1>
            <p className="text-[10px] text-slate-500">Video gốc → Presets → Remotion → MP4</p>
          </div>
          {(messages.length > 0 || segments.length > 0) && (
            <button onClick={handleNewSession} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-700 px-2 py-1 rounded-lg transition-all">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>

        <div className="flex-1 p-4 space-y-4">

          {/* Source video */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"><Clapperboard className="w-3 h-3" /> Video gốc</label>
            {!srcVideo ? (
              <button onClick={handleSelectVideo} className="w-full h-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-700 hover:border-rose-500 rounded-xl text-slate-600 hover:text-rose-400 transition-all bg-slate-900/20 hover:bg-rose-900/10">
                <Film className="w-6 h-6" />
                <span className="text-[11px] font-bold">Nhấn để chọn video</span>
              </button>
            ) : (
              <div className="bg-[#0e1628] border border-rose-900/50 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-rose-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-200 truncate">{srcVideo.name}</p>
                    <p className="text-[9px] text-slate-500">
                      {fmtSize(srcVideo.size)} • {srcVideo.durationSec > 0 ? fmtSec(srcVideo.durationSec) : '?'}
                    </p>
                  </div>
                  <button onClick={handleClearVideo} className="text-slate-600 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                </div>
                <button onClick={handleSelectVideo} className="w-full text-[10px] text-slate-600 hover:text-slate-400 text-center py-0.5">↺ Đổi video</button>
              </div>
            )}
          </div>

          {/* YouTube */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"><Youtube className="w-3 h-3 text-red-500" /> Tải từ YouTube</label>
            <div className="flex gap-1.5">
              <input value={ytUrl} onChange={e => setYtUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..."
                className="flex-1 bg-[#131d30] border border-slate-700 text-slate-200 text-[11px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-red-500 placeholder-slate-700 min-w-0" />
              <button onClick={handleDownloadYT} disabled={!ytUrl.trim() || ytPhase === 'downloading' || !outputDir}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {ytPhase === 'downloading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Tải'}
              </button>
            </div>
            {ytLog && <p className={`text-[10px] mt-1 ${ytLog.startsWith('✅') ? 'text-emerald-400' : ytLog.startsWith('❌') ? 'text-red-400' : 'text-amber-400'}`}>{ytLog}</p>}
          </div>

          {/* Orientation */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Định dạng xuất</label>
            <div className="flex gap-1.5">
              {ASPECT_OPTIONS.map(a => (
                <button key={a.value} onClick={() => { setOrientation(a.value); localStorage.setItem(LS_ORIENT, a.value); }}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${orientation === a.value ? 'bg-rose-700 border-rose-500 text-white' : 'bg-[#131d30] border-slate-700 text-slate-400 hover:border-rose-600/50'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Crop adjuster — chỉ hiện khi output cần cắt ngang (1:1 hoặc 9:16) */}
          {(orientation === 'square' || orientation === 'portrait') && (
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#0e1628]">
                <Scissors className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <div className="flex-1">
                  <span className="text-[11px] font-bold text-rose-200">✂ Chỉnh vùng cắt</span>
                  <p className="text-[9px] text-slate-600">
                    Video 16:9 → {orientation === 'square' ? '1:1 (cắt 2 bên ~21%)' : '9:16 (cắt 2 bên ~34%)'}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-rose-400">{Math.round(cropX)}%</span>
              </div>
              <div className="px-3 pb-3 pt-1 bg-[#080d1a]">
                <CropAdjuster
                  frameUrl={frameDataUrl}
                  orientation={orientation}
                  posX={cropX}
                  onPosX={v => { setCropX(v); localStorage.setItem(LS_CROP_X, v); }}
                />
              </div>
            </div>
          )}


          {/* Horror presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-rose-400" /> Horror Presets
                <span className="bg-rose-900/40 text-rose-400 text-[9px] px-1.5 py-0.5 rounded-full">{effects.size}</span>
              </label>
              <div className="flex gap-1.5">
                <button onClick={() => { const all = new Set(HORROR_PRESETS.map(p => p.id)); setEffects(all); localStorage.setItem(LS_EFFECTS, JSON.stringify([...all])); }} className="text-[9px] text-rose-500 hover:text-rose-300">Chọn tất</button>
                <span className="text-slate-700">|</span>
                <button onClick={() => { setEffects(new Set()); localStorage.setItem(LS_EFFECTS, '[]'); }} className="text-[9px] text-slate-600 hover:text-slate-400">Bỏ tất</button>
              </div>
            </div>
            <div className="space-y-3">
              {grouped.map(({ cat, label: catLabel, presets }) => (
                <div key={cat}>
                  <p className="text-[10px] font-bold text-slate-600 mb-1.5">{catLabel}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {presets.map(preset => {
                      const active = effects.has(preset.id);
                      return (
                        <button key={preset.id} onClick={() => toggleEffect(preset.id)}
                          className={`relative text-left px-2.5 py-2 rounded-lg border text-[10px] font-semibold transition-all ${active ? 'bg-rose-900/40 border-rose-600/70 text-rose-200' : 'bg-[#131d30] border-slate-700 text-slate-400 hover:border-rose-700/40'}`}>
                          {active && <Check className="w-2.5 h-2.5 absolute top-1.5 right-1.5 text-rose-400" />}
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Letterbox cinematic */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <button onClick={() => setLbEnabled(v => !v)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all ${lbEnabled ? 'bg-rose-900/30' : 'bg-[#0e1628] hover:bg-slate-800/50'}`}>
              <Maximize2 className={`w-3.5 h-3.5 shrink-0 ${lbEnabled ? 'text-rose-400' : 'text-slate-600'}`} />
              <div className="flex-1">
                <span className={`text-[11px] font-bold ${lbEnabled ? 'text-rose-200' : 'text-slate-400'}`}>🎬 Letterbox cinematic</span>
                <p className="text-[9px] text-slate-600">Thanh đen trên/dưới — tập trung vào nhân vật</p>
              </div>
              <div className={`w-8 h-4 rounded-full transition-all relative ${lbEnabled ? 'bg-rose-600' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${lbEnabled ? 'left-4' : 'left-0.5'}`} />
              </div>
            </button>
            {lbEnabled && (
              <div className="px-3 pb-3 pt-2 bg-[#080d1a] space-y-2">
                <LetterboxAdjuster
                  frameUrl={frameDataUrl}
                  topPct={lbTop} bottomPct={lbBot}
                  onTop={v => { setLbTop(v); localStorage.setItem(LS_LB_TOP, v); }}
                  onBottom={v => { setLbBot(v); localStorage.setItem(LS_LB_BOT, v); }}
                  topText={lbTopText} bottomText={lbBotText}
                  onTopText={v => { setLbTopText(v); localStorage.setItem(LS_LB_TOP_TXT, v); }}
                  onBottomText={v => { setLbBotText(v); localStorage.setItem(LS_LB_BOT_TXT, v); }}
                />
              </div>
            )}
          </div>

          {/* Flip mid section */}
          <button onClick={() => setFlipMid(v => !v)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-xl border transition-all ${flipMid ? 'bg-cyan-900/25 border-cyan-700/60' : 'bg-[#0e1628] border-slate-800 hover:bg-slate-800/50'}`}>
            <svg className={`w-3.5 h-3.5 shrink-0 ${flipMid ? 'text-cyan-400' : 'text-slate-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            <div className="flex-1">
              <span className={`text-[11px] font-bold ${flipMid ? 'text-cyan-200' : 'text-slate-400'}`}>↔ Lật ngang đoạn giữa</span>
              <p className="text-[9px] text-slate-600">scaleX(-1) cho MC ở 1/3 → 2/3 video</p>
            </div>
            <div className={`w-8 h-4 rounded-full transition-all relative ${flipMid ? 'bg-cyan-600' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${flipMid ? 'left-4' : 'left-0.5'}`} />
            </div>
          </button>

          {/* Default instruction */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-amber-400" /> Lệnh mặc định Gemini
              </label>
              <button onClick={() => { setDefaultInstruction(DEFAULT_INSTRUCTION); localStorage.setItem(LS_DEFAULT_INSTR, DEFAULT_INSTRUCTION); }}
                className="text-[9px] text-slate-600 hover:text-amber-400 transition-colors">Reset</button>
            </div>
            <textarea
              value={defaultInstruction}
              onChange={e => { setDefaultInstruction(e.target.value); localStorage.setItem(LS_DEFAULT_INSTR, e.target.value); }}
              rows={3}
              placeholder="Lệnh luôn gửi kèm Gemini mỗi lần tạo code..."
              className="w-full bg-[#131d30] border border-amber-900/40 text-slate-200 text-[11px] rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 resize-none custom-scrollbar placeholder-slate-600"
            />
            <p className="text-[9px] text-slate-700 mt-0.5">Tự động thêm vào mọi lệnh → chat gõ thêm để bổ sung</p>
          </div>

          {/* Channel name */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Tên kênh</label>
            <input value={channelName} onChange={e => { setChannelName(e.target.value); localStorage.setItem(LS_CHANNEL, e.target.value); }}
              placeholder="@TenKenh"
              className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-lg px-3 py-2 focus:outline-none focus:border-rose-500 placeholder-slate-600" />
          </div>

          {/* Model */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Gemini Model</label>
            <select value={model} onChange={e => { setModel(e.target.value); localStorage.setItem(LS_MODEL, e.target.value); }}
              className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-lg px-3 py-2 focus:outline-none focus:border-rose-500">
              {GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>

          {/* Cắt đầu / cuối + Pitch shift */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[#0e1628]">
              <span className="text-[11px] font-bold text-slate-400">✂️ Cắt đầu / cuối</span>
              <span className="text-[9px] text-slate-600 ml-auto">giây</span>
            </div>
            <div className="px-3 pb-3 pt-1 bg-[#0a1020] space-y-2">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[9px] text-slate-500 block mb-1">Bỏ đầu</label>
                  <input type="number" min="0" max="300" step="1" value={trimStartSec}
                    onChange={e => setTrimStartSec(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-[#131d30] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-cyan-300 font-mono text-center focus:outline-none focus:border-cyan-600" />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] text-slate-500 block mb-1">Bỏ cuối</label>
                  <input type="number" min="0" max="300" step="1" value={trimEndSec}
                    onChange={e => setTrimEndSec(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-[#131d30] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-cyan-300 font-mono text-center focus:outline-none focus:border-cyan-600" />
                </div>
              </div>
              <button onClick={() => setPitchShiftOn(v => !v)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all text-[10px] font-medium ${pitchShiftOn ? 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300' : 'border-slate-700 bg-[#131d30] text-slate-500'}`}>
                <span>🎵 Pitch shift lách Content ID</span>
                <div className={`w-7 h-3.5 rounded-full relative transition-all ${pitchShiftOn ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${pitchShiftOn ? 'left-3.5' : 'left-0.5'}`} />
                </div>
              </button>
            </div>
          </div>

          {/* Thay nền AI */}
          <div className={`border rounded-xl overflow-hidden ${bgReplaceEnabled ? 'border-violet-700/60' : 'border-slate-800'}`}>
            <button onClick={() => setBgReplaceEnabled(v => !v)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all ${bgReplaceEnabled ? 'bg-violet-900/25' : 'bg-[#0e1628] hover:bg-slate-800/50'}`}>
              <Layers className={`w-3.5 h-3.5 shrink-0 ${bgReplaceEnabled ? 'text-violet-400' : 'text-slate-600'}`} />
              <div className="flex-1 min-w-0">
                <span className={`text-[11px] font-bold ${bgReplaceEnabled ? 'text-violet-200' : 'text-slate-400'}`}>🎭 Thay nền AI</span>
                {bgReplaceEnabled && (bgImagePath || bgVideoPath) && <div className="text-[9px] text-violet-400 truncate">{bgType === 'video' ? '🎬 ' + bgVideoPath.split(/[\\/]/).pop() : bgImagePath.split(/[\\/]/).pop()}</div>}
              </div>
              <div className={`w-8 h-4 rounded-full transition-all relative shrink-0 ${bgReplaceEnabled ? 'bg-violet-600' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${bgReplaceEnabled ? 'left-4' : 'left-0.5'}`} />
              </div>
            </button>
            {bgReplaceEnabled && (
              <div className="px-3 pb-3 pt-2 bg-violet-950/15 space-y-2">
                {/* Toggle image / video */}
                <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5">
                  <button onClick={() => setBgType('image')}
                    className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all ${bgType === 'image' ? 'bg-violet-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    🖼 Ảnh tĩnh
                  </button>
                  <button onClick={() => setBgType('video')}
                    className={`flex-1 py-1 rounded-md text-[10px] font-bold transition-all ${bgType === 'video' ? 'bg-violet-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    🎬 Video động
                  </button>
                </div>

                {/* Image mode */}
                {bgType === 'image' && (bgImagePath ? (
                  <div className="relative">
                    <img src={`file:///${bgImagePath.replace(/\\/g,'/')}`} alt="bg" className="w-full h-20 object-cover rounded-lg border border-violet-700/40" />
                    <button onClick={() => setBgImagePath('')}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/80 text-white text-[9px] rounded-full flex items-center justify-center">✕</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={async () => { const f = await window.electronAPI?.selectFile?.(); if (f) setBgImagePath(f); }}
                      className="flex-1 py-3 border border-dashed border-violet-600/50 rounded-lg text-[10px] text-violet-400 hover:bg-violet-900/20 flex items-center justify-center gap-1.5 transition-all">
                      🖼 Chọn ảnh
                    </button>
                    <button onClick={generateBgImage} disabled={bgGenLoading}
                      className="flex-1 py-3 border border-dashed border-fuchsia-600/50 rounded-lg text-[10px] text-fuchsia-400 hover:bg-fuchsia-900/20 flex items-center justify-center gap-1.5 transition-all disabled:opacity-40">
                      {bgGenLoading ? '⏳ Đang tạo...' : '🤖 Tạo AI'}
                    </button>
                  </div>
                ))}

                {/* Video mode */}
                {bgType === 'video' && (bgVideoPath ? (
                  <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-2 py-2 border border-violet-700/40">
                    <span className="text-base">🎬</span>
                    <span className="flex-1 text-[10px] text-violet-300 truncate">{bgVideoPath.split(/[\\/]/).pop()}</span>
                    <button onClick={() => setBgVideoPath('')}
                      className="w-5 h-5 bg-slate-700 text-white text-[9px] rounded-full flex items-center justify-center shrink-0">✕</button>
                  </div>
                ) : (
                  <button onClick={async () => { const f = await window.electronAPI?.selectFile?.(); if (f) setBgVideoPath(f); }}
                    className="w-full py-3 border border-dashed border-violet-600/50 rounded-lg text-[10px] text-violet-400 hover:bg-violet-900/20 flex items-center justify-center gap-1.5 transition-all">
                    🎬 Chọn video nền (MP4/MOV)
                  </button>
                ))}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] text-slate-500 shrink-0">Mờ viền</span>
                  <input type="range" min="0" max="20" step="1" value={bgEdgeSoftness} onChange={e => setBgEdgeSoftness(+e.target.value)}
                    className="flex-1 h-1 accent-violet-500" />
                  <span className="text-[9px] text-violet-400 font-mono w-6 text-right shrink-0">{bgEdgeSoftness}px</span>
                </div>
                {bgType === 'video' && <p className="text-[8px] text-amber-600/80 leading-relaxed">⏱ Video nền sẽ được extract frames trước (~1-2 phút). Lặp vòng nếu video nền ngắn hơn video gốc.</p>}
                <p className="text-[8px] text-slate-600 leading-relaxed">Dùng MediaPipe AI — cần internet lần đầu.</p>
              </div>
            )}
          </div>

          {/* Output dir */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Thư mục xuất</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-[#131d30] border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-slate-400 truncate min-w-0">
                {outputDir || <span className="text-slate-600 italic">Chưa chọn...</span>}
              </div>
              <button onClick={handleSelectOutputDir} className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg text-[10px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600">
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Apply */}
          <button onClick={handleApplyEffects} disabled={!srcVideo || isBusy || effects.size === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[13px] disabled:opacity-40 disabled:cursor-not-allowed text-white bg-gradient-to-r from-rose-700 to-red-600 hover:from-rose-600 hover:to-red-500 transition-all shadow-lg">
            {isBusy
              ? <><Loader2 className="w-4 h-4 animate-spin" />{phase === 'generating' ? ' Gemini viết code...' : ' Đang render...'}</>
              : <><Sparkles className="w-4 h-4" /> Apply {effects.size} Effects + Render</>}
          </button>

          {isBusy && (
            <button onClick={() => { abortRef.current = true; }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl font-bold text-[11px] bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-700 transition-all">
              <X className="w-3.5 h-3.5" /> Huỷ
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0f18]">

        {/* Header */}
        <div className={`border-b border-slate-800 px-5 flex items-center justify-between shrink-0 bg-[#0d1424] ${isBusy && renderStatus.total > 0 ? 'flex-col items-start py-2 gap-1.5' : 'h-11'}`}>
          <div className="flex items-center justify-between w-full">
            <span className="flex items-center gap-2 text-[12px] font-bold text-slate-400">
              {isBusy && <Loader2 className="w-4 h-4 animate-spin text-rose-400" />}
              {phase === 'generating' ? '🤖 Gemini đang viết code...'
               : phase === 'rendering' && renderStatus.total > 0
                 ? `🎞️ Phần ${renderStatus.seg}/${renderStatus.total} — ${renderStatus.step}`
               : phase === 'rendering' ? '🎞️ Remotion render...'
               : finalPath ? '🎬 Video final sẵn sàng!'
               : segments.length > 0 ? '✅ Render xong!'
               : '💀 Chọn video + effects → Apply'}
            </span>
            {generatedCode && (
              <button onClick={() => setCodeOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-rose-400 border border-slate-700 px-2 py-1 rounded transition-colors">
                <Code2 className="w-3 h-3" /> {codeOpen ? 'Ẩn' : 'Code'}
              </button>
            )}
          </div>
          {/* Progress bar tổng — chỉ hiện khi đang render */}
          {isBusy && renderStatus.total > 0 && (
            <div className="w-full space-y-0.5">
              {/* Overall segment progress */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.round(((renderStatus.seg - 1) / renderStatus.total) * 100)}%` }} />
                </div>
                <span className="text-[9px] text-slate-500 w-12 text-right shrink-0">
                  {renderStatus.seg - 1}/{renderStatus.total} phần
                </span>
              </div>
              {/* Current step render % */}
              {renderStatus.pct > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 transition-all duration-200 rounded-full"
                      style={{ width: `${renderStatus.pct}%` }} />
                  </div>
                  <span className="text-[9px] text-rose-400 w-12 text-right shrink-0 font-mono">
                    {renderStatus.pct}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Code viewer (collapsible) */}
        {generatedCode && codeOpen && (
          <div className="shrink-0 border-b border-slate-800 bg-[#080d1a] max-h-44 overflow-y-auto custom-scrollbar">
            <pre className="text-[10px] font-mono text-slate-400 p-4 whitespace-pre-wrap">{generatedCode}</pre>
          </div>
        )}

        {/* Preview + segment grid */}
        <div className={`shrink-0 p-3 space-y-2 border-b border-slate-800 bg-[#0b1020] overflow-y-auto custom-scrollbar ${previewSrc ? 'max-h-96' : 'max-h-24'} transition-all duration-300`}>
          <PreviewPlayer src={previewSrc} label={previewLbl} />

          {segments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                  <Layers className="w-3 h-3 text-cyan-400" /> {segments.length} phần
                  <span className="text-[9px] text-slate-700">• click để xem preview</span>
                </span>
              </div>
              <SegmentGrid segments={segments} activeIdx={activeSegIdx}
                onSelect={(i) => { setActiveSegIdx(i); setFinalPath(null); }}
                onRerenderOne={handleRerenderSegment} isBusy={isBusy} />
              {finalPath && (
                <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-[10px] text-emerald-300 font-bold flex-1 truncate">{finalPath}</p>
                  <button onClick={() => window.electronAPI?.remotionOpenVideo?.(finalPath)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white">
                    <Play className="w-2.5 h-2.5" /> Phát
                  </button>
                  <button onClick={() => window.electronAPI?.remotionOpenDir?.(outputDir)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white">
                    <FolderOpen className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-slate-700">
              <Wand2 className="w-8 h-8 mb-2 opacity-20" />
              <p className="text-[11px] font-bold text-slate-600">Horror AI Video Editor</p>
              <p className="text-[10px] mt-1 text-slate-700 text-center max-w-xs">
                {srcVideo
                  ? fmtSec(srcVideo.durationSec)
                  : 'Chọn video → tick effects → Apply'}
              </p>
            </div>
          ) : messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-rose-900/25 border border-rose-700/40 text-slate-200' : 'bg-[#0d1424] border border-slate-700/80 text-slate-300'}`}>
                {msg.role === 'user' && <p className="text-[12px] whitespace-pre-wrap">{msg.content}</p>}
                {msg.role === 'ai' && msg.phase === 'generating' && (
                  <div>
                    <p className="text-[10px] text-rose-400 font-bold mb-1 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Gemini viết code horror...</p>
                    {streamBuffer && <pre className="text-[9px] font-mono text-slate-600 whitespace-pre-wrap max-h-16 overflow-hidden">{streamBuffer.slice(-300)}</pre>}
                  </div>
                )}
                {msg.role === 'ai' && msg.phase === 'rendering' && (
                  <p className="text-[11px] text-amber-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Remotion đang render...</p>
                )}
                {msg.role === 'ai' && msg.phase === 'done' && (
                  <p className="text-[11px] text-emerald-400 font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Render xong!
                  </p>
                )}
                {msg.role === 'ai' && msg.phase === 'error' && (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-300">{msg.content}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Log */}
        <LogPanel logs={logs} open={logOpen} onToggle={() => setLogOpen(v => !v)} onClear={() => setLogs([])} />

        {/* Chat input */}
        <div className="border-t border-slate-800 px-4 py-3 bg-[#0d1424] shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isBusy) { e.preventDefault(); handleChat(); } }}
              placeholder={generatedCode
                ? `Bổ sung${activeSegIdx !== null ? ` phần ${activeSegIdx+1}` : ''}: "Tăng vignette", "Thêm tuyết rơi", "Chữ đỏ tên nhân vật"...`
                : 'Bổ sung (tùy chọn): để trống = dùng lệnh mặc định, hoặc gõ thêm yêu cầu riêng...'}
              rows={2} disabled={isBusy || !srcVideo}
              className="flex-1 bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-xl px-3 py-2.5 focus:outline-none focus:border-rose-500 resize-none custom-scrollbar placeholder-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button onClick={handleChat} disabled={isBusy || (!chatInput.trim() && !defaultInstruction.trim()) || !srcVideo}
              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-rose-700 hover:bg-rose-600 disabled:bg-slate-700 disabled:opacity-40 text-white transition-all">
              {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[9px] text-slate-700 mt-1.5">
            Enter gửi lệnh chỉnh sửa → auto re-render{activeSegIdx !== null ? ` phần ${activeSegIdx+1}` : ''} • Gemini chỉ gọi 1 lần cho video dài
          </p>
        </div>
      </div>
    </div>
  );
}
