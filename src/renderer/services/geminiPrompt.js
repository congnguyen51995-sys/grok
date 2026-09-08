import { GoogleGenAI, Type } from "@google/genai";
import { retryWithKeyRotation } from './keyRotation.js';

let GEMINI_MODEL = 'gemini-3.5-flash';
export function setGeminiPromptModel(model) { if (model) GEMINI_MODEL = model; }
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

// ─── Exported prompt builders — identical prompts reused by claudePrompt.js ──
export function buildDNAPrompt(config) {
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
  return `You are a master filmmaker and story analyst. Read the following script/audio transcript VERY CAREFULLY as a COMPLETE STORY, then extract everything needed to craft a cohesive, cinematic film.

${assetHint.length ? assetHint.join('\n') + '\n\n' : ''}SCRIPT / AUDIO TRANSCRIPT:
${config.subject}

STYLE: ${expandStyle(config.style)}
DIALOGUE MODE: ${noDialogue ? 'NO DIALOGUE — all scenes are completely silent, no voice, no speech' : `DIALOGUE LANGUAGE: ${config.language}`}

═══ PHASE 1: HOLISTIC STORY ANALYSIS ═══

Read the ENTIRE script first. Understand:
- What is the CORE EMOTIONAL JOURNEY? (What does the audience feel by the end?)
- What is the THEMATIC SPINE? (The central idea/message driving every scene)
- What STORY ARC is being told? (Setup → Conflict → Climax → Resolution)
- How does each CHARACTER CHANGE or reveal themselves through what they SAY?
- What VISUAL MOTIFS recur and connect scenes?

═══ PHASE 2: EXTRACT DNA ═══

TASK — Create DNA reference sheets for:
1. MAIN CHARACTERS ONLY — maximum 5 characters total, ordered by importance. Only include characters who appear in multiple scenes. Skip minor/background characters. Code names: char_1, char_2, char_3... in order of importance.
2. KEY ENVIRONMENTS — maximum 3 distinct locations (most important only).
3. KEY OBJECTS/PROPS — maximum 5 objects total (NOT living beings — weapons, vehicles, magical items, etc.). Only objects that repeat across multiple scenes.

⚠️ STRICT LIMIT: characters array MAX 5 items. key_objects array MAX 5 items. environments array MAX 3 items.

⚠️ CRITICAL LANGUAGE RULE: ALL output fields MUST be 100% ENGLISH ONLY.
- NO Vietnamese, NO Japanese, NO Chinese, NO Korean, NO any non-English text in ANY field.
- If the script/style is in another language, TRANSLATE everything to English.
- Only "voice_lock" may mention the language code (e.g. "ja-JP narrator voice").

RULES:
- Character DNA: First determine if the character is HUMAN or ANIMAL/CREATURE.
  • If HUMAN: nationality, gender, age, face details (shape, jaw, nose, eyes, eyebrows), hair (color, style, length), skin tone, body type/height/posture, EXACT outfit (colors, materials, style), accessories/weapons/props always carried.
  • If ANIMAL/CREATURE: species, breed, size, fur/feather/skin exact color and pattern, eye color, distinctive physical features (scars, markings), any accessories worn.
- dna_prompt: ENGLISH ONLY, ONE LINE, Veo 3.1 compatible. Use char_X code names NOT real names.
- dna_prompt for HUMAN character: "Multi-angle character turnaround reference sheet, 8 panels arranged in 2 rows of 4: TOP ROW — [front face portrait] [left side profile] [back head view] [right side profile]; BOTTOM ROW — [full body front facing] [full body 3/4 left turn] [full body back view] [full body 3/4 right turn]. Plain pure white studio background, no scene, no props except character's own accessories. CHARACTER: [char_X], [full appearance including exact hair color/style/length], [exact outfit with colors and materials], [skin tone, eye color, distinctive features]. Same character rendered consistently across all 8 angles. Professional character design turnaround sheet. ${expandStyle(config.style)}. No text labels, no arrows, no annotations, no captions, no watermarks, no on-screen text."
- dna_prompt for ANIMAL/CREATURE character: "Multi-angle animal turnaround reference sheet, 8 panels arranged in 2 rows of 4: TOP ROW — [front face close-up] [left head profile] [back head view] [right head profile]; BOTTOM ROW — [full body front] [full body 3/4 left] [full body back] [full body 3/4 right]. Plain pure white background. ANIMAL: [exact species and breed], [exact fur/feather/skin color and pattern], [eye color], [size and build], [distinctive markings or accessories]. Same animal consistently across all 8 panels. Professional character design reference sheet. ${expandStyle(config.style)}. No text labels, no arrows, no annotations, no captions, no watermarks, no on-screen text."
- Environment DNA: location type, architecture/natural features, color palette, lighting conditions, time of day, atmosphere keywords. ALL IN ENGLISH.
- Object DNA: exact shape, material, color, size, distinctive marks. ALL IN ENGLISH.
- style_lock: MUST copy EXACTLY this style string and nothing else: "${expandStyle(config.style)}". Do NOT paraphrase, shorten, or add words.
- voice_lock: ${noDialogue ? '"no voice — silent film, no dialogue, no narration"' : 'voice character for dialogue (tone, accent, language code only)'}.

═══ PHASE 3: STORY ARC MAPPING ═══

Analyze the COMPLETE NARRATIVE ARC and map it to scenes. For story_arc field:
- theme: The single core thematic statement of this story (1 sentence)
- emotional_journey: The complete emotional arc from first to last scene (e.g. "hope → doubt → despair → redemption")
- acts: Array of 3 acts. Each act has: act_number (1/2/3), name (e.g. "Setup", "Confrontation", "Resolution"), scene_range (e.g. "1-5"), description (what happens), dominant_emotion, visual_tone
- narrative_beats: Array of KEY story beats (turning points, emotional peaks). Each beat: scene_number (which scene), beat_type ("inciting_incident"|"rising_action"|"midpoint"|"dark_moment"|"climax"|"resolution"), description, dialogue_anchor (the EXACT line of dialogue from the script that triggers/marks this beat — empty string if none)
- character_arcs: Object mapping char_id → { arc: "character's journey in 1 sentence", starts_as: "emotional/psychological state at scene 1", ends_as: "state at final scene", key_moment_scene: scene number where their arc turns }
- visual_motifs: Array of recurring visual symbols/themes that should appear across scenes (max 3). Each: motif, meaning, how_to_show

⚠️ NO TEXT ON SCREEN RULE (ABSOLUTE): NEVER include text overlays, captions, subtitles, watermarks, titles, labels, or any written text rendered on the visual frame in ANY prompt. End every dna_prompt with "no text, no captions, no watermarks, no on-screen text".

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{"topic_content":"...","characters":[{"id":"char_1","name":"...","role":"...","gender":"...","age":"...","nationality":"...","appearance":"...","outfit":"...","dna_prompt":"..."}],"environments":[{"id":"env_1","name":"...","description":"...","dna_prompt":"..."}],"key_objects":[{"id":"obj_1","name":"...","description":"...","dna_prompt":"..."}],"master_dna":{"style_lock":"...","voice_lock":"..."},"story_arc":{"theme":"...","emotional_journey":"...","acts":[{"act_number":1,"name":"...","scene_range":"...","description":"...","dominant_emotion":"...","visual_tone":"..."}],"narrative_beats":[{"scene_number":1,"beat_type":"inciting_incident","description":"...","dialogue_anchor":"..."}],"character_arcs":{"char_1":{"arc":"...","starts_as":"...","ends_as":"...","key_moment_scene":1}},"visual_motifs":[{"motif":"...","meaning":"...","how_to_show":"..."}]}}`;
}

export function buildScenesPrompt(config, dna, fromScene, toScene) {
  const charDNA    = dna.characters.map(c => `${c.id} (${c.name}): ${c.dna_prompt}`).join('\n');
  const envDNA     = dna.environments.map(e => `${e.id} (${e.name}): ${e.dna_prompt}`).join('\n');
  const objDNA     = dna.key_objects.map(o => `${o.id} (${o.name}): ${o.dna_prompt}`).join('\n');
  const styleLock  = dna.master_dna?.style_lock || expandStyle(config.style);
  const voiceLock  = dna.master_dna?.voice_lock || 'natural voice';
  const noDialogue = config.language === 'no-dialogue';

  // Build story arc context block
  const arc = dna.story_arc;
  let storyArcBlock = '';
  if (arc) {
    const currentAct = arc.acts?.find(a => {
      const [s, e] = (a.scene_range || '').split('-').map(Number);
      return fromScene >= s && fromScene <= (e || s);
    }) || arc.acts?.find(a => {
      const [s] = (a.scene_range || '').split('-').map(Number);
      return fromScene >= s;
    });
    const beatsInRange = arc.narrative_beats?.filter(b => b.scene_number >= fromScene && b.scene_number <= toScene) || [];
    const motifs = arc.visual_motifs || [];

    storyArcBlock = `
══ STORY ARC (FILM CONTINUITY — MANDATORY) ══
THEME: ${arc.theme || ''}
EMOTIONAL JOURNEY: ${arc.emotional_journey || ''}
${currentAct ? `CURRENT ACT: Act ${currentAct.act_number} — "${currentAct.name}" | Emotion: ${currentAct.dominant_emotion} | Visual tone: ${currentAct.visual_tone}
Act description: ${currentAct.description}` : ''}
${beatsInRange.length ? `NARRATIVE BEATS IN THIS BATCH:
${beatsInRange.map(b => `  Scene ${b.scene_number} [${b.beat_type.toUpperCase()}]: ${b.description}${b.dialogue_anchor ? `\n    → Dialogue anchor: "${b.dialogue_anchor}"` : ''}`).join('\n')}` : ''}
${motifs.length ? `VISUAL MOTIFS TO WEAVE IN (where appropriate):
${motifs.map(m => `  • ${m.motif}: ${m.meaning} → show as: ${m.how_to_show}`).join('\n')}` : ''}
CHARACTER ARCS:
${dna.characters.map(c => {
  const a = arc.character_arcs?.[c.id];
  return a ? `  ${c.id} (${c.name}): ${a.arc} | Now at scene ${fromScene}: ${fromScene <= (a.key_moment_scene || 999) ? a.starts_as : a.ends_as}` : `  ${c.id} (${c.name}): consistent across all scenes`;
}).join('\n')}

⚠️ FILM CONTINUITY LAW:
- Every scene must SERVE the story arc above. The visual content must EXPRESS the emotional state of the characters at that story moment.
- When a character says something in dialogue, the VISUALS must ILLUSTRATE or CONTRAST what they mean — not just show them talking. Show the SUBTEXT.
- Scenes must feel CONNECTED: lighting and color should reflect the current act's visual tone. Characters should show their arc state (are they hopeful? desperate? transformed?).
- Transitions matter: each scene should feel like it GROWS FROM the previous one and LEADS INTO the next.`;
  }
  const LANG_NAME_MAP = {
    'vi-VN': 'Vietnamese', vi: 'Vietnamese', 'en-US': 'English', en: 'English',
    'ja-JP': 'Japanese',   ja: 'Japanese',   'zh-CN': 'Chinese', zh: 'Chinese',
    'ko-KR': 'Korean',     ko: 'Korean',     'fr-FR': 'French',  fr: 'French',
    'es-ES': 'Spanish',    es: 'Spanish',    'de-DE': 'German',  de: 'German',
    'th-TH': 'Thai',       th: 'Thai',
  };
  const langLabel     = LANG_NAME_MAP[config.language] || LANG_NAME_MAP[config.language?.split('-')[0]] || config.language;
  const scriptSection = extractSceneSection(config.subject, fromScene, toScene);
  const count         = toScene - fromScene + 1;

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
RULE C — "final_prompt" audio rules — TWO CASES, apply based on whether dialogue field is empty:
  • Scene WITH dialogue (dialogue ≠ ""): final_prompt MUST START with "[${langLabel} voice]," AND append EXACTLY: , character speaks ${langLabel}: "[BYTE-FOR-BYTE IDENTICAL text from the dialogue field — MUST be ${langLabel} script characters, ABSOLUTELY NEVER translated to English]", spoken audio only. ⚠️ Veo 3.1 synthesizes voice from the text in those quotes — English text = English voice, ${langLabel} text = ${langLabel} voice.
  • Scene WITHOUT dialogue (dialogue = ""): do NOT add "[${langLabel} voice]," prefix at all. Do NOT add any "character speaks" clause. End the prompt with: natural ambient sounds only, no speech, no voice narration.
RULE D — "audio_prompt": MUST end with "— ${langLabel} (${config.language}) voice synthesis".
RULE E — NEVER translate dialogue to English. The text inside "character speaks ${langLabel}: ..." MUST be BYTE-FOR-BYTE IDENTICAL to the dialogue field. Any English translation is automatically WRONG.`;

  return `You are a master filmmaker AND Veo 3.1 prompt engineer. Your job is to convert this script into a COHESIVE FILM — not a series of disconnected clips, but scenes that flow together with narrative depth, consistent characters, and visuals that honor what the dialogue truly means.
${storyArcBlock}
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
Generate EXACTLY ${count} scene objects for scenes ${fromScene} to ${toScene}.
Scene ${fromScene} timestamp starts at ${(fromScene - 1) * config.sceneDuration}s. Each scene = ${config.sceneDuration}s.
${dialogueRules}

🚫 VEO CONTENT POLICY (MANDATORY — ZERO EXCEPTIONS):
RULE POLICY — ALL final_prompt values MUST comply with Google Veo's content policy. You MUST NOT generate prompts that describe: graphic violence, blood, gore, weapons used violently, murder, torture, execution, decapitation, or any other graphic harm; adult/sexual content, nudity, explicit or erotic scenes; hate speech, racism, discrimination; drug use or manufacture; terrorism, bombs, mass violence. Instead, describe scenes in a cinematic, tasteful, family-friendly manner. Replace any sensitive content with neutral, safe alternatives (e.g., "intense confrontation" instead of "bloody fight", "dramatic tension" instead of "murder scene"). Every prompt MUST be suitable for general audiences.

⚠️ NO TEXT ON SCREEN (ABSOLUTE — NO EXCEPTIONS):
RULE F — NEVER include text overlays, captions, subtitles, watermarks, titles, labels, or any written text rendered visually on the frame. Even when a character speaks dialogue, the spoken text MUST be audio-only — it MUST NOT appear as subtitle, caption, or any readable text on the video frame. Dialogue is voice synthesis, NOT text overlay. Physical props (signs, books, documents) may be described as props but never as text rendered on screen.
RULE G — final_prompt closing tail (mandatory for ALL scenes — two variants):
  • Scene WITH dialogue: end with "spoken audio only, no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only"
  • Scene WITHOUT dialogue: end with "natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text"
  ⚠️ NEVER append "spoken audio only" to a silent scene — it causes Veo to generate random speech.
RULE H — Every final_prompt MUST be UNIQUE and VISUALLY DISTINCT from every other scene's final_prompt. STRICTLY FORBIDDEN: copying, recycling, or paraphrasing camera angles, actions, or descriptions from any other scene in this batch. Each scene must depict a visually different moment with a different camera angle, different character pose/action, different spatial composition, and different lighting/mood. If your output for one scene resembles any other scene, REWRITE it completely.

REQUIREMENTS:
1. 100% FAITHFUL REPRODUCTION — ABSOLUTE LAW: Each output scene MUST correspond exactly to the same-numbered scene in the script, in the same order. Copy VERBATIM: exact characters, exact setting, exact camera angles (as listed in the script's Shot list), exact action sequence, exact dialogue. Do NOT invent content not in the script. Do NOT combine two script scenes into one. Do NOT omit any scene. The LAST scene in your output MUST preserve the script's exact final emotional beat, final action, and final dialogue — never substitute a different ending.

2. VISUAL-DIALOGUE ALIGNMENT (CINEMATIC LAW — THIS IS WHAT MAKES A REAL FILM):
   When a character speaks, ask: "What does this line of dialogue MEAN emotionally? What does the speaker REALLY want? What does the listener FEEL?"
   Then encode THAT meaning into the visuals:
   • If dialogue = declaration of love → show intimate closeness, warm light, soft focus on eyes
   • If dialogue = a lie → show the liar avoiding eye contact, tight close-up on subtle tension
   • If dialogue = grief → environment reflects sadness (rain, cold light, empty space)
   • If dialogue = determination → low angle shot empowering the character, strong harsh lighting
   • If dialogue = revelation/twist → wide shot showing new spatial relationship, jarring camera angle
   The visual prompt must SHOW what the dialogue MEANS — not just describe talking heads.

3. SCENE CONTINUITY: Each scene's visual_tone, lighting, and character emotional state must reflect:
   a) WHERE in the story arc this scene falls (which act, which narrative beat)
   b) Character arc state — if char is in despair at this point, show it in their posture, environment, lighting
   c) Visual motifs — weave in the story's recurring symbols where they fit naturally

4. shots[]: list each Shot from the script. Fields camera_angle, background, action MUST BE IN ENGLISH.
5. characters_in_scene / objects_in_scene: ONLY list IDs of entities that actually appear in this scene.
6. camera_angle: main camera angle for this scene in English (e.g. "Low angle wide shot", "Close-up", "Over-the-shoulder"). Choose angles that EXPRESS the emotional state of the scene, not just describe position.
7. final_prompt: ONE SINGLE LINE, mostly English for Veo 3.1. Two structures based on dialogue:
   ${noDialogue ? `NO DIALOGUE: [STORY ARC VISUAL TONE], [STYLE LOCK], [CAMERA ANGLE expressing scene emotion], [SETTING from ENV DNA], [CHARACTER DNA for chars in scene showing their arc state], [ACTION from script], [LIGHTING/MOOD matching current act], natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text
   — NO language prefix. NO "character speaks". NO "spoken audio only".` : `If dialogue ≠ "":  [${langLabel} voice], [STYLE LOCK], [CAMERA ANGLE expressing emotion], [SETTING from ENV DNA], [CHARACTER DNA for chars in scene showing their arc state], [ACTION from script — show what dialogue MEANS visually], [LIGHTING/MOOD matching current act], character speaks ${langLabel}: "[VERBATIM dialogue IN ${langLabel} — BYTE-FOR-BYTE IDENTICAL to dialogue field, NEVER English]", spoken audio only, no text, no captions, no subtitles, no watermarks, no on-screen text, no dialogue text overlay, spoken audio only
   If dialogue = "":  [STORY ARC VISUAL TONE], [STYLE LOCK], [CAMERA ANGLE], [SETTING from ENV DNA], [CHARACTER DNA for chars in scene], [ACTION from script], [LIGHTING/MOOD matching current act and character emotional state], natural ambient sounds only, no speech, no voice narration, no text, no captions, no subtitles, no watermarks, no on-screen text
   ⚠️ CRITICAL: If dialogue = "" → absolutely NO "[${langLabel} voice]," prefix, NO "character speaks", NO "spoken audio only". Adding "spoken audio only" to silent scenes causes Veo to invent random speech.`}
8. audio_prompt: ${noDialogue ? 'describe ONLY SFX, BGM, ambient sounds in English. NO voice, NO speech, NO narration.' : `describe SFX, BGM, voice tone in English. MUST end with "— ${langLabel} (${config.language}) voice synthesis".`}
9. sfx_bgm: sound effects and background music description in English. Music mood must match the current act's dominant emotion.
10. dialogue: ${noDialogue ? 'ALWAYS empty string "".' : `copy the EXACT dialogue from the script in ${langLabel}. NEVER translate. Empty string "" if no dialogue.`}
11. character_dna: object mapping each char_id present in scene → their FULL DNA prompt string (copy exactly from CHARACTER DNA above).
12. environment_dna: full DNA prompt string of the scene's environment (copy from ENVIRONMENT DNA above, matching environment_id).
13. objects_dna: object mapping each obj_id present in scene → their full DNA prompt string.
14. style_lock: copy the STYLE LOCK string exactly as given above.
15. narrative_context: ONE sentence (English) explaining WHERE this scene sits in the story arc and WHAT EMOTIONAL/NARRATIVE PURPOSE it serves. (e.g. "Act 2 rising action — char_1 confronts their fear for the first time, setting up the dark moment in scene 12")
16. title, location, setting_detail MUST BE IN ENGLISH.

Return a JSON array of exactly ${count} objects. No markdown fences, no extra text.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Extract full DNA from the script
// ─────────────────────────────────────────────────────────────────────────────
async function extractScriptDNA(apiKeys, config, onSwitch) {
  const prompt = buildDNAPrompt(config);
  try {
    return await geminiJSON(apiKeys, prompt, {
      type: Type.OBJECT,
      required: ['topic_content', 'characters', 'environments', 'key_objects', 'master_dna'],
      properties: {
        topic_content: { type: Type.STRING },
        characters: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['id','name','role','gender','age','nationality','appearance','outfit','dna_prompt'], properties: { id:{type:Type.STRING},name:{type:Type.STRING},role:{type:Type.STRING},gender:{type:Type.STRING},age:{type:Type.STRING},nationality:{type:Type.STRING},appearance:{type:Type.STRING},outfit:{type:Type.STRING},dna_prompt:{type:Type.STRING} } } },
        environments: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['id','name','description','dna_prompt'], properties: { id:{type:Type.STRING},name:{type:Type.STRING},description:{type:Type.STRING},dna_prompt:{type:Type.STRING} } } },
        key_objects:  { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['id','name','description','dna_prompt'], properties: { id:{type:Type.STRING},name:{type:Type.STRING},description:{type:Type.STRING},dna_prompt:{type:Type.STRING} } } },
        master_dna: { type: Type.OBJECT, required: ['style_lock','voice_lock'], properties: { style_lock:{type:Type.STRING},voice_lock:{type:Type.STRING} } },
        story_arc: { type: Type.OBJECT, properties: {
          theme: { type: Type.STRING },
          emotional_journey: { type: Type.STRING },
          acts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { act_number:{type:Type.INTEGER}, name:{type:Type.STRING}, scene_range:{type:Type.STRING}, description:{type:Type.STRING}, dominant_emotion:{type:Type.STRING}, visual_tone:{type:Type.STRING} } } },
          narrative_beats: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { scene_number:{type:Type.INTEGER}, beat_type:{type:Type.STRING}, description:{type:Type.STRING}, dialogue_anchor:{type:Type.STRING} } } },
          character_arcs: { type: Type.OBJECT, additionalProperties: { type: Type.OBJECT, properties: { arc:{type:Type.STRING}, starts_as:{type:Type.STRING}, ends_as:{type:Type.STRING}, key_moment_scene:{type:Type.INTEGER} } } },
          visual_motifs: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { motif:{type:Type.STRING}, meaning:{type:Type.STRING}, how_to_show:{type:Type.STRING} } } }
        } }
      }
    }, 12288, onSwitch);
  } catch (err) {
    if (err.isMaxTokens) {
      const truncated = config.subject.length > 3000
        ? config.subject.substring(0, 3000) + '\n...[truncated for DNA extraction]'
        : config.subject;
      if (truncated === config.subject) throw err;
      const truncatedConfig = { ...config, subject: truncated };
      return await geminiJSON(apiKeys, buildDNAPrompt(truncatedConfig), {
        type: Type.OBJECT, required: ['topic_content','characters','environments','key_objects','master_dna'],
        properties: { topic_content:{type:Type.STRING}, characters:{type:Type.ARRAY,items:{type:Type.OBJECT,required:['id','name','role','gender','age','nationality','appearance','outfit','dna_prompt'],properties:{id:{type:Type.STRING},name:{type:Type.STRING},role:{type:Type.STRING},gender:{type:Type.STRING},age:{type:Type.STRING},nationality:{type:Type.STRING},appearance:{type:Type.STRING},outfit:{type:Type.STRING},dna_prompt:{type:Type.STRING}}}}, environments:{type:Type.ARRAY,items:{type:Type.OBJECT,required:['id','name','description','dna_prompt'],properties:{id:{type:Type.STRING},name:{type:Type.STRING},description:{type:Type.STRING},dna_prompt:{type:Type.STRING}}}}, key_objects:{type:Type.ARRAY,items:{type:Type.OBJECT,required:['id','name','description','dna_prompt'],properties:{id:{type:Type.STRING},name:{type:Type.STRING},description:{type:Type.STRING},dna_prompt:{type:Type.STRING}}}}, master_dna:{type:Type.OBJECT,required:['style_lock','voice_lock'],properties:{style_lock:{type:Type.STRING},voice_lock:{type:Type.STRING}}}, story_arc:{type:Type.OBJECT,properties:{theme:{type:Type.STRING},emotional_journey:{type:Type.STRING},acts:{type:Type.ARRAY,items:{type:Type.OBJECT,properties:{act_number:{type:Type.INTEGER},name:{type:Type.STRING},scene_range:{type:Type.STRING},description:{type:Type.STRING},dominant_emotion:{type:Type.STRING},visual_tone:{type:Type.STRING}}}},narrative_beats:{type:Type.ARRAY,items:{type:Type.OBJECT,properties:{scene_number:{type:Type.INTEGER},beat_type:{type:Type.STRING},description:{type:Type.STRING},dialogue_anchor:{type:Type.STRING}}}},character_arcs:{type:Type.OBJECT,additionalProperties:{type:Type.OBJECT,properties:{arc:{type:Type.STRING},starts_as:{type:Type.STRING},ends_as:{type:Type.STRING},key_moment_scene:{type:Type.INTEGER}}}},visual_motifs:{type:Type.ARRAY,items:{type:Type.OBJECT,properties:{motif:{type:Type.STRING},meaning:{type:Type.STRING},how_to_show:{type:Type.STRING}}}}}} }
      }, 12288, onSwitch);
    }
    throw err;
  }
}

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
  const prompt = buildScenesPrompt(config, dna, fromScene, toScene);

  const sceneSchema = {
    type: Type.OBJECT,
    required: ['scene_number', 'title', 'timestamp', 'location', 'setting_detail',
               'camera_angle', 'characters_in_scene', 'objects_in_scene', 'environment_id',
               'shots', 'dialogue', 'sfx_bgm', 'final_prompt', 'audio_prompt',
               'character_dna', 'environment_dna', 'objects_dna', 'style_lock', 'narrative_context'],
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
      dialogue:          { type: Type.STRING },
      sfx_bgm:           { type: Type.STRING },
      final_prompt:      { type: Type.STRING },
      audio_prompt:      { type: Type.STRING },
      character_dna:     { type: Type.OBJECT, additionalProperties: { type: Type.STRING } },
      environment_dna:   { type: Type.STRING },
      objects_dna:       { type: Type.OBJECT, additionalProperties: { type: Type.STRING } },
      style_lock:        { type: Type.STRING },
      narrative_context: { type: Type.STRING }
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
  const arc = dna.story_arc || {};
  const analysis = {
    topic_content:         dna.topic_content,
    characters:            dna.characters,
    key_objects:           dna.key_objects,
    overall_background:    dna.environments.map(e => e.description).join(' | '),
    visual_style_lighting: dna.master_dna?.style_lock || expandStyle(config.style),
    aspect_ratio_resolution: '16:9',
    story_arc: arc,
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
      theme:          arc.theme || '',
      emotional_journey: arc.emotional_journey || '',
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
