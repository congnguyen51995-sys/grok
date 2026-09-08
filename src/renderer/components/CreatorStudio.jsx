import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { AnimatePresence, motion } from 'motion/react';
import { GoogleGenAI, Type } from '@google/genai';
import { analyzeAndCloneScript } from '../services/geminiClone';
import { generateCinematicPrompts } from '../services/geminiPrompt';
import { retryWithKeyRotation } from '../services/keyRotation';
import { loadClaudeKey, loadClaudeModel, callClaudeWithRetry } from '../services/claudeService';
import { generateCinematicPromptsClaude } from '../services/claudePrompt';
import { loadGroqKeys, loadGroqModel, callGroqWithRotation } from '../services/groqService';
import { generateScriptGroq, generateCinematicPromptsGroq } from '../services/groqPrompt';
import {
  Copy, FileText, Sparkles, Zap, Loader2, Check,
  Youtube, Music, Upload, Download, Key, Eye, EyeOff,
  ChevronRight, Save, AlertCircle, RefreshCw,
  Clapperboard, Send, RotateCcw, Clock, Target,
  Music2, Layout, Globe, User, Sword,
  Lightbulb, Users, PenTool, Languages, ChevronDown,
  Plus, X, Image as ImageIcon, Map, Database, Settings, Film,
  Camera, Volume2, ArrowRight, Hash, Tag, Share2, AlignLeft,
  Link, Clipboard, CheckCircle2, HardDrive, Folder, FolderOpen, Trash2,
  Play, TrendingDown, Mic, Headphones, MessageSquare,
} from 'lucide-react';

function cn(...classes) { return classes.filter(Boolean).join(' '); }

const LS_KEYS = 'fluxy_gemini_api_keys';
const GEMINI_MODEL = 'gemini-3.5-flash'; // default fallback
const CREATOR_GEMINI_MODELS = [
  { id: 'gemini-3.5-flash',        label: '3.5 Flash' },
  { id: 'gemini-3-flash-preview',  label: '3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',   label: '3.1 Flash Lite' },
];

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

async function geminiChatRotating(apiKeys, prompt, maxTokens = 4096, onSwitch, model) {
  const useModel = model || GEMINI_MODEL;
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: useModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: maxTokens,
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

function CloneVideoPanel({ apiKeys, onKeySwitch, onSendToPrompt, geminiModel }) {
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
      setResult(await analyzeAndCloneScript(apiKeys, input, mode, channelTopic, newTopic, onKeySwitch, onProgress, null, null, geminiModel) || '');
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

function ScriptWriterPanel({ apiKeys, onKeySwitch, onSendToPrompt, aiMode = 'gemini', claudeKey, claudeModel, groqKeys = [], groqModel, geminiModel }) {

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

  // ── Unified AI call — routes to Gemini / Claude / Groq ───────────────────
  const callAI = async (prompt, maxTokens = 32768) => {
    if (aiMode === 'groq') {
      if (!groqKeys.length) throw new Error('Chưa có Groq API Key. Vào Settings → API Key → Groq.');
      return callGroqWithRotation(groqKeys, { model: groqModel, system: '', prompt, maxTokens, temperature: 0.8 },
        (info) => onKeySwitch?.({ ...info, total: groqKeys.length }));
    }
    if (aiMode === 'claude') {
      if (!claudeKey) throw new Error('Chưa có Claude API Key. Vào Settings → API Key → Claude.');
      return callClaudeWithRetry({ apiKey: claudeKey, model: claudeModel, system: '', prompt, maxTokens, temperature: 0.8 });
    }
    // Default: Gemini
    return geminiChatRotating(apiKeys, prompt, maxTokens, onKeySwitch, geminiModel);
  };

  const generateContent = async () => {
    if (aiMode === 'gemini'  && !apiKeys?.length)  { setError('Chưa có API Key Gemini. Nhập key ở thanh trên.'); return; }
    if (aiMode === 'claude'  && !claudeKey)          { setError('Chưa có Claude API Key. Vào Settings → API Key → Claude.'); return; }
    if (aiMode === 'groq'    && !groqKeys.length)    { setError('Chưa có Groq API Key. Vào Settings → API Key → Groq.'); return; }
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

          const chunk = await callAI(prompt, 32768);
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
        const text = await callAI(prompt, 8192);
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
    if (aiMode === 'gemini' && !apiKeys?.length) { setError('Chưa có API Key Gemini. Nhập key ở thanh trên.'); return; }
    if (aiMode === 'claude' && !claudeKey)         { setError('Chưa có Claude API Key. Vào Settings.'); return; }
    if (aiMode === 'groq'   && !groqKeys.length)   { setError('Chưa có Groq API Key. Vào Settings.'); return; }
    if (!params.topic.trim()) { setError('Vui lòng nhập chủ đề video.'); return; }
    setIsGeneratingHooks(true); setError(null);
    try {
      const prompt = `Gợi ý 5 phương án Hook (3-5 giây đầu) cực kỳ mạnh mẽ cho video về chủ đề: "${params.topic}". Nền tảng: ${params.platform}. Mục tiêu: ${params.goal}. Giọng điệu: ${params.tone}. Tập trung vào yếu tố văn hóa và sắc tộc đặc trưng.`;
      const hookText = await callAI(prompt, 2048);
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
      const translated = await geminiChatRotating(apiKeys, prompt, 8192, onKeySwitch, geminiModel);
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

function PromptGeneratorPanel({ apiKeys, onKeySwitch, externalSubject, externalPromptParams, onExternalSubjectConsumed, aiMode = 'gemini', claudeKey, claudeModel, groqKeys = [], groqModel, geminiModel }) {

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
    if (aiMode === 'gemini' && !apiKeys?.length) { setError('Chưa có API Key Gemini. Nhập key ở thanh trên.'); return; }
    if (aiMode === 'claude' && !claudeKey)          { setError('Chưa có Claude API Key. Vào Settings → API Key → Claude.'); return; }
    if (aiMode === 'groq'   && !groqKeys.length)    { setError('Chưa có Groq API Key. Vào Settings → API Key → Groq.'); return; }
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
      const result = aiMode === 'groq'
        ? await generateCinematicPromptsGroq(groqKeys, config, onProgress, groqModel)
        : aiMode === 'claude'
        ? await generateCinematicPromptsClaude(claudeKey, config, onProgress, claudeModel)
        : await generateCinematicPrompts(apiKeys, config, onProgress, geminiModel);
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
  { value: 'ko', label: '한국어 🇰🇷' },
];

export async function generateSeoMetadata(apiKeys, content, language, channelName, onSwitch, model, referenceImages = [], options = {}) {
  const useModel = model || GEMINI_MODEL;
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: 'Japanese (日本語)', ko: 'Korean (한국어)' }[language] || 'Tiếng Việt';
    const disclaimer = language === 'vi' ? DISCLAIMER_VI : DISCLAIMER_EN;
    const hasRefImages = referenceImages?.length > 0;

    const langEnforcement = language !== 'vi'
      ? `\n\n⚠️ CRITICAL LANGUAGE RULE — OVERRIDE EVERYTHING ELSE:\nALL output fields (titles, description, tags, thumbnailPrompts.textOnImage, summary, socialPost, keywordResearch.keyword) MUST be written ENTIRELY in ${langLabel.toUpperCase()}.\nDO NOT write any Vietnamese. Every single word of output must be in ${langLabel.toUpperCase()}.\n`
      : '';

    const systemInstruction = `Bạn là một Giám đốc Sáng tạo (Creative Director) và một Chuyên gia tối ưu hóa YouTube (YouTube Growth Specialist) hàng đầu thế giới, chuyên về thiết kế Hình thu nhỏ (Thumbnail) có tỷ lệ nhấp (CTR) cực cao và SEO VidIQ 100/100.${langEnforcement}

  NHIỆM VỤ: Phân tích kịch bản video để tạo ra bộ siêu dữ liệu (metadata) hoàn chỉnh và 3 ý tưởng Thumbnail đỉnh cao.

  ### PHẦN 1: NGUYÊN TẮC VÀNG CỦA THUMBNAIL YOUTUBE (Bạn phải tuân thủ)
  1. Sự Rõ Ràng (Clarity): Hiểu video nói về gì trong 0.5 giây.
  2. Sức Hút Cảm Xúc (Emotional Impact): Tập trung vào biểu cảm khuôn mặt hoặc tình huống kịch tính. Ánh mắt là chìa khóa.
  3. Sự Đối Lập & Tương Phản (Contrast): Màu sắc tương phản mạnh để chủ thể nổi bật.
  4. Bố Cục (Composition): Quy tắc 1/3. Tránh góc dưới bên phải.
  5. Kể Chuyện (Storytelling): Đặt ra câu hỏi (Curiosity Gap).
  6. Phong Cách & Đồ Họa (Style Consistency): TUYỆT ĐỐI PHẢI khớp với phong cách đồ họa, tông màu và không khí mà kịch bản đã mô tả (ví dụ: Cinematic, 2D Animation, 3D Render, Realistic Vlog, v.v.). Không được sai lệch phong cách.
  7. NGHỆ THUẬT NỔI BẬT CHỮ TRÊN THUMBNAIL (TEXT OVERLAY FOR MAX 100 VIDIQ CTR):
     - Nếu kịch bản là CÂU CHUYỆN / TRUYỆN AUDIO / DRAMA / NGÔN TÌNH / TIỂU THUYẾT: Chữ trên Thumbnail PHẢI LÀ CÂU HOOK DÀI TỪ 8 ĐẾN 15 TỪ kịch tính, gây sốc, tò mò cực độ, lột tả mấu chốt cao trào câu chuyện (phong cách các kênh Truyện Audio đỉnh cao như Dâu Dâu Audio, ví dụ: 'TIỂU THƯ! LÀ TÔI... CHIỀU HƯ EM RỒI', 'BỊ TRIỆU TỔNG BƠM SỮA CẢ ĐÊM', 'GỬI NHẦM ÁNH MLEM CHO ANH TRAI NAM CHÍNH', 'BẢO BỐI CHỖ NÀY CỦA EM THẬT NGỌT', 'HỌC BÁ ÂM MƯU LÀM MÁY DẬP CỦA TÔI').
     - Khán giả ĐỌC 0.5 GIÂY LÀ HIỂU NGAY phần nào mấu chốt kịch bản và bị kích thích bấm vào ngay lập tức.
     - Viết HOA các từ trọng tâm/kịch tính/nhạy cảm, dùng dấu ngoặc kép hoặc biểu tượng cảm xúc nếu cần để đạt điểm 100 VidIQ CTR.

  ### PHẦN 2: CHIẾN LƯỢC SEO & PACKAGING
  1. TIÊU ĐỀ (TITLE):
     - Tạo 5 lựa chọn tiêu đề DÀI (khoảng 80 đến 100 ký tự, TỐI ĐA 100 ký tự theo đúng chuẩn YouTube).
     - Tiêu đề phải lột tả sâu sắc, chi tiết và hấp dẫn trọn vẹn nội dung câu chuyện/kịch bản.
     - Kết hợp hoàn hảo giữa Từ khóa SEO có khối lượng tìm kiếm cao (High-Volume Keywords) + Hook tò mò/cảm xúc mạnh mẽ (Curiosity Gap).
     - Đánh giá ĐIỂM VIDIQ cho từng tiêu đề (thang điểm 100, ví dụ: 95/100, 98/100) dựa trên độ dài, mật độ từ khóa và khả năng thu hút click (CTR). Kèm giải thích lý do ngắn gọn.
  2. MÔ TẢ (DESCRIPTION):
     - Đoạn 1: Giới thiệu lôi cuốn chứa từ khóa SEO chính. TUYỆT ĐỐI KHÔNG đề cập tên kênh YouTube gốc, không nhắc đến nguồn gốc video, không ghi "Chào mừng đến với [tên kênh]" hay bất kỳ tên kênh nào.
     - Đoạn 2: Tóm tắt hấp dẫn diễn biến kịch bản/câu chuyện.
     - QUY TẮC BẮT BUỘC VỀ CHAPTERS / TIMESTAMPS:
       * TUYỆT ĐỐI KHÔNG CHÈN TIÊU ĐỀ "📌 NỘI DUNG CHI TIẾT & TIMESTAMPS" HAY BẤT KỲ MỐC THỜI GIAN NÀO (00:00, 01:15, v.v.) NẾU ĐẦU VÀO LÀ KỊCH BẢN THƯỜNG / VĂN BẢN KHÔNG CÓ SRT CHÍNH XÁC. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT / TỰ TẠO MỐC THỜI GIAN!
       * CHỈ ĐƯỢC CHÈN "📌 NỘI DUNG CHI TIẾT & TIMESTAMPS:" KHI VĂN BẢN ĐẦU VÀO CÓ TỆP SRT HOẶC ĐÃ CÓ CÁC MỐC THỜI GIAN CHÍNH XÁC. Khi đó, hãy trích xuất mốc thời gian thực từ SRT + Tên phân đoạn + Tóm tắt ngắn nội dung phân đoạn đó.
     - Đoạn tiếp theo: 3-5 Hashtags + Tuyên bố miễn trừ trách nhiệm (Disclaimer) bắt buộc: "${disclaimer}"
  3. THẺ TAGS (SEO TAGS): Tối đa 500 ký tự, ngăn cách bằng dấu phẩy. Bao gồm từ khóa chính, rộng và đuôi dài.

  ### PHẦN 3: CÁCH TẠO PROMPT HÌNH ẢNH${options.contentType === 'story' ? ` — CHẾ ĐỘ TRUYỆN AUDIO (TEXT-FIRST VIRAL)` : ''}
  Với mỗi ý tưởng, bạn phải tạo ra 2 phiên bản prompt tiếng Anh ĐỒNG NHẤT về nội dung hình ảnh:
  1. **Prompt Without Text (Không chữ):** Đây là prompt gốc, tập trung 100% vào mô tả hình ảnh, bối cảnh, nhân vật và phong cách.
  2. **Prompt With Text (Có chữ):** Phải lấy TOÀN BỘ nội dung của Prompt Without Text và bổ sung chỉ dẫn thiết kế chữ hook câu chuyện (8-15 từ) nổi bật ở vị trí chiến lược:
     - Thêm chỉ dẫn ở cuối prompt: "... featuring a prominent stylized notebook page, decorative text panel, or bold graphic text card overlay on one side of the image, containing the large bold high-contrast Vietnamese text reading \\"[TEXT_ON_IMAGE]\\" in eye-catching typography with highlighted keywords, making the story hook immediately clear and readable at a glance for maximum 100 VidIQ CTR impact."

  Mục tiêu: Hai prompt phải mô tả cùng một khung cảnh, chỉ khác nhau là có thêm chữ hay không.

${options.contentType === 'story' ? `  ⚡ CHẾ ĐỘ TRUYỆN AUDIO — NGUYÊN TẮC THUMBNAIL VIRAL NGÁCH NÀY:
  Thumbnail truyện audio viral trên YouTube Việt Nam KHÁC HOÀN TOÀN với video thông thường:
  1. **CHỮ LÀ CHỦ ĐẠO (60–70% diện tích)**: Hook text cực lớn, bold, màu VÀNG hoặc TRẮNG phát sáng trên nền tối. Đây là yếu tố click đầu tiên.
  2. **NỀN ĐƠN GIẢN, TÔNG TỐI**: Gradient đen-tím, đen-đỏ thẫm, hoặc tranh minh họa semi-realistic/webtoon mờ làm backdrop. KHÔNG dùng photorealistic phức tạp.
  3. **NHÂN VẬT (nếu có) là phụ**: Silhouette, bóng mờ, hoặc minh họa đơn giản ở cạnh/góc. KHÔNG cần close-up chi tiết mặt.
  4. **MÀU SẮC DRAMA**: Đen + Vàng ánh, Đen + Đỏ thẫm, Tím tối + Ánh vàng. Tránh màu sáng/pastel.
  5. **ĐỌC ĐƯỢC TRÊN MOBILE SIZE NHỎ**: Layout cực kỳ thoáng, chữ hook chiếm phần lớn, không nhét quá nhiều chi tiết.
  6. **PHONG CÁCH ĐỒ HỌA**: Flat illustration, webtoon style, semi-realistic digital painting, hoặc dark atmospheric art — KHÔNG photorealistic 8K.
  7. **HOOK TEXT (textOnImage)**: Phải là câu/cụm từ gây tò mò/shock/drama mạnh nhất của truyện, dạng "Anh ta đã... khi biết sự thật" / "Bí mật kinh hoàng của..." / "Cô ấy không ngờ rằng...".

  Cấu trúc prompt cho truyện audio:
  - Background: Dark atmospheric gradient (deep black to [color matching story mood]), optionally with a blurred semi-realistic scene from the story.
  - Typography area: Large dominant text zone taking up majority of the image, with glowing/outlined bold Vietnamese hook text.
  - Character (optional): Simple silhouette or stylized flat illustration figure at edge, conveying emotion (fear, shock, sadness, love).
  - Mood lighting: Dramatic rim light, glowing text reflection on dark surface, ethereal glow.
  - Style: Dark webtoon illustration / flat digital art / dark atmospheric graphic design — NOT photorealistic.
  - Aspect ratio: 16:9 YouTube thumbnail optimized.` : `  Cấu trúc chung (Base Description):
  - Subject (Chủ thể): PHẢI TRÍCH XUẤT CHÍNH XÁC nhân vật chính từ kịch bản/JSON/Prompt đầu vào. Bạn phải mô tả ĐÚNG VÀ ĐỦ các đặc điểm ngoại hình (màu tóc, trang phục, phụ kiện, vóc dáng) đã được miêu tả sẵn. TUYỆT ĐỐI KHÔNG được tự ý thêm thắt hoặc tạo ra một nhân vật ngẫu nhiên khác với mô tả. Nếu kịch bản không mô tả chi tiết, hãy dựa vào ngữ cảnh của kịch bản để tạo ra nhân vật phù hợp nhất nhưng vẫn phải nhất quán xuyên suốt 3 ý tưởng. Nếu nhân vật dính bản quyền hoặc là người thật, hãy mô tả đặc điểm ngoại hình một cách chi tiết nhưng không dùng tên riêng (theo PHẦN 4).
  - Environment (Bối cảnh): Nơi diễn ra, Bokeh (làm mờ nền).
  - Lighting (Ánh sáng): Cinematic, Dramatic, High Contrast.
  - Camera Angle (Góc máy): Close-up hoặc Medium Shot.
  - Quality Style: Phải trích xuất chính xác phong cách đồ họa từ kịch bản (ví dụ: Photorealistic, 8k, Unreal Engine 5, Pixar style, Studio Ghibli style, v.v.).`}

  ### PHẦN 4: CHÍNH SÁCH AN TOÀN HÌNH ẢNH (BẮT BUỘC TUÂN THỦ)
  Bạn TUYỆT ĐỐI KHÔNG được tạo prompt vi phạm các quy tắc sau:
  1. Không bóc lột/lạm dụng trẻ em (CSAM): Không tình dục hóa hoặc đặt trẻ em vào bối cảnh nhạy cảm.
  2. Không Deepfake nhân vật công chúng & Bản quyền (Copyright):
     - TUYỆT ĐỐI KHÔNG sử dụng tên thật của người nổi tiếng, chính trị gia hoặc tên các nhân vật có bản quyền (ví dụ: Hulk, Spiderman, Iron Man, v.v.) trong prompt.
     - Cách xử lý: Thay thế bằng mô tả đặc điểm chung. Đối với siêu anh hùng, hãy thay đổi màu sắc trang phục và chi tiết ngoại hình khác đi so với bản gốc.
     - Sử dụng phong cách "Cinematic Illustration" hoặc "Digital Art" để đảm bảo tính sáng tạo và an toàn pháp lý.
  3. Không nội dung khiêu dâm: Không khỏa thân, không tư thế gợi dục.
  4. Không bạo lực máu me: Không nội tạng, vết thương nghiêm trọng, hoặc ngược đãi động vật/người.
  5. Không kích động thù địch: Không tấn công dựa trên chủng tộc, tôn giáo, giới tính.
  6. Không thông tin sai lệch: Không giả mạo thảm họa, chiến tranh hoặc bầu cử.

  ### PHẦN 5: NGHIÊN CỨU TỪ KHÓA (8-12 từ khóa)
  - Từ khóa chính (main): 2-3 từ, volume Very High / High
  - Từ khóa rộng (broad): 3-5 từ, volume Medium+
  - Từ khóa đuôi dài (longtail): 5+ từ, competition Low
  Đánh giá volume: Very High / High / Medium / Low. Competition: Low / Medium / High.

  QUY TẮC CỐT LÕI:
  - Ngôn ngữ: ${langLabel.toUpperCase()}.
  - Kênh: ${channelName || 'Của tôi'}.
  - Viết cho CON NGƯỜI click nhưng cấu trúc cho MÁY xếp hạng.
  - TRUNG THÀNH NỘI DUNG GỐC (BẮT BUỘC): Nếu đầu vào là tiêu đề video / URL / mô tả ngắn (KHÔNG phải kịch bản/truyện đầy đủ), tiêu đề, mô tả và thumbnail PHẢI BÁM SÁT đúng chủ đề và nội dung thực tế của video đó. TUYỆT ĐỐI KHÔNG bịa đặt hoặc sáng tác nội dung drama/câu chuyện/ngôn tình không có trong video. Ví dụ: video timelapse nông trại → tiêu đề phải về nông trại/timelapse; video parkour → tiêu đề phải về parkour. Sai chủ đề = thất bại hoàn toàn.`;

    const parts = [];
    if (hasRefImages) {
      for (const img of referenceImages) {
        const base64Data = img.base64 || (img.dataUrl?.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl);
        if (base64Data) parts.push({ inlineData: { data: base64Data, mimeType: img.mimeType || 'image/jpeg' } });
      }
      parts.push({ text: `Đây là ${referenceImages.length} ảnh tham chiếu cho phong cách thumbnail.\n\n` });
    }
    const langReminder = language !== 'vi' ? `\n\n[REMINDER: Write ALL output in ${langLabel.toUpperCase()} only. No Vietnamese.]` : '';
    const isSRT = /^\d+\r?\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(content);
    const contentPrefix = isSRT
      ? `⚠️ ĐÂY LÀ FILE SRT CÓ TIMESTAMPS CHÍNH XÁC. BẮT BUỘC phải tạo mục "📌 NỘI DUNG CHI TIẾT & TIMESTAMPS:" trong mô tả bằng cách nhóm các cue SRT theo chủ đề/phân đoạn (mỗi 5-10 phút 1 chapter), lấy timestamp bắt đầu của nhóm đó theo định dạng HH:MM:SS, và đặt tên chapter phù hợp nội dung. Ít nhất 5 chapters, tối đa 15.\n\nNỘI DUNG SRT:\n`
      : `Kịch bản/Ý tưởng:\n`;
    parts.push({ text: `Phân tích và tối ưu Packaging cho kịch bản (Kênh: ${channelName || 'Của tôi'}):\n\n${contentPrefix}${content}${langReminder}` });

    const response = await ai.models.generateContent({
      model: useModel,
      contents: [{ parts }],
      config: {
                maxOutputTokens: 6144,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['titles', 'description', 'tags', 'thumbnailPrompts', 'summary', 'socialPost', 'keywordResearch'],
          properties: {
            titles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ['title', 'score', 'reasoning'],
                properties: {
                  title:     { type: Type.STRING },
                  score:     { type: Type.NUMBER },
                  reasoning: { type: Type.STRING },
                }
              }
            },
            description:  { type: Type.STRING },
            tags:         { type: Type.STRING },
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
            keywordResearch: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ['keyword', 'volume', 'competition', 'type'],
                properties: {
                  keyword:     { type: Type.STRING },
                  volume:      { type: Type.STRING },
                  competition: { type: Type.STRING },
                  type:        { type: Type.STRING },
                }
              }
            },
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

export async function generateThumbnailPromptsOnly(apiKeys, content, language, channelName, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const langLabel = { vi: 'Tiếng Việt', en: 'English', ja: 'Japanese (日本語)', ko: 'Korean (한국어)' }[language] || 'Tiếng Việt';
    const systemInstruction = `Bạn là Creative Director chuyên Thumbnail YouTube CTR cao.

### NGUYÊN TẮC THUMBNAIL
1. Rõ ràng trong 0.5 giây.
2. Sức hút cảm xúc: khuôn mặt hoặc tình huống kịch tính.
3. Đối lập màu sắc mạnh.
4. Bố cục quy tắc 1/3, tránh góc dưới phải.
5. Curiosity Gap — đặt câu hỏi.
6. Phong cách PHẢI khớp kịch bản.

### PROMPT THUMBNAIL (3 ý tưởng, 2 phiên bản prompt tiếng Anh mỗi ý):
- promptWithoutText: 100% mô tả hình ảnh, bối cảnh, nhân vật, phong cách, ánh sáng cinematic.
- promptWithText: lấy toàn bộ Without Text, thêm mô tả chữ vào cuối.
- textOnImage: chữ ngắn gọn bằng ${langLabel.toUpperCase()} xuất hiện trên thumbnail.

CHÍNH SÁCH: Không CSAM, deepfake, bạo lực máu me. Kênh = ${channelName || 'Của tôi'}.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ parts: [{ text: `Tạo 3 ý tưởng thumbnail cho nội dung sau (Kênh: ${channelName || 'Của tôi'}):\n\n${content}` }] }],
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['thumbnailPrompts'],
          properties: {
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
            }
          }
        },
        systemInstruction,
      }
    });
    const text = response?.text || '';
    if (!text) throw new Error('AI trả về rỗng.');
    return JSON.parse(text);
  }, apiKeys, { onSwitch });
}

export async function analyzeThumbImageToPrompt(apiKeys, imageBase64, mimeType, removeText, geminiModel, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const useModel = geminiModel || GEMINI_MODEL;
    const txt = removeText
      ? 'Analyze this image and write a highly detailed English prompt for AI image generation. Exclude all text, captions, overlays, subtitles, and watermarks. Focus only on scenery, characters, style, atmosphere, and visual layout.'
      : 'Analyze this image and write a highly detailed English prompt for AI image generation. Describe composition, characters, colors, mood, style, and any text or graphics precisely so we can reconstruct this thumbnail.';
    const cleanData = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const res = await ai.models.generateContent({
      model: useModel,
      contents: [{ parts: [{ inlineData: { data: cleanData, mimeType: mimeType || 'image/jpeg' } }, { text: txt }] }],
      config: { ...(useModel === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    });
    return res.text?.trim() || '';
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

function SeoYTBPanel({ apiKeys, onKeySwitch, geminiModel }) {
  const [channelName, setChannelName] = useState('');
  const [content, setContent]         = useState('');
  const [language, setLanguage]       = useState('vi');
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState('');
  const [metadata, setMetadata]       = useState(null);

  // Thumbnail state
  const [selThumb, setSelThumb]           = useState(0);
  const [showText, setShowText]           = useState(true);
  const [thumbImages, setThumbImages]     = useState({});
  const [genImgIdx, setGenImgIdx]         = useState(null);
  const [thumbFolder, setThumbFolder]     = useState(() => localStorage.getItem('fluxy_seo_thumb_folder') || '');
  const [imgError, setImgError]           = useState('');
  const [activePrompts, setActivePrompts] = useState([]);

  // Reference images (inside thumbnail section)
  const [refImages, setRefImages]     = useState([]);
  const refImgInputRef                = useRef(null);

  // Refinement
  const [refineInput, setRefineInput]   = useState('');
  const [isRefining, setIsRefining]     = useState(false);
  const [refineError, setRefineError]   = useState('');

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

  const handleAddRefImages = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.slice(0, 5 - refImages.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result;
        if (!dataUrl) return;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        setRefImages(prev => prev.length < 5 ? [...prev, { id: Date.now() + Math.random(), dataUrl, base64, mimeType: file.type || 'image/jpeg', fileName: file.name }] : prev);
      };
      reader.readAsDataURL(file);
    });
    if (refImgInputRef.current) refImgInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!apiKeys?.length) { setError('Chưa có API Key. Vui lòng thêm key Gemini ở thanh trên.'); return; }
    if (!content.trim())  { setError('Vui lòng nhập kịch bản hoặc ý tưởng.'); return; }
    setIsLoading(true); setError(''); setMetadata(null); setThumbImages({}); setImgError(''); setActivePrompts([]);
    try {
      const result = await generateSeoMetadata(apiKeys, content, language, channelName, onSwitch, geminiModel, refImages);
      setMetadata(result);
      setActivePrompts(result.thumbnailPrompts || []);
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

  const handleRefinePrompt = async () => {
    if (!refineInput.trim() && refImages.length === 0) return;
    if (!activePrompts[selThumb]) return;
    setIsRefining(true); setRefineError('');
    try {
      const cur = activePrompts[selThumb];
      const refImgParts = refImages.map(img => ({ inlineData: { data: img.base64, mimeType: img.mimeType || 'image/jpeg' } }));
      const refNote = refImages.length > 0 ? `\n\nĐÃ KÈM ${refImages.length} ẢNH THAM CHIẾU: Phân tích chi tiết hình ảnh, màu sắc, nhân vật, phong cách từ ảnh và đưa vào cả 2 bản prompt mới.` : '';
      const parts = [
        ...refImgParts,
        { text: `Bạn là Creative Director & Prompt Engineer chuyên Thumbnail YouTube CTR 100/100.\nChỉnh sửa Prompt Thumbnail theo yêu cầu${refImages.length > 0 ? ' và ảnh tham chiếu' : ''}.\n\nPROMPT HIỆN TẠI:\n- Concept: ${cur.concept}\n- textOnImage: "${cur.textOnImage}"\n- promptWithText: "${cur.promptWithText}"\n- promptWithoutText: "${cur.promptWithoutText}"${refNote}\n\nYÊU CẦU: "${refineInput.trim() || 'Phân tích ảnh tham chiếu và tích hợp phong cách vào prompt'}"\n\nTạo lại 2 phiên bản prompt (có chữ và không chữ) bằng tiếng Anh. Trả JSON gồm: concept, promptWithText, promptWithoutText, textOnImage.` }
      ];
      const result = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const resp = await ai.models.generateContent({
          model: geminiModel || GEMINI_MODEL,
          contents: [{ parts }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              required: ['concept', 'promptWithText', 'promptWithoutText', 'textOnImage'],
              properties: {
                concept: { type: Type.STRING },
                promptWithText: { type: Type.STRING },
                promptWithoutText: { type: Type.STRING },
                textOnImage: { type: Type.STRING },
              }
            }
          }
        });
        return JSON.parse(resp.text || '{}');
      }, apiKeys, { onSwitch });
      const updated = [...activePrompts];
      updated[selThumb] = result;
      setActivePrompts(updated);
      setRefineInput('');
    } catch (err) {
      setRefineError(err?.message || 'Không thể tinh chỉnh prompt. Thử lại.');
    } finally {
      setIsRefining(false);
    }
  };

  const handleGenImage = async (promptIdx, withText) => {
    if (!thumbFolder) { setImgError('Vui lòng chọn thư mục lưu ảnh trước.'); return; }
    const key = `${promptIdx}-${withText ? 'text' : 'clean'}`;
    setGenImgIdx(key); setImgError('');
    try {
      const thumb = activePrompts[promptIdx] || metadata?.thumbnailPrompts?.[promptIdx];
      const prompt = withText ? thumb.promptWithText : thumb.promptWithoutText;
      const taskId = `seo_thumb_${Date.now()}`;
      const result = await window.electronAPI.runVeo({
        mediaType: 'Image',
        tasks: [{ id: taskId, prompt: `${prompt}, no text overlay, no watermark, 16:9 thumbnail, high quality.` }],
        aspectRatio: '16:9', model: 'Nano Banana Pro', genCount: '1x', quality: '1080p',
        outputFolder: thumbFolder, duration: null,
      });
      const file = (result?.files || []).find(f => !f.isError && f.filePath);
      if (!file) throw new Error(result?.files?.[0]?.error || 'Không tạo được ảnh thumbnail.');
      const raw = await window.electronAPI.readFileBase64?.(file.filePath);
      if (raw) setThumbImages(prev => ({ ...prev, [key]: `data:image/png;base64,${raw}` }));
      else throw new Error('Không đọc được file ảnh.');
    } catch (err) {
      setImgError(err?.message || 'Không thể tạo ảnh. Thử lại sau.');
    } finally {
      setGenImgIdx(null);
    }
  };

  const currentThumb = (activePrompts[selThumb]) || metadata?.thumbnailPrompts?.[selThumb];
  const currentImgKey = `${selThumb}-${showText ? 'text' : 'clean'}`;
  const currentImageUrl = thumbImages[currentImgKey];
  const isGenImgCurrent = genImgIdx === currentImgKey;
  const displayPrompts = activePrompts.length > 0 ? activePrompts : (metadata?.thumbnailPrompts || []);

  const volColor  = v => ({ 'Very High': '#22c55e', High: '#86efac', Medium: '#fbbf24', Low: '#94a3b8' }[v] || '#94a3b8');
  const compColor = c => ({ Low: '#22c55e', Medium: '#fbbf24', High: '#f87171' }[c] || '#94a3b8');
  const typeColor = t => ({ main: '#818cf8', broad: '#38bdf8', longtail: '#f472b6' }[t] || '#94a3b8');
  const typeLabel = t => ({ main: 'Chính', broad: 'Rộng', longtail: 'Long-tail' }[t] || t);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0f1524] px-6 py-6">
      <div className="max-w-7xl mx-auto">
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
                <input type="file" ref={fileRef} onChange={handleFileUpload} accept=".txt,.md,.doc,.docx,.srt" className="hidden"/>
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
                  <textarea value={content} onChange={e => setContent(e.target.value)} rows={12}
                    placeholder="Dán kịch bản hoặc tải file .txt lên..."
                    className="w-full px-3 py-2.5 bg-[#0a1020] border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/60 transition-all resize-none"/>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ngôn ngữ</label>
                  <select value={language} onChange={e => setLanguage(e.target.value)}
                    className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50">
                    {SEO_LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
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
                {/* Keyword Research */}
                {(metadata.keywordResearch || []).length > 0 && (
                  <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400"><Database size={14}/></div>
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Keyword Research & Phân tích SEO</h3>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">{metadata.keywordResearch.length} từ khóa</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="text-left py-2 px-3 text-slate-500 font-semibold uppercase tracking-wider">Từ khóa</th>
                            <th className="text-center py-2 px-3 text-slate-500 font-semibold uppercase tracking-wider">Loại</th>
                            <th className="text-center py-2 px-3 text-slate-500 font-semibold uppercase tracking-wider">Volume</th>
                            <th className="text-center py-2 px-3 text-slate-500 font-semibold uppercase tracking-wider">Cạnh tranh</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(metadata.keywordResearch || []).map((kw, i) => (
                            <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                              <td className="py-2.5 px-3 text-slate-200 font-medium">{kw.keyword}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border" style={{ color: typeColor(kw.type), borderColor: typeColor(kw.type) + '44', backgroundColor: typeColor(kw.type) + '18' }}>{typeLabel(kw.type)}</span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-bold" style={{ color: volColor(kw.volume) }}>{kw.volume}</td>
                              <td className="py-2.5 px-3 text-center font-bold" style={{ color: compColor(kw.competition) }}>{kw.competition}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Titles with VidIQ scores */}
                <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><Sparkles size={14}/></div>
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">5 Lựa chọn Tiêu đề (High-CTR & VidIQ)</h3>
                    </div>
                    <button onClick={() => navigator.clipboard.writeText((metadata.titles || []).map(t => typeof t === 'object' ? t.title : t).join('\n'))}
                      className="p-1.5 bg-slate-800/60 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-400 hover:text-indigo-400 transition-colors">
                      <Copy size={13}/>
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(metadata.titles || []).map((titleObj, idx) => {
                      const titleText = typeof titleObj === 'object' ? titleObj.title : titleObj;
                      const score = typeof titleObj === 'object' ? titleObj.score : null;
                      const reasoning = typeof titleObj === 'object' ? titleObj.reasoning : null;
                      const scoreColor = score >= 90 ? '#22c55e' : score >= 75 ? '#fbbf24' : '#f87171';
                      const charCount = titleText?.length || 0;
                      return (
                        <div key={idx} className="p-4 bg-slate-800/60 rounded-xl border border-slate-700/80 group hover:border-indigo-500/60 transition-all">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-grow">
                              <span className="w-7 h-7 bg-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center text-xs font-bold border border-indigo-500/30 mt-0.5 shrink-0">{idx+1}</span>
                              <div className="space-y-1.5 flex-grow">
                                <p className="text-slate-100 font-semibold text-base leading-snug">{titleText}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  {score != null && (
                                    <span className="inline-flex items-center gap-1 font-bold px-2.5 py-0.5 rounded-md border" style={{ color: scoreColor, borderColor: scoreColor + '44', backgroundColor: scoreColor + '18' }}>
                                      ⚡ VidIQ: {score}/100
                                    </span>
                                  )}
                                  <span className={cn('inline-flex items-center font-medium px-2 py-0.5 rounded-md border text-[11px]',
                                    charCount > 100 ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-slate-700/50 text-slate-300 border-slate-600')}>
                                    {charCount}/100 ký tự
                                  </span>
                                </div>
                                {reasoning && <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-indigo-400 font-bold">💡</span> {reasoning}</p>}
                              </div>
                            </div>
                            <button onClick={() => navigator.clipboard.writeText(titleText)}
                              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all opacity-0 group-hover:opacity-100">
                              Copy
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Description */}
                <SeoMetaCard title="Mô tả SEO (Chuẩn VidIQ & Disclaimer)" icon={<AlignLeft size={14}/>} copyText={metadata.description}>
                  <p className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap">{metadata.description}</p>
                </SeoMetaCard>

                {/* Thumbnails — matches web app layout */}
                <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><ImageIcon size={14}/></div>
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ý tưởng Thumbnail (Creative Director)</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {displayPrompts.map((t, idx) => (
                        <button key={idx} onClick={() => setSelThumb(idx)}
                          className={cn('px-3 py-1.5 rounded-md text-[10px] font-bold transition-all border',
                            selThumb === idx
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/20'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700')}>
                          {t.concept || `Option ${idx+1}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-center bg-slate-800/30 p-1 rounded-lg border border-slate-700/50 w-fit mx-auto">
                      {[['text', 'Có chữ (Auto Text)'], ['clean', 'Không chữ (Clean)']].map(([mode, label]) => (
                        <button key={mode} onClick={() => setShowText(mode === 'text')}
                          className={cn('px-4 py-1.5 rounded-md text-[10px] font-bold transition-all',
                            (mode === 'text') === showText ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200')}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {currentThumb && (
                      <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">{currentThumb.concept}</span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase">{showText ? 'Mode: With Typography' : 'Mode: Image Only'}</span>
                        </div>
                        <p className="text-slate-300 text-sm italic mb-3 leading-relaxed">
                          {showText ? currentThumb.promptWithText : currentThumb.promptWithoutText}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">Text on Image:</span>
                          <span className="text-sm font-bold text-white uppercase tracking-tighter">"{currentThumb.textOnImage}"</span>
                        </div>
                        <button onClick={() => navigator.clipboard.writeText(showText ? currentThumb.promptWithText : currentThumb.promptWithoutText)}
                          className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1">
                          <Copy size={12}/> Copy {showText ? 'With Text' : 'Clean'} Prompt
                        </button>
                      </div>
                    )}

                    {/* Reference images (inside thumbnail section) */}
                    <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className="text-cyan-400 bg-cyan-500/10 p-1.5 rounded-md"><ImageIcon size={14} className="text-cyan-400"/></div>
                          <div>
                            <span className="text-xs font-bold text-slate-200">Ảnh Tham Chiếu Tạo Prompt & Thumbnail</span>
                            <span className="ml-2 text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded font-bold border border-cyan-500/20">{refImages.length}/5 ảnh</span>
                          </div>
                        </div>
                        {refImages.length < 5 && (
                          <button onClick={() => refImgInputRef.current?.click()}
                            className="px-3 py-1.5 text-xs font-bold text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-lg border border-cyan-500/30 flex items-center gap-1.5 transition-all">
                            <Plus size={12}/> Thêm ảnh ({5 - refImages.length} slot)
                          </button>
                        )}
                        <input ref={refImgInputRef} type="file" multiple accept="image/*" onChange={handleAddRefImages} className="hidden"/>
                      </div>
                      <p className="text-[11px] text-slate-400 italic leading-relaxed">Tải lên tối đa 5 ảnh mẫu. AI phân tích bố cục, nhân vật, màu sắc và kiểu chữ để đưa vào Prompt và tinh chỉnh Thumbnail.</p>
                      {refImages.length > 0 && (
                        <div className="grid grid-cols-5 gap-2">
                          {refImages.map(img => (
                            <div key={img.id} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-900 aspect-video">
                              <img src={img.dataUrl} alt={img.fileName} className="w-full h-full object-cover"/>
                              <button onClick={() => setRefImages(prev => prev.filter(i => i.id !== img.id))}
                                className="absolute top-1 right-1 bg-red-600/90 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all">
                                <X size={10}/>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Refinement */}
                    <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700 space-y-3">
                      <div className="flex items-center gap-2">
                        <PenTool size={14} className="text-amber-400"/>
                        <span className="text-xs font-bold text-slate-200">Yêu cầu sửa / thêm bớt chi tiết cho Prompt này:</span>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={refineInput} onChange={e => setRefineInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRefinePrompt()}
                          placeholder="VD: Thêm ánh sáng kịch tính, đổi text thành 'SỰ THẬT BỊ BỎ RƠI'..."
                          className="flex-1 bg-slate-900 text-slate-100 text-xs px-3 py-2.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"/>
                        <button onClick={handleRefinePrompt}
                          disabled={isRefining || (!refineInput.trim() && refImages.length === 0)}
                          className={cn('px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap',
                            isRefining || (!refineInput.trim() && refImages.length === 0)
                              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 shadow-md active:scale-95')}>
                          {isRefining ? <><Loader2 size={12} className="animate-spin"/> Đang chỉnh...</> : <><Zap size={12}/> {refImages.length > 0 && !refineInput.trim() ? 'Phân tích ảnh & Cập nhật' : 'Cập nhật Prompt'}</>}
                        </button>
                      </div>
                      {refineError && <p className="text-red-400 text-xs">{refineError}</p>}
                    </div>

                    {/* Generate image */}
                    <div className="flex items-center gap-2">
                      <button onClick={async () => { const f = await window.electronAPI?.selectFolder?.(); if (f) { setThumbFolder(f); localStorage.setItem('fluxy_seo_thumb_folder', f); } }}
                        className="shrink-0 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-[10px] text-slate-400 font-bold flex items-center gap-1.5 transition-colors">
                        <FolderOpen size={12}/> {thumbFolder ? thumbFolder.split(/[\\/]/).pop() : 'Chọn thư mục'}
                      </button>
                      <button onClick={() => handleGenImage(selThumb, showText)} disabled={isGenImgCurrent || !thumbFolder}
                        className={cn('flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
                          isGenImgCurrent || !thumbFolder
                            ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:scale-95')}>
                        {isGenImgCurrent
                          ? <><Loader2 size={15} className="animate-spin"/> Đang tạo ảnh...</>
                          : <><ImageIcon size={15}/> Tạo ảnh (Nano Banana Pro)</>}
                      </button>
                    </div>

                    {imgError && (
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-2.5">
                        <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5"/>
                        <p className="text-[10px] text-red-300">{imgError}</p>
                      </div>
                    )}
                    {currentImageUrl && (
                      <div className="relative group rounded-2xl overflow-hidden border border-slate-700 bg-[#0a1020] shadow-2xl">
                        <img src={currentImageUrl} alt="Generated Thumbnail" className="w-full h-auto object-cover"/>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                          <a href={currentImageUrl} download="thumbnail.png"
                            className="flex items-center gap-2 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
                            <Download size={14}/> Tải ảnh xuống
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <SeoMetaCard title="Thẻ Tags SEO (Copy/Paste)" icon={<Hash size={14}/>} copyText={metadata.tags}>
                  <div className="flex flex-wrap gap-1.5">
                    {(metadata.tags || '').split(',').map(t => t.trim()).filter(Boolean).map((tag, idx) => (
                      <span key={idx} className="bg-[#0a1020] text-indigo-300 text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-slate-700 hover:border-indigo-500/30 transition-colors">#{tag}</span>
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

async function analyzeViralSegments(apiKey, base64Video, mimeType = 'video/mp4', model) {
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

  const useModel = model || GEMINI_MODEL;
  const response = await ai.models.generateContent({
    model: useModel,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64Video } },
        { text: prompt }
      ]
    }],
    config: {
      maxOutputTokens: 2048,
          }
  });

  let text = response?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini không trả về JSON hợp lệ');
  return JSON.parse(jsonMatch[0]);
}

const VIRAL_SEO_LANGS = [
  { code: 'vi', label: '🇻🇳 Tiếng Việt' },
  { code: 'en', label: '🇺🇸 English' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'ko', label: '🇰🇷 한국어' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'pt', label: '🇧🇷 Português' },
  { code: 'id', label: '🇮🇩 Indonesia' },
];

function ViralVideoPanel({ apiKeys, onKeySwitch, geminiModel }) {
  const [videoPath, setVideoPath]       = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [aspectRatio, setAspectRatio]   = useState('9:16');
  const [segDuration, setSegDuration]   = useState(30); // seconds
  const [isBusy, setIsBusy]             = useState(false);
  const [phase, setPhase]               = useState('idle'); // idle | proxy | analyze | cut | done
  const [results, setResults]           = useState([]); // [{ index, title, reason, viralScore, startTime, endTime, outputPath?, error?, seo? }]
  const [log, setLog]                   = useState('');
  const [error, setError]               = useState('');
  const [seoLang, setSeoLang]           = useState(() => localStorage.getItem('viral_seo_lang') || 'vi');
  const [seoEnabled, setSeoEnabled]     = useState(() => localStorage.getItem('viral_seo_enabled') !== 'false');

  const logRef = useRef(null);
  const addLog = (msg) => {
    setLog(prev => {
      const next = prev ? prev + '\n' + msg : msg;
      // Giữ tối đa 300 dòng
      const lines = next.split('\n');
      return lines.length > 300 ? lines.slice(-300).join('\n') : next;
    });
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
        (key) => analyzeViralSegments(key, proxyRes.base64, 'video/mp4', geminiModel),
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
          const segResult = { ...seg, startTime, endTime, outputPath: res.outputPath, success: true };

          // Tạo SEO metadata ngay sau khi cắt xong đoạn này
          if (seoEnabled && apiKeys?.length) {
            try {
              addLog(`🔍 Tạo SEO đoạn ${i + 1}...`);
              const content = `Tiêu đề clip: ${seg.title}\nLý do viral: ${seg.reason || ''}\nViralScore: ${seg.viralScore || ''}\nThời điểm: ${startTime}s–${endTime}s`;
              const onSeoSwitch = ({ fromIdx, toIdx, total }) => addLog(`[SEO] Key ${fromIdx+1}→${toIdx+1}/${total}`);
              const seoResult = await generateSeoMetadata(apiKeys, content, seoLang, '', onSeoSwitch, geminiModel);
              segResult.seo = seoResult;

              // Ghi _metadata.txt cạnh file video
              try {
                const titles   = seoResult?.titles || [];
                const tagsRaw  = typeof seoResult?.tags === 'string' ? seoResult.tags : (seoResult?.tags || []).join(', ');
                const tagsStr  = tagsRaw.length > 500 ? tagsRaw.slice(0, 497) + '...' : tagsRaw;
                const thumbObjs = seoResult?.thumbnailPrompts || [];
                const lines = [
                  `================================================================`,
                  `  METADATA YOUTUBE — VIRAL CLIP ${i + 1}`,
                  `================================================================`,
                  ``,
                  `📌 TIÊU ĐỀ (${titles.length} lựa chọn):`,
                  ...titles.map((t, idx) => `  ${idx + 1}. ${typeof t === 'object' ? t.title : t}`),
                  ``,
                  `📝 MÔ TẢ / SEO DESCRIPTION:`,
                  seoResult?.description || '',
                  ``,
                  `🏷️ TAGS (≤500 ký tự):`,
                  tagsStr,
                  ``,
                  `🖼️ THUMBNAIL CONCEPTS:`,
                  ...thumbObjs.flatMap((obj, idx) => [
                    `  ${idx + 1}. ${obj.concept || ''}`,
                    obj.promptWithText    ? `       Có chữ:    ${obj.promptWithText}`    : null,
                    obj.promptWithoutText ? `       Không chữ: ${obj.promptWithoutText}` : null,
                    obj.textOnImage       ? `       Chữ trên ảnh: ${obj.textOnImage}`    : null,
                  ].filter(Boolean)),
                  ``,
                  `📊 Viral Score: ${seg.viralScore || 'N/A'} | Thời điểm: ${startTime}s–${endTime}s`,
                  `📅 Tạo lúc: ${new Date().toLocaleString('vi-VN')}`,
                ];
                const txtPath = res.outputPath.replace(/\.[^.]+$/, '') + '_metadata.txt';
                await window.electronAPI.writeTextFile({ filePath: txtPath, content: lines.join('\n') });
                addLog(`📄 SEO đoạn ${i + 1} → ${txtPath.split(/[\\/]/).pop()}`);
              } catch (we) {
                addLog(`⚠️ Ghi metadata lỗi: ${we.message}`);
              }
            } catch (se) {
              addLog(`⚠️ SEO đoạn ${i + 1} lỗi: ${se.message}`);
            }
          }

          cutResults.push(segResult);
        } else {
          addLog(`❌ Đoạn ${i + 1} lỗi: ${res.error}`);
          cutResults.push({ ...seg, startTime, endTime, error: res.error, success: false });
        }
        // Cập nhật UI sau mỗi đoạn
        setResults([...cutResults]);
      }

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

          {/* SEO Metadata */}
          <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">SEO Metadata</p>
              <button onClick={() => { const v = !seoEnabled; setSeoEnabled(v); localStorage.setItem('viral_seo_enabled', String(v)); }}
                disabled={isBusy}
                className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${seoEnabled ? 'bg-rose-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${seoEnabled ? 'left-4' : 'left-0.5'}`}/>
              </button>
            </div>
            {seoEnabled && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">Ngôn ngữ đầu ra</p>
                <div className="flex flex-col gap-1">
                  {VIRAL_SEO_LANGS.map(l => (
                    <button key={l.code} onClick={() => { setSeoLang(l.code); localStorage.setItem('viral_seo_lang', l.code); }}
                      disabled={isBusy}
                      className={cn('px-2 py-1 rounded-lg text-[11px] text-left transition-colors disabled:opacity-50',
                        seoLang === l.code ? 'bg-rose-600/30 text-rose-300 ring-1 ring-rose-500/50' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700')}>
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-600 mt-1.5">Tạo title + description + tags + thumbnail prompt cho từng clip</p>
              </div>
            )}
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
                      {r.seo && (
                        <div className="mt-1 pt-1 border-t border-slate-700/50 flex flex-col gap-0.5">
                          <p className="text-[10px] text-rose-300 font-semibold line-clamp-2">📌 {typeof (r.seo.titles || [])[0] === 'object' ? (r.seo.titles[0]?.title || '') : ((r.seo.titles || [])[0] || '')}</p>
                          {(r.seo.tags || '') && <p className="text-[9px] text-slate-500 truncate">🏷 {typeof r.seo.tags === 'string' ? r.seo.tags.slice(0, 80) : (r.seo.tags || []).slice(0, 5).join(', ')}</p>}
                          <p className="text-[9px] text-slate-600">📄 metadata.txt đã lưu</p>
                        </div>
                      )}
                      {seoEnabled && !r.seo && r.success && isBusy && (
                        <p className="text-[9px] text-slate-500 mt-0.5">⏳ Đang tạo SEO...</p>
                      )}
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
  const [ytStatus,     setYtStatus]     = useState(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupPct,     setSetupPct]     = useState(0);
  const [updating,     setUpdating]     = useState(false);
  const [imgError,     setImgError]     = useState(false);

  // ── Batch mode ──
  const [batchMode,    setBatchMode]    = useState(false);
  const [batchText,    setBatchText]    = useState('');
  const [batchQueue,   setBatchQueue]   = useState([]); // [{id,url,status,error,progress}]
  const [batchRunning, setBatchRunning] = useState(false);
  const batchStopRef = useRef(false);

  const platform = useMemo(() => {
    if (/youtube\.com|youtu\.be/i.test(url))  return 'youtube';
    if (/tiktok\.com/i.test(url))              return 'tiktok';
    if (/douyin\.com/i.test(url))              return 'douyin';
    return url ? 'other' : null;
  }, [url]);

  useEffect(() => {
    window.electronAPI?.downloaderCheck?.().then(r => setYtStatus(r || { ok: false }));
    window.electronAPI?.getDownloadsDir?.().then(d => { if (d) setOutputFolder(d); });

    window.electronAPI?.onDownloaderProgress?.((d) => setProgress(d));
    window.electronAPI?.onDownloaderSetupProgress?.((d) => setSetupPct(d.percent));
    // Persistent batch progress listener — cập nhật progress từng item theo id
    window.electronAPI?.onBatchProgress?.((d) => {
      setBatchQueue(q => q.map(it => it.id === d.id ? { ...it, progress: d } : it));
    });
    return () => {
      window.electronAPI?.removeAllListeners?.('downloader:progress');
      window.electronAPI?.removeAllListeners?.('downloader:setup-progress');
      window.electronAPI?.removeAllListeners?.('downloader:batch-progress');
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

  const handleUpdate = async () => {
    setUpdating(true); setDlError('');
    const res = await window.electronAPI?.downloaderSetup?.();
    setUpdating(false);
    if (res?.success) {
      window.electronAPI?.downloaderCheck?.().then(r => setYtStatus(r || { ok: false }));
      setDlError('');
    } else {
      setDlError('Cập nhật thất bại: ' + (res?.error || 'lỗi không xác định'));
    }
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

  // ── Batch helpers ──
  const parseBatchUrls = (text) =>
    text.split('\n').map(l => l.trim()).filter(l => l && /^https?:\/\//.test(l));

  const handleBatchStart = async () => {
    const urls = parseBatchUrls(batchText);
    if (!urls.length || !outputFolder || batchRunning) return;

    const queue = urls.map((u, i) => ({ id: i, url: u, status: 'downloading', error: '', progress: { percent: 0 } }));
    setBatchQueue(queue);
    setBatchRunning(true);

    const items = urls.map((u, i) => ({ id: i, url: u, outputFolder, quality, format }));
    const results = await window.electronAPI?.downloaderBatchStart?.(items) || [];

    setBatchQueue(q => q.map(it => {
      if (it.status === 'paused') return it; // giữ nguyên item đang bị pause
      const r = results.find(r => r.id === it.id);
      if (!r) return it;
      return r.success
        ? { ...it, status: 'done',  progress: { percent: 100, done: true } }
        : { ...it, status: 'error', error: r.error || 'Lỗi không xác định' };
    }));

    setBatchRunning(false);
  };

  const handleBatchCancel = async () => {
    await window.electronAPI?.downloaderBatchCancel?.();
    setBatchQueue(q => q.map(it =>
      it.status === 'downloading' ? { ...it, status: 'pending' } : it));
    setBatchRunning(false);
  };

  const handlePauseItem = async (id) => {
    await window.electronAPI?.downloaderBatchPause?.(id);
    setBatchQueue(q => q.map(it => it.id === id ? { ...it, status: 'paused' } : it));
  };

  const handleResumeItem = async (item) => {
    setBatchQueue(q => q.map(it => it.id === item.id
      ? { ...it, status: 'downloading', progress: { percent: 0 } } : it));
    const result = await window.electronAPI?.downloaderBatchResume?.({
      id: item.id, url: item.url, outputFolder, quality, format,
    });
    setBatchQueue(q => q.map(it => it.id === item.id
      ? (result?.success
          ? { ...it, status: 'done',  progress: { percent: 100, done: true } }
          : { ...it, status: 'error', error: result?.error || 'Lỗi' })
      : it));
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
        {/* ── Mode tabs ── */}
        <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
          {[{ id: false, label: '🔗 Đơn lẻ' }, { id: true, label: '📋 Hàng loạt' }].map(t => (
            <button key={String(t.id)} onClick={() => setBatchMode(t.id)} disabled={downloading || batchRunning}
              className={cn('flex-1 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40',
                batchMode === t.id ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40' : 'text-slate-500 hover:text-slate-300')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── BATCH MODE ── */}
        {batchMode && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Link size={10}/> Danh sách link (mỗi link 1 dòng)</span>
                {batchText && <span className="text-slate-600 normal-case font-normal">{parseBatchUrls(batchText).length} link</span>}
              </label>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                placeholder={"https://youtube.com/watch?v=...\nhttps://tiktok.com/@.../video/...\nhttps://..."}
                rows={6}
                disabled={batchRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500/60 transition-colors resize-none font-mono leading-relaxed disabled:opacity-50"
              />
              <div className="flex gap-2">
                <button onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) setBatchText(t.trim()); } catch {} }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-400 hover:text-slate-200 transition-all">
                  <Clipboard size={11}/> Dán
                </button>
                <button onClick={() => { setBatchText(''); setBatchQueue([]); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-400 hover:text-red-400 transition-all">
                  <X size={11}/> Xoá
                </button>
              </div>
            </div>

            {/* Output folder (batch) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Folder size={9}/> Thư mục lưu</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 font-mono truncate">{outputFolder || 'Chưa chọn thư mục'}</div>
                <button onClick={handleSelectFolder} disabled={batchRunning}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"><Folder size={13}/></button>
                {outputFolder && <button onClick={() => window.electronAPI?.openFolder?.(outputFolder)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-all"><ArrowRight size={13}/></button>}
              </div>
            </div>

            {/* Format + quality (batch) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chất lượng</label>
                <select value={quality} onChange={e => setQuality(e.target.value)} disabled={batchRunning}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/60 transition-colors disabled:opacity-50">
                  {QUALITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Định dạng</label>
                <div className="flex gap-2">
                  {[{ v:'mp4', label:'MP4' }, { v:'mp3', label:'MP3' }].map(f => (
                    <button key={f.v} onClick={() => setFormat(f.v)} disabled={batchRunning}
                      className={cn('flex-1 py-2 rounded-lg text-xs font-bold border transition-all disabled:opacity-50',
                        format === f.v ? 'bg-violet-600/25 border-violet-500/50 text-violet-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500')}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Queue status */}
            {batchQueue.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                  <span>Tiến trình ({batchQueue.filter(i=>i.status==='done').length}/{batchQueue.length})</span>
                  {batchRunning && <span className="text-violet-400 animate-pulse">Đang chạy...</span>}
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                  {batchQueue.map(item => (
                    <div key={item.id} className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-xs border',
                      item.status === 'done'        ? 'bg-emerald-500/8 border-emerald-500/20' :
                      item.status === 'downloading' ? 'bg-violet-500/8 border-violet-500/25' :
                      item.status === 'paused'      ? 'bg-amber-500/8 border-amber-500/25' :
                      item.status === 'error'       ? 'bg-red-500/8 border-red-500/20' :
                                                      'bg-slate-900/40 border-slate-800')}>
                      <span className="mt-0.5 shrink-0 text-base leading-none">
                        {item.status === 'done'        ? '✅'
                       : item.status === 'downloading' ? '⏳'
                       : item.status === 'paused'      ? '⏸'
                       : item.status === 'error'       ? '❌' : '🕐'}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="truncate text-slate-300 font-mono text-[10px]">{item.url}</p>
                        {item.status === 'downloading' && item.progress && (
                          <div className="space-y-0.5">
                            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${item.progress.percent || 0}%` }}/>
                            </div>
                            <div className="flex justify-between text-[9px] text-slate-500">
                              <span>{item.progress.speed || ''}</span>
                              <span>{item.progress.percent?.toFixed(1)}%</span>
                            </div>
                          </div>
                        )}
                        {item.status === 'paused' && item.progress?.percent > 0 && (
                          <p className="text-amber-400/70 text-[10px]">Tạm dừng tại {item.progress.percent?.toFixed(1)}% — nhấn ▶ để tiếp tục</p>
                        )}
                        {item.status === 'error' && <p className="text-red-400 text-[10px]">{item.error}</p>}
                      </div>
                      {/* Pause / Resume buttons */}
                      {item.status === 'downloading' && (
                        <button onClick={() => handlePauseItem(item.id)} title="Tạm dừng"
                          className="shrink-0 mt-0.5 p-1 rounded hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition-all">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" rx="1"/><rect x="7" y="1" width="3" height="10" rx="1"/></svg>
                        </button>
                      )}
                      {item.status === 'paused' && (
                        <button onClick={() => handleResumeItem(item)} title="Tiếp tục tải"
                          className="shrink-0 mt-0.5 p-1 rounded hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-all">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 10,6 2,11"/></svg>
                        </button>
                      )}
                      {item.status === 'error' && (
                        <button onClick={() => handleResumeItem(item)} title="Thử lại"
                          className="shrink-0 mt-0.5 p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-all text-[10px]">↺</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Batch action button */}
            <div className="flex gap-2">
              {batchRunning ? (
                <button onClick={handleBatchCancel}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded-xl text-sm font-bold transition-all">
                  <X size={15}/> Dừng tải
                </button>
              ) : (
                <button onClick={handleBatchStart}
                  disabled={!ytStatus?.ok || !parseBatchUrls(batchText).length || !outputFolder}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-violet-900/30">
                  <Download size={15}/> Tải tất cả ({parseBatchUrls(batchText).length} link)
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── SINGLE MODE ── */}
        {!batchMode && (<>

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
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-xs text-red-400">{dlError}</p>
            </div>
            {(dlError.includes('403') || dlError.includes('Forbidden') || dlError.includes('Sign in') || dlError.includes('bytes read')) && (
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleUpdate} disabled={updating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50">
                  {updating ? '⏳ Đang cập nhật...' : '⬆ Cập nhật yt-dlp (khuyến nghị)'}
                </button>
                <span className="text-[10px] text-slate-500">YouTube thay đổi API — yt-dlp cũ bị chặn</span>
              </div>
            )}
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

        </>)} {/* end single mode */}

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

// ─── THUMBNAIL STUDIO PANEL ───────────────────────────────────────────────────
const getYouTubeId = (url) => {
  if (!url) return null;
  if (url.includes('/shorts/')) {
    const id = url.split('/shorts/')[1]?.split(/[?#&]/)[0];
    if (id?.length === 11) return id;
  }
  const m = url.match(/(?:youtu\.be\/|v\/|watch\?v=|&v=)([^#&?]{11})/);
  return m ? m[1] : null;
};

function ThumbnailStudioPanel({ apiKeys, onKeySwitch, geminiModel }) {
  const fileInputRef = useRef(null);
  const [inputType, setInputType]   = useState('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [imageSrc, setImageSrc]     = useState(null);
  const [mimeType, setMimeType]     = useState(null);
  const [removeText, setRemoveText] = useState(true);
  const [prompt, setPrompt]         = useState('');
  const [refineInstr, setRefineInstr] = useState('');
  const [generatedImg, setGeneratedImg] = useState(null);  // base64 data URL (preview)
  const [savedPath, setSavedPath]   = useState('');         // đường dẫn file đã lưu
  const [outputFolder, setOutputFolder] = useState(() => localStorage.getItem('fluxy_thumb_folder') || '');
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(false);

  const noKeys = !apiKeys?.length;

  const pickFolder = async () => {
    const f = await window.electronAPI?.selectFolder?.();
    if (f) { setOutputFolder(f); localStorage.setItem('fluxy_thumb_folder', f); }
  };

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Vui lòng chọn file ảnh (JPG, PNG, WEBP...).'); return; }
    const reader = new FileReader();
    reader.onloadend = () => { setImageSrc(reader.result); setMimeType(file.type); setPrompt(''); setGeneratedImg(null); setError(''); };
    reader.readAsDataURL(file);
  };

  const handleLoadYoutube = async () => {
    const vid = getYouTubeId(youtubeUrl);
    if (!vid) { setError('Link YouTube không hợp lệ.'); return; }
    setLoading(true); setLoadingMsg('Đang lấy thumbnail từ YouTube...'); setError('');
    const qualities = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
    let found = false;
    for (const q of qualities) {
      try {
        const r = await fetch(`https://img.youtube.com/vi/${vid}/${q}.jpg`);
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          setImageSrc(`data:image/jpeg;base64,${b64}`);
          setMimeType('image/jpeg');
          setPrompt(''); setGeneratedImg(null); setError('');
          found = true; break;
        }
      } catch {}
    }
    if (!found) setError('Không lấy được ảnh thumbnail từ link này.');
    setLoading(false);
  };

  const handleGeneratePrompt = async () => {
    if (!imageSrc || !mimeType) { setError('Vui lòng chọn ảnh mẫu trước.'); return; }
    if (noKeys) { setError('Chưa có Gemini API Key.'); return; }
    setLoading(true); setLoadingMsg('AI đang phân tích ảnh và tạo prompt...'); setError('');
    try {
      const cleanData = imageSrc.split(',')[1] || imageSrc;
      const result = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const txt = removeText
          ? 'Analyze this image and write a highly detailed English prompt for AI image generation. Exclude all text, captions, overlays, subtitles, and watermarks. Focus only on scenery, characters, style, atmosphere, and visual layout.'
          : 'Analyze this image and write a highly detailed English prompt for AI image generation. Describe composition, characters, colors, mood, style, and any text or graphics precisely so we can reconstruct this thumbnail.';
        const useModel = geminiModel || GEMINI_MODEL;
        const res = await ai.models.generateContent({
          model: useModel,
          contents: [{ parts: [{ inlineData: { data: cleanData, mimeType } }, { text: txt }] }],
          config: { ...(useModel === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        });
        return res.text?.trim() || '';
      }, apiKeys, { onSwitch: onKeySwitch });
      setPrompt(result);
    } catch (e) { setError(e.message || 'Lỗi khi phân tích ảnh.'); }
    finally { setLoading(false); }
  };

  const handleRefine = async () => {
    if (!prompt) { setError('Tạo prompt gốc trước.'); return; }
    if (!refineInstr.trim()) { setError('Nhập yêu cầu chỉnh sửa.'); return; }
    if (noKeys) { setError('Chưa có Gemini API Key.'); return; }
    setLoading(true); setLoadingMsg('AI đang chỉnh sửa prompt...'); setError('');
    try {
      const result = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const useModel = geminiModel || GEMINI_MODEL;
        const res = await ai.models.generateContent({
          model: useModel,
          contents: `Original prompt: ${prompt}\nUser instruction (Vietnamese/English): ${refineInstr}\n\nOutput ONLY the refined prompt in English, optimized for 16:9 thumbnail. No explanation.`,
          config: { ...(useModel === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        });
        return res.text?.trim() || '';
      }, apiKeys, { onSwitch: onKeySwitch });
      setPrompt(result); setRefineInstr('');
    } catch (e) { setError(e.message || 'Lỗi chỉnh sửa prompt.'); }
    finally { setLoading(false); }
  };

  const handleGenerateImage = async () => {
    if (!prompt) { setError('Cần có prompt trước khi tạo ảnh.'); return; }
    if (!outputFolder) { setError('Vui lòng chọn thư mục lưu ảnh trước.'); return; }
    setLoading(true); setLoadingMsg('Đang vẽ Thumbnail (Nano Banana Pro)... Vui lòng đợi...'); setError(''); setGeneratedImg(null); setSavedPath('');
    try {
      const taskId = `thumb_${Date.now()}`;
      const result = await window.electronAPI.runVeo({
        mediaType: 'Image',
        tasks: [{ id: taskId, prompt: `${prompt}, no text overlay, no watermark, 16:9 thumbnail, high quality.` }],
        aspectRatio: '16:9',
        model: 'Nano Banana Pro',
        genCount: '1x',
        quality: '1080p',
        outputFolder,
        duration: null,
      });
      const file = (result?.files || []).find(f => !f.isError && f.filePath);
      if (!file) throw new Error(result?.files?.[0]?.error || 'Không tạo được ảnh thumbnail.');
      setSavedPath(file.filePath);
      // Đọc file thành base64 để preview
      const raw = await window.electronAPI.readFileBase64?.(file.filePath);
      if (raw) setGeneratedImg(`data:image/png;base64,${raw}`);
      else setGeneratedImg(null); // vẫn có savedPath để mở
    } catch (e) { setError(e.message || 'Lỗi tạo ảnh thumbnail.'); }
    finally { setLoading(false); }
  };

  const downloadImage = () => {
    if (!generatedImg) return;
    const a = document.createElement('a');
    a.href = generatedImg; a.download = `thumbnail_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-[#1a2235] border border-slate-700 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <Loader2 size={32} className="animate-spin text-pink-400"/>
            <p className="text-sm text-slate-300 text-center max-w-xs">{loadingMsg}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-red-400 shrink-0"/>
          <p className="text-sm text-red-300 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300"><X size={14}/></button>
        </div>
      )}

      {/* Bước 1: Chọn ảnh mẫu */}
      <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2"><Camera size={15} className="text-pink-400"/> Bước 1: Chọn ảnh mẫu & Tạo prompt</h2>

        {/* Toggle upload / youtube */}
        <div className="flex bg-slate-800/60 p-1 rounded-lg border border-slate-700/40 w-fit gap-1">
          {[{id:'upload',label:'📁 Tải ảnh lên'},{id:'youtube',label:'▶ Từ YouTube'}].map(t => (
            <button key={t.id} onClick={() => setInputType(t.id)}
              className={cn('px-4 py-1.5 text-xs font-bold rounded-md transition-all', inputType === t.id ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:text-white')}>
              {t.label}
            </button>
          ))}
        </div>

        {inputType === 'upload' ? (
          <div onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-pink-500/60 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-800/20">
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" ref={fileInputRef}/>
            {imageSrc
              ? <img src={imageSrc} alt="Ảnh mẫu" className="max-h-48 mx-auto rounded-lg border border-slate-700"/>
              : <div className="space-y-2">
                  <Upload size={28} className="mx-auto text-slate-500"/>
                  <p className="text-sm text-slate-500">Nhấn để tải ảnh mẫu (JPG, PNG, WEBP...)</p>
                </div>
            }
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="text" placeholder="https://www.youtube.com/watch?v=..." value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                className="flex-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-pink-500/50"/>
              <button onClick={handleLoadYoutube} disabled={loading || !youtubeUrl.trim()}
                className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
                Lấy ảnh
              </button>
            </div>
            {imageSrc && (
              <div className="relative w-fit mx-auto">
                <img src={imageSrc} alt="Thumbnail YouTube" className="max-h-48 rounded-lg border border-slate-700"/>
                <button onClick={() => { setImageSrc(null); setMimeType(null); }}
                  className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white rounded-full p-1.5 w-7 h-7 flex items-center justify-center">
                  <X size={12}/>
                </button>
              </div>
            )}
          </div>
        )}

        {imageSrc && (
          <div className="space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer w-fit select-none">
              <input type="checkbox" checked={removeText} onChange={e => setRemoveText(e.target.checked)}
                className="w-4 h-4 rounded accent-pink-500"/>
              <span className="text-sm text-slate-300">Tự động bỏ chữ khỏi ảnh mẫu</span>
            </label>
            <button onClick={handleGeneratePrompt} disabled={loading || noKeys}
              className="w-full py-2.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors">
              {loading ? <Loader2 size={14} className="inline animate-spin mr-2"/> : <Sparkles size={14} className="inline mr-2"/>}
              Tạo Prompt từ ảnh mẫu
            </button>
          </div>
        )}
      </div>

      {/* Bước 2: Chỉnh sửa Prompt */}
      <div className="bg-[#1a2235] border border-slate-700/60 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2"><PenTool size={15} className="text-emerald-400"/> Bước 2: Chỉnh sửa Prompt</h2>
        <div className="relative">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5}
            placeholder="Prompt chi tiết sẽ xuất hiện ở đây sau khi tạo từ ảnh mẫu..."
            className="w-full bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 resize-y"/>
          <button onClick={() => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            disabled={!prompt}
            className="absolute top-2 right-2 p-1.5 bg-slate-700/60 hover:bg-emerald-600/30 text-slate-400 hover:text-emerald-400 rounded-lg transition-colors">
            {copied ? <Check size={13} className="text-emerald-400"/> : <Copy size={13}/>}
          </button>
        </div>
        <div className="flex gap-2">
          <input type="text" value={refineInstr} onChange={e => setRefineInstr(e.target.value)}
            placeholder="Yêu cầu chỉnh sửa: 'thêm con mèo', 'đổi nền biển', 'phong cách anime'..."
            className="flex-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
            onKeyDown={e => e.key === 'Enter' && handleRefine()}/>
          <button onClick={handleRefine} disabled={loading || !prompt || !refineInstr.trim() || noKeys}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap">
            Chỉnh sửa AI
          </button>
        </div>
      </div>

      {/* Bước 3: Tạo ảnh */}
      <div className="bg-[#1a2235] border border-pink-500/30 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2"><ImageIcon size={15} className="text-pink-400"/> Bước 3: Tạo Thumbnail (Nano Banana Pro · 16:9)</h2>

        {/* Chọn thư mục lưu */}
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-400 truncate">
            {outputFolder || 'Chưa chọn thư mục lưu ảnh...'}
          </div>
          <button onClick={pickFolder}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-lg transition-colors whitespace-nowrap border border-slate-600/60">
            <Folder size={12}/> Chọn thư mục
          </button>
          {outputFolder && (
            <button onClick={() => window.electronAPI?.openFolder?.(outputFolder)} title="Mở thư mục"
              className="p-2 bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-slate-200 rounded-lg transition-colors border border-slate-600/60">
              <HardDrive size={12}/>
            </button>
          )}
        </div>

        {(generatedImg || savedPath) ? (
          <div className="space-y-4">
            {generatedImg && (
              <div className="rounded-xl overflow-hidden border border-slate-700">
                <img src={generatedImg} alt="Thumbnail AI" className="w-full h-auto"/>
              </div>
            )}
            {savedPath && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                <Check size={13} className="text-emerald-400 shrink-0"/>
                <span className="text-xs text-emerald-300 truncate flex-1">{savedPath}</span>
                <button onClick={() => window.electronAPI?.openFolder?.(outputFolder)} title="Mở thư mục"
                  className="text-emerald-400 hover:text-emerald-300 shrink-0"><HardDrive size={13}/></button>
              </div>
            )}
            <div className="flex gap-3">
              {generatedImg && (
                <button onClick={downloadImage}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                  <Download size={14}/> Tải về (PNG)
                </button>
              )}
              <button onClick={handleGenerateImage} disabled={loading || !outputFolder}
                className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                <RefreshCw size={14}/> Tạo lại
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleGenerateImage} disabled={loading || !prompt || !outputFolder}
            className="w-full py-4 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2">
            <Sparkles size={18}/> Tạo Thumbnail Ngay
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO STORY PANEL — Viết truyện audio dài 50k-100k+ ký tự
// ─────────────────────────────────────────────────────────────────────────────
const AUDIO_GENRES = ['Tiên hiệp / Tu tiên', 'Kiếm hiệp / Wuxia', 'Ngôn tình / Lãng mạn', 'Trinh thám / Huyền bí', 'Kinh dị / Tâm lý', 'Lịch sử / Dã sử', 'Khoa học viễn tưởng', 'Hành động / Phiêu lưu', 'Gia đấu / Cung đấu', 'Tổng tài / CEO'];
const AUDIO_TONES = ['Mạch lạc, cuốn hút, nhiều cảm xúc', 'Hài hước, nhẹ nhàng, vui tươi', 'Huyền bí, kịch tính, căng thẳng', 'Lãng mạn, ngọt ngào, sâu lắng', 'Bi tráng, anh hùng, sử thi', 'Tối tăm, u ám, nhiều twist'];
const AUDIO_LANGS = ['Tiếng Việt', 'English', 'Tiếng Trung (giản thể)', '日本語 (Tiếng Nhật)', '한국어'];
const AUDIO_TARGETS = [
  { label: '50K', value: 50000 },
  { label: '80K', value: 80000 },
  { label: '100K', value: 100000 },
  { label: '150K', value: 150000 },
];
const CHARS_PER_CHUNK = 5500; // ký tự mục tiêu mỗi lần gọi API

function normalizeYtUrl(url) {
  let id = null;
  const s = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  if (s) id = s[1];
  if (!id) { const m = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/); if (m) id = m[1]; }
  if (!id) { const m = url.match(/[?&]v=([a-zA-Z0-9_-]+)/); if (m) id = m[1]; }
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

const TTS_EDGE_VOICES = [
  { id: 'vi-VN-HoaiMyNeural',  label: 'HoaiMy — Nữ (Bắc)'  },
  { id: 'vi-VN-NamMinhNeural', label: 'NamMinh — Nam (Bắc)' },
  { id: 'en-US-JennyNeural',   label: 'Jenny — Female EN'   },
  { id: 'en-US-GuyNeural',     label: 'Guy — Male EN'       },
  { id: 'zh-CN-XiaoxiaoNeural',label: 'Xiaoxiao — 女 (中文)' },
  { id: 'zh-CN-YunxiNeural',   label: 'Yunxi — 男 (中文)'   },
  { id: 'ja-JP-NanamiNeural',  label: 'Nanami — 女 (日本語)' },
  { id: 'ja-JP-KeitaNeural',   label: 'Keita — 男 (日本語)'  },
  { id: 'ko-KR-SunHiNeural',   label: 'SunHi — 여 (한국어)'  },
  { id: 'ko-KR-InJoonNeural',  label: 'InJoon — 남 (한국어)' },
];
const TTS_GEMINI_VOICES = [
  { id: 'Aoede',   label: 'Aoede — Nữ, ấm áp'    },
  { id: 'Kore',    label: 'Kore — Nữ, rõ ràng'   },
  { id: 'Leda',    label: 'Leda — Nữ, dịu dàng'  },
  { id: 'Sulafat', label: 'Sulafat — Nữ, thân thiện' },
  { id: 'Charon',  label: 'Charon — Nam, trung tính' },
  { id: 'Fenrir',  label: 'Fenrir — Nam, mạnh mẽ' },
  { id: 'Puck',    label: 'Puck — Nam, linh hoạt' },
  { id: 'Orus',    label: 'Orus — Nam, uy quyền'  },
  { id: 'Zephyr',  label: 'Zephyr — Trung tính'  },
];

function buildNarratorScript(raw) {
  return raw
    .replace(/─{3,}[^─\n]*─{3,}/g, '')
    .replace(/\[CHƯƠNG\s+\d+[^\]]*\]/gi, '')
    .replace(/^chương\s+\d+[^\n]*/gim, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    .replace(/\(\s*hết\s*chương[^)]*\)/gi, '')
    .replace(/\[\s*còn\s*tiếp[^\]]*\]/gi, '')
    .replace(/\[\s*hết[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

function splitTextForTts(text, maxChars = 5000) {
  const chunks = [];
  const paragraphs = text.split(/\n+/);
  let cur = '';
  for (const p of paragraphs) {
    if (cur.length + p.length + 1 > maxChars && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? cur + '\n' + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

function AudioStoryPanel({ apiKeys, onKeySwitch, geminiModel }) {
  // mode: 'create' | 'rewrite'
  const [mode, setMode]           = useState('create');
  const [ytUrl, setYtUrl]         = useState('');
  const [analyzed, setAnalyzed]   = useState(null); // { genre, tone, lang, title, synopsis, originalScript }
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [title, setTitle]         = useState('');
  const [genre, setGenre]         = useState(AUDIO_GENRES[0]);
  const [tone, setTone]           = useState(AUDIO_TONES[0]);
  const [lang, setLang]           = useState(AUDIO_LANGS[0]);
  const [targetChars, setTargetChars] = useState(80000);
  const [customChars, setCustomChars] = useState('');
  const [synopsis, setSynopsis]   = useState('');
  const [outline, setOutline]     = useState('');
  const [storyText, setStoryText]         = useState('');
  const [narratorScript, setNarratorScript] = useState(''); // kịch bản người đọc
  const [isGen, setIsGen]         = useState(false);
  const [phase, setPhase]         = useState('');
  const [progress, setProgress]   = useState({ done: 0, total: 0, chapter: 0, totalChapters: 0 });
  const [error, setError]         = useState('');
  const [copied, setCopied]       = useState(false);
  const [keyStatus, setKeyStatus] = useState('');

  // SEO + Thumbnail
  const [seoLang, setSeoLang]     = useState(() => localStorage.getItem('audio_story_seo_lang') || 'vi');
  const [seoEnabled, setSeoEnabled] = useState(() => localStorage.getItem('audio_story_seo_enabled') !== 'false');
  const [thumbFolder, setThumbFolder] = useState(() => localStorage.getItem('audio_story_thumb_folder') || '');
  const [seoData, setSeoData]     = useState(null);
  const [thumbPath, setThumbPath] = useState('');
  const [isSeoGen, setIsSeoGen]   = useState(false);

  // TTS Tự Động
  const [ttsEnabled,      setTtsEnabled]      = useState(() => localStorage.getItem('audio_story_tts_enabled') === 'true');
  const [ttsEngine,       setTtsEngine]       = useState(() => localStorage.getItem('audio_story_tts_engine') || 'edge');
  const [ttsVoice,        setTtsVoice]        = useState(() => localStorage.getItem('audio_story_tts_voice') || 'vi-VN-HoaiMyNeural');
  const [ttsOutputFolder, setTtsOutputFolder] = useState(() => localStorage.getItem('audio_story_tts_folder') || '');
  const [ttsStatus,       setTtsStatus]       = useState('');
  const [ttsResultPaths,  setTtsResultPaths]  = useState([]);
  const [isTtsRunning,    setIsTtsRunning]    = useState(false);
  // Vieneu saved voices — đọc từ VoiceStudio localStorage
  const [vnSavedVoices,   setVnSavedVoices]   = useState(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]'); } catch { return []; } });
  const [vnBuiltinVoices, setVnBuiltinVoices] = useState([]);
  const [ttsVnVoiceId,    setTtsVnVoiceId]    = useState(() => localStorage.getItem('audio_story_tts_vn_voice') || '');
  // GPT-SoVITS state
  const [gsvRefs,         setGsvRefs]         = useState([]);
  const [gsvSelectedRef,  setGsvSelectedRef]  = useState(() => localStorage.getItem('cs_gsv_selected_ref') || '');
  const [gsvRefAudio,     setGsvRefAudio]     = useState('');
  const [gsvRefText,      setGsvRefText]      = useState('');
  const [gsvLang,         setGsvLang]         = useState('vi');
  const [gsvSpeed,        setGsvSpeed]        = useState(1.0);
  const stopRef = useRef(false);
  const textareaRef = useRef(null);
  const model = geminiModel || 'gemini-2.5-flash';

  // Load VieNeu built-in voices khi chọn VieNeu
  useEffect(() => {
    if (ttsEngine !== 'vieneu') return;
    window.electronAPI?.vieNeuGetVoices?.().then(r => {
      if (r?.voices?.length) setVnBuiltinVoices(r.voices);
    }).catch(() => {});
  }, [ttsEngine]);

  // Load GPT-SoVITS refs
  useEffect(() => {
    window.electronAPI?.gptSoVITSGetConfig?.().then(r => {
      if (r?.refs) {
        setGsvRefs(r.refs);
        const saved = localStorage.getItem('cs_gsv_selected_ref');
        if (saved) {
          const ref = r.refs.find(x => x.id === saved);
          if (ref) { setGsvRefAudio(ref.refAudioPath); setGsvRefText(ref.refText); setGsvLang(ref.lang || 'vi'); }
        }
      }
    }).catch(() => {});
  }, []);

  const handleKeyRotate = ({ fromIdx, toIdx, total, reason }) => {
    setKeyStatus(`🔄 Key ${fromIdx + 1}→${toIdx + 1}/${total} (${reason})`);
    onKeySwitch?.({ fromIdx, toIdx, total, reason });
  };

  const scrollToBottom = () => {
    if (textareaRef.current) textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  };

  // ── Phân tích video YouTube → tự động nhận diện thể loại/tone/ngôn ngữ ──
  const handleAnalyzeYt = async () => {
    if (!ytUrl.trim() || !apiKeys?.length) return;
    setIsAnalyzing(true); setError(''); setAnalyzed(null);
    try {
      const cleanUrl = normalizeYtUrl(ytUrl.trim());
      const videoPart = { fileData: { fileUri: cleanUrl } };

      // Bước 1: Lấy metadata JSON (response nhỏ, parse an toàn)
      const meta = await retryWithKeyRotation(async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [
            videoPart,
            { text: `Phân tích video này. Trả về JSON THUẦN (không markdown, không giải thích):
{"title":"...","genre":"chọn 1: Tiên hiệp / Tu tiên|Kiếm hiệp / Wuxia|Ngôn tình / Lãng mạn|Trinh thám / Huyền bí|Kinh dị / Tâm lý|Lịch sử / Dã sử|Khoa học viễn tưởng|Hành động / Phiêu lưu|Gia đấu / Cung đấu|Tổng tài / CEO","tone":"chọn 1: Mạch lạc, cuốn hút, nhiều cảm xúc|Hài hước, nhẹ nhàng, vui tươi|Huyền bí, kịch tính, căng thẳng|Lãng mạn, ngọt ngào, sâu lắng|Bi tráng, anh hùng, sử thi|Tối tăm, u ám, nhiều twist","lang":"chọn 1: Tiếng Việt|English|Tiếng Trung (giản thể)|한국어","synopsis":"tóm tắt 3-5 câu nội dung chính"}` },
          ]}],
          config: { temperature: 0.2, maxOutputTokens: 1024 },
        });
        let txt = (res.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        // Tìm JSON object trong response
        const match = txt.match(/\{[\s\S]*\}/);
        if (!match) throw new Error(`Gemini không trả về JSON hợp lệ. Response: ${txt.slice(0, 200)}`);
        return JSON.parse(match[0]);
      }, apiKeys, { onSwitch: handleKeyRotate, maxCycles: 2 });

      // Bước 2: Lấy transcript (plain text, không JSON)
      let originalScript = '';
      try {
        originalScript = await retryWithKeyRotation(async (key) => {
          const ai = new GoogleGenAI({ apiKey: key });
          const res = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [
              videoPart,
              { text: `Hãy ghi lại TOÀN BỘ lời thoại/lời kể trong video này theo đúng ngôn ngữ gốc. Chỉ ghi nội dung được nói, không thêm ghi chú hay giải thích. Bắt đầu ngay:` },
            ]}],
            config: { temperature: 0.1, maxOutputTokens: 16384 },
          });
          return res.text || '';
        }, apiKeys, { onSwitch: handleKeyRotate, maxCycles: 2 });
      } catch (e) {
        // Transcript lỗi không chặn toàn bộ flow
        setError(`⚠️ Lấy transcript thất bại (${e.message}) — vẫn có thể viết lại dựa trên synopsis.`);
      }

      const result = { ...meta, originalScript };
      setAnalyzed(result);
      if (result.title) setTitle(result.title);
      if (result.genre && AUDIO_GENRES.includes(result.genre)) setGenre(result.genre);
      if (result.tone  && AUDIO_TONES.includes(result.tone))   setTone(result.tone);
      if (result.lang  && AUDIO_LANGS.includes(result.lang))   setLang(result.lang);
      if (result.synopsis) setSynopsis(result.synopsis);
    } catch (e) {
      setError(`Lỗi phân tích video: ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Phase 1: Tạo outline ────────────────────────────────────────────────
  const generateOutline = async (effectiveTarget, totalChunks) => {
    const numChapters = totalChunks;
    const isRewrite = mode === 'rewrite' && analyzed?.originalScript;
    const prompt = isRewrite
      ? `Bạn là tác giả chuyên nghiệp viết truyện audio.
Dưới đây là kịch bản gốc từ video YouTube:

=== KỊCH BẢN GỐC ===
${analyzed.originalScript}
=== HẾT KỊCH BẢN GỐC ===

Hãy tạo outline chi tiết cho việc VIẾT LẠI câu chuyện này thành truyện audio dài hơn, hấp dẫn hơn:

Tiêu đề mới: ${title || analyzed.title || 'Câu chuyện không tên'}
Thể loại: ${genre}
Phong cách: ${tone}
Ngôn ngữ đầu ra: ${lang}
Số chương: ${numChapters} chương
Tổng độ dài: ${effectiveTarget.toLocaleString()} ký tự

YÊU CẦU:
- Giữ cốt lõi câu chuyện, nhân vật và tình tiết chính từ kịch bản gốc
- MỞ RỘNG và PHÁT TRIỂN thêm: miêu tả nội tâm sâu hơn, đối thoại phong phú hơn, bối cảnh sống động hơn
- THÊM các chi tiết cảm xúc, kịch tính mà kịch bản gốc chưa có
- Mỗi chương: tên chương, nội dung 3-5 câu, điểm nhấn cảm xúc/kịch tính
- Kết thúc mỗi chương tạo sự tò mò

ĐỊNH DẠNG:
[CHƯƠNG 1: <tên>]
Nội dung: ...
Điểm nhấn: ...`
      : `Bạn là tác giả chuyên nghiệp viết truyện audio ${genre}.
Hãy tạo outline chi tiết:

Tiêu đề: ${title || 'Câu chuyện không tên'}
Thể loại: ${genre}
Phong cách: ${tone}
NGÔN NGỮ VIẾT BẮT BUỘC: ${lang}${!(lang.toLowerCase().includes('việt')||lang.toLowerCase().includes('vietnamese')) ? ` — outline VÀ toàn bộ truyện PHẢI viết bằng ${lang}, KHÔNG dùng tiếng Việt` : ''}
Tóm tắt: ${synopsis || 'Tự sáng tác câu chuyện hấp dẫn phù hợp thể loại'}
Số chương: ${numChapters} chương
Tổng độ dài: ${effectiveTarget.toLocaleString()} ký tự (~${Math.round(effectiveTarget / numChapters).toLocaleString()} ký tự/chương)

YÊU CẦU OUTLINE:
- Mỗi chương: tên chương, tóm tắt 3-5 câu, điểm mấu chốt (cliffhanger/cảm xúc đỉnh điểm)
- Arc nhân vật rõ ràng, phát triển xuyên suốt
- Mỗi chương kết thúc tạo tò mò muốn nghe tiếp
${!(lang.toLowerCase().includes('việt')||lang.toLowerCase().includes('vietnamese')) ? `- Outline PHẢI bằng ${lang}, không dùng tiếng Việt` : ''}

ĐỊNH DẠNG:
[CHƯƠNG 1: <tên>]
Nội dung: ...
Điểm nhấn: ...`;

    return retryWithKeyRotation(
      async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.8, maxOutputTokens: 8192 },
        });
        return res.text;
      },
      apiKeys,
      { onSwitch: handleKeyRotate, maxCycles: 3 }
    );
  };

  // ── Phase 2: Viết từng chương với streaming ──────────────────────────────
  const writeChapter = async (chapterNum, totalChaps, outlineText, prevContext, accumulatedChars, effectiveTarget) => {
    const isFirst = chapterNum === 1;
    const isLast  = chapterNum === totalChaps;
    const charsLeft = effectiveTarget - accumulatedChars;
    const charsThisChapter = Math.min(CHARS_PER_CHUNK + 500, charsLeft + 1000);
    const isRewrite = mode === 'rewrite' && analyzed?.originalScript;

    const contextBlock = !isFirst && prevContext
      ? `\n\n===ĐOẠN KẾT CHƯƠNG TRƯỚC (tiếp tục ngay từ đây, không mở đầu lại)===\n${prevContext}\n===HẾT NGỮ CẢNH===\n`
      : '';

    const rewriteNote = isRewrite
      ? `\nLƯU Ý VIẾT LẠI: Câu chuyện này được phát triển từ kịch bản gốc của YouTube. Hãy mở rộng, thêm cảm xúc, chi tiết nội tâm và đối thoại phong phú. KHÔNG sao chép nguyên văn kịch bản gốc.\n`
      : '';

    const isVietnamese = lang.toLowerCase().includes('việt') || lang.toLowerCase().includes('vietnamese') || lang === 'vi';
    const langEnforcePrefix = !isVietnamese
      ? `⚠️ CRITICAL INSTRUCTION: You MUST write ALL content in ${lang}. Do NOT write in Vietnamese under any circumstances. Every single word must be in ${lang}.\n\n`
      : '';
    const langEnforceSuffix = !isVietnamese
      ? `\n\n⚠️ REMINDER: Write ONLY in ${lang}. Not Vietnamese. Not mixed language. Pure ${lang} only.`
      : '';

    const prompt = `${langEnforcePrefix}Bạn là tác giả chuyên nghiệp viết truyện audio thể loại ${genre}.
NGÔN NGỮ VIẾT BẮT BUỘC: ${lang}${!isVietnamese ? ` — TOÀN BỘ nội dung PHẢI bằng ${lang}, KHÔNG dùng tiếng Việt` : ''}
Phong cách viết: ${tone}
Tiêu đề truyện: ${title || 'Câu chuyện không tên'}
${rewriteNote}
OUTLINE TOÀN BỘ TRUYỆN:
${outlineText}
${contextBlock}
NHIỆM VỤ: Viết CHƯƠNG ${chapterNum}/${totalChaps} theo outline trên.
Mục tiêu độ dài chương này: khoảng ${charsThisChapter.toLocaleString()} ký tự.
${isLast ? 'Đây là chương CUỐI — kết thúc câu chuyện hoàn chỉnh, có hậu.' : `Kết thúc chương bằng một tình huống hấp dẫn để người nghe muốn nghe chương tiếp theo.`}

QUY TẮC BẮT BUỘC:
1. KHÔNG viết "[còn tiếp]", "...", "(hết chương)", hay bất kỳ ghi chú meta nào
2. KHÔNG tóm tắt hay lược bớt — viết ĐẦY ĐỦ, CHI TIẾT, SINH ĐỘNG
3. KHÔNG bắt đầu bằng "Chương X:" hay tiêu đề — viết thẳng vào nội dung
4. Đối thoại phải tự nhiên, có cảm xúc, phân biệt rõ giọng từng nhân vật
5. Dùng các kỹ thuật: miêu tả nội tâm, hành động chi tiết, bối cảnh sống động
6. Viết liên tục, không xuống dòng thừa, không đoạn trống
7. ${isFirst ? 'Mở đầu thật ấn tượng, cuốn hút ngay từ câu đầu tiên' : 'Tiếp nối mượt mà từ ngữ cảnh chương trước, không lặp lại những gì đã xảy ra'}
${langEnforceSuffix}
Bắt đầu viết ngay:`;

    let chapterText = '';
    await retryWithKeyRotation(
      async (key) => {
        const ai = new GoogleGenAI({ apiKey: key });
        const stream = await ai.models.generateContentStream({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.85, maxOutputTokens: 8192 },
        });
        for await (const chunk of stream) {
          if (stopRef.current) break;
          const txt = chunk.text || '';
          chapterText += txt;
          setStoryText(prev => prev + txt);
          setProgress(p => ({ ...p, done: p.done + txt.length }));
          scrollToBottom();
        }
      },
      apiKeys,
      { onSwitch: handleKeyRotate, maxCycles: 3 }
    );

    return chapterText;
  };

  // ── Orchestrator ─────────────────────────────────────────────────────────
  // ── SEO + Thumbnail tự động ─────────────────────────────────────────────
  const runSeoAndThumb = async (finalText) => {
    if (!seoEnabled || !apiKeys?.length || !finalText) return;
    setIsSeoGen(true); setSeoData(null); setThumbPath('');
    try {
      // SEO metadata
      setPhase('seo');
      const content = `Tiêu đề: ${title || 'Truyện Audio'}\nThể loại: ${genre}\nNội dung:\n${finalText.slice(0, 8000)}`;
      const onSeoKey = ({ fromIdx, toIdx, total }) =>
        setKeyStatus(`🔄 [SEO] Key ${fromIdx+1}→${toIdx+1}/${total}`);
      const result = await generateSeoMetadata(apiKeys, content, seoLang, '', onSeoKey, model, [], { contentType: 'story' });
      setSeoData(result);

      // Thumbnail AI — dùng promptWithText từ SEO (giữ nguyên chữ trên ảnh)
      if (thumbFolder) {
        setPhase('thumbnail');
        // Lấy promptWithText từ SEO thumbnailPrompts (đã có mô tả chữ trên ảnh)
        const thumbObjs = result?.thumbnailPrompts || [];
        for (let ti = 0; ti < Math.min(thumbObjs.length, 3); ti++) {
          const tp = thumbObjs[ti];
          const promptWithText = tp?.promptWithText || tp?.promptWithoutText || '';
          if (!promptWithText) continue;
          const taskId = `audio_thumb_${Date.now()}_${ti}`;
          setKeyStatus(`🖼️ Vẽ thumbnail ${ti+1}/${Math.min(thumbObjs.length, 3)}...`);
          try {
            const veoResult = await window.electronAPI.runVeo({
              mediaType: 'Image',
              tasks: [{ id: taskId, prompt: `${promptWithText}, 16:9 thumbnail, high quality.` }],
              aspectRatio: '16:9', model: 'Nano Banana Pro', genCount: '1x', quality: '1080p',
              outputFolder: thumbFolder, duration: null,
            });
            const thumbFile = (veoResult?.files || []).find(f => !f.isError && f.filePath);
            if (thumbFile) setThumbPath(prev => prev ? `${prev}\n${thumbFile.filePath}` : thumbFile.filePath);
          } catch (e) {
            setKeyStatus(`⚠️ Thumbnail ${ti+1} lỗi: ${e.message}`);
          }
        }
      }
    } catch (e) {
      setError(prev => prev ? `${prev}\n⚠️ SEO/Thumb lỗi: ${e.message}` : `⚠️ SEO/Thumb lỗi: ${e.message}`);
    } finally {
      setIsSeoGen(false);
    }
  };

  const runTts = async (text) => {
    if (!ttsEnabled || !text) return;
    const folder = ttsOutputFolder || thumbFolder;
    if (!folder) { setTtsStatus('⚠️ Chưa chọn thư mục lưu audio'); return; }
    setIsTtsRunning(true);
    setTtsResultPaths([]);
    const safeName = (title || 'truyen_audio').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'truyen_audio';
    const ts = Date.now();
    try {
      if (ttsEngine === 'edge') {
        const outputPath = `${folder}\\${safeName}_${ts}.mp3`;
        setTtsStatus(`⏳ Edge TTS đang xử lý ${(text.length/1000).toFixed(0)}K ký tự... (vài phút)`);
        const result = await window.electronAPI.generateVoice({ text, voice: ttsVoice, outputPath });
        if (result.success) {
          setTtsResultPaths([result.path]);
          setTtsStatus(`✅ Audio xong: ${result.path.split(/[/\\]/).pop()}`);
        } else {
          setTtsStatus(`❌ Edge TTS lỗi: ${result.error}`);
        }
      } else if (ttsEngine === 'gemini') {
        const apiKeysRaw = localStorage.getItem('fluxy_gemini_api_keys') || '[]';
        const gmKeys = JSON.parse(apiKeysRaw);
        if (!gmKeys.length) { setTtsStatus('❌ Chưa có Gemini API key'); return; }
        // Chia nhỏ theo đoạn văn ~1000 ký tự — mỗi đoạn 1 API call riêng
        const chunks = splitTextForTts(text, 1000);
        const chunkFiles = [];
        const chunkDurations = []; // duration (giây) của từng chunk để tạo SRT
        for (let i = 0; i < chunks.length; i++) {
          if (stopRef.current) break;
          let attempt = 0;
          let success = false;
          // Retry vô hạn cho đến khi thành công hoặc user dừng
          while (!success && !stopRef.current) {
            const statusMsg = attempt === 0
              ? `⏳ Đoạn ${i+1}/${chunks.length} · Gemini TTS...`
              : `🔄 Đoạn ${i+1}/${chunks.length} · thử lần ${attempt+1} (key ${(attempt % gmKeys.length)+1}/${gmKeys.length})...`;
            setTtsStatus(statusMsg);
            const result = await window.electronAPI.geminiTTS({
              text: chunks[i],
              voiceName: ttsVoice || 'Aoede',
              apiKeys: gmKeys,
              outputFolder: folder,
              projectName: `${safeName}_s${String(i+1).padStart(4,'0')}_${ts}`,
            });
            if (result.success) {
              chunkFiles.push(result.path);
              // Lấy duration của chunk để tính timestamp SRT
              try {
                const durInfo = await window.electronAPI.prepareAudio(result.path);
                chunkDurations.push(durInfo?.duration || 0);
              } catch { chunkDurations.push(0); }
              success = true;
            } else {
              attempt++;
              setTtsStatus(`⚠️ Đoạn ${i+1} thất bại (${result.error?.slice(0,60)}) → đợi 5s rồi thử lại...`);
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
        if (stopRef.current || !chunkFiles.length) {
          setTtsStatus(`⛔ Đã dừng: ${chunkFiles.length}/${chunks.length} đoạn`);
        } else {
          // Luôn gọi concat để rename/xóa chunk, dù chỉ có 1 file
          setTtsStatus(`🔧 Hoàn thiện ${chunkFiles.length} đoạn...`);
          const finalPath = `${folder}\\${safeName}_full_${ts}.wav`;
          const concatRes = await window.electronAPI.concatWavFiles?.({ files: chunkFiles, outputPath: finalPath, deleteAfter: true });
          const audioPath = concatRes?.success ? concatRes.path : chunkFiles[chunkFiles.length - 1];
          if (concatRes?.success) {
            setTtsResultPaths([concatRes.path]);
            setTtsStatus(`✅ Xong ${chunkFiles.length} đoạn → ${concatRes.path.split(/[/\\]/).pop()}`);
          } else {
            setTtsResultPaths(chunkFiles);
            setTtsStatus(`✅ ${chunkFiles.length} file (concat lỗi: ${concatRes?.error || '?'})`);
          }

          // ── Tạo SRT từ chunks + durations ─────────────────────────────────
          try {
            const toSrtTime = (sec) => {
              const h   = Math.floor(sec / 3600);
              const m   = Math.floor((sec % 3600) / 60);
              const s   = Math.floor(sec % 60);
              const ms  = Math.round((sec % 1) * 1000);
              return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
            };
            let srtContent = '';
            let elapsed = 0;
            const completedChunks = chunks.slice(0, chunkFiles.length);
            completedChunks.forEach((chunkText, idx) => {
              const dur = chunkDurations[idx] || 0;
              const start = elapsed;
              const end   = elapsed + dur;
              elapsed     = end;
              srtContent += `${idx + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${chunkText.trim()}\n\n`;
            });
            const srtPath = audioPath.replace(/\.[^.]+$/, '.srt');
            await window.electronAPI.writeTextFile({ filePath: srtPath, content: srtContent });
            setTtsStatus(prev => prev + ` | 📄 SRT: ${srtPath.split(/[/\\]/).pop()}`);
          } catch (srtErr) {
            console.warn('Tạo SRT thất bại:', srtErr);
          }
        }
      } else if (ttsEngine === 'gptsovits') {
        if (!gsvRefAudio) throw new Error('GPT-SoVITS: Chọn giọng clone trước');
        const chunks = splitTextForTts(text, 1500);
        setTtsStatus(`⏳ GPT-SoVITS: ${chunks.length} đoạn...`);
        const files = [];
        for (let i = 0; i < chunks.length; i++) {
          if (stopRef.current) break;
          setTtsStatus(`⏳ GPT-SoVITS đoạn ${i+1}/${chunks.length}...`);
          const outPath = `${folder}\\${safeName}_p${String(i+1).padStart(3,'0')}_${ts}.wav`;
          const res = await window.electronAPI?.gptSoVITSSynthesize?.({ text: chunks[i], outputPath: outPath, refAudioPath: gsvRefAudio, refText: gsvRefText, lang: gsvLang, speed: gsvSpeed });
          if (res?.success) files.push(res.path || outPath);
          else { setTtsStatus(`❌ GPT-SoVITS đoạn ${i+1}: ${res?.error || '?'}`); break; }
        }
        if (files.length > 0) {
          setTtsResultPaths(files);
          setTtsStatus(`✅ ${files.length}/${chunks.length} file WAV xong`);
        }
      } else if (ttsEngine === 'vieneu') {
        // Vieneu TTS — chunk 2000 ký tự/đoạn (Python TTS không xử lý quá dài)
        const isCloneId = ttsVnVoiceId?.startsWith('clone:');
        const cloneProfile = isCloneId
          ? vnSavedVoices.find(v => String(v.id) === ttsVnVoiceId.replace('clone:', ''))
          : null;
        const isBuiltin = ttsVnVoiceId && !isCloneId;
        const selectedVn = cloneProfile;
        const chunks = splitTextForTts(text, 2000);
        const files = [];
        for (let i = 0; i < chunks.length; i++) {
          if (stopRef.current) break;
          const voiceLabel = cloneProfile ? cloneProfile.name : (isBuiltin ? ttsVnVoiceId : 'mặc định');
          setTtsStatus(`⏳ Vieneu TTS: đoạn ${i+1}/${chunks.length} · ${voiceLabel}...`);
          const outPath = `${folder}\\${safeName}_p${String(i+1).padStart(3,'0')}_${ts}.wav`;
          const params = {
            text: chunks[i],
            outputPath: outPath,
            voiceId:  isBuiltin ? ttsVnVoiceId : undefined,
            refAudio: cloneProfile?.refAudio || undefined,
            refText:  cloneProfile?.refText  || undefined,
          };
          const result = await window.electronAPI.vieNeuSynthesize?.(params);
          if (result?.success) files.push(result.path || outPath);
          else { setTtsStatus(`❌ Vieneu TTS chunk ${i+1} lỗi: ${result?.error || 'unknown'}`); break; }
        }
        if (files.length === chunks.length) {
          setTtsResultPaths(files);
          setTtsStatus(`✅ ${files.length} file WAV đã tạo xong`);
        }
      }
    } catch (e) {
      setTtsStatus(`❌ TTS lỗi: ${e.message}`);
    } finally {
      setIsTtsRunning(false);
    }
  };

  const handleGenerate = async () => {
    if (!apiKeys?.length) { setError('Chưa có Gemini API Key'); return; }
    if (mode === 'rewrite' && !analyzed) { setError('Chưa phân tích video. Nhấn "Phân tích" trước.'); return; }
    const effTarget = customChars ? parseInt(customChars) || targetChars : targetChars;
    const totalCh = Math.ceil(effTarget / CHARS_PER_CHUNK);
    setIsGen(true); setError(''); setStoryText(''); setOutline('');
    setSeoData(null); setThumbPath('');
    setTtsStatus(''); setTtsResultPaths([]);
    setKeyStatus(''); stopRef.current = false;
    setProgress({ done: 0, total: effTarget, chapter: 0, totalChapters: totalCh });

    let finalText = '';
    try {
      setPhase('outline');
      const outlineText = await generateOutline(effTarget, totalCh);
      if (stopRef.current) { setPhase(''); setIsGen(false); return; }
      setOutline(outlineText);

      setPhase('writing');
      let accumulated = '';
      let prevContext = '';

      for (let i = 1; i <= totalCh; i++) {
        if (stopRef.current) break;
        setProgress(p => ({ ...p, chapter: i, totalChapters: totalCh }));
        const chapterText = await writeChapter(i, totalCh, outlineText, prevContext, accumulated.length, effTarget);
        accumulated += '\n\n' + chapterText;
        prevContext = chapterText.slice(-2000);
        if (i < totalCh) { setStoryText(prev => prev + '\n\n'); }
        if (accumulated.length >= effTarget * 0.98) break;
      }
      finalText = accumulated;
      setPhase('done');
    } catch (e) {
      setError(e.message || 'Lỗi không xác định');
    } finally {
      setIsGen(false);
    }

    // Tự động tạo kịch bản người đọc
    if (finalText) {
      const narScript = buildNarratorScript(finalText);
      setNarratorScript(narScript);
    }

    // Auto SEO + Thumbnail sau khi viết xong
    if (finalText && !stopRef.current) {
      await runSeoAndThumb(finalText);
    }
    // Auto TTS dùng narrator script (đã làm sạch)
    if (finalText && !stopRef.current && ttsEnabled) {
      setPhase('tts');
      const ttsText = buildNarratorScript(finalText);
      await runTts(ttsText);
    }
    setPhase('done');
  };

  const handleStop = () => { stopRef.current = true; setIsGen(false); setIsSeoGen(false); setIsTtsRunning(false); setPhase(''); };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(storyText);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    try {
      const defaultName = `${(title || 'truyen-audio').replace(/[/\\?%*:|"<>]/g, '-')}-${Date.now()}.txt`;
      await window.electronAPI.saveTextFile({ content: storyText, filename: defaultName });
    } catch {}
  };

  const pct = progress.total > 0 ? Math.min(100, Math.round(progress.done / progress.total * 100)) : 0;
  const charsK = (n) => n >= 1000 ? `${(n/1000).toFixed(1)}K` : n;
  const effTarget = customChars ? parseInt(customChars) || targetChars : targetChars;
  const totalChunks = Math.ceil(effTarget / CHARS_PER_CHUNK);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-68 flex-shrink-0 border-r border-slate-800 flex flex-col overflow-y-auto custom-scrollbar bg-[#080f1e]" style={{ width: 270 }}>
        <div className="p-3 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base">🎙️</span>
            <span className="text-sm font-black text-white">Truyện Audio Dài</span>
          </div>
          {/* Mode toggle */}
          <div className="flex gap-1 bg-slate-800/60 rounded-lg p-0.5">
            <button onClick={() => { setMode('create'); setAnalyzed(null); }}
              className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-all ${mode === 'create' ? 'bg-amber-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              ✍️ Tự sáng tác
            </button>
            <button onClick={() => setMode('rewrite')}
              className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-all ${mode === 'rewrite' ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              📺 Viết lại YTB
            </button>
          </div>
        </div>

        <div className="flex-1 p-3 space-y-3">
          {/* YTB input — chỉ khi mode=rewrite */}
          {mode === 'rewrite' && (
            <div className="bg-slate-800/40 rounded-xl p-2.5 space-y-2">
              <label className="text-[10px] font-bold text-red-400 uppercase tracking-widest block">Link YouTube</label>
              <input value={ytUrl} onChange={e => setYtUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-2 text-[11px] text-white focus:outline-none focus:border-red-500/60" />
              <button onClick={handleAnalyzeYt} disabled={isAnalyzing || !ytUrl.trim() || !apiKeys?.length}
                className="w-full py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                {isAnalyzing ? <><Loader2 size={11} className="animate-spin"/> Đang phân tích...</> : <><Youtube size={11}/> Phân tích Video</>}
              </button>
              {analyzed && (
                <div className="px-2 py-1.5 bg-green-900/30 border border-green-700/40 rounded-lg">
                  <p className="text-[10px] text-green-400 font-bold mb-0.5">✅ Đã phân tích xong</p>
                  <p className="text-[10px] text-slate-400 truncate">{analyzed.title}</p>
                  <p className="text-[10px] text-slate-500">{analyzed.genre} · {analyzed.lang}</p>
                </div>
              )}
            </div>
          )}

          {/* Tiêu đề */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
              {mode === 'rewrite' ? 'Tiêu đề mới (tùy chỉnh)' : 'Tiêu đề truyện'}
            </label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={mode === 'rewrite' ? 'Để trống = dùng tiêu đề gốc...' : 'VD: Vô Thượng Kiếm Tôn...'}
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/60" />
          </div>

          {/* Synopsis — chỉ khi create mode */}
          {mode === 'create' && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Ý tưởng / Tóm tắt</label>
              <textarea value={synopsis} onChange={e => setSynopsis(e.target.value)} rows={3}
                placeholder="Mô tả ngắn câu chuyện... (để trống để AI tự sáng tác)"
                className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/60 resize-none" />
            </div>
          )}

          {/* Thể loại — auto-filled khi rewrite */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
              Thể loại {mode === 'rewrite' && analyzed && <span className="text-green-400 normal-case">(tự động)</span>}
            </label>
            <select value={genre} onChange={e => setGenre(e.target.value)}
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/60">
              {AUDIO_GENRES.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>

          {/* Phong cách */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
              Phong cách {mode === 'rewrite' && analyzed && <span className="text-green-400 normal-case">(tự động)</span>}
            </label>
            <select value={tone} onChange={e => setTone(e.target.value)}
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/60">
              {AUDIO_TONES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Ngôn ngữ */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">
              Ngôn ngữ đầu ra {mode === 'rewrite' && analyzed && <span className="text-green-400 normal-case">(tự động)</span>}
            </label>
            <select value={lang} onChange={e => setLang(e.target.value)}
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-2 text-[11px] text-white focus:outline-none focus:border-amber-500/60">
              {AUDIO_LANGS.map(l => <option key={l}>{l}</option>)}
            </select>
          </div>

          {/* Độ dài mục tiêu */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Độ dài mục tiêu</label>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {AUDIO_TARGETS.map(t => (
                <button key={t.value} onClick={() => { setTargetChars(t.value); setCustomChars(''); }}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${!customChars && targetChars === t.value ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <input value={customChars} onChange={e => setCustomChars(e.target.value.replace(/\D/g, ''))}
              placeholder="Tùy chỉnh (VD: 120000)"
              className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/60" />
            <p className="text-[10px] text-slate-600 mt-1">{totalChunks} chương × ~{charsK(CHARS_PER_CHUNK)} ký tự</p>
          </div>

          {/* SEO + Thumbnail */}
          <div className="bg-slate-800/40 rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">📈 SEO + Thumbnail AI</span>
              <button onClick={() => { const v = !seoEnabled; setSeoEnabled(v); localStorage.setItem('audio_story_seo_enabled', v); }}
                className={`w-8 h-4 rounded-full transition-colors relative ${seoEnabled ? 'bg-amber-500' : 'bg-slate-600'}`}>
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${seoEnabled ? 'left-4' : 'left-0.5'}`}/>
              </button>
            </div>
            {seoEnabled && (
              <>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Ngôn ngữ SEO</label>
                  <select value={seoLang} onChange={e => { setSeoLang(e.target.value); localStorage.setItem('audio_story_seo_lang', e.target.value); }}
                    className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-amber-500/60">
                    <option value="vi">🇻🇳 Tiếng Việt</option>
                    <option value="en">🇺🇸 English</option>
                    <option value="ko">🇰🇷 한국어</option>
                    <option value="ja">🇯🇵 Japanese</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">Thư mục lưu Thumbnail</label>
                  <div className="flex gap-1">
                    <input value={thumbFolder} onChange={e => { setThumbFolder(e.target.value); localStorage.setItem('audio_story_thumb_folder', e.target.value); }}
                      placeholder="Chọn thư mục..."
                      className="flex-1 min-w-0 bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-amber-500/60" />
                    <button onClick={async () => {
                      const r = await window.electronAPI?.selectFolder?.();
                      if (r) { setThumbFolder(r); localStorage.setItem('audio_story_thumb_folder', r); }
                    }} className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-white flex-shrink-0">
                      <FolderOpen size={11}/>
                    </button>
                  </div>
                  {!thumbFolder && <p className="text-[9px] text-slate-600 mt-0.5">Để trống = chỉ tạo SEO, không vẽ thumbnail</p>}
                </div>
              </>
            )}
          </div>

          {/* TTS Tự Động */}
          <div className="bg-slate-800/40 rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Mic size={10} className="text-emerald-400"/> 🎙️ TTS Tự Động
              </span>
              <button onClick={() => { const v = !ttsEnabled; setTtsEnabled(v); localStorage.setItem('audio_story_tts_enabled', v); }}
                className={`w-8 h-4 rounded-full transition-colors relative ${ttsEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${ttsEnabled ? 'left-4' : 'left-0.5'}`}/>
              </button>
            </div>
            {ttsEnabled && (
              <div className="space-y-2">
                {/* Engine */}
                <div>
                  <label className="text-[9px] text-slate-500 block mb-1">ENGINE</label>
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={() => { setTtsEngine('edge'); localStorage.setItem('audio_story_tts_engine', 'edge'); if (!TTS_EDGE_VOICES.find(v=>v.id===ttsVoice)) { setTtsVoice('vi-VN-HoaiMyNeural'); localStorage.setItem('audio_story_tts_voice','vi-VN-HoaiMyNeural'); } }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${ttsEngine==='edge' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      Edge TTS
                    </button>
                    <button onClick={() => { setTtsEngine('gemini'); localStorage.setItem('audio_story_tts_engine', 'gemini'); if (!TTS_GEMINI_VOICES.find(v=>v.id===ttsVoice)) { setTtsVoice('Aoede'); localStorage.setItem('audio_story_tts_voice','Aoede'); } }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${ttsEngine==='gemini' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      Gemini TTS
                    </button>
                    <button onClick={() => { setTtsEngine('vieneu'); localStorage.setItem('audio_story_tts_engine', 'vieneu'); setVnSavedVoices(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices')||'[]'); } catch{return[];} }); }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${ttsEngine==='vieneu' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      VieNeu TTS
                    </button>
                    <button onClick={() => { setTtsEngine('gptsovits'); localStorage.setItem('audio_story_tts_engine', 'gptsovits'); }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-colors ${ttsEngine==='gptsovits' ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      GPT-SoVITS
                    </button>
                  </div>
                  {ttsEngine === 'edge'      && <p className="text-[9px] text-slate-600 mt-0.5">✅ Xử lý text dài, ghép tự động</p>}
                  {ttsEngine === 'gemini'    && <p className="text-[9px] text-slate-600 mt-0.5">⚡ Chia 5K ký tự/đoạn, cần Gemini key</p>}
                  {ttsEngine === 'vieneu'    && <p className="text-[9px] text-slate-600 mt-0.5">🎤 Clone giọng, chia 2K ký tự/đoạn</p>}
                  {ttsEngine === 'gptsovits' && <p className="text-[9px] text-slate-600 mt-0.5">🎵 Clone giọng cao cấp, cần server local</p>}
                </div>
                {/* Voice */}
                {ttsEngine === 'gptsovits' && (
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 block">GIỌNG CLONE (GPT-SoVITS)</label>
                  {gsvRefs.length > 0 ? (
                    <select value={gsvSelectedRef} onChange={e => {
                      const id = e.target.value;
                      setGsvSelectedRef(id); localStorage.setItem('cs_gsv_selected_ref', id);
                      const r = gsvRefs.find(x => x.id === id);
                      if (r) { setGsvRefAudio(r.refAudioPath); setGsvRefText(r.refText); setGsvLang(r.lang || 'vi'); }
                    }} className="w-full bg-[#0a1020] border border-pink-700/40 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-pink-500">
                      <option value="">— Chọn giọng đã lưu —</option>
                      {gsvRefs.map(r => <option key={r.id} value={r.id}>{r.name} ({r.lang})</option>)}
                    </select>
                  ) : (
                    <p className="text-[9px] text-slate-500">Chưa có giọng — vào Voice TTS → GPT-SoVITS để thêm giọng</p>
                  )}
                  {gsvSelectedRef && <p className="text-[9px] text-pink-400/70">🎵 {gsvRefs.find(r=>r.id===gsvSelectedRef)?.name}</p>}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500">Tốc độ</span>
                    <input type="range" min="0.5" max="2" step="0.05" value={gsvSpeed} onChange={e => setGsvSpeed(parseFloat(e.target.value))} className="flex-1 accent-pink-500" />
                    <span className="text-[9px] text-slate-400 w-8">{gsvSpeed.toFixed(2)}x</span>
                  </div>
                  <button onClick={() => window.electronAPI?.gptSoVITSGetConfig?.().then(r => { if (r?.refs) setGsvRefs(r.refs); })}
                    className="text-[9px] text-slate-500 hover:text-white">↻ Refresh giọng</button>
                </div>
                )}
                {ttsEngine !== 'vieneu' && ttsEngine !== 'gptsovits' && (
                <div>
                  <label className="text-[9px] text-slate-500 block mb-1">GIỌNG ĐỌC</label>
                  <select value={ttsVoice} onChange={e => { setTtsVoice(e.target.value); localStorage.setItem('audio_story_tts_voice', e.target.value); }}
                    className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-emerald-500/60">
                    {(ttsEngine === 'edge' ? TTS_EDGE_VOICES : TTS_GEMINI_VOICES).map(v => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </select>
                </div>
                )}
                {/* Vieneu — clone + built-in voice list */}
                {ttsEngine === 'vieneu' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[9px] text-slate-500">GIỌNG VIENEU</label>
                    <button onClick={() => {
                      setVnSavedVoices(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices')||'[]'); } catch{return[];} });
                      window.electronAPI?.vieNeuGetVoices?.().then(r => { if (r?.voices?.length) setVnBuiltinVoices(r.voices); }).catch(()=>{});
                    }} className="text-[9px] text-slate-500 hover:text-white flex items-center gap-0.5">
                      <RefreshCw size={8}/> Refresh
                    </button>
                  </div>
                  <select value={ttsVnVoiceId} onChange={e => { setTtsVnVoiceId(e.target.value); localStorage.setItem('audio_story_tts_vn_voice', e.target.value); }}
                    className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-orange-500/60">
                    <option value="">— Giọng mặc định —</option>
                    {vnSavedVoices.length > 0 && (
                      <optgroup label="⭐ Giọng Clone">
                        {vnSavedVoices.map(sv => (
                          <option key={`clone_${sv.id}`} value={`clone:${sv.id}`}>{sv.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {vnBuiltinVoices.length > 0 && (
                      <optgroup label="🔊 Giọng cố định">
                        {vnBuiltinVoices.map(([desc, id]) => (
                          <option key={id} value={id}>{desc}</option>
                        ))}
                      </optgroup>
                    )}
                    {vnSavedVoices.length === 0 && vnBuiltinVoices.length === 0 && (
                      <option disabled>Chưa tải giọng — bấm Refresh</option>
                    )}
                  </select>
                  {ttsVnVoiceId?.startsWith('clone:') && (
                    <p className="text-[9px] text-orange-400/70 mt-0.5">
                      🎤 {vnSavedVoices.find(v=>String(v.id)===ttsVnVoiceId.replace('clone:',''))?.name} — clone voice
                    </p>
                  )}
                </div>
                )}
              </div>
            )}
          </div>

        {/* Buttons */}
        <div className="p-3 border-t border-slate-800 space-y-2">
          {!isGen ? (
            <button onClick={handleGenerate} disabled={!apiKeys?.length || (mode === 'rewrite' && !analyzed)}
              className={`w-full py-3 ${mode === 'rewrite' ? 'bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400' : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400'} disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-black rounded-xl transition-all flex items-center justify-center gap-2`}>
              {mode === 'rewrite' ? <><Youtube size={13}/> Viết Lại Ngay</> : <><span>🎙️</span> Viết Truyện Ngay</>}
            </button>
          ) : (
            <button onClick={handleStop}
              className="w-full py-3 bg-red-600 hover:bg-red-500 text-white text-[12px] font-black rounded-xl transition-all flex items-center justify-center gap-2">
              <span>⏹</span> Dừng lại
            </button>
          )}
          {storyText && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={handleCopy}
                  className="py-2 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1">
                  {copied ? <><Check size={10}/> Đã copy</> : <><Copy size={10}/> Copy</>}
                </button>
                <button onClick={handleSave}
                  className="py-2 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1">
                  <Download size={10}/> Lưu .txt
                </button>
              </div>
              {ttsEnabled && !isTtsRunning && !isGen && (
                <button onClick={() => runTts(storyText)} disabled={isTtsRunning}
                  className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 transition-colors">
                  <Mic size={10}/> Tạo Audio TTS Thủ Công
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header + progress */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-4 flex-shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[11px] font-bold text-white">
                {phase === 'outline'   && '📋 Đang tạo outline...'}
                {phase === 'writing'   && `✍️ Đang viết chương ${progress.chapter}/${progress.totalChapters}`}
                {phase === 'seo'       && '📈 Đang tạo SEO metadata...'}
                {phase === 'thumbnail' && '🖼️ Đang vẽ thumbnail AI...'}
                {phase === 'tts'       && '🎙️ Đang tạo audio TTS...'}
                {phase === 'done'      && '✅ Hoàn thành!'}
                {!phase && (mode === 'rewrite' ? '📺 Viết Lại Từ YouTube' : 'Truyện Audio AI')}
              </span>
              {(isGen || isTtsRunning) && <Loader2 size={13} className={`animate-spin ${isTtsRunning ? 'text-emerald-400' : 'text-amber-400'}`}/>}
              {keyStatus && <span className="text-[10px] text-amber-400/80 truncate max-w-48">{keyStatus}</span>}
              {isTtsRunning && ttsStatus && <span className="text-[10px] text-emerald-400/80 truncate max-w-48">{ttsStatus}</span>}
            </div>
            {progress.total > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-400 h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }}/>
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                  {charsK(progress.done)} / {charsK(progress.total)} ký tự ({pct}%)
                </span>
              </div>
            )}
          </div>
          {storyText && (
            <span className="text-[10px] text-slate-500 tabular-nums">{storyText.length.toLocaleString()} ký tự</span>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
        {error && (
          <div className="mx-5 mt-3 px-4 py-3 bg-red-900/30 border border-red-700/40 rounded-xl text-[11px] text-red-300 flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/> {error}
          </div>
        )}

        {/* Outline collapsible */}
        {outline && (
          <details className="mx-5 mt-3">
            <summary className="text-[11px] font-bold text-slate-400 cursor-pointer hover:text-white px-3 py-2 bg-slate-800/50 rounded-lg">
              📋 Outline ({progress.totalChapters || totalChunks} chương) — click để xem
            </summary>
            <pre className="mt-1 px-3 py-2 bg-slate-900/60 rounded-lg text-[10px] text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar">{outline}</pre>
          </details>
        )}

        {/* SEO + Thumbnail result */}
        {(isSeoGen || seoData || thumbPath) && (
          <div className="mx-5 mt-3 space-y-2">
            {/* SEO generating status */}
            {isSeoGen && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/20 border border-amber-700/30 rounded-lg">
                <Loader2 size={11} className="animate-spin text-amber-400"/>
                <span className="text-[11px] text-amber-300">
                  {phase === 'seo' ? '📈 Đang tạo SEO metadata...' : phase === 'thumbnail' ? '🖼️ Đang vẽ thumbnail AI...' : 'Đang xử lý...'}
                </span>
              </div>
            )}

            {/* SEO data */}
            {seoData && (
              <details open>
                <summary className="text-[11px] font-bold text-green-400 cursor-pointer hover:text-green-300 px-3 py-2 bg-green-900/20 border border-green-700/30 rounded-lg flex items-center gap-2">
                  <span>📈 SEO Metadata đã tạo — click để xem/thu gọn</span>
                </summary>
                <div className="mt-1 px-3 py-2.5 bg-slate-900/60 border border-slate-700/40 rounded-lg space-y-2">
                  {/* Tiêu đề */}
                  {(seoData.titles || []).length > 0 && (
                    <div>
                      <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">📌 Tiêu đề ({seoData.titles.length})</p>
                      {seoData.titles.map((t, i) => (
                        <div key={i} className="flex items-start gap-1.5 mb-1">
                          <span className="text-[9px] text-slate-600 mt-0.5 flex-shrink-0">{i+1}.</span>
                          <p className="text-[11px] text-white leading-snug">{typeof t === 'object' ? t.title : t}</p>
                          <button onClick={() => navigator.clipboard.writeText(typeof t === 'object' ? t.title : t)} className="flex-shrink-0 p-0.5 hover:text-amber-400 text-slate-600 transition-colors">
                            <Copy size={9}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Description */}
                  {seoData.description && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">📝 Mô tả</p>
                        <button onClick={() => navigator.clipboard.writeText(seoData.description)} className="text-[9px] text-slate-500 hover:text-amber-400 flex items-center gap-0.5">
                          <Copy size={9}/> Copy
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-300 leading-relaxed max-h-20 overflow-y-auto custom-scrollbar">{seoData.description}</p>
                    </div>
                  )}
                  {/* Tags */}
                  {seoData.tags && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[9px] font-bold text-slate-500 uppercase">🏷️ Tags</p>
                        <button onClick={() => navigator.clipboard.writeText(typeof seoData.tags === 'string' ? seoData.tags : seoData.tags.join(', '))} className="text-[9px] text-slate-500 hover:text-amber-400 flex items-center gap-0.5">
                          <Copy size={9}/> Copy
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">{typeof seoData.tags === 'string' ? seoData.tags : seoData.tags.join(', ')}</p>
                    </div>
                  )}
                  {/* Thumbnail concepts */}
                  {(seoData.thumbnailPrompts || []).length > 0 && (
                    <div>
                      <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">🖼️ Thumbnail Concepts</p>
                      {seoData.thumbnailPrompts.map((tp, i) => (
                        <div key={i} className="mb-1.5 px-2 py-1.5 bg-slate-800/60 rounded-lg text-[10px] text-slate-300">
                          <p className="font-bold text-amber-400 mb-0.5">{tp.concept}</p>
                          {tp.textOnImage && <p className="text-slate-400">Chữ: {tp.textOnImage}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Thumbnail path */}
            {thumbPath && (
              <div className="px-3 py-2 bg-pink-900/20 border border-pink-700/30 rounded-lg">
                <p className="text-[10px] font-bold text-pink-300 mb-1">🖼️ Thumbnail đã vẽ xong ({thumbPath.split('\n').length} ảnh)</p>
                {thumbPath.split('\n').map((p, i) => (
                  <p key={i} className="text-[10px] text-slate-400 truncate">• {p.split(/[/\\]/).pop()}</p>
                ))}
              </div>
            )}

            {/* TTS result */}
            {(isTtsRunning || ttsStatus) && (
              <div className={`px-3 py-2 rounded-lg border ${isTtsRunning ? 'bg-emerald-900/20 border-emerald-700/30' : ttsStatus.startsWith('✅') ? 'bg-emerald-900/20 border-emerald-700/30' : 'bg-red-900/20 border-red-700/30'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {isTtsRunning ? <Loader2 size={11} className="animate-spin text-emerald-400"/> : <Headphones size={11} className="text-emerald-400"/>}
                  <p className="text-[10px] font-bold text-emerald-300">🎙️ TTS Auto</p>
                </div>
                <p className="text-[10px] text-slate-300">{ttsStatus}</p>
                {ttsResultPaths.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {ttsResultPaths.map((p, i) => (
                      <p key={i} className="text-[10px] text-slate-400 truncate">• {p.split(/[/\\]/).pop()}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Text area */}
        <div className="p-5 flex flex-col" style={{ minHeight: '400px' }}>
          {!storyText && !isGen ? (
            <div className="flex flex-col items-center justify-center text-center py-10">
              <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-4">
                <span className="text-3xl">{mode === 'rewrite' ? '📺' : '🎙️'}</span>
              </div>
              {mode === 'rewrite' ? (
                <>
                  <p className="text-sm font-bold text-slate-300 mb-1">Viết Lại Từ YouTube</p>
                  <p className="text-[11px] text-slate-600 max-w-sm">Dán link YouTube bên trái → <strong className="text-red-400">Phân tích Video</strong>. AI sẽ tự động đọc kịch bản gốc, nhận diện thể loại/tone/ngôn ngữ rồi viết lại thành truyện audio dài hơn, hấp dẫn hơn.</p>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-[10px] text-slate-500">
                    <div className="bg-slate-800/40 rounded-lg p-2.5">🔍 Tự nhận diện<br/>thể loại & phong cách</div>
                    <div className="bg-slate-800/40 rounded-lg p-2.5">✨ Mở rộng nội dung<br/>thêm cảm xúc, kịch tính</div>
                    <div className="bg-slate-800/40 rounded-lg p-2.5">🔄 Xoay API key<br/>tự động khi hết quota</div>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-300 mb-1">Viết Truyện Audio Dài</p>
                  <p className="text-[11px] text-slate-600 max-w-sm">Điền tiêu đề, thể loại và độ dài mục tiêu bên trái, sau đó nhấn <strong className="text-amber-400">Viết Truyện Ngay</strong>. AI sẽ tạo outline rồi viết từng chương liên tục.</p>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-[10px] text-slate-500">
                    <div className="bg-slate-800/40 rounded-lg p-2.5">🔄 Tự xoay API key<br/>khi hết quota</div>
                    <div className="bg-slate-800/40 rounded-lg p-2.5">📖 Outline trước<br/>rồi viết mạch lạc</div>
                    <div className="bg-slate-800/40 rounded-lg p-2.5">⚡ Streaming live<br/>từng chữ hiện ra</div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <textarea ref={textareaRef} readOnly value={storyText}
                className="w-full bg-[#060d1a] border border-slate-800 rounded-xl px-4 py-3 text-[12px] text-slate-200 leading-relaxed resize-none focus:outline-none custom-scrollbar font-mono"
                style={{ minHeight: '300px', height: isGen ? '300px' : `${Math.min(2000, Math.max(300, storyText.split('\n').length * 18 + 80))}px` }}
                placeholder={isGen ? 'Đang tạo nội dung...' : ''}/>

              {/* Narrator script */}
              {narratorScript ? (
                <div className="border border-emerald-800/50 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-emerald-950/40 border-b border-emerald-800/30">
                    <span className="text-[11px] font-bold text-emerald-400">🎙️ Kịch bản người đọc · {narratorScript.length.toLocaleString()} ký tự</span>
                    <div className="flex gap-2">
                      <button onClick={() => { const ns = buildNarratorScript(storyText||narratorScript); setNarratorScript(ns); }}
                        className="text-[10px] text-slate-400 hover:text-emerald-400 transition">↺ Tạo lại</button>
                      <button onClick={() => setNarratorScript('')} className="text-[10px] text-slate-500 hover:text-red-400">✕</button>
                    </div>
                  </div>
                  <textarea value={narratorScript} onChange={e => setNarratorScript(e.target.value)}
                    className="w-full bg-[#030a12] px-4 py-3 text-[12px] text-emerald-100 leading-relaxed resize-none focus:outline-none custom-scrollbar font-mono"
                    style={{ minHeight: '200px', height: `${Math.min(1500, Math.max(200, narratorScript.split('\n').length * 18 + 60))}px` }}/>
                  <div className="px-3 py-1.5 bg-emerald-950/20 text-[10px] text-emerald-700">
                    💡 TTS tự động dùng kịch bản này. Có thể sửa trực tiếp trước khi tạo audio.
                  </div>
                </div>
              ) : storyText && !isGen && (
                <button onClick={() => setNarratorScript(buildNarratorScript(storyText))}
                  className="w-full py-2 rounded-xl border border-emerald-800/40 bg-emerald-950/20 hover:bg-emerald-900/30 text-emerald-400 text-[11px] font-bold transition">
                  📖 Tạo Kịch Bản Người Đọc
                </button>
              )}
            </div>
          )}
        </div>
        </div>{/* end scrollable body */}
      </div>
    </div>
  );
}

const SUB_TABS = [
  { id: 'clone',      label: 'Clone Video',   icon: Copy,            color: 'bg-violet-600' },
  { id: 'script',     label: 'Viết Kịch Bản', icon: FileText,        color: 'bg-orange-500' },
  { id: 'prompt',     label: 'Tạo Prompt',    icon: Sparkles,        color: 'bg-emerald-600' },
  { id: 'seo',        label: 'Tạo Seo YTB',   icon: Youtube,         color: 'bg-red-600'    },
  { id: 'viral',      label: 'Viral Video AI', icon: Zap,             color: 'bg-rose-600'   },
  { id: 'downloader', label: 'Tải Video',      icon: TrendingDown,    color: 'bg-blue-600'   },
  { id: 'thumbnail',  label: 'Thumbnail AI',   icon: ImageIcon,       color: 'bg-pink-600'   },
  { id: 'audio-story', label: 'Truyện Audio',  icon: Volume2,         color: 'bg-amber-600'  },
];

const CREATOR_HELP = [
  { id: 'clone', label: 'Clone Video', color: 'text-violet-400', icon: '🎭', desc: 'Phân tích video YouTube để clone phong cách. AI đọc transcript → tạo kịch bản mới cùng structure, tone, hook. Dùng để tái tạo nội dung viral mà không copy trực tiếp.' },
  { id: 'script', label: 'Viết Kịch Bản', color: 'text-orange-400', icon: '📝', desc: 'AI viết kịch bản video hoàn chỉnh từ chủ đề. Chọn thể loại (review, tutorial, vlog…), độ dài, ngôn ngữ. Output: hook → nội dung → CTA. Có thể gửi sang tab Tạo Prompt.' },
  { id: 'prompt', label: 'Tạo Prompt', color: 'text-emerald-400', icon: '✨', desc: 'Tạo prompt cho Veo/Imagen từ mô tả cảnh. 3 chế độ: (1) Tạo từ chủ đề — nhập ý tưởng, AI viết prompt chi tiết; (2) Từ kịch bản — phân cảnh tự động; (3) Batch — tạo hàng loạt prompt cùng lúc.' },
  { id: 'seo', label: 'Tạo SEO YTB', color: 'text-red-400', icon: '📈', desc: 'Tối ưu YouTube SEO cho video. Upload kịch bản → AI tạo: tiêu đề CTR cao, mô tả VidIQ 100/100, 30+ tags, 3 concept thumbnail. Tạo ảnh thumbnail ngay bằng Nano Banana Pro (16:9).' },
  { id: 'viral', label: 'Viral Video AI', color: 'text-rose-400', icon: '🔥', desc: 'Phân tích video viral để hiểu hook, cấu trúc, tâm lý người xem. Input: link YouTube → AI chỉ ra điểm mạnh, công thức viral, cách áp dụng cho nội dung của bạn.' },
  { id: 'downloader', label: 'Tải Video', color: 'text-blue-400', icon: '⬇️', desc: 'Tải video từ YouTube, TikTok, Facebook… bằng yt-dlp. Chọn chất lượng (4K/1080p/720p/audio only). Tải hàng loạt bằng cách nhập nhiều link.' },
  { id: 'thumbnail', label: 'Thumbnail AI', color: 'text-pink-400', icon: '🖼️', desc: '3 bước tạo thumbnail: (1) Upload ảnh mẫu hoặc lấy từ YouTube; (2) AI phân tích → tạo prompt chi tiết; (3) Vẽ thumbnail mới bằng Nano Banana Pro (1080p, 16:9). Lưu file PNG.' },
];

function CreatorHelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1321] border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#0d1321]">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <h2 className="text-sm font-bold text-white">Hướng dẫn Creator Studio</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3">
          {CREATOR_HELP.map(h => (
            <div key={h.id} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base">{h.icon}</span>
                <span className={`text-[11px] font-black uppercase tracking-wider ${h.color}`}>{h.label}</span>
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed">{h.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CreatorStudio() {
  const [subTab, setSubTab] = useState('clone');
  const [apiKeys, setApiKeys] = useState(loadSavedKeys);
  const [apiKeysInput, setApiKeysInput] = useState(() => loadSavedKeys().join('\n'));
  const [keysPanelOpen, setKeysPanelOpen] = useState(false);
  const [keysSaved, setKeysSaved] = useState(() => loadSavedKeys().length > 0);
  const [rotateNotif, setRotateNotif] = useState(null);
  const [externalSubject, setExternalSubject] = useState('');
  const [externalPromptParams, setExternalPromptParams] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  // AI mode — shared across all Creator panels
  const [aiMode,     setAiMode]    = useState('gemini'); // 'gemini' | 'claude' | 'groq'
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);

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
      {showHelp && <CreatorHelpModal onClose={() => setShowHelp(false)}/>}
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
          {/* AI Provider toggle */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60 shrink-0">
              {[{id:'gemini',label:'✨ Gemini',color:'bg-blue-600'},{id:'claude',label:'🤖 Claude',color:'bg-orange-600'},{id:'groq',label:'⚡ Groq',color:'bg-green-600'}].map(m => (
                <button key={m.id} onClick={() => setAiMode(m.id)}
                  title={m.id === 'claude' && !claudeKey ? 'Chưa có Claude key' : m.id === 'groq' && !groqKeys.length ? 'Chưa có Groq key' : ''}
                  className={cn('px-2.5 py-1.5 text-[10px] font-bold transition-colors', aiMode === m.id ? m.color + ' text-white' : 'bg-slate-800/60 text-slate-500 hover:text-slate-300')}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* Gemini model selector */}
            {aiMode === 'gemini' && (
              <select value={geminiModel} onChange={e => setGeminiModel(e.target.value)}
                className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-[10px] text-slate-300 focus:outline-none focus:border-blue-500">
                {CREATOR_GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}

            {/* Help button */}
            <button onClick={() => setShowHelp(true)}
              className="w-7 h-7 rounded-full border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[11px] font-black flex items-center justify-center transition-colors" title="Hướng dẫn">
              ?
            </button>

            {/* Multi-key toggle button */}
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
        <CloneVideoPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} onSendToPrompt={sendToPrompt} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'script' ? 'flex' : 'none' }}>
        <ScriptWriterPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} onSendToPrompt={sendToPrompt}
          aiMode={aiMode} claudeKey={claudeKey} claudeModel={claudeModel} groqKeys={groqKeys} groqModel={groqModel} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'prompt' ? 'flex' : 'none' }}>
        <PromptGeneratorPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} externalSubject={externalSubject} externalPromptParams={externalPromptParams}
          onExternalSubjectConsumed={() => { setExternalSubject(''); setExternalPromptParams(null); }}
          aiMode={aiMode} claudeKey={claudeKey} claudeModel={claudeModel} groqKeys={groqKeys} groqModel={groqModel} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'seo' ? 'flex' : 'none', flexDirection: 'column' }}>
        <SeoYTBPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'viral' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ViralVideoPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'downloader' ? 'flex' : 'none', flexDirection: 'column' }}>
        <VideoDownloaderPanel />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'thumbnail' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ThumbnailStudioPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} geminiModel={geminiModel} />
      </div>
      <div className="flex-1 overflow-hidden" style={{ display: subTab === 'audio-story' ? 'flex' : 'none' }}>
        <AudioStoryPanel apiKeys={apiKeys} onKeySwitch={handleKeySwitch} geminiModel={geminiModel} />
      </div>
    </div>
  );
}
