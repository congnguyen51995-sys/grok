const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

async function retryWithBackoff(fn, maxRetries = 5, initialDelay = 3000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error?.message || '';
      const isRetryable = msg.includes('429') || msg.includes('503') ||
        msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('high demand');
      if (isRetryable && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function generateCinematicPrompts(apiKey, config) {
  const systemInstruction = `Bạn là một đạo diễn điện ảnh chuyên nghiệp và người viết kịch bản cho Veo 3.1.
  Nhiệm vụ của bạn là tạo ra một kịch bản video chi tiết với sự đồng nhất tuyệt đối về nhân vật và bối cảnh.
  Bạn PHẢI trả về JSON hợp lệ theo đúng cấu trúc được mô tả.

  **NGUYÊN TẮC VÀNG: MASTER DNA (BẮT BUỘC)**
  Để giữ được sự đồng nhất tuyệt đối cho nhiều cảnh quay, bạn phải thiết lập Master DNA cho TỪNG nhân vật, bối cảnh và VẬT THỂ CHÍNH.

  **QUY TẮC ĐẶT TÊN NHÂN VẬT**: Đặt tên char_1, char_2, char_3... TUYỆT ĐỐI KHÔNG dùng tên thật.

  **QUY TẮC HÌNH ẢNH**: STYLE CONSISTENCY — tuân thủ phong cách đồ họa đã chọn. KHÔNG phụ đề/văn bản trên màn hình trong final_generated_prompt.

  **THÔNG SỐ KỸ THUẬT BẮT BUỘC**:
  - TỔNG SỐ CẢNH: Tạo ĐÚNG CHÍNH XÁC ${config.quantity} cảnh. KHÔNG ĐƯỢC LƯỢC BỚT.
  - TỐC ĐỘ: Mỗi cảnh ${config.sceneDuration} giây.
  - AI KHÔNG CÓ TRÍ NHỚ: Nhắc lại TOÀN BỘ DNA gốc trong mỗi final_generated_prompt.
  - LỌC NHÂN VẬT THEO CẢNH: Chỉ nhúng DNA nhân vật/vật thể XUẤT HIỆN trong cảnh đó.

  **CHÍNH SÁCH AN TOÀN**: Không bạo lực tàn bạo, không nội dung khiêu dâm, không bóc lột trẻ em, không mạo danh người thật.

  **CẤU TRÚC JSON BẮT BUỘC** — Trả về JSON object với cấu trúc sau:
  {
    "scenes": [
      {
        "scene_number": 1,
        "scene_specifics": {
          "camera_movement": "string — tên góc máy (ECU, CU, MS, LS, WS...)",
          "action": "string — mô tả hành động chi tiết",
          "dialogue": "string — lời thoại",
          "sound_effects": "string — hiệu ứng âm thanh",
          "location": "string — địa điểm",
          "detailed_background": "string — mô tả bối cảnh chi tiết"
        },
        "final_generated_prompt": "string — prompt tiếng Anh đầy đủ DNA cho Veo 3.1",
        "final_audio_prompt": "string — mô tả âm thanh/lời thoại",
        "character_ids": ["char_1"],
        "object_ids": [],
        "environment_id": "env_1"
      }
    ],
    "analysis": {
      "topic_content": "string — tóm tắt nội dung",
      "characters": [
        {
          "id": "char_1",
          "name": "string",
          "gender": "string",
          "age": "string",
          "fixed_features": "string — đặc điểm cố định",
          "clothing": "string — trang phục",
          "dna_prompt": "string — character sheet prompt tiếng Anh, front/side/back/3/4 view, white background"
        }
      ],
      "key_objects": [
        {
          "id": "obj_1",
          "name": "string",
          "description": "string",
          "dna_prompt": "string"
        }
      ],
      "overall_background": "string — mô tả bối cảnh tổng thể",
      "visual_style_lighting": "string — phong cách hình ảnh và ánh sáng",
      "aspect_ratio_resolution": "string — tỷ lệ khung hình",
      "master_dna": {
        "character_locks": { "char_1": "full DNA description string" },
        "object_locks": { "obj_1": "full DNA description string" },
        "environment_lock": "string — mô tả bối cảnh chính",
        "voice_lock": "string — đặc điểm giọng nói",
        "style_lock": "string — khóa phong cách"
      },
      "specs": {
        "total_duration": "string — tổng thời lượng (ví dụ: 40 giây)",
        "pacing": "string — tốc độ mỗi cảnh",
        "total_scenes": "string — số cảnh"
      },
      "rules": {
        "style": "string",
        "scene_location": "string",
        "action": "string",
        "sound": "string",
        "dialogue": "string"
      }
    }
  }

  QUAN TRỌNG: Trả về JSON hợp lệ, không có text nào bên ngoài JSON. Tạo ĐỦ ${config.quantity} cảnh.`;

  const assetDescriptions = [];
  if ((config.characters && config.characters.length > 0) || (config.environments && config.environments.length > 0)) {
    assetDescriptions.push('USER PROVIDED REFERENCE ASSETS:');
    const allAssets = [...(config.characters || []), ...(config.environments || [])];
    allAssets.forEach(asset => {
      assetDescriptions.push(`ASSET ID: ${asset.id}\nTYPE: ${asset.type}\nNAME: ${asset.name}\nDESCRIPTION: ${asset.description}`);
      // Note: Groq llama-3.3-70b-versatile doesn't support image input, so we use text description only
    });
  }

  const userContent = [
    ...assetDescriptions,
    `INPUT SCRIPT/TOPIC: ${config.subject}`,
    `REQUIRED STYLE: ${config.style}`,
    `SCENE QUANTITY: ${config.quantity} (BẮT BUỘC tạo đúng ${config.quantity} cảnh)`,
    `SCENE DURATION: ${config.sceneDuration} giây mỗi cảnh`,
    `TARGET LANGUAGE: ${config.language} (All dialogue MUST be in this language)`,
    '',
    'TASK:',
    `1. Phân tích kịch bản và tạo Master DNA cho nhân vật, bối cảnh, vật thể chính.`,
    `2. Tạo ĐÚNG ${config.quantity} cảnh — KHÔNG ĐƯỢC THIẾU CẢNH NÀO.`,
    `3. Mỗi cảnh có duration: ${config.sceneDuration}s. Nhắc lại toàn bộ DNA trong final_generated_prompt.`,
    `4. Chỉ nhúng DNA nhân vật/vật thể xuất hiện trong cảnh đó.`,
    `5. Trả về JSON hợp lệ theo đúng cấu trúc đã mô tả trong system prompt.`
  ].join('\n');

  const rawText = await retryWithBackoff(async () => {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent }
        ],
        max_tokens: 32768,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });
    if (res.status === 429 || res.status === 503) throw new Error(`${res.status} rate limit`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  });

  if (!rawText) throw new Error("AI không phản hồi. Vui lòng thử lại.");
  if (rawText.length > 150000) throw new Error("AI trả về phản hồi quá dài. Vui lòng thử lại với số cảnh ít hơn.");

  let rawData = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    rawData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    throw new Error("AI trả về định dạng không hợp lệ. Vui lòng thử lại.");
  }

  if (!rawData.scenes || !Array.isArray(rawData.scenes) || rawData.scenes.length === 0) {
    throw new Error("AI không tạo được các phân cảnh. Vui lòng thử lại với mô tả chi tiết hơn hoặc giảm số cảnh.");
  }

  const prompts = rawData.scenes.map((scene, index) => ({
    id: `scene-${index + 1}`,
    scene_id: `scene-${index + 1}`,
    title: `Cảnh ${scene.scene_number || index + 1}`,
    promptText: scene.final_generated_prompt || '',
    description: scene.scene_specifics?.action || '',
    status: 'idle',
    fullData: {
      ...scene,
      scene_number: scene.scene_number || index + 1,
      system_locks: rawData.analysis?.master_dna || {}
    }
  }));

  const dna = rawData.analysis?.master_dna || {};
  const analysis = {
    ...rawData.analysis,
    scenes: prompts,
    character_lock: {},
    environment_lock: {},
    rules: rawData.analysis?.rules || { style: config.style, scene_location: 'Tự động', action: 'Tự động', sound: 'Tự động', dialogue: 'Tự động' }
  };

  if (dna.character_locks) {
    Object.entries(dna.character_locks).forEach(([id, description]) => {
      const charInfo = rawData.analysis?.characters?.find(c => c.id === id);
      analysis.character_lock[id] = {
        id, name: charInfo?.name || id, description, type: 'character',
        reference_sheet_prompt: charInfo?.dna_prompt
      };
    });
  }

  if (Object.keys(analysis.environment_lock).length === 0 && dna.environment_lock) {
    analysis.environment_lock['main-env'] = { id: 'main-env', name: 'Bối cảnh chính', description: dna.environment_lock, type: 'environment' };
  }

  if (config.characters?.length > 0) {
    config.characters.forEach(char => {
      if (!analysis.character_lock[char.id]) analysis.character_lock[char.id] = char;
    });
  }
  if (config.environments?.length > 0) {
    config.environments.forEach(env => {
      if (!analysis.environment_lock[env.id]) analysis.environment_lock[env.id] = env;
    });
  }

  analysis.master_prompts = {
    characters: Object.entries(dna.character_locks || {}).map(([id, prompt]) => ({ id: `Character DNA: ${id}`, prompt })),
    environments: [{ id: 'Environment DNA', prompt: dna.environment_lock || '' }]
  };

  return { prompts, analysis };
}
