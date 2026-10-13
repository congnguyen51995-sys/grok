import React, { useState, useRef, useCallback, useEffect } from 'react';
import { loadGroqKeysForWhisper } from '../services/whisperGroq.js';

const api = window.electronAPI;

function extractSeriesId(input) {
  if (!input) return null;
  const m = input.match(/series_id[=\/](\d{15,20})/);
  if (m) return m[1];
  const m2 = input.match(/\/(?:player|detail)\/(\d{15,20})/);
  if (m2) return m2[1];
  if (/^\d{15,20}$/.test(input.trim())) return input.trim();
  return null;
}

// ── Series Card (BOOM STUDIO style) ──────────────────────────────────────────
function SeriesCard({ v, onClick }) {
  const fmtViews = (n) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : n || '';
  const views = v.play_cnt || v.view_count || 0;
  const rating = v.score || v.rating || 0;
  return (
    <div onClick={onClick} className="cursor-pointer group flex flex-col" style={{ minWidth: 0 }}>
      {/* Poster */}
      <div className="relative overflow-hidden rounded-md" style={{ paddingBottom: '133%' }}>
        <img src={v.cover} alt={v.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy" />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {/* Top left: views */}
        {views > 0 && (
          <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-black/60 rounded px-1 py-0.5 text-[9px] text-orange-400 font-bold">
            🔥{fmtViews(views)}
          </div>
        )}
        {/* Top right: rating */}
        {rating > 0 && (
          <div className="absolute top-1 right-1 flex items-center gap-0.5 bg-black/60 rounded px-1 py-0.5 text-[9px] text-yellow-400 font-bold">
            ⭐{(+rating).toFixed(1)}
          </div>
        )}
        {/* Bottom: episode count badge */}
        <div className="absolute bottom-0 inset-x-0 flex justify-end p-1">
          <span className="bg-black/75 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
            {v.episode_right_text || (v.episode_cnt ? `${v.episode_cnt} tập` : '')}
          </span>
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 border-2 border-transparent group-hover:border-red-500 rounded-md transition-colors" />
      </div>
      {/* Below poster: title + tags */}
      <div className="mt-1 px-0.5">
        <p className="text-white text-[11px] font-medium leading-tight line-clamp-2 group-hover:text-red-400 transition-colors">
          {v.title}
        </p>
        {(v.tags?.length > 0 || v.intro) && (
          <p className="text-gray-500 text-[9px] mt-0.5 line-clamp-1">
            {v.tags?.slice(0,2).join(' · ') || v.intro?.slice(0,30)}
          </p>
        )}
      </div>
    </div>
  );
}

// ── MultiSelectCard — click ảnh → chọn tập; click checkbox → multi-select ────
function MultiSelectCard({ v, selected, onToggle, onOpen }) {
  const epCount = v.episode_cnt || 0;
  const freeEps = v.accessible_episode_cnt || 0;
  return (
    <div className="relative group flex flex-col" style={{ minWidth: 0 }}>
      {/* Poster — click → mở trang chọn tập */}
      <div className={`relative overflow-hidden rounded-md cursor-pointer transition-all ${selected ? 'ring-2 ring-red-500' : 'ring-1 ring-transparent hover:ring-red-500/60'}`}
        style={{ paddingBottom: '133%' }}
        onClick={() => onOpen(v.series_id)}>
        <img src={v.cover} alt={v.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {/* Checkbox — click riêng để chọn nhiều */}
        <div
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded flex items-center justify-center text-xs font-bold transition-all cursor-pointer z-10 ${
            selected ? 'bg-red-500 text-white' : 'bg-black/70 text-transparent border border-gray-400 hover:border-white'}`}
          onClick={e => { e.stopPropagation(); onToggle(v.series_id); }}>
          {selected ? '✓' : ''}
        </div>
        {/* Episode count */}
        <div className="absolute bottom-0 inset-x-0 px-1.5 pb-1.5">
          <div className="flex items-end justify-between">
            <span className="text-[9px] text-green-400 font-medium">
              {freeEps > 0 ? `${freeEps} miễn phí` : ''}
            </span>
            <span className="bg-black/80 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">
              {epCount > 0 ? `${epCount} tập` : ''}
            </span>
          </div>
        </div>
        {/* Hover overlay hint */}
        <div className="absolute inset-0 bg-red-900/0 group-hover:bg-red-900/10 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 bg-red-600/90 text-white text-[9px] px-2 py-0.5 rounded-full transition-opacity">▶ Chọn tập</span>
        </div>
      </div>
      {/* Title */}
      <div className="mt-1 px-0.5">
        <p className="text-white text-[10px] font-medium leading-tight line-clamp-2 cursor-pointer hover:text-red-400"
          onClick={() => onOpen(v.series_id)}>{v.title}</p>
        {v.tags?.length > 0 && (
          <p className="text-gray-500 text-[9px] mt-0.5 line-clamp-1">{v.tags.slice(0,2).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}

// Hongguo genre labels
const HG_GENRES = [
  { id: '', label: 'Tất cả' },
  { id: 'romance', label: '❤️ Tình cảm' },
  { id: 'costume', label: '👘 Cổ trang' },
  { id: 'fantasy', label: '✨ Huyền ảo' },
  { id: 'urban', label: '🏙️ Đô thị' },
  { id: 'suspense', label: '🔍 Huyền bí' },
  { id: 'comeback', label: '💪 Ngược chiều' },
  { id: 'family', label: '👨‍👩‍👧 Gia đình' },
  { id: 'comedy', label: '😂 Hài hước' },
  { id: 'period', label: '📅 Niên đại' },
  { id: 'horror', label: '👻 Kinh dị' },
  { id: 'action-adventure', label: '⚔️ Hành động' },
];

const HG_TYPE_TABS = [
  { id: 'featured', label: '⭐ Nổi bật',    hgType: null    },
  { id: 'all',      label: '🎬 Phim ngắn',  hgType: 'all'   },
  { id: 'human',    label: '👤 Người thật', hgType: 'human' },
  { id: 'comic',    label: '🎨 Hoạt hình',  hgType: 'comic' },
  { id: 'ai',       label: '🤖 Phim AI',    hgType: 'ai'    },
  { id: 'browse',   label: '📋 Tất cả',     hgType: null    },
];

// ── Browse mode ───────────────────────────────────────────────────────────────
function BrowseView({ onSelectSeries, onQueueSelected }) {
  const [typeTab,      setTypeTab]     = useState('featured');
  const [homeData,     setHomeData]    = useState(null);
  const [homeLoading,  setHomeLoading] = useState(false);
  const [homeError,    setHomeError]   = useState('');

  // "Tất cả" paginated state
  const [videos,      setVideos]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');
  const [pagination,  setPagination]  = useState(null);
  const [page,        setPage]        = useState(1);
  const [genre,       setGenre]       = useState('');
  const [selected,    setSelected]    = useState(new Set());
  const [searchQ,     setSearchQ]     = useState('');
  const [searchMode,  setSearchMode]  = useState(false);

  const loadHome = useCallback(async () => {
    if (homeData) return;
    setHomeLoading(true); setHomeError('');
    try {
      const res = await api.hongguoGetHome?.();
      if (res?.ok) setHomeData(res);
      else setHomeError(res?.error || 'Không tải được danh sách nổi bật');
    } catch(e) { setHomeError(e.message); }
    finally { setHomeLoading(false); }
  }, [homeData]);

  const loadPage = async (pg, gn, reset = false) => {
    if (pg === 1) { setLoading(true); if (reset) setVideos([]); }
    else setLoadingMore(true);
    setError('');
    try {
      const res = await api.hongguoGetCategory?.({ page: pg, genre: gn });
      if (!res?.ok) { setError(res?.error || 'Lỗi tải'); return; }
      setVideos(prev => pg === 1 ? res.videos : [...prev, ...res.videos]);
      setPagination(res.pagination); setPage(pg);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); setLoadingMore(false); }
  };

  const doSearch = async (q) => {
    setLoading(true); setError(''); setVideos([]); setSearchMode(true);
    try {
      const res = await api.hongguoSearch?.({ keyword: q });
      if (!res?.ok) { setError(res?.error || 'Lỗi tìm'); return; }
      setVideos(res.videos || []);
      setPagination({ pageNum: 1, total: res.totalCount, totalPages: 1 });
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (typeTab === 'browse') { if (!videos.length && !loading) loadPage(1, genre, true); }
    else loadHome();
  }, [typeTab]);
  useEffect(() => { loadHome(); }, []);

  const handleGenre = (g) => { setGenre(g); setSearchMode(false); setSelected(new Set()); loadPage(1, g, true); };
  const toggleSelect = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { if (selected.size === videos.length && videos.length) setSelected(new Set()); else setSelected(new Set(videos.map(v => v.series_id))); };
  const handleQueueSelected = () => onQueueSelected?.(videos.filter(v => selected.has(v.series_id)));

  // Sections for featured/type tabs
  const getSection = (hgType) => homeData?.homeSections?.find(s => s.tab_type === hgType);
  const curTab = HG_TYPE_TABS.find(t => t.id === typeTab);

  const SectionGrid = ({ section, cols = 5 }) => (
    <div className="grid gap-x-2 gap-y-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {(section?.video_list || []).map(v => (
        <SeriesCard key={v.series_id} v={v} onClick={() => onSelectSeries(v.series_id)} />
      ))}
      {!(section?.video_list?.length) && <div className="col-span-5 py-10 text-center text-gray-600 text-sm">Không có dữ liệu</div>}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117]">
      {/* ── Type tab bar + search ── */}
      <div className="flex-shrink-0 flex items-stretch border-b border-gray-800 bg-[#080c12]">
        <div className="flex overflow-x-auto scrollbar-none">
          {HG_TYPE_TABS.map(tab => (
            <button key={tab.id} onClick={() => { setTypeTab(tab.id); setSearchMode(false); setSearchQ(''); }}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-all border-b-2 flex-shrink-0 ${
                typeTab === tab.id ? 'border-red-500 text-white bg-red-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
        {/* Inline search */}
        <form className="flex items-center gap-1 flex-1 px-2 py-1.5"
          onSubmit={e => { e.preventDefault(); const q = searchQ.trim(); if (q) { setTypeTab('browse'); doSearch(q); } else { setSearchMode(false); if (typeTab === 'browse') loadPage(1, genre, true); } }}>
          <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="🔍 Tìm tên phim..."
            className="flex-1 min-w-0 bg-gray-800/80 border border-gray-700 text-white text-[11px] rounded px-2 py-1 placeholder-gray-600 focus:border-red-500 focus:outline-none" />
          <button type="submit" className="px-2.5 py-1 bg-red-700 hover:bg-red-600 text-white text-[11px] rounded flex-shrink-0">Tìm</button>
          {searchMode && <button type="button" onClick={() => { setSearchQ(''); setSearchMode(false); loadPage(1, genre, true); }} className="text-gray-400 hover:text-white text-xs">✕</button>}
        </form>
      </div>

      {/* ── FEATURED TAB: tất cả 4 sections ── */}
      {typeTab === 'featured' && (
        <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {homeLoading && <div className="flex h-40 items-center justify-center gap-2 text-gray-500"><div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /><span className="text-sm">Đang tải...</span></div>}
          {homeError && <div className="flex flex-col items-center py-12 gap-3 text-red-400"><p className="text-sm">❌ {homeError}</p><button onClick={() => { setHomeData(null); loadHome(); }} className="px-4 py-2 bg-red-700 rounded text-sm">Thử lại</button></div>}
          {!homeLoading && !homeError && HG_TYPE_TABS.filter(t => t.hgType).map(tab => {
            const sec = getSection(tab.hgType);
            if (!sec) return null;
            return (
              <div key={tab.id} className="mb-6 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-white">{tab.label}</span>
                  <button onClick={() => setTypeTab(tab.id)} className="text-[11px] text-red-400 hover:text-red-300">Xem thêm →</button>
                </div>
                <SectionGrid section={sec} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── TYPE TABS: human / comic / ai / all ── */}
      {typeTab !== 'featured' && typeTab !== 'browse' && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {homeLoading && <div className="flex h-40 items-center justify-center gap-2 text-gray-500"><div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /><span className="text-sm">Đang tải...</span></div>}
          {homeError && <div className="flex flex-col items-center py-12 gap-3 text-red-400"><p className="text-sm">❌ {homeError}</p><button onClick={() => { setHomeData(null); loadHome(); }} className="px-4 py-2 bg-red-700 rounded text-sm">Thử lại</button></div>}
          {!homeLoading && !homeError && <SectionGrid section={curTab?.hgType ? getSection(curTab.hgType) : null} />}
          {!homeLoading && !homeError && (
            <div className="mt-6 pt-4 border-t border-gray-800 text-center">
              <button onClick={() => setTypeTab('browse')} className="px-5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded border border-gray-700">
                📋 Duyệt tất cả 800+ phim theo thể loại →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TẤT CẢ TAB: paginated category ── */}
      {typeTab === 'browse' && (
        <>
          {/* Genre chips + status */}
          <div className="flex-shrink-0 border-b border-gray-800">
            {!searchMode && (
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none px-3 py-1.5">
                {HG_GENRES.map(g => (
                  <button key={g.id} onClick={() => handleGenre(g.id)}
                    className={`px-2.5 py-0.5 rounded-full text-[10px] whitespace-nowrap transition-all flex-shrink-0 ${
                      genre === g.id ? 'bg-red-600 text-white font-bold' : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}>{g.label}</button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1">
              <span className="text-[10px] text-gray-500">
                {searchMode ? `🔍 ${videos.length} kết quả` : `📋 ${pagination?.total || '...'} phim · Trang ${page}/${pagination?.totalPages || '?'}`}
              </span>
              <button onClick={toggleAll} className="text-[10px] text-gray-400 hover:text-white px-2 py-0.5 bg-gray-800 rounded">
                {selected.size === videos.length && videos.length > 0 ? '✕ Bỏ chọn' : '☑ Chọn tất cả trang'}
              </button>
              {selected.size > 0 && (
                <button onClick={handleQueueSelected} className="ml-auto px-3 py-0.5 bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold rounded">
                  ▶ Xử lý {selected.size} phim
                </button>
              )}
            </div>
          </div>
          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-gray-500">
                <div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin mr-3" />
                <span className="text-sm">Đang tải danh sách phim...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-400">
                <p className="text-sm">❌ {error}</p>
                <button onClick={() => loadPage(1, genre, true)} className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm">Thử lại</button>
              </div>
            ) : (
              <>
                <div className="grid gap-x-2 gap-y-4 pt-2" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                  {videos.map(v => (
                    <MultiSelectCard key={v.series_id} v={v}
                      selected={selected.has(v.series_id)}
                      onToggle={toggleSelect}
                      onOpen={onSelectSeries} />
                  ))}
                  {videos.length === 0 && <div className="col-span-5 py-20 text-center text-gray-600 text-sm">Không tìm thấy phim nào</div>}
                </div>
                {!searchMode && pagination && page < pagination.totalPages && (
                  <div className="flex justify-center mt-4 gap-2">
                    <button onClick={() => loadPage(page + 1, genre)} disabled={loadingMore}
                      className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded border border-gray-700 disabled:opacity-50">
                      {loadingMore ? '⏳ Đang tải...' : `Tải thêm (trang ${page+1}/${pagination.totalPages})`}
                    </button>
                    <span className="flex items-center text-[10px] text-gray-600">{videos.length}/{pagination.total} phim đã tải</span>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const KOKORO_VI_VOICES = [
  { id: 'vi_co_gai_hoat_ngon',  name: 'Cô Gái Hoạt Ngôn' },
  { id: 'vi_gai_nho_ngot',      name: 'Nhỏ Ngọt Ngào' },
  { id: 'vi_nu_pho_thong',      name: 'Giọng Nữ Phổ Thông' },
  { id: 'vi_thanh_nien_tu_tin', name: 'Thanh Niên Tự Tin' },
  { id: 'vi_mai',               name: 'Mai' },
  { id: 'vi_minh',              name: 'Minh' },
];
const GEMINI_TTS_VOICES = ['Charon','Kore','Puck','Aoede','Fenrir','Leda','Orus','Zephyr'];
const CAPCUT_VI_VOICES = [
  { label: 'Cô Gái Hoạt Ngôn',   voice: 'BV074_streaming',                        resourceId: '7102355709945188865' },
  { label: 'Nhỏ Ngọt Ngào',       voice: 'BV421_vivn_streaming',                   resourceId: '7252594014782755330' },
  { label: 'Giọng Nữ Phổ Thông',  voice: 'vi_female_huong',                        resourceId: '7264854897953083905' },
  { label: 'Mai',                  voice: 'BV562_streaming',                        resourceId: '7483736254694035984' },
  { label: 'Ban Mai',              voice: 'multi_female_yangguangnv_uranus_bigtts',  resourceId: '7637456432522218773' },
  { label: 'Review Phim',         voice: 'multi_female_richgirl_uranus_bigtts',    resourceId: '7637460351541447956' },
  { label: 'Sunny Idol',          voice: 'multi_female_kiwi_uranus_bigtts',        resourceId: '7637457995882089749' },
  { label: 'Thanh Niên Tự Tin',   voice: 'BV075_streaming',                        resourceId: '7102355803792740865' },
  { label: 'Giọng Nam Trầm',      voice: 'multi_male_felipe_uranus_bigtts',        resourceId: '7637456729696996628' },
  { label: 'Hoai My',             voice: 'vi-VN-HoaiMyNeural',                     resourceId: '7371666434650280464' },
];
const loadVieNeuSavedVoices = () => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]'); } catch { return []; } };

const loadGeminiKeys = () => { try { return JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]'); } catch { return []; } };

function normSub(t) { return (t || '').toLowerCase().replace(/[.!?…,;:"""''()[\]]/g, '').replace(/\s+/g, ' ').trim(); }
function dedupeText(text) {
  if (!text) return text;
  const t = text.trim();
  const words = t.split(/\s+/);
  if (words.length >= 6) {
    const half = Math.floor(words.length / 2);
    if (words.slice(0, half).join(' ') === words.slice(half).join(' ')) return words.slice(0, half).join(' ');
  }
  const sentSplit = t.split(/(?<=[.!?…])\s+/);
  if (sentSplit.length >= 2) {
    const half = Math.ceil(sentSplit.length / 2);
    const first = sentSplit.slice(0, half).join(' ');
    const second = sentSplit.slice(half).join(' ');
    if (second && normSub(first) === normSub(second)) return first;
  }
  return t;
}
function validateSubtitles(segs) {
  if (!segs?.length) return segs;
  const result = [];
  for (const seg of segs) {
    const cleaned = dedupeText(seg.text);
    if (!cleaned?.trim()) continue;
    const prev = result[result.length - 1];
    if (prev && normSub(prev.text) === normSub(cleaned)) {
      result[result.length - 1] = { ...prev, end: Math.max(prev.end, seg.end) };
      continue;
    }
    result.push({ ...seg, text: cleaned });
  }
  return result;
}

const DEFAULT_REUP_CFG = {
  enabled: false,
  hFlip: false, colorShift: true, stereoFlip: false, randomCut: true,
  slightRotate: false, randomPosCrop: false, varSpeed: false, grainNoise: false,
  bgNoise: false, randomFps: false, hueRotate: false, audioEQ: false,
  pitchShift: 1, zoomPct: 5, audioVolume: 100, bgNoiseLevel: 3,
  trimStart: 0, trimEnd: 0, gpuMode: 'auto',
};

// ── Reup settings modal ───────────────────────────────────────────────────────
function ReupCfgModal({ cfg, onChange, onClose }) {
  const EFFECTS = [
    ['hFlip','Lật ngang'],['colorShift','Đổi màu sắc'],['stereoFlip','Lật stereo'],
    ['randomCut','Cắt ngẫu nhiên'],['slightRotate','Xoay nhẹ'],['randomPosCrop','Crop vị trí'],
    ['varSpeed','Thay tốc độ'],['grainNoise','Hạt nhiễu'],['bgNoise','Tiếng nền'],
    ['randomFps','FPS ngẫu nhiên'],['hueRotate','Hue rotate'],['audioEQ','Equalizer'],
  ];
  const toggle = k => onChange({ ...cfg, [k]: !cfg[k] });
  const set    = (k, v) => onChange({ ...cfg, [k]: v });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#161b22] border border-gray-700 rounded-lg w-[480px] max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">⚙️ Cài đặt Reup</span>
            <span className="text-[10px] text-gray-500">— tái tạo video tránh ContentID</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>
        <div className="p-4 space-y-4 text-xs">
          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <button onClick={() => toggle('enabled')}
              className={`w-10 h-5 rounded-full relative transition-all ${cfg.enabled ? 'bg-green-600' : 'bg-gray-600'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${cfg.enabled ? 'left-5' : 'left-0.5'}`}/>
            </button>
            <span className={cfg.enabled ? 'text-green-400 font-bold' : 'text-gray-400'}>
              Áp dụng hiệu ứng tái tạo sau khi xử lý
            </span>
          </label>
          {/* Effects grid */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2 font-bold">HIỆU ỨNG TÁI TẠO VIDEO</div>
            <div className="grid grid-cols-3 gap-1.5">
              {EFFECTS.map(([k, label]) => (
                <button key={k} onClick={() => toggle(k)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-[10px] font-medium transition-all ${cfg[k]
                    ? 'bg-pink-900/60 border-pink-600/60 text-pink-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg[k] ? 'bg-pink-400' : 'bg-gray-600'}`}/>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Sliders */}
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1"><span className="text-gray-400">🎵 Pitch shift</span><span className="text-white">{cfg.pitchShift > 0 ? '+':''}{cfg.pitchShift} st</span></div>
              <input type="range" min={-3} max={3} step={1} value={cfg.pitchShift} onChange={e => set('pitchShift', +e.target.value)} className="w-full accent-pink-500"/>
            </div>
            <div>
              <div className="flex justify-between mb-1"><span className="text-gray-400">🔍 Zoom</span><span className="text-white">{cfg.zoomPct}%</span></div>
              <input type="range" min={0} max={15} step={1} value={cfg.zoomPct} onChange={e => set('zoomPct', +e.target.value)} className="w-full accent-pink-500"/>
            </div>
            <div>
              <div className="flex justify-between mb-1"><span className="text-gray-400">🔊 Âm lượng video</span><span className="text-white">{cfg.audioVolume}%</span></div>
              <input type="range" min={0} max={150} step={5} value={cfg.audioVolume} onChange={e => set('audioVolume', +e.target.value)} className="w-full accent-pink-500"/>
            </div>
          </div>
          {/* Trim */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-gray-400 mb-1">✂️ Cắt đầu (giây)</div>
              <input type="number" value={cfg.trimStart} min={0} onChange={e => set('trimStart', +e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded px-2 py-1 text-[11px]"/>
            </div>
            <div>
              <div className="text-gray-400 mb-1">✂️ Cắt đuôi (giây)</div>
              <input type="number" value={cfg.trimEnd} min={0} onChange={e => set('trimEnd', +e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded px-2 py-1 text-[11px]"/>
            </div>
          </div>
          {/* GPU */}
          <div className="flex items-center gap-2">
            <span className="text-gray-400">GPU:</span>
            {['auto','cuda','cpu'].map(v => (
              <button key={v} onClick={() => set('gpuMode', v)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${cfg.gpuMode === v ? 'bg-pink-700 text-white' : 'bg-gray-800 text-gray-400'}`}>{v}</button>
            ))}
          </div>
        </div>
        <div className="px-4 pb-4">
          <button onClick={onClose} className="w-full py-2 bg-pink-700 hover:bg-pink-600 text-white rounded font-bold text-sm">✅ Lưu cài đặt</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail mode — Episode list + Reup pipeline ────────────────────────────────
function DetailView({ seriesId, onBack }) {
  const [seriesInfo, setSeriesInfo] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [epStatus, setEpStatus]     = useState({}); // { epNum: {status, msg, percent, path, steps} }
  const [selectedEps, setSelectedEps] = useState(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const batchCancelRef = useRef(false);
  const [showAll, setShowAll]       = useState(false);
  const downloadOnlyRef = useRef(false);

  // Reup options
  const [doTranslate, setDoTranslate] = useState(true);
  const [doDub,       setDoDub]       = useState(true);
  const [ttsEngine,   setTtsEngine]   = useState('vieneu');
  const [ttsVoice,    setTtsVoice]    = useState('');
  const [origVol,     setOrigVol]     = useState(15);
  const [muteOrig,    setMuteOrig]    = useState(false);
  const [vnSavedVoices, setVnSavedVoices] = useState(() => loadVieNeuSavedVoices());
  const [vnBuiltinVoices, setVnBuiltinVoices] = useState([]);
  const [showReupCfg, setShowReupCfg] = useState(false);
  const [saveDir, setSaveDir] = useState('');
  const [reupCfg, setReupCfg] = useState(() => { try { return { ...DEFAULT_REUP_CFG, ...JSON.parse(localStorage.getItem('hongguo_reup_cfg') || '{}') }; } catch { return DEFAULT_REUP_CFG; } });
  const [showReupModal, setShowReupModal] = useState(false);
  const [capcutVoice, setCapcutVoice] = useState(CAPCUT_VI_VOICES[0].voice);
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [charContextSaved, setCharContextSaved] = useState('');
  const [ovSubEnabled, setOvSubEnabled] = useState(false);
  const keyIdxRef    = useRef(0);
  const gemKeyIdxRef = useRef(0);

  useEffect(() => {
    api.getDownloadsDir?.().then(d => { if (d) setSaveDir(d + '\\Hongguo'); });
  }, []);

  useEffect(() => {
    if (ttsEngine !== 'vieneu') return;
    api.vieNeuGetVoices?.().then(r => {
      if (r?.success && r.voices?.length) setVnBuiltinVoices(r.voices);
    }).catch(() => {});
  }, [ttsEngine]);

  useEffect(() => {
    setLoading(true); setError('');
    api.hongguoGetSeriesInfo(seriesId).then(res => {
      setLoading(false);
      if (res.ok) setSeriesInfo(res);
      else setError(res.error || 'Lỗi tải thông tin');
    });
  }, [seriesId]);

  useEffect(() => {
    const off = api.onHongguoProgress?.((d) => {
      setEpStatus(prev => ({ ...prev, [d.epNum]: { ...prev[d.epNum], msg: d.msg, percent: d.percent || 0, path: d.path, status: d.status } }));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  const setStep = (epNum, status, msg, extra = {}) =>
    setEpStatus(prev => ({ ...prev, [epNum]: { ...prev[epNum], status, msg, ...extra } }));

  // ── Full pipeline for 1 episode (FreeReels-compatible) ──────────────────
  const processEpisode = useCallback(async (epNum, vidId) => {
    const dlDir   = saveDir || (await api.getDownloadsDir?.() || '') + '\\Hongguo';
    const safeTitle2 = (seriesInfo?.name || 'hongguo').replace(/[\\/:*?"<>|]/g, '_');
    const epStr   = String(epNum).padStart(3, '0');
    const base    = `${dlDir}\\${safeTitle2}\\Tap_${epStr}`;
    const mp4     = `${base}.mp4`;
    const outDir  = `${dlDir}\\${safeTitle2}`;
    const baseName = `Tap_${epStr}`;

    let _srtOrigPath = null;
    let _srtViPath   = null;

    // ① Download
    setStep(epNum, 'downloading', 'Đang tải...', { percent: 0 });
    const dlRes = await api.hongguoDownloadEpisode({ seriesId, vidId, outPath: mp4, epNum });
    if (!dlRes?.ok) { setStep(epNum, 'error', `Lỗi tải: ${dlRes?.error || '?'}`); return; }

    if (!doTranslate || downloadOnlyRef.current) { setStep(epNum, 'done', 'Tải xong ✓', { path: mp4 }); return; }

    // ①.5 — Recreate TRƯỚC transcribe (nếu randomCut=true → Whisper đọc timeline đã cắt)
    let videoToTranscribe = mp4;
    let videoForMix       = mp4;
    if (reupCfg.enabled && reupCfg.randomCut) {
      setStep(epNum, 'mixing', 'Tái tạo (lách content ID)...');
      const rcEarlyRes = await api.videoRecreate?.({
        videoPath: mp4, outputFolder: outDir,
        outputFileName: baseName + '_reup.mp4',
        zoom: reupCfg.zoomPct, randomCut: true,
        hFlip: reupCfg.hFlip, colorShift: reupCfg.colorShift,
        stereoFlip: reupCfg.stereoFlip, slightRotate: reupCfg.slightRotate,
        randomPosCrop: reupCfg.randomPosCrop, varSpeed: reupCfg.varSpeed,
        grainNoise: reupCfg.grainNoise, bgNoise: reupCfg.bgNoise,
        randomFps: reupCfg.randomFps, hueRotate: reupCfg.hueRotate,
        audioEQ: reupCfg.audioEQ, pitchShift: reupCfg.pitchShift,
        audioVolume: reupCfg.audioVolume, gpuMode: reupCfg.gpuMode,
        trimStart: reupCfg.trimStart, trimEnd: reupCfg.trimEnd,
      }).catch(() => null);
      if (rcEarlyRes?.ok) {
        videoToTranscribe = rcEarlyRes.path || (outDir + '\\' + baseName + '_reup.mp4');
        videoForMix = videoToTranscribe;
      }
    }

    // ② Transcribe (local Whisper ưu tiên → fallback Groq chunked)
    setStep(epNum, 'transcribing', 'Nhận dạng audio...');
    const durRes  = await api.getVideoDuration?.({ path: videoToTranscribe }).catch(() => null);
    const totalDur = durRes?.duration || 0;
    let segments = [];
    let localWhisperOk = false;

    const wRes = await api.whisperLocalTranscribe?.({
      filePath: videoToTranscribe, language: 'zh', modelSize: 'small',
    }).catch(e => ({ ok: false, error: e.message }));

    if (wRes?.ok && wRes.segments?.length) {
      segments = wRes.segments;
      localWhisperOk = true;
    } else {
      const groqKeys = loadGroqKeysForWhisper();
      if (!groqKeys.length) { setStep(epNum, 'error', 'Local Whisper lỗi & chưa có Groq key'); return; }
      let keyIdx = keyIdxRef.current;
      const CHUNK = 30;
      const loopMax = totalDur > 0 ? totalDur : 300;
      for (let startSec = 0; startSec < loopMax; startSec += CHUNK) {
        const durSec = Math.min(CHUNK, loopMax - startSec);
        if (durSec < 1) break;
        let chunkRes = null;
        for (let attempt = 0; attempt < groqKeys.length; attempt++) {
          const apiKey = groqKeys[(keyIdx + attempt) % groqKeys.length];
          chunkRes = await api.groqWhisperChunk?.({ filePath: videoToTranscribe, startSec, durationSec: durSec, apiKey, language: 'zh' }).catch(() => null);
          if (chunkRes?.ok) { keyIdx = (keyIdx + attempt) % groqKeys.length; break; }
          if (chunkRes?.status === 429) continue;
          break;
        }
        if (chunkRes?.segments) segments.push(...chunkRes.segments);
        setStep(epNum, 'transcribing', `Groq ${Math.round(startSec + CHUNK)}/${Math.round(loopMax)}s...`);
      }
      keyIdxRef.current = keyIdx;
      if (!segments.length) { setStep(epNum, 'error', 'Nhận dạng thất bại'); return; }
    }

    // ③ Translate zh→vi (Gemini — upload video + phân tích nhân vật)
    setStep(epNum, 'translating', 'Upload video cho Gemini...');
    const geminiKeys = loadGeminiKeys();
    if (!geminiKeys.length) { setStep(epNum, 'error', 'Chưa có Gemini API key'); return; }

    let gKeyIdx = gemKeyIdxRef.current;
    const callGemini = async (prompt, maxTokens = 2048) => {
      for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
        const gKey = geminiKeys[(gKeyIdx + attempt) % geminiKeys.length];
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${gKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens } }),
          });
          const j = await r.json();
          const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (txt) { gKeyIdx = (gKeyIdx + attempt) % geminiKeys.length; return txt; }
        } catch {}
      }
      return null;
    };

    const callGeminiWithVideo = async (fileUri, mimeType, prompt, maxTokens = 16384) => {
      for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
        const gKey = geminiKeys[(gKeyIdx + attempt) % geminiKeys.length];
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${gKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ file_data: { mime_type: mimeType, file_uri: fileUri } }, { text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
            }),
          });
          const j = await r.json();
          const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (txt) { gKeyIdx = (gKeyIdx + attempt) % geminiKeys.length; return txt; }
        } catch {}
      }
      return null;
    };

    const uploadRes = await api.geminiUploadVideoForTranslation?.({ filePath: mp4, apiKeys: geminiKeys }).catch(e => ({ ok: false, error: e.message }));

    let viSegments = [];
    let charContext = charContextSaved.trim() || null;
    const _gemTimestamps = new Map();
    let _savedGemT0 = NaN;

    if (uploadRes?.ok) {
      const fullScript = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
      const hasContext = !!charContextSaved.trim();
      // Luôn yêu cầu phân tích nhân vật — pass context cũ làm base, Gemini bổ sung nhân vật MỚI
      const charSection = hasContext
        ? `\n=== QUY TẮC XƯNG HÔ ĐÃ TÍCH LŨY ===\n${charContextSaved}\n=== HẾT QUY TẮC ===\n\nNếu tập này có NHÂN VẬT MỚI chưa có trong quy tắc trên, hãy bổ sung vào phần NHÂN VẬT. Giữ nguyên nhân vật cũ.`
        : `\nXem video, phân tích nhân vật và điền phần NHÂN VẬT bên dưới.`;

      const videoPrompt = `Bạn là chuyên gia dịch phim ngắn Trung Quốc sang tiếng Việt.
Hãy XEM video (hình ảnh + âm thanh) để biết nhân vật nào đang nói câu nào, rồi thực hiện 3 nhiệm vụ.
${charSection}

TOÀN BỘ THOẠI GỐC (${segments.length} dòng):
${fullScript}

=== NHIỆM VỤ 1: NHÂN VẬT (giữ cũ + bổ sung mới) ===
THỂ LOẠI: ...
NHÂN VẬT:
- [Tên]: [giới tính] | [vai vế]
BẢNG XƯNG HÔ:
- [A] → [B]: xưng "[từ]", gọi "[từ]"

=== NHIỆM VỤ 2: MỐC THỜI GIAN ===
Mỗi câu bắt đầu tại giây thứ mấy? Định dạng: "N → giây"
Cố gắng đủ ${segments.length} dòng. Nếu không chắc, bỏ qua (không đoán mò).

=== NHIỆM VỤ 3: DỊCH ${segments.length} DÒNG ===
QUY TẮC XƯNG HÔ: Chồng→Vợ: xưng"anh"gọi"em" | Vợ→Chồng: xưng"em"gọi"anh" | Anh→Em: xưng"anh"gọi"em" | Chị→Em: xưng"chị"gọi"em" | Em→Anh/Chị: xưng"em"gọi"anh/chị" | Bố/Mẹ→Con: xưng"bố/mẹ"gọi"con" | Con→Bố/Mẹ: xưng"con"gọi"bố/mẹ" | Sếp(trang trọng): xưng"tôi" | Bạn thân: xưng"tao"gọi"mày" | Cổ trang - Vua: xưng"trẫm/ta"gọi"khanh"
CẤM: KHÔNG gọi NỮ là"anh" | KHÔNG gọi NAM là"cô/bà/chị" | KHÔNG để chồng xưng"em"với vợ
NGHIÊM CẤM đổi xưng hô. Không bỏ sót dòng.

Trả về ĐÚNG FORMAT (không thêm markdown):
=== NHÂN VẬT ===
[phân tích nhân vật — đầy đủ cả cũ lẫn mới]
=== HẾT NHÂN VẬT ===

=== THỜI GIAN BẮT ĐẦU ===
1 → [giây]
...${segments.length} → [giây]
=== HẾT THỜI GIAN ===

=== BẢN DỊCH ===
1. [dịch dòng 1]
...${segments.length}. [dịch dòng ${segments.length}]
=== HẾT DỊCH ===`;

      const videoResp = await callGeminiWithVideo(uploadRes.uri, uploadRes.mimeType, videoPrompt, 16384);
      if (videoResp) {
        const charMatch = videoResp.match(/=== NHÂN VẬT ===([\s\S]*?)=== HẾT NHÂN VẬT ===/);
        // Luôn cập nhật context (merge cũ + mới từ tập này)
        if (charMatch) { charContext = charMatch[1].trim(); setCharContextSaved(charContext); }
        const transMatch = videoResp.match(/=== BẢN DỊCH ===([\s\S]*?)=== HẾT DỊCH ===/);
        const transText  = transMatch?.[1] || videoResp;
        const lineMap    = new Map();
        for (const line of transText.trim().split('\n')) {
          const m = line.match(/^(\d+)[.)]\s*(.+)/);
          if (m) lineMap.set(parseInt(m[1]) - 1, m[2].trim());
        }
        if (lineMap.size >= Math.ceil(segments.length * 0.7)) {
          viSegments = segments.map((s, i) => ({ ...s, text: lineMap.has(i) ? lineMap.get(i) : s.text }));
        }
        const parseGemTime = (s) => {
          const clean = s.replace(',', '.').trim();
          const parts = clean.split(':');
          if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
          if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
          return parseFloat(clean);
        };
        const timeMatch = videoResp.match(/=== THỜI GIAN BẮT ĐẦU ===([\s\S]*?)=== HẾT THỜI GIAN ===/);
        if (timeMatch) {
          for (const line of timeMatch[1].split('\n')) {
            const m = line.match(/^(\d+)\s*(?:→|[.\-:)>])\s*([\d:.]+)/);
            if (m) { const idx = parseInt(m[1]) - 1; const t = parseGemTime(m[2]); if (!isNaN(t) && t >= 0) _gemTimestamps.set(idx, t); }
          }
          if (_gemTimestamps.size > 0) _savedGemT0 = _gemTimestamps.get(0) ?? NaN;
        }
      }
    }

    // Fallback dịch batch text-only nếu video thất bại hoặc thiếu dòng
    if (viSegments.length < segments.length * 0.7) {
      // Luôn phân tích nhân vật tập này để merge với context cũ
      {
        const fullScript2 = segments.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
        const baseCtx = charContext ? `\n\nQUY TẮC CŨ:\n${charContext}\nBổ sung nhân vật mới nếu có.` : '';
        const analyzePrompt = `Đọc kịch bản phim ngắn Trung Quốc, tạo quy tắc xưng hô tiếng Việt (giữ nhân vật cũ, thêm mới nếu có).${baseCtx}\nKỊCH BẢN:\n${fullScript2}\n\nTrả về:\nTHỂ LOẠI: ...\nNHÂN VẬT:\n- [Tên]: [giới tính] | [vai vế]\nBẢNG XƯNG HÔ:\n- [A] → [B]: xưng "[từ]", gọi "[từ]"`;
        const analyzed = await callGemini(analyzePrompt, 1024);
        if (analyzed) { charContext = analyzed; setCharContextSaved(analyzed); }
        if (!charContext) charContext = 'Dịch tự nhiên, nhất quán xưng hô.';
      }
      viSegments = [];
      const BATCH = 60;
      for (let bi = 0; bi < segments.length; bi += BATCH) {
        const batch    = segments.slice(bi, bi + BATCH);
        const numbered = batch.map((s, i) => `${bi + i + 1}. ${s.text}`).join('\n');
        const batchPrompt = `Dịch phim Trung sang tiếng Việt.\nQUY TẮC NHÂN VẬT:\n${charContext}\nXưng hô: Chồng→Vợ:anh/em | Vợ→Chồng:em/anh | Cha mẹ→Con:bố/mẹ/con | Con→Cha mẹ:con/bố/mẹ | CẤM: NỮ không gọi là"anh" | NAM không gọi là"cô/bà"\nChỉ trả danh sách, giữ số thứ tự:\n${numbered}`;
        const batchVi  = await callGemini(batchPrompt, 8192);
        if (!batchVi) { setStep(epNum, 'error', 'Dịch thất bại'); return; }
        const lmap = new Map();
        for (const line of batchVi.trim().split('\n')) {
          const m = line.match(/^(\d+)[.)]\s*(.+)/);
          if (m) lmap.set(parseInt(m[1]) - 1, m[2].trim());
        }
        viSegments = [...viSegments, ...batch.map((s, i) => ({ ...s, text: lmap.has(bi + i) ? lmap.get(bi + i) : s.text }))];
        setStep(epNum, 'translating', `Dịch ${bi + batch.length}/${segments.length}...`);
      }
    }
    gemKeyIdxRef.current = gKeyIdx;

    // Chỉnh timing (chỉ khi Groq fallback, không phải local Whisper)
    if (!localWhisperOk && viSegments.length > 0 && (_gemTimestamps.size > 0 || !isNaN(_savedGemT0))) {
      if (_gemTimestamps.size >= Math.ceil(viSegments.length * 0.5)) {
        viSegments = viSegments.map((s, i) => {
          const gemT = _gemTimestamps.get(i);
          if (gemT !== undefined) {
            const dur = Math.max(0.1, (s.end ?? 0) - (s.start ?? 0));
            return { ...s, start: gemT, end: gemT + dur, speechStart: gemT };
          }
          return s;
        });
      } else if (!isNaN(_savedGemT0)) {
        const groqT0 = viSegments[0].speechStart ?? viSegments[0].start ?? 0;
        const shift  = (_savedGemT0 || 0) - groqT0;
        if (shift > 0.1) {
          viSegments = viSegments.map(s => ({
            ...s,
            start:       Math.max(0, (s.start ?? 0) + shift),
            end:         Math.max(0, (s.end   ?? 0) + shift),
            speechStart: Math.max(0, (s.speechStart ?? s.start ?? 0) + shift),
          }));
        }
      }
    }

    // Clean subtitles
    viSegments = validateSubtitles(viSegments);
    viSegments = viSegments.filter((s, i) => i === 0 || s.text.trim() !== viSegments[i - 1].text.trim());

    // ③.5 — Lưu SRT gốc + SRT tiếng Việt
    const toSrt = (segs) => segs.map((s, idx2) => {
      const fmt = (sec) => {
        const ms = Math.round((sec % 1) * 1000);
        const ss = Math.floor(sec) % 60;
        const mm = Math.floor(sec / 60) % 60;
        const hh = Math.floor(sec / 3600);
        return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
      };
      return `${idx2+1}\n${fmt(s.speechStart ?? s.start)} --> ${fmt(s.end)}\n${s.text}\n`;
    }).join('\n');
    const srtOrigPath = `${base}_orig.srt`;
    const srtViPath   = `${base}_vi.srt`;
    _srtOrigPath = srtOrigPath; _srtViPath = srtViPath;
    await api.writeTextFile?.({ path: srtOrigPath, content: toSrt(segments) }).catch(() => {});
    await api.writeTextFile?.({ path: srtViPath,   content: toSrt(viSegments) }).catch(() => {});

    if (!doDub) {
      setStep(epNum, 'done', `Dịch xong (${viSegments.length} câu) ✓`, { path: mp4, srtPath: srtViPath });
      return;
    }

    // ④ TTS
    setStep(epNum, 'dubbing', `Lồng tiếng (${ttsEngine})...`);
    const ttsPath = `${base}_tts.wav`;
    const segsMs  = viSegments.map(s => ({
      ...s,
      startMs:      Math.round((s.start ?? 0) * 1000),
      endMs:        Math.round((s.end   ?? 0) * 1000),
      speechStartMs: Math.round((s.speechStart ?? s.start ?? 0) * 1000),
    }));
    const viText = viSegments.map(s => s.text).join(' ');
    let ttsOk = false;
    try {
      if (ttsEngine === 'vieneu') {
        let r = await api.vieNeuSynthesizeSRT?.({ segments: segsMs, outputPath: ttsPath, voiceId: ttsVoice || '' }).catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success || r?.ok);
        if (!ttsOk) {
          r = await api.vieNeuSynthesize?.({ text: viText, voiceId: ttsVoice || '', outputPath: ttsPath }).catch(() => ({ success: false }));
          ttsOk = !!(r?.success || r?.ok);
        }
      } else if (ttsEngine === 'capcut') {
        const ccVoice = CAPCUT_VI_VOICES.find(v => v.voice === capcutVoice) || CAPCUT_VI_VOICES[0];
        const r = await api.capcutTTSSRT?.({ segments: segsMs, voice: ccVoice.voice, resourceId: ccVoice.resourceId, outputPath: ttsPath }).catch(e => ({ success: false, error: e.message }));
        ttsOk = !!(r?.success);
        if (!ttsOk) {
          const fallback = await api.kokoroSynthesize?.({ text: viText, outputPath: ttsPath }).catch(() => ({ success: false }));
          ttsOk = !!(fallback?.success || fallback?.ok);
        }
      } else if (ttsEngine === 'kokoro') {
        const r = await api.kokoroSynthesize?.({ text: viText, outputPath: ttsPath, voiceId: ttsVoice }).catch(() => ({ success: false }));
        ttsOk = !!(r?.success || r?.ok);
      } else if (ttsEngine === 'gemini') {
        const r = await api.geminiTTS?.({ text: viText, outputPath: ttsPath, voiceName: ttsVoice || 'Charon' }).catch(() => ({ success: false }));
        ttsOk = !!(r?.success || r?.ok);
        if (!ttsOk) {
          const fallback = await api.kokoroSynthesize?.({ text: viText, outputPath: ttsPath }).catch(() => ({ success: false }));
          ttsOk = !!(fallback?.success || fallback?.ok);
        }
      }
    } catch (e) { setStep(epNum, 'error', 'Lỗi TTS: ' + e.message); return; }
    if (!ttsOk) { setStep(epNum, 'error', 'TTS thất bại'); return; }

    // ⑤ Mix — dùng videoForMix (đã recreate nếu randomCut)
    setStep(epNum, 'mixing', 'Ghép âm thanh...');
    const mixedPath = `${base}_dubbed.mp4`;
    const mixRes = await api.mixAudio?.({
      videoPath: videoForMix, audioPath: ttsPath, outputPath: mixedPath,
      videoVol: muteOrig ? 0 : origVol / 100, audioVol: 1.0,
    }).catch(e => ({ success: false, error: e.message }));
    if (!mixRes?.success) { setStep(epNum, 'error', 'Lỗi mix: ' + (mixRes?.error || '')); return; }

    let finalPath  = mixedPath;
    const midPaths = [ttsPath];

    // ⑥ Recreate (chỉ khi !randomCut — randomCut đã xử lý ở ①.5)
    if (reupCfg.enabled && !reupCfg.randomCut) {
      setStep(epNum, 'mixing', 'Tái tạo (tránh ContentID)...');
      const rcRes = await api.videoRecreate?.({
        videoPath: finalPath, outputFolder: outDir,
        outputFileName: baseName + '_reup.mp4',
        hFlip: reupCfg.hFlip, colorShift: reupCfg.colorShift,
        stereoFlip: reupCfg.stereoFlip, randomCut: false,
        slightRotate: reupCfg.slightRotate, randomPosCrop: reupCfg.randomPosCrop,
        varSpeed: reupCfg.varSpeed, grainNoise: reupCfg.grainNoise,
        bgNoise: reupCfg.bgNoise, randomFps: reupCfg.randomFps,
        hueRotate: reupCfg.hueRotate, audioEQ: reupCfg.audioEQ,
        pitchShift: reupCfg.pitchShift, zoomPct: reupCfg.zoomPct,
        audioVolume: reupCfg.audioVolume, gpuMode: reupCfg.gpuMode,
        trimStart: reupCfg.trimStart, trimEnd: reupCfg.trimEnd,
      }).catch(() => null);
      if (rcRes?.ok) {
        midPaths.push(finalPath);
        finalPath = rcRes.path || (outDir + '\\' + baseName + '_reup.mp4');
      }
    }

    // ⑦ Overlay phụ đề (nếu bật)
    if (ovSubEnabled && _srtViPath) {
      setStep(epNum, 'mixing', 'Thêm phụ đề...');
      const ovPath = `${base}_ov.mp4`;
      const ovRes = await api.videoAddOverlay?.({
        inputPath: finalPath, outputPath: ovPath,
        sub: { srtPath: _srtViPath, y: '(h-80)', size: 24, color: 'white', maxWords: 8, bgOpacity: 0.5 },
      }).catch(() => null);
      if (ovRes?.ok) { midPaths.push(finalPath); finalPath = ovPath; }
    }

    // Dọn dẹp — xóa tất cả file trung gian, chỉ giữ video reup cuối cùng
    const allTemp = [
      ...midPaths,
      videoForMix !== mp4 ? videoForMix : null,
      _srtOrigPath,
      _srtViPath,
    ].filter(Boolean);
    for (const f of allTemp) { await api.deleteFile?.(f).catch(() => {}); }

    setStep(epNum, 'done', '✅ Xong!', { path: finalPath });
  }, [seriesId, seriesInfo, doTranslate, doDub, ttsEngine, ttsVoice, capcutVoice, origVol, muteOrig, reupCfg, saveDir, charContextSaved, geminiModel, ovSubEnabled]);

  const toggleEp = (vid) => setSelectedEps(prev => {
    const next = new Set(prev);
    if (next.has(vid)) next.delete(vid); else next.add(vid);
    return next;
  });

  const runBatch = useCallback(async () => {
    if (!seriesInfo || selectedEps.size === 0) return;
    setBatchRunning(true); batchCancelRef.current = false;
    const epList = seriesInfo.vid_list.map((vid, idx) => ({ vid, epNum: idx + 1 })).filter(({ vid }) => selectedEps.has(vid));
    for (const { vid, epNum } of epList) {
      if (batchCancelRef.current) break;
      if (epStatus[epNum]?.status === 'done') continue;
      await processEpisode(epNum, vid);
    }
    setBatchRunning(false);
  }, [seriesInfo, selectedEps, epStatus, processEpisode]);

  const freeCount  = seriesInfo?.accessible_episode_cnt || 0;
  const displayEps = seriesInfo ? (showAll ? seriesInfo.vid_list : seriesInfo.vid_list.slice(0, 60)) : [];

  const STATUS_COLOR = { done:'text-green-400', error:'text-red-400', downloading:'text-blue-400', translating:'text-yellow-400', dubbing:'text-orange-400', mixing:'text-cyan-400', transcribing:'text-purple-400', extracting:'text-indigo-400' };
  const ACTIVE = new Set(['downloading','extracting','transcribing','translating','dubbing','mixing']);

  const safeTitle = (seriesInfo?.name || 'hongguo').replace(/[\\/:*?"<>|]/g, '_');

  if (loading) return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="px-3 py-2 bg-[#161b22] border-b border-gray-800">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-white px-2 py-1 bg-gray-800 rounded">← Quay lại danh sách phim</button>
      </div>
      <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117] text-xs">

      {/* ── Sub-header bar ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#161b22] border-b border-gray-800">
        <button onClick={onBack} className="flex items-center gap-1 text-gray-300 hover:text-white px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[11px] whitespace-nowrap">
          ← Quay lại danh sách phim
        </button>
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2">
          <span className="text-gray-500">⚡ Luồng tải:</span>
          <select className="bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px] w-12">
            {Array.from({length:10},(_,i)=>i+1).map(n=><option key={n}>{n}</option>)}
          </select>
        </div>
        {error && <span className="text-red-400 text-[10px]">{error}</span>}
        <div className="flex-1" />
        {/* Right: series mini card */}
        {seriesInfo && (
          <div className="flex items-center gap-2 bg-gray-800/60 rounded px-2 py-1 border border-gray-700/40">
            {seriesInfo.cover && <img src={seriesInfo.cover} alt="" className="w-8 h-10 object-cover rounded flex-shrink-0" />}
            <div className="text-[10px] leading-tight">
              <div className="text-gray-200 max-w-[140px] truncate">{seriesInfo.name}</div>
              <div className="text-green-400">• {seriesInfo.episode_cnt} Tập</div>
              <div className="text-gray-500">{new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} {new Date().toLocaleDateString('vi-VN')}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Status + title tab ── */}
      {seriesInfo && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-[#0d1117] border-b border-gray-800">
          <div className="text-green-400 text-[11px] mb-1">
            ✅ Quét thành công (Tổng: {seriesInfo.episode_cnt} tập). Bạn có thể chọn tập và tải ngay!
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded px-2 py-0.5">
              <span className="text-gray-200 text-[10px] max-w-[300px] truncate">{seriesInfo.name}</span>
              <button onClick={onBack} className="text-gray-500 hover:text-red-400 text-[10px] ml-1">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Episode table ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Table header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161b22] border-b border-gray-700 sticky top-0 z-10">
          <input type="checkbox"
            checked={seriesInfo && selectedEps.size === seriesInfo.vid_list.length}
            onChange={e => setSelectedEps(e.target.checked ? new Set(seriesInfo?.vid_list||[]) : new Set())}
            className="w-3 h-3 accent-blue-500 flex-shrink-0" />
          <span className="text-gray-500 w-14 text-[10px]">Chọn Tập</span>
          <span className="flex-1 text-gray-500 text-[10px]">Tên File</span>
          <span className="text-gray-500 text-[10px] w-32 text-right">Trạng Thái Link</span>
        </div>

        {displayEps.map((vid, idx) => {
          const epNum = idx + 1;
          const isFree = idx < freeCount;
          const st = epStatus[epNum];
          const isActive = ACTIVE.has(st?.status);
          const selected = selectedEps.has(vid);
          const filename = `Tap_${String(epNum).padStart(2,'0')}.mp4`;
          return (
            <div key={vid}
              className={`flex items-center gap-2 px-3 py-1 border-b border-gray-900/60 hover:bg-gray-800/30 cursor-pointer ${selected ? 'bg-blue-900/10' : ''}`}
              onClick={() => toggleEp(vid)}>
              <input type="checkbox" checked={selected} onChange={() => toggleEp(vid)}
                onClick={e => e.stopPropagation()}
                className="w-3 h-3 accent-blue-500 cursor-pointer flex-shrink-0" />
              <span className="text-gray-400 text-[10px] w-10 flex-shrink-0">Tập {epNum}</span>
              {/* Thumbnail placeholder */}
              <div className="w-9 h-6 bg-gray-800 rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                {seriesInfo?.cover
                  ? <img src={seriesInfo.cover} alt="" className="w-full h-full object-cover" />
                  : <span className="text-gray-600 text-[8px]">🎬</span>}
              </div>
              {/* Filename + status */}
              <span className="flex-1 text-gray-300 text-[10px] font-mono">{filename}</span>
              {/* Status badge */}
              <div className="w-36 flex items-center justify-end gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {isActive ? (
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className={`text-[10px] ${STATUS_COLOR[st?.status]||'text-blue-400'} truncate max-w-[100px]`}>{st?.msg}</span>
                  </div>
                ) : st?.status === 'done' ? (
                  <div className="flex items-center gap-1">
                    <span className="text-green-400 text-[10px]">✅ {st.msg}</span>
                    {st?.path && <button onClick={() => api.openFolder?.(st.path)} className="text-gray-500 hover:text-white text-[9px]">📂</button>}
                  </div>
                ) : st?.status === 'error' ? (
                  <span className="text-red-400 text-[10px] truncate max-w-[130px]" title={st.msg}>❌ {st.msg}</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 text-[10px]">☁️ {isFree ? 'Sẵn sàng tải' : '🔒 VIP'}</span>
                    <button onClick={e => { e.stopPropagation(); processEpisode(epNum, vid); }}
                      className="px-1.5 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded text-[9px] border border-blue-700/40">⬇</button>
                  </div>
                )}
                {isActive && st?.percent > 0 && (
                  <div className="h-0.5 bg-gray-700 rounded overflow-hidden w-14 flex-shrink-0">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${st.percent}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!showAll && seriesInfo && seriesInfo.vid_list.length > 60 && (
          <button onClick={() => setShowAll(true)} className="w-full py-2 text-[10px] text-gray-500 hover:text-white hover:bg-gray-900">
            Hiển thị tất cả {seriesInfo.vid_list.length} tập ▼
          </button>
        )}
      </div>

      {/* ── Bottom settings ── */}
      <div className="flex-shrink-0 bg-[#161b22] border-t border-gray-700">
        {/* Row 0: Thư mục lưu file */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800">
          <span className="text-gray-400 whitespace-nowrap">💾 Thư mục lưu:</span>
          <input
            type="text"
            value={saveDir}
            onChange={e => setSaveDir(e.target.value)}
            placeholder="Chọn thư mục lưu file tải về..."
            className="flex-1 bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-0.5 text-[10px] font-mono min-w-0"
          />
          <button
            onClick={async () => {
              const dir = await api.selectFolder?.();
              if (dir) setSaveDir(dir);
            }}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded border border-gray-600 text-[10px] whitespace-nowrap">
            📂 Chọn
          </button>
          <button
            onClick={() => api.openFolder?.(saveDir)}
            disabled={!saveDir}
            className="px-2 py-0.5 bg-yellow-900/50 hover:bg-yellow-800 text-yellow-400 rounded border border-yellow-700/40 text-[10px] whitespace-nowrap disabled:opacity-40">
            🔍 Mở
          </button>
        </div>
        {/* Row 1: Tách sub / dịch */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={doTranslate} onChange={e => setDoTranslate(e.target.checked)} className="w-3 h-3 accent-blue-500" />
            <span className={doTranslate ? 'text-blue-300' : 'text-gray-500'}>Tự động tách sub sau khi tải</span>
          </label>
          <span className="text-gray-600">Tiếng gốc:</span>
          <select className="bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px]" defaultValue="zh-CN">
            <option value="zh-CN">zh-CN</option><option value="zh-TW">zh-TW</option>
          </select>
          <span className="text-gray-600">– Dịch sang:</span>
          <select className="bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px]" defaultValue="vi-VN">
            <option value="vi-VN">vi-VN</option>
          </select>
          {doTranslate && (
            <>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" defaultChecked className="w-3 h-3 accent-green-500" />
                <span className="text-green-300">Tự động dịch sau khi tách sub</span>
              </label>
              <select className="bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px]" defaultValue="gemini">
                <option value="gemini">Gemini</option>
              </select>
              <span className="text-gray-600">Tập song song:</span>
              <input type="number" defaultValue="2" min="1" max="10"
                className="w-10 bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px] text-center" />
              <button className="px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded border border-blue-700/40 text-[10px] whitespace-nowrap">Tách sub ngay</button>
            </>
          )}
        </div>

        {/* Row 2: Lồng tiếng */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={doDub} onChange={e => setDoDub(e.target.checked)} disabled={!doTranslate} className="w-3 h-3 accent-orange-500" />
            <span className={doDub && doTranslate ? 'text-orange-300' : 'text-gray-600'}>Lồng tiếng sau khi tách sub</span>
          </label>
          {doDub && doTranslate && (
            <>
              <span className="text-gray-600">Giọng:</span>
              <div className="flex items-center gap-1">
                <select value={ttsEngine} onChange={e => { setTtsEngine(e.target.value); setTtsVoice(''); }}
                  className="bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px]">
                  <option value="vieneu">VieNeu</option>
                  <option value="capcut">CapCut</option>
                  <option value="kokoro">Kokoro</option>
                  <option value="gemini">Gemini</option>
                </select>
                {ttsEngine === 'vieneu' && (
                  <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white rounded px-1.5 py-0.5 text-[10px] min-w-[180px]">
                    <option value="">-- Mặc định --</option>
                    {vnBuiltinVoices.length > 0 && (
                      <optgroup label="── Giọng có sẵn ──">
                        {vnBuiltinVoices.map((v, i) => {
                          // VieNeu trả về [desc, id] tuple
                          const [label, val] = Array.isArray(v) ? v : [v.name || v.id || v, v.id || v.name || v];
                          return <option key={i} value={val}>{label}</option>;
                        })}
                      </optgroup>
                    )}
                    {vnSavedVoices.length > 0 && (
                      <optgroup label="── Clone của bạn ──">
                        {vnSavedVoices.map(v => <option key={v.id} value={`clone:${v.id}`}>{v.name||v.id}</option>)}
                      </optgroup>
                    )}
                  </select>
                )}
                {ttsEngine === 'kokoro' && (
                  <select value={ttsVoice || 'vi_co_gai_hoat_ngon'} onChange={e => setTtsVoice(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white rounded px-1.5 py-0.5 text-[10px] min-w-[140px]">
                    {KOKORO_VI_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
                {ttsEngine === 'capcut' && (
                  <select value={capcutVoice} onChange={e => setCapcutVoice(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white rounded px-1.5 py-0.5 text-[10px] min-w-[160px]">
                    {CAPCUT_VI_VOICES.map(v => <option key={v.voice} value={v.voice}>{v.label}</option>)}
                  </select>
                )}
                {ttsEngine === 'gemini' && (
                  <select value={ttsVoice || 'Charon'} onChange={e => setTtsVoice(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white rounded px-1.5 py-0.5 text-[10px]">
                    {GEMINI_TTS_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
              </div>
              <span className="text-gray-600">Tốc độ:</span>
              <input type="number" defaultValue="1.0" min="0.5" max="2" step="0.1"
                className="w-12 bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px] text-center" />
              <span className="text-gray-600">Luồng:</span>
              <input type="number" defaultValue="4" min="1" max="20"
                className="w-10 bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px] text-center" />
              <button className="px-2 py-0.5 bg-orange-900/50 hover:bg-orange-800 text-orange-300 rounded border border-orange-700/40 text-[10px] whitespace-nowrap">Lồng tiếng ngay</button>
            </>
          )}
        </div>

        {/* Row 3: Audio options */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 flex-wrap">
          <span className="text-gray-400">🔊 Tiếng gốc:</span>
          <input type="number" value={origVol} onChange={e => setOrigVol(+e.target.value)} min="0" max="100"
            className="w-10 bg-gray-800 border border-gray-700 text-white rounded px-1 py-0.5 text-[10px] text-center" />
          <span className="text-gray-600">%</span>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={muteOrig} onChange={e => setMuteOrig(e.target.checked)} className="w-3 h-3 accent-orange-500" />
            <span className={muteOrig ? 'text-orange-400' : 'text-gray-500'}>Tắt tiếng gốc</span>
          </label>
        </div>

        {/* Row 3b: Overlay sub */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={ovSubEnabled} onChange={e => setOvSubEnabled(e.target.checked)} className="w-3 h-3 accent-purple-500" />
            <span className={ovSubEnabled ? 'text-purple-300' : 'text-gray-500'}>Burn phụ đề vào video</span>
          </label>
          {!doDub && <span className="text-gray-600 text-[10px]">(chỉ hoạt động khi bật Lồng tiếng)</span>}
        </div>

        {/* Row 4: Action bar */}
        <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
          <button
            onClick={() => setSelectedEps(prev => prev.size === (seriesInfo?.vid_list?.length||0) ? new Set() : new Set(seriesInfo?.vid_list||[]))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-[11px]">
            ☑ Chọn / Bỏ chọn tất cả
          </button>
          {/* Reup settings button */}
          <button
            onClick={() => setShowReupModal(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-bold transition-all ${reupCfg.enabled
              ? 'bg-pink-900/60 border-pink-600/60 text-pink-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
            ⚙️ Cài đặt Reup{reupCfg.enabled ? ' ✓' : ''}
          </button>
          <div className="flex-1" />
          {batchRunning ? (
            <button onClick={() => { batchCancelRef.current = true; setBatchRunning(false); }}
              className="px-4 py-2 rounded text-sm font-bold bg-red-700 hover:bg-red-600 text-white">⏹ Dừng</button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => { if (!selectedEps.size) return; downloadOnlyRef.current = true; runBatch().finally(() => { downloadOnlyRef.current = false; }); }}
                disabled={!selectedEps.size}
                className={`px-4 py-2 rounded text-[11px] font-bold border ${selectedEps.size ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600' : 'bg-gray-900 text-gray-600 border-gray-800 cursor-not-allowed'}`}>
                ⬇️ Chỉ tải ({selectedEps.size})
              </button>
              <button
                onClick={() => { if (!selectedEps.size) return; downloadOnlyRef.current = false; runBatch(); }}
                disabled={!selectedEps.size}
                className={`px-6 py-2 rounded text-[11px] font-bold ${selectedEps.size ? 'bg-[#00d4aa] hover:bg-[#00c49a] text-black' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}>
                ☁️ Tải + Reup ({selectedEps.size})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reup config modal */}
      {showReupModal && (
        <ReupCfgModal
          cfg={reupCfg}
          onChange={c => { setReupCfg(c); try { localStorage.setItem('hongguo_reup_cfg', JSON.stringify(c)); } catch {} }}
          onClose={() => setShowReupModal(false)}
        />
      )}
    </div>
  );
}

// ── Queue View — danh sách phim đã chọn để xử lý hàng loạt ─────────────────
function QueueView({ series, onBack, onOpenSeries }) {
  const [items, setItems] = useState(series.map(v => ({ ...v, checked: true })));

  const toggleItem = (id) => setItems(prev => prev.map(v => v.series_id === id ? { ...v, checked: !v.checked } : v));
  const removeItem = (id) => setItems(prev => prev.filter(v => v.series_id !== id));
  const checkedItems = items.filter(v => v.checked);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 bg-[#161b22]">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-xs">← Quay lại</button>
        <span className="text-sm font-bold text-white">📋 Hàng đợi xử lý</span>
        <span className="text-xs text-gray-500">{items.length} phim đã chọn</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setItems(prev => prev.map(v => ({ ...v, checked: true })))}
            className="text-[10px] text-gray-400 hover:text-white px-2 py-1 bg-gray-800 rounded">Chọn tất</button>
          <button onClick={() => onOpenSeries?.(checkedItems[0]?.series_id)}
            disabled={checkedItems.length !== 1}
            className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-xs rounded font-medium">
            📂 Mở chi tiết
          </button>
        </div>
      </div>

      {/* Series list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
        {items.map((v, i) => (
          <div key={v.series_id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${v.checked ? 'bg-gray-900 border-gray-700' : 'bg-gray-900/30 border-gray-800/50 opacity-50'}`}>
            <span className="text-gray-600 text-[10px] w-5 text-right">{i+1}</span>
            <button onClick={() => toggleItem(v.series_id)}
              className={`w-5 h-5 rounded flex items-center justify-center text-xs flex-shrink-0 ${v.checked ? 'bg-red-600 text-white' : 'bg-gray-700 text-transparent'}`}>
              ✓
            </button>
            {v.cover && <img src={v.cover} alt="" className="w-8 h-10 object-cover rounded flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{v.title || v.series_id}</p>
              <p className="text-gray-500 text-[10px] mt-0.5">
                {v.episode_cnt ? `${v.episode_cnt} tập` : ''}
                {v.accessible_episode_cnt ? ` · ${v.accessible_episode_cnt} miễn phí` : ''}
              </p>
            </div>
            <button onClick={() => onOpenSeries?.(v.series_id)}
              className="text-[10px] text-blue-400 hover:text-blue-300 px-2 py-0.5 bg-blue-900/30 rounded">
              Chi tiết
            </button>
            <button onClick={() => removeItem(v.series_id)}
              className="text-gray-600 hover:text-red-400 text-xs px-1.5 flex-shrink-0">✕</button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="flex items-center justify-center py-20 text-gray-600 text-sm">
            Danh sách trống — <button onClick={onBack} className="ml-1 text-blue-400 hover:text-blue-300">quay lại chọn phim</button>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      {checkedItems.length > 0 && (
        <div className="flex-shrink-0 border-t border-gray-800 px-4 py-2.5 bg-[#161b22] flex items-center gap-3">
          <span className="text-xs text-gray-400">{checkedItems.length} phim được chọn để xử lý</span>
          <span className="text-[10px] text-gray-600">
            Tổng: {checkedItems.reduce((s, v) => s + (v.episode_cnt || 0), 0)} tập
            · Miễn phí: {checkedItems.reduce((s, v) => s + (v.accessible_episode_cnt || 0), 0)} tập
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => { if (checkedItems.length === 1) onOpenSeries?.(checkedItems[0].series_id); }}
              disabled={checkedItems.length !== 1}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-xs rounded">
              Mở từng phim
            </button>
            <button onClick={() => { onOpenSeries?.(checkedItems[0]?.series_id); }}
              disabled={!checkedItems.length}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs rounded font-bold">
              ▶ Bắt đầu với phim đầu tiên
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function HongguoPanel() {
  const [mode, setMode] = useState('browse'); // 'browse' | 'detail' | 'queue'
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');
  const [queuedSeries, setQueuedSeries] = useState([]); // [{series_id, title, episode_cnt, cover}]

  const handleSelectSeries = (seriesId) => {
    setSelectedSeriesId(seriesId);
    setMode('detail');
  };

  const handleUrlSearch = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const sid = extractSeriesId(trimmed);
    if (sid) { setUrlError(''); handleSelectSeries(sid); return; }
    // Not a URL — treat as text search, pass to BrowseView via state
    setUrlError('');
    setMode('browse');
  };

  const handleQueueSelected = (series) => {
    setQueuedSeries(series);
    setMode('queue');
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white overflow-hidden w-full">
      {/* Top bar — BOOM STUDIO style */}
      <div className="flex-shrink-0 bg-[#161b22] border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-red-400 whitespace-nowrap">🍎 Hongguo VIP</span>
          <input
            className="flex-1 bg-[#0d1117] border border-gray-700 text-white px-3 py-1.5 rounded text-xs focus:outline-none focus:border-blue-500 placeholder-gray-600"
            placeholder="Dán Link phim HOẶC Nhập Tên Phim rồi nhấn Enter..."
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlSearch()}
          />
          <button onClick={handleUrlSearch}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium whitespace-nowrap">
            🔍 Tìm / Quét Phim
          </button>
          {mode !== 'browse' && (
            <button onClick={() => setMode('browse')}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs whitespace-nowrap">
              📋 Danh sách
            </button>
          )}
        </div>
        {urlError && <p className="text-red-400 text-xs mt-1">{urlError}</p>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'browse' && (
          <BrowseView onSelectSeries={handleSelectSeries} onQueueSelected={handleQueueSelected} />
        )}
        {mode === 'detail' && (
          <DetailView seriesId={selectedSeriesId} onBack={() => setMode('browse')} />
        )}
        {mode === 'queue' && (
          <QueueView series={queuedSeries} onBack={() => setMode('browse')} onOpenSeries={handleSelectSeries} />
        )}
      </div>
    </div>
  );
}
