import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, CheckCircle, ShoppingBag, LogIn, FolderOpen, Plus, Trash2, RefreshCw, Search, X } from 'lucide-react';

const api = window.electronAPI;
const LS_ACCOUNTS = 'tiktok_accounts';
const LS_ROWS     = 'tiktok_plan_rows';

function loadAccounts() { try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS)) || []; } catch { return []; } }
function saveAccounts(list) { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(list)); }

// Per-account product storage
function lsKeyProds(accountId) { return accountId ? `tiktok_products_${accountId}` : 'tiktok_products'; }
function loadProductsFor(accountId) {
  try { return JSON.parse(localStorage.getItem(lsKeyProds(accountId))) || []; } catch { return []; }
}
function saveProductsFor(accountId, list) {
  localStorage.setItem(lsKeyProds(accountId), JSON.stringify(list));
}

function loadRows() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_ROWS)) || [];
    return r.map(x => ({ ...x, status: 'idle', log: '' }));
  } catch { return []; }
}
function saveRows(list) {
  localStorage.setItem(LS_ROWS, JSON.stringify(list.map(r => ({
    rowId: r.rowId, accountId: r.accountId, videoPath: r.videoPath,
    product: r.product, caption: r.caption || '',
    productDisplayName: r.productDisplayName || '',
    scheduledTime: r.scheduledTime || '',
  }))));
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export default function TikTokAutoPost() {
  const [activeTab, setActiveTab] = useState('plan');

  // Accounts
  const [accounts,     setAccounts]     = useState(() => loadAccounts());
  const [statuses,     setStatuses]     = useState({});
  const [newName,      setNewName]      = useState('');
  const [loginLoading, setLoginLoading] = useState(null);

  // Plan rows
  const [rows,         setRows]         = useState(() => loadRows());
  const [rowStatus,    setRowStatus]    = useState({});
  const [rowLog,       setRowLog]       = useState({});
  const [focusedRowId, setFocusedRowId] = useState(null);
  const rowsRef = useRef([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Product browser — per-account storage
  const [prodProfileId,  setProdProfileId]  = useState(() => {
    // Default: first logged-in account, or first account
    const accs = loadAccounts();
    return accs[0]?.id || '';
  });
  const [products,       setProducts]       = useState(() => {
    const accs = loadAccounts();
    return loadProductsFor(accs[0]?.id || '');
  });
  const [productSearch,  setProductSearch]  = useState('');
  const [loadingProds,   setLoadingProds]   = useState(false);
  const [productLog,     setProductLog]     = useState('');

  // Schedule
  const [scheduleOn,  setScheduleOn]  = useState(false);
  const [scheduleLog, setScheduleLog] = useState('');
  const scheduleRef  = useRef(null);
  const lastFiredRef = useRef({}); // { [rowId]: "HH:MM-DateString" } to avoid double-fire per row

  // Global log panel
  const [globalLogs,  setGlobalLogs]  = useState([]);
  const [logExpanded, setLogExpanded] = useState(true);
  const logEndRef = useRef(null);

  const addLog = useCallback((msg, profileId = '') => {
    const ts = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setGlobalLogs(prev => [...prev.slice(-300), { ts, msg, profileId }]);
  }, []);

  useEffect(() => {
    if (logExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [globalLogs, logExpanded]);

  // IPC logs
  useEffect(() => {
    const wLog = api?.onTikTokLog?.(({ profileId, msg }) => {
      const row = rowsRef.current.find(r => r.accountId === profileId);
      if (row) setRowLog(p => ({ ...p, [row.rowId]: msg }));
      setProductLog(msg);
      addLog(msg, profileId);
    });
    return () => { try { if (wLog) window.electronAPI?.removeListener?.('tiktok:log', wLog); } catch {} };
  }, [addLog]);

  useEffect(() => () => { if (scheduleRef.current) clearInterval(scheduleRef.current); }, []);

  // Auto-check login on mount
  useEffect(() => { accounts.forEach(acc => checkOne(acc.id)); }, []);

  // ── Account functions ──────────────────────────────────────────────────────
  const checkOne = async (id) => {
    setStatuses(p => ({ ...p, [id]: 'checking' }));
    const r = await api?.tiktokCheckLogin?.({ profileId: id });
    setStatuses(p => ({ ...p, [id]: r?.loggedIn ? 'ok' : 'no' }));
  };

  const addAccount = () => {
    const name = newName.trim() || `Kênh ${accounts.length + 1}`;
    const id = genId();
    const updated = [...accounts, { id, name }];
    setAccounts(updated); saveAccounts(updated); setNewName('');
    return id;
  };

  const removeAccount = (id) => {
    const updated = accounts.filter(a => a.id !== id);
    setAccounts(updated); saveAccounts(updated);
  };

  const handleLogin = async (id) => {
    setLoginLoading(id);
    await api?.tiktokOpenLogin?.({ profileId: id });
    setLoginLoading(null);
    await checkOne(id);
  };

  // ── Row functions ──────────────────────────────────────────────────────────
  const addRow = () => {
    const rowId = genId();
    const updated = [...rows, { rowId, accountId: '', videoPath: '', product: null, caption: '' }];
    setRows(updated); saveRows(updated); setFocusedRowId(rowId);
  };

  const removeRow = (rowId) => {
    const updated = rows.filter(r => r.rowId !== rowId);
    setRows(updated); saveRows(updated);
    if (focusedRowId === rowId) setFocusedRowId(updated[0]?.rowId || null);
  };

  const updateRow = (rowId, patch) => {
    setRows(prev => {
      const updated = prev.map(r => r.rowId === rowId ? { ...r, ...patch } : r);
      saveRows(updated);
      return updated;
    });
  };

  const assignProduct = (product) => {
    const targetId = focusedRowId || (rows.length === 1 ? rows[0].rowId : null);
    if (!targetId) return;
    if (!focusedRowId) setFocusedRowId(targetId);
    updateRow(targetId, {
      product,
      productDisplayName: (product.title || '').slice(0, 30),
    });
  };

  const postRow = async (row) => {
    if (!row.videoPath || !row.accountId) return;
    const accName = accounts.find(a => a.id === row.accountId)?.name || row.accountId;
    setRowStatus(p => ({ ...p, [row.rowId]: 'posting' }));
    setRowLog(p => ({ ...p, [row.rowId]: '⏳ Đang upload...' }));
    addLog(`▶ Bắt đầu đăng kênh "${accName}"`, row.accountId);
    if (row.product) addLog(`  🏷 Sản phẩm: ${(row.productDisplayName || row.product.title).slice(0,50)}`, row.accountId);
    const r = await api?.tiktokPostVideo?.({
      videoPath: row.videoPath,
      caption: row.caption || '',
      product: row.product ? {
        id:          row.product.id    || '',
        title:       row.product.title || '',
        displayName: row.productDisplayName || row.product.title || '',
      } : null,
      profileId: row.accountId,
    });
    const finalMsg = r?.ok ? '✅ Đã đăng thành công!' : `❌ ${r?.error || 'Lỗi không xác định'}`;
    setRowStatus(p => ({ ...p, [row.rowId]: r?.ok ? 'done' : 'error' }));
    setRowLog(p => ({ ...p, [row.rowId]: r?.ok ? '✅ Đã đăng!' : `❌ ${r?.error || 'Lỗi'}` }));
    addLog(finalMsg, row.accountId);
  };

  const postAll = async () => {
    const ready = rows.filter(r => r.videoPath && r.accountId && rowStatus[r.rowId] !== 'posting');
    await Promise.all(ready.map(r => postRow(r)));
  };

  // Reload products when switching account
  useEffect(() => {
    setProducts(loadProductsFor(prodProfileId));
    setProductLog('');
    setProductSearch('');
  }, [prodProfileId]);

  // ── Product management ─────────────────────────────────────────────────────
  const saveProducts = (list) => {
    saveProductsFor(prodProfileId, list);
    setProducts(list);
  };

  const removeProduct = (id) => saveProducts(products.filter(p => p.id !== id));

  const fetchProducts = async () => {
    const pid = prodProfileId || accounts.find(a => statuses[a.id] === 'ok')?.id;
    if (!pid) { setProductLog('❌ Cần đăng nhập ít nhất 1 kênh để tải'); return; }
    setLoadingProds(true);
    setProductLog('⏳ Đang upload video probe vào TikTok Studio (ẩn) để lấy danh sách...');
    const r = await api?.tiktokFetchProducts?.({ profileId: pid, keyword: productSearch });
    setLoadingProds(false);
    if (r?.ok && r.products?.length) {
      // REPLACE entirely — no merge with old/stale data
      saveProductsFor(pid, r.products);
      if (pid === prodProfileId) setProducts(r.products);
      setProductLog(`✅ Thêm ${r.products.length} sản phẩm mới (tổng ${r.products.length})`);
    } else {
      setProductLog(r?.error ? `❌ ${r.error}` : '⚠️ Không tải được từ TikTok — hãy thử lại');
    }
  };

  const filteredProducts = productSearch
    ? products.filter(p => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  // ── Schedule ───────────────────────────────────────────────────────────────
  const toggleSchedule = useCallback(() => {
    if (scheduleRef.current) {
      clearInterval(scheduleRef.current); scheduleRef.current = null;
      setScheduleOn(false); setScheduleLog('⏹ Đã tắt lịch'); return;
    }
    const hasScheduled = rowsRef.current.some(r => r.scheduledTime && r.videoPath && r.accountId);
    if (!hasScheduled) {
      setScheduleLog('❌ Không có dòng nào có giờ đăng — thiết lập giờ trong tab Kế hoạch'); return;
    }
    setScheduleOn(true);
    setScheduleLog('✅ Lịch đang chạy — kiểm tra mỗi phút');
    // Check every 15 seconds to avoid missing a minute due to timer drift
    scheduleRef.current = setInterval(() => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const dateKey = now.toDateString();
      const fired = lastFiredRef.current;
      const dueRows = rowsRef.current.filter(r =>
        r.scheduledTime === hhmm && r.videoPath && r.accountId &&
        fired[r.rowId] !== `${hhmm}-${dateKey}`
      );
      if (!dueRows.length) return;
      dueRows.forEach(r => { fired[r.rowId] = `${hhmm}-${dateKey}`; });
      setScheduleLog(`⏰ ${hhmm} — đăng ${dueRows.length} kênh...`);
      dueRows.forEach(row => postRow(row));
    }, 15000);
  }, [postRow]);

  // ── UI helpers ─────────────────────────────────────────────────────────────
  const StatusDot = ({ id }) => {
    const s = statuses[id];
    if (s === 'checking') return <Loader2 size={11} className="animate-spin text-slate-400 shrink-0"/>;
    if (s === 'ok')       return <CheckCircle size={11} className="text-green-400 shrink-0"/>;
    if (s === 'no')       return <AlertCircle size={11} className="text-red-400 shrink-0"/>;
    return <span className="w-2.5 h-2.5 rounded-full bg-slate-600 inline-block shrink-0"/>;
  };

  const focusedRow = rows.find(r => r.rowId === focusedRowId);
  const focusedAccName = accounts.find(a => a.id === focusedRow?.accountId)?.name;

  const TABS = [
    { id: 'plan',     label: '🗂 Kế hoạch' },
    { id: 'accounts', label: `👤 Kênh (${accounts.length})` },
    { id: 'auto',     label: '⏰ Tự động' },
    { id: 'guide',    label: '📖 Hướng dẫn' },
  ];

  return (
    <div className="flex flex-col w-full h-full bg-slate-950 text-white" style={{ fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-slate-800 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: 'linear-gradient(135deg,#010101,#fe2c55)' }}>🎵</div>
        <div>
          <div className="font-bold text-sm">TikTok Auto Post</div>
          <div className="text-xs text-slate-400">{accounts.length} kênh · mỗi kênh 1 video + 1 sản phẩm affiliate riêng</div>
        </div>
        <button onClick={() => accounts.forEach(acc => checkOne(acc.id))}
          className="ml-auto px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs flex items-center gap-1">
          <RefreshCw size={10}/> Kiểm tra
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-slate-800 flex-shrink-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeTab === t.id ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ═══════════════════ KẾ HOẠCH — SPLIT PANEL ═══════════════════ */}
        {activeTab === 'plan' && (
          <div className="flex h-full">

            {/* ─── LEFT: Channel rows ─── */}
            <div className="flex flex-col" style={{ width: '56%', borderRight: '1px solid #1e293b' }}>
              {/* Left header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 flex-shrink-0 bg-slate-950">
                <span className="text-xs font-bold text-slate-300">
                  📋 Kế hoạch đăng <span className="text-slate-600">({rows.length} dòng)</span>
                </span>
                <div className="flex gap-1.5">
                  <button onClick={addRow}
                    className="px-2 py-1 bg-pink-700 hover:bg-pink-600 rounded text-xs flex items-center gap-1">
                    <Plus size={11}/> Thêm
                  </button>
                  <button onClick={postAll}
                    disabled={!rows.some(r => r.videoPath && r.accountId)}
                    className="px-2 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded text-xs font-bold">
                    ▶ Đăng tất cả
                  </button>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="flex-1 flex items-center justify-center flex-col gap-2 text-slate-600">
                  <div className="text-4xl">📋</div>
                  <div className="text-sm">Chưa có dòng nào</div>
                  <div className="text-xs text-center px-4">Click "+ Thêm" để tạo dòng cho từng kênh cần đăng</div>
                  {accounts.length === 0 && (
                    <button onClick={() => setActiveTab('accounts')} className="mt-1 text-xs text-pink-400 underline">
                      Thêm tài khoản trước →
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto min-h-0">
                  {rows.map((row, idx) => {
                    const st  = rowStatus[row.rowId];
                    const log = rowLog[row.rowId] || '';
                    const isFocused = focusedRowId === row.rowId;

                    return (
                      <div key={row.rowId} onClick={() => setFocusedRowId(row.rowId)}
                        className={`border-b border-slate-800 p-3 cursor-pointer transition-all ${isFocused ? 'bg-pink-950/30' : 'hover:bg-slate-900/60'}`}
                        style={{ borderLeft: `3px solid ${isFocused ? '#ec4899' : 'transparent'}` }}>

                        {/* Row header: index + channel selector + status + delete */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-600 w-5 text-right shrink-0 font-mono">{idx + 1}</span>
                          <select value={row.accountId}
                            onChange={e => updateRow(row.rowId, { accountId: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white min-w-0 cursor-pointer">
                            <option value="">-- Chọn kênh --</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                          {row.accountId && <StatusDot id={row.accountId} />}
                          <button onClick={e => { e.stopPropagation(); removeRow(row.rowId); }}
                            className="p-1 text-slate-600 hover:text-red-400 shrink-0 rounded hover:bg-red-900/20">
                            <Trash2 size={11}/>
                          </button>
                        </div>

                        {/* Video picker */}
                        <div className="flex gap-1 mb-2">
                          <div className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs min-w-0 flex items-center gap-1.5">
                            {row.videoPath
                              ? <span className="text-white truncate">{row.videoPath.split(/[\\/]/).pop()}</span>
                              : <span className="text-slate-600">Chưa chọn video...</span>}
                          </div>
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            const f = await api?.selectFile?.({ filters: [{ name: 'Video', extensions: ['mp4','mov','avi','mkv'] }] });
                            if (f) updateRow(row.rowId, { videoPath: f });
                          }} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs shrink-0"
                            title="Chọn file video">
                            <FolderOpen size={12}/>
                          </button>
                        </div>

                        {/* Assigned product chip */}
                        <div className="mb-2 min-h-[26px] flex items-center">
                          {row.product ? (
                            <div className="flex items-center gap-1.5 bg-emerald-900/25 border border-emerald-700/40 rounded-md px-2 py-1 flex-1 min-w-0">
                              {row.product.img
                                ? <img src={row.product.img} alt="" className="w-5 h-5 rounded object-cover shrink-0"/>
                                : <ShoppingBag size={13} className="text-emerald-400 shrink-0"/>}
                              <span className="text-xs text-emerald-300 truncate flex-1">{row.product.title}</span>
                              {row.product.comm && <span className="text-xs text-yellow-400 shrink-0 font-medium">{row.product.comm}</span>}
                              <button onClick={e => { e.stopPropagation(); updateRow(row.rowId, { product: null }); }}
                                className="text-slate-500 hover:text-red-400 shrink-0 ml-1"><X size={10}/></button>
                            </div>
                          ) : (
                            <div className={`text-xs flex items-center gap-1 ${isFocused ? 'text-pink-400' : 'text-slate-600'}`}>
                              <ShoppingBag size={11}/>
                              {isFocused ? '← Click sản phẩm bên phải để gắn' : 'Chưa gắn sản phẩm affiliate'}
                            </div>
                          )}
                        </div>

                        {/* Product display name (only when product is assigned) */}
                        {row.product && (
                          <div className="mb-2">
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="text-xs text-slate-500">Tên trên video</span>
                              <span className="text-xs text-slate-600">(max 30 ký tự)</span>
                            </div>
                            <input
                              value={row.productDisplayName || ''}
                              maxLength={30}
                              onChange={e => { e.stopPropagation(); updateRow(row.rowId, { productDisplayName: e.target.value }); }}
                              onClick={e => e.stopPropagation()}
                              placeholder="Tên hiển thị trên video..."
                              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white placeholder-slate-600 outline-none focus:border-emerald-500"
                            />
                            <div className="text-right text-xs text-slate-600 mt-0.5">{(row.productDisplayName || '').length}/30</div>
                          </div>
                        )}

                        {/* Caption */}
                        <input value={row.caption || ''}
                          onChange={e => { e.stopPropagation(); updateRow(row.rowId, { caption: e.target.value }); }}
                          onClick={e => e.stopPropagation()}
                          placeholder="Caption / hashtag (tùy chọn)..."
                          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 mb-2 outline-none focus:border-pink-600"
                        />

                        {/* Scheduled time per row */}
                        <div className="flex items-center gap-2 mb-2" onClick={e => e.stopPropagation()}>
                          <span className="text-xs text-slate-500 shrink-0">⏰ Đăng lúc:</span>
                          <input
                            type="time"
                            value={row.scheduledTime || ''}
                            onChange={e => updateRow(row.rowId, { scheduledTime: e.target.value })}
                            className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white outline-none focus:border-pink-600 cursor-pointer"
                            title="Hẹn giờ tự động đăng cho kênh này"
                          />
                          {row.scheduledTime ? (
                            <span className="text-xs text-pink-400 font-mono font-bold">{row.scheduledTime}</span>
                          ) : (
                            <span className="text-xs text-slate-600">chưa đặt</span>
                          )}
                          {row.scheduledTime && (
                            <button onClick={() => updateRow(row.rowId, { scheduledTime: '' })}
                              className="text-slate-600 hover:text-red-400 shrink-0">
                              <X size={10}/>
                            </button>
                          )}
                        </div>

                        {/* Post button + log */}
                        <div className="flex items-center gap-2">
                          <button onClick={e => { e.stopPropagation(); postRow(row); }}
                            disabled={!row.videoPath || !row.accountId || st === 'posting'}
                            className={`px-3 py-1 rounded text-xs font-bold text-white disabled:opacity-40 shrink-0 transition-colors ${st === 'done' ? 'bg-green-700' : st === 'error' ? 'bg-red-700' : 'bg-pink-700 hover:bg-pink-600'}`}>
                            {st === 'posting'
                              ? <Loader2 size={11} className="animate-spin"/>
                              : st === 'done' ? '✅ Xong' : st === 'error' ? '❌ Lỗi' : '📤 Đăng'}
                          </button>
                          {log && (
                            <span className={`text-xs truncate ${log.startsWith('✅') ? 'text-green-400' : log.startsWith('❌') ? 'text-red-400' : 'text-slate-400'}`}>
                              {log}
                            </span>
                          )}
                          {st === 'error' && (
                            <button onClick={e => { e.stopPropagation(); setRowStatus(p => ({ ...p, [row.rowId]: 'idle' })); setRowLog(p => ({ ...p, [row.rowId]: '' })); }}
                              className="ml-auto text-xs text-slate-500 hover:text-slate-300 shrink-0">
                              <RefreshCw size={10}/>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ─── RIGHT: Product browser ─── */}
            <div className="flex flex-col" style={{ width: '44%' }}>
              {/* Right header */}
              <div className="px-3 pt-2 pb-2 border-b border-slate-800 flex-shrink-0 bg-slate-950">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-300">🛍 Sản phẩm TikTok Affiliate</span>
                  {products.length > 0 && <span className="text-xs text-slate-500">{products.length} sản phẩm</span>}
                </div>

                {/* Profile selector — each account has its own product list */}
                <select value={prodProfileId}
                  onChange={e => setProdProfileId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white mb-2">
                  {accounts.length === 0 && <option value="">-- Chưa có kênh nào --</option>}
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{statuses[a.id] === 'ok' ? ' ✓' : ''}</option>
                  ))}
                </select>

                <div className="flex gap-1">
                  <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder="Lọc sản phẩm..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white min-w-0 placeholder-slate-600 outline-none focus:border-pink-600" />
                  <button onClick={fetchProducts} disabled={loadingProds}
                    title="Upload 1 video probe 4s lên TikTok Studio (headless) để lấy danh sách sản phẩm affiliate → lưu bản nháp"
                    className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-xs shrink-0 flex items-center gap-1 whitespace-nowrap">
                    {loadingProds ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>}
                    {!loadingProds && <span>Lấy từ TK</span>}
                  </button>
                </div>

                {productLog && (
                  <div className={`mt-1.5 text-xs ${productLog.startsWith('✅') ? 'text-green-400' : productLog.startsWith('❌') ? 'text-red-400' : 'text-slate-400'}`}>
                    {productLog}
                  </div>
                )}

                {/* Focused row hint */}
                {focusedRowId ? (
                  <div className="mt-1.5 text-xs text-pink-400 flex items-center gap-1">
                    <span>→ Gắn vào:</span>
                    <span className="font-bold">{focusedAccName || `dòng #${rows.findIndex(r => r.rowId === focusedRowId) + 1}`}</span>
                  </div>
                ) : rows.length > 0 ? (
                  <div className="mt-1.5 text-xs text-slate-600">← Click 1 dòng bên trái để chọn kênh nhận sản phẩm</div>
                ) : null}
              </div>

              {/* Product grid */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-600 gap-2 px-4">
                    <ShoppingBag size={28}/>
                    <div className="text-xs text-center leading-relaxed">
                      Chưa có sản phẩm nào.<br/>
                      <span className="text-slate-500">➕ Thêm thủ công</span> hoặc <span className="text-slate-500">Tải từ TikTok</span>
                    </div>
                    <div className="text-xs text-slate-700 text-center mt-1">
                      Sau khi thêm, click sản phẩm để gắn vào kênh đang chọn bên trái
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-2">
                    {filteredProducts.map(p => {
                      const alreadyUsed = rows.some(r => r.product?.id === p.id);
                      return (
                        <div key={p.id} className="relative group">
                          <button onClick={() => assignProduct(p)}
                            className={`w-full bg-slate-900 border rounded-lg overflow-hidden text-left transition-all ${alreadyUsed ? 'border-emerald-700/50' : 'border-slate-700 hover:border-pink-500'}`}>
                            {/* Product image */}
                            <div className="w-full bg-slate-800 overflow-hidden" style={{ aspectRatio: '1' }}>
                              {p.img
                                ? <img src={p.img} alt={p.title} className="w-full h-full object-cover"/>
                                : <div className="w-full h-full flex items-center justify-center text-3xl">📦</div>}
                            </div>
                            <div className="p-2">
                              <div className="text-xs text-white mb-1 line-clamp-2 leading-relaxed">{p.title}</div>
                              <div className="flex items-center gap-1 flex-wrap">
                                {p.price && <span className="text-xs text-orange-400">{p.price}</span>}
                                {p.comm && <span className="text-xs text-yellow-400 font-medium ml-auto">{p.comm}</span>}
                              </div>
                              {alreadyUsed && <div className="text-xs text-emerald-400 mt-0.5">✓ đã gắn</div>}
                              {p.manual && <div className="text-xs text-slate-600 mt-0.5">✎ thủ công</div>}
                            </div>
                          </button>
                          {/* Delete button */}
                          <button onClick={() => removeProduct(p.id)}
                            className="absolute top-1 right-1 w-5 h-5 rounded bg-red-900/80 text-red-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={9}/>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════ TÀI KHOẢN ═══════════════════ */}
        {activeTab === 'accounts' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-lg mx-auto space-y-4">
              <div className="flex gap-2">
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addAccount()}
                  placeholder="Tên kênh (ví dụ: Kênh Bếp, Shop Inox...)"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-pink-500 outline-none" />
                <button onClick={addAccount}
                  className="px-3 py-2 bg-pink-600 hover:bg-pink-500 rounded text-xs font-bold text-white flex items-center gap-1">
                  <Plus size={12}/> Thêm
                </button>
              </div>

              {accounts.length === 0 && (
                <div className="text-center py-12 text-slate-600">
                  <div className="text-3xl mb-2">🎵</div>
                  <div className="text-sm">Chưa có tài khoản nào</div>
                  <div className="text-xs mt-1">Nhập tên kênh và click Thêm</div>
                </div>
              )}

              {accounts.map(acc => (
                <div key={acc.id} className="bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusDot id={acc.id} />
                    <span className="font-medium text-sm flex-1">{acc.name}</span>
                    <button onClick={() => checkOne(acc.id)} className="p-1 text-slate-500 hover:text-slate-300 rounded">
                      <RefreshCw size={11}/>
                    </button>
                    <button onClick={() => removeAccount(acc.id)} className="p-1 text-slate-500 hover:text-red-400 rounded">
                      <Trash2 size={11}/>
                    </button>
                  </div>
                  {statuses[acc.id] === 'ok'
                    ? <div className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={10}/> Đã đăng nhập — sẵn sàng đăng bài</div>
                    : statuses[acc.id] === 'no'
                    ? <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={10}/> Chưa đăng nhập</div>
                    : null}
                  <button onClick={() => handleLogin(acc.id)} disabled={loginLoading === acc.id}
                    className="w-full py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#be185d,#9d174d)' }}>
                    {loginLoading === acc.id
                      ? <><Loader2 size={11} className="animate-spin"/> Đang mở trình duyệt...</>
                      : <><LogIn size={11}/> {statuses[acc.id] === 'ok' ? 'Đăng nhập lại / Đổi TK' : 'Đăng nhập TikTok'}</>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════ TỰ ĐỘNG ═══════════════════ */}
        {activeTab === 'auto' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-xl mx-auto space-y-4">

              {/* Plan preview */}
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
                  <span>📋 Kế hoạch sẽ đăng ({rows.filter(r => r.videoPath && r.accountId).length} kênh sẵn sàng)</span>
                  <button onClick={() => setActiveTab('plan')} className="text-pink-400 hover:text-pink-300 text-xs">Sửa kế hoạch →</button>
                </div>
                {rows.filter(r => r.accountId).length === 0 ? (
                  <div className="text-xs text-slate-600 py-2 text-center">Chưa có kênh nào trong Kế hoạch</div>
                ) : (
                  <div className="space-y-1.5">
                    {rows.filter(r => r.accountId).map(row => {
                      const acc = accounts.find(a => a.id === row.accountId);
                      const ready = !!(row.videoPath);
                      return (
                        <div key={row.rowId} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${ready ? 'bg-slate-800/60' : 'bg-red-900/10 border border-red-800/30'}`}>
                          <StatusDot id={row.accountId}/>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-200">{acc?.name || row.accountId}</div>
                            {row.videoPath
                              ? <div className="text-slate-500 truncate">{row.videoPath.split(/[/\\]/).pop()}</div>
                              : <div className="text-red-400">⚠ Chưa chọn video</div>
                            }
                            {row.product && <div className="text-emerald-400 truncate">🏷 {(row.productDisplayName || row.product.title).slice(0,40)}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Per-row schedule summary */}
              <div className="bg-slate-900 border border-pink-800/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">⏰ Lịch hẹn giờ</span>
                  {scheduleOn && <span className="text-xs text-yellow-300 animate-pulse">● Đang theo dõi</span>}
                </div>

                {/* Per-row time summary */}
                {rows.filter(r => r.accountId).length === 0 ? (
                  <div className="text-xs text-slate-600 text-center py-2">Chưa có kênh nào — thêm kênh trong tab Kế hoạch</div>
                ) : (
                  <div className="space-y-1.5">
                    {rows.filter(r => r.accountId).map(row => {
                      const acc = accounts.find(a => a.id === row.accountId);
                      return (
                        <div key={row.rowId} className="flex items-center justify-between text-xs bg-slate-800/60 rounded px-3 py-1.5">
                          <span className="text-slate-300 font-medium truncate max-w-[140px]">{acc?.name || row.accountId}</span>
                          {row.scheduledTime
                            ? <span className="font-mono font-bold text-pink-400">{row.scheduledTime}</span>
                            : <span className="text-slate-600 italic">chưa đặt giờ</span>
                          }
                        </div>
                      );
                    })}
                  </div>
                )}

                {rows.filter(r => r.accountId && r.scheduledTime).length === 0 && rows.filter(r => r.accountId).length > 0 && (
                  <div className="text-xs text-amber-500/80 text-center">⚠ Chưa kênh nào đặt giờ — thiết lập trong tab Kế hoạch</div>
                )}

                <button onClick={toggleSchedule}
                  className={`w-full py-2.5 rounded-lg font-bold text-sm text-white transition-colors ${scheduleOn ? 'bg-red-700 hover:bg-red-600' : 'bg-pink-600 hover:bg-pink-500'}`}>
                  {scheduleOn ? '⏹ Tắt lịch' : '▶ Bật lịch hẹn giờ'}
                </button>

                {scheduleLog && (
                  <div className={`text-xs font-mono p-2 rounded ${scheduleLog.startsWith('✅') ? 'bg-green-900/30 text-green-300' : scheduleLog.startsWith('❌') ? 'bg-red-900/30 text-red-300' : scheduleLog.startsWith('⚠') ? 'bg-yellow-900/20 text-yellow-300' : 'bg-slate-800 text-slate-300'}`}>
                    {scheduleLog}
                  </div>
                )}

                <div className="text-xs text-slate-600 leading-relaxed">
                  Mỗi kênh có giờ đăng riêng — thiết lập trong tab <strong>Kế hoạch</strong>. App phải đang mở.
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ═══════════════════ HƯỚNG DẪN ═══════════════════ */}
        {activeTab === 'guide' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-2xl mx-auto space-y-4 text-sm">
              <div className="bg-gradient-to-r from-pink-900/30 to-slate-900 border border-pink-700/40 rounded-xl p-4">
                <h2 className="font-bold text-base mb-1">🎵 TikTok Multi-Channel Affiliate Planner</h2>
                <p className="text-slate-400 text-xs">Mỗi kênh 1 video riêng + 1 sản phẩm affiliate riêng. Đăng đồng thời, chạy ẩn. Không cần API key.</p>
              </div>
              {[
                { title: 'Bước 1 — Thêm kênh TikTok', steps: [
                  'Vào tab "Kênh" → nhập tên kênh → click Thêm',
                  'Có thể thêm nhiều kênh (Kênh Bếp, Shop Inox, Kênh Review...)',
                  'Click "Đăng nhập TikTok" cho từng kênh',
                  'Trình duyệt mở → đăng nhập đúng tài khoản → đóng cửa sổ',
                  'Phiên đăng nhập lưu riêng từng kênh, không bị ghi đè',
                ]},
                { title: 'Bước 2 — Lên kế hoạch (tab Kế hoạch)', steps: [
                  'Click "+ Thêm" để tạo dòng cho từng kênh cần đăng',
                  'Mỗi dòng: chọn kênh → chọn file video → nhập caption',
                  'Để gắn sản phẩm affiliate: click vào dòng → tìm sản phẩm bên phải → click sản phẩm',
                  'Sản phẩm được gắn riêng cho từng kênh/dòng',
                ]},
                { title: 'Bước 3 — Tải sản phẩm TikTok Affiliate', steps: [
                  'Bên phải: chọn kênh đã đăng nhập → (tùy chọn) nhập từ khóa → click Tải',
                  'Browser chạy ẩn (headless) — không hiện cửa sổ, tự lấy dữ liệu',
                  'Sản phẩm hiển thị dưới dạng lưới trong Fluxy',
                  'Click sản phẩm → gắn ngay vào kênh đang chọn bên trái',
                ]},
                { title: 'Bước 4 — Đăng bài', steps: [
                  'Click "📤 Đăng" từng dòng — HOẶC — "▶ Đăng tất cả" để đăng đồng thời',
                  'App tự upload video + điền caption + gắn sản phẩm + bấm Post (headless)',
                  'Log trạng thái hiển thị trực tiếp trên từng dòng',
                  'Tab "Tự động": đặt lịch đăng theo giờ từ 1 thư mục',
                ]},
              ].map(({ title, steps }) => (
                <div key={title} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-2">
                  <h3 className="font-bold text-pink-400">{title}</h3>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300 text-xs">
                    {steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ═══════════════════ GLOBAL LOG PANEL ═══════════════════ */}
      <div className="flex-shrink-0 border-t border-slate-800 bg-slate-950"
           style={{ height: logExpanded ? 148 : 28 }}>
        {/* Header bar — click to toggle */}
        <div className="flex items-center gap-2 px-3 border-b border-slate-800 cursor-pointer select-none"
             style={{ height: 28 }}
             onClick={() => setLogExpanded(e => !e)}>
          <span className="text-xs font-mono font-bold text-slate-400">📋 Log</span>
          {globalLogs.length > 0 && (
            <span className="text-xs text-slate-600">{globalLogs.length} dòng</span>
          )}
          {globalLogs.length > 0 && (
            <button
              className="ml-1 text-xs text-slate-600 hover:text-red-400 transition-colors"
              onClick={e => { e.stopPropagation(); setGlobalLogs([]); }}
              title="Xóa log">
              Xóa
            </button>
          )}
          <span className="ml-auto text-slate-600 text-xs">{logExpanded ? '▼' : '▲'}</span>
        </div>

        {/* Log lines */}
        {logExpanded && (
          <div className="overflow-y-auto font-mono" style={{ height: 120, background: '#060d18' }}>
            {globalLogs.length === 0 ? (
              <div className="text-slate-700 text-xs px-3 py-2">Chưa có hoạt động nào...</div>
            ) : (
              globalLogs.map((entry, i) => {
                const accName = accounts.find(a => a.id === entry.profileId)?.name;
                const m = entry.msg;
                const color = m.startsWith('✅') ? '#4ade80'
                  : m.startsWith('❌') ? '#f87171'
                  : m.startsWith('⚠') ? '#facc15'
                  : m.startsWith('⏳') || m.startsWith('▶') ? '#94a3b8'
                  : '#64748b';
                return (
                  <div key={i} className="flex gap-2 px-3 hover:bg-slate-800/30 leading-5"
                       style={{ fontSize: 11 }}>
                    <span className="text-slate-700 shrink-0 tabular-nums">{entry.ts}</span>
                    {accName && (
                      <span className="shrink-0" style={{ color: '#db2777', opacity: 0.75 }}>[{accName}]</span>
                    )}
                    <span className="flex-1 break-all" style={{ color }}>{m}</span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef}/>
          </div>
        )}
      </div>
    </div>
  );
}
