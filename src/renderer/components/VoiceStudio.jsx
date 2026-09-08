import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Play, Mic, FolderOpen, Search, Filter, User, CheckCircle2, Volume2,
    RefreshCw, History, Pause, FileAudio, Key, Plus, Trash2, Sliders,
    Zap, ChevronDown, ChevronUp, Settings, Terminal, X, AlertCircle,
    Sparkles, Loader2, Download, Square
} from 'lucide-react';

// ─── Transcribe audio: thử tuần tự các Gemini model, dùng cái nào ra kết quả ──
const TRANSCRIBE_MODELS = [
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
];

async function transcribeAudioWithGemini(filePath) {
    const apiKeys = (() => { try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; } })();
    if (!apiKeys.length) throw new Error('Chưa có Gemini API key');

    const b64 = await window.electronAPI?.readFileBase64?.(filePath);
    if (!b64) throw new Error('Không đọc được file');

    const ext = filePath.split('.').pop().toLowerCase();
    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', webm: 'audio/webm' };
    const mimeType = mimeMap[ext] || 'audio/mpeg';

    const { retryWithKeyRotation } = await import('../services/keyRotation.js');

    const body = (model) => JSON.stringify({
        system_instruction: {
            parts: [{ text: 'Bạn là hệ thống nhận dạng giọng nói tiếng Việt (ASR). Nhiệm vụ: nghe audio và ghi lại CHÍNH XÁC lời nói bằng tiếng Việt có dấu đầy đủ. Chỉ trả về transcript, không thêm bất kỳ gì khác.' }]
        },
        contents: [{
            role: 'user',
            parts: [
                { inline_data: { mime_type: mimeType, data: b64 } },
                { text: 'Chép lại toàn bộ lời nói trong audio này. Chỉ trả về transcript tiếng Việt.' }
            ]
        }],
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 512 } }
    });

    let lastErr;
    for (const model of TRANSCRIBE_MODELS) {
        try {
            const result = await retryWithKeyRotation(async (key) => {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(model) }
                );
                const data = await res.json();
                if (!res.ok) {
                    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
                    err.status = res.status; err.code = data?.error?.status;
                    throw err;
                }
                const parts = data?.candidates?.[0]?.content?.parts || [];
                const textPart = parts.find(p => p.text && !p.thought);
                const text = (textPart?.text || parts[parts.length - 1]?.text || '').trim();
                if (!text) throw new Error('Kết quả rỗng');
                return text.replace(/^["'"']+|["'"']+$/g, '').trim();
            }, apiKeys, { maxCycles: 1 });
            return result; // trả về ngay khi model đầu tiên thành công
        } catch (e) {
            lastErr = e;
            // model này không hỗ trợ audio hoặc lỗi → thử model tiếp theo
        }
    }
    throw lastErr || new Error('Tất cả model đều thất bại');
}

// ─── Safe file URL (handles # and special chars in paths) ────────────────────
function toFileUrl(p) {
    if (!p) return '';
    return 'file:///' + p.replace(/\\/g, '/').split('/').map((seg, i) =>
        (i === 0 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg)
    ).join('/');
}

// ─── EDGE TTS helper ─────────────────────────────────────────────────────────
const getLanguageName = (locale) => {
    try {
        const displayName = new Intl.DisplayNames(['vi'], { type: 'language' });
        const name = displayName.of(locale);
        return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (e) { return locale; }
};

// ─── Split text thành chunks ~1000 ký tự tại ranh giới câu ──────────────────
function splitTextIntoChunks(text, maxChars = 1000) {
  const chunks = [];
  const sentences = text.split(/(?<=[.!?…\n])\s+/);
  let current = '';
  for (const s of sentences) {
    if (!s.trim()) continue;
    if (current.length + s.length + 1 > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? ' ' : '') + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

// ─── ELEVENLABS helpers ───────────────────────────────────────────────────────
const EL_LS_KEYS = 'elevenlabs_api_keys_v3';
const EL_LS_HIST = 'elevenlabs_history';
const EL_SYSTEM_KEYS_COUNT = 231;

// ─── GEMINI TTS ───────────────────────────────────────────────────────────────
const GEMINI_LS_HIST = 'gemini_tts_history';
const GEMINI_VOICES = [
    // Nữ
    { id: 'Aoede',        gender: 'female',  style: 'Ấm áp, truyền cảm'     },
    { id: 'Kore',         gender: 'female',  style: 'Trung tính, rõ ràng'   },
    { id: 'Leda',         gender: 'female',  style: 'Mềm mại, dịu dàng'     },
    { id: 'Callirrhoe',   gender: 'female',  style: 'Tự nhiên, nhẹ nhàng'   },
    { id: 'Autonoe',      gender: 'female',  style: 'Trong sáng'             },
    { id: 'Alsephina',    gender: 'female',  style: 'Năng động'              },
    { id: 'Despina',      gender: 'female',  style: 'Sắc nét'                },
    { id: 'Erinome',      gender: 'female',  style: 'Sâu lắng'               },
    { id: 'Laomedeia',    gender: 'female',  style: 'Thanh thản'             },
    { id: 'Pulcherrima',  gender: 'female',  style: 'Cuốn hút'               },
    { id: 'Vindemiatrix', gender: 'female',  style: 'Chuyên nghiệp'         },
    { id: 'Sulafat',      gender: 'female',  style: 'Thân thiện, dễ nghe'   },
    // Nam
    { id: 'Charon',       gender: 'male',    style: 'Trung tính, chuẩn'     },
    { id: 'Fenrir',       gender: 'male',    style: 'Biểu cảm, mạnh mẽ'    },
    { id: 'Puck',         gender: 'male',    style: 'Vui tươi, linh hoạt'   },
    { id: 'Orus',         gender: 'male',    style: 'Uy quyền, điềm tĩnh'   },
    { id: 'Algenib',      gender: 'male',    style: 'Rõ ràng, chắc chắn'    },
    { id: 'Algieba',      gender: 'male',    style: 'Sang trọng'             },
    { id: 'Iapetus',      gender: 'male',    style: 'Trầm ổn'                },
    { id: 'Enceladus',    gender: 'male',    style: 'Năng lượng'             },
    { id: 'Umbriel',      gender: 'male',    style: 'Huyền bí'               },
    { id: 'Rasalgethi',   gender: 'male',    style: 'Cổ điển, uy nghiêm'    },
    { id: 'Sadachbia',    gender: 'male',    style: 'Khỏe khoắn'             },
    { id: 'Schedar',      gender: 'male',    style: 'Mạnh mẽ, dứt khoát'    },
    // Trung tính
    { id: 'Zephyr',       gender: 'neutral', style: 'Thoáng, tự nhiên'      },
    { id: 'Achird',       gender: 'neutral', style: 'Dễ nghe, cân bằng'     },
    { id: 'Gacrux',       gender: 'neutral', style: 'Sáng tạo'               },
    { id: 'Mimosa',       gender: 'neutral', style: 'Tươi sáng'              },
];

// ArrayBuffer → base64 (browser-safe)
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
}

// ─── SRT UTILITIES ───────────────────────────────────────────────────────────
function parseSRTTime(str) {
    // "HH:MM:SS,mmm" or "HH:MM:SS.mmm" → milliseconds
    const norm = str.replace('.', ',');
    const [time, ms] = norm.split(',');
    const parts = time.split(':').map(Number);
    const h = parts[0] || 0, m = parts[1] || 0, s = parts[2] || 0;
    return (h * 3600 + m * 60 + s) * 1000 + Number(ms || 0);
}

function parseSRT(content) {
    const blocks = content.trim().split(/\n\s*\n/);
    const segments = [];
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;
        let timeLineIdx = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
        if (timeLineIdx >= lines.length) continue;
        const timeLine = lines[timeLineIdx];
        const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/);
        if (!match) continue;
        const startMs = parseSRTTime(match[1]);
        const endMs = parseSRTTime(match[2]);
        const text = lines.slice(timeLineIdx + 1).join(' ').replace(/<[^>]*>/g, '').trim();
        if (text && endMs > startMs) segments.push({ text, startMs, endMs });
    }
    return segments;
}

function isSRTContent(content) {
    return /^\d+\s*[\r\n]+\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}\s*-->/m.test(content.trim());
}

const CHARS_PER_SEC = 13; // Vietnamese TTS approximate rate

function calcSpeedRatio(text, durationSec) {
    const chars = text.replace(/\s+/g, ' ').trim().length;
    const needed = chars / CHARS_PER_SEC;
    if (needed <= durationSec) return 1.0;
    return Math.min(parseFloat((needed / durationSec).toFixed(2)), 3.0);
}

function formatSRTInfo(segments) {
    if (!segments || segments.length === 0) return null;
    const totalMs = segments[segments.length - 1].endMs;
    const totalSec = Math.round(totalMs / 1000);
    const min = Math.floor(totalSec / 60), sec = totalSec % 60;
    const needsSpeed = segments.some(s => calcSpeedRatio(s.text, (s.endMs - s.startMs) / 1000) > 1.05);
    return { count: segments.length, duration: `${min}:${sec.toString().padStart(2, '0')}`, needsSpeed };
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VoiceStudio({ dark = true }) {
    const [subTab, setSubTab] = useState('edge'); // 'edge'|'elevenlabs'|'gemini'|'vieneu'


    // =========================================================================
    // ===  VIENEU TTS STATE  ==================================================
    // =========================================================================
    const [vnReady,        setVnReady]        = useState(false);
    const [vnSetupStep,    setVnSetupStep]    = useState('');   // bước đang cài
    const [vnSetupPct,     setVnSetupPct]     = useState(0);
    const [vnSetupMsg,     setVnSetupMsg]     = useState('');
    const [vnInstalling,   setVnInstalling]   = useState(false);
    const [vnError,        setVnError]        = useState('');
    const [vnVoices,       setVnVoices]       = useState([]);   // [{id, name, gender}]
    const [vnSelectedVoice,setVnSelectedVoice]= useState('');   // voice id
    const [vnText,         setVnText]         = useState('');
    const [vnOutputPath,   setVnOutputPath]   = useState('');
    const [vnOutputFolder, setVnOutputFolder] = useState('');
    const [vnGenerating,   setVnGenerating]   = useState(false);
    const [vnAudioUrl,     setVnAudioUrl]     = useState('');
    const [vnLog,          setVnLog]          = useState('');
    const [vnLogs,         setVnLogs]         = useState([]);
    const [vnPreviewingVoice, setVnPreviewingVoice] = useState('');
    const [vnPreviewAudioUrl, setVnPreviewAudioUrl] = useState('');
    const vnLogRef = useRef(null);
    const [vnMode,         setVnMode]         = useState('text'); // 'text' | 'srt'
    const [vnSrtFile,      setVnSrtFile]      = useState('');
    const [vnSrtSegments,  setVnSrtSegments]  = useState([]);
    const [vnSrtProgress,  setVnSrtProgress]  = useState({ done: 0, total: 0, text: '' });
    const [vnCloneMode,    setVnCloneMode]    = useState(false);
    const [vnCloneName,    setVnCloneName]    = useState('');   // tên profile khi lưu
    const [vnSavedVoices,  setVnSavedVoices]  = useState(() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]'); } catch { return []; } });
    const [vnRefAudio,          setVnRefAudio]          = useState('');
    const [vnRefText,           setVnRefText]           = useState('');
    const [vnRefTranscribing,   setVnRefTranscribing]   = useState(false);
    const [vnProjectName,  setVnProjectName]  = useState('vieneu_output');
    const [vnModel,        setVnModel]        = useState('q4'); // 'q4' | 'q8' | 'pytorch'
    const [vnGpuType,      setVnGpuType]      = useState(''); // '' | 'nvidia' | 'amd' | 'intel_arc' | 'cpu'
    const [vnGpuUpgrading, setVnGpuUpgrading] = useState(false);

    // =========================================================================
    // ===  GPT-SoVITS STATE  ==================================================
    // =========================================================================
    const [gsvInstalled,   setGsvInstalled]   = useState(false);
    const [gsvInstalling,  setGsvInstalling]  = useState(false);
    const [gsvSetupStep,   setGsvSetupStep]   = useState('');
    const [gsvSetupPct,    setGsvSetupPct]    = useState(0);
    const [gsvSetupMsg,    setGsvSetupMsg]    = useState('');
    const [gsvInstallDir,  setGsvInstallDir]  = useState('');
    const [gsvServerRunning,setGsvServerRunning]=useState(false);
    const [gsvStarting,    setGsvStarting]    = useState(false);
    const [gsvServerUrl,   setGsvServerUrl]   = useState('http://127.0.0.1:9880');
    const [gsvConnected,   setGsvConnected]   = useState(false);
    const [gsvTesting,     setGsvTesting]     = useState(false);
    const [gsvRefs,        setGsvRefs]        = useState([]);       // [{id,name,refAudioPath,refText,lang}]
    const [gsvSelectedRef, setGsvSelectedRef] = useState('');       // id
    const [gsvRefAudio,    setGsvRefAudio]    = useState('');       // path
    const [gsvRefText,     setGsvRefText]     = useState('');
    const [gsvRefName,     setGsvRefName]     = useState('');
    const [gsvRefChunks,   setGsvRefChunks]   = useState([]); // [{path,text,duration,name}]
    const [gsvProcessing,  setGsvProcessing]  = useState(false);
    const [gsvRefLang,     setGsvRefLang]     = useState(''); // ngôn ngữ ref audio (blank = same as gsvLang)
    const [gsvFileName,       setGsvFileName]       = useState('');
    const [gsvTranscribeMode, setGsvTranscribeMode] = useState('whisper'); // 'whisper' | 'gemini'
    const [gsvLang,        setGsvLang]        = useState('vi');
    const [gsvSpeed,       setGsvSpeed]       = useState(1.0);
    const [gsvText,        setGsvText]        = useState('');
    const [gsvOutputFolder,setGsvOutputFolder]= useState('');
    const [gsvOutputPath,  setGsvOutputPath]  = useState('');
    const [gsvAudioUrl,    setGsvAudioUrl]    = useState('');
    const [gsvGenerating,  setGsvGenerating]  = useState(false);
    const [gsvLogs,        setGsvLogs]        = useState([]);
    const [gsvMode,        setGsvMode]        = useState('text'); // 'text' | 'srt'
    const [gsvSrtFile,     setGsvSrtFile]     = useState('');
    const [gsvSrtSegs,     setGsvSrtSegs]     = useState([]);
    const [gsvSrtProgress, setGsvSrtProgress] = useState({ done:0, total:0, text:'' });
    const gsvLogRef = useRef(null);

    const addGsvLog = (msg) => setGsvLogs(prev => [...prev.slice(-299), `[${new Date().toLocaleTimeString()}] ${msg}`]);

    useEffect(() => { if (gsvLogRef.current) gsvLogRef.current.scrollTop = gsvLogRef.current.scrollHeight; }, [gsvLogs]);

    // =========================================================================
    // ===  KOKORO TTS STATE  ==================================================
    // =========================================================================
    const [kkReady,         setKkReady]         = useState(false);   // server running
    const [kkModelsReady,   setKkModelsReady]   = useState(false);   // model files exist
    const [kkStarting,      setKkStarting]      = useState(false);
    const [kkVoices,        setKkVoices]        = useState([]);
    const [kkSelectedVoice, setKkSelectedVoice] = useState('af_heart');
    const [kkLangFilter,    setKkLangFilter]    = useState('all');
    const [kkText,          setKkText]          = useState('');
    const [kkSpeed,         setKkSpeed]         = useState(1.0);
    const [kkProjectName,   setKkProjectName]   = useState('kokoro_output');
    const [kkOutputFolder,  setKkOutputFolder]  = useState('');
    const [kkGenerating,    setKkGenerating]    = useState(false);
    const [kkAudioUrl,      setKkAudioUrl]      = useState('');
    const [kkLogs,          setKkLogs]          = useState([]);
    const kkLogRef = useRef(null);
    const addKkLog = (msg) => setKkLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    useEffect(() => { if (kkLogRef.current) kkLogRef.current.scrollTop = kkLogRef.current.scrollHeight; }, [kkLogs]);

    const KK_STATIC_VOICES = [
      { id: 'vi_co_gai_hoat_ngon', name: 'Cô Gái Hoạt Ngôn', lang: 'vi' },
      { id: 'vi_gai_nho_ngot',     name: 'Nhỏ Ngọt Ngào',    lang: 'vi' },
      { id: 'vi_nu_pho_thong',     name: 'Giọng Nữ Phổ Thông', lang: 'vi' },
      { id: 'vi_thanh_nien_tu_tin', name: 'Thanh Niên Tự Tin', lang: 'vi' },
      { id: 'vi_mai',              name: 'Mai',                lang: 'vi' },
      { id: 'vi_minh',             name: 'Minh',               lang: 'vi' },
      { id: 'af_heart',    name: 'Heart ♀',   lang: 'en' }, { id: 'af_bella',   name: 'Bella ♀',   lang: 'en' },
      { id: 'af_nicole',   name: 'Nicole ♀',  lang: 'en' }, { id: 'af_sarah',   name: 'Sarah ♀',   lang: 'en' },
      { id: 'af_sky',      name: 'Sky ♀',     lang: 'en' }, { id: 'am_adam',    name: 'Adam ♂',    lang: 'en' },
      { id: 'am_michael',  name: 'Michael ♂', lang: 'en' }, { id: 'bf_emma',    name: 'Emma ♀',    lang: 'en' },
      { id: 'bf_isabella', name: 'Isabella ♀', lang: 'en' }, { id: 'bm_george', name: 'George ♂',  lang: 'en' },
      { id: 'bm_lewis',    name: 'Lewis ♂',   lang: 'en' },
      { id: 'jf_alpha',     name: 'Alpha ♀',    lang: 'ja' }, { id: 'jf_gongitsune', name: 'Gongitsune ♀', lang: 'ja' },
      { id: 'jm_kurosawa',  name: 'Kurosawa ♂', lang: 'ja' }, { id: 'jm_nezha',      name: 'Nezha ♂',      lang: 'ja' },
      { id: 'zf_xiaobei',  name: 'Xiaobei ♀',  lang: 'zh' }, { id: 'zf_xiaoni',  name: 'Xiaoni ♀',  lang: 'zh' },
      { id: 'zf_xiaoxiao', name: 'Xiaoxiao ♀', lang: 'zh' }, { id: 'zm_yunxi',   name: 'Yunxi ♂',   lang: 'zh' },
      { id: 'kf_dawon',   name: 'Dawon ♀',   lang: 'ko' }, { id: 'km_hyunwoo', name: 'Hyunwoo ♂', lang: 'ko' },
      { id: 'ff_siwis',   name: 'Siwis ♀',   lang: 'fr' },
      { id: 'ef_dora',    name: 'Dora ♀',    lang: 'es' },
      { id: 'hf_alpha',   name: 'Alpha ♀',   lang: 'hi' },
    ];

    useEffect(() => {
      if (subTab !== 'kokoro') return;
      setKkVoices(KK_STATIC_VOICES);
      window.electronAPI?.kokoroCheckStatus?.().then(r => {
        setKkModelsReady(r?.modelsReady ?? false);
        setKkReady(r?.serverRunning ?? false);
      });
      const unsub = window.electronAPI?.onKokoroLog?.((msg) => addKkLog(msg));
      return () => { try { unsub?.(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subTab]);

    const handleKkStartServer = async () => {
      setKkStarting(true);
      addKkLog('🔄 Đang khởi động Kokoro server...');
      const r = await window.electronAPI?.kokoroStartServer?.();
      setKkStarting(false);
      if (r?.success) { setKkReady(true); addKkLog('✅ Server sẵn sàng!'); }
      else addKkLog(`❌ ${r?.error || 'Lỗi không xác định'}`);
    };

    const handleKkStopServer = async () => {
      await window.electronAPI?.kokoroStopServer?.();
      setKkReady(false);
      addKkLog('⏹ Server đã dừng');
    };

    const handleKkSynthesize = async () => {
      if (!kkText.trim()) return;
      const folder = kkOutputFolder || 'C:\\Users\\Public\\Videos';
      const outPath = `${folder}\\${kkProjectName || 'kokoro_output'}_${Date.now()}.wav`;
      setKkGenerating(true);
      setKkAudioUrl('');
      const r = await window.electronAPI?.kokoroSynthesize?.({
        text: kkText, voice: kkSelectedVoice, speed: kkSpeed, outputPath: outPath,
      });
      setKkGenerating(false);
      if (r?.success) {
        const url = `file:///${r.path.replace(/\\/g, '/')}?t=${Date.now()}`;
        setKkAudioUrl(url);
        addKkLog(`✅ Hoàn tất: ${r.path}`);
      } else {
        addKkLog(`❌ ${r?.error}`);
      }
    };

    useEffect(() => {
        if (subTab !== 'gptsovits') return;
        window.electronAPI?.gptSoVITSGetConfig?.().then(r => {
            if (r?.url) setGsvServerUrl(r.url);
            if (r?.refs) setGsvRefs(r.refs);
            if (r?.outputFolder) setGsvOutputFolder(r.outputFolder);
        });
        window.electronAPI?.gptSoVITSCheckInstall?.().then(r => {
            const installed = !!r?.installed;
            setGsvInstalled(installed);
            setGsvServerRunning(!!r?.serverRunning);
            // Auto-start server nếu đã cài mà server chưa chạy
            if (installed && !r?.serverRunning) {
                setGsvStarting(true);
                addGsvLog('🚀 Tự động khởi động server...');
                window.electronAPI?.gptSoVITSStartServer?.().then(res => {
                    setGsvStarting(false);
                    if (res?.ok) { setGsvServerRunning(true); setGsvConnected(true); addGsvLog('✅ Server sẵn sàng'); }
                    else addGsvLog('✗ ' + (res?.error || 'Không khởi động được server'));
                }).catch(() => setGsvStarting(false));
            }
        });
        const unsub1 = window.electronAPI?.onGptSoVITSLog?.((msg) => addGsvLog(msg));
        const unsub2 = window.electronAPI?.onGptSoVITSSRTProgress?.((d) => setGsvSrtProgress({ done: d.done, total: d.total, text: d.text || '' }));
        const unsub3 = window.electronAPI?.onGptSoVITSSetupProgress?.((d) => {
            setGsvSetupStep(d.type); setGsvSetupPct(d.pct); setGsvSetupMsg(d.msg);
            if (d.type === 'done' && d.pct === 100) { setGsvInstalling(false); setGsvInstalled(true); addGsvLog(d.msg); }
            else if (d.type === 'error') { setGsvInstalling(false); addGsvLog(d.msg); }
            else addGsvLog(d.msg);
        });
        const unsub4 = window.electronAPI?.onGptSoVITSServerStopped?.(() => { setGsvServerRunning(false); setGsvStarting(false); addGsvLog('⚠️ Server đã dừng'); });
        return () => { try { unsub1?.(); unsub2?.(); unsub3?.(); unsub4?.(); } catch(_) {} };
    }, [subTab]);

    // ── VieNeu: auto-scroll log ────────────────────────────────────────────────
    useEffect(() => {
        if (vnLogRef.current) vnLogRef.current.scrollTop = vnLogRef.current.scrollHeight;
    }, [vnLogs]);

    // ── VieNeu: check status khi mở tab + lắng nghe progress ─────────────────
    useEffect(() => {
        if (subTab !== 'vieneu') return;
        window.electronAPI?.vieNeuCheckStatus?.().then(async r => {
            if (r?.installed) {
                setVnReady(true);
                setVnGpuType(r.gpuType || 'cpu');
                // Load voices
                window.electronAPI?.vieNeuGetVoices?.().then(res => {
                    if (res?.voices?.length) setVnVoices(res.voices);
                });
                // Preload Whisper model ngầm để sẵn sàng transcribe ref audio
                window.electronAPI?.whisperPreloadModel?.();
                // Tự động nâng cấp GPU nếu status file chưa có gpuType (cài từ bản cũ)
                if (!r.gpuType || r.gpuType === 'unknown') {
                    setVnGpuUpgrading(true);
                    const res = await window.electronAPI?.vieNeuUpgradeGpu?.();
                    setVnGpuUpgrading(false);
                    if (res?.ok) setVnGpuType(res.gpuType || 'cpu');
                }
            }
        });
        const unsub = window.electronAPI?.onVieNeuProgress?.((d) => {
            setVnSetupStep(d.step);
            setVnSetupPct(d.percent);
            setVnSetupMsg(d.message);
            if (d.message) setVnLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${d.message}`]);
        });
        const unsubSRT = window.electronAPI?.onVieNeuSRTProgress?.((d) => {
            setVnSrtProgress({ done: d.done, total: d.total, text: d.text || '' });
            setVnLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] 🎙️ [${d.done}/${d.total}] ${d.text || ''}`]);
        });
        const unsubLog = window.electronAPI?.onVieNeuLog?.((line) => {
            setVnLogs(prev => [...prev.slice(-299), `[${new Date().toLocaleTimeString()}] ${line}`]);
        });
        return () => {
            try { unsub?.(); } catch (_) {}
            try { unsubSRT?.(); } catch(_) {}
            try { unsubLog?.(); } catch(_) {}
        };
    }, [subTab]);

    // =========================================================================
    // ===  EDGE TTS STATE  ====================================================
    // =========================================================================
    const [text, setText] = useState('');
    const [projectName, setProjectName] = useState('');
    const [outputFolder, setOutputFolder] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [history, setHistory] = useState([]);
    const [voices, setVoices] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [selectedVoice, setSelectedVoice] = useState('vi-VN-HoaiMyNeural');
    const [edgePitch,     setEdgePitch]     = useState(0);   // semitones -12..+12
    const [edgeRate,      setEdgeRate]      = useState(0);   // % offset -50..+50
    const [isLoadingVoices, setIsLoadingVoices] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLang, setSelectedLang] = useState('vi-VN');
    const [genderFilter, setGenderFilter] = useState('All');
    const [previewingVoice, setPreviewingVoice] = useState(null);
    const [playingHistoryId, setPlayingHistoryId] = useState(null);
    const [srtSegments, setSrtSegments] = useState(null); // null = plain text, array = SRT mode
    const [srtProgress, setSrtProgress] = useState({ done: 0, total: 0, text: '' });
    const audioRef = useRef(new Audio());

    useEffect(() => {
        const savedHistory = localStorage.getItem('voice_history');
        if (savedHistory) setHistory(JSON.parse(savedHistory));
        window.electronAPI.getDownloadsDir().then(dir => setOutputFolder(dir || 'D:\\Audio'));
        fetchVoices();
        // SRT progress listener (shared for both Edge TTS and ElevenLabs)
        window.electronAPI.onTTSSRTProgress(data => {
            setSrtProgress(data);
            setElSrtProgress(data);
        });
        // Gemini TTS SRT progress
        window.electronAPI.onGeminiSRTProgress(data => {
            setGmSrtProgress(data);
        });
        // Voice log listener (main process → UI)
        window.electronAPI.onVoiceLog(data => {
            setVoiceLogs(prev => [...prev.slice(-199), { id: Date.now() + Math.random(), ...data }]);
        });
        return () => {
            audioRef.current.pause(); audioRef.current.src = '';
            window.electronAPI.removeAllListeners('tts-srt-progress');
            window.electronAPI.removeAllListeners('voice-log');
            window.electronAPI.removeAllListeners('gemini-srt-progress');
        };
    }, []);

    const fetchVoices = async () => {
        setIsLoadingVoices(true);
        try {
            const data = await window.electronAPI.getVoices();
            if (data && data.length > 0) {
                setVoices(data);
                setLanguages(Array.from(new Set(data.map(v => v.Locale))).sort());
            }
        } catch (_) {}
        setIsLoadingVoices(false);
    };

    const handlePreview = async (e, voiceName) => {
        e.stopPropagation();
        if (previewingVoice === voiceName) { audioRef.current.pause(); setPreviewingVoice(null); return; }
        setPreviewingVoice(voiceName);
        const res = await window.electronAPI.previewVoice(voiceName);
        if (res.success) {
            audioRef.current.src = toFileUrl(res.path);
            audioRef.current.play();
            audioRef.current.onended = () => setPreviewingVoice(null);
        } else setPreviewingVoice(null);
    };

    const handlePlayHistory = (item) => {
        if (playingHistoryId === item.id) { audioRef.current.pause(); setPlayingHistoryId(null); return; }
        setPlayingHistoryId(item.id);
        audioRef.current.src = toFileUrl(item.path);
        audioRef.current.play();
        audioRef.current.onended = () => setPlayingHistoryId(null);
    };

    const handleGenerate = async () => {
        if (!text.trim()) return alert('Vui lòng nhập văn bản!');
        if (!outputFolder) return alert('Vui lòng chọn thư mục lưu!');
        setIsGenerating(true); setProgress(10);
        const safeName = projectName.trim() ? projectName.replace(/[^a-z0-9_-]/gi, '_') : `audio_${Date.now()}`;
        const cleanFolder = outputFolder.endsWith('\\') || outputFolder.endsWith('/') ? outputFolder.slice(0,-1) : outputFolder;
        const outputPath = `${cleanFolder}\\${safeName}.mp3`;
        let result;
        if (srtSegments && srtSegments.length > 0) {
            addVoiceLog(`🎙️ [Edge TTS] Bắt đầu SRT mode — ${srtSegments.length} đoạn · giọng: ${selectedVoice.split('-').pop()}`, 'info');
            setSrtProgress({ done: 0, total: srtSegments.length, text: 'Khởi động...' });
            result = await window.electronAPI.generateSRTVoice({ segments: srtSegments, voice: selectedVoice, outputPath, pitch: edgePitch, rate: edgeRate });
        } else {
            addVoiceLog(`🎙️ [Edge TTS] Bắt đầu tạo giọng · ${text.length} ký tự · giọng: ${selectedVoice.split('-').pop()}`, 'info');
            const interval = setInterval(() => setProgress(p => p < 90 ? p + Math.floor(Math.random() * 10) + 5 : p), 400);
            result = await window.electronAPI.generateVoice({ text, voice: selectedVoice, outputPath, pitch: edgePitch, rate: edgeRate });
            clearInterval(interval);
        }
        setProgress(100);
        setTimeout(() => {
            setIsGenerating(false); setProgress(0);
            setSrtProgress({ done: 0, total: 0, text: '' });
            if (result.success) {
                addVoiceLog(`✅ [Edge TTS] Đã lưu: ${result.path}`, 'success');
                const item = { id: Date.now(), name: safeName, path: outputPath, time: new Date().toLocaleTimeString() };
                const newHist = [item, ...history].slice(0, 30);
                setHistory(newHist); localStorage.setItem('voice_history', JSON.stringify(newHist));
                alert(`✅ Đã lưu: ${result.path}`);
            } else {
                addVoiceLog(`❌ [Edge TTS] Lỗi: ${result.error}`, 'error');
                alert('Lỗi: ' + result.error);
            }
        }, 500);
    };

    const filteredVoices = useMemo(() => voices.filter(v => {
        const matchLang = selectedLang === 'All' || v.Locale === selectedLang;
        const matchGender = genderFilter === 'All' || v.Gender === genderFilter;
        const matchSearch = v.ShortName?.toLowerCase().includes(searchQuery.toLowerCase()) || v.Locale?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchLang && matchGender && matchSearch;
    }), [voices, selectedLang, genderFilter, searchQuery]);

    const currentVoiceData = voices.find(v => v.ShortName === selectedVoice) || {};

    // =========================================================================
    // ===  ELEVENLABS TTS STATE  ==============================================
    // =========================================================================
    const [elApiKeys, setElApiKeys] = useState([]);
    const [elNewKey, setElNewKey] = useState('');
    const [elCheckingKey, setElCheckingKey] = useState(false);
    const [elVoices, setElVoices] = useState([]);
    const [elIsLoadingVoices, setElIsLoadingVoices] = useState(false);
    const [elSelectedVoice, setElSelectedVoice] = useState(null);
    const [elPreviewingVoice, setElPreviewingVoice] = useState(null);
    const [elSearchQuery, setElSearchQuery] = useState('');
    const [elAccentFilter, setElAccentFilter] = useState('All');
    const [elLangFilter, setElLangFilter] = useState('All');
    const [elCloneName, setElCloneName] = useState('');
    const [elCloneFiles, setElCloneFiles] = useState([]);
    const [elCloning, setElCloning] = useState(false);
    const [elCloneLog, setElCloneLog] = useState('');
    const elCloneInputRef = useRef(null);
    const [elText, setElText] = useState('');
    const [elProjectName, setElProjectName] = useState('');
    const [elOutputFolder, setElOutputFolder] = useState('');
    const [elStability, setElStability] = useState(50);
    const [elSimilarity, setElSimilarity] = useState(75);
    const [elStyle, setElStyle] = useState(0);
    const [elIsGenerating, setElIsGenerating] = useState(false);
    const [elProgress, setElProgress] = useState(0);
    const [elHistory, setElHistory] = useState([]);
    const [elPlayingId, setElPlayingId] = useState(null);
    const [elSysStatus, setElSysStatus] = useState({ total: 0, scanned: 0, valid: 0, totalRemaining: 0 });
    const [elIsScanning, setElIsScanning] = useState(false);
    const [elScanProgress, setElScanProgress] = useState({ done: 0, total: 0 });
    const [elLastKeyInfo, setElLastKeyInfo] = useState('');
    const [elSrtSegments, setElSrtSegments] = useState(null);
    const [elSrtProgress, setElSrtProgress] = useState({ done: 0, total: 0, text: '' });
    const elAudioRef = useRef(new Audio());

    // ── Phân đoạn tự động (<1000 ký tự) ────────────────────────────────────────
    const [elSegView,       setElSegView]       = useState(false);  // hiện panel phân đoạn
    const [elSegments,      setElSegments]       = useState([]);     // [{id,text,charCount,checked,status,audioPath,error}]
    const [elSegProcessing, setElSegProcessing]  = useState(false);
    const [elSegGap,        setElSegGap]         = useState(500);    // ms gap khi nối file
    const [elSegMerging,    setElSegMerging]     = useState(false);
    const [elSegMergedPath, setElSegMergedPath]  = useState('');
    const elSegStopRef = useRef(false);

    // Tách text thành đoạn ≤ maxChars theo câu
    const elSplitText = (text, maxChars = 950) => {
        if (!text.trim()) return [];
        // Tách theo câu (. ! ? \n\n)
        const parts = text.split(/(?<=[.!?])\s+|(?<=\n)\n+/).filter(p => p.trim());
        const chunks = [];
        let cur = '';
        for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            // Nếu 1 câu đã > maxChars → cắt theo từ
            if (trimmed.length > maxChars) {
                if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
                const words = trimmed.split(' ');
                let wChunk = '';
                for (const w of words) {
                    if ((wChunk + ' ' + w).trim().length > maxChars && wChunk) {
                        chunks.push(wChunk.trim());
                        wChunk = w;
                    } else { wChunk = (wChunk + ' ' + w).trim(); }
                }
                if (wChunk.trim()) chunks.push(wChunk.trim());
            } else if ((cur + ' ' + trimmed).trim().length > maxChars && cur.trim()) {
                chunks.push(cur.trim());
                cur = trimmed;
            } else {
                cur = (cur + ' ' + trimmed).trim();
            }
        }
        if (cur.trim()) chunks.push(cur.trim());
        return chunks.filter(c => c.length > 0).map((text, i) => ({
            id: i + 1, text, charCount: text.length,
            checked: true, status: 'waiting', audioPath: null, error: ''
        }));
    };

    // Bắt đầu phân đoạn
    const elDoSplit = () => {
        if (!elText.trim()) return alert('Vui lòng nhập văn bản trước!');
        const segs = elSplitText(elText, 950);
        if (segs.length === 0) return alert('Không tách được đoạn nào!');
        setElSegments(segs);
        setElSegView(true);
        setElSegMergedPath('');
    };

    // Xử lý hàng đợi
    const elProcessQueue = async () => {
        if (!elSelectedVoice) return alert('Vui lòng chọn giọng!');
        if (!elOutputFolder) return alert('Vui lòng chọn thư mục lưu!');
        elSegStopRef.current = false;
        setElSegProcessing(true);
        const toProcess = elSegments.filter(s => s.checked && s.status !== 'done');
        for (let i = 0; i < toProcess.length; i++) {
            if (elSegStopRef.current) break;
            const seg = toProcess[i];
            setElSegments(prev => prev.map(s => s.id === seg.id ? { ...s, status: 'processing' } : s));
            try {
                const ttsRes = await window.electronAPI.elTTS({
                    text: seg.text, voiceId: elSelectedVoice.voice_id,
                    stability: elStability, similarity: elSimilarity, style: elStyle, userKeys: elApiKeys
                });
                if (!ttsRes.success) throw new Error(ttsRes.error);
                const segName = `${elProjectName.trim() ? elProjectName.replace(/[^a-z0-9_-]/gi, '_') : 'el'}_seg${String(seg.id).padStart(3, '0')}`;
                const cleanFolder = elOutputFolder.replace(/[\\/]+$/, '');
                const audioPath = `${cleanFolder}\\${segName}.mp3`;
                const saveRes = await window.electronAPI.saveElevenLabsAudio({ base64: ttsRes.base64, outputPath: audioPath });
                if (!saveRes.success) throw new Error(saveRes.error);
                setElSegments(prev => prev.map(s => s.id === seg.id ? { ...s, status: 'done', audioPath } : s));
                addVoiceLog(`✅ Đoạn ${seg.id}/${elSegments.length}: ${audioPath.split('\\').pop()}`, 'success');
            } catch (e) {
                setElSegments(prev => prev.map(s => s.id === seg.id ? { ...s, status: 'error', error: e.message } : s));
                addVoiceLog(`❌ Đoạn ${seg.id} lỗi: ${e.message}`, 'error');
            }
        }
        setElSegProcessing(false);
    };

    // Nối tất cả file đã xong
    const elMergeSegments = async () => {
        const done = elSegments.filter(s => s.status === 'done' && s.audioPath).sort((a, b) => a.id - b.id);
        if (done.length < 2) return alert('Cần ít nhất 2 đoạn đã tạo xong!');
        if (!elOutputFolder) return alert('Cần chọn thư mục lưu!');
        setElSegMerging(true);
        const baseName = (elProjectName.trim() ? elProjectName.replace(/[^a-z0-9_-]/gi, '_') : 'el_merged') + `_${Date.now()}`;
        const outPath = `${elOutputFolder.replace(/[\\/]+$/, '')}\\${baseName}.mp3`;
        try {
            const res = await window.electronAPI.elMergeAudio({ files: done.map(s => s.audioPath), gapMs: elSegGap, outputPath: outPath });
            if (res.success) {
                setElSegMergedPath(res.path);
                addVoiceLog(`✅ Nối xong: ${res.path.split('\\').pop()} (${done.length} đoạn · ${elSegGap}ms gap)`, 'success');
            } else { throw new Error(res.error); }
        } catch (e) { alert('Lỗi nối file: ' + e.message); addVoiceLog('❌ Lỗi nối: ' + e.message, 'error'); }
        setElSegMerging(false);
    };

    useEffect(() => {
        const keys = localStorage.getItem(EL_LS_KEYS);
        if (keys) { const parsed = JSON.parse(keys); setElApiKeys(parsed); }
        const hist = localStorage.getItem(EL_LS_HIST);
        if (hist) setElHistory(JSON.parse(hist));
        window.electronAPI.getDownloadsDir().then(dir => setElOutputFolder(dir || 'D:\\Audio'));
        // Load system status
        window.electronAPI.elSystemStatus().then(s => setElSysStatus(s)).catch(() => {});
        // Listen scan progress
        window.electronAPI.onElScanProgress((done, total) => setElScanProgress({ done, total }));
        return () => {
            elAudioRef.current.pause();
        };
    }, []);

    // Auto-load voices + auto-scan khi mở tab ElevenLabs
    useEffect(() => {
        if (subTab !== 'elevenlabs') return;
        if (elVoices.length === 0) handleElLoadVoices();
        // Tự động quét credit 1 lần mỗi ngày khi mở tab ElevenLabs
        window.electronAPI.elShouldAutoScan().then(should => {
            if (should) {
                setElIsScanning(true);
                setElScanProgress({ done: 0, total: EL_SYSTEM_KEYS_COUNT });
                window.electronAPI.elScanCredits().then(result => {
                    setElSysStatus(result);
                    setElScanProgress({ done: result.total, total: result.total });
                    setElIsScanning(false);
                }).catch(() => setElIsScanning(false));
            }
        }).catch(() => {});
    }, [subTab]);

    const saveElKeys = (keys) => {
        setElApiKeys(keys);
        localStorage.setItem(EL_LS_KEYS, JSON.stringify(keys));
    };

    const handleAddElKey = async () => {
        const key = elNewKey.trim();
        if (!key || elApiKeys.find(k => k.key === key)) return;
        setElCheckingKey(true);
        try {
            const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
                headers: { 'xi-api-key': key }
            });
            if (!res.ok) { alert('API key không hợp lệ!'); setElCheckingKey(false); return; }
            const data = await res.json();
            const remaining = (data.character_limit || 0) - (data.character_count || 0);
            const newKey = { key, status: remaining > 0 ? 'valid' : 'quota', remaining, limit: data.character_limit || 0, used: data.character_count || 0 };
            const updated = [...elApiKeys, newKey];
            saveElKeys(updated);
            setElNewKey('');
            if (elVoices.length === 0) handleElLoadVoices(updated);
        } catch (e) { alert('Lỗi kiểm tra key: ' + e.message); }
        setElCheckingKey(false);
    };

    const handleRemoveElKey = (key) => saveElKeys(elApiKeys.filter(k => k.key !== key));

    const handleRefreshKey = async (keyObj) => {
        try {
            const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': keyObj.key } });
            if (!res.ok) return;
            const data = await res.json();
            const remaining = (data.character_limit || 0) - (data.character_count || 0);
            saveElKeys(elApiKeys.map(k => k.key === keyObj.key ? { ...k, remaining, limit: data.character_limit || 0, used: data.character_count || 0, status: remaining > 0 ? 'valid' : 'quota' } : k));
        } catch (_) {}
    };

    const handleImportKeysFromFile = async () => {
        const result = await window.electronAPI.elReadKeysFile();
        if (!result.success) return;
        if (!result.keys || result.keys.length === 0) {
            return alert('Không tìm thấy API key nào trong file! Đảm bảo file .txt có mỗi key sk_... trên 1 dòng.');
        }
        const newKeys = result.keys.filter(k => !elApiKeys.find(e => e.key === k));
        if (newKeys.length === 0) return alert('Tất cả key trong file đã có trong danh sách!');
        const keysToAdd = newKeys.map(k => ({ key: k, status: 'unchecked', remaining: 0 }));
        saveElKeys([...elApiKeys, ...keysToAdd]);
        alert(`Đã thêm ${newKeys.length} key từ file. Nhấn nút refresh (↻) trên từng key để kiểm tra credit.`);
    };

    const handleElLoadVoices = async () => {
        setElIsLoadingVoices(true);
        try {
            // Thử IPC (system keys trước, fallback user keys)
            const ipcRes = await window.electronAPI.elGetVoices(elApiKeys);
            if (ipcRes.success && ipcRes.voices.length > 0) {
                setElVoices(ipcRes.voices);
                setElIsLoadingVoices(false);
                return;
            }
            // Fallback: dùng user key trực tiếp
            const validKey = elApiKeys.find(k => k.status === 'valid' || k.status === 'quota');
            if (validKey) {
                const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': validKey.key } });
                if (res.ok) { const data = await res.json(); setElVoices(data.voices || []); }
            }
        } catch (_) {}
        setElIsLoadingVoices(false);
    };

    const handleElScan = async () => {
        setElIsScanning(true);
        setElScanProgress({ done: 0, total: EL_SYSTEM_KEYS_COUNT });
        try {
            const result = await window.electronAPI.elScanCredits();
            setElSysStatus(result);
            setElScanProgress({ done: result.total, total: result.total });
        } catch (e) {}
        setElIsScanning(false);
    };

    const handleElPreview = (e, voice) => {
        e.stopPropagation();
        if (elPreviewingVoice === voice.voice_id) {
            elAudioRef.current.pause(); setElPreviewingVoice(null); return;
        }
        if (!voice.preview_url) return;
        setElPreviewingVoice(voice.voice_id);
        elAudioRef.current.src = voice.preview_url;
        elAudioRef.current.play();
        elAudioRef.current.onended = () => setElPreviewingVoice(null);
    };

    const handleElCloneVoice = async () => {
        if (!elCloneName.trim()) return alert('Vui lòng nhập tên giọng!');
        if (elCloneFiles.length === 0) return alert('Vui lòng chọn ít nhất 1 file audio mẫu!');
        setElCloning(true);
        setElCloneLog('⏳ Đang upload và clone giọng...');
        try {
            const res = await window.electronAPI.elCloneVoice({
                name: elCloneName.trim(),
                filePaths: elCloneFiles,
                userKeys: elApiKeys
            });
            if (!res.success) { setElCloneLog(`❌ Lỗi: ${res.error}`); return; }
            setElCloneLog(`✅ Clone xong! Voice ID: ${res.voiceId} · ${res.keyInfo}`);
            setElCloneName(''); setElCloneFiles([]);
            // Reload voice library để thấy giọng mới
            await handleElLoadVoices();
            // Tự động chọn giọng vừa clone
            const newVoice = elVoices.find(v => v.voice_id === res.voiceId);
            if (newVoice) setElSelectedVoice(newVoice);
        } catch (e) { setElCloneLog(`❌ ${e.message}`); }
        finally { setElCloning(false); }
    };

    const handleElPlayHistory = (item) => {
        if (elPlayingId === item.id) { elAudioRef.current.pause(); setElPlayingId(null); return; }
        setElPlayingId(item.id);
        elAudioRef.current.src = `file:///${encodeURI(item.path.replace(/\\/g, '/'))}`;
        elAudioRef.current.play();
        elAudioRef.current.onended = () => setElPlayingId(null);
    };

    // Tách text thành chunks ~950 ký tự, giữ nguyên câu hoàn chỉnh
    const splitChunks = (text, maxLen = 950) => {
        const parts = text.split(/(?<=[.!?。！？\n])\s+/);
        const chunks = [];
        let cur = '';
        for (const part of parts) {
            if ((cur + ' ' + part).trim().length > maxLen && cur) {
                chunks.push(cur.trim());
                cur = part;
            } else {
                cur = cur ? cur + ' ' + part : part;
            }
        }
        if (cur.trim()) chunks.push(cur.trim());
        return chunks.filter(Boolean);
    };

    const handleElGenerate = async () => {
        if (!elText.trim()) return alert('Vui lòng nhập văn bản!');
        if (!elSelectedVoice) return alert('Vui lòng chọn giọng nói!');
        if (!elOutputFolder) return alert('Vui lòng chọn thư mục lưu!');
        setElIsGenerating(true); setElProgress(15); setElLastKeyInfo('');
        const safeName = elProjectName.trim() ? elProjectName.replace(/[^a-z0-9_-]/gi, '_') : `elevenlabs_${Date.now()}`;
        const cleanFolder = elOutputFolder.endsWith('\\') || elOutputFolder.endsWith('/') ? elOutputFolder.slice(0,-1) : elOutputFolder;
        const outputPath = `${cleanFolder}\\${safeName}.mp3`;
        try {
            if (elSrtSegments && elSrtSegments.length > 0) {
                // SRT mode: per-segment ElevenLabs TTS with timing + auto speed
                addVoiceLog(`⚡ [ElevenLabs] Bắt đầu SRT mode — ${elSrtSegments.length} đoạn · giọng: ${elSelectedVoice.name}`, 'info');
                setElSrtProgress({ done: 0, total: elSrtSegments.length, text: 'Khởi động...' });
                setElProgress(20);
                const ttsRes = await window.electronAPI.elTTS_SRT({
                    segments: elSrtSegments,
                    voiceId: elSelectedVoice.voice_id,
                    stability: elStability,
                    similarity: elSimilarity,
                    style: elStyle,
                    userKeys: elApiKeys,
                    outputPath
                });
                setElProgress(100);
                if (!ttsRes.success) throw new Error(ttsRes.error);
                setElLastKeyInfo(ttsRes.keyInfo || '');
                addVoiceLog(`✅ [ElevenLabs] SRT hoàn tất · ${ttsRes.keyInfo || ''} → ${outputPath}`, 'success');
                const item = { id: Date.now(), name: safeName, path: outputPath, voice: elSelectedVoice.name, time: new Date().toLocaleTimeString() };
                const newHist = [item, ...elHistory].slice(0, 30);
                setElHistory(newHist); localStorage.setItem(EL_LS_HIST, JSON.stringify(newHist));
                window.electronAPI.elSystemStatus().then(s => setElSysStatus(s)).catch(() => {});
            } else {
                // Plain text mode — chia chunk ~950 ký tự/câu
                const chunks = splitChunks(elText);
                addVoiceLog(`⚡ [ElevenLabs] ${elText.length} ký tự → ${chunks.length} chunk · giọng: ${elSelectedVoice.name}`, 'info');
                const allBase64 = [];
                let lastKeyInfo = '';
                for (let i = 0; i < chunks.length; i++) {
                    setElProgress(15 + Math.round((i / chunks.length) * 75));
                    addVoiceLog(`🔄 Chunk ${i + 1}/${chunks.length} (${chunks[i].length} ký tự)...`, 'info');
                    const ttsRes = await window.electronAPI.elTTS({
                        text: chunks[i], voiceId: elSelectedVoice.voice_id,
                        stability: elStability, similarity: elSimilarity, style: elStyle, userKeys: elApiKeys
                    });
                    if (!ttsRes.success) throw new Error(`Chunk ${i + 1}: ${ttsRes.error}`);
                    allBase64.push(ttsRes.base64);
                    lastKeyInfo = ttsRes.keyInfo || lastKeyInfo;
                    addVoiceLog(`✅ Chunk ${i + 1}/${chunks.length} · ${ttsRes.keyInfo || ''}`, 'success');
                }
                setElLastKeyInfo(lastKeyInfo);
                const saveResult = await window.electronAPI.saveElevenLabsAudio({ base64Parts: allBase64, outputPath });
                setElProgress(100);
                if (!saveResult.success) throw new Error(saveResult.error);
                addVoiceLog(`💾 Đã lưu: ${outputPath}`, 'success');
                const item = { id: Date.now(), name: safeName, path: outputPath, voice: elSelectedVoice.name, time: new Date().toLocaleTimeString() };
                const newHist = [item, ...elHistory].slice(0, 30);
                setElHistory(newHist); localStorage.setItem(EL_LS_HIST, JSON.stringify(newHist));
                window.electronAPI.elSystemStatus().then(s => setElSysStatus(s)).catch(() => {});
            }
        } catch (e) {
            addVoiceLog(`❌ [ElevenLabs] Lỗi: ${e.message}`, 'error');
            alert('Lỗi tạo giọng: ' + e.message);
        }
        setTimeout(() => { setElIsGenerating(false); setElProgress(0); setElSrtProgress({ done: 0, total: 0, text: '' }); }, 400);
    };

    // Map ngôn ngữ → nhãn để lọc giọng ElevenLabs
    const EL_LANG_MAP = {
        'vi': ['vietnamese', 'vietnam', 'viet'],
        'en': ['american', 'british', 'australian', 'english', 'en'],
        'ja': ['japanese', 'japan'],
        'ko': ['korean', 'korea'],
        'zh': ['chinese', 'china', 'mandarin', 'cantonese'],
        'fr': ['french', 'france'],
        'de': ['german', 'germany'],
        'es': ['spanish', 'spain'],
        'pt': ['portuguese', 'brazil', 'brazilian'],
        'ru': ['russian', 'russia'],
        'it': ['italian', 'italy'],
        'ar': ['arabic', 'arab'],
        'hi': ['hindi', 'indian', 'india'],
        'tr': ['turkish', 'turkey'],
        'pl': ['polish', 'poland'],
        'nl': ['dutch', 'netherlands'],
    };
    const EL_LANG_LABELS = { vi: '🇻🇳 Tiếng Việt', en: '🇺🇸 English', ja: '🇯🇵 日本語', ko: '🇰🇷 한국어', zh: '🇨🇳 中文', fr: '🇫🇷 Français', de: '🇩🇪 Deutsch', es: '🇪🇸 Español', pt: '🇧🇷 Português', ru: '🇷🇺 Русский', it: '🇮🇹 Italiano', ar: '🇸🇦 العربية', hi: '🇮🇳 हिन्दी', tr: '🇹🇷 Türkçe', pl: '🇵🇱 Polski', nl: '🇳🇱 Nederlands' };

    const elFilteredVoices = useMemo(() => elVoices.filter(v => {
        const matchSearch = !elSearchQuery || v.name?.toLowerCase().includes(elSearchQuery.toLowerCase()) ||
            Object.values(v.labels || {}).join(' ').toLowerCase().includes(elSearchQuery.toLowerCase());
        const accent = (v.labels?.accent || v.labels?.language || '').toLowerCase();
        const matchAccent = elAccentFilter === 'All' || accent === elAccentFilter.toLowerCase();
        const matchLang = elLangFilter === 'All' || (() => {
            const keywords = EL_LANG_MAP[elLangFilter] || [];
            const allLabels = Object.values(v.labels || {}).join(' ').toLowerCase() + ' ' + (v.name || '').toLowerCase();
            return keywords.some(kw => allLabels.includes(kw));
        })();
        return matchSearch && matchAccent && matchLang;
    }), [elVoices, elSearchQuery, elAccentFilter, elLangFilter]);

    const elAccents = useMemo(() => {
        const s = new Set();
        elVoices.forEach(v => { if (v.labels?.accent) s.add(v.labels.accent); });
        return Array.from(s).sort();
    }, [elVoices]);

    const elTotalRemaining = elApiKeys.filter(k => k.status === 'valid').reduce((s, k) => s + (k.remaining || 0), 0);

    // =========================================================================
    // ===  GEMINI TTS STATE  ==================================================
    // =========================================================================
    const [gmText,         setGmText]        = useState('');
    const [gmProjectName,  setGmProjectName] = useState('');
    const [gmOutputFolder, setGmOutputFolder]= useState('');
    const [gmVoice,        setGmVoice]       = useState('Aoede');
    const [gmGenderFilter, setGmGenderFilter]= useState('all');
    const [gmIsGenerating, setGmIsGenerating]= useState(false);
    const [gmHistory,      setGmHistory]     = useState(() => {
        try { return JSON.parse(localStorage.getItem(GEMINI_LS_HIST) || '[]'); } catch { return []; }
    });
    const [gmPlayingId,      setGmPlayingId]      = useState(null);
    const [gmPreviewingVoice,setGmPreviewingVoice]= useState(null); // voiceId đang nghe thử
    const [gmSrtSegments,    setGmSrtSegments]    = useState(null);
    const [gmSrtProgress,    setGmSrtProgress]    = useState({ done: 0, total: 0, text: '' });
    const [gmTextProgress,   setGmTextProgress]   = useState({ done: 0, total: 0, text: '' });
    const [gmQuota,          setGmQuota]          = useState(null); // { total, exhausted, available, charsRemaining, minutesRemaining }
    const gmAudioRef = useRef(new Audio());

    useEffect(() => {
        window.electronAPI?.onGeminiTTSProgress?.((data) => setGmTextProgress(data));
    }, []);

    const refreshGmQuota = async () => {
        try {
            const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
            if (!apiKeys.length) return;
            const status = await window.electronAPI?.geminiQuotaStatus?.({ apiKeys });
            if (status) setGmQuota(status);
        } catch (_) {}
    };

    useEffect(() => {
        refreshGmQuota();
    }, []);

    const saveGmHistory = (hist) => {
        setGmHistory(hist);
        localStorage.setItem(GEMINI_LS_HIST, JSON.stringify(hist.slice(0, 50)));
    };

    const handleGmGenerate = async () => {
        const apiKeysRaw = localStorage.getItem('fluxy_gemini_api_keys') || '[]';
        const apiKeys = JSON.parse(apiKeysRaw);
        if (!apiKeys.length) return alert('Chưa có API Key Gemini. Vào Creator → nhập key!');
        const apiKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
        const folderRaw = gmOutputFolder || await window.electronAPI.getDownloadsDir();
        const folder = folderRaw.endsWith('\\') || folderRaw.endsWith('/') ? folderRaw.slice(0, -1) : folderRaw;
        const safeName = (gmProjectName.trim() || 'gemini_tts').replace(/[^a-z0-9_-]/gi, '_');
        setGmIsGenerating(true);

        if (gmSrtSegments && gmSrtSegments.length > 0) {
            // ── SRT mode: tạo từng đoạn và ghép theo timeline ──────────────────
            const outputPath = `${folder}\\${safeName}_${Date.now()}.wav`;
            addVoiceLog(`🎙️ [Gemini TTS] Bắt đầu SRT — ${gmSrtSegments.length} đoạn · ${gmVoice}`, 'info');
            setGmSrtProgress({ done: 0, total: gmSrtSegments.length, text: 'Khởi động...' });
            const result = await window.electronAPI.geminiTTSSRT({
                segments: gmSrtSegments,
                voiceName: gmVoice,
                apiKeys, // truyền cả mảng để round-robin + rate limit tối ưu
                outputPath,
            });
            if (result.success) {
                addVoiceLog(`✅ [Gemini TTS] SRT hoàn tất: ${result.path}`, 'success');
                const entry = { id: Date.now(), path: result.path, name: safeName, voice: gmVoice, text: `📋 SRT · ${gmSrtSegments.length} đoạn`, time: new Date().toLocaleTimeString() };
                saveGmHistory([entry, ...gmHistory]);
            } else {
                addVoiceLog(`❌ [Gemini TTS] Lỗi SRT: ${result.error}`, 'error');
                alert('Lỗi tạo SRT: ' + result.error);
            }
            setTimeout(() => setGmSrtProgress({ done: 0, total: 0, text: '' }), 500);
        } else {
            // ── Plain text mode — chia câu ~1000 ký tự, retry vô hạn, concat cuối ─
            if (!gmText.trim()) { setGmIsGenerating(false); return alert('Nhập văn bản cần đọc!'); }
            const fullText = gmText.trim();
            const chunks = splitTextIntoChunks(fullText, 1000);
            addVoiceLog(`🎙️ [Gemini TTS] ${chunks.length} đoạn · Voice: ${gmVoice} · ${fullText.length} ký tự`);
            const ts = Date.now();
            const chunkFiles = [];
            const chunkDurations = [];
            let aborted = false;
            for (let i = 0; i < chunks.length; i++) {
                if (aborted) break;
                let attempt = 0;
                let success = false;
                while (!success) {
                    const statusText = attempt === 0
                        ? `⏳ Đoạn ${i+1}/${chunks.length}...`
                        : `🔄 Đoạn ${i+1}/${chunks.length} · thử lần ${attempt+1}...`;
                    setGmTextProgress({ done: i, total: chunks.length, text: statusText });
                    const result = await window.electronAPI.geminiTTS({
                        text: chunks[i],
                        voiceName: gmVoice,
                        apiKeys,
                        outputFolder: folder,
                        projectName: `${safeName}_s${String(i+1).padStart(4,'0')}_${ts}`,
                    });
                    if (result.success) {
                        chunkFiles.push(result.path);
                        try {
                            const durInfo = await window.electronAPI.prepareAudio(result.path);
                            chunkDurations.push(durInfo?.duration || 0);
                        } catch { chunkDurations.push(0); }
                        success = true;
                    } else {
                        attempt++;
                        addVoiceLog(`⚠️ Đoạn ${i+1} thất bại (${result.error?.slice(0,50)}) → thử lại sau 5s...`, 'warn');
                        await new Promise(r => setTimeout(r, 5000));
                        if (!window.__gmTtsRunning) { aborted = true; break; }
                    }
                }
            }
            setGmTextProgress({ done: chunks.length, total: chunks.length, text: '' });
            if (chunkFiles.length === 0) {
                addVoiceLog('❌ Không tạo được file nào', 'error');
            } else {
                // Luôn gọi concat để rename/xóa chunk, dù chỉ có 1 file
                addVoiceLog(`🔧 Hoàn thiện ${chunkFiles.length} đoạn...`);
                const finalPath = `${folder}\\${safeName}_${ts}.wav`;
                const concatRes = await window.electronAPI.concatWavFiles?.({ files: chunkFiles, outputPath: finalPath, deleteAfter: true });
                const savedPath = concatRes?.success ? concatRes.path : chunkFiles[chunkFiles.length - 1];
                const savedName = savedPath.split(/[/\\]/).pop();
                addVoiceLog(`✅ Hoàn tất: ${savedName}`, 'success');

                // Tạo SRT từ chunks + durations
                try {
                    const toSrtTime = (sec) => {
                        const h  = Math.floor(sec / 3600);
                        const m  = Math.floor((sec % 3600) / 60);
                        const s  = Math.floor(sec % 60);
                        const ms = Math.round((sec % 1) * 1000);
                        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
                    };
                    let srtContent = '';
                    let elapsed = 0;
                    chunks.slice(0, chunkFiles.length).forEach((chunkText, idx) => {
                        const dur   = chunkDurations[idx] || 0;
                        const start = elapsed;
                        const end   = elapsed + dur;
                        elapsed     = end;
                        srtContent += `${idx + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${chunkText.trim()}\n\n`;
                    });
                    const srtPath = savedPath.replace(/\.[^.]+$/, '.srt');
                    await window.electronAPI.writeTextFile({ filePath: srtPath, content: srtContent });
                    addVoiceLog(`📄 SRT: ${srtPath.split(/[/\\]/).pop()}`, 'success');
                } catch (srtErr) {
                    addVoiceLog(`⚠️ Tạo SRT thất bại: ${srtErr.message}`, 'warn');
                }

                const entry = { id: ts, path: savedPath, name: savedName, voice: gmVoice, text: fullText.slice(0, 80), time: new Date().toLocaleTimeString() };
                saveGmHistory([entry, ...gmHistory]);
            }
        }

        setGmIsGenerating(false);
        setGmTextProgress({ done: 0, total: 0, text: '' });
        refreshGmQuota(); // cập nhật quota sau khi tạo xong
    };

    const handleGmPlay = (item) => {
        if (gmPlayingId === item.id) { gmAudioRef.current.pause(); setGmPlayingId(null); return; }
        gmAudioRef.current.src = toFileUrl(item.path);
        gmAudioRef.current.play();
        setGmPlayingId(item.id);
        gmAudioRef.current.onended = () => setGmPlayingId(null);
    };

    const handleGmPreview = async (e, voiceId) => {
        e.stopPropagation();
        if (gmPreviewingVoice === voiceId) {
            gmAudioRef.current.pause();
            setGmPreviewingVoice(null);
            return;
        }
        const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
        if (!apiKeys.length) return alert('Cần API Key Gemini để nghe thử!');
        const apiKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
        setGmPreviewingVoice(voiceId);
        const tmpFolder = await window.electronAPI.getDownloadsDir();
        const result = await window.electronAPI.geminiTTS({
            text: 'Xin chào, đây là giọng đọc mẫu của tôi.',
            voiceName: voiceId,
            apiKeys,
            outputFolder: tmpFolder,
            projectName: `preview_${voiceId}`,
        });
        if (result.success) {
            gmAudioRef.current.src = toFileUrl(result.path);
            gmAudioRef.current.play();
            gmAudioRef.current.onended = () => setGmPreviewingVoice(null);
        } else {
            setGmPreviewingVoice(null);
        }
    };

    // =========================================================================
    // ===  VOICE LOG  =========================================================
    // =========================================================================
    const [voiceLogs, setVoiceLogs] = useState([]);
    const [logOpen, setLogOpen] = useState(false);
    const logEndRef = useRef(null);

    const addVoiceLog = (text, type = 'info') => {
        setVoiceLogs(prev => [...prev.slice(-199), { id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), text, type }]);
    };

    // Auto-scroll khi có log mới
    useEffect(() => {
        if (logOpen && logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [voiceLogs, logOpen]);


    // =========================================================================
    // ===  RENDER  =============================================================
    // =========================================================================
    return (
        <div className={`flex flex-col w-full h-full ${dark ? 'bg-[#0b1120] text-slate-300' : 'bg-gray-100 text-gray-800'} overflow-hidden`}>

            {/* ── TAB HEADER ─────────────────────────────────────────────────── */}
            <div className={`flex border-b ${dark ? 'border-slate-800 bg-[#141c2f]' : 'border-gray-200 bg-white'} px-6 py-3 gap-4 shrink-0`}>
                <button onClick={() => setSubTab('edge')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'edge' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Mic size={16} /> Edge TTS
                </button>
                <button onClick={() => setSubTab('elevenlabs')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'elevenlabs' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Zap size={16} /> ElevenLabs TTS
                </button>
                <button onClick={() => setSubTab('gemini')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'gemini' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Sparkles size={16} /> Gemini TTS
                </button>
                <button onClick={() => setSubTab('vieneu')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'vieneu' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Mic size={16} /> VieNeu TTS
                    {vnReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>}
                </button>
                <button onClick={() => setSubTab('gptsovits')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'gptsovits' ? 'bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Sparkles size={16} /> GPT-SoVITS
                    {gsvConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>}
                </button>
                <button onClick={() => setSubTab('kokoro')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'kokoro' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Mic size={16} /> Kokoro TTS
                    {kkReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>}
                </button>
            </div>

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: EDGE TTS  ════════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'edge' && (
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
                    {/* CỘT TRÁI */}
                    <div className="flex flex-col w-[45%] shrink-0 min-h-0 overflow-y-auto">
                        <div className="flex items-center gap-3 mb-5 bg-[#141c2f] p-4 rounded-xl border border-slate-800 shadow-sm shrink-0">
                            <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-500 shrink-0"><Mic size={20} /></div>
                            <div>
                                <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Studio Giọng Nói</h2>
                                <p className="text-[10px] text-slate-500">Edge TTS · Microsoft · Miễn phí</p>
                            </div>
                        </div>

                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-5 mb-4 space-y-4 shadow-sm shrink-0">
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Tên Dự Án (Tên File)</label>
                                <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="VD: audio_tiktok_01 (để trống tự tạo mã)" className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Thư mục lưu File (.MP3)</label>
                                <div className="flex gap-2">
                                    <input type="text" readOnly value={outputFolder} className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-400 truncate focus:outline-none opacity-80" />
                                    <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg flex items-center gap-2 font-semibold text-sm shrink-0"><FolderOpen size={16} /> Chọn</button>
                                </div>
                            </div>
                        </div>

                        <div className={`flex-1 flex flex-col mb-4 bg-[#141c2f] rounded-xl shadow-sm min-h-[180px] overflow-hidden border transition-colors ${srtSegments && srtSegments.length > 0 ? 'border-emerald-500/30' : 'border-slate-800'}`}>
                            <div className={`flex justify-between items-center px-4 py-2.5 border-b shrink-0 transition-colors ${srtSegments && srtSegments.length > 0 ? 'border-emerald-500/20 bg-[#1a233a]/60' : 'border-slate-800/50'}`}>
                                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2"><Volume2 size={14} className="text-emerald-400" /> Văn bản cần đọc</label>
                                <div className="flex items-center gap-2">
                                    {srtSegments && srtSegments.length > 0 && (() => {
                                        const info = formatSRTInfo(srtSegments);
                                        return (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] px-2 py-0.5 bg-emerald-900/50 border border-emerald-600/40 text-emerald-400 rounded-full font-bold">
                                                    📋 SRT · {info.count} đoạn · {info.duration}
                                                    {info.needsSpeed && ' · ⚡ tự tăng tốc'}
                                                </span>
                                                <button onClick={() => { setText(srtSegments.map(s => s.text).join('\n')); setSrtSegments(null); }}
                                                    className="text-[10px] px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">Lọc text</button>
                                            </div>
                                        );
                                    })()}
                                    <span className="text-[10px] text-slate-500 font-mono">{text.length} ký tự</span>
                                </div>
                            </div>
                            <textarea value={text} onChange={e => {
                                const val = e.target.value;
                                setText(val);
                                if (isSRTContent(val)) {
                                    const segs = parseSRT(val);
                                    setSrtSegments(segs.length > 0 ? segs : null);
                                } else { setSrtSegments(null); }
                            }} placeholder="Dán nội dung cần đọc vào đây...&#10;&#10;💡 Hỗ trợ file .SRT — tự động nhận diện và đồng bộ giọng với mốc thời gian." className="flex-1 w-full bg-transparent p-4 text-sm text-slate-200 focus:outline-none resize-none leading-relaxed custom-scrollbar" />
                            {srtSegments && srtSegments.length > 0 && srtProgress.total > 0 && (
                                <div className="px-4 pb-2 shrink-0">
                                    <div className="flex justify-between text-[10px] text-emerald-400 font-bold mb-1">
                                        <span>{srtProgress.text}</span>
                                        <span>{srtProgress.done}/{srtProgress.total}</span>
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${srtProgress.total > 0 ? (srtProgress.done / srtProgress.total) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Pitch & Rate controls */}
                        <div className="mb-3 shrink-0 bg-[#141c2f] border border-slate-800 rounded-xl px-4 py-3 space-y-2">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] text-slate-400 w-14 shrink-0">🎵 Tone</span>
                                <input type="range" min={-12} max={12} step={1} value={edgePitch}
                                    onChange={e => setEdgePitch(+e.target.value)}
                                    className="flex-1 accent-emerald-500 h-1.5 cursor-pointer" />
                                <span className={`text-[11px] font-bold w-10 text-right tabular-nums ${edgePitch > 0 ? 'text-emerald-400' : edgePitch < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                                    {edgePitch > 0 ? `+${edgePitch}` : edgePitch}st
                                </span>
                                <button onClick={() => setEdgePitch(0)} className="text-[9px] text-slate-600 hover:text-slate-400 transition">↺</button>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] text-slate-400 w-14 shrink-0">⚡ Tốc độ</span>
                                <input type="range" min={-50} max={50} step={5} value={edgeRate}
                                    onChange={e => setEdgeRate(+e.target.value)}
                                    className="flex-1 accent-blue-500 h-1.5 cursor-pointer" />
                                <span className={`text-[11px] font-bold w-10 text-right tabular-nums ${edgeRate > 0 ? 'text-blue-400' : edgeRate < 0 ? 'text-orange-400' : 'text-slate-500'}`}>
                                    {edgeRate > 0 ? `+${edgeRate}` : edgeRate}%
                                </span>
                                <button onClick={() => setEdgeRate(0)} className="text-[9px] text-slate-600 hover:text-slate-400 transition">↺</button>
                            </div>
                            {(edgePitch !== 0 || edgeRate !== 0) && (
                                <div className="text-[9px] text-slate-600 italic">
                                    SSML: pitch={edgePitch > 0 ? '+' : ''}{edgePitch}st{edgeRate !== 0 ? ` · rate=${edgeRate > 0 ? '+' : ''}${edgeRate}%` : ''}
                                </div>
                            )}
                        </div>

                        <div className="relative mb-4 shrink-0">
                            {isGenerating && (
                                <div className="absolute -top-5 left-0 right-0 flex justify-between text-xs font-bold text-emerald-400">
                                    <span className="truncate">{srtSegments && srtProgress.total > 0 ? srtProgress.text : 'Đang xử lý âm thanh...'}</span>
                                    <span className="shrink-0 ml-2">{progress}%</span>
                                </div>
                            )}
                            <button onClick={handleGenerate} disabled={isGenerating} className="relative w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-400 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 overflow-hidden transition-colors">
                                {isGenerating && <div className="absolute left-0 top-0 bottom-0 bg-emerald-500/30 transition-all duration-300" style={{ width: `${progress}%` }} />}
                                <span className="relative z-10 flex items-center gap-2">
                                    {isGenerating ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                                    {isGenerating
                                        ? (srtSegments ? `ĐANG TẠO SRT ${srtProgress.done}/${srtProgress.total}...` : 'ĐANG TẠO...')
                                        : srtSegments ? `📋 TẠO SRT VOICE (${srtSegments.length} đoạn)` : 'BẮT ĐẦU TẠO GIỌNG NÓI'}
                                </span>
                            </button>
                        </div>

                        <div className="flex-1 min-h-[130px] max-h-[200px] bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden shrink-0">
                            <div className="p-3 border-b border-slate-800 flex items-center gap-2 shrink-0"><History size={14} className="text-blue-400" /><h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Lịch sử vừa tạo</h3></div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {history.length === 0 ? <p className="text-center text-[11px] text-slate-500 mt-5">Chưa có file nào.</p> : history.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 hover:bg-[#1e293b] rounded-lg border-b border-slate-800/50 last:border-0 group transition-colors">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <button onClick={() => handlePlayHistory(item)} className="w-7 h-7 rounded-full bg-slate-700 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 transition-colors">{playingHistoryId === item.id ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}</button>
                                            <div className="truncate"><p className="text-xs font-bold text-slate-200 truncate">{item.name}.mp3</p><p className="text-[10px] text-slate-500">{item.time}</p></div>
                                        </div>
                                        <button onClick={() => window.electronAPI.openFolder(item.path.substring(0, item.path.lastIndexOf('\\')))} className="p-1.5 text-slate-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"><FolderOpen size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* CỘT PHẢI: THƯ VIỆN GIỌNG */}
                    <div className="flex-1 h-full bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden min-w-0">
                        <div className="p-5 border-b border-slate-800 flex justify-between items-end bg-[#1a233a] shrink-0">
                            <div>
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-lg font-bold text-white">Thư viện Giọng nói</h3>
                                    <button onClick={fetchVoices} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-colors"><RefreshCw size={14} className={isLoadingVoices ? 'animate-spin' : ''} /></button>
                                </div>
                                <p className="text-xs text-slate-400">Đang chọn: <span className="text-emerald-400 font-bold">{currentVoiceData.ShortName?.split('-').pop() || 'Chưa chọn'}</span></p>
                            </div>
                            <div className="text-xs font-bold px-3 py-1 bg-slate-800 text-slate-300 rounded-lg border border-slate-700">Tổng: {voices.length} giọng</div>
                        </div>
                        <div className="p-4 border-b border-slate-800 bg-[#0f172a]/50 flex gap-3 items-center shrink-0">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Tìm tên giọng..." className="w-full bg-[#1e293b] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors" />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <Filter size={14} className="text-slate-500" />
                                <select value={selectedLang} onChange={e => setSelectedLang(e.target.value)} className="bg-[#1e293b] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none max-w-[180px]">
                                    <option value="All">Tất cả Quốc gia</option>
                                    {languages.map(lang => <option key={lang} value={lang}>{getLanguageName(lang)}</option>)}
                                </select>
                            </div>
                            <div className="flex bg-[#1e293b] rounded-lg border border-slate-700 p-0.5 shrink-0">
                                {['All', 'Female', 'Male'].map(g => (
                                    <button key={g} onClick={() => setGenderFilter(g)} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${genderFilter === g ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{g === 'All' ? 'Tất cả' : g === 'Female' ? 'Nữ' : 'Nam'}</button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#0f172a]/20">
                            {isLoadingVoices ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500"><RefreshCw size={32} className="mb-3 animate-spin opacity-50" /><p className="text-sm">Đang tải danh sách giọng nói...</p></div>
                            ) : filteredVoices.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500"><Mic size={32} className="mb-3 opacity-20" /><p className="text-sm">Không tìm thấy giọng nào phù hợp.</p></div>
                            ) : (
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                    {filteredVoices.map(v => {
                                        const isSelected = selectedVoice === v.ShortName;
                                        const isPreviewing = previewingVoice === v.ShortName;
                                        return (
                                            <div key={v.ShortName} onClick={() => setSelectedVoice(v.ShortName)} className={`relative group flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 overflow-hidden ${isSelected ? 'bg-emerald-900/20 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-[#1e293b]/50 border-slate-700/50 hover:bg-[#1e293b] hover:border-slate-600'}`}>
                                                {isSelected && <div className="absolute top-2 right-2 text-emerald-500"><CheckCircle2 size={16} fill="currentColor" className="text-emerald-900" /></div>}
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${isSelected ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-slate-800 border-slate-700'}`}><User size={18} className={v.Gender === 'Female' ? 'text-pink-400' : 'text-blue-400'} /></div>
                                                <div className="flex-1 min-w-0 pt-0.5 pr-6">
                                                    <p className={`text-sm font-bold truncate ${isSelected ? 'text-emerald-400' : 'text-slate-200 group-hover:text-white'}`}>{v.ShortName?.split('-').pop() || v.ShortName}</p>
                                                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400 truncate"><span className="font-semibold text-slate-300 truncate">{getLanguageName(v.Locale)}</span><span>•</span><span>{v.Gender === 'Female' ? 'Nữ' : 'Nam'}</span></div>
                                                </div>
                                                <button onClick={e => handlePreview(e, v.ShortName)} className={`absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-md ${isPreviewing ? 'bg-amber-500 text-white animate-pulse' : 'bg-blue-600 text-white opacity-0 group-hover:opacity-100 hover:bg-blue-500'}`}>{isPreviewing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: ELEVENLABS TTS  ══════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'elevenlabs' && (
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0 relative">

                    {/* ── CỘT TRÁI ──────────────────────────────────────────── */}
                    <div className="w-[370px] shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-2">

                        {/* SYSTEM STATUS + API Keys */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 shrink-0 space-y-3">
                            {/* System status bar */}
                            <div className="bg-[#0f172a] border border-purple-500/20 rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${elSysStatus.valid > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Key Hệ Thống</span>
                                    </div>
                                    <button
                                        onClick={handleElScan}
                                        disabled={elIsScanning}
                                        className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-white transition-colors"
                                    >
                                        <RefreshCw size={10} className={elIsScanning ? 'animate-spin' : ''} />
                                        {elIsScanning ? `${elScanProgress.done}/${elScanProgress.total}` : 'Quét Credit'}
                                    </button>
                                </div>
                                {elIsScanning && elScanProgress.total > 0 && (
                                    <div className="w-full bg-slate-800 rounded-full h-1 mb-2 overflow-hidden">
                                        <div className="h-1 bg-purple-500 transition-all duration-300 rounded-full" style={{ width: `${Math.round(elScanProgress.done / elScanProgress.total * 100)}%` }} />
                                    </div>
                                )}
                                <div className="flex items-center justify-center gap-3 mt-1">
                                    <p className="text-2xl font-bold text-white">{elSysStatus.totalRemaining > 1000 ? `${Math.round(elSysStatus.totalRemaining / 1000)}K` : (elSysStatus.totalRemaining || 0).toLocaleString()}</p>
                                    <div>
                                        <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide">Ký tự còn lại</p>
                                        <p className="text-[9px] text-slate-500">{elIsScanning ? `Đang quét ${elScanProgress.done}/${elScanProgress.total}...` : `${elSysStatus.valid} key hoạt động`}</p>
                                    </div>
                                </div>
                            </div>

                            {/* User API Keys */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Key size={12} className="text-yellow-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Key Cá Nhân (tuỳ chọn)</span>
                                    </div>
                                    <button onClick={() => handleElLoadVoices()} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"><RefreshCw size={11} className={elIsLoadingVoices ? 'animate-spin' : ''} /></button>
                                </div>
                                <div className="flex gap-2 mb-2">
                                    <input type="password" value={elNewKey} onChange={e => setElNewKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddElKey()} placeholder="Thêm key sk_... (tuỳ chọn)" className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-yellow-500 transition-colors" />
                                    <button onClick={handleAddElKey} disabled={elCheckingKey || !elNewKey.trim()} className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0">
                                        {elCheckingKey ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />} Thêm
                                    </button>
                                    <button onClick={handleImportKeysFromFile} className="bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0" title="Nhập nhiều keys từ file .txt (mỗi key 1 dòng)">
                                        <FolderOpen size={11} /> File
                                    </button>
                                </div>
                                {/* Hướng dẫn lấy key miễn phí */}
                                <div className="bg-[#0a0f1e] border border-purple-500/20 rounded-lg p-2.5 space-y-1.5">
                                    <p className="text-[10px] font-bold text-purple-300 flex items-center gap-1.5">🆓 Cách lấy key cá nhân miễn phí:</p>
                                    <ol className="text-[10px] text-slate-400 space-y-0.5 pl-4 list-decimal leading-relaxed">
                                        <li>Vào <button onClick={() => window.electronAPI.openExternal('https://elevenlabs.io/app/settings/api-keys')} className="text-purple-400 hover:text-purple-300 underline decoration-dotted transition-colors">elevenlabs.io</button> → Đăng ký tài khoản</li>
                                        <li>Click avatar góc trái → <span className="text-yellow-400 font-semibold">API Keys</span></li>
                                        <li>Bấm <span className="text-yellow-400 font-semibold">Create API Key</span> → Copy key</li>
                                        <li>Dán vào ô trên → bấm <span className="text-yellow-400 font-semibold">Thêm</span></li>
                                    </ol>
                                    <p className="text-[9px] text-slate-500">🎁 Miễn phí ~10,000 ký tự/tháng · key dạng <span className="font-mono text-slate-400">sk_...</span></p>
                                </div>
                                {elApiKeys.length === 0 ? null : (
                                    <div className="space-y-1 max-h-[90px] overflow-y-auto custom-scrollbar">
                                        {elApiKeys.map((k, i) => (
                                            <div key={i} className="flex items-center gap-2 bg-[#0f172a] rounded-lg px-3 py-1.5">
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${k.status === 'valid' ? 'bg-emerald-500 animate-pulse' : k.status === 'quota' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                                                <span className="flex-1 text-[10px] text-slate-400 font-mono truncate">{k.key.substring(0, 8)}...{k.key.slice(-4)}</span>
                                                {k.remaining !== undefined && <span className="text-[9px] text-slate-500 shrink-0">{(k.remaining || 0).toLocaleString()} ký tự</span>}
                                                <button onClick={() => handleRefreshKey(k)} className="text-slate-600 hover:text-blue-400 shrink-0 transition-colors"><RefreshCw size={10} /></button>
                                                <button onClick={() => handleRemoveElKey(k.key)} className="text-slate-600 hover:text-red-400 shrink-0 transition-colors"><Trash2 size={10} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Text Input */}
                        <div className="bg-[#141c2f] border border-purple-500/20 rounded-xl flex flex-col overflow-hidden shrink-0">
                            <div className="flex justify-between items-center px-4 py-2.5 border-b border-purple-500/10 shrink-0 bg-[#1a233a]/60">
                                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                    <Volume2 size={14} className="text-purple-400" /> Văn bản cần đọc
                                </label>
                                <div className="flex items-center gap-2">
                                    {elSrtSegments && elSrtSegments.length > 0 && (() => {
                                        const info = formatSRTInfo(elSrtSegments);
                                        return (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] px-2 py-0.5 bg-purple-900/50 border border-purple-600/40 text-purple-300 rounded-full font-bold">
                                                    📋 SRT · {info.count} đoạn · {info.duration}
                                                    {info.needsSpeed && ' · ⚡ tự tăng tốc'}
                                                </span>
                                                <button onClick={() => { setElText(elSrtSegments.map(s => s.text).join('\n')); setElSrtSegments(null); }}
                                                    className="text-[10px] px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors" title="Lọc văn bản (bỏ timestamps)">Lọc text</button>
                                            </div>
                                        );
                                    })()}
                                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${elText.length > 0 ? 'bg-purple-900/30 text-purple-300' : 'text-slate-500'}`}>
                                        {elText.length.toLocaleString()} ký tự
                                    </span>
                                    {/* Nút phân đoạn */}
                                    {elText.length > 950 && (
                                        <button onClick={elDoSplit}
                                            className="flex items-center gap-1 px-2 py-0.5 bg-amber-700/40 hover:bg-amber-700/70 border border-amber-600/40 text-amber-300 text-[9px] font-bold rounded transition-colors">
                                            ✂ Phân đoạn
                                        </button>
                                    )}
                                    {elSegments.length > 0 && (
                                        <button onClick={() => setElSegView(v => !v)}
                                            className="flex items-center gap-1 px-2 py-0.5 bg-purple-700/40 hover:bg-purple-700/70 border border-purple-600/40 text-purple-300 text-[9px] font-bold rounded transition-colors">
                                            📋 {elSegView ? 'Ẩn' : `Xem đoạn (${elSegments.length})`}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <textarea
                                value={elText}
                                onChange={e => {
                                    const val = e.target.value;
                                    setElText(val);
                                    if (isSRTContent(val)) {
                                        const segs = parseSRT(val);
                                        setElSrtSegments(segs.length > 0 ? segs : null);
                                    } else { setElSrtSegments(null); }
                                }}
                                placeholder="Dán nội dung cần đọc vào đây...&#10;&#10;Hệ thống tự động chọn key còn nhiều credit nhất.&#10;Khi key hết lượt → tự động chuyển sang key tiếp theo.&#10;&#10;💡 Dán file .SRT để tự động đồng bộ giọng với mốc thời gian."
                                className="w-full bg-transparent p-4 text-sm text-slate-200 focus:outline-none resize-y leading-relaxed custom-scrollbar placeholder-slate-600"
                                style={{ height: '200px', minHeight: '120px', maxHeight: '400px' }}
                            />
                            {elSrtSegments && elSrtSegments.length > 0 && elSrtProgress.total > 0 && (
                                <div className="px-4 pb-2 shrink-0">
                                    <div className="flex justify-between text-[10px] text-purple-400 font-bold mb-1">
                                        <span>{elSrtProgress.text}</span>
                                        <span>{elSrtProgress.done}/{elSrtProgress.total}</span>
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${elSrtProgress.total > 0 ? (elSrtProgress.done / elSrtProgress.total) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Output settings */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 space-y-3 shrink-0">
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Tên file đầu ra</label>
                                <input type="text" value={elProjectName} onChange={e => setElProjectName(e.target.value)} placeholder="VD: elevenlabs_audio_01 (để trống tự tạo)" className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition-colors" />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Thư mục lưu</label>
                                <div className="flex gap-2">
                                    <input type="text" readOnly value={elOutputFolder} className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 truncate focus:outline-none" />
                                    <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setElOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg transition-colors"><FolderOpen size={15} /></button>
                                </div>
                            </div>
                        </div>

                        {/* Generate button */}
                        <div className="shrink-0">
                            <div className="relative">
                                {elIsGenerating && (
                                    <div className="absolute -top-5 left-0 right-0 flex justify-between text-xs font-bold text-purple-400">
                                        <span>{elSrtSegments && elSrtProgress.total > 0 ? elSrtProgress.text : 'Đang xử lý...'}</span>
                                        <span>{elProgress}%</span>
                                    </div>
                                )}
                                <button onClick={handleElGenerate} disabled={elIsGenerating || !elSelectedVoice} className="relative w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 overflow-hidden transition-all shadow-lg shadow-purple-900/20 disabled:shadow-none">
                                    {elIsGenerating && <div className="absolute left-0 top-0 bottom-0 bg-white/10 transition-all duration-300" style={{ width: `${elProgress}%` }} />}
                                    <span className="relative z-10 flex items-center gap-2">
                                        {elIsGenerating ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18} />}
                                        {elIsGenerating
                                            ? (elSrtSegments ? `ĐANG TẠO SRT ${elSrtProgress.done}/${elSrtProgress.total}...` : 'ĐANG TẠO...')
                                            : elSelectedVoice
                                                ? `${elSrtSegments ? '📋 TẠO SRT VOICE' : 'TẠO GIỌNG'} · ${elSelectedVoice.name}`
                                                : 'TẠO GIỌNG ELEVENLABS'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* ── Panel Phân đoạn ──────────────────────────────────── */}
                        {elSegView && elSegments.length > 0 && (
                        <div className="bg-[#141c2f] border border-purple-700/30 rounded-xl flex flex-col shrink-0 overflow-hidden">
                            {/* Header — title + stats + close */}
                            <div className="px-3 py-2 bg-[#1a1f35] border-b border-slate-800/60 flex items-center gap-2 shrink-0">
                                <span className="text-purple-300 text-[11px] font-bold">✂ Phân đoạn ({elSegments.length})</span>
                                {/* Stats badges */}
                                {elSegments.filter(s=>s.status==='done').length > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 rounded-full font-bold">{elSegments.filter(s=>s.status==='done').length} xong</span>
                                )}
                                {elSegments.filter(s=>s.status==='error').length > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-red-900/40 text-red-400 rounded-full font-bold">{elSegments.filter(s=>s.status==='error').length} lỗi</span>
                                )}
                                {elSegments.filter(s=>s.status==='waiting'||s.status==='processing').length > 0 && (
                                    <span className="text-[9px] text-slate-600">{elSegments.filter(s=>s.status==='waiting').length} chờ</span>
                                )}
                                <div className="ml-auto flex items-center gap-1">
                                    {/* Chọn nhanh */}
                                    <button onClick={() => setElSegments(p => p.map(s => ({...s, checked: true})))}  title="Chọn tất cả"  className="text-[9px] px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded transition-colors">Tất cả</button>
                                    <button onClick={() => setElSegments(p => p.map(s => ({...s, checked: !s.checked})))} title="Đảo chọn" className="text-[9px] px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded transition-colors">Đảo</button>
                                    <button onClick={() => { setElSegView(false); setElSegments([]); setElSegMergedPath(''); }}
                                        title="Đóng panel" className="p-1 hover:bg-red-900/40 text-slate-600 hover:text-red-400 rounded transition-colors ml-1"><X size={13}/></button>
                                </div>
                            </div>

                            {/* Segment list */}
                            <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: '220px' }}>
                                <table className="w-full text-[10px]">
                                    <thead className="sticky top-0 bg-[#0f172a] text-slate-500">
                                        <tr>
                                            <th className="w-7 py-1.5 text-center">#</th>
                                            <th className="py-1.5 text-left px-2">Nội dung</th>
                                            <th className="w-14 py-1.5 text-center">Ký tự</th>
                                            <th className="w-20 py-1.5 text-center">Trạng thái</th>
                                            <th className="w-12 py-1.5 text-center">TT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {elSegments.map(seg => (
                                            <tr key={seg.id} className={`border-t border-slate-800/40 hover:bg-slate-800/20 ${!seg.checked ? 'opacity-40' : ''}`}>
                                                <td className="text-center py-1.5">
                                                    <input type="checkbox" checked={seg.checked} onChange={() => setElSegments(p => p.map(s => s.id===seg.id ? {...s,checked:!s.checked} : s))}
                                                        className="w-3 h-3 accent-purple-500"/>
                                                </td>
                                                <td className="px-2 py-1.5 max-w-0">
                                                    <p className="truncate text-slate-300">{seg.text.slice(0, 80)}{seg.text.length > 80 ? '...' : ''}</p>
                                                    {seg.error && <p className="text-red-400 text-[8px] truncate">{seg.error.slice(0, 60)}</p>}
                                                </td>
                                                <td className={`text-center font-mono ${seg.charCount > 900 ? 'text-amber-400' : 'text-slate-500'}`}>{seg.charCount}</td>
                                                <td className="text-center">
                                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                                                        seg.status==='done'       ? 'bg-emerald-900/40 text-emerald-400' :
                                                        seg.status==='processing' ? 'bg-purple-900/40 text-purple-300' :
                                                        seg.status==='error'      ? 'bg-red-900/40 text-red-400' :
                                                                                    'bg-slate-800 text-slate-500'}`}>
                                                        {seg.status==='done' ? '✓ Xong' : seg.status==='processing' ? '⟳ Đang...' : seg.status==='error' ? '✗ Lỗi' : 'Chờ'}
                                                    </span>
                                                </td>
                                                <td className="text-center">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        {seg.audioPath && (
                                                            <button onClick={() => window.electronAPI.openFile(seg.audioPath)} title="Mở file" className="p-1 hover:bg-slate-700 rounded text-slate-600 hover:text-slate-300 transition-colors"><Download size={9}/></button>
                                                        )}
                                                        {(seg.status==='error'||seg.status==='waiting') && (
                                                            <button onClick={() => setElSegments(p => p.map(s => s.id===seg.id ? {...s,status:'waiting',error:''} : s))}
                                                                title="Thử lại" className="p-1 hover:bg-slate-700 rounded text-slate-600 hover:text-amber-400 transition-colors"><RefreshCw size={9}/></button>
                                                        )}
                                                        <button onClick={() => setElSegments(p => p.filter(s => s.id !== seg.id))} title="Xóa đoạn"
                                                            className="p-1 hover:bg-slate-700 rounded text-slate-700 hover:text-red-400 transition-colors"><X size={9}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Action bar — dòng 1: nút TTS */}
                            <div className="px-3 pt-2.5 pb-1 border-t border-slate-800/60 shrink-0">
                                {!elSegProcessing ? (
                                    <button onClick={elProcessQueue}
                                        disabled={!elSelectedVoice || elSegments.filter(s=>s.checked&&s.status!=='done').length===0}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white text-[11px] font-bold rounded-lg transition-all">
                                        <Zap size={12}/>
                                        Thêm vào hàng đợi TTS ({elSegments.filter(s=>s.checked&&s.status!=='done').length} đoạn)
                                    </button>
                                ) : (
                                    <button onClick={() => { elSegStopRef.current = true; }}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-red-700 hover:bg-red-600 text-white text-[11px] font-bold rounded-lg transition-colors">
                                        <Square size={11} fill="currentColor"/> Dừng xử lý
                                    </button>
                                )}
                            </div>

                            {/* Action bar — dòng 2: Gap + Nối file + Reset */}
                            <div className="px-3 pb-2.5 flex items-center gap-2 shrink-0">
                                <span className="text-[9px] text-slate-600">Gap</span>
                                <select value={elSegGap} onChange={e => setElSegGap(+e.target.value)}
                                    className="bg-slate-800 border border-slate-700/60 text-slate-400 text-[9px] rounded-md px-2 py-1 outline-none">
                                    {[0,200,300,500,800,1000,1500].map(g => <option key={g} value={g}>{g}ms</option>)}
                                </select>
                                <button onClick={elMergeSegments}
                                    disabled={elSegMerging || elSegments.filter(s=>s.status==='done').length < 2}
                                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-800/50 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-700/40 text-emerald-300 text-[9px] font-bold rounded-md transition-colors">
                                    {elSegMerging ? <><Loader2 size={9} className="animate-spin"/> Đang nối...</> : <>🔗 Nối file ({elSegments.filter(s=>s.status==='done').length})</>}
                                </button>
                                <button onClick={() => setElSegments(p => p.map(s => s.status==='error' ? {...s,status:'waiting',error:''} : s))}
                                    className="ml-auto text-[9px] text-slate-600 hover:text-amber-400 transition-colors px-1.5 py-1 rounded hover:bg-slate-800">
                                    ↺ Reset lỗi
                                </button>
                            </div>

                            {/* File đã nối */}
                            {elSegMergedPath && (
                                <div className="mx-3 mb-2.5 px-3 py-1.5 bg-emerald-900/20 border border-emerald-700/30 rounded-lg flex items-center gap-2">
                                    <span className="text-[9px] text-emerald-400 shrink-0">✅ Đã nối:</span>
                                    <span className="text-[9px] text-emerald-300 flex-1 truncate cursor-pointer hover:underline"
                                        onClick={() => window.electronAPI.openFile(elSegMergedPath)}>
                                        {elSegMergedPath.split('\\').pop()}
                                    </span>
                                    <button onClick={() => window.electronAPI.openFolder(elSegMergedPath.substring(0, elSegMergedPath.lastIndexOf('\\')))}
                                        className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"><FolderOpen size={11}/></button>
                                </div>
                            )}
                        </div>
                        )}

                        {/* History */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shrink-0 overflow-hidden" style={{ maxHeight: '170px' }}>
                            <div className="p-3 border-b border-slate-800 flex items-center gap-2 shrink-0"><History size={14} className="text-purple-400" /><h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Lịch sử ElevenLabs</h3></div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {elHistory.length === 0 ? <p className="text-center text-[11px] text-slate-500 mt-4">Chưa có file nào.</p> : elHistory.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 hover:bg-[#1e293b] rounded-lg border-b border-slate-800/50 last:border-0 group transition-colors">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <button onClick={() => handleElPlayHistory(item)} className="w-7 h-7 rounded-full bg-slate-700 hover:bg-purple-600 text-white flex items-center justify-center shrink-0 transition-colors">{elPlayingId === item.id ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}</button>
                                            <div className="truncate"><p className="text-xs font-bold text-slate-200 truncate">{item.name}.mp3</p><p className="text-[10px] text-slate-500">{item.voice} · {item.time}</p></div>
                                        </div>
                                        <button onClick={() => window.electronAPI.openFolder(item.path.substring(0, item.path.lastIndexOf('\\')))} className="p-1.5 text-slate-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><FolderOpen size={13} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ── CỘT PHẢI: VOICE LIBRARY ───────────────────────────── */}
                    <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-4">

                        {/* Voice settings bar — hiện khi đã chọn giọng */}
                        {elSelectedVoice && (
                            <div className="bg-[#141c2f] border border-purple-500/20 rounded-xl p-4 shrink-0 shadow-[0_0_20px_rgba(168,85,247,0.08)]">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0"><Mic size={15} className="text-purple-400" /></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-white">{elSelectedVoice.name}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{Object.values(elSelectedVoice.labels || {}).filter(Boolean).join(' · ')}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-widest shrink-0"><Sliders size={12} className="text-slate-400" /> Cài đặt giọng</div>
                                </div>
                                <div className="grid grid-cols-3 gap-5">
                                    {[
                                        { label: 'Stability', val: elStability, set: setElStability, color: 'blue', hint: 'Thấp = biểu cảm hơn' },
                                        { label: 'Similarity', val: elSimilarity, set: setElSimilarity, color: 'emerald', hint: 'Cao = giống bản gốc' },
                                        { label: 'Style', val: elStyle, set: setElStyle, color: 'amber', hint: 'Phong cách diễn đạt' },
                                    ].map(({ label, val, set, color, hint }) => (
                                        <div key={label}>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
                                                <span className={`text-xs font-bold text-${color}-400`}>{val}%</span>
                                            </div>
                                            <input type="range" min="0" max="100" value={val} onChange={e => set(parseInt(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-purple-500" />
                                            <p className="text-[9px] text-slate-500 mt-1">{hint}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Voice library */}
                        {/* Clone giọng */}
                        <div className="bg-[#141c2f] border border-slate-700 rounded-xl p-4 shrink-0">
                            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">🎤 Clone giọng (Instant Voice Cloning) <span className="text-[10px] font-normal text-slate-500">— Free tier: tối đa 3 giọng</span></h3>
                            <div className="flex gap-2 mb-2">
                                <input
                                    type="text" value={elCloneName} onChange={e => setElCloneName(e.target.value)}
                                    placeholder="Tên giọng (vd: Giọng Nam Nhật)" maxLength={60}
                                    className="flex-1 bg-[#1e293b] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                                />
                                <button
                                    onClick={() => elCloneInputRef.current?.click()}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg whitespace-nowrap"
                                >
                                    📁 Chọn audio
                                </button>
                                <input ref={elCloneInputRef} type="file" accept="audio/*" multiple className="hidden"
                                    onChange={e => setElCloneFiles(Array.from(e.target.files).map(f => f.path))} />
                                <button
                                    onClick={handleElCloneVoice} disabled={elCloning}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg whitespace-nowrap"
                                >
                                    {elCloning ? '⏳ Đang clone...' : '✨ Clone'}
                                </button>
                            </div>
                            {elCloneFiles.length > 0 && (
                                <div className="text-[10px] text-slate-400 mb-2">
                                    {elCloneFiles.map((f, i) => <span key={i} className="mr-2 bg-slate-800 px-2 py-0.5 rounded">{f.split(/[\\/]/).pop()}</span>)}
                                </div>
                            )}
                            {elCloneLog && <p className={`text-[11px] mt-1 ${elCloneLog.startsWith('✅') ? 'text-green-400' : elCloneLog.startsWith('❌') ? 'text-red-400' : 'text-slate-400'}`}>{elCloneLog}</p>}
                            <p className="text-[10px] text-slate-600 mt-1">Upload 1-5 file WAV/MP3 (ít nhất 30s). Xoay vòng key tự động khi hết quota.</p>
                        </div>

                        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col overflow-hidden min-h-0 shadow-sm">
                            <div className="p-4 border-b border-slate-800 bg-[#1a233a] flex justify-between items-center shrink-0">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-sm font-bold text-white">Thư viện Giọng ElevenLabs</h3>
                                    <button onClick={() => handleElLoadVoices()} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-colors"><RefreshCw size={13} className={elIsLoadingVoices ? 'animate-spin' : ''} /></button>
                                </div>
                                <span className="text-xs font-bold px-3 py-1 bg-slate-800 text-slate-300 rounded-lg border border-slate-700">{elFilteredVoices.length} / {elVoices.length} giọng</span>
                            </div>

                            <div className="p-3 border-b border-slate-800 bg-[#0f172a]/50 flex gap-3 items-center shrink-0">
                                <div className="relative flex-1">
                                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input type="text" value={elSearchQuery} onChange={e => setElSearchQuery(e.target.value)} placeholder="Tìm tên giọng, phong cách..." className="w-full bg-[#1e293b] border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 transition-colors" />
                                </div>
                                <span className="text-[10px] text-slate-500 shrink-0">🌐 Tất cả giọng đọc được mọi ngôn ngữ (multilingual v2)</span>
                                {elAccents.length > 0 && (
                                    <div className="relative shrink-0">
                                        <select value={elAccentFilter} onChange={e => setElAccentFilter(e.target.value)} className="bg-[#1e293b] border border-slate-700 rounded-lg px-3 py-2 pr-7 text-xs text-white focus:outline-none appearance-none">
                                            <option value="All">Tất cả accent</option>
                                            {elAccents.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#0f172a]/20">
                                {elIsLoadingVoices ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-500"><RefreshCw size={32} className="mb-3 animate-spin opacity-50" /><p className="text-sm">Đang tải danh sách giọng...</p></div>
                                ) : elVoices.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-3">
                                        <Key size={40} className="opacity-20" />
                                        <p className="text-sm font-medium text-slate-500">Chưa tải được danh sách giọng</p>
                                        <button onClick={() => handleElLoadVoices()} className="text-xs px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg font-bold transition-colors flex items-center gap-2"><RefreshCw size={12} /> Thử lại</button>
                                        <p className="text-[10px] text-slate-600">Hệ thống dùng key tích hợp sẵn. Thêm key cá nhân nếu cần.</p>
                                    </div>
                                ) : elFilteredVoices.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-500"><Mic size={32} className="mb-3 opacity-20" /><p className="text-sm">Không tìm thấy giọng nào phù hợp.</p></div>
                                ) : (
                                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {elFilteredVoices.map(voice => {
                                            const isSelected = elSelectedVoice?.voice_id === voice.voice_id;
                                            const isPreviewing = elPreviewingVoice === voice.voice_id;
                                            return (
                                                <div key={voice.voice_id} onClick={() => setElSelectedVoice(voice)} className={`relative group flex flex-col p-3 rounded-xl border cursor-pointer transition-all duration-200 ${isSelected ? 'bg-purple-900/20 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.15)]' : 'bg-[#1e293b]/50 border-slate-700/50 hover:bg-[#1e293b] hover:border-slate-600'}`}>
                                                    {isSelected && <CheckCircle2 size={15} className="absolute top-2 right-2 text-purple-400" />}
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isSelected ? 'bg-purple-500/20' : 'bg-slate-800'}`}>
                                                            <User size={15} className={isSelected ? 'text-purple-400' : 'text-slate-400'} />
                                                        </div>
                                                        <p className={`text-xs font-bold truncate flex-1 min-w-0 ${isSelected ? 'text-purple-300' : 'text-slate-200 group-hover:text-white'}`}>{voice.name}</p>
                                                    </div>
                                                    {voice.labels && Object.values(voice.labels).filter(Boolean).length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mb-6">
                                                            {Object.values(voice.labels).filter(Boolean).slice(0, 3).map((tag, i) => (
                                                                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-400 font-medium">{tag}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {voice.preview_url && (
                                                        <button onClick={e => handleElPreview(e, voice)} className={`absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow ${isPreviewing ? 'bg-amber-500 text-white animate-pulse' : 'bg-purple-700 text-white opacity-0 group-hover:opacity-100 hover:bg-purple-600'}`}>
                                                            {isPreviewing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: GEMINI TTS  ══════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'gemini' && (
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">

                    {/* ── CỘT TRÁI: INPUT + CONTROLS ───────────────────────── */}
                    <div className="flex-1 flex flex-col gap-3 min-h-0 min-w-0">

                        {/* API Key status + info (compact 1 row) */}
                        <div className="bg-[#141c2f] border border-blue-500/20 rounded-xl px-4 py-2.5 flex items-center gap-3 shrink-0">
                            <Sparkles size={13} className="text-blue-400 shrink-0" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Gemini 2.5 Flash TTS</span>
                            <span className="text-slate-700">·</span>
                            {(() => {
                                const keys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
                                return keys.length > 0
                                    ? <span className="text-[10px] text-emerald-400 font-bold">✅ {keys.length} API Key sẵn sàng</span>
                                    : <span className="text-[10px] text-red-400 font-bold">⚠️ Chưa có API Key — vào Creator để thêm</span>;
                            })()}
                            {gmQuota && (
                                <button onClick={refreshGmQuota} title="Click để làm mới" className="flex items-center gap-2 ml-2 bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1 hover:bg-slate-700/60 transition-all">
                                    <span className="text-[9px] text-slate-400">Hôm nay:</span>
                                    <span className={`text-[9px] font-bold ${gmQuota.available > gmQuota.total * 0.3 ? 'text-emerald-400' : gmQuota.available > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                                        {gmQuota.available}/{gmQuota.total} key
                                    </span>
                                    <span className="text-[9px] text-slate-500">·</span>
                                    <span className="text-[9px] text-blue-300 font-bold">~{gmQuota.minutesRemaining >= 60
                                        ? `${Math.floor(gmQuota.minutesRemaining/60)}h${gmQuota.minutesRemaining%60}p`
                                        : `${gmQuota.minutesRemaining}p`} audio</span>
                                    <span className="text-[9px] text-slate-500">·</span>
                                    <span className="text-[9px] text-slate-400">{(gmQuota.charsRemaining/1000).toFixed(0)}k ký tự</span>
                                </button>
                            )}
                            <span className="ml-auto text-[9px] text-slate-600">WAV 24kHz · Free quota · 28 giọng</span>
                        </div>

                        {/* Textarea — chiếm toàn bộ không gian còn lại */}
                        <div className={`flex-1 flex flex-col bg-[#141c2f] rounded-xl overflow-hidden border transition-colors min-h-0 ${gmSrtSegments && gmSrtSegments.length > 0 ? 'border-blue-500/30' : 'border-slate-800'}`}>
                            <div className={`flex justify-between items-center px-4 py-2.5 border-b shrink-0 transition-colors ${gmSrtSegments && gmSrtSegments.length > 0 ? 'border-blue-500/20 bg-[#1a233a]/60' : 'border-slate-800/50'}`}>
                                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                    <Volume2 size={13} className="text-blue-400"/> Văn bản cần đọc
                                </label>
                                <div className="flex items-center gap-2">
                                    {gmSrtSegments && gmSrtSegments.length > 0 && (() => {
                                        const info = formatSRTInfo(gmSrtSegments);
                                        return (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[10px] px-2 py-0.5 bg-blue-900/50 border border-blue-600/40 text-blue-300 rounded-full font-bold">
                                                    📋 SRT · {info.count} đoạn · {info.duration}
                                                </span>
                                                <button onClick={() => { setGmText(gmSrtSegments.map(s => s.text).join('\n')); setGmSrtSegments(null); }}
                                                    className="text-[10px] px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">Lọc text</button>
                                            </div>
                                        );
                                    })()}
                                    <span className="text-[10px] text-slate-500 font-mono">{gmText.length} ký tự</span>
                                </div>
                            </div>
                            <textarea
                                value={gmText}
                                onChange={e => {
                                    const val = e.target.value;
                                    setGmText(val);
                                    if (isSRTContent(val)) {
                                        const segs = parseSRT(val);
                                        setGmSrtSegments(segs.length > 0 ? segs : null);
                                    } else { setGmSrtSegments(null); }
                                }}
                                placeholder="Nhập hoặc dán nội dung cần đọc vào đây...&#10;&#10;💡 Hỗ trợ file .SRT — tự động nhận diện timestamp và đồng bộ giọng với mốc thời gian."
                                className="flex-1 w-full bg-transparent p-4 text-sm text-slate-200 focus:outline-none resize-none leading-relaxed custom-scrollbar"
                            />
                            {gmSrtSegments && gmSrtSegments.length > 0 && gmSrtProgress.total > 0 && (
                                <div className="px-4 pb-2 shrink-0">
                                    <div className="flex justify-between text-[10px] text-blue-400 font-bold mb-1">
                                        <span className="truncate">{gmSrtProgress.text}</span>
                                        <span className="shrink-0 ml-2">{gmSrtProgress.done}/{gmSrtProgress.total}</span>
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${gmSrtProgress.total > 0 ? (gmSrtProgress.done / gmSrtProgress.total) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Output settings (compact 2 cột) */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-3 shrink-0">
                            <div className="flex gap-3">
                                <input type="text" value={gmProjectName} onChange={e => setGmProjectName(e.target.value)}
                                    placeholder="Tên file (VD: truyen_tap1.mp3 hoặc .wav)"
                                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors" />
                                <input type="text" readOnly value={gmOutputFolder} placeholder="Thư mục lưu..."
                                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 truncate focus:outline-none" />
                                <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setGmOutputFolder(f); }}
                                    className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg transition-colors shrink-0" title="Chọn thư mục">
                                    <FolderOpen size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Nút tạo */}
                        <div className="relative shrink-0">
                            {gmIsGenerating && (gmSrtProgress.total > 0 || gmTextProgress.total > 0) && (
                                <div className="absolute -top-5 left-0 right-0 flex justify-between text-xs font-bold text-blue-400">
                                    {gmSrtSegments && gmSrtProgress.total > 0 ? (
                                        <><span className="truncate">{gmSrtProgress.text}</span><span className="shrink-0 ml-2">{gmSrtProgress.done}/{gmSrtProgress.total}</span></>
                                    ) : gmTextProgress.total > 0 ? (
                                        <><span className="truncate">Đoạn {gmTextProgress.done + 1}/{gmTextProgress.total}: {gmTextProgress.text}</span><span className="shrink-0 ml-2">{Math.round((gmTextProgress.done / gmTextProgress.total) * 100)}%</span></>
                                    ) : null}
                                </div>
                            )}
                            <button onClick={handleGmGenerate}
                                disabled={gmIsGenerating || (!gmSrtSegments && !gmText.trim())}
                                className="relative w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg overflow-hidden
                                    bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500
                                    disabled:from-slate-700 disabled:to-slate-700 disabled:shadow-none text-white">
                                {gmIsGenerating && (gmSrtProgress.total > 0 || gmTextProgress.total > 0) && (
                                    <div className="absolute left-0 top-0 bottom-0 bg-white/10 transition-all duration-300"
                                        style={{ width: `${gmSrtSegments ? (gmSrtProgress.done / gmSrtProgress.total) * 100 : gmTextProgress.total > 0 ? (gmTextProgress.done / gmTextProgress.total) * 100 : 0}%` }} />
                                )}
                                <span className="relative z-10 flex items-center gap-2">
                                    {gmIsGenerating
                                        ? <><Loader2 size={18} className="animate-spin"/>
                                            {gmSrtSegments ? `ĐANG TẠO SRT ${gmSrtProgress.done}/${gmSrtProgress.total}...`
                                            : gmTextProgress.total > 0 ? `ĐANG TẠO ${gmTextProgress.done}/${gmTextProgress.total} ĐOẠN...`
                                            : 'ĐANG TẠO GIỌNG...'}</>
                                        : <><Sparkles size={18}/>
                                            {gmSrtSegments ? `📋 TẠO SRT VOICE (${gmSrtSegments.length} đoạn)` : 'BẮT ĐẦU TẠO GIỌNG ĐỌC'}</>
                                    }
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* ── CỘT PHẢI: THƯ VIỆN GIỌNG + LỊCH SỬ ─────────────── */}
                    <div className="w-[400px] shrink-0 flex flex-col gap-4 min-h-0">

                        {/* Thư viện giọng */}
                        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col overflow-hidden min-h-0">
                            {/* Header thư viện */}
                            <div className="px-4 py-3 border-b border-slate-800 bg-[#1a233a] shrink-0">
                                <div className="flex items-center justify-between mb-2.5">
                                    <h3 className="text-sm font-bold text-white">Thư viện Giọng Gemini</h3>
                                    <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-800 text-slate-400 rounded-lg border border-slate-700">
                                        {GEMINI_VOICES.filter(v => gmGenderFilter === 'all' || v.gender === gmGenderFilter).length} / {GEMINI_VOICES.length} giọng
                                    </span>
                                </div>
                                {/* Đang chọn */}
                                {gmVoice && (() => {
                                    const selected = GEMINI_VOICES.find(v => v.id === gmVoice);
                                    return selected ? (
                                        <div className="flex items-center gap-2 mb-2.5 bg-blue-900/20 border border-blue-500/30 rounded-lg px-3 py-1.5">
                                            <span className="text-sm">{selected.gender === 'female' ? '👩' : selected.gender === 'male' ? '👨' : '🧑'}</span>
                                            <span className="text-xs font-bold text-blue-300">{selected.id}</span>
                                            <span className="text-[10px] text-slate-400">—</span>
                                            <span className="text-[10px] text-slate-400 flex-1 truncate">{selected.style}</span>
                                            <CheckCircle2 size={13} className="text-blue-400 shrink-0" />
                                        </div>
                                    ) : null;
                                })()}
                                {/* Bộ lọc giới tính */}
                                <div className="flex gap-1">
                                    {[['all','Tất cả'],['female','Nữ'],['male','Nam'],['neutral','Trung tính']].map(([v, l]) => (
                                        <button key={v} onClick={() => setGmGenderFilter(v)}
                                            className={`flex-1 py-1 rounded text-[10px] font-bold border transition-colors ${gmGenderFilter === v ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                                            {l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Danh sách voice cards */}
                            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar bg-[#0f172a]/20">
                                <div className="grid grid-cols-2 gap-2">
                                    {GEMINI_VOICES
                                        .filter(v => gmGenderFilter === 'all' || v.gender === gmGenderFilter)
                                        .map(v => {
                                            const isSelected = gmVoice === v.id;
                                            const isPreviewing = gmPreviewingVoice === v.id;
                                            const genderIcon = v.gender === 'female' ? '👩' : v.gender === 'male' ? '👨' : '🧑';
                                            const iconColor = v.gender === 'female' ? 'text-pink-400' : v.gender === 'male' ? 'text-blue-400' : 'text-slate-400';
                                            return (
                                                <div key={v.id}
                                                    onClick={() => setGmVoice(v.id)}
                                                    className={`relative group flex items-start gap-2 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${isSelected ? 'bg-blue-900/20 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.12)]' : 'bg-[#1e293b]/50 border-slate-700/50 hover:bg-[#1e293b] hover:border-slate-600'}`}>
                                                    {isSelected && <CheckCircle2 size={13} className="absolute top-2 right-2 text-blue-400" />}
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm border ${isSelected ? 'bg-blue-500/20 border-blue-500/30' : 'bg-slate-800 border-slate-700'}`}>
                                                        {genderIcon}
                                                    </div>
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <p className={`text-xs font-bold truncate ${isSelected ? 'text-blue-300' : 'text-slate-200 group-hover:text-white'}`}>{v.id}</p>
                                                        <p className="text-[9px] text-slate-500 truncate mt-0.5">{v.style}</p>
                                                        <span className={`text-[8px] px-1 py-0.5 rounded-full font-bold mt-1 inline-block ${v.gender === 'female' ? 'bg-pink-900/40 text-pink-400' : v.gender === 'male' ? 'bg-blue-900/40 text-blue-400' : 'bg-slate-700 text-slate-400'}`}>
                                                            {v.gender === 'female' ? 'Nữ' : v.gender === 'male' ? 'Nam' : 'Trung tính'}
                                                        </span>
                                                    </div>
                                                    {/* Nút nghe thử */}
                                                    <button
                                                        onClick={e => handleGmPreview(e, v.id)}
                                                        title="Nghe thử giọng"
                                                        className={`absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all border text-[10px] ${
                                                            isPreviewing
                                                                ? 'bg-amber-500 border-amber-400 text-white animate-pulse'
                                                                : 'bg-blue-700 border-blue-600 text-white opacity-0 group-hover:opacity-100 hover:bg-blue-500'
                                                        }`}>
                                                        {isPreviewing ? <Pause size={9} fill="currentColor"/> : <Play size={9} fill="currentColor" className="ml-px"/>}
                                                    </button>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            </div>
                        </div>

                        {/* Lịch sử (compact phía dưới) */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col overflow-hidden shrink-0" style={{ maxHeight: '180px' }}>
                            <div className="px-4 py-2.5 border-b border-slate-800 bg-[#1a233a] flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-2">
                                    <History size={13} className="text-blue-400"/>
                                    <span className="text-xs font-bold text-white">Lịch sử tạo giọng</span>
                                    {gmHistory.length > 0 && <span className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded-full">{gmHistory.length}</span>}
                                </div>
                                {gmHistory.length > 0 && (
                                    <button onClick={() => saveGmHistory([])}
                                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-slate-700">
                                        <Trash2 size={10}/> Xóa
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {gmHistory.length === 0 ? (
                                    <p className="text-center text-[11px] text-slate-600 mt-4">Chưa có file nào.</p>
                                ) : gmHistory.map(item => (
                                    <div key={item.id} className="flex items-center gap-2 p-2 hover:bg-[#1e293b] rounded-lg border-b border-slate-800/50 last:border-0 group transition-colors">
                                        <button onClick={() => handleGmPlay(item)}
                                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${gmPlayingId === item.id ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white'}`}>
                                            {gmPlayingId === item.id ? <Pause size={11} fill="currentColor"/> : <Play size={11} fill="currentColor" className="ml-px"/>}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-200 truncate">{item.name}</p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="text-[9px] bg-blue-900/40 border border-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded-full shrink-0">{item.voice}</span>
                                                <span className="text-[9px] text-slate-600 truncate">{item.time}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => window.electronAPI.openFile(item.path)} title="Mở file"
                                                className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"><Download size={11}/></button>
                                            <button onClick={() => window.electronAPI.openFolder(item.path.substring(0, item.path.lastIndexOf('\\')))} title="Mở thư mục"
                                                className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"><FolderOpen size={11}/></button>
                                            <button onClick={() => saveGmHistory(gmHistory.filter(h => h.id !== item.id))} title="Xóa"
                                                className="p-1 rounded bg-slate-700 hover:bg-red-600 text-slate-400 hover:text-white transition-colors"><Trash2 size={11}/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  LOG PANEL (shared, collapsible) ══════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            <div
                className="shrink-0 border-t border-slate-800 bg-[#0d1525] transition-all duration-200 overflow-hidden"
                style={{ height: logOpen ? '210px' : '36px' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 h-9 cursor-pointer select-none hover:bg-slate-800/40 transition-colors"
                    onClick={() => setLogOpen(v => !v)}>
                    <div className="flex items-center gap-2">
                        <Terminal size={13} className="text-slate-500" />
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Nhật ký Voice Studio</span>
                        {voiceLogs.length > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded-full font-mono">{voiceLogs.length}</span>
                        )}
                        {!logOpen && voiceLogs.some(l => l.type === 'error') && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        )}
                        {!logOpen && voiceLogs.some(l => l.type === 'warn') && !voiceLogs.some(l => l.type === 'error') && (
                            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {logOpen && voiceLogs.length > 0 && (
                            <button onClick={e => { e.stopPropagation(); setVoiceLogs([]); }}
                                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-slate-700">
                                <X size={10} /> Xóa log
                            </button>
                        )}
                        {logOpen ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronUp size={13} className="text-slate-500" />}
                    </div>
                </div>

                {/* Log entries */}
                {logOpen && (
                    <div className="h-[174px] overflow-y-auto px-4 py-1 custom-scrollbar font-mono text-[11px] space-y-0.5">
                        {voiceLogs.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-slate-600 text-xs gap-2">
                                <Terminal size={14} /> Chưa có log nào. Bắt đầu tạo giọng để xem log.
                            </div>
                        ) : voiceLogs.map(log => (
                            <div key={log.id} className="flex items-start gap-2 py-0.5 border-b border-slate-800/30 last:border-0">
                                <span className="text-slate-600 shrink-0 text-[10px] mt-0.5">{log.time}</span>
                                <span className={`flex-1 leading-relaxed break-all ${
                                    log.type === 'error' ? 'text-red-400' :
                                    log.type === 'warn'  ? 'text-yellow-400' :
                                    log.type === 'success' ? 'text-emerald-400' :
                                    'text-slate-400'
                                }`}>
                                    {log.type === 'error' && <AlertCircle size={10} className="inline mr-1 mb-0.5" />}
                                    {log.text}
                                </span>
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                )}
            </div>

            {subTab === 'chatterbox_removed' && (
            <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
              {/* ── CỘT TRÁI ─────────────────────────────────────────────────── */}
              <div className="flex flex-col w-[45%] shrink-0 min-h-0 gap-4">
                {/* Header */}
                <div className="flex items-center gap-3 bg-[#141c2f] p-4 rounded-xl border border-slate-800 shrink-0">
                  <div className="w-10 h-10 bg-teal-500/10 rounded-lg flex items-center justify-center text-teal-400 shrink-0"><Volume2 size={20}/></div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Chatterbox TTS</h2>
                    <p className="text-[10px] text-slate-500">Resemble AI · Open-source · Voice Cloning · 22 ngôn ngữ</p>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${cbConnected ? 'bg-emerald-900/40 text-emerald-400' : cbStarting ? 'bg-amber-900/40 text-amber-400' : 'bg-slate-800 text-slate-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cbConnected ? 'bg-emerald-400' : cbStarting ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}/>
                    {cbConnected ? 'Sẵn sàng' : cbStarting ? 'Đang khởi động...' : cbInstalled ? 'Chưa chạy' : 'Chưa cài'}
                  </div>
                </div>

                {/* INSTALL PANEL */}
                {!cbInstalled && !cbInstalling && (
                <div className="bg-[#141c2f] p-5 rounded-xl border border-teal-800/40 shrink-0 space-y-3">
                  <p className="text-sm font-bold text-slate-200">Cài đặt Chatterbox TTS</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    App sẽ tự tải về và cài đặt Python 3.10, Chatterbox-TTS-Server và model (~2GB lần đầu). Chỉ cần nhấn nút bên dưới.
                  </p>
                  {cbInstallErr && <p className="text-[11px] text-red-400">{cbInstallErr}</p>}
                  <button onClick={cbInstall}
                    className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-[13px] font-bold rounded-lg transition-colors">
                    ▶ Cài Chatterbox TTS (tự động)
                  </button>
                </div>
                )}

                {/* INSTALLING PROGRESS */}
                {cbInstalling && (
                <div className="bg-[#141c2f] p-5 rounded-xl border border-teal-800/40 shrink-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-bold text-teal-300">{cbInstallMsg || 'Đang cài đặt...'}</p>
                    <span className="text-[11px] text-slate-400">{cbInstallPct}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div className="bg-teal-500 h-2 rounded-full transition-all duration-300" style={{width: `${cbInstallPct}%`}}/>
                  </div>
                  <button onClick={() => window.electronAPI?.chatterboxCancelSetup?.()}
                    className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 text-[11px] rounded-lg transition-colors">
                    Hủy
                  </button>
                </div>
                )}

                {/* VOICE CONFIG — chỉ hiện khi đã cài và đang chạy */}
                {cbInstalled && cbConnected && (
                <div className="bg-[#141c2f] p-4 rounded-xl border border-slate-800 shrink-0 space-y-3">
                  <div className="flex gap-2">
                    <button onClick={() => setCbVoiceMode('predefined')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${cbVoiceMode==='predefined'?'bg-teal-600 text-white':'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>🎙 Giọng có sẵn</button>
                    <button onClick={() => setCbVoiceMode('clone')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${cbVoiceMode==='clone'?'bg-teal-600 text-white':'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>🔊 Clone giọng</button>
                  </div>
                  {cbVoiceMode === 'predefined' && (
                    <select value={cbSelVoice} onChange={e => setCbSelVoice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-teal-500">
                      <option value="">-- Chọn giọng preset --</option>
                      {cbPredefined.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      {cbPredefined.length===0 && <option disabled>Chưa có preset (thêm WAV vào thư mục voices/)</option>}
                    </select>
                  )}
                  {cbVoiceMode === 'clone' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select value={cbSelRef} onChange={e => setCbSelRef(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-teal-500">
                        <option value="">-- Chọn audio tham chiếu --</option>
                        {cbRefFiles.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <button onClick={cbUploadRef} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[11px] font-bold rounded-lg whitespace-nowrap">↑ Upload</button>
                    </div>
                    <p className="text-[10px] text-slate-600">Audio ~10-30s làm giọng tham chiếu để clone</p>
                  </div>
                  )}
                </div>
                )}

                {/* PARAMS */}
                {cbInstalled && cbConnected && (
                <div className="bg-[#141c2f] p-4 rounded-xl border border-slate-800 shrink-0 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Ngôn ngữ</label>
                      <select value={cbLang} onChange={e => setCbLang(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-teal-500">
                        <option value="vi">🇻🇳 Tiếng Việt</option>
                        <option value="en">🇺🇸 English</option>
                        <option value="zh">🇨🇳 中文</option>
                        <option value="ja">🇯🇵 日本語</option>
                        <option value="ko">🇰🇷 한국어</option>
                        <option value="fr">🇫🇷 Français</option>
                        <option value="de">🇩🇪 Deutsch</option>
                        <option value="es">🇪🇸 Español</option>
                        <option value="ru">🇷🇺 Русский</option>
                        <option value="ar">🇸🇦 العربية</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Tốc độ: {cbSpeed.toFixed(2)}×</label>
                      <input type="range" min="0.5" max="2" step="0.05" value={cbSpeed} onChange={e => setCbSpeed(parseFloat(e.target.value))} className="w-full accent-teal-500"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Diễn cảm: {cbExag.toFixed(2)}</label>
                      <input type="range" min="0" max="2" step="0.05" value={cbExag} onChange={e => setCbExag(parseFloat(e.target.value))} className="w-full accent-teal-500"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">Temperature: {cbTemp.toFixed(2)}</label>
                      <input type="range" min="0" max="1.5" step="0.05" value={cbTemp} onChange={e => setCbTemp(parseFloat(e.target.value))} className="w-full accent-teal-500"/>
                    </div>
                  </div>
                </div>
                )}

                {cbInstalled && cbConnected && (
                  <button onClick={cbStopServer} className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-slate-300 text-[11px] rounded-lg shrink-0">■ Dừng server</button>
                )}

                {cbInstalled && !cbConnected && !cbStarting && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={cbStartAndConnect} className="flex-1 py-2 bg-teal-700 hover:bg-teal-600 text-white text-[12px] font-bold rounded-lg">▶ Khởi động server</button>
                    <button onClick={async () => {
                      setCbInstalling(true); setCbInstallMsg('Đang repair...'); setCbInstallPct(0);
                      await window.electronAPI?.chatterboxRepair?.();
                      setCbInstalling(false);
                    }} className="px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg">🔧 Repair</button>
                  </div>
                )}
                {cbStartError && <p className="text-[11px] text-red-400 shrink-0">{cbStartError}</p>}
              </div>

              {/* ── CỘT PHẢI ────────────────────────────────────────────────────── */}
              <div className="flex flex-col flex-1 min-h-0 gap-4">
                <div className="flex flex-col flex-1 bg-[#141c2f] rounded-xl border border-slate-800 p-4 min-h-0">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 shrink-0">Văn bản cần đọc</label>
                  <textarea value={cbText} onChange={e => setCbText(e.target.value)}
                    placeholder="Nhập văn bản tiếng Việt hoặc ngôn ngữ khác..."
                    className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 text-[12px] text-slate-200 resize-none focus:outline-none focus:border-teal-500 min-h-0"/>
                  <div className="flex items-center justify-between mt-2 shrink-0">
                    <span className="text-[10px] text-slate-600">{cbText.length} ký tự</span>
                    <button onClick={cbGenerate} disabled={cbGenerating || !cbConnected || !cbText.trim()}
                      className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-[12px] font-bold rounded-lg transition-colors">
                      {cbGenerating ? <><Loader2 size={13} className="animate-spin"/> Đang tạo...</> : <><Play size={13}/> Tạo giọng</>}
                    </button>
                  </div>
                </div>

                {cbAudioUrl && (
                <div className="bg-[#141c2f] rounded-xl border border-teal-800/40 p-4 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold text-teal-400 uppercase tracking-wider">Kết quả</label>
                    {!cbOutputFolder
                      ? <button onClick={async()=>{const f=await window.electronAPI?.selectFolder?.();if(f)setCbOutputFolder(f);}} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] font-bold rounded">📁 Chọn thư mục lưu</button>
                      : <span className="text-[10px] text-slate-500 truncate max-w-[200px]">💾 {cbOutputFolder}</span>
                    }
                  </div>
                  <audio ref={cbAudioRef} src={cbAudioUrl} controls className="w-full h-9" style={{filter:'invert(0.85) hue-rotate(180deg)'}}/>
                </div>
                )}

                <div className="bg-[#0a0f1c] rounded-xl border border-slate-800/60 p-3 flex-1 overflow-y-auto min-h-0 max-h-52">
                  <p className="text-[10px] text-slate-600 font-bold mb-1 uppercase tracking-wider">Server Log</p>
                  {cbLogs.length===0 && <p className="text-[10px] text-slate-700 italic">{cbInstalled?'Chưa có log...':'Nhấn cài đặt để bắt đầu...'}</p>}
                  {cbLogs.map((e,i) => (
                    <p key={i} className={`text-[10px] font-mono leading-relaxed ${e.level==='error'?'text-red-400':e.level==='warn'?'text-amber-400':'text-slate-500'}`}>{e.text}</p>
                  ))}
                </div>
              </div>
            </div>
            )}
            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: VIENEU TTS  ══════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'vieneu' && (
            <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
              {/* CỘT TRÁI */}
              <div className="flex flex-col w-[45%] h-full shrink-0 min-h-0 gap-4 overflow-y-auto pr-1">

                {/* Header */}
                <div className="flex items-center gap-3 bg-[#141c2f] p-4 rounded-xl border border-slate-800 shadow-sm shrink-0">
                  <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center text-orange-500 shrink-0"><Mic size={20}/></div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">VieNeu TTS</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Giọng Việt tự nhiên · On-device · Voice Cloning</p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${vnReady ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${vnReady ? 'bg-emerald-400' : 'bg-slate-500'}`}/>
                      {vnReady ? 'Sẵn sàng' : 'Chưa cài'}
                    </span>
                    {vnReady && vnGpuType && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                        vnGpuUpgrading ? 'bg-blue-500/10 text-blue-400 border-blue-700/30 animate-pulse' :
                        vnGpuType === 'nvidia' ? 'bg-green-500/10 text-green-400 border-green-700/30' :
                        vnGpuType === 'amd' ? 'bg-orange-500/10 text-orange-400 border-orange-700/30' :
                        vnGpuType === 'intel_arc' ? 'bg-blue-500/10 text-blue-400 border-blue-700/30' :
                        'bg-slate-700 text-slate-400 border-slate-600'}`}>
                        {vnGpuUpgrading ? '⏳ Đang quét GPU...' :
                         vnGpuType === 'nvidia' ? '🎮 CUDA' :
                         vnGpuType === 'amd' ? '🎮 DirectML' :
                         vnGpuType === 'intel_arc' ? '🎮 DirectML' : '🖥️ CPU'}
                      </span>
                    )}
                    {vnReady && (
                      <>
                      <button onClick={async () => {
                        setVnGpuUpgrading(true);
                        const res = await window.electronAPI?.vieNeuUpgradeGpu?.();
                        setVnGpuUpgrading(false);
                        if (res?.ok) { setVnGpuType(res.gpuType || 'cpu'); alert(res.gpuType === 'cpu' ? '⚠️ Không tìm thấy GPU tương thích' : `✅ Đã nâng cấp lên ${res.gpuType === 'nvidia' ? 'CUDA' : 'DirectML'}`); }
                        else alert('❌ ' + (res?.error || 'Lỗi'));
                      }} disabled={vnGpuUpgrading}
                        title="Tự động quét GPU và cài onnxruntime phù hợp (CUDA/DirectML/CPU)"
                        className="text-[10px] px-2 py-1 rounded bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-700/30 transition-colors font-bold disabled:opacity-50">
                        🎮 Quét GPU
                      </button>
                      <button onClick={async () => {
                        const logs = [];
                        window.electronAPI?.onVieNeuRepairLog?.((d) => logs.push(d.msg));
                        const r = await window.electronAPI?.vieNeuRepairTorch?.();
                        alert(r?.success ? '✅ ' + (r.message || 'Sửa xong!') : '❌ ' + (r?.error || 'Lỗi'));
                      }} title="Sửa lỗi torch/torchaudio (dùng khi báo No module named torch)"
                        className="text-[10px] px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 border border-amber-700/30 transition-colors font-bold">
                        🔧 Sửa Torch
                      </button>
                      </>
                    )}
                    <button onClick={async () => {
                      if (!confirm('Xóa sạch toàn bộ VieNeu và cài lại từ đầu?\n(Mất ~10-15 phút tải lại)')) return;
                      const r = await window.electronAPI?.vieNeuReset?.();
                      if (r?.success) {
                        setVnReady(false); setVnVoices([]); setVnError('');
                      } else {
                        alert('❌ Lỗi xóa: ' + (r?.error || 'Unknown'));
                      }
                    }} title="Xóa sạch và cài lại VieNeu từ đầu"
                      className="text-[10px] px-2 py-1 rounded bg-red-900/30 hover:bg-red-800/50 text-red-400 border border-red-800/30 transition-colors font-bold">
                      🗑️ Cài lại
                    </button>
                  </div>
                </div>

                {/* Setup panel — hiện khi chưa cài */}
                {!vnReady && (
                  <div className="bg-[#141c2f] rounded-xl border border-slate-800 p-5 shrink-0 space-y-4">
                    <div>
                      <p className="text-sm text-slate-300 mb-0.5 font-semibold">Cài đặt VieNeu lần đầu</p>
                      <p className="text-xs text-slate-500">Tool tự tải Python + vieneu + model. Chỉ làm 1 lần, lần sau mở là dùng ngay.</p>
                    </div>

                    {/* Model selection */}
                    {!vnInstalling && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chọn model</p>
                        {[
                          { id: 'q4',      label: 'GGUF Q4',      size: '~200MB', speed: 'Nhanh nhất',  quality: 'Tốt',       badge: 'Khuyến nghị', badgeColor: 'bg-emerald-500/20 text-emerald-400' },
                          { id: 'q8',      label: 'GGUF Q8',      size: '~400MB', speed: 'Nhanh',       quality: 'Tốt hơn',   badge: '',            badgeColor: '' },
                          { id: 'pytorch', label: '0.5B PyTorch',  size: '~1GB',   speed: 'Chậm hơn',   quality: 'Tốt nhất',  badge: 'Nặng',        badgeColor: 'bg-amber-500/20 text-amber-400' },
                        ].map(m => (
                          <label key={m.id} onClick={() => setVnModel(m.id)}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${vnModel === m.id ? 'border-orange-500/60 bg-orange-500/10' : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'}`}>
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${vnModel === m.id ? 'border-orange-500' : 'border-slate-600'}`}>
                              {vnModel === m.id && <div className="w-2 h-2 rounded-full bg-orange-500"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-200">{m.label}</span>
                                {m.badge && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${m.badgeColor}`}>{m.badge}</span>}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">{m.size} · {m.speed} · Chất lượng: {m.quality}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Progress / button */}
                    {vnInstalling ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{vnSetupMsg || 'Đang cài...'}</span>
                          <span>{vnSetupPct}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2">
                          <div className="bg-orange-500 h-2 rounded-full transition-all" style={{ width: `${vnSetupPct}%` }}/>
                        </div>
                        <button onClick={() => { window.electronAPI?.vieNeuCancelSetup?.(); setVnInstalling(false); }}
                          className="text-xs text-slate-500 hover:text-rose-400">Hủy</button>
                      </div>
                    ) : (
                      <button onClick={async () => {
                        setVnInstalling(true); setVnError('');
                        const r = await window.electronAPI?.vieNeuSetup?.({ model: vnModel });
                        setVnInstalling(false);
                        if (r?.success) {
                          setVnReady(true);
                          const vr = await window.electronAPI?.vieNeuGetVoices?.();
                          if (vr?.voices?.length) setVnVoices(vr.voices);
                        } else { setVnError(r?.error || 'Lỗi cài đặt'); }
                      }} className="w-full py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold flex items-center justify-center gap-2">
                        <Download size={14}/>
                        Cài VieNeu · {vnModel === 'q4' ? '~200MB' : vnModel === 'q8' ? '~400MB' : '~1GB'}
                      </button>
                    )}
                    {vnError && <p className="text-xs text-rose-400">{vnError}</p>}
                    {!vnInstalling && (
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (!confirm('Xóa sạch toàn bộ VieNeu (nếu đang cài dở) và bắt đầu lại từ đầu?')) return;
                          await window.electronAPI?.vieNeuReset?.();
                          setVnError('✅ Đã xóa sạch — bấm "Cài VieNeu" để cài lại');
                        }} className="py-2 px-3 rounded-lg bg-red-900/30 hover:bg-red-800/50 text-red-400 text-xs font-bold border border-red-800/30">
                          🗑️ Xóa & Cài lại
                        </button>
                        <button onClick={async () => {
                          setVnError('🔍 Đang tìm cài đặt VieNeu trên máy...');
                          const r = await window.electronAPI?.vieNeuFindInstall?.();
                          if (r?.found) {
                            setVnError('');
                            setVnReady(true);
                            const vr = await window.electronAPI?.vieNeuGetVoices?.();
                            if (vr?.voices?.length) setVnVoices(vr.voices);
                          } else {
                            setVnError('Không tìm thấy. Thử chọn thủ công →');
                          }
                        }} className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1">
                          🔍 Tự tìm cài đặt cũ
                        </button>
                        <button onClick={async () => {
                          const dir = await window.electronAPI?.selectFolder?.();
                          if (!dir) return;
                          const r = await window.electronAPI?.vieNeuSetDir?.(dir);
                          if (r?.success && r?.installed) {
                            setVnReady(true); setVnError('');
                            const vr = await window.electronAPI?.vieNeuGetVoices?.();
                            if (vr?.voices?.length) setVnVoices(vr.voices);
                          } else {
                            setVnError('Không thấy VieNeu trong thư mục này');
                          }
                        }} className="py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold">
                          📂
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Text input */}
                {vnReady && (<>
                  {/* Mode toggle */}
                  <div className="flex gap-1.5 shrink-0">
                    {[{id:'text',label:'📝 Văn bản'},{id:'srt',label:'📋 File SRT'}].map(m=>(
                      <button key={m.id} onClick={()=>setVnMode(m.id)}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${vnMode===m.id ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800/50 border-slate-700/40 text-slate-500 hover:text-slate-300'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {vnMode === 'text' ? (
                  <div className="flex flex-col gap-2 shrink-0">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nội dung</label>
                    <textarea value={vnText} onChange={e => setVnText(e.target.value)} rows={6}
                      placeholder="Nhập văn bản tiếng Việt cần chuyển thành giọng nói..."
                      className="w-full bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 resize-none focus:outline-none focus:border-orange-500/60"/>
                    <div className="text-right text-xs text-slate-600">{vnText.length} ký tự</div>
                  </div>
                  ) : (
                  <div className="flex flex-col gap-3 shrink-0">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">File SRT</label>
                    <div className="flex gap-2">
                      <input readOnly value={vnSrtFile} placeholder="Chưa chọn file SRT..."
                        className="flex-1 bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 truncate"/>
                      <button onClick={async () => {
                        const f = await window.electronAPI?.selectFile?.('srt');
                        if (!f) return;
                        setVnSrtFile(f);
                        const content = await window.electronAPI?.readTextFile?.(f);
                        const segs = content ? parseSRT(content) : [];
                        setVnSrtSegments(segs);
                        setVnLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] 📋 Đã tải SRT: ${segs.length} đoạn · ${f.split(/[\\/]/).pop()}`]);
                      }} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-300 flex items-center gap-1.5 shrink-0">
                        <FolderOpen size={13}/> Chọn SRT
                      </button>
                    </div>
                    {vnSrtSegments.length > 0 && (
                      <div className="bg-[#0a0f1c] border border-slate-800 rounded-lg p-3 space-y-1">
                        <p className="text-xs text-emerald-400 font-semibold">✅ {vnSrtSegments.length} đoạn phụ đề</p>
                        <p className="text-[10px] text-slate-500">Từ {(vnSrtSegments[0].startMs/1000).toFixed(2)}s → {(vnSrtSegments[vnSrtSegments.length-1].endMs/1000).toFixed(2)}s</p>
                        <div className="max-h-24 overflow-y-auto space-y-0.5 mt-2">
                          {vnSrtSegments.slice(0,5).map((s,i)=>(
                            <p key={i} className="text-[10px] text-slate-500 truncate">[{(s.startMs/1000).toFixed(1)}s] {s.text}</p>
                          ))}
                          {vnSrtSegments.length > 5 && <p className="text-[10px] text-slate-600">...và {vnSrtSegments.length-5} đoạn nữa</p>}
                        </div>
                      </div>
                    )}
                    {vnSrtProgress.total > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span className="truncate">{vnSrtProgress.text || 'Đang tổng hợp...'}</span>
                          <span className="shrink-0 ml-2">{vnSrtProgress.done}/{vnSrtProgress.total}</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                          <div className="bg-orange-500 h-1.5 rounded-full transition-all" style={{width:`${Math.round(vnSrtProgress.done/vnSrtProgress.total*100)}%`}}/>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Voice selector — ẩn khi đang dùng clone mode */}
                  {!vnCloneMode && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Giọng đọc</label>
                    <select value={vnSelectedVoice} onChange={e => setVnSelectedVoice(e.target.value)}
                      className="bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500/60">
                      <option value="">— Mặc định —</option>
                      {vnSavedVoices.length > 0 && (
                        <optgroup label="⭐ Giọng Clone (ưu tiên)">
                          {vnSavedVoices.map(v => (
                            <option key={`clone_${v.id}`} value={`clone:${v.id}`}>🎤 {v.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {vnVoices.length > 0 && (
                        <optgroup label="🔊 Giọng cố định (built-in)">
                          {vnVoices.map(([desc, id]) => (
                            <option key={id} value={id}>{desc}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  )}

                  {/* Voice clone toggle — chỉ text mode */}
                  {vnMode === 'text' && <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 shrink-0">
                    <label className="flex items-center gap-2 cursor-pointer mb-3">
                      <input type="checkbox" checked={vnCloneMode} onChange={e => setVnCloneMode(e.target.checked)} className="w-4 h-4 accent-orange-500"/>
                      <span className="text-sm font-semibold text-slate-300">Voice Cloning (clone giọng từ audio mẫu)</span>
                    </label>
                    {vnCloneMode && (
                      <div className="space-y-3 pl-1">
                        <div>
                          <p className="text-xs text-slate-500 mb-1.5">File audio mẫu (WAV, 3-10 giây, giọng rõ không nhạc nền)</p>
                          <div className="flex gap-2">
                            <input readOnly value={vnRefAudio} placeholder="Chưa chọn file..."
                              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400"/>
                            <button onClick={async () => {
                              const r = await window.electronAPI?.selectFile?.('audio');
                              if (!r) return;
                              setVnRefAudio(r);
                              setVnRefText('');
                              // Tìm đoạn thoại thật bằng Whisper, extract file tạm chuẩn format
                              setVnRefTranscribing(true);
                              try {
                                const res = await window.electronAPI?.vieNeuFindSpeechRef?.({ filePath: r });
                                if (res?.success) {
                                  setVnRefAudio(res.refPath);
                                  // Transcribe bằng Gemini dùng file nén nhỏ (tiết kiệm token)
                                  try {
                                    const txt = await transcribeAudioWithGemini(res.transcribePath || res.refPath);
                                    setVnRefText(txt);
                                  } catch(geminiErr) {
                                    // Fallback Whisper nếu không có Gemini key
                                    try {
                                      const NOISE = /^\s*(\[.*?\]\s*)+$/;
                                      const r2 = await window.electronAPI?.whisperTranscribeChunk?.({ filePath: res.refPath, startSec: 0, durationSec: 8 });
                                      if (r2?.success && r2.result) {
                                        const segs = r2.result?.segments || [];
                                        const txt2 = segs.filter(s => !NOISE.test((s.text||'').trim())).map(s => s.text.trim()).join(' ').trim()
                                          || (typeof r2.result === 'string' ? r2.result.trim() : '');
                                        setVnRefText(txt2);
                                      }
                                    } catch(_) {}
                                  }
                                } else {
                                  alert(res?.error || 'Không đọc được file audio.');
                                }
                              } catch(_) {}
                              finally { setVnRefTranscribing(false); }
                            }} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-300">
                              <FolderOpen size={13}/>
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 mb-1.5 flex items-center gap-2 flex-wrap">
                            Nội dung của audio mẫu
                            <span className="text-orange-400 font-semibold">*quan trọng để giọng giống*</span>
                            {vnRefTranscribing && <span className="flex items-center gap-1 text-blue-400"><Loader2 size={10} className="animate-spin"/>Đang phân tích...</span>}
                            {!vnRefTranscribing && vnRefAudio && (
                              <button onClick={async () => {
                                setVnRefTranscribing(true);
                                try {
                                  const txt = await transcribeAudioWithGemini(vnRefAudio);
                                  setVnRefText(txt);
                                } catch(e) {
                                  // Fallback Whisper
                                  try {
                                    const NOISE = /^\s*(\[.*?\]\s*)+$/;
                                    const r2 = await window.electronAPI?.whisperTranscribeChunk?.({ filePath: vnRefAudio, startSec: 0, durationSec: 8 });
                                    if (r2?.success && r2.result) {
                                      const segs = r2.result?.segments || [];
                                      const txt2 = segs.filter(s => !NOISE.test((s.text||'').trim())).map(s => s.text.trim()).join(' ').trim()
                                        || (typeof r2.result === 'string' ? r2.result.trim() : '');
                                      setVnRefText(txt2);
                                    }
                                  } catch(_) {}
                                } finally { setVnRefTranscribing(false); }
                              }} className="flex items-center gap-1 px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-[10px] text-white font-bold transition-colors">
                                <RefreshCw size={9}/>Quét lại
                              </button>
                            )}
                          </p>
                          <textarea value={vnRefText} onChange={e => setVnRefText(e.target.value)}
                            rows={3}
                            placeholder={vnRefTranscribing ? 'Đang nhận diện giọng nói...' : 'Tự động điền sau khi chọn file · hoặc gõ thủ công...'}
                            disabled={vnRefTranscribing}
                            className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500/60 resize-none ${vnRefTranscribing ? 'opacity-60' : ''} ${!vnRefText.trim() && !vnRefTranscribing ? 'border-orange-500/40' : 'border-slate-700'}`}/>
                          {!vnRefText.trim() && !vnRefTranscribing && (
                            <p className="text-[10px] text-orange-400/80 mt-1">⚠ Chưa có transcription — giọng clone có thể không giống. Chọn file hoặc nhấn Quét lại.</p>
                          )}
                        </div>
                        {/* Đặt tên + lưu profile giọng clone */}
                        <div className="pt-1 border-t border-slate-700/50">
                          <p className="text-xs text-slate-500 mb-1.5">Đặt tên để lưu profile giọng này</p>
                          <div className="flex gap-2">
                            <input value={vnCloneName} onChange={e => setVnCloneName(e.target.value)}
                              placeholder="Ví dụ: Giọng Nam Miền Bắc..."
                              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500/60"/>
                            <button
                              disabled={!vnCloneName.trim() || !vnRefAudio}
                              onClick={() => {
                                if (!vnCloneName.trim() || !vnRefAudio) return;
                                const profile = { id: Date.now(), name: vnCloneName.trim(), refAudio: vnRefAudio, refText: vnRefText };
                                const updated = [profile, ...vnSavedVoices.filter(v => v.name !== profile.name)].slice(0, 20);
                                setVnSavedVoices(updated);
                                localStorage.setItem('vieneu_saved_voices', JSON.stringify(updated));
                                setVnCloneName('');
                              }}
                              className="shrink-0 px-3 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-xs text-white font-bold transition-colors">
                              Lưu
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>}

                  {/* Output folder */}
                  <div className="flex gap-2 items-center shrink-0">
                    <input readOnly value={vnOutputFolder} placeholder="Thư mục lưu file..."
                      className="flex-1 bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400"/>
                    <button onClick={async () => {
                      const r = await window.electronAPI?.selectFolder?.();
                      if (r) setVnOutputFolder(r);
                    }} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-300 flex items-center gap-1.5">
                      <FolderOpen size={13}/> Chọn thư mục
                    </button>
                  </div>

                  {/* Generate button */}
                  <button
                    disabled={vnGenerating || !vnOutputFolder || (vnMode==='text' ? !vnText.trim() : vnSrtSegments.length===0)}
                    onClick={async () => {
                      if (!vnOutputFolder) return;
                      setVnGenerating(true); setVnLog(''); setVnAudioUrl(''); setVnSrtProgress({ done:0, total:0, text:'' });
                      const addVnLog = (msg) => setVnLogs(prev => [...prev.slice(-199), `[${new Date().toLocaleTimeString()}] ${msg}`]);
                      const safeName = (vnProjectName || 'vieneu').replace(/[^a-z0-9_-]/gi, '_');

                      if (vnMode === 'srt') {
                        const outPath = `${vnOutputFolder}\\${safeName}_${Date.now()}.wav`;
                        addVnLog(`⏳ SRT mode · ${vnSrtSegments.length} đoạn · giọng: ${vnSelectedVoice || 'mặc định'}`);
                        try {
                          const r = await window.electronAPI?.vieNeuSynthesizeSRT?.({
                            segments: vnSrtSegments,
                            voiceId:  vnSelectedVoice || undefined,
                            outputPath: outPath,
                          });
                          if (r?.success) {
                            setVnAudioUrl(toFileUrl(r.path));
                            addVnLog(`✅ SRT xong → ${r.path.split(/[\\/]/).pop()}`);
                          } else {
                            addVnLog(`❌ Lỗi SRT: ${r?.error || 'unknown'}`);
                          }
                        } catch(e) { addVnLog(`❌ ${e.message}`); }
                        finally { setVnGenerating(false); setVnSrtProgress({ done:0, total:0, text:'' }); }
                      } else {
                        const outPath = `${vnOutputFolder}\\${safeName}_${Date.now()}.wav`;
                        addVnLog('⏳ Đang tổng hợp giọng nói...');
                        // Resolve clone voice nếu chọn từ dropdown clone:id
                        const isCloneSelected = vnSelectedVoice?.startsWith('clone:');
                        const cloneProfile = isCloneSelected
                          ? vnSavedVoices.find(v => String(v.id) === vnSelectedVoice.replace('clone:', ''))
                          : null;
                        try {
                          const r = await window.electronAPI?.vieNeuSynthesize?.({
                            text:       vnText,
                            outputPath: outPath,
                            voiceId:    (vnCloneMode || isCloneSelected) ? undefined : (vnSelectedVoice || undefined),
                            refAudio:   vnCloneMode ? vnRefAudio : (cloneProfile?.refAudio || undefined),
                            refText:    vnCloneMode ? vnRefText  : (cloneProfile?.refText  || undefined),
                          });
                          if (r?.success) {
                            setVnOutputPath(r.path);
                            setVnAudioUrl(toFileUrl(r.path));
                            addVnLog(`✅ Xong → ${r.path.split(/[\\/]/).pop()}`);
                          } else {
                            addVnLog(`❌ Lỗi: ${r?.error || 'unknown'}`);
                          }
                        } catch (e) { addVnLog(`❌ ${e.message}`); }
                        finally { setVnGenerating(false); }
                      }
                    }}
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${vnGenerating || !vnOutputFolder || (vnMode==='text' ? !vnText.trim() : vnSrtSegments.length===0) ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 text-white shadow-md'}`}>
                    {vnGenerating
                      ? <><Loader2 size={16} className="animate-spin"/> {vnMode==='srt' ? `Đang tổng hợp SRT... ${vnSrtProgress.done>0?`${vnSrtProgress.done}/${vnSrtProgress.total}`:''}` : 'Đang tạo giọng...'}</>
                      : <><Mic size={16}/> {vnMode==='srt' ? `Tổng hợp SRT (${vnSrtSegments.length} đoạn)` : 'Tạo giọng nói'}</>
                    }
                  </button>
                </>)}
              </div>{/* end cột trái */}

              {/* CỘT PHẢI */}
              <div className="flex flex-col flex-1 h-full min-h-0 gap-4">

                {/* Project name */}
                {vnReady && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tên file xuất</label>
                    <input value={vnProjectName} onChange={e => setVnProjectName(e.target.value)}
                      placeholder="vieneu_output"
                      className="bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500/60"/>
                  </div>
                )}

                {/* Audio output preview */}
                {vnAudioUrl && (
                  <div className="bg-[#141c2f] border border-orange-500/30 rounded-xl p-4 shrink-0">
                    <p className="text-xs text-orange-400 mb-2 font-semibold uppercase tracking-wider">▶ Kết quả</p>
                    <audio controls src={vnAudioUrl} className="w-full h-10"/>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => window.electronAPI?.openFolder?.(vnOutputFolder)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300">
                        <FolderOpen size={12}/> Mở thư mục
                      </button>
                    </div>
                  </div>
                )}

                {/* Voice preview player */}
                {vnPreviewAudioUrl && (
                  <div className="bg-[#141c2f] border border-slate-700 rounded-xl p-3 shrink-0">
                    <p className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Nghe thử giọng: <span className="text-orange-400">{vnPreviewingVoice}</span></p>
                    <audio controls autoPlay src={vnPreviewAudioUrl} className="w-full h-9"/>
                  </div>
                )}

                {/* Log hoạt động */}
                <div className="flex-1 min-h-0 flex flex-col bg-[#0a0f1c] border border-slate-800 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Log hoạt động</span>
                    <button onClick={() => setVnLogs([])} className="text-[10px] text-slate-600 hover:text-slate-400">Xóa</button>
                  </div>
                  <div ref={vnLogRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {vnLogs.length === 0
                      ? <p className="text-[10px] text-slate-700 italic">Chưa có hoạt động nào...</p>
                      : vnLogs.map((line, i) => (
                        <p key={i} className={`text-[10px] font-mono break-all leading-4 ${line.includes('✅') ? 'text-green-400' : line.includes('❌') ? 'text-red-400' : line.includes('⚠️') ? 'text-yellow-400' : 'text-slate-400'}`}>{line}</p>
                      ))
                    }
                  </div>
                </div>

                {/* Saved cloned voices */}
                {vnSavedVoices.length > 0 && (
                  <div className="shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">🎤 Giọng Clone Đã Lưu</p>
                      <span className="text-[10px] text-slate-600">Click để dùng · ▶ Thử · 🗑 Xóa</span>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                      {vnSavedVoices.map(sv => {
                        const isActive = vnCloneMode && vnRefAudio === sv.refAudio;
                        return (
                          <div key={sv.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${isActive ? 'bg-orange-600/20 border-orange-500/50' : 'bg-[#141c2f] border-slate-800 hover:border-slate-600'}`}>
                            <button onClick={() => {
                              setVnCloneMode(true);
                              setVnRefAudio(sv.refAudio);
                              setVnRefText(sv.refText || '');
                            }} className="flex-1 text-left text-xs text-slate-300 truncate min-w-0">
                              {isActive && <span className="text-orange-400 mr-1">✓</span>}
                              {sv.name}
                            </button>
                            <button
                              disabled={!!vnPreviewingVoice}
                              onClick={async () => {
                                if (!vnOutputFolder) { alert('Chọn thư mục lưu trước để nghe thử.'); return; }
                                setVnPreviewingVoice(`clone_${sv.id}`); setVnPreviewAudioUrl('');
                                const tmp = `${vnOutputFolder}\\preview_clone_${sv.id}_${Date.now()}.wav`;
                                try {
                                  const r = await window.electronAPI?.vieNeuSynthesize?.({ text: 'Xin chào, đây là giọng clone thử nghiệm.', outputPath: tmp, refAudio: sv.refAudio, refText: sv.refText });
                                  if (r?.success) setVnPreviewAudioUrl(toFileUrl(r.path));
                                } catch(_) {}
                                finally { setVnPreviewingVoice(''); }
                              }}
                              className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-slate-800 hover:bg-orange-600/30 text-slate-400 hover:text-orange-300 transition-colors disabled:opacity-40">
                              {vnPreviewingVoice === `clone_${sv.id}` ? <Loader2 size={10} className="animate-spin"/> : <>▶ Thử</>}
                            </button>
                            <button
                              onClick={() => {
                                if (!window.confirm(`Xóa giọng clone "${sv.name}"?`)) return;
                                const updated = vnSavedVoices.filter(v => v.id !== sv.id);
                                setVnSavedVoices(updated);
                                localStorage.setItem('vieneu_saved_voices', JSON.stringify(updated));
                                if (isActive) { setVnCloneMode(false); setVnRefAudio(''); setVnRefText(''); }
                              }}
                              title="Xóa giọng clone này"
                              className="shrink-0 text-[11px] px-1.5 py-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                              🗑
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Voices list with preview — ẩn khi đang dùng clone mode */}
                {vnReady && vnVoices.length > 0 && !vnCloneMode && (
                  <div className="shrink-0">
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Danh sách giọng</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {vnVoices.map(([desc, id]) => (
                        <div key={id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${vnSelectedVoice === id ? 'bg-orange-600/20 border-orange-500/40' : 'bg-[#141c2f] border-slate-800 hover:border-slate-600'}`}>
                          <button onClick={() => setVnSelectedVoice(id)} className="flex-1 text-left text-xs text-slate-300 truncate">
                            {desc}
                            {vnSelectedVoice === id && <span className="ml-2 text-orange-400">✓</span>}
                          </button>
                          <button
                            disabled={vnPreviewingVoice === id}
                            onClick={async () => {
                              if (!vnOutputFolder) { alert('Hãy chọn thư mục lưu trước để nghe thử giọng.'); return; }
                              setVnPreviewingVoice(id); setVnPreviewAudioUrl('');
                              const tmpPath = `${vnOutputFolder}\\preview_${id}_${Date.now()}.wav`;
                              try {
                                const r = await window.electronAPI?.vieNeuSynthesize?.({ text: 'Xin chào, đây là giọng đọc thử nghiệm của VieNeu TTS.', outputPath: tmpPath, voiceId: id });
                                if (r?.success) setVnPreviewAudioUrl(toFileUrl(r.path));
                              } catch(_) {}
                              finally { setVnPreviewingVoice(''); }
                            }}
                            className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-slate-800 hover:bg-orange-600/30 text-slate-400 hover:text-orange-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                            {vnPreviewingVoice === id ? <Loader2 size={10} className="animate-spin"/> : <><span>▶</span> Thử</>}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Placeholder khi chưa cài */}
                {!vnReady && !vnInstalling && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-600">
                      <Mic size={40} className="mx-auto mb-3 opacity-30"/>
                      <p className="text-sm">Cài VieNeu để bắt đầu</p>
                      <p className="text-xs mt-1 opacity-60">Giọng Việt tự nhiên, chạy offline</p>
                    </div>
                  </div>
                )}
              </div>{/* end cột phải */}
            </div>
            )}
            {/* END TAB: VIENEU TTS */}

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: GPT-SoVITS  ══════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'gptsovits' && (
            <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
              {/* ── Cột trái: settings + ref audio + input ── */}
              <div className="flex flex-col w-[45%] shrink-0 gap-4 overflow-y-auto min-h-0 pr-1">
                {/* Header */}
                <div className="flex items-center gap-3 bg-[#141c2f] p-4 rounded-xl border border-slate-800 shrink-0">
                  <div className="w-10 h-10 bg-pink-500/10 rounded-lg flex items-center justify-center text-pink-400 shrink-0"><Sparkles size={20}/></div>
                  <div className="flex-1">
                    <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider">GPT-SoVITS</h2>
                    <p className="text-[10px] text-slate-500">Voice cloning · Local server · Chất lượng cao</p>
                  </div>
                  {gsvInstalled && (
                    <span className="text-[9px] px-2 py-1 rounded-full bg-emerald-900/50 text-emerald-400 border border-emerald-700/40">✅ Đã cài</span>
                  )}
                </div>

                {/* ── Chưa cài: nút Download + Install ── */}
                {!gsvInstalled && (
                  <div className="bg-[#141c2f] rounded-xl border border-pink-800/40 p-4 space-y-3 shrink-0">
                    <p className="text-xs font-bold text-pink-400">📦 Cài GPT-SoVITS tự động</p>
                    <p className="text-[10px] text-slate-400">App sẽ tải bản mới nhất từ GitHub và cài đặt tự động (~3-5GB, cần CUDA để dùng GPU).</p>
                    {gsvInstalling ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-[9px] text-pink-300">
                          <span>{gsvSetupMsg?.slice(0, 60)}</span>
                          <span>{gsvSetupPct}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                          <div className="bg-pink-500 h-1.5 rounded-full transition-all" style={{ width: `${gsvSetupPct}%` }}/>
                        </div>
                        <button onClick={() => { window.electronAPI?.gptSoVITSCancelInstall?.(); setGsvInstalling(false); }}
                          className="w-full py-1.5 rounded-lg bg-slate-700 hover:bg-red-900 text-[10px] text-slate-300 transition">
                          ⏹ Hủy cài đặt
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Chọn thư mục tải về */}
                        <div>
                          <p className="text-[9px] text-slate-500 mb-1">📁 Thư mục tải về (~7.6GB)</p>
                          <button onClick={async () => {
                            const p = await window.electronAPI?.selectFolder?.();
                            if (p) setGsvInstallDir(p);
                          }} className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition ${gsvInstallDir ? 'bg-slate-700 text-slate-200 border border-slate-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700'}`}>
                            {gsvInstallDir ? `📂 ${gsvInstallDir}` : '📂 Chọn ổ/thư mục tải về (D:\\, E:\\...)'}
                          </button>
                          {!gsvInstallDir && <p className="text-[9px] text-amber-500/70 mt-0.5">⚠️ Mặc định lưu vào ổ C nếu không chọn</p>}
                        </div>
                        <button onClick={async () => {
                          setGsvInstalling(true); setGsvSetupPct(0); setGsvSetupMsg('Đang tìm link tải...');
                          const r = await window.electronAPI?.gptSoVITSInstall?.({ installDir: gsvInstallDir || undefined });
                          setGsvInstalling(false);
                          if (r?.ok) setGsvInstalled(true);
                        }} className="w-full py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-bold text-sm transition flex items-center justify-center gap-2">
                          <Download size={16}/> Tự động tải & cài từ GitHub
                        </button>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-px bg-slate-700"/>
                          <span className="text-[9px] text-slate-600">hoặc</span>
                          <div className="flex-1 h-px bg-slate-700"/>
                        </div>
                        <p className="text-[10px] text-slate-400">Đã tải sẵn? Tải tại <span className="text-pink-400">github.com/RVC-Boss/GPT-SoVITS/releases</span> rồi chọn folder:</p>
                        <button onClick={async () => {
                          const p = await window.electronAPI?.selectFolder?.();
                          if (!p) return;
                          const r = await window.electronAPI?.gptSoVITSSetFolder?.(p);
                          if (r?.ok) { setGsvInstalled(true); addGsvLog('✅ Đã liên kết folder GPT-SoVITS'); }
                          else addGsvLog(`❌ ${r?.error}`);
                        }} className="w-full py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold transition flex items-center justify-center gap-2">
                          <FolderOpen size={14}/> Chọn folder GPT-SoVITS đã tải
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Đã cài: Start/Stop server + URL ── */}
                {gsvInstalled && (
                  <div className="bg-[#141c2f] rounded-xl border border-slate-800 p-4 space-y-3 shrink-0">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">🚀 Server</p>
                    <div className="flex gap-2">
                      {!gsvServerRunning ? (
                        <button onClick={async () => {
                          setGsvStarting(true);
                          addGsvLog('🚀 Đang khởi động server...');
                          const r = await window.electronAPI?.gptSoVITSStartServer?.();
                          setGsvStarting(false);
                          if (r?.ok) { setGsvServerRunning(true); setGsvConnected(true); }
                          else addGsvLog(`❌ ${r?.error}`);
                        }} disabled={gsvStarting}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${gsvStarting ? 'bg-slate-700 text-slate-400 animate-pulse' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}`}>
                          {gsvStarting ? '⏳ Đang khởi động...' : '▶ Khởi động Server'}
                        </button>
                      ) : (
                        <button onClick={async () => {
                          await window.electronAPI?.gptSoVITSStopServer?.();
                          setGsvServerRunning(false); setGsvConnected(false);
                          addGsvLog('⏹ Đã dừng server');
                        }} className="flex-1 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-bold transition">
                          ⏹ Dừng Server
                        </button>
                      )}
                      <button onClick={async () => {
                        setGsvTesting(true);
                        await window.electronAPI?.gptSoVITSSetUrl?.(gsvServerUrl);
                        const r = await window.electronAPI?.gptSoVITSTestConn?.();
                        setGsvConnected(!!r?.ok);
                        addGsvLog(r?.ok ? '✅ Kết nối thành công!' : `❌ ${r?.error}`);
                        setGsvTesting(false);
                      }} disabled={gsvTesting}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition ${gsvTesting ? 'bg-slate-700 text-slate-400' : gsvConnected ? 'bg-emerald-800 text-emerald-300' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
                        {gsvTesting ? '...' : gsvConnected ? '✅' : '🔌 Test'}
                      </button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input value={gsvServerUrl} onChange={e => setGsvServerUrl(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] focus:outline-none focus:border-pink-500 text-slate-400" />
                      <span className={`text-[9px] px-2 py-1 rounded ${gsvServerRunning ? 'text-emerald-400 bg-emerald-900/30' : 'text-slate-600 bg-slate-800'}`}>
                        {gsvServerRunning ? '● Online' : '○ Offline'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Nếu không muốn cài: dùng server riêng */}
                {!gsvInstalled && !gsvInstalling && (
                  <details className="shrink-0">
                    <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400">Đã có server riêng? Kết nối thủ công</summary>
                    <div className="mt-2 flex gap-2">
                      <input value={gsvServerUrl} onChange={e => setGsvServerUrl(e.target.value)}
                        placeholder="http://127.0.0.1:9880"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-pink-500 text-slate-200" />
                      <button onClick={async () => {
                        setGsvTesting(true);
                        await window.electronAPI?.gptSoVITSSetUrl?.(gsvServerUrl);
                        const r = await window.electronAPI?.gptSoVITSTestConn?.();
                        setGsvConnected(!!r?.ok);
                        if (r?.ok) setGsvInstalled(true);
                        addGsvLog(r?.ok ? '✅ Kết nối thành công!' : `❌ ${r?.error}`);
                        setGsvTesting(false);
                      }} disabled={gsvTesting}
                        className="px-3 py-1.5 rounded bg-pink-700 hover:bg-pink-600 text-white text-xs font-bold transition">
                        {gsvTesting ? '...' : '🔌 Test'}
                      </button>
                    </div>
                  </details>
                )}

                {/* Reference Audio — chỉ hiện khi đã cài/kết nối */}
                {(gsvInstalled || gsvConnected) && <div className="bg-[#141c2f] rounded-xl border border-slate-800 p-4 space-y-3 shrink-0">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">🎤 Reference Audio (Giọng mẫu)</p>

                  {/* Saved refs */}
                  {gsvRefs.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500">Giọng đã lưu</p>
                      {gsvRefs.map(r => (
                        <div key={r.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition cursor-pointer ${gsvSelectedRef === r.id ? 'bg-pink-600/20 border-pink-500/40' : 'bg-slate-900 border-slate-700 hover:border-slate-600'}`}
                          onClick={() => { setGsvSelectedRef(r.id); setGsvRefAudio(r.refAudioPath); setGsvRefText(r.refText); setGsvLang(r.lang || 'vi'); }}>
                          <span className="flex-1 text-xs text-slate-300 truncate">{r.name}</span>
                          {!r.refText?.trim() && <span className="text-[8px] bg-red-900/60 text-red-400 px-1 rounded">no text</span>}
                          <span className="text-[9px] text-slate-600">{r.lang}</span>
                          <button onClick={async (e) => { e.stopPropagation(); await window.electronAPI?.gptSoVITSDeleteRef?.(r.id); setGsvRefs(prev => prev.filter(x => x.id !== r.id)); if (gsvSelectedRef === r.id) { setGsvSelectedRef(''); setGsvRefAudio(''); setGsvRefText(''); } }}
                            className="text-[10px] text-slate-600 hover:text-red-400 px-1">🗑</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* New ref */}
                  <div className="space-y-2 border-t border-slate-800 pt-2">
                    <p className="text-[10px] text-slate-500">Thêm giọng mới</p>
                    {/* Mode chọn engine nhận diện */}
                    {!gsvProcessing && <div className="flex gap-1">
                      {[['whisper','🤖 Whisper (cục bộ)'],['gemini','✨ Gemini (online)']].map(([v,l]) => (
                        <button key={v} onClick={() => setGsvTranscribeMode(v)}
                          className={`flex-1 py-1 rounded text-[10px] font-bold transition ${(gsvTranscribeMode||'whisper')===v ? 'bg-pink-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{l}</button>
                      ))}
                    </div>}
                    <button onClick={async () => {
                      const p = await window.electronAPI?.selectFile?.('audio');
                      if (!p) return;
                      setGsvProcessing(true); setGsvRefChunks([]);
                      const mode = gsvTranscribeMode || 'whisper';
                      addGsvLog(`✂️ Đang cắt 5s + nhận diện (${mode})...`);

                      let refPath = p, refText = '', refName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/_\d{13}$/, '').replace(/_/g, ' ');

                      // Cắt 5s bằng IPC (Whisper path cũng cắt, Gemini dùng original)
                      const cutR = await window.electronAPI?.gptSoVITSSplitRef?.({ audioPath: p, lang: gsvLang === 'vi' ? 'auto' : gsvLang });
                      if (cutR?.ok) refPath = cutR.path;

                      if (mode === 'gemini') {
                        try {
                          const keys = (() => { try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; } })();
                          const model = localStorage.getItem('mc_studio_gemini_model') || 'gemini-3.5-flash';
                          if (!keys.length) { addGsvLog('⚠️ Chưa có Gemini API key'); setGsvProcessing(false); return; }
                          addGsvLog(`🔮 Gemini ${model} đang nhận diện...`);
                          const { GoogleGenAI } = await import('@google/genai');
                          const fs2 = window.electronAPI?.readFileBase64 ? null : null;
                          // Đọc file ref audio thành base64
                          const b64 = await window.electronAPI?.readFileBase64?.(refPath);
                          if (!b64) { addGsvLog('⚠️ Không đọc được file audio'); setGsvProcessing(false); return; }
                          const ai = new GoogleGenAI({ apiKey: keys[0] });
                          const resp = await ai.models.generateContent({
                            model,
                            contents: [{ role: 'user', parts: [
                              { inlineData: { data: b64, mimeType: 'audio/wav' } },
                              { text: 'Transcribe ONLY what is spoken in this audio clip. Return ONLY the spoken text, no translation, no explanation.' }
                            ]}],
                            config: { maxOutputTokens: 1024, ...(/gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }
                          });
                          refText = (resp?.text || '').trim();
                          // Auto-detect ngôn ngữ từ transcript
                          const hasJa = /[぀-ヿㇰ-ㇿ]/.test(refText);
                          const hasKo = /[가-힯]/.test(refText);
                          const hasZh = /[一-鿿]/.test(refText) && !hasJa;
                          const detectedLang = hasJa ? 'ja' : hasKo ? 'ko' : hasZh ? 'zh' : gsvLang;
                          if (detectedLang !== gsvLang) { setGsvLang(detectedLang); }
                          addGsvLog(`✅ Gemini transcript [${detectedLang}]: ${refText.slice(0,80)}`);
                        } catch(e) { addGsvLog(`⚠️ Gemini lỗi: ${e.message}`); }
                      } else {
                        refText = cutR?.text || '';
                        // Auto-detect ngôn ngữ từ whisper transcript
                        const hasJaW = /[぀-ヿㇰ-ㇿ]/.test(refText);
                        const hasKoW = /[가-힯]/.test(refText);
                        const hasZhW = /[一-鿿]/.test(refText) && !hasJaW;
                        const detectedLangW = hasJaW ? 'ja' : hasKoW ? 'ko' : hasZhW ? 'zh' : gsvLang;
                        if (detectedLangW !== gsvLang) { setGsvLang(detectedLangW); }
                        addGsvLog(refText ? `✅ Whisper [${detectedLangW}]: ${refText.slice(0,60)}` : '⚠️ Whisper không nhận diện được');
                      }

                      setGsvRefAudio(refPath); setGsvRefText(refText); setGsvRefName(refName);
                      setGsvSelectedRef(''); setGsvRefChunks([{ path: refPath, text: refText, name: refName }]);
                      setGsvProcessing(false);
                    }} disabled={gsvProcessing}
                      className="w-full py-2 rounded-lg text-xs font-bold transition bg-slate-800 text-slate-400 hover:bg-slate-700 disabled:opacity-50">
                      {gsvProcessing ? '⏳ Đang xử lý...' : '📂 Chọn file audio mẫu'}
                    </button>
                    {gsvRefChunks.length > 0 && (
                      <div className="bg-slate-900 border border-pink-800/40 rounded-lg p-2 space-y-1.5">
                        <input value={gsvRefName} onChange={e => setGsvRefName(e.target.value)} placeholder="Tên giọng..."
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-pink-500" />
                        <textarea value={gsvRefText} onChange={e => setGsvRefText(e.target.value)} rows={2}
                          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] resize-none focus:outline-none text-slate-300" />
                        <button onClick={async () => {
                          if (!gsvRefName.trim()) return;
                          const r = await window.electronAPI?.gptSoVITSSaveRef?.({ name: gsvRefName.trim(), refAudioPath: gsvRefAudio, refText: gsvRefText, lang: gsvLang });
                          if (r?.ok) {
                            const cfg = await window.electronAPI?.gptSoVITSGetConfig?.();
                            if (cfg?.refs) {
                              setGsvRefs(cfg.refs);
                              // Auto-select vừa lưu để TTS dùng đúng lang
                              const saved = cfg.refs.find(x => x.name === gsvRefName.trim());
                              if (saved) { setGsvSelectedRef(saved.id); setGsvRefAudio(saved.refAudioPath); setGsvRefText(saved.refText); }
                            }
                            setGsvRefChunks([]); addGsvLog(`✅ Đã lưu & chọn: ${gsvRefName}`);
                          }
                        }} disabled={!gsvRefName.trim()}
                          className="w-full py-1.5 rounded-lg bg-pink-700 hover:bg-pink-600 text-white text-xs font-bold disabled:opacity-40">
                          💾 Lưu giọng
                        </button>
                      </div>
                    )}
                  </div>
                </div>}

                {/* Speed + Language — chỉ hiện khi đã cài/kết nối */}
                {(gsvInstalled || gsvConnected) && <div className="bg-[#141c2f] rounded-xl border border-slate-800 p-4 space-y-2 shrink-0">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">⚙️ Cài đặt</p>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 w-16">Ngôn ngữ</span>
                    <select value={gsvLang} onChange={e => setGsvLang(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-pink-500 text-slate-200">
                      {[['vi','Tiếng Việt'],['zh','Tiếng Trung'],['en','English'],['ja','日本語'],['ko','한국어']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 w-16">⚡ Tốc độ</span>
                    <input type="range" min={0.5} max={2} step={0.05} value={gsvSpeed} onChange={e => setGsvSpeed(+e.target.value)} className="flex-1 accent-pink-500 h-1" />
                    <span className="text-[10px] font-bold text-pink-400 w-8 text-right tabular-nums">{gsvSpeed.toFixed(2)}x</span>
                    {gsvSpeed !== 1.0 && <button onClick={() => setGsvSpeed(1.0)} className="text-[9px] text-slate-600 hover:text-slate-400">↺</button>}
                  </div>
                </div>}

                {/* Mode + Text input — chỉ hiện khi đã cài/kết nối */}
                {!(gsvInstalled || gsvConnected) && null}
                {(gsvInstalled || gsvConnected) && <>
                {/* Mode + Text input */}
                <div className="flex gap-1 shrink-0">
                  {[['text','📝 Text'],['srt','📄 SRT']].map(([v,l]) => (
                    <button key={v} onClick={() => setGsvMode(v)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${gsvMode===v ? 'bg-pink-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{l}</button>
                  ))}
                </div>

                {gsvMode === 'text' ? (
                  <textarea value={gsvText} onChange={e => setGsvText(e.target.value)} rows={6}
                    placeholder="Nhập nội dung cần đọc..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs resize-none focus:outline-none focus:border-pink-500 text-slate-200 shrink-0" />
                ) : (
                  <div className="space-y-2 shrink-0">
                    <button onClick={async () => {
                      const p = await window.electronAPI?.selectFile?.('srt');
                      if (!p) return;
                      setGsvSrtFile(p);
                      const txt = await window.electronAPI?.readTextFile?.(p);
                      if (!txt) return;
                      const segs = [];
                      const blocks = txt.split(/\n\n+/);
                      for (const block of blocks) {
                        const lines = block.trim().split('\n');
                        if (lines.length < 3) continue;
                        const timeLine = lines[1];
                        const m = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
                        if (!m) continue;
                        const startMs = (+m[1]*3600 + +m[2]*60 + +m[3])*1000 + +m[4];
                        const text = lines.slice(2).join(' ').trim();
                        if (text) segs.push({ startMs, text });
                      }
                      setGsvSrtSegs(segs);
                    }} className={`w-full py-2 rounded-lg text-xs font-bold transition ${gsvSrtFile ? 'bg-pink-900/40 text-pink-300 border border-pink-700' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                      {gsvSrtFile ? `📄 ${gsvSrtFile.split(/[\\/]/).pop()} (${gsvSrtSegs.length} segs)` : '📂 Chọn file SRT'}
                    </button>
                  </div>
                )}

                {/* Output folder + filename */}
                <div className="flex gap-2 shrink-0">
                  <button onClick={async () => {
                    const p = await window.electronAPI?.selectFolder?.();
                    if (p) { setGsvOutputFolder(p); window.electronAPI?.gptSoVITSSaveOutputFolder?.(p); }
                  }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${gsvOutputFolder ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                    {gsvOutputFolder ? `📁 ${gsvOutputFolder.split(/[\\/]/).pop()}` : '📁 Chọn thư mục lưu'}
                  </button>
                </div>
                {gsvOutputFolder && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500 shrink-0">Tên file:</span>
                    <input value={gsvFileName || ''} onChange={e => setGsvFileName(e.target.value)} placeholder="audio_output (để trống = tự động)"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-pink-500" />
                    <span className="text-[10px] text-slate-600">.wav</span>
                  </div>
                )}

                {/* Progress (SRT mode) */}
                {gsvGenerating && gsvSrtProgress.total > 0 && (
                  <div className="shrink-0">
                    <div className="flex justify-between text-[9px] text-slate-400 mb-1">
                      <span>{gsvSrtProgress.text?.slice(0,40) || `${gsvSrtProgress.done}/${gsvSrtProgress.total}`}</span>
                      <span>{Math.round(gsvSrtProgress.done/gsvSrtProgress.total*100)}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1"><div className="bg-pink-500 h-1 rounded-full transition-all" style={{ width:`${gsvSrtProgress.total?gsvSrtProgress.done/gsvSrtProgress.total*100:0}%` }}/></div>
                  </div>
                )}

                {/* Generate button */}
                <button onClick={async () => {
                  if (!gsvOutputFolder) { alert('Chọn thư mục lưu trước'); return; }
                  if (!gsvRefAudio) { addGsvLog('⚠️ Cần chọn reference audio'); return; }
                  if (!gsvRefText?.trim()) { addGsvLog('⚠️ Transcript giọng mẫu đang trống! Dùng Gemini để nhận diện lời thoại trước khi TTS.'); return; }
                  setGsvGenerating(true); setGsvAudioUrl('');
                  await window.electronAPI?.gptSoVITSSetUrl?.(gsvServerUrl);
                  try {
                    if (gsvMode === 'srt') {
                      if (!gsvSrtSegs.length) { addGsvLog('⚠️ Chưa load SRT'); return; }
                      const srtName = gsvFileName.trim() || `gsovits_srt_${Date.now()}`;
                      const outPath = `${gsvOutputFolder}\\${srtName}.mp3`;
                      const selRef2 = gsvRefs.find(r => r.id === gsvSelectedRef);
                      const r = await window.electronAPI?.gptSoVITSSynthSRT?.({ segments: gsvSrtSegs, refAudioPath: gsvRefAudio, refText: gsvRefText, lang: gsvLang, refLang: selRef2?.lang || gsvLang, speed: gsvSpeed, outputPath: outPath });
                      if (r?.success) { setGsvOutputPath(r.path); setGsvAudioUrl(toFileUrl(r.path)); }
                      else addGsvLog(`❌ ${r?.error}`);
                    } else {
                      if (!gsvText.trim()) { addGsvLog('⚠️ Chưa nhập text'); return; }
                      const fname = gsvFileName.trim() || `gsovits_${Date.now()}`;
                      const outPath = `${gsvOutputFolder}\\${fname}.wav`;
                      // Lấy lang của ref voice đã chọn làm prompt_lang
                      const selRef = gsvRefs.find(r => r.id === gsvSelectedRef);
                      const refLangAuto = selRef?.lang || gsvLang;
                      const r = await window.electronAPI?.gptSoVITSSynthesize?.({ text: gsvText, outputPath: outPath, refAudioPath: gsvRefAudio, refText: gsvRefText, lang: gsvLang, refLang: refLangAuto, speed: gsvSpeed });
                      if (r?.success) { setGsvOutputPath(r.path); setGsvAudioUrl(toFileUrl(r.path)); }
                      else addGsvLog(`❌ ${r?.error}`);
                    }
                  } finally { setGsvGenerating(false); setGsvSrtProgress({done:0,total:0,text:''}); }
                }} disabled={gsvGenerating || !gsvOutputFolder || (!gsvRefAudio)}
                  className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shrink-0 ${gsvGenerating || !gsvOutputFolder || !gsvRefAudio ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-700 text-white shadow-md'}`}>
                  {gsvGenerating ? <><Loader2 size={16} className="animate-spin"/>Đang tổng hợp...</> : <><Sparkles size={16}/>Tổng hợp giọng nói</>}
                </button>
                </>}
              </div>

              {/* ── Cột phải: log + audio player ── */}
              <div className="flex flex-col flex-1 gap-4 min-h-0 overflow-hidden">
                {/* Audio player */}
                {gsvAudioUrl && (
                  <div className="bg-[#141c2f] border border-slate-700 rounded-xl p-4 shrink-0">
                    <p className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Kết quả</p>
                    <audio controls autoPlay src={gsvAudioUrl} className="w-full h-10"/>
                    <p className="text-[10px] text-slate-600 mt-1 truncate">{gsvOutputPath}</p>
                  </div>
                )}

                {/* Log */}
                <div className="flex-1 min-h-0 flex flex-col bg-[#0a0f1c] border border-slate-800 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Log</span>
                    <button onClick={() => setGsvLogs([])} className="text-[10px] text-slate-600 hover:text-slate-400">Xóa</button>
                  </div>
                  <div ref={gsvLogRef} className="flex-1 overflow-y-auto p-3 space-y-0.5">
                    {gsvLogs.length === 0
                      ? <p className="text-[10px] text-slate-700 italic">Chưa có hoạt động...</p>
                      : gsvLogs.map((line, i) => (
                        <p key={i} className={`text-[10px] font-mono break-all leading-4 ${line.includes('✅') ? 'text-green-400' : line.includes('❌') ? 'text-red-400' : line.includes('⚠️') ? 'text-yellow-400' : 'text-slate-400'}`}>{line}</p>
                      ))
                    }
                  </div>
                </div>

                {/* Hướng dẫn */}
                <div className="bg-[#0d1424] border border-slate-800 rounded-xl p-4 shrink-0 space-y-2">
                  <p className="text-xs font-bold text-pink-400">📋 Hướng dẫn sử dụng</p>
                  <ol className="text-[10px] text-slate-400 space-y-1 list-decimal list-inside">
                    <li>Tải và cài GPT-SoVITS từ GitHub (oobabooga hoặc bản gốc)</li>
                    <li>Chạy <code className="bg-slate-800 px-1 rounded text-pink-300">api_v2.py</code> → server khởi động tại port 9880</li>
                    <li>Nhấn <strong className="text-white">Test</strong> để kiểm tra kết nối</li>
                    <li>Chọn file audio mẫu (WAV 5-30 giây, giọng rõ)</li>
                    <li>Nhập transcript của audio mẫu → Nhập text → Tổng hợp</li>
                  </ol>
                </div>
              </div>
            </div>
            )}
            {/* END TAB: GPT-SoVITS */}

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: KOKORO TTS  ══════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'kokoro' && (
            <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">

              {/* CỘT TRÁI */}
              <div className="flex flex-col w-[45%] h-full shrink-0 min-h-0 gap-4 overflow-y-auto pr-1">

                {/* Server status */}
                <div className="bg-[#0d1424] border border-slate-700 rounded-xl p-4 shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-cyan-400">🌊 Kokoro TTS Server</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Port 8008 · Local · Offline</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${kkReady ? 'bg-emerald-400' : 'bg-slate-600'}`}/>
                      <span className={`text-xs font-bold ${kkReady ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {kkReady ? 'Running' : 'Stopped'}
                      </span>
                    </div>
                  </div>
                  {!kkModelsReady && (
                    <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 mb-3">
                      <p className="text-xs text-amber-400">⚠️ Không tìm thấy model file trong assets/kokorotts/</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {!kkReady ? (
                      <button onClick={handleKkStartServer} disabled={kkStarting || !kkModelsReady}
                        className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all">
                        {kkStarting ? '⏳ Đang khởi động...' : '▶ Khởi động Server'}
                      </button>
                    ) : (
                      <button onClick={handleKkStopServer}
                        className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-lg transition-all">
                        ⏹ Dừng Server
                      </button>
                    )}
                  </div>
                </div>

                {/* Language filter */}
                <div className="shrink-0">
                  <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 tracking-wider">Ngôn ngữ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[['all','Tất cả'],['vi','🇻🇳 Tiếng Việt'],['en','🇺🇸 English'],['ja','🇯🇵 日本語'],['zh','🇨🇳 中文'],['ko','🇰🇷 한국어'],['fr','🇫🇷 Français'],['es','🇪🇸 Español'],['hi','🇮🇳 हिन्दी']].map(([id, label]) => (
                      <button key={id} onClick={() => setKkLangFilter(id)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border ${kkLangFilter === id ? 'bg-cyan-600 text-white border-cyan-500' : 'border-slate-700 text-slate-400 hover:border-cyan-700 hover:text-white'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice grid */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <p className="text-[10px] text-slate-500 font-bold uppercase mb-2 tracking-wider">Giọng ({(kkLangFilter === 'all' ? kkVoices : kkVoices.filter(v => v.lang === kkLangFilter)).length})</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(kkLangFilter === 'all' ? kkVoices : kkVoices.filter(v => v.lang === kkLangFilter)).map(v => (
                      <button key={v.id} onClick={() => setKkSelectedVoice(v.id)}
                        className={`px-3 py-2.5 rounded-lg text-left transition-all border ${kkSelectedVoice === v.id ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'}`}>
                        <div className="text-[11px] font-bold truncate">{v.name}</div>
                        <div className="text-[9px] opacity-60 uppercase">{v.lang}{v.lang === 'vi' ? ' · Edge' : ' · Kokoro'}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* CỘT PHẢI */}
              <div className="flex flex-col flex-1 h-full min-h-0 gap-4 overflow-y-auto pl-1">

                {/* Text input */}
                <div className="shrink-0">
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Văn bản</p>
                    <span className="text-[10px] text-slate-600">{kkText.length} ký tự</span>
                  </div>
                  <textarea value={kkText} onChange={e => setKkText(e.target.value)} rows={8}
                    placeholder="Nhập nội dung cần đọc..."
                    className="w-full bg-[#0d1424] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-600" />
                </div>

                {/* Settings */}
                <div className="bg-[#0d1424] border border-slate-700 rounded-xl p-4 shrink-0 space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] text-slate-500 font-bold uppercase w-20 shrink-0">Tên file</label>
                    <input value={kkProjectName} onChange={e => setKkProjectName(e.target.value)}
                      className="flex-1 bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-600" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] text-slate-500 font-bold uppercase w-20 shrink-0">Thư mục</label>
                    <input value={kkOutputFolder} onChange={e => setKkOutputFolder(e.target.value)} placeholder="C:\Users\Public\Videos"
                      className="flex-1 bg-[#141c2f] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-600" />
                    <button onClick={async () => { const d = await window.electronAPI?.selectFolder?.(); if (d) setKkOutputFolder(d); }}
                      className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg">📁</button>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] text-slate-500 font-bold uppercase w-20 shrink-0">Tốc độ</label>
                    <input type="range" min={0.5} max={2.0} step={0.05} value={kkSpeed} onChange={e => setKkSpeed(parseFloat(e.target.value))}
                      className="flex-1 accent-cyan-500" />
                    <span className="text-xs text-cyan-400 w-8 text-right">{kkSpeed.toFixed(2)}x</span>
                  </div>
                </div>

                {/* Generate button */}
                <button onClick={handleKkSynthesize} disabled={kkGenerating || !kkText.trim() || (!kkReady && !kkSelectedVoice.startsWith('vi_'))}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shrink-0">
                  {kkGenerating ? '⏳ Đang tổng hợp...' : '🎙️ Tạo giọng nói'}
                </button>

                {!kkReady && !kkSelectedVoice.startsWith('vi_') && (
                  <p className="text-xs text-amber-400 text-center shrink-0">⚠️ Khởi động server trước để dùng giọng Kokoro</p>
                )}

                {/* Audio player */}
                {kkAudioUrl && (
                  <div className="bg-[#0d1424] border border-cyan-800/50 rounded-xl p-4 shrink-0">
                    <p className="text-[10px] text-cyan-400 font-bold mb-2">▶ Nghe kết quả</p>
                    <audio controls src={kkAudioUrl} className="w-full" />
                  </div>
                )}

                {/* Log */}
                <div className="flex-1 min-h-0 bg-[#060d1a] border border-slate-800 rounded-xl p-3 overflow-y-auto" ref={kkLogRef}>
                  {kkLogs.length === 0
                    ? <p className="text-[10px] text-slate-600 italic">Log sẽ hiển thị ở đây...</p>
                    : kkLogs.map((l, i) => (
                      <p key={i} className={`text-[10px] font-mono mb-0.5 ${l.includes('✅') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : l.includes('⚠️') ? 'text-amber-400' : 'text-slate-400'}`}>{l}</p>
                    ))}
                </div>
              </div>
            </div>
            )}
            {/* END TAB: KOKORO TTS */}

        </div>
    );
}
