import { callGroqWithRotation, parseGroqJSON, DEFAULT_GROQ_MODEL } from './groqService.js';
import { buildDNAPrompt, buildScenesPrompt, expandStyle } from './geminiPrompt.js';
import { buildScriptPrompt } from './scriptGenerator.js';

// ── Groq free tier limits ────────────────────────────────────────────────────
// llama-3.3-70b: 6.000 TPM | llama-3.1-8b: 20.000 TPM | gemma2-9b: 15.000 TPM
// Chiến lược: chunk nhỏ + delay giữa các call để không vượt TPM/phút
// SCRIPT: 8 scene/chunk × ~400 tok/scene = ~3200 output + ~1500 input = ~4700 tok → OK với 6K TPM
// SCENES: 4 scene/chunk × ~600 tok/scene = ~2400 output + ~2000 input = ~4400 tok → OK
const GROQ_SCRIPT_CHUNK = 8;   // scenes per script-gen call
const SCENE_CHUNK       = 4;   // scenes per prompt-gen call (smaller = safer)
const GROQ_CALL_DELAY   = 800; // ms between consecutive calls (avoid TPM bursting)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function generateScriptGroq(apiKeys, config, onProgress, model = DEFAULT_GROQ_MODEL) {
  const { topic, platform = 'TikTok doc', sceneDuration = 8, totalDuration = 3, language = 'vi',
          style = 'Mac dinh', goal = 'Giai tri & Viral', tone = 'Bi trang & Hao hung',
          audience = 'Nguoi tre', mainChar = null, secChars = [] } = config;
  const CHUNK = GROQ_SCRIPT_CHUNK; // 8 scenes/call — fits within 6K TPM of llama-3.3-70b
  const numScenes  = Math.max(1, Math.round((totalDuration * 60) / sceneDuration));
  const numChunks  = Math.ceil(numScenes / CHUNK);
  const fullConfig = { topic, platform, sceneDuration, totalDuration, language, style, goal, tone, audience, mainChar, secChars };
  const onSwitch   = (info) => onProgress?.({ type: 'key_switch', message: `Key ${info.fromIdx + 1} bi gioi han -> Key ${info.toIdx + 1}/${info.total}` });
  let fullScript = '', projectBible = '';
  for (let ci = 0; ci < numChunks; ci++) {
    const fromScene = ci * CHUNK + 1, toScene = Math.min((ci + 1) * CHUNK, numScenes), isFirst = ci === 0;
    onProgress?.({ type: 'chunk', from: fromScene, to: toScene, total: numScenes, message: `Dang tao canh ${fromScene}-${toScene} / ${numScenes}...` });
    if (ci > 0) await sleep(GROQ_CALL_DELAY); // nhường TPM quota giữa các lần gọi
    const prompt = buildScriptPrompt(fullConfig, ci, fromScene, toScene, numChunks, numScenes, projectBible);
    // maxTokens: 4096 — đủ cho 8 cảnh (~400 tok/cảnh), tránh vượt 6K TPM
    const chunk  = await callGroqWithRotation(apiKeys, { model, system: '', prompt, maxTokens: 4096, temperature: 0.8 }, onSwitch);
    if (!chunk) throw new Error(`Groq: khong nhan duoc phan hoi cho canh ${fromScene}-${toScene}.`);
    if (isFirst) {
      const idx = chunk.search(/\[C/);
      projectBible = idx > 0 ? chunk.substring(0, idx).trim() : chunk.substring(0, Math.min(chunk.length, 2000));
      fullScript = chunk;
    } else { fullScript += '\n\n' + chunk; }
    onProgress?.({ type: 'chunk_done', from: fromScene, to: toScene, total: numScenes, scriptSoFar: fullScript });
  }
  return fullScript;
}

async function extractDNAGroq({ apiKeys, model, config, onSwitch }) {
  const system = 'You are a professional video production analyst. Output ONLY valid JSON, no markdown.';
  // Truncate subject to ~3000 chars — DNA prompt is already long; avoid exceeding TPM
  const safeConfig = config.subject.length > 3000
    ? { ...config, subject: config.subject.substring(0, 3000) + '\n...[truncated for DNA]' }
    : config;
  const prompt = buildDNAPrompt(safeConfig);
  const raw = await callGroqWithRotation(apiKeys, { model, system, prompt, maxTokens: 3000, temperature: 0 }, onSwitch);
  return parseGroqJSON(raw);
}

async function generateScenesBatchGroq({ apiKeys, model, config, dna, fromScene, toScene, onSwitch }) {
  const count  = toScene - fromScene + 1;
  const system = 'You are an expert Veo 3.1 prompt engineer. Output ONLY a valid JSON array, no markdown.';
  const prompt = buildScenesPrompt(config, dna, fromScene, toScene);
  // maxTokens: ~600/scene — safe for 4-scene batches under 6K TPM
  const raw    = await callGroqWithRotation(apiKeys, { model, system, prompt, maxTokens: Math.min(count * 600, 3000), temperature: 0.7 }, onSwitch);
  const scenes = parseGroqJSON(raw);
  if (!Array.isArray(scenes)) throw new Error(`Groq: canh ${fromScene}-${toScene} khong phai array`);
  return scenes;
}

export async function generateCinematicPromptsGroq(apiKeys, config, onProgress, model = DEFAULT_GROQ_MODEL) {
  const totalScenes = config.quantity;
  const onSwitch    = (info) => onProgress?.({ phase: 'key_switch', message: `Groq Key ${info.fromIdx + 1} -> Key ${info.toIdx + 1}/${info.total}`, ...info });

  onProgress?.({ phase: 'dna', message: 'Groq - Buoc 1/2: Dang phan tich kich ban & tao DNA...' });
  const dna = await extractDNAGroq({ apiKeys, model, config, onSwitch });
  onProgress?.({ phase: 'dna_done', dna, message: `DNA hoan tat: ${dna.characters?.length ?? 0} nhan vat, ${dna.environments?.length ?? 0} boi canh` });

  const allScenes = [], numChunks = Math.ceil(totalScenes / SCENE_CHUNK);
  for (let ci = 0; ci < numChunks; ci++) {
    const from = ci * SCENE_CHUNK + 1, to = Math.min((ci + 1) * SCENE_CHUNK, totalScenes);
    onProgress?.({ phase: 'scenes', from, to, total: totalScenes, chunkIndex: ci, numChunks, message: `Groq - Buoc 2/2: Tao prompt canh ${from}-${to} / ${totalScenes}...` });
    if (ci > 0) await sleep(GROQ_CALL_DELAY); // rate limit protection giữa các batch
    const batch = await generateScenesBatchGroq({ apiKeys, model, config, dna, fromScene: from, toScene: to, onSwitch });
    batch.forEach((s, i) => { if (!s.scene_number) s.scene_number = from + i; });
    allScenes.push(...batch);
    onProgress?.({ phase: 'batch_done', scenes: [...allScenes], from, to, total: totalScenes });
  }

  allScenes.forEach(scene => {
    if (!scene.character_dna || Object.keys(scene.character_dna).length === 0) {
      scene.character_dna = {};
      (scene.characters_in_scene || []).forEach(id => { const c = dna.characters?.find(x => x.id === id); if (c) scene.character_dna[id] = c.dna_prompt; });
    }
    if (!scene.environment_dna) { const e = dna.environments?.find(x => x.id === scene.environment_id); if (e) scene.environment_dna = e.dna_prompt; }
    if (!scene.objects_dna || Object.keys(scene.objects_dna).length === 0) {
      scene.objects_dna = {};
      (scene.objects_in_scene || []).forEach(id => { const o = dna.key_objects?.find(x => x.id === id); if (o) scene.objects_dna[id] = o.dna_prompt; });
    }
    if (!scene.style_lock) scene.style_lock = dna.master_dna?.style_lock || '';
    if (!scene.voice_lock) scene.voice_lock = dna.master_dna?.voice_lock || '';
  });

  const noDialogue = config.language === 'no-dialogue';
  if (!noDialogue) {
    const _L = { 'vi-VN':'Vietnamese', vi:'Vietnamese', 'en-US':'English', en:'English', 'ja-JP':'Japanese', ja:'Japanese', 'zh-CN':'Chinese', zh:'Chinese', 'ko-KR':'Korean', ko:'Korean', 'fr-FR':'French', fr:'French', 'es-ES':'Spanish', es:'Spanish', 'de-DE':'German', de:'German', 'th-TH':'Thai', th:'Thai' };
    const _lang = _L[config.language] || _L[config.language?.split('-')[0]] || config.language;
    const prefix = `[${_lang} voice],`;
    allScenes.forEach(scene => { if (scene.dialogue && scene.final_prompt && !scene.final_prompt.startsWith(`[${_lang}`)) scene.final_prompt = `${prefix} ${scene.final_prompt}`; });
  }
  const seen = new Map();
  allScenes.forEach(s => { const p = (s.final_prompt || '').trim(); if (seen.has(p)) s.final_prompt = s.final_prompt + `, [scene ${s.scene_number} distinct]`; else seen.set(p, s.scene_number); });

  const prompts = allScenes.map((scene, idx) => ({
    id: `scene-${scene.scene_number || idx + 1}`, scene_id: `scene-${scene.scene_number || idx + 1}`,
    title: `Canh ${scene.scene_number || idx + 1}${scene.title ? ': ' + scene.title : ''}`,
    promptText: scene.final_prompt || '', description: scene.setting_detail || scene.location || '',
    status: 'idle', fullData: scene,
  }));
  const analysis = {
    topic_content: dna.topic_content, characters: dna.characters || [], key_objects: dna.key_objects || [],
    overall_background: (dna.environments || []).map(e => e.description).join(' | '),
    visual_style_lighting: dna.master_dna?.style_lock || expandStyle(config.style), aspect_ratio_resolution: '16:9',
    master_dna: { character_locks: {}, object_locks: {}, environment_lock: (dna.environments || []).map(e => e.dna_prompt).join(' | '), voice_lock: dna.master_dna?.voice_lock || '', style_lock: dna.master_dna?.style_lock || expandStyle(config.style) },
    specs: { total_duration: `${allScenes.length * config.sceneDuration}s`, pacing: `${config.sceneDuration}s / canh`, total_scenes: String(allScenes.length) },
    rules: { style: expandStyle(config.style), dialogue: config.language }, character_lock: {}, environment_lock: {},
    master_prompts: { characters: (dna.characters || []).map(c => ({ id: c.id, name: c.name, prompt: c.dna_prompt })), environments: (dna.environments || []).map(e => ({ id: e.id, name: e.name, prompt: e.dna_prompt })), objects: (dna.key_objects || []).map(o => ({ id: o.id, name: o.name, prompt: o.dna_prompt })) },
    rawDna: dna,
  };
  return { prompts, analysis, fullJson: { metadata: { style: config.style, language: config.language, total_scenes: allScenes.length, scene_duration: config.sceneDuration, provider: 'groq' }, dna: { characters: dna.characters || [], environments: dna.environments || [], key_objects: dna.key_objects || [], master_dna: dna.master_dna }, scenes: allScenes } };
}

export async function analyzeOverallContentGroq(apiKeys, fullTranscript, onSwitch, model = DEFAULT_GROQ_MODEL) {
  const sampled = fullTranscript.length > 10000 ? fullTranscript.slice(0, 4000) + '\n...[middle omitted]...\n' + fullTranscript.slice(-2000) : fullTranscript;
  const system  = 'You are a content analyst. Output ONLY valid JSON, no markdown.';
  const prompt  = `Analyze this transcript:\n${sampled}\n\nReturn ONLY valid JSON:\n{"topic":"...","tone":"educational|motivational|storytelling|news|documentary","key_entities":[],"visual_themes":[],"narrative_arc":"...","recommended_visual_style":"...","context_summary":"..."}`;
  const raw     = await callGroqWithRotation(apiKeys, { model, system, prompt, maxTokens: 1024, temperature: 0 }, onSwitch);
  return parseGroqJSON(raw);
}

export async function analyzeScenesToGroq({ apiKeys, model = DEFAULT_GROQ_MODEL, chunks, targetDuration, overallContext, onSceneProgress, onSceneReady, onSwitch }) {
  const n       = chunks.length;
  const BATCH   = 5; // 5 scenes/batch (~1250 tokens) — nhỏ hơn để vừa TPM 6K
  const results = [];

  // ── Tính delay giữa các batch để không vượt Groq TPM limit ─────────────────
  // Groq free: 6000 TPM/key. Mỗi batch ≈ 3000 token (1250 input + 1750 output cho 5 scene).
  // Tổng TPM budget = keys × 6000 = keys × 2 batch/phút
  // Delay = 60000 / (keys × 2) — đảm bảo không burst vượt TPM từng key
  const keyCount    = Math.max((apiKeys || []).length, 1);
  const BATCH_DELAY = Math.ceil(60000 / (keyCount * 2));
  // 1 key→30s | 2 keys→15s | 3 keys→10s | 4 keys→7.5s | 6 keys→5s

  const pacingMap = { 5: '5s FAST SHARP action.', 8: '8s Standard Veo 3 pace.', 10: '10s SLOW SMOOTH cinematic.' };
  const pacing   = pacingMap[targetDuration] || `${targetDuration}s cinematic.`;
  const ctxBlock = overallContext
    ? `\nTopic: ${overallContext.topic || ''}\nTone: ${overallContext.tone || ''}\nStyle: ${overallContext.recommended_visual_style || ''}${overallContext.character_background_sync ? `\nCHARACTER & BACKGROUND SYNC (apply to EVERY scene): ${overallContext.character_background_sync}` : ''}`
    : '';

  const totalBatches = Math.ceil(n / BATCH);
  let batchIdx = 0;

  for (let i = 0; i < n; i += BATCH) {
    const batchChunks = chunks.slice(i, i + BATCH);
    batchIdx++;
    onSceneProgress?.(i + 1, n);

    // Delay giữa các batch để tránh vượt TPM
    if (batchIdx > 1) await sleep(BATCH_DELAY);

    const system = `Expert Veo 3 prompt engineer. ${targetDuration}s scenes.${ctxBlock}\nPACING: ${pacing}\nVEO POLICY: NO violence/gore/adult/hate. Safe alternatives. NO real person names.\nReturn ONLY JSON array of ${batchChunks.length} strings. No markdown.`;
    const chunkList = batchChunks.map(c => `Scene ${c.scene} | ${c.time}: "${(c.exactText || '').slice(0, 200)}"`).join('\n');
    const prompt = `Generate ${batchChunks.length} Veo 3 prompts for these scenes:\n${chunkList}\n\nEach prompt: subject/action, environment, camera, lighting, mood. End with "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"\n\nReturn JSON array of ${batchChunks.length} strings: [...]`;

    let batchPrompts = null;
    try {
      const raw = await callGroqWithRotation(
        apiKeys,
        { model, system, prompt, maxTokens: batchChunks.length * 400, temperature: 0.7 },
        onSwitch
      );
      batchPrompts = parseGroqJSON(raw);
      if (!Array.isArray(batchPrompts)) batchPrompts = null;
    } catch (_) {}

    for (let j = 0; j < batchChunks.length; j++) {
      const chunk  = batchChunks[j];
      const absIdx = i + j;
      onSceneProgress?.(absIdx + 1, n);
      const veoPrompt = batchPrompts?.[j]
        ? String(batchPrompts[j]).replace(/^["']|["']$/g, '').trim()
        : `Cinematic documentary: ${(chunk.exactText || '').slice(0, 80)}, ${targetDuration}s, safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot`;
      const sceneData = { sceneNumber: chunk.scene, timeEstimation: chunk.time, dialogue: chunk.exactText, veoVideoPrompt: veoPrompt };
      results.push(sceneData);
      onSceneReady?.(sceneData, false);
    }
  }
  return results;
}

// ─── AI sinh từ khóa stock video từ transcript (Groq) ─────────────────────────
export async function generateStockKeywordsGroq(apiKeys, chunks, overallCtx, onSwitch, model = DEFAULT_GROQ_MODEL) {
  const fallbackKw = (overallCtx?.topic || 'nature landscape')
    .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).slice(0, 3).join(' ') || 'nature landscape';
  const results = new Array(chunks.length).fill(fallbackKw);
  const ctxBlock = overallCtx
    ? `Topic: ${overallCtx.topic || ''}\nVisual themes: ${(overallCtx.visual_themes || []).join(', ')}\nKey entities: ${(overallCtx.key_entities || []).join(', ')}`
    : '';

  const MAX_PER_CALL = 30;
  for (let start = 0; start < chunks.length; start += MAX_PER_CALL) {
    const batch = chunks.slice(start, start + MAX_PER_CALL);
    const segmentList = batch.map((ch, idx) => {
      const text = (ch.exactText || '').trim().slice(0, 150);
      return `${start + idx + 1}. "${text || '[no text]'}"`;
    }).join('\n');

    const system = 'You are a stock video search expert. Output ONLY a JSON array of strings. No markdown, no explanation.';
    const prompt = `Given these audio transcript segments, suggest 2-3 English keywords per segment for searching stock footage on Pexels/Pixabay.
${ctxBlock}
Rules: English only (translate if needed), visual concrete nouns, searchable terms.

Segments:
${segmentList}

Return ONLY a JSON array with exactly ${batch.length} strings: ["keyword1 keyword2", ...]`;

    try {
      const raw = await callGroqWithRotation(apiKeys, { model, system, prompt, maxTokens: batch.length * 30 + 100, temperature: 0 }, onSwitch);
      const arrMatch = raw.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const arr = JSON.parse(arrMatch[0]);
        if (Array.isArray(arr)) {
          arr.forEach((kw, idx) => {
            const clean = (kw || '').toString().trim().slice(0, 80);
            if (clean) results[start + idx] = clean;
          });
        }
      }
    } catch (e) {
      console.warn('[generateStockKeywordsGroq] batch failed:', e.message);
    }
    if (start + MAX_PER_CALL < chunks.length) await sleep(1000);
  }
  return results;
}
