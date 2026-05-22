import { GoogleGenAI, Type } from "@google/genai";
import { retryWithKeyRotation } from './keyRotation.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const SCENE_CHUNK = 8; // base chunk size — adaptive splitter handles larger batches safely

// Maps style display names → detailed image-generation keywords
// Prevents AI from defaulting to 3D/CGI when given ambiguous style names
const STYLE_KEYWORDS = {
  'Photorealistic':  'RAW photograph, photorealistic, hyperrealistic, DSLR camera, 8K UHD, real person, film grain — NOT 3D render, NOT CGI, NOT illustration, NOT painting',
  'Cinematic 4K':    'cinematic 4K, anamorphic lens, film grade color, movie still frame, shallow depth of field, professional cinematography',
  'Cinematic':       'cinematic 4K, anamorphic lens, film grade color, movie still frame, shallow depth of field, professional cinematography',
  'Anime / Manga':   'anime style, manga illustration, 2D cel-shaded, Japanese animation, flat color, NOT 3D',
  'Anime':           'anime style, manga illustration, 2D cel-shaded, Japanese animation, flat color, NOT 3D',
  'Pixar 3D':        'Pixar 3D animation, high-quality CGI, Disney-Pixar render, colorful, smooth studio lighting',
  '3D Animation':    'high-quality 3D animation, smooth CGI render, detailed character model, studio lighting, NOT 2D',
  'Studio Ghibli':   'Studio Ghibli animation, hand-drawn watercolor, Hayao Miyazaki style, warm palette, 2D illustration',
  'Dark Fantasy':    'dark fantasy art, dramatic chiaroscuro, oil painting, gothic atmosphere, high detail',
  'Watercolor':      'watercolor painting, soft wet edges, translucent paint texture, artistic illustration',
  'Cyberpunk':       'cyberpunk art, neon-lit city, futuristic, high contrast, synthwave color palette',
  'Steampunk':       'steampunk illustration, Victorian machinery, brass and copper tones, detailed mechanical',
  'Sketch':          'pencil sketch, hand-drawn line art, graphite shading, illustration',
  'Manga':           'manga black and white, ink line art, screentone shading, Japanese comic style',
  'Claymation':      'claymation stop-motion, clay material texture, handmade sculpted look, soft lighting',
  'Whiteboard':      'whiteboard animation, hand-drawn sketch lines, black marker on white background, clean illustration',
  'Pixel Art':       '8-bit pixel art, retro video game style, pixelated graphics, limited color palette',
  'Mặc định':        'high quality, ultra-detailed, professional lighting, 8K',
};

// Expands a style name (or "Label (desc)" format) to detailed image-generation keywords.
export function expandStyle(style) {
  if (!style) return style;
  // Strip Vietnamese/non-ASCII parenthetical descriptions like "(Ảnh thực tế siêu chi tiết)"
  const clean = style.replace(/\s*\([^)]*\)/g, '').trim();
  return STYLE_KEYWORDS[clean] || STYLE_KEYWORDS[style.trim()] || style;
}

// Special error class to distinguish MAX_TOKENS from real errors
class MaxTokensError extends Error {
  constructor() { super('MAX_TOKENS_EXCEEDED'); this.isMaxTokens = true; }
}

async function geminiJSON(apiKeys, prompt, schema, maxTokens = 32768, onSwitch) {
  return retryWithKeyRotation(async (key) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        responseSchema: schema,
        // Tắt thinking mode — tiết kiệm 20-50K token/lần gọi
        // Gemini 2.5 Flash bật thinking mặc định, làm cạn quota rất nhanh
        thinkingConfig: { thinkingBudget: 0 },
      }
    });
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') throw new Error('Nội dung bị chặn do chính sách an toàn.');
    if (candidate?.finishReason === 'MAX_TOKENS') throw new MaxTokensError();
    let text = response?.text || '';
    if (!text && candidate?.content?.parts) text = candidate.content.parts.filter(p => p.text).map(p => p.text).join('');
    if (!text) throw new Error('AI trả về rỗng. Vui lòng thử lại.');
    try {
      const m = text.match(/[\[\{][\s\S]*/);
      return JSON.parse(m ? m[0] : text);
    } catch {
      throw new Error('AI trả về JSON không hợp lệ. Vui lòng thử lại.');
    }
  }, apiKeys, { onSwitch });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Extract full DNA from the script
// ─────────────────────────────────────────────────────────────────────────────
async function extractScriptDNA(apiKeys, config, onSwitch) {
  const assetHint = [];
  if (config.characters?.length) {
    assetHint.push('USER-PROVIDED CHARACTERS:');
    config.characters.forEach(c => assetHint.push(`${c.id} | ${c.name} | ${c.description}`));
  }
  if (config.environments?.length) {
    assetHint.push('USER-PROVIDED ENVIRONMENTS:');
    config.environments.forEach(e => assetHint.push(`${e.id} | ${e.name} | ${e.description}`));
  }

  const noDialogue = config.language === 'no-dialogue';
  const prompt = `Read the following script VERY CAREFULLY and extract every entity needed to maintain perfect visual consistency across all scenes.

${assetHint.length ? assetHint.join('\n') + '\n\n' : ''}SCRIPT:
${config.subject}

STYLE: ${expandStyle(config.style)}
DIALOGUE MODE: ${noDialogue ? 'NO DIALOGUE — all scenes are completely silent, no voice, no speech' : `DIALOGUE LANGUAGE: ${config.language}`}

TASK — Create DNA reference sheets for:
1. ALL CHARACTERS (main + every supporting character that appears). Code names: char_1, char_2, char_3... in order of importance.
2. ALL ENVIRONMENTS/SETTINGS (every distinct location that appears).
3. ALL KEY OBJECTS/PROPS repeated across scenes (NOT living beings — weapons, vehicles, magical items, etc.).

⚠️ CRITICAL LANGUAGE RULE: ALL output fields MUST be 100% ENGLISH ONLY.
- NO Vietnamese, NO Japanese, NO Chinese, NO Korean, NO any non-English text in ANY field.
- If the script/style is in another language, TRANSLATE everything to English.
- Only "voice_lock" may mention the language code (e.g. "ja-JP narrator voice").

RULES:
- Character DNA: First determine if the character is HUMAN or ANIMAL/CREATURE.
  • If HUMAN: nationality, gender, age, face details (shape, jaw, nose, eyes, eyebrows), hair (color, style, length), skin tone, body type/height/posture, EXACT outfit (colors, materials, style), accessories/weapons/props always carried.
  • If ANIMAL/CREATURE: species, breed, size, fur/feather/skin exact color and pattern, eye color, distinctive physical features (scars, markings), any accessories worn.
- dna_prompt: ENGLISH ONLY, ONE LINE, Veo 3.1 compatible. Use char_X code names NOT real names.
- dna_prompt for HUMAN character: "Character sheet of [char_X], [full appearance], [exact outfit], front view, side view, back view, 3/4 view, full body, white background, ${expandStyle(config.style)}, high detail."
- dna_prompt for ANIMAL/CREATURE character: "Real [species and breed], [exact fur/skin color and pattern], [eye color], [distinctive features], [accessories if any], multiple angles photo reference, white background, ${expandStyle(config.style)}, nature photography style, actual animal, no human costume, no anthropomorphism, no clothing on body."
- Environment DNA: location type, architecture/natural features, color palette, lighting conditions, time of day, atmosphere keywords. ALL IN ENGLISH.
- Object DNA: exact shape, material, color, size, distinctive marks. ALL IN ENGLISH.
- style_lock: MUST copy EXACTLY this style string and nothing else: "${expandStyle(config.style)}". Do NOT paraphrase, shorten, or add words.
- voice_lock: ${noDialogue ? '"no voice — silent film, no dialogue, no narration"' : 'voice character for dialogue (tone, accent, language code only)'}.

⚠️ NO TEXT ON SCREEN RULE (ABSOLUTE): NEVER include text overlays, captions, subtitles, watermarks, titles, labels, or any written text rendered on the visual frame in ANY prompt. Images/video frames must be completely clean of text. End every dna_prompt with "no text, no captions, no watermarks, no on-screen text".`;

  const schema = {
    type: Type.OBJECT,
    required: ['topic_content', 'characters', 'environments', 'key_objects', 'master_dna'],
    properties: {
      topic_content: { type: Type.STRING },
      characters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['id', 'name', 'role', 'gender', 'age', 'nationality', 'appearance', 'outfit', 'dna_prompt'],
          properties: {
            id: { type: Type.STRING }, name: { type: Type.STRING }, role: { type: Type.STRING },
            gender: { type: Type.STRING }, age: { type: Type.STRING }, nationality: { type: Type.STRING },
            appearance: { type: Type.STRING }, outfit: { type: Type.STRING }, dna_prompt: { type: Type.STRING }
          }
        }
      },
      environments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['id', 'name', 'description', 'dna_prompt'],
          properties: {
            id: { type: Type.STRING }, name: { type: Type.STRING },
            description: { type: Type.STRING }, dna_prompt: { type: Type.STRING }
          }
        }
      },
      key_objects: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['id', 'name', 'description', 'dna_prompt'],
          properties: {
            id: { type: Type.STRING }, name: { type: Type.STRING },
            description: { type: Type.STRING }, dna_prompt: { type: Type.STRING }
          }
        }
      },
      master_dna: {
        type: Type.OBJECT,
        required: ['style_lock', 'voice_lock'],
        properties: {
          style_lock: { type: Type.STRING },
          voice_lock: { type: Type.STRING }
        }
      }
    }
  };

  try {
    return await geminiJSON(apiKeys, prompt, schema, 8192, onSwitch);
  } catch (err) {
    if (err.isMaxTokens) {
      // Script too long → retry with truncated input (keep first 3000 chars for DNA)
      const truncated = config.subject.length > 3000
        ? config.subject.substring(0, 3000) + '\n...[truncated for DNA extraction]'
        : config.subject;
      if (truncated === config.subject) throw err;
      const truncatedPrompt = prompt.replace(config.subject, truncated);
      return await geminiJSON(apiKeys, truncatedPrompt, schema, 8192, onSwitch);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Generate scene prompts in chunks
// ─────────────────────────────────────────────────────────────────────────────
function extractSceneSection(script, fromScene, toScene) {
  // Try to find [CẢNH n:] or [SCENE n:] markers to extract only relevant portion
  const startRe = new RegExp(`\\[(?:CẢNH|SCENE|Cảnh)\\s+${fromScene}[\\s:\\-—]`, 'i');
  const endRe   = new RegExp(`\\[(?:CẢNH|SCENE|Cảnh)\\s+${toScene + 1}[\\s:\\-—]`, 'i');
  const fromIdx = script.search(startRe);
  if (fromIdx === -1) return script; // fallback: full script
  const toIdx = script.search(endRe);
  return toIdx === -1 ? script.substring(fromIdx) : script.substring(fromIdx, toIdx);
}

async function generateScenesBatch(apiKeys, config, dna, fromScene, toScene, onSwitch) {
  const charDNA = dna.characters.map(c => `${c.id} (${c.name}): ${c.dna_prompt}`).join('\n');
  const envDNA  = dna.environments.map(e => `${e.id} (${e.name}): ${e.dna_prompt}`).join('\n');
  const objDNA  = dna.key_objects.map(o => `${o.id} (${o.name}): ${o.dna_prompt}`).join('\n');
  const styleLock = dna.master_dna?.style_lock || expandStyle(config.style);
  const voiceLock = dna.master_dna?.voice_lock || 'natural voice';
  const noDialogue = config.language === 'no-dialogue';
  const LANG_NAME_MAP = {
    'vi-VN': 'Vietnamese', vi: 'Vietnamese',
    'en-US': 'English',    en: 'English',
    'ja-JP': 'Japanese',   ja: 'Japanese',
    'zh-CN': 'Chinese',    zh: 'Chinese',
    'ko-KR': 'Korean',     ko: 'Korean',
    'fr-FR': 'French',     fr: 'French',
    'es-ES': 'Spanish',    es: 'Spanish',
    'de-DE': 'German',     de: 'German',
    'th-TH': 'Thai',       th: 'Thai',
  };
  const langLabel = LANG_NAME_MAP[config.language] || LANG_NAME_MAP[config.language?.split('-')[0]] || config.language;

  // Extract only the relevant script section to save tokens
  const scriptSection = extractSceneSection(config.subject, fromScene, toScene);

  const dialogueRules = noDialogue ? `
⚠️ DIALOGUE MODE: NO DIALOGUE (ABSOLUTE — NO EXCEPTIONS):
RULE A — ALL fields MUST be 100% ENGLISH.
RULE B — "dialogue" field: MUST always be empty string "". No spoken words in any scene.
RULE C — "final_prompt": MUST NOT contain any dialogue, speech, or character speaking. Do NOT append any "speaks" clause.
RULE D — "audio_prompt": describe only SFX, BGM, ambient sounds. No voice, no narration, no speech.
RULE E — "voice_lock": "no voice — silent, no dialogue, no narration".` : `
⚠️ LANGUAGE RULES (ABSOLUTE — NO EXCEPTIONS):
RULE A — ALL fields EXCEPT "dialogue" and the spoken text inside "final_prompt" MUST be 100% ENGLISH.
RULE B — "dialogue" field: MUST contain the EXACT original dialogue from the script in ${langLabel}. COPY VERBATIM — do NOT translate, paraphrase, or rewrite in English. Empty string "" if truly no dialogue in that scene.
RULE C — "final_prompt" language: EVERY final_prompt MUST START with "[${langLabel} voice]," as the very first token (even scenes with no dialogue, to lock audio language). For scenes WITH dialogue, also append EXACTLY: , character speaks ${langLabel}: "[BYTE-FOR-BYTE IDENTICAL text from the dialogue field — MUST be ${langLabel} script characters, ABSOLUTELY NEVER translated or rewritten in English]", spoken audio only. ⚠️ CRITICAL: Veo 3.1 synthesizes voice from the text inside those quotes — English text = English voice, ${langLabel} text = ${langLabel} voice. No exceptions.
RULE D — "audio_prompt": MUST end with "— ${langLabel} (${config.language}) voice synthesis".
RULE E — NEVER translate dialogue to English. The text inside "character speaks ${langLabel}: ..." MUST be BYTE-FOR-BYTE IDENTICAL to the dialogue field. Any English translation is automatically WRONG.`;

  const prompt = `You are an expert Veo 3.1 prompt engineer. Convert script scenes into Veo 3.1 prompts.

══ PROJECT DNA (IMMUTABLE — USE EXACTLY AS GIVEN) ══
STYLE LOCK: ${styleLock}
VOICE LOCK: ${noDialogue ? 'no voice — silent film, no dialogue, no narration' : voiceLock}
DIALOGUE MODE: ${noDialogue ? 'NO DIALOGUE — completely silent' : `${langLabel} (${config.language})`}

CHARACTER DNA:
${charDNA || '(none)'}

ENVIRONMENT DNA:
${envDNA || '(none)'}

KEY OBJECT DNA:
${objDNA || '(none)'}

══ SCRIPT SECTION (SCENES ${fromScene}–${toScene}) ══
${scriptSection}

══ TASK ══
Generate EXACTLY ${toScene - fromScene + 1} scene objects for scenes ${fromScene} to ${toScene}.
Scene ${fromScene} timestamp starts at ${(fromScene - 1) * config.sceneDuration}s. Each scene = ${config.sceneDuration}s.
${dialogueRules}

⚠️ NO TEXT ON SCREEN (ABSOLUTE — NO EXCEPTIONS):
RULE F — NEVER include text overlays, captions, subtitles, watermarks, titles, labels, or any written text rendered visually on the frame. Even when a character speaks dialogue, the spoken text MUST be audio-only — it MUST NOT appear as subtitle, caption, or any readable text on the video frame. Dialogue is voice synthesis, NOT text overlay. Physical props (signs, books, documents) may be described as props but never as text rendered on screen.
RULE G — Every final_prompt MUST end with exactly this string (placed AFTER the dialogue clause if present): "no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only". This is mandatory even for scenes with no dialogue.
RULE H — Every final_prompt MUST be UNIQUE and VISUALLY DISTINCT from every other scene's final_prompt. STRICTLY FORBIDDEN: copying, recycling, or paraphrasing camera angles, actions, or descriptions from any other scene in this batch. Each scene must depict a visually different moment with a different camera angle, different character pose/action, different spatial composition, and different lighting/mood. If your output for one scene resembles any other scene, REWRITE it completely.

REQUIREMENTS:
1. 100% FAITHFUL REPRODUCTION — ABSOLUTE LAW: Each output scene MUST correspond exactly to the same-numbered scene in the script, in the same order. Copy VERBATIM: exact characters, exact setting, exact camera angles (as listed in the script's Shot list), exact action sequence, exact dialogue. Do NOT invent content not in the script. Do NOT combine two script scenes into one. Do NOT omit any scene. The LAST scene in your output MUST preserve the script's exact final emotional beat, final action, and final dialogue — never substitute a different ending.
2. shots[]: list each Shot from the script. Fields camera_angle, background, action MUST BE IN ENGLISH.
3. characters_in_scene / objects_in_scene: ONLY list IDs of entities that actually appear in this scene.
4. camera_angle: main camera angle for this scene in English (e.g. "Low angle wide shot", "Close-up", "Over-the-shoulder").
5. final_prompt: ONE SINGLE LINE, mostly English for Veo 3.1. Structure:
   ${noDialogue ? '' : `[${langLabel} voice], `}[STYLE LOCK], [CAMERA ANGLE], [SETTING from ENV DNA], [CHARACTER DNA for chars in scene], [ACTION from script], [LIGHTING/MOOD]${noDialogue ? '' : `, character speaks ${langLabel}: "[VERBATIM dialogue from dialogue field IN ${langLabel} — BYTE-FOR-BYTE IDENTICAL to dialogue field, NEVER an English translation]", spoken audio only`}, no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only
   ${noDialogue ? '— NO dialogue clause. NO "character speaks" anywhere.' : `— MUST start with "[${langLabel} voice]," — MUST have BOTH the language prefix AND the "character speaks ${langLabel}:" clause. The dialogue text inside quotes MUST be identical to the dialogue field.`}
6. audio_prompt: ${noDialogue ? 'describe ONLY SFX, BGM, ambient sounds in English. NO voice, NO speech, NO narration.' : `describe SFX, BGM, voice tone in English. MUST end with "— ${langLabel} (${config.language}) voice synthesis".`}
7. sfx_bgm: sound effects and background music description in English.
8. dialogue: ${noDialogue ? 'ALWAYS empty string "".' : `copy the EXACT dialogue from the script in ${langLabel}. NEVER translate. Empty string "" if no dialogue.`}
9. character_dna: object mapping each char_id present in scene → their FULL DNA prompt string (copy exactly from CHARACTER DNA above).
10. environment_dna: full DNA prompt string of the scene's environment (copy from ENVIRONMENT DNA above, matching environment_id).
11. objects_dna: object mapping each obj_id present in scene → their full DNA prompt string.
12. style_lock: copy the STYLE LOCK string exactly as given above.
13. title, location, setting_detail MUST BE IN ENGLISH.

Return a JSON array of exactly ${toScene - fromScene + 1} objects.`;

  const sceneSchema = {
    type: Type.OBJECT,
    required: ['scene_number', 'title', 'timestamp', 'location', 'setting_detail',
               'camera_angle', 'characters_in_scene', 'objects_in_scene', 'environment_id',
               'shots', 'dialogue', 'sfx_bgm', 'final_prompt', 'audio_prompt',
               'character_dna', 'environment_dna', 'objects_dna', 'style_lock'],
    properties: {
      scene_number:        { type: Type.INTEGER },
      title:               { type: Type.STRING },
      timestamp:           { type: Type.STRING },
      location:            { type: Type.STRING },
      setting_detail:      { type: Type.STRING },
      camera_angle:        { type: Type.STRING },
      characters_in_scene: { type: Type.ARRAY, items: { type: Type.STRING } },
      objects_in_scene:    { type: Type.ARRAY, items: { type: Type.STRING } },
      environment_id:      { type: Type.STRING },
      shots: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['shot_num', 'timestamp', 'camera_angle', 'background', 'action'],
          properties: {
            shot_num:     { type: Type.INTEGER },
            timestamp:    { type: Type.STRING },
            camera_angle: { type: Type.STRING },
            background:   { type: Type.STRING },
            action:       { type: Type.STRING }
          }
        }
      },
      dialogue:        { type: Type.STRING },
      sfx_bgm:         { type: Type.STRING },
      final_prompt:    { type: Type.STRING },
      audio_prompt:    { type: Type.STRING },
      character_dna:   { type: Type.OBJECT, additionalProperties: { type: Type.STRING } },
      environment_dna: { type: Type.STRING },
      objects_dna:     { type: Type.OBJECT, additionalProperties: { type: Type.STRING } },
      style_lock:      { type: Type.STRING }
    }
  };

  const result = await geminiJSON(apiKeys, prompt, { type: Type.ARRAY, items: sceneSchema }, 32768, onSwitch);
  if (!Array.isArray(result)) throw new Error(`Không tạo được cảnh ${fromScene}–${toScene}. AI trả sai định dạng.`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE BATCH — auto binary-splits on MAX_TOKENS, retries indefinitely
// Stops only on: 429 exhausted (all keys), SAFETY block, or single-scene failure
// ─────────────────────────────────────────────────────────────────────────────
async function generateScenesBatchAdaptive(apiKeys, config, dna, fromScene, toScene, onSwitch, onProgress) {
  const size = toScene - fromScene + 1;
  try {
    return await generateScenesBatch(apiKeys, config, dna, fromScene, toScene, onSwitch);
  } catch (err) {
    // 429 all-keys-exhausted → bubble up to user
    const is429 = (err.message || '').toLowerCase().includes('rate limit') || (err.message || '').includes('429');
    if (is429) throw err;

    // MAX_TOKENS → split in half and recurse
    if (err.isMaxTokens && size > 1) {
      const half = Math.floor(size / 2);
      const mid  = fromScene + half - 1;
      onProgress?.({
        phase: 'auto_split',
        message: `⚡ Tự động chia nhỏ: [${fromScene}–${mid}] + [${mid + 1}–${toScene}] (${size} → ${half} + ${size - half} cảnh/lần gọi)`
      });
      const left  = await generateScenesBatchAdaptive(apiKeys, config, dna, fromScene, mid,       onSwitch, onProgress);
      const right = await generateScenesBatchAdaptive(apiKeys, config, dna, mid + 1,  toScene,    onSwitch, onProgress);
      return [...left, ...right];
    }

    // Single-scene MAX_TOKENS (extremely rare — scene content too dense) → skip with placeholder
    if (err.isMaxTokens && size === 1) {
      onProgress?.({ phase: 'skip_scene', message: `⚠️ Cảnh ${fromScene} quá dài, bỏ qua và tiếp tục...` });
      return [{
        scene_number: fromScene, title: `Scene ${fromScene}`, timestamp: `${(fromScene-1)*config.sceneDuration}s`,
        location: '', setting_detail: '', camera_angle: '', characters_in_scene: [], objects_in_scene: [],
        environment_id: '', shots: [], dialogue: '', sfx_bgm: '', audio_prompt: '',
        final_prompt: `[Scene ${fromScene} — content too dense for single API call]`,
        character_dna: {}, environment_dna: '', objects_dna: {}, style_lock: dna.master_dna?.style_lock || '',
      }];
    }

    // Other errors (network, safety, etc.) → rethrow
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export async function generateCinematicPrompts(apiKeys, config, onProgress) {
  const totalScenes = config.quantity;

  // Key switch notification forwarded to progress handler
  const onSwitch = ({ fromIdx, toIdx, total }) => {
    onProgress?.({ phase: 'key_switch', message: `Key ${fromIdx + 1} bị giới hạn → Chuyển sang Key ${toIdx + 1}/${total}`, fromIdx, toIdx, total });
  };

  // ── Phase 1: DNA extraction ──
  onProgress?.({ phase: 'dna', message: 'Bước 1/2 — Đang đọc kịch bản & tạo DNA nhân vật, bối cảnh, vật thể...' });
  const dna = await extractScriptDNA(apiKeys, config, onSwitch);
  onProgress?.({ phase: 'dna_done', dna, message: `DNA hoàn tất: ${dna.characters.length} nhân vật, ${dna.environments.length} bối cảnh, ${dna.key_objects.length} vật thể.` });

  // ── Phase 2: Scene generation (adaptive chunked) ──
  // Each base chunk is SCENE_CHUNK scenes. If it hits MAX_TOKENS, the adaptive function
  // auto-splits it recursively until it fits. Runs indefinitely until 429 or success.
  const allScenes = [];
  const numChunks = Math.ceil(totalScenes / SCENE_CHUNK);

  for (let ci = 0; ci < numChunks; ci++) {
    const from = ci * SCENE_CHUNK + 1;
    const to   = Math.min((ci + 1) * SCENE_CHUNK, totalScenes);
    onProgress?.({
      phase: 'scenes',
      from, to, total: totalScenes,
      chunkIndex: ci, numChunks,
      message: `Bước 2/2 — Đang tạo prompt cảnh ${from}–${to} / ${totalScenes}...`
    });

    // Use adaptive function: auto-splits on MAX_TOKENS, retries until success or 429
    const batch = await generateScenesBatchAdaptive(apiKeys, config, dna, from, to, onSwitch, onProgress);
    // Ensure scene_number is correct even if AI skipped some
    batch.forEach((s, i) => { if (!s.scene_number || s.scene_number < from) s.scene_number = from + i; });
    allScenes.push(...batch);

    onProgress?.({ phase: 'batch_done', scenes: [...allScenes], from, to, total: totalScenes });
  }

  // ── Post-process: inject DNA into each scene (fallback if AI missed fields) ──
  allScenes.forEach(scene => {
    // character_dna fallback
    if (!scene.character_dna || Object.keys(scene.character_dna).length === 0) {
      scene.character_dna = {};
      (scene.characters_in_scene || []).forEach(id => {
        const c = dna.characters.find(x => x.id === id);
        if (c) scene.character_dna[id] = c.dna_prompt;
      });
    }
    // environment_dna fallback
    if (!scene.environment_dna) {
      const e = dna.environments.find(x => x.id === scene.environment_id)
             || dna.environments.find(x => scene.location && scene.location.toLowerCase().includes(x.name.toLowerCase()));
      if (e) scene.environment_dna = e.dna_prompt;
    }
    // objects_dna fallback
    if (!scene.objects_dna || Object.keys(scene.objects_dna).length === 0) {
      scene.objects_dna = {};
      (scene.objects_in_scene || []).forEach(id => {
        const o = dna.key_objects.find(x => x.id === id);
        if (o) scene.objects_dna[id] = o.dna_prompt;
      });
    }
    // style_lock fallback
    if (!scene.style_lock) scene.style_lock = dna.master_dna?.style_lock || '';
    // voice_lock inject
    if (!scene.voice_lock) scene.voice_lock = dna.master_dna?.voice_lock || '';
  });

  // ── Post-process: enforce language prefix in final_prompt ──
  const noDialogueMode = config.language === 'no-dialogue';
  if (!noDialogueMode) {
    const _LANG = {
      'vi-VN': 'Vietnamese', vi: 'Vietnamese',
      'en-US': 'English',    en: 'English',
      'ja-JP': 'Japanese',   ja: 'Japanese',
      'zh-CN': 'Chinese',    zh: 'Chinese',
      'ko-KR': 'Korean',     ko: 'Korean',
      'fr-FR': 'French',     fr: 'French',
      'es-ES': 'Spanish',    es: 'Spanish',
      'de-DE': 'German',     de: 'German',
      'th-TH': 'Thai',       th: 'Thai',
    };
    const _lang = _LANG[config.language] || _LANG[config.language?.split('-')[0]] || config.language;
    const prefix = `[${_lang} voice],`;
    allScenes.forEach(scene => {
      if (scene.final_prompt && !scene.final_prompt.startsWith(`[${_lang}`)) {
        scene.final_prompt = `${prefix} ${scene.final_prompt}`;
      }
    });
  }

  // ── Post-process: detect and log duplicate final_prompts ──
  const seenPrompts = new Map(); // prompt → first scene_number
  allScenes.forEach(scene => {
    const p = (scene.final_prompt || '').trim();
    if (seenPrompts.has(p)) {
      // Duplicate detected — append scene-specific differentiator to break the copy
      const firstScene = seenPrompts.get(p);
      scene.final_prompt = `${scene.final_prompt}, [scene ${scene.scene_number} — unique moment distinct from scene ${firstScene}]`;
    } else {
      seenPrompts.set(p, scene.scene_number);
    }
  });

  // ── Map to UI format ──
  const prompts = allScenes.map((scene, idx) => ({
    id:         `scene-${scene.scene_number || idx + 1}`,
    scene_id:   `scene-${scene.scene_number || idx + 1}`,
    title:      `Cảnh ${scene.scene_number || idx + 1}${scene.title ? ': ' + scene.title : ''}`,
    promptText: scene.final_prompt || '',
    description:scene.setting_detail || scene.location || '',
    status:     'idle',
    fullData:   scene,
  }));

  // ── Build analysis object (for UI display) ──
  const analysis = {
    topic_content:         dna.topic_content,
    characters:            dna.characters,
    key_objects:           dna.key_objects,
    overall_background:    dna.environments.map(e => e.description).join(' | '),
    visual_style_lighting: dna.master_dna?.style_lock || expandStyle(config.style),
    aspect_ratio_resolution: '16:9',
    master_dna: {
      character_locks:  {},
      object_locks:     {},
      environment_lock: dna.environments.map(e => e.dna_prompt).join(' | '),
      voice_lock:       dna.master_dna?.voice_lock       || '',
      style_lock:       dna.master_dna?.style_lock       || expandStyle(config.style),
    },
    specs: {
      total_duration: `${allScenes.length * config.sceneDuration}s`,
      pacing:         `${config.sceneDuration}s / cảnh`,
      total_scenes:   String(allScenes.length),
    },
    rules: { style: expandStyle(config.style), scene_location: 'Từ kịch bản', action: 'Từ kịch bản', sound: 'Từ kịch bản', dialogue: config.language },
    character_lock:   {},
    environment_lock: {},
    master_prompts:   { characters: [], environments: [], objects: [] },
    rawDna: dna,
  };

  dna.characters.forEach(c => {
    analysis.character_lock[c.id] = {
      id: c.id, name: c.name, description: c.dna_prompt, type: 'character',
      reference_sheet_prompt: c.dna_prompt,
      details: { gender: c.gender, age: c.age, nationality: c.nationality, appearance: c.appearance, outfit: c.outfit }
    };
  });
  dna.environments.forEach(e => {
    analysis.environment_lock[e.id] = { id: e.id, name: e.name, description: e.dna_prompt, type: 'environment' };
  });
  analysis.master_prompts.characters  = dna.characters.map(c  => ({ id: c.id,  name: c.name,  prompt: c.dna_prompt }));
  analysis.master_prompts.environments= dna.environments.map(e => ({ id: e.id,  name: e.name,  prompt: e.dna_prompt }));
  analysis.master_prompts.objects     = dna.key_objects.map(o  => ({ id: o.id,  name: o.name,  prompt: o.dna_prompt }));

  // ── Full JSON for download ──
  const fullJson = {
    metadata: {
      style: config.style, language: config.language,
      total_scenes: allScenes.length, scene_duration: config.sceneDuration,
      total_duration: `${allScenes.length * config.sceneDuration}s`,
    },
    dna: { characters: dna.characters, environments: dna.environments, key_objects: dna.key_objects, master_dna: dna.master_dna },
    scenes: allScenes,
  };

  return { prompts, analysis, fullJson };
}
