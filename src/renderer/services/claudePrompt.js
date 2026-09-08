/**
 * claudePrompt.js
 * Claude equivalents for geminiPrompt.js and audioToVideo.js analyzeScenes.
 *
 * Uses IDENTICAL prompts (via buildDNAPrompt / buildScenesPrompt from geminiPrompt.js)
 * so Claude and Gemini produce the same style of output.
 * Claude does not enforce JSON schema — we parse the returned text manually.
 */

import { callClaudeWithRetry, callClaudeVision, DEFAULT_CLAUDE_MODEL } from './claudeService.js';
import { buildDNAPrompt, buildScenesPrompt, expandStyle } from './geminiPrompt.js';

export { callClaudeVision } from './claudeService.js';

const SCENE_CHUNK = 6; // smaller than Gemini — Claude handles fewer at once reliably

// ─── JSON parse helper ────────────────────────────────────────────────────────
function extractJSON(raw) {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  const match   = cleaned.match(/[\[\{][\s\S]*/);
  if (!match) throw new Error('Claude: không parse được JSON');
  return JSON.parse(match[0]);
}

// ─── Phase 1: DNA extraction — uses buildDNAPrompt (identical to Gemini) ────
async function extractDNAClaude({ apiKey, model, config }) {
  const prompt = buildDNAPrompt(config);
  const system = 'You are a professional video production analyst. Output ONLY valid JSON — no markdown fences, no extra text.';

  let raw;
  try {
    raw = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: 8192, temperature: 0 });
  } catch (err) {
    // Script too long → retry with truncated input (same fallback as Gemini)
    if (config.subject.length > 3000) {
      const truncatedConfig = { ...config, subject: config.subject.substring(0, 3000) + '\n...[truncated for DNA extraction]' };
      raw = await callClaudeWithRetry({ apiKey, model, system, prompt: buildDNAPrompt(truncatedConfig), maxTokens: 8192, temperature: 0 });
    } else throw err;
  }

  return extractJSON(raw);
}

// ─── Phase 2: Scene batch — uses buildScenesPrompt (identical to Gemini) ─────
async function generateScenesBatchClaude({ apiKey, model, config, dna, fromScene, toScene }) {
  const prompt = buildScenesPrompt(config, dna, fromScene, toScene);
  const count  = toScene - fromScene + 1;
  const system = 'You are an expert Veo 3.1 prompt engineer. Output ONLY a valid JSON array — no markdown fences, no extra text.';

  const raw     = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: count * 800, temperature: 0.7 });
  const scenes  = extractJSON(raw);
  if (!Array.isArray(scenes)) throw new Error(`Claude: kết quả cảnh ${fromScene}–${toScene} không phải array`);
  return scenes;
}

// ─── MAIN: generateCinematicPromptsClaude ────────────────────────────────────
// Drop-in replacement for generateCinematicPrompts (geminiPrompt.js)
// Same call signature + same return shape { prompts, analysis, fullJson }
export async function generateCinematicPromptsClaude(apiKey, config, onProgress, model = DEFAULT_CLAUDE_MODEL) {
  const totalScenes = config.quantity;

  // Phase 1: DNA
  onProgress?.({ phase: 'dna', message: '🤖 Claude — Bước 1/2: Đang phân tích kịch bản & tạo DNA nhân vật...' });
  const dna = await extractDNAClaude({ apiKey, model, config });
  onProgress?.({
    phase: 'dna_done', dna,
    message: `✅ DNA hoàn tất: ${dna.characters?.length ?? 0} nhân vật, ${dna.environments?.length ?? 0} bối cảnh`,
  });

  // Phase 2: Scenes in sequential batches
  const allScenes = [];
  const numChunks = Math.ceil(totalScenes / SCENE_CHUNK);

  for (let ci = 0; ci < numChunks; ci++) {
    const from = ci * SCENE_CHUNK + 1;
    const to   = Math.min((ci + 1) * SCENE_CHUNK, totalScenes);
    onProgress?.({
      phase: 'scenes', from, to, total: totalScenes,
      chunkIndex: ci, numChunks,
      message: `🤖 Claude — Bước 2/2: Đang tạo prompt cảnh ${from}–${to} / ${totalScenes}...`,
    });

    const batch = await generateScenesBatchClaude({ apiKey, model, config, dna, fromScene: from, toScene: to });
    batch.forEach((s, i) => { if (!s.scene_number) s.scene_number = from + i; });
    allScenes.push(...batch);

    onProgress?.({ phase: 'batch_done', scenes: [...allScenes], from, to, total: totalScenes });
  }

  // Post-process: same as geminiPrompt.js
  allScenes.forEach(scene => {
    if (!scene.character_dna || Object.keys(scene.character_dna).length === 0) {
      scene.character_dna = {};
      (scene.characters_in_scene || []).forEach(id => {
        const c = dna.characters?.find(x => x.id === id);
        if (c) scene.character_dna[id] = c.dna_prompt;
      });
    }
    if (!scene.environment_dna) {
      const e = dna.environments?.find(x => x.id === scene.environment_id)
             || dna.environments?.find(x => scene.location && scene.location.toLowerCase().includes(x.name.toLowerCase()));
      if (e) scene.environment_dna = e.dna_prompt;
    }
    if (!scene.objects_dna || Object.keys(scene.objects_dna).length === 0) {
      scene.objects_dna = {};
      (scene.objects_in_scene || []).forEach(id => {
        const o = dna.key_objects?.find(x => x.id === id);
        if (o) scene.objects_dna[id] = o.dna_prompt;
      });
    }
    if (!scene.style_lock) scene.style_lock = dna.master_dna?.style_lock || '';
    if (!scene.voice_lock) scene.voice_lock = dna.master_dna?.voice_lock || '';
  });

  // Enforce language prefix (same as geminiPrompt.js post-process)
  const noDialogueMode = config.language === 'no-dialogue';
  if (!noDialogueMode) {
    const _LANG = {
      'vi-VN': 'Vietnamese', vi: 'Vietnamese', 'en-US': 'English', en: 'English',
      'ja-JP': 'Japanese',   ja: 'Japanese',   'zh-CN': 'Chinese', zh: 'Chinese',
      'ko-KR': 'Korean',     ko: 'Korean',     'fr-FR': 'French',  fr: 'French',
      'es-ES': 'Spanish',    es: 'Spanish',    'de-DE': 'German',  de: 'German',
      'th-TH': 'Thai',       th: 'Thai',
    };
    const _lang  = _LANG[config.language] || _LANG[config.language?.split('-')[0]] || config.language;
    const prefix = `[${_lang} voice],`;
    allScenes.forEach(scene => {
      if (scene.dialogue && scene.final_prompt && !scene.final_prompt.startsWith(`[${_lang}`)) {
        scene.final_prompt = `${prefix} ${scene.final_prompt}`;
      }
    });
  }

  // Detect duplicate final_prompts (same as geminiPrompt.js)
  const seenPrompts = new Map();
  allScenes.forEach(scene => {
    const p = (scene.final_prompt || '').trim();
    if (seenPrompts.has(p)) {
      const firstScene = seenPrompts.get(p);
      scene.final_prompt = `${scene.final_prompt}, [scene ${scene.scene_number} — unique moment distinct from scene ${firstScene}]`;
    } else {
      seenPrompts.set(p, scene.scene_number);
    }
  });

  // Map to UI format (same as geminiPrompt.js)
  const prompts = allScenes.map((scene, idx) => ({
    id:          `scene-${scene.scene_number || idx + 1}`,
    scene_id:    `scene-${scene.scene_number || idx + 1}`,
    title:       `Cảnh ${scene.scene_number || idx + 1}${scene.title ? ': ' + scene.title : ''}`,
    promptText:  scene.final_prompt || '',
    description: scene.setting_detail || scene.location || '',
    status:      'idle',
    fullData:    scene,
  }));

  const analysis = {
    topic_content:           dna.topic_content,
    characters:              dna.characters || [],
    key_objects:             dna.key_objects || [],
    overall_background:      (dna.environments || []).map(e => e.description).join(' | '),
    visual_style_lighting:   dna.master_dna?.style_lock || expandStyle(config.style),
    aspect_ratio_resolution: '16:9',
    master_dna: {
      character_locks:  {},
      object_locks:     {},
      environment_lock: (dna.environments || []).map(e => e.dna_prompt).join(' | '),
      voice_lock:       dna.master_dna?.voice_lock || '',
      style_lock:       dna.master_dna?.style_lock || expandStyle(config.style),
    },
    specs: {
      total_duration: `${allScenes.length * config.sceneDuration}s`,
      pacing:         `${config.sceneDuration}s / cảnh`,
      total_scenes:   String(allScenes.length),
    },
    rules: { style: expandStyle(config.style), dialogue: config.language },
    character_lock: {}, environment_lock: {},
    master_prompts: {
      characters:   (dna.characters   || []).map(c => ({ id: c.id, name: c.name, prompt: c.dna_prompt })),
      environments: (dna.environments || []).map(e => ({ id: e.id, name: e.name, prompt: e.dna_prompt })),
      objects:      (dna.key_objects  || []).map(o => ({ id: o.id, name: o.name, prompt: o.dna_prompt })),
    },
    rawDna: dna,
  };

  const fullJson = {
    metadata: {
      style: config.style, language: config.language,
      total_scenes: allScenes.length, scene_duration: config.sceneDuration,
      total_duration: `${allScenes.length * config.sceneDuration}s`,
      provider: 'claude',
    },
    dna: {
      characters:   dna.characters   || [],
      environments: dna.environments || [],
      key_objects:  dna.key_objects  || [],
      master_dna:   dna.master_dna,
    },
    scenes: allScenes,
  };

  return { prompts, analysis, fullJson };
}

// ─── analyzeScenesClaude ─────────────────────────────────────────────────────
// Drop-in replacement for analyzeScenes (audioToVideo.js)
// Uses the same Veo content policy rules as the Gemini version
// chunks: [{ scene, time, exactText, timeStart, timeEnd }]
// Returns: [{ sceneNumber, timeEstimation, dialogue, veoVideoPrompt, error? }]
export async function analyzeScenesClaude({
  apiKey, model = DEFAULT_CLAUDE_MODEL,
  chunks, targetDuration, overallContext,
  onSceneProgress, onSceneReady,
}) {
  const n     = chunks.length;
  const BATCH = 8;
  const results = [];

  const pacingMap = {
    5:  '5 seconds: FAST, SHARP action. Quick cuts, abrupt zooms. No slow pans.',
    8:  '8 seconds: Standard Veo 3 pace. Balance between action and transition.',
    10: '10 seconds: SLOW, SMOOTH pan/zoom. Detailed description. Slow cinematic movements.',
  };
  const pacing = pacingMap[targetDuration] || `${targetDuration} seconds: Cinematic pacing.`;

  const ctxBlock = overallContext ? `
CONTENT CONTEXT:
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Recommended visual style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}${overallContext.character_background_sync ? `
- CHARACTER & BACKGROUND SYNC (CRITICAL — apply to EVERY scene): ${overallContext.character_background_sync}` : ''}` : '';

  for (let i = 0; i < n; i += BATCH) {
    const batchChunks = chunks.slice(i, i + BATCH);
    onSceneProgress?.(i + 1, n);

    const system = `You are an expert Veo 3 video prompt engineer. Generate cinematic Veo 3 prompts for ${targetDuration}-second audio scenes.
${ctxBlock}

PACING RULE: ${pacing}

🚫 VEO CONTENT POLICY (MANDATORY):
- NEVER describe: graphic violence, blood, gore, weapons used violently, murder, torture, adult/sexual content, nudity, hate speech, drugs, terrorism
- Replace sensitive content with safe cinematic alternatives ("intense confrontation" not "bloody fight")
- All prompts MUST be suitable for general audiences, family-friendly

⚠️ NO REAL PERSON NAMES — use roles only (e.g. "a young entrepreneur", "an elderly professor")

Return ONLY a valid JSON array of exactly ${batchChunks.length} prompt strings. No markdown, no extra text.`;

    const chunkList = batchChunks.map(c =>
      `Scene ${c.scene} | ${c.time}: "${c.exactText}"`
    ).join('\n');

    const prompt = `Generate ${batchChunks.length} Veo 3 prompts for these audio scenes:
${chunkList}

Each prompt must:
1. Cover exactly ${targetDuration} seconds of visual content matching the audio dialogue
2. Include: subject/action, environment, camera movement, lighting, color palette, mood
3. End with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"
4. Be visually distinct from other prompts in this batch

Return JSON array: ["prompt for scene ${batchChunks[0].scene}", ...]`;

    let batchPrompts = null;
    try {
      const raw     = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: batchChunks.length * 500, temperature: 0.7 });
      batchPrompts  = extractJSON(raw);
      if (!Array.isArray(batchPrompts)) batchPrompts = null;
    } catch (_) {}

    for (let j = 0; j < batchChunks.length; j++) {
      const chunk  = batchChunks[j];
      const absIdx = i + j;
      onSceneProgress?.(absIdx + 1, n);

      const veoPrompt = batchPrompts?.[j]
        ? String(batchPrompts[j]).replace(/^["']|["']$/g, '').trim()
        : `Cinematic scene: ${(chunk.exactText || '').slice(0, 80)}, ${targetDuration} seconds, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`;

      const sceneData = {
        sceneNumber:    chunk.scene,
        timeEstimation: chunk.time,
        dialogue:       chunk.exactText,
        veoVideoPrompt: veoPrompt,
      };
      results.push(sceneData);
      onSceneReady?.(sceneData, false);
    }
  }

  return results;
}

// Re-export analyzeOverallContentClaude for convenience
export { analyzeOverallContentClaude } from './claudeService.js';
