/**
 * RemotionStudio — Gemini (multimodal) → Remotion Code-based Video Generator
 * Flow: Prompt + Ref files → Gemini → JSX code → Remotion CLI → MP4
 *
 * Reference file strategy:
 *  - Images ≤ 10MB : đọc base64 preview + gửi inline đến Gemini
 *  - Images > 10MB : upload lên Gemini File API (từ main process)
 *  - Videos (mọi kích thước): upload lên Gemini File API (từ main process, tránh IPC limit)
 */
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import {
  Sparkles, Play, Code2, Terminal, FolderOpen, Video,
  Copy, Check, ChevronDown, ChevronUp, Loader2,
  AlertCircle, CheckCircle2, BookOpen, X, Info,
  ImagePlus, Film, Upload, Mic, MicOff, Volume2, Wand2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────
const LS_GEMINI_KEYS = 'fluxy_gemini_api_keys';
const LS_OUT_DIR     = 'remotion_studio_output_dir';
const LS_MODEL       = 'remotion_studio_model';
const LS_LAST_PROMPT = 'remotion_studio_last_prompt';
const LS_LAST_CODE   = 'remotion_studio_last_code';

const GEMINI_MODELS = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3-flash-preview',  label: 'Gemini 3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash Lite (tiết kiệm)' },
];

const ASPECT_OPTIONS = [
  { label: '16:9  Ngang (1920×1080)',  width: 1920, height: 1080 },
  { label: '9:16  Dọc  (1080×1920)',   width: 1080, height: 1920 },
  { label: '1:1   Vuông (1080×1080)',  width: 1080, height: 1080 },
];

const DURATION_OPTIONS = [
  { label: 'Tự động', seconds: null },
  { label: '5s',      seconds: 5    },
  { label: '10s',     seconds: 10   },
  { label: '15s',     seconds: 15   },
  { label: '30s',     seconds: 30   },
  { label: '60s',     seconds: 60   },
  { label: 'Tuỳ',     seconds: -1   },
];

const EXAMPLE_PROMPTS = [
  'Video intro kênh YouTube phong cách neon tím. Tên kênh "Thành Công Media" xuất hiện từng chữ từ trái, dưới là tagline fade in. Nền gradient tím đậm → đen. 10 giây.',
  'Countdown đếm ngược 5-4-3-2-1 kiểu phim điện ảnh. Mỗi số scale nhanh + flash trắng, nền đen. 7 giây.',
  'Lower-third cho livestream: tên "Nguyễn Văn A" slide từ trái, chức danh xuất hiện sau. Nền gradient xanh bán trong suốt. 5 giây.',
  'Slide 3 cảnh: nền đỏ "Vấn đề" → nền xanh "Giải pháp" → nền vàng "Kết quả". Mỗi cảnh 3s, wipe sang phải.',
  'Logo reveal: hình tròn xoay → phát sáng → hiện chữ "AI STUDIO" typewriter. Nền tối, màu cyan + trắng. 8 giây.',
];

// 10MB = threshold để đọc base64 preview; > threshold thì upload qua main process
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

// ── TTS Constants ─────────────────────────────────────────────────────────────
const LS_TTS_MODE  = 'remotion_tts_mode';
const LS_TTS_VOICE = 'remotion_tts_voice';

const GEMINI_TTS_VOICES = [
  { id: 'Aoede',   label: 'Aoede (Nữ - Ấm áp)',     gender: 'female' },
  { id: 'Kore',    label: 'Kore (Nữ - Rõ ràng)',     gender: 'female' },
  { id: 'Leda',    label: 'Leda (Nữ - Dịu dàng)',    gender: 'female' },
  { id: 'Sulafat', label: 'Sulafat (Nữ - Thân thiện)',gender: 'female' },
  { id: 'Charon',  label: 'Charon (Nam - Chuẩn)',     gender: 'male'   },
  { id: 'Fenrir',  label: 'Fenrir (Nam - Mạnh mẽ)',   gender: 'male'   },
  { id: 'Puck',    label: 'Puck (Nam - Vui tươi)',    gender: 'male'   },
  { id: 'Orus',    label: 'Orus (Nam - Uy quyền)',    gender: 'male'   },
];

const WIN_VOICES_FALLBACK = [
  { ShortName: 'vi-VN-HoaiMyNeural',  Gender: 'Female' },
  { ShortName: 'vi-VN-NamMinhNeural', Gender: 'Male'   },
];

// Phát hiện staticFile() references trong generated code
function detectStaticFileRefs(code) {
  const rgx = /staticFile\(['"]([^'"]+)['"]\)/g;
  const refs = new Set();
  let m;
  while ((m = rgx.exec(code)) !== null) refs.add(m[1]);
  refs.delete('narration.wav');
  return [...refs].map(name => {
    const ext = name.split('.').pop().toLowerCase();
    const type = ['mp4','webm','mov','avi'].includes(ext) ? 'video' : 'image';
    return { name, type, status: 'idle', aiPath: null, prompt: '' };
  });
}

function loadKeys()  { try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS) || '[]'); } catch { return []; } }
function loadModel() { const s = localStorage.getItem(LS_MODEL); return GEMINI_MODELS.find(m => m.id === s) ? s : 'gemini-3.5-flash'; }
function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Gemini simple (non-streaming) call for short text ──────────────────────
async function callGeminiText(apiKeys, prompt, model) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const result = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.8, maxOutputTokens: 2048 },
    });
    return result.text || '';
  }, apiKeys);
}

// ── Gemini text+multipart streaming ─────────────────────────────────────────
async function callGeminiStream(apiKeys, fullPrompt, model, refParts, onChunk) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const parts = [...refParts, { text: fullPrompt }];
    const stream = await ai.models.generateContentStream({
      model,
      contents: [{ role: 'user', parts }],
      config: { temperature: 0.75, maxOutputTokens: 16384 },
    });
    let full = '';
    for await (const chunk of stream) {
      const t = chunk.text || '';
      if (t) { full += t; onChunk(t); }
    }
    return full;
  }, apiKeys);
}

function extractCode(raw) {
  const m = raw.match(/```(?:jsx?|tsx?|javascript|typescript)?\n?([\s\S]*?)```/);
  return m ? m[1].trim() : raw.trim();
}

// ── RefFile card ──────────────────────────────────────────────────────────────
function RefFileCard({ rf, onRemove }) {
  const isImage = rf.mimeType.startsWith('image/');
  const statusColor = ['ready', 'uploaded'].includes(rf.status) ? 'text-emerald-400'
    : rf.status === 'error' ? 'text-red-400' : 'text-amber-400';
  const statusLabel = rf.status === 'ready' ? '✓ Sẵn sàng'
    : rf.status === 'uploaded'  ? '✓ Đã upload Gemini'
    : rf.status === 'pending'   ? '⏳ Chờ upload'
    : rf.status === 'uploading' ? `⏳ ${rf.uploadMsg || 'Uploading...'}`
    : `✗ ${rf.error || 'Lỗi'}`;

  return (
    <div className="relative group bg-[#0e1628] border border-slate-800 rounded-lg overflow-hidden">
      <div className="h-20 flex items-center justify-center bg-[#0a0f1a] overflow-hidden">
        {isImage && rf.preview
          ? <img src={`data:${rf.mimeType};base64,${rf.preview}`} alt={rf.name} className="w-full h-full object-cover" />
          : <div className="flex flex-col items-center gap-1 text-slate-600">
              {rf.mimeType.startsWith('video/') ? <Film className="w-8 h-8" /> : <ImagePlus className="w-8 h-8" />}
              {rf.size > PREVIEW_MAX_BYTES && isImage && <span className="text-[8px] text-slate-700">No preview</span>}
            </div>
        }
        {(rf.status === 'uploading') && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="text-[10px] font-bold text-slate-300 truncate" title={rf.name}>{rf.name}</p>
        <p className="text-[9px] text-slate-600">{fmtSize(rf.size)}</p>
        <p className={`text-[9px] font-bold ${statusColor} truncate`} title={statusLabel}>{statusLabel}</p>
      </div>
      <button onClick={() => onRemove(rf.id)}
        className="absolute top-1 right-1 bg-black/70 text-slate-400 hover:text-red-400 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Log Panel ─────────────────────────────────────────────────────────────────
function LogPanel({ logs, open, onToggle, onClear }) {
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, open]);
  return (
    <div className={`bg-[#060a12] border-t border-slate-800 flex flex-col transition-all duration-300 shrink-0 ${open ? 'h-52' : 'h-9'}`}>
      <div className="flex items-center justify-between px-4 h-9 cursor-pointer select-none hover:bg-slate-900/60" onClick={onToggle}>
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          <Terminal className="w-3.5 h-3.5" /> Render Log
          {logs.length > 0 && !open && <span className="bg-slate-700 text-slate-300 text-[9px] px-1.5 py-0.5 rounded-full">{logs.length}</span>}
        </span>
        <div className="flex items-center gap-2">
          {open && <button onClick={e => { e.stopPropagation(); onClear(); }} className="text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded transition-colors">Xóa</button>}
          {open ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronUp className="w-3 h-3 text-slate-600" />}
        </div>
      </div>
      {open && (
        <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] font-mono space-y-0.5 custom-scrollbar">
          {logs.map((l, i) => (
            <div key={i} className={
              l.startsWith('✅') ? 'text-emerald-400' :
              l.startsWith('❌') ? 'text-red-400' :
              l.startsWith('▶')  ? 'text-sky-400' :
              l.startsWith('📝') || l.startsWith('🎬') || l.startsWith('📁') ? 'text-violet-400' :
              l.startsWith('📤') || l.startsWith('⏳') ? 'text-amber-400' :
              'text-slate-400'
            }>{l}</div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

// ── Code Viewer ───────────────────────────────────────────────────────────────
function CodeViewer({ code, open, onToggle }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0e1628] cursor-pointer hover:bg-slate-800/60" onClick={onToggle}>
        <span className="flex items-center gap-2 text-[12px] font-bold text-slate-400">
          <Code2 className="w-3.5 h-3.5 text-violet-400" /> Generated Code
          <span className="text-[10px] text-slate-600 font-mono">{code.split('\n').length} dòng</span>
        </span>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); copy(); }} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </div>
      {open && (
        <div className="max-h-72 overflow-y-auto custom-scrollbar bg-[#080d1a] p-4">
          <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">{code}</pre>
        </div>
      )}
    </div>
  );
}

// ── Help Panel ────────────────────────────────────────────────────────────────
function HelpPanel({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 bg-[#0a0f18]/95 backdrop-blur-sm overflow-y-auto custom-scrollbar p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-[18px] font-black text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-violet-400" /> Hướng dẫn Remotion Studio
            </h2>
            <p className="text-[12px] text-slate-500 mt-1">Tạo video bằng AI — không cần biết code</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <section className="mb-5 bg-[#0d1424] border border-slate-800 rounded-xl p-5">
          <h3 className="text-[13px] font-black text-violet-400 mb-3 flex items-center gap-2"><Info className="w-4 h-4" /> Remotion là gì?</h3>
          <p className="text-[12px] text-slate-400 leading-relaxed mb-3">
            <strong className="text-slate-200">Remotion</strong> là framework tạo video bằng React code. Mỗi frame là một màn hình React. Gemini viết code → Remotion CLI render → MP4.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: '⚡', title: 'Lập trình video', desc: 'React + CSS — kiểm soát từng pixel, frame' },
              { icon: '🤖', title: 'Gemini viết code', desc: 'AI sinh code từ mô tả + ảnh/video tham chiếu' },
              { icon: '🎬', title: 'Xuất MP4 thật', desc: 'Remotion CLI render qua headless Chrome' },
            ].map((c, i) => (
              <div key={i} className="bg-[#0a1020] border border-slate-800 rounded-lg p-3">
                <div className="text-[20px] mb-1">{c.icon}</div>
                <p className="text-[11px] font-bold text-slate-300">{c.title}</p>
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-5 bg-[#0d1424] border border-emerald-900/40 rounded-xl p-5">
          <h3 className="text-[13px] font-black text-emerald-400 mb-3 flex items-center gap-2"><ImagePlus className="w-4 h-4" /> Tham chiếu ảnh/video</h3>
          <div className="space-y-2">
            {[
              { icon: '🖼️', title: 'Ảnh ≤ 10MB', desc: 'Gửi inline đến Gemini ngay. Xem preview thumbnail trong app.' },
              { icon: '🖼️', title: 'Ảnh > 10MB', desc: 'Upload lên Gemini File API khi nhấn "Tạo Code". Không hiện preview.' },
              { icon: '🎥', title: 'Video (mọi kích thước)', desc: 'Upload lên Gemini File API từ máy chủ nội bộ — không giới hạn bởi IPC. File lớn (>100MB) mất vài giây xử lý.' },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 bg-[#0a1020] border border-slate-800 rounded-lg p-3">
                <span className="text-[18px]">{item.icon}</span>
                <div>
                  <p className="text-[11px] font-bold text-slate-300">{item.title}</p>
                  <p className="text-[10px] text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-amber-500 mt-3">💡 Trong prompt: "tái tạo phong cách ảnh/video tham chiếu" hoặc "dùng màu sắc trong mẫu"</p>
        </section>

        <section className="mb-5 bg-[#0d1424] border border-slate-800 rounded-xl p-5">
          <h3 className="text-[13px] font-black text-sky-400 mb-4">📋 Quy trình 4 bước</h3>
          <div className="space-y-3">
            {[
              { step: '1', color: 'bg-violet-600', title: 'Cài đặt', items: ['Chọn model, tỷ lệ, thời lượng, thư mục xuất'] },
              { step: '2', color: 'bg-emerald-600', title: 'Tải tham chiếu (tuỳ chọn)', items: ['Ảnh/video → AI phân tích phong cách, màu, layout'] },
              { step: '3', color: 'bg-orange-600', title: 'Mô tả + Tạo Code', items: ['Nhấn "Tạo Code" → video lớn sẽ upload Gemini trước → Gemini viết code'] },
              { step: '4', color: 'bg-rose-600', title: 'Render', items: ['Nhấn "Render Video" → Remotion xuất MP4 (lần đầu tải Chromium ~200MB)'] },
            ].map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className={`${s.color} w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-black text-white shrink-0`}>{s.step}</div>
                <div>
                  <p className="text-[12px] font-bold text-slate-200 mb-1">{s.title}</p>
                  {s.items.map((item, j) => <p key={j} className="text-[11px] text-slate-400">• {item}</p>)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[#0d1424] border border-slate-800 rounded-xl p-5">
          <h3 className="text-[13px] font-black text-red-400 mb-3">🔧 Lỗi thường gặp</h3>
          <div className="space-y-2">
            {[
              { err: 'Lần đầu render chậm (5-10 phút)', fix: 'Remotion tải Chromium ~200MB — chỉ 1 lần.' },
              { err: 'Cannot find module / import error', fix: 'Thêm vào prompt: "chỉ dùng import từ remotion và react"' },
              { err: 'Upload video thất bại', fix: 'Kiểm tra API key còn quota. Video quá lớn: thử clip ngắn hơn.' },
              { err: 'npx không chạy được', fix: 'Cài Node.js LTS từ nodejs.org, khởi động lại app.' },
            ].map((item, i) => (
              <div key={i} className="bg-[#0a0f1a] border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] font-bold text-red-400 mb-0.5">⚠ {item.err}</p>
                <p className="text-[11px] text-slate-400">→ {item.fix}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RemotionStudio() {
  const [prompt,       setPrompt]       = useState(() => localStorage.getItem(LS_LAST_PROMPT) || '');
  const [model,        setModel]        = useState(loadModel);
  const [aspect,       setAspect]       = useState(0);
  const [durationIdx,   setDurationIdx]   = useState(2); // mặc định 10s
  const [customSeconds, setCustomSeconds] = useState(15);
  const [customUnit,    setCustomUnit]    = useState('s'); // 's' | 'm'
  const [outputDir,    setOutputDir]    = useState(() => localStorage.getItem(LS_OUT_DIR) || '');

  const [setupStatus,   setSetupStatus]   = useState('checking');
  const [setupLog,      setSetupLog]      = useState([]);

  // ── TTS state ──────────────────────────────────────────────────────────────
  const [ttsEnabled,      setTtsEnabled]      = useState(false);
  const [ttsMode,         setTtsMode]         = useState(() => localStorage.getItem(LS_TTS_MODE) || 'gemini');
  const [ttsVoice,        setTtsVoice]        = useState(() => localStorage.getItem(LS_TTS_VOICE) || 'Aoede');
  const [narrationText,   setNarrationText]   = useState(''); // auto-generated script
  const [narrationStatus, setNarrationStatus] = useState('idle'); // idle | scripting | tts | done | error
  const [scriptEditing,   setScriptEditing]   = useState(false);
  const [winVoices,      setWinVoices]      = useState(WIN_VOICES_FALLBACK);
  const [publicDir,      setPublicDir]      = useState('');

  // ── AI Assets state ────────────────────────────────────────────────────────
  const [missingAssets,  setMissingAssets]  = useState([]);

  const [refFiles,      setRefFiles]      = useState([]);
  const [phase,         setPhase]         = useState('idle');
  const [generatedCode, setGeneratedCode] = useState(() => localStorage.getItem(LS_LAST_CODE) || '');
  const [streamBuffer,  setStreamBuffer]  = useState('');
  const [codeOpen,      setCodeOpen]      = useState(false);
  const [logs,          setLogs]          = useState([]);
  const [logOpen,       setLogOpen]       = useState(true);
  const [videoPath,     setVideoPath]     = useState(null);
  const [errorMsg,      setErrorMsg]      = useState('');
  const [systemPrompt,  setSystemPrompt]  = useState('');
  const [showHelp,      setShowHelp]      = useState(false);

  useEffect(() => {
    window.electronAPI?.remotionGetSystemPrompt?.().then(p => setSystemPrompt(p || ''));
    if (!localStorage.getItem(LS_OUT_DIR)) {
      window.electronAPI?.remotionGetDefaultOutputDir?.().then(d => {
        if (d) { setOutputDir(d); localStorage.setItem(LS_OUT_DIR, d); }
      });
    }
    const unsubRender = window.electronAPI?.onRemotionLog?.((line) => setLogs(prev => [...prev.slice(-299), line]));
    const unsubUpload = window.electronAPI?.onRemotionUploadProgress?.((data) => {
      const { filePath, msg } = data;
      setRefFiles(prev => prev.map(r => r.path === filePath ? { ...r, uploadMsg: msg, status: 'uploading' } : r));
      setLogs(prev => [...prev.slice(-299),msg]);
    });
    const unsubSetup = window.electronAPI?.onRemotionSetupLog?.((msg) => {
      setSetupLog(prev => [...prev, msg]);
      if (msg.startsWith('✅')) setSetupStatus('ok');
      if (msg.startsWith('❌')) setSetupStatus('error');
      if (msg.includes('npm install')) setSetupStatus('installing');
    });

    // Load public dir + Windows TTS voices
    window.electronAPI?.remotionGetPublicDir?.().then(d => { if (d) setPublicDir(d); });
    window.electronAPI?.getVoices?.().then(vs => { if (vs?.length) setWinVoices(vs); }).catch(() => {});

    // Tự động kiểm tra Remotion dependencies khi mở panel
    window.electronAPI?.remotionCheckSetup?.().then(res => {
      if (res?.error) setSetupStatus('error');
      else setSetupStatus('ok');
    }).catch(() => setSetupStatus('error'));

    return () => { unsubRender?.(); unsubUpload?.(); unsubSetup?.(); };
  }, []);

  // ── Reference files ──────────────────────────────────────────────────────
  const handleAddRefFiles = async () => {
    const files = await window.electronAPI?.remotionSelectReferenceFiles?.();
    if (!files?.length) return;

    const newRefs = files.map(f => ({
      ...f,
      id: `${Date.now()}-${Math.random()}`,
      status: f.mimeType.startsWith('video/') ? 'pending' : 'loading',
      preview: null, uploadedUri: null, uploadMsg: '', error: null,
    }));
    setRefFiles(prev => [...prev, ...newRefs]);

    // Chỉ đọc base64 preview cho ảnh nhỏ (≤ 10MB)
    for (const rf of newRefs) {
      if (rf.mimeType.startsWith('image/') && rf.size <= PREVIEW_MAX_BYTES) {
        try {
          const base64 = await window.electronAPI?.remotionReadFileBase64?.(rf.path);
          setRefFiles(prev => prev.map(r => r.id === rf.id
            ? { ...r, preview: base64, status: base64 ? 'ready' : 'ready' }
            : r));
        } catch {
          setRefFiles(prev => prev.map(r => r.id === rf.id ? { ...r, status: 'ready' } : r));
        }
      } else if (rf.mimeType.startsWith('image/') && rf.size > PREVIEW_MAX_BYTES) {
        // Ảnh lớn: không preview nhưng sẵn sàng (sẽ upload lúc generate)
        setRefFiles(prev => prev.map(r => r.id === rf.id ? { ...r, status: 'ready' } : r));
      }
      // Video: giữ status='pending', sẽ upload lúc generate
    }
  };

  const handleRemoveRefFile = (id) => setRefFiles(prev => prev.filter(r => r.id !== id));

  // ── Upload files cần thiết qua main process ──────────────────────────────
  const ensureFilesUploaded = async (refs, apiKey) => {
    const updated = [...refs];
    for (let i = 0; i < updated.length; i++) {
      const rf = updated[i];
      // Upload video (pending/ready) hoặc ảnh lớn (ready, không có preview)
      const needsUpload = rf.uploadedUri == null && (
        rf.mimeType.startsWith('video/') ||
        (rf.mimeType.startsWith('image/') && rf.size > PREVIEW_MAX_BYTES)
      );
      if (!needsUpload || ['error'].includes(rf.status)) continue;

      setRefFiles(prev => prev.map(r => r.id === rf.id ? { ...r, status: 'uploading' } : r));
      try {
        const result = await window.electronAPI?.remotionUploadToGeminiFileApi?.({
          filePath: rf.path, mimeType: rf.mimeType, apiKey,
        });
        updated[i] = { ...rf, uploadedUri: result.uri, mimeType: result.mimeType || rf.mimeType, status: 'uploaded' };
        setRefFiles(prev => prev.map(r => r.id === rf.id ? { ...r, uploadedUri: result.uri, mimeType: result.mimeType || r.mimeType, status: 'uploaded', uploadMsg: '' } : r));
      } catch (err) {
        const errMsg = err.message || 'Upload thất bại';
        updated[i] = { ...rf, status: 'error', error: errMsg };
        setRefFiles(prev => prev.map(r => r.id === rf.id ? { ...r, status: 'error', error: errMsg } : r));
      }
    }
    return updated;
  };

  // Build Gemini parts từ ref files đã sẵn sàng
  const buildRefParts = (refs) => {
    const parts = [];
    for (const rf of refs) {
      if (rf.mimeType.startsWith('image/') && rf.status === 'ready' && rf.preview) {
        // Ảnh nhỏ: inline base64
        parts.push({ inlineData: { mimeType: rf.mimeType, data: rf.preview } });
      } else if (rf.status === 'uploaded' && rf.uploadedUri) {
        // File đã upload: dùng fileUri
        parts.push({ fileData: { mimeType: rf.mimeType, fileUri: rf.uploadedUri } });
      }
    }
    return parts;
  };

  // ── Auto-generate narration script via Gemini ────────────────────────────
  const generateNarrationScript = async (videoPrompt, durationSec, keys, currentModel) => {
    const secHint = durationSec ? `${durationSec} giây` : 'phù hợp với nội dung';
    const scriptPrompt = `Viết script thuyết minh cho video sau. Yêu cầu:\n- Tiếng Việt, tự nhiên, phù hợp đọc thành tiếng\n- Thời lượng đọc khoảng ${secHint}\n- Chỉ trả về văn bản thuần túy (không tiêu đề, không giải thích, không markdown)\n- Ngắn gọn, súc tích, hấp dẫn, có cảm xúc\n\nNội dung video:\n${videoPrompt}`;
    return await callGeminiText(keys, scriptPrompt, currentModel);
  };

  // ── Generate TTS narration → remotion/public/narration.wav ───────────────
  const generateNarration = async (script) => {
    const text = (script || narrationText).trim();
    if (!text || !publicDir) return;
    setNarrationStatus('tts');
    const keys = loadKeys();
    try {
      if (ttsMode === 'gemini') {
        const result = await window.electronAPI?.geminiTTS?.({
          text,
          voiceName: ttsVoice,
          apiKeys: keys,
          outputFolder: publicDir,
          projectName: 'narration_remotion',
        });
        if (!result?.success) throw new Error(result?.error || 'Gemini TTS thất bại');
        await window.electronAPI?.remotionCopyAudioToPublic?.({ srcPath: result.path });
      } else {
        // Windows TTS: generateVoice với outputPath trực tiếp
        const outPath = publicDir + '\\narration.wav';
        const result = await window.electronAPI?.generateVoice?.({
          text,
          voice: ttsVoice,
          outputPath: outPath,
        });
        if (!result?.success) throw new Error(result?.error || 'Windows TTS thất bại');
      }
      setNarrationStatus('done');
    } catch (err) {
      setNarrationStatus('error');
      throw err;
    }
  };

  // ── Generate AI Image asset → remotion/public/{name} ────────────────────
  const generateAiImage = async (assetName, aiPrompt) => {
    setMissingAssets(prev => prev.map(a => a.name === assetName ? { ...a, status: 'generating' } : a));
    try {
      const result = await window.electronAPI?.bgGenerateImage?.({
        prompt: aiPrompt,
        model: 'imagen',
        outputFolder: publicDir,
        taskId: `remotion_${Date.now()}`,
      });
      if (!result?.success) throw new Error(result?.error || 'Tạo ảnh thất bại');
      // Copy to public dir with the expected filename
      const outPath = publicDir + '\\' + assetName;
      await window.electronAPI?.remotionCopyAudioToPublic?.({ srcPath: result.imagePath });
      // Actually rename - reuse copy handler with any name
      const copyRes = await window.electronAPI?.remotionCopyAudioToPublic?.({ srcPath: result.imagePath, destName: assetName });
      setMissingAssets(prev => prev.map(a => a.name === assetName ? { ...a, status: 'done', aiPath: result.imagePath } : a));
    } catch (err) {
      setMissingAssets(prev => prev.map(a => a.name === assetName ? { ...a, status: 'error', error: err.message } : a));
    }
  };

  // ── Build prompt ─────────────────────────────────────────────────────────
  const selectedSec = DURATION_OPTIONS[durationIdx].seconds;
  const customSecFinal = customUnit === 'm' ? customSeconds * 60 : customSeconds;
  // null = auto, -1 = custom input, else preset seconds
  const totalFrames = selectedSec === null ? null
    : selectedSec === -1 ? customSecFinal * 30
    : selectedSec * 30;

  function buildFullPrompt() {
    const { width, height } = ASPECT_OPTIONS[aspect];
    const hasVideoRef = refFiles.some(r => r.mimeType?.startsWith('video/') && ['ready', 'uploaded'].includes(r.status));
    const hasImageRef = refFiles.some(r => r.mimeType?.startsWith('image/') && ['ready', 'uploaded'].includes(r.status));
    const audioSection = ttsEnabled
      ? `\n\nAUDIO: Có file âm thanh lồng tiếng tại 'narration.wav'. Bắt buộc import Audio và staticFile từ 'remotion', thêm <Audio src={staticFile('narration.wav')} startFrom={0} volume={1} /> vào bên trong AbsoluteFill (render TRƯỚC các element visual).`
      : '';

    let refSection = '';
    if (hasVideoRef) {
      refSection = `CHẾ ĐỘ CHỈNH SỬA VIDEO: Tôi đính kèm video tham chiếu. Hãy phân tích kỹ:\n` +
        `1. Phân chia video thành các cảnh/đoạn logic\n` +
        `2. Với mỗi đoạn, tạo <Sequence from={N} durationInFrames={M}> tương ứng về timing\n` +
        `3. Tái tạo phong cách màu sắc, typography, transitions với animation mượt mà hơn\n` +
        `4. Match duration tổng của video gốc (điều chỉnh COMPOSITION_DURATION_FRAMES)\n\n`;
    } else if (hasImageRef) {
      const imageRefs = refFiles.filter(r => r.mimeType?.startsWith('image/') && ['ready','uploaded'].includes(r.status));
      const fileList  = imageRefs.map((r, i) => {
        const ext = (r.name || r.path || 'ref.jpg').split('.').pop().toLowerCase();
        return `ref_${i}.${ext}`;
      }).join(', ');
      refSection = `Tôi đính kèm ${imageRefs.length} ảnh tham chiếu (nhân vật/phong cách).\n` +
        `CÁC ẢNH NÀY ĐÃ ĐƯỢC SAO CHÉP VÀO THƯ MỤC PUBLIC: ${fileList}\n` +
        `BẮT BUỘC dùng <Img> và staticFile() để hiển thị nhân vật/ảnh từ tham chiếu:\n` +
        `  import { ..., Img, staticFile } from 'remotion';\n` +
        `  <Img src={staticFile('ref_0.jpg')} style={{ width:'...', height:'...', objectFit:'cover' }} />\n` +
        `Dùng ảnh tham chiếu làm nhân vật/nền chính trong video — KHÔNG vẽ nhân vật bằng CSS shapes.\n\n`;
    }

    const durationLine = totalFrames === null
      ? `- COMPOSITION_DURATION_FRAMES = <tự xác định phù hợp với nội dung, tối thiểu 150 frames>`
      : `- COMPOSITION_DURATION_FRAMES = ${totalFrames}`;
    return `${systemPrompt}\n\n${refSection}YÊU CẦU VIDEO:\n${prompt}${audioSection}\n\n[RÀNG BUỘC BẮT BUỘC — KHÔNG THAY ĐỔI]\n- COMPOSITION_WIDTH = ${width}\n- COMPOSITION_HEIGHT = ${height}\n- COMPOSITION_FPS = 30\n${durationLine}`;
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    const keys = loadKeys();
    if (!keys.length) return setErrorMsg('Chưa có Gemini API key. Vào Cài đặt → Gemini để thêm key.');
    if (!prompt.trim()) return setErrorMsg('Nhập mô tả video trước.');
    setErrorMsg(''); setPhase('generating'); setStreamBuffer('');
    setGeneratedCode(''); setVideoPath(null);
    setNarrationStatus('idle'); setScriptEditing(false);
    localStorage.setItem(LS_LAST_PROMPT, prompt);
    localStorage.setItem(LS_MODEL, model);

    // Copy ảnh tham chiếu vào remotion/public/ref_N.ext để code dùng staticFile()
    const imageRefs = refFiles.filter(r => r.mimeType?.startsWith('image/') && r.path && ['ready','uploaded'].includes(r.status));
    if (imageRefs.length > 0) {
      setLogs(prev => [...prev.slice(-299), `📋 Copy ${imageRefs.length} ảnh tham chiếu vào public folder...`]);
      setLogOpen(true);
      await window.electronAPI?.remotionCopyRefImagesToPublic?.({ filePaths: imageRefs.map(r => r.path) });
    }

    // Upload video/large images qua main process trước
    const hasNeedUpload = refFiles.some(r =>
      r.uploadedUri == null && (r.mimeType.startsWith('video/') || (r.mimeType.startsWith('image/') && r.size > PREVIEW_MAX_BYTES))
    );
    let currentRefs = refFiles;
    if (hasNeedUpload) {
      setLogs(prev => [...prev.slice(-299),'📤 Chuẩn bị upload file tham chiếu...']);
      setLogOpen(true);
      currentRefs = await ensureFilesUploaded(refFiles, keys[0]);
    }

    // TTS: auto-write script → generate audio trước khi Gemini viết code
    if (ttsEnabled) {
      setLogOpen(true);
      try {
        // Bước 1: AI tự viết kịch bản
        setNarrationStatus('scripting');
        setLogs(prev => [...prev.slice(-299),'✍️ AI đang viết kịch bản thuyết minh...']);
        const durationSec = totalFrames ? Math.round(totalFrames / 30) : null;
        const script = await generateNarrationScript(prompt, durationSec, keys, model);
        setNarrationText(script);
        setLogs(prev => [...prev.slice(-299),`📝 Kịch bản (${script.length} ký tự): ${script.slice(0, 80)}${script.length > 80 ? '…' : ''}`]);

        // Bước 2: Tạo audio TTS
        setLogs(prev => [...prev.slice(-299),`🎙️ Đang tạo audio (${ttsMode === 'gemini' ? ttsVoice : 'Windows TTS'})...`]);
        await generateNarration(script);
        setLogs(prev => [...prev.slice(-299),'✅ Audio lồng tiếng sẵn sàng: narration.wav']);
      } catch (err) {
        setNarrationStatus('error');
        setLogs(prev => [...prev.slice(-299),`❌ TTS lỗi: ${err.message} — tiếp tục render không có audio`]);
      }
    }

    const refParts = buildRefParts(currentRefs);
    let buffer = '';
    try {
      const raw = await callGeminiStream(keys, buildFullPrompt(), model, refParts, (chunk) => {
        buffer += chunk;
        setStreamBuffer(buffer);
      });
      const code = extractCode(raw);
      setGeneratedCode(code); setStreamBuffer('');
      localStorage.setItem(LS_LAST_CODE, code);
      setPhase('generated'); setCodeOpen(true);
      // Detect missing staticFile assets
      const assets = detectStaticFileRefs(code);
      setMissingAssets(assets);
      // Auto-render ngay sau khi có code
      setPhase('rendering'); setLogs([]); setLogOpen(true); setVideoPath(null);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const result = await window.electronAPI?.remotionRenderCode?.({
        code,
        outputFilename: `video_${ts}.mp4`,
        outputDir: outputDir || undefined,
      });
      if (result?.ok) { setVideoPath(result.path); setPhase('done'); }
      else { setPhase('error'); setErrorMsg(result?.error || 'Render thất bại'); }
    } catch (err) {
      setPhase('error'); setErrorMsg(err.message || 'Gemini thất bại');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const handleRender = async () => {
    if (!generatedCode) return;
    setPhase('rendering'); setLogs([]); setLogOpen(true); setVideoPath(null);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const result = await window.electronAPI?.remotionRenderCode?.({
      code: generatedCode,
      outputFilename: `video_${ts}.mp4`,
      outputDir: outputDir || undefined,
    });
    if (result?.ok) { setVideoPath(result.path); setPhase('done'); }
    else { setPhase('error'); setErrorMsg(result?.error || 'Render thất bại'); }
  };

  const handleSelectOutputDir = async () => {
    const dir = await window.electronAPI?.remotionSelectOutputDir?.();
    if (dir) { setOutputDir(dir); localStorage.setItem(LS_OUT_DIR, dir); }
  };

  const isBusy       = phase === 'generating' || phase === 'rendering';
  const isGenerating = phase === 'generating';
  const isRendering  = phase === 'rendering';
  const isGenerated  = phase === 'generated';
  const isDone       = phase === 'done';
  const readyRefCount = refFiles.filter(r => ['ready', 'uploaded'].includes(r.status)).length;
  const pendingCount  = refFiles.filter(r => r.status === 'pending').length;

  return (
    <div className="flex w-full h-full bg-[#0a0f18] text-slate-200 font-sans overflow-hidden relative">
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} />

      {/* ── LEFT PANEL ── */}
      <div className="w-[380px] shrink-0 bg-[#0d1424] border-r border-slate-800 flex flex-col h-full overflow-y-auto custom-scrollbar">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-[14px] font-black text-white flex items-center gap-2">
              <Video className="w-4 h-4 text-violet-400" /> Remotion Studio
            </h1>
            <p className="text-[10px] text-slate-500">Gemini → Code → Remotion → MP4</p>
          </div>
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 text-[11px] font-bold text-violet-400 hover:text-violet-300 bg-violet-900/20 border border-violet-800/40 px-3 py-1.5 rounded-lg transition-all">
            <BookOpen className="w-3.5 h-3.5" /> Hướng dẫn
          </button>
        </div>

        {/* ── Setup status banner ── */}
        {setupStatus === 'checking' && (
          <div className="mx-4 mt-3 flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-400">Đang kiểm tra môi trường Remotion...</span>
          </div>
        )}
        {setupStatus === 'installing' && (
          <div className="mx-4 mt-3 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
              <span className="text-[11px] font-bold text-amber-400">Đang cài Remotion dependencies...</span>
            </div>
            {setupLog.length > 0 && (
              <p className="text-[10px] font-mono text-amber-600 truncate">{setupLog[setupLog.length - 1]}</p>
            )}
          </div>
        )}
        {setupStatus === 'error' && (
          <div className="mx-4 mt-3 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">
            <p className="text-[11px] text-red-400 font-bold">⚠ Remotion setup lỗi</p>
            <p className="text-[10px] text-red-500 mt-0.5">Cài <strong>Node.js LTS</strong> từ nodejs.org rồi khởi động lại app.</p>
          </div>
        )}
        {setupStatus === 'ok' && setupLog.some(l => l.includes('npm install')) && (
          <div className="mx-4 mt-3 bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-2">
            <p className="text-[11px] text-emerald-400 font-bold">✅ Remotion dependencies đã cài xong!</p>
          </div>
        )}

        <div className="flex-1 p-4 space-y-4">

          {/* Model */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Gemini Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500">
              {GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>

          {/* Aspect */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Tỷ lệ khung hình</label>
            <div className="space-y-1">
              {ASPECT_OPTIONS.map((a, i) => (
                <button key={i} onClick={() => setAspect(i)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[11px] font-bold border transition-all ${aspect === i ? 'bg-violet-600/30 border-violet-500 text-violet-200' : 'bg-[#131d30] border-slate-700 text-slate-400 hover:border-violet-500/40'}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Thời lượng</label>
            <div className="flex gap-1.5 flex-wrap">
              {DURATION_OPTIONS.map((d, i) => (
                <button key={i} onClick={() => setDurationIdx(i)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${durationIdx === i ? 'bg-sky-600 border-sky-500 text-white' : 'bg-[#131d30] border-slate-700 text-slate-400 hover:border-sky-500/40'}`}>
                  {d.label}
                </button>
              ))}
            </div>
            {selectedSec === null && (
              <p className="text-[10px] text-slate-500 mt-1.5">AI tự xác định thời lượng phù hợp với nội dung</p>
            )}
            {selectedSec === -1 && (
              <div className="flex items-center gap-2 mt-2">
                <input type="number" min={1} max={600} value={customSeconds}
                  onChange={e => setCustomSeconds(Math.max(1, Number(e.target.value)))}
                  className="w-20 bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500" />
                <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[11px] font-bold">
                  {['s', 'm'].map(u => (
                    <button key={u} onClick={() => setCustomUnit(u)}
                      className={`px-3 py-1.5 transition-all ${customUnit === u ? 'bg-sky-600 text-white' : 'bg-[#131d30] text-slate-400 hover:bg-slate-700'}`}>
                      {u === 's' ? 'giây' : 'phút'}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-500">
                  = {customUnit === 'm' ? `${(customSeconds * 60).toFixed(0)}s` : `${customSeconds}s`}
                  {' '}({totalFrames} frames)
                </span>
              </div>
            )}
            {selectedSec !== null && selectedSec > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">{selectedSec * 30} frames @ 30fps</p>
            )}
          </div>

          {/* ── TTS / Lồng tiếng ── */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            {/* Header toggle */}
            <button onClick={() => setTtsEnabled(v => !v)}
              className={`w-full flex items-center justify-between px-4 py-2.5 transition-all ${ttsEnabled ? 'bg-violet-900/30' : 'bg-slate-900/30 hover:bg-slate-800/40'}`}>
              <span className="flex items-center gap-2 text-[11px] font-black text-slate-300">
                {ttsEnabled ? <Mic className="w-3.5 h-3.5 text-violet-400" /> : <MicOff className="w-3.5 h-3.5 text-slate-500" />}
                Lồng tiếng TTS (tự động)
              </span>
              <div className={`w-9 h-5 rounded-full transition-colors ${ttsEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}>
                <div className={`w-4 h-4 bg-white rounded-full mt-0.5 transition-transform ${ttsEnabled ? 'translate-x-4 ml-0.5' : 'translate-x-0 ml-0.5'}`} />
              </div>
            </button>

            {ttsEnabled && (
              <div className="px-4 pb-4 pt-3 space-y-3 bg-[#0d1628] border-t border-slate-800">
                {/* TTS Mode */}
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'gemini', label: 'Gemini TTS', sub: 'AI, chất lượng cao' },
                    { id: 'windows', label: 'Windows TTS', sub: 'Nhanh, không cần key' },
                  ].map(m => (
                    <button key={m.id} onClick={() => {
                      setTtsMode(m.id);
                      localStorage.setItem(LS_TTS_MODE, m.id);
                      setTtsVoice(m.id === 'gemini' ? 'Aoede' : 'vi-VN-HoaiMyNeural');
                    }}
                      className={`px-2 py-2 rounded-lg text-left transition-all border ${ttsMode === m.id ? 'bg-violet-600/30 border-violet-500' : 'bg-slate-800/40 border-slate-700 hover:border-violet-500/40'}`}>
                      <p className="text-[10px] font-black text-slate-200">{m.label}</p>
                      <p className="text-[9px] text-slate-500">{m.sub}</p>
                    </button>
                  ))}
                </div>

                {/* Voice selector */}
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Giọng đọc</label>
                  <select value={ttsVoice} onChange={e => { setTtsVoice(e.target.value); localStorage.setItem(LS_TTS_VOICE, e.target.value); }}
                    className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[11px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500">
                    {ttsMode === 'gemini'
                      ? GEMINI_TTS_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)
                      : winVoices.map(v => <option key={v.ShortName} value={v.ShortName}>{v.ShortName} ({v.Gender})</option>)
                    }
                  </select>
                </div>

                {/* Auto script display */}
                <div className="rounded-lg border border-slate-700 bg-[#131d30] overflow-hidden">
                  <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-700/60">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                      Kịch bản thuyết minh <span className="text-violet-500 font-bold">(AI tự viết)</span>
                    </span>
                    {narrationText && (
                      <button onClick={() => setScriptEditing(v => !v)}
                        className="text-[9px] text-slate-500 hover:text-violet-400 transition-colors">
                        {scriptEditing ? 'Thu gọn' : 'Chỉnh sửa'}
                      </button>
                    )}
                  </div>
                  {narrationStatus === 'scripting' && (
                    <p className="px-2.5 py-2 text-[10px] text-violet-400 animate-pulse">✍️ AI đang viết kịch bản...</p>
                  )}
                  {narrationStatus === 'tts' && (
                    <p className="px-2.5 py-2 text-[10px] text-sky-400 animate-pulse">🎙️ Đang tổng hợp giọng đọc...</p>
                  )}
                  {narrationStatus === 'done' && !scriptEditing && narrationText && (
                    <p className="px-2.5 py-2 text-[10px] text-slate-400 leading-relaxed line-clamp-3">{narrationText}</p>
                  )}
                  {(scriptEditing || (!narrationText && narrationStatus === 'idle')) && (
                    <textarea value={narrationText} onChange={e => setNarrationText(e.target.value)}
                      placeholder="AI sẽ tự viết kịch bản khi nhấn Tạo Code…"
                      rows={3}
                      className="w-full bg-transparent text-slate-200 text-[11px] px-2.5 py-2 focus:outline-none resize-none placeholder-slate-600"
                    />
                  )}
                  {!narrationText && narrationStatus === 'idle' && (
                    <p className="px-2.5 py-2 text-[10px] text-slate-600 italic">AI tự viết kịch bản dựa trên mô tả video</p>
                  )}
                  {narrationStatus === 'error' && (
                    <p className="px-2.5 py-2 text-[10px] text-red-400">❌ Lỗi — render tiếp không có audio</p>
                  )}
                </div>
                {narrationStatus === 'done' && (
                  <p className="text-[10px] text-emerald-400 font-bold">✅ narration.wav sẵn sàng</p>
                )}
                <p className="text-[9px] text-slate-600">💡 Kịch bản + audio tự động tạo khi nhấn "Tạo Code"</p>
              </div>
            )}
          </div>

          {/* Output dir */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Thư mục xuất video</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-[#131d30] border border-slate-700 rounded-lg px-3 py-2 text-[11px] text-slate-400 truncate min-w-0">
                {outputDir || <span className="text-slate-600 italic">Chưa chọn...</span>}
              </div>
              <button onClick={handleSelectOutputDir}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white border border-slate-600 transition-all">
                <FolderOpen className="w-3.5 h-3.5" /> Chọn
              </button>
            </div>
            {outputDir && (
              <button onClick={() => window.electronAPI?.remotionOpenDir?.(outputDir)}
                className="mt-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                → Mở thư mục
              </button>
            )}
          </div>

          {/* ── Reference Files ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ImagePlus className="w-3 h-3" /> Ảnh/Video tham chiếu
                <span className="text-slate-700 font-normal normal-case">(tuỳ chọn)</span>
              </label>
              <button onClick={handleAddRefFiles}
                className="flex items-center gap-1 text-[10px] font-bold text-violet-400 hover:text-violet-300 border border-violet-800/40 bg-violet-900/20 px-2 py-0.5 rounded-md transition-all">
                <Upload className="w-3 h-3" /> Thêm
              </button>
            </div>
            {refFiles.length === 0 ? (
              <button onClick={handleAddRefFiles}
                className="w-full h-16 flex flex-col items-center justify-center gap-1 border border-dashed border-slate-700 hover:border-violet-600 rounded-lg text-slate-600 hover:text-violet-400 transition-all bg-slate-900/20 hover:bg-violet-900/10">
                <ImagePlus className="w-5 h-5" />
                <span className="text-[10px]">Nhấn để chọn ảnh/video làm tham chiếu</span>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {refFiles.map(rf => <RefFileCard key={rf.id} rf={rf} onRemove={handleRemoveRefFile} />)}
                <button onClick={handleAddRefFiles}
                  className="h-20 flex flex-col items-center justify-center gap-1.5 border border-dashed border-slate-700 hover:border-violet-500 rounded-lg text-slate-600 hover:text-violet-400 transition-all">
                  <Upload className="w-4 h-4" />
                  <span className="text-[9px]">Thêm</span>
                </button>
              </div>
            )}
            {refFiles.length > 0 && (
              <p className="text-[9px] text-slate-600 mt-1.5">
                {readyRefCount > 0 && `${readyRefCount} file sẵn sàng.`}
                {pendingCount > 0 && ` ${pendingCount} video sẽ upload Gemini khi nhấn "Tạo Code".`}
              </p>
            )}
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mô tả video</label>
              {readyRefCount > 0 && <span className="text-[9px] text-emerald-500 font-bold">{readyRefCount} tham chiếu sẵn sàng</span>}
            </div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder={readyRefCount > 0
                ? 'Mô tả + có thể thêm "tái tạo phong cách của ảnh/video tham chiếu"...'
                : 'Ví dụ: "Video intro YouTube phong cách neon tím, tên kênh xuất hiện từng chữ..."'}
              rows={6}
              className="w-full bg-[#131d30] border border-slate-700 text-slate-200 text-[12px] rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 resize-none custom-scrollbar placeholder-slate-600"
            />
            <div className="mt-1.5">
              <p className="text-[9px] text-slate-600 mb-1">Ví dụ prompt:</p>
              <div className="space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                {EXAMPLE_PROMPTS.map((ex, i) => (
                  <button key={i} onClick={() => setPrompt(ex)}
                    className="w-full text-left text-[9px] text-slate-500 hover:text-slate-300 bg-slate-800/40 hover:bg-slate-800 border border-slate-800 rounded px-2 py-1.5 transition-all line-clamp-2 leading-relaxed">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300">{errorMsg}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-2">
            <button onClick={handleGenerate} disabled={isBusy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-900/30">
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang tạo code...</>
                : <><Sparkles className="w-4 h-4" /> Tạo Code{readyRefCount + pendingCount > 0 ? ` + ${readyRefCount + pendingCount} tham chiếu` : ' (Gemini)'}</>}
            </button>
            {generatedCode && (
              <button onClick={handleRender} disabled={isBusy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-lg shadow-orange-900/30">
                {isRendering
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Remotion render...</>
                  : <><Play className="w-4 h-4" /> Render Video (Remotion)</>}
              </button>
            )}
          </div>

          {/* Done */}
          {isDone && videoPath && (
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-3 space-y-2">
              <p className="flex items-center gap-2 text-[12px] text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" /> Video render xong!
              </p>
              <p className="text-[10px] text-slate-500 font-mono break-all">{videoPath}</p>
              <div className="flex gap-2">
                <button onClick={() => window.electronAPI?.remotionOpenVideo?.(videoPath)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-all">
                  <Play className="w-3.5 h-3.5" /> Phát video
                </button>
                <button onClick={() => window.electronAPI?.remotionOpenDir?.(outputDir)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white transition-all">
                  <FolderOpen className="w-3.5 h-3.5" /> Thư mục
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0f18]">
        <div className="h-11 border-b border-slate-800 px-5 flex items-center gap-3 shrink-0 bg-[#0d1424]">
          <span className="text-[12px] font-bold text-slate-400">
            {isGenerating ? '⏳ Đang upload tham chiếu + Gemini viết code...'
             : isRendering ? '🎞️ Remotion render — xem Log bên dưới...'
             : isDone      ? '✅ Video render thành công!'
             : isGenerated ? '✅ Code sẵn sàng — nhấn "Render Video" để xuất MP4'
             : '💡 Mô tả video, thêm tham chiếu (tuỳ chọn), nhấn "Tạo Code"'}
          </span>
          {isBusy && <Loader2 className="w-4 h-4 animate-spin text-violet-400" />}
        </div>

        {isGenerating && streamBuffer && (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="bg-[#0e1628] border border-slate-800 rounded-xl p-4 h-full overflow-y-auto custom-scrollbar">
              <p className="text-[10px] text-violet-400 font-bold mb-2 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Gemini đang viết code...
              </p>
              <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">{streamBuffer}</pre>
            </div>
          </div>
        )}

        {!isGenerating && generatedCode && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            <CodeViewer code={generatedCode} open={codeOpen} onToggle={() => setCodeOpen(v => !v)} />
            {isGenerated && (
              <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-3 text-[11px] text-amber-400">
                💡 Nhấn <strong>Render Video</strong> để Remotion CLI xuất MP4.
                {!outputDir && <span className="block mt-1 text-orange-400">⚠ Chưa chọn thư mục — sẽ lưu vào thư mục mặc định Remotion.</span>}
              </div>
            )}

            {/* ── Missing AI Assets panel ── */}
            {missingAssets.length > 0 && (
              <div className="bg-[#0e1628] border border-sky-800/40 rounded-xl p-4">
                <p className="text-[11px] font-black text-sky-400 mb-3 flex items-center gap-2">
                  <Wand2 className="w-4 h-4" /> Assets AI cần tạo
                  <span className="text-[9px] text-slate-600 font-normal">Code tham chiếu file chưa có — tạo bằng AI</span>
                </p>
                <div className="space-y-2">
                  {missingAssets.map((asset, i) => (
                    <div key={i} className="bg-[#0a0f1a] border border-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {asset.type === 'video'
                            ? <Film className="w-3.5 h-3.5 text-violet-400" />
                            : <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />}
                          <span className="text-[11px] font-bold text-slate-300">{asset.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${asset.type === 'video' ? 'bg-violet-900/40 text-violet-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                            {asset.type === 'video' ? 'Video' : 'Ảnh'}
                          </span>
                        </div>
                        {asset.status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {asset.status === 'generating' && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
                      </div>

                      {/* Prompt input */}
                      {asset.type === 'image' && asset.status !== 'done' && (
                        <div className="space-y-2">
                          <input
                            value={asset.prompt}
                            onChange={e => setMissingAssets(prev => prev.map((a, j) => j === i ? { ...a, prompt: e.target.value } : a))}
                            placeholder={`Mô tả ảnh "${asset.name}" cần tạo bằng AI...`}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                          />
                          <button
                            onClick={() => generateAiImage(asset.name, asset.prompt)}
                            disabled={!asset.prompt.trim() || asset.status === 'generating' || !publicDir}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                            <Wand2 className="w-3 h-3" />
                            {asset.status === 'generating' ? 'Đang tạo...' : 'Tạo bằng Imagen AI'}
                          </button>
                        </div>
                      )}
                      {asset.type === 'video' && asset.status !== 'done' && (
                        <div className="bg-violet-900/20 border border-violet-800/40 rounded px-2 py-2">
                          <p className="text-[9px] text-violet-400">Video AI cần tạo qua <strong>Veo Studio</strong>:</p>
                          <p className="text-[9px] text-slate-500 mt-0.5">1. Vào tab Veo Studio → tạo video → lưu vào <code className="text-violet-300">remotion\public\{asset.name}</code></p>
                          <button onClick={() => window.electronAPI?.remotionOpenDir?.(publicDir)}
                            className="mt-1.5 text-[9px] text-violet-400 hover:text-violet-300 transition-colors">
                            → Mở thư mục public
                          </button>
                        </div>
                      )}
                      {asset.status === 'done' && <p className="text-[10px] text-emerald-400">✅ Đã lưu vào public/{asset.name}</p>}
                      {asset.status === 'error' && <p className="text-[10px] text-red-400">❌ {asset.error || 'Thất bại'}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-600 mt-2">Tạo xong assets → nhấn Render Video để xuất</p>
              </div>
            )}
          </div>
        )}

        {!isGenerating && !generatedCode && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-700">
            <Code2 className="w-14 h-14 mb-4 opacity-20" />
            <p className="text-[14px] font-bold text-slate-600">Code Gemini tạo ra sẽ hiện ở đây</p>
            <p className="text-[11px] mt-1 text-slate-700">Nhập mô tả + thêm tham chiếu → nhấn "Tạo Code"</p>
            <button onClick={() => setShowHelp(true)} className="mt-4 flex items-center gap-2 text-[11px] font-bold text-violet-500 hover:text-violet-300 transition-colors">
              <BookOpen className="w-4 h-4" /> Xem hướng dẫn sử dụng
            </button>
          </div>
        )}

        <LogPanel logs={logs} open={logOpen} onToggle={() => setLogOpen(v => !v)} onClear={() => setLogs([])} />
      </div>
    </div>
  );
}
