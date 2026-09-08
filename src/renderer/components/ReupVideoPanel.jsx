import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateSeoMetadata, generateThumbnailPromptsOnly, analyzeThumbImageToPrompt } from './CreatorStudio';
import { transcribeAudioChunked } from '../services/audioToVideo';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import {
  Play, Square, Pause, FolderOpen, CheckCircle2, Loader2, Zap, Music2,
  AlertCircle, ChevronRight, ChevronLeft, Film, Image as ImageIcon, Sparkles,
  FileText, Brain, Layers, Copy, Check, ChevronDown, ChevronUp,
  Video, Scissors, ExternalLink, Cpu, Wand2,
  UploadCloud, Download, Clock, Mic, RefreshCw,
  Languages, Flame, Terminal, Link, Volume2, VolumeX, X, Users, ImagePlus, Plus,
} from 'lucide-react';

// ─── Local helpers (duplicated from AutoAnimation for standalone use) ──────────
const LS_KEYS = 'fluxy_gemini_api_keys';
function loadKeys() { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); } catch { return []; } }
const SUBTITLE_LANGUAGES = [
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'en', name: 'English (Tiếng Anh)' },
  { code: 'zh', name: '中文 (Tiếng Trung)' },
  { code: 'ja', name: '日本語 (Tiếng Nhật)' },
  { code: 'ko', name: '한국어 (Tiếng Hàn)' },
  { code: 'th', name: 'ภาษาไทย (Tiếng Thái)' },
  { code: 'id', name: 'Bahasa Indonesia (Tiếng Indonesia)' },
  { code: 'ms', name: 'Bahasa Melayu (Tiếng Mã Lai)' },
  { code: 'fr', name: 'Français (Tiếng Pháp)' },
  { code: 'de', name: 'Deutsch (Tiếng Đức)' },
  { code: 'es', name: 'Español (Tiếng Tây Ban Nha)' },
  { code: 'pt', name: 'Português (Tiếng Bồ Đào Nha)' },
  { code: 'it', name: 'Italiano (Tiếng Ý)' },
  { code: 'ru', name: 'Русский (Tiếng Nga)' },
  { code: 'ar', name: 'العربية (Tiếng Ả Rập)' },
  { code: 'hi', name: 'हिन्दी (Tiếng Hindi)' },
  { code: 'bn', name: 'বাংলা (Tiếng Bengali)' },
  { code: 'tr', name: 'Türkçe (Tiếng Thổ Nhĩ Kỳ)' },
  { code: 'nl', name: 'Nederlands (Tiếng Hà Lan)' },
  { code: 'pl', name: 'Polski (Tiếng Ba Lan)' },
  { code: 'sv', name: 'Svenska (Tiếng Thụy Điển)' },
  { code: 'no', name: 'Norsk (Tiếng Na Uy)' },
  { code: 'da', name: 'Dansk (Tiếng Đan Mạch)' },
  { code: 'fi', name: 'Suomi (Tiếng Phần Lan)' },
  { code: 'uk', name: 'Українська (Tiếng Ukraine)' },
  { code: 'cs', name: 'Čeština (Tiếng Séc)' },
  { code: 'ro', name: 'Română (Tiếng Romania)' },
  { code: 'hu', name: 'Magyar (Tiếng Hungary)' },
  { code: 'el', name: 'Ελληνικά (Tiếng Hy Lạp)' },
  { code: 'he', name: 'עברית (Tiếng Do Thái)' },
  { code: 'fa', name: 'فارسی (Tiếng Ba Tư)' },
  { code: 'sw', name: 'Kiswahili (Tiếng Swahili)' },
  { code: 'tl', name: 'Filipino (Tiếng Philippines)' },
  { code: 'ur', name: 'اردو (Tiếng Urdu)' },
  { code: 'ta', name: 'தமிழ் (Tiếng Tamil)' },
  { code: 'te', name: 'తెలుగు (Tiếng Telugu)' },
  { code: 'mr', name: 'मराठी (Tiếng Marathi)' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ (Tiếng Punjab)' },
  { code: 'my', name: 'မြန်မာ (Tiếng Myanmar)' },
  { code: 'km', name: 'ភាសាខ្មែរ (Tiếng Khmer)' },
  { code: 'lo', name: 'ພາສາລາວ (Tiếng Lào)' },
  { code: 'si', name: 'සිංහල (Tiếng Sinhala)' },
  { code: 'mn', name: 'Монгол (Tiếng Mông Cổ)' },
  { code: 'kk', name: 'Қазақша (Tiếng Kazakhstan)' },
  { code: 'az', name: 'Azərbaycanca (Tiếng Azerbaijan)' },
  { code: 'uz', name: "O'zbek (Tiếng Uzbekistan)" },
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Shqip (Tiếng Albania)' },
  { code: 'am', name: 'አማርኛ (Tiếng Amharic)' },
  { code: 'hy', name: 'Հայերեն (Tiếng Armenia)' },
  { code: 'ka', name: 'ქართული (Tiếng Georgia)' },
  { code: 'hr', name: 'Hrvatski (Tiếng Croatia)' },
  { code: 'sk', name: 'Slovenčina (Tiếng Slovak)' },
  { code: 'sl', name: 'Slovenščina (Tiếng Slovenia)' },
  { code: 'bg', name: 'Български (Tiếng Bulgaria)' },
  { code: 'sr', name: 'Српски (Tiếng Serbia)' },
  { code: 'lt', name: 'Lietuvių (Tiếng Lithuania)' },
  { code: 'lv', name: 'Latviešu (Tiếng Latvia)' },
  { code: 'et', name: 'Eesti (Tiếng Estonia)' },
];

async function smartTranslateSRT(srtContent, tLang, apiKeys, logFn, model = 'gemini-2.5-flash', mode = 'normal') {
  const langObj = SUBTITLE_LANGUAGES.find(l => l.code === tLang);
  const langName = langObj?.name || tLang;
  const countryMap = { vi:'Việt Nam', en:'Anh/Mỹ', zh:'Trung Quốc', ja:'Nhật Bản', ko:'Hàn Quốc', th:'Thái Lan', id:'Indonesia', ms:'Malaysia', fr:'Pháp', de:'Đức', es:'Tây Ban Nha', pt:'Bồ Đào Nha', it:'Ý', ru:'Nga', ar:'Ả Rập', hi:'Ấn Độ' };
  const country = countryMap[tLang] || langName;

  const callGemini = async (prompt, label) => {
    return retryWithKeyRotation(async (apiKey) => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); const e = new Error(err?.error?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }, apiKeys, { onSwitch: (idx) => logFn(`🔄 [${label}] Chuyển sang API key #${idx + 1}...`) });
  };

  const parseSRTEntries = (srt) => {
    return srt.trim().split(/\n\n+/).map(block => {
      const lines = block.trim().split('\n');
      const tlIdx = lines.findIndex(l => /^\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}/.test(l.trim()));
      if (tlIdx < 0) return null;
      return { timeLine: lines[tlIdx].trim(), text: lines.slice(tlIdx + 1).join('\n').trim() };
    }).filter(Boolean);
  };

  const extractTranslatedTexts = (raw, expectedCount) => {
    const cleaned = raw.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim();
    const entries = parseSRTEntries(cleaned);
    if (entries.length === expectedCount) return entries.map(e => e.text);
    const textLines = cleaned.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l));
    if (textLines.length >= expectedCount) return textLines.slice(0, expectedCount);
    return entries.map(e => e.text);
  };

  const srcEntries = parseSRTEntries(srtContent);
  if (!srcEntries.length) throw new Error('Không đọc được SRT gốc');

  logFn('🔍 [1/2] Đang phân tích ngữ cảnh & thuật ngữ chuyên môn...');
  let contextGuide = null;
  const sampleText = srcEntries.slice(0, 60).map(e => e.text).join('\n');
  const contextPrompt = `Phân tích nội dung video phụ đề dưới đây. Trả về JSON (chỉ JSON, không giải thích thêm):\n\n{\n  "domain": "lĩnh vực tổng quát",\n  "topic": "chủ đề cụ thể",\n  "tone": "phong cách",\n  "audience": "đối tượng khán giả",\n  "keyTerms": [{ "original": "...", "best_translation_${tLang}": "...", "avoid": "..." }],\n  "styleGuide": "3-5 quy tắc dịch quan trọng nhất cho ${country}"\n}\n\nNỘI DUNG PHỤ ĐỀ:\n${sampleText.substring(0, 4000)}`;
  try {
    const contextRaw = await callGemini(contextPrompt, 'Phân tích');
    const jsonMatch = contextRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      contextGuide = JSON.parse(jsonMatch[0]);
      logFn(`✅ Nhận diện: ${contextGuide.domain} — "${contextGuide.topic}" (${contextGuide.tone})`);
      if (contextGuide.keyTerms?.length) logFn(`📚 ${contextGuide.keyTerms.length} thuật ngữ chuyên biệt đã được chuẩn hóa`);
    }
  } catch (e) { logFn(`⚠️ Bỏ qua phân tích ngữ cảnh (${e.message.substring(0, 50)}), vẫn tiếp tục dịch...`); }

  let contextHeader = '';
  if (contextGuide) {
    const termLines = (contextGuide.keyTerms || []).slice(0, 10)
      .map(t => `"${t.original}"→"${t[`best_translation_${tLang}`] || t.best_translation || ''}"`)
      .join(', ');
    contextHeader = `[Ngữ cảnh: ${contextGuide.domain} · ${contextGuide.topic} · ${contextGuide.tone}]\n[Thuật ngữ: ${termLines}]\n[Phong cách: ${contextGuide.styleGuide}]\n\n`;
  }

  const CHUNK_SIZE = 30;
  const chunks = [];
  for (let i = 0; i < srcEntries.length; i += CHUNK_SIZE) chunks.push(srcEntries.slice(i, i + CHUNK_SIZE));
  const totalChunks = chunks.length;
  logFn(`🌐 [2/2] Dịch sang ${langName} — ${totalChunks} phần · ${srcEntries.length} dòng tổng...`);

  const translatedTexts = new Array(srcEntries.length).fill(null);

  for (let ci = 0; ci < totalChunks; ci++) {
    const chunk = chunks[ci];
    const startIdx = ci * CHUNK_SIZE;
    logFn(`  📄 Phần ${ci+1}/${totalChunks}: dòng ${startIdx+1}–${startIdx+chunk.length}...`);

    // Parse duration (giây) từ timeLine "HH:MM:SS,mmm --> HH:MM:SS,mmm"
    const parseDurSec = (timeLine) => {
      const m = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      if (!m) return 0;
      const toMs = (h,min,s,ms) => (+h*3600 + +min*60 + +s)*1000 + +ms;
      return (toMs(m[5],m[6],m[7],m[8]) - toMs(m[1],m[2],m[3],m[4])) / 1000;
    };

    const chunkSRT = chunk.map((e, i) => {
      if (mode === 'dubbing') {
        const durSec = parseDurSec(e.timeLine);
        const maxWords = Math.max(3, Math.round(durSec * 2.2)); // 2.2 từ/giây đọc tự nhiên
        return `${i+1}\n${e.timeLine} [${durSec.toFixed(1)}s≤${maxWords}từ]\n${e.text}`;
      }
      return `${i+1}\n${e.timeLine}\n${e.text}`;
    }).join('\n\n');

    const dubbingExtra = mode === 'dubbing'
      ? `\n⚠️ CHẾ ĐỘ LỒNG TIẾNG: Mỗi entry có nhãn [Xs≤Ntừ] = thời lượng và số từ tối đa.\n   Dịch CÔ ĐỌNG, súc tích — KHÔNG dịch dài hơn gốc, KHÔNG thêm giải thích.\n   Ưu tiên nghĩa chính, bỏ bớt thành phần phụ nếu cần để vừa thời lượng.\n`
      : '';
    const chunkPrompt = `${contextHeader}NHIỆM VỤ: Dịch ${chunk.length} entry phụ đề SRT sau sang ${langName} (${country}).\n${dubbingExtra}\nQUY TẮC BẮT BUỘC:\n1. GIỮ NGUYÊN định dạng SRT: số thứ tự 1–${chunk.length}, timestamps, dòng trống giữa entry\n2. CHỈ dịch phần text — KHÔNG chạm vào timestamps hay số thứ tự (bỏ nhãn [Xs≤Ntừ] khỏi output)\n3. Dịch tự nhiên như người ${country} nói — KHÔNG máy móc\n4. Kết thúc mỗi entry bằng dấu câu phù hợp\n5. Trả về ĐÚNG ${chunk.length} entry — không thêm/bớt, không giải thích\n\nSRT CẦN DỊCH:\n${chunkSRT}`;

    try {
      const raw = await callGemini(chunkPrompt, `Phần ${ci+1}`);
      const texts = extractTranslatedTexts(raw, chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        translatedTexts[startIdx + j] = texts[j] || chunk[j].text;
      }
      logFn(`  ✅ Phần ${ci+1}/${totalChunks}: ${texts.length}/${chunk.length} dòng dịch xong`);
    } catch (e) {
      logFn(`  ⚠️ Phần ${ci+1} lỗi (${e.message.slice(0,50)}) → giữ text gốc cho ${chunk.length} dòng`);
      for (let j = 0; j < chunk.length; j++) translatedTexts[startIdx + j] = chunk[j].text;
    }

    if (ci < totalChunks - 1) await new Promise(r => setTimeout(r, 300));
  }

  const finalSRT = srcEntries.map((e, i) =>
    `${i+1}\n${e.timeLine}\n${translatedTexts[i] ?? e.text}`
  ).join('\n\n') + '\n';

  return finalSRT;
}

const REVIEW_VOICES_EDGE = [
  'vi-VN-HoaiMyNeural','vi-VN-NamMinhNeural',
];
const REVIEW_VOICES_GEMINI = [
  { id:'Charon',    label:'Charon (Nam, chuẩn)'  },
  { id:'Fenrir',    label:'Fenrir (Nam, mạnh mẽ)'},
  { id:'Aoede',     label:'Aoede (Nữ, truyền cảm)'},
  { id:'Kore',      label:'Kore (Nữ, rõ ràng)'  },
  { id:'Puck',      label:'Puck (Nam, vui tươi)' },
];

function toFileUrl_rv(p) {
  if (!p) return '';
  return 'file:///' + p.replace(/\\/g, '/').split('/').map((seg, i) =>
    (i === 0 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg)
  ).join('/');
}

function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// Variation profiles cho Multi-Output: mỗi profile đảm bảo video ra khác nhau
// pitchShift, hFlip, varSpeedLevel, zoomPct khác nhau → audio+visual fingerprint khác nhau
const MULTI_PROFILES = [
  { pitchShift: 1,  hFlip: true, varSpeedLevel: 'medium', zoomPct: 5, colorShiftLevel: 'medium' },
  { pitchShift: 2,  hFlip: true, varSpeedLevel: 'strong', zoomPct: 4, colorShiftLevel: 'strong' },
  { pitchShift: -1, hFlip: true, varSpeedLevel: 'light',  zoomPct: 7, colorShiftLevel: 'medium' },
  { pitchShift: 3,  hFlip: true, varSpeedLevel: 'medium', zoomPct: 3, colorShiftLevel: 'light'  },
  { pitchShift: -2, hFlip: true, varSpeedLevel: 'strong', zoomPct: 6, colorShiftLevel: 'strong' },
  { pitchShift: 1,  hFlip: true, varSpeedLevel: 'light',  zoomPct: 8, colorShiftLevel: 'medium' },
  { pitchShift: 2,  hFlip: true, varSpeedLevel: 'medium', zoomPct: 4, colorShiftLevel: 'light'  },
  { pitchShift: -1, hFlip: true, varSpeedLevel: 'strong', zoomPct: 6, colorShiftLevel: 'strong' },
  { pitchShift: 3,  hFlip: true, varSpeedLevel: 'light',  zoomPct: 5, colorShiftLevel: 'medium' },
  { pitchShift: -2, hFlip: true, varSpeedLevel: 'medium', zoomPct: 7, colorShiftLevel: 'light'  },
];

// ── YouTube Channel Fetcher ───────────────────────────────────────────────────
// ── helpers lưu lịch sử kênh + video đã làm ─────────────────────────────────
const YT_HISTORY_KEY   = 'fluxy_yt_channel_history';   // string[] — URL kênh đã nhập
const YT_DONE_KEY      = 'fluxy_yt_done_videos';        // Record<videoId, {title,doneAt}>

const loadChannelHistory = () => { try { return JSON.parse(localStorage.getItem(YT_HISTORY_KEY) || '[]'); } catch { return []; } };
const loadDoneVideos     = () => { try { return JSON.parse(localStorage.getItem(YT_DONE_KEY)    || '{}'); } catch { return {}; } };

const saveChannelToHistory = (url) => {
  const list = loadChannelHistory().filter(u => u !== url);
  list.unshift(url);
  localStorage.setItem(YT_HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
};
const markVideoDone = (id, title) => {
  const done = loadDoneVideos();
  done[id] = { title, doneAt: new Date().toISOString() };
  localStorage.setItem(YT_DONE_KEY, JSON.stringify(done));
};

// ─── Process Monitor — visual animated display khi đang chạy batch ───────────
function BatchLogDisplay({ logs, accentColor = 'blue', logEndRef, batchRunning, batchProgress }) {
  const isPink = accentColor === 'pink';

  // Trích xuất thông số kỹ thuật từ log gần nhất
  const recent = (logs || []).slice(-40);
  const findLast = (re) => { for (let i = recent.length - 1; i >= 0; i--) { const m = recent[i].msg.match(re); if (m) return m; } return null; };
  const timeVal    = findLast(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/)?.[1];
  const resolution = findLast(/\((\d{3,4}x\d{3,4})\)/)?.[1];
  const fpsVal     = findLast(/(\d+\.\d+)\s*fps.*gốc/)?.[1];
  const passVal    = findLast(/Pass (\d+\/\d+)/)?.[1];
  const encoderVal = findLast(/(AMD AMF|NVENC|QuickSync|CPU encode)/i)?.[1];
  const diskVal    = findLast(/còn ([\d.]+\s*GB)/)?.[1];
  const crfVal     = findLast(/CRF[^:]*:\s*(\d+)/)?.[1];

  const STEP_INFO = {
    download:  { icon: '⬇', label: 'Đang tải video về máy',      grad: 'from-blue-950 to-slate-950',    ring: 'ring-blue-500',    dot: 'bg-blue-500',    spin: false },
    process:   { icon: '⚙', label: 'Đang encode & xử lý video',  grad: 'from-violet-950 to-slate-950',  ring: 'ring-violet-500',  dot: 'bg-violet-500',  spin: true  },
    seo:       { icon: '✍', label: 'Đang viết nội dung SEO',      grad: 'from-emerald-950 to-slate-950', ring: 'ring-emerald-500', dot: 'bg-emerald-400', spin: false },
    thumbnail: { icon: '🖼', label: 'Đang tạo thumbnail AI',       grad: 'from-orange-950 to-slate-950',  ring: 'ring-orange-500',  dot: 'bg-orange-400',  spin: false },
  };
  const stepBase = STEP_INFO[batchProgress?.step] || STEP_INFO.process;
  const step = batchProgress?.stepLabel
    ? { ...stepBase, label: batchProgress.stepLabel }
    : stepBase;

  const metrics = [
    { label: 'Độ phân giải', value: resolution },
    { label: 'FPS gốc',      value: fpsVal ? `${fpsVal} fps` : null },
    { label: 'Encoder',      value: encoderVal },
    { label: 'Pass',         value: passVal },
    { label: 'CRF',          value: crfVal },
    { label: 'Ổ đĩa còn',   value: diskVal },
  ].filter(m => m.value);

  // Chỉ lấy events quan trọng (success/error/warn + video headers + chunk dịch)
  const events = (logs || []).filter(l =>
    l.type === 'success' || l.type === 'error' || l.type === 'warn' ||
    l.msg.startsWith('\n📥') || l.msg.startsWith('🚀 ') ||
    /📄\s*Phần\s*\d/.test(l.msg) || /Chunk\s*\d/.test(l.msg)
  ).slice(-7);

  const cleanMsg = (m) => m.replace(/^\n/, '').replace(/^[✅❌⚠️🚀📥]\s*/, '').replace(/^\[\d+\/\d+\]\s*/, '').trim();

  if (batchRunning) {
    return (
      <div className="space-y-3 font-sans select-none">
        <style>{`
          @keyframes fluxy-scan { 0%{transform:translateY(-100%)} 100%{transform:translateY(3000%)} }
          @keyframes fluxy-ping { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
          @keyframes fluxy-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        `}</style>

        {/* ── Card chính: step hiện tại ── */}
        <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${step.grad} border border-white/5`}>
          {/* Scan line effect */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-white/8 to-transparent"
              style={{ animation: 'fluxy-scan 4s linear infinite' }}/>
          </div>

          <div className="relative p-4">
            {/* Header: icon + label */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative shrink-0">
                <div className={`absolute inset-0 rounded-full ${step.dot} blur-sm opacity-40`}
                  style={{ animation: 'fluxy-ping 2.5s ease-in-out infinite' }}/>
                <div className={`relative w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-xl ring-2 ${step.ring} ring-offset-1 ring-offset-black/30`}>
                  <span style={step.spin ? { display: 'inline-block', animation: 'fluxy-spin 2s linear infinite' } : {}}>
                    {step.icon}
                  </span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] text-white/30 uppercase tracking-widest mb-0.5">Đang thực hiện</div>
                <div className="text-[13px] text-white font-bold">{step.label}</div>
              </div>
            </div>

            {/* Metrics chips */}
            {metrics.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {metrics.map(m => (
                  <div key={m.label} className="bg-black/40 rounded-lg px-2.5 py-1.5 min-w-0">
                    <div className="text-[8px] text-white/25 uppercase tracking-wide mb-0.5 truncate">{m.label}</div>
                    <div className="text-[11px] text-white font-bold tabular-nums truncate">{m.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Encode timer */}
            {timeVal && (
              <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-2">
                <span className="text-[9px] text-white/25 uppercase tracking-wider shrink-0">Encode</span>
                <div className="flex-1 h-px bg-white/8"/>
                <span className="text-[15px] text-white font-mono font-black tracking-widest tabular-nums">{timeVal}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"/>
              </div>
            )}
          </div>
        </div>

        {/* ── Events gần đây ── */}
        {events.length > 0 && (
          <div>
            <div className="text-[8px] text-slate-600 uppercase tracking-widest px-1 mb-1.5">Sự kiện</div>
            <div className="space-y-px">
              {events.map((l, i) => {
                const isHeader = l.msg.startsWith('\n📥') || l.msg.startsWith('🚀 ');
                if (isHeader) return (
                  <div key={i} className="text-[10px] text-slate-500 px-1 py-0.5 font-medium truncate">
                    ▸ {cleanMsg(l.msg)}
                  </div>
                );
                const ok = l.type === 'success', err = l.type === 'error', warn = l.type === 'warn';
                return (
                  <div key={i} className="flex items-start gap-2 px-1 py-[2px]">
                    <span className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${ok?'bg-emerald-500':err?'bg-red-500':warn?'bg-amber-400':'bg-slate-600'}`}/>
                    <span className={`text-[10px] leading-[1.5] flex-1 min-w-0 ${ok?'text-emerald-400':err?'text-red-400':warn?'text-amber-300':'text-slate-500'}`}>
                      {cleanMsg(l.msg)}
                    </span>
                    <span className="text-[9px] text-slate-700 font-mono shrink-0 tabular-nums ml-1 mt-px">{l.t}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div ref={logEndRef}/>
      </div>
    );
  }

  // ── Không chạy: timeline compact ──
  if (!logs || logs.length === 0) return null;
  const groups = [];
  let cur = null;
  for (const l of logs) {
    if (l.msg.startsWith('\n📥') || l.msg.startsWith('🚀')) {
      cur = { header: l.msg.replace(/^\n/, ''), entries: [], isVideo: l.msg.startsWith('\n📥') };
      groups.push(cur);
    } else {
      if (!cur) { cur = { header: null, entries: [], isVideo: false }; groups.push(cur); }
      cur.entries.push(l);
    }
  }
  const ac = isPink
    ? { bg: 'bg-pink-950/40 border-pink-800/50', num: 'text-pink-400', sep: 'bg-pink-700/40' }
    : { bg: 'bg-blue-950/40 border-blue-800/50', num: 'text-blue-400', sep: 'bg-blue-700/40' };

  return (
    <div className="space-y-3 font-sans">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.header && g.isVideo && (
            <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border mb-2 ${ac.bg}`}>
              <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 tabular-nums ${ac.num}`}>
                {g.header.match(/\[(\d+\/\d+)\]/)?.[1] ?? '—'}
              </span>
              <div className={`w-px h-3 shrink-0 ${ac.sep}`}/>
              <span className="text-[11px] font-semibold truncate text-white/70">
                {g.header.replace(/^📥 \[\d+\/\d+\] Tải: /, '')}
              </span>
            </div>
          )}
          <div>
            {g.entries.filter(l => l.type !== 'info' || /Pass \d/.test(l.msg)).map((l, li) => {
              const ok = l.type === 'success', err = l.type === 'error', warn = l.type === 'warn';
              if (/time=\d/.test(l.msg)) return null;
              const clean = l.msg.replace(/^[✅❌⚠️📥⚙️🔍🖼️🖌️📄⛔▶️⏸️⏳🌟🎬💾🔧🏁🎉]\s*/, '').trim();
              return (
                <div key={li} className="group flex items-start gap-2 px-1 py-[3px] rounded-md hover:bg-white/[0.03] transition-colors">
                  <span className={`mt-[6px] w-[5px] h-[5px] rounded-full shrink-0 ${ok?'bg-emerald-500':err?'bg-red-500':warn?'bg-amber-400':'bg-slate-600'}`}/>
                  <span className={`flex-1 text-[11px] leading-[1.6] break-words ${ok?'text-emerald-300':err?'text-red-400':warn?'text-amber-300':'text-slate-500'}`}>
                    {clean || l.msg.trim()}
                  </span>
                  <span className="text-[9px] text-slate-700 font-mono mt-[5px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">{l.t}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div ref={logEndRef}/>
    </div>
  );
}

function YoutubeChannelFetcher({ onVideoReady, onStartBatch, onStopBatch, pausedQueue, onClearPause, seoLang, onSeoLangChange,
  batchRunning, batchLogs, batchProgress,
  multiCount, setMultiCount, trimStart, setTrimStart, trimEnd, setTrimEnd,
  targetDurEnabled, setTargetDurEnabled, targetDurMinutes, setTargetDurMinutes,
  outputResolution, setOutputResolution,
  downloadQuality, setDownloadQuality,
  rfTargetLang, rfTargetCode, setRfTargetLang, setRfTargetCode,
  rfVieNeuVoice, rfVieNeuVoices, setRfVieNeuVoice,
  rfEdgeVoice, rfEdgeVoices, setRfEdgeVoice,
  rfTtsEngine, setRfTtsEngine,
  rfGeminiVoice, setRfGeminiVoice,
  rfBurnSub, setRfBurnSub,
  rfVideoVol, setRfVideoVol,
  rfVoiceVol, setRfVoiceVol,
  rfSeparateVocals, setRfSeparateVocals,
  rfMultiCount, setRfMultiCount,
  // Recreate settings
  varSpeed, setVarSpeed, varSpeedLevel, setVarSpeedLevel,
  pitchShift, setPitchShift,
  hFlip, setHFlip,
  colorShift, setColorShift, colorShiftLevel, setColorShiftLevel,
  zoomPct, setZoomPct,
  grainNoise, setGrainNoise, grainLevel, setGrainLevel,
  stereoFlip, setStereoFlip,
  bgNoise, setBgNoise, bgNoiseLevel, setBgNoiseLevel,
  kenBurns, setKenBurns,
  randomCut, setRandomCut,
  wmEnabled, setWmEnabled, wmText, setWmText,
  gpuMode, setGpuMode,
  audioVolume, setAudioVolume,
  slightRotate, setSlightRotate,
  hueRotate, setHueRotate,
  randomFps, setRandomFps,
  randomPosCrop, setRandomPosCrop,
  audioEQ, setAudioEQ,
}) {

  const [channelUrl,    setChannelUrl]    = useState('');
  const [showHistory,   setShowHistory]   = useState(false);
  const [channelHistory]                  = useState(loadChannelHistory);
  const [doneVideos,    setDoneVideos]    = useState(loadDoneVideos);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [limit,         setLimit]         = useState(30);
  const [skipShorts,    setSkipShorts]    = useState(true);
  const [minViews,      setMinViews]      = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [videos,        setVideos]        = useState([]);
  const [queue,         setQueue]         = useState([]); // [{id,url,title,thumbnail,duration,views}]
  const [outFolder,     setOutFolder]     = useState(() => localStorage.getItem('fluxy_cleaner_folder') || '');
  const [fetchedChannelName, setFetchedChannelName] = useState('');
  const [ytBatchPipeMode, setYtBatchPipeMode] = useState('normal');
  const [view,          setView]          = useState('search'); // 'search' | 'queue' | 'logs'
  const logEndRef = useRef(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [batchLogs]);

// Khi chọn Review mode + ngôn ngữ khác vi → load Edge voices nếu chưa có
  useEffect(() => {
    if (ytBatchPipeMode !== 'review' || rfTargetCode === 'vi') return;
    if (!rfEdgeVoices?.length) {
      window.electronAPI.getVoices?.().then(voices => {
        if (voices?.length) {
          const match = voices.find(v => (v.Locale||v.ShortName||'').toLowerCase().startsWith(rfTargetCode+'-'));
          if (match && setRfEdgeVoice) setRfEdgeVoice(match.ShortName);
        }
      }).catch(() => {});
    }
  }, [ytBatchPipeMode, rfTargetCode]);

  const fmtDur  = s => { if (!s) return '--:--'; if (s >= 3600) return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };
  const fmtViews = n => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : (n || '?');
  const fmtDate  = d => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';

  const fetchVideos = async () => {
    const url = channelUrl.trim();
    if (!url) return;
    saveChannelToHistory(url);
    setShowHistory(false);
    setLoading(true); setError(''); setVideos([]);
    const res = await window.electronAPI?.ytChannelVideos?.({ channelUrl: url, limit });
    setLoading(false);
    if (!res?.success) { setError(res?.error || 'Lỗi lấy danh sách video'); return; }
    if (res.channelName) setFetchedChannelName(res.channelName);
    let vids = res.videos;
    if (skipShorts) vids = vids.filter(v => v.duration >= 60);
    if (minViews > 0) vids = vids.filter(v => v.views >= minViews * 1000);
    setVideos(vids);
  };

  const visibleVideos = hideCompleted ? videos.filter(v => !doneVideos[v.id]) : videos;
  const doneCount_total = videos.filter(v => doneVideos[v.id]).length;
  const inQueue = id => queue.some(q => q.id === id);
  const addToQueue = v => { if (!inQueue(v.id)) setQueue(prev => [...prev, v]); };
  const addAllToQueue = () => { const newVids = visibleVideos.filter(v => !inQueue(v.id)); setQueue(prev => [...prev, ...newVids]); };
  const removeFromQueue = id => setQueue(prev => prev.filter(q => q.id !== id));
  const clearQueue = () => setQueue([]);

  const pickFolder = async () => {
    const f = await window.electronAPI?.selectFolder?.();
    if (f) { setOutFolder(f); localStorage.setItem('fluxy_cleaner_folder', f); }
  };

  const clearDoneHistory = () => {
    if (!confirm('Xóa toàn bộ lịch sử video đã làm?')) return;
    localStorage.removeItem(YT_DONE_KEY); setDoneVideos({});
  };

  const handleStart = () => {
    if (!queue.length) { alert('Thêm ít nhất 1 video vào hàng đợi!'); return; }
    if (!outFolder) { alert('Chọn thư mục lưu trước!'); return; }
    onStartBatch(queue, ytBatchPipeMode, outFolder);
  };

  // Video card (search results)
  const YtVideoCard = ({ v }) => {
    const isDone = !!doneVideos[v.id];
    const added  = inQueue(v.id);
    const toggle = () => added ? removeFromQueue(v.id) : addToQueue(v);
    return (
      <div onClick={toggle} title={added ? 'Bỏ chọn' : 'Thêm vào hàng đợi'}
        className={`flex gap-2 p-2 rounded-lg border transition-all cursor-pointer select-none
          ${added
            ? 'border-emerald-600/60 bg-emerald-900/20 hover:bg-red-900/20 hover:border-red-600/40'
            : isDone
              ? 'border-orange-700/30 bg-orange-900/10 opacity-70 hover:bg-orange-900/20'
              : 'border-slate-700/30 bg-[#0d1221] hover:bg-blue-900/20 hover:border-blue-700/40'}`}>
        <div className="w-24 h-14 rounded overflow-hidden shrink-0 bg-slate-800 relative">
          {v.thumbnail && <img src={v.thumbnail} alt="" className="w-full h-full object-cover"/>}
          <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-[9px] text-white px-1 rounded font-mono">{fmtDur(v.duration)}</span>
          {isDone && <div className="absolute inset-0 bg-orange-900/50 flex items-center justify-center text-orange-300 text-sm font-bold">✓</div>}
          {added && <div className="absolute inset-0 bg-emerald-900/40 flex items-center justify-center text-emerald-300 text-lg font-bold">✓</div>}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className={`text-[11px] leading-4 line-clamp-2 ${added ? 'text-emerald-200' : 'text-white'}`}>{v.title}</div>
          <div className="flex items-center gap-2 mt-1">
            {v.views > 0 && <span className="text-[10px] text-slate-500">👁 {fmtViews(v.views)}</span>}
            {v.uploadDate && <span className="text-[10px] text-slate-600">{fmtDate(v.uploadDate)}</span>}
            {isDone && <span className="text-[9px] text-orange-400">✓ Đã làm</span>}
          </div>
        </div>
        <div className={`shrink-0 self-center w-6 h-6 rounded flex items-center justify-center text-[11px] font-black border transition-all
          ${added ? 'bg-emerald-700/40 text-emerald-400 border-emerald-600/60' : 'bg-blue-700/30 text-blue-300 border-blue-700/40'}`}>
          {added ? '✓' : '＋'}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* LEFT PANEL */}
      <div className="w-[380px] flex-shrink-0 flex flex-col bg-[#0b0f1a] border-r border-slate-700/50">
        {/* Header + sub-nav */}
        <div className="px-3 pt-3 pb-2 border-b border-slate-700/50 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[16px]">📺</span>
            <span className="text-[13px] font-black text-white uppercase tracking-wide">Reup YouTube</span>
            {queue.length > 0 && (
              <span className="ml-auto bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{queue.length}</span>
            )}
          </div>
          <div className="flex gap-1.5">
            {[['search','🔍 Tìm kênh'],['queue',`📋 Hàng đợi (${queue.length})`],['settings','⚙️ Cài đặt']].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`flex-1 py-1 rounded text-[11px] font-black transition-all ${view === id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* VIEW: SEARCH */}
        {view === 'search' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 pt-2 pb-2 shrink-0 flex flex-col gap-2">
              {/* URL input */}
              <div className="relative flex gap-2">
                <div className="flex-1 relative">
                  <input
                    value={channelUrl}
                    onChange={e => { setChannelUrl(e.target.value); setShowHistory(true); }}
                    onFocus={() => setShowHistory(true)}
                    onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                    onKeyDown={e => e.key === 'Enter' && fetchVideos()}
                    placeholder="URL kênh YouTube (/@username, /channel/...)"
                    className="w-full px-3 py-2 bg-[#131929] border border-slate-600/60 rounded-lg text-[12px] text-white placeholder-slate-600 outline-none focus:border-blue-500/60"
                  />
                  {showHistory && channelHistory.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                      <div className="px-3 py-1.5 text-[10px] text-slate-500 border-b border-slate-700/60">Gần đây</div>
                      {channelHistory.map(u => (
                        <button key={u} onMouseDown={() => { setChannelUrl(u); setShowHistory(false); }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 truncate">
                          📺 {u}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={fetchVideos} disabled={loading || !channelUrl.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-[12px] font-black text-white transition-colors">
                  {loading ? '...' : '🔍'}
                </button>
              </div>
              {/* Filters */}
              <div className="flex items-center gap-3 flex-wrap text-[11px]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={skipShorts} onChange={e => setSkipShorts(e.target.checked)} className="w-3 h-3 accent-blue-500"/>
                  <span className="text-slate-400">Bỏ Shorts</span>
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500">View tối thiểu:</span>
                  <input type="number" value={minViews} onChange={e => setMinViews(Number(e.target.value))} min="0"
                    className="w-14 px-1.5 py-0.5 bg-[#131929] border border-slate-600/60 rounded text-[11px] text-white outline-none"/>
                  <span className="text-slate-500">K</span>
                </div>
                <select value={limit} onChange={e => setLimit(Number(e.target.value))}
                  className="px-1.5 py-0.5 bg-[#131929] border border-slate-600/60 rounded text-[11px] text-slate-300 outline-none">
                  {[20,30,50,100].map(n => <option key={n} value={n}>{n} video</option>)}
                </select>
              </div>
              {error && <div className="text-[11px] text-red-400">{error}</div>}
              {fetchedChannelName && (
                <div className="text-[11px] text-blue-300 font-bold truncate">📺 {fetchedChannelName}</div>
              )}
              {videos.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">{visibleVideos.length}/{videos.length} video{doneCount_total > 0 && ` · ${doneCount_total} đã làm`}</span>
                  {doneCount_total > 0 && (
                    <label className="flex items-center gap-1 cursor-pointer ml-auto">
                      <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} className="w-3 h-3 accent-orange-500"/>
                      <span className="text-[10px] text-orange-400">Ẩn đã làm</span>
                    </label>
                  )}
                  <button onClick={addAllToQueue}
                    className="ml-auto px-2.5 py-1 bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white text-[10px] font-black rounded border border-blue-700/40 transition-colors">
                    ＋ Tất cả
                  </button>
                  {doneCount_total > 0 && (
                    <button onClick={clearDoneHistory} className="text-[10px] text-slate-600 hover:text-red-400">Xóa lịch sử</button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 flex flex-col gap-2">
              {loading && <div className="text-center text-slate-400 text-[12px] mt-8">⏳ Đang lấy video từ kênh...</div>}
              {!loading && videos.length === 0 && !error && (
                <div className="text-center text-slate-500 text-[11px] mt-8">
                  <div className="text-3xl mb-2">📺</div>
                  Nhập URL kênh YouTube và bấm 🔍<br/>
                  <span className="text-slate-600 text-[10px]">/@username · /channel/UCxxx · /c/name · /user/name</span>
                </div>
              )}
              {visibleVideos.map(v => <YtVideoCard key={v.id} v={v} />)}
            </div>
          </div>
        )}

        {/* VIEW: QUEUE */}
        {view === 'queue' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between shrink-0">
              <span className="text-[11px] font-semibold text-slate-300 uppercase">{queue.length} video trong hàng đợi</span>
              {queue.length > 0 && <button onClick={clearQueue} className="text-[10px] text-red-400 hover:text-red-300">Xóa tất cả</button>}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-2 flex flex-col gap-2">
              {queue.length === 0 && <div className="text-slate-500 text-[11px] text-center mt-8">Tìm và thêm video vào hàng đợi</div>}
              {queue.map((v, i) => (
                <div key={v.id} className="flex items-center gap-2 bg-[#131929] rounded-lg px-2 py-1.5 border border-slate-700/30">
                  <span className="text-[10px] text-blue-400 font-mono w-5">{i+1}.</span>
                  {v.thumbnail && <img src={v.thumbnail} alt="" className="w-12 h-8 object-cover rounded"/>}
                  <span className="flex-1 text-[10px] text-slate-200 line-clamp-2">{v.title}</span>
                  <button onClick={() => removeFromQueue(v.id)} className="text-[11px] text-red-400 hover:text-red-300 shrink-0">✕</button>
                </div>
              ))}
            </div>
            {/* Quick info: mode đang chọn */}
            <div className="border-t border-slate-700/50 px-3 py-2 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                Chế độ: <span className="text-blue-400 font-bold">{ytBatchPipeMode === 'review' ? '🎬 Review' : '🔄 Tái Tạo'}</span>
              </span>
              <button onClick={() => setView('settings')} className="text-[10px] text-slate-400 hover:text-white underline">Cài đặt ›</button>
            </div>
          </div>
        )}

        {/* VIEW: SETTINGS */}
        {view === 'settings' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col min-h-0">
            <div className="px-3 py-2 flex flex-col gap-2">
            <div className="text-[11px] font-black text-slate-300 uppercase tracking-wide mb-1">⚙️ Cài đặt Pipeline</div>
            <div className="border-t border-slate-700/50 flex flex-col gap-2 pt-2 -mx-3 px-3">
              {/* Mode */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Chế độ reup</div>
                <div className="flex gap-1.5">
                  {[
                    ['normal', '🔄 Tái Tạo', 'Tái tạo video né ContentID'],
                    ['review', '🎬 Review',  'Lồng tiếng tự động (Review phim)'],
                  ].map(([id, label, desc]) => (
                    <button key={id} onClick={() => setYtBatchPipeMode(id)} title={desc}
                      className={`flex-1 py-1.5 rounded text-[10px] font-black transition-all ${ytBatchPipeMode === id ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700/40'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 italic">
                  {ytBatchPipeMode === 'normal' && '↳ Tái tạo video: đổi hash, màu sắc, tốc độ, logo... né ContentID'}
                  {ytBatchPipeMode === 'review' && '↳ Tự động lồng tiếng AI (giọng đọc review phim, thuyết minh)'}
                </div>
              </div>
              {/* Review: cấu hình TTS lồng tiếng */}
              {ytBatchPipeMode === 'review' && (
                <div className="bg-purple-950/30 border border-purple-700/40 rounded-lg p-2 space-y-2">
                  <div className="text-[10px] text-purple-300 font-black uppercase tracking-wide mb-1">🎙️ Lồng tiếng AI</div>
                  {/* Ngôn ngữ lồng tiếng */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Ngôn ngữ lồng tiếng</div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        ['vi','🇻🇳 Tiếng Việt'],['en','🇺🇸 Tiếng Anh'],
                        ['zh','🇨🇳 Tiếng Trung'],['ja','🇯🇵 Tiếng Nhật'],
                        ['ko','🇰🇷 Tiếng Hàn'],['th','🇹🇭 Tiếng Thái'],['id','🇮🇩 Tiếng Indo'],
                      ].map(([code, label]) => (
                        <button key={code} onClick={() => {
                          setRfTargetCode?.(code);
                          const map = { vi:'Vietnamese',en:'English',zh:'Chinese',ja:'Japanese',ko:'Korean',th:'Thai',id:'Indonesian' };
                          setRfTargetLang?.(map[code] || 'English');
                        }}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${rfTargetCode === code ? 'bg-purple-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* TTS Engine picker */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">Engine TTS</div>
                    <div className="flex gap-1 flex-wrap">
                      {[['auto','🤖 Tự động'],['vieneu','🇻🇳 VieNeu'],['edge','⚡ Edge'],['gemini','✨ Gemini']].map(([v,l]) => (
                        <button key={v} onClick={() => setRfTtsEngine?.(v)}
                          className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${rfTtsEngine === v ? 'bg-purple-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Voice picker theo engine */}
                  {(rfTtsEngine === 'auto' ? (rfTargetCode === 'vi' ? 'vieneu' : 'edge') : rfTtsEngine) === 'vieneu' && (
                    rfVieNeuVoices?.length > 0 ? (
                      <div>
                        <div className="text-[10px] text-slate-400 mb-1">Giọng VieNeu</div>
                        <select value={rfVieNeuVoice} onChange={e => setRfVieNeuVoice?.(e.target.value)}
                          className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-white outline-none">
                          {rfVieNeuVoices.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-400">⚠️ Chưa cài VieNeu TTS — vào Voice Studio để cài</div>
                    )
                  )}
                  {(rfTtsEngine === 'auto' ? (rfTargetCode === 'vi' ? 'vieneu' : 'edge') : rfTtsEngine) === 'edge' && (
                    rfEdgeVoices?.length > 0 ? (
                      <div>
                        <div className="text-[10px] text-slate-400 mb-1">Giọng Edge TTS</div>
                        <select value={rfEdgeVoice} onChange={e => setRfEdgeVoice?.(e.target.value)}
                          className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-white outline-none">
                          {rfEdgeVoices.filter(v => (v.Locale||v.ShortName||'').toLowerCase().startsWith(rfTargetCode+'-')).map(v => (
                            <option key={v.ShortName} value={v.ShortName}>{v.FriendlyName || v.ShortName}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 italic">Đang tải danh sách giọng...</div>
                    )
                  )}
                  {rfTtsEngine === 'gemini' && (
                    <div>
                      <div className="text-[10px] text-slate-400 mb-1">Giọng Gemini TTS</div>
                      <select value={rfGeminiVoice} onChange={e => setRfGeminiVoice?.(e.target.value)}
                        className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-white outline-none">
                        {['Aoede','Charon','Fenrir','Kore','Leda','Orus','Puck','Schedar','Zephyr',
                          'Autonoe','Callirrhoe','Despina','Erinome','Gacrux','Iocaste','Laomedeia',
                          'Alsephina','Umbriel','Sulafat','Vindemiatrix'].map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Burn subtitle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button onClick={() => setRfBurnSub?.(v => !v)}
                      className={`w-8 h-4 rounded-full relative transition-all ${rfBurnSub ? 'bg-purple-600' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${rfBurnSub ? 'left-4' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">Burn phụ đề vào video</span>
                  </label>
                  {/* Tách vocals — giữ nhạc nền */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button onClick={() => setRfSeparateVocals?.(v => !v)}
                      className={`w-8 h-4 rounded-full relative transition-all ${rfSeparateVocals ? 'bg-emerald-600' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${rfSeparateVocals ? 'left-4' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">🎵 Tách vocals — giữ nhạc nền gốc</span>
                  </label>
                  {rfSeparateVocals && (
                    <div className="text-[9px] text-emerald-400/80 bg-emerald-950/30 rounded px-2 py-1">
                      Dùng Demucs tách giọng nói ra khỏi nhạc nền → chèn TTS + giữ nhạc nền. Lần đầu tải model ~400MB.
                    </div>
                  )}
                  {/* Âm lượng audio gốc */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">
                      {rfSeparateVocals ? '🎵 Âm lượng nhạc nền' : '🎞 Âm lượng video gốc'}
                    </div>
                    <div className="flex gap-1 mb-1">
                      {[[0,'Tắt'],[50,'50%'],[100,'100%']].map(([v,l]) => (
                        <button key={v} onClick={() => setRfVideoVol?.(v)}
                          className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${rfVideoVol === v ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                      ))}
                    </div>
                    <input type="range" min={0} max={100} step={5} value={rfVideoVol ?? 50}
                      onChange={e => setRfVideoVol?.(+e.target.value)}
                      className="w-full accent-purple-500"/>
                    <div className="text-[9px] text-slate-500 mt-0.5">{rfVideoVol === 0 ? 'Tắt tiếng gốc hoàn toàn' : `Giữ ${rfVideoVol}% âm lượng gốc bên dưới giọng đọc`}</div>
                  </div>
                  {/* Âm lượng TTS */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">🎙 Âm lượng lồng tiếng: <span className="text-purple-400 font-bold">{rfVoiceVol ?? 120}%</span></div>
                    <input type="range" min={80} max={150} step={5} value={rfVoiceVol ?? 120}
                      onChange={e => setRfVoiceVol?.(+e.target.value)}
                      className="w-full accent-purple-500"/>
                  </div>
                  {/* Multi bản */}
                  <div className="border-t border-purple-700/30 pt-2">
                    <div className="text-[10px] text-orange-300 font-black mb-1">📦 Số bản xuất</div>
                    <div className="flex items-center gap-2">
                      <input type="range" min={1} max={5} value={rfMultiCount}
                        onChange={e => setRfMultiCount(+e.target.value)}
                        className="flex-1 accent-orange-500"/>
                      <span className="text-[12px] text-orange-400 font-black w-6 text-center">{rfMultiCount}</span>
                    </div>
                    {rfMultiCount > 1 && (
                      <div className="text-[9px] text-orange-400/70 mt-0.5">
                        Transcribe + TTS chạy 1 lần — mỗi bản recreate video với grain/hue/zoom khác nhau
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Trim — hiện cho tất cả modes */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">✂ Cắt đầu (giây)</div>
                  <input type="number" value={trimStart ?? 0} min={0} max={300}
                    onChange={e => setTrimStart?.(Math.max(0, Math.min(300, +e.target.value)))}
                    className="w-full text-center bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/60"/>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">✂ Cắt đuôi (giây)</div>
                  <input type="number" value={trimEnd ?? 0} min={0} max={300}
                    onChange={e => setTrimEnd?.(Math.max(0, Math.min(300, +e.target.value)))}
                    className="w-full text-center bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500/60"/>
                </div>
              </div>
              {/* Download quality */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1">📥 Chất lượng tải về</div>
                <div className="flex gap-1.5 flex-wrap">
                  {[['best','Tốt nhất'],['2160','4K'],['1080','1080p'],['720','720p'],['480','480p']].map(([val, label]) => (
                    <button key={val} onClick={() => setDownloadQuality?.(val)}
                      className={`px-2.5 py-0.5 rounded text-[10px] font-semibold transition-all ${downloadQuality === val ? 'bg-emerald-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Target Duration */}
              {setTargetDurEnabled && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-1">
                    <button onClick={() => setTargetDurEnabled(v => !v)}
                      className={`w-9 h-5 rounded-full relative transition-all ${targetDurEnabled ? 'bg-orange-600' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${targetDurEnabled ? 'left-4' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">⏱ Căn thời lượng mục tiêu</span>
                  </label>
                  {targetDurEnabled && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {[{r:'<3p',v:2,c:'text-pink-400'},{r:'8-20p',v:15,c:'text-green-400'},{r:'20-35p',v:25,c:'text-blue-400'},{r:'>60p',v:70,c:'text-yellow-400'}].map(({r,v,c}) => (
                        <button key={v} onClick={() => setTargetDurMinutes(v)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${targetDurMinutes === v ? 'bg-orange-600/30 ring-1 ring-orange-500' : 'bg-slate-800 hover:bg-slate-700'}`}>
                          <span className={c}>{r}</span>
                        </button>
                      ))}
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" max="180" value={targetDurMinutes}
                          onChange={e => setTargetDurMinutes(Math.max(1, Math.min(180, parseInt(e.target.value)||1)))}
                          className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-orange-300 text-center outline-none"/>
                        <span className="text-[10px] text-slate-500">phút</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* ── RECREATE SETTINGS ── */}
              <div className="border-t border-slate-700/40 pt-2">
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-wide mb-2">🎛️ Hiệu ứng tái tạo video</div>

                {ytBatchPipeMode === 'review' && (
                  <div className="text-[9px] text-amber-400/80 mb-1.5">⚠ Lật ngang tự động tắt trong Review phim (tránh lộn phụ đề)</div>
                )}
                {/* Toggle row */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-2">
                  {[
                    ['Lật ngang', ytBatchPipeMode === 'review' ? false : hFlip, ytBatchPipeMode === 'review' ? null : setHFlip],
                    ['Thay tốc độ', varSpeed, setVarSpeed],
                    ['Đổi màu sắc', colorShift, setColorShift],
                    ['Hạt nhiễu', grainNoise, setGrainNoise],
                    ['Lật stereo', stereoFlip, setStereoFlip],
                    ['Tiếng nền', bgNoise, setBgNoise],
                    ['Cắt ngẫu nhiên', randomCut, setRandomCut],
                    ['FPS ngẫu nhiên', randomFps, setRandomFps],
                    ['Xoay nhẹ', slightRotate, setSlightRotate],
                    ['Hue rotate', hueRotate, setHueRotate],
                    ['Crop vị trí', randomPosCrop, setRandomPosCrop],
                    ['Equalizer', audioEQ, setAudioEQ],
                  ].map(([label, val, setter]) => (
                    <label key={label} className={`flex items-center gap-1.5 select-none ${setter ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                      <button onClick={() => setter?.(v => !v)} disabled={!setter}
                        className={`w-7 h-3.5 rounded-full relative transition-all shrink-0 ${val ? 'bg-blue-600' : 'bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${val ? 'left-3.5' : 'left-0.5'}`}/>
                      </button>
                      <span className="text-[10px] text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>

                {/* Pitch shift */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">🎵 Pitch shift: <span className="text-blue-400 font-bold">{pitchShift > 0 ? '+' : ''}{pitchShift} st</span></span>
                  <input type="range" min={-5} max={5} step={1} value={pitchShift} onChange={e => setPitchShift?.(+e.target.value)} className="flex-1 accent-blue-500"/>
                </div>

                {/* Zoom */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">✂️ Crop & zoom: <span className="text-blue-400 font-bold">{zoomPct}%</span></span>
                  <input type="range" min={1} max={8} step={1} value={zoomPct} onChange={e => setZoomPct?.(+e.target.value)} className="flex-1 accent-blue-500"/>
                </div>

                {/* Volume */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">🔊 Âm lượng: <span className="text-blue-400 font-bold">{audioVolume}%</span></span>
                  <input type="range" min={80} max={120} step={1} value={audioVolume} onChange={e => setAudioVolume?.(+e.target.value)} className="flex-1 accent-blue-500"/>
                </div>

                {/* Noise level */}
                {bgNoise && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] text-slate-400 shrink-0 w-24">🌊 Tiếng nền: <span className="text-blue-400 font-bold">{bgNoiseLevel}%</span></span>
                    <input type="range" min={1} max={10} step={1} value={bgNoiseLevel} onChange={e => setBgNoiseLevel?.(+e.target.value)} className="flex-1 accent-blue-500"/>
                  </div>
                )}

                {/* Speed level */}
                {varSpeed && (
                  <div className="mb-1.5">
                    <div className="text-[10px] text-slate-400 mb-1">⚡ Mức thay tốc độ</div>
                    <div className="flex gap-1">
                      {[['light','Nhẹ'],['medium','Vừa'],['strong','Mạnh']].map(([v,l]) => (
                        <button key={v} onClick={() => setVarSpeedLevel?.(v)}
                          className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${varSpeedLevel === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Color shift level */}
                {colorShift && (
                  <div className="mb-1.5">
                    <div className="text-[10px] text-slate-400 mb-1">🎨 Mức đổi màu</div>
                    <div className="flex gap-1">
                      {[['light','Nhẹ'],['medium','Vừa'],['strong','Mạnh']].map(([v,l]) => (
                        <button key={v} onClick={() => setColorShiftLevel?.(v)}
                          className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${colorShiftLevel === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ken Burns */}
                <div className="mb-1.5">
                  <div className="text-[10px] text-slate-400 mb-1">📷 Ken Burns (pan/zoom)</div>
                  <div className="flex gap-1">
                    {[['none','Tắt'],['slow','Chậm'],['fast','Nhanh']].map(([v,l]) => (
                      <button key={v} onClick={() => setKenBurns?.(v)}
                        className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${kenBurns === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* GPU mode */}
                <div className="mb-1.5">
                  <div className="text-[10px] text-slate-400 mb-1">🖥️ GPU encode</div>
                  <div className="flex gap-1 flex-wrap">
                    {[['auto','Tự động'],['nvidia','NVIDIA'],['amd','AMD'],['cpu','CPU']].map(([v,l]) => (
                      <button key={v} onClick={() => setGpuMode?.(v)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${gpuMode === v ? 'bg-slate-500 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Watermark */}
                <div className="mb-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                    <button onClick={() => setWmEnabled?.(v => !v)}
                      className={`w-7 h-3.5 rounded-full relative transition-all shrink-0 ${wmEnabled ? 'bg-orange-500' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${wmEnabled ? 'left-3.5' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">🏷️ Watermark kênh</span>
                  </label>
                  {wmEnabled && (
                    <input value={wmText} onChange={e => setWmText?.(e.target.value)} placeholder="Tên kênh..."
                      className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-orange-500/60"/>
                  )}
                </div>
              </div>

              {/* SEO lang */}
              <div>
                <div className="text-[11px] text-blue-300 font-black mb-1 uppercase tracking-wide">🌐 Ngôn ngữ viết SEO & Tiêu đề</div>
                <div className="flex gap-1 flex-wrap">
                {[['vi','🇻🇳 Tiếng Việt'],['en','🇺🇸 Tiếng Anh'],['zh','🇨🇳 Tiếng Trung'],['ja','🇯🇵 Tiếng Nhật'],['ko','🇰🇷 Tiếng Hàn'],['th','🇹🇭 Tiếng Thái'],['id','🇮🇩 Tiếng Indo']].map(([code, label]) => (
                  <button key={code} onClick={() => onSeoLangChange?.(code)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${seoLang === code ? 'bg-blue-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600'}`}>
                    {label}
                  </button>
                ))}
                </div>
              </div>
              {/* Folder */}
              <div className="flex gap-2">
                <div className="flex-1 bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-slate-400 truncate">
                  {outFolder || 'Chưa chọn thư mục...'}
                </div>
                <button onClick={pickFolder} className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[11px] rounded">📁</button>
              </div>
            </div>
            </div>
          </div>
        )}

        {/* VIEW: LOGS */}
        {view === 'logs' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px]">
            {batchLogs?.length === 0 && <div className="text-slate-500 text-center mt-8">Chưa có nhật ký</div>}
            {(batchLogs||[]).map((l, i) => (
              <div key={i} className={`leading-5 whitespace-pre-wrap break-words ${l.type==='error'?'text-red-400':l.type==='success'?'text-emerald-400':l.type==='warn'?'text-yellow-400':'text-slate-300'}`}>
                <span className="text-slate-600 mr-1.5">[{l.t}]</span>{l.msg}
              </div>
            ))}
            <div ref={logEndRef}/>
          </div>
        )}

        {/* Bottom action */}
        <div className="p-3 border-t border-slate-700/50 shrink-0 space-y-2">
          {batchRunning ? (
            <button onClick={onStopBatch} className="w-full py-2.5 rounded-lg text-[13px] font-black bg-amber-700 hover:bg-amber-600 text-white transition-colors">
              ⏸ Tạm dừng
            </button>
          ) : (
            <>
              {pausedQueue?.length > 0 && (
                <button onClick={() => { onStartBatch(pausedQueue, ytBatchPipeMode, outFolder); }}
                  className="w-full py-2.5 rounded-lg text-[13px] font-black bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-lg shadow-emerald-900/40">
                  ▶ Tiếp tục ({pausedQueue.length} video còn lại)
                </button>
              )}
              <button onClick={handleStart} className="w-full py-2.5 rounded-lg text-[13px] font-black bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-900/40">
                🚀 Bắt đầu Reup ({queue.length})
              </button>
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — Logs full */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#07090f]">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-700/50 shrink-0 flex items-center justify-between">
          <span className="text-[13px] font-black text-white">
            {batchRunning ? `⚙️ Đang xử lý ${batchProgress?.cur||0}/${batchProgress?.total||0} video` : '📋 Nhật ký'}
          </span>
          {batchRunning && (batchProgress?.total||0) > 0 && (() => {
            const STEP_WEIGHTS = { download: 0, process: 25, seo: 75, thumbnail: 90 };
            const baseProgress = STEP_WEIGHTS[batchProgress?.step] ?? 0;
            const videoBase = ((batchProgress.cur - 1) / batchProgress.total) * 100;
            const videoShare = 100 / batchProgress.total;
            let pct;
            if (batchProgress?.step === 'download') {
              pct = videoBase + (batchProgress.dlPct || 0) / 100 * videoShare * 0.25;
            } else {
              pct = videoBase + baseProgress / 100 * videoShare;
            }
            pct = Math.min(Math.round(pct), 99);
            return (
              <div className="flex items-center gap-2">
                <div className="w-40 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }}/>
                </div>
                <span className="text-[11px] text-blue-400 font-black">
                  {batchProgress?.step === 'download' ? `${Math.round(batchProgress.dlPct||0)}%` : `${pct}%`}
                </span>
              </div>
            );
          })()}
        </div>
        {/* Now Processing Card */}
        {batchRunning && batchProgress?.thumbnail && (() => {
          const STEPS = [
            { key: 'download',  icon: '⬇', label: 'Tải về' },
            { key: 'process',   icon: '⚙', label: 'Xử lý' },
            { key: 'seo',       icon: '🔍', label: 'SEO' },
            { key: 'thumbnail', icon: '🖼', label: 'Thumbnail' },
          ];
          const curStepIdx = STEPS.findIndex(s => s.key === batchProgress.step);
          return (
            <div className="mx-3 my-2 rounded-xl border border-blue-700/40 bg-blue-950/20 p-3 shrink-0">
              <div className="flex gap-3 items-start mb-3">
                <img src={batchProgress.thumbnail} alt="" className="w-20 h-12 object-cover rounded-lg shrink-0 border border-slate-700/50"/>
                <div className="min-w-0">
                  <div className="text-[10px] text-blue-400 font-black uppercase tracking-wider mb-0.5">Đang xử lý</div>
                  <div className="text-[12px] text-white font-bold leading-4 line-clamp-2">{batchProgress.title}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {STEPS.map((s, idx) => {
                  const done = curStepIdx > idx;
                  const active = curStepIdx === idx;
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black transition-all
                        ${done ? 'bg-emerald-600 text-white' : active ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-[#07090f]' : 'bg-slate-800 text-slate-600'}`}>
                        {done ? '✓' : s.icon}
                      </div>
                      <div className={`text-[9px] font-bold ${active ? 'text-blue-300' : done ? 'text-emerald-500' : 'text-slate-600'}`}>{s.label}</div>
                      {idx < STEPS.length - 1 && (
                        <div className="absolute" style={{ display: 'none' }}/>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px]">
          {(!batchLogs||batchLogs.length===0) ? (
            <div className="font-sans space-y-4">
              {/* STATS */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">📊 Thống kê</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Đã reup', value: Object.keys(doneVideos).length, color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/30' },
                    { label: 'Hàng đợi', value: queue.length, color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700/30' },
                    { label: 'Kênh đã xem', value: channelHistory.length, color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-700/30' },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`rounded-xl border px-3 py-3 text-center ${bg}`}>
                      <div className={`text-[22px] font-black ${color}`}>{value}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CẤU HÌNH HIỆN TẠI */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">⚙️ Cấu hình Pipeline</div>
                <div className="bg-[#0d1221] border border-slate-700/40 rounded-xl p-3 space-y-1.5">
                  {/* Pipeline cơ bản */}
                  {[
                    ['Chế độ', ytBatchPipeMode === 'normal' ? '🔄 Tái Tạo' : ytBatchPipeMode === 'review' ? '🎬 Review' : `📦 Multi (${multiCount} bản)`],
                    ['Chất lượng tải', downloadQuality === 'best' ? 'Tốt nhất' : downloadQuality],
                    ['Độ phân giải', outputResolution === 'source' ? 'Gốc' : outputResolution || 'Gốc'],
                    ['Ngôn ngữ SEO', {'vi':'🇻🇳 Tiếng Việt','en':'🇺🇸 Tiếng Anh','zh':'🇨🇳 Tiếng Trung','ja':'🇯🇵 Tiếng Nhật','ko':'🇰🇷 Tiếng Hàn','th':'🇹🇭 Tiếng Thái','id':'🇮🇩 Tiếng Indo'}[seoLang] || seoLang],
                    (trimStart > 0 || trimEnd > 0) && ['Cắt video', `✂ đầu ${trimStart}s · cuối ${trimEnd}s`],
                    targetDurEnabled && ['Thời lượng mục tiêu', `⏱ ${targetDurMinutes} phút`],
                    ['Thư mục', outFolder ? (outFolder.split(/[\\/]/).pop() || outFolder) : '⚠ Chưa chọn'],
                  ].filter(Boolean).map(([k,v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">{k}</span>
                      <span className="text-[10px] font-bold text-white">{v}</span>
                    </div>
                  ))}

                  {/* Review film settings */}
                  {ytBatchPipeMode === 'review' && (
                    <div className="border-t border-slate-700/40 pt-1.5 mt-1.5 space-y-1.5">
                      <div className="text-[9px] text-purple-400 font-bold uppercase tracking-wide mb-1">🎙️ Lồng tiếng AI</div>
                      {[
                        ['Ngôn ngữ', {'vi':'🇻🇳 Tiếng Việt','en':'🇺🇸 Tiếng Anh','zh':'🇨🇳 Tiếng Trung','ja':'🇯🇵 Tiếng Nhật','ko':'🇰🇷 Tiếng Hàn','th':'🇹🇭 Tiếng Thái','id':'🇮🇩 Tiếng Indo'}[rfTargetCode] || rfTargetCode],
                        ['Engine TTS', rfTtsEngine === 'auto' ? `🤖 Tự động (→${rfTargetCode==='vi'?'VieNeu':'Edge'})` : rfTtsEngine === 'vieneu' ? '🇻🇳 VieNeu' : rfTtsEngine === 'gemini' ? `✨ Gemini (${rfGeminiVoice})` : `⚡ Edge`],
                        ['Giọng', rfTtsEngine === 'gemini' ? rfGeminiVoice : rfTtsEngine === 'edge' || (rfTtsEngine==='auto'&&rfTargetCode!=='vi') ? rfEdgeVoice : (rfVieNeuVoices?.find(v=>v.id===rfVieNeuVoice)?.name || rfVieNeuVoice || 'Mặc định')],
                        ['Tách vocals (Demucs)', rfSeparateVocals ? '✅ Bật — giữ nhạc nền' : '❌ Tắt'],
                        [rfSeparateVocals ? 'Âm lượng nhạc nền' : 'Âm lượng gốc', rfVideoVol === 0 ? '🔇 Tắt' : `${rfVideoVol}%`],
                        ['Âm lượng TTS', `🎙 ${rfVoiceVol}%`],
                        ['Burn phụ đề', rfBurnSub ? '✅ Có' : '❌ Không'],
                      ].map(([k,v]) => (
                        <div key={k} className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">{k}</span>
                          <span className="text-[10px] font-bold text-purple-300">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Hiệu ứng tái tạo */}
                  <div className="border-t border-slate-700/40 pt-1.5 mt-1.5">
                    <div className="text-[9px] text-blue-400 font-bold uppercase tracking-wide mb-1.5">🎛️ Hiệu ứng tái tạo</div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        [hFlip && ytBatchPipeMode !== 'review', '↔ Lật ngang'],
                        [varSpeed, `⚡ Tốc độ (${varSpeedLevel})`],
                        [colorShift, `🎨 Màu (${colorShiftLevel})`],
                        [grainNoise, '🌫 Hạt nhiễu'],
                        [stereoFlip, '🔊 Stereo flip'],
                        [bgNoise, `🌊 Tiếng nền ${bgNoiseLevel}%`],
                        [randomCut, '✂ Cắt ngẫu nhiên'],
                        [randomFps, '🎞 FPS ngẫu nhiên'],
                        [slightRotate, '🔄 Xoay nhẹ'],
                        [hueRotate, '🌈 Hue rotate'],
                        [randomPosCrop, '📐 Crop vị trí'],
                        [audioEQ, '🎚 Equalizer'],
                        [kenBurns !== 'none', `📷 Ken Burns (${kenBurns})`],
                        [wmEnabled, `🏷 WM: ${wmText || '(trống)'}`],
                      ].filter(([on]) => on).map(([, label]) => (
                        <span key={label} className="px-1.5 py-0.5 bg-blue-900/30 border border-blue-700/40 rounded text-[9px] text-blue-300">{label}</span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                      {[
                        [`🎵 Pitch: ${pitchShift > 0 ? '+' : ''}${pitchShift} st`],
                        [`🔍 Zoom: ${zoomPct}%`],
                        [`🔊 Âm lượng: ${audioVolume}%`],
                        [`🖥️ GPU: ${gpuMode}`],
                      ].map(([v]) => (
                        <span key={v} className="text-[9px] text-slate-400">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* QUEUE PREVIEW */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">
                  📋 Hàng đợi {queue.length > 0 ? `(${queue.length} video)` : ''}
                </div>
                {queue.length === 0 ? (
                  <div className="bg-[#0d1221] border border-dashed border-slate-700/50 rounded-xl p-6 text-center text-slate-600 text-[11px]">
                    Chưa có video nào trong hàng đợi<br/>
                    <span className="text-[10px]">Tìm kênh → click vào video để chọn</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {queue.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2 bg-[#0d1221] border border-slate-700/30 rounded-lg px-2.5 py-2">
                        <span className="text-[10px] text-blue-500 font-mono w-5 shrink-0">{i+1}.</span>
                        {v.thumbnail && <img src={v.thumbnail} alt="" className="w-10 h-7 object-cover rounded shrink-0"/>}
                        <span className="flex-1 text-[10px] text-slate-300 line-clamp-2 leading-4">{v.title}</span>
                        <button onClick={() => removeFromQueue(v.id)} className="text-slate-600 hover:text-red-400 shrink-0 text-[11px]">✕</button>
                      </div>
                    ))}
                    {queue.length > 0 && (
                      <div className="text-center pt-1">
                        <span className="text-[10px] text-slate-600">Vào tab <b className="text-slate-400">Hàng đợi</b> để cấu hình pipeline trước khi chạy</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <BatchLogDisplay logs={batchLogs} accentColor="blue" logEndRef={logEndRef} batchRunning={batchRunning} batchProgress={batchProgress}/>
        </div>
      </div>
    </div>
  );
}

function VideoCleanerPanel({ initialTab } = {}) {
  const [apiKeys]    = useState(loadKeys);
  const [videoFile,  setVideoFile]  = useState('');
  const [outFolder,  setOutFolder]  = useState(() => localStorage.getItem('fluxy_cleaner_folder') || '');
  const [zoomPct,    setZoomPct]    = useState(5);
  const [apply4K,    setApply4K]    = useState(false);
  const [running,    setRunning]    = useState(false);
  const [logs,       setLogs]       = useState([]);
  const [step,       setStep]       = useState('');
  const [stepNum,    setStepNum]    = useState(-1);
  const [resultPath,     setResultPath]     = useState(null);
  const [previewUrl,     setPreviewUrl]     = useState(null);
  const [batchDonePaths, setBatchDonePaths] = useState([]); // tất cả video xong trong batch
  const [wmEnabled,  setWmEnabled]  = useState(false);   // tắt mặc định, user tự bật
  const [wmText,     setWmText]     = useState('');
  const [wmOpacity,  setWmOpacity]  = useState(20);
  const [wmCycle,    setWmCycle]    = useState(60);
  const [varSpeed,     setVarSpeed]     = useState(true);
  const [varSpeedLevel,setVarSpeedLevel]= useState('medium'); // ±4% — vượt tolerance ContentID
  const [targetDurEnabled, setTargetDurEnabled] = useState(false);
  const [targetDurMinutes, setTargetDurMinutes] = useState(15);
  const [pitchShift,   setPitchShift]   = useState(1);        // +1st — đủ lách ContentID, ít artifact hơn +2st
  const [stereoFlip,   setStereoFlip]   = useState(true);
  const [bgNoise,      setBgNoise]      = useState(true);
  const [bgNoiseLevel, setBgNoiseLevel] = useState(1);        // 1% — không nghe thấy, đủ phá audio hash
  const [audioVolume,  setAudioVolume]  = useState(100);
  const [kenBurns,     setKenBurns]     = useState('light');
  const [randomCut,    setRandomCut]    = useState(true);
  const [hFlip,        setHFlip]        = useState(true);
  const [grainNoise,   setGrainNoise]   = useState(true);    // bật — phá temporal hash
  const [grainLevel,   setGrainLevel]   = useState(3);       // nhẹ — không nhìn thấy
  const [randomMeta,      setRandomMeta]      = useState(true);
  const [gpuMode,         setGpuMode]         = useState('auto');
  const [mainTab,         setMainTab]         = useState(() => initialTab || 'ytchannel');
  const [colorShift,      setColorShift]      = useState(true);
  const [colorShiftLevel, setColorShiftLevel] = useState('medium');
  const [randomPosCrop,   setRandomPosCrop]   = useState(true);
  const [bgNoiseFile,     setBgNoiseFile]     = useState('');
  const [bgNoiseColor,    setBgNoiseColor]    = useState('pink');
  const [randomFps,       setRandomFps]       = useState(true);
  const [slightRotate,    setSlightRotate]    = useState(true);
  const [hueRotate,       setHueRotate]       = useState(true);
  const [audioEQ,         setAudioEQ]         = useState(true);
  const [subRemove,       setSubRemove]       = useState(false);
  const [subHeight,       setSubHeight]       = useState(10);
  const [subWidth,        setSubWidth]        = useState(100);
  const [subHOffset,      setSubHOffset]      = useState(0);
  const [subPosition,     setSubPosition]     = useState('bottom');
  const [subPreviewImg,   setSubPreviewImg]   = useState(null);
  const [subPreviewLoading, setSubPreviewLoading] = useState(false);
  const [subStyle,        setSubStyle]        = useState('blur');
  const [vignette,        setVignette]        = useState(true);   // bật — thay đổi histogram vùng rìa
  const [videoPad,        setVideoPad]        = useState(false);
  const [audioCompress,   setAudioCompress]   = useState(true);
  const [presetMode,      setPresetMode]      = useState('normal');
  const [audioReverb,     setAudioReverb]     = useState(false);
  const [audioChorus,     setAudioChorus]     = useState(false);
  const [brightnessJitter,setBrightnessJitter]= useState(true);
  const [colorChannelShift, setColorChannelShift] = useState(true);
  const [temporalBlend,     setTemporalBlend]     = useState(true);  // bật — frame noise 2/255 phá temporal hash
  const [perspectiveWarp,   setPerspectiveWarp]   = useState(false); // tắt — làm mờ toàn frame
  const [audioDither,       setAudioDither]       = useState(true);
  const [removeBgMusic,     setRemoveBgMusic]     = useState(false);
  const [outputResolution,  setOutputResolution]  = useState('source');
  const [downloadQuality,   setDownloadQuality]   = useState('best'); // chất lượng tải xuống
  const [multiCount,        setMultiCount]        = useState(1);   // số bản output từ 1 video gốc
  const [trimStart,         setTrimStart]         = useState(0);   // cắt N giây đầu
  const [trimEnd,           setTrimEnd]           = useState(0);   // cắt N giây cuối
  // SEO & Thumbnail tự động
  const [sourceUrl,   setSourceUrl]   = useState('');
  const [seoResult,   setSeoResult]   = useState(null);
  const [seoLoading,  setSeoLoading]  = useState(false);
  const [seoError,    setSeoError]    = useState('');
  const [seoLang,     setSeoLang]     = useState('vi');
  const [seoThumbIdx, setSeoThumbIdx] = useState(0);
  const [seoThumbShowText, setSeoThumbShowText] = useState(false);
  const [seoThumbImgs, setSeoThumbImgs] = useState({});
  const [seoThumbGenKey, setSeoThumbGenKey] = useState(null);
  const [thumbRegenLoading, setThumbRegenLoading] = useState(false);
  // Thumbnail AI (phân tích ảnh gốc → prompt → vẽ)
  const [aiThumbPrompt,    setAiThumbPrompt]    = useState('');
  const [aiThumbImg,       setAiThumbImg]       = useState(null);
  const [aiThumbLoading,   setAiThumbLoading]   = useState(false);
  const [aiThumbMsg,       setAiThumbMsg]       = useState('');
  const [aiThumbErr,       setAiThumbErr]       = useState('');
  const [aiThumbRemText,   setAiThumbRemText]   = useState(false);
  const [aiThumbFolder,    setAiThumbFolder]    = useState(() => localStorage.getItem('fluxy_thumb_folder') || '');
  const [seoTab,           setSeoTab]           = useState('seo'); // 'seo' | 'thumb'
  // RVC Voice Conversion
  const [rvcEnabled,    setRvcEnabled]    = useState(false);
  const [rvcModelPath,  setRvcModelPath]  = useState('');
  const [rvcIndexPath,  setRvcIndexPath]  = useState('');
  const [rvcPitch,      setRvcPitch]      = useState(0);
  const [rvcF0Method,   setRvcF0Method]   = useState('medium'); // intensity mặc định cho Voice Transform
  const [rvcStatus,     setRvcStatus]     = useState(null); // null | 'checking' | 'ok' | 'error' | 'installing'
  const [rvcStatusMsg,  setRvcStatusMsg]  = useState('');
  // Review Phim pipeline (lồng tiếng tự động)
  const [rfEnabled,       setRfEnabled]       = useState(false);
  const [rfTargetLang,    setRfTargetLang]    = useState('English');
  const [rfTargetCode,    setRfTargetCode]    = useState('en');
  const [rfBurnSub,       setRfBurnSub]       = useState(true);
  const [rfStep,          setRfStep]          = useState({ cur: 0, total: 0, label: '' });
  const [rfVieNeuVoice,   setRfVieNeuVoice]   = useState('');
  const [rfVieNeuVoices,  setRfVieNeuVoices]  = useState([]);
  const [rfEdgeVoice,     setRfEdgeVoice]     = useState('en-US-AriaNeural');
  const [rfEdgeVoices,    setRfEdgeVoices]    = useState([]);
  const [rfTtsEngine,     setRfTtsEngine]     = useState('auto'); // 'auto'|'vieneu'|'edge'|'gemini'
  const [rfGeminiVoice,   setRfGeminiVoice]   = useState('Aoede');
  const [rfRunning,       setRfRunning]       = useState(false);
  const [rfVideoVol,        setRfVideoVol]        = useState(50);   // âm lượng nhạc nền 0-100%
  const [rfVoiceVol,        setRfVoiceVol]        = useState(120);  // âm lượng lồng tiếng 80-150%
  const [rfSeparateVocals,  setRfSeparateVocals]  = useState(false); // tách vocals → giữ nhạc nền
  const [rfGeminiModel,   setRfGeminiModel]   = useState('gemini-3.5-flash');
  const [rfMultiCount,    setRfMultiCount]    = useState(1);  // số bản output (1 = single)
  const RF_GEMINI_MODELS = [
    { id: 'gemini-3.5-flash',       label: '3.5 Flash' },
    { id: 'gemini-3-flash-preview', label: '3.0 Flash Preview' },
    { id: 'gemini-3.1-flash-lite',  label: '3.1 Flash Lite' },
  ];
  const RF_LANGS = [
    { label: 'Tiếng Anh',     code: 'en', lang: 'English'    },
    { label: 'Tiếng Việt',    code: 'vi', lang: 'Vietnamese'  },
    { label: 'Tiếng Nhật',    code: 'ja', lang: 'Japanese'    },
    { label: 'Tiếng Hàn',     code: 'ko', lang: 'Korean'      },
    { label: 'Tiếng Thái',    code: 'th', lang: 'Thai'        },
    { label: 'Tiếng Indo',    code: 'id', lang: 'Indonesian'  },
    { label: 'Tiếng TBN',     code: 'es', lang: 'Spanish'     },
    { label: 'Tiếng Pháp',    code: 'fr', lang: 'French'      },
  ];
  // Batch mode
  const [batchMode,       setBatchMode]       = useState(false);
  const [batchFolder,     setBatchFolder]     = useState('');
  const [batchQueue,      setBatchQueue]      = useState([]); // [{path, name, status}]
  const [batchIdx,        setBatchIdx]        = useState(-1);
  const batchStopRef = useRef(false);
  const ytBatchRunningRef = useRef(false);
  const logEndRef = useRef(null);
  const [ytBatchRunning, setYtBatchRunning] = useState(false);
  const [ytBatchLogs,    setYtBatchLogs]    = useState([]);
  const [ytBatchProgress, setYtBatchProgress] = useState({ cur: 0, total: 0 });
  // ── Bilibili Reup batch ──
  const biliBatchStopRef = useRef(false);
  const [biliBatchRunning,  setBiliBatchRunning]  = useState(false);
  const [biliBatchLogs,     setBiliBatchLogs]     = useState([]);
  const [biliBatchProgress, setBiliBatchProgress] = useState({ cur: 0, total: 0 });
  // Pause/resume queues — load từ localStorage để recover khi app bị tắt đột ngột
  const [ytPausedQueue,   setYtPausedQueue]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('fluxy_yt_paused_queue') || '[]'); } catch { return []; }
  });
  const [biliPausedQueue, setBiliPausedQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fluxy_bili_paused_queue') || '[]'); } catch { return []; }
  });
  // Sync paused queues to localStorage whenever they change
  useEffect(() => {
    if (ytPausedQueue.length > 0) localStorage.setItem('fluxy_yt_paused_queue', JSON.stringify(ytPausedQueue));
    else localStorage.removeItem('fluxy_yt_paused_queue');
  }, [ytPausedQueue]);
  useEffect(() => {
    if (biliPausedQueue.length > 0) localStorage.setItem('fluxy_bili_paused_queue', JSON.stringify(biliPausedQueue));
    else localStorage.removeItem('fluxy_bili_paused_queue');
  }, [biliPausedQueue]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Lắng nghe tiến độ tải yt-dlp để hiện % thực tế trên thanh tiến độ
  useEffect(() => {
    const handler = ({ percent }) => {
      setYtBatchProgress(prev => prev.step === 'download' ? { ...prev, dlPct: percent } : prev);
    };
    window.electronAPI?.onYtDownloadProgress?.(handler);
  }, []);

  const addLog = (msg, type = 'info') => {
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-400), { t, msg, type }]);
  };

  const addYtLog = (msg, type = 'info') => {
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isTime = /time=\d/.test(msg);
    setYtBatchLogs(prev => {
      const base = prev.slice(-400);
      if (isTime) {
        const lastIdx = base.length - 1;
        if (lastIdx >= 0 && /time=\d/.test(base[lastIdx].msg)) {
          return [...base.slice(0, lastIdx), { t, msg, type }];
        }
      }
      return [...base, { t, msg, type }];
    });
  };

  const addBiliLog = (msg, type = 'info') => {
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isTime = /time=\d/.test(msg);
    setBiliBatchLogs(prev => {
      const base = prev.slice(-400);
      if (isTime) {
        const lastIdx = base.length - 1;
        if (lastIdx >= 0 && /time=\d/.test(base[lastIdx].msg)) {
          return [...base.slice(0, lastIdx), { t, msg, type }];
        }
      }
      return [...base, { t, msg, type }];
    });
  };

  const pickVideo = async () => {
    const f = await window.electronAPI.selectFile('video');
    if (f) { setVideoFile(f); setResultPath(null); setPreviewUrl(null); setLogs([]); setStep(''); setStepNum(-1); }
  };
  const pickFolder = async () => {
    const f = await window.electronAPI.selectFolder();
    if (f) { setOutFolder(f); localStorage.setItem('fluxy_cleaner_folder', f); }
  };
  const pickBgNoiseFile = async () => {
    const f = await window.electronAPI.selectFile('audio');
    if (f) setBgNoiseFile(f);
  };
  const pickBatchFolder = async () => {
    const f = await window.electronAPI.selectFolder();
    if (f) {
      setBatchFolder(f);
      const res = await window.electronAPI.listFiles(f);
      const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];
      const files = (res?.files || []).filter(fp => VIDEO_EXTS.includes(fp.slice(fp.lastIndexOf('.')).toLowerCase()));
      setBatchQueue(files.map(fp => ({ path: fp, name: fp.split(/[/\\]/).pop(), status: 'pending' })));
    }
  };

  const STEPS = [
    '📊 Phân tích video',
    '🖼 Trích xuất khung hình',
    '🔍 Phát hiện logo',
    '✂ Xóa logo + cắt đoạn',
    '🎨 Lọc 4K',
    '🎉 Hoàn tất',
  ];

  // ── Review Phim pipeline ────────────────────────────────────────────────────
  // Load VieNeu voices khi chọn Tiếng Việt
  useEffect(() => {
    if (rfTargetCode === 'vi' && rfVieNeuVoices.length === 0) {
      // Load built-in voices từ Python
      window.electronAPI.vieNeuGetVoices?.().then(res => {
        const builtIn = (res?.voices || []).map(v =>
          Array.isArray(v) ? { name: v[0], id: v[1] } : { name: v.name || v.id, id: v.id || v.name }
        );
        // Merge clone voices từ localStorage
        const clones = (() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]'); } catch { return []; } })();
        const cloneVoices = clones.map(c => ({
          id: `__clone__${c.id}`,
          name: `🎤 ${c.name} (Clone)`,
          refAudio: c.refAudio,
          refText: c.refText,
        }));
        const all = [...cloneVoices, ...builtIn];
        if (all.length) {
          setRfVieNeuVoices(all);
          setRfVieNeuVoice(all[0]?.id || '');
        }
      }).catch(() => {
        // Fallback: chỉ load clone nếu Python lỗi
        const clones = (() => { try { return JSON.parse(localStorage.getItem('vieneu_saved_voices') || '[]'); } catch { return []; } })();
        const cloneVoices = clones.map(c => ({ id: `__clone__${c.id}`, name: `🎤 ${c.name} (Clone)`, refAudio: c.refAudio, refText: c.refText }));
        if (cloneVoices.length) { setRfVieNeuVoices(cloneVoices); setRfVieNeuVoice(cloneVoices[0].id); }
      });
    }
    // Load Edge voices khi chọn ngôn ngữ khác tiếng Việt
    if (rfTargetCode !== 'vi' && rfEdgeVoices.length === 0) {
      window.electronAPI.getVoices?.().then(voices => {
        if (voices?.length) {
          setRfEdgeVoices(voices);
          // Auto chọn voice đầu tiên của ngôn ngữ đã chọn
          const match = voices.find(v => (v.Locale || v.ShortName || '').toLowerCase().startsWith(rfTargetCode + '-'));
          if (match) setRfEdgeVoice(match.ShortName);
        }
      }).catch(() => {});
    }
  }, [rfTargetCode]);

  const rfAddLog = (msg, type = 'info') => addLog(msg, type);

  const runReviewFilm = async (overrideVideoPath, overrideOutFolder) => {
    const vPath   = overrideVideoPath  || videoFile;
    const vFolder = overrideOutFolder  || outFolder;
    if (!vPath || !vFolder) return;
    const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
    if (!apiKeys.length) { rfAddLog('❌ Chưa có Gemini API key. Vào Settings để thêm.', 'error'); return; }

    // Thứ tự: Audio pipeline → Video pipeline → Ghép cuối
    // 1.Đọc info  2.Transcribe  3.Dịch  4.TTS  [4b.Tách vocals]  5.Recreate video  6.Mix audio  7.Burn sub (optional)
    const totalStepsRf = (rfBurnSub ? 7 : 6) + (rfSeparateVocals ? 1 : 0);
    const rfProgress = (cur, label) => {
      setRfStep({ cur, total: totalStepsRf, label });
      setYtBatchProgress(p => ({ ...p, stepLabel: label }));
      rfAddLog(label);
    };

    setRfRunning(true); if (!overrideVideoPath) setLogs([]); setRfStep({ cur: 0, total: totalStepsRf, label: 'Khởi động...' });
    const tmpDir = vFolder;
    const tempFiles = []; // track tất cả file tạm để dọn dẹp sau
    const savedPaths = []; // track file output — không được xóa
    const registerTemp = (p) => { if (p) tempFiles.push(p); return p; };

    const msToSrt = ms => {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const f = ms % 1000;
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(f).padStart(3,'0')}`;
    };

    try {
      // ── Bước 1: Đọc thông tin video ──────────────────────────────────────
      rfProgress(1, `🎵 Bước 1/${totalStepsRf}: Đọc thông tin video...`);
      const audioInfo = await window.electronAPI.prepareAudio(vPath);
      const totalDur  = parseFloat(audioInfo?.duration || 0);
      if (!totalDur) throw new Error('Không đọc được thông tin video: ' + (audioInfo?.error || ''));
      rfAddLog(`✅ Thời lượng: ${Math.floor(totalDur/60)}p${Math.floor(totalDur%60)}s`, 'success');

      // ── Bước 2: Transcribe audio (0.8x tempo để Gemini nhận diện chính xác hơn) ──
      rfProgress(2, `🎙️ Bước 2/${totalStepsRf}: Nhận dạng giọng nói...`);
      let segments = [];

      const extractChunkFn = async (startSec, durSec) => {
        const r = await window.electronAPI.extractAudioChunk({ filePath: vPath, startSec, durationSec: durSec });
        return r?.success ? r : null;
      };

      rfAddLog(`🎙️ Gửi audio lên Gemini [${rfGeminiModel}] (${Math.ceil(totalDur / 60)} phần × 60s)...`);
      const tcResult = await transcribeAudioChunked(
        apiKeys, totalDur, extractChunkFn,
        (rangeStr) => rfAddLog(`  📝 ${rangeStr}`),
        (chunkIdx, total, segCount, err) => err
          ? rfAddLog(`  ⚠️ Chunk ${chunkIdx}/${total} lỗi: ${err}`, 'error')
          : rfAddLog(`  ✅ Chunk ${chunkIdx}/${total}: ${segCount} đoạn`),
        (msg) => rfAddLog('  ' + msg),
        1,
        rfGeminiModel
      );
      const rawSegs = tcResult?.segments || [];
      if (!rawSegs.length) throw new Error('Gemini không nhận ra lời thoại trong video');
      segments = rawSegs.map(s => ({
        text:    s.text,
        startMs: Math.round(s.start * 1000),
        endMs:   Math.round(s.end   * 1000),
      }));
      rfAddLog(`✅ Transcribe xong: ${segments.length} đoạn`, 'success');
      segments.slice(0, 2).forEach((s, i) =>
        rfAddLog(`  [${i+1}] ${s.text?.slice(0, 70)}`, 'info')
      );

      // ── Bước 3: Dịch (dùng smartTranslateSRT giống Bóc tách) ────────────
      // Detect xem source đã là target lang chưa (tránh Gemini dịch ngược)
      const isAlreadyTargetLang = (() => {
        if (rfTargetCode !== 'en') return false;
        const sample = segments.slice(0, 10).map(s => s.text).join(' ');
        const latinRatio = (sample.match(/[a-zA-Z\s.,!?'"]/g) || []).length / Math.max(sample.length, 1);
        return latinRatio > 0.7; // >70% Latin chars → đã là tiếng Anh
      })();

      let translatedSegs;
      if (isAlreadyTargetLang) {
        rfAddLog(`⚡ Bước 3/${totalStepsRf}: Nguồn đã là ${rfTargetLang} — bỏ qua dịch, dùng text gốc`, 'success');
        translatedSegs = segments;
      } else {
        rfProgress(3, `🌐 Bước 3/${totalStepsRf}: Dịch ${segments.length} đoạn sang ${rfTargetLang}...`);

        // Convert segments → SRT để dùng smartTranslateSRT
        const segsToSRT = (segs) => segs.map((s, i) =>
          `${i+1}\n${msToSrt(s.startMs)} --> ${msToSrt(s.endMs)}\n${s.text}`
        ).join('\n\n');
        const parseSRTToSegs = (srtText, origSegs) => {
          const blocks = srtText.trim().split(/\n\n+/);
          return origSegs.map((orig, i) => {
            const block = blocks[i];
            if (!block) return orig;
            const lines = block.trim().split('\n');
            const tsIdx = lines.findIndex(l => /-->/.test(l));
            const text = lines.slice(tsIdx + 1).join(' ').trim();
            return text ? { ...orig, text } : orig;
          });
        };

        const srcSRT = segsToSRT(segments);
        const translatedSRT = await smartTranslateSRT(srcSRT, rfTargetLang, apiKeys, (msg) => rfAddLog(`  ${msg}`), rfGeminiModel, 'dubbing');
        translatedSegs = parseSRTToSegs(translatedSRT, segments).filter(s => s.text);
        rfAddLog(`✅ Dịch xong: ${translatedSegs.length}/${segments.length} đoạn sang ${rfTargetLang}`, 'success');
        translatedSegs.slice(0, 2).forEach((s, i) =>
          rfAddLog(`  🔤 [${i+1}] ${s.text?.slice(0, 70)}`, 'info')
        );
      }

      // ── Bước 4: TTS ───────────────────────────────────────────────────────
      // Xác định engine: auto → VieNeu nếu vi, Edge nếu ngôn ngữ khác
      const resolvedEngine = rfTtsEngine === 'auto'
        ? (rfTargetCode === 'vi' ? 'vieneu' : 'edge')
        : rfTtsEngine;
      const ttsLabel = resolvedEngine === 'vieneu' ? `VieNeu (${rfVieNeuVoice || 'mặc định'})`
        : resolvedEngine === 'gemini' ? `Gemini TTS (${rfGeminiVoice})`
        : `Edge TTS (${rfEdgeVoice})`;
      rfProgress(4, `🎤 Bước 4/${totalStepsRf}: Tạo ${translatedSegs.length} đoạn giọng đọc — ${ttsLabel}...`);
      const ttsExt = resolvedEngine === 'gemini' ? 'wav' : 'mp3';
      const ttsOutPath = registerTemp(`${tmpDir}\\rf_tts_${Date.now()}.${ttsExt}`);
      let ttsRes;
      if (resolvedEngine === 'vieneu') {
        const isClone = rfVieNeuVoice?.startsWith('__clone__');
        const cloneInfo = isClone ? rfVieNeuVoices.find(v => v.id === rfVieNeuVoice) : null;
        ttsRes = await window.electronAPI.vieNeuSynthesizeSRT({
          segments: translatedSegs,
          voiceId: isClone ? null : rfVieNeuVoice,
          refAudio: cloneInfo?.refAudio || null,
          refText: cloneInfo?.refText || null,
          outputPath: ttsOutPath
        });
      } else if (resolvedEngine === 'gemini') {
        const gmApiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
        if (!gmApiKeys.length) throw new Error('Chưa có API Key Gemini — vào Creator để thêm');
        // Lắng nghe progress từ backend và in ra log
        const onProgress = (d) => rfProgress(4, `🎤 TTS Gemini: ${d.text || `${d.done}/${d.total}`}`);
        const onLog      = (text) => rfAddLog(`  ${text}`, 'info');
        window.electronAPI.onGeminiSRTProgress?.(onProgress);
        window.electronAPI.onGeminiSRTLog?.(onLog);
        ttsRes = await window.electronAPI.geminiTTSSRT({
          segments: translatedSegs, voiceName: rfGeminiVoice,
          apiKeys: gmApiKeys, outputPath: ttsOutPath,
        });
        // Dọn listener sau khi TTS xong
        window.electron?.ipcRenderer?.removeListener?.('gemini-srt-progress', onProgress);
        window.electron?.ipcRenderer?.removeListener?.('gemini-srt-log', onLog);
      } else {
        ttsRes = await window.electronAPI.generateSRTVoice({
          segments: translatedSegs, voice: rfEdgeVoice, outputPath: ttsOutPath
        });
      }
      if (!ttsRes?.success) throw new Error('TTS thất bại: ' + (ttsRes?.error || ''));
      const ttsOk = ttsRes.successCount ?? '?';
      rfAddLog(`✅ TTS xong: ${ttsOk}/${translatedSegs.length} đoạn có giọng đọc`, 'success');

      // ── Bước 4b (tuỳ chọn): Tách vocals → giữ nhạc nền ──────────────────
      let instrumentalPath = null;
      if (rfSeparateVocals) {
        const stepSep = 5;
        rfProgress(stepSep, `🎵 Bước ${stepSep}/${totalStepsRf}: Tách giọng nói — giữ nhạc nền (Demucs)...`);
        rfAddLog('⏳ Demucs đang tách vocals, có thể mất 1-5 phút lần đầu tải model (~400MB)...', 'warn');
        const sepRes = await window.electronAPI.separateVocals({ inputPath: vPath, outputDir: tmpDir });
        if (sepRes?.success && sepRes.instrumental) {
          instrumentalPath = registerTemp(sepRes.instrumental);
          registerTemp(sepRes.vocals);
          rfAddLog(`✅ Tách xong — nhạc nền: ${instrumentalPath.split(/[/\\]/).pop()}`, 'success');
        } else {
          rfAddLog(`⚠️ Tách vocals thất bại: ${sepRes?.error || 'unknown'} — tiếp tục với audio gốc`, 'warn');
        }
      }

      // ── Bước 5..7: Lặp cho mỗi bản (recreate + mix + sub) ──────────────
      const totalVariants = rfMultiCount > 1 ? rfMultiCount : 1;
      const srcBase = vPath.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').slice(0, 60);

      for (let vi = 1; vi <= totalVariants; vi++) {
        if (totalVariants > 1) rfAddLog(`\n📦 [${vi}/${totalVariants}] Tạo bản #${vi}...`, 'info');

        // Variation profile — mỗi bản dùng grain/hue/color/zoom khác để né ContentID
        const varGrain       = totalVariants > 1 ? (2 + ((vi - 1) * 2) % 10) : grainLevel;
        const varHue         = totalVariants > 1 ? ((vi - 1) * 7 % 30) : hueRotate;
        const varColorLevel  = totalVariants > 1 ? (0.04 + (vi - 1) * 0.02) : colorShiftLevel;
        const varZoom        = totalVariants > 1 ? (5 + (vi - 1) * 3) : zoomPct;

        // ── Recreate video ────────────────────────────────────────────────
        const step5 = rfSeparateVocals ? 6 : 5;
        rfProgress(step5, `🛡️ Bước ${step5}/${totalStepsRf}: Tái tạo video${totalVariants > 1 ? ` (bản ${vi}/${totalVariants})` : ''}...`);
        const recreateLogHandler = window.electronAPI.onVideoRecreatLog?.((d) => {
          const timeMatch = (d?.text || d?.msg || '').match(/time=(\d{2}:\d{2}:\d{2})/);
          if (timeMatch) setYtBatchProgress(p => ({
            ...p, stepLabel: `🛡️ Tái tạo video bản ${vi}/${totalVariants}... ⏱ ${timeMatch[1]}`
          }));
        });
        const recreateRes = await window.electronAPI.videoRecreate({
          ...buildRecreateParams(vPath, tmpDir),
          pitchShift: 0, varSpeed: false, stereoFlip: false,
          audioReverb: false, audioChorus: false, audioDither: false,
          bgNoise: false, audioEQ: false, audioCompress: false,
          rvcEnabled: false, hFlip: false,
          grainLevel: varGrain, hueRotate: varHue,
          colorShiftLevel: varColorLevel, zoomPct: varZoom,
        });
        if (recreateLogHandler) window.electronAPI.removeListener?.('video-recreate-log', recreateLogHandler);
        if (!recreateRes?.ok) throw new Error(`Recreate video bản ${vi} thất bại: ` + (recreateRes?.error || ''));
        const recreatedVideo = registerTemp(recreateRes.path);
        rfAddLog(`✅ Video tái tạo xong: ${recreatedVideo.split(/[/\\]/).pop()}`, 'success');

        // ── Mix TTS audio vào video ───────────────────────────────────────
        const step6 = rfSeparateVocals ? 7 : 6;
        rfProgress(step6, `🎬 Bước ${step6}/${totalStepsRf}: Ghép audio lồng tiếng${totalVariants > 1 ? ` bản ${vi}` : ''}...`);
        const mixedPath = registerTemp(`${tmpDir}\\rf_mixed_v${vi}_${Date.now()}.mp4`);
        let mixRes;
        // Khi rfSeparateVocals=true: LUÔN zero video audio để xóa giọng gốc
        // dù Demucs thành công hay thất bại — tránh 2 giọng phát cùng lúc
        const baseVideoVol = rfSeparateVocals ? 0 : rfVideoVol / 100;

        if (instrumentalPath && rfVideoVol > 0) {
          // Demucs thành công: video (muted) + TTS + nhạc nền tách ra
          mixRes = await window.electronAPI.mixAudio({
            videoPath: recreatedVideo, audioPath: ttsOutPath,
            extraAudioPath: instrumentalPath, extraAudioVol: rfVideoVol / 100,
            outputPath: mixedPath, videoVol: 0, audioVol: rfVoiceVol / 100
          });
        } else {
          // Demucs thất bại hoặc không bật: dùng videoVol tuỳ chế độ
          mixRes = await window.electronAPI.mixAudio({
            videoPath: recreatedVideo, audioPath: ttsOutPath,
            outputPath: mixedPath,
            videoVol: baseVideoVol,
            audioVol: rfVoiceVol / 100
          });
        }
        if (!mixRes?.success) throw new Error('Mix audio thất bại: ' + (mixRes?.error || ''));
        const bgDesc = instrumentalPath ? `nhạc nền ${rfVideoVol}%` : rfSeparateVocals ? 'tiếng gốc đã xóa' : `tiếng gốc ${rfVideoVol}%`;
        rfAddLog(`✅ Ghép audio: TTS ${rfVoiceVol}% + ${bgDesc}`, 'success');

        // ── Burn subtitle ─────────────────────────────────────────────────
        let finalPath = mixedPath;
        if (rfBurnSub) {
          rfProgress(7, `📝 Bước 7/${totalStepsRf}: Chèn phụ đề${totalVariants > 1 ? ` bản ${vi}` : ''}...`);
          const srtContent = translatedSegs.map((seg, i) =>
            `${i+1}\n${msToSrt(seg.startMs)} --> ${msToSrt(seg.endMs)}\n${seg.text}\n`
          ).join('\n');
          const burnedPath = `${tmpDir}\\rf_final_v${vi}_${Date.now()}.mp4`;
          const burnRes = await window.electronAPI.burnSubtitles({
            videoPath: mixedPath, srtContent,
            outputPath: burnedPath, outputFolder: tmpDir,
            style: { effect: 'outline', fontSize: 18, position: 'bottom', color: 'white' }
          });
          if (burnRes?.success) {
            finalPath = burnedPath;
            rfAddLog('✅ Phụ đề đã chèn vào video', 'success');
          } else {
            rfAddLog('⚠️ Chèn sub thất bại, dùng video không có sub', 'error');
          }
        }

        // Đổi tên file cuối → <tên gốc>_reup.mp4 hoặc _reup_v1.mp4
        const suffix = totalVariants > 1 ? `_reup_v${vi}` : '_reup';
        const outFilePath = `${vFolder}\\${srcBase}${suffix}.mp4`;
        // Xóa finalPath khỏi danh sách temp TRƯỚC khi rename — tránh bị xóa trong cleanup
        const finalIdx = tempFiles.indexOf(finalPath);
        if (finalIdx !== -1) tempFiles.splice(finalIdx, 1);
        // Rename/copy sang tên cuối
        const renameRes = await window.electronAPI.renameFile?.({ from: finalPath, to: outFilePath }).catch(() => null);
        const savedPath = renameRes?.success ? outFilePath : finalPath;
        savedPaths.push(savedPath);
        rfAddLog(`✅ Bản ${vi} hoàn tất: ${savedPath.split(/[/\\]/).pop()}`, 'success');
        setResultPath(savedPath);
        setPreviewUrl(`file:///${encodeURI(savedPath.replace(/\\/g, '/'))}`);
      }

      // Giữ tất cả file output khỏi bị xóa trong cleanup
      const tempFilesFiltered = tempFiles.filter(p => !savedPaths.includes(p));
      rfAddLog(`🎉 Hoàn tất${totalVariants > 1 ? ` ${totalVariants} bản` : ''}!`, 'success');

    } catch(e) {
      rfAddLog('❌ Lỗi: ' + e.message, 'error');
      var tempFilesFiltered = [...tempFiles];
    } finally {
      const toDelete = (typeof tempFilesFiltered !== 'undefined' ? tempFilesFiltered : tempFiles)
        .filter(p => !savedPaths?.includes(p)); // không bao giờ xóa file output
      for (const p of toDelete) {
        try { await window.electronAPI.deleteFile(p); } catch(_) {}
      }
      setRfRunning(false);
      setRfStep({ cur: 0, total: 0, label: '' });
    }
    return savedPaths;
  };

  const buildRecreateParams = (vPath, subFolder) => ({
    videoPath: vPath, outputFolder: subFolder,
    zoomPct, apply4K,
    channelName: wmEnabled ? wmText.trim() : '',
    wmOpacity, wmCycle,
    varSpeed, varSpeedLevel, pitchShift, stereoFlip,
    bgNoise, bgNoiseLevel, bgNoiseFile, bgNoiseColor,
    audioVolume, kenBurns, randomCut, hFlip,
    grainNoise, grainLevel, randomMeta, gpuMode,
    colorShift, colorShiftLevel, randomPosCrop, randomFps,
    slightRotate, hueRotate, audioEQ,
    subRemove, subHeight, subWidth, subHOffset, subPosition, subStyle,
    vignette, videoPad, audioCompress,
    audioReverb, audioChorus, brightnessJitter,
    colorChannelShift, temporalBlend, perspectiveWarp, audioDither,
    rvcEnabled, rvcModelPath, rvcIndexPath, rvcPitch, rvcF0Method,
    targetDurEnabled, targetDurMinutes,
    outputResolution,
    trimStart, trimEnd,
  });

  // Chạy SEO tự động từ URL song song với quá trình tái tạo video
  const runSeoFromUrl = async () => {
    const u = sourceUrl.trim();
    if (!u) return;
    const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
    if (!apiKeys.length) { setSeoError('Chưa có Gemini API Key. Vào Cài đặt để thêm key.'); return; }
    setSeoLoading(true); setSeoResult(null); setSeoError(''); setSeoThumbImgs({}); setSeoThumbIdx(0);
    try {
      let content = `URL: ${u}`;
      let channel = '';
      try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000));
        const info = await Promise.race([window.electronAPI?.downloaderInfo?.(u), timeout]);
        if (info?.success && info.data) {
          const { title = '', channel: ch = '' } = info.data;
          channel = ch;
          content = `Tiêu đề gốc: ${title}\nKênh: ${ch}`;
        }
      } catch (_) { /* lấy info thất bại hoặc timeout → vẫn tạo SEO từ URL */ }
      const onSeoKeySwitch = ({ fromIdx, toIdx, total, reason }) =>
        addLog(`[SEO] Xoay key ${fromIdx+1}→${toIdx+1}/${total} (${reason})`, 'progress');
      const seoDeadline = new Promise((_, rej) => setTimeout(() => rej(new Error('Tạo SEO quá thời gian (2 phút). Thử lại sau.')), 120000));
      const res = await Promise.race([generateSeoMetadata(apiKeys, content, seoLang, '', onSeoKeySwitch, null), seoDeadline]);
      setSeoResult(res); setSeoThumbIdx(0);
    } catch (e) {
      setSeoError(e?.message || 'Lỗi tạo SEO');
    } finally {
      setSeoLoading(false);
    }
  };

  const runRegenThumb = async () => {
    if (!seoResult) return;
    const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
    if (!apiKeys.length) return;
    setThumbRegenLoading(true); setSeoThumbImgs({}); setSeoThumbIdx(0);
    try {
      const t0 = seoResult.titles?.[0];
      const t0text = typeof t0 === 'object' ? t0?.title : t0;
      const content = t0text
        ? `Tiêu đề: ${t0text}\nMô tả: ${(seoResult.description || '').slice(0, 300)}`
        : (seoResult.summary || seoResult.description || '').slice(0, 400);
      const channel = '';
      const onSwitch = ({ fromIdx, toIdx, total, reason }) => addLog(`[Thumb Prompt] Xoay key ${fromIdx+1}→${toIdx+1}/${total} (${reason})`, 'progress');
      const res = await generateThumbnailPromptsOnly(apiKeys, content, seoLang, channel, onSwitch);
      setSeoResult(prev => ({ ...prev, thumbnailPrompts: res.thumbnailPrompts }));
    } catch (e) {
      // silent — user sees no change
    } finally {
      setThumbRegenLoading(false);
    }
  };

  // Thumbnail AI: lấy thumb YouTube → phân tích Gemini Vision → tạo prompt → vẽ Veo
  const runAiThumb = async (step = 'all') => {
    const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
    if (!apiKeys.length) { setAiThumbErr('Chưa có Gemini API Key.'); return; }
    setAiThumbErr(''); setAiThumbLoading(true);
    try {
      let imageBase64 = null; let mime = 'image/jpeg';
      // Bước 1: lấy thumbnail YouTube
      if (step === 'all' || step === 'fetch') {
        setAiThumbMsg('Đang lấy thumbnail gốc từ YouTube...');
        const vid = sourceUrl.match(/(?:youtu\.be\/|v\/|watch\?v=|&v=)([^#&?]{11})/)?.[1];
        if (!vid) throw new Error('Không tìm thấy video ID trong URL. Nhập URL YouTube.');
        const qualities = ['maxresdefault', 'sddefault', 'hqdefault'];
        for (const q of qualities) {
          try {
            const r = await fetch(`https://img.youtube.com/vi/${vid}/${q}.jpg`);
            if (r.ok) {
              const buf = await r.arrayBuffer();
              imageBase64 = `data:image/jpeg;base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
              break;
            }
          } catch (_) {}
        }
        if (!imageBase64) throw new Error('Không lấy được thumbnail YouTube.');
      }
      // Bước 2: phân tích ảnh → prompt
      if (step === 'all' || step === 'analyze') {
        if (!imageBase64 && step === 'analyze') throw new Error('Chưa có ảnh để phân tích.');
        setAiThumbMsg('AI đang phân tích ảnh & tạo prompt...');
        const onThumbSwitch = ({ fromIdx, toIdx, total, reason }) => addLog(`[Thumb AI] Xoay key ${fromIdx+1}→${toIdx+1}/${total} (${reason})`, 'progress');
        const prompt = await analyzeThumbImageToPrompt(apiKeys, imageBase64 || '', mime, aiThumbRemText, null, onThumbSwitch);
        setAiThumbPrompt(prompt);
        if (step === 'analyze') { setAiThumbLoading(false); setAiThumbMsg(''); return; }
      }
      // Bước 3: vẽ ảnh bằng Veo
      if (step === 'draw' || step === 'all') {
        const prompt = step === 'draw' ? aiThumbPrompt : (await (async () => {
          // đã set trong bước 2 rồi — đọc từ state qua ref hoặc local var
          return aiThumbPrompt; // đây sẽ là giá trị cũ nếu step==='all', nhưng bước 2 vừa setAiThumbPrompt
        })());
        const finalPrompt = step === 'draw' ? aiThumbPrompt : aiThumbPrompt; // dùng state
        if (!finalPrompt && step === 'draw') { setAiThumbErr('Chưa có prompt. Chạy Phân tích trước.'); setAiThumbLoading(false); return; }
        const folder = aiThumbFolder || await (async () => {
          const f = await window.electronAPI?.selectFolder?.();
          if (f) { setAiThumbFolder(f); localStorage.setItem('fluxy_thumb_folder', f); }
          return f;
        })();
        if (!folder) { setAiThumbErr('Chưa chọn thư mục lưu ảnh.'); setAiThumbLoading(false); return; }
        setAiThumbMsg('Đang vẽ thumbnail (Nano Banana Pro)...');
        setAiThumbImg(null);
        const taskId = `reup_thumb_${Date.now()}`;
        const result = await window.electronAPI.runVeo({
          mediaType: 'Image',
          tasks: [{ id: taskId, prompt: `${finalPrompt}, no text overlay, no watermark, 16:9 thumbnail, high quality.` }],
          aspectRatio: '16:9', model: 'Nano Banana Pro', genCount: '1x', quality: '1080p', outputFolder: folder, duration: null,
        });
        const file = (result?.files || []).find(f => !f.isError && f.filePath);
        if (!file) throw new Error(result?.files?.[0]?.error || 'Không tạo được ảnh.');
        const raw = await window.electronAPI.readFileBase64?.(file.filePath);
        if (raw) setAiThumbImg(`data:image/png;base64,${raw}`);
      }
    } catch (e) { setAiThumbErr(e.message || 'Lỗi'); }
    finally { setAiThumbLoading(false); setAiThumbMsg(''); }
  };

  const doStart = async () => {
    if (running) return;
    // Review Phim + lồng tiếng tự động → chạy pipeline riêng
    if (presetMode === 'review' && rfEnabled) { runReviewFilm(); return; }
    // Chạy SEO + Thumbnail AI song song (không chờ — fire and forget)
    if (sourceUrl.trim()) {
      runSeoFromUrl();
      runAiThumb('all');
    }
    if (batchMode) {
      if (!batchFolder || batchQueue.length === 0 || !outFolder) return;
      batchStopRef.current = false;
      setRunning(true); setLogs([]); setResultPath(null); setPreviewUrl(null); setBatchDonePaths([]); setStep(''); setStepNum(0);
      // Reset queue status
      setBatchQueue(q => q.map(item => ({ ...item, status: 'pending' })));

      const handler = (data) => {
        const { msg, type, stepNum: sn } = data;
        if (sn !== undefined) setStepNum(sn);
        if (msg) addLog(msg, type || 'info');
      };
      window.electronAPI?.onVideoRecreatLog?.(handler);

      let lastPath = null;
      for (let i = 0; i < batchQueue.length; i++) {
        if (batchStopRef.current) {
          addLog('⛔ Đã dừng hàng loạt.', 'error');
          setBatchQueue(q => q.map((item, idx) => idx >= i ? { ...item, status: 'skipped' } : item));
          break;
        }
        const item = batchQueue[i];
        setBatchIdx(i);
        setBatchQueue(q => q.map((it, idx) => idx === i ? { ...it, status: 'running' } : it));
        setStepNum(0); setStep('');
        const nameNoExt = item.name.replace(/\.[^/.]+$/, '');
        // Subfolder = outFolder/tên_video_gốc
        const subFolder = `${outFolder}/${nameNoExt}`;
        await window.electronAPI.createFolder(subFolder);
        const totalOutputs = multiCount > 1 ? multiCount : 1;
        addLog(`\n📦 [${i + 1}/${batchQueue.length}] Bắt đầu: ${item.name}${totalOutputs > 1 ? ` — ${totalOutputs} bản` : ''}`, 'info');
        try {
          let actualPath = item.path;
          let batchSepDir = null;
          if (removeBgMusic && presetMode === 'normal') {
            addLog('🎵 Tách nhạc nền...', 'info');
            const sepRes = await window.electronAPI.separateVocals({ inputPath: item.path, outputDir: subFolder });
            if (sepRes?.success && sepRes?.tempVideo) {
              actualPath = sepRes.tempVideo;
              batchSepDir = sepRes.sepDir;
              addLog('✅ Tách nhạc xong', 'success');
            } else {
              addLog(`⚠️ Tách nhạc thất bại: ${sepRes?.error || ''} — dùng audio gốc`, 'warn');
            }
          }

          let cachedLogoRegions = null, cachedImgW = null, cachedImgH = null;
          let anyDone = false;

          for (let vi = 0; vi < totalOutputs; vi++) {
            if (batchStopRef.current) break;
            const profile = totalOutputs > 1 ? MULTI_PROFILES[vi % MULTI_PROFILES.length] : {};
            const srcBase = nameNoExt.slice(0, 80);
            const outputFileName = totalOutputs > 1
              ? `${srcBase}_reup_${String(vi + 1).padStart(2, '0')}.mp4`
              : `${srcBase}_reup.mp4`;
            if (totalOutputs > 1) addLog(`  🎬 Bản ${vi + 1}/${totalOutputs}...`, 'info');
            const params = {
              ...buildRecreateParams(actualPath, subFolder),
              ...profile,
              outputFileName,
              ...(cachedLogoRegions !== null && {
                preDetectedLogoRegions: cachedLogoRegions,
                preDetectedImgW: cachedImgW,
                preDetectedImgH: cachedImgH,
              }),
            };
            const res = await window.electronAPI.videoRecreate(params);
            if (vi === 0 && res?.logoRegions !== undefined) {
              cachedLogoRegions = res.logoRegions;
              cachedImgW = res.detectedImgW ?? null;
              cachedImgH = res.detectedImgH ?? null;
            }
            if (res?.ok && res?.path) {
              lastPath = res.path; anyDone = true;
              addLog(`  ✅ ${totalOutputs > 1 ? `Bản ${vi + 1}: ` : ''}${res.path.split(/[/\\]/).pop()}`, 'success');
              setBatchDonePaths(prev => [...prev, res.path]);
              setResultPath(res.path);
              setPreviewUrl(`file:///${encodeURI(res.path.replace(/\\/g, '/'))}`);
            } else {
              addLog(`  ❌ ${totalOutputs > 1 ? `Bản ${vi + 1} ` : ''}lỗi: ${res?.error || 'Không rõ'}`, 'error');
            }
          }

          if (batchSepDir) { try { await window.electronAPI.deleteTempDir?.(batchSepDir); } catch (_) {} }
          if (anyDone) {
            addLog(`✅ [${i + 1}/${batchQueue.length}] Xong${totalOutputs > 1 ? ` (${totalOutputs} bản)` : ''}: ${subFolder}`, 'success');
            setBatchQueue(q => q.map((it, idx) => idx === i ? { ...it, status: 'done' } : it));
          } else {
            setBatchQueue(q => q.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
          }
        } catch(e) {
          addLog(`❌ [${i + 1}/${batchQueue.length}] ${e.message}`, 'error');
          setBatchQueue(q => q.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
        }
      }

      window.electronAPI?.removeAllListeners?.('video-recreate-log');
      setBatchIdx(-1);
      if (lastPath) { setResultPath(lastPath); setStep('✅ Hàng loạt hoàn tất!'); setStepNum(5); }
      else setStep('⛔ Kết thúc');
      setRunning(false);
    } else {
      if (!videoFile || !outFolder) return;
      setRunning(true); setLogs([]); setResultPath(null); setPreviewUrl(null); setStep(''); setStepNum(0);
      const handler = (data) => {
        const { msg, type, stepNum: sn, step: s } = data;
        if (sn !== undefined) setStepNum(sn);
        if (s) setStep(s);
        if (msg) addLog(msg, type || 'info');
      };
      window.electronAPI?.onVideoRecreatLog?.(handler);
      // Tách nhạc nền 1 lần, dùng cho tất cả bản output
      let actualVideoFile = videoFile;
      let sepTempDir = null;
      try {
        if (removeBgMusic) {
          addLog('🎵 Đang tách nhạc nền bằng Demucs htdemucs_ft (lần đầu tải model ~400MB)...', 'info');
          setStep('🎵 Tách nhạc nền...');
          const sepRes = await window.electronAPI.separateVocals({ inputPath: videoFile, outputDir: outFolder });
          if (sepRes?.success && sepRes?.tempVideo) {
            actualVideoFile = sepRes.tempVideo; sepTempDir = sepRes.sepDir;
            addLog('✅ Tách nhạc xong', 'success');
          } else {
            addLog(`⚠️ Tách nhạc thất bại — dùng audio gốc`, 'warn');
          }
        }

        const totalOutputs = multiCount > 1 ? multiCount : 1;
        const donePaths = [];
        // Cache logo detection từ bản đầu tiên, các bản sau dùng lại
        let cachedLogoRegions = null;
        let cachedImgW = null;
        let cachedImgH = null;

        for (let vi = 0; vi < totalOutputs; vi++) {
          if (batchStopRef.current) { addLog('⛔ Đã dừng.', 'error'); break; }

          // Subfolder riêng cho mỗi bản khi multi-output
          const subFolder = totalOutputs > 1
            ? `${outFolder}/ban_${String(vi + 1).padStart(2, '0')}`
            : outFolder;
          if (totalOutputs > 1) {
            await window.electronAPI.createFolder(subFolder);
            addLog(`\n🎬 [${vi + 1}/${totalOutputs}] Tạo bản #${vi + 1}...`, 'info');
            setStep(`🎬 Bản ${vi + 1}/${totalOutputs}...`); setStepNum(0);
          }

          // Lấy variation profile — override các params khác nhau giữa các bản
          const profile = totalOutputs > 1 ? MULTI_PROFILES[vi % MULTI_PROFILES.length] : {};
          const srcBase = actualVideoFile.split(/[/\\]/).pop().replace(/\.[^.]+$/, '').slice(0, 80);
          const outputFileName = totalOutputs > 1
            ? `${srcBase}_reup_${String(vi + 1).padStart(2, '0')}.mp4`
            : `${srcBase}_reup.mp4`;
          const params = {
            ...buildRecreateParams(actualVideoFile, subFolder),
            ...profile,
            outputFileName,
            // Bản 2+ dùng lại kết quả detect logo từ bản 1 — bỏ qua detect lại
            ...(cachedLogoRegions !== null && {
              preDetectedLogoRegions: cachedLogoRegions,
              preDetectedImgW: cachedImgW,
              preDetectedImgH: cachedImgH,
            }),
          };

          const res = await window.electronAPI.videoRecreate(params);
          // Lưu kết quả detect từ bản đầu cho các bản sau
          if (vi === 0 && res?.logoRegions !== undefined) {
            cachedLogoRegions = res.logoRegions;
            cachedImgW = res.detectedImgW ?? null;
            cachedImgH = res.detectedImgH ?? null;
          }
          if (res?.ok && res?.path) {
            donePaths.push(res.path);
            if (totalOutputs === 1) {
              setResultPath(res.path);
              setPreviewUrl(`file:///${encodeURI(res.path.replace(/\\/g, '/'))}`);
              setStep('✅ Hoàn tất!'); setStepNum(5);
              addLog(`🎉 Xong! File: ${res.path}`, 'success');
            } else {
              addLog(`✅ Bản #${vi + 1} xong: ${res.path.split(/[/\\]/).pop()}`, 'success');
            }
          } else {
            addLog(`❌ Bản #${vi + 1} lỗi: ${res?.error || 'Không rõ'}`, 'error');
          }
        }

        if (totalOutputs > 1 && donePaths.length > 0) {
          setBatchDonePaths(donePaths);
          setResultPath(donePaths[0]);
          setPreviewUrl(`file:///${encodeURI(donePaths[0].replace(/\\/g, '/'))}`);
          setStep(`✅ Hoàn tất ${donePaths.length}/${totalOutputs} bản!`); setStepNum(5);
          addLog(`\n🎉 Multi-Output xong: ${donePaths.length} bản trong "${outFolder}"`, 'success');
        }
      } catch(e) {
        addLog(`❌ ${e.message}`, 'error'); setStep('❌ Lỗi');
      } finally {
        if (sepTempDir) { try { await window.electronAPI.deleteTempDir?.(sepTempDir); } catch (_) {} }
        window.electronAPI?.removeAllListeners?.('video-recreate-log');
        setRunning(false);
      }
    }
  };

  // Khi tải video từ YT xong → set vào videoFile để reup ngay
  const onYtVideoReady = (outputPath, title) => {
    setVideoFile(outputPath);
    setMainTab('recreate');
    addLog(`📺 Đã tải: ${title || outputPath.split(/[/\\]/).pop()} → sẵn sàng reup`, 'success');
  };

  // ── Batch tự động: tải + reup toàn bộ video chọn từ YT channel ─────────────
  // ── Bilibili Reup Batch ─────────────────────────────────────────────────────
  const runBilibiliBatch = async (videosArr, mode, batchOutFolder) => {
    const effectiveOutFolder = batchOutFolder || outFolder;
    if (!effectiveOutFolder) { alert('Chọn thư mục lưu video trước!'); return; }
    setBiliPausedQueue([]);
    setBiliBatchRunning(true);
    setBiliBatchLogs([]);
    setBiliBatchProgress({ cur: 0, total: videosArr.length });
    biliBatchStopRef.current = false;
    setRunning(true);
    setResultPath(null);
    const donePaths = [];
    const apiKeysForSeo = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');

    const handler = (data) => {
      const { msg, type, stepNum: sn } = data;
      if (sn !== undefined) setStepNum(sn);
      if (msg) addBiliLog(msg, type || 'info');
    };
    window.electronAPI?.onVideoRecreatLog?.(handler);

    addBiliLog(`🚀 Bắt đầu Bilibili batch [${mode.toUpperCase()}] — ${videosArr.length} video`, 'info');

    const writeSeoTxt = async (outputVideoPath, seoData, aiThumb, variantIdx, totalVariants) => {
      if (!outputVideoPath) return;
      try {
        const titles    = seoData?.titles || [];
        const thumbObjs = seoData?.thumbnailPrompts || [];
        const tagsRaw   = typeof seoData?.tags === 'string' ? seoData.tags : (seoData?.tags || []).join(', ');
        const tagsStr   = tagsRaw.length > 500 ? tagsRaw.slice(0, 497) + '...' : tagsRaw;
        const description = seoData?.description || '';
        const n       = Math.max(titles.length, 1);
        const nt      = Math.max(thumbObjs.length, 1);
        const titleRaw= titles[variantIdx % n]    || titles[0] || '';
        const title   = typeof titleRaw === 'object' ? titleRaw.title : titleRaw;
        const thumbObj= thumbObjs[variantIdx % nt] || thumbObjs[0] || null;
        const vLabel  = totalVariants > 1 ? ` — Bản ${variantIdx + 1}/${totalVariants}` : '';
        const lines   = [
          `================================================================`,
          `  METADATA YOUTUBE${vLabel}`,
          `================================================================`,
          ``, `📌 TIÊU ĐỀ:`, title,
          ``, `📝 MÔ TẢ / SEO DESCRIPTION:`, description,
          ``, `🏷️ TAGS (≤500 ký tự):`, tagsStr,
        ];
        if (thumbObj) {
          lines.push('', `🖼️ THUMBNAIL CONCEPT: ${thumbObj.concept || ''}`);
          if (thumbObj.promptWithText)    lines.push(`  ▸ Prompt CÓ chữ:    ${thumbObj.promptWithText}`);
          if (thumbObj.promptWithoutText) lines.push(`  ▸ Prompt KHÔNG chữ: ${thumbObj.promptWithoutText}`);
          if (thumbObj.textOnImage)       lines.push(`  ▸ Chữ trên ảnh:     ${thumbObj.textOnImage}`);
        }
        if (aiThumb) { lines.push('', `🎨 THUMBNAIL PROMPT:`, aiThumb); }
        lines.push('', `----------------------------------------------------------------`,
          `📂 Video: ${outputVideoPath.split(/[/\\]/).pop()}`,
          `📅 Tạo lúc: ${new Date().toLocaleString('vi-VN')}`);
        const txtPath = outputVideoPath.replace(/\.[^.]+$/, '') + '_metadata.txt';
        await window.electronAPI.writeTextFile({ filePath: txtPath, content: lines.join('\n') });
        addBiliLog(`📄 Metadata → ${txtPath.split(/[/\\]/).pop()}`, 'success');
      } catch (e) { addBiliLog(`⚠️ Ghi metadata thất bại: ${e.message}`, 'warn'); }
    };

    for (let i = 0; i < videosArr.length; i++) {
      if (biliBatchStopRef.current) {
        const remaining = videosArr.slice(i);
        setBiliPausedQueue(remaining);
        addBiliLog(`⏸ Đã tạm dừng — còn ${remaining.length} video chưa xử lý. Bấm "Tiếp tục" để tiếp.`, 'warn');
        break;
      }
      // Lưu checkpoint: nếu app crash giữa video này, lần sau sẽ resume từ đây
      localStorage.setItem('fluxy_bili_paused_queue', JSON.stringify(videosArr.slice(i)));
      const v = videosArr[i];
      setBiliBatchProgress({ cur: i + 1, total: videosArr.length, thumbnail: v.thumbnail, title: v.title, step: 'download' });
      addBiliLog(`\n📥 [${i+1}/${videosArr.length}] Tải: ${v.title}`, 'info');

      // Download bilibili
      const dl = await window.electronAPI?.bilibiliDownload?.({
        url: v.url, outputFolder: effectiveOutFolder, quality: 'best', bvid: v.bvid || v.id
      });
      if (!dl?.success) { addBiliLog(`❌ Tải thất bại: ${dl?.error || ''}`, 'error'); continue; }
      const videoPath = dl.outputPath;
      addBiliLog(`✅ Tải xong: ${videoPath.split(/[/\\]/).pop()}`, 'success');

      // Subfolder
      const nameNoExt = v.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 60).trim() || `bili_${i+1}`;
      const subFolder = `${effectiveOutFolder}\\${nameNoExt}`;
      await window.electronAPI?.createFolder?.(subFolder);

      // Lấy thumbnail bilibili (từ URL CDN) + video info
      let videoContent = `URL: ${v.url}\nTiêu đề gốc: ${v.title}\n\n[REUP VIDEO — BẮT BUỘC: Tạo SEO BÁM SÁT ĐÚNG chủ đề video này. TUYỆT ĐỐI KHÔNG bịa nội dung khác không có trong tiêu đề. Tiêu đề SEO phải phản ánh CHÍNH XÁC nội dung: "${v.title}"]`;
      let thumbImageBase64 = null;

      const infoAndThumbFetchPromise = (async () => {
        if (!apiKeysForSeo.length) return;
        try {
          if (v.thumbnail) {
            try {
              const r = await fetch(v.thumbnail);
              if (r.ok) {
                const buf = await r.arrayBuffer();
                const mime = r.headers.get('content-type') || 'image/jpeg';
                thumbImageBase64 = `data:${mime};base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
              }
            } catch (_) {}
          }
        } catch (e) { addBiliLog(`⚠️ Tải thumbnail: ${e.message}`, 'warn'); }
      })();

      setBiliBatchProgress(p => ({ ...p, step: 'process' }));
      addBiliLog(`⚙️ Chạy pipeline [${mode}]...`, 'info');

      const processVariantSeoThumb = async (outPath, variantIdx, totalOutputs, varFolderPath) => {
        let varSeoData = null;
        let varThumbPrompt = '';
        if (!apiKeysForSeo.length) { await writeSeoTxt(outPath, null, '', 0, 1); return; }
        const banLabel = totalOutputs > 1 ? `bản ${variantIdx+1}/${totalOutputs}` : 'video';
        await infoAndThumbFetchPromise;
        try {
          setBiliBatchProgress(p => ({ ...p, step: 'seo' }));
          addBiliLog(`🔍 SEO ${banLabel}...`, 'info');
          const onSeoKey = ({ fromIdx, toIdx, total }) =>
            addBiliLog(`[SEO] Xoay key ${fromIdx+1}→${toIdx+1}/${total}`, 'info');
          varSeoData = await Promise.race([
            generateSeoMetadata(apiKeysForSeo, videoContent, seoLang, '', onSeoKey, null),
            new Promise((_, rej) => setTimeout(() => rej(new Error('SEO timeout')), 120000)),
          ]);
          addBiliLog(`✅ SEO ${banLabel}: "${(typeof (varSeoData?.titles||[])[0] === 'object' ? (varSeoData?.titles||[])[0]?.title : (varSeoData?.titles||[])[0])?.slice(0,50)}"`, 'success');
        } catch (e) { addBiliLog(`⚠️ SEO ${banLabel} lỗi: ${e.message}`, 'warn'); }

        if (thumbImageBase64) {
          try {
            setBiliBatchProgress(p => ({ ...p, step: 'thumbnail' }));
            addBiliLog(`🖼️ Thumbnail AI ${banLabel}...`, 'info');
            const onThumbKey = ({ fromIdx, toIdx, total }) =>
              addBiliLog(`[Thumb AI] Xoay key ${fromIdx+1}→${toIdx+1}/${total}`, 'info');
            varThumbPrompt = await analyzeThumbImageToPrompt(
              apiKeysForSeo, thumbImageBase64, 'image/jpeg', false, null, onThumbKey
            );
            try {
              const taskId = `bili_thumb_${Date.now()}_${variantIdx}`;
              const veoResult = await window.electronAPI.runVeo({
                mediaType: 'Image',
                tasks: [{ id: taskId, prompt: `${varThumbPrompt}, no text overlay, no watermark, 16:9 thumbnail, high quality.` }],
                aspectRatio: '16:9', model: 'Nano Banana Pro', genCount: '1x', quality: '1080p',
                outputFolder: varFolderPath, duration: null,
              });
              const thumbFile = (veoResult?.files || []).find(f => !f.isError && f.filePath);
              if (thumbFile) addBiliLog(`✅ Thumbnail ${banLabel}: ${thumbFile.filePath.split(/[/\\]/).pop()}`, 'success');
              else addBiliLog(`⚠️ Thumbnail ${banLabel}: ${veoResult?.files?.[0]?.error || 'Không tạo được'}`, 'warn');
            } catch (e) { addBiliLog(`⚠️ Vẽ thumbnail ${banLabel} lỗi: ${e.message}`, 'warn'); }
          } catch (e) { addBiliLog(`⚠️ Thumbnail AI ${banLabel} lỗi: ${e.message}`, 'warn'); }
        }
        await writeSeoTxt(outPath, varSeoData, varThumbPrompt, variantIdx, totalOutputs);
      };

      try {
        const totalOutputs = mode === 'multi' ? Math.max(1, multiCount) : 1;
        let cachedLogoRegions = null, cachedImgW = null, cachedImgH = null;

        for (let vi = 0; vi < totalOutputs; vi++) {
          if (biliBatchStopRef.current) break;
          const profile = totalOutputs > 1 ? MULTI_PROFILES[vi % MULTI_PROFILES.length] : {};
          const varFolder = totalOutputs > 1 ? `${subFolder}\\Ban_${String(vi+1).padStart(2,'0')}` : subFolder;
          if (totalOutputs > 1) await window.electronAPI?.createFolder?.(varFolder);
          const outputFileName = `${nameNoExt.slice(0, 50)}_reup.mp4`;
          if (totalOutputs > 1) addBiliLog(`  🎬 Bản ${vi+1}/${totalOutputs}...`, 'info');

          const params = {
            ...buildRecreateParams(videoPath, varFolder),
            ...profile,
            outputFileName,
            ...(cachedLogoRegions !== null && {
              preDetectedLogoRegions: cachedLogoRegions,
              preDetectedImgW: cachedImgW,
              preDetectedImgH: cachedImgH,
            }),
          };
          const res = await window.electronAPI.videoRecreate(params);
          if (vi === 0 && res?.logoRegions !== undefined) {
            cachedLogoRegions = res.logoRegions;
            cachedImgW = res.detectedImgW ?? null;
            cachedImgH = res.detectedImgH ?? null;
          }
          if (res?.ok) {
            addBiliLog(`✅ Bản ${vi+1}: ${res.path?.split(/[/\\]/).pop()}`, 'success');
            donePaths.push(res.path);
            await processVariantSeoThumb(res.path, vi, totalOutputs, varFolder);
          } else {
            addBiliLog(`❌ Bản ${vi+1} lỗi: ${res?.error || ''}`, 'error');
          }
        }
      } catch (e) { addBiliLog(`❌ Pipeline lỗi: ${e.message}`, 'error'); }

      // Xóa file gốc
      try { await window.electronAPI.deleteFile(videoPath); addBiliLog(`🗑️ Xóa file gốc: ${videoPath.split(/[/\\]/).pop()}`, 'info'); } catch (_) {}
      addBiliLog(`✓ Hoàn tất [${i+1}/${videosArr.length}]: ${v.title}`, 'success');
    }

    setBatchDonePaths(donePaths);
    if (donePaths.length) setResultPath(donePaths[donePaths.length - 1]);
    window.electronAPI?.removeAllListeners?.('video-recreate-log');
    setBiliBatchRunning(false);
    setRunning(false);
    // Xóa checkpoint nếu hoàn tất bình thường (không bị dừng)
    if (!biliBatchStopRef.current) { setBiliPausedQueue([]); }
    addBiliLog(`\n🎉 Xong toàn bộ: ${donePaths.length}/${videosArr.length} video thành công`, 'success');
  };

  const runYtBatch = async (videosArr, mode, batchOutFolder) => {
    const effectiveOutFolder = batchOutFolder || outFolder;
    if (!effectiveOutFolder) { alert('Chọn thư mục lưu video trước!'); return; }
    setYtPausedQueue([]);
    setYtBatchRunning(true);
    setYtBatchLogs([]);
    setYtBatchProgress({ cur: 0, total: videosArr.length });
    ytBatchRunningRef.current = true;
    setRunning(true);
    setResultPath(null);
    setPreviewUrl(null);
    setBatchDonePaths([]);
    batchStopRef.current = false;

    const handler = (data) => {
      const { msg, type, stepNum: sn } = data;
      if (sn !== undefined) setStepNum(sn);
      if (msg) addYtLog(msg, type || 'info');
    };
    window.electronAPI?.onVideoRecreatLog?.(handler);

    addYtLog(`🚀 Bắt đầu batch ${mode.toUpperCase()} — ${videosArr.length} video`, 'info');
    const donePaths = [];
    const apiKeysForSeo = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');

    // ── Helper: ghi file TXT metadata cho 1 bản output ──────────────────────
    // seoData  = kết quả generateSeoMetadata (titles[], description, tags string, thumbnailPrompts[{concept,promptWithText,promptWithoutText,textOnImage}])
    // aiThumb  = prompt từ analyzeThumbImageToPrompt (phân tích ảnh gốc YouTube)
    const writeSeoTxt = async (outputVideoPath, seoData, aiThumb, variantIdx, totalVariants) => {
      if (!outputVideoPath) return;
      try {
        const titles    = seoData?.titles || [];
        const thumbObjs = seoData?.thumbnailPrompts || []; // array of {concept, promptWithText, promptWithoutText, textOnImage}
        const tagsRaw   = typeof seoData?.tags === 'string' ? seoData.tags : (seoData?.tags || []).join(', ');
        const tagsStr   = tagsRaw.length > 500 ? tagsRaw.slice(0, 497) + '...' : tagsRaw;
        const description = seoData?.description || '';

        // Mỗi bản dùng title + thumbnail concept khác nhau (xoay vòng)
        const n       = Math.max(titles.length, 1);
        const nt      = Math.max(thumbObjs.length, 1);
        const titleRaw= titles[variantIdx % n]    || titles[0] || '';
        const title   = typeof titleRaw === 'object' ? titleRaw.title : titleRaw;
        const thumbObj= thumbObjs[variantIdx % nt] || thumbObjs[0] || null;

        const vLabel  = totalVariants > 1 ? ` — Bản ${variantIdx + 1}/${totalVariants}` : '';
        const lines   = [
          `================================================================`,
          `  METADATA YOUTUBE${vLabel}`,
          `================================================================`,
          ``,
          `📌 TIÊU ĐỀ:`,
          title,
          ``,
          `📝 MÔ TẢ / SEO DESCRIPTION:`,
          description,
          ``,
          `🏷️ TAGS (≤500 ký tự):`,
          tagsStr,
        ];

        // Thumbnail concept của bản này
        if (thumbObj) {
          lines.push('');
          lines.push(`🖼️ THUMBNAIL CONCEPT: ${thumbObj.concept || ''}`);
          if (thumbObj.promptWithText)    { lines.push(`  ▸ Prompt CÓ chữ:    ${thumbObj.promptWithText}`); }
          if (thumbObj.promptWithoutText) { lines.push(`  ▸ Prompt KHÔNG chữ: ${thumbObj.promptWithoutText}`); }
          if (thumbObj.textOnImage)       { lines.push(`  ▸ Chữ trên ảnh:     ${thumbObj.textOnImage}`); }
        }

        // Prompt phân tích từ ảnh thumbnail gốc YouTube
        if (aiThumb) {
          lines.push('');
          lines.push(`🎨 THUMBNAIL PROMPT (phân tích từ thumbnail YouTube gốc):`);
          lines.push(aiThumb);
        }


        lines.push('');
        lines.push(`----------------------------------------------------------------`);
        lines.push(`📂 Video: ${outputVideoPath.split(/[/\\]/).pop()}`);
        lines.push(`📅 Tạo lúc: ${new Date().toLocaleString('vi-VN')}`);

        const txtPath = outputVideoPath.replace(/\.[^.]+$/, '') + '_metadata.txt';
        await window.electronAPI.writeTextFile({ filePath: txtPath, content: lines.join('\n') });
        addYtLog(`📄 Metadata → ${txtPath.split(/[/\\]/).pop()}`, 'success');
      } catch (e) {
        addYtLog(`⚠️ Ghi metadata thất bại: ${e.message}`, 'warn');
      }
    };

    for (let i = 0; i < videosArr.length; i++) {
      if (batchStopRef.current) {
        const remaining = videosArr.slice(i);
        setYtPausedQueue(remaining);
        addYtLog(`⏸ Đã tạm dừng — còn ${remaining.length} video chưa xử lý. Bấm "Tiếp tục" để tiếp.`, 'warn');
        break;
      }
      // Lưu checkpoint: nếu app crash giữa video này, lần sau sẽ resume từ đây
      localStorage.setItem('fluxy_yt_paused_queue', JSON.stringify(videosArr.slice(i)));
      const v = videosArr[i];
      setYtBatchProgress({ cur: i + 1, total: videosArr.length, thumbnail: v.thumbnail, title: v.title, step: 'download' });
      addYtLog(`\n📥 [${i+1}/${videosArr.length}] Tải: ${v.title}`, 'info');

      // Download
      const dl = await window.electronAPI?.ytDownloadBest?.({ url: v.url, outputDir: effectiveOutFolder, videoId: v.id, quality: downloadQuality });
      if (!dl?.success) {
        if (dl?.error === 'aborted' || batchStopRef.current) {
          const remaining = videosArr.slice(i);
          setYtPausedQueue(remaining);
          addYtLog(`⏸ Đã tạm dừng — còn ${remaining.length} video chưa xử lý. Bấm "Tiếp tục" để tiếp.`, 'warn');
          break;
        }
        addYtLog(`❌ Tải thất bại: ${dl?.error || ''}`, 'error'); continue;
      }
      const videoPath = dl.outputPath;
      addYtLog(`✅ Tải xong: ${videoPath.split(/[/\\]/).pop()}`, 'success');

      // Subfolder theo tên video
      const nameNoExt = v.title.replace(/[<>:"/\\|?*]/g, '').slice(0, 60).trim() || `video_${i+1}`;
      const subFolder = `${effectiveOutFolder}\\${nameNoExt}`;
      await window.electronAPI?.createFolder?.(subFolder);

      // ── Lấy info video + ảnh thumbnail — chạy 1 lần song song với encode ──────
      // Dùng title từ danh sách video làm fallback ngay từ đầu — tránh AI bịa khi downloaderInfo timeout
      const vTitleFallback = v.title || v.name || '';
      let videoContent = vTitleFallback
        ? `Tiêu đề gốc: ${vTitleFallback}\nURL: ${v.url}\n\n[REUP VIDEO — BẮT BUỘC: Tạo SEO BÁM SÁT ĐÚNG chủ đề video này. TUYỆT ĐỐI KHÔNG bịa nội dung khác. SEO phải phản ánh CHÍNH XÁC: "${vTitleFallback}"]`
        : `URL: ${v.url}`;
      let videoChannel = '';
      let thumbImageBase64 = null;

      const infoAndThumbFetchPromise = (async () => {
        if (!apiKeysForSeo.length) return;
        try {
          // 1. Lấy info video qua yt-dlp
          try {
            const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000));
            const info = await Promise.race([window.electronAPI?.downloaderInfo?.(v.url), timeout]);
            if (info?.success && info.data) {
              const { title: vTitle = '', channel: vCh = '' } = info.data;
              videoChannel = vCh;
              videoContent = `Tiêu đề gốc: ${vTitle}\nKênh: ${vCh}\n\n[REUP VIDEO — BẮT BUỘC: Tạo SEO BÁM SÁT ĐÚNG chủ đề video này. TUYỆT ĐỐI KHÔNG bịa nội dung khác (Minecraft, drama, story) không có trong tiêu đề. Tiêu đề SEO phải phản ánh CHÍNH XÁC nội dung: "${vTitle}"]`;
            }
          } catch (_) {}

          // 2. Tải ảnh thumbnail YouTube 1 lần (dùng lại cho tất cả bản)
          try {
            const vid = v.id || v.url.match(/(?:youtu\.be\/|v\/|watch\?v=|&v=)([^#&?]{11})/)?.[1];
            if (vid) {
              for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
                try {
                  const r = await fetch(`https://img.youtube.com/vi/${vid}/${q}.jpg`);
                  if (r.ok) {
                    const buf = await r.arrayBuffer();
                    thumbImageBase64 = `data:image/jpeg;base64,${btoa(String.fromCharCode(...new Uint8Array(buf)))}`;
                    break;
                  }
                } catch (_) {}
              }
            }
          } catch (e) {
            addYtLog(`⚠️ Tải thumbnail: ${e.message}`, 'warn');
          }
        } catch (e) {
          addYtLog(`⚠️ Lấy info video lỗi: ${e.message}`, 'warn');
        }
      })();

      setYtBatchProgress(p => ({ ...p, step: 'process', dlPct: 100 }));
      addYtLog(`⚙️ Chạy pipeline [${mode}]...`, 'info');

      // Helper: chạy SEO + thumbnail ngay sau khi 1 bản encode xong
      const processVariantSeoThumb = async (outPath, variantIdx, totalOutputs, varFolderPath) => {
        let varSeoData = null;
        let varThumbPrompt = '';
        if (!apiKeysForSeo.length) { await writeSeoTxt(outPath, null, '', 0, 1); return; }
        const banLabel = totalOutputs > 1 ? `bản ${variantIdx+1}/${totalOutputs}` : 'video';
        // Chờ info + ảnh thumbnail sẵn sàng (promise đã chạy song song, chờ nếu chưa xong)
        await infoAndThumbFetchPromise;
        // SEO
        try {
          setYtBatchProgress(p => ({ ...p, step: 'seo' }));
          addYtLog(`🔍 SEO ${banLabel}...`, 'info');
          const onSeoKey = ({ fromIdx, toIdx, total }) =>
            addYtLog(`[SEO] Xoay key ${fromIdx+1}→${toIdx+1}/${total}`, 'info');
          const seoDeadline = new Promise((_, rej) => setTimeout(() => rej(new Error('SEO timeout')), 120000));
          varSeoData = await Promise.race([
            generateSeoMetadata(apiKeysForSeo, videoContent, seoLang, '', onSeoKey, null),
            seoDeadline,
          ]);
          addYtLog(`✅ SEO ${banLabel}: "${(typeof (varSeoData?.titles||[])[0] === 'object' ? (varSeoData?.titles||[])[0]?.title : (varSeoData?.titles||[])[0])?.slice(0,50)}"`, 'success');
        } catch (e) {
          addYtLog(`⚠️ SEO ${banLabel} lỗi: ${e.message}`, 'warn');
        }
        // Thumbnail AI + vẽ ảnh
        if (thumbImageBase64) {
          try {
            setYtBatchProgress(p => ({ ...p, step: 'thumbnail' }));
            addYtLog(`🖼️ Thumbnail AI ${banLabel}...`, 'info');
            const onThumbKey = ({ fromIdx, toIdx, total }) =>
              addYtLog(`[Thumb AI] Xoay key ${fromIdx+1}→${toIdx+1}/${total}`, 'info');
            varThumbPrompt = await analyzeThumbImageToPrompt(
              apiKeysForSeo, thumbImageBase64, 'image/jpeg', false, null, onThumbKey
            );
            addYtLog(`✅ Thumbnail AI ${banLabel} xong, đang vẽ ảnh...`, 'success');
            try {
              const taskId = `yt_thumb_${Date.now()}_${variantIdx}`;
              addYtLog(`🖌️ Vẽ thumbnail ${banLabel}...`, 'info');
              const veoResult = await window.electronAPI.runVeo({
                mediaType: 'Image',
                tasks: [{ id: taskId, prompt: `${varThumbPrompt}, no text overlay, no watermark, 16:9 thumbnail, high quality.` }],
                aspectRatio: '16:9', model: 'Nano Banana Pro', genCount: '1x', quality: '1080p',
                outputFolder: varFolderPath, duration: null,
              });
              const thumbFile = (veoResult?.files || []).find(f => !f.isError && f.filePath);
              if (thumbFile) {
                addYtLog(`✅ Thumbnail ${banLabel}: ${thumbFile.filePath.split(/[/\\]/).pop()}`, 'success');
              } else {
                addYtLog(`⚠️ Thumbnail ${banLabel}: ${veoResult?.files?.[0]?.error || 'Không tạo được'}`, 'warn');
              }
            } catch (e) {
              addYtLog(`⚠️ Vẽ thumbnail ${banLabel} lỗi: ${e.message}`, 'warn');
            }
          } catch (e) {
            addYtLog(`⚠️ Thumbnail AI ${banLabel} lỗi: ${e.message}`, 'warn');
          }
        }
        await writeSeoTxt(outPath, varSeoData, varThumbPrompt, 0, 1);
      };

      try {
        if (mode === 'review') {
          const rfPaths = await runReviewFilm(videoPath, subFolder);
          if (Array.isArray(rfPaths)) rfPaths.forEach(p => p && donePaths.push(p));
        } else {
          const totalOutputs = mode === 'multi' ? Math.max(1, multiCount) : 1;
          let cachedLogoRegions = null, cachedImgW = null, cachedImgH = null;

          for (let vi = 0; vi < totalOutputs; vi++) {
            if (batchStopRef.current) break;
            const profile = totalOutputs > 1 ? MULTI_PROFILES[vi % MULTI_PROFILES.length] : {};
            // Mỗi bản multi có subfolder riêng: Ban_01, Ban_02, ...
            const varFolder = totalOutputs > 1
              ? `${subFolder}\\Ban_${String(vi+1).padStart(2,'0')}`
              : subFolder;
            if (totalOutputs > 1) await window.electronAPI?.createFolder?.(varFolder);
            const outputFileName = `${nameNoExt.slice(0, 50)}_reup.mp4`;
            if (totalOutputs > 1) addYtLog(`  🎬 Bản ${vi+1}/${totalOutputs}...`, 'info');

            const params = {
              ...buildRecreateParams(videoPath, varFolder),
              ...profile,
              outputFileName,
              ...(cachedLogoRegions !== null && {
                preDetectedLogoRegions: cachedLogoRegions,
                preDetectedImgW: cachedImgW,
                preDetectedImgH: cachedImgH,
              }),
            };
            const res = await window.electronAPI.videoRecreate(params);
            if (vi === 0 && res?.logoRegions !== undefined) {
              cachedLogoRegions = res.logoRegions;
              cachedImgW = res.detectedImgW ?? null;
              cachedImgH = res.detectedImgH ?? null;
            }
            if (res?.ok) {
              addYtLog(`✅ Bản ${vi+1}: ${res.path?.split(/[/\\]/).pop()}`, 'success');
              donePaths.push(res.path);
              // SEO + thumbnail ngay sau khi bản này xong, không chờ bản tiếp
              await processVariantSeoThumb(res.path, vi, totalOutputs, varFolder);
            } else {
              addYtLog(`❌ Bản ${vi+1} lỗi: ${res?.error || ''}`, 'error');
            }
          }
        }
      } catch (e) {
        addYtLog(`❌ Pipeline lỗi: ${e.message}`, 'error');
      }

      // Xóa file gốc tải về để giải phóng dung lượng
      try {
        await window.electronAPI.deleteFile(videoPath);
        addYtLog(`🗑️ Đã xóa file gốc: ${videoPath.split(/[/\\]/).pop()}`, 'info');
      } catch (_) {}

      // Mark done
      markVideoDone(v.id, v.title);
      addYtLog(`✓ Hoàn tất [${i+1}/${videosArr.length}]: ${v.title}`, 'success');
    }

    setBatchDonePaths(donePaths);
    if (donePaths.length) { setResultPath(donePaths[donePaths.length - 1]); }
    window.electronAPI?.removeAllListeners?.('video-recreate-log');
    ytBatchRunningRef.current = false;
    setYtBatchRunning(false);
    setRunning(false);
    // Xóa checkpoint nếu hoàn tất bình thường (không bị dừng)
    if (!batchStopRef.current) { setYtPausedQueue([]); }
    addYtLog(`\n🎉 Xong toàn bộ: ${donePaths.length}/${videosArr.length} video thành công`, 'success');
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-900 text-white">
      {/* TAB BAR — chỉ hiện tab phù hợp với mode */}
      {initialTab === 'recreate' ? null : (
        <div className="flex items-center gap-2 border-b border-slate-700/60 bg-[#060a12] shrink-0 px-4 py-2">
          {[
            { id: 'ytchannel',    label: 'Reup YouTube',  emoji: '📺', activeCls: 'bg-blue-600 text-white shadow-md',  inactiveCls: 'bg-blue-900/40 text-blue-300 hover:bg-blue-700 hover:text-white border border-blue-700/40' },
            { id: 'bilibili-reup', label: 'Reup Bilibili', emoji: '🔴', activeCls: 'bg-pink-600 text-white shadow-md', inactiveCls: 'bg-pink-900/40 text-pink-300 hover:bg-pink-700 hover:text-white border border-pink-700/40' },
          ].map(t => (
            <button key={t.id} onClick={() => setMainTab(t.id)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-black transition-all ${mainTab === t.id ? t.activeCls : t.inactiveCls}`}>
              <span className="text-[15px]">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* YT CHANNEL TAB */}
      {mainTab === 'ytchannel' && (
        <div className="flex-1 overflow-hidden">
          <YoutubeChannelFetcher
            onVideoReady={onYtVideoReady}
            onStartBatch={runYtBatch}
            onStopBatch={() => { batchStopRef.current = true; window.electronAPI?.abortYtDownload?.(); }}
            pausedQueue={ytPausedQueue}
            onClearPause={() => setYtPausedQueue([])}
            seoLang={seoLang}
            onSeoLangChange={setSeoLang}
            batchRunning={ytBatchRunning}
            batchLogs={ytBatchLogs}
            batchProgress={ytBatchProgress}
            multiCount={multiCount}
            setMultiCount={setMultiCount}
            trimStart={trimStart}
            setTrimStart={setTrimStart}
            trimEnd={trimEnd}
            setTrimEnd={setTrimEnd}
            targetDurEnabled={targetDurEnabled}
            setTargetDurEnabled={setTargetDurEnabled}
            targetDurMinutes={targetDurMinutes}
            setTargetDurMinutes={setTargetDurMinutes}
            outputResolution={outputResolution}
            setOutputResolution={setOutputResolution}
            downloadQuality={downloadQuality}
            setDownloadQuality={setDownloadQuality}
            rfTargetLang={rfTargetLang}
            rfTargetCode={rfTargetCode}
            setRfTargetLang={setRfTargetLang}
            setRfTargetCode={setRfTargetCode}
            rfVieNeuVoice={rfVieNeuVoice}
            rfVieNeuVoices={rfVieNeuVoices}
            setRfVieNeuVoice={setRfVieNeuVoice}
            rfEdgeVoice={rfEdgeVoice}
            rfEdgeVoices={rfEdgeVoices}
            setRfEdgeVoice={setRfEdgeVoice}
            rfTtsEngine={rfTtsEngine}
            setRfTtsEngine={setRfTtsEngine}
            rfGeminiVoice={rfGeminiVoice}
            setRfGeminiVoice={setRfGeminiVoice}
            rfBurnSub={rfBurnSub}
            setRfBurnSub={setRfBurnSub}
            rfVideoVol={rfVideoVol} setRfVideoVol={setRfVideoVol}
            rfVoiceVol={rfVoiceVol} setRfVoiceVol={setRfVoiceVol}
            rfSeparateVocals={rfSeparateVocals} setRfSeparateVocals={setRfSeparateVocals}
            rfMultiCount={rfMultiCount} setRfMultiCount={setRfMultiCount}
            varSpeed={varSpeed} setVarSpeed={setVarSpeed}
            varSpeedLevel={varSpeedLevel} setVarSpeedLevel={setVarSpeedLevel}
            pitchShift={pitchShift} setPitchShift={setPitchShift}
            hFlip={hFlip} setHFlip={setHFlip}
            colorShift={colorShift} setColorShift={setColorShift}
            colorShiftLevel={colorShiftLevel} setColorShiftLevel={setColorShiftLevel}
            zoomPct={zoomPct} setZoomPct={setZoomPct}
            grainNoise={grainNoise} setGrainNoise={setGrainNoise}
            grainLevel={grainLevel} setGrainLevel={setGrainLevel}
            stereoFlip={stereoFlip} setStereoFlip={setStereoFlip}
            bgNoise={bgNoise} setBgNoise={setBgNoise}
            bgNoiseLevel={bgNoiseLevel} setBgNoiseLevel={setBgNoiseLevel}
            kenBurns={kenBurns} setKenBurns={setKenBurns}
            randomCut={randomCut} setRandomCut={setRandomCut}
            wmEnabled={wmEnabled} setWmEnabled={setWmEnabled}
            wmText={wmText} setWmText={setWmText}
            gpuMode={gpuMode} setGpuMode={setGpuMode}
            audioVolume={audioVolume} setAudioVolume={setAudioVolume}
            slightRotate={slightRotate} setSlightRotate={setSlightRotate}
            hueRotate={hueRotate} setHueRotate={setHueRotate}
            randomFps={randomFps} setRandomFps={setRandomFps}
            randomPosCrop={randomPosCrop} setRandomPosCrop={setRandomPosCrop}
            audioEQ={audioEQ} setAudioEQ={setAudioEQ}
          />
        </div>
      )}

      {/* BILIBILI REUP TAB */}
      {mainTab === 'bilibili-reup' && (
        <div className="flex-1 overflow-hidden flex">
          <BilibiliReupPanel
            onStartBatch={runBilibiliBatch}
            onStopBatch={() => { biliBatchStopRef.current = true; }}
            pausedQueue={biliPausedQueue}
            onClearPause={() => setBiliPausedQueue([])}
            batchRunning={biliBatchRunning}
            batchLogs={biliBatchLogs}
            batchProgress={biliBatchProgress}
            seoLang={seoLang}
            onSeoLangChange={setSeoLang}
            multiCount={multiCount}
            setMultiCount={setMultiCount}
            trimStart={trimStart}
            setTrimStart={setTrimStart}
            trimEnd={trimEnd}
            setTrimEnd={setTrimEnd}
            targetDurEnabled={targetDurEnabled}
            setTargetDurEnabled={setTargetDurEnabled}
            targetDurMinutes={targetDurMinutes}
            setTargetDurMinutes={setTargetDurMinutes}
            outputResolution={outputResolution}
            setOutputResolution={setOutputResolution}
            varSpeed={varSpeed} setVarSpeed={setVarSpeed}
            varSpeedLevel={varSpeedLevel} setVarSpeedLevel={setVarSpeedLevel}
            pitchShift={pitchShift} setPitchShift={setPitchShift}
            hFlip={hFlip} setHFlip={setHFlip}
            colorShift={colorShift} setColorShift={setColorShift}
            colorShiftLevel={colorShiftLevel} setColorShiftLevel={setColorShiftLevel}
            zoomPct={zoomPct} setZoomPct={setZoomPct}
            grainNoise={grainNoise} setGrainNoise={setGrainNoise}
            grainLevel={grainLevel} setGrainLevel={setGrainLevel}
            stereoFlip={stereoFlip} setStereoFlip={setStereoFlip}
            bgNoise={bgNoise} setBgNoise={setBgNoise}
            bgNoiseLevel={bgNoiseLevel} setBgNoiseLevel={setBgNoiseLevel}
            kenBurns={kenBurns} setKenBurns={setKenBurns}
            randomCut={randomCut} setRandomCut={setRandomCut}
            wmEnabled={wmEnabled} setWmEnabled={setWmEnabled}
            wmText={wmText} setWmText={setWmText}
            gpuMode={gpuMode} setGpuMode={setGpuMode}
            audioVolume={audioVolume} setAudioVolume={setAudioVolume}
            slightRotate={slightRotate} setSlightRotate={setSlightRotate}
            hueRotate={hueRotate} setHueRotate={setHueRotate}
            randomFps={randomFps} setRandomFps={setRandomFps}
            randomPosCrop={randomPosCrop} setRandomPosCrop={setRandomPosCrop}
            audioEQ={audioEQ} setAudioEQ={setAudioEQ}
          />
        </div>
      )}

      {/* RECREATE TAB */}
      {mainTab === 'recreate' && <div className="flex flex-1 overflow-hidden">
      {/* LEFT */}
      <style>{`
        #recreate-left-panel * { font-size: max(var(--rlp-fs, inherit), 0px); }
        #recreate-left-panel .rlp-xs  { font-size: 11px !important; }
        #recreate-left-panel .rlp-sm  { font-size: 12px !important; }
        #recreate-left-panel .rlp-md  { font-size: 13px !important; }
        #recreate-left-panel .rlp-lg  { font-size: 14px !important; }
        #recreate-left-panel [class*="text-[6px]"]  { font-size: 10px !important; }
        #recreate-left-panel [class*="text-[7px]"]  { font-size: 11px !important; }
        #recreate-left-panel [class*="text-[8px]"]  { font-size: 12px !important; }
        #recreate-left-panel [class*="text-[9px]"]  { font-size: 13px !important; }
        #recreate-left-panel [class*="text-[10px]"] { font-size: 14px !important; }
        #recreate-left-panel [class*="text-[11px]"] { font-size: 15px !important; }
        #recreate-left-panel [class*="text-[12px]"] { font-size: 16px !important; }
        #recreate-left-panel [class*="text-[13px]"] { font-size: 17px !important; }
      `}</style>
      <div id="recreate-left-panel" className="w-1/4 flex-shrink-0 border-r border-slate-700/60 overflow-y-auto flex flex-col gap-3 p-4">
        <div className="text-xs font-black text-slate-400 uppercase tracking-widest">🎬 Tái Tạo Video</div>

        {/* URL nguồn — SEO & Thumbnail tự động */}
        <div className="flex flex-col gap-1.5 py-2 px-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">🔗 URL nguồn (SEO tự động)</div>
          <div className="flex gap-1">
            <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} disabled={running}
              placeholder="YouTube / TikTok URL..."
              className="flex-1 min-w-0 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-[9px] text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60 transition-all disabled:opacity-50"/>
            {sourceUrl && <button onClick={() => { setSourceUrl(''); setSeoResult(null); setSeoError(''); }} disabled={running}
              className="px-1.5 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-400 text-[9px] disabled:opacity-50">✕</button>}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[7px] text-slate-500 flex-1">Nhập link video gốc → ấn Bắt đầu → SEO + thumbnail tạo tự động song song</div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[7px] text-slate-500 font-bold">Ngôn ngữ SEO:</span>
              <select value={seoLang} onChange={e => setSeoLang(e.target.value)}
                className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[9px] text-slate-300 outline-none focus:border-blue-500/60">
                <option value="vi">🇻🇳 Tiếng Việt</option>
                <option value="en">🇺🇸 English</option>
                <option value="ja">🇯🇵 日本語</option>
                <option value="ko">🇰🇷 한국어</option>
              </select>
            </div>
          </div>
        </div>

        {/* PRESET MODE */}
        <div className="flex flex-col gap-1.5 py-2 px-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">⚡ Chế độ nhanh</div>
          <div className="flex gap-1.5">
            <button disabled={running} onClick={() => {
              // Preset Tái tạo thường — tất cả lớp lách Content ID, 1 bản
              setPitchShift(1); setVarSpeed(true); setVarSpeedLevel('medium');
              setStereoFlip(true); setAudioEQ(true); setAudioDither(true);
              setBgNoise(true); setBgNoiseLevel(1); setBgNoiseColor('pink');
              setAudioCompress(true); setAudioReverb(false); setAudioChorus(false);
              setAudioVolume(100);
              setRandomCut(true); setHFlip(true); setRandomFps(true);
              setColorShift(true); setColorShiftLevel('medium');
              setColorChannelShift(true); setRandomPosCrop(true);
              setApply4K(false); setZoomPct(5);
              setKenBurns('none');
              setGrainNoise(true); setGrainLevel(3);
              setVignette(true); setTemporalBlend(true);
              setPerspectiveWarp(false); setVideoPad(false);
              setSlightRotate(true); setHueRotate(true); setBrightnessJitter(true);
              setSubRemove(false); setRvcEnabled(false); setRemoveBgMusic(false);
              setRandomMeta(true);
              setPresetMode('normal'); setMultiCount(1);
            }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition ${presetMode === 'normal' && multiCount === 1 ? 'bg-purple-600 text-white ring-2 ring-purple-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
              🎬 Tái tạo thường
            </button>
            <button disabled={running} onClick={() => {
              // Preset Review Phim — lách Content ID + giọng rõ, không tiếng vang
              setAudioReverb(false); setAudioChorus(false);
              setRvcEnabled(false); setPitchShift(-2);
              setVarSpeed(true); setVarSpeedLevel('strong');
              setBgNoise(true); setBgNoiseLevel(2);
              setAudioCompress(true); setAudioEQ(true);
              setStereoFlip(true); setAudioVolume(100);
              setKenBurns('zoom-in'); setApply4K(true);
              setRandomCut(true); setSubRemove(true);
              setPresetMode('review'); setMultiCount(1);
            }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition ${presetMode === 'review' && multiCount === 1 ? 'bg-purple-600 text-white ring-2 ring-purple-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
              🎥 Review Phim
            </button>
            <button disabled={running} onClick={() => {
              // Multi-Output — tất cả lớp lách Content ID, nhiều bản
              setPresetMode('normal');
              setMultiCount(v => v < 2 ? 3 : v);
              // Audio
              setPitchShift(1); setVarSpeed(true); setVarSpeedLevel('medium');
              setStereoFlip(true); setAudioEQ(true); setAudioDither(true);
              setBgNoise(true); setBgNoiseLevel(1); setBgNoiseColor('pink');
              setAudioCompress(true); setAudioReverb(false); setAudioChorus(false);
              setAudioVolume(100);
              // Visual
              setRandomCut(true); setHFlip(true); setRandomFps(true);
              setColorShift(true); setColorShiftLevel('medium');
              setColorChannelShift(true); setRandomPosCrop(true);
              setApply4K(false); setZoomPct(5);
              setKenBurns('none');
              setGrainNoise(true); setGrainLevel(3);
              setVignette(true); setTemporalBlend(true);
              setPerspectiveWarp(false); setVideoPad(false);
              setSlightRotate(true); setHueRotate(true); setBrightnessJitter(true);
              setSubRemove(false); setRvcEnabled(false); setRemoveBgMusic(false);
              setRandomMeta(true);
            }}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition ${multiCount > 1 ? 'bg-orange-600 text-white ring-2 ring-orange-400' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
              🎬 Multi-Output
            </button>
          </div>
          {/* Bộ đếm số bản — chỉ hiện khi chọn Multi-Output */}
          {multiCount > 1 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-[8px] text-orange-400">Số bản tạo ra:</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setMultiCount(v => Math.max(2, v - 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 text-white text-[10px] font-bold hover:bg-slate-600 disabled:opacity-50 flex items-center justify-center">−</button>
                <span className="w-6 text-center text-[11px] font-black text-orange-400">{multiCount}</span>
                <button onClick={() => setMultiCount(v => Math.min(10, v + 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 text-white text-[10px] font-bold hover:bg-slate-600 disabled:opacity-50 flex items-center justify-center">+</button>
              </div>
            </div>
          )}
          <div className="text-[8px] text-slate-500">
            {multiCount > 1 ? '⚡ Pitch · Tempo · Stereo · EQ · Dither · ColorShift · RGB · Crop — đủ lách Content ID, tắt filter nặng để xử lý nhanh nhất' : presetMode === 'review' ? '🛡️ Pitch −2st + Tempo ±6% + EQ + Stereo Flip — lách Content ID mạnh cho phim' : '🌿 Đời thường: Pitch +2st + Tempo ±4% + EQ + Stereo Flip — đủ lách ContentID, âm thanh tự nhiên'}
          </div>
        </div>

        {/* CẮT ĐẦU / CUỐI VIDEO */}
        <div className="flex flex-col gap-1.5 p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/60">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">✂ Cắt Đầu / Cuối Video</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[9px] text-slate-400 shrink-0">Đầu:</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setTrimStart(v => Math.max(0, v - 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[10px] font-bold flex items-center justify-center">−</button>
                <input type="number" value={trimStart} min={0} max={300}
                  onChange={e => setTrimStart(Math.max(0, Math.min(300, Number(e.target.value))))}
                  className="w-12 text-center px-1 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-cyan-300 font-bold outline-none focus:border-cyan-500/60"/>
                <button onClick={() => setTrimStart(v => Math.min(300, v + 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[10px] font-bold flex items-center justify-center">+</button>
                <span className="text-[9px] text-slate-500">giây</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-[9px] text-slate-400 shrink-0">Cuối:</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setTrimEnd(v => Math.max(0, v - 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[10px] font-bold flex items-center justify-center">−</button>
                <input type="number" value={trimEnd} min={0} max={300}
                  onChange={e => setTrimEnd(Math.max(0, Math.min(300, Number(e.target.value))))}
                  className="w-12 text-center px-1 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-cyan-300 font-bold outline-none focus:border-cyan-500/60"/>
                <button onClick={() => setTrimEnd(v => Math.min(300, v + 1))} disabled={running}
                  className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[10px] font-bold flex items-center justify-center">+</button>
                <span className="text-[9px] text-slate-500">giây</span>
              </div>
            </div>
          </div>
          {(trimStart > 0 || trimEnd > 0) && (
            <div className="text-[8px] text-cyan-400">
              ✂ Sẽ cắt {trimStart > 0 ? `${trimStart}s đầu` : ''}{trimStart > 0 && trimEnd > 0 ? ' + ' : ''}{trimEnd > 0 ? `${trimEnd}s cuối` : ''} trước khi reup
            </div>
          )}
        </div>

        {/* REVIEW PHIM — PROGRESS BAR khi đang chạy */}
        {rfRunning && rfStep.total > 0 && (
          <div className="flex flex-col gap-1 py-2 px-2.5 bg-purple-950/60 rounded-lg border border-purple-600/60">
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-purple-300 font-bold">⏳ Review Phim đang chạy</span>
              <span className="text-[9px] text-purple-400">{rfStep.cur}/{rfStep.total}</span>
            </div>
            <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.round(rfStep.cur / rfStep.total * 100)}%` }}/>
            </div>
            <div className="text-[8px] text-purple-400 truncate">{rfStep.label}</div>
          </div>
        )}

        {/* REVIEW PHIM — LỒNG TIẾNG TỰ ĐỘNG */}
        {presetMode === 'review' && (
          <div className="flex flex-col gap-2 py-2 px-2.5 bg-purple-950/40 rounded-lg border border-purple-700/50">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-purple-300 font-bold">🎙️ Lồng tiếng tự động</div>
                <div className="text-[7px] text-purple-500">Transcribe → Dịch → TTS → Mix → Lách Content ID</div>
              </div>
              <button onClick={() => setRfEnabled(v => !v)} disabled={rfRunning}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${rfEnabled ? 'bg-purple-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${rfEnabled ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>

            {rfEnabled && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[7px] text-slate-400 block mb-0.5">Ngôn ngữ đầu ra</label>
                    <select value={rfTargetCode} onChange={e => {
                      const found = RF_LANGS.find(l => l.code === e.target.value);
                      setRfTargetCode(e.target.value);
                      if (found) setRfTargetLang(found.lang);
                      // Auto chọn lại voice Edge phù hợp
                      if (e.target.value !== 'vi' && rfEdgeVoices.length > 0) {
                        const match = rfEdgeVoices.find(v => (v.Locale || v.ShortName || '').toLowerCase().startsWith(e.target.value + '-'));
                        if (match) setRfEdgeVoice(match.ShortName);
                      }
                    }} disabled={rfRunning}
                      className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-purple-500 disabled:opacity-50">
                      {RF_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[7px] text-slate-400 block mb-0.5">Model Gemini</label>
                    <select value={rfGeminiModel} onChange={e => setRfGeminiModel(e.target.value)} disabled={rfRunning}
                      className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-purple-500 disabled:opacity-50">
                      {RF_GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  {rfTargetCode !== 'vi' && (
                    <div className="flex-1">
                      <label className="text-[7px] text-slate-400 block mb-0.5">Giọng Edge TTS</label>
                      <select value={rfEdgeVoice} onChange={e => setRfEdgeVoice(e.target.value)} disabled={rfRunning}
                        className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-cyan-500 disabled:opacity-50">
                        {(() => {
                          // Nhãn gợi ý phong cách cho các giọng phổ biến
                          const styleHints = {
                            'AriaNeural':'Kể chuyện, đa phong cách', 'JennyNeural':'Tin tức, chat',
                            'GuyNeural':'Tin tức, bình luận', 'AndrewNeural':'Kể chuyện, tự nhiên',
                            'EmmaNeural':'Kể chuyện, dịu dàng', 'BrianNeural':'Review, trầm ấm',
                            'RogerNeural':'Tin tức, chuyên nghiệp', 'SteffanNeural':'Tin tức, rõ ràng',
                            'AvaNeural':'Kể chuyện, ấm áp', 'NovaNova':'Sáng tạo, trẻ trung',
                            'YunxiNeural':'Kể chuyện', 'XiaoxiaoNeural':'Tin tức, trẻ',
                            'NanamiNeural':'Kể chuyện', 'SunHiNeural':'Tin tức',
                          };
                          const filtered = rfEdgeVoices.filter(v => {
                            const locale = (v.Locale || v.ShortName || '').toLowerCase();
                            return locale.startsWith(rfTargetCode + '-');
                          });
                          if (filtered.length === 0) return <option value={rfEdgeVoice}>{rfEdgeVoice}</option>;
                          return filtered.map(v => {
                            const voiceKey = Object.keys(styleHints).find(k => v.ShortName?.includes(k));
                            const hint = voiceKey ? ` — ${styleHints[voiceKey]}` : '';
                            const gender = v.Gender === 'Female' ? '♀' : v.Gender === 'Male' ? '♂' : '';
                            return <option key={v.ShortName} value={v.ShortName}>{gender} {v.ShortName}{hint}</option>;
                          });
                        })()}
                      </select>
                    </div>
                  )}
                </div>

                {/* VieNeu voice picker — chỉ khi Tiếng Việt */}
                {rfTargetCode === 'vi' && (
                  <div className="flex-1">
                    <label className="text-[7px] text-slate-400 block mb-0.5">Giọng VieNeu</label>
                    <select value={rfVieNeuVoice} onChange={e => setRfVieNeuVoice(e.target.value)} disabled={rfRunning}
                      className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-purple-500 disabled:opacity-50">
                      {rfVieNeuVoices.length === 0
                        ? <option value="">⚠️ Chưa cài VieNeu hoặc chưa load giọng</option>
                        : rfVieNeuVoices.map(v => <option key={v.id} value={v.id}>{v.name || v.id}</option>)
                      }
                    </select>
                  </div>
                )}

                {/* Chèn sub */}
                <div className="flex items-center justify-between py-1 px-2 bg-slate-800/60 rounded-lg">
                  <div>
                    <div className="text-[9px] text-slate-300 font-semibold">📝 Chèn phụ đề dịch vào video</div>
                    <div className="text-[7px] text-slate-500">Burn sub đúng timing TTS, đè lên sub gốc</div>
                  </div>
                  <button onClick={() => setRfBurnSub(v => !v)} disabled={rfRunning}
                    className={`w-10 h-5 rounded-full transition-all flex-shrink-0 ml-2 relative ${rfBurnSub ? 'bg-purple-600' : 'bg-slate-600'} disabled:opacity-50`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${rfBurnSub ? 'left-5' : 'left-0.5'}`}/>
                  </button>
                </div>

                {/* Âm lượng video gốc + lồng tiếng */}
                <div className="flex flex-col gap-2 pt-1 border-t border-purple-700/30">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[8px] text-slate-400">🎞 Âm lượng nhạc nền: <span className="text-yellow-400 font-bold">{rfVideoVol}%</span></label>
                    <input type="range" min={0} max={100} step={5} value={rfVideoVol}
                      onChange={e => setRfVideoVol(+e.target.value)} disabled={rfRunning}
                      className="w-full h-1 accent-yellow-500"/>
                    <div className="flex justify-between text-[7px] text-slate-600"><span>0%</span><span>50%</span><span>100%</span></div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[8px] text-slate-400">🎙 Âm lượng lồng tiếng: <span className="text-green-400 font-bold">{rfVoiceVol}%</span></label>
                    <input type="range" min={80} max={150} step={5} value={rfVoiceVol}
                      onChange={e => setRfVoiceVol(+e.target.value)} disabled={rfRunning}
                      className="w-full h-1 accent-green-500"/>
                    <div className="flex justify-between text-[7px] text-slate-600"><span>80%</span><span>120%</span><span>150%</span></div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* BATCH MODE TOGGLE */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-indigo-950/60 rounded-lg border border-indigo-700/50">
          <div>
            <div className="text-[10px] text-indigo-300 font-semibold">Xử lý hàng loạt</div>
            <div className="text-[8px] text-indigo-500">Chọn thư mục chứa nhiều video, tự chạy lần lượt</div>
          </div>
          <button onClick={() => { setBatchMode(v => !v); setBatchQueue([]); setBatchFolder(''); }} disabled={running}
            className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${batchMode ? 'bg-indigo-600' : 'bg-slate-600'} disabled:opacity-50`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${batchMode ? 'left-6' : 'left-1'}`}/>
          </button>
        </div>

        {!batchMode && (
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-slate-500 uppercase">Video gốc</label>
            <button onClick={pickVideo} disabled={running}
              className="text-left px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-lg text-[10px] text-slate-300 hover:border-blue-500 transition truncate disabled:opacity-50">
              {videoFile ? videoFile.replace(/\\/g,'/').split('/').pop() : '📂 Chọn video...'}
            </button>
            {videoFile && <p className="text-[8px] text-slate-500 truncate">{videoFile}</p>}
          </div>
        )}

        {batchMode && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] text-slate-500 uppercase">Thư mục chứa video gốc</label>
            <button onClick={pickBatchFolder} disabled={running}
              className="text-left px-2.5 py-2 bg-slate-800 border border-indigo-600/50 rounded-lg text-[10px] text-slate-300 hover:border-indigo-400 transition truncate disabled:opacity-50">
              {batchFolder || '📁 Chọn thư mục video...'}
            </button>
            {batchQueue.length > 0 && (
              <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto pr-0.5">
                {batchQueue.map((item, i) => (
                  <div key={i} className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[8px] ${
                    item.status === 'done'    ? 'bg-green-900/40 text-green-400' :
                    item.status === 'running' ? 'bg-blue-900/40 text-blue-300 font-bold' :
                    item.status === 'error'   ? 'bg-red-900/40 text-red-400' :
                    item.status === 'skipped' ? 'bg-slate-800 text-slate-500 line-through' :
                    'bg-slate-800/40 text-slate-400'
                  }`}>
                    <span>{item.status === 'done' ? '✅' : item.status === 'running' ? '⏳' : item.status === 'error' ? '❌' : item.status === 'skipped' ? '⏭' : '○'}</span>
                    <span className="truncate">{item.name}</span>
                  </div>
                ))}
              </div>
            )}
            {batchQueue.length > 0 && (
              <div className="text-[8px] text-indigo-400 font-semibold">
                {batchIdx >= 0
                  ? `⏳ Đang xử lý ${batchIdx + 1}/${batchQueue.length}`
                  : `📋 ${batchQueue.length} video trong hàng đợi`}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-slate-500 uppercase">{batchMode ? 'Thư mục lưu kết quả (gốc)' : 'Thư mục lưu kết quả'}</label>
          <button onClick={pickFolder} disabled={running}
            className="text-left px-2.5 py-2 bg-slate-800 border border-slate-600 rounded-lg text-[10px] text-slate-300 hover:border-blue-500 transition truncate disabled:opacity-50">
            {outFolder || '📁 Chọn thư mục...'}
          </button>
          {batchMode && outFolder && <p className="text-[8px] text-slate-500">Mỗi video → thư mục con trong đây</p>}
        </div>

        {/* 🎬 HÌNH ẢNH / VIDEO */}
        <div className="flex flex-col gap-2 py-2 px-2 bg-slate-800/40 rounded-lg border border-slate-700/40">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">🎬 Hình ảnh / Video</div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] text-slate-500 uppercase">Zoom xóa logo: <span className="text-blue-400 font-bold">{zoomPct}%</span></label>
            <input type="range" min={1} max={8} step={1} value={zoomPct} onChange={e => setZoomPct(+e.target.value)} disabled={running}
              className="w-full accent-blue-500 disabled:opacity-50"/>
            <p className="text-[8px] text-slate-500">Phóng to {zoomPct}% → đẩy logo góc ra ngoài rìa</p>
          </div>


          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Cắt ngẫu nhiên</div>
              <div className="text-[7px] text-slate-500">{randomCut ? 'Cứ 4-7s cắt 0.3-0.7s (ngẫu nhiên)' : 'Cố định: cứ 5s cắt 0.5s'}</div>
            </div>
            <button onClick={() => setRandomCut(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${randomCut ? 'bg-teal-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${randomCut ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[8px] text-slate-500">Chuyển động giả (Ken Burns)</label>
            <div className="flex gap-1">
              {[['Tắt','none'],['Zoom In','zoom-in'],['Pan L→R','pan-lr']].map(([lbl, v]) => (
                <button key={v} onClick={() => setKenBurns(v)} disabled={running}
                  className={`flex-1 py-0.5 rounded text-[7px] font-semibold transition-all ${kenBurns === v ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} disabled:opacity-50`}>
                  {lbl}
                </button>
              ))}
            </div>
            {kenBurns !== 'none' && <p className="text-[7px] text-orange-400">⚠ Ken Burns làm chậm xử lý đáng kể</p>}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Lật ngang (Mirror)</div>
              <div className="text-[7px] text-slate-500">hflip — phá bố cục pixel toàn bộ</div>
            </div>
            <button onClick={() => setHFlip(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${hFlip ? 'bg-orange-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${hFlip ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>
          {hFlip && <p className="text-[7px] text-orange-400">⚠ Video có chữ/phụ đề sẽ bị ngược — tắt nếu cần đọc</p>}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Hạt nhiễu (Film Grain)</div>
                <div className="text-[7px] text-slate-500">noise động theo frame — mắt không thấy</div>
              </div>
              <button onClick={() => setGrainNoise(v => !v)} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${grainNoise ? 'bg-orange-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${grainNoise ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {grainNoise && (
              <div className="flex flex-col gap-0.5">
                <label className="text-[7px] text-slate-500">Cường độ: <span className="text-orange-400 font-bold">{grainLevel}</span></label>
                <input type="range" min={2} max={15} step={1} value={grainLevel} onChange={e => setGrainLevel(+e.target.value)} disabled={running}
                  className="w-full accent-orange-500 disabled:opacity-50"/>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Lệch tông màu (Color Shift)</div>
                <div className="text-[7px] text-slate-500">eq ngẫu nhiên — contrast/sat/brightness lệch nhỏ</div>
              </div>
              <button onClick={() => setColorShift(v => !v)} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${colorShift ? 'bg-pink-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${colorShift ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {colorShift && (
              <div className="flex gap-1">
                {[['Nhẹ','subtle'],['Vừa','medium'],['Mạnh','strong']].map(([lbl, v]) => (
                  <button key={v} onClick={() => setColorShiftLevel(v)} disabled={running}
                    className={`flex-1 py-0.5 rounded text-[7px] font-semibold transition-all ${colorShiftLevel === v ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} disabled:opacity-50`}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Crop lệch tâm (Random Pos)</div>
              <div className="text-[7px] text-slate-500">lệch vị trí crop 3-8% mỗi lần render</div>
            </div>
            <button onClick={() => setRandomPosCrop(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${randomPosCrop ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${randomPosCrop ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">FPS ngẫu nhiên lẻ</div>
              <div className="text-[7px] text-slate-500">xuất 29.xx / 59.xx fps — phá fingerprint FPS</div>
            </div>
            <button onClick={() => setRandomFps(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${randomFps ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${randomFps ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Xoay góc tàng hình (±0.1-0.5°)</div>
              <div className="text-[7px] text-slate-500">mắt không thấy — phá DCT hash toàn frame</div>
            </div>
            <button onClick={() => setSlightRotate(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${slightRotate ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${slightRotate ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Xoay màu sắc (Hue ±3-10°)</div>
              <div className="text-[7px] text-slate-500">toàn bộ RGB thay đổi — ContentID mù màu</div>
            </div>
            <button onClick={() => setHueRotate(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${hueRotate ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${hueRotate ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🌑 Vignette (viền tối)</div>
              <div className="text-[7px] text-slate-500">bo tối 4 góc ngẫu nhiên — phá perceptual hash góc frame</div>
            </div>
            <button onClick={() => setVignette(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${vignette ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${vignette ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🔲 Video Padding (đệm đầu/cuối)</div>
              <div className="text-[7px] text-slate-500">thêm 0.05-0.15s đen đầu & cuối — lệch timestamp fingerprint</div>
            </div>
            <button onClick={() => setVideoPad(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${videoPad ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${videoPad ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">💡 Brightness Jitter (rung độ sáng)</div>
              <div className="text-[7px] text-slate-500">brightness ±0.02 contrast ±0.05 — thay đổi luminance DCT block</div>
            </div>
            <button onClick={() => setBrightnessJitter(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${brightnessJitter ? 'bg-indigo-500' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${brightnessJitter ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🌈 RGB Channel Shift</div>
              <div className="text-[7px] text-slate-500">Dịch R/G/B ±1-3px độc lập — phá spatial pixel hash</div>
            </div>
            <button onClick={() => setColorChannelShift(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${colorChannelShift ? 'bg-pink-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${colorChannelShift ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">⏱ Temporal Blend</div>
              <div className="text-[7px] text-slate-500">Trộn 2% frame trước vào frame hiện tại — phá temporal hash</div>
            </div>
            <button onClick={() => setTemporalBlend(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${temporalBlend ? 'bg-amber-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${temporalBlend ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">📐 Perspective Warp</div>
              <div className="text-[7px] text-slate-500">Biến dạng góc ±2-4px — phá scene detection hash</div>
            </div>
            <button onClick={() => setPerspectiveWarp(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${perspectiveWarp ? 'bg-teal-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${perspectiveWarp ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          {/* Logo tên kênh */}
          <div className="flex flex-col gap-1 py-1.5 px-2 bg-slate-900/40 rounded-lg border border-slate-700/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Logo tên kênh nổi</div>
                <div className="text-[7px] text-slate-500">Chữ mờ trôi qua 4 góc video</div>
              </div>
              <button onClick={(e) => {
                  let el = e.currentTarget.parentElement;
                  while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
                  const savedTop = el?.scrollTop;
                  setWmEnabled(v => !v);
                  requestAnimationFrame(() => { if (el) el.scrollTop = savedTop; });
                }} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${wmEnabled ? 'bg-violet-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${wmEnabled ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {wmEnabled && (
              <div className="flex flex-col gap-1.5 mt-1">
                <input type="text" value={wmText} onChange={e => setWmText(e.target.value)}
                  placeholder="Tên kênh của bạn..." disabled={running}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-[10px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 disabled:opacity-50"/>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[8px] text-slate-500">Độ mờ: <span className="text-violet-400 font-bold">{wmOpacity}%</span></label>
                  <input type="range" min={5} max={50} step={5} value={wmOpacity} onChange={e => setWmOpacity(+e.target.value)} disabled={running}
                    className="w-full accent-violet-500 disabled:opacity-50"/>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[8px] text-slate-500">Tốc độ di chuyển: <span className="text-violet-400 font-bold">{wmCycle === 60 ? 'Chậm' : wmCycle === 40 ? 'Vừa' : 'Nhanh'}</span></label>
                  <div className="flex gap-1">
                    {[['Chậm', 60], ['Vừa', 40], ['Nhanh', 20]].map(([lbl, v]) => (
                      <button key={v} onClick={() => setWmCycle(v)} disabled={running}
                        className={`flex-1 py-0.5 rounded text-[8px] font-semibold transition-all ${wmCycle === v ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} disabled:opacity-50`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Xóa phụ đề */}
          <div className="flex flex-col gap-1 py-1.5 px-2 bg-slate-900/40 rounded-lg border border-slate-700/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">📝 Xóa phụ đề (Sub Remove)</div>
                <div className="text-[7px] text-slate-500">Che/làm mờ dải chứa phụ đề hard-coded</div>
              </div>
              <button onClick={(e) => {
                  let el = e.currentTarget.parentElement;
                  while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
                  const savedTop = el?.scrollTop;
                  setSubRemove(v => !v);
                  requestAnimationFrame(() => { if (el) el.scrollTop = savedTop; });
                }} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${subRemove ? 'bg-yellow-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${subRemove ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {subRemove && (
              <div className="flex flex-col gap-2 mt-1">
                <button disabled={!videoFile || subPreviewLoading} onClick={async () => {
                  if (!videoFile) return;
                  setSubPreviewLoading(true);
                  try {
                    const res = await window.electronAPI.extractFrame({ inputPath: videoFile, timeOffset: 30 });
                    if (res.ok) setSubPreviewImg('data:image/jpeg;base64,' + res.base64);
                    else console.error('extractFrame:', res.error);
                  } catch(e) { console.error(e); }
                  setSubPreviewLoading(false);
                }} className="w-full py-1 rounded text-[9px] font-semibold bg-slate-700 hover:bg-slate-600 text-yellow-300 disabled:opacity-40 transition">
                  {subPreviewLoading ? '⏳ Đang lấy frame...' : '🖼️ Xem frame để căn vùng sub'}
                </button>
                {subPreviewImg && (
                  <div className="relative rounded overflow-hidden border border-slate-600" style={{lineHeight:0}}>
                    <img src={subPreviewImg} alt="preview" className="w-full object-contain"/>
                    <div className="absolute pointer-events-none"
                      style={{
                        left: `${subHOffset}%`, width: `${subWidth}%`,
                        ...(subPosition === 'bottom' ? { bottom: 0, height: `${subHeight}%` } : { top: 0, height: `${subHeight}%` }),
                        background: 'rgba(234,179,8,0.35)', border: '1.5px solid rgba(234,179,8,0.8)', boxSizing: 'border-box',
                      }}>
                      <span className="absolute top-0 left-1 text-[8px] text-yellow-300 font-bold leading-tight">{subWidth}%×{subHeight}%</span>
                    </div>
                    <button onClick={() => setSubPreviewImg(null)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full text-white text-[10px] flex items-center justify-center hover:bg-black/80">✕</button>
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[7px] text-slate-500">Chiều cao vùng xóa: <span className="text-yellow-400 font-bold">{subHeight}%</span> chiều cao video</label>
                  <input type="range" min={2} max={25} step={1} value={subHeight} onChange={e => setSubHeight(+e.target.value)} disabled={running}
                    className="w-full accent-yellow-500 disabled:opacity-50"/>
                  <div className="flex justify-between text-[6px] text-slate-600"><span>2% (1 dòng)</span><span>25% (sub lớn/karaoke)</span></div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[7px] text-slate-500">Chiều ngang: <span className="text-yellow-400 font-bold">{subWidth}%</span> &nbsp;|&nbsp; Lệch trái: <span className="text-yellow-400 font-bold">{subHOffset}%</span></label>
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[6px] text-slate-600 w-10">Rộng</span>
                    <input type="range" min={20} max={100} step={1} value={subWidth} onChange={e => setSubWidth(+e.target.value)} disabled={running}
                      className="flex-1 accent-yellow-500 disabled:opacity-50"/>
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[6px] text-slate-600 w-10">Offset</span>
                    <input type="range" min={0} max={80} step={1} value={subHOffset} onChange={e => setSubHOffset(+e.target.value)} disabled={running}
                      className="flex-1 accent-yellow-500 disabled:opacity-50"/>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <label className="text-[7px] text-slate-500 block mb-0.5">Vị trí</label>
                    <select value={subPosition} onChange={e => setSubPosition(e.target.value)} disabled={running}
                      className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-yellow-500 disabled:opacity-50">
                      <option value="bottom">⬇ Dưới (phổ biến)</option>
                      <option value="top">⬆ Trên</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[7px] text-slate-500 block mb-0.5">Kiểu xóa</label>
                    <select value={subStyle} onChange={e => setSubStyle(e.target.value)} disabled={running}
                      className="w-full px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 focus:outline-none focus:border-yellow-500 disabled:opacity-50">
                      <option value="blur">🌫 Làm mờ (tự nhiên)</option>
                      <option value="black">⬛ Che đen (nhanh)</option>
                    </select>
                  </div>
                </div>
                <p className="text-[7px] text-slate-500">
                  {subStyle === 'blur' ? '💡 Làm mờ: inpaint từ pixel xung quanh, tự nhiên hơn cho nền phức tạp' : '💡 Che đen: nhanh, phù hợp khi muốn hard-cut vùng sub'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 🎵 ÂM THANH */}
        <div className="flex flex-col gap-2 py-2 px-2 bg-slate-800/40 rounded-lg border border-slate-700/40">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">🎵 Âm thanh</div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Biến tốc thông minh</div>
                <div className="text-[7px] text-slate-500">Dao động ±2-6% — mắt &amp; tai không nhận ra</div>
              </div>
              <button onClick={() => setVarSpeed(v => !v)} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${varSpeed ? 'bg-amber-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${varSpeed ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {varSpeed && (
              <div className="flex gap-1">
                {[['Nhẹ ±2%','light'],['Vừa ±4%','medium'],['Mạnh ±6%','strong']].map(([lbl, v]) => (
                  <button key={v} onClick={() => setVarSpeedLevel(v)} disabled={running}
                    className={`flex-1 py-0.5 rounded text-[7px] font-semibold transition-all ${varSpeedLevel === v ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} disabled:opacity-50`}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 bg-slate-800/50 rounded p-1.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Căn thời lượng mục tiêu</div>
                <div className="text-[7px] text-slate-500">Tự tính tốc độ để video vừa khít category YT</div>
              </div>
              <button onClick={() => setTargetDurEnabled(v => !v)} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${targetDurEnabled ? 'bg-orange-600' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${targetDurEnabled ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {targetDurEnabled && (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-1 gap-0.5 bg-slate-900/60 rounded p-1">
                  {[
                    { range: '< 3 phút', val: 2,  tag: 'Shorts', color: 'text-pink-400',   where: 'Feed Shorts · mobile',         tip: 'Viral nhanh, không cần subscribe' },
                    { range: '8–20 phút', val: 15, tag: 'Tối ưu', color: 'text-green-400',  where: 'Browse · Search · Suggested',  tip: '★ Phổ biến nhất · đủ Ad mid-roll' },
                    { range: '20–35 phút', val: 25, tag: 'Tốt',   color: 'text-blue-400',   where: 'Suggested · Homepage',         tip: 'Giữ watch time cao · tăng AVD' },
                    { range: '20–60 phút', val: 45, tag: 'Dài',   color: 'text-purple-400', where: 'Suggested · Homepage',         tip: 'Nhiều mid-roll · cần nội dung chắc' },
                    { range: '> 60 phút',  val: 70, tag: 'Docu',  color: 'text-yellow-400', where: 'Homepage · Subscriber feed',   tip: 'Documentary style · loyal audience' },
                  ].map(({ range, val, tag, color, where, tip }) => (
                    <button key={val} onClick={() => setTargetDurMinutes(val)} disabled={running}
                      className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-all w-full ${targetDurMinutes === val ? 'bg-orange-600/30 ring-1 ring-orange-500' : 'hover:bg-slate-700/60'} disabled:opacity-50`}>
                      <div className="flex flex-col items-center w-14 flex-shrink-0">
                        <span className={`text-[8px] font-bold ${color}`}>{range}</span>
                        <span className={`text-[6px] font-semibold px-1 rounded ${targetDurMinutes === val ? 'bg-orange-500 text-white' : 'bg-slate-700 text-slate-400'}`}>{tag}</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[7px] text-slate-300 truncate">{where}</span>
                        <span className="text-[6px] text-slate-500">{tip}</span>
                      </div>
                      {targetDurMinutes === val && <span className="ml-auto text-orange-400 text-[8px] flex-shrink-0">✓ {val}p</span>}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[7px] text-slate-500 whitespace-nowrap">Tùy chỉnh:</label>
                  <input type="number" min="1" max="180" value={targetDurMinutes}
                    onChange={e => setTargetDurMinutes(Math.max(1, Math.min(180, parseInt(e.target.value) || 1)))}
                    disabled={running}
                    className="w-14 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-[8px] text-orange-300 text-center disabled:opacity-50"/>
                  <span className="text-[7px] text-slate-500">phút · tốc độ tính tự động</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[8px] text-slate-500">Pitch giọng: <span className="text-cyan-400 font-bold">{pitchShift > 0 ? '+' : ''}{pitchShift} semitone</span></label>
            <div className="flex gap-1">
              {[-2, -1, 0, 1, 2].map(v => (
                <button key={v} onClick={() => setPitchShift(v)} disabled={running}
                  className={`flex-1 py-0.5 rounded text-[8px] font-semibold transition-all ${pitchShift === v ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'} disabled:opacity-50`}>
                  {v > 0 ? '+' : ''}{v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">Đảo kênh Stereo</div>
              <div className="text-[7px] text-slate-500">Swap L↔R — phá cấu trúc pha âm thanh</div>
            </div>
            <button onClick={() => setStereoFlip(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${stereoFlip ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${stereoFlip ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">Tiếng ồn nền</div>
                <div className="text-[7px] text-slate-500">Trộn white noise cực nhỏ — phá spectrogram</div>
              </div>
              <button onClick={(e) => {
                  let el = e.currentTarget.parentElement;
                  while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
                  const savedTop = el?.scrollTop;
                  setBgNoise(v => !v);
                  requestAnimationFrame(() => { if (el) el.scrollTop = savedTop; });
                }} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${bgNoise ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${bgNoise ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
            {bgNoise && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <label className="text-[7px] text-slate-500">Mức nhiễu: <span className="text-cyan-400 font-bold">{bgNoiseLevel}%</span></label>
                  <input type="range" min={1} max={8} step={1} value={bgNoiseLevel} onChange={e => setBgNoiseLevel(+e.target.value)} disabled={running}
                    className="w-full accent-cyan-500 disabled:opacity-50"/>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[7px] text-slate-500">Loại tiếng ồn tổng hợp:</label>
                  <select value={bgNoiseColor} onChange={e => setBgNoiseColor(e.target.value)} disabled={running || !!bgNoiseFile}
                    className="px-2 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 disabled:opacity-50 focus:outline-none focus:border-cyan-500">
                    <option value="pink">🎵 Pink Noise (mặc định)</option>
                    <option value="brown">🌧 Brown Noise (tiếng mưa/gió trầm)</option>
                  </select>
                  {bgNoiseFile && <span className="text-[7px] text-slate-500">* Đang dùng file âm thanh, loại noise bị bỏ qua</span>}
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-[7px] text-slate-500">Hoặc dùng file âm thanh riêng:</label>
                  <button onClick={pickBgNoiseFile} disabled={running}
                    className="text-left px-2 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-slate-300 hover:border-cyan-500 transition truncate disabled:opacity-50">
                    {bgNoiseFile ? bgNoiseFile.replace(/\\/g,'/').split('/').pop() : '📂 Chọn file (tuỳ chọn)'}
                  </button>
                  {bgNoiseFile && (
                    <button onClick={() => setBgNoiseFile('')} disabled={running}
                      className="text-[7px] text-slate-500 hover:text-red-400 text-left">✕ Bỏ file, dùng lại noise tổng hợp</button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <label className="text-[8px] text-slate-500">Âm lượng gốc: <span className={`font-bold ${audioVolume <= 10 ? 'text-red-400' : 'text-green-400'}`}>{audioVolume}%</span></label>
            <input type="range" min={0} max={100} step={5} value={audioVolume} onChange={e => setAudioVolume(+e.target.value)} disabled={running}
              className="w-full accent-green-500 disabled:opacity-50"/>
            {audioVolume <= 10 && <p className="text-[7px] text-red-400">⚠ Âm thanh gần tắt hoàn toàn</p>}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🎚 Audio EQ ngẫu nhiên</div>
              <div className="text-[7px] text-slate-500">bass/treble ±2-4dB ngẫu nhiên — phá waveform fingerprint</div>
            </div>
            <button onClick={() => setAudioEQ(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${audioEQ ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${audioEQ ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🎛 Audio Compressor (nén âm)</div>
              <div className="text-[7px] text-slate-500">nén dynamic ngẫu nhiên — phá acoustic fingerprint biên độ</div>
            </div>
            <button onClick={() => setAudioCompress(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${audioCompress ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${audioCompress ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🔊 Audio Reverb (tiếng vang)</div>
              <div className="text-[7px] text-slate-500">echo ngẫu nhiên 20-50ms — phá spectral envelope acoustic fingerprint</div>
            </div>
            <button onClick={() => setAudioReverb(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${audioReverb ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${audioReverb ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🎵 Audio Chorus (phân tán pha)</div>
              <div className="text-[7px] text-slate-500">nhân tín hiệu lệch phase nhẹ — phá waveform pattern tầng sâu</div>
            </div>
            <button onClick={() => setAudioChorus(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${audioChorus ? 'bg-cyan-700' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${audioChorus ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">🔉 Audio Dither</div>
              <div className="text-[7px] text-slate-500">Noise 0.003% sub-threshold — phá audio waveform hash</div>
            </div>
            <button onClick={() => setAudioDither(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${audioDither ? 'bg-lime-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${audioDither ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          {presetMode === 'normal' && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
              <div>
                <div className="text-[9px] text-slate-300 font-semibold">🎵 Tách nhạc nền</div>
                <div className="text-[7px] text-slate-500">Xóa nhạc, giữ giọng nói/SFX — tránh Content ID âm nhạc</div>
              </div>
              <button onClick={() => setRemoveBgMusic(v => !v)} disabled={running}
                className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${removeBgMusic ? 'bg-orange-500' : 'bg-slate-600'} disabled:opacity-50`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${removeBgMusic ? 'left-6' : 'left-1'}`}/>
              </button>
            </div>
          )}


          {/* Độ phân giải đầu ra */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
            <div>
              <div className="text-[9px] text-slate-300 font-semibold">📺 Độ phân giải đầu ra</div>
              <div className="text-[7px] text-slate-500">Chọn 1080p hoặc 4K bất kể video gốc là gì</div>
            </div>
            <select
              value={outputResolution} onChange={e => setOutputResolution(e.target.value)} disabled={running}
              className="ml-2 px-1.5 py-1 bg-slate-900 border border-slate-600 rounded text-[9px] text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer">
              <option value="source">Giữ nguyên gốc</option>
              <option value="1080p">1080p (Full HD)</option>
              <option value="4k">4K (2160p)</option>
            </select>
          </div>

        </div>

        {/* ⚡ BỘ MÃ HÓA GPU */}
        <div className="flex flex-col gap-1.5 py-2 px-2 bg-slate-800/40 rounded-lg border border-slate-700/40">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">⚡ Bộ mã hóa (Encoder)</div>
          <select
            value={gpuMode} onChange={e => setGpuMode(e.target.value)} disabled={running}
            className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-[10px] text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer">
            <option value="auto">🔍 Tự động (Auto-detect)</option>
            <option value="nvenc">🟢 NVIDIA (NVENC) — nhanh ~5-10x</option>
            <option value="amf">🔴 AMD (AMF) — nhanh ~4-6x</option>
            <option value="qsv">🔵 Intel (QSV) — nhanh ~3x</option>
            <option value="cpu">⚪ Chỉ dùng CPU (libx264) — tương thích cao nhất</option>
          </select>
          <p className="text-[7px] text-slate-500">
            {gpuMode === 'auto' ? 'Auto sẽ test NVENC → AMF → QSV → CPU khi bắt đầu' :
             gpuMode === 'cpu'  ? 'CPU encode chậm hơn nhưng chạy được trên mọi máy' :
             'Áp đặt thẳng encoder, không test — tối ưu tốc độ tối đa'}
          </p>
        </div>

        {/* 🔒 NGUỴ TRANG */}
        <div className="flex items-center justify-between py-1.5 px-2 bg-slate-800/50 rounded-lg border border-slate-700/40">
          <div>
            <div className="text-[10px] text-slate-300 font-semibold">🔒 Làm giả Metadata</div>
            <div className="text-[7px] text-slate-500">Ghi đè encoder, ngày tạo, thiết bị ngẫu nhiên</div>
          </div>
          <button onClick={() => setRandomMeta(v => !v)} disabled={running}
            className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${randomMeta ? 'bg-red-700' : 'bg-slate-600'} disabled:opacity-50`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${randomMeta ? 'left-6' : 'left-1'}`}/>
          </button>
        </div>

        {/* 🎤 VOICE TRANSFORM */}
        <div className="border border-violet-700/40 rounded-xl p-2.5 bg-violet-950/20 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-violet-300 font-bold">🎤 Voice Transform</div>
              <div className="text-[7px] text-slate-400">Pitch shift mạnh + chorus + reverb + formant warp — phá fingerprint audio</div>
            </div>
            <button onClick={() => setRvcEnabled(v => !v)} disabled={running}
              className={`w-11 h-6 rounded-full transition-all flex-shrink-0 ml-2 relative ${rvcEnabled ? 'bg-violet-600' : 'bg-slate-600'} disabled:opacity-50`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${rvcEnabled ? 'left-6' : 'left-1'}`}/>
            </button>
          </div>

          {rvcEnabled && (
            <div className="space-y-2">
              {/* Pitch shift */}
              <div>
                <div className="flex justify-between text-[8px] text-slate-400 mb-1">
                  <span>Pitch shift cơ sở <span className="text-slate-500">(0 = tự động ±3-4st ngẫu nhiên)</span></span>
                  <span className="text-violet-300 font-semibold">{rvcPitch > 0 ? '+' : ''}{rvcPitch} st</span>
                </div>
                <input type="range" min="-12" max="12" step="1" value={rvcPitch}
                  onChange={e => setRvcPitch(Number(e.target.value))} disabled={running}
                  className="w-full h-1 accent-violet-500 disabled:opacity-50"/>
                <div className="flex justify-between text-[7px] text-slate-600 mt-0.5">
                  <span>-12</span><span className="text-violet-400">0 = auto</span><span>+12</span>
                </div>
              </div>

              {/* Intensity */}
              <div>
                <div className="text-[8px] text-slate-400 mb-1">Cường độ biến đổi</div>
                <div className="flex gap-1">
                  {[['light','Nhẹ'],['medium','Vừa'],['strong','Mạnh']].map(([v,l]) => (
                    <button key={v} onClick={() => setRvcF0Method(v)} disabled={running}
                      className={`flex-1 py-1 text-[8px] rounded transition-all disabled:opacity-50 ${rvcF0Method === v ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="text-[7px] text-slate-500 mt-0.5">Mạnh = bypass ContentID tốt hơn nhưng giọng nghe khác nhiều hơn</div>
              </div>

              {/* Check / Install */}
              <div className="flex gap-1">
                <button onClick={async () => {
                  setRvcStatus('checking'); setRvcStatusMsg('Đang kiểm tra...');
                  const res = await window.electronAPI.rvcCheck();
                  if (res.ok) { setRvcStatus('ok'); setRvcStatusMsg(`✅ Sẵn sàng · pedalboard ${res.versions?.pedalboard || ''}`); }
                  else { setRvcStatus('error'); setRvcStatusMsg(res.error || 'Lỗi'); }
                }} disabled={running || rvcStatus === 'checking' || rvcStatus === 'installing'}
                  className="flex-1 py-1.5 text-[8px] bg-slate-700 hover:bg-slate-600 rounded transition-all disabled:opacity-50">
                  {rvcStatus === 'checking' ? '⏳ Kiểm tra...' : '🔍 Kiểm tra'}
                </button>
                <button onClick={async () => {
                  setRvcStatus('installing'); setRvcStatusMsg('Đang cài pedalboard + librosa (~50MB)...');
                  const res = await window.electronAPI.rvcInstall();
                  if (res.ok) { setRvcStatus('ok'); setRvcStatusMsg('✅ Cài xong! Nhấn Kiểm tra để xác nhận.'); }
                  else { setRvcStatus('error'); setRvcStatusMsg(res.error || 'Cài lỗi'); }
                }} disabled={running || rvcStatus === 'checking' || rvcStatus === 'installing'}
                  className="flex-1 py-1.5 text-[8px] bg-violet-800 hover:bg-violet-700 rounded transition-all disabled:opacity-50">
                  {rvcStatus === 'installing' ? '⏳ Đang cài...' : '⬇ Cài deps (~50MB)'}
                </button>
              </div>

              {rvcStatusMsg && (
                <div className={`text-[8px] rounded px-2 py-1.5 ${rvcStatus === 'ok' ? 'bg-green-900/40 text-green-300' : rvcStatus === 'error' ? 'bg-red-900/40 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
                  {rvcStatusMsg}
                </div>
              )}

              <div className="text-[7px] text-slate-500 leading-relaxed">
                💡 Không cần model — cài 1 lần ~50MB (pedalboard + librosa). Xử lý ~2-5 phút/video trên CPU.
              </div>
            </div>
          )}
        </div>

        <div className="text-[8px] text-slate-500 bg-slate-800/30 rounded-lg p-2 leading-relaxed border border-slate-700/30">
          <span className="text-slate-400 font-semibold block mb-0.5">Đang bật:</span>
          {randomCut ? '✂ Cắt ngẫu nhiên 4-7s / 0.3-0.7s' : '✂ Cắt đều 5s/0.5s'}<br/>
          {apply4K && '🎨 4K Enhancement · '}
          {kenBurns !== 'none' && `🎬 Ken Burns ${kenBurns} · `}
          {hFlip && '↔ Flip · '}
          {grainNoise && `🌾 Grain ${grainLevel} · `}
          {varSpeed && `🔀 Biến tốc ${varSpeedLevel === 'light' ? '±2%' : varSpeedLevel === 'medium' ? '±4%' : '±6%'} · `}
          {pitchShift !== 0 && `🎵 Pitch ${pitchShift > 0 ? '+' : ''}${pitchShift}st · `}
          {stereoFlip && '🔄 Stereo flip · '}
          {bgNoise && `🌫 Noise ${bgNoiseLevel}%${bgNoiseFile ? ' (file)' : bgNoiseColor === 'brown' ? ' brown' : ' pink'} · `}
          {audioVolume !== 100 && `🔉 Vol ${audioVolume}% · `}
          {colorShift && `🎨 Color Shift ${colorShiftLevel} · `}
          {hueRotate && '🌈 Hue · '}
          {randomPosCrop && '📐 Random Crop · '}
          {slightRotate && '🔄 Rotate ±0.5° · '}
          {randomFps && '🎞 FPS lẻ · '}
          {audioEQ && '🎚 EQ · '}
          {vignette && '🌑 Vignette · '}
          {videoPad && '🔲 Padding · '}
          {audioCompress && '🎛 Compress · '}
          {audioReverb && '🔊 Reverb · '}
          {audioChorus && '🎵 Chorus · '}
          {brightnessJitter && '💡 Brightness · '}
          {subRemove && `📝 Sub ${subPosition === 'top' ? '↑' : '↓'}${subHeight}% ${subStyle === 'blur' ? 'mờ' : 'đen'} · `}
          {colorChannelShift && '🌈 RGB Shift · '}
          {temporalBlend && '⏱ TBlend · '}
          {perspectiveWarp && '📐 Perspective · '}
          {audioDither && '🔉 Dither · '}
          {wmEnabled && wmText.trim() && '💧 Watermark · '}
          {randomMeta && '🔒 Metadata giả · '}
          {rvcEnabled && rvcModelPath && `🎤 RVC ${rvcModelPath.replace(/\\/g,'/').split('/').pop()} pitch${rvcPitch > 0 ? '+' : ''}${rvcPitch}`}
        </div>

        <div className="flex gap-2">
          <button onClick={doStart}
            disabled={running || rfRunning || !outFolder || (batchMode ? batchQueue.length === 0 : !videoFile)}
            className={`flex-1 py-3 rounded-xl font-black text-[13px] transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${multiCount > 1 ? 'bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400' : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500'}`}>
            {(running || rfRunning) ? (batchMode ? `⏳ ${batchIdx >= 0 ? `${batchIdx + 1}/${batchQueue.length}` : '...'}` : (multiCount > 1 ? `⏳ Bản ${multiCount > 1 ? '...' : ''}` : '⏳ Đang xử lý...')) : (batchMode ? '▶ Chạy hàng loạt' : multiCount > 1 ? `🎬 Tạo ${multiCount} bản` : presetMode === 'review' && rfEnabled ? '▶ Bắt đầu Review Phim' : '▶ Bắt đầu tái tạo')}
          </button>
          {running && (batchMode || ytBatchRunningRef.current) && (
            <button onClick={() => { batchStopRef.current = true; }}
              className="px-3 py-3 rounded-xl font-black text-[12px] bg-red-700 hover:bg-red-600 transition-all shadow-lg">
              ⛔
            </button>
          )}
        </div>

        <div className="flex flex-col gap-0.5 mt-1">
          {STEPS.map((s, i) => (
            <div key={i} className={`flex items-center gap-2 text-[9px] py-0.5 transition-colors ${
              i < stepNum ? 'text-green-400' : i === stepNum ? 'text-blue-300 font-bold' : 'text-slate-600'
            }`}>
              <span>{i < stepNum ? '✅' : i === stepNum ? '⏳' : '○'}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>

        {step && <p className="text-[9px] text-blue-400 font-semibold truncate">{step}</p>}

        {resultPath && (
          <button onClick={() => window.electronAPI.openFolder(outFolder)}
            className="w-full py-2 rounded-lg text-[10px] bg-green-700 hover:bg-green-600 font-bold transition-all">
            {batchMode ? '📂 Mở thư mục kết quả (hàng loạt)' : '📂 Mở thư mục kết quả'}
          </button>
        )}

      </div>

      {/* RIGHT: Preview + Log */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Batch done list */}
        {batchDonePaths.length > 1 && (
          <div className="flex gap-1 px-2 py-1 bg-slate-900 border-b border-slate-700 overflow-x-auto" style={{minHeight:48,maxHeight:52}}>
            {batchDonePaths.map((p, i) => {
              const name = p.replace(/\\/g,'/').split('/').pop();
              const isActive = previewUrl === `file:///${encodeURI(p.replace(/\\/g, '/'))}`;
              return (
                <button key={p} onClick={() => { setResultPath(p); setPreviewUrl(`file:///${encodeURI(p.replace(/\\/g, '/'))}`); }}
                  className={`flex-shrink-0 px-2 py-1 rounded text-[8px] border transition-all ${isActive ? 'bg-purple-700 border-purple-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'}`}
                  title={p}>
                  <div className="font-bold">{i+1}</div>
                  <div className="truncate max-w-[80px]">{name.slice(0,20)}</div>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex-1 flex overflow-hidden bg-black min-h-0">
          {/* Video tái tạo — nhỏ lại */}
          <div className="w-[35%] flex-shrink-0 flex flex-col overflow-hidden border-r border-slate-700/60">
            <div className="px-2 py-1 bg-slate-900/80 text-[8px] font-bold text-purple-400 uppercase tracking-widest shrink-0">✨ Video tái tạo</div>
            <div className="flex-1 flex items-center justify-center overflow-hidden">
              {previewUrl ? (
                <video key={previewUrl} src={previewUrl} controls autoPlay className="max-h-full max-w-full"/>
              ) : (
                <div className="text-center text-slate-700 select-none">
                  <div className="text-4xl mb-2">🎬</div>
                  <div className="text-[10px]">Kết quả hiển thị ở đây</div>
                </div>
              )}
            </div>
          </div>
          {/* SEO & Thumbnail AI cột riêng */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-900/60 border-l border-slate-700/60">
              {/* Tab bar */}
              <div className="flex items-center gap-0 border-b border-slate-800 shrink-0">
                <button onClick={() => setSeoTab('seo')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all border-b-2 ${seoTab==='seo' ? 'border-red-500 text-red-400 bg-slate-800/50' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                  📊 SEO
                  {seoLoading && <span className="text-yellow-400 animate-pulse">●</span>}
                  {seoResult && !seoLoading && <span className="text-green-400">✓</span>}
                </button>
                <button onClick={() => setSeoTab('thumb')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold transition-all border-b-2 ${seoTab==='thumb' ? 'border-pink-500 text-pink-400 bg-slate-800/50' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                  🖼️ Thumbnail AI
                  {aiThumbImg && <span className="text-green-400">✓</span>}
                </button>
                {/* Tạo lại SEO */}
                {seoTab === 'seo' && (
                  <div className="flex items-center gap-1.5 pr-2">
                    <button onClick={() => { setSeoResult(null); setSeoError(''); setSeoThumbImgs({}); setSeoThumbIdx(0); runSeoFromUrl(); }}
                      disabled={seoLoading || !sourceUrl.trim()}
                      title="Tạo lại SEO"
                      className="px-2 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white rounded text-xs font-bold transition-all">
                      {seoLoading ? '⏳' : '🔄'}
                    </button>
                  </div>
                )}
              </div>

              {/* SEO tab */}
              {seoTab === 'seo' && (
                <div className="flex-1 overflow-y-auto p-3">
                  {seoLoading && <div className="flex flex-col items-center justify-center h-32 gap-3 text-sm text-yellow-400"><span className="animate-spin text-3xl">⏳</span><span>Đang tạo SEO...</span></div>}
                  {seoError && <div className="text-sm text-red-400 p-3">❌ {seoError}</div>}
                  {!seoResult && !seoLoading && !seoError && <div className="flex flex-col items-center justify-center h-40 gap-3 text-center"><span className="text-5xl">📊</span><div className="text-sm text-slate-500 italic">Nhập URL nguồn và ấn Bắt đầu để tạo SEO tự động.</div></div>}
                  {seoResult && (
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-wider">✨ Tiêu đề gợi ý</div>
                        {(seoResult.titles || []).map((t, i) => {
                          const titleText = typeof t === 'object' ? t.title : t;
                          const score = typeof t === 'object' ? t.score : null;
                          return (
                          <div key={i} className="flex items-start gap-2 mb-2 group bg-slate-800/50 rounded-lg px-3 py-2">
                            <span className="text-xs text-indigo-400 shrink-0 font-bold mt-0.5">{i+1}.</span>
                            <div className="flex-1">
                              <span className="text-sm text-slate-100 leading-snug">{titleText}</span>
                              {score != null && <span className="ml-2 text-[10px] font-bold text-emerald-400">⚡{score}/100</span>}
                            </div>
                            <button onClick={() => navigator.clipboard.writeText(titleText)} title="Copy" className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-indigo-400 shrink-0 mt-0.5 transition-opacity">📋</button>
                          </div>
                          );
                        })}
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">🏷️ Tags</span>
                          <button onClick={() => navigator.clipboard.writeText(seoResult.tags||'')} className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">📋 copy</button>
                        </div>
                        <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/50 rounded-lg p-3">{seoResult.tags}</div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">📝 Mô tả</span>
                          <button onClick={() => navigator.clipboard.writeText(seoResult.description||'')} className="text-xs text-slate-500 hover:text-indigo-400 transition-colors">📋 copy</button>
                        </div>
                        <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-800/50 rounded-lg p-3 max-h-48 overflow-y-auto">{seoResult.description}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Thumbnail AI tab */}
              {seoTab === 'thumb' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {/* Controls row */}
                  <div className="flex items-center gap-3 bg-slate-800/50 rounded-lg px-3 py-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none flex-1">
                      <span className="text-xs text-slate-300 font-bold">Loại bỏ chữ trên ảnh</span>
                      <div onClick={() => setAiThumbRemText(v => !v)} className={`w-9 h-5 rounded-full relative cursor-pointer transition-all shrink-0 ${aiThumbRemText ? 'bg-pink-500' : 'bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${aiThumbRemText ? 'left-4.5' : 'left-0.5'}`} style={{left: aiThumbRemText ? 18 : 2}}/>
                      </div>
                    </label>
                    <button onClick={async () => { const f = await window.electronAPI?.selectFolder?.(); if(f){setAiThumbFolder(f);localStorage.setItem('fluxy_thumb_folder',f);} }}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-xs text-slate-300 font-bold transition-all shrink-0">
                      📁 {aiThumbFolder ? aiThumbFolder.replace(/\\/g,'/').split('/').pop() : 'Thư mục'}
                    </button>
                  </div>

                  {/* Nút hành động */}
                  <div className="flex gap-2">
                    <button onClick={() => runAiThumb('all')} disabled={aiThumbLoading || !sourceUrl.trim()}
                      className="flex-1 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-40 text-white rounded-xl text-sm font-black transition-all shadow-lg">
                      {aiThumbLoading ? '⏳ ' + (aiThumbMsg || 'Đang xử lý...') : '🎨 Phân tích & Vẽ thumbnail'}
                    </button>
                    {aiThumbPrompt && (
                      <button onClick={() => runAiThumb('draw')} disabled={aiThumbLoading}
                        title="Vẽ lại từ prompt hiện tại"
                        className="px-3 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white rounded-xl text-sm font-bold transition-all">
                        🖌️
                      </button>
                    )}
                  </div>

                  {aiThumbErr && <div className="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">❌ {aiThumbErr}</div>}

                  {/* Ảnh kết quả — hiện to */}
                  {aiThumbImg && (
                    <div className="space-y-2">
                      <img src={aiThumbImg} alt="thumbnail" className="w-full rounded-xl border border-slate-600 shadow-2xl"/>
                      <div className="flex gap-2">
                        <button onClick={() => { setAiThumbImg(null); runAiThumb('draw'); }} disabled={aiThumbLoading}
                          className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-bold transition-all">🔄 Vẽ lại</button>
                        <button onClick={() => { const a=document.createElement('a');a.href=aiThumbImg;a.download=`thumb_${Date.now()}.png`;a.click(); }}
                          className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs font-bold transition-all">⬇️ Tải về</button>
                      </div>
                    </div>
                  )}

                  {/* Prompt box */}
                  {aiThumbPrompt && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Prompt AI</span>
                        <button onClick={() => navigator.clipboard.writeText(aiThumbPrompt)} className="text-xs text-slate-500 hover:text-pink-400 transition-colors">📋 copy</button>
                      </div>
                      <textarea value={aiThumbPrompt} onChange={e => setAiThumbPrompt(e.target.value)} rows={5}
                        className="w-full px-3 py-2 bg-slate-800/60 border border-slate-700 rounded-lg text-xs text-slate-300 resize-none outline-none focus:border-pink-500/60 leading-relaxed"/>
                    </div>
                  )}

                  {!aiThumbPrompt && !aiThumbLoading && !aiThumbErr && (
                    <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                      <span className="text-5xl">🖼️</span>
                      <div className="text-sm text-slate-500 italic leading-relaxed">Nhập URL YouTube rồi ấn Bắt đầu<br/>AI tự lấy thumbnail gốc → phân tích → vẽ lại</div>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
        {/* Log bottom */}
        <div className="h-44 border-t border-slate-700/60 bg-slate-950 flex flex-col shrink-0">
          <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-800 shrink-0">
            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">⚡ Log</span>
            {(running || rfRunning) && <span className="text-[7px] text-blue-400 animate-pulse">● {rfRunning ? 'Review Phim đang chạy' : 'đang xử lý'}</span>}
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono">
            {logs.length === 0 && <div className="text-[9px] text-slate-700 italic">Nhật ký sẽ hiện ở đây...</div>}
            {logs.map((l, i) => (
              <div key={i} className={`text-[9px] leading-4 ${
                l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-green-400' :
                l.type === 'progress' ? 'text-blue-400' : 'text-slate-400'
              }`}>
                <span className="text-slate-600">[{l.t}]</span> {l.msg}
              </div>
            ))}
            <div ref={logEndRef}/>
          </div>
        </div>
      </div>
      </div>} {/* end RECREATE TAB */}
    </div>
  );
}


export { VideoCleanerPanel };

// ── BilibiliReupPanel ──────────────────────────────────────────────────────────
const fmtDurBili = (s) => { if (!s) return ''; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${String(sec).padStart(2,'0')}`; };
const fmtNumBili = (n) => { if (!n) return ''; if (n>=1e8) return (n/1e8).toFixed(1)+'亿'; if (n>=1e4) return (n/1e4).toFixed(1)+'万'; if (n>=1e3) return (n/1e3).toFixed(1)+'K'; return String(n); };

function BilibiliReupPanel({ onStartBatch, onStopBatch, pausedQueue, onClearPause, batchRunning, batchLogs, batchProgress,
  seoLang, onSeoLangChange,
  multiCount, setMultiCount, trimStart, setTrimStart, trimEnd, setTrimEnd,
  targetDurEnabled, setTargetDurEnabled, targetDurMinutes, setTargetDurMinutes,
  outputResolution, setOutputResolution,
  // Recreate settings
  varSpeed, setVarSpeed, varSpeedLevel, setVarSpeedLevel,
  pitchShift, setPitchShift,
  hFlip, setHFlip,
  colorShift, setColorShift, colorShiftLevel, setColorShiftLevel,
  zoomPct, setZoomPct,
  grainNoise, setGrainNoise, grainLevel, setGrainLevel,
  stereoFlip, setStereoFlip,
  bgNoise, setBgNoise, bgNoiseLevel, setBgNoiseLevel,
  kenBurns, setKenBurns,
  randomCut, setRandomCut,
  wmEnabled, setWmEnabled, wmText, setWmText,
  gpuMode, setGpuMode,
  audioVolume, setAudioVolume,
  slightRotate, setSlightRotate,
  hueRotate, setHueRotate,
  randomFps, setRandomFps,
  randomPosCrop, setRandomPosCrop,
  audioEQ, setAudioEQ,
}) {

  // Search state
  const [keyword, setKeyword]     = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore]     = useState(false);

  // Channel panel state
  const [channel, setChannel]     = useState(null); // { mid, name, items, loading, error, page, totalPages }

  // Queue + settings
  const [queue, setQueue]           = useState([]);
  const [mode, setMode]             = useState('single');
  const [outFolder, setOutFolder]   = useState(() => localStorage.getItem('bili_reup_out_folder') || '');
  const [view, setView]             = useState('search'); // 'search' | 'queue' | 'logs'
  const logEndRef = useRef(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [batchLogs]);

  const pickFolder = async () => {
    const r = await window.electronAPI?.openFolderDialog?.();
    if (r) { setOutFolder(r); localStorage.setItem('bili_reup_out_folder', r); }
  };

  const doSearch = async (kw, pg = 1) => {
    if (!kw.trim()) return;
    setSearching(true); setSearchErr('');
    if (pg === 1) { setResults([]); setHasMore(false); }
    try {
      const res = await window.electronAPI?.bilibiliSearch?.({ keyword: kw.trim(), page: pg });
      if (res?.error) { setSearchErr(res.error); return; }
      const items = res?.items || [];
      setResults(prev => pg === 1 ? items : [...prev, ...items]);
      setSearchPage(pg + 1);
      setHasMore(items.length >= 20);
    } catch (e) { setSearchErr(e.message); }
    finally { setSearching(false); }
  };

  const openChannel = async (mid, name, pg = 1) => {
    if (!mid) return;
    setChannel({ mid, name, items: pg === 1 ? [] : channel?.items || [], loading: true, error: '', page: pg, totalPages: 1 });
    try {
      const res = await window.electronAPI?.bilibiliChannelVideos?.({ mid, page: pg });
      if (res?.error) { setChannel(c => ({ ...c, loading: false, error: res.error })); return; }
      const newItems = res?.items || [];
      setChannel(c => ({ ...c, loading: false, name: res.channelName || name, items: pg === 1 ? newItems : [...(c?.items||[]), ...newItems], totalPages: res.totalPages || 1 }));
    } catch (e) { setChannel(c => ({ ...c, loading: false, error: e.message })); }
  };

  const addToQueue = (item) => {
    if (queue.find(q => q.bvid === item.bvid)) return;
    setQueue(prev => [...prev, { url: item.url, title: item.title, bvid: item.bvid, thumbnail: item.thumbnail }]);
  };
  const addAllToQueue = (items) => {
    const newItems = items.filter(it => !queue.find(q => q.bvid === it.bvid))
      .map(it => ({ url: it.url, title: it.title, bvid: it.bvid, thumbnail: it.thumbnail }));
    setQueue(prev => [...prev, ...newItems]);
  };
  const removeFromQueue = (bvid) => setQueue(prev => prev.filter(q => q.bvid !== bvid));
  const clearQueue = () => setQueue([]);

  const handleStart = () => {
    if (!queue.length) { alert('Thêm ít nhất 1 video vào hàng đợi!'); return; }
    onStartBatch(queue, mode, outFolder);
  };

  const inQueue = (bvid) => queue.some(q => q.bvid === bvid);

  // Video card for search results
  const VideoCard = ({ item, onAdd, added }) => (
    <div className="flex gap-2 p-2 rounded-lg bg-[#0d1221] hover:bg-[#131929] border border-slate-700/30 hover:border-pink-700/40 transition-all group">
      <div className="w-24 h-14 rounded overflow-hidden shrink-0 bg-slate-800 relative">
        {item.thumbnail && <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />}
        {item.duration > 0 && <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-[9px] text-white px-1 rounded">{fmtDurBili(item.duration)}</span>}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="text-[11px] text-white leading-4 line-clamp-2">{item.title}</div>
        <div className="flex items-center gap-2 mt-1">
          {item.author && (
            <button onClick={() => openChannel(item.mid, item.author)}
              className="text-[10px] text-blue-400 hover:text-blue-300 truncate max-w-[100px] text-left">
              @{item.author}
            </button>
          )}
          {item.play > 0 && <span className="text-[10px] text-slate-500">{fmtNumBili(item.play)} lượt</span>}
        </div>
      </div>
      <button onClick={() => onAdd(item)}
        className={`shrink-0 self-center px-2 py-1 rounded text-[11px] font-black transition-all ${added ? 'bg-emerald-700/40 text-emerald-400 border border-emerald-700/40' : 'bg-pink-700/30 text-pink-300 hover:bg-pink-600 hover:text-white border border-pink-700/40'}`}>
        {added ? '✓' : '＋'}
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Channel panel modal */}
      {channel && (
        <div className="absolute inset-0 z-30 flex bg-black/70 backdrop-blur-sm" onClick={() => setChannel(null)}>
          <div className="relative ml-auto w-[60vw] h-full bg-[#0b0f1a] flex flex-col shadow-2xl border-l border-slate-700"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-[#060a12] shrink-0">
              <button onClick={() => setChannel(null)} className="w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white">✕</button>
              <div className="flex-1">
                <div className="text-[13px] font-black text-white">📺 {channel.name || 'Kênh'}</div>
                <div className="text-[10px] text-slate-400">{channel.items.length} video · Trang {channel.page}/{channel.totalPages}</div>
              </div>
              <button onClick={() => addAllToQueue(channel.items)}
                className="px-3 py-1.5 bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-black rounded-lg transition-colors">
                ＋ Tất cả ({channel.items.length})
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2">
              {channel.loading && <div className="text-center text-slate-400 text-[12px] mt-6">Đang tải...</div>}
              {channel.error && <div className="text-red-400 text-[11px] text-center mt-4">{channel.error}</div>}
              {channel.items.map(item => (
                <VideoCard key={item.bvid} item={item} onAdd={addToQueue} added={inQueue(item.bvid)} />
              ))}
              {channel.page < channel.totalPages && !channel.loading && (
                <button onClick={() => openChannel(channel.mid, channel.name, channel.page + 1)}
                  className="w-full py-2 text-[12px] font-semibold text-blue-400 hover:text-blue-300 border border-slate-700 rounded-lg">
                  Tải thêm
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LEFT PANEL — Search + Settings */}
      <div className="w-[380px] flex-shrink-0 flex flex-col bg-[#0b0f1a] border-r border-slate-700/50" style={{ position: 'relative' }}>
        {/* Header + sub-nav */}
        <div className="px-3 pt-3 pb-2 border-b border-slate-700/50 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[16px]">🔴</span>
            <span className="text-[13px] font-black text-white uppercase tracking-wide">Bilibili Reup</span>
            {queue.length > 0 && (
              <span className="ml-auto bg-pink-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">{queue.length}</span>
            )}
          </div>
          <div className="flex gap-1.5">
            {[['search','🔍 Tìm video'],['queue',`📋 Hàng đợi (${queue.length})`],['settings','⚙️ Cài đặt']].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`flex-1 py-1 rounded text-[11px] font-black transition-all ${view === id ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* VIEW: SEARCH */}
        {view === 'search' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 pt-2 pb-2 shrink-0">
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-[#131929] border border-slate-600/60 rounded-lg text-[12px] text-white px-3 py-2 focus:outline-none focus:border-pink-500/60"
                  placeholder="Nhập từ khóa tìm kiếm Bilibili..."
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch(keyword)}
                />
                <button onClick={() => doSearch(keyword)}
                  disabled={searching}
                  className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-[12px] font-black rounded-lg transition-colors">
                  {searching ? '...' : '🔍'}
                </button>
              </div>
              {searchErr && <div className="text-red-400 text-[10px] mt-1">{searchErr}</div>}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 flex flex-col gap-2">
              {results.length === 0 && !searching && (
                <div className="text-slate-500 text-[11px] text-center mt-8">Tìm video Bilibili để thêm vào hàng đợi reup</div>
              )}
              {results.map(item => (
                <VideoCard key={item.bvid} item={item} onAdd={addToQueue} added={inQueue(item.bvid)} />
              ))}
              {hasMore && (
                <button onClick={() => doSearch(keyword, searchPage)} disabled={searching}
                  className="w-full py-2 text-[11px] font-semibold text-pink-400 hover:text-pink-300 border border-slate-700 rounded-lg disabled:opacity-50">
                  {searching ? 'Đang tải...' : 'Tải thêm'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* VIEW: QUEUE */}
        {view === 'queue' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between shrink-0">
              <span className="text-[11px] font-semibold text-slate-300 uppercase">{queue.length} video trong hàng đợi</span>
              {queue.length > 0 && <button onClick={clearQueue} className="text-[10px] text-red-400 hover:text-red-300">Xóa tất cả</button>}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-2 flex flex-col gap-2">
              {queue.length === 0 && (
                <div className="text-slate-500 text-[11px] text-center mt-8">Tìm và thêm video vào hàng đợi</div>
              )}
              {queue.map((item, i) => (
                <div key={item.bvid} className="flex items-center gap-2 bg-[#131929] rounded-lg px-2 py-1.5 border border-slate-700/30">
                  <span className="text-[10px] text-pink-400 font-mono w-5">{i+1}.</span>
                  {item.thumbnail && <img src={item.thumbnail} alt="" className="w-12 h-8 object-cover rounded" />}
                  <span className="flex-1 text-[10px] text-slate-200 line-clamp-2">{item.title}</span>
                  <button onClick={() => removeFromQueue(item.bvid)} className="text-[11px] text-red-400 hover:text-red-300 shrink-0">✕</button>
                </div>
              ))}
            </div>
            {/* Quick info */}
            <div className="border-t border-slate-700/50 px-3 py-2 shrink-0 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                Chế độ: <span className="text-pink-400 font-bold">{mode === 'single' ? '🔄 Single' : '📦 Multi bản'}</span>
              </span>
              <button onClick={() => setView('settings')} className="text-[10px] text-slate-400 hover:text-white underline">Cài đặt ›</button>
            </div>
          </div>
        )}

        {/* VIEW: SETTINGS */}
        {view === 'settings' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col min-h-0">
            <div className="px-3 py-2 flex flex-col gap-2">
              <div className="text-[11px] font-black text-slate-300 uppercase tracking-wide mb-1">⚙️ Cài đặt Pipeline</div>
              {/* Mode */}
              <div>
                <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wide">Chế độ reup</div>
                <div className="flex gap-1.5">
                  {[['single','🔄 Single','Tái tạo 1 bản duy nhất'],['multi','📦 Multi bản','Xuất nhiều bản biến thể']].map(([id,label,desc]) => (
                    <button key={id} onClick={() => setMode(id)} title={desc}
                      className={`flex-1 py-1.5 rounded text-[10px] font-black transition-all ${mode === id ? 'bg-pink-600 text-white shadow-md' : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700/40'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 italic">
                  {mode === 'single' && '↳ Tái tạo 1 bản duy nhất — né ContentID, SEO tự động'}
                  {mode === 'multi'  && '↳ Tạo nhiều bản biến thể khác nhau từ 1 video gốc'}
                </div>
              </div>
              {mode === 'multi' && (
                <div className="flex items-center gap-2 bg-orange-950/30 border border-orange-700/30 rounded-lg px-2 py-1.5">
                  <span className="text-[10px] text-orange-300 shrink-0 font-bold">Số bản:</span>
                  <input type="range" min={2} max={10} value={multiCount} onChange={e => setMultiCount(+e.target.value)} className="flex-1 accent-orange-500" />
                  <span className="text-[11px] text-orange-400 font-black w-5 text-center">{multiCount}</span>
                </div>
              )}
              {/* Trim */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">✂ Cắt đầu (giây)</div>
                  <input type="number" min={0} max={300} value={trimStart} onChange={e => setTrimStart(Math.max(0, Math.min(300, +e.target.value)))}
                    className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-pink-500/60" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 mb-1">✂ Cắt đuôi (giây)</div>
                  <input type="number" min={0} max={300} value={trimEnd} onChange={e => setTrimEnd(Math.max(0, Math.min(300, +e.target.value)))}
                    className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-pink-500/60" />
                </div>
              </div>
              {/* Target Duration */}
              {setTargetDurEnabled && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-1">
                    <button onClick={() => setTargetDurEnabled(v => !v)}
                      className={`w-9 h-5 rounded-full relative transition-all ${targetDurEnabled ? 'bg-orange-600' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${targetDurEnabled ? 'left-4' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">⏱ Căn thời lượng mục tiêu</span>
                  </label>
                  {targetDurEnabled && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {[{r:'<3p',v:2,c:'text-pink-400'},{r:'8-20p',v:15,c:'text-green-400'},{r:'20-35p',v:25,c:'text-blue-400'},{r:'>60p',v:70,c:'text-yellow-400'}].map(({r,v,c}) => (
                        <button key={v} onClick={() => setTargetDurMinutes(v)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${targetDurMinutes === v ? 'bg-orange-600/30 ring-1 ring-orange-500' : 'bg-slate-800 hover:bg-slate-700'}`}>
                          <span className={c}>{r}</span>
                        </button>
                      ))}
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" max="180" value={targetDurMinutes}
                          onChange={e => setTargetDurMinutes(Math.max(1, Math.min(180, parseInt(e.target.value)||1)))}
                          className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-orange-300 text-center outline-none"/>
                        <span className="text-[10px] text-slate-500">phút</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* SEO lang */}
              <div>
                <div className="text-[11px] text-blue-300 font-black mb-1 uppercase tracking-wide">🌐 Ngôn ngữ SEO & Tiêu đề</div>
                <div className="flex gap-1 flex-wrap">
                  {[['vi','🇻🇳 Tiếng Việt'],['en','🇺🇸 Tiếng Anh'],['zh','🇨🇳 Tiếng Trung'],['ja','🇯🇵 Tiếng Nhật'],['ko','🇰🇷 Tiếng Hàn'],['th','🇹🇭 Tiếng Thái'],['id','🇮🇩 Tiếng Indo']].map(([code, label]) => (
                    <button key={code} onClick={() => onSeoLangChange(code)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${seoLang === code ? 'bg-pink-600 text-white' : 'bg-slate-700/60 text-slate-400 hover:bg-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── RECREATE SETTINGS ── */}
              <div className="border-t border-slate-700/40 pt-2">
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-wide mb-2">🎛️ Hiệu ứng tái tạo video</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-2">
                  {[
                    ['Lật ngang', hFlip, setHFlip],
                    ['Thay tốc độ', varSpeed, setVarSpeed],
                    ['Đổi màu sắc', colorShift, setColorShift],
                    ['Hạt nhiễu', grainNoise, setGrainNoise],
                    ['Lật stereo', stereoFlip, setStereoFlip],
                    ['Tiếng nền', bgNoise, setBgNoise],
                    ['Cắt ngẫu nhiên', randomCut, setRandomCut],
                    ['FPS ngẫu nhiên', randomFps, setRandomFps],
                    ['Xoay nhẹ', slightRotate, setSlightRotate],
                    ['Hue rotate', hueRotate, setHueRotate],
                    ['Crop vị trí', randomPosCrop, setRandomPosCrop],
                    ['Equalizer', audioEQ, setAudioEQ],
                  ].map(([label, val, setter]) => (
                    <label key={label} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <button onClick={() => setter?.(v => !v)}
                        className={`w-7 h-3.5 rounded-full relative transition-all shrink-0 ${val ? 'bg-pink-600' : 'bg-slate-600'}`}>
                        <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${val ? 'left-3.5' : 'left-0.5'}`}/>
                      </button>
                      <span className="text-[10px] text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">🎵 Pitch: <span className="text-pink-400 font-bold">{pitchShift > 0 ? '+' : ''}{pitchShift} st</span></span>
                  <input type="range" min={-5} max={5} step={1} value={pitchShift} onChange={e => setPitchShift?.(+e.target.value)} className="flex-1 accent-pink-500"/>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">🔍 Zoom: <span className="text-pink-400 font-bold">{zoomPct}%</span></span>
                  <input type="range" min={1} max={8} step={1} value={zoomPct} onChange={e => setZoomPct?.(+e.target.value)} className="flex-1 accent-pink-500"/>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-slate-400 shrink-0 w-24">🔊 Âm lượng: <span className="text-pink-400 font-bold">{audioVolume}%</span></span>
                  <input type="range" min={80} max={120} step={1} value={audioVolume} onChange={e => setAudioVolume?.(+e.target.value)} className="flex-1 accent-pink-500"/>
                </div>
                {bgNoise && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] text-slate-400 shrink-0 w-24">🌊 Tiếng nền: <span className="text-pink-400 font-bold">{bgNoiseLevel}%</span></span>
                    <input type="range" min={1} max={10} step={1} value={bgNoiseLevel} onChange={e => setBgNoiseLevel?.(+e.target.value)} className="flex-1 accent-pink-500"/>
                  </div>
                )}
                {varSpeed && (
                  <div className="mb-1.5">
                    <div className="text-[10px] text-slate-400 mb-1">⚡ Mức thay tốc độ</div>
                    <div className="flex gap-1">
                      {[['light','Nhẹ'],['medium','Vừa'],['strong','Mạnh']].map(([v,l]) => (
                        <button key={v} onClick={() => setVarSpeedLevel?.(v)}
                          className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${varSpeedLevel === v ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
                {colorShift && (
                  <div className="mb-1.5">
                    <div className="text-[10px] text-slate-400 mb-1">🎨 Mức đổi màu</div>
                    <div className="flex gap-1">
                      {[['light','Nhẹ'],['medium','Vừa'],['strong','Mạnh']].map(([v,l]) => (
                        <button key={v} onClick={() => setColorShiftLevel?.(v)}
                          className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${colorShiftLevel === v ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mb-1.5">
                  <div className="text-[10px] text-slate-400 mb-1">📷 Ken Burns</div>
                  <div className="flex gap-1">
                    {[['none','Tắt'],['slow','Chậm'],['fast','Nhanh']].map(([v,l]) => (
                      <button key={v} onClick={() => setKenBurns?.(v)}
                        className={`flex-1 py-0.5 rounded text-[10px] font-bold transition-all ${kenBurns === v ? 'bg-pink-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="mb-1.5">
                  <div className="text-[10px] text-slate-400 mb-1">🖥️ GPU encode</div>
                  <div className="flex gap-1 flex-wrap">
                    {[['auto','Tự động'],['nvidia','NVIDIA'],['amd','AMD'],['cpu','CPU']].map(([v,l]) => (
                      <button key={v} onClick={() => setGpuMode?.(v)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${gpuMode === v ? 'bg-slate-500 text-white' : 'bg-slate-700 text-slate-400'}`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="mb-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                    <button onClick={() => setWmEnabled?.(v => !v)}
                      className={`w-7 h-3.5 rounded-full relative transition-all shrink-0 ${wmEnabled ? 'bg-orange-500' : 'bg-slate-600'}`}>
                      <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${wmEnabled ? 'left-3.5' : 'left-0.5'}`}/>
                    </button>
                    <span className="text-[10px] text-slate-300">🏷️ Watermark kênh</span>
                  </label>
                  {wmEnabled && (
                    <input value={wmText} onChange={e => setWmText?.(e.target.value)} placeholder="Tên kênh..."
                      className="w-full bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-orange-500/60"/>
                  )}
                </div>
              </div>

              {/* Folder */}
              <div className="flex gap-2">
                <div className="flex-1 bg-[#131929] border border-slate-600/60 rounded px-2 py-1 text-[10px] text-slate-400 truncate">
                  {outFolder || 'Chưa chọn thư mục...'}
                </div>
                <button onClick={pickFolder} className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[11px] rounded">📁</button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: LOGS (mobile/left-side) — hidden, shown in right panel */}
        {view === 'logs' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px]">
            {batchLogs.length === 0 && <div className="text-slate-500 text-center mt-8">Chưa có nhật ký</div>}
            {batchLogs.map((l, i) => (
              <div key={i} className={`leading-5 whitespace-pre-wrap break-words ${l.type==='error'?'text-red-400':l.type==='success'?'text-emerald-400':l.type==='warn'?'text-yellow-400':'text-slate-300'}`}>
                <span className="text-slate-600 mr-1.5">[{l.t}]</span>{l.msg}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Bottom action */}
        <div className="p-3 border-t border-slate-700/50 shrink-0 space-y-2">
          {batchRunning ? (
            <button onClick={onStopBatch} className="w-full py-2.5 rounded-lg text-[13px] font-black bg-amber-700 hover:bg-amber-600 text-white transition-colors">
              ⏸ Tạm dừng
            </button>
          ) : (
            <>
              {pausedQueue?.length > 0 && (
                <button onClick={() => { onStartBatch(pausedQueue, mode, outFolder); }}
                  className="w-full py-2.5 rounded-lg text-[13px] font-black bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-lg shadow-emerald-900/40">
                  ▶ Tiếp tục ({pausedQueue.length} video còn lại)
                </button>
              )}
              <button onClick={handleStart} className="w-full py-2.5 rounded-lg text-[13px] font-black bg-pink-600 hover:bg-pink-500 text-white transition-colors shadow-lg shadow-pink-900/40">
                🚀 Bắt đầu Reup ({queue.length})
              </button>
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — Logs (full) */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#07090f]">
        <div className="px-4 py-2.5 border-b border-slate-700/50 shrink-0 flex items-center justify-between">
          <span className="text-[13px] font-black text-white">
            {batchRunning ? `⚙️ Đang xử lý ${batchProgress.cur}/${batchProgress.total} video` : '📋 Nhật ký'}
          </span>
          {batchRunning && batchProgress.total > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-40 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-pink-500 rounded-full transition-all"
                  style={{ width: `${Math.round(batchProgress.cur / batchProgress.total * 100)}%` }} />
              </div>
              <span className="text-[11px] text-pink-400 font-black">{Math.round(batchProgress.cur / batchProgress.total * 100)}%</span>
            </div>
          )}
        </div>
        {/* Now Processing Card — Bilibili */}
        {batchRunning && batchProgress?.thumbnail && (() => {
          const STEPS = [
            { key: 'download',  icon: '⬇', label: 'Tải về' },
            { key: 'process',   icon: '⚙', label: 'Xử lý' },
            { key: 'seo',       icon: '🔍', label: 'SEO' },
            { key: 'thumbnail', icon: '🖼', label: 'Thumbnail' },
          ];
          const curStepIdx = STEPS.findIndex(s => s.key === batchProgress.step);
          return (
            <div className="mx-3 my-2 rounded-xl border border-pink-700/40 bg-pink-950/20 p-3 shrink-0">
              <div className="flex gap-3 items-start mb-3">
                <img src={batchProgress.thumbnail} alt="" className="w-20 h-12 object-cover rounded-lg shrink-0 border border-slate-700/50"/>
                <div className="min-w-0">
                  <div className="text-[10px] text-pink-400 font-black uppercase tracking-wider mb-0.5">Đang xử lý</div>
                  <div className="text-[12px] text-white font-bold leading-4 line-clamp-2">{batchProgress.title}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {STEPS.map((s, idx) => {
                  const done = curStepIdx > idx;
                  const active = curStepIdx === idx;
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black transition-all
                        ${done ? 'bg-emerald-600 text-white' : active ? 'bg-pink-600 text-white ring-2 ring-pink-400 ring-offset-1 ring-offset-[#07090f]' : 'bg-slate-800 text-slate-600'}`}>
                        {done ? '✓' : s.icon}
                      </div>
                      <div className={`text-[9px] font-bold ${active ? 'text-pink-300' : done ? 'text-emerald-500' : 'text-slate-600'}`}>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px]">
          {batchLogs.length === 0 ? (
            <div className="font-sans space-y-4">
              {/* STATS */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">📊 Thống kê</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Đã reup', value: (() => { try { return JSON.parse(localStorage.getItem('bili_reup_done_ids') || '[]').length; } catch { return 0; } })(), color: 'text-pink-400', bg: 'bg-pink-900/20 border-pink-700/30' },
                    { label: 'Hàng đợi', value: queue.length, color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700/30' },
                    { label: 'Kết quả tìm', value: results.length, color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-700/30' },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`rounded-xl border px-3 py-3 text-center ${bg}`}>
                      <div className={`text-[22px] font-black ${color}`}>{value}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CẤU HÌNH HIỆN TẠI */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">⚙️ Cấu hình Pipeline</div>
                <div className="bg-[#0d1221] border border-slate-700/40 rounded-xl p-3 space-y-1.5">
                  {[
                    ['Chế độ', mode === 'single' ? '🔄 Single' : `📦 Multi (${multiCount} bản)`],
                    ['Độ phân giải', outputResolution === 'source' ? 'Gốc' : outputResolution || 'Gốc'],
                    ['Ngôn ngữ SEO', {'vi':'🇻🇳 Tiếng Việt','en':'🇺🇸 Tiếng Anh','zh':'🇨🇳 Tiếng Trung','ja':'🇯🇵 Tiếng Nhật','ko':'🇰🇷 Tiếng Hàn','th':'🇹🇭 Tiếng Thái','id':'🇮🇩 Tiếng Indo'}[seoLang] || seoLang],
                    (trimStart > 0 || trimEnd > 0) && ['Cắt video', `✂ đầu ${trimStart}s · cuối ${trimEnd}s`],
                    targetDurEnabled && ['Thời lượng mục tiêu', `⏱ ${targetDurMinutes} phút`],
                    ['Thư mục', outFolder ? (outFolder.split(/[\\/]/).pop() || outFolder) : '⚠ Chưa chọn'],
                  ].filter(Boolean).map(([k,v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">{k}</span>
                      <span className="text-[10px] font-bold text-white">{v}</span>
                    </div>
                  ))}

                  {/* Hiệu ứng tái tạo */}
                  <div className="border-t border-slate-700/40 pt-1.5 mt-1.5">
                    <div className="text-[9px] text-pink-400 font-bold uppercase tracking-wide mb-1.5">🎛️ Hiệu ứng tái tạo</div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        [hFlip, '↔ Lật ngang'],
                        [varSpeed, `⚡ Tốc độ (${varSpeedLevel})`],
                        [colorShift, `🎨 Màu (${colorShiftLevel})`],
                        [grainNoise, '🌫 Hạt nhiễu'],
                        [stereoFlip, '🔊 Stereo flip'],
                        [bgNoise, `🌊 Tiếng nền ${bgNoiseLevel}%`],
                        [randomCut, '✂ Cắt ngẫu nhiên'],
                        [randomFps, '🎞 FPS ngẫu nhiên'],
                        [slightRotate, '🔄 Xoay nhẹ'],
                        [hueRotate, '🌈 Hue rotate'],
                        [randomPosCrop, '📐 Crop vị trí'],
                        [audioEQ, '🎚 Equalizer'],
                        [kenBurns !== 'none', `📷 Ken Burns (${kenBurns})`],
                        [wmEnabled, `🏷 WM: ${wmText || '(trống)'}`],
                      ].filter(([on]) => on).map(([, label]) => (
                        <span key={label} className="px-1.5 py-0.5 bg-pink-900/30 border border-pink-700/40 rounded text-[9px] text-pink-300">{label}</span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                      {[
                        `🎵 Pitch: ${pitchShift > 0 ? '+' : ''}${pitchShift} st`,
                        `🔍 Zoom: ${zoomPct}%`,
                        `🔊 Âm lượng: ${audioVolume}%`,
                        `🖥️ GPU: ${gpuMode}`,
                      ].map(v => (
                        <span key={v} className="text-[9px] text-slate-400">{v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* QUEUE PREVIEW */}
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">
                  📋 Hàng đợi {queue.length > 0 ? `(${queue.length} video)` : ''}
                </div>
                {queue.length === 0 ? (
                  <div className="bg-[#0d1221] border border-dashed border-slate-700/50 rounded-xl p-6 text-center text-slate-600 text-[11px]">
                    Chưa có video nào trong hàng đợi<br/>
                    <span className="text-[10px]">Tìm kiếm → click vào video để chọn</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {queue.map((v, i) => (
                      <div key={v.bvid} className="flex items-center gap-2 bg-[#0d1221] border border-slate-700/30 rounded-lg px-2.5 py-2">
                        <span className="text-[10px] text-pink-500 font-mono w-5 shrink-0">{i+1}.</span>
                        {v.thumbnail && <img src={v.thumbnail} alt="" className="w-10 h-7 object-cover rounded shrink-0"/>}
                        <span className="flex-1 text-[10px] text-slate-300 line-clamp-2 leading-4">{v.title}</span>
                        <button onClick={() => setQueue(prev => prev.filter(q => q.bvid !== v.bvid))} className="text-slate-600 hover:text-red-400 shrink-0 text-[11px]">✕</button>
                      </div>
                    ))}
                    {queue.length > 0 && (
                      <div className="text-center pt-1">
                        <span className="text-[10px] text-slate-600">Vào tab <b className="text-slate-400">Hàng đợi</b> để cấu hình pipeline trước khi chạy</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <BatchLogDisplay logs={batchLogs} accentColor="pink" logEndRef={logEndRef} batchRunning={batchRunning} batchProgress={batchProgress}/>
        </div>
      </div>
    </div>
  );
}
