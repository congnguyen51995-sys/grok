/**
 * StoryLoopPanel — Tạo video kể chuyện từ audio
 * Flow: Upload audio → Gemini phân tích → Tạo 5 prompt → Veo sinh 5 video → User chọn 1 → ffmpeg loop + ghép audio
 */
import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import {
  UploadCloud, Loader2, Sparkles, Video, Play, Check,
  RefreshCw, Download, Music2, Film, ChevronDown, ChevronUp, X,
} from 'lucide-react';

const LS_KEYS = 'fluxy_gemini_api_keys';
function loadKeys() { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); } catch { return []; } }

// ─── Gemini helper ─────────────────────────────────────────────────────────────
async function callGemini(apiKeys, prompt, maxTokens = 4096) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    });
    return res?.text || res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }, apiKeys, { maxCycles: 2 });
}

// ─── Phân tích transcript → tạo 5 Veo prompt ─────────────────────────────────
async function analyzeAndGeneratePrompts(apiKeys, transcript, style, addLog) {
  addLog('🧠 Gemini đang phân tích kịch bản truyện...');
  const prompt = `You are an expert video director. Analyze this audio story transcript and create 5 different Veo 3.1 video prompts for looping background videos that perfectly match the story's mood and theme.

STORY TRANSCRIPT (excerpt):
${transcript.slice(0, 4000)}

VISUAL STYLE: ${style}

REQUIREMENTS:
1. Each prompt creates a LOOPABLE background video (seamless loop, no abrupt cuts)
2. Videos should be atmospheric, cinematic — suitable as background for story narration
3. Each of the 5 prompts must be VISUALLY DISTINCT (different setting, mood, time of day)
4. Match the story's genre (horror = dark/fog/night; fantasy = magical/ethereal; romance = warm/golden; thriller = urban/noir; etc.)
5. NO people talking or prominent faces — background atmosphere only
6. Each video should work as a 8-second seamless loop

Return ONLY valid JSON (no markdown):
{
  "story_genre": "horror/fantasy/romance/thriller/adventure/etc",
  "story_mood": "brief mood description",
  "story_setting": "main setting of the story",
  "prompts": [
    {
      "id": 1,
      "title": "Short title for this option (Vietnamese OK)",
      "description": "1 sentence why this fits the story (Vietnamese OK)",
      "veo_prompt": "Full Veo 3.1 prompt in English — atmospheric background video, seamless loop, [visual style], [setting], [lighting], [movement], [mood], no people, no dialogue, loopable motion, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"
    },
    { "id": 2, ... },
    { "id": 3, ... },
    { "id": 4, ... },
    { "id": 5, ... }
  ]
}`;

  const raw = await callGemini(apiKeys, prompt, 3000);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Gemini không trả về JSON hợp lệ');
  const data = JSON.parse(m[0]);
  if (!Array.isArray(data.prompts) || data.prompts.length < 5) throw new Error('Không đủ 5 prompts');
  addLog(`✅ Phân tích xong: thể loại "${data.story_genre}" — ${data.story_mood}`);
  return data;
}

// ─── Gọi Veo để tạo video ─────────────────────────────────────────────────────
async function generateVeoVideo(prompt, addLog, taskId) {
  addLog(`🎬 [${taskId}] Đang gọi Veo tạo video...`);
  // Gọi qua IPC đến main process (dùng veo-engine đã có)
  const result = await window.electronAPI?.veoGenerateSingle({ prompt, duration: '8s', aspectRatio: '16:9', taskId });
  if (!result?.videoPath) throw new Error(result?.error || 'Veo không trả về video');
  addLog(`✅ [${taskId}] Video tạo xong`);
  return result.videoPath;
}

// ─── ffmpeg loop video để khớp audio duration ─────────────────────────────────
async function loopVideoForAudio(videoPath, audioPath, outputPath, addLog) {
  addLog('⚙️ ffmpeg: Đang loop video khớp audio...');
  const result = await window.electronAPI?.ffmpegLoopVideo({ videoPath, audioPath, outputPath });
  if (!result?.success) throw new Error(result?.error || 'ffmpeg loop thất bại');
  addLog(`✅ Video hoàn chỉnh: ${result.outputPath}`);
  return result.outputPath;
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function StoryLoopPanel() {
  const [audioFile, setAudioFile]         = useState(null);
  const [transcript, setTranscript]       = useState('');
  const [style, setStyle]                 = useState('Cinematic Dark Fantasy');
  const [step, setStep]                   = useState('idle'); // idle|analyzing|generating|selecting|looping|done
  const [storyData, setStoryData]         = useState(null);   // { story_genre, prompts[] }
  const [videoResults, setVideoResults]   = useState([]);     // [{id, prompt, videoPath, status}]
  const [selectedVideo, setSelectedVideo] = useState(null);   // index
  const [outputPath, setOutputPath]       = useState('');
  const [logs, setLogs]                   = useState([]);
  const [logsOpen, setLogsOpen]           = useState(true);
  const [genProgress, setGenProgress]     = useState(0);      // 0-5 videos generated
  const logEndRef = useRef(null);
  const stopRef   = useRef(false);

  const addLog = useCallback((msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setLogs(prev => [...prev.slice(-200), { msg, type, ts }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const STYLES = [
    'Cinematic Dark Fantasy', 'Photorealistic Nature',
    'Anime / Studio Ghibli', 'Horror Atmospheric',
    'Epic Fantasy', 'Urban Noir', 'Romantic Soft',
  ];

  // ── Step 1: Upload audio & nhập transcript ──────────────────────────────────
  const handleAudioDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    setAudioFile({ name: file.name, path: file.path || '', size: file.size });
    addLog(`✅ Audio: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  };

  // ── Step 2: Phân tích + tạo prompts ────────────────────────────────────────
  const handleAnalyze = async () => {
    const apiKeys = loadKeys();
    if (!apiKeys.length) return addLog('❌ Chưa có Gemini API key', 'error');
    if (!transcript.trim()) return addLog('❌ Cần nhập kịch bản/transcript', 'error');

    setStep('analyzing');
    setLogs([]);
    stopRef.current = false;

    try {
      const data = await analyzeAndGeneratePrompts(apiKeys, transcript, style, addLog);
      setStoryData(data);

      // Khởi tạo videoResults với 5 slots
      setVideoResults(data.prompts.map(p => ({ id: p.id, title: p.title, description: p.description, prompt: p.veo_prompt, videoPath: null, status: 'pending' })));
      setStep('generating');
      setGenProgress(0);

      // Tạo 5 video tuần tự
      addLog('🚀 Bắt đầu tạo 5 video với Veo...');
      const results = [...data.prompts.map(p => ({ id: p.id, title: p.title, description: p.description, prompt: p.veo_prompt, videoPath: null, status: 'pending' }))];

      for (let i = 0; i < data.prompts.length; i++) {
        if (stopRef.current) { addLog('⛔ Đã dừng'); break; }
        const p = data.prompts[i];
        addLog(`\n📹 Đang tạo video ${i + 1}/5: "${p.title}"...`);

        results[i] = { ...results[i], status: 'generating' };
        setVideoResults([...results]);

        try {
                const videoPath = await generateVeoVideo(p.veo_prompt, addLog, `Story${i + 1}`);
          results[i] = { ...results[i], videoPath, status: 'done' };
          setGenProgress(i + 1);
        } catch (e) {
          addLog(`⚠️ Video ${i + 1} lỗi: ${e.message}`, 'warn');
          results[i] = { ...results[i], status: 'error', error: e.message };
        }
        setVideoResults([...results]);
      }

      const successCount = results.filter(r => r.status === 'done').length;
      addLog(`\n✅ Tạo xong ${successCount}/5 video. Hãy chọn 1 video để loop.`);
      setStep('selecting');
    } catch (e) {
      addLog(`❌ Lỗi: ${e.message}`, 'error');
      setStep('idle');
    }
  };

  // ── Step 3: Loop video đã chọn + ghép audio ────────────────────────────────
  const handleLoop = async () => {
    if (selectedVideo === null) return addLog('❌ Chọn 1 video trước', 'error');
    if (!audioFile?.path) return addLog('❌ Cần chọn file audio', 'error');

    const chosen = videoResults[selectedVideo];
    if (!chosen?.videoPath) return addLog('❌ Video chưa sẵn sàng', 'error');

    setStep('looping');
    try {
      const outName = `story_loop_${Date.now()}.mp4`;
      const outPath = await window.electronAPI?.joinDownloadsPath(outName);
      const finalPath = await loopVideoForAudio(chosen.videoPath, audioFile.path, outPath || outName, addLog);
      setOutputPath(finalPath);
      setStep('done');
      addLog(`\n🎉 Hoàn tất! Video: ${finalPath}`, 'success');
    } catch (e) {
      addLog(`❌ Loop thất bại: ${e.message}`, 'error');
      setStep('selecting');
    }
  };

  const handleReset = () => {
    setStep('idle'); setStoryData(null); setVideoResults([]);
    setSelectedVideo(null); setOutputPath(''); setGenProgress(0); setLogs([]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-slate-900 text-white p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <span className="text-2xl">🎙️</span> Story Loop
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Gemini phân tích kịch bản → Veo tạo 5 video nền → Chọn 1 → ffmpeg loop khớp audio
          </p>
        </div>
        {step !== 'idle' && (
          <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] text-slate-300">
            <RefreshCw size={12}/> Làm lại
          </button>
        )}
      </div>

      {/* Step 1 — Input */}
      <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50 space-y-3 shrink-0">
        <div className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">① Audio truyện</div>

        {/* Audio drop */}
        <div
          onDrop={handleAudioDrop} onDragOver={e => e.preventDefault()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition ${audioFile ? 'border-green-500/50 bg-green-900/10' : 'border-slate-600 hover:border-blue-500/50'}`}
          onClick={() => document.getElementById('sl-audio-input').click()}
        >
          <input id="sl-audio-input" type="file" accept="audio/*" className="hidden" onChange={handleAudioDrop}/>
          {audioFile ? (
            <div className="flex items-center justify-center gap-2 text-green-400">
              <Music2 size={16}/>
              <span className="text-[12px] font-medium">{audioFile.name}</span>
              <span className="text-[10px] text-slate-500">({(audioFile.size/1024/1024).toFixed(1)} MB)</span>
            </div>
          ) : (
            <div className="text-slate-500 text-[11px]">
              <UploadCloud size={20} className="mx-auto mb-1 opacity-50"/>
              Kéo thả hoặc click để chọn file audio truyện
            </div>
          )}
        </div>

        {/* Transcript */}
        <div>
          <label className="text-[10px] text-slate-400 font-bold uppercase mb-1 block">
            Kịch bản / Transcript (dán nội dung truyện vào đây)
          </label>
          <textarea
            value={transcript} onChange={e => setTranscript(e.target.value)}
            placeholder="Dán toàn bộ nội dung truyện hoặc transcript audio vào đây để Gemini phân tích theme, mood, bối cảnh..."
            className="w-full h-28 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-[11px] text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-blue-500"
          />
          <div className="text-[9px] text-slate-600 mt-0.5">{transcript.length} ký tự — Gemini sẽ dùng 4000 ký tự đầu để phân tích</div>
        </div>

        {/* Style */}
        <div>
          <label className="text-[10px] text-slate-400 font-bold uppercase mb-1 block">Phong cách visual</label>
          <div className="flex flex-wrap gap-1.5">
            {STYLES.map(s => (
              <button key={s} onClick={() => setStyle(s)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition ${style === s ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {step === 'idle' && (
          <button onClick={handleAnalyze}
            disabled={!transcript.trim()}
            className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 rounded-xl text-[13px] font-black text-white flex items-center justify-center gap-2 transition">
            <Sparkles size={15}/> Phân tích & Tạo 5 Video Nền
          </button>
        )}
      </div>

      {/* Step 2 — Generating */}
      {(step === 'analyzing' || step === 'generating') && (
        <div className="bg-slate-800/60 rounded-xl p-4 border border-blue-700/30 shrink-0">
          <div className="text-[11px] font-bold text-blue-300 mb-3 flex items-center gap-2">
            <Loader2 size={13} className="animate-spin"/>
            {step === 'analyzing' ? 'Gemini đang phân tích kịch bản...' : `Veo đang tạo video (${genProgress}/5)...`}
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
              style={{ width: `${step === 'analyzing' ? 10 : (genProgress / 5) * 90 + 10}%` }}
            />
          </div>

          {/* Video slots */}
          {videoResults.length > 0 && (
            <div className="grid grid-cols-5 gap-2">
              {videoResults.map((v, i) => (
                <div key={v.id} className={`rounded-lg p-2 text-center text-[9px] border transition ${
                  v.status === 'done' ? 'border-green-500/50 bg-green-900/20 text-green-400' :
                  v.status === 'generating' ? 'border-blue-500/50 bg-blue-900/20 text-blue-400' :
                  v.status === 'error' ? 'border-red-500/30 bg-red-900/10 text-red-400' :
                  'border-slate-600/30 bg-slate-800/30 text-slate-600'
                }`}>
                  <div className="text-lg mb-1">
                    {v.status === 'done' ? '✅' : v.status === 'generating' ? '⏳' : v.status === 'error' ? '❌' : '⬜'}
                  </div>
                  <div className="font-bold line-clamp-2">{v.title || `Video ${i+1}`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Select video */}
      {(step === 'selecting' || step === 'looping' || step === 'done') && videoResults.length > 0 && (
        <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50 shrink-0">
          <div className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-3">② Chọn video nền để loop</div>

          <div className="space-y-2 mb-4">
            {videoResults.map((v, i) => (
              <div key={v.id}
                onClick={() => v.status === 'done' && setSelectedVideo(i)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedVideo === i ? 'border-blue-500 bg-blue-900/20 ring-1 ring-blue-500' :
                  v.status === 'done' ? 'border-slate-600/50 hover:border-slate-500 bg-slate-800/40' :
                  'border-slate-700/30 bg-slate-800/20 opacity-50 cursor-not-allowed'
                }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] shrink-0 ${
                  selectedVideo === i ? 'bg-blue-600' : v.status === 'done' ? 'bg-slate-700' : 'bg-slate-800'
                }`}>
                  {selectedVideo === i ? <Check size={14}/> : v.status === 'done' ? <Video size={14} className="text-slate-400"/> : v.status === 'error' ? '❌' : '⏳'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-slate-200">{v.title}</div>
                  <div className="text-[10px] text-slate-500 line-clamp-1">{v.description}</div>
                  {v.status === 'error' && <div className="text-[9px] text-red-400 mt-0.5">{v.error}</div>}
                </div>
                {v.status === 'done' && v.videoPath && (
                  <div className="text-[9px] text-green-400 shrink-0">✅ Sẵn sàng</div>
                )}
              </div>
            ))}
          </div>

          {step === 'selecting' && (
            <button onClick={handleLoop}
              disabled={selectedVideo === null || !audioFile?.path}
              className="w-full py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-40 rounded-xl text-[13px] font-black text-white flex items-center justify-center gap-2 transition">
              <Film size={15}/> Loop Video Này Khớp Audio
            </button>
          )}

          {step === 'looping' && (
            <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-blue-300">
              <Loader2 size={14} className="animate-spin"/> ffmpeg đang loop video khớp audio...
            </div>
          )}

          {step === 'done' && outputPath && (
            <div className="space-y-2">
              <div className="bg-green-900/20 border border-green-500/40 rounded-xl p-3 text-[11px] text-green-300 flex items-center gap-2">
                <Check size={14}/> Video hoàn chỉnh: <span className="text-green-200 font-mono text-[10px] break-all">{outputPath}</span>
              </div>
              <button
                onClick={() => window.electronAPI?.openOutputPath(outputPath)}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-[12px] text-slate-200 flex items-center justify-center gap-2">
                <Download size={13}/> Mở thư mục output
              </button>
            </div>
          )}
        </div>
      )}

      {/* Log panel */}
      <div className="bg-[#050810] rounded-xl border border-slate-700/40 shrink-0">
        <button onClick={() => setLogsOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-slate-500 hover:text-slate-300">
          <span className="font-bold uppercase tracking-widest">📋 Log ({logs.length})</span>
          {logsOpen ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
        </button>
        {logsOpen && (
          <div className="px-3 pb-3 max-h-40 overflow-y-auto space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-[10px] text-slate-600 py-2 text-center">Chưa có log</div>
            ) : logs.map((l, i) => (
              <div key={i} className={`text-[10px] font-mono ${
                l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-green-400' : l.type === 'warn' ? 'text-yellow-400' : 'text-slate-400'
              }`}>
                <span className="text-slate-600 mr-1">[{l.ts}]</span>{l.msg}
              </div>
            ))}
            <div ref={logEndRef}/>
          </div>
        )}
      </div>
    </div>
  );
}
