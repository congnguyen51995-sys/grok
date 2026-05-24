import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Play, Mic, FolderOpen, Search, Filter, User, CheckCircle2, Volume2,
    RefreshCw, History, Pause, FileAudio, Key, Plus, Trash2, Sliders,
    Zap, ChevronDown, ChevronUp, Settings, Terminal, X, AlertCircle, MessageSquare,
    Sparkles, Loader2, Download
} from 'lucide-react';

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

// ─── ELEVENLABS helpers ───────────────────────────────────────────────────────
const EL_LS_KEYS = 'elevenlabs_api_keys_v3';
const EL_LS_HIST = 'elevenlabs_history';
const EL_SYSTEM_KEYS_COUNT = 231;

const ZALO_LS_KEYS = 'zalo_tts_api_keys';
const ZALO_LS_HIST = 'zalo_tts_history';
const ZALO_VOICES = [
    { id: '1', name: 'Nữ Bắc',   gender: 'female', region: 'Miền Bắc' },
    { id: '2', name: 'Nam Bắc',  gender: 'male',   region: 'Miền Bắc' },
    { id: '3', name: 'Nữ Nam',   gender: 'female', region: 'Miền Nam' },
    { id: '4', name: 'Nam Nam',  gender: 'male',   region: 'Miền Nam' },
    { id: '5', name: 'Nữ Trung', gender: 'female', region: 'Miền Trung' },
];

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
    const [subTab, setSubTab] = useState('edge'); // 'edge' | 'elevenlabs' | 'omnivoice'

    // =========================================================================
    // ===  OMNI VOICE STATE  ==================================================
    // =========================================================================
    const OV_BASE = 'http://localhost:8000';
    const [ovConnected,        setOvConnected]        = useState(false);
    const [ovConnecting,       setOvConnecting]       = useState(false);
    const [ovStarting,         setOvStarting]         = useState(false);   // backend đang khởi động
    const [ovStartError,       setOvStartError]       = useState('');      // lỗi khởi động
    const [ovDir,              setOvDir]              = useState('');       // đường dẫn backend
    const [ovLogs,             setOvLogs]             = useState([]);       // log từ backend
    const ovPollRef    = useRef(null); // interval ref để poll kết nối
    const ovLogListened = useRef(false); // đã đăng ký lắng nghe log chưa
    const [ovProfiles,         setOvProfiles]         = useState([]);
    const [ovEngineActive,     setOvEngineActive]     = useState('');
    const [ovText,             setOvText]             = useState('');
    const [ovLanguage,         setOvLanguage]         = useState('');
    const [ovSelectedProfile,  setOvSelectedProfile]  = useState('');
    const [ovInstruct,         setOvInstruct]         = useState('');
    const [ovNumStep,          setOvNumStep]          = useState(16);
    const [ovGuidance,         setOvGuidance]         = useState(2.0);
    const [ovSpeed,            setOvSpeed]            = useState(1.0);
    const [ovEffectPreset,     setOvEffectPreset]     = useState('broadcast');
    const [ovGenerating,       setOvGenerating]       = useState(false);
    const [ovAudioUrl,         setOvAudioUrl]         = useState(null);
    const [ovAudioDur,         setOvAudioDur]         = useState(null);
    const [ovHistory,          setOvHistory]          = useState([]);
    const [ovSection,          setOvSection]          = useState('generate'); // 'generate'|'clone'|'profiles'
    const [ovOutputFolder,     setOvOutputFolder]     = useState('');
    // Clone profile state
    const [ovProfName,         setOvProfName]         = useState('');
    const [ovProfLang,         setOvProfLang]         = useState('');
    const [ovProfInstruct,     setOvProfInstruct]     = useState('');
    const [ovRefText,          setOvRefText]          = useState('');
    const [ovRefFile,          setOvRefFile]          = useState(null); // File object
    const [ovRefFileName,      setOvRefFileName]      = useState('');
    const [ovCreatingProf,     setOvCreatingProf]     = useState(false);
    const [ovSaving,           setOvSaving]           = useState(false);
    const ovAudioRef = useRef(null);

    const OV_LANGS = [
        { v: '',    l: '🌐 Auto (tự động)' },
        { v: 'vi',  l: '🇻🇳 Tiếng Việt' },
        { v: 'en',  l: '🇺🇸 English' },
        { v: 'ja',  l: '🇯🇵 日本語' },
        { v: 'zh',  l: '🇨🇳 中文' },
        { v: 'ko',  l: '🇰🇷 한국어' },
        { v: 'fr',  l: '🇫🇷 Français' },
        { v: 'es',  l: '🇪🇸 Español' },
        { v: 'de',  l: '🇩🇪 Deutsch' },
        { v: 'th',  l: '🇹🇭 ภาษาไทย' },
        { v: 'ru',  l: '🇷🇺 Русский' },
        { v: 'ar',  l: '🇸🇦 العربية' },
        { v: 'pt',  l: '🇧🇷 Português' },
        { v: 'it',  l: '🇮🇹 Italiano' },
        { v: 'id',  l: '🇮🇩 Bahasa Indonesia' },
    ];
    const OV_PRESETS = ['broadcast','voice','podcast','raw'];

    // ── Omni Voice helpers ────────────────────────────────────────────────────
    const ovFetch = async (path, opts = {}) => {
        const r = await fetch(`${OV_BASE}${path}`, opts);
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r;
    };

    const ovCheckConnection = async () => {
        setOvConnecting(true);
        try {
            await ovFetch('/model/status');
            setOvConnected(true);
            setOvStartError('');
            // Load profiles + engine info after connect
            const [pr, er] = await Promise.all([ovFetch('/profiles'), ovFetch('/engines/tts')]);
            const profiles = await pr.json();
            const engines  = await er.json();
            setOvProfiles(profiles?.profiles || profiles || []);
            setOvEngineActive(engines?.active || '');
            try {
                const hist = await (await ovFetch('/history')).json();
                setOvHistory((hist?.history || hist || []).slice(0, 30));
            } catch {}
        } catch { setOvConnected(false); }
        finally  { setOvConnecting(false); }
    };

    // Khởi động backend tự động rồi poll cho đến khi kết nối được
    const ovStartAndConnect = async () => {
        if (ovConnected || ovStarting) return;
        setOvStarting(true);
        setOvStartError('');
        setOvLogs([]);

        // Lắng nghe log từ backend (chỉ đăng ký 1 lần duy nhất)
        if (!ovLogListened.current) {
            ovLogListened.current = true;
            window.electronAPI?.onOmniVoiceLog?.((entry) => {
                setOvLogs(prev => [...prev.slice(-60), entry]);
            });
        }

        // Load đường dẫn đã lưu
        const savedDir = await window.electronAPI?.omniVoiceGetDir?.() || '';
        if (savedDir) setOvDir(savedDir);

        // Thử kết nối trực tiếp (backend có thể đang chạy sẵn)
        try {
            await ovFetch('/model/status');
            // Đang chạy rồi!
            setOvConnected(true);
            setOvStarting(false);
            const [pr, er] = await Promise.all([ovFetch('/profiles'), ovFetch('/engines/tts')]);
            setOvProfiles((await pr.json())?.profiles || []);
            setOvEngineActive((await er.json())?.active || '');
            return;
        } catch {}

        // Chưa chạy → yêu cầu Electron spawn process
        const startResult = await window.electronAPI?.omniVoiceStart?.() || {};
        if (!startResult.success && !startResult.alreadyRunning) {
            setOvStartError(startResult.error || 'Không thể khởi động OmniVoice');
            setOvStarting(false);
            return;
        }

        // Poll kết nối mỗi 2s, tối đa 45s (backend cần tải model ML)
        let attempts = 0;
        const MAX_ATTEMPTS = 22;
        if (ovPollRef.current) clearInterval(ovPollRef.current);
        ovPollRef.current = setInterval(async () => {
            attempts++;
            try {
                await ovFetch('/model/status');
                clearInterval(ovPollRef.current);
                ovPollRef.current = null;
                setOvConnected(true);
                setOvStarting(false);
                // Load data sau khi kết nối
                try {
                    const [pr, er] = await Promise.all([ovFetch('/profiles'), ovFetch('/engines/tts')]);
                    setOvProfiles((await pr.json())?.profiles || []);
                    setOvEngineActive((await er.json())?.active || '');
                } catch {}
            } catch {
                if (attempts >= MAX_ATTEMPTS) {
                    clearInterval(ovPollRef.current);
                    ovPollRef.current = null;
                    setOvStarting(false);
                    setOvConnected(false);
                    setOvStartError('Hết thời gian chờ (45s). Kiểm tra log bên dưới để biết lỗi.');
                }
            }
        }, 2000);
    };

    const ovStopBackend = async () => {
        if (ovPollRef.current) { clearInterval(ovPollRef.current); ovPollRef.current = null; }
        await window.electronAPI?.omniVoiceStop?.();
        setOvConnected(false);
        setOvStarting(false);
    };

    const ovChangeDir = async () => {
        const result = await window.electronAPI?.omniVoiceSelectDir?.();
        if (result?.success) {
            setOvDir(result.dir);
            setOvLogs([]);
            setOvStartError('');
        }
    };

    const ovLoadProfiles = async () => {
        try {
            const r = await (await ovFetch('/profiles')).json();
            setOvProfiles(r?.profiles || r || []);
        } catch {}
    };

    const ovGenerate = async () => {
        if (!ovText.trim()) return;
        setOvGenerating(true);
        if (ovAudioUrl) { URL.revokeObjectURL(ovAudioUrl); setOvAudioUrl(null); }
        try {
            const fd = new FormData();
            fd.append('text', ovText.trim());
            if (ovLanguage)        fd.append('language', ovLanguage);
            if (ovSelectedProfile) fd.append('profile_id', ovSelectedProfile);
            if (ovInstruct)        fd.append('instruct', ovInstruct);
            fd.append('num_step',       String(ovNumStep));
            fd.append('guidance_scale', String(ovGuidance));
            fd.append('speed',          String(ovSpeed));
            fd.append('effect_preset',  ovEffectPreset);
            const r = await fetch(`${OV_BASE}/generate`, { method: 'POST', body: fd });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const blob   = await r.blob();
            const url    = URL.createObjectURL(blob);
            const audioId = r.headers.get('X-Audio-Id') || '';
            const genMs   = r.headers.get('X-Generation-Time') || '';
            setOvAudioUrl(url);
            setOvAudioDur(genMs ? `${(+genMs/1000).toFixed(1)}s` : '');
            // Save to disk if folder selected
            if (ovOutputFolder && window.electronAPI?.saveBlobToFolder) {
                const arr = await blob.arrayBuffer();
                const name = `omni_${Date.now()}.wav`;
                await window.electronAPI.saveBlobToFolder(ovOutputFolder, name, Array.from(new Uint8Array(arr)));
            }
            // Refresh history
            const hist = await (await ovFetch('/history')).json();
            setOvHistory((hist?.history || hist || []).slice(0, 30));
        } catch (e) {
            alert('Lỗi tạo giọng: ' + e.message);
        } finally { setOvGenerating(false); }
    };

    const ovCreateProfile = async () => {
        if (!ovProfName.trim() || !ovRefFile) return alert('Cần nhập tên và chọn file audio tham chiếu!');
        setOvCreatingProf(true);
        try {
            const fd = new FormData();
            fd.append('name',      ovProfName.trim());
            fd.append('ref_audio', ovRefFile);
            if (ovRefText)      fd.append('ref_text',  ovRefText);
            if (ovProfInstruct) fd.append('instruct',  ovProfInstruct);
            if (ovProfLang)     fd.append('language',  ovProfLang);
            const r = await fetch(`${OV_BASE}/profiles`, { method: 'POST', body: fd });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const prof = await r.json();
            setOvProfiles(p => [prof, ...p]);
            setOvSelectedProfile(prof.id);
            setOvProfName(''); setOvRefFile(null); setOvRefFileName(''); setOvRefText(''); setOvProfInstruct('');
            alert(`✅ Tạo hồ sơ giọng "${prof.name}" thành công!`);
            setOvSection('generate');
        } catch (e) { alert('Lỗi tạo hồ sơ: ' + e.message); }
        finally { setOvCreatingProf(false); }
    };

    const ovDeleteProfile = async (id, name) => {
        if (!confirm(`Xoá hồ sơ giọng "${name}"?`)) return;
        try {
            await ovFetch(`/profiles/${id}`, { method: 'DELETE' });
            setOvProfiles(p => p.filter(x => x.id !== id));
            if (ovSelectedProfile === id) setOvSelectedProfile('');
        } catch (e) { alert('Lỗi xoá: ' + e.message); }
    };

    const ovSaveAudio = async () => {
        if (!ovAudioUrl) return;
        setOvSaving(true);
        try {
            const folder = ovOutputFolder || await window.electronAPI?.selectFolder?.();
            if (!folder) return;
            if (!ovOutputFolder) setOvOutputFolder(folder);
            const r = await fetch(ovAudioUrl);
            const arr = Array.from(new Uint8Array(await r.arrayBuffer()));
            const name = `omni_${Date.now()}.wav`;
            await window.electronAPI?.saveBlobToFolder?.(folder, name, arr);
            alert(`✅ Đã lưu: ${folder}\\${name}`);
        } catch (e) { alert('Lỗi lưu file: ' + e.message); }
        finally { setOvSaving(false); }
    };

    useEffect(() => {
        if (subTab === 'omnivoice' && !ovConnected && !ovStarting) {
            ovStartAndConnect();
        }
        // Cleanup poll khi unmount
        return () => {
            if (ovPollRef.current) { clearInterval(ovPollRef.current); ovPollRef.current = null; }
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
            result = await window.electronAPI.generateSRTVoice({ segments: srtSegments, voice: selectedVoice, outputPath });
        } else {
            addVoiceLog(`🎙️ [Edge TTS] Bắt đầu tạo giọng · ${text.length} ký tự · giọng: ${selectedVoice.split('-').pop()}`, 'info');
            const interval = setInterval(() => setProgress(p => p < 90 ? p + Math.floor(Math.random() * 10) + 5 : p), 400);
            result = await window.electronAPI.generateVoice({ text, voice: selectedVoice, outputPath });
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
        // Load Zalo TTS keys + history
        const zKeys = localStorage.getItem(ZALO_LS_KEYS);
        if (zKeys) { try { setZaloApiKeys(JSON.parse(zKeys)); } catch (_) {} }
        const zHist = localStorage.getItem(ZALO_LS_HIST);
        if (zHist) { try { setZaloHistory(JSON.parse(zHist)); } catch (_) {} }
        window.electronAPI.getDownloadsDir().then(dir => setZaloOutputFolder(dir || 'D:\\Audio'));
        // Zalo SRT progress
        window.electronAPI.onZaloSRTProgress(data => {
            setZaloSrtProgress(data);
        });
        return () => {
            elAudioRef.current.pause();
            zaloAudioRef.current.pause();
            window.electronAPI.removeAllListeners('zalo-srt-progress');
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

    // ── ZALO TTS HANDLERS ────────────────────────────────────────────────────
    const saveZaloKeys = (keys) => { setZaloApiKeys(keys); localStorage.setItem(ZALO_LS_KEYS, JSON.stringify(keys)); };

    const handleAddZaloKey = async () => {
        const key = zaloNewKey.trim();
        if (!key || zaloApiKeys.find(k => k.key === key)) return;
        setZaloCheckingKey(true);
        try {
            const result = await window.electronAPI.zaloCheckKey(key);
            if (!result.valid) { alert(`Key không hợp lệ: ${result.error || 'Lỗi không xác định'}`); setZaloCheckingKey(false); return; }
            saveZaloKeys([...zaloApiKeys, { key, status: 'valid' }]);
            setZaloNewKey('');
        } catch (e) { alert('Lỗi kiểm tra key: ' + e.message); }
        setZaloCheckingKey(false);
    };

    const handleRemoveZaloKey = (key) => saveZaloKeys(zaloApiKeys.filter(k => k.key !== key));

    const handleRefreshZaloKey = async (keyObj) => {
        try {
            const result = await window.electronAPI.zaloCheckKey(keyObj.key);
            saveZaloKeys(zaloApiKeys.map(k => k.key === keyObj.key ? { ...k, status: result.valid ? 'valid' : (result.quota ? 'quota' : 'invalid') } : k));
        } catch (_) {}
    };

    const handleZaloPreview = async (e, voice) => {
        e.stopPropagation();
        if (zaloPreviewingId === voice.id) {
            zaloAudioRef.current.pause();
            setZaloPreviewingId(null);
            return;
        }
        const validKey = zaloApiKeys.find(k => k.status === 'valid');
        if (!validKey) return alert('Cần thêm API key hợp lệ để nghe thử!');
        setZaloPreviewingId(voice.id);
        try {
            const res = await window.electronAPI.zaloPreview({ speakerId: voice.id, apiKey: validKey.key });
            if (!res.success) {
                setZaloPreviewingId(null);
                alert(`Giọng "${voice.name}" không khả dụng với key này.\n${res.error || ''}`);
                return;
            }
            const byteArr = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0));
            const blob = new Blob([byteArr], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            zaloAudioRef.current.pause();
            zaloAudioRef.current.src = url;
            zaloAudioRef.current.play();
            zaloAudioRef.current.onended = () => { setZaloPreviewingId(null); URL.revokeObjectURL(url); };
        } catch (err) {
            setZaloPreviewingId(null);
            alert(`Lỗi nghe thử: ${err.message}`);
        }
    };

    const handleZaloPlayHistory = (item) => {
        if (zaloPlayingId === item.id) { zaloAudioRef.current.pause(); setZaloPlayingId(null); return; }
        setZaloPlayingId(item.id);
        zaloAudioRef.current.src = `file:///${encodeURI(item.path.replace(/\\/g, '/'))}`;
        zaloAudioRef.current.play();
        zaloAudioRef.current.onended = () => setZaloPlayingId(null);
    };

    const handleZaloGenerate = async () => {
        if (!zaloText.trim()) return alert('Vui lòng nhập văn bản!');
        if (!zaloSelectedVoice) return alert('Vui lòng chọn giọng nói!');
        if (!zaloOutputFolder) return alert('Vui lòng chọn thư mục lưu!');
        const validKey = zaloApiKeys.find(k => k.status === 'valid');
        if (!validKey) return alert('Không có API key hợp lệ! Vui lòng thêm key Zalo TTS.');
        setZaloIsGenerating(true); setZaloProgress(20);
        const safeName = zaloProjectName.trim() ? zaloProjectName.replace(/[^a-z0-9_-]/gi, '_') : `zalo_tts_${Date.now()}`;
        const cleanFolder = zaloOutputFolder.endsWith('\\') || zaloOutputFolder.endsWith('/') ? zaloOutputFolder.slice(0, -1) : zaloOutputFolder;
        const outputPath = `${cleanFolder}\\${safeName}.mp3`;
        try {
            let res;
            if (zaloSrtSegments && zaloSrtSegments.length > 0) {
                addVoiceLog(`🔵 [Zalo TTS] Bắt đầu SRT — ${zaloSrtSegments.length} đoạn · ${zaloSelectedVoice.name}`, 'info');
                setZaloSrtProgress({ done: 0, total: zaloSrtSegments.length, text: 'Khởi động...' });
                res = await window.electronAPI.zaloGenerateSRT({ segments: zaloSrtSegments, speakerId: zaloSelectedVoice.id, speed: zaloSpeed, apiKey: validKey.key, outputPath });
            } else {
                addVoiceLog(`🔵 [Zalo TTS] Bắt đầu · ${zaloText.length} ký tự · ${zaloSelectedVoice.name}`, 'info');
                setZaloProgress(40);
                res = await window.electronAPI.zaloGenerate({ text: zaloText, speakerId: zaloSelectedVoice.id, speed: zaloSpeed, apiKey: validKey.key, outputPath });
            }
            setZaloProgress(100);
            if (!res.success) throw new Error(res.error);
            addVoiceLog(`✅ [Zalo TTS] Đã lưu: ${outputPath}`, 'success');
            const item = { id: Date.now(), name: safeName, path: outputPath, voice: zaloSelectedVoice.name, time: new Date().toLocaleTimeString() };
            const newHist = [item, ...zaloHistory].slice(0, 30);
            setZaloHistory(newHist); localStorage.setItem(ZALO_LS_HIST, JSON.stringify(newHist));
        } catch (e) {
            addVoiceLog(`❌ [Zalo TTS] Lỗi: ${e.message}`, 'error');
            alert('Lỗi tạo giọng: ' + e.message);
        }
        setTimeout(() => { setZaloIsGenerating(false); setZaloProgress(0); setZaloSrtProgress({ done: 0, total: 0, text: '' }); }, 400);
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

    const handleElPlayHistory = (item) => {
        if (elPlayingId === item.id) { elAudioRef.current.pause(); setElPlayingId(null); return; }
        setElPlayingId(item.id);
        elAudioRef.current.src = `file:///${encodeURI(item.path.replace(/\\/g, '/'))}`;
        elAudioRef.current.play();
        elAudioRef.current.onended = () => setElPlayingId(null);
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
                // Plain text mode
                addVoiceLog(`⚡ [ElevenLabs] Bắt đầu tạo giọng · ${elText.length} ký tự · giọng: ${elSelectedVoice.name}`, 'info');
                setElProgress(30);
                const ttsRes = await window.electronAPI.elTTS({
                    text: elText, voiceId: elSelectedVoice.voice_id,
                    stability: elStability, similarity: elSimilarity, style: elStyle, userKeys: elApiKeys
                });
                setElProgress(75);
                if (!ttsRes.success) throw new Error(ttsRes.error);
                setElLastKeyInfo(ttsRes.keyInfo || '');
                addVoiceLog(`✅ [ElevenLabs] Thành công · ${ttsRes.keyInfo || ''}`, 'success');
                const saveResult = await window.electronAPI.saveElevenLabsAudio({ base64: ttsRes.base64, outputPath });
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

    const elFilteredVoices = useMemo(() => elVoices.filter(v => {
        const matchSearch = !elSearchQuery || v.name?.toLowerCase().includes(elSearchQuery.toLowerCase()) ||
            Object.values(v.labels || {}).join(' ').toLowerCase().includes(elSearchQuery.toLowerCase());
        const accent = (v.labels?.accent || v.labels?.language || '').toLowerCase();
        const matchAccent = elAccentFilter === 'All' || accent === elAccentFilter.toLowerCase();
        return matchSearch && matchAccent;
    }), [elVoices, elSearchQuery, elAccentFilter]);

    const elAccents = useMemo(() => {
        const s = new Set();
        elVoices.forEach(v => { if (v.labels?.accent) s.add(v.labels.accent); });
        return Array.from(s).sort();
    }, [elVoices]);

    const elTotalRemaining = elApiKeys.filter(k => k.status === 'valid').reduce((s, k) => s + (k.remaining || 0), 0);

    // =========================================================================
    // ===  ZALO TTS STATE  ====================================================
    // =========================================================================
    const [zaloApiKeys, setZaloApiKeys] = useState([]);
    const [zaloNewKey, setZaloNewKey] = useState('');
    const [zaloCheckingKey, setZaloCheckingKey] = useState(false);
    const [zaloSelectedVoice, setZaloSelectedVoice] = useState(ZALO_VOICES[1]);
    const [zaloText, setZaloText] = useState('');
    const [zaloProjectName, setZaloProjectName] = useState('');
    const [zaloOutputFolder, setZaloOutputFolder] = useState('');
    const [zaloSpeed, setZaloSpeed] = useState(1.0);
    const [zaloIsGenerating, setZaloIsGenerating] = useState(false);
    const [zaloProgress, setZaloProgress] = useState(0);
    const [zaloHistory, setZaloHistory] = useState([]);
    const [zaloSrtSegments, setZaloSrtSegments] = useState(null);
    const [zaloSrtProgress, setZaloSrtProgress] = useState({ done: 0, total: 0, text: '' });
    const [zaloPlayingId, setZaloPlayingId] = useState(null);
    const [zaloPreviewingId, setZaloPreviewingId] = useState(null);
    const zaloAudioRef = useRef(new Audio());

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
    const gmAudioRef = useRef(new Audio());

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
            // ── Plain text mode ─────────────────────────────────────────────────
            if (!gmText.trim()) { setGmIsGenerating(false); return alert('Nhập văn bản cần đọc!'); }
            addVoiceLog(`🎙️ [Gemini TTS] Đang tạo giọng — Voice: ${gmVoice} · ${gmText.trim().length} ký tự`);
            const result = await window.electronAPI.geminiTTS({
                text: gmText.trim(),
                voiceName: gmVoice,
                apiKey,
                outputFolder: folder,
                projectName: safeName,
            });
            if (result.success) {
                addVoiceLog(`✅ Đã tạo: ${result.fileName}`, 'success');
                const entry = { id: Date.now(), path: result.path, name: result.fileName, voice: gmVoice, text: gmText.trim().slice(0, 80), time: new Date().toLocaleTimeString() };
                saveGmHistory([entry, ...gmHistory]);
            } else {
                addVoiceLog(`❌ Lỗi: ${result.error}`, 'error');
                alert('Lỗi: ' + result.error);
            }
        }

        setGmIsGenerating(false);
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
            apiKey,
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
                <button onClick={() => setSubTab('zalotts')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'zalotts' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <MessageSquare size={16} /> Zalo TTS
                </button>
                <button onClick={() => setSubTab('gemini')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'gemini' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Sparkles size={16} /> Gemini TTS
                </button>
                <button onClick={() => setSubTab('omnivoice')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'omnivoice' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Volume2 size={16} /> Omni Voice
                    {ovConnected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"/>}
                </button>
            </div>

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: EDGE TTS  ════════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'edge' && (
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
                    {/* CỘT TRÁI */}
                    <div className="flex flex-col w-[45%] h-full shrink-0 min-h-0">
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

                        <div className={`flex-1 flex flex-col mb-4 bg-[#141c2f] rounded-xl shadow-sm min-h-0 overflow-hidden border transition-colors ${srtSegments && srtSegments.length > 0 ? 'border-emerald-500/30' : 'border-slate-800'}`}>
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
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">

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
                                {elAccents.length > 0 && (
                                    <div className="relative shrink-0">
                                        <select value={elAccentFilter} onChange={e => setElAccentFilter(e.target.value)} className="bg-[#1e293b] border border-slate-700 rounded-lg px-3 py-2 pr-7 text-xs text-white focus:outline-none appearance-none">
                                            <option value="All">Tất cả giọng</option>
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
            {/* ══  TAB: ZALO TTS  ════════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'zalotts' && (
                <div className="flex flex-1 p-6 gap-6 overflow-hidden min-h-0">
                    {/* ── CỘT TRÁI ──────────────────────────────────────────── */}
                    <div className="w-[370px] shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-2">
                        {/* API Keys */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 shrink-0 space-y-3">
                            <div className="flex items-center gap-2 mb-1">
                                <Key size={12} className="text-cyan-400" />
                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">API Key Zalo TTS</span>
                            </div>
                            <div className="flex gap-2">
                                <input type="password" value={zaloNewKey} onChange={e => setZaloNewKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddZaloKey()} placeholder="Dán API key Zalo vào đây..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-colors" />
                                <button onClick={handleAddZaloKey} disabled={zaloCheckingKey || !zaloNewKey.trim()} className="bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors shrink-0">
                                    {zaloCheckingKey ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />} Thêm
                                </button>
                            </div>
                            {/* Hướng dẫn */}
                            <div className="bg-[#0a0f1e] border border-cyan-500/20 rounded-lg p-2.5 space-y-1.5">
                                <p className="text-[10px] font-bold text-cyan-300 flex items-center gap-1.5">🆓 Cách lấy key Zalo TTS miễn phí:</p>
                                <ol className="text-[10px] text-slate-400 space-y-0.5 pl-4 list-decimal leading-relaxed">
                                    <li>Vào <button onClick={() => window.electronAPI.openExternal('https://ai.zalo.solutions')} className="text-cyan-400 hover:text-cyan-300 underline decoration-dotted transition-colors">ai.zalo.solutions</button> → Đăng nhập Zalo</li>
                                    <li>Click <span className="text-yellow-400 font-semibold">avatar/tên</span> góc trên phải → chọn <span className="text-yellow-400 font-semibold">Account</span></li>
                                    <li>Sidebar trái → click <span className="text-yellow-400 font-semibold">Manage Keys</span></li>
                                    <li>Copy chuỗi <span className="text-yellow-400 font-semibold">API Key</span> → dán vào ô trên → bấm <span className="text-yellow-400 font-semibold">Thêm</span></li>
                                </ol>
                                <p className="text-[9px] text-slate-500">⚠️ Free: 2.000 ký tự/tháng · Nâng cấp tại Account → API Quota để mua thêm</p>
                            </div>
                            {/* Key list */}
                            {zaloApiKeys.length > 0 && (
                                <div className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar">
                                    {zaloApiKeys.map((k, i) => (
                                        <div key={i} className="flex items-center gap-2 bg-[#0f172a] rounded-lg px-3 py-1.5">
                                            <div className={`w-2 h-2 rounded-full shrink-0 ${k.status === 'valid' ? 'bg-cyan-500 animate-pulse' : k.status === 'quota' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                                            <span className="flex-1 text-[10px] text-slate-400 font-mono truncate">{k.key.substring(0, 8)}...{k.key.slice(-4)}</span>
                                            <span className={`text-[9px] shrink-0 font-bold ${k.status === 'valid' ? 'text-cyan-500' : k.status === 'quota' ? 'text-yellow-500' : 'text-red-400'}`}>{k.status === 'valid' ? 'Hoạt động' : k.status === 'quota' ? 'Hết hạn mức' : 'Không hợp lệ'}</span>
                                            <button onClick={() => handleRefreshZaloKey(k)} className="text-slate-600 hover:text-cyan-400 shrink-0 transition-colors"><RefreshCw size={10} /></button>
                                            <button onClick={() => handleRemoveZaloKey(k.key)} className="text-slate-600 hover:text-red-400 shrink-0 transition-colors"><Trash2 size={10} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Speed */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 shrink-0">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Sliders size={12} className="text-cyan-400" /> Tốc độ đọc</label>
                                <span className="text-sm font-bold text-cyan-400">{zaloSpeed.toFixed(1)}x</span>
                            </div>
                            <input type="range" min="0.5" max="2.0" step="0.1" value={zaloSpeed} onChange={e => setZaloSpeed(parseFloat(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-cyan-500" />
                            <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>0.5x chậm</span><span>1.0x bình thường</span><span>2.0x nhanh</span></div>
                        </div>
                        {/* Text input */}
                        <div className="bg-[#141c2f] border border-cyan-500/20 rounded-xl flex flex-col overflow-hidden shrink-0">
                            <div className="flex justify-between items-center px-4 py-2.5 border-b border-cyan-500/10 shrink-0 bg-[#1a233a]/60">
                                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2"><Volume2 size={14} className="text-cyan-400" /> Văn bản cần đọc</label>
                                <div className="flex items-center gap-2">
                                    {zaloSrtSegments && zaloSrtSegments.length > 0 && (() => {
                                        const info = formatSRTInfo(zaloSrtSegments);
                                        return <span className="text-[10px] px-2 py-0.5 bg-cyan-900/50 border border-cyan-600/40 text-cyan-300 rounded-full font-bold">📋 SRT · {info.count} đoạn · {info.duration}{info.needsSpeed && ' · ⚡ tự tăng tốc'}</span>;
                                    })()}
                                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${zaloText.length > 0 ? 'bg-cyan-900/30 text-cyan-300' : 'text-slate-500'}`}>{zaloText.length.toLocaleString()} ký tự</span>
                                </div>
                            </div>
                            <textarea value={zaloText} onChange={e => { const v = e.target.value; setZaloText(v); if (isSRTContent(v)) { const s = parseSRT(v); setZaloSrtSegments(s.length > 0 ? s : null); } else setZaloSrtSegments(null); }} placeholder="Dán nội dung cần đọc...&#10;&#10;💡 Hỗ trợ file .SRT để đồng bộ giọng với mốc thời gian." className="w-full bg-transparent p-4 text-sm text-slate-200 focus:outline-none resize-y leading-relaxed custom-scrollbar placeholder-slate-600" style={{ height: '180px', minHeight: '100px', maxHeight: '350px' }} />
                            {zaloSrtSegments && zaloSrtProgress.total > 0 && (
                                <div className="px-4 pb-2 shrink-0">
                                    <div className="flex justify-between text-[10px] text-cyan-400 font-bold mb-1"><span>{zaloSrtProgress.text}</span><span>{zaloSrtProgress.done}/{zaloSrtProgress.total}</span></div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${zaloSrtProgress.total > 0 ? (zaloSrtProgress.done / zaloSrtProgress.total) * 100 : 0}%` }} /></div>
                                </div>
                            )}
                        </div>
                        {/* Output */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl p-4 space-y-3 shrink-0">
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Tên file đầu ra</label>
                                <input type="text" value={zaloProjectName} onChange={e => setZaloProjectName(e.target.value)} placeholder="VD: zalo_audio_01 (để trống tự tạo)" className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors" />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Thư mục lưu</label>
                                <div className="flex gap-2">
                                    <input type="text" readOnly value={zaloOutputFolder} className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 truncate focus:outline-none" />
                                    <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setZaloOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg transition-colors"><FolderOpen size={15} /></button>
                                </div>
                            </div>
                        </div>
                        {/* Generate button */}
                        <div className="shrink-0 relative">
                            {zaloIsGenerating && (
                                <div className="absolute -top-5 left-0 right-0 flex justify-between text-xs font-bold text-cyan-400">
                                    <span>{zaloSrtSegments && zaloSrtProgress.total > 0 ? zaloSrtProgress.text : 'Đang xử lý...'}</span>
                                    <span>{zaloProgress}%</span>
                                </div>
                            )}
                            <button onClick={handleZaloGenerate} disabled={zaloIsGenerating || !zaloSelectedVoice || !zaloApiKeys.find(k => k.status === 'valid')} className="relative w-full bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 overflow-hidden transition-all shadow-lg shadow-cyan-900/20 disabled:shadow-none">
                                {zaloIsGenerating && <div className="absolute left-0 top-0 bottom-0 bg-white/10 transition-all duration-300" style={{ width: `${zaloProgress}%` }} />}
                                <span className="relative z-10 flex items-center gap-2">
                                    {zaloIsGenerating ? <RefreshCw size={18} className="animate-spin" /> : <MessageSquare size={18} />}
                                    {zaloIsGenerating
                                        ? (zaloSrtSegments ? `ĐANG TẠO SRT ${zaloSrtProgress.done}/${zaloSrtProgress.total}...` : 'ĐANG TẠO...')
                                        : !zaloApiKeys.find(k => k.status === 'valid') ? 'THÊM API KEY ĐỂ SỬ DỤNG'
                                        : zaloSrtSegments ? `📋 TẠO SRT VOICE (${zaloSrtSegments.length} đoạn)` : `TẠO GIỌNG · ${zaloSelectedVoice?.name || ''}`}
                                </span>
                            </button>
                        </div>
                        {/* History */}
                        <div className="bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shrink-0 overflow-hidden" style={{ maxHeight: '170px' }}>
                            <div className="p-3 border-b border-slate-800 flex items-center gap-2 shrink-0"><History size={14} className="text-cyan-400" /><h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Lịch sử Zalo TTS</h3></div>
                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                                {zaloHistory.length === 0 ? <p className="text-center text-[11px] text-slate-500 mt-4">Chưa có file nào.</p> : zaloHistory.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 hover:bg-[#1e293b] rounded-lg border-b border-slate-800/50 last:border-0 group transition-colors">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <button onClick={() => handleZaloPlayHistory(item)} className="w-7 h-7 rounded-full bg-slate-700 hover:bg-cyan-600 text-white flex items-center justify-center shrink-0 transition-colors">{zaloPlayingId === item.id ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" className="ml-0.5" />}</button>
                                            <div className="truncate"><p className="text-xs font-bold text-slate-200 truncate">{item.name}.mp3</p><p className="text-[10px] text-slate-500">{item.voice} · {item.time}</p></div>
                                        </div>
                                        <button onClick={() => window.electronAPI.openFolder(item.path.substring(0, item.path.lastIndexOf('\\')))} className="p-1.5 text-slate-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><FolderOpen size={13} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {/* ── CỘT PHẢI: VOICE LIBRARY ───────────────────────────── */}
                    <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col overflow-hidden min-h-0 shadow-sm">
                        <div className="p-4 border-b border-slate-800 bg-[#1a233a] flex justify-between items-center shrink-0">
                            <h3 className="text-sm font-bold text-white">Thư viện Giọng Zalo TTS</h3>
                            <span className="text-xs font-bold px-3 py-1 bg-slate-800 text-slate-300 rounded-lg border border-slate-700">{ZALO_VOICES.length} giọng</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                                {ZALO_VOICES.map(v => {
                                    const isSelected = zaloSelectedVoice?.id === v.id;
                                    return (
                                        <div key={v.id} onClick={() => setZaloSelectedVoice(v)} className={`relative group flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${isSelected ? 'bg-cyan-900/20 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]' : 'bg-[#1e293b]/50 border-slate-700/50 hover:bg-[#1e293b] hover:border-slate-600'}`}>
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${isSelected ? 'bg-cyan-500/20 border-cyan-500/30' : 'bg-slate-800 border-slate-700'}`}>
                                                <User size={18} className={v.gender === 'female' ? 'text-pink-400' : 'text-blue-400'} />
                                            </div>
                                            <div className="flex-1 min-w-0 pt-0.5">
                                                <p className={`text-sm font-bold truncate ${isSelected ? 'text-cyan-400' : 'text-slate-200 group-hover:text-white'}`}>{v.name}</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">{v.region}</p>
                                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold mt-1 inline-block ${v.gender === 'female' ? 'bg-pink-900/50 text-pink-400' : 'bg-blue-900/50 text-blue-400'}`}>{v.gender === 'female' ? 'Nữ' : 'Nam'}</span>
                                            </div>
                                            <button
                                                onClick={(e) => handleZaloPreview(e, v)}
                                                title="Nghe thử giọng"
                                                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all border ${zaloPreviewingId === v.id ? 'bg-cyan-500 border-cyan-400 text-white animate-pulse' : 'bg-slate-700/80 border-slate-600 text-slate-400 hover:bg-cyan-600 hover:border-cyan-500 hover:text-white opacity-0 group-hover:opacity-100'}`}
                                            >
                                                {zaloPreviewingId === v.id ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
                                            </button>
                                            {isSelected && <div className="absolute top-2 right-2 text-cyan-500 pointer-events-none"><CheckCircle2 size={14} fill="currentColor" className="text-cyan-900" /></div>}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="p-3 bg-[#0a0f1e] border border-cyan-500/10 rounded-lg text-[10px] text-slate-500 space-y-1">
                                <p className="font-bold text-slate-400">Về Zalo TTS:</p>
                                <p>• Chất lượng giọng tiếng Việt tự nhiên, phát âm chuẩn 3 miền.</p>
                                <p>• Tốc độ đọc điều chỉnh từ 0.5x đến 2.0x.</p>
                                <p>• Hỗ trợ SRT — tự động đồng bộ giọng với timeline.</p>
                                <p>• API miễn phí từ <button onClick={() => window.electronAPI.openExternal('https://zalo.ai')} className="text-cyan-500 hover:text-cyan-400 underline decoration-dotted">zalo.ai</button> → My Keys</p>
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
                                    placeholder="Tên file đầu ra (VD: doc_truyen_tap1)"
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
                            {gmIsGenerating && gmSrtSegments && gmSrtProgress.total > 0 && (
                                <div className="absolute -top-5 left-0 right-0 flex justify-between text-xs font-bold text-blue-400">
                                    <span className="truncate">{gmSrtProgress.text}</span>
                                    <span className="shrink-0 ml-2">{gmSrtProgress.done}/{gmSrtProgress.total}</span>
                                </div>
                            )}
                            <button onClick={handleGmGenerate}
                                disabled={gmIsGenerating || (!gmSrtSegments && !gmText.trim())}
                                className="relative w-full py-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg overflow-hidden
                                    bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500
                                    disabled:from-slate-700 disabled:to-slate-700 disabled:shadow-none text-white">
                                {gmIsGenerating && gmSrtSegments && gmSrtProgress.total > 0 && (
                                    <div className="absolute left-0 top-0 bottom-0 bg-white/10 transition-all duration-300"
                                        style={{ width: `${(gmSrtProgress.done / gmSrtProgress.total) * 100}%` }} />
                                )}
                                <span className="relative z-10 flex items-center gap-2">
                                    {gmIsGenerating
                                        ? <><Loader2 size={18} className="animate-spin"/>
                                            {gmSrtSegments ? `ĐANG TẠO SRT ${gmSrtProgress.done}/${gmSrtProgress.total}...` : 'ĐANG TẠO GIỌNG...'}</>
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
            )}

            {/* ════════════════════════════════════════════════════════════════ */}
            {/* ══  TAB: OMNI VOICE  ══════════════════════════════════════════ */}
            {/* ════════════════════════════════════════════════════════════════ */}
            {subTab === 'omnivoice' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

              {/* ── Connection bar ─────────────────────────────────────────── */}
              <div className="flex items-center gap-3 px-6 py-2 bg-[#0d1424] border-b border-slate-800 shrink-0 flex-wrap">
                {/* Status dot */}
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${ovConnected ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : ovStarting ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}/>
                <span className="text-[11px] font-bold text-slate-400">{OV_BASE}</span>
                <span className={`text-[10px] font-semibold ${ovConnected ? 'text-emerald-400' : ovStarting ? 'text-amber-400' : 'text-slate-600'}`}>
                  {ovConnected ? `● ONLINE${ovEngineActive ? ' · ' + ovEngineActive : ''}` : ovStarting ? '● Đang khởi động...' : '● OFFLINE'}
                </span>
                {/* Dir path (compact) */}
                {ovDir && !ovConnected && (
                  <span className="text-[9px] text-slate-700 truncate max-w-[220px]" title={ovDir}>{ovDir}</span>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {/* Change dir button */}
                  <button onClick={ovChangeDir} title="Đổi thư mục OmniVoice"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-400 transition-colors">
                    📁 Đổi đường dẫn
                  </button>
                  {/* Stop button (only when running) */}
                  {ovConnected && (
                    <button onClick={ovStopBackend}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-900/30 hover:bg-red-800/40 text-[10px] text-red-400 transition-colors border border-red-800/30">
                      ⏹ Dừng
                    </button>
                  )}
                  {/* Reconnect / Retry button */}
                  {!ovStarting && (
                    <button onClick={() => { setOvConnected(false); setOvStarting(false); setOvStartError(''); setTimeout(ovStartAndConnect, 100); }}
                      disabled={ovConnecting}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 transition-colors">
                      <RefreshCw size={11} className={ovConnecting ? 'animate-spin' : ''}/>
                      {ovConnected ? 'Làm mới' : 'Thử lại'}
                    </button>
                  )}
                </div>
              </div>

              {/* ── Starting / Error / Offline state ────────────────────────── */}
              {!ovConnected ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 overflow-y-auto custom-scrollbar">
                  {ovStarting ? (
                    /* STARTING STATE */
                    <div className="flex flex-col items-center gap-5 max-w-md w-full">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full bg-rose-500/10 border-2 border-rose-500/30 flex items-center justify-center">
                          <Volume2 size={36} className="text-rose-400 animate-pulse"/>
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-rose-500/20 animate-ping"/>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-bold text-slate-300 mb-1">Đang khởi động OmniVoice...</p>
                        <p className="text-xs text-slate-500">Chờ backend tải model (có thể mất 20–40 giây)</p>
                      </div>
                      {/* Mini log - last 6 lines */}
                      {ovLogs.length > 0 && (
                        <div className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 font-mono text-[10px] space-y-0.5 max-h-[120px] overflow-y-auto custom-scrollbar">
                          {ovLogs.slice(-6).map((l, i) => (
                            <div key={i} className={`leading-relaxed ${l.type === 'error' ? 'text-red-400' : l.type === 'warn' ? 'text-amber-400' : 'text-slate-500'}`}>
                              {l.text}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Progress dots */}
                      <div className="flex gap-1.5">
                        {[0,1,2,3,4].map(i => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-rose-500/40 animate-bounce"
                               style={{ animationDelay: `${i * 150}ms` }}/>
                        ))}
                      </div>
                    </div>
                  ) : ovStartError ? (
                    /* ERROR STATE */
                    <div className="flex flex-col items-center gap-4 max-w-lg w-full">
                      <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                        <AlertCircle size={32} className="text-red-400"/>
                      </div>
                      <p className="text-sm font-bold text-red-400">Không thể khởi động OmniVoice</p>
                      <div className="w-full bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-xs text-red-300">
                        {ovStartError}
                      </div>
                      {/* Full log */}
                      {ovLogs.length > 0 && (
                        <div className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-3 font-mono text-[10px] space-y-0.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                          {ovLogs.slice(-20).map((l, i) => (
                            <div key={i} className={`leading-relaxed ${l.type === 'error' ? 'text-red-400' : l.type === 'warn' ? 'text-amber-400' : 'text-slate-600'}`}>
                              <span className="text-slate-700 mr-1">{l.time}</span>{l.text}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-3">
                        <button onClick={ovChangeDir}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-xl font-semibold">
                          📁 Đổi đường dẫn
                        </button>
                        <button onClick={() => { setOvStartError(''); ovStartAndConnect(); }}
                          className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center gap-2">
                          <RefreshCw size={13}/> Thử lại
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-700 text-center">
                        Đảm bảo <code className="text-slate-500">uv</code> đã được cài và thư mục OmniVoice đúng.
                      </p>
                    </div>
                  ) : (
                    /* OFFLINE STATE (first load fallback) */
                    <div className="flex flex-col items-center gap-4 text-slate-600">
                      <Volume2 size={44} className="opacity-20"/>
                      <p className="text-sm font-bold text-slate-500">Đang kết nối OmniVoice...</p>
                      <button onClick={ovStartAndConnect}
                        className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-xl flex items-center gap-2">
                        <RefreshCw size={14}/> Khởi động
                      </button>
                    </div>
                  )}
                </div>
              ) : (
              <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* ── Left sidebar: sub-nav + profiles ───────────────────── */}
                <div className="w-52 shrink-0 border-r border-slate-800 flex flex-col bg-[#0a0f1e] overflow-y-auto custom-scrollbar">
                  <div className="p-3 space-y-1 shrink-0">
                    {[
                      { id:'generate', icon:'🎙', label:'Tạo giọng nói' },
                      { id:'clone',    icon:'🧬', label:'Clone giọng' },
                      { id:'profiles', icon:'👤', label:`Hồ sơ (${ovProfiles.length})` },
                      { id:'history',  icon:'📜', label:'Lịch sử' },
                    ].map(s => (
                      <button key={s.id} onClick={() => setOvSection(s.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-semibold text-left transition-all ${ovSection === s.id ? 'bg-rose-600/20 text-rose-300 border border-rose-700/40' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}>
                        <span>{s.icon}</span>{s.label}
                      </button>
                    ))}
                  </div>

                  {/* Quick profile list */}
                  {ovProfiles.length > 0 && (
                    <div className="mt-2 px-3 pb-3">
                      <p className="text-[9px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">Hồ sơ giọng</p>
                      <div className="space-y-1">
                        {ovProfiles.map(p => (
                          <button key={p.id} onClick={() => { setOvSelectedProfile(p.id); setOvSection('generate'); }}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all ${ovSelectedProfile === p.id ? 'bg-rose-700/20 border border-rose-700/40' : 'hover:bg-slate-800/60'}`}>
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                              {p.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-semibold text-slate-300 truncate">{p.name}</p>
                              <p className="text-[8px] text-slate-600">{p.kind || 'clone'}</p>
                            </div>
                            {ovSelectedProfile === p.id && <span className="text-rose-400 text-[8px]">✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Main content area ───────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">

                  {/* ── SECTION: Generate ─────────────────────────────────── */}
                  {ovSection === 'generate' && (<>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 bg-rose-500/10 rounded-lg flex items-center justify-center"><span className="text-base">🎙</span></div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-200">Tạo giọng nói</h3>
                        <p className="text-[10px] text-slate-600">OmniVoice · 646 ngôn ngữ · Zero-shot cloning</p>
                      </div>
                    </div>

                    {/* Text input */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Văn bản</label>
                      <textarea value={ovText} onChange={e => setOvText(e.target.value)} rows={5}
                        placeholder="Nhập văn bản cần chuyển thành giọng nói..."
                        className="w-full bg-[#0a1020] border border-slate-700/60 rounded-xl px-3 py-2.5 text-sm text-slate-300 resize-none focus:outline-none focus:border-rose-500/50 placeholder-slate-700"/>
                      <p className="text-[9px] text-slate-700 mt-1 text-right">{ovText.length} ký tự</p>
                    </div>

                    {/* Language + Profile */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Ngôn ngữ</label>
                        <select value={ovLanguage} onChange={e => setOvLanguage(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-2 outline-none">
                          {OV_LANGS.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Hồ sơ giọng</label>
                        <select value={ovSelectedProfile} onChange={e => setOvSelectedProfile(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-2 outline-none">
                          <option value="">— Không có (giọng mặc định) —</option>
                          {ovProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Voice instruction */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Voice instruction <span className="text-slate-700 normal-case font-normal">(tùy chọn: "warm", "sad", "excited"...)</span></label>
                      <input value={ovInstruct} onChange={e => setOvInstruct(e.target.value)}
                        placeholder='Ví dụ: warm and friendly, slow pace...'
                        className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-rose-500/40"/>
                    </div>

                    {/* Advanced controls */}
                    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3">
                      <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-3">Cài đặt nâng cao</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1 block">Diffusion Steps: <span className="text-rose-400 font-bold">{ovNumStep}</span></label>
                          <input type="range" min={4} max={32} step={4} value={ovNumStep} onChange={e => setOvNumStep(+e.target.value)}
                            className="w-full accent-rose-500 h-1"/>
                          <div className="flex justify-between text-[8px] text-slate-700 mt-0.5"><span>Nhanh (4)</span><span>Chất (32)</span></div>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1 block">Guidance Scale: <span className="text-rose-400 font-bold">{ovGuidance.toFixed(1)}</span></label>
                          <input type="range" min={1} max={5} step={0.5} value={ovGuidance} onChange={e => setOvGuidance(+e.target.value)}
                            className="w-full accent-rose-500 h-1"/>
                          <div className="flex justify-between text-[8px] text-slate-700 mt-0.5"><span>Thấp</span><span>Cao</span></div>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1 block">Tốc độ: <span className="text-rose-400 font-bold">{ovSpeed.toFixed(1)}x</span></label>
                          <input type="range" min={0.5} max={2} step={0.1} value={ovSpeed} onChange={e => setOvSpeed(+e.target.value)}
                            className="w-full accent-rose-500 h-1"/>
                          <div className="flex justify-between text-[8px] text-slate-700 mt-0.5"><span>0.5x</span><span>2.0x</span></div>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1.5 block">Effect Preset</label>
                          <select value={ovEffectPreset} onChange={e => setOvEffectPreset(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                            {OV_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Output folder */}
                    <div className="flex gap-2">
                      <div className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-2 text-[10px] text-slate-500 truncate">
                        {ovOutputFolder || 'Thư mục lưu (tùy chọn)...'}
                      </div>
                      <button onClick={async () => { const f = await window.electronAPI?.selectFolder?.(); if (f) setOvOutputFolder(f); }}
                        className="p-2 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors">
                        <FolderOpen size={13} className="text-slate-400"/>
                      </button>
                    </div>

                    {/* Generate button */}
                    <button onClick={ovGenerate} disabled={ovGenerating || !ovText.trim()}
                      className="w-full py-3 bg-gradient-to-r from-rose-600 to-violet-600 hover:from-rose-500 hover:to-violet-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-900/20">
                      {ovGenerating ? <><Loader2 size={14} className="animate-spin"/> Đang tạo giọng...</>
                                    : <><Volume2 size={14}/> ▶ Tạo giọng nói</>}
                    </button>

                    {/* Audio player */}
                    {ovAudioUrl && (
                      <div className="bg-slate-900/60 border border-rose-700/20 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-rose-300">✅ Tạo xong{ovAudioDur ? ` · ${ovAudioDur}` : ''}</span>
                          <div className="flex gap-2">
                            <button onClick={ovSaveAudio} disabled={ovSaving}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[10px] text-slate-300 transition-colors">
                              <Download size={11}/> {ovSaving ? 'Đang lưu...' : 'Lưu WAV'}
                            </button>
                          </div>
                        </div>
                        <audio ref={ovAudioRef} src={ovAudioUrl} controls autoPlay
                          className="w-full h-9 rounded-lg" style={{ colorScheme: 'dark' }}/>
                      </div>
                    )}
                  </>)}

                  {/* ── SECTION: Clone ────────────────────────────────────── */}
                  {ovSection === 'clone' && (<>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-8 h-8 bg-violet-500/10 rounded-lg flex items-center justify-center"><span className="text-base">🧬</span></div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-200">Clone giọng nói</h3>
                        <p className="text-[10px] text-slate-600">Upload 3 giây audio tham chiếu → tạo hồ sơ giọng riêng</p>
                      </div>
                    </div>

                    {/* Profile name */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Tên hồ sơ giọng <span className="text-rose-400">*</span></label>
                      <input value={ovProfName} onChange={e => setOvProfName(e.target.value)}
                        placeholder="Ví dụ: Giọng Nam, Giọng Thuyết minh..."
                        className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-violet-500/50"/>
                    </div>

                    {/* Reference audio upload */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Audio tham chiếu <span className="text-rose-400">*</span> <span className="text-slate-700 normal-case font-normal">(WAV/MP3, ≥3 giây)</span></label>
                      <div onClick={() => { const inp = document.createElement('input'); inp.type='file'; inp.accept='audio/*'; inp.onchange=e=>{ const f=e.target.files[0]; if(f){ setOvRefFile(f); setOvRefFileName(f.name); }}; inp.click(); }}
                        className="w-full border-2 border-dashed border-slate-700 hover:border-violet-500/60 rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer transition-all bg-slate-900/30 hover:bg-violet-900/10">
                        <FileAudio size={24} className={ovRefFile ? 'text-violet-400' : 'text-slate-600'}/>
                        <span className="text-xs text-slate-500">{ovRefFileName || 'Click để chọn file audio'}</span>
                        {ovRefFile && <span className="text-[10px] text-emerald-400">✓ Đã chọn</span>}
                      </div>
                    </div>

                    {/* Reference text */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Văn bản trong audio <span className="text-slate-700 normal-case font-normal">(tùy chọn, giúp cloning chính xác hơn)</span></label>
                      <textarea value={ovRefText} onChange={e => setOvRefText(e.target.value)} rows={2}
                        placeholder="Nội dung của đoạn audio tham chiếu..."
                        className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-300 resize-none focus:outline-none"/>
                    </div>

                    {/* Voice instruction */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Voice instruction <span className="text-slate-700 normal-case font-normal">(tùy chọn)</span></label>
                      <input value={ovProfInstruct} onChange={e => setOvProfInstruct(e.target.value)}
                        placeholder='Ví dụ: deep voice, slow pace, warm tone...'
                        className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none"/>
                    </div>

                    {/* Language */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Ngôn ngữ chính</label>
                      <select value={ovProfLang} onChange={e => setOvProfLang(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-2 outline-none">
                        {OV_LANGS.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
                      </select>
                    </div>

                    <button onClick={ovCreateProfile} disabled={ovCreatingProf || !ovProfName.trim() || !ovRefFile}
                      className="w-full py-3 bg-gradient-to-r from-violet-600 to-rose-600 hover:from-violet-500 hover:to-rose-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all">
                      {ovCreatingProf ? <><Loader2 size={14} className="animate-spin"/> Đang tạo hồ sơ...</>
                                      : <><Plus size={14}/> Tạo hồ sơ giọng</>}
                    </button>
                  </>)}

                  {/* ── SECTION: Profiles ─────────────────────────────────── */}
                  {ovSection === 'profiles' && (<>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center"><span className="text-base">👤</span></div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-200">Hồ sơ giọng nói</h3>
                          <p className="text-[10px] text-slate-600">{ovProfiles.length} hồ sơ đã lưu</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={ovLoadProfiles} className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
                          <RefreshCw size={12} className="text-slate-400"/>
                        </button>
                        <button onClick={() => setOvSection('clone')}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-[10px] font-bold rounded-lg transition-colors">
                          <Plus size={11}/> Thêm mới
                        </button>
                      </div>
                    </div>
                    {ovProfiles.length === 0 ? (
                      <div className="flex flex-col items-center py-12 text-slate-700 gap-3">
                        <User size={32} className="opacity-30"/>
                        <p className="text-sm">Chưa có hồ sơ nào</p>
                        <button onClick={() => setOvSection('clone')}
                          className="text-xs text-violet-400 hover:text-violet-300">+ Tạo hồ sơ đầu tiên</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ovProfiles.map(p => (
                          <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${ovSelectedProfile === p.id ? 'bg-rose-900/10 border-rose-700/30' : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700'}`}>
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                              {p.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-200 truncate">{p.name}</p>
                              <p className="text-[9px] text-slate-600">
                                {p.kind || 'clone'} · {p.language || 'Auto'}{p.instruct ? ` · "${p.instruct}"` : ''}
                              </p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              <button onClick={() => { setOvSelectedProfile(p.id); setOvSection('generate'); }}
                                className="px-2.5 py-1 bg-rose-700/30 hover:bg-rose-600/40 text-rose-300 text-[10px] font-bold rounded-lg transition-colors">
                                Dùng
                              </button>
                              <button onClick={() => ovDeleteProfile(p.id, p.name)}
                                className="p-1 hover:bg-red-900/30 rounded-lg text-slate-600 hover:text-red-400 transition-colors">
                                <Trash2 size={12}/>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>)}

                  {/* ── SECTION: History ──────────────────────────────────── */}
                  {ovSection === 'history' && (<>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center"><span className="text-base">📜</span></div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-200">Lịch sử tạo giọng</h3>
                          <p className="text-[10px] text-slate-600">{ovHistory.length} bản ghi gần nhất</p>
                        </div>
                      </div>
                      <button onClick={async () => { const h = await (await ovFetch('/history')).json(); setOvHistory((h?.history||h||[]).slice(0,30)); }}
                        className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg">
                        <RefreshCw size={12} className="text-slate-400"/>
                      </button>
                    </div>
                    {ovHistory.length === 0 ? (
                      <div className="flex flex-col items-center py-12 text-slate-700 gap-2">
                        <History size={32} className="opacity-30"/>
                        <p className="text-sm">Chưa có lịch sử nào</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ovHistory.map((h, i) => (
                          <div key={h.id || i} className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3 space-y-1.5">
                            <p className="text-xs text-slate-300 line-clamp-2">{h.text || h.input_text || '—'}</p>
                            <div className="flex items-center gap-3 text-[9px] text-slate-600">
                              <span>{h.language || 'Auto'}</span>
                              {h.profile_id && <span>· {h.profile_id.slice(0,8)}...</span>}
                              {h.duration_sec && <span>· {(+h.duration_sec).toFixed(1)}s</span>}
                              {h.created_at && <span className="ml-auto">{new Date(h.created_at * 1000).toLocaleString('vi')}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>)}

                </div>{/* end main content */}
              </div>/* end connected layout */
              )}
            </div>/* end omnivoice tab */
            )}
            {/* END TAB: OMNI VOICE */}

        </div>
    );
}
