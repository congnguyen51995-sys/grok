import React, { useState, useRef, useCallback, useEffect } from 'react';

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

// ── Browse mode — Home sections grid ──────────────────────────────────────────
function BrowseView({ onSelectSeries }) {
  const [homeData, setHomeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.hongguoGetHome().then(res => {
      setLoading(false);
      if (res.ok) setHomeData(res);
      else setError(res.error);
    });
  }, []);

  const TAB_LABELS = {
    all: '🔥 Đề xuất',
    human: '👤 Người thật',
    comic: '🎨 Hoạt hình',
    ai: '🤖 AI Drama',
  };

  const currentSection = homeData?.homeSections?.find(s => s.tab_type === activeTab);
  const banners = homeData?.bannerList || [];

  if (loading) return (
    <div className="flex flex-col h-full items-center justify-center text-gray-500">
      <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-sm">Đang tải danh sách phim...</p>
    </div>
  );

  if (error) return (
    <div className="flex flex-col h-full items-center justify-center text-red-400">
      <p className="text-sm">❌ {error}</p>
      <button onClick={() => { setError(''); setLoading(true); api.hongguoGetHome().then(r => { setLoading(false); if (r.ok) setHomeData(r); else setError(r.error); }); }}
        className="mt-3 px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm">
        Thử lại
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Banner strip */}
      {banners.length > 0 && (
        <div className="flex-shrink-0 flex gap-2 px-3 py-2 overflow-x-auto scrollbar-none bg-gray-900/50">
          {banners.map(b => (
            <div key={b.series_id} onClick={() => onSelectSeries(b.series_id)}
              className="flex-shrink-0 cursor-pointer group relative w-28 h-20 rounded overflow-hidden border border-gray-700 hover:border-red-500">
              <img src={b.cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1">
                <p className="text-white text-[10px] font-bold leading-tight line-clamp-2">{b.title}</p>
              </div>
              <div className="absolute top-1 left-1 bg-red-600 text-white text-[9px] px-1 rounded font-bold">HOT</div>
            </div>
          ))}
        </div>
      )}

      {/* Section tabs */}
      {homeData && (
        <div className="flex-shrink-0 flex gap-1 px-3 py-2 bg-gray-900 border-b border-gray-700">
          {homeData.homeSections.map(s => (
            <button key={s.tab_type}
              onClick={() => setActiveTab(s.tab_type)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === s.tab_type
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}>
              {TAB_LABELS[s.tab_type] || s.tab_name}
            </button>
          ))}
        </div>
      )}

      {/* Series grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-2">
          {(currentSection?.video_list || []).map((v, i) => (
            <div key={v.series_id} onClick={() => onSelectSeries(v.series_id)}
              className="cursor-pointer group rounded overflow-hidden border border-gray-800 hover:border-red-500 bg-gray-900 transition-all hover:scale-[1.02]">
              <div className="relative aspect-[3/4]">
                <img src={v.cover} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-2">
                  <p className="text-white text-xs font-bold leading-tight line-clamp-2">{v.title}</p>
                </div>
                {v.rank <= 3 && (
                  <div className={`absolute top-1 left-1 text-white text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    v.rank === 1 ? 'bg-yellow-500' : v.rank === 2 ? 'bg-gray-400' : 'bg-orange-600'
                  }`}>#{v.rank}</div>
                )}
              </div>
              <div className="px-2 py-1">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-[10px]">{v.episode_right_text || `${v.episode_cnt} tập`}</span>
                  {v.tags?.slice(0, 1).map(t => (
                    <span key={t} className="text-[9px] bg-gray-700 text-gray-300 px-1 rounded">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Detail mode — Episode list ────────────────────────────────────────────────
function DetailView({ seriesId, onBack }) {
  const [seriesInfo, setSeriesInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState({});
  const [selectedEps, setSelectedEps] = useState(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const batchCancelRef = useRef(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.hongguoGetSeriesInfo(seriesId).then(res => {
      setLoading(false);
      if (res.ok) setSeriesInfo(res);
      else setError(res.error || 'Lỗi tải thông tin');
    });
  }, [seriesId]);

  useEffect(() => {
    const off = api.onHongguoProgress?.((d) => {
      setDownloads(prev => ({ ...prev, [d.epNum]: { status: d.status, msg: d.msg, percent: d.percent || 0, path: d.path } }));
    });
    return () => { try { off?.(); } catch {} };
  }, []);

  const downloadEpisode = useCallback(async (epNum, vidId) => {
    const dlDir = await api.getDownloadsDir();
    const safeTitle = (seriesInfo?.name || 'hongguo').replace(/[\\/:*?"<>|]/g, '_');
    const epStr = String(epNum).padStart(3, '0');
    const outPath = `${dlDir}\\Hongguo\\${safeTitle}\\Tap_${epStr}.mp4`;
    setDownloads(prev => ({ ...prev, [epNum]: { status: 'starting', msg: 'Khởi động...', percent: 0 } }));
    await api.hongguoDownloadEpisode({ seriesId, vidId, outPath, epNum });
  }, [seriesInfo, seriesId]);

  const toggleEp = (vid) => setSelectedEps(prev => {
    const next = new Set(prev);
    if (next.has(vid)) next.delete(vid); else next.add(vid);
    return next;
  });

  const downloadBatch = useCallback(async () => {
    if (!seriesInfo || selectedEps.size === 0) return;
    setBatchRunning(true);
    batchCancelRef.current = false;
    const epList = seriesInfo.vid_list.map((vid, idx) => ({ vid, epNum: idx + 1 })).filter(({ vid }) => selectedEps.has(vid));
    for (const { vid, epNum } of epList) {
      if (batchCancelRef.current) break;
      if (downloads[epNum]?.status === 'done') continue;
      await downloadEpisode(epNum, vid);
    }
    setBatchRunning(false);
  }, [seriesInfo, selectedEps, downloads, downloadEpisode]);

  const freeCount = seriesInfo?.accessible_episode_cnt || 0;
  const displayEps = seriesInfo ? (showAll ? seriesInfo.vid_list : seriesInfo.vid_list.slice(0, 60)) : [];

  if (loading) return (
    <div className="flex flex-col h-full">
      <button onClick={onBack} className="flex-shrink-0 flex items-center gap-2 px-4 py-3 text-gray-400 hover:text-white bg-gray-900 border-b border-gray-700 text-sm">
        ← Quay lại
      </button>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Back + series header */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700">
        <button onClick={onBack} className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-white text-sm w-full text-left border-b border-gray-800">
          ← Quay lại danh sách
        </button>
        {seriesInfo && (
          <div className="flex gap-3 px-4 py-2">
            {seriesInfo.cover && <img src={seriesInfo.cover} alt="" className="w-14 h-20 object-cover rounded flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-white text-sm">{seriesInfo.name}</h2>
              <div className="flex flex-wrap gap-1 mt-1">
                {seriesInfo.tags?.map(t => <span key={t} className="px-1.5 py-0 bg-gray-700 rounded text-[10px] text-gray-300">{t}</span>)}
              </div>
              <div className="flex gap-3 mt-1 text-xs">
                <span className="text-gray-400">📺 {seriesInfo.episode_cnt} tập</span>
                <span className="text-green-400">🆓 {freeCount} free</span>
                <span className="text-yellow-500">🔒 {seriesInfo.episode_cnt - freeCount} có phí</span>
              </div>
            </div>
          </div>
        )}
        {error && <p className="px-4 pb-2 text-red-400 text-xs">{error}</p>}

        {/* Batch controls */}
        {seriesInfo && (
          <div className="px-4 pb-2 flex flex-wrap gap-2 items-center">
            <button onClick={() => { const s = new Set(); seriesInfo.vid_list.slice(0, freeCount).forEach(v => s.add(v)); setSelectedEps(s); }}
              className="px-2 py-1 bg-green-800 hover:bg-green-700 rounded text-xs">✅ {freeCount} free</button>
            <button onClick={() => setSelectedEps(new Set(seriesInfo.vid_list))}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">☑️ Tất cả</button>
            <button onClick={() => setSelectedEps(new Set())}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">⬜ Bỏ</button>
            {selectedEps.size > 0 && (
              <button
                onClick={batchRunning ? () => { batchCancelRef.current = true; setBatchRunning(false); } : downloadBatch}
                className={`px-3 py-1 rounded text-xs font-bold ${batchRunning ? 'bg-red-700 hover:bg-red-600' : 'bg-red-600 hover:bg-red-500'}`}>
                {batchRunning ? '⏹ Dừng' : `⬇️ Tải ${selectedEps.size} tập`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Episode list */}
      <div className="flex-1 overflow-y-auto">
        {displayEps.map((vid, idx) => {
          const epNum = idx + 1;
          const isFree = idx < freeCount;
          const dl = downloads[epNum];
          const isActive = dl?.status === 'downloading' || dl?.status === 'fetching' || dl?.status === 'starting';
          const selected = selectedEps.has(vid);
          return (
            <div key={vid} className={`flex items-center gap-2 px-4 py-2 border-b border-gray-800 hover:bg-gray-900/60 ${selected ? 'bg-gray-800/40' : ''}`}>
              <input type="checkbox" checked={selected} onChange={() => toggleEp(vid)}
                className="w-4 h-4 accent-red-500 cursor-pointer flex-shrink-0" />
              <span className="w-7 text-xs text-gray-500 font-mono text-right flex-shrink-0">{epNum}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm">Tập {epNum} </span>
                {isFree ? <span className="text-xs text-green-400">FREE</span> : <span className="text-xs text-yellow-500">🔒</span>}
                {dl && (
                  <span className={`ml-2 text-xs ${dl.status === 'done' ? 'text-green-400' : dl.status === 'error' ? 'text-red-400' : 'text-blue-400'}`}>
                    {dl.msg}
                  </span>
                )}
                {isActive && dl?.percent > 0 && (
                  <div className="mt-1 h-1 bg-gray-700 rounded overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${dl.percent}%` }} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {dl?.status === 'done' && dl.path && (
                  <button onClick={() => api.openFolder(dl.path)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">📂</button>
                )}
                {isActive
                  ? <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  : <button onClick={() => downloadEpisode(epNum, vid)} className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs">⬇️</button>
                }
              </div>
            </div>
          );
        })}
        {!showAll && seriesInfo && seriesInfo.vid_list.length > 60 && (
          <button onClick={() => setShowAll(true)} className="w-full py-3 text-sm text-gray-400 hover:text-white hover:bg-gray-800">
            Hiển thị tất cả {seriesInfo.vid_list.length} tập ▼
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function HongguoPanel() {
  const [mode, setMode] = useState('browse'); // 'browse' | 'detail'
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  const handleSelectSeries = (seriesId) => {
    setSelectedSeriesId(seriesId);
    setMode('detail');
  };

  const handleUrlSearch = () => {
    const sid = extractSeriesId(urlInput);
    if (!sid) { setUrlError('URL hoặc series_id không hợp lệ'); return; }
    setUrlError('');
    handleSelectSeries(sid);
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden w-full">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🍎</span>
          <span className="text-sm font-bold text-red-400">Hongguo</span>
          <span className="text-xs text-gray-500">红果短剧</span>
          <div className="flex-1" />
          <input
            className="w-56 bg-gray-800 text-white px-2 py-1 rounded text-xs border border-gray-600 focus:outline-none focus:border-red-500"
            placeholder="Dán URL series để tải..."
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlSearch()}
          />
          <button onClick={handleUrlSearch}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-xs font-medium">
            Tải
          </button>
        </div>
        {urlError && <p className="text-red-400 text-xs mt-1">{urlError}</p>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'browse'
          ? <BrowseView onSelectSeries={handleSelectSeries} />
          : <DetailView seriesId={selectedSeriesId} onBack={() => setMode('browse')} />
        }
      </div>
    </div>
  );
}
