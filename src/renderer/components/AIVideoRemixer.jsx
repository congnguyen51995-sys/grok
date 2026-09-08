import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  TOOL_DECLARATIONS, executeTool, buildEditPlan,
  buildSystemPrompt, isVideoRequest,
  callGeminiPlan, callGeminiChat,
} from '../services/aiAgent';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const narrationText = (n) => typeof n === 'string' ? n : (n?.text || '');

const fileUrl = (p) => {
  if (!p) return null;
  // Accept asset object: prefer filePath (absolute) over path (may be remotion URL)
  const raw = (typeof p === 'object') ? (p.filePath || p.path) : p;
  if (!raw) return null;
  const s = String(raw);
  // Already a proper URL
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file:///')) return s;
  // Convert to file:/// with per-segment encoding (handles spaces, Vietnamese, #, etc.)
  return 'file:///' + s.replace(/\\/g, '/').split('/').map((seg, i) =>
    (i === 0 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg)
  ).join('/');
};
const fmtDur  = (s) => { if (!s) return '—'; const m = Math.floor(s/60); return m > 0 ? `${m}m${String(s%60).padStart(2,'0')}s` : `${s}s`; };

const PROD_STAGES = [
  { id:'research', icon:'🔍', label:'Nghiên cứu',    tools:['research_topic'] },
  { id:'plan',     icon:'📋', label:'Kịch bản',      tools:['plan_video','set_platform_config'] },
  { id:'voice',    icon:'🎙️', label:'Voice Over',    tools:['generate_tts'] },
  { id:'visual',   icon:'🖼️', label:'Hình ảnh / Video', tools:['acquire_broll','generate_image','search_stock_footage'] },
  { id:'audio',    icon:'🎵', label:'Nhạc & SFX',    tools:['add_background_music','add_sfx'] },
  { id:'render',    icon:'🎬', label:'Render',         tools:['render_video'] },
  { id:'qa',        icon:'✅', label:'Kiểm tra',       tools:['quality_check'] },
  { id:'seo',       icon:'📊', label:'SEO & Thumb',    tools:['generate_seo','generate_thumbnail','cleanup_output'] },
];

const RUNNING_LABELS = {
  plan_video:'Lên kế hoạch video', research_topic:'Nghiên cứu chủ đề', set_platform_config:'Cấu hình platform',
  acquire_broll:'Tìm B-roll', generate_image:'Tạo hình ảnh AI', generate_tts:'Tổng hợp giọng nói',
  add_background_music:'Thêm nhạc nền', add_sfx:'Thêm hiệu ứng âm thanh', generate_subtitles:'Tạo phụ đề',
  render_video:'Render video', quality_check:'Kiểm tra chất lượng', search_stock_footage:'Tìm stock footage',
  generate_seo:'Tạo SEO metadata', generate_thumbnail:'Tạo thumbnail', cleanup_output:'Dọn dẹp file tạm',
};

const VISUAL_ICONS = {
  broll:'🎥', ai_video:'🤖', ai_image:'🖼️', illustration:'🎨',
  graphic:'📊', chart:'📈', motion_graphic:'✨', text:'📝', talking_head:'👤',
};

const PRESETS = [
  { id:'auto',        label:'Auto',       icon:'⚡', color:'#a855f7', desc:'AI tự chọn phong cách' },
  { id:'documentary', label:'Documentary',icon:'🎬', color:'#6366f1', desc:'Phim tài liệu' },
  { id:'explainer',   label:'Explainer',  icon:'💡', color:'#0ea5e9', desc:'Giải thích, giáo dục' },
  { id:'news',        label:'News',       icon:'📰', color:'#ef4444', desc:'Tin tức' },
  { id:'story',       label:'Story',      icon:'📖', color:'#f59e0b', desc:'Câu chuyện' },
  { id:'finance',     label:'Finance',    icon:'💰', color:'#10b981', desc:'Tài chính, kinh tế' },
  { id:'history',     label:'History',    icon:'🏛️', color:'#8b5cf6', desc:'Lịch sử' },
  { id:'science',     label:'Science',    icon:'🔬', color:'#06b6d4', desc:'Khoa học' },
  { id:'shorts',      label:'Shorts',     icon:'📱', color:'#ec4899', desc:'Short-form viral' },
];

const MODELS = [
  { id:'gemini-3.5-flash',      label:'3.5 Flash (Default)'    },
  { id:'gemini-3.1-flash-lite', label:'3.1 Flash Lite (Cheap)' },
  { id:'gemini-3-flash-preview',label:'3.0 Flash Preview'      },
];
const FORMATS  = [{ id:'vi',icon:'🇻🇳',label:'Tiếng Việt'},{id:'en',icon:'🇺🇸',label:'English'},{id:'ja',icon:'🇯🇵',label:'日本語'},{id:'ko',icon:'🇰🇷',label:'한국어'}];
const DURATIONS= [{id:0,label:'Auto (AI tự chọn)'},{id:60,label:'1 phút'},{id:120,label:'2 phút'},{id:180,label:'3 phút'},{id:300,label:'5 phút'},{id:480,label:'8 phút'},{id:600,label:'10 phút'},{id:900,label:'15 phút'}];
const RATIOS   = [{id:'auto',label:'Auto (AI tự chọn)'},{id:'16:9',label:'16:9 YouTube'},{id:'9:16',label:'9:16 TikTok/Reels'},{id:'1:1',label:'1:1 Instagram'}];
const TTS_PROVIDERS=[{id:'edge',label:'Edge TTS',badge:'Free',color:'#3b82f6'},{id:'kokoro',label:'Kokoro',badge:'Local',color:'#8b5cf6'},{id:'vieneu',label:'VieNeu',badge:'Clone',color:'#f59e0b'},{id:'groq',label:'Groq',badge:'Fast',color:'#10b981'}];
const BROLL_MODES=[{id:'image',label:'AI Image',color:'#6366f1'},{id:'video',label:'AI Video',color:'#ec4899'},{id:'auto',label:'Auto',color:'#f59e0b'}];
const VEO_MODELS=[{id:'Veo 3.1 - Lite [Lower Priority]',label:'Veo 3.1 Lite'},{id:'Omni 1.1 Flash',label:'Omni 1.1 Flash'}];
const VOICE_MAP={
  edge:[
    {id:'vi-VN-NamMinhNeural',    label:'Nam Minh (VI Nam)',   lang:'vi'},
    {id:'vi-VN-HoaiMyNeural',     label:'Hoài My (VI Nữ)',     lang:'vi'},
    {id:'en-US-GuyNeural',        label:'Guy (EN Nam)',         lang:'en'},
    {id:'en-US-JennyNeural',      label:'Jenny (EN Nữ)',        lang:'en'},
    {id:'en-US-AriaNeural',       label:'Aria (EN Nữ)',         lang:'en'},
    {id:'en-US-ChristopherNeural',label:'Christopher (EN Nam)', lang:'en'},
    {id:'en-GB-RyanNeural',       label:'Ryan (EN-GB Nam)',     lang:'en'},
    {id:'en-GB-SoniaNeural',      label:'Sonia (EN-GB Nữ)',    lang:'en'},
    {id:'ja-JP-KeitaNeural',      label:'Keita (JA Nam)',       lang:'ja'},
    {id:'ja-JP-NanamiNeural',     label:'Nanami (JA Nữ)',       lang:'ja'},
    {id:'ko-KR-InJoonNeural',     label:'InJoon (KO Nam)',      lang:'ko'},
    {id:'ko-KR-SunHiNeural',      label:'SunHi (KO Nữ)',       lang:'ko'},
    {id:'zh-CN-YunxiNeural',      label:'Yunxi (ZH Nam)',       lang:'zh'},
    {id:'zh-CN-XiaoxiaoNeural',   label:'Xiaoxiao (ZH Nữ)',    lang:'zh'},
    {id:'fr-FR-HenriNeural',      label:'Henri (FR Nam)',       lang:'fr'},
    {id:'fr-FR-DeniseNeural',     label:'Denise (FR Nữ)',      lang:'fr'},
  ],
  groq:[
    {id:'Arista-PlayAI',   label:'Arista'  },{id:'Atlas-PlayAI',    label:'Atlas'    },
    {id:'Basil-PlayAI',    label:'Basil'   },{id:'Briggs-PlayAI',   label:'Briggs'   },
    {id:'Calum-PlayAI',    label:'Calum'   },{id:'Celeste-PlayAI',  label:'Celeste'  },
    {id:'Cheyenne-PlayAI', label:'Cheyenne'},{id:'Chip-PlayAI',     label:'Chip'     },
    {id:'Cillian-PlayAI',  label:'Cillian' },{id:'Deedee-PlayAI',   label:'Deedee'   },
    {id:'Fritz-PlayAI',    label:'Fritz'   },{id:'Gail-PlayAI',     label:'Gail'     },
    {id:'Giulia-PlayAI',   label:'Giulia'  },{id:'Grant-PlayAI',    label:'Grant'    },
    {id:'Grayson-PlayAI',  label:'Grayson' },{id:'Luca-PlayAI',     label:'Luca'     },
    {id:'Mitch-PlayAI',    label:'Mitch'   },{id:'Nia-PlayAI',      label:'Nia'      },
    {id:'Quinn-PlayAI',    label:'Quinn'   },{id:'Thunder-PlayAI',  label:'Thunder'  },
  ],
  kokoro:[
    {id:'af_heart',     label:'Heart (EN Nữ)',      lang:'en'},
    {id:'af_bella',     label:'Bella (EN Nữ)',      lang:'en'},
    {id:'af_sarah',     label:'Sarah (EN Nữ)',      lang:'en'},
    {id:'af_nicole',    label:'Nicole (EN Nữ)',     lang:'en'},
    {id:'af_sky',       label:'Sky (EN Nữ)',        lang:'en'},
    {id:'am_adam',      label:'Adam (EN Nam)',      lang:'en'},
    {id:'am_michael',   label:'Michael (EN Nam)',   lang:'en'},
    {id:'bf_emma',      label:'Emma (EN-GB Nữ)',   lang:'en'},
    {id:'bf_isabella',  label:'Isabella (EN-GB Nữ)',lang:'en'},
    {id:'bm_george',    label:'George (EN-GB Nam)', lang:'en'},
    {id:'bm_lewis',     label:'Lewis (EN-GB Nam)',  lang:'en'},
    {id:'jf_alpha',     label:'Alpha (JA Nữ)',      lang:'ja'},
    {id:'jf_gongitsune',label:'Gongitsune (JA Nữ)', lang:'ja'},
    {id:'jm_kurosawa',  label:'Kurosawa (JA Nam)',  lang:'ja'},
    {id:'jm_nezha',     label:'Nezha (JA Nam)',     lang:'ja'},
    {id:'zf_xiaobei',   label:'Xiaobei (ZH Nữ)',   lang:'zh'},
    {id:'zf_xiaoxiao',  label:'Xiaoxiao (ZH Nữ)',  lang:'zh'},
    {id:'zm_yunxi',     label:'Yunxi (ZH Nam)',     lang:'zh'},
    {id:'kf_dawon',     label:'Dawon (KO Nữ)',      lang:'ko'},
    {id:'km_hyunwoo',   label:'Hyunwoo (KO Nam)',   lang:'ko'},
    {id:'ff_siwis',     label:'Siwis (FR Nữ)',      lang:'fr'},
    {id:'ef_dora',      label:'Dora (ES Nữ)',       lang:'es'},
    {id:'hf_alpha',     label:'Alpha (HI Nữ)',      lang:'hi'},
  ],
  vieneu:[],
};
const LANG_VOICE_DEFAULTS={
  vi:{ edge:'vi-VN-NamMinhNeural',  kokoro:'af_heart',    groq:'Arista-PlayAI' },
  en:{ edge:'en-US-GuyNeural',      kokoro:'af_heart',    groq:'Arista-PlayAI' },
  ja:{ edge:'ja-JP-KeitaNeural',    kokoro:'jf_alpha',    groq:'Arista-PlayAI' },
  ko:{ edge:'ko-KR-InJoonNeural',   kokoro:'kf_dawon',    groq:'Arista-PlayAI' },
  zh:{ edge:'zh-CN-YunxiNeural',    kokoro:'zm_yunxi',    groq:'Arista-PlayAI' },
  fr:{ edge:'fr-FR-HenriNeural',    kokoro:'ff_siwis',    groq:'Arista-PlayAI' },
};
const getDefaultVoice=(provider,language)=>{
  const d=LANG_VOICE_DEFAULTS[language]||LANG_VOICE_DEFAULTS['vi'];
  return d[provider]||(VOICE_MAP[provider]||[])[0]?.id||'';
};
// Lọc danh sách voice theo ngôn ngữ đang chọn
const getVoiceOptions=(provider,language)=>{
  const all=VOICE_MAP[provider]||[];
  if(!all.length||!all[0].lang) return all; // groq không có lang → show hết
  const filtered=all.filter(v=>v.lang===language||v.lang===language.slice(0,2));
  // Nếu không có voice nào cho ngôn ngữ này → show tất cả (fallback)
  return filtered.length ? filtered : all;
};
const SFX_CATALOG=[
  {id:'whoosh',label:'Whoosh',cat:'transition',icon:'💨'},{id:'boom',label:'Boom',cat:'impact',icon:'💥'},
  {id:'chime',label:'Chime',cat:'ui',icon:'🔔'},{id:'pop',label:'Pop',cat:'ui',icon:'✨'},
  {id:'swoosh',label:'Swoosh',cat:'transition',icon:'🌊'},{id:'rain',label:'Rain',cat:'nature',icon:'🌧️'},
  {id:'wind',label:'Wind',cat:'ambient',icon:'🌬️'},{id:'heartbeat',label:'Heartbeat',cat:'impact',icon:'❤️'},
  {id:'typing',label:'Typing',cat:'ui',icon:'⌨️'},{id:'glass_break',label:'Glass Break',cat:'impact',icon:'💔'},
  {id:'fire',label:'Fire',cat:'ambient',icon:'🔥'},{id:'applause',label:'Applause',cat:'crowd',icon:'👏'},
];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AIVideoRemixer() {
  const api = window.electronAPI;

  // ── App mode (state machine) ──────────────────────────────────────────────
  const [appMode,  setAppMode]  = useState('home'); // 'home' | 'production' | 'editor'

  // ── Form / config ─────────────────────────────────────────────────────────
  const [command,      setCommand]      = useState('');
  const [preset,       setPreset]       = useState('auto');
  const [model,        setModel]        = useState('gemini-3.5-flash');
  const [lang,         setLang]         = useState('vi');
  const [duration,     setDuration]     = useState(0);
  const [ratio,        setRatio]        = useState('16:9');
  const [ttsProvider,  setTtsProvider]  = useState('edge');
  const [brollMode,    setBrollMode]    = useState('auto');
  const [veoModel,     setVeoModel]     = useState('Veo 3.1 - Lite [Lower Priority]');
  const [voice,        setVoice]        = useState('vi-VN-NamMinhNeural');
  const [outputDir,    setOutputDir]    = useState('');
  const [attachments,  setAttachments]  = useState([]);
  const [manualSfxList, setManualSfxList] = useState([]);

  // ── Runtime / production ──────────────────────────────────────────────────
  const [isRunning,      setIsRunning]      = useState(false);
  const [isThinking,     setIsThinking]     = useState(false);
  const [status,         setStatus]         = useState('');
  const [toolLog,        setToolLog]        = useState([]);
  const [planData,       setPlanData]       = useState(null);
  const [liveAssets,     setLiveAssets]     = useState([]);
  const [currentTool,    setCurrentTool]    = useState(null);
  const [renderPath,     setRenderPath]     = useState(null);
  const [aiStreamText,   setAiStreamText]   = useState(''); // streaming thinking text

  // ── Editor state ──────────────────────────────────────────────────────────
  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const [playhead,        setPlayhead]        = useState(0);
  const [isPlaying,       setIsPlaying]       = useState(false);
  const [timelineZoom,    setTimelineZoom]    = useState(50);
  const [showLog,         setShowLog]         = useState(false);
  const [leftPanelTab,    setLeftPanelTab]    = useState('media');
  const [mediaCat,        setMediaCat]        = useState('all');

  // ── VieNeu ────────────────────────────────────────────────────────────────
  const [vieNeuReady,       setVieNeuReady]       = useState(false);
  const [vieNeuSavedVoices, setVieNeuSavedVoices] = useState([]);
  const [vieNeuVoices,      setVieNeuVoices]      = useState([]);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [pendingExec,  setPendingExec]  = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [labsConnected, setLabsConnected] = useState(null); // null=chưa check, true/false

  const abortRef        = useRef(false);
  const runOverrideRef  = useRef(null);
  const apiKeysRef      = useRef([]);
  const projectStateRef = useRef(null);
  const videoRef        = useRef(null);
  const playIntervalRef = useRef(null);
  const langInitRef     = useRef(false);
  const chatEndRef      = useRef(null);
  const chatScrollRef   = useRef(null);
  const logScrollRef    = useRef(null);

  // Auto-scroll chat to bottom whenever messages update (streaming or new msg)
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  // Auto-scroll editor log tab when new tool entries arrive
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [toolLog.length]);

  // Switch to Media tab when first visual asset arrives
  const prevAssetCountRef = useRef(0);
  useEffect(() => {
    const visualCount = liveAssets.filter(a => a.type==='image' || a.type==='video').length;
    if (prevAssetCountRef.current === 0 && visualCount > 0 && appMode === 'editor') {
      setLeftPanelTab('media');
    }
    prevAssetCountRef.current = visualCount;
  }, [liveAssets.length, appMode]);

  // Auto-collapse settings when chat starts, auto-expand when chat cleared
  const prevChatLenRef = useRef(0);
  useEffect(() => {
    if (prevChatLenRef.current === 0 && chatMessages.length > 0) setSettingsOpen(false);
    if (chatMessages.length === 0) setSettingsOpen(true);
    prevChatLenRef.current = chatMessages.length;
  }, [chatMessages.length]);

  // Kiểm tra kết nối Extension/Google Labs khi mount + mỗi 30s
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await window.electronAPI?.labsCheckAuth?.();
        setLabsConnected(!!res?.connected);
      } catch (_) { setLabsConnected(false); }
    };
    checkAuth();
    const iv = setInterval(checkAuth, 30000);
    return () => clearInterval(iv);
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const activePreset = PRESETS.find(p => p.id === preset) || PRESETS[0];

  const segmentStatus = useMemo(() => {
    const map = {};
    for (const entry of toolLog) {
      const seg = entry.args?.segment_id ?? entry.args?.segmentId;
      if (seg == null) continue;
      const id = String(seg);
      if (!map[id]) map[id] = {};
      if (entry.name === 'generate_tts')
        map[id].tts = entry.status || (entry.done ? 'done' : 'running');
      if (['acquire_broll','generate_image','search_stock_footage'].includes(entry.name))
        map[id].visual = entry.status || (entry.done ? 'done' : 'running');
      if (['add_sfx'].includes(entry.name))
        map[id].sfx = entry.status || (entry.done ? 'done' : 'running');
      if (['add_background_music'].includes(entry.name))
        map[id].music = entry.status || (entry.done ? 'done' : 'running');
    }
    return map;
  }, [toolLog]);

  const progressPct = useMemo(() => {
    if (!planData?.segments?.length) return isRunning ? 5 : 0;
    const totalExpected = planData.segments.length * 3 + 3;
    const done = toolLog.filter(e => e.done && e.status !== 'error').length;
    return Math.min(Math.round((done / totalExpected) * 100), 98);
  }, [toolLog, planData, isRunning]);

  const prodStages = useMemo(() => PROD_STAGES.map(stage => {
    const entries = toolLog.filter(e => stage.tools.includes(e.name));
    const running = entries.some(e => !e.done);
    const done = entries.length > 0 && entries.every(e => e.done);
    return { ...stage, status: running ? 'running' : done ? 'done' : 'pending' };
  }), [toolLog]);

  const computedClips = useMemo(() => {
    if (!planData?.segments) return [];
    let cur = 0;
    return planData.segments.map(seg => {
      const segId = String(seg.id);
      const voiceAsset = liveAssets.find(a => String(a.segId) === segId && (a.type==='audio'||a.type==='voice'));
      const visualAsset = liveAssets.find(a => String(a.segId) === segId && ['image','video'].includes(a.type));
      const dur = voiceAsset?.duration ?? seg.duration_sec ?? 5;
      const start = cur;
      cur += dur;
      return { seg, start, dur, voiceAsset, visualAsset };
    });
  }, [planData, liveAssets]);

  const totalDuration = useMemo(() =>
    computedClips.reduce((s, c) => s + c.dur, 0) || 0,
    [computedClips]);

  const getSegmentAsset = useCallback((segId, type = null) =>
    liveAssets.find(a => String(a.segId) === String(segId) && (type ? a.type === type : ['image','video'].includes(a.type))),
    [liveAssets]);

  const currentToolLabel = useMemo(() => {
    if (!currentTool) return '';
    const label = RUNNING_LABELS[currentTool.name] || currentTool.name;
    const seg = currentTool.args?.segment_id;
    return seg != null ? `${label} — Scene ${seg}` : label;
  }, [currentTool]);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const keys = await api.getSetting('geminiApiKeys', []);
        apiKeysRef.current = Array.isArray(keys) ? keys : [keys].filter(Boolean);
        if (!apiKeysRef.current.length) {
          const lsKeys = (() => { try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; } })();
          if (lsKeys.length) apiKeysRef.current = lsKeys;
        }
        const sv = await api.getSetting('ttsVoice',    'vi-VN-NamMinhNeural');
        const sp = await api.getSetting('ttsProvider', 'edge');
        const so = await api.getSetting('outputDir',   '');
        const ss = await api.getSetting('videoPreset', 'auto');
        if (sv) setVoice(sv);
        if (sp) setTtsProvider(sp);
        if (so) setOutputDir(so);
        if (ss) setPreset(ss);
      } catch (_) {}

      // Auto-start Kokoro server in background (fire-and-forget)
      try { api.kokoroStartServer?.(); } catch (_) {}

      // Auto-load VieNeu voices if installed
      try {
        const st = await api.vieNeuCheckStatus?.();
        if (st?.installed) {
          setVieNeuReady(true);
          // Preset voices: [[desc, id], ...] tuples from list_preset_voices()
          const res = await api.vieNeuGetVoices?.();
          if (Array.isArray(res?.voices)) setVieNeuVoices(res.voices);
          // Clone voices: saved in localStorage by VoiceStudio
          try {
            const saved = JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]');
            setVieNeuSavedVoices(Array.isArray(saved) ? saved : []);
          } catch (_) {}
        }
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    if (ttsProvider !== 'vieneu') return;
    (async () => {
      try {
        const st = await api.vieNeuCheckStatus?.();
        setVieNeuReady(st?.installed || false);
        if (st?.installed) {
          const res = await api.vieNeuGetVoices?.();
          if (Array.isArray(res?.voices)) setVieNeuVoices(res.voices);
          try {
            const saved = JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]');
            setVieNeuSavedVoices(Array.isArray(saved) ? saved : []);
          } catch (_) {}
        }
      } catch (_) {}
    })();
  }, [ttsProvider]);

  useEffect(() => {
    if (!langInitRef.current) { langInitRef.current = true; return; }
    if (ttsProvider === 'vieneu') return;
    // Lấy default voice cho lang mới; nếu không có thì lấy voice đầu tiên trong filtered list
    const dv = getDefaultVoice(ttsProvider, lang)
            || getVoiceOptions(ttsProvider, lang)[0]?.id
            || '';
    if (dv) setVoice(dv);
  }, [lang]);

  // sync playhead with video element
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || appMode !== 'editor') return;
    const onTime = () => setPlayhead(vid.currentTime);
    vid.addEventListener('timeupdate', onTime);
    return () => vid.removeEventListener('timeupdate', onTime);
  }, [appMode]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const selectOutputDir = useCallback(async () => {
    try { const d = await api.remotionSelectOutputDir?.(); if (d) setOutputDir(d); } catch (_) {}
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    setIsRunning(false);
    setCurrentTool(null);
    setStatus('⛔ Đã dừng');
  }, []);

  const handleBackToHome = useCallback(() => {
    if (isRunning) handleStop();
    setAppMode('home');
    setPlanData(null);
    setLiveAssets([]);
    setToolLog([]);
    setRenderPath(null);
    setSelectedSceneId(null);
    setPlayhead(0);
    setIsPlaying(false);
  }, [isRunning, handleStop]);

  const handleOpenOutput = useCallback(async () => {
    const p = renderPath || planData?.render?.outputPath || planData?.render?.outputDir;
    if (p) try { await api.remotionOpenDir?.(p); } catch (_) {}
  }, [renderPath, planData]);

  const handlePlayToggle = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isPlaying) { vid.pause(); setIsPlaying(false); }
    else { vid.play(); setIsPlaying(true); }
  }, [isPlaying]);

  const handleSeekToScene = useCallback((segId) => {
    if (!planData?.segments) return;
    let cursor = 0;
    for (const seg of planData.segments) {
      if (seg.id === segId) break;
      cursor += seg.duration_sec || 5;
    }
    setPlayhead(cursor);
    setSelectedSceneId(segId);
    const vid = videoRef.current;
    if (vid && renderPath) vid.currentTime = cursor;
  }, [planData, renderPath]);

  const handleAttachFile = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    const readFile = (f) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result || '';
        const commaIdx = dataUrl.indexOf(',');
        const header = commaIdx > -1 ? dataUrl.slice(0, commaIdx) : '';
        const data   = commaIdx > -1 ? dataUrl.slice(commaIdx + 1) : '';
        const mimeType = header.match(/:(.*?);/)?.[1] || f.type || 'image/jpeg';
        resolve({ name: f.name, path: f.path, type: f.type?.startsWith('image') ? 'image' : 'file', mimeType, data });
      };
      reader.onerror = () => resolve({ name: f.name, path: f.path, type: 'file', mimeType: f.type || '', data: '' });
      reader.readAsDataURL(f);
    });
    const items = await Promise.all(files.map(readFile));
    setAttachments(prev => [...prev, ...items]);
    e.target.value = null;
  }, []);

  // ── MAIN AI AGENT LOOP ────────────────────────────────────────────────────
  const handleRun = useCallback(async (overrideExec) => {
    const keys = apiKeysRef.current;
    if (!keys.length) { setStatus('❌ Chưa có Gemini API key'); return; }

    abortRef.current = false;
    setIsRunning(true);
    setAppMode('production');
    setToolLog([]);
    setLiveAssets([]);
    setCurrentTool(null);
    setStatus('🚀 Khởi động AI...');
    setRenderPath(null);

    const projectState = { plan: null, assets: {}, assetRegistry: {}, lang };
    projectStateRef.current = projectState;

    let refImagePaths = [];
    try {
      const imgAttachments = attachments.filter(a => a.type === 'image');
      // f.path from Electron File is usually an absolute local path; fallback: save base64 to disk
      const withPath  = imgAttachments.filter(a => a.path).map(a => a.path);
      const needsSave = imgAttachments.filter(a => !a.path && a.data && a.mimeType);
      if (needsSave.length > 0) {
        const saved = await api.agentSaveRefImages?.({
          images: needsSave.map(a => ({ data: a.data, mimeType: a.mimeType, name: a.name })),
        });
        if (saved?.paths) withPath.push(...saved.paths);
      }
      refImagePaths = withPath.filter(Boolean);
    } catch (_) {}

    const execData = overrideExec || runOverrideRef.current;
    const userPrompt = execData?.prompt || command;
    const approvedPlan = execData?.planText || null;
    const ratioHint = ratio !== 'auto' ? `tỉ lệ ${ratio}` : '';
    const baseReq = duration > 0
      ? `[Yêu cầu BẮT BUỘC: Video PHẢI DÀI ${duration} giây (${Math.floor(duration/60)} phút ${duration%60 > 0 ? duration%60+'s' : ''}). total_duration_sec=${duration}. Số cảnh ≥ ${Math.round(duration/7)} scene. ${ratioHint ? ratioHint + '. ' : ''}Ngôn ngữ: ${lang}.]`
      : `[Yêu cầu: ${ratioHint ? ratioHint + ', ' : ''}ngôn ngữ ${lang}. Thời lượng và tỉ lệ: AI tự quyết định phù hợp với nội dung]`;
    const enrichedPrompt = approvedPlan
      ? `${userPrompt}\n\n${baseReq}\n\n━━━ KẾ HOẠCH ĐÃ ĐƯỢC NGƯỜI DÙNG DUYỆT ━━━\n${approvedPlan}\n\nQUAN TRỌNG: Người dùng đã XEM và DUYỆT kế hoạch trên. KHÔNG gọi research_topic. Trực tiếp gọi plan_video theo đúng kế hoạch đã duyệt (cảnh, visual_type, narration), rồi sản xuất ngay.`
      : `${userPrompt}\n\n${baseReq}`;

    const systemPrompt = buildSystemPrompt(preset, lang, refImagePaths.length > 0, brollMode, veoModel, duration);

    const onAsset = (asset) => {
      setLiveAssets(prev => {
        const idx = prev.findIndex(a => a.id === asset.id || (a.segId === asset.segId && a.type === asset.type));
        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], ...asset }; return u; }
        return [...prev, { id: asset.id || `a_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...asset }];
      });
    };

    const execOpts = { apiKeys: keys, model, voice, ttsProvider, brollMode, veoModel,
      outputDir: outputDir || undefined, vieNeuSavedVoices, projectState, refImagePaths, onAsset, manualSfxList };

    try {
      const refImageParts = attachments
        .filter(a => a.type === 'image' && a.data && a.mimeType)
        .map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } }));
      const contents = [{ role: 'user', parts: [{ text: enrichedPrompt }, ...refImageParts] }];
      const MAX_CYCLES = 80;
      let cycle = 0;
      let planCalled = false; // track when plan_video has been called

      while (cycle < MAX_CYCLES && !abortRef.current) {
        cycle++;
        setStatus(`🤖 Đang xử lý (vòng ${cycle})...`);
        if (cycle === 1) setAiStreamText('🔍 Đang phân tích yêu cầu...\n⚙️ Chuẩn bị lên kế hoạch sản xuất video...');
        else if (!planCalled) setAiStreamText(prev => prev ? prev + `\n\n— Vòng ${cycle}: tiếp tục lên kế hoạch...` : `Vòng ${cycle}: đang xử lý...`);

        const fcMode = planCalled ? 'AUTO' : 'ANY';
        // Khi có approvedPlan và chưa plan, force chỉ gọi plan_video (không research)
        const allowedFns = (!planCalled && approvedPlan) ? ['plan_video'] : undefined;

        // Timer tổng — đếm từ lúc bắt đầu cycle, không reset khi đổi key
        const cycleStart = Date.now();
        const timerLabel = !planCalled
          ? (cycle === 1 ? '🧠 AI đang lên kế hoạch' : `🔄 Vòng ${cycle} — AI đang xử lý`)
          : '⚙️ AI đang ra lệnh công việc';
        let keyNote = '';
        const cycleTimerInterval = setInterval(() => {
          const elapsed = Math.round((Date.now() - cycleStart) / 1000);
          setAiStreamText(`${timerLabel}... (${elapsed}s)${keyNote}`);
        }, 1000);

        // Round-robin: mỗi cycle dùng key tiếp theo trong vòng xoay, không gửi trùng
        let res, lastErr;
        try {
          const cfg = {
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
            toolConfig: { functionCallingConfig: { mode: fcMode, ...(allowedFns ? { allowedFunctionNames: allowedFns } : {}) } },
            systemInstruction: systemPrompt,
            temperature: 0.4,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
          };
          for (let ki = 0; ki < keys.length && !res; ki++) {
            // Bắt đầu từ vị trí xoay hiện tại để phân tải đều
            const keyIdx = (cycle - 1 + ki) % keys.length;
            if (ki > 0) keyNote = ` — thử key ${ki + 1}`;
            try {
              const g = new GoogleGenAI({ apiKey: keys[keyIdx] });
              const callPromise = g.models.generateContent({ model, contents, config: cfg });
              const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(Object.assign(
                new Error('Gemini timeout 90s'), { isTimeout: true }
              )), 90000));
              res = await Promise.race([callPromise, timeoutPromise]);
            } catch (err) {
              const msg = String(err?.message || err);
              const rotatable = err?.isTimeout
                || msg.includes('429') || msg.includes('503')
                || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('UNAVAILABLE')
                || msg.includes('quota') || msg.includes('overloaded')
                || msg.includes('403') || msg.includes('PERMISSION_DENIED')
                || msg.includes('denied access') || msg.includes('API_KEY_INVALID');
              if (rotatable && ki < keys.length - 1) { lastErr = err; continue; }
              throw err;
            }
          }
          if (!res) throw lastErr || new Error('All API keys failed');

          // Hiển thị thought tokens + text nếu model có trả về
          if (!planCalled) {
            const rParts = res.candidates?.[0]?.content?.parts || [];
            const thoughts = rParts.filter(p => p.text && p.thought).map(p => p.text).join('').trim();
            const txt = rParts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
            const display = [thoughts ? `💭 ${thoughts.slice(0, 500)}` : '', txt].filter(Boolean).join('\n\n');
            if (display) setAiStreamText(display);
          }
        } finally {
          clearInterval(cycleTimerInterval);
        }
        if (!res) throw lastErr || new Error('All API keys failed');
        if (abortRef.current) break;

        const parts = res.candidates?.[0]?.content?.parts || [];
        // Support both camelCase (SDK) and snake_case (raw proto) function call format
        const funcCalls = parts.filter(p => p.functionCall || p.function_call);
        contents.push({ role: 'model', parts });

        if (funcCalls.length === 0) {
          const txt = parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
          // If plan_video hasn't been called yet and AI returned text → nudge it to call tools
          if (!planCalled && cycle <= 3) {
            if (txt) setAiStreamText(`💭 AI đang phân tích... (đang chuyển sang chế độ sản xuất)`);
            contents.push({
              role: 'user',
              parts: [{ text: 'Bắt đầu sản xuất ngay: gọi research_topic (nếu cần facts) hoặc plan_video ngay bây giờ. KHÔNG trả lời text — GỌI TOOL.' }],
            });
            continue;
          }
          if (txt) {
            setToolLog(prev => [...prev, { id: `ai_text_${Date.now()}`, name: '_ai_text', text: txt, done: true, status: 'info' }]);
            setStatus(`💬 ${txt.slice(0, 120)}`);
          } else {
            setStatus('✅ Hoàn thành');
          }
          break;
        }

        // TTS dùng pool riêng (5 luồng) để tránh rate-limit Edge TTS
        // Visual dùng pool riêng (12 luồng) — 2 pool chạy đồng thời via Promise.all
        const TTS_TOOLS    = new Set(['generate_tts']);
        const VISUAL_TOOLS = new Set(['generate_image','acquire_broll','search_stock_footage','add_sfx','search_music','add_background_music']);
        const PARALLEL_TOOLS = new Set([...TTS_TOOLS, ...VISUAL_TOOLS]);
        const TTS_CONCURRENCY    = 4;
        const VISUAL_CONCURRENCY = 20;

        // Pool worker cố định (giống p-limit nhưng không cần dep)
        const runWithPool = async (items, fn, limit) => {
          const results = new Array(items.length);
          let idx = 0;
          const worker = async () => {
            while (idx < items.length) {
              const i = idx++;
              if (abortRef.current) { results[i] = null; continue; }
              results[i] = await fn(items[i], i);
            }
          };
          await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
          return results;
        };

        // Phân loại: tools nào chạy được song song, tools nào phải tuần tự
        const parallelCalls = funcCalls.filter(fc => PARALLEL_TOOLS.has((fc.functionCall || fc.function_call)?.name));
        const serialCalls   = funcCalls.filter(fc => !PARALLEL_TOOLS.has((fc.functionCall || fc.function_call)?.name));
        const isParallelBatch = parallelCalls.length > 0;

        // Rút gọn tool response trước khi đưa vào Gemini context
        // Giảm ~80% kích thước context → Gemini xử lý nhanh hơn đáng kể
        const compactForContext = (toolName, result) => {
          if (!result) return { success: false };
          if (toolName === 'generate_tts')
            return { success: result.success, duration: result.duration, segment_id: result.segment_id, error: result.error };
          if (['acquire_broll','generate_image','search_stock_footage'].includes(toolName))
            return { success: result.success, acquired: result.success ? true : undefined,
              source: result.source, fallback_level: result.fallback_level,
              warning: result.warning?.slice?.(0, 160), error: result.error?.slice?.(0, 80) };
          if (toolName === 'add_sfx' || toolName === 'add_background_music')
            return { success: result.success };
          if (toolName === 'quality_check')
            return { success: result.success, score: result.score, passed: result.passed, summary: result.summary, patch: result.patch?.slice(0,5), required_fixes: result.required_fixes };
          if (toolName === 'research_topic')
            return { success: result.success, message: result.message };
          if (toolName === 'plan_video')
            return { success: result.success, segments_count: result.segments?.length, must_acquire: result.must_acquire };
          if (toolName === 'render_video')
            return { success: result.success, output_path: result.output_path, qa: result.qa, required_fixes: result.required_fixes, instruction: result.instruction };
          return result;
        };

        const runOneTool = async (fc) => {
          if (abortRef.current) return null;
          const call = fc.functionCall || fc.function_call;
          const toolName = call?.name;
          let toolArgs = call?.args || {};
          if (typeof toolArgs === 'string') { try { toolArgs = JSON.parse(toolArgs); } catch (_) { toolArgs = {}; } }
          const logId = `${toolName}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

          if (!isParallelBatch) setCurrentTool({ name: toolName, args: toolArgs });
          setToolLog(prev => [...prev, { id: logId, name: toolName, args: toolArgs, done: false, status: 'running' }]);
          if (!isParallelBatch) setStatus(`⚙️ ${RUNNING_LABELS[toolName] || toolName}...`);

          let toolResult = { success: false, error: 'unknown' };
          try {
            toolResult = await executeTool(toolName, toolArgs, execOpts);
          } catch (err) {
            toolResult = { success: false, error: String(err?.message || err) };
          }

          if (toolName === 'plan_video') {
            planCalled = true;
            const segs = toolArgs.segments || projectState.plan?.segments;
            if (segs?.length) {
              try {
                const builtPlan = buildEditPlan({ ...toolArgs }, projectState.assetRegistry || {});
                setPlanData(prev => ({ ...(prev || {}), ...toolArgs, ...builtPlan, segments: segs }));
              } catch (_) {
                setPlanData(prev => ({ ...(prev || {}), ...toolArgs, segments: segs }));
              }
              setAppMode('editor');
              setLeftPanelTab('log');
              // Hiện tóm tắt kế hoạch thay vì xóa trắng
              const typeCounts = segs.reduce((acc, s) => { acc[s.visual_type] = (acc[s.visual_type]||0)+1; return acc; }, {});
              const typeStr = Object.entries(typeCounts).map(([t,n]) => `${t}×${n}`).join(' · ');
              setAiStreamText(`✅ Kế hoạch xong: "${toolArgs.title || 'Video'}" — ${segs.length} cảnh\n📊 ${typeStr}\n\n⏳ Bắt đầu sản xuất...`);
            }
          }
          if (toolName === 'render_video' && toolResult.success !== false) {
            const outPath = toolResult.outputPath || toolResult.output_path || toolResult.path || toolArgs.output_path;
            if (outPath) {
              setRenderPath(outPath);
              setPlanData(prev => ({ ...(prev || {}), render: { ...(prev?.render || {}), outputPath: outPath } }));
            }
            setAppMode('editor');
            setIsPlaying(false);
          }
          if (toolName === 'generate_seo' && toolResult.success !== false) {
            setPlanData(prev => ({ ...(prev || {}), seoData: toolResult }));
          }
          if (toolName === 'generate_thumbnail' && toolResult.success !== false && toolResult.path) {
            setPlanData(prev => ({ ...(prev || {}), thumbnailPath: toolResult.path }));
          }

          setToolLog(prev => prev.map(e => e.id === logId
            ? { ...e, done: true, status: toolResult.success !== false ? 'done' : 'error', result: toolResult } : e));
          if (!isParallelBatch) setCurrentTool(null);
          // Compact response trước khi đưa vào context — giảm kích thước Gemini phải đọc
          const compactResponse = compactForContext(toolName, toolResult);
          return { functionResponse: { name: toolName, response: compactResponse } };
        };

        let funcResponses = [];

        // Tools cần chạy SAU khi visual/TTS xong (render_video, quality_check, generate_seo, ...)
        const POST_PARALLEL = new Set(['render_video','quality_check','generate_seo','generate_thumbnail','cleanup_output']);
        const preSerialCalls  = serialCalls.filter(fc => !POST_PARALLEL.has((fc.functionCall || fc.function_call)?.name));
        const postSerialCalls = serialCalls.filter(fc =>  POST_PARALLEL.has((fc.functionCall || fc.function_call)?.name));

        // 1. PRE-serial: plan_video, research_topic, set_platform_config, ... (cần xong trước khi tạo media)
        for (const fc of preSerialCalls) {
          if (abortRef.current) break;
          const r = await runOneTool(fc);
          if (r) funcResponses.push(r);
        }

        // 2. Parallel: TTS (8 luồng) + Visual (20 luồng) đồng thời — media phải xong trước render
        if (parallelCalls.length > 0) {
          const ttsCalls    = parallelCalls.filter(fc => TTS_TOOLS.has((fc.functionCall || fc.function_call)?.name));
          const visualCalls = parallelCalls.filter(fc => VISUAL_TOOLS.has((fc.functionCall || fc.function_call)?.name));
          setStatus(`⚡ ${parallelCalls.length} tác vụ song song — TTS:${ttsCalls.length} (${TTS_CONCURRENCY} luồng) + Visual:${visualCalls.length} (${VISUAL_CONCURRENCY} luồng)...`);

          const [ttsRes, visualRes] = await Promise.all([
            ttsCalls.length    > 0 ? runWithPool(ttsCalls,    runOneTool, TTS_CONCURRENCY)    : Promise.resolve([]),
            visualCalls.length > 0 ? runWithPool(visualCalls, runOneTool, VISUAL_CONCURRENCY) : Promise.resolve([]),
          ]);
          funcResponses.push(...ttsRes.filter(Boolean), ...visualRes.filter(Boolean));
          setCurrentTool(null);
          setStatus(`✅ Hoàn thành ${parallelCalls.length} tác vụ`);
        }

        // 3. POST-serial: render_video, quality_check, generate_seo — chạy SAU khi đã có đủ media
        for (const fc of postSerialCalls) {
          if (abortRef.current) break;
          const r = await runOneTool(fc);
          if (r) funcResponses.push(r);
        }

        if (funcResponses.length > 0) {
          // Prune context sau khi Phase 2+3 xong: giữ tối đa 40 phần tử trong contents
          // để Gemini không phải xử lý history khổng lồ ở các vòng sau (render, QA, SEO)
          const CONTEXT_LIMIT = 40;
          if (contents.length > CONTEXT_LIMIT) {
            // Giữ turn đầu (user prompt) + 4 turn cuối gần nhất
            const head = contents.slice(0, 1);
            const tail = contents.slice(-4);
            contents.length = 0;
            contents.push(...head, { role: 'user', parts: [{ text: '[Lịch sử đã được nén để tối ưu tốc độ. Tiếp tục theo kế hoạch đã có.]' }] }, ...tail);
          }
          contents.push({ role: 'user', parts: funcResponses });
        }
      }

      if (projectState.plan?.segments?.length) {
        try {
          const finalPlan = buildEditPlan(projectState.plan, projectState.assetRegistry || {});
          setPlanData(prev => ({ ...(prev || {}), ...projectState.plan, ...finalPlan }));
        } catch (_) {
          setPlanData(prev => ({ ...(prev || {}), ...projectState.plan }));
        }
      }
      if (!abortRef.current) setStatus('✅ Hoàn thành');
    } catch (err) {
      const msg = String(err?.message || err);
      setStatus(`❌ ${msg.slice(0, 120)}`);
    } finally {
      setIsRunning(false);
      setCurrentTool(null);
      runOverrideRef.current = null;
    }
  }, [command, model, preset, lang, ttsProvider, brollMode, veoModel, voice, outputDir, duration, ratio, attachments, manualSfxList, vieNeuSavedVoices]);

  const handleSend = useCallback(async () => {
    const text = command.trim();
    if (!text || isThinking || isRunning) return;
    const snapAttachments = attachments.filter(a => a.type === 'image');
    const userMsg = { id: `u_${Date.now()}`, role: 'user', text, images: snapAttachments.map(a => ({ name: a.name, data: a.data, mimeType: a.mimeType })) };
    const replyId = `r_${Date.now() + 1}`;
    setChatMessages(prev => [...prev, userMsg, { id: replyId, role: 'assistant', text: '' }]);
    setCommand('');
    setAttachments([]);
    setIsThinking(true);
    const onChunk = (accText) => {
      setChatMessages(prev => prev.map(m => m.id === replyId ? { ...m, text: accText } : m));
    };
    try {
      if (isVideoRequest(text)) {
        const { text: planText, needsConfirmation } = await callGeminiPlan(
          text, chatMessages.slice(-6), apiKeysRef.current, snapAttachments, lang, model, onChunk
        );
        setChatMessages(prev => prev.map(m => m.id === replyId ? { ...m, text: planText } : m));
        if (needsConfirmation) setPendingExec({ prompt: text, planText });
      } else {
        const { text: reply, needsConfirmation } = await callGeminiChat(
          text, chatMessages.slice(-6), apiKeysRef.current, snapAttachments, lang, model, onChunk
        );
        setChatMessages(prev => prev.map(m => m.id === replyId ? { ...m, text: reply } : m));
        if (needsConfirmation) setPendingExec({ prompt: text });
      }
    } catch (err) {
      setChatMessages(prev => prev.map(m => m.id === replyId
        ? { ...m, role: 'error', text: String(err?.message || err) }
        : m));
    } finally { setIsThinking(false); }
  }, [command, isThinking, isRunning, chatMessages, attachments, lang, model]);

  // ── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',background:'#080c14',color:'#e2e8f0',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',overflow:'hidden',fontSize:14}}>
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .spin{animation:spin .8s linear infinite}
        .pulse{animation:pulse 1.5s ease-in-out infinite}
        .fadein{animation:fadein .3s ease forwards}
        *::-webkit-scrollbar{width:5px;height:5px}
        *::-webkit-scrollbar-track{background:transparent}
        *::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:3px}
        button:focus{outline:none}
        textarea:focus{outline:none}
        select:focus{outline:none}
      `}</style>

      {/* ════════════════════════════════════════════════════════════════
          STATE 1 — HOME
      ════════════════════════════════════════════════════════════════ */}
      {appMode === 'home' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflowY:'auto'}}>
          {/* TOP mini bar */}
          <div style={{height:44,flexShrink:0,display:'flex',alignItems:'center',padding:'0 24px',gap:12,background:'#04070f',borderBottom:'1px solid #0d1728'}}>
            <span style={{fontSize:16,fontWeight:900,color:'#7c3aed',letterSpacing:'-0.02em'}}>⚡ Fluxy AI</span>
            <div style={{flex:1}}/>
          </div>

          {/* HERO SECTION */}
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'48px 24px 64px',minHeight:'min-content'}}>
            <div style={{width:'100%',maxWidth:780,display:'flex',flexDirection:'column',gap:32}}>

              {/* Heading */}
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:36,fontWeight:900,color:'#f8fafc',lineHeight:1.15,marginBottom:12,letterSpacing:'-0.03em'}}>
                  Bạn muốn tạo video gì<br/>
                  <span style={{background:'linear-gradient(135deg,#7c3aed,#3b82f6)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>hôm nay?</span>
                </div>
                <p style={{fontSize:15,color:'#64748b',lineHeight:1.6,maxWidth:560,margin:'0 auto'}}>
                  AI sẽ tự viết kịch bản, tạo hình ảnh & video, voice, nhạc nền, SFX, subtitle rồi dựng thành video hoàn chỉnh.
                </p>
              </div>

              {/* Preset pills */}
              <div style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'center'}}>
                {PRESETS.map(p => (
                  <button key={p.id} onClick={()=>setPreset(p.id)} title={p.desc}
                    style={{padding:'7px 16px',borderRadius:99,fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s',
                      background:preset===p.id?p.color+'22':'#0d1728',
                      border:`1.5px solid ${preset===p.id?p.color:'#1a2540'}`,
                      color:preset===p.id?p.color:'#475569'}}>
                    {p.icon} {p.label}
                  </button>
                ))}
              </div>

              {/* Banner cảnh báo extension chưa kết nối */}
              {labsConnected === false && (
                <div className="fadein" style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 14px',
                  background:'rgba(234,179,8,0.08)',border:'1px solid rgba(234,179,8,0.3)',borderRadius:10,marginBottom:8}}>
                  <span style={{fontSize:18,flexShrink:0}}>⚠️</span>
                  <div style={{flex:1}}>
                    <div style={{color:'#fbbf24',fontWeight:700,fontSize:13,marginBottom:3}}>
                      FluxyExtension chưa kết nối Google VideoFX
                    </div>
                    <div style={{color:'#94a3b8',fontSize:12,lineHeight:1.5}}>
                      AI Video và AI Image sẽ không tạo được — chỉ dùng ảnh stock.<br/>
                      Để bật: mở Chrome → vào <b style={{color:'#e2e8f0'}}>flow.google.com</b> → bật FluxyExtension → nhấn F5.
                    </div>
                  </div>
                  <button onClick={async()=>{await window.electronAPI?.openExternal?.('https://flow.google.com');}}
                    style={{flexShrink:0,padding:'4px 10px',background:'rgba(234,179,8,0.15)',border:'1px solid rgba(234,179,8,0.4)',
                      borderRadius:6,color:'#fbbf24',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
                    Mở flow.google.com
                  </button>
                </div>
              )}

              {/* Chat history */}
              {chatMessages.length > 0 && (
                <div ref={chatScrollRef} style={{display:'flex',flexDirection:'column',gap:10,maxHeight:420,overflowY:'auto',padding:'4px 0',scrollBehavior:'smooth'}}>
                  {chatMessages.map(msg => (
                    <div key={msg.id} className="fadein" style={{display:'flex',flexDirection:'column',gap:4,
                      alignItems:msg.role==='user'?'flex-end':'flex-start'}}>
                      <div style={{maxWidth:'85%',padding:'12px 16px',borderRadius:msg.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px',
                        background:msg.role==='user'?`${activePreset.color}22`:'#0a1020',
                        border:`1px solid ${msg.role==='user'?activePreset.color+'44':'#1a2540'}`,
                        color:msg.role==='error'?'#fca5a5':'#e2e8f0',fontSize:13,lineHeight:1.7,
                        whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
                        {msg.role === 'user' && msg.images?.length > 0 && (
                          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                            {msg.images.map((img, ii) => (
                              <img key={ii} src={`data:${img.mimeType};base64,${img.data}`}
                                alt={img.name}
                                style={{maxWidth:120,maxHeight:80,borderRadius:6,objectFit:'cover',border:`1px solid ${activePreset.color}44`}}/>
                            ))}
                          </div>
                        )}
                        {msg.text}
                        {isThinking && msg.id === chatMessages[chatMessages.length-1]?.id && msg.role==='assistant' && msg.text && (
                          <span className="pulse" style={{display:'inline-block',width:2,height:'1em',background:activePreset.color,marginLeft:2,verticalAlign:'middle',borderRadius:1}}/>
                        )}
                      </div>
                    </div>
                  ))}
                  {isThinking && chatMessages[chatMessages.length-1]?.text === '' && (
                    <div className="fadein" style={{display:'flex',alignItems:'center',gap:6,padding:'10px 14px',background:'#0a1020',border:'1px solid #1a2540',borderRadius:'14px 14px 14px 4px',maxWidth:180}}>
                      <div className="pulse" style={{width:6,height:6,borderRadius:'50%',background:activePreset.color}}/>
                      <span style={{fontSize:12,color:'#475569'}}>AI đang suy nghĩ...</span>
                    </div>
                  )}
                  <div ref={chatEndRef}/>
                  {pendingExec && (
                    <div className="fadein" style={{display:'flex',gap:10,justifyContent:'center',padding:'8px 0'}}>
                      <button onClick={() => handleRun(pendingExec)}
                        style={{padding:'12px 28px',background:`linear-gradient(135deg,${activePreset.color},#3b82f6)`,border:'none',
                          borderRadius:10,color:'#fff',fontSize:14,fontWeight:800,cursor:'pointer',letterSpacing:'-0.01em',
                          display:'flex',alignItems:'center',gap:8}}>
                        ✨ Bắt đầu sản xuất video
                      </button>
                      <button onClick={()=>setPendingExec(null)}
                        style={{padding:'12px 16px',background:'transparent',border:'1px solid #1a2540',borderRadius:10,color:'#475569',fontSize:13,cursor:'pointer'}}>
                        Chỉnh thêm
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Main textarea */}
              <div style={{position:'relative'}}>
                <textarea
                  value={command} onChange={e=>setCommand(e.target.value)}
                  onKeyDown={e=>{
                    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();handleCreateVideo();return;}
                    if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();handleSend();}
                  }}
                  placeholder={chatMessages.length>0
                    ? 'Nhắn tin tiếp hoặc Ctrl+Enter để tạo video ngay...'
                    : `Mô tả video bạn muốn tạo...\n\nVí dụ: "Documentary cinematic 8 phút giải thích tại sao iPhone và Samsung cạnh tranh khốc liệt, có hình ảnh thực tế và số liệu."\n\nEnter = chat với AI · Ctrl+Enter = tạo video ngay`}
                  style={{width:'100%',minHeight:chatMessages.length>0?72:130,background:'#0a1020',border:`2px solid ${command?activePreset.color:'#1a2540'}`,borderRadius:14,
                    padding:'18px 20px',color:'#f1f5f9',fontSize:15,lineHeight:1.65,resize:'vertical',
                    fontFamily:'inherit',boxSizing:'border-box',transition:'border-color .2s,min-height .2s'}}
                />
                {attachments.length > 0 && (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                    {attachments.map((a,i) => (
                      <span key={i} style={{background:'#0c1e33',border:'1px solid #1e3a5f',borderRadius:6,padding:'3px 10px',color:'#60a5fa',fontSize:11,display:'flex',alignItems:'center',gap:5}}>
                        📎 {a.name}
                        <button onClick={()=>setAttachments(prev=>prev.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:12,padding:0,lineHeight:1}}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Settings toggle header — always visible */}
              {chatMessages.length > 0 && (
                <button onClick={()=>setSettingsOpen(v=>!v)}
                  style={{display:'flex',alignItems:'center',gap:6,background:'transparent',border:'1px solid #1a2540',
                    borderRadius:8,padding:'6px 12px',color:'#334155',cursor:'pointer',fontSize:12,width:'100%',
                    transition:'all .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor='#3b82f655'}
                  onMouseLeave={e=>e.currentTarget.style.borderColor='#1a2540'}>
                  <span style={{fontSize:10,transform:settingsOpen?'rotate(180deg)':'rotate(0deg)',transition:'transform .2s',display:'inline-block'}}>▲</span>
                  <span>{settingsOpen ? 'Ẩn cài đặt' : '⚙️ Cài đặt'}</span>
                  {!settingsOpen && (
                    <span style={{marginLeft:'auto',fontSize:10,color:'#475569'}}>
                      {[model.split(' ')[0], lang==='vi'?'Việt':lang, ratio].join(' · ')}
                    </span>
                  )}
                </button>
              )}

              {/* Collapsible settings */}
              <div style={{display:settingsOpen?'flex':'none',flexDirection:'column',gap:10,
                animation:settingsOpen?'fadein .2s ease':'none'}}>
                {/* Quick settings row */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
                  <LabeledSelect label="Thời lượng" value={duration} onChange={v=>setDuration(Number(v))}
                    options={DURATIONS.map(d=>({value:d.id,label:d.label}))} />
                  <LabeledSelect label="Tỉ lệ" value={ratio} onChange={setRatio}
                    options={RATIOS.map(r=>({value:r.id,label:r.label}))} />
                  <LabeledSelect label="Ngôn ngữ" value={lang} onChange={setLang}
                    options={FORMATS.map(f=>({value:f.id,label:f.label}))} />
                  <LabeledSelect label="AI Model" value={model} onChange={setModel}
                    options={MODELS.map(m=>({value:m.id,label:m.label}))} />
                </div>

                {/* Advanced row */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
                  <LabeledSelect label="Voice Engine" value={ttsProvider}
                    onChange={v=>{ setTtsProvider(v); const dv=getDefaultVoice(v,lang)||getVoiceOptions(v,lang)[0]?.id||''; if(dv) setVoice(dv); }}
                    options={TTS_PROVIDERS.map(p=>({value:p.id,label:`${p.label} (${p.badge})`}))} />
                  <LabeledSelect label="Giọng đọc" value={voice} onChange={setVoice}
                    options={ttsProvider==='vieneu'
                      ? (() => {
                          const cloneOpts  = vieNeuSavedVoices.map(v=>({value:`clone:${v.id}`,label:`🎤 Clone: ${v.name}`}));
                          const presetOpts = vieNeuVoices.map(([desc,id])=>({value:String(id),label:desc}));
                          const all = [...cloneOpts, ...presetOpts];
                          return all.length ? all : [{value:'',label:'(VieNeu chưa kết nối)'}];
                        })()
                      : getVoiceOptions(ttsProvider, lang).map(v=>({value:v.id,label:v.label}))}/>
                  <LabeledSelect label="Visual AI" value={brollMode} onChange={setBrollMode}
                    options={BROLL_MODES.map(m=>({value:m.id,label:m.label}))} />
                  {brollMode==='video'
                    ? <LabeledSelect label="Veo Model" value={veoModel} onChange={setVeoModel}
                        options={VEO_MODELS.map(m=>({value:m.id,label:m.label}))} />
                    : <div/>}
                </div>

                {/* Output dir row */}
                <div style={{display:'flex',flexDirection:'column',gap:5}}>
                  <span style={{fontSize:11,color:'#475569',fontWeight:600,letterSpacing:'0.04em'}}>Thư mục lưu video</span>
                  <button onClick={selectOutputDir}
                    style={{background:'#0a1020',border:'1px solid #1a2540',borderRadius:8,padding:'7px 12px',
                      color:outputDir?'#94a3b8':'#334155',fontSize:12,cursor:'pointer',textAlign:'left',
                      display:'flex',alignItems:'center',gap:8,transition:'border-color .15s',outline:'none'}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor='#3b82f655'}
                    onMouseLeave={e=>e.currentTarget.style.borderColor='#1a2540'}>
                    <span style={{fontSize:14}}>📁</span>
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {outputDir || 'Chọn thư mục lưu video...'}
                    </span>
                    {outputDir && <span style={{fontSize:10,color:'#3b82f6',flexShrink:0}}>Thay đổi</span>}
                  </button>
                </div>
              </div>

              {/* CTA + import */}
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={handleSend} disabled={!command.trim()||isThinking||isRunning}
                  style={{flex:1,minWidth:180,height:50,
                    background:command.trim()&&!isThinking&&!isRunning?'#0c1e33':'#0a1020',
                    border:`1.5px solid ${command.trim()&&!isThinking&&!isRunning?activePreset.color+'88':'#1a2540'}`,
                    borderRadius:12,
                    color:command.trim()&&!isThinking&&!isRunning?activePreset.color:'#1e293b',
                    fontSize:14,fontWeight:700,
                    cursor:command.trim()&&!isThinking&&!isRunning?'pointer':'not-allowed',
                    letterSpacing:'-0.01em',transition:'all .2s',
                    display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
                  {isThinking
                    ? <><div className="spin" style={{width:14,height:14,borderRadius:'50%',border:`2px solid ${activePreset.color}`,borderTopColor:'transparent'}}/> Đang phân tích...</>
                    : isRunning
                    ? <><div className="spin" style={{width:14,height:14,borderRadius:'50%',border:`2px solid ${activePreset.color}`,borderTopColor:'transparent'}}/> Đang tạo...</>
                    : '💬 Gửi'}
                </button>
                <label style={{height:50,padding:'0 16px',background:'#0a1020',border:'1px solid #1a2540',borderRadius:12,
                  color:'#475569',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap'}}>
                  📎
                  <input type="file" multiple accept="image/*,video/*,audio/*" style={{display:'none'}} onChange={handleAttachFile}/>
                </label>
                {chatMessages.length > 0 && (
                  <button onClick={()=>{setChatMessages([]);setPendingExec(null);}}
                    style={{height:50,padding:'0 12px',background:'transparent',border:'1px solid #1a2540',borderRadius:12,
                      color:'#334155',cursor:'pointer',fontSize:12,whiteSpace:'nowrap'}}>
                    🗑 Xóa chat
                  </button>
                )}
              </div>

              {/* Example prompts */}
              <div style={{borderTop:'1px solid #0d1728',paddingTop:20}}>
                <p style={{fontSize:12,color:'#1e3a5f',marginBottom:12,textAlign:'center',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600}}>Ví dụ prompt</p>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  {[
                    'Documentary 5 phút: Tại sao người giàu ngày càng giàu hơn?',
                    'Explainer 3 phút: Lịch sử và tương lai của trí tuệ nhân tạo',
                    'News style: Thị trường chứng khoán Việt Nam 2025 — cơ hội và rủi ro',
                    'Story cinematic: Hành trình từ startup garage đến công ty tỉ đô',
                  ].map((ex,i) => (
                    <button key={i} onClick={()=>setCommand(ex)}
                      style={{background:'#0a1020',border:'1px solid #1a2540',borderRadius:8,padding:'10px 14px',
                        color:'#334155',cursor:'pointer',fontSize:12,textAlign:'left',lineHeight:1.4,
                        transition:'all .15s',':hover':{borderColor:'#7c3aed'}}}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          STATE 2 — PRODUCTION
      ════════════════════════════════════════════════════════════════ */}
      {appMode === 'production' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>

          {/* Production top bar */}
          <div style={{height:48,flexShrink:0,display:'flex',alignItems:'center',padding:'0 16px',gap:12,background:'#04070f',borderBottom:'1px solid #0d1728'}}>
            <button onClick={handleBackToHome} style={{background:'transparent',border:'none',color:'#334155',cursor:'pointer',fontSize:18,padding:'0 4px',lineHeight:1}}>←</button>
            <span style={{fontSize:14,fontWeight:800,color:'#7c3aed'}}>⚡ AI Production</span>
            {planData?.title && <span style={{fontSize:13,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{planData.title}</span>}
            <div style={{flex:1}}/>
            {/* progress bar */}
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <div style={{width:120,height:5,background:'#0d1728',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${progressPct}%`,background:`linear-gradient(90deg,${activePreset.color},#3b82f6)`,borderRadius:3,transition:'width .5s'}}/>
              </div>
              <span style={{fontSize:11,color:'#475569',width:32,textAlign:'right'}}>{progressPct}%</span>
            </div>
            {isRunning && (
              <button onClick={handleStop} style={{background:'#1f0a0a',border:'1px solid #7f1d1d',borderRadius:7,padding:'5px 12px',color:'#fca5a5',cursor:'pointer',fontSize:12,fontWeight:600}}>⏹ Stop</button>
            )}
            <button onClick={()=>setShowLog(v=>!v)} style={{background:showLog?'#1e1540':'transparent',border:`1px solid ${showLog?'#7c3aed':'#1a2540'}`,borderRadius:6,padding:'4px 8px',color:showLog?'#a78bfa':'#334155',cursor:'pointer',fontSize:11}}>📋 Log</button>
          </div>

          <div style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

            {/* LEFT — Production stages */}
            <div style={{width:200,flexShrink:0,background:'#04070f',borderRight:'1px solid #0d1728',display:'flex',flexDirection:'column',padding:'16px 0'}}>
              <div style={{padding:'0 16px',marginBottom:12,fontSize:11,fontWeight:700,color:'#1e3a5f',textTransform:'uppercase',letterSpacing:'0.08em'}}>Tiến trình</div>
              {prodStages.map((stage,i) => (
                <div key={stage.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 16px',
                  background:stage.status==='running'?'#0c1e33':stage.status==='done'?'#042010':'transparent',
                  borderLeft:`2px solid ${stage.status==='done'?'#16a34a':stage.status==='running'?activePreset.color:'transparent'}`,
                  transition:'all .2s'}}>
                  <div style={{width:18,height:18,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,
                    background:stage.status==='done'?'#16a34a':stage.status==='running'?activePreset.color:'#0d1728',
                    color:'#fff'}}>
                    {stage.status==='done'?'✓':stage.status==='running'?<div className="pulse" style={{width:5,height:5,borderRadius:'50%',background:'#fff'}}/>:i+1}
                  </div>
                  <span style={{fontSize:12,fontWeight:stage.status!=='pending'?600:400,
                    color:stage.status==='done'?'#4ade80':stage.status==='running'?'#93c5fd':'#334155',
                    lineHeight:1.2}}>
                    {stage.icon} {stage.label}
                  </span>
                </div>
              ))}

              {/* Current tool */}
              {currentTool && (
                <div style={{margin:'16px 10px 0',background:'#0a1525',border:`1px solid ${activePreset.color}33`,borderRadius:8,padding:'10px 12px'}}>
                  <div className="pulse" style={{width:6,height:6,borderRadius:'50%',background:activePreset.color,marginBottom:6}}/>
                  <div style={{fontSize:11,color:'#93c5fd',lineHeight:1.4,fontWeight:500}}>{currentToolLabel}</div>
                </div>
              )}

              {/* Status text */}
              {status && (
                <div style={{margin:'8px 10px 0',fontSize:10,color:'#475569',lineHeight:1.4,padding:'0 2px'}}>{status}</div>
              )}
            </div>

            {/* CENTER — Scene board + Live timeline */}
            <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
            <div style={{flex:1,overflowY:'auto',padding:16,minWidth:0}}>
              {/* No plan yet — show spinner + streaming AI thinking */}
              {!planData && isRunning && (
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',height:'100%',padding:'32px 24px',gap:20,overflowY:'auto'}}>
                  <div style={{display:'flex',alignItems:'center',gap:14,alignSelf:'stretch'}}>
                    <div className="spin" style={{width:32,height:32,flexShrink:0,border:`2.5px solid ${activePreset.color}33`,borderTop:`2.5px solid ${activePreset.color}`,borderRadius:'50%'}}/>
                    <div style={{fontSize:14,fontWeight:600,color:'#94a3b8'}}>AI đang lên kế hoạch video...</div>
                  </div>

                  {/* Streaming thinking text */}
                  {aiStreamText && (
                    <div style={{alignSelf:'stretch',background:'#050d1a',border:`1px solid ${activePreset.color}22`,borderRadius:12,padding:'16px 18px',position:'relative',overflow:'hidden'}}>
                      {/* Gradient shimmer border top */}
                      <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${activePreset.color},transparent)`,opacity:0.6}}/>
                      <div style={{fontSize:11,color:'#334155',fontWeight:700,marginBottom:10,textTransform:'uppercase',letterSpacing:'.08em'}}>💭 AI đang nghĩ...</div>
                      <div style={{fontSize:13,color:'#94a3b8',lineHeight:1.75,whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:420,overflowY:'auto'}}>
                        {aiStreamText}
                        <span className="pulse" style={{display:'inline-block',width:7,height:13,background:activePreset.color,borderRadius:1,marginLeft:2,verticalAlign:'middle'}}/>
                      </div>
                    </div>
                  )}

                  {!aiStreamText && status && (
                    <div style={{fontSize:12,color:'#64748b',textAlign:'center'}}>{status}</div>
                  )}
                </div>
              )}

              {/* No plan after finish — show status / AI reply */}
              {!planData && !isRunning && (
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:16,padding:32}}>
                  <div style={{fontSize:32,opacity:.3}}>💬</div>
                  <div style={{fontSize:13,color:'#475569',textAlign:'center',maxWidth:500,lineHeight:1.7}}>
                    {status?.startsWith('💬') ? status.slice(2).trim() : status?.startsWith('❌') ? status : 'AI đã trả lời bằng text thay vì tạo kế hoạch. Hãy mô tả rõ video bạn muốn tạo.'}
                  </div>
                  {/* Show AI text log entries */}
                  {toolLog.filter(e=>e.name==='_ai_text').map((e,i)=>(
                    <div key={i} style={{background:'#0a1525',border:'1px solid #1a2540',borderRadius:10,padding:'12px 16px',maxWidth:600,width:'100%',fontSize:12,color:'#94a3b8',lineHeight:1.6}}>
                      {e.text}
                    </div>
                  ))}
                  <button onClick={handleBackToHome}
                    style={{marginTop:8,background:'transparent',border:`1px solid ${activePreset.color}`,borderRadius:8,padding:'8px 20px',color:activePreset.color,cursor:'pointer',fontSize:13,fontWeight:600}}>
                    ← Thử lại
                  </button>
                </div>
              )}

              {/* Scene grid */}
              {planData?.segments && (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                    <span style={{fontSize:15,fontWeight:700,color:'#e2e8f0'}}>{planData.title || 'Video'}</span>
                    <span style={{fontSize:12,color:'#334155'}}>·  {planData.segments.length} cảnh</span>
                    {isRunning && <span className="pulse" style={{width:6,height:6,borderRadius:'50%',background:activePreset.color,marginLeft:4}}/>}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(168px,1fr))',gap:12}}>
                    {planData.segments.map(seg => {
                      const imgAsset  = getSegmentAsset(seg.id);
                      const ss        = segmentStatus[seg.id] || {};
                      const isActive  = selectedSceneId === seg.id;
                      return (
                        <div key={seg.id} onClick={()=>setSelectedSceneId(isActive?null:seg.id)}
                          className="fadein"
                          style={{background:isActive?'#0c1e33':'#070b14',border:`1.5px solid ${isActive?activePreset.color:'#0d1728'}`,
                            borderRadius:10,overflow:'hidden',cursor:'pointer',transition:'all .2s'}}>
                          {/* Thumbnail */}
                          <div style={{width:'100%',aspectRatio:'16/9',background:'#030609',position:'relative',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
                            {(imgAsset?.filePath||imgAsset?.path)
                              ? (imgAsset?.type==='video'
                                  ? <video src={fileUrl(imgAsset)} preload="metadata" muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}}
                                      onError={e=>{e.target.style.display='none';}}/>
                                  : <img src={fileUrl(imgAsset)} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}
                                      onError={e=>{e.target.style.display='none';}}/>)
                              : <div style={{fontSize:22,opacity:.2}}>{VISUAL_ICONS[seg.visual_type]||'🎬'}</div>}
                            {(ss.visual==='running') && (
                              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#00000077'}}>
                                <div className="spin" style={{width:22,height:22,border:'2px solid #ffffff33',borderTop:`2px solid ${activePreset.color}`,borderRadius:'50%'}}/>
                              </div>
                            )}
                            {/* Badge */}
                            {imgAsset && (
                              <div style={{position:'absolute',top:4,right:4,
                                background:imgAsset.source==='veo'||imgAsset.source==='imagen4'?'#16a34acc'
                                  :imgAsset.source==='illustration_fallback'||imgAsset.source==='remotion_illustration'||imgAsset.fallback_level>=2?'#7f1d1dcc'
                                  :'#92400ecc',
                                borderRadius:4,padding:'1px 5px',fontSize:8,fontWeight:800,color:'#fff'}}>
                                {imgAsset.source==='veo'?'Veo':imgAsset.source==='imagen4'?'AI'
                                  :imgAsset.source==='illustration_fallback'||imgAsset.source==='remotion_illustration'||imgAsset.fallback_level>=2?'Fallback'
                                  :imgAsset.source||'GFX'}
                              </div>
                            )}
                          </div>
                          {/* Info */}
                          <div style={{padding:'8px 10px 10px'}}>
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                              <span style={{fontSize:11,fontWeight:700,color:'#94a3b8'}}>{seg.id}</span>
                              <span style={{fontSize:10,color:'#334155'}}>{seg.duration_sec||5}s</span>
                            </div>
                            <div style={{fontSize:10,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:6}}>
                              {(narrationText(seg.narration)||seg.text_heading||'').slice(0,48)}
                            </div>
                            {/* Status badges */}
                            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                              <StatusBadge label="Visual" status={ss.visual||'pending'}/>
                              <StatusBadge label="Voice"  status={ss.tts||'pending'}/>
                              {ss.music && <StatusBadge label="Music" status={ss.music}/>}
                              {ss.sfx   && <StatusBadge label="SFX"   status={ss.sfx}/>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* LIVE MINI TIMELINE — updates as AI creates assets */}
            {computedClips.length > 0 && (
              <div style={{height:80,flexShrink:0,borderTop:'1px solid #0d1728',background:'#03060c',display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{height:16,flexShrink:0,display:'flex',alignItems:'center',padding:'0 8px',borderBottom:'1px solid #0d1728'}}>
                  <span style={{fontSize:8,fontWeight:700,color:'#1e3a5f',textTransform:'uppercase',letterSpacing:'.08em'}}>Live Timeline</span>
                  <span style={{fontSize:8,color:'#1e293b',marginLeft:8}}>{fmtDur(Math.round(totalDuration))}</span>
                  {isRunning && <div className="pulse" style={{width:5,height:5,borderRadius:'50%',background:activePreset.color,marginLeft:8}}/>}
                </div>
                <div style={{flex:1,overflowX:'auto',overflowY:'hidden',padding:'4px 8px',display:'flex',gap:2,alignItems:'center',whiteSpace:'nowrap'}}>
                  {computedClips.map(({seg,dur,visualAsset,voiceAsset})=>{
                    const ss=segmentStatus[String(seg.id)]||{};
                    const imgSrc=visualAsset?fileUrl(visualAsset):null;
                    const pxW=Math.max(Math.round(dur*20),18);
                    return (
                      <div key={seg.id} title={`${seg.id} · ${Math.round(dur)}s`}
                        onClick={()=>setSelectedSceneId(String(seg.id))}
                        style={{flexShrink:0,width:pxW,height:50,borderRadius:4,overflow:'hidden',position:'relative',cursor:'pointer',
                          border:`1.5px solid ${selectedSceneId===String(seg.id)?activePreset.color:ss.tts==='done'&&(ss.visual==='done'||visualAsset)?'#16a34a44':'#0d1728'}`,
                          background:'#070b14'}}>
                        {imgSrc
                          ? (visualAsset?.type==='video'
                              ? <video src={imgSrc} preload="metadata" muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}} onLoadedMetadata={e=>{e.target.currentTime=0.001;}} onError={e=>e.target.style.display='none'}/>
                              : <img src={imgSrc} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>)
                          : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:7,color:'#1e3a5f'}}>{seg.id}</div>}
                        {/* voice done indicator */}
                        <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,
                          background:voiceAsset?'#16a34a':ss.tts==='running'?activePreset.color:'#0d1728'}}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>{/* end center column */}

            {/* RIGHT — Inspector / Log */}
            <div style={{width:240,flexShrink:0,background:'#04070f',borderLeft:'1px solid #0d1728',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              {selectedSceneId && planData?.segments?.find(s=>s.id===selectedSceneId) ? (()=>{
                const seg = planData.segments.find(s=>s.id===selectedSceneId);
                const ss  = segmentStatus[seg.id] || {};
                const img = getSegmentAsset(seg.id);
                return (
                  <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:12,fontWeight:700,color:'#60a5fa'}}>Scene: {seg.id}</span>
                      <button onClick={()=>setSelectedSceneId(null)} style={{background:'none',border:'none',color:'#334155',cursor:'pointer',fontSize:14,padding:0}}>✕</button>
                    </div>
                    {(img?.filePath||img?.path) && (
                      img?.type==='video'
                        ? <video src={fileUrl(img)} preload="metadata" muted playsInline style={{width:'100%',borderRadius:6,aspectRatio:'16/9',objectFit:'cover'}}
                            onLoadedMetadata={e=>{e.target.currentTime=0.001;}} onError={e=>e.target.style.display='none'}/>
                        : <img src={fileUrl(img)} alt="" style={{width:'100%',borderRadius:6,aspectRatio:'16/9',objectFit:'cover'}}
                            onError={e=>e.target.style.display='none'}/>
                    )}
                    <InspRow label="Type"     value={`${VISUAL_ICONS[seg.visual_type]||''} ${seg.visual_type||'—'}`}/>
                    <InspRow label="Duration" value={`${seg.duration_sec||5}s`}/>
                    <InspRow label="Visual"   value={ss.visual==='done'?'✅ Done':ss.visual==='running'?'⏳...':'⏸ Pending'}/>
                    <InspRow label="Voice"    value={ss.tts==='done'?'✅ Done':ss.tts==='running'?'⏳...':'⏸ Pending'}/>
                    {seg.narration && (
                      <div>
                        <div style={{fontSize:10,color:'#334155',marginBottom:4,textTransform:'uppercase',fontWeight:600,letterSpacing:'0.06em'}}>Narration</div>
                        <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.5,background:'#070b14',border:'1px solid #0d1728',borderRadius:6,padding:'6px 8px',maxHeight:80,overflowY:'auto'}}>{narrationText(seg.narration)}</div>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Tổng quan</div>
                  {planData && <>
                    <InspRow label="Cảnh" value={planData.segments?.length||0}/>
                    <InspRow label="Thời lượng" value={fmtDur(totalDuration)}/>
                    <InspRow label="Assets" value={liveAssets.length}/>
                    <InspRow label="Tools done" value={`${toolLog.filter(e=>e.done).length}/${toolLog.length}`}/>
                  </>}
                  {!planData && <div style={{color:'#1e3a5f',fontSize:12,marginTop:8}}>AI đang khởi động...</div>}
                  {showLog && toolLog.length > 0 && (
                    <div style={{marginTop:8,borderTop:'1px solid #0d1728',paddingTop:8,display:'flex',flexDirection:'column',gap:2}}>
                      {toolLog.slice(-25).map((e,i)=>(
                        <div key={i} style={{fontSize:10,color:e.status==='done'?'#4ade80':e.status==='error'?'#f87171':e.status==='running'?'#60a5fa':'#334155',display:'flex',gap:4,alignItems:'flex-start',padding:'1px 0'}}>
                          <span style={{flexShrink:0}}>{e.status==='done'?'✓':e.status==='error'?'✕':e.status==='running'?'●':'○'}</span>
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{RUNNING_LABELS[e.name]||e.name}{e.args?.segment_id!=null?` #${e.args.segment_id}`:''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          STATE 3 — EDITOR / PREVIEW
      ════════════════════════════════════════════════════════════════ */}
      {appMode === 'editor' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>

          {/* Production running banner */}
          {isRunning && (
            <div style={{height:28,flexShrink:0,display:'flex',alignItems:'center',padding:'0 12px',gap:8,
              background:'linear-gradient(90deg,#1e0a3c,#0c1e33)',borderBottom:'1px solid #3b1d8033'}}>
              <div className="pulse" style={{width:6,height:6,borderRadius:'50%',background:'#a78bfa',flexShrink:0}}/>
              <span style={{fontSize:10,color:'#a78bfa',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
                {currentTool ? `⚙ ${RUNNING_LABELS[currentTool.name]||currentTool.name}${currentTool.args?.segment_id!=null?` #${currentTool.args.segment_id}`:''}…` : status}
              </span>
              <button onClick={handleStop} style={{background:'#3b0f0f',border:'1px solid #7f1d1d44',borderRadius:4,padding:'2px 8px',color:'#f87171',cursor:'pointer',fontSize:9,fontWeight:700,flexShrink:0}}>■ Dừng</button>
            </div>
          )}

          {/* Editor top bar */}
          <div style={{height:44,flexShrink:0,display:'flex',alignItems:'center',padding:'0 12px',gap:8,background:'#04070f',borderBottom:'1px solid #0d1728'}}>
            <button onClick={handleBackToHome} style={{background:'transparent',border:'none',color:'#334155',cursor:'pointer',fontSize:18,padding:'0 4px',lineHeight:1}}>←</button>
            {!isRunning && <button onClick={()=>setAppMode('production')} title="Xem Production" style={{background:'transparent',border:'1px solid #1a2540',borderRadius:5,padding:'3px 8px',color:'#475569',cursor:'pointer',fontSize:11}}>⚙ Production</button>}
            <span style={{fontSize:13,fontWeight:700,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:200}}>{planData?.title||'Video Project'}</span>
            <div style={{flex:1}}/>
            <span style={{fontSize:11,color:'#334155'}}>{fmtDur(totalDuration)}</span>
            <span style={{fontSize:11,color:'#334155'}}>{ratio}</span>
            {renderPath && (
              <button onClick={handleOpenOutput}
                style={{background:'#052e16',border:'1px solid #166534',borderRadius:6,padding:'4px 12px',color:'#4ade80',cursor:'pointer',fontSize:12,fontWeight:600}}>
                ▶ Mở Video
              </button>
            )}
            <button onClick={()=>setShowLog(v=>!v)}
              style={{background:showLog?'#1e1540':'transparent',border:`1px solid ${showLog?'#7c3aed':'#1a2540'}`,borderRadius:5,padding:'4px 8px',color:showLog?'#a78bfa':'#334155',cursor:'pointer',fontSize:11}}>
              📋
            </button>
          </div>

          {/* Editor main area */}
          <div style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

            {/* LEFT — Media panel */}
            <div style={{width:220,flexShrink:0,background:'#03060c',borderRight:'1px solid #0d1728',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              {/* Panel tabs */}
              <div style={{display:'flex',borderBottom:'1px solid #0d1728',flexShrink:0}}>
                {[['media','📁','Media'],['audio','🎵','Audio'],['log','📋','Log']].map(([id,icon,label])=>(
                  <button key={id} onClick={()=>setLeftPanelTab(id)}
                    style={{flex:1,padding:'9px 4px',fontSize:10,fontWeight:600,cursor:'pointer',border:'none',
                      background:leftPanelTab===id?'#070b14':'transparent',
                      color:leftPanelTab===id?'#e2e8f0':'#334155',
                      borderBottom:leftPanelTab===id?`2px solid ${activePreset.color}`:'2px solid transparent'}}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Media Bin with categories */}
              {leftPanelTab==='media' && (
                <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                  {/* Category filter pills */}
                  <div style={{flexShrink:0,padding:'6px 8px',display:'flex',gap:4,flexWrap:'wrap',borderBottom:'1px solid #0d1728'}}>
                    {[['all','Tất cả'],['video','Video'],['image','Ảnh'],['voice','Giọng'],['music','Nhạc'],['sfx','SFX'],['seo','SEO'],['thumbnail','Thumb']].map(([cat,label])=>{
                      const count = cat==='all' ? liveAssets.length : liveAssets.filter(a=>a.type===cat||(cat==='image'&&a.type==='image')||(cat==='video'&&a.type==='video')).length;
                      return (
                        <button key={cat} onClick={()=>setMediaCat(cat)}
                          style={{padding:'2px 7px',borderRadius:99,fontSize:9,fontWeight:600,cursor:'pointer',border:'none',
                            background:mediaCat===cat?activePreset.color+'33':'transparent',
                            color:mediaCat===cat?activePreset.color:'#334155',
                            outline:mediaCat===cat?`1px solid ${activePreset.color}44`:undefined}}>
                          {label}{count>0?` (${count})`:''}
                        </button>
                      );
                    })}
                  </div>
                  {/* Asset list */}
                  <div style={{flex:1,overflowY:'auto',padding:8,display:'flex',flexDirection:'column',gap:6}}>
                    {liveAssets.length===0 && <div style={{color:'#1e293b',fontSize:11,padding:'10px 4px',textAlign:'center'}}>Chưa có assets</div>}
                    {liveAssets
                      .filter(a => mediaCat==='all' || a.type===mediaCat)
                      .map(asset=>{
                        const isAI=asset.source==='veo'||asset.source==='imagen4'||asset.source==='imagen'||asset.source==='gemini';
                        const isFallback=asset.source==='illustration_fallback'||asset.source==='remotion_illustration'||asset.fallback_level>=2;
                        const srcBadge = isAI?'AI':isFallback?'Fallback':asset.source==='pexels'?'Pexels':asset.source==='pixabay'?'Pixbay':'GFX';
                        const typeIcon = asset.type==='image'?'🖼️':asset.type==='video'?'🎥':asset.type==='audio'?'🎙️':asset.type==='voice'?'🎙️':asset.type==='music'?'🎵':asset.type==='sfx'?'💥':asset.type==='seo'?'📊':asset.type==='thumbnail'?'🎨':'📄';
                        return (
                          <div key={asset.id} onClick={()=>{if(asset.segId && typeof asset.segId === 'number')handleSeekToScene(asset.segId);}}
                            style={{borderRadius:7,background:'#070b14',border:'1px solid #0d1728',cursor:'pointer',overflow:'hidden',
                              transition:'border-color .15s'}}
                            onMouseEnter={e=>e.currentTarget.style.borderColor='#1e3a5f'}
                            onMouseLeave={e=>e.currentTarget.style.borderColor='#0d1728'}>
                            {/* Thumbnail */}
                            {asset.type==='thumbnail'
                              ? <div style={{width:'100%',aspectRatio:'16/9',overflow:'hidden',background:'#030609',position:'relative'}}>
                                  <img src={fileUrl(asset)} alt="Thumbnail" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                                  <div style={{position:'absolute',top:3,left:3,background:'#00000088',borderRadius:3,padding:'1px 5px',fontSize:8,color:'#f59e0b',fontWeight:700}}>THUMB</div>
                                </div>
                              : asset.type==='seo'
                              ? <div style={{padding:'8px 10px',background:'#050c1e',fontSize:9,color:'#94a3b8',lineHeight:1.5}}>
                                  <div style={{fontWeight:700,color:'#a78bfa',marginBottom:3}}>📊 SEO Metadata</div>
                                  {asset.seoData?.title && <div style={{color:'#e2e8f0',marginBottom:2}}>📌 {asset.seoData.title}</div>}
                                  {asset.seoData?.hashtags && <div style={{color:'#60a5fa',fontSize:8}}>{asset.seoData.hashtags}</div>}
                                </div>
                              : (asset.type==='image'||asset.type==='video')
                              ? <div style={{width:'100%',aspectRatio:'16/9',overflow:'hidden',background:'#030609',position:'relative'}}>
                                  {asset.type==='video'
                                    ? <video src={fileUrl(asset)} preload="metadata" muted playsInline
                                        style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}
                                        onError={e=>{e.target.style.display='none';const fb=e.target.parentElement.querySelector('.fallback');if(fb)fb.style.display='flex';}}/>
                                    : <img src={fileUrl(asset)} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}
                                        onError={e=>{e.target.style.display='none';const fb=e.target.parentElement.querySelector('.fallback');if(fb)fb.style.display='flex';}}/>
                                  }
                                  <div className="fallback" style={{display:'none',position:'absolute',inset:0,alignItems:'center',justifyContent:'center',fontSize:20,color:'#334155'}}>{typeIcon}</div>
                                  {asset.type==='video'&&<div style={{position:'absolute',top:3,left:3,background:'#00000088',borderRadius:3,padding:'1px 4px',fontSize:8,color:'#60a5fa',fontWeight:700}}>▶</div>}
                                </div>
                              : asset.type==='sfx'
                              ? <div style={{width:'100%',height:40,background:'#0a1525',display:'flex',alignItems:'center',gap:8,padding:'0 10px'}}>
                                  <span style={{fontSize:18}}>💥</span>
                                  <div>
                                    <div style={{fontSize:10,color:'#e2e8f0',fontWeight:600}}>{asset.path || asset.label}</div>
                                    <div style={{fontSize:8,color:'#475569'}}>@ {asset.at_sec}s · vol {Math.round((asset.volume||0.7)*100)}%</div>
                                  </div>
                                </div>
                              : <div style={{width:'100%',height:40,background:'#0a1525',display:'flex',alignItems:'center',gap:8,padding:'0 10px'}}>
                                  <span style={{fontSize:18}}>{typeIcon}</span>
                                  {asset.duration && <div style={{fontSize:8,color:'#475569'}}>{Math.round(asset.duration)}s</div>}
                                </div>
                            }
                            {/* Info row */}
                            <div style={{padding:'4px 8px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:4}}>
                              <span style={{fontSize:9,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
                                {asset.label||asset.segId||asset.id}
                              </span>
                              <span title={isFallback?'Illustration tự tạo — cần kết nối FluxyExtension để tạo ảnh/video AI thật':undefined}
                                style={{fontSize:7,fontWeight:800,flexShrink:0,
                                color:isAI?'#4ade80':isFallback?'#f87171':asset.source==='pexels'||asset.source==='pixabay'?'#60a5fa':'#f59e0b'}}>
                                {srcBadge}
                              </span>
                            </div>
                          </div>
                        );
                    })}
                  </div>
                </div>
              )}

              {/* Audio tab */}
              {leftPanelTab==='audio' && (
                <div style={{flex:1,overflowY:'auto',padding:'10px 12px',display:'flex',flexDirection:'column',gap:10}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'.07em'}}>Voice Assets</div>
                  {liveAssets.filter(a=>a.type==='audio'||a.type==='voice').map(a=>(
                    <div key={a.id} style={{background:'#0a1525',border:'1px solid #1e3a5f44',borderRadius:6,padding:'6px 8px'}}>
                      <div style={{fontSize:10,color:'#60a5fa',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.label||a.segId}</div>
                      {a.duration && <div style={{fontSize:9,color:'#334155'}}>{fmtDur(a.duration)}</div>}
                    </div>
                  ))}
                  {liveAssets.filter(a=>a.type==='audio'||a.type==='voice').length===0 && <div style={{color:'#1e293b',fontSize:11}}>Không có audio</div>}
                </div>
              )}

              {/* Log tab */}
              {leftPanelTab==='log' && (
                <div ref={logScrollRef} style={{flex:1,overflowY:'auto',padding:'10px 12px',display:'flex',flexDirection:'column',gap:2}}>
                  {toolLog.slice(-40).map((e,i)=>(
                    <div key={i} style={{fontSize:10,padding:'2px 0',alignItems:'flex-start',
                      color:e.status==='done'?'#4ade80':e.status==='error'?'#f87171':e.status==='info'?'#fbbf24':'#60a5fa',
                      display:'flex',gap:4}}>
                      <span style={{flexShrink:0}}>{e.status==='done'?'✓':e.status==='error'?'✕':e.status==='info'?'💬':'●'}</span>
                      {e.name==='_ai_text'
                        ? <span style={{color:'#fbbf24',lineHeight:1.4,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{e.text?.slice(0,200)}</span>
                        : <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{RUNNING_LABELS[e.name]||e.name}{e.args?.segment_id!=null?` #${e.args.segment_id}`:''}</span>
                      }
                    </div>
                  ))}
                  {toolLog.length===0 && <div style={{color:'#1e293b',fontSize:11}}>Chưa có log</div>}
                </div>
              )}
            </div>

            {/* CENTER — Video preview */}
            <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#030609',minWidth:0}}>
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:16,minHeight:0}}>
                {renderPath ? (
                  <div style={{maxWidth:'100%',maxHeight:'100%',position:'relative',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <video ref={videoRef} src={fileUrl(renderPath)} controls style={{maxWidth:'100%',maxHeight:'100%',borderRadius:10,border:'1px solid #0d1728',background:'#000'}}
                      onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)} onEnded={()=>setIsPlaying(false)}/>
                  </div>
                ) : isRunning ? (() => {
                  // Live preview: show latest visual asset or current scene narration
                  const latestVisual = [...liveAssets].reverse().find(a => a.type==='image' || a.type==='video');
                  const activeSeg = currentTool?.args?.segment_id != null
                    ? planData?.segments?.find(s => String(s.id) === String(currentTool.args.segment_id))
                    : null;
                  return (
                    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,position:'relative'}}>
                      {latestVisual?.path ? (
                        <div style={{maxWidth:'80%',maxHeight:'70%',position:'relative'}}>
                          {latestVisual.type==='video'
                            ? <video src={fileUrl(latestVisual)} autoPlay muted loop style={{maxWidth:'100%',maxHeight:'100%',borderRadius:8,border:'1px solid #1a2540'}}/>
                            : <img src={fileUrl(latestVisual)} alt="" style={{maxWidth:'100%',maxHeight:'100%',borderRadius:8,border:'1px solid #1a2540',objectFit:'contain'}} onError={e=>e.target.style.display='none'}/>
                          }
                          <div style={{position:'absolute',top:6,left:6,background:'#00000099',borderRadius:4,padding:'2px 7px',fontSize:9,color:'#a78bfa',fontWeight:700}}>
                            {latestVisual.label || `Cảnh ${latestVisual.segId}`}
                          </div>
                        </div>
                      ) : (
                        <div style={{width:200,height:112,borderRadius:8,border:'1px dashed #1a2540',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,color:'#1e3a5f'}}>
                          <div className="pulse" style={{width:12,height:12,borderRadius:'50%',background:'#7c3aed'}}/>
                          <div style={{fontSize:11}}>Đang tạo assets...</div>
                        </div>
                      )}
                      {activeSeg && (
                        <div style={{maxWidth:500,background:'#070b14',border:'1px solid #1a2540',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#94a3b8',lineHeight:1.6,textAlign:'center'}}>
                          <div style={{fontSize:10,color:'#475569',marginBottom:4,fontWeight:600}}>CẢNH {activeSeg.id} · {currentTool?.name ? (RUNNING_LABELS[currentTool.name]||currentTool.name) : ''}</div>
                          {narrationText(activeSeg.narration).slice(0,140)}{narrationText(activeSeg.narration).length>140?'…':''}
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,color:'#1e3a5f'}}>
                    <div style={{fontSize:48}}>🎬</div>
                    <div style={{fontSize:14,fontWeight:600}}>Video chưa render</div>
                    <button onClick={()=>setAppMode('production')} style={{background:'#0a1020',border:'1px solid #1a2540',borderRadius:8,padding:'8px 20px',color:'#475569',cursor:'pointer',fontSize:13}}>← Quay lại Production</button>
                  </div>
                )}
              </div>

              {/* Scrubber */}
              {renderPath && totalDuration > 0 && (
                <div style={{padding:'8px 16px',background:'#04070f',borderTop:'1px solid #0d1728',display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,color:'#475569',width:38,flexShrink:0}}>{fmtDur(Math.floor(playhead))}</span>
                  <input type="range" min={0} max={totalDuration} step={0.1} value={playhead}
                    onChange={e=>{const t=Number(e.target.value);setPlayhead(t);if(videoRef.current)videoRef.current.currentTime=t;}}
                    style={{flex:1,accentColor:activePreset.color}}/>
                  <span style={{fontSize:11,color:'#334155',width:38,flexShrink:0,textAlign:'right'}}>{fmtDur(totalDuration)}</span>
                </div>
              )}
            </div>

            {/* RIGHT — Inspector */}
            <div style={{width:240,flexShrink:0,background:'#03060c',borderLeft:'1px solid #0d1728',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'10px 14px',borderBottom:'1px solid #0d1728',fontSize:11,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'.07em'}}>
                {selectedSceneId ? 'Scene Inspector' : 'Project Info'}
              </div>

              {selectedSceneId && planData?.segments?.find(s=>s.id===selectedSceneId) ? (()=>{
                const seg = planData.segments.find(s=>s.id===selectedSceneId);
                const ss  = segmentStatus[seg.id] || {};
                const img = getSegmentAsset(seg.id);
                return (
                  <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:13,fontWeight:700,color:'#94a3b8'}}>{seg.id}</span>
                      <button onClick={()=>setSelectedSceneId(null)} style={{background:'none',border:'none',color:'#334155',cursor:'pointer',fontSize:14,padding:0}}>✕</button>
                    </div>
                    {img?.path && <img src={fileUrl(img.path)} alt="" style={{width:'100%',borderRadius:6,aspectRatio:'16/9',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>}
                    <InspRow label="Visual type" value={`${VISUAL_ICONS[seg.visual_type]||''} ${seg.visual_type||'—'}`}/>
                    <InspRow label="Duration"    value={`${seg.duration_sec||5}s`}/>
                    <InspRow label="Visual"      value={ss.visual==='done'?'✅ Done':ss.visual==='running'?'⏳':'—'}/>
                    <InspRow label="Voice"       value={ss.tts==='done'?'✅ Done':ss.tts==='running'?'⏳':'—'}/>
                    {seg.narration && (
                      <div>
                        <div style={{fontSize:10,color:'#334155',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Narration</div>
                        <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.5,background:'#070b14',border:'1px solid #0d1728',borderRadius:6,padding:'6px 8px',maxHeight:90,overflowY:'auto'}}>{narrationText(seg.narration)}</div>
                      </div>
                    )}
                    {seg.visual?.prompt && (
                      <div>
                        <div style={{fontSize:10,color:'#334155',marginBottom:4,textTransform:'uppercase',fontWeight:600}}>Visual Prompt</div>
                        <div style={{fontSize:10,color:'#475569',lineHeight:1.4,background:'#070b14',border:'1px solid #0d1728',borderRadius:6,padding:'6px 8px',maxHeight:60,overflowY:'auto'}}>{seg.visual.prompt}</div>
                      </div>
                    )}
                    <button onClick={()=>handleSeekToScene(seg.id)} style={{width:'100%',background:'#0c1e33',border:`1px solid ${activePreset.color}44`,borderRadius:8,padding:'7px',color:activePreset.color,cursor:'pointer',fontSize:12,fontWeight:600}}>
                      ⏩ Seek to scene
                    </button>
                  </div>
                );
              })() : (
                <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:8}}>
                  {planData && <>
                    <InspRow label="Project" value={planData.title?.slice(0,30)||'—'}/>
                    <InspRow label="Cảnh"    value={planData.segments?.length||0}/>
                    <InspRow label="Thời lượng" value={fmtDur(totalDuration)}/>
                    <InspRow label="Assets"  value={liveAssets.length}/>
                    <InspRow label="Tỉ lệ"   value={ratio}/>
                  </>}
                  {renderPath && (
                    <button onClick={handleOpenOutput} style={{width:'100%',marginTop:8,background:'#052e16',border:'1px solid #166534',borderRadius:8,padding:'8px',color:'#4ade80',cursor:'pointer',fontSize:12,fontWeight:600}}>
                      ▶ Mở Video File
                    </button>
                  )}
                  {planData?.thumbnailPath && (
                    <div style={{marginTop:4}}>
                      <div style={{fontSize:9,color:'#334155',marginBottom:4,textTransform:'uppercase',fontWeight:700,letterSpacing:'.06em'}}>Thumbnail</div>
                      <img src={fileUrl(planData.thumbnailPath)} alt="Thumbnail"
                        style={{width:'100%',borderRadius:6,aspectRatio:'16/9',objectFit:'cover',border:'1px solid #1a2540'}}
                        onError={e=>e.target.style.display='none'}/>
                    </div>
                  )}
                  {planData?.seoData?.title && (
                    <div style={{marginTop:4,background:'#050c1e',borderRadius:7,padding:'8px 10px',border:'1px solid #0d1728'}}>
                      <div style={{fontSize:9,color:'#a78bfa',fontWeight:700,marginBottom:5,textTransform:'uppercase',letterSpacing:'.06em'}}>📊 SEO Metadata</div>
                      <div style={{fontSize:10,color:'#e2e8f0',lineHeight:1.4,marginBottom:4,fontWeight:600}}>{planData.seoData.title}</div>
                      {planData.seoData.hashtags && <div style={{fontSize:9,color:'#60a5fa',marginBottom:4}}>{planData.seoData.hashtags}</div>}
                      {planData.seoData.tags?.length > 0 && (
                        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:4}}>
                          {planData.seoData.tags.slice(0,8).map((t,i)=>(
                            <span key={i} style={{fontSize:8,background:'#0d1728',borderRadius:4,padding:'1px 5px',color:'#475569'}}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{marginTop:8,borderTop:'1px solid #0d1728',paddingTop:8,fontSize:10,color:'#1e3a5f'}}>
                    Click vào scene để xem chi tiết
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* ── BOTTOM: Scene strip + Timeline ── */}
          <div style={{height:260,flexShrink:0,borderTop:'1px solid #0d1728',display:'flex',flexDirection:'column',background:'#04070f'}}>
            {/* Scene strip */}
            <div style={{height:82,flexShrink:0,borderBottom:'1px solid #0d1728',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{height:20,flexShrink:0,display:'flex',alignItems:'center',padding:'0 10px',gap:6,borderBottom:'1px solid #0d1728'}}>
                <span style={{fontSize:9,fontWeight:700,color:'#1e3a5f',textTransform:'uppercase',letterSpacing:'.08em'}}>Scenes</span>
                <span style={{fontSize:9,color:'#1e293b',marginLeft:'auto'}}>{planData?.segments?.length||0} cảnh · {fmtDur(totalDuration)}</span>
              </div>
              <div style={{flex:1,overflowX:'auto',overflowY:'hidden',display:'flex',alignItems:'center',gap:6,padding:'4px 10px',whiteSpace:'nowrap'}}>
                {(planData?.segments||[]).map(seg=>{
                  const img=getSegmentAsset(seg.id);
                  const active=selectedSceneId===seg.id;
                  return (
                    <div key={seg.id} onClick={()=>handleSeekToScene(seg.id)}
                      style={{flexShrink:0,width:88,height:52,borderRadius:5,background:'#070b14',border:`1.5px solid ${active?activePreset.color:'#0d1728'}`,cursor:'pointer',overflow:'hidden',position:'relative',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
                      {img?.path
                        ? <img src={fileUrl(img.path)} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>
                        : <span style={{fontSize:14,opacity:.2}}>{VISUAL_ICONS[seg.visual_type]||'🎬'}</span>}
                      <div style={{position:'absolute',bottom:0,left:0,right:0,background:'#00000088',padding:'2px 4px',fontSize:7,color:'#94a3b8',fontWeight:600}}>{seg.id}</div>
                    </div>
                  );
                })}
                {(planData?.segments||[]).length===0 && <div style={{color:'#1e293b',fontSize:11,padding:'0 8px'}}>Không có scene</div>}
              </div>
            </div>

            {/* Timeline */}
            <div style={{flex:1,overflow:'hidden'}}>
              <EditorTimeline computedClips={computedClips} liveAssets={liveAssets} segmentStatus={segmentStatus}
                selectedSceneId={selectedSceneId} onSelectScene={handleSeekToScene}
                playhead={playhead} totalDuration={totalDuration} zoom={timelineZoom}
                accentColor={activePreset.color} manualSfxList={manualSfxList}/>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}


// ─── Sub-components ────────────────────────────────────────────────────────────

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <span style={{ fontSize:11, color:'#475569', fontWeight:600, letterSpacing:'0.04em' }}>{label}</span>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ background:'#0a1020', border:'1px solid #1a2540', borderRadius:8, padding:'7px 10px', color:'#cbd5e1', fontSize:12, cursor:'pointer' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function StatusBadge({ label, status }) {
  const color = status==='done'?'#4ade80' : status==='running'?'#60a5fa' : status==='error'?'#f87171' : '#1e293b';
  const bg    = status==='done'?'#052e16' : status==='running'?'#0c1e33' : status==='error'?'#1f0a0a' : '#0a1020';
  return (
    <span style={{ fontSize:8, fontWeight:700, padding:'2px 5px', borderRadius:4, background:bg, border:`1px solid ${color}44`, color }}>
      {status==='running' ? '⏳ ' : status==='done' ? '✓ ' : ''}{label}
    </span>
  );
}

function InspRow({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, gap:8 }}>
      <span style={{ color:'#334155', flexShrink:0 }}>{label}</span>
      <span style={{ color:'#e2e8f0', fontWeight:600, textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{value}</span>
    </div>
  );
}

// ─── Editor Timeline ──────────────────────────────────────────────────────────
function EditorTimeline({ computedClips, liveAssets, segmentStatus, selectedSceneId, onSelectScene, playhead, totalDuration, zoom, accentColor, manualSfxList }) {
  const PX_PER_SEC = zoom;
  const HEADER_W   = 68;
  const totalW = Math.max(totalDuration * PX_PER_SEC + 120, 600);

  const musicAssets = (liveAssets||[]).filter(a=>a.type==='music');
  const clips = computedClips || [];

  const TRACKS = [
    {id:'video',  label:'VIDEO',  h:46, color:'#3b82f6'},
    {id:'voice',  label:'VOICE',  h:28, color:'#16a34a'},
    {id:'music',  label:'MUSIC',  h:22, color:'#d97706'},
    {id:'sfx',    label:'SFX',    h:20, color:'#6366f1'},
    {id:'caption',label:'CAPTION',h:18, color:'#64748b'},
  ];

  const tickStep = totalDuration > 120 ? 10 : totalDuration > 60 ? 5 : 2;
  const ticks = [];
  for (let t=0; t<=totalDuration+tickStep; t+=tickStep) ticks.push(t);

  const playheadX = playhead * PX_PER_SEC;

  // Synchronized scroll across all tracks
  const scrollRef = React.useRef(null);
  const handleScroll = React.useCallback(e => {
    const x = e.currentTarget.scrollLeft;
    if (scrollRef.current !== e.currentTarget) return;
    document.querySelectorAll('.tl-track-scroll').forEach(el => {
      if (el !== e.currentTarget) el.scrollLeft = x;
    });
  }, []);

  return (
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',overflow:'hidden',background:'#030609'}}>
      {/* Timecode header */}
      <div style={{display:'flex',flexShrink:0,borderBottom:'1px solid #0d1728',height:18}}>
        <div style={{width:HEADER_W,flexShrink:0,borderRight:'1px solid #0d1728',background:'#04070f'}}/>
        <div className="tl-track-scroll" onScroll={handleScroll} style={{flex:1,overflowX:'auto',overflowY:'hidden',position:'relative',background:'#04070f'}}>
          <div style={{width:totalW,position:'relative',height:'100%'}}>
            {ticks.map(t=>(
              <div key={t} style={{position:'absolute',left:t*PX_PER_SEC,top:0,height:'100%',display:'flex',flexDirection:'column',alignItems:'flex-start'}}>
                <div style={{width:1,height:t%10===0?8:4,background:'#1a2540'}}/>
                {t%10===0 && <span style={{fontSize:7,color:'#334155',paddingLeft:2,marginTop:1,whiteSpace:'nowrap'}}>{t}s</span>}
              </div>
            ))}
            {/* Playhead */}
            <div style={{position:'absolute',left:playheadX,top:0,width:2,height:'100%',background:accentColor,zIndex:10}}/>
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div style={{flex:1,overflowY:'auto',overflowX:'hidden'}}>
        {TRACKS.map(track=>(
          <div key={track.id} style={{display:'flex',height:track.h,borderBottom:'1px solid #0d1728',flexShrink:0}}>
            <div style={{width:HEADER_W,flexShrink:0,borderRight:'1px solid #0d1728',display:'flex',alignItems:'center',paddingLeft:6,background:'#04070f'}}>
              <span style={{fontSize:7,fontWeight:700,color:'#1e3a5f',letterSpacing:'0.06em'}}>{track.label}</span>
            </div>
            <div className="tl-track-scroll" onScroll={handleScroll} style={{flex:1,overflowX:'auto',overflowY:'hidden',position:'relative',minWidth:0}}>
              <div style={{width:totalW,height:'100%',position:'relative'}}>
                {/* VIDEO track — real thumbnails */}
                {track.id==='video' && clips.map(({seg,start,dur,visualAsset})=>{
                  const active=selectedSceneId===String(seg.id);
                  const ss=segmentStatus?.[String(seg.id)]||{};
                  const imgSrc=visualAsset?fileUrl(visualAsset):null;
                  const clipW=Math.max(dur*PX_PER_SEC-2,4);
                  return (
                    <div key={seg.id} onClick={()=>onSelectScene(String(seg.id))}
                      title={`${seg.id} · ${Math.round(dur)}s`}
                      style={{position:'absolute',left:start*PX_PER_SEC+1,top:1,width:clipW,height:track.h-2,
                        border:`1.5px solid ${active?track.color:track.color+'44'}`,
                        borderRadius:4,cursor:'pointer',overflow:'hidden',
                        background:imgSrc?'#000':active?track.color+'40':track.color+'18',
                        boxShadow:active?`0 0 0 1px ${track.color}66`:undefined}}>
                      {imgSrc
                        ? (visualAsset?.type==='video'
                            ? <video src={imgSrc} preload="metadata" muted playsInline style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} onLoadedMetadata={e=>{e.target.currentTime=0.001;}} onError={e=>{e.target.style.display='none';}}/>
                            : <img src={imgSrc} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} onError={e=>{e.target.style.display='none';}}/>)
                        : ss.visual==='running'
                          ? <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>
                              <div className="pulse" style={{width:8,height:8,borderRadius:'50%',background:track.color}}/>
                            </div>
                          : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:track.color+'88',fontWeight:700,letterSpacing:'.04em'}}>
                              {seg.id}
                            </div>
                      }
                      <div style={{position:'absolute',bottom:1,right:2,fontSize:7,color:'rgba(255,255,255,.6)',fontWeight:700,textShadow:'0 1px 2px #000'}}>{Math.round(dur)}s</div>
                    </div>
                  );
                })}
                {/* VOICE track — waveform */}
                {track.id==='voice' && clips.map(({seg,start,dur,voiceAsset})=>{
                  const ss=segmentStatus?.[String(seg.id)]||{};
                  const hasVoice=!!voiceAsset;
                  if(!hasVoice&&ss.tts!=='running') return null;
                  const clipW=Math.max(dur*PX_PER_SEC-2,4);
                  return (
                    <div key={seg.id} style={{position:'absolute',left:start*PX_PER_SEC+1,top:2,width:clipW,height:track.h-4,
                      background:track.color+'18',border:`1px solid ${track.color}55`,borderRadius:3,
                      display:'flex',alignItems:'center',padding:'0 2px',overflow:'hidden',gap:.5}}>
                      {ss.tts==='running'&&<div className="pulse" style={{width:3,height:3,borderRadius:'50%',background:track.color,flexShrink:0}}/>}
                      {hasVoice&&[...Array(Math.min(Math.floor(clipW/2),180))].map((_,i)=>(
                        <div key={i} style={{width:1,flexShrink:0,background:track.color,
                          height:`${12+Math.abs(Math.sin(i*1.9+seg.id.length)*Math.cos(i*.7))*80}%`,
                          opacity:.65,borderRadius:1}}/>
                      ))}
                    </div>
                  );
                })}
                {/* MUSIC track — full bar waveform */}
                {track.id==='music' && musicAssets.length>0 && (
                  <div style={{position:'absolute',left:1,top:2,width:Math.max(totalW-2,4),height:track.h-4,
                    background:track.color+'18',border:`1px solid ${track.color}44`,borderRadius:3,
                    display:'flex',alignItems:'center',padding:'0 4px',overflow:'hidden',gap:.5}}>
                    <span style={{fontSize:7,color:track.color,flexShrink:0,marginRight:4,opacity:.8}}>{musicAssets[0]?.label||'music'}</span>
                    {[...Array(Math.min(Math.floor((totalW-50)/2),200))].map((_,i)=>(
                      <div key={i} style={{width:1,flexShrink:0,background:track.color,
                        height:`${15+Math.abs(Math.sin(i*.8)*Math.cos(i*.3+1))*70}%`,opacity:.5,borderRadius:1}}/>
                    ))}
                  </div>
                )}
                {/* SFX markers */}
                {track.id==='sfx' && (() => {
                  const allSfx=[...(manualSfxList||[]).map(s=>({...s,src:'manual'})),...((liveAssets||[]).filter(a=>a.type==='sfx'))];
                  return allSfx.map((sfx,i)=>(
                    <div key={i} title={sfx.id||sfx.label||'SFX'} style={{position:'absolute',left:((sfx.at_sec||sfx.start||0)*PX_PER_SEC),top:2,
                      width:8,height:track.h-4,background:track.color+'aa',borderRadius:2,cursor:'default',
                      display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <div style={{width:4,height:4,borderRadius:'50%',background:'#fff',opacity:.8}}/>
                    </div>
                  ));
                })()}
                {/* CAPTION track */}
                {track.id==='caption' && clips.map(({seg,start,dur})=>(
                  <div key={seg.id} style={{position:'absolute',left:start*PX_PER_SEC+1,top:2,
                    width:Math.max(dur*PX_PER_SEC-2,4),height:track.h-4,
                    background:'#1e293b22',border:'1px solid #1e293b44',borderRadius:3,
                    display:'flex',alignItems:'center',padding:'0 4px',overflow:'hidden'}}>
                    <span style={{fontSize:7,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {(narrationText(seg.narration)||seg.text_heading||'').slice(0,45)}
                    </span>
                  </div>
                ))}
                {/* Playhead */}
                <div style={{position:'absolute',left:playheadX,top:0,width:2,height:'100%',background:accentColor,opacity:.7,zIndex:5,pointerEvents:'none'}}/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
