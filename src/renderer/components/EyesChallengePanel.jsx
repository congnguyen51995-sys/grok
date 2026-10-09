/**
 * Eyes Challenge Panel
 * Chọn thư mục ảnh → mỗi lần random N ảnh → xoay + TTS + render
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';

const api = window.electronAPI;

// ── AI Image Subject Identifier ──────────────────────────────────────────────

function getGeminiKeys() {
  try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; }
}

// Words to strip from descriptive filenames
const STRIP_WORDS = new Set([
  'style','animation','full','body','single','view','shadow','sideview',
  'childrens','cartoon','vintage','circus','victorian','cute','happy','sad',
  'surprised','looking','illustration','character','design','drawing','art',
  'anime','realistic','open','closed','with','and','the','for','high',
  'quality','render','image','photo','white','black','color','no','detail',
  'detailed','studio','juice','slice','fruit','up','down','left','right',
  'front','back','side','small','large','big','little','adorable','beautiful',
  'transparent','png','isolated',
]);

function isHexId(s) {
  return /^[0-9a-f]{16,}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);
}

// Chuyển số nhiều → số ít cho tên con vật/đồ vật
function singularize(w) {
  if (!w || w.length < 3) return w;
  if (w.endsWith('ies'))  return w.slice(0, -3) + 'y';   // bunnies→bunny
  if (w.endsWith('ves'))  return w.slice(0, -3) + 'f';   // wolves→wolf
  if (/[^s]xes$/.test(w))return w.slice(0, -2);           // foxes→fox
  if (w.endsWith('ses') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1); // rabbits→rabbit
  return w;
}

function extractFromFilename(fp) {
  const s = stem(fp).toLowerCase();
  if (isHexId(s)) return null;
  const words = s.split(/[-_\s]+/)
    .map(singularize)
    .filter(w => w.length > 1 && !STRIP_WORDS.has(w));
  return words.slice(0, 2).join(' ') || null;
}

// Gemini Vision: nhận diện nội dung ảnh, kết quả cache localStorage
async function identifyImageSubject(imagePath) {
  const cacheKey = 'eyes_subj_' + btoa(encodeURIComponent(imagePath)).replace(/[+/=]/g,'').slice(-28);
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  // Thử filename trước (nhanh, không tốn API)
  const fromName = extractFromFilename(imagePath);
  if (fromName && !isHexId(stem(imagePath))) {
    localStorage.setItem(cacheKey, fromName);
    return fromName;
  }

  // Dùng Gemini Vision cho hex filenames
  const keys = getGeminiKeys();
  if (!keys.length) return fromName || stem(imagePath);

  try {
    const dataUrl = await api.readImageAsDataUrl(imagePath);
    if (!dataUrl) return fromName || stem(imagePath);
    const base64   = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(';')[0].slice(5) || 'image/jpeg';

    const ai = new GoogleGenAI({ apiKey: keys[0] });
    const r  = await ai.models.generateContent({
      model   : 'gemini-3.5-flash',
      contents: [{
        role : 'user',
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: 'What is the main subject/object in this image? Reply with 1-3 words ONLY (e.g. "cat", "elephant", "strawberry", "rubber duck"). No explanation, no punctuation.' },
        ],
      }],
      config: { maxOutputTokens: 32 },
    });
    const raw  = r?.text || r?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const name = raw.trim().toLowerCase().replace(/[^a-z\s]/g, '').trim();
    if (name) { localStorage.setItem(cacheKey, name); return name; }
  } catch (e) {
    console.warn('[Eyes Vision]', stem(imagePath), e.message);
  }

  return fromName || stem(imagePath);
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const VOICES = {
  vi: [
    { id: 'vi-VN-NamMinhNeural',  label: 'Nam Minh (Nam)'   },
    { id: 'vi-VN-HoaiMyNeural',   label: 'Hoài My (Nữ)'    },
    { id: 'vi-VN-NamKhanhNeural', label: 'Nam Khánh (Nam)' },
  ],
  en: [
    { id: 'en-US-AriaNeural',     label: 'Aria (US Female)'    },
    { id: 'en-US-GuyNeural',      label: 'Guy (US Male)'       },
    { id: 'en-GB-SoniaNeural',    label: 'Sonia (UK Female)'   },
    { id: 'en-AU-NatashaNeural',  label: 'Natasha (AU Female)' },
    { id: 'en-US-JennyNeural',    label: 'Jenny (US Female)'   },
  ],
};

const KOKORO_VOICES = [
  { id: 'af_heart',   label: 'Heart (EN Female)' },
  { id: 'af_bella',   label: 'Bella (EN Female)' },
  { id: 'am_adam',    label: 'Adam (EN Male)'     },
  { id: 'am_michael', label: 'Michael (EN Male)'  },
  { id: 'bf_emma',    label: 'Emma (EN Female)'   },
  { id: 'bm_george',  label: 'George (EN Male)'   },
];

// Trộn mảng Fisher-Yates
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tên file không có extension
const stem = (fp) => fp.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

// Tên đọc được cho TTS: bỏ hyphen/underscore → dấu cách
const readableName = (fp) => stem(fp).replace(/[-_]+/g, ' ');

function LogLine({ text, type }) {
  const c = type === 'error' ? 'text-red-400' : type === 'success' ? 'text-green-400' : 'text-slate-300';
  return <div className={`text-xs font-mono ${c} leading-5`}>{text}</div>;
}

function Pill({ active, onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 ${
        active
          ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-fuchsia-600 hover:text-white'
      }`}
    >{children}</button>
  );
}

const Spin = () => <span className="inline-block animate-spin">⏳</span>;

export default function EyesChallengePanel() {
  const [imageDir,    setImageDir]    = useState('');   // thư mục ảnh nguồn
  const [outputDir,   setOutputDir]   = useState('');   // thư mục lưu video
  const [count,       setCount]       = useState(4);
  const [outline,     setOutline]     = useState('auto');
  const [lang,        setLang]        = useState('en');
  const [ttsProvider, setTtsProvider] = useState('edge');
  const [voice,       setVoice]       = useState('en-US-AriaNeural');
  const [kokoroOk,    setKokoroOk]    = useState(false);
  const [batchCount,  setBatchCount]  = useState(1);   // số video tạo 1 lần

  const [allImages,   setAllImages]   = useState([]);  // toàn bộ ảnh trong folder
  const [picked,      setPicked]      = useState([]);  // ảnh đang được chọn cho lần này

  const [isRunning,   setIsRunning]   = useState(false);
  const [logs,        setLogs]        = useState([]);
  const [outputPaths, setOutputPaths] = useState([]);
  const logsEndRef = useRef(null);

  const addLog = useCallback((text, type = 'info') =>
    setLogs(prev => [...prev.slice(-200), { text, type, id: Date.now() + Math.random() }]), []);
  const log    = t => addLog(t, 'info');
  const logOk  = t => addLog(t, 'success');
  const logErr = t => addLog(t, 'error');

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Reset voice khi đổi lang/ttsProvider
  useEffect(() => {
    setVoice(
      ttsProvider === 'kokoro' ? 'am_adam'
      : lang === 'vi' ? 'vi-VN-NamMinhNeural'
      : 'en-US-GuyNeural'
    );
  }, [lang, ttsProvider]);

  useEffect(() => {
    api.getSetting?.('outputDir', '').then(d => { if (d) setOutputDir(d); }).catch(() => {});
    api.getSetting?.('eyesImageDir', '').then(d => { if (d) { setImageDir(d); loadFolder(d); } }).catch(() => {});
    api.kokoroCheckStatus?.()
      .then(r => setKokoroOk(!!(r?.modelsReady && r?.serverRunning)))
      .catch(() => setKokoroOk(false));
  }, []);

  // ── Load ảnh từ folder (đệ quy, gom theo subfolder) ─────────────────────

  const loadFolder = async (dir) => {
    // Thử scan đệ quy trước
    const res = await api.listImagesRecursive?.(dir).catch(() => null)
              || await api.listFiles?.(dir).catch(() => ({ files: [] }));
    const imgs = (res?.files || []).filter(f => {
      const ext = f.split('.').pop()?.toLowerCase();
      return IMAGE_EXTS.has(ext);
    });
    setAllImages(imgs);
    return imgs;
  };

  const pickImageDir = async () => {
    const dir = await api.selectFolder?.();
    if (dir && typeof dir === 'string') {
      setImageDir(dir);
      await api.setSetting?.('eyesImageDir', dir).catch(() => {});
      await loadFolder(dir);
      setPicked([]);
    }
  };

  const pickOutputDir = async () => {
    const dir = await api.selectFolder?.();
    if (dir && typeof dir === 'string') {
      setOutputDir(dir);
      await api.setSetting?.('outputDir', dir).catch(() => {});
    }
  };

  // Random N ảnh — mỗi ảnh từ 1 subfolder khác nhau (loài khác nhau)
  const randomPick = (imgs = allImages) => {
    if (imgs.length < 2) return [];

    // Gom theo thư mục cha
    const groups = {};
    for (const fp of imgs) {
      const folder = fp.replace(/[\\/][^\\/]+$/, ''); // parent dir
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(fp);
    }

    const folderKeys = Object.keys(groups);

    if (folderKeys.length >= count) {
      // Đủ subfolder khác nhau → pick 1 ảnh từ mỗi folder được chọn
      const pickedFolders = shuffle(folderKeys).slice(0, count);
      return pickedFolders.map(f => {
        const arr = groups[f];
        return arr[Math.floor(Math.random() * arr.length)];
      });
    }

    // Không đủ subfolder (ảnh để flat hoặc ít loài) → shuffle flat
    return shuffle(imgs).slice(0, Math.min(count, imgs.length));
  };

  const handleRePick = () => {
    const p = randomPick();
    setPicked(p);
  };

  // ── Build TTS script (split: intro question + outro countdown) ───────────

  // Returns { intro, outro, full } — intro plays at start, outro delayed near orbit end
  const buildScript = (subjectNames) => {
    const names = subjectNames;
    const n = names.length;
    if (lang === 'en') {
      const list = n === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      const intro = n <= 2
        ? `Can you match ${list} with their perfect shadows? Pause the video when you think you have it.`
        : `Eyes challenge. Can you match ${list} with their correct shadows? Look carefully and pause the video.`;
      const outro = n <= 2
        ? `Three. Two. One. Here are the correct matches! Like and follow for more.`
        : `Three. Two. One. Here are the answers! Like and follow for more challenges.`;
      return { intro, outro, full: `${intro} ${outro}` };
    }
    const list = n === 2
      ? `${names[0]} và ${names[1]}`
      : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
    const intro = n <= 2
      ? `Bạn có ghép đúng bóng của ${list} không? Bấm dừng khi tìm ra đáp án nhé.`
      : `Thử thách mắt. Bạn có thể ghép đúng ${list} vào bóng của chúng không? Nhìn kỹ và bấm dừng.`;
    const outro = `Ba. Hai. Một. Đây là đáp án chính xác. Like và theo dõi để xem thêm.`;
    return { intro, outro, full: `${intro} ${outro}` };
  };

  // Lấy tên từ 1 file path (ưu tiên: subfolder → filename → Vision)
  const getSubject = useCallback(async (fp) => {
    const norm = fp.replace(/\\/g, '/');
    const parts = norm.split('/');
    const fileName   = parts[parts.length - 1] || '';
    const parentDir  = parts[parts.length - 2] || '';
    const rootDir    = (imageDir || '').replace(/\\/g, '/').split('/').pop();

    // 1. Thư mục cha nếu là subfolder (không phải root imageDir)
    if (parentDir && parentDir !== rootDir && !isHexId(parentDir)) {
      const words = parentDir.split(/[-_\s]+/)
        .map(w => singularize(w.toLowerCase()))
        .filter(w => w.length > 1 && !STRIP_WORDS.has(w));
      if (words.length) return words.slice(0, 2).join(' ');
    }

    // 2. Tên file (nếu không phải hex)
    const fromFile = extractFromFilename(fp);
    if (fromFile) return fromFile;

    // 3. Gemini Vision cho hex filenames
    return identifyImageSubject(fp);
  }, [imageDir]);

  // Wrapper: nhận paths → identify subjects → buildScript
  const buildScriptFromPaths = async (pickedPaths) => {
    const subjects = await Promise.all(pickedPaths.map(fp => getSubject(fp)));
    return { script: buildScript(subjects), subjects }; // script = {intro, outro, full}
  };

  // ── Render 1 video ───────────────────────────────────────────────────────

  const renderOne = async (pickedPaths, dir) => {
    // Nhận diện nội dung ảnh → lấy tên rõ ràng cho TTS
    log(`[AI] Nhận diện ${pickedPaths.length} ảnh...`);
    const { script, subjects } = await buildScriptFromPaths(pickedPaths);
    const { intro: introText, outro: outroText } = script;
    log(`[TTS] ${pickedPaths.length} vật: ${subjects.join(', ')}`);

    const outlineColor = outline === 'auto' ? (Math.random() > 0.5 ? 'red' : 'blue') : outline;
    const syntheticPlan = {
      outlineColor,
      shadowRevealOrder: Array.from({ length: pickedPaths.length }, (_, i) => i),
      objects: pickedPaths.map((fp, i) => ({ name: subjects[i] || stem(fp), englishName: subjects[i] || stem(fp) })),
      lang,
      challengeText: lang === 'en'
        ? 'Match each object with its correct shadow! ✅'
        : 'Ghép mỗi vật với bóng đúng của nó! ✅',
      revealText: lang === 'en' ? 'Here are the answers!' : 'Đây là đáp án!',
      ctaText: lang === 'en' ? 'Like & follow for more!' : 'Like & theo dõi để xem thêm!',
    };

    // Xác định voice engine & giọng Edge fallback
    const defaultEdge = lang === 'vi' ? 'vi-VN-NamMinhNeural' : 'en-US-GuyNeural';
    const isEdgeVoice = !!(VOICES[lang] || VOICES.en).find(v => v.id === voice);
    const useVoice = isEdgeVoice ? voice : defaultEdge;

    // Generate intro TTS (question part — plays at start)
    let introPath = null, outroPath = null;

    const genTTS = async (text, suffix) => {
      if (ttsProvider === 'kokoro' && kokoroOk) {
        const p = `${dir}/eyes_${suffix}_${Date.now()}.wav`;
        const kr = await api.kokoroSynthesize({ text, voice, speed: 1.0, outputPath: p });
        if (kr?.success) return p;
        logErr(`Kokoro thất bại (${suffix}) — fallback Edge`);
      }
      const p = `${dir}/eyes_${suffix}_${Date.now()}.mp3`;
      const tr = await api.ttsGenerate({ text, voice: useVoice, outputPath: p });
      if (!tr?.success) throw new Error(`Edge TTS thất bại (${suffix}): ` + (tr?.error || ''));
      return p;
    };

    introPath = await genTTS(introText, 'intro');
    logOk(`[TTS intro] Xong`);
    outroPath = await genTTS(outroText, 'outro');
    logOk(`[TTS outro] Xong`);

    const bgmPath = await api.findMusic?.('tension mysterious').catch(() => null);
    if (bgmPath) log('[BGM] ' + bgmPath.split(/[\\/]/).pop());

    // Đặt tên file gồm tên các con vật/đồ vật đã nhận diện
    const slugNames = subjects.map(s => s.trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '')).filter(Boolean).join('_');
    const videoOut = `${dir}/EyesChallenge_${slugNames || 'objects'}_${Date.now()}.mp4`;
    log('[Render] FFmpeg bắt đầu...');

    const renderRes = await api.eyesChallengeRender({
      plan: syntheticPlan,
      assetPaths: pickedPaths,
      voiceIntroPath: introPath,
      voiceOutroPath: outroPath,
      bgmPath: bgmPath || null,
      outputPath: videoOut,
    });

    if (!renderRes.success) throw new Error(renderRes.error);
    logOk('✅ Xong → ' + videoOut.split(/[\\/]/).pop());

    // Dọn file tạm voice — chỉ giữ video đầu ra
    api.deleteFile?.(introPath).catch(() => {});
    api.deleteFile?.(outroPath).catch(() => {});

    return videoOut;
  };

  // ── Handler chính ──────────────────────────────────────────────────────────

  const handleRender = async () => {
    if (!imageDir || allImages.length < 2) { logErr('Chọn thư mục ảnh trước (cần ít nhất 2 ảnh)'); return; }
    if (!outputDir) { logErr('Chưa chọn thư mục lưu video'); return; }

    setIsRunning(true);
    setLogs([]);
    setOutputPaths([]);
    const results = [];

    try {
      for (let b = 0; b < batchCount; b++) {
        const thisPick = randomPick();
        if (thisPick.length < 2) throw new Error('Không đủ ảnh');
        setPicked(thisPick);

        log(`━━━ Video ${b + 1}/${batchCount}: ${thisPick.map(p => stem(p)).join(' · ')} ━━━`);
        const out = await renderOne(thisPick, outputDir);
        results.push(out);
        setOutputPaths([...results]);
      }
      logOk(`🎉 Hoàn tất ${batchCount} video!`);
    } catch (e) {
      logErr('❌ ' + e.message);
    } finally {
      setIsRunning(false);
    }
  };

  const hasImages = allImages.length >= 2;
  const hasDir    = !!outputDir;
  const currentVoiceList = ttsProvider === 'kokoro' ? KOKORO_VOICES : (VOICES[lang] || VOICES.en);

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0f0f1a] text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">👁️</span>
          <div>
            <h1 className="text-lg font-bold text-fuchsia-300">Eyes Challenge Video</h1>
            <p className="text-xs text-slate-500">Random ảnh từ thư mục → hiệu ứng xoay bóng tối → TTS → Video</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ── */}
        <div className="w-[300px] flex-shrink-0 border-r border-slate-800 overflow-y-auto p-4 space-y-4">

          {/* Thư mục ảnh nguồn */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">
              Thư mục ảnh nguồn
              {allImages.length > 0 && <span className="text-fuchsia-400 ml-1">({allImages.length} ảnh)</span>}
            </label>
            <div className="flex gap-2 items-center">
              <div className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 truncate">
                {imageDir ? imageDir.split(/[\\/]/).slice(-2).join('/') : <span className="text-slate-600">Chưa chọn</span>}
              </div>
              <button onClick={pickImageDir} disabled={isRunning}
                className="flex-shrink-0 px-2.5 py-1.5 bg-fuchsia-800 hover:bg-fuchsia-700 border border-fuchsia-700 rounded-lg text-[10px] font-semibold text-fuchsia-200 disabled:opacity-40 transition-colors">
                📁 Chọn
              </button>
            </div>
            {!hasImages && imageDir && (
              <p className="text-[10px] text-red-400 mt-1">⚠️ Không tìm thấy ảnh (kể cả subfolder)</p>
            )}
            {!imageDir && (
              <p className="text-[10px] text-amber-400 mt-1">⚠️ Chọn thư mục GỐC chứa các subfolder động vật</p>
            )}
          </div>

          {/* Thư mục output */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">Thư mục lưu video</label>
            <div className="flex gap-2 items-center">
              <div className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 truncate">
                {outputDir ? outputDir.split(/[\\/]/).slice(-2).join('/') : <span className="text-slate-600">Chưa chọn</span>}
              </div>
              <button onClick={pickOutputDir} disabled={isRunning}
                className="flex-shrink-0 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-[10px] font-semibold text-slate-200 disabled:opacity-40 transition-colors">
                📁 Chọn
              </button>
            </div>
            {!hasDir && <p className="text-[10px] text-amber-400 mt-1">⚠️ Chọn thư mục lưu video</p>}
          </div>

          <div className="border-t border-slate-800/60" />

          {/* Số vật mỗi video */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">
              Số vật mỗi video: <span className="text-fuchsia-300 font-bold">{count}</span>
            </label>
            <div className="flex gap-2">
              {[2, 3, 4].map(n => (
                <Pill key={n} active={count === n} onClick={() => setCount(n)} disabled={isRunning}>{n} vật</Pill>
              ))}
            </div>
          </div>

          {/* Số video 1 lần */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">
              Số video tạo: <span className="text-fuchsia-300 font-bold">{batchCount}</span>
            </label>
            <div className="flex gap-2">
              {[1, 3, 5, 10].map(n => (
                <Pill key={n} active={batchCount === n} onClick={() => setBatchCount(n)} disabled={isRunning}>{n}</Pill>
              ))}
            </div>
          </div>

          {/* Màu viền */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">Màu viền</label>
            <div className="flex gap-2">
              {[{ v: 'red', label: '🔴 Đỏ' }, { v: 'blue', label: '🔵 Xanh' }, { v: 'auto', label: '🎲 Random' }].map(opt => (
                <Pill key={opt.v} active={outline === opt.v} onClick={() => setOutline(opt.v)} disabled={isRunning}>
                  {opt.label}
                </Pill>
              ))}
            </div>
          </div>

          {/* Ngôn ngữ TTS */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">Ngôn ngữ TTS</label>
            <div className="flex gap-2">
              <Pill active={lang === 'vi'} onClick={() => setLang('vi')} disabled={isRunning}>🇻🇳 Tiếng Việt</Pill>
              <Pill active={lang === 'en'} onClick={() => setLang('en')} disabled={isRunning}>🇺🇸 English</Pill>
            </div>
          </div>

          {/* TTS Engine */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">TTS Engine</label>
            <div className="flex gap-2">
              <Pill active={ttsProvider === 'edge'}   onClick={() => setTtsProvider('edge')}   disabled={isRunning}>⚡ Edge TTS</Pill>
              <Pill active={ttsProvider === 'kokoro'} onClick={() => setTtsProvider('kokoro')} disabled={isRunning}>
                🎙️ Kokoro {kokoroOk ? <span className="text-green-400"> ●</span> : <span className="text-slate-600"> ●</span>}
              </Pill>
            </div>
          </div>

          {/* Giọng TTS */}
          <div>
            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1.5">Giọng TTS</label>
            <select value={voice} onChange={e => setVoice(e.target.value)} disabled={isRunning}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-fuchsia-500 disabled:opacity-50">
              {currentVoiceList.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>

          {/* Nút Render */}
          <div className="pt-2 space-y-2">
            <button onClick={handleRender} disabled={isRunning || !hasDir || !hasImages}
              className={`w-full py-4 rounded-xl font-bold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg ${
                isRunning
                  ? 'bg-indigo-800 border border-indigo-600 text-indigo-200'
                  : 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white shadow-fuchsia-900/40'
              }`}>
              {isRunning
                ? <><Spin /> Đang render...</>
                : <><span className="text-lg">🎲</span> Random + Render ({batchCount} video)</>
              }
            </button>
            {hasImages && !isRunning && (
              <button onClick={handleRePick}
                className="w-full py-2 rounded-xl text-xs border border-slate-700 text-slate-400 hover:border-fuchsia-600 hover:text-fuchsia-300 transition-colors">
                🔀 Xem trước random (không render)
              </button>
            )}
          </div>

          {/* Output list */}
          {outputPaths.length > 0 && (
            <div className="p-3 bg-emerald-900/30 border border-emerald-700/40 rounded-xl text-xs space-y-1">
              <div className="text-emerald-400 font-bold mb-2">✅ {outputPaths.length} video xong!</div>
              {outputPaths.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-slate-500 text-[10px]">{i + 1}.</span>
                  <span className="text-slate-300 text-[10px] truncate flex-1">{p.split(/[\\/]/).pop()}</span>
                  <button onClick={() => api.showItemInFolder?.(p)} className="text-emerald-400 hover:text-emerald-300 text-[10px] flex-shrink-0">📂</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: preview + logs ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Preview ảnh được chọn */}
          {picked.length > 0 && (
            <div className="flex-shrink-0 border-b border-slate-800 p-4 bg-slate-900/40">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                Ảnh sẽ dùng lần này
              </div>
              <div className="flex flex-wrap gap-2">
                {picked.map((fp, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-orange-900/25 border-orange-700/50 text-xs text-orange-300">
                    <span className="text-slate-500">{i + 1}.</span>
                    <span className="font-semibold">{stem(fp)}</span>
                  </div>
                ))}
              </div>
              {picked.length > 0 && (
                <p className="text-[10px] text-slate-600 mt-2 italic">
                  Script TTS: "{buildScript(picked.map(p => extractFromFilename(p) || stem(p))).full.slice(0, 100)}..."
                </p>
              )}
            </div>
          )}

          {/* Danh sách ảnh trong folder */}
          {allImages.length > 0 && picked.length === 0 && !isRunning && (
            <div className="flex-shrink-0 border-b border-slate-800 p-4 bg-slate-900/20">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                Thư mục ảnh ({allImages.length} file)
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-hidden">
                {allImages.slice(0, 40).map((fp, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400">
                    {stem(fp)}
                  </span>
                ))}
                {allImages.length > 40 && (
                  <span className="text-[10px] text-slate-600 px-1">+{allImages.length - 40} nữa...</span>
                )}
              </div>
            </div>
          )}

          {/* Logs */}
          <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
            {logs.length === 0
              ? (
                <div className="text-slate-600 text-sm text-center mt-12 space-y-2">
                  <div className="text-3xl">🎲</div>
                  <div>Chọn thư mục ảnh → Nhấn <span className="text-fuchsia-400 font-bold">Random + Render</span></div>
                  <div className="text-xs text-slate-700">App tự random {count} ảnh → hiệu ứng xoay → TTS → Video</div>
                </div>
              )
              : logs.map(l => <LogLine key={l.id} text={l.text} type={l.type} />)
            }
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
