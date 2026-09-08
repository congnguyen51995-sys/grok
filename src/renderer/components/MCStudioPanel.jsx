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
function loadKeys()        { try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS)  || '[]'); } catch { return []; } }
function loadGeminiModel() { return localStorage.getItem(LS_GEMINI_MODEL) || 'gemini-2.0-flash'; }

async function callGemini(apiKeys, prompt, maxTokens = 8192, model) {
  const useModel = model || loadGeminiModel();
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const ls = await ai.models.generateContentStream({
      model: useModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.85, maxOutputTokens: maxTokens },
    });
    let text = '';
    for await (const chunk of ls) { text += chunk.text || ''; }
    return text;
  }, apiKeys, { maxCycles: 3 });
}

// ─── TTS voices ───────────────────────────────────────────────────────────────
const MC_EDGE_VOICES = [
  { id: 'vi-VN-HoaiMyNeural',  label: '🇻🇳 Hoài My (Nữ)'    },
  { id: 'vi-VN-NamMinhNeural', label: '🇻🇳 Nam Minh (Nam)'   },
  { id: 'en-US-JennyNeural',   label: '🇺🇸 Jenny (Female)'   },
  { id: 'en-US-GuyNeural',     label: '🇺🇸 Guy (Male)'       },
  { id: 'en-GB-SoniaNeural',   label: '🇬🇧 Sonia (Female)'   },
  { id: 'zh-CN-XiaoxiaoNeural',label: '🇨🇳 Xiaoxiao (Nữ)'   },
  { id: 'ja-JP-NanamiNeural',  label: '🇯🇵 Nanami (Nữ)'     },
  { id: 'ko-KR-SunHiNeural',   label: '🇰🇷 SunHi (Nữ)'     },
];

const MC_GEMINI_VOICES = [
  { id: 'Aoede',  label: 'Aoede (Nữ, truyền cảm)' },
  { id: 'Charon', label: 'Charon (Nam, chuẩn)'     },
  { id: 'Fenrir', label: 'Fenrir (Nam, mạnh mẽ)'   },
  { id: 'Kore',   label: 'Kore (Nữ, rõ ràng)'      },
  { id: 'Puck',   label: 'Puck (Nam, vui tươi)'    },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash',               label: 'Gemini 2.0 Flash'         },
  { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview' },
  { id: 'gemini-2.5-pro',                 label: 'Gemini 2.5 Pro'           },
];

const STORY_LANGS   = ['Tiếng Việt','English','Tiếng Nhật','Tiếng Hàn','Tiếng Trung'];
const STORY_GENRES  = ['Truyện ma','Trinh thám','Tình cảm','Hành động','Kỳ ảo','Lịch sử','Kinh dị','Hài hước','Tâm lý','Khoa học viễn tưởng'];
const STORY_STYLES  = ['Kể chuyện','Hứng khởi','Trữ tình','Hài hước','Nghiêm túc','Nhẹ nhàng'];
const WORD_COUNTS   = [{ value:500,label:'~500 từ' },{ value:1000,label:'~1000 từ' },{ value:2000,label:'~2000 từ' },{ value:3000,label:'~3000 từ' },{ value:5000,label:'~5000 từ' }];

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
// Vẽ preview layout (không render thực, chỉ mô phỏng vị trí)
function CanvasPreview({ outputAspect, mcPos, scenePos, logoPos, chNamePos, subtitlePos,
  channelName, chNameColor, chNameFontSize, subtitleEnabled, showWaveform, waveStyle,
  onDragMC, onDragScene, onDragLogo, onDragChName, onDragSubtitle,
  logoFile, sceneVideo, sceneFolder, sceneImage, bgVideoFile, bgFolder }) {

  const canvasRef = useRef(null);
  const dragging  = useRef(null);   // { type, startX, startY, origPos }
  const is916 = outputAspect === '9:16';
  const CW = is916 ? 270 : 480;
  const CH = is916 ? 480 : 270;

  const pct2px = (pos, cw, ch) => ({ x: pos.x / 100 * cw, y: pos.y / 100 * ch });
  const px2pct = (x, y, cw, ch) => ({ x: Math.max(0, Math.min(100, x / cw * 100)), y: Math.max(0, Math.min(100, y / ch * 100)) });

  const fsSz = { small: 10, medium: 13, large: 17 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, CW, CH);

    // Grid dots
    ctx.fillStyle = '#1e293b';
    for (let x = 20; x < CW; x += 20) for (let y = 20; y < CH; y += 20) { ctx.beginPath(); ctx.arc(x, y, 0.5, 0, Math.PI*2); ctx.fill(); }

    // BG video indicator
    if (bgVideoFile || bgFolder) {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(4, 4, CW-8, CH-8);
      ctx.fillStyle = '#334155';
      ctx.font = '9px monospace';
      ctx.fillText('BG', 8, 14);
    }

    // Scene video / image
    if (sceneVideo || sceneFolder || sceneImage) {
      const sp = pct2px(scenePos, CW, CH);
      const sw = CW * 0.28;
      const sh = sw * (is916 ? 9/16 : 16/9);
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sp.x - sw/2, sp.y - sh/2, sw, sh);
      ctx.fillStyle = 'rgba(124,58,237,0.15)';
      ctx.fillRect(sp.x - sw/2, sp.y - sh/2, sw, sh);
      ctx.fillStyle = '#a78bfa';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SCENE', sp.x, sp.y + 3);
      ctx.textAlign = 'left';
    }

    // MC placeholder (hidden = disabled)
    const mcp = pct2px(mcPos, CW, CH);
    ctx.strokeStyle = '#475569';
    ctx.setLineDash([3,3]);
    ctx.lineWidth = 1;
    const mcw = CW * 0.22;
    ctx.strokeRect(mcp.x - mcw/2, mcp.y - mcw*1.5, mcw, mcw*2);
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MC', mcp.x, mcp.y + 4);

    // Logo
    if (logoFile) {
      const lp = pct2px(logoPos, CW, CH);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      const ls = 24;
      ctx.strokeRect(lp.x - ls/2, lp.y - ls/2, ls, ls);
      ctx.fillStyle = 'rgba(245,158,11,0.2)';
      ctx.fillRect(lp.x - ls/2, lp.y - ls/2, ls, ls);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('L', lp.x, lp.y + 3);
    }

    // Channel name
    if (channelName) {
      const cp = pct2px(chNamePos, CW, CH);
      const fontSize = fsSz[chNameFontSize] || 13;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = chNameColor || '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.textAlign = 'center';
      ctx.fillText(channelName.slice(0, 20), cp.x, cp.y);
      ctx.globalAlpha = 1;
    }

    // Subtitle area
    if (subtitleEnabled) {
      const sp = pct2px(subtitlePos, CW, CH);
      const boxW = CW * 0.7;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sp.x - boxW/2, sp.y - 10, boxW, 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Phụ đề SRT', sp.x, sp.y + 2);
    }

    // Waveform
    if (showWaveform) {
      const barCount = 20;
      const barW = CW * 0.7 / barCount;
      const maxH = CH * 0.08;
      const waveY = CH * 0.92;
      const waveX = CW * 0.15;
      ctx.fillStyle = 'rgba(236,72,153,0.7)';
      for (let i = 0; i < barCount; i++) {
        const h = maxH * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + Date.now() * 0.0005)));
        if (waveStyle === 'mirror') {
          ctx.fillRect(waveX + i * barW, waveY - h/2, barW-1, h);
        } else if (waveStyle === 'line') {
          ctx.fillRect(waveX + i * barW, waveY - 1, barW-1, 2);
        } else if (waveStyle === 'dots') {
          ctx.beginPath(); ctx.arc(waveX + i * barW + barW/2, waveY - h, 2, 0, Math.PI*2); ctx.fill();
        } else {
          ctx.fillRect(waveX + i * barW, waveY - h, barW-1, h);
        }
      }
    }

    ctx.textAlign = 'left';
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
      const CH2 = canvas.height, CW2 = canvas.width;
      const barCount = 20, barW = CW2 * 0.7 / barCount, maxH = CH2 * 0.08;
      const waveY = CH2 * 0.92, waveX = CW2 * 0.15;
      ctx.clearRect(waveX - 2, waveY - maxH - 2, CW2 * 0.7 + 4, maxH + 4);
      ctx.fillStyle = 'rgba(236,72,153,0.7)';
      for (let i = 0; i < barCount; i++) {
        const h = maxH * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + Date.now() * 0.001)));
        if (waveStyle === 'mirror') ctx.fillRect(waveX + i*barW, waveY - h/2, barW-1, h);
        else if (waveStyle === 'circle') { ctx.beginPath(); ctx.arc(waveX+i*barW+barW/2, waveY-h, h/2, 0, Math.PI*2); ctx.fill(); }
        else if (waveStyle === 'dots')   { ctx.beginPath(); ctx.arc(waveX+i*barW+barW/2, waveY-h, 2, 0, Math.PI*2); ctx.fill(); }
        else if (waveStyle === 'fill')   { ctx.fillRect(waveX + i*barW, waveY-h, barW-1, h); ctx.fillStyle='rgba(236,72,153,0.15)'; ctx.fillRect(waveX+i*barW, 0, barW-1, CH2); ctx.fillStyle='rgba(236,72,153,0.7)'; }
        else ctx.fillRect(waveX + i*barW, waveY-h, barW-1, h);
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

  return (
    <div className="relative w-full" style={{ paddingBottom: is916 ? '177.7%' : '56.25%' }}>
      <canvas ref={canvasRef} width={CW} height={CH}
        className="absolute inset-0 w-full h-full rounded-lg border border-slate-700"
        style={{ cursor: 'grab', background: '#0f172a' }}
        onMouseDown={onMouseDown} />
      <div className="absolute bottom-1 right-1 text-[8px] text-slate-600 bg-black/40 px-1 rounded">
        ▶ Kéo để định vị | {outputAspect}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function MCStudioPanel() {
  // ─── Phase ────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(1);

  // ─── Script ───────────────────────────────────────────────────────────────
  const [scriptMode,  setScriptMode]  = useState('ai-write');
  const [aiSubMode,   setAiSubMode]   = useState('create');
  const [script,      setScript]      = useState('');
  const [ytbUrl,      setYtbUrl]      = useState('');
  const [customIdea,  setCustomIdea]  = useState('');
  const [storyLang,   setStoryLang]   = useState(STORY_LANGS[0]);
  const [storyGenre,  setStoryGenre]  = useState(STORY_GENRES[0]);
  const [storyStyle,  setStoryStyle]  = useState(STORY_STYLES[0]);
  const [wordCount,   setWordCount]   = useState(2000);
  const [geminiModel, setGeminiModel] = useState(loadGeminiModel);
  const [writingStory,setWritingStory]= useState(false);
  const abortRef = useRef(false);

  // ─── TTS ──────────────────────────────────────────────────────────────────
  const [ttsEngine,      setTtsEngine]      = useState(() => localStorage.getItem('mc_studio_tts_engine') || 'edge');
  const [ttsVoice,       setTtsVoice]       = useState(() => localStorage.getItem('mc_studio_tts_voice')  || 'vi-VN-HoaiMyNeural');
  const [ttsPitch,       setTtsPitch]       = useState(0);  // semitones
  const [ttsRate,        setTtsRate]        = useState(0);  // %
  const [ttsVnVoice,     setTtsVnVoice]     = useState(() => localStorage.getItem('mc_studio_tts_vn_voice') || '');
  const [vnSavedVoices,  setVnSavedVoices]  = useState(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices')||'[]'); } catch { return []; } });
  const [vnBuiltinVoices,setVnBuiltinVoices]= useState([]);
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

  // ─── Reup ─────────────────────────────────────────────────────────────────
  const [hFlip,           setHFlip]           = useState(true);
  const [colorShift,      setColorShift]      = useState(true);
  const [colorShiftLevel, setColorShiftLevel] = useState('medium');
  const [zoomPct,         setZoomPct]         = useState(5);
  const [varSpeed,        setVarSpeed]        = useState(true);
  const [varSpeedLevel,   setVarSpeedLevel]   = useState('medium');
  const [hueRotate,       setHueRotate]       = useState(true);
  const [reupGrainNoise,  setReupGrainNoise]  = useState(true);
  const [reupGrainLevel,  setReupGrainLevel]  = useState(5);
  const [randomFps,       setRandomFps]       = useState(true);
  const [slightRotate,    setSlightRotate]    = useState(false);
  const [randomPosCrop,   setRandomPosCrop]   = useState(true);

  // ─── Output / Composite ───────────────────────────────────────────────────
  const [compositeStatus, setCompositeStatus] = useState('idle');
  const [finalVideo,      setFinalVideo]      = useState(null);

  // ─── SEO ──────────────────────────────────────────────────────────────────
  const [seoData,   setSeoData]   = useState(null);
  const [seoStatus, setSeoStatus] = useState('idle');

  // ─── Log ──────────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState([]);
  const logEndRef = useRef(null);
  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [...prev.slice(-299), { id: Date.now()+Math.random(), msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs]);

  // ─── Load VieNeu ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI?.getVieNeuBuiltinVoices?.()?.then(v => { if (v?.length) setVnBuiltinVoices(v); }).catch(() => {});
  }, []);

  // ─── File pickers ─────────────────────────────────────────────────────────
  const pickBgVideo   = async () => { const p = await window.electronAPI?.selectFile('video'); if (p) { setBgVideoFile({ path:p, name:p.split(/[\\/]/).pop() }); setBgFolder(null); addLog(`✅ Video nền: ${p.split(/[\\/]/).pop()}`); } };
  const pickBgFolder  = async () => { const p = await window.electronAPI?.selectFolder?.(); if (p) { setBgFolder({ path:p, name:p.split(/[\\/]/).pop() }); setBgVideoFile(null); addLog(`✅ Thư mục nền: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneVid  = async () => { const p = await window.electronAPI?.selectFile('video'); if (p) { setSceneVideo({ path:p, name:p.split(/[\\/]/).pop() }); setSceneFolder(null); setSceneImage(null); addLog(`✅ Scene: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneDir  = async () => { const p = await window.electronAPI?.selectFolder?.(); if (p) { setSceneFolder({ path:p, name:p.split(/[\\/]/).pop() }); setSceneVideo(null); setSceneImage(null); addLog(`✅ Scene thư mục: ${p.split(/[\\/]/).pop()}`); } };
  const pickSceneImg  = async () => { const p = await window.electronAPI?.selectFile('image'); if (p) { setSceneImage({ path:p, name:p.split(/[\\/]/).pop() }); setSceneVideo(null); setSceneFolder(null); addLog(`✅ Ảnh tĩnh: ${p.split(/[\\/]/).pop()}`); } };
  const pickLogo      = async () => { const p = await window.electronAPI?.selectFile('image'); if (p) { setLogoFile({ path:p, name:p.split(/[\\/]/).pop() }); addLog(`✅ Logo: ${p.split(/[\\/]/).pop()}`); } };
  const pickAudio     = async () => { const p = await window.electronAPI?.selectFile('audio'); if (p) { setAudioFile({ path:p, name:p.split(/[\\/]/).pop() }); addLog(`✅ Audio: ${p.split(/[\\/]/).pop()}`); } };

  // ─── TTS engine change ────────────────────────────────────────────────────
  const changeTtsEngine = (eng) => {
    setTtsEngine(eng); localStorage.setItem('mc_studio_tts_engine', eng);
    const defs = { edge:'vi-VN-HoaiMyNeural', gemini:'Aoede', vieneu:'' };
    setTtsVoice(defs[eng]||''); localStorage.setItem('mc_studio_tts_voice', defs[eng]||'');
  };

  // ─── Write story ──────────────────────────────────────────────────────────
  const handleWriteStory = async () => {
    const keys = loadKeys();
    if (!keys.length) { addLog('❌ Cần Gemini API key (Settings → API Key)', 'error'); return; }
    abortRef.current = false;
    setWritingStory(true); setScript('');
    try {
      let prompt = '';
      if (aiSubMode === 'create') {
        prompt = `Viết ${storyGenre} ${storyStyle} dài khoảng ${wordCount} từ bằng ${storyLang}.\n${customIdea ? `Ý tưởng: ${customIdea}\n` : ''}Yêu cầu: hấp dẫn, cuốn hút, có cao trào rõ ràng. Chỉ viết nội dung thuần, không thêm tiêu đề.`;
      } else {
        if (!ytbUrl.trim()) { addLog('❌ Nhập URL YouTube', 'error'); setWritingStory(false); return; }
        const data = await window.electronAPI?.fetchYouTubeInfo?.({ url: ytbUrl });
        if (!data?.success) { addLog(`❌ Không lấy được nội dung: ${data?.error||'?'}`, 'error'); setWritingStory(false); return; }
        prompt = `Dựa vào transcript sau, viết lại thành kịch bản MC hấp dẫn bằng ${storyLang}, phong cách ${storyStyle}, dài ${wordCount} từ:\n\n${data.transcript||data.description||'(không có transcript)'}`;
      }
      addLog(`✏️ Đang viết ${wordCount} từ...`);
      const result = await callGemini(keys, prompt, 8192, geminiModel);
      if (!abortRef.current && result?.trim()) {
        setScript(result.trim());
        addLog(`✅ Viết xong! ${result.length.toLocaleString()} ký tự`, 'success');
      }
    } catch (e) { addLog(`❌ ${e.message}`, 'error'); }
    setWritingStory(false);
  };

  // ─── Create Audio + SRT ───────────────────────────────────────────────────
  const handleCreateAudio = async () => {
    const text = script.trim();
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
    } catch (e) { addLog(`❌ ${e.message}`, 'error'); }
    setCreatingAudio(false); setTtsStatus(''); setAudioProgress({ done:0, total:0 });
  };

  // ─── Build video ──────────────────────────────────────────────────────────
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
        addLog('🎞️ Reup scene video...');
        const sc = await window.electronAPI?.scenePrepareVideo({ folderPath:sceneFolder.path, outputFolder:outputDir, audioPath, reup:{ hFlip, colorShift, colorShiftLevel, zoomPct, varSpeed, varSpeedLevel, hueRotate, grainNoise:reupGrainNoise, grainLevel:reupGrainLevel, randomFps, slightRotate, randomPosCrop } });
        if (sc?.success) { sceneVideoPath = sc.videoPath; tempFiles.push(sceneVideoPath); addLog(`✅ Scene reup xong: ${sc.pickedName}`, 'success'); }
        else addLog(`⚠️ Scene lỗi: ${sc?.error}`, 'warn');
      } else if (sceneVideo?.path) {
        addLog('🎞️ Reup scene video...');
        const sc = await window.electronAPI?.scenePrepareVideo({ videoPath:sceneVideo.path, outputFolder:outputDir, audioPath, reup:{ hFlip, colorShift, colorShiftLevel, zoomPct, varSpeed, varSpeedLevel, hueRotate, grainNoise:reupGrainNoise, grainLevel:reupGrainLevel, randomFps, slightRotate, randomPosCrop } });
        if (sc?.success) { sceneVideoPath = sc.videoPath; tempFiles.push(sceneVideoPath); addLog('✅ Scene reup xong', 'success'); }
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
    const content = srtFile?.content || script || '';
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
    <div className="flex h-full bg-slate-950 text-slate-200 text-[11px] overflow-hidden">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════ */}
      <div className="flex flex-col w-[380px] min-w-[340px] border-r border-slate-800 overflow-hidden">

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
          {[{ l:'Kịch bản', ok:!!script },{ l:'Audio', ok:!!audioFile },{ l:'SRT', ok:!!srtFile }].map(({ l, ok }) => (
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
              <div className="grid grid-cols-2 gap-1">
                <button onClick={pickSceneVid} className={`py-1.5 rounded text-[10px] transition ${sceneVideo  ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>🎞️ Video phản ứng</button>
                <button onClick={pickSceneDir} className={`py-1.5 rounded text-[10px] transition ${sceneFolder ? 'bg-purple-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>📂 Thư mục scene</button>
              </div>
              {(sceneVideo||sceneFolder||sceneImage) && (
                <div className="flex items-center gap-1 text-purple-400 text-[9px]">
                  <span className="truncate flex-1">{sceneFolder?.name||sceneVideo?.name||sceneImage?.name}</span>
                  <button onClick={() => { setSceneVideo(null); setSceneFolder(null); setSceneImage(null); }} className="text-slate-500 hover:text-red-400">✕</button>
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

            <Section title="🔄 Reup options" titleCls="text-green-400">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[
                  [hFlip,         setHFlip,         'Lật ngang'   ],
                  [colorShift,    setColorShift,    'Color shift' ],
                  [varSpeed,      setVarSpeed,      'Var speed'   ],
                  [hueRotate,     setHueRotate,     'Hue rotate'  ],
                  [reupGrainNoise,setReupGrainNoise,'Grain noise' ],
                  [randomFps,     setRandomFps,     'Random FPS'  ],
                  [slightRotate,  setSlightRotate,  'Slight rotate'],
                  [randomPosCrop, setRandomPosCrop, 'Pos crop'    ],
                ].map(([val, setter, label]) => (
                  <label key={label} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} className="accent-green-500 w-3 h-3" />
                    <span className="text-[9px]">{label}</span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <div className="text-[9px] text-slate-500 mb-1">Zoom: {zoomPct}%</div>
                  <input type="range" min={0} max={20} value={zoomPct} onChange={e => setZoomPct(+e.target.value)} className="w-full accent-green-500" />
                </div>
                <div>
                  <div className="text-[9px] text-slate-500 mb-1">Grain: {reupGrainLevel}</div>
                  <input type="range" min={1} max={20} value={reupGrainLevel} onChange={e => setReupGrainLevel(+e.target.value)} className="w-full accent-green-500" />
                </div>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[9px] text-slate-500">Color:</span>
                {['light','medium','strong'].map(v => <TBtn key={v} active={colorShiftLevel===v} onClick={() => setColorShiftLevel(v)}>{v}</TBtn>)}
                <span className="text-[9px] text-slate-500 ml-2">Speed:</span>
                {['light','medium','strong'].map(v => <TBtn key={v} active={varSpeedLevel===v} onClick={() => setVarSpeedLevel(v)}>{v}</TBtn>)}
              </div>
            </Section>

            <button onClick={() => setPhase(2)} className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition">
              Tiếp theo → Tạo Audio
            </button>
          </>}

          {/* ════ PHASE 2 — TẠO AUDIO ══════════════════════════════════ */}
          {phase === 2 && <>
            {/* Gemini model */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 shrink-0">Model:</span>
              <select value={geminiModel} onChange={e => { setGeminiModel(e.target.value); localStorage.setItem(LS_GEMINI_MODEL, e.target.value); }}
                className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-500">
                {GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1">
              {[['ai-write','✏️ Viết AI'],['ytb-script','🔗 Từ YTB'],['paste','📋 Dán text'],['upload','📂 Audio']].map(([v,l]) => (
                <button key={v} onClick={() => setScriptMode(v)}
                  className={`flex-1 py-1.5 rounded text-[9px] font-bold transition ${scriptMode===v ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-500 hover:bg-slate-600'}`}>{l}</button>
              ))}
            </div>

            {scriptMode === 'ai-write' && <>
              <div className="flex gap-1">
                {[['create','✏️ Tự sáng tác'],['rewrite','📺 Viết lại YTB']].map(([v,l]) => (
                  <button key={v} onClick={() => setAiSubMode(v)}
                    className={`flex-1 py-1.5 rounded text-[9px] font-bold transition ${aiSubMode===v ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-500 hover:bg-slate-600'}`}>{l}</button>
                ))}
              </div>
              {aiSubMode === 'rewrite' && (
                <input value={ytbUrl} onChange={e => setYtbUrl(e.target.value)} placeholder="URL video YouTube https://youtube.com/watch?v=..."
                  className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-purple-500" />
              )}
              <div className="grid grid-cols-3 gap-1">
                {[
                  [storyLang,  setStoryLang,  STORY_LANGS ],
                  [storyGenre, setStoryGenre, STORY_GENRES],
                  [storyStyle, setStoryStyle, STORY_STYLES],
                ].map(([val, setter, opts], idx) => (
                  <select key={idx} value={val} onChange={e => setter(e.target.value)}
                    className="bg-slate-900 border border-slate-600 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-indigo-500">
                    {opts.map(o => <option key={o}>{o}</option>)}
                  </select>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500">Độ dài:</span>
                <select value={wordCount} onChange={e => setWordCount(+e.target.value)}
                  className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-500">
                  {WORD_COUNTS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>
              <textarea value={customIdea} onChange={e => setCustomIdea(e.target.value)} rows={2} placeholder="Ý tưởng cụ thể (tuỳ chọn)..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] resize-none focus:outline-none focus:border-purple-500" />
              <button onClick={handleWriteStory} disabled={writingStory}
                className={`w-full py-2 rounded-xl font-bold text-[11px] transition ${writingStory ? 'bg-purple-800 text-purple-300 cursor-wait' : 'bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40'}`}>
                {writingStory ? '⏳ Đang viết...' : '✨ Viết Truyện → Script → Audio'}
              </button>
              {writingStory && <button onClick={() => { abortRef.current=true; }} className="w-full py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-[10px] text-slate-300">⏹ Dừng</button>}
            </>}

            {scriptMode === 'ytb-script' && (
              <input value={ytbUrl} onChange={e => setYtbUrl(e.target.value)} placeholder="URL video YouTube..."
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-red-500" />
            )}

            {/* Script textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-slate-500">{script ? `Kịch bản (${script.length.toLocaleString()} ký tự)` : 'Kịch bản'}</span>
                {script && <button onClick={() => setScript('')} className="text-[9px] text-slate-600 hover:text-red-400">✕ Xóa</button>}
              </div>
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={8}
                placeholder={scriptMode==='paste' ? 'Dán văn bản vào đây...' : 'Kịch bản sẽ xuất hiện ở đây sau khi viết...'}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-[11px] resize-none focus:outline-none focus:border-indigo-500" />
            </div>

            {/* TTS engine */}
            <Section title="Engine TTS" titleCls="text-slate-400">
              <div className="flex gap-1">
                {[['edge','Edge TTS','bg-emerald-600'],['gemini','Gemini TTS','bg-purple-600'],['vieneu','VieNeu','bg-blue-600']].map(([e,l,cls]) => (
                  <button key={e} onClick={() => changeTtsEngine(e)} disabled={creatingAudio}
                    className={`flex-1 py-1.5 rounded text-[10px] font-bold transition ${ttsEngine===e ? cls+' text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>{l}</button>
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
              {/* Pitch / Rate — chỉ hiện cho Edge TTS và Gemini TTS */}
            {(ttsEngine === 'edge' || ttsEngine === 'gemini') && (
              <div className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-12 shrink-0">🎵 Tone</span>
                  <input type="range" min={-12} max={12} step={1} value={ttsPitch}
                    onChange={e => setTtsPitch(+e.target.value)}
                    className="flex-1 accent-indigo-500 h-1" disabled={creatingAudio} />
                  <span className={`text-[10px] font-bold w-8 text-right tabular-nums ${ttsPitch > 0 ? 'text-indigo-400' : ttsPitch < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                    {ttsPitch > 0 ? `+${ttsPitch}` : ttsPitch}st
                  </span>
                  {ttsPitch !== 0 && <button onClick={() => setTtsPitch(0)} className="text-[9px] text-slate-600 hover:text-slate-400">↺</button>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-12 shrink-0">⚡ Tốc</span>
                  <input type="range" min={-50} max={50} step={5} value={ttsRate}
                    onChange={e => setTtsRate(+e.target.value)}
                    className="flex-1 accent-blue-500 h-1" disabled={creatingAudio} />
                  <span className={`text-[10px] font-bold w-8 text-right tabular-nums ${ttsRate > 0 ? 'text-blue-400' : ttsRate < 0 ? 'text-orange-400' : 'text-slate-500'}`}>
                    {ttsRate > 0 ? `+${ttsRate}` : ttsRate}%
                  </span>
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
            </Section>

            {/* Upload audio */}
            {scriptMode === 'upload' && (
              <button onClick={pickAudio} className={`w-full py-2 rounded-xl text-[11px] font-bold transition ${audioFile ? 'bg-teal-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                {audioFile ? `✅ ${audioFile.name}` : '📂 Chọn file audio'}
              </button>
            )}

            {/* Progress */}
            {creatingAudio && audioProgress.total > 0 && (
              <div>
                <div className="flex justify-between text-[9px] text-slate-400 mb-1">
                  <span>{ttsStatus || `${audioProgress.done}/${audioProgress.total}`}</span>
                  <span>{Math.round(audioProgress.done/audioProgress.total*100)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width:`${audioProgress.total ? audioProgress.done/audioProgress.total*100:0}%` }} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {scriptMode !== 'upload' && (
                <button onClick={handleCreateAudio} disabled={creatingAudio || !script.trim()}
                  className={`flex-1 py-2 rounded-xl font-bold text-[11px] transition ${creatingAudio ? 'bg-indigo-800 text-indigo-300 cursor-wait animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'}`}>
                  {creatingAudio ? '⏳ Đang tạo audio...' : '🎙️ Tạo Audio + SRT'}
                </button>
              )}
              {creatingAudio && <button onClick={() => { ttsAbortRef.current=true; }} className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-[10px]">⏹</button>}
              {scriptMode === 'upload' && audioFile && (
                <button onClick={() => setPhase(3)} className="flex-1 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-[11px] transition">
                  Tiếp → Dựng Video
                </button>
              )}
            </div>

            {(audioFile||srtFile) && (
              <div className="space-y-0.5 border-t border-slate-800 pt-2">
                {audioFile && <div className="text-[9px] text-green-400">🎵 {audioFile.name}</div>}
                {srtFile   && <div className="text-[9px] text-green-400">📄 SRT: {srtFile.name}</div>}
              </div>
            )}
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

      {/* ══ RIGHT PANEL ══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080d17]">

        {/* Canvas preview */}
        <div className="shrink-0 p-3 border-b border-slate-800 bg-slate-900/30">
          <div className="text-[9px] text-slate-500 mb-2 flex items-center justify-between">
            <span>🖥️ Preview — kéo phần tử để thay đổi vị trí</span>
            <span className="text-[8px] text-slate-700">{outputAspect}</span>
          </div>
          <CanvasPreview
            outputAspect={outputAspect}
            mcPos={mcPos} scenePos={scenePos} logoPos={logoPos}
            chNamePos={chNamePos} subtitlePos={subtitlePos}
            channelName={channelName} chNameColor={chNameColor} chNameFontSize={chNameFontSize}
            subtitleEnabled={subtitleEnabled} showWaveform={showWaveform} waveStyle={waveStyle}
            logoFile={logoFile} sceneVideo={sceneVideo} sceneFolder={sceneFolder} sceneImage={sceneImage}
            bgVideoFile={bgVideoFile} bgFolder={bgFolder}
            onDragMC={onDragMC} onDragScene={onDragScene} onDragLogo={onDragLogo}
            onDragChName={onDragChName} onDragSubtitle={onDragSubtitle}
          />
        </div>

        {/* Status summary */}
        <div className="shrink-0 px-3 py-2 border-b border-slate-800 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
          <div className={audioFile   ? 'text-green-400' : 'text-slate-700'}>🎵 {audioFile?.name?.slice(0,24)||'Chưa có audio'}</div>
          <div className={srtFile     ? 'text-green-400' : 'text-slate-700'}>📄 {srtFile?.name?.slice(0,24)||'Chưa có SRT'}</div>
          <div className={(bgVideoFile||bgFolder) ? 'text-teal-400' : 'text-slate-700'}>🎬 {(bgVideoFile?.name||bgFolder?.name)?.slice(0,24)||'Chưa có video nền'}</div>
          <div className={finalVideo  ? 'text-yellow-400' : 'text-slate-700'}>✅ {finalVideo ? finalVideo.split(/[\\/]/).pop().slice(0,24) : 'Chưa xuất video'}</div>
        </div>

        {/* Log */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px]">
          {logs.length === 0 && <div className="text-slate-700 text-center mt-8">Log hiển thị ở đây...</div>}
          {logs.map(l => (
            <div key={l.id} className={`mb-0.5 ${l.type==='error' ? 'text-red-400' : l.type==='success' ? 'text-green-400' : l.type==='warn' ? 'text-yellow-400' : 'text-slate-400'}`}>
              <span className="text-slate-700 mr-1">{l.time}</span>{l.msg}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-slate-800 flex gap-2">
          <button onClick={() => setLogs([])} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[9px]">🗑️ Xóa log</button>
          {finalVideo && (
            <button onClick={() => window.electronAPI?.shell?.showItemInFolder?.(finalVideo)}
              className="flex-1 py-1 rounded bg-green-700 hover:bg-green-600 text-white font-bold text-[10px] transition">
              📂 Mở thư mục output
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
