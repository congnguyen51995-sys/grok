import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Pause, FolderOpen, RefreshCw, CheckCircle2, Key, Image as ImageIcon, Film, CreditCard, Trash2, Loader2, X, AlertCircle, Settings2, Layers, Cpu, ImagePlus, FileImage, Plus, FolderPlus, FileText, Trash, Wifi, WifiOff, Maximize2, Edit3, CheckCircle, Download, HelpCircle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Terminal, Ban, Mic, Volume2, VolumeX } from 'lucide-react';

const VOICE_LIST = [
  { id: '',                label: 'Không có giọng' },
  { id: 'random',          label: '🎲 Ngẫu nhiên' },
  { id: 'achernar',        label: 'Achernar — Nữ, nhẹ nhàng, cao' },
  { id: 'achird',          label: 'Achird — Nam, thân thiện, trung' },
  { id: 'algenib',         label: 'Algenib — Nam, khàn, trầm' },
  { id: 'algieba',         label: 'Algieba — Nam, dễ chịu, trầm-vừa' },
  { id: 'alnilam',         label: 'Alnilam — Nam, cứng rắn, trầm-vừa' },
  { id: 'leda',            label: 'Leda — Nữ, trẻ trung, trung-cao' },
  { id: 'orus',            label: 'Orus — Nam, cứng, trầm-vừa' },
  { id: 'puck',            label: 'Puck — Nam, sôi nổi, trung' },
  { id: 'pulcherrima',     label: 'Pulcherrima — Trung tính, mạnh, trung-cao' },
  { id: 'rasalgethi',      label: 'Rasalgethi — Nam, thông tin, trung' },
  { id: 'sadachbia',       label: 'Sadachbia — Nam, linh hoạt, thấp' },
  { id: 'sadaltager',      label: 'Sadaltager — Nam, am hiểu, trung' },
  { id: 'schedar',         label: 'Schedar — Nam, đều đặn, trầm-vừa' },
  { id: 'sulafat',         label: 'Sulafat — Nữ, ấm áp, trung' },
  { id: 'umbriel',         label: 'Umbriel — Nam, mượt mà, thấp' },
  { id: 'vindemiatrix',    label: 'Vindemiatrix — Nữ, nhẹ nhàng, trung' },
  { id: 'zephyr',          label: 'Zephyr — Nữ, tươi sáng, trung-cao' },
  { id: 'zubenelgenubi',   label: 'Zubenelgenubi — Nam, thoải mái, trầm-vừa' },
];
const VOICE_POOL = VOICE_LIST.filter(v => v.id && v.id !== 'random');

export default function VeoStudio({ dark = true }) {
    const [inputMode, setInputMode] = useState('Image'); 
    const [model, setModel] = useState('Nano Banana Pro');
    const mediaType = inputMode === 'Image' ? 'Image' : 'Video';

    const [sysStatus, setSysStatus] = useState({
        extensionConnected: false,
        credits: 'Đang tải...',
        licenseDays: 0,
        licenseActive: false
    });

    const [aspectRatio, setAspectRatio] = useState('16:9');
    const [genCount, setGenCount] = useState('1x');
    const [imageQuality, setImageQuality] = useState('1K');
    const [videoQuality, setVideoQuality] = useState('720p');
    const [duration, setDuration] = useState('4s');

    // Extend Chain state
    const [extendPrompts, setExtendPrompts]     = useState('');  // mỗi dòng 1 prompt
    const [extendModel,   setExtendModel]       = useState('Veo 3.1 - Lite [Lower Priority]');
    const [extendChainRunning, setExtChainRun]  = useState(false);
    const [extendResults, setExtendResults]     = useState([]);
    const [extendProgress, setExtendProgress]   = useState({ current: 0, total: 0, stepPct: 0, phase: '', latestFile: null });
    const [extendFinalFile, setExtendFinalFile] = useState(null); // file cuối cùng sau khi chain xong
    const [outputFolder, setOutputFolder] = useState('D:/GoogleFX_Output');
    
    const [prompt, setPrompt] = useState(''); 
    const [referenceImages, setReferenceImages] = useState([]);
    const [i2vItems, setI2vItems] = useState([]);
    const [showEndFrame, setShowEndFrame] = useState(false);
    const [globalI2vPrompt, setGlobalI2vPrompt] = useState('');
    const [ingredientImages, setIngredientImages] = useState([]);
    const [ingredientsPrompt, setIngredientsPrompt] = useState('');
    const [voiceSlots, setVoiceSlots] = useState([{ imgIdx: 0, voiceId: '' }]);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [totalJobs, setTotalJobs] = useState(0);
    const [completedJobs, setCompletedJobs] = useState(0);
    const [successJobs, setSuccessJobs] = useState(0);

    const [jobs, setJobs] = useState([]);
    const [logs, setLogs] = useState([{ time: new Date().toLocaleTimeString(), text: 'Hệ thống Fluxy - Thành Công Media đã sẵn sàng', type: 'success' }]);

    // UI collapse states
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [logOpen, setLogOpen] = useState(false);
    const logsEndRef = useRef(null);

    // ── Proxy xoay state ─────────────────────────────────────────────────────
    const [proxyEnabled, setProxyEnabled] = useState(false);
    const [proxyList, setProxyList]       = useState([]); // [{url,label,enabled,failCount}]
    const [proxyInput, setProxyInput]     = useState(''); // textarea input (1 proxy per line)
    const [proxyOpen, setProxyOpen]       = useState(false); // panel collapse
    const [proxyTestResults, setProxyTestResults] = useState({}); // url → {ok,ms,error,testing}

    // Load proxy settings khi mount
    useEffect(() => {
        window.electronAPI?.veoProxyGet?.().then(data => {
            if (data) {
                setProxyEnabled(!!data.enabled);
                setProxyList(Array.isArray(data.proxies) ? data.proxies : []);
            }
        }).catch(() => {});
    }, []);

    const saveProxies = async (list, enabled) => {
        const result = await window.electronAPI?.veoProxySet?.({ proxies: list, enabled });
        if (result) { setProxyList(result.proxies || []); setProxyEnabled(!!result.enabled); }
    };

    const handleProxyToggle = async (val) => {
        setProxyEnabled(val);
        await window.electronAPI?.veoProxyToggle?.(val);
    };

    const handleProxyApply = async () => {
        const lines = proxyInput.split('\n').map(l => l.trim()).filter(Boolean);
        const newList = lines.map(url => ({ url, label: '', enabled: true, failCount: 0 }));
        await saveProxies(newList, proxyEnabled);
        setProxyInput('');
    };

    const handleProxyRemove = async (url) => {
        const newList = proxyList.filter(p => p.url !== url);
        await saveProxies(newList, proxyEnabled);
    };

    const handleProxyToggleEntry = async (url, val) => {
        const newList = proxyList.map(p => p.url === url ? { ...p, enabled: val } : p);
        await saveProxies(newList, proxyEnabled);
    };

    const handleProxyTest = async (url) => {
        setProxyTestResults(prev => ({ ...prev, [url]: { testing: true } }));
        const res = await window.electronAPI?.veoProxyTest?.(url) || { ok: false, error: 'API không khả dụng' };
        setProxyTestResults(prev => ({ ...prev, [url]: { ...res, testing: false } }));
    };

    const aspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
    const genCounts = ['1x', 'x2', 'x3', 'x4'];
    const imageQualities = ['1K', '2K', '4K']; 
    const durations = ['4s', '6s', '8s'];

    useEffect(() => {
        if (['4s', '6s'].includes(duration)) setVideoQuality('720p');
    }, [duration]);

    useEffect(() => {
        if (inputMode === 'Image') setModel('Nano Banana Pro');
        else if (inputMode === 'Extend') setModel('Veo 3.1 - Lite [Lower Priority]'); // T2V model for first step
        else setModel('Veo 3.1 - Lite [Lower Priority]');
    }, [inputMode]);

    const handleAddIngredientImages = (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        setIngredientImages(prev => [...prev, ...files.map(f => f.path)]);
        e.target.value = null;
    };
    const removeIngredientImage = (index) => setIngredientImages(prev => prev.filter((_, i) => i !== index));

    // Gọi API để lấy trạng thái Extension (vẫn lấy ngày bản quyền ngầm để chặn click Start nếu hết hạn)
    useEffect(() => {
        const fetchSystemStatus = async () => {
            try {
                const res = await fetch('http://localhost:3000/api/system-status');
                if (res.ok) {
                    const data = await res.json();
                    setSysStatus({
                        extensionConnected: data.extensionConnected,
                        credits: data.credits || 'N/A',
                        licenseDays: data.license?.daysLeft || 0,
                        licenseActive: data.license?.isActive || false
                    });
                }
            } catch (error) {
                setSysStatus(prev => ({ ...prev, extensionConnected: false }));
            }
        };

        fetchSystemStatus(); 
        const interval = setInterval(fetchSystemStatus, 3000); 
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        window.electronAPI?.getDownloadsDir().then(dir => {
             if(dir) setOutputFolder(dir + '\\GoogleFX');
        });
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onVeoLog) {
            window.electronAPI.onVeoLog((data) => {
                let type = data.type;
                let text = data.text;
                let targetJobId = null;

                if (typeof text === 'string') {
                    const match = text.match(/^\[JOBID:(.+?)\]\s*(.*)$/);
                    if (match) {
                        targetJobId = match[1];
                        text = match[2];
                    }
                }

                setJobs(prevJobs => {
                    let nextJobs = [...prevJobs];
                    let activeIdx = nextJobs.findIndex(j => j.id.toString() === targetJobId);

                    if (type === 'job_start') {
                        if (activeIdx !== -1) { nextJobs[activeIdx].status = 'running'; nextJobs[activeIdx].progress = 0; }
                    } else if (type === 'progress') {
                        if (activeIdx !== -1) {
                            const newPct = parseInt(text) || 0;
                            if (newPct > (nextJobs[activeIdx].progress || 0)) {
                                nextJobs[activeIdx].progress = newPct;
                            }
                        }
                    } else if (type === 'success' && text.includes('Lưu thành công')) {
                        const matchName = text.match(/Lưu thành công.*:\s*(.+)$/);
                        if (matchName && activeIdx !== -1) {
                            const fileName = matchName[1].trim();
                            if (!nextJobs[activeIdx].files) nextJobs[activeIdx].files = [];
                            nextJobs[activeIdx].files.push(fileName);
                        }
                    } else if (type === 'job_success') {
                        if (activeIdx !== -1) {
                            nextJobs[activeIdx].status = 'done'; nextJobs[activeIdx].progress = 100;
                            setSuccessJobs(s => s + 1); setCompletedJobs(c => c + 1);
                        }
                    } else if (type === 'job_fail') {
                        if (activeIdx !== -1) { nextJobs[activeIdx].status = 'error'; setCompletedJobs(c => c + 1); }
                    } else if (type === 'job_cancel') {
                        if (activeIdx !== -1) { nextJobs[activeIdx].status = 'cancelled'; setCompletedJobs(c => c + 1); }
                    }
                    return nextJobs;
                });

                if (!['progress', 'job_start', 'job_success', 'job_fail'].includes(type) && text.trim() !== '') {
                    setLogs(prev => [...prev, { time: data.time || new Date().toLocaleTimeString(), text: text, type: type }]);
                }
            });
        }
    }, []);

    useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    // Parse extend chain progress từ log messages (real-time)
    useEffect(() => {
        if (!extendChainRunning || logs.length === 0) return;
        const text = logs[logs.length - 1]?.text || '';

        // "🎬 [Step 1/4] T2V: ..." hoặc "🔁 [Step 2/4] Extend: ..."
        const stepStart = text.match(/\[Step (\d+)\/(\d+)\]/);
        if (stepStart) {
            setExtendProgress(prev => ({
                ...prev,
                current: parseInt(stepStart[1]),
                total:   parseInt(stepStart[2]),
                stepPct: 0,
                phase:   text.includes('T2V') ? '🎬 T2V — Tạo video gốc' : '🔁 Extend — Nối tiếp cảnh'
            }));
            return;
        }

        // "[step 1] 50% (...)"
        const pctLine = text.match(/\[step \d+\]\s*(\d+)%/);
        if (pctLine) {
            setExtendProgress(prev => ({ ...prev, stepPct: parseInt(pctLine[1]) }));
            return;
        }

        // "✅ [Step N] Lưu thành công: extend_chain_N.mp4"
        const saved = text.match(/✅ \[Step (\d+)\] Lưu thành công:\s*(.+)/);
        if (saved) {
            const stepNum  = parseInt(saved[1]);
            const fileName = saved[2].trim();
            const filePath = outputFolder + '\\' + fileName;
            setExtendProgress(prev => ({ ...prev, stepPct: 100, latestFile: filePath }));
            // Sidebar mini-grid: chỉ giữ video mới nhất
            setExtendResults([{ step: stepNum, filePath }]);
        }
    }, [logs, extendChainRunning, outputFolder]);

    const handleSelectFolder = async () => {
        if (window.electronAPI) {
            const folder = await window.electronAPI.selectFolder();
            if (folder) setOutputFolder(folder);
        }
    };

    const removeJob = (id) => { setJobs(prev => prev.filter(j => j.id !== id)); };

    const handleStop = () => {
        // Mark all pending/running jobs as cancelled
        setJobs(prev => prev.map(j =>
            (j.status === 'pending' || j.status === 'running')
                ? { ...j, status: 'cancelled' }
                : j
        ));
        setIsGenerating(false);
        setIsPaused(false);
        window.electronAPI?.stopVeo?.();
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: '⛔ Đã dừng toàn bộ tiến trình.', type: 'error' }]);
    };

    const handlePauseResume = () => {
        if (isPaused) {
            setIsPaused(false);
            window.electronAPI?.resumeVeo?.();
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: '▶ Tiếp tục tiến trình.', type: 'info' }]);
        } else {
            setIsPaused(true);
            window.electronAPI?.pauseVeo?.();
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: '⏸ Tạm dừng tiến trình.', type: 'info' }]);
        }
    };

    const handleCancelJob = (id) => {
        setJobs(prev => prev.map(j =>
            (j.id === id && (j.status === 'pending' || j.status === 'running'))
                ? { ...j, status: 'cancelled' }
                : j
        ));
        window.electronAPI?.cancelVeoJob?.(id);
    };

    // In-place regeneration: reset the specific job and re-run only that job
    const handleRegenerateInPlace = async (jobId, newPrompt) => {
        const targetJob = jobs.find(j => j.id === jobId);
        if (!targetJob || !outputFolder) return;

        const finalPrompt = newPrompt || targetJob.prompt;
        const jobMediaType = targetJob.mediaType === 'VIDEO' ? 'Video' : 'Image';

        // Reset the job in-place (keep same position in list)
        setJobs(prev => prev.map(j => j.id === jobId
            ? { ...j, status: 'pending', progress: 0, files: [], prompt: finalPrompt }
            : j
        ));
        setIsGenerating(true);
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `🔄 Tạo lại: ${jobId}`, type: 'info' }]);

        const actualGenCount = jobMediaType === 'Video' ? '1x' : genCount;
        const actualQuality = jobMediaType === 'Image' ? imageQuality : videoQuality;

        const task = {
            id: jobId,
            prompt: finalPrompt,
            fileIndex: targetJob.fileIndex,
            startImage: targetJob._startImage || null,
            endImage: targetJob._endImage || null,
            referenceImages: targetJob._referenceImages || null,
            ingredientImages: targetJob._ingredientImages || null,
        };

        const payload = {
            mediaType: jobMediaType,
            tasks: [task],
            aspectRatio: targetJob.aspectRatio,
            model, outputFolder,
            genCount: actualGenCount,
            quality: actualQuality,
            duration,
        };

        const result = await window.electronAPI.runVeo(payload);
        if (result?.success) {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: '✅ Tạo lại thành công!', type: 'success' }]);
        } else {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `❌ Tạo lại thất bại: ${result?.error || 'Lỗi không xác định'}`, type: 'error' }]);
        }
    };

    // Tạo lại tất cả các job bị lỗi
    const handleRetryAllFailed = async () => {
        if (!sysStatus.licenseActive || sysStatus.licenseDays <= 0) return alert("Giấy phép bản quyền đã hết hạn!");
        if (!sysStatus.extensionConnected) return alert("Chưa kết nối Extension!");
        if (!outputFolder) return alert("Vui lòng chọn thư mục lưu file!");

        const failedJobs = jobs.filter(j => j.status === 'failed');
        if (failedJobs.length === 0) return alert("Không có video lỗi nào để tạo lại!");

        // Reset tất cả failed jobs về pending ngay lập tức
        setJobs(prev => prev.map(j =>
            j.status === 'failed' ? { ...j, status: 'pending', progress: 0, files: [] } : j
        ));
        setIsGenerating(true);
        setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            text: `🔄 Tạo lại ${failedJobs.length} video lỗi...`,
            type: 'info'
        }]);

        // Chạy từng nhóm theo inputMode của từng job
        const tasks = failedJobs.map(j => ({
            id: j.id,
            prompt: j.prompt,
            fileIndex: j.fileIndex,
            startImage: j._startImage || null,
            endImage: j._endImage || null,
            referenceImages: j._referenceImages || null,
            ingredientImages: j._ingredientImages || null,
        }));

        // Xác định mediaType từ job đầu tiên
        const firstJob = failedJobs[0];
        const jobMediaType = firstJob.mediaType === 'VIDEO' ? 'Video' : 'Image';
        const actualQuality = jobMediaType === 'Image' ? imageQuality : videoQuality;
        const actualGenCount = jobMediaType === 'Video' ? '1x' : genCount;

        const payload = {
            mediaType: jobMediaType,
            tasks,
            aspectRatio: firstJob.aspectRatio || aspectRatio,
            model, outputFolder,
            genCount: actualGenCount,
            quality: actualQuality,
            duration,
        };

        const result = await window.electronAPI.runVeo(payload);
        if (result?.success) {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `✅ Tạo lại hoàn tất!`, type: 'success' }]);
        } else {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${result?.error || 'Không xác định'}`, type: 'error' }]);
        }
        setIsGenerating(false);
    };

    const handleClearAllImages = () => {
        if(window.confirm("Bạn có chắc chắn muốn xóa sạch toàn bộ ảnh đã tải lên không?")) {
            setReferenceImages([]); setI2vItems([]);
        }
    };

    const handleAddReferenceImages = (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        setReferenceImages(prev => [...prev, ...files.map(f => f.path)]);
    };
    
    const removeReferenceImage = (index) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
    };

    // Trích xuất prompt text từ 1 dòng — xử lý JSON, comment prefix, annotation bracket
    const extractPromptFromLine = (line) => {
        if (!line) return '';
        let t = line.trim();

        // 1. JSON object → lấy field prompt tốt nhất
        if (t.startsWith('{')) {
            try {
                const obj = JSON.parse(t);
                const VOICE_PFX = /^\[[^\]]*\bvoice\b[^\]]*\],?\s*/i;
                const COMMENT   = /^\s*\/\//;
                const candidates = [obj.final_prompt, obj.dna_prompt, obj.prompt, obj.action_description, obj.title]
                    .filter(Boolean)
                    .map(s => s.replace(VOICE_PFX, '').trim())
                    .filter(s => s.length > 0);
                const best =
                    candidates.find(c => !COMMENT.test(c) && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(c)) ||
                    candidates.find(c => !COMMENT.test(c)) ||
                    candidates[0] || t;
                return best.trim();
            } catch { /* không phải JSON hợp lệ → tiếp tục xử lý text */ }
        }

        // 2. Strip "[Dòng N - T2V]", "[Step N]", "[Cảnh N]" … annotation brackets ở đầu dòng
        t = t.replace(/^\[[^\]]{0,40}\]\s*/i, '').trim();

        // 3. Strip comment prefix "// ..." hoặc "// Video: ..." hoặc "// Step N: ..."
        if (t.startsWith('//')) {
            t = t.replace(/^\/\/+\s*/, '').trim();                       // bỏ //
            t = t.replace(/^(?:Video|Step|Cảnh|Scene|Bước)\s*\d*\s*:\s*/i, '').trim(); // bỏ label
        }

        // 4. Strip số thứ tự đầu dòng kiểu "1. ", "2) ", "Step 3: "
        t = t.replace(/^(?:Step\s*)?\d+[.):\-]\s+/i, '').trim();

        return t;
    };

    const handleBatchI2VImages = (e) => {
        let files = Array.from(e.target.files).filter(f => {
            return f.type.startsWith('image/') || f.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i);
        });
        if (files.length === 0) return;
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        const promptList = globalI2vPrompt.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
        const newItems = [];
        const startIndex = i2vItems.length;

        if (showEndFrame && files.length > 1) {
            for (let i = 0; i < files.length - 1; i++) {
                const p = promptList[startIndex + i] || '';
                newItems.push({
                    id: 'i2v_' + Date.now() + '_' + i,
                    startImage: files[i].path,
                    endImage: files[i+1].path,
                    prompt: p
                });
            }
        } else {
            files.forEach((f, i) => {
                const p = promptList[startIndex + i] || '';
                newItems.push({
                    id: 'i2v_' + Date.now() + '_' + i,
                    startImage: f.path, endImage: null, prompt: p
                });
            });
        }
        setI2vItems(prev => [...prev, ...newItems]);
        e.target.value = null;
    };

    const handleApplyGlobalPrompt = () => {
        const promptList = globalI2vPrompt.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
        if (promptList.length === 0) return alert("Vui lòng nhập danh sách Prompt vào ô trên!");
        setI2vItems(prev => prev.map((item, idx) => ({ ...item, prompt: promptList[idx] || item.prompt })));
    };

    const updateI2vPrompt = (id, newPrompt) => { setI2vItems(prev => prev.map(item => item.id === id ? { ...item, prompt: extractPromptFromLine(newPrompt) } : item)); };
    const updateI2vEndImage = (id, file) => { if (file) setI2vItems(prev => prev.map(item => item.id === id ? { ...item, endImage: file.path } : item)); };
    const removeI2vItem = (id) => { setI2vItems(prev => prev.filter(item => item.id !== id)); };

    const handleStart = async () => {
        if (!sysStatus.licenseActive || sysStatus.licenseDays <= 0) return alert("Giấy phép bản quyền đã hết hạn hoặc không hợp lệ!");
        if (!sysStatus.extensionConnected) return alert("Chưa kết nối Extension! Vui lòng F5 trang Google Labs trên trình duyệt.");
        if (!outputFolder) return alert("Vui lòng chọn thư mục lưu file!");
        
        let tasks = [];
        const baseIndex = jobs.length; // chụp trước khi thêm job mới

        if (inputMode === 'ImageToVideo') {
            if (i2vItems.length === 0) return alert("Vui lòng tải lên ít nhất 1 ảnh Start Frame!");
            tasks = i2vItems.map((item, idx) => ({ id: item.id, prompt: item.prompt, startImage: item.startImage, endImage: showEndFrame ? item.endImage : null, fileIndex: baseIndex + idx + 1 }));
        } else if (inputMode === 'TextToVideo') {
            if (!prompt.trim()) return alert("Vui lòng nhập Prompt để tạo Video!");
            const promptList = prompt.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
            tasks = promptList.map((p, index) => ({ id: 't2v_' + Date.now() + '_' + index, prompt: p, fileIndex: baseIndex + index + 1 }));
        } else if (inputMode === 'Ingredients') {
            if (ingredientImages.length === 0) return alert("Vui lòng thêm ít nhất 1 ảnh Ingredient!");
            if (!ingredientsPrompt.trim()) return alert("Vui lòng nhập Prompt mô tả video cần tạo!");
            const ingrPromptList = ingredientsPrompt.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
            // Ghép 1:1 nếu số ảnh == số prompts; ngược lại tất cả ảnh → tất cả prompts
            const ingrPerPrompt = ingredientImages.length > 1 && ingredientImages.length === ingrPromptList.length;

            // Resolve voice slots: imgIdx → voiceId (random → pick from pool, deduplicate)
            const usedVoices = new Set();
            const voiceImgMap = {};
            voiceSlots.forEach(slot => {
                if (!slot.voiceId) return;
                let vid = slot.voiceId;
                if (vid === 'random') {
                    const avail = VOICE_POOL.filter(v => !usedVoices.has(v.id));
                    if (avail.length === 0) return;
                    vid = avail[Math.floor(Math.random() * avail.length)].id;
                }
                if (!usedVoices.has(vid)) { voiceImgMap[slot.imgIdx] = vid; usedVoices.add(vid); }
            });

            tasks = ingrPromptList.map((p, index) => {
                const taskImgIndices = ingrPerPrompt ? [index] : ingredientImages.map((_, i) => i);
                const taskImgs = taskImgIndices.map(i => ingredientImages[i]);
                const task = {
                    id: 'ingr_' + Date.now() + '_' + index,
                    prompt: p,
                    ingredientImages: taskImgs,
                    fileIndex: baseIndex + index + 1,
                };
                const speakIdx = taskImgIndices.find(i => voiceImgMap[i] !== undefined);
                if (speakIdx !== undefined) task.voiceId = voiceImgMap[speakIdx];
                return task;
            });
        } else if (inputMode === 'Extend') {
            // ── Extend Chain — chạy riêng, không qua hàng đợi thông thường ──
            const prompts = extendPrompts.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
            if (prompts.length === 0) return alert('Vui lòng nhập ít nhất 1 prompt!');
            setExtChainRun(true);
            setExtendResults([]);
            setExtendFinalFile(null);
            setExtendProgress({ current: 0, total: 0, stepPct: 0, phase: '', latestFile: null });
            setLogs([{ time: new Date().toLocaleTimeString(), text: '🔁 Bắt đầu Extend Chain...', type: 'info' }]);
            try {
                const result = await window.electronAPI.extendChain({
                    prompts,
                    aspectRatio,
                    t2vModel: model,
                    t2vDuration: '8s',
                    t2vQuality: videoQuality,
                    extendModel,
                    outputFolder
                });
                if (result?.success) {
                    if (result.files) {
                        setExtendResults(result.files);
                        // Lưu file cuối cùng để hiển thị kết quả sau khi chain xong
                        const lastFile = result.files[result.files.length - 1];
                        const lastPath = lastFile?.filePath || lastFile;
                        if (lastPath) setExtendFinalFile(lastPath);
                    }
                    const count = result.files?.length || 0;
                    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `✅ Extend Chain hoàn tất! ${count} video đã tạo.`, type: 'success' }]);
                    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `🎬 Hoàn thành! ${count} video đã tạo liên tiếp.`, type: 'success' }]);
                } else {
                    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${result?.error || 'Không xác định'}`, type: 'error' }]);
                }
            } catch (err) {
                setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${err.message}`, type: 'error' }]);
            }
            setExtChainRun(false);
            return;
        } else {
            if (!prompt.trim() && referenceImages.length === 0) return alert("Vui lòng nhập prompt hoặc chọn ảnh tham chiếu!");
            const promptList = prompt.split('\n').map(p => extractPromptFromLine(p)).filter(Boolean);
            const finalPrompts = promptList.length > 0 ? promptList : [" "];
            tasks = finalPrompts.map((p, index) => ({ id: 'img_' + Date.now() + '_' + index, prompt: p, referenceImages: referenceImages, fileIndex: baseIndex + index + 1 }));
        }

        if(tasks.length === 0) return;

        const newJobs = tasks.map(t => ({
            id: t.id, prompt: t.prompt || '(Không có prompt)', mediaType: mediaType.toUpperCase(),
            aspectRatio: aspectRatio, status: 'pending', progress: 0, files: [],
            fileIndex: t.fileIndex,
            _startImage: t.startImage || null,
            _endImage: t.endImage || null,
            _referenceImages: t.referenceImages || null,
            _ingredientImages: t.ingredientImages || null,
            _inputMode: inputMode,
        }));
        
        setJobs(prev => [...prev, ...newJobs]);
        setIsGenerating(true);
        setTotalJobs(prev => prev + tasks.length);
        
        setLogs([{ time: new Date().toLocaleTimeString(), text: `Khởi động luồng API tự động...`, type: 'info' }]);

        const actualGenCount = mediaType === 'Video' ? '1x' : genCount;
        const actualQuality = mediaType === 'Image' ? imageQuality : videoQuality;

        const payload = {
            mediaType, tasks, 
            aspectRatio, model, outputFolder,
            genCount: actualGenCount, quality: actualQuality, duration
        };

        const result = await window.electronAPI.runVeo(payload);

        if (result.success) {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: '✅ Đã hoàn tất toàn bộ danh sách!', type: 'success' }]);
        } else {
            setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: `❌ Bị dừng: ${result.error}`, type: 'error' }]);
        }
        setIsGenerating(false); 
    };

    const getFileUrl = (fileName) => `file:///${encodeURI((outputFolder + '\\' + fileName).replace(/\\/g, '/'))}`;

    const vBg   = dark ? 'bg-[#0a0f18]'  : 'bg-gray-100'
    const vSide = dark ? 'bg-[#141c2f]'  : 'bg-white'
    const vPanel= dark ? 'bg-[#0f1524]'  : 'bg-gray-50'
    const vBdr  = dark ? 'border-slate-800/80' : 'border-gray-200'
    const vCard = dark ? 'bg-[#1e293b]/60 border-slate-700/60' : 'bg-white border-gray-200'
    const vInput= dark ? 'bg-[#0f1524] border-slate-700 text-slate-300 placeholder-slate-600' : 'bg-gray-50 border-gray-300 text-gray-800 placeholder-gray-400'
    const vTxt  = dark ? 'text-slate-300' : 'text-gray-700'
    const vTxt2 = dark ? 'text-slate-400' : 'text-gray-500'
    const vHead = dark ? 'bg-[#141c2f]'  : 'bg-white'
    const vHov  = dark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-100'

    return (
        <div className={`flex w-full h-full ${vBg} ${vTxt} font-sans relative`}>

            {/* ── NÚT TOGGLE SIDEBAR (luôn hiện, nằm đè lên border) ── */}
            <button
                onClick={() => setSidebarOpen(v => !v)}
                className={`absolute top-1/2 -translate-y-1/2 z-20 w-5 h-10 flex items-center justify-center ${dark ? 'bg-[#1e293b] border-slate-700 hover:bg-slate-700' : 'bg-white border-gray-300 hover:bg-gray-100'} border rounded-r-md transition-colors shadow-lg`}
                style={{ left: sidebarOpen ? '380px' : '0px' }}
                title={sidebarOpen ? 'Ẩn bảng điều khiển' : 'Mở bảng điều khiển'}
            >
                {sidebarOpen ? <ChevronLeft size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
            </button>

            {/* ── SIDEBAR TRÁI ── */}
            <div className={`${vSide} border-r ${vBdr} flex flex-col shrink-0 h-full shadow-2xl z-10 transition-all duration-300 overflow-hidden ${sidebarOpen ? 'w-[380px]' : 'w-0'}`}>
                <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar w-[380px]">
                    
                    {/* CHỈ GIỮ LẠI KHỐI TRẠNG THÁI EXTENSION, ĐÃ XÓA KHỐI BẢN QUYỀN */}
                    <div className="flex flex-col gap-2 mb-2">
                        <div className="bg-[#1e293b]/60 border border-slate-700/60 rounded-lg p-3">
                            <div className="flex justify-between items-center mb-3">
                                <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                    <Wifi size={12} className={sysStatus.extensionConnected ? "text-emerald-400" : "text-rose-400"} /> 
                                    Máy chủ Extension API
                                </label>
                                {sysStatus.extensionConnected ? (
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 shadow-[0_0_10px_rgba(52,211,153,0.1)]">
                                        <span className="relative flex h-2 w-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                        </span>
                                        Đã Kết Nối
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20">
                                        <WifiOff size={10} /> Đang Chờ Mạng...
                                    </div>
                                )}
                            </div>


                        </div>

                        {/* HƯỚNG DẪN CÀI EXTENSION — chỉ hiển thị khi chưa kết nối */}
                        {!sysStatus.extensionConnected && (
                            <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <HelpCircle size={11} /> Chưa kết nối — Làm theo các bước sau:
                                </p>
                                <ol className="space-y-1.5 mb-3">
                                    {[
                                        ['1', 'Click nút bên dưới để mở thư mục Extension'],
                                        ['2', 'Mở Chrome → vào địa chỉ: chrome://extensions'],
                                        ['3', 'Bật công tắc "Developer mode" (góc trên bên phải)'],
                                        ['4', 'Click "Load unpacked" → chọn thư mục Extension vừa mở'],
                                        ['5', 'Mở trang labs.google trong Chrome → tool tự kết nối'],
                                    ].map(([n, txt]) => (
                                        <li key={n} className="flex items-start gap-2">
                                            <span className="w-4 h-4 bg-amber-500/30 text-amber-400 text-[9px] font-black rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
                                            <span className="text-[10px] text-slate-400 leading-relaxed">{txt}</span>
                                        </li>
                                    ))}
                                </ol>
                                <button
                                    onClick={async () => {
                                        const res = await window.electronAPI.openExtensionFolder();
                                        if (!res?.success) alert('Lỗi: ' + (res?.error || 'Không mở được thư mục'));
                                    }}
                                    className="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border border-amber-500/40 text-amber-300 text-[11px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Download size={12} /> Mở thư mục Extension để cài vào Chrome
                                </button>
                            </div>
                        )}
                    </div>
                    {/* HẾT KHỐI TRẠNG THÁI */}

                    {/* ── PROXY XOAY PANEL ───────────────────────────────── */}
                    <div className="bg-[#1e293b]/60 border border-slate-700/60 rounded-lg overflow-hidden">
                        {/* Header */}
                        <button onClick={() => setProxyOpen(v => !v)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-700/30 transition-colors">
                            <span className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <span className="text-sm">🔄</span> Proxy Xoay
                                {proxyEnabled && proxyList.filter(p=>p.enabled).length > 0 && (
                                    <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[8px] px-1.5 py-0.5 rounded font-bold">
                                        BẬT · {proxyList.filter(p=>p.enabled).length} proxy
                                    </span>
                                )}
                                {proxyEnabled && proxyList.filter(p=>p.enabled).length === 0 && (
                                    <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[8px] px-1.5 py-0.5 rounded font-bold">
                                        BẬT · Chưa có proxy
                                    </span>
                                )}
                            </span>
                            <span className="flex items-center gap-2">
                                {/* Toggle bật/tắt */}
                                <span onClick={e => { e.stopPropagation(); handleProxyToggle(!proxyEnabled); }}
                                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors cursor-pointer ${proxyEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${proxyEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                                </span>
                                {proxyOpen ? <ChevronUp size={12} className="text-slate-500"/> : <ChevronDown size={12} className="text-slate-500"/>}
                            </span>
                        </button>

                        {proxyOpen && (
                            <div className="px-3 pb-3 space-y-2 border-t border-slate-700/40 pt-2">
                                {/* Hướng dẫn */}
                                <p className="text-[9px] text-slate-500 leading-relaxed">
                                    Mỗi dòng 1 proxy. Hỗ trợ: <code className="text-slate-400">host:port</code> hoặc <code className="text-slate-400">http://user:pass@host:port</code>
                                </p>

                                {/* Textarea nhập proxy */}
                                <textarea
                                    value={proxyInput}
                                    onChange={e => setProxyInput(e.target.value)}
                                    placeholder={'192.168.1.1:8080\nhttp://user:pass@proxy.vn:3128\n...'}
                                    rows={4}
                                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-2.5 py-2 text-[10px] text-slate-300 font-mono focus:outline-none focus:border-blue-500 resize-none"
                                />
                                <button onClick={handleProxyApply}
                                    className="w-full py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white text-[10px] font-bold rounded-lg transition-colors">
                                    ➕ Thêm / Cập nhật
                                </button>

                                {/* Danh sách proxy hiện tại */}
                                {proxyList.length > 0 && (
                                    <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                        {proxyList.map((p, i) => {
                                            const tr = proxyTestResults[p.url] || {};
                                            return (
                                                <div key={i} className={`flex items-center gap-1.5 bg-[#0f172a] border rounded-lg px-2 py-1.5 text-[9px] ${p.enabled ? 'border-slate-700' : 'border-slate-800 opacity-50'}`}>
                                                    {/* Enable toggle */}
                                                    <span onClick={() => handleProxyToggleEntry(p.url, !p.enabled)}
                                                        className={`shrink-0 relative inline-flex h-3 w-5 items-center rounded-full transition-colors cursor-pointer ${p.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                                                        <span className={`inline-block h-2 w-2 rounded-full bg-white shadow transition-transform ${p.enabled ? 'translate-x-2.5' : 'translate-x-0.5'}`} />
                                                    </span>
                                                    {/* URL */}
                                                    <span className="flex-1 text-slate-300 font-mono truncate" title={p.url}>{p.url}</span>
                                                    {/* Fail indicator */}
                                                    {p.failCount > 0 && (
                                                        <span className="text-amber-400 shrink-0" title={`${p.failCount} lỗi liên tiếp`}>⚠{p.failCount}</span>
                                                    )}
                                                    {/* Test result */}
                                                    {tr.testing && <Loader2 size={9} className="animate-spin text-slate-400 shrink-0"/>}
                                                    {!tr.testing && tr.ok === true  && <span className="text-emerald-400 shrink-0" title={`OK ${tr.ms}ms`}>✅{tr.ms}ms</span>}
                                                    {!tr.testing && tr.ok === false && <span className="text-red-400 shrink-0 max-w-[50px] truncate" title={tr.error}>❌</span>}
                                                    {/* Test button */}
                                                    <button onClick={() => handleProxyTest(p.url)} disabled={tr.testing}
                                                        className="shrink-0 text-[8px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded transition-colors">
                                                        Test
                                                    </button>
                                                    {/* Remove */}
                                                    <button onClick={() => handleProxyRemove(p.url)}
                                                        className="shrink-0 text-slate-600 hover:text-red-400 transition-colors">
                                                        <X size={10}/>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {proxyList.length === 0 && (
                                    <p className="text-[9px] text-slate-600 text-center py-1">Chưa có proxy nào</p>
                                )}
                                {proxyList.length > 0 && (
                                    <button onClick={() => saveProxies([], false)}
                                        className="w-full py-1 text-[9px] text-slate-600 hover:text-red-400 transition-colors">
                                        🗑 Xóa tất cả proxy
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    {/* HẾT PROXY PANEL */}

                    <div className="flex gap-1 bg-[#0f1524] p-1.5 rounded-lg border border-slate-800 flex-wrap">
                        <button onClick={() => setInputMode('Image')} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${inputMode === 'Image' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>Tạo Ảnh</button>
                        <button onClick={() => setInputMode('TextToVideo')} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${inputMode === 'TextToVideo' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>T2V</button>
                        <button onClick={() => setInputMode('ImageToVideo')} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${inputMode === 'ImageToVideo' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>I2V</button>
                        <button onClick={() => setInputMode('Ingredients')} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${inputMode === 'Ingredients' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>Ingredients</button>
                        <button onClick={() => setInputMode('Extend')} className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all ${inputMode === 'Extend' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>🔁 Extend</button>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-1.5 block uppercase tracking-wider">Model AI</label>
                        <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-[#1e293b] border border-blue-500/50 text-blue-300 text-sm font-semibold rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 cursor-pointer">
                            {inputMode === 'Image' ? (
                                <optgroup label="✨ Tạo Ảnh (Text/Image to Image)">
                                    <option value="Nano Banana Pro">Nano Banana Pro</option>
                                    <option value="Nano Banana 2">Nano Banana 2</option>
                                    <option value="Imagen 4">Imagen 4</option>
                                </optgroup>
                            ) : inputMode === 'Ingredients' ? (
                                <>
                                    <optgroup label="⚡ Omni Flash">
                                        <option value="Omni Flash">Omni Flash r2v (4s/6s/8s/10s)</option>
                                    </optgroup>
                                    <optgroup label="🧪 Veo 3.1 r2v">
                                        <option value="Veo 3.1 - Lite [Lower Priority]">Veo 3.1 Lite r2v [Lower Priority]</option>
                                        <option value="Veo 3.1 - Lite (Fast)">Veo 3.1 Lite r2v (Fast)</option>
                                        <option value="Veo 3.1 - Fast (Balanced)">Veo 3.1 Fast r2v (Balanced)</option>
                                        <option value="Veo 3.1 - Quality (High)">Veo 3.1 Quality r2v (High)</option>
                                    </optgroup>
                                </>
                            ) : inputMode === 'Extend' ? (
                                <optgroup label="🎬 T2V (video đầu tiên)">
                                    <option value="Veo 3.1 - Lite [Lower Priority]">Veo 3.1 - Lite [Lower Priority]</option>
                                    <option value="Veo 3.1 - Lite (Fast)">Veo 3.1 - Lite (Fast)</option>
                                    <option value="Veo 3.1 - Fast (Balanced)">Veo 3.1 - Fast (Balanced)</option>
                                    <option value="Veo 3.1 - Quality (High)">Veo 3.1 - Quality (High)</option>
                                </optgroup>
                            ) : (
                                <>
                                    <optgroup label="⚡ Omni Flash">
                                        <option value="Omni Flash">Omni Flash (4s/6s/8s/10s)</option>
                                    </optgroup>
                                    <optgroup label="🎬 Veo 3.1">
                                        <option value="Veo 3.1 - Lite (Fast)">Veo 3.1 - Lite (Fast)</option>
                                        <option value="Veo 3.1 - Fast (Balanced)">Veo 3.1 - Fast (Balanced)</option>
                                        <option value="Veo 3.1 - Quality (High)">Veo 3.1 - Quality (High)</option>
                                        <option value="Veo 3.1 - Lite [Lower Priority]">Veo 3.1 - Lite [Lower Priority]</option>
                                    </optgroup>
                                </>
                            )}
                        </select>
                        {model === 'Omni Flash' && (
                            <p className="text-[9px] text-amber-400/80 mt-1 flex items-center gap-1">
                                ⚡ Omni Flash tốn <span className="font-bold text-amber-300">30 tín dụng</span> / video
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Tỉ lệ</label>
                            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="bg-[#1e293b] border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5 outline-none cursor-pointer">{aspectRatios.map(ar => <option key={ar} value={ar}>{ar}</option>)}</select>
                        </div>
                        
                        {inputMode === 'Image' ? (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Số lượng</label>
                                    <select value={genCount} onChange={(e) => setGenCount(e.target.value)} className="bg-[#1e293b] border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5 outline-none cursor-pointer">{genCounts.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Chất lượng</label>
                                    <select value={imageQuality} onChange={(e) => setImageQuality(e.target.value)} className="bg-[#1e293b] border border-slate-700 text-slate-300 text-xs rounded px-2 py-1.5 outline-none cursor-pointer">{imageQualities.map(q => <option key={q} value={q}>{q}</option>)}</select>
                                </div>
                            </>
                        ) : inputMode === 'Ingredients' ? (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-violet-400 ml-1 uppercase">Thời lượng</label>
                                    {model === 'Omni Flash' ? (
                                        <select value={duration} onChange={(e) => setDuration(e.target.value)} className="bg-[#1e293b] border border-violet-500/50 text-violet-300 font-bold text-xs rounded px-2 py-1.5 outline-none cursor-pointer">
                                            {['4s', '6s', '8s', '10s'].map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    ) : (
                                        <div className="bg-[#1e293b] border border-violet-700/40 text-violet-300 font-bold text-xs rounded px-2 py-1.5 text-center">8s</div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-violet-400 ml-1 uppercase">Độ phân giải</label>
                                    <select value={videoQuality} onChange={(e) => setVideoQuality(e.target.value)} className="bg-[#1e293b] border border-violet-500/50 text-violet-300 font-bold text-xs rounded px-2 py-1.5 outline-none cursor-pointer">
                                        <option value="720p">720p (Nhanh)</option>
                                        <option value="1080p">1080p (Upscale)</option>
                                    </select>
                                </div>
                            </>
                        ) : inputMode === 'Extend' ? (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Số lượng</label>
                                    <select disabled className="bg-[#1e293b] border border-slate-700 text-slate-500 text-xs rounded px-2 py-1.5 outline-none opacity-50 cursor-not-allowed"><option>1x</option></select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-cyan-400 ml-1 uppercase">Thời lượng</label>
                                    <div className="bg-[#1e293b] border border-cyan-700/40 text-cyan-300 font-bold text-xs rounded px-2 py-1.5 text-center">8s</div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-slate-500 ml-1 uppercase">Số lượng</label>
                                    <select disabled className="bg-[#1e293b] border border-slate-700 text-slate-500 text-xs rounded px-2 py-1.5 outline-none opacity-50 cursor-not-allowed"><option>1x</option></select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-blue-400 ml-1 uppercase">Thời lượng</label>
                                    <select value={duration} onChange={(e) => setDuration(e.target.value)} className="bg-[#1e293b] border border-blue-500/50 text-blue-300 font-bold text-xs rounded px-2 py-1.5 outline-none cursor-pointer">
                                        {(model === 'Omni Flash' ? ['4s', '6s', '8s', '10s'] : durations).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-bold text-blue-400 ml-1 uppercase">Độ phân giải</label>
                                    <select value={videoQuality} onChange={(e) => setVideoQuality(e.target.value)} className="bg-[#1e293b] border border-blue-500/50 text-blue-300 font-bold text-xs rounded px-2 py-1.5 outline-none cursor-pointer">
                                        <option value="720p">720p (Nhanh)</option>
                                        {duration === '8s' && model !== 'Omni Flash' && <option value="1080p">1080p (Nét)</option>}
                                    </select>
                                </div>
                            </>
                        )}
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase tracking-wider">Thư mục lưu file</label>
                        <div className="flex w-full bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden hover:border-slate-500 transition-colors">
                            <input type="text" readOnly value={outputFolder} className="w-full bg-transparent text-[11px] text-slate-300 px-3 py-2.5 outline-none truncate" />
                            <button onClick={handleSelectFolder} className="px-3 bg-slate-700/50 hover:bg-slate-600 text-slate-300 transition-colors shrink-0 flex items-center justify-center border-l border-slate-700" title="Chọn thư mục">
                                <FolderOpen size={16} />
                            </button>
                        </div>
                    </div>

                    {/* VÙNG NHẬP LIỆU THEO CHẾ ĐỘ */}
                    {inputMode === 'Ingredients' ? (
                        <div className="flex flex-col gap-3 flex-1">
                            <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
                                <p className="text-[10px] text-violet-300 font-semibold leading-relaxed">
                                    Thêm nhiều ảnh "thành phần" (nhân vật, đồ vật, phong cảnh…). AI sẽ kết hợp tất cả để tạo ra một video theo mô tả của bạn.
                                </p>
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1">
                                        <ImagePlus size={11} /> Ảnh Ingredients ({ingredientImages.length})
                                    </label>
                                    <div className="flex gap-2">
                                        {ingredientImages.length > 0 && (
                                            <button onClick={() => setIngredientImages([])} className="text-[10px] bg-red-500/20 hover:bg-red-500/40 text-red-400 px-2 py-1 rounded border border-red-500/30 flex items-center gap-1">
                                                <Trash size={10} /> Xóa All
                                            </button>
                                        )}
                                        <label className="text-[10px] bg-violet-700/40 hover:bg-violet-700/60 text-violet-300 px-2.5 py-1 rounded cursor-pointer border border-violet-600/40 flex items-center gap-1">
                                            <Plus size={10} /> Thêm ảnh
                                            <input type="file" multiple accept="image/*" className="hidden" onChange={handleAddIngredientImages} />
                                        </label>
                                    </div>
                                </div>
                                {ingredientImages.length === 0 ? (
                                    <label className="w-full h-24 border-2 border-dashed border-violet-700/40 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-violet-500/60 hover:bg-violet-900/10 transition-colors">
                                        <ImagePlus size={24} className="text-violet-600 mb-1" />
                                        <span className="text-[11px] text-slate-500">Click để chọn ảnh Ingredients</span>
                                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleAddIngredientImages} />
                                    </label>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {ingredientImages.map((img, i) => (
                                            <div key={i} className="relative w-14 h-14 shrink-0 rounded border border-violet-600/50 group">
                                                <img src={`file:///${encodeURI(img.replace(/\\/g, '/'))}`} className="w-full h-full object-cover rounded" />
                                                <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-violet-600 text-white rounded-full text-[9px] font-bold flex items-center justify-center">{i + 1}</div>
                                                <button onClick={() => removeIngredientImage(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"><X size={9} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prompt — Mỗi dòng 1 video</label>
                                    <span className="text-[10px] font-bold text-violet-400">
                                        {(() => { const n = ingredientsPrompt.split('\n').filter(p => p.trim()).length; return n > 0 && ingredientImages.length > 1 && ingredientImages.length === n ? `${n} prompts · 1:1` : `${n} prompts`; })()}
                                    </span>
                                </div>
                                <textarea
                                    value={ingredientsPrompt}
                                    onChange={(e) => setIngredientsPrompt(e.target.value)}
                                    placeholder={"Mỗi dòng = 1 video\n• Nếu số ảnh = số dòng → ảnh ghép 1:1 với dòng\n• Ngược lại → tất cả ảnh dùng chung cho mọi dòng"}
                                    className="w-full h-[140px] bg-[#0f1524] border border-slate-700 rounded-lg p-3 text-[13px] leading-relaxed text-slate-200 focus:outline-none focus:border-violet-500 resize-none custom-scrollbar"
                                />
                            </div>

                            {/* Voice Ingredients */}
                            <div className="bg-violet-900/10 border border-violet-600/20 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1">
                                        <Mic size={11} /> Voice Ingredients
                                    </label>
                                    {voiceSlots.length < 7 && (
                                        <button
                                            onClick={() => setVoiceSlots(prev => [...prev, { imgIdx: 0, voiceId: '' }])}
                                            disabled={isGenerating}
                                            className="text-[9px] bg-violet-700/30 hover:bg-violet-700/50 text-violet-300 px-2 py-0.5 rounded border border-violet-600/40 flex items-center gap-1 disabled:opacity-50"
                                        >
                                            <Plus size={9} /> Thêm giọng
                                        </button>
                                    )}
                                </div>
                                <p className="text-[8px] text-slate-600 leading-tight">Gán giọng nói cho từng ảnh nhân vật. 1 giọng = 1 ảnh. Tối đa 7 cặp.</p>
                                {voiceSlots.map((slot, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                        <span className="text-[9px] text-slate-500 shrink-0">Ảnh</span>
                                        <select
                                            value={slot.imgIdx}
                                            onChange={e => { const v = [...voiceSlots]; v[idx] = { ...v[idx], imgIdx: parseInt(e.target.value) }; setVoiceSlots(v); }}
                                            disabled={isGenerating}
                                            className="w-12 bg-slate-800/50 border border-violet-500/30 rounded px-1 py-1 text-[9px] text-violet-300 focus:outline-none"
                                        >
                                            {ingredientImages.length > 0
                                                ? ingredientImages.map((_, i) => <option key={i} value={i}>#{i + 1}</option>)
                                                : <option value={0}>#1</option>}
                                        </select>
                                        <select
                                            value={slot.voiceId}
                                            onChange={e => { const v = [...voiceSlots]; v[idx] = { ...v[idx], voiceId: e.target.value }; setVoiceSlots(v); }}
                                            disabled={isGenerating}
                                            className="flex-1 bg-slate-800/50 border border-violet-500/30 rounded-lg px-1.5 py-1 text-[9px] text-violet-300 focus:outline-none"
                                        >
                                            {VOICE_LIST.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                                        </select>
                                        {voiceSlots.length > 1 && (
                                            <button
                                                onClick={() => setVoiceSlots(prev => prev.filter((_, i) => i !== idx))}
                                                disabled={isGenerating}
                                                className="text-red-400 hover:text-red-300 shrink-0 disabled:opacity-50"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : inputMode === 'ImageToVideo' ? (
                        <div className="flex flex-col gap-3 flex-1">
                            <div className="bg-[#1e293b]/30 border border-slate-700/50 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                                        <FileText size={12}/> Nhập Prompt Hàng Loạt
                                    </label>
                                    <button onClick={handleApplyGlobalPrompt} className="text-[9px] bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded cursor-pointer transition-colors font-bold shadow-md">
                                        Gán vào {globalI2vPrompt.split('\n').filter(p=>p.trim()).length} ảnh
                                    </button>
                                </div>
                                <textarea 
                                    value={globalI2vPrompt} onChange={(e) => setGlobalI2vPrompt(e.target.value)}
                                    placeholder="Dán mỗi prompt 1 dòng. Dòng 1 sẽ tự gán cho Ảnh 1, dòng 2 cho Ảnh 2..."
                                    className="w-full h-[60px] bg-[#0f1524] border border-slate-700 rounded p-2 text-xs leading-relaxed text-slate-300 focus:outline-none focus:border-blue-500 resize-none custom-scrollbar"
                                ></textarea>
                            </div>

                            <div className="flex items-center justify-between bg-[#1e293b]/50 p-2 rounded-lg border border-slate-700">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-300">
                                    <input type="checkbox" checked={showEndFrame} onChange={(e)=>setShowEndFrame(e.target.checked)} className="rounded border-slate-600 bg-slate-800 w-4 h-4" />
                                    Bật EndFrame
                                </label>
                                <div className="flex gap-2">
                                    {i2vItems.length > 0 && (
                                        <button onClick={handleClearAllImages} className="bg-red-500/20 hover:bg-red-500/40 text-red-400 px-2 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors border border-red-500/30 flex items-center gap-1" title="Xóa toàn bộ ảnh">
                                            <Trash size={12}/> Xóa All
                                        </button>
                                    )}
                                    <label className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors border border-slate-600 flex items-center gap-1">
                                        <FolderPlus size={12}/> Thêm Thư mục
                                        <input type="file" webkitdirectory="true" directory="true" className="hidden" onChange={handleBatchI2VImages} />
                                    </label>
                                    <label className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors border border-slate-600 flex items-center gap-1">
                                        <Plus size={12}/> Thêm ảnh
                                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleBatchI2VImages} />
                                    </label>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1">
                                {i2vItems.length === 0 ? (
                                    <div className="text-center text-slate-500 py-10 border border-dashed border-slate-700 rounded-lg">
                                        <ImagePlus size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-xs font-medium">Chưa có ảnh nào được tải lên</p>
                                    </div>
                                ) : (
                                    i2vItems.map((item) => (
                                        <div key={item.id} className="bg-[#0f1524] border border-slate-700 p-2.5 rounded-lg relative group">
                                            <button onClick={() => removeI2vItem(item.id)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"><X size={12}/></button>
                                            <div className="flex gap-3">
                                                <div className="flex flex-col gap-1 w-[60px] shrink-0">
                                                    <span className="text-[9px] font-bold text-blue-400 text-center">START</span>
                                                    <img src={`file:///${encodeURI(item.startImage.replace(/\\/g, '/'))}`} className="w-full aspect-[3/4] object-cover rounded border border-blue-500/50" />
                                                </div>
                                                <textarea 
                                                    value={item.prompt} onChange={(e) => updateI2vPrompt(item.id, e.target.value)}
                                                    placeholder="Nhập prompt cho đoạn video này..."
                                                    className="flex-1 bg-[#1e293b] border border-slate-700 rounded p-2 text-xs text-slate-300 resize-none outline-none focus:border-blue-500"
                                                />
                                            </div>
                                            {showEndFrame && (
                                                <div className="flex gap-3 mt-3 pt-3 border-t border-slate-800">
                                                    <div className="flex flex-col gap-1 w-[60px] shrink-0">
                                                        <span className="text-[9px] font-bold text-slate-500 text-center">END</span>
                                                        {item.endImage ? (
                                                            <div className="relative">
                                                                <img src={`file:///${encodeURI(item.endImage.replace(/\\/g, '/'))}`} className="w-full aspect-[3/4] object-cover rounded border border-slate-600" />
                                                                <button onClick={()=>updateI2vEndImage(item.id, null)} className="absolute top-0 right-0 p-1 bg-black/60 rounded-bl text-red-400 hover:text-red-300"><X size={10}/></button>
                                                            </div>
                                                        ) : (
                                                            <label className="w-full aspect-[3/4] border border-dashed border-slate-600 rounded flex items-center justify-center cursor-pointer hover:bg-slate-800">
                                                                <FileImage size={16} className="text-slate-600" />
                                                                <input type="file" accept="image/*" className="hidden" onChange={(e) => updateI2vEndImage(item.id, e.target.files[0])} />
                                                            </label>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 flex items-center justify-center text-[10px] text-slate-600 font-medium italic px-2 text-center">
                                                        (Tùy chọn) Chọn ảnh End Frame cho đoạn Video này để Google nội suy.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : inputMode === 'Extend' ? (
                        /* ── EXTEND CHAIN UI ─────────────────────────────── */
                        <div className="flex flex-col gap-3 flex-1">
                            {/* Info banner */}
                            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 space-y-1">
                                <p className="text-[10px] text-cyan-300 font-bold flex items-center gap-1.5">🔁 Extend Scene — Tạo video dài bằng cách nối cảnh</p>
                                <p className="text-[9px] text-slate-500 leading-relaxed">
                                    <span className="text-cyan-400 font-bold">Dòng 1</span> → T2V tạo video gốc (dùng model bên trên + thời lượng bên trái)<br/>
                                    <span className="text-cyan-400 font-bold">Dòng 2, 3…</span> → Extend nối tiếp dựa trên frame cuối video trước
                                </p>
                            </div>

                            {/* Extend model selector */}
                            <div>
                                <label className="text-[9px] font-bold text-cyan-400 mb-1 block uppercase tracking-wider">Model Extend (dòng 2+)</label>
                                <select value={extendModel} onChange={e => setExtendModel(e.target.value)} disabled={extendChainRunning}
                                    className="w-full bg-[#1e293b] border border-cyan-500/40 text-cyan-300 text-xs font-semibold rounded-lg px-3 py-2 focus:outline-none cursor-pointer">
                                    <option value="Veo 3.1 - Lite [Lower Priority]">Veo 3.1 Extension Lite [Lower Priority]</option>
                                    <option value="Veo 3.1 - Lite (Fast)">Veo 3.1 Extension Lite (Fast)</option>
                                    <option value="Veo 3.1 - Fast (Balanced)">Veo 3.1 Extension Fast (Balanced)</option>
                                    <option value="Veo 3.1 - Quality (High)">Veo 3.1 Extension Quality (High)</option>
                                </select>
                            </div>

                            {/* Multi-prompt textarea */}
                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                                        Danh sách Prompt — Mỗi dòng 1 bước
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-bold text-cyan-400">
                                            {(() => {
                                                const lines = extendPrompts.split('\n').filter(p => p.trim());
                                                return lines.length > 0 ? `${lines.length} bước (~${lines.length * 8}s video)` : '0 bước';
                                            })()}
                                        </span>
                                        <button onClick={() => setExtendPrompts('')}
                                            className="text-[9px] text-slate-600 hover:text-red-400 transition-colors">✕ xóa</button>
                                    </div>
                                </div>
                                <textarea
                                    value={extendPrompts}
                                    onChange={e => setExtendPrompts(e.target.value)}
                                    disabled={extendChainRunning}
                                    placeholder={"[Dòng 1 - T2V] A tractor driving across a vast wheat field at golden hour\n[Dòng 2 - Extend] The tractor turns and starts a new row, dust rising behind it\n[Dòng 3 - Extend] Aerial drone shot pulling back to reveal the entire field\n[Dòng 4 - Extend] Sun setting behind the horizon, tractor silhouette in distance"}
                                    className="w-full h-[180px] bg-[#0f1524] border border-cyan-700/40 rounded-lg p-3 text-[12px] leading-relaxed text-slate-200 focus:outline-none focus:border-cyan-500 resize-none custom-scrollbar"
                                />
                                <p className="text-[8px] text-slate-700 mt-1">Không giới hạn số dòng · Mỗi dòng ~8s · Video được nối liên tiếp theo thứ tự</p>
                            </div>

                            {/* Extended results mini-grid */}
                            {extendResults.length > 0 && (
                                <div className="border-t border-slate-800/60 pt-2">
                                    <p className="text-[9px] text-slate-500 mb-1.5 font-bold">{extendResults.length} video đã tạo</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {extendResults.map((r, i) => (
                                            <div key={i} className="relative rounded overflow-hidden w-20 h-12 bg-slate-800 shrink-0 group">
                                                <video src={`file:///${encodeURI(r.filePath.replace(/\\/g, '/'))}`} className="w-full h-full object-cover" muted loop/>
                                                <div className="absolute top-0.5 left-0.5 text-[7px] bg-black/70 text-cyan-300 px-1 rounded font-bold">
                                                    {r.step === 1 ? 'T2V' : `+${r.step - 1}`}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {inputMode === 'Image' && (
                                <div className="bg-[#1e293b]/30 border border-slate-700/50 rounded-lg p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ảnh tham chiếu (Tùy chọn)</label>
                                        <div className="flex gap-2">
                                            {referenceImages.length > 0 && (
                                                <button onClick={handleClearAllImages} className="text-[10px] bg-red-500/20 hover:bg-red-500/40 text-red-400 px-2.5 py-1 rounded cursor-pointer transition-colors border border-red-500/30 flex items-center gap-1" title="Xóa toàn bộ ảnh">
                                                    <Trash size={10}/> Xóa All
                                                </button>
                                            )}
                                            <label className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2.5 py-1 rounded cursor-pointer transition-colors border border-slate-600 flex items-center gap-1">
                                                <Plus size={10}/> Thêm ảnh
                                                <input type="file" multiple accept="image/*" className="hidden" onChange={handleAddReferenceImages} />
                                            </label>
                                        </div>
                                    </div>
                                    {referenceImages.length === 0 ? (
                                        <div className="text-center text-slate-600 py-3 border border-dashed border-slate-700/50 rounded text-[11px]">Chưa có ảnh tham chiếu</div>
                                    ) : (
                                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                                            {referenceImages.map((img, i) => (
                                                <div key={i} className="relative w-12 h-12 shrink-0 rounded border border-slate-600 group">
                                                    <img src={`file:///${encodeURI(img.replace(/\\/g, '/'))}`} className="w-full h-full object-cover rounded" />
                                                    <button onClick={() => removeReferenceImage(i)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md"><X size={10}/></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                     <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prompt - Mỗi dòng 1 job</label>
                                     <span className="text-[10px] font-bold text-slate-500">{prompt.split('\n').filter(p=>p.trim()).length} prompts</span>
                                </div>
                                <textarea
                                    value={prompt} onChange={(e) => setPrompt(e.target.value)}
                                    placeholder={inputMode === 'Image' ? `Nhập prompt tạo ảnh...\n- Một con mèo\n- Một con chó` : `Nhập prompt tạo Video...\n- Cinematic shot of a rainy street...\n- Camera pans across a mountain...`}
                                    className="w-full h-[140px] bg-[#0f1524] border border-slate-700 rounded-lg p-3 text-[13px] leading-relaxed text-slate-200 focus:outline-none focus:border-blue-500 resize-none custom-scrollbar"
                                ></textarea>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-800/80 bg-[#141c2f]">
                    {extendChainRunning ? (
                        <div className="flex gap-2">
                            <button disabled
                                className="flex-1 bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 text-sm font-bold py-3 rounded-lg flex items-center justify-center gap-2 cursor-not-allowed"
                            >
                                <Loader2 size={15} className="animate-spin" /> Extend Chain đang chạy...
                            </button>
                        </div>
                    ) : isGenerating ? (
                        <div className="flex gap-2">
                            <button
                                onClick={handlePauseResume}
                                className={`flex-1 text-sm font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors border shadow-md ${
                                    isPaused
                                        ? 'bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border-blue-500/50'
                                        : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                                }`}
                            >
                                {isPaused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
                                {isPaused ? 'Tiếp tục' : 'Tạm dừng'}
                            </button>
                            <button
                                onClick={handleStop}
                                className="flex-1 bg-slate-800 hover:bg-red-900/40 text-slate-300 hover:text-red-300 text-sm font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors border border-slate-600 hover:border-red-700/50 shadow-md"
                            >
                                <Square size={15} fill="currentColor" /> Dừng tất cả
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleStart}
                            disabled={!sysStatus.extensionConnected || sysStatus.licenseDays <= 0}
                            className={`w-full text-sm font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg
                                ${sysStatus.extensionConnected && sysStatus.licenseDays > 0
                                    ? inputMode === 'Extend'
                                        ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-900/20'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20'
                                    : 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-70'}`}
                        >
                            {inputMode === 'Extend'
                                ? <><span>🔁</span> Bắt đầu Extend Chain</>
                                : <><span className="text-lg leading-none mt-[-2px]">+</span> Thêm vào hàng đợi</>
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* CỘT PHẢI: KẾT QUẢ VÀ LOG */}
            <div className={`flex-1 flex flex-col h-full overflow-hidden ${vPanel}`}>
                <div className={`h-14 border-b ${vBdr} flex items-center justify-between px-6 shrink-0 ${vHead}`}>
                    <div className="flex items-center gap-3">
                        <h2 className="text-sm font-bold text-white tracking-wide">Kết quả</h2>
                        <span className="text-xs font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{jobs.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Nút tạo lại tất cả video lỗi — chỉ hiện khi có ít nhất 1 job failed và không đang chạy */}
                        {!isGenerating && jobs.some(j => j.status === 'failed') && (
                            <button
                                onClick={handleRetryAllFailed}
                                title="Tạo lại tất cả video thất bại"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-orange-900/30 hover:bg-orange-800/50 text-orange-400 border border-orange-700/40 transition-colors"
                            >
                                <RefreshCw size={12} /> Tạo lại tất cả lỗi ({jobs.filter(j => j.status === 'failed').length})
                            </button>
                        )}
                        {isGenerating && (
                            <button
                                onClick={handleStop}
                                title="Dừng tất cả"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-700/40 transition-colors"
                            >
                                <Square size={12} fill="currentColor" /> Dừng tất cả
                            </button>
                        )}
                        <button onClick={() => window.electronAPI.openFolder(outputFolder)} className="p-1.5 text-slate-400 hover:text-white transition-colors" title="Mở thư mục"><FolderOpen size={16}/></button>
                        <button onClick={() => {
                            if (isGenerating) {
                                window.electronAPI?.stopVeo?.();
                                setIsGenerating(false);
                                setIsPaused(false);
                            }
                            setJobs([]);
                            setTotalJobs(0);
                            setCompletedJobs(0);
                            setSuccessJobs(0);
                            setLogs([{ time: new Date().toLocaleTimeString(), text: '🗑️ Đã xóa toàn bộ kết quả.', type: 'info' }]);
                        }} className="p-1.5 text-slate-400 hover:text-red-400 transition-colors" title="Xóa tất cả kết quả"><Trash2 size={16}/></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar relative">
                    {extendChainRunning ? (
                        /* ── EXTEND PROGRESS VIEW ── */
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-10 overflow-y-auto py-6">
                            {/* Phase + step counter */}
                            <div className="text-center space-y-1">
                                {extendProgress.total > 0 && (
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        Bước {extendProgress.current} / {extendProgress.total}
                                    </p>
                                )}
                                <p className="text-sm font-bold text-cyan-300">
                                    {extendProgress.phase || '⏳ Đang khởi động...'}
                                </p>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full max-w-sm space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <span className="text-[11px] text-slate-500">Render</span>
                                    <span className="text-sm font-black text-cyan-400">{extendProgress.stepPct}%</span>
                                </div>
                                <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-500"
                                        style={{ width: `${extendProgress.stepPct}%` }}
                                    />
                                </div>
                            </div>

                            {/* Step dots */}
                            {extendProgress.total > 0 && extendProgress.total <= 20 && (
                                <div className="flex gap-1.5 flex-wrap justify-center max-w-sm">
                                    {Array.from({ length: extendProgress.total }, (_, i) => {
                                        const n = i + 1;
                                        const done   = n < extendProgress.current;
                                        const active = n === extendProgress.current;
                                        return (
                                            <div key={i} title={n === 1 ? 'T2V' : `Extend +${n-1}`}
                                                className={`w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center border transition-all ${
                                                    done   ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' :
                                                    active ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 animate-pulse' :
                                                             'bg-slate-800 border-slate-700 text-slate-600'
                                                }`}>
                                                {done ? '✓' : n}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Latest video preview */}
                            {extendProgress.latestFile && (
                                <div className="flex flex-col items-center gap-1.5 w-full max-w-[380px]">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider self-start">Video vừa xong</p>
                                    <video
                                        key={extendProgress.latestFile}
                                        src={`file:///${encodeURI(extendProgress.latestFile.replace(/\\/g, '/'))}`}
                                        className="w-full max-h-[200px] object-contain bg-black rounded-lg border border-cyan-500/30 shadow-lg"
                                        controls muted loop
                                    />
                                    <p className="text-[9px] text-slate-600 font-mono self-start">
                                        {extendProgress.latestFile.split(/[\\/]/).pop()}
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : extendFinalFile ? (
                        /* ── KẾT QUẢ EXTEND CHAIN ── chỉ hiển thị video cuối cùng */
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 py-6">
                            <div className="flex items-center gap-2">
                                <span className="text-emerald-400 text-lg">✅</span>
                                <p className="text-sm font-bold text-emerald-300">Extend Chain hoàn tất!</p>
                            </div>
                            <video
                                key={extendFinalFile}
                                src={`file:///${encodeURI(extendFinalFile.replace(/\\/g, '/'))}`}
                                className="w-full max-h-[60vh] object-contain bg-black rounded-xl border border-cyan-500/40 shadow-2xl"
                                controls loop
                            />
                            <div className="flex items-center gap-3 w-full">
                                <p className="text-[10px] text-slate-500 font-mono flex-1 truncate">
                                    📁 {extendFinalFile.split(/[\\/]/).pop()}
                                </p>
                                <button
                                    onClick={() => { setExtendFinalFile(null); setExtendResults([]); }}
                                    className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-600 transition-colors shrink-0"
                                >
                                    Xóa kết quả
                                </button>
                            </div>
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                            <Layers size={48} className="mb-4 opacity-50" />
                            <p className="font-semibold text-sm">Chưa có item nào đang chờ xử lý.</p>
                        </div>
                    ) : (
                        <VeoJobGrid jobs={jobs} outputFolder={outputFolder} getFileUrl={getFileUrl} removeJob={removeJob} onSetPrompt={setPrompt} onStart={handleStart} onCancelJob={handleCancelJob} onRegenerateInPlace={handleRegenerateInPlace} />
                    )}
                </div>

                <div className={`${vHead} border-t ${vBdr} p-4 shrink-0 flex items-center justify-between`}>
                    <div className="flex gap-4">
                        {extendChainRunning ? (
                            <span className="text-[13px] font-bold text-cyan-400 flex items-center gap-2">
                                <Loader2 size={13} className="animate-spin" />
                                {extendProgress.current > 0
                                    ? `Step ${extendProgress.current}/${extendProgress.total} — ${extendProgress.stepPct}%`
                                    : 'Đang khởi động...'}
                            </span>
                        ) : (
                            <>
                                <span className="text-[13px] font-bold text-slate-400">Đã xong: <span className="text-white ml-1">{completedJobs} / {totalJobs}</span></span>
                                <span className="text-[13px] font-bold text-emerald-500">Thành công: <span className="ml-1">{successJobs}</span></span>
                            </>
                        )}
                    </div>
                </div>

                {/* LOG PANEL — auto ẩn, click header để mở/đóng */}
                <div className={`${dark ? 'bg-[#0b1120]' : 'bg-gray-100'} border-t ${vBdr} shrink-0 flex flex-col transition-all duration-300 ${logOpen ? 'h-[160px]' : 'h-[36px]'}`}>
                    <button
                        onClick={() => setLogOpen(v => !v)}
                        className="flex items-center justify-between px-4 py-2 hover:bg-slate-800/40 transition-colors cursor-pointer w-full shrink-0"
                    >
                        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                            <Terminal className="w-3.5 h-3.5 text-slate-500" />
                            Hệ thống Log
                            {logs.length > 0 && !logOpen && (
                                <span className="ml-1 bg-slate-700 text-slate-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{logs.length}</span>
                            )}
                            {/* Chấm đỏ khi có lỗi mới mà log đang đóng */}
                            {!logOpen && logs.some(l => l.type === 'error') && (
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            )}
                        </span>
                        <div className="flex items-center gap-2">
                            {logOpen && (
                                <span onClick={e => { e.stopPropagation(); setLogs([]); }} className="text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded transition-colors">
                                    Xóa
                                </span>
                            )}
                            {logOpen ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronUp size={13} className="text-slate-500" />}
                        </div>
                    </button>
                    {logOpen && (
                        <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] font-mono custom-scrollbar space-y-1">
                            {logs.map((log, idx) => (
                                <div key={idx} className="flex gap-2">
                                    <span className="text-slate-600 shrink-0">[{log.time}]</span>
                                    <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}`}>{log.text}</span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}

// ── VeoJobGrid: lưới thumbnail + modal chi tiết ──────────────────────────
function VeoJobGrid({ jobs, outputFolder, getFileUrl, removeJob, onSetPrompt, onStart, onCancelJob, onRegenerateInPlace }) {
    const [selectedJob, setSelectedJob] = useState(null);
    const [editingPrompt, setEditingPrompt] = useState(false);
    const [editedPrompt, setEditedPrompt] = useState('');
    const [promptExpanded, setPromptExpanded] = useState(false);

    const openDetail = (job) => {
        setSelectedJob(job);
        setEditedPrompt(job.prompt || '');
        setEditingPrompt(false);
        setPromptExpanded(false);
    };

    const closeDetail = () => { setSelectedJob(null); setPromptExpanded(false); };

    const handleRegenerate = () => {
        if (!selectedJob) return;
        const finalPrompt = editingPrompt ? editedPrompt : (selectedJob.prompt || '');
        closeDetail();
        // Use in-place regen if available (resets current card, no new card added)
        if (onRegenerateInPlace) {
            onRegenerateInPlace(selectedJob.id, finalPrompt);
        } else {
            // Fallback: old behavior
            if (editingPrompt && editedPrompt !== selectedJob.prompt) onSetPrompt?.(editedPrompt);
            setTimeout(() => onStart?.(), 100);
        }
    };

    // Keep modal in sync with live job updates
    const liveSelectedJob = selectedJob ? jobs.find(j => j.id === selectedJob.id) || selectedJob : null;

    return (
        <>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
                {jobs.map((job) => {
                    const fileUrl = job.files?.[0] ? getFileUrl(job.files[0]) : null;
                    const isVideo = job.files?.[0]?.endsWith('.mp4');
                    const isDone = job.status === 'done';
                    const isRunning = job.status === 'running';
                    const isError = job.status === 'error';
                    const isPending = job.status === 'pending';
                    const isCancelled = job.status === 'cancelled';
                    const canCancel = isRunning || isPending;

                    return (
                        <div
                            key={job.id}
                            onClick={() => openDetail(job)}
                            className={`relative rounded-xl overflow-hidden cursor-pointer border transition-all hover:scale-[1.02] group ${
                                isRunning ? 'border-blue-500/40'
                                : isError ? 'border-red-700/40'
                                : isCancelled ? 'border-slate-700/30 opacity-60'
                                : 'border-slate-700/60 hover:border-slate-500'
                            } bg-[#0b1120]`}
                        >
                            <div className="aspect-video relative flex items-center justify-center overflow-hidden">
                                {isDone && fileUrl ? (
                                    isVideo ? (
                                        <video src={fileUrl} className="w-full h-full object-cover" muted loop autoPlay />
                                    ) : (
                                        <img src={fileUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                    )
                                ) : isRunning ? (
                                    <div className="flex flex-col items-center gap-2">
                                        {job.progress > 0 ? (
                                            <>
                                                <span className="text-4xl font-black text-blue-400 tabular-nums leading-none drop-shadow-lg">{job.progress}%</span>
                                                <div className="flex items-center gap-1.5">
                                                    <Loader2 size={11} className="text-blue-400/70 animate-spin" />
                                                    <span className="text-[10px] text-blue-400/70 font-medium">Đang render...</span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <Loader2 size={24} className="text-blue-400 animate-spin" />
                                                <span className="text-[11px] text-blue-400">Đang render...</span>
                                            </>
                                        )}
                                    </div>
                                ) : isError ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <AlertCircle size={24} className="text-red-500/60" />
                                        <span className="text-[11px] text-red-400/80">Thất bại</span>
                                    </div>
                                ) : isCancelled ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <Ban size={24} className="text-slate-500" />
                                        <span className="text-[11px] text-slate-500">Đã hủy</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 size={20} className="text-slate-600 animate-spin" />
                                        <span className="text-[11px] text-slate-600">Chờ xử lý...</span>
                                    </div>
                                )}

                                {/* Progress bar */}
                                {isRunning && (
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
                                        {job.progress > 0
                                            ? <div className="h-full bg-blue-500 transition-all duration-700 rounded-r-full" style={{ width: `${job.progress}%` }} />
                                            : <div className="h-full bg-blue-500/60 animate-pulse w-full" />
                                        }
                                    </div>
                                )}

                                {/* Hover overlay — done: expand; pending/running: cancel */}
                                {isDone && (
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md">
                                            <Maximize2 size={16} className="text-white" />
                                        </div>
                                    </div>
                                )}
                                {canCancel && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onCancelJob?.(job.id); }}
                                        title="Hủy job này"
                                        className="absolute top-2 right-2 w-7 h-7 bg-red-600/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-md"
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* DETAIL MODAL */}
            {liveSelectedJob && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}
                >
                    <div className="bg-[#141c2f] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
                            <div className="flex items-center gap-2">
                                {liveSelectedJob.status === 'done' && <CheckCircle size={14} className="text-emerald-400" />}
                                {liveSelectedJob.status === 'error' && <AlertCircle size={14} className="text-red-400" />}
                                {liveSelectedJob.status === 'running' && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                                {liveSelectedJob.status === 'pending' && <Loader2 size={14} className="text-slate-500 animate-spin" />}
                                {liveSelectedJob.status === 'cancelled' && <Ban size={14} className="text-slate-500" />}
                                <span className="text-sm font-semibold text-slate-200">
                                    {liveSelectedJob.status === 'done' ? 'Đã hoàn thành'
                                    : liveSelectedJob.status === 'error' ? 'Thất bại'
                                    : liveSelectedJob.status === 'cancelled' ? 'Đã hủy'
                                    : liveSelectedJob.status === 'pending' ? 'Chờ xử lý'
                                    : 'Đang xử lý'}
                                </span>
                                <div className="flex gap-1.5 ml-2">
                                    <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded text-slate-400 font-bold tracking-wider">TEXT TO {liveSelectedJob.mediaType}</span>
                                    <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded text-slate-400">{liveSelectedJob.aspectRatio}</span>
                                </div>
                            </div>
                            <button onClick={closeDetail} className="text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
                        </div>

                        {/* Media */}
                        <div className="aspect-video bg-black">
                            {liveSelectedJob.status === 'done' && liveSelectedJob.files?.[0] ? (
                                liveSelectedJob.files[0].endsWith('.mp4') ? (
                                    <video src={getFileUrl(liveSelectedJob.files[0])} className="w-full h-full object-contain" controls autoPlay loop />
                                ) : (
                                    <img src={getFileUrl(liveSelectedJob.files[0])} className="w-full h-full object-contain" />
                                )
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    {liveSelectedJob.status === 'running' ? <Loader2 size={32} className="text-blue-400 animate-spin" />
                                    : liveSelectedJob.status === 'cancelled' ? <Ban size={32} className="text-slate-600" />
                                    : liveSelectedJob.status === 'pending' ? <Loader2 size={32} className="text-slate-600 animate-spin" />
                                    : <AlertCircle size={32} className="text-red-400/40" />}
                                </div>
                            )}
                        </div>

                        {/* Prompt */}
                        <div className="px-5 py-3 border-t border-slate-800">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prompt</span>
                                <div className="flex items-center gap-2">
                                    {!editingPrompt && (liveSelectedJob.prompt || '').length > 120 && (
                                        <button
                                            onClick={() => setPromptExpanded(v => !v)}
                                            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                                        >
                                            {promptExpanded ? 'Thu gọn ▲' : 'Xem thêm ▼'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setEditingPrompt(!editingPrompt); setEditedPrompt(liveSelectedJob.prompt || ''); setPromptExpanded(false); }}
                                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                                    >
                                        <Edit3 size={11} /> {editingPrompt ? 'Hủy' : 'Sửa'}
                                    </button>
                                </div>
                            </div>
                            {editingPrompt ? (
                                <textarea
                                    value={editedPrompt}
                                    onChange={(e) => setEditedPrompt(e.target.value)}
                                    className="w-full bg-[#0f1524] border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 resize-none focus:outline-none focus:border-blue-500"
                                    rows={4}
                                    autoFocus
                                />
                            ) : (
                                <p className={`text-xs text-slate-400 leading-relaxed font-mono break-all ${promptExpanded ? '' : 'line-clamp-2'}`}>
                                    {liveSelectedJob.prompt}
                                </p>
                            )}
                        </div>

                        {/* Buttons */}
                        <div className="px-5 pb-5 flex gap-2">
                            {(liveSelectedJob.status === 'running' || liveSelectedJob.status === 'pending') && (
                                <button
                                    onClick={() => { onCancelJob?.(liveSelectedJob.id); closeDetail(); }}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-700/30 rounded-xl text-sm font-semibold transition-colors"
                                >
                                    <Ban size={14} /> Hủy job này
                                </button>
                            )}
                            {(liveSelectedJob.status === 'done' || liveSelectedJob.status === 'error' || liveSelectedJob.status === 'cancelled') && (
                                <button
                                    onClick={handleRegenerate}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 rounded-xl text-sm font-semibold transition-colors"
                                >
                                    <RefreshCw size={14} /> {editingPrompt ? 'Tạo lại với prompt mới' : 'Tạo lại'}
                                </button>
                            )}
                            <button
                                onClick={() => { removeJob(liveSelectedJob.id); closeDetail(); }}
                                className="flex items-center justify-center px-4 py-2.5 bg-slate-800 hover:bg-red-900/30 text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-900/50 rounded-xl text-sm transition-colors"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}