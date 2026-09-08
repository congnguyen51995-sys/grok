import { useState, useRef, useCallback } from 'react';

const API = window.electronAPI;

const fmtDur = (s) => {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtNum = (n) => {
  if (!n) return '';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

export default function BilibiliSearch({ onAddToQueue }) {
  const [keyword,     setKeyword]     = useState('');
  const [results,     setResults]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(false);
  const [dlQueue,     setDlQueue]     = useState({});
  const [outFolder,   setOutFolder]   = useState('');
  const [quality,     setQuality]     = useState('best');
  const [hoverId,     setHoverId]     = useState(null);
  const [fullscreen,  setFullscreen]  = useState(null); // modal fullscreen
  const [selected,    setSelected]    = useState(null); // inline preview item
  const [channel,     setChannel]     = useState(null);
  const [chDlQueue,   setChDlQueue]   = useState({});
  const [autoTrans,   setAutoTrans]   = useState(false);
  const [translated,  setTranslated]  = useState({});

  const search = useCallback(async (kw, pg = 1) => {
    if (!kw.trim()) return;
    setLoading(true);
    setError('');
    if (pg === 1) { setResults([]); setHasMore(false); }
    try {
      const res = await API.bilibiliSearch({ keyword: kw.trim(), page: pg });
      if (res.error) { setError(res.error); return; }
      const items = res.items || [];
      setResults(prev => pg === 1 ? items : [...prev, ...items]);
      setPage(pg + 1);
      setHasMore(items.length >= 20);
      if (autoTrans) translateBatch(items);
    } catch (e) {
      setError(e.message || 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }, [autoTrans]);

  const pickFolder = async () => {
    const f = await API.selectFolder();
    if (f) setOutFolder(f);
  };

  const download = async (item) => {
    if (!outFolder) { alert('Chọn thư mục lưu trước!'); return; }
    const id = item.bvid;
    setDlQueue(q => ({ ...q, [id]: { status: 'downloading', progress: 0 } }));
    const unsub = API.onDownloaderProgress((d) => {
      if (d._sourceId !== id) return;
      setDlQueue(q => ({ ...q, [id]: { status: 'downloading', ...d } }));
    });
    try {
      const res = await API.bilibiliDownload({ url: item.url, outputFolder: outFolder, quality, bvid: id });
      setDlQueue(q => ({ ...q, [id]: { status: res.success ? 'done' : 'error', error: res.error, outputPath: res.outputPath } }));
    } catch (e) {
      setDlQueue(q => ({ ...q, [id]: { status: 'error', error: e.message } }));
    } finally {
      unsub?.();
    }
  };

  const translateTitle = useCallback(async (text) => {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
      const r = await fetch(url);
      const json = await r.json();
      return json?.[0]?.map(s => s?.[0]).filter(Boolean).join('') || text;
    } catch { return text; }
  }, []);

  const translateBatch = useCallback(async (items) => {
    const newTrans = {};
    for (const item of items) {
      if (!item.bvid || !item.title) continue;
      const vi = await translateTitle(item.title);
      newTrans[item.bvid] = vi;
    }
    setTranslated(prev => ({ ...prev, ...newTrans }));
  }, [translateTitle]);

  const openChannel = useCallback(async (mid, name, pg = 1) => {
    if (!mid) { alert('Không có thông tin kênh cho video này.'); return; }
    setChannel({ mid, name, items: pg === 1 ? [] : channel?.items || [], loading: true, error: '', page: pg, totalPages: 1 });
    try {
      const res = await API.bilibiliChannelVideos({ mid, page: pg });
      if (res.error) { setChannel(c => ({ ...c, loading: false, error: res.error })); return; }
      const newItems = res.items || [];
      setChannel(c => ({
        ...c, loading: false,
        name: res.channelName || name,
        items: pg === 1 ? newItems : [...(c?.items || []), ...newItems],
        totalPages: res.totalPages || 1,
      }));
      if (autoTrans) translateBatch(newItems);
    } catch (e) {
      setChannel(c => ({ ...c, loading: false, error: e.message }));
    }
  }, [channel, autoTrans]);

  const downloadCh = async (item) => {
    if (!outFolder) { alert('Chọn thư mục lưu trước!'); return; }
    const id = item.bvid;
    setChDlQueue(q => ({ ...q, [id]: { status: 'downloading', progress: 0 } }));
    const unsub = API.onDownloaderProgress?.((d) => {
      if (d._sourceId !== id) return;
      setChDlQueue(q => ({ ...q, [id]: { status: 'downloading', ...d } }));
    });
    try {
      const res = await API.bilibiliDownload({ url: item.url, outputFolder: outFolder, quality, bvid: id });
      setChDlQueue(q => ({ ...q, [id]: { status: res.success ? 'done' : 'error', error: res.error } }));
    } catch (e) {
      setChDlQueue(q => ({ ...q, [id]: { status: 'error', error: e.message } }));
    } finally { unsub?.(); }
  };

  const selectVideo = (item) => {
    setSelected(prev => prev?.bvid === item.bvid ? null : item);
  };

  // ── FULLSCREEN MODAL ──
  const FullscreenModal = fullscreen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={() => setFullscreen(null)}>
      <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 'min(960px, 94vw)', aspectRatio: '16/9' }}
        onClick={e => e.stopPropagation()}>
        <iframe
          src={`https://player.bilibili.com/player.html?bvid=${fullscreen.bvid}&autoplay=1&danmaku=0&high_quality=1`}
          allowFullScreen allow="autoplay; fullscreen"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
        <button onClick={() => setFullscreen(null)}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center text-white text-lg transition">✕</button>
      </div>
    </div>
  );

  // ── CHANNEL PANEL ──
  const ChannelPanel = channel && (
    <div className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm" onClick={() => setChannel(null)}>
      <div className="relative ml-auto w-[70vw] h-full bg-slate-900 flex flex-col shadow-2xl border-l border-slate-700"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
          <button onClick={() => setChannel(null)}
            className="w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white text-lg transition">✕</button>
          <div className="flex-1">
            <div className="text-sm font-black text-white">📺 {channel.name || 'Kênh'}</div>
            <div className="text-[10px] text-slate-400">{channel.items.length} video · Trang {channel.page}/{channel.totalPages}</div>
          </div>
          <button onClick={pickFolder}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300 transition max-w-[180px] truncate">
            📁 {outFolder ? outFolder.split(/[/\\]/).pop() : 'Chọn thư mục'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {channel.error && <div className="mb-3 px-3 py-2 bg-red-900/40 rounded text-sm text-red-300">❌ {channel.error}</div>}
          {channel.loading && channel.items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-9 h-9 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
              <div className="text-sm text-slate-400">Đang tải video kênh...</div>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {channel.items.map(item => {
              const dl = chDlQueue[item.bvid];
              return (
                <div key={item.bvid} className="flex flex-col bg-slate-800 rounded-xl overflow-hidden border border-slate-700/50 hover:border-blue-500/50 transition-all">
                  <div className="relative aspect-video bg-slate-900 overflow-hidden cursor-pointer"
                    onClick={() => selectVideo(item)}>
                    {item.thumbnail && <img src={item.thumbnail} alt={item.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" loading="lazy"/>}
                    {item.duration > 0 && (
                      <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded font-mono">{fmtDur(item.duration)}</span>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition">
                      <span className="text-white text-2xl">▶</span>
                    </div>
                  </div>
                  <div className="p-2 flex flex-col gap-1 flex-1">
                    <p className="text-[10px] text-slate-200 line-clamp-2 leading-tight" title={item.title}>
                      {translated[item.bvid] || item.title || '(Không có tiêu đề)'}
                    </p>
                    {!dl && (
                      <button onClick={() => downloadCh(item)} disabled={!outFolder}
                        className="mt-auto w-full py-1 rounded text-[10px] font-bold bg-blue-700 hover:bg-blue-600 disabled:opacity-30 transition">
                        ⬇ Tải {quality === 'best' ? 'HD' : quality + 'p'}
                      </button>
                    )}
                    {dl?.status === 'downloading' && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${dl.percent || 0}%` }}/>
                        </div>
                        <span className="text-[9px] text-slate-400 text-center">{dl.percent ? `${dl.percent.toFixed(0)}%` : 'Đang tải...'}</span>
                      </div>
                    )}
                    {dl?.status === 'done' && <div className="mt-auto text-center text-[10px] text-green-400 font-bold">✅ Xong</div>}
                    {dl?.status === 'error' && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        <div className="text-[9px] text-red-400 text-center">❌ Lỗi</div>
                        <button onClick={() => { setChDlQueue(q => { const n={...q}; delete n[item.bvid]; return n; }); downloadCh(item); }}
                          className="w-full py-0.5 rounded text-[9px] bg-red-900/50 hover:bg-red-800 transition">Thử lại</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {channel.page < channel.totalPages && !channel.loading && (
            <div className="flex justify-center mt-4">
              <button onClick={() => openChannel(channel.mid, channel.name, channel.page + 1)}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition">
                Tải thêm trang {channel.page + 1}/{channel.totalPages}...
              </button>
            </div>
          )}
          {channel.loading && channel.items.length > 0 && (
            <div className="flex justify-center mt-4"><span className="text-slate-500 text-sm">⏳ Đang tải...</span></div>
          )}
        </div>
      </div>
    </div>
  );

  const dl = selected ? dlQueue[selected.bvid] : null;

  return (
    <div className="flex flex-col w-full h-full bg-slate-900 text-white overflow-hidden">
      {FullscreenModal}
      {ChannelPanel}

      {/* HEADER */}
      <div className="flex-shrink-0 border-b border-slate-700/60 bg-[#060a12]">
        <div className="flex items-center gap-3 px-5 pt-4 pb-2">
          <span className="text-2xl">📺</span>
          <div>
            <div className="text-[15px] font-black text-white tracking-wide uppercase">Tìm Video Bilibili</div>
            <div className="text-[10px] text-slate-500">Không cần đăng nhập · Không cần VPN · Nội dung Trung Quốc phong phú</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 pb-3">
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(keyword)}
            placeholder="Nhập từ khóa tìm kiếm (tiếng Trung hoặc tiếng Anh)..."
            className="flex-1 px-4 py-2.5 bg-slate-800/80 border border-slate-600/60 rounded-xl text-[13px] font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
          />
          <button onClick={() => search(keyword)} disabled={loading || !keyword.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-[13px] font-black text-white transition shadow-md shadow-blue-900/30 min-w-[110px] justify-center">
            {loading && page === 2 ? <><span className="animate-spin">⏳</span> Đang tìm...</> : <>🔍 Tìm Video</>}
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 pb-3">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mr-1">Chất lượng:</span>
          {[['best','Tốt nhất'],['1080','1080p'],['720','720p'],['480','480p']].map(([v,l]) => (
            <button key={v} onClick={() => setQuality(v)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition border ${quality===v ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
              {l}
            </button>
          ))}
          <div className="w-px h-5 bg-slate-700 mx-1"/>
          <button onClick={pickFolder}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg text-[11px] font-bold text-slate-300 transition max-w-[200px]">
            📁 <span className="truncate">{outFolder ? outFolder.split(/[/\\]/).pop() : 'Chọn thư mục lưu'}</span>
          </button>
          <button onClick={() => { const next = !autoTrans; setAutoTrans(next); if (next && results.length > 0) translateBatch(results); }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition border ${autoTrans ? 'bg-green-700 border-green-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
            🌐 {autoTrans ? 'Đang dịch VI' : 'Dịch VI'}
          </button>
          {results.length > 0 && <span className="ml-auto text-[11px] text-slate-500">{results.length} video</span>}
        </div>
      </div>

      {/* CONTENT — split layout khi có video được chọn */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* DANH SÁCH KẾT QUẢ */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ${selected ? 'w-[42%] border-r border-slate-700/60' : 'w-full'}`}>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {error && (
              <div className="mb-3 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300">❌ {error}</div>
            )}
            {loading && results.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"/>
                <div className="text-sm text-slate-400">Đang tìm kiếm trên Bilibili...</div>
              </div>
            )}
            {!loading && results.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 select-none gap-3">
                <div className="text-6xl">📺</div>
                <div className="text-sm font-semibold">Nhập từ khóa và nhấn Tìm để bắt đầu</div>
                <div className="text-xs text-slate-700 text-center max-w-xs">
                  Không cần đăng nhập · Không cần VPN<br/>
                  Nội dung Trung Quốc từ Bilibili (哔哩哔哩)
                </div>
              </div>
            )}
            {results.length > 0 && (
              <div className={`grid gap-3 ${selected ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'}`}>
                {results.map(item => {
                  const isSelected = selected?.bvid === item.bvid;
                  const itemDl = dlQueue[item.bvid];
                  return (
                    <div key={item.bvid}
                      className={`group relative flex flex-col rounded-xl overflow-hidden border transition-all cursor-pointer
                        ${isSelected
                          ? 'border-blue-500 bg-blue-950/40 ring-1 ring-blue-500/40'
                          : 'bg-slate-800 border-slate-700/50 hover:border-blue-500/50'}`}
                      onMouseEnter={() => setHoverId(item.bvid)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => selectVideo(item)}>

                      {/* THUMBNAIL */}
                      <div className="relative aspect-video bg-slate-900 overflow-hidden">
                        {item.thumbnail && (
                          <img src={item.thumbnail} alt={item.title} referrerPolicy="no-referrer"
                            className="w-full h-full object-cover" loading="lazy"/>
                        )}
                        {item.duration > 0 && (
                          <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                            {fmtDur(item.duration)}
                          </span>
                        )}
                        {item.play > 0 && (
                          <span className="absolute top-1.5 left-1.5 bg-black/60 text-blue-300 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                            ▶ {fmtNum(item.play)}
                          </span>
                        )}
                        {isSelected && (
                          <div className="absolute inset-0 bg-blue-600/20 flex items-center justify-center">
                            <div className="w-8 h-8 rounded-full bg-blue-500/80 flex items-center justify-center text-white text-sm font-bold">▶</div>
                          </div>
                        )}
                        {!isSelected && (hoverId === item.bvid) && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-blue-600/90 flex items-center justify-center text-white text-xl">▶</div>
                          </div>
                        )}
                      </div>

                      {/* INFO */}
                      <div className="p-2 flex flex-col gap-0.5 flex-1">
                        <p className="text-[10px] text-slate-200 line-clamp-2 leading-tight font-medium" title={item.title}>
                          {translated[item.bvid] || item.title || '(Không có tiêu đề)'}
                        </p>
                        {item.author && (
                          <button onClick={e => { e.stopPropagation(); openChannel(item.mid, item.author); }}
                            className="text-left text-[9px] text-blue-400/70 hover:text-blue-300 truncate transition mt-0.5">
                            📺 @{item.author}
                          </button>
                        )}
                        {itemDl?.status === 'done' && (
                          <div className="mt-auto text-center text-[9px] text-green-400 font-bold">✅ Đã tải</div>
                        )}
                        {itemDl?.status === 'downloading' && (
                          <div className="mt-auto">
                            <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${itemDl.percent || 0}%` }}/>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {hasMore && !loading && (
              <div className="flex justify-center mt-4">
                <button onClick={() => search(keyword, page)}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition">
                  Tải thêm kết quả...
                </button>
              </div>
            )}
            {loading && results.length > 0 && (
              <div className="flex justify-center mt-4">
                <span className="text-slate-500 text-sm">⏳ Đang tải...</span>
              </div>
            )}
          </div>
        </div>

        {/* PREVIEW PANEL */}
        {selected && (
          <div className="w-[58%] flex flex-col bg-[#070b14] overflow-hidden">
            {/* Player */}
            <div className="relative w-full bg-black" style={{ aspectRatio: '16/9' }}>
              <iframe
                key={selected.bvid}
                src={`https://player.bilibili.com/player.html?bvid=${selected.bvid}&autoplay=1&danmaku=0&high_quality=1`}
                allowFullScreen allow="autoplay; fullscreen"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              />
              {/* Close & Fullscreen buttons */}
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button onClick={() => setFullscreen(selected)}
                  title="Toàn màn hình"
                  className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/90 flex items-center justify-center text-white text-xs transition">
                  ⛶
                </button>
                <button onClick={() => setSelected(null)}
                  title="Đóng xem trước"
                  className="w-7 h-7 rounded-full bg-black/60 hover:bg-red-700/90 flex items-center justify-center text-white text-xs transition">
                  ✕
                </button>
              </div>
            </div>

            {/* Info + Actions */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {/* Title */}
              <div>
                <div className="text-[13px] font-bold text-white leading-snug">
                  {translated[selected.bvid] || selected.title}
                </div>
                {translated[selected.bvid] && (
                  <div className="text-[10px] text-slate-500 mt-0.5 italic">{selected.title}</div>
                )}
              </div>

              {/* Meta */}
              <div className="flex flex-wrap gap-2">
                {selected.duration > 0 && (
                  <span className="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-300">
                    ⏱ {fmtDur(selected.duration)}
                  </span>
                )}
                {selected.play > 0 && (
                  <span className="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-300">
                    ▶ {fmtNum(selected.play)} lượt xem
                  </span>
                )}
                {selected.like > 0 && (
                  <span className="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-300">
                    👍 {fmtNum(selected.like)}
                  </span>
                )}
                {selected.author && (
                  <button onClick={() => openChannel(selected.mid, selected.author)}
                    className="px-2 py-0.5 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-700/40 rounded text-[11px] text-blue-300 transition">
                    📺 @{selected.author}
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-slate-700/40">
                {/* Thêm vào hàng đợi reup */}
                {onAddToQueue && (
                  <button onClick={() => onAddToQueue(selected)}
                    className="w-full py-2.5 rounded-xl text-[13px] font-black bg-pink-600 hover:bg-pink-500 text-white transition shadow-md shadow-pink-900/30 flex items-center justify-center gap-2">
                    ➕ Thêm vào hàng đợi Reup
                  </button>
                )}

                {/* Tải về */}
                <div className="flex gap-2">
                  <button onClick={pickFolder}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-[11px] font-bold text-slate-300 transition min-w-0 truncate flex-shrink-0">
                    📁 {outFolder ? outFolder.split(/[/\\]/).pop().slice(0, 16) + (outFolder.split(/[/\\]/).pop().length > 16 ? '…' : '') : 'Chọn thư mục'}
                  </button>
                  {!dl && (
                    <button onClick={() => download(selected)} disabled={!outFolder}
                      className="flex-1 py-2 rounded-lg text-[12px] font-black bg-blue-700 hover:bg-blue-600 disabled:opacity-30 disabled:cursor-not-allowed text-white transition flex items-center justify-center gap-1.5">
                      ⬇ Tải {quality === 'best' ? 'HD' : quality + 'p'}
                    </button>
                  )}
                  {dl?.status === 'downloading' && (
                    <div className="flex-1 flex flex-col justify-center gap-1">
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${dl.percent || 0}%` }}/>
                      </div>
                      <span className="text-[10px] text-slate-400 text-center">
                        {dl.percent ? `${dl.percent.toFixed(0)}%` : 'Đang bắt đầu...'}{dl.speed ? ` · ${dl.speed}` : ''}
                      </span>
                    </div>
                  )}
                  {dl?.status === 'done' && (
                    <div className="flex-1 flex gap-1.5">
                      <button onClick={() => API.openFile?.(dl.outputPath || outFolder)}
                        className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-green-800/60 hover:bg-green-700 text-green-300 transition">
                        ▶ Mở file
                      </button>
                      <button onClick={() => API.openFolder?.(outFolder)}
                        className="flex-1 py-2 rounded-lg text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                        📂 Thư mục
                      </button>
                    </div>
                  )}
                  {dl?.status === 'error' && (
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="text-[10px] text-red-400 truncate">❌ {dl.error || 'Lỗi tải'}</div>
                      <button onClick={() => { setDlQueue(q => { const n={...q}; delete n[selected.bvid]; return n; }); download(selected); }}
                        className="w-full py-1 rounded text-[10px] bg-red-900/50 hover:bg-red-800 transition">Thử lại</button>
                    </div>
                  )}
                </div>

                {/* Link gốc */}
                {selected.url && (
                  <a href={selected.url} target="_blank" rel="noreferrer"
                    className="text-center text-[10px] text-slate-600 hover:text-slate-400 transition underline underline-offset-2">
                    🔗 {selected.url.slice(0, 60)}{selected.url.length > 60 ? '…' : ''}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
