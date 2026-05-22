import React, { useState } from 'react';
import { Play, Download, RotateCcw, Trash2, CheckCircle, AlertCircle, Clock, Loader2, Maximize2, X, Edit3, RefreshCw, Ban } from 'lucide-react';

function toFileUrl(filePath) {
  if (!filePath) return null;
  return 'file:///' + filePath.replace(/\\/g, '/');
}

export default function JobCard({ job, onRetry, onDelete, onDownload, onPreview, onCancel }) {
  const [showDetail, setShowDetail] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(job.prompt || '');
  const [promptExpanded, setPromptExpanded] = useState(false);

  const isRunning = job.status === 'RUNNING';
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isPending = job.status === 'PENDING';
  const isCancelled = job.status === 'CANCELLED';
  const canCancel = isRunning || isPending;
  const isVideo = job.local_file_path?.match(/\.(mp4|webm|mov|avi)$/i);

  // Direct file:// URL — works because webSecurity: false is set in BrowserWindow
  const fileUrl = isCompleted && job.local_file_path ? toFileUrl(job.local_file_path) : null;
  const videoSrc = isVideo && fileUrl ? fileUrl : null;
  const imageSrc = !isVideo && fileUrl ? fileUrl : null;

  const handleRetryWithPrompt = () => {
    onRetry?.({ ...job, prompt: editedPrompt });
    setShowDetail(false);
    setPromptExpanded(false);
  };

  return (
    <>
      {/* THUMBNAIL CARD */}
      <div
        onClick={() => setShowDetail(true)}
        className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all hover:scale-[1.02] group ${
          isRunning ? 'border-blue-500/50'
          : isFailed ? 'border-red-700/40'
          : isCancelled ? 'border-slate-700/30 opacity-60'
          : 'border-slate-700 hover:border-slate-400'
        } bg-slate-900`}
      >
        <div className="aspect-video relative overflow-hidden bg-slate-800">
          {/* Status overlay khi đang xử lý */}
          {(isRunning || isPending) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900/80">
              {isRunning ? (
                job.progress > 0 ? (
                  <>
                    <span className="text-4xl font-black text-blue-400 tabular-nums leading-none drop-shadow-lg">{job.progress}%</span>
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className="w-3 h-3 border border-blue-500/50 border-t-blue-400 rounded-full animate-spin" />
                      <p className="text-[10px] text-blue-400/70 font-medium">Đang render...</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-2" />
                    <p className="text-[11px] text-blue-400 font-semibold">Đang render...</p>
                  </>
                )
              ) : (
                <>
                  <Clock className="w-7 h-7 text-slate-600 mb-2" />
                  <p className="text-[11px] text-slate-500">Chờ xử lý</p>
                </>
              )}
            </div>
          )}

          {/* Cancelled state */}
          {isCancelled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900/90">
              <Ban className="w-8 h-8 text-slate-500/60 mb-2" />
              <p className="text-[11px] text-slate-500 font-semibold">Đã hủy</p>
            </div>
          )}

          {/* Error state */}
          {isFailed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900/90">
              <AlertCircle className="w-8 h-8 text-red-500/60 mb-2" />
              <p className="text-[11px] text-red-400/80 font-semibold">Lỗi xử lý</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Thất bại</p>
            </div>
          )}

          {/* Media content */}
          {isCompleted && (
            videoSrc
              ? <video src={videoSrc} className="w-full h-full object-cover" muted loop autoPlay />
              : imageSrc
                ? <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                    style={{ backgroundImage: `url("${imageSrc}")` }} />
                : <div className="w-full h-full flex items-center justify-center">
                    <Loader2 size={20} className="text-slate-600 animate-spin" />
                  </div>
          )}

          {/* Progress bar bottom */}
          {isRunning && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700/80">
              {job.progress > 0
                ? <div className="h-full bg-blue-500 transition-all duration-700 rounded-r-full" style={{ width: `${job.progress}%` }} />
                : <div className="h-full bg-blue-500/50 animate-pulse w-full" />
              }
            </div>
          )}

          {/* Hover overlay khi hoàn thành */}
          {isCompleted && (
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-md">
                <Maximize2 size={18} className="text-white" />
              </div>
            </div>
          )}

          {/* Cancel button on hover for pending/running */}
          {canCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel?.(job.id); }}
              title="Hủy job này"
              className="absolute top-2 right-2 w-7 h-7 bg-red-600/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-md"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* DETAIL MODAL */}
      {showDetail && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowDetail(false); setPromptExpanded(false); } }}
        >
          <div className="bg-[#141c2f] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                {isCompleted && <CheckCircle size={14} className="text-emerald-400" />}
                {isFailed && <AlertCircle size={14} className="text-red-400" />}
                {isRunning && <Loader2 size={14} className="text-blue-400 animate-spin" />}
                {isPending && <Loader2 size={14} className="text-slate-500 animate-spin" />}
                {isCancelled && <Ban size={14} className="text-slate-500" />}
                <span className="text-sm font-semibold text-slate-200">
                  {isCompleted ? 'Đã hoàn thành' : isFailed ? 'Thất bại' : isCancelled ? 'Đã hủy' : isPending ? 'Chờ xử lý' : 'Đang xử lý'}
                </span>
                <div className="flex gap-1.5 ml-2">
                  {job.mode && <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded text-slate-400 font-bold tracking-wider">{job.mode.replace(/_/g, ' ')}</span>}
                  {job.aspect_ratio && <span className="text-[10px] px-2 py-0.5 bg-slate-700 rounded text-slate-400">{job.aspect_ratio}</span>}
                </div>
              </div>
              <button onClick={() => { setShowDetail(false); setPromptExpanded(false); }} className="text-slate-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Media preview */}
            {(() => {
              const [arW, arH] = (job.aspect_ratio || '16:9').split(':').map(Number);
              return (
                <div className="bg-black relative w-full flex items-center justify-center" style={{ aspectRatio: `${arW}/${arH}`, maxHeight: '60vh' }}>
                  {isCompleted && (
                    videoSrc
                      ? <video src={videoSrc} className="w-full h-full object-contain" controls autoPlay loop />
                      : imageSrc
                        ? <div className="w-full h-full bg-contain bg-center bg-no-repeat"
                            style={{ backgroundImage: `url("${imageSrc}")` }} />
                        : <Loader2 size={32} className="text-slate-600 animate-spin" />
                  )}
                  {!isCompleted && (
                    <div className="w-full h-full flex items-center justify-center">
                      {isRunning ? <Loader2 size={32} className="text-blue-400 animate-spin" /> : <AlertCircle size={32} className="text-red-400/50" />}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Prompt section */}
            <div className="px-5 py-3 border-t border-slate-800">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prompt</span>
                <div className="flex items-center gap-2">
                  {!editingPrompt && (job.prompt || '').length > 120 && (
                    <button
                      onClick={() => setPromptExpanded(v => !v)}
                      className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                    >
                      {promptExpanded ? 'Thu gọn ▲' : 'Xem thêm ▼'}
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingPrompt(!editingPrompt); setEditedPrompt(job.prompt || ''); setPromptExpanded(false); }}
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
                  {job.prompt}
                </p>
              )}
            </div>

            {/* Error message */}
            {isFailed && job.error_message && (
              <div className="px-5 pb-3">
                <p className="text-xs text-red-400/80 bg-red-900/20 border border-red-900/30 rounded-lg px-3 py-2">{job.error_message}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="px-5 pb-5 flex gap-2">
              {canCancel && (
                <button
                  onClick={() => { onCancel?.(job.id); setShowDetail(false); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-700/30 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Ban size={14} /> Hủy job này
                </button>
              )}
              {(isFailed || isCompleted || isCancelled) && (
                <button
                  onClick={handleRetryWithPrompt}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 rounded-xl text-sm font-semibold transition-colors"
                >
                  <RefreshCw size={14} /> {editingPrompt ? 'Tạo lại với prompt mới' : 'Tạo lại'}
                </button>
              )}
              {isCompleted && (
                <button
                  onClick={() => onPreview?.(job)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Maximize2 size={14} /> Phóng to
                </button>
              )}
              <button
                onClick={() => { onDelete?.(job.id); setShowDetail(false); }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-red-900/30 text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-900/50 rounded-xl text-sm font-semibold transition-colors"
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
