import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateCinematicPrompts } from '../services/geminiPrompt';
import { generateScript } from '../services/scriptGenerator';
import { analyzeAndCloneScript, uploadVideoToGemini } from '../services/geminiClone';
import {
  transcribeAudio, transcribeAudioChunked,
  createTimeBasedChunks, createNaturalChunks,
  analyzeScenes, analyzeOverallContent,
  exportToTxt, exportToJson, exportToMarkdown
} from '../services/audioToVideo';
import { transcribeLocalChunked } from '../services/whisperLocal.js';
import { retryWithKeyRotation } from '../services/keyRotation.js';
import {
  Play, Square, Pause, FolderOpen, CheckCircle2, Loader2, Zap, Music2,
  AlertCircle, ChevronRight, ChevronLeft, Film, Image as ImageIcon, Sparkles,
  FileText, Brain, Layers, Copy, Check, ChevronDown, ChevronUp,
  Video, Scissors, ExternalLink, Cpu, Wand2,
  UploadCloud, Download, Clock, Mic, RefreshCw,
  Languages, Flame, Terminal, Link, Volume2, VolumeX, X, Users, ImagePlus,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const LS_KEYS = 'fluxy_gemini_api_keys';

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
const RATIOS    = ['9:16', '16:9', '1:1'];
const DURS_VEO  = [4, 6, 8];
const IMG_MDL   = ['Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];
const VID_MDL   = ['Veo 3.1 - Lite [Lower Priority]', 'Veo 3.1 - Lite (Fast)', 'Veo 3.1 - Fast (Balanced)', 'Omni Flash'];
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

// ── Strip prominent people / real names khỏi prompt ─────────────────────────
// Veo lỗi PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED khi prompt chứa tên thật người nổi tiếng
// Hàm này thay thế tên riêng bằng mô tả vai trò chung chung
const PERSON_REPLACE_MAP = [
  // Chính trị / lãnh đạo
  [/\b(Joe Biden|Donald Trump|Barack Obama|Vladimir Putin|Xi Jinping|Elon Musk|Bill Gates|Steve Jobs|Jeff Bezos|Mark Zuckerberg|Tim Cook|Sundar Pichai|Sam Altman)\b/gi, 'a prominent leader'],
  // Nghệ sĩ / giải trí
  [/\b(Taylor Swift|Beyoncé|Beyonce|Justin Bieber|Adele|Ed Sheeran|Rihanna|Lady Gaga|Eminem|Drake|BTS|Blackpink|Sơn Tùng|Son Tung)\b/gi, 'a famous musician'],
  [/\b(Tom Hanks|Leonardo DiCaprio|Brad Pitt|Angelina Jolie|Scarlett Johansson|Robert Downey|Chris Evans|Dwayne Johnson|Will Smith|Keanu Reeves)\b/gi, 'a famous actor'],
  // Thể thao
  [/\b(Cristiano Ronaldo|Lionel Messi|LeBron James|Michael Jordan|Kobe Bryant|Neymar|Zlatan|Roger Federer|Serena Williams|Usain Bolt)\b/gi, 'a world-class athlete'],
  // Nhân vật lịch sử / học thuật
  [/\b(Albert Einstein|Isaac Newton|Stephen Hawking|Nikola Tesla|Charles Darwin|Sigmund Freud|Karl Marx|Nelson Mandela|Mahatma Gandhi|Martin Luther King)\b/gi, 'a historical figure'],
  // Người Việt nổi tiếng
  [/\b(Hồ Chí Minh|Ho Chi Minh|Nguyễn Phú Trọng|Tô Lâm|Jack Ma|Warren Buffett|George Soros|Oprah Winfrey|Ellen DeGeneres)\b/gi, 'a prominent public figure'],
];

// Regex nhận dạng tên riêng dạng "Firstname Lastname" (2 chữ hoa đầu liên tiếp)
// Ví dụ: "John Smith", "Nguyen Van A" — để fallback sau map cố định
const PROPER_NAME_REGEX = /\b([A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]+)\s+([A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-z]+(?:\s+[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ][a-z]+)*)\b/g;

function stripProminentPeople(prompt) {
  if (!prompt) return '';
  let p = prompt;
  // 1. Thay các tên nổi tiếng đã biết
  PERSON_REPLACE_MAP.forEach(([regex, replacement]) => { p = p.replace(regex, replacement); });
  // 2. Thay pattern "Firstname Lastname" còn sót bằng "a person"
  //    (chỉ thay nếu chứa 2 từ viết hoa liền — tránh thay tên địa điểm như "New York")
  p = p.replace(PROPER_NAME_REGEX, (match, first, rest) => {
    // Giữ lại nếu là địa danh hoặc tổ chức phổ biến
    const keepList = /\b(New York|Los Angeles|San Francisco|United States|United Kingdom|South Korea|North Korea|Hong Kong|New Zealand|South Africa|Saudi Arabia|World Cup|Super Bowl|Olympic Games)\b/i;
    if (keepList.test(match)) return match;
    return 'a person';
  });
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

// ── Policy Repair Loop — chạy cho từng task vi phạm cho đến khi ra kết quả ──
// Gọi sau khi tất cả retry thông thường đã xong, còn task vi phạm chính sách
// repairMap: Map<taskId, sceneIdx> — để biết lưu kết quả vào đâu
// resultArray: mảng output (orderedVPaths / orderedResults)
// veoRunFn: async (task) => { files: [{id, filePath, isError, error}] }
async function runPolicyRepairLoop(repairTasks, repairMap, resultArray, veoRunFn, addLog, stopRef) {
  if (!repairTasks?.length) return;
  addLog(`\n🔧 ════ POLICY REPAIR ════ Sửa đổi + chạy lại ${repairTasks.length} prompt vi phạm...`, 'info');

  for (let i = 0; i < repairTasks.length; i++) {
    if (stopRef?.current) return;
    const task = repairTasks[i];
    const sceneIdx = repairMap.get(task.id);
    let success = false;

    addLog(`🔧 [Repair ${i + 1}/${repairTasks.length}] Prompt gốc: "${(task.prompt || '').slice(0, 60)}..."`, 'info');

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
            // resultArray có thể chứa filePath (string) hoặc object (Storyboard)
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
      addLog(`⚠️ [Repair ${i + 1}] Không thể sửa được prompt sau 4 cấp độ — bỏ qua task này`, 'error');
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
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };

  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  const handleStart = async () => {
    if (!idea.trim())       { setError('Vui lòng nhập ý tưởng hoặc kịch bản.'); return; }
    if (!apiKeys.length)   { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
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

      const sText = await generateScript(apiKeys, {
        topic:         idea,
        platform,
        sceneDuration: sceneDur,
        totalDuration: totalMins,
        language,                   // 'vi' | 'en' | 'ja' | 'zh'
        style,
        goal:     goal,
        tone:     tone,
        audience: audience,
      }, (evt) => {
        if (evt.type === 'chunk')
          addLog(evt.message, 'info');
        else if (evt.type === 'chunk_done' && evt.total > 25)
          setScriptText(evt.scriptSoFar);   // update preview progressively
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
      dna?.characters?.forEach((c,i) => {
        if (c.dna_prompt) { dnaTasks.push({ id:`dna_c${i}`, prompt:c.dna_prompt, fileIndex:_dnaIdx++ }); charDnaTaskMap.set(`dna_c${i}`, c.id); }
      });
      dna?.environments?.forEach((e,i) => {
        if (e.dna_prompt) { dnaTasks.push({ id:`dna_e${i}`, prompt:e.dna_prompt, fileIndex:_dnaIdx++ }); envDnaTaskMap.set(`dna_e${i}`, e.id); }
      });
      dna?.key_objects?.forEach((o,i) => {
        if (o.dna_prompt) { dnaTasks.push({ id:`dna_o${i}`, prompt:o.dna_prompt, fileIndex:_dnaIdx++ }); objDnaTaskMap.set(`dna_o${i}`, o.id); }
      });

      let dnaImgPaths = [];
      let dnaMediaIds = []; // UUID từ Veo Studio — dùng làm Ingredients
      const charImgMap = {}; const charMediaMap = {}; // charId → path/UUID
      const envImgMap  = {}; const envMediaMap  = {}; // envId  → path/UUID
      const objImgMap  = {}; const objMediaMap  = {}; // objId  → path/UUID

      if (dnaTasks.length) {
        {
          // ── Veo Studio: batchGenerateImages → trả về file path + UUID
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu bằng Veo Studio...`, 'info');
          const r = await window.electronAPI.runVeo({ mediaType:'Image', tasks:dnaTasks, aspectRatio:ratio, model:imgMdl, genCount:'1x', quality:'720p', outputFolder:refDir, duration:null });
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
          const speakChar = sceneCharIds.find(id => charVoiceMap[id] && (charMediaMap[id] || charImgMap[id]));
          if (speakChar) {
            task.voiceId = charVoiceMap[speakChar];
            if (charMediaMap[speakChar]) task.ingredientMediaIds = [charMediaMap[speakChar]];
            else task.ingredientImages = [charImgMap[speakChar]];
          } else if (hasMediaIds && sceneMediaIds.length > 0) {
            // Cap tối đa 6 — ưu tiên nhân vật trước (chars → env → objects)
            task.ingredientMediaIds = sceneMediaIds.slice(0, 6);
          } else if (sceneImgPaths.length > 0) {
            task.ingredientImages = sceneImgPaths.slice(0, 6);
          }
          const refLabels = [...sceneCharIds, ...(sceneEnvId?[sceneEnvId]:[]), ...sceneObjIds];
          const refCount  = speakChar ? `1 (${speakChar}+${task.voiceId})` : (task.ingredientMediaIds?.length || task.ingredientImages?.length || 0);
          addLog(`[Veo] Cảnh ${i+1}: ${refLabels.length > 0 ? `${refLabels.join(', ')} → ${refCount} ảnh DNA` : 'không có tham chiếu → text-to-video'}`, 'info');
          return task;
        });

        // Dedup prompt trùng trước khi gửi
        let pendingTasks = dedupTasksByPrompt(allTasks, addLog);

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
            // Policy violation detection
            for (const ff of failedFiles) {
              if (isPolicyViolation(ff.error)) {
                i2vPolicySet.add(ff.id);
                addLog(`🚫 [Chính sách Veo] Cảnh vi phạm: "${(ff.error || '').slice(0, 80)}" → đổi prompt an toàn`, 'error');
              }
            }
            pendingTasks = safeTasks.filter(t => failedIds.has(t.id)).map(t => {
              const ni = `${t.id}_r${attempt}`;
              veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
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
        // Policy Repair: sửa đổi prompt vi phạm cho đến khi ra kết quả
        if (pendingTasks.length > 0) {
          addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair...`, 'error');
          const repMap = new Map(pendingTasks.map(t => [t.id, veoTaskMap.get(t.id)]));
          await runPolicyRepairLoop(
            pendingTasks, repMap, orderedVPaths,
            async (task) => window.electronAPI.runVeo({ mediaType:'Video', tasks:[task], aspectRatio:ratio, model:vidMdl, genCount:'1x', quality:vidQuality, outputFolder:vidDir, duration:`${sceneDur}s` }),
            addLog, stopRef
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
            <div className="flex gap-1.5 mt-1">
              {RATIOS.map(r=>(
                <button key={r} disabled={running} onClick={()=>setRatio(r)}
                  className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    ratio===r ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {r}
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
              Bắt đầu · Veo
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
  const [script,      setScript]      = useState('');
  const [platform,    setPlatform]    = useState('YouTube ngang');
  const [language,    setLang]        = useState('vi');
  const [style,       setStyle]       = useState('Photorealistic');
  const videoEngine = 'veo';
  const [sceneDur,    setSceneDur]    = useState(8);
  const [totalMins,   setMins]        = useState(3);
  const [ratio,       setRatio]       = useState('16:9');
  const [imgMdl,      setImgMdl]      = useState('Nano Banana Pro');
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
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
  }, [running, addLog]);

  const markDone = (id) => { setDone(s => [...s, id]); setActive(null); };
  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  const handleStart = async () => {
    if (!script.trim())     { setError('Vui lòng nhập kịch bản!'); return; }
    if (!apiKeys.length)    { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
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
      const pRes = await generateCinematicPrompts(apiKeys, {
        subject: script, quantity: numScenes,
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
      dna?.characters?.forEach((c,i) => {
        if (c.dna_prompt) { dnaTasks.push({ id:`dna_c${i}`, prompt:c.dna_prompt, fileIndex:_dnaIdx++ }); charDnaTaskMap.set(`dna_c${i}`, c.id); }
      });
      dna?.environments?.forEach((e,i) => {
        if (e.dna_prompt) { dnaTasks.push({ id:`dna_e${i}`, prompt:e.dna_prompt, fileIndex:_dnaIdx++ }); envDnaTaskMap.set(`dna_e${i}`, e.id); }
      });
      dna?.key_objects?.forEach((o,i) => {
        if (o.dna_prompt) { dnaTasks.push({ id:`dna_o${i}`, prompt:o.dna_prompt, fileIndex:_dnaIdx++ }); objDnaTaskMap.set(`dna_o${i}`, o.id); }
      });

      let dnaImgPaths = [];
      let dnaMediaIds = [];
      const charImgMap = {}; const charMediaMap = {};
      const envImgMap  = {}; const envMediaMap  = {};
      const objImgMap  = {}; const objMediaMap  = {};

      if (dnaTasks.length) {
        if (videoEngine === 'veo') {
          addLog(`[Veo] Đang tạo ${dnaTasks.length} ảnh DNA tham chiếu (nhân vật + bối cảnh + vật thể)...`, 'info');
          const r = await window.electronAPI.runVeo({ mediaType:'Image', tasks:dnaTasks, aspectRatio:ratio, model:imgMdl, genCount:'1x', quality:'720p', outputFolder:refDir, duration:null });
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
          const speakChar=sceneCharIds.find(id=>charVoiceMap[id]&&(charMediaMap[id]||charImgMap[id]));
          if (speakChar) {
            task.voiceId=charVoiceMap[speakChar];
            if (charMediaMap[speakChar]) task.ingredientMediaIds=[charMediaMap[speakChar]];
            else task.ingredientImages=[charImgMap[speakChar]];
          } else if (hasMediaIds&&sceneMediaIds.length>0) {
            // Cap tối đa 6 — ưu tiên nhân vật trước (chars → env → objects)
            task.ingredientMediaIds=sceneMediaIds.slice(0,6);
          } else if (sceneImgPaths.length>0) {
            task.ingredientImages=sceneImgPaths.slice(0,6);
          }
          const refLabels=[...sceneCharIds,...(sceneEnvId?[sceneEnvId]:[]),...sceneObjIds];
          const refCount=speakChar?`1 (${speakChar}+${task.voiceId})`:(task.ingredientMediaIds?.length||task.ingredientImages?.length||0);
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
            <div className="flex gap-1.5 mt-1">
              {RATIOS.map(r=>(
                <button key={r} disabled={running} onClick={()=>setRatio(r)}
                  className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all',
                    ratio===r?'bg-green-600 border-green-500 text-white':'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                  {r}
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
              Tạo Video · Veo
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
  { id: 'video',      label: 'Tạo Video',          icon: Film        },
  { id: 'merge',      label: 'Ghép video',         icon: Scissors    },
  { id: 'remaster',   label: 'Ghép Audio gốc',     icon: Music2      },
];

const RESULT_TABS_AUDIO = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'analysis',   label: 'Phân tích'  },
  { id: 'chunks',     label: 'Chunks'     },
  { id: 'prompts',    label: 'Prompts'    },
  { id: 'video',      label: 'Videos'     },
  { id: 'merge',      label: 'Video ghép' },
  { id: 'remaster',   label: '🎵 Video cuối' },
];

const VID_MDL_AUDIO = ['Veo 3.1 - Lite [Lower Priority]', 'Veo 3.1 - Lite (Fast)', 'Veo 3.1 - Fast (Balanced)', 'Omni Flash'];
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

function AudioToVideoPanel() {
  const _s = loadAtvSettings();

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
  // Load cả 2 keys khi mount (không phụ thuộc vào stockProvider)
  useEffect(() => {
    window.electronAPI?.getSetting?.('pexels_api_key',  '').then(v => setPexelsKey(v  || ''));
    window.electronAPI?.getSetting?.('pixabay_api_key', '').then(v => setPixabayKey(v || ''));
  }, []);

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
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
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
    if (d === 10) setVidModel('Omni Flash');
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
  };

  const handleStop   = () => { stopRef.current = true; pauseRef.current = false; setPaused(false); };
  const handlePause  = () => { pauseRef.current = true;  setPaused(true);  addLog('⏸️ Đã tạm dừng — bấm Tiếp tục để chạy lại.', 'info'); };
  const handleResume = () => { pauseRef.current = false; setPaused(false); addLog('▶️ Tiếp tục...', 'info'); };
  const checkPause   = async () => { while (pauseRef.current) { if (stopRef.current) throw new Error('Đã dừng.'); await sleep(500); } };

  const vidDurs = [4, 6, 8, 10];

  const handleStart = async () => {
    // Capture tất cả settings tại thời điểm bấm Start — tránh stale closure
    const apiKeys         = loadKeys();
    const _sceneDur       = sceneDur;
    const _videoEngine    = videoEngine;
    const _vidSceneDur    = vidSceneDur;
    const _vidRatio       = vidRatio;
    const _vidModel       = vidModel;
    const _vidQuality     = vidQuality;
    const _vidDir         = vidDir;
    const _makeVideo      = makeVideo;
    const _stockMode      = stockMode;
    const _stockProvider  = stockProvider;
    const _stockApiKey    = stockApiKey;
    const _stockTxMode    = stockMode ? stockTranscribeMode : 'gemini'; // chỉ áp dụng khi stock
    const _stockNoGemini  = _stockTxMode === 'manual';   // backward compat: skip all AI
    const _useLocalWhisper= _stockTxMode === 'whisper';  // Whisper cục bộ
    const _stockManualKw  = (stockManualKw || '').trim();

    if (!filePath)           { setError('Vui lòng chọn file audio hoặc video.'); return; }
    // Không cần Gemini key khi: manual skip hoặc Whisper cục bộ (stock mode)
    if (!apiKeys.length && !_stockNoGemini && !_useLocalWhisper) { setError('Chưa có API Key Gemini. Vào Creator → nhập key.'); return; }
    if (_makeVideo && !_vidDir) { setError('Vui lòng chọn thư mục lưu video.'); return; }
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

      if (_stockNoGemini) {
        // ── [Manual] Bỏ qua extract/transcribe/chunk — dùng từ khóa tay ───────
        setActive('extract'); markDone('extract');
        setActive('transcribe'); markDone('transcribe');
        setActive('chunk'); setActiveTab('chunks');
        const _dur4Chunk = (_autoChunk || _sceneDur <= 0) ? 8 : _sceneDur;
        timeChunks = createTimeBasedChunks([], totalSec, _dur4Chunk);
        setChunks(timeChunks);
        addLog(`✅ ${timeChunks.length} cảnh × ${_dur4Chunk}s — chế độ từ khóa thủ công`, 'success');
        markDone('chunk');

      } else if (_useLocalWhisper) {
        // ── [Whisper cục bộ] Transcribe bằng AI local, không cần Gemini API ───
        setActive('extract');
        const _totalChunks30 = Math.ceil(totalSec / 30);
        addLog(`Chia audio thành ${_totalChunks30} phần (30s/phần) → Whisper cục bộ...`, 'info');
        markDone('extract');

        setActive('transcribe'); setActiveTab('transcript');
        result = await transcribeLocalChunked(
          filePath,   // main process tự extract PCM → không cần extractChunkFn nữa
          totalSec,
          (msg) => addLog(`  ⏳ ${msg}`, 'info'),
          (done, total, segCount, errMsg) => {
            if (errMsg) addLog(`  ⚠️ Đoạn ${done}/${total}: ${errMsg}`, 'error');
            else        addLog(`  ✅ Đoạn ${done}/${total}: ${segCount} câu`, 'success');
          },
          (msg) => addLog(msg, 'info'),
          (msg) => addLog(msg, 'info')   // model download progress
        );
        if (stopRef.current) throw new Error('Đã dừng.');

        setTranscript(result);
        addLog(`✅ Whisper xong — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');
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

      } else {
        // ── [Gemini] Transcribe qua Gemini API ───────────────────────────────
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
          (msg) => addLog(msg, 'info')
        );
        if (stopRef.current) throw new Error('Đã dừng.');

        if (!result || (!result.segments?.length && !result.fullText?.trim()))
          throw new Error('Không nhận được kết quả transcription từ Gemini. Kiểm tra API Key và thử lại.');
        setTranscript(result);
        addLog(`✅ Transcript xong — ${result.segments.length} đoạn, ${(result.fullText || '').split(' ').length} từ`, 'success');

        addLog('Đang phân tích tổng quát nội dung...', 'info');
        try {
          oa = await analyzeOverallContent(
            apiKeys,
            result.fullText,
            ({ fromIdx, toIdx }) => addLog(`🔄 Chuyển key ${fromIdx + 1}→${toIdx + 1}`, 'info')
          );
          setOverallAnalysis(oa);
          addLog(`✅ Phân tích xong — ${oa.topic || ''}`, 'success');
        } catch (e) {
          addLog(`⚠️ Phân tích tổng quát lỗi (bỏ qua): ${e.message}`, 'error');
        }
        markDone('transcribe');
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
        addLog(`Bắt đầu tạo ${timeChunks.length} Veo Prompts (Gemini)...`, 'info');
        setGenProgress({ current: 0, total: timeChunks.length });

        const _gs = await analyzeScenes(
          apiKeys,
          timeChunks,
          _sceneDur,
          oa,
          (current, total, keyInfo) => {
            setGenProgress({ current, total });
            if (keyInfo) addLog(`Scene ${current}/${total} — ${keyInfo}`, 'info');
            else addLog(`Tạo prompt Scene ${current}/${total}...`, 'info');
          },
          (sceneData, isError) => {
            setScenes(prev => [...prev, sceneData]);
            if (isError) addLog(`⚠️ Scene ${sceneData.sceneNumber} dùng fallback: ${sceneData.error}`, 'error');
            else addLog(`✅ Scene ${sceneData.sceneNumber} xong`, 'success');
          }
        );

        generatedScenes = _gs;
        setScenes(generatedScenes);
        const failCount = generatedScenes.filter(s => s.error).length;
        addLog(`🎉 Hoàn tất ${generatedScenes.length} prompts${failCount ? ` (${failCount} lỗi)` : ''}`, 'success');
        markDone('generate');

        // ── Tự động lưu file prompt vào thư mục ────────────────────────────
        if (autoSavePromptRef.current && promptDirRef.current) {
          try {
            const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const base = fileName.replace(/\.[^.]+$/, '');
            const txtPath = `${promptDirRef.current}\\veo_prompts_${base}_${ts}.txt`;
            const content = exportToTxt(generatedScenes);
            const wr = await window.electronAPI.saveTextFile({ content, filePath: txtPath });
            if (wr?.success) addLog(`💾 Đã lưu prompt tự động → ${txtPath}`, 'success');
            else             addLog(`⚠️ Lưu prompt tự động thất bại: ${wr?.error || 'lỗi không xác định'}`, 'error');
          } catch (e) {
            addLog(`⚠️ Lưu prompt tự động thất bại: ${e.message}`, 'error');
          }
        }
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
        // ── [Whisper / Gemini stock] Trích từ khóa từ transcript (word freq) ──
        setActive('generate');
        addLog('[Stock] Trích từ khóa từ transcript...', 'info');
        const _topic3 = (oa?.topic || '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ') || 'nature landscape';
        const _stops  = new Set(['và','của','là','có','trong','với','cho','một','các','này','đó','đã','được','không','để','từ','hay','như','khi','thì','mà','về','ra','vào','lên','xuống','đến','lại','nên','vì','bởi','nhưng','hoặc','cũng','đây','những','mọi','tất','cả','ai','gì','nào','ấy','rất','quá','hơn','nhất','hết','ngay','chỉ','lúc','sau','trước','luôn','theo','bên','qua','dù','tuy','nếu','đang','sẽ','bị','mới','vẫn','cùng','giữa','the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','must','this','that','these','those','i','you','he','she','it','we','they','not','so','if','as','up','out','into','over','also','just','very','too','more','most','no','my','your','his','her','our','their']);
        stockKeywords = timeChunks.map(chunk => {
          const text = (chunk.exactText || '').trim();
          if (!text || text.startsWith('[Không') || text.length < 8) return _topic3;
          const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !_stops.has(w) && !/^\d+$/.test(w));
          const kw = [...new Set(words)].slice(0, 3).join(' ');
          return kw || _topic3;
        });
        addLog(`✅ [Stock] ${stockKeywords.length} từ khóa — ví dụ: ${stockKeywords.slice(0, 3).join(' | ')}`, 'success');
        markDone('generate');
      }

      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 5. Tạo Video ──────────────────────────────────────────────────────
      if (!_makeVideo) { markDone('video'); markDone('merge'); return; }

      setActive('video'); setActiveTab('video');
      const vPaths = [];

      if (_stockMode) {
        // ── Stock Video flow ─────────────────────────────────────────────────
        // keywords đã được trích ở bước 4 (stockKeywords)
        addLog(`[Stock] Bắt đầu tìm + tải ${timeChunks.length} clip...`, 'info');
        setGenProgress({ current: 0, total: timeChunks.length });

        if (stopRef.current) throw new Error('Đã dừng.');

        const orderedStockPaths = new Array(timeChunks.length).fill(null);
        // Track video IDs đã dùng → tránh clip giống nhau liền kề
        const usedVideoIds = new Set();

        // Helper: search với fallback keyword nếu keyword gốc không có kết quả
        // Thứ tự thử: (1) keyword gốc → (2) từng từ đơn dài nhất → (3) null
        const stockSearchWithFallback = async (keyword) => {
          const doSearch = (kw) => window.electronAPI.stockVideoSearch({
            keyword: kw, provider: _stockProvider, apiKey: _stockApiKey, perPage: 15,
          });
          // 1. Thử keyword gốc
          let sr = await doSearch(keyword);
          if (sr?.success && sr.results?.length) return { results: sr.results, usedKw: keyword };

          // 2. Thử từng từ đơn (dài > 3 ký tự, loại bỏ giới từ phổ biến)
          const stopWords = new Set(['with','from','that','this','have','just','what','when','then','they','them','will','into','over','your','their','about','been','were','would','could','should']);
          const words = keyword.split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
            .sort((a, b) => b.length - a.length)
            .slice(0, 3); // tối đa 3 từ thử
          for (const word of words) {
            await sleep(300); // tránh rate limit
            sr = await doSearch(word);
            if (sr?.success && sr.results?.length) return { results: sr.results, usedKw: word };
          }
          return null; // tất cả đều fail
        };

        for (let i = 0; i < timeChunks.length; i++) {
          await checkPause();
          if (stopRef.current) throw new Error('Đã dừng.');

          const keyword   = stockKeywords[i];
          // Dùng float chính xác — KHÔNG Math.round → tránh drift tích lũy trên 400+ chunk
          const targetDur = _autoChunk
            ? Math.max(0.5, timeChunks[i].timeEnd - timeChunks[i].timeStart)
            : _sceneDur;
          addLog(`[Stock] ${i + 1}/${timeChunks.length}: "${keyword}" (${targetDur.toFixed(2)}s)...`, 'info');

          try {
            // Search với fallback tự động
            const searchResult = await stockSearchWithFallback(keyword);

            if (!searchResult) {
              // Tất cả keyword đều fail → dùng lại clip gần nhất đã tải (không bỏ trống)
              const prevPath = orderedStockPaths.slice(0, i).filter(Boolean).pop();
              if (prevPath) {
                orderedStockPaths[i] = prevPath;
                addLog(`⚠️ [Stock] Chunk ${i + 1}: không tìm thấy → dùng lại clip trước`, 'info');
              } else {
                addLog(`⚠️ [Stock] Chunk ${i + 1}: không tìm thấy clip cho "${keyword}"`, 'error');
              }
            } else {
              const { results, usedKw } = searchResult;
              if (usedKw !== keyword) {
                addLog(`  → fallback keyword: "${usedKw}"`, 'info');
              }

              // Lọc chỉ lấy video LANDSCAPE (width > height) — loại bỏ 9:16 portrait
              const landscapeOnly = results.filter(v =>
                v.width && v.height ? v.width > v.height : true // nếu thiếu dimensions thì giữ lại
              );
              // Nếu không có clip landscape nào thì fallback toàn bộ (tránh kết quả rỗng)
              const filtered = landscapeOnly.length > 0 ? landscapeOnly : results;
              if (landscapeOnly.length < results.length) {
                addLog(`  → Đã lọc ${results.length - landscapeOnly.length} clip portrait, còn ${landscapeOnly.length} landscape`, 'info');
              }

              // Sort: ưu tiên clip >= targetDur, rồi dài nhất
              const sorted = [...filtered].sort((a, b) => {
                const aOk = a.duration >= targetDur ? 0 : 1;
                const bOk = b.duration >= targetDur ? 0 : 1;
                if (aOk !== bOk) return aOk - bOk;
                return b.duration - a.duration;
              });

              // Ưu tiên clip chưa dùng → tránh lặp lại khi xem liên tiếp
              const uniqueSorted = sorted.filter(v => !usedVideoIds.has(v.id));
              const chosen = uniqueSorted.length > 0 ? uniqueSorted[0] : sorted[0];
              if (uniqueSorted.length === 0) {
                addLog(`  → hết clip mới, dùng lại clip cũ nhất trong kết quả`, 'info');
              }
              usedVideoIds.add(chosen.id);

              // Download
              const rawPath = `${_vidDir}\\stock_raw_${i}_${Date.now()}.mp4`;
              const dr = await window.electronAPI.stockVideoDownload({ url: chosen.url, destPath: rawPath });
              if (!dr?.success) {
                addLog(`⚠️ [Stock] Chunk ${i + 1}: tải thất bại — ${dr?.error}`, 'error');
                // Tải thất bại → cũng dùng lại clip trước
                const prevPath = orderedStockPaths.slice(0, i).filter(Boolean).pop();
                if (prevPath) orderedStockPaths[i] = prevPath;
              } else {
                // Trim / loop to exact scene duration — chuẩn hóa 1280×720 để concat copy nhanh
                const trimPath = `${_vidDir}\\stock_${String(i).padStart(4, '0')}.mp4`;
                const tr = await window.electronAPI.trimLoopVideo({
                  inputPath: rawPath, duration: targetDur, outputPath: trimPath,
                  targetW: 1280, targetH: 720,   // ← chuẩn hóa resolution 16:9 HD
                });
                if (tr?.success) {
                  orderedStockPaths[i] = trimPath;
                  setVideoPaths(prev => [...prev, trimPath]);
                  addLog(`✅ [Stock] Clip ${i + 1} OK: "${usedKw}"`, 'success');
                } else {
                  addLog(`⚠️ [Stock] Trim thất bại ${i + 1}: ${tr?.error}`, 'error');
                  const prevPath = orderedStockPaths.slice(0, i).filter(Boolean).pop();
                  if (prevPath) orderedStockPaths[i] = prevPath;
                }
              }
            }
          } catch (e) {
            addLog(`⚠️ [Stock] Chunk ${i + 1} lỗi: ${e.message}`, 'error');
            // Exception → cũng thử dùng lại clip trước
            const prevPath = orderedStockPaths.slice(0, i).filter(Boolean).pop();
            if (prevPath) orderedStockPaths[i] = prevPath;
          }

          if (i < timeChunks.length - 1) await sleep(350);
          setGenProgress({ current: i + 1, total: timeChunks.length });
        }

        orderedStockPaths.filter(Boolean).forEach(p => vPaths.push(p));
        if (!vPaths.length) throw new Error('Không tải được clip nào từ Stock Video. Kiểm tra API key và kết nối.');
        addLog(`✅ [Stock] Tải xong ${vPaths.length}/${timeChunks.length} clip`, 'success');

      } else {
        // ── Veo flow ─────────────────────────────────────────────────────────
        addLog(`[Veo] Bắt đầu tạo ${generatedScenes.length} video T2V...`, 'info');
        const MAX_A2V_FIRST  = 5;   // vòng đầu: 5 lần, bỏ qua nếu vẫn lỗi
        const MAX_A2V_GLOBAL = 20;  // global retry: 20 lần

        {
          // Áp dụng VEO policy + strip tên người nổi tiếng vào tất cả prompt
          const allTasks_a2v = generatedScenes.map((s, i) => ({
            id: `vid_${i}`,
            prompt: applyVeoPolicy(stripProminentPeople(s.veoVideoPrompt || 'Cinematic establishing shot, smooth camera movement')),
          }));
          let pendingTasks = dedupTasksByPrompt(allTasks_a2v, addLog);
          const a2vTaskMap = new Map();
          allTasks_a2v.forEach((t, i) => a2vTaskMap.set(t.id, i));
          const orderedA2VPaths = new Array(generatedScenes.length).fill(null);
          const a2vPolicySet = new Set();

          // ── Helper: 1 vòng retry ─────────────────────────────────────────────
          const runA2VPass = async (passLabel, maxRetry) => {
            const filterPass = makeSubmitGuard();
            for (let attempt = 1; attempt <= maxRetry && pendingTasks.length > 0; attempt++) {
              await checkPause();
              if (stopRef.current) throw new Error('Đã dừng.');
              if (attempt > 1) { addLog(`${passLabel}[Veo] Thử lại lần ${attempt}/${maxRetry}: ${pendingTasks.length} video...`, 'info'); await sleep(10000); }
              const safeTasks = filterPass(pendingTasks, addLog);
              if (!safeTasks.length) break;
              const vr = await window.electronAPI.runVeo({
                mediaType: 'Video', tasks: safeTasks,
                aspectRatio: _vidRatio, model: _vidModel,
                genCount: '1x', quality: _vidQuality,
                outputFolder: _vidDir, duration: `${_vidSceneDur}s`,
              });
              const files = vr?.files || [];
              const succeeded   = files.filter(f => !f.isError && f.filePath);
              const failedFiles = files.filter(f => f.isError);
              const failedIds   = new Set(failedFiles.map(f => f.id));
              succeeded.forEach(f => {
                const idx = a2vTaskMap.get(f.id) ?? 0;
                orderedA2VPaths[idx] = f.filePath;
              });
              if (succeeded.length) addLog(`✅ ${passLabel}[Veo] Lần ${attempt}: ${succeeded.length}/${safeTasks.length} OK`, 'success');
              // Detect policy violation
              for (const ff of failedFiles) {
                if (isPolicyViolation(ff.error)) {
                  a2vPolicySet.add(ff.id);
                  addLog(`🚫 [Chính sách Veo] Vi phạm: "${(ff.error || '').slice(0, 80)}" → đổi prompt`, 'error');
                }
              }
              pendingTasks = safeTasks.filter(t => failedIds.has(t.id)).map(t => {
                const ni = `${t.id}_r${attempt}`;
                a2vTaskMap.set(ni, a2vTaskMap.get(t.id));
                if (a2vPolicySet.has(t.id)) {
                  a2vPolicySet.delete(t.id); a2vPolicySet.add(ni);
                  const cp = sanitizePrompt(t.prompt);
                  addLog(`🔧 Prompt làm sạch: "${cp.slice(0, 70)}..."`, 'info');
                  return { ...t, id: ni, prompt: cp };
                }
                return { ...t, id: ni };
              });
              if (pendingTasks.length && attempt < maxRetry) addLog(`⚠️ ${passLabel} ${pendingTasks.length} video lỗi → chờ 10s...`, 'error');
            }
          };

          // Vòng chính — 5 lần, bỏ qua nếu vẫn lỗi
          addLog(`📋 Tạo ${pendingTasks.length} video — thử ${MAX_A2V_FIRST} lần/task`, 'info');
          await runA2VPass('', MAX_A2V_FIRST);
          if (pendingTasks.length > 0) addLog(`⏭️ ${pendingTasks.length} video vẫn lỗi → bỏ qua, tiếp tục`, 'warn');

          // Global retry sau khi TẤT CẢ xong
          if (pendingTasks.length > 0) {
            addLog(`\n🔄 ════ GLOBAL RETRY ════ ${pendingTasks.length} video lỗi → retry ${MAX_A2V_GLOBAL} lần...`, 'info');
            await sleep(3000);
            const MAX_GP = 20;
            for (let gPass = 1; gPass <= MAX_GP && pendingTasks.length > 0; gPass++) {
              if (stopRef.current) throw new Error('Đã dừng.');
              addLog(`🔄 [Global Retry ${gPass}/${MAX_GP}] ${pendingTasks.length} video → thử ${MAX_A2V_GLOBAL} lần...`, 'info');
              await sleep(5000);
              pendingTasks = pendingTasks.map(t => {
                const ni = `${t.id}_g${gPass}`;
                a2vTaskMap.set(ni, a2vTaskMap.get(t.id));
                return { ...t, id: ni };
              });
              await runA2VPass(`[Global ${gPass}/${MAX_GP}]`, MAX_A2V_GLOBAL);
              if (pendingTasks.length === 0) addLog(`✅ [Global Retry] Tất cả hoàn thành ở vòng ${gPass}!`, 'success');
              else addLog(`⚠️ [Global Retry ${gPass}] Còn ${pendingTasks.length} video lỗi...`, 'error');
            }
          }
          // Policy Repair — sửa đổi prompt vi phạm cho đến khi ra kết quả
          if (pendingTasks.length > 0) {
            addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair...`, 'error');
            const rpMap = new Map(pendingTasks.map(t => [t.id, a2vTaskMap.get(t.id)]));
            await runPolicyRepairLoop(pendingTasks, rpMap, orderedA2VPaths,
              async (task) => window.electronAPI.runVeo({ mediaType:'Video', tasks:[task], aspectRatio:_vidRatio, model:_vidModel, genCount:'1x', quality:_vidQuality, outputFolder:_vidDir, duration:`${_vidSceneDur}s` }),
              addLog, stopRef);
          }

          orderedA2VPaths.filter(Boolean).forEach(p => { vPaths.push(p); setVideoPaths(prev => [...prev, p]); });
        }

        if (!vPaths.length) throw new Error('Không tạo được video nào.');
        addLog(`✅ [Veo] Tạo xong ${vPaths.length} video`, 'success');
      }

      markDone('video');
      if (stopRef.current) throw new Error('Đã dừng.');

      // ── 6 + 7. Ghép clip stock + chèn audio gốc (FFmpeg local, 1 bước) ──────
      setActive('merge'); setActiveTab('merge');

      // Lấy danh sách clip đã trim theo thứ tự
      const stockClips = orderedStockPaths.filter(Boolean);
      addLog(`🎬 Ghép ${stockClips.length} clip stock bằng FFmpeg...`, 'info');

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

        <div className="flex-1 px-4 py-3 space-y-4">

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

          {/* ── Tự động lưu prompt ── */}
          <div className="border-t border-slate-800/60 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Tự động lưu prompt</label>
              <button onClick={() => setAutoSavePrompt(v => !v)} disabled={running}
                className={cn('w-9 h-5 rounded-full transition-all relative', autoSavePrompt ? 'bg-emerald-600' : 'bg-slate-700')}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', autoSavePrompt ? 'left-4' : 'left-0.5')}/>
              </button>
            </div>
            {autoSavePrompt && (
              <FolderRow label="Thư mục lưu prompt" value={promptDir} onChange={setPromptDir} />
            )}
          </div>

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
                {/* ── Nguồn video: Veo vs Stock ── */}
                <div>
                  <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5 block">Nguồn video</label>
                  <div className="flex gap-1.5">
                    <button disabled={running} onClick={() => handleSetStockMode(false)}
                      className={cn('flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all',
                        !stockMode ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                      🎬 Veo AI
                    </button>
                    <button disabled={running} onClick={() => handleSetStockMode(true)}
                      className={cn('flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all',
                        stockMode ? 'bg-emerald-700 border-emerald-600 text-white' : 'border-slate-700/60 text-slate-600 hover:border-slate-600')}>
                      📦 Stock
                    </button>
                  </div>
                </div>

                {/* ── Veo-specific settings ── */}
                {!stockMode && (
                  <>
                    {/* Duration */}
                    <div>
                      <label className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1 block">Thời lượng mỗi video</label>
                      <div className="flex gap-1.5">
                        {vidDurs.map(d => (
                          <button key={d} disabled={running} onClick={() => { setVidSceneDur(d); if (d === 10) setVidModel('Omni Flash'); }}
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
                          <select value={vidSceneDur === 10 ? 'Omni Flash' : vidModel}
                            onChange={e => { if (vidSceneDur !== 10) setVidModel(e.target.value); }}
                            disabled={running || vidSceneDur === 10}
                            className={cn('w-full bg-slate-800/50 border rounded-lg px-2 py-1.5 text-[10px] focus:outline-none',
                              vidSceneDur === 10 ? 'border-amber-500/50 text-amber-300 cursor-not-allowed opacity-80' : 'border-slate-700/60 text-slate-300')}>
                            {vidSceneDur === 10
                              ? <option>Omni Flash</option>
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

                {/* ── Stock-specific settings ── */}
                {stockMode && (
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

        {/* Pipeline steps */}
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-800/80">
          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-2">Tiến trình xử lý</p>
          <div className="grid grid-cols-7 gap-1.5">
            {STEPS_AUDIO.map(s => {
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
  const [dubEngine, setDubEngine] = useState('gemini'); // 'gemini' | 'edge'
  const [dubVoice, setDubVoice] = useState('Aoede');
  const [dubGenderFilter, setDubGenderFilter] = useState('all');
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
      window.electronAPI.onTTSSRTProgress((data) => setDubProgress(data));
    }
    return () => {
      window.electronAPI?.removeAllListeners?.('gemini-srt-progress');
      window.electronAPI?.removeAllListeners?.('gemini-srt-log');
      window.electronAPI?.removeAllListeners?.('tts-srt-progress');
    };
  }, []);

  useEffect(() => {
    if (dubEngine === 'edge' && edgeDubVoices.length === 0) {
      window.electronAPI.getVoices().then(data => {
        if (data && data.length > 0) setEdgeDubVoices(data);
      }).catch(() => {});
    }
  }, [dubEngine]);

  const addSubLog = (text, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text, type }]);
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
    addSubLog('🎙️ Bắt đầu bóc tách SRT — quét toàn bộ video theo từng phần...');
    try {
      const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
      if (!apiKeys.length) { addSubLog('❌ Chưa có API Key Gemini. Vui lòng thêm key trong Cài đặt.', 'error'); setIsTranscribing(false); return; }

      // ── Bước 1: Đọc thông tin video (duration) ──
      addSubLog('📏 Đọc thông tin video...');
      const metaRes = await window.electronAPI.prepareAudio(subVideoFile);
      if (!metaRes.success || !metaRes.duration) { addSubLog(`❌ Không đọc được thông tin video: ${metaRes.error || 'duration = 0'}`, 'error'); setIsTranscribing(false); return; }
      const totalDuration = metaRes.duration;
      const CHUNK_SECS = 60;
      const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
      const durMin = Math.floor(totalDuration / 60);
      const durSec = Math.floor(totalDuration % 60);
      addSubLog(`📹 Thời lượng: ${durMin}p${durSec}s → chia thành ${totalChunks} phần (${CHUNK_SECS}s/phần)`);

      // ── Bước 2: Transcribe từng chunk — quét 100% video ──
      const result = await transcribeAudioChunked(
        apiKeys,
        totalDuration,
        async (startSec, durationSec) => {
          // Trích xuất chunk audio từ main process
          return window.electronAPI.extractAudioChunk({ filePath: subVideoFile, startSec, durationSec });
        },
        (msg) => addSubLog(`  ⏳ ${msg}`),
        (done, total, segCount, errMsg) => {
          if (errMsg) addSubLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`, 'warn');
          else        addSubLog(`  ✅ Phần ${done}/${total}: ${segCount} câu thoại`);
        },
        (msg) => addSubLog(msg)
      );

      if (!result || !result.segments?.length) {
        addSubLog('❌ Không tìm thấy câu thoại nào trong video.', 'error');
        setIsTranscribing(false); return;
      }

      // ── Bước 3: Xây dựng SRT từ toàn bộ segments đã quét ──
      const srtRaw     = subSegmentsToSRT(result.segments);
      const srtDisplay = subNormalizeSRT(srtRaw, 42, subStyle.wordsPerLine);
      setOriginalSegments(result.segments);
      setRawOriginalSRT(srtRaw);    // bản gốc đúng timestamp → dùng để dịch & ép phụ đề
      setOriginalSRT(srtDisplay);   // bản normalize cho hiển thị
      setSubPreviewTab('original');
      addSubLog(`✅ Hoàn tất! ${result.segments.length} câu thoại từ ${totalChunks} phần — sẵn sàng dịch.`, 'success');
    } catch (e) {
      addSubLog(`❌ Lỗi: ${e.message}`, 'error');
    }
    setIsTranscribing(false);
  };

  const smartTranslateSRT = async (srtContent, tLang, apiKeys, logFn) => {
    const langObj = SUBTITLE_LANGUAGES.find(l => l.code === tLang);
    const langName = langObj?.name || tLang;
    const countryMap = { vi:'Việt Nam', en:'Anh/Mỹ', zh:'Trung Quốc', ja:'Nhật Bản', ko:'Hàn Quốc', th:'Thái Lan', id:'Indonesia', ms:'Malaysia', fr:'Pháp', de:'Đức', es:'Tây Ban Nha', pt:'Bồ Đào Nha', it:'Ý', ru:'Nga', ar:'Ả Rập', hi:'Ấn Độ' };
    const country = countryMap[tLang] || langName;

    const callGemini = async (prompt, label) => {
      return retryWithKeyRotation(async (apiKey) => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); const e = new Error(err?.error?.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }, apiKeys, { onSwitch: (idx) => logFn(`🔄 [${label}] Chuyển sang API key #${idx + 1}...`) });
    };

    // Parse SRT thành mảng entries — timestamps lấy từ bản GỐC, không bao giờ từ Gemini
    const parseSRTEntries = (srt) => {
      return srt.trim().split(/\n\n+/).map(block => {
        const lines = block.trim().split('\n');
        const tlIdx = lines.findIndex(l => /^\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}/.test(l.trim()));
        if (tlIdx < 0) return null;
        return { timeLine: lines[tlIdx].trim(), text: lines.slice(tlIdx + 1).join('\n').trim() };
      }).filter(Boolean);
    };

    // Lấy text dịch từ response Gemini (strip markdown, parse entries)
    const extractTranslatedTexts = (raw, expectedCount) => {
      const cleaned = raw.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim();
      const entries = parseSRTEntries(cleaned);
      if (entries.length === expectedCount) return entries.map(e => e.text);
      // fallback: cố gắng lấy từng dòng text (bỏ qua số thứ tự & timestamp)
      const textLines = cleaned.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/. test(l));
      if (textLines.length >= expectedCount) return textLines.slice(0, expectedCount);
      // nếu vẫn thiếu, trả về những gì có (caller sẽ giữ nguyên text gốc cho phần thiếu)
      return entries.map(e => e.text);
    };

    // Parse tất cả entries từ bản gốc
    const srcEntries = parseSRTEntries(srtContent);
    if (!srcEntries.length) throw new Error('Không đọc được SRT gốc');

    // ── Bước 1: Phân tích ngữ cảnh ──
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

    // Tạo context header nhỏ gọn để nhúng vào mỗi chunk
    let contextHeader = '';
    if (contextGuide) {
      const termLines = (contextGuide.keyTerms || []).slice(0, 10)
        .map(t => `"${t.original}"→"${t[`best_translation_${tLang}`] || t.best_translation || ''}"`)
        .join(', ');
      contextHeader = `[Ngữ cảnh: ${contextGuide.domain} · ${contextGuide.topic} · ${contextGuide.tone}]\n[Thuật ngữ: ${termLines}]\n[Phong cách: ${contextGuide.styleGuide}]\n\n`;
    }

    // ── Bước 2: Dịch từng chunk 30 entries ──
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

      // Build chunk SRT dùng số thứ tự đơn giản 1..N
      const chunkSRT = chunk.map((e, i) => `${i+1}\n${e.timeLine}\n${e.text}`).join('\n\n');

      const chunkPrompt = `${contextHeader}NHIỆM VỤ: Dịch ${chunk.length} entry phụ đề SRT sau sang ${langName} (${country}).\n\nQUY TẮC BẮT BUỘC:\n1. GIỮ NGUYÊN định dạng SRT: số thứ tự 1–${chunk.length}, timestamps, dòng trống giữa entry\n2. CHỈ dịch phần text — KHÔNG chạm vào timestamps hay số thứ tự\n3. Dịch tự nhiên như người ${country} nói — KHÔNG máy móc\n4. Kết thúc mỗi entry bằng dấu câu phù hợp (dấu phẩy nếu câu tiếp, dấu chấm/!/?  nếu câu hoàn chỉnh)\n5. Trả về ĐÚNG ${chunk.length} entry — không thêm/bớt, không giải thích\n\nSRT CẦN DỊCH:\n${chunkSRT}`;

      try {
        const raw = await callGemini(chunkPrompt, `Phần ${ci+1}`);
        const texts = extractTranslatedTexts(raw, chunk.length);
        for (let j = 0; j < chunk.length; j++) {
          translatedTexts[startIdx + j] = texts[j] || chunk[j].text; // fallback: giữ text gốc
        }
        logFn(`  ✅ Phần ${ci+1}/${totalChunks}: ${texts.length}/${chunk.length} dòng dịch xong`);
      } catch (e) {
        logFn(`  ⚠️ Phần ${ci+1} lỗi (${e.message.slice(0,50)}) → giữ text gốc cho ${chunk.length} dòng`);
        for (let j = 0; j < chunk.length; j++) translatedTexts[startIdx + j] = chunk[j].text;
      }

      // Nghỉ nhỏ giữa các chunk để không spam API
      if (ci < totalChunks - 1) await new Promise(r => setTimeout(r, 300));
    }

    // ── Ghép lại: timestamp luôn từ BẢN GỐC, text từ bản dịch ──
    const finalSRT = srcEntries.map((e, i) =>
      `${i+1}\n${e.timeLine}\n${translatedTexts[i] ?? e.text}`
    ).join('\n\n') + '\n';

    return finalSRT;
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

    const isEdge = dubEngine === 'edge';
    const voiceLabel = isEdge ? edgeDubVoice.split('-').pop() : dubVoice;

    if (!isEdge) {
      const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
      if (!apiKeys.length) return alert('Cần API Key Gemini để lồng tiếng! Thêm key trong Creator.');
    }

    setIsDubbing(true); setDubbedVideoPath(''); setLogOpen(true);
    setDubProgress({ done: 0, total: segments.length, text: `Khởi động ${isEdge ? 'Edge TTS' : 'Gemini TTS'}...` });
    addSubLog(`🎙️ Lồng tiếng ${isEdge ? 'Edge TTS' : 'Gemini TTS'} — ${voiceLabel} · ${segments.length} đoạn...`);
    try {
      const ext = isEdge ? 'mp3' : 'wav';
      const audioPath = buildOutputPath(`lotieng_${voiceLabel}_audio`, ext);
      addSubLog(`💾 Audio sẽ lưu: ${audioPath.split('\\').pop()}`);

      let ttsResult;
      if (isEdge) {
        ttsResult = await window.electronAPI.generateSRTVoice({ segments, voice: edgeDubVoice, outputPath: audioPath });
      } else {
        const apiKeys = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
        ttsResult = await window.electronAPI.geminiTTSSRT({ segments, voiceName: dubVoice, apiKeys, outputPath: audioPath });
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
        outputPath: videoPath, videoVol: 0.3, audioVol: 1.0
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
    const totalSteps = 3 + (burnSubtitle ? 1 : 0) + (dubEnabled ? 1 : 0);

    addSubLog(`🚀 Bắt đầu toàn bộ quy trình — ${totalSteps} bước · lưu vào: ${subOutputFolder.split('\\').pop()}`);

    try {
      // ── BƯỚC 1: Lưu audio gốc ──
      addSubLog(`🎵 [1/${totalSteps}] Lưu audio gốc MP3...`);
      const audioGocPath = buildOutputPath('audio_goc', 'mp3');
      const audioSave = await window.electronAPI.saveAudioFromVideo({ inputPath: subVideoFile, outputFolder: subOutputFolder, outputPath: audioGocPath });
      if (audioSave.success) { setSavedAudioPath(audioSave.filePath); addSubLog(`  💾 ${audioSave.filePath.split('\\').pop()}`, 'success'); }
      else addSubLog(`  ⚠️ Lưu audio gốc thất bại: ${audioSave.error}`, 'error');

      // ── BƯỚC 2: Phiên âm → SRT gốc (chunked — quét 100% video) ──
      addSubLog(`🎙️ [2/${totalSteps}] Phiên âm → SRT gốc (quét toàn bộ video theo từng phần)...`);
      const metaRes2 = await window.electronAPI.prepareAudio(subVideoFile);
      if (!metaRes2.success || !metaRes2.duration) { addSubLog(`❌ Không đọc được thông tin video.`, 'error'); setIsRunningAll(false); return; }
      const dur2 = metaRes2.duration;
      const chunks2 = Math.ceil(dur2 / 60);
      addSubLog(`  📹 ${Math.floor(dur2/60)}p${Math.floor(dur2%60)}s → ${chunks2} phần...`);
      const transcribeResult = await transcribeAudioChunked(
        apiKeys, dur2,
        async (startSec, durationSec) => window.electronAPI.extractAudioChunk({ filePath: subVideoFile, startSec, durationSec }),
        (msg) => addSubLog(`  ⏳ ${msg}`),
        (done, total, segCount, errMsg) => {
          if (errMsg) addSubLog(`  ⚠️ Phần ${done}/${total}: ${errMsg}`);
          else        addSubLog(`  ✅ Phần ${done}/${total}: ${segCount} câu`);
        },
        (msg) => addSubLog(msg)
      );
      if (!transcribeResult?.segments?.length) { addSubLog('❌ Không nhận được kết quả phiên âm.', 'error'); setIsRunningAll(false); return; }
      const srtRaw = subSegmentsToSRT(transcribeResult.segments);
      setOriginalSegments(transcribeResult.segments);
      setRawOriginalSRT(srtRaw);
      setOriginalSRT(subNormalizeSRT(srtRaw, 42, subStyle.wordsPerLine));
      setSubPreviewTab('original');
      // Lưu SRT gốc
      const srtGocPath = buildOutputPath('srt_goc', 'srt');
      await window.electronAPI.saveTextFile({ content: srtRaw, filePath: srtGocPath });
      addSubLog(`  💾 SRT gốc: ${srtGocPath.split('\\').pop()} (${transcribeResult.segments.length} câu thoại)`, 'success');

      // ── BƯỚC 3: Dịch → SRT dịch ──
      addSubLog(`🧠 [3/${totalSteps}] Dịch sang ${langName}...`);
      const translatedRaw = await smartTranslateSRT(srtRaw, targetLang, apiKeys, (msg) => addSubLog(`  ${msg}`));
      const translatedText = translatedRaw.trim();
      const srcCount = (srtRaw.trim().match(/\n\n/g) || []).length + 1;
      const dstCount = (translatedText.match(/\n\n/g) || []).length + 1;
      setTranslatedSRT(translatedText); setSubPreviewTab('translated');
      // Lưu SRT dịch
      const srtDichPath = buildOutputPath(`srt_dich_${targetLang}`, 'srt');
      await window.electronAPI.saveTextFile({ content: translatedText, filePath: srtDichPath });
      addSubLog(`  💾 SRT dịch: ${srtDichPath.split('\\').pop()} — ${dstCount}/${srcCount} entry ${dstCount === srcCount ? '✅' : '⚠️'}`, 'success');

      // ── BƯỚC 4: Ép phụ đề (nếu bật) ──
      let burnedPath = '';
      if (burnSubtitle && translatedText) {
        addSubLog(`🔥 [4/${totalSteps}] Ép phụ đề vào video...`);
        const srtForBurn = subWrapSRTLines(translatedText, subStyle.wordsPerLine, 42);
        const phuDePath  = buildOutputPath('phu_de', 'mp4');
        const burnResult = await window.electronAPI.burnSubtitles({
          videoPath: subVideoFile, srtContent: srtForBurn,
          outputFolder: subOutputFolder, outputPath: phuDePath, style: subStyle
        });
        if (burnResult.success) {
          burnedPath = burnResult.path; setBurnedVideoPath(burnResult.path);
          addSubLog(`  💾 Video phụ đề: ${burnResult.path.split('\\').pop()}`, 'success');
          if (!dubEnabled) { setSubPreviewTab('video'); addSubLog('🎉 Hoàn tất!', 'success'); }
        } else { addSubLog(`  ⚠️ Ép phụ đề thất bại: ${burnResult.error}`, 'error'); }
      }

      // ── BƯỚC 5: Lồng tiếng (nếu bật) ──
      if (dubEnabled && translatedText) {
        const isEdge = dubEngine === 'edge';
        const voiceLabel = isEdge ? edgeDubVoice.split('-').pop() : dubVoice;
        const dubStep = burnSubtitle ? 5 : 4;
        const dubSegs = subParseSRTtoSegments(translatedText);
        addSubLog(`🎙️ [${dubStep}/${totalSteps}] Lồng tiếng ${isEdge ? 'Edge TTS' : 'Gemini TTS'} (${voiceLabel}) · ${dubSegs.length} đoạn...`);
        setDubProgress({ done: 0, total: dubSegs.length, text: 'Khởi động...' });

        // 5a. Tạo file audio lồng tiếng
        const ext = isEdge ? 'mp3' : 'wav';
        const audioLotiengPath = buildOutputPath(`lotieng_${voiceLabel}_audio`, ext);
        addSubLog(`  💾 Audio sẽ lưu: ${audioLotiengPath.split('\\').pop()}`);

        let ttsResult;
        if (isEdge) {
          ttsResult = await window.electronAPI.generateSRTVoice({ segments: dubSegs, voice: edgeDubVoice, outputPath: audioLotiengPath });
        } else {
          ttsResult = await window.electronAPI.geminiTTSSRT({ segments: dubSegs, voiceName: dubVoice, apiKeys, outputPath: audioLotiengPath });
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
            outputPath: finalVideoPath, videoVol: 0.3, audioVol: 1.0
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
            {/* Chọn video */}
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Video nguồn</label>
              <button onClick={async () => { const p = await window.electronAPI.selectFile('video'); if (p) { setSubVideoFile(p); setSavedAudioPath(''); setOriginalSRT(''); setRawOriginalSRT(''); setTranslatedSRT(''); setOriginalSegments([]); } }}
                className={`w-full h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-colors ${subVideoFile ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-700 bg-[#0f172a] hover:bg-slate-800'}`}>
                <div className={`p-2 rounded-full ${subVideoFile ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}><UploadCloud size={20} /></div>
                <p className={`text-xs font-bold truncate w-[280px] text-center px-2 ${subVideoFile ? 'text-amber-400' : 'text-slate-300'}`}>{subVideoFile ? subVideoFile.split('\\').pop() : 'Nhấn để chọn file video'}</p>
              </button>
            </div>
            {/* Thư mục lưu */}
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Thư mục lưu Audio</label>
              <div className="flex gap-2">
                <input type="text" readOnly value={subOutputFolder} placeholder="Chưa chọn..." className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-400 focus:outline-none truncate" />
                <button onClick={async () => { const f = await window.electronAPI.selectFolder(); if (f) setSubOutputFolder(f); }} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg"><FolderOpen size={15} /></button>
              </div>
            </div>
            {/* Bước 1 — Bóc tách Audio */}
            <div className="border border-slate-700 rounded-xl p-4 bg-[#0f172a]/50">
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
            </div>
            {/* Bước 2 — Tạo SRT */}
            <div className="border border-slate-700 rounded-xl p-4 bg-[#0f172a]/50">
              <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2"><FileText size={14} className="text-sky-400"/> Bước 2 — Tạo SRT gốc (Gemini 2.5)</p>
              <button onClick={handleTranscribe} disabled={isTranscribing || !subVideoFile}
                className="w-full bg-sky-700 hover:bg-sky-600 disabled:bg-slate-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm transition-colors">
                {isTranscribing ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                {isTranscribing ? 'ĐANG PHIÊN ÂM...' : 'Tạo SRT từ Video'}
              </button>
            </div>
            {/* Bước 3 — Dịch Thông Minh */}
            <div className="border border-purple-500/20 rounded-xl p-4 bg-purple-900/5 space-y-3">
              <p className="text-xs font-bold text-purple-300 flex items-center gap-2"><Languages size={14} className="text-purple-400"/> Bước 3 — Dịch Thông Minh AI</p>
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
                    <button onClick={() => setDubEngine('gemini')}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${dubEngine === 'gemini' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      ✨ Gemini TTS
                    </button>
                    <button onClick={() => setDubEngine('edge')}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${dubEngine === 'edge' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                      🔵 Edge TTS
                    </button>
                  </div>

                  {/* ── Gemini voice picker ── */}
                  {dubEngine === 'gemini' && (
                    <>
                      <div className="flex gap-1">
                        {[['all','Tất cả'],['female','Nữ'],['male','Nam'],['neutral','Trung tính']].map(([v,l]) => (
                          <button key={v} onClick={() => setDubGenderFilter(v)}
                            className={`flex-1 py-1 rounded text-[9px] font-bold border transition-colors ${dubGenderFilter === v ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>{l}</button>
                        ))}
                      </div>
                      <select value={dubVoice} onChange={e => setDubVoice(e.target.value)}
                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500">
                        {dubGenderFilter === 'all' ? (
                          <>
                            <optgroup label="👩 Giọng Nữ">
                              {GEMINI_VOICES_DUB.filter(v => v.gender === 'female').map(v => (
                                <option key={v.id} value={v.id}>👩 {v.id} — {v.style}</option>
                              ))}
                            </optgroup>
                            <optgroup label="👨 Giọng Nam">
                              {GEMINI_VOICES_DUB.filter(v => v.gender === 'male').map(v => (
                                <option key={v.id} value={v.id}>👨 {v.id} — {v.style}</option>
                              ))}
                            </optgroup>
                            <optgroup label="🧑 Trung tính">
                              {GEMINI_VOICES_DUB.filter(v => v.gender === 'neutral').map(v => (
                                <option key={v.id} value={v.id}>🧑 {v.id} — {v.style}</option>
                              ))}
                            </optgroup>
                          </>
                        ) : (
                          GEMINI_VOICES_DUB.filter(v => v.gender === dubGenderFilter).map(v => (
                            <option key={v.id} value={v.id}>{v.gender === 'female' ? '👩' : v.gender === 'male' ? '👨' : '🧑'} {v.id} — {v.style}</option>
                          ))
                        )}
                      </select>
                    </>
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

                  <p className="text-[9px] text-slate-500">🔊 Tiếng gốc giảm 30% · Voice lồng tiếng giữ nguyên 100%</p>
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
              {['SRT gốc → Dịch AI', burnSubtitle && '→ 🔥 Ép phụ đề', dubEnabled && `→ 🎙️ Lồng tiếng (${dubEngine === 'edge' ? edgeDubVoice.split('-').pop() : dubVoice})`].filter(Boolean).join(' ')}
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
                      <span className="text-[9px] text-blue-400 bg-blue-900/30 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold shrink-0">{burnedVideoPath ? '✅ Phụ đề + Lồng tiếng · Tiếng gốc 30%' : `🎙️ Gemini ${dubVoice} · Tiếng gốc 30%`}</span>
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
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
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

      charIds.forEach((charId, i) => {
        const data      = charMap.get(charId);
        const name      = typeof data === 'object' ? (data.name || charId) : charId;
        const desc      = typeof data === 'object' ? (data.description || name) : data;
        const stylePart = stylePrompt ? `${stylePrompt}. ` : 'Photorealistic, 4K, high detail. ';
        const prompt    = `${stylePart}Multi-angle character turnaround reference sheet, 8 panels in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head] [right side profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white studio background. CHARACTER: ${name}, ${desc}. Same character consistently across all 8 panels. Professional character design turnaround sheet. No text labels, no arrows, no annotations, no captions, no watermarks.`;
        dnaTasks.push({ id: `dna_c${i}`, prompt, fileIndex: _dnaIdx++ });
        charDnaTaskMap.set(`dna_c${i}`, charId);
      });
      envIds.forEach((envId, i) => {
        const desc   = envMap.get(envId) || envId;
        const prompt = `Photorealistic wide establishing shot, ${desc}, empty scene, no people, cinematic quality, 4K`;
        dnaTasks.push({ id: `dna_e${i}`, prompt, fileIndex: _dnaIdx++ });
        envDnaTaskMap.set(`dna_e${i}`, envId);
      });

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
            aspectRatio: '1:1', model: imgMdl,
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

        // P5: random fill — chars còn lại rồi envs
        if (picked.length < MAX) {
          const remaining = [];
          const rSeen = new Set(seen);
          for (const id of [...new Set([...Object.keys(charMediaMap), ...Object.keys(charImgMap)])]) {
            if (!rSeen.has(id)) { rSeen.add(id); remaining.push({ id, type: 'char' }); }
          }
          for (const id of [...new Set([...Object.keys(envMediaMap), ...Object.keys(envImgMap)])]) {
            if (!rSeen.has(id)) { rSeen.add(id); remaining.push({ id, type: 'env' }); }
          }
          [...remaining].sort(() => Math.random() - 0.5)
            .forEach(({ id, type }) => tryAdd(id, type));
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
          for (const ff of failedFiles) { if (isPolicyViolation(ff.error)) { u2vPolicySet.add(ff.id); addLog(`🚫 [Chính sách Veo] Vi phạm: "${(ff.error||'').slice(0,80)}" → đổi prompt`, 'error'); } }
          pendingTasks = safeTasks.filter(t => failedIds.has(t.id)).map(t => {
            const ni = `${t.id}_r${attempt}`;
            veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
            if (u2vPolicySet.has(t.id)) { u2vPolicySet.delete(t.id); u2vPolicySet.add(ni); const cp = sanitizePrompt(t.prompt); addLog(`🔧 Prompt làm sạch: "${cp.slice(0,70)}..."`, 'info'); return { ...t, id: ni, prompt: cp }; }
            return { ...t, id: ni };
          });
          if (pendingTasks.length > 0 && attempt < maxRetry) addLog(`⚠️ ${passLabel}[Veo] ${pendingTasks.length} video lỗi → chờ 10s...`, 'error');
        }
      };

      // Vòng chính — 5 lần
      addLog(`📋 Tạo ${pendingTasks.length} video — thử ${MAX_FIRST_RETRY_U2V} lần/task`, 'info');
      await runU2VVeoPass('', MAX_FIRST_RETRY_U2V);
      if (pendingTasks.length > 0) addLog(`⏭️ ${pendingTasks.length} video vẫn lỗi → bỏ qua, tiếp tục`, 'warn');

      // Global retry sau khi TẤT CẢ xong
      if (pendingTasks.length > 0) {
        addLog(`\n🔄 ════ GLOBAL RETRY ════ ${pendingTasks.length} video lỗi → retry ${MAX_GLOBAL_RETRY_U2V} lần...`, 'info');
        await sleep(3000);
        const MAX_GLOBAL_U2V = 20;
        for (let gPass = 1; gPass <= MAX_GLOBAL_U2V && pendingTasks.length > 0; gPass++) {
          if (stopRef.current) throw new Error('Đã dừng.');
          addLog(`🔄 [Global Retry ${gPass}/${MAX_GLOBAL_U2V}] ${pendingTasks.length} video vẫn lỗi → thử lại ${MAX_GLOBAL_RETRY_U2V} lần...`, 'info');
          await sleep(5000);
          pendingTasks = pendingTasks.map(t => {
            const ni = `${t.id}_g${gPass}`;
            veoTaskMap.set(ni, veoTaskMap.get(t.id)); veoTaskMap.delete(t.id);
            return { ...t, id: ni };
          });
          await runU2VVeoPass(`[Global ${gPass}/${MAX_GLOBAL_U2V}]`, MAX_GLOBAL_RETRY_U2V);
          if (pendingTasks.length === 0) addLog(`✅ [Global Retry] Tất cả hoàn thành ở vòng ${gPass}!`, 'success');
          else addLog(`⚠️ [Global Retry ${gPass}] Còn ${pendingTasks.length} video lỗi...`, 'error');
        }
      }
      // Policy Repair
      if (pendingTasks.length > 0) {
        addLog(`❌ ${pendingTasks.length} video vẫn lỗi — chạy Policy Repair...`, 'error');
        const rpMap = new Map(pendingTasks.map(t => [t.id, veoTaskMap.get(t.id)]));
        await runPolicyRepairLoop(pendingTasks, rpMap, orderedVPaths,
          async (task) => window.electronAPI.runVeo({ mediaType:'Video', tasks:[task], aspectRatio:ratio, model:vidMdl, genCount:'1x', quality:vidQuality, outputFolder:vidDir, duration:'8s' }),
          addLog, stopRef);
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
  const [apiKeys] = useState(loadKeys);

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
    if (sceneDur === 10) setVidModel('Omni Flash');
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
          return [...prev, { id: Date.now() + Math.random(), name: file.name, base64: b64, mime, label: '' }];
        });
      };
      reader.readAsDataURL(file);
    });
    if (refImageInputRef.current) refImageInputRef.current.value = '';
  };
  const removeRefImage  = (id) => setRefImages(prev => prev.filter(img => img.id !== id));
  const updateRefLabel  = (id, label) => setRefImages(prev => prev.map(img => img.id === id ? { ...img, label } : img));
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
    window.electronAPI?.onVeoLog?.(handler);
    return () => window.electronAPI?.removeAllListeners?.('veo-log');
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
    if (!apiKeys.length) return alert('Chưa có Gemini API Key! Vào Creator Studio để thêm.');
    if (inputMode === 'idea'   && !ideaText.trim())   return alert('Nhập ý tưởng trước!');
    if (inputMode === 'script' && !scriptText.trim()) return alert('Nhập kịch bản trước!');

    stopRef.current = false;
    setParsedData(null);
    setCharDnaMap({});
    setDnaJobIdToCharId({});
    setSceneJobs([]);
    setMergedPath(null);

    try {
      // ── 1. Generate script if idea mode ─────────────────────────────────────
      let finalScript = scriptText;
      if (inputMode === 'idea') {
        setPhase('gen_script');
        addLog('✍️ Đang tạo kịch bản từ ý tưởng...', 'info');
        const sText = await generateScript(apiKeys, {
          topic:         ideaText,
          platform,
          sceneDuration: sceneDur,
          totalDuration: totalMins,
          language,
          style,
          goal,
          tone,
          audience,
          mainChar:  hasMainChar ? mainChar : null,
          secChars:  secChars.filter(c => c.name || c.appearance),
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

      // ── 2a. Phân tích ảnh tham chiếu (nếu có) — bước riêng trước parse ────────
      let refAnalysis = null;
      if (refImages.length > 0) {
        addLog(`🔍 Phân tích ${refImages.length} ảnh tham chiếu với Gemini...`, 'info');

        const labelNames = { character: 'Nhân vật', style: 'Phong cách', setting: 'Bối cảnh', '': 'Tham chiếu chung' };
        const imgListText = refImages.map((img, i) =>
          `Image ${i + 1}: "${img.name}" [${labelNames[img.label] || 'Tham chiếu chung'}]`
        ).join('\n');

        const ANALYZE_PROMPT = `You are a professional visual designer and character artist. Analyze ALL provided reference images carefully and output ONLY valid JSON (no markdown fences, no extra text).

Images provided (${refImages.length} total):
${imgListText}

Output this exact JSON structure:
{
  "characters": [
    {
      "imageIndex": 0,
      "label": "Main character / Secondary character / Background character",
      "suggestedName": "name if text visible in image, else null",
      "gender": "male|female|unknown",
      "ethnicity": "VERY SPECIFIC — e.g. East Asian Vietnamese woman / South Asian Indian man / Caucasian Western woman / Middle Eastern man / Black African woman / Hispanic Latino man / Southeast Asian Thai woman — never write just 'Asian' or 'Western'",
      "ageRange": "early 20s / mid 30s / late 40s / etc.",
      "hair": "EXACT color (jet-black / deep dark brown / chestnut brown / auburn / honey blonde / platinum blonde / ash grey — NEVER just 'dark' or 'light') + EXACT length (waist-length / hip-length / shoulder-length / chin-length / short pixie / buzz cut) + EXACT style (straight / wavy / curly / sleek / voluminous / tied back / ponytail / bun)",
      "skinTone": "fair porcelain / light beige / warm olive / medium tan / deep brown / dark ebony",
      "faceShape": "soft oval / sharp V-line / round / square jaw / heart-shaped",
      "eyes": "eye shape (almond single-lid / large round double-lid / deep-set / hooded) + exact eye color (deep brown / dark hazel / warm amber / bright green / ice blue)",
      "build": "height impression (petite/average/tall) and body type (slender/athletic/average/curvy)",
      "clothing": "EXACT garment: type + cut + specific color names — e.g. oversized cream cable-knit sweater + high-waisted dark navy straight-leg jeans + white leather chunky sneakers",
      "accessories": "list every item: glasses, hat, bag, jewelry, belt, watch — or 'none'",
      "distinctiveFeatures": "moles, scars, tattoos, freckles, dimples — or 'none'",
      "fullDesc": "one ultra-detailed paragraph combining ethnicity + all physical traits + clothing: '[Name/Character] is a [exact ethnicity] in their [age]. HAIR: [details]. FACE: [skin tone + eye + face shape]. BUILD: [details]. CLOTHING: [full outfit]. ACCESSORIES: [list]'"
    }
  ],
  "settings": [
    {
      "imageIndex": 0,
      "locationType": "very specific e.g. modern minimalist Japanese apartment living room / traditional Vietnamese village market / futuristic neon-lit Tokyo alley / sunlit Mediterranean coastal cafe",
      "timeOfDay": "early morning / morning / midday / afternoon / golden hour / evening / night",
      "lighting": "quality and direction: soft natural diffused / harsh midday sunlight / warm indoor tungsten / cool fluorescent / dramatic side-lighting / backlit silhouette / neon glow",
      "dominantColors": "list 3-5 dominant colors with specific names e.g. muted sage green, warm ivory, terracotta orange, deep charcoal",
      "mood": "e.g. peaceful and intimate / tense and dramatic / vibrant and energetic / melancholic and quiet",
      "architecturalStyle": "e.g. minimalist contemporary / traditional Asian wooden / brutalist concrete / Art Deco / rustic farmhouse",
      "keyProps": "important objects, furniture, plants, vehicles, signage that define the space"
    }
  ],
  "artStyle": {
    "renderStyle": "photorealistic / anime 2D / semi-realistic / 3D CGI render / stylized illustration / cinematic film / watercolor / ink sketch",
    "colorGrading": "warm golden hour / cool blue / desaturated muted / vibrant saturated / high contrast B&W / pastel soft",
    "lightingStyle": "soft natural diffused / dramatic chiaroscuro / rim-lit / backlit / flat lighting / Rembrandt",
    "visualTone": "dark moody cinematic / bright airy / neutral balanced / dramatic intense / dreamy soft",
    "filmGrain": true,
    "aspectRatio": "16:9 / 9:16 / 1:1 / 4:3 / 2.35:1 anamorphic",
    "referenceDescription": "2-sentence summary of the overall visual style and art direction these images convey"
  },
  "summary": "2-3 sentence summary explaining what these reference images communicate: character archetypes, visual world, tone, and how they should influence the storyboard visual language"
}

RULES:
- For each image with a visible person → add entry to "characters" (imageIndex = 0-based)
- For each image with a location/environment → add entry to "settings"
- An image can contribute to BOTH characters AND settings arrays
- If image is purely for style → only fill/update "artStyle"
- Be EXTREMELY precise about colors — never use vague terms
- If multiple characters in one image → add multiple character entries with the same imageIndex
- Always fill "artStyle" based on the overall aesthetic of all images combined`;

        try {
          const analyzeParts = refImages.map(img => ({
            inlineData: { mimeType: img.mime, data: img.base64 }
          }));
          analyzeParts.push({ text: ANALYZE_PROMPT });

          const analyzeRaw = await retryWithKeyRotation(async (apiKey) => {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: analyzeParts }] }) }
            );
            if (!res.ok) { const e = await res.json().catch(() => ({})); const err = new Error(e?.error?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
            const d = await res.json();
            return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }, apiKeys, { onSwitch: (info) => addLog(`🔄 Chuyển API key #${(info?.toIdx ?? 0) + 1}`, 'info') });

          const analyzeJson = analyzeRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          refAnalysis = JSON.parse(analyzeJson);

          const nC = refAnalysis.characters?.length || 0;
          const nS = refAnalysis.settings?.length   || 0;
          addLog(`✅ Phân tích ảnh xong: ${nC} nhân vật, ${nS} bối cảnh — phong cách: ${refAnalysis.artStyle?.renderStyle || '?'}`, 'success');
          if (refAnalysis.summary) addLog(`📋 ${refAnalysis.summary}`, 'info');
        } catch (err) {
          addLog(`⚠️ Phân tích ảnh thất bại: ${err.message} — tiếp tục không có dữ liệu ảnh`, 'warn');
          refAnalysis = null;
        }
        if (stopRef.current) throw new Error('Đã dừng.');
      }

      // ── 2b. Parse kịch bản với Gemini ────────────────────────────────────────
      addLog('🎭 Phân tích kịch bản với Gemini...', 'info');

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
            const imgLabel = refImages[c.imageIndex]?.label
              ? ` [${refImages[c.imageIndex].label}]` : '';
            return `  📸 REF CHARACTER #${i + 1}${imgLabel} (Ảnh ${c.imageIndex + 1}): ` +
              (c.suggestedName ? `Tên đề xuất: "${c.suggestedName}" | ` : '') +
              `${c.gender}, ${c.ethnicity}, ${c.ageRange}. ` +
              `HAIR: ${c.hair}. SKIN: ${c.skinTone}. FACE: ${c.faceShape}, ${c.eyes}. ` +
              `BUILD: ${c.build}. CLOTHING: ${c.clothing}. ACCESSORIES: ${c.accessories}. ` +
              `DISTINCTIVE: ${c.distinctiveFeatures}.\n  → Full desc: ${c.fullDesc}`;
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

      // Build multimodal parts — gửi TẤT CẢ ảnh tham chiếu kèm parse prompt
      const _parseParts = [];
      if (refImages.length > 0) {
        refImages.forEach(img => _parseParts.push({ inlineData: { mimeType: img.mime, data: img.base64 } }));
        addLog(`🖼️ Đính kèm ${refImages.length} ảnh tham chiếu → Gemini parse...`, 'info');
      }
      _parseParts.push({ text: PARSE_PROMPT });

      const rawText = await retryWithKeyRotation(async (apiKey) => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: _parseParts }] }) }
        );
        if (!res.ok) { const e = await res.json().catch(() => ({})); const err = new Error(e?.error?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
        const d = await res.json();
        return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }, apiKeys, { onSwitch: (info) => addLog(`🔄 Chuyển API key #${(info?.toIdx ?? 0) + 1}`, 'info') });

      const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed  = JSON.parse(jsonStr);
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
      const MAX_GLOBAL_RETRY = 20; // global: sau khi xong tất cả, retry lỗi 20 lần
      const MAX_GLOBAL_PASSES = 20; // vòng global tối đa

      const runVeoBatch = async (baseParams, tasks, enableGlobalRetry = false) => {
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
              if (idx !== undefined) orderedResults[idx] = f;
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
      if (characters.length > 0) {
        const dnaTs    = Date.now();
        const dnasMeta = characters.map((c, i) => ({ charId: c.id, name: c.name, taskId: `dna_c${i}_${dnaTs}` }));
        const dnaTasks = characters.map((c, i) => ({
          id:        `dna_c${i}_${dnaTs}`,
          prompt:    c.dna_prompt || `MANDATORY ART STYLE: ${parsed.art_style || 'Cinematic quality'}. Multi-angle character turnaround reference sheet, 8 panels in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head] [right side profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white studio background, no scene, no props except own accessories. CHARACTER: ${c.desc}. Same character consistently across all 8 panels. Professional character design turnaround sheet. NO style deviation. No text labels, no arrows, no annotations, no captions, no watermarks, no on-screen text.`,
          fileIndex: i + 1,
        }));

        // Map jobId → charId để real-time preview cập nhật DNA column ngay khi xong
        const jobIdToCharId = {};
        dnasMeta.forEach(m => { jobIdToCharId[m.taskId] = m.charId; });
        setDnaJobIdToCharId(jobIdToCharId);

        {
          // ── Veo DNA ─────────────────────────────────────────────────────────
          addLog(`🧬 Batch tạo ${characters.length} ảnh DNA tham chiếu (TC_image_N)...`, 'info');
          const dnaResults = await runVeoBatch(
            { mediaType: 'Image', aspectRatio: '1:1', model: imgModel, outputFolder, genCount: '1x', quality: '1K', duration: '4s' },
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
          prompt:      applyVeoPolicy(stripProminentPeople(buildImagePrompt(sc, parsed))),
          videoPrompt: applyVeoPolicy(stripProminentPeople(buildVideoPrompt(sc, parsed))),
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
      addLog(`🖼 Batch tạo ${jobs.length} ảnh cảnh (thử lại tối đa ${MAX_RETRY} lần)...`, 'info');
      setSceneJobs(jobs.map(j => ({ ...j, imgStatus: 'running' })));

      // Mỗi cảnh dùng đúng prompt ảnh của cảnh đó + DNA nhân vật xuất hiện trong cảnh
      const imgTasks = jobs.map((job, i) => {
        const dnaFiles = job.sceneDnaImgs.map(p => p.split(/[\\/]/).pop()).join(', ') || 'none';
        addLog(`[Storyboard] Cảnh ${job.sceneNum} (jobs[${i}]): tạo ảnh + DNA=[${dnaFiles}]`, 'info');
        const t = { id: job.imgJobId, prompt: job.prompt, fileIndex: i + 1 };
        // Dùng referenceImages (không phải ingredientImages) để VeoEngine thực sự dùng DNA làm tham chiếu
        if (job.sceneDnaImgs.length > 0) t.referenceImages = job.sceneDnaImgs;
        return t;
      });
      const imgResults = await runVeoBatch(
        { mediaType: 'Image', aspectRatio, model: imgModel, outputFolder, genCount: '1x', quality: '1K', duration: '4s' },
        imgTasks
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
      addLog(`🎬 Batch tạo ${jobsWithImg.length} video từ scene image (thử lại tối đa ${MAX_RETRY} lần)...`, 'info');
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
      const vidResults = await runVeoBatch(
        { mediaType: 'Video', aspectRatio, model: vidModel, outputFolder, genCount: '1x', quality: videoQuality, duration },
        vidTasks,
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
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                        <p className="text-[9px] text-slate-400 truncate leading-tight">{img.name}</p>
                        <div>
                          <p className="text-[8px] text-slate-700 uppercase mb-0.5">Loại tham chiếu</p>
                          <select value={img.label} onChange={e => updateRefLabel(img.id, e.target.value)}
                            disabled={isRunning}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-[9px] rounded-lg px-1.5 py-1 outline-none focus:border-amber-500/50 disabled:opacity-40">
                            {REF_IMG_LABELS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                        </div>
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
                <button onClick={() => { setDuration('10s'); setSceneDur(10); setVidModel('Omni Flash'); }}
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
                        {fp.split(/[\\/]/).pop()}
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
                        {mergedPath.split(/[\\/]/).pop()}
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

const SUB = [
  { id:'idea',        label:'Idea to Video',         icon:Zap,       color:'bg-violet-600' },
  { id:'script2vid',  label:'Script to Video',        icon:FileText,  color:'bg-green-600'  },
  { id:'audio',       label:'Audio to Video',         icon:Music2,    color:'bg-blue-600'   },
  { id:'url2vid',     label:'Url to Video',            icon:Link,      color:'bg-rose-600'   },
  { id:'subtitle',    label:'Bóc tách - Dịch phụ đề', icon:Languages, color:'bg-amber-600'  },
  { id:'storyboard',  label:'Storyboard',              icon:Film,      color:'bg-pink-600'   },
];

export default function AutoAnimation() {
  const [panel, setPanel] = useState('idea');
  return (
    <div className="flex flex-col h-full w-full bg-[#080e1a]">
      <div className="h-11 shrink-0 flex items-center gap-3 px-5 border-b border-slate-800/80 bg-[#0a0f1e]">
        <div className="flex items-center gap-1.5 font-bold text-sm text-white">
          <Layers size={15} className="text-violet-400"/> Auto Animation
        </div>
        <ChevronRight size={12} className="text-slate-800"/>
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
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-0 flex" style={{ display: panel === 'idea'       ? 'flex' : 'none' }}><IdeaToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'script2vid'? 'flex' : 'none' }}><ScriptToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'audio'     ? 'flex' : 'none' }}><AudioToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'subtitle'  ? 'flex' : 'none' }}><SubtitlePanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'url2vid'   ? 'flex' : 'none' }}><UrlToVideoPanel/></div>
        <div className="absolute inset-0 flex" style={{ display: panel === 'storyboard'? 'flex' : 'none' }}><StoryboardPanel/></div>
      </div>
    </div>
  );
}
