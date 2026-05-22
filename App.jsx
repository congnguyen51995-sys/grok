import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Play, Plus, Download, RefreshCw, Trash2, X, Pause, Ban,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Terminal, LogIn, Pencil,
  Square, CheckSquare, Loader2, AlertCircle, Clock, Film,
  Image as ImageIcon, Folder, FolderOpen, ExternalLink,
  UploadCloud, Mic, ShieldCheck, Layers, Sparkles
} from 'lucide-react'
import JobCard from './components/JobCard'
import VoiceStudio from './components/VoiceStudio'
import VideoStudio from './components/VideoStudio'
import VeoStudio from './components/VeoStudio'
import CreatorStudio from './components/CreatorStudio'
import AutoAnimation from './components/AutoAnimation'

const MODES = [
  { value: 'TEXT_TO_IMAGE',  label: 'Text to Image',      short: 'T2I' },
  { value: 'TEXT_TO_VIDEO',  label: 'Text to Video',      short: 'T2V' },
  { value: 'IMAGE_TO_VIDEO', label: 'Image to Video',     short: 'I2V' },
  { value: 'REF_TO_VIDEO',   label: 'Reference to Video', short: 'R2V' },
  { value: 'VIDEO_EXTEND',   label: 'Video Extend',       short: 'VE'  },
]

const MODE_FILE_TYPE = {
  IMAGE_TO_VIDEO: 'image',
  REF_TO_VIDEO:   'video',
  VIDEO_EXTEND:   'video',
}

const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '9:16', '16:9']
const QUALITY_OPTIONS = ['480p', '720p']

const DEFAULT_PROFILES = [
  { id: 1, name: 'Profile 1', mode: 'TEXT_TO_VIDEO', aspectRatio: '9:16', quality: '720p', duration: 6, concurrency: 5 },
  { id: 2, name: 'Profile 2', mode: 'TEXT_TO_IMAGE', aspectRatio: '1:1',  quality: '720p', duration: 6, concurrency: 5  },
]

function getModeShort(mode) {
  return MODES.find(m => m.value === mode)?.short || (mode || '').slice(0, 3)
}

function SettingsModal({ profile, downloadsDir, onSave, onClose, dark }) {
  const [ar,       setAr]       = useState(profile.aspectRatio || '16:9')
  const [quality,  setQuality]  = useState(profile.quality || '720p')
  const [dur,      setDur]      = useState(profile.duration || 6)
  const [conc,     setConc]     = useState(profile.concurrency || 5)
  const [dlDir,    setDlDir]    = useState(downloadsDir || '')

  const handleSelectFolder = async () => {
    const chosen = await window.electronAPI.selectFolder()
    if (chosen) setDlDir(chosen)
  }

  const handleSaveClick = () => {
    onSave({ aspectRatio: ar, quality, duration: dur, concurrency: conc, downloadsDir: dlDir });
  }

  const modal  = dark ? 'bg-slate-800 border-slate-700' : 'bg-white'
  const label  = dark ? 'text-slate-400' : 'text-gray-400'
  const btnOff = dark ? 'border-slate-600 text-slate-300 hover:border-blue-400' : 'border-gray-200 text-gray-600 hover:border-blue-300'
  const btnOn  = 'bg-blue-500 text-white border-blue-500'
  const divider = dark ? 'border-slate-700' : 'border-gray-100'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className={`rounded-2xl shadow-2xl w-80 border ${modal}`}>
        <div className={`p-5 border-b ${divider} flex items-center justify-between`}>
          <h3 className={`font-bold ${dark ? 'text-slate-100' : 'text-gray-800'}`}>Cài đặt · {profile.name}</h3>
          <button onClick={onClose} className={`p-1 rounded-lg ${dark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
            <X className={`w-4 h-4 ${dark ? 'text-slate-400' : 'text-gray-400'}`} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${label}`}>Tỷ lệ khung hình</p>
            <div className="flex flex-wrap gap-2">
              {ASPECT_RATIOS.map(r => (
                <button key={r} onClick={() => setAr(r)} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${ar === r ? btnOn : btnOff}`}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${label}`}>Chất lượng video</p>
            <div className="flex gap-2">
              {QUALITY_OPTIONS.map(q => (
                <button key={q} onClick={() => setQuality(q)} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${quality === q ? btnOn : btnOff}`}>{q}</button>
              ))}
            </div>
          </div>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${label}`}>Thời lượng video</p>
            <div className="flex gap-2">
              {[6, 10].map(d => (
                <button key={d} onClick={() => setDur(d)} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${dur === d ? btnOn : btnOff}`}>{d}s</button>
              ))}
            </div>
          </div>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${label}`}>Số luồng song song</p>
            <input type="number" min="1" max="50" value={conc}
              onChange={e => setConc(Math.max(1, parseInt(e.target.value) || 1))}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${dark ? 'bg-slate-700 border-slate-600 text-slate-100' : 'border-gray-200 text-gray-700'}`} />
          </div>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${label}`}>Thư mục lưu file</p>
            <div className={`flex items-center gap-2 p-2.5 rounded-xl border ${dark ? 'bg-slate-700 border-slate-600' : 'bg-gray-50 border-gray-200'}`}>
              <FolderOpen className={`w-4 h-4 flex-shrink-0 ${dark ? 'text-blue-400' : 'text-blue-500'}`} />
              <span className={`text-xs truncate flex-1 ${dark ? 'text-slate-300' : 'text-gray-600'}`} title={dlDir}>
                {dlDir ? dlDir.split(/[\\/]/).pop() || dlDir : 'GrokStudio_Downloads'}
              </span>
              <button onClick={handleSelectFolder} className={`text-xs font-medium px-2 py-1 rounded-lg transition-colors ${dark ? 'bg-slate-600 text-slate-200 hover:bg-slate-500' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'}`}>Đổi</button>
            </div>
          </div>
        </div>
        <div className={`p-5 border-t ${divider} flex gap-3`}>
          <button onClick={onClose} className={`flex-1 border rounded-xl py-2.5 text-sm font-medium transition-colors ${dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Hủy</button>
          <button onClick={handleSaveClick} className="flex-1 bg-blue-500 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-600">Lưu</button>
        </div>
      </div>
    </div>
  )
}

export default function App({ onLicenseExpired }) {
  const [currentTab,      setCurrentTab]      = useState('grok') 
  const [jobs,            setJobs]            = useState([])
  const [profiles,        setProfiles]        = useState(DEFAULT_PROFILES)
  const [loginStatus,     setLoginStatus]     = useState({})
  const [activeProfileId, setActiveProfileId] = useState(1)
  const [editingProfileId, setEditingProfileId] = useState(null)
  const [editingName,      setEditingName]      = useState('')
  const [promptText,       setPromptText]       = useState('')
  const [queueOpen,        setQueueOpen]        = useState(true)
  const [selectedJobs,     setSelectedJobs]     = useState(new Set())
  const [showSettings,     setShowSettings]     = useState(false)
  const [adding,           setAdding]           = useState(false)
  const dark = true
  const [downloadsDir,     setDownloadsDir]     = useState('')
  const [previewJob,       setPreviewJob]       = useState(null)

  const [i2vItems,         setI2vItems]         = useState([])
  const [bulkPromptText,   setBulkPromptText]   = useState('')
  const [r2vImages,        setR2vImages]        = useState([])

  // --- STATE BẢN QUYỀN GLOBAL ---
  const [licenseData, setLicenseData] = useState({ daysLeft: 0, isActive: false });

  // --- AUTO UPDATE ---
  const [updateInfo,     setUpdateInfo]     = useState(null);   // { newVersion, releaseNotes, downloadUrl }
  const [updatePhase,    setUpdatePhase]    = useState('idle'); // idle | downloading | ready | error
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError,    setUpdateError]    = useState('');

  // --- UI COLLAPSE ---
  const [grokSidebarOpen, setGrokSidebarOpen] = useState(true);
  const [grokLogOpen,     setGrokLogOpen]     = useState(false);
  const [grokLogs,        setGrokLogs]        = useState([{ time: new Date().toLocaleTimeString(), text: 'Grok Studio sẵn sàng', type: 'success' }]);
  const grokLogsEndRef = useRef(null);
  const [isQueuePaused,   setIsQueuePaused]   = useState(false);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0]

  const pendingJobs   = jobs.filter(j => j.status === 'PENDING')
  const runningJobs   = jobs.filter(j => j.status === 'RUNNING')
  const completedJobs = jobs.filter(j => j.status === 'COMPLETED')
  const failedJobs    = jobs.filter(j => j.status === 'FAILED')
  const promptLines   = promptText.split('\n').filter(l => l.trim()).length

  // --- CHECK BẢN QUYỀN MỖI 1 PHÚT (hiển thị số ngày + đá ra nếu hết hạn) ---
  useEffect(() => {
    const checkGlobalLicense = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/system-status');
            if (res.ok) {
                const data = await res.json();
                const isActive = data.license?.isActive || false;
                const daysLeft = data.license?.daysLeft || 0;
                setLicenseData({ daysLeft, isActive });
                // Nếu hết hạn → đá về màn hình nhập key
                if (!isActive && onLicenseExpired) onLicenseExpired();
            }
        } catch (e) {}
    };
    checkGlobalLicense();
    const intervalId = setInterval(checkGlobalLicense, 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Lắng nghe sự kiện update từ main process
  useEffect(() => {
    window.electronAPI?.onUpdateAvailable?.(info => {
      setUpdateInfo(info);
      setUpdatePhase('idle');
    });
    window.electronAPI?.onUpdateProgress?.(({ percent }) => {
      setUpdateProgress(percent);
    });
  }, []);

  const handleDownloadUpdate = async () => {
    setUpdatePhase('downloading');
    setUpdateError('');
    setUpdateProgress(0);
    const res = await window.electronAPI?.downloadUpdate?.();
    if (res?.success) {
      setUpdatePhase('ready');
    } else {
      setUpdatePhase('error');
      setUpdateError(res?.error || 'Tải thất bại');
    }
  };

  const handleInstallUpdate = async () => {
    await window.electronAPI?.installUpdate?.();
  };

  const loadJobs = useCallback(async () => {
    try { setJobs(await window.electronAPI.getJobs() || []) } catch (e) { console.error(e) }
  }, [])

  const refreshLoginStatus = useCallback(async (profileList) => {
    try {
      const ids = (profileList || profiles).map(p => p.id)
      setLoginStatus(await window.electronAPI.checkAllLogins(ids) || {})
    } catch (e) { console.error(e) }
  }, [profiles])

  useEffect(() => {
    loadJobs()

    Promise.all([
      window.electronAPI.getSetting('profiles', null),
      window.electronAPI.getDownloadsDir(),
    ]).then(([profilesJson, dlDir]) => {
      if (profilesJson) {
        try {
          const p = JSON.parse(profilesJson);
          if (p && p.length > 0) {
            setProfiles(p);
            setActiveProfileId(p[0].id);
            refreshLoginStatus(p);
          }
        } catch (_) {}
      } else {
        refreshLoginStatus(DEFAULT_PROFILES)
      }
      setDownloadsDir(dlDir || '')
    }).catch(() => refreshLoginStatus(DEFAULT_PROFILES))

    window.electronAPI.onJobProgress(({ jobId, progress }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, progress, status: 'RUNNING' } : j))
      if (progress > 0 && progress % 25 === 0) {
        setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `Job #${jobId}: ${progress}%`, type: 'info' }])
      }
    })

    window.electronAPI.onJobComplete(({ jobId, localPath }) => {
      setJobs(prev => prev.map(j => j.id === jobId
        ? { ...j, status: 'COMPLETED', local_file_path: localPath, progress: 100 } : j))
      const fname = localPath ? localPath.split(/[\\/]/).pop() : 'file'
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `✅ Job #${jobId} hoàn tất — ${fname}`, type: 'success' }])
    })

    window.electronAPI.onJobError(({ jobId, error }) => {
      setJobs(prev => prev.map(j => j.id === jobId
        ? { ...j, status: 'FAILED', error_message: error } : j))
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `❌ Job #${jobId} lỗi: ${error}`, type: 'error' }])
      setGrokLogOpen(true)
    })

    return () => ['job-progress', 'job-complete', 'job-error']
      .forEach(ch => window.electronAPI.removeAllListeners(ch))
  }, [loadJobs])

  useEffect(() => { grokLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [grokLogs])

  const handleOpen = async (job) => {
    if (job.local_file_path) {
      try { await window.electronAPI.openFile(job.local_file_path); } catch (e) { console.error("Lỗi mở file:", e); }
    }
  }

  const saveProfiles = async (updated) => {
    setProfiles(updated)
    await window.electronAPI.setSetting('profiles', JSON.stringify(updated))
  }

  const handleAddProfile = async () => {
    const newId = Date.now()
    const np = { id: newId, name: `Profile ${profiles.length + 1}`, mode: 'TEXT_TO_IMAGE', aspectRatio: '1:1', duration: 6, concurrency: 5 }
    const updated = [...profiles, np]
    await saveProfiles(updated)
    setActiveProfileId(newId)
    try {
      await window.electronAPI.openBrowserLogin(newId)
      const s = await window.electronAPI.checkLogin(newId)
      setLoginStatus(prev => ({ ...prev, [newId]: s }))
    } catch (e) { console.error(e) }
  }

  const handleLoginProfile = async (profileId) => {
    try {
      await window.electronAPI.openBrowserLogin(profileId)
      const s = await window.electronAPI.checkLogin(profileId)
      setLoginStatus(prev => ({ ...prev, [profileId]: s }))
    } catch (e) { console.error(e) }
  }

  const handleDeleteProfile = async (profileId) => {
    if (profiles.length <= 1) return
    const updated = profiles.filter(p => p.id !== profileId)
    await saveProfiles(updated)
    if (activeProfileId === profileId) setActiveProfileId(updated[0].id)
    setLoginStatus(prev => { const n = { ...prev }; delete n[profileId]; return n })
  }

  const handleRenameProfile = async (profileId, newName) => {
    const trimmed = newName.trim()
    if (!trimmed) return
    await saveProfiles(profiles.map(p => p.id === profileId ? { ...p, name: trimmed } : p))
    setEditingProfileId(null)
  }

  const handleSaveSettings = async (newSettings) => {
    try {
      const updatedProfiles = profiles.map(p => 
        p.id === activeProfileId 
          ? { ...p, aspectRatio: newSettings.aspectRatio, quality: newSettings.quality, duration: newSettings.duration, concurrency: newSettings.concurrency } 
          : p
      );
      setProfiles(updatedProfiles);
      if (newSettings.downloadsDir) setDownloadsDir(newSettings.downloadsDir);
      setShowSettings(false);
      await window.electronAPI.setSetting('profiles', JSON.stringify(updatedProfiles));
      await window.electronAPI.setConcurrency(newSettings.concurrency);
    } catch (error) { console.error(error); }
  }

  const handleSelectMultipleImages = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    const newItems = files.map(f => ({ id: Math.random() + f.name, path: f.path, prompt: '' }));
    setI2vItems(prev => [...prev, ...newItems]);
    e.target.value = null; 
  }

  const handleUpdateI2vPrompt = (id, newPrompt) => {
    setI2vItems(prev => prev.map(item => item.id === id ? { ...item, prompt: newPrompt } : item));
  }

  const handleRemoveI2vItem = (id) => {
    setI2vItems(prev => prev.filter(item => item.id !== id));
  }

  const handleClearAllI2vItems = () => {
    setI2vItems([]);
    setBulkPromptText('');
  }

  const handleAssignBulkPrompts = () => {
    const lines = bulkPromptText.split('\n').map(l => l.trim()).filter(Boolean);
    setI2vItems(prev => prev.map((item, index) => {
      if (index < lines.length) return { ...item, prompt: lines[index] };
      return item; 
    }));
  }

  const handleSelectR2vImages = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    setR2vImages(prev => {
      const currentCount = prev.length;
      const allowedNew = 7 - currentCount;
      if (allowedNew <= 0) return prev;
      const filesToAdd = files.slice(0, allowedNew);
      const newItems = filesToAdd.map(f => ({ id: Math.random() + f.name, path: f.path }));
      return [...prev, ...newItems];
    });
    e.target.value = null;
  }

  const handleRemoveR2vImage = (id) => {
    setR2vImages(prev => prev.filter(item => item.id !== id));
  }

  const handleAddToQueue = async () => {
    setAdding(true)
    try {
      await window.electronAPI.setConcurrency(activeProfile.concurrency)
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `Đang thêm jobs vào hàng đợi — profile: ${activeProfile.name}`, type: 'info' }])

      const baseIndex = jobs.length;

      if (activeProfile.mode === 'IMAGE_TO_VIDEO') {
        if (i2vItems.length === 0) return;
        for (let idx = 0; idx < i2vItems.length; idx++) {
          const item = i2vItems[idx];
          const finalPrompt = item.prompt.trim() || "Tạo chuyển động tự nhiên cho bức ảnh này";
          const jobId = await window.electronAPI.createJob({
            prompt: finalPrompt,
            mode: activeProfile.mode,
            aspectRatio: activeProfile.aspectRatio,
            quality: activeProfile.quality || '720p',
            duration: activeProfile.duration,
            imageFile: item.path,
            profileId: activeProfile.id,
            profileName: activeProfile.name,
            fileIndex: baseIndex + idx + 1,
          })
          setJobs(prev => [{
            id: jobId, prompt: finalPrompt, mode: activeProfile.mode,
            status: 'PENDING', progress: 0,
            aspect_ratio: activeProfile.aspectRatio,
            resolution: activeProfile.quality || '720p',
            duration: activeProfile.duration,
            image_file: item.path,
            profile_id: activeProfile.id, profile_name: activeProfile.name,
            local_file_path: null, error_message: null,
            created_at: new Date().toISOString()
          }, ...prev])
        }
        setI2vItems([]) 
        setBulkPromptText('')
      } 
      else if (activeProfile.mode === 'REF_TO_VIDEO') {
        const lines = promptText.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;

        const r2vPaths = r2vImages.map(img => img.path);
        // Ghép 1:1 nếu số ảnh == số prompts; ngược lại tất cả ảnh → tất cả prompts
        const r2vPerPrompt = r2vPaths.length > 1 && r2vPaths.length === lines.length;

        for (let idx = 0; idx < lines.length; idx++) {
          const prompt = lines[idx];
          const sceneImages = r2vPerPrompt ? [r2vPaths[idx]] : r2vPaths;
          const imgArrayJson = JSON.stringify(sceneImages);
          const jobId = await window.electronAPI.createJob({
            prompt,
            mode: activeProfile.mode,
            aspectRatio: activeProfile.aspectRatio,
            quality: activeProfile.quality || '720p',
            duration: activeProfile.duration,
            imageFile: imgArrayJson,
            profileId: activeProfile.id,
            profileName: activeProfile.name,
            fileIndex: baseIndex + idx + 1,
          })
          setJobs(prev => [{
            id: jobId, prompt, mode: activeProfile.mode,
            status: 'PENDING', progress: 0,
            aspect_ratio: activeProfile.aspectRatio,
            resolution: activeProfile.quality || '720p',
            duration: activeProfile.duration,
            image_file: imgArrayJson, 
            profile_id: activeProfile.id, profile_name: activeProfile.name,
            local_file_path: null, error_message: null,
            created_at: new Date().toISOString()
          }, ...prev])
        }
        setPromptText('')
      }
      else {
        const lines = promptText.split('\n').map(l => l.trim()).filter(Boolean)
        if (!lines.length) return;

        for (let idx = 0; idx < lines.length; idx++) {
          const prompt = lines[idx];
          const jobId = await window.electronAPI.createJob({
            prompt, mode: activeProfile.mode,
            aspectRatio: activeProfile.aspectRatio,
            quality:     activeProfile.quality || '720p',
            duration:    activeProfile.duration,
            profileId:   activeProfile.id, profileName: activeProfile.name,
            fileIndex:   baseIndex + idx + 1,
          })
          setJobs(prev => [{
            id: jobId, prompt, mode: activeProfile.mode,
            status: 'PENDING', progress: 0,
            aspect_ratio: activeProfile.aspectRatio,
            resolution:   activeProfile.quality || '720p',
            duration:     activeProfile.duration,
            profile_id:   activeProfile.id, profile_name: activeProfile.name,
            local_file_path: null, error_message: null,
            created_at: new Date().toISOString()
          }, ...prev])
        }
        setPromptText('')
      }
    } catch (e) { console.error(e) }
    finally { setAdding(false) }
  }

  const handleRetry = async (job) => {
    try { await window.electronAPI.retryJob(job.id); await loadJobs() } catch (e) { console.error(e) }
  }

  const handleDelete = async (jobId) => {
    await window.electronAPI.deleteJob(jobId)
    setJobs(prev => prev.filter(j => j.id !== jobId))
    setSelectedJobs(prev => { const s = new Set(prev); s.delete(jobId); return s })
  }

  const handleDeleteSelected = async () => { for (const id of [...selectedJobs]) await handleDelete(id) }
  const handleRetryFailed    = async () => { for (const job of failedJobs) await handleRetry(job) }
  const toggleSelectAll = () => selectedJobs.size > 0 ? setSelectedJobs(new Set()) : setSelectedJobs(new Set(jobs.map(j => j.id)))
  const toggleSelect = id => setSelectedJobs(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // Cancel a single pending/running job
  const handleCancelJob = async (jobId) => {
    try {
      await window.electronAPI?.deleteJob?.(jobId);
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'CANCELLED' } : j));
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `⛔ Job #${jobId} đã bị hủy`, type: 'error' }]);
    } catch (e) { console.error(e) }
  }

  // Stop all pending + running jobs
  const handleStopAll = async () => {
    const toStop = jobs.filter(j => j.status === 'PENDING' || j.status === 'RUNNING');
    for (const job of toStop) {
      try { await window.electronAPI?.deleteJob?.(job.id); } catch (_) {}
    }
    setJobs(prev => prev.map(j =>
      (j.status === 'PENDING' || j.status === 'RUNNING') ? { ...j, status: 'CANCELLED' } : j
    ));
    setIsQueuePaused(false);
    setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: `⛔ Đã dừng ${toStop.length} job(s).`, type: 'error' }]);
  }

  // Pause / resume queue
  const handlePauseResumeQueue = () => {
    if (isQueuePaused) {
      setIsQueuePaused(false);
      window.electronAPI?.resumeQueue?.();
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: '▶ Tiếp tục hàng đợi.', type: 'info' }]);
    } else {
      setIsQueuePaused(true);
      window.electronAPI?.pauseQueue?.();
      setGrokLogs(prev => [...prev.slice(-199), { time: new Date().toLocaleTimeString(), text: '⏸ Tạm dừng hàng đợi.', type: 'info' }]);
    }
  }

  const bg0   = dark ? 'bg-slate-950'  : 'bg-gray-50'
  const bg1   = dark ? 'bg-slate-900'  : 'bg-white'
  const bg2   = dark ? 'bg-slate-800'  : 'bg-white'
  const bdr   = dark ? 'border-slate-700' : 'border-gray-100'
  const txt1  = dark ? 'text-slate-100'   : 'text-gray-800'
  const txt2  = dark ? 'text-slate-300'   : 'text-gray-700'
  const txt3  = dark ? 'text-slate-400'   : 'text-gray-600'
  const txt4  = dark ? 'text-slate-500'   : 'text-gray-400'
  const inp   = dark ? `bg-slate-800 border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-blue-500` : `border-gray-200 text-gray-700 placeholder-gray-300 focus:ring-blue-500`
  const hov1  = dark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
  const hov2  = dark ? 'hover:bg-slate-800' : 'hover:bg-gray-50'

  return (
    <div className={`h-screen flex flex-col ${bg0} transition-colors duration-200`}
      style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>

      {/* ── BANNER CẬP NHẬT ──────────────────────────────────────────────── */}
      {updateInfo && (
        <div className="shrink-0 bg-gradient-to-r from-violet-900/90 to-blue-900/90 border-b border-violet-500/30 px-4 py-2 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-bold text-violet-200">
              🚀 Có bản cập nhật mới: <span className="text-white">v{updateInfo.newVersion}</span>
            </span>
            {updateInfo.releaseNotes && (
              <span className="ml-2 text-[10px] text-violet-300 truncate">{updateInfo.releaseNotes}</span>
            )}
            {updatePhase === 'downloading' && (
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 bg-violet-900 rounded-full h-1.5 max-w-xs">
                  <div className="bg-violet-400 h-1.5 rounded-full transition-all" style={{ width: `${updateProgress}%` }}/>
                </div>
                <span className="text-[10px] text-violet-300">{updateProgress}%</span>
              </div>
            )}
            {updatePhase === 'error' && (
              <span className="ml-2 text-[10px] text-red-400">⚠ {updateError}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {updatePhase === 'idle' && (
              <button onClick={handleDownloadUpdate}
                className="px-3 py-1 bg-violet-500 hover:bg-violet-400 text-white text-[11px] font-bold rounded-lg transition-colors">
                Tải về
              </button>
            )}
            {updatePhase === 'downloading' && (
              <button disabled className="px-3 py-1 bg-violet-700 text-violet-300 text-[11px] font-bold rounded-lg cursor-not-allowed">
                Đang tải...
              </button>
            )}
            {updatePhase === 'ready' && (
              <button onClick={handleInstallUpdate}
                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold rounded-lg transition-colors animate-pulse">
                Cài đặt ngay
              </button>
            )}
            {updatePhase === 'error' && (
              <button onClick={handleDownloadUpdate}
                className="px-3 py-1 bg-orange-500 hover:bg-orange-400 text-white text-[11px] font-bold rounded-lg transition-colors">
                Thử lại
              </button>
            )}
            <button onClick={() => setUpdateInfo(null)}
              className="text-violet-400 hover:text-white text-[11px] px-1 transition-colors">✕</button>
          </div>
        </div>
      )}

      {/* --- CẬP NHẬT HEADER BAO GỒM BẢN QUYỀN --- */}
      <header className="h-14 bg-black flex items-center px-4 gap-3 flex-shrink-0">

        {/* Logo Fluxy */}
        <div className="flex items-center gap-2 border-r border-slate-800 pr-4 mr-1 shrink-0">
          <img src="logo.png" alt="Fluxy" className="h-8 w-8 rounded-lg object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-black text-white tracking-wide">Fluxy</span>
            <span className="text-[9px] font-medium text-slate-500 tracking-wider uppercase">Thành Công Media</span>
            <span className="text-[9px] font-semibold text-amber-500 leading-none mt-0.5">SĐT/Zalo: 0866680795</span>
          </div>
        </div>

        {/* Nút Tab */}
        <div className="flex items-center gap-1.5 border-r border-slate-800 pr-3 mr-1">
            <button onClick={() => setCurrentTab('grok')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${currentTab === 'grok' ? 'bg-white text-black' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            Grok Studio
            </button>
            <button onClick={() => setCurrentTab('veo')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-2 ${currentTab === 'veo' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            Veo Studio
            </button>
            <button onClick={() => setCurrentTab('voice')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-2 ${currentTab === 'voice' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <Mic size={16} /> Voice Studio
            </button>
            <button onClick={() => setCurrentTab('video')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-2 ${currentTab === 'video' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <Film size={16} /> Video Editor
            </button>
            <button onClick={() => setCurrentTab('creator')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-2 ${currentTab === 'creator' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <Sparkles size={16} /> Creator
            </button>
            <button onClick={() => setCurrentTab('auto')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors flex items-center gap-2 ${currentTab === 'auto' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
            <Layers size={16} /> Auto Animation
            </button>
        </div>

        {/* --- KHỐI BẢN QUYỀN GLOBAL --- */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg shadow-inner">
          <ShieldCheck size={18} className={licenseData.daysLeft > 0 ? "text-amber-500" : "text-rose-500"} />
          <div className="flex flex-col">
            <span className="text-[10px] text-amber-500/80 font-bold uppercase leading-none">Bản quyền phần mềm</span>
            {licenseData.daysLeft > 0 ? (
              <span className="text-[12px] font-black text-amber-400 leading-tight">{licenseData.daysLeft} Ngày <span className="text-[10px] font-medium text-slate-400 ml-1">(Đã kích hoạt)</span></span>
            ) : (
              <span className="text-[12px] font-black text-rose-500 leading-tight">Đã hết hạn</span>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {runningJobs.length > 0 && (
          <div className="relative mr-1">
            <Terminal className="w-5 h-5 text-gray-400" />
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center font-bold px-0.5">
              {runningJobs.length}
            </span>
          </div>
        )}

      </header>

      {/* --- KHU VỰC HIỂN THỊ NỘI DUNG TÙY THEO TAB --- */}
      {/* Tất cả tab luôn mounted (CSS display:none khi ẩn) để job đang chạy không bị ngắt khi đổi tab */}
      <div className="flex-1 overflow-hidden relative">

        {/* ── VEO STUDIO (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'veo' ? 'flex' : 'none' }}>
          <VeoStudio dark={dark} />
        </div>

        {/* ── VOICE STUDIO (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'voice' ? 'flex' : 'none' }}>
          <VoiceStudio dark={dark} />
        </div>

        {/* ── VIDEO EDITOR (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'video' ? 'flex' : 'none' }}>
          <VideoStudio dark={dark} />
        </div>

        {/* ── CREATOR STUDIO (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'creator' ? 'flex' : 'none' }}>
          <CreatorStudio />
        </div>

        {/* ── AUTO ANIMATION (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'auto' ? 'flex' : 'none' }}>
          <AutoAnimation />
        </div>

        {/* ── GROK STUDIO (always mounted) ── */}
        <div className="absolute inset-0 w-full h-full" style={{ display: currentTab === 'grok' ? 'flex' : 'none' }}>
        <div className="flex w-full h-full bg-[#0a0f18] text-slate-300 font-sans relative">

            {/* ── NÚT TOGGLE SIDEBAR ── */}
            <button
              onClick={() => setGrokSidebarOpen(v => !v)}
              className="absolute top-1/2 -translate-y-1/2 z-20 w-5 h-10 flex items-center justify-center bg-[#1e293b] border border-slate-700 rounded-r-md hover:bg-slate-700 transition-colors shadow-lg"
              style={{ left: grokSidebarOpen ? '360px' : '0px' }}
              title={grokSidebarOpen ? 'Ẩn bảng điều khiển' : 'Mở bảng điều khiển'}
            >
              {grokSidebarOpen ? <ChevronLeft size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
            </button>

            {/* ── SIDEBAR TRÁI ── */}
            <div className={`bg-[#141c2f] border-r border-slate-800/80 flex flex-col shrink-0 h-full shadow-2xl z-10 transition-all duration-300 overflow-hidden ${grokSidebarOpen ? 'w-[360px]' : 'w-0'}`}>
              <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar w-[360px]">

                {/* ── PROFILE ── */}
                <div className="bg-[#1e293b]/60 border border-slate-700/60 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Profile đang dùng</label>
                    <button onClick={handleAddProfile} className="text-[9px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 transition-colors">
                      <Plus size={9} /> Thêm
                    </button>
                  </div>
                  <div className="space-y-1">
                    {profiles.map(p => {
                      const logged   = loginStatus[p.id]?.isLoggedIn
                      const isActive = activeProfileId === p.id
                      return (
                        <div key={p.id}
                          className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all cursor-pointer ${isActive ? 'bg-blue-600/20 border-blue-500/50' : 'border-slate-700/50 hover:bg-slate-700/30 hover:border-slate-600'}`}
                          onClick={() => { if (editingProfileId !== p.id) setActiveProfileId(p.id) }}>
                          <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${isActive ? 'border-blue-400 bg-blue-500/40' : 'border-slate-600'}`} />
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${logged ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]' : 'bg-slate-600'}`} />
                          {editingProfileId === p.id ? (
                            <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRenameProfile(p.id, editingName); if (e.key === 'Escape') setEditingProfileId(null); }}
                              onBlur={() => handleRenameProfile(p.id, editingName)} onClick={e => e.stopPropagation()}
                              className="flex-1 text-sm bg-[#0f1524] border border-blue-500/50 text-slate-100 rounded px-1.5 py-0.5 focus:outline-none" />
                          ) : (
                            <span className={`text-[12px] font-semibold flex-1 truncate ${isActive ? 'text-blue-300' : 'text-slate-400'}`}>{p.name}</span>
                          )}
                          <div className="hidden group-hover:flex items-center gap-0.5">
                            <button onClick={e => { e.stopPropagation(); setEditingProfileId(p.id); setEditingName(p.name); }} className="p-1 rounded text-slate-600 hover:text-amber-400 hover:bg-amber-900/30 transition-colors"><Pencil className="w-3 h-3" /></button>
                            <button onClick={e => { e.stopPropagation(); handleLoginProfile(p.id) }} className="p-1 rounded text-slate-600 hover:text-blue-400 hover:bg-blue-900/30 transition-colors"><LogIn className="w-3 h-3" /></button>
                            {profiles.length > 1 && <button onClick={e => { e.stopPropagation(); handleDeleteProfile(p.id) }} className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-900/30 transition-colors"><Trash2 className="w-3 h-3" /></button>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* ── CHẾ ĐỘ — tab buttons ── */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1.5 block uppercase tracking-wider">Chế độ</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MODES.map(m => (
                      <button key={m.value}
                        onClick={() => saveProfiles(profiles.map(p => p.id === activeProfileId ? { ...p, mode: m.value } : p))}
                        className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all border ${activeProfile?.mode === m.value ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-900/30' : 'bg-[#1e293b] border-slate-700/60 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── THÔNG SỐ — grid dropdowns (ẩn Thời lượng & Chất lượng khi Text to Image) ── */}
                <div className={`grid gap-2 ${activeProfile?.mode === 'TEXT_TO_IMAGE' ? 'grid-cols-1' : 'grid-cols-3'}`}>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Tỉ lệ</label>
                    <select value={activeProfile?.aspectRatio || '9:16'}
                      onChange={e => saveProfiles(profiles.map(p => p.id === activeProfileId ? { ...p, aspectRatio: e.target.value } : p))}
                      className="bg-[#1e293b] border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-blue-500">
                      {ASPECT_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  {activeProfile?.mode !== 'TEXT_TO_IMAGE' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-blue-400 ml-1 uppercase">Thời lượng</label>
                      <select value={activeProfile?.duration || 6}
                        onChange={e => saveProfiles(profiles.map(p => p.id === activeProfileId ? { ...p, duration: parseInt(e.target.value) } : p))}
                        className="bg-[#1e293b] border border-blue-500/50 text-blue-300 font-bold text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer">
                        <option value={6}>6s</option>
                        <option value={10}>10s</option>
                      </select>
                    </div>
                  )}
                  {activeProfile?.mode !== 'TEXT_TO_IMAGE' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Chất lượng</label>
                      <select value={activeProfile?.quality || '720p'}
                        onChange={e => saveProfiles(profiles.map(p => p.id === activeProfileId ? { ...p, quality: e.target.value } : p))}
                        className="bg-[#1e293b] border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer focus:border-blue-500">
                        {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Số luồng song song */}
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Số luồng song song</label>
                  <div className="flex gap-1">
                    {[1,2,3,5,8,10].map(n => (
                      <button key={n} onClick={() => saveProfiles(profiles.map(p => p.id === activeProfileId ? { ...p, concurrency: n } : p))}
                        className={`flex-1 py-1.5 rounded-md text-[10px] font-bold border transition-all ${(activeProfile?.concurrency || 5) === n ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#1e293b] border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Thư mục lưu file */}
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Thư mục lưu file</label>
                  <button
                    onClick={async () => {
                      const chosen = await window.electronAPI.selectFolder();
                      if (chosen) setDownloadsDir(chosen);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-[#1e293b] border border-slate-700 rounded-lg hover:border-blue-500/50 hover:bg-[#243044] transition-colors group"
                    title={downloadsDir || 'GrokStudio_Downloads'}
                  >
                    <FolderOpen size={13} className="text-blue-400 flex-shrink-0" />
                    <span className="text-[11px] text-slate-300 truncate flex-1 text-left">
                      {downloadsDir || 'GrokStudio_Downloads'}
                    </span>
                    <span className="text-[9px] font-bold text-slate-500 group-hover:text-blue-400 transition-colors flex-shrink-0">Đổi</span>
                  </button>
                </div>

                {/* ── IMAGE TO VIDEO ── */}
                {activeProfile?.mode === 'IMAGE_TO_VIDEO' && (
                  <div className="bg-[#1e293b]/60 border border-slate-700/60 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><ImageIcon size={11} className="text-blue-400" /> Ảnh → Video</label>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">{i2vItems.length} ảnh</span>
                    </div>
                    <div className="flex gap-2 mb-3">
                      <label className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/30 hover:border-blue-500/50 transition-colors text-[11px] font-semibold text-slate-500">
                        <UploadCloud size={15} /> Chọn ảnh
                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleSelectMultipleImages} />
                      </label>
                      <label className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/30 hover:border-blue-500/50 transition-colors text-[11px] font-semibold text-slate-500">
                        <Folder size={15} /> Chọn folder
                        <input type="file" webkitdirectory="true" className="hidden" onChange={handleSelectMultipleImages} />
                      </label>
                      {i2vItems.length > 0 && (
                        <button onClick={handleClearAllI2vItems} className="px-3 flex flex-col items-center justify-center gap-1 border border-red-900/50 rounded-lg hover:bg-red-900/30 transition-colors text-[11px] text-red-400">
                          <Trash2 size={14} /> Xóa
                        </button>
                      )}
                    </div>
                    {i2vItems.length > 0 && (
                      <>
                        <div className="bg-[#0f1524] border border-slate-700/50 rounded-lg p-3 mb-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nhập prompt hàng loạt</label>
                          <textarea value={bulkPromptText} onChange={e => setBulkPromptText(e.target.value)}
                            placeholder="Dòng 1 → Ảnh 1&#10;Dòng 2 → Ảnh 2..." rows={3}
                            className="w-full bg-[#141c2f] border border-slate-700 rounded-lg px-2.5 py-2 text-[11px] text-slate-300 mb-2 focus:outline-none focus:border-blue-500 resize-none placeholder-slate-600" />
                          <button onClick={handleAssignBulkPrompts} className="w-full py-1.5 rounded-lg text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white transition-colors">
                            Gán prompt vào ảnh
                          </button>
                        </div>
                        <div className="space-y-2 max-h-[28vh] overflow-y-auto pr-1 custom-scrollbar">
                          {i2vItems.map(item => (
                            <div key={item.id} className="flex gap-2 items-start p-2 rounded-lg border border-slate-700/60 bg-[#0f1524]">
                              <img src={`file:///${encodeURI(item.path.replace(/\\/g, '/'))}`} className="w-10 h-10 rounded-md object-cover border border-slate-700 flex-shrink-0" />
                              <textarea value={item.prompt} onChange={e => handleUpdateI2vPrompt(item.id, e.target.value)}
                                placeholder="Prompt..." className="flex-1 text-[11px] p-2 rounded-md bg-[#141c2f] border border-slate-700 text-slate-300 resize-none h-10 focus:outline-none focus:border-blue-500 placeholder-slate-600" />
                              <button onClick={() => handleRemoveI2vItem(item.id)} className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-900/30 transition-colors flex-shrink-0"><Trash2 size={13} /></button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── REFERENCE TO VIDEO ── */}
                {activeProfile?.mode === 'REF_TO_VIDEO' && (
                  <>
                    <div className="bg-[#1e293b]/60 border border-slate-700/60 rounded-lg p-3">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ảnh tham chiếu (tùy chọn)</label>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">{r2vImages.length}/7</span>
                      </div>
                      <div className="flex gap-2 mb-2">
                        <label className={`flex-1 flex items-center justify-center gap-2 py-2 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/30 transition-colors text-[11px] font-semibold text-slate-500 ${r2vImages.length >= 7 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                          <UploadCloud size={13} /> Chọn ảnh
                          <input type="file" multiple accept="image/*" className="hidden" disabled={r2vImages.length >= 7} onChange={handleSelectR2vImages} />
                        </label>
                        <label className={`flex-1 flex items-center justify-center gap-2 py-2 border border-dashed border-slate-600 rounded-lg cursor-pointer hover:bg-slate-700/30 transition-colors text-[11px] font-semibold text-slate-500 ${r2vImages.length >= 7 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                          <Folder size={13} /> Chọn folder
                          <input type="file" webkitdirectory="true" className="hidden" disabled={r2vImages.length >= 7} onChange={handleSelectR2vImages} />
                        </label>
                      </div>
                      {r2vImages.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {r2vImages.map(img => (
                            <div key={img.id} className="relative group w-[42px] h-[42px] rounded-lg border border-slate-700 overflow-hidden flex-shrink-0">
                              <img src={`file:///${encodeURI(img.path.replace(/\\/g, '/'))}`} className="w-full h-full object-cover" />
                              <button onClick={() => handleRemoveR2vImage(img.id)} className="absolute inset-0 bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ── PROMPT ── */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 mb-1.5 block uppercase tracking-wider">
                    Prompt <span className="font-normal normal-case text-slate-600">· mỗi dòng 1 job</span>
                    {promptLines > 0 && <span className="ml-2 text-blue-400 font-bold">{promptLines} prompts</span>}
                  </label>
                  <textarea value={promptText} onChange={e => setPromptText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleAddToQueue()}
                    placeholder={activeProfile?.mode === 'REF_TO_VIDEO' ? 'Mỗi dòng là 1 prompt...' : 'Nhập mỗi dòng một prompt...'}
                    className="w-full h-[180px] bg-[#0f1524] border border-slate-700 rounded-lg px-3 py-3 text-sm text-slate-300 focus:outline-none focus:border-blue-500 resize-none custom-scrollbar placeholder-slate-600" />
                </div>

              </div>

              {/* ── NÚT THÊM VÀO HÀNG ĐỢI ── */}
              <div className="p-4 border-t border-slate-800/80 bg-[#141c2f] shrink-0">
                <button onClick={handleAddToQueue}
                  disabled={adding || (activeProfile?.mode === 'IMAGE_TO_VIDEO' ? i2vItems.length === 0 : !promptText.trim())}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition-colors flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-blue-900/20">
                  {adding ? (
                    <div className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Đang thêm...</div>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5"><Plus size={15} /> Thêm vào hàng đợi</span>
                      <span className="text-[10px] font-medium text-blue-300/70">
                        {activeProfile?.mode === 'IMAGE_TO_VIDEO' ? `${i2vItems.length} ảnh`
                          : activeProfile?.mode === 'REF_TO_VIDEO' ? `${promptLines} prompt · ${r2vImages.length} ảnh${r2vImages.length > 1 && r2vImages.length === promptLines ? ' (1:1)' : ''}`
                          : `${promptLines} prompt`} · {activeProfile?.name}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* ── QUEUE PANEL ── */}
            <div className={`bg-[#0c1220] border-r border-slate-800/80 flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden ${queueOpen ? 'w-[220px]' : 'w-0'}`}>
              <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800/80 shrink-0 bg-[#141c2f]">
                <div className="flex items-center gap-2">
                  <button onClick={() => setQueueOpen(false)} className="p-1 rounded hover:bg-slate-700 transition-colors">
                    <ChevronLeft size={14} className="text-slate-500" />
                  </button>
                  <span className="text-[12px] font-bold text-slate-300">Hàng đợi</span>
                  <span className="text-[10px] font-bold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full border border-slate-600">{pendingJobs.length}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {pendingJobs.length === 0
                  ? <div className="h-full flex flex-col items-center justify-center text-slate-600 py-10">
                      <Layers size={32} className="mb-3 opacity-20" />
                      <p className="text-[11px] text-center leading-relaxed">Chưa có item nào<br />đang chờ xử lý.</p>
                    </div>
                  : <div className="space-y-2">
                      {pendingJobs.map(job => {
                        let displayImg = job.image_file;
                        if (displayImg && displayImg.startsWith('[')) { try { displayImg = JSON.parse(displayImg)[0]; } catch(e) {} }
                        return (
                          <div key={job.id} className="p-2.5 rounded-lg border border-slate-700/60 bg-[#141c2f]">
                            {displayImg && <img src={`file:///${encodeURI(displayImg.replace(/\\/g, '/'))}`} className="w-full h-14 object-cover rounded-md border border-slate-700 mb-2" />}
                            <p className="text-[11px] font-medium text-slate-300 line-clamp-2">{job.prompt || <span className="italic text-slate-600">no prompt</span>}</p>
                            <p className="text-[10px] font-bold text-slate-600 mt-1.5 uppercase">{getModeShort(job.mode)} · {job.aspect_ratio}</p>
                          </div>
                        )
                      })}
                    </div>
                }
              </div>
              <div className={`p-3 shrink-0 border-t border-slate-800/80 ${runningJobs.length > 0 ? 'bg-blue-600/20' : 'bg-[#141c2f]'}`}>
                {runningJobs.length > 0
                  ? <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-blue-400 py-0.5">
                      <Loader2 size={13} className="animate-spin flex-shrink-0" />
                      <span>Chạy {runningJobs.length} · chờ {pendingJobs.length}</span>
                    </div>
                  : <p className="text-[11px] text-slate-500 text-center py-0.5">{completedJobs.length} xong · {failedJobs.length} lỗi</p>
                }
              </div>
            </div>

            {/* ── MAIN: KẾT QUẢ ── */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0f1524]">
              <div className="h-14 border-b border-slate-800/80 flex items-center justify-between px-5 shrink-0 bg-[#141c2f]">
                <div className="flex items-center gap-3">
                  {!queueOpen && (
                    <button onClick={() => setQueueOpen(true)} className="p-1.5 rounded hover:bg-slate-700 transition-colors mr-1">
                      <ChevronRight size={14} className="text-slate-500" />
                    </button>
                  )}
                  <h2 className="text-sm font-bold text-white tracking-wide">Kết quả</h2>
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">{jobs.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(runningJobs.length > 0 || pendingJobs.length > 0) && (
                    <>
                      <button
                        onClick={handlePauseResumeQueue}
                        title={isQueuePaused ? 'Tiếp tục' : 'Tạm dừng'}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg border transition-colors ${
                          isQueuePaused
                            ? 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-500/40'
                            : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {isQueuePaused ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
                        {isQueuePaused ? 'Tiếp tục' : 'Tạm dừng'}
                      </button>
                      <button
                        onClick={handleStopAll}
                        title="Dừng tất cả"
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-700/30 transition-colors"
                      >
                        <Square size={12} fill="currentColor" /> Dừng tất cả
                      </button>
                    </>
                  )}
                  <button onClick={toggleSelectAll} title="Chọn tất cả" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors">
                    {selectedJobs.size > 0 ? <CheckSquare size={16} className="text-blue-400" /> : <Square size={16} />}
                  </button>
                  <button onClick={loadJobs} title="Tải lại" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors">
                    <RefreshCw size={16} />
                  </button>
                  <button onClick={handleRetryFailed} title="Thử lại lỗi" disabled={failedJobs.length === 0}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-orange-400 hover:bg-orange-900/30 disabled:opacity-30 transition-colors">
                    <RefreshCw size={16} />
                  </button>
                  <button onClick={handleDeleteSelected} title="Xóa đã chọn" disabled={selectedJobs.size === 0}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/30 disabled:opacity-30 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                {jobs.length === 0
                  ? <div className="h-full flex flex-col items-center justify-center text-slate-600">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-[#141c2f] border border-slate-800">
                        <Play size={28} className="ml-0.5 text-slate-700" />
                      </div>
                      <p className="font-semibold text-sm text-slate-500 mb-1">Chưa có kết quả</p>
                      <p className="text-[12px] text-slate-600">Nhập prompt và bấm "Thêm vào hàng đợi"</p>
                    </div>
                  : <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
                      {jobs.map((job) => (
                        <JobCard key={job.id} job={job}
                          onRetry={handleRetry} onDelete={handleDelete}
                          onOpen={handleOpen} onPreview={setPreviewJob}
                          onCancel={handleCancelJob} />
                      ))}
                    </div>
                }
              </div>

              {/* ── LOG PANEL GROK STUDIO ── */}
              <div className={`bg-[#0b1120] border-t border-slate-800/80 shrink-0 flex flex-col transition-all duration-300 ${grokLogOpen ? 'h-[160px]' : 'h-[36px]'}`}>
                <button
                  onClick={() => setGrokLogOpen(v => !v)}
                  className="flex items-center justify-between px-4 py-2 hover:bg-slate-800/40 transition-colors cursor-pointer w-full shrink-0"
                >
                  <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    Hệ thống Log
                    {grokLogs.length > 0 && !grokLogOpen && (
                      <span className="ml-1 bg-slate-700 text-slate-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{grokLogs.length}</span>
                    )}
                    {!grokLogOpen && grokLogs.some(l => l.type === 'error') && (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {grokLogOpen && (
                      <span onClick={e => { e.stopPropagation(); setGrokLogs([]); }} className="text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded transition-colors">
                        Xóa
                      </span>
                    )}
                    {grokLogOpen ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronUp size={13} className="text-slate-500" />}
                  </div>
                </button>
                {grokLogOpen && (
                  <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] font-mono custom-scrollbar space-y-1">
                    {grokLogs.map((log, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="text-slate-600 shrink-0">[{log.time}]</span>
                        <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}>{log.text}</span>
                      </div>
                    ))}
                    <div ref={grokLogsEndRef} />
                  </div>
                )}
              </div>
            </div>

          </div>{/* end flex w-full h-full grok outer */}
        </div>{/* end absolute inset-0 grok wrapper */}

      </div>{/* end flex-1 overflow-hidden relative tab container */}

      {showSettings && (
        <SettingsModal profile={activeProfile} downloadsDir={downloadsDir} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} dark={dark} />
      )}

      {/* Modal Preview */}
      {previewJob && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4 transition-opacity" onClick={() => setPreviewJob(null)}>
          <div className="bg-[#0b0f19] border border-slate-800/80 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start p-5 bg-[#0b0f19]">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{previewJob.profile_name || 'PROFILE'}</p>
                <h3 className="text-base font-semibold text-slate-100 mb-0.5 leading-snug cursor-pointer hover:text-blue-400 transition-colors" title="Nhấn để copy prompt" onClick={() => navigator.clipboard.writeText(previewJob.prompt)}>
                  {previewJob.prompt}
                </h3>
                <p className="text-[10px] text-slate-600">Click để copy full prompt</p>
              </div>
              <button onClick={() => setPreviewJob(null)} className="p-2.5 bg-slate-800/40 hover:bg-slate-700/80 text-slate-400 hover:text-white rounded-xl transition-colors ml-6 flex-shrink-0"><X size={18} /></button>
            </div>
            <div className="w-full bg-black flex items-center justify-center relative border-t border-slate-800" style={{ height: '70vh' }}>
              {previewJob.local_file_path?.match(/\.(mp4|webm|mov|avi)$/i) ? (
                <video src={`file:///${encodeURI(previewJob.local_file_path.replace(/\\/g, '/'))}`} className="w-full h-full object-contain" controls autoPlay />
              ) : (
                <img src={`file:///${encodeURI(previewJob.local_file_path.replace(/\\/g, '/'))}`} className="w-full h-full object-contain" alt="Preview" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}