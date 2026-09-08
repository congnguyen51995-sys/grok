import React, { useState, useRef, useCallback } from 'react';
import { Download, Trash2, Loader2, ImagePlus, FolderOpen, Sparkles, X, CheckCircle2, Wand2 } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';

const LS_GEMINI_KEYS = 'fluxy_gemini_api_keys';
function loadGeminiKeys() { try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS) || '[]'); } catch { return []; } }

// Các model Gemini có sẵn trong app để tối ưu prompt (theo thứ tự ưu tiên)
const OPTIMIZE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
];

const OPTIMIZE_SYSTEM = `You are an expert prompt engineer for DALL-E 3 image generation.
Rewrite the given prompt into an optimized DALL-E 3 prompt that:
1. Precisely describes visual composition, character positions, and scene layout
2. Specifies any text elements clearly: exact wording, color, font style, position on image
3. Adds cinematic details: lighting quality, camera angle, color palette, mood/atmosphere
4. Keeps ALL original creative elements — never simplify or remove requested content
5. Is structured for maximum DALL-E 3 comprehension (subject → setting → style → details)
Output ONLY the optimized prompt. English only. No explanation, no preamble.`;

async function optimizePromptWithGemini(originalPrompt) {
  const keys = loadGeminiKeys().map(k => (k || '').trim()).filter(Boolean);
  if (!keys.length) throw new Error('Không có Gemini API key');

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: OPTIMIZE_MODELS[0],
      contents: [{ role: 'user', parts: [{ text: `Optimize this image prompt for DALL-E 3:\n\n${originalPrompt}` }] }],
      config: {
        systemInstruction: OPTIMIZE_SYSTEM,
        maxOutputTokens: 500,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = response?.text?.trim() || response?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text?.trim();
    if (!text) throw new Error('Gemini không trả về kết quả');
    return text;
  }, keys, { maxCycles: 2 });
}

const ASPECT_RATIOS = [
  { label: '1:1',  value: '1:1',  w: 1024, h: 1024, desc: 'Vuông' },
  { label: '4:3',  value: '4:3',  w: 1024, h: 768,  desc: 'Ngang' },
  { label: '3:4',  value: '3:4',  w: 768,  h: 1024, desc: 'Dọc' },
  { label: '16:9', value: '16:9', w: 1280, h: 720,  desc: 'Wide' },
  { label: '9:16', value: '9:16', w: 720,  h: 1280, desc: 'Story' },
];

// Tỉ lệ → aspect ratio string cho Gemini API
const GEMINI_ASPECT = {
  '1:1': '1:1', '4:3': '4:3', '3:4': '3:4', '16:9': '16:9', '9:16': '9:16',
};

const MODELS = [
  { value: 'gemini-imagen', label: 'Gemini Image Gen (Miễn phí, API key)' },
  { value: 'gptimage',      label: 'GPT Image / DALL-E 3 (Pollinations)' },
];

// Tạo ảnh bằng Gemini API — gemini-2.0-flash-preview-image-generation
// Trả về [{b64, mime}]
async function callGeminiImageAPI({ prompt, aspectRatio, numImages, onLog }) {
  const keys = loadGeminiKeys().map(k => (k || '').trim()).filter(Boolean);
  if (!keys.length) throw new Error('Chưa có Gemini API key. Vào Settings → API Key.');

  const results = [];
  await retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        numberOfImages: numImages,
        aspectRatio: GEMINI_ASPECT[aspectRatio] || '16:9',
      },
    });
    const parts = response?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        results.push({ b64: p.inlineData.data, mime: p.inlineData.mimeType || 'image/png' });
      }
    }
    if (!results.length) throw new Error('Gemini không trả về ảnh — thử prompt khác');
  }, keys, { maxCycles: 2 });

  return results;
}

const NUM_OPTS = [1, 2, 3, 4];

// Tạo 1 ảnh qua Pollinations GET request, trả về {b64, mime}
async function callPollinationsAPI({ prompt, model, width, height }) {
  const seed = Math.floor(Math.random() * 99999);
  // enhance=true viết lại prompt → tắt với gptimage để giữ nguyên prompt gốc
  const enhance = model === 'gptimage' ? 'false' : 'true';
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${model}&width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=${enhance}&safe=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const mime = blob.type || 'image/jpeg';
  const b64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { b64, mime };
}

// Tạo numImages ảnh cho 1 prompt — route theo model
async function generateImages({ prompt, model, aspectRatio, numImages, onLog }) {
  if (model === 'gemini-imagen') {
    onLog(`🤖 Gemini Image Gen — aspect ${aspectRatio}`);
    const imgs = await callGeminiImageAPI({ prompt, aspectRatio, numImages, onLog });
    imgs.forEach((_, i) => onLog(`  ✅ Ảnh ${i + 1}/${imgs.length} xong`, 'success'));
    return imgs;
  }
  // Pollinations fallback
  const ar = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];
  onLog(`🎨 Pollinations ${model} — ${ar.w}×${ar.h}px`);
  const calls = Array.from({ length: numImages }, (_, i) =>
    callPollinationsAPI({ prompt, model, width: ar.w, height: ar.h })
      .then(img => { onLog(`  ✅ Ảnh ${i + 1}/${numImages} xong`, 'success'); return img; })
  );
  return Promise.all(calls);
}

export default function Imagen3Studio({ dark = true }) {
  const [model, setModel]               = useState('gemini-imagen');
  const [prompts, setPrompts]           = useState('');
  const [aspectRatio, setAspectRatio]   = useState('9:16');
  const [numImages, setNumImages]       = useState(1);
  const [outputFolder, setOutputFolder] = useState(() => localStorage.getItem('imagen3_output_folder') || '');
  const [generating, setGenerating]     = useState(false);
  const [results, setResults]           = useState([]);  // [{b64, filename, promptText, saved, error}]
  const [logs, setLogs]                 = useState([]);
  const [progress, setProgress]         = useState({ done: 0, total: 0 });
  const [aiOptimize, setAiOptimize]     = useState(true);
  const abortRef  = useRef(false);
  const keyIdxRef = useRef(0);
  const [availModels, setAvailModels] = useState(null); // null=chưa check, []= đang check, [...]= kết quả

  const addLog = useCallback((msg, type = 'info') =>
    setLogs(prev => [...prev.slice(-150), { msg, type, t: new Date().toLocaleTimeString() }]), []);

  const pickFolder = async () => {
    const p = await window.electronAPI?.selectFolder?.();
    if (p) { setOutputFolder(p); localStorage.setItem('imagen3_output_folder', p); }
  };

  // Fetch danh sách model từ Pollinations API
  const fetchPollinationsModels = async () => {
    setAvailModels([]);
    addLog('🔍 Đang lấy danh sách model từ Pollinations...');
    try {
      const res = await fetch('https://image.pollinations.ai/models');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setAvailModels(list);
      addLog(`✅ ${list.length} model: ${list.map(m => typeof m === 'string' ? m : m.name || m.id).join(', ')}`, 'success');
    } catch (e) {
      addLog(`❌ ${e.message}`, 'error');
      setAvailModels(null);
    }
  };

  const saveImageFile = useCallback(async (b64, filename) => {
    if (!outputFolder) return false;
    const filePath = `${outputFolder}\\${filename}`;
    try {
      const res = await window.electronAPI?.writeBase64File?.({ filePath, base64: b64 });
      return res?.success !== false;
    } catch { return false; }
  }, [outputFolder]);

  const downloadB64 = (b64, mime, filename) => {
    const a = document.createElement('a');
    a.href = `data:${mime || 'image/jpeg'};base64,${b64}`;
    a.download = filename; a.click();
  };

  // ── Hàm tạo ảnh chính — dùng Pollinations.ai (miễn phí, không cần key) ──
  const handleGenerate = async () => {
    const promptList = prompts.split('\n').map(p => p.trim()).filter(Boolean);
    if (!promptList.length) { addLog('❌ Nhập ít nhất 1 prompt!', 'error'); return; }

    setGenerating(true);
    abortRef.current = false;
    setProgress({ done: 0, total: promptList.length });
    addLog(`🚀 Bắt đầu: ${promptList.length} prompt × ${numImages} ảnh = ${promptList.length * numImages} ảnh`);
    addLog(`🆓 Pollinations.ai — miễn phí, không cần API key`);

    const ts = Date.now();

    for (let pi = 0; pi < promptList.length; pi++) {
      if (abortRef.current) { addLog('⏹️ Đã dừng.', 'warn'); break; }

      const pText = promptList[pi];
      addLog(`📝 Prompt ${pi + 1}/${promptList.length}: "${pText.slice(0, 60)}${pText.length > 60 ? '…' : ''}"`);

      try {
        let finalPrompt = pText;
        if (aiOptimize) {
          try {
            addLog(`✨ Tối ưu prompt bằng Gemini AI...`);
            finalPrompt = await optimizePromptWithGemini(pText);
            addLog(`  → Prompt mới: "${finalPrompt.slice(0, 80)}…"`, 'success');
          } catch (e) {
            addLog(`  ⚠️ Bỏ qua tối ưu: ${e.message}`, 'warn');
          }
        }
        const imgs = await generateImages({ prompt: finalPrompt, model, aspectRatio, numImages, onLog: addLog });
        for (let ii = 0; ii < imgs.length; ii++) {
          const { b64, mime } = imgs[ii];
          const ext = mime?.includes('png') ? 'png' : 'jpg';
          const filename = `pollinations_${ts}_p${pi + 1}_${ii + 1}.${ext}`;
          let saved = false;
          if (outputFolder) saved = await saveImageFile(b64, filename);
          setResults(prev => [{ b64, mime, filename, promptText: pText, saved }, ...prev]);
          if (saved) addLog(`💾 Đã lưu: ${filename}`, 'success');
        }
      } catch (e) {
        addLog(`❌ Prompt ${pi + 1} lỗi: ${e.message}`, 'error');
        setResults(prev => [{ b64: null, filename: `lỗi_p${pi + 1}`, promptText: pText, error: e.message }, ...prev]);
      }

      setProgress({ done: pi + 1, total: promptList.length });
      if (pi < promptList.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    addLog('🏁 Hoàn thành!', 'success');
    setGenerating(false);
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const inp = dark
    ? 'bg-[#1e293b] border-slate-700 text-slate-200 placeholder-slate-500 focus:border-purple-500'
    : 'bg-white border-gray-300 text-gray-800 placeholder-gray-400 focus:border-purple-400';

  const promptCount = prompts.split('\n').filter(p => p.trim()).length;

  return (
    <div className={`flex h-full overflow-hidden ${dark ? 'bg-[#0b1120] text-slate-300' : 'bg-gray-50 text-gray-700'}`}>

      {/* ── CỘT TRÁI ── */}
      <div className={`w-[320px] shrink-0 flex flex-col gap-3 p-4 border-r overflow-y-auto ${dark ? 'border-slate-800' : 'border-gray-200'}`}>

        {/* Service badge */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-emerald-900/20 border border-emerald-800/40 text-emerald-400">
          <CheckCircle2 size={12}/> Pollinations.ai — Miễn phí, không cần API key
        </div>

        {/* Model */}
        <div>
          <label className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1.5 block">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className={`w-full text-xs rounded-lg px-3 py-2 border focus:outline-none ${inp}`}>
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {/* Số ảnh + Tỉ lệ */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Ảnh/prompt</label>
            <div className="flex gap-1">
              {NUM_OPTS.map(n => (
                <button key={n} onClick={() => setNumImages(n)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${numImages === n
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : `border-slate-700 text-slate-400 hover:border-purple-500/50 ${dark ? 'bg-slate-800/50' : 'bg-gray-100'}`}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tỉ lệ</label>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
              className={`w-full text-xs rounded-lg px-2 py-2 border focus:outline-none ${inp}`}>
              {ASPECT_RATIOS.map(r => <option key={r.value} value={r.value}>{r.label} {r.desc}</option>)}
            </select>
          </div>
        </div>

        {/* Thư mục lưu */}
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Thư mục lưu PNG</label>
          <div className="flex gap-2">
            <input value={outputFolder} onChange={e => setOutputFolder(e.target.value)} placeholder="Chọn thư mục..."
              className={`flex-1 text-xs rounded-lg px-3 py-2 border focus:outline-none ${inp}`}/>
            <button onClick={pickFolder}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition">
              <FolderOpen size={14}/>
            </button>
          </div>
        </div>

        {/* AI Optimize toggle — chỉ hiện khi dùng Pollinations */}
        {model !== 'gemini-imagen' && <button
          onClick={() => setAiOptimize(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition w-full ${
            aiOptimize
              ? 'bg-violet-900/30 border-violet-700/60 text-violet-300'
              : `border-slate-700 text-slate-500 ${dark ? 'bg-slate-800/30' : 'bg-gray-100'}`
          }`}>
          <Wand2 size={12} className={aiOptimize ? 'text-violet-400' : 'text-slate-600'}/>
          <span className="flex-1 text-left">Tối ưu prompt bằng Gemini AI</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${aiOptimize ? 'bg-violet-700/40 text-violet-300' : 'bg-slate-700 text-slate-500'}`}>
            {aiOptimize ? 'BẬT' : 'TẮT'}
          </span>
        </button>}

        {/* Prompts — nhiều dòng */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={10}/> Prompts
            </label>
            {promptCount > 0 && (
              <span className="text-[10px] text-slate-500">
                {promptCount} prompt × {numImages} ảnh = <span className="text-purple-400 font-bold">{promptCount * numImages} ảnh</span>
              </span>
            )}
          </div>
          <textarea value={prompts} onChange={e => setPrompts(e.target.value)} rows={8}
            placeholder={'Mỗi dòng 1 prompt:\n\nA mafia boss in dark suit, cinematic, 8K\nA mysterious woman in red dress, dramatic lighting\nLuxury penthouse at night, hyperrealistic'}
            className={`w-full text-xs rounded-lg px-3 py-2 border focus:outline-none resize-none leading-relaxed font-mono ${inp}`}/>
          <p className="text-[10px] text-slate-600 mt-1">
            💡 Mỗi dòng = 1 prompt. Dùng tiếng Anh + "8K, cinematic" để nét hơn.
          </p>
        </div>

        {/* Progress bar */}
        {generating && progress.total > 1 && (
          <div>
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Tiến độ</span>
              <span>{progress.done}/{progress.total} prompt</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}/>
            </div>
          </div>
        )}

        {/* Nút tạo */}
        <button
          onClick={generating ? () => { abortRef.current = true; } : handleGenerate}
          className={`w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${
            generating
              ? 'bg-red-700/30 border border-red-700/50 text-red-300 hover:bg-red-700/40'
              : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-900/30'}`}>
          {generating
            ? <><Loader2 size={16} className="animate-spin"/> Đang tạo... (click để dừng)</>
            : <><Sparkles size={16}/> Tạo ảnh{promptCount > 1 ? ` (${promptCount} prompt)` : ''}</>}
        </button>

        {/* Log */}
        {logs.length > 0 && (
          <div className={`rounded-lg p-3 text-[10px] font-mono leading-relaxed max-h-40 overflow-y-auto space-y-0.5 ${dark ? 'bg-slate-900 text-slate-400' : 'bg-gray-100 text-gray-600'}`}>
            {logs.map((l, i) => (
              <div key={i} className={`${l.type === 'success' ? 'text-emerald-400' : l.type === 'error' ? 'text-red-400' : l.type === 'warn' ? 'text-yellow-400' : ''}`}>
                <span className="text-slate-600 mr-1">[{l.t}]</span>{l.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CỘT PHẢI — kết quả ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${dark ? 'border-slate-800 bg-[#0d1526]' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">Ảnh tạo ra</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${dark ? 'bg-slate-800 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
              {results.filter(r => r.b64).length}
            </span>
          </div>
          {results.length > 0 && (
            <button onClick={() => setResults([])} className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition">
              <Trash2 size={12}/> Xóa tất cả
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20 gap-3">
              <ImagePlus size={56}/>
              <p className="text-sm font-medium">Nhập prompt và nhấn Tạo ảnh</p>
              <p className="text-xs">Mỗi dòng = 1 prompt, mỗi prompt dùng 1 API key</p>
            </div>
          ) : (
            <div className="columns-2 gap-3 space-y-3">
              {results.map((r, idx) => (
                r.error ? (
                  <div key={idx} className="break-inside-avoid rounded-xl border border-red-800/40 bg-red-900/10 p-3 text-xs text-red-400">
                    <div className="font-bold mb-1">❌ Lỗi prompt {idx + 1}</div>
                    <div className="text-[10px] text-slate-500 mb-1 truncate">"{r.promptText}"</div>
                    <div>{r.error}</div>
                    <button onClick={() => setResults(prev => prev.filter((_, i) => i !== idx))}
                      className="mt-2 text-slate-600 hover:text-red-400">
                      <X size={12}/>
                    </button>
                  </div>
                ) : (
                  <div key={idx} className={`break-inside-avoid rounded-xl overflow-hidden border group ${dark ? 'border-slate-700/60 bg-slate-800/40' : 'border-gray-200 bg-white'}`}>
                    <img src={`data:${r.mime||'image/jpeg'};base64,${r.b64}`} alt={r.filename}
                      className="w-full object-cover"/>
                    <div className={`p-2 space-y-1 ${dark ? 'bg-slate-900/60' : 'bg-gray-50'}`}>
                      <div className="text-[9px] text-slate-500 truncate" title={r.promptText}>"{r.promptText}"</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-slate-600 flex-1 truncate">{r.filename}</span>
                        {r.saved && <span className="text-[9px] text-emerald-400 font-bold shrink-0">✓ Saved</span>}
                        <button onClick={() => downloadB64(r.b64, r.mime, r.filename)} title="Tải về"
                          className="p-1 rounded bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 transition shrink-0">
                          <Download size={11}/>
                        </button>
                        <button onClick={() => setResults(prev => prev.filter((_, i) => i !== idx))} title="Xóa"
                          className="p-1 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition shrink-0">
                          <Trash2 size={11}/>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
