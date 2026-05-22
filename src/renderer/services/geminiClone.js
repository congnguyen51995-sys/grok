import { GoogleGenAI } from "@google/genai";
import { retryWithKeyRotation } from './keyRotation.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Core Gemini call ─────────────────────────────────────────────────────────
async function geminiGenerate(apiKeys, systemInstruction, contentParts, maxTokens, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    let response;
    try {
      response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: 'user', parts: contentParts }],
        config: {
          systemInstruction: systemInstruction || undefined,
          maxOutputTokens: maxTokens,
          thinkingConfig: { thinkingBudget: 0 },
        }
      });
    } catch (err) {
      const msg = err?.message || String(err);
      // Gemini không thể truy cập video YouTube (trả về HTML thay vì video stream)
      if (msg.includes('text/html') || msg.includes('Unsupported MIME type')) {
        throw new Error(
          '❌ Gemini không thể truy cập video YouTube này.\n' +
          'Nguyên nhân có thể: video bị giới hạn vùng, yêu cầu đăng nhập, hoặc YouTube chặn Gemini.\n' +
          '👉 Giải pháp: Tải video về máy → dùng nút "Tải lên" thay vì nhập URL.'
        );
      }
      throw err;
    }
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') throw new Error('Nội dung bị chặn do chính sách an toàn.');
    let text = response?.text || '';
    if (!text && candidate?.content?.parts) text = candidate.content.parts.filter(p => p.text).map(p => p.text).join('');
    if (!text) throw new Error('AI trả về rỗng. Vui lòng thử lại.');
    return text;
  }, apiKeys, { onSwitch });
}

// ─── Normalize YouTube URL ────────────────────────────────────────────────────
// Gemini chỉ nhận: https://www.youtube.com/watch?v=VIDEO_ID (không có params thừa)
function normalizeYouTubeUrl(url) {
  let videoId = null;

  // youtube.com/shorts/VIDEO_ID
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) videoId = shortsMatch[1];

  // youtu.be/VIDEO_ID
  if (!videoId) {
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (shortMatch) videoId = shortMatch[1];
  }

  // youtube.com/watch?v=VIDEO_ID (có thể kèm &t=... &list=... v.v.)
  if (!videoId) {
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (watchMatch) videoId = watchMatch[1];
  }

  // Trả về URL sạch — chỉ video ID, bỏ toàn bộ params thừa (&t=, &list=, &index=...)
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

  return url;
}

// ─── Build video content part ─────────────────────────────────────────────────
function buildVideoContentPart(input) {
  if (typeof input === 'string') {
    // Gemini File API URI (from ai.files.upload)
    if (input.startsWith('https://generativelanguage.googleapis.com')) {
      return [{ fileData: { fileUri: input } }];
    }
    const isYouTube = input.includes('youtube.com') || input.includes('youtu.be');
    if (isYouTube) {
      const normalizedUri = normalizeYouTubeUrl(input);
      return [{ fileData: { fileUri: normalizedUri } }];
    }
    return [{ text: `Video URL (non-YouTube, không thể phân tích trực tiếp): ${input}\nHãy thông báo người dùng dùng chế độ Tải lên thay vì URL này.` }];
  }
  // { data: base64, mimeType } — inline for small files
  return [{ inlineData: { data: input.data, mimeType: input.mimeType } }];
}

// ─── Upload video to Gemini File API ─────────────────────────────────────────
// Dùng cho file video lớn (>20MB) hoặc khi muốn tái sử dụng file URI
// Returns: { uri, name } — uri có thể dùng trong fileData.fileUri
export async function uploadVideoToGemini(apiKeys, file, onProgress) {
  if (!apiKeys?.length) throw new Error('Chưa có API Key Gemini.');

  // Thử từng key — dừng khi upload thành công
  let lastErr;
  for (const key of apiKeys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });

      onProgress?.('⬆️ Đang upload video lên Gemini File API...');

      // Gemini SDK browser: ai.files.upload nhận Blob/File
      const uploadedFile = await ai.files.upload({
        file,
        config: {
          mimeType: file.type || 'video/mp4',
          displayName: file.name || 'uploaded_video.mp4',
        },
      });

      onProgress?.('⏳ Chờ Gemini xử lý file...');

      // Poll cho đến khi ACTIVE
      let fileInfo = uploadedFile;
      let attempts = 0;
      while (fileInfo.state === 'PROCESSING' && attempts < 60) {
        await sleep(5000);
        fileInfo = await ai.files.get({ name: fileInfo.name });
        attempts++;
        onProgress?.(`⏳ Xử lý file... (${attempts * 5}s)`);
      }

      if (fileInfo.state === 'FAILED') {
        throw new Error('Gemini báo lỗi khi xử lý file. Hãy thử lại với file khác.');
      }
      if (fileInfo.state !== 'ACTIVE') {
        throw new Error(`File upload timeout (state: ${fileInfo.state}). Hãy thử lại.`);
      }

      onProgress?.(`✅ Upload thành công — ${fileInfo.name}`);
      return { uri: fileInfo.uri, name: fileInfo.name };

    } catch (err) {
      lastErr = err;
      // Nếu lỗi key quota → thử key tiếp theo; nếu lỗi khác → throw luôn
      if (err?.message?.includes('quota') || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.status === 429) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Upload thất bại với tất cả API keys.');
}

// ─── Pha 1: Quét cấu trúc tổng thể video (output nhỏ, nhanh) ─────────────────
// Mục tiêu: biết tổng thời lượng + danh sách đoạn 90-120s để chia nhỏ pha 2
async function getVideoStructure(apiKeys, input, onSwitch) {
  const videoParts = buildVideoContentPart(input);

  const prompt = `Xem toàn bộ video này và phân tích cấu trúc. Trả về JSON (chỉ JSON, không markdown, không giải thích):
{
  "total_duration_sec": 330,
  "language": "vi",
  "main_topic": "Chủ đề chính của video",
  "style": "Phong cách kể chuyện (hài hước / nghiêm túc / giáo dục / v.v.)",
  "segments": [
    {"idx": 1, "from_sec": 0,   "to_sec": 90,  "from": "0:00", "to": "1:30", "title": "Tên đoạn", "summary": "Mô tả ngắn nội dung đoạn này"},
    {"idx": 2, "from_sec": 90,  "to_sec": 210, "from": "1:30", "to": "3:30", "title": "Tên đoạn", "summary": "..."},
    {"idx": 3, "from_sec": 210, "to_sec": 330, "from": "3:30", "to": "5:30", "title": "Tên đoạn", "summary": "..."}
  ]
}

QUY TẮC chia đoạn:
- Mỗi đoạn dài 90-120 giây (ưu tiên cắt tại điểm nghỉ tự nhiên như chuyển cảnh, kết câu)
- Bao phủ TOÀN BỘ thời lượng từ 0 đến hết video — không được bỏ sót giây nào
- Đoạn cuối kết thúc đúng bằng total_duration_sec
- Trả về JSON hợp lệ duy nhất`;

  const raw = await geminiGenerate(apiKeys, null, [...videoParts, { text: prompt }], 3072, onSwitch);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Không đọc được cấu trúc video (AI không trả về JSON hợp lệ).');

  const structure = JSON.parse(jsonMatch[0]);
  if (!structure.segments?.length) throw new Error('AI không xác định được các đoạn video.');

  // Đảm bảo segments có đủ trường
  structure.segments = structure.segments.map((s, i) => ({
    idx: i + 1,
    from_sec: typeof s.from_sec === 'number' ? s.from_sec : 0,
    to_sec:   typeof s.to_sec   === 'number' ? s.to_sec   : structure.total_duration_sec,
    from:     s.from  || '0:00',
    to:       s.to    || '0:00',
    title:    s.title   || `Phần ${i + 1}`,
    summary:  s.summary || '',
  }));

  return structure;
}

// ─── Map mã ngôn ngữ → tên đầy đủ (dùng trong Mode 6) ───────────────────────
const LANG_FULL = {
  vi: 'Vietnamese', en: 'English', ja: 'Japanese', zh: 'Chinese',
  ko: 'Korean', fr: 'French', es: 'Spanish', de: 'German', th: 'Thai',
  'zh-CN': 'Chinese', 'zh-TW': 'Chinese', 'pt': 'Portuguese', 'ar': 'Arabic',
};

// ─── Pha 2: Phân tích chi tiết 1 đoạn theo chế độ ────────────────────────────
async function analyzeSegment(apiKeys, input, seg, totalSegs, mode, channelTopic, newTopic, structure, onSwitch, stylePrompt = null, targetLang = null) {
  const videoParts = buildVideoContentPart(input);

  const modeInstructions = {
    1: `Bóc tách 100% nội dung đoạn này thành kịch bản phân cảnh. Mỗi cảnh dùng format:
[CẢNH X: ${seg.from} - ${seg.to}] - [Tên phân cảnh]
🎥 HÌNH ẢNH (Visual): [Mô tả chi tiết góc máy, hành động, bối cảnh]
🎤 LỜI THOẠI (Audio): [Tên nhân vật]: "Lời thoại đầy đủ, từng từ"
🎵 ÂM THANH & HIỆU ỨNG (SFX/BGM): [Nhạc nền, hiệu ứng âm thanh]`,

    2: `Phân tích đoạn này:
- Hook / điểm thu hút đầu đoạn là gì?
- Cấu trúc nhịp độ (dồn dập / chậm rãi / v.v.)
- Kỹ thuật giữ chân người xem trong đoạn này
- Điểm nổi bật / viral nhất của đoạn`,

    3: `Viết lại TOÀN BỘ nội dung đoạn này. Giữ nguyên chủ đề và thông điệp, nhưng thay đổi 100% lời thoại và hình ảnh (Zero Plagiarism). Dùng format phân cảnh:
[CẢNH X: ${seg.from} - ${seg.to}] - [Tên phân cảnh]
🎥 HÌNH ẢNH (Visual): [...]
🎤 LỜI THOẠI (Audio): [...]
🎵 ÂM THANH (SFX/BGM): [...]`,

    4: `Áp dụng cấu trúc và nhịp điệu của đoạn này cho chủ đề MỚI: "${newTopic}". Giữ nguyên bộ khung, đổi hoàn toàn nội dung. Format phân cảnh:
[CẢNH X: ${seg.from} - ${seg.to}] - [Tên phân cảnh]
🎥 HÌNH ẢNH (Visual): [...]
🎤 LỜI THOẠI (Audio): [...]
🎵 ÂM THANH (SFX/BGM): [...]`,

    5: `Trích xuất TOÀN BỘ lời thoại trong đoạn này theo định dạng SRT chuẩn với timestamps chính xác.
Timestamp bắt đầu từ ${seg.from} (không phải từ 00:00:00,000). Mỗi entry:
[số thứ tự]
HH:MM:SS,mmm --> HH:MM:SS,mmm
[lời thoại]`,

    6: (() => {
      const startId = Math.round(seg.from_sec / 8) + 1;
      const count   = Math.round((seg.to_sec - seg.from_sec) / 8);
      const ids     = Array.from({ length: count }, (_, i) => startId + i);
      const visualStyle = stylePrompt
        ? stylePrompt
        : `${structure.style || 'CINEMATIC'}, cinematic 4K quality`;
      // Ngôn ngữ dialogue: LUÔN dùng targetLang (nếu có), fallback sang ngôn ngữ gốc
      const dialogueLang     = targetLang || structure.language || 'en';
      const dialogueLangFull = LANG_FULL[dialogueLang] || dialogueLang.toUpperCase();
      // Lệnh ngôn ngữ: BẮT BUỘC cho MỌI trường hợp
      const langBanner = `
╔══════════════════════════════════════════════════╗
║  🌐 NGÔN NGỮ THOẠI BẮT BUỘC: ${dialogueLangFull.toUpperCase().padEnd(18)} ║
║  TOÀN BỘ nội dung "lines" PHẢI bằng ${dialogueLangFull.toUpperCase().padEnd(11)} ║
║  TUYỆT ĐỐI KHÔNG dùng ngôn ngữ khác             ║
╚══════════════════════════════════════════════════╝`;
      return `${langBanner}

Tái tạo đoạn ${seg.from}–${seg.to} thành ${count} cảnh JSON cho Veo 3.1.

🌐 NHẮC LẠI — NGÔN NGỮ THOẠI: "${dialogueLangFull.toUpperCase()}" — KHÔNG dùng ngôn ngữ nào khác trong trường "lines".

⚠️ BẮT BUỘC xuất ĐÚNG ${count} dòng JSON, KHÔNG BỎ SÓT CẢNH NÀO.
Danh sách scene_id PHẢI có đủ: ${ids.join(', ')}

🎨 PHONG CÁCH HÌNH ẢNH — BẮT BUỘC:
"${visualStyle}"
→ Trường "visual_style" PHẢI chứa CHÍNH XÁC chuỗi trên trong MỌI cảnh.

Mỗi cảnh = 1 dòng JSON độc lập (không array, không markdown, không giải thích).
Format:
{"scene_id":"X","duration_sec":8,"title":"...","visual_style":"${visualStyle}","character_lock":{"CHAR_ID":{"id":"CHAR_ID","name":"...","description":"..."}},"background":{"setting":"...","lighting":"...","atmosphere":"..."},"camera":{"composition":"...","position_and_angle":"...","movement":"...","focus_and_lens":"..."},"audio":{"dialogue":{"lines":["[${dialogueLangFull.toUpperCase()} ONLY]"],"language":"${dialogueLang}"},"sfx":["..."],"ambient_noise":"..."},"action_description":"...","prompt":"..."}

🌐 NHẮC LẦN CUỐI: "lines" = ${dialogueLangFull.toUpperCase()} ONLY. Bất kỳ từ nào không phải ${dialogueLangFull} đều sai.
Xuất lần lượt từ scene_id ${ids[0]} đến scene_id ${ids[ids.length - 1]}, KHÔNG dừng giữa chừng.`;
    })()
  };

  const prompt = `THÔNG TIN VIDEO:
- Tổng thời lượng: ${structure.total_duration_sec}s (${Math.floor(structure.total_duration_sec / 60)}p${Math.floor(structure.total_duration_sec % 60)}s)
- Chủ đề: ${structure.main_topic}
- Phong cách: ${structure.style}
- Ngôn ngữ gốc: ${structure.language || 'vi'}
- Kênh người dùng: ${channelTopic || 'Chưa xác định'}

PHẠM VI PHÂN TÍCH: Đoạn ${seg.idx}/${totalSegs} — từ ${seg.from} đến ${seg.to}
Nội dung đoạn này: "${seg.title}" — ${seg.summary}

CHẾ ĐỘ ${mode}:
${modeInstructions[mode] || modeInstructions[1]}

YÊU CẦU BẮT BUỘC:
1. Phân tích TOÀN BỘ nội dung trong khoảng ${seg.from}–${seg.to}, không bỏ sót câu hoặc cảnh nào
2. Timestamp/thời gian phải bắt đầu từ ${seg.from}, không phải từ 0:00
3. Bao phủ từ ${seg.from} đến đúng ${seg.to} — không dừng sớm hơn
${mode === 6 ? `4. PHẢI xuất đủ ${Math.round((seg.to_sec - seg.from_sec) / 8)} dòng JSON — từ scene_id ${Math.round(seg.from_sec / 8) + 1} đến ${Math.round(seg.to_sec / 8)} — KHÔNG được dừng trước khi hết danh sách.` : ''}`;

  return await geminiGenerate(
    apiKeys, null,
    [...videoParts, { text: prompt }],
    mode === 6 ? Math.max(16384, Math.round((seg.to_sec - seg.from_sec) / 8) * 900) : 6144,
    onSwitch
  );
}

// ─── Pha 3: Tổng hợp kết quả Mode 2 (cần merge thông minh) ───────────────────
async function synthesizeMode2(apiKeys, results, structure, channelTopic, onSwitch) {
  const allAnalyses = results.map(r =>
    `ĐOẠN ${r.segment.idx} (${r.segment.from}–${r.segment.to}) — "${r.segment.title}":\n${r.content}`
  ).join('\n\n---\n\n');

  const prompt = `Dưới đây là phân tích từng phần của video "${structure.main_topic}" (tổng ${Math.floor(structure.total_duration_sec / 60)}p${Math.floor(structure.total_duration_sec % 60)}s):

${allAnalyses.substring(0, 12000)}

Tổng hợp toàn bộ thành báo cáo hoàn chỉnh:

## 📌 5 Điểm Cốt Lõi Của Video
[5 gạch đầu dòng quan trọng nhất]

## 🧬 Công Thức Viral Đã Giải Mã
- **Hook (0-30s):** [Họ thu hút người xem bằng cách nào?]
- **Cấu trúc nhịp độ:** [Xây dựng và duy trì tension ra sao?]
- **Kỹ thuật giữ chân:** [Pattern nào lặp đi lặp lại?]
- **Payoff & CTA:** [Kết thúc và kêu gọi hành động thế nào?]

## 💡 Bài Học Áp Dụng Cho Kênh "${channelTopic || 'của bạn'}"
[3-5 điểm cụ thể, thực tế có thể làm ngay]`;

  return await geminiGenerate(apiKeys, null, [{ text: prompt }], 4096, onSwitch);
}

// ─── Mode 6: Parse JSON lines từ raw text ────────────────────────────────────
function parseMode6Scenes(rawText) {
  const map = new Map();
  for (const line of rawText.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const obj = JSON.parse(t);
      const id = parseInt(obj.scene_id);
      if (!isNaN(id) && id > 0) map.set(id, t);
    } catch {}
  }
  return map;
}

// ─── Mode 6: Bổ sung cảnh thiếu sau mỗi segment ──────────────────────────────
async function fillMissingMode6Scenes(apiKeys, input, seg, structure, rawContent, onProgress, onSwitch, stylePrompt = null, targetLang = null) {
  const startId = Math.round(seg.from_sec / 8) + 1;
  const endId   = Math.round(seg.to_sec   / 8);
  const sceneMap = parseMode6Scenes(rawContent);

  // Tìm scene_id thiếu
  const missing = [];
  for (let id = startId; id <= endId; id++) {
    if (!sceneMap.has(id)) missing.push(id);
  }
  if (missing.length === 0) {
    // Tất cả có đủ — sort và trả về
    return Array.from({ length: endId - startId + 1 }, (_, i) => sceneMap.get(startId + i)).filter(Boolean).join('\n');
  }

  onProgress?.({ phase: 'fill_missing', message: `  🔧 Bổ sung ${missing.length} cảnh thiếu (scene ${missing.join(', ')})...` });

  const videoParts = buildVideoContentPart(input);
  const fillVisualStyle = stylePrompt
    ? stylePrompt
    : `${structure.style || 'CINEMATIC'}, cinematic 4K quality`;
  const fillDialogueLang     = targetLang || structure.language || 'en';
  const fillDialogueLangFull = LANG_FULL[fillDialogueLang] || fillDialogueLang.toUpperCase();
  const fillPrompt = `🌐 NGÔN NGỮ BẮT BUỘC: "${fillDialogueLangFull.toUpperCase()}" — TOÀN BỘ "lines" PHẢI bằng ${fillDialogueLangFull.toUpperCase()}, TUYỆT ĐỐI không dùng ngôn ngữ khác.

Video đoạn ${seg.from}–${seg.to}. Tạo ĐÚNG ${missing.length} cảnh JSON CÒN THIẾU.
Scene_id cần tạo: ${missing.join(', ')}

🎨 visual_style BẮT BUỘC: "${fillVisualStyle}"

Xuất đúng ${missing.length} dòng JSON (scene_id: ${missing.join(', ')}):
{"scene_id":"X","duration_sec":8,"title":"...","visual_style":"${fillVisualStyle}","character_lock":{},"background":{"setting":"...","lighting":"...","atmosphere":"..."},"camera":{"composition":"...","position_and_angle":"...","movement":"...","focus_and_lens":"..."},"audio":{"dialogue":{"lines":["[${fillDialogueLangFull.toUpperCase()} ONLY]"],"language":"${fillDialogueLang}"},"sfx":["..."],"ambient_noise":"..."},"action_description":"...","prompt":"..."}

🌐 NHẮC LẠI: lines = ${fillDialogueLangFull.toUpperCase()} ONLY.
⚠️ Chỉ JSON, không giải thích, không markdown.`;

  try {
    const raw = await geminiGenerate(apiKeys, null, [...videoParts, { text: fillPrompt }],
      Math.max(4096, missing.length * 1200), onSwitch);
    const newMap = parseMode6Scenes(raw);
    for (const [id, line] of newMap) {
      if (missing.includes(id)) sceneMap.set(id, line);
    }
  } catch { /* nếu fill lỗi thì bỏ qua, dùng những gì đã có */ }

  // Trả về sorted theo scene_id
  return Array.from({ length: endId - startId + 1 }, (_, i) => sceneMap.get(startId + i)).filter(Boolean).join('\n');
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function analyzeAndCloneScript(apiKeys, input, mode, channelTopic, newTopic, onSwitch, onProgress, stylePrompt = null, targetLang = null) {

  // ══ Pha 1: Quét cấu trúc video ══════════════════════════════════════════════
  onProgress?.({ phase: 'structure', done: 0, total: 0, message: '🔍 Pha 1/3: Đang quét cấu trúc tổng thể video...' });

  let structure;
  try {
    structure = await getVideoStructure(apiKeys, input, onSwitch);
  } catch (e) {
    // Nếu Gemini không truy cập được YouTube → throw ngay, không fallback vô ích
    if (e.message.includes('Gemini không thể truy cập') || e.message.includes('text/html') || e.message.includes('Unsupported MIME type')) {
      throw e;
    }
    // Fallback: đơn giản hóa nếu quét cấu trúc lỗi (video rất ngắn hoặc URL không hợp lệ)
    onProgress?.({ phase: 'fallback', done: 0, total: 1, message: `⚠️ Quét cấu trúc lỗi (${e.message.slice(0, 80)}), chuyển sang xử lý đơn...` });
    return singlePassFallback(apiKeys, input, mode, channelTopic, newTopic, onSwitch, stylePrompt, targetLang);
  }

  const { segments } = structure;
  const durMin = Math.floor(structure.total_duration_sec / 60);
  const durSec = Math.floor(structure.total_duration_sec % 60);

  onProgress?.({
    phase: 'start',
    done: 0,
    total: segments.length,
    message: `✅ Pha 1 xong: ${durMin}p${durSec}s → ${segments.length} đoạn | Bắt đầu Pha 2...`,
    structure
  });

  // ══ Pha 2: Phân tích chi tiết từng đoạn ═════════════════════════════════════
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    onProgress?.({
      phase: 'analyzing',
      done: i,
      total: segments.length,
      message: `🎬 Pha 2/3: Đoạn ${i + 1}/${segments.length} — ${seg.from}–${seg.to} "${seg.title}"`,
      currentSeg: seg
    });

    try {
      let detail = await analyzeSegment(
        apiKeys, input, seg, segments.length,
        mode, channelTopic, newTopic, structure, onSwitch, stylePrompt, targetLang
      );

      // Mode 6: kiểm tra và bổ sung cảnh thiếu ngay sau mỗi segment
      if (mode === 6) {
        detail = await fillMissingMode6Scenes(apiKeys, input, seg, structure, detail, onProgress, onSwitch, stylePrompt, targetLang);
      }

      results.push({ segment: seg, content: detail });
      onProgress?.({
        phase: 'segment_done',
        done: i + 1,
        total: segments.length,
        message: `  ✅ Đoạn ${i + 1}/${segments.length} xong`,
        currentSeg: seg
      });
    } catch (e) {
      // Đoạn lỗi → ghi chú nhưng không dừng toàn bộ
      results.push({ segment: seg, content: `[Đoạn ${seg.from}–${seg.to}: Lỗi phân tích — ${e.message}]` });
      onProgress?.({
        phase: 'segment_error',
        done: i + 1,
        total: segments.length,
        message: `  ⚠️ Đoạn ${i + 1} lỗi: ${e.message.slice(0, 60)}`,
        currentSeg: seg
      });
    }

    // Nghỉ nhỏ giữa các đoạn để tránh rate limit
    if (i < segments.length - 1) await sleep(400);
  }

  // ══ Pha 3: Ghép kết quả ════════════════════════════════════════════════════
  onProgress?.({ phase: 'assembling', done: segments.length, total: segments.length, message: '🔧 Pha 3/3: Đang tổng hợp kết quả...' });

  let finalOutput = '';

  if (mode === 2) {
    // Mode 2 cần merge thông minh — gọi thêm 1 lần Gemini để tổng hợp
    finalOutput = await synthesizeMode2(apiKeys, results, structure, channelTopic, onSwitch);

  } else if (mode === 6) {
    // Mode 6: gom tất cả scenes, sort theo scene_id, loại trùng
    const allScenes = new Map();
    for (const r of results) {
      for (const [id, line] of parseMode6Scenes(r.content)) {
        allScenes.set(id, line);
      }
    }
    const totalExpected = results.reduce((acc, r) => acc + Math.round((r.segment.to_sec - r.segment.from_sec) / 8), 0);
    const sortedLines = [...allScenes.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    finalOutput = sortedLines.join('\n');

  } else {
    // Modes 1,3,4,5: ghép có header phân đoạn
    const divider = '━'.repeat(58);
    finalOutput = results.map((r, i) => {
      const partHeader = `${divider}\n📍 PHẦN ${i + 1}/${results.length}: ${r.segment.from} – ${r.segment.to}  |  ${r.segment.title}\n${divider}`;
      return `${partHeader}\n\n${r.content.trim()}`;
    }).join('\n\n');
  }

  onProgress?.({ phase: 'done', done: segments.length, total: segments.length, message: `🎉 Hoàn tất! ${segments.length} đoạn · ${durMin}p${durSec}s được phân tích đầy đủ.` });

  return finalOutput;
}

// ─── Fallback: gửi 1 lần (video ngắn / cấu trúc lỗi) ────────────────────────
async function singlePassFallback(apiKeys, input, mode, channelTopic, newTopic, onSwitch, stylePrompt = null, targetLang = null) {
  const videoParts = buildVideoContentPart(input);

  const systemInstruction = `
🧬 Bóc Tách & Tái Tạo Kịch Bản Video
Đóng vai Chuyên gia phân tích nội dung, Đạo diễn kịch bản và Bậc thầy Copywriter.
Kênh người dùng: ${channelTopic || 'Chưa xác định'}.

[Chế độ 1] Bóc tách 100% kịch bản gốc — format: [CẢNH X: 0:00-0:00] 🎥 HÌNH ẢNH 🎤 LỜI THOẠI 🎵 ÂM THANH
[Chế độ 2] Tóm tắt + Rút trích Công thức Viral (Hook / Cấu trúc / Retention / CTA)
[Chế độ 3] Viết lại hoàn toàn — Zero Plagiarism, giữ chủ đề, đổi 100% lời thoại
[Chế độ 4] Clone cấu trúc → chủ đề mới: ${newTopic}
[Chế độ 5] Trích xuất lời thoại + timestamps SRT chuẩn
[Chế độ 6] Tái tạo JSON từng cảnh 8 giây cho Veo 3.1

Phân tích TOÀN BỘ video từ đầu đến cuối. Bao phủ 100% nội dung, không bỏ sót.
`.trim();

  // Vì là fallback, gọi trực tiếp với token lớn
  let modeNote = `Chế độ ${mode}`;
  if (mode === 4) modeNote += `. Chủ đề mới: ${newTopic}`;
  if (mode === 6 && stylePrompt) modeNote += `\nPhong cách video (visual_style) cho tất cả cảnh: "${stylePrompt}"`;
  if (mode === 6 && targetLang) {
    const tLangFull = LANG_FULL[targetLang] || targetLang;
    modeNote += `\n🌐 NGÔN NGỮ THOẠI BẮT BUỘC: Tất cả "lines" trong audio.dialogue PHẢI viết bằng ${tLangFull.toUpperCase()}.`;
  }
  const contentParts = [...videoParts, { text: `${modeNote}.\nPhân tích TOÀN BỘ video từ đầu đến cuối, không bỏ sót phần nào.` }];
  return await geminiGenerate(apiKeys, systemInstruction, contentParts, mode === 6 ? 16384 : 8192, onSwitch);
}
