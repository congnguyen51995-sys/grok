import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeAndCloneScript } from '../services/geminiClone';
import { generateCinematicPrompts } from '../services/geminiPrompt';
import { retryWithKeyRotation } from '../services/keyRotation';
import {
  Copy, FileText, Sparkles, Zap, Loader2, Check,
  Youtube, Music, Upload, Download, Key, Eye, EyeOff,
  ChevronRight, Save, AlertCircle, RefreshCw,
  Clapperboard, Send, RotateCcw, Clock, Target,
  Music2, Layout, Globe, User, Sword,
  Lightbulb, Users, PenTool, Languages, ChevronDown,
  Plus, X, Image as ImageIcon, Map, Database, Settings, Film,
  Camera, Volume2, ArrowRight, Hash, Tag, Share2, AlignLeft,
  Link, Clipboard, CheckCircle2, HardDrive, Folder, Trash2,
  Play, TrendingDown,
} from 'lucide-react';

function cn(...classes) { return classes.filter(Boolean).join(' '); }

const LS_KEYS = 'fluxy_gemini_api_keys';
const GEMINI_MODEL = 'gemini-2.5-flash';

function loadSavedKeys() {
  try {
    // Migrate from old single-key storage
    const legacy = localStorage.getItem('fluxy_gemini_api_key');
    const stored = localStorage.getItem(LS_KEYS);
    if (!stored && legacy) {
      const keys = [legacy.trim()].filter(Boolean);
      localStorage.setItem(LS_KEYS, JSON.stringify(keys));
      return keys;
    }
    return JSON.parse(stored || '[]');
  } catch { return []; }
}

async function geminiChatRotating(apiKeys, prompt, maxTokens = 4096, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: maxTokens,
        // Tắt thinking — tiết kiệm quota (Gemini 2.5 Flash tốn 20-50K thinking token/lần mặc định)
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') throw new Error('Nội dung bị chặn do chính sách an toàn.');
    let text = response?.text || '';
    if (!text && candidate?.content?.parts) text = candidate.content.parts.filter(p => p.text).map(p => p.text).join('');
    return text || '';
  }, apiKeys, { onSwitch });
}
const BATCH_SIZE = 20;

// ─── JSON BLOCK STRIPPER (dùng cho mode 1-5) ─────────────────────────────────
// Xoá các block JSON ([...] / {...}) và fenced code fence ra khỏi output AI
function stripJsonBlocks(text) {
  if (!text) return '';
  // 1. Xoá fenced code blocks  ```json ... ```
  let s = text.replace(/`{3}[^\n]*\n[\s\S]*?`{3}/g, '');

  // 2. Line-by-line: bỏ qua các dòng nằm trong JSON block
  //    JSON block bắt đầu khi gặp dòng chỉ có '[' hoặc '{'
  //    và kết thúc khi depth về 0
  const lines = s.split('\n');
  const out   = [];
  let depth   = 0;

  for (const line of lines) {
    const t = line.trim();

    if (depth === 0) {
      // Dòng chỉ là '[' hoặc '{' → bắt đầu JSON block
      if (t === '[' || t === '{') {
        depth = 1;
        continue; // bỏ dòng mở bracket
      }
      out.push(line);
    } else {
      // Đang trong JSON block → đếm bracket để biết khi nào kết thúc
      // Đếm thô (bỏ qua bracket trong string) — đủ dùng cho output AI thực tế
      for (const ch of t) {
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth--;
      }
      if (depth <= 0) depth = 0;
      // Không push dòng nào trong JSON block (kể cả dòng đóng bracket)
    }
  }

  // 3. Dọn dẹp blank lines thừa
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── CLONE VIDEO ─────────────────────────────────────────────────────────────

const CLONE_MODES = [
  { id: 1, label: '[Chế độ 1] Bóc tách kịch bản gốc 100%', desc: 'Trích xuất toàn bộ nội dung video gốc dưới dạng kịch bản phân cảnh.' },
  { id: 2, label: '[Chế độ 2] Tóm tắt & Rút trích công thức', desc: 'Tóm tắt 5 điểm cốt lõi và phân tích Công thức Viral.' },
  { id: 3, label: '[Chế độ 3] Viết lại y hệt chủ đề (Không đạo văn)', desc: 'Viết lại hoàn toàn lời thoại và hình ảnh, giữ nguyên chủ đề.' },
  { id: 4, label: '[Chế độ 4] Clone cấu trúc - Đổi chủ đề', desc: 'Mượn bộ khung, nhịp điệu và áp dụng cho chủ đề mới.' },
  { id: 5, label: '[Chế độ 5] Trích xuất lời thoại & Timestamps', desc: 'Lấy toàn bộ lời thoại kèm mốc thời gian, xuất TXT/SRT.' },
  { id: 6, label: '[Chế độ 6] Tái tạo video với Veo 3.1', desc: 'Tái tạo bám sát kịch bản gốc, nâng cấp Cinematic/4K (JSON).' },
];

function CloneVideoPanel({ apiKeys, onKeySwitch, onSendToPrompt }) {
  const [platform, setPlatform] = useState('youtube');
  const [url, setUrl] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [mode, setMode] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // { phase, done, total, message, currentSeg, structure }
  const [progressLog, setProgressLog] = useState([]); // lịch sử các bước
  const resultsRef = useRef(null);

  // Mode 1-5: lọc bỏ JSON block, mode 6: giữ nguyên
  const filteredResult = useMemo(() => (result && mode < 6) ? stripJsonBlocks(result) : result, [result, mode]);

  useEffect(() => {
    if (result && resultsRef.current) resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.readAsDataURL(file);
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
  });

  // Chuẩn hoá MIME type cho file video — tránh lỗi Gemini "Unsupported MIME type: text/html"
  const resolveVideoMimeType = (file) => {
    if (file.type && file.type.startsWith('video/')) return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const MAP = {
      mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
      qt: 'video/quicktime', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
      flv: 'video/x-flv', webm: 'video/webm', mkv: 'video/x-matroska',
      '3gp': 'video/3gpp', '3gpp': 'video/3gpp', mpg: 'video/mpeg', mpeg: 'video/mpeg',
      ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
    };
    return MAP[ext] || 'video/mp4';
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) { alert('Tệp quá lớn. Giới hạn tối đa là 500MB.'); return; }
    setFileName(file.name);
    setVideoFile(file);
  };

  const handleGenerate = async () => {
    if (!apiKeys?.length) { setError('Vui lòng nhập ít nhất 1 API Key Gemini ở thanh trên.'); return; }
    let input;
    if (platform === 'upload') {
      if (!videoFile) { setError('Vui lòng chọn file video.'); return; }
      try { input = { data: await fileToBase64(videoFile), mimeType: resolveVideoMimeType(videoFile) }; }
      catch { setError('Lỗi khi đọc tệp video. Vui lòng thử lại.'); return; }
    } else {
      if (!url) { setError('Vui lòng nhập URL video.'); return; }
      input = url;
    }
    setIsGenerating(true); setResult(''); setError(''); setProgress(null); setProgressLog([]);
    try {
      const onProgress = (prog) => {
        setProgress(prog);
        // Chỉ log các bước quan trọng vào lịch sử
        if (['structure', 'start', 'segment_done', 'segment_error', 'fallback', 'assembling', 'done'].includes(prog.phase)) {
          setProgressLog(prev => [...prev, { ...prog, ts: Date.now() }]);
        }
      };
      setResult(await analyzeAndCloneScript(apiKeys, input, mode, channelTopic, newTopic, onKeySwitch, onProgress) || '');
    } catch (err) {
      let msg = 'Đã xảy ra lỗi khi xử lý. Vui lòng thử lại.';
      if (err?.message?.includes('429') || err?.status === 'RESOURCE_EXHAUSTED')
        msg = 'API vượt hạn mức (429). Vui lòng đợi vài phút rồi thử lại hoặc đổi API Key.';
      else if (err?.message?.includes('503') || err?.status === 'UNAVAILABLE' || err?.message?.includes('high demand'))
        msg = 'Model Gemini đang quá tải (503). Đã tự động thử lại nhưng vẫn lỗi. Vui lòng thử lại sau vài phút.';
      else if (err?.message?.includes('API_KEY') || err?.message?.includes('API key'))
        msg = 'API Key không hợp lệ. Vui lòng kiểm tra lại tại aistudio.google.com.';
      else if (err?.message) msg = err.message;
      setError(msg);
    } finally { setIsGenerating(false); }
  };

  const copyToClipboard = () => { if (!filteredResult) return; navigator.clipboard.writeText(filteredResult); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const downloadAsFile = (format) => {
    if (!filteredResult) return;
    const blob = new Blob([filteredResult], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `kich-ban-${Date.now()}.${format}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  };

  const switchPlatform = (p) => { setPlatform(p); setUrl(''); setVideoFile(null); setFileName(''); };

  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="w-[380px] shrink-0 border-r border-slate-800 flex flex-col bg-[#0b1120] overflow-y-auto custom-scrollbar">
        <div className="p-4 border-b border-slate-800">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Nguồn video</span>
          <div className="flex gap-2">
            {[['youtube','YouTube',<Youtube size={13}/>,'bg-red-600'],['tiktok','TikTok',<Music size={13}/>,'bg-slate-600'],['upload','Tải lên',<Upload size={13}/>,'bg-blue-600']].map(([p,label,icon,color]) => (
              <button key={p} onClick={() => switchPlatform(p)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all', platform === p ? `${color} text-white` : 'bg-slate-800 text-slate-400 hover:bg-slate-700')}>
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-b border-slate-800">
          {platform === 'upload' ? (
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">File Video (Max 500MB)</span>
              <div className="relative group">
                <input type="file" accept="video/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                <div className={cn('w-full border-2 border-dashed rounded-xl p-6 text-center transition-all', videoFile ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700 group-hover:border-slate-600 bg-[#0a1020]')}>
                  {videoFile ? (<div className="space-y-1"><Check size={22} className="text-blue-400 mx-auto" /><p className="text-blue-400 font-medium text-xs">{fileName}</p><p className="text-[10px] text-slate-500">Đã sẵn sàng phân tích</p></div>)
                    : (<div className="space-y-1"><Upload size={22} className="text-slate-600 mx-auto group-hover:text-slate-400 transition-colors" /><p className="text-slate-400 text-xs">Kéo thả hoặc click để chọn</p><p className="text-[10px] text-slate-600">MP4, MOV, AVI... (Max 500MB)</p></div>)}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">URL Video {platform === 'youtube' ? 'YouTube' : 'TikTok'}</span>
              <textarea value={url} onChange={e => setUrl(e.target.value)} placeholder={`Dán link ${platform === 'youtube' ? 'YouTube' : 'TikTok'} vào đây...`} rows={3}
                className="w-full bg-[#0a1020] border border-slate-700 rounded-xl px-3 py-2.5 text-[12px] text-slate-200 focus:outline-none focus:border-blue-500/60 resize-none" />
              {platform === 'youtube' && (
                <p className="mt-1.5 text-[10px] text-emerald-500 leading-relaxed">
                  ✅ YouTube: Gemini đọc trực tiếp video — kết quả chính xác 100%
                </p>
              )}
              {platform === 'tiktok' && (
                <p className="mt-1.5 text-[10px] text-amber-500 leading-relaxed">
                  ⚠️ TikTok: Gemini không đọc được URL TikTok. Hãy tải video về và dùng chế độ "Tải lên" để có kết quả chính xác.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-b border-slate-800 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Chủ đề kênh của bạn</label>
            <input type="text" value={channelTopic} onChange={e => setChannelTopic(e.target.value)} placeholder="VD: Vlog sinh tồn, Review phim..."
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 focus:outline-none focus:border-blue-500/60" />
          </div>
          {mode === 4 && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Chủ đề mới (Chế độ 4)</label>
              <input type="text" value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Điền chủ đề mới muốn áp dụng..."
                className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 focus:outline-none focus:border-blue-500/60" />
            </div>
          )}
        </div>

        <div className="p-4 mt-auto">
          {error && (<div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3"><AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" /><p className="text-[11px] text-red-300">{error}</p></div>)}
          <button onClick={handleGenerate} disabled={isGenerating || !apiKeys?.length || (platform === 'upload' ? !videoFile : !url)}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20">
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {isGenerating ? 'Đang xử lý...' : 'Bắt đầu xử lý'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f1524]">
        <div className="h-12 border-b border-slate-800 flex items-center px-5 shrink-0 bg-[#141c2f]">
          <h2 className="text-sm font-bold text-white">Clone Video</h2>
          <ChevronRight size={13} className="text-slate-600 mx-1.5" />
          <span className="text-xs text-slate-500">Chế độ {mode} — AI Studio Gemini 2.5 Flash</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Chọn chế độ xử lý</p>
            <div className="grid grid-cols-2 gap-2">
              {CLONE_MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={cn('p-3.5 border rounded-xl text-left transition-all relative', mode === m.id ? 'bg-violet-600 border-violet-500 shadow-[0_0_16px_rgba(124,58,237,0.3)]' : 'bg-[#1a2235] border-slate-800 hover:border-slate-600')}>
                  <p className={cn('font-bold text-[11px] mb-0.5 leading-snug', mode === m.id ? 'text-white' : 'text-slate-200')}>{m.label}</p>
                  <p className={cn('text-[10px] leading-snug', mode === m.id ? 'text-violet-200' : 'text-slate-500')}>{m.desc}</p>
                  {mode === m.id && <Check size={12} className="absolute top-2.5 right-2.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {filteredResult && (
            <div ref={resultsRef} className="bg-[#1a2235] border border-slate-700/60 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-[#141c2f]">
                <span className="text-sm font-bold text-white">Kết quả kịch bản</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    const sceneCount = (filteredResult.match(/\[(?:CẢNH|SCENE|Cảnh)\s+\d+/gi) || []).length;
                    onSendToPrompt(filteredResult, sceneCount > 0 ? { quantity: sceneCount } : null);
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 rounded-lg text-[11px] font-bold transition-colors">
                    <ArrowRight size={12}/> Gửi sang Tạo Prompt
                  </button>
                  {mode === 5 && (<><button onClick={() => downloadAsFile('txt')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-[11px] font-bold transition-colors"><Download size={12}/> .TXT</button><button onClick={() => downloadAsFile('srt')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg text-[11px] font-bold transition-colors"><Download size={12}/> .SRT</button></>)}
                  {mode === 6 && (<button onClick={() => downloadAsFile('json')} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg text-[11px] font-bold transition-colors"><Download size={12}/> .JSON</button>)}
                  <button onClick={copyToClipboard} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-[11px] font-bold transition-colors">{copied ? <Check size={12} className="text-emerald-400"/> : <Copy size={12}/>}{copied ? 'Đã sao chép' : 'Sao chép'}</button>
                </div>
              </div>
              <div className="p-4">
                {mode === 6 ? (<pre className="text-[11px] font-mono text-blue-300 bg-[#0a1020] border border-slate-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all">{filteredResult}</pre>)
                  : (<div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed"><ReactMarkdown>{filteredResult}</ReactMarkdown></div>)}
              </div>
            </div>
          )}

          {!result && !isGenerating && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-violet-600/20 border border-violet-500/20 flex items-center justify-center"><Copy size={24} className="text-violet-400"/></div>
              <p className="text-sm text-slate-400 font-medium">Chưa có kết quả</p>
              <p className="text-xs text-slate-600 max-w-xs">Chọn chế độ, nhập URL hoặc tải lên video, sau đó nhấn Bắt đầu xử lý.</p>
            </div>
          )}
          {isGenerating && (
            <div className="space-y-4">
              {/* Header trạng thái */}
              <div className="flex items-center gap-3 bg-violet-600/10 border border-violet-500/20 rounded-xl px-4 py-3">
                <Loader2 size={18} className="animate-spin text-violet-400 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-violet-300 font-semibold truncate">
                    {progress?.message || 'Đang khởi động phân tích...'}
                  </p>
                  {progress?.total > 0 && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Tiến độ: {progress.done || 0}/{progress.total} đoạn
                    </p>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {progress?.total > 0 && (
                <div className="bg-[#1a2235] border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-slate-400 font-medium">Phân tích từng đoạn</span>
                    <span className="text-[11px] text-violet-400 font-bold">{progress.done || 0}/{progress.total}</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 mb-3">
                    <div
                      className="bg-violet-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(((progress.done || 0) / progress.total) * 100)}%` }}
                    />
                  </div>
                  {/* Danh sách đoạn */}
                  {progress.structure?.segments && (
                    <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                      {progress.structure.segments.map((seg, i) => {
                        const isDone   = i < (progress.done || 0);
                        const isCurrent = i === (progress.done || 0) && progress.phase === 'analyzing';
                        return (
                          <div key={i} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] transition-colors
                            ${isCurrent ? 'bg-violet-600/20 border border-violet-500/30' : isDone ? 'bg-emerald-600/5' : 'bg-transparent'}`}>
                            <span className="shrink-0">
                              {isDone ? '✅' : isCurrent ? <Loader2 size={10} className="animate-spin text-violet-400 inline"/> : '⏳'}
                            </span>
                            <span className={`font-mono ${isCurrent ? 'text-violet-300' : isDone ? 'text-slate-400' : 'text-slate-600'}`}>
                              {seg.from}–{seg.to}
                            </span>
                            <span className={`truncate ${isCurrent ? 'text-white font-medium' : isDone ? 'text-slate-400' : 'text-slate-600'}`}>
                              {seg.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Log lịch sử */}
              {progressLog.length > 0 && (
                <div className="bg-[#0a1020] border border-slate-800 rounded-xl p-3 space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                  {progressLog.map((log, i) => (
                    <p key={i} className="text-[10px] font-mono text-slate-500 leading-relaxed">{log.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SCRIPT WRITER ───────────────────────────────────────────────────────────

const GOALS = ["Giải trí & Viral","Kể chuyện lịch sử kịch tính","Giáo dục & Kiến thức","Truyền cảm hứng & Động lực","Kinh dị & Bí ẩn","Quảng bá thương hiệu/Sản phẩm","Phim tài liệu & Khám phá","Hành trình & Trải nghiệm (Vlog)"];
const TONES = ["Bi tráng & Hào hùng","Căng thẳng & Kịch tính","Thư giãn & ASMR","Bí ẩn & Ma mị","Hài hước & Châm biếm","Sâu lắng & Cảm động","Hiện đại & Năng động","Hoài cổ & Cinematic"];
const AUDIENCES = ["Người trẻ (Gen Z & Alpha)","Dân văn phòng & Công sở","Người mê lịch sử & Văn hóa","Người thích chữa lành & Chill","Fan phim kinh dị & Bí ẩn","Người kinh doanh & Khởi nghiệp","Phụ huynh & Trẻ em","Người yêu thiên nhiên & Du lịch"];
const LANGUAGES = [{label:'Tiếng Việt',code:'vi'},{label:'Tiếng Anh',code:'en'},{label:'Tiếng Trung',code:'zh'},{label:'Tiếng Nhật',code:'ja'},{label:'Tiếng Hàn',code:'ko'}];

const emptyChar = () => ({ id: Date.now() + Math.random(), name: '', gender: 'Nam', age: '', ethnicity: '', appearance: '', clothing: '', role: '' });

function ScriptWriterPanel({ apiKeys, onKeySwitch, onSendToPrompt }) {

  const [mode, setMode] = useState('script');
  const [params, setParams] = useState({
    topic: '', platform: 'TikTok dọc',
    sceneDuration: 8, totalDuration: 3,
    goal: GOALS[1], tone: TONES[0], audience: AUDIENCES[0], conceptCount: 5,
  });
  const [scriptLang, setScriptLang] = useState('vi-VN');
  const [scriptStyle, setScriptStyle] = useState('Mặc định');
  const [script, setScript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingHooks, setIsGeneratingHooks] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [targetLang, setTargetLang] = useState('Tiếng Việt');
  const resultRef = useRef(null);

  // Character profiles
  const [mainChar, setMainChar] = useState(emptyChar());
  const [secChars, setSecChars] = useState([]);
  const [showChars, setShowChars] = useState(false);

  const addSecChar = () => { if (secChars.length < 5) setSecChars(p => [...p, emptyChar()]); };
  const removeSecChar = (id) => setSecChars(p => p.filter(c => c.id !== id));
  const updateSecChar = (id, field, val) => setSecChars(p => p.map(c => c.id === id ? { ...c, [field]: val } : c));

  const buildCharacterBlock = () => {
    const hasMain = mainChar.name || mainChar.appearance || mainChar.clothing || mainChar.ethnicity;
    const validSec = secChars.filter(c => c.name || c.appearance);
    if (!hasMain && validSec.length === 0) return '';
    const fmtChar = (c, label) => {
      let s = `${label}\n`;
      if (c.name) s += `  • Tên: ${c.name}\n`;
      s += `  • Giới tính: ${c.gender}${c.age ? ` | Độ tuổi: ${c.age}` : ''}\n`;
      if (c.ethnicity) s += `  • Sắc tộc / Quốc tịch: ${c.ethnicity}\n`;
      if (c.appearance) s += `  • Ngoại hình chi tiết: ${c.appearance}\n`;
      if (c.clothing) s += `  • Trang phục & Phụ kiện: ${c.clothing}\n`;
      if (c.role) s += `  • Vai trò trong kịch bản: ${c.role}\n`;
      return s;
    };
    let block = `\n${'═'.repeat(46)}\nHỒ SƠ NHÂN VẬT (XÁC ĐỊNH SẴN — BẮT BUỘC DÙNG CHÍNH XÁC, KHÔNG THAY ĐỔI):\n\n`;
    if (hasMain) block += fmtChar(mainChar, '👤 NHÂN VẬT CHÍNH:') + '\n';
    validSec.forEach((c, i) => { block += fmtChar(c, `👥 NHÂN VẬT PHỤ ${i + 1}:`) + '\n'; });
    block += `⚠️ Tuyệt đối KHÔNG thay đổi, KHÔNG sáng tác lại tên, ngoại hình, trang phục của các nhân vật trên.\n${'═'.repeat(46)}`;
    return block;
  };

  const MODEL = GEMINI_MODEL;
  const SCENE_CHUNK = 25; // scenes per API call
  const [genProgress, setGenProgress] = useState('');

  const SCENE_FORMAT = (langLabel, noDialogue) => `⚠️ QUY TẮC SHOT — BẮT BUỘC THỰC HIỆN:
• Số shot mỗi cảnh: TỐI THIỂU 1, TỐI ĐA 5 — KHÔNG mặc định 2 shot cho mọi cảnh
• Căn cứ theo nội dung & kịch tính:
  - 1 shot: cảnh thiền tư, im lặng, cận cảm xúc, moment trầm tĩnh kéo dài
  - 2 shot: cảnh chuyển tiếp nhẹ, nhân vật đang suy nghĩ hoặc di chuyển đơn
  - 3 shot: cảnh đối thoại ngắn, hành động vừa, khám phá không gian
  - 4 shot: cảnh xung đột, hành động nhiều bước, montage cảm xúc
  - 5 shot: cảnh hành động căng thẳng, cao trào, nhiều nhân vật tương tác, montage nhanh
• Mỗi shot PHẢI có góc máy KHÁC nhau (cấm lặp góc liên tiếp)
• Góc máy đa dạng: ECU / CU / MCU / MS / MLS / LS / WS / EWS / POV / OTS / Dutch Angle / Bird's Eye / Low Angle / High Angle / Tracking / Dolly / Handheld / Crane / Aerial

ĐỊNH DẠNG MỖI CẢNH:
[CẢNH n: Xs → Ys] — [Tên cảnh]
🎬 BỐI CẢNH: [địa điểm, thời gian, ánh sáng, không khí]
🎥 HÌNH ẢNH: (viết đủ số shot phù hợp nội dung — từ 1 đến 5 shot, mỗi shot góc khác nhau)
  📷 Shot 1 | [Xs→Ys] | [GÓC MÁY — chọn phù hợp]
     → Bối cảnh: [hậu cảnh, ánh sáng, màu sắc]
     → Hành động: [nhân vật/biểu cảm/chuyển động máy]
  📷 Shot 2 | [Xs→Ys] | [GÓC MÁY KHÁC Shot 1] (nếu cần)
     → Bối cảnh: ...
     → Hành động: ...
  📷 Shot 3–5 | ... (nếu cần, tiếp tục tương tự, mỗi shot 1 góc máy riêng)
${noDialogue
  ? '🔇 LỜI THOẠI: — Không có thoại — (tuyệt đối không viết lời thoại trong cảnh này)'
  : `🎤 LỜI THOẠI: [Nhân vật/VO]: "[CHỈ viết bằng ${langLabel} — KHÔNG dịch]" — hoặc: "— Im lặng —"
  ⛔ SAU LỜI THOẠI TUYỆT ĐỐI KHÔNG được viết thêm: bản dịch, phiên âm, chú thích, nội dung trong ngoặc đơn (...) hay bất kỳ ngôn ngữ nào khác.`}
🎵 SFX/BGM: [nhạc nền, hiệu ứng]`;

  const generateContent = async () => {
    if (!apiKeys?.length) { setError('Chưa có API Key. Vui lòng nhập API Key Gemini ở thanh trên.'); return; }
    if (!params.topic.trim()) { setError(mode === 'script' ? 'Vui lòng nhập chủ đề video.' : 'Vui lòng nhập ý tưởng gốc.'); return; }
    setIsGenerating(true); setError(null); setScript(''); setGenProgress('');
    try {
      const totalSec = params.totalDuration * 60;
      const numScenes = Math.max(1, Math.round(totalSec / params.sceneDuration));
      const charBlock = buildCharacterBlock();
      const noDialogue = scriptLang === 'no-dialogue';
      const langLabel = { 'vi-VN': 'Tiếng Việt', 'en-US': 'English', 'ja-JP': '日本語', 'zh-CN': 'Tiếng Trung', 'ko-KR': '한국어', 'fr-FR': 'Français', 'es-ES': 'Español', 'de-DE': 'Deutsch', 'th-TH': 'ภาษาไทย' }[scriptLang] || (noDialogue ? 'Không có thoại' : 'Tiếng Việt');
      const dialogueRule = noDialogue
        ? '⚠️ NGHIÊM CẤM LỜI THOẠI: Tuyệt đối KHÔNG viết bất kỳ lời thoại, lời thuyết minh (VO), hay giọng nói nào trong toàn bộ kịch bản. Mọi cảnh đều im lặng hoàn toàn.'
        : `Lời thoại viết THUẦN ${langLabel} — TUYỆT ĐỐI KHÔNG kèm bản dịch, phiên âm, hay chú thích ngôn ngữ khác dù là trong ngoặc đơn (...). Sau mỗi câu thoại chỉ được có dấu câu, KHÔNG có nội dung nào khác.`;

      if (mode === 'script') {
        const baseInfo = `CHỦ ĐỀ: "${params.topic}"
NỀN TẢNG: ${params.platform} | ${noDialogue ? 'CHẾ ĐỘ: KHÔNG CÓ THOẠI' : `NGÔN NGỮ THOẠI: ${langLabel}`} | PHONG CÁCH: ${scriptStyle}
MỖI CẢNH: ${params.sceneDuration}s | TỔNG: ${numScenes} cảnh | ĐỐI TƯỢNG: ${params.audience}
MỤC TIÊU: ${params.goal} | GIỌNG ĐIỆU: ${params.tone}${charBlock ? '\n' + charBlock : ''}`;

        const numChunks = Math.ceil(numScenes / SCENE_CHUNK);
        let fullScript = '';
        let projectBible = '';

        for (let ci = 0; ci < numChunks; ci++) {
          const fromScene = ci * SCENE_CHUNK + 1;
          const toScene = Math.min((ci + 1) * SCENE_CHUNK, numScenes);
          const isFirst = ci === 0;
          const isLast = toScene === numScenes;
          const progressLabel = numChunks > 1
            ? `Đang tạo cảnh ${fromScene}–${toScene} / ${numScenes}...`
            : `Đang tạo ${numScenes} cảnh...`;
          setGenProgress(progressLabel);

          let prompt;
          if (isFirst) {
            prompt = `Bạn là nhà biên kịch và đạo diễn điện ảnh chuyên nghiệp.
${baseInfo}
---
## PHẦN 1: PROJECT BIBLE

**LOGLINE:** [2–3 câu: cốt truyện + cao trào + thông điệp]
**BỐI CẢNH:** [Quốc gia/thời đại, địa điểm, thời gian, thời tiết, tone màu]
**CHARACTER BIBLE** ⚠️ (tham chiếu AI tạo ảnh — bất biến):
${charBlock
  ? 'Hoàn thiện thêm chi tiết còn thiếu, giữ nguyên thông tin gốc:'
  : 'Tạo nhân vật phù hợp chủ đề (chính trước, phụ sau, tối đa 5 phụ):'}
[NHÂN VẬT CHÍNH] Tên | Giới tính | Tuổi | Quốc tịch/Sắc tộc
→ Ngoại hình: Khuôn mặt, Mắt, Tóc, Da, Vóc dáng
→ Trang phục & Phụ kiện/Vũ khí: [màu sắc, chất liệu cụ thể]
→ Tính cách & Biểu cảm đặc trưng:
[NHÂN VẬT PHỤ N] ...tương tự...
**VẬT THỂ/ĐẠO CỤ CHÍNH:** [Mô tả hình dáng, màu sắc, chất liệu]

---
## PHẦN 2: KỊCH BẢN PHÂN CẢNH — CẢNH ${fromScene} ĐẾN CẢNH ${toScene}${numChunks > 1 ? ` (PHẦN 1/${numChunks}, tổng ${numScenes} cảnh)` : ` — ĐỦ ${numScenes} CẢNH`}

QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: ${dialogueRule}
QUY TẮC: Mỗi cảnh ${params.sceneDuration}s. Cảnh n bắt đầu tại (n−1)×${params.sceneDuration}s. Số shot linh hoạt 1–5 theo nội dung (xem QUY TẮC SHOT ở trên). Mỗi shot góc máy KHÁC nhau. KHÔNG dùng bảng.
${isFirst ? 'Cảnh 1 = hook mạnh.' : ''}${isLast ? ` Cảnh ${numScenes} = Call To Action rõ ràng.` : ''}

${SCENE_FORMAT(langLabel, noDialogue)}

BẮT ĐẦU NGAY từ [CẢNH ${fromScene}:] — viết đủ ${toScene - fromScene + 1} cảnh liên tiếp không bỏ sót.`;
          } else {
            prompt = `Bạn là nhà biên kịch đang tiếp tục viết kịch bản.

THÔNG TIN DỰ ÁN:
${baseInfo}

PROJECT BIBLE ĐÃ XÁC LẬP (GIỮ NGUYÊN NHÂN VẬT & BỐI CẢNH):
${projectBible}

---
NHIỆM VỤ: Tiếp tục viết CẢNH ${fromScene} ĐẾN CẢNH ${toScene} (phần ${ci + 1}/${numChunks}, tổng ${numScenes} cảnh).
Cảnh ${fromScene} bắt đầu tại ${(fromScene - 1) * params.sceneDuration}s.${isLast ? ` Cảnh ${numScenes} = Call To Action rõ ràng.` : ''}

QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: ${dialogueRule}
QUY TẮC: Mỗi cảnh ${params.sceneDuration}s. Số shot linh hoạt 1–5 theo nội dung (xem QUY TẮC SHOT ở trên). Mỗi shot góc máy KHÁC nhau. KHÔNG dùng bảng. KHÔNG lặp lại Project Bible.

${SCENE_FORMAT(langLabel, noDialogue)}

BẮT ĐẦU NGAY từ [CẢNH ${fromScene}:] — viết đủ ${toScene - fromScene + 1} cảnh liên tiếp không bỏ sót.`;
          }

          const chunk = await geminiChatRotating(apiKeys, prompt, 32768, onKeySwitch);
          if (!chunk) throw new Error(`Không nhận được phản hồi cho cảnh ${fromScene}–${toScene}.`);

          if (isFirst) {
            // Extract Project Bible (everything before first [CẢNH 1:] marker)
            const sceneMarker = chunk.search(/\[CẢNH\s+1\s*:/);
            projectBible = sceneMarker > 0 ? chunk.substring(0, sceneMarker).trim() : chunk.substring(0, Math.min(chunk.length, 2000));
            fullScript = chunk;
          } else {
            fullScript += '\n\n' + chunk;
          }

          // Update UI progressively so user sees results as they come
          setScript(fullScript + (isLast ? '' : `\n\n---\n⏳ *Đang tạo tiếp cảnh ${toScene + 1}–${Math.min(toScene + SCENE_CHUNK, numScenes)}/${numScenes}...*`));
        }

        setScript(fullScript);
        setGenProgress('');
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

      } else {
        // Brainstorm mode
        setGenProgress('Đang tạo concept...');
        const prompt = `Đóng vai Giám đốc Sáng tạo nội dung YouTube/TikTok. Ý tưởng gốc: "${params.topic}". Nền tảng: ${params.platform}. Đối tượng: ${params.audience}.
Đề xuất ${params.conceptCount} Concept kịch bản hoàn toàn khác biệt, mỗi Concept theo cấu trúc:
Concept [N]: [Tiêu đề giật tít]
- Logline: 2 câu cốt truyện + diễn biến bất ngờ.
- Góc nhìn: Điểm khác biệt "ăn tiền" so với video cùng chủ đề.
- Vibe & Bối cảnh: Cảm giác thị giác.
- Nhân vật & Đạo cụ: Gợi ý ngoại hình + 1 vật thể tĩnh biểu tượng.
Không dùng bảng biểu.`;
        const text = await geminiChatRotating(apiKeys, prompt, 8192, onKeySwitch);
        if (text) {
          setScript(text);
          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } else throw new Error('Không nhận được phản hồi từ AI.');
        setGenProgress('');
      }
    } catch (err) {
      setGenProgress('');
      setError(err.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally { setIsGenerating(false); }
  };

  const generateQuickHooks = async () => {
    if (!apiKeys?.length) { setError('Chưa có API Key. Vui lòng nhập API Key Gemini ở thanh trên.'); return; }
    if (!params.topic.trim()) { setError('Vui lòng nhập chủ đề video.'); return; }
    setIsGeneratingHooks(true); setError(null);
    try {
      const prompt = `Gợi ý 5 phương án Hook (3-5 giây đầu) cực kỳ mạnh mẽ cho video về chủ đề: "${params.topic}". Nền tảng: ${params.platform}. Mục tiêu: ${params.goal}. Giọng điệu: ${params.tone}. Tập trung vào yếu tố văn hóa và sắc tộc đặc trưng.`;
      const hookText = await geminiChatRotating(apiKeys, prompt, 2048, onKeySwitch);
      if (hookText) {
        setScript(prev => `### ⚡ Gợi ý Hook nhanh (Advanced):\n\n${hookText}\n\n---\n\n${prev}`);
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch { setError('Không thể tạo Hook nhanh.'); }
    finally { setIsGeneratingHooks(false); }
  };

  const translateContent = async (lang) => {
    if (!script) return;
    setIsTranslating(true); setTargetLang(lang);
    try {
      const prompt = `Hãy dịch kịch bản/nội dung sau đây sang ${lang}. Giữ nguyên định dạng Markdown, các ký hiệu emoji và cấu trúc phân cảnh. Nội dung cần dịch:\n\n${script}`;
      const translated = await geminiChatRotating(apiKeys, prompt, 8192, onKeySwitch);
      if (translated) setScript(translated);
    } catch { setError('Không thể dịch nội dung.'); }
    finally { setIsTranslating(false); }
  };

  const downloadTxt = () => {
    if (!script) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([script], { type: 'text/plain' }));
    a.download = `kich-ban-${params.topic.slice(0, 20)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const copyToClipboard = () => { navigator.clipboard.writeText(script); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const resetForm = () => {
    setParams({ topic: '', platform: 'TikTok dọc', sceneDuration: 8, totalDuration: 3, goal: GOALS[1], tone: TONES[0], audience: AUDIENCES[0], conceptCount: 5 });
    setScriptLang('vi-VN'); setScriptStyle('Mặc định');
    setMainChar(emptyChar()); setSecChars([]);
    setScript(''); setError(null);
  };

  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="w-[380px] shrink-0 border-r border-slate-800 flex flex-col bg-[#0b1120]">
        {/* Scrollable form area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-4 border-b border-slate-800">
            <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
              <button onClick={() => setMode('script')}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all', mode === 'script' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400 hover:text-white')}>
                <PenTool size={12}/> Biên kịch chi tiết
              </button>
              <button onClick={() => setMode('brainstorm')}
                className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all', mode === 'brainstorm' ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-400 hover:text-white')}>
                <Lightbulb size={12}/> Phóng tác ý tưởng
              </button>
            </div>
          </div>
          <div className="p-4 border-b border-slate-800">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
              {mode === 'script' ? 'Chủ đề & Bối cảnh' : 'Ý tưởng gốc cốt lõi'}
            </label>
            <textarea
              placeholder={mode === 'script' ? 'VD: Trận Trường Bản của Triệu Tử Long...' : 'VD: Làm video về một người đàn ông đơn độc cắm trại trong cơn mưa lớn...'}
              className="w-full min-h-[100px] bg-[#0a1020] border border-slate-700 rounded-xl px-3 py-2.5 text-[12px] text-slate-200 focus:outline-none focus:border-orange-500/60 resize-none leading-relaxed"
              value={params.topic} onChange={e => setParams({ ...params, topic: e.target.value })} />
          </div>
          <div className="p-4 border-b border-slate-800">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-1.5"><Layout size={10}/> Nền tảng</label>
            <select className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-2 text-[12px] text-slate-200 focus:outline-none focus:border-orange-500/60"
              value={params.platform} onChange={e => setParams({ ...params, platform: e.target.value })}>
              <option>TikTok dọc</option><option>YouTube ngang</option><option value="Shorts">YouTube Shorts</option><option>Facebook Reels</option>
            </select>
          </div>
          <div className="p-4 border-b border-slate-800 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-1.5"><Globe size={10}/> Ngôn ngữ thoại</label>
              <div className="relative">
                <select value={scriptLang} onChange={e => setScriptLang(e.target.value)}
                  className="w-full appearance-none bg-[#0a1020] border border-slate-700 rounded-lg pl-2.5 pr-7 py-2 text-[11px] font-bold text-slate-200 focus:outline-none focus:border-orange-500/60">
                  <option value="no-dialogue">🔇 Không có thoại</option>
                  <option value="vi-VN">Tiếng Việt</option>
                  <option value="en-US">English</option>
                  <option value="ja-JP">日本語</option>
                  <option value="zh-CN">Tiếng Trung</option>
                  <option value="ko-KR">한국어</option>
                  <option value="fr-FR">Français</option>
                  <option value="es-ES">Español</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="th-TH">ภาษาไทย</option>
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-1.5"><Film size={10}/> Phong cách</label>
              <div className="relative">
                <select value={scriptStyle} onChange={e => setScriptStyle(e.target.value)}
                  className="w-full appearance-none bg-[#0a1020] border border-slate-700 rounded-lg pl-2.5 pr-7 py-2 text-[11px] font-bold text-slate-200 focus:outline-none focus:border-orange-500/60">
                  {VISUAL_STYLES.filter(s => s.id !== 'Custom').map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
              </div>
            </div>
          </div>
          {mode === 'script' && (
            <div className="p-4 border-b border-slate-800 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Clock size={10}/> Thời lượng 1 cảnh (giây)</label>
                <div className="flex gap-2">
                  {[4, 6, 8, 10].map(s => (
                    <button key={s} type="button" onClick={() => setParams({ ...params, sceneDuration: s })}
                      className={cn('flex-1 py-2 rounded-lg text-xs font-bold border transition-all', params.sceneDuration === s ? 'bg-orange-500 border-orange-500 text-white' : 'bg-[#0a1020] border-slate-700 text-slate-400 hover:border-orange-500/40')}>
                      {s}s
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Clock size={10}/> Tổng thời lượng video</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={60} step={0.5}
                    value={params.totalDuration}
                    onChange={e => setParams({ ...params, totalDuration: parseFloat(e.target.value) || 1 })}
                    className="flex-1 bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-200 focus:outline-none focus:border-orange-500/60" />
                  <span className="text-xs text-slate-400 shrink-0">phút</span>
                  <span className="text-[10px] text-orange-400 font-bold shrink-0">
                    = {Math.max(1, Math.round(params.totalDuration * 60 / params.sceneDuration))} cảnh
                  </span>
                </div>
              </div>
            </div>
          )}
          {mode === 'brainstorm' && (
            <div className="p-4 border-b border-slate-800">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-1.5"><Lightbulb size={10}/> Số Concept</label>
              <select className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-2 text-[12px] text-slate-200 focus:outline-none focus:border-orange-500/60"
                value={params.conceptCount} onChange={e => setParams({ ...params, conceptCount: parseInt(e.target.value) })}>
                <option value={5}>5 Concept</option><option value={10}>10 Concept</option>
              </select>
            </div>
          )}
          <div className="p-4 border-b border-slate-800">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Users size={10}/> Đối tượng người xem</label>
            <div className="grid grid-cols-2 gap-1.5">
              {AUDIENCES.map(a => (
                <button key={a} onClick={() => setParams({ ...params, audience: a })}
                  className={cn('px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all text-left', params.audience === a ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#0a1020] border-slate-700 text-slate-400 hover:border-blue-500/40')}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          {mode === 'script' && (<>
            <div className="p-4 border-b border-slate-800">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Target size={10}/> Mục tiêu video</label>
              <div className="grid grid-cols-2 gap-1.5">
                {GOALS.map(g => (
                  <button key={g} onClick={() => setParams({ ...params, goal: g })}
                    className={cn('px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all text-left', params.goal === g ? 'bg-orange-500 border-orange-500 text-white' : 'bg-[#0a1020] border-slate-700 text-slate-400 hover:border-orange-500/40')}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 border-b border-slate-800">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 mb-2"><Music2 size={10}/> Giọng điệu & Mood</label>
              <div className="grid grid-cols-2 gap-1.5">
                {TONES.map(t => (
                  <button key={t} onClick={() => setParams({ ...params, tone: t })}
                    className={cn('px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all text-left', params.tone === t ? 'bg-slate-100 border-slate-200 text-slate-900' : 'bg-[#0a1020] border-slate-700 text-slate-400 hover:border-slate-500')}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* ── CHARACTER PROFILES ── */}
            <div className="border-b border-slate-800">
              <button type="button" onClick={() => setShowChars(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Users size={11} className="text-purple-400"/>
                  Hồ sơ nhân vật
                  {(mainChar.name || mainChar.appearance) && (
                    <span className="ml-1 px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[9px]">
                      {1 + secChars.filter(c => c.name || c.appearance).length} NV
                    </span>
                  )}
                </span>
                <ChevronRight size={12} className={cn('text-slate-500 transition-transform', showChars && 'rotate-90')} />
              </button>

              {showChars && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Main character */}
                  <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400"/>
                      <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Nhân vật chính</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="Tên nhân vật" value={mainChar.name}
                        onChange={e => setMainChar(p => ({ ...p, name: e.target.value }))}
                        className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60 col-span-2" />
                      <select value={mainChar.gender} onChange={e => setMainChar(p => ({ ...p, gender: e.target.value }))}
                        className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60">
                        <option>Nam</option><option>Nữ</option><option>Khác</option>
                      </select>
                      <input placeholder="Tuổi (VD: 28)" value={mainChar.age}
                        onChange={e => setMainChar(p => ({ ...p, age: e.target.value }))}
                        className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60" />
                    </div>
                    <input placeholder="Sắc tộc / Quốc tịch (VD: Người Việt, Da trắng Mỹ...)" value={mainChar.ethnicity}
                      onChange={e => setMainChar(p => ({ ...p, ethnicity: e.target.value }))}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60" />
                    <textarea placeholder="Ngoại hình chi tiết: khuôn mặt, kiểu tóc, màu tóc, màu mắt, vóc dáng, đặc điểm nhận dạng..."
                      value={mainChar.appearance} onChange={e => setMainChar(p => ({ ...p, appearance: e.target.value }))}
                      rows={3}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60 resize-none leading-relaxed" />
                    <textarea placeholder="Trang phục & phụ kiện (mô tả cụ thể màu sắc, chất liệu, vũ khí nếu có...)"
                      value={mainChar.clothing} onChange={e => setMainChar(p => ({ ...p, clothing: e.target.value }))}
                      rows={2}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60 resize-none leading-relaxed" />
                    <input placeholder="Vai trò trong kịch bản (tuỳ chọn, VD: anh hùng, phản diện...)" value={mainChar.role}
                      onChange={e => setMainChar(p => ({ ...p, role: e.target.value }))}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60" />
                  </div>

                  {/* Secondary characters */}
                  {secChars.map((c, i) => (
                    <div key={c.id} className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"/>
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Nhân vật phụ {i + 1}</span>
                        </div>
                        <button type="button" onClick={() => removeSecChar(c.id)}
                          className="p-1 text-slate-600 hover:text-red-400 transition-colors rounded">
                          <X size={12}/>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input placeholder="Tên nhân vật" value={c.name}
                          onChange={e => updateSecChar(c.id, 'name', e.target.value)}
                          className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60 col-span-2" />
                        <select value={c.gender} onChange={e => updateSecChar(c.id, 'gender', e.target.value)}
                          className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60">
                          <option>Nam</option><option>Nữ</option><option>Khác</option>
                        </select>
                        <input placeholder="Tuổi" value={c.age}
                          onChange={e => updateSecChar(c.id, 'age', e.target.value)}
                          className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60" />
                      </div>
                      <input placeholder="Sắc tộc / Quốc tịch" value={c.ethnicity}
                        onChange={e => updateSecChar(c.id, 'ethnicity', e.target.value)}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60" />
                      <textarea placeholder="Ngoại hình chi tiết: khuôn mặt, tóc, mắt, vóc dáng..."
                        value={c.appearance} onChange={e => updateSecChar(c.id, 'appearance', e.target.value)}
                        rows={2}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60 resize-none leading-relaxed" />
                      <textarea placeholder="Trang phục & phụ kiện"
                        value={c.clothing} onChange={e => updateSecChar(c.id, 'clothing', e.target.value)}
                        rows={2}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60 resize-none leading-relaxed" />
                      <input placeholder="Vai trò trong kịch bản" value={c.role}
                        onChange={e => updateSecChar(c.id, 'role', e.target.value)}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60" />
                    </div>
                  ))}

                  {secChars.length < 5 && (
                    <button type="button" onClick={addSecChar}
                      className="w-full py-2 border border-dashed border-indigo-500/30 text-indigo-400 hover:border-indigo-500/60 hover:bg-indigo-500/5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all">
                      <Plus size={12}/> Thêm nhân vật phụ ({secChars.length}/5)
                    </button>
                  )}
                </div>
              )}
            </div>
          </>)}
        </div>

        {/* Fixed action buttons at bottom — always visible, never inside scroll */}
        <div className="shrink-0 p-4 border-t border-slate-800 bg-[#0b1120] space-y-3">
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[11px] text-red-300">{error}</p>
            </div>
          )}
          {isGenerating && genProgress && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
              <Loader2 size={12} className="animate-spin text-orange-400 shrink-0"/>
              <span className="text-[11px] text-orange-300 font-medium">{genProgress}</span>
            </div>
          )}
          <div className={cn('grid gap-2', mode === 'script' ? 'grid-cols-2' : 'grid-cols-1')}>
            {mode === 'script' && (
              <button onClick={generateQuickHooks} disabled={isGenerating || isGeneratingHooks}
                className="py-3 rounded-xl font-bold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 flex items-center justify-center gap-2 transition-all disabled:opacity-40 text-xs">
                {isGeneratingHooks ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14}/>} Hook nhanh
              </button>
            )}
            <button onClick={generateContent} disabled={isGenerating || isGeneratingHooks}
              className="py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-xs bg-gradient-to-r from-orange-500 to-red-600 text-white hover:shadow-lg hover:shadow-orange-500/20 disabled:opacity-40">
              {isGenerating ? <Loader2 size={14} className="animate-spin"/> : (mode === 'script' ? <Send size={14}/> : <Lightbulb size={14}/>)}
              {isGenerating ? (genProgress || 'Đang tạo...') : (mode === 'script' ? 'Tạo kịch bản' : 'Phóng tác Concept')}
            </button>
          </div>
          <button onClick={resetForm} className="w-full py-2 rounded-xl text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-all flex items-center justify-center gap-1.5">
            <RotateCcw size={12}/> Làm mới
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f1524]">
        <div className="h-12 border-b border-slate-800 flex items-center px-5 shrink-0 bg-[#141c2f]">
          <h2 className="text-sm font-bold text-white">Viết Kịch Bản</h2>
          <ChevronRight size={13} className="text-slate-600 mx-1.5"/>
          <span className="text-xs text-slate-500">{mode === 'script' ? 'Biên kịch chi tiết' : 'Phóng tác ý tưởng'} — Gemini 2.5 Flash</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            {script ? (
              <motion.div key="result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                ref={resultRef} className="m-5 bg-[#1a2235] border border-slate-700/60 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 bg-[#141c2f]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center">
                      {mode === 'script' ? <Clapperboard size={14} className="text-orange-400"/> : <Lightbulb size={14} className="text-orange-400"/>}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">{mode === 'script' ? 'Kịch bản hoàn thiện' : 'Danh sách Concept'}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{mode === 'script' ? 'Ready for production' : 'Creative Strategy'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => {
                      const tSec = params.totalDuration * 60;
                      const nScenes = Math.max(1, Math.round(tSec / params.sceneDuration));
                      onSendToPrompt(script, { sceneDuration: params.sceneDuration, quantity: nScenes, language: scriptLang, style: scriptStyle });
                    }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 rounded-lg text-[11px] font-bold transition-colors">
                      <ArrowRight size={12}/> Gửi sang Tạo Prompt
                    </button>
                    <div className="relative group">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 transition-colors">
                        <Languages size={12}/>
                        {isTranslating ? <Loader2 size={11} className="animate-spin"/> : targetLang}
                        <ChevronDown size={11}/>
                      </button>
                      <div className="absolute right-0 top-full mt-1 w-36 bg-[#1a2235] border border-slate-700 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
                        {LANGUAGES.map(lang => (
                          <button key={lang.code} onClick={() => translateContent(lang.label)}
                            className="w-full text-left px-4 py-2 text-xs font-medium text-slate-300 hover:bg-orange-500/20 hover:text-orange-400 transition-colors">
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={downloadTxt} title="Tải về .txt"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                      <Download size={14}/>
                    </button>
                    <button onClick={copyToClipboard}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-[11px] font-bold transition-colors">
                      {copied ? <Check size={12} className="text-emerald-400"/> : <Copy size={12}/>}
                      {copied ? 'Đã sao chép' : 'Sao chép'}
                    </button>
                  </div>
                </div>
                <div className="p-6 prose prose-sm prose-invert max-w-none leading-relaxed">
                  <ReactMarkdown>{script}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <motion.div key="placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center min-h-full py-20 px-12 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-orange-400/10 blur-3xl rounded-full"/>
                  <div className="relative bg-[#1a2235] border border-slate-700/60 p-5 rounded-2xl">
                    {mode === 'script' ? <Sparkles size={36} className="text-orange-400"/> : <Lightbulb size={36} className="text-orange-400"/>}
                  </div>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {mode === 'script' ? 'Khởi tạo kịch bản chuyên sâu' : 'Phóng tác ý tưởng sáng tạo'}
                </h3>
                <p className="text-xs text-slate-500 max-w-sm leading-relaxed mb-8">
                  {mode === 'script'
                    ? 'Hệ thống AI sẽ phân tích bối cảnh lịch sử, sắc tộc và văn hóa để tạo ra hồ sơ nhân vật và kịch bản phân cảnh chi tiết nhất.'
                    : 'Đề xuất các Concept kịch bản hoàn toàn khác biệt dựa trên ý tưởng gốc của bạn dưới lăng kính kể chuyện mới lạ.'}
                </p>
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={28} className="animate-spin text-orange-400"/>
                    <p className="text-sm text-orange-300 font-medium">{genProgress || 'Đang khởi tạo...'}</p>
                    <p className="text-[11px] text-slate-500">Với kịch bản nhiều cảnh, AI sẽ tạo từng phần và ghép lại tự động</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                    {[['Văn hóa', Globe, 'text-blue-400'], ['Nhân vật', User, 'text-purple-400'], ['Vũ khí', Sword, 'text-red-400']].map(([label, Icon, color]) => (
                      <div key={label} className="p-3 rounded-xl bg-[#1a2235] border border-slate-700/60 flex flex-col items-center gap-1.5">
                        <Icon size={18} className={color}/><span className="text-[10px] font-bold text-slate-500 uppercase">{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── PROMPT GENERATOR ────────────────────────────────────────────────────────

const VISUAL_STYLES = [
  { id: 'Mặc định', label: 'Mặc định', desc: 'Phong cách tiêu chuẩn Veo 3' },
  { id: 'Pixar', label: 'Pixar', desc: 'Hoạt hình Pixar, dựng hình 3D' },
  { id: 'Disney', label: 'Disney', desc: 'Hoạt hình Disney, kỳ diệu' },
  { id: 'Anime', label: 'Anime', desc: 'Anime, Studio Ghibli' },
  { id: 'Stick Figure', label: 'Stick Figure', desc: 'Hoạt hình người que' },
  { id: '2D Cartoon', label: '2D Cartoon', desc: 'Hoạt hình 2D đầy màu sắc' },
  { id: '3D Animation', label: '3D Animation', desc: 'Hoạt hình 3D bán thực tế' },
  { id: 'Claymation', label: 'Claymation', desc: 'Đất sét nặn, stop-motion' },
  { id: 'Whiteboard', label: 'Whiteboard', desc: 'Hoạt hình bảng trắng' },
  { id: 'Cinematic', label: 'Cinematic', desc: 'Điện ảnh chuyên nghiệp' },
  { id: 'Cyberpunk', label: 'Cyberpunk', desc: 'Tương lai, ánh neon' },
  { id: 'Studio Ghibli', label: 'Studio Ghibli', desc: 'Vẽ tay cổ điển, mơ mộng' },
  { id: 'Photorealistic', label: 'Photorealistic', desc: 'Ảnh thực tế siêu chi tiết' },
  { id: 'Steampunk', label: 'Steampunk', desc: 'Victoria, máy móc hơi nước' },
  { id: 'Sketch', label: 'Sketch', desc: 'Phác thảo bút chì' },
  { id: 'Manga', label: 'Manga', desc: 'Truyện tranh Nhật Bản' },
  { id: 'Watercolor', label: 'Watercolor', desc: 'Tranh màu nước' },
  { id: 'Pixel Art', label: 'Pixel Art', desc: 'Phong cách 8-bit' },
  { id: 'Custom', label: '✏️ Tùy chỉnh', desc: 'Nhập phong cách riêng' },
];

function AssetInput({ asset, type, onUpdate, onRemove, onImageUpload }) {
  const accentColor = type === 'character' ? 'purple' : 'emerald';
  return (
    <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex gap-3 items-start">
      <div className={`relative w-12 h-12 bg-[#0a1020] rounded-lg border border-slate-700 flex-shrink-0 overflow-hidden cursor-pointer hover:border-${accentColor}-500 transition-colors`}
        onClick={() => document.getElementById(`file-asset-${asset.id}`)?.click()}>
        {asset.image ? (
          <img src={`data:${asset.mimeType};base64,${asset.image}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <ImageIcon size={16} />
          </div>
        )}
        <input id={`file-asset-${asset.id}`} type="file" className="hidden"
          onChange={e => onImageUpload(asset.id, e, type)} accept="image/*" />
      </div>
      <div className="flex-grow space-y-1">
        <input placeholder={type === 'character' ? 'Tên nhân vật' : 'Tên bối cảnh'}
          value={asset.name}
          onChange={e => onUpdate(asset.id, 'name', e.target.value, type)}
          className="w-full bg-transparent border-b border-white/10 focus:border-emerald-500 outline-none text-xs font-bold py-0.5 text-slate-200" />
        <input placeholder="Mô tả..."
          value={asset.description}
          onChange={e => onUpdate(asset.id, 'description', e.target.value, type)}
          className="w-full bg-transparent border-b border-white/10 outline-none text-[10px] text-slate-400 py-0.5" />
      </div>
      <button onClick={() => onRemove(asset.id, type)} className="text-slate-600 hover:text-red-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

function PromptGeneratorPanel({ apiKeys, onKeySwitch, externalSubject, externalPromptParams, onExternalSubjectConsumed }) {

  // ── Form state ──
  const [subject, setSubject] = useState('');
  const [quantity, setQuantity] = useState(5);
  const [sceneDuration, setSceneDuration] = useState(8);

  // Receive text + optional params sent from Clone Video or Script Writer
  useEffect(() => {
    if (externalSubject) {
      setSubject(externalSubject);
      if (externalPromptParams?.sceneDuration) setSceneDuration(externalPromptParams.sceneDuration);
      if (externalPromptParams?.quantity) setQuantity(externalPromptParams.quantity);
      if (externalPromptParams?.language) setLanguage(externalPromptParams.language);
      if (externalPromptParams?.style) setSelectedStyle(externalPromptParams.style);
      setStep('config');
      onExternalSubjectConsumed?.();
    }
  }, [externalSubject]);
  const [language, setLanguage] = useState('vi-VN');
  const [selectedStyle, setSelectedStyle] = useState('Mặc định');
  const [customStyle, setCustomStyle] = useState('');
  const [characters, setCharacters] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [showAssets, setShowAssets] = useState(false);

  // Result state
  const [step, setStep] = useState('config'); // config | analysis | studio
  const [prompts, setPrompts] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [fullJson, setFullJson] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [genPhase, setGenPhase] = useState(''); // 'dna' | 'scenes'
  const [genFraction, setGenFraction] = useState(0); // 0-1 for progress bar
  const [error, setError] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState({});

  const batches = useMemo(() => {
    const b = [];
    for (let i = 0; i < prompts.length; i += BATCH_SIZE) b.push(prompts.slice(i, i + BATCH_SIZE));
    return b;
  }, [prompts]);

  const triggerFeedback = (key) => {
    setCopyFeedback(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopyFeedback(prev => ({ ...prev, [key]: false })), 2000);
  };

  const handleAddAsset = (type) => {
    const newAsset = { id: `${type === 'character' ? 'CHAR' : 'ENV'}_${Date.now()}`, name: '', description: '', type };
    if (type === 'character') { if (characters.length < 5) setCharacters([...characters, newAsset]); }
    else { if (environments.length < 5) setEnvironments([...environments, newAsset]); }
  };

  const updateAsset = (id, field, value, type) => {
    const setter = type === 'character' ? setCharacters : setEnvironments;
    setter(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };

  const handleImageUpload = (id, e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      const setter = type === 'character' ? setCharacters : setEnvironments;
      setter(prev => prev.map(a => a.id === id ? { ...a, image: base64, mimeType: file.type } : a));
    };
    reader.readAsDataURL(file);
  };

  const removeAsset = (id, type) => {
    const setter = type === 'character' ? setCharacters : setEnvironments;
    setter(prev => prev.filter(a => a.id !== id));
  };

  const handleGenerate = async () => {
    if (!apiKeys?.length) { setError('Chưa có API Key. Vui lòng nhập API Key Gemini ở thanh trên.'); return; }
    if (!subject.trim()) { setError('Vui lòng nhập kịch bản hoặc ý tưởng.'); return; }
    const styleObj = VISUAL_STYLES.find(s => s.id === selectedStyle);
    // Pass clean id so expandStyle() in geminiPrompt can look it up precisely
    const styleForGen = selectedStyle === 'Custom' ? customStyle : (styleObj?.id || selectedStyle);

    const config = {
      subject,
      quantity: Math.max(1, Math.min(200, quantity)),
      sceneDuration,
      style: styleForGen,
      language,
      characters,
      environments,
    };

    setIsLoading(true); setError(null); setPrompts([]); setAnalysis(null); setFullJson(null);
    setGenProgress('Đang khởi tạo...'); setGenPhase('dna'); setGenFraction(0);

    const onProgress = ({ phase, message, dna, scenes, from, to, total, chunkIndex, numChunks, fromIdx, toIdx }) => {
      if (message) setGenProgress(message);
      if (phase === 'dna') { setGenPhase('dna'); setGenFraction(0.05); }
      if (phase === 'dna_done') { setGenPhase('scenes'); setGenFraction(0.15); }
      if (phase === 'key_switch') { onKeySwitch?.({ fromIdx, toIdx, total }); }
      if (phase === 'scenes') {
        setGenPhase('scenes');
        setGenFraction(0.15 + 0.85 * ((chunkIndex || 0) / (numChunks || 1)));
      }
      // auto_split: token overflow detected, re-splitting — keep fraction steady, just update text
      if (phase === 'auto_split') { setGenPhase('scenes'); }
      // skip_scene: rare single-scene overflow
      if (phase === 'skip_scene') { setGenPhase('scenes'); }
      if (phase === 'batch_done' && scenes) {
        setPrompts(scenes.map((scene, idx) => ({
          id: `scene-${scene.scene_number || idx + 1}`,
          scene_id: `scene-${scene.scene_number || idx + 1}`,
          title: `Cảnh ${scene.scene_number || idx + 1}${scene.title ? ': ' + scene.title : ''}`,
          promptText: scene.final_prompt || '',
          description: scene.setting_detail || scene.location || '',
          status: 'idle',
          fullData: scene,
        })));
        setGenFraction(0.15 + 0.85 * (to / total));
        if (scenes.length > 0 && step === 'config') setStep('analysis');
      }
    };

    try {
      const result = await generateCinematicPrompts(apiKeys, config, onProgress);
      setPrompts(result.prompts);
      setAnalysis(result.analysis || null);
      setFullJson(result.fullJson || null);
      setGenFraction(1);
      setStep('analysis');
    } catch (err) {
      let msg = err.message || 'Không thể tạo câu lệnh. Vui lòng thử lại.';
      const msgL = msg.toLowerCase();
      if (msgL.includes('rate limit') || msgL.includes('429') || err?.status === 'RESOURCE_EXHAUSTED')
        msg = '⏳ API vượt hạn mức (429) — Tất cả API key đều bị giới hạn. Vui lòng đợi vài phút rồi thử lại.';
      else if (msgL.includes('503') || err?.status === 'UNAVAILABLE')
        msg = 'Model Gemini đang quá tải (503). Đã tự động thử lại nhưng vẫn lỗi.';
      else if (err.isMaxTokens || msgL.includes('max_tokens'))
        msg = 'Cảnh quá dày đặc, không thể tạo ngay cả với 1 cảnh. Hãy rút gọn kịch bản.';
      setError(msg);
    } finally {
      setIsLoading(false); setGenProgress(''); setGenPhase(''); setGenFraction(0);
    }
  };

  const reset = () => {
    setPrompts([]); setAnalysis(null); setFullJson(null);
    setStep('config'); setError(null); setCopyFeedback({});
    setGenProgress(''); setGenPhase(''); setGenFraction(0);
  };

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const copyAllPrompts = () => {
    const text = prompts.map(p => sanitizeEnglishOnly(p.promptText.replace(/\s+/g, ' ').trim())).join('\n');
    navigator.clipboard.writeText(text).then(() => triggerFeedback('all-prompts'));
  };
  // ── JSONL helpers ──

  // Strip non-English text from a string: remove parentheticals containing non-ASCII,
  // then strip remaining non-ASCII chars. Dialogue is never touched by this function.
  const sanitizeEnglishOnly = (text) => {
    if (!text || typeof text !== 'string') return text;
    // Remove parenthetical expressions that contain non-ASCII (Vietnamese, Japanese, etc.)
    // e.g. "Photorealistic (Ảnh thực tế siêu chi tiết)" → "Photorealistic "
    let s = text.replace(/\([^)]*[^\x00-\x7F][^)]*\)/g, '');
    // Remove any remaining non-ASCII characters (CJK, Vietnamese with diacritics, etc.)
    s = s.replace(/[^\x00-\x7F]+/g, ' ');
    // Collapse multiple spaces
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
  };

  // Apply English-only sanitization to all text fields except dialogue
  const sanitizeSceneForExport = (scene) => {
    const s = { ...scene };
    const STR_FIELDS_EN = [
      'title', 'location', 'setting_detail', 'camera_angle',
      'sfx_bgm', 'style_lock', 'environment_dna', 'voice_lock',
    ];
    STR_FIELDS_EN.forEach(f => {
      if (typeof s[f] === 'string') s[f] = sanitizeEnglishOnly(s[f]);
    });
    // character_dna: object of { id: dna_string }
    if (s.character_dna && typeof s.character_dna === 'object') {
      const cleaned = {};
      Object.entries(s.character_dna).forEach(([k, v]) => {
        cleaned[k] = sanitizeEnglishOnly(v);
      });
      s.character_dna = cleaned;
    }
    // objects_dna
    if (s.objects_dna && typeof s.objects_dna === 'object') {
      const cleaned = {};
      Object.entries(s.objects_dna).forEach(([k, v]) => {
        cleaned[k] = sanitizeEnglishOnly(v);
      });
      s.objects_dna = cleaned;
    }
    // shots[].background, shots[].action, shots[].camera_angle
    if (Array.isArray(s.shots)) {
      s.shots = s.shots.map(shot => ({
        ...shot,
        background: sanitizeEnglishOnly(shot.background),
        action: sanitizeEnglishOnly(shot.action),
        camera_angle: sanitizeEnglishOnly(shot.camera_angle),
      }));
    }
    // dialogue: keep as-is (original language)
    return s;
  };

  // Build one compact JSON line per scene with full inline DNA
  const enrichSceneForJsonl = (scene) => {
    const dna = fullJson?.dna || null;
    const enriched = { ...scene };
    // character_dna: inject from master DNA if AI left it empty
    if (!enriched.character_dna || Object.keys(enriched.character_dna).length === 0) {
      enriched.character_dna = {};
      (scene.characters_in_scene || []).forEach(id => {
        const c = dna?.characters?.find(x => x.id === id);
        if (c) enriched.character_dna[id] = c.dna_prompt;
      });
    }
    // environment_dna
    if (!enriched.environment_dna) {
      const e = dna?.environments?.find(x => x.id === scene.environment_id);
      if (e) enriched.environment_dna = e.dna_prompt;
      else if (dna?.environments?.length === 1) enriched.environment_dna = dna.environments[0].dna_prompt;
    }
    // objects_dna
    if (!enriched.objects_dna || Object.keys(enriched.objects_dna).length === 0) {
      enriched.objects_dna = {};
      (scene.objects_in_scene || []).forEach(id => {
        const o = dna?.key_objects?.find(x => x.id === id);
        if (o) enriched.objects_dna[id] = o.dna_prompt;
      });
    }
    // style_lock / voice_lock
    if (!enriched.style_lock) enriched.style_lock = dna?.master_dna?.style_lock || '';
    if (!enriched.voice_lock) enriched.voice_lock = dna?.master_dna?.voice_lock || '';
    return enriched;
  };
  // Returns JSONL string: one compact JSON object per line per scene
  // Applies English-only sanitization to all non-dialogue fields
  const buildJsonLines = (sceneList) =>
    sceneList.map(p => JSON.stringify(sanitizeSceneForExport(enrichSceneForJsonl(p.fullData || p)))).join('\n');

  const copyAllJson = () => {
    navigator.clipboard.writeText(buildJsonLines(prompts)).then(() => triggerFeedback('all-json'));
  };
  const downloadAllPrompts = () => {
    downloadFile(prompts.map(p => sanitizeEnglishOnly(p.promptText.replace(/\s+/g, ' ').trim())).join('\n'), `prompts_${prompts.length}_scenes.txt`);
  };
  const downloadAllJson = () => {
    downloadFile(buildJsonLines(prompts), `prompts_${prompts.length}_scenes.jsonl`);
  };
  // Build DNA JSONL: 1 JSON compact per line — characters → environments → objects → master
  const buildDnaJsonLines = () => {
    const dna = fullJson?.dna || analysis?.rawDna || {};
    const lines = [];
    (dna.characters || []).forEach(c => {
      lines.push(JSON.stringify({
        type: 'character',
        id: c.id, name: c.name, role: c.role || '',
        gender: c.gender || '', age: c.age || '', nationality: c.nationality || '',
        appearance: sanitizeEnglishOnly(c.appearance || ''),
        outfit: sanitizeEnglishOnly(c.outfit || ''),
        dna_prompt: sanitizeEnglishOnly(c.dna_prompt || ''),
      }));
    });
    (dna.environments || []).forEach(e => {
      lines.push(JSON.stringify({
        type: 'environment',
        id: e.id, name: e.name,
        description: sanitizeEnglishOnly(e.description || ''),
        dna_prompt: sanitizeEnglishOnly(e.dna_prompt || ''),
      }));
    });
    (dna.key_objects || []).forEach(o => {
      lines.push(JSON.stringify({
        type: 'object',
        id: o.id, name: o.name,
        description: sanitizeEnglishOnly(o.description || ''),
        dna_prompt: sanitizeEnglishOnly(o.dna_prompt || ''),
      }));
    });
    if (dna.master_dna) {
      lines.push(JSON.stringify({
        type: 'master',
        style_lock: sanitizeEnglishOnly(dna.master_dna.style_lock || ''),
        voice_lock: dna.master_dna.voice_lock || '',
      }));
    }
    return lines.join('\n');
  };

  const copyDnaJson = () => {
    navigator.clipboard.writeText(buildDnaJsonLines()).then(() => triggerFeedback('dna-json'));
  };
  const downloadDnaJson = () => {
    downloadFile(buildDnaJsonLines(), 'dna_reference.jsonl');
  };
  const copyBatchPrompts = (idx) => {
    const text = batches[idx].map(p => sanitizeEnglishOnly(p.promptText.replace(/\s+/g, ' ').trim())).join('\n');
    navigator.clipboard.writeText(text).then(() => triggerFeedback(`prompt-${idx}`));
  };
  const copyBatchJson = (idx) => {
    navigator.clipboard.writeText(buildJsonLines(batches[idx])).then(() => triggerFeedback(`json-${idx}`));
  };
  const downloadBatchPrompts = (idx) => {
    const batch = batches[idx];
    const start = idx * BATCH_SIZE + 1;
    const end = Math.min((idx + 1) * BATCH_SIZE, prompts.length);
    downloadFile(batch.map(p => sanitizeEnglishOnly(p.promptText.replace(/\s+/g, ' ').trim())).join('\n'), `prompts_${start}_${end}.txt`);
  };
  const downloadBatchJson = (idx) => {
    const start = idx * BATCH_SIZE + 1;
    const end = Math.min((idx + 1) * BATCH_SIZE, prompts.length);
    downloadFile(buildJsonLines(batches[idx]), `scenes_${start}_${end}.jsonl`);
  };

  // ── TWO-COLUMN LAYOUT ──
  return (
    <div className="flex-1 flex overflow-hidden bg-[#0f1524]">

      {/* ── LEFT PANEL: Input Form (always visible, 40% width) ── */}
      <div className="w-[40%] min-w-[320px] flex flex-col border-r border-slate-700/60 bg-[#0d1322]">
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-white">Tạo Prompt Điện Ảnh</h2>
            <p className="text-[10px] text-slate-600 mt-0.5">Veo 3.1 · Cinematic · DNA Lock</p>
          </div>
          {prompts.length > 0 && (
            <button onClick={reset} className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-white transition-colors border border-slate-700 rounded-lg px-2.5 py-1.5">
              <RotateCcw size={10}/> Làm mới
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <AlertCircle size={12} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-red-300 flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-slate-500 hover:text-white"><X size={12}/></button>
            </div>
          )}

          {/* Script textarea */}
          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Kịch bản / Ý tưởng</label>
            <textarea value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full h-32 px-3 py-2.5 bg-[#0a1020] border border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all resize-none text-slate-200 placeholder-slate-600 text-[12px]"
              placeholder="Mô tả câu chuyện hoặc kịch bản..." disabled={isLoading} />
          </div>

          {/* Params grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Số cảnh (≤200)</label>
              <input type="number" min="1" max="200" value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-[#0a1020] border border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all text-white text-base font-bold text-center"
                disabled={isLoading} />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Giây / cảnh</label>
              <select value={sceneDuration} onChange={e => setSceneDuration(Number(e.target.value))} disabled={isLoading}
                className="w-full h-[38px] bg-[#0a1020] border border-slate-700 rounded-xl px-3 text-[12px] font-bold text-white focus:outline-none focus:border-emerald-500/60 transition-all disabled:opacity-50">
                <option value={4}>4 giây</option>
                <option value={6}>6 giây</option>
                <option value={8}>8 giây</option>
                <option value={10}>10 giây</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Ngôn ngữ</label>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                className="w-full px-3 py-2 bg-[#0a1020] border border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all text-white font-bold h-[38px] text-[12px]"
                disabled={isLoading}>
                <option value="no-dialogue">🔇 Không có thoại</option>
                <option value="vi-VN">Tiếng Việt</option>
                <option value="en-US">English</option>
                <option value="ja-JP">日本語</option>
                <option value="zh-CN">Tiếng Trung</option>
                <option value="ko-KR">한국어</option>
                <option value="fr-FR">Français</option>
                <option value="es-ES">Español</option>
                <option value="de-DE">Deutsch</option>
                <option value="th-TH">ภาษาไทย</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Phong cách</label>
              <select value={selectedStyle} onChange={e => setSelectedStyle(e.target.value)}
                className="w-full px-3 py-2 bg-[#0a1020] border border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all text-white font-bold h-[38px] text-[12px]"
                disabled={isLoading}>
                {VISUAL_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {selectedStyle === 'Custom' && (
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Phong cách tùy chỉnh</label>
              <input type="text" value={customStyle} onChange={e => setCustomStyle(e.target.value)}
                placeholder="Ví dụ: Phong cách tranh sơn dầu Van Gogh..."
                className="w-full px-3 py-2 bg-[#0a1020] border border-slate-700 rounded-xl outline-none focus:border-emerald-500 transition-all text-slate-200 text-[12px]"
                disabled={isLoading} />
            </div>
          )}

          {/* Advanced assets toggle */}
          <div className="border-t border-slate-700/40 pt-3">
            <button type="button" onClick={() => setShowAssets(!showAssets)}
              className="flex items-center gap-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest hover:text-white transition-colors w-full">
              <ChevronDown size={11} className={cn('transition-transform shrink-0', showAssets ? 'rotate-180' : '')} />
              <span>{showAssets ? 'Ẩn nhân vật & bối cảnh' : 'Nhân vật & bối cảnh cố định (Nâng cao)'}</span>
            </button>
          </div>

          {showAssets && (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <User size={10} className="text-purple-400"/> Nhân vật
                  </label>
                  <button type="button" onClick={() => handleAddAsset('character')} disabled={characters.length >= 5 || isLoading}
                    className="p-1 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="space-y-2">
                  {characters.map(char => (
                    <AssetInput key={char.id} asset={char} type="character" onUpdate={updateAsset} onRemove={removeAsset} onImageUpload={handleImageUpload} />
                  ))}
                  {characters.length === 0 && (
                    <div className="text-center py-3 border border-dashed border-slate-700 rounded-xl text-slate-600 text-[9px] italic">Chưa có nhân vật nào.</div>
                  )}
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Map size={10} className="text-emerald-400"/> Bối cảnh
                  </label>
                  <button type="button" onClick={() => handleAddAsset('environment')} disabled={environments.length >= 5 || isLoading}
                    className="p-1 bg-emerald-600/20 text-emerald-400 rounded-lg hover:bg-emerald-600/30 transition-colors disabled:opacity-50">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="space-y-2">
                  {environments.map(env => (
                    <AssetInput key={env.id} asset={env} type="environment" onUpdate={updateAsset} onRemove={removeAsset} onImageUpload={handleImageUpload} />
                  ))}
                  {environments.length === 0 && (
                    <div className="text-center py-3 border border-dashed border-slate-700 rounded-xl text-slate-600 text-[9px] italic">Chưa có bối cảnh nào.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generate button + progress (sticky at bottom) */}
        <div className="px-5 py-4 border-t border-slate-700/60 bg-[#0d1322] shrink-0 space-y-3">
          {isLoading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className={cn('font-bold', genPhase === 'dna' ? 'text-purple-400' : 'text-emerald-400')}>
                  {genPhase === 'dna' ? '🧬 Phân tích DNA...' : `🎬 Tạo cảnh... (${prompts.length}/${quantity})`}
                </span>
                <span className="text-slate-500">{Math.round(genFraction * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-500', genPhase === 'dna' ? 'bg-purple-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.round(genFraction * 100)}%` }} />
              </div>
              {genProgress && <p className="text-[9px] text-slate-500 truncate">{genProgress}</p>}
            </div>
          )}
          <button onClick={handleGenerate} disabled={isLoading || !subject.trim()}
            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2.5 text-sm">
            {isLoading ? (
              <><Loader2 size={16} className="animate-spin" /><span>{genPhase === 'dna' ? 'Đang phân tích DNA...' : `Đang tạo... (${prompts.length}/${quantity})`}</span></>
            ) : (
              <><Sparkles size={16} /><span>Xác nhận & Tạo Prompt ({quantity} cảnh)</span></>
            )}
          </button>
        </div>
      </div>

      {/* ── RIGHT PANEL: Live Results (60% width) ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f1524]">

        {/* Sticky download toolbar */}
        {prompts.length > 0 && (
          <div className="shrink-0 px-4 py-3 border-b border-slate-700/60 bg-[#0d1322] flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mr-1">
              ✅ {prompts.length}/{quantity} cảnh
            </span>
            <button onClick={copyAllPrompts}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[9px] font-bold hover:opacity-80 active:scale-95 flex items-center gap-1">
              {copyFeedback['all-prompts'] ? <><Check size={9}/> Đã chép</> : <><Copy size={9}/> Chép All Prompt</>}
            </button>
            <button onClick={copyAllJson}
              className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-[9px] font-bold hover:opacity-80 active:scale-95 flex items-center gap-1">
              {copyFeedback['all-json'] ? <><Check size={9}/> Đã chép</> : <><Copy size={9}/> Chép All JSONL</>}
            </button>
            <button onClick={downloadAllPrompts}
              className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-[9px] font-bold hover:bg-slate-600 active:scale-95 flex items-center gap-1">
              <Download size={9}/> TXT
            </button>
            <button onClick={downloadAllJson}
              className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-lg text-[9px] font-bold hover:bg-slate-600 active:scale-95 flex items-center gap-1">
              <Download size={9}/> JSONL
            </button>
            <button onClick={copyDnaJson}
              className="px-3 py-1.5 bg-purple-600/30 text-purple-400 border border-purple-500/30 rounded-lg text-[9px] font-bold hover:bg-purple-600/40 active:scale-95 flex items-center gap-1">
              {copyFeedback['dna-json'] ? <><Check size={9}/> Đã chép</> : <><Copy size={9}/> DNA JSON</>}
            </button>
            {/* Batch download dropdown area */}
            {batches.length > 1 && (
              <div className="ml-auto flex items-center gap-1 flex-wrap">
                {batches.map((_, idx) => {
                  const start = idx * BATCH_SIZE + 1;
                  const end = Math.min((idx + 1) * BATCH_SIZE, prompts.length);
                  return (
                    <div key={idx} className="flex items-center gap-1 bg-[#1a2235] border border-slate-700/60 rounded-lg px-2 py-1">
                      <span className="text-[8px] text-slate-500 font-bold">{start}-{end}</span>
                      <button onClick={() => copyBatchJson(idx)} title="Chép JSONL nhóm"
                        className={cn('p-0.5 rounded text-[8px] font-bold', copyFeedback[`json-${idx}`] ? 'text-emerald-400' : 'text-orange-400 hover:text-orange-300')}>
                        {copyFeedback[`json-${idx}`] ? <Check size={9}/> : <Copy size={9}/>}
                      </button>
                      <button onClick={() => downloadBatchJson(idx)} title="Tải JSONL nhóm"
                        className="p-0.5 rounded text-slate-500 hover:text-white">
                        <Download size={9}/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Empty / loading placeholder */}
          {prompts.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <Sparkles size={28} className="text-emerald-500/50"/>
              </div>
              <p className="text-slate-500 text-sm font-medium mb-1">Kết quả sẽ hiện ở đây</p>
              <p className="text-slate-600 text-[11px]">Nhập kịch bản và nhấn Tạo Prompt để bắt đầu</p>
            </div>
          )}

          {/* Loading placeholder (show spinner + progress info when no scenes yet) */}
          {prompts.length === 0 && isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
              <Loader2 size={32} className={cn('mb-4 animate-spin', genPhase === 'dna' ? 'text-purple-400' : 'text-emerald-400')}/>
              <p className={cn('text-sm font-bold', genPhase === 'dna' ? 'text-purple-400' : 'text-emerald-400')}>
                {genPhase === 'dna' ? 'Đang phân tích DNA kịch bản...' : 'Đang tạo prompt cảnh...'}
              </p>
              {genProgress && <p className="text-[11px] text-slate-500 mt-2 max-w-sm">{genProgress}</p>}
            </div>
          )}

          {/* DNA summary card */}
          {prompts.length > 0 && fullJson?.dna && (
            <div className="mx-4 mt-4 p-3 bg-purple-500/5 border border-purple-500/20 rounded-xl flex items-start gap-3">
              <div className="p-1.5 bg-purple-500/20 rounded-lg shrink-0"><Database size={12} className="text-purple-400"/></div>
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold text-purple-400 uppercase tracking-widest mb-1">DNA Lock</div>
                <div className="flex flex-wrap gap-2">
                  {fullJson.dna.characters?.length > 0 && (
                    <span className="text-[9px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      <User size={8} className="inline mr-0.5 text-indigo-400"/>{fullJson.dna.characters.map(c => c.id).join(', ')}
                    </span>
                  )}
                  {fullJson.dna.environments?.length > 0 && (
                    <span className="text-[9px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      <Map size={8} className="inline mr-0.5 text-emerald-400"/>{fullJson.dna.environments.map(e => e.id).join(', ')}
                    </span>
                  )}
                  {fullJson.dna.master_dna?.style_lock && (
                    <span className="text-[9px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded truncate max-w-[200px]" title={fullJson.dna.master_dna.style_lock}>
                      🎨 {fullJson.dna.master_dna.style_lock.substring(0, 60)}{fullJson.dna.master_dna.style_lock.length > 60 ? '…' : ''}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={downloadDnaJson} title="Tải DNA JSON" className="p-1 text-slate-500 hover:text-white transition-colors shrink-0">
                <Download size={12}/>
              </button>
            </div>
          )}

          {/* Scene list */}
          {prompts.length > 0 && (
            <div className="p-4 space-y-1.5">
              {prompts.map((prompt, idx) => {
                const fd = prompt.fullData || {};
                return (
                  <SceneRow key={prompt.id} prompt={prompt} fd={fd} idx={idx} sceneDuration={sceneDuration} />
                );
              })}
              {/* Loading indicator at bottom while still generating */}
              {isLoading && (
                <div className="flex items-center gap-2 py-3 px-3 text-[10px] text-emerald-400">
                  <Loader2 size={12} className="animate-spin shrink-0"/>
                  <span>{genProgress || `Đang tạo cảnh ${prompts.length + 1}...`}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SceneRow: compact single-line scene item with copy on click ──
function SceneRow({ prompt, fd, idx, sceneDuration }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedAudio, setCopiedAudio] = useState(false);

  const doCopyPrompt = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.promptText || '');
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };
  const doCopyAudio = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fd.audio_prompt || '');
    setCopiedAudio(true);
    setTimeout(() => setCopiedAudio(false), 2000);
  };

  return (
    <div className={cn('rounded-xl border transition-all', expanded ? 'bg-[#1a2235] border-indigo-500/30' : 'bg-[#141c2b] border-slate-700/50 hover:border-slate-600/70')}>
      {/* Row header — always visible */}
      <div className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none" onClick={() => setExpanded(v => !v)}>
        <div className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/25 flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0">
          {fd.scene_number || idx + 1}
        </div>
        <span className="text-[11px] font-semibold text-slate-300 truncate flex-1">
          {fd.title || prompt.title || `Cảnh ${idx + 1}`}
        </span>
        {fd.characters_in_scene?.length > 0 && (
          <span className="text-[8px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded shrink-0">
            {fd.characters_in_scene.join(', ')}
          </span>
        )}
        <span className="text-[8px] text-slate-600 font-bold shrink-0">{sceneDuration}s</span>
        <button onClick={doCopyPrompt}
          className="p-1 rounded text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
          title="Sao chép prompt">
          {copiedPrompt ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>}
        </button>
        <ChevronDown size={11} className={cn('text-slate-600 transition-transform shrink-0', expanded && 'rotate-180')}/>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-700/40 pt-2.5">
          {/* Final prompt */}
          <div className="bg-[#0a1020] rounded-lg border border-slate-700/50 p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">🎬 Final Prompt</span>
              <button onClick={doCopyPrompt}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[8px] font-bold text-slate-400 flex items-center gap-1">
                {copiedPrompt ? <><Check size={8} className="text-emerald-400"/> Đã chép</> : <><Copy size={8}/> Chép</>}
              </button>
            </div>
            <p className="text-[10px] font-mono text-slate-400 leading-relaxed">{prompt.promptText}</p>
          </div>

          {/* Audio prompt */}
          {fd.audio_prompt && (
            <div className="p-2 bg-indigo-500/5 border border-indigo-500/20 rounded-lg flex items-start gap-2">
              <Volume2 size={10} className="text-indigo-400 shrink-0 mt-0.5"/>
              <p className="text-[10px] text-slate-400 italic flex-1">{fd.audio_prompt}</p>
              <button onClick={doCopyAudio} className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded text-[8px] font-bold hover:bg-indigo-500/30 shrink-0">
                {copiedAudio ? 'Đã chép' : 'Chép'}
              </button>
            </div>
          )}

          {/* Dialogue */}
          {fd.dialogue && fd.dialogue !== '— Im lặng —' && fd.dialogue !== '— Silence —' && (
            <div className="p-2 bg-blue-500/5 border border-blue-500/15 rounded-lg">
              <span className="text-[8px] font-bold text-blue-400 uppercase block mb-0.5">🎤 Lời thoại</span>
              <p className="text-[10px] text-slate-300">"{fd.dialogue}"</p>
            </div>
          )}

          {/* SFX / BGM */}
          {fd.sfx_bgm && (
            <div className="p-2 bg-pink-500/5 border border-pink-500/15 rounded-lg">
              <span className="text-[8px] font-bold text-pink-400 uppercase block mb-0.5">🎵 SFX/BGM</span>
              <p className="text-[10px] text-slate-400">{fd.sfx_bgm}</p>
            </div>
          )}

          {/* Camera & setting */}
          {(fd.scene_specifics?.camera_movement || fd.setting_detail) && (
            <div className="flex gap-2 text-[9px] text-slate-500">
              {fd.scene_specifics?.camera_movement && (
                <span className="flex items-center gap-1"><Camera size={9} className="text-slate-600"/> {fd.scene_specifics.camera_movement}</span>
              )}
              {fd.setting_detail && (
                <span className="flex items-center gap-1 italic truncate"><Map size={9} className="text-slate-600"/> {fd.setting_detail}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SEO YTB PANEL ────────────────────────────────────────────────────────────

const DISCLAIMER_VI = '⚠️ Tuyên bố miễn trừ trách nhiệm (Disclaimer): Nội dung hình ảnh và âm thanh trong video này được hỗ trợ tạo ra bởi các công cụ Trí tuệ Nhân tạo (AI). Đây là những câu chuyện được hình tượng hóa nhằm mục đích truyền cảm hứng, lan tỏa thông điệp nhân văn và nâng cao nhận thức. Mọi sự trùng hợp với người, địa điểm hoặc sự kiện có thật (nếu có) đều là hoàn toàn ngẫu nhiên.';
const DISCLAIMER_EN = '⚠️ Disclaimer: The visual and audio content in this video was generated with the assistance of Artificial Intelligence (AI) tools. These are dramatized stories created to inspire, spread humanitarian messages, and raise awareness. Any resemblance to actual persons, places, or real-life events is purely coincidental.';

const SEO_LANGS = [
  { value: 'vi', label: 'Tiếng Việt 🇻🇳' },
  { value: 'en', label: 'English (US) 🇺🇸' },
  { value: 'ja', label: '日本語 🇯🇵' },
];

async function generateSeoMetadata(apiKeys, content, language, channelName, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: 'Japanese (日本語)' }[language] || 'Tiếng Việt';
    const disclaimer = language === 'vi' ? DISCLAIMER_VI : DISCLAIMER_EN;

    const systemInstruction = `Bạn là một Giám đốc Sáng tạo (Creative Director) và Chuyên gia tối ưu hóa YouTube (YouTube Growth Specialist) hàng đầu thế giới, chuyên về Thumbnail CTR cực cao và SEO VidIQ 100/100.

NHIỆM VỤ: Phân tích kịch bản video để tạo ra bộ metadata hoàn chỉnh và 3 ý tưởng Thumbnail đỉnh cao.

### PHẦN 1: NGUYÊN TẮC THUMBNAIL YOUTUBE
1. Rõ Ràng: Hiểu video nói về gì trong 0.5 giây.
2. Sức Hút Cảm Xúc: Tập trung biểu cảm khuôn mặt hoặc tình huống kịch tính.
3. Đối Lập & Tương Phản: Màu sắc mạnh để chủ thể nổi bật.
4. Bố Cục: Quy tắc 1/3. Tránh góc dưới phải.
5. Kể Chuyện: Đặt câu hỏi (Curiosity Gap).
6. Phong Cách: PHẢI khớp phong cách đồ họa từ kịch bản. Không sai lệch phong cách.

### PHẦN 2: CHIẾN LƯỢC SEO
1. TIÊU ĐỀ: 5 lựa chọn < 65 ký tự, từ khóa chính, gây tò mò/cảm xúc.
2. MÔ TẢ: 3 đoạn (Từ khóa → Tóm tắt → Hashtags). BẮT BUỘC chèn Disclaimer: "${disclaimer}"
3. TAGS: Tối đa 500 ký tự, ngăn cách dấu phẩy. Từ khóa chính + rộng + đuôi dài.

### PHẦN 3: PROMPT THUMBNAIL
Mỗi ý tưởng có 2 phiên bản prompt tiếng Anh:
1. Prompt Without Text: 100% mô tả hình ảnh, bối cảnh, nhân vật, phong cách.
2. Prompt With Text: Lấy TOÀN BỘ Without Text, chỉ thêm mô tả chữ vào cuối.
— Subject: TRÍCH XUẤT CHÍNH XÁC nhân vật từ kịch bản. Không tự ý thêm thắt.
— Environment: Bối cảnh, Bokeh nền.
— Lighting: Cinematic, Dramatic, High Contrast.
— Camera: Close-up hoặc Medium Shot.
— Style: Trích xuất chính xác từ kịch bản (Photorealistic, Pixar, Ghibli, v.v.).

### PHẦN 4: CHÍNH SÁCH AN TOÀN (BẮT BUỘC)
KHÔNG: CSAM, Deepfake/tên người nổi tiếng, khiêu dâm, bạo lực máu me, kích động thù địch, thông tin sai lệch.
Với siêu anh hùng có bản quyền: mô tả ngoại hình không dùng tên riêng, đổi màu trang phục.

QUY TẮC: Ngôn ngữ = ${langLabel.toUpperCase()} | Kênh = ${channelName || 'Của tôi'} | Viết cho CON NGƯỜI click, cấu trúc cho MÁY xếp hạng.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: `Phân tích và tối ưu Packaging cho kịch bản (Kênh: ${channelName || 'Của tôi'}):\n\n${content}` }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['titles', 'description', 'tags', 'thumbnailPrompts', 'summary', 'socialPost'],
          properties: {
            titles:           { type: Type.ARRAY, items: { type: Type.STRING } },
            description:      { type: Type.STRING },
            tags:             { type: Type.STRING },
            thumbnailPrompts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ['concept', 'promptWithText', 'promptWithoutText', 'textOnImage'],
                properties: {
                  concept:           { type: Type.STRING },
                  promptWithText:    { type: Type.STRING },
                  promptWithoutText: { type: Type.STRING },
                  textOnImage:       { type: Type.STRING },
                }
              }
            },
            summary:    { type: Type.STRING },
            socialPost: { type: Type.STRING },
          }
        },
        systemInstruction,
      }
    });

    const text = response?.text || '';
    if (!text) throw new Error('AI trả về rỗng. Vui lòng thử lại.');
    return JSON.parse(text);
  }, apiKeys, { onSwitch });
}

async function generateThumbnailImageSeo(apiKeys, prompt, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] }
    });
    for (const part of (response.candidates?.[0]?.content?.parts || [])) {
      if (part.inlineData) return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
    throw new Error('Không tìm thấy ảnh trong phản hồi AI. Model có thể chưa hỗ trợ tạo ảnh với key này.');
  }, apiKeys, { onSwitch });
}

function SeoMetaCard({ title, icon, children, copyText }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5 hover:border-indigo-500/30 transition-all">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400">{icon}</div>
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
        </div>
        {copyText && (
          <button onClick={doCopy}
            className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-400 hover:text-indigo-400 transition-colors">
            {copied ? <Check size={13} className="text-emerald-400"/> : <Copy size={13}/>}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SeoYTBPanel({ apiKeys, onKeySwitch }) {
  const [channelName, setChannelName] = useState('');
  const [content, setContent]         = useState('');
  const [language, setLanguage]       = useState('vi');
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState('');
  const [metadata, setMetadata]       = useState(null);

  // Thumbnail state
  const [selThumb, setSelThumb]         = useState(0);
  const [showText, setShowText]         = useState(true);
  const [thumbImages, setThumbImages]   = useState({});   // { `${idx}-withText`: url, ... }
  const [genImgIdx, setGenImgIdx]       = useState(null); // which index is generating
  const [imgError, setImgError]         = useState('');

  const fileRef = useRef(null);
  const resultsRef = useRef(null);

  const onSwitch = ({ fromIdx, toIdx, total, reason }) => onKeySwitch?.({ fromIdx, toIdx, total, reason });

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { if (typeof ev.target?.result === 'string') setContent(ev.target.result); };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!apiKeys?.length) { setError('Chưa có API Key. Vui lòng thêm key Gemini ở thanh trên.'); return; }
    if (!content.trim())  { setError('Vui lòng nhập kịch bản hoặc ý tưởng.'); return; }
    setIsLoading(true); setError(''); setMetadata(null); setThumbImages({}); setImgError('');
    try {
      const result = await generateSeoMetadata(apiKeys, content, language, channelName, onSwitch);
      setMetadata(result);
      setSelThumb(0);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      const msg = err?.message || 'Có lỗi xảy ra. Vui lòng thử lại.';
      const ml = msg.toLowerCase();
      if (ml.includes('rate limit') || ml.includes('429')) setError('⏳ API vượt hạn mức (429). Vui lòng đợi vài phút hoặc thêm key mới.');
      else if (ml.includes('503')) setError('Model Gemini đang quá tải (503). Vui lòng thử lại sau.');
      else setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenImage = async (promptIdx, withText) => {
    if (!apiKeys?.length) { setImgError('Cần API Key để tạo ảnh.'); return; }
    const key = `${promptIdx}-${withText ? 'text' : 'clean'}`;
    setGenImgIdx(key); setImgError('');
    try {
      const thumb = metadata.thumbnailPrompts[promptIdx];
      const prompt = withText ? thumb.promptWithText : thumb.promptWithoutText;
      const url = await generateThumbnailImageSeo(apiKeys, prompt, onSwitch);
      setThumbImages(prev => ({ ...prev, [key]: url }));
    } catch (err) {
      setImgError(err?.message || 'Không thể tạo ảnh. Thử lại sau.');
    } finally {
      setGenImgIdx(null);
    }
  };

  const currentThumb = metadata?.thumbnailPrompts?.[selThumb];
  const currentImgKey = `${selThumb}-${showText ? 'text' : 'clean'}`;
  const currentImageUrl = thumbImages[currentImgKey];
  const isGenImgCurrent = genImgIdx === currentImgKey;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0f1524] px-6 py-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-red-500/20 rounded-xl"><Youtube size={20} className="text-red-400"/></div>
            <h2 className="text-2xl font-bold text-white">YouTube SEO Packaging AI</h2>
          </div>
          <p className="text-sm text-slate-500 ml-14">Tối ưu tiêu đề, mô tả, tags, thumbnail cho kênh YouTube — High-CTR & VidIQ 100/100</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── LEFT: Input ── */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <AlignLeft size={15} className="text-indigo-400"/> Nội dung & Thông tin kênh
                </h3>
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[11px] font-bold text-slate-300 transition-colors">
                  <Upload size={12} className="text-indigo-400"/> Tải file
                </button>
                <input type="file" ref={fileRef} onChange={handleFileUpload} accept=".txt,.md,.doc,.docx" className="hidden"/>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Tên kênh YouTube</label>
                  <input type="text" value={channelName} onChange={e => setChannelName(e.target.value)}
                    placeholder="Ví dụ: TechDaily, Animal Stories..."
                    className="w-full px-3 py-2 bg-[#0a1020] border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-all"/>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Kịch bản / Ý tưởng video</label>
                  <textarea value={content} onChange={e => setContent(e.target.value)} rows={10}
                    placeholder="Dán kịch bản hoặc tải file .txt lên..."
                    className="w-full px-3 py-2.5 bg-[#0a1020] border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-all resize-none"/>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngôn ngữ</label>
                    <select value={language} onChange={e => setLanguage(e.target.value)}
                      className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50">
                      {SEO_LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Model AI</label>
                    <div className="px-3 py-1.5 bg-[#0a1020] border border-slate-700 rounded-lg text-sm text-slate-400">
                      Gemini 2.5 Flash
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                    <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5"/>
                    <p className="text-[11px] text-red-300">{error}</p>
                  </div>
                )}

                <button onClick={handleGenerate} disabled={isLoading || !content.trim()}
                  className={cn('w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
                    isLoading || !content.trim()
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-red-600 to-pink-600 hover:opacity-90 text-white shadow-lg shadow-red-500/20 active:scale-95')}>
                  {isLoading
                    ? <><Loader2 size={16} className="animate-spin"/> Đang phân tích SEO...</>
                    : <><Youtube size={16}/> Tối ưu hóa Packaging</>}
                </button>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Results ── */}
          <div className="lg:col-span-7 space-y-4" ref={resultsRef}>
            {isLoading ? (
              <div className="min-h-[400px] flex flex-col items-center justify-center bg-[#1a2235] border border-slate-700/60 rounded-2xl">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-5 relative">
                  <Youtube size={28} className="text-red-400 animate-pulse"/>
                  <div className="absolute inset-0 rounded-full border-2 border-red-500/20 animate-ping"/>
                </div>
                <p className="text-slate-200 font-bold text-base">AI đang thiết kế Metadata High-CTR...</p>
                <p className="text-slate-500 text-sm mt-1">Phân tích kịch bản & tạo packaging...</p>
              </div>
            ) : metadata ? (
              <>
                {/* Titles */}
                <SeoMetaCard title="5 Lựa chọn Tiêu đề (High-CTR)" icon={<Sparkles size={14}/>} copyText={metadata.titles?.join('\n')}>
                  <div className="space-y-2">
                    {(metadata.titles || []).map((title, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 p-2.5 bg-[#0a1020] rounded-xl border border-slate-700/50 group hover:border-indigo-500/30 transition-all">
                        <span className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-black flex items-center justify-center shrink-0">{idx+1}</span>
                        <p className="text-sm text-slate-200 font-medium flex-1 leading-tight">{title}</p>
                        <button onClick={() => navigator.clipboard.writeText(title)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-indigo-400 transition-all">
                          <Copy size={12}/>
                        </button>
                      </div>
                    ))}
                  </div>
                </SeoMetaCard>

                {/* Description */}
                <SeoMetaCard title="Mô tả SEO (VidIQ + Disclaimer)" icon={<AlignLeft size={14}/>} copyText={metadata.description}>
                  <p className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap">{metadata.description}</p>
                </SeoMetaCard>

                {/* Thumbnails */}
                <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><ImageIcon size={14}/></div>
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ý tưởng Thumbnail (3 Concept)</h3>
                    </div>
                    {/* Concept selector */}
                    <div className="flex gap-1.5">
                      {(metadata.thumbnailPrompts || []).map((t, idx) => (
                        <button key={idx} onClick={() => setSelThumb(idx)}
                          className={cn('px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border',
                            selThumb === idx
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700')}>
                          {t.concept || `Option ${idx+1}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentThumb && (
                    <div className="space-y-3">
                      {/* With/Without text toggle */}
                      <div className="flex items-center justify-center bg-[#0a1020] p-0.5 rounded-lg border border-slate-700/50 w-fit mx-auto">
                        {[['text', 'Có chữ (Auto Text)'], ['clean', 'Không chữ (Clean)']].map(([mode, label]) => (
                          <button key={mode} onClick={() => setShowText(mode === 'text')}
                            className={cn('px-4 py-1.5 rounded-md text-[10px] font-bold transition-all',
                              (mode === 'text') === showText ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200')}>
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Prompt box */}
                      <div className="p-3 bg-[#0a1020] rounded-xl border border-slate-700/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                            {currentThumb.concept}
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase">
                            {showText ? 'With Typography' : 'Image Only'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 italic leading-relaxed mb-2">
                          {showText ? currentThumb.promptWithText : currentThumb.promptWithoutText}
                        </p>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase">Text on Image:</span>
                          <span className="text-sm font-bold text-white uppercase tracking-tight">"{currentThumb.textOnImage}"</span>
                        </div>
                        <button onClick={() => navigator.clipboard.writeText(showText ? currentThumb.promptWithText : currentThumb.promptWithoutText)}
                          className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold transition-colors">
                          <Copy size={10}/> Copy {showText ? 'With Text' : 'Clean'} Prompt
                        </button>
                      </div>

                      {/* Image generation */}
                      <button onClick={() => handleGenImage(selThumb, showText)} disabled={isGenImgCurrent}
                        className={cn('w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
                          isGenImgCurrent
                            ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90 text-white active:scale-95')}>
                        {isGenImgCurrent
                          ? <><Loader2 size={15} className="animate-spin"/> Đang tạo ảnh...</>
                          : <><ImageIcon size={15}/> Tạo ảnh Thumbnail ngay (Gemini 2.0 Flash)</>}
                      </button>

                      {imgError && (
                        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-2.5">
                          <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5"/>
                          <p className="text-[10px] text-red-300">{imgError}</p>
                        </div>
                      )}

                      {currentImageUrl && (
                        <div className="relative group rounded-2xl overflow-hidden border border-slate-700 bg-[#0a1020] shadow-2xl">
                          <img src={currentImageUrl} alt="Generated Thumbnail" className="w-full h-auto object-cover"/>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                            <a href={currentImageUrl} download="thumbnail.png"
                              className="flex items-center gap-2 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
                              <Download size={14}/> Tải ảnh xuống
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tags */}
                <SeoMetaCard title="Thẻ Tags SEO (Copy/Paste)" icon={<Hash size={14}/>} copyText={metadata.tags}>
                  <div className="flex flex-wrap gap-1.5">
                    {(metadata.tags || '').split(',').map(t => t.trim()).filter(Boolean).map((tag, idx) => (
                      <span key={idx} className="bg-[#0a1020] text-indigo-300 text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-slate-700 hover:border-indigo-500/30 transition-colors">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </SeoMetaCard>

                {/* Social post + Summary */}
                <div className="grid grid-cols-2 gap-4">
                  <SeoMetaCard title="Post Mạng Xã Hội" icon={<Share2 size={14}/>} copyText={metadata.socialPost}>
                    <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{metadata.socialPost}</p>
                  </SeoMetaCard>
                  <SeoMetaCard title="Tóm tắt nội dung" icon={<FileText size={14}/>} copyText={metadata.summary}>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{metadata.summary}</p>
                  </SeoMetaCard>
                </div>
              </>
            ) : (
              <div className="min-h-[400px] flex flex-col items-center justify-center bg-[#1a2235] border-2 border-dashed border-slate-700/60 rounded-2xl">
                <div className="p-5 bg-[#0a1020] rounded-2xl mb-4 border border-slate-800">
                  <Youtube size={40} className="text-slate-700"/>
                </div>
                <p className="text-slate-500 text-sm font-medium text-center px-6">
                  Kết quả SEO sẽ hiển thị ở đây.<br/>
                  <span className="text-red-400/60">Nhập tên kênh + kịch bản để bắt đầu.</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VIRAL VIDEO AI ───────────────────────────────────────────────────────────

const VIRAL_ASPECT_RATIOS = ['9:16', '1:1', '16:9'];
const VIRAL_DURATIONS = [
  { label: '10s',  value: 10 },
  { label: '30s',  value: 30 },
  { label: '60s',  value: 60 },
  { label: '90s',  value: 90 },
  { label: '120s', value: 120 },
];

async function analyzeViralSegments(apiKey, base64Video, mimeType = 'video/mp4') {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Bạn là chuyên gia phân tích nội dung viral trên mạng xã hội. Hãy xem video này và tìm ra đúng 5 đoạn nổi bật nhất có tiềm năng viral cao nhất (hài hước, cảm xúc mạnh, thông tin thú vị, khoảnh khắc đặc sắc, hành động bất ngờ, v.v.).

Trả về JSON hợp lệ theo đúng định dạng sau (không có markdown, không giải thích thêm):
{
  "segments": [
    {
      "index": 1,
      "startTime": 12.5,
      "title": "Tiêu đề ngắn gọn của đoạn",
      "reason": "Lý do đoạn này viral",
      "viralScore": 92
    }
  ]
}

Yêu cầu:
- Trả về đúng 5 đoạn, sắp xếp theo viralScore giảm dần
- startTime là thời điểm bắt đầu (giây, số thực) — chọn điểm BẮT ĐẦU hấp dẫn nhất
- viralScore từ 1-100
- Chỉ trả về startTime, không cần endTime (hệ thống tự tính thời lượng)`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Video } },
        { text: prompt }
      ]
    }],
    config: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
  });

  let text = response?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini không trả về JSON hợp lệ');
  return JSON.parse(jsonMatch[0]);
}

function ViralVideoPanel({ apiKeys, onKeySwitch }) {
  const [videoPath, setVideoPath]       = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [aspectRatio, setAspectRatio]   = useState('9:16');
  const [segDuration, setSegDuration]   = useState(30); // seconds
  const [isBusy, setIsBusy]             = useState(false);
  const [phase, setPhase]               = useState('idle'); // idle | proxy | analyze | cut | done
  const [results, setResults]           = useState([]); // [{ index, title, reason, viralScore, startTime, endTime, outputPath?, error? }]
  const [log, setLog]                   = useState('');
  const [error, setError]               = useState('');

  const logRef = useRef(null);
  const addLog = (msg) => {
    setLog(prev => prev ? prev + '\n' + msg : msg);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 30);
  };

  const toFileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const scoreColor = (s) => s >= 85 ? 'text-green-400' : s >= 70 ? 'text-yellow-400' : 'text-orange-400';

  const handleSelectVideo = async () => {
    const file = await window.electronAPI.selectFile('video');
    if (file) { setVideoPath(file); setResults([]); setLog(''); setError(''); setPhase('idle'); }
  };
  const handleSelectFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) setOutputFolder(folder);
  };

  // ── Phân tích + Cắt tự động ──────────────────────────────────────────────
  const handleRun = async () => {
    if (!videoPath)    return setError('Vui lòng chọn video nguồn!');
    if (!outputFolder) return setError('Vui lòng chọn thư mục lưu!');
    if (!apiKeys || apiKeys.length === 0) return setError('Chưa có Gemini API Key!');

    setIsBusy(true);
    setError('');
    setResults([]);
    setLog('');

    try {
      // ── 1. Tạo proxy 320p để gửi Gemini ──
      setPhase('proxy');
      addLog('⏳ Nén video → proxy 320p...');
      const proxyRes = await window.electronAPI.viralCreateProxy(videoPath);
      if (!proxyRes.success) throw new Error('Không thể tạo proxy: ' + proxyRes.error);
      const sizeMB = (proxyRes.base64.length * 0.75 / 1024 / 1024).toFixed(1);
      addLog(`✅ Proxy OK — ${sizeMB}MB`);

      // ── 2. Gemini phân tích ──
      setPhase('analyze');
      addLog('🤖 Gửi Gemini phân tích...');
      const analysisResult = await retryWithKeyRotation(
        (key) => analyzeViralSegments(key, proxyRes.base64, 'video/mp4'),
        apiKeys,
        {
          onSwitch: ({ fromIdx, toIdx, total, reason }) => {
            const reasonTxt = reason === 'quota_exhausted' ? 'hết quota ngày' : 'giới hạn/phút';
            addLog(`⚠️ Key ${fromIdx + 1} ${reasonTxt} → Key ${toIdx + 1}/${total}`);
            onKeySwitch?.({ fromIdx, toIdx, total, reason });
          }
        }
      );

      const segs = (analysisResult.segments || []).slice(0, 5);
      if (segs.length === 0) throw new Error('Gemini không tìm thấy đoạn viral nào');
      addLog(`🎯 Tìm thấy ${segs.length} đoạn — bắt đầu cắt (${segDuration}s / đoạn, ${aspectRatio})...`);

      // ── 3. Cắt từng đoạn trực tiếp từ file gốc bằng FFmpeg ──
      setPhase('cut');
      const cutResults = [];
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const startTime = seg.startTime || 0;
        const endTime   = startTime + segDuration;
        addLog(`✂️ [${i + 1}/${segs.length}] "${seg.title}" — ${startTime}s → ${endTime}s`);

        const res = await window.electronAPI.viralCutSegment({
          inputPath: videoPath,
          startTime,
          endTime,
          outputFolder,
          index: i,
          aspectRatio,
        });

        if (res.success) {
          addLog(`✅ viral_short_${i + 1}.mp4`);
          cutResults.push({ ...seg, startTime, endTime, outputPath: res.outputPath, success: true });
        } else {
          addLog(`❌ Đoạn ${i + 1} lỗi: ${res.error}`);
          cutResults.push({ ...seg, startTime, endTime, error: res.error, success: false });
        }
      }

      setResults(cutResults);
      setPhase('done');
      const ok = cutResults.filter(r => r.success).length;
      addLog(`🎉 Hoàn thành! ${ok}/${segs.length} đoạn thành công.`);
    } catch (e) {
      setError(e.message);
      addLog('❌ ' + e.message);
      setPhase('idle');
    } finally {
      setIsBusy(false);
    }
  };

  const phaseLabel = { proxy: 'Đang tạo proxy...', analyze: 'Gemini phân tích...', cut: 'FFmpeg đang cắt...', done: '' };

  return (
    <div className="flex flex-col flex-1 overflow-hidden p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <Zap size={17} className="text-rose-400" />
        <span className="text-base font-bold text-white">Viral Video AI</span>
        <span className="text-xs text-slate-500">— Gemini phân tích + FFmpeg cắt tự động</span>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden min-h-0">

        {/* ── LEFT PANEL ── */}
        <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">

          {/* Video nguồn */}
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
            <p className="text-[11px] text-slate-400 mb-2 font-semibold uppercase tracking-wide">Video nguồn</p>
            <button onClick={handleSelectVideo} disabled={isBusy}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm transition-colors border border-slate-600">
              <Film size={13} /> Chọn video...
            </button>
            {videoPath && <p className="mt-1.5 text-[11px] text-rose-300 truncate" title={videoPath}>📁 {videoPath.split(/[\\/]/).pop()}</p>}
          </div>

          {/* Thư mục lưu */}
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
            <p className="text-[11px] text-slate-400 mb-2 font-semibold uppercase tracking-wide">Thư mục lưu</p>
            <button onClick={handleSelectFolder} disabled={isBusy}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm transition-colors border border-slate-600">
              <Download size={13} /> Chọn thư mục...
            </button>
            {outputFolder && <p className="mt-1.5 text-[11px] text-emerald-300 truncate" title={outputFolder}>📂 {outputFolder.split(/[\\/]/).pop()}</p>}
          </div>

          {/* Tỉ lệ xuất */}
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
            <p className="text-[11px] text-slate-400 mb-2 font-semibold uppercase tracking-wide">Tỉ lệ xuất</p>
            <div className="flex gap-1.5">
              {VIRAL_ASPECT_RATIOS.map(r => (
                <button key={r} onClick={() => setAspectRatio(r)} disabled={isBusy}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50',
                    aspectRatio === r ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600')}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Thời gian mỗi đoạn */}
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
            <p className="text-[11px] text-slate-400 mb-2 font-semibold uppercase tracking-wide">Thời lượng mỗi đoạn</p>
            <div className="flex flex-wrap gap-1.5">
              {VIRAL_DURATIONS.map(d => (
                <button key={d.value} onClick={() => setSegDuration(d.value)} disabled={isBusy}
                  className={cn('flex-1 min-w-[3rem] py-1.5 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50',
                    segDuration === d.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600')}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* RUN button */}
          <button onClick={handleRun} disabled={isBusy || !videoPath || !outputFolder}
            className={cn(
              'flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all border',
              isBusy
                ? 'bg-rose-900/40 border-rose-700/40 text-rose-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-rose-600 to-violet-600 hover:from-rose-500 hover:to-violet-500 border-rose-500/50 text-white shadow-lg'
            )}>
            {isBusy
              ? <><Loader2 size={14} className="animate-spin" />{phaseLabel[phase] || 'Đang xử lý...'}</>
              : <><Zap size={14} /> Phân tích &amp; Cắt Viral</>}
          </button>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-xs">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* Log */}
          {log && (
            <div ref={logRef} className="bg-slate-900/70 rounded-lg border border-slate-700/40 p-2 max-h-48 overflow-y-auto">
              <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-mono leading-[1.6]">{log}</pre>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: Results ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Empty state */}
          {results.length === 0 && !isBusy && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
              <Zap size={44} className="text-rose-900/50" />
              <p className="text-sm text-center leading-relaxed">
                Chọn video + thư mục lưu<br />
                Chọn tỉ lệ &amp; thời lượng rồi nhấn<br />
                <span className="text-rose-400 font-bold">Phân tích &amp; Cắt Viral</span>
              </p>
            </div>
          )}

          {/* Processing skeleton */}
          {isBusy && results.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Loader2 size={40} className="animate-spin text-rose-500" />
              <p className="text-sm text-slate-400 font-medium">{phaseLabel[phase]}</p>
            </div>
          )}

          {/* Results grid */}
          {results.length > 0 && (
            <div className="flex flex-col gap-3 pb-2">
              {/* Header bar */}
              <div className="flex items-center justify-between sticky top-0 bg-[#0d1117] py-1 z-10">
                <p className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                  {results.filter(r => r.success).length}/{results.length} đoạn — {segDuration}s • {aspectRatio}
                </p>
                {results.some(r => r.success) && (
                  <button onClick={() => window.electronAPI.openFolder(outputFolder)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 transition-colors">
                    <Download size={12} /> Mở thư mục
                  </button>
                )}
              </div>

              {/* Video cards grid */}
              <div className={cn(
                'grid gap-3',
                aspectRatio === '9:16' ? 'grid-cols-3 xl:grid-cols-5' : 'grid-cols-2 xl:grid-cols-3'
              )}>
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    'rounded-xl border overflow-hidden flex flex-col bg-slate-900/60',
                    r.success ? 'border-slate-700/50' : 'border-red-800/40 opacity-70'
                  )}>
                    {/* Video player or error placeholder */}
                    {r.success ? (
                      <video
                        src={toFileUrl(r.outputPath)}
                        controls
                        className="w-full bg-black"
                        style={{
                          aspectRatio: aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '16/9',
                          maxHeight: aspectRatio === '9:16' ? 320 : 200,
                          objectFit: 'contain',
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center bg-slate-800"
                        style={{ aspectRatio: aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '16/9', maxHeight: 200 }}>
                        <AlertCircle size={24} className="text-red-500" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="p-2 flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold text-white leading-tight line-clamp-2 flex-1">{r.title}</p>
                        <span className={cn('text-[11px] font-bold shrink-0', scoreColor(r.viralScore))}>🔥{r.viralScore}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">{r.startTime}s → {r.endTime}s</p>
                      {r.success
                        ? <p className="text-[10px] text-emerald-500 truncate">✅ {r.outputPath.split(/[\\/]/).pop()}</p>
                        : <p className="text-[10px] text-red-400 line-clamp-2">❌ {r.error}</p>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── VIDEO DOWNLOADER ─────────────────────────────────────────────────────────

const PLATFORM_META = {
  youtube: { label: 'YouTube', dot: 'bg-red-500',    badge: 'bg-red-500/15 border-red-500/30 text-red-400' },
  tiktok:  { label: 'TikTok',  dot: 'bg-pink-500',   badge: 'bg-pink-500/15 border-pink-500/30 text-pink-400' },
  douyin:  { label: 'Douyin',  dot: 'bg-orange-400', badge: 'bg-orange-500/15 border-orange-500/30 text-orange-400' },
  other:   { label: 'Video',   dot: 'bg-slate-500',  badge: 'bg-slate-500/15 border-slate-500/30 text-slate-400' },
};

const QUALITY_OPTS = [
  { value: 'best', label: 'Tốt nhất' },
  { value: '2160',  label: '4K (2160p)' },
  { value: '1080',  label: '1080p (Full HD)' },
  { value: '720',   label: '720p (HD)' },
  { value: '480',   label: '480p' },
  { value: '360',   label: '360p' },
];

function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}
function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B views';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M views';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K views';
  return n + ' views';
}

function VideoDownloaderPanel() {
  const [url,          setUrl]          = useState('');
  const [videoInfo,    setVideoInfo]    = useState(null);
  const [infoLoading,  setInfoLoading]  = useState(false);
  const [infoError,    setInfoError]    = useState('');
  const [quality,      setQuality]      = useState('best');
  const [format,       setFormat]       = useState('mp4');
  const [outputFolder, setOutputFolder] = useState('');
  const [downloading,  setDownloading]  = useState(false);
  const [progress,     setProgress]     = useState(null);
  const [dlError,      setDlError]      = useState('');
  const [history,      setHistory]      = useState(() => {
    try { return JSON.parse(localStorage.getItem('fluxy_dl_history') || '[]'); } catch { return []; }
  });
  const [ytStatus,     setYtStatus]     = useState(null); // null | { ok, version }
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupPct,     setSetupPct]     = useState(0);
  const [imgError,     setImgError]     = useState(false);

  const platform = useMemo(() => {
    if (/youtube\.com|youtu\.be/i.test(url))  return 'youtube';
    if (/tiktok\.com/i.test(url))              return 'tiktok';
    if (/douyin\.com/i.test(url))              return 'douyin';
    return url ? 'other' : null;
  }, [url]);

  useEffect(() => {
    window.electronAPI?.downloaderCheck?.().then(r => setYtStatus(r || { ok: false }));
    window.electronAPI?.getDownloadsDir?.().then(d => { if (d) setOutputFolder(d); });

    const offProg  = window.electronAPI?.onDownloaderProgress?.((d) => setProgress(d));
    const offSetup = window.electronAPI?.onDownloaderSetupProgress?.((d) => setSetupPct(d.percent));
    return () => {
      window.electronAPI?.removeAllListeners?.('downloader:progress');
      window.electronAPI?.removeAllListeners?.('downloader:setup-progress');
    };
  }, []);

  const handlePaste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) setUrl(t.trim()); } catch {}
  };

  const handleFetchInfo = async () => {
    const u = url.trim();
    if (!u) return;
    setInfoLoading(true); setVideoInfo(null); setInfoError(''); setImgError(false);
    const res = await window.electronAPI?.downloaderInfo?.(u);
    setInfoLoading(false);
    if (res?.success) setVideoInfo(res.data);
    else setInfoError(res?.error || 'Không lấy được thông tin video');
  };

  const handleSetup = async () => {
    setSetupLoading(true); setSetupPct(0);
    const res = await window.electronAPI?.downloaderSetup?.();
    setSetupLoading(false);
    if (res?.success) window.electronAPI?.downloaderCheck?.().then(r => setYtStatus(r || { ok: false }));
    else setDlError('Cài đặt thất bại: ' + (res?.error || 'lỗi không xác định'));
  };

  const handleSelectFolder = async () => {
    const f = await window.electronAPI?.selectFolder?.();
    if (f) setOutputFolder(f);
  };

  const handleDownload = async () => {
    if (!url.trim() || !outputFolder || downloading) return;
    setDownloading(true); setDlError(''); setProgress({ percent: 0, speed: '', eta: '', filename: '' });
    const res = await window.electronAPI?.downloaderStart?.({ url: url.trim(), outputFolder, quality, format });
    setDownloading(false);
    if (res?.success && !res?.cancelled) {
      const entry = { id: Date.now(), title: videoInfo?.title || url.trim(), platform, format, quality, folder: outputFolder, ts: Date.now() };
      const next = [entry, ...history].slice(0, 30);
      setHistory(next);
      localStorage.setItem('fluxy_dl_history', JSON.stringify(next));
      setProgress({ percent: 100, done: true });
    } else if (res?.cancelled) {
      setProgress(null);
    } else {
      setDlError(res?.error || 'Lỗi khi tải video');
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    await window.electronAPI?.downloaderCancel?.();
    setDownloading(false); setProgress(null);
  };

  const clearHistory = () => {
    setHistory([]); localStorage.removeItem('fluxy_dl_history');
  };

  const pm = PLATFORM_META[platform || 'other'];
  const canDownload = ytStatus?.ok && url.trim() && outputFolder && !downloading;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* ── yt-dlp status — chỉ hiện khi chưa cài ── */}
        {ytStatus?.ok === false && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <HardDrive size={16} className="text-amber-400 mt-0.5 shrink-0"/>
              <div>
                <p className="text-sm font-bold text-amber-300">Cần cài đặt yt-dlp</p>
                <p className="text-xs text-amber-400/70 mt-0.5">Công cụ tải video từ YouTube, TikTok, Douyin... cần được tải về lần đầu (~10MB).</p>
              </div>
            </div>
            {setupLoading ? (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Đang tải yt-dlp...</span>
                  <span>{setupPct}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${setupPct}%` }}/>
                </div>
              </div>
            ) : (
              <button onClick={handleSetup}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs font-bold border border-amber-500/30 transition-all">
                <Download size={12}/> Tải & Cài đặt yt-dlp tự động
              </button>
            )}
            {dlError && <p className="text-xs text-red-400">{dlError}</p>}
          </div>
        )}
        {/* ── URL input ── */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <Link size={10}/> Link video
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              {platform && (
                <span className={cn('absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded border', pm.badge)}>
                  {pm.label}
                </span>
              )}
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); setVideoInfo(null); setInfoError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleFetchInfo()}
                placeholder="Dán link YouTube / TikTok / Douyin..."
                className={cn(
                  'w-full bg-slate-900 border border-slate-700 rounded-xl py-2.5 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors',
                  platform ? 'pl-24' : 'pl-3'
                )}
              />
            </div>
            <button onClick={handlePaste} title="Dán từ clipboard"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-400 hover:text-slate-200 transition-all">
              <Clipboard size={14}/>
            </button>
            <button onClick={handleFetchInfo} disabled={!url.trim() || infoLoading || !ytStatus?.ok}
              className="px-4 py-2 bg-violet-600/20 hover:bg-violet-600/30 disabled:opacity-40 border border-violet-500/30 text-violet-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5">
              {infoLoading ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}
              Lấy info
            </button>
          </div>
          {infoError && <p className="text-xs text-red-400 flex items-start gap-1.5"><AlertCircle size={11} className="mt-0.5 shrink-0"/>{infoError}</p>}
        </div>

        {/* ── Video info card ── */}
        {infoLoading && (
          <div className="flex items-center justify-center py-8 text-slate-500 text-sm gap-2">
            <Loader2 size={16} className="animate-spin"/> Đang lấy thông tin...
          </div>
        )}
        {videoInfo && (
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl overflow-hidden">
            <div className="flex gap-3 p-3">
              {videoInfo.thumbnail && !imgError ? (
                <img src={videoInfo.thumbnail} alt="" onError={() => setImgError(true)}
                  className="w-28 h-16 object-cover rounded-lg shrink-0 bg-slate-800"/>
              ) : (
                <div className="w-28 h-16 bg-slate-800 rounded-lg shrink-0 flex items-center justify-center">
                  <Film size={20} className="text-slate-600"/>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-slate-100 line-clamp-2 leading-tight">{videoInfo.title}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {videoInfo.channel && <span className="text-[11px] text-slate-400">{videoInfo.channel}</span>}
                  {videoInfo.duration > 0 && <span className="text-[11px] text-slate-500">{fmtDuration(videoInfo.duration)}</span>}
                  {videoInfo.viewCount > 0 && <span className="text-[11px] text-slate-600">{fmtViews(videoInfo.viewCount)}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Options ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chất lượng</label>
            <select value={quality} onChange={e => setQuality(e.target.value)} disabled={downloading}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/60 transition-colors disabled:opacity-50">
              {QUALITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Định dạng</label>
            <div className="flex gap-2">
              {[{ v:'mp4', label:'MP4 Video' }, { v:'mp3', label:'MP3 Audio' }].map(f => (
                <button key={f.v} onClick={() => setFormat(f.v)} disabled={downloading}
                  className={cn('flex-1 py-2 rounded-lg text-xs font-bold border transition-all disabled:opacity-50',
                    format === f.v ? 'bg-violet-600/25 border-violet-500/50 text-violet-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500')}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Output folder ── */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Folder size={9}/> Thư mục lưu
          </label>
          <div className="flex gap-2">
            <div className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 font-mono truncate">
              {outputFolder || 'Chưa chọn thư mục'}
            </div>
            <button onClick={handleSelectFolder} disabled={downloading}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 text-xs transition-all disabled:opacity-50">
              <Folder size={13}/>
            </button>
            {outputFolder && (
              <button onClick={() => window.electronAPI?.openFolder?.(outputFolder)} title="Mở thư mục"
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-all">
                <ArrowRight size={13}/>
              </button>
            )}
          </div>
        </div>

        {/* ── Progress ── */}
        {progress && (
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 space-y-2">
            {progress.done ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
                <CheckCircle2 size={16}/> Tải xong!
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 truncate max-w-[60%]">{progress.filename || 'Đang tải...'}</span>
                  <span className="text-slate-300 font-mono font-bold">{progress.percent?.toFixed(1)}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress.percent || 0}%` }}/>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>{progress.speed || ''}</span>
                  <span>{progress.eta ? `ETA ${progress.eta}` : ''}</span>
                  <span>{progress.size || ''}</span>
                </div>
              </>
            )}
          </div>
        )}

        {dlError && (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0"/>
            <p className="text-xs text-red-400">{dlError}</p>
          </div>
        )}

        {/* ── Action button ── */}
        <div className="flex gap-3">
          {downloading ? (
            <button onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-xl text-sm font-bold transition-all">
              <X size={15}/> Huỷ tải
            </button>
          ) : (
            <button onClick={handleDownload} disabled={!canDownload}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-900/30">
              <Download size={15}/> {format === 'mp3' ? 'Tải nhạc MP3' : 'Tải video MP4'}
            </button>
          )}
        </div>

        {/* ── Lịch sử tải ── */}
        {history.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lịch sử tải ({history.length})</span>
              <button onClick={clearHistory} className="text-[10px] text-slate-600 hover:text-red-400 flex items-center gap-1 transition-colors">
                <Trash2 size={9}/> Xoá tất cả
              </button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {history.map(item => {
                const ipm = PLATFORM_META[item.platform || 'other'];
                return (
                  <div key={item.id} className="flex items-center gap-2.5 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 group">
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', ipm.dot)}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-300 truncate">{item.title}</p>
                      <p className="text-[10px] text-slate-600">{item.format?.toUpperCase()} · {item.quality === 'best' ? 'Tốt nhất' : item.quality + 'p'}</p>
                    </div>
                    <button onClick={() => window.electronAPI?.openFolder?.(item.folder)} title="Mở thư mục"
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-all">
                      <Folder size={11}/>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Supported platforms info ── */}
        <div className="border border-slate-800 rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Nền tảng hỗ trợ</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'YouTube',    dot: 'bg-red-500' },
              { label: 'TikTok',     dot: 'bg-pink-500' },
              { label: 'Douyin',     dot: 'bg-orange-400' },
              { label: 'Instagram',  dot: 'bg-purple-500' },
              { label: 'Twitter/X',  dot: 'bg-sky-500' },
              { label: 'Facebook',   dot: 'bg-blue-600' },
              { label: 'Vimeo',      dot: 'bg-teal-500' },
              { label: '1000+ sites',dot: 'bg-slate-500' },
            ].map(p => (
              <span key={p.label} className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-800/50 rounded px-2 py-1">
                <span className={cn('w-1.5 h-1.5 rounded-full', p.dot)}/>{p.label}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'clone',      label: 'Clone Video',   icon: Copy,            color: 'bg-violet-600' },
  { id: 'script',     label: 'Viết Kịch Bản', icon: FileText,        color: 'bg-orange-500' },
  { id: 'prompt',     label: 'Tạo Prompt',    icon: Sparkles,        color: 'bg-emerald-600' },
  { id: 'seo',        label: 'Tạo Seo YTB',   icon: Youtube,         color: 'bg-red-600'    },
  { id: 'viral',      label: 'Viral Video AI', icon: Zap,             color: 'bg-rose-600'   },
  { id: 'downloader', label: 'Tải Video',      icon: TrendingDown,    color: 'bg-blue-600'   },
];

export default function CreatorStudio() {
  const [subTab, setSubTab] = useState('clone');
  const [apiKeys, setApiKeys] = useState(loadSavedKeys);
  const [apiKeysInput, setApiKeysInput] = useState(() => loadSavedKeys().join('\n'));
  const [keysPanelOpen, setKeysPanelOpen] = useState(false);
  const [keysSaved, setKeysSaved] = useState(() => loadSavedKeys().length > 0);
  const [rotateNotif, setRotateNotif] = useState(null); // { fromIdx, toIdx, total, reason }
  const [externalSubject, setExternalSubject] = useState('');
  const [externalPromptParams, setExternalPromptParams] = useState(null);

  const sendToPrompt = (text, params = null) => {
    setExternalSubject(text);
    if (params) setExternalPromptParams(params);
    setSubTab('prompt');
  };

  const saveApiKeys = () => {
    const keys = apiKeysInput.split('\n').map(k => k.trim()).filter(Boolean);
    localStorage.setItem(LS_KEYS, JSON.stringify(keys));
    setApiKeys(keys);
    setKeysSaved(true);
    setKeysPanelOpen(false);
  };

  const handleKeySwitch = useCallback(({ fromIdx, toIdx, total, reason }) => {
    setRotateNotif({ fromIdx, toIdx, total, reason });
    setTimeout(() => setRotateNotif(null), 5000);
  }, []);

  const keyCount = apiKeys.length;

  return (
    <div className="flex flex-col w-full h-full bg-[#0a0f18] text-slate-300">
      {/* Sub-tab nav + multi-key bar */}
      <div className="border-b border-slate-800 shrink-0 bg-[#0d1321]">
        {/* Row 1: tab buttons + key indicator */}
        <div className="h-12 flex items-center gap-1 px-4">
          {SUB_TABS.map(tab => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setSubTab(tab.id)}
                className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all', active ? `${tab.color} text-white shadow-lg` : 'text-slate-400 hover:text-white hover:bg-slate-800')}>
                <Icon size={15}/> {tab.label}
              </button>
            );
          })}
          {/* Multi-key toggle button */}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setKeysPanelOpen(v => !v)}
              className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border', keysPanelOpen ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : keyCount > 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700')}>
              <Key size={12}/>
              {keyCount > 0 ? (
                <span>{keyCount} API Key{keyCount > 1 ? 's' : ''} <Check size={10} className="inline text-emerald-400"/></span>
              ) : (
                <span>Thêm API Key</span>
              )}
              <ChevronDown size={11} className={cn('transition-transform', keysPanelOpen && 'rotate-180')}/>
            </button>
          </div>
        </div>

        {/* Collapsible multi-key panel */}
        {keysPanelOpen && (
          <div className="border-t border-slate-800/60 bg-[#0b1120] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                <Key size={10}/> Gemini API Keys — mỗi key 1 dòng (không giới hạn)
              </span>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer"
                className="text-[10px] text-slate-500 hover:text-blue-400 underline transition-colors">
                Lấy key miễn phí tại aistudio.google.com
              </a>
            </div>
            <div className="flex gap-2 items-start">
              <textarea
                value={apiKeysInput}
                onChange={e => { setApiKeysInput(e.target.value); setKeysSaved(false); }}
                placeholder={'AIza...\nAIza...\n(Mỗi dòng một API Key)'}
                rows={4}
                className="flex-1 bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-amber-500/50 resize-none leading-5"
              />
              <div className="flex flex-col gap-2">
                <button onClick={saveApiKeys}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-[10px] font-bold transition-colors border border-amber-500/30 whitespace-nowrap">
                  <Save size={11}/> Lưu Keys
                </button>
                {keysSaved && keyCount > 0 && (
                  <div className="text-center text-[9px] text-emerald-400 flex items-center justify-center gap-1">
                    <Check size={9}/> {keyCount} key đã lưu
                  </div>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-600">
              🔄 Khi key bị giới hạn (429), hệ thống tự động chuyển sang key tiếp theo. Nên thêm 3–5 keys để đảm bảo không bị gián đoạn.
            </p>
          </div>
        )}
      </div>

      {/* Key rotation toast notification */}
      {rotateNotif && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-amber-500/20 border border-amber-500/40 rounded-xl shadow-2xl backdrop-blur-sm animate-in slide-in-from-bottom-2">
          <RefreshCw size={14} className="animate-spin text-amber-400 shrink-0"/>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-amber-300 font-bold">
              Key {rotateNotif.fromIdx + 1} hết quota → Key {rotateNotif.toIdx + 1}/{rotateNotif.total}
            </span>
            <span className="text-xs text-amber-400/70">
              {rotateNotif.reason === 'quota_exhausted'
                ? 'Hết hạn mức ngày — tự động dùng key tiếp theo'
                : rotateNotif.reason === 'rate_limit_per_minute'
                ? 'Quá giới hạn/phút — chuyển key để tiếp tục ngay'
                : 'Giới hạn API — chuyển sang key tiếp theo'}
            </span>
          </div>
        </div>
      )}

      {/* All panels rendered, shown/hidden via CSS — preserves state + keeps async running */}
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'clone' ? 'flex' : 'none' }}>
        <CloneVideoPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} onSendToPrompt={sendToPrompt} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'script' ? 'flex' : 'none' }}>
        <ScriptWriterPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} onSendToPrompt={sendToPrompt} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'prompt' ? 'flex' : 'none' }}>
        <PromptGeneratorPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} externalSubject={externalSubject} externalPromptParams={externalPromptParams}
          onExternalSubjectConsumed={() => { setExternalSubject(''); setExternalPromptParams(null); }} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'seo' ? 'flex' : 'none', flexDirection: 'column' }}>
        <SeoYTBPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'viral' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ViralVideoPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'downloader' ? 'flex' : 'none', flexDirection: 'column' }}>
        <VideoDownloaderPanel />
      </div>
    </div>
  );
}
