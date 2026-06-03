/**
 * scriptGenerator.js
 * Script generation shared between CreatorStudio (ScriptWriterPanel) and AutoAnimation.
 * Exact same prompt format, SCENE_FORMAT template, chunk logic as Creator.
 */
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from './keyRotation.js';

const GEMINI_MODEL   = 'gemini-2.5-flash';
const SCENE_CHUNK    = 25; // scenes per API call — same as Creator

// Normalise language code/label → display label used in prompts
const LANG_LABEL_MAP = {
  'vi': 'Tiếng Việt',  'vi-VN': 'Tiếng Việt',
  'en': 'English',     'en-US': 'English',
  'ja': '日本語',      'ja-JP': '日本語',
  'zh': 'Tiếng Trung', 'zh-CN': 'Tiếng Trung',
  'ko': '한국어',      'ko-KR': '한국어',
};

async function geminiChatRotating(apiKeys, prompt, maxTokens, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    });
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') throw new Error('Nội dung bị chặn do chính sách an toàn.');
    let text = response?.text || '';
    if (!text && candidate?.content?.parts)
      text = candidate.content.parts.filter(p => p.text).map(p => p.text).join('');
    return text || '';
  }, apiKeys, { onSwitch });
}

// ── Same SCENE_FORMAT as ScriptWriterPanel in Creator ──────────────────────────
export const SCENE_FORMAT = (langLabel, noDialogue = false) =>
`⚠️ QUY TẮC SHOT — BẮT BUỘC THỰC HIỆN:
• Số shot mỗi cảnh: TỐI THIỂU 1, TỐI ĐA 5 — KHÔNG mặc định 2 shot cho mọi cảnh
• Căn cứ theo nội dung & kịch tính:
  - 1 shot: cảnh thiền tư, im lặng, cận cảm xúc, moment trầm tĩnh kéo dài
  - 2 shot: cảnh chuyển tiếp nhẹ, nhân vật đang suy nghĩ hoặc di chuyển đơn
  - 3 shot: cảnh đối thoại ngắn, hành động vừa, khám phá không gian
  - 4 shot: cảnh xung đột, hành động nhiều bước, montage cảm xúc
  - 5 shot: cảnh hành động căng thẳng, cao trào, nhiều nhân vật tương tác, montage nhanh
• Mỗi shot PHẢI có góc máy KHÁC nhau (cấm lặp góc liên tiếp)
• Góc máy đa dạng: ECU / CU / MCU / MS / MLS / LS / WS / EWS / POV / OTS / Dutch Angle / Bird's Eye / Low Angle / High Angle / Tracking / Dolly / Handheld / Crane / Aerial

ĐỊNH DẠNG MỖI CẢNH:
[CẢNH n: Xs → Ys] — [Tên cảnh]
🎬 BỐI CẢNH: [địa điểm, thời gian, ánh sáng, không khí]
🎥 HÌNH ẢNH: (viết đủ số shot phù hợp nội dung — từ 1 đến 5 shot, mỗi shot góc khác nhau)
  📷 Shot 1 | [Xs→Ys] | [GÓC MÁY — chọn phù hợp]
     → Bối cảnh: [hậu cảnh, ánh sáng, màu sắc]
     → Hành động: [nhân vật/biểu cảm/chuyển động máy]
  📷 Shot 2 | [Xs→Ys] | [GÓC MÁY KHÁC Shot 1] (nếu cần)
     → Bối cảnh: ...
     → Hành động: ...
  📷 Shot 3–5 | ... (nếu cần, tiếp tục tương tự, mỗi shot 1 góc máy riêng)
${noDialogue
  ? '🔇 LỜI THOẠI: — Không có thoại — (tuyệt đối không viết lời thoại trong cảnh này)'
  : `🎤 LỜI THOẠI: [Nhân vật/VO]: "[CHỈ viết bằng ${langLabel} — KHÔNG dịch]" — hoặc: "— Im lặng —"
  ⛔ SAU LỜI THOẠI TUYỆT ĐỐI KHÔNG được viết thêm: bản dịch, phiên âm, chú thích, nội dung trong ngoặc đơn (...) hay bất kỳ ngôn ngữ nào khác.`}
🎵 SFX/BGM: [nhạc nền, hiệu ứng]`;

/**
 * generateScript — mirror of ScriptWriterPanel.generateContent (mode=script)
 *
 * @param {string[]} apiKeys
 * @param {{
 *   topic: string,
 *   platform?: string,
 *   sceneDuration?: number,   // seconds, default 8
 *   totalDuration?: number,   // minutes, default 3
 *   language?: string,        // 'vi' | 'en' | 'ja' | 'zh' | 'ko' | 'vi-VN' | ...
 *   style?: string,           // script style / visual style
 *   goal?: string,
 *   tone?: string,
 *   audience?: string,
 *   mainChar?: object|null,
 *   secChars?: object[],
 * }} config
 * @param {(event: object) => void} [onProgress]
 *   Events: { type:'chunk', message, from, to, total }
 *            { type:'chunk_done', scriptSoFar, from, to, total }
 *            { type:'key_switch', message }
 * @returns {Promise<string>} full script text
 */
export async function generateScript(apiKeys, config, onProgress) {
  const {
    topic,
    platform      = 'TikTok dọc',
    sceneDuration = 8,
    totalDuration = 3,
    language      = 'vi',
    style         = 'Mặc định',
    goal          = 'Giải trí & Viral',
    tone          = 'Bi tráng & Hào hùng',
    audience      = 'Người trẻ (Gen Z & Alpha)',
    mainChar      = null,
    secChars      = [],
  } = config;

  const noDialogue = language === 'none' || language === 'no-dialogue';
  const langLabel  = noDialogue ? 'Không lời thoại' : (LANG_LABEL_MAP[language] || language);

  const onSwitch = ({ fromIdx, toIdx, total }) =>
    onProgress?.({ type: 'key_switch', message: `Key ${fromIdx + 1} bị giới hạn → Chuyển sang Key ${toIdx + 1}/${total}` });

  // ── Character block (identical to Creator) ──────────────────────────────────
  const buildCharacterBlock = () => {
    const hasMain = mainChar && (mainChar.name || mainChar.appearance || mainChar.clothing || mainChar.ethnicity);
    const validSec = (secChars || []).filter(c => c.name || c.appearance);
    if (!hasMain && !validSec.length) return '';
    const fmtChar = (c, label) => {
      let s = `${label}\n`;
      if (c.name) s += `  • Tên: ${c.name}\n`;
      s += `  • Giới tính: ${c.gender || 'Nam'}${c.age ? ` | Độ tuổi: ${c.age}` : ''}\n`;
      if (c.ethnicity) s += `  • Sắc tộc / Quốc tịch: ${c.ethnicity}\n`;
      if (c.appearance) s += `  • Ngoại hình chi tiết: ${c.appearance}\n`;
      if (c.clothing) s += `  • Trang phục & Phụ kiện: ${c.clothing}\n`;
      if (c.role) s += `  • Vai trò trong kịch bản: ${c.role}\n`;
      return s;
    };
    let block = `\n${'═'.repeat(46)}\nHỒ SƠ NHÂN VẬT (XÁC ĐỊNH SẴN — BẮT BUỘC DÙNG CHÍNH XÁC, KHÔNG THAY ĐỔI):\n\n`;
    if (hasMain) block += fmtChar(mainChar, '👤 NHÂN VẬT CHÍNH:') + '\n';
    validSec.forEach((c, i) => { block += fmtChar(c, `👥 NHÂN VẬT PHỤ ${i + 1}:`) + '\n'; });
    block += `⚠️ Tuyệt đối KHÔNG thay đổi, KHÔNG sáng tác lại tên, ngoại hình, trang phục của các nhân vật trên.\n${'═'.repeat(46)}`;
    return block;
  };

  // ── Setup ────────────────────────────────────────────────────────────────────
  const numScenes  = Math.max(1, Math.round((totalDuration * 60) / sceneDuration));
  const numChunks  = Math.ceil(numScenes / SCENE_CHUNK);
  const charBlock  = buildCharacterBlock();

  const baseInfo =
`CHỦ ĐỀ: "${topic}"
NỀN TẢNG: ${platform} | ${noDialogue ? 'CHẾ ĐỘ: KHÔNG CÓ THOẠI' : `NGÔN NGỮ THOẠI: ${langLabel}`} | PHONG CÁCH: ${style}
MỖI CẢNH: ${sceneDuration}s | TỔNG: ${numScenes} cảnh | ĐỐI TƯỢNG: ${audience}
MỤC TIÊU: ${goal} | GIỌNG ĐIỆU: ${tone}${charBlock ? '\n' + charBlock : ''}`;

  let fullScript  = '';
  let projectBible = '';

  // ── Chunked generation (identical to Creator) ────────────────────────────────
  for (let ci = 0; ci < numChunks; ci++) {
    const fromScene = ci * SCENE_CHUNK + 1;
    const toScene   = Math.min((ci + 1) * SCENE_CHUNK, numScenes);
    const isFirst   = ci === 0;
    const isLast    = toScene === numScenes;

    onProgress?.({
      type: 'chunk',
      from: fromScene, to: toScene, total: numScenes,
      message: numChunks > 1
        ? `Đang tạo cảnh ${fromScene}–${toScene} / ${numScenes}...`
        : `Đang tạo kịch bản ${numScenes} cảnh...`,
    });

    let prompt;
    if (isFirst) {
      prompt =
`Bạn là nhà biên kịch và đạo diễn điện ảnh chuyên nghiệp.
${baseInfo}
---
🚫 CHÍNH SÁCH NỘI DUNG VEO (BẮT BUỘC — KHÔNG NGOẠI LỆ):
Kịch bản phải tuân thủ chính sách nội dung của Google Veo. TUYỆT ĐỐI KHÔNG mô tả: bạo lực đồ họa/máu me/gore, vũ khí được sử dụng bạo lực, cảnh giết người chi tiết, tra tấn, hành quyết; nội dung người lớn/tình dục/khỏa thân; phát ngôn thù ghét/phân biệt chủng tộc; ma túy/khủng bố/bom mìn; hình ảnh gây rối loạn tâm lý. Thay thế bằng cách mô tả điện ảnh an toàn, phù hợp khán giả chung (VD: "đối đầu căng thẳng" thay vì "cảnh đánh nhau đẫm máu").
---
## PHẦN 1: PROJECT BIBLE

**LOGLINE:** [2–3 câu: cốt truyện + cao trào + thông điệp]
**BỐI CẢNH:** [Quốc gia/thời đại, địa điểm, thời gian, thời tiết, tone màu]
**CHARACTER BIBLE** ⚠️ (tham chiếu AI tạo ảnh — bất biến):
${charBlock
  ? 'Hoàn thiện thêm chi tiết còn thiếu, giữ nguyên thông tin gốc:'
  : 'Tạo nhân vật phù hợp chủ đề (chính trước, phụ sau, tối đa 5 phụ):'}
[NHÂN VẬT CHÍNH] Tên | Giới tính | Tuổi | Quốc tịch/Sắc tộc
→ Ngoại hình: Khuôn mặt, Mắt, Tóc, Da, Vóc dáng
→ Trang phục & Phụ kiện/Vũ khí: [màu sắc, chất liệu cụ thể]
→ Tính cách & Biểu cảm đặc trưng:
[NHÂN VẬT PHỤ N] ...tương tự...
**VẬT THỂ/ĐẠO CỤ CHÍNH:** [Mô tả hình dáng, màu sắc, chất liệu]

---
## PHẦN 2: KỊCH BẢN PHÂN CẢNH — CẢNH ${fromScene} ĐẾN CẢNH ${toScene}${numChunks > 1 ? ` (PHẦN 1/${numChunks}, tổng ${numScenes} cảnh)` : ` — ĐỦ ${numScenes} CẢNH`}

${noDialogue
  ? '⚠️ QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: NGHIÊM CẤM LỜI THOẠI — tất cả cảnh im lặng hoàn toàn.'
  : `QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: Lời thoại viết THUẦN ${langLabel} — TUYỆT ĐỐI KHÔNG kèm bản dịch, phiên âm, hay chú thích ngôn ngữ khác dù là trong ngoặc đơn (...). Sau mỗi câu thoại chỉ được có dấu câu, KHÔNG có nội dung nào khác.`}
QUY TẮC: Mỗi cảnh ${sceneDuration}s. Cảnh n bắt đầu tại (n−1)×${sceneDuration}s. Số shot linh hoạt 1–5 theo nội dung (xem QUY TẮC SHOT ở trên). Mỗi shot góc máy KHÁC nhau. KHÔNG dùng bảng.
Cảnh 1 = hook mạnh.${isLast ? ` Cảnh ${numScenes} = Call To Action rõ ràng.` : ''}

${SCENE_FORMAT(langLabel, noDialogue)}

BẮT ĐẦU NGAY từ [CẢNH ${fromScene}:] — viết đủ ${toScene - fromScene + 1} cảnh liên tiếp không bỏ sót.`;
    } else {
      prompt =
`Bạn là nhà biên kịch đang tiếp tục viết kịch bản.

THÔNG TIN DỰ ÁN:
${baseInfo}

PROJECT BIBLE ĐÃ XÁC LẬP (GIỮ NGUYÊN NHÂN VẬT & BỐI CẢNH):
${projectBible}

---
NHIỆM VỤ: Tiếp tục viết CẢNH ${fromScene} ĐẾN CẢNH ${toScene} (phần ${ci + 1}/${numChunks}, tổng ${numScenes} cảnh).
Cảnh ${fromScene} bắt đầu tại ${(fromScene - 1) * sceneDuration}s.${isLast ? ` Cảnh ${numScenes} = Call To Action rõ ràng.` : ''}

${noDialogue
  ? '⚠️ QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: NGHIÊM CẤM LỜI THOẠI — tất cả cảnh im lặng hoàn toàn.'
  : `QUY TẮC LỜI THOẠI — ƯU TIÊN CAO NHẤT: Lời thoại viết THUẦN ${langLabel} — TUYỆT ĐỐI KHÔNG kèm bản dịch, phiên âm, hay chú thích ngôn ngữ khác dù là trong ngoặc đơn (...). Sau mỗi câu thoại chỉ được có dấu câu, KHÔNG có nội dung nào khác.`}
QUY TẮC: Mỗi cảnh ${sceneDuration}s. Số shot linh hoạt 1–5 theo nội dung (xem QUY TẮC SHOT ở trên). Mỗi shot góc máy KHÁC nhau. KHÔNG dùng bảng. KHÔNG lặp lại Project Bible.

${SCENE_FORMAT(langLabel, noDialogue)}

BẮT ĐẦU NGAY từ [CẢNH ${fromScene}:] — viết đủ ${toScene - fromScene + 1} cảnh liên tiếp không bỏ sót.`;
    }

    const chunk = await geminiChatRotating(apiKeys, prompt, 32768, onSwitch);
    if (!chunk) throw new Error(`Không nhận được phản hồi cho cảnh ${fromScene}–${toScene}.`);

    if (isFirst) {
      const sceneMarker = chunk.search(/\[CẢNH\s+1\s*:/);
      projectBible = sceneMarker > 0
        ? chunk.substring(0, sceneMarker).trim()
        : chunk.substring(0, Math.min(chunk.length, 2000));
      fullScript = chunk;
    } else {
      fullScript += '\n\n' + chunk;
    }

    onProgress?.({
      type: 'chunk_done',
      from: fromScene, to: toScene, total: numScenes,
      scriptSoFar: isLast
        ? fullScript
        : fullScript + `\n\n---\n⏳ *Đang tạo tiếp cảnh ${toScene + 1}–${Math.min(toScene + SCENE_CHUNK, numScenes)}/${numScenes}...*`,
    });
  }

  return fullScript;
}
