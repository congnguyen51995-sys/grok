/**
 * Eyes Challenge Generator — dùng geminiStreamWithRotation chung của app
 * (cùng cơ chế xoay key, backoff, timeout 2 phút như AI Agent)
 */
import { geminiStreamWithRotation } from './aiAgent';

// Schema JSON trả về — nhúng trực tiếp vào cả system lẫn user prompt để model ko nhầm
const JSON_SCHEMA = `{
  "objects": [
    {
      "name": "tên tiếng Việt",
      "englishName": "tên tiếng Anh",
      "imagenPrompt": "isolated [object name] on pure white background, centered, full body visible with padding, product photography style, high detail"
    }
  ],
  "scenePrompt": "flat lay product photo of [all objects] arranged neatly side by side on pure white background, centered, full items visible, high detail, no shadows, product photography",
  "challengeText": "Câu hỏi thử thách ≤60 ký tự",
  "revealText": "Câu tiết lộ đáp án ngắn",
  "ctaText": "Kêu gọi like/follow ≤60 ký tự",
  "outlineColor": "red",
  "voiceScript": {
    "intro": "Lời mở đầu TTS 1-2 câu tự nhiên",
    "countdown": "Ba... Hai... Một...",
    "reveal": "Lời tiết lộ đáp án + khen ngợi ngắn",
    "cta": "Kêu gọi follow và like"
  }
}`;

const JSON_SCHEMA_EN = `{
  "objects": [
    {
      "name": "Vietnamese name",
      "englishName": "English name",
      "imagenPrompt": "isolated [object name] on pure white background, centered, full body visible with padding, product photography style, high detail"
    }
  ],
  "scenePrompt": "flat lay product photo of [all objects] arranged neatly side by side on pure white background, centered, full items visible, high detail, no shadows, product photography",
  "challengeText": "Challenge question ≤60 chars",
  "revealText": "Reveal answer text, short",
  "ctaText": "Call-to-action like/follow ≤60 chars",
  "outlineColor": "blue",
  "voiceScript": {
    "intro": "Natural intro TTS 1-2 sentences",
    "countdown": "Three... Two... One...",
    "reveal": "Reveal answer + short praise",
    "cta": "Call to follow and like"
  }
}`;

const SYSTEM_PROMPT_VI = `Bạn là AI tạo nội dung viral Eyes Challenge cho Facebook Reels / TikTok.
Format video: 9:16 dọc, ~28 giây. Hiển thị 2-4 đồ vật thật (ảnh trên nền trắng) ở trên, bóng silhouette xáo trộn ở dưới, người xem đoán ghép bóng với vật.

QUY TẮC chọn đồ vật:
- Hình dạng bóng đổ PHẢI KHÁC NHAU rõ ràng (gà ≠ vịt ≠ thằn lằn)
- MIX DANH MỤC: gà + Fanta + táo + thằn lằn = viral hơn toàn bộ động vật
- Gợi ý: động vật (gà, vịt, sư tử, cá sấu, rắn, cú, voi), thức ăn (chuối, dứa, kem, pizza), đồ uống (Fanta, Coca), đồ vật (giày, mũ bảo hiểm, chìa khóa)

imagenPrompt: Mô tả bằng tiếng Anh để Imagen tạo ảnh ĐỐI TƯỢNG ĐỘC LẬP trên NỀN TRẮNG THUẦN KHIẾT, toàn thân rõ ràng, có khoảng trắng xung quanh (padding), đủ để vừa trong khung 9:16.

Trả về JSON thuần túy (bắt đầu { kết thúc }):`;

const SYSTEM_PROMPT_EN = `You are an AI creating viral Eyes Challenge content for Facebook Reels / TikTok.
Video format: 9:16 portrait, ~28 seconds. Display 2-4 real objects (photos on white background) on top, scrambled silhouette shadows below, viewers match shadows to objects.

RULES for selecting objects:
- Shadow shapes MUST be clearly DIFFERENT (chicken ≠ duck ≠ lizard)
- MIX CATEGORIES: chicken + Fanta + apple + lizard = more viral than all animals
- Suggestions: animals (chicken, duck, lion, crocodile, snake, owl, elephant), food (banana, pineapple, ice cream, pizza), drinks (Fanta, Coca-Cola), objects (shoe, helmet, key)

imagenPrompt: Describe in English for Imagen to generate ISOLATED OBJECT on PURE WHITE BACKGROUND, full body visible, with padding around it, sized to fit neatly in 9:16 frame.

Return pure JSON only (starts { ends }):`;

/**
 * Tạo kế hoạch Eyes Challenge qua Gemini
 */
export async function generateEyesChallenge({ topic = '', count = 4, apiKeys = [], model = 'gemini-3.5-flash', lang = 'vi', onStatus }) {
  if (!apiKeys?.length) throw new Error('Chưa có Gemini API key — vào Cài đặt thêm key');
  onStatus?.('Đang hỏi Gemini lên ý tưởng...');

  const isVI = lang !== 'en';
  const systemPrompt = isVI ? SYSTEM_PROMPT_VI : SYSTEM_PROMPT_EN;
  const schema = isVI ? JSON_SCHEMA : JSON_SCHEMA_EN;

  const topicLine = topic
    ? (isVI ? `Chủ đề: ${topic}` : `Theme: ${topic}`)
    : (isVI ? 'Chủ đề: tự chọn (mix thú vị, viral nhất)' : 'Theme: choose freely (most viral mix)');

  // Nhúng JSON schema vào user message — model phải điền vào đúng schema này
  const userPrompt = isVI
    ? `${topicLine}\nSố đồ vật: ${count}\n\nĐiền vào JSON sau và chỉ trả về JSON đó (không có gì khác):\n${schema}`
    : `${topicLine}\nObject count: ${count}\n\nFill in the following JSON and return ONLY that JSON (nothing else):\n${schema}`;

  // config: { responseMimeType: 'application/json' } bắt buộc model trả JSON
  // SDK @google/genai v1.x dùng field "config" thay vì "generationConfig"
  const raw = await geminiStreamWithRotation(apiKeys, model, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: { responseMimeType: 'application/json' },
  });

  let plan;
  try {
    // strip markdown fence nếu model vẫn bọc
    let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    if (!cleaned.startsWith('{')) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
      else throw new Error('Không tìm thấy JSON trong response');
    }
    plan = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Gemini trả về text thay vì JSON. Thử lại hoặc đổi model.\nPreview: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(plan.objects) || plan.objects.length < 2) {
    throw new Error('Plan thiếu objects (cần ≥2): ' + JSON.stringify(plan).slice(0, 200));
  }

  // Ghép thứ tự bóng xáo trộn
  const n = plan.objects.length;
  const shuffled = Array.from({ length: n }, (_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  plan.shadowRevealOrder = shuffled;
  plan.lang = lang;

  onStatus?.('✅ Gemini xong!');
  return plan;
}
