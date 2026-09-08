import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateSeoMetadata, generateThumbnailPromptsOnly, analyzeThumbImageToPrompt } from './CreatorStudio';
import { generateCinematicPrompts, setGeminiPromptModel } from '../services/geminiPrompt';
import { generateScript } from '../services/scriptGenerator';
import { analyzeAndCloneScript, uploadVideoToGemini } from '../services/geminiClone';
import {
  transcribeAudio, transcribeAudioChunked,
  createTimeBasedChunks, createNaturalChunks,
  analyzeScenes, analyzeOverallContent,
  analyzeScenesContinuity,
  exportToTxt, exportToJson, exportToMarkdown,
  generateStockKeywordsAI,
  analyzeForGeminiStock,
  setAudioToVideoLLMModel,
} from '../services/audioToVideo';
import { transcribeLocalChunked } from '../services/whisperLocal.js';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import { generateScriptClaude } from '../services/claudeService';
import { generateCinematicPromptsClaude, analyzeScenesClaude, analyzeOverallContentClaude, callClaudeVision } from '../services/claudePrompt';
import { loadGroqKeys, loadGroqModel, DEFAULT_GROQ_MODEL, transcribeGroqChunked, callGroqWithRotation } from '../services/groqService';
import { generateScriptGroq, generateCinematicPromptsGroq, analyzeOverallContentGroq, analyzeScenesToGroq, generateStockKeywordsGroq } from '../services/groqPrompt';
import {
  Play, Square, Pause, FolderOpen, CheckCircle2, Loader2, Zap, Music2,
  AlertCircle, ChevronRight, ChevronLeft, Film, Image as ImageIcon, Sparkles,
  FileText, Brain, Layers, Copy, Check, ChevronDown, ChevronUp,
  Video, Scissors, ExternalLink, Cpu, Wand2,
  UploadCloud, Download, Clock, Mic, RefreshCw,
  Languages, Flame, Terminal, Link, Volume2, VolumeX, X, Users, ImagePlus, Plus,
} from 'lucide-react';


// ─── Constants ───────────────────────────────────────────────────────────────
const LS_KEYS        = 'fluxy_gemini_api_keys';
const LS_CLAUDE_KEY  = 'fluxy_claude_api_key';
const LS_CLAUDE_MDL  = 'fluxy_claude_model';
const CLAUDE_DEFAULT = 'claude-sonnet-4-5';
function loadClaudeKey()   { return localStorage.getItem(LS_CLAUDE_KEY)  || ''; }
function loadClaudeModel() { return localStorage.getItem(LS_CLAUDE_MDL)  || CLAUDE_DEFAULT; }

const PLATFORMS = ['TikTok dọc', 'YouTube ngang', 'YouTube Shorts', 'Instagram Reels', 'Facebook'];
const LANGUAGES = [
  { v: 'vi',   l: 'Tiếng Việt'   },
  { v: 'en',   l: 'English'      },
  { v: 'ja',   l: '日本語'        },
  { v: 'zh',   l: 'Tiếng Trung'  },
  { v: 'ko',   l: '한국어'        },
  { v: 'fr',   l: 'Français'     },
  { v: 'es',   l: 'Español'      },
  { v: 'de',   l: 'Deutsch'      },
  { v: 'th',   l: 'ภาษาไทย'      },
  { v: 'none', l: 'Không lời thoại' },
];

// Tự động chọn tỉ lệ khung hình theo nền tảng
const PLATFORM_RATIO = {
  'TikTok dọc':       '9:16',
  'YouTube ngang':    '16:9',
  'YouTube Shorts':   '9:16',
  'Instagram Reels':  '9:16',
  'Facebook':         '16:9',
};
const STYLES    = ['Photorealistic', 'Cinematic 4K', 'Anime / Manga', 'Pixar 3D', 'Studio Ghibli', 'Dark Fantasy', 'Watercolor'];
// Map style label → exact prompt description dùng làm art_style lock
const STYLE_MAP = {
  'Photorealistic': 'Ultra-realistic photography, photorealistic render, 8K resolution, natural skin texture, real-world lighting, hyper-detailed DSLR quality — NO illustration, NO animation, NO cartoon, NO drawing, NO Ghibli, NO anime',
  'Cinematic 4K':   'Cinematic 4K film quality, anamorphic lens, dramatic depth of field, professional color grading, film grain, Hollywood-level production — NO illustration, NO cartoon, NO anime',
  'Anime / Manga':  'Japanese anime 2D animation, clean sharp line art, cel-shaded flat coloring, expressive anime eyes, vibrant saturated palette, manga-inspired — NO photorealism, NO 3D render, NO Ghibli watercolor',
  'Pixar 3D':       'Pixar/Disney 3D CGI, smooth subsurface scattering, warm key lighting, polished 3D render, expressive stylized characters — NO 2D illustration, NO photorealism, NO anime',
  'Studio Ghibli':  'Studio Ghibli 2D hand-drawn animation, soft watercolor backgrounds, warm muted tones, expressive faces, gentle painterly line art — NO 3D render, NO photorealism, NO dark tones',
  'Dark Fantasy':   'Dark fantasy digital painting, dramatic chiaroscuro, deep gothic shadows, epic fantasy illustration, moody desaturated palette, detailed brushwork — NO photorealism, NO cartoon',
  'Watercolor':     'Traditional watercolor painting, soft wet-on-wet washes, gentle color bleeds, textured paper, loose brushstrokes, delicate pastel tones — NO photorealism, NO digital clean render',
};
const AUDIENCES = [
  'Người trẻ (Gen Z & Alpha)', 'Dân văn phòng & Công sở',
  'Người mê lịch sử & Văn hóa', 'Người thích chữa lành & Chill',
  'Fan phim kinh dị & Bí ẩn', 'Người kinh doanh & Khởi nghiệp',
  'Phụ huynh & Trẻ em', 'Người yêu thiên nhiên & Du lịch',
];
const GOALS = [
  'Giải trí & Viral', 'Kể chuyện lịch sử kịch tính',
  'Giáo dục & Kiến thức', 'Truyền cảm hứng & Động lực',
  'Kinh dị & Bí ẩn', 'Quảng bá thương hiệu/Sản phẩm',
  'Phim tài liệu & Khám phá', 'Hành trình & Trải nghiệm (Vlog)',
];
const TONES = [
  'Bí tráng & Hào hùng', 'Căng thẳng & Kịch tính',
  'Thư giãn & ASMR', 'Bí ẩn & Ma mị',
  'Hài hước & Châm biếm', 'Sâu lắng & Cảm động',
  'Hiện đại & Năng động', 'Hoài cổ & Cinematic',
];
const RATIOS      = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const IMG_QUALITY = ['1K', '2K', '4K'];
const DURS_VEO    = [4, 6, 8];
const IMG_MDL     = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite'];
const VID_MDL   = ['Veo 3.1 - Lite [Lower Priority]', 'Omni 1.1 Flash'];
const VOICE_LIST = [
  { id: '',                gender: null,      label: 'Không có giọng' },
  { id: 'random',          gender: null,      label: '🎲 Ngẫu nhiên' },
  { id: 'achernar',        gender: 'female',  label: 'Achernar — Nữ, nhẹ nhàng, cao' },
  { id: 'achird',          gender: 'male',    label: 'Achird — Nam, thân thiện, trung' },
  { id: 'algenib',         gender: 'male',    label: 'Algenib — Nam, khàn, trầm' },
  { id: 'algieba',         gender: 'male',    label: 'Algieba — Nam, dễ chịu, trầm-vừa' },
  { id: 'alnilam',         gender: 'male',    label: 'Alnilam — Nam, cứng rắn, trầm-vừa' },
  { id: 'leda',            gender: 'female',  label: 'Leda — Nữ, trẻ trung, trung-cao' },
  { id: 'orus',            gender: 'male',    label: 'Orus — Nam, cứng, trầm-vừa' },
  { id: 'puck',            gender: 'male',    label: 'Puck — Nam, sôi nổi, trung' },
  { id: 'pulcherrima',     gender: 'neutral', label: 'Pulcherrima — Trung tính, mạnh, trung-cao' },
  { id: 'rasalgethi',      gender: 'male',    label: 'Rasalgethi — Nam, thông tin, trung' },
  { id: 'sadachbia',       gender: 'male',    label: 'Sadachbia — Nam, linh hoạt, thấp' },
  { id: 'sadaltager',      gender: 'male',    label: 'Sadaltager — Nam, am hiểu, trung' },
  { id: 'schedar',         gender: 'male',    label: 'Schedar — Nam, đều đặn, trầm-vừa' },
  { id: 'sulafat',         gender: 'female',  label: 'Sulafat — Nữ, ấm áp, trung' },
  { id: 'umbriel',         gender: 'male',    label: 'Umbriel — Nam, mượt mà, thấp' },
  { id: 'vindemiatrix',    gender: 'female',  label: 'Vindemiatrix — Nữ, nhẹ nhàng, trung' },
  { id: 'zephyr',          gender: 'female',  label: 'Zephyr — Nữ, tươi sáng, trung-cao' },
  { id: 'zubenelgenubi',   gender: 'male',    label: 'Zubenelgenubi — Nam, thoải mái, trầm-vừa' },
];
// Pool giọng để random (loại bỏ '', 'random')
const VOICE_POOL         = VOICE_LIST.filter(v => v.id && v.id !== 'random');
// ─── Clean dialogue text — loại bỏ stutter/lặp từ transcript hoặc TTS ──────
// VD: "But here's the But here's the cold" → "But here's the cold"
//     "Don't miss it. Don't miss it."      → "Don't miss it."
//     "and and avoid"                       → "and avoid"
function cleanDialogueText(text) {
  if (!text || typeof text !== 'string') return text;
  let s = text.replace(/\s+/g, ' ').trim();
  // Pass 1: Xóa stutter-restart — cùng N từ lặp liên tiếp (n=7 xuống 2)
  for (let n = 7; n >= 2; n--) {
    const w   = `[\\w''\\-]+`;
    const grp = `(?:${w}\\s+){${n - 1}}${w}`;
    const re  = new RegExp(`(${grp})[,.]?\\s+\\1`, 'gi');
    let prev;
    do { prev = s; s = s.replace(re, '$1'); } while (s !== prev);
  }
  // Pass 2: Xóa từ đơn lặp (kể cả có dấu phẩy giữa)
  s = s.replace(/\b(\w+)[,.]?\s+\1\b/gi, '$1');
  // Pass 3: Xóa câu trùng liên tiếp
  const parts   = s.split(/(?<=[.!?])\s+/);
  const norm    = t => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();
  const deduped = parts.filter((p, i) => i === 0 || norm(p) !== norm(parts[i - 1]));
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Dedup helper — dùng chung cho mọi panel ───────────────────────────────
// Loại bỏ tasks trùng prompt trước khi gửi server; track submittedIds để chặn re-send
function dedupTasksByPrompt(tasks, logFn) {
  const seenKeys = new Set();
  const result = [];
  for (const t of tasks) {
    // Key = prompt + voiceId (nếu có) — phân biệt cùng prompt nhưng khác giọng
    const promptKey = (t.prompt || '').trim();
    const voiceKey  = t.voiceId || '';
    const imgKey    = (t.ingredientImages || []).join('|');
    const mediaKey  = (t.ingredientMediaIds || []).join('|');
    const fullKey   = `${promptKey}||${voiceKey}||${imgKey}||${mediaKey}`;

    if (promptKey && seenKeys.has(fullKey)) {
      logFn?.(`⚠️ Bỏ qua task trùng hoàn toàn (prompt+voice+DNA): ${t.id}`, 'info');
    } else {
      if (promptKey) seenKeys.add(fullKey);
      result.push(t);
    }
  }
  if (result.length < tasks.length)
    logFn?.(`⚠️ Loại bỏ ${tasks.length - result.length} task trùng lặp trước khi gửi server`, 'info');
  return result;
}
function makeSubmitGuard() {
  const submittedIds = new Set();
  return function filterUnsent(tasks, logFn) {
    const safe = tasks.filter(t => {
      if (submittedIds.has(t.id)) {
        logFn?.(`⚠️ Task ${t.id} đã gửi — bỏ qua để tránh video trùng`, 'error');
        return false;
      }
      return true;
    });
    safe.forEach(t => submittedIds.add(t.id));
    return safe;
  };
}
const VOICE_POOL_MALE    = VOICE_POOL.filter(v => v.gender === 'male');
const VOICE_POOL_FEMALE  = VOICE_POOL.filter(v => v.gender === 'female');
const VOICE_POOL_NEUTRAL = VOICE_POOL.filter(v => v.gender === 'neutral');

// ── Pre-upload Ingredient images → thay ingredientImages bằng ingredientMediaIds ──
// Upload từng đường dẫn file duy nhất 1 lần, tất cả tasks dùng chung mediaId
async function preUploadIngredients(tasks, logFn) {
  if (!window.electronAPI?.uploadDnaImage) return tasks;
  const uniquePaths = [...new Set(tasks.flatMap(t => t.ingredientImages || []))];
  if (!uniquePaths.length) return tasks;
  logFn?.(`⬆️ Pre-upload ${uniquePaths.length} ảnh Ingredient (1 lần, tất cả tasks dùng chung)...`, 'info');
  const pathToId = {};
  for (const p of uniquePaths) {
    try {
      const r = await window.electronAPI.uploadDnaImage({ imgPath: p, taskId: 'pre_ingr' });
      if (r?.mediaId) { pathToId[p] = r.mediaId; logFn?.(`✅ ${p.split(/[\\/]/).pop()} → ${r.mediaId}`, 'success'); }
      else logFn?.(`⚠️ Upload không có mediaId: ${p.split(/[\\/]/).pop()}`, 'warn');
    } catch (e) { logFn?.(`⚠️ Upload lỗi: ${p.split(/[\\/]/).pop()}: ${e.message}`, 'warn'); }
  }
  return tasks.map(t => {
    if (!t.ingredientImages?.length) return t;
    const ids = t.ingredientImages.map(p => pathToId[p]).filter(Boolean);
    if (!ids.length) return t; // upload failed → giữ nguyên fallback path
    const { ingredientImages: _removed, ...rest } = t;
    return { ...rest, ingredientMediaIds: [...(rest.ingredientMediaIds || []), ...ids] };
  });
}

// ── Policy violation helpers ─────────────────────────────────────────────────
const POLICY_REGEX = /safety|policy|violat|content.?filter|inappropriat|harmful|prohibited|blocked|community.?guideline|terms.of.service|unable.to.generate|cannot.generate|not.able.to|restricted|flagged|adult.content|nsfw|explicit|PROMINENT_PEOPLE|prominent.people|public.figure|real.person|celebrity.filter/i;

// Suffix an toàn — thêm vào TẤT CẢ prompt gửi Veo để tránh vi phạm chính sách
const VEO_SAFE_SUFFIX = ', safe for all audiences, family-friendly, no graphic violence, no blood or gore, no adult or sexual content, no nudity, no weapons displayed aggressively, no disturbing imagery, tasteful and cinematic, appropriate for general viewing';

function isPolicyViolation(errorMsg) {
  return POLICY_REGEX.test(errorMsg || '');
}

// Làm sạch prompt vi phạm: strip tên người + thay từ nhạy cảm + safe suffix
function sanitizePrompt(prompt) {
  if (!prompt) return '';
  // Bước 0: luôn strip tên người trước (tránh PROMINENT_PEOPLE error)
  prompt = stripProminentPeople(prompt);
  // Thay từ nhạy cảm bằng mô tả trung tính (không xóa hẳn để tránh câu vô nghĩa)
  const BANNED_MAP = [
    [/\bblood(?:y|ied)?\b/gi,           'dramatic scene'],
    [/\bgore\b/gi,                        'intense moment'],
    [/\bviolent(?:ly)?\b/gi,             'intense'],
    [/\bweapons?\b/gi,                    'objects'],
    [/\bguns?\b/gi,                       'equipment'],
    [/\bkni(?:fe|ves)\b/gi,              'tool'],
    [/\bswords?\b/gi,                     'prop'],
    [/\bmurder\b/gi,                      'dramatic confrontation'],
    [/\bkill(?:ing|ed|er)?\b/gi,         'defeat'],
    [/\bcorpse\b/gi,                      'figure'],
    [/\bnude\b|\bnaked\b/gi,             'person'],
    [/\bexplicit\b|\berotic\b/gi,        'dramatic'],
    [/\bsexual\b|\bnsfw\b/gi,            'emotional'],
    [/\bhate.speech\b/gi,                'argument'],
    [/\bterrorist?\b/gi,                  'character'],
    [/\bbomb\b/gi,                        'object'],
    [/\btorture\b/gi,                     'difficult scene'],
    [/\bexecut(?:e|ion|ed)\b/gi,         'dramatic scene'],
    [/\bslaughter\b|\bmassacre\b/gi,     'dramatic event'],
    [/\bdecapitat\w*/gi,                  'action scene'],
  ];
  let cleaned = prompt;
  BANNED_MAP.forEach(([regex, replacement]) => {
    cleaned = cleaned.replace(regex, replacement);
  });
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Thêm safe suffix nếu chưa có
  if (!cleaned.toLowerCase().includes('safe for all') && !cleaned.toLowerCase().includes('family-friendly')) {
    cleaned += VEO_SAFE_SUFFIX;
  }
  return cleaned;
}

// Áp dụng safe suffix vào prompt khi tạo task lần đầu (không thay từ, chỉ thêm suffix)
function applyVeoPolicy(prompt) {
  if (!prompt) return '';
  const p = prompt.trim();
  if (p.toLowerCase().includes('safe for all') || p.toLowerCase().includes('family-friendly')) return p;
  return p + VEO_SAFE_SUFFIX;
}

// ── Strip prominent people — toàn diện, nhiều lớp ───────────────────────────
// Veo lỗi PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED khi prompt chứa:
//   - Tên thật người nổi tiếng (bất kỳ ngôn ngữ)
//   - Mô tả nhận dạng được ("founder of SpaceX", "world's richest person")
//   - Tước hiệu + tên ("President Biden", "CEO Musk")

// ── Tên nổi tiếng cụ thể → vai trò chung ────────────────────────────────────
const PERSON_REPLACE_MAP = [
  // Công nghệ / Kinh doanh
  [/\b(Elon Musk|Musk|Jeff Bezos|Bezos|Bill Gates|Gates|Steve Jobs|Jobs|Mark Zuckerberg|Zuckerberg|Tim Cook|Sundar Pichai|Sam Altman|Larry Page|Sergey Brin|Jack Ma|Warren Buffett|Buffett|George Soros|Michael Bloomberg|Jensen Huang|Reed Hastings|Brian Chesky|Travis Kalanick)\b/gi, 'a tech entrepreneur'],
  // Chính trị
  [/\b(Joe Biden|Biden|Donald Trump|Trump|Barack Obama|Obama|Hillary Clinton|Clinton|Vladimir Putin|Putin|Xi Jinping|Jinping|Boris Johnson|Emmanuel Macron|Macron|Angela Merkel|Merkel|Justin Trudeau|Trudeau|Volodymyr Zelensky|Zelensky|Narendra Modi|Modi|Jair Bolsonaro|Nguyễn Phú Trọng|Tô Lâm|Phạm Minh Chính)\b/gi, 'a world leader'],
  // Nhạc / Giải trí
  [/\b(Taylor Swift|Swift|Beyoncé|Beyonce|Justin Bieber|Bieber|Adele|Ed Sheeran|Sheeran|Rihanna|Lady Gaga|Gaga|Eminem|Drake|BTS|Blackpink|Ariana Grande|Grande|Post Malone|Billie Eilish|Eilish|The Weeknd|Bruno Mars|Sơn Tùng|Son Tung|Mỹ Tâm|My Tam|Đen Vâu|Jack|Soobin)\b/gi, 'a famous musician'],
  [/\b(Tom Hanks|Hanks|Leonardo DiCaprio|DiCaprio|Brad Pitt|Pitt|Angelina Jolie|Jolie|Scarlett Johansson|Johansson|Robert Downey|Chris Evans|Dwayne Johnson|Will Smith|Keanu Reeves|Ryan Reynolds|Reynolds|Tom Cruise|Cruise|Meryl Streep|Julia Roberts)\b/gi, 'a famous actor'],
  [/\b(Oprah Winfrey|Oprah|Ellen DeGeneres|Ellen|Jimmy Fallon|Jimmy Kimmel|Stephen Colbert|Joe Rogan|Rogan|MrBeast|PewDiePie)\b/gi, 'a media personality'],
  // Thể thao
  [/\b(Cristiano Ronaldo|Ronaldo|Lionel Messi|Messi|LeBron James|LeBron|Michael Jordan|Jordan|Kobe Bryant|Kobe|Neymar|Zlatan Ibrahimović|Ibrahimovic|Zlatan|Roger Federer|Federer|Serena Williams|Williams|Usain Bolt|Bolt|Tiger Woods|Woods|Muhammad Ali|Ali|Pelé|Pele|Maradona)\b/gi, 'a world-class athlete'],
  // Lịch sử / Học thuật
  [/\b(Albert Einstein|Einstein|Isaac Newton|Newton|Stephen Hawking|Hawking|Nikola Tesla|Tesla|Charles Darwin|Darwin|Sigmund Freud|Freud|Karl Marx|Marx|Nelson Mandela|Mandela|Mahatma Gandhi|Gandhi|Martin Luther King|Abraham Lincoln|Lincoln|Winston Churchill|Churchill|Napoleon Bonaparte|Napoleon|Julius Caesar|Caesar|Cleopatra|Shakespeare)\b/gi, 'a historical figure'],
  // Lãnh đạo tôn giáo
  [/\b(Pope Francis|Pope|Dalai Lama|Mother Teresa|Muhammad|Jesus Christ|Buddha)\b/gi, 'a spiritual leader'],
];

// ── Mô tả nhận dạng được → mô tả chung ──────────────────────────────────────
const IDENTIFIABLE_DESC_MAP = [
  // "founder/CEO/creator of [company]"
  [/\b(founder|co-founder|CEO|owner|creator|inventor)\s+of\s+\w[\w\s]*/gi, 'a business leader'],
  // "[superlative] person/man/woman in the world"
  [/\b(world'?s?\s+)?(richest|most famous|most powerful|wealthiest|most influential|greatest|best known)\s+(person|man|woman|human|individual|entrepreneur|athlete|leader|billionaire)/gi, 'a prominent person'],
  // "President/CEO/Chairman [name or title]"
  [/\b(President|Vice President|Prime Minister|Chancellor|Emperor|King|Queen|Prince|Princess|Secretary|Senator|Governor)\s+of\s+\w[\w\s]*/gi, 'a government official'],
  // "[title] [Name]" — "President Biden", "CEO Musk"
  [/\b(President|VP|CEO|CFO|CTO|Chairman|Senator|Governor|Mayor|Minister|Director|General|Admiral|Colonel)\s+[A-Z][a-z]+\b/g, 'a leader'],
];

// ── Địa danh & tổ chức ĐƯỢC GIỮ LẠI (không thay) ────────────────────────────
const SAFE_PLACES = /\b(New York|Los Angeles|San Francisco|Silicon Valley|Wall Street|United States|United Kingdom|South Korea|North Korea|Hong Kong|New Zealand|South Africa|Saudi Arabia|Vatican|Hollywood|Broadway|Olympics|World Cup|Super Bowl|Grammy|Oscar|Nobel)\b/i;

function stripProminentPeople(prompt) {
  if (!prompt) return '';
  let p = prompt;

  // Bước 1: Thay mô tả nhận dạng trước (trước khi thay tên để tránh partial match)
  IDENTIFIABLE_DESC_MAP.forEach(([rx, rep]) => { p = p.replace(rx, rep); });

  // Bước 2: Thay tên nổi tiếng cụ thể
  PERSON_REPLACE_MAP.forEach(([rx, rep]) => { p = p.replace(rx, rep); });

  // Bước 3: Thay "Firstname Lastname" còn sót (brace-counting approach)
  // Pattern: 2+ từ viết hoa liên tiếp, không phải địa danh/tổ chức đã biết
  p = p.replace(/\b([A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-záàảãạăắằẳẵặâấầẩẫậêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]{1,})\s+([A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-záàảãạăắằẳẵặâấầẩẫậêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]{1,}(?:\s+[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-z]{1,})*)\b/g,
    (match) => SAFE_PLACES.test(match) ? match : 'a person'
  );

  // Bước 4: Thay tước hiệu + từ viết hoa tiếp theo (còn sót)
  p = p.replace(/\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sir|Dame|Lord)\s+[A-Z][a-z]+\b/g, 'a person');

  return p.replace(/\s{2,}/g, ' ').trim();
}

// ── Escalating prompt repair — 4 cấp độ ngày càng mạnh hơn ──────────────────
// Gọi khi prompt vi phạm chính sách Veo ngay cả sau khi sanitizePrompt()
function getEscalatedPrompt(originalPrompt, level) {
  const base = (originalPrompt || '').trim();

  if (level === 1) {
    // Level 1: sanitize thông thường (thay từ + suffix)
    return sanitizePrompt(base);
  }

  if (level === 2) {
    // Level 2: giữ chỉ các yếu tố cinematic an toàn, loại bỏ narrative
    const safeFragments = base.split(/[,;.]+/).map(s => s.trim()).filter(s => {
      const lo = s.toLowerCase();
      return /\b(camera|shot|lighting|color|lens|drone|aerial|pan|zoom|track|dolly|crane|close.up|wide|angle|cinematic|documentary|morning|sunset|golden.hour|soft|natural|studio|4k|16.9|landscape|cityscape|nature|forest|ocean|mountain|urban|sky|interior|exterior|slow|smooth|subtle)\b/.test(lo)
        && !/\b(blood|gore|weapon|gun|knife|murder|kill|nude|naked|sexual|drug|bomb|terror)\b/.test(lo);
    });
    const cleanBase = safeFragments.slice(0, 4).join(', ') || 'cinematic establishing shot';
    return `${cleanBase}, smooth camera movement, warm natural lighting, soft color palette, cinematic style, no people or characters, peaceful atmosphere, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`;
  }

  if (level === 3) {
    // Level 3: chỉ giữ mood + setting, thay thế hoàn toàn nội dung nhạy cảm
    const moodMap = { dramatic: 'tense cinematic', uplifting: 'inspiring sunrise', mysterious: 'foggy atmospheric', epic: 'vast mountain panorama', serene: 'peaceful nature', tense: 'dramatic storm clouds', emotional: 'golden hour landscape', dark: 'moody forest' };
    const moodMatch = base.match(/\b(dramatic|uplifting|mysterious|epic|serene|tense|emotional|dark|peaceful|vibrant)\b/i);
    const mood = moodMatch ? (moodMap[moodMatch[1].toLowerCase()] || moodMatch[1]) : 'cinematic';
    const settingMatch = base.match(/\b(city|urban|nature|forest|ocean|sea|mountain|hill|indoor|office|street|sky|space|desert|field|garden)\b/i);
    const setting = settingMatch ? settingMatch[1] : 'landscape';
    return `Wide aerial ${mood} shot over a beautiful ${setting}, slow drone gliding forward, golden hour warm lighting, cinematic color grade with rich oranges and blues, documentary visual style, no people, ambient nature sounds, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`;
  }

  // Level 4: pure generic fallback — 100% an toàn
  return 'Wide aerial establishing shot of a beautiful natural landscape with rolling green hills and valleys, slow smooth cinematic drone pan across the scenery, golden hour warm sunlight, rich warm color palette, documentary cinematic style, no people or characters, peaceful serene atmosphere, ambient bird and wind sounds, safe for all audiences, family-friendly, no violent or adult content, aspect ratio 16:9, cinematic shot';
}

// ── AI Prompt Rewrite — dùng AI đơn giản hóa prompt thất bại (lỗi chung) ─────
// Khác repairPromptWithAI (chỉ fix policy): hàm này fix MỌI lỗi — prompt quá
// phức tạp, quá dài, hành động khó render, v.v.
async function rewritePromptForVeo(originalPrompt, errorMsg, aiConfig) {
  const { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel, geminiModel } = aiConfig || {};

  const systemPrompt = `You are a Veo 3.1 video prompt engineer. A video generation prompt failed and you must rewrite it to succeed.

Rules for rewriting:
- Simplify complex actions into clear, single-moment visual descriptions
- Remove abstract/narrative language — describe only WHAT IS VISUALLY SEEN in the frame
- Keep camera movement simple: "slow pan", "static shot", "gentle zoom"
- Max 2-3 visual elements per scene (character + setting + lighting)
- Keep the same mood, style, and setting — just make it simpler and more concrete
- Keep any "safe for all audiences" or "no text" suffixes if present
- Output ONLY the rewritten prompt — no explanation, no quotes, no extra text
- Target length: 50-80 words`;

  const errorHint = errorMsg ? `\nError that caused failure: ${errorMsg.slice(0, 120)}` : '';
  const userMsg = `Rewrite this failed Veo video prompt to be simpler and more likely to succeed:${errorHint}\n\nOriginal prompt:\n${originalPrompt}`;

  try {
    if (aiMode === 'gemini' && apiKeys?.length) {
      const { GoogleGenAI } = await import('@google/genai');
      const key = apiKeys[Math.floor(Math.random() * apiKeys.length)];
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: geminiModel || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMsg }] }],
        config: { maxOutputTokens: 300, temperature: 0.4 },
      });
      return res.text?.trim() || null;
    }
    if (aiMode === 'claude' && claudeKey) {
      const { callClaudeWithRetry } = await import('../services/claudeService.js');
      const raw = await callClaudeWithRetry({
        apiKey: claudeKey, model: claudeModel,
        system: systemPrompt, prompt: userMsg,
        maxTokens: 300, temperature: 0.4,
      });
      return raw?.trim() || null;
    }
    if (aiMode === 'groq' && groqKeys?.length) {
      const { callGroqWithRotation } = await import('../services/groqService.js');
      const raw = await callGroqWithRotation(groqKeys, {
        model: groqModel, system: systemPrompt, prompt: userMsg,
        maxTokens: 300, temperature: 0.4,
      });
      return raw?.trim() || null;
    }
  } catch (e) {
    console.warn('[AI Rewrite] Lỗi:', e.message);
  }
  return null;
}

// ── AI Prompt Repair — dùng AI để viết lại prompt vi phạm chính sách ────────
async function repairPromptWithAI(originalPrompt, aiConfig) {
  const { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel, geminiModel } = aiConfig || {};

  const systemPrompt = `You are a video prompt safety editor. Your job is to rewrite AI video generation prompts that were rejected by content policy filters.

Rules:
- Keep the SAME scene, setting, mood, and visual style
- Remove or replace ANY content that could trigger safety filters: violence, blood, weapons, nudity, real person names, political figures, celebrities, harmful/illegal activity
- Replace sensitive elements with safe cinematic alternatives (e.g., "battle" → "dramatic confrontation silhouette", "gun" → "prop", named celebrity → "a person")
- Add this suffix if not present: ", safe for all audiences, family-friendly, no graphic content, cinematic style"
- Output ONLY the rewritten prompt — no explanation, no quotes, no extra text`;

  const userMsg = `Rewrite this rejected video prompt to pass content policy:\n\n${originalPrompt}`;

  try {
    if (aiMode === 'gemini' && apiKeys?.length) {
      const { GoogleGenAI } = await import('@google/genai');
      const key = apiKeys[Math.floor(Math.random() * apiKeys.length)];
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: geminiModel || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMsg }] }],
        config: { maxOutputTokens: 512, temperature: 0.3 },
      });
      return res.text?.trim() || null;
    }

    if (aiMode === 'claude' && claudeKey) {
      const { callClaudeWithRetry } = await import('../services/claudeService.js');
      const raw = await callClaudeWithRetry({
        apiKey: claudeKey, model: claudeModel,
        system: systemPrompt, prompt: userMsg,
        maxTokens: 512, temperature: 0.3,
      });
      return raw?.trim() || null;
    }

    if (aiMode === 'groq' && groqKeys?.length) {
      const { callGroqWithRotation } = await import('../services/groqService.js');
      const raw = await callGroqWithRotation(groqKeys, {
        model: groqModel, system: systemPrompt, prompt: userMsg,
        maxTokens: 512, temperature: 0.3,
      });
      return raw?.trim() || null;
    }
  } catch (e) {
    console.warn('[AI Repair] Lỗi:', e.message);
  }
  return null;
}

// ── Policy Repair Loop — chạy cho từng task vi phạm cho đến khi ra kết quả ──
// Gọi sau khi tất cả retry thông thường đã xong, còn task vi phạm chính sách
// repairMap: Map<taskId, sceneIdx> — để biết lưu kết quả vào đâu
// resultArray: mảng output (orderedVPaths / orderedResults)
// veoRunFn: async (task) => { files: [{id, filePath, isError, error}] }
// aiConfig: { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel }
async function runPolicyRepairLoop(repairTasks, repairMap, resultArray, veoRunFn, addLog, stopRef, aiConfig) {
  if (!repairTasks?.length) return;
  addLog(`\n🔧 ════ POLICY REPAIR ════ Sửa đổi + chạy lại ${repairTasks.length} prompt vi phạm...`, 'info');

  for (let i = 0; i < repairTasks.length; i++) {
    if (stopRef?.current) return;
    const task = repairTasks[i];
    const sceneIdx = repairMap.get(task.id);
    let success = false;

    addLog(`🔧 [Repair ${i + 1}/${repairTasks.length}] Prompt gốc: "${(task.prompt || '').slice(0, 60)}..."`, 'info');

    // ── Level 0: AI tự động viết lại prompt (thông minh nhất) ──────────────
    if (aiConfig) {
      if (stopRef?.current) return;
      try {
        addLog(`  ↳ Level 0 (AI): Đang nhờ AI viết lại prompt an toàn...`, 'info');
        const aiPrompt = await repairPromptWithAI(task.prompt, aiConfig);
        if (aiPrompt && aiPrompt.length > 20) {
          addLog(`  ↳ Level 0 (AI): "${aiPrompt.slice(0, 80)}..."`, 'info');
          const repairId = `${task.id}_repair_AI_${Date.now()}`;
          const vr = await veoRunFn({ ...task, id: repairId, prompt: aiPrompt });
          const files = vr?.files || [];
          const won = files.filter(f => !f.isError && f.filePath);
          if (won.length > 0) {
            const result = won[0];
            if (sceneIdx !== undefined && resultArray) resultArray[sceneIdx] = result.filePath ?? result;
            addLog(`✅ [Repair ${i + 1}] AI sửa thành công! → ${(result.filePath || '').split(/[\\/]/).pop()}`, 'success');
            success = true;
          } else {
            addLog(`  Level 0 (AI) thất bại → thử rule-based levels...`, 'error');
            await new Promise(r => setTimeout(r, 3000));
          }
        } else {
          addLog(`  Level 0 (AI) không tạo được prompt → thử rule-based levels...`, 'error');
        }
      } catch (e) {
        addLog(`  Level 0 (AI) lỗi: ${e.message} → thử rule-based levels...`, 'error');
      }
    }

    // ── Level 1–4: rule-based escalation (fallback nếu AI thất bại) ────────
    for (let level = 1; level <= 4 && !success; level++) {
      if (stopRef?.current) return;
      const repairedPrompt = getEscalatedPrompt(task.prompt, level);
      const repairId = `${task.id}_repair_L${level}_${Date.now()}`;

      addLog(`  ↳ Level ${level}: "${repairedPrompt.slice(0, 70)}..."`, 'info');

      try {
        const vr = await veoRunFn({ ...task, id: repairId, prompt: repairedPrompt });
        const files = vr?.files || [];
        const won   = files.filter(f => !f.isError && f.filePath);

        if (won.length > 0) {
          const result = won[0];
          if (sceneIdx !== undefined && resultArray) {
            resultArray[sceneIdx] = result.filePath ?? result;
          }
          addLog(`✅ [Repair ${i + 1}] Thành công Level ${level}! → ${(result.filePath || '').split(/[\\/]/).pop()}`, 'success');
          success = true;
        } else {
          const err = files[0]?.error || '';
          const stillPolicy = isPolicyViolation(err);
          addLog(`  Level ${level} thất bại${stillPolicy ? ' (vẫn vi phạm chính sách)' : ` — ${err.slice(0, 60)}`} → thử level cao hơn...`, 'error');
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e) {
        addLog(`  Level ${level} lỗi: ${e.message} → thử level cao hơn...`, 'error');
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!success) {
      addLog(`⚠️ [Repair ${i + 1}] Không thể sửa được prompt sau AI + 4 cấp độ — bỏ qua task này`, 'error');
    }
  }

  addLog(`✅ Policy Repair hoàn tất`, 'success');
}

// Phát hiện giới tính nhân vật từ ID + mô tả
function detectCharGender(charId = '', description = '') {
  const text = `${charId} ${description}`.toLowerCase();
  const femaleKw = /\b(female|woman|women|girl|lady|she|her|nữ|cô gái|bà|cô\b|chị|mẹ|vợ|princess|queen|actress|wife|mother|daughter|sister)\b/;
  const maleKw   = /\b(male|man\b|men\b|boy|guy|he\b|his\b|nam\b|ông|anh\b|chú|bố|cha|vua|king|prince|actor|monk|husband|father|son|brother)\b/;
  if (femaleKw.test(text)) return 'female';
  if (maleKw.test(text))   return 'male';
  return 'neutral';
}

// Chọn giọng ngẫu nhiên đúng giới tính, không trùng với giọng đã dùng
function pickVoiceByGender(gender, usedVoices) {
  const pool = gender === 'male'   ? VOICE_POOL_MALE
             : gender === 'female' ? VOICE_POOL_FEMALE
             : VOICE_POOL;
  const avail = pool.filter(v => !usedVoices.has(v.id));
  // Nếu pool giới tính đã hết → fallback sang toàn bộ pool
  const fallback = VOICE_POOL.filter(v => !usedVoices.has(v.id));
  const source = avail.length > 0 ? avail : fallback;
  if (source.length === 0) return null;
  return source[Math.floor(Math.random() * source.length)].id;
}

// Engine-specific step labels
const STEPS_VEO = [
  { id: 'check',  label: 'Kiểm tra Extension',   icon: Zap      },
  { id: 'script', label: 'Viết kịch bản',         icon: FileText },
  { id: 'prompt', label: 'Tạo AI Prompts',         icon: Brain    },
  { id: 'dna',    label: 'Ảnh DNA tham chiếu',    icon: Sparkles },
  { id: 'video',  label: 'Tạo video Veo',          icon: Film     },
  { id: 'merge',  label: 'Ghép video cuối',        icon: Scissors },
];

const RESULT_TABS = [
  { id: 'script', label: 'Kịch bản',   step: 'script' },
  { id: 'prompt', label: 'Prompts',    step: 'prompt' },
  { id: 'dna',    label: 'DNA Ref',    step: 'dna'    },
  { id: 'video',  label: 'Videos',     step: 'video'  },
  { id: 'merge',  label: 'Video cuối', step: 'merge'  },
];

function cn(...c) { return c.filter(Boolean).join(' '); }
function toFileUrl(p) {
  if (!p) return '';
  // Encode từng segment đường dẫn để xử lý #, space, ký tự đặc biệt, tiếng Trung/Nhật/...
  return 'file:///' + p.replace(/\\/g, '/').split('/').map((seg, i) =>
    (i === 0 && /^[A-Za-z]:$/.test(seg)) ? seg : encodeURIComponent(seg)
  ).join('/');
}
function loadKeys() { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); } catch { return []; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Mini components ─────────────────────────────────────────────────────────
function FolderRow({ label, value, onChange }) {
  const pick = async () => { const f = await window.electronAPI?.selectFolder?.(); if (f) onChange(f); };
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 truncate min-w-0">
          {value || <span className="text-slate-700">Chưa chọn...</span>}
        </div>
        <button onClick={pick} className="p-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors">
          <FolderOpen size={12} className="text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function StepBadge({ step, status }) {
  const Icon = step.icon;
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-left',
      status === 'active'  && 'bg-violet-500/10 border-violet-500/30',
      status === 'done'    && 'bg-emerald-500/5 border-emerald-500/20',
      status === 'error'   && 'bg-red-500/10 border-red-500/30',
      status === 'pending' && 'border-slate-800/80 bg-slate-900/30',
    )}>
      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0',
        status === 'active'  && 'bg-violet-500/20',
        status === 'done'    && 'bg-emerald-500/15',
        status === 'error'   && 'bg-red-500/20',
        status === 'pending' && 'bg-slate-800',
      )}>
        {status === 'active'  ? <Loader2 size={12} className="text-violet-400 animate-spin" />
         : status === 'done'  ? <CheckCircle2 size={12} className="text-emerald-400" />
         : status === 'error' ? <AlertCircle size={12} className="text-red-400" />
         : <Icon size={12} className="text-slate-700" />}
      </div>
      <span className={cn('text-[10px] font-semibold leading-tight',
        status === 'active'  && 'text-violet-300',
        status === 'done'    && 'text-emerald-300',
        status === 'error'   && 'text-red-400',
        status === 'pending' && 'text-slate-700',
      )}>{step.label}</span>
    </div>
  );
}

// ─── Idea to Video ────────────────────────────────────────────────────────────
function IdeaToVideoPanel() {
  const [apiKeys]   = useState(loadKeys);
  const [aiMode,     setAiMode]    = useState('gemini'); // 'gemini' | 'claude' | 'groq'
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);
  const [idea,       setIdea]      = useState('');
  const [platform,   setPlatform]  = useState('YouTube ngang');
  const [language,   setLang]      = useState('vi');
  const [style,      setStyle]     = useState('Photorealistic');
  const [audience,   setAudience]  = useState('Người trẻ (Gen Z & Alpha)');
  const [goal,       setGoal]      = useState('Giải trí & Viral');
  const [tone,       setTone]      = useState('Bí tráng & Hào hùng');
  const videoEngine = 'veo';
  const [sceneDur,   setSceneDur]  = useState(8);
  const [totalMins,  setMins]      = useState(3);
  const [ratio,      setRatio]     = useState('16:9');
  const [imgMdl,     setImgMdl]    = useState('Nano Banana Pro');
  const [imgQuality, setImgQuality] = useState('1K');
  const [vidMdl,     setVidMdl]    = useState('Veo 3.1 - Lite [Lower Priority]');
  const [charVoices, setCharVoices] = useState(['random', '', '']); // [char1, char2, char3]
  const [vidQuality, setVidQuality] = useState('720p');
  const [useTransition, setUseTransition] = useState(true);
  const [refDir,     setRefDir]    = useState('');
  const [vidDir,     setVidDir]    = useState('');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);

  // Pipeline state
  const [running,    setRunning]   = useState(false);
  const [activeStep, setActive]    = useState(null);
  const [doneSteps,  setDone]      = useState([]);
  const [errorStep,  setErrStep]   = useState(null);
  const [error,      setError]     = useState('');
  const [logOpen,    setLogOpen]   = useState(true);

  // Results
  const [scriptText,   setScriptText]   = useState('');
  const [promptsList,  setPromptsList]  = useState([]);
  const [dnaImgs,      setDnaImgs]      = useState([]);
  const [dnaInfos,     setDnaInfos]     = useState([]); // [{type:'char'|'env'|'obj', name:string}]
  const [videoPaths,   setVideoPaths]   = useState([]);
  const [mergedPath,   setMergedPath]   = useState('');
  const [activeTab,    setActiveTab]    = useState('script');
  const [copied,       setCopied]       = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const logsRef  = useRef(null);
  const stopRef  = useRef(false);
  const pauseRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const DURS  = DURS_VEO;
  const STEPS = STEPS_VEO;
  const numScenes = Math.max(1, Math.round((totalMins * 60) / sceneDur));

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;

      // Real-time video detection: "Lưu thành công: filename.mp4"
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }

      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    const _w = window.electronAPI?.onVeoLog?.(handler);
    return () => { if (_w) window.electronAPI?.removeListener?.('veo-log', _w); };
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };

  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  const handleStart = async () => {
    if (!idea.trim())       { setError('Vui lòng nhập ý tưởng hoặc kịch bản.'); return; }
    if (aiMode === 'gemini' && !apiKeys.length) { setError('Chưa có API Key Gemini. Vào Settings → API Key.'); return; }
    if (aiMode === 'claude' && !claudeKey)      { setError('Chưa có Claude API Key. Vào Settings → API Key → Claude.'); return; }
    if (aiMode === 'groq'   && !groqKeys.length){ setError('Chưa có Groq API Key. Vào Settings → API Key → Groq.'); return; }
    if (!refDir || !vidDir) { setError('Vui lòng chọn đủ thư mục lưu file.'); return; }

    setRunning(true); setError(''); setLogs([]);
    setDone([]); setActive(null); setErrStep(null);
    setScriptText(''); setPromptsList([]); setDnaImgs([]);
    setVideoPaths([]); setMergedPath('');
    stopRef.current = false; pauseRef.current = false; setPaused(false);

    try {
      // ── 1. Check Extension ────────────────────────────────────────────────
      setActive('check');
      addLog('Kiểm tra kết nối Extension Veo Studio...', 'info');
      const ck = await window.electronAPI?.checkVeoCookie?.();
      if (!ck?.success) throw new Error(`Extension chưa kết nối! ${ck?.error || 'Hãy F5 Google Labs.'}`);
      addLog('✅ Extension đã kết nối — sẵn sàng!', 'success');
      markDone('check');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 2. Generate Script (dùng đúng logic Creator ScriptWriterPanel) ─────
      setActive('script'); setActiveTab('script');
      const langLabel = LANGUAGES.find(l => l.v === language)?.l || 'Tiếng Việt';
      addLog(`Đang viết kịch bản (${numScenes} cảnh × ${sceneDur}s, ${platform})...`, 'info');

      const sText = aiMode === 'groq'
        ? await generateScriptGroq(groqKeys, {
            topic: idea, platform, sceneDuration: sceneDur, totalDuration: totalMins,
            language, style, goal, tone, audience,
          }, (evt) => { if (evt.type === 'chunk') addLog(evt.message, 'info'); else if (evt.type === 'key_switch') addLog(evt.message, 'info'); }, groqModel)
        : aiMode === 'claude'
        ? await generateScriptClaude({
            apiKey: claudeKey, model: claudeModel,
            topic: idea, platform, sceneDuration: sceneDur, totalDuration: totalMins,
            language, style, goal, tone, audience,
          })
        : await generateScript(apiKeys, {
            topic:         idea,
            platform,
            sceneDuration: sceneDur,
            totalDuration: totalMins,
            language,
            style,
            goal:     goal,
            tone:     tone,
            audience: audience,
          }, (evt) => {
            if (evt.type === 'chunk')
              addLog(evt.message, 'info');
            else if (evt.type === 'chunk_done' && evt.total > 25)
              setScriptText(evt.scriptSoFar);
            else if (evt.type === 'key_switch')
              addLog(evt.message, 'info');
          });

      if (!sText) throw new Error('AI không tạo được kịch bản.');
      setScriptText(sText);
      addLog(`✅ Kịch bản hoàn thành — ${numScenes} cảnh, ngôn ngữ ${langLabel}`, 'success');
      markDone('script');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 3. Generate Prompts ───────────────────────────────────────────────
      setActive('prompt'); setActiveTab('prompt');
      addLog('Đang phân tích DNA & tạo AI Prompts từ kịch bản...', 'info');

      const langCode = {
        vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
        ko: 'ko-KR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', th: 'th-TH',
        none: 'no-dialogue',
      }[language] || 'vi-VN';
      const pRes = await generateCinematicPrompts(apiKeys, {
        subject: sText, quantity: numScenes,
        sceneDuration: sceneDur, style, language: langCode,
        characters: [], environments: [],
      }, ({ message, phase, fromIdx, toIdx }) => {
        if (message) addLog(message, 'info');
        if (phase === 'key_switch') addLog(`🔄 Key ${fromIdx+1} → Key ${toIdx+1}`, 'info');
      });

      const scenes   = pRes?.prompts  || [];
      const fullJson = pRes?.fullJson  || {};
      if (!scenes.length) throw new Error('Không tạo được prompts.');
      setPromptsList(scenes);
      addLog(`✅ Tạo xong ${scenes.length} prompts`, 'success');

      // ── Tự động lưu prompts.txt vào thư mục video ──
      try {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const txtContent = scenes.map((s, i) => `[Cảnh ${i+1}]\n${s.promptText}`).join('\n\n');
        const txtPath = `${vidDir}\\prompts_${ts}.txt`;
        const wr = await window.electronAPI.writeTextFile({ content: txtContent, filePath: txtPath });
        if (wr?.success) addLog(`📄 Đã lưu prompts.txt → ${txtPath}`, 'success');
      } catch (_) {}

      markDone('prompt');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 4. DNA Reference Images — Veo Studio ──────────────────────────────────
      setActive('dna'); setActiveTab('dna');
      const dna = fullJson?.dna || pRes?.analysis?.dna;
      const dnaTasks = [];
      const charDnaTaskMap = new Map(); // taskId → charId
      const envDnaTaskMap  = new Map(); // taskId → envId
      const objDnaTaskMap  = new Map(); // taskId → objId
      let _dnaIdx = 1; // fileIndex toàn cục — tránh trùng tên file

      // Hard cap: tối đa 5 nhân vật + 5 vật thể + 3 môi trường = 10 ảnh DNA
      const MAX_CHAR = 5, MAX_OBJ = 5, MAX_ENV = 3;
      (dna?.characters || []).slice(0, MAX_CHAR).forEach((c,i) => {
        if (c.dna_prompt) { dnaTasks.push({ id:`dna_c${i}`, prompt:c.dna_prompt, fileIndex:_dnaIdx++ }); charDnaTaskMap.set(`dna_c${i}`, c.id); }
      });
      (dna?.environments || []).slice(0, MAX_ENV).forEach((e,i) => {
        if (e.dna_prompt) { dnaTasks.push({ id:`dna_e${i}`, prompt:e.dna_prompt, fileIndex:_dnaIdx++ }); envDnaTaskMap.set(`dna_e${i}`, e.id); }
      });
      (dna?.key_objects || []).slice(0, MAX_OBJ).forEach((o,i) => {
        if (o.dna_prompt) { dnaTasks.push({ id:`dna_o${i}`, prompt:o.dna_prompt, fileIndex:_dnaIdx++ }); objDnaTaskMap.set(`dna_o${i}`, o.id); }
      });
      if (dnaTasks.length > 10) dnaTasks.length = 10;

      let dnaImgPaths = [];
      let dnaMediaIds = []; // UUID từ Veo Studio — dùng làm Ingredients
      const charImgMap = {}; const charMediaMap = {}; // charId → path/UUID
      const envImgMap  = {}; const envMediaMap  = {}; // envId  → path/UUID
      const objImgMap  = {}; const objMediaMap  = {}; // objId  → path/UUID

      if (dnaTasks.length) {
        {
          // ── Veo Studio: batchGenerateImages → trả về file path + UUID
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu bằng Veo Studio...`, 'info');
          const r = await window.electronAPI.runVeo({ mediaType:'Image', tasks:dnaTasks, aspectRatio:ratio, model:imgMdl, genCount:'1x', quality:imgQuality||'1K', outputFolder:refDir, duration:null });
          const dnaResults = (r?.files||[]).filter(f=>!f.isError&&f.filePath);
          dnaImgPaths = dnaResults.map(f=>f.filePath);
          dnaMediaIds = dnaResults.map(f=>f.mediaId).filter(Boolean);
          const infoByPath = {};
          dnaResults.forEach(f => {
            const cid = charDnaTaskMap.get(f.id);
            if (cid) { if (f.filePath) charImgMap[cid]=f.filePath; if (f.mediaId) charMediaMap[cid]=f.mediaId; if(f.filePath) infoByPath[f.filePath]={type:'char',name:cid}; }
            const eid = envDnaTaskMap.get(f.id);
            if (eid) { if (f.filePath) envImgMap[eid]=f.filePath;  if (f.mediaId) envMediaMap[eid]=f.mediaId;  if(f.filePath) infoByPath[f.filePath]={type:'env',name:eid}; }
            const oid = objDnaTaskMap.get(f.id);
            if (oid) { if (f.filePath) objImgMap[oid]=f.filePath;  if (f.mediaId) objMediaMap[oid]=f.mediaId;  if(f.filePath) infoByPath[f.filePath]={type:'obj',name:oid}; }
          });
          setDnaImgs(dnaImgPaths);
          setDnaInfos(dnaImgPaths.map(p=>infoByPath[p]||{type:'unknown',name:''}));
          const charCount = Object.keys(charImgMap).length;
          const envCount  = Object.keys(envImgMap).length;
          const objCount  = Object.keys(objImgMap).length;
          addLog(`✅ [Veo] DNA: ${charCount} nhân vật · ${envCount} bối cảnh · ${objCount} vật thể (${dnaImgPaths.length}/${dnaTasks.length} ảnh)`, 'success');
        }
      } else {
        addLog('⚠️ Không có DNA entity — bỏ qua ảnh tham chiếu', 'info');
      }
      markDone('dna');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── Build per-character voice map ─────────────────────────────────────────
      const charVoiceMap = {};
      {
        const charDescMap = {};
        dna?.characters?.forEach(c => { if (c.id) charDescMap[c.id] = `${c.name || ''} ${c.dna_prompt || c.description || ''}`; });

        const charIds = Object.keys(charImgMap);
        const usedVoices = new Set();
        charIds.forEach((charId, idx) => {
          const slot = charVoices[idx] ?? '';
          if (!slot) return;
          if (slot === 'random') {
            const gender = detectCharGender(charId, charDescMap[charId] || '');
            const picked = pickVoiceByGender(gender, usedVoices);
            if (picked) { charVoiceMap[charId] = picked; usedVoices.add(picked); }
          } else {
            charVoiceMap[charId] = slot; usedVoices.add(slot);
          }
        });
        if (Object.keys(charVoiceMap).length > 0)
          addLog(`🎙️ Voice: ${Object.entries(charVoiceMap).map(([k,v])=>`${k}→${v}`).join(', ')}`, 'info');
      }

      // ── 5. Videos — Veo Ingredients ──────────────────────────────────────────
      setActive('video'); setActiveTab('video');
      const engineLabel  = 'Veo';
      const maxVidWorkers = 8;
      const MAX_FIRST_RETRY_I2V = 5;  // lần đầu: 5 lần rồi bỏ qua
      const MAX_GLOBAL_RETRY_I2V = 20; // global: 20 lần
      const vPaths = [];

      const buildVideoPrompt = (sceneObj) => {
        const base     = sceneObj?.promptText || sceneObj?.fullData?.final_prompt || 'smooth cinematic motion';
        // cleanDialogueText: loại bỏ stutter/lặp từ transcript trước khi đưa vào TTS prompt
        const dialogue = cleanDialogueText((sceneObj?.fullData?.dialogue || '').trim());
        const LANG_EN = {
          vi: 'Vietnamese', 'vi-VN': 'Vietnamese',
          en: 'English',    'en-US': 'English',
          ja: 'Japanese',   'ja-JP': 'Japanese',
          zh: 'Chinese',    'zh-CN': 'Chinese',
          ko: 'Korean',     'ko-KR': 'Korean',
          fr: 'French',     'fr-FR': 'French',
          es: 'Spanish',    'es-ES': 'Spanish',
          de: 'German',     'de-DE': 'German',
          th: 'Thai',       'th-TH': 'Thai',
        };
        const langLabel_ = LANG_EN[language] || LANG_EN[language?.split('-')[0]] || 'Vietnamese';
        const noTextSuffix = 'no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only';
        const silentSuffix = 'natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text';
        const langPrefix = `[${langLabel_} voice],`;
        const ensureLangPrefix = (s) => s.startsWith(`[${langLabel_}`) ? s : `${langPrefix} ${s}`;

        if (!dialogue) {
          // Cảnh im lặng — strip [XXX voice] prefix và spoken audio only mà AI có thể gen sai
          let cleaned = base.replace(/^\[[^\]]*\bvoice\b[^\]]*\],?\s*/i, '');
          cleaned = cleaned.replace(/,?\s*spoken audio only\s*$/i, '');
          cleaned = cleaned.replace(/,?\s*no dialogue text overlay,?\s*spoken audio only\s*$/i, '');
          if (!cleaned.includes('no speech')) cleaned = `${cleaned}, ${silentSuffix}`;
          return cleaned;
        }
        if (base.includes(dialogue)) {
          const withSuffix = base.includes('no on-screen text') ? base : `${base}, ${noTextSuffix}`;
          return ensureLangPrefix(withSuffix) + SPEECH_ANTI_REPEAT;
        }
        // Fallback: AI dịch sai dialogue — gắn lại đúng ngôn ngữ
        return `${langPrefix} ${base}, character speaks ${langLabel_}: "${dialogue}", spoken audio only, ${noTextSuffix}${SPEECH_ANTI_REPEAT}`;
      };

      {
        // ── VEO: Ingredients mode — batch retry ─────────────────────────────
        const hasMediaIds = dnaMediaIds.length > 0;
        const hasDnaImages = dnaImgPaths.length > 0;
        if (!hasDnaImages && !hasMediaIds)
          addLog('⚠️ [Veo] Không có ảnh DNA — cảnh có nhân vật sẽ chạy text-to-video.', 'info');

        addLog(`[Veo] Batch ${scenes.length} video — mỗi cảnh chỉ tải DNA tham chiếu xuất hiện trong cảnh đó...`, 'info');

        // Map taskId → sceneIdx để giữ đúng thứ tự prompt
        const veoTaskMap = new Map();
        const orderedVPaths = new Array(scenes.length).fill(null);

        let allTasks = scenes.map((s, i) => {
          const tid = `vid_${i}`;
          veoTaskMap.set(tid, i);
          const sceneCharIds = s.fullData?.characters_in_scene || [];
          const sceneObjIds  = s.fullData?.objects_in_scene    || [];
          const sceneEnvId   = s.fullData?.environment_id;
          const sceneMediaIds = [
            ...sceneCharIds.map(id => charMediaMap[id]),
            sceneEnvId ? envMediaMap[sceneEnvId] : null,
            ...sceneObjIds.map(id => objMediaMap[id]),
          ].filter(Boolean);
          const sceneImgPaths = [
            ...sceneCharIds.map(id => charImgMap[id]),
            sceneEnvId ? envImgMap[sceneEnvId] : null,
            ...sceneObjIds.map(id => objImgMap[id]),
          ].filter(Boolean);
          const task = { id: tid, prompt: applyVeoPolicy(stripProminentPeople(buildVideoPrompt(s))) };
          const speakChar = sceneCharIds.find(id => charVoiceMap[id] && charImgMap[id]);
          if (speakChar) {
            task.voiceId = charVoiceMap[speakChar];
            task.ingredientImages = [charImgMap[speakChar]];
          } else if (sceneImgPaths.length > 0) {
            const maxRef = vidMdl === 'Omni 1.1 Flash' ? 7 : 3;
            task.ingredientImages = sceneImgPaths.slice(0, maxRef);
          }
          const refLabels = [...sceneCharIds, ...(sceneEnvId?[sceneEnvId]:[]), ...sceneObjIds];
          const refCount  = task.ingredientImages?.length || 0;
          addLog(`[Veo] Cảnh ${i+1}: ${refLabels.length > 0 ? `${refLabels.join(', ')} → ${refCount} ảnh DNA` : 'không có tham chiếu → text-to-video'}`, 'info');
          return task;
        });

        // Dedup prompt trùng trước khi gửi
        let pendingTasks = dedupTasksByPrompt(allTasks, addLog);

        // taskErrorMap: taskId → error message gần nhất (dùng cho AI rewrite)
        const taskErrorMap = new Map();

        // ── Helper: 1 vòng retry, tham số maxRetry ────────────────────────────
        const i2vPolicySet = new Set();
        const runIdeaVeoPass = async (passLabel, maxRetry) => {
          const filterPass = makeSubmitGuard();
          for (let attempt = 1; attempt <= maxRetry && pendingTasks.length > 0; attempt++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            if (attempt > 1) { addLog(`${passLabel}[Veo] Thử lại lần ${attempt}/${maxRetry}: ${pendingTasks.length} video...`, 'info'); await sleep(10000); }
            const safeTasks = filterPass(pendingTasks, addLog);
            if (!safeTasks.length) break;
            const vr = await window.electronAPI.runVeo({
              mediaType: 'Video', tasks: safeTasks,
              aspectRatio: ratio, model: vidMdl, genCount: '1x',
              quality: vidQuality, outputFolder: vidDir, duration: `${sceneDur}s`,
            });
            const files = vr?.files || [];
            const succeeded    = files.filter(f => !f.isError && f.filePath);
            const failedFiles  = files.filter(f => f.isError);
            const failedIds    = new Set(failedFiles.map(f => f.id));
            succeeded.forEach(f => { orderedVPaths[veoTaskMap.get(f.id) ?? 0] = f.filePath; });
            if (succeeded.length > 0) addLog(`✅ ${passLabel}[Veo] Lần ${attempt}: ${succeeded.length}/${safeTasks.length} thành công`, 'success');
            // Lưu error message để AI rewrite dùng sau
            for (const ff of failedFiles) {
              if (ff.error) taskErrorMap.set(ff.id, ff.error);
              if (isPolicyViolation(ff.error)) {
                i2vPolicySet.add(ff.id);
                addLog(`🚫 [Chính sách Veo] Cảnh vi phạm: "${(ff.error || '').slice(0, 80)}" → đổi prompt an toàn`, 'error');
              }
            }
            pendingTasks = safeTasks.filter(t => failedIds.has(t.id)).map(t => {
              const ni = `${t.id}_r${attempt}`;
              veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
              // Chuyển error sang id mới
              if (taskErrorMap.has(t.id)) { taskErrorMap.set(ni, taskErrorMap.get(t.id)); taskErrorMap.delete(t.id); }
              if (i2vPolicySet.has(t.id)) {
                i2vPolicySet.delete(t.id); i2vPolicySet.add(ni);
                const cp = sanitizePrompt(t.prompt);
                addLog(`🔧 Prompt làm sạch: "${cp.slice(0,70)}..."`, 'info');
                return { ...t, id: ni, prompt: cp };
              }
              return { ...t, id: ni };
            });
            if (pendingTasks.length > 0 && attempt < maxRetry)
              addLog(`⚠️ ${passLabel}[Veo] ${pendingTasks.length} video lỗi → chờ 10s...`, 'error');
          }
        };

        // Vòng chính — 5 lần, bỏ qua nếu vẫn lỗi, tiếp tục video khác
        addLog(`📋 Tạo ${pendingTasks.length} video — thử ${MAX_FIRST_RETRY_I2V} lần/task, bỏ qua nếu thất bại`, 'info');
        await runIdeaVeoPass('', MAX_FIRST_RETRY_I2V);
        if (pendingTasks.length > 0)
          addLog(`⏭️ ${pendingTasks.length} video vẫn lỗi sau ${MAX_FIRST_RETRY_I2V} lần → bỏ qua, tiếp tục`, 'warn');

        // ── AI Prompt Fix — viết lại prompt thất bại rồi retry 3 lần ─────────
        if (pendingTasks.length > 0) {
          addLog(`\n🤖 ════ AI PROMPT FIX ════ Nhờ AI viết lại ${pendingTasks.length} prompt thất bại...`, 'info');
          const aiCfg = { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel };
          const fixedTasks = [];
          for (const t of pendingTasks) {
            if (stopRef.current) break;
            const errMsg = taskErrorMap.get(t.id) || '';
            try {
              addLog(`  🤖 Đang phân tích lỗi + viết lại prompt cảnh: "${(t.prompt || '').slice(0, 50)}..."`, 'info');
              const rewritten = await rewritePromptForVeo(t.prompt, errMsg, aiCfg);
              if (rewritten && rewritten.length > 20) {
                const ni = `${t.id}_aifix`;
                veoTaskMap.set(ni, veoTaskMap.get(t.id));
                addLog(`  ✏️ Prompt mới: "${rewritten.slice(0, 80)}..."`, 'info');
                fixedTasks.push({ ...t, id: ni, prompt: rewritten });
              } else {
                fixedTasks.push(t); // giữ nguyên nếu AI không trả về gì
              }
            } catch (e) {
              fixedTasks.push(t);
            }
          }
          if (fixedTasks.length > 0) {
            pendingTasks = fixedTasks;
            addLog(`  ▶ Retry ${pendingTasks.length} video với prompt đã sửa (3 lần)...`, 'info');
            await sleep(3000);
            await runIdeaVeoPass('[AI-Fix]', 3);
            if (pendingTasks.length === 0)
              addLog(`✅ AI Prompt Fix hoàn tất — tất cả video đã thành công!`, 'success');
            else
              addLog(`⚠️ AI Prompt Fix: còn ${pendingTasks.length} video lỗi → chuyển sang Global Retry...`, 'error');
          }
        }

        // Global retry: sau khi hoàn thành TẤT CẢ → quay lại retry lỗi 20 lần
        if (pendingTasks.length > 0) {
          addLog(`\n🔄 ════ GLOBAL RETRY ════ ${pendingTasks.length} video lỗi → retry ${MAX_GLOBAL_RETRY_I2V} lần...`, 'info');
          await sleep(3000);
          const MAX_GLOBAL = 20;
          for (let gPass = 1; gPass <= MAX_GLOBAL && pendingTasks.length > 0; gPass++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            addLog(`🔄 [Global Retry ${gPass}/${MAX_GLOBAL}] ${pendingTasks.length} video vẫn lỗi → thử lại ${MAX_GLOBAL_RETRY_I2V} lần...`, 'info');
            await sleep(5000);
            pendingTasks = pendingTasks.map(t => {
              const ni = `${t.id}_g${gPass}`;
              veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
              return { ...t, id: ni };
            });
            await runIdeaVeoPass(`[Global ${gPass}/${MAX_GLOBAL}]`, MAX_GLOBAL_RETRY_I2V);
            if (pendingTasks.length === 0) addLog(`✅ [Global Retry] Tất cả hoàn thành ở vòng ${gPass}!`, 'success');
            else addLog(`⚠️ [Global Retry ${gPass}] Còn ${pendingTasks.length} video lỗi...`, 'error');
          }
        }
        // Policy Repair: AI viết lại prompt vi phạm → nếu AI thất bại → rule-based 4 cấp
        if (pendingTasks.length > 0) {
          addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair (AI + rule-based)...`, 'error');
          const repMap = new Map(pendingTasks.map(t => [t.id, veoTaskMap.get(t.id)]));
          const aiCfg = { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel };
          await runPolicyRepairLoop(
            pendingTasks, repMap, orderedVPaths,
            async (task) => window.electronAPI.runVeo({ mediaType:'Video', tasks:[task], aspectRatio:ratio, model:vidMdl, genCount:'1x', quality:vidQuality, outputFolder:vidDir, duration:`${sceneDur}s` }),
            addLog, stopRef, aiCfg
          );
        }

        // Đẩy vào vPaths theo đúng thứ tự cảnh
        const sortedVeo = orderedVPaths.filter(Boolean);
        sortedVeo.forEach(p => vPaths.push(p));
        setVideoPaths(sortedVeo);
      }

      if (!vPaths.length) throw new Error('Không tạo được video nào sau khi thử lại.');
      const totalExpected = scenes.length;
      addLog(`✅ [${engineLabel}] Tạo xong ${vPaths.length}/${totalExpected} video`, 'success');
      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 7. Merge Videos ───────────────────────────────────────────────────
      setActive('merge'); setActiveTab('merge');

      // Dùng vPaths (đã sắp đúng thứ tự cảnh)
      const mergeFiles = [...vPaths];
      addLog(`[${engineLabel}] Ghép ${mergeFiles.length} video theo thứ tự cảnh bằng Video Editor...`, 'info');

      if (mergeFiles.length >= 2) {
        const outName = `final_${Date.now()}`;
        const mr = await window.electronAPI.mergeVideo({
          files: mergeFiles, trimStart: 0, trimEnd: 0,
          transition: useTransition ? 'Ngẫu nhiên' : 'Không có', outputFolder: vidDir, outputName: outName,
        });
        if (mr?.success && mr?.path) {
          setMergedPath(mr.path);
          addLog(`✅ Ghép video hoàn tất: ${outName}.mp4 (${mergeFiles.length} clip)`, 'success');
        } else {
          addLog(`⚠️ Ghép video lỗi: ${mr?.error || 'unknown'}`, 'error');
        }
      } else if (mergeFiles.length === 1) {
        addLog('⚠️ Chỉ có 1 video — bỏ qua bước ghép', 'info');
        setMergedPath(mergeFiles[0]);
      } else {
        addLog('⚠️ Không có video nào để ghép', 'error');
      }
      markDone('merge');

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally {
      setRunning(false); pauseRef.current = false; setPaused(false);
    }
  };

  const stepStatus = (id) =>
    doneSteps.includes(id) ? 'done'
    : activeStep === id    ? 'active'
    : errorStep  === id    ? 'error'
    : 'pending';

  const availableTabs = RESULT_TABS.filter(t => {
    if (t.id === 'script') return !!scriptText;
    if (t.id === 'prompt') return promptsList.length > 0;
    if (t.id === 'dna')    return dnaImgs.length > 0;
    if (t.id === 'video')  return videoPaths.length > 0;
    if (t.id === 'merge')  return !!mergedPath;
    return false;
  });

  // ── Results renderer ───────────────────────────────────────────────────────
  const renderResults = () => {
    if (!availableTabs.length) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Film size={32} className="text-slate-700" />
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây khi pipeline chạy</p>
      </div>
    );

    const tab = activeTab;

    if (tab === 'script') return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <span className="text-xs font-bold text-slate-400">Kịch bản đã tạo</span>
          <button onClick={() => { navigator.clipboard.writeText(scriptText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-slate-300 transition-colors">
            {copied ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>} Copy
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#060b14] border border-slate-800 rounded-xl p-4 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
          {scriptText}
        </div>
      </div>
    );

    if (tab === 'prompt') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{promptsList.length} Prompts đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {promptsList.map((p, i) => (
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full">Cảnh {i+1}</span>
                {p.title && <span className="text-[9px] text-slate-500 truncate">{p.title}</span>}
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-3">{p.promptText || p.final_prompt}</p>
            </div>
          ))}
        </div>
      </div>
    );

    if (tab === 'dna') {
      const charImgs = dnaImgs.filter((_,i) => dnaInfos[i]?.type === 'char');
      const envImgs  = dnaImgs.filter((_,i) => dnaInfos[i]?.type === 'env');
      const objImgs  = dnaImgs.filter((_,i) => dnaInfos[i]?.type === 'obj');
      const DnaSection = ({ label, icon, color, items, allPaths, allInfos }) => {
        if (!items.length) return null;
        const indices = allPaths.map((p,i)=>allInfos[i]?.type===({char:'char',env:'env',obj:'obj'}[color])?i:-1).filter(x=>x>=0);
        return (
          <div className="mb-4">
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{color:({char:'#a78bfa',env:'#60a5fa',obj:'#fbbf24'})[color]||'#94a3b8'}}>
              <span>{icon}</span>{label} ({items.length})
            </p>
            <div className="grid grid-cols-3 gap-2">
              {allPaths.map((p,i) => {
                const info = allInfos[i]||{};
                if (info.type !== color) return null;
                const typeCls = color==='char'?'bg-violet-900/80 text-violet-200':color==='env'?'bg-blue-900/80 text-blue-200':'bg-amber-900/80 text-amber-200';
                return (
                  <div key={i} className="aspect-square bg-slate-800 rounded-xl overflow-hidden group relative">
                    <img src={toFileUrl(p)} alt={info.name} className="w-full h-full object-cover"/>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button onClick={()=>window.electronAPI?.openFile?.(p)} className="p-1.5 bg-white/20 rounded-lg"><ExternalLink size={11} className="text-white"/></button>
                    </div>
                    <div className={`absolute bottom-1.5 left-1.5 text-[8px] ${typeCls} px-1.5 py-0.5 rounded-full font-bold truncate max-w-[85%]`}>{info.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      };
      return (
        <div className="h-full flex flex-col">
          <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{dnaImgs.length} Ảnh DNA · {charImgs.length} nhân vật · {envImgs.length} bối cảnh · {objImgs.length} vật thể</p>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <DnaSection label="Nhân vật" icon="👤" color="char" items={charImgs} allPaths={dnaImgs} allInfos={dnaInfos}/>
            <DnaSection label="Bối cảnh" icon="🏞️" color="env"  items={envImgs}  allPaths={dnaImgs} allInfos={dnaInfos}/>
            <DnaSection label="Vật thể"  icon="🗡️" color="obj"  items={objImgs}  allPaths={dnaImgs} allInfos={dnaInfos}/>
            {dnaImgs.filter((_,i)=>!['char','env','obj'].includes(dnaInfos[i]?.type)).map((p,i)=>(
              <div key={i} className="aspect-square bg-slate-800 rounded-xl overflow-hidden group relative inline-block m-1">
                <img src={toFileUrl(p)} className="w-full h-full object-cover"/></div>
            ))}
          </div>
        </div>
      );
    }

    if (tab === 'video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className={cn('grid gap-1.5', ratio === '16:9' ? 'grid-cols-3' : 'grid-cols-4')}>
            {videoPaths.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', ratio === '9:16' ? 'aspect-[9/16]' : ratio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop />
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold leading-none">{i+1}</div>
                <button onClick={() => window.electronAPI?.openFile?.(p)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={9} className="text-white"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (tab === 'merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-sm font-bold text-emerald-300">Video hoàn chỉnh đã sẵn sàng!</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );

    return null;
  };

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── LEFT FORM ────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-violet-400" />
            <span className="text-xs font-bold text-white">Idea to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">Tự động: Kịch bản → Prompts → Ảnh DNA → Video Veo → Ghép</p>
        </div>

        <div className="flex-1 px-4 py-3 space-y-3.5">
          {/* AI Provider */}
          <div className="border-t border-slate-800/60 pt-3">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">AI Provider</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
              {[{id:'gemini',label:'✨ Gemini'},{id:'claude',label:'🤖 Claude'},{id:'groq',label:'⚡ Groq'}].map(m => (
                <button key={m.id} disabled={running} onClick={() => setAiMode(m.id)}
                  className={cn('flex-1 py-1.5 text-[10px] font-bold transition-colors',
                    aiMode === m.id
                      ? (m.id === 'groq' ? 'bg-green-600 text-white' : m.id === 'claude' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white')
                      : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border-transparent')}>
                  {m.label}
                </button>
              ))}
            </div>
            {aiMode === 'claude' && !claudeKey && (
              <p className="text-[9px] text-orange-400 mt-1">⚠️ Chưa có Claude API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && !groqKeys.length && (
              <p className="text-[9px] text-green-400 mt-1">⚠️ Chưa có Groq API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && groqKeys.length > 0 && (
              <p className="text-[9px] text-green-500/60 mt-0.5">💡 Nên chọn Llama 3.1 8B trong Settings để tránh rate limit</p>
            )}
          </div>
          {/* Idea */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ý tưởng / Kịch bản *</label>
            <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={4}
              placeholder="Nhập ý tưởng hoặc kịch bản..." disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-700 resize-none focus:outline-none focus:border-violet-500/40 transition-colors"/>
          </div>

          {/* Platform + Language */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Nền tảng</label>
              <select value={platform} onChange={e => { const p = e.target.value; setPlatform(p); if (PLATFORM_RATIO[p]) setRatio(PLATFORM_RATIO[p]); }} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {PLATFORMS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ngôn ngữ</label>
              <select value={language} onChange={e=>setLang(e.target.value)} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {LANGUAGES.map(l=><option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Phong cách hình ảnh</label>
            <select value={style} onChange={e=>setStyle(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
              {STYLES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Audience */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Đối tượng người xem</label>
            <select value={audience} onChange={e=>setAudience(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
              {AUDIENCES.map(a=><option key={a}>{a}</option>)}
            </select>
          </div>

          {/* Goal */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Mục tiêu video</label>
            <select value={goal} onChange={e=>setGoal(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
              {GOALS.map(g=><option key={g}>{g}</option>)}
            </select>
          </div>

          {/* Tone */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Giọng điệu & Mood</label>
            <select value={tone} onChange={e=>setTone(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
              {TONES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Ratio */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tỉ lệ khung hình</label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {RATIOS.map(r=>(
                <button key={r} disabled={running} onClick={()=>setRatio(r)}
                  className={cn('px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    ratio===r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Image Quality */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Chất lượng ảnh</label>
            <div className="flex gap-1.5 mt-1">
              {IMG_QUALITY.map(q=>(
                <button key={q} disabled={running} onClick={()=>setImgQuality(q)}
                  className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    imgQuality===q ? 'bg-cyan-600 border-cyan-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Scene Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
              Thời lượng 1 cảnh
            </label>
            {videoEngine === 'veo' ? (
              <div className="mt-1 bg-slate-800/40 border border-violet-700/30 rounded-lg px-3 py-1.5 text-[10px] text-violet-300 font-bold text-center">
                8s (Ingredients)
              </div>
            ) : (
              <div className="flex gap-1.5 mt-1">
                {DURS.map(d=>(
                  <button key={d} disabled={running} onClick={()=>setSceneDur(d)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                      sceneDur===d ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                    {d}s
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Total Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
              Tổng thời lượng &nbsp;<span className="text-violet-400 normal-case font-bold">= {numScenes} cảnh</span>
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input type="number" min={1} max={30} value={totalMins} onChange={e=>setMins(+e.target.value||1)}
                disabled={running}
                className="w-16 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 text-center focus:outline-none"/>
              <span className="text-[10px] text-slate-600">phút</span>
            </div>
          </div>

          {/* Models — chỉ hiện khi engine = Veo */}
          {videoEngine === 'veo' && (
            <div className="border-t border-slate-800/60 pt-3 space-y-2">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Model AI</label>
              <div>
                <label className="text-[9px] text-slate-700">Tạo ảnh</label>
                <select value={imgMdl} onChange={e=>setImgMdl(e.target.value)} disabled={running}
                  className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                  {IMG_MDL.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-slate-700">Tạo video (Ingredients)</label>
                <select value={vidMdl} onChange={e=>setVidMdl(e.target.value)} disabled={running}
                  className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                  {VID_MDL.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              {videoEngine === 'veo' && (
              <div className="space-y-1">
                <label className="text-[9px] font-semibold text-blue-400">🎙️ Voice Ingredients — Giọng nhân vật</label>
                <p className="text-[8px] text-slate-600 leading-tight">1 giọng = 1 ảnh nhân vật. Nhân vật không có giọng dùng toàn bộ DNA.</p>
                {['Nhân vật 1','Nhân vật 2','Nhân vật 3'].map((label, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-500 w-16 shrink-0">{label}</span>
                    <select value={charVoices[idx]||''} onChange={e=>{const v=[...charVoices]; v[idx]=e.target.value; setCharVoices(v);}} disabled={running}
                      className="flex-1 bg-slate-800/50 border border-blue-500/30 rounded-lg px-1.5 py-1 text-[9px] text-blue-300 focus:outline-none">
                      {VOICE_LIST.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              )}
              <div>
                <label className="text-[9px] text-slate-700">Chất lượng video</label>
                <select value={vidQuality} onChange={e=>setVidQuality(e.target.value)} disabled={running}
                  className="w-full mt-0.5 bg-slate-800/50 border border-violet-500/40 rounded-lg px-2 py-1.5 text-[10px] text-violet-300 font-semibold focus:outline-none">
                  <option value="720p">720p — Nhanh</option>
                  <option value="1080p">1080p — Upscale (chậm hơn)</option>
                </select>
              </div>
            </div>
          )}

          {/* Folders */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2.5">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Thư mục lưu file</label>
            <FolderRow label="Ảnh DNA tham chiếu" value={refDir} onChange={setRefDir} />
            <FolderRow label="Video xuất ra"       value={vidDir} onChange={setVidDir} />
          </div>

          {/* Transition toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none py-1">
            <input type="checkbox" checked={useTransition} onChange={e => setUseTransition(e.target.checked)} disabled={running}
              className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-violet-500" />
            <span className="text-[10px] text-slate-400">Chuyển cảnh ngẫu nhiên khi ghép video</span>
          </label>
        </div>

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error && (
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running ? (
            <button onClick={handleStart}
              className="w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 shadow-violet-500/20">
              <Play size={13} fill="currentColor"/>
              Bắt đầu · {aiMode === 'claude' ? 'Claude' : 'Gemini'}
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={paused ? handleResume : handlePause}
                className={cn('flex-1 font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs',
                  paused ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-amber-500/90 hover:bg-amber-500 text-white')}>
                {paused ? <><Play size={11} fill="currentColor"/> Tiếp tục</> : <><Pause size={11}/> Tạm dừng</>}
              </button>
              <button onClick={handleStop}
                className="flex-1 bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs">
                <Square size={11} fill="currentColor"/> Dừng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">

        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tiến trình tự động</p>
            <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
              🎬 Veo · Ingredients
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {STEPS.map(s=><StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
          </div>
        </div>

        {/* Results tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-800/60">
              {availableTabs.map(t => (
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab===t.id ? 'text-violet-300 border-violet-500' : 'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id==='prompt' && promptsList.length>0 && <span className="ml-1 text-[8px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">{promptsList.length}</span>}
                  {t.id==='video'  && videoPaths.length>0 && <span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* LOG PANEL (Veo Studio style, collapsible) */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen ? 'h-48' : 'h-9')}>
          <button onClick={()=>setLogOpen(v=>!v)}
            className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running && <span className="ml-auto flex items-center gap-1 text-[9px] text-violet-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running && logs.length > 0 && (
              <button onClick={e=>{e.stopPropagation();setLogs([]);}} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen && (
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length===0 && <p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l,i)=>(
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type==='error'   && 'text-red-400',
                    l.type==='success' && 'text-emerald-400',
                    l.type==='info'    && 'text-slate-500',
                  )}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Script to Video ─────────────────────────────────────────────────────────
const STEPS_VEO_S2V = [
  { id: 'check',  label: 'Kiểm tra Extension', icon: Zap      },
  { id: 'prompt', label: 'Tạo AI Prompts',      icon: Brain    },
  { id: 'dna',    label: 'Ảnh DNA tham chiếu',  icon: Sparkles },
  { id: 'video',  label: 'Tạo video Veo',        icon: Film     },
  { id: 'merge',  label: 'Ghép video cuối',      icon: Scissors },
];

const RESULT_TABS_S2V = [
  { id: 'prompt', label: 'Prompts',    step: 'prompt' },
  { id: 'dna',    label: 'DNA Ref',    step: 'dna'    },
  { id: 'video',  label: 'Videos',     step: 'video'  },
  { id: 'merge',  label: 'Video cuối', step: 'merge'  },
];

function ScriptToVideoPanel() {
  const [apiKeys]  = useState(loadKeys);
  const [aiMode,     setAiMode]    = useState('gemini');
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);
  const [script,      setScript]      = useState('');
  const [platform,    setPlatform]    = useState('YouTube ngang');
  const [language,    setLang]        = useState('vi');
  const [style,       setStyle]       = useState('Photorealistic');
  const videoEngine = 'veo';
  const [sceneDur,    setSceneDur]    = useState(8);
  const [totalMins,   setMins]        = useState(3);
  const [ratio,       setRatio]       = useState('16:9');
  const [imgMdl,      setImgMdl]      = useState('Nano Banana Pro');
  const [imgQuality,  setImgQuality]  = useState('1K');
  const [vidMdl,      setVidMdl]      = useState('Veo 3.1 - Lite [Lower Priority]');
  const [charVoices,  setCharVoices]  = useState(['random', '', '']); // [char1, char2, char3]
  const [vidQuality,  setVidQuality]  = useState('720p');
  const [useTransition, setUseTransition] = useState(true);
  const [refDir,      setRefDir]      = useState('');
  const [vidDir,      setVidDir]      = useState('');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);

  const [running,   setRunning]  = useState(false);
  const [activeStep,setActive]   = useState(null);
  const [doneSteps, setDone]     = useState([]);
  const [errorStep, setErrStep]  = useState(null);
  const [error,     setError]    = useState('');
  const [logOpen,   setLogOpen]  = useState(true);

  const [promptsList, setPromptsList] = useState([]);
  const [dnaImgs,     setDnaImgs]     = useState([]);
  const [dnaInfos,    setDnaInfos]    = useState([]); // [{type:'char'|'env'|'obj', name}]
  const [videoPaths,  setVideoPaths]  = useState([]);
  const [mergedPath,  setMergedPath]  = useState('');
  const [activeTab,   setActiveTab]   = useState('prompt');

  const [logs, setLogs] = useState([]);
  const logsRef = useRef(null);
  const stopRef  = useRef(false);
  const pauseRef = useRef(false);
  const [paused, setPaused] = useState(false);

  const DURS  = DURS_VEO;
  const STEPS = STEPS_VEO_S2V;
  const numScenes = Math.max(1, Math.round((totalMins * 60) / sceneDur));

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }
      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    const _w = window.electronAPI?.onVeoLog?.(handler);
    return () => { if (_w) window.electronAPI?.removeListener?.('veo-log', _w); };
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };
  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  // ── Batch mode ──────────────────────────────────────────────────────────────
  const stockMode = false; // Script-to-Video chỉ dùng Veo, không có stock mode
  const [batchMode,      setBatchMode]      = useState(false);
  const [batchFiles,     setBatchFiles]     = useState([]);
  const [batchOutputDir, setBatchOutputDir] = useState('');
  const [batchRunning,   setBatchRunning]   = useState(false);
  const [batchProgress,  setBatchProgress]  = useState({ current: 0, total: 0 });
  const [batchResults,   setBatchResults]   = useState([]);
  // 'stock' | 'aiveo' — chế độ video cho batch
  const [batchVideoMode, setBatchVideoMode] = useState(() => {
    try { return localStorage.getItem('fluxy_batch_video_mode') || 'stock'; } catch { return 'stock'; }
  });
  const [batchLogs,      setBatchLogs]      = useState([]);
  const batchStopRef = useRef(false);
  const handleBatchPickFiles = async () => {
    const result = await window.electronAPI?.selectMultipleFiles?.();
    if (!result?.length) return;
    setBatchFiles(prev => {
      const existPaths = new Set(prev.map(f => f.path));
      return [...prev, ...result.filter(f => !existPaths.has(f.path))];
    });
  };
  const removeBatchFile = (path) => setBatchFiles(prev => prev.filter(f => f.path !== path));
  const handleBatchStart = async () => {};

  const handleStart = async () => {
    if (!script.trim())     { setError('Vui lòng nhập kịch bản!'); return; }
    if (aiMode === 'gemini' && !apiKeys.length) { setError('Chưa có API Key Gemini. Vào Settings → API Key.'); return; }
    if (aiMode === 'claude' && !claudeKey)      { setError('Chưa có Claude API Key. Vào Settings → API Key → Claude.'); return; }
    if (aiMode === 'groq'   && !groqKeys.length){ setError('Chưa có Groq API Key. Vào Settings → API Key → Groq.'); return; }
    if (!refDir || !vidDir) { setError('Vui lòng chọn đủ thư mục lưu file.'); return; }

    setRunning(true); setError(''); setLogs([]);
    setDone([]); setActive(null); setErrStep(null);
    setPromptsList([]); setDnaImgs([]); setVideoPaths([]); setMergedPath('');
    stopRef.current = false; pauseRef.current = false; setPaused(false);

    try {
      // ── 1. Check Extension ──────────────────────────────────────────────────
      setActive('check');
      addLog('Kiểm tra kết nối Extension Veo Studio...', 'info');
      const ck = await window.electronAPI?.checkVeoCookie?.();
      if (!ck?.success) throw new Error(`Extension chưa kết nối! ${ck?.error || 'Hãy F5 Google Labs.'}`);
      addLog('✅ Extension đã kết nối — sẵn sàng!', 'success');
      markDone('check');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 2. Generate Prompts từ kịch bản nhập sẵn ───────────────────────────
      setActive('prompt'); setActiveTab('prompt');
      const langCode = {
        vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
        ko: 'ko-KR', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', th: 'th-TH',
        none: 'no-dialogue',
      }[language] || 'vi-VN';
      addLog(`Đang phân tích DNA & tạo AI Prompts từ kịch bản (${numScenes} cảnh)...`, 'info');
      const _p2Config = { subject: script, quantity: numScenes, sceneDuration: sceneDur, style, language: langCode, characters: [], environments: [] };
      const _p2Cb = ({ message, phase, fromIdx, toIdx }) => {
        if (message) addLog(message, 'info');
        if (phase === 'key_switch') addLog(`🔄 Key ${fromIdx+1} → Key ${toIdx+1}`, 'info');
      };
      const pRes = aiMode === 'groq'
        ? await generateCinematicPromptsGroq(groqKeys, _p2Config, _p2Cb, groqModel)
        : aiMode === 'claude'
        ? await generateCinematicPromptsClaude(claudeKey, _p2Config, _p2Cb, claudeModel)
        : await generateCinematicPrompts(apiKeys, _p2Config, _p2Cb);

      const scenes   = pRes?.prompts  || [];
      const fullJson = pRes?.fullJson  || {};
      if (!scenes.length) throw new Error('Không tạo được prompts.');
      setPromptsList(scenes);
      addLog(`✅ Tạo xong ${scenes.length} prompts`, 'success');

      try {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const txtContent = scenes.map((s, i) => `[Cảnh ${i+1}]\n${s.promptText}`).join('\n\n');
        const txtPath = `${vidDir}\\prompts_${ts}.txt`;
        const wr = await window.electronAPI.writeTextFile({ content: txtContent, filePath: txtPath });
        if (wr?.success) addLog(`📄 Đã lưu prompts.txt → ${txtPath}`, 'success');
      } catch (_) {}

      markDone('prompt');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 3. DNA Reference Images ─────────────────────────────────────────────
      setActive('dna'); setActiveTab('dna');
      const dna = fullJson?.dna || pRes?.analysis?.dna;
      const dnaTasks = [];
      const charDnaTaskMap = new Map(); // taskId → charId
      const envDnaTaskMap  = new Map(); // taskId → envId
      const objDnaTaskMap  = new Map(); // taskId → objId
      let _dnaIdx = 1; // fileIndex toàn cục — tránh trùng tên file

      // Hard cap: tối đa 5 nhân vật + 5 vật thể + 3 môi trường = 10 ảnh DNA
      const MAX_CHAR = 5, MAX_OBJ = 5, MAX_ENV = 3;
      (dna?.characters || []).slice(0, MAX_CHAR).forEach((c,i) => {
        if (c.dna_prompt) { dnaTasks.push({ id:`dna_c${i}`, prompt:c.dna_prompt, fileIndex:_dnaIdx++ }); charDnaTaskMap.set(`dna_c${i}`, c.id); }
      });
      (dna?.environments || []).slice(0, MAX_ENV).forEach((e,i) => {
        if (e.dna_prompt) { dnaTasks.push({ id:`dna_e${i}`, prompt:e.dna_prompt, fileIndex:_dnaIdx++ }); envDnaTaskMap.set(`dna_e${i}`, e.id); }
      });
      (dna?.key_objects || []).slice(0, MAX_OBJ).forEach((o,i) => {
        if (o.dna_prompt) { dnaTasks.push({ id:`dna_o${i}`, prompt:o.dna_prompt, fileIndex:_dnaIdx++ }); objDnaTaskMap.set(`dna_o${i}`, o.id); }
      });
      if (dnaTasks.length > 10) dnaTasks.length = 10;

      let dnaImgPaths = [];
      let dnaMediaIds = [];
      const charImgMap = {}; const charMediaMap = {};
      const envImgMap  = {}; const envMediaMap  = {};
      const objImgMap  = {}; const objMediaMap  = {};

      if (dnaTasks.length) {
        if (videoEngine === 'veo') {
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu (nhân vật + bối cảnh + vật thể)...`, 'info');
          const r = await window.electronAPI.runVeo({ mediaType:'Image', tasks:dnaTasks, aspectRatio:ratio, model:imgMdl, genCount:'1x', quality:imgQuality||'1K', outputFolder:refDir, duration:null });
          const dnaResults = (r?.files||[]).filter(f=>!f.isError&&f.filePath);
          dnaImgPaths = dnaResults.map(f=>f.filePath);
          dnaMediaIds = dnaResults.map(f=>f.mediaId).filter(Boolean);
          const s2vInfoByPath = {};
          dnaResults.forEach(f => {
            const cid = charDnaTaskMap.get(f.id);
            if (cid) { if (f.filePath) charImgMap[cid]=f.filePath; if (f.mediaId) charMediaMap[cid]=f.mediaId; if(f.filePath) s2vInfoByPath[f.filePath]={type:'char',name:cid}; }
            const eid = envDnaTaskMap.get(f.id);
            if (eid) { if (f.filePath) envImgMap[eid]=f.filePath;  if (f.mediaId) envMediaMap[eid]=f.mediaId;  if(f.filePath) s2vInfoByPath[f.filePath]={type:'env',name:eid};  }
            const oid = objDnaTaskMap.get(f.id);
            if (oid) { if (f.filePath) objImgMap[oid]=f.filePath;  if (f.mediaId) objMediaMap[oid]=f.mediaId;  if(f.filePath) s2vInfoByPath[f.filePath]={type:'obj',name:oid};  }
          });
          setDnaImgs(dnaImgPaths);
          setDnaInfos(dnaImgPaths.map(p=>s2vInfoByPath[p]||{type:'unknown',name:''}));
          const cC=Object.keys(charImgMap).length, eC=Object.keys(envImgMap).length, oC=Object.keys(objImgMap).length;
          addLog(`✅ [Veo] DNA: ${cC} nhân vật · ${eC} bối cảnh · ${oC} vật thể (${dnaImgPaths.length}/${dnaTasks.length} ảnh)`, 'success');
        }
      } else {
        addLog('⚠️ Không có DNA entity — bỏ qua ảnh tham chiếu', 'info');
      }
      markDone('dna');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── Build per-character voice map ─────────────────────────────────────────
      const charVoiceMap = {};
      {
        const charDescMap = {};
        dna?.characters?.forEach(c => { if (c.id) charDescMap[c.id] = `${c.name || ''} ${c.dna_prompt || c.description || ''}`; });

        const charIds = Object.keys(charImgMap);
        const usedVoices = new Set();
        charIds.forEach((charId, idx) => {
          const slot = charVoices[idx] ?? '';
          if (!slot) return;
          if (slot === 'random') {
            const gender = detectCharGender(charId, charDescMap[charId] || '');
            const picked = pickVoiceByGender(gender, usedVoices);
            if (picked) { charVoiceMap[charId] = picked; usedVoices.add(picked); }
          } else {
            charVoiceMap[charId] = slot; usedVoices.add(slot);
          }
        });
        if (Object.keys(charVoiceMap).length > 0)
          addLog(`🎙️ Voice: ${Object.entries(charVoiceMap).map(([k,v])=>`${k}→${v}`).join(', ')}`, 'info');
      }

      // ── 4. Videos ───────────────────────────────────────────────────────────
      setActive('video'); setActiveTab('video');
      const engineLabel  = 'Veo';
      const MAX_FIRST_RETRY_S2V  = 5;
      const MAX_GLOBAL_RETRY_S2V = 20;
      const vPaths = [];

      const buildVideoPrompt = (sceneObj) => {
        const base     = sceneObj?.promptText || sceneObj?.fullData?.final_prompt || 'smooth cinematic motion';
        // cleanDialogueText: loại bỏ stutter/lặp từ transcript trước khi đưa vào TTS prompt
        const dialogue = cleanDialogueText((sceneObj?.fullData?.dialogue || '').trim());
        const LANG_EN  = { vi:'Vietnamese','vi-VN':'Vietnamese', en:'English','en-US':'English', ja:'Japanese','ja-JP':'Japanese', zh:'Chinese','zh-CN':'Chinese', ko:'Korean','ko-KR':'Korean', fr:'French','fr-FR':'French', es:'Spanish','es-ES':'Spanish', de:'German','de-DE':'German', th:'Thai','th-TH':'Thai' };
        const langLabel_ = LANG_EN[language] || LANG_EN[language?.split('-')[0]] || 'Vietnamese';
        const noTextSuffix = 'no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only';
        const silentSuffix = 'natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text';
        const langPrefix = `[${langLabel_} voice],`;
        const ensureLangPrefix = (s) => s.startsWith(`[${langLabel_}`) ? s : `${langPrefix} ${s}`;
        if (!dialogue) {
          let cleaned = base.replace(/^\[[^\]]*\bvoice\b[^\]]*\],?\s*/i, '');
          cleaned = cleaned.replace(/,?\s*spoken audio only\s*$/i, '');
          cleaned = cleaned.replace(/,?\s*no dialogue text overlay,?\s*spoken audio only\s*$/i, '');
          if (!cleaned.includes('no speech')) cleaned = `${cleaned}, ${silentSuffix}`;
          return cleaned;
        }
        if (base.includes(dialogue)) { const ws=base.includes('no on-screen text')?base:`${base}, ${noTextSuffix}`; return ensureLangPrefix(ws) + SPEECH_ANTI_REPEAT; }
        return `${langPrefix} ${base}, character speaks ${langLabel_}: "${dialogue}", spoken audio only, ${noTextSuffix}${SPEECH_ANTI_REPEAT}`;
      };

      {
        const hasMediaIds  = dnaMediaIds.length > 0;
        const hasDnaImages = dnaImgPaths.length > 0;
        if (!hasDnaImages && !hasMediaIds) addLog('⚠️ [Veo] Không có ảnh DNA — sẽ chạy text-to-video.', 'info');
        addLog(`[Veo] Batch ${scenes.length} video — mỗi cảnh chỉ tải DNA tham chiếu xuất hiện...`, 'info');
        const veoTaskMap = new Map();
        const orderedVPaths = new Array(scenes.length).fill(null);
        const allTasks_s2v = scenes.map((s, i) => {
          const tid=`vid_${i}`; veoTaskMap.set(tid,i);
          const sceneCharIds=s.fullData?.characters_in_scene||[];
          const sceneObjIds =s.fullData?.objects_in_scene   ||[];
          const sceneEnvId  =s.fullData?.environment_id;
          const sceneMediaIds=[
            ...sceneCharIds.map(id=>charMediaMap[id]),
            sceneEnvId?envMediaMap[sceneEnvId]:null,
            ...sceneObjIds.map(id=>objMediaMap[id]),
          ].filter(Boolean);
          const sceneImgPaths=[
            ...sceneCharIds.map(id=>charImgMap[id]),
            sceneEnvId?envImgMap[sceneEnvId]:null,
            ...sceneObjIds.map(id=>objImgMap[id]),
          ].filter(Boolean);
          const task={ id:tid, prompt:applyVeoPolicy(stripProminentPeople(buildVideoPrompt(s))) };
          const speakChar=sceneCharIds.find(id=>charVoiceMap[id]&&charImgMap[id]);
          if (speakChar) {
            task.voiceId=charVoiceMap[speakChar];
            task.ingredientImages=[charImgMap[speakChar]];
          } else if (sceneImgPaths.length>0) {
            const maxRef=vidMdl==='Omni 1.1 Flash'?7:3;
            task.ingredientImages=sceneImgPaths.slice(0,maxRef);
          }
          const refLabels=[...sceneCharIds,...(sceneEnvId?[sceneEnvId]:[]),...sceneObjIds];
          const refCount=task.ingredientImages?.length||0;
          addLog(`[Veo] Cảnh ${i+1}: ${refLabels.length>0?`${refLabels.join(', ')} → ${refCount} ảnh DNA`:'không tham chiếu → text-to-video'}`, 'info');
          return task;
        });
        // Dedup prompt trùng trước khi gửi
        let pendingTasks = dedupTasksByPrompt(allTasks_s2v, addLog);

        // ── Helper: 1 vòng retry, tham số maxRetry ───────────────────────────
        const s2vPolicySet = new Set();
        const runS2VVeoPass = async (passLabel, maxRetry) => {
          const filterPass = makeSubmitGuard();
          for (let attempt=1; attempt<=maxRetry&&pendingTasks.length>0; attempt++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            if (attempt>1) { addLog(`${passLabel}[Veo] Thử lại lần ${attempt}/${maxRetry}: ${pendingTasks.length} video...`,'info'); await sleep(10000); }
            const safeTasks=filterPass(pendingTasks,addLog);
            if (!safeTasks.length) break;
            const vr=await window.electronAPI.runVeo({ mediaType:'Video', tasks:safeTasks, aspectRatio:ratio, model:vidMdl, genCount:'1x', quality:vidQuality, outputFolder:vidDir, duration:`${sceneDur}s` });
            const files=vr?.files||[];
            const succeeded=files.filter(f=>!f.isError&&f.filePath);
            const failedFiles=files.filter(f=>f.isError);
            const failedIds=new Set(failedFiles.map(f=>f.id));
            succeeded.forEach(f=>{ const si=veoTaskMap.get(f.id)??0; orderedVPaths[si]=f.filePath; });
            if (succeeded.length>0) addLog(`✅ ${passLabel}[Veo] Lần ${attempt}: ${succeeded.length}/${safeTasks.length} thành công`,'success');
            for (const ff of failedFiles) { if (isPolicyViolation(ff.error)) { s2vPolicySet.add(ff.id); addLog(`🚫 [Chính sách Veo] Vi phạm: "${(ff.error||'').slice(0,80)}" → đổi prompt`, 'error'); } }
            pendingTasks=safeTasks.filter(t=>failedIds.has(t.id)).map(t=>{
              const ni=`${t.id}_r${attempt}`; veoTaskMap.set(ni,veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
              if (s2vPolicySet.has(t.id)) { s2vPolicySet.delete(t.id); s2vPolicySet.add(ni); const cp=sanitizePrompt(t.prompt); addLog(`🔧 Prompt làm sạch: "${cp.slice(0,70)}..."`, 'info'); return {...t,id:ni,prompt:cp}; }
              return {...t,id:ni};
            });
            if (pendingTasks.length>0&&attempt<maxRetry) addLog(`⚠️ ${passLabel}[Veo] ${pendingTasks.length} video lỗi → chờ 10s...`,'error');
          }
        };

        // Vòng chính — 5 lần, bỏ qua nếu vẫn lỗi
        addLog(`📋 Tạo ${pendingTasks.length} video — thử ${MAX_FIRST_RETRY_S2V} lần/task`, 'info');
        await runS2VVeoPass('', MAX_FIRST_RETRY_S2V);
        if (pendingTasks.length>0) addLog(`⏭️ ${pendingTasks.length} video vẫn lỗi → bỏ qua, tiếp tục`,'warn');

        // Global retry sau khi hoàn thành TẤT CẢ
        if (pendingTasks.length>0) {
          addLog(`\n🔄 ════ GLOBAL RETRY ════ ${pendingTasks.length} video lỗi → retry ${MAX_GLOBAL_RETRY_S2V} lần...`, 'info');
          await sleep(3000);
          const MAX_GLOBAL_S2V = 20;
          for (let gPass=1; gPass<=MAX_GLOBAL_S2V&&pendingTasks.length>0; gPass++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            addLog(`🔄 [Global Retry ${gPass}/${MAX_GLOBAL_S2V}] ${pendingTasks.length} video vẫn lỗi → thử lại ${MAX_GLOBAL_RETRY_S2V} lần...`,'info');
            await sleep(5000);
            pendingTasks=pendingTasks.map(t=>{ const ni=`${t.id}_g${gPass}`; veoTaskMap.set(ni,veoTaskMap.get(t.id)); veoTaskMap.delete(t.id); return {...t,id:ni}; });
            await runS2VVeoPass(`[Global ${gPass}/${MAX_GLOBAL_S2V}]`, MAX_GLOBAL_RETRY_S2V);
            if (pendingTasks.length===0) addLog(`✅ [Global Retry] Tất cả hoàn thành ở vòng ${gPass}!`,'success');
            else addLog(`⚠️ [Global Retry ${gPass}] Còn ${pendingTasks.length} video lỗi...`,'error');
          }
        }
        // Policy Repair
        if (pendingTasks.length>0) {
          addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair...`,'error');
          const rpMap=new Map(pendingTasks.map(t=>[t.id,veoTaskMap.get(t.id)]));
          await runPolicyRepairLoop(pendingTasks,rpMap,orderedVPaths,async(task)=>window.electronAPI.runVeo({mediaType:'Video',tasks:[task],aspectRatio:ratio,model:vidMdl,genCount:'1x',quality:vidQuality,outputFolder:vidDir,duration:`${sceneDur}s`}),addLog,stopRef);
        }

        const sortedVeo=orderedVPaths.filter(Boolean);
        sortedVeo.forEach(p=>vPaths.push(p)); setVideoPaths(sortedVeo);
      }

      if (!vPaths.length) throw new Error('Không tạo được video nào sau khi thử lại.');
      addLog(`✅ [${engineLabel}] Tạo xong ${vPaths.length}/${scenes.length} video`, 'success');
      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Merge Videos ─────────────────────────────────────────────────────
      setActive('merge'); setActiveTab('merge');
      addLog(`[${engineLabel}] Ghép ${vPaths.length} video...`, 'info');
      if (vPaths.length >= 2) {
        const outName=`final_${Date.now()}`;
        const mr=await window.electronAPI.mergeVideo({ files:vPaths, trimStart:0, trimEnd:0, transition:useTransition?'Ngẫu nhiên':'Không có', outputFolder:vidDir, outputName:outName });
        if (mr?.success&&mr?.path) { setMergedPath(mr.path); addLog(`✅ Ghép video hoàn tất: ${outName}.mp4`, 'success'); }
        else addLog(`⚠️ Ghép video lỗi: ${mr?.error||'unknown'}`, 'error');
      } else if (vPaths.length===1) {
        addLog('⚠️ Chỉ có 1 video — bỏ qua bước ghép', 'info'); setMergedPath(vPaths[0]);
      } else { addLog('⚠️ Không có video nào để ghép', 'error'); }
      markDone('merge');

    } catch (err) {
      const msg=err.message||'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally { setRunning(false); pauseRef.current = false; setPaused(false); }
  };

  const stepStatus=(id)=>doneSteps.includes(id)?'done':activeStep===id?'active':errorStep===id?'error':'pending';

  const availableTabs=RESULT_TABS_S2V.filter(t=>{
    if (t.id==='prompt') return promptsList.length>0;
    if (t.id==='dna')    return dnaImgs.length>0;
    if (t.id==='video')  return videoPaths.length>0;
    if (t.id==='merge')  return !!mergedPath;
    return false;
  });

  const renderResults=()=>{
    if (!availableTabs.length) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Film size={32} className="text-slate-700"/>
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây khi pipeline chạy</p>
      </div>
    );
    if (activeTab==='prompt') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{promptsList.length} Prompts đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {promptsList.map((p,i)=>(
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Cảnh {i+1}</span>
                {p.title&&<span className="text-[9px] text-slate-500 truncate">{p.title}</span>}
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-3">{p.promptText||p.final_prompt}</p>
            </div>
          ))}
        </div>
      </div>
    );
    if (activeTab==='dna') {
      const S2VDnaSection = ({ label, icon, color, allPaths, allInfos }) => {
        const items = allPaths.filter((_,i)=>allInfos[i]?.type===color);
        if (!items.length) return null;
        const colorMap = {char:'#a78bfa', env:'#60a5fa', obj:'#fbbf24'};
        const bgMap    = {char:'bg-violet-900/80 text-violet-200', env:'bg-blue-900/80 text-blue-200', obj:'bg-amber-900/80 text-amber-200'};
        return (
          <div className="mb-4">
            <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{color:colorMap[color]||'#94a3b8'}}>
              <span>{icon}</span>{label} ({items.length})
            </p>
            <div className="grid grid-cols-3 gap-2">
              {allPaths.map((p,i)=>{
                const info=allInfos[i]||{};
                if (info.type!==color) return null;
                return (
                  <div key={i} className="aspect-square bg-slate-800 rounded-xl overflow-hidden group relative">
                    <img src={toFileUrl(p)} alt={info.name} className="w-full h-full object-cover"/>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button onClick={()=>window.electronAPI?.openFile?.(p)} className="p-1.5 bg-white/20 rounded-lg"><ExternalLink size={11} className="text-white"/></button>
                    </div>
                    <div className={`absolute bottom-1.5 left-1.5 text-[8px] ${bgMap[color]} px-1.5 py-0.5 rounded-full font-bold truncate max-w-[85%]`}>{info.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      };
      const charCount=dnaImgs.filter((_,i)=>dnaInfos[i]?.type==='char').length;
      const envCount =dnaImgs.filter((_,i)=>dnaInfos[i]?.type==='env').length;
      const objCount =dnaImgs.filter((_,i)=>dnaInfos[i]?.type==='obj').length;
      return (
        <div className="h-full flex flex-col">
          <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">{dnaImgs.length} Ảnh DNA · {charCount} nhân vật · {envCount} bối cảnh · {objCount} vật thể</p>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <S2VDnaSection label="Nhân vật" icon="👤" color="char" allPaths={dnaImgs} allInfos={dnaInfos}/>
            <S2VDnaSection label="Bối cảnh" icon="🏞️" color="env"  allPaths={dnaImgs} allInfos={dnaInfos}/>
            <S2VDnaSection label="Vật thể"  icon="🗡️" color="obj"  allPaths={dnaImgs} allInfos={dnaInfos}/>
          </div>
        </div>
      );
    }
    if (activeTab==='video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className={cn('grid gap-1.5', ratio==='16:9'?'grid-cols-3':'grid-cols-4')}>
            {videoPaths.map((p,i)=>(
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', ratio==='9:16'?'aspect-[9/16]':ratio==='1:1'?'aspect-square':'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop/>
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold leading-none">{i+1}</div>
                <button onClick={()=>window.electronAPI?.openFile?.(p)} className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity"><ExternalLink size={9} className="text-white"/></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
    if (activeTab==='merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath?(
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop/>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400"/>
              <span className="text-sm font-bold text-emerald-300">Video hoàn chỉnh đã sẵn sàng!</span>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>window.electronAPI?.openFile?.(mergedPath)} className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-xl transition-colors"><ExternalLink size={13}/> Mở video</button>
              <button onClick={()=>window.electronAPI?.openFolder?.(vidDir)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors"><FolderOpen size={13}/> Mở thư mục</button>
            </div>
          </>
        ):(
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );
    return null;
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── LEFT FORM ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <FileText size={13} className="text-green-400"/>
            <span className="text-xs font-bold text-white">Script to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">Kịch bản → Prompts → Ảnh DNA → Video → Ghép</p>
        </div>

        <div className="flex-1 px-4 py-3 space-y-3.5">
          {/* AI Provider */}
          <div className="border-t border-slate-800/60 pt-3">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">AI Provider</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
              {[{id:'gemini',label:'✨ Gemini'},{id:'claude',label:'🤖 Claude'},{id:'groq',label:'⚡ Groq'}].map(m => (
                <button key={m.id} disabled={running} onClick={() => setAiMode(m.id)}
                  className={cn('flex-1 py-1.5 text-[10px] font-bold transition-colors',
                    aiMode === m.id
                      ? (m.id === 'groq' ? 'bg-green-600 text-white' : m.id === 'claude' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white')
                      : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border-transparent')}>
                  {m.label}
                </button>
              ))}
            </div>
            {aiMode === 'claude' && !claudeKey && (
              <p className="text-[9px] text-orange-400 mt-1">⚠️ Chưa có Claude API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && !groqKeys.length && (
              <p className="text-[9px] text-green-400 mt-1">⚠️ Chưa có Groq API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && groqKeys.length > 0 && (
              <p className="text-[9px] text-green-500/60 mt-0.5">💡 Nên chọn Llama 3.1 8B trong Settings để tránh rate limit</p>
            )}
          </div>
          {/* Script input */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Kịch bản *</label>
            <textarea value={script} onChange={e=>setScript(e.target.value)} rows={8} disabled={running}
              placeholder="Dán kịch bản vào đây (theo từng cảnh)..."
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-700 resize-none focus:outline-none focus:border-green-500/40 transition-colors"/>
            <p className="text-[9px] text-slate-700 mt-1">Kịch bản của bạn sẽ được AI phân tích để tạo prompts ảnh DNA và video.</p>
          </div>

          {/* Platform + Language */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Nền tảng</label>
              <select value={platform} onChange={e=>{const p=e.target.value;setPlatform(p);if(PLATFORM_RATIO[p])setRatio(PLATFORM_RATIO[p]);}} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {PLATFORMS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ngôn ngữ</label>
              <select value={language} onChange={e=>setLang(e.target.value)} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {LANGUAGES.map(l=><option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Phong cách hình ảnh</label>
            <select value={style} onChange={e=>setStyle(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
              {STYLES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Ratio */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tỉ lệ khung hình</label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {RATIOS.map(r=>(
                <button key={r} disabled={running} onClick={()=>setRatio(r)}
                  className={cn('px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    ratio===r?'bg-green-600 border-green-500 text-white':'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Image Quality */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Chất lượng ảnh</label>
            <div className="flex gap-1.5 mt-1">
              {IMG_QUALITY.map(q=>(
                <button key={q} disabled={running} onClick={()=>setImgQuality(q)}
                  className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    imgQuality===q?'bg-cyan-600 border-cyan-500 text-white':'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Scene Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Thời lượng 1 cảnh</label>
            <div className="mt-1 bg-slate-800/40 border border-green-700/30 rounded-lg px-3 py-1.5 text-[10px] text-green-300 font-bold text-center">8s (Ingredients)</div>
          </div>

          {/* Total Duration */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
              Tổng thời lượng &nbsp;<span className="text-green-400 normal-case font-bold">= {numScenes} cảnh</span>
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input type="number" min={1} max={30} value={totalMins} onChange={e=>setMins(+e.target.value||1)} disabled={running}
                className="w-16 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 text-center focus:outline-none"/>
              <span className="text-[10px] text-slate-600">phút</span>
            </div>
          </div>

          {/* Models */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Model AI</label>
            <div>
              <label className="text-[9px] text-slate-700">Tạo ảnh DNA</label>
              <select value={imgMdl} onChange={e=>setImgMdl(e.target.value)} disabled={running}
                className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {IMG_MDL.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-slate-700">Tạo video (Ingredients)</label>
              <select value={vidMdl} onChange={e=>setVidMdl(e.target.value)} disabled={running}
                className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                {VID_MDL.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-semibold text-blue-400">🎙️ Voice Ingredients — Giọng nhân vật</label>
              <p className="text-[8px] text-slate-600 leading-tight">1 giọng = 1 ảnh nhân vật. Nhân vật không có giọng dùng toàn bộ DNA.</p>
              {['Nhân vật 1','Nhân vật 2','Nhân vật 3'].map((label, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500 w-16 shrink-0">{label}</span>
                  <select value={charVoices[idx]||''} onChange={e=>{const v=[...charVoices]; v[idx]=e.target.value; setCharVoices(v);}} disabled={running}
                    className="flex-1 bg-slate-800/50 border border-blue-500/30 rounded-lg px-1.5 py-1 text-[9px] text-blue-300 focus:outline-none">
                    {VOICE_LIST.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <label className="text-[9px] text-slate-700">Chất lượng video</label>
              <select value={vidQuality} onChange={e=>setVidQuality(e.target.value)} disabled={running}
                className="w-full mt-0.5 bg-slate-800/50 border border-green-500/40 rounded-lg px-2 py-1.5 text-[10px] text-green-300 font-semibold focus:outline-none">
                <option value="720p">720p — Nhanh</option>
                <option value="1080p">1080p — Upscale (chậm hơn)</option>
              </select>
            </div>
          </div>

          {/* Folders */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2.5">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Thư mục lưu file</label>
            <FolderRow label="Ảnh DNA tham chiếu" value={refDir} onChange={setRefDir}/>
            <FolderRow label="Video xuất ra"       value={vidDir} onChange={setVidDir}/>
          </div>

          {/* Transition toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none py-1">
            <input type="checkbox" checked={useTransition} onChange={e=>setUseTransition(e.target.checked)} disabled={running}
              className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-violet-500"/>
            <span className="text-[10px] text-slate-400">Chuyển cảnh ngẫu nhiên khi ghép video</span>
          </label>
        </div>

        {/* ── Batch Mode (Stock only) ── */}
        {stockMode && (
          <div className="px-4 py-2 border-t border-slate-800/60">
            <button onClick={() => setBatchMode(v => !v)} disabled={running || batchRunning}
              className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold border transition-all',
                batchMode ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'border-slate-700/60 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
              <span>📦 Xử lý hàng loạt (Batch)</span>
              <span className={cn('text-[8px] px-1.5 py-0.5 rounded-full font-black', batchMode ? 'bg-purple-500/30 text-purple-300' : 'bg-slate-700 text-slate-500')}>
                {batchMode ? 'BẬT' : 'TẮT'}
              </span>
            </button>
          </div>
        )}

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error&&(
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running?(
            <button onClick={handleStart}
              className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-500 hover:to-teal-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg shadow-green-500/20">
              <Play size={13} fill="currentColor"/>
              Tạo Video · {aiMode === 'claude' ? 'Claude' : 'Gemini'}
            </button>
          ):(
            <div className="flex gap-2">
              <button onClick={paused ? handleResume : handlePause}
                className={cn('flex-1 font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs',
                  paused ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-amber-500/90 hover:bg-amber-500 text-white')}>
                {paused ? <><Play size={11} fill="currentColor"/> Tiếp tục</> : <><Pause size={11}/> Tạm dừng</>}
              </button>
              <button onClick={handleStop} className="flex-1 bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs">
                <Square size={11} fill="currentColor"/> Dừng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">
        {/* Pipeline steps */}
        {/* ── Batch Mode Panel ─────────────────────────────────────────── */}
        {batchMode && stockMode && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Batch header */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-purple-300">📦 Batch — Xử lý hàng loạt</p>
                  <p className="text-[9px] text-slate-500 mt-0.5">
                    {batchVideoMode === 'aiveo' ? 'AI+Veo: Whisper → Gemini → Veo T2V (8 luồng/file)' : 'Stock Video: mỗi file audio → 1 thư mục riêng.'}
                  </p>
                </div>
                {batchRunning && (
                  <span className="text-[9px] font-bold text-purple-400 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin"/> {batchProgress.current}/{batchProgress.total}
                  </span>
                )}
              </div>

              {/* Nguồn video selector */}
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase mb-1.5 block">Nguồn Video</label>
                <div className="flex gap-1.5">
                  <button onClick={() => { setBatchVideoMode('stock'); localStorage.setItem('fluxy_batch_video_mode','stock'); }}
                    disabled={batchRunning}
                    className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold border transition-all flex items-center justify-center gap-1',
                      batchVideoMode === 'stock'
                        ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
                    📦 Stock
                  </button>
                  <button onClick={() => { setBatchVideoMode('aiveo'); localStorage.setItem('fluxy_batch_video_mode','aiveo'); }}
                    disabled={batchRunning}
                    className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold border transition-all flex items-center justify-center gap-1',
                      batchVideoMode === 'aiveo'
                        ? 'bg-pink-600/25 border-pink-500/50 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
                    🤖 AI+Veo
                  </button>
                </div>
                {batchVideoMode === 'aiveo' && (
                  <p className="text-[8px] text-pink-400/70 mt-1 leading-relaxed">Whisper → Gemini Story Bible → Veo T2V 8 luồng → ghép audio</p>
                )}
              </div>

              {/* File queue */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-semibold text-slate-500 uppercase">Files ({batchFiles.length})</label>
                  <button onClick={handleBatchPickFiles} disabled={batchRunning}
                    className="text-[9px] bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 text-purple-300 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                    <Plus size={10}/> Thêm files
                  </button>
                </div>
                {batchFiles.length === 0 ? (
                  <p className="text-[9px] text-slate-600 italic px-1">Chưa có file nào — bấm &quot;Thêm files&quot;</p>
                ) : (
                  <div className="max-h-28 overflow-y-auto custom-scrollbar space-y-1">
                    {batchFiles.map((f, i) => {
                      const res = batchResults[i];
                      return (
                        <div key={f.path} className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[9px]',
                          res?.status === 'done'    ? 'bg-emerald-500/5 border-emerald-500/20' :
                          res?.status === 'error'   ? 'bg-red-500/5 border-red-500/20' :
                          res?.status === 'running' ? 'bg-purple-500/10 border-purple-500/30' :
                          'bg-slate-800/30 border-slate-700/40')}>
                          <span className="shrink-0">
                            {res?.status === 'done'    ? '✅' :
                             res?.status === 'error'   ? '❌' :
                             res?.status === 'running' ? <Loader2 size={9} className="animate-spin text-purple-400"/> : '⏳'}
                          </span>
                          <span className="flex-1 truncate text-slate-300">{f.name}</span>
                          {res?.status === 'error' && <span className="text-red-400 truncate max-w-20" title={res.error}>{res.error?.slice(0,20)}</span>}
                          {!batchRunning && (
                            <button onClick={() => removeBatchFile(f.path)} className="text-slate-600 hover:text-red-400 shrink-0">
                              <X size={10}/>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Output folder */}
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase mb-1 block">Thư mục lưu kết quả</label>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[9px] text-slate-400 truncate">
                    {batchOutputDir || <span className="text-slate-700">Chưa chọn...</span>}
                  </div>
                  <button onClick={async () => { const d = await window.electronAPI?.selectFolder?.(); if (d) setBatchOutputDir(d); }}
                    disabled={batchRunning}
                    className="p-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-40">
                    <FolderOpen size={12} className="text-slate-400"/>
                  </button>
                </div>
                <p className="text-[8px] text-slate-600 mt-1">Mỗi file → thư mục con riêng.</p>
              </div>

              {/* Batch start/stop */}
              <div className="flex gap-2">
                {!batchRunning ? (
                  <button onClick={handleBatchStart}
                    disabled={!batchFiles.length || !batchOutputDir}
                    className={cn('flex-1 py-2 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors',
                      batchVideoMode === 'aiveo' ? 'bg-pink-600 hover:bg-pink-500' : 'bg-purple-600 hover:bg-purple-500')}>
                    <Play size={11} fill="currentColor"/> Chạy Batch ({batchFiles.length} file)
                  </button>
                ) : (
                  <button onClick={() => { batchStopRef.current = true; }}
                    className="flex-1 py-2 bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors">
                    <Square size={11} fill="currentColor"/> Dừng Batch
                  </button>
                )}
                {!batchRunning && batchFiles.length > 0 && (
                  <button onClick={() => { setBatchFiles([]); setBatchResults([]); }}
                    className="px-3 py-2 bg-slate-700/60 hover:bg-slate-700 text-slate-400 text-[9px] rounded-xl transition-colors">
                    Xóa DS
                  </button>
                )}
              </div>
            </div>

            {/* Batch log */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3 font-mono text-[9px] space-y-0.5">
              {batchLogs.length === 0 && (
                <p className="text-slate-600 italic">Log sẽ hiển thị khi batch chạy...</p>
              )}
              {batchLogs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-700 shrink-0">[{l.time}]</span>
                  <span className={l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}>
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Normal single-file pipeline ──────────────────────────────── */}
        {(!batchMode || !stockMode) && (
          <div className="flex flex-col flex-1 overflow-hidden">

        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tiến trình</p>
            <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
              🎬 Veo · Ingredients
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {STEPS.map(s=><StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
          </div>
        </div>

        {/* Results tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length>0&&(
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-800/60">
              {availableTabs.map(t=>(
                <button key={t.id} onClick={()=>setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab===t.id?'text-green-300 border-green-500':'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id==='prompt'&&promptsList.length>0&&<span className="ml-1 text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">{promptsList.length}</span>}
                  {t.id==='video' &&videoPaths.length>0&&<span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* Log panel */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen?'h-48':'h-9')}>
          <button onClick={()=>setLogOpen(v=>!v)} className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen?<ChevronDown size={12} className="text-slate-600"/>:<ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running&&<span className="ml-auto flex items-center gap-1 text-[9px] text-green-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running&&logs.length>0&&(
              <button onClick={e=>{e.stopPropagation();setLogs([]);}} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen&&(
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length===0&&<p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l,i)=>(
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type==='error'?'text-red-400':l.type==='success'?'text-emerald-400':'text-slate-500')}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audio to Video ───────────────────────────────────────────────────────────
const STEPS_AUDIO = [
  { id: 'prepare',    label: 'Kiểm tra file',     icon: UploadCloud },
  { id: 'extract',    label: 'Nén + Bóc tách',    icon: Mic         },
  { id: 'transcribe', label: 'Gemini AI',          icon: Brain       },
  { id: 'chunk',      label: 'Chia Timeline',      icon: Clock       },
  { id: 'generate',   label: 'Tạo Prompts',        icon: Sparkles    },
  { id: 'dna',        label: 'DNA Nhân vật',       icon: Layers      },
  { id: 'video',      label: 'Tạo Video',          icon: Film        },
  { id: 'merge',      label: 'Ghép video',         icon: Scissors    },
  { id: 'remaster',   label: 'Ghép Audio gốc',     icon: Music2      },
];

const RESULT_TABS_AUDIO = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'analysis',   label: 'Phân tích'  },
  { id: 'chunks',     label: 'Chunks'     },
  { id: 'prompts',    label: 'Prompts'    },
  { id: 'dna',        label: '🧬 DNA'     },
  { id: 'video',      label: 'Videos'     },
  { id: 'merge',      label: 'Video ghép' },
  { id: 'remaster',   label: '🎵 Video cuối' },
];

const VID_MDL_AUDIO = ['Veo 3.1 - Lite [Lower Priority]', 'Omni 1.1 Flash'];
const SPEECH_ANTI_REPEAT = ' [SPEECH: Read every word exactly as written, once and only once. Never repeat, stutter, loop, or duplicate any word or phrase.]';
function downloadBlob(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const ATV_SETTINGS_KEY = 'fluxy_atv_settings';
function loadAtvSettings() {
  try { return JSON.parse(localStorage.getItem(ATV_SETTINGS_KEY) || '{}'); } catch { return {}; }
}
function saveAtvSettings(patch) {
  try {
    const cur = loadAtvSettings();
    localStorage.setItem(ATV_SETTINGS_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (_) {}
}

const ATV_GEMINI_MODELS = [
  { id: 'gemini-2.5-flash',      label: '2.5 Flash' },
  { id: 'gemini-3-flash-preview',label: '3.0 Flash Preview' },
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite' },
  { id: 'gemini-3.5-flash',      label: '3.5 Flash' },
];

function AudioToVideoPanel() {
  const _s = loadAtvSettings();
  const [aiMode,     setAiMode]    = useState('gemini');
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);
  const [atvGeminiModel, setAtvGeminiModel] = useState(() => _s.atvGeminiModel || 'gemini-3-flash-preview');

  // File
  const [filePath,  setFilePath]  = useState('');
  const [fileName,  setFileName]  = useState('');
  const [sceneDur,  setSceneDur]  = useState(() => _s.sceneDur  || 8);

  // Video generation settings
  const videoEngine = 'veo';
  const [vidSceneDur,  setVidSceneDur]  = useState(() => _s.vidSceneDur  || 8);
  const [vidRatio,     setVidRatio]     = useState(() => _s.vidRatio     || '9:16');
  const [vidModel,     setVidModel]     = useState(() => _s.vidModel     || 'Veo 3.1 - Lite [Lower Priority]');
  const [vidQuality,   setVidQuality]   = useState(() => _s.vidQuality   || '720p');
  const [vidDir,       setVidDir]       = useState(() => _s.vidDir       || '');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);
  const [makeVideo,    setMakeVideo]    = useState(() => _s.makeVideo !== undefined ? _s.makeVideo : true);
  const [useTransition, setUseTransition] = useState(true);
  // Stock video mode
  const [stockMode,     setStockMode]     = useState(() => _s.stockMode     || false);
  const [stockProvider, setStockProvider] = useState(() => _s.stockProvider || 'pexels');
  // Keys riêng cho từng provider — luôn load cả 2
  const [pexelsKey,   setPexelsKey]   = useState('');
  const [pixabayKey,  setPixabayKey]  = useState('');
  // stockApiKey là derived: string khi 1 provider, object khi 'both'
  const stockApiKey = stockProvider === 'both'
    ? { pexels: pexelsKey, pixabay: pixabayKey }
    : stockProvider === 'pexels' ? pexelsKey : pixabayKey;
  // 'gemini' | 'whisper' | 'manual'
  const [stockTranscribeMode, setStockTranscribeMode] = useState(() => _s.stockTranscribeMode || 'gemini');
  const [stockManualKw, setStockManualKw] = useState(() => _s.stockManualKw || '');
  const [veoStyle,      setVeoStyle]      = useState(() => _s.veoStyle || 'auto'); // 'auto' or style id
  // ── Gemini+Veo mode (chế độ riêng, không phải nguồn chuyển ngôn) ──────────
  const [gsVideoMode,    setGsVideoMode]    = useState(() => _s.gsVideoMode || false);
  const [gsScript,       setGsScript]       = useState('');   // kịch bản tuỳ chọn (paste hoặc load file)
  const [gsScriptOpen,   setGsScriptOpen]   = useState(false); // hiện/ẩn textarea kịch bản
  const [gsCharacters,   setGsCharacters]   = useState([]);    // nhân vật detect từ Gemini

  // Transcript tải lên thủ công (TXT/SRT) — bỏ qua bước Gemini transcription
  const [manualTranscript, setManualTranscript] = useState('');
  const [manualTranscriptName, setManualTranscriptName] = useState('');

  // Prompt đồng bộ nhân vật / bối cảnh
  const [charBgPrompt, setCharBgPrompt] = useState(() => _s.charBgPrompt || '');
  useEffect(() => { saveAtvSettings({ charBgPrompt }); }, [charBgPrompt]);

  // Auto-save prompt file
  const [autoSavePrompt, setAutoSavePrompt] = useState(() => _s.autoSavePrompt !== undefined ? _s.autoSavePrompt : true);
  const [promptDir,      setPromptDir]      = useState(() => _s.promptDir || '');
  const promptDirRef      = useRef('');
  const autoSavePromptRef = useRef(true);
  useEffect(() => { promptDirRef.current      = promptDir;      }, [promptDir]);
  useEffect(() => { autoSavePromptRef.current = autoSavePrompt; }, [autoSavePrompt]);

  // Ghi nhớ settings khi thay đổi
  useEffect(() => { saveAtvSettings({ sceneDur });        }, [sceneDur]);
  useEffect(() => { saveAtvSettings({ vidSceneDur });     }, [vidSceneDur]);
  useEffect(() => { saveAtvSettings({ vidRatio });        }, [vidRatio]);
  useEffect(() => { saveAtvSettings({ vidModel });        }, [vidModel]);
  useEffect(() => { saveAtvSettings({ vidQuality });      }, [vidQuality]);
  useEffect(() => { saveAtvSettings({ vidDir });          }, [vidDir]);
  useEffect(() => { saveAtvSettings({ makeVideo });       }, [makeVideo]);
  useEffect(() => { saveAtvSettings({ autoSavePrompt }); }, [autoSavePrompt]);
  useEffect(() => { saveAtvSettings({ promptDir });       }, [promptDir]);
  useEffect(() => { saveAtvSettings({ stockMode });       }, [stockMode]);
  useEffect(() => { saveAtvSettings({ stockProvider });   }, [stockProvider]);
  useEffect(() => { saveAtvSettings({ stockTranscribeMode }); }, [stockTranscribeMode]);
  useEffect(() => { saveAtvSettings({ stockManualKw });       }, [stockManualKw]);
  useEffect(() => { saveAtvSettings({ veoStyle });          }, [veoStyle]);
  useEffect(() => { saveAtvSettings({ gsVideoMode });       }, [gsVideoMode]);
  useEffect(() => { saveAtvSettings({ atvGeminiModel });   }, [atvGeminiModel]);

  // Ingredients mode cho Audio to Video
  const [a2vIngMode,   setA2vIngMode]   = useState(() => _s.a2vIngMode || false);
  const [a2vRefDir,    setA2vRefDir]    = useState(() => _s.a2vRefDir  || '');
  const [a2vImgMdl,    setA2vImgMdl]   = useState(() => _s.a2vImgMdl  || 'Nano Banana Pro');
  const a2vRefDirRef = useRef('');
  useEffect(() => { a2vRefDirRef.current = a2vRefDir; }, [a2vRefDir]);
  useEffect(() => { saveAtvSettings({ a2vIngMode }); }, [a2vIngMode]);
  useEffect(() => { saveAtvSettings({ a2vRefDir  }); }, [a2vRefDir]);
  useEffect(() => { saveAtvSettings({ a2vImgMdl  }); }, [a2vImgMdl]);
  // DNA results state
  const [a2vDnaImgs,  setA2vDnaImgs]  = useState([]);

  // Load cả 2 keys khi mount (không phụ thuộc vào stockProvider)
  useEffect(() => {
    window.electronAPI?.getSetting?.('pexels_api_key',  '').then(v => setPexelsKey(v  || ''));
    window.electronAPI?.getSetting?.('pixabay_api_key', '').then(v => setPixabayKey(v || ''));
  }, []);

  // ── Batch mode ───────────────────────────────────────────────────────────────
  const [batchMode,       setBatchMode]       = useState(false);
  const [batchVideoMode,  setBatchVideoMode]  = useState(() => {
    try { return localStorage.getItem('fluxy_batch_video_mode') || 'stock'; } catch { return 'stock'; }
  });
  const [batchFiles,      setBatchFiles]      = useState([]); // [{name, path}]
  const [batchOutputDir,  setBatchOutputDir]  = useState('');
  const [batchRunning,    setBatchRunning]    = useState(false);
  const [batchProgress,   setBatchProgress]   = useState({ current: 0, total: 0 });
  const [batchResults,    setBatchResults]    = useState([]); // [{name, status, finalPath, error}]
  const [batchLogs,       setBatchLogs]       = useState([]);
  const batchStopRef   = useRef(false);
  const batchFileInput = useRef(null);
  const addBatchLog = (text, type = 'info') =>
    setBatchLogs(p => [...p.slice(-300), { time: new Date().toLocaleTimeString(), text, type }]);

  const handleBatchFilePick = async () => {
    const picked = await window.electronAPI?.selectFolder?.();
    // Use file dialog instead
    if (batchFileInput.current) batchFileInput.current.click();
  };
  const handleBatchFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBatchFiles(prev => {
      const existPaths = new Set(prev.map(f => f.name));
      const newFiles = files
        .filter(f => !existPaths.has(f.name))
        .map(f => ({ name: f.name, path: f.path || (window.__electronFilePaths?.[f.name] || '') }));
      return [...prev, ...newFiles];
    });
    if (batchFileInput.current) batchFileInput.current.value = '';
  };
  const handleBatchPickFiles = async () => {
    const result = await window.electronAPI?.selectMultipleFiles?.();
    if (!result?.length) return;
    setBatchFiles(prev => {
      const existPaths = new Set(prev.map(f => f.path));
      const newFiles = result.filter(f => !existPaths.has(f.path));
      return [...prev, ...newFiles];
    });
  };
  const removeBatchFile = (path) => setBatchFiles(prev => prev.filter(f => f.path !== path));

  // ── Batch pipeline runner ────────────────────────────────────────────────────
  const handleBatchStart = async () => {
    if (!batchFiles.length)   { return; }
    if (!batchOutputDir)      { addBatchLog('Chọn thư mục lưu kết quả trước!', 'error'); return; }
    const _batchVideoMode  = batchVideoMode; // 'stock' | 'aiveo'
    const _isAiVeo         = _batchVideoMode === 'aiveo';
    const _apiKeys         = loadKeys();
    // Validation theo mode
    if (!_isAiVeo && !stockApiKey && stockProvider !== 'both') { addBatchLog('Chưa có Stock API key!', 'error'); return; }
    if (_isAiVeo && !_apiKeys.length) { addBatchLog('Chưa có Gemini API key! Vào Settings → API Key.', 'error'); return; }
    const _stockMode       = !_isAiVeo;
    const _stockProvider   = stockProvider;
    const _stockApiKey     = stockApiKey;
    const _stockTxMode     = stockTranscribeMode;
    const _stockNoGemini   = _stockTxMode === 'manual';
    const _useLocalWhisper = _stockTxMode === 'whisper';
    const _sceneDur        = sceneDur === -1 ? 8 : sceneDur;
    const _stockManualKw   = (stockManualKw || '').trim();
    // AI+Veo settings
    const _vidSceneDur     = vidSceneDur;
    const _vidRatio        = vidRatio;
    const _vidModel        = vidModel;
    const _vidQuality      = vidQuality;
    const _veoStyle        = veoStyle;
    const _useTransition   = useTransition;

    setBatchRunning(true); batchStopRef.current = false;
    setBatchLogs([]);
    setBatchResults(batchFiles.map(f => ({ name: f.name, path: f.path, status: 'pending', finalPath: null, error: null })));

    for (let fi = 0; fi < batchFiles.length; fi++) {
      if (batchStopRef.current) { addBatchLog('⏹ Đã dừng batch.', 'info'); break; }
      const fileInfo  = batchFiles[fi];
      const baseName  = fileInfo.name.replace(/\.[^.]+$/, '');
      const subDir    = `${batchOutputDir}\\${baseName}`;

      setBatchProgress({ current: fi + 1, total: batchFiles.length });
      setBatchResults(prev => prev.map((r, i) => i === fi ? { ...r, status: 'running' } : r));
      addBatchLog(`\n📁 [${fi + 1}/${batchFiles.length}] Bắt đầu: ${fileInfo.name}`, 'info');

      try {
        // 1. Tạo thư mục con
        await window.electronAPI.createFolder(subDir);

        // 2. Kiểm tra file
        addBatchLog(`  Kiểm tra file...`, 'info');
        const prep = await window.electronAPI.prepareAudio(fileInfo.path);
        if (!prep?.success) throw new Error(`Lỗi kiểm tra file: ${prep?.error}`);
        const totalSec  = Math.floor(prep.duration);
        const autoChunk = _stockTxMode !== 'manual' && sceneDur === -1;
        const numChunks = autoChunk ? Math.ceil(totalSec / 8) : Math.ceil(totalSec / _sceneDur);
        addBatchLog(`  ✅ ${totalSec}s → ~${numChunks} cảnh`, 'success');

        // 3. Transcribe
        let result = null, oa = null, timeChunks;
        let _batchFullText = '';

        if (_isAiVeo) {
          // ── AI+Veo: Whisper cục bộ → fallback Gemini nếu không khả dụng ──────
          addBatchLog(`  🤖 [AI+Veo] Whisper cục bộ...`, 'info');
          try {
            result = await transcribeLocalChunked(fileInfo.path, totalSec,
              (msg) => addBatchLog(`    ${msg}`, 'info'),
              (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Đoạn ${done}/${tot}: ${err || n + ' câu'}`, err ? 'error' : 'success'),
              () => {}, () => {}
            );
          } catch (whisperErr) {
            addBatchLog(`  ⚠️ Whisper không khả dụng (${whisperErr.message.slice(0, 80)}) — chuyển sang Gemini...`, 'warn');
            if (!apiKeys.length) throw new Error('Whisper thất bại và không có Gemini API key để fallback.');
            const _gc = Math.ceil(totalSec / 90);
            addBatchLog(`  🔄 Gemini transcribe: ${_gc} phần...`, 'info');
            result = await transcribeAudioChunked(
              apiKeys, totalSec,
              async (startSec, durationSec) => window.electronAPI.extractAudioChunk({ filePath: fileInfo.path, startSec, durationSec }),
              (msg) => addBatchLog(`    ⏳ ${msg}`, 'info'),
              (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Phần ${done}/${tot}: ${err || n + ' câu'}`, err ? 'error' : 'success'),
              (msg) => addBatchLog(`    ${msg}`, 'info')
            );
            addBatchLog(`  ✅ Gemini transcribe xong — ${result.segments.length} câu`, 'success');
          }
          _batchFullText = result.fullText || '';
          timeChunks = sceneDur === -1
            ? createNaturalChunks(result.segments, totalSec)
            : createTimeBasedChunks(result.segments, totalSec, _vidSceneDur);
          addBatchLog(`  ✅ Whisper xong — ${result.segments.length} câu, ${timeChunks.length} cảnh`, 'success');
          // Phân tích tổng quát
          try {
            oa = await analyzeOverallContent(_apiKeys, _batchFullText, () => {});
            addBatchLog(`  ✅ Gemini phân tích: ${(oa?.topic || '').slice(0, 60)}`, 'success');
          } catch (e) {
            addBatchLog(`  ⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'warn');
          }
          // Inject phong cách veoStyle vào overallContext (giống single mode)
          const STYLE_KEYWORDS_BATCH = {
            'Photorealistic': 'Ultra-realistic photography, photorealistic render, 8K resolution, natural skin texture, real-world lighting, hyper-detailed DSLR quality',
            'Cinematic 4K':   'Cinematic 4K film quality, anamorphic lens, dramatic depth of field, professional color grading, film grain, Hollywood-level production',
            'Anime / Manga':  'Japanese anime 2D animation, clean sharp line art, cel-shaded flat coloring, expressive anime eyes, vibrant saturated palette',
            'Pixar 3D':       'Pixar/Disney 3D CGI, smooth subsurface scattering, warm key lighting, polished 3D render, expressive stylized characters',
            'Studio Ghibli':  'Studio Ghibli 2D hand-drawn animation, soft watercolor backgrounds, warm muted tones, expressive faces, gentle painterly line art',
            'Dark Fantasy':   'Dark fantasy digital painting, dramatic chiaroscuro, deep gothic shadows, epic fantasy illustration, moody desaturated palette',
            'Watercolor':     'Traditional watercolor painting, soft wet-on-wet washes, gentle color bleeds, textured paper, loose brushstrokes',
            'Cyberpunk':      'Cyberpunk art, neon-lit city, futuristic high contrast, synthwave color palette, rain-slicked streets',
            'Documentary':    'Documentary cinéma vérité, natural handheld camera, authentic real-world lighting, journalistic style',
          };
          if (_veoStyle !== 'auto' && STYLE_KEYWORDS_BATCH[_veoStyle]) {
            addBatchLog(`  🎨 Phong cách: ${_veoStyle}`, 'info');
            oa = oa ? { ...oa, recommended_visual_style: STYLE_KEYWORDS_BATCH[_veoStyle] }
                    : { recommended_visual_style: STYLE_KEYWORDS_BATCH[_veoStyle], topic: '', tone: '', context_summary: '' };
          }
        } else if (_stockNoGemini) {
          timeChunks = createTimeBasedChunks([], totalSec, _sceneDur);
        } else if (_useLocalWhisper) {
          addBatchLog(`  Whisper cục bộ...`, 'info');
          try {
            result = await transcribeLocalChunked(fileInfo.path, totalSec,
              (msg) => addBatchLog(`    ${msg}`, 'info'),
              (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Đoạn ${done}/${tot}: ${err || n + ' câu'}`, err ? 'error' : 'success'),
              () => {}, () => {}
            );
            addBatchLog(`  ✅ Whisper xong — ${result.segments.length} đoạn`, 'success');
          } catch (whisperErr) {
            addBatchLog(`  ⚠️ Whisper không khả dụng (${whisperErr.message.slice(0, 80)}) — chuyển sang Gemini...`, 'warn');
            if (!apiKeys.length) throw new Error('Whisper thất bại và không có Gemini API key để fallback.');
            const _gc2 = Math.ceil(totalSec / 90);
            addBatchLog(`  🔄 Gemini transcribe: ${_gc2} phần...`, 'info');
            result = await transcribeAudioChunked(
              apiKeys, totalSec,
              async (startSec, durationSec) => window.electronAPI.extractAudioChunk({ filePath: fileInfo.path, startSec, durationSec }),
              (msg) => addBatchLog(`    ⏳ ${msg}`, 'info'),
              (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Phần ${done}/${tot}: ${err || n + ' câu'}`, err ? 'error' : 'success'),
              (msg) => addBatchLog(`    ${msg}`, 'info')
            );
            addBatchLog(`  ✅ Gemini transcribe xong — ${result.segments.length} đoạn`, 'success');
          }
          timeChunks = autoChunk
            ? createNaturalChunks(result.segments, totalSec)
            : createTimeBasedChunks(result.segments, totalSec, _sceneDur);
        } else if (aiMode === 'groq' && groqKeys.length) {
          addBatchLog(`  Groq Whisper...`, 'info');
          result = await transcribeGroqChunked(groqKeys, totalSec,
            async (s, d) => window.electronAPI.extractAudioChunk({ filePath: fileInfo.path, startSec: s, durationSec: d }),
            (msg) => addBatchLog(`    ${msg}`, 'info'),
            (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Phần ${done}/${tot}`, err ? 'error' : 'success')
          );
          timeChunks = createTimeBasedChunks(result.segments, totalSec, _sceneDur);
          addBatchLog(`  ✅ Groq Whisper xong — ${result.segments.length} đoạn`, 'success');
          try {
            oa = await analyzeOverallContentGroq(groqKeys, result.fullText, () => {}, groqModel);
          } catch (_) {}
        } else {
          addBatchLog(`  Gemini transcribe...`, 'info');
          result = await transcribeAudioChunked(_apiKeys, totalSec,
            async (s, d) => window.electronAPI.extractAudioChunk({ filePath: fileInfo.path, startSec: s, durationSec: d }),
            (msg) => addBatchLog(`    ${msg}`, 'info'),
            (done, tot, n, err) => addBatchLog(`    ${err ? '⚠' : '✅'} Đoạn ${done}/${tot}: ${err || n + ' câu'}`, err ? 'error' : 'success'),
            () => {}
          );
          timeChunks = autoChunk
            ? createNaturalChunks(result.segments, totalSec)
            : createTimeBasedChunks(result.segments, totalSec, _sceneDur);
          addBatchLog(`  ✅ Transcribe xong — ${result?.segments?.length || 0} đoạn`, 'success');
          try {
            oa = await analyzeOverallContent(_apiKeys, result.fullText, () => {});
          } catch (_) {}
        }

        if (batchStopRef.current) throw new Error('Đã dừng.');

        // 4. Stock keywords
        let batchKw;
        const _batchFallback = (oa?.topic || 'nature landscape').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).slice(0, 3).join(' ') || 'nature landscape';
        if (_stockNoGemini) {
          const kwLines = _stockManualKw ? _stockManualKw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : ['nature landscape'];
          batchKw = timeChunks.map((_, i) => kwLines[i % kwLines.length]);
        } else {
          addBatchLog(`  AI phân tích nội dung → sinh từ khóa stock video...`, 'info');
          try {
            if (aiMode === 'groq' && groqKeys.length) {
              batchKw = await generateStockKeywordsGroq(groqKeys, timeChunks, oa, () => {}, groqModel);
            } else {
              batchKw = await generateStockKeywordsAI(_apiKeys, timeChunks, oa, () => {});
            }
            batchKw = batchKw.map(kw => kw || _batchFallback);
          } catch (e) {
            addBatchLog(`  ⚠️ AI keyword thất bại (${e.message}) → dùng word-freq`, 'warn');
            const _stops = new Set(['và','của','là','có','trong','với','cho','một','các','này','đó','đã','được','không','để','từ','the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','have','has','do','does','did','not','so','if','as','up','out','just','very','too','more','no']);
            batchKw = timeChunks.map(chunk => {
              const text = (chunk.exactText || '').trim();
              if (!text || text.length < 8) return _batchFallback;
              const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !_stops.has(w) && !/^\d+$/.test(w));
              return [...new Set(words)].slice(0, 3).join(' ') || _batchFallback;
            });
          }
        }
        if (!_isAiVeo) addBatchLog(`  ✅ ${batchKw.length} từ khóa — ví dụ: ${batchKw.slice(0, 2).join(' | ')}`, 'success');

        if (batchStopRef.current) throw new Error('Đã dừng.');

        // ── AI+Veo: Gemini tạo Veo prompts + 8-worker T2V ─────────────────────
        if (_isAiVeo) {
          // 4b. Gemini tạo Veo prompt đồng bộ kịch bản
          addBatchLog(`  🎬 Gemini tạo ${timeChunks.length} Veo prompt (Story Bible)...`, 'info');
          let generatedScenes_b = [];
          try {
            generatedScenes_b = await analyzeScenesContinuity(
              _apiKeys, timeChunks, _vidSceneDur, oa, _batchFullText,
              (cur, tot) => addBatchLog(`    Scene ${cur}/${tot}...`, 'info'),
              (sd, isErr) => { if (isErr) addBatchLog(`    ⚠️ Scene ${sd.sceneNumber} fallback`, 'warn'); }
            );
          } catch (e) { throw new Error(`Tạo Veo prompt lỗi: ${e.message}`); }
          addBatchLog(`  ✅ ${generatedScenes_b.length} Veo prompts xong`, 'success');

          if (batchStopRef.current) throw new Error('Đã dừng.');

          // 5b. 8-worker Veo T2V
          addBatchLog(`  🚀 Veo T2V — 8 luồng song song (${generatedScenes_b.length} video × ${_vidSceneDur}s)...`, 'info');
          const VEO_W = 8;
          const MAX_R = 5;
          const bVeoQueue = generatedScenes_b.map((s, i) => ({
            id: `bvid_${fi}_${i}`, origIdx: i, retries: 0, policyFixed: false,
            prompt: applyVeoPolicy(stripProminentPeople(s.veoVideoPrompt || 'Cinematic establishing shot')),
          }));
          let bVeoHead = 0;
          const bVeoPaths = new Array(generatedScenes_b.length).fill(null);
          const bClaimedSlots = new Set();
          let bVeoDone = 0;
          const bVeoTotal = generatedScenes_b.length;

          const batchVeoWorker = async (wid) => {
            while (true) {
              if (batchStopRef.current) break;
              if (bVeoHead >= bVeoQueue.length) break;
              const task = bVeoQueue[bVeoHead++];
              if (bVeoPaths[task.origIdx] || bClaimedSlots.has(task.origIdx)) continue;
              bClaimedSlots.add(task.origIdx);
              if (task.retries > 0) await sleep(task.retries * 3000);
              try {
                const vr = await window.electronAPI.runVeo({
                  mediaType: 'Video', tasks: [{ id: task.id, prompt: task.prompt }],
                  aspectRatio: _vidRatio, model: _vidModel,
                  genCount: '1x', quality: _vidQuality,
                  outputFolder: subDir, duration: `${_vidSceneDur}s`,
                });
                const files   = vr?.files || [];
                const success = files.find(f => !f.isError && f.filePath);
                const failure = files.find(f => f.isError);
                if (success?.filePath) {
                  if (!bVeoPaths[task.origIdx]) {
                    bVeoPaths[task.origIdx] = success.filePath;
                    bVeoDone++;
                    addBatchLog(`    ✅ [W${wid}] Cảnh ${task.origIdx + 1}/${bVeoTotal} OK (${bVeoDone}/${bVeoTotal})`, 'success');
                  } else {
                    window.electronAPI?.deleteFile?.(success.filePath).catch(() => {});
                  }
                } else {
                  const errMsg = failure?.error || 'unknown';
                  const isPolicy = isPolicyViolation(errMsg);
                  if (task.retries < MAX_R) {
                    const newPrompt = (isPolicy && !task.policyFixed) ? sanitizePrompt(task.prompt) : task.prompt;
                    bClaimedSlots.delete(task.origIdx);
                    bVeoQueue.push({ ...task, id: `${task.id}_r${task.retries+1}`, prompt: newPrompt, retries: task.retries+1, policyFixed: isPolicy ? true : task.policyFixed });
                    addBatchLog(`    ⚠️ [W${wid}] Cảnh ${task.origIdx+1} lỗi → retry ${task.retries+1}/${MAX_R}`, 'warn');
                  } else {
                    bVeoDone++;
                    addBatchLog(`    ❌ [W${wid}] Cảnh ${task.origIdx+1} hết retry`, 'error');
                  }
                }
              } catch (e) {
                if (task.retries < MAX_R) {
                  bClaimedSlots.delete(task.origIdx);
                  bVeoQueue.push({ ...task, id: `${task.id}_e${task.retries+1}`, retries: task.retries+1 });
                } else { bVeoDone++; }
              }
            }
          };

          await Promise.all(Array.from({ length: VEO_W }, (_, i) => batchVeoWorker(i + 1)));

          const vSucc = bVeoPaths.filter(Boolean).length;
          addBatchLog(`  ✅ Veo xong — ${vSucc}/${bVeoTotal} video`, vSucc > 0 ? 'success' : 'error');
          if (!vSucc) throw new Error('Không tạo được video Veo nào.');

          // 6b. Ghép video + audio
          const bVeoClips = bVeoPaths.filter(Boolean);
          addBatchLog(`  🎬 Ghép ${bVeoClips.length} clip + audio...`, 'info');
          let finalPath_b = null;
          if (bVeoClips.length === 1) {
            const rmr = await window.electronAPI.replaceAudio({ videoPath: bVeoClips[0], audioPath: fileInfo.path, outputFolder: subDir });
            if (rmr?.success && rmr?.path) finalPath_b = rmr.path;
          } else {
            const outName = `final_aiveo_${baseName}_${Date.now()}`;
            const car = await window.electronAPI.concatAudio({ clips: bVeoClips, audioPath: fileInfo.path, outputFolder: subDir, outputName: outName });
            if (car?.success && car?.path) {
              finalPath_b = car.path;
            } else {
              const mr = await window.electronAPI.mergeVideo({ files: bVeoClips, trimStart: 0, trimEnd: 0, transition: _useTransition ? 'Ngẫu nhiên' : 'Không có', outputFolder: subDir, outputName: `merged_${Date.now()}` });
              if (mr?.success && mr?.path) {
                const rmr = await window.electronAPI.replaceAudio({ videoPath: mr.path, audioPath: fileInfo.path, outputFolder: subDir });
                finalPath_b = rmr?.success ? rmr.path : mr.path;
              }
            }
          }
          if (!finalPath_b) throw new Error('Merge AI+Veo thất bại');
          addBatchLog(`  ✅ Hoàn tất: ${finalPath_b.split(/[\\/]/).pop()}`, 'success');
          setBatchResults(prev => prev.map((r, i) => i === fi ? { ...r, status: 'done', finalPath: finalPath_b } : r));
          addBatchLog(`  ✅ [${fi + 1}/${batchFiles.length}] XONG: ${fileInfo.name}`, 'success');
          continue; // bỏ qua phần stock bên dưới
        }

        // 5. Download + trim stock clips
        addBatchLog(`  Tải ${timeChunks.length} clip song song (4 luồng)...`, 'info');
        const orderedPaths   = new Array(timeChunks.length).fill(null);
        const stockClipPaths = [];
        const usedIds        = new Set();
        const targetDurBatch = _stockTxMode === 'manual' && sceneDur === -1 ? 8 : _sceneDur;

        let batchDone = 0;
        const batchQMutex = { idx: 0 };

        const processBatchOne = async (i) => {
          if (batchStopRef.current) return;
          const chunk     = timeChunks[i];
          const targetDur = chunk.timeEnd != null ? (chunk.timeEnd - chunk.timeStart) : targetDurBatch;
          const kw        = batchKw[i] || 'nature landscape';
          try {
            const doSearch = (k) => window.electronAPI.stockVideoSearch({ keyword: k, provider: _stockProvider, apiKey: _stockApiKey, perPage: 10 });
            let sr = await doSearch(kw);
            if (!sr?.success || !sr.results?.length) {
              for (const w of kw.split(' ')) { sr = await doSearch(w); if (sr?.success && sr.results?.length) break; }
            }
            if (sr?.success && sr.results?.length) {
              const sorted = [...sr.results].sort((a, b) => {
                const aOk = a.duration >= targetDur ? 0 : 1, bOk = b.duration >= targetDur ? 0 : 1;
                if (aOk !== bOk) return aOk - bOk;
                return b.duration - a.duration;
              });
              const chosen = sorted.filter(v => !usedIds.has(v.id))[0] || sorted[0];
              usedIds.add(chosen.id);
              const rawPath  = `${subDir}\\raw_${i}_${Date.now()}.mp4`;
              const trimPath = `${subDir}\\stock_${String(i).padStart(4, '0')}.mp4`;
              const dr = await window.electronAPI.stockVideoDownload({ url: chosen.url, destPath: rawPath });
              if (dr?.success) {
                stockClipPaths.push(rawPath);
                const tr = await window.electronAPI.trimLoopVideo({ inputPath: rawPath, duration: targetDur, outputPath: trimPath, targetW: 1280, targetH: 720 });
                window.electronAPI?.deleteFile?.(rawPath).catch(() => {});
                if (tr?.success) { orderedPaths[i] = trimPath; stockClipPaths.push(trimPath); addBatchLog(`  ✅ Clip ${i + 1}/${timeChunks.length} OK`, 'success'); }
              }
            }
          } catch (_) {}
          batchDone++;
        };

        await Promise.all(Array.from({ length: 4 }, async () => {
          while (batchQMutex.idx < timeChunks.length) {
            const i = batchQMutex.idx++;
            if (i >= timeChunks.length || batchStopRef.current) break;
            await processBatchOne(i);
          }
        }));

        // Fallback: clip null → dùng clip gần nhất
        for (let i = 0; i < orderedPaths.length; i++) {
          if (!orderedPaths[i]) {
            const prev = orderedPaths.slice(0, i).filter(Boolean).pop() || orderedPaths.slice(i + 1).filter(Boolean)[0];
            if (prev) orderedPaths[i] = prev;
          }
        }

        if (batchStopRef.current) throw new Error('Đã dừng.');

        // 6. Merge
        const clips = orderedPaths.filter(Boolean);
        addBatchLog(`  Ghép ${clips.length} clip + audio...`, 'info');
        let finalPath = null;
        if (clips.length === 0) {
          throw new Error('Không tải được clip nào');
        } else if (clips.length === 1) {
          const rmr = await window.electronAPI.replaceAudio({ videoPath: clips[0], audioPath: fileInfo.path, outputFolder: subDir });
          if (rmr?.success && rmr?.path) finalPath = rmr.path;
        } else {
          const car = await window.electronAPI.concatAudio({ clips, audioPath: fileInfo.path, outputFolder: subDir, outputName: `final_${baseName}_${Date.now()}` });
          if (car?.success && car?.path) {
            finalPath = car.path;
          } else {
            const mr = await window.electronAPI.mergeVideo({ files: clips, trimStart: 0, trimEnd: 0, transition: 'Không có', outputFolder: subDir, outputName: `merged_${Date.now()}` });
            if (mr?.success && mr?.path) {
              const rmr = await window.electronAPI.replaceAudio({ videoPath: mr.path, audioPath: fileInfo.path, outputFolder: subDir });
              finalPath = rmr?.success ? rmr.path : mr.path;
            }
          }
        }

        if (!finalPath) throw new Error('Merge thất bại');
        addBatchLog(`  ✅ Hoàn tất: ${finalPath.split(/[\\/]/).pop()}`, 'success');

        // 7. Xóa tất cả clip stock, chỉ giữ final
        addBatchLog(`  🗑 Dọn dẹp clip stock...`, 'info');
        const listed = await window.electronAPI?.listFiles?.(subDir);
        for (const fp of (listed?.files || [])) {
          const fname = fp.split(/[\\/]/).pop();
          if ((fname.startsWith('stock_') || fname.startsWith('raw_')) && fname.endsWith('.mp4') && fp !== finalPath) {
            window.electronAPI?.deleteFile?.(fp).catch(() => {});
          }
        }

        setBatchResults(prev => prev.map((r, i) => i === fi ? { ...r, status: 'done', finalPath } : r));
        addBatchLog(`  ✅ [${fi + 1}/${batchFiles.length}] XONG: ${fileInfo.name}`, 'success');

      } catch (err) {
        const msg = err.message || 'Lỗi không xác định';
        setBatchResults(prev => prev.map((r, i) => i === fi ? { ...r, status: 'error', error: msg } : r));
        addBatchLog(`  ❌ [${fi + 1}/${batchFiles.length}] Lỗi: ${msg}`, 'error');
      }
    }

    setBatchRunning(false);
    addBatchLog(`\n🎉 Batch hoàn tất! ${batchResults.filter(r => r.status === 'done').length}/${batchFiles.length} file thành công.`, 'success');
  };

  // Pipeline
  const [running,    setRunning]   = useState(false);
  const [activeStep, setActive]    = useState(null);
  const [doneSteps,  setDone]      = useState([]);
  const [errorStep,  setErrStep]   = useState(null);
  const [error,      setError]     = useState('');
  const [logOpen,    setLogOpen]   = useState(true);
  const stopRef  = useRef(false);
  const pauseRef = useRef(false);
  const [paused, setPaused] = useState(false);

  // Results
  const [transcript,     setTranscript]     = useState(null);
  const [overallAnalysis,setOverallAnalysis] = useState(null);
  const [chunks,         setChunks]         = useState([]);
  const [scenes,         setScenes]         = useState([]);
  const [duration,       setDuration]       = useState(0);
  const [genProgress,  setGenProgress]  = useState({ current: 0, total: 0 });
  const [videoPaths,   setVideoPaths]   = useState([]);
  const [mergedPath,   setMergedPath]   = useState('');
  const [finalPath,    setFinalPath]    = useState('');
  const [activeTab,    setActiveTab]    = useState('transcript');
  const [copiedAll,    setCopiedAll]    = useState(false);

  // Logs
  const [logs,    setLogs]    = useState([]);
  const logsRef               = useRef(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);


  // Real-time video detection from Veo log
  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }
      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    const _w = window.electronAPI?.onVeoLog?.(handler);
    return () => { if (_w) window.electronAPI?.removeListener?.('veo-log', _w); };
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };

  const handlePickFile = async () => {
    const p = await window.electronAPI?.selectAudioFile?.();
    if (p) { setFilePath(p); setFileName(p.split(/[\\/]/).pop()); }
  };

  // Đổi thời lượng cảnh
  const handleSceneDurChange = (d) => {
    setSceneDur(d);
    if ([4,6,8,10].includes(d)) setVidSceneDur(d);
    if (d === 10) setVidModel('Omni 1.1 Flash');
  };

  // Đổi mode stock/Veo, đồng thời reset sceneDur nếu cần
  const handleSetStockMode = (val) => {
    setStockMode(val);
    if (val  && sceneDur === 10) setSceneDur(-1); // 10s = Omni chỉ cho Veo → đổi sang auto
    if (!val && sceneDur === -1) setSceneDur(8);  // auto chỉ cho stock → đổi về 8s
  };

  const handleReset = () => {
    setFilePath(''); setFileName(''); setTranscript(null); setOverallAnalysis(null);
    setChunks([]); setScenes([]); setDuration(0);
    setVideoPaths([]); setMergedPath(''); setFinalPath('');
    setDone([]); setActive(null); setErrStep(null); setError('');
    setLogs([]); setGenProgress({ current: 0, total: 0 });
    setA2vDnaImgs([]);
  };

  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  const vidDurs = [4, 6, 8, 10];

  // Parse TXT/SRT/VTT tải lên thành transcript segments với timestamp ước lượng
  const parseManualTranscript = (rawText, totalDurationSec) => {
    const text = rawText.trim();
    let segments = [];
    let fullText = '';

    // Thử parse SRT format: "1\n00:00:01,000 --> 00:00:04,000\nText"
    const srtPattern = /\d+\n(\d{2}:\d{2}:\d{2}[,.]?\d*)\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]?\d*)\n([\s\S]*?)(?=\n\n|\n\d+\n|$)/g;
    const srtMatches = [...text.matchAll(srtPattern)];
    if (srtMatches.length > 0) {
      const toSec = t => {
        const [h, m, s] = t.replace(',', '.').split(':');
        return parseFloat(h)*3600 + parseFloat(m)*60 + parseFloat(s);
      };
      segments = srtMatches.map(m => ({
        start: toSec(m[1]),
        end:   toSec(m[2]),
        text:  m[3].replace(/\n/g, ' ').trim()
      })).filter(s => s.text);
      fullText = segments.map(s => s.text).join(' ');
    } else {
      // Plain text: chia theo đoạn/câu, ước lượng timestamp tuyến tính theo số từ
      const sentences = text
        .split(/(?<=[.!?。！？\n])\s+|\n{2,}/)
        .map(s => s.replace(/\n/g, ' ').trim())
        .filter(s => s.length > 5);
      fullText = sentences.join(' ');
      const totalWords = sentences.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
      let elapsed = 0;
      segments = sentences.map(s => {
        const words     = s.split(/\s+/).length;
        const duration  = totalDurationSec * (words / Math.max(totalWords, 1));
        const start     = parseFloat(elapsed.toFixed(2));
        elapsed        += duration;
        return { start, end: parseFloat(elapsed.toFixed(2)), text: s };
      });
    }

    return { fullText, segments };
  };

  const handleStart = async () => {
    // Capture tất cả settings tại thời điểm bấm Start — tránh stale closure
    const _manualTranscript = manualTranscript.trim();
    const apiKeys         = loadKeys();
    const _atvGeminiModel = atvGeminiModel;
    // Áp dụng model đã chọn cho toàn bộ pipeline Gemini
    setGeminiPromptModel(_atvGeminiModel);
    setAudioToVideoLLMModel(_atvGeminiModel);
    const _sceneDur       = sceneDur;
    const _videoEngine    = videoEngine;
    const _vidSceneDur    = vidSceneDur;
    const _vidRatio       = vidRatio;
    const _vidModel       = vidModel;
    const _vidQuality     = vidQuality;
    const _vidDir         = vidDir;
    const _makeVideo      = makeVideo;
    const _a2vIngMode     = a2vIngMode && !stockMode && !gsVideoMode; // Ingredients mode
    const _a2vRefDir      = a2vRefDir;
    const _a2vImgMdl      = a2vImgMdl;
    const _gsMode         = gsVideoMode; // Whisper→Gemini T2V Veo (không dùng stock)
    const _stockMode_eff  = stockMode && !_gsMode; // stock chỉ khi không phải GS mode
    const _stockMode      = _stockMode_eff;
    const _stockProvider  = stockProvider;
    const _stockApiKey    = stockApiKey;
    const _stockTxMode    = _stockMode_eff ? stockTranscribeMode : 'gemini';
    const _stockNoGemini  = _stockTxMode === 'manual';
    const _useLocalWhisper= _stockTxMode === 'whisper';
    const _stockManualKw  = (stockManualKw || '').trim();

    if (!filePath)           { setError('Vui lòng chọn file audio hoặc video.'); return; }
    // Không cần Gemini key khi: manual skip hoặc Whisper cục bộ (stock mode)
    if (aiMode === 'gemini' && !apiKeys.length && !_stockNoGemini && !_useLocalWhisper) { setError('Chưa có API Key Gemini. Vào Settings → API Key.'); return; }
    if (aiMode === 'claude' && !claudeKey && !_stockNoGemini && !_useLocalWhisper)          { setError('Chưa có Claude API Key. Vào Settings → API Key → Claude.'); return; }
    if (aiMode === 'groq'   && !groqKeys.length && !_stockNoGemini && !_useLocalWhisper)   { setError('Chưa có Groq API Key. Vào Settings → API Key → Groq.'); return; }
    if (_makeVideo && !_vidDir) { setError('Vui lòng chọn thư mục lưu video.'); return; }
    if (_a2vIngMode && _makeVideo && !_a2vRefDir) { setError('Chế độ Ingredients: vui lòng chọn thư mục lưu ảnh DNA nhân vật.'); return; }
    if (_makeVideo && _stockMode) {
      const hasKey = _stockProvider === 'both'
        ? (pexelsKey || pixabayKey)
        : !!_stockApiKey;
      if (!hasKey) { setError(`Chưa có API key ${_stockProvider === 'both' ? 'Pexels hoặc Pixabay' : _stockProvider}. Vào Settings → Stock Video.`); return; }
    }

    setRunning(true); setError('');
    setDone([]); setActive(null); setErrStep(null);
    setTranscript(null); setOverallAnalysis(null); setChunks([]); setScenes([]);
    setVideoPaths([]); setMergedPath(''); setFinalPath('');
    setGenProgress({ current: 0, total: 0 });
    setA2vDnaImgs([]);
    stopRef.current = false; pauseRef.current = false; setPaused(false);

    try {
      // ── 1. Kiểm tra file ──────────────────────────────────────────────────
      setActive('prepare');
      addLog(`Kiểm tra file: ${fileName}`, 'info');

      const prep = await window.electronAPI.prepareAudio(filePath);
      if (!prep.success) throw new Error(`Lỗi kiểm tra file: ${prep.error}`);
      if (stopRef.current) throw new Error('Đã dừng.');

      const totalSec    = Math.floor(prep.duration);
      const _autoChunk  = _stockMode && _sceneDur === -1;
      const totalScenes = _autoChunk ? Math.ceil(totalSec / 8) : Math.ceil(totalSec / _sceneDur);
      const sceneDesc   = _autoChunk ? 'tự động (5–15s/cảnh)' : `${_sceneDur}s/cảnh`;
      setDuration(totalSec);
      addLog(`✅ File hợp lệ — ${totalSec}s → ~${totalScenes} cảnh (${sceneDesc})`, 'success');
      markDone('prepare');

      // ── 2–4. Gemini steps (bỏ qua toàn bộ nếu stock no-Gemini mode) ────────
      let result = null;
      let oa     = null;
      let timeChunks;
      let _gsFullText = ''; // full transcript text cho _gsMode continuity

      if (_gsMode) {
        // ── [AI+Veo] Whisper cục bộ → Gemini tạo Veo prompt (T2V thuần) ──────
        setActive('extract');
        addLog(`🤖 [AI+Veo] Whisper cục bộ: phân tích lời thoại...`, 'info');
        markDone('extract');

        setActive('transcribe'); setActiveTab('transcript');
        try {
          result = await transcribeLocalChunked(
            filePath, totalSec,
            (msg) => addLog(`  ⏳ ${msg}`, 'info'),
            (done, total, segCount, errMsg) => {
              if (errMsg) addLog(`  ⚠️ Đoạn ${done}/${total}: ${errMsg}`, 'error');
              else        addLog(`  ✅ Đoạn ${done}/${total}: ${segCount} câu`, 'success');
            },
            (msg) => addLog(msg, 'info'),
            (msg) => addLog(msg, 'info')
          );
          addLog(`✅ [AI+Veo] Whisper xong — ${result.segments.length} câu`, 'success');
        } catch (whisperErr) {
          addLog(`⚠️ Whisper không khả dụng (${whisperErr.message.slice(0,80)}) — tự động chuyển sang Gemini...`, 'warn');
          if (!apiKeys.length) throw new Error('Whisper thất bại và không có Gemini API key để fallback. Vào Settings thêm key.');
          const _totalChunksGem = Math.ceil(totalSec / 90);
          addLog(`🔄 Gemini transcribe: ${_totalChunksGem} phần (90s/phần) · ${Math.min(apiKeys.length, 8)} key song song...`, 'info');
          result = await transcribeAudioChunked(
            apiKeys, totalSec,
            async (startSec, durationSec) =>
              window.electronAPI.extractAudioChunk({ filePath, startSec, durationSec }),
            (msg) => addLog(`  ⏳ ${msg}`, 'info'),
            (done, total, segCount, errMsg) => {
              if (errMsg) addLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'error');
              else        addLog(`  ✅ Phần ${done}/${total}: ${segCount} câu`, 'success');
            },
            (msg) => addLog(msg, 'info')
          );
          addLog(`✅ [AI+Veo] Gemini transcribe xong — ${result.segments.length} câu`, 'success');
        }
        if (stopRef.current) throw new Error('Đã dừng.');
        setTranscript(result);
        _gsFullText = result.fullText || '';
        addLog(`✅ [AI+Veo] Transcribe xong — ${result.segments.length} câu, ${_gsFullText.split(' ').length} từ`, 'success');

        // Phân tích tổng quát nội dung bằng Gemini
        addLog('🤖 [AI+Veo] Gemini phân tích nội dung...', 'info');
        try {
          oa = await analyzeOverallContent(
            apiKeys, result.fullText,
            ({ fromIdx, toIdx }) => addLog(`🔄 Key ${fromIdx + 1}→${toIdx + 1}`, 'info')
          );
          setOverallAnalysis(oa);
          addLog(`✅ [AI+Veo] Phân tích xong — ${oa.topic || ''}`, 'success');
        } catch (e) {
          addLog(`⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'error');
        }
        markDone('transcribe');
        if (stopRef.current) throw new Error('Đã dừng.');

        // Chia chunks tự nhiên theo nhịp lời thoại
        setActive('chunk'); setActiveTab('chunks');
        timeChunks = _autoChunk
          ? createNaturalChunks(result.segments, totalSec)
          : createTimeBasedChunks(result.segments, totalSec, _sceneDur);
        setChunks(timeChunks);
        addLog(`✅ [AI+Veo] ${timeChunks.length} cảnh${_autoChunk ? ' tự nhiên' : ''} — tiếp theo: Gemini tạo Veo prompt`, 'success');
        markDone('chunk');
        if (stopRef.current) throw new Error('Đã dừng.');

      } else if (_stockNoGemini) {
        // ── [Manual] Bỏ qua extract/transcribe/chunk — dùng từ khóa tay ───────
        setActive('extract'); markDone('extract');
        setActive('transcribe'); markDone('transcribe');
        setActive('chunk'); setActiveTab('chunks');
        // Dùng _sceneDur để chia chunks; clip cuối sẽ tự tính thời gian còn lại khi tải
        const _dur4Chunk = (_sceneDur <= 0) ? 8 : _sceneDur;
        timeChunks = createTimeBasedChunks([], totalSec, _dur4Chunk);
        setChunks(timeChunks);
        addLog(`✅ ${timeChunks.length} cảnh × ${_dur4Chunk}s (clip cuối tự khớp audio ${totalSec}s) — từ khóa thủ công`, 'success');
        markDone('chunk');

      } else if (_useLocalWhisper) {
        // ── [Whisper cục bộ] Transcribe bằng AI local, không cần Gemini API ───
        setActive('extract');
        const _totalChunks30 = Math.ceil(totalSec / 30);
        addLog(`Chia audio thành ${_totalChunks30} phần (30s/phần) → Whisper cục bộ...`, 'info');
        markDone('extract');

        setActive('transcribe'); setActiveTab('transcript');
        try {
          result = await transcribeLocalChunked(
            filePath,
            totalSec,
            (msg) => addLog(`  ⏳ ${msg}`, 'info'),
            (done, total, segCount, errMsg) => {
              if (errMsg) addLog(`  ⚠️ Đoạn ${done}/${total}: ${errMsg}`, 'error');
              else        addLog(`  ✅ Đoạn ${done}/${total}: ${segCount} câu`, 'success');
            },
            (msg) => addLog(msg, 'info'),
            (msg) => addLog(msg, 'info')
          );
          addLog(`✅ Whisper xong — ${result.segments.length} đoạn`, 'success');
        } catch (whisperErr) {
          addLog(`⚠️ Whisper không khả dụng (${whisperErr.message.slice(0,80)}) — tự động chuyển sang Gemini...`, 'warn');
          if (!apiKeys.length) throw new Error('Whisper thất bại và không có Gemini API key để fallback. Vào Settings thêm key.');
          const _fallbackChunks = Math.ceil(totalSec / 90);
          addLog(`🔄 Gemini transcribe fallback: ${_fallbackChunks} phần...`, 'info');
          result = await transcribeAudioChunked(
            apiKeys, totalSec,
            async (startSec, durationSec) =>
              window.electronAPI.extractAudioChunk({ filePath, startSec, durationSec }),
            (msg) => addLog(`  ⏳ ${msg}`, 'info'),
            (done, total, segCount, errMsg) => {
              if (errMsg) addLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'error');
              else        addLog(`  ✅ Phần ${done}/${total}: ${segCount} câu`, 'success');
            },
            (msg) => addLog(msg, 'info')
          );
          addLog(`✅ Gemini transcribe xong — ${result.segments.length} đoạn`, 'success');
        }
        if (stopRef.current) throw new Error('Đã dừng.');

        setTranscript(result);
        addLog(`✅ Transcribe xong — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');
        markDone('transcribe');
        if (stopRef.current) throw new Error('Đã dừng.');

        // Chia timeline (oa = null → keyword fallback dùng 'nature landscape')
        setActive('chunk'); setActiveTab('chunks');
        if (_autoChunk) {
          addLog(`Chia thành chunks tự nhiên theo câu nói...`, 'info');
          timeChunks = createNaturalChunks(result.segments, totalSec);
        } else {
          addLog(`Chia ${totalSec}s thành chunks (${_sceneDur}s/chunk)...`, 'info');
          timeChunks = createTimeBasedChunks(result.segments, totalSec, _sceneDur);
        }
        setChunks(timeChunks);
        addLog(`✅ Chia xong ${timeChunks.length} chunks${_autoChunk ? ' tự nhiên' : ''}`, 'success');
        markDone('chunk');
        if (stopRef.current) throw new Error('Đã dừng.');

      } else if (aiMode === 'groq') {
        // ── [Groq Whisper] Full pipeline: Transcribe + Analyze + Prompts qua Groq ─
        setActive('extract');
        const _totalChunksGroq = Math.ceil(totalSec / 180);
        addLog(`⚡ Groq Whisper: chia audio thành ${_totalChunksGroq} phần (3 phút/phần)...`, 'info');
        markDone('extract');

        setActive('transcribe'); setActiveTab('transcript');
        addLog(`⚡ Groq Whisper — ${_totalChunksGroq} phần · ${Math.min(groqKeys.length, 4)} key song song...`, 'info');

        result = await transcribeGroqChunked(
          groqKeys,
          totalSec,
          async (startSec, durationSec) =>
            window.electronAPI.extractAudioChunk({ filePath, startSec, durationSec }),
          (msg) => addLog(`  ${msg}`, 'info'),
          (done, total, segCount, errMsg) => {
            if (errMsg) addLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'error');
            else        addLog(`  ✅ Phần ${done}/${total}: ${segCount} câu thoại`, 'success');
          }
        );
        if (stopRef.current) throw new Error('Đã dừng.');

        setTranscript(result);
        addLog(`✅ Groq Whisper xong — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');

        addLog('⚡ Groq — Đang phân tích tổng quát nội dung...', 'info');
        try {
          oa = await analyzeOverallContentGroq(
            groqKeys, result.fullText,
            ({ fromIdx, toIdx }) => addLog(`🔄 Groq Key ${fromIdx + 1}→${toIdx + 1}`, 'info'),
            groqModel
          );
          setOverallAnalysis(oa);
          addLog(`✅ Phân tích xong — ${oa.topic || ''}`, 'success');
        } catch (e) {
          addLog(`⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'error');
        }
        markDone('transcribe');
        if (stopRef.current) throw new Error('Đã dừng.');

        setActive('chunk'); setActiveTab('chunks');
        addLog(`Chia ${totalSec}s thành ${Math.ceil(totalSec / _sceneDur)} chunks (${_sceneDur}s/chunk)...`, 'info');
        timeChunks = createTimeBasedChunks(result.segments, totalSec, _sceneDur);
        setChunks(timeChunks);
        addLog(`✅ Chia xong ${timeChunks.length} chunks với timestamp chính xác`, 'success');
        markDone('chunk');
        if (stopRef.current) throw new Error('Đã dừng.');

      } else {
        // ── [Gemini] Transcribe qua Gemini API ───────────────────────────────
        if (_manualTranscript) {
          // ── [SKIP] Dùng transcript tải lên — không gọi Gemini transcription ──
          markDone('extract');
          setActive('transcribe'); setActiveTab('transcript');
          addLog(`📄 Dùng transcript tải lên (${manualTranscriptName || 'text'}) — bỏ qua phân tích âm thanh`, 'success');
          result = parseManualTranscript(_manualTranscript, totalSec);
          setTranscript(result);
          addLog(`✅ Transcript từ file — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');
          markDone('transcribe');
        } else {
        setActive('extract');
        const CHUNK_SECS_LOG  = 90;
        const _totalChunks90  = Math.ceil(totalSec / CHUNK_SECS_LOG);
        const _parallel       = Math.min(apiKeys.length || 1, 8, _totalChunks90);
        addLog(`Chia audio thành ${_totalChunks90} phần (90s/phần) để gửi Gemini...`, 'info');
        markDone('extract');

        setActive('transcribe'); setActiveTab('transcript');
        addLog(`Đang gửi audio lên Gemini — ${_totalChunks90} phần × 90s · ${_parallel} key song song...`, 'info');

        result = await transcribeAudioChunked(
          apiKeys,
          totalSec,
          async (startSec, durationSec) =>
            window.electronAPI.extractAudioChunk({ filePath, startSec, durationSec }),
          (msg) => addLog(`  ⏳ ${msg}`, 'info'),
          (done, total, segCount, errMsg) => {
            if (errMsg) addLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'error');
            else        addLog(`  ✅ Phần ${done}/${total}: ${segCount} câu thoại`, 'success');
          },
          (msg) => addLog(msg, 'info'),
          1,
          _atvGeminiModel
        );
        if (stopRef.current) throw new Error('Đã dừng.');

        if (!result || (!result.segments?.length && !result.fullText?.trim()))
          throw new Error('Không nhận được kết quả transcription từ Gemini. Kiểm tra API Key và thử lại.');
        setTranscript(result);
        addLog(`✅ Transcript xong — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');
        markDone('transcribe');
        } // end else (Gemini transcription)

        addLog('Đang phân tích tổng quát nội dung...', 'info');
        try {
          oa = aiMode === 'claude'
            ? await analyzeOverallContentClaude({ apiKey: claudeKey, model: claudeModel, transcript: result.fullText })
            : await analyzeOverallContent(
                apiKeys,
                result.fullText,
                ({ fromIdx, toIdx }) => addLog(`🔄 Chuyển key ${fromIdx + 1}→${toIdx + 1}`, 'info')
              );
          setOverallAnalysis(oa);
          addLog(`✅ Phân tích xong — ${oa.topic || ''}`, 'success');
        } catch (e) {
          addLog(`⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'error');
        }
        if (stopRef.current) throw new Error('Đã dừng.');

        setActive('chunk'); setActiveTab('chunks');
        if (_autoChunk) {
          addLog(`Chia audio thành chunks tự nhiên (5–15s/chunk) theo câu nói...`, 'info');
          timeChunks = createNaturalChunks(result.segments, totalSec);
        } else {
          addLog(`Chia ${totalSec}s thành ${totalScenes} chunks (${_sceneDur}s/chunk)...`, 'info');
          timeChunks = createTimeBasedChunks(result.segments, totalSec, _sceneDur);
        }
        setChunks(timeChunks);
        addLog(`✅ Chia xong ${timeChunks.length} chunks${_autoChunk ? ' tự nhiên' : ''} với timestamp chính xác`, 'success');
        markDone('chunk');
        if (stopRef.current) throw new Error('Đã dừng.');
      } // end if/else transcribe mode

      // ── 4. Tạo Veo Prompts / Trích từ khóa (Stock) ───────────────────────
      let generatedScenes = [];
      let stockKeywords   = [];

      if (!_stockMode) {
        setActive('generate'); setActiveTab('prompts');
        const _providerLabel = aiMode === 'groq' ? '⚡ Groq' : aiMode === 'claude' ? '🤖 Claude' : 'Gemini';
        addLog(`Bắt đầu tạo ${timeChunks.length} Veo Prompts (${_providerLabel})...`, 'info');

        // ── Inject phong cách do user chọn vào overallContext ────────────────
        const STYLE_KEYWORDS_ATV = {
          'Photorealistic':  'Ultra-realistic photography, photorealistic render, 8K resolution, natural skin texture, real-world lighting, hyper-detailed DSLR quality',
          'Cinematic 4K':    'Cinematic 4K film quality, anamorphic lens, dramatic depth of field, professional color grading, film grain, Hollywood-level production',
          'Anime / Manga':   'Japanese anime 2D animation, clean sharp line art, cel-shaded flat coloring, expressive anime eyes, vibrant saturated palette',
          'Pixar 3D':        'Pixar/Disney 3D CGI, smooth subsurface scattering, warm key lighting, polished 3D render, expressive stylized characters',
          'Studio Ghibli':   'Studio Ghibli 2D hand-drawn animation, soft watercolor backgrounds, warm muted tones, expressive faces, gentle painterly line art',
          'Dark Fantasy':    'Dark fantasy digital painting, dramatic chiaroscuro, deep gothic shadows, epic fantasy illustration, moody desaturated palette',
          'Watercolor':      'Traditional watercolor painting, soft wet-on-wet washes, gentle color bleeds, textured paper, loose brushstrokes',
          'Cyberpunk':       'Cyberpunk art, neon-lit city, futuristic high contrast, synthwave color palette, rain-slicked streets',
          'Documentary':     'Documentary cinéma vérité, natural handheld camera, authentic real-world lighting, journalistic style',
        };
        const _capturedStyle = veoStyle;
        if (_capturedStyle !== 'auto' && STYLE_KEYWORDS_ATV[_capturedStyle]) {
          addLog(`🎨 Phong cách: ${_capturedStyle}`, 'info');
          oa = oa ? { ...oa, recommended_visual_style: STYLE_KEYWORDS_ATV[_capturedStyle] } : { recommended_visual_style: STYLE_KEYWORDS_ATV[_capturedStyle], topic: '', tone: '', context_summary: '' };
        }

        // Inject prompt đồng bộ nhân vật / bối cảnh
        // Nếu user chưa nhập → AI tự phân tích transcript và sinh description
        let _charBgPrompt = charBgPrompt.trim();
        if (!_charBgPrompt && result?.fullText && apiKeys.length) {
          addLog(`🎭 AI đang phân tích nhân vật & bối cảnh từ audio...`, 'info');
          try {
            const { GoogleGenAI: _GAI } = await import('@google/genai');
            const _ai = new _GAI({ apiKey: apiKeys[0] });
            const _resp = await _ai.models.generateContent({
              model: _atvGeminiModel,
              contents: [{ role: 'user', parts: [{ text: `Analyze this audio transcript and extract character & background descriptions for consistent Veo video generation.

TRANSCRIPT:
${(result.fullText || '').slice(0, 5000)}

${oa ? `TOPIC: ${oa.topic || ''}\nSUMMARY: ${oa.context_summary || ''}` : ''}

Write a single concise English description (2-4 sentences) covering:
1. Main character(s): physical appearance, clothing, distinctive features (use generic roles, NO real names)
2. Primary background/setting: location, atmosphere, time of day, visual environment

Format: "[Character description]. Background: [setting description]."
Return ONLY the description, no explanation.` }] }],
              config: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.3 },
            });
            const autoDesc = (_resp?.text || '').trim();
            if (autoDesc && autoDesc.length > 20) {
              _charBgPrompt = autoDesc;
              setCharBgPrompt(autoDesc); // hiển thị lên UI để user thấy
              addLog(`✅ AI sinh đồng bộ nhân vật/bối cảnh: "${autoDesc.slice(0, 100)}..."`, 'success');
            }
          } catch (e) {
            addLog(`⚠️ Tự động sinh nhân vật/bối cảnh thất bại: ${e.message}`, 'warn');
          }
        }
        if (_charBgPrompt) {
          addLog(`🎭 Đồng bộ nhân vật/bối cảnh: "${_charBgPrompt.slice(0, 80)}..."`, 'info');
          oa = oa
            ? { ...oa, character_background_sync: _charBgPrompt }
            : { character_background_sync: _charBgPrompt, topic: '', tone: '', context_summary: '' };
        }
        setGenProgress({ current: 0, total: timeChunks.length });

        // ── Chọn engine phân tích scene theo mode ──────────────────────────
        const _onSceneProgress = (current, total, keyInfo) => {
          setGenProgress({ current, total });
          const info = keyInfo ? ` — ${keyInfo}` : '';
          addLog(`Tạo prompt Scene ${current}/${total}${info}...`, 'info');
        };
        const _onSceneReady = (sceneData, isError) => {
          setScenes(prev => [...prev, sceneData]);
          if (isError) addLog(`⚠️ Scene ${sceneData.sceneNumber} dùng fallback: ${sceneData.error || ''}`, 'error');
          else         addLog(`✅ Scene ${sceneData.sceneNumber} xong`, 'success');
        };

        let _gs;
        if (_gsMode) {
          // ── AI+Veo: analyzeScenesContinuity — giữ mạch truyện toàn bộ audio ──
          addLog(`🎬 [AI+Veo] Gemini tạo Veo prompt đồng bộ kịch bản (${timeChunks.length} cảnh)...`, 'info');
          _gs = await analyzeScenesContinuity(
            apiKeys, timeChunks, _sceneDur, oa, _gsFullText,
            _onSceneProgress, _onSceneReady
          );
        } else if (aiMode === 'groq') {
          _gs = await analyzeScenesToGroq({
            apiKeys: groqKeys, model: groqModel,
            chunks: timeChunks, targetDuration: _sceneDur, overallContext: oa,
            onSceneProgress: (current, total) => { setGenProgress({ current, total }); addLog(`Scene ${current}/${total}...`, 'info'); },
            onSceneReady: (sceneData, isError) => { setScenes(prev => [...prev, sceneData]); if (isError) addLog(`Scene ${sceneData.sceneNumber} fallback`, 'error'); else addLog(`Scene ${sceneData.sceneNumber} xong`, 'success'); },
            onSwitch: ({ fromIdx, toIdx }) => addLog(`Groq Key ${fromIdx+1} -> Key ${toIdx+1}`, 'info'),
          });
        } else if (aiMode === 'claude') {
          _gs = await analyzeScenesClaude({
            apiKey: claudeKey, model: claudeModel,
            chunks: timeChunks, targetDuration: _sceneDur, overallContext: oa,
            onSceneProgress: (current, total) => { setGenProgress({ current, total }); addLog(`Scene ${current}/${total}...`, 'info'); },
            onSceneReady: (sceneData, isError) => { setScenes(prev => [...prev, sceneData]); if (isError) addLog(`⚠️ Scene ${sceneData.sceneNumber} fallback`, 'error'); else addLog(`✅ Scene ${sceneData.sceneNumber} xong`, 'success'); },
          });
        } else {
          _gs = await analyzeScenes(
            apiKeys, timeChunks, _sceneDur, oa,
            _onSceneProgress, _onSceneReady
          );
        }

        generatedScenes = _gs;
        setScenes(generatedScenes);
        const failCount = generatedScenes.filter(s => s.error).length;
        addLog(`🎉 Hoàn tất ${generatedScenes.length} prompts${failCount ? ` (${failCount} lỗi)` : ''}`, 'success');
        markDone('generate');

      } else if (_stockNoGemini) {
        // ── [Manual] Dùng từ khóa tay ────────────────────────────────────────
        setActive('generate');
        const _kwLines = _stockManualKw
          ? _stockManualKw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
          : ['nature landscape'];
        stockKeywords = timeChunks.map((_, i) => _kwLines[i % _kwLines.length]);
        addLog(`✅ [Stock] ${timeChunks.length} cảnh — từ khóa: ${[...new Set(stockKeywords)].slice(0, 4).join(' | ')}`, 'success');
        markDone('generate');
      } else if (_useLocalWhisper || _stockMode) {
        // ── [Whisper / Gemini / Groq stock] AI sinh từ khóa hình ảnh từ transcript ──
        setActive('generate');
        addLog('[Stock] AI phân tích nội dung → sinh từ khóa stock video...', 'info');
        const _fallbackTopic = (oa?.topic || 'nature landscape').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).slice(0, 3).join(' ') || 'nature landscape';
        try {
          if (aiMode === 'groq' && groqKeys.length) {
            stockKeywords = await generateStockKeywordsGroq(groqKeys, timeChunks, oa, () => {}, groqModel);
          } else {
            stockKeywords = await generateStockKeywordsAI(apiKeys, timeChunks, oa, () => {});
          }
          // Fallback cho chunk nào trả về rỗng
          stockKeywords = stockKeywords.map(kw => kw || _fallbackTopic);
          addLog(`✅ [Stock] AI sinh ${stockKeywords.length} từ khóa — ví dụ: ${stockKeywords.slice(0, 3).join(' | ')}`, 'success');
        } catch (e) {
          addLog(`⚠️ [Stock] AI keyword thất bại (${e.message}) → dùng word-freq`, 'warn');
          // Fallback: word-frequency cũ
          const _stops = new Set(['và','của','là','có','trong','với','cho','một','các','này','đó','đã','được','không','để','từ','hay','như','khi','thì','mà','về','ra','vào','lên','xuống','đến','lại','nên','vì','bởi','nhưng','hoặc','cũng','những','the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','have','has','do','does','did','not','so','if','as','up','out','into','over','just','very','too','more','no','my','your','his','her']);
          stockKeywords = timeChunks.map(chunk => {
            const text = (chunk.exactText || '').trim();
            if (!text || text.length < 8) return _fallbackTopic;
            const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !_stops.has(w) && !/^\d+$/.test(w));
            return [...new Set(words)].slice(0, 3).join(' ') || _fallbackTopic;
          });
        }
        markDone('generate');
      }

      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 4.5. [Ingredients Mode] Tự động tạo DNA nhân vật ──────────────────
      // charDnaMap: charName → { filePath, mediaId }
      const a2vCharDnaMap = {};  // shared vào bước tạo video
      if (_a2vIngMode && _makeVideo && generatedScenes.length > 0) {
        setActive('dna'); setActiveTab('dna');
        addLog('🧬 [Ingredients] Phân tích nhân vật từ câu chuyện...', 'info');

        // Dùng Gemini để detect tối đa 5 nhân vật chính từ overallContext + transcript
        let detectedChars = [];
        try {
          const fullTx = (result?.fullText || timeChunks.map(c => c.exactText || '').join(' ')).slice(0, 6000);
          const charDetectPrompt = `You are analyzing an audio/video transcript to identify the main characters for consistent visual DNA reference images.

OVERALL CONTEXT:
${oa ? `Topic: ${oa.topic || ''}\nTone: ${oa.tone || ''}\nSummary: ${oa.context_summary || ''}` : ''}
${charBgPrompt.trim() ? `USER CHARACTER NOTES: ${charBgPrompt.trim()}` : ''}

TRANSCRIPT:
${fullTx}

SCENE PROMPTS SAMPLE (first 5):
${generatedScenes.slice(0, 5).map((s, i) => `Scene ${i + 1}: ${(s.veoVideoPrompt || '').slice(0, 200)}`).join('\n')}

Identify up to 5 MAIN CHARACTERS (humans, animals, or key recurring objects).
For each character provide a detailed ENGLISH visual description suitable for Veo image generation.
Use generic role names — NO real person names.

Return ONLY valid JSON array (no markdown, no explanation):
[{"id":"char_0","name":"the hero","description":"Young Vietnamese man, mid-20s, short black hair, slim build, wearing a white linen shirt and dark jeans, calm expression, sharp jaw"}]`;

          const { GoogleGenAI: _GDNA } = await import('@google/genai');
          // Rotate keys để tránh quota exhausted
          let _dnaKeyIdx = 0;
          let _respDna = null;
          while (_dnaKeyIdx < apiKeys.length) {
            try {
              const _aiDna = new _GDNA({ apiKey: apiKeys[_dnaKeyIdx] });
              _respDna = await _aiDna.models.generateContent({
                model: _atvGeminiModel,
                contents: [{ role: 'user', parts: [{ text: charDetectPrompt }] }],
                config: { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.3 },
              });
              break;
            } catch (ke) {
              _dnaKeyIdx++;
              if (_dnaKeyIdx >= apiKeys.length) throw ke;
            }
          }
          const raw = (_respDna?.text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
          const arrMatch = raw.match(/\[[\s\S]*\]/);
          if (arrMatch) {
            const parsed = JSON.parse(arrMatch[0]);
            if (Array.isArray(parsed)) detectedChars = parsed.filter(c => c.id && c.description).slice(0, 5);
          }
          addLog(`✅ Phát hiện ${detectedChars.length} nhân vật: ${detectedChars.map(c => c.name).join(', ')}`, 'success');
        } catch (e) {
          addLog(`⚠️ Phát hiện nhân vật lỗi: ${e.message}`, 'warn');
        }

        // Fallback: nếu AI không detect được → dùng key_entities từ overallAnalysis
        if (detectedChars.length === 0 && oa?.key_entities?.length) {
          addLog('⚡ Fallback: dùng key_entities từ phân tích tổng quát làm nhân vật DNA...', 'info');
          detectedChars = oa.key_entities.slice(0, 3).map((name, i) => ({
            id: `char_${i}`,
            name: name.trim() || 'character',
            description: `${name}, ${oa.tone || 'cinematic'} style character, consistent appearance across all scenes`,
          }));
        }

        // Fallback cuối: nếu vẫn trống → tạo 1 nhân vật generic từ topic
        if (detectedChars.length === 0) {
          addLog('⚡ Fallback: tạo nhân vật generic từ chủ đề...', 'info');
          detectedChars = [{
            id: 'char_0',
            name: 'the main character',
            description: `Main character of this ${oa?.genre || ''} story about "${(oa?.topic || 'the story').slice(0, 60)}". ${oa?.tone || 'Cinematic'} style, consistent appearance.`,
          }];
        }

        if (detectedChars.length > 0 && !stopRef.current) {
          addLog(`🖼️ [Ingredients] Tạo ${detectedChars.length} ảnh DNA nhân vật bằng Gemini Imagen (không cần extension)...`, 'info');
          const stylePart = (oa?.recommended_visual_style) ? `${oa.recommended_visual_style}. ` : 'Photorealistic, 4K, high detail. ';
          try {
            const dnaImgPaths = [];
            const dnaTasks = detectedChars.map((ch, i) => ({
              id: `a2v_dna_c${i}`,
              prompt: `${stylePart}Character reference sheet. Portrait and full body views of the same character. Plain white studio background. CHARACTER: ${ch.name}, ${ch.description}. Consistent appearance. Photorealistic, cinematic quality. Safe for all audiences.`,
              fileIndex: i + 1,
            }));
            addLog(`🖼️ Gửi ${dnaTasks.length} task ảnh DNA lên Nano Banana Pro...`, 'info');
            const dnaResult = await window.electronAPI.runVeo({
              mediaType: 'Image', tasks: dnaTasks,
              aspectRatio: '16:9', model: _a2vImgMdl,
              genCount: '1x', quality: '720p',
              outputFolder: _a2vRefDir, duration: null,
            });
            const dnaFiles = (dnaResult?.files || []).filter(f => !f.isError && f.filePath);
            const dnaErrors = (dnaResult?.files || []).filter(f => f.isError);
            if (dnaErrors.length) addLog(`⚠️ ${dnaErrors.length} ảnh DNA lỗi: ${dnaErrors.map(f => f.error || '').join(' | ').slice(0, 120)}`, 'warn');
            dnaFiles.forEach(f => {
              const idxStr = (f.id || '').replace('a2v_dna_c', '');
              const idx = parseInt(idxStr);
              if (!isNaN(idx) && detectedChars[idx]) {
                const ch = detectedChars[idx];
                a2vCharDnaMap[ch.id] = { filePath: f.filePath, mediaId: null, name: ch.name }; // luôn upload lại để lấy media UUID cho Ingredients
                addLog(`  🧬 DNA "${ch.name}": ${f.filePath.split(/[\\/]/).pop()}${f.mediaId ? ' ✅ mediaId' : ''}`, 'info');
              }
            });
            dnaFiles.forEach(f => dnaImgPaths.push(f.filePath));

            setA2vDnaImgs([...dnaImgPaths]);
            addLog(`✅ [Ingredients] ${dnaImgPaths.length}/${detectedChars.length} ảnh DNA xong → ${Object.keys(a2vCharDnaMap).length} nhân vật có tham chiếu`, 'success');

            // ── Upload những ảnh chưa có mediaId → lấy UUID 1 lần, dùng cho tất cả cảnh ──
            const needUpload = Object.entries(a2vCharDnaMap).filter(([, v]) => v.filePath && !v.mediaId);
            if (needUpload.length > 0) {
              await window.electronAPI.clearUploadCache?.();
              addLog(`📤 Upload ${needUpload.length} ảnh DNA lên project lấy UUID (1 lần duy nhất)...`, 'info');
              for (const [charId, v] of needUpload) {
                if (stopRef.current) break;
                try {
                  const upRes = await window.electronAPI.uploadDnaImage({ imgPath: v.filePath, taskId: charId });
                  if (upRes?.ok && upRes.mediaId) {
                    a2vCharDnaMap[charId].mediaId = upRes.mediaId;
                    addLog(`  ✅ Upload "${v.name}" → UUID: ${upRes.mediaId.slice(0, 16)}...`, 'success');
                  } else {
                    addLog(`  ⚠️ Upload "${v.name}" thất bại — dùng file path (cần Extension active)`, 'warn');
                  }
                } catch (eu) {
                  addLog(`  ⚠️ Upload "${v.name}" lỗi: ${eu.message}`, 'warn');
                }
              }
              const withUUID = Object.values(a2vCharDnaMap).filter(v => v.mediaId).length;
              addLog(`📤 Upload xong: ${withUUID}/${Object.keys(a2vCharDnaMap).length} nhân vật có UUID → video sẽ dùng ingredientMediaIds`, 'info');
            }
          } catch (e) {
            addLog(`❌ [Ingredients] Tạo DNA lỗi: ${e.message}`, 'error');
          }
        }
        markDone('dna');
        if (stopRef.current) throw new Error('Đã dừng.');
      }

      // ── 5. Tạo Video ──────────────────────────────────────────────────────
      if (!_makeVideo) { markDone('video'); markDone('merge'); return; }

      setActive('video'); setActiveTab('video');
      const vPaths = [];
      // Khai báo ở scope rộng để phần merge (bước 6) có thể truy cập
      let orderedStockPaths = [];

      if (_stockMode) {
        // ── Stock Video flow ─────────────────────────────────────────────────
        // keywords đã được trích ở bước 4 (stockKeywords)
        addLog(`[Stock] Bắt đầu tìm + tải ${timeChunks.length} clip...`, 'info');
        setGenProgress({ current: 0, total: timeChunks.length });

        if (stopRef.current) throw new Error('Đã dừng.');

        orderedStockPaths = new Array(timeChunks.length).fill(null);
        // Tải lịch sử video đã dùng từ localStorage để không tải lại
        const STOCK_USED_KEY = 'fluxy_stock_used_ids';
        const _loadUsed = () => { try { return JSON.parse(localStorage.getItem(STOCK_USED_KEY) || '[]'); } catch { return []; } };
        const _saveUsed = (ids) => { try { localStorage.setItem(STOCK_USED_KEY, JSON.stringify([...ids].slice(-2000))); } catch {} };
        const usedVideoIds = new Set(_loadUsed());

        // Helper: search với fallback keyword
        const stockSearchWithFallback = async (keyword) => {
          const doSearch = (kw) => window.electronAPI.stockVideoSearch({
            keyword: kw, provider: _stockProvider, apiKey: _stockApiKey, perPage: 15,
          });
          let sr = await doSearch(keyword);
          if (sr?.success && sr.results?.length) return { results: sr.results, usedKw: keyword };
          const stopWords = new Set(['with','from','that','this','have','just','what','when','then','they','them','will','into','over','your','their','about','been','were','would','could','should']);
          const words = keyword.split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
            .sort((a, b) => b.length - a.length).slice(0, 3);
          for (const word of words) {
            sr = await doSearch(word);
            if (sr?.success && sr.results?.length) return { results: sr.results, usedKw: word };
          }
          return null;
        };

        // ── PARALLEL DOWNLOAD với concurrency 4 ──────────────────────────────
        const CONCURRENCY = 4;
        let doneCount = 0;
        addLog(`[Stock] Tải ${timeChunks.length} clip song song (${CONCURRENCY} luồng)...`, 'info');

        // Hàng đợi index chờ xử lý
        const queue = Array.from({ length: timeChunks.length }, (_, i) => i);
        const queueMutex = { idx: 0 };

        const processOne = async (i) => {
          if (stopRef.current) return;
          await checkPause();

          const keyword   = stockKeywords[i];
          const chunk     = timeChunks[i];
          const isLast    = i === timeChunks.length - 1;
          // Luôn dùng duration thực của chunk; clip cuối lấy thời gian còn lại để khớp audio
          const targetDur = isLast
            ? Math.max(1, totalSec - chunk.timeStart)
            : Math.max(1, chunk.timeEnd - chunk.timeStart);

          try {
            const searchResult = await stockSearchWithFallback(keyword);
            if (!searchResult) {
              addLog(`⚠️ [Stock] Clip ${i + 1}: không tìm thấy "${keyword}"`, 'warn');
            } else {
              const { results, usedKw } = searchResult;
              const landscapeOnly = results.filter(v => v.width && v.height ? v.width > v.height : true);
              const filtered = landscapeOnly.length > 0 ? landscapeOnly : results;
              const sorted = [...filtered].sort((a, b) => {
                const aOk = a.duration >= targetDur ? 0 : 1;
                const bOk = b.duration >= targetDur ? 0 : 1;
                if (aOk !== bOk) return aOk - bOk;
                return b.duration - a.duration;
              });
              // Ưu tiên video chưa dùng (kể cả lịch sử các lần chạy trước)
              const uniqueSorted = sorted.filter(v => !usedVideoIds.has(String(v.id)));
              if (uniqueSorted.length === 0)
                addLog(`⚠️ [Stock] Clip ${i + 1}: tất cả ${sorted.length} kết quả đã dùng trước đó → tìm từ khóa khác`, 'warn');
              const chosen = uniqueSorted.length > 0 ? uniqueSorted[0] : null;
              if (!chosen) {
                addLog(`⚠️ [Stock] Clip ${i + 1}: bỏ qua — không còn video mới cho "${keyword}"`, 'warn');
              } else {
                usedVideoIds.add(String(chosen.id));
                _saveUsed(usedVideoIds); // lưu ngay sau khi chọn

                const rawPath  = `${_vidDir}\\stock_raw_${i}_${Date.now()}.mp4`;
                const trimPath = `${_vidDir}\\stock_${String(i).padStart(4, '0')}.mp4`;

                const dr = await window.electronAPI.stockVideoDownload({ url: chosen.url, destPath: rawPath });
                if (!dr?.success) {
                  addLog(`⚠️ [Stock] Clip ${i + 1} tải thất bại: ${dr?.error}`, 'error');
                  window.electronAPI?.deleteFile?.(rawPath).catch(() => {});
                } else {
                  const tr = await window.electronAPI.trimLoopVideo({
                    inputPath: rawPath, duration: targetDur, outputPath: trimPath, targetW: 1280, targetH: 720,
                  });
                  window.electronAPI?.deleteFile?.(rawPath).catch(() => {});
                  if (tr?.success) {
                    orderedStockPaths[i] = trimPath;
                    setVideoPaths(prev => [...prev, trimPath]);
                    addLog(`✅ [Stock] Clip ${i + 1}/${timeChunks.length} OK · "${usedKw}" (ID: ${chosen.id})`, 'success');
                  } else {
                    addLog(`⚠️ [Stock] Trim ${i + 1} thất bại: ${tr?.error}`, 'error');
                    window.electronAPI?.deleteFile?.(trimPath).catch(() => {});
                  }
                }
              }
            }
          } catch (e) {
            addLog(`⚠️ [Stock] Clip ${i + 1} lỗi: ${e.message}`, 'error');
          }
          doneCount++;
          setGenProgress({ current: doneCount, total: timeChunks.length });
        };

        // Worker pool: CONCURRENCY workers cùng chạy
        await Promise.all(
          Array.from({ length: CONCURRENCY }, async () => {
            while (queueMutex.idx < queue.length) {
              const i = queueMutex.idx++;
              if (i >= queue.length) break;
              await processOne(i);
            }
          })
        );

        // Fallback: clip nào null → dùng clip gần nhất
        for (let i = 0; i < orderedStockPaths.length; i++) {
          if (!orderedStockPaths[i]) {
            const prev = orderedStockPaths.slice(0, i).filter(Boolean).pop()
                      || orderedStockPaths.slice(i + 1).filter(Boolean)[0];
            if (prev) { orderedStockPaths[i] = prev; addLog(`ℹ️ [Stock] Clip ${i + 1}: dùng lại clip gần nhất`, 'info'); }
          }
        }

        orderedStockPaths.filter(Boolean).forEach(p => vPaths.push(p));
        if (!vPaths.length) throw new Error('Không tải được clip nào từ Stock Video. Kiểm tra API key và kết nối.');
        addLog(`✅ [Stock] Tải xong ${orderedStockPaths.filter(Boolean).length}/${timeChunks.length} clip`, 'success');

      } else {
        // ── Veo flow — 8 luồng song song, tải xong video nào chạy ngay video mới ──
        // Build ingredients data từ a2vCharDnaMap (nếu Ingredients mode)
        const _dnaEntries = Object.entries(a2vCharDnaMap);
        const _hasDna     = _a2vIngMode && _dnaEntries.length > 0;

        if (_a2vIngMode && !_hasDna) {
          addLog('⚠️ [Ingredients] Không có ảnh DNA nào thành công → tự động chuyển sang T2V thường. Kiểm tra Extension đang mở tab Google Labs.', 'warn');
        }

        // Build charImgMap / charMediaMap từ a2vCharDnaMap (giống URL to Video)
        const _a2vCharImgMap   = {};
        const _a2vCharMediaMap = {};
        _dnaEntries.forEach(([id, v]) => {
          if (v.filePath) _a2vCharImgMap[id]   = v.filePath;
          if (v.mediaId)  _a2vCharMediaMap[id]  = v.mediaId;
        });
        const _globalMediaIds = Object.values(_a2vCharMediaMap).filter(Boolean);
        const _globalImgPaths = Object.values(_a2vCharImgMap).filter(Boolean);

        // Smart DNA selector — chỉ lấy nhân vật xuất hiện trong prompt, tối đa 3
        const _selectDNA = (promptText) => {
          const MAX = 3;
          const promptLow = (promptText || '').toLowerCase();
          const picked = [];
          const seen = new Set();
          const tryAdd = (id) => {
            if (seen.has(id) || picked.length >= MAX) return;
            const mediaId = _a2vCharMediaMap[id];
            const imgPath = _a2vCharImgMap[id];
            if (!mediaId && !imgPath) return;
            seen.add(id);
            picked.push({ id, mediaId, imgPath });
          };
          // Chỉ lấy nhân vật được nhắc tên trong prompt
          _dnaEntries.forEach(([id, v]) => {
            const nameLow = (v.name || '').toLowerCase();
            const words = nameLow.split(/\s+/).filter(w => w.length > 2);
            if (words.some(w => promptLow.includes(w))) tryAdd(id);
          });

          const withMedia = picked.filter(e => e.mediaId);
          const withPath  = picked.filter(e => !e.mediaId && e.imgPath);
          return withMedia.length > 0
            ? { mediaIds: withMedia.map(e => e.mediaId), imgPaths: [], labels: withMedia.map(e => e.id) }
            : { mediaIds: [], imgPaths: withPath.map(e => e.imgPath), labels: withPath.map(e => e.id) };
        };

        const _ingLabel = _hasDna ? ' [Ingredients]' : ' T2V';
        addLog(`[Veo] Bắt đầu tạo ${generatedScenes.length} video${_ingLabel} — DNA pool: ${_globalImgPaths.length} ảnh / ${_globalMediaIds.length} UUID...`, 'info');
        const MAX_RETRY_PER = 5;

        {
          // Chuẩn bị tất cả task với retry count
          const allTasks_a2v = generatedScenes.map((s, i) => {
            const baseTask = {
              id:          `vid_${i}`,
              origIdx:     i,
              prompt:      applyVeoPolicy(stripProminentPeople(s.veoVideoPrompt || 'Cinematic establishing shot, smooth camera movement')),
              retries:     0,
              policyFixed: false,
            };
            // Ingredients: smart selector giống URL to Video
            if (_hasDna) {
              const dna = _selectDNA(baseTask.prompt);
              if (dna.mediaIds.length > 0) {
                baseTask.ingredientMediaIds = dna.mediaIds;
                addLog(`[Veo] Cảnh ${i + 1}: 🖼️ [${dna.labels.join(', ')}] → ${dna.mediaIds.length} DNA UUID`, 'info');
              } else if (dna.imgPaths.length > 0) {
                baseTask.ingredientImages = dna.imgPaths;
                addLog(`[Veo] Cảnh ${i + 1}: 🖼️ [${dna.labels.join(', ')}] → ${dna.imgPaths.length} DNA ảnh`, 'info');
              } else {
                addLog(`[Veo] Cảnh ${i + 1}: ⚠️ không có DNA phù hợp → T2V`, 'info');
              }
            }
            return baseTask;
          });

          // Dedup: task trùng prompt → map sang cùng slot
          const dedupedTasks = dedupTasksByPrompt(allTasks_a2v.map(t => ({ id: t.id, prompt: t.prompt })), addLog);
          const dedupIds = new Set(dedupedTasks.map(t => t.id));
          const activeInitial = allTasks_a2v.filter(t => dedupIds.has(t.id));

          const orderedA2VPaths = new Array(generatedScenes.length).fill(null);
          let doneCount = 0;
          const total = generatedScenes.length;
          setGenProgress({ current: 0, total });

          if (_hasDna) {
            // ── Ingredients mode: gửi TẤT CẢ tasks 1 lần → engine xử lý nội bộ (giống VeoStudio) ──
            addLog(`🚀 [Veo Ingredients] Gửi ${activeInitial.length} tasks → engine (3 workers nội bộ)...`, 'info');
            let pendingTasks = activeInitial.map(t => ({
              id: t.id, origIdx: t.origIdx, prompt: t.prompt,
              ingredientMediaIds: t.ingredientMediaIds,
              ingredientImages:   t.ingredientImages,
              retries: 0, policyFixed: false,
            }));

            for (let attempt = 1; attempt <= MAX_RETRY_PER && pendingTasks.length > 0; attempt++) {
              if (stopRef.current) break;
              await checkPause();
              if (attempt > 1) {
                addLog(`🔄 [Veo Ingredients] Retry lần ${attempt}: ${pendingTasks.length} task chưa xong...`, 'info');
                await sleep(10000);
              }

              const idToOrigIdx = new Map(pendingTasks.map(t => [t.id, t.origIdx]));
              const veoTasks = pendingTasks.map(t => {
                const vt = { id: t.id, prompt: t.prompt, fileIndex: t.origIdx + 1 };
                if (t.ingredientMediaIds?.length) vt.ingredientMediaIds = t.ingredientMediaIds;
                if (t.ingredientImages?.length)   vt.ingredientImages   = t.ingredientImages;
                return vt;
              });

              const vr = await window.electronAPI.runVeo({
                mediaType: 'Video', tasks: veoTasks,
                aspectRatio: _vidRatio, model: _vidModel,
                genCount: '1x', quality: _vidQuality,
                outputFolder: _vidDir, duration: `${_vidSceneDur}s`,
              });

              const files = vr?.files || [];
              const stillFailing = [];

              for (const f of files) {
                const origIdx = idToOrigIdx.get(f.id);
                if (origIdx === undefined) continue;
                if (!f.isError && f.filePath && !orderedA2VPaths[origIdx]) {
                  orderedA2VPaths[origIdx] = f.filePath;
                  doneCount++;
                  setGenProgress({ current: doneCount, total });
                  addLog(`✅ [Veo] Cảnh ${origIdx + 1}/${total} xong (${doneCount}/${total} done)`, 'success');
                } else if (f.isError && !orderedA2VPaths[origIdx]) {
                  const origTask = pendingTasks.find(t => t.id === f.id);
                  if (!origTask) continue;
                  const errMsg = String(f.error || 'unknown');
                  const isPolicy = isPolicyViolation(errMsg);
                  addLog(`⚠️ [Veo] Cảnh ${origIdx + 1} lỗi (lần ${attempt}): ${errMsg.slice(0, 80)}`, 'warn');
                  if (attempt < MAX_RETRY_PER) {
                    let nextPrompt = origTask.prompt;
                    let policyFixed = origTask.policyFixed;
                    if (isPolicy && !origTask.policyFixed) {
                      // Lần 1: sanitize từ khoá
                      nextPrompt = sanitizePrompt(origTask.prompt);
                      policyFixed = true;
                      addLog(`🔧 [Veo] Cảnh ${origIdx + 1}: sanitize prompt vi phạm chính sách`, 'info');
                    } else if (isPolicy && attempt === 2) {
                      // Lần 2: AI rewrite toàn bộ
                      try {
                        const _ingAiCfg = { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel, geminiModel: _atvGeminiModel };
                        addLog(`🤖 [Veo] Cảnh ${origIdx + 1}: AI rewrite prompt vi phạm...`, 'info');
                        nextPrompt = await rewritePromptForVeo(origTask.prompt, errMsg, _ingAiCfg);
                        addLog(`✅ [Veo] Cảnh ${origIdx + 1}: prompt đã được AI rewrite`, 'success');
                      } catch (_) {
                        nextPrompt = sanitizePrompt(origTask.prompt);
                      }
                    }
                    stillFailing.push({
                      ...origTask,
                      id:          `${origTask.id}_r${attempt}`,
                      prompt:      nextPrompt,
                      policyFixed,
                      retries:     attempt,
                    });
                  } else {
                    doneCount++;
                    setGenProgress({ current: doneCount, total });
                    addLog(`❌ [Veo] Cảnh ${origIdx + 1} hết ${MAX_RETRY_PER} lần retry → bỏ qua`, 'error');
                  }
                }
              }
              pendingTasks = stillFailing;
            }
          } else {
            // ── T2V mode: 8 workers song song ──
            const VEO_WORKERS = 8;
            const queue = [...activeInitial];
            let qHead = 0;
            const claimedSlots = new Set();

            const runWorker = async (workerId) => {
              while (true) {
                if (stopRef.current) break;
                await checkPause();
                if (qHead >= queue.length) break;
                const task = queue[qHead++];
                if (orderedA2VPaths[task.origIdx] || claimedSlots.has(task.origIdx)) continue;
                claimedSlots.add(task.origIdx);
                if (task.retries > 0) await sleep(task.retries * 3000);
                try {
                  const _veoTask = { id: task.id, prompt: task.prompt };
                  if (task.ingredientMediaIds?.length) _veoTask.ingredientMediaIds = task.ingredientMediaIds;
                  if (task.ingredientImages?.length)   _veoTask.ingredientImages   = task.ingredientImages;
                  const vr = await window.electronAPI.runVeo({
                    mediaType: 'Video',
                    tasks: [_veoTask],
                    aspectRatio: _vidRatio, model: _vidModel,
                    genCount: '1x', quality: _vidQuality,
                    outputFolder: _vidDir, duration: `${_vidSceneDur}s`,
                  });
                  const files   = vr?.files || [];
                  const success = files.find(f => !f.isError && f.filePath);
                  const failure = files.find(f => f.isError);
                  if (success?.filePath) {
                    if (!orderedA2VPaths[task.origIdx]) {
                      orderedA2VPaths[task.origIdx] = success.filePath;
                      doneCount++;
                      setGenProgress({ current: doneCount, total });
                      addLog(`✅ [Veo W${workerId}] Cảnh ${task.origIdx + 1}/${total} xong (${doneCount}/${total} done)`, 'success');
                    } else {
                      window.electronAPI?.deleteFile?.(success.filePath).catch(() => {});
                    }
                  } else {
                    const errMsg = failure?.error || 'unknown error';
                    const isPolicy = isPolicyViolation(errMsg);
                    if (task.retries < MAX_RETRY_PER) {
                      let newPrompt = task.prompt;
                      if (isPolicy && !task.policyFixed) {
                        newPrompt = sanitizePrompt(task.prompt);
                        addLog(`🚫 [W${workerId}] Cảnh ${task.origIdx + 1} vi phạm → làm sạch prompt, retry ${task.retries + 1}/${MAX_RETRY_PER}`, 'warn');
                      } else {
                        addLog(`⚠️ [W${workerId}] Cảnh ${task.origIdx + 1} lỗi → retry ${task.retries + 1}/${MAX_RETRY_PER}: ${errMsg.slice(0, 60)}`, 'warn');
                      }
                      claimedSlots.delete(task.origIdx);
                      queue.push({ ...task, id: `${task.id}_r${task.retries + 1}`, prompt: newPrompt, retries: task.retries + 1, policyFixed: isPolicy ? true : task.policyFixed });
                    } else {
                      doneCount++;
                      setGenProgress({ current: doneCount, total });
                      addLog(`❌ [W${workerId}] Cảnh ${task.origIdx + 1} hết ${MAX_RETRY_PER} lần retry → bỏ qua`, 'error');
                    }
                  }
                } catch (e) {
                  if (task.retries < MAX_RETRY_PER) {
                    claimedSlots.delete(task.origIdx);
                    queue.push({ ...task, id: `${task.id}_e${task.retries + 1}`, retries: task.retries + 1 });
                    addLog(`⚠️ [W${workerId}] Cảnh ${task.origIdx + 1} exception → retry: ${e.message.slice(0, 60)}`, 'warn');
                  } else {
                    doneCount++;
                    setGenProgress({ current: doneCount, total });
                    addLog(`❌ [W${workerId}] Cảnh ${task.origIdx + 1} exception hết retry: ${e.message.slice(0, 60)}`, 'error');
                  }
                }
              }
            };

            addLog(`🚀 [Veo] Chạy ${VEO_WORKERS} workers song song — ${queue.length} video trong queue...`, 'info');
            await Promise.all(
              Array.from({ length: VEO_WORKERS }, (_, i) => runWorker(i + 1))
            );
          }

          const successCount = orderedA2VPaths.filter(Boolean).length;
          addLog(`✅ [Veo] ${_hasDna ? 'Batch Ingredients' : 'Worker pool T2V'} xong — ${successCount}/${total} video thành công`, successCount > 0 ? 'success' : 'error');

          // ── Stock fallback: video nào vẫn null sau tất cả retry → tìm stock thay thế ──
          const nullIndices = orderedA2VPaths
            .map((p, i) => p ? null : i)
            .filter(i => i !== null);

          if (nullIndices.length > 0 && _stockProvider && _stockApiKey) {
            addLog(`📦 [Veo→Stock] ${nullIndices.length} video lỗi → tự động tìm stock thay thế (${_vidSceneDur}s)...`, 'info');
            for (const idx of nullIndices) {
              if (stopRef.current) break;
              const scene    = generatedScenes[idx];
              const rawKw    = (scene?.veoVideoPrompt || scene?.dialogue || 'cinematic scene')
                .replace(/safe for all audiences.*$/i, '')
                .replace(/family.friendly.*$/i, '')
                .replace(/aspect ratio.*$/i, '')
                .replace(/cinematic shot.*$/i, '')
                .replace(/[^a-zA-Z\s]/g, ' ')
                .split(/\s+/).filter(w => w.length > 3).slice(0, 3).join(' ') || 'nature landscape';
              try {
                // Tìm stock
                const doSearch = (kw) => window.electronAPI.stockVideoSearch({
                  keyword: kw, provider: _stockProvider, apiKey: _stockApiKey, perPage: 10
                });
                let sr = await doSearch(rawKw);
                if (!sr?.success || !sr.results?.length) {
                  // Thử từng từ riêng lẻ
                  for (const w of rawKw.split(' ')) {
                    sr = await doSearch(w);
                    if (sr?.success && sr.results?.length) break;
                  }
                }
                if (!sr?.success || !sr.results?.length) {
                  addLog(`  ⚠️ [Stock] Cảnh ${idx + 1}: không tìm được stock`, 'warn');
                  continue;
                }
                // Chọn clip có duration ≥ _vidSceneDur, ưu tiên gần nhất
                const sorted = [...sr.results].sort((a, b) => {
                  const aOk = a.duration >= _vidSceneDur ? 0 : 1;
                  const bOk = b.duration >= _vidSceneDur ? 0 : 1;
                  if (aOk !== bOk) return aOk - bOk;
                  return Math.abs(a.duration - _vidSceneDur) - Math.abs(b.duration - _vidSceneDur);
                });
                const chosen  = sorted[0];
                const rawPath = `${_vidDir}\\a2v_fb_raw_${idx}_${Date.now()}.mp4`;
                const outPath = `${_vidDir}\\a2v_fb_${String(idx).padStart(4,'0')}.mp4`;
                const dr = await window.electronAPI.stockVideoDownload({ url: chosen.url, destPath: rawPath });
                if (!dr?.success) { addLog(`  ⚠️ [Stock] Cảnh ${idx + 1}: tải stock thất bại`, 'warn'); continue; }
                const tr = await window.electronAPI.trimLoopVideo({
                  inputPath: rawPath, duration: _vidSceneDur,
                  outputPath: outPath, targetW: 1280, targetH: 720
                });
                window.electronAPI?.deleteFile?.(rawPath).catch(() => {});
                if (tr?.success) {
                  orderedA2VPaths[idx] = outPath;
                  addLog(`✅ [Stock] Cảnh ${idx + 1}: stock thay thế OK "${rawKw}" (${_vidSceneDur}s)`, 'success');
                }
              } catch (e) {
                addLog(`  ⚠️ [Stock] Cảnh ${idx + 1} lỗi: ${e.message}`, 'error');
              }
            }
            const recovered = nullIndices.filter(i => orderedA2VPaths[i]).length;
            if (recovered > 0) addLog(`✅ [Stock] Đã cứu ${recovered}/${nullIndices.length} cảnh bằng stock video`, 'success');
          } else if (nullIndices.length > 0) {
            addLog(`⚠️ ${nullIndices.length} cảnh lỗi — chưa cấu hình Stock API key để tự động thay thế`, 'warn');
          }

          // Đẩy vào vPaths theo thứ tự đúng (setVideoPaths đã được gọi realtime ở trên)
          orderedA2VPaths.filter(Boolean).forEach(p => { vPaths.push(p); });
        }

        if (!vPaths.length) throw new Error('Không tạo được video nào.');
        addLog(`✅ [Veo] Tạo xong ${vPaths.length} video`, 'success');
      }

      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 6 + 7. Ghép clip stock + chèn audio gốc (FFmpeg local, 1 bước) ──────
      setActive('merge'); setActiveTab('merge');

      // Lấy danh sách clip: Stock mode → orderedStockPaths, Veo mode → vPaths
      const stockClips = _stockMode ? orderedStockPaths.filter(Boolean) : [...vPaths];
      addLog(`🎬 Ghép ${stockClips.length} clip ${_stockMode ? 'stock' : 'Veo'} bằng FFmpeg...`, 'info');

      if (stockClips.length === 0) {
        addLog('⚠️ Không có clip nào để ghép', 'error');
        markDone('merge');
        markDone('remaster');
      } else if (stockClips.length === 1) {
        // Chỉ 1 clip: mux audio trực tiếp
        addLog('⚠️ Chỉ 1 clip — mux audio trực tiếp...', 'info');
        const outName = `final_${Date.now()}`;
        const rmr = await window.electronAPI.replaceAudio({
          videoPath: stockClips[0], audioPath: filePath,
          outputFolder: _vidDir,
        });
        if (rmr?.success && rmr?.path) {
          setMergedPath(rmr.path); setFinalPath(rmr.path);
          addLog(`✅ Hoàn tất! ${rmr.path.split(/[\\/]/).pop()}`, 'success');
        } else {
          addLog(`⚠️ Mux audio lỗi: ${rmr?.error}`, 'error');
          setFinalPath(stockClips[0]);
        }
        markDone('merge');
        markDone('remaster');
      } else {
        // Nhiều clip: dùng concat-audio (concat demuxer + mux audio, không re-encode)
        const outName = `final_stock_${Date.now()}`;
        addLog(`📋 Concat list: ${stockClips.length} clip → ghép + chèn audio gốc...`, 'info');
        const car = await window.electronAPI.concatAudio({
          clips:        stockClips,
          audioPath:    filePath,
          outputFolder: _vidDir,
          outputName:   outName,
        });
        if (car?.success && car?.path) {
          setMergedPath(car.path); setFinalPath(car.path);
          addLog(`✅ Hoàn tất! ${car.path.split(/[\\/]/).pop()}`, 'success');
        } else {
          addLog(`⚠️ concat-audio lỗi: ${car?.error || 'unknown'}`, 'error');
          // Fallback: ghép video trước rồi mux audio riêng
          addLog('🔄 Fallback: mergeVideo + replaceAudio...', 'info');
          const mr = await window.electronAPI.mergeVideo({
            files: stockClips, trimStart: 0, trimEnd: 0,
            transition: 'Không có', outputFolder: _vidDir, outputName: `merged_${Date.now()}`,
          });
          if (mr?.success && mr?.path) {
            const rmr = await window.electronAPI.replaceAudio({
              videoPath: mr.path, audioPath: filePath, outputFolder: _vidDir,
            });
            const fp = rmr?.success ? rmr.path : mr.path;
            setMergedPath(mr.path); setFinalPath(fp);
            addLog(`✅ Fallback xong: ${fp.split(/[\\/]/).pop()}`, 'success');
          } else {
            addLog(`❌ Fallback ghép lỗi: ${mr?.error}`, 'error');
          }
        }
        markDone('merge');
        if (stopRef.current) throw new Error('Đã dừng.');
        markDone('remaster');
      }

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally {
      setRunning(false); pauseRef.current = false; setPaused(false);
    }
  };

  const stepStatus = (id) =>
    doneSteps.includes(id) ? 'done'
    : activeStep === id    ? 'active'
    : errorStep  === id    ? 'error'
    : 'pending';

  const handleCopyAll = () => {
    if (!scenes.length) return;
    navigator.clipboard.writeText(exportToTxt(scenes));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleSaveTxt = async () => {
    const content = exportToTxt(scenes);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.txt` });
  };

  const handleSaveJson = async () => {
    const meta = { fileName, duration, sceneDuration: sceneDur };
    const content = exportToJson(scenes, meta);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.json` });
  };

  const handleSaveMd = async () => {
    const meta = { fileName, duration, sceneDuration: sceneDur };
    const content = exportToMarkdown(scenes, meta);
    const base = fileName.replace(/\.[^.]+$/, '');
    await window.electronAPI?.saveTextFile?.({ content, filename: `veo_prompts_${base}.md` });
  };

  // ── Render results ─────────────────────────────────────────────────────────
  const renderResults = () => {
    const hasData = transcript || overallAnalysis || chunks.length > 0 || scenes.length > 0;
    if (!hasData) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Music2 size={32} className="text-slate-700" />
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây</p>
      </div>
    );

    if (activeTab === 'transcript') return (
      <div className="h-full flex flex-col gap-3">
        {transcript && (
          <>
            <div className="shrink-0">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Full Transcript ({transcript.segments.length} đoạn)
              </p>
              <div className="bg-[#060b14] border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 leading-relaxed max-h-28 overflow-y-auto custom-scrollbar font-mono">
                {transcript.fullText || <span className="text-slate-600 italic">Không có lời thoại</span>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 pr-1">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Segments với timestamp</p>
              {transcript.segments.map((seg, i) => (
                <div key={i} className="flex items-start gap-2 bg-[#0d1322] border border-slate-800 rounded-lg px-2.5 py-1.5">
                  <span className="text-[9px] font-mono text-blue-400 shrink-0 w-24">
                    {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s
                  </span>
                  <span className="text-[10px] text-slate-300 leading-relaxed">{seg.text}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!transcript && <p className="text-xs text-slate-600">Chưa transcribe</p>}
      </div>
    );

    if (activeTab === 'analysis') return (
      <div className="h-full overflow-y-auto custom-scrollbar space-y-3 pr-1">
        {overallAnalysis ? (
          <>
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3 space-y-2">
              <p className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Chủ đề</p>
              <p className="text-[11px] text-slate-200 leading-relaxed">{overallAnalysis.topic}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-purple-400 uppercase tracking-widest mb-1.5">Tone & Style</p>
                <p className="text-[10px] text-slate-300">{overallAnalysis.tone}</p>
              </div>
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-amber-400 uppercase tracking-widest mb-1.5">Phong cách video</p>
                <p className="text-[10px] text-slate-300">{overallAnalysis.recommended_visual_style}</p>
              </div>
            </div>
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mb-1.5">Tóm tắt ngữ cảnh</p>
              <p className="text-[11px] text-slate-200 leading-relaxed">{overallAnalysis.context_summary}</p>
            </div>
            {overallAnalysis.key_entities?.length > 0 && (
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest mb-2">Thực thể chính</p>
                <div className="flex flex-wrap gap-1">
                  {overallAnalysis.key_entities.map((e, i) => (
                    <span key={i} className="text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2 py-0.5 rounded-full">{e}</span>
                  ))}
                </div>
              </div>
            )}
            {overallAnalysis.visual_themes?.length > 0 && (
              <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
                <p className="text-[9px] font-bold text-violet-400 uppercase tracking-widest mb-2">Chủ đề hình ảnh</p>
                <div className="flex flex-wrap gap-1">
                  {overallAnalysis.visual_themes.map((t, i) => (
                    <span key={i} className="text-[9px] bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Cấu trúc kể chuyện</p>
              <p className="text-[10px] text-slate-300 leading-relaxed">{overallAnalysis.narrative_arc}</p>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            {running && activeStep === 'transcribe'
              ? <div className="flex items-center gap-2 text-slate-500"><Loader2 size={14} className="animate-spin text-blue-500"/><span className="text-xs">Đang phân tích...</span></div>
              : <p className="text-xs text-slate-600">Chưa phân tích</p>
            }
          </div>
        )}
      </div>
    );

    if (activeTab === 'chunks') return (
      <div className="h-full flex flex-col">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 shrink-0">
          {chunks.length} Chunks · {sceneDur}s/chunk — Timestamp được khóa cứng
        </p>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
          {chunks.map((c, i) => (
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Scene {c.scene}</span>
                <span className="text-[9px] font-mono text-slate-500">{c.time}</span>
              </div>
              <p className={cn('text-[10px] leading-relaxed', c.exactText.startsWith('[Không') ? 'text-slate-600 italic' : 'text-slate-300')}>
                {c.exactText}
              </p>
            </div>
          ))}
          {chunks.length === 0 && <p className="text-xs text-slate-600">Chưa chia chunks</p>}
        </div>
      </div>
    );

    if (activeTab === 'prompts') return (
      <div className="h-full flex flex-col gap-2">
        {/* Export bar */}
        {scenes.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mr-1">{scenes.length} prompts</span>
            <button onClick={handleCopyAll}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-slate-300 transition-colors">
              {copiedAll ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>} Copy tất cả
            </button>
            <button onClick={handleSaveTxt}
              className="flex items-center gap-1 px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-[10px] text-blue-300 transition-colors">
              <Download size={11}/> .txt
            </button>
            <button onClick={handleSaveJson}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700/60 hover:bg-slate-600 rounded-lg text-[10px] text-slate-400 transition-colors">
              <Download size={11}/> .json
            </button>
            <button onClick={handleSaveMd}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-700/60 hover:bg-slate-600 rounded-lg text-[10px] text-slate-400 transition-colors">
              <Download size={11}/> .md
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {scenes.map((s, i) => (
            <div key={i} className={cn('bg-[#0d1322] border rounded-xl p-3', s.error ? 'border-red-800/40' : 'border-slate-800')}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Scene {s.sceneNumber}</span>
                <span className="text-[9px] font-mono text-slate-600">{s.timeEstimation}</span>
                {s.error && <span className="text-[8px] text-red-500 ml-auto">⚠ fallback</span>}
              </div>
              <p className="text-[9px] text-slate-600 mb-1.5 leading-relaxed line-clamp-2 italic">{s.dialogue}</p>
              <div className="bg-[#060b14] rounded-lg p-2 text-[10px] text-slate-300 leading-relaxed font-mono">
                {s.veoVideoPrompt}
              </div>
            </div>
          ))}
          {scenes.length === 0 && running && genProgress.total > 0 && (
            <div className="flex items-center justify-center h-20 gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin text-blue-500"/>
              <span className="text-xs">Đang tạo {genProgress.current}/{genProgress.total}...</span>
            </div>
          )}
          {scenes.length === 0 && !running && <p className="text-xs text-slate-600">Chưa tạo prompts</p>}
        </div>
      </div>
    );

    if (activeTab === 'dna') return (
      <div className="h-full flex flex-col">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-2 shrink-0">
          🧬 {a2vDnaImgs.length} Ảnh DNA nhân vật đã tạo
          {running && activeStep === 'dna' && <span className="ml-2 text-purple-400 font-normal">Đang tạo...</span>}
        </p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {a2vDnaImgs.length === 0 && running && activeStep === 'dna' && (
            <div className="flex items-center justify-center h-20 gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin text-purple-500"/>
              <span className="text-xs">Đang tạo ảnh DNA nhân vật...</span>
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {a2vDnaImgs.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden">
                <div className="aspect-square">
                  <img src={toFileUrl(p)} alt={`DNA ${i+1}`} className="w-full h-full object-cover"/>
                </div>
                <div className="px-1.5 py-1 text-[8px] text-purple-300 truncate">DNA {i + 1}</div>
              </div>
            ))}
          </div>
          {a2vDnaImgs.length === 0 && !running && (
            <p className="text-xs text-slate-600">Chưa có ảnh DNA</p>
          )}
        </div>
      </div>
    );

    if (activeTab === 'video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {videoPaths.length === 0 && running && (
            <div className="flex items-center justify-center h-20 gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin text-blue-500"/>
              <span className="text-xs">Đang tạo video...</span>
            </div>
          )}
          <div className={cn('grid gap-1.5', vidRatio === '16:9' ? 'grid-cols-3' : 'grid-cols-4')}>
            {videoPaths.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', vidRatio === '9:16' ? 'aspect-[9/16]' : vidRatio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop />
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold">{i+1}</div>
                <button onClick={() => window.electronAPI?.openFile?.(p)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={9} className="text-white"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (activeTab === 'merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-slate-400"/>
              <span className="text-sm font-bold text-slate-300">Video ghép (chưa có audio gốc)</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );

    if (activeTab === 'remaster') return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-4">
        {finalPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden shadow-xl shadow-blue-900/20">
              <video key={finalPath} src={toFileUrl(finalPath)} className="w-full" controls autoPlay loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400"/>
              <span className="text-sm font-bold text-emerald-300">🎵 Video + Audio gốc hoàn chỉnh!</span>
            </div>
            <p className="text-[10px] text-slate-500 truncate max-w-xs text-center">{finalPath.split(/[\\/]/).pop()}</p>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(finalPath)}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video cuối
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-slate-600">
            {activeStep === 'remaster'
              ? <><Loader2 size={32} className="animate-spin text-blue-500"/><p className="text-xs">Đang ghép audio gốc...</p></>
              : <><Music2 size={48} className="opacity-20"/><p className="text-xs">Chưa có video với audio gốc</p></>
            }
          </div>
        )}
      </div>
    );

    return null;
  };

  const availableTabs = RESULT_TABS_AUDIO.filter(t => {
    if (t.id === 'transcript') return !!transcript;
    if (t.id === 'analysis')   return !!overallAnalysis || (running && activeStep === 'transcribe');
    if (t.id === 'chunks')     return chunks.length > 0;
    if (t.id === 'prompts')    return scenes.length > 0 || (running && activeStep === 'generate');
    if (t.id === 'dna')        return a2vDnaImgs.length > 0 || (running && activeStep === 'dna');
    if (t.id === 'video')      return videoPaths.length > 0 || (running && activeStep === 'video');
    if (t.id === 'merge')      return !!mergedPath || (running && activeStep === 'merge');
    if (t.id === 'remaster')   return !!finalPath  || (running && activeStep === 'remaster');
    return false;
  });

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── LEFT FORM ────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <Music2 size={13} className="text-blue-400" />
            <span className="text-xs font-bold text-white">Audio to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">
            {makeVideo && stockMode
              ? 'Audio/Video → Transcript → Từ khóa → Tải Clip Stock'
              : 'Audio/Video → Transcript → Timeline Chunks → Veo Prompts'}
          </p>
        </div>

        {/* ── Batch Mode Toggle ── */}
        <div className="px-4 py-2 border-b border-slate-800/60">
          <button onClick={() => setBatchMode(v => !v)} disabled={running || batchRunning}
            className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] font-bold border transition-all',
              batchMode ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'border-slate-700/60 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
            <span>📦 Xử lý hàng loạt (Batch)</span>
            <span className={cn('text-[8px] px-1.5 py-0.5 rounded-full font-black', batchMode ? 'bg-purple-500/30 text-purple-300' : 'bg-slate-700 text-slate-500')}>
              {batchMode ? 'BẬT' : 'TẮT'}
            </span>
          </button>
        </div>

        <div className="flex-1 px-4 py-3 space-y-4">
          {/* AI Provider */}
          <div className="border-t border-slate-800/60 pt-3">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">AI Provider</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
              {[{id:'gemini',label:'✨ Gemini'},{id:'claude',label:'🤖 Claude'},{id:'groq',label:'⚡ Groq'}].map(m => (
                <button key={m.id} disabled={running} onClick={() => setAiMode(m.id)}
                  className={cn('flex-1 py-1.5 text-[10px] font-bold transition-colors',
                    aiMode === m.id
                      ? (m.id === 'groq' ? 'bg-green-600 text-white' : m.id === 'claude' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white')
                      : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 border-transparent')}>
                  {m.label}
                </button>
              ))}
            </div>
            {aiMode === 'claude' && !claudeKey && (
              <p className="text-[9px] text-orange-400 mt-1">⚠️ Chưa có Claude API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && !groqKeys.length && (
              <p className="text-[9px] text-green-400 mt-1">⚠️ Chưa có Groq API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && groqKeys.length > 0 && (
              <p className="text-[9px] text-green-500/60 mt-0.5">💡 Nên chọn Llama 3.1 8B trong Settings để tránh rate limit</p>
            )}
            {aiMode === 'claude' && (
              <p className="text-[9px] text-slate-600 mt-0.5">Transcription vẫn dùng Gemini (xử lý audio)</p>
            )}
            {aiMode === 'groq' && (
              <p className="text-[9px] text-green-500/70 mt-0.5">⚡ Groq xử lý TOÀN BỘ: Whisper + phân tích + prompts</p>
            )}
            {aiMode === 'gemini' && (
              <div className="mt-1.5">
                <label className="text-[9px] text-slate-600 mb-1 block">Model Gemini (phân tích + prompts)</label>
                <select value={atvGeminiModel} onChange={e => setAtvGeminiModel(e.target.value)} disabled={running}
                  className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1 text-[10px] text-slate-300">
                  {ATV_GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* File picker */}
          <div>
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">File audio / video *</p>
            <div
              onClick={handlePickFile}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all',
                filePath
                  ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-400/50'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600 border-dashed'
              )}
            >
              <UploadCloud size={14} className={filePath ? 'text-blue-400' : 'text-slate-600'} />
              <span className={cn('text-[10px] truncate flex-1', filePath ? 'text-blue-300' : 'text-slate-700')}>
                {fileName || 'Chọn MP3, WAV, M4A, OGG, MP4...'}
              </span>
              {filePath && (
                <button onClick={e => { e.stopPropagation(); handleReset(); }}
                  className="p-0.5 hover:text-red-400 text-slate-600 transition-colors">
                  <RefreshCw size={10}/>
                </button>
              )}
            </div>
            <p className="text-[8px] text-slate-700 mt-1">Hỗ trợ: mp3, wav, m4a, ogg, webm, mp4, mov</p>
          </div>

          {/* Transcript upload — bỏ qua Gemini transcription, tiết kiệm ~50 API calls */}
          <div>
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Transcript SRT <span className="text-emerald-600 normal-case font-normal">— bỏ qua phân tích âm thanh</span>
            </p>
            <div
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.srt,.vtt,.txt';
                input.onchange = async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  setManualTranscript(text);
                  setManualTranscriptName(f.name);
                };
                input.click();
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all',
                manualTranscript
                  ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/50'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600 border-dashed'
              )}
            >
              <FileText size={13} className={manualTranscript ? 'text-emerald-400' : 'text-slate-600'} />
              <span className={cn('text-[10px] truncate flex-1', manualTranscript ? 'text-emerald-300' : 'text-slate-700')}>
                {manualTranscriptName || 'Tải lên file TXT / SRT (tùy chọn)'}
              </span>
              {manualTranscript && (
                <button onClick={e => { e.stopPropagation(); setManualTranscript(''); setManualTranscriptName(''); }}
                  className="p-0.5 hover:text-red-400 text-slate-600 transition-colors">
                  <X size={10}/>
                </button>
              )}
            </div>
            {manualTranscript && (
              <p className="text-[8px] text-emerald-600 mt-1">✅ Sẽ dùng text này làm transcript — tiết kiệm ~{Math.ceil((filePath ? 1 : 50))} API calls transcription</p>
            )}
            {!manualTranscript && (
              <p className="text-[8px] text-slate-700 mt-1">Dùng file <span className="text-yellow-600 font-semibold">.SRT</span> để timestamp chính xác — cảnh video khớp đúng audio</p>
            )}
          </div>

          {/* Scene duration */}
          <div>
            <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Thời lượng mỗi cảnh</p>
            <div className="flex gap-1.5">
              {(makeVideo && stockMode ? [4, 6, 8, -1] : [4, 6, 8, 10]).map(d => {
                const label    = d === -1 ? '5-15s' : `${d}s`;
                const subLabel = d === -1 ? 'smart'
                               : d === 10 ? 'Omni'
                               : makeVideo && stockMode ? 'clip' : '→Veo';
                return (
                  <button key={d} disabled={running} onClick={() => handleSceneDurChange(d)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex flex-col items-center leading-none gap-0.5',
                      sceneDur === d ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                    <span>{label}</span>
                    <span className={cn('text-[7px] font-semibold', sceneDur === d ? 'text-blue-200' : 'text-slate-700')}>{subLabel}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[8px] text-slate-700 mt-1">
              {makeVideo && stockMode && sceneDur === -1
                ? 'Tự cắt theo câu, mỗi cảnh 5–15s — clip dùng độ dài tự nhiên'
                : makeVideo && stockMode
                ? `Mỗi clip stock sẽ được cắt/lặp về đúng ${sceneDur}s`
                : sceneDur === 10 ? '⚡ Chỉ dùng Omni Flash' : '→ Tự động chọn Veo'}
            </p>
          </div>

          {/* Prompt đồng bộ nhân vật / bối cảnh */}
          {(!stockMode || gsVideoMode) && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">
                  🎭 Đồng bộ nhân vật / bối cảnh
                </label>
                {charBgPrompt.trim() && (
                  <button onClick={() => setCharBgPrompt('')} disabled={running}
                    className="text-[8px] text-slate-600 hover:text-red-400 transition-colors">Xóa</button>
                )}
              </div>
              <textarea
                value={charBgPrompt}
                onChange={e => setCharBgPrompt(e.target.value)}
                disabled={running}
                rows={3}
                placeholder="Để trống → AI tự phân tích nhân vật & bối cảnh từ audio. Hoặc nhập tay: A young Vietnamese woman, early 20s, long black hair, red áo dài. Background: Hanoi old quarter streets."
                className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[9px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-purple-500/40 resize-none"
              />
              <p className="text-[8px] text-slate-600 mt-1">
                {charBgPrompt.trim()
                  ? <span className="text-purple-400">✅ Dùng mô tả này — AI sẽ giữ nhất quán mọi cảnh</span>
                  : '🤖 Tự động: AI sẽ phân tích audio và tự sinh mô tả khi chạy'}
              </p>
            </div>
          )}

          {/* Phong cách hình ảnh Veo (Veo AI + AI+Veo) */}
          {(!stockMode || gsVideoMode) && (
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">
                Phong cách hình ảnh
              </label>
              <select value={veoStyle} onChange={e => setVeoStyle(e.target.value)} disabled={running}
                className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none focus:border-blue-500/40">
                <option value="auto">🤖 Tự động (AI phân tích)</option>
                <option value="Photorealistic">📷 Photorealistic — Ảnh thực tế siêu chi tiết</option>
                <option value="Cinematic 4K">🎬 Cinematic 4K — Phim điện ảnh chuyên nghiệp</option>
                <option value="Anime / Manga">🎨 Anime / Manga — Hoạt hình Nhật Bản</option>
                <option value="Pixar 3D">🧸 Pixar 3D — Hoạt hình 3D Disney-Pixar</option>
                <option value="Studio Ghibli">🌿 Studio Ghibli — Màu nước, Miyazaki</option>
                <option value="Dark Fantasy">🌑 Dark Fantasy — Tối, gothic, huyền bí</option>
                <option value="Watercolor">🖌️ Watercolor — Màu nước nghệ thuật</option>
                <option value="Cyberpunk">⚡ Cyberpunk — Neon, tương lai, tối</option>
                <option value="Documentary">📽️ Documentary — Phóng sự, tự nhiên</option>
              </select>
              {veoStyle !== 'auto' && (
                <p className="text-[8px] text-blue-400 mt-1">
                  🎨 Mọi prompt sẽ ép phong cách: <strong>{veoStyle}</strong>
                </p>
              )}
            </div>
          )}

          {/* Info */}
          {duration > 0 && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2.5 space-y-1">
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Thời lượng:</span>
                <span className="font-bold text-blue-300">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Số cảnh:</span>
                <span className="font-bold text-blue-300">
                  {sceneDur === -1 ? `~${Math.ceil(duration / 8)} cảnh` : `${Math.ceil(duration / sceneDur)} cảnh`}
                </span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Gemini keys:</span>
                <span className="font-bold text-emerald-400">{loadKeys().length} keys</span>
              </div>
            </div>
          )}

          {/* ── Video Generation Settings ── */}
          <div className="border-t border-slate-800/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tạo video luôn</label>
              <button onClick={() => setMakeVideo(v => !v)} disabled={running}
                className={cn('w-9 h-5 rounded-full transition-all relative', makeVideo ? 'bg-blue-600' : 'bg-slate-700')}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', makeVideo ? 'left-4' : 'left-0.5')}/>
              </button>
            </div>

            {makeVideo && (
              <>
                {/* ── Nguồn video: Veo / Stock / Gemini+Veo ── */}
                <div>
                  <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">Nguồn video</label>
                  <div className="flex gap-1">
                    <button disabled={running} onClick={() => { handleSetStockMode(false); setGsVideoMode(false); }}
                      className={cn('flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all',
                        !stockMode && !gsVideoMode ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                      🎬 Veo AI
                    </button>
                    <button disabled={running} onClick={() => { handleSetStockMode(true); setGsVideoMode(false); }}
                      className={cn('flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all',
                        stockMode && !gsVideoMode ? 'bg-emerald-700 border-emerald-600 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                      📦 Stock
                    </button>
                    <button disabled={running} onClick={() => { setGsVideoMode(true); handleSetStockMode(true); }}
                      className={cn('flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all leading-tight flex flex-col items-center gap-0.5',
                        gsVideoMode ? 'bg-pink-700 border-pink-600 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                      <span>🤖 AI</span>
                      <span className={cn('text-[7px]', gsVideoMode ? 'text-pink-200' : 'text-slate-700')}>+Veo</span>
                    </button>
                  </div>
                  {gsVideoMode && (
                    <p className="text-[8px] text-pink-400/80 mt-1">Whisper → Gemini kịch bản → Veo ingredient → Stock dự phòng</p>
                  )}
                </div>

                {/* ── AI+Veo settings (dùng cùng Veo settings bên dưới) ── */}
                {gsVideoMode && (
                  <div className="text-[8px] text-pink-300/70 bg-pink-900/10 border border-pink-700/20 rounded-lg px-2.5 py-2 leading-relaxed">
                    🤖 <strong>Whisper</strong> phân tích lời thoại → <strong>Gemini</strong> đọc văn bản + sinh Veo prompt → <strong>Veo T2V</strong> render từng cảnh
                  </div>
                )}

                {/* ── Ingredients Mode toggle (chỉ khi Veo AI hoặc AI+Veo) ── */}
                {!stockMode && (
                  <div className="bg-purple-900/10 border border-purple-700/25 rounded-xl px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] font-semibold text-purple-400 uppercase tracking-wider">🧬 Ingredients Mode</label>
                      <button onClick={() => setA2vIngMode(v => !v)} disabled={running}
                        className={cn('w-9 h-5 rounded-full transition-all relative', a2vIngMode ? 'bg-purple-600' : 'bg-slate-700')}>
                        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', a2vIngMode ? 'left-4' : 'left-0.5')}/>
                      </button>
                    </div>
                    {a2vIngMode && (
                      <div className="space-y-2">
                        <p className="text-[8px] text-purple-300/80 leading-relaxed">
                          Tự động detect tối đa 5 nhân vật → tạo ảnh DNA → render video Ingredients (đồng bộ ngoại hình xuyên suốt)
                        </p>
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1 block">Model tạo ảnh DNA</label>
                          <select value={a2vImgMdl} onChange={e => setA2vImgMdl(e.target.value)} disabled={running}
                            className="w-full bg-slate-800/50 border border-purple-700/40 rounded-lg px-2 py-1.5 text-[10px] text-purple-300 focus:outline-none">
                            {IMG_MDL.map(m => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-600 mb-1 block">Thư mục lưu ảnh DNA *</label>
                          <div className="flex gap-1">
                            <input value={a2vRefDir} onChange={e => setA2vRefDir(e.target.value)} disabled={running}
                              placeholder="Chọn thư mục..." readOnly
                              className="flex-1 bg-slate-800/50 border border-purple-700/40 rounded-lg px-2 py-1.5 text-[9px] text-slate-300 focus:outline-none" />
                            <button disabled={running} onClick={async () => {
                              const r = await window.electronAPI?.selectFolder?.();
                              if (r) setA2vRefDir(r);
                            }} className="px-2 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-[9px] text-slate-400 hover:text-slate-200">📁</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {!a2vIngMode && (
                      <p className="text-[8px] text-slate-600">Bật để dùng DNA nhân vật thay vì Text-to-Video thuần.</p>
                    )}
                  </div>
                )}

                {/* ── Veo-specific settings (Veo AI + AI+Veo đều dùng) ── */}
                {(!stockMode || gsVideoMode) && (
                  <>
                    {/* Duration */}
                    <div>
                      <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Thời lượng mỗi video</label>
                      <div className="flex gap-1.5">
                        {vidDurs.map(d => (
                          <button key={d} disabled={running} onClick={() => { setVidSceneDur(d); if (d === 10) setVidModel('Omni 1.1 Flash'); }}
                            className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex flex-col items-center leading-none gap-0.5',
                              vidSceneDur === d ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                            <span>{d}s</span>
                            {d === 10 && <span className={cn('text-[7px] font-semibold', vidSceneDur === d ? 'text-violet-200' : 'text-slate-700')}>Omni</span>}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Ratio */}
                    <div>
                      <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Tỉ lệ</label>
                      <div className="flex gap-1.5">
                        {RATIOS.map(r => (
                          <button key={r} disabled={running} onClick={() => setVidRatio(r)}
                            className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                              vidRatio === r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Veo Model + Quality */}
                    {videoEngine === 'veo' && (
                      <>
                        <div>
                          <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">
                            Model Veo{vidSceneDur === 10 && <span className="ml-1.5 text-amber-400 normal-case">⚡ 10s chỉ dùng Omni Flash</span>}
                          </label>
                          <select value={vidSceneDur === 10 ? 'Omni 1.1 Flash' : vidModel}
                            onChange={e => { if (vidSceneDur !== 10) setVidModel(e.target.value); }}
                            disabled={running || vidSceneDur === 10}
                            className={cn('w-full bg-slate-800/50 border rounded-lg px-2 py-1.5 text-[10px] focus:outline-none',
                              vidSceneDur === 10 ? 'border-amber-500/50 text-amber-300 cursor-not-allowed opacity-80' : 'border-slate-700/60 text-slate-300')}>
                            {vidSceneDur === 10
                              ? <option value="Omni 1.1 Flash">Omni 1.1 Flash</option>
                              : VID_MDL_AUDIO.map(m => <option key={m}>{m}</option>)
                            }
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Chất lượng video</label>
                          <select value={vidQuality} onChange={e => setVidQuality(e.target.value)} disabled={running}
                            className="w-full bg-slate-800/50 border border-violet-500/40 rounded-lg px-2 py-1.5 text-[10px] text-violet-300 font-semibold focus:outline-none">
                            <option value="720p">720p — Nhanh</option>
                            {vidSceneDur === 8 && <option value="1080p">1080p — Upscale (chậm hơn)</option>}
                          </select>
                        </div>
                      </>
                    )}

                    {/* Transition toggle */}
                    <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                      <input type="checkbox" checked={useTransition} onChange={e => setUseTransition(e.target.checked)} disabled={running}
                        className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-violet-500" />
                      <span className="text-[10px] text-slate-400">Chuyển cảnh ngẫu nhiên khi ghép video</span>
                    </label>
                  </>
                )}

                {/* ── Stock-specific settings (chỉ hiện khi Stock thuần, không phải GS mode) ── */}
                {stockMode && !gsVideoMode && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">Nguồn stock</label>
                      <div className="flex gap-1">
                        {[
                          { v: 'pexels',  l: 'Pexels'  },
                          { v: 'pixabay', l: 'Pixabay' },
                          { v: 'both',    l: '⚡ Cả 2'  },
                        ].map(({ v, l }) => (
                          <button key={v} disabled={running} onClick={() => setStockProvider(v)}
                            className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                              stockProvider === v
                                ? v === 'both' ? 'bg-purple-700/80 border-purple-600 text-white' : 'bg-emerald-700/80 border-emerald-600 text-white'
                                : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {stockProvider === 'both' && (
                        <p className="text-[8px] text-purple-400/70 mt-1">Tìm song song cả 2, xen kẽ kết quả tốt nhất</p>
                      )}
                    </div>
                    {/* Trạng thái API keys */}
                    <div className="space-y-1">
                      {[
                        { id: 'pexels',  label: 'Pexels',  key: pexelsKey  },
                        { id: 'pixabay', label: 'Pixabay', key: pixabayKey },
                      ].map(({ id, label, key }) => {
                        const active = stockProvider === 'both' || stockProvider === id;
                        if (!active) return null;
                        return (
                          <div key={id} className={cn('rounded-lg px-2.5 py-1.5 text-[10px] leading-snug flex items-center gap-1.5',
                            key ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border border-amber-500/20 text-amber-400')}>
                            <span className="font-bold shrink-0">{label}:</span>
                            <span className="truncate">{key ? `✓ ${key.slice(0, 10)}...` : '⚠ Chưa cấu hình (Settings → Stock Video)'}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[8px] text-slate-600">
                      {sceneDur === -1 ? 'Smart: tách theo câu, clip 5–15s tự nhiên' : `Mỗi cảnh ${sceneDur}s → tự tìm + cắt/lặp clip`}
                    </p>

                    {/* Transcription source selector */}
                    <div className="border-t border-slate-700/40 pt-2 space-y-1">
                      <p className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Nguồn chuyển ngôn</p>
                      {[
                        { value: 'gemini',  icon: '✨', label: 'Gemini AI',        desc: 'Cần API key · nhanh · chất lượng cao' },
                        { value: 'whisper', icon: '🖥️', label: 'Whisper cục bộ',   desc: 'Không cần key · tự động · ~150 MB tải 1 lần' },
                        { value: 'manual',  icon: '✏️', label: 'Từ khóa thủ công', desc: 'Không phân tích audio · nhập tay' },
                      ].map(opt => (
                        <label key={opt.value}
                          className={`flex items-start gap-2 cursor-pointer rounded-lg px-2 py-1.5 transition-colors ${
                            stockTranscribeMode === opt.value
                              ? 'bg-emerald-500/10 border border-emerald-500/25'
                              : 'hover:bg-slate-700/30 border border-transparent'
                          } ${running ? 'opacity-50 pointer-events-none' : ''}`}>
                          <input type="radio" name="stock_tx_mode" value={opt.value}
                            checked={stockTranscribeMode === opt.value}
                            onChange={() => setStockTranscribeMode(opt.value)}
                            disabled={running}
                            className="mt-0.5 accent-emerald-500 shrink-0" />
                          <div>
                            <span className="text-[10px] text-slate-300">{opt.icon} {opt.label}</span>
                            <p className="text-[8px] text-slate-600 mt-0.5">{opt.desc}</p>
                          </div>
                        </label>
                      ))}

                      {/* Manual keywords textarea */}
                      {stockTranscribeMode === 'manual' && (
                        <div className="pt-1">
                          <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">
                            Từ khóa <span className="normal-case text-slate-700">(mỗi dòng = 1 cảnh, ít hơn → lặp vòng)</span>
                          </label>
                          <textarea value={stockManualKw} onChange={e => setStockManualKw(e.target.value)}
                            disabled={running} rows={4}
                            placeholder={"nature landscape\nmountain sunset\ncity walking\nocean waves"}
                            className="w-full bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 resize-none" />
                        </div>
                      )}
                      {/* Nút xóa lịch sử video đã dùng */}
                      <button
                        onClick={() => { localStorage.removeItem('fluxy_stock_used_ids'); addLog('🗑️ Đã xóa lịch sử video stock đã dùng — lần tới sẽ tìm video mới hoàn toàn', 'info'); }}
                        disabled={running}
                        className="w-full text-[9px] text-slate-500 hover:text-red-400 border border-slate-700/40 hover:border-red-500/40 rounded-lg py-1 transition-colors mt-1">
                        Xóa lịch sử video stock đã dùng
                      </button>
                    </div>
                  </div>
                )}

                {/* Output Folder (shared) */}
                <FolderRow label="Thư mục lưu video *" value={vidDir} onChange={setVidDir} />
              </>
            )}
          </div>

          {/* Generate progress */}
          {running && activeStep === 'generate' && genProgress.total > 0 && (
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-3 py-2">
              <div className="flex justify-between text-[9px] mb-1">
                <span className="text-slate-500">Tạo prompts</span>
                <span className="font-bold text-blue-300">{genProgress.current}/{genProgress.total}</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1">
                <div
                  className="bg-blue-500 rounded-full h-1 transition-all"
                  style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error && (
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running ? (
            <button onClick={handleStart}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg shadow-blue-500/20">
              <Play size={13} fill="currentColor"/> Bắt đầu xử lý
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={paused ? handleResume : handlePause}
                className={cn('flex-1 font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs',
                  paused ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-amber-500/90 hover:bg-amber-500 text-white')}>
                {paused ? <><Play size={11} fill="currentColor"/> Tiếp tục</> : <><Pause size={11}/> Tạm dừng</>}
              </button>
              <button onClick={handleStop}
                className="flex-1 bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs">
                <Square size={11} fill="currentColor"/> Dừng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">

        {/* ── Batch Mode Panel ── */}
        {batchMode && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Batch header */}
            <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-purple-300">📦 Batch — Xử lý hàng loạt</p>
                  <p className="text-[9px] text-slate-500 mt-0.5">
                    {batchVideoMode === 'aiveo' ? 'AI+Veo: Whisper → Gemini → Veo T2V (8 luồng/file)' : 'Stock Video: mỗi file audio → 1 thư mục riêng.'}
                  </p>
                </div>
                {batchRunning && (
                  <span className="text-[9px] font-bold text-purple-400 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin"/> {batchProgress.current}/{batchProgress.total}
                  </span>
                )}
              </div>

              {/* Nguồn video selector */}
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase mb-1.5 block">Nguồn Video</label>
                <div className="flex gap-1.5">
                  <button onClick={() => { setBatchVideoMode('stock'); localStorage.setItem('fluxy_batch_video_mode','stock'); }}
                    disabled={batchRunning}
                    className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold border transition-all flex items-center justify-center gap-1',
                      batchVideoMode === 'stock'
                        ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
                    📦 Stock
                  </button>
                  <button onClick={() => { setBatchVideoMode('aiveo'); localStorage.setItem('fluxy_batch_video_mode','aiveo'); }}
                    disabled={batchRunning}
                    className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold border transition-all flex items-center justify-center gap-1',
                      batchVideoMode === 'aiveo'
                        ? 'bg-pink-600/25 border-pink-500/50 text-pink-300'
                        : 'bg-slate-800/60 border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600')}>
                    🤖 AI+Veo
                  </button>
                </div>
                {batchVideoMode === 'aiveo' && (
                  <p className="text-[8px] text-pink-400/70 mt-1 leading-relaxed">Whisper → Gemini Story Bible → Veo T2V 8 luồng → ghép audio</p>
                )}
              </div>

              {/* ── Thiết lập batch (AI+Veo) ── */}
              {batchVideoMode === 'aiveo' && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-3 py-2.5 space-y-2.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">⚙️ Thiết lập video</p>

                  {/* Thời lượng cảnh audio + video */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[8px] text-slate-500 mb-1">Mỗi cảnh audio</p>
                      <div className="flex gap-1">
                        {[-1,4,6,8,10].map(d => (
                          <button key={d} disabled={batchRunning} onClick={() => setSceneDur(d)}
                            className={cn('flex-1 py-1 rounded text-[8px] font-bold border transition-all',
                              sceneDur === d ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700/60 text-slate-600 hover:text-slate-400')}>
                            {d === -1 ? 'Auto' : `${d}s`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-500 mb-1">Mỗi clip Veo</p>
                      <div className="flex gap-1">
                        {[4,6,8,10].map(d => (
                          <button key={d} disabled={batchRunning} onClick={() => { setVidSceneDur(d); if (d === 10) setVidModel('Omni 1.1 Flash'); }}
                            className={cn('flex-1 py-1 rounded text-[8px] font-bold border transition-all',
                              vidSceneDur === d ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:text-slate-400')}>
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Tỉ lệ */}
                  <div>
                    <p className="text-[8px] text-slate-500 mb-1">Tỉ lệ khung hình</p>
                    <div className="flex gap-1">
                      {['9:16','16:9','1:1'].map(r => (
                        <button key={r} disabled={batchRunning} onClick={() => setVidRatio(r)}
                          className={cn('flex-1 py-1 rounded text-[8px] font-bold border transition-all',
                            vidRatio === r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:text-slate-400')}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Model Veo */}
                  <div>
                    <p className="text-[8px] text-slate-500 mb-1">Model Veo</p>
                    <select value={vidSceneDur === 10 ? 'Omni 1.1 Flash' : vidModel}
                      onChange={e => { if (vidSceneDur !== 10) setVidModel(e.target.value); }}
                      disabled={batchRunning || vidSceneDur === 10}
                      className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-2 py-1 text-[9px] text-slate-300 focus:outline-none">
                      {vidSceneDur === 10
                        ? <option value="Omni 1.1 Flash">Omni 1.1 Flash</option>
                        : ['Veo 3.1 - Lite [Lower Priority]', 'Omni 1.1 Flash'].map(m => <option key={m}>{m}</option>)
                      }
                    </select>
                  </div>

                  {/* Chất lượng + Phong cách */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[8px] text-slate-500 mb-1">Chất lượng</p>
                      <select value={vidQuality} onChange={e => setVidQuality(e.target.value)} disabled={batchRunning}
                        className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-2 py-1 text-[9px] text-slate-300 focus:outline-none">
                        {['480p','720p — Nhanh','1080p','4K — Chậm'].map(q => <option key={q}>{q}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-500 mb-1">Phong cách</p>
                      <select value={veoStyle} onChange={e => setVeoStyle(e.target.value)} disabled={batchRunning}
                        className="w-full bg-slate-900/60 border border-slate-700/60 rounded-lg px-2 py-1 text-[9px] text-slate-300 focus:outline-none">
                        <option value="auto">🤖 Tự động</option>
                        <option value="Photorealistic">📷 Photorealistic</option>
                        <option value="Cinematic 4K">🎬 Cinematic 4K</option>
                        <option value="Anime / Manga">🎌 Anime / Manga</option>
                        <option value="Pixar 3D">🧸 Pixar 3D</option>
                        <option value="Studio Ghibli">🌸 Studio Ghibli</option>
                        <option value="Dark Fantasy">🌑 Dark Fantasy</option>
                        <option value="Watercolor">🎨 Watercolor</option>
                        <option value="Cyberpunk">🤖 Cyberpunk</option>
                        <option value="Documentary">📽️ Documentary</option>
                      </select>
                    </div>
                  </div>

                  {/* Chuyển cảnh */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={useTransition} onChange={e => setUseTransition(e.target.checked)} disabled={batchRunning}
                      className="w-3 h-3 rounded accent-violet-500"/>
                    <span className="text-[9px] text-slate-400">Chuyển cảnh ngẫu nhiên khi ghép video</span>
                  </label>
                </div>
              )}

              {/* ── Thiết lập batch (Stock) ── */}
              {batchVideoMode === 'stock' && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-3 py-2.5 space-y-2">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">⚙️ Thiết lập</p>
                  <div>
                    <p className="text-[8px] text-slate-500 mb-1">Thời lượng mỗi cảnh</p>
                    <div className="flex gap-1">
                      {[-1,4,6,8,10].map(d => (
                        <button key={d} disabled={batchRunning} onClick={() => setSceneDur(d)}
                          className={cn('flex-1 py-1 rounded text-[8px] font-bold border transition-all',
                            sceneDur === d ? 'bg-amber-600 border-amber-500 text-white' : 'border-slate-700/60 text-slate-600 hover:text-slate-400')}>
                          {d === -1 ? 'Auto' : `${d}s`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[8px] text-slate-500 mb-1">Nguồn clip stock</p>
                    <div className="flex gap-1">
                      {['pexels','pixabay','both'].map(p => (
                        <button key={p} disabled={batchRunning} onClick={() => setStockProvider(p)}
                          className={cn('flex-1 py-1 rounded text-[8px] font-bold border transition-all capitalize',
                            stockProvider === p ? 'bg-amber-600 border-amber-500 text-white' : 'border-slate-700/60 text-slate-600 hover:text-slate-400')}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* File queue */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[9px] font-semibold text-slate-500 uppercase">Files audio ({batchFiles.length})</label>
                  <button onClick={handleBatchPickFiles} disabled={batchRunning}
                    className="text-[9px] bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 text-purple-300 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">
                    <Plus size={10}/> Thêm files
                  </button>
                </div>
                {batchFiles.length === 0 ? (
                  <p className="text-[9px] text-slate-600 italic px-1">Chưa có file nào — bấm &quot;Thêm files&quot;</p>
                ) : (
                  <div className="max-h-28 overflow-y-auto custom-scrollbar space-y-1">
                    {batchFiles.map((f, i) => {
                      const res = batchResults[i];
                      return (
                        <div key={f.path} className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[9px]',
                          res?.status === 'done'    ? 'bg-emerald-500/5 border-emerald-500/20' :
                          res?.status === 'error'   ? 'bg-red-500/5 border-red-500/20' :
                          res?.status === 'running' ? 'bg-purple-500/10 border-purple-500/30' :
                          'bg-slate-800/30 border-slate-700/40')}>
                          <span className="shrink-0">
                            {res?.status === 'done'    ? '✅' :
                             res?.status === 'error'   ? '❌' :
                             res?.status === 'running' ? <Loader2 size={9} className="animate-spin text-purple-400"/> : '⏳'}
                          </span>
                          <span className="flex-1 truncate text-slate-300">{f.name}</span>
                          {res?.status === 'error' && <span className="text-red-400 truncate max-w-20" title={res.error}>{res.error?.slice(0,20)}</span>}
                          {!batchRunning && (
                            <button onClick={() => removeBatchFile(f.path)} className="text-slate-600 hover:text-red-400 shrink-0">
                              <X size={10}/>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Output folder */}
              <div>
                <label className="text-[9px] font-semibold text-slate-500 uppercase mb-1 block">Thư mục lưu kết quả</label>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[9px] text-slate-400 truncate">
                    {batchOutputDir || <span className="text-slate-700">Chưa chọn...</span>}
                  </div>
                  <button onClick={async () => { const d = await window.electronAPI?.selectFolder?.(); if (d) setBatchOutputDir(d); }}
                    disabled={batchRunning}
                    className="p-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-40">
                    <FolderOpen size={12} className="text-slate-400"/>
                  </button>
                </div>
                <p className="text-[8px] text-slate-600 mt-1">Mỗi file → thư mục con riêng.</p>
              </div>

              {/* Batch start/stop */}
              <div className="flex gap-2">
                {!batchRunning ? (
                  <button onClick={handleBatchStart}
                    disabled={!batchFiles.length || !batchOutputDir}
                    className={cn('flex-1 py-2 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors',
                      batchVideoMode === 'aiveo' ? 'bg-pink-600 hover:bg-pink-500' : 'bg-purple-600 hover:bg-purple-500')}>
                    <Play size={11} fill="currentColor"/> Chạy Batch ({batchFiles.length} file)
                  </button>
                ) : (
                  <button onClick={() => { batchStopRef.current = true; }}
                    className="flex-1 py-2 bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors">
                    <Square size={11} fill="currentColor"/> Dừng Batch
                  </button>
                )}
                {!batchRunning && batchFiles.length > 0 && (
                  <button onClick={() => { setBatchFiles([]); setBatchResults([]); }}
                    className="px-3 py-2 bg-slate-700/60 hover:bg-slate-700 text-slate-400 text-[9px] rounded-xl transition-colors">
                    Xóa DS
                  </button>
                )}
              </div>
            </div>

            {/* Batch log */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3 font-mono text-[9px] space-y-0.5">
              {batchLogs.length === 0 && (
                <p className="text-slate-600 italic">Log sẽ hiển thị khi batch chạy...</p>
              )}
              {batchLogs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-700 shrink-0">[{l.time}]</span>
                  <span className={l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}>
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Normal pipeline ── */}
        {!batchMode && (
        <div className="flex flex-col flex-1 overflow-hidden">

        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-2">Tiến trình xử lý</p>
          <div className={cn('grid gap-1.5', a2vIngMode && makeVideo && !stockMode ? 'grid-cols-9' : 'grid-cols-8')}>
            {STEPS_AUDIO.filter(s => s.id !== 'dna' || (a2vIngMode && makeVideo && !stockMode)).map(s => {
              const isStock = makeVideo && stockMode;
              const step = isStock && s.id === 'generate' ? { ...s, label: 'Từ khóa', icon: Zap }
                         : isStock && s.id === 'video'    ? { ...s, label: 'Tải Clip', icon: Download }
                         : s;
              return <StepBadge key={s.id} step={step} status={stepStatus(s.id)}/>;
            })}
          </div>
        </div>

        {/* Result tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 border-b border-slate-800/60">
              {availableTabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab === t.id ? 'text-blue-300 border-blue-500' : 'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id === 'chunks'  && chunks.length > 0       && <span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{chunks.length}</span>}
                  {t.id === 'prompts' && scenes.length > 0       && <span className="ml-1 text-[8px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">{scenes.length}</span>}
                  {t.id === 'dna'     && a2vDnaImgs.length > 0   && <span className="ml-1 text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded-full">{a2vDnaImgs.length}</span>}
                  {t.id === 'video'   && videoPaths.length > 0   && <span className="ml-1 text-[8px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* Log panel */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen ? 'h-44' : 'h-9')}>
          <button onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running && <span className="ml-auto flex items-center gap-1 text-[9px] text-blue-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running && logs.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setLogs([]); }} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen && (
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length === 0 && <p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type === 'error'   && 'text-red-400',
                    l.type === 'success' && 'text-emerald-400',
                    l.type === 'info'    && 'text-slate-500',
                  )}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Subtitle Extraction & Translation Panel ──────────────────────────────────
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

const GEMINI_VOICES_DUB = [
  // Nữ
  { id: 'Aoede',        gender: 'female',  style: 'Ấm áp, truyền cảm'    },
  { id: 'Kore',         gender: 'female',  style: 'Trung tính, rõ ràng'  },
  { id: 'Leda',         gender: 'female',  style: 'Mềm mại, dịu dàng'    },
  { id: 'Callirrhoe',   gender: 'female',  style: 'Tự nhiên, nhẹ nhàng'  },
  { id: 'Autonoe',      gender: 'female',  style: 'Trong sáng'            },
  { id: 'Alsephina',    gender: 'female',  style: 'Năng động'             },
  { id: 'Despina',      gender: 'female',  style: 'Sắc nét'               },
  { id: 'Erinome',      gender: 'female',  style: 'Sâu lắng'              },
  { id: 'Laomedeia',    gender: 'female',  style: 'Thanh thản'            },
  { id: 'Pulcherrima',  gender: 'female',  style: 'Cuốn hút'              },
  { id: 'Vindemiatrix', gender: 'female',  style: 'Chuyên nghiệp'        },
  { id: 'Sulafat',      gender: 'female',  style: 'Thân thiện, dễ nghe'  },
  // Nam
  { id: 'Charon',       gender: 'male',    style: 'Trung tính, chuẩn'    },
  { id: 'Fenrir',       gender: 'male',    style: 'Biểu cảm, mạnh mẽ'   },
  { id: 'Puck',         gender: 'male',    style: 'Vui tươi, linh hoạt'  },
  { id: 'Orus',         gender: 'male',    style: 'Uy quyền, điềm tĩnh'  },
  { id: 'Algenib',      gender: 'male',    style: 'Rõ ràng, chắc chắn'   },
  { id: 'Algieba',      gender: 'male',    style: 'Sang trọng'            },
  { id: 'Iapetus',      gender: 'male',    style: 'Trầm ổn'               },
  { id: 'Enceladus',    gender: 'male',    style: 'Năng lượng'            },
  { id: 'Umbriel',      gender: 'male',    style: 'Huyền bí'              },
  { id: 'Rasalgethi',   gender: 'male',    style: 'Cổ điển, uy nghiêm'   },
  { id: 'Sadachbia',    gender: 'male',    style: 'Khỏe khoắn'            },
  { id: 'Schedar',      gender: 'male',    style: 'Mạnh mẽ, dứt khoát'   },
  // Trung tính
  { id: 'Zephyr',       gender: 'neutral', style: 'Thoáng, tự nhiên'     },
  { id: 'Achird',       gender: 'neutral', style: 'Dễ nghe, cân bằng'    },
  { id: 'Gacrux',       gender: 'neutral', style: 'Sáng tạo'              },
  { id: 'Mimosa',       gender: 'neutral', style: 'Tươi sáng'             },
];

function subParseSRTTimeMs(str) {
  const norm = str.replace('.', ',');
  const [time, ms] = norm.split(',');
  const [h, m, s] = time.split(':').map(Number);
  return (h * 3600 + m * 60 + s) * 1000 + Number(ms || 0);
}
function subParseSRTtoSegments(content) {
  const blocks = content.trim().split(/\n\s*\n/);
  const segs = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeIdx = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const m = lines[timeIdx]?.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/);
    if (!m) continue;
    const text = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    const startMs = subParseSRTTimeMs(m[1]), endMs = subParseSRTTimeMs(m[2]);
    if (text && endMs > startMs) segs.push({ text, startMs, endMs });
  }
  return segs;
}
function subFormatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}
function subSegmentsToSRT(segments) {
  return segments.map((seg, idx) => {
    const start = subFormatSRTTime(seg.start ?? 0);
    const end   = subFormatSRTTime(seg.end   ?? (seg.start ?? 0) + 2);
    return `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
  }).join('\n');
}
function subNormalizeSRT(srtContent, maxCpl = 42, wordsPerLine = 0) {
  const parseSRTMs = (str) => {
    const [h, m, rest] = str.trim().split(':');
    const [s, ms] = rest.split(',');
    return ((+h * 3600 + +m * 60 + +s) * 1000) + +ms;
  };
  const msToSRT = (ms) => {
    const hh = Math.floor(ms / 3600000);
    const mm = Math.floor((ms % 3600000) / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    const mi = ms % 1000;
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')},${String(mi).padStart(3,'0')}`;
  };
  const entries = srtContent.trim().split(/\n\n+/);
  const result = [];
  let idx = 1;
  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const rawText = lines.slice(2).join(' ').replace(/\s+/g, ' ').trim();
    const m = timeLine.match(/^([\d:,]+)\s+-->\s+([\d:,]+)/);
    if (!m) continue;
    const startMs = parseSRTMs(m[1]);
    const endMs   = parseSRTMs(m[2]);
    const duration = Math.max(endMs - startMs, 300);
    const words = rawText.split(/\s+/);
    const lineChunks = [];
    if (wordsPerLine > 0) {
      for (let i = 0; i < words.length; i += wordsPerLine) {
        lineChunks.push(words.slice(i, i + wordsPerLine).join(' '));
      }
    } else {
      let cur = '';
      for (const word of words) {
        const candidate = cur ? `${cur} ${word}` : word;
        if (candidate.length > maxCpl && cur) { lineChunks.push(cur); cur = word; }
        else { cur = candidate; }
      }
      if (cur) lineChunks.push(cur);
    }
    const groups = lineChunks.filter(c => c.trim());
    if (!groups.length) continue;
    const durPer = duration / groups.length;
    for (let i = 0; i < groups.length; i++) {
      const gs = Math.round(startMs + i * durPer);
      const ge = Math.round(startMs + (i + 1) * durPer);
      result.push(`${idx}\n${msToSRT(gs)} --> ${msToSRT(ge)}\n${groups[i]}`);
      idx++;
    }
  }
  return result.join('\n\n') + '\n';
}

// Wrap text WITHIN each SRT entry using \n for video display.
// Timestamps and entry count are NEVER changed — only visual line breaks added.
function subWrapSRTLines(srtText, wordsPerLine = 0, maxCpl = 42) {
  const entries = srtText.trim().split(/\n\n+/);
  const result = [];
  let idx = 1;
  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const tlIdx = lines.findIndex(l => /^[\d:,]+ --> [\d:,]+/.test(l));
    if (tlIdx < 0) continue;
    const timeLine = lines[tlIdx];
    const rawText = lines.slice(tlIdx + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (!rawText) continue;
    let displayText;
    if (wordsPerLine > 0) {
      const words = rawText.split(/\s+/);
      const lineArr = [];
      for (let i = 0; i < words.length; i += wordsPerLine) {
        lineArr.push(words.slice(i, i + wordsPerLine).join(' '));
      }
      displayText = lineArr.join('\n');
    } else if (maxCpl > 0 && rawText.length > maxCpl) {
      const words = rawText.split(/\s+/);
      const lineArr = [];
      let cur = '';
      for (const word of words) {
        const cand = cur ? `${cur} ${word}` : word;
        if (cand.length > maxCpl && cur) { lineArr.push(cur); cur = word; }
        else { cur = cand; }
      }
      if (cur) lineArr.push(cur);
      displayText = lineArr.join('\n');
    } else {
      displayText = rawText;
    }
    result.push(`${idx}\n${timeLine}\n${displayText}`);
    idx++;
  }
  return result.join('\n\n') + '\n';
}

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

function SubtitlePanel() {
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const logsEndRef = useRef(null);

  // States
  const [subVideoFile, setSubVideoFile] = useState(null);
  const [subOutputFolder, setSubOutputFolder] = useState('');
  const [isExtractingAudio, setIsExtractingAudio] = useState(false);
  const [savedAudioPath, setSavedAudioPath] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [originalSegments, setOriginalSegments] = useState([]);
  const [originalSRT, setOriginalSRT] = useState('');       // normalized (for display)
  const [rawOriginalSRT, setRawOriginalSRT] = useState(''); // raw (for translation input)
  const [transcribeEngine, setTranscribeEngine] = useState('gemini'); // 'gemini' | 'whisper'
  const [enableTranslate, setEnableTranslate] = useState(true); // dịch hay giữ nguyên SRT gốc
  const [targetLang, setTargetLang] = useState('vi');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSRT, setTranslatedSRT] = useState('');
  const [subPreviewTab, setSubPreviewTab] = useState('original');
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [burnSubtitle, setBurnSubtitle] = useState(false);
  const [subStyle, setSubStyle] = useState({ fontSize: 24, color: 'white', position: 'bottom', effect: 'outline', wordsPerLine: 0 });
  const [isBurning, setIsBurning] = useState(false);
  const [burnedVideoPath, setBurnedVideoPath] = useState('');
  const [dubEnabled, setDubEnabled] = useState(false);
  const [dubEngine, setDubEngine] = useState('edge'); // 'edge' | 'vieneu'
  const [dubVoice, setDubVoice] = useState('Aoede');
  const [dubGenderFilter, setDubGenderFilter] = useState('all');
  const [vnDubVoice, setVnDubVoice] = useState('');
  const [vnDubVoices, setVnDubVoices] = useState([]); // tuple [desc, id]
  const [vnDubVoicesLoaded, setVnDubVoicesLoaded] = useState(false);
  const [vnDubPreviewing, setVnDubPreviewing] = useState(''); // id đang preview
  const [vnDubPreviewUrl, setVnDubPreviewUrl] = useState('');
  const [isDubbing, setIsDubbing] = useState(false);
  const [dubbedVideoPath, setDubbedVideoPath] = useState('');
  const [dubProgress, setDubProgress] = useState({ done: 0, total: 0, text: '' });
  const [edgeDubVoice, setEdgeDubVoice] = useState('vi-VN-HoaiMyNeural');
  const [edgeDubVoices, setEdgeDubVoices] = useState([]);
  const [edgeDubLang, setEdgeDubLang] = useState('vi-VN');
  const [edgeDubSearch, setEdgeDubSearch] = useState('');
  const [edgeDubGender, setEdgeDubGender] = useState('All');

  useEffect(() => {
    if (logs.length > 0) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (window.electronAPI?.onGeminiSRTProgress) {
      window.electronAPI.onGeminiSRTProgress((data) => setDubProgress(data));
    }
    if (window.electronAPI?.onGeminiSRTLog) {
      window.electronAPI.onGeminiSRTLog((text) => addSubLog(text));
    }
    if (window.electronAPI?.onTTSSRTProgress) {
      window.electronAPI.onTTSSRTProgress((data) => {
        setDubProgress(data);
        if (data.text) addSubLog(`🎙️ ${data.text}`);
      });
    }
    if (window.electronAPI?.onReviewFilmLog) {
      window.electronAPI.onReviewFilmLog((d) => addLog(d?.msg || d, d?.type || 'info'));
    }
    return () => {
      window.electronAPI?.removeAllListeners?.('gemini-srt-progress');
      window.electronAPI?.removeAllListeners?.('gemini-srt-log');
      window.electronAPI?.removeAllListeners?.('tts-srt-progress');
      window.electronAPI?.removeAllListeners?.('review-film-log');
    };
  }, []);

  useEffect(() => {
    if (dubEngine === 'edge' && edgeDubVoices.length === 0) {
      window.electronAPI.getVoices().then(data => {
        if (data && data.length > 0) setEdgeDubVoices(data);
      }).catch(() => {});
    }
    if (dubEngine === 'vieneu' && !vnDubVoicesLoaded) {
      (async () => {
        try {
          const status = await window.electronAPI?.vieNeuCheckStatus?.();
          if (!status?.installed) return;
          const r = await window.electronAPI?.vieNeuGetVoices?.();
          // voices là mảng tuple [desc, id] từ Python list_preset_voices()
          if (r?.voices?.length) {
            setVnDubVoices(r.voices);
            setVnDubVoicesLoaded(true);
            const firstId = Array.isArray(r.voices[0]) ? r.voices[0][1] : '';
            setVnDubVoice(v => v || firstId);
          }
        } catch (_) {}
      })();
    }
  }, [dubEngine]);

  const addSubLog = (text, type = 'info') => {
    setLogs(prev => [...prev.slice(-299), { time: new Date().toLocaleTimeString(), text, type }]);
    if (type === 'error') setLogOpen(true);
  };

  const handleExtractAudio = async () => {
    if (!subVideoFile || !subOutputFolder) return alert('Vui lòng chọn video và thư mục lưu!');
    setIsExtractingAudio(true);
    addSubLog('🎵 Đang bóc tách audio MP3 từ video...');
    const result = await window.electronAPI.saveAudioFromVideo({ inputPath: subVideoFile, outputFolder: subOutputFolder });
    if (result.success) {
      setSavedAudioPath(result.filePath);
      addSubLog(`✅ Đã lưu audio: ${result.filePath}`, 'success');
    } else {
      addSubLog(`❌ Lỗi bóc tách audio: ${result.error}`, 'error');
    }
    setIsExtractingAudio(false);
  };

  const handleTranscribe = async () => {
    if (!subVideoFile) return alert('Vui lòng chọn video!');
    setIsTranscribing(true);
    setOriginalSRT(''); setRawOriginalSRT(''); setOriginalSegments([]); setTranslatedSRT('');
    const useWhisper = transcribeEngine === 'whisper';
    addSubLog(`🎙️ Bắt đầu bóc tách SRT — ${useWhisper ? '🤖 Whisper cục bộ' : '✨ Gemini AI'} — quét toàn bộ video...`);
    try {
      // ── Đọc thông tin video ──
      addSubLog('📏 Đọc thông tin video...');
      const metaRes = await window.electronAPI.prepareAudio(subVideoFile);
      if (!metaRes.success || !metaRes.duration) { addSubLog(`❌ Không đọc được thông tin video: ${metaRes.error || 'duration = 0'}`, 'error'); setIsTranscribing(false); return; }
      const totalDuration = metaRes.duration;
      const durMin = Math.floor(totalDuration / 60);
      const durSec = Math.floor(totalDuration % 60);

      let result;

      if (useWhisper) {
        // ── Whisper cục bộ ─────────────────────────────────────────────────────
        const totalChunks = Math.ceil(totalDuration / 30);
        addSubLog(`📹 Thời lượng: ${durMin}p${durSec}s → ${totalChunks} phần (30s/phần) — Whisper cục bộ`);
        result = await transcribeLocalChunked(
          subVideoFile,
          totalDuration,
          (msg) => addSubLog(`  ⏳ ${msg}`),
          (done, total, segCount, errMsg) => {
            if (errMsg) addSubLog(`  ⚠️ Đoạn ${done}/${total}: ${errMsg}`, 'error');
            else        addSubLog(`  ✅ Đoạn ${done}/${total}: ${segCount} câu`);
          },
          (msg) => addSubLog(msg),
          (msg) => addSubLog(msg)
        );
      } else {
        // ── Gemini AI ──────────────────────────────────────────────────────────
        const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
        if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini. Vui lòng thêm key trong Cài đặt.', 'error'); setIsTranscribing(false); return; }
        const totalChunks = Math.ceil(totalDuration / 60);
        addSubLog(`📹 Thời lượng: ${durMin}p${durSec}s → ${totalChunks} phần (60s/phần) — Gemini AI`);
        result = await transcribeAudioChunked(
          apiKeys, totalDuration,
          async (startSec, durationSec) => window.electronAPI.extractAudioChunk({ filePath: subVideoFile, startSec, durationSec }),
          (msg) => addSubLog(`  ⏳ ${msg}`),
          (done, total, segCount, errMsg) => {
            if (errMsg) addSubLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'warn');
            else        addSubLog(`  ✅ Phần ${done}/${total}: ${segCount} câu thoại`);
          },
          (msg) => addSubLog(msg)
        );
      }

      if (!result || !result.segments?.length) {
        addSubLog('❌ Không tìm thấy câu thoại nào trong video.', 'error');
        setIsTranscribing(false); return;
      }

      const srtRaw     = subSegmentsToSRT(result.segments);
      const srtDisplay = subNormalizeSRT(srtRaw, 42, subStyle.wordsPerLine);
      setOriginalSegments(result.segments);
      setRawOriginalSRT(srtRaw);
      setOriginalSRT(srtDisplay);
      setSubPreviewTab('original');
      addSubLog(`✅ Hoàn tất! ${result.segments.length} câu thoại — sẵn sàng ${enableTranslate ? 'dịch' : 'ép phụ đề'}.`, 'success');
    } catch (e) {
      addSubLog(`❌ Lỗi: ${e.message}`, 'error');
    }
    setIsTranscribing(false);
  };

  const handleTranslate = async () => {
    if (!originalSRT) return alert('Hãy tạo SRT gốc trước!');
    const langObj = SUBTITLE_LANGUAGES.find(l => l.code === targetLang);
    const langName = langObj?.name || targetLang;
    setIsTranslating(true); setTranslatedSRT(''); setLogOpen(true);
    addSubLog(`🌐 Bắt đầu dịch thông minh sang ${langName}...`);
    try {
      const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
      if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini.', 'error'); setIsTranslating(false); return; }
      // Dịch từ bản RAW (câu nguyên vẹn) → AI nhận câu đầy đủ → dịch chính xác hơn
      const srcSRT = rawOriginalSRT || originalSRT;
      const translatedRaw = await smartTranslateSRT(srcSRT, targetLang, apiKeys, (msg) => addSubLog(msg));
      // Giữ nguyên timestamps gốc — KHÔNG cắt entry → wordsPerLine chỉ dùng khi ép phụ đề lên màn hình
      const translatedText = translatedRaw.trim();
      const srcCount = (srcSRT.trim().match(/\n\n/g) || []).length + 1;
      const dstCount = (translatedText.match(/\n\n/g) || []).length + 1;
      setTranslatedSRT(translatedText); setSubPreviewTab('translated');
      addSubLog(`✅ Dịch xong: ${dstCount}/${srcCount} entry → ${dstCount === srcCount ? '100% khớp ✅' : `⚠️ thiếu ${srcCount - dstCount} dòng`}`, 'success');
    } catch (e) { addSubLog(`❌ Lỗi dịch: ${e.message}`, 'error'); }
    setIsTranslating(false);
  };

  // ── Helper: tạo đường dẫn output với tên rõ ràng ──
  const buildOutputPath = (suffix, ext) => {
    const raw = subVideoFile ? subVideoFile.split('\\').pop().replace(/\.[^.]+$/, '') : 'video';
    // Xóa ký tự đặc biệt không an toàn cho tên file, giữ tối đa 60 ký tự
    const base = raw.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
    const dir  = (subOutputFolder || '').replace(/[/\\]$/, '')
              || (subVideoFile ? subVideoFile.split('\\').slice(0, -1).join('\\') : '');
    return `${dir}\\${base}_${suffix}.${ext}`;
  };

  const handleBurnSubtitles = async (srtContent, isOriginal = false) => {
    if (!subVideoFile || !srtContent) return alert('Cần chọn video và có SRT!');
    setIsBurning(true); setLogOpen(true); setBurnedVideoPath('');
    const label = isOriginal ? 'SRT Gốc' : 'SRT Dịch';
    addSubLog(`🔥 Ép phụ đề (${label}) vào video...`);
    try {
      // 1. Lưu file SRT ra thư mục
      const srtSuffix = isOriginal ? 'srt_goc' : `srt_dich_${targetLang}`;
      const srtPath = buildOutputPath(srtSuffix, 'srt');
      await window.electronAPI.saveTextFile({ content: srtContent, filePath: srtPath });
      addSubLog(`📄 SRT đã lưu: ${srtPath.split('\\').pop()}`);

      // 2. Áp dụng xuống dòng cho hiển thị trên màn hình
      const srtForBurn = subWrapSRTLines(srtContent, subStyle.wordsPerLine, 42);
      const outputPath = buildOutputPath(isOriginal ? 'phu_de_goc' : 'phu_de', 'mp4');
      const result = await window.electronAPI.burnSubtitles({
        videoPath: subVideoFile, srtContent: srtForBurn,
        outputFolder: subOutputFolder || null, outputPath, style: subStyle
      });
      if (result.success) {
        setBurnedVideoPath(result.path); setSubPreviewTab('video');
        addSubLog(`✅ Video phụ đề: ${result.path.split('\\').pop()}`, 'success');
      } else { addSubLog(`❌ Lỗi ép phụ đề: ${result.error}`, 'error'); }
    } catch (e) { addSubLog(`❌ Lỗi: ${e.message}`, 'error'); }
    setIsBurning(false);
  };

  const handleDownloadSRT = async (content, isOriginal = false) => {
    const suffix = isOriginal ? 'srt_goc' : `srt_dich_${targetLang}`;
    const srtPath = buildOutputPath(suffix, 'srt');
    const result = await window.electronAPI.saveTextFile({ content, filePath: srtPath });
    if (result.success) addSubLog(`✅ Đã lưu SRT: ${(result.filePath || srtPath).split('\\').pop()}`, 'success');
  };

  const handleDubbing = async (srtContent) => {
    if (!subVideoFile) return alert('Chưa chọn video gốc!');
    if (!srtContent) return alert('Chưa có SRT để lồng tiếng!');
    const segments = subParseSRTtoSegments(srtContent);
    if (!segments.length) return alert('Không đọc được dữ liệu SRT!');

    const isEdge    = dubEngine === 'edge';
    const isVieNeu  = dubEngine === 'vieneu';
    const voiceLabel = isEdge ? edgeDubVoice.split('-').pop() : isVieNeu ? (vnDubVoice || 'VieNeu') : dubVoice;

    setIsDubbing(true); setDubbedVideoPath(''); setLogOpen(true);
    const engineLabel = isEdge ? 'Edge TTS' : 'VieNeu TTS';
    setDubProgress({ done: 0, total: segments.length, text: `Khởi động ${engineLabel}...` });
    addSubLog(`🎙️ Lồng tiếng ${engineLabel} — ${voiceLabel} · ${segments.length} đoạn...`);
    try {
      const ext = isVieNeu ? 'wav' : 'mp3';
      const audioPath = buildOutputPath(`lotieng_${voiceLabel}_audio`, ext);
      addSubLog(`💾 Audio sẽ lưu: ${audioPath.split('\\').pop()}`);

      let ttsResult;
      if (isEdge) {
        ttsResult = await window.electronAPI.generateSRTVoice({ segments, voice: edgeDubVoice, outputPath: audioPath });
      } else {
        ttsResult = await window.electronAPI.vieNeuSynthesizeSRT({ segments, voiceId: vnDubVoice || undefined, outputPath: audioPath });
      }

      if (!ttsResult.success) {
        addSubLog(`❌ Lỗi tạo audio lồng tiếng: ${ttsResult.error}`, 'error');
        setIsDubbing(false); setDubProgress({ done:0, total:0, text:'' }); return;
      }
      addSubLog(`✅ Audio lồng tiếng đã lưu: ${audioPath.split('\\').pop()}`, 'success');

      addSubLog('🎬 Đang ghép audio vào video...');
      const videoPath = buildOutputPath(`lotieng_${voiceLabel}`, 'mp4');
      const mixResult = await window.electronAPI.mixAudio({
        videoPath: subVideoFile, audioPath: ttsResult.path,
        outputPath: videoPath, videoVol: 0, audioVol: 1.0
      });
      if (mixResult.success) {
        setDubbedVideoPath(mixResult.path); setSubPreviewTab('dubbed');
        addSubLog(`✅ Video lồng tiếng: ${mixResult.path.split('\\').pop()}`, 'success');
      } else { addSubLog(`❌ Lỗi ghép audio: ${mixResult.error}`, 'error'); }
    } catch (e) { addSubLog(`❌ Lỗi lồng tiếng: ${e.message}`, 'error'); }
    setIsDubbing(false); setDubProgress({ done:0, total:0, text:'' });
  };

  const handleRunAll = async () => {
    if (!subVideoFile) return alert('Vui lòng chọn video!');
    if (!subOutputFolder) return alert('Vui lòng chọn thư mục lưu trước khi chạy toàn bộ!');
    setIsRunningAll(true); setLogOpen(true);
    setOriginalSRT(''); setRawOriginalSRT(''); setOriginalSegments([]); setTranslatedSRT('');
    setBurnedVideoPath(''); setDubbedVideoPath('');

    const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
    if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini.', 'error'); setIsRunningAll(false); return; }

    const langObj    = SUBTITLE_LANGUAGES.find(l => l.code === targetLang);
    const langName   = langObj?.name || targetLang;
    const useWhisperAll = transcribeEngine === 'whisper';
    const totalSteps = 2 + (enableTranslate ? 1 : 0) + (burnSubtitle ? 1 : 0) + (dubEnabled ? 1 : 0);

    addSubLog(`🚀 Bắt đầu toàn bộ quy trình — ${totalSteps} bước · ${useWhisperAll ? 'Whisper cục bộ' : 'Gemini AI'} · lưu vào: ${subOutputFolder.split('\\').pop()}`);

    try {
      // ── BƯỚC 1: Lưu audio gốc ──
      addSubLog(`🎵 [1/${totalSteps}] Lưu audio gốc MP3...`);
      const audioGocPath = buildOutputPath('audio_goc', 'mp3');
      const audioSave = await window.electronAPI.saveAudioFromVideo({ inputPath: subVideoFile, outputFolder: subOutputFolder, outputPath: audioGocPath });
      if (audioSave.success) { setSavedAudioPath(audioSave.filePath); addSubLog(`  💾 ${audioSave.filePath.split('\\').pop()}`, 'success'); }
      else addSubLog(`  ⚠️ Lưu audio gốc thất bại: ${audioSave.error}`, 'error');

      // ── BƯỚC 2: Phiên âm → SRT gốc ──
      addSubLog(`🎙️ [2/${totalSteps}] Phiên âm → SRT gốc (${useWhisperAll ? '🤖 Whisper cục bộ' : '✨ Gemini AI'})...`);
      const metaRes2 = await window.electronAPI.prepareAudio(subVideoFile);
      if (!metaRes2.success || !metaRes2.duration) { addSubLog(`❌ Không đọc được thông tin video.`, 'error'); setIsRunningAll(false); return; }
      const dur2 = metaRes2.duration;
      addSubLog(`  📹 ${Math.floor(dur2/60)}p${Math.floor(dur2%60)}s...`);

      let transcribeResult;
      if (useWhisperAll) {
        transcribeResult = await transcribeLocalChunked(
          subVideoFile, dur2,
          (msg) => addSubLog(`  ⏳ ${msg}`),
          (done, total, segCount, errMsg) => {
            if (errMsg) addSubLog(`  ⚠️ Đoạn ${done}/${total}: ${errMsg}`, 'error');
            else        addSubLog(`  ✅ Đoạn ${done}/${total}: ${segCount} câu`);
          },
          (msg) => addSubLog(msg),
          (msg) => addSubLog(msg)
        );
      } else {
        if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini.', 'error'); setIsRunningAll(false); return; }
        transcribeResult = await transcribeAudioChunked(
          apiKeys, dur2,
          async (startSec, durationSec) => window.electronAPI.extractAudioChunk({ filePath: subVideoFile, startSec, durationSec }),
          (msg) => addSubLog(`  ⏳ ${msg}`),
          (done, total, segCount, errMsg) => {
            if (errMsg) addSubLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`);
            else        addSubLog(`  ✅ Phần ${done}/${total}: ${segCount} câu`);
          },
          (msg) => addSubLog(msg)
        );
      }

      if (!transcribeResult?.segments?.length) { addSubLog('❌ Không nhận được kết quả phiên âm.', 'error'); setIsRunningAll(false); return; }
      const srtRaw = subSegmentsToSRT(transcribeResult.segments);
      setOriginalSegments(transcribeResult.segments);
      setRawOriginalSRT(srtRaw);
      setOriginalSRT(subNormalizeSRT(srtRaw, 42, subStyle.wordsPerLine));
      setSubPreviewTab('original');
      const srtGocPath = buildOutputPath('srt_goc', 'srt');
      await window.electronAPI.saveTextFile({ content: srtRaw, filePath: srtGocPath });
      addSubLog(`  💾 SRT gốc: ${srtGocPath.split('\\').pop()} (${transcribeResult.segments.length} câu thoại)`, 'success');

      // ── BƯỚC 3: Dịch → SRT dịch (chỉ khi enableTranslate) ──
      let srtForBurn = srtRaw; // mặc định dùng SRT gốc để ép
      if (enableTranslate) {
        if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini để dịch.', 'error'); setIsRunningAll(false); return; }
        addSubLog(`🧠 [3/${totalSteps}] Dịch sang ${langName}...`);
        const translatedRaw = await smartTranslateSRT(srtRaw, targetLang, apiKeys, (msg) => addSubLog(`  ${msg}`));
        const translatedText = translatedRaw.trim();
        const srcCount = (srtRaw.trim().match(/\n\n/g) || []).length + 1;
        const dstCount = (translatedText.match(/\n\n/g) || []).length + 1;
        setTranslatedSRT(translatedText); setSubPreviewTab('translated');
        const srtDichPath = buildOutputPath(`srt_dich_${targetLang}`, 'srt');
        await window.electronAPI.saveTextFile({ content: translatedText, filePath: srtDichPath });
        addSubLog(`  💾 SRT dịch: ${srtDichPath.split('\\').pop()} — ${dstCount}/${srcCount} entry ${dstCount === srcCount ? '✅' : '⚠️'}`, 'success');
        srtForBurn = translatedText;
      } else {
        addSubLog(`⏭️ Bỏ qua dịch — dùng SRT gốc để ép phụ đề`, 'info');
      }

      // ── BƯỚC tiếp theo: Ép phụ đề (nếu bật) ──
      const burnStep = enableTranslate ? 4 : 3;
      let burnedPath = '';
      if (burnSubtitle && srtForBurn) {
        addSubLog(`🔥 [${burnStep}/${totalSteps}] Ép phụ đề ${enableTranslate ? 'dịch' : 'gốc'} vào video...`);
        const srtWrapped = subWrapSRTLines(srtForBurn, subStyle.wordsPerLine, 42);
        const phuDePath  = buildOutputPath(enableTranslate ? 'phu_de' : 'phu_de_goc', 'mp4');
        const burnResult = await window.electronAPI.burnSubtitles({
          videoPath: subVideoFile, srtContent: srtWrapped,
          outputFolder: subOutputFolder, outputPath: phuDePath, style: subStyle
        });
        if (burnResult.success) {
          burnedPath = burnResult.path; setBurnedVideoPath(burnResult.path);
          addSubLog(`  💾 Video phụ đề: ${burnResult.path.split('\\').pop()}`, 'success');
          if (!dubEnabled) { setSubPreviewTab('video'); addSubLog('🎉 Hoàn tất!', 'success'); }
        } else { addSubLog(`  ⚠️ Ép phụ đề thất bại: ${burnResult.error}`, 'error'); }
      }

      // ── BƯỚC Lồng tiếng (nếu bật) ──
      if (dubEnabled && srtForBurn) {
        const isEdge   = dubEngine === 'edge';
        const isVN     = dubEngine === 'vieneu';
        const voiceLabel = isEdge ? edgeDubVoice.split('-').pop() : isVN ? (vnDubVoice || 'VieNeu') : dubVoice;
        const dubStep = burnSubtitle ? burnStep + 1 : burnStep;
        const dubSegs = subParseSRTtoSegments(srtForBurn);
        addSubLog(`🎙️ [${dubStep}/${totalSteps}] Lồng tiếng ${isEdge ? 'Edge TTS' : 'VieNeu TTS'} (${voiceLabel}) · ${dubSegs.length} đoạn...`);
        setDubProgress({ done: 0, total: dubSegs.length, text: 'Khởi động...' });

        // 5a. Tạo file audio lồng tiếng
        const ext = isVN ? 'wav' : 'mp3';
        const audioLotiengPath = buildOutputPath(`lotieng_${voiceLabel}_audio`, ext);
        addSubLog(`  💾 Audio sẽ lưu: ${audioLotiengPath.split('\\').pop()}`);

        let ttsResult;
        if (isEdge) {
          ttsResult = await window.electronAPI.generateSRTVoice({ segments: dubSegs, voice: edgeDubVoice, outputPath: audioLotiengPath });
        } else {
          ttsResult = await window.electronAPI.vieNeuSynthesizeSRT({ segments: dubSegs, voiceId: vnDubVoice || undefined, outputPath: audioLotiengPath });
        }

        if (!ttsResult.success) {
          addSubLog(`  ⚠️ Lỗi tạo audio lồng tiếng: ${ttsResult.error}`, 'error');
        } else {
          addSubLog(`  ✅ Audio lồng tiếng đã lưu: ${audioLotiengPath.split('\\').pop()}`, 'success');

          // 5b. Ghép audio vào video (dùng video phụ đề nếu có)
          addSubLog('  🎬 Ghép audio vào video...');
          const videoForMix    = burnedPath || subVideoFile;
          const finalSuffix    = burnedPath ? 'final' : `lotieng_${voiceLabel}`;
          const finalVideoPath = buildOutputPath(finalSuffix, 'mp4');
          const mixResult = await window.electronAPI.mixAudio({
            videoPath: videoForMix, audioPath: ttsResult.path,
            outputPath: finalVideoPath, videoVol: 0, audioVol: 1.0
          });
          if (mixResult.success) {
            setDubbedVideoPath(mixResult.path); setSubPreviewTab('dubbed');
            const label = burnedPath ? 'Video cuối (phụ đề + lồng tiếng)' : 'Video lồng tiếng';
            addSubLog(`  💾 ${label}: ${mixResult.path.split('\\').pop()}`, 'success');
            addSubLog('🎉 Hoàn tất toàn bộ quy trình!', 'success');
          } else { addSubLog(`  ⚠️ Lỗi ghép audio: ${mixResult.error}`, 'error'); }
        }
        setDubProgress({ done:0, total:0, text:'' });
      } else if (!burnSubtitle) {
        addSubLog('🎉 Hoàn tất! SRT đã được lưu trong thư mục.', 'success');
      }
    } catch (e) { addSubLog(`❌ Lỗi: ${e.message}`, 'error'); }
    setIsRunningAll(false);
  };

  return (
    <div className="flex flex-col w-full h-full bg-[#0b1120] text-slate-300 overflow-hidden">
      <div className="flex-1 flex gap-6 p-6 min-h-0 overflow-hidden items-stretch">
        {/* ── Panel điều khiển bên trái ── */}
        <div className="w-[340px] bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shrink-0 shadow-sm overflow-hidden h-full">
          <div className="p-4 border-b border-slate-800 flex items-center gap-2 bg-[#1a233a]">
            <Languages size={18} className="text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Bóc tách &amp; Dịch Phụ đề</h2>
          </div>
          <div className="p-5 flex-1 overflow-y-auto space-y-5">
            {/* Chọn video / audio */}
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Video / Audio nguồn</label>
              <div className="flex gap-2 mb-2">
                <button onClick={async () => { const p = await window.electronAPI.selectFile('video'); if (p) { setSubVideoFile(p); setSavedAudioPath(''); setOriginalSRT(''); setRawOriginalSRT(''); setTranslatedSRT(''); setOriginalSegments([]); } }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 border border-slate-700">
                  <UploadCloud size={13}/> Chọn Video
                </button>
                <button onClick={async () => { const p = await window.electronAPI.selectFile('audio'); if (p) { setSubVideoFile(p); setSavedAudioPath(p); setOriginalSRT(''); setRawOriginalSRT(''); setTranslatedSRT(''); setOriginalSegments([]); } }}
                  className="flex-1 py-2 bg-amber-800/60 hover:bg-amber-700/60 text-amber-300 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 border border-amber-700/50">
                  <Mic size={13}/> Chọn Audio
                </button>
              </div>
              {subVideoFile && (
                <div className={`w-full px-3 py-2 border rounded-lg flex items-center gap-2 ${savedAudioPath === subVideoFile ? 'border-amber-500/40 bg-amber-900/10' : 'border-slate-700 bg-[#0f172a]'}`}>
                  <div className={`p-1 rounded-full shrink-0 ${savedAudioPath === subVideoFile ? 'text-amber-400' : 'text-slate-400'}`}><UploadCloud size={14}/></div>
                  <p className="text-xs font-bold truncate text-amber-400">{subVideoFile.split('\\').pop()}</p>
                  {savedAudioPath === subVideoFile && <span className="text-[10px] text-amber-500 shrink-0 ml-auto">🎵 Audio</span>}
                </div>
              )}
            </div>
            {/* Thư mục lưu */}
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Thư mục lưu Audio</label>
              <div className="flex gap-2">
                <input type="text" readOnly value={subOutputFolder} placeholder="Chưa chọn..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 focus:outline-none truncate" />
                <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setSubOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg"><FolderOpen size={15} /></button>
              </div>
            </div>
            {/* Bước 1 — Bóc tách Audio (ẩn nếu đã chọn file audio trực tiếp) */}
            {savedAudioPath !== subVideoFile && <div className="border border-slate-700 rounded-xl p-4 bg-[#0f172a]/50">
              <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2"><Mic size={14} className="text-amber-400"/> Bước 1 — Bóc tách Audio</p>
              <button onClick={handleExtractAudio} disabled={isExtractingAudio || !subVideoFile || !subOutputFolder}
                className="w-full bg-amber-700 hover:bg-amber-600 disabled:bg-slate-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm transition-colors">
                {isExtractingAudio ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
                {isExtractingAudio ? 'ĐANG BÓC TÁCH...' : 'Lưu Audio MP3'}
              </button>
              {savedAudioPath && (
                <p className="text-[10px] text-emerald-400 mt-2 truncate flex items-center gap-1">
                  <span className="shrink-0">✅</span><span className="truncate cursor-pointer hover:underline" onClick={() => window.electronAPI.openFile(savedAudioPath)}>{savedAudioPath.split('\\').pop()}</span>
                </p>
              )}
            </div>}
            {/* Bước 2 — Tạo SRT */}
            <div className="border border-slate-700 rounded-xl p-4 bg-[#0f172a]/50 space-y-3">
              <p className="text-xs font-bold text-slate-400 flex items-center gap-2"><FileText size={14} className="text-sky-400"/> Bước 2 — Tạo SRT gốc</p>
              {/* Engine toggle */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
                <button onClick={() => setTranscribeEngine('gemini')}
                  className={`flex-1 py-1.5 text-[10px] font-bold transition-colors ${transcribeEngine === 'gemini' ? 'bg-sky-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'}`}>
                  ✨ Gemini AI
                </button>
                <button onClick={() => setTranscribeEngine('whisper')}
                  className={`flex-1 py-1.5 text-[10px] font-bold transition-colors ${transcribeEngine === 'whisper' ? 'bg-emerald-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'}`}>
                  🤖 Whisper cục bộ
                </button>
              </div>
              {transcribeEngine === 'whisper' && (
                <p className="text-[9px] text-emerald-400/80">✅ Offline · không cần API key · tốt nhất cho tiếng Anh</p>
              )}
              {transcribeEngine === 'gemini' && (
                <p className="text-[9px] text-sky-400/80">✅ Cloud · cần API key · tốt nhất cho tiếng Việt</p>
              )}
              <button onClick={handleTranscribe} disabled={isTranscribing || !subVideoFile}
                className="w-full bg-sky-700 hover:bg-sky-600 disabled:bg-slate-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm transition-colors">
                {isTranscribing ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                {isTranscribing ? 'ĐANG PHIÊN ÂM...' : `Tạo SRT (${transcribeEngine === 'whisper' ? 'Whisper' : 'Gemini'})`}
              </button>
            </div>
            {/* Bước 3 — Dịch Thông Minh */}
            <div className="border border-purple-500/20 rounded-xl p-4 bg-purple-900/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-purple-300 flex items-center gap-2"><Languages size={14} className="text-purple-400"/> Bước 3 — Dịch Thông Minh AI</p>
                <div onClick={() => setEnableTranslate(v => !v)} className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${enableTranslate ? 'bg-purple-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enableTranslate ? 'left-4' : 'left-0.5'}`}/>
                </div>
              </div>
              {!enableTranslate ? (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2 text-center">
                  <p className="text-[10px] text-slate-400">⏭️ Bỏ qua dịch — giữ nguyên SRT gốc để ép phụ đề</p>
                  <p className="text-[9px] text-slate-600 mt-0.5">Video nói gì → sub hiện đúng nội dung đó</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-1.5">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-900/40 border border-blue-500/30 text-blue-300">① Phân tích ngữ cảnh</span>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-900/40 border border-purple-500/30 text-purple-300">② Dịch chuẩn bản ngữ</span>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Ngôn ngữ đích</label>
                    <div className="relative">
                      <select value={targetLang} onChange={e => setTargetLang(e.target.value)}
                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none appearance-none pr-8">
                        {SUBTITLE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"/>
                    </div>
                  </div>
                  <button onClick={handleTranslate} disabled={isTranslating || isRunningAll || !originalSRT}
                    className="w-full bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 disabled:from-slate-700 disabled:to-slate-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm transition-all">
                    {isTranslating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
                    {isTranslating ? 'ĐANG PHÂN TÍCH & DỊCH...' : 'Dịch Thông Minh (AI)'}
                  </button>
                  {!originalSRT && <p className="text-[10px] text-slate-600 text-center">Cần tạo SRT gốc trước</p>}
                </>
              )}
            </div>
            {/* Bước 4 — Ép phụ đề */}
            <div className="border border-orange-500/20 rounded-xl p-4 bg-orange-900/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-orange-300 flex items-center gap-2"><Flame size={14} className="text-orange-400"/> Bước 4 — Ép Phụ đề vào Video</p>
                <div onClick={() => setBurnSubtitle(v => !v)} className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${burnSubtitle ? 'bg-orange-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${burnSubtitle ? 'left-4' : 'left-0.5'}`}/>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-slate-500 w-14 shrink-0">Cỡ chữ</label>
                  <select value={subStyle.fontSize} onChange={e => setSubStyle(v => ({...v, fontSize: parseInt(e.target.value)}))}
                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500">
                    <option value={16}>16 — Nhỏ</option><option value={20}>20 — Vừa nhỏ</option><option value={24}>24 — Vừa</option>
                    <option value={28}>28 — Vừa lớn</option><option value={32}>32 — Lớn</option><option value={38}>38 — Rất lớn</option><option value={44}>44 — Cực lớn</option>
                  </select>
                </div>
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-slate-500 w-14 shrink-0 leading-tight">Từ/dòng <span className="text-slate-600">(hiển thị)</span></label>
                  <select value={subStyle.wordsPerLine} onChange={e => setSubStyle(v => ({...v, wordsPerLine: parseInt(e.target.value)}))}
                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500">
                    <option value={0}>Tự động (theo ký tự)</option>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} từ / dòng</option>)}
                  </select>
                </div>
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-slate-500 w-14 shrink-0">Màu chữ</label>
                  <select value={subStyle.color} onChange={e => setSubStyle(v => ({...v, color: e.target.value}))}
                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500">
                    <option value="white">⬜ Trắng</option><option value="yellow">🟡 Vàng</option><option value="gold">🟠 Vàng đậm</option>
                    <option value="orange">🟠 Cam</option><option value="red">🔴 Đỏ</option><option value="pink">🩷 Hồng</option>
                    <option value="purple">🟣 Tím</option><option value="green">🟢 Xanh lá</option><option value="cyan">🩵 Xanh ngọc</option>
                    <option value="blue">🔵 Xanh lam</option><option value="skyblue">🩵 Xanh da trời</option><option value="cream">🤍 Kem trắng</option>
                  </select>
                </div>
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-slate-500 w-14 shrink-0">Hiệu ứng</label>
                  <select value={subStyle.effect} onChange={e => setSubStyle(v => ({...v, effect: e.target.value}))}
                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500">
                    <option value="outline">▣ Viền đen (chuẩn)</option><option value="outline_thick">▣ Viền đen dày</option>
                    <option value="shadow">◼ Bóng đổ</option><option value="outline_shadow">▣◼ Viền + Bóng đổ</option>
                    <option value="bold_pop">⭐ Nổi bật mạnh (Bold)</option><option value="glow_white">✨ Phát sáng trắng</option>
                    <option value="glow_yellow">✨ Phát sáng vàng</option><option value="box">▬ Nền mờ đen</option>
                    <option value="box_white">▬ Nền mờ trắng</option><option value="none">○ Không hiệu ứng</option>
                  </select>
                </div>
                <div className="flex gap-2 items-center">
                  <label className="text-[10px] text-slate-500 w-14 shrink-0">Vị trí</label>
                  <select value={subStyle.position} onChange={e => setSubStyle(v => ({...v, position: e.target.value}))}
                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-orange-500">
                    <option value="bottom">▼ Dưới màn hình</option><option value="top">▲ Trên màn hình</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                {translatedSRT && (
                  <button onClick={() => handleBurnSubtitles(translatedSRT, false)} disabled={isBurning || !subVideoFile}
                    className="flex-1 bg-orange-700 hover:bg-orange-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs transition-colors">
                    {isBurning ? <Loader2 size={13} className="animate-spin"/> : <Flame size={13}/>}
                    {isBurning ? 'ĐANG ÉP...' : 'Ép SRT Dịch'}
                  </button>
                )}
                {(rawOriginalSRT || originalSRT) && (
                  <button onClick={() => handleBurnSubtitles(rawOriginalSRT || originalSRT, true)} disabled={isBurning || !subVideoFile}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs transition-colors">
                    {isBurning ? <Loader2 size={13} className="animate-spin"/> : <Flame size={13}/>}
                    {isBurning ? 'ĐANG ÉP...' : 'Ép SRT Gốc'}
                  </button>
                )}
                {!translatedSRT && !originalSRT && <p className="text-[10px] text-slate-600 text-center w-full py-1">Cần có SRT để ép phụ đề</p>}
              </div>
              {burnedVideoPath && (
                <p className="text-[10px] text-emerald-400 truncate flex items-center gap-1">
                  <span className="shrink-0">✅</span>
                  <span className="truncate cursor-pointer hover:underline" onClick={() => window.electronAPI.openFile(burnedVideoPath)}>{burnedVideoPath.split('\\').pop()}</span>
                </p>
              )}
            </div>
            {/* Bước 5 — Lồng tiếng TTS */}
            <div className="border border-blue-500/20 rounded-xl p-4 bg-blue-900/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-blue-300 flex items-center gap-2"><Sparkles size={14} className="text-blue-400"/> Bước 5 — Lồng tiếng TTS</p>
                <div onClick={() => setDubEnabled(v => !v)} className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${dubEnabled ? 'bg-blue-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${dubEnabled ? 'left-4' : 'left-0.5'}`}/>
                </div>
              </div>
              {dubEnabled && (
                <div className="space-y-2">
                  {/* Engine toggle */}
                  <div className="flex gap-1">
                    <button onClick={() => setDubEngine('edge')}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${dubEngine === 'edge' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      🔵 Edge TTS
                    </button>
                    <button onClick={() => setDubEngine('vieneu')}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${dubEngine === 'vieneu' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      🎙️ VieNeu TTS
                    </button>
                  </div>

                  {/* ── VieNeu voice picker ── */}
                  {dubEngine === 'vieneu' && (
                    <div className="space-y-1.5">
                      {vnDubVoices.length === 0 ? (
                        <p className="text-[10px] text-slate-500 italic px-1">Đang tải giọng... (VieNeu cần được cài)</p>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5">
                          {vnDubVoices.map(([desc, id]) => (
                            <div key={id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all ${vnDubVoice === id ? 'bg-orange-600/20 border-orange-500/50' : 'bg-slate-800/40 border-slate-700/40 hover:border-slate-600'}`}>
                              <button onClick={() => setVnDubVoice(id)} className="flex-1 text-left text-[10px] text-slate-300 truncate">
                                {vnDubVoice === id && <span className="text-orange-400 mr-1">✓</span>}{desc}
                              </button>
                              <button
                                disabled={!!vnDubPreviewing}
                                onClick={async () => {
                                  if (!subOutputFolder) { alert('Chọn thư mục lưu trước để nghe thử giọng.'); return; }
                                  setVnDubPreviewing(id); setVnDubPreviewUrl('');
                                  const tmp = `${subOutputFolder}\\vnprev_${id}_${Date.now()}.wav`;
                                  try {
                                    const r = await window.electronAPI?.vieNeuSynthesize?.({ text: 'Xin chào, đây là giọng VieNeu thử nghiệm.', outputPath: tmp, voiceId: id });
                                    if (r?.success) setVnDubPreviewUrl(`file:///${r.path.replace(/\\/g,'/')}`);
                                  } catch(_) {}
                                  finally { setVnDubPreviewing(''); }
                                }}
                                className="shrink-0 flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-slate-700 hover:bg-orange-600/40 text-slate-400 hover:text-orange-300 transition-colors disabled:opacity-40">
                                {vnDubPreviewing === id ? <span className="animate-spin inline-block">⟳</span> : '▶'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {vnDubPreviewUrl && (
                        <audio key={vnDubPreviewUrl} controls autoPlay src={vnDubPreviewUrl} className="w-full h-7 mt-1"/>
                      )}
                    </div>
                  )}

                  {/* ── Edge TTS voice picker ── */}
                  {dubEngine === 'edge' && (
                    <>
                      <div className="flex gap-1">
                        {[['All','Tất cả'],['Female','Nữ'],['Male','Nam']].map(([v,l]) => (
                          <button key={v} onClick={() => setEdgeDubGender(v)}
                            className={`flex-1 py-1 rounded text-[9px] font-bold border transition-colors ${edgeDubGender === v ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{l}</button>
                        ))}
                      </div>
                      <input value={edgeDubSearch} onChange={e => setEdgeDubSearch(e.target.value)}
                        placeholder="Tìm giọng (VD: vi-VN, HoaiMy...)"
                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-500 placeholder-slate-600"/>
                      {edgeDubVoices.length === 0 ? (
                        <p className="text-[10px] text-slate-500 text-center py-1">Đang tải danh sách giọng Edge TTS...</p>
                      ) : (
                        <select value={edgeDubVoice} onChange={e => setEdgeDubVoice(e.target.value)}
                          className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan-500" size={5}>
                          {(() => {
                            const q = edgeDubSearch.toLowerCase();
                            const filtered = edgeDubVoices.filter(v => {
                              const matchGender = edgeDubGender === 'All' || v.Gender === edgeDubGender;
                              const matchSearch = !q || v.ShortName?.toLowerCase().includes(q) || v.Locale?.toLowerCase().includes(q) || v.FriendlyName?.toLowerCase().includes(q);
                              return matchGender && matchSearch;
                            });
                            const byLocale = filtered.reduce((acc, v) => {
                              const loc = v.Locale || 'Other';
                              if (!acc[loc]) acc[loc] = [];
                              acc[loc].push(v);
                              return acc;
                            }, {});
                            const locales = Object.keys(byLocale).sort((a, b) => {
                              if (a.startsWith('vi')) return -1;
                              if (b.startsWith('vi')) return 1;
                              return a.localeCompare(b);
                            });
                            return locales.map(locale => (
                              <optgroup key={locale} label={`🌐 ${locale}`}>
                                {byLocale[locale].map(v => (
                                  <option key={v.ShortName} value={v.ShortName}>
                                    {v.Gender === 'Female' ? '👩' : '👨'} {v.ShortName?.split('-').pop()} — {v.FriendlyName || v.ShortName}
                                  </option>
                                ))}
                              </optgroup>
                            ));
                          })()}
                        </select>
                      )}
                      <p className="text-[9px] text-cyan-600/70 truncate">Đang chọn: <span className="text-cyan-400 font-bold">{edgeDubVoice}</span></p>
                    </>
                  )}

                  <p className="text-[9px] text-slate-500">🔇 Tiếng gốc tắt · Voice lồng tiếng 100%</p>
                  {isDubbing && dubProgress.total > 0 && (
                    <div>
                      <div className="flex justify-between text-[9px] text-blue-400 font-bold mb-1">
                        <span className="truncate">{dubProgress.text}</span>
                        <span className="shrink-0 ml-1">{dubProgress.done}/{dubProgress.total}</span>
                      </div>
                      <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${dubProgress.total > 0 ? (dubProgress.done / dubProgress.total) * 100 : 0}%` }}/>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    {translatedSRT && (
                      <button onClick={() => handleDubbing(translatedSRT)} disabled={isDubbing || !subVideoFile}
                        className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs transition-colors">
                        {isDubbing ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
                        {isDubbing ? `ĐANG LỒNG TIẾNG ${dubProgress.done}/${dubProgress.total}...` : 'Lồng tiếng SRT Dịch'}
                      </button>
                    )}
                    {originalSRT && (
                      <button onClick={() => handleDubbing(originalSRT)} disabled={isDubbing || !subVideoFile}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs transition-colors">
                        {isDubbing ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
                        Lồng tiếng SRT Gốc
                      </button>
                    )}
                    {!translatedSRT && !originalSRT && <p className="text-[10px] text-slate-600 text-center w-full py-1">Cần có SRT để lồng tiếng</p>}
                  </div>
                  {dubbedVideoPath && (
                    <p className="text-[10px] text-blue-400 truncate flex items-center gap-1">
                      <span className="shrink-0">✅</span>
                      <span className="truncate cursor-pointer hover:underline" onClick={() => window.electronAPI.openFile(dubbedVideoPath)}>{dubbedVideoPath.split('\\').pop()}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* NÚT BẮT ĐẦU TẤT CẢ */}
          <div className="p-4 border-t border-slate-800 bg-[#1a233a]">
            <button onClick={handleRunAll} disabled={isRunningAll || isTranscribing || isTranslating || isExtractingAudio || !subVideoFile}
              className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all bg-gradient-to-r from-amber-600 via-orange-500 to-rose-600 hover:from-amber-500 hover:via-orange-400 hover:to-rose-500 disabled:from-slate-700 disabled:via-slate-700 disabled:to-slate-700 disabled:shadow-none text-white">
              {isRunningAll ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
              {isRunningAll ? 'ĐANG XỬ LÝ...' : '▶ BẮT ĐẦU TOÀN BỘ'}
            </button>
            <p className="text-[10px] text-slate-500 text-center mt-2">
              {['SRT gốc → Dịch AI', burnSubtitle && '→ 🔥 Ép phụ đề', dubEnabled && `→ 🎙️ Lồng tiếng (${dubEngine === 'edge' ? edgeDubVoice.split('-').pop() : dubEngine === 'vieneu' ? (vnDubVoice || 'VieNeu') : dubVoice})`].filter(Boolean).join(' ')}
            </p>
          </div>
        </div>

        {/* ── Panel xem trước bên phải ── */}
        <div className="flex-1 bg-[#141c2f] border border-slate-800 rounded-xl flex flex-col shadow-sm overflow-hidden min-w-0">
          <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-[#1a233a] gap-3 flex-wrap">
            <div className="flex gap-2">
              <button onClick={() => setSubPreviewTab('original')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${subPreviewTab === 'original' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                SRT Gốc {originalSRT && <span className="ml-1 opacity-70">({originalSegments.length} dòng)</span>}
              </button>
              <button onClick={() => setSubPreviewTab('translated')} disabled={!translatedSRT} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${subPreviewTab === 'translated' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30'}`}>
                SRT Đã dịch
              </button>
              {/* Ẩn tab "Video Phụ đề" nếu đã có video lồng tiếng gộp chung */}
              {burnedVideoPath && !dubbedVideoPath && (
                <button onClick={() => setSubPreviewTab('video')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${subPreviewTab === 'video' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-orange-400 hover:text-white'}`}>
                  <Video size={13}/> Video Phụ đề
                </button>
              )}
              {dubbedVideoPath && (
                <button onClick={() => setSubPreviewTab('dubbed')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${subPreviewTab === 'dubbed' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-400 hover:text-white'}`}>
                  <Sparkles size={13}/> {burnedVideoPath ? 'Video cuối' : 'Video Lồng tiếng'}
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {subPreviewTab !== 'video' && (rawOriginalSRT || originalSRT) && (
                <button onClick={() => handleDownloadSRT(rawOriginalSRT || originalSRT, true)} className="flex items-center gap-1.5 text-xs font-bold text-white bg-sky-700 hover:bg-sky-600 px-3 py-1.5 rounded-md transition-colors">
                  <Download size={13}/> Tải SRT gốc
                </button>
              )}
              {subPreviewTab !== 'video' && translatedSRT && (
                <button onClick={() => handleDownloadSRT(translatedSRT, false)} className="flex items-center gap-1.5 text-xs font-bold text-white bg-purple-700 hover:bg-purple-600 px-3 py-1.5 rounded-md transition-colors">
                  <Download size={13}/> Tải SRT dịch
                </button>
              )}
              {subPreviewTab === 'video' && burnedVideoPath && (
                <button onClick={() => window.electronAPI.openFile(burnedVideoPath)} className="flex items-center gap-1.5 text-xs font-bold text-white bg-orange-700 hover:bg-orange-600 px-3 py-1.5 rounded-md transition-colors">
                  <FolderOpen size={13}/> Mở file
                </button>
              )}
              {subPreviewTab === 'dubbed' && dubbedVideoPath && (
                <button onClick={() => window.electronAPI.openFile(dubbedVideoPath)} className="flex items-center gap-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded-md transition-colors">
                  <FolderOpen size={13}/> Mở file
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-[#0f172a]/30 flex flex-col min-h-0">
            {subPreviewTab === 'original' && (
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
                {originalSRT ? <pre className="whitespace-pre-wrap text-slate-300 leading-relaxed">{originalSRT}</pre>
                  : <div className="h-full flex flex-col items-center justify-center text-slate-600"><FileText size={48} className="mb-4 opacity-20"/><p className="text-sm font-medium font-sans">Nhấn "Tạo SRT từ Video" để bắt đầu phiên âm</p></div>}
              </div>
            )}
            {subPreviewTab === 'translated' && (
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
                {translatedSRT ? <pre className="whitespace-pre-wrap text-slate-300 leading-relaxed">{translatedSRT}</pre>
                  : <div className="h-full flex flex-col items-center justify-center text-slate-600"><Languages size={48} className="mb-4 opacity-20"/><p className="text-sm font-medium font-sans">Chưa có bản dịch</p></div>}
              </div>
            )}
            {subPreviewTab === 'video' && (
              <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 min-h-0">
                {burnedVideoPath ? (
                  <>
                    <video key={burnedVideoPath} src={toFileUrl(burnedVideoPath)} controls
                      className="w-full max-h-full rounded-xl border border-orange-500/30 bg-black shadow-lg shadow-orange-900/20" style={{ maxHeight: 'calc(100% - 48px)' }}/>
                    <p className="text-[10px] text-slate-500 truncate w-full text-center shrink-0">{burnedVideoPath.split('\\').pop()}</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-600 h-full">
                    <Video size={48} className="mb-4 opacity-20"/><p className="text-sm font-medium">Chưa có video. Ép phụ đề để xem trước.</p>
                  </div>
                )}
              </div>
            )}
            {subPreviewTab === 'dubbed' && (
              <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 min-h-0">
                {dubbedVideoPath ? (
                  <>
                    <video key={dubbedVideoPath} src={toFileUrl(dubbedVideoPath)} controls autoPlay
                      className="w-full max-h-full rounded-xl border border-blue-500/30 bg-black shadow-lg shadow-blue-900/20" style={{ maxHeight: 'calc(100% - 56px)' }}/>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className="text-[10px] text-slate-500 truncate">{dubbedVideoPath.split('\\').pop()}</p>
                      <span className="text-[9px] text-blue-400 bg-blue-900/30 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold shrink-0">{burnedVideoPath ? '✅ Phụ đề + Lồng tiếng · Tiếng gốc tắt' : `🎙️ Gemini ${dubVoice} · Tiếng gốc tắt`}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-600 h-full gap-3">
                    <Sparkles size={48} className="opacity-20"/>
                    <p className="text-sm font-medium">Chưa có video lồng tiếng.</p>
                    <p className="text-xs text-slate-600">Bật Bước 5 → chọn giọng → nhấn "Lồng tiếng SRT Dịch"</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LOG PANEL */}
      <div className="bg-[#0b0f19] border-t border-slate-800 shrink-0 shadow-inner overflow-hidden font-mono flex flex-col transition-all duration-200" style={{ height: logOpen ? '180px' : '36px' }}>
        <button onClick={() => setLogOpen(v => !v)} className="flex items-center justify-between px-4 h-9 hover:bg-slate-800/40 transition-colors cursor-pointer w-full shrink-0">
          <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
            <Terminal className="w-3.5 h-3.5 text-slate-500"/> Nhật ký hoạt động
            {logs.length > 0 && !logOpen && <span className="ml-1 bg-slate-700 text-slate-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{logs.length}</span>}
            {!logOpen && logs.some(l => l.type === 'error') && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>}
            {!logOpen && logs.some(l => l.type === 'success') && !logs.some(l => l.type === 'error') && <span className="w-2 h-2 rounded-full bg-emerald-500"/>}
          </span>
          <div className="flex items-center gap-2">
            {logOpen && <span onClick={e => { e.stopPropagation(); setLogs([]); }} className="text-[10px] text-slate-500 hover:text-white border border-slate-700 px-2 py-0.5 rounded transition-colors">Xóa</span>}
            {logOpen ? <ChevronDown size={13} className="text-slate-500"/> : <ChevronUp size={13} className="text-slate-500"/>}
          </div>
        </button>
        {logOpen && (
          <div className="flex-1 overflow-y-auto px-4 pb-3 text-[11px] leading-relaxed custom-scrollbar space-y-1">
            {logs.length === 0 ? <p className="text-slate-600 text-center mt-4">Chưa có nhật ký nào.</p>
              : logs.map((log, idx) => (
                <div key={idx} className="flex gap-3">
                  <span className="text-slate-600 shrink-0">[{log.time}]</span>
                  <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}>{log.text}</span>
                </div>
              ))}
            <div ref={logsEndRef}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Url to Video ────────────────────────────────────────────────────────────
const STEPS_U2V = [
  { id: 'check', label: 'Kiểm tra Extension',  icon: Zap      },
  { id: 'clone', label: 'Clone Video Mode 6',   icon: Film     },
  { id: 'dna',   label: 'Ảnh DNA tham chiếu',  icon: Sparkles },
  { id: 'video', label: 'Tạo video Veo',         icon: Video    },
  { id: 'merge', label: 'Ghép video cuối',        icon: Scissors },
];
const STEPS_EXTEND = [
  { id: 'check',     label: 'Kiểm tra Extension', icon: Zap       },
  { id: 'clone',     label: 'Clone Mode 6',         icon: Film      },
  { id: 'extend',    label: 'Extend Chain',          icon: RefreshCw },
  { id: 'autoMerge', label: 'Auto Ghép Extend',      icon: Wand2     },
];
const U2V_RESULT_TABS = [
  { id: 'scenes', label: 'Cảnh JSON' },
  { id: 'dna',    label: 'DNA Ref'   },
  { id: 'video',  label: 'Videos'    },
  { id: 'merge',  label: 'Video cuối'},
];

// Normalize mode-6 scene — handle both array and dict formats from AI
function normalizeScene(obj) {
  // character_lock có 2 dạng AI hay output:
  //   dict: {"CHAR_ID": {id, name, description, role}}
  //   array: [{id, name, description, role}]
  if (!obj.character_lock) {
    obj.character_lock = [];
  } else if (Array.isArray(obj.character_lock)) {
    // already array — giữ nguyên
  } else if (typeof obj.character_lock === 'object') {
    // dict → convert values thành array, chuẩn hoá từng entry
    obj.character_lock = Object.values(obj.character_lock).filter(v => v && typeof v === 'object');
  } else {
    obj.character_lock = [];
  }

  // background — giữ object, null nếu không phải object
  if (obj.background && typeof obj.background !== 'object') obj.background = null;

  return obj;
}

// Parse mode-6 output text → array of scene objects sorted by scene_id
function parseU2VScenes(rawText) {
  if (!rawText) return [];
  // Dùng Map để tự động dedup theo scene_id — nếu AI xuất 2 dòng cùng ID, lấy cái cuối cùng
  const sceneMap = new Map();
  for (const line of rawText.split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    try {
      const obj = JSON.parse(t);
      const id = parseInt(obj.scene_id);
      if (!isNaN(id) && id > 0) sceneMap.set(id, normalizeScene({ ...obj, scene_id: id }));
    } catch {}
  }
  return [...sceneMap.values()].sort((a, b) => a.scene_id - b.scene_id);
}

// ─── Phát hiện ngôn ngữ đơn giản dựa trên ký tự đặc trưng ──────────────────
const LANG_CHAR_PATTERNS = {
  vi: /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i,
  ja: /[぀-ゟ゠-ヿ]/,
  zh: /[一-鿿]/,
  ko: /[가-힯]/,
  ar: /[؀-ۿ]/,
  th: /[฀-๿]/,
};

function detectTextLang(text) {
  for (const [lang, re] of Object.entries(LANG_CHAR_PATTERNS)) {
    if (re.test(text)) return lang;
  }
  return 'en'; // default latin
}

// ─── Ép buộc ngôn ngữ trong lines sau khi parse ─────────────────────────────
function enforceDialogueLanguage(scenes, targetLang, logFn) {
  if (!targetLang || targetLang === 'none') return scenes;
  let fixedCount = 0;
  const fixed = scenes.map(scene => {
    const lines = scene.audio?.dialogue?.lines;
    if (!Array.isArray(lines) || lines.length === 0) return scene;

    const cleanedLines = lines.filter(line => {
      if (!line || typeof line !== 'string') return false;
      // Bỏ placeholder "[...ONLY]" do template tạo ra
      if (/^\[.*ONLY\]$/i.test(line.trim())) return false;
      const detectedLang = detectTextLang(line);
      // Nếu target là English — xóa mọi dòng có ký tự không phải Latin-based
      if (targetLang === 'en' && detectedLang !== 'en') {
        fixedCount++;
        logFn?.(`🔧 Scene ${scene.scene_id}: xóa dòng sai ngôn ngữ (${detectedLang}): "${line.slice(0, 40)}..."`, 'info');
        return false;
      }
      // Nếu target là ngôn ngữ đặc thù — xóa dòng không khớp
      if (targetLang !== 'en' && LANG_CHAR_PATTERNS[targetLang]) {
        const targetRe = LANG_CHAR_PATTERNS[targetLang];
        // Nếu có ký tự ngôn ngữ khác không phải target → xóa
        for (const [lang, re] of Object.entries(LANG_CHAR_PATTERNS)) {
          if (lang !== targetLang && re.test(line)) {
            fixedCount++;
            logFn?.(`🔧 Scene ${scene.scene_id}: xóa dòng sai ngôn ngữ (${lang}): "${line.slice(0, 40)}..."`, 'info');
            return false;
          }
        }
      }
      return true;
    });

    if (cleanedLines.length === lines.length) return scene;
    // Deep clone scene với lines đã lọc
    return {
      ...scene,
      audio: {
        ...scene.audio,
        dialogue: {
          ...scene.audio.dialogue,
          lines: cleanedLines,
          language: targetLang,
        },
      },
    };
  });

  if (fixedCount > 0)
    logFn?.(`🔧 Đã xóa ${fixedCount} dòng thoại sai ngôn ngữ — ép buộc ${targetLang.toUpperCase()}`, 'info');
  return fixed;
}

// Danh sách phong cách video cho URL to Video
const U2V_STYLES = [
  { id: 'default',    label: '🎯 Mặc định (giữ phong cách gốc)', prompt: null },
  { id: 'cinematic',  label: '🎬 Cinematic Hollywood',            prompt: 'CINEMATIC, dramatic lighting, film grain, anamorphic bokeh, Hollywood blockbuster, color graded' },
  { id: 'viral',      label: '📱 Viral Social Media',             prompt: 'VIRAL SOCIAL MEDIA, dynamic cuts, high energy, trendy aesthetic, bright saturated colors, Gen-Z style' },
  { id: 'anime',      label: '🎨 Anime / Hoạt hình 2D',          prompt: 'ANIME 2D ANIMATION STYLE, vibrant colors, cel-shaded hand-drawn animation, Japanese anime quality, expressive characters, flat illustration' },
  { id: 'ghibli',     label: '🌿 Ghibli / Studio Ghibli',         prompt: 'STUDIO GHIBLI STYLE, hand-painted watercolor backgrounds, soft pastel colors, whimsical nature scenes, Miyazaki aesthetic, painterly 2D animation, gentle dreamlike atmosphere' },
  { id: '3d_cartoon', label: '🧸 3D Cartoon / Pixar Style',       prompt: 'PIXAR 3D ANIMATION STYLE, glossy cartoon render, smooth subsurface scattering, playful colorful characters, Pixar/Disney quality CGI, cinematic 3D animation' },
  { id: '3d_realistic',label: '🖥️ 3D Realistic / CGI',            prompt: 'PHOTOREALISTIC 3D CGI, ray-tracing global illumination, hyper-detailed textures, cinematic VFX quality, Unreal Engine render, ultra-realistic 3D animation' },
  { id: '2d_motion',  label: '✏️ 2D Motion Graphics',             prompt: '2D MOTION GRAPHICS, flat design illustration, clean vector art, dynamic animated infographic style, modern minimal animation, smooth transitions' },
  { id: 'documentary',label: '📽️ Documentary / Phóng sự',         prompt: 'DOCUMENTARY, natural lighting, realistic handheld camera, authentic, journalistic style' },
  { id: 'commercial', label: '💼 Commercial / Quảng cáo',         prompt: 'COMMERCIAL ADVERTISEMENT, polished studio lighting, clean background, professional product quality' },
  { id: 'vlog',       label: '🤳 Vlog / Lifestyle',               prompt: 'VLOG LIFESTYLE, casual authentic look, natural outdoor lighting, warm tones, personal storytelling' },
  { id: 'fantasy',    label: '✨ Fantasy / Sci-Fi',               prompt: 'EPIC FANTASY SCI-FI, magical atmosphere, dramatic volumetric lighting, CGI visual effects, otherworldly' },
  { id: 'vintage',    label: '📺 Vintage / Retro',                prompt: 'VINTAGE RETRO aesthetic, film grain, warm faded colors, nostalgic 70s-80s cinematography' },
  { id: 'dark',       label: '🌑 Dark & Moody',                   prompt: 'DARK MOODY cinematic, deep shadows, noir atmosphere, low-key lighting, dramatic contrast' },
];

function UrlToVideoPanel() {
  const [apiKeys]       = useState(loadKeys);
  const [aiMode,     setAiMode]    = useState('gemini');
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);
  const [inputMode, setInputMode] = useState('url');   // 'url' | 'upload'
  const [videoUrl,  setVideoUrl]  = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);   // File object from <input type="file">
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [language,  setLang]      = useState('vi');
  const [u2vStyle,  setU2vStyle]  = useState('default');
  const [ratio,     setRatio]     = useState('16:9');
  const [vidMdl,    setVidMdl]    = useState('Veo 3.1 - Lite [Lower Priority]');
  const [imgMdl,    setImgMdl]    = useState('Nano Banana Pro');
  const [vidQuality,setVidQuality]= useState('720p');
  const [charVoices, setCharVoices] = useState(['random', '', '']); // [char1, char2, char3]
  const [useTransition, setUseTransition] = useState(true);
  const [refDir,    setRefDir]    = useState('');
  const [vidDir,    setVidDir]    = useState('');
  const vidDirRef = useRef('');
  useEffect(() => { vidDirRef.current = vidDir; }, [vidDir]);

  // Pipeline state
  const [running,   setRunning]   = useState(false);
  const [activeStep,setActive]    = useState(null);
  const [doneSteps, setDone]      = useState([]);
  const [errorStep, setErrStep]   = useState(null);
  const [error,     setError]     = useState('');
  const [logOpen,   setLogOpen]   = useState(true);

  // Results
  const [rawMode6,   setRawMode6]   = useState('');
  const [scenes,     setScenes]     = useState([]);
  const [dnaImgs,    setDnaImgs]    = useState([]);
  const [dnaInfos,   setDnaInfos]   = useState([]);
  const [videoPaths, setVideoPaths] = useState([]);
  const [mergedPath, setMergedPath] = useState('');
  const [activeTab,  setActiveTab]  = useState('scenes');
  const [copied,     setCopied]     = useState(false);

  // Video method: 'ingredients' | 'extend'
  const [videoMethod,  setVideoMethod]  = useState('ingredients');
  const [extT2vMdl,    setExtT2vMdl]   = useState('Veo 3.1 - Lite [Lower Priority]');
  const [extExtMdl,    setExtExtMdl]   = useState('Veo 3.1 - Lite [Lower Priority]');
  const [extDur,       setExtDur]      = useState('8s');
  const [extQuality,   setExtQuality]  = useState('720p');
  const [extProgress,  setExtProgress] = useState({ current: 0, total: 0, stepPct: 0, phase: '', latestFile: null });
  const [extResult,    setExtResult]   = useState(null);
  const [extMergedPath, setExtMergedPath] = useState(null);
  const extVidRef    = useRef(null);
  const [extVidPaused, setExtVidPaused] = useState(true);
  const [extVidMuted,  setExtVidMuted]  = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const logsRef = useRef(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!running) return;
    const handler = (data) => {
      if (!data?.text) return;
      const clean = (data.text || '').replace(/^\[JOBID:.+?\]\s*/, '');
      if (!clean || ['job_start','job_success','job_fail'].includes(data.type)) return;

      // ── Parse Extend Chain progress ──────────────────────────────────────────
      const stepStart = clean.match(/\[Step (\d+)\/(\d+)\]/);
      if (stepStart) {
        setExtProgress(prev => ({
          ...prev,
          current: parseInt(stepStart[1]), total: parseInt(stepStart[2]),
          stepPct: 0,
          phase: clean.includes('T2V') ? '🎬 T2V — Tạo video gốc' : '🔁 Extend — Nối tiếp cảnh'
        }));
      }
      const pctLine = clean.match(/\[step \d+\]\s*(\d+)%/);
      if (pctLine) setExtProgress(prev => ({ ...prev, stepPct: parseInt(pctLine[1]) }));
      const savedExt = clean.match(/✅ \[Step \d+\] Lưu thành công:\s*(.+)/);
      if (savedExt) {
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) setExtProgress(prev => ({ ...prev, stepPct: 100, latestFile: dir + '\\' + savedExt[1].trim() }));
        setExtVidPaused(false);
      }

      // ── Parse Ingredients video save ─────────────────────────────────────────
      const saveMatch = clean.match(/^Lưu thành công:\s*(.+\.mp4)$/i);
      if (saveMatch) {
        const filename = saveMatch[1].trim();
        const dir = (vidDirRef.current || '').replace(/[\\/]+$/, '');
        if (dir) {
          const fullPath = dir + '\\' + filename;
          setVideoPaths(prev => prev.includes(fullPath) ? prev : [...prev, fullPath]);
        }
      }
      addLog(clean, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    const _w = window.electronAPI?.onVeoLog?.(handler);
    return () => { if (_w) window.electronAPI?.removeListener?.('veo-log', _w); };
  }, [running]);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-400), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };
  const stepStatus = (id) =>
    doneSteps.includes(id) ? 'done'
    : activeStep === id    ? 'active'
    : errorStep  === id    ? 'error'
    : 'pending';

  const handleStop = () => { stopRef.current = true; };

  const handleStart = async () => {
    if (inputMode === 'url' && !videoUrl.trim()) { setError('Vui lòng nhập URL video (YouTube/TikTok).'); return; }
    if (inputMode === 'upload' && !uploadedFile) { setError('Vui lòng chọn file video để tải lên.'); return; }
    if (!apiKeys.length)      { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
    if (videoMethod === 'ingredients' && (!refDir || !vidDir)) { setError('Vui lòng chọn thư mục lưu ảnh DNA và video.'); return; }
    if (videoMethod === 'extend' && !vidDir) { setError('Vui lòng chọn thư mục lưu video.'); return; }

    setRunning(true); setError(''); setLogs([]);
    setDone([]); setActive(null); setErrStep(null);
    setRawMode6(''); setScenes([]); setDnaImgs([]);
    setVideoPaths([]); setMergedPath('');
    setExtResult(null); setExtMergedPath(null); setExtProgress({ current: 0, total: 0, stepPct: 0, phase: '', latestFile: null });
    stopRef.current = false;

    try {
      // ── 1. Check Extension ───────────────────────────────────────────────────
      setActive('check');
      addLog('Kiểm tra kết nối Extension Veo Studio...', 'info');
      const ck = await window.electronAPI?.checkVeoCookie?.();
      if (!ck?.success) throw new Error(`Extension chưa kết nối! ${ck?.error || 'Hãy F5 Google Labs.'}`);
      addLog('✅ Extension đã kết nối — sẵn sàng!', 'success');
      markDone('check');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── Resolve video input (URL hoặc uploaded file) ─────────────────────────
      let videoInput;
      if (inputMode === 'upload' && uploadedFile) {
        addLog(`📁 File đã chọn: ${uploadedFile.name} (${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB)`, 'info');
        const MAX_INLINE = 20 * 1024 * 1024; // 20 MB
        if (uploadedFile.size <= MAX_INLINE) {
          // Nhỏ ≤20 MB → đọc base64 trực tiếp (nhanh, không cần API upload)
          addLog('📖 Đọc file dưới dạng base64 (≤20 MB)...', 'info');
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(uploadedFile);
          });
          videoInput = { data: base64, mimeType: uploadedFile.type || 'video/mp4' };
          addLog('✅ File đã sẵn sàng (inline)', 'success');
        } else {
          // Lớn >20 MB → upload lên Gemini File API
          setUploading(true);
          addLog(`⬆️ File lớn (${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB) — tải lên Gemini File API...`, 'info');
          try {
            const { uri } = await uploadVideoToGemini(
              apiKeys,
              uploadedFile,
              (msg) => addLog(msg, 'info'),
            );
            videoInput = uri; // string URI → buildVideoContentPart sẽ dùng fileData.fileUri
            addLog('✅ Upload thành công — file sẵn sàng', 'success');
          } finally {
            setUploading(false);
          }
        }
      } else {
        videoInput = videoUrl.trim();
      }
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 2. Clone Video Mode 6 ────────────────────────────────────────────────
      setActive('clone'); setActiveTab('scenes');
      addLog('🎬 Bắt đầu Clone Video Mode 6 — phân tích cảnh...', 'info');

      const selectedStyle = U2V_STYLES.find(s => s.id === u2vStyle);
      const stylePrompt = selectedStyle?.prompt || null; // null = dùng phong cách gốc từ video
      addLog(`🎨 Phong cách: ${selectedStyle?.label || 'Mặc định'}`, 'info');

      // Target language — truyền vào Gemini để dialogue được viết đúng ngôn ngữ
      const targetLang = (language && language !== 'none') ? language : null;
      if (targetLang) addLog(`🌐 Ngôn ngữ thoại: ${targetLang.toUpperCase()} — Gemini sẽ viết dialogue bằng ${targetLang}`, 'info');

      const mode6Raw = await analyzeAndCloneScript(
        apiKeys,
        videoInput,   // URL string hoặc { data, mimeType } hoặc Gemini File URI string
        6,        // mode 6
        '',       // channelTopic
        '',       // newTopic
        ({ fromIdx, toIdx }) => addLog(`🔄 Key ${fromIdx + 1} → Key ${toIdx + 1}`, 'info'),
        (evt) => {
          if (evt.message) addLog(evt.message, 'info');
        },
        stylePrompt,  // 8th: custom visual style
        targetLang,   // 9th: target dialogue language (null = giữ ngôn ngữ gốc)
      );

      if (!mode6Raw) throw new Error('Clone Video Mode 6 không trả về kết quả.');
      setRawMode6(mode6Raw);

      const rawScenes = parseU2VScenes(mode6Raw);
      if (!rawScenes.length) throw new Error('Không phân tích được cảnh nào từ kết quả Mode 6.');

      // Ép buộc ngôn ngữ thoại — xóa mọi dòng dialogue sai ngôn ngữ
      const parsedScenes = enforceDialogueLanguage(rawScenes, targetLang, addLog);
      setScenes(parsedScenes);
      addLog(`✅ Mode 6 hoàn thành — ${parsedScenes.length} cảnh · ngôn ngữ thoại: ${targetLang ? targetLang.toUpperCase() : 'gốc'}`, 'success');
      markDone('clone');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ══════════════════════════════════════════════════════════════════════════
      // BRANCH: Extend Chain (bỏ qua DNA / Ingredients / Merge)
      // ══════════════════════════════════════════════════════════════════════════
      if (videoMethod === 'extend') {
        setActive('extend');
        setActiveTab('scenes'); // hiện cảnh trong khi render

        // Trích xuất prompt cho Extend — chỉ lấy phần cảnh bắt đầu, bỏ hết phần thừa
        const cleanForExtend = (raw) => {
          if (!raw) return '';
          let t = raw.trim();
          t = t.replace(/^\[[^\]]*\bvoice\b[^\]]*\],?\s*/gi, ''); // bỏ [xxx voice]
          t = t.replace(/^\[[^\]]*\],?\s*/i, '');                  // bỏ [xxx] bất kỳ ở đầu
          t = t.replace(/^[^,]{1,60}(?:style|animation|cinematic)[^,]*,\s*/i, ''); // bỏ "Xxx style, "
          t = t.replace(/^\/\/[^\n]*/gm, '').trim();               // bỏ // comments
          // Bỏ đuôi "no text, no captions, no watermarks..." thường ở cuối prompt Veo
          t = t.replace(/,?\s*(?:no\s+(?:text|caption|subtitle|watermark|on.?screen)[^,]*,?\s*)+\.?\s*$/gi, '').trim();
          return t;
        };

        const extPrompts = parsedScenes.map(sc => {
          // Ưu tiên action_description (mô tả thuần hành động, không lẫn voice/style)
          // Fallback sang prompt đã clean, rồi title
          const fromAction = cleanForExtend(sc.action_description);
          const fromPrompt = cleanForExtend(sc.prompt);
          const fromTitle  = (sc.title || '').trim();

          const best =
            (fromAction && detectTextLang(fromAction) === 'en' ? fromAction : null) ||
            (fromPrompt && detectTextLang(fromPrompt) === 'en' ? fromPrompt : null) ||
            fromAction || fromPrompt || fromTitle || 'smooth cinematic motion';

          return best;
        }).filter(Boolean);

        addLog(`🔁 Extend Chain: ${extPrompts.length} bước · Model: ${extT2vMdl}`, 'info');
        setExtProgress({ current: 0, total: extPrompts.length, stepPct: 0, phase: '', latestFile: null });

        const extResult = await window.electronAPI.extendChain({
          prompts:     extPrompts,
          aspectRatio: ratio,
          t2vModel:    extT2vMdl,
          t2vDuration: extDur,
          t2vQuality:  extQuality,
          extendModel: extT2vMdl,
          outputFolder: vidDir,
        });

        if (extResult?.success && extResult.files?.length) {
          const finalPath = extResult.files[extResult.files.length - 1].filePath;
          setExtResult(finalPath);
          setActiveTab('extend');
          const savedCount = extResult.files.length;
          addLog(`✅ Extend Chain hoàn tất! ${savedCount} video đã lưu vào thư mục. Preview: ${finalPath.split(/[\\/]/).pop()}`, 'success');
          markDone('extend');

          // ── Auto Ghép Extend: cắt 1s đầu mỗi clip → ghép thành 1 video ─────
          setActive('autoMerge');
          addLog(`🔀 Auto Ghép Extend: cắt 1s đầu × ${savedCount} clip → ghép...`, 'info');
          const allFilePaths = extResult.files.map(f => f.filePath);
          const mergeOutName = `extend_merged_${Date.now()}`;
          const mergeRes = await window.electronAPI.mergeVideo({
            files: allFilePaths,
            trimStart: 1,
            trimEnd: 0,
            transition: 'Không có',
            outputFolder: vidDir,
            outputName: mergeOutName,
          });
          if (mergeRes?.success && mergeRes?.path) {
            setExtMergedPath(mergeRes.path);
            setActiveTab('extMerge');
            addLog(`✅ Ghép hoàn tất: ${mergeOutName}.mp4`, 'success');
            markDone('autoMerge');
          } else {
            addLog(`⚠️ Auto Ghép lỗi: ${mergeRes?.error || 'unknown'} — xem tab Extend để lấy clip lẻ.`, 'error');
            markDone('autoMerge');
          }
        } else {
          throw new Error(extResult?.error || 'Extend Chain không trả về video.');
        }
        return; // bỏ qua DNA / video / merge
      }

      // ── 3. DNA Reference Images ──────────────────────────────────────────────
      setActive('dna'); setActiveTab('dna');

      // Bóc tách toàn bộ entity từ JSON Mode 6
      const charMap = new Map(); // id → {name, description}
      const envMap  = new Map(); // id → description  (bối cảnh)

      for (const scene of parsedScenes) {
        // ── Nhân vật / Vật thể chính (character_lock) ──────────────────────
        // Sau normalizeScene, character_lock là array của entries
        scene.character_lock.forEach(c => {
          const cid  = c?.id || c?.CHAR_ID;
          const name = c?.name || cid || '';
          const desc = c?.description || c?.visual_description || name;
          if (cid && !charMap.has(cid)) charMap.set(cid, { name, description: desc });
        });

        // ── Bối cảnh (background) ──────────────────────────────────────────
        // Format mới: {setting, lighting, atmosphere}   (không có id)
        // Format cũ:  {id, description}
        const bg = scene.background && typeof scene.background === 'object' ? scene.background : null;
        if (bg) {
          const bgId = bg.id
            || (bg.setting ? 'env_' + bg.setting.slice(0, 35).replace(/[\s,./\\]+/g, '_').toLowerCase() : null)
            || `env_scene${scene.scene_id}`;
          const bgDesc = bg.description
            || [bg.setting, bg.lighting, bg.atmosphere].filter(Boolean).join(', ');
          if (bgDesc && !envMap.has(bgId)) envMap.set(bgId, bgDesc);
        }
      }

      const charIds = [...charMap.keys()];
      const envIds  = [...envMap.keys()];
      addLog(`[DNA] Phát hiện: ${charIds.length} nhân vật/vật thể · ${envIds.length} bối cảnh`, 'info');

      const dnaTasks = [];
      const charDnaTaskMap = new Map(); // taskId → charId
      const envDnaTaskMap  = new Map(); // taskId → envId
      let _dnaIdx = 1;

      // Hard cap: tối đa 5 nhân vật + 3 môi trường = 8 ảnh DNA
      charIds.slice(0, 5).forEach((charId, i) => {
        const data      = charMap.get(charId);
        const name      = typeof data === 'object' ? (data.name || charId) : charId;
        const desc      = typeof data === 'object' ? (data.description || name) : data;
        const stylePart = stylePrompt ? `${stylePrompt}. ` : 'Photorealistic, 4K, high detail. ';
        const prompt    = `${stylePart}Multi-angle character turnaround reference sheet, 8 panels in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head] [right side profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white studio background. CHARACTER: ${name}, ${desc}. Same character consistently across all 8 panels. Professional character design turnaround sheet. No text labels, no arrows, no annotations, no captions, no watermarks.`;
        dnaTasks.push({ id: `dna_c${i}`, prompt, fileIndex: _dnaIdx++ });
        charDnaTaskMap.set(`dna_c${i}`, charId);
      });
      envIds.slice(0, 3).forEach((envId, i) => {
        const desc   = envMap.get(envId) || envId;
        const prompt = `Photorealistic wide establishing shot, ${desc}, empty scene, no people, cinematic quality, 4K`;
        dnaTasks.push({ id: `dna_e${i}`, prompt, fileIndex: _dnaIdx++ });
        envDnaTaskMap.set(`dna_e${i}`, envId);
      });
      if (dnaTasks.length > 10) dnaTasks.length = 10;

      const charImgMap  = {}; // charId → filePath
      const charMediaMap= {}; // charId → mediaId
      const envImgMap   = {}; // envId  → filePath
      const envMediaMap = {}; // envId  → mediaId
      let dnaImgPaths   = [];
      const infoByPath  = {};

      if (dnaTasks.length > 0) {
        {
          // ── Veo: runVeo Image ──────────────────────────────────────────────────
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu...`, 'info');
          const r = await window.electronAPI.runVeo({
            mediaType: 'Image', tasks: dnaTasks,
            aspectRatio: ratio, model: imgMdl,
            genCount: '1x', quality: '720p',
            outputFolder: refDir, duration: null,
          });
          const dnaResults = (r?.files || []).filter(f => !f.isError && f.filePath);
          dnaImgPaths = dnaResults.map(f => f.filePath);
          dnaResults.forEach(f => {
            const cid = charDnaTaskMap.get(f.id);
            if (cid) {
              if (f.filePath)  charImgMap[cid]  = f.filePath;
              if (f.mediaId)   charMediaMap[cid] = f.mediaId;
              if (f.filePath) {
                const cdata = charMap.get(cid);
                const displayName = typeof cdata === 'object' ? (cdata.name || cid) : cid;
                infoByPath[f.filePath] = { type: 'char', name: displayName };
              }
            }
            const eid = envDnaTaskMap.get(f.id);
            if (eid) {
              if (f.filePath)  envImgMap[eid]  = f.filePath;
              if (f.mediaId)   envMediaMap[eid] = f.mediaId;
              if (f.filePath)  infoByPath[f.filePath] = { type: 'env', name: eid.replace(/^env_/, '') };
            }
          });
        }
        setDnaImgs(dnaImgPaths);
        setDnaInfos(dnaImgPaths.map(p => infoByPath[p] || { type: 'unknown', name: '' }));
        const charNames = Object.keys(charImgMap).map(id => { const d = charMap.get(id); return typeof d === 'object' ? (d.name || id) : id; });
        addLog(`✅ DNA: ${charNames.length} nhân vật [${charNames.join(', ')}] · ${Object.keys(envImgMap).length} bối cảnh (${dnaImgPaths.length}/${dnaTasks.length} ảnh)`, 'success');
      } else {
        addLog('⚠️ Không có DNA entity — tạo video text-to-video', 'info');
      }
      markDone('dna');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── Build prompt với ngôn ngữ ép buộc (giống IdeaToVideo) ───────────────
      const LANG_EN_U2V = {
        vi: 'Vietnamese', en: 'English', ja: 'Japanese', zh: 'Chinese',
        ko: 'Korean', fr: 'French', es: 'Spanish', de: 'German', th: 'Thai',
      };
      const langLabel = LANG_EN_U2V[language];
      const noTextSuffix = 'no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only';
      const silentSuffix = 'natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text';

      const buildU2VPrompt = (scene) => {
        // Strip dòng // comment mà Gemini đôi khi nhúng vào field prompt (vd: // Video: ...)
        const stripComments = (s) => s ? s.replace(/^\/\/[^\n]*/gm, '').trim() : s;
        const rawBase = stripComments(scene.prompt) || stripComments(scene.action_description) || 'smooth cinematic motion';
        // Inject style lock — prepend style nếu user đã chọn phong cách khác default
        const styleLockPrefix = stylePrompt ? `MANDATORY VISUAL STYLE: ${stylePrompt}. ` : '';
        const base = `${styleLockPrefix}${rawBase}`;
        // Lấy lời thoại từ audio.dialogue.lines (mode 6 format)
        const dialogueLines = Array.isArray(scene.audio?.dialogue?.lines)
          ? scene.audio.dialogue.lines : [];
        const dialogue = dialogueLines.join(' ').trim();

        if (!langLabel || language === 'none') {
          // Không ngôn ngữ — cảnh im lặng
          let cleaned = base.replace(/^\[[^\]]*\bvoice\b[^\]]*\],?\s*/i, '');
          cleaned = cleaned.replace(/,?\s*spoken audio only\s*$/i, '');
          if (!cleaned.includes('no speech')) cleaned = `${cleaned}, ${silentSuffix}`;
          return cleaned;
        }

        const langPrefix = `[${langLabel} voice],`;
        const ensureLangPrefix = (s) => s.startsWith(`[${langLabel}`) ? s : `${langPrefix} ${s}`;

        if (!dialogue) {
          // Cảnh không có thoại — giữ yên tĩnh
          let cleaned = base.replace(/^\[[^\]]*\bvoice\b[^\]]*\],?\s*/i, '');
          cleaned = cleaned.replace(/,?\s*spoken audio only\s*$/i, '');
          cleaned = cleaned.replace(/,?\s*no dialogue text overlay,?\s*spoken audio only\s*$/i, '');
          if (!cleaned.includes('no speech')) cleaned = `${cleaned}, ${silentSuffix}`;
          return cleaned;
        }

        // Có thoại — ép ngôn ngữ được chọn
        if (base.includes(dialogue)) {
          const withSuffix = base.includes('no on-screen text') ? base : `${base}, ${noTextSuffix}`;
          return ensureLangPrefix(withSuffix);
        }
        // Fallback — gắn thoại + ngôn ngữ rõ ràng vào prompt
        return `${langPrefix} ${base}, character speaks ${langLabel}: "${dialogue}", spoken audio only, ${noTextSuffix}`;
      };

      // ── Build per-character voice map ────────────────────────────────────────
      const charVoiceMap = {};
      const charIds_ordered = [...charMap.keys()]; // ordered by appearance
      const usedVoices = new Set();
      charIds_ordered.forEach((charId, idx) => {
        const slot = charVoices[idx] ?? '';
        if (!slot) return;
        if (slot === 'random') {
          // Lấy mô tả nhân vật từ charMap để phát hiện giới tính
          const cdata = charMap.get(charId);
          const desc = typeof cdata === 'object' ? `${cdata.name || ''} ${cdata.description || ''}` : (cdata || '');
          const gender = detectCharGender(charId, desc);
          const picked = pickVoiceByGender(gender, usedVoices);
          if (picked) { charVoiceMap[charId] = picked; usedVoices.add(picked); }
        } else {
          charVoiceMap[charId] = slot; usedVoices.add(slot);
        }
      });
      if (Object.keys(charVoiceMap).length > 0)
        addLog(`🎙️ Voice: ${Object.entries(charVoiceMap).map(([k, v]) => `${k}→${v}`).join(', ')}`, 'info');

      // ── 4. Generate Videos ───────────────────────────────────────────────────
      setActive('video'); setActiveTab('video');

      // Global DNA pool check — bao gồm cả nhân vật lẫn bối cảnh
      const globalMediaIds = Object.values(charMediaMap).filter(Boolean);
      const globalImgPaths = Object.values(charImgMap).filter(Boolean);
      const hasDnaPool = globalMediaIds.length > 0 || globalImgPaths.length > 0
        || Object.values(envMediaMap).some(Boolean) || Object.values(envImgMap).some(Boolean);

      const langInfo = langLabel ? `ngôn ngữ: ${langLabel}` : 'không thoại';

      // ── Dedup parsedScenes theo scene_id trước khi tạo task ──
      const dedupedScenes = (() => {
        const seenIds = new Set();
        const result = [];
        for (const sc of parsedScenes) {
          if (!seenIds.has(sc.scene_id)) { seenIds.add(sc.scene_id); result.push(sc); }
        }
        if (result.length < parsedScenes.length)
          addLog(`⚠️ Loại bỏ ${parsedScenes.length - result.length} cảnh trùng scene_id trước khi tạo video`, 'info');
        return result;
      })();
      const filterUnsent4 = makeSubmitGuard();

      addLog(`[Veo] Tạo ${dedupedScenes.length} video · Ingredients · ${langInfo} · DNA pool: ${globalImgPaths.length} ảnh / ${globalMediaIds.length} UUID...`, 'info');

      const MAX_FIRST_RETRY_U2V  = 5;
      const MAX_GLOBAL_RETRY_U2V = 20;
      const veoTaskMap = new Map();
      const orderedVPaths = new Array(dedupedScenes.length).fill(null);

      // ── Smart DNA selector — prompt-aware, priority-based, max 6 ─────────────
      // P1=nhân vật cảnh (speaking first) → P2=bối cảnh cảnh → P3=nhân vật trong prompt
      //   → P4=bối cảnh trong prompt → P5=random fill
      const selectDNAForScene = (scene, prompt) => {
        const MAX = 6;
        const promptLow = (prompt || '').toLowerCase();
        const picked = [];
        const seen = new Set();

        const tryAdd = (id, type) => {
          if (seen.has(id) || picked.length >= MAX) return;
          const mediaId = type === 'char' ? charMediaMap[id] : envMediaMap[id];
          const imgPath  = type === 'char' ? charImgMap[id]  : envImgMap[id];
          if (!mediaId && !imgPath) return;
          seen.add(id);
          picked.push({ id, type, mediaId, imgPath });
        };

        // P1: character_lock — nhân vật speaking (có voice) lên trước
        const charLockArr = Array.isArray(scene.character_lock) ? scene.character_lock : [];
        [...charLockArr]
          .sort((a, b) => (charVoiceMap[b?.id] ? 1 : 0) - (charVoiceMap[a?.id] ? 1 : 0))
          .forEach(c => { if (c?.id) tryAdd(c.id, 'char'); });

        // P2: bối cảnh chính của cảnh
        const bg = scene.background;
        if (bg && typeof bg === 'object' && bg.id) tryAdd(bg.id, 'env');

        // P3: nhân vật được nhắc tới trong prompt (theo tên hoặc id)
        if (picked.length < MAX) {
          [...new Set([...Object.keys(charMediaMap), ...Object.keys(charImgMap)])]
            .filter(id => !seen.has(id))
            .forEach(id => {
              const d = charMap?.get?.(id);
              const name = (typeof d === 'object' ? d?.name : d) || '';
              const idNorm = id.toLowerCase().replace(/_/g, ' ');
              const nmNorm = name.toLowerCase();
              if (
                (idNorm.length > 2 && promptLow.includes(idNorm)) ||
                (nmNorm.length > 2 && promptLow.includes(nmNorm)) ||
                nmNorm.split(/\s+/).filter(w => w.length > 3).some(w => promptLow.includes(w))
              ) tryAdd(id, 'char');
            });
        }

        // P4: bối cảnh được nhắc tới trong prompt
        if (picked.length < MAX) {
          [...new Set([...Object.keys(envMediaMap), ...Object.keys(envImgMap)])]
            .filter(id => !seen.has(id))
            .forEach(id => {
              const norm = id.replace(/^env_/, '').toLowerCase().replace(/_/g, ' ');
              if (norm.split(/\s+/).filter(w => w.length > 3).some(w => promptLow.includes(w)))
                tryAdd(id, 'env');
            });
        }

        // Ưu tiên UUID (đã upload) hơn local path
        const withMedia = picked.filter(e => e.mediaId);
        const withPath  = picked.filter(e => !e.mediaId && e.imgPath);
        return withMedia.length > 0
          ? { mediaIds: withMedia.map(e => e.mediaId), imgPaths: [], labels: withMedia.map(e => e.id) }
          : { mediaIds: [], imgPaths: withPath.map(e => e.imgPath), labels: withPath.map(e => e.id) };
      };

      let pendingTasks = dedupedScenes.map((scene, i) => {
        const tid = `vid_${i}`;
        veoTaskMap.set(tid, i);

        // Collect scene-specific data
        const charLockArr  = Array.isArray(scene.character_lock) ? scene.character_lock : [];
        const sceneCharIds = charLockArr.map(c => c?.id).filter(Boolean);

        const prompt = applyVeoPolicy(stripProminentPeople(buildU2VPrompt(scene)));
        const task = { id: tid, prompt };

        // ── Smart DNA selection — prompt-aware, max 6 ────────────────────────────
        // P1: nhân vật nói (voice) → 1 ảnh + giọng (Veo phát audio cho nhân vật này)
        // P2+: selectDNAForScene → chọn thông minh theo prompt, nhân vật cảnh, bối cảnh
        const speakChar = sceneCharIds.find(id => charVoiceMap[id] && (charMediaMap[id] || charImgMap[id]));

        if (speakChar) {
          task.voiceId = charVoiceMap[speakChar];
          if (charMediaMap[speakChar]) task.ingredientMediaIds = [charMediaMap[speakChar]];
          else                         task.ingredientImages   = [charImgMap[speakChar]];
          addLog(`[Veo] Cảnh ${i + 1}: 🎙️ ${speakChar} (${task.voiceId}) + Ingredients`, 'info');
        } else if (hasDnaPool) {
          const dna = selectDNAForScene(scene, prompt);
          if (dna.mediaIds.length > 0) {
            task.ingredientMediaIds = dna.mediaIds;
            addLog(`[Veo] Cảnh ${i + 1}: 🖼️ [${dna.labels.join(', ')}] → ${dna.mediaIds.length} DNA`, 'info');
          } else if (dna.imgPaths.length > 0) {
            task.ingredientImages = dna.imgPaths;
            addLog(`[Veo] Cảnh ${i + 1}: 🖼️ [${dna.labels.join(', ')}] → ${dna.imgPaths.length} DNA ảnh`, 'info');
          } else {
            addLog(`[Veo] Cảnh ${i + 1}: ⚠️ không có DNA phù hợp → text-to-video`, 'info');
          }
        } else {
          addLog(`[Veo] Cảnh ${i + 1}: ⚠️ không có DNA → text-to-video`, 'info');
        }

        return task;
      });

      // Dedup prompt trùng trước khi gửi lần đầu
      pendingTasks = dedupTasksByPrompt(pendingTasks, addLog);

      // ── Helper: 1 vòng retry, tham số maxRetry ───────────────────────────
      const u2vPolicySet = new Set();
      const u2vTaskErrorMap = new Map();
      const runU2VVeoPass = async (passLabel, maxRetry) => {
        const filterPass = makeSubmitGuard();
        for (let attempt = 1; attempt <= maxRetry && pendingTasks.length > 0; attempt++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          if (attempt > 1) { addLog(`${passLabel}[Veo] Thử lại lần ${attempt}/${maxRetry}: ${pendingTasks.length} video...`, 'info'); await sleep(10000); }
          const safeTasks = filterPass(pendingTasks, addLog);
          if (!safeTasks.length) break;
          const vr = await window.electronAPI.runVeo({
            mediaType: 'Video', tasks: safeTasks,
            aspectRatio: ratio, model: vidMdl, genCount: '1x', quality: vidQuality,
            outputFolder: vidDir, duration: '8s',
          });
          const files = vr?.files || [];
          const succeeded   = files.filter(f => !f.isError && f.filePath);
          const failedFiles = files.filter(f => f.isError);
          const failedIds   = new Set(failedFiles.map(f => f.id));
          succeeded.forEach(f => { const idx = veoTaskMap.get(f.id) ?? 0; orderedVPaths[idx] = f.filePath; });
          if (succeeded.length > 0) addLog(`✅ ${passLabel}[Veo] Lần ${attempt}: ${succeeded.length}/${safeTasks.length} thành công`, 'success');
          for (const ff of failedFiles) {
            if (ff.error) u2vTaskErrorMap.set(ff.id, ff.error);
            if (isPolicyViolation(ff.error)) { u2vPolicySet.add(ff.id); addLog(`🚫 [Chính sách Veo] Vi phạm: "${(ff.error||'').slice(0,80)}" → đổi prompt`, 'error'); }
          }
          pendingTasks = safeTasks.filter(t => failedIds.has(t.id)).map(t => {
            const ni = `${t.id}_r${attempt}`;
            veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
            if (u2vTaskErrorMap.has(t.id)) { u2vTaskErrorMap.set(ni, u2vTaskErrorMap.get(t.id)); u2vTaskErrorMap.delete(t.id); }
            if (u2vPolicySet.has(t.id)) { u2vPolicySet.delete(t.id); u2vPolicySet.add(ni); const cp = sanitizePrompt(t.prompt); addLog(`🔧 Prompt làm sạch: "${cp.slice(0,70)}..."`, 'info'); return { ...t, id: ni, prompt: cp }; }
            return { ...t, id: ni };
          });
          if (pendingTasks.length > 0 && attempt < maxRetry) addLog(`⚠️ ${passLabel}[Veo] ${pendingTasks.length} video lỗi → chờ 10s...`, 'error');
        }
      };

      // Vòng chính — 3 lần
      addLog(`📋 Tạo ${pendingTasks.length} video — thử ${MAX_FIRST_RETRY_U2V} lần/task`, 'info');
      await runU2VVeoPass('', MAX_FIRST_RETRY_U2V);

      // ── AI Prompt Fix loop — viết lại prompt rồi retry, lặp tối đa 10 vòng ──
      const MAX_AI_FIX_ROUNDS = 10;
      for (let aiRound = 1; aiRound <= MAX_AI_FIX_ROUNDS && pendingTasks.length > 0; aiRound++) {
        if (stopRef.current) throw new Error('Đã dừng.');
        addLog(`\n🤖 ════ AI PROMPT FIX [${aiRound}/${MAX_AI_FIX_ROUNDS}] ════ Viết lại ${pendingTasks.length} prompt thất bại...`, 'info');
        const aiCfg = { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel, geminiModel: _atvGeminiModel };
        const fixedTasks = [];
        for (const t of pendingTasks) {
          const errMsg = u2vTaskErrorMap.get(t.id) || '';
          try {
            const rewritten = await rewritePromptForVeo(t.prompt, errMsg, aiCfg);
            if (rewritten && rewritten.length > 20) {
              const ni = `${t.id}_ai${aiRound}`;
              veoTaskMap.set(ni, veoTaskMap.get(t.id));
              fixedTasks.push({ ...t, id: ni, prompt: rewritten });
              addLog(`  ✏️ [${aiRound}] Viết lại: "${rewritten.slice(0, 70)}..."`, 'info');
            } else { fixedTasks.push(t); }
          } catch { fixedTasks.push(t); }
        }
        pendingTasks = fixedTasks;
        addLog(`  ▶ Retry ${pendingTasks.length} video với prompt đã sửa...`, 'info');
        await runU2VVeoPass(`[AI-Fix ${aiRound}]`, 3);
        if (pendingTasks.length === 0)
          addLog(`✅ AI Prompt Fix hoàn tất ở vòng ${aiRound}!`, 'success');
        else
          addLog(`⚠️ [AI-Fix ${aiRound}] Còn ${pendingTasks.length} video lỗi → thử vòng tiếp...`, 'error');
      }
      // Policy Repair (với aiConfig để Level 0 AI hoạt động)
      if (pendingTasks.length > 0) {
        addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair (AI + rule-based)...`, 'error');
        const rpMap = new Map(pendingTasks.map(t => [t.id, veoTaskMap.get(t.id)]));
        const aiCfg = { aiMode, apiKeys, claudeKey, claudeModel, groqKeys, groqModel, geminiModel: _atvGeminiModel };
        await runPolicyRepairLoop(pendingTasks, rpMap, orderedVPaths,
          async (task) => window.electronAPI.runVeo({ mediaType:'Video', tasks:[task], aspectRatio:ratio, model:vidMdl, genCount:'1x', quality:vidQuality, outputFolder:vidDir, duration:'8s' }),
          addLog, stopRef, aiCfg);
      }

      const sortedVeo = orderedVPaths.filter(Boolean);
      setVideoPaths(sortedVeo);

      if (!sortedVeo.length) throw new Error('Không tạo được video nào sau khi thử lại.');
      addLog(`✅ [Veo] Tạo xong ${sortedVeo.length}/${dedupedScenes.length} video`, 'success');
      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Merge Videos ──────────────────────────────────────────────────────
      setActive('merge'); setActiveTab('merge');
      addLog(`Ghép ${sortedVeo.length} video...`, 'info');

      if (sortedVeo.length >= 2) {
        const outName = `u2v_final_${Date.now()}`;
        const mr = await window.electronAPI.mergeVideo({
          files: sortedVeo, trimStart: 0, trimEnd: 0,
          transition: useTransition ? 'Ngẫu nhiên' : 'Không có',
          outputFolder: vidDir, outputName: outName,
        });
        if (mr?.success && mr?.path) {
          setMergedPath(mr.path);
          addLog(`✅ Ghép video hoàn tất: ${outName}.mp4 (${sortedVeo.length} clip)`, 'success');
        } else {
          addLog(`⚠️ Ghép video lỗi: ${mr?.error || 'unknown'}`, 'error');
        }
      } else if (sortedVeo.length === 1) {
        setMergedPath(sortedVeo[0]);
        addLog('⚠️ Chỉ có 1 video — bỏ qua bước ghép', 'info');
      } else {
        addLog('⚠️ Không có video nào để ghép', 'error');
      }
      markDone('merge');

    } catch (err) {
      const msg = err.message || 'Lỗi không xác định';
      setError(msg); addLog(`❌ ${msg}`, 'error');
      if (activeStep) setErrStep(activeStep);
    } finally {
      setRunning(false);
      setUploading(false);
    }
  };

  const availableTabs = videoMethod === 'extend'
    ? [
        scenes.length > 0 ? { id: 'scenes', label: '📋 Cảnh JSON' } : null,
        extResult          ? { id: 'extend', label: '🔁 Extend Result' } : null,
        extMergedPath      ? { id: 'extMerge', label: '🎬 Video Ghép' } : null,
      ].filter(Boolean)
    : U2V_RESULT_TABS.filter(t => {
        if (t.id === 'scenes') return scenes.length > 0;
        if (t.id === 'dna')    return dnaImgs.length > 0;
        if (t.id === 'video')  return videoPaths.length > 0;
        if (t.id === 'merge')  return !!mergedPath;
        return false;
      });

  const renderResults = () => {
    // ── Extend Chain đang chạy — hiện tiến độ ────────────────────────────────
    if (videoMethod === 'extend' && running && activeStep === 'extend') {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-5 px-8">
          <div className="text-center space-y-1">
            {extProgress.total > 0 && (
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Bước {extProgress.current} / {extProgress.total}
              </p>
            )}
            <p className="text-base font-bold text-cyan-300">{extProgress.phase || '⏳ Đang khởi động Extend Chain...'}</p>
          </div>

          <div className="w-full max-w-md space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[11px] text-slate-500">Render tiến độ</span>
              <span className="text-sm font-black text-cyan-400">{extProgress.stepPct}%</span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-700"
                style={{ width: `${extProgress.stepPct}%` }} />
            </div>
          </div>

          {extProgress.total > 0 && (
            <div className="flex gap-2 items-center flex-wrap justify-center">
              {Array.from({ length: extProgress.total }, (_, i) => {
                const sn = i + 1;
                const isDone   = sn < extProgress.current;
                const isActive = sn === extProgress.current;
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black border-2 transition-all',
                      isDone   ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' :
                      isActive ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 animate-pulse' :
                                 'bg-slate-800 border-slate-700 text-slate-600')}>
                      {isDone ? '✓' : sn}
                    </div>
                    <span className="text-[8px] text-slate-600">{sn === 1 ? 'T2V' : `+${sn-1}`}</span>
                  </div>
                );
              })}
            </div>
          )}

          {extProgress.latestFile && (
            <div className="flex flex-col items-center gap-2 w-full max-w-lg">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Video vừa hoàn thành</p>
              <div className="relative rounded-xl overflow-hidden border border-cyan-500/30 w-full bg-black group cursor-pointer"
                onClick={() => { const v = extVidRef.current; if (!v) return; v.paused ? (v.play(), setExtVidPaused(false)) : (v.pause(), setExtVidPaused(true)); }}>
                <video key={extProgress.latestFile} ref={extVidRef}
                  src={toFileUrl(extProgress.latestFile)}
                  className="w-full max-h-[220px] object-contain bg-black"
                  loop muted={extVidMuted}
                  onPlay={() => setExtVidPaused(false)}
                  onPause={() => setExtVidPaused(true)}
                  onLoadedData={e => { e.target.pause(); setExtVidPaused(true); }}
                />
                {extVidPaused && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                      <Play size={22} fill="white" className="text-white ml-1" />
                    </div>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}>
                  <button onClick={() => { const v = extVidRef.current; if (!v) return; v.paused ? (v.play(), setExtVidPaused(false)) : (v.pause(), setExtVidPaused(true)); }}
                    className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                    {extVidPaused ? <Play size={13} fill="currentColor" className="ml-0.5"/> : <Pause size={13} fill="currentColor"/>}
                  </button>
                  <div className="flex-1"/>
                  <button onClick={() => { const n = !extVidMuted; setExtVidMuted(n); if (extVidRef.current) extVidRef.current.muted = n; }}
                    className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                    {extVidMuted ? <VolumeX size={13}/> : <Volume2 size={13}/>}
                  </button>
                </div>
              </div>
              <p className="text-[9px] text-slate-600 font-mono self-start">{extProgress.latestFile.split(/[\\/]/).pop()}</p>
            </div>
          )}
        </div>
      );
    }

    if (!availableTabs.length) return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <Link size={32} className="text-slate-700" />
        <p className="text-xs text-slate-700">Kết quả sẽ hiển thị ở đây khi pipeline chạy</p>
      </div>
    );

    if (activeTab === 'scenes') return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <span className="text-xs font-bold text-slate-400">{scenes.length} cảnh Mode 6</span>
          <button onClick={() => { navigator.clipboard.writeText(rawMode6); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-[10px] text-slate-300 transition-colors">
            {copied ? <Check size={11} className="text-emerald-400"/> : <Copy size={11}/>} Copy JSON
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {scenes.map((sc, i) => (
            <div key={i} className="bg-[#0d1322] border border-slate-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-black text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">Cảnh {sc.scene_id}</span>
                <span className="text-[9px] text-violet-400">{sc.duration_sec}s</span>
                {sc.title && <span className="text-[9px] text-slate-500 truncate">{sc.title}</span>}
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed line-clamp-2">{sc.prompt || sc.action_description}</p>
              {Array.isArray(sc.character_lock) && sc.character_lock.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {sc.character_lock.map((c, ci) => (
                    <span key={c?.id || ci} className="text-[8px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded-full">
                      {c?.name || c?.id || '?'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );

    if (activeTab === 'dna') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-3 shrink-0">
          {dnaImgs.length} Ảnh DNA — {dnaInfos.filter(d=>d.type==='char').length} nhân vật/vật thể · {dnaInfos.filter(d=>d.type==='env').length} bối cảnh
        </p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-3 gap-2">
            {dnaImgs.map((p, i) => {
              const info = dnaInfos[i] || {};
              const typeCls = info.type === 'char' ? 'bg-violet-900/80 text-violet-200' : 'bg-blue-900/80 text-blue-200';
              return (
                <div key={i} className="aspect-square bg-slate-800 rounded-xl overflow-hidden group relative">
                  <img src={toFileUrl(p)} alt={info.name} className="w-full h-full object-cover"/>
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => window.electronAPI?.openFile?.(p)} className="p-1.5 bg-white/20 rounded-lg"><ExternalLink size={11} className="text-white"/></button>
                  </div>
                  <div className={`absolute bottom-1.5 left-1.5 text-[8px] ${typeCls} px-1.5 py-0.5 rounded-full font-bold truncate max-w-[85%]`}>{info.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );

    if (activeTab === 'video') return (
      <div className="h-full flex flex-col">
        <p className="text-xs font-bold text-slate-400 mb-2 shrink-0">{videoPaths.length} Video đã tạo</p>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className={cn('grid gap-1.5', ratio === '16:9' ? 'grid-cols-3' : 'grid-cols-4')}>
            {videoPaths.map((p, i) => (
              <div key={p} className="bg-slate-800/80 rounded-lg overflow-hidden group relative">
                <div className={cn('w-full', ratio === '9:16' ? 'aspect-[9/16]' : ratio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  <video src={toFileUrl(p)} className="w-full h-full object-cover" controls muted loop />
                </div>
                <div className="absolute top-1 left-1 text-[7px] bg-black/75 text-white px-1 py-0.5 rounded-full font-bold leading-none">{i+1}</div>
                <button onClick={() => window.electronAPI?.openFile?.(p)}
                  className="absolute top-1 right-1 p-0.5 bg-black/60 hover:bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={9} className="text-white"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (activeTab === 'extend') return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
        {extResult ? (
          <>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider self-start">Video Extend hoàn chỉnh</p>
            <div className="relative rounded-xl overflow-hidden border border-cyan-500/30 shadow-xl w-full max-w-2xl bg-black group cursor-pointer"
              onClick={() => { const v = extVidRef.current; if (!v) return; v.paused ? (v.play(), setExtVidPaused(false)) : (v.pause(), setExtVidPaused(true)); }}>
              <video key={extResult} ref={extVidRef} src={toFileUrl(extResult)}
                className="w-full max-h-[360px] object-contain bg-black"
                loop muted={extVidMuted}
                onPlay={() => setExtVidPaused(false)} onPause={() => setExtVidPaused(true)}
                onLoadedData={e => { e.target.pause(); setExtVidPaused(true); }}
              />
              {extVidPaused && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Play size={30} fill="white" className="text-white ml-1" />
                  </div>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-4 py-2.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}>
                <button onClick={() => { const v = extVidRef.current; if (!v) return; v.paused ? (v.play(), setExtVidPaused(false)) : (v.pause(), setExtVidPaused(true)); }}
                  className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                  {extVidPaused ? <Play size={15} fill="currentColor" className="ml-0.5"/> : <Pause size={15} fill="currentColor"/>}
                </button>
                <div className="flex-1"/>
                <button onClick={() => { const n = !extVidMuted; setExtVidMuted(n); if (extVidRef.current) extVidRef.current.muted = n; }}
                  className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white">
                  {extVidMuted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 font-mono self-start">{extResult.split(/[\\/]/).pop()}</p>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(extResult)}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : <p className="text-xs text-slate-600">Chưa có kết quả Extend</p>}
      </div>
    );

    if (activeTab === 'extMerge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
        {extMergedPath ? (
          <>
            <div className="flex items-center gap-2 self-start">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-sm font-bold text-emerald-300">Auto Ghép Extend hoàn tất!</span>
            </div>
            <video
              key={extMergedPath}
              src={toFileUrl(extMergedPath)}
              className="w-full max-w-2xl rounded-xl border border-cyan-500/30 bg-black shadow-2xl"
              controls loop
            />
            <p className="text-[10px] text-slate-500 font-mono self-start">{extMergedPath.split(/[\\/]/).pop()}</p>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(extMergedPath)}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl">
                <ExternalLink size={13}/> Mở video ghép
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-40">
            <Wand2 size={32} className="text-cyan-700" />
            <p className="text-xs text-slate-600">Đang chờ Extend Chain hoàn thành...</p>
          </div>
        )}
      </div>
    );

    if (activeTab === 'merge') return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        {mergedPath ? (
          <>
            <div className="w-full max-w-lg bg-slate-800 rounded-2xl overflow-hidden">
              <video src={toFileUrl(mergedPath)} className="w-full" controls autoPlay muted loop />
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-sm font-bold text-emerald-300">Video hoàn chỉnh đã sẵn sàng!</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-colors">
                <ExternalLink size={13}/> Mở video
              </button>
              <button onClick={() => window.electronAPI?.openFolder?.(vidDir)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-colors">
                <FolderOpen size={13}/> Mở thư mục
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">Chưa có video ghép</p>
        )}
      </div>
    );

    return null;
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-y-auto custom-scrollbar bg-[#0a0f1e]">
        <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <Link size={13} className="text-rose-400" />
            <span className="text-xs font-bold text-white">Url to Video</span>
          </div>
          <p className="text-[9px] text-slate-600 mt-0.5">
            {videoMethod === 'extend' ? 'URL → Clone Mode 6 → Extend Chain → Video'
             : 'URL → Clone Mode 6 → DNA → Veo Ingredients 8s → Ghép'}
          </p>
        </div>

        <div className="flex-1 px-4 py-3 space-y-3.5">
          {/* Input mode toggle + URL/Upload */}
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider flex-1">Nguồn video *</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
                <button
                  onClick={() => setInputMode('url')} disabled={running}
                  className={cn('px-2 py-1 text-[9px] font-bold transition-colors',
                    inputMode === 'url' ? 'bg-rose-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300')}>
                  🔗 URL
                </button>
                <button
                  onClick={() => setInputMode('upload')} disabled={running}
                  className={cn('px-2 py-1 text-[9px] font-bold transition-colors',
                    inputMode === 'upload' ? 'bg-rose-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300')}>
                  📁 Upload
                </button>
              </div>
            </div>

            {inputMode === 'url' ? (
              <>
                <textarea value={videoUrl} onChange={e => setVideoUrl(e.target.value)} rows={3}
                  placeholder="https://youtube.com/watch?v=... hoặc TikTok/Douyin URL"
                  disabled={running}
                  className="w-full bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-700 resize-none focus:outline-none focus:border-rose-500/40 transition-colors"/>
                <p className="text-[9px] text-slate-700 mt-0.5">Hỗ trợ: YouTube · TikTok · Douyin</p>
              </>
            ) : (
              <>
                {/* Hidden file input */}
                <input ref={fileInputRef} type="file"
                  accept="video/mp4,video/mov,video/avi,video/webm,video/mkv,video/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) setUploadedFile(f);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running || uploading}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-xl px-3 py-3 text-[10px] font-semibold transition-colors',
                    uploadedFile
                      ? 'border-rose-500/60 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                      : 'border-slate-700/60 bg-slate-800/30 text-slate-500 hover:border-slate-600 hover:text-slate-400',
                  )}>
                  <span className="text-base">📁</span>
                  {uploadedFile ? (
                    <div className="text-left min-w-0">
                      <p className="truncate font-bold text-rose-300">{uploadedFile.name}</p>
                      <p className="text-[8px] text-slate-500">{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB · click để đổi file</p>
                    </div>
                  ) : (
                    <span>Chọn file video từ máy tính</span>
                  )}
                </button>
                {uploadedFile && (
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[9px] text-slate-600">
                      {uploadedFile.size <= 20 * 1024 * 1024
                        ? '✅ ≤20 MB — đọc trực tiếp (nhanh)'
                        : '⬆️ >20 MB — sẽ upload lên Gemini File API'}
                    </p>
                    <button onClick={() => setUploadedFile(null)} disabled={running}
                      className="text-[9px] text-slate-600 hover:text-red-400 transition-colors">✕ xóa</button>
                  </div>
                )}
                <p className="text-[9px] text-slate-700 mt-0.5">Hỗ trợ: MP4 · MOV · AVI · WebM · MKV</p>
              </>
            )}
          </div>

          {/* Phong cách video */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Phong cách video</label>
            <select value={u2vStyle} onChange={e => setU2vStyle(e.target.value)} disabled={running}
              className="w-full mt-1 bg-slate-800/50 border border-amber-500/40 rounded-lg px-2 py-1.5 text-[10px] text-amber-300 font-semibold focus:outline-none focus:border-amber-500/70 transition-colors">
              {U2V_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {u2vStyle === 'default' ? (
              <p className="text-[9px] text-slate-600 mt-0.5 leading-relaxed">
                AI tự phát hiện phong cách từ video gốc và giữ nguyên.
              </p>
            ) : (
              <p className="text-[9px] text-amber-600/70 mt-0.5 leading-relaxed">
                Áp dụng phong cách <span className="font-bold text-amber-400">{U2V_STYLES.find(s=>s.id===u2vStyle)?.label.replace(/^.{2}\s*/,'')}</span> cho mọi cảnh.
              </p>
            )}
          </div>

          {/* Phương thức tạo video */}
          <div>
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Phương thức tạo video</label>
            <div className="flex gap-1 mt-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/40">
              <button onClick={() => setVideoMethod('ingredients')} disabled={running}
                className={cn('flex-1 py-1.5 rounded text-[9px] font-bold transition-colors',
                  videoMethod === 'ingredients' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:text-slate-300')}>
                🎬 Veo
              </button>
              <button onClick={() => setVideoMethod('extend')} disabled={running}
                className={cn('flex-1 py-1.5 rounded text-[9px] font-bold transition-colors',
                  videoMethod === 'extend' ? 'bg-cyan-600 text-white' : 'text-slate-500 hover:text-slate-300')}>
                🔁 Extend
              </button>
            </div>
            <p className="text-[8px] mt-0.5 leading-relaxed">
              {videoMethod === 'extend'
                ? <span className="text-cyan-600/80">Clone Mode 6 → T2V cảnh 1 → Extend Chain cảnh 2, 3…</span>
                : <span className="text-slate-700">Clone Mode 6 → DNA Veo → Ingredients <b>8s</b>/cảnh → Ghép</span>
              }
            </p>
          </div>

          {/* Language + Ratio */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Ngôn ngữ thoại</label>
              <select value={language} onChange={e => setLang(e.target.value)} disabled={running}
                className="w-full mt-1 bg-slate-800/50 border border-rose-500/40 rounded-lg px-2 py-1.5 text-[10px] text-rose-300 font-semibold focus:outline-none focus:border-rose-500/70 transition-colors">
                {LANGUAGES.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tỉ lệ khung hình</label>
              <div className="flex gap-1 mt-1">
                {RATIOS.map(r => (
                  <button key={r} disabled={running} onClick={() => setRatio(r)}
                    className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                      ratio === r ? 'bg-rose-600 border-rose-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {language !== 'none' && (
            <p className="text-[9px] text-rose-600/70 leading-relaxed -mt-1">
              🎙️ Thoại sẽ ép buộc thành <span className="font-bold text-rose-400">{LANGUAGES.find(l=>l.v===language)?.l}</span> trong mọi cảnh video.
            </p>
          )}

          {/* Model AI — tuỳ theo phương thức */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Model AI</label>
            {videoMethod === 'extend' ? (
              <>
                <div>
                  <label className="text-[9px] text-slate-700">Model Veo</label>
                  <select value={extT2vMdl} onChange={e => setExtT2vMdl(e.target.value)} disabled={running}
                    className="w-full mt-0.5 bg-slate-800/50 border border-cyan-500/30 rounded-lg px-2 py-1.5 text-[10px] text-cyan-300 font-semibold focus:outline-none">
                    {VID_MDL.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-slate-700">Thời lượng T2V</label>
                    <div className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-400 text-center font-bold">8s</div>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-700">Chất lượng</label>
                    <select value={extQuality} onChange={e => setExtQuality(e.target.value)} disabled={running}
                      className="w-full mt-0.5 bg-slate-800/50 border border-cyan-500/30 rounded-lg px-2 py-1.5 text-[10px] text-cyan-300 font-semibold focus:outline-none">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-[9px] text-slate-700">Tạo ảnh DNA</label>
                  <select value={imgMdl} onChange={e => setImgMdl(e.target.value)} disabled={running}
                    className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                    {IMG_MDL.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-slate-700">Tạo video (Ingredients 8s)</label>
                  <select value={vidMdl} onChange={e => setVidMdl(e.target.value)} disabled={running}
                    className="w-full mt-0.5 bg-slate-800/50 border border-slate-700/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 focus:outline-none">
                    {VID_MDL.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-slate-700">Chất lượng video</label>
                  <select value={vidQuality} onChange={e => setVidQuality(e.target.value)} disabled={running}
                    className="w-full mt-0.5 bg-slate-800/50 border border-rose-500/40 rounded-lg px-2 py-1.5 text-[10px] text-rose-300 font-semibold focus:outline-none">
                    <option value="720p">720p — Nhanh</option>
                    <option value="1080p">1080p — Upscale (chậm hơn)</option>
                  </select>
                </div>
                {/* Voice Ingredients */}
                <div className="space-y-1 pt-1">
                  <label className="text-[9px] font-semibold text-rose-400">🎙️ Voice Ingredients — Giọng nhân vật</label>
                  <p className="text-[8px] text-slate-600 leading-tight">1 giọng = 1 ảnh nhân vật. Nhân vật không có giọng dùng toàn bộ DNA.</p>
                  {['Nhân vật 1', 'Nhân vật 2', 'Nhân vật 3'].map((label, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 w-16 shrink-0">{label}</span>
                      <select value={charVoices[idx] || ''} onChange={e => { const v = [...charVoices]; v[idx] = e.target.value; setCharVoices(v); }} disabled={running}
                        className="flex-1 bg-slate-800/50 border border-rose-500/30 rounded-lg px-1.5 py-1 text-[9px] text-rose-300 focus:outline-none">
                        {VOICE_LIST.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Folders */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2.5">
            <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Thư mục lưu file</label>
            {videoMethod !== 'extend' && (
              <FolderRow label="Ảnh DNA tham chiếu" value={refDir} onChange={setRefDir} />
            )}
            <FolderRow label="Video xuất ra" value={vidDir} onChange={setVidDir} />
          </div>

          {/* Transition toggle — chỉ dùng cho Ingredients */}
          {videoMethod !== 'extend' && (
            <label className="flex items-center gap-2 cursor-pointer select-none py-1">
              <input type="checkbox" checked={useTransition} onChange={e => setUseTransition(e.target.checked)} disabled={running}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-rose-500" />
              <span className="text-[10px] text-slate-400">Chuyển cảnh ngẫu nhiên khi ghép video</span>
            </label>
          )}
        </div>

        {/* Start/Stop */}
        <div className="px-4 py-3 border-t border-slate-800/80 space-y-2">
          {error && (
            <div className="flex items-start gap-1.5 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0"/>
              <p className="text-[10px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}
          {!running ? (
            <button onClick={handleStart}
              className={cn('w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs shadow-lg',
                videoMethod === 'extend'
                  ? 'bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 shadow-cyan-500/20'
                  : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 shadow-rose-500/20')}>
              <Play size={13} fill="currentColor"/>
              {videoMethod === 'extend' ? 'Bắt đầu · Extend Chain' : inputMode === 'upload' ? 'Bắt đầu · Upload to Video' : 'Bắt đầu · Url to Video'}
            </button>
          ) : (
            <button onClick={handleStop}
              className="w-full bg-red-600/80 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs">
              <Square size={11} fill="currentColor"/>
              {uploading ? '⬆️ Đang upload...' : 'Dừng lại'}
            </button>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080e1a]">
        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Tiến trình tự động</p>
            <span className={cn('text-[8px] font-black px-2 py-0.5 rounded-full',
              videoMethod === 'extend'
                ? 'bg-cyan-500/15 text-cyan-400'
                : 'bg-rose-500/15 text-rose-400')}>
              {videoMethod === 'extend' ? '🔁 Clone Mode 6 · Extend Chain' : '🎬 Clone Mode 6 · Veo Ingredients'}
            </span>
          </div>
          {videoMethod === 'extend' ? (
            <div className="grid grid-cols-3 gap-1.5">
              {STEPS_EXTEND.map(s => <StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-1.5">
              {STEPS_U2V.map(s => <StepBadge key={s.id} step={s} status={stepStatus(s.id)}/>)}
            </div>
          )}
        </div>

        {/* Results tabs + content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {availableTabs.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-800/60">
              {availableTabs.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={cn('px-3 py-1.5 rounded-t-lg text-[10px] font-bold transition-all border-b-2',
                    activeTab === t.id ? 'text-rose-300 border-rose-500' : 'text-slate-600 border-transparent hover:text-slate-400')}>
                  {t.label}
                  {t.id === 'scenes' && scenes.length > 0 && <span className="ml-1 text-[8px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded-full">{scenes.length}</span>}
                  {t.id === 'video'  && videoPaths.length > 0 && <span className="ml-1 text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full">{videoPaths.length}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-hidden px-5 py-4">
            {renderResults()}
          </div>
        </div>

        {/* LOG PANEL */}
        <div className={cn('shrink-0 border-t border-slate-800/80 flex flex-col transition-all', logOpen ? 'h-48' : 'h-9')}>
          <button onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-2 px-5 h-9 shrink-0 hover:bg-slate-800/30 transition-colors">
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">Hệ thống Log</span>
            {running && <span className="ml-auto flex items-center gap-1 text-[9px] text-rose-400"><Loader2 size={9} className="animate-spin"/> Đang chạy...</span>}
            {!running && logs.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setLogs([]); }} className="ml-auto text-[9px] text-slate-700 hover:text-slate-500">Xóa log</button>
            )}
          </button>
          {logOpen && (
            <div ref={logsRef} className="flex-1 overflow-y-auto px-5 pb-2 space-y-0.5 font-mono">
              {logs.length === 0 && <p className="text-[9px] text-slate-700 py-2">Chưa có log...</p>}
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[8px] text-slate-700 shrink-0 mt-0.5 w-14">[{l.time}]</span>
                  <span className={cn('text-[9px] leading-relaxed break-all',
                    l.type === 'error'   && 'text-red-400',
                    l.type === 'success' && 'text-emerald-400',
                    l.type === 'info'    && 'text-slate-500',
                  )}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
// ─── StoryboardPanel ─────────────────────────────────────────────────────────
function StoryboardPanel() {
  const [apiKeys]    = useState(loadKeys);
  const [aiMode,     setAiMode]    = useState('gemini');
  const [claudeKey]  = useState(loadClaudeKey);
  const [claudeModel] = useState(loadClaudeModel);
  const [groqKeys]   = useState(loadGroqKeys);
  const [groqModel]  = useState(loadGroqModel);

  // Input mode
  const [inputMode,    setInputMode]    = useState('idea');
  const [ideaText,     setIdeaText]     = useState('');
  const [scriptText,   setScriptText]   = useState('');

  // Reference images — array of { id, name, base64, mime, label }
  // label: 'character' | 'style' | 'setting' | ''
  const [refImages,      setRefImages]      = useState([]);
  const refImageInputRef = useRef(null);

  // Idea-mode options
  const [platform,  setPlatform]  = useState('YouTube ngang');
  const [language,  setLanguage]  = useState('vi');
  const [style,     setStyle]     = useState('Cinematic 4K');
  const [audience,  setAudience]  = useState(AUDIENCES[0]);
  const [goal,      setGoal]      = useState(GOALS[0]);
  const [tone,      setTone]      = useState(TONES[0]);
  const [sceneDur,  setSceneDur]  = useState(6);
  const [totalMins, setTotalMins] = useState(1);

  // ── Hồ sơ nhân vật — giống Creator Studio ────────────────────────────────
  const emptySbChar = () => ({ id: Date.now() + Math.random(), name: '', gender: 'Nữ', age: '', ethnicity: '', appearance: '', clothing: '', role: '' });
  const [mainChar,  setMainChar]  = useState(() => emptySbChar());
  const [secChars,  setSecChars]  = useState([]);
  const [showChars, setShowChars] = useState(false);
  const addSecChar    = () => { if (secChars.length < 4) setSecChars(p => [...p, emptySbChar()]); };
  const removeSecChar = (id) => setSecChars(p => p.filter(c => c.id !== id));
  const updateSecChar = (id, f, v) => setSecChars(p => p.map(c => c.id === id ? { ...c, [f]: v } : c));
  const hasMainChar   = !!(mainChar.name || mainChar.appearance || mainChar.ethnicity);

  // Settings
  const [outputFolder,  setOutputFolder]  = useState('');
  const [aspectRatio,   setAspectRatio]   = useState('16:9');
  const [imgModel,      setImgModel]      = useState(IMG_MDL[0]);
  const [vidModel,      setVidModel]      = useState(VID_MDL[0]);
  const [duration,      setDuration]      = useState('6s');
  const [videoQuality,  setVideoQuality]  = useState('720p');
  const [useTransition, setUseTransition] = useState(false);


  // UI
  const [extConnected, setExtConnected] = useState(false);
  const [logOpen,      setLogOpen]      = useState(true);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);

  // Pipeline
  const [phase,            setPhase]            = useState('idle');
  const [generatedScript,  setGeneratedScript]  = useState('');
  const [parsedData,       setParsedData]       = useState(null);
  const [voiceMap,         setVoiceMap]         = useState({});
  const [charDnaMap,       setCharDnaMap]       = useState({});  // charId → filePath
  const [dnaJobIdToCharId, setDnaJobIdToCharId] = useState({});  // dna jobId → charId (real-time preview)
  const [sceneJobs,           setSceneJobs]           = useState([]);
  const [mergedPath,          setMergedPath]          = useState(null);
  const [charVoiceOverrides,  setCharVoiceOverrides]  = useState([]); // [voiceId per char index] — 'random'|''|specific id
  const [logs,                setLogs]                = useState([{ time: new Date().toLocaleTimeString(), text: 'Storyboard Studio sẵn sàng', type: 'success' }]);

  const stopRef              = useRef(false);
  const logsEndRef           = useRef(null);
  const outputFolderRef      = useRef('');
  const sceneJobsRef         = useRef([]);
  const dnaJobIdToCharIdRef  = useRef({});

  useEffect(() => { outputFolderRef.current     = outputFolder;      }, [outputFolder]);
  useEffect(() => { sceneJobsRef.current        = sceneJobs;         }, [sceneJobs]);
  useEffect(() => { dnaJobIdToCharIdRef.current = dnaJobIdToCharId;  }, [dnaJobIdToCharId]);
  useEffect(() => { if (PLATFORM_RATIO[platform]) setAspectRatio(PLATFORM_RATIO[platform]); }, [platform]);
  useEffect(() => {
    setDuration(`${sceneDur}s`);
    if (sceneDur !== 8 && videoQuality === '1080p') setVideoQuality('720p');
    if (sceneDur === 10) setVidModel('Omni 1.1 Flash');
  }, [sceneDur]);
  // Khi parsedData thay đổi (sau parse): khởi tạo voice override cho từng nhân vật mới
  // Giữ nguyên giá trị cũ nếu char count không đổi
  useEffect(() => {
    if (!parsedData?.characters?.length) return;
    setCharVoiceOverrides(prev =>
      parsedData.characters.map((_, i) => (prev[i] !== undefined ? prev[i] : 'random'))
    );
  }, [parsedData]);

  useEffect(() => {
    window.electronAPI?.getDownloadsDir?.().then(dir => {
      if (dir) setOutputFolder(dir + '\\Storyboard');
    });
    const checkExt = async () => {
      try {
        const r = await fetch('http://localhost:3000/api/system-status');
        if (r.ok) { const d = await r.json(); setExtConnected(d.extensionConnected); }
      } catch {}
    };
    checkExt();
    const iv = setInterval(checkExt, 5000);


    return () => clearInterval(iv);
  }, []);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(p => [...p.slice(-300), { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // ── Reference images handlers ────────────────────────────────────────────────
  const REF_IMG_LABELS = [
    { v: '',          l: '— Không gán nhãn —' },
    { v: 'character', l: '👤 Nhân vật' },
    { v: 'style',     l: '🎨 Phong cách' },
    { v: 'setting',   l: '🌆 Bối cảnh' },
  ];
  const handleRefImagePick = () => refImageInputRef.current?.click();
  const handleRefImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result   = ev.target.result;
        const commaIdx = result.indexOf(',');
        const b64      = result.slice(commaIdx + 1);
        const mime     = result.slice(5, commaIdx).replace(';base64', '') || 'image/jpeg';
        setRefImages(prev => {
          if (prev.length >= 8) return prev; // max 8
          return [...prev, { id: Date.now() + Math.random(), name: file.name, base64: b64, mime, label: 'character', charName: '' }];
        });
      };
      reader.readAsDataURL(file);
    });
    if (refImageInputRef.current) refImageInputRef.current.value = '';
  };
  const removeRefImage    = (id) => setRefImages(prev => prev.filter(img => img.id !== id));
  const updateRefLabel    = (id, label) => setRefImages(prev => prev.map(img => img.id === id ? { ...img, label } : img));
  const updateRefCharName = (id, charName) => setRefImages(prev => prev.map(img => img.id === id ? { ...img, charName } : img));
  const clearAllRefImages = () => setRefImages([]);

  // VeoLog listener — real-time progress + instant preview on job_success
  useEffect(() => {
    const handler = (data) => {
      const raw   = typeof data.text === 'string' ? data.text : '';
      // Format: [JOBID:xxx]|PATH:/full/path  hoặc  [JOBID:xxx] message
      const match = raw.match(/^\[JOBID:(.+?)\](?:\|PATH:(.+))?(?:\s+([\s\S]*))?/);
      const jobId   = match?.[1];
      const filePath = match?.[2]?.trim() || null;
      const msg     = (match?.[3] || (!match?.[2] ? (raw.replace(/^\[JOBID:[^\]]+\]/, '').trim()) : '')).trim();

      if (data.type === 'progress' && jobId) {
        const pct = parseInt(msg) || 0;
        setSceneJobs(prev => prev.map(j =>
          j.imgJobId === jobId ? { ...j, imgProgress: pct } :
          j.vidJobId === jobId ? { ...j, vidProgress: pct } : j
        ));
        return;
      }

      // Khi 1 job hoàn thành → cập nhật preview ngay, không chờ batch kết thúc
      if (data.type === 'job_success' && jobId && filePath) {
        // DNA job (dna_c...) → update charDnaMap + sceneDnaImgs của tất cả cảnh dùng nhân vật này
        if (jobId.startsWith('dna_c')) {
          const charId = dnaJobIdToCharIdRef.current[jobId];
          if (charId) {
            setCharDnaMap(dm => ({ ...dm, [charId]: filePath }));
            // Cập nhật sceneDnaImgs real-time: thêm ảnh TC vào đúng cảnh
            setSceneJobs(sj => sj.map(j => {
              if (!j.sceneCharIds?.includes(charId)) return j;
              // Loại bỏ path cũ của char này (nếu có placeholder rỗng) rồi thêm path mới
              const filtered = (j.sceneDnaImgs || []).filter(p => p !== filePath);
              return { ...j, sceneDnaImgs: [...filtered, filePath] };
            }));
          }
          return;
        }
        // Scene image / video job
        setSceneJobs(prev => prev.map(j => {
          if (j.imgJobId === jobId) return { ...j, imgStatus: 'done', imgPath: filePath, imgProgress: 100 };
          if (j.vidJobId === jobId) return { ...j, vidStatus: 'done', vidPath: filePath, vidProgress: 100 };
          return j;
        }));
        return;
      }

      if (data.type === 'job_fail' && jobId) {
        setSceneJobs(prev => prev.map(j => {
          if (j.imgJobId === jobId) return { ...j, imgStatus: 'error' };
          if (j.vidJobId === jobId) return { ...j, vidStatus: 'error' };
          return j;
        }));
        return;
      }

      if (!['progress', 'job_start', 'job_success', 'job_fail'].includes(data.type) && msg)
        addLog(msg, data.type === 'error' ? 'error' : data.type === 'success' ? 'success' : 'info');
    };
    const _w = window.electronAPI?.onVeoLog?.(handler);
    return () => { if (_w) window.electronAPI?.removeListener?.('veo-log', _w); };
  }, [addLog]);

  // ── Build image prompt per scene ─────────────────────────────────────────────
  const buildImagePrompt = (scene, parsed) => {
    const artStyle      = parsed.art_style || 'Cinematic quality, photorealistic, 8K';
    const settingAnchor = parsed.setting_anchor || '';
    const shots         = scene.shots || [];

    // ── Style lock: ép cứng phong cách, không cho AI tự sáng tạo style khác ──
    const styleLock = `MANDATORY ART STYLE — strictly follow exactly: ${artStyle}. Do NOT switch to 3D render, photorealism, or any other style. Every element must match this art style precisely.`;

    // ── Chỉ lấy nhân vật XUẤT HIỆN trong cảnh này, nhúng desc đầy đủ + hard lock vào prompt ──
    const sceneCharIds  = scene.characters_in_scene || [];
    const sceneChars    = (parsed.characters || []).filter(c => sceneCharIds.includes(c.id));
    let charBlock = '';
    let charReminder = ''; // compact per-panel anchor: ethnicity + hair
    if (sceneChars.length > 0) {
      const descs = sceneChars.map(c =>
        `CHARACTER "${c.name}" [ABSOLUTE LOCK — ZERO DEVIATION ALLOWED]: ${c.desc}. ` +
        `MANDATORY RULE 1 — HAIR: replicate EXACT same hair color, length, and texture from DNA reference portrait (if DNA shows dark/black/brown hair → DO NOT generate blonde, light, or grey hair — this is forbidden). ` +
        `MANDATORY RULE 2 — FACE: replicate EXACT same facial structure, skin tone, and ethnic features as DNA reference (DO NOT change ethnicity, face shape, or skin tone). ` +
        `MANDATORY RULE 3 — CLOTHING: replicate EXACT same garment type and colors as described (DO NOT substitute or redesign). ` +
        `Character must be visually IDENTICAL to the uploaded DNA reference portrait.`
      ).join(' ');
      charBlock = `=== CHARACTER APPEARANCE LOCK (ABSOLUTE — NO MODIFICATIONS PERMITTED) === ${descs} ===`;

      // Build compact per-panel reminder: extract ethnicity sentence + hair hint from desc
      const snippets = sceneChars.map(c => {
        const d = c.desc || '';
        // First sentence typically = "[Name] is a [ethnicity] in their [age]."
        const ethSentence = d.split(/[.!?]\s+/)[0].replace(/^['"]+|['"]+$/g, '').trim();
        // Extract HAIR section: "HAIR: jet-black shoulder-length straight hair"
        const hairM = d.match(/HAIR:\s*([\w-]+(?:\s+[\w-]+){0,5})/i);
        const hairHint = hairM ? `, ${hairM[1].trim()} hair` : '';
        return `${c.name}(${ethSentence}${hairHint})`;
      });
      charReminder = `[EXACT SAME CHARACTER${sceneChars.length > 1 ? 'S' : ''} — DO NOT CHANGE ETHNICITY/FACE/HAIR: ${snippets.join(' & ')}] `;
    }

    // ── Setting ──
    const settingBlock = settingAnchor ? `SETTING: ${settingAnchor}` : '';

    // ── Ghép base ──
    const base = [styleLock, charBlock, settingBlock].filter(Boolean).join(' ');

    const n = shots.length;
    // Helper: prepend charReminder to each shot action so every panel independently anchors the character
    const pA = (shot) => `${charReminder}${shot.action}`;

    if (n === 1) {
      // 1 shot → single cinematic frame
      return `${base} Shot (${shots[0].type}): ${pA(shots[0])}. Cinematic composition, high detail, full scene visible.`;

    } else if (n === 2) {
      // 2 shots → 1×2 horizontal strip
      return `A single image: 1×2 horizontal storyboard strip, two equal panels LEFT | RIGHT, thin black border (4px), no text/labels. ${base} PANEL LEFT (${shots[0].type}): ${pA(shots[0])}. PANEL RIGHT (${shots[1].type}): ${pA(shots[1])}. Identical character appearance and art style across both panels.`;

    } else if (n === 3) {
      // 3 shots → 1×3 horizontal strip
      return `A single image: 1×3 horizontal storyboard strip, three equal panels LEFT | CENTER | RIGHT, thin black borders (4px), no text/labels/numbers. ${base} PANEL LEFT (${shots[0].type}): ${pA(shots[0])}. PANEL CENTER (${shots[1].type}): ${pA(shots[1])}. PANEL RIGHT (${shots[2].type}): ${pA(shots[2])}. Identical character appearance, proportions, clothing across all panels.`;

    } else if (n === 4) {
      // 4 shots → 2×2 grid
      return `A single image: 2×2 grid storyboard of four equal panels, thin black borders (4px), no text/labels/numbers. ${base} TOP-LEFT (${shots[0].type}): ${pA(shots[0])}. TOP-RIGHT (${shots[1].type}): ${pA(shots[1])}. BOTTOM-LEFT (${shots[2].type}): ${pA(shots[2])}. BOTTOM-RIGHT (${shots[3].type}): ${pA(shots[3])}. All four panels share identical character appearance, proportions, clothing and art style.`;

    } else {
      // 5 shots → top row 3 panels + bottom row 2 panels centered
      const s = shots.slice(0, 5);
      return `A single image: storyboard layout with 5 panels — top row: 3 equal panels (LEFT, CENTER, RIGHT), bottom row: 2 equal panels (CENTER-LEFT, CENTER-RIGHT) centered below, thin black borders (4px), no text/labels/numbers. ${base} TOP-LEFT (${s[0].type}): ${pA(s[0])}. TOP-CENTER (${s[1].type}): ${pA(s[1])}. TOP-RIGHT (${s[2].type}): ${pA(s[2])}. BOTTOM-LEFT (${s[3].type}): ${pA(s[3])}. BOTTOM-RIGHT (${s[4].type}): ${pA(s[4])}. All five panels share identical character appearance, proportions, clothing and art style.`;
    }
  };

  // ── Build video motion prompt ──
  // QUAN TRỌNG: Ingredients API dùng ảnh làm VISUAL REFERENCE, không phải start frame.
  // KHÔNG được dùng từ "storyboard/panel/strip" — Veo sẽ render ảnh storyboard đóng băng.
  // Phải mô tả CẢNH QUAY cinematic để Veo tạo ra motion thực sự.
  const buildVideoPrompt = (scene, parsed) => {
    const LANG_EN = {
      vi: 'Vietnamese', en: 'English', ja: 'Japanese', zh: 'Chinese',
      ko: 'Korean', fr: 'French', es: 'Spanish', de: 'German', th: 'Thai',
    };
    const langLabel    = LANG_EN[language] || 'Vietnamese';
    const noTextSuffix = 'No text overlay, no captions, no subtitles, no watermarks.';
    const silentSuffix = 'Natural ambient sounds only. No dialogue, no narration.';

    // Unique scene ID — tránh 2 cảnh trùng prompt
    const sceneId = `[SCENE ${scene.sceneNum || '?'} — "${scene.title || scene.id || ''}"]`;

    // Style lock
    const artStyle  = parsed?.art_style || 'Cinematic quality, photorealistic, 8K';
    const styleLock = `Art style: ${artStyle}.`;

    // Character reference — chỉ mô tả diện mạo để Veo giữ nhất quán, KHÔNG dùng từ "storyboard"
    const sceneCharIds = scene.characters_in_scene || [];
    const sceneChars   = (parsed?.characters || []).filter(c => sceneCharIds.includes(c.id));
    let charBlock    = '';
    let charReminder = '';
    if (sceneChars.length > 0) {
      const descs = sceneChars.map(c =>
        `${c.name}: ${c.desc}. Keep appearance IDENTICAL to reference image — same ethnicity, hair, face, skin tone, clothing.`
      ).join(' ');
      charBlock = `Characters: ${descs}`;
      const snippets = sceneChars.map(c => {
        const d = c.desc || '';
        const ethSentence = d.split(/[.!?]\s+/)[0].replace(/^['"]+|['"]+$/g, '').trim();
        const hairM = d.match(/HAIR:\s*([\w-]+(?:\s+[\w-]+){0,5})/i);
        const hairHint = hairM ? `, ${hairM[1].trim()} hair` : '';
        return `${c.name}(${ethSentence}${hairHint})`;
      });
      charReminder = `[${snippets.join(' & ')}] `;
    }

    // Setting
    const settingBlock = parsed?.setting_anchor ? `Setting: ${parsed.setting_anchor}.` : '';

    // ── Shots: mô tả hành động + camera motion ── (KHÔNG dùng "panel/strip/storyboard")
    const shots = scene.shots || [];
    const shotDescs = shots.map((s, i) => {
      const t = (s.type || '').toLowerCase();
      let camMotion = 'cinematic subtle camera motion';
      if (t.includes('pan'))                                        camMotion = 'slow horizontal pan';
      else if (t.includes('zoom'))                                  camMotion = 'slow zoom in';
      else if (t.includes('tilt'))                                  camMotion = 'gentle tilt';
      else if (t.includes('track'))                                 camMotion = 'smooth tracking shot';
      else if (t.includes('bird'))                                  camMotion = "bird's-eye view descending";
      else if (t.includes('dutch'))                                 camMotion = 'dutch angle tilt';
      else if (t.includes('pov'))                                   camMotion = 'first-person POV';
      else if (t.includes('wide') || t.includes('ws') || t.includes('ews')) camMotion = 'wide shot with subtle drift';
      else if (t.includes('close') || t.includes('cu') || t.includes('ecu')) camMotion = 'close-up push in';
      else if (t.includes('crane') || t.includes('dolly'))         camMotion = 'smooth crane/dolly';
      const label = shots.length > 1 ? `Shot ${i + 1} (${s.type})` : s.type;
      return `${label}: ${charReminder}${s.action}. Camera: ${camMotion}.`;
    });
    const motionBlock = shotDescs.join(' ');

    // Dialogue / Audio — cleanDialogueText loại bỏ stutter/lặp trước khi đưa vào TTS
    const dialogue = scene.hasDialogue ? cleanDialogueText(scene.dialogue || '') : '';
    const hasVoice = dialogue && language !== 'none';

    const base = [sceneId, styleLock, charBlock, settingBlock].filter(Boolean).join(' ');

    if (!hasVoice) {
      return `Cinematic scene. ${base} ${motionBlock} ${silentSuffix} ${noTextSuffix}`.trim();
    }

    const audioBlock =
      `[SPOKEN DIALOGUE — ${langLabel.toUpperCase()} AUDIO]: ` +
      `Character speaks ${langLabel}: "${dialogue.slice(0, 200)}". ` +
      `Generate clear ${langLabel} spoken voice. Lip movement synced to speech.`;

    return `Cinematic scene with ${langLabel} spoken dialogue. ${base} ${motionBlock} ${audioBlock} ${noTextSuffix}${SPEECH_ANTI_REPEAT}`.trim();
  };

  // ── Full auto pipeline ───────────────────────────────────────────────────────
  const handleRunAll = async () => {
    if (!extConnected) return alert('Chưa kết nối Extension! Mở Google Labs và F5.');
    if (!outputFolder) return alert('Chọn thư mục lưu file trước!');
    if (aiMode === 'gemini' && !apiKeys.length) return alert('Chưa có Gemini API Key! Vào Settings → API Key để thêm.');
    if (aiMode === 'claude' && !claudeKey)      return alert('Chưa có Claude API Key! Vào Settings → API Key → Claude để thêm.');
    if (aiMode === 'groq'   && !groqKeys.length) return alert('Chưa có Groq API Key! Vào Settings → API Key → Groq để thêm.');
    if (inputMode === 'idea'   && !ideaText.trim())   return alert('Nhập ý tưởng trước!');
    if (inputMode === 'script' && !scriptText.trim()) return alert('Nhập kịch bản trước!');

    stopRef.current = false;
    setParsedData(null);
    setCharDnaMap({});
    setDnaJobIdToCharId({});
    setSceneJobs([]);
    setMergedPath(null);

    try {
      // ── 0. Phân tích ảnh tham chiếu TRƯỚC — kết quả inject vào script generation ─
      let refAnalysis = null;
      let resizedRefImages = []; // ảnh đã nén, dùng lại cho Step 2
      if (refImages.length > 0) {
        setPhase('parse');
        addLog(`🔍 Phân tích ${refImages.length} ảnh tham chiếu trước khi tạo kịch bản...`, 'info');

        const labelNames = { character: 'Nhân vật', style: 'Phong cách', setting: 'Bối cảnh', '': 'Tham chiếu chung' };
        const imgListText = refImages.map((img, i) => {
          const nameTag = img.charName?.trim() ? ` — Tên: "${img.charName.trim()}"` : '';
          return `Image ${i + 1}: "${img.name}" [${labelNames[img.label] || 'Tham chiếu chung'}]${nameTag}`;
        }).join('\n');

        const ANALYZE_PROMPT_EARLY = `You are a professional visual designer and character artist. Analyze ALL provided reference images carefully and output ONLY valid JSON (no markdown fences, no extra text).

Images provided (${refImages.length} total):
${imgListText}

IMPORTANT: If an image has a "Tên:" (name) tag, use EXACTLY that name as "suggestedName". Otherwise infer from visual cues.

Output this exact JSON structure:
{
  "characters": [
    {
      "imageIndex": 0,
      "suggestedName": "Use the provided name if given, otherwise infer from appearance",
      "gender": "male/female/unknown",
      "ethnicity": "specific ethnicity",
      "ageRange": "age range",
      "hair": "exact color, length, style",
      "skinTone": "exact skin tone",
      "faceShape": "face shape description",
      "eyes": "eye color and shape",
      "build": "body build",
      "clothing": "exact clothing description with colors",
      "accessories": "accessories or none",
      "distinctiveFeatures": "any unique features"
    }
  ],
  "settings": [
    {
      "imageIndex": 0,
      "description": "detailed setting description",
      "timeOfDay": "time of day",
      "colorPalette": "dominant colors"
    }
  ],
  "artStyle": {
    "renderStyle": "art style",
    "colorGrading": "color grading",
    "lightingStyle": "lighting",
    "visualTone": "visual tone",
    "referenceDescription": "overall style summary"
  },
  "summary": "Brief summary of all reference images"
}`;

        // Groq không hỗ trợ ảnh → KHÔNG dùng Gemini, bỏ qua hoàn toàn
        const canVision = aiMode === 'groq' ? false : aiMode === 'claude' ? !!claudeKey : apiKeys.length > 0;
        if (!canVision) {
          addLog(`⚠️ ${aiMode === 'groq' ? 'Groq không hỗ trợ vision — bỏ qua phân tích ảnh, vẫn dùng ảnh làm DNA' : 'Không có API key'} — bỏ qua phân tích ảnh tham chiếu`, 'warn');
        } else {
        try {
          // Resize ảnh xuống ≤800px để tránh vượt giới hạn payload Gemini (inline data limit)
          const resizeBase64 = (base64, mime, maxPx = 800) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
              const w = Math.round(img.width * scale);
              const h = Math.round(img.height * scale);
              const canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              const out = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
              resolve({ base64: out, mime: 'image/jpeg' });
            };
            img.onerror = () => resolve({ base64, mime }); // fallback ảnh gốc nếu lỗi
            img.src = `data:${mime};base64,${base64}`;
          });

          addLog(`🖼️ Đang nén ${refImages.length} ảnh tham chiếu trước khi phân tích...`, 'info');
          const resizedImgs = await Promise.all(refImages.map(img => resizeBase64(img.base64, img.mime)));
          resizedRefImages = resizedImgs; // lưu lại để Step 2 dùng

          const analyzeParts = resizedImgs.map(img => ({ inlineData: { mimeType: img.mime, data: img.base64 } }));
          analyzeParts.push({ text: ANALYZE_PROMPT_EARLY });

          // Thử tối đa tất cả key, dừng ngay khi thành công hoặc gặp lỗi không phải 429
          const analyzeRaw = aiMode === 'claude'
            ? await callClaudeVision({ apiKey: claudeKey, model: claudeModel, system: 'Output ONLY valid JSON.', images: resizedImgs.map(img => ({ base64: img.base64, mime: img.mime })), prompt: ANALYZE_PROMPT_EARLY, maxTokens: 4096, temperature: 0 })
            : await (async () => {
                let lastErr;
                for (let i = 0; i < apiKeys.length; i++) {
                  // Thử 2.5-flash trước, fallback 2.0-flash nếu không hỗ trợ
                  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
                  let res, t;
                  for (const model of models) {
                    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKeys[i]}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ contents: [{ parts: analyzeParts }] }),
                    });
                    if (res.ok || res.status !== 404) break; // 404 = model không tồn tại → thử model kế
                  }
                  if (res.ok) {
                    const d = await res.json();
                    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  }
                  t = await res.text();
                  const is429 = res.status === 429 || t.includes('quota') || t.includes('RESOURCE_EXHAUSTED');
                  const is503 = res.status === 503 || t.includes('high demand') || t.includes('overloaded') || t.includes('unavailable');
                  lastErr = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
                  if (!is429 && !is503) throw lastErr; // lỗi payload/cấu trúc → dừng ngay
                  const reason = is429 ? 'hết quota' : 'quá tải';
                  if (i < apiKeys.length - 1) addLog(`🔄 Key #${i + 1} ${reason} — thử key #${i + 2}...`, 'info');
                }
                throw lastErr || new Error('Tất cả key đều hết quota');
              })();

          const analyzeJson = analyzeRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          refAnalysis = JSON.parse(analyzeJson);
          const nC = refAnalysis.characters?.length || 0;
          addLog(`✅ Phân tích ảnh xong: ${nC} nhân vật từ ảnh tham chiếu`, 'success');
        } catch (err) {
          addLog(`⚠️ Phân tích ảnh thất bại: ${err.message.slice(0, 150)} — tiếp tục không có dữ liệu ảnh`, 'warn');
          refAnalysis = null;
        }
        } // end else canVision
        if (stopRef.current) throw new Error('Đã dừng.');
      }

      // Build refCharFromImages: nhân vật trích từ ảnh tham chiếu → inject vào script gen
      const refCharsForScript = (refAnalysis?.characters || []).map((c, i) => {
        // Ưu tiên tên người dùng đặt > tên AI gợi ý > tên mặc định
        const userCharName = refImages[c.imageIndex]?.charName?.trim() || refImages[i]?.charName?.trim() || '';
        const charName = userCharName || c.suggestedName || `Nhân vật ${i + 1}`;
        const appearance = [
          c.ethnicity && `${c.ethnicity}`,
          c.gender && c.ageRange && `${c.gender}, ${c.ageRange}`,
          c.hair && `tóc: ${c.hair}`,
          c.eyes && `mắt: ${c.eyes}`,
          c.skinTone && `da: ${c.skinTone}`,
          c.build && `vóc dáng: ${c.build}`,
          c.distinctiveFeatures && c.distinctiveFeatures !== 'none' && `đặc điểm: ${c.distinctiveFeatures}`,
        ].filter(Boolean).join(', ');
        return {
          id: `ref_char_${i}`,
          name: charName,
          gender: c.gender || '',
          age: c.ageRange || '',
          ethnicity: c.ethnicity || '',
          appearance,
          clothing: c.clothing || '',
          accessories: c.accessories || '',
          distinctiveFeatures: c.distinctiveFeatures || '',
          role: i === 0 ? 'main' : 'secondary',
          imageIndex: c.imageIndex ?? i,
        };
      });

      // ── 1. Generate script if idea mode ─────────────────────────────────────
      let finalScript = scriptText;
      if (inputMode === 'idea') {
        setPhase('gen_script');
        addLog('✍️ Đang tạo kịch bản từ ý tưởng...', 'info');

        // Nhân vật dùng cho script: ưu tiên ảnh tham chiếu, nếu không có thì dùng form input
        const scriptMainChar  = refCharsForScript[0]  || (hasMainChar ? mainChar : null);
        const scriptSecChars  = refCharsForScript.slice(1).length
          ? refCharsForScript.slice(1)
          : secChars.filter(c => c.name || c.appearance);

        const sText = aiMode === 'groq'
          ? await generateScriptGroq(groqKeys, { topic: ideaText, platform, sceneDuration: sceneDur, totalDuration: totalMins, language, style, goal, tone, audience, mainChar: scriptMainChar, secChars: scriptSecChars }, (evt) => { if (evt.type === 'chunk_done' && evt.total > 25) setGeneratedScript(evt.scriptSoFar || ''); else if (evt.type === 'key_switch') addLog('Groq: ' + evt.message, 'info'); }, groqModel)
          : aiMode === 'claude'
          ? await generateScriptClaude({
              apiKey: claudeKey, model: claudeModel,
              topic: ideaText, platform, sceneDuration: sceneDur, totalDuration: totalMins,
              language, style, goal, tone, audience,
              mainChar: scriptMainChar,
              secChars: scriptSecChars,
            })
          : await generateScript(apiKeys, {
              topic: ideaText, platform, sceneDuration: sceneDur, totalDuration: totalMins,
              language, style, goal, tone, audience,
              mainChar: scriptMainChar,
              secChars: scriptSecChars,
            }, (evt) => {
              if (evt.type === 'chunk_done' && evt.total > 25) setGeneratedScript(evt.scriptSoFar || '');
              else if (evt.type === 'key_switch') addLog('🔄 Chuyển API key', 'info');
            });
        if (!sText) throw new Error('Không tạo được kịch bản từ ý tưởng.');
        finalScript = sText;
        setGeneratedScript(sText);
        addLog('✅ Kịch bản hoàn thành!', 'success');
      }
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 2. Parse with Gemini ─────────────────────────────────────────────────
      setPhase('parse');

      // ── 2b. Parse kịch bản với Gemini ────────────────────────────────────────
      addLog(`🎭 Phân tích kịch bản với ${aiMode === 'groq' ? '⚡ Groq' : aiMode === 'claude' ? '🤖 Claude' : '✨ Gemini'}...`, 'info');

      // Lấy art_style từ style user chọn — không để Gemini tự đoán
      const selectedArtStyle = STYLE_MAP[style] || `${style}, highly detailed, professional quality`;

      // Build character hint block từ mainChar + secChars (nếu user đã nhập)
      const definedChars = [hasMainChar ? mainChar : null, ...secChars.filter(c => c.name || c.appearance)].filter(Boolean);
      const charHintBlock = definedChars.length > 0
        ? `\n⚠️ PRE-DEFINED CHARACTERS — use these EXACT names and visual details, do NOT rename or redesign:\n` +
          definedChars.map((c, i) => {
            const lbl = i === 0 ? '👤 MAIN CHARACTER' : `👥 SECONDARY ${i}`;
            let s = `${lbl}: ${c.name || '(unnamed)'}`;
            if (c.gender) s += ` | ${c.gender}`;
            if (c.age)    s += ` | Age: ${c.age}`;
            if (c.ethnicity)  s += `\n   Ethnicity/Nationality: ${c.ethnicity}`;
            if (c.appearance) s += `\n   Appearance: ${c.appearance}`;
            if (c.clothing)   s += `\n   Clothing & Accessories: ${c.clothing}`;
            if (c.role)       s += `\n   Role: ${c.role}`;
            return s;
          }).join('\n') + '\n'
        : '';

      // ── Build refAnalysisBlock từ kết quả phân tích ảnh ─────────────────────
      let refAnalysisBlock = '';
      if (refAnalysis) {
        const blocks = [];
        if (refAnalysis.characters?.length) {
          const charDescs = refAnalysis.characters.map((c, i) => {
            const imgRef = refImages[c.imageIndex] || refImages[i] || {};
            const userGivenName = imgRef.charName?.trim();
            const charDisplayName = userGivenName || c.suggestedName || `Nhân vật ${i + 1}`;
            const imgLabel = imgRef.label ? ` [${imgRef.label}]` : '';
            return `  📸 REF CHARACTER #${i + 1}${imgLabel} (Ảnh ${c.imageIndex + 1}): ` +
              `TÊN: "${charDisplayName}"${userGivenName ? ' (do người dùng đặt — BẮT BUỘC dùng tên này)' : ''} | ` +
              `${c.gender}, ${c.ethnicity}, ${c.ageRange}. ` +
              `HAIR: ${c.hair}. SKIN: ${c.skinTone}. FACE: ${c.faceShape}, ${c.eyes}. ` +
              `BUILD: ${c.build}. CLOTHING: ${c.clothing}. ACCESSORIES: ${c.accessories}. ` +
              `DISTINCTIVE: ${c.distinctiveFeatures}.`;
          }).join('\n');
          blocks.push(`📸 NHÂN VẬT TỪ ẢNH THAM CHIẾU — dùng CHÍNH XÁC các chi tiết này cho trường "desc" và "dna_prompt":\n${charDescs}`);
        }
        if (refAnalysis.settings?.length) {
          const settingDescs = refAnalysis.settings.map((s, i) =>
            `  📸 REF SETTING #${i + 1} (Ảnh ${s.imageIndex + 1}): ` +
            `${s.locationType} | ${s.timeOfDay} | ${s.lighting} lighting | ` +
            `Màu: ${s.dominantColors} | Mood: ${s.mood} | ` +
            `Phong cách KT: ${s.architecturalStyle} | Props: ${s.keyProps}`
          ).join('\n');
          blocks.push(`📸 BỐI CẢNH TỪ ẢNH THAM CHIẾU — dùng cho trường "setting_anchor":\n${settingDescs}`);
        }
        if (refAnalysis.artStyle) {
          const a = refAnalysis.artStyle;
          blocks.push(`📸 PHONG CÁCH TỪ ẢNH THAM CHIẾU: ${a.renderStyle}, ${a.colorGrading}, ${a.lightingStyle}, ${a.visualTone}. ${a.referenceDescription}`);
        }
        if (blocks.length) {
          refAnalysisBlock = `\n\n⚠️ DỮ LIỆU PHÂN TÍCH ẢNH THAM CHIẾU — BẮT BUỘC tích hợp vào JSON output:\n` +
            blocks.join('\n\n') +
            (refAnalysis.summary ? `\n\nTÓM TẮT: ${refAnalysis.summary}` : '');
        }
      }

      const PARSE_PROMPT = `You are a professional storyboard director. Analyze this script and output ONLY valid JSON (no markdown fences, no extra text):${charHintBlock}${refAnalysisBlock}
⚠️ CRITICAL: The user has selected this art style: "${selectedArtStyle}"
You MUST use this EXACT string as the "art_style" value. Do NOT change it, do NOT invent a different style, do NOT use Ghibli, anime, or any other style unless it matches the selection above.
{
  "art_style": "${selectedArtStyle}",
  "character_anchor": "CharName (role): [ETHNICITY e.g. 'East Asian Vietnamese woman'] — [exact age, body type, hair color/length/style, clothing with exact colors, skin tone, glasses/accessories, distinctive features]. One line per character. ETHNICITY is mandatory first.",
  "setting_anchor": "Setting: [detailed English: location, time of day, lighting quality, key props, background elements, color palette].",
  "characters": [
    {
      "id": "char_id",
      "name": "Full Name",
      "gender": "male|female|neutral",
      "desc": "ULTRA-DETAILED English visual desc — MANDATORY FORMAT: START with ethnicity+gender sentence: '[Name] is a [EXACT ethnicity — e.g. East Asian/Vietnamese/Korean/Japanese/Chinese woman, South Asian/Indian man, Caucasian/Western woman, Middle Eastern man, Black/African woman] in their [age range e.g. early 20s].' THEN: (1) HAIR: [exact shade — use specific color names: jet-black / deep dark brown / chestnut brown / auburn / platinum blonde / honey blonde / ash grey — NOT just 'dark' or 'light'] [exact length: waist-length / hip-length / shoulder-length / chin-length / short pixie] [exact style: straight / wavy / curly / sleek / voluminous] hair; (2) FACE: [exact skin tone: fair porcelain / light beige / warm olive / medium tan / deep brown / dark ebony] skin, [eye shape — e.g. almond-shaped single-lid East Asian eyes / large round double-lid eyes / deep-set eyes] [exact eye color], [face shape: soft oval / sharp V-line / round / square jaw]; (3) BUILD: [height] [build]; (4) CLOTHING: [exact garment type + fit] in [exact color name]; (5) ACCESSORIES: [list or 'none']. CRITICAL: The ethnicity in the first sentence is the most important — it determines face generation and MUST be specified precisely.",
      "dna_prompt": "MANDATORY ART STYLE: [copy exact art_style string here]. Multi-angle character turnaround reference sheet, 8 panels in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head] [right side profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white studio background, no scene, no props except own accessories. ⚠️ ETHNICITY CRITICAL: [Name] is a [COPY EXACT ETHNICITY from desc first sentence here — e.g. 'East Asian Vietnamese woman', 'South Asian Indian man', 'Caucasian Western woman'] — this ethnicity determines FACIAL FEATURES and MUST appear as the very first line. CHARACTER FULL DESC: [copy entire desc field here verbatim — exact hair color/style/length, exact face shape, exact skin tone, exact clothing with colors, eye shape and color, distinctive features]. Same character consistently across all 8 panels. Professional character design turnaround sheet. NO style deviation allowed. No text labels, no arrows, no annotations, no captions, no watermarks, no on-screen text."
    }
  ],
  "scenes": [
    {
      "id": "scene_1", "sceneNum": 1, "title": "short title", "setting": "brief English setting",
      "characters_in_scene": ["char_id_1", "char_id_2"],
      "shots": [
        {"num": 1, "type": "Wide Shot", "action": "Detailed English: [Character Name] ([ETHNICITY e.g. East Asian Vietnamese young woman], [exact hair: jet-black waist-length wavy hair], [exact clothing: cream oversized t-shirt, blue straight jeans]) — [action]+[setting]+[expression]. FORMAT: always lead with name + ethnicity + hair + clothing in every shot."},
        {"num": 2, "type": "Close-Up", "action": "Detailed English: [same character name] ([SAME ethnicity reminder], [same hair reminder], [same clothing reminder]) — [close-up action]+[facial emotion]+[detail]"},
        {"num": 3, "type": "Medium Shot", "action": "Detailed English: [character name] ([ethnicity], [hair color+style], [clothing]) — [action]+[environment detail]"},
        {"num": 4, "type": "Bird's Eye", "action": "Detailed English: [character name] ([ethnicity], [hair], [clothing]) — [overhead view action]+[setting]"}
      ],
      "hasDialogue": true, "dialogue": "Speaker: dialogue text here", "speakerName": "Character Name"
    }
  ]
}
Rules:
- Capture EVERY scene from the script, do not skip any
- ⚠️ SHOT COUNT IS MANDATORY: Count the EXACT number of shots written in the script for each scene and output ALL of them. If the script has 1 shot → output 1 shot. If 2 shots → 2 shots. If 4 shots → 4 shots. If 5 shots → 5 shots. DO NOT default to 3 shots. DO NOT add or remove shots.
- Each shot must have a different camera angle/type — never repeat the same shot type consecutively
- ⚠️ EVERY shot action MUST start with: "[Character Name] ([EXACT ETHNICITY from desc, e.g. East Asian Vietnamese woman], [exact hair: jet-black waist-length wavy], [exact clothing: cream t-shirt, blue jeans]) — [action]". NEVER write a shot action without the ethnicity+hair+clothing prefix. This is the single most important rule.
- characters_in_scene: list the char id(s) of characters who appear in each scene
- dna_prompt for each character: must begin with the ethnicity sentence verbatim from desc, then full desc, then the 8-panel turnaround format
- Keep character visual descriptions perfectly consistent with character_anchor and desc across all scenes
- Shot types must vary: ECU, CU, MCU, MS, MLS, LS, WS, EWS, POV, OTS, Dutch Angle, Bird's Eye, Low Angle, High Angle, Tracking, Dolly, Handheld, Crane
🚫 VEO CONTENT POLICY — MANDATORY IN ALL SHOT ACTIONS AND PROMPTS:
- NEVER describe: graphic violence, blood, gore, weapons used violently, murder, torture, execution, adult/sexual content, nudity, hate speech, drugs, terrorism, disturbing imagery
- Replace sensitive content with neutral cinematic alternatives: "intense confrontation" not "bloody fight", "dramatic tension" not "murder scene", "athletic struggle" not "violent attack"
- All shot "action" fields must be safe, family-friendly, and suitable for general audiences
- Every desc and dna_prompt must be tasteful and appropriate for all viewers
Script:
` + finalScript;

      // Build multimodal parts — chỉ gửi ảnh với Gemini/Claude (Groq không hỗ trợ)
      const _parseParts = [];
      if (refImages.length > 0 && aiMode !== 'groq') {
        // Dùng ảnh đã resize từ Step 0; nếu chưa có thì resize ngay
        if (resizedRefImages.length === 0) {
          const resizeBase64Parse = (base64, mime, maxPx = 800) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve({ base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' });
            };
            img.onerror = () => resolve({ base64, mime });
            img.src = `data:${mime};base64,${base64}`;
          });
          resizedRefImages = await Promise.all(refImages.map(img => resizeBase64Parse(img.base64, img.mime)));
        }
        resizedRefImages.forEach(img => _parseParts.push({ inlineData: { mimeType: img.mime, data: img.base64 } }));
        addLog(`🖼️ Đính kèm ${resizedRefImages.length} ảnh tham chiếu → ${aiMode === 'claude' ? '🤖 Claude' : '✨ Gemini'} parse...`, 'info');
      }
      _parseParts.push({ text: PARSE_PROMPT });

      const rawText = aiMode === 'claude'
        ? await callClaudeVision({
            apiKey: claudeKey, model: claudeModel,
            system: 'You are a professional storyboard director. Output ONLY valid JSON (no markdown fences, no extra text).',
            images: (resizedRefImages.length > 0 ? resizedRefImages : refImages).map(img => ({ base64: img.base64, mime: img.mime })),
            prompt: PARSE_PROMPT,
            maxTokens: 8192, temperature: 0,
          })
        : aiMode === 'groq'
        ? await callGroqWithRotation(groqKeys, {
            model: groqModel,
            system: 'You are a professional storyboard director. Output ONLY valid JSON (no markdown fences, no extra text).',
            prompt: PARSE_PROMPT,
            maxTokens: 8000, temperature: 0,
          }, (info) => addLog(`🔄 Chuyển Groq key #${(info?.toIdx ?? 0) + 1}`, 'info'))
        : await retryWithKeyRotation(async (apiKey) => {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: _parseParts }],
                  generationConfig: { maxOutputTokens: 65536, temperature: 0 },
                }) }
            );
            if (!res.ok) { const e = await res.json().catch(() => ({})); const err = new Error(e?.error?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
            const d = await res.json();
            // Kiểm tra lý do dừng — nếu bị cắt thì throw để retry
            const finishReason = d?.candidates?.[0]?.finishReason;
            if (finishReason && finishReason !== 'STOP') throw new Error(`Gemini output bị cắt (finishReason: ${finishReason}) — thử lại`);
            return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }, apiKeys, { onSwitch: (info) => addLog(`🔄 Chuyển API key #${(info?.toIdx ?? 0) + 1}`, 'info') });

      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseErr) {
        // JSON bị cắt ngắn — thử sửa bằng cách đóng các bracket còn mở
        addLog('⚠️ JSON bị cắt ngắn — đang thử tự sửa...', 'warn');
        const fixed = jsonStr
          .replace(/,\s*$/, '')           // trailing comma
          .replace(/,\s*\]/, ']')          // trailing comma trước ]
          .replace(/,\s*\}/, '}');         // trailing comma trước }
        // Đếm bracket mở/đóng và thêm phần còn thiếu
        let opens = 0, openSq = 0;
        for (const ch of fixed) { if (ch === '{') opens++; else if (ch === '}') opens--; else if (ch === '[') openSq++; else if (ch === ']') openSq--; }
        const tail = ']'.repeat(Math.max(0, openSq)) + '}'.repeat(Math.max(0, opens));
        try { parsed = JSON.parse(fixed + tail); addLog('✅ Tự sửa JSON thành công', 'info'); }
        catch { throw new Error(`JSON không hợp lệ sau khi cố sửa: ${parseErr.message}`); }
      }
      // Force override art_style bằng style user chọn — Gemini không được tự thay đổi
      parsed.art_style = selectedArtStyle;
      setParsedData(parsed);

      const scenes = parsed.scenes || [];
      addLog(`✅ Phân tích xong: ${scenes.length} cảnh, ${parsed.characters?.length || 0} nhân vật — style: ${style}`, 'success');
      if (!scenes.length) throw new Error('Không tìm thấy cảnh nào trong kịch bản!');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 3. Build voice map — dùng charVoiceOverrides nếu user đã chọn thủ công ──────────────
      const usedVoices = new Set();
      const vm = {};
      const charsArr = parsed.characters || [];
      for (let ci = 0; ci < charsArr.length; ci++) {
        const char     = charsArr[ci];
        const override = charVoiceOverrides[ci]; // undefined = chưa set, '' = không voice, 'random' = auto, else specific id
        if (override === '' || override === null) continue;     // tắt giọng cho nhân vật này
        if (!override || override === 'random') {
          // Auto chọn theo giới tính
          const gender = detectCharGender(char.id, char.desc || '');
          const voice  = pickVoiceByGender(gender, usedVoices);
          if (voice) { vm[char.id] = voice; usedVoices.add(voice); }
        } else {
          // Dùng voice user đã chọn thủ công
          vm[char.id] = override;
          usedVoices.add(override);
        }
      }
      setVoiceMap(vm);
      const vmStr = Object.entries(vm).map(([k, v]) => `${k}→${v}`).join(', ');
      addLog(`🎙 Phân công giọng: ${vmStr || 'không có / tắt tất cả'}`, 'info');

      // ── Batch helper — CÙNG pattern với Veo Studio: gửi tất cả 1 lần, guard chống gửi trùng ──
      // Không dùng BATCH_SIZE — veo-engine tự giới hạn MAX_WORKERS=5 song song
      // Khi retry: đổi task ID mới (_r1, _r2...) → server không nhận nhầm là request cũ
      const MAX_FIRST_RETRY  = 5;  // lần đầu: thử 5 lần rồi bỏ qua, làm video tiếp
      const MAX_GLOBAL_RETRY = 5;  // global: sau khi xong tất cả, retry lỗi 5 lần
      const MAX_GLOBAL_PASSES = 5; // vòng global tối đa

      const runVeoBatch = async (baseParams, tasks, enableGlobalRetry = false, onTaskDone = null) => {
        const taskIdxMap = new Map();
        tasks.forEach((t, i) => taskIdxMap.set(t.id, i));
        const orderedResults = new Array(tasks.length).fill(null);

        let pendingTasks = dedupTasksByPrompt([...tasks], addLog);
        // Theo dõi các task vi phạm chính sách → cần đổi prompt
        const policyViolatedIds = new Set();

        // ── Helper: chạy 1 vòng retry maxRetry lần ───────────────────────────
        const runOnePass = async (passLabel, maxRetry) => {
          const filterPass = makeSubmitGuard();
          for (let attempt = 1; attempt <= maxRetry && pendingTasks.length > 0; attempt++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            if (attempt > 1) {
              addLog(`🔄 ${passLabel} Thử lại ${pendingTasks.length} task (lần ${attempt}/${maxRetry}) — chờ 10s...`, 'info');
              await sleep(10000);
            }

            const safeTasks = filterPass(pendingTasks, addLog);
            if (!safeTasks.length) { addLog('⚠️ Tất cả task đã gửi — bỏ qua retry', 'info'); break; }

            addLog(`📤 ${passLabel} Gửi ${safeTasks.length} task lên Veo (lần ${attempt}/${maxRetry})...`, 'info');
            const r = await window.electronAPI.runVeo({ ...baseParams, tasks: safeTasks });
            const files = r?.files || [];

            const succeeded = files.filter(f => !f.isError && f.filePath);
            const failedFiles = files.filter(f => f.isError);
            const failedIds   = new Set(failedFiles.map(f => f.id));

            succeeded.forEach(f => {
              const idx = taskIdxMap.get(f.id);
              if (idx !== undefined) {
                orderedResults[idx] = f;
                onTaskDone?.(idx, f); // cập nhật UI ngay khi từng task xong
              }
            });

            if (succeeded.length > 0)
              addLog(`✅ ${passLabel} Lần ${attempt}: ${succeeded.length}/${safeTasks.length} thành công`, 'success');

            // ── Detect & xử lý vi phạm chính sách ─────────────────────────
            for (const ff of failedFiles) {
              if (isPolicyViolation(ff.error)) {
                policyViolatedIds.add(ff.id);
                addLog(`🚫 [Chính sách Veo] Task ${ff.id} vi phạm: "${(ff.error || '').slice(0, 100)}" → sẽ đổi prompt an toàn`, 'error');
              }
            }

            pendingTasks = safeTasks
              .filter(t => failedIds.has(t.id))
              .map(t => {
                const newId = `${t.id}_r${attempt}`;
                const origIdx = taskIdxMap.get(t.id);
                taskIdxMap.set(newId, origIdx);
                taskIdxMap.delete(t.id);
                // Nếu vi phạm chính sách → sanitize prompt cho lần retry
                const wasViolation = policyViolatedIds.has(t.id);
                if (wasViolation) {
                  policyViolatedIds.delete(t.id);
                  policyViolatedIds.add(newId);
                  const cleanedPrompt = sanitizePrompt(t.prompt);
                  addLog(`🔧 Prompt đã làm sạch: "${cleanedPrompt.slice(0, 80)}..."`, 'info');
                  return { ...t, id: newId, prompt: cleanedPrompt };
                }
                return { ...t, id: newId };
              });

            if (pendingTasks.length > 0 && attempt < maxRetry)
              addLog(`⚠️ ${passLabel} ${pendingTasks.length} task lỗi → thử lại lần ${attempt + 1}...`, 'info');
          }
        };

        // ── Vòng chính: thử 5 lần rồi bỏ qua, làm video tiếp ────────────────
        addLog(`📋 Bắt đầu tạo ${pendingTasks.length} video (thử tối đa ${MAX_FIRST_RETRY} lần/task, bỏ qua nếu vẫn lỗi)...`, 'info');
        await runOnePass('', MAX_FIRST_RETRY);

        if (pendingTasks.length > 0)
          addLog(`⏭️ ${pendingTasks.length} task vẫn lỗi sau ${MAX_FIRST_RETRY} lần → bỏ qua, tiếp tục video khác`, 'warn');

        // ── Global retry: sau khi hoàn thành TẤT CẢ → retry lỗi 20 lần ────
        if (enableGlobalRetry && pendingTasks.length > 0) {
          addLog(`\n🔄 ════ GLOBAL RETRY ════ Bắt đầu chạy lại ${pendingTasks.length} task lỗi (${MAX_GLOBAL_PASSES} vòng × ${MAX_GLOBAL_RETRY} lần)...`, 'info');
          await sleep(3000);
          for (let gPass = 1; gPass <= MAX_GLOBAL_PASSES && pendingTasks.length > 0; gPass++) {
            if (stopRef.current) throw new Error('Đã dừng.');
            addLog(`🔄 [Global Retry ${gPass}/${MAX_GLOBAL_PASSES}] ${pendingTasks.length} task vẫn lỗi → thử lại ${MAX_GLOBAL_RETRY} lần...`, 'info');
            await sleep(5000);
            pendingTasks = pendingTasks.map(t => {
              const ni = `${t.id}_g${gPass}`;
              taskIdxMap.set(ni, taskIdxMap.get(t.id));
              taskIdxMap.delete(t.id);
              return { ...t, id: ni };
            });
            await runOnePass(`[Global ${gPass}/${MAX_GLOBAL_PASSES}]`, MAX_GLOBAL_RETRY);
            if (pendingTasks.length === 0)
              addLog(`✅ [Global Retry] Tất cả hoàn thành ở vòng ${gPass}!`, 'success');
            else
              addLog(`⚠️ [Global Retry ${gPass}] Còn ${pendingTasks.length} task lỗi...`, 'error');
          }
        }

        // ── Policy Repair Loop: sửa đổi prompt vi phạm cho đến khi ra kết quả ──
        if (pendingTasks.length > 0) {
          addLog(`❌ ${pendingTasks.length} task thất bại sau tất cả vòng retry — chạy Policy Repair...`, 'error');
          const repairMap = new Map();
          pendingTasks.forEach(t => repairMap.set(t.id, taskIdxMap.get(t.id)));
          await runPolicyRepairLoop(
            pendingTasks, repairMap, orderedResults,
            async (task) => window.electronAPI.runVeo({ ...baseParams, tasks: [task] }),
            addLog, stopRef
          );
        }

        const resultMap = {};
        tasks.forEach((t, i) => { if (orderedResults[i]) resultMap[t.id] = orderedResults[i]; });
        return resultMap;
      };

      // ── 4. Batch DNA tham chiếu nhân vật ─────────────────────────────────────
      setPhase('gen_dna');
      const characters = parsed.characters || [];
      const dnaMap = {}; // charId → filePath

      // ── Save ref images xuống disk ────────────────────────────────────────────
      const refCharImgPaths  = []; // file paths ảnh nhân vật (label='character' hoặc '')
      const refStyleImgPaths = []; // file paths ảnh phong cách (label='style')
      if (refImages.length > 0) {
        const refDir = `${outputFolder}\\__ref_imgs`;
        await window.electronAPI.createFolder?.(refDir).catch(() => {});
        for (let ri = 0; ri < refImages.length; ri++) {
          const img = refImages[ri];
          try {
            const ext = img.mime?.includes('png') ? 'png' : img.mime?.includes('webp') ? 'webp' : 'jpg';
            const refPath = `${refDir}\\ref_${ri}.${ext}`;
            const r = await window.electronAPI.writeBase64File({ base64: img.base64, filePath: refPath });
            if (r?.success) {
              if (img.label === 'style') refStyleImgPaths.push(refPath);
              else refCharImgPaths.push(refPath);
            }
          } catch {}
        }
        addLog(`📸 Đã lưu ${refCharImgPaths.length} ảnh nhân vật + ${refStyleImgPaths.length} ảnh phong cách`, 'info');
      }

      if (characters.length > 0) {
        // ── CHIẾN LƯỢC DNA ────────────────────────────────────────────────────
        // Nếu user upload ảnh tham chiếu nhân vật → dùng TRỰC TIẾP làm DNA
        // (không để Veo generate vì AI sẽ tạo nhân vật hoàn toàn khác)
        // Phân phối: ref #0 → nhân vật #0, ref #1 → nhân vật #1, ...
        // Nếu ít ảnh hơn nhân vật → nhân vật còn lại để Veo generate bình thường
        const charNeedVeo = [];
        characters.forEach((c, i) => {
          if (refCharImgPaths[i]) {
            // Dùng ảnh tham chiếu trực tiếp làm DNA
            dnaMap[c.id] = refCharImgPaths[i];
            addLog(`✅ DNA ${c.name} → dùng ảnh tham chiếu #${i + 1} (không cần Veo generate)`, 'success');
          } else {
            charNeedVeo.push({ char: c, idx: i });
          }
        });

        // Chỉ generate Veo cho các nhân vật chưa có ảnh tham chiếu
        if (charNeedVeo.length > 0) {
          const dnaTs    = Date.now();
          const dnasMeta = charNeedVeo.map(({ char, idx }) => ({ charId: char.id, name: char.name, taskId: `dna_c${idx}_${dnaTs}` }));
          const dnaTasks = charNeedVeo.map(({ char, idx }) => {
            const task = {
              id:        `dna_c${idx}_${dnaTs}`,
              prompt:    char.dna_prompt || `MANDATORY ART STYLE: ${parsed.art_style || 'Cinematic quality'}. Multi-angle character turnaround reference sheet, 8 panels in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head] [right side profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white studio background, no scene, no props except own accessories. CHARACTER: ${char.desc}. Same character consistently across all 8 panels. Professional character design turnaround sheet. NO style deviation. No text labels, no arrows, no annotations, no captions, no watermarks, no on-screen text.`,
              fileIndex: idx + 1,
            };
            // Nếu có ảnh style ref → gắn vào để giữ phong cách
            if (refStyleImgPaths.length > 0) task.referenceImages = refStyleImgPaths.slice(0, 2);
            return task;
          });

          const jobIdToCharId = {};
          dnasMeta.forEach(m => { jobIdToCharId[m.taskId] = m.charId; });
          setDnaJobIdToCharId(jobIdToCharId);

          addLog(`🧬 Veo generate ${charNeedVeo.length} DNA nhân vật còn lại...`, 'info');
          const dnaResults = await runVeoBatch(
            { mediaType: 'Image', aspectRatio, model: imgModel, outputFolder, genCount: '1x', quality: '1K', duration: '4s' },
            dnaTasks
          );
          for (const meta of dnasMeta) {
            const f = dnaResults[meta.taskId];
            if (f) { dnaMap[meta.charId] = f.filePath; addLog(`✅ DNA ${meta.name} → ${f.filePath.split(/[\\/]/).pop()}`, 'success'); }
            else     addLog(`⚠️ DNA ${meta.name}: không tạo được`, 'error');
          }
        }

        setCharDnaMap({ ...dnaMap });
        setDnaJobIdToCharId({}); // clear sau khi batch xong
        addLog(`✅ DNA xong: ${Object.keys(dnaMap).length}/${characters.length} nhân vật`, 'success');
      }
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Build scene jobs ───────────────────────────────────────────────────
      const ts = Date.now();
      const jobs = scenes.map((sc, i) => {
        const charMatch = (parsed.characters || []).find(c =>
          c.name?.toLowerCase() === sc.speakerName?.toLowerCase() ||
          c.id?.toLowerCase()   === sc.speakerName?.toLowerCase()
        );
        const sceneCharIds = sc.characters_in_scene || [];
        const sceneDnaImgs = sceneCharIds.map(id => dnaMap[id]).filter(Boolean);
        return {
          sceneId:     sc.id || `scene_${i + 1}`,
          sceneNum:    sc.sceneNum || i + 1,
          title:       sc.title || `Cảnh ${i + 1}`,
          numShots:    (sc.shots || []).length,
          prompt:      sanitizePrompt(buildImagePrompt(sc, parsed)),
          videoPrompt: sanitizePrompt(buildVideoPrompt(sc, parsed)),
          hasDialogue: !!sc.hasDialogue,
          speakerName: sc.speakerName || '',
          dialogue:    sc.dialogue || '',
          voiceId:     charMatch ? (vm[charMatch.id] || null) : null,
          sceneCharIds,   // lưu để real-time DNA preview update đúng cảnh
          sceneDnaImgs,
          imgJobId:    `sb_img_s${i + 1}_${ts}`,
          imgStatus:   'pending', imgPath: null, imgProgress: 0,
          vidJobId:    `sb_vid_s${i + 1}_${ts}`,
          vidStatus:   'pending', vidPath: null, vidProgress: 0,
        };
      });
      setSceneJobs(jobs);
      sceneJobsRef.current = jobs;

      // ── 6. Batch tạo tất cả ảnh ───────────────────────────────────────────────
      setPhase('gen_images');
      addLog(`🖼 Batch tạo ${jobs.length} ảnh cảnh...`, 'info');
      setSceneJobs(jobs.map(j => ({ ...j, imgStatus: 'running' })));

      // Mỗi cảnh dùng đúng prompt ảnh của cảnh đó + DNA nhân vật xuất hiện trong cảnh
      const imgTasks = jobs.map((job, i) => {
        const dnaFiles = job.sceneDnaImgs.map(p => p.split(/[\\/]/).pop()).join(', ') || 'none';
        addLog(`[Storyboard] Cảnh ${job.sceneNum} (jobs[${i}]): tạo ảnh + DNA=[${dnaFiles}]`, 'info');
        const t = { id: job.imgJobId, prompt: job.prompt, fileIndex: i + 1 };
        // DNA ảnh nhân vật đã generate → dùng làm referenceImages chính
        if (job.sceneDnaImgs.length > 0) {
          // DNA + style ref nếu có (max 4 tổng)
          t.referenceImages = [...job.sceneDnaImgs, ...refStyleImgPaths].slice(0, 4);
        } else if (refCharImgPaths.length > 0 || refStyleImgPaths.length > 0) {
          // Fallback: dùng trực tiếp ảnh tham chiếu gốc của user
          t.referenceImages = [...refCharImgPaths, ...refStyleImgPaths].slice(0, 4);
        }
        return t;
      });
      const imgResults = await runVeoBatch(
        { mediaType: 'Image', aspectRatio, model: imgModel, outputFolder, genCount: '1x', quality: '1K', duration: '4s' },
        imgTasks,
        false,
        (taskIdx, f) => {
          // Hiển thị ảnh ngay khi từng task xong — không chờ hết batch
          if (jobs[taskIdx] && f.filePath) {
            jobs[taskIdx] = { ...jobs[taskIdx], imgStatus: 'done', imgPath: f.filePath };
            setSceneJobs([...jobs]);
            sceneJobsRef.current = [...jobs];
          }
        }
      );
      for (let i = 0; i < jobs.length; i++) {
        const f = imgResults[jobs[i].imgJobId];
        if (f) {
          jobs[i] = { ...jobs[i], imgStatus: 'done', imgPath: f.filePath };
          addLog(`✅ Ảnh cảnh ${jobs[i].sceneNum} → ${f.filePath.split(/[\\/]/).pop()}`, 'success');
        } else {
          jobs[i] = { ...jobs[i], imgStatus: 'error' };
        }
      }
      setSceneJobs([...jobs]);
      sceneJobsRef.current = [...jobs];
      addLog(`🎨 Xong ảnh: ${jobs.filter(j => j.imgPath).length}/${jobs.length} cảnh. Bắt đầu tạo video...`, 'success');

      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 7. Batch tạo tất cả video ─────────────────────────────────────────────
      setPhase('gen_videos');
      const jobsWithImg = jobs.filter(j => j.imgPath);
      addLog(`🎬 Batch tạo ${jobsWithImg.length} video từ scene image...`, 'info');
      setSceneJobs(jobs.map(j => j.imgPath ? { ...j, vidStatus: 'running' } : j));

      // Đảm bảo cảnh N dùng đúng promptN + ảnhN — không được lệch thứ tự
      const vidTasks = jobsWithImg.map((job) => {
        const sceneIdx = jobs.indexOf(job); // index gốc trong jobs[]
        const imgFile  = job.imgPath?.split(/[\\/]/).pop() || '(none)';
        addLog(`[Storyboard] Cảnh ${job.sceneNum} (jobs[${sceneIdx}]): videoPrompt="${job.videoPrompt.substring(0, 60)}..." + ảnh="${imgFile}"`, 'info');
        if (!job.imgPath) throw new Error(`❌ Cảnh ${job.sceneNum}: imgPath null — không thể tạo video (logic error)`);
        // Video PHẢI animate từ ảnh cảnh thực tế (job.imgPath) — KHÔNG dùng DNA turnaround sheet
        // DNA chỉ dùng làm referenceImages cho bước tạo ẢNH, không dùng cho bước tạo VIDEO
        const videoIngredients = [job.imgPath];
        addLog(`[Storyboard] Cảnh ${job.sceneNum}: video ingredient = ${job.imgPath.split(/[\\/]/).pop()} (scene image)`, 'info');
        const t = { id: job.vidJobId, prompt: job.videoPrompt, ingredientImages: videoIngredients, fileIndex: sceneIdx + 1 };
        if (job.voiceId) t.voiceId = job.voiceId;
        return t;
      });
      const vidTasksFinal = vidTasks;
      const vidResults = await runVeoBatch(
        { mediaType: 'Video', aspectRatio, model: vidModel, outputFolder, genCount: '1x', quality: videoQuality, duration },
        vidTasksFinal,
        true  // ← enableGlobalRetry: sau 20 lần thử, tự động retry toàn bộ lỗi
      );
      for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].imgPath) continue;
        const f = vidResults[jobs[i].vidJobId];
        if (f) { jobs[i] = { ...jobs[i], vidStatus: 'done', vidPath: f.filePath }; addLog(`✅ Video cảnh ${jobs[i].sceneNum} → ${f.filePath.split(/[\\/]/).pop()}`, 'success'); }
        else      jobs[i] = { ...jobs[i], vidStatus: 'error' };
      }
      setSceneJobs([...jobs]);
      sceneJobsRef.current = [...jobs];
      addLog(`🎞 Xong video: ${jobs.filter(j => j.vidPath).length}/${jobsWithImg.length} cảnh`, 'success');

      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 6. Merge ─────────────────────────────────────────────────────────────
      const videoPaths = jobs.map(j => j.vidPath).filter(Boolean);
      if (videoPaths.length >= 2) {
        setPhase('merge');
        addLog(`🎞 Ghép ${videoPaths.length} video (FFmpeg)...`, 'info');
        const mergeResult = await window.electronAPI.mergeVideo({
          files:        videoPaths,
          trimStart:    0,
          trimEnd:      0,
          transition:   useTransition ? 'Ngẫu nhiên' : 'Không có',
          outputFolder,
          outputName:   `storyboard_final_${Date.now()}`,
        });
        if (mergeResult?.success && mergeResult?.path) {
          setMergedPath(mergeResult.path);
          addLog(`🎉 Ghép xong! → ${mergeResult.path.split(/[\\/]/).pop()}`, 'success');
        } else {
          addLog(`❌ Lỗi ghép: ${mergeResult?.error || '?'}`, 'error');
        }
      } else {
        addLog('⚠️ Không đủ video để ghép (cần ≥ 2)', 'error');
      }

      setPhase('done');
      addLog('✅ Storyboard hoàn chỉnh!', 'success');

    } catch (e) {
      if (e.message !== 'Đã dừng.') addLog(`❌ Lỗi: ${e.message}`, 'error');
      setPhase('error');
    }
  };

  const isRunning = ['gen_script', 'parse', 'gen_dna', 'gen_images', 'gen_videos', 'merge'].includes(phase);
  const toFUrl    = p => p ? 'file:///' + p.replace(/\\/g, '/') : '';
  const doneImgs  = sceneJobs.filter(j => j.imgPath);

  const PHASE_LABEL = {
    idle: '', gen_script: 'Đang tạo kịch bản...', parse: 'Đang phân tích...',
    gen_dna: 'Đang tạo DNA nhân vật...', gen_images: 'Đang tạo ảnh...', gen_videos: 'Đang tạo video...', merge: 'Đang ghép video...', done: 'Hoàn tất!', error: 'Lỗi',
  };

  const StepPill = ({ n, label, donePhases, activePhase }) => {
    const done   = donePhases.includes(phase);
    const active = phase === activePhase;
    return (
      <div className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold transition-all',
        done   ? 'bg-emerald-900/30 text-emerald-300' :
        active ? 'bg-pink-900/30 text-pink-300' : 'text-slate-700')}>
        {done ? <CheckCircle2 size={10}/> : active ? <Loader2 size={10} className="animate-spin"/> :
          <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[8px]">{n}</span>}
        {label}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full bg-[#080e1a] text-slate-300 overflow-hidden">

      {/* ── SIDEBAR ── */}
      <div className={cn('bg-[#0d1425] border-r border-slate-800/70 flex flex-col shrink-0 overflow-hidden transition-all duration-300', sidebarOpen ? 'w-[340px]' : 'w-0')}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar" style={{ minWidth: '340px' }}>

          {/* Header */}
          <div className="flex items-center gap-2">
            <Film size={15} className="text-pink-400"/>
            <span className="text-sm font-bold text-white">Storyboard Studio</span>
            <span className={cn('ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full', extConnected ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/30 text-red-400')}>
              {extConnected ? '● KẾT NỐI' : '○ OFFLINE'}
            </span>
          </div>



          {/* AI Provider */}
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">AI Provider</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60">
              {[{id:'gemini',label:'✨ Gemini'},{id:'claude',label:'🤖 Claude'},{id:'groq',label:'⚡ Groq'}].map(m => (
                <button key={m.id} disabled={isRunning} onClick={() => setAiMode(m.id)}
                  className={cn('flex-1 py-1.5 text-[10px] font-bold transition-colors',
                    aiMode === m.id
                      ? (m.id === 'groq' ? 'bg-green-600 text-white' : m.id === 'claude' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white')
                      : 'bg-slate-800/50 text-slate-500 hover:text-slate-300')}>
                  {m.label}
                </button>
              ))}
            </div>
            {aiMode === 'claude' && !claudeKey && (
              <p className="text-[9px] text-orange-400 mt-1">⚠️ Chưa có Claude API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && !groqKeys.length && (
              <p className="text-[9px] text-green-400 mt-1">⚠️ Chưa có Groq API Key — vào Settings để thêm</p>
            )}
            {aiMode === 'groq' && groqKeys.length > 0 && (
              <p className="text-[9px] text-green-500/60 mt-0.5">💡 Nên chọn Llama 3.1 8B trong Settings để tránh rate limit</p>
            )}
          </div>

          {/* Input mode toggle */}
          <div>
            <label className="text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2 block">Đầu vào</label>
            <div className="flex gap-1 bg-[#0a1020] rounded-xl p-1">
              {[['idea','💡 Ý tưởng'],['script','📄 Kịch bản']].map(([m, lbl]) => (
                <button key={m} onClick={() => setInputMode(m)}
                  className={cn('flex-1 py-2 text-[11px] font-bold rounded-lg transition-all', inputMode === m ? 'bg-pink-600 text-white' : 'text-slate-500 hover:text-slate-300')}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Idea mode */}
          {inputMode === 'idea' && (<>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Ý tưởng</label>
              <textarea value={ideaText} onChange={e => setIdeaText(e.target.value)}
                placeholder="Nhập ý tưởng video storyboard của bạn..."
                className="w-full h-24 bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-pink-500/50 resize-none placeholder-slate-700"
              />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Nền tảng</p>
                  <select value={platform} onChange={e => setPlatform(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Ngôn ngữ</p>
                  <select value={language} onChange={e => setLanguage(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {LANGUAGES.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Phong cách</p>
                  <select value={style} onChange={e => setStyle(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {STYLES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Giây/cảnh</p>
                  <select value={sceneDur} onChange={e => setSceneDur(+e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {[4,6,8].map(d => <option key={d} value={d}>{d}s</option>)}
                    <option value={10}>10s ⚡ Omni Flash</option>
                  </select>
                  {sceneDur === 10 && (
                    <p className="text-[8px] text-orange-400 mt-0.5">⚡ Tự động dùng Omni Flash 10s</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Đối tượng</p>
                <select value={audience} onChange={e => setAudience(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                  {AUDIENCES.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Mục tiêu</p>
                  <select value={goal} onChange={e => setGoal(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {GOALS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Tông giọng</p>
                  <select value={tone} onChange={e => setTone(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                    {TONES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">
                  Tổng thời lượng &nbsp;<span className="text-pink-400 font-bold normal-case">≈ {Math.max(1, Math.round((totalMins * 60) / sceneDur))} cảnh</span>
                </p>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={60} value={totalMins}
                    onChange={e => setTotalMins(Math.max(1, +e.target.value || 1))}
                    className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 text-center focus:outline-none focus:border-pink-500/50"/>
                  <span className="text-[10px] text-slate-600">phút</span>
                </div>
              </div>
            </div>

            {/* ── Hồ sơ nhân vật — giống Creator Studio ─────────────────── */}
            <div className="border border-slate-800/60 rounded-xl overflow-hidden">
              <button onClick={() => setShowChars(v => !v)} disabled={isRunning}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800/40 transition-colors">
                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Users size={10} className="text-purple-400"/>
                  Hồ sơ nhân vật
                  {hasMainChar && (
                    <span className="ml-1 px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded text-[9px]">
                      {1 + secChars.filter(c => c.name || c.appearance).length} NV đã nhập
                    </span>
                  )}
                </span>
                <ChevronRight size={12} className={cn('text-slate-500 transition-transform', showChars && 'rotate-90')}/>
              </button>
              {showChars && (
                <div className="px-3 pb-3 space-y-3 border-t border-slate-800/60">
                  <p className="text-[9px] text-slate-600 pt-2 leading-relaxed">Định nghĩa nhân vật trước — Gemini sẽ dùng CHÍNH XÁC tên, ngoại hình, trang phục này khi viết kịch bản và tạo ảnh.</p>

                  {/* Nhân vật chính */}
                  <div className="p-2.5 bg-purple-500/5 border border-purple-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400"/>
                      <span className="text-[10px] font-bold text-purple-400">Nhân vật chính</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input placeholder="Tên nhân vật" value={mainChar.name}
                        onChange={e => setMainChar(p => ({ ...p, name: e.target.value }))}
                        disabled={isRunning}
                        className="col-span-2 bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60"/>
                      <select value={mainChar.gender} onChange={e => setMainChar(p => ({ ...p, gender: e.target.value }))}
                        disabled={isRunning}
                        className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60">
                        <option>Nữ</option><option>Nam</option><option>Khác</option>
                      </select>
                      <input placeholder="Tuổi (VD: 22)" value={mainChar.age}
                        onChange={e => setMainChar(p => ({ ...p, age: e.target.value }))}
                        disabled={isRunning}
                        className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60"/>
                    </div>
                    <input placeholder="Sắc tộc / Quốc tịch (VD: Người Việt, East Asian, Korean...)" value={mainChar.ethnicity}
                      onChange={e => setMainChar(p => ({ ...p, ethnicity: e.target.value }))}
                      disabled={isRunning}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60"/>
                    <textarea placeholder="Ngoại hình chi tiết: khuôn mặt, kiểu tóc, màu tóc, màu mắt, vóc dáng, đặc điểm nhận dạng..."
                      value={mainChar.appearance} onChange={e => setMainChar(p => ({ ...p, appearance: e.target.value }))}
                      rows={3} disabled={isRunning}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60 resize-none leading-relaxed"/>
                    <textarea placeholder="Trang phục & phụ kiện (màu sắc cụ thể, chất liệu, vũ khí nếu có...)"
                      value={mainChar.clothing} onChange={e => setMainChar(p => ({ ...p, clothing: e.target.value }))}
                      rows={2} disabled={isRunning}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60 resize-none"/>
                    <input placeholder="Vai trò trong kịch bản (tuỳ chọn — VD: chính diện, phản diện...)" value={mainChar.role}
                      onChange={e => setMainChar(p => ({ ...p, role: e.target.value }))}
                      disabled={isRunning}
                      className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500/60"/>
                  </div>

                  {/* Nhân vật phụ */}
                  {secChars.map((c, i) => (
                    <div key={c.id} className="p-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"/>
                          <span className="text-[10px] font-bold text-indigo-400">Nhân vật phụ {i + 1}</span>
                        </div>
                        <button onClick={() => removeSecChar(c.id)} disabled={isRunning}
                          className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                          <X size={11}/>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <input placeholder="Tên" value={c.name}
                          onChange={e => updateSecChar(c.id, 'name', e.target.value)} disabled={isRunning}
                          className="col-span-2 bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60"/>
                        <select value={c.gender} onChange={e => updateSecChar(c.id, 'gender', e.target.value)} disabled={isRunning}
                          className="bg-[#0a1020] border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60">
                          <option>Nữ</option><option>Nam</option><option>Khác</option>
                        </select>
                        <input placeholder="Tuổi" value={c.age}
                          onChange={e => updateSecChar(c.id, 'age', e.target.value)} disabled={isRunning}
                          className="bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60"/>
                      </div>
                      <input placeholder="Sắc tộc / Quốc tịch" value={c.ethnicity}
                        onChange={e => updateSecChar(c.id, 'ethnicity', e.target.value)} disabled={isRunning}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60"/>
                      <textarea placeholder="Ngoại hình chi tiết"
                        value={c.appearance} onChange={e => updateSecChar(c.id, 'appearance', e.target.value)}
                        rows={2} disabled={isRunning}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60 resize-none"/>
                      <textarea placeholder="Trang phục & phụ kiện"
                        value={c.clothing} onChange={e => updateSecChar(c.id, 'clothing', e.target.value)}
                        rows={1} disabled={isRunning}
                        className="w-full bg-[#0a1020] border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500/60 resize-none"/>
                    </div>
                  ))}

                  {secChars.length < 4 && (
                    <button onClick={addSecChar} disabled={isRunning}
                      className="w-full py-2 border border-dashed border-slate-700 hover:border-indigo-500/50 text-slate-600 hover:text-indigo-400 rounded-lg text-[10px] transition-colors disabled:opacity-40">
                      + Thêm nhân vật phụ
                    </button>
                  )}
                </div>
              )}
            </div>

            {generatedScript && (
              <div className="bg-[#0a1020] border border-slate-800 rounded-lg p-2">
                <p className="text-[9px] font-bold text-slate-600 uppercase mb-1">Kịch bản đã tạo</p>
                <p className="text-[10px] text-slate-500 line-clamp-4 leading-relaxed">{generatedScript}</p>
              </div>
            )}
          </>)}

          {/* Script mode */}
          {inputMode === 'script' && (<>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Kịch bản đầy đủ</label>
              <textarea value={scriptText} onChange={e => setScriptText(e.target.value)}
                placeholder={'Dán kịch bản đầy đủ vào đây...\n\nVí dụ:\nCảnh 1 - Mở đầu: Aoi bước vào phòng lab tối tăm...\nCảnh 2 - Gặp gỡ: Rin chạy vào và ôm lấy Aoi...\n...'}
                className="w-full h-48 bg-[#0a1020] border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-pink-500/50 resize-none placeholder-slate-700"
              />
            </div>
            <div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Ngôn ngữ thoại</p>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                {LANGUAGES.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>
          </>)}

          {/* ── Ảnh tham chiếu — multi, cả 2 chế độ ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <ImagePlus size={10}/> Ảnh tham chiếu
                {refImages.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[9px] font-bold">{refImages.length}/8</span>
                )}
              </label>
              {refImages.length > 0 && (
                <button onClick={clearAllRefImages} disabled={isRunning}
                  className="text-[9px] text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40">Xóa tất cả</button>
              )}
            </div>

            <input ref={refImageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleRefImageChange}/>

            {/* Grid ảnh đã tải */}
            {refImages.length > 0 && (
              <div className="space-y-2">
                {refImages.map((img, idx) => (
                  <div key={img.id} className="bg-[#0a1020] border border-amber-500/20 rounded-xl overflow-hidden">
                    <div className="flex gap-2 p-1.5">
                      {/* Thumbnail */}
                      <div className="relative shrink-0">
                        <img src={`data:${img.mime};base64,${img.base64}`} alt={img.name}
                          className="w-16 h-16 object-cover rounded-lg border border-slate-700"/>
                        <button onClick={() => removeRefImage(img.id)} disabled={isRunning}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center transition-colors disabled:opacity-40">
                          <X size={8} className="text-white"/>
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-lg text-center text-[8px] text-slate-400 py-0.5 font-bold">#{idx + 1}</div>
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1 py-0.5">
                        <div>
                          <p className="text-[8px] text-slate-700 uppercase mb-0.5">Loại tham chiếu</p>
                          <select value={img.label} onChange={e => updateRefLabel(img.id, e.target.value)}
                            disabled={isRunning}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[9px] rounded-lg px-1.5 py-1 outline-none focus:border-amber-500/50 disabled:opacity-40">
                            {REF_IMG_LABELS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                        </div>
                        {img.label === 'character' && (
                          <div>
                            <p className="text-[8px] text-slate-700 uppercase mb-0.5">Tên nhân vật</p>
                            <input
                              type="text"
                              value={img.charName || ''}
                              onChange={e => updateRefCharName(img.id, e.target.value)}
                              disabled={isRunning}
                              placeholder="Ví dụ: Linh, An, Emma..."
                              className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[9px] rounded-lg px-1.5 py-1 outline-none focus:border-amber-500/50 placeholder-slate-600 disabled:opacity-40"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Nút thêm ảnh */}
            {refImages.length < 8 && (
              <button onClick={handleRefImagePick} disabled={isRunning}
                className="w-full border border-dashed border-amber-600/40 hover:border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/10 rounded-lg py-3 flex flex-col items-center gap-1 transition-all disabled:opacity-40">
                <ImagePlus size={14} className="text-amber-500/50"/>
                <span className="text-[10px] text-amber-500/60 font-medium">
                  {refImages.length === 0 ? 'Tải lên ảnh tham chiếu' : '+ Thêm ảnh'}
                </span>
                {refImages.length === 0 && (
                  <span className="text-[9px] text-slate-700">Nhân vật · Phong cách · Bối cảnh (tối đa 8 ảnh)</span>
                )}
              </button>
            )}

            {refImages.length > 0 && (
              <p className="text-[9px] text-amber-500/60 text-center leading-relaxed">
                ✅ Gemini sẽ phân tích chi tiết {refImages.length} ảnh → nhúng vào kịch bản
              </p>
            )}
          </div>

          {/* Settings */}
          <div className="border-t border-slate-800/60 pt-4 space-y-3">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cài đặt xuất file</label>

            <div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Thư mục lưu</p>
              <div className="flex gap-1.5">
                <div className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-400 truncate">{outputFolder || 'Chưa chọn...'}</div>
                <button onClick={async () => { const f = await window.electronAPI?.selectFolder?.(); if (f) setOutputFolder(f); }}
                  className="p-1.5 bg-slate-700/60 hover:bg-slate-600 rounded-lg transition-colors">
                  <FolderOpen size={12} className="text-slate-400"/>
                </button>
              </div>
            </div>

            <div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Tỉ lệ khung hình</p>
              <div className="flex gap-1">
                {RATIOS.map(r => (
                  <button key={r} onClick={() => setAspectRatio(r)}
                    className={cn('flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all', aspectRatio === r ? 'bg-pink-600 border-pink-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300')}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Model tạo ảnh cảnh (Veo)</p>
              <select value={imgModel} onChange={e => setImgModel(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                {IMG_MDL.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Model tạo video</p>
                <select value={vidModel} onChange={e => setVidModel(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                  {VID_MDL.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Chất lượng</p>
                <select value={videoQuality} onChange={e => setVideoQuality(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-2 py-1.5 outline-none">
                  <option value="480p">480p</option>
                  <option value="720p">720p — Nhanh</option>
                  {sceneDur === 8 && <option value="1080p">1080p — Upscale (chậm hơn)</option>}
                </select>
              </div>
            </div>

            <div>
              <p className="text-[9px] font-semibold text-slate-600 uppercase mb-1">Thời lượng video/cảnh</p>
              <div className="flex gap-1">
                {['4s','6s','8s'].map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={cn('flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all', duration === d ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300')}>
                    {d}
                  </button>
                ))}
                <button onClick={() => { setDuration('10s'); setSceneDur(10); setVidModel('Omni 1.1 Flash'); }}
                  className={cn('flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all flex flex-col items-center leading-none gap-px',
                    duration === '10s' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-orange-700/60 hover:text-orange-400')}>
                  <span>10s</span>
                  <span className={cn('text-[7px]', duration === '10s' ? 'text-orange-200' : 'text-slate-700')}>Omni</span>
                </button>
              </div>
              {duration === '10s' && (
                <p className="text-[8px] text-orange-400 mt-1">⚡ Omni Flash mode — tự động áp dụng</p>
              )}
            </div>

            {/* Transition toggle */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <div onClick={() => setUseTransition(v => !v)}
                className={cn('w-9 h-5 rounded-full border transition-all shrink-0 flex items-center px-0.5',
                  useTransition ? 'bg-violet-600 border-violet-500' : 'bg-slate-800 border-slate-700')}>
                <div className={cn('w-3.5 h-3.5 rounded-full bg-white shadow transition-all', useTransition ? 'translate-x-4' : 'translate-x-0')}/>
              </div>
              <span className="text-[10px] text-slate-400 group-hover:text-slate-300 transition-colors">Chuyển cảnh ngẫu nhiên khi ghép</span>
            </label>
          </div>

          {/* Run All button */}
          <div className="space-y-2 border-t border-slate-800/60 pt-4">
            <button onClick={handleRunAll} disabled={isRunning}
              className="w-full py-3 bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-pink-900/20">
              {isRunning ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
              {isRunning ? 'Đang chạy...' : '▶ Chạy tất cả tự động'}
            </button>
            {isRunning && (
              <button onClick={() => { stopRef.current = true; setPhase('error'); addLog('⛔ Đã dừng.', 'error'); }}
                className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs font-bold rounded-xl border border-red-700/30 transition-colors flex items-center justify-center gap-2">
                <Square size={12}/> Dừng
              </button>
            )}
          </div>

          {/* Characters parsed — với voice selection per character */}
          {parsedData?.characters?.length > 0 && (
            <div className="border-t border-slate-800/60 pt-4">
              {/* Header + quick-set buttons */}
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Nhân vật {Object.keys(charDnaMap).length > 0 && <span className="text-emerald-400">({Object.keys(charDnaMap).length} DNA ✓)</span>}
                </label>
                {!isRunning && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCharVoiceOverrides(parsedData.characters.map(() => 'random'))}
                      className="text-[8px] text-violet-400 hover:text-violet-300 px-1.5 py-0.5 bg-violet-900/20 hover:bg-violet-900/30 rounded transition-colors">
                      🎲 Tất cả auto
                    </button>
                    <button
                      onClick={() => setCharVoiceOverrides(parsedData.characters.map(() => ''))}
                      className="text-[8px] text-slate-500 hover:text-slate-400 px-1.5 py-0.5 bg-slate-800/50 hover:bg-slate-700/50 rounded transition-colors">
                      🔇 Tắt tất cả
                    </button>
                  </div>
                )}
              </div>

              {parsedData.characters.map((c, i) => (
                <div key={i} className="bg-[#0a1020] border border-slate-800 rounded-lg p-2 mb-1.5">
                  {/* Row 1: avatar + name + desc */}
                  <div className="flex gap-2 mb-1.5">
                    {charDnaMap[c.id] ? (
                      <button onClick={() => window.electronAPI?.openFile?.(charDnaMap[c.id])} title="Mở ảnh DNA">
                        <img src={toFUrl(charDnaMap[c.id])} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-700 shrink-0"/>
                      </button>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        {phase === 'gen_dna' ? <Loader2 size={10} className="text-cyan-400 animate-spin"/> : <Brain size={10} className="text-slate-600"/>}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-pink-300 truncate mb-0.5">{c.name}</p>
                      <p className="text-[9px] text-slate-500 leading-relaxed line-clamp-1">{c.desc}</p>
                    </div>
                  </div>
                  {/* Row 2: voice selector */}
                  <div className="flex items-center gap-1.5">
                    <Volume2 size={9} className="text-violet-500 shrink-0"/>
                    <select
                      value={charVoiceOverrides[i] ?? 'random'}
                      onChange={e => {
                        const v = [...charVoiceOverrides];
                        v[i] = e.target.value;
                        setCharVoiceOverrides(v);
                      }}
                      disabled={isRunning}
                      className="flex-1 bg-slate-800/60 border border-violet-500/30 rounded-lg px-1.5 py-1 text-[9px] text-violet-300 focus:outline-none focus:border-violet-500/60 disabled:opacity-50">
                      {VOICE_LIST.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    {voiceMap[c.id] && (
                      <span className="text-[8px] text-violet-400 bg-violet-900/30 px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                        ✓ {voiceMap[c.id]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Sidebar toggle */}
      <button onClick={() => setSidebarOpen(v => !v)}
        className="w-5 self-stretch bg-slate-900 hover:bg-slate-800 border-x border-slate-800/50 flex items-center justify-center shrink-0 transition-colors">
        {sidebarOpen ? <ChevronLeft size={12} className="text-slate-600"/> : <ChevronRight size={12} className="text-slate-600"/>}
      </button>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Step bar */}
        <div className="h-10 shrink-0 flex items-center px-4 gap-2 border-b border-slate-800/60 bg-[#0a0f1e]">
          <StepPill n="1" label="Kịch bản"  donePhases={['parse','gen_dna','gen_images','gen_videos','merge','done','error']} activePhase="gen_script"/>
          <ChevronRight size={10} className="text-slate-700"/>
          <StepPill n="2" label="Phân tích" donePhases={['gen_dna','gen_images','gen_videos','merge','done','error']}   activePhase="parse"/>
          <ChevronRight size={10} className="text-slate-700"/>
          <StepPill n="3" label="DNA"        donePhases={['gen_images','gen_videos','merge','done']}                    activePhase="gen_dna"/>
          <ChevronRight size={10} className="text-slate-700"/>
          <StepPill n="4" label="Tạo ảnh"   donePhases={['gen_videos','merge','done']}                                 activePhase="gen_images"/>
          <ChevronRight size={10} className="text-slate-700"/>
          <StepPill n="5" label="Tạo video" donePhases={['merge','done']}                                               activePhase="gen_videos"/>
          <ChevronRight size={10} className="text-slate-700"/>
          <StepPill n="6" label="Ghép"       donePhases={['done']}                                                      activePhase="merge"/>
          {PHASE_LABEL[phase] && (
            <span className="ml-auto text-[10px] text-slate-600 flex items-center gap-1">
              {isRunning && <Loader2 size={9} className="animate-spin"/>}
              {PHASE_LABEL[phase]}
            </span>
          )}
        </div>

        {/* Scene cards */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">

          {/* Empty state */}
          {sceneJobs.length === 0 && phase !== 'gen_dna' && (
            <div className="h-full flex flex-col items-center justify-center text-slate-700">
              <Film size={56} className="mb-5 opacity-10"/>
              <p className="text-sm font-semibold text-slate-600 mb-2">Storyboard sẽ hiển thị ở đây</p>
              <p className="text-xs text-slate-700 leading-relaxed text-center max-w-xs">
                Nhập ý tưởng hoặc kịch bản → Nhấn ▶ Chạy tất cả<br/>
                Hệ thống sẽ tự phân tích → tạo ảnh → tạo video → ghép
              </p>
            </div>
          )}

          {/* DNA phase — hiển thị preview tham chiếu ngay khi từng ảnh TC xong */}
          {phase === 'gen_dna' && (
            <div className="rounded-xl border border-amber-700/30 bg-amber-900/5 p-3 mb-3">
              <p className="text-[10px] font-bold text-amber-400 mb-2 flex items-center gap-1.5">
                <Loader2 size={10} className="animate-spin"/>
                🧬 Đang tạo ảnh tham chiếu nhân vật (TC_image_N)...
              </p>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(charDnaMap).map(([charId, fp]) => (
                  <div key={charId} className="flex flex-col items-center gap-1">
                    <button onClick={() => window.electronAPI?.openFile?.(fp)}
                      className="relative rounded-lg overflow-hidden border border-emerald-600/50 hover:border-emerald-400 transition-colors"
                      style={{ width: 72, height: 72 }}>
                      <img src={toFUrl(fp)} alt="" className="w-full h-full object-cover"/>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[7px] text-emerald-300 text-center py-0.5">
                        {fp.replace(/\\/g,'/').split('/').pop()}
                      </div>
                    </button>
                    <span className="text-[8px] text-slate-400 max-w-[72px] truncate text-center">{charId}</span>
                  </div>
                ))}
                {/* Placeholder cho các nhân vật chưa xong */}
                {parsedData?.characters?.filter(c => !charDnaMap[c.id]).map(c => (
                  <div key={c.id} className="flex flex-col items-center gap-1">
                    <div className="rounded-lg border border-dashed border-amber-800/40 bg-slate-900/40 flex items-center justify-center"
                      style={{ width: 72, height: 72 }}>
                      <Loader2 size={16} className="text-amber-600 animate-spin"/>
                    </div>
                    <span className="text-[8px] text-slate-600 max-w-[72px] truncate text-center">{c.id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scene job list */}
          <div className="space-y-2">
            {sceneJobs.map((job, i) => (
              <div key={job.sceneId} className={cn('rounded-xl border transition-all',
                job.imgStatus === 'running' || job.vidStatus === 'running' ? 'border-cyan-700/40 bg-cyan-900/5' :
                job.vidStatus === 'done'    ? 'border-emerald-700/30 bg-emerald-900/5' :
                job.imgStatus === 'error' || job.vidStatus === 'error' ? 'border-red-700/30 bg-red-900/5' :
                'border-slate-800/60 bg-slate-900/20')}>

                {/* Header row */}
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 border-b border-slate-800/40">
                  <span className="text-[10px] font-bold text-pink-400 shrink-0">Cảnh {job.sceneNum}</span>
                  <span className="text-[10px] text-slate-300 font-semibold truncate flex-1">{job.title}</span>
                  <span className="text-[9px] text-slate-600 shrink-0">{job.numShots} shot</span>
                  {job.voiceId && <span className="text-[9px] text-violet-300 bg-violet-900/20 px-1.5 py-0.5 rounded-full shrink-0">🎙 {job.voiceId}</span>}
                </div>

                {/* 3-column body */}
                <div className="grid grid-cols-3 gap-2 p-2.5">

                  {/* ── Col 1: Ảnh cảnh ── */}
                  {(() => {
                    const n = job.numShots || 1;
                    const gridLabel = n === 1 ? '1×1' : n === 2 ? '1×2' : n === 3 ? '1×3' : n === 4 ? '2×2' : '3+2';
                    // Grid overlay for n>1: transparent cells with white border dividers
                    const GridOverlay = () => {
                      if (n <= 1) return null;
                      if (n === 5) return (
                        <div className="absolute inset-0 pointer-events-none flex flex-col">
                          <div className="flex flex-1">
                            {[0,1,2].map(i => <div key={i} className="flex-1 border border-white/25"/>)}
                          </div>
                          <div className="flex flex-1 justify-center">
                            {[0,1].map(i => <div key={i} className="w-1/3 border border-white/25"/>)}
                          </div>
                        </div>
                      );
                      const cols = n <= 3 ? n : 2;
                      const rows = n === 4 ? 2 : 1;
                      return (
                        <div className="absolute inset-0 pointer-events-none"
                          style={{ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gridTemplateRows:`repeat(${rows},1fr)` }}>
                          {Array.from({length:n}).map((_,i) => <div key={i} className="border border-white/25"/>)}
                        </div>
                      );
                    };
                    // Loading grid with per-cell spinners
                    const LoadingGrid = () => {
                      if (n === 5) return (
                        <div className="absolute inset-0 flex flex-col">
                          <div className="flex flex-1">
                            {[0,1,2].map(i => <div key={i} className="flex-1 flex items-center justify-center border border-slate-700/50"><Loader2 size={8} className="text-cyan-400 animate-spin"/></div>)}
                          </div>
                          <div className="flex flex-1 justify-center">
                            {[0,1].map(i => <div key={i} className="w-1/3 flex items-center justify-center border border-slate-700/50"><Loader2 size={8} className="text-cyan-400 animate-spin"/></div>)}
                          </div>
                        </div>
                      );
                      const cols = n <= 3 ? n : 2;
                      const rows = n === 4 ? 2 : 1;
                      return (
                        <div className="absolute inset-0"
                          style={{ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gridTemplateRows:`repeat(${rows},1fr)` }}>
                          {Array.from({length:n}).map((_,i) => (
                            <div key={i} className="flex items-center justify-center border border-slate-700/50">
                              <Loader2 size={8} className="text-cyan-400 animate-spin"/>
                            </div>
                          ))}
                        </div>
                      );
                    };
                    return (
                      <div className="flex flex-col gap-1">
                        <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">🖼 Ảnh cảnh</p>
                        <div className="relative w-full rounded-lg overflow-hidden bg-slate-900/60 border border-slate-800"
                          style={{ aspectRatio: '16/9' }}>
                          {job.imgPath ? (
                            <>
                              <img src={toFUrl(job.imgPath)} alt=""
                                className="w-full h-full object-cover"
                                onError={e => { e.target.style.display = 'none'; }}/>
                              <GridOverlay/>
                              <button onClick={() => window.electronAPI?.openFile?.(job.imgPath)}
                                className="absolute inset-0 flex items-end justify-end p-1 opacity-0 hover:opacity-100 transition-opacity bg-black/20">
                                <span className="text-[8px] text-white bg-black/60 px-1.5 py-0.5 rounded">↗</span>
                              </button>
                            </>
                          ) : job.imgStatus === 'running' ? (
                            <LoadingGrid/>
                          ) : job.imgStatus === 'error' ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-[9px] text-red-400">✗ Lỗi</span>
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <ImageIcon size={14} className="text-slate-700"/>
                            </div>
                          )}
                        </div>
                        <span className={cn('text-[8px] font-bold text-center',
                          job.imgStatus === 'done'    ? 'text-emerald-400' :
                          job.imgStatus === 'running' ? 'text-cyan-400' :
                          job.imgStatus === 'error'   ? 'text-red-400' : 'text-slate-700')}>
                          {job.imgStatus === 'done'    ? `✓ Xong (${n} shot${n>1?' — '+gridLabel:''})` :
                           job.imgStatus === 'running' ? `${job.imgProgress||0}% · ${gridLabel}` :
                           job.imgStatus === 'error'   ? '✗ Lỗi' : '—'}
                        </span>
                      </div>
                    );
                  })()}

                  {/* ── Col 2: Video ── */}
                  <div className="flex flex-col gap-1">
                    <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">🎬 Video</p>
                    <div className="relative w-full rounded-lg overflow-hidden bg-slate-900/60 border border-slate-800 flex items-center justify-center"
                      style={{ aspectRatio: '16/9' }}>
                      {job.vidPath ? (
                        <>
                          {job.imgPath && <img src={toFUrl(job.imgPath)} alt="" className="w-full h-full object-cover opacity-60" onError={e => { e.target.style.display = 'none'; }}/>}
                          <button onClick={() => window.electronAPI?.openFile?.(job.vidPath)}
                            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/10 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                              <Play size={12} fill="white" className="text-white ml-0.5"/>
                            </div>
                          </button>
                        </>
                      ) : job.vidStatus === 'running' ? (
                        <div className="flex flex-col items-center gap-1">
                          <Loader2 size={14} className="text-blue-400 animate-spin"/>
                          {job.vidProgress > 0 && <span className="text-[8px] text-blue-400">{job.vidProgress}%</span>}
                        </div>
                      ) : job.vidStatus === 'error' ? (
                        <span className="text-[9px] text-red-400">✗ Lỗi</span>
                      ) : (
                        <Film size={14} className="text-slate-700"/>
                      )}
                    </div>
                    <span className={cn('text-[8px] font-bold text-center',
                      job.vidStatus === 'done'    ? 'text-violet-400' :
                      job.vidStatus === 'running' ? 'text-blue-400' :
                      job.vidStatus === 'error'   ? 'text-red-400' : 'text-slate-700')}>
                      {job.vidStatus === 'done' ? '✓ Xong' : job.vidStatus === 'running' ? `${job.vidProgress||0}%` : job.vidStatus === 'error' ? '✗ Lỗi' : '—'}
                    </span>
                  </div>

                  {/* ── Col 3: DNA tham chiếu ── */}
                  <div className="flex flex-col gap-1">
                    <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                      🧬 DNA tham chiếu
                      {phase === 'gen_dna' && job.sceneCharIds?.length > 0 && job.sceneDnaImgs?.length < job.sceneCharIds?.length
                        ? <span className="text-amber-400 ml-1 flex items-center gap-0.5"><Loader2 size={8} className="animate-spin"/>đang tạo...</span>
                        : job.sceneDnaImgs?.length > 0
                          ? <span className="text-emerald-400 ml-1">({job.sceneDnaImgs.length} TC)</span>
                          : <span className="text-slate-700 ml-1">(không có)</span>}
                    </p>
                    <div className="flex gap-1 flex-wrap">
                      {job.sceneDnaImgs?.length > 0 ? job.sceneDnaImgs.map((dnaPath, di) => (
                        <button key={di} onClick={() => window.electronAPI?.openFile?.(dnaPath)}
                          title={`TC_image_${di + 1} — Nhấn để mở`}
                          className="relative rounded-lg overflow-hidden bg-slate-900/60 border border-emerald-700/40 hover:border-emerald-400/70 transition-colors shrink-0 group"
                          style={{ width: 52, height: 52 }}>
                          <img src={toFUrl(dnaPath)} alt=""
                            className="w-full h-full object-cover"
                            onError={e => { e.target.style.display = 'none'; }}/>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[6px] text-emerald-300 text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            TC_{di + 1}
                          </div>
                        </button>
                      )) : phase === 'gen_dna' && job.sceneCharIds?.length > 0 ? (
                        <div className="flex gap-1">
                          {job.sceneCharIds.map((_, ci) => (
                            <div key={ci} className="rounded-lg bg-slate-900/60 border border-dashed border-amber-800/40 flex items-center justify-center"
                              style={{ width: 52, height: 52 }}>
                              <Loader2 size={12} className="text-amber-600 animate-spin"/>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="w-full rounded-lg bg-slate-900/40 border border-dashed border-slate-800 flex items-center justify-center"
                          style={{ height: 44 }}>
                          <span className="text-[8px] text-slate-700">Không có nhân vật</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[8px] text-slate-700 leading-tight line-clamp-1">{job.prompt.slice(0,60)}...</span>
                  </div>

                </div>
              </div>
            ))}
          </div>

          {/* ── Storyboard preview khi done ── */}
          {phase === 'done' && doneImgs.length > 0 && (
            <div className="mt-5 rounded-xl border border-emerald-700/30 bg-emerald-900/5 overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-emerald-800/30">
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0"/>
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-300">Storyboard hoàn chỉnh!</p>
                  {mergedPath && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Video:{' '}
                      <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                        className="text-emerald-400 hover:underline">
                        {mergedPath.replace(/\\/g,'/').split('/').pop()}
                      </button>
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {mergedPath && (
                    <button onClick={() => window.electronAPI?.openFile?.(mergedPath)}
                      title="Mở video tổng hợp"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 text-[10px] font-bold rounded-lg transition-colors">
                      <Play size={11} fill="currentColor"/> Xem video
                    </button>
                  )}
                  <button onClick={() => window.electronAPI?.openFolder?.(outputFolder)}
                    title="Mở thư mục"
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
                    <FolderOpen size={13} className="text-slate-400"/>
                  </button>
                </div>
              </div>

              {/* Image strip preview */}
              <div className="p-3">
                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Xem trước storyboard — {doneImgs.length} cảnh
                </p>
                <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                  {doneImgs.map((job, i) => (
                    <div key={job.sceneId} className="relative shrink-0 group cursor-pointer"
                      style={{ width: 96, height: 64 }}
                      onClick={() => job.vidPath
                        ? window.electronAPI?.openFile?.(job.vidPath)
                        : window.electronAPI?.openFile?.(job.imgPath)}>
                      <img src={toFUrl(job.imgPath)} alt=""
                        className="w-full h-full object-cover rounded-lg border border-slate-700/50"
                        onError={e => { e.target.style.display = 'none'; }}/>
                      {/* Scene label */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg px-1.5 pb-1 pt-2">
                        <p className="text-[8px] font-bold text-white truncate">{job.sceneNum}. {job.title}</p>
                      </div>
                      {/* Play overlay if has video */}
                      {job.vidPath && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-lg">
                          <Play size={14} className="text-white drop-shadow" fill="white"/>
                        </div>
                      )}
                      {/* Video done badge */}
                      {job.vidStatus === 'done' && (
                        <div className="absolute top-1 right-1 w-3.5 h-3.5 bg-violet-600 rounded-full flex items-center justify-center">
                          <Play size={7} fill="white" className="text-white"/>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-700 mt-1.5">Click vào cảnh để mở video (nếu có) hoặc ảnh</p>
              </div>
            </div>
          )}
        </div>

        {/* Log panel */}
        <div className={cn('bg-[#06090f] border-t border-slate-800/50 shrink-0 flex flex-col transition-all duration-200', logOpen ? 'h-[140px]' : 'h-9')}>
          <button onClick={() => setLogOpen(v => !v)}
            className="h-9 flex items-center justify-between px-4 hover:bg-slate-800/20 transition-colors shrink-0">
            <span className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
              <Terminal size={11}/>
              Nhật ký hoạt động
              {!logOpen && logs.some(l => l.type === 'error') && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>}
            </span>
            {logOpen ? <ChevronDown size={12} className="text-slate-600"/> : <ChevronUp size={12} className="text-slate-600"/>}
          </button>
          {logOpen && (
            <div className="flex-1 overflow-y-auto px-4 pb-2 font-mono text-[10px] custom-scrollbar space-y-0.5">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-700 shrink-0">[{l.time}]</span>
                  <span className={l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}>{l.text}</span>
                </div>
              ))}
              <div ref={logsEndRef}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW PHIM PANEL
// ═══════════════════════════════════════════════════════════════════════════════

// Reup Video — moved to ReupVideoPanel.jsx
export { VideoCleanerPanel } from './ReupVideoPanel';


const TMPL_DURATIONS_OMNI = ['4s','6s','8s','10s'];
const TMPL_DURATIONS_VEO  = ['4s','6s','8s'];

function TemplateVideoPanel() {
  const [videoFile,   setVideoFile]   = useState('');
  const [frameFolder, setFrameFolder] = useState('');
  const [outFolder,   setOutFolder]   = useState('');
  const [interval,    setInterval]    = useState(2);
  const [groupMode,   setGroupMode]   = useState(3); // 3 hoặc 4 ảnh/nhóm
  const [noSpeech,    setNoSpeech]    = useState(true); // không lời thoại mặc định
  const [autoCleanLogo, setAutoCleanLogo] = useState(false); // tự động xóa logo/watermark (luôn dùng crop)
  const [frames,      setFrames]      = useState([]);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [model,       setModel]       = useState('Veo 3.1 - Lite [Lower Priority]');
  const [duration,    setDuration]    = useState('8s');
  const [quality,     setQuality]     = useState('720p');

  // pipeline state
  const [running,     setRunning]     = useState(false);
  const [step,        setStep]        = useState('');
  const [stepErr,     setStepErr]     = useState('');
  const [jobs,        setJobs]        = useState([]);
  const [mergedPath,  setMergedPath]  = useState(null);
  const [previewUrl,  setPreviewUrl]  = useState(null);
  const [logs,        setLogs]        = useState([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const pauseResolverRef = useRef(null); // resolve khi resume

  const logListened = useRef(false);
  const taskIds        = useRef(new Set());
  const jobsRef        = useRef([]);
  const logEndRef      = useRef(null);
  const waitResolverRef = useRef(null); // resolver để event handler trigger waitAllDone

  // Gọi trong vòng lặp pipeline để chờ khi paused
  const pauseIfNeeded = () => {
    if (!pausedRef.current) return Promise.resolve();
    return new Promise(resolve => { pauseResolverRef.current = resolve; });
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      // Dừng: báo VeoEngine từ chối job mới
      window.electronAPI?.pauseVeo?.();
      addLog('⏸ Đã tạm dừng — job đang chạy sẽ hoàn tất, job chờ sẽ dừng lại. Nhấn Tiếp tục để chạy lại.', 'info');
    } else {
      // Tiếp tục: mở lại VeoEngine và giải phóng pipeline
      window.electronAPI?.resumeVeo?.();
      addLog('▶ Tiếp tục — đang retry các job bị tạm dừng...', 'info');
      if (pauseResolverRef.current) {
        pauseResolverRef.current();
        pauseResolverRef.current = null;
      }
    }
  };

  const addLog = (msg, type = 'info') => {
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => {
      const next = [...prev, { t, msg, type }];
      return next.length > 500 ? next.slice(-500) : next; // giới hạn 500 dòng tránh memory leak
    });
  };

  // keep jobsRef in sync for use inside promise
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  // auto-scroll log to bottom
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // sync duration when model changes
  useEffect(() => {
    if (model === 'Omni 1.1 Flash') { if (!TMPL_DURATIONS_OMNI.includes(duration)) setDuration('8s'); }
    else { if (!TMPL_DURATIONS_VEO.includes(duration)) setDuration('8s'); }
  }, [model]);

  // auto-switch model + duration khi đổi groupMode
  useEffect(() => {
    if (groupMode === 7) { setModel('Omni 1.1 Flash'); setDuration('10s'); }
    else { if (model === 'Omni 1.1 Flash') setModel('Veo 3.1 - Lite [Lower Priority]'); }
  }, [groupMode]);

  // Listener được đăng ký mỗi lần doStart, không dùng useEffect để tránh bị removeAllListeners kill
  const registerVeoListener = (addLogFn) => {
    const lastErrorByJob = {};
    const handler = (data) => {
      const { type, text } = data;
      const match = typeof text === 'string' ? text.match(/^\[JOBID:(.+?)\]\s*(.*)$/) : null;
      const jobId = match ? match[1] : null;
      const msg   = match ? match[2] : (text || '');
      if (!jobId || !taskIds.current.has(jobId)) return;

      const pathMatch = type === 'job_success' ? text?.match(/\|PATH:(.+)$/) : null;
      const fullPath  = pathMatch ? pathMatch[1].trim() : null;

      // Lưu lại error message cuối của mỗi job để gắn vào dòng Thất bại
      if (type === 'error' && msg.trim()) {
        lastErrorByJob[jobId] = msg.trim();
        addLogFn(`[${jobId.slice(-6)}] ⚠ ${msg}`, 'error');
      }

      if (type === 'job_start')   addLogFn(`[${jobId.slice(-6)}] Bắt đầu xử lý`, 'info');
      if (type === 'progress' && parseInt(msg) > 0) addLogFn(`[${jobId.slice(-6)}] Tiến độ: ${msg}%`, 'progress');
      if (type === 'job_success') addLogFn(`[${jobId.slice(-6)}] ✅ Hoàn thành${fullPath ? ': ' + fullPath.split(/[\\/]/).pop() : ''}`, 'success');
      if (type === 'job_fail') {
        const reason = lastErrorByJob[jobId] ? ` — ${lastErrorByJob[jobId].slice(0, 120)}` : '';
        addLogFn(`[${jobId.slice(-6)}] ❌ Thất bại${reason}`, 'error');
        delete lastErrorByJob[jobId];
      }
      if (type === 'success' && msg.includes('Lưu thành công')) addLogFn(`[${jobId.slice(-6)}] 💾 ${msg}`, 'success');
      if (!['job_start','job_success','job_fail','job_cancel','progress','error'].includes(type) && msg.trim())
        addLogFn(`[${jobId.slice(-6)}] ${msg}`, 'info');

      // Update ref đồng bộ ngay → waitAllDone đọc được
      const applyUpdate = (j) => {
        if (j.id !== jobId) return j;
        if (type === 'job_start')   return { ...j, status: 'running', progress: 0 };
        if (type === 'progress')    return { ...j, progress: Math.max(j.progress||0, parseInt(msg)||0) };
        if (type === 'job_success') return { ...j, status: 'done', progress: 100, files: fullPath ? [fullPath] : j.files };
        if (type === 'job_fail')    return { ...j, status: 'error' };
        if (type === 'success' && msg.includes('Lưu thành công') && !fullPath) {
          const fn = msg.match(/Lưu thành công.*:\s*(.+)$/)?.[1]?.trim();
          return fn ? { ...j, files: [...(j.files||[]), fn] } : j;
        }
        return j;
      };
      jobsRef.current = jobsRef.current.map(applyUpdate);
      setJobs(prev => prev.map(applyUpdate));

      // Nếu đang chờ waitAllDone và all jobs settled → resolve ngay, không chờ poll
      if (waitResolverRef.current) {
        const cur = jobsRef.current;
        const allSettled = cur.length > 0 && cur.every(j => j.status === 'done' || j.status === 'error' || j.status === 'skipped');
        if (allSettled) {
          const res = waitResolverRef.current;
          waitResolverRef.current = null;
          res(cur);
        }
      }
    };
    const wrapper = window.electronAPI?.onVeoLog?.(handler);
    return wrapper; // wrapper là fn thực đăng ký với ipcRenderer, dùng để removeListener
  };

  const pickVideo       = async () => { const f = await window.electronAPI.selectFile('video'); if (f) { setVideoFile(f); setFrames([]); setJobs([]); setMergedPath(null); setStepErr(''); setStep(''); taskIds.current.clear(); } };
  const pickFrameFolder = async () => { const f = await window.electronAPI.selectFolder(); if (f) setFrameFolder(f); };
  const pickOutFolder   = async () => { const f = await window.electronAPI.selectFolder(); if (f) setOutFolder(f); };

  const waitAllDone = (initJobs) => new Promise((resolve) => {
    const isAllSettled = (arr) => arr.length > 0 && arr.every(j => j.status === 'done' || j.status === 'error' || j.status === 'skipped');

    // Check ngay — phòng trường hợp jobs đã xong trước khi hàm này được gọi
    if (isAllSettled(jobsRef.current)) { resolve(jobsRef.current); return; }

    // Đăng ký resolver để event handler gọi ngay khi job cuối xong
    waitResolverRef.current = resolve;

    // Fallback poll: timeout 8 phút/running job + deadlock detector cho pending
    const JOB_TIMEOUT_MS = 8 * 60 * 1000;
    const DEADLOCK_MS    = 5 * 60 * 1000; // 5 phút không có gì thay đổi → coi là đơ
    const jobStartTime = {};
    let lastSettledCount = jobsRef.current.filter(j => j.status !== 'pending').length;
    let lastActivityTime = Date.now();

    const check = setInterval(() => {
      // Nếu đã resolve rồi (event handler trigger trước) → dọn interval
      if (!waitResolverRef.current) { clearInterval(check); return; }

      const cur = jobsRef.current;
      const now = Date.now();
      let forceUpdated = false;

      // Theo dõi hoạt động — reset đồng hồ khi có job nào đổi trạng thái
      const settledCount = cur.filter(j => j.status !== 'pending').length;
      if (settledCount !== lastSettledCount) { lastSettledCount = settledCount; lastActivityTime = now; }

      // Deadlock: không có gì thay đổi 5 phút → force tất cả pending/running → error
      if (now - lastActivityTime > DEADLOCK_MS) {
        addLog('⚠ Không có tiến độ trong 5 phút — tự động chuyển sang retry...', 'error');
        const next = cur.map(j =>
          (j.status === 'pending' || j.status === 'running') ? { ...j, status: 'error' } : j
        );
        jobsRef.current = next; setJobs(next);
        clearInterval(check);
        const res = waitResolverRef.current;
        waitResolverRef.current = null;
        if (res) res(next);
        return;
      }

      const next = cur.map(j => {
        if (j.status === 'running') {
          if (!jobStartTime[j.id]) jobStartTime[j.id] = now;
          if (now - jobStartTime[j.id] > JOB_TIMEOUT_MS) {
            addLog(`[${j.id.slice(-6)}] ⏰ Timeout 8 phút — đánh dấu lỗi`, 'error');
            forceUpdated = true;
            return { ...j, status: 'error' };
          }
        } else { delete jobStartTime[j.id]; }
        return j;
      });
      if (forceUpdated) { jobsRef.current = next; setJobs(next); }

      if (isAllSettled(jobsRef.current)) {
        clearInterval(check);
        const res = waitResolverRef.current;
        waitResolverRef.current = null;
        if (res) res(jobsRef.current);
      }
    }, 1500);
  });

  // retryRound: submit lại các job lỗi, trả về true nếu còn job lỗi
  const retryRound = async (roundLabel, allFrames, payload) => {
    const cur = jobsRef.current;
    const failedJobs = cur.filter(j => j.status === 'error');
    if (failedJobs.length === 0) return false;
    addLog(`🔄 ${roundLabel}: thử lại ${failedJobs.length} video lỗi...`, 'info');

    const retryTasks = failedJobs.map(j => {
      // label format: "Nhóm X (ảnh A-B-C)"
      const fi = j.frameIndices;
      if (!fi) return null;
      const newId = `retry_${Date.now()}_${fi[0]}`;
      taskIds.current.add(newId);
      // Update cả jobsRef.current (để waitAllDone theo dõi đúng) và React state
      jobsRef.current = jobsRef.current.map(jj => jj.id === j.id ? { ...jj, id: newId, status: 'pending', progress: 0 } : jj);
      setJobs(prev => prev.map(jj => jj.id === j.id ? { ...jj, id: newId, status: 'pending', progress: 0 } : jj));
      return {
        id: newId,
        prompt: (() => { const nums = fi.map(i=>i+1); const suf = payload._speechSuffix || ''; const pfx = payload._silentPrefix || ''; return `${pfx}Smooth seamless video that flows through scenes ${nums.join(', ')} in order. No text, no logos, no watermarks, no subtitles. Keep same characters/people/animals throughout. Cinematic transitions only.${suf}`; })(),
        ingredientImages: fi.map(idx => allFrames[idx].path),
        _tmplMode: true,
        fileIndex: fi[0] + 1,
      };
    }).filter(Boolean);

    if (retryTasks.length === 0) return false;
    const retryPayload = { ...payload, tasks: retryTasks };
    await window.electronAPI.runVeo(retryPayload);
    await waitAllDone(retryTasks.map(t => ({ id: t.id })));
    return jobsRef.current.some(j => j.status === 'error');
  };

  const doStart = async () => {
    if (!videoFile)   return setStepErr('Chưa chọn video gốc');
    if (!frameFolder) return setStepErr('Chưa chọn thư mục lưu khung hình');
    if (!outFolder)   return setStepErr('Chưa chọn thư mục lưu video');
    setRunning(true); setPaused(false); pausedRef.current = false; pauseResolverRef.current = null;
    window.electronAPI?.resumeVeo?.(); // reset VeoEngine._paused về false trước khi chạy mới
    setStepErr(''); setFrames([]); setJobs([]); setMergedPath(null); setLogs([]); taskIds.current.clear();
    jobsRef.current = [];
    waitResolverRef.current = null;
    // Đăng ký listener mới mỗi lần chạy, lưu wrapper để removeListener đúng handler
    const _veoWrapper = registerVeoListener(addLog);

    try {
      // ── Bước 1: Trích xuất khung hình ────────────────────────────────────
      setStep('⏳ Bước 1/3 — Đang trích xuất khung hình...');
      addLog(`▶ Bắt đầu trích xuất khung hình (cách ${interval}s)`, 'info');
      addLog(`  Video: ${videoFile}`, 'info');
      addLog(`  Thư mục ảnh: ${frameFolder}`, 'info');
      const extRes = await window.electronAPI.extractImages({ inputPath: videoFile, interval, outputFolder: frameFolder });
      if (!extRes?.success) throw new Error('Trích xuất thất bại: ' + (extRes?.error || ''));
      const extractedFrames = extRes.files || [];
      setFrames(extractedFrames);
      if (extractedFrames.length < 2) throw new Error('Cần ít nhất 2 khung hình (video quá ngắn hoặc interval quá lớn)');
      addLog(`✅ Trích xuất xong: ${extractedFrames.length} ảnh → sẽ tạo ${extractedFrames.length - 1} video`, 'success');
      setStep(`✅ Bước 1/3 — Đã trích xuất ${extractedFrames.length} khung hình`);

      // ── Bước 1.5: Inpaint xóa logo khỏi ảnh gốc + thêm prompt dặn Veo ──────
      // Phải sửa ảnh tham chiếu — prompt đơn thuần không đủ mạnh để override visual input
      const logoPromptSuffix = ' Erase all text, logos, watermarks and channel names from every corner of every reference image. Output must be 100% clean — no text or branding anywhere.';
      if (autoCleanLogo) {
        const useCrop = true;
        addLog(`🔍 Phân tích và ${useCrop ? 'cắt xén' : 'xóa'} logo khỏi ${extractedFrames.length} ảnh tham chiếu...`, 'info');
        setStep(`⏳ Bước 1.5/3 — Đang ${useCrop ? 'cắt xén' : 'xóa'} logo khỏi ảnh...`);
        const _wmWrapper = window.electronAPI?.onWatermarkLog?.((d) => {
          if (d.type === 'info')       addLog(`  ℹ️ ${d.text}`, 'info');
          else if (d.type === 'error') addLog(`  ⚠️ ${d.text}`, 'warn');
          else if (d.type === 'regions') {
            if (d.regions?.length === 0) addLog('  ℹ️ Không phát hiện logo nào', 'info');
            else addLog(`  🎯 Phát hiện ${d.regions.length} vùng logo — đang ${useCrop ? 'cắt xén cạnh ảnh' : 'xóa khỏi ảnh'}...`, 'info');
          } else if (d.type === 'progress') {
            setStep(`⏳ ${useCrop ? 'Cắt xén' : 'Xóa logo'}: ${d.done}/${d.total} ảnh...`);
            if (d.done === d.total) addLog(`  ✅ ${useCrop ? 'Cắt xén' : 'Xóa logo'} xong: ${d.total} ảnh`, 'success');
          }
        });
        try {
          const apiCall = useCrop
            ? window.electronAPI?.autoCropWatermark?.({ folder: frameFolder })
            : window.electronAPI?.autoRemoveWatermark?.({ folder: frameFolder });
          const wmRes = await apiCall;
          if (wmRes?.success && wmRes?.regions?.length > 0) {
            const detail = useCrop && wmRes?.crop
              ? ` (cắt còn ${wmRes.crop.new_w}×${wmRes.crop.new_h}px)`
              : '';
            addLog(`✅ ${useCrop ? 'Cắt xén' : 'Xóa'} logo khỏi ảnh: ${wmRes.regions.length} vùng / ${wmRes.total} ảnh${detail}`, 'success');
          } else if (wmRes?.regions?.length === 0) {
            addLog('  ℹ️ Không phát hiện logo — ảnh giữ nguyên', 'info');
          } else {
            addLog(`⚠️ Xử lý logo thất bại: ${wmRes?.error} — Tiếp tục với ảnh gốc`, 'warn');
          }
        } catch (e) {
          addLog(`⚠️ Lỗi xử lý logo: ${e.message} — Tiếp tục với ảnh gốc`, 'warn');
        } finally {
          if (_wmWrapper) window.electronAPI?.removeListener?.('watermark-log', _wmWrapper);
        }
        setStep('✅ Bước 1.5/3 — Đã xử lý ảnh tham chiếu');
      }

      // ── Bước 2: Gửi lên Veo ─────────────────────────────────────────────────
      // groupMode=3: 1-2-3, 4-5-6...        (Veo r2v, ổn định)
      // groupMode=7: 1-2-3-4-5-6-7, 8-9-10-11-12-13-14 (Omni Flash 10s)
      const G = groupMode;
      // Prefix im lặng đặt ở ĐẦU prompt để Veo ưu tiên cao nhất
      const silentPrefix = noSpeech
        ? '[SILENT FILM — ABSOLUTELY NO HUMAN SPEECH] No talking, no dialogue, no voice, no narration, no singing, no whispering. Every character moves without making any vocal sound. Ambient background audio only (wind, nature, footsteps). '
        : '';
      const buildPrompt = (nums) => {
        const sceneList = nums.join(', ');
        const count = nums.length;
        const flow = count <= 3
          ? `flows through scenes ${sceneList} in order`
          : `flows through scenes ${sceneList} in sequence`;
        return `${silentPrefix}Smooth seamless video that ${flow}. No text, no logos, no watermarks, no subtitles. Keep same characters/people/animals throughout. Cinematic transitions only.${logoPromptSuffix}`;
      };
      const speechSuffix = (noSpeech
        ? ' [SILENT FILM] No speech, no dialogue, no voice, no talking, no narration, no singing. Ambient sound only.'
        : '') + logoPromptSuffix;
      const triplets = [];
      for (let i = 0; i + (G - 1) < extractedFrames.length; i += G) {
        triplets.push(Array.from({ length: G }, (_, k) => i + k));
      }
      if (triplets.length === 0) throw new Error(`Cần ít nhất ${G} khung hình để tạo video`);

      setStep(`⏳ Bước 2/3 — Đang gửi ${triplets.length} nhóm vào Veo...`);
      addLog(`▶ Chuẩn bị ${triplets.length} nhóm ảnh (${G} ảnh/nhóm, bước ${G})...`, 'info');
      addLog(`  Model: ${model} | Thời lượng: ${duration} | Chất lượng: ${quality} | Tỉ lệ: ${aspectRatio}`, 'info');

      const tasks = triplets.map((indices, idx) => {
        const id = `tmpl_${Date.now()}_${idx}`;
        const nums = indices.map(i => i + 1);
        return {
          id, _tmplMode: true,
          prompt: buildPrompt(nums),
          ingredientImages: indices.map(i => extractedFrames[i].path),
          fileIndex: idx + 1,
          _frameIndices: indices,
        };
      });
      tasks.forEach((t, idx) => {
        taskIds.current.add(t.id);
        addLog(`  Nhóm ${idx+1}: ảnh #${triplets[idx].map(i => i+1).join('-')}`, 'info');
      });

      const initJobs = tasks.map((t, idx) => {
        const nums = triplets[idx].map(i => i+1);
        return { id: t.id, label: `Nhóm ${idx+1} (${nums.join('-')})`, frameIndices: triplets[idx], status: 'pending', progress: 0, files: [] };
      });
      setJobs(initJobs);
      jobsRef.current = initJobs;

      addLog(`▶ Gửi ${tasks.length} task lên Veo...`, 'info');
      const payload = { mediaType: 'Video', tasks, aspectRatio, model, outputFolder: outFolder, genCount: '1x', quality, duration, _speechSuffix: speechSuffix, _silentPrefix: silentPrefix };
      const veoRes = await window.electronAPI.runVeo(payload);
      if (veoRes?.error) throw new Error(veoRes.error);
      addLog(`✅ Đã gửi vào hàng đợi — đang chờ Veo xử lý...`, 'success');
      setStep(`⏳ Bước 2/3 — Đang chờ Veo tạo ${tasks.length} video...`);

      // ── Chờ xong + retry phase 1 (tối đa 5 lần) ─────────────────────────
      await waitAllDone(initJobs);
      // Chờ nếu user đang tạm dừng (sau khi tất cả job settle — kể cả job bị từ chối do pause)
      await pauseIfNeeded();
      for (let r = 1; r <= 5; r++) {
        const hasErr = jobsRef.current.some(j => j.status === 'error');
        if (!hasErr) break;
        setStep(`⏳ Bước 2/3 — Retry lần ${r}/5...`);
        const stillErr = await retryRound(`Retry ${r}/5`, extractedFrames, payload);
        await pauseIfNeeded();  // chờ nếu user tạm dừng sau mỗi retry
        if (!stillErr) break;
      }

      // đánh dấu job vẫn lỗi là 'skipped' (phase 1 failed)
      setJobs(prev => prev.map(j => j.status === 'error' ? { ...j, status: 'skipped' } : j));
      jobsRef.current = jobsRef.current.map(j => j.status === 'error' ? { ...j, status: 'skipped' } : j);

      const afterPhase1 = jobsRef.current;
      const skip1 = afterPhase1.filter(j => j.status === 'skipped').length;
      const done1  = afterPhase1.filter(j => j.status === 'done').length;
      addLog(`📊 Sau phase 1: ${done1} OK, ${skip1} bỏ qua`, done1 > 0 ? 'success' : 'error');

      // ── Retry phase 2: lại 5 lần cho các job bị skip ─────────────────────
      if (skip1 > 0) {
        addLog(`🔁 Phase 2: thử lại ${skip1} video bị bỏ qua...`, 'info');
        setStep(`⏳ Bước 2/3 — Phase 2: retry ${skip1} video bị bỏ...`);
        // reset skipped → error để retryRound bắt được
        setJobs(prev => prev.map(j => j.status === 'skipped' ? { ...j, status: 'error' } : j));
        jobsRef.current = jobsRef.current.map(j => j.status === 'skipped' ? { ...j, status: 'error' } : j);
        for (let r = 1; r <= 5; r++) {
          const hasErr = jobsRef.current.some(j => j.status === 'error');
          if (!hasErr) break;
          await pauseIfNeeded();
          setStep(`⏳ Bước 2/3 — Phase 2, retry lần ${r}/5...`);
          const stillErr = await retryRound(`Phase2 retry ${r}/5`, extractedFrames, payload);
          if (!stillErr) break;
        }
        // job vẫn lỗi sau phase 2 → bỏ hẳn
        setJobs(prev => prev.map(j => j.status === 'error' ? { ...j, status: 'skipped' } : j));
        jobsRef.current = jobsRef.current.map(j => j.status === 'error' ? { ...j, status: 'skipped' } : j);
      }

      const finalJobs = jobsRef.current;
      const doneFiles = finalJobs.filter(j => j.status === 'done').flatMap(j => j.files || []).filter(Boolean);
      const errCount  = finalJobs.filter(j => j.status === 'skipped').length;
      if (doneFiles.length === 0) throw new Error('Tất cả video đều thất bại sau 2 phase retry');
      addLog(`✅ Hoàn tất: ${doneFiles.length} video OK${errCount > 0 ? `, ${errCount} bỏ qua` : ''}`, 'success');
      setStep(`✅ Bước 2/3 — ${doneFiles.length} video hoàn thành${errCount > 0 ? `, ${errCount} bỏ qua` : ''}`);

      // ── Bước 3: Ghép video ────────────────────────────────────────────────
      if (doneFiles.length >= 2) {
        setStep('⏳ Bước 3/3 — Đang ghép video...');
        addLog(`▶ Ghép ${doneFiles.length} video lại thành 1 file...`, 'info');
        addLog(`  Thư mục đầu ra: ${outFolder}`, 'info');
        const outName = `template_merged_${Date.now()}`;
        const mr = await window.electronAPI.mergeVideo({
          files: doneFiles, trimStart: 0, trimEnd: 0,
          transition: 'Không có',
          outputFolder: outFolder, outputName: outName,
        });
        if (!mr?.success || !mr?.path) throw new Error(mr?.error || 'Ghép video thất bại');
        setMergedPath(mr.path);
        setPreviewUrl(`file:///${encodeURI(mr.path.replace(/\\/g,'/'))}`);
        addLog(`✅ Ghép xong: ${mr.path}`, 'success');
        setStep(`✅ Hoàn tất! Đã ghép ${doneFiles.length} video thành công`);
      } else {
        addLog(`ℹ Chỉ có ${doneFiles.length} video — bỏ qua bước ghép`, 'info');
        setStep(`✅ Xong! Chỉ có ${doneFiles.length} video — không cần ghép`);
      }
      addLog('🎉 Pipeline hoàn tất!', 'success');
    } catch(e) {
      addLog(`❌ Lỗi: ${e.message}`, 'error');
      setStepErr(e.message);
      setStep('');
    } finally {
      if (_veoWrapper) window.electronAPI?.removeListener?.('veo-log', _veoWrapper);
      setRunning(false);
    }
  };

  const doneCount    = jobs.filter(j => j.status === 'done').length;
  const runningCount = jobs.filter(j => j.status === 'running').length;
  const canStart     = !!videoFile && !!frameFolder && !!outFolder && !running;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* LEFT: controls */}
      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto p-4 border-r border-slate-800">
        <div className="text-sm font-bold text-cyan-400 flex items-center gap-2"><Video size={14}/> Dựng Video Theo Mẫu</div>

        {/* 1. Video gốc */}
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">1. Video gốc</div>
          {videoFile
            ? <div className="bg-slate-900/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 break-all">{videoFile}</div>
            : <div className="text-[10px] text-slate-600 italic">Chưa chọn video</div>}
          <button onClick={pickVideo} disabled={running} className="w-full py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5"><FolderOpen size={11}/> Chọn video</button>
        </div>

        {/* 2. Thư mục ảnh */}
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">2. Trích xuất khung hình</div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-slate-400 shrink-0">Cách (s):</label>
            <input type="number" min={1} max={120} value={interval} onChange={e=>setInterval(+e.target.value)} disabled={running}
              className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white text-center disabled:opacity-50"/>
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">Thư mục lưu ảnh:</div>
          {frameFolder
            ? <div className="bg-slate-900/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 break-all">{frameFolder}</div>
            : <div className="text-[10px] text-slate-600 italic">Chưa chọn thư mục</div>}
          <button onClick={pickFrameFolder} disabled={running} className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5"><FolderOpen size={11}/> Chọn thư mục lưu ảnh</button>
        </div>

        {/* 3. Cài đặt Veo */}
        <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 space-y-2">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">3. Cài đặt Veo I2V</div>
          {/* Chế độ nhóm ảnh */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-slate-500 uppercase">Chế độ nhóm ảnh</label>
            <div className="flex gap-1.5">
              {[3, 7].map(g => (
                <button key={g} onClick={() => !running && setGroupMode(g)} disabled={running}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-50 ${groupMode === g ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'}`}>
                  {g} ảnh{g >= 4 ? ' (Omni)' : ''}
                </button>
              ))}
            </div>
            {groupMode === 7 && <p className="text-[9px] text-amber-400">⚡ Omni Flash 10s — tự động chọn</p>}
          </div>
          {/* Tự động xóa logo */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-[10px] text-slate-300 font-semibold">Tự động dò &amp; cắt logo</div>
              <div className="text-[9px] text-slate-500">{autoCleanLogo ? 'Phát hiện logo → cắt xén cạnh ảnh cho sạch' : 'Bỏ qua bước xử lý logo'}</div>
            </div>
            <div onClick={() => !running && setAutoCleanLogo(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${autoCleanLogo ? 'bg-orange-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoCleanLogo ? 'left-5' : 'left-0.5'}`}/>
            </div>
          </div>
          {/* Lời thoại */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-[10px] text-slate-300 font-semibold">Lời thoại trong video</div>
              <div className="text-[9px] text-slate-500">{noSpeech ? 'Không phát ra tiếng nói / lời thoại' : 'Cho phép có lời thoại'}</div>
            </div>
            <div onClick={() => !running && setNoSpeech(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${!noSpeech ? 'bg-green-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${!noSpeech ? 'left-5' : 'left-0.5'}`}/>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-slate-500 uppercase">Model AI</label>
            <select value={model} onChange={e=>setModel(e.target.value)} disabled={running}
              className="w-full bg-[#1e293b] border border-blue-500/50 text-blue-300 text-[11px] font-semibold rounded-lg px-2 py-1.5 outline-none cursor-pointer disabled:opacity-50">
              <option value="Veo 3.1 - Lite [Lower Priority]">Veo 3.1 - Lite [Lower Priority]</option>
              <option value="Omni 1.1 Flash">Omni 1.1 Flash r2v (4/6/8/10s)</option>
            </select>
            {model === 'Omni 1.1 Flash' && <p className="text-[9px] text-amber-400">⚡ 30 tín dụng / video</p>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-slate-500 uppercase">Tỉ lệ</label>
              <select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)} disabled={running}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white disabled:opacity-50">
                {['16:9','4:3','1:1','3:4','9:16'].map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-blue-400 uppercase">Thời lượng</label>
              <select value={duration} onChange={e=>setDuration(e.target.value)} disabled={running}
                className="bg-[#1e293b] border border-blue-500/50 text-blue-300 font-bold rounded px-1.5 py-1 text-[10px] disabled:opacity-50">
                {(model === 'Omni 1.1 Flash' ? TMPL_DURATIONS_OMNI : TMPL_DURATIONS_VEO).map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] text-slate-500 uppercase">Chất lượng</label>
              <select value={quality} onChange={e=>setQuality(e.target.value)} disabled={running}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white disabled:opacity-50">
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </div>
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">Thư mục lưu video:</div>
          {outFolder
            ? <div className="bg-slate-900/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 break-all">{outFolder}</div>
            : <div className="text-[10px] text-slate-600 italic">Chưa chọn thư mục</div>}
          <button onClick={pickOutFolder} disabled={running} className="w-full py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5"><FolderOpen size={11}/> Chọn thư mục lưu video</button>
        </div>

        {/* Nút Bắt đầu + Tạm dừng */}
        <div className="flex gap-2">
          <button onClick={doStart} disabled={!canStart}
            className="flex-1 py-3 bg-gradient-to-r from-cyan-600 to-green-600 hover:from-cyan-500 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-black rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all">
            {running && !paused ? <><Loader2 size={14} className="animate-spin"/> Đang chạy...</> : <><Play size={14}/> Bắt đầu</>}
          </button>
          {running && (
            <button onClick={togglePause}
              className={`px-4 py-3 rounded-xl text-[13px] font-black flex items-center gap-1.5 transition-all shadow-lg ${
                paused
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-white'
              }`}>
              {paused ? <><Play size={14}/> Tiếp</> : <><Pause size={14}/> Dừng</>}
            </button>
          )}
        </div>
        {paused && (
          <div className="text-[11px] font-semibold px-3 py-2 rounded-lg border text-amber-300 bg-amber-900/20 border-amber-700/40 flex items-center gap-2">
            <Pause size={11}/> Đã tạm dừng — nhấn Tiếp để chạy lại
          </div>
        )}

        {/* Status */}
        {step && (
          <div className={`text-[11px] font-semibold px-3 py-2 rounded-lg border ${step.startsWith('✅') ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-blue-300 bg-blue-900/20 border-blue-700/40'}`}>
            {step}
          </div>
        )}
        {stepErr && (
          <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-700/40 px-3 py-2 rounded-lg">❌ {stepErr}</div>
        )}

        {/* Kết quả ghép */}
        {mergedPath && (
          <div className="bg-slate-800/40 border border-violet-700/40 rounded-xl p-3 space-y-2">
            <div className="text-[10px] font-bold text-violet-400 uppercase">Video hoàn chỉnh</div>
            <div className="bg-slate-900/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 break-all">{mergedPath}</div>
            <div className="flex gap-2">
              <button onClick={()=>window.electronAPI.openFolder(outFolder)} className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded-lg">📁 Mở thư mục</button>
              <button onClick={()=>window.electronAPI.openFile(mergedPath)} className="flex-1 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-[10px] font-bold rounded-lg">▶ Mở video</button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: frames + jobs + preview + log */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top area: thumbnails + jobs + preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Thumbnails strip */}
          {frames.length > 0 && (
            <div className="p-3 border-b border-slate-800 bg-slate-900/30 shrink-0">
              <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Khung hình ({frames.length})</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {frames.map((f, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 shrink-0">
                    <img src={`file:///${encodeURI(f.path.replace(/\\/g,'/'))}`} className="w-20 h-14 object-cover rounded border border-slate-600"/>
                    <span className="text-[9px] text-slate-500">#{i+1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jobs + preview */}
          {jobs.length > 0 ? (
            <div className="flex flex-1 overflow-hidden">
              {/* Job list */}
              <div className="w-48 shrink-0 overflow-y-auto border-r border-slate-800 p-2 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 px-1">Tiến trình ({jobs.filter(j=>j.status==='done').length}/{jobs.length})</div>
                {jobs.map(j => {
                  const sColor = j.status==='done'?'text-green-400':j.status==='running'?'text-blue-400':j.status==='error'?'text-red-400':'text-slate-500';
                  const sIcon  = j.status==='done'?'✅':j.status==='running'?'⏳':j.status==='error'?'❌':'⏸';
                  const hasFile = j.files?.length > 0;
                  return (
                    <div key={j.id} onClick={()=>{if(hasFile){const p=j.files[0];setPreviewUrl(p.startsWith('file://')?p:`file:///${encodeURI(p.replace(/\\/g,'/'))}`);}}}
                      className={`flex flex-col gap-1 p-2 rounded-lg border transition-all cursor-pointer
                        ${hasFile?'border-green-700/40 bg-green-900/10 hover:bg-green-900/20':'border-slate-700/40 bg-slate-800/30'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-300">{j.label}</span>
                        <span className={`text-[10px] ${sColor}`}>{sIcon}</span>
                      </div>
                      {j.status==='running' && (
                        <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{width:`${j.progress||0}%`}}/>
                        </div>
                      )}
                      {hasFile && <div className="text-[9px] text-green-400">▶ Nhấn xem</div>}
                    </div>
                  );
                })}
              </div>
              {/* Video preview */}
              <div className="flex-1 flex items-center justify-center bg-black/40 p-3 overflow-y-auto">
                {mergedPath ? (
                  <div className="flex flex-col items-center gap-3 w-full max-w-2xl">
                    <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">🎬 Video hoàn chỉnh đã ghép</div>
                    <video key={mergedPath} src={`file:///${encodeURI(mergedPath.replace(/\\/g,'/'))}`} controls autoPlay className="w-full rounded-xl border border-violet-600 shadow-2xl max-h-[55vh]"/>
                    <div className="text-[10px] text-slate-400 truncate">{mergedPath.replace(/\\/g,'/').split('/').pop()}</div>
                  </div>
                ) : previewUrl ? (
                  <div className="flex flex-col items-center gap-3 w-full max-w-2xl">
                    <video key={previewUrl} src={previewUrl.startsWith('file://')?previewUrl:`file:///${encodeURI(previewUrl.replace(/\\/g,'/'))}`} controls autoPlay className="w-full rounded-xl border border-slate-700 shadow-2xl max-h-[45vh]"/>
                    <div className="text-[10px] text-slate-400 truncate">{previewUrl.split('/').pop()}</div>
                  </div>
                ) : (
                  <div className="text-center text-slate-600">
                    <Film size={32} className="mx-auto mb-2 opacity-30"/>
                    <p className="text-[11px]">Nhấn vào video đã hoàn thành để xem trước</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            logs.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-slate-700">
                <div className="text-center">
                  <Video size={44} className="mx-auto mb-3 opacity-20"/>
                  <p className="text-[12px]">Chọn video gốc và nhấn Bắt đầu để chạy tự động</p>
                </div>
              </div>
            )
          )}
        </div>

        {/* Bottom: Log panel */}
        <div className="h-48 shrink-0 border-t border-slate-700/60 bg-[#060c18] flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal size={11} className="text-green-400"/>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Log</span>
              {running && <span className="text-[9px] text-blue-400 animate-pulse">● đang chạy</span>}
            </div>
            <button onClick={()=>setLogs([])} className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors">Xóa</button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 font-mono">
            {logs.length === 0
              ? <div className="text-[10px] text-slate-700 italic">Chưa có log...</div>
              : logs.map((l, i) => (
                  <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
                    <span className="text-slate-600 shrink-0">{l.t}</span>
                    <span className={
                      l.type==='success' ? 'text-green-400' :
                      l.type==='error'   ? 'text-red-400'   :
                      l.type==='progress'? 'text-blue-400'  :
                      'text-slate-300'
                    }>{l.msg}</span>
                  </div>
                ))
            }
            <div ref={logEndRef}/>
          </div>
        </div>

      </div>
    </div>
  );
}

const SUB = [
  { id:'idea',        label:'Idea to Video',         icon:Zap,       color:'bg-violet-600' },
  { id:'script2vid',  label:'Script to Video',        icon:FileText,  color:'bg-green-600'  },
  { id:'audio',       label:'Audio to Video',         icon:Music2,    color:'bg-blue-600'   },
  { id:'url2vid',     label:'Url to Video',            icon:Link,      color:'bg-rose-600'   },
  { id:'subtitle',    label:'Bóc tách - Dịch phụ đề', icon:Languages, color:'bg-amber-600'  },
  { id:'storyboard',  label:'Storyboard',              icon:Film,      color:'bg-pink-600'   },
  { id:'template',    label:'Dựng Mẫu',                icon:Video,     color:'bg-cyan-600'   },
];

const AA_HELP = [
  { id:'idea', icon:'💡', color:'text-violet-400', label:'Idea to Video',
    desc:'Nhập ý tưởng → AI viết kịch bản → tự động tạo ảnh DNA → tạo video từng cảnh → ghép thành video hoàn chỉnh. Pipeline toàn tự động từ ý tưởng đến video.' },
  { id:'script2vid', icon:'📄', color:'text-green-400', label:'Script to Video',
    desc:'Upload kịch bản có sẵn → AI phân cảnh → tạo ảnh tham chiếu từng cảnh → tạo video Veo theo thứ tự. Dùng khi đã có script, muốn bỏ qua bước viết kịch bản.' },
  { id:'audio', icon:'🎵', color:'text-blue-400', label:'Audio to Video',
    desc:'Upload file MP3/audio → AI phân tích nội dung → tự tạo ảnh + video theo từng đoạn audio. Phù hợp podcast, bài giảng, audio book muốn chuyển thành video.' },
  { id:'url2vid', icon:'🔗', color:'text-rose-400', label:'URL to Video',
    desc:'Nhập link YouTube/TikTok → AI tải, phân tích transcript → viết kịch bản mới → tạo ảnh DNA nhân vật/bối cảnh → tạo video. Remix nội dung từ video bất kỳ.' },
  { id:'subtitle', icon:'💬', color:'text-amber-400', label:'Bóc tách - Dịch phụ đề',
    desc:'Upload video → Whisper bóc tách lời thoại → AI dịch sang ngôn ngữ mục tiêu → xuất file SRT. Hỗ trợ 50+ ngôn ngữ, fallback Gemini nếu Whisper cục bộ lỗi.' },
  { id:'storyboard', icon:'🎬', color:'text-pink-400', label:'Storyboard',
    desc:'Tạo storyboard trực quan từ kịch bản. Upload ảnh tham chiếu nhân vật → AI phân cảnh → tạo ảnh minh họa từng cảnh → xuất PDF/PNG storyboard. Hỗ trợ đặt tên nhân vật để AI giữ nhất quán.' },
  { id:'template', icon:'🎞️', color:'text-cyan-400', label:'Dựng Mẫu',
    desc:'Upload video gốc → trích xuất khung hình theo khoảng cách (mặc định 8s/ảnh) → dùng Veo I2V tạo video liền mạch từng cặp ảnh liền kề (1→2, 2→3...) → lưu về thư mục.' },
];

function AAHelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d1321] border border-slate-700/60 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#0d1321]">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <h2 className="text-sm font-bold text-white">Hướng dẫn Auto Animation</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3">
          {AA_HELP.map(h=>(
            <div key={h.id} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base">{h.icon}</span>
                <span className={`text-[11px] font-black uppercase tracking-wider ${h.color}`}>{h.label}</span>
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed">{h.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// BilibiliReupPanel — moved to ReupVideoPanel.jsx

export default function AutoAnimation() {
  const [panel, setPanel] = useState('idea');
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="flex flex-col h-full w-full bg-[#080e1a]">
      {showHelp && <AAHelpModal onClose={()=>setShowHelp(false)}/>}
      <div className="h-11 shrink-0 flex items-center gap-3 px-5 border-b border-slate-800/80 bg-[#0a0f1e]">
        <div className="flex items-center gap-1.5 font-bold text-sm text-white">
        </div>
        <div className="flex items-center gap-1">
          {SUB.map(p=>{
            const Ic=p.icon; const on=panel===p.id;
            return (
              <button key={p.id} onClick={()=>setPanel(p.id)}
                className={cn('flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all',
                  on ? `${p.color} text-white` : 'text-slate-400 hover:text-white hover:bg-slate-800/50')}>
                <Ic size={14}/> {p.label}
              </button>
            );
          })}
        </div>
        <button onClick={()=>setShowHelp(true)} className="ml-auto w-7 h-7 rounded-full border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[11px] font-black flex items-center justify-center transition-colors" title="Hướng dẫn">?</button>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex" style={{ display: panel === 'idea'       ? 'flex' : 'none' }}><IdeaToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'script2vid'? 'flex' : 'none' }}><ScriptToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'audio'     ? 'flex' : 'none' }}><AudioToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'subtitle'  ? 'flex' : 'none' }}><SubtitlePanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'url2vid'   ? 'flex' : 'none' }}><UrlToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'storyboard'? 'flex' : 'none' }}><StoryboardPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'template'   ? 'flex' : 'none' }}><TemplateVideoPanel/></div>
      </div>
    </div>
  );
}