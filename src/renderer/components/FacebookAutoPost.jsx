import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ExternalLink, Copy, CheckCircle, XCircle, Loader2,
  ChevronRight, ChevronDown, RefreshCw, Upload, Clock, Trash2,
  FolderOpen, Plus, PlayCircle, StopCircle, SkipForward,
  GripVertical, AlertCircle, Sparkles, Wand2,
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation.js';

const api = window.electronAPI;

const LS_GEMINI_KEYS    = 'fluxy_gemini_api_keys';
const LS_FB_GEMINI_MODEL = 'fluxy_fb_gemini_model';
const FB_GEMINI_MODELS  = [
  { id: 'gemini-3.5-flash',       label: '3.5 Flash' },
  { id: 'gemini-3-flash-preview', label: '3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite',  label: '3.1 Flash Lite' },
];
const DEFAULT_CAPTION_MODEL = 'gemini-3.5-flash';

function getGeminiKeys() {
  try { return JSON.parse(localStorage.getItem(LS_GEMINI_KEYS) || '[]'); } catch { return []; }
}

// objects: comma-separated e.g. "sheep, duck, hen"
// style: 'eyes-challenge' | 'viral' | 'auto'
async function generateFbCaption(videoName, { pageTheme, objects, style = 'auto', lang = 'vi', model } = {}) {
  const keys = getGeminiKeys();
  if (!keys.length) throw new Error('Chưa có Gemini API Key. Vào Settings → Gemini API để thêm.');

  let objList = (objects || '').split(',').map(s => s.trim()).filter(Boolean);
  const isEyes  = style === 'eyes-challenge';

  // Nếu objects trống mà tên file là EyesChallenge_<animals>_<timestamp>, đọc tên con vật từ filename
  if (isEyes && objList.length === 0) {
    const baseName = videoName.replace(/\.[^.]+$/, '');  // bỏ đuôi .mp4
    const m = baseName.match(/^EyesChallenge_(.+?)_\d{10,}$/i);
    if (m) {
      const parsed = m[1].split('_').map(s => s.replace(/-/g, ' ').trim()).filter(Boolean);
      if (parsed.length >= 2) objList = parsed;
    }
  }

  let prompt;

  if (isEyes) {
    if (objList.length > 0) {
      // Objects provided — build exact caption
      const effectiveObjs = objList;
      let itemStr;
      if (effectiveObjs.length === 1) itemStr = effectiveObjs[0];
      else if (effectiveObjs.length === 2) itemStr = `${effectiveObjs[0]} & ${effectiveObjs[1]}`;
      else itemStr = effectiveObjs.slice(0, -1).join(', ') + ' & ' + effectiveObjs[effectiveObjs.length - 1];
      const objTags = effectiveObjs.map(o => '#' + o.toLowerCase().replace(/\s+/g, '')).join(' ');

      prompt = `Tạo tiêu đề Facebook Reels viral cho video Eyes Challenge.
Các vật/con vật trong video: ${effectiveObjs.join(', ')}

Dùng ĐÚNG format:
- "Match the sheep & hen with their perfect shadow ✅ #fblifestyle #sheep #puzzle ｜ Eyes Challenges"
- "Fanta, duck, icecream & pigeon with their perfect shadow ✅ #fblifestyle #pigeon #puzzle ｜ Eyes Challenges"

Quy tắc:
- 2 vật: "Match the [A] & [B] with their perfect shadow ✅"
- 3+ vật: "[A], [B] & [C] with their perfect shadow ✅" (bỏ "Match the")
- Kết thúc: "#fblifestyle ${objTags} #puzzle ｜ Eyes Challenges"

Trả về JSON: {"caption": "..."}`;
    } else {
      // No objects — AI picks random unique ones each time
      prompt = `Tạo tiêu đề Facebook Reels viral cho video Eyes Challenge.
KHÔNG có vật/con vật cụ thể. Hãy TỰ CHỌN 2-3 con vật/đồ vật thú vị, NGẪU NHIÊN, KHÔNG lặp lại các ví dụ.

Ví dụ format (chỉ tham khảo cấu trúc, phải chọn vật KHÁC):
- "Match the sheep & hen with their perfect shadow ✅ #fblifestyle #sheep #puzzle ｜ Eyes Challenges"
- "Match the duck & crab with their perfect shadow ✅ #fblifestyle #duck #puzzle ｜ Eyes Challenges"
- "Fanta, pizza & parrot with their perfect shadow ✅ #fblifestyle #parrot #puzzle ｜ Eyes Challenges"
- "Match the penguin & flamingo with their perfect shadow ✅ #fblifestyle #penguin #puzzle ｜ Eyes Challenges"

Quy tắc:
- Chọn 2 vật: "Match the [A] & [B] with their perfect shadow ✅ #fblifestyle #[A] #puzzle ｜ Eyes Challenges"
- Chọn 3+ vật: "[A], [B] & [C] with their perfect shadow ✅ #fblifestyle #[C] #puzzle ｜ Eyes Challenges"
- PHẢI chọn vật khác nhau mỗi lần, không dùng sheep, hen, duck, animal, object

Trả về JSON: {"caption": "..."}`;
    }
  } else {
    const langHint = lang === 'vi' ? 'tiếng Việt' : 'English';
    prompt = `Generate viral Facebook Reels caption for page: "${pageTheme || 'entertainment page'}".
Video file: "${videoName}"

Requirements:
- 2-4 engaging opening lines (curiosity or strong emotion)
- Relevant emojis
- 5-10 trending hashtags
- 1 CTA (tag friends / comment / follow)
- Language: ${langHint}
- Return ONLY the caption text, no explanation

JSON: {"caption": "..."}`;
  }

  // Thêm chỉ dẫn rõ ràng: chỉ trả về caption, không giải thích
  const finalPrompt = prompt + '\n\nQUAN TRỌNG: Chỉ trả về đúng chuỗi JSON {"caption": "..."}, không có gì khác.';

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const r  = await ai.models.generateContent({
      model   : model || DEFAULT_CAPTION_MODEL,
      contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
      config  : { maxOutputTokens: 800 },
    });
    const text = (r?.text || r?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '').trim();

    // Thử parse JSON trước
    try {
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const obj = JSON.parse(jsonStr);
        if (obj.caption) return obj.caption;
      }
    } catch { /* fallthrough */ }

    // Fallback: extract nội dung sau "caption": "
    const m = text.match(/"caption"\s*:\s*"([\s\S]*)/);
    if (m) {
      return m[1]
        .replace(/"\s*\}[\s\S]*$/, '')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .trim();
    }

    // Last resort: trả về thẳng text (strip code fence)
    return text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  }, keys);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Step({ n, title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700 rounded-xl mb-3 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700/80 text-left">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{n}</span>
        <span className="font-semibold text-white flex-1">{title}</span>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {open && <div className="px-4 py-3 bg-slate-900/50 text-sm text-slate-300 space-y-2">{children}</div>}
    </div>
  );
}

function ExtLink({ href, children }) {
  return (
    <button onClick={() => api.openExternal(href)}
      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2">
      {children} <ExternalLink size={11} />
    </button>
  );
}

function Mono({ children, onClick }) {
  const [copied, setCopied] = useState(false);
  return (
    <span onClick={() => { navigator.clipboard.writeText(children).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); onClick?.(); }}
      className="inline-flex items-center gap-1 font-mono bg-slate-800 border border-slate-600 px-2 py-0.5 rounded text-yellow-300 text-xs cursor-pointer hover:bg-slate-700">
      {children}
      {copied ? <CheckCircle size={10} className="text-green-400" /> : <Copy size={10} className="text-slate-400" />}
    </span>
  );
}

function basename(p) { return (p || '').replace(/\\/g, '/').split('/').pop(); }

function fmtTime(ms) {
  if (ms <= 0) return '0 phút';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}p`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FacebookAutoPost() {
  const [activeTab, setActiveTab] = useState('guide');

  // Auth — single page (dùng cho manual post + fallback)
  const [pageToken,   setPageToken]   = useState('');
  const [pageId,      setPageId]      = useState('');
  const [pageName,    setPageName]    = useState('');
  const [tokenInfo,   setTokenInfo]   = useState(null);
  const [tokenStatus, setTokenStatus] = useState(null);
  const [userToken,   setUserToken]   = useState('');

  // OAuth login
  const [fbAppId,      setFbAppId]      = useState('');
  const [fbAppSecret,  setFbAppSecret]  = useState('');
  const [showSecret,   setShowSecret]   = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  // Multi-page (round-robin auto-post)
  const [pages,        setPages]        = useState([]); // [{id, name, pageId, token}]
  const [newPageName,  setNewPageName]  = useState('');
  const [newPageId,    setNewPageId]    = useState('');
  const [newPageToken, setNewPageToken] = useState('');

  // Manual post
  const [videoPath,        setVideoPath]        = useState('');
  const [caption,          setCaption]          = useState('');
  const [manualProductLink,setManualProductLink] = useState('');
  const [posting,          setPosting]           = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [postResult, setPostResult] = useState(null);

  // One-time scheduled jobs
  const [scheduledJobs,   setScheduledJobs]   = useState(() => { try { return JSON.parse(localStorage.getItem('fluxy_fb_scheduled_jobs') || '[]'); } catch { return []; } });
  const [newJobVideo,     setNewJobVideo]      = useState('');
  const [newJobCaption,   setNewJobCaption]    = useState('');
  const [newJobTime,      setNewJobTime]       = useState('');
  const scheduledJobsRef  = useRef([]);

  // Queue & schedule
  const [queue,           setQueue]           = useState([]); // [{id, path, caption, status:'pending'|'done'|'error'}]
  const [intervalH,       setIntervalH]       = useState(6);
  const [scheduleRunning, setScheduleRunning] = useState(false);
  const [nextPostAt,      setNextPostAt]      = useState(null); // timestamp ms
  const [countdown,       setCountdown]       = useState('');
  const [history,         setHistory]         = useState([]);

  // AI caption
  const [pageTheme,    setPageTheme]    = useState('');
  const [captionStyle, setCaptionStyle] = useState('auto'); // 'auto'|'eyes-challenge'|'viral'
  const [captionLang,  setCaptionLang]  = useState('vi');
  const [captionModel, setCaptionModel] = useState(() => {
    try { return localStorage.getItem(LS_FB_GEMINI_MODEL) || DEFAULT_CAPTION_MODEL; } catch { return DEFAULT_CAPTION_MODEL; }
  });
  const [generating,   setGenerating]   = useState({}); // { [id]: true }

  const scheduleRef           = useRef(null);
  const countdownRef          = useRef(null);
  const logRef                = useRef(null);
  const queueRef              = useRef([]);
  const pagesRef              = useRef([]);
  const pageRoundRobinRef     = useRef(0);
  const postNextInQueueRef    = useRef(null); // trỏ tới postNextInQueue sau khi mount
  const [logs, setLogs] = useState([]);

  // Folder-mode auto-post (không cần queue thủ công)
  const [folderMode,        setFolderMode]        = useState(false);
  const [folderPath,        setFolderPath]        = useState(() => { try { return localStorage.getItem('fluxy_fb_folder_path') || ''; } catch { return ''; } });
  const [folderIntervalH,   setFolderIntervalH]   = useState(() => { try { return Number(localStorage.getItem('fluxy_fb_folder_interval_h')) || 6; } catch { return 6; } });
  const [folderSchedMode,   setFolderSchedMode]   = useState(() => { try { return localStorage.getItem('fluxy_fb_folder_sched_mode') || 'interval'; } catch { return 'interval'; } });
  const [folderFixedHours,  setFolderFixedHours]  = useState(() => { try { return localStorage.getItem('fluxy_fb_folder_fixed_hours') || '12,18'; } catch { return '12,18'; } });
  const [folderAutoOn,      setFolderAutoOn]      = useState(false);
  const folderAutoResumeRef = useRef(false); // flag: cần auto-resume sau khi mount
  const [folderNextAt,      setFolderNextAt]      = useState(null);
  const [folderDeleteAfterPost, setFolderDeleteAfterPost] = useState(() => {
    try { return localStorage.getItem('fluxy_fb_folder_delete') === 'true'; } catch { return false; }
  });
  const [folderLog,         setFolderLog]         = useState('');
  const folderAutoRef       = useRef(null);
  const folderIndexRef      = useRef(0); // round-robin index

  // Keep refs in sync
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);

  // Persist folder-mode settings to localStorage
  useEffect(() => { try { localStorage.setItem('fluxy_fb_folder_path', folderPath); } catch {} }, [folderPath]);
  useEffect(() => { try { localStorage.setItem('fluxy_fb_folder_interval_h', String(folderIntervalH)); } catch {} }, [folderIntervalH]);
  useEffect(() => { try { localStorage.setItem('fluxy_fb_folder_auto_on', folderAutoOn ? 'true' : 'false'); } catch {} }, [folderAutoOn]);

  // ── Load saved state ──────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.getSetting('fb_page_token',    ''),
      api.getSetting('fb_page_id',       ''),
      api.getSetting('fb_page_name',     ''),
      api.getSetting('fb_queue',         '[]'),
      api.getSetting('fb_interval_h',    '6'),
      api.getSetting('fb_history',       '[]'),
      api.getSetting('fb_page_theme',    ''),
      api.getSetting('fb_caption_style', 'auto'),
      api.getSetting('fb_caption_lang',  'vi'),
      api.getSetting('fb_pages',            '[]'),
      api.getSetting('fb_schedule_active',   'false'),
      api.getSetting('fb_schedule_next_at',  '0'),
      api.getSetting('fb_app_id',            ''),
      api.getSetting('fb_app_secret',        ''),
    ]).then(([pt, pid, pname, q, ih, hist, theme, cstyle, clang, pagesJson, schedActive, schedNextAt, appId, appSecret]) => {
      if (appId)     setFbAppId(appId);
      if (appSecret) setFbAppSecret(appSecret);
      if (pt)     setPageToken(pt);
      if (pid)    setPageId(pid);
      if (pname)  setPageName(pname);
      if (theme)  setPageTheme(theme);
      if (cstyle) setCaptionStyle(cstyle);
      if (clang)  setCaptionLang(clang);
      let loadedPages = [];
      try {
        loadedPages = JSON.parse(pagesJson);
        if (loadedPages.length > 0) {
          setPages(loadedPages);
        } else if (pt && pid) {
          const migrated = [{ id: Date.now().toString(), name: pname || 'Page 1', pageId: pid, token: pt }];
          loadedPages = migrated;
          setPages(migrated);
          api.setSetting('fb_pages', JSON.stringify(migrated));
        }
      } catch {}
      let loadedQueue = [];
      try {
        const loaded = JSON.parse(q);
        // Reset items bị kẹt ở 'posting' (do app crash/đóng giữa chừng) → 'pending'
        loadedQueue = loaded.map(i => i.status === 'posting' ? { ...i, status: 'pending', errorMsg: '' } : i);
        setQueue(loadedQueue);
        saveQueue(loadedQueue);
      } catch {}
      try { setHistory(JSON.parse(hist)); } catch {}
      const loadedIntervalH = Number(ih) || 6;
      setIntervalH(loadedIntervalH);

      // ── Auto-resume schedule nếu đang active trước khi app tắt ────────────
      if (schedActive === 'true') {
        const nextAt   = Number(schedNextAt) || 0;
        const msLeft   = nextAt - Date.now();
        const hasPending = loadedQueue.some(i => i.status === 'pending');
        const hasAuth    = loadedPages.length > 0 || (pt && pid);
        if (hasPending && hasAuth) {
          const ms = loadedIntervalH * 60 * 60 * 1000;
          // Dùng setTimeout để state React kịp set trước khi chạy
          setTimeout(() => {
            setScheduleRunning(true);
            addLog(`♻️ Khôi phục auto-post (còn ${msLeft > 0 ? Math.ceil(msLeft / 60000) + ' phút' : 'đã quá hạn'})`);
            if (msLeft <= 0) {
              // Đã quá hạn → đăng ngay
              postNextInQueueRef.current?.();
              const nxt = Date.now() + ms;
              setNextPostAt(nxt);
              api.setSetting('fb_schedule_next_at', String(nxt));
              scheduleRef.current = setInterval(() => {
                postNextInQueueRef.current?.();
                const n2 = Date.now() + ms;
                setNextPostAt(n2);
                api.setSetting('fb_schedule_next_at', String(n2));
              }, ms);
            } else {
              // Còn thời gian → chờ đúng thời điểm
              setNextPostAt(nextAt);
              const tid = setTimeout(() => {
                postNextInQueueRef.current?.();
                const nxt2 = Date.now() + ms;
                setNextPostAt(nxt2);
                api.setSetting('fb_schedule_next_at', String(nxt2));
                scheduleRef.current = setInterval(() => {
                  postNextInQueueRef.current?.();
                  const n3 = Date.now() + ms;
                  setNextPostAt(n3);
                  api.setSetting('fb_schedule_next_at', String(n3));
                }, ms);
              }, msLeft);
              scheduleRef.current = tid; // gán tạm để stopSchedule có thể clear
            }
          }, 800);
        } else {
          // Không còn pending hoặc chưa có auth → xóa state
          api.setSetting('fb_schedule_active', 'false');
        }
      }
    });
  }, []);

  // ── Auto-resume folder scheduler nếu đang chạy trước khi app tắt ──────────
  useEffect(() => {
    const wasOn = (() => { try { return localStorage.getItem('fluxy_fb_folder_auto_on') === 'true'; } catch { return false; } })();
    if (!wasOn) return;
    const savedPath = (() => { try { return localStorage.getItem('fluxy_fb_folder_path') || ''; } catch { return ''; } })();
    if (!savedPath) return;
    // Delay để state (pages, tokens) kịp load xong từ api.getSetting
    const tid = setTimeout(() => {
      folderAutoResumeRef.current = true;
      setFolderAutoOn(false); // đảm bảo bắt đầu từ off để toggleFolderAuto hoạt động đúng
    }, 1200);
    return () => clearTimeout(tid);
  }, []); // eslint-disable-line

  // ── Backend log/progress ──────────────────────────────────────────────────
  useEffect(() => {
    const off1 = api.onFbLog?.(msg => addLog(msg));
    const off2 = api.onFbProgress?.(pct => setProgress(pct));
    return () => { off1?.(); off2?.(); };
  }, []);

  // ── Auto-scroll log ───────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── Countdown ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!nextPostAt) { setCountdown(''); return; }
    const tick = () => {
      const rem = nextPostAt - Date.now();
      setCountdown(rem > 0 ? fmtTime(rem) : '0s');
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(countdownRef.current);
  }, [nextPostAt]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev.slice(-200), { t: new Date().toLocaleTimeString(), msg }]);
  }, []);

  const saveQueue = useCallback((q) => {
    api.setSetting('fb_queue', JSON.stringify(q));
  }, []);

  const saveHistory = useCallback((h) => {
    api.setSetting('fb_history', JSON.stringify(h));
  }, []);

  const saveSettings = (pt, pid, pname) => {
    api.setSetting('fb_page_token', pt || pageToken);
    api.setSetting('fb_page_id',    pid || pageId);
    api.setSetting('fb_page_name',  pname || pageName);
  };

  const savePagesSettings = (p) => {
    api.setSetting('fb_pages', JSON.stringify(p));
  };

  const addPage = () => {
    if (!newPageId.trim() || !newPageToken.trim()) { alert('Nhập Page ID và Token!'); return; }
    const entry = {
      id: Date.now().toString(),
      name: newPageName.trim() || `Page ${pages.length + 1}`,
      pageId: newPageId.trim(),
      token: newPageToken.trim(),
    };
    const next = [...pages, entry];
    setPages(next);
    savePagesSettings(next);
    // Set as fallback single-page if first entry
    if (pages.length === 0) {
      setPageToken(entry.token); setPageId(entry.pageId); setPageName(entry.name);
      saveSettings(entry.token, entry.pageId, entry.name);
    }
    setNewPageName(''); setNewPageId(''); setNewPageToken('');
    addLog(`✅ Đã thêm page: ${entry.name}`);
  };

  const handleOAuthLogin = async () => {
    setOauthLoading(true);
    addLog('🔐 Mở trình duyệt đăng nhập Facebook...');
    const r = await api.fbOAuthLogin();
    setOauthLoading(false);
    if (!r.success) { addLog(`❌ OAuth thất bại: ${r.error}`); return; }
    addLog(`✅ Đăng nhập thành công! Lấy được ${r.pages?.length || 0} page.`);
    if (r.pages?.length > 0) {
      const newPages = r.pages.map(p => ({
        id: Date.now().toString() + Math.random(),
        name: p.name,
        pageId: p.id,
        token: p.access_token,
      }));
      const merged = [...pages, ...newPages.filter(np => !pages.find(p => p.pageId === np.pageId))];
      setPages(merged);
      savePagesSettings(merged);
      if (merged.length > 0 && !pageToken) {
        setPageToken(merged[0].token); setPageId(merged[0].pageId); setPageName(merged[0].name);
        saveSettings(merged[0].token, merged[0].pageId, merged[0].name);
      }
      addLog(`📄 Đã thêm: ${r.pages.map(p => p.name).join(', ')}`);
    }
  };

  const removePage = (id) => {
    const next = pages.filter(p => p.id !== id);
    setPages(next);
    savePagesSettings(next);
    pageRoundRobinRef.current = 0;
    if (next.length > 0) {
      setPageToken(next[0].token); setPageId(next[0].pageId); setPageName(next[0].name);
    }
    addLog(`🗑️ Đã xóa page`);
  };

  // ── Verify token ──────────────────────────────────────────────────────────
  const handleVerifyToken = async (silent = false) => {
    if (!pageToken.trim()) { if (!silent) alert('Nhập Page Access Token trước!'); return; }
    addLog('🔍 Kiểm tra token...');
    const r = await api.fbDebugToken({ token: pageToken.trim() });
    if (!r.success) { addLog('❌ ' + r.error); setTokenStatus('error'); return; }
    setTokenInfo(r.info);
    const valid = r.info?.is_valid;
    setTokenStatus(valid ? 'ok' : 'error');
    if (valid) {
      const exp = r.info.expires_at ? new Date(r.info.expires_at * 1000).toLocaleDateString('vi-VN') : 'không hết hạn';
      addLog(`✓ Token hợp lệ | Hết hạn: ${exp}`);
    } else {
      addLog('❌ Token không hợp lệ');
    }
  };

  // ── Post one video ────────────────────────────────────────────────────────
  const doPost = async (path, cap, activePage = null, productLink = '') => {
    const pid  = activePage?.pageId || pageId;
    const ptok = activePage?.token  || pageToken;
    if (!ptok || !pid || !path) return false;
    addLog(`📤 Đăng: ${basename(path)}${activePage ? ` → ${activePage.name}` : ''}`);
    const r = await api.fbPostReel({
      pageId: pid, pageToken: ptok, videoPath: path, description: cap || '',
    });
    if (r.success) {
      addLog(`✅ Đăng xong! video_id=${r.video_id}`);
      // Post product links as comments (one comment per line)
      if (productLink?.trim() && r.video_id) {
        const links = productLink.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < links.length; i++) {
          addLog(`💬 Bình luận ${links.length > 1 ? `(${i + 1}/${links.length}) ` : ''}${links[i].slice(0, 60)}...`);
          const cr = await api.fbPostComment({ videoId: r.video_id, message: links[i], pageToken: ptok });
          if (cr?.success) addLog(`  ✅ Bình luận xong!`);
          else addLog(`  ⚠️ Lỗi: ${cr?.error || 'unknown'}`);
        }
      }
      return true;
    } else {
      addLog(`❌ Lỗi: ${r.error}`);
      // Re-throw so postNextInQueue catch block can save errorMsg to queue item
      throw new Error(r.error || 'Đăng thất bại');
    }
  };

  // ── Manual post ───────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!pageToken.trim()) { alert('Chưa có Page Access Token!'); return; }
    if (!pageId.trim())    { alert('Chưa chọn Page!'); return; }
    if (!videoPath.trim()) { alert('Chưa chọn video!'); return; }
    setPosting(true); setProgress(0); setPostResult(null); setLogs([]);
    try {
      await doPost(videoPath, caption, null, manualProductLink);
      setPostResult({ success: true, error: null });
    } catch (e) {
      setPostResult({ success: false, error: e.message });
    }
    setPosting(false);
  };

  // ── Add videos to queue ───────────────────────────────────────────────────
  const handleAddToQueue = async () => {
    const f = await api.selectFile('video');
    if (!f) return;
    const item = { id: Date.now(), path: f, caption: '', objects: '', status: 'pending' };
    const q = [...queue, item];
    setQueue(q); saveQueue(q);
  };

  const handleAddMultiple = async () => {
    const result = await api.selectMultipleFiles?.();
    if (!result?.length) return;
    // Handler trả về [{name, path}] hoặc string[] — normalize cả hai
    const paths = result.map(f => (typeof f === 'string' ? f : f.path)).filter(Boolean);
    const videos = paths.filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f));
    if (!videos.length) return;
    const items = videos.map(f => ({ id: Date.now() + Math.random(), path: f, caption: '', objects: '', status: 'pending' }));
    const q = [...queue, ...items];
    setQueue(q); saveQueue(q);
    addLog(`✓ Thêm ${items.length} video vào hàng đợi`);
  };

  // ── AI caption generation ─────────────────────────────────────────────────
  const generateCaption = useCallback(async (item) => {
    setGenerating(p => ({ ...p, [item.id]: true }));
    try {
      const cap = await generateFbCaption(basename(item.path), {
        pageTheme,
        objects: item.objects || '',
        style  : captionStyle,
        lang   : captionLang,
        model  : captionModel,
      });
      // Dùng functional updater để không bị stale closure khi tạo nhiều caption liên tiếp
      setQueue(prev => {
        const q = prev.map(i => i.id === item.id ? { ...i, caption: cap } : i);
        saveQueue(q);
        return q;
      });
      addLog(`✨ Tạo tiêu đề: ${basename(item.path)}`);
    } catch (e) {
      addLog('❌ AI caption lỗi: ' + e.message);
    }
    setGenerating(p => { const n = { ...p }; delete n[item.id]; return n; });
  }, [pageTheme, captionStyle, captionLang, captionModel, saveQueue, addLog]);

  const generateAllCaptions = useCallback(async () => {
    const pending = queue.filter(i => i.status === 'pending');
    if (!pending.length) return;
    addLog(`✨ Đang tạo tiêu đề AI cho ${pending.length} video...`);
    for (const item of pending) {
      await generateCaption(item);
    }
    addLog('✨ Tạo tiêu đề xong!');
  }, [queue, generateCaption, addLog]);

  // ─────────────────────────────────────────────────────────────────────────

  const removeFromQueue = (id) => {
    const q = queue.filter(i => i.id !== id);
    setQueue(q); saveQueue(q);
  };

  const updateCaption = (id, cap) => {
    const q = queue.map(i => i.id === id ? { ...i, caption: cap } : i);
    setQueue(q); saveQueue(q);
  };

  const updateObjects = (id, objects) => {
    const q = queue.map(i => i.id === id ? { ...i, objects } : i);
    setQueue(q); saveQueue(q);
  };

  const updateProductLink = (id, productLink) => {
    const q = queue.map(i => i.id === id ? { ...i, productLink } : i);
    setQueue(q); saveQueue(q);
  };

  const resetQueue = () => {
    const q = queue.map(i => i.status === 'done' || i.status === 'error' ? { ...i, status: 'pending' } : i);
    setQueue(q); saveQueue(q);
  };

  const clearDone = () => {
    const q = queue.filter(i => i.status === 'pending');
    setQueue(q); saveQueue(q);
  };

  const clearAll = () => {
    if (!window.confirm(`Xóa toàn bộ ${queue.length} video khỏi hàng đợi?`)) return;
    setQueue([]); saveQueue([]);
  };

  // ── Auto-post next pending item in queue ──────────────────────────────────
  const postNextInQueue = useCallback(async () => {
    // Read latest queue from ref (avoids stale closure + async updater issues)
    const currentQueue = queueRef.current;
    const nextIdx = currentQueue.findIndex(i => i.status === 'pending');

    if (nextIdx === -1) {
      addLog('📭 Hàng đợi trống — tự động dừng');
      stopSchedule();
      return;
    }

    const itemToPost = currentQueue[nextIdx];

    // Pick page via round-robin
    const activePagesNow = pagesRef.current;
    let activePage = null;
    if (activePagesNow.length > 0) {
      activePage = activePagesNow[pageRoundRobinRef.current % activePagesNow.length];
      pageRoundRobinRef.current++;
    }

    // Mark as posting
    setQueue(prev => prev.map((i, idx) => idx === nextIdx ? { ...i, status: 'posting', errorMsg: '' } : i));

    addLog(`⏰ Auto-đăng (${nextIdx + 1}): ${basename(itemToPost.path)}${activePage ? ` → ${activePage.name}` : ''}`);

    try {
      const ok = await doPost(itemToPost.path, itemToPost.caption, activePage, itemToPost.productLink || '');
      const now   = new Date().toLocaleString('vi-VN');
      const entry = { time: now, video: basename(itemToPost.path), success: ok };
      setQueue(prev2 => {
        const q2 = prev2.map(i => i.id === itemToPost.id ? { ...i, status: ok ? 'done' : 'error' } : i);
        saveQueue(q2);
        return q2;
      });
      setHistory(h => { const h2 = [entry, ...h.slice(0, 49)]; saveHistory(h2); return h2; });
    } catch (e) {
      const errMsg = e.message || 'Lỗi không xác định';
      addLog(`❌ Đăng lỗi (catch): ${errMsg}`);
      setQueue(prev2 => {
        const q2 = prev2.map(i => i.id === itemToPost.id ? { ...i, status: 'error', errorMsg: errMsg } : i);
        saveQueue(q2);
        return q2;
      });
    }
  }, [pageToken, pageId]);

  // Gán ref sau khi postNextInQueue được khai báo
  useEffect(() => { postNextInQueueRef.current = postNextInQueue; }, [postNextInQueue]);

  // Keep scheduledJobs ref in sync
  useEffect(() => { scheduledJobsRef.current = scheduledJobs; }, [scheduledJobs]);

  const saveScheduledJobs = (jobs) => { try { localStorage.setItem('fluxy_fb_scheduled_jobs', JSON.stringify(jobs)); } catch {} };

  // Check & fire one-time scheduled jobs every 15 seconds
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      const jobs = scheduledJobsRef.current;
      const due = jobs.filter(j => j.status === 'pending' && j.scheduledAt <= now);
      if (!due.length) return;
      for (const job of due) {
        setScheduledJobs(prev => {
          const u = prev.map(j => j.id === job.id ? { ...j, status: 'running' } : j);
          saveScheduledJobs(u);
          return u;
        });
        const activePage = pagesRef.current.length > 0 ? pagesRef.current[pageRoundRobinRef.current % pagesRef.current.length] : null;
        try {
          const ok = await doPost(job.videoPath, job.caption || '', activePage, job.productLink || '');
          setScheduledJobs(prev => {
            const u = prev.map(j => j.id === job.id ? { ...j, status: ok ? 'done' : 'error', finishedAt: Date.now() } : j);
            saveScheduledJobs(u);
            return u;
          });
          addLog(`${ok ? '✅' : '❌'} Lịch "${job.label || basename(job.videoPath)}" ${ok ? 'đã đăng' : 'thất bại'}`);
        } catch (e) {
          setScheduledJobs(prev => {
            const u = prev.map(j => j.id === job.id ? { ...j, status: 'error', finishedAt: Date.now() } : j);
            saveScheduledJobs(u);
            return u;
          });
          addLog(`❌ Lịch "${job.label || basename(job.videoPath)}" lỗi: ${e.message}`);
        }
      }
    };
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, []);

  const addScheduledJob = () => {
    if (!newJobVideo) { alert('Chọn file video trước!'); return; }
    if (!newJobTime)  { alert('Chọn ngày giờ đăng trước!'); return; }
    const scheduledAt = new Date(newJobTime).getTime();
    if (isNaN(scheduledAt) || scheduledAt <= Date.now()) { alert('Giờ đặt lịch phải là thời điểm trong tương lai!'); return; }
    const job = { id: Date.now(), videoPath: newJobVideo, caption: newJobCaption, scheduledAt, status: 'pending', label: basename(newJobVideo) };
    setScheduledJobs(prev => { const u = [...prev, job]; saveScheduledJobs(u); return u; });
    setNewJobVideo(''); setNewJobCaption(''); setNewJobTime('');
    addLog(`📅 Đã đặt lịch: "${job.label}" lúc ${new Date(scheduledAt).toLocaleString('vi-VN')}`);
  };

  const removeScheduledJob = (id) => {
    setScheduledJobs(prev => { const u = prev.filter(j => j.id !== id); saveScheduledJobs(u); return u; });
  };

  // ── Schedule control ──────────────────────────────────────────────────────
  const startSchedule = () => {
    const hasPages = pages.length > 0 || (pageToken && pageId);
    if (!hasPages) { alert('Chưa cài đặt token và page! Vào tab "Lấy Token" để thêm.'); return; }
    pageRoundRobinRef.current = 0;

    // Reset items bị kẹt ở 'posting' → 'pending' trước khi bắt đầu
    setQueue(prev => {
      const reset = prev.map(i => i.status === 'posting' ? { ...i, status: 'pending', errorMsg: '' } : i);
      saveQueue(reset);
      return reset;
    });

    const pendingCount = queue.filter(i => i.status === 'pending' || i.status === 'posting').length;
    if (pendingCount === 0) { alert('Hàng đợi trống! Thêm video trước.'); return; }

    if (scheduleRef.current) clearInterval(scheduleRef.current);

    const ms = intervalH * 60 * 60 * 1000;
    addLog(`🚀 Bắt đầu auto-post: ${pendingCount} video, mỗi ${intervalH}h`);

    // Post first one immediately (delay nhỏ để setQueue reset kịp commit)
    setTimeout(() => postNextInQueue(), 50);
    const next = Date.now() + ms;
    setNextPostAt(next);

    scheduleRef.current = setInterval(() => {
      postNextInQueue();
      const n = Date.now() + ms;
      setNextPostAt(n);
      api.setSetting('fb_schedule_next_at', String(n));
    }, ms);

    setScheduleRunning(true);
    api.setSetting('fb_interval_h',       String(intervalH));
    api.setSetting('fb_schedule_active',  'true');
    api.setSetting('fb_schedule_next_at', String(next));
    api.fbScheduleStatus?.({ active: true, nextAt: next });
  };

  const stopSchedule = () => {
    if (scheduleRef.current) { clearInterval(scheduleRef.current); scheduleRef.current = null; }
    setScheduleRunning(false);
    setNextPostAt(null);
    api.setSetting('fb_schedule_active',  'false');
    api.setSetting('fb_schedule_next_at', '0');
    api.fbScheduleStatus?.({ active: false, nextAt: 0 });
    addLog('⏹ Đã dừng auto-post');
  };

  const skipNext = () => {
    if (!scheduleRef.current) return;
    clearInterval(scheduleRef.current);
    const ms = intervalH * 60 * 60 * 1000;
    postNextInQueue();
    const next = Date.now() + ms;
    setNextPostAt(next);
    api.setSetting('fb_schedule_next_at', String(next));
    scheduleRef.current = setInterval(() => {
      postNextInQueue();
      const n = Date.now() + ms;
      setNextPostAt(n);
      api.setSetting('fb_schedule_next_at', String(n));
    }, ms);
    addLog('⏭ Đăng ngay video tiếp theo');
  };

  // ── Viral image generator ────────────────────────────────────────────────
  const ANIMAL_LIST = ['bears','cats','chickens','cows','dogs','donkeys','ducks',
                       'elephants','foxes','goats','horses','lions','parrots','rabbits','sheep'];
  const [viralSrcFolder, setViralSrcFolder] = useState('D:\\EyesAssets');
  const [viralBgColor,   setViralBgColor]   = useState('#1a6adb');
  const [viralAnimalChoice, setViralAnimalChoice] = useState('random'); // 'random' or animal name
  const [viralPreview,   setViralPreview]   = useState(null); // file:/// URL
  const [viralImagePath, setViralImagePath] = useState(null); // actual file path
  const [viralCaption,   setViralCaption]   = useState('');
  const [viralAnimalName,setViralAnimalName]= useState('');
  const [viralGenerating,setViralGenerating]= useState(false);
  const [viralPosting,   setViralPosting]   = useState(false);
  const [viralSaveDir,   setViralSaveDir]   = useState('');
  const [viralLog,       setViralLog]       = useState('');
  const [viralAutoOn,    setViralAutoOn]    = useState(false);
  const [viralIntervalH, setViralIntervalH] = useState(6);
  const [viralSchedMode,  setViralSchedMode]  = useState(() => { try { return localStorage.getItem('fluxy_fb_viral_sched_mode') || 'interval'; } catch { return 'interval'; } });
  const [viralFixedHours, setViralFixedHours] = useState(() => { try { return localStorage.getItem('fluxy_fb_viral_fixed_hours') || '12,18'; } catch { return '12,18'; } });
  const [viralNextAt,    setViralNextAt]    = useState(null);
  const viralAutoRef = useRef(null);
  const viralBgRef   = useRef(viralBgColor);
  const viralPageRef = useRef({ pages, pageToken, pageId });
  useEffect(() => { viralBgRef.current = viralBgColor; }, [viralBgColor]);
  useEffect(() => { viralPageRef.current = { pages, pageToken, pageId }; }, [pages, pageToken, pageId]);

  const BG_COLORS = ['#1a6adb','#27ae60','#e74c3c','#f39c12','#8e44ad','#16a085','#2c3e50','#e67e22'];

  const generateViralImage = async () => {
    setViralGenerating(true); setViralLog('⏳ Đang tạo ảnh...');
    try {
      const params = {
        assetsFolder: viralSrcFolder,
        animalName: viralAnimalChoice !== 'random' ? viralAnimalChoice : undefined,
        bgColor: viralBgColor,
      };
      const result = await api?.genViralImage?.(params);
      if (!result?.ok) throw new Error(result?.error || 'Lỗi không xác định');

      const filePath = result.path;
      const animal   = result.animalName;
      setViralImagePath(filePath);
      setViralAnimalName(animal);
      // Use cache-busting query so Electron re-renders updated file
      setViralPreview(`file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`);
      setViralCaption(`How many ${animal} can you count? 🤔\nComment your answer below! 👇\n#counting #${animal} #viral #animals #quiz #funnyanimals`);
      setViralLog(`✅ Xong! Con vật: ${animal} — 3×3 grid, 3 con/ô = 27 con`);
    } catch(e) { setViralLog(`❌ ${e.message}`); }
    setViralGenerating(false);
  };

  const saveAndPostViralImage = async () => {
    if (!viralImagePath) return;
    setViralPosting(true); setViralLog('⏳ Đang đăng lên FB...');
    try {
      const token = pages[0]?.token || pageToken;
      const pid   = pages[0]?.pageId || pageId;
      if (!token || !pid) throw new Error('Chưa cài FB token — vào tab Lấy Token');

      // Read file bytes via IPC (main process reads the temp file)
      const bytes = await api?.readFileBytesAsBase64?.(viralImagePath);
      if (!bytes) throw new Error('Không đọc được file ảnh');
      const byteArr = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));

      const form = new FormData();
      const blob = new Blob([byteArr], { type: 'image/png' });
      form.append('source', blob, 'viral.png');
      form.append('caption', viralCaption);
      form.append('published', '1');
      form.append('access_token', token);

      const r = await fetch(`https://graph.facebook.com/v19.0/${pid}/photos`, { method: 'POST', body: form });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      setViralLog(`✅ Đã đăng! Post ID: ${d.id || d.post_id}`);
    } catch(e) { setViralLog(`❌ ${e.message}`); }
    setViralPosting(false);
  };

  // ── Viral auto: gen + post một lần (dùng bởi scheduler) ─────────────────
  const runViralAutoOnce = useCallback(async (setLog) => {
    const log = setLog || setViralLog;
    log('⏳ [Auto] Đang tạo ảnh...');
    const { pages: pg, pageToken: pt, pageId: pi } = viralPageRef.current;
    const token = pg[0]?.token || pt;
    const pid   = pg[0]?.pageId || pi;
    if (!token || !pid) { log('❌ [Auto] Chưa có FB token'); return; }
    const result = await api?.genViralImage?.({ assetsFolder: viralSrcFolder, bgColor: viralBgRef.current });
    if (!result?.ok) { log(`❌ [Auto] Gen ảnh thất bại: ${result?.error}`); return; }
    const filePath = result.path;
    const animal   = result.animalName;
    setViralImagePath(filePath);
    setViralAnimalName(animal);
    setViralPreview(`file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`);
    const caption = `How many ${animal} can you count? 🤔\nComment your answer below! 👇\n#counting #${animal} #viral #animals #quiz #funnyanimals`;
    setViralCaption(caption);
    log(`⏳ [Auto] Đăng ${animal} lên FB...`);
    const bytes = await api?.readFileBytesAsBase64?.(filePath);
    if (!bytes) { log('❌ [Auto] Không đọc được file ảnh'); return; }
    const byteArr = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));
    const form = new FormData();
    form.append('source', new Blob([byteArr], { type: 'image/png' }), 'viral.png');
    form.append('caption', caption);
    form.append('published', '1');
    form.append('access_token', token);
    const r = await fetch(`https://graph.facebook.com/v19.0/${pid}/photos`, { method: 'POST', body: form });
    const d = await r.json();
    if (d.error) { log(`❌ [Auto] ${d.error.message}`); return; }
    log(`✅ [Auto] Đã đăng ${animal}! ID: ${d.id || d.post_id}`);
  }, [viralSrcFolder]);

  // Tính ms đến lần đăng tiếp theo theo giờ cố định
  const msUntilNextFixed = useCallback((hoursStr) => {
    const hours = hoursStr.split(',').map(s => parseInt(s.trim())).filter(h => !isNaN(h) && h >= 0 && h <= 23);
    if (!hours.length) return null;
    const now = new Date();
    const todayMs = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();
    const sorted = [...new Set(hours)].sort((a, b) => a - b);
    for (const h of sorted) {
      const targetMs = h * 3600000;
      if (targetMs > todayMs) return targetMs - todayMs;
    }
    return (24 * 3600000 - todayMs) + sorted[0] * 3600000;
  }, []);

  const toggleViralAuto = useCallback(() => {
    if (viralAutoRef.current) {
      clearTimeout(viralAutoRef.current);
      viralAutoRef.current = null;
      setViralAutoOn(false);
      setViralNextAt(null);
      setViralLog('⏹ Đã dừng tự động');
      return;
    }
    if (viralSchedMode === 'fixed') {
      const parsed = viralFixedHours.split(',').map(s => parseInt(s.trim())).filter(h => !isNaN(h) && h >= 0 && h <= 23);
      if (!parsed.length) { alert('Chọn ít nhất 1 giờ đăng!'); return; }
    }
    setViralAutoOn(true);
    const scheduleNext = () => {
      let ms;
      if (viralSchedMode === 'fixed') {
        ms = msUntilNextFixed(viralFixedHours);
        if (!ms) { setViralLog('❌ Không có giờ hợp lệ'); setViralAutoOn(false); return; }
        const nextDate = new Date(Date.now() + ms);
        setViralLog(`⏰ Chờ đến ${nextDate.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}...`);
      } else {
        ms = viralIntervalH * 60 * 60 * 1000;
        // interval mode: đăng ngay lần đầu
        runViralAutoOnce();
      }
      setViralNextAt(Date.now() + ms);
      viralAutoRef.current = setTimeout(() => { runViralAutoOnce(); scheduleNext(); }, ms);
    };
    scheduleNext();
  }, [viralIntervalH, viralSchedMode, viralFixedHours, msUntilNextFixed, runViralAutoOnce]);

  // Cleanup viral auto on unmount
  useEffect(() => () => { if (viralAutoRef.current) clearTimeout(viralAutoRef.current); }, []);

  // ── Folder-mode: tự đăng video từ thư mục ───────────────────────────────
  const runFolderAutoOnce = useCallback(async () => {
    const { pages: pg, pageToken: pt, pageId: pi } = viralPageRef.current;
    const activePage = pg.length > 0 ? pg[pageRoundRobinRef.current % pg.length] : null;
    const token = activePage?.token || pt;
    const pid   = activePage?.pageId || pi;
    if (!token || !pid) { setFolderLog('❌ Chưa có FB token'); return; }
    if (!folderPath) { setFolderLog('❌ Chưa chọn thư mục video'); return; }

    const allFiles = await api?.listDir?.(folderPath) || [];
    const videos = allFiles.filter(f => /\.(mp4|mov|avi|mkv)$/i.test(f));
    if (!videos.length) { setFolderLog('❌ Không có file video trong thư mục'); return; }

    const idx = folderIndexRef.current % videos.length;
    const videoFile = videos[idx];
    folderIndexRef.current = idx + 1;
    if (pg.length > 1) pageRoundRobinRef.current = (pageRoundRobinRef.current + 1) % pg.length;

    const videoPath = `${folderPath}\\${videoFile}`;
    const videoName = videoFile.replace(/\.[^.]+$/, ''); // bỏ đuôi file
    setFolderLog(`⏳ Gen tiêu đề AI...`);
    addLog(`📂 [Folder Auto] ${videoFile}`);

    let caption = '';
    try {
      caption = await generateFbCaption(videoName, { style: captionStyle || 'eyes-challenge', model: captionModel });
    } catch(e) {
      addLog(`⚠️ Gen tiêu đề thất bại: ${e.message} — đăng không tiêu đề`);
    }

    setFolderLog(`⏳ Đăng: ${videoFile}...`);
    try {
      await doPost(videoPath, caption, activePage);
      setFolderLog(`✅ Đã đăng: ${videoFile}`);
      addLog(`✅ Đã đăng: ${videoFile}`);
      if (folderDeleteAfterPost) {
        try {
          await api.deleteFile(videoPath);
          setFolderLog(`🗑 Đã xóa: ${videoFile}`);
          addLog(`🗑 Đã xóa file: ${videoFile}`);
          folderIndexRef.current = Math.max(0, folderIndexRef.current - 1); // bù lại index vì file bị xóa
        } catch(de) {
          addLog(`⚠️ Không xóa được file: ${de.message}`);
        }
      }
    } catch(e) {
      setFolderLog(`❌ ${e.message}`);
    }
  }, [folderPath, captionStyle, captionModel, folderDeleteAfterPost]);

  const toggleFolderAuto = useCallback(() => {
    if (folderAutoRef.current) {
      clearTimeout(folderAutoRef.current);
      folderAutoRef.current = null;
      setFolderAutoOn(false);
      setFolderNextAt(null);
      setFolderLog('⏹ Đã dừng');
      return;
    }
    if (!folderPath) { alert('Chọn thư mục video trước!'); return; }
    const hasPages = pages.length > 0 || (pageToken && pageId);
    if (!hasPages) { alert('Chưa cài FB token!'); return; }
    if (folderSchedMode === 'fixed') {
      const parsed = folderFixedHours.split(',').map(s => parseInt(s.trim())).filter(h => !isNaN(h) && h >= 0 && h <= 23);
      if (!parsed.length) { alert('Chọn ít nhất 1 giờ đăng!'); return; }
    }
    setFolderAutoOn(true);
    if (folderAutoResumeRef.current === false && (() => { try { return localStorage.getItem('fluxy_fb_folder_auto_on') === 'true'; } catch { return false; } })()) {
      setFolderLog('♻️ Khôi phục lịch tự động...');
    }
    const scheduleNext = () => {
      let ms;
      if (folderSchedMode === 'fixed') {
        ms = msUntilNextFixed(folderFixedHours);
        if (!ms) { setFolderLog('❌ Không có giờ hợp lệ'); setFolderAutoOn(false); return; }
        const nextDate = new Date(Date.now() + ms);
        setFolderLog(`⏰ Chờ đến ${nextDate.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}...`);
      } else {
        ms = folderIntervalH * 60 * 60 * 1000;
      }
      setFolderNextAt(Date.now() + ms);
      folderAutoRef.current = setTimeout(() => { runFolderAutoOnce(); scheduleNext(); }, ms);
    };
    if (folderSchedMode === 'interval') runFolderAutoOnce();
    scheduleNext();
  }, [folderPath, folderIntervalH, folderSchedMode, folderFixedHours, msUntilNextFixed, pages, pageToken, pageId, runFolderAutoOnce]);

  useEffect(() => () => { if (folderAutoRef.current) clearTimeout(folderAutoRef.current); }, []);

  // Khi folderAutoResumeRef = true và folderAutoOn = false → trigger toggle
  // (phải đặt SAU toggleFolderAuto để tránh TDZ)
  useEffect(() => {
    if (!folderAutoResumeRef.current) return;
    folderAutoResumeRef.current = false;
    const path = (() => { try { return localStorage.getItem('fluxy_fb_folder_path') || ''; } catch { return ''; } })();
    if (!path) return;
    const tid = setTimeout(() => toggleFolderAuto(), 100);
    return () => clearTimeout(tid);
  }, [folderAutoOn, toggleFolderAuto]);

  // ── Counts ───────────────────────────────────────────────────────────────
  const pendingCount = queue.filter(i => i.status === 'pending').length;
  const doneCount    = queue.filter(i => i.status === 'done').length;
  const errorCount   = queue.filter(i => i.status === 'error').length;

  // ── Render ────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'guide',    label: '📖 Lấy Token' },
    { id: 'post',     label: '📤 Đăng thủ công' },
    { id: 'schedule', label: '⏰ Tự động' },
    { id: 'viral_img',label: '🖼 Ảnh Viral' },
  ];

  return (
    <div className="flex flex-col w-full h-full bg-slate-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">f</div>
          <div>
            <h1 className="text-base font-bold leading-tight">Facebook Auto Post</h1>
            <p className="text-xs text-slate-400">
              {pageName ? <span className="text-blue-400">{pageName}</span> : <span className="text-yellow-500">Chưa chọn page</span>}
              {tokenStatus === 'ok'    && <span className="ml-2 text-green-400">● Token OK</span>}
              {tokenStatus === 'error' && <span className="ml-2 text-red-400">● Token lỗi</span>}
              {scheduleRunning && <span className="ml-2 text-yellow-300 animate-pulse">● Đang tự động</span>}
            </p>
          </div>
          {scheduleRunning && countdown && (
            <div className="ml-auto text-right">
              <div className="text-xs text-slate-500">Đăng tiếp theo</div>
              <div className="text-yellow-300 font-mono text-sm font-bold">{countdown}</div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">

        {/* ─── TAB: Lấy Token ──────────────────────────────────────────── */}
        {activeTab === 'guide' && (
          <div className="p-4 w-full">

            {/* OAuth Quick Login */}
            <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-3 mb-4">
              <p className="text-green-300 text-sm font-semibold mb-2">⚡ Kết nối Facebook Page</p>
              <button
                onClick={handleOAuthLogin}
                disabled={oauthLoading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                {oauthLoading ? '⏳ Đang chờ đăng nhập trên trình duyệt...' : '🔐 Đăng nhập Facebook → Tự động lấy token tất cả pages'}
              </button>
            </div>

            {/* Pages list */}
            {pages.length > 0 && (
              <div className="mb-3 space-y-1.5">
                <p className="text-xs text-slate-400 font-medium">Pages đã kết nối ({pages.length}):</p>
                {pages.map((p, idx) => (
                  <div key={p.id} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500 w-4">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white truncate block">{p.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{p.pageId}</span>
                    </div>
                    <button onClick={() => removePage(p.id)} className="text-red-400 hover:text-red-300 p-1 flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Token status banner */}
            {(pages.length > 0 || pageToken) && (
              <div className={`mt-2 border rounded-xl p-3 flex items-center justify-between gap-3 ${
                tokenStatus === 'ok' ? 'border-green-700/40 bg-green-900/20'
                : tokenStatus === 'error' ? 'border-red-700/40 bg-red-900/20'
                : 'border-slate-700 bg-slate-900/50'}`}>
                <div>
                  {pages.length > 0
                    ? <span className="font-medium text-white text-sm">{pages.length} page — xoay vòng</span>
                    : <span className="font-medium text-white text-sm">{pageName || pageId}</span>
                  }
                  {tokenStatus === 'ok' && <span className="ml-2 text-green-400 text-xs">● OK</span>}
                  {tokenStatus === 'error' && <span className="ml-2 text-red-400 text-xs">● Lỗi</span>}
                </div>
                <div className="flex gap-2">
                  {pages.length === 0 && (
                    <button onClick={() => handleVerifyToken()}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">Kiểm tra</button>
                  )}
                  <button onClick={() => setActiveTab('schedule')}
                    className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded">Tự động đăng →</button>
                </div>
              </div>
            )}

            {/* Log */}
            {logs.length > 0 && (
              <div ref={logRef} className="mt-3 bg-slate-900 border border-slate-800 rounded-lg p-2 max-h-28 overflow-y-auto text-xs font-mono space-y-0.5">
                {logs.map((l, i) => <div key={i} className="text-slate-400"><span className="text-slate-600">{l.t} </span>{l.msg}</div>)}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: Đăng thủ công ───────────────────────────────────────── */}
        {activeTab === 'post' && (
          <div className="p-4 w-full space-y-3">
            {!pageToken && (
              <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-xl p-3 text-sm text-yellow-200">
                ⚠️ Chưa có token. <button className="underline" onClick={() => setActiveTab('guide')}>Vào tab Lấy Token</button> trước.
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">File video (MP4 9:16)</label>
              <div className="flex gap-2">
                <input value={videoPath} onChange={e => setVideoPath(e.target.value)}
                  placeholder="Chọn file hoặc kéo thả..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                <button onClick={async () => { const f = await api.selectFile('video'); if (f) setVideoPath(f); }}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm flex items-center gap-1">
                  <FolderOpen size={14} /> Chọn
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Caption / Hashtag</label>
              <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3}
                placeholder="Viết caption... hoặc để trống"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">🛒 Link sản phẩm <span className="text-slate-600">(mỗi dòng = 1 bình luận — tuỳ chọn)</span></label>
              <textarea value={manualProductLink} onChange={e => setManualProductLink(e.target.value)} rows={3}
                placeholder={"https://shopee.vn/...\nhttps://tiki.vn/...\nhttps://..."}
                className="w-full bg-slate-800 border border-emerald-700/50 rounded-lg px-3 py-2 text-sm text-emerald-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 resize-none font-mono" />
            </div>
            {pageId && (
              <div className="text-sm text-slate-400">
                Đăng lên: <span className="text-blue-400 font-medium">{pageName || pageId}</span>
                <button onClick={() => setActiveTab('guide')} className="ml-2 text-xs text-slate-500 hover:text-slate-300">(đổi)</button>
              </div>
            )}
            {posting && progress > 0 && (
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Upload</span><span>{progress}%</span></div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            <button onClick={handlePost} disabled={posting || !pageToken || !videoPath}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed">
              {posting ? <><Loader2 size={16} className="animate-spin" /> Đang đăng...</> : <><Upload size={16} /> Đăng Reel lên Facebook</>}
            </button>
            {postResult && (
              <div className={`flex items-start gap-2 p-3 rounded-xl text-sm ${postResult.success ? 'bg-green-900/30 border border-green-700/40 text-green-300' : 'bg-red-900/30 border border-red-700/40 text-red-300'}`}>
                {postResult.success ? <CheckCircle size={16} className="flex-shrink-0 mt-0.5" /> : <XCircle size={16} className="flex-shrink-0 mt-0.5" />}
                <span>{postResult.success ? 'Đăng thành công!' : postResult.error}</span>
              </div>
            )}
            <div ref={logRef} className="bg-slate-900 border border-slate-800 rounded-lg p-2 h-28 overflow-y-auto text-xs font-mono space-y-0.5">
              {logs.length === 0 && <span className="text-slate-600">Log sẽ hiện ở đây...</span>}
              {logs.map((l, i) => <div key={i} className="text-slate-400"><span className="text-slate-600">{l.t} </span>{l.msg}</div>)}
            </div>

            {/* ── Đặt lịch 1 lần ── */}
            <div className="bg-slate-900 border border-indigo-800/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="text-sm font-semibold text-indigo-300">📅 Đặt lịch đăng tự động</div>
              <div className="text-xs text-slate-400">Chọn video + giờ cụ thể → app tự đăng đúng giờ đó (kể cả khi bạn không ngồi máy)</div>

              <div className="flex gap-1">
                <input value={newJobVideo} onChange={e => setNewJobVideo(e.target.value)}
                  placeholder="Chọn file video..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white min-w-0 placeholder-slate-600" />
                <button onClick={async () => { const f = await api?.selectFile?.('video'); if (f) setNewJobVideo(f); }}
                  className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs">📂</button>
              </div>

              <textarea value={newJobCaption} onChange={e => setNewJobCaption(e.target.value)} rows={2}
                placeholder="Caption (tuỳ chọn)..."
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white resize-none placeholder-slate-600" />

              <div className="flex gap-2 items-center">
                <span className="text-xs text-slate-400 whitespace-nowrap">Đăng lúc:</span>
                <input type="datetime-local" value={newJobTime}
                  onChange={e => setNewJobTime(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white [color-scheme:dark]" />
              </div>

              <button onClick={addScheduledJob} disabled={!newJobVideo || !newJobTime}
                className="w-full py-2 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 rounded-lg text-xs font-bold text-white">
                + Thêm vào lịch
              </button>

              {/* Danh sách jobs đã đặt */}
              {scheduledJobs.length > 0 && (
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {[...scheduledJobs].sort((a, b) => a.scheduledAt - b.scheduledAt).map(job => {
                    const statusColor = job.status === 'done' ? 'text-green-400' : job.status === 'error' ? 'text-red-400' : job.status === 'running' ? 'text-yellow-400 animate-pulse' : 'text-slate-300';
                    const statusIcon  = job.status === 'done' ? '✅' : job.status === 'error' ? '❌' : job.status === 'running' ? '⏳' : '⏰';
                    const timeStr = new Date(job.scheduledAt).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
                    return (
                      <div key={job.id} className="flex items-center gap-2 bg-slate-800 rounded px-2 py-1.5 text-xs">
                        <span>{statusIcon}</span>
                        <span className={`flex-1 truncate ${statusColor}`}>{job.label || basename(job.videoPath)}</span>
                        <span className="text-slate-500 whitespace-nowrap">{timeStr}</span>
                        {job.status === 'pending' && (
                          <button onClick={() => removeScheduledJob(job.id)} className="text-slate-600 hover:text-red-400 text-base leading-none">×</button>
                        )}
                        {(job.status === 'done' || job.status === 'error') && (
                          <button onClick={() => removeScheduledJob(job.id)} className="text-slate-600 hover:text-slate-400 text-base leading-none">×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB: Tự động ─────────────────────────────────────────────── */}
        {activeTab === 'schedule' && (
          <div className="p-4 flex gap-4 h-full overflow-hidden">

          {/* ── CỘT TRÁI: điều khiển + queue ── */}
          <div className="flex flex-col gap-4 w-[480px] flex-shrink-0 overflow-y-auto">

            {/* Control panel */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Điều khiển tự động đăng</h3>
                {scheduleRunning && (
                  <div className="flex items-center gap-1 text-xs text-yellow-300">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    Đang chạy
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-sm text-slate-400">Mỗi</span>
                  <input type="number" value={intervalH} onChange={e => setIntervalH(Math.max(1, Number(e.target.value)))}
                    min={1} max={72} disabled={scheduleRunning}
                    className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-center disabled:opacity-50" />
                  <span className="text-sm text-slate-400">giờ / video</span>
                </div>
              </div>

              {/* Stats */}
              <div className="flex gap-3 mb-3">
                <div className="flex-1 bg-slate-800 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-blue-400">{pendingCount}</div>
                  <div className="text-xs text-slate-500">Chờ đăng</div>
                </div>
                <div className="flex-1 bg-slate-800 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-green-400">{doneCount}</div>
                  <div className="text-xs text-slate-500">Đã đăng</div>
                </div>
                <div className="flex-1 bg-slate-800 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-red-400">{errorCount}</div>
                  <div className="text-xs text-slate-500">Lỗi</div>
                </div>
                {scheduleRunning && countdown && (
                  <div className="flex-1 bg-slate-800 rounded-lg p-2 text-center">
                    <div className="text-xl font-bold text-yellow-300 font-mono">{countdown}</div>
                    <div className="text-xs text-slate-500">Đến lần sau</div>
                  </div>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                {scheduleRunning ? (
                  <>
                    <button onClick={stopSchedule}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg font-medium text-sm">
                      <StopCircle size={16} /> Dừng
                    </button>
                    <button onClick={skipNext}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm" title="Đăng ngay video tiếp">
                      <SkipForward size={16} /> Đăng ngay
                    </button>
                  </>
                ) : (
                  <button onClick={startSchedule} disabled={pendingCount === 0 || (pages.length === 0 && !pageToken)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-700 hover:bg-green-600 rounded-lg font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                    <PlayCircle size={16} /> Bắt đầu tự động đăng
                  </button>
                )}
              </div>

              {pages.length === 0 && !pageToken && (
                <div className="mt-2 text-xs text-yellow-400 flex items-center gap-1">
                  <AlertCircle size={12} />
                  <button onClick={() => setActiveTab('guide')} className="underline">Cài đặt token trước</button>
                </div>
              )}
            </div>

            {/* Folder auto-post */}
            <div className="bg-slate-900 border border-purple-800/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">📂 Tự đăng từ thư mục</span>
                {folderAutoOn && <span className="text-xs text-yellow-300 animate-pulse">● Đang chạy</span>}
              </div>
              <div className="text-xs text-slate-400">Đặt video vào thư mục → tự pick và đăng lần lượt, không cần queue.</div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Thư mục video</label>
                <div className="flex gap-1">
                  <input value={folderPath} onChange={e => setFolderPath(e.target.value)} placeholder="D:\Videos\post..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white min-w-0 placeholder-slate-600" />
                  <button onClick={async () => { const d = await api?.selectFolder?.(); if(d) setFolderPath(d); }}
                    className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs">📂</button>
                </div>
              </div>

              {/* Schedule mode toggle */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                {[['interval','⏱ Theo khoảng'],['fixed','🕐 Giờ cố định']].map(([m, lbl]) => (
                  <button key={m} disabled={folderAutoOn}
                    onClick={() => { setFolderSchedMode(m); try { localStorage.setItem('fluxy_fb_folder_sched_mode', m); } catch {} }}
                    className={`flex-1 py-1.5 font-medium transition-colors disabled:opacity-50 ${folderSchedMode === m ? 'bg-purple-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                    {lbl}
                  </button>
                ))}
              </div>

              {folderSchedMode === 'interval' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">Mỗi</span>
                  <input type="number" min={1} max={72} value={folderIntervalH}
                    onChange={e => setFolderIntervalH(Math.max(1, +e.target.value))}
                    disabled={folderAutoOn}
                    className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white text-center disabled:opacity-50" />
                  <span className="text-xs text-slate-400">giờ / video</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-slate-400">Chọn giờ đăng hàng ngày <span className="text-slate-600">(lặp lại mỗi ngày, mỗi giờ đăng 1 video)</span>:</span>
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({length:24},(_,h)=>{
                      const selected = folderFixedHours.split(',').map(s=>parseInt(s.trim())).includes(h);
                      return (
                        <button key={h} disabled={folderAutoOn}
                          onClick={() => {
                            const cur = folderFixedHours.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n));
                            const next = selected ? cur.filter(n=>n!==h) : [...cur,h];
                            next.sort((a,b)=>a-b);
                            const str = next.join(',');
                            setFolderFixedHours(str);
                            try { localStorage.setItem('fluxy_fb_folder_fixed_hours', str); } catch {}
                          }}
                          className={`py-1 rounded text-xs font-mono font-bold transition-colors disabled:opacity-50 ${selected ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                          {String(h).padStart(2,'0')}h
                        </button>
                      );
                    })}
                  </div>
                  {folderFixedHours && folderFixedHours.split(',').filter(s=>s.trim()).length > 0 && (
                    <div className="text-xs text-purple-300">
                      Đã chọn: {folderFixedHours.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)).sort((a,b)=>a-b).map(h=>`${String(h).padStart(2,'0')}:00`).join(' · ')}
                    </div>
                  )}
                </div>
              )}

              {folderNextAt && folderAutoOn && (
                <div className="text-xs text-yellow-400">
                  ⏰ Đăng tiếp: {new Date(folderNextAt).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={folderDeleteAfterPost}
                  onChange={e => {
                    setFolderDeleteAfterPost(e.target.checked);
                    try { localStorage.setItem('fluxy_fb_folder_delete', String(e.target.checked)); } catch {}
                  }}
                  className="w-4 h-4 accent-red-500 cursor-pointer" />
                <span className="text-xs text-slate-300">🗑 Xóa video khỏi thư mục sau khi đăng thành công</span>
              </label>

              <button onClick={toggleFolderAuto}
                className={`w-full py-2 rounded-lg text-sm font-bold transition-colors ${folderAutoOn ? 'bg-red-700 hover:bg-red-600' : 'bg-purple-700 hover:bg-purple-600'} text-white`}>
                {folderAutoOn ? '⏹ Dừng' : '▶ Bật tự động từ thư mục'}
              </button>

              {folderLog && (
                <div className={`text-xs font-mono p-2 rounded ${folderLog.startsWith('✅') ? 'bg-green-900/30 text-green-300' : folderLog.startsWith('❌') ? 'bg-red-900/30 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
                  {folderLog}
                </div>
              )}
            </div>

            {/* Queue */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Hàng đợi video ({queue.length})</h3>
                <div className="flex gap-2">
                  {doneCount > 0 && (
                    <button onClick={clearDone}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">
                      Xoá đã đăng
                    </button>
                  )}
                  {(doneCount > 0 || errorCount > 0) && (
                    <button onClick={resetQueue}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">
                      Reset tất cả
                    </button>
                  )}
                </div>
              </div>

              {/* AI Caption settings */}
              <div className="mb-3 p-2 bg-slate-800/70 border border-purple-800/40 rounded-lg space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={13} className="text-purple-400" />
                  <span className="text-xs font-medium text-purple-300">Tự động tạo tiêu đề AI</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <div className="flex-1 min-w-36">
                    <label className="text-xs text-slate-500 mb-0.5 block">Phong cách</label>
                    <select value={captionStyle}
                      onChange={e => { setCaptionStyle(e.target.value); api.setSetting('fb_caption_style', e.target.value); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs">
                      <option value="auto">Tự động</option>
                      <option value="eyes-challenge">👁 Eyes Challenge</option>
                      <option value="viral">🔥 Viral chung</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-36">
                    <label className="text-xs text-slate-500 mb-0.5 block">Chủ đề trang</label>
                    <input value={pageTheme}
                      onChange={e => { setPageTheme(e.target.value); api.setSetting('fb_page_theme', e.target.value); }}
                      placeholder="vd: Eyes Challenge puzzle..."
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-purple-500" />
                  </div>
                  <div className="flex items-end">
                    <select value={captionLang}
                      onChange={e => { setCaptionLang(e.target.value); api.setSetting('fb_caption_lang', e.target.value); }}
                      className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs">
                      <option value="en">🇺🇸 EN</option>
                      <option value="vi">🇻🇳 VI</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <select value={captionModel}
                      onChange={e => { setCaptionModel(e.target.value); try { localStorage.setItem(LS_FB_GEMINI_MODEL, e.target.value); } catch {} }}
                      className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-purple-300">
                      {FB_GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={generateAllCaptions}
                  disabled={Object.keys(generating).length > 0 || pendingCount === 0}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-xs font-medium disabled:opacity-40">
                  {Object.keys(generating).length > 0
                    ? <><Loader2 size={12} className="animate-spin" /> Đang tạo...</>
                    : <><Wand2 size={12} /> Tạo tiêu đề AI cho tất cả video</>}
                </button>
              </div>

              {/* Add buttons */}
              <div className="flex gap-2 mb-3 flex-wrap">
                <button onClick={handleAddToQueue}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-xs font-medium">
                  <Plus size={13} /> Thêm 1 video
                </button>
                <button onClick={handleAddMultiple}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium">
                  <FolderOpen size={13} /> Thêm nhiều video
                </button>
                {queue.length > 0 && (
                  <button onClick={clearAll}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-900/60 hover:bg-red-800 border border-red-700/50 rounded-lg text-xs font-medium text-red-300 ml-auto">
                    <Trash2 size={13} /> Xóa tất cả
                  </button>
                )}
              </div>

              {/* Queue list */}
              {queue.length === 0 ? (
                <div className="text-center py-8 text-slate-600 text-sm">
                  <Upload size={32} className="mx-auto mb-2 opacity-30" />
                  Chưa có video — click "Thêm video" để bắt đầu
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {queue.map((item, idx) => (
                    <div key={item.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                      item.status === 'done'    ? 'border-green-800/50 bg-green-900/10 opacity-70'
                      : item.status === 'error'  ? 'border-red-800/50 bg-red-900/10'
                      : item.status === 'posting' ? 'border-blue-700/50 bg-blue-900/10 animate-pulse'
                      : 'border-slate-700 bg-slate-800/50'
                    }`}>
                      {/* Status icon */}
                      <div className="flex-shrink-0 mt-0.5 w-4 text-center">
                        {item.status === 'done'    && <CheckCircle size={13} className="text-green-400" />}
                        {item.status === 'error'   && <XCircle size={13} className="text-red-400" />}
                        {item.status === 'posting' && <Loader2 size={13} className="text-blue-400 animate-spin" />}
                        {item.status === 'pending' && <span className="text-slate-500 font-mono">{idx + 1}</span>}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="font-medium text-white truncate text-xs">{basename(item.path)}</div>
                        {item.status === 'error' && item.errorMsg && (
                          <div className="text-red-400 text-xs break-all">{item.errorMsg}</div>
                        )}

                        {/* Objects input (for Eyes Challenge style) */}
                        {(captionStyle === 'eyes-challenge' || captionStyle === 'auto') && item.status === 'pending' && (
                          <input
                            value={item.objects || ''}
                            onChange={e => updateObjects(item.id, e.target.value)}
                            placeholder="Vật/con vật: sheep, duck, hen..."
                            className="w-full bg-slate-900 border border-purple-800/50 rounded px-2 py-0.5 text-purple-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 text-xs"
                          />
                        )}

                        {/* Caption with AI button */}
                        <div className="flex gap-1">
                          <input
                            value={item.caption}
                            onChange={e => updateCaption(item.id, e.target.value)}
                            placeholder="Tiêu đề (hoặc bấm ✨ để AI tạo)..."
                            disabled={item.status !== 'pending'}
                            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-40 text-xs"
                          />
                          {item.status === 'pending' && (
                            <button onClick={() => generateCaption(item)}
                              disabled={!!generating[item.id]}
                              className="flex-shrink-0 px-1.5 py-0.5 bg-purple-800/70 hover:bg-purple-700 rounded text-purple-300 disabled:opacity-50"
                              title="AI tạo tiêu đề">
                              {generating[item.id]
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Sparkles size={11} />}
                            </button>
                          )}
                        </div>

                        {/* Product link comments */}
                        {item.status === 'pending' && (
                          <textarea
                            value={item.productLink || ''}
                            onChange={e => updateProductLink(item.id, e.target.value)}
                            placeholder={"🛒 Link sản phẩm (mỗi dòng = 1 bình luận)\nhttps://shopee.vn/..."}
                            rows={2}
                            className="w-full bg-slate-900 border border-emerald-800/50 rounded px-2 py-0.5 text-emerald-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-xs resize-none font-mono"
                          />
                        )}
                        {item.status !== 'pending' && item.productLink && (
                          <div className="text-emerald-500 text-xs">
                            🛒 {item.productLink.split('\n').filter(Boolean).length} link sản phẩm
                          </div>
                        )}
                      </div>

                      {/* Delete */}
                      {item.status !== 'posting' && (
                        <button onClick={() => removeFromQueue(item.id)}
                          className="flex-shrink-0 p-1 text-slate-600 hover:text-red-400">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>{/* end cột trái */}

          {/* ── CỘT PHẢI: Log + Lịch sử ── */}
          <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">

            {/* Log */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between px-3 pt-2 pb-1 flex-shrink-0">
                <span className="text-xs text-slate-500">Log</span>
                <button onClick={() => setLogs([])} className="text-xs text-slate-600 hover:text-slate-400">Xoá</button>
              </div>
              <div ref={logRef} className="px-3 pb-3 flex-1 overflow-y-auto text-xs font-mono space-y-0.5 min-h-0">
                {logs.length === 0 && <span className="text-slate-700">Log sẽ hiện ở đây...</span>}
                {logs.map((l, i) => (
                  <div key={i} className={l.msg.startsWith('❌') ? 'text-red-400' : l.msg.startsWith('✅') || l.msg.startsWith('✓') ? 'text-green-400' : 'text-slate-400'}>
                    <span className="text-slate-600">{l.t} </span>{l.msg}
                  </div>
                ))}
              </div>
            </div>

            {/* Lịch sử đăng */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex-shrink-0">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-medium text-slate-400">Lịch sử đăng</h4>
                {history.length > 0 && (
                  <button onClick={() => { setHistory([]); saveHistory([]); }} className="text-xs text-slate-600 hover:text-slate-400">Xoá</button>
                )}
              </div>
              {history.length === 0
                ? <p className="text-xs text-slate-700">Chưa có lịch sử.</p>
                : (
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {history.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-slate-800 last:border-0">
                        {h.success ? <CheckCircle size={11} className="text-green-400 flex-shrink-0" /> : <XCircle size={11} className="text-red-400 flex-shrink-0" />}
                        <span className="text-slate-500 flex-shrink-0">{h.time}</span>
                        <span className="text-slate-300 truncate">{h.video}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

          </div>{/* end cột phải */}

        </div>
        )}

        {/* ─── TAB: Ảnh Viral ───────────────────────────────────────────── */}
        {activeTab === 'viral_img' && (
          <div className="p-4 flex gap-4 h-full overflow-hidden">
            {/* Left: controls */}
            <div className="w-72 flex-shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">🖼 Gen Ảnh Đếm Con Vật</div>

              {/* Source folder */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Thư mục ảnh nguồn</label>
                <div className="flex gap-1">
                  <input value={viralSrcFolder} onChange={e => setViralSrcFolder(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white min-w-0" />
                  <button onClick={async () => { const d = await api?.selectFolder?.(); if(d) setViralSrcFolder(d); }}
                    className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs">📂</button>
                </div>
              </div>

              {/* Background color */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Màu nền</label>
                <div className="flex flex-wrap gap-1.5">
                  {BG_COLORS.map(c => (
                    <button key={c} onClick={() => setViralBgColor(c)}
                      style={{ background: c }}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${viralBgColor === c ? 'border-white scale-110' : 'border-transparent'}`} />
                  ))}
                  <input type="color" value={viralBgColor} onChange={e => setViralBgColor(e.target.value)}
                    className="w-8 h-8 rounded-full border-2 border-slate-600 cursor-pointer bg-transparent" />
                </div>
              </div>

              {/* Animal choice */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Con vật</label>
                <select value={viralAnimalChoice} onChange={e => setViralAnimalChoice(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white">
                  <option value="random">🎲 Ngẫu nhiên</option>
                  {ANIMAL_LIST.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Caption */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Caption (tự gen sau khi tạo ảnh)</label>
                <textarea value={viralCaption} onChange={e => setViralCaption(e.target.value)}
                  rows={4} className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white resize-none" />
              </div>

              {/* Save dir */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Thư mục lưu ảnh</label>
                <div className="flex gap-1">
                  <input value={viralSaveDir} onChange={e => setViralSaveDir(e.target.value)}
                    placeholder="Mặc định: Downloads..."
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white min-w-0 placeholder-slate-600" />
                  <button onClick={async () => { const d = await api?.selectFolder?.(); if(d) setViralSaveDir(d); }}
                    className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs">📂</button>
                </div>
              </div>

              {/* Actions */}
              {/* Manual actions */}
              <div className="flex gap-1.5">
                <button onClick={generateViralImage} disabled={viralGenerating || viralAutoOn}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold">
                  {viralGenerating ? '⏳...' : '🎲 Tạo ảnh'}
                </button>
                {viralImagePath && (
                  <button onClick={saveAndPostViralImage} disabled={viralPosting || viralAutoOn || (!pageToken && !pages.length)}
                    className="flex-1 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold">
                    {viralPosting ? '⏳...' : '📤 Đăng FB'}
                  </button>
                )}
              </div>

              {/* Auto scheduler */}
              <div className="border border-slate-700 rounded-lg p-3 flex flex-col gap-2">
                <div className="text-xs font-bold text-slate-300">⏰ Tự động gen + đăng</div>

                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                  {[['interval','⏱ Theo khoảng'],['fixed','🕐 Giờ cố định']].map(([m, lbl]) => (
                    <button key={m} disabled={viralAutoOn}
                      onClick={() => { setViralSchedMode(m); try { localStorage.setItem('fluxy_fb_viral_sched_mode', m); } catch {} }}
                      className={`flex-1 py-1.5 font-medium transition-colors disabled:opacity-50 ${viralSchedMode === m ? 'bg-purple-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>

                {viralSchedMode === 'interval' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 whitespace-nowrap">Mỗi</span>
                    <input type="number" min={1} max={72} value={viralIntervalH}
                      onChange={e => setViralIntervalH(Math.max(1, +e.target.value))}
                      disabled={viralAutoOn}
                      className="w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white text-center disabled:opacity-50" />
                    <span className="text-xs text-slate-400">giờ</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-slate-400">Chọn giờ đăng hàng ngày:</span>
                    <div className="grid grid-cols-8 gap-1">
                      {Array.from({length:24},(_,h)=>{
                        const selected = viralFixedHours.split(',').map(s=>parseInt(s.trim())).includes(h);
                        return (
                          <button key={h} disabled={viralAutoOn}
                            onClick={() => {
                              const cur = viralFixedHours.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n));
                              const next = selected ? cur.filter(n=>n!==h) : [...cur,h];
                              next.sort((a,b)=>a-b);
                              const str = next.join(',');
                              setViralFixedHours(str);
                              try { localStorage.setItem('fluxy_fb_viral_fixed_hours', str); } catch {}
                            }}
                            className={`py-1 rounded text-xs font-mono font-bold transition-colors disabled:opacity-50 ${selected ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}>
                            {String(h).padStart(2,'0')}h
                          </button>
                        );
                      })}
                    </div>
                    {viralFixedHours && viralFixedHours.split(',').filter(s=>s.trim()).length > 0 && (
                      <div className="text-xs text-purple-300">
                        Đã chọn: {viralFixedHours.split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)).sort((a,b)=>a-b).map(h=>`${String(h).padStart(2,'0')}:00`).join(' · ')}
                      </div>
                    )}
                  </div>
                )}

                {viralNextAt && viralAutoOn && (
                  <div className="text-xs text-yellow-400">
                    ⏰ Đăng tiếp: {new Date(viralNextAt).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                  </div>
                )}
                <button onClick={toggleViralAuto}
                  className={`w-full py-2 rounded-lg text-xs font-bold transition-colors ${viralAutoOn ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}>
                  {viralAutoOn ? '⏹ Dừng tự động' : '▶ Bật tự động'}
                </button>
              </div>

              {viralLog && (
                <div className={`text-xs font-mono p-2 rounded ${viralLog.startsWith('✅') ? 'bg-green-900/30 text-green-300' : viralLog.startsWith('❌') ? 'bg-red-900/30 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
                  {viralLog}
                </div>
              )}
            </div>

            {/* Right: preview */}
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
              {viralPreview ? (
                <>
                  <img src={viralPreview} alt="preview" className="max-w-full max-h-full object-contain" />
                  {viralAnimalName && (
                    <div className="p-2 text-xs text-slate-400 text-center">
                      <strong className="text-white">{viralAnimalName}</strong> — nhấn "Tạo ảnh ngẫu nhiên" để gen lại
                    </div>
                  )}
                </>
              ) : (
                <div className="text-slate-600 text-sm text-center p-8">
                  <div className="text-4xl mb-3">🐻🦆🐰</div>
                  <div className="font-bold text-slate-400 mb-1">Nhấn "Tạo ảnh ngẫu nhiên"</div>
                  <div className="text-xs">Sẽ pick ngẫu nhiên 1 con vật từ thư mục,<br/>sắp xếp nhiều con lên nền màu,<br/>gen caption "đếm xem có bao nhiêu con"</div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
