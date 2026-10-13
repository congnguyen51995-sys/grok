import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FolderOpen, Scissors, Terminal, Film, Play, Loader2, Layers, CheckSquare, Square, RefreshCw, Settings, Image as ImageIcon, ChevronDown, ChevronUp,} from 'lucide-react';

// % width của crop box trong preview 16:9
const CROP_BOX_PCT = { '1:1': 56.25, '9:16': 31.64 };

function CropAdjuster({ frameUrl, cropRatio, posX, onPosX }) {
  const boxW   = CROP_BOX_PCT[cropRatio] ?? 100;
  const maxLeft = 100 - boxW;
  const boxLeft = (posX / 100) * maxLeft;
  const presets = [
    { label: '◀ Trái', v: 0 },
    { label: '⬛ Giữa', v: 50 },
    { label: '▶ Phải', v: 100 },
  ];
  return (
    <div className="space-y-2">
      <div className="relative w-full rounded-lg overflow-hidden border border-slate-700 select-none"
        style={{ aspectRatio: '16/9', background: '#000' }}>
        {frameUrl
          ? <img src={frameUrl} className="w-full h-full object-cover pointer-events-none" draggable={false} />
          : <div className="w-full h-full flex items-center justify-center text-slate-700 text-[10px]">
              <Film className="w-5 h-5 mr-1.5 opacity-30" /> Chọn video để xem vùng cắt
            </div>
        }
        {/* Overlay trái */}
        <div className="absolute top-0 bottom-0 left-0 bg-black/65 transition-all" style={{ width: `${boxLeft}%` }} />
        {/* Crop box */}
        <div className="absolute top-0 bottom-0 border-2 border-rose-400 transition-all" style={{ left: `${boxLeft}%`, width: `${boxW}%` }}>
          <div className="absolute top-1 left-1 bg-black/70 text-[9px] text-rose-300 font-bold px-1.5 py-0.5 rounded">
            {cropRatio} · {Math.round(posX)}%
          </div>
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-rose-400/30" />
        </div>
        {/* Overlay phải */}
        <div className="absolute top-0 bottom-0 right-0 bg-black/65 transition-all" style={{ width: `${maxLeft - boxLeft}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 shrink-0">◀</span>
        <input type="range" min={0} max={100} step={1} value={posX}
          onChange={e => onPosX(Number(e.target.value))}
          className="flex-1 h-1.5 accent-rose-500 cursor-pointer" />
        <span className="text-[9px] text-slate-500 shrink-0">▶</span>
      </div>
      <div className="flex gap-1.5">
        {presets.map(p => (
          <button key={p.label} onClick={() => onPosX(p.v)}
            className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all ${Math.abs(posX - p.v) < 2 ? 'bg-rose-800/60 border-rose-600 text-rose-200' : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-rose-700/50'}`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function VideoStudio({ dark = true }) {
    // State Quản lý Tab chung
    const [subTab, setSubTab] = useState('extract'); // 'cut', 'merge', hoặc 'extract'
    const [logs, setLogs] = useState([]);
    const [logOpen, setLogOpen] = useState(false); // log panel mặc định ẩn → nội dung chiếm full
    const logsEndRef = useRef(null);

    // ================= STATE CHO CẮT VIDEO =================
    const [inputFile, setInputFile] = useState(null);
    const [segmentTime, setSegmentTime] = useState(10);
    const [cutOutputFolder, setCutOutputFolder] = useState('');
    const [isCutting, setIsCutting] = useState(false);
    const [outputVideos, setOutputVideos] = useState([]);
    const [trimHeadSec, setTrimHeadSec] = useState(0);
    const [trimTailSec, setTrimTailSec] = useState(0);
    const [cropRatio, setCropRatio] = useState(null); // null | '1:1' | '9:16'
    const [cropX, setCropX] = useState(50); // 0=trái … 50=giữa … 100=phải
    const [cropFrameUrl, setCropFrameUrl] = useState(null);

    // ================= STATE CHO GHÉP VIDEO =================
    const [mergeInputFolder, setMergeInputFolder] = useState('');
    const [mergeFiles, setMergeFiles] = useState([]);
    const [selectedMergeFiles, setSelectedMergeFiles] = useState(new Set());
    const [trimStart, setTrimStart] = useState(0);
    const [trimEnd, setTrimEnd] = useState(0);
    const [mergeOutputName, setMergeOutputName] = useState('merged_video');
    const [transitionEffect, setTransitionEffect] = useState('Không có');
    const [isMerging, setIsMerging] = useState(false);

// ================= STATE CHO TRÍCH XUẤT ẢNH =================
    const [extractInputFile, setExtractInputFile] = useState(null);
    const [extractInterval, setExtractInterval] = useState(2); // Mặc định 2 giây
    const [extractOutputFolder, setExtractOutputFolder] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedImages, setExtractedImages] = useState([]);

    const timePresets = [5, 10, 15, 30, 60];
    const extractPresets = [0.5, 1, 2, 5, 10];
    const transitions = ['Không có', 'Ngẫu nhiên', 'Fade (Mờ dần)', 'Dissolve (Hòa tan)', 'Slide Right', 'Wipe Left', 'Circle Open (Viral)'];

    useEffect(() => {
        if (logs.length > 0) {
            logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
            // Tự mở log panel khi có log mới (error tự mở, các loại khác cũng mở)
            if (logs[logs.length - 1]?.type === 'error') setLogOpen(true);
        }
    }, [logs]);

    useEffect(() => {
        if (window.electronAPI.onVideoLog) {
            window.electronAPI.onVideoLog((data) => setLogs(prev => [...prev.slice(-299), data]));
        }
    }, []);

    // -------- HÀM CHO CẮT VIDEO --------
    const handleCutVideo = async () => {
        if (!inputFile || !cutOutputFolder || segmentTime < 1) return alert("Vui lòng điền đủ thông tin!");
        setIsCutting(true);
        setLogOpen(true);
        setLogs([{ time: new Date().toLocaleTimeString(), text: 'Bắt đầu khởi tạo cắt video...', type: 'info' }]);
        const result = await window.electronAPI.cutVideo({ inputPath: inputFile, segmentTime, outputFolder: cutOutputFolder, trimHead: trimHeadSec, trimTail: trimTailSec, cropRatio, cropX });
        if (result.success) {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: '✅ Hoàn tất cắt video!', type: 'success' }]);
            if (result.files) setOutputVideos(result.files);
        } else {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${result.error}`, type: 'error' }]);
        }
        setIsCutting(false);
    };

    // -------- HÀM CHO GHÉP VIDEO --------
    const handleSelectMergeFolder = async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            setMergeInputFolder(folder);
            loadMergeFiles(folder);
        }
    };

    const loadMergeFiles = async (folder) => {
        setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: `Đang quét thư mục: ${folder}...`, type: 'info' }]);
        const files = await window.electronAPI.readVideoFolder(folder);
        setMergeFiles(files);
        setSelectedMergeFiles(new Set(files.map(f => f.path)));
    };

    const toggleSelectAll = () => {
        if (selectedMergeFiles.size === mergeFiles.length) setSelectedMergeFiles(new Set());
        else setSelectedMergeFiles(new Set(mergeFiles.map(f => f.path)));
    };

    const toggleSelectFile = (path) => {
        const newSet = new Set(selectedMergeFiles);
        newSet.has(path) ? newSet.delete(path) : newSet.add(path);
        setSelectedMergeFiles(newSet);
    };

    const handleMergeVideo = async () => {
        if (selectedMergeFiles.size < 2) return alert("Vui lòng chọn ít nhất 2 video để ghép!");
        setIsMerging(true);
        setLogOpen(true);
        setLogs([{ time: new Date().toLocaleTimeString(), text: 'Bắt đầu quá trình ghép video...', type: 'info' }]);
        
        const filesToMerge = mergeFiles.filter(f => selectedMergeFiles.has(f.path)).map(f => f.path);
        
        const result = await window.electronAPI.mergeVideo({
            files: filesToMerge, trimStart, trimEnd, transition: transitionEffect,
            outputFolder: mergeInputFolder, outputName: mergeOutputName
        });

        if (result.success) {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: '✅ Hoàn tất ghép video!', type: 'success' }]);
            window.electronAPI.openFile(result.path);
        } else {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${result.error}`, type: 'error' }]);
        }
        setIsMerging(false);
    };

// -------- HÀM CHO TRÍCH XUẤT ẢNH --------
    const handleExtractImages = async () => {
        if (!extractInputFile || !extractOutputFolder || extractInterval <= 0) return alert("Vui lòng điền đủ thông tin!");
        setIsExtracting(true);
        setExtractedImages([]);
        setLogOpen(true);
        setLogs([{ time: new Date().toLocaleTimeString(), text: `Bắt đầu trích xuất ảnh từ video...`, type: 'info' }]);
        
        const result = await window.electronAPI.extractImages({
            inputPath: extractInputFile,
            interval: extractInterval,
            outputFolder: extractOutputFolder
        });

        if (result.success) {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: `✅ Đã trích xuất thành công ${result.files.length} ảnh!`, type: 'success' }]);
            if (result.files) setExtractedImages(result.files);
        } else {
            setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text: `❌ Lỗi: ${result.error}`, type: 'error' }]);
        }
        setIsExtracting(false);
    };


    return (
        <div className={`flex flex-col w-full h-full ${dark ? 'bg-[#0b1120] text-slate-300' : 'bg-gray-100 text-gray-800'} overflow-hidden`}>
            
            {/* Header Tabs Navigation */}
            <div className={`flex border-b ${dark ? 'border-slate-800 bg-[#141c2f]' : 'border-gray-200 bg-white'} px-6 py-3 gap-4 shrink-0`}>
                <button onClick={() => setSubTab('cut')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'cut' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Scissors size={16} /> Cắt Video
                </button>
                <button onClick={() => setSubTab('merge')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'merge' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <Layers size={16} /> Ghép Video
                </button>
                <button onClick={() => setSubTab('extract')} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${subTab === 'extract' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <ImageIcon size={16} /> Trích xuất Ảnh
                </button>
            </div>

            {/* Nội dung chính */}
            <div className={`flex-1 flex gap-6 p-6 min-h-0 overflow-hidden items-stretch ${dark ? '' : 'bg-gray-100'}`}>
                
                {/* -------------------- TAB CẮT VIDEO -------------------- */}
                {subTab === 'cut' && (
                    <>
                        <div className="w-[320px] bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shrink-0 shadow-sm overflow-hidden h-full">
                            <div className="p-4 border-b border-slate-800 flex items-center gap-2 bg-[#1a233a]">
                                <Scissors size={18} className="text-blue-400" />
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Điều khiển Cắt Video</h2>
                            </div>
                            <div className="p-5 flex-1 overflow-y-auto space-y-6">
                                <div>
                                    <button onClick={async () => {
                                        const p = await window.electronAPI.selectFile('video');
                                        if (p) {
                                            setInputFile(p);
                                            setCropFrameUrl(null);
                                            setCropX(50);
                                            // Extract frame để preview crop
                                            window.electronAPI.extractFrame?.({ inputPath: p, timeOffset: 1 })
                                                .then(res => { if (res?.ok && res.base64) setCropFrameUrl(`data:image/jpeg;base64,${res.base64}`); })
                                                .catch(() => {});
                                        }
                                    }} className={`w-full h-32 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 transition-colors ${inputFile ? 'border-blue-500/50 bg-blue-900/10' : 'border-slate-700 bg-[#0f172a] hover:bg-slate-800'}`}>
                                        <div className={`p-3 rounded-full ${inputFile ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-400'}`}><UploadCloud size={24} /></div>
                                        <div className="text-center px-4">
                                            <p className={`text-sm font-bold truncate w-[250px] ${inputFile ? 'text-blue-400' : 'text-slate-200'}`}>{inputFile ? inputFile.split('\\').pop() : 'Nhấn để chọn file'}</p>
                                        </div>
                                    </button>
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Độ dài mỗi phần (Giây)</label>
                                    <input type="number" min="1" value={segmentTime} onChange={(e) => setSegmentTime(parseInt(e.target.value) || 0)} className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 mb-3 font-mono" />
                                    <div className="flex gap-2">
                                        {timePresets.map(time => (
                                            <button key={time} onClick={() => setSegmentTime(time)} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${segmentTime === time ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{time}s</button>
                                        ))}
                                    </div>
                                </div>
                                {/* Cắt đầu / đuôi */}
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">✂️ Cắt đầu / đuôi (giây)</label>
                                    <div className="flex gap-3">
                                        <div className="flex-1">
                                            <label className="text-[10px] text-emerald-400 font-semibold mb-1 block">Bỏ đầu</label>
                                            <input type="number" min="0" value={trimHeadSec} onChange={e => setTrimHeadSec(Math.max(0, parseInt(e.target.value) || 0))}
                                                className="w-full bg-[#0f172a] border border-emerald-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 text-center font-mono" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] text-rose-400 font-semibold mb-1 block">Bỏ đuôi</label>
                                            <input type="number" min="0" value={trimTailSec} onChange={e => setTrimTailSec(Math.max(0, parseInt(e.target.value) || 0))}
                                                className="w-full bg-[#0f172a] border border-rose-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500 text-center font-mono" />
                                        </div>
                                    </div>
                                </div>

                                {/* Crop tỉ lệ */}
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">🔲 Crop tỉ lệ (từ 16:9)</label>
                                    <div className="flex gap-2">
                                        {[
                                            { val: null,   label: '16:9', sub: 'Giữ nguyên' },
                                            { val: '1:1',  label: '1:1',  sub: '1080×1080' },
                                            { val: '9:16', label: '9:16', sub: '1080×1920' },
                                        ].map(opt => (
                                            <button key={String(opt.val)} onClick={() => setCropRatio(opt.val)}
                                                className={`flex-1 py-2 rounded-lg text-xs font-bold border flex flex-col items-center gap-0.5 transition-all ${cropRatio === opt.val ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'}`}>
                                                <span>{opt.label}</span>
                                                <span className="text-[9px] opacity-70 font-normal">{opt.sub}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {cropRatio && <p className="text-[9px] text-amber-500/80 mt-1.5">⚠ Crop sẽ re-encode video (chậm hơn copy)</p>}
                                    {/* Crop adjuster — chỉ hiện khi chọn 1:1 hoặc 9:16 */}
                                    {cropRatio && (
                                        <div className="mt-3 border border-slate-700/60 rounded-xl p-3 bg-[#0a101e] space-y-1.5">
                                            <p className="text-[10px] font-bold text-slate-400 mb-2">🎯 Chỉnh vùng cắt</p>
                                            <CropAdjuster frameUrl={cropFrameUrl} cropRatio={cropRatio} posX={cropX} onPosX={setCropX} />
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Thư mục lưu</label>
                                    <div className="flex gap-2">
                                        <input type="text" readOnly value={cutOutputFolder} placeholder="Chưa chọn..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-xs text-slate-400 focus:outline-none truncate" />
                                        <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if(f) setCutOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg"><FolderOpen size={16} /></button>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-800 bg-[#1a233a]">
                                <button onClick={handleCutVideo} disabled={isCutting} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg disabled:shadow-none">
                                    {isCutting ? <Loader2 size={18} className="animate-spin" /> : <Film size={18} />} {isCutting ? 'ĐANG CẮT...' : 'CẮT VIDEO'}
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden min-w-0">
                            <div className="p-4 border-b border-slate-800 bg-[#1a233a]"><h2 className="text-sm font-bold text-white uppercase tracking-wider">Video đã tạo</h2></div>
                            <div className="flex-1 overflow-y-auto p-6 bg-[#0f172a]/30">
                                {outputVideos.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600"><Film size={48} className="mb-4 opacity-20" /><p className="text-sm font-medium">Video đã cắt sẽ xuất hiện ở đây</p></div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {outputVideos.map((vid, idx) => (
                                            <div key={idx} className="bg-[#1e293b] border border-slate-700 rounded-lg p-3 hover:border-slate-500 cursor-pointer" onClick={() => window.electronAPI.openFile(vid.path)}>
                                                <div className="aspect-video bg-black rounded-md flex items-center justify-center mb-2"><Play size={24} className="text-white/50" /></div>
                                                <p className="text-xs font-bold text-slate-200 truncate">{vid.name}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* -------------------- TAB GHÉP VIDEO -------------------- */}
                {subTab === 'merge' && (
                    <div className="flex flex-col flex-1 gap-4 overflow-hidden h-full">
                        <div className="flex gap-4 shrink-0">
                            <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl p-4 flex items-end gap-4 shadow-sm">
                                <div className="flex-1">
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Thư mục chứa video gốc</label>
                                    <div className="flex gap-2">
                                        <input type="text" readOnly value={mergeInputFolder} placeholder="Chọn thư mục chứa các đoạn video..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-400 focus:outline-none truncate" />
                                        <button onClick={handleSelectMergeFolder} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 font-semibold text-sm shrink-0"><FolderOpen size={16} /> Duyệt</button>
                                        <button onClick={() => loadMergeFiles(mergeInputFolder)} disabled={!mergeInputFolder} className="bg-slate-800 hover:bg-slate-700 text-emerald-400 disabled:text-slate-600 px-3 py-2.5 rounded-lg shrink-0"><RefreshCw size={16} /></button>
                                    </div>
                                </div>
                                <div className="w-24">
                                    <label className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest mb-2 block">Cắt Đầu (s)</label>
                                    <input type="number" min="0" value={trimStart} onChange={e => setTrimStart(parseInt(e.target.value)||0)} className="w-full bg-[#0f172a] border border-emerald-500/30 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 text-center" />
                                </div>
                                <div className="w-24">
                                    <label className="text-[11px] font-bold text-rose-500 uppercase tracking-widest mb-2 block">Cắt Đuôi (s)</label>
                                    <input type="number" min="0" value={trimEnd} onChange={e => setTrimEnd(parseInt(e.target.value)||0)} className="w-full bg-[#0f172a] border border-rose-500/30 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500 text-center" />
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden">
                            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-[#1a233a]">
                                <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white transition-colors">
                                    {selectedMergeFiles.size === mergeFiles.length && mergeFiles.length > 0 ? <CheckSquare className="text-emerald-500" size={16} /> : <Square size={16} />}
                                    Chọn tất cả <span className="text-xs text-slate-500 ml-2">Đã chọn: {selectedMergeFiles.size}/{mergeFiles.length}</span>
                                </button>
                                <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-md"><Settings size={14}/> Sắp xếp mặc định</button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-4 bg-[#0f172a]/30">
                                {mergeFiles.length === 0 ? (
                                     <div className="h-full flex flex-col items-center justify-center text-slate-600"><Layers size={48} className="mb-4 opacity-20" /><p className="text-sm font-medium">Chọn thư mục để tải video</p></div>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {mergeFiles.map((f, i) => {
                                            const isSelected = selectedMergeFiles.has(f.path);
                                            return (
                                                <div key={i} onClick={() => toggleSelectFile(f.path)} className={`relative flex items-center p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-emerald-900/20 border-emerald-500/50' : 'bg-[#1e293b] border-slate-700 hover:border-slate-500'}`}>
                                                    <div className="mr-3">{isSelected ? <CheckSquare className="text-emerald-500" size={18}/> : <Square className="text-slate-500" size={18}/>}</div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-slate-200 truncate" title={f.name}>{f.name}</p>
                                                        <p className="text-[10px] text-slate-500 mt-0.5">{f.size}</p>
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); window.electronAPI.openFile(f.path); }} className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white ml-2 shrink-0"><Play size={12} fill="currentColor" /></button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            
                            <div className="p-4 border-t border-slate-800 bg-[#1a233a] flex gap-4 items-end">
                                <div className="flex-1">
                                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-1.5 block">Tên file đầu ra:</label>
                                    <div className="flex">
                                        <input type="text" value={mergeOutputName} onChange={e => setMergeOutputName(e.target.value)} className="w-full bg-[#0f172a] border border-slate-700 rounded-l-lg px-4 py-2.5 text-sm text-white focus:outline-none" />
                                        <span className="bg-slate-800 border-y border-r border-slate-700 px-3 py-2.5 text-sm text-slate-500 rounded-r-lg">.mp4</span>
                                    </div>
                                </div>
                                <div className="w-64">
                                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-1.5 block">Hiệu ứng chuyển cảnh:</label>
                                    <select value={transitionEffect} onChange={e => setTransitionEffect(e.target.value)} className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none">
                                        {transitions.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <button onClick={handleMergeVideo} disabled={isMerging || selectedMergeFiles.size < 2} className="w-64 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                    {isMerging ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} 
                                    {isMerging ? 'ĐANG RENDER...' : `GHÉP ${selectedMergeFiles.size} VIDEO`}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* -------------------- TAB TRÍCH XUẤT ẢNH -------------------- */}
                {subTab === 'extract' && (
                    <>
                        <div className="w-[320px] bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shrink-0 shadow-sm overflow-hidden h-full">
                            <div className="p-4 border-b border-slate-800 flex items-center gap-2 bg-[#1a233a]">
                                <ImageIcon size={18} className="text-purple-400" />
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Điều khiển Trích xuất</h2>
                            </div>
                            <div className="p-5 flex-1 overflow-y-auto space-y-6">
                                <div>
                                    <button onClick={async () => { const p = await window.electronAPI.selectFile('video'); if (p) setExtractInputFile(p); }} className={`w-full h-32 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 transition-colors ${extractInputFile ? 'border-purple-500/50 bg-purple-900/10' : 'border-slate-700 bg-[#0f172a] hover:bg-slate-800'}`}>
                                        <div className={`p-3 rounded-full ${extractInputFile ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-800 text-slate-400'}`}><UploadCloud size={24} /></div>
                                        <div className="text-center px-4">
                                            <p className={`text-sm font-bold truncate w-[250px] ${extractInputFile ? 'text-purple-400' : 'text-slate-200'}`}>{extractInputFile ? extractInputFile.split('\\').pop() : 'Nhấn để chọn file'}</p>
                                            <p className="text-[10px] text-slate-500 mt-1">{extractInputFile ? 'Đã chọn video' : 'Chọn video từ máy tính'}</p>
                                        </div>
                                    </button>
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Khoảng cách (Giây)</label>
                                    <input type="number" step="0.5" min="0.1" value={extractInterval} onChange={(e) => setExtractInterval(parseFloat(e.target.value) || 2)} className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500 mb-3 font-mono" />
                                    <div className="flex gap-2">
                                        {extractPresets.map(time => (
                                            <button key={time} onClick={() => setExtractInterval(time)} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${extractInterval === time ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{time}s</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Thư mục lưu</label>
                                    <div className="flex gap-2">
                                        <input type="text" readOnly value={extractOutputFolder} placeholder="Chưa chọn thư mục..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-4 py-2.5 text-xs text-slate-400 focus:outline-none truncate" />
                                        <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if(f) setExtractOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg"><FolderOpen size={16} /></button>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 border-t border-slate-800 bg-[#1a233a]">
                                <button onClick={handleExtractImages} disabled={isExtracting} className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 disabled:shadow-none">
                                    {isExtracting ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />} {isExtracting ? 'ĐANG TRÍCH XUẤT...' : 'TRÍCH XUẤT ẢNH'}
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden min-w-0">
                            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#1a233a]">
                                <div className="flex items-center gap-2">
                                    <ImageIcon size={18} className="text-purple-400" />
                                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Ảnh đã trích xuất</h2>
                                    {extractedImages.length > 0 && (
                                        <span className="ml-2 text-xs font-bold px-2 py-0.5 bg-slate-800 text-slate-300 rounded-md border border-slate-700">{extractedImages.length} ảnh</span>
                                    )}
                                </div>
                                {extractedImages.length > 0 && (
                                    <button onClick={() => window.electronAPI.openFolder(extractOutputFolder)} className="flex items-center gap-2 text-xs font-bold text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-md transition-colors"><FolderOpen size={14}/> Mở thư mục</button>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 bg-[#0f172a]/30">
                                {extractedImages.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-600"><ImageIcon size={48} className="mb-4 opacity-20" /><p className="text-sm font-medium">Ảnh trích xuất sẽ xuất hiện ở đây</p></div>
                                ) : (
                                    <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
                                        {extractedImages.map((img, idx) => (
                                            <div key={idx} className="bg-[#1e293b] border border-slate-700 rounded-lg p-2 hover:border-slate-500 transition-colors group cursor-pointer" onClick={() => window.electronAPI.openFile(img.path)}>
                                                <div className="aspect-square bg-black rounded flex items-center justify-center mb-2 overflow-hidden">
                                                    {/* Hiển thị ảnh thực tế từ ổ cứng */}
                                                    <img src={`file:///${encodeURI(img.path.replace(/\\/g, '/'))}`} alt={img.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                                                </div>
                                                <p className="text-[10px] font-mono text-slate-300 truncate text-center" title={img.name}>{img.name}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}


            </div>

            {/* DÒNG DƯỚI CÙNG: NHẬT KÝ HOẠT ĐỘNG (có thể thu/mở) */}
            <div className={`${dark ? 'bg-[#0b0f19] border-slate-800' : 'bg-gray-200 border-gray-300'} border-t shrink-0 shadow-inner overflow-hidden font-mono flex flex-col transition-all duration-200`}
                style={{ height: logOpen ? '180px' : '36px' }}>
                {/* Thanh tiêu đề — click để mở/thu */}
                <button
                    onClick={() => setLogOpen(v => !v)}
                    className="flex items-center justify-between px-4 h-9 hover:bg-slate-800/40 transition-colors cursor-pointer w-full shrink-0"
                >
                    <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        Nhật ký hoạt động
                        {logs.length > 0 && !logOpen && (
                            <span className="ml-1 bg-slate-700 text-slate-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{logs.length}</span>
                        )}
                        {!logOpen && logs.some(l => l.type === 'error') && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        )}
                        {!logOpen && logs.some(l => l.type === 'success') && !logs.some(l => l.type === 'error') && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
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
                {/* Nội dung log */}
                {logOpen && (
                    <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] leading-relaxed custom-scrollbar space-y-1">
                        {logs.length === 0
                            ? <p className="text-slate-600 text-center mt-4">Chưa có nhật ký nào.</p>
                            : logs.map((log, idx) => (
                                <div key={idx} className="flex gap-3">
                                    <span className="text-slate-600 shrink-0">[{log.time}]</span>
                                    <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}`}>
                                        {log.text}
                                    </span>
                                </div>
                            ))
                        }
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
