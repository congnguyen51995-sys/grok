import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateCinematicPrompts } from '../services/geminiPrompt';
import { generateScript } from '../services/scriptGenerator';
import {
  transcribeAudio, createTimeBasedChunks, analyzeScenes, analyzeOverallContent,
  exportToTxt, exportToJson, exportToMarkdown
} from '../services/audioToVideo';
import {
  Play, Square, FolderOpen, CheckCircle2, Loader2, Zap, Music2,
  AlertCircle, ChevronRight, Film, Image as ImageIcon, Sparkles,
  FileText, Brain, Layers, Copy, Check, ChevronDown, ChevronUp,
  Video, Scissors, ExternalLink, Cpu, Wand2,
  UploadCloud, Download, Clock, Mic, RefreshCw,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const LS_KEYS = 'fluxy_gemini_api_keys';

const PLATFORMS = ['TikTok dọc', 'YouTube ngang', 'YouTube Shorts', 'Instagram Reels', 'Facebook'];
const LANGUAGES = [
  { v: 'vi',   l: 'Tiếng Việt'   },
  { v: 'en',   l: 'English'      },
  { v: 'ja',   l: '日本語'        },
  { v: 'zh',   l: 'Tiếng Trung'  },
  { v: 'ko',   l: '한국어'        },
  { v: 'fr',   l: 'Français'     },
  { v: 'es',   l: 'Español'      },
  { v: 'de',   l: 'Deutsch'      },
  { v: 'th',   l: 'ภาษาไทย'      },
  { v: 'none', l: 'Không lời thoại' },
];

// Tự động chọn tỉ lệ khung hình theo nền tảng
const PLATFORM_RATIO = {
  'TikTok dọc':       '9:16',
  'YouTube ngang':    '16:9',
  'YouTube Shorts':   '9:16',
  'Instagram Reels':  '9:16',
  'Facebook':         '16:9',
};
const STYLES    = ['Photorealistic', 'Cinematic 4K', 'Anime / Manga', 'Pixar 3D', 'Studio Ghibli', 'Dark Fantasy', 'Watercolor'];
const RATIOS    = ['9:16', '16:9', '1:1'];
const DURS_VEO  = [4, 6, 8];
const DURS_GROK = [6, 10];
const IMG_MDL   = ['Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];
const VID_MDL   = ['Veo 3.1 - Lite [Lower Priority]', 'Veo 3.1 - Lite (Fast)', 'Veo 3.1 - Fast (Balanced)'];

// Engine-specific step labels
const STEPS_VEO = [
  { id: 'check',  label: 'Kiểm tra Extension',   icon: Zap      },
  { id: 'script', label: 'Viết kịch bản',         icon: FileText },
  { id: 'prompt', label: 'Tạo AI Prompts',         icon: Brain    },
  { id: 'dna',    label: 'Ảnh DNA tham chiếu',    icon: Sparkles },
  { id: 'video',  label: 'Tạo video Veo',          icon: Film     },
  { id: 'merge',  label: 'Ghép video cuối',        icon: Scissors },
];
const STEPS_GROK = [
  { id: 'check',  label: 'Kiểm tra Extension', icon: Zap       },
  { id: 'script', label: 'Viết kịch bản',       icon: FileText  },
  { id: 'prompt', label: 'Tạo AI Prompts',       icon: Brain     },
  { id: 'dna',    label: 'Ảnh DNA tham chiếu',  icon: Sparkles  },
  { id: 'video',  label: 'Tạo video R2V ×5',    icon: Wand2     },
  { id: 'merge',  label: 'Ghép video cuối',      icon: Scissors  },
];

const RESULT_TABS = [
  { id: 'script', label: 'Kịch bản',   step: 'script' },
  { id: 'prompt', label: 'Prompts',    step: 'prompt' },
  { id: 'dna',    label: 'DNA Ref',    step: 'dna'    },
  { id: 'video',  label: 'Videos',     step: 'video'  },
  { id: 'merge',  label: 'Video cuối', step: 'merge'  },
];

function cn(...c) { return c.filter(Boolean).join(' '); }
function toFileUrl(p) { return p ? 'file:///' + p.replace(/\\/g, '/') : ''; }
function loadKeys() { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); } catch { return []; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Mini components ─────────────────────────────────────────────────────────
function FolderRow({ label, value, onChange }) {
  const pick = async () => { const f = await window.electronAPI?.selectFolder?.(); if (f) onChange(f); };
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 truncate min-w-0">
          {value || <span className="text-slate-700">Chưa chọn...</span>}
        </div>
        <button onClick={pick} className="p-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors">
          <FolderOpen size={12} className="text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function StepBadge({ step, status }) {
  const Icon = step.icon;
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-left',
      status === 'active'  && 'bg-violet-500/10 border-violet-500/30',
      status === 'done'    && 'bg-emerald-500/5 border-emerald-500/20',
      status === 'error'   && 'bg-red-500/10 border-red-500/30',
      status === 'pending' && 'border-slate-800/80 bg-slate-900/30',
    )}>
      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0',
        status === 'active'  && 'bg-violet-500/20',
        status === 'done'    && 'bg-emerald-500/15',
        status === 'error'   && 'bg-red-500/20',
        status === 'pending' && 'bg-slate-800',
      )}>
        {status === 'active'  ? <Loader2 size={12} className="text-violet-400 animate-spin" />
         : status === 'done'  ? <CheckCircle2 size={12} className="text-emerald-400" />
         : status === 'error' ? <AlertCircle size={12} className="text-red-400" />
         : <Icon size={12} className="text-slate-700" />}
      </div>
      <span className={cn('text-[10px] font-semibold leading-tight',
        status === 'active'  && 'text-violet-300',
        status === 'done'    && 'text-emerald-300',
        status === 'error'   && 'text-red-400',
        status === 'pending' && 'text-slate-700',
      )}>{step.label}</span>
    </div>
  );
}

// ─── Idea to Video ────────────────────────────────────────────────────────────
function IdeaToVideoPanel() {
  const [apiKeys]   = useState(loadKeys);
  const [idea,       setIdea]      = useState('');
  const [platform,   setPlatform]  = useState('YouTube ngang');
  const [language,   setLang]      = useState('vi');
  const [style,      setStyle]     = useState('Photorealistic');
  const [videoEngine, setVideoEngine] = useState('veo'); // 'veo' | 'grok'
  const [sceneDur,   setSceneDur]  = useState(8);
  const [totalMins,  setMins]      = useState(3);
  const [ratio,      setRatio]     = useState('16:9');
  const [imgMdl,     setImgMdl]    = useState('Nano Banana Pro');
  const [vidMdl,     setVidMdl]    = useState('Veo 3.1 - Lite [Lower Priority]');
  const [refDir,     setRefDir]    = useState('');
  const [vidDir,     setVidDir]    = useState('');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);
  const [profiles,   setProfiles]  = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);

  // Pipeline state
  const [running,    setRunning]   = useState(false);
  const [activeStep, setActive]    = useState(null);
  const [doneSteps,  setDone]      = useState([]);
  const [errorStep,  setErrStep]   = useState(null);
  const [error,      setError]     = useState('');
  const [logOpen,    setLogOpen]   = useState(true);

  // Results
  const [scriptText,   setScriptText]   = useState('');
  const [promptsList,  setPromptsList]  = useState([]);
  const [dnaImgs,      setDnaImgs]      = useState([]);
  const [videoPaths,   setVideoPaths]   = useState([]);
  const [mergedPath,   setMergedPath]   = useState('');
  const [activeTab,    setActiveTab]    = useState('script');
  const [copied,       setCopied]       = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const logsRef  = useRef(null);
  const stopRef  = useRef(false);

  const DURS  = videoEngine === 'grok' ? DURS_GROK : DURS_VEO;
  const STEPS = videoEngine === 'grok' ? STEPS_GROK : STEPS_VEO;
  const GROK_MAX_WORKERS = 5;
  const numScenes = Math.max(1, Math.round((totalMins * 60) / sceneDur));

  // When engine changes, clamp sceneDur to valid options
  const handleEngineChange = (eng) => {
    setVideoEngine(eng);
    const validDurs = eng === 'grok' ? DURS_GROK : DURS_VEO;
    if (!validDurs.includes(sceneDur)) setSceneDur(validDurs[0]);
  };

  useEffect(() => {
    window.electronAPI?.getSetting('profiles', null).then(json => {
      if (!json) return;
      try {
        const profs = JSON.parse(json);
        if (profs?.length) {
          setProfiles(profs);
          setSelectedProfileId(prev => prev ?? profs[0].id);
        }
      } catch (_) {}
    });
  }, []);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;

      // Real-time video detection: "Lưu thành công: filename.mp4"
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }

      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };

  const handleStop = () => { stopRef.current = true; };

  const handleStart = async () => {
    if (!idea.trim())       { setError('Vui lòng nhập ý tưởng hoặc kịch bản.'); return; }
    if (!apiKeys.length)   { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
    if (!refDir || !vidDir) { setError('Vui lòng chọn đủ thư mục lưu file.'); return; }
    if (videoEngine === 'grok' && !selectedProfileId) { setError('Vui lòng chọn Profile Grok để chạy.'); return; }

    setRunning(true); setError(''); setLogs([]);
    setDone([]); setActive(null); setErrStep(null);
    setScriptText(''); setPromptsList([]); setDnaImgs([]);
    setVideoPaths([]); setMergedPath('');
    stopRef.current = false;

    try {
      // ── 1. Check Extension ────────────────────────────────────────────────
      setActive('check');
      addLog('Kiểm tra kết nối Extension Veo Studio...', 'info');
      const ck = await window.electronAPI?.checkVeoCookie?.();
      if (!ck?.success) throw new Error(`Extension chưa kết nối! ${ck?.error || 'Hãy F5 Google Labs.'}`);
      addLog('✅ Extension đã kết nối — sẵn sàng!', 'success');
      markDone('check');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 2. Generate Script (dùng đúng logic Creator ScriptWriterPanel) ─────
      setActive('script'); setActiveTab('script');
      const langLabel = LANGUAGES.find(l => l.v === language)?.l || 'Tiếng Việt';
      addLog(`Đang viết kịch bản (${numScenes} cảnh × ${sceneDur}s, ${platform})...`, 'info');

      const sText = await generateScript(apiKeys, {
        topic:         idea,
        platform,
        sceneDuration: sceneDur,
        totalDuration: totalMins,
        language,                   // 'vi' | 'en' | 'ja' | 'zh'
        style,
        // Defaults cho goal/tone/audience — khớp với giá trị mặc định Creator
        goal:     'Giải trí & Viral',
        tone:     'Bi tráng & Hào hùng',
        audience: 'Người trẻ (Gen Z & Alpha)',
      }, (evt) => {
        if (evt.type === 'chunk')
          addLog(evt.message, 'info');
        else if (evt.type === 'chunk_done' && evt.total > 25)
          setScriptText(evt.scriptSoFar);   // update preview progressively
        else if (evt.type === 'key_switch')
          addLog(evt.message, 'info');
      });

      if (!sText) throw new Error('AI không tạo được kịch bản.');
      setScriptText(sText);
      addLog(`✅ Kịch bản hoàn thành — ${numScenes} cảnh, ngôn ngữ ${langLabel}`, 'success');
      markDone('script');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 3. Generate Prompts ───────────────────────────────────────────────
      setActive('prompt'); setActiveTab('prompt');
      addLog('Đang phân tích DNA & tạo AI Prompts từ kịch bản...', 'info');

      const langCode = {
        vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
        ko: 'ko-KR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', th: 'th-TH',
        none: 'no-dialogue',
      }[language] || 'vi-VN';
      const pRes = await generateCinematicPrompts(apiKeys, {
        subject: sText, quantity: numScenes,
        sceneDuration: sceneDur, style, language: langCode,
        characters: [], environments: [],
      }, ({ message, phase, fromIdx, toIdx }) => {
        if (message) addLog(message, 'info');
        if (phase === 'key_switch') addLog(`🔄 Key ${fromIdx+1} → Key ${toIdx+1}`, 'info');
      });

      const scenes   = pRes?.prompts  || [];
      const fullJson = pRes?.fullJson  || {};
      if (!scenes.length) throw new Error('Không tạo được prompts.');
      setPromptsList(scenes);
      addLog(`✅ Tạo xong ${scenes.length} prompts`, 'success');

      // ── Tự động lưu prompts.txt vào thư mục video ──
      try {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const txtContent = scenes.map((s, i) => `[Cảnh ${i+1}]\n${s.promptText}`).join('\n\n');
        const txtPath = `${vidDir}\\prompts_${ts}.txt`;
        const wr = await window.electronAPI.writeTextFile({ content: txtContent, filePath: txtPath });
        if (wr?.success) addLog(`📄 Đã lưu prompts.txt → ${txtPath}`, 'success');
      } catch (_) {}

      markDone('prompt');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 4. DNA Reference Images — Veo dùng Veo Studio, Grok dùng Grok Studio ──
      setActive('dna'); setActiveTab('dna');
      const dna = fullJson?.dna || pRes?.analysis?.dna;
      const dnaTasks = [];
      const charDnaTaskMap = new Map(); // taskId ('dna_c0') → charId ('char_1')
      dna?.characters?.forEach((c,i) => {
        if (c.dna_prompt) {
          dnaTasks.push({ id: `dna_c${i}`, prompt: c.dna_prompt });
          charDnaTaskMap.set(`dna_c${i}`, c.id);
        }
      });

      let dnaImgPaths = [];
      let dnaMediaIds = []; // UUID gốc từ batchGenerateImages — dùng trực tiếp làm Ingredients (chỉ Veo)
      const charImgMap   = {}; // charId → local file path
      const charMediaMap = {}; // charId → UUID (Veo only)

      if (dnaTasks.length) {
        if (videoEngine === 'veo') {
          // ── Veo Studio: batchGenerateImages → trả về file path + UUID
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu bằng Veo Studio...`, 'info');
          const r = await window.electronAPI.runVeo({ mediaType:'Image', tasks:dnaTasks, aspectRatio:ratio, model:imgMdl, genCount:'1x', quality:'720p', outputFolder:refDir, duration:null });
          const dnaResults = (r?.files||[]).filter(f=>!f.isError&&f.filePath);
          dnaImgPaths = dnaResults.map(f=>f.filePath);
          dnaMediaIds = dnaResults.map(f=>f.mediaId).filter(Boolean);
          dnaResults.forEach(f => {
            const cid = charDnaTaskMap.get(f.id);
            if (cid) { if (f.filePath) charImgMap[cid] = f.filePath; if (f.mediaId) charMediaMap[cid] = f.mediaId; }
          });
          setDnaImgs(dnaImgPaths);
          addLog(`✅ [Veo] Tạo xong ${dnaImgPaths.length}/${dnaTasks.length} ảnh DNA${dnaMediaIds.length ? ` (${dnaMediaIds.length} UUID sẵn có)` : ''}`, 'success');
        } else {
          // ── Grok Studio: TEXT_TO_IMAGE jobs → poll cho đến khi xong
          const selectedProf = profiles.find(p => p.id === selectedProfileId) || profiles[0];
          const grokProfileId   = selectedProf?.id   || 1;
          const grokProfileName = selectedProf?.name || 'Auto Animation';
          await window.electronAPI.setConcurrency(GROK_MAX_WORKERS);

          addLog(`[Grok] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu bằng Grok Studio...`, 'info');
          const dnaJobMap = new Map(); // jobId → taskIdx
          const dnaTs = Date.now();
          for (let i = 0; i < dnaTasks.length; i++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            const t = dnaTasks[i];
            const jobId = await window.electronAPI.createJob({
              prompt:      t.prompt,
              mode:        'TEXT_TO_IMAGE',
              aspectRatio: ratio,
              quality:     '1K',
              profileId:   grokProfileId,
              profileName: grokProfileName,
              fileIndex:   `dna_${dnaTs}_${i}`,
            });
            dnaJobMap.set(jobId, i);
            addLog(`[Grok DNA] Job #${jobId} → nhân vật ${i+1}`, 'info');
          }

          // Poll cho đến khi tất cả DNA jobs xong
          const dnaRemaining = new Set(dnaJobMap.keys());
          while (dnaRemaining.size > 0) {
            if (stopRef.current) throw new Error('Đã dừng.');
            await sleep(4000);
            const allJobs = await window.electronAPI.getJobs();
            for (const job of allJobs) {
              if (!dnaRemaining.has(job.id)) continue;
              if (job.status === 'COMPLETED' && job.local_file_path) {
                const taskIdx = dnaJobMap.get(job.id);
                const cid = charDnaTaskMap.get(dnaTasks[taskIdx]?.id);
                if (cid) charImgMap[cid] = job.local_file_path;
                dnaImgPaths.push(job.local_file_path);
                dnaRemaining.delete(job.id);
                addLog(`✅ [Grok DNA] Ảnh ${taskIdx+1} xong: ${job.local_file_path.split(/[\\/]/).pop()}`, 'success');
              } else if (job.status === 'FAILED' || job.status === 'CANCELLED') {
                addLog(`⚠️ [Grok DNA] Ảnh ${dnaJobMap.get(job.id)+1} thất bại — bỏ qua`, 'error');
                dnaRemaining.delete(job.id);
              }
            }
          }
          setDnaImgs(dnaImgPaths);
          addLog(`✅ [Grok] Tạo xong ${dnaImgPaths.length}/${dnaTasks.length} ảnh DNA tham chiếu`, 'success');
        }
      } else {
        addLog('⚠️ Không có DNA entity — bỏ qua ảnh tham chiếu', 'info');
      }
      markDone('dna');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Videos — Veo: Ingredients | Grok: R2V ─────────────────────────────
      setActive('video'); setActiveTab('video');
      const engineLabel  = videoEngine === 'grok' ? 'Grok' : 'Veo';
      const maxVidWorkers = videoEngine === 'grok' ? GROK_MAX_WORKERS : 8;
      const MAX_VIDEO_RETRY = 10;
      const vPaths = [];

      const buildVideoPrompt = (sceneObj) => {
        const base     = sceneObj?.promptText || sceneObj?.fullData?.final_prompt || 'smooth cinematic motion';
        const dialogue = (sceneObj?.fullData?.dialogue || '').trim();
        // Tên tiếng Anh cho Veo 3.1 — dùng display name sẽ bị Veo hiểu sai
        const LANG_EN = {
          vi: 'Vietnamese', 'vi-VN': 'Vietnamese',
          en: 'English',    'en-US': 'English',
          ja: 'Japanese',   'ja-JP': 'Japanese',
          zh: 'Chinese',    'zh-CN': 'Chinese',
          ko: 'Korean',     'ko-KR': 'Korean',
          fr: 'French',     'fr-FR': 'French',
          es: 'Spanish',    'es-ES': 'Spanish',
          de: 'German',     'de-DE': 'German',
          th: 'Thai',       'th-TH': 'Thai',
        };
        const langLabel_ = LANG_EN[language] || LANG_EN[language?.split('-')[0]] || 'Vietnamese';
        const noTextSuffix = 'no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only';
        // Tiền tố ngôn ngữ — giúp Veo nhận diện ngôn ngữ audio ngay từ đầu prompt
        const langPrefix = `[${langLabel_} voice],`;
        const ensureLangPrefix = (s) => s.startsWith(`[${langLabel_}`) ? s : `${langPrefix} ${s}`;
        if (!dialogue) return base;
        if (base.includes(dialogue)) {
          // final_prompt đã có dialogue — đảm bảo tiền tố ngôn ngữ và no-text suffix
          const withSuffix = base.includes('no on-screen text') ? base : `${base}, ${noTextSuffix}`;
          return ensureLangPrefix(withSuffix);
        }
        // Fallback: dialogue không khớp trong final_prompt (AI dịch sai) — gắn lại đúng ngôn ngữ
        return `${langPrefix} ${base}, character speaks ${langLabel_}: "${dialogue}", spoken audio only, ${noTextSuffix}`;
      };

      if (videoEngine === 'veo') {
        // ── VEO: Ingredients mode — batch retry ─────────────────────────────
        const hasMediaIds = dnaMediaIds.length > 0;
        const hasDnaImages = dnaImgPaths.length > 0;
        if (!hasDnaImages && !hasMediaIds)
          addLog('⚠️ [Veo] Không có ảnh DNA — cảnh có nhân vật sẽ chạy text-to-video.', 'info');

        addLog(`[Veo] Batch ${scenes.length} video — mỗi cảnh chỉ dùng DNA của nhân vật xuất hiện trong cảnh đó...`, 'info');

        // Map taskId → sceneIdx để giữ đúng thứ tự prompt
        const veoTaskMap = new Map();
        const orderedVPaths = new Array(scenes.length).fill(null);

        let pendingTasks = scenes.map((s, i) => {
          const tid = `vid_${i}`;
          veoTaskMap.set(tid, i);
          // Lọc DNA theo nhân vật xuất hiện trong cảnh này
          const sceneCharIds = s.fullData?.characters_in_scene || [];
          const sceneMediaIds = sceneCharIds.map(id => charMediaMap[id]).filter(Boolean);
          const sceneImgPaths = sceneCharIds.map(id => charImgMap[id]).filter(Boolean);
          const task = { id: tid, prompt: buildVideoPrompt(s) };
          if (hasMediaIds && sceneMediaIds.length > 0) {
            task.ingredientMediaIds = sceneMediaIds;
          } else if (sceneImgPaths.length > 0) {
            task.ingredientImages = sceneImgPaths;
          }
          // Cảnh không có nhân vật → text-to-video (không gắn ingredient)
          addLog(`[Veo] Cảnh ${i+1}: ${sceneCharIds.length > 0 ? `${sceneCharIds.join(', ')} → ${sceneMediaIds.length || sceneImgPaths.length} ảnh DNA` : 'không có nhân vật → text-to-video'}`, 'info');
          return task;
        });

        for (let attempt = 1; attempt <= MAX_VIDEO_RETRY && pendingTasks.length > 0; attempt++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          if (attempt > 1)
            addLog(`[Veo Ingredients] Thử lại lần ${attempt}: ${pendingTasks.length} video thất bại...`, 'info');

          const vr = await window.electronAPI.runVeo({
            mediaType: 'Video',
            tasks: pendingTasks,
            aspectRatio: ratio, model: vidMdl, genCount: '1x',
            quality: '720p', outputFolder: vidDir, duration: `${sceneDur}s`,
          });

          const files = vr?.files || [];
          const succeeded = files.filter(f => !f.isError && f.filePath);
          const failedIds = new Set(files.filter(f => f.isError).map(f => f.id));

          succeeded.forEach(f => {
            const sceneIdx = veoTaskMap.get(f.id) ?? 0;
            orderedVPaths[sceneIdx] = f.filePath;
          });

          if (succeeded.length > 0)
            addLog(`✅ [Veo Ingredients] Lần ${attempt}: ${succeeded.length}/${pendingTasks.length} video thành công`, 'success');

          // Chuẩn bị retry
          pendingTasks = pendingTasks
            .filter(t => failedIds.has(t.id))
            .map(t => {
              const newId = `${t.id}_r${attempt}`;
              veoTaskMap.set(newId, veoTaskMap.get(t.id));
              veoTaskMap.delete(t.id);
              return { ...t, id: newId };
            });

          if (pendingTasks.length > 0) {
            if (attempt < MAX_VIDEO_RETRY)
              addLog(`⚠️ [Veo Ingredients] ${pendingTasks.length} video lỗi → thử lại...`, 'error');
            else
              addLog(`❌ [Veo Ingredients] ${pendingTasks.length} video vẫn lỗi sau ${MAX_VIDEO_RETRY} lần — bỏ qua`, 'error');
          }
        }

        // Đẩy vào vPaths theo đúng thứ tự cảnh
        const sortedVeo = orderedVPaths.filter(Boolean);
        sortedVeo.forEach(p => vPaths.push(p));
        setVideoPaths(sortedVeo);

      } else {
        // ── GROK: Grok Studio R2V queue (Reference to Video) ─────────────────
        addLog(`[Grok] Tạo ${scenes.length} video qua Grok Studio R2V (${GROK_MAX_WORKERS} luồng) — mỗi cảnh chỉ dùng DNA nhân vật xuất hiện...`, 'info');

        const selectedProf = profiles.find(p => p.id === selectedProfileId) || profiles[0];
        const grokProfileId   = selectedProf?.id   || 1;
        const grokProfileName = selectedProf?.name || 'Auto Animation';

        await window.electronAPI.setConcurrency(GROK_MAX_WORKERS);

        // Mảng kết quả theo đúng thứ tự cảnh
        const orderedGrokPaths = new Array(scenes.length).fill(null);
        let pendingScenes = scenes.map((s, i) => ({ sceneIdx: i, prompt: buildVideoPrompt(s), sceneObj: s }));
        const completedIdxs = new Set();

        for (let attempt = 1; attempt <= MAX_VIDEO_RETRY && pendingScenes.length > 0; attempt++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          if (attempt > 1)
            addLog(`[Grok] Thử lại lần ${attempt}: ${pendingScenes.length} cảnh chưa xong...`, 'info');

          // Submit tất cả cảnh pending lên hàng đợi Grok Studio
          const jobMap = new Map(); // jobId → sceneIdx
          const r2vBaseTs = Date.now();
          for (const s of pendingScenes) {
            if (stopRef.current) throw new Error('Đã dừng.');
            // Lọc DNA theo nhân vật xuất hiện trong cảnh này
            const sceneCharIds = s.sceneObj?.fullData?.characters_in_scene || [];
            const sceneImgPaths = sceneCharIds.map(id => charImgMap[id]).filter(Boolean);
            const sceneRefImagesJson = JSON.stringify(sceneImgPaths.slice(0, 7));
            const sceneMode = sceneImgPaths.length > 0 ? 'REF_TO_VIDEO' : 'TEXT_TO_VIDEO';
            addLog(`[Grok] Cảnh ${s.sceneIdx+1}: ${sceneCharIds.length > 0 ? `${sceneCharIds.join(', ')} → ${sceneImgPaths.length} ảnh DNA` : 'không nhân vật → text-to-video'}`, 'info');
            const jobId = await window.electronAPI.createJob({
              prompt:      s.prompt,
              mode:        sceneMode,
              aspectRatio: ratio,
              quality:     '720p',
              duration:    sceneDur,
              imageFile:   sceneRefImagesJson,
              profileId:   grokProfileId,
              profileName: grokProfileName,
              fileIndex:   `r2v_${r2vBaseTs}_scene${s.sceneIdx}_a${attempt}`,
            });
            jobMap.set(jobId, s.sceneIdx);
            addLog(`[Grok] Cảnh ${s.sceneIdx + 1} → Job #${jobId}`, 'info');
          }

          // Poll cho đến khi tất cả job xong
          const remainingIds = new Set(jobMap.keys());
          addLog(`[Grok] Đang chờ ${remainingIds.size} job hoàn tất...`, 'info');

          while (remainingIds.size > 0) {
            if (stopRef.current) throw new Error('Đã dừng.');
            await sleep(3000);
            const allJobs = await window.electronAPI.getJobs();
            for (const job of allJobs) {
              if (!remainingIds.has(job.id)) continue;
              if (job.status === 'COMPLETED' && job.local_file_path) {
                const idx = jobMap.get(job.id);
                completedIdxs.add(idx);
                orderedGrokPaths[idx] = job.local_file_path; // lưu đúng vị trí cảnh
                addLog(`✅ [Grok] Cảnh ${idx + 1} xong: ${job.local_file_path.split(/[\\/]/).pop()}`, 'success');
                remainingIds.delete(job.id);
              } else if (job.status === 'FAILED' || job.status === 'CANCELLED') {
                const idx = jobMap.get(job.id);
                addLog(`⚠️ [Grok] Cảnh ${idx + 1} thất bại`, 'error');
                remainingIds.delete(job.id);
              }
            }
          }

          pendingScenes = pendingScenes.filter(s => !completedIdxs.has(s.sceneIdx));
          if (pendingScenes.length > 0) {
            if (attempt < MAX_VIDEO_RETRY)
              addLog(`⚠️ [Grok] ${pendingScenes.length} cảnh lỗi → thử lại (lần ${attempt + 1})...`, 'error');
            else
              addLog(`❌ [Grok] ${pendingScenes.length} cảnh vẫn lỗi sau ${MAX_VIDEO_RETRY} lần — bỏ qua`, 'error');
          }
        }

        // Đẩy vào vPaths theo đúng thứ tự cảnh
        const sortedGrok = orderedGrokPaths.filter(Boolean);
        sortedGrok.forEach(p => vPaths.push(p));
        setVideoPaths(sortedGrok);
      }

      if (!vPaths.length) throw new Error('Không tạo được video nào sau khi thử lại.');
      const totalExpected = scenes.length;
      addLog(`✅ [${engineLabel}] Tạo xong ${vPaths.length}/${totalExpected} video`, 'success');
      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 7. Merge Videos ───────────────────────────────────────────────────
      setActive('merge'); setActiveTab('merge');

      // Dùng vPaths (đã sắp đúng thứ tự cảnh) cho cả Veo lẫn Grok
      const mergeFiles = [...vPaths];
      addLog(`[${engineLabel}] Ghép ${mergeFiles.length} video theo thứ tự cảnh bằng Video Editor...`, 'info');

      if (mergeFiles.length >= 2) {
        const outName = `final_${Date.now()}`;
        // Ghép với hiệu ứng chuyển cảnh ngẫu nhiên (0.3s) — một số cặp có hiệu ứng, một số cắt thẳng
        const mr = await window.electronAPI.mergeVideo({
          files: mergeFiles, trimStart: 0, trimEnd: 0,
          transition: 'Ngẫu nhiên', outputFolder: vidDir, outputName: outName,
        });
        if (mr?.success && mr?.path) {
          setMergedPath(mr.path);
          addLog(`✅ Ghép video hoàn tất: ${outName}.mp4 (${mergeFiles.length} clip)`, 'success');
        } else {
          addLog(`⚠️ Ghép video lỗi: ${mr?.error || 'unknown'}`, 'error');
        }
      } else if (mergeFiles.length === 1) {
        addLog('⚠️ Chỉ có 1 video — bỏ qua bước ghép', 'info');
        setMergedPath(mergeFiles[0]);
      } else {
        addLog('⚠️ Không có video nào để ghép', 'error');
      }
      markDone('merge');

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally {
      setRunning(false);
    }
  };

  const stepStatus = (id) =>
    doneSteps.includes(id) ? 'done'
    : activeStep === id    ? 'active'
    : errorStep  === id    ? 'error'
    : 'pending';

  const availableTabs = RESULT_TABS.filter(t => {
    if (t.id === 'script') return !!scriptText;
    if (t.id === 'prompt') return promptsList.length > 0;
    if (t.id === 'dna')    return dnaImgs.length > 0;
    if (t.id === 'video')  return videoPaths.length > 0;
    if (t.id === 'merge')  return !!mergedPath;
    return false;
  });

  // ── Results renderer ───────────────────────────────────────────────────────
  const renderResults = () => {
    if (!availableTabs.length) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Film size={32} className="text-slate-700" />
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây khi pipeline chạy</p>
      </div>
    );

    const tab = activeTab;

    if (tab === 'script') return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <span className="text-xs font-bold text-slate-400">Kịch bản đã tạo</span>
          <button onClick={() => { navigator.clipboard.writeText(scriptText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-slate-300 transition-colors">
            {copied ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>} Copy
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#060b14] border border-slate-800 rounded-xl p-4 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
          {scriptText}
        </div>
      </div>
    );

    if (tab === 'prompt') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{promptsList.length} Prompts đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {promptsList.map((p, i) => (
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">Cảnh {i+1}</span>
                {p.title && <span className="text-[9px] text-slate-500 truncate">{p.title}</span>}
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-3">{p.promptText || p.final_prompt}</p>
            </div>
          ))}
        </div>
      </div>
    );

    if (tab === 'dna') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{dnaImgs.length} Ảnh DNA tham chiếu</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            {dnaImgs.map((p, i) => (
              <div key={i} className="aspect-square bg-slate-800 rounded-xl overflow-hidden group relative">
                <img src={toFileUrl(p)} alt={`DNA ${i+1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <button onClick={() => window.electronAPI?.openFile?.(p)} title="Mở ảnh"
                    className="p-1.5 bg-white/20 rounded-lg"><ExternalLink size={11} className="text-white"/></button>
                </div>
                <div className="absolute bottom-1.5 left-1.5 text-[8px] bg-black/70 text-white px-1.5 py-0.5 rounded-full font-bold">#{i+1}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (tab === 'video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className={cn('grid gap-1.5', ratio === '16:9' ? 'grid-cols-3' : 'grid-cols-4')}>
            {videoPaths.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', ratio === '9:16' ? 'aspect-[9/16]' : ratio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop />
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold leading-none">{i+1}</div>
                <button onClick={() => window.electronAPI?.openFile?.(p)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={9} className="text-white"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (tab === 'merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-sm font-bold text-emerald-300">Video hoàn chỉnh đã sẵn sàng!</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );

    return null;
  };

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── LEFT FORM ────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-violet-400" />
            <span className="text-xs font-bold text-white">Idea to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">Tự động: Kịch bản → Prompts → Ảnh DNA → Video Veo → Ghép</p>
        </div>

        <div className="flex-1 px-4 py-3 space-y-3.5">
          {/* Idea */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ý tưởng / Kịch bản *</label>
            <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={4}
              placeholder="Nhập ý tưởng hoặc kịch bản..." disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-700 resize-none focus:outline-none focus:border-violet-500/40 transition-colors"/>
          </div>

          {/* Engine Selector */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Chế độ tạo video</label>
            <div className="flex gap-2 mt-1">
              <button disabled={running} onClick={() => handleEngineChange('veo')}
                className={cn('flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1.5',
                  videoEngine === 'veo'
                    ? 'bg-blue-600 border-blue-500 text-white shadow shadow-blue-500/20'
                    : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                <Film size={11}/> Veo
              </button>
              <button disabled={running} onClick={() => handleEngineChange('grok')}
                className={cn('flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1.5',
                  videoEngine === 'grok'
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow shadow-emerald-500/20'
                    : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                <Wand2 size={11}/> Grok
              </button>
            </div>
            {videoEngine === 'veo' && (
              <p className="mt-1 text-[9px] text-blue-600 leading-relaxed">
                Ảnh DNA tạo bằng Veo Studio → video Ingredients nhân vật nhất quán.
              </p>
            )}
            {videoEngine === 'grok' && (
              <p className="mt-1 text-[9px] text-emerald-600 leading-relaxed">
                Ảnh DNA tạo bằng Grok Studio → video R2V từ ảnh tham chiếu.
              </p>
            )}
          </div>

          {/* Grok Profile Selector */}
          {videoEngine === 'grok' && (
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Profile Grok</label>
              {profiles.length === 0 ? (
                <div className="mt-1 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-[10px] text-red-400">
                  Chưa có profile — vào tab Grok Studio để tạo profile trước.
                </div>
              ) : (
                <select
                  value={selectedProfileId ?? ''}
                  onChange={e => setSelectedProfileId(Number(e.target.value))}
                  disabled={running}
                  className="w-full mt-1 bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-2 py-1.5 text-[10px] text-emerald-300 font-semibold focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                >
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Platform + Lang */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Nền tảng</label>
              <select value={platform} onChange={e => { const p = e.target.value; setPlatform(p); if (PLATFORM_RATIO[p]) setRatio(PLATFORM_RATIO[p]); }} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {PLATFORMS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ngôn ngữ</label>
              <select value={language} onChange={e=>setLang(e.target.value)} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {LANGUAGES.map(l=><option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Phong cách hình ảnh</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {STYLES.map(s=>(
                <button key={s} disabled={running} onClick={()=>setStyle(s)}
                  className={cn('px-2 py-1 rounded-lg text-[9px] font-semibold border transition-all',
                    style===s ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Ratio */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tỉ lệ khung hình</label>
            <div className="flex gap-1.5 mt-1">
              {RATIOS.map(r=>(
                <button key={r} disabled={running} onClick={()=>setRatio(r)}
                  className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    ratio===r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Scene Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
              Thời lượng 1 cảnh
            </label>
            {videoEngine === 'veo' ? (
              <div className="mt-1 bg-slate-800/40 border border-violet-700/30 rounded-lg px-3 py-1.5 text-[10px] text-violet-300 font-bold text-center">
                8s (Ingredients)
              </div>
            ) : (
              <div className="flex gap-1.5 mt-1">
                {DURS.map(d=>(
                  <button key={d} disabled={running} onClick={()=>setSceneDur(d)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                      sceneDur===d ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                    {d}s
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Total Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
              Tổng thời lượng &nbsp;<span className="text-violet-400 normal-case font-bold">= {numScenes} cảnh</span>
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input type="number" min={1} max={30} value={totalMins} onChange={e=>setMins(+e.target.value||1)}
                disabled={running}
                className="w-16 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 text-center focus:outline-none"/>
              <span className="text-[10px] text-slate-600">phút</span>
            </div>
          </div>

          {/* Models — chỉ hiện khi engine = Veo */}
          {videoEngine === 'veo' && (
            <div className="border-t border-slate-800/60 pt-3 space-y-2">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Model AI</label>
              <div>
                <label className="text-[9px] text-slate-700">Tạo ảnh</label>
                <select value={imgMdl} onChange={e=>setImgMdl(e.target.value)} disabled={running}
                  className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                  {IMG_MDL.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-slate-700">Tạo video (Ingredients)</label>
                <select value={vidMdl} onChange={e=>setVidMdl(e.target.value)} disabled={running}
                  className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                  {VID_MDL.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Folders */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2.5">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Thư mục lưu file</label>
            <FolderRow label="Ảnh DNA tham chiếu" value={refDir} onChange={setRefDir} />
            <FolderRow label="Video xuất ra"       value={vidDir} onChange={setVidDir} />
          </div>
        </div>

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error && (
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running ? (
            <button onClick={handleStart}
              className={cn('w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg',
                videoEngine === 'grok'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 shadow-violet-500/20')}>
              <Play size={13} fill="currentColor"/>
              Bắt đầu · {videoEngine === 'grok' ? 'Grok' : 'Veo'}
            </button>
          ) : (
            <button onClick={handleStop}
              className="w-full bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs">
              <Square size={12} fill="currentColor"/> Dừng pipeline
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">

        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tiến trình tự động</p>
            <span className={cn('text-[8px] font-black px-2 py-0.5 rounded-full',
              videoEngine === 'grok'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-blue-500/15 text-blue-400')}>
              {videoEngine === 'grok' ? '⚡ Grok Mode (×5)' : '🎬 Veo · Ingredients'}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {STEPS.map(s=><StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
          </div>
        </div>

        {/* Results tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-800/60">
              {availableTabs.map(t => (
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab===t.id ? 'text-violet-300 border-violet-500' : 'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id==='prompt' && promptsList.length>0 && <span className="ml-1 text-[8px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">{promptsList.length}</span>}
                  {t.id==='video'  && videoPaths.length>0 && <span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* LOG PANEL (Veo Studio style, collapsible) */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen ? 'h-48' : 'h-9')}>
          <button onClick={()=>setLogOpen(v=>!v)}
            className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running && <span className="ml-auto flex items-center gap-1 text-[9px] text-violet-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running && logs.length > 0 && (
              <button onClick={e=>{e.stopPropagation();setLogs([]);}} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen && (
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length===0 && <p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l,i)=>(
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type==='error'   && 'text-red-400',
                    l.type==='success' && 'text-emerald-400',
                    l.type==='info'    && 'text-slate-500',
                  )}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audio to Video ───────────────────────────────────────────────────────────
const STEPS_AUDIO = [
  { id: 'prepare',    label: 'Kiểm tra file',     icon: UploadCloud },
  { id: 'extract',    label: 'Nén + Bóc tách',    icon: Mic         },
  { id: 'transcribe', label: 'Gemini AI',          icon: Brain       },
  { id: 'chunk',      label: 'Chia Timeline',      icon: Clock       },
  { id: 'generate',   label: 'Tạo Prompts',        icon: Sparkles    },
  { id: 'video',      label: 'Tạo Video',          icon: Film        },
  { id: 'merge',      label: 'Ghép video',         icon: Scissors    },
];

const RESULT_TABS_AUDIO = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'analysis',   label: 'Phân tích'  },
  { id: 'chunks',     label: 'Chunks'     },
  { id: 'prompts',    label: 'Prompts'    },
  { id: 'video',      label: 'Videos'     },
  { id: 'merge',      label: 'Video cuối' },
];

const VID_MDL_AUDIO = ['Veo 3.1 - Lite [Lower Priority]', 'Veo 3.1 - Lite (Fast)', 'Veo 3.1 - Fast (Balanced)'];
const GROK_MAX_W_AUDIO = 5;

function downloadBlob(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const ATV_SETTINGS_KEY = 'fluxy_atv_settings';
function loadAtvSettings() {
  try { return JSON.parse(localStorage.getItem(ATV_SETTINGS_KEY) || '{}'); } catch { return {}; }
}
function saveAtvSettings(patch) {
  try {
    const cur = loadAtvSettings();
    localStorage.setItem(ATV_SETTINGS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (_) {}
}

function AudioToVideoPanel() {
  const _s = loadAtvSettings();

  // File
  const [filePath,  setFilePath]  = useState('');
  const [fileName,  setFileName]  = useState('');
  const [sceneDur,  setSceneDur]  = useState(() => _s.sceneDur  || 8);

  // Video generation settings
  const [videoEngine,  setVideoEngine]  = useState(() => _s.videoEngine  || 'veo');
  const [vidSceneDur,  setVidSceneDur]  = useState(() => _s.vidSceneDur  || 8);
  const [vidRatio,     setVidRatio]     = useState(() => _s.vidRatio     || '9:16');
  const [vidModel,     setVidModel]     = useState(() => _s.vidModel     || 'Veo 3.1 - Lite [Lower Priority]');
  const [vidDir,       setVidDir]       = useState(() => _s.vidDir       || '');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);
  const [vidProfiles,  setVidProfiles]  = useState([]);
  const [vidProfileId, setVidProfileId] = useState(() => _s.vidProfileId || null);
  const [makeVideo,    setMakeVideo]    = useState(() => _s.makeVideo !== undefined ? _s.makeVideo : true);

  // Ghi nhớ settings khi thay đổi
  useEffect(() => { saveAtvSettings({ sceneDur });    }, [sceneDur]);
  useEffect(() => { saveAtvSettings({ videoEngine }); }, [videoEngine]);
  useEffect(() => { saveAtvSettings({ vidSceneDur }); }, [vidSceneDur]);
  useEffect(() => { saveAtvSettings({ vidRatio });    }, [vidRatio]);
  useEffect(() => { saveAtvSettings({ vidModel });    }, [vidModel]);
  useEffect(() => { saveAtvSettings({ vidDir });      }, [vidDir]);
  useEffect(() => { saveAtvSettings({ vidProfileId });}, [vidProfileId]);
  useEffect(() => { saveAtvSettings({ makeVideo });   }, [makeVideo]);

  // Pipeline
  const [running,    setRunning]   = useState(false);
  const [activeStep, setActive]    = useState(null);
  const [doneSteps,  setDone]      = useState([]);
  const [errorStep,  setErrStep]   = useState(null);
  const [error,      setError]     = useState('');
  const [logOpen,    setLogOpen]   = useState(true);
  const stopRef = useRef(false);

  // Results
  const [transcript,     setTranscript]     = useState(null);
  const [overallAnalysis,setOverallAnalysis] = useState(null);
  const [chunks,         setChunks]         = useState([]);
  const [scenes,         setScenes]         = useState([]);
  const [duration,       setDuration]       = useState(0);
  const [genProgress,  setGenProgress]  = useState({ current: 0, total: 0 });
  const [videoPaths,   setVideoPaths]   = useState([]);
  const [mergedPath,   setMergedPath]   = useState('');
  const [activeTab,    setActiveTab]    = useState('transcript');
  const [copiedAll,    setCopiedAll]    = useState(false);

  // Logs
  const [logs,    setLogs]    = useState([]);
  const logsRef               = useRef(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  // Load Grok profiles
  useEffect(() => {
    window.electronAPI?.getSetting('profiles', null).then(json => {
      if (!json) return;
      try {
        const profs = JSON.parse(json);
        if (profs?.length) { setVidProfiles(profs); setVidProfileId(prev => prev ?? profs[0].id); }
      } catch (_) {}
    });
  }, []);

  // Real-time video detection from Veo log
  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }
      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };

  const handlePickFile = async () => {
    const p = await window.electronAPI?.selectAudioFile?.();
    if (p) { setFilePath(p); setFileName(p.split(/[\\/]/).pop()); }
  };

  const handleEngineChange = (eng) => {
    setVideoEngine(eng);
    if (eng === 'grok') setVidSceneDur(d => [6,10].includes(d) ? d : 6);
    else setVidSceneDur(d => [4,6,8].includes(d) ? d : 8);
  };

  // Đổi thời lượng cảnh + tự động chọn engine phù hợp
  const handleSceneDurChange = (d) => {
    setSceneDur(d);
    if (d === 4 || d === 8) {
      setVideoEngine('veo');
      setVidSceneDur(d);
    } else if (d === 10) {
      setVideoEngine('grok');
      setVidSceneDur(10);
    }
    // 6s: không đổi engine, cả Veo lẫn Grok đều hỗ trợ
    if (d === 6) setVidSceneDur(6);
  };

  const handleReset = () => {
    setFilePath(''); setFileName(''); setTranscript(null); setOverallAnalysis(null);
    setChunks([]); setScenes([]); setDuration(0);
    setVideoPaths([]); setMergedPath('');
    setDone([]); setActive(null); setErrStep(null); setError('');
    setLogs([]); setGenProgress({ current: 0, total: 0 });
  };

  const handleStop = () => { stopRef.current = true; };

  const vidDurs = videoEngine === 'grok' ? [6, 10] : [4, 6, 8];

  const handleStart = async () => {
    // Capture tất cả settings tại thời điểm bấm Start — tránh stale closure
    const apiKeys         = loadKeys();
    const _sceneDur       = sceneDur;
    const _videoEngine    = videoEngine;
    const _vidSceneDur    = vidSceneDur;
    const _vidRatio       = vidRatio;
    const _vidModel       = vidModel;
    const _vidDir         = vidDir;
    const _vidProfileId   = vidProfileId;
    const _makeVideo      = makeVideo;

    if (!filePath)           { setError('Vui lòng chọn file audio hoặc video.'); return; }
    if (!apiKeys.length)     { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
    if (_makeVideo && !_vidDir) { setError('Vui lòng chọn thư mục lưu video.'); return; }
    if (_makeVideo && _videoEngine === 'grok' && !_vidProfileId) { setError('Vui lòng chọn Profile Grok.'); return; }

    setRunning(true); setError('');
    setDone([]); setActive(null); setErrStep(null);
    setTranscript(null); setOverallAnalysis(null); setChunks([]); setScenes([]);
    setVideoPaths([]); setMergedPath('');
    setGenProgress({ current: 0, total: 0 });
    stopRef.current = false;

    try {
      // ── 1. Kiểm tra file ──────────────────────────────────────────────────
      setActive('prepare');
      addLog(`Kiểm tra file: ${fileName}`, 'info');

      const prep = await window.electronAPI.prepareAudio(filePath);
      if (!prep.success) throw new Error(`Lỗi kiểm tra file: ${prep.error}`);
      if (stopRef.current) throw new Error('Đã dừng.');

      const totalSec = Math.floor(prep.duration);
      const totalScenes = Math.ceil(totalSec / _sceneDur);
      setDuration(totalSec);
      addLog(`✅ File hợp lệ — ${totalSec}s → ${totalScenes} cảnh (${_sceneDur}s/cảnh)`, 'success');
      markDone('prepare');

      // ── 2. Nén + Bóc tách audio ───────────────────────────────────────────
      setActive('extract');
      addLog('Đang nén + bóc tách audio (FFmpeg 16kbps mono 16kHz)...', 'info');

      const ext = await window.electronAPI.extractAudio(filePath);
      if (!ext.success) throw new Error(`Lỗi bóc tách audio: ${ext.error}`);
      if (stopRef.current) throw new Error('Đã dừng.');

      const kb = Math.round((ext.compressedSize || 0) / 1024);
      addLog(`✅ Bóc tách xong — file nén: ${kb} KB`, 'success');
      markDone('extract');

      // ── 3. Gemini AI: Transcribe + Phân tích tổng quát ───────────────────
      setActive('transcribe'); setActiveTab('transcript');
      addLog('Đang gửi audio lên Gemini (2.5 Flash Preview) để chuyển văn bản...', 'info');

      const result = await transcribeAudio(
        apiKeys,
        ext.base64,
        ext.mimeType,
        ({ fromIdx, toIdx }) => addLog(`🔄 Chuyển key ${fromIdx + 1}→${toIdx + 1}`, 'info')
      );
      if (stopRef.current) throw new Error('Đã dừng.');

      setTranscript(result);
      addLog(`✅ Transcript xong — ${result.segments.length} đoạn, ${result.fullText.split(' ').length} từ`, 'success');

      // Phân tích tổng quát (vẫn trong bước 3, dùng transcript text thay vì audio)
      addLog('Đang phân tích tổng quát nội dung...', 'info');
      let oa = null;
      try {
        oa = await analyzeOverallContent(
          apiKeys,
          result.fullText,
          ({ fromIdx, toIdx }) => addLog(`🔄 Chuyển key ${fromIdx + 1}→${toIdx + 1}`, 'info')
        );
        setOverallAnalysis(oa);
        addLog(`✅ Phân tích xong — ${oa.topic || ''}`, 'success');
      } catch (e) {
        addLog(`⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'error');
      }
      markDone('transcribe');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 4. Chia timeline ──────────────────────────────────────────────────
      setActive('chunk'); setActiveTab('chunks');
      addLog(`Chia ${totalSec}s thành ${totalScenes} chunks (${_sceneDur}s/chunk)...`, 'info');

      const timeChunks = createTimeBasedChunks(result.segments, totalSec, _sceneDur);
      setChunks(timeChunks);
      addLog(`✅ Chia xong ${timeChunks.length} chunks với timestamp chính xác`, 'success');
      markDone('chunk');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 4. Tạo Veo Prompts ────────────────────────────────────────────────
      setActive('generate'); setActiveTab('prompts');
      addLog(`Bắt đầu tạo ${timeChunks.length} Veo Prompts (Gemini)...`, 'info');
      setGenProgress({ current: 0, total: timeChunks.length });

      const generatedScenes = await analyzeScenes(
        apiKeys,
        timeChunks,
        _sceneDur,
        oa,
        (current, total, keyInfo) => {
          setGenProgress({ current, total });
          if (keyInfo) addLog(`Scene ${current}/${total} — ${keyInfo}`, 'info');
          else addLog(`Tạo prompt Scene ${current}/${total}...`, 'info');
        },
        (sceneData, isError) => {
          setScenes(prev => [...prev, sceneData]);
          if (isError) addLog(`⚠️ Scene ${sceneData.sceneNumber} dùng fallback: ${sceneData.error}`, 'error');
          else addLog(`✅ Scene ${sceneData.sceneNumber} xong`, 'success');
        }
      );

      setScenes(generatedScenes);
      const failCount = generatedScenes.filter(s => s.error).length;
      addLog(`🎉 Hoàn tất ${generatedScenes.length} prompts${failCount ? ` (${failCount} lỗi)` : ''}`, 'success');
      markDone('generate');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Tạo Video ──────────────────────────────────────────────────────
      if (!_makeVideo) { markDone('video'); markDone('merge'); return; }

      setActive('video'); setActiveTab('video');
      const engineLabel = _videoEngine === 'grok' ? 'Grok' : 'Veo';
      addLog(`[${engineLabel}] Bắt đầu tạo ${generatedScenes.length} video T2V...`, 'info');

      const vPaths = [];
      const MAX_VID_RETRY = 3;

      if (_videoEngine === 'veo') {
        let pendingTasks = generatedScenes.map((s, i) => ({
          id: `vid_${i}`,
          prompt: s.veoVideoPrompt,
        }));

        for (let attempt = 1; attempt <= MAX_VID_RETRY && pendingTasks.length > 0; attempt++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          if (attempt > 1) addLog(`[Veo] Thử lại lần ${attempt}: ${pendingTasks.length} video...`, 'info');

          const vr = await window.electronAPI.runVeo({
            mediaType: 'Video', tasks: pendingTasks,
            aspectRatio: _vidRatio, model: _vidModel,
            genCount: '1x', quality: '720p',
            outputFolder: _vidDir, duration: `${_vidSceneDur}s`,
          });

          const files = vr?.files || [];
          const succeeded = files.filter(f => !f.isError && f.filePath);
          const failedIds = new Set(files.filter(f => f.isError).map(f => f.id));
          succeeded.forEach(f => { vPaths.push(f.filePath); setVideoPaths(prev => [...prev, f.filePath]); });
          if (succeeded.length) addLog(`✅ [Veo] Lần ${attempt}: ${succeeded.length}/${pendingTasks.length} video OK`, 'success');
          pendingTasks = pendingTasks.filter(t => failedIds.has(t.id)).map(t => ({ ...t, id: `${t.id}_r${attempt}` }));
          if (pendingTasks.length && attempt < MAX_VID_RETRY) addLog(`⚠️ ${pendingTasks.length} video lỗi → thử lại...`, 'error');
        }

      } else {
        // Grok T2V
        const selectedProf = vidProfiles.find(p => p.id === _vidProfileId) || vidProfiles[0];
        await window.electronAPI.setConcurrency(GROK_MAX_W_AUDIO);

        let pendingScenes = generatedScenes.map((s, i) => ({ sceneIdx: i, prompt: s.veoVideoPrompt }));
        const completedIdxs = new Set();

        for (let attempt = 1; attempt <= MAX_VID_RETRY && pendingScenes.length > 0; attempt++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          if (attempt > 1) addLog(`[Grok] Thử lại lần ${attempt}: ${pendingScenes.length} cảnh...`, 'info');

          const jobMap = new Map();
          const t2vBaseTs = Date.now();
          for (const s of pendingScenes) {
            if (stopRef.current) throw new Error('Đã dừng.');
            const jobId = await window.electronAPI.createJob({
              prompt: s.prompt, mode: 'TEXT_TO_VIDEO',
              aspectRatio: _vidRatio, quality: '720p',
              duration: _vidSceneDur,
              profileId: selectedProf?.id, profileName: selectedProf?.name,
              fileIndex: `atv_${t2vBaseTs}_scene${s.sceneIdx}_a${attempt}`,
            });
            jobMap.set(jobId, s.sceneIdx);
            addLog(`[Grok] Job #${jobId} → Cảnh ${s.sceneIdx + 1}`, 'info');
          }

          const remainingIds = new Set(jobMap.keys());
          addLog(`[Grok] Chờ ${remainingIds.size} job hoàn tất...`, 'info');
          while (remainingIds.size > 0) {
            if (stopRef.current) throw new Error('Đã dừng.');
            await sleep(3000);
            const allJobs = await window.electronAPI.getJobs();
            for (const job of allJobs) {
              if (!remainingIds.has(job.id)) continue;
              if (job.status === 'COMPLETED' && job.local_file_path) {
                const idx = jobMap.get(job.id);
                completedIdxs.add(idx);
                vPaths.push(job.local_file_path);
                setVideoPaths(prev => [...prev, job.local_file_path]);
                addLog(`✅ [Grok] Cảnh ${idx + 1}: ${job.local_file_path.split(/[\\/]/).pop()}`, 'success');
                remainingIds.delete(job.id);
              } else if (job.status === 'FAILED' || job.status === 'CANCELLED') {
                addLog(`⚠️ [Grok] Job #${job.id} thất bại`, 'error');
                remainingIds.delete(job.id);
              }
            }
          }
          pendingScenes = pendingScenes.filter(s => !completedIdxs.has(s.sceneIdx));
        }
      }

      if (!vPaths.length) throw new Error('Không tạo được video nào.');
      addLog(`✅ [${engineLabel}] Tạo xong ${vPaths.length} video`, 'success');
      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 6. Ghép video ──────────────────────────────────────────────────────
      setActive('merge'); setActiveTab('merge');
      addLog('Đang ghép video...', 'info');

      let mergeFiles = [...vPaths];
      if (_videoEngine === 'veo') {
        const allFolderVideos = await window.electronAPI.readVideoFolder(_vidDir);
        mergeFiles = (allFolderVideos || []).filter(v => !v.name.startsWith('final_')).map(v => v.path);
      }

      if (mergeFiles.length >= 2) {
        const outName = `final_${Date.now()}`;
        const mr = await window.electronAPI.mergeVideo({
          files: mergeFiles, trimStart: 0, trimEnd: 0,
          transition: 'Ngẫu nhiên', outputFolder: _vidDir, outputName: outName,
        });
        if (mr?.success && mr?.path) {
          setMergedPath(mr.path);
          addLog(`✅ Ghép xong: ${outName}.mp4`, 'success');
        } else {
          addLog(`⚠️ Ghép lỗi: ${mr?.error || 'unknown'}`, 'error');
        }
      } else if (mergeFiles.length === 1) {
        setMergedPath(mergeFiles[0]);
        addLog('⚠️ Chỉ có 1 video — bỏ qua ghép', 'info');
      }
      markDone('merge');

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally {
      setRunning(false);
    }
  };

  const stepStatus = (id) =>
    doneSteps.includes(id) ? 'done'
    : activeStep === id    ? 'active'
    : errorStep  === id    ? 'error'
    : 'pending';

  const handleCopyAll = () => {
    if (!scenes.length) return;
    navigator.clipboard.writeText(exportToTxt(scenes));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleSaveTxt = async () => {
    const content = exportToTxt(scenes);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.txt` });
  };

  const handleSaveJson = async () => {
    const meta = { fileName, duration, sceneDuration: sceneDur };
    const content = exportToJson(scenes, meta);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.json` });
  };

  const handleSaveMd = async () => {
    const meta = { fileName, duration, sceneDuration: sceneDur };
    const content = exportToMarkdown(scenes, meta);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.md` });
  };

  // ── Render results ─────────────────────────────────────────────────────────
  const renderResults = () => {
    const hasData = transcript || overallAnalysis || chunks.length > 0 || scenes.length > 0;
    if (!hasData) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Music2 size={32} className="text-slate-700" />
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây</p>
      </div>
    );

    if (activeTab === 'transcript') return (
      <div className="h-full flex flex-col gap-3">
        {transcript && (
          <>
            <div className="shrink-0">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Full Transcript ({transcript.segments.length} đoạn)
              </p>
              <div className="bg-[#060b14] border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 leading-relaxed max-h-28 overflow-y-auto custom-scrollbar font-mono">
                {transcript.fullText || <span className="text-slate-600 italic">Không có lời thoại</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Segments với timestamp</p>
              {transcript.segments.map((seg, i) => (
                <div key={i} className="flex items-start gap-2 bg-[#0d1322] border border-slate-800 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] font-mono text-blue-400 shrink-0 w-24">
                    {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s
                  </span>
                  <span className="text-[10px] text-slate-300 leading-relaxed">{seg.text}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!transcript && <p className="text-xs text-slate-600">Chưa transcribe</p>}
      </div>
    );

    if (activeTab === 'analysis') return (
      <div className="h-full overflow-y-auto custom-scrollbar space-y-3 pr-1">
        {overallAnalysis ? (
          <>
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3 space-y-2">
              <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Chủ đề</p>
              <p className="text-[11px] text-slate-200 leading-relaxed">{overallAnalysis.topic}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-purple-400 uppercase tracking-widest mb-1.5">Tone & Style</p>
                <p className="text-[10px] text-slate-300">{overallAnalysis.tone}</p>
              </div>
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-amber-400 uppercase tracking-widest mb-1.5">Phong cách video</p>
                <p className="text-[10px] text-slate-300">{overallAnalysis.recommended_visual_style}</p>
              </div>
            </div>
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mb-1.5">Tóm tắt ngữ cảnh</p>
              <p className="text-[11px] text-slate-200 leading-relaxed">{overallAnalysis.context_summary}</p>
            </div>
            {overallAnalysis.key_entities?.length > 0 && (
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest mb-2">Thực thể chính</p>
                <div className="flex flex-wrap gap-1">
                  {overallAnalysis.key_entities.map((e, i) => (
                    <span key={i} className="text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2 py-0.5 rounded-full">{e}</span>
                  ))}
                </div>
              </div>
            )}
            {overallAnalysis.visual_themes?.length > 0 && (
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-violet-400 uppercase tracking-widest mb-2">Chủ đề hình ảnh</p>
                <div className="flex flex-wrap gap-1">
                  {overallAnalysis.visual_themes.map((t, i) => (
                    <span key={i} className="text-[9px] bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Cấu trúc kể chuyện</p>
              <p className="text-[10px] text-slate-300 leading-relaxed">{overallAnalysis.narrative_arc}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            {running && activeStep === 'transcribe'
              ? <div className="flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin text-blue-500"/><span className="text-xs">Đang phân tích...</span></div>
              : <p className="text-xs text-slate-600">Chưa phân tích</p>
            }
          </div>
        )}
      </div>
    );

    if (activeTab === 'chunks') return (
      <div className="h-full flex flex-col">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 shrink-0">
          {chunks.length} Chunks · {sceneDur}s/chunk — Timestamp được khóa cứng
        </p>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
          {chunks.map((c, i) => (
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Scene {c.scene}</span>
                <span className="text-[9px] font-mono text-slate-500">{c.time}</span>
              </div>
              <p className={cn('text-[10px] leading-relaxed', c.exactText.startsWith('[Không') ? 'text-slate-600 italic' : 'text-slate-300')}>
                {c.exactText}
              </p>
            </div>
          ))}
          {chunks.length === 0 && <p className="text-xs text-slate-600">Chưa chia chunks</p>}
        </div>
      </div>
    );

    if (activeTab === 'prompts') return (
      <div className="h-full flex flex-col gap-2">
        {/* Export bar */}
        {scenes.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mr-1">{scenes.length} prompts</span>
            <button onClick={handleCopyAll}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-slate-300 transition-colors">
              {copiedAll ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>} Copy tất cả
            </button>
            <button onClick={handleSaveTxt}
              className="flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-[10px] text-blue-300 transition-colors">
              <Download size={11}/> .txt
            </button>
            <button onClick={handleSaveJson}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700/60 hover:bg-slate-600 rounded-lg text-[10px] text-slate-400 transition-colors">
              <Download size={11}/> .json
            </button>
            <button onClick={handleSaveMd}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700/60 hover:bg-slate-600 rounded-lg text-[10px] text-slate-400 transition-colors">
              <Download size={11}/> .md
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {scenes.map((s, i) => (
            <div key={i} className={cn('bg-[#0d1322] border rounded-xl p-3', s.error ? 'border-red-800/40' : 'border-slate-800')}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Scene {s.sceneNumber}</span>
                <span className="text-[9px] font-mono text-slate-600">{s.timeEstimation}</span>
                {s.error && <span className="text-[8px] text-red-500 ml-auto">⚠ fallback</span>}
              </div>
              <p className="text-[9px] text-slate-600 mb-1.5 leading-relaxed line-clamp-2 italic">{s.dialogue}</p>
              <div className="bg-[#060b14] rounded-lg p-2 text-[10px] text-slate-300 leading-relaxed font-mono">
                {s.veoVideoPrompt}
              </div>
            </div>
          ))}
          {scenes.length === 0 && running && genProgress.total > 0 && (
            <div className="flex items-center justify-center h-20 gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin text-blue-500"/>
              <span className="text-xs">Đang tạo {genProgress.current}/{genProgress.total}...</span>
            </div>
          )}
          {scenes.length === 0 && !running && <p className="text-xs text-slate-600">Chưa tạo prompts</p>}
        </div>
      </div>
    );

    if (activeTab === 'video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {videoPaths.length === 0 && running && (
            <div className="flex items-center justify-center h-20 gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin text-blue-500"/>
              <span className="text-xs">Đang tạo video...</span>
            </div>
          )}
          <div className={cn('grid gap-1.5', vidRatio === '16:9' ? 'grid-cols-3' : 'grid-cols-4')}>
            {videoPaths.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', vidRatio === '9:16' ? 'aspect-[9/16]' : vidRatio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop />
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold">{i+1}</div>
                <button onClick={() => window.electronAPI?.openFile?.(p)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={9} className="text-white"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (activeTab === 'merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400"/>
              <span className="text-sm font-bold text-emerald-300">Video hoàn chỉnh đã sẵn sàng!</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );

    return null;
  };

  const availableTabs = RESULT_TABS_AUDIO.filter(t => {
    if (t.id === 'transcript') return !!transcript;
    if (t.id === 'analysis')   return !!overallAnalysis || (running && activeStep === 'transcribe');
    if (t.id === 'chunks')     return chunks.length > 0;
    if (t.id === 'prompts')    return scenes.length > 0 || (running && activeStep === 'generate');
    if (t.id === 'video')      return videoPaths.length > 0 || (running && activeStep === 'video');
    if (t.id === 'merge')      return !!mergedPath;
    return false;
  });

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── LEFT FORM ────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <Music2 size={13} className="text-blue-400" />
            <span className="text-xs font-bold text-white">Audio to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">Audio/Video → Transcript → Timeline Chunks → Veo Prompts</p>
        </div>

        <div className="flex-1 px-4 py-3 space-y-4">

          {/* File picker */}
          <div>
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">File audio / video *</p>
            <div
              onClick={handlePickFile}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all',
                filePath
                  ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-400/50'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600 border-dashed'
              )}
            >
              <UploadCloud size={14} className={filePath ? 'text-blue-400' : 'text-slate-600'} />
              <span className={cn('text-[10px] truncate flex-1', filePath ? 'text-blue-300' : 'text-slate-700')}>
                {fileName || 'Chọn MP3, WAV, M4A, OGG, MP4...'}
              </span>
              {filePath && (
                <button onClick={e => { e.stopPropagation(); handleReset(); }}
                  className="p-0.5 hover:text-red-400 text-slate-600 transition-colors">
                  <RefreshCw size={10}/>
                </button>
              )}
            </div>
            <p className="text-[8px] text-slate-700 mt-1">Hỗ trợ: mp3, wav, m4a, ogg, webm, mp4, mov</p>
          </div>

          {/* Scene duration */}
          <div>
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Thời lượng mỗi cảnh</p>
            <div className="flex gap-1.5">
              {[4, 6, 8, 10].map(d => {
                const autoLabel = d === 4 ? '→Veo' : d === 8 ? '→Veo' : d === 10 ? '→Grok' : null;
                return (
                  <button key={d} disabled={running} onClick={() => handleSceneDurChange(d)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex flex-col items-center leading-none gap-0.5',
                      sceneDur === d ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                    <span>{d}s</span>
                    {autoLabel && <span className={cn('text-[7px] font-semibold', sceneDur === d ? 'text-blue-200' : 'text-slate-700')}>{autoLabel}</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-[8px] text-slate-700 mt-1">
              {sceneDur === 4  ? '→ Tự động chọn Veo' :
               sceneDur === 6  ? '→ Chọn Veo hoặc Grok bên dưới' :
               sceneDur === 8  ? '→ Tự động chọn Veo' :
               sceneDur === 10 ? '→ Tự động chọn Grok' : ''}
            </p>
          </div>

          {/* Info */}
          {duration > 0 && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2.5 space-y-1">
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Thời lượng:</span>
                <span className="font-bold text-blue-300">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Số cảnh:</span>
                <span className="font-bold text-blue-300">{Math.ceil(duration / sceneDur)} cảnh</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Gemini keys:</span>
                <span className="font-bold text-emerald-400">{loadKeys().length} keys</span>
              </div>
            </div>
          )}

          {/* ── Video Generation Settings ── */}
          <div className="border-t border-slate-800/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tạo video luôn</label>
              <button onClick={() => setMakeVideo(v => !v)} disabled={running}
                className={cn('w-9 h-5 rounded-full transition-all relative', makeVideo ? 'bg-blue-600' : 'bg-slate-700')}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', makeVideo ? 'left-4' : 'left-0.5')}/>
              </button>
            </div>

            {makeVideo && (
              <>
                {/* Engine */}
                <div>
                  <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">
                    Engine
                    {sceneDur !== 6 && <span className="ml-1.5 text-[8px] text-amber-500 normal-case font-normal">(tự động theo thời lượng cảnh)</span>}
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      disabled={running || sceneDur !== 6}
                      onClick={() => handleEngineChange('veo')}
                      className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center justify-center gap-1',
                        videoEngine === 'veo'
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'border-slate-700/60 text-slate-600',
                        sceneDur !== 6 && videoEngine !== 'veo' && 'opacity-30 cursor-not-allowed',
                        sceneDur === 6 && videoEngine !== 'veo' && 'hover:border-slate-600 cursor-pointer')}>
                      <Film size={10}/> Veo
                    </button>
                    <button
                      disabled={running || sceneDur !== 6}
                      onClick={() => handleEngineChange('grok')}
                      className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center justify-center gap-1',
                        videoEngine === 'grok'
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'border-slate-700/60 text-slate-600',
                        sceneDur !== 6 && videoEngine !== 'grok' && 'opacity-30 cursor-not-allowed',
                        sceneDur === 6 && videoEngine !== 'grok' && 'hover:border-slate-600 cursor-pointer')}>
                      <Wand2 size={10}/> Grok
                    </button>
                  </div>
                </div>

                {/* Grok Profile */}
                {videoEngine === 'grok' && (
                  <div>
                    <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Profile Grok</label>
                    {vidProfiles.length === 0 ? (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5 text-[10px] text-red-400">Chưa có profile — vào Grok Studio tạo trước.</div>
                    ) : (
                      <select value={vidProfileId ?? ''} onChange={e => setVidProfileId(Number(e.target.value))} disabled={running}
                        className="w-full bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-2 py-1.5 text-[10px] text-emerald-300 font-semibold focus:outline-none cursor-pointer">
                        {vidProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </div>
                )}

                {/* Duration */}
                <div>
                  <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Thời lượng mỗi video</label>
                  <div className="flex gap-1.5">
                    {vidDurs.map(d => (
                      <button key={d} disabled={running} onClick={() => setVidSceneDur(d)}
                        className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                          vidSceneDur === d ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ratio */}
                <div>
                  <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Tỉ lệ</label>
                  <div className="flex gap-1.5">
                    {RATIOS.map(r => (
                      <button key={r} disabled={running} onClick={() => setVidRatio(r)}
                        className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                          vidRatio === r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Veo Model */}
                {videoEngine === 'veo' && (
                  <div>
                    <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Model Veo</label>
                    <select value={vidModel} onChange={e => setVidModel(e.target.value)} disabled={running}
                      className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                      {VID_MDL_AUDIO.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                )}

                {/* Output Folder */}
                <FolderRow label="Thư mục lưu video *" value={vidDir} onChange={setVidDir} />
              </>
            )}
          </div>

          {/* Generate progress */}
          {running && activeStep === 'generate' && genProgress.total > 0 && (
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-3 py-2">
              <div className="flex justify-between text-[9px] mb-1">
                <span className="text-slate-500">Tạo prompts</span>
                <span className="font-bold text-blue-300">{genProgress.current}/{genProgress.total}</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1">
                <div
                  className="bg-blue-500 rounded-full h-1 transition-all"
                  style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error && (
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running ? (
            <button onClick={handleStart}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg shadow-blue-500/20">
              <Play size={13} fill="currentColor"/> Bắt đầu xử lý
            </button>
          ) : (
            <button onClick={handleStop}
              className="w-full bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs">
              <Square size={12} fill="currentColor"/> Dừng
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">

        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-2">Tiến trình xử lý</p>
          <div className="grid grid-cols-7 gap-1.5">
            {STEPS_AUDIO.map(s => <StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
          </div>
        </div>

        {/* Result tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 border-b border-slate-800/60">
              {availableTabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab === t.id ? 'text-blue-300 border-blue-500' : 'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id === 'chunks'  && chunks.length > 0       && <span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{chunks.length}</span>}
                  {t.id === 'prompts' && scenes.length > 0       && <span className="ml-1 text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">{scenes.length}</span>}
                  {t.id === 'video'   && videoPaths.length > 0   && <span className="ml-1 text-[8px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* Log panel */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen ? 'h-44' : 'h-9')}>
          <button onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running && <span className="ml-auto flex items-center gap-1 text-[9px] text-blue-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running && logs.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setLogs([]); }} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen && (
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length === 0 && <p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type === 'error'   && 'text-red-400',
                    l.type === 'success' && 'text-emerald-400',
                    l.type === 'info'    && 'text-slate-500',
                  )}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
const SUB = [
  { id:'idea',  label:'Idea to Video',  icon:Zap,    color:'bg-violet-600' },
  { id:'audio', label:'Audio to Video', icon:Music2, color:'bg-blue-600'   },
];

export default function AutoAnimation() {
  const [panel, setPanel] = useState('idea');
  return (
    <div className="flex flex-col h-full w-full bg-[#080e1a]">
      <div className="h-11 shrink-0 flex items-center gap-3 px-5 border-b border-slate-800/80 bg-[#0a0f1e]">
        <div className="flex items-center gap-1.5 font-bold text-sm text-white">
          <Layers size={15} className="text-violet-400"/> Auto Animation
        </div>
        <ChevronRight size={12} className="text-slate-800"/>
        <div className="flex items-center gap-1">
          {SUB.map(p=>{
            const Ic=p.icon; const on=panel===p.id;
            return (
              <button key={p.id} onClick={()=>setPanel(p.id)}
                className={cn('flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all',
                  on ? `${p.color} text-white` : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/50')}>
                <Ic size={11}/> {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex" style={{ display: panel === 'idea'  ? 'flex' : 'none' }}><IdeaToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'audio' ? 'flex' : 'none' }}><AudioToVideoPanel/></div>
      </div>
    </div>
  );
}
