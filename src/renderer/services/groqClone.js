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

async function groqFetch(apiKey, messages, maxTokens = 4096) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.7 })
  });
  if (res.status === 429 || res.status === 503) {
    throw new Error(`${res.status} rate limit`);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function analyzeAndCloneScript(apiKey, input, mode, channelTopic, newTopic) {
  const systemInstruction = `
    🧬 Câu Lệnh Khai Thác & Tái Tạo Kịch Bản (Clone & Spin Prompt)
    Đóng vai một Chuyên gia phân tích nội dung, Đạo diễn kịch bản và Bậc thầy Copywriter chuyên trị các nền tảng YouTube và TikTok.

    Mục tiêu: Khai thác công thức thành công của video và tạo ra một kịch bản mới.
    Kênh của người dùng tập trung vào: ${channelTopic || 'Chưa xác định'}.

    Dựa vào dữ liệu đầu vào (URL video hoặc mô tả), hãy thực hiện MỘT trong các CHẾ ĐỘ XỬ LÝ sau đây:

    [Chế độ 1] Bóc tách kịch bản gốc 100%: Trích xuất toàn bộ nội dung video gốc và trình bày lại dưới dạng kịch bản phân cảnh (Visual/Audio). Không thay đổi nội dung, chỉ sắp xếp lại cho chuyên nghiệp.

    [Chế độ 2] Tóm tắt & Rút trích công thức: Tóm tắt video thành 5 gạch đầu dòng cốt lõi nhất. Phân tích "Công thức Viral" (Hook, cấu trúc nhịp độ, lý do giữ chân người xem).

    [Chế độ 3] Viết lại y hệt chủ đề (Không đạo văn): Giữ nguyên chủ đề và thông điệp, nhưng viết lại hoàn toàn 100% lời thoại và hình ảnh. Zero Plagiarism, giữ độ cuốn hút tương đương.

    [Chế độ 4] Clone cấu trúc - Đổi chủ đề: Mượn bộ khung, nhịp điệu và cách kể chuyện của video gốc, áp dụng cho chủ đề hoàn toàn mới là: ${newTopic}.

    [Chế độ 5] Trích xuất lời thoại & Timestamps: Lấy toàn bộ lời thoại kèm mốc thời gian. Định dạng SRT chuẩn.

    [Chế độ 6] Tái tạo video với Veo 3.1 (YouTube Remake): Bóc tách video và tạo kịch bản tái tạo chuyên nghiệp, JSON từng cảnh 8 giây, chất lượng Cinematic 4K.

    YÊU CẦU TRÌNH BÀY ĐẦU RA (Chế độ 1, 3, 4):
    KHÔNG SỬ DỤNG BẢNG. Dùng cấu trúc khối văn bản tuyến tính:

    [CẢNH X: 0:00 - 0:00] - [Tên phân cảnh]
    🎥 HÌNH ẢNH (Visual): [Mô tả chi tiết góc máy, hành động, bối cảnh]
    🎤 LỜI THOẠI (Audio): [Tên nhân vật]: "Lời thoại chi tiết"
    🎵 ÂM THANH & HIỆU ỨNG (SFX/BGM): [Mô tả nhạc nền, hiệu ứng]

    YÊU CẦU TRÌNH BÀY ĐẦU RA (Chế độ 5): Định dạng SRT chuẩn.

    YÊU CẦU TRÌNH BÀY ĐẦU RA (Chế độ 6): Mỗi cảnh là 1 dòng JSON riêng biệt với đầy đủ thông tin.

    (Chỉ trả về kết quả của chế độ đã chọn, tuân thủ nghiêm ngặt định dạng trên bằng tiếng Việt).
  `;

  let userContent = '';
  if (typeof input === 'string') {
    userContent = `Phân tích video tại URL sau: ${input}`;
  } else {
    // Groq doesn't support video file analysis — work with filename/type
    userContent = `Tệp video được tải lên (định dạng: ${input.mimeType}). Do giới hạn kỹ thuật, hãy tạo kịch bản mẫu chuyên nghiệp phù hợp với chế độ được yêu cầu.`;
  }

  userContent += `\n\nChế độ xử lý: ${mode}${mode === 4 ? `\nChủ đề mới: ${newTopic}` : ''}\nTrả về kết quả theo định dạng yêu cầu.`;

  return await retryWithBackoff(() =>
    groqFetch(apiKey, [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent }
    ], mode === 6 ? 8192 : 4096)
  );
}
