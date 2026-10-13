import { useState, useRef, useCallback, useEffect } from 'react';
import { loadGroqKeysForWhisper } from '../services/whisperGroq.js';

const api = window.electronAPI;

// ── Subtitle validator ────────────────────────────────────────────────────────
// Chuẩn hóa text để so sánh (bỏ dấu câu, thường hoá, bỏ khoảng trắng thừa)
function normSub(t) {
  return (t || '').toLowerCase().replace(/[.!?…,;:"""''()[\]]/g, '').replace(/\s+/g, ' ').trim();
}
// Phát hiện text bị lặp trong cùng 1 segment: "ABC ABC" hay "Câu A. Câu A."
function dedupeText(text) {
  if (!text) return text;
  const t = text.trim();
  // Lặp nguyên từng từ: "word1 word2 word1 word2"
  const words = t.split(/\s+/);
  if (words.length >= 6) {
    const half = Math.floor(words.length / 2);
    if (words.slice(0, half).join(' ') === words.slice(half).join(' '))
      return words.slice(0, half).join(' ');
  }
  // Lặp theo câu: "Câu A. Câu A." hoặc "Câu A! Câu A!"
  const sentSplit = t.split(/(?<=[.!?…])\s+/);
  if (sentSplit.length >= 2) {
    const half = Math.ceil(sentSplit.length / 2);
    const first = sentSplit.slice(0, half).join(' ');
    const second = sentSplit.slice(half).join(' ');
    if (second && normSub(first) === normSub(second)) return first;
  }
  // Lặp 2 mảnh bằng nhau ngăn cách bởi khoảng trắng dài
  const midMatch = t.match(/^(.{15,})\s{2,}\1$/);
  if (midMatch) return midMatch[1];
  return t;
}
// Làm sạch toàn bộ danh sách segment sau khi dịch
function validateSubtitles(segs, addLog) {
  if (!segs?.length) return segs;
  let dupCount = 0, repeatCount = 0;
  const result = [];
  for (const seg of segs) {
    // Xóa lặp trong nội dung segment
    const cleaned = dedupeText(seg.text);
    if (cleaned !== seg.text) { repeatCount++; }
    if (!cleaned?.trim()) continue;
    // Bỏ segment trùng với segment ngay trước
    const prev = result[result.length - 1];
    if (prev && normSub(prev.text) === normSub(cleaned)) {
      // Mở rộng end của segment trước thay vì giữ cả 2
      result[result.length - 1] = { ...prev, end: Math.max(prev.end, seg.end) };
      dupCount++;
      continue;
    }
    result.push({ ...seg, text: cleaned });
  }
  if (dupCount || repeatCount) {
    addLog(`🔍 Subtitle clean: bỏ ${dupCount} đoạn trùng lặp, sửa ${repeatCount} đoạn bị echo`);
  }
  return result;
}
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'];
const GEMINI_TTS_VOICES = ['Charon', 'Kore', 'Puck', 'Aoede', 'Fenrir'];

const CAPCUT_VI_VOICES = [
  { label: 'Cô Gái Hoạt Ngôn',   voice: 'BV074_streaming',                       resourceId: '7102355709945188865' },
  { label: 'Nhỏ Ngọt Ngào',       voice: 'BV421_vivn_streaming',                  resourceId: '7252594014782755330' },
  { label: 'Giọng Nữ Phổ Thông',  voice: 'vi_female_huong',                       resourceId: '7264854897953083905' },
  { label: 'Giọng Bé',            voice: 'BV074_streaming_dsp',                   resourceId: '7550087831092251920' },
  { label: 'Mai',                  voice: 'BV562_streaming',                       resourceId: '7483736254694035984' },
  { label: 'Ban Mai',              voice: 'multi_female_yangguangnv_uranus_bigtts', resourceId: '7637456432522218773' },
  { label: 'Review Phim',         voice: 'multi_female_richgirl_uranus_bigtts',   resourceId: '7637460351541447956' },
  { label: 'Giọng Gái Mới Lớn',   voice: 'multi_female_peiqi_uranus_bigtts',      resourceId: '7637458789033151751' },
  { label: 'Sunny Idol',          voice: 'multi_female_kiwi_uranus_bigtts',       resourceId: '7637457995882089749' },
  { label: 'Thanh Niên Tự Tin',   voice: 'BV075_streaming',                       resourceId: '7102355803792740865' },
  { label: 'Giọng Nam Trầm',      voice: 'multi_male_felipe_uranus_bigtts',       resourceId: '7637456729696996628' },
  { label: 'Hoai My',             voice: 'vi-VN-HoaiMyNeural',                    resourceId: '7371666434650280464' },
];

const fmtDur = (s) => {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

const STATUS_META = {
  idle:         { color: 'bg-slate-700 text-slate-300',   label: 'Chờ' },
  downloading:  { color: 'bg-blue-800 text-blue-200',     label: 'Đang tải...' },
  transcribing: { color: 'bg-amber-800 text-amber-200',   label: 'Nhận dạng...' },
  translating:  { color: 'bg-violet-800 text-violet-200', label: 'Dịch...' },
  dubbing:      { color: 'bg-pink-800 text-pink-200',     label: 'Lồng tiếng...' },
  mixing:       { color: 'bg-cyan-800 text-cyan-200',     label: 'Mix audio...' },
  recreating:   { color: 'bg-indigo-800 text-indigo-200', label: 'Tái tạo...' },
  overlaying:   { color: 'bg-purple-800 text-purple-200', label: '🎨 Overlay...' },
  done:         { color: 'bg-green-800 text-green-200',   label: '✅ Xong' },
  error:        { color: 'bg-red-800 text-red-200',       label: '❌ Lỗi' },
};

function StatusBadge({ status, msg }) {
  const m = STATUS_META[status] || STATUS_META.idle;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${m.color}`} title={msg}>
      {msg ? msg.slice(0, 40) : m.label}
    </span>
  );
}

// ── Drama Card (browse) — compact like Hongguo ──────────────────────────────
function DramaCard({ drama, onSelect, onQueueEp1 }) {
  return (
    <div className="group flex flex-col bg-slate-800 rounded-lg border border-slate-700/40 hover:border-rose-500/60 transition-all overflow-hidden cursor-pointer"
      onClick={() => onSelect(drama)}>
      <div className="relative aspect-[2/3] bg-slate-900 overflow-hidden">
        {drama.cover ? (
          <img
            src={drama.cover}
            alt={drama.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">🎬</div>
        )}
        {drama.episode_count > 0 && (
          <div className="absolute bottom-0.5 left-0.5 bg-black/75 text-white text-[8px] px-1 rounded-sm leading-tight">
            {drama.episode_count} tập
          </div>
        )}
        {drama.ep1url && (
          <button
            onClick={(e) => { e.stopPropagation(); onQueueEp1(drama); }}
            className="absolute top-0.5 right-0.5 bg-rose-700/90 hover:bg-rose-600 text-white text-[8px] px-1 py-0.5 rounded-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            +T1
          </button>
        )}
      </div>
      <div className="px-1 py-0.5">
        <p className="text-[9px] text-slate-300 line-clamp-1 leading-tight" title={drama.title}>
          {drama.title || '—'}
        </p>
      </div>
    </div>
  );
}

// ── Episode Item ────────────────────────────────────────────────────────────
function EpisodeItem({ ep, onQueue }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700/40 hover:border-rose-500/40 transition">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-slate-200 font-medium truncate">
          Tập {ep.episode_no ?? ep.number ?? ep.index ?? '?'}{ep.title ? ` — ${ep.title}` : ''}
        </div>
        {ep.duration > 0 && (
          <div className="text-[9px] text-slate-500">{fmtDur(ep.duration)}</div>
        )}
      </div>
      <button
        onClick={() => onQueue(ep)}
        className="flex-shrink-0 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 rounded-lg text-[11px] font-bold text-white transition"
      >
        ➕ Tải
      </button>
    </div>
  );
}

// ── Queue Card ──────────────────────────────────────────────────────────────
function QueueCard({ v, onProcess, onRemove, onOpenFolder, processing, onToggleSelect }) {
  const { status, msg, outputPath } = v;
  return (
    <div className={`group relative flex flex-col bg-slate-800 rounded-xl border transition-all overflow-hidden
      ${status === 'done' && v.selected ? 'border-blue-500 ring-1 ring-blue-500/50' : status === 'done' ? 'border-green-600/50' : status === 'error' ? 'border-red-600/50' : 'border-slate-700/50'}`}>
      <div className="relative aspect-video bg-slate-900 overflow-hidden">
        {v.thumbnail ? (
          <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-40">🎬</div>
        )}
        {status !== 'idle' && status !== 'done' && status !== 'error' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-7 h-7 border-[3px] border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {v.duration > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 rounded font-mono">
            {fmtDur(v.duration)}
          </span>
        )}
        {status === 'done' && (
          <button
            onClick={() => onToggleSelect?.(v.id)}
            className={`absolute top-1 left-1 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold transition
              ${v.selected ? 'bg-blue-500 text-white' : 'bg-black/60 text-slate-400 hover:bg-blue-600/60 hover:text-white'}`}
            title="Chọn để ghép tập">
            {v.selected ? '✓' : ''}
          </button>
        )}
      </div>
      <div className="p-2 flex flex-col gap-1.5 flex-1">
        <p className="text-[10px] text-slate-200 line-clamp-2 leading-tight font-medium" title={v.title}>
          {v.title || '(Không tiêu đề)'}
        </p>
        <div className="text-[9px] text-slate-500 truncate">{v.url?.slice(0, 60)}…</div>
        <div className="mt-auto flex flex-col gap-1">
          <StatusBadge status={status} msg={msg} />
          {(status === 'idle' || status === 'error') && (
            <button onClick={() => onProcess(v.id)} disabled={processing}
              className="w-full py-1.5 rounded text-[11px] font-bold bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white transition">
              {status === 'error' ? '🔁 Thử lại' : '▶ Xử lý Reup'}
            </button>
          )}
          {status === 'done' && outputPath && (
            <div className="flex gap-1">
              <button onClick={() => api.openFile?.(outputPath)}
                className="flex-1 py-1 rounded text-[10px] bg-green-800/60 hover:bg-green-700 text-green-300 transition">
                ▶ Mở
              </button>
              <button onClick={() => onOpenFolder(outputPath)}
                className="flex-1 py-1 rounded text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                📂
              </button>
            </div>
          )}
        </div>
        <button onClick={() => onRemove(v.id)}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-red-700/90 flex items-center justify-center text-white text-[10px] transition opacity-0 group-hover:opacity-100">
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────
export default function FreeReelsPanel() {
  const [tab,         setTab]         = useState('browse'); // 'browse' | 'queue'
  const [browseTab,   setBrowseTab]   = useState('home');   // 'home' | 'search'
  const [activeTabKey, setActiveTabKey] = useState('');     // tab_key from API

  // Browse state
  const [dramas,      setDramas]      = useState([]);
  const [apiTabs,     setApiTabs]     = useState([]);       // from tab/list
  const [moduleKey,   setModuleKey]   = useState('');       // for pagination
  const [nextCursor,  setNextCursor]  = useState('offset=0');
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [searchQ,     setSearchQ]     = useState('');
  const [selectedDrama, setSelectedDrama] = useState(null);
  const [episodes,    setEpisodes]    = useState([]);
  const [epLoading,   setEpLoading]   = useState(false);
  const [rawEpInfo,   setRawEpInfo]   = useState(null);
  const [authStatus,  setAuthStatus]  = useState('idle'); // 'idle'|'ok'|'error'
  const [rawHome,     setRawHome]     = useState(null);

  // Queue state
  const [videos,      setVideos]      = useState([]);
  const [urlInput,    setUrlInput]    = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [log,         setLog]         = useState([]);

  // Settings
  const [outFolder,   setOutFolder]   = useState(() => localStorage.getItem('fr_outFolder') || '');
  const [reupFolder,  setReupFolder]  = useState(() => localStorage.getItem('fr_reupFolder') || '');
  const [ttsEngine,   setTtsEngine]   = useState(() => localStorage.getItem('fr_ttsEngine') || 'vieneu');
  const [ttsVoice,    setTtsVoice]    = useState(() => localStorage.getItem('fr_ttsVoice') || '');
  const [vieNeuVoices,setVieNeuVoices]= useState([]);
  const [vieNeuMode,  setVieNeuMode]  = useState(() => localStorage.getItem('fr_vieNeuMode') || 'preset'); // 'preset'|'clone'
  const [refAudio,    setRefAudio]    = useState(() => localStorage.getItem('fr_refAudio') || '');
  const [refText,     setRefText]     = useState(() => localStorage.getItem('fr_refText') || '');
  const [geminiVoice,  setGeminiVoice]  = useState('Charon');
  const [capcutVoice,  setCapcutVoice]  = useState(() => localStorage.getItem('fr_capcutVoice') || 'BV074_streaming');
  const [muteOrig,    setMuteOrig]    = useState(true);
  const [origVol,     setOrigVol]     = useState(5);
  const [ttsVol,      setTtsVol]      = useState(100);
  const [doRecreate,  setDoRecreate]  = useState(() => localStorage.getItem('fr_doRecreate') === '1');
  // ── Recreate settings ──
  const [rcZoom,       setRcZoom]       = useState(() => +(localStorage.getItem('fr_rcZoom') || 5));
  const [rcRandomCut,  setRcRandomCut]  = useState(() => localStorage.getItem('fr_rcRandomCut') !== '0');
  const [rcHFlip,      setRcHFlip]      = useState(() => localStorage.getItem('fr_rcHFlip') === '1');
  const [rcGrain,      setRcGrain]      = useState(() => localStorage.getItem('fr_rcGrain') !== '0');
  const [rcGrainLevel, setRcGrainLevel] = useState(() => +(localStorage.getItem('fr_rcGrainLevel') || 3));
  const [rcColorShift, setRcColorShift] = useState(() => localStorage.getItem('fr_rcColorShift') !== '0');
  const [rcColorLevel, setRcColorLevel] = useState(() => localStorage.getItem('fr_rcColorLevel') || 'medium');
  const [rcRandomPos,  setRcRandomPos]  = useState(() => localStorage.getItem('fr_rcRandomPos') !== '0');
  const [rcRandomFps,  setRcRandomFps]  = useState(() => localStorage.getItem('fr_rcRandomFps') !== '0');
  const [rcRotate,     setRcRotate]     = useState(() => localStorage.getItem('fr_rcRotate') !== '0');
  const [rcHue,        setRcHue]        = useState(() => localStorage.getItem('fr_rcHue') !== '0');
  // ── Overlay settings ──
  const [ovLogoEnabled, setOvLogoEnabled] = useState(() => localStorage.getItem('fr_ovLogoEnabled') === '1');
  const [ovLogoPath,    setOvLogoPath]    = useState(() => localStorage.getItem('fr_ovLogoPath') || '');
  const [ovLogoX,       setOvLogoX]       = useState(() => +(localStorage.getItem('fr_ovLogoX') || 5));
  const [ovLogoY,       setOvLogoY]       = useState(() => +(localStorage.getItem('fr_ovLogoY') || 5));
  const [ovLogoW,       setOvLogoW]       = useState(() => +(localStorage.getItem('fr_ovLogoW') || 15));
  const [ovLogoOpacity, setOvLogoOpacity] = useState(() => +(localStorage.getItem('fr_ovLogoOpacity') || 80));
  const [ovChanEnabled, setOvChanEnabled] = useState(() => localStorage.getItem('fr_ovChanEnabled') === '1');
  const [ovChanText,    setOvChanText]    = useState(() => localStorage.getItem('fr_ovChanText') || '');
  const [ovChanX,       setOvChanX]       = useState(() => +(localStorage.getItem('fr_ovChanX') || 50));
  const [ovChanY,       setOvChanY]       = useState(() => +(localStorage.getItem('fr_ovChanY') || 90));
  const [ovChanSize,    setOvChanSize]    = useState(() => +(localStorage.getItem('fr_ovChanSize') || 28));
  const [ovChanColor,   setOvChanColor]   = useState(() => localStorage.getItem('fr_ovChanColor') || '#ffffff');
  const [ovSubEnabled,  setOvSubEnabled]  = useState(() => localStorage.getItem('fr_ovSubEnabled') === '1');
  const [ovSubY,        setOvSubY]        = useState(() => +(localStorage.getItem('fr_ovSubY') || 85));
  const [ovSubSize,     setOvSubSize]     = useState(() => +(localStorage.getItem('fr_ovSubSize') || 22));
  const [ovSubColor,    setOvSubColor]    = useState(() => localStorage.getItem('fr_ovSubColor') || '#ffffff');
  const [ovSubMaxWords, setOvSubMaxWords] = useState(() => +(localStorage.getItem('fr_ovSubMaxWords') || 6));
  const [ovSubBgOpacity,setOvSubBgOpacity]= useState(() => +(localStorage.getItem('fr_ovSubBgOpacity') || 60));
  const [ovPreviewOpen, setOvPreviewOpen] = useState(false);
  const [ovDragging,    setOvDragging]    = useState(null);
  const [ovLogoDataUrl, setOvLogoDataUrl] = useState(null);
  const previewRef = useRef(null);
  // ───────────────────────
  const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('fr_gemModel') || GEMINI_MODELS[0]);
  const [srcLang,        setSrcLang]        = useState('auto');
  const [whisperEngine,  setWhisperEngine]  = useState(() => localStorage.getItem('fr_whisperEngine') || 'auto');
  const [charContextSaved, setCharContextSaved] = useState(() => localStorage.getItem('fr_charContext') || '');

  const keyIdxRef      = useRef(0);
  const gemKeyIdxRef   = useRef(0);
  const activeCountRef = useRef(0); // số tập đang xử lý đồng thời
  const videosRef      = useRef([]);  // luôn trỏ tới videos mới nhất (cho async closures)

  useEffect(() => { localStorage.setItem('fr_outFolder',  outFolder);  }, [outFolder]);
  useEffect(() => { localStorage.setItem('fr_reupFolder', reupFolder); }, [reupFolder]);
  useEffect(() => { localStorage.setItem('fr_ttsEngine',  ttsEngine);  }, [ttsEngine]);
  useEffect(() => { localStorage.setItem('fr_ttsVoice', ttsVoice); }, [ttsVoice]);
  useEffect(() => { localStorage.setItem('fr_gemModel', geminiModel); }, [geminiModel]);
  useEffect(() => { localStorage.setItem('fr_vieNeuMode', vieNeuMode); }, [vieNeuMode]);
  useEffect(() => { localStorage.setItem('fr_refAudio',  refAudio);  }, [refAudio]);
  useEffect(() => { localStorage.setItem('fr_capcutVoice', capcutVoice); }, [capcutVoice]);
  useEffect(() => { localStorage.setItem('fr_doRecreate', doRecreate ? '1' : '0'); }, [doRecreate]);
  useEffect(() => { localStorage.setItem('fr_rcZoom',       String(rcZoom));           }, [rcZoom]);
  useEffect(() => { localStorage.setItem('fr_rcRandomCut',  rcRandomCut  ? '1' : '0'); }, [rcRandomCut]);
  useEffect(() => { localStorage.setItem('fr_rcHFlip',      rcHFlip      ? '1' : '0'); }, [rcHFlip]);
  useEffect(() => { localStorage.setItem('fr_rcGrain',      rcGrain      ? '1' : '0'); }, [rcGrain]);
  useEffect(() => { localStorage.setItem('fr_rcGrainLevel', String(rcGrainLevel));      }, [rcGrainLevel]);
  useEffect(() => { localStorage.setItem('fr_rcColorShift', rcColorShift ? '1' : '0'); }, [rcColorShift]);
  useEffect(() => { localStorage.setItem('fr_rcColorLevel', rcColorLevel);              }, [rcColorLevel]);
  useEffect(() => { localStorage.setItem('fr_rcRandomPos',  rcRandomPos  ? '1' : '0'); }, [rcRandomPos]);
  useEffect(() => { localStorage.setItem('fr_rcRandomFps',  rcRandomFps  ? '1' : '0'); }, [rcRandomFps]);
  useEffect(() => { localStorage.setItem('fr_rcRotate',     rcRotate     ? '1' : '0'); }, [rcRotate]);
  useEffect(() => { localStorage.setItem('fr_rcHue',        rcHue        ? '1' : '0'); }, [rcHue]);
  useEffect(() => { localStorage.setItem('fr_ovLogoEnabled', ovLogoEnabled ? '1' : '0'); }, [ovLogoEnabled]);
  useEffect(() => { localStorage.setItem('fr_ovLogoPath',    ovLogoPath);                  }, [ovLogoPath]);
  useEffect(() => { localStorage.setItem('fr_ovLogoX',       String(ovLogoX));             }, [ovLogoX]);
  useEffect(() => { localStorage.setItem('fr_ovLogoY',       String(ovLogoY));             }, [ovLogoY]);
  useEffect(() => { localStorage.setItem('fr_ovLogoW',       String(ovLogoW));             }, [ovLogoW]);
  useEffect(() => { localStorage.setItem('fr_ovLogoOpacity', String(ovLogoOpacity));       }, [ovLogoOpacity]);
  useEffect(() => { localStorage.setItem('fr_ovChanEnabled', ovChanEnabled ? '1' : '0'); }, [ovChanEnabled]);
  useEffect(() => { localStorage.setItem('fr_ovChanText',    ovChanText);                  }, [ovChanText]);
  useEffect(() => { localStorage.setItem('fr_ovChanX',       String(ovChanX));             }, [ovChanX]);
  useEffect(() => { localStorage.setItem('fr_ovChanY',       String(ovChanY));             }, [ovChanY]);
  useEffect(() => { localStorage.setItem('fr_ovChanSize',    String(ovChanSize));          }, [ovChanSize]);
  useEffect(() => { localStorage.setItem('fr_ovChanColor',   ovChanColor);                 }, [ovChanColor]);
  useEffect(() => { localStorage.setItem('fr_ovSubEnabled',  ovSubEnabled  ? '1' : '0'); }, [ovSubEnabled]);
  useEffect(() => { localStorage.setItem('fr_ovSubY',        String(ovSubY));              }, [ovSubY]);
  useEffect(() => { localStorage.setItem('fr_ovSubSize',     String(ovSubSize));           }, [ovSubSize]);
  useEffect(() => { localStorage.setItem('fr_ovSubColor',    ovSubColor);                  }, [ovSubColor]);
  useEffect(() => { localStorage.setItem('fr_ovSubMaxWords', String(ovSubMaxWords));       }, [ovSubMaxWords]);
  useEffect(() => { localStorage.setItem('fr_ovSubBgOpacity',String(ovSubBgOpacity));      }, [ovSubBgOpacity]);
  useEffect(() => {
    if (!ovLogoPath) { setOvLogoDataUrl(null); return; }
    api.readImageAsDataUrl?.(ovLogoPath).then(url => setOvLogoDataUrl(url || null)).catch(() => setOvLogoDataUrl(null));
  }, [ovLogoPath]);
  useEffect(() => { localStorage.setItem('fr_charContext', charContextSaved); }, [charContextSaved]);
  useEffect(() => { localStorage.setItem('fr_refText',   refText);   }, [refText]);
  useEffect(() => { videosRef.current = videos; }, [videos]);

  useEffect(() => {
    if (ttsEngine !== 'vieneu') return;
    api.vieNeuGetVoices?.().then(r => {
      if (!r?.voices?.length) return;
      setVieNeuVoices(r.voices);
      // Auto-fix stale/invalid voice: extract last comma-segment and match against available voices
      setTtsVoice(prev => {
        if (r.voices.includes(prev)) return prev; // already valid
        // Try extracting voice name from "Label — desc,VoiceName" format
        const candidate = prev.includes(',') ? prev.split(',').pop().trim() : prev.trim();
        return r.voices.includes(candidate) ? candidate : r.voices[0];
      });
    }).catch(() => {});
  }, [ttsEngine]);

  // Auto-load home on mount
  useEffect(() => { loadHome(); }, []);

  const addLog = (txt) => setLog(prev => [`[${new Date().toLocaleTimeString()}] ${txt}`, ...prev].slice(0, 200));

  // ── Browse: load home dramas ─────────────────────────────────────────────
  async function loadHome(tabKey = '', positionIndex = '') {
    setBrowseLoading(true);
    setBrowseError('');
    setSelectedDrama(null);
    try {
      if (authStatus === 'idle') {
        const authR = await api.freeReelsAuth?.();
        if (!authR?.success) { setBrowseError('Auth thất bại: ' + (authR?.error || 'unknown')); setAuthStatus('error'); return; }
        setAuthStatus('ok');
      }

      const r = await api.freeReelsHome?.({ tabId: tabKey });
      setRawHome(r);

      // Store tabs for tab bar
      if (Array.isArray(r?.tabs) && r.tabs.length) {
        setApiTabs(r.tabs);
        if (!tabKey) setActiveTabKey(r.tabs[0]?.tab_key || '');
      }

      // Extract pagination info
      const innerData = r?.data?.data;
      const modules = innerData?.items || [];
      const recModule = modules.find(m => m.type === 'recommend') || modules[0] || {};
      const pg = innerData?.page_info || {};
      setModuleKey(recModule.module_key || '');
      setNextCursor(pg.next || 'offset=0');
      setHasMore(!!pg.has_more);

      const items = extractDramaList(r?.data);
      setDramas(items);
      if (!items.length) setBrowseError('Không có dữ liệu từ API — xem raw response bên dưới');
    } catch (e) {
      setBrowseError(e.message);
    } finally {
      setBrowseLoading(false);
    }
  }

  async function switchApiTab(tab) {
    setActiveTabKey(tab.tab_key);
    setDramas([]);
    setHasMore(false);
    await loadHome(tab.tab_key, tab.position_index);
  }

  async function loadMore() {
    if (!moduleKey || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await api.freeReelsFeed?.({ moduleKey, next: nextCursor });
      const inner = r?.data?.data || r?.data;
      const newItems = (inner?.items || []).filter(i => i.episode_info || i.key);
      const pg = inner?.page_info || {};
      setNextCursor(pg.next || '');
      setHasMore(!!pg.has_more);
      const normalized = newItems.map(normalizeDrama).filter(Boolean);
      setDramas(prev => {
        const ids = new Set(prev.map(d => d.id));
        return [...prev, ...normalized.filter(d => !ids.has(d.id))];
      });
      addLog(`📄 Tải thêm: +${normalized.length} phim (tổng ${dramas.length + normalized.length})`);
    } catch (e) {
      addLog('❌ Tải thêm thất bại: ' + e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadAllPages() {
    let cursor = nextCursor;
    let more = hasMore;
    let total = dramas.length;
    let page = 0;
    setLoadingMore(true);
    addLog(`📥 Bắt đầu tải toàn bộ catalog...`);
    try {
      while (more && cursor && page < 200) { // max 200 pages safety
        const r = await api.freeReelsFeed?.({ moduleKey, next: cursor });
        const inner = r?.data?.data || r?.data;
        const newItems = (inner?.items || []).filter(i => i.episode_info || i.key);
        const pg = inner?.page_info || {};
        cursor = pg.next || '';
        more = !!pg.has_more;
        const normalized = newItems.map(normalizeDrama).filter(Boolean);
        setDramas(prev => {
          const ids = new Set(prev.map(d => d.id));
          const added = normalized.filter(d => !ids.has(d.id));
          total = prev.length + added.length;
          return [...prev, ...added];
        });
        page++;
        if (page % 5 === 0) addLog(`📄 Trang ${page}: ${total} phim...`);
        if (!pg.has_more || !pg.next) break;
        await new Promise(res => setTimeout(res, 150)); // rate limit
      }
      setHasMore(false);
      addLog(`✅ Đã tải xong: ${total} phim tổng cộng`);
    } catch (e) {
      addLog('❌ Tải catalog thất bại: ' + e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function queueAllEpisodes(eps, drama) {
    let count = 0;
    for (const ep of eps) {
      const url = ep.m3u8_url || ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8
                || ep.video_url || ep.play_url || '';
      if (!url) continue;
      const epNo = ep.episode_no ?? ep.number ?? ep.index ?? ep.sort ?? (count + 1);
      addToQueue(url, `${drama?.title || 'Drama'} - Tập ${epNo}`, drama?.cover);
      count++;
    }
    if (count) {
      setTab('queue');
      addLog(`➕ Queue tất cả: ${count} tập của "${drama?.title}"`);
    } else {
      alert('Không có tập nào có URL video. Thử click "Xem tập" trước.');
    }
  }

  async function doSearch() {
    if (!searchQ.trim()) return;
    setBrowseLoading(true);
    setBrowseError('');
    setSelectedDrama(null);
    try {
      const r = await api.freeReelsSearch?.({ keyword: searchQ.trim(), page: 1 });
      const items = extractDramaList(r?.data);
      setDramas(items);
      if (!items.length) setBrowseError('Không tìm thấy kết quả');
    } catch (e) {
      setBrowseError(e.message);
    } finally {
      setBrowseLoading(false);
    }
  }

  // Extract drama list from various API response shapes
  function extractDramaList(data) {
    if (!data) return [];

    // New home endpoint returns { data: { data: { items: [modules...] } }, tabs: [...] }
    // Each module has { type, items: [drama_cards...] }
    // Drama cards have { series_id, title, cover, episode_count, ... }
    const tryModules = (obj) => {
      const items = obj?.items ?? obj?.modules ?? obj?.sections;
      if (!Array.isArray(items)) return null;
      const all = [];
      for (const mod of items) {
        const modItems = mod?.items || mod?.content || [];
        if (Array.isArray(modItems)) {
          for (const card of modItems) {
            // card may be the drama itself or wrap episode_info
            const drama = card?.series_info || card?.drama || card?.info || card;
            if (drama?.key || drama?.series_id || drama?.id) all.push(drama);
          }
        }
      }
      return all.length ? all : null;
    };

    // Walk possible nesting: data.data.data, data.data, data
    for (const candidate of [data?.data?.data, data?.data, data]) {
      const found = tryModules(candidate);
      if (found) return found.map(normalizeDrama).filter(Boolean);
      // Also try direct lists
      for (const key of ['list', 'items', 'dramas', 'content', 'results', 'recommend', 'series_list']) {
        if (Array.isArray(candidate?.[key]) && candidate[key].length)
          return candidate[key].map(normalizeDrama).filter(Boolean);
      }
    }
    if (Array.isArray(data) && data.length) return data.map(normalizeDrama).filter(Boolean);
    return [];
  }

  function normalizeDrama(item) {
    if (!item) return null;
    // Drama cards from homepage use 'key' as the series identifier
    const id = item.key || item.series_id || item.id || item.drama_id || item.content_id;
    if (!id) return null;
    // episode_info holds the first episode's URL — available directly in listing
    const epInfo = item.episode_info;
    const ep1url = epInfo?.external_audio_h264_m3u8 || epInfo?.external_audio_h265_m3u8
                || epInfo?.m3u8_url || epInfo?.video_url || '';
    return {
      id,
      title: item.title || item.name || item.drama_name || item.series_name || '',
      cover: item.cover || item.cover_url || item.thumbnail || item.image || '',
      category: Array.isArray(item.tag) ? item.tag[0] : (item.category || item.genre || ''),
      episode_count: item.episode_count || item.total_episode || item.episode_total || 0,
      ep1url,     // direct URL for episode 1 — already in the listing
      ep1id: epInfo?.id || '',
      _raw: item,
    };
  }

  // ── Browse: load drama episodes ───────────────────────────────────────────
  async function selectDrama(drama) {
    setSelectedDrama(drama);
    setEpisodes([]);
    setRawEpInfo(null);
    if (!drama.id) return;
    setEpLoading(true);
    try {
      // Pass both the key (drama.id) and any numeric series_id from raw card
      const rawId = drama._raw?.series_id || drama._raw?.drama_id || '';
      addLog(`🔍 Drama info: key=${drama.id}, rawId=${rawId || '(none)'}, rawKeys=[${Object.keys(drama._raw || {}).slice(0,8).join(',')}]`);
      const r = await api.freeReelsDramaInfo?.({ dramaId: drama.id, rawId: String(rawId || '') });
      setRawEpInfo(r);
      const eps = extractEpisodes(r?.data);
      setEpisodes(eps);
      if (!eps.length) {
        // Show per-endpoint summary to help debug
        const tried = r?._tried || {};
        const summary = Object.entries(tried).map(([ep, v]) =>
          `  ${ep.replace('/drama/','')}: code=${v.code ?? '?'} ${v.raw ? `raw(${v.rawLen ?? '?'}b)` : v.hasData ? 'hasData' : v.error || ''}`.slice(0, 80)
        ).join('\n');
        addLog(`⚠ Tập thất bại (id=${drama.id})\n${summary}`);
      }
    } catch (e) {
      addLog('❌ Không tải được tập: ' + e.message);
    } finally {
      setEpLoading(false);
    }
  }

  function extractEpisodes(data) {
    if (!data) return [];
    // /drama/info returns data.data.info.episode_list
    for (const candidate of [data?.data?.info, data?.data?.data?.info, data?.data, data?.data?.data, data]) {
      if (!candidate) continue;
      for (const key of ['episode_list', 'episodes', 'list', 'items']) {
        if (Array.isArray(candidate[key]) && candidate[key].length) return candidate[key];
      }
    }
    return [];
  }

  // ── Queue: add episode to process ────────────────────────────────────────
  function queueEpisode(ep) {
    // episode_list items may have: m3u8_url, video_url, external_audio_h264_m3u8, external_audio_h265_m3u8, play_url, url
    const url = ep.m3u8_url || ep.external_audio_h264_m3u8 || ep.external_audio_h265_m3u8
              || ep.video_url || ep.play_url || ep.url || ep.mp4_url || '';
    const drama = selectedDrama;
    const epNo = ep.episode_no ?? ep.number ?? ep.index ?? ep.sort ?? '?';
    const title = `${drama?.title || 'Drama'} - Tập ${epNo}`;
    if (!url) {
      addLog(`⚠ Tập ${epNo}: API chưa trả về URL video`);
      alert(`Tập ${epNo} chưa có URL video.\nRaw ep keys: ${Object.keys(ep).join(', ')}`);
      return;
    }
    addToQueue(url, title, drama?.cover);
    setTab('queue');
    addLog(`➕ Queue: ${title} → ${url.slice(0, 60)}`);
  }

  function addToQueue(url, title, thumbnail = null) {
    setVideos(prev => {
      if (prev.some(v => v.url === url)) return prev;
      return [...prev, {
        id: Date.now() + Math.random(),
        url, title: title || guessTitle(url), thumbnail,
        duration: 0, status: 'idle', msg: '', outputPath: null, localPath: null, selected: false,
      }];
    });
  }

  function guessTitle(url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split('/').filter(Boolean).pop() || 'video';
      return seg.replace(/\.[^.]+$/, '').replace(/_|-/g, ' ').slice(0, 60);
    } catch { return 'FreeReels Video'; }
  }

  const addFromUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    addToQueue(url, '');
    setUrlInput('');
    addLog(`➕ Thêm URL: ${url.slice(0, 60)}`);
  };

  const setStep = (id, status, msg = '') =>
    setVideos(prev => prev.map(v => v.id === id ? { ...v, status, msg } : v));

  const processVideo = useCallback(async (id) => {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    if (!outFolder) { alert('Vui lòng chọn thư mục lưu!'); return; }

    activeCountRef.current++;
    setProcessing(true);
    setStep(id, 'downloading', 'Đang tải video...');
    addLog(`⬇ Bắt đầu: ${v.title}`);

    // track SRT paths để xóa sau khi xong
    let _srtOrigPath = null;
    let _srtViPath   = null;

    try {
      // ① Download
      const dlRes = await api.freeReelsDownload?.({ url: v.url, outputFolder: outFolder, title: v.title });
      if (!dlRes?.success) { setStep(id, 'error', 'Tải thất bại: ' + (dlRes?.error || '')); addLog('❌ ' + dlRes?.error); return; }
      const mp4 = dlRes.outputPath;
      setVideos(prev => prev.map(x => x.id === id ? { ...x, localPath: mp4 } : x));
      addLog(`✅ Đã tải: ${mp4}`);

      const processDir = reupFolder || outFolder;
      const baseName   = mp4.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');

      // ①.5 — Recreate (lách content ID + cắt ngẫu nhiên) TRƯỚC khi transcribe
      // Whisper sẽ đọc timestamps từ video đã cắt → TTS & SRT tự khớp timeline
      let videoToTranscribe = mp4;
      let videoForMix       = mp4;
      if (doRecreate && rcRandomCut) {
        setStep(id, 'recreating', 'Tái tạo (lách content ID)...');
        addLog('🔄 Tái tạo video trước khi nhận dạng...');
        const rcEarlyRes = await api.videoRecreate?.({
          videoPath:      mp4,
          outputFolder:   processDir,
          outputFileName: baseName + '_reup.mp4',
          zoom:           rcZoom,
          randomCut:      true,
          hFlip:          rcHFlip,
          grain:          rcGrain,
          grainLevel:     rcGrainLevel,
          colorShift:     rcColorShift,
          colorLevel:     rcColorLevel,
          randomPos:      rcRandomPos,
          randomFps:      rcRandomFps,
          rotate:         rcRotate,
          hue:            rcHue,
        }).catch(e => { addLog('⚠ Tái tạo lỗi: ' + e.message); return null; });
        if (rcEarlyRes?.ok) {
          videoToTranscribe = rcEarlyRes.path || (processDir + '/' + baseName + '_reup.mp4');
          videoForMix       = videoToTranscribe;
          addLog('✅ Tái tạo xong — nhận dạng audio từ video đã cắt');
        } else {
          addLog(`⚠ Tái tạo thất bại — dùng video gốc${rcEarlyRes?.error ? ': ' + rcEarlyRes.error : ''}`);
        }
      }

      // ② Transcribe — engine: 'local' | 'groq' | 'auto' (local trước, groq fallback)
      const durRes   = await api.getVideoDuration?.({ path: videoToTranscribe }).catch(() => null);
      const videoDur = durRes?.duration || 0;
      const langOpt  = srcLang === 'auto' ? undefined : srcLang;

      const runGroqWhisper = async (label) => {
        const groqKeys = loadGroqKeysForWhisper();
        if (!groqKeys.length) { setStep(id, 'error', `${label}: chưa có Groq API key`); return null; }
        let keyIdx = keyIdxRef.current;
        const CHUNK = videoDur > 0 && videoDur <= 780 ? Math.ceil(videoDur) + 1 : 55;
        const loopMax = videoDur > 0 ? videoDur : 300;
        let segs = [];
        for (let startSec = 0; startSec < loopMax; startSec += CHUNK) {
          const durSec = Math.min(CHUNK, loopMax - startSec);
          if (durSec < 1) break;
          let chunkRes = null;
          for (let attempt = 0; attempt < groqKeys.length; attempt++) {
            const apiKey = groqKeys[(keyIdx + attempt) % groqKeys.length];
            chunkRes = await api.groqWhisperChunk?.({
              filePath: videoToTranscribe, startSec, durationSec: durSec, apiKey, language: langOpt,
            }).catch(e => ({ ok: false, error: e.message }));
            if (chunkRes?.ok) { keyIdx = (keyIdx + attempt) % groqKeys.length; break; }
          }
          if (chunkRes?.ok && chunkRes.segments?.length) segs = [...segs, ...chunkRes.segments];
        }
        keyIdxRef.current = keyIdx;
        return segs.length ? segs : null;
      };

      let segments = [];
      let localWhisperOk = false;

      if (whisperEngine === 'groq') {
        setStep(id, 'transcribing', 'Nhận dạng audio (Groq Whisper)...');
        addLog(`📹 Thời lượng: ${videoDur || '?'}s — Groq Whisper...`);
        const segs = await runGroqWhisper('Groq Whisper');
        if (!segs) { setStep(id, 'error', 'Groq Whisper thất bại'); return; }
        segments = segs;
        addLog(`✅ Groq Whisper: ${segments.length} đoạn`);
      } else if (whisperEngine === 'local') {
        setStep(id, 'transcribing', 'Nhận dạng audio (Local Whisper)...');
        addLog(`📹 Thời lượng: ${videoDur || '?'}s — Local Whisper...`);
        const wRes = await api.whisperLocalTranscribe?.({
          filePath: videoToTranscribe, language: langOpt, modelSize: 'small',
        }).catch(e => ({ ok: false, error: e.message }));
        if (!wRes?.ok || !wRes.segments?.length) {
          setStep(id, 'error', `Local Whisper thất bại: ${wRes?.error || '?'}`); return;
        }
        segments = wRes.segments;
        localWhisperOk = true;
        addLog(`✅ Local Whisper: ${segments.length} đoạn (${wRes.language || '?'})`);
      } else {
        // auto: thử local trước, fallback Groq
        setStep(id, 'transcribing', 'Nhận dạng audio (Local Whisper)...');
        addLog(`📹 Thời lượng: ${videoDur || '?'}s — Local Whisper (auto)...`);
        const wRes = await api.whisperLocalTranscribe?.({
          filePath: videoToTranscribe, language: langOpt, modelSize: 'small',
        }).catch(e => ({ ok: false, error: e.message }));
        if (wRes?.ok && wRes.segments?.length) {
          segments = wRes.segments;
          localWhisperOk = true;
          addLog(`✅ Local Whisper: ${segments.length} đoạn (${wRes.language || '?'})`);
        } else {
          addLog(`⚠ Local Whisper thất bại (${wRes?.error || '?'}) — fallback Groq...`);
          setStep(id, 'transcribing', 'Nhận dạng audio (Groq fallback)...');
          const segs = await runGroqWhisper('Groq fallback');
          if (!segs) { setStep(id, 'error', 'Transcribe thất bại cả local lẫn Groq'); return; }
          segments = segs;
          addLog(`✅ Transcribe (Groq fallback): ${segments.length} đoạn`);
        }
      }

      // ③ Translate SRT segment-by-segment với Gemini
      setStep(id, 'translating', 'Phân tích nhân vật & dịch SRT...');
      const geminiKeys = (() => { try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; } })();
      if (!geminiKeys.length) { setStep(id, 'error', 'Chưa có Gemini API key (thêm trong Settings)'); return; }

      // Helper gọi Gemini
      let gKeyIdx = gemKeyIdxRef.current;
      const callGemini = async (prompt, maxTokens = 2048) => {
        for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
          const gKey = geminiKeys[(gKeyIdx + attempt) % geminiKeys.length];
          try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${gKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens } }),
            });
            const j = await r.json();
            const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (txt) { gKeyIdx = (gKeyIdx + attempt) % geminiKeys.length; return txt; }
            if (j?.error) addLog(`⚠ Gemini: ${j.error.message}`);
          } catch (e) { addLog(`⚠ Gemini: ${e.message}`); }
        }
        return null;
      };

      // Gọi Gemini với video (file_data từ Gemini Files API) + text
      const callGeminiWithVideo = async (fileUri, mimeType, prompt, maxTokens = 16384) => {
        for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
          const gKey = geminiKeys[(gKeyIdx + attempt) % geminiKeys.length];
          try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${gKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [
                  { file_data: { mime_type: mimeType, file_uri: fileUri } },
                  { text: prompt },
                ]}],
                generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
              }),
            });
            const j = await r.json();
            const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (txt) { gKeyIdx = (gKeyIdx + attempt) % geminiKeys.length; return txt; }
            if (j?.error) addLog(`⚠ Gemini video: ${j.error.message}`);
          } catch (e) { addLog(`⚠ Gemini video: ${e.message}`); }
        }
        return null;
      };

      // ③: Upload video → Gemini xem hình + phân tích nhân vật + dịch 1 lần
      setStep(id, 'translating', 'Upload video cho Gemini...');

      // Upload với toàn bộ keys — handler tự xoay nếu key đang dùng bị quota
      addLog('🎬 Upload video để Gemini phân tích nhân vật...');
      // Listen progress từ main
      const _offUpload = api.onFreeReelsUploadProgress?.((msg) => addLog(`  ${msg}`));
      const uploadRes = await api.geminiUploadVideoForTranslation?.({ filePath: mp4, apiKeys: geminiKeys }).catch(e => ({ ok: false, error: e.message }));
      if (typeof _offUpload === 'function') _offUpload();

      let viSegments = [];
      let charContext = charContextSaved.trim() || null;
      let _savedGemT0    = NaN;          // mốc T0 Gemini
      const _gemTimestamps = new Map(); // idx → giây, từng dòng Gemini cung cấp
      // Strip "CharName: " prefix phòng khi Gemini vẫn thêm (cả ASCII lẫn Unicode)
      const stripCharPrefix = (t) => t.replace(/^\*?\[?[A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s\.]{0,35}\]?\*?\s*:\s*/, '').trim();

      if (uploadRes?.ok) {
        addLog(`📹 Gemini nhận video — đang phân tích + dịch ${segments.length} dòng...`);
        const fullScript = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
        const hasContext = !!charContextSaved.trim();
        // Luôn yêu cầu phân tích nhân vật — pass context cũ làm base, bổ sung nhân vật mới
        const charSection = hasContext
          ? `\n=== QUY TẮC XƯNG HÔ ĐÃ TÍCH LŨY ===\n${charContextSaved}\n=== HẾT QUY TẮC ===\nNếu tập này có NHÂN VẬT MỚI chưa có trong quy tắc trên, hãy bổ sung vào phần NHÂN VẬT. Giữ nguyên nhân vật cũ.`
          : `\nXem video, phân tích nhân vật và điền phần NHÂN VẬT bên dưới.`;

        const videoPrompt = `Bạn là chuyên gia dịch phim ngắn sang tiếng Việt (Á Đông hoặc phương Tây đều được).
Hãy XEM video này (hình ảnh + âm thanh) để biết nhân vật nào đang nói câu nào, rồi thực hiện 3 nhiệm vụ dưới đây.
${charSection}

TOÀN BỘ THOẠI GỐC (${segments.length} dòng):
${fullScript}

=== NHIỆM VỤ 1: PHÂN TÍCH NHÂN VẬT (giữ cũ + bổ sung mới) ===
THỂ LOẠI: [hiện đại / cổ trang / phương Tây / ...]
NHÂN VẬT:
- [Tên/cách gọi]: [giới tính] | [vai vế] | [giọng điệu]
BẢNG XƯNG HÔ:
- [A] → [B]: xưng "[từ A tự xưng]", gọi "[từ A dùng cho B]"
LƯU Ý: [phim phương Tây dùng tôi/bạn hoặc tên riêng nếu không có hệ xưng hô Á Đông]

=== NHIỆM VỤ 2: XÁC NHẬN MỐC THỜI GIAN TỪNG DÒNG ===
Xem video (hình + âm thanh), cho biết mỗi câu thoại trong danh sách BẮT ĐẦU được nói tại GIÂY THỨ MẤY trong video.
KHÔNG tính nhạc nền, KHÔNG tính tiếng ồn — chỉ khi nhân vật thực sự MỞ MIỆNG NÓI câu đó.
Cố gắng cho đủ tất cả ${segments.length} dòng. Nếu không chắc một dòng nào, bỏ qua dòng đó (không đoán mò).

=== NHIỆM VỤ 3: DỊCH TOÀN BỘ ${segments.length} DÒNG ===
Dựa vào video (biết AI đang nói với AI), dịch chính xác với xưng hô đúng nhân vật.
NGHIÊM CẤM đổi xưng hô. Không bỏ sót dòng nào.
TUYỆT ĐỐI KHÔNG thêm tên nhân vật, ký hiệu hay label vào trước mỗi dòng dịch. Chỉ trả lời thoại thuần túy (ví dụ SAI: "Alexander: Tôi đã dọn...", ĐÚNG: "Tôi đã dọn...").

QUY TẮC XƯNG HÔ TIẾNG VIỆT (bắt buộc — xác định QUAN HỆ + GIỚI TÍNH trước):

[HIỆN ĐẠI]
• Chồng → Vợ/Người yêu: xưng "anh", gọi "em"
• Vợ → Chồng/Người yêu: xưng "em", gọi "anh"
• Anh trai → Em (trai/gái): xưng "anh", gọi "em"
• Chị gái → Em (trai/gái): xưng "chị", gọi "em"
• Em → Anh trai: xưng "em", gọi "anh"
• Em → Chị gái: xưng "em", gọi "chị"
• Bố/Ba → Con: xưng "bố/ba", gọi "con"
• Mẹ/Má → Con: xưng "mẹ/má", gọi "con"
• Con → Bố: xưng "con", gọi "bố/ba"
• Con → Mẹ: xưng "con", gọi "mẹ/má"
• Ông/Bà → Cháu: xưng "ông/bà", gọi "con/cháu"
• Cháu → Ông/Bà: xưng "con/cháu", gọi "ông/bà"
• Chú (em bố) → Cháu: xưng "chú", gọi "con/cháu"
• Bác (anh/chị bố/mẹ) → Cháu: xưng "bác", gọi "con/cháu"
• Cô (chị/em gái bố) → Cháu: xưng "cô", gọi "con/cháu"
• Dì (chị/em gái mẹ) → Cháu: xưng "dì", gọi "con/cháu"
• Cháu → Chú/Bác/Cô/Dì: xưng "con/cháu", gọi "chú/bác/cô/dì"
• Sếp → Nhân viên (trang trọng): xưng "tôi", gọi "anh/chị/em"
• Nhân viên → Sếp: xưng "tôi/em", gọi "anh/chị/sếp/ông/bà"
• Bạn bè thân: xưng "tao/mình", gọi "mày/bạn"
• Người lạ/trang trọng: xưng "tôi", gọi "ông/bà/anh/chị/cô"

[CỔ TRANG]
• Hoàng đế → tất cả: xưng "trẫm/ta", gọi "khanh/ái khanh/ngươi"
• Quan/Phi → Hoàng đế: xưng "thần/thần thiếp", gọi "bệ hạ/hoàng thượng"
• Con → Vua cha: xưng "nhi thần/con", gọi "phụ hoàng"
• Chủ → Gia nhân: xưng "ta", gọi "ngươi"
• Gia nhân → Chủ: xưng "tiểu nhân/nô tài/nô tỳ", gọi "lão gia/tiểu thư/phu nhân"

[TUYỆT ĐỐI CẤM]
✗ KHÔNG gọi nhân vật NỮ là "anh" (trừ cải trang)
✗ KHÔNG gọi nhân vật NAM là "cô"/"bà"/"chị" (trừ cải trang)
✗ KHÔNG để chồng/người yêu nam xưng "em" với vợ/bạn gái
✗ KHÔNG để con trai xưng "con" mà lại gọi mẹ là "anh"
✗ Mọi cặp xưng hô phải nhất quán trong TOÀN BỘ video

→ Trước mỗi câu: xác định (1) ai nói, (2) giới tính người nói, (3) nói với ai, (4) quan hệ — rồi mới chọn đại từ.
⚠ Các quy tắc trên là MẶC ĐỊNH khi không rõ ràng. Nếu nguyên văn hoặc bối cảnh đã chỉ định CỤ THỂ đại từ (ví dụ nhân vật dùng "tôi" trang trọng, "cô" để giữ khoảng cách, "mày/tao" khi tức...) thì GIỮ NGUYÊN theo bối cảnh — không ép theo bảng.

Trả về ĐÚNG FORMAT (không thêm markdown, không giải thích):

=== NHÂN VẬT ===
[phần phân tích nhân vật]
=== HẾT NHÂN VẬT ===

=== THỜI GIAN BẮT ĐẦU ===
1 → [số giây dòng 1]
2 → [số giây dòng 2]
...${segments.length} → [số giây dòng ${segments.length}]
=== HẾT THỜI GIAN ===

=== BẢN DỊCH ===
1. [dịch dòng 1]
2. [dịch dòng 2]
...${segments.length}. [dịch dòng ${segments.length}]
=== HẾT DỊCH ===`;

        const videoResp = await callGeminiWithVideo(uploadRes.uri, uploadRes.mimeType, videoPrompt, 16384);
        if (videoResp) {
          // Parse nhân vật
          const charMatch = videoResp.match(/=== NHÂN VẬT ===([\s\S]*?)=== HẾT NHÂN VẬT ===/);
          if (charMatch) {
            charContext = charMatch[1].trim();
            setCharContextSaved(charContext);
            addLog('✅ Cập nhật nhân vật tích lũy (giữ cũ + bổ sung mới)');
          }
          // Parse bản dịch — dùng số thứ tự làm anchor
          const transMatch = videoResp.match(/=== BẢN DỊCH ===([\s\S]*?)=== HẾT DỊCH ===/);
          const transText  = transMatch?.[1] || videoResp;
          const lineMap    = new Map();
          for (const line of transText.trim().split('\n')) {
            const m = line.match(/^(\d+)[.)]\s*(.+)/);
            if (m) lineMap.set(parseInt(m[1]) - 1, stripCharPrefix(m[2].trim()));
          }
          if (lineMap.size >= Math.ceil(segments.length * 0.7)) {
            viSegments = segments.map((s, i) => ({ ...s, text: lineMap.has(i) ? lineMap.get(i) : s.text }));
            addLog(`✅ Dịch bằng video: ${lineMap.size}/${segments.length} dòng`);
          } else {
            addLog(`⚠ Video dịch thiếu dòng (${lineMap.size}/${segments.length}) — fallback batch`);
          }

          // Parse timestamp map từ Gemini: "N → giây" cho từng dòng
          const timeMatch = videoResp.match(/=== THỜI GIAN BẮT ĐẦU ===([\s\S]*?)=== HẾT THỜI GIAN ===/);
          if (timeMatch) {
            // parse "M:SS.mm" hoặc "H:MM:SS" hoặc số giây thường
            const parseGemTime = (s) => {
              const clean = s.replace(',', '.').trim();
              const parts = clean.split(':');
              if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
              if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
              return parseFloat(clean);
            };
            for (const line of timeMatch[1].split('\n')) {
              // hỗ trợ: "1 → 2.5", "1 → 1:01.5", "1. 2.5", "1: 2.5", "1) 2.5"
              const m = line.match(/^(\d+)\s*(?:→|[.\-:)>])\s*([\d:.]+)/);
              if (m) {
                const idx = parseInt(m[1]) - 1;
                const t   = parseGemTime(m[2]);
                if (!isNaN(t) && t >= 0 && idx >= 0) _gemTimestamps.set(idx, t);
              }
            }
            if (_gemTimestamps.size > 0) {
              _savedGemT0 = _gemTimestamps.get(0) ?? NaN;
            }
          }
        } else {
          addLog('⚠ Gemini video không phản hồi — fallback batch');
        }
      } else {
        addLog(`⚠ Upload video thất bại (${uploadRes?.error || '?'}) — dùng dịch batch`);
      }

      // Fallback: dịch batch text-only nếu video thất bại hoặc thiếu dòng
      if (viSegments.length < segments.length * 0.7) {
        if (!charContext) {
          addLog('🔍 Gemini phân tích nhân vật từ script...');
          const fullScript = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
          const analyzePrompt = `Đọc kịch bản phim ngắn và tạo bộ quy tắc xưng hô tiếng Việt (phim Á Đông hoặc phương Tây đều được).\nKỊCH BẢN:\n${fullScript}\n\nTrả về (không giải thích thêm):\nTHỂ LOẠI: ...\nNHÂN VẬT:\n- [Tên]: [giới tính] | [vai vế] | [giọng]\nBẢNG XƯNG HÔ:\n- [A] → [B]: xưng "[từ]", gọi "[từ]"\nLƯU Ý: [phim phương Tây dùng tôi/bạn hoặc tên riêng nếu không có hệ xưng hô Á Đông]`;
          charContext = await callGemini(analyzePrompt, 1024);
          if (!charContext) {
            charContext = 'Dịch tự nhiên, nhất quán xưng hô trong suốt phim.';
            addLog('⚠ Không lấy được phân tích nhân vật');
          } else {
            setCharContextSaved(charContext);
            addLog('✅ Phân tích nhân vật xong (text-only)');
          }
        }
        viSegments = [];
        const BATCH = 60;
        for (let bi = 0; bi < segments.length; bi += BATCH) {
          const batch   = segments.slice(bi, bi + BATCH);
          const numbered = batch.map((s, i) => `${bi + i + 1}. ${s.text}`).join('\n');
          const pronounRules = `QUY TẮC XƯNG HÔ TIẾNG VIỆT (mặc định — ưu tiên bối cảnh nếu đã rõ):\n[HIỆN ĐẠI] Chồng→Vợ: xưng"anh"gọi"em" | Vợ→Chồng: xưng"em"gọi"anh" | Anh→Em: xưng"anh"gọi"em" | Chị→Em: xưng"chị"gọi"em" | Em→Anh/Chị: xưng"em"gọi"anh/chị" | Bố/Mẹ→Con: xưng"bố/mẹ"gọi"con" | Con→Bố/Mẹ: xưng"con"gọi"bố/mẹ" | Ông/Bà→Cháu: xưng"ông/bà"gọi"cháu/con" | Cháu→Ông/Bà: xưng"cháu/con"gọi"ông/bà" | Chú/Bác/Cô/Dì→Cháu: xưng chính mình gọi"cháu/con" | Cháu→Chú/Bác/Cô/Dì: xưng"cháu"gọi đúng vai | Sếp↔NV(trang trọng): xưng"tôi" | Bạn thân: xưng"tao"gọi"mày"\n[CỔ TRANG] Vua: xưng"trẫm/ta"gọi"khanh/ngươi" | Thần→Vua: xưng"thần"gọi"bệ hạ" | Gia nhân→Chủ: xưng"tiểu nhân/nô tài"gọi"lão gia/tiểu thư"\n[CẤM] KHÔNG gọi NỮ là"anh" | KHÔNG gọi NAM là"cô/bà/chị" | KHÔNG để chồng xưng"em" với vợ\n[GIỮ NGUYÊN nếu bối cảnh/nguyên văn đã dùng cụ thể: "tôi"(trang trọng), "cô"(giữ khoảng cách), "mày/tao"(thân/tức) — không ép theo bảng]`;
          const batchPrompt = `Bạn là dịch giả phim chuyên nghiệp. Dịch các dòng thoại từ tiếng Anh sang tiếng Việt.\n\n=== QUY TẮC NHÂN VẬT ===\n${charContext}\n=== HẾT ===\n\n${pronounRules}\n\nNGHIÊM CẤM đổi xưng hô. Giữ nguyên số thứ tự. Chỉ trả danh sách:\n${numbered}`;
          const batchVi  = await callGemini(batchPrompt, 8192);
          if (!batchVi) { setStep(id, 'error', `Dịch thất bại (batch ${bi})`); return; }
          const lmap = new Map();
          for (const line of batchVi.trim().split('\n')) {
            const m = line.match(/^(\d+)[.)]\s*(.+)/);
            if (m) lmap.set(parseInt(m[1]) - 1, stripCharPrefix(m[2].trim()));
          }
          viSegments = [...viSegments, ...batch.map((s, i) => ({ ...s, text: lmap.has(bi + i) ? lmap.get(bi + i) : s.text }))];
          addLog(`✅ Dịch batch ${bi + 1}–${Math.min(bi + BATCH, segments.length)}: xong`);
        }
      }
      gemKeyIdxRef.current = gKeyIdx;

      // Chỉnh timing — áp dụng SAU khi viSegments hoàn chỉnh
      // Ưu tiên: dùng timestamp Gemini từng seg (chính xác nhất)
      // Fallback: shift đều theo T0 nếu Gemini không trả đủ timestamp
      // Bỏ qua khi Local Whisper đã cho timestamp chuẩn (tránh Gemini gây overlap)
      if (!localWhisperOk && viSegments.length > 0 && (_gemTimestamps.size > 0 || !isNaN(_savedGemT0))) {
        const gemCount = _gemTimestamps.size;
        if (gemCount >= Math.ceil(viSegments.length * 0.5)) {
          // Gemini trả >= 50% timestamp → dùng trực tiếp từng seg
          // Những seg không có → nội suy từ hai điểm gần nhất
          viSegments = viSegments.map((s, i) => {
            const gemT = _gemTimestamps.get(i);
            if (gemT !== undefined) {
              const origDur = Math.max(0.1, (s.end ?? 0) - (s.start ?? 0));
              return {
                ...s,
                start:       gemT,
                end:         gemT + origDur,
                speechStart: gemT,
              };
            }
            // Nội suy: tìm điểm gem gần nhất trước và sau
            let prevI = -1, nextI = -1;
            for (let j = i - 1; j >= 0; j--)  if (_gemTimestamps.has(j)) { prevI = j; break; }
            for (let j = i + 1; j < viSegments.length; j++) if (_gemTimestamps.has(j)) { nextI = j; break; }
            if (prevI >= 0 && nextI >= 0) {
              const t = _gemTimestamps.get(prevI) + (_gemTimestamps.get(nextI) - _gemTimestamps.get(prevI)) * (i - prevI) / (nextI - prevI);
              const origDur = Math.max(0.1, (s.end ?? 0) - (s.start ?? 0));
              return { ...s, start: t, end: t + origDur, speechStart: t };
            }
            return s; // giữ nguyên nếu không thể nội suy
          });
          addLog(`📐 Gemini timing: áp ${gemCount} mốc trực tiếp + nội suy ${viSegments.length - gemCount} seg`);
        } else {
          // Gemini trả ít timestamp → chỉ shift đều theo T0
          const groqT0 = viSegments[0].speechStart ?? viSegments[0].start ?? 0;
          const shift  = (_savedGemT0 || 0) - groqT0;
          if (shift > 0.1) {
            viSegments = viSegments.map(s => ({
              ...s,
              start:       Math.max(0, (s.start ?? 0) + shift),
              end:         Math.max(0, (s.end   ?? 0) + shift),
              speechStart: Math.max(0, (s.speechStart ?? s.start ?? 0) + shift),
            }));
            addLog(`📐 Shift đều ${viSegments.length} seg: Groq ${groqT0.toFixed(2)}s → Gemini ${(_savedGemT0||0).toFixed(2)}s (+${shift.toFixed(2)}s)`);
          } else {
            addLog(`📐 Mốc đầu OK: Groq ${groqT0.toFixed(2)}s, Gemini ${(_savedGemT0||0).toFixed(2)}s`);
          }
        }
      }

      // Validate & clean subtitles — loại bỏ đoạn trùng, sửa echo trong segment
      viSegments = validateSubtitles(viSegments, addLog);

      // Gemini fix: chỉ detect dòng lỗi → chỉ gửi dòng đó → chỉ apply dòng đó
      if (viSegments.length > 0) {
        const needsFix = new Set();
        for (let i = 0; i < viSegments.length; i++) {
          const t = viSegments[i].text;
          if (/(.{2,})\s+\1/.test(t)) needsFix.add(i); // lặp cụm trong cùng 1 dòng
          if (i > 0 && viSegments[i - 1].text === t) { needsFix.add(i - 1); needsFix.add(i); } // 2 dòng liền giống nhau
        }
        if (needsFix.size > 0) {
          addLog(`🔍 Gemini fix ${needsFix.size} dòng sub bị lặp...`);
          const flaggedIdx = [...needsFix].sort((a, b) => a - b);
          const flaggedList = flaggedIdx.map(i => `${i + 1}. ${viSegments[i].text}`).join('\n');
          const fixPrompt = `Sửa các dòng phụ đề tiếng Việt bị lỗi sau (dịch từ phim ngắn).
Lỗi cần sửa: lặp từ/cụm trong 1 dòng, hoặc 2 dòng liền nhau giống hệt nhau.
Cách sửa: xóa phần lặp thừa, hoặc diễn đạt lại câu 2 cho tự nhiên hơn.
Giữ nguyên số thứ tự gốc. Chỉ trả các dòng đã sửa, không giải thích:
${flaggedList}`;
          const reviewed = await callGemini(fixPrompt, 2048).catch(() => null);
          if (reviewed) {
            const lineMap = new Map();
            for (const line of reviewed.trim().split('\n')) {
              const m = line.match(/^(\d+)[.)]\s*(.+)/);
              if (m) lineMap.set(parseInt(m[1]) - 1, m[2].trim());
            }
            let fixedCount = 0;
            viSegments = viSegments.map((s, i) => {
              if (needsFix.has(i) && lineMap.has(i)) { fixedCount++; return { ...s, text: lineMap.get(i) }; }
              return s; // dòng không lỗi → giữ nguyên
            });
            addLog(fixedCount > 0 ? `✅ Gemini fix ${fixedCount} dòng lặp` : '⚠ Gemini không trả fix nào');
          } else {
            addLog('⚠ Gemini fix sub thất bại — giữ sub gốc');
          }
        }
      }

      // Dedup cứng: xóa dòng liền nhau giống hệt (bất kể Gemini fix xong chưa)
      viSegments = viSegments.filter((s, i) => i === 0 || s.text.trim() !== viSegments[i - 1].text.trim());

      const viText = viSegments.map(s => s.text).join(' ');
      addLog(`✅ Dịch: ${viSegments.length} đoạn → "${viText.slice(0, 60)}..."`);

      // ③.5 — Lưu SRT gốc + SRT tiếng Việt (timestamps gốc)
      const toSrt = (segs) => segs.map((s, i) => {
        const fmt = (sec) => {
          const ms = Math.round((sec % 1) * 1000);
          const ss = Math.floor(sec) % 60;
          const mm = Math.floor(sec / 60) % 60;
          const hh = Math.floor(sec / 3600);
          return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
        };
        return `${i+1}\n${fmt(s.speechStart ?? s.start)} --> ${fmt(s.end)}\n${s.text}\n`;
      }).join('\n');
      const srtOrigPath = processDir + '/' + baseName + '_orig.srt';
      const srtViPath   = processDir + '/' + baseName + '_vi.srt';
      _srtOrigPath = srtOrigPath; _srtViPath = srtViPath;
      await api.writeTextFile?.({ path: srtOrigPath, content: toSrt(segments) }).catch(() => {});
      await api.writeTextFile?.({ path: srtViPath,   content: toSrt(viSegments) }).catch(() => {});
      addLog(`📄 SRT gốc: ${srtOrigPath.split(/[/\\]/).pop()}`);
      addLog(`📄 SRT tiếng Việt: ${srtViPath.split(/[/\\]/).pop()}`);

      // ④ TTS
      setStep(id, 'dubbing', `Lồng tiếng (${ttsEngine})...`);
      let ttsPath = processDir + '/' + baseName + '_vi_tts.wav';
      const segsMs = viSegments.map(s => ({ ...s, startMs: Math.round((s.start ?? 0) * 1000), endMs: Math.round((s.end ?? 0) * 1000), speechStartMs: Math.round((s.speechStart ?? s.start ?? 0) * 1000) }));
      if (segsMs.length > 0) addLog(`🎙 TTS seg[0]: delay=${segsMs[0].speechStartMs}ms (Groq start=${segsMs[0].startMs}ms)`);
      let ttsOk = false;

      // Helper: try Kokoro as last-resort fallback
      const tryKokoro = async () => {
        addLog(`🔄 Fallback → Kokoro TTS...`);
        const r = await api.kokoroSynthesize?.({ text: viText, outputPath: ttsPath })
                       .catch(e => ({ success: false, error: e.message }));
        const ok = !!(r?.success || r?.ok);
        if (!ok) addLog(`⚠ Kokoro: ${(r?.error || JSON.stringify(r)).slice(0, 100)}`);
        return ok;
      };

      if (ttsEngine === 'vieneu') {
        const vnVoiceId  = vieNeuMode === 'clone' ? '' : (ttsVoice || '');
        const vnRefAudio = vieNeuMode === 'clone' ? refAudio : '';
        const vnRefText  = vieNeuMode === 'clone' ? refText  : '';
        const modeLabel  = vieNeuMode === 'clone'
          ? `clone: ${(refAudio || '').split(/[/\\]/).pop() || '?'}`
          : (vnVoiceId || 'mặc định');
        addLog(`🎙 VieNeu SRT: ${segsMs.length} đoạn (${modeLabel})...`);
        let r = await api.vieNeuSynthesizeSRT?.({ segments: segsMs, voiceId: vnVoiceId, refAudio: vnRefAudio, refText: vnRefText, outputPath: ttsPath })
                       .catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success || r?.ok);
        if (!ttsOk) {
          addLog(`⚠ VieNeu SRT thất bại (${(r?.error || '').slice(0, 60)}), thử single-text...`);
          r = await api.vieNeuSynthesize?.({ text: viText, voiceId: vnVoiceId, refAudio: vnRefAudio, refText: vnRefText, outputPath: ttsPath })
                     .catch(e => ({ success: false, error: e.message }));
          ttsOk = !!(r?.success || r?.ok);
          if (!ttsOk) {
            const errFull = (r?.error || JSON.stringify(r) || '').replace(/\r\n/g, '\n');
            addLog(`⚠ VieNeu single err:\n${errFull.slice(-400)}`);
            ttsOk = await tryKokoro();
          }
        }
      } else if (ttsEngine === 'capcut') {
        const ccVoice = CAPCUT_VI_VOICES.find(v => v.voice === capcutVoice) || CAPCUT_VI_VOICES[0];
        addLog(`🎙 CapCut SRT: ${segsMs.length} đoạn (${ccVoice.label})...`);
        const r = await api.capcutTTSSRT?.({
          segments: segsMs,
          voice: ccVoice.voice,
          resourceId: ccVoice.resourceId,
          outputPath: ttsPath,
        }).catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success);
        if (!ttsOk) addLog(`⚠ CapCut TTS SRT: ${(r?.error || JSON.stringify(r)).slice(0, 250)}`);
      } else if (ttsEngine === 'kokoro') {
        const r = await api.kokoroSynthesize?.({ text: viText, outputPath: ttsPath })
                       .catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success || r?.ok);
        if (!ttsOk) addLog(`⚠ Kokoro: ${(r?.error || JSON.stringify(r)).slice(0, 100)}`);
      } else if (ttsEngine === 'gemini') {
        const gKey = geminiKeys[gemKeyIdxRef.current % geminiKeys.length];
        const ttsFileName = baseName + '_vi_tts.wav';
        const r = await api.geminiTTS?.({
          text: viText,
          voiceName: geminiVoice || 'Charon',
          outputFolder: processDir,
          projectName: ttsFileName,
          apiKey: gKey,
        }).catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success || r?.ok);
        if (ttsOk && r?.path) ttsPath = r.path; // use actual saved path
        if (!ttsOk) {
          addLog(`⚠ Gemini TTS: ${(r?.error || JSON.stringify(r)).slice(0, 100)}`);
          ttsOk = await tryKokoro(); // auto-fallback to Kokoro
        }
      }
      if (!ttsOk) { setStep(id, 'error', 'TTS thất bại — xem log'); return; }
      addLog(`✅ TTS xong`);

      // ⑤ Mix — videoForMix: đã recreate (nếu randomCut) hoặc gốc
      setStep(id, 'mixing', 'Ghép âm thanh...');
      const mixedPath = processDir + '/' + baseName + '_vi_mixed.mp4';
      const mixRes = await api.mixAudio?.({ videoPath: videoForMix, audioPath: ttsPath, outputPath: mixedPath, videoVol: muteOrig ? 0 : origVol / 100, audioVol: ttsVol / 100 });
      if (!mixRes?.success) { setStep(id, 'error', 'Mix thất bại'); return; }
      addLog(`✅ Mix xong`);

      let finalPath = mixedPath;
      const midPaths = [];

      // ⑥ Tái tạo (chỉ khi chưa recreate ở ③.6, tức là rcRandomCut=false)
      if (doRecreate && !rcRandomCut) {
        setStep(id, 'recreating', 'Tái tạo...');
        addLog('🔄 Tái tạo (chống FP)...');
        const rcFileName = baseName + '_reup.mp4';
        const rcRes = await api.videoRecreate?.({
          videoPath:      finalPath,
          outputFolder:   processDir,
          outputFileName: rcFileName,
          zoom:           rcZoom,
          randomCut:      false,
          hFlip:          rcHFlip,
          grain:          rcGrain,
          grainLevel:     rcGrainLevel,
          colorShift:     rcColorShift,
          colorLevel:     rcColorLevel,
          randomPos:      rcRandomPos,
          randomFps:      rcRandomFps,
          rotate:         rcRotate,
          hue:            rcHue,
        }).catch(e => { addLog('⚠ Tái tạo lỗi: ' + e.message); return null; });
        if (rcRes?.ok) {
          midPaths.push(finalPath);
          finalPath = rcRes.path || (processDir + '/' + rcFileName);
          addLog('✅ Tái tạo xong');
        } else { addLog('⚠ Tái tạo thất bại — dùng file gốc'); }
      }

      // ⑦ Overlay (logo + tên kênh + phụ đề)
      // cutSegs truyền sang overlay để điều chỉnh SRT timestamps khớp với timeline sau random cut
      const anyOverlay = ovLogoEnabled || ovChanEnabled || (ovSubEnabled && _srtViPath);
      if (anyOverlay) {
        setStep(id, 'overlaying', 'Thêm overlay...');
        addLog('🎨 Thêm overlay...');
        const ovFileName = baseName + '_ov.mp4';
        const ovRes = await api.videoAddOverlay?.({
          inputPath:  finalPath,
          outputPath: processDir + '/' + ovFileName,
          logo:    ovLogoEnabled ? { path: ovLogoPath, x: ovLogoX, y: ovLogoY, w: ovLogoW, opacity: ovLogoOpacity } : null,
          channel: ovChanEnabled ? { text: ovChanText, x: ovChanX, y: ovChanY, size: ovChanSize, color: ovChanColor } : null,
          sub:     (ovSubEnabled && _srtViPath) ? { srtPath: _srtViPath, y: ovSubY, size: ovSubSize, color: ovSubColor, maxWords: ovSubMaxWords, bgOpacity: ovSubBgOpacity } : null,
        }).catch(e => { addLog('⚠ Overlay lỗi: ' + e.message); return null; });
        if (ovRes?.ok) {
          midPaths.push(finalPath);
          finalPath = ovRes.path || (processDir + '/' + ovFileName);
          addLog(ovRes.warn ? `✅ Overlay xong (⚠ ${ovRes.warn})` : '✅ Overlay xong');
        } else {
          const ovErr = ovRes?.error || 'lỗi không rõ';
          // Tìm dòng lỗi thật sau banner ffmpeg
          const ovErrLines = ovErr.split('\n').filter(l => l.trim());
          const bannerIdx  = ovErrLines.findIndex((l, i) => i > 3 && !l.startsWith(' ') && !l.match(/^lib(av|sw|post)/));
          const ovErrTail  = bannerIdx >= 0
            ? ovErrLines.slice(bannerIdx).join(' | ').slice(0, 400)
            : ovErrLines.slice(-5).join(' | ').slice(0, 400);
          addLog('⚠ Overlay thất bại — ' + (ovErrTail || ovErr.slice(0, 300)));
        }
      }

      setVideos(prev => prev.map(x => x.id === id ? { ...x, status: 'done', msg: '', outputPath: finalPath } : x));
      addLog(`🎉 Hoàn thành: ${finalPath}`);

      // ⑧ Dọn dẹp — xóa tất cả file trung gian, chỉ giữ video reup cuối cùng
      const tempFiles = [
        ttsPath,
        // early-recreate video (videoForMix) nếu khác video gốc
        videoForMix !== mp4 ? videoForMix : null,
        ...midPaths,
        // SRT files
        _srtOrigPath,
        _srtViPath,
      ].filter(Boolean);
      for (const f of tempFiles) {
        await api.deleteFile?.(f).catch(() => {});
      }
      if (tempFiles.length) addLog(`🗑 Đã dọn ${tempFiles.length} file tạm (chỉ giữ video cuối)`);

    } catch (e) {
      setStep(id, 'error', e.message || 'Lỗi không xác định');
      addLog('❌ ' + e.message);
    } finally {
      if (--activeCountRef.current <= 0) { activeCountRef.current = 0; setProcessing(false); }
    }
  }, [videos, outFolder, reupFolder, ttsEngine, ttsVoice, vieNeuMode, refAudio, refText, geminiVoice, capcutVoice, muteOrig, origVol, ttsVol, doRecreate, geminiModel, srcLang, charContextSaved, rcZoom, rcRandomCut, rcHFlip, rcGrain, rcGrainLevel, rcColorShift, rcColorLevel, rcRandomPos, rcRandomFps, rcRotate, rcHue, ovLogoEnabled, ovLogoPath, ovLogoX, ovLogoY, ovLogoW, ovLogoOpacity, ovChanEnabled, ovChanText, ovChanX, ovChanY, ovChanSize, ovChanColor, ovSubEnabled, ovSubY, ovSubSize, ovSubColor, ovSubMaxWords, ovSubBgOpacity]);

  const removeVideo      = (id) => setVideos(prev => prev.filter(v => v.id !== id));
  const openOutputFolder = (fp) => api.openFolder?.(fp.replace(/[/\\][^/\\]+$/, ''));
  const pickFolder       = async () => { const f = await api.selectFolder?.(); if (f) setOutFolder(f); };
  const toggleSelect     = (id) => setVideos(prev => prev.map(v => v.id === id ? { ...v, selected: !v.selected } : v));

  const handleMergeSelected = async () => {
    const selected = videos.filter(v => v.status === 'done' && v.selected && v.outputPath);
    if (selected.length < 2) { alert('Chọn ít nhất 2 tập đã xử lý xong để ghép.'); return; }
    const paths = selected.map(v => v.outputPath);
    const outDir = reupFolder || outFolder;
    const baseName = selected[0].title?.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'merged';
    const outputPath = outDir + '/' + baseName + `_ghep${selected.length}tap.mp4`;
    addLog(`🔗 Ghép ${selected.length} tập → ${outputPath.split(/[/\\]/).pop()}...`);
    const r = await api.videoMergeEpisodes?.({ paths, outputPath }).catch(e => ({ ok: false, error: e.message }));
    if (r?.ok) {
      addLog(`✅ Ghép xong: ${outputPath.split(/[/\\]/).pop()}`);
      api.openFile?.(r.outputPath);
    } else {
      addLog(`❌ Ghép thất bại: ${r?.error || 'lỗi không rõ'}`);
      alert('Ghép thất bại: ' + (r?.error || 'lỗi không rõ'));
    }
  };

  const doneCount  = videos.filter(v => v.status === 'done').length;
  const errorCount = videos.filter(v => v.status === 'error').length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-slate-900 text-white overflow-hidden">

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-[210px] flex-shrink-0 flex flex-col border-r border-slate-700/60 bg-[#07090f] overflow-y-auto">
        <div className="px-3 pt-4 pb-2 border-b border-slate-700/40">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎬</span>
            <div>
              <div className="text-[13px] font-black text-white">FreeReels</div>
              <div className="text-[9px] text-slate-500 flex items-center gap-1">
                Short Drama Reup
                {authStatus === 'ok' && <span className="text-green-400">● API OK</span>}
                {authStatus === 'error' && <span className="text-red-400">● Auth lỗi</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 py-3 flex flex-col gap-3 text-[11px]">
          {/* Download folder */}
          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Thư mục tải về</div>
            <button onClick={pickFolder}
              className="w-full text-left px-2 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 truncate transition">
              📥 {outFolder ? outFolder.split(/[/\\]/).slice(-2).join('/') : 'Chọn thư mục'}
            </button>
          </div>
          {/* Reup output folder — separate from download */}
          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Thư mục Reup (xuất)</div>
            <button
              onClick={async () => { const f = await api.selectFolder?.(); if (f) setReupFolder(f); }}
              className="w-full text-left px-2 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 truncate transition">
              📤 {reupFolder ? reupFolder.split(/[/\\]/).slice(-2).join('/') : outFolder ? '(cùng thư mục tải)' : 'Chọn thư mục'}
            </button>
          </div>

          {/* TTS Engine */}
          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">TTS Engine</div>
            <select value={ttsEngine} onChange={e => setTtsEngine(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
              <option value="vieneu">VieNeu (tốt nhất)</option>
              <option value="capcut">CapCut TTS 🎬</option>
              <option value="kokoro">Kokoro</option>
              <option value="gemini">Gemini TTS</option>
            </select>
          </div>

          {ttsEngine === 'vieneu' && (
            <div className="flex flex-col gap-2">
              {/* Mode toggle: preset / clone */}
              <div>
                <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Chế độ giọng</div>
                <div className="flex gap-1">
                  <button onClick={() => setVieNeuMode('preset')}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition ${vieNeuMode === 'preset' ? 'bg-rose-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                    🎙 Preset
                  </button>
                  <button onClick={() => setVieNeuMode('clone')}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition ${vieNeuMode === 'clone' ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                    🎤 Clone
                  </button>
                </div>
              </div>

              {/* Preset voice picker */}
              {vieNeuMode === 'preset' && vieNeuVoices.length > 0 && (
                <div>
                  <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Giọng VieNeu</div>
                  <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
                    {vieNeuVoices.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Clone voice: ref audio + ref text */}
              {vieNeuMode === 'clone' && (
                <div className="flex flex-col gap-1.5">
                  <div>
                    <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Audio mẫu (WAV/MP3)</div>
                    <button
                      onClick={async () => {
                        const f = await api.selectFile?.({ filters: [{ name: 'Audio', extensions: ['wav','mp3','ogg','flac','m4a'] }] });
                        if (f) setRefAudio(f);
                      }}
                      className="w-full text-left px-2 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 truncate transition text-[10px]">
                      🎵 {refAudio ? refAudio.split(/[/\\]/).pop() : 'Chọn file audio mẫu'}
                    </button>
                    {refAudio && (
                      <button onClick={() => setRefAudio('')}
                        className="mt-0.5 text-[9px] text-slate-500 hover:text-red-400 transition">
                        ✕ Bỏ chọn
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Text mẫu (tuỳ chọn)</div>
                    <textarea
                      value={refText}
                      onChange={e => setRefText(e.target.value)}
                      placeholder="Nhập lời thoại trong audio mẫu..."
                      rows={2}
                      className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[10px] resize-none placeholder-slate-600"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {ttsEngine === 'capcut' && (
            <div>
              <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Giọng CapCut 🎬</div>
              <select value={capcutVoice} onChange={e => setCapcutVoice(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
                {CAPCUT_VI_VOICES.map(v => (
                  <option key={v.voice} value={v.voice}>{v.label}</option>
                ))}
              </select>
              <div className="mt-1 text-slate-500 text-[9px]">Tổng hợp từng đoạn theo mốc SRT, ghép đúng timeline</div>
            </div>
          )}
          {ttsEngine === 'gemini' && (
            <div>
              <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Giọng Gemini</div>
              <select value={geminiVoice} onChange={e => setGeminiVoice(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
                {GEMINI_TTS_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}

          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Gemini Model</div>
            <select value={geminiModel} onChange={e => setGeminiModel(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
              {GEMINI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Ngôn ngữ gốc</div>
            <select value={srcLang} onChange={e => setSrcLang(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
              <option value="auto">Tự phát hiện</option>
              <option value="en">English</option>
              <option value="zh">Tiếng Trung</option>
              <option value="ko">Tiếng Hàn</option>
              <option value="ja">Tiếng Nhật</option>
              <option value="th">Tiếng Thái</option>
            </select>
          </div>

          <div>
            <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Whisper Engine (lấy SRT)</div>
            <select value={whisperEngine}
              onChange={e => { setWhisperEngine(e.target.value); localStorage.setItem('fr_whisperEngine', e.target.value); }}
              className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[11px]">
              <option value="auto">Auto (Local → Groq fallback)</option>
              <option value="local">Local Whisper (faster-whisper)</option>
              <option value="groq">Groq Whisper (API)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">Quy tắc xưng hô (dùng chung nhiều tập)</div>
              {charContextSaved && (
                <button onClick={() => setCharContextSaved('')} className="text-red-400 hover:text-red-300 text-[9px] leading-none">✕ Xóa</button>
              )}
            </div>
            <textarea
              value={charContextSaved}
              onChange={e => setCharContextSaved(e.target.value)}
              placeholder="Tự động điền sau tập 1. Giữ nguyên cho các tập tiếp theo cùng bộ phim. Nhấn ✕ Xóa khi chuyển sang phim khác."
              className="w-full h-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-300 text-[10px] resize-none placeholder-slate-600"
            />
          </div>

          <div>
            <div className="text-slate-400 font-bold mb-1.5 uppercase tracking-wide text-[9px]">Âm lượng TTS</div>
            <div className="flex items-center gap-2">
              <input type="range" min={50} max={150} value={ttsVol} onChange={e => setTtsVol(+e.target.value)}
                className="flex-1 accent-rose-500" />
              <span className="text-slate-400 w-7 text-right">{ttsVol}%</span>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={muteOrig} onChange={e => setMuteOrig(e.target.checked)} className="accent-rose-500" />
            <span className="text-slate-300">Tắt audio gốc</span>
          </label>
          {!muteOrig && (
            <div>
              <div className="text-slate-400 font-bold mb-1 uppercase tracking-wide text-[9px]">Audio gốc: {origVol}%</div>
              <input type="range" min={0} max={50} value={origVol} onChange={e => setOrigVol(+e.target.value)}
                className="w-full accent-slate-400" />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={doRecreate} onChange={e => setDoRecreate(e.target.checked)} className="accent-rose-500" />
            <span className="text-slate-300">Tái tạo (chống FP)</span>
          </label>

          {doRecreate && (
            <div className="mt-1 p-2 bg-slate-800/70 rounded border border-slate-700/50 space-y-2 text-[11px]">
              {/* Zoom */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400 whitespace-nowrap">Zoom xóa logo</span>
                <div className="flex items-center gap-1">
                  <input type="range" min={1} max={15} value={rcZoom}
                    onChange={e => setRcZoom(+e.target.value)}
                    className="w-20 accent-rose-500" />
                  <span className="text-slate-300 w-5 text-right">{rcZoom}%</span>
                </div>
              </div>
              {/* Toggles row 1 */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {[
                  ['Cắt ngẫu nhiên', rcRandomCut, setRcRandomCut],
                  ['Lật ngang',       rcHFlip,     setRcHFlip],
                  ['Crop lệch tâm',   rcRandomPos, setRcRandomPos],
                  ['FPS ngẫu nhiên',  rcRandomFps, setRcRandomFps],
                  ['Xoay tàng hình',  rcRotate,    setRcRotate],
                  ['Xoay màu sắc',    rcHue,       setRcHue],
                ].map(([label, val, setter]) => (
                  <label key={label} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} className="accent-rose-500" />
                    <span className="text-slate-400">{label}</span>
                  </label>
                ))}
              </div>
              {/* Hạt nhiễu */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={rcGrain} onChange={e => setRcGrain(e.target.checked)} className="accent-rose-500" />
                  <span className="text-slate-400">Hạt nhiễu</span>
                </label>
                {rcGrain && (
                  <div className="flex items-center gap-1 pl-5">
                    <input type="range" min={1} max={10} value={rcGrainLevel}
                      onChange={e => setRcGrainLevel(+e.target.value)}
                      className="w-20 accent-rose-500" />
                    <span className="text-slate-300 w-4 text-right">{rcGrainLevel}</span>
                  </div>
                )}
              </div>
              {/* Lệch tông màu */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={rcColorShift} onChange={e => setRcColorShift(e.target.checked)} className="accent-rose-500" />
                  <span className="text-slate-400">Lệch tông màu</span>
                </label>
                {rcColorShift && (
                  <div className="flex gap-1 pl-5">
                    {['light','medium','strong'].map(lvl => (
                      <button key={lvl} onClick={() => setRcColorLevel(lvl)}
                        className={`px-2 py-0.5 rounded text-[10px] ${rcColorLevel === lvl ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                        {lvl === 'light' ? 'Nhẹ' : lvl === 'medium' ? 'Vừa' : 'Mạnh'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── OVERLAY ── */}
          <div className="border-t border-slate-700/40 pt-3 space-y-2">
            <div className="text-slate-400 font-bold uppercase tracking-wide text-[9px]">🎨 Overlay</div>

            {/* Logo */}
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ovLogoEnabled} onChange={e => setOvLogoEnabled(e.target.checked)} className="accent-rose-500" />
                <span className="text-slate-300">🖼 Logo / Watermark</span>
              </label>
              {ovLogoEnabled && (
                <div className="pl-4 space-y-1">
                  <button onClick={async () => { const f = await api.selectFile?.('image'); if (f) setOvLogoPath(f); }}
                    className="w-full px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[10px] text-slate-300 truncate text-left transition">
                    {ovLogoPath ? '📁 ' + ovLogoPath.split(/[/\\]/).pop() : '📁 Chọn file logo'}
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-12">Kích cỡ</span>
                    <input type="range" min={5} max={40} value={ovLogoW} onChange={e => setOvLogoW(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-7 text-right">{ovLogoW}%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-12">Mờ</span>
                    <input type="range" min={10} max={100} value={ovLogoOpacity} onChange={e => setOvLogoOpacity(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-7 text-right">{ovLogoOpacity}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Channel name */}
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ovChanEnabled} onChange={e => setOvChanEnabled(e.target.checked)} className="accent-rose-500" />
                <span className="text-slate-300">📺 Tên kênh YouTube</span>
              </label>
              {ovChanEnabled && (
                <div className="pl-4 space-y-1">
                  <input value={ovChanText} onChange={e => setOvChanText(e.target.value)}
                    placeholder="Tên kênh..."
                    className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-200 text-[10px] placeholder-slate-600" />
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-12">Cỡ chữ</span>
                    <input type="range" min={12} max={60} value={ovChanSize} onChange={e => setOvChanSize(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-5 text-right">{ovChanSize}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-[10px]">Màu</span>
                    <input type="color" value={ovChanColor} onChange={e => setOvChanColor(e.target.value)} className="w-8 h-6 rounded cursor-pointer border-0" />
                    <span className="text-slate-400 text-[9px]">{ovChanColor}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Subtitles overlay */}
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ovSubEnabled} onChange={e => setOvSubEnabled(e.target.checked)} className="accent-rose-500" />
                <span className="text-slate-300">📝 Phụ đề màn hình</span>
              </label>
              {ovSubEnabled && (
                <div className="pl-4 space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 text-[10px]">Từ/dòng</span>
                    <input type="range" min={3} max={10} value={ovSubMaxWords} onChange={e => setOvSubMaxWords(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-4 text-right">{ovSubMaxWords}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 text-[10px]">Cỡ chữ</span>
                    <input type="range" min={14} max={50} value={ovSubSize} onChange={e => setOvSubSize(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-5 text-right">{ovSubSize}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 text-[10px]">Nền mờ</span>
                    <input type="range" min={0} max={100} value={ovSubBgOpacity} onChange={e => setOvSubBgOpacity(+e.target.value)} className="flex-1 accent-rose-500" />
                    <span className="text-slate-300 w-7 text-right">{ovSubBgOpacity}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-[10px]">Màu chữ</span>
                    <input type="color" value={ovSubColor} onChange={e => setOvSubColor(e.target.value)} className="w-8 h-6 rounded cursor-pointer border-0" />
                  </div>
                </div>
              )}
            </div>

            {(ovLogoEnabled || ovChanEnabled || ovSubEnabled) && (
              <button onClick={() => setOvPreviewOpen(true)}
                className="w-full px-2 py-1.5 bg-blue-800 hover:bg-blue-700 text-white text-[11px] font-bold rounded transition flex items-center justify-center gap-1.5">
                👁 Đặt vị trí (Preview)
              </button>
            )}
          </div>

          {videos.length > 0 && (
            <div className="mt-2 px-2 py-2 bg-slate-800 rounded text-[10px] space-y-0.5">
              <div className="text-slate-400">📋 Hàng chờ: <span className="text-white font-bold">{videos.length}</span></div>
              <div className="text-green-400">✅ Xong: <span className="font-bold">{doneCount}</span></div>
              {errorCount > 0 && <div className="text-red-400">❌ Lỗi: <span className="font-bold">{errorCount}</span></div>}
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top tab bar */}
        <div className="flex-shrink-0 flex items-center gap-1 px-3 pt-2 pb-0 border-b border-slate-700/40 bg-[#060a12]">
          {[['browse','🏠 Duyệt Phim'],['queue','📋 Hàng Chờ']].map(([id,label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-t-lg text-[12px] font-bold transition border-b-2 ${tab === id
                ? 'text-white border-rose-500 bg-slate-800/60'
                : 'text-slate-400 border-transparent hover:text-slate-200'}`}>
              {label} {id === 'queue' && videos.length > 0 ? `(${videos.length})` : ''}
            </button>
          ))}
        </div>

        {/* ── BROWSE TAB ── */}
        {tab === 'browse' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Browse sub-tabs + search */}
            <div className="flex-shrink-0 px-3 py-2 border-b border-slate-700/40 bg-[#060a12] flex items-center gap-1.5 overflow-x-auto">
              {/* Search toggle */}
              <button onClick={() => setBrowseTab(browseTab === 'search' ? 'home' : 'search')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${browseTab === 'search' ? 'bg-rose-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                🔍
              </button>

              {browseTab === 'search' ? (
                <div className="flex-1 flex gap-2 min-w-0">
                  <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                    placeholder="Tìm phim..."
                    className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600/60 rounded-lg text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 min-w-0" />
                  <button onClick={doSearch} disabled={browseLoading}
                    className="flex-shrink-0 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 rounded-lg text-[11px] font-bold text-white transition">
                    Tìm
                  </button>
                </div>
              ) : (
                <>
                  {/* Real API tabs */}
                  {apiTabs.length > 0 ? apiTabs.map(t => (
                    <button key={t.tab_key} onClick={() => switchApiTab(t)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${activeTabKey === t.tab_key ? 'bg-rose-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                      {t.name}
                    </button>
                  )) : (
                    <button onClick={() => loadHome()}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-700 text-white">
                      🔥 Nổi bật
                    </button>
                  )}
                  {!browseLoading && (
                    <button onClick={() => { const t = apiTabs.find(x => x.tab_key === activeTabKey); if (t) switchApiTab(t); else loadHome(); }} className="ml-auto flex-shrink-0 px-2 py-1 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 transition">
                      🔄
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Main browse area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Drama grid */}
              <div className="flex-1 overflow-y-auto p-3">
                {browseLoading && (
                  <div className="flex items-center justify-center h-32 gap-2 text-slate-400 text-[12px]">
                    <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                    Đang tải...
                  </div>
                )}
                {!browseLoading && browseError && (
                  <div className="flex flex-col items-start justify-start p-3 gap-2 w-full">
                    <div className="text-red-400 text-[12px]">{browseError}</div>
                    {rawHome && (
                      <details open className="text-[9px] text-slate-400 w-full">
                        <summary className="cursor-pointer text-slate-500 mb-1">▼ Raw API response (copy để báo lỗi)</summary>
                        <pre className="p-2 bg-slate-800 rounded text-[8px] overflow-auto max-h-64 w-full whitespace-pre-wrap break-all border border-slate-700">
                          {JSON.stringify(rawHome, null, 2).slice(0, 4000)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
                {!browseLoading && !browseError && dramas.length === 0 && (
                  <div className="text-center text-slate-500 text-[12px] mt-8">
                    Chưa có phim — nhấn "Nổi bật" để tải
                  </div>
                )}
                {!browseLoading && dramas.length > 0 && (
                  <>
                    <div className="grid grid-cols-4 gap-1.5">
                      {dramas.map((d, i) => (
                        <DramaCard key={d.id || i} drama={d} onSelect={selectDrama}
                          onQueueEp1={(drama) => {
                            addToQueue(drama.ep1url, `${drama.title} - Tập 1`, drama.cover);
                            setTab('queue');
                            addLog(`➕ Queue nhanh: ${drama.title} - Tập 1`);
                          }} />
                      ))}
                    </div>
                    {/* Load more / Load all */}
                    {hasMore && (
                      <div className="flex gap-2 mt-3 px-1">
                        <button
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="flex-1 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                        >
                          {loadingMore ? '⏳ Đang tải...' : `📄 Tải thêm (${dramas.length} phim)`}
                        </button>
                        <button
                          onClick={loadAllPages}
                          disabled={loadingMore}
                          className="flex-1 py-1.5 rounded-lg bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                        >
                          {loadingMore ? '⏳ Đang tải...' : '⬇ Tải Tất Cả'}
                        </button>
                      </div>
                    )}
                    {!hasMore && dramas.length > 0 && (
                      <div className="text-center text-slate-600 text-[10px] mt-2">
                        ✅ Đã tải hết {dramas.length} phim
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Episode panel (right) */}
              {selectedDrama && (
                <div className="w-[260px] flex-shrink-0 border-l border-slate-700/60 flex flex-col bg-[#08080f] overflow-hidden">
                  {/* Header */}
                  <div className="flex-shrink-0 p-3 border-b border-slate-700/40">
                    <div className="flex items-start gap-2">
                      {selectedDrama.cover && (
                        <img src={selectedDrama.cover} alt="" className="w-10 h-14 object-cover rounded flex-shrink-0" referrerPolicy="no-referrer" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-white line-clamp-2">{selectedDrama.title}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">{selectedDrama.episode_count} tập</div>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        {episodes.length > 0 && (
                          <button
                            onClick={() => queueAllEpisodes(episodes, selectedDrama)}
                            className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-[9px] font-bold transition-colors"
                            title="Queue tất cả tập vào danh sách tải"
                          >
                            ⬇ Tải All
                          </button>
                        )}
                        <button onClick={() => setSelectedDrama(null)}
                          className="text-slate-500 hover:text-white text-[14px] self-end">✕</button>
                      </div>
                    </div>
                  </div>
                  {/* Episodes */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                    {epLoading && (
                      <div className="flex items-center justify-center h-20 text-slate-400 text-[11px] gap-2">
                        <div className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                        Đang tải tập...
                      </div>
                    )}
                    {!epLoading && episodes.length === 0 && (
                      <div className="flex flex-col gap-1 mt-2 px-1">
                        <div className="text-slate-500 text-[10px]">Không có danh sách tập</div>
                        {rawEpInfo && (
                          <details open className="text-[8px]">
                            <summary className="cursor-pointer text-slate-600 mb-0.5">Raw debug</summary>
                            <pre className="p-1 bg-slate-900 rounded text-[7px] text-slate-400 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                              {JSON.stringify(rawEpInfo, null, 1).slice(0, 2000)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                    {episodes.map((ep, i) => (
                      <EpisodeItem key={ep.id || i} ep={ep} onQueue={queueEpisode} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── QUEUE TAB ── */}
        {tab === 'queue' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* URL input */}
            <div className="flex-shrink-0 px-3 pt-2 pb-2 border-b border-slate-700/40 bg-[#060a12] flex gap-2">
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addFromUrl()}
                placeholder="Dán URL video (mp4 / m3u8) trực tiếp..."
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600/60 rounded-lg text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition" />
              <button onClick={addFromUrl} disabled={!urlInput.trim()}
                className="px-3 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 rounded-lg text-[12px] font-black text-white transition">
                ➕
              </button>
              {videos.some(v => v.status === 'idle' || v.status === 'error') && (
                <button
                  onClick={async () => {
                    const CONCUR = 5;
                    const MAX_RETRY = 2;
                    // Rolling pool: xong 1 cái thì pick ngay cái tiếp, luôn giữ CONCUR luồng chạy
                    const runPool = async (list) => {
                      const pool = new Set();
                      for (const v of list) {
                        while (pool.size >= CONCUR) await Promise.race([...pool]);
                        const p = processVideo(v.id).finally(() => pool.delete(p));
                        pool.add(p);
                      }
                      await Promise.all([...pool]);
                    };
                    const pending = videos.filter(v => v.status === 'idle' || v.status === 'error');
                    await runPool(pending);
                    // Auto-retry các tập lỗi (tối đa MAX_RETRY vòng)
                    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
                      const errors = videosRef.current.filter(v => v.status === 'error');
                      if (!errors.length) break;
                      addLog(`🔁 Tự động thử lại ${errors.length} tập lỗi (lần ${attempt + 1})...`);
                      await new Promise(r => setTimeout(r, 3000));
                      await runPool(errors);
                    }
                  }}
                  disabled={processing && videos.filter(v=>v.status==='idle'||v.status==='error').length===0}
                  className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded-lg text-[12px] font-bold text-white transition">
                  ▶ Chạy {videos.filter(v=>v.status==='idle'||v.status==='error').length > 0 && `(${videos.filter(v=>v.status==='idle'||v.status==='error').length})`}
                </button>
              )}
              {videos.filter(v => v.status === 'done' && v.selected).length >= 2 && (
                <button
                  onClick={handleMergeSelected}
                  className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-[12px] font-bold text-white transition">
                  🔗 Ghép {videos.filter(v => v.status === 'done' && v.selected).length} tập
                </button>
              )}
              {/* Xóa hàng loạt */}
              {videos.some(v => v.status === 'done') && (
                <button
                  onClick={() => setVideos(prev => prev.filter(v => v.status !== 'done'))}
                  className="px-2.5 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-[11px] text-slate-300 transition whitespace-nowrap"
                  title="Xóa tất cả tập đã xử lý xong">
                  🗑 Xong
                </button>
              )}
              {videos.some(v => v.status === 'error') && (
                <button
                  onClick={() => setVideos(prev => prev.filter(v => v.status !== 'error'))}
                  className="px-2.5 py-2 bg-slate-700 hover:bg-red-800 rounded-lg text-[11px] text-red-400 transition whitespace-nowrap"
                  title="Xóa tất cả tập bị lỗi">
                  🗑 Lỗi
                </button>
              )}
              {videos.length > 0 && (
                <button
                  onClick={() => { if (window.confirm(`Xóa tất cả ${videos.length} video khỏi hàng chờ?`)) setVideos([]); }}
                  className="px-2.5 py-2 bg-slate-700 hover:bg-red-900 rounded-lg text-[11px] text-red-400 transition whitespace-nowrap"
                  title="Xóa tất cả khỏi hàng chờ">
                  🗑 Tất cả
                </button>
              )}
            </div>

            {/* Queue grid + log */}
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3">
                {videos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                    <div className="text-4xl opacity-30">📋</div>
                    <div className="text-[12px]">Chưa có video trong hàng chờ</div>
                    <div className="text-[10px] text-slate-600">Duyệt phim → chọn tập → nhấn "Tải"</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {videos.map(v => (
                      <QueueCard key={v.id} v={v} onProcess={processVideo} onRemove={removeVideo}
                        onOpenFolder={openOutputFolder} processing={processing} onToggleSelect={toggleSelect} />
                    ))}
                  </div>
                )}
              </div>

              {/* Log */}
              {log.length > 0 && (
                <div className="w-[220px] flex-shrink-0 border-l border-slate-700/60 flex flex-col bg-[#060a12]">
                  <div className="px-2 py-1.5 border-b border-slate-700/40 text-[9px] text-slate-500 uppercase font-bold">Log</div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono">
                    {log.map((l, i) => (
                      <div key={i} className="text-[9px] text-slate-400 leading-relaxed">{l}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── OVERLAY PREVIEW MODAL ── */}
      {ovPreviewOpen && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center"
             onMouseMove={e => {
               if (!ovDragging || !previewRef.current) return;
               const rect = previewRef.current.getBoundingClientRect();
               const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
               const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));
               if (ovDragging === 'logo')    { setOvLogoX(Math.round(x)); setOvLogoY(Math.round(y)); }
               else if (ovDragging === 'channel') { setOvChanX(Math.round(x)); setOvChanY(Math.round(y)); }
               else if (ovDragging === 'sub') setOvSubY(Math.round(y));
             }}
             onMouseUp={() => setOvDragging(null)}
             onClick={e => { if (e.target === e.currentTarget) setOvPreviewOpen(false); }}>
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-5 flex flex-col items-center gap-3 select-none shadow-2xl">
            <div className="w-full flex items-center justify-between">
              <h3 className="text-white font-bold">👁 Đặt vị trí Overlay</h3>
              <button onClick={() => setOvPreviewOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <p className="text-slate-500 text-[11px]">Kéo phần tử để đặt vị trí • Phụ đề chỉ kéo lên/xuống</p>

            {/* 9:16 preview canvas */}
            <div ref={previewRef}
                 className="relative bg-black border-2 border-slate-600 rounded overflow-hidden"
                 style={{ width: 270, height: 480 }}>
              {/* Grid */}
              <div className="absolute inset-0 pointer-events-none"
                   style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.07) 1px,transparent 1px)', backgroundSize: '27px 48px' }} />
              {/* Rule of thirds */}
              <div className="absolute pointer-events-none" style={{ left: '33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)' }} />
              <div className="absolute pointer-events-none" style={{ left: '66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)' }} />
              <div className="absolute pointer-events-none" style={{ top: '33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.12)' }} />
              <div className="absolute pointer-events-none" style={{ top: '66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.12)' }} />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-slate-700 text-[11px]">📽 9:16 Preview</span>
              </div>

              {/* Logo */}
              {ovLogoEnabled && (
                <div className="absolute cursor-grab"
                     style={{ left: `${ovLogoX}%`, top: `${ovLogoY}%`, transform: 'translate(-50%,-50%)', zIndex: 20 }}
                     onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setOvDragging('logo'); }}>
                  <div className="border-2 border-dashed border-yellow-400/80 rounded p-0.5">
                    {ovLogoDataUrl
                      ? <img src={ovLogoDataUrl} draggable={false} alt="logo"
                          style={{ width: `${Math.max(20, Math.round(ovLogoW * 270 / 100))}px`, opacity: ovLogoOpacity / 100, display: 'block' }} />
                      : <div className="bg-yellow-400/20 text-yellow-300 text-[9px] px-3 py-1.5 whitespace-nowrap rounded">🖼 Logo</div>
                    }
                  </div>
                  <div className="text-center text-yellow-300 text-[7px] mt-0.5">Logo ↕↔</div>
                </div>
              )}

              {/* Channel name */}
              {ovChanEnabled && (
                <div className="absolute cursor-grab"
                     style={{ left: `${ovChanX}%`, top: `${ovChanY}%`, transform: 'translate(-50%,-50%)', zIndex: 20 }}
                     onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setOvDragging('channel'); }}>
                  <div className="border border-dashed border-blue-400/80 rounded px-1 py-0.5">
                    <span style={{ fontSize: `${Math.max(7, Math.round(ovChanSize * 480 / 1920))}px`, color: ovChanColor, textShadow: '1px 1px 2px #000', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                      {ovChanText || '📺 Tên kênh'}
                    </span>
                  </div>
                  <div className="text-center text-blue-300 text-[7px] mt-0.5">Kênh ↕↔</div>
                </div>
              )}

              {/* Subtitle */}
              {ovSubEnabled && (
                <div className="absolute left-0 right-0 flex flex-col items-center cursor-ns-resize"
                     style={{ top: `${ovSubY}%`, transform: 'translateY(-50%)', zIndex: 20 }}
                     onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setOvDragging('sub'); }}>
                  <div className="border border-dashed border-green-400/80 rounded px-2 py-0.5"
                       style={{ background: `rgba(0,0,0,${ovSubBgOpacity / 100})` }}>
                    <span style={{ fontSize: `${Math.max(7, Math.round(ovSubSize * 480 / 1920))}px`, color: ovSubColor, textShadow: '1px 1px 1px #000', whiteSpace: 'nowrap' }}>
                      Đây là phụ đề mẫu thử nghiệm
                    </span>
                  </div>
                  <div className="text-center text-green-300 text-[7px] mt-0.5">Phụ đề ↕</div>
                </div>
              )}
            </div>

            <div className="text-slate-500 text-[10px] text-center">
              🟡 Logo ↕↔  &nbsp; 🔵 Kênh ↕↔  &nbsp; 🟢 Phụ đề ↕
            </div>
            <div className="flex gap-3 w-full">
              <div className="flex-1 text-slate-500 text-[10px] space-y-0.5">
                {ovLogoEnabled   && <div>Logo: X={ovLogoX}% Y={ovLogoY}%</div>}
                {ovChanEnabled   && <div>Kênh: X={ovChanX}% Y={ovChanY}%</div>}
                {ovSubEnabled    && <div>Sub: Y={ovSubY}%</div>}
              </div>
              <button onClick={() => setOvPreviewOpen(false)}
                className="px-6 py-1.5 bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-bold rounded transition">
                Lưu & Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
