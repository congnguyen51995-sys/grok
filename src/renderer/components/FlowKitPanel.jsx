import { useState, useEffect, useRef, useCallback } from 'react'

const api = window.electronAPI
const BASE = 'http://127.0.0.1:8100'
const MATERIALS = ['realistic','3d_pixar','anime','ghibli','stop_motion','minecraft','oil_painting','watercolor','comic_book','cyberpunk','claymation','lego','retro_vhs']
const ENTITY_TYPES = ['character','location','creature','visual_asset','faction']

async function fk(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000), ...opts })
  const d = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: d }
}

export default function FlowKitPanel() {
  const [extensionPath, setExtensionPath] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentConnected, setAgentConnected] = useState(false)
  const [statusDetail, setStatusDetail] = useState(null)
  const [logs, setLogs] = useState([])
  const [installing, setInstalling] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const [projects, setProjects] = useState([])
  const [selectedPid, setSelectedPid] = useState(null)
  const [projectDetail, setProjectDetail] = useState(null)
  const [projectChars, setProjectChars] = useState([])
  const [projectVideos, setProjectVideos] = useState([])
  const [loadingProject, setLoadingProject] = useState(false)
  const [view, setView] = useState('setup')
  const [actionLog, setActionLog] = useState('')
  const [newName, setNewName] = useState('')
  const [newStory, setNewStory] = useState('')
  const [newMaterial, setNewMaterial] = useState('realistic')
  const [newChars, setNewChars] = useState([])
  const [creating, setCreating] = useState(false)
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [pollStatus, setPollStatus] = useState(null) // {total,completed,failed,pending,type}
  const [fkDownloadDir, setFkDownloadDir] = useState('')
  const [showSceneForm, setShowSceneForm] = useState(false)
  const [sceneVideoTitle, setSceneVideoTitle] = useState('Video 1')
  const [scenePrompts, setScenePrompts] = useState('')
  const [creatingScenes, setCreatingScenes] = useState(false)
  const logEndRef = useRef(null)
  const checkRef = useRef(null)
  const pollRef = useRef(null)

  const pushLog = useCallback((line) => {
    setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]; return next.length > 200 ? next.slice(-200) : next })
  }, [])

  useEffect(() => {
    api?.flowkitGetExtensionPath?.().then(p => { if (p) setExtensionPath(p) }).catch(() => {})
    api?.flowkitAgentRunning?.().then(r => setAgentRunning(!!r)).catch(() => {})
    api?.flowkitGetLogs?.().then(ls => { if (ls?.length) setLogs(ls) }).catch(() => {})
    api?.getSetting?.('flowkit_autostart', 'false').then(v => setAutoStart(v === 'true')).catch(() => {})
    api?.getSetting?.('flowkit_download_dir', '').then(v => {
      if (v) setFkDownloadDir(v)
      else api?.getDownloadsDir?.().then(d => setFkDownloadDir(d || '')).catch(() => {})
    }).catch(() => {})
    api?.flowkitOnLog?.(pushLog)
    api?.flowkitOnStatus?.((s) => {
      if (s === 'started') setAgentRunning(true)
      if (s === 'stopped') { setAgentRunning(false); setAgentConnected(false) }
    })
    checkHealth()
    checkRef.current = setInterval(checkHealth, 6000)
    return () => {
      clearInterval(checkRef.current)
      clearInterval(pollRef.current)
      api?.flowkitOffLog?.()
      api?.flowkitOffStatus?.()
    }
  }, [])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  const checkHealth = async () => {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2500) })
      if (r.ok) {
        const d = await r.json()
        setAgentConnected(true); setStatusDetail(d); setAgentRunning(true)
        const pr = await fetch(`${BASE}/api/projects`, { signal: AbortSignal.timeout(5000) })
        if (pr.ok) { const pd = await pr.json(); setProjects(Array.isArray(pd) ? pd : pd?.projects || []) }
        return
      }
    } catch {}
    setAgentConnected(false)
  }

  const startAgent = async () => {
    pushLog('Đang khởi động agent...')
    setView('logs')
    const r = await api?.flowkitStartAgent?.()
    if (r?.ok) { setAgentRunning(true); pushLog(`✅ ${r.msg}`) }
    else { pushLog(`❌ ${r?.msg || 'Lỗi khởi động'}`) }
  }

  const stopAgent = async () => {
    const r = await api?.flowkitStopAgent?.()
    pushLog(r?.msg || 'Đã gửi lệnh dừng')
  }

  const installDeps = async () => {
    setInstalling(true); setView('logs')
    pushLog('Đang cài thư viện Python...')
    const r = await api?.flowkitInstallDeps?.()
    if (r?.ok) pushLog(`✅ Cài xong! Bấm "Khởi động Agent" để tiếp tục.`)
    else pushLog(`❌ ${r?.msg || 'Lỗi cài đặt'}`)
    setInstalling(false)
  }

  const toggleAutoStart = async () => {
    const next = !autoStart
    setAutoStart(next)
    await api?.setSetting?.('flowkit_autostart', next ? 'true' : 'false')
  }

  const loadProject = async (pid) => {
    setSelectedPid(pid); setLoadingProject(true); setView('projects')
    setProjectDetail(null); setProjectChars([]); setProjectVideos([]); setActionLog('')
    try {
      const [pr, cr, vr] = await Promise.all([
        fk(`/api/projects/${pid}`),
        fk(`/api/projects/${pid}/characters`),
        fk(`/api/videos?project_id=${pid}`)
      ])
      if (pr.ok) setProjectDetail(pr.data)
      if (cr.ok) setProjectChars(Array.isArray(cr.data) ? cr.data : [])
      if (vr.ok) {
        const videos = Array.isArray(vr.data) ? vr.data : []
        // fetch scenes for each video
        const withScenes = await Promise.all(videos.map(async v => {
          const sr = await fk(`/api/scenes?video_id=${v.id}`)
          return { ...v, scenes: sr.ok ? (Array.isArray(sr.data) ? sr.data : []) : [] }
        }))
        setProjectVideos(withScenes)
      }
    } catch(e) { setActionLog(`❌ Lỗi tải project: ${e.message}`) }
    setLoadingProject(false)
  }

  const createProject = async () => {
    if (!newName.trim()) return
    setCreating(true); setActionLog('')
    try {
      const body = { name: newName.trim(), story: newStory.trim() || undefined, material: newMaterial }
      if (newChars.length > 0) body.characters = newChars.filter(c => c.name.trim())
      const r = await fk('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (r.ok) {
        setNewName(''); setNewStory(''); setNewChars([])
        await checkHealth()
        const pid = r.data.id || r.data.project_id
        if (pid) loadProject(pid)
      } else { setActionLog(`❌ ${r.data.detail || r.data.error || `Lỗi ${r.status}`}`) }
    } catch(e) { setActionLog(`❌ ${e.message}`) }
    finally { setCreating(false) }
  }

  const runGenRefs = async () => {
    if (!selectedPid || projectChars.length === 0) {
      setActionLog('❌ Project chưa có entity nào. Tạo project với characters trước.'); return
    }
    setPipelineBusy(true); setActionLog('⏳ Gửi yêu cầu tạo reference images...')
    try {
      const requests = projectChars.map(c => ({
        type: 'GENERATE_CHARACTER_IMAGE',
        character_id: c.id, project_id: selectedPid
      }))
      const r = await fk('/api/requests/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      })
      if (r.ok) {
        setActionLog(`⏳ Đã gửi ${requests.length} yêu cầu — đang chờ extension xử lý...`)
        startPollBatch(selectedPid, 'GENERATE_CHARACTER_IMAGE', async (s) => {
          setActionLog(`✅ Xong! ${s.completed} thành công, ${s.failed} lỗi`)
          // reload entities để cập nhật image_url
          const cr = await fk(`/api/projects/${selectedPid}/characters`)
          if (cr.ok) setProjectChars(Array.isArray(cr.data) ? cr.data : [])
          setPipelineBusy(false)
        })
      } else {
        setActionLog(`❌ ${r.data.detail || JSON.stringify(r.data).slice(0,120)}`)
        setPipelineBusy(false)
      }
    } catch(e) { setActionLog(`❌ ${e.message}`); setPipelineBusy(false) }
  }

  const runGenImages = async () => {
    const allScenes = projectVideos.flatMap(v => (v.scenes || []).map(s => ({ ...s, video_id: v.id })))
    if (allScenes.length === 0) {
      setActionLog('❌ Chưa có scene nào trong videos.'); return
    }
    setPipelineBusy(true); setActionLog('⏳ Gửi yêu cầu tạo scene images...')
    try {
      const requests = allScenes.map(s => ({
        type: 'GENERATE_IMAGE',
        scene_id: s.id, project_id: selectedPid, video_id: s.video_id
      }))
      const r = await fk('/api/requests/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      })
      if (r.ok) {
        setActionLog(`⏳ Đã gửi ${requests.length} yêu cầu tạo ảnh cảnh — đang chờ...`)
        startPollBatch(selectedPid, 'GENERATE_IMAGE', async (s) => {
          setActionLog(`✅ Xong! ${s.completed} ảnh thành công, ${s.failed} lỗi`)
          await loadProject(selectedPid)
          setPipelineBusy(false)
        })
      } else {
        setActionLog(`❌ ${r.data.detail || JSON.stringify(r.data).slice(0,120)}`)
        setPipelineBusy(false)
      }
    } catch(e) { setActionLog(`❌ ${e.message}`); setPipelineBusy(false) }
  }

  const runGenVideos = async () => {
    const allScenes = projectVideos.flatMap(v => (v.scenes || []).map(s => ({ ...s, video_id: v.id })))
    if (allScenes.length === 0) {
      setActionLog('❌ Chưa có scene nào trong videos.'); return
    }
    setPipelineBusy(true); setActionLog('⏳ Gửi yêu cầu tạo video clips...')
    try {
      const requests = allScenes.map(s => ({
        type: 'GENERATE_VIDEO',
        scene_id: s.id, project_id: selectedPid, video_id: s.video_id
      }))
      const r = await fk('/api/requests/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      })
      if (r.ok) {
        setActionLog(`⏳ Đã gửi ${requests.length} yêu cầu tạo video — đang chờ (8s/clip)...`)
        startPollBatch(selectedPid, 'GENERATE_VIDEO', async (s) => {
          setActionLog(`✅ Xong! ${s.completed} clip thành công, ${s.failed} lỗi`)
          await loadProject(selectedPid)
          setPipelineBusy(false)
        })
      } else {
        setActionLog(`❌ ${r.data.detail || JSON.stringify(r.data).slice(0,120)}`)
        setPipelineBusy(false)
      }
    } catch(e) { setActionLog(`❌ ${e.message}`); setPipelineBusy(false) }
  }

  const runConcat = async () => {
    if (projectVideos.length === 0) {
      setActionLog('❌ Không có video nào trong project.'); return
    }
    const vid = projectVideos[0].id
    setPipelineBusy(true); setActionLog('⏳ Đang ghép video...')
    try {
      const r = await fk(`/api/videos/${vid}/concat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (r.ok) setActionLog(`✅ Video ghép xong: ${r.data.output_path || ''} (${r.data.scenes_used} cảnh)`)
      else setActionLog(`❌ ${r.data.detail || JSON.stringify(r.data).slice(0,120)}`)
    } catch(e) { setActionLog(`❌ ${e.message}`) }
    finally { setPipelineBusy(false) }
  }

  const startPollBatch = (pid, type, onDone) => {
    clearInterval(pollRef.current)
    setPollStatus({ total: 0, completed: 0, failed: 0, pending: 0, type })
    pollRef.current = setInterval(async () => {
      try {
        const r = await fk(`/api/requests/batch-status?project_id=${pid}&type=${type}`)
        if (r.ok) {
          const s = r.data
          setPollStatus({ ...s, type })
          if (s.done) {
            clearInterval(pollRef.current)
            setPollStatus(null)
            onDone(s)
          }
        }
      } catch {}
    }, 3000)
  }

  const pickFkDownloadDir = async () => {
    const dir = await api?.selectFolder?.()
    if (dir) { setFkDownloadDir(dir); await api?.setSetting?.('flowkit_download_dir', dir) }
  }

  const downloadImage = async (url, name) => {
    try {
      const ext = url.includes('.png') ? 'png' : 'jpg'
      const baseDir = fkDownloadDir || await api?.getDownloadsDir?.() || ''
      if (!baseDir) { setActionLog('❌ Chưa chọn thư mục lưu'); return }
      const fileName = `flowkit_${name.replace(/\s+/g,'_')}_${Date.now()}.${ext}`
      const savePath = `${baseDir}\\${fileName}`
      setActionLog(`⏳ Đang tải ${name}...`)
      const result = await api?.downloadUrl?.(url, savePath)
      if (!result?.ok) throw new Error(result?.error || 'unknown')
      setActionLog(`✅ Đã tải: ${savePath}`)
      api?.openOutputPath?.(savePath)
    } catch(e) { setActionLog(`❌ Tải thất bại: ${e.message}`) }
  }

  const createVideoWithScenes = async () => {
    if (!scenePrompts.trim() || !selectedPid) return
    const lines = scenePrompts.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setCreatingScenes(true); setActionLog('⏳ Đang tạo video + scenes...')
    try {
      const vr = await fk('/api/videos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: selectedPid, title: sceneVideoTitle || 'Video 1' })
      })
      if (!vr.ok) throw new Error(vr.data?.detail || 'Tạo video thất bại')
      const vid = vr.data.id
      for (let i = 0; i < lines.length; i++) {
        const sr = await fk('/api/scenes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: vid, prompt: lines[i], display_order: i })
        })
        if (!sr.ok) throw new Error(`Scene ${i+1}: ${sr.data?.detail || 'lỗi'}`)
      }
      setActionLog(`✅ Tạo xong: 1 video + ${lines.length} scenes`)
      setShowSceneForm(false); setScenePrompts(''); setSceneVideoTitle('Video 1')
      await loadProject(selectedPid)
    } catch(e) { setActionLog(`❌ ${e.message}`) }
    setCreatingScenes(false)
  }

  const addChar = () => setNewChars(prev => [...prev, { name: '', entity_type: 'character', description: '' }])
  const updateChar = (i, field, val) => setNewChars(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  const removeChar = (i) => setNewChars(prev => prev.filter((_, idx) => idx !== i))

  const pid = projectDetail?.id
  const totalScenes = projectVideos.reduce((a, v) => a + (v.scenes?.length || 0), 0)

  const StatusBadge = () => (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${agentConnected ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/40' : agentRunning ? 'bg-yellow-950/60 text-yellow-400 border border-yellow-700/40' : 'bg-red-950/60 text-red-400 border border-red-700/40'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${agentConnected ? 'bg-emerald-400 shadow-[0_0_4px_#34d399]' : agentRunning ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
      {agentConnected ? 'Đang chạy & kết nối' : agentRunning ? 'Đang khởi động...' : 'Chưa chạy'}
    </div>
  )

  return (
    <div className="flex h-full bg-[#0b0f1a] text-white overflow-hidden">
      {/* ─── LEFT SIDEBAR ─── */}
      <div className="w-[270px] shrink-0 flex flex-col border-r border-slate-800/60 overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-slate-800/60 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🎬</span>
            <span className="font-black text-sm text-white">FLOW KIT</span>
            <button onClick={checkHealth} className="ml-auto text-slate-500 hover:text-white text-[11px]" title="Làm mới">↻</button>
          </div>
          <StatusBadge />
        </div>

        <div className="px-3 py-2 border-b border-slate-800/60 flex flex-col gap-2">
          <div className="flex gap-1.5">
            {!agentRunning ? (
              <button onClick={startAgent} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-black transition-all">▶ Khởi động Agent</button>
            ) : (
              <button onClick={stopAgent} className="flex-1 py-1.5 bg-red-700/60 hover:bg-red-600 text-white rounded text-[10px] font-black transition-all">⏹ Dừng Agent</button>
            )}
            <button onClick={installDeps} disabled={installing}
              className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-[10px] font-bold transition-all disabled:opacity-50 shrink-0"
              title="Cài thư viện Python (lần đầu)">
              {installing ? '⏳' : '📦 Cài lib'}
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <button onClick={toggleAutoStart} className={`w-8 h-4 rounded-full relative transition-all ${autoStart ? 'bg-emerald-600' : 'bg-slate-600'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoStart ? 'left-4' : 'left-0.5'}`} />
            </button>
            <span className="text-[10px] text-slate-400">Tự khởi động khi mở app</span>
          </label>
        </div>

        <div className="px-3 py-2 border-b border-slate-800/60">
          <div className="text-[9px] font-black text-slate-500 uppercase tracking-wide mb-1.5">Chrome Extension</div>
          <div className="text-[10px] text-slate-400 mb-2 leading-relaxed">chrome://extensions → Developer mode → Load unpacked → chọn thư mục:</div>
          <button onClick={() => extensionPath && api?.openFolder?.(extensionPath)}
            className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded text-[10px] font-black transition-all flex items-center justify-center gap-1">
            📂 Mở thư mục Extension
          </button>
          {extensionPath && <div className="text-[8px] text-slate-600 mt-1 break-all font-mono leading-relaxed">{extensionPath}</div>}
        </div>

        <div className="px-3 py-2 border-b border-slate-800/60">
          <div className="text-[9px] font-black text-slate-500 uppercase tracking-wide mb-1.5">Google Flow</div>
          <button onClick={() => api?.openExternal?.('https://flow.google.com')}
            className="w-full py-1.5 bg-blue-700/50 hover:bg-blue-600 text-white rounded text-[10px] font-bold transition-all">
            🌐 Mở flow.google.com
          </button>
          <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">Đăng nhập → để tab mở → tạo project trên web → copy UUID → dán vào form tạo project.</div>
        </div>

        {agentConnected && (
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 flex flex-col gap-1 min-h-0">
            <div className="text-[9px] font-black text-slate-500 uppercase tracking-wide mb-1">Projects ({projects.length})</div>
            {projects.length === 0 && <div className="text-[10px] text-slate-600 italic">Chưa có project. Tạo project đầu tiên →</div>}
            {projects.map(p => (
              <button key={p.id} onClick={() => loadProject(p.id)}
                className={`text-left px-2 py-1.5 rounded text-[10px] transition-all ${selectedPid === p.id ? 'bg-orange-600 text-white' : 'bg-[#131929] text-slate-300 hover:bg-slate-700'}`}>
                <div className="font-bold truncate">{p.name}</div>
                <div className="text-[9px] opacity-60">{p.material || 'realistic'} · {p.status || 'ACTIVE'}</div>
              </button>
            ))}
            <button onClick={() => { setView('projects'); setSelectedPid(null); setProjectDetail(null) }}
              className="mt-1 py-1.5 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 rounded text-[10px] font-bold transition-all">
              ＋ Tạo project mới
            </button>
          </div>
        )}
      </div>

      {/* ─── MAIN AREA ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex gap-1 px-3 pt-2 border-b border-slate-800/60 pb-0">
          {[['setup','⚙️ Setup'],['projects','📁 Projects'],['logs','📋 Logs']].map(([id,label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-t transition-all ${view === id ? 'bg-[#131929] text-white border border-b-0 border-slate-700/60' : 'text-slate-500 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── VIEW: SETUP ── */}
        {view === 'setup' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-4">
            {!agentConnected && (
              <div className="bg-[#131929] border border-slate-700/30 rounded-xl p-5 text-center flex flex-col items-center gap-3">
                <div className="text-4xl">🎬</div>
                <div className="font-black text-base text-white">Flow Kit — AI Video Studio</div>
                <div className="text-[11px] text-slate-400 max-w-sm leading-relaxed">
                  Tạo video AI qua Google Flow. Extension Chrome làm bridge ký request trong tab đã đăng nhập.
                </div>
                <div className="bg-[#0d1221] rounded-lg p-3 text-left w-full max-w-sm">
                  <div className="text-[11px] font-bold text-slate-300 mb-2">Pipeline:</div>
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    1. Cài extension → 2. Chạy Python agent → 3. Mở tab flow.google.com (đăng nhập) → 4. Tạo project + entities → 5. Gen ảnh ref → 6. Gen ảnh cảnh → 7. Gen video clip → 8. Ghép video
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {[
                { step:'1', title:'Cài Extension Chrome', color:'orange',
                  body: <>Mở <span className="text-orange-300 font-bold">chrome://extensions</span> → Developer mode ON → Load unpacked → chọn thư mục extension bên trái</>,
                  action: () => extensionPath && api?.openFolder?.(extensionPath), label:'📂 Mở thư mục Extension' },
                { step:'2', title:'Chạy Python Agent', color:'emerald',
                  body: <><div className="text-[10px] text-slate-500">Nhấn nút bên trái hoặc chạy tay:</div><div className="font-mono text-[9px] bg-black/40 rounded p-1.5 mt-1 select-all">python -m agent.main</div></>,
                  action: startAgent, label: agentRunning ? '✅ Agent đang chạy' : '▶ Khởi động Agent', disabled: agentRunning },
                { step:'3', title:'Mở Google Flow', color:'blue',
                  body: <>Đăng nhập tại <span className="text-blue-400">flow.google.com</span>, <strong>giữ tab mở</strong>. Extension dùng tab này để ký request.</>,
                  action: () => api?.openExternal?.('https://flow.google.com'), label:'🌐 Mở flow.google.com' },
              ].map(({ step, title, color, body, action, label, disabled }) => (
                <div key={step} className="bg-[#131929] border border-slate-700/30 rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full bg-${color}-600/30 border border-${color}-500/40 flex items-center justify-center text-[10px] font-black text-${color}-400`}>{step}</div>
                    <div className="font-bold text-[11px] text-white">{title}</div>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed flex-1">{body}</div>
                  <button onClick={action} disabled={disabled}
                    className={`w-full py-1.5 rounded text-[10px] font-black transition-all disabled:opacity-50 ${color==='orange'?'bg-orange-600 hover:bg-orange-500 text-white':color==='emerald'?'bg-emerald-600 hover:bg-emerald-500 text-white':'bg-blue-700/60 hover:bg-blue-600 text-white'}`}>
                    {label}
                  </button>
                </div>
              ))}
            </div>

            {/* Thư mục lưu ảnh/video */}
            <div className="bg-[#131929] border border-slate-700/30 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-0.5">📁 Thư mục lưu ảnh/video tải về</div>
                <div className="text-[10px] text-slate-400 truncate font-mono">{fkDownloadDir || 'Chưa chọn thư mục'}</div>
              </div>
              <button onClick={pickFkDownloadDir}
                className="shrink-0 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/60 text-slate-300 rounded text-[10px] font-bold">
                Chọn
              </button>
              {fkDownloadDir && <button onClick={() => api?.openFolder?.(fkDownloadDir)}
                className="shrink-0 px-2 py-1.5 bg-slate-800/50 hover:bg-slate-700/60 text-slate-400 rounded text-[10px]">
                📂
              </button>}
            </div>

            {agentConnected && statusDetail && (
              <div className="bg-emerald-950/30 border border-emerald-700/30 rounded-xl p-4 flex items-center gap-3">
                <div className="text-2xl">✅</div>
                <div>
                  <div className="font-black text-emerald-400">Agent đã kết nối!</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Extension: {statusDetail.extension_connected ? '✅ Kết nối' : '⚠️ Chưa kết nối — giữ tab flow.google.com mở'}
                  </div>
                </div>
                <button onClick={() => setView('projects')} className="ml-auto px-3 py-1.5 bg-emerald-700/40 hover:bg-emerald-600/60 text-emerald-300 rounded text-[10px] font-bold">
                  Xem Projects →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── VIEW: PROJECTS ── */}
        {view === 'projects' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
            {!agentConnected && (
              <div className="text-center py-8 text-slate-500 text-[12px]">⚠️ Agent chưa kết nối. Khởi động agent trước.</div>
            )}
            {agentConnected && !selectedPid && (
              <div className="bg-[#131929] border border-slate-700/30 rounded-xl p-4 flex flex-col gap-3">
                <div className="text-[11px] font-black text-white">Tạo Project mới</div>
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Tên project..."
                  className="bg-[#0d1221] border border-slate-700/40 rounded px-3 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60" />
                <textarea value={newStory} onChange={e => setNewStory(e.target.value)}
                  placeholder="Câu chuyện / nội dung (tuỳ chọn)..."
                  rows={3}
                  className="bg-[#0d1221] border border-slate-700/40 rounded px-3 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none focus:border-orange-500/60 resize-none" />
                <div>
                  <div className="text-[10px] text-slate-400 mb-1.5">Material (phong cách)</div>
                  <select value={newMaterial} onChange={e => setNewMaterial(e.target.value)}
                    className="w-full bg-[#0d1221] border border-slate-700/40 rounded px-3 py-1.5 text-[11px] text-white focus:outline-none focus:border-orange-500/60">
                    {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                {/* Characters / entities */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] text-slate-400">Nhân vật / Entities</div>
                    <button onClick={addChar} className="text-[10px] text-orange-400 hover:text-orange-300 font-bold">＋ Thêm</button>
                  </div>
                  {newChars.length === 0 && <div className="text-[9px] text-slate-600 italic">Chưa có — thêm nhân vật để gen reference image</div>}
                  {newChars.map((c, i) => (
                    <div key={i} className="bg-[#0d1221] border border-slate-700/30 rounded p-2 mb-1.5 flex flex-col gap-1.5">
                      <div className="flex gap-1.5">
                        <input value={c.name} onChange={e => updateChar(i, 'name', e.target.value)}
                          placeholder="Tên nhân vật..."
                          className="flex-1 bg-black/40 border border-slate-700/30 rounded px-2 py-1 text-[10px] text-white placeholder-slate-600 focus:outline-none" />
                        <select value={c.entity_type} onChange={e => updateChar(i, 'entity_type', e.target.value)}
                          className="bg-black/40 border border-slate-700/30 rounded px-1.5 py-1 text-[10px] text-slate-300 focus:outline-none">
                          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <button onClick={() => removeChar(i)} className="text-red-500 hover:text-red-400 text-[11px] px-1">✕</button>
                      </div>
                      <input value={c.description} onChange={e => updateChar(i, 'description', e.target.value)}
                        placeholder="Mô tả ngoại hình (tuỳ chọn)..."
                        className="w-full bg-black/40 border border-slate-700/30 rounded px-2 py-1 text-[10px] text-white placeholder-slate-600 focus:outline-none" />
                    </div>
                  ))}
                </div>

                {actionLog && <div className="text-[10px] font-mono text-slate-400 break-all">{actionLog}</div>}
                <button onClick={createProject} disabled={creating || !newName.trim()}
                  className="py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded text-[11px] font-black transition-all">
                  {creating ? '⏳ Đang tạo...' : '＋ Tạo Project'}
                </button>
              </div>
            )}

            {agentConnected && selectedPid && (
              <div className="bg-[#131929] border border-slate-700/30 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <button onClick={() => { setSelectedPid(null); setProjectDetail(null) }}
                    className="text-slate-500 hover:text-white text-[11px]">← Quay lại</button>
                  <div className="flex-1" />
                  <button onClick={() => loadProject(selectedPid)} className="text-[10px] text-slate-500 hover:text-white">↻ Tải lại</button>
                </div>

                {loadingProject && <div className="text-[11px] text-slate-500 animate-pulse">⏳ Đang tải...</div>}
                {!loadingProject && projectDetail && (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-base text-white">{projectDetail.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 font-mono">ID: {pid}</div>
                        <div className="text-[10px] text-slate-500">Material: {projectDetail.material || 'realistic'}</div>
                        {projectDetail.story && <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{projectDetail.story.slice(0,200)}</div>}
                      </div>
                      <div className={`px-2 py-1 rounded text-[10px] font-bold shrink-0 ${projectDetail.status === 'COMPLETED' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-orange-900/40 text-orange-400'}`}>
                        {projectDetail.status || 'ACTIVE'}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-3">
                      {[
                        [`${projectChars.length}`, 'Entities'],
                        [`${projectVideos.length}`, 'Videos'],
                        [`${totalScenes}`, 'Scenes'],
                      ].map(([n, label]) => (
                        <div key={label} className="flex-1 bg-[#0d1221] rounded-lg p-2 text-center">
                          <div className="text-base font-black text-white">{n}</div>
                          <div className="text-[9px] text-slate-500">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Pipeline Actions */}
                    <div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-2">Pipeline</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button onClick={runGenRefs} disabled={pipelineBusy || projectChars.length === 0}
                          className="py-2 bg-purple-700/40 hover:bg-purple-600/60 border border-purple-700/30 hover:border-purple-500/50 text-slate-200 hover:text-white rounded text-[10px] font-bold transition-all disabled:opacity-30">
                          🖼 Gen Reference Images
                          <div className="text-[8px] text-slate-500 mt-0.5">{projectChars.length} entities</div>
                        </button>
                        <button onClick={runGenImages} disabled={pipelineBusy || totalScenes === 0}
                          className="py-2 bg-blue-700/40 hover:bg-blue-600/60 border border-blue-700/30 hover:border-blue-500/50 text-slate-200 hover:text-white rounded text-[10px] font-bold transition-all disabled:opacity-30">
                          🎨 Gen Scene Images
                          <div className="text-[8px] text-slate-500 mt-0.5">{totalScenes} scenes</div>
                        </button>
                        <button onClick={runGenVideos} disabled={pipelineBusy || totalScenes === 0}
                          className="py-2 bg-emerald-700/40 hover:bg-emerald-600/60 border border-emerald-700/30 hover:border-emerald-500/50 text-slate-200 hover:text-white rounded text-[10px] font-bold transition-all disabled:opacity-30">
                          🎬 Gen Video Clips
                          <div className="text-[8px] text-slate-500 mt-0.5">{totalScenes} clips</div>
                        </button>
                        <button onClick={runConcat} disabled={pipelineBusy || projectVideos.length === 0}
                          className="py-2 bg-orange-700/40 hover:bg-orange-600/60 border border-orange-700/30 hover:border-orange-500/50 text-slate-200 hover:text-white rounded text-[10px] font-bold transition-all disabled:opacity-30">
                          ✂ Ghép Video Final
                          <div className="text-[8px] text-slate-500 mt-0.5">{projectVideos.length > 0 ? projectVideos[0].title || 'video' : '—'}</div>
                        </button>
                      </div>
                      {pollStatus && (
                        <div className="mt-2 bg-[#0d1221] border border-slate-700/30 rounded p-2">
                          <div className="flex items-center justify-between text-[10px] mb-1.5">
                            <span className="text-slate-400 font-mono">{pollStatus.type?.replace('GENERATE_','')}</span>
                            <span className="text-slate-300 font-bold">{pollStatus.completed}/{pollStatus.total} ✅  {pollStatus.failed > 0 && <span className="text-red-400">{pollStatus.failed} ❌</span>}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                              style={{ width: pollStatus.total > 0 ? `${Math.round((pollStatus.completed / pollStatus.total) * 100)}%` : '0%' }} />
                          </div>
                          <div className="text-[9px] text-slate-500 mt-1 animate-pulse">⏳ Đang xử lý — {pollStatus.pending} pending, {pollStatus.processing || 0} đang chạy...</div>
                        </div>
                      )}
                      {actionLog && (
                        <div className="mt-2 text-[10px] font-mono bg-black/40 border border-slate-700/30 rounded p-2 text-slate-300 break-all leading-relaxed">{actionLog}</div>
                      )}
                    </div>

                    {/* Entities */}
                    {projectChars.length > 0 && (
                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-2">Entities ({projectChars.length})</div>
                        <div className="flex flex-wrap gap-2">
                          {projectChars.map((e, i) => {
                            const imgUrl = e.reference_image_url || e.image_url || e.output_url
                            return (
                            <div key={i} className="flex flex-col gap-1 bg-[#0d1221] border border-slate-700/30 rounded-lg p-2">
                              {imgUrl
                                ? <img src={imgUrl} alt={e.name} className="w-full h-32 rounded object-cover border border-slate-600/40" />
                                : <div className="w-full h-32 rounded bg-slate-800 flex items-center justify-center text-3xl">👤</div>
                              }
                              <div className="text-[10px] font-bold text-white truncate">{e.name}</div>
                              <div className="text-[9px] text-slate-500">{e.entity_type || 'character'}</div>
                              {imgUrl
                                ? <button onClick={() => downloadImage(imgUrl, e.name || `entity_${i}`)}
                                    className="w-full py-1 text-[8px] bg-emerald-700/30 hover:bg-emerald-600/50 text-emerald-300 rounded font-bold">⬇ Tải về</button>
                                : <div className="text-[8px] text-slate-600 text-center">Chưa có ảnh</div>
                              }
                            </div>
                          )})}

                        </div>
                      </div>
                    )}

                    {/* Tạo Kịch Bản (Video + Scenes) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide">Kịch Bản / Scenes</div>
                        <button onClick={() => setShowSceneForm(v => !v)}
                          className="text-[10px] text-orange-400 hover:text-orange-300 font-bold">
                          {showSceneForm ? '✕ Đóng' : '＋ Tạo kịch bản'}
                        </button>
                      </div>
                      {showSceneForm && (
                        <div className="bg-[#0d1221] border border-orange-700/30 rounded-lg p-3 flex flex-col gap-2 mb-2">
                          <div className="text-[10px] font-bold text-orange-300">Tạo Video + Scenes mới</div>
                          <input value={sceneVideoTitle} onChange={e => setSceneVideoTitle(e.target.value)}
                            placeholder="Tên video (VD: Tập 1)..."
                            className="bg-black/40 border border-slate-700/30 rounded px-2 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none" />
                          <textarea value={scenePrompts} onChange={e => setScenePrompts(e.target.value)}
                            placeholder={'Mỗi dòng = 1 cảnh. VD:\nBé thấy bố lén ăn bánh, mắt to tròn ngạc nhiên\nBé chạy đến mách mẹ, tay chỉ vào bố\nBố giả vờ không biết, cười ngây thơ'}
                            rows={5}
                            className="bg-black/40 border border-slate-700/30 rounded px-2 py-1.5 text-[11px] text-white placeholder-slate-600 focus:outline-none resize-none font-mono" />
                          <div className="text-[9px] text-slate-500">{scenePrompts.split('\n').filter(l=>l.trim()).length} cảnh</div>
                          <button onClick={createVideoWithScenes} disabled={creatingScenes || !scenePrompts.trim()}
                            className="py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded text-[10px] font-black transition-all">
                            {creatingScenes ? '⏳ Đang tạo...' : '✅ Tạo Video + Scenes'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Videos */}
                    {projectVideos.length > 0 && (
                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-2">Videos ({projectVideos.length})</div>
                        {projectVideos.map(v => (
                          <div key={v.id} className="bg-[#0d1221] border border-slate-700/30 rounded-lg px-3 py-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold text-white truncate">{v.title || `Video ${v.id?.slice(0,8)}`}</div>
                                <div className="text-[10px] text-slate-500">{(v.scenes||[]).length} scenes · {v.status || 'ACTIVE'}</div>
                              </div>
                              {v.vertical_url && <span className="text-[9px] text-emerald-400 font-bold">✓ Ghép xong</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {projectChars.length === 0 && projectVideos.length === 0 && (
                      <div className="bg-yellow-950/20 border border-yellow-700/20 rounded-lg p-3">
                        <div className="text-[11px] font-bold text-yellow-400 mb-1">Project chưa có dữ liệu</div>
                        <div className="text-[10px] text-slate-400 leading-relaxed">
                          Project này không có entity hay video. Bạn cần tạo videos và scenes qua FlowKit API hoặc xoá project này và tạo lại với đầy đủ entities.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── VIEW: LOGS ── */}
        {view === 'logs' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/40">
              <span className="text-[10px] text-slate-500 font-mono">Agent stdout/stderr</span>
              <button onClick={() => setLogs([])} className="text-[10px] text-slate-600 hover:text-white">Xóa</button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 font-mono text-[10px] text-slate-400 space-y-0.5">
              {logs.length === 0 && <div className="text-slate-600 italic">Chưa có log nào...</div>}
              {logs.map((l, i) => (
                <div key={i} className={`leading-relaxed ${l.includes('ERROR')||l.includes('❌')?'text-red-400':l.includes('✅')||l.includes('OK')?'text-emerald-400':l.includes('[UI]')?'text-blue-400':''}`}>{l}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
