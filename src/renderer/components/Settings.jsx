import React, { useState, useEffect } from 'react';
import {
    Wifi, WifiOff, HelpCircle, Download, Key, Shield,
    X, Loader2, CheckCircle2, AlertCircle, Plus, Trash2,
    RefreshCw, Globe, Settings as SettingsIcon, ChevronRight
} from 'lucide-react';

// ─── Sections available in Settings ─────────────────────────────────────────
const SECTIONS = [
    { id: 'extension', label: 'Extension',   sub: 'Cài vào Chrome',     icon: '🧩' },
    { id: 'apikey',    label: 'API Key',      sub: 'Gemini & ElevenLabs', icon: '🔑' },
    { id: 'proxy',     label: 'Proxy Xoay',  sub: 'Cấu hình proxy IP',  icon: '🔄' },
    { id: 'stockvideo',label: 'Stock Video',  sub: 'Pexels & Pixabay',   icon: '🎬' },
];

export default function Settings({ dark = true }) {
    const [activeSection, setActiveSection] = useState('extension');

    // ── Extension status ──────────────────────────────────────────────────────
    const [extConnected, setExtConnected] = useState(false);
    const [extCredits, setExtCredits]     = useState('Đang tải...');

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch('http://localhost:3000/api/system-status');
                if (res.ok) {
                    const d = await res.json();
                    setExtConnected(!!d.extensionConnected);
                    setExtCredits(d.credits || 'N/A');
                }
            } catch { setExtConnected(false); }
        };
        fetchStatus();
        const t = setInterval(fetchStatus, 4000);
        return () => clearInterval(t);
    }, []);

    // ── API Key (Gemini) ──────────────────────────────────────────────────────
    const LS_KEYS = 'fluxy_gemini_api_keys';
    const [geminiKeys, setGeminiKeys]     = useState([]);
    const [geminiInput, setGeminiInput]   = useState('');
    const [geminiSaved, setGeminiSaved]   = useState(false);

    useEffect(() => {
        const raw = localStorage.getItem(LS_KEYS);
        try { setGeminiKeys(JSON.parse(raw) || []); } catch { setGeminiKeys([]); }
    }, []);

    const saveGeminiKeys = (keys) => {
        localStorage.setItem(LS_KEYS, JSON.stringify(keys));
        setGeminiKeys(keys);
        setGeminiSaved(true);
        setTimeout(() => setGeminiSaved(false), 2000);
    };

    const handleGeminiApply = () => {
        const lines = geminiInput.split('\n').map(l => l.trim()).filter(Boolean);
        const merged = [...new Set([...geminiKeys, ...lines])];
        saveGeminiKeys(merged);
        setGeminiInput('');
    };

    const removeGeminiKey = (k) => saveGeminiKeys(geminiKeys.filter(x => x !== k));

    // ── ElevenLabs API keys (same storage as VoiceStudio: elevenlabs_api_keys_v3) ──
    const LS_EL = 'elevenlabs_api_keys_v3';
    const [elKeys, setElKeys]     = useState([]); // [{key, status, remaining, limit, used}]
    const [elInput, setElInput]   = useState('');
    const [elSaved, setElSaved]   = useState(false);
    const [elChecking, setElChecking] = useState(false);

    useEffect(() => {
        const raw = localStorage.getItem(LS_EL);
        try { setElKeys(JSON.parse(raw) || []); } catch { setElKeys([]); }
    }, []);

    const saveElKeys = (keys) => {
        localStorage.setItem(LS_EL, JSON.stringify(keys));
        setElKeys(keys);
        setElSaved(true);
        setTimeout(() => setElSaved(false), 2000);
    };

    const handleElApply = async () => {
        const key = elInput.trim();
        if (!key) return;
        if (elKeys.find(k => k.key === key)) { setElInput(''); return; }
        setElChecking(true);
        try {
            const res = await fetch('https://api.elevenlabs.io/v1/user', {
                headers: { 'xi-api-key': key },
            });
            if (!res.ok) { alert('API key ElevenLabs không hợp lệ!'); setElChecking(false); return; }
            const data = await res.json();
            const remaining = (data.character_limit || 0) - (data.character_count || 0);
            saveElKeys([...elKeys, { key, status: remaining > 0 ? 'valid' : 'quota', remaining, limit: data.character_limit || 0, used: data.character_count || 0 }]);
        } catch { alert('Không thể xác minh key. Kiểm tra kết nối mạng.'); setElChecking(false); return; }
        setElChecking(false);
        setElInput('');
    };

    const removeElKey = (k) => saveElKeys(elKeys.filter(x => x.key !== k));

    // ── TopProxy / KiotProxy Rotating Proxy ──────────────────────────────────
    const [tpEnabled,      setTpEnabled]      = useState(false);
    const [tpProvider,     setTpProvider]     = useState('topproxy'); // 'topproxy'|'kiotproxy'
    const [tpApiKey,       setTpApiKey]       = useState('');
    const [tpApiKeyInput,  setTpApiKeyInput]  = useState('');
    const [tpGateway,      setTpGateway]      = useState('160.250.166.11:10059');
    const [tpType,         setTpType]         = useState('http');
    const [tpInterval,     setTpInterval]     = useState(1);        // minutes (saved)
    const [tpIntervalInput,setTpIntervalInput]= useState('1');      // input draft
    const [tpOnlyOn403,    setTpOnlyOn403]    = useState(false);
    const [tpRotateUrl,    setTpRotateUrl]    = useState('');    // custom rotate API URL
    const [tpRotateUrlInput, setTpRotateUrlInput] = useState('');
    const [tpSaving,       setTpSaving]       = useState(false);
    const [tpRotating,     setTpRotating]     = useState(false);
    const [tpRotatePhase,  setTpRotatePhase]  = useState(null);  // null|'calling'|'waiting'|'success'|'unchanged'
    const [tpRotateMsg,    setTpRotateMsg]    = useState('');
    const [showRotateUrl,  setShowRotateUrl]  = useState(false); // expand advanced

    // CapSolver API key (dùng để giải captcha qua proxy IP)
    const [capsolverKey,      setCapsolverKey]      = useState('');
    const [capsolverKeyInput, setCapsolverKeyInput] = useState('');
    const [capsolverSaved,    setCapsolverSaved]    = useState(false);

    // Stock Video API keys (Pexels / Pixabay)
    const [pexelsKey,      setPexelsKey]      = useState('');
    const [pexelsInput,    setPexelsInput]    = useState('');
    const [pexelsSaved,    setPexelsSaved]    = useState(false);
    const [pixabayKey,     setPixabayKey]     = useState('');
    const [pixabayInput,   setPixabayInput]   = useState('');
    const [pixabaySaved,   setPixabaySaved]   = useState(false);
    const [stockTesting,   setStockTesting]   = useState(null); // 'pexels'|'pixabay'|null
    const [stockTestResult,setStockTestResult]= useState({}); // { pexels: 'ok'|'fail', pixabay: ... }

    // Live IP status
    const [tpIpInfo,       setTpIpInfo]       = useState(null);  // {ip,isp,region,city}
    const [tpIpChecking,   setTpIpChecking]   = useState(false);
    const [tpIpError,      setTpIpError]      = useState('');

    // Countdown tracking
    const [lastRotateMs,   setLastRotateMs]   = useState(null); // Date.now() of last rotate
    const [rotateSecsLeft, setRotateSecsLeft] = useState(null);
    const [aliveSecsLeft,  setAliveSecsLeft]  = useState(null);
    const PROXY_LIFETIME_SECS = 25 * 60; // 25 min hard limit

    // Load saved config on mount
    useEffect(() => {
        window.electronAPI?.topProxyGetConfig?.().then(cfg => {
            if (!cfg) return;
            setTpEnabled(!!cfg.enabled);
            setTpProvider(cfg.provider || 'topproxy');
            setTpApiKey(cfg.apiKey || '');
            setTpApiKeyInput(cfg.apiKey || '');
            setTpGateway(cfg.gateway || '160.250.166.11:10059');
            setTpType(cfg.type || 'http');
            setTpInterval(cfg.rotateInterval || 1);
            setTpIntervalInput(String(cfg.rotateInterval || 1));
            setTpOnlyOn403(!!cfg.onlyOn403);
            if (cfg.lastRotateMs) setLastRotateMs(cfg.lastRotateMs);
            if (cfg.rotateUrl) { setTpRotateUrl(cfg.rotateUrl); setTpRotateUrlInput(cfg.rotateUrl); }
        }).catch(() => {});
        // Load CapSolver key
        window.electronAPI?.getSetting?.('capsolver_api_key', '').then(k => {
            if (k) { setCapsolverKey(k); setCapsolverKeyInput(k); }
        }).catch(() => {});
        // Load Stock Video keys
        window.electronAPI?.getSetting?.('pexels_api_key', '').then(k => { if (k) { setPexelsKey(k); setPexelsInput(k); } }).catch(() => {});
        window.electronAPI?.getSetting?.('pixabay_api_key', '').then(k => { if (k) { setPixabayKey(k); setPixabayInput(k); } }).catch(() => {});
    }, []);

    // Auto-update gateway when provider changes
    useEffect(() => {
        if (tpProvider === 'topproxy') setTpGateway('160.250.166.11:10059');
        // KiotProxy: user fills their own gateway
    }, [tpProvider]);

    // Countdown timer tick (every second)
    useEffect(() => {
        if (!tpEnabled || !lastRotateMs) { setRotateSecsLeft(null); setAliveSecsLeft(null); return; }
        const tick = () => {
            const now = Date.now();
            const elapsed = Math.floor((now - lastRotateMs) / 1000);
            const rotateTotal = tpInterval * 60;
            setRotateSecsLeft(Math.max(0, rotateTotal - elapsed));
            setAliveSecsLeft(Math.max(0, PROXY_LIFETIME_SECS - elapsed));
        };
        tick();
        const t = setInterval(tick, 1000);
        return () => clearInterval(t);
    }, [tpEnabled, lastRotateMs, tpInterval]);

    // Auto-rotate when countdown hits 0 (and not onlyOn403)
    useEffect(() => {
        if (rotateSecsLeft === 0 && tpEnabled && !tpOnlyOn403 && !tpRotating) {
            handleTpRotate();
        }
    }, [rotateSecsLeft]);

    const _tpSaveConfig = async (patch) => {
        setTpSaving(true);
        try {
            const cfg = {
                enabled: tpEnabled, provider: tpProvider, apiKey: tpApiKey,
                gateway: tpGateway, type: tpType, rotateInterval: tpInterval,
                onlyOn403: tpOnlyOn403, lastRotateMs,
                ...patch,
            };
            await window.electronAPI?.topProxySaveConfig?.(cfg);
        } finally { setTpSaving(false); }
    };

    const handleTpSaveKey = async () => {
        const key = tpApiKeyInput.trim();
        if (!key) return;
        setTpApiKey(key);
        await _tpSaveConfig({ apiKey: key });
    };

    const handleTpToggle = async (val) => {
        setTpEnabled(val);
        await window.electronAPI?.topProxyToggle?.(val);
        if (val && tpApiKey && !tpIpInfo) setTimeout(() => handleTpCheckIp(), 800);
    };

    const handleTpApplyInterval = async () => {
        const v = Math.max(1, parseInt(tpIntervalInput) || 1);
        setTpInterval(v);
        setTpIntervalInput(String(v));
        await _tpSaveConfig({ rotateInterval: v });
    };

    const handleTpCheckIp = async () => {
        setTpIpChecking(true);
        setTpIpError('');
        const res = await window.electronAPI?.topProxyCheckIp?.() || { success: false, error: 'API không khả dụng' };
        setTpIpChecking(false);
        if (res.success) { setTpIpInfo(res); setTpIpError(''); }
        else { setTpIpError(res.error || 'Lỗi không xác định'); setTpIpInfo(null); }
    };

    const handleTpRotate = async () => {
        const oldIp = tpIpInfo?.ip || null;
        setTpRotating(true);
        setTpRotatePhase('calling');
        setTpRotateMsg('Đang gọi API xoay...');

        // Call rotate API (pass custom URL if set)
        await window.electronAPI?.topProxyRotate?.() || { success: false };

        // Reset last-rotate timestamp
        const now = Date.now();
        setLastRotateMs(now);
        _tpSaveConfig({ lastRotateMs: now }); // fire-and-forget

        // Poll for new IP (up to 5 tries × 4s = 20s max)
        setTpRotatePhase('waiting');
        let found = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
            setTpRotateMsg(`Đang chờ IP mới... (${attempt}/5)`);
            await new Promise(r => setTimeout(r, 4000));
            const ipRes = await window.electronAPI?.topProxyCheckIp?.() || { success: false };
            if (ipRes.success) {
                setTpIpInfo(ipRes);
                setTpIpError('');
                if (!oldIp || ipRes.ip !== oldIp) {
                    found = true;
                    setTpRotatePhase('success');
                    setTpRotateMsg(`✅ IP mới: ${ipRes.ip}`);
                    break;
                }
            } else {
                setTpIpError(ipRes.error || '');
            }
        }

        if (!found) {
            setTpRotatePhase('unchanged');
            setTpRotateMsg('⚠ IP chưa đổi — Proxy xoay theo thời gian, thử "Xoay ngay" lại sau');
        }

        setTpRotating(false);
        setTimeout(() => { setTpRotatePhase(null); setTpRotateMsg(''); }, 6000);
    };

    const handleTpSaveRotateUrl = async () => {
        const url = tpRotateUrlInput.trim();
        setTpRotateUrl(url);
        await _tpSaveConfig({ rotateUrl: url });
    };

    const handleCapsolverSave = async () => {
        const k = capsolverKeyInput.trim();
        setCapsolverKey(k);
        await window.electronAPI?.setSetting?.('capsolver_api_key', k);
        setCapsolverSaved(true);
        setTimeout(() => setCapsolverSaved(false), 2500);
    };

    const handleStockSave = async (provider) => {
        if (provider === 'pexels') {
            const k = pexelsInput.trim();
            setPexelsKey(k);
            await window.electronAPI?.setSetting?.('pexels_api_key', k);
            setPexelsSaved(true);
            setTimeout(() => setPexelsSaved(false), 2500);
        } else {
            const k = pixabayInput.trim();
            setPixabayKey(k);
            await window.electronAPI?.setSetting?.('pixabay_api_key', k);
            setPixabaySaved(true);
            setTimeout(() => setPixabaySaved(false), 2500);
        }
    };

    const handleStockTest = async (provider) => {
        const key = provider === 'pexels' ? pexelsKey : pixabayKey;
        if (!key) return;
        setStockTesting(provider);
        setStockTestResult(r => ({ ...r, [provider]: null }));
        const res = await window.electronAPI?.stockVideoSearch?.({
            keyword: 'nature',
            provider,
            apiKey: key,
            perPage: 1,
        });
        setStockTesting(null);
        setStockTestResult(r => ({ ...r, [provider]: res?.success && res.results?.length > 0 ? 'ok' : 'fail' }));
    };

    const handleTpDelete = async () => {
        setTpEnabled(false);
        setTpApiKey('');
        setTpApiKeyInput('');
        setTpIpInfo(null);
        setLastRotateMs(null);
        await _tpSaveConfig({ enabled: false, apiKey: '', lastRotateMs: null });
    };

    const fmtCountdown = (secs) => {
        if (secs === null || secs === undefined) return '--:--';
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };

    return (
        <div className="flex w-full h-full bg-[#0a0f18] text-slate-300">

            {/* ── SIDEBAR ───────────────────────────────────────────────── */}
            <div className="w-52 shrink-0 bg-[#0d1525] border-r border-slate-800/80 flex flex-col">
                {/* Header */}
                <div className="px-4 py-4 border-b border-slate-800/60">
                    <div className="flex items-center gap-2">
                        <SettingsIcon size={16} className="text-slate-400" />
                        <span className="text-sm font-bold text-slate-200">Cài đặt</span>
                    </div>
                </div>

                {/* Nav items */}
                <nav className="flex-1 p-2 space-y-0.5">
                    {SECTIONS.map(s => (
                        <button
                            key={s.id}
                            onClick={() => setActiveSection(s.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all group ${
                                activeSection === s.id
                                    ? 'bg-blue-600/20 border border-blue-500/30 text-white'
                                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
                            }`}
                        >
                            <span className="text-base leading-none">{s.icon}</span>
                            <div className="flex-1 min-w-0">
                                <div className={`text-[12px] font-semibold truncate ${activeSection === s.id ? 'text-white' : 'text-slate-300'}`}>
                                    {s.label}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate mt-0.5">{s.sub}</div>
                            </div>
                            {activeSection === s.id && <ChevronRight size={12} className="text-blue-400 shrink-0" />}
                        </button>
                    ))}
                </nav>

                {/* Footer info */}
                <div className="p-3 border-t border-slate-800/60">
                    <div className={`flex items-center gap-2 text-[10px] font-bold px-2 py-1.5 rounded-lg ${
                        extConnected
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                    }`}>
                        {extConnected ? <Wifi size={10}/> : <WifiOff size={10}/>}
                        {extConnected ? 'Extension: Kết nối' : 'Extension: Chờ...'}
                    </div>
                    {tpEnabled && tpApiKey && (
                        <div className="flex items-center gap-2 text-[10px] font-bold px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 mt-1">
                            🔄 {tpIpInfo ? `${tpIpInfo.ip}` : 'Proxy: BẬT'}
                        </div>
                    )}
                </div>
            </div>

            {/* ── MAIN CONTENT ──────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">

                {/* ════════════ EXTENSION ════════════ */}
                {activeSection === 'extension' && (
                    <div className="max-w-2xl space-y-5">
                        <div>
                            <h1 className="text-lg font-bold text-white mb-1">Chrome Extension</h1>
                            <p className="text-sm text-slate-400">Kết nối Fluxy với trình duyệt Chrome để sử dụng các tính năng Veo Studio.</p>
                        </div>

                        {/* Connection status card */}
                        <div className={`rounded-xl border p-4 flex items-center gap-4 ${
                            extConnected
                                ? 'bg-emerald-500/5 border-emerald-500/20'
                                : 'bg-rose-500/5 border-rose-500/20'
                        }`}>
                            {extConnected ? (
                                <>
                                    <div className="relative flex h-4 w-4 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-emerald-400">Đã kết nối</p>
                                        <p className="text-xs text-slate-400">Extension đang hoạt động · Credits: {extCredits}</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <WifiOff size={18} className="text-rose-400 shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-rose-400">Chưa kết nối</p>
                                        <p className="text-xs text-slate-400">Làm theo hướng dẫn bên dưới để cài Extension</p>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Installation guide */}
                        <div className="bg-[#1a2535] border border-amber-500/20 rounded-xl p-5">
                            <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <HelpCircle size={13}/> Hướng dẫn cài đặt Extension
                            </p>
                            <ol className="space-y-3 mb-5">
                                {[
                                    ['1', 'Click nút bên dưới để mở thư mục Extension'],
                                    ['2', 'Mở Chrome → vào địa chỉ: chrome://extensions'],
                                    ['3', 'Bật công tắc "Developer mode" (góc trên bên phải)'],
                                    ['4', 'Click "Load unpacked" → chọn thư mục Extension vừa mở'],
                                    ['5', 'Mở trang labs.google trong Chrome → tool tự kết nối'],
                                ].map(([n, txt]) => (
                                    <li key={n} className="flex items-start gap-3">
                                        <span className="w-5 h-5 bg-amber-500/20 text-amber-400 text-[10px] font-black rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
                                        <span className="text-sm text-slate-300 leading-relaxed">{txt}</span>
                                    </li>
                                ))}
                            </ol>
                            <div className="flex gap-3">
                                <button
                                    onClick={async () => {
                                        const res = await window.electronAPI?.openExtensionFolder?.();
                                        if (!res?.success) alert('Lỗi: ' + (res?.error || 'Không mở được thư mục'));
                                    }}
                                    className="flex-1 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    <Download size={14}/> Mở thư mục Extension
                                </button>
                                <button
                                    onClick={() => window.electronAPI?.openExternal?.('chrome://extensions')}
                                    className="flex-1 py-2.5 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-slate-300 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    <Globe size={14}/> Mở chrome://extensions
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ════════════ API KEY ════════════ */}
                {activeSection === 'apikey' && (
                    <div className="max-w-2xl space-y-6">
                        <div>
                            <h1 className="text-lg font-bold text-white mb-1">API Key</h1>
                            <p className="text-sm text-slate-400">Quản lý API Key cho các dịch vụ AI. Key được lưu trên máy, không gửi lên server.</p>
                        </div>

                        {/* ── Gemini ── */}
                        <div className="bg-[#1a2535] border border-slate-700/60 rounded-xl overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-700/40 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-base">✨</div>
                                    <div>
                                        <p className="text-sm font-bold text-white">Gemini API Key</p>
                                        <p className="text-xs text-slate-500">Google AI Studio — dùng cho Creator, Voice, AutoAnimation</p>
                                    </div>
                                </div>
                                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                                    geminiKeys.length > 0
                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                        : 'bg-slate-700/50 text-slate-400 border border-slate-600'
                                }`}>
                                    {geminiKeys.length > 0 ? `${geminiKeys.length} key` : 'Chưa có key'}
                                </span>
                            </div>
                            <div className="p-5 space-y-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Thêm key mới (mỗi dòng 1 key)</label>
                                    <textarea
                                        value={geminiInput}
                                        onChange={e => setGeminiInput(e.target.value)}
                                        placeholder={'AIzaSy...\nAIzaSy...\n(Lấy key tại aistudio.google.com)'}
                                        rows={3}
                                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-300 font-mono focus:outline-none focus:border-blue-500 resize-none placeholder-slate-600"
                                    />
                                </div>
                                <button
                                    onClick={handleGeminiApply}
                                    disabled={!geminiInput.trim()}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <Plus size={14}/> Thêm key
                                </button>

                                {geminiKeys.length > 0 && (
                                    <div className="space-y-2 mt-2">
                                        <label className="text-xs font-semibold text-slate-400">Keys hiện có ({geminiKeys.length})</label>
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                            {geminiKeys.map((k, i) => (
                                                <div key={i} className="flex items-center gap-2 bg-[#0f172a] border border-slate-700/60 rounded-lg px-3 py-2">
                                                    <CheckCircle2 size={12} className="text-emerald-400 shrink-0"/>
                                                    <span className="flex-1 text-xs font-mono text-slate-300 truncate">
                                                        {k.slice(0, 12)}{'*'.repeat(Math.max(0, k.length - 20))}{k.slice(-8)}
                                                    </span>
                                                    <button onClick={() => removeGeminiKey(k)} className="text-slate-600 hover:text-red-400 transition-colors">
                                                        <X size={13}/>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {geminiSaved && (
                                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                                        <CheckCircle2 size={12}/> Đã lưu!
                                    </p>
                                )}

                                <div className="pt-2 border-t border-slate-700/30">
                                    <p className="text-xs text-slate-500">
                                        Lấy key miễn phí tại{' '}
                                        <button
                                            onClick={() => window.electronAPI?.openExternal?.('https://aistudio.google.com/app/apikey')}
                                            className="text-blue-400 hover:text-blue-300 underline decoration-dotted"
                                        >
                                            aistudio.google.com
                                        </button>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* ── ElevenLabs ── */}
                        <div className="bg-[#1a2535] border border-slate-700/60 rounded-xl overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-700/40 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-base">🎙</div>
                                    <div>
                                        <p className="text-sm font-bold text-white">ElevenLabs API Key</p>
                                        <p className="text-xs text-slate-500">Dùng cho Voice Studio — ElevenLabs TTS</p>
                                    </div>
                                </div>
                                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                                    elKeys.length > 0
                                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                                        : 'bg-slate-700/50 text-slate-400 border border-slate-600'
                                }`}>
                                    {elKeys.length > 0
                                        ? `${elKeys.length} key · ${elKeys.filter(k=>k.status==='valid').length} hợp lệ`
                                        : 'Chưa có key'}
                                </span>
                            </div>
                            <div className="p-5 space-y-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Thêm ElevenLabs API Key</label>
                                    <input
                                        type="text"
                                        value={elInput}
                                        onChange={e => setElInput(e.target.value)}
                                        placeholder="sk_xxxxx..."
                                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-300 font-mono focus:outline-none focus:border-purple-500"
                                    />
                                </div>
                                <button
                                    onClick={handleElApply}
                                    disabled={!elInput.trim() || elChecking}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                                >
                                    {elChecking ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
                                    {elChecking ? 'Đang kiểm tra...' : 'Thêm & xác minh'}
                                </button>

                                {elKeys.length > 0 && (
                                    <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar mt-2">
                                        {elKeys.map((obj, i) => (
                                            <div key={i} className="flex items-center gap-2 bg-[#0f172a] border border-slate-700/60 rounded-lg px-3 py-2">
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${obj.status === 'valid' ? 'bg-emerald-500' : obj.status === 'quota' ? 'bg-yellow-500' : 'bg-slate-500'}`}/>
                                                <span className="flex-1 text-xs font-mono text-slate-300 truncate">
                                                    {obj.key.slice(0, 8)}{'*'.repeat(Math.max(0, obj.key.length - 16))}{obj.key.slice(-8)}
                                                </span>
                                                {obj.remaining > 0 && (
                                                    <span className="text-[10px] text-slate-500 shrink-0">{(obj.remaining/1000).toFixed(0)}K</span>
                                                )}
                                                <button onClick={() => removeElKey(obj.key)} className="text-slate-600 hover:text-red-400 transition-colors">
                                                    <X size={13}/>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {elSaved && (
                                    <p className="text-xs text-purple-400 flex items-center gap-1">
                                        <CheckCircle2 size={12}/> Đã lưu!
                                    </p>
                                )}

                                <div className="pt-2 border-t border-slate-700/30">
                                    <p className="text-xs text-slate-500">
                                        Đăng ký và lấy key tại{' '}
                                        <button
                                            onClick={() => window.electronAPI?.openExternal?.('https://elevenlabs.io/app/settings/api-keys')}
                                            className="text-purple-400 hover:text-purple-300 underline decoration-dotted"
                                        >
                                            elevenlabs.io
                                        </button>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ════════════ PROXY XOAY ════════════ */}
                {activeSection === 'proxy' && (
                    <div className="max-w-2xl">
                        {/* ── Title bar ── */}
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <span className="text-xl">🌐</span>
                                <div>
                                    <h1 className="text-base font-bold text-white leading-tight">
                                        Proxy Xoay ({tpProvider === 'topproxy' ? 'TopProxy' : 'KiotProxy'})
                                    </h1>
                                    <p className="text-xs text-slate-500">Định tuyến traffic Veo Studio qua proxy xoay IP</p>
                                </div>
                            </div>
                            {/* ON/OFF toggle */}
                            <button
                                onClick={() => handleTpToggle(!tpEnabled)}
                                disabled={!tpApiKey}
                                className={`px-4 py-1.5 rounded-lg text-sm font-black transition-all ${
                                    tpEnabled
                                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                } disabled:opacity-40 disabled:cursor-not-allowed`}
                            >
                                {tpEnabled ? 'ON' : 'OFF'}
                            </button>
                        </div>

                        {/* ── Provider tabs ── */}
                        <div className="mb-4">
                            <p className="text-xs font-semibold text-slate-500 mb-2">Dịch vụ Proxy</p>
                            <div className="flex rounded-lg overflow-hidden border border-slate-700">
                                {[
                                    { id: 'topproxy',  label: 'TopProxy'  },
                                    { id: 'kiotproxy', label: 'KiotProxy' },
                                ].map(p => (
                                    <button key={p.id} onClick={() => setTpProvider(p.id)}
                                        className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                                            tpProvider === p.id
                                                ? 'bg-emerald-500/80 text-white'
                                                : 'bg-[#1a2535] text-slate-400 hover:bg-slate-700/50'
                                        }`}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── API Key ── */}
                        <div className="mb-4">
                            <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                                🔑 API Key ({tpProvider === 'topproxy' ? 'TopProxy' : 'KiotProxy'})
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={tpApiKeyInput}
                                    onChange={e => setTpApiKeyInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleTpSaveKey()}
                                    placeholder="Nhập API Key..."
                                    className="flex-1 bg-[#1a2535] border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                                />
                                <button
                                    onClick={handleTpSaveKey}
                                    disabled={!tpApiKeyInput.trim() || tpSaving}
                                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
                                >
                                    {tpSaving ? <Loader2 size={13} className="animate-spin"/> : null}
                                    Lưu
                                </button>
                            </div>
                        </div>

                        {/* ── Gateway (editable for kiotproxy, auto for topproxy) ── */}
                        {tpProvider === 'kiotproxy' && (
                            <div className="mb-4">
                                <p className="text-xs font-semibold text-slate-400 mb-2">Gateway (host:port)</p>
                                <input
                                    type="text"
                                    value={tpGateway}
                                    onChange={e => setTpGateway(e.target.value)}
                                    onBlur={() => _tpSaveConfig({ gateway: tpGateway })}
                                    placeholder="host:port"
                                    className="w-full bg-[#1a2535] border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                                />
                            </div>
                        )}

                        {/* ── Proxy type + Rotation interval ── */}
                        <div className="flex gap-3 mb-4">
                            {/* Loại Proxy */}
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-slate-500 mb-2">Loại Proxy</p>
                                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                                    {['http','socks5'].map(t => (
                                        <button key={t} onClick={() => { setTpType(t); _tpSaveConfig({ type: t }); }}
                                            className={`flex-1 py-2 text-sm font-bold transition-colors ${
                                                tpType === t
                                                    ? 'bg-emerald-500/80 text-white'
                                                    : 'bg-[#1a2535] text-slate-400 hover:bg-slate-700/50'
                                            }`}>
                                            {t.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {/* Thời gian xoay */}
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                                    ⏱ Thời gian xoay (phút)
                                </p>
                                <div className="flex gap-1.5">
                                    <input
                                        type="number" min="1" max="60"
                                        value={tpIntervalInput}
                                        onChange={e => setTpIntervalInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleTpApplyInterval()}
                                        className="flex-1 bg-[#1a2535] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 text-center font-mono focus:outline-none focus:border-emerald-500"
                                    />
                                    <button onClick={handleTpApplyInterval}
                                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-bold rounded-lg transition-colors">
                                        Áp dụng
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ── Only rotate on 403 ── */}
                        <label className="flex items-center gap-3 mb-4 cursor-pointer group">
                            <div
                                onClick={() => { setTpOnlyOn403(!tpOnlyOn403); _tpSaveConfig({ onlyOn403: !tpOnlyOn403 }); }}
                                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                    tpOnlyOn403 ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600 bg-[#1a2535]'
                                }`}
                            >
                                {tpOnlyOn403 && <span className="text-white text-[10px] font-black">✓</span>}
                            </div>
                            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                                Chỉ xoay khi gặp lỗi 403
                            </span>
                        </label>

                        {/* ── Custom Rotate URL (advanced) ── */}
                        <div className="mb-4">
                            <button
                                onClick={() => setShowRotateUrl(v => !v)}
                                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                <span className={`transition-transform ${showRotateUrl ? 'rotate-90' : ''}`}>▶</span>
                                Nâng cao — URL API Xoay tùy chỉnh
                            </button>
                            {showRotateUrl && (
                                <div className="mt-2 bg-[#111c2d] border border-slate-700/50 rounded-xl p-4 space-y-2">
                                    <p className="text-xs text-slate-400">
                                        URL gọi để xoay IP (lấy từ dashboard của nhà cung cấp). Dùng <code className="bg-slate-800 text-slate-300 px-1 rounded">{`{apikey}`}</code> làm placeholder cho API Key.
                                    </p>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={tpRotateUrlInput}
                                            onChange={e => setTpRotateUrlInput(e.target.value)}
                                            placeholder={`https://provider.vn/api/changeip?apikey={apikey}`}
                                            className="flex-1 bg-[#1a2535] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500"
                                        />
                                        <button onClick={handleTpSaveRotateUrl}
                                            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg transition-colors">
                                            Lưu
                                        </button>
                                        {tpRotateUrl && (
                                            <button onClick={() => { setTpRotateUrl(''); setTpRotateUrlInput(''); _tpSaveConfig({ rotateUrl: '' }); }}
                                                className="px-2 py-2 text-slate-500 hover:text-red-400 transition-colors">
                                                <X size={13}/>
                                            </button>
                                        )}
                                    </div>
                                    {tpRotateUrl && (
                                        <p className="text-[10px] text-emerald-400">✓ Đang dùng: {tpRotateUrl.slice(0, 60)}{tpRotateUrl.length > 60 ? '...' : ''}</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Auto-rotate info ── */}
                        <div className="mb-4 bg-[#0f1e2e] border border-blue-500/20 rounded-lg px-4 py-2.5 flex items-start gap-2">
                            <span className="text-blue-400 text-sm shrink-0 mt-0.5">ℹ</span>
                            <div className="text-xs text-slate-400 leading-relaxed">
                                <p className="font-semibold text-slate-300 mb-1">🔄 Proxy sẽ tự động xoay theo thời gian đã đặt</p>
                                <p className="font-semibold text-slate-300 mb-1">Hệ thống sẽ tự động xoay proxy khi:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li>Đến thời gian xoay bạn đặt ({tpInterval} phút)</li>
                                    <li>Proxy hết hạn (25 phút — hard limit)</li>
                                </ul>
                            </div>
                        </div>

                        {/* ── Status card (IP info + countdowns) ── */}
                        {tpEnabled && (
                            <div className="mb-4 bg-[#111c2d] border border-slate-700/60 rounded-xl overflow-hidden">
                                {tpIpChecking ? (
                                    <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
                                        <Loader2 size={16} className="animate-spin text-emerald-400"/>
                                        Đang kiểm tra IP...
                                    </div>
                                ) : tpIpError ? (
                                    <div className="flex items-center gap-3 px-5 py-4">
                                        <AlertCircle size={16} className="text-red-400 shrink-0"/>
                                        <div>
                                            <p className="text-sm font-bold text-red-400">Không lấy được IP</p>
                                            <p className="text-xs text-slate-500 mt-0.5">{tpIpError}</p>
                                        </div>
                                        <button onClick={handleTpCheckIp} className="ml-auto text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                                            <RefreshCw size={11}/> Thử lại
                                        </button>
                                    </div>
                                ) : tpIpInfo ? (
                                    <div className="divide-y divide-slate-700/30">
                                        {[
                                            ['IP hiện tại',   tpIpInfo.ip,     'text-emerald-300 font-mono font-bold'],
                                            ['Nhà mạng',       tpIpInfo.isp || '—',  'text-slate-200'],
                                            ['Vị trí',         [tpIpInfo.city, tpIpInfo.region].filter(Boolean).join(', ') || '—', 'text-slate-200'],
                                            ['Xoay tiếp sau',  fmtCountdown(rotateSecsLeft), rotateSecsLeft !== null && rotateSecsLeft < 15 ? 'text-amber-400 font-bold animate-pulse' : 'text-amber-300 font-bold font-mono'],
                                            ['Proxy còn sống', aliveSecsLeft !== null ? `${fmtCountdown(aliveSecsLeft)} / 25:00` : '--:--', aliveSecsLeft !== null && aliveSecsLeft < 120 ? 'text-red-400 font-bold' : 'text-emerald-400 font-mono'],
                                        ].map(([label, value, cls]) => (
                                            <div key={label} className="flex items-center justify-between px-5 py-2.5">
                                                <span className="text-xs text-slate-500">{label}:</span>
                                                <span className={`text-xs ${cls}`}>{value}</span>
                                            </div>
                                        ))}
                                        {tpIpInfo.httpsConnect !== undefined && (
                                            <div className="flex items-center justify-between px-5 py-2.5">
                                                <span className="text-xs text-slate-500">HTTPS tunnel:</span>
                                                <span className={`text-xs font-bold ${tpIpInfo.httpsConnect ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                    {tpIpInfo.httpsConnect ? '✓ Hỗ trợ' : '✗ Không hỗ trợ'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between px-5 py-4">
                                        <span className="text-sm text-slate-500">Chưa có thông tin IP</span>
                                        <button onClick={handleTpCheckIp}
                                            className="text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                                            <RefreshCw size={11}/> Kiểm tra IP
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Current proxy status bar ── */}
                        {tpEnabled && tpIpInfo && (
                            <div className="mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"/>
                                <span className="text-sm text-emerald-300 font-medium">
                                    Proxy: <span className="font-mono font-bold">{tpIpInfo.ip}</span>
                                    {tpIpInfo.isp ? ` (${tpIpInfo.isp})` : ''}
                                </span>
                            </div>
                        )}

                        {/* ── HTTPS CONNECT warning ── */}
                        {tpEnabled && tpIpInfo && tpIpInfo.httpsConnect === false && (
                            <div className="mb-4 bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
                                <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5"/>
                                <div>
                                    <p className="text-xs font-bold text-amber-300 mb-1">Proxy không hỗ trợ HTTPS CONNECT tunnel</p>
                                    <p className="text-xs text-slate-400 leading-relaxed">
                                        Proxy này không tunnel được HTTPS — lệnh gửi tới API Veo sẽ tự động chuyển sang kết nối trực tiếp (không qua proxy).
                                        Để Veo dùng proxy, cần gateway hỗ trợ HTTPS CONNECT (port 443).
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* ── CapSolver API Key ── */}
                        <div className="mb-4 bg-[#111c2d] border border-purple-500/20 rounded-xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-purple-500/15 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">🧩</span>
                                    <div>
                                        <p className="text-xs font-bold text-purple-300">CapSolver API Key</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            Giải CAPTCHA qua đúng IP proxy → token khớp với lệnh gửi đi
                                        </p>
                                    </div>
                                </div>
                                {capsolverKey && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/20">
                                        ✓ Đã cấu hình
                                    </span>
                                )}
                            </div>
                            <div className="p-4 space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={capsolverKeyInput}
                                        onChange={e => setCapsolverKeyInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleCapsolverSave()}
                                        placeholder="CAP-xxxxxxxxxxxxxxxx"
                                        className="flex-1 bg-[#1a2535] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono focus:outline-none focus:border-purple-500 placeholder-slate-600"
                                    />
                                    <button
                                        onClick={handleCapsolverSave}
                                        disabled={!capsolverKeyInput.trim()}
                                        className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                                    >
                                        {capsolverSaved ? '✓ Đã lưu' : 'Lưu'}
                                    </button>
                                    {capsolverKey && (
                                        <button
                                            onClick={() => { setCapsolverKey(''); setCapsolverKeyInput(''); window.electronAPI?.setSetting?.('capsolver_api_key', ''); }}
                                            className="px-2 py-2 text-slate-500 hover:text-red-400 transition-colors"
                                        >
                                            <X size={13}/>
                                        </button>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500 leading-relaxed">
                                    Khi proxy bật + CapSolver cấu hình: CAPTCHA được giải từ IP proxy hiện tại.
                                    Lấy key miễn phí tại{' '}
                                    <button
                                        onClick={() => window.electronAPI?.openExternal?.('https://capsolver.com')}
                                        className="text-purple-400 hover:text-purple-300 underline decoration-dotted"
                                    >
                                        capsolver.com
                                    </button>
                                </p>
                            </div>
                        </div>

                        {/* ── Rotate phase status message ── */}
                        {tpRotateMsg && (
                            <div className={`mb-3 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 ${
                                tpRotatePhase === 'success'   ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' :
                                tpRotatePhase === 'unchanged' ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300' :
                                                                'bg-blue-500/10 border border-blue-500/20 text-blue-300'
                            }`}>
                                {(tpRotatePhase === 'calling' || tpRotatePhase === 'waiting') &&
                                    <Loader2 size={14} className="animate-spin shrink-0"/>}
                                <span>{tpRotateMsg}</span>
                            </div>
                        )}

                        {/* ── Action buttons ── */}
                        <div className="flex gap-2">
                            <button
                                onClick={handleTpRotate}
                                disabled={!tpEnabled || !tpApiKey || tpRotating}
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                            >
                                {tpRotating
                                    ? <><Loader2 size={15} className="animate-spin"/>
                                        {tpRotatePhase === 'waiting' ? 'Đang chờ IP mới...' : 'Đang xoay...'}</>
                                    : <><RefreshCw size={15}/> Xoay ngay</>}
                            </button>
                            <button
                                onClick={handleTpDelete}
                                disabled={!tpApiKey}
                                className="px-5 py-3 bg-red-900/40 hover:bg-red-900/70 disabled:opacity-30 disabled:cursor-not-allowed border border-red-700/40 text-red-400 text-sm font-bold rounded-xl transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={15}/> Xóa
                            </button>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════
                    STOCK VIDEO — Pexels & Pixabay
                ══════════════════════════════════════════════════════ */}
                {activeSection === 'stockvideo' && (
                    <div className="space-y-5">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-1">
                            <span className="text-3xl">🎬</span>
                            <div>
                                <h2 className="text-lg font-bold text-white">Stock Video</h2>
                                <p className="text-xs text-slate-400">API key để tìm &amp; tải video miễn phí từ Pexels và Pixabay cho Audio-to-Video</p>
                            </div>
                        </div>

                        {/* Info banner */}
                        <div className="bg-blue-900/30 border border-blue-700/40 rounded-xl px-4 py-3 flex gap-3 items-start">
                            <span className="text-blue-400 text-lg mt-0.5">ℹ️</span>
                            <div className="text-xs text-blue-300 space-y-1">
                                <p><strong>Pexels</strong>: 200 requests/giờ, 20.000/tháng — miễn phí hoàn toàn</p>
                                <p><strong>Pixabay</strong>: 100 requests/phút — miễn phí hoàn toàn</p>
                                <p className="text-slate-400 pt-1">Cả hai đủ sức xử lý audio 2–3 tiếng (360 đoạn @ 20s/đoạn).</p>
                            </div>
                        </div>

                        {/* ── Pexels card ── */}
                        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden">
                            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/40">
                                <span className="text-xl">🟢</span>
                                <div>
                                    <p className="text-sm font-bold text-white">Pexels</p>
                                    <p className="text-xs text-slate-400">pexels.com/api — đăng ký miễn phí để lấy key</p>
                                </div>
                                <a
                                    href="#"
                                    onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://www.pexels.com/api/new/'); }}
                                    className="ml-auto text-xs text-blue-400 hover:text-blue-300 underline"
                                >Lấy API key ↗</a>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={pexelsInput}
                                        onChange={e => setPexelsInput(e.target.value)}
                                        placeholder="Dán Pexels API key vào đây..."
                                        className="flex-1 bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
                                    />
                                    <button
                                        onClick={() => handleStockSave('pexels')}
                                        disabled={!pexelsInput.trim()}
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors whitespace-nowrap"
                                    >
                                        {pexelsSaved ? '✓ Đã lưu' : 'Lưu'}
                                    </button>
                                </div>
                                {pexelsKey && (
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 text-xs text-slate-400 truncate">
                                            Key hiện tại: <span className="text-slate-300 font-mono">{pexelsKey.slice(0, 8)}{'•'.repeat(Math.min(16, pexelsKey.length - 8))}…</span>
                                        </div>
                                        <button
                                            onClick={() => handleStockTest('pexels')}
                                            disabled={stockTesting === 'pexels'}
                                            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 border border-slate-600/50 text-xs text-white font-bold rounded-lg transition-colors flex items-center gap-1.5"
                                        >
                                            {stockTesting === 'pexels'
                                                ? <><Loader2 size={12} className="animate-spin"/> Đang test...</>
                                                : 'Test kết nối'}
                                        </button>
                                        {stockTestResult['pexels'] === 'ok' && (
                                            <span className="text-xs font-bold text-emerald-400">✓ OK</span>
                                        )}
                                        {stockTestResult['pexels'] === 'fail' && (
                                            <span className="text-xs font-bold text-red-400">✗ Lỗi</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Pixabay card ── */}
                        <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden">
                            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/40">
                                <span className="text-xl">🟡</span>
                                <div>
                                    <p className="text-sm font-bold text-white">Pixabay</p>
                                    <p className="text-xs text-slate-400">pixabay.com/api/docs — đăng ký miễn phí để lấy key</p>
                                </div>
                                <a
                                    href="#"
                                    onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://pixabay.com/api/docs/'); }}
                                    className="ml-auto text-xs text-blue-400 hover:text-blue-300 underline"
                                >Lấy API key ↗</a>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={pixabayInput}
                                        onChange={e => setPixabayInput(e.target.value)}
                                        placeholder="Dán Pixabay API key vào đây..."
                                        className="flex-1 bg-slate-900/60 border border-slate-600/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
                                    />
                                    <button
                                        onClick={() => handleStockSave('pixabay')}
                                        disabled={!pixabayInput.trim()}
                                        className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors whitespace-nowrap"
                                    >
                                        {pixabaySaved ? '✓ Đã lưu' : 'Lưu'}
                                    </button>
                                </div>
                                {pixabayKey && (
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 text-xs text-slate-400 truncate">
                                            Key hiện tại: <span className="text-slate-300 font-mono">{pixabayKey.slice(0, 8)}{'•'.repeat(Math.min(16, pixabayKey.length - 8))}…</span>
                                        </div>
                                        <button
                                            onClick={() => handleStockTest('pixabay')}
                                            disabled={stockTesting === 'pixabay'}
                                            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 border border-slate-600/50 text-xs text-white font-bold rounded-lg transition-colors flex items-center gap-1.5"
                                        >
                                            {stockTesting === 'pixabay'
                                                ? <><Loader2 size={12} className="animate-spin"/> Đang test...</>
                                                : 'Test kết nối'}
                                        </button>
                                        {stockTestResult['pixabay'] === 'ok' && (
                                            <span className="text-xs font-bold text-emerald-400">✓ OK</span>
                                        )}
                                        {stockTestResult['pixabay'] === 'fail' && (
                                            <span className="text-xs font-bold text-red-400">✗ Lỗi</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Usage tip */}
                        <div className="bg-slate-800/40 border border-slate-700/30 rounded-xl px-4 py-3">
                            <p className="text-xs text-slate-400">
                                💡 <strong className="text-slate-300">Cách dùng:</strong> Sau khi lưu key, vào tab <span className="text-blue-400">Audio-to-Video</span> → chọn <span className="text-emerald-400">Stock Video</span> thay vì Veo. Ứng dụng sẽ tự động tìm và ghép video phù hợp với từng đoạn âm thanh.
                            </p>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
