import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from './keyRotation.js';

const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
const LLM_MODEL        = 'gemini-2.5-flash';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Auto-retry helper ─────────────────────────────────────────────────────────
// Dùng cho lỗi tạm thời (Gemini trả rỗng, JSON lỗi, network timeout).
// KHÔNG thay thế retryWithKeyRotation — dùng bổ sung bên ngoài để vòng lặp
// key-rotation chạy lại từ đầu sau khi đã ngủ một lúc.
async function retryOnError(fn, maxAttempts = 3, baseDelayMs = 2000) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        console.warn(`[audioToVideo retry ${attempt + 1}/${maxAttempts - 1}]`, e.message);
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// ─── 1. Transcribe 1 chunk audio via Gemini multimodal ───────────────────────
// Prompt gọn tối đa để tiết kiệm input tokens (~60 tokens thay vì ~130 tokens cũ)
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
            text: `Transcribe in original spoken language (no translation). Return ONLY JSON:
{"text":"full transcript","segments":[{"start":0.0,"end":3.5,"text":"sentence"},...]}`
          }
        ]
      }],
      // 90s audio → tối đa ~1200 tokens output; 2000 đủ dư, tránh lãng phí quota
      config: { maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } }
    });

    const raw = (response?.text || '').trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    if (!raw) throw new Error('Gemini trả về rỗng khi transcribe audio');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không tìm thấy JSON trong kết quả transcription');

    const parsed = JSON.parse(jsonMatch[0]);
    const segments = (parsed.segments || [])
      .map(s => ({ start: parseFloat(s.start) || 0, end: parseFloat(s.end) || 0, text: (s.text || '').trim() }))
      .filter(s => s.text);

    const fullText = parsed.text || segments.map(s => s.text).join(' ');
    if (segments.length === 0 && fullText) {
      segments.push({ start: 0, end: -1, text: fullText });
    }
    return { fullText, segments };
  }, apiKeys, { onSwitch });
}

// ─── 1b. Transcribe toàn bộ audio — chunk 90s, xử lý 2 chunk song song ────────
// Tối ưu quota:
//   • CHUNK_SECS 90s → giảm 33% số API call (77 → 52 với file 76 phút)
//   • PARALLEL 2   → 2 chunk chạy đồng thời, dùng 2 key cùng lúc, nhanh 2×
//   • Prompt gọn   → giảm ~50% input tokens mỗi call
export async function transcribeAudioChunked(apiKeys, totalDuration, extractChunkFn, onProgress, onChunkDone) {
  const CHUNK_SECS = 90;
  const PARALLEL   = Math.min(2, (apiKeys || []).length || 1); // tối đa 2, không vượt số key
  const totalChunks = Math.ceil(totalDuration / CHUNK_SECS);
  const allSegments = [];
  let fullText = '';

  const fmt = sec => `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;

  for (let i = 0; i < totalChunks; i += PARALLEL) {
    // ── Tập hợp slots trong batch này ─────────────────────────────────────────
    const slots = [];
    for (let p = 0; p < PARALLEL && (i + p) < totalChunks; p++) {
      const idx      = i + p;
      const startSec = idx * CHUNK_SECS;
      const durSec   = Math.min(CHUNK_SECS, totalDuration - startSec);
      slots.push({ idx, startSec, durSec });
    }

    const rangeStr = slots.length > 1
      ? `${slots[0].idx + 1}–${slots[slots.length - 1].idx + 1}`
      : `${slots[0].idx + 1}`;
    onProgress?.(`Phần ${rangeStr}/${totalChunks}: ${fmt(slots[0].startSec)}–${fmt(slots[slots.length-1].startSec + slots[slots.length-1].durSec)}`);

    // ── Extract audio song song ────────────────────────────────────────────────
    const extracted = await Promise.all(
      slots.map(slot =>
        extractChunkFn(slot.startSec, slot.durSec)
          .then(r  => ({ ...slot, ...r }))
          .catch(e => ({ ...slot, success: false, error: e.message }))
      )
    );

    // ── Transcribe song song (key rotation bên trong + outer retry cho lỗi tạm thời) ─
    const transcribed = await Promise.all(
      extracted.map(ex => {
        if (!ex.success) return Promise.resolve({ ...ex, ok: false });
        // retryOnError: tối đa 3 lần (2 retry) — phòng Gemini trả rỗng / JSON lỗi
        return retryOnError(() => transcribeAudio(apiKeys, ex.base64, ex.mimeType, null), 3, 2000)
          .then(r  => ({ ...ex, ok: true, result: r }))
          .catch(e => ({ ...ex, ok: false, err: e.message }));
      })
    );

    // ── Gộp kết quả theo đúng thứ tự chunk ───────────────────────────────────
    for (const t of transcribed) {
      const { idx, startSec, durSec, success, error, ok, err, result } = t;
      const chunkEndSec = startSec + durSec;

      if (!success) {
        onChunkDone?.(idx + 1, totalChunks, 0, `Lỗi extract: ${error}`);
        continue;
      }
      if (!ok) {
        onChunkDone?.(idx + 1, totalChunks, 0, `Lỗi transcribe: ${err}`);
        continue;
      }

      const offsetSegs = (result.segments || []).map(s => ({
        start: parseFloat((Math.min(s.start, durSec) + startSec).toFixed(3)),
        end:   s.end === -1 ? chunkEndSec
                            : parseFloat((Math.min(s.end, durSec) + startSec).toFixed(3)),
        text:  s.text
      })).filter(s => s.text && s.end > s.start);

      allSegments.push(...offsetSegs);
      if (result.fullText) fullText += (fullText ? ' ' : '') + result.fullText;
      onChunkDone?.(idx + 1, totalChunks, offsetSegs.length);
    }

    // Delay nhỏ giữa các batch song song (tránh RPM spike)
    if (i + PARALLEL < totalChunks) await sleep(400);
  }

  return { fullText, segments: allSegments };
}

// ─── Loại bỏ từ/câu lặp trong transcript (stutter TTS hoặc sub trùng timestamp) ──
// VD: "But here's the But here's the cold" → "But here's the cold"
//     "Don't miss a single one. Don't miss a single one." → "Don't miss a single one."
//     "and and avoid" → "and avoid"
function cleanDialogueText(text) {
  if (!text || typeof text !== 'string') return text;
  let s = text.replace(/\s+/g, ' ').trim();

  // Pass 1: Xóa stutter-restart — cùng N từ liên tiếp (n=7 xuống 2)
  for (let n = 7; n >= 2; n--) {
    const w    = `[\\w'’\\-]+`;
    const grp  = `(?:${w}\\s+){${n - 1}}${w}`;
    const re   = new RegExp(`(${grp})[,.]?\\s+\\1`, 'gi');
    let prev;
    do { prev = s; s = s.replace(re, '$1'); } while (s !== prev);
  }

  // Pass 2: Xóa từ đơn lặp liên tiếp (kể cả có dấu phẩy giữa)
  // "and, and" → "and"  |  "scientific, scientific" → "scientific"
  s = s.replace(/\b(\w+)[,.]?\s+\1\b/gi, '$1');

  // Pass 3: Xóa câu/mệnh đề trùng liên tiếp
  const parts   = s.split(/(?<=[.!?])\s+/);
  const norm    = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();
  const deduped = parts.filter((p, i) => i === 0 || norm(p) !== norm(parts[i - 1]));

  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── 2. Chia audio thành chunks theo timeline cố định (port từ Python) ────────
export function createTimeBasedChunks(segments, totalAudioSeconds, chunkDuration = 8) {
  const totalChunks = Math.ceil(totalAudioSeconds / chunkDuration);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const chunkStart = i * chunkDuration;
    const chunkEnd   = Math.min((i + 1) * chunkDuration, totalAudioSeconds);

    const rawTexts = segments
      .filter(seg => seg.start < chunkEnd && seg.end > chunkStart)
      .map(seg => seg.text);

    // Bước 1: Loại bỏ subtitle trùng liên tiếp (cùng text, khác timestamp)
    // VD: sub#40 "Don't miss a single one." và sub#41 "Don't miss a single one." → giữ 1
    const norm       = (t) => t.replace(/[.,!?'"]/g, '').trim().toLowerCase();
    const dedupTexts = rawTexts.filter((t, idx) => idx === 0 || norm(t) !== norm(rawTexts[idx - 1]));

    // Bước 2: Làm sạch stutter/lặp trong text đã ghép
    const joined = dedupTexts.length > 0
      ? cleanDialogueText(dedupTexts.join(' '))
      : '[Không có lời thoại - Âm thanh môi trường]';

    chunks.push({
      scene:     i + 1,
      time:      `${chunkStart}s - ${chunkEnd}s`,
      timeStart: chunkStart,
      timeEnd:   chunkEnd,
      exactText: joined,
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

  const systemInstruction = `You are an expert Video Prompt Engineer for Google Veo 3 video generation.

Write ONE complete, detailed Veo_Video_Prompt for a ${targetDuration}-second scene.
${contextBlock}
━━━ REQUIRED PROMPT STRUCTURE (ALL elements must be present) ━━━
A complete Veo prompt MUST include ALL of the following in one flowing paragraph:

1. SUBJECT & ACTION — Who/what is the main subject? What are they doing? Be specific.
2. ENVIRONMENT/SETTING — Where is the scene? (indoor/outdoor, location type, background details)
3. CAMERA MOVEMENT — Exact camera technique: dolly in, slow pan left/right, aerial zoom out, tracking shot, crane shot, push-in, pull-back, orbit, handheld shake, static locked shot, etc.
4. LIGHTING — Natural/artificial, direction (front/back/side lit), quality (soft/harsh), time of day (golden hour, midday, night, neon-lit, etc.)
5. COLOR PALETTE — Dominant colors, tone (warm/cool/desaturated/vivid/cinematic)
6. VISUAL STYLE — Film look: cinematic, documentary, hyper-real, stylized, photorealistic, etc.
7. MOOD/ATMOSPHERE — Emotional quality: tense, uplifting, melancholic, epic, serene, mysterious
8. AUDIO CUES (Veo 3 native audio) — Ambient sounds, music tone, voice-over style, sound effects relevant to the scene
9. END TAG — Always close with: "aspect ratio 16:9, cinematic shot"

━━━ CONTENT ALIGNMENT RULES ━━━
- STRICT ALIGNMENT: Every key object, action, or number mentioned in the dialogue MUST appear visually in the prompt.
- DYNAMIC MOVEMENT: For 2+ ideas in dialogue, chain camera movements:
  "Starts with [Scene A], then camera pans to [Scene B], transitioning to [Scene C]"
  Transition keywords: "Starts with", "then camera pans", "quickly zooms to", "transitions to", "reveals", "pulls back to reveal"
- PACING FOR ${targetDuration}s: ${pacingMap[targetDuration] || pacingMap[8]}
- DATA/NUMBERS: Visualize as glowing holographic overlays, floating infographics, or on-screen text.
- NO STATIC SCENES when dialogue contains 2+ distinct ideas.

━━━ LANGUAGE RULE (ZERO TOLERANCE) ━━━
- Output MUST BE 100% IN ENGLISH — translate meaning from ANY input language.
- NO non-English words anywhere in the output.

Return ONLY the Veo_Video_Prompt string. No JSON, no numbering, no label, no explanations. Just the prompt paragraph.`;

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Scene ${chunk.scene} | Time: ${chunk.time}

DIALOGUE/NARRATION TO VISUALIZE:
"${chunk.exactText}"

Write ONE complete Veo_Video_Prompt for this ${targetDuration}-second scene.
REMINDER: Include ALL 9 required elements — Subject, Environment, Camera Movement, Lighting, Color Palette, Visual Style, Mood, Audio Cues, and end with "aspect ratio 16:9, cinematic shot".`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7
      }
    });

    const raw = (response?.text || '').trim();
    // Strip markdown code fences if Gemini wraps output
    const prompt = raw
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    if (!prompt) throw new Error('Gemini trả về rỗng khi tạo prompt');
    // Sanity check: prompt must end with cinematic tag (ensure it's not truncated)
    if (!prompt.toLowerCase().includes('cinematic') && prompt.length < 80)
      throw new Error('Prompt quá ngắn hoặc bị cắt — thử lại');
    return prompt;
  }, apiKeys, { onSwitch });
}

// ─── 5a. Tạo Veo prompt cho nhiều scene trong 1 API call ─────────────────────
// Gộp N scene → 1 request → nhận JSON array N prompts → tiết kiệm 5× số request
async function generateVeoPromptBatch(apiKeys, chunks, targetDuration, overallContext, onSwitch) {
  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.'
  };
  const contextBlock = overallContext ? `
CONTENT CONTEXT (keep all prompts consistent with this):
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Visual themes: ${(overallContext.visual_themes || []).join(', ')}
- Recommended style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}
` : '';

  const systemInstruction = `You are an expert Video Prompt Engineer for Google Veo 3 video generation.
${contextBlock}
For each scene provided, write ONE complete Veo_Video_Prompt for a ${targetDuration}-second clip.

━━━ EACH PROMPT MUST INCLUDE ALL 9 ELEMENTS ━━━
1. SUBJECT & ACTION — specific subject and what they are doing
2. ENVIRONMENT/SETTING — location, indoor/outdoor, background details
3. CAMERA MOVEMENT — dolly in/out, pan, orbit, tracking, crane, aerial, handheld, etc.
4. LIGHTING — direction, quality, time of day, artificial/natural
5. COLOR PALETTE — dominant colors and overall tone
6. VISUAL STYLE — cinematic, documentary, photorealistic, hyper-real, etc.
7. MOOD/ATMOSPHERE — emotional quality of the scene
8. AUDIO CUES — ambient sounds, music tone, voice-over style (Veo 3 native audio)
9. END TAG — always close with: "aspect ratio 16:9, cinematic shot"

━━━ RULES ━━━
- STRICT ALIGNMENT: every object/action/number in dialogue MUST appear in the prompt.
- DYNAMIC MOVEMENT: chain camera movements for 2+ ideas: "Starts with X, then pans to Y, reveals Z"
- PACING: ${pacingMap[targetDuration] || pacingMap[8]}
- NUMBERS/DATA: visualize as glowing holographic overlays or floating infographics.
- LANGUAGE: 100% English output only. Translate from ANY input language.

━━━ OUTPUT FORMAT ━━━
Return ONLY a valid JSON array with exactly ${chunks.length} strings — one prompt per scene, in order:
["<prompt for scene 1>", "<prompt for scene 2>", ...]
No markdown, no extra text, no explanation outside the JSON array.`;

  const scenesText = chunks.map(c =>
    `Scene ${c.scene} | Time: ${c.time}\nDialogue: "${c.exactText}"`
  ).join('\n\n---\n\n');

  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `${scenesText}\n\nWrite ONE complete Veo_Video_Prompt for EACH of the ${chunks.length} scenes above.\nReturn ONLY a JSON array of ${chunks.length} prompt strings, in order.`
        }]
      }],
      config: {
        systemInstruction,
        maxOutputTokens: chunks.length * 450,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7
      }
    });

    const raw = (response?.text || '').trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('Batch: không tìm thấy JSON array trong kết quả');

    const prompts = JSON.parse(arrMatch[0]);
    if (!Array.isArray(prompts) || prompts.length !== chunks.length)
      throw new Error(`Batch: nhận ${prompts?.length ?? 0} prompts thay vì ${chunks.length}`);

    return prompts.map(p =>
      String(p).replace(/^["']|["']$/g, '').trim()
    );
  }, apiKeys, { onSwitch });
}

// ─── 5b. Xử lý toàn bộ chunks — batch 5 scene/call, fallback đơn lẻ ──────────
export async function analyzeScenes(apiKeys, chunks, targetDuration, overallContext, onSceneProgress, onSceneReady) {
  const results   = [];
  const BATCH     = 5;      // 5 scene/call → giảm 5× số request → key lâu hết hơn
  const DELAY_MS  = 1200;   // delay giữa các batch (nhỏ hơn trước vì ít call hơn)

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batchChunks = chunks.slice(i, i + BATCH);
    onSceneProgress?.(i + 1, chunks.length);

    let batchPrompts = null;
    try {
      // retryOnError: 2 lần (1 retry) — phòng Gemini trả JSON lỗi / mảng sai số
      batchPrompts = await retryOnError(
        () => generateVeoPromptBatch(
          apiKeys, batchChunks, targetDuration, overallContext,
          ({ fromIdx, toIdx }) => onSceneProgress?.(i + 1, chunks.length, `Key ${fromIdx + 1}→${toIdx + 1}`)
        ),
        2, 3000
      );
    } catch (batchErr) {
      // Batch thất bại sau retry → fallback từng scene đơn lẻ trong batch này
      console.warn('[analyzeScenes] Batch lỗi sau retry, fallback đơn lẻ:', batchErr.message);
    }

    for (let j = 0; j < batchChunks.length; j++) {
      const chunk     = batchChunks[j];
      const sceneIdx  = i + j;
      onSceneProgress?.(sceneIdx + 1, chunks.length);

      if (batchPrompts && batchPrompts[j]) {
        // Thành công từ batch
        const sceneData = {
          sceneNumber:    chunk.scene,
          timeEstimation: chunk.time,
          dialogue:       chunk.exactText,
          veoVideoPrompt: batchPrompts[j]
        };
        results.push(sceneData);
        onSceneReady?.(sceneData, false);
      } else {
        // Fallback: gọi đơn lẻ — tự động retry tối đa 3 lần trước khi dùng hardcoded fallback
        try {
          const veoPrompt = await retryOnError(
            () => generateVeoPrompt(
              apiKeys, chunk, targetDuration, overallContext,
              ({ fromIdx, toIdx }) => onSceneProgress?.(sceneIdx + 1, chunks.length, `Key ${fromIdx + 1}→${toIdx + 1}`)
            ),
            3, 2500
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
      }
    }

    // Delay giữa các batch (không delay sau batch cuối)
    if (i + BATCH < chunks.length) await sleep(DELAY_MS);
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
