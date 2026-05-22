import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from './keyRotation.js';

const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
const LLM_MODEL        = 'gemini-2.5-flash';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 1. Transcribe audio via Gemini multimodal ────────────────────────────────
export async function transcribeAudio(apiKeys, base64, mimeType, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64, mimeType } },
          {
            text: `Transcribe this audio file exactly in its original spoken language. Do NOT translate.
Listen carefully and split into segments at natural speech pauses/sentences with accurate timestamps.

Return ONLY valid JSON (no markdown, no extra text):
{
  "text": "complete transcript of all spoken words",
  "segments": [
    {"start": 0.0, "end": 3.5, "text": "first phrase"},
    {"start": 3.5, "end": 7.2, "text": "second phrase"}
  ]
}

Rules:
- "text": full concatenated transcript
- "segments": one entry per sentence/clause with start/end in seconds
- If no speech detected: {"text": "", "segments": []}
- Return ONLY the JSON object`
          }
        ]
      }],
      config: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    });

    const raw = (response?.text || '').trim();
    if (!raw) throw new Error('Gemini trả về rỗng khi transcribe audio');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong kết quả transcription');

    const parsed = JSON.parse(jsonMatch[0]);
    const segments = (parsed.segments || [])
      .map(s => ({ start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0, text: (s.text || '').trim() }))
      .filter(s => s.text);

    // Fallback: nếu Gemini không trả về segments, tạo segment đơn từ toàn bộ text
    // Dùng end: -1 để caller biết đây là fallback (sẽ được cap theo chunk duration)
    const fullText = parsed.text || segments.map(s => s.text).join(' ');
    if (segments.length === 0 && fullText) {
      segments.push({ start: 0, end: -1, text: fullText }); // -1 = "đến hết chunk"
    }

    return { fullText, segments };
  }, apiKeys, { onSwitch });
}

// ─── 1b. Transcribe toàn bộ audio theo từng CHUNK 60s ────────────────────────
// Giải quyết vấn đề: gửi cả file → Gemini cắt output giữa chừng → SRT thiếu/sai
// Cách làm: chia nhỏ → transcribe từng phần → cộng offset timestamp → ghép lại
export async function transcribeAudioChunked(apiKeys, totalDuration, extractChunkFn, onProgress, onChunkDone) {
  const CHUNK_SECS = 60; // 60s/chunk: đủ nhỏ để Gemini xử lý chính xác, đủ lớn để câu không bị cắt đôi
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const allSegments = [];
  let fullText = '';

  for (let i = 0; i < totalChunks; i++) {
    const startSec  = i * CHUNK_SECS;
    const durSec    = Math.min(CHUNK_SECS, totalDuration - startSec);
    const startStr  = `${Math.floor(startSec/60)}:${String(Math.floor(startSec%60)).padStart(2,'0')}`;
    const endStr    = `${Math.floor((startSec+durSec)/60)}:${String(Math.floor((startSec+durSec)%60)).padStart(2,'0')}`;

    onProgress?.(`Phần ${i+1}/${totalChunks}: ${startStr}–${endStr}`);

    // Trích xuất chunk audio
    const chunkAudio = await extractChunkFn(startSec, durSec);
    if (!chunkAudio.success) {
      onChunkDone?.(i + 1, totalChunks, 0, `Lỗi extract: ${chunkAudio.error}`);
      continue; // bỏ qua chunk lỗi, không dừng toàn bộ
    }

    // Transcribe chunk (retry tự động bằng retryWithKeyRotation bên trong)
    let result;
    try {
      result = await transcribeAudio(apiKeys, chunkAudio.base64, chunkAudio.mimeType, null);
    } catch (e) {
      onChunkDone?.(i + 1, totalChunks, 0, `Lỗi transcribe: ${e.message}`);
      continue;
    }

    // Cộng offset startSec vào từng segment, cap end <= startSec + durSec
    const chunkEndSec = startSec + durSec;
    const offsetSegments = (result.segments || []).map(s => ({
      start: parseFloat((Math.min(s.start, durSec) + startSec).toFixed(3)),
      end:   s.end === -1
               ? chunkEndSec                                           // fallback → đến hết chunk
               : parseFloat((Math.min(s.end, durSec) + startSec).toFixed(3)),
      text:  s.text
    })).filter(s => s.text && s.end > s.start);

    allSegments.push(...offsetSegments);
    if (result.fullText) fullText += (fullText ? ' ' : '') + result.fullText;

    onChunkDone?.(i + 1, totalChunks, offsetSegments.length);

    // Nghỉ nhỏ giữa các chunk để tránh rate limit
    if (i < totalChunks - 1) await sleep(500);
  }

  return { fullText, segments: allSegments };
}

// ─── 2. Chia audio thành chunks theo timeline cố định (port từ Python) ────────
export function createTimeBasedChunks(segments, totalAudioSeconds, chunkDuration = 8) {
  const totalChunks = Math.ceil(totalAudioSeconds / chunkDuration);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunkStart = i * chunkDuration;
    const chunkEnd   = Math.min((i + 1) * chunkDuration, totalAudioSeconds);

    const texts = segments
      .filter(seg => seg.start < chunkEnd && seg.end > chunkStart)
      .map(seg => seg.text);

    chunks.push({
      scene:     i + 1,
      time:      `${chunkStart}s - ${chunkEnd}s`,
      timeStart: chunkStart,
      timeEnd:   chunkEnd,
      exactText: texts.length > 0 ? texts.join(' ') : '[Không có lời thoại - Âm thanh môi trường]'
    });
  }

  return chunks;
}

// ─── 3. Phân tích tổng quát toàn bộ transcript ───────────────────────────────
export async function analyzeOverallContent(apiKeys, fullTranscript, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Analyze this audio/video transcript to build a comprehensive content profile for video prompt generation.

TRANSCRIPT:
${fullTranscript.slice(0, 8000)}

Return ONLY valid JSON (no markdown):
{
  "topic": "main topic in 1 sentence",
  "tone": "content tone (e.g. educational, motivational, storytelling, news, documentary)",
  "key_entities": ["person/brand/place/concept that appear repeatedly"],
  "visual_themes": ["dominant visual themes to represent this content"],
  "narrative_arc": "overall narrative structure description",
  "recommended_visual_style": "cinematography and visual style recommendation",
  "context_summary": "2-3 sentence summary giving full context for each scene prompt generation"
}`
        }]
      }],
      config: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } }
    });

    const raw = (response?.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong phân tích tổng quát');
    return JSON.parse(jsonMatch[0]);
  }, apiKeys, { onSwitch });
}

// ─── 4. Tạo Veo prompt cho 1 chunk ───────────────────────────────────────────
export async function generateVeoPrompt(apiKeys, chunk, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };

  const contextBlock = overallContext ? `
CONTENT CONTEXT (use this to keep prompts consistent and accurate):
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Visual themes: ${(overallContext.visual_themes || []).join(', ')}
- Recommended style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}
` : '';

  const systemInstruction = `You are an expert Video Prompt Engineer for Google Veo video generation.

Write ONE dynamic Veo_Video_Prompt for a ${targetDuration}-second scene.
${contextBlock}
CRITICAL RULES:
1. STRICT ALIGNMENT: Visually translate the dialogue to imagery. Every object/action/number in text MUST appear in the prompt.
2. USE CONTENT CONTEXT: Your prompt must reflect the overall topic, tone, and visual themes of the full content.
3. DYNAMIC ACTION SEQUENCE: If text has 2-3 ideas, chain camera movements:
   "Starts with [Scene A], then camera pans/zooms to [Scene B], and finally [Scene C]"
   Keywords: "Starts with", "then camera pans", "quickly zooms", "transitions to", "reveals"
4. PACING FOR ${targetDuration}s: ${pacingMap[targetDuration] || pacingMap[8]}
5. DATA VISUALIZATION: Numbers → holographic text, glowing overlays, infographic
6. END FORMAT: Always end with "aspect ratio 16:9, cinematic shot"
7. NO STATIC SCENES for multi-idea dialogues

LANGUAGE RULE (ZERO TOLERANCE):
- Output MUST BE 100% IN ENGLISH. Translate meaning from ANY input language.
- NO non-English words in the output whatsoever.

Return ONLY the Veo_Video_Prompt string. No JSON, no numbering, no explanations.`;

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Scene ${chunk.scene} | Time: ${chunk.time}\n\nText to visualize:\n"${chunk.exactText}"\n\nWrite ONE dynamic Veo_Video_Prompt for this ${targetDuration}-second scene.`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7
      }
    });

    const prompt = (response?.text || '').trim().replace(/^["']|["']$/g, '');
    if (!prompt) throw new Error('Gemini trả về rỗng khi tạo prompt');
    return prompt;
  }, apiKeys, { onSwitch });
}

// ─── 5. Xử lý toàn bộ chunks theo batch ──────────────────────────────────────
export async function analyzeScenes(apiKeys, chunks, targetDuration, overallContext, onSceneProgress, onSceneReady) {
  const results = [];
  const BATCH_SIZE  = 3;
  const BATCH_DELAY = 3000; // ms giữa các batch

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    onSceneProgress?.(i + 1, chunks.length);

    try {
      const veoPrompt = await generateVeoPrompt(
        apiKeys, chunk, targetDuration, overallContext,
        ({ fromIdx, toIdx }) => onSceneProgress?.(i + 1, chunks.length, `Key ${fromIdx + 1}→${toIdx + 1}`)
      );

      const sceneData = {
        sceneNumber:    chunk.scene,
        timeEstimation: chunk.time,
        dialogue:       chunk.exactText,
        veoVideoPrompt: veoPrompt
      };
      results.push(sceneData);
      onSceneReady?.(sceneData, false);
    } catch (e) {
      const fallback = {
        sceneNumber:    chunk.scene,
        timeEstimation: chunk.time,
        dialogue:       chunk.exactText,
        veoVideoPrompt: 'Cinematic establishing shot, smooth camera movement, aspect ratio 16:9, cinematic shot',
        error:          e.message
      };
      results.push(fallback);
      onSceneReady?.(fallback, true);
    }

    // Delay giữa các batch (không delay sau chunk cuối)
    if ((i + 1) % BATCH_SIZE === 0 && i + 1 < chunks.length) {
      await sleep(BATCH_DELAY);
    }
  }

  return results;
}

// ─── 5. Export helpers ────────────────────────────────────────────────────────
export function exportToTxt(scenes) {
  return scenes.map(s => s.veoVideoPrompt.replace(/\n+/g, ' ').trim()).join('\n');
}

export function exportToJson(scenes, meta) {
  return JSON.stringify({ ...meta, total_scenes: scenes.length, scenes }, null, 2);
}

export function exportToMarkdown(scenes, meta) {
  let md = `# Audio to Video Prompts\n\n`;
  md += `**File:** ${meta.fileName || 'N/A'}  \n`;
  md += `**Duration:** ${meta.duration || 0}s  \n`;
  md += `**Total Scenes:** ${scenes.length}  \n`;
  md += `**Scene Duration:** ${meta.sceneDuration || 8}s/scene  \n\n---\n\n`;

  for (const s of scenes) {
    md += `## Scene ${s.sceneNumber}\n\n`;
    md += `**Time:** ${s.timeEstimation}  \n`;
    md += `**Dialogue:** ${s.dialogue}  \n\n`;
    md += `**Veo Prompt:**\n\`\`\`\n${s.veoVideoPrompt}\n\`\`\`\n\n---\n\n`;
  }
  return md;
}
