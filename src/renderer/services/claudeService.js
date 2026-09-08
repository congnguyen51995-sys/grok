/**
 * claudeService.js
 * Gọi Anthropic Claude API cho các tác vụ AI trong Fluxy
 * Endpoint: https://api.anthropic.com/v1/messages
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2023-06-01';

// Model mặc định — có thể override
export const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-6',           label: 'Claude Sonnet 4.6 (Cân bằng)'    },
  { id: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5 (Nhanh & Rẻ)'  },
  { id: 'claude-opus-4-8',             label: 'Claude Opus 4.8 (Mạnh nhất)'     },
  { id: 'claude-3-5-sonnet-20241022',  label: 'Claude 3.5 Sonnet (Ổn định)'     },
  { id: 'claude-3-haiku-20240307',     label: 'Claude 3 Haiku (Nhẹ & Nhanh)'    },
];

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

const LS_CLAUDE_KEY   = 'fluxy_claude_api_key';
const LS_CLAUDE_MODEL = 'fluxy_claude_model';

export function loadClaudeKey()   { return localStorage.getItem(LS_CLAUDE_KEY)   || ''; }
export function saveClaudeKey(k)  { localStorage.setItem(LS_CLAUDE_KEY, k); }
export function loadClaudeModel() { return localStorage.getItem(LS_CLAUDE_MODEL) || DEFAULT_CLAUDE_MODEL; }
export function saveClaudeModel(m){ localStorage.setItem(LS_CLAUDE_MODEL, m); }

// ── Gọi Claude API ─────────────────────────────────────────────────────────────
export async function callClaude({
  apiKey,
  model     = DEFAULT_CLAUDE_MODEL,
  system    = '',
  prompt,
  maxTokens = 4096,
  temperature = 0.7,
}) {
  if (!apiKey) throw new Error('Chưa có Claude API Key. Vào Settings → API Key để thêm.');
  if (!prompt) throw new Error('Thiếu prompt');

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':                          'application/json',
      'x-api-key':                             apiKey,
      'anthropic-version':                     CLAUDE_API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status}`;
    // Classify error type
    if (res.status === 401)            throw Object.assign(new Error(`Claude API Key không hợp lệ: ${msg}`), { status: 401 });
    if (res.status === 429)            throw Object.assign(new Error(`Claude rate limit: ${msg}`),             { status: 429 });
    if (res.status === 529 || res.status === 503) throw Object.assign(new Error(`Claude overloaded: ${msg}`), { status: 503 });
    throw new Error(`Claude API lỗi: ${msg}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  if (!text) throw new Error('Claude trả về rỗng');
  return text;
}

// ── Claude Vision — gọi API với ảnh inline (base64) ──────────────────────────
// images: [{ base64, mime }]  (max 5 ảnh)
export async function callClaudeVision({
  apiKey,
  model     = DEFAULT_CLAUDE_MODEL,
  system    = '',
  images    = [],   // [{ base64, mime }]
  prompt    = '',
  maxTokens = 4096,
  temperature = 0,
}) {
  if (!apiKey) throw new Error('Chưa có Claude API Key.');

  const content = [
    ...images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mime || 'image/jpeg', data: img.base64 },
    })),
    { type: 'text', text: prompt },
  ];

  const body = { model, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content }] };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': CLAUDE_API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw Object.assign(new Error(`Claude API Key không hợp lệ: ${msg}`), { status: 401 });
    if (res.status === 429) throw Object.assign(new Error(`Claude rate limit: ${msg}`), { status: 429 });
    throw new Error(`Claude Vision lỗi: ${msg}`);
  }

  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

// ── Retry wrapper cho Claude (không có key rotation — 1 key) ──────────────────
export async function callClaudeWithRetry(params, maxRetries = 3, baseDelayMs = 2000) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callClaude(params);
    } catch (e) {
      lastErr = e;
      // Rate limit → chờ lâu hơn
      const waitMs = e.status === 429
        ? 30000 + attempt * 10000   // 30s, 40s, 50s
        : baseDelayMs * (attempt + 1);
      if (attempt < maxRetries - 1) {
        console.warn(`[Claude retry ${attempt + 1}/${maxRetries}]`, e.message);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }
  throw lastErr;
}

// ── Xác minh API key ─────────────────────────────────────────────────────────
export async function verifyClaudeKey(apiKey) {
  try {
    await callClaude({ apiKey, prompt: 'Reply with just "OK"', maxTokens: 10, temperature: 0 });
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ── Tạo Veo video prompt bằng Claude ─────────────────────────────────────────
export async function generateVeoPromptClaude({
  apiKey,
  model     = DEFAULT_CLAUDE_MODEL,
  chunk,            // { scene, time, exactText }
  targetDuration,
  overallContext,
}) {
  const contextBlock = overallContext ? `
Content Context:
- Topic: ${overallContext.topic || ''}
- Tone: ${overallContext.tone || ''}
- Key entities: ${(overallContext.key_entities || []).join(', ')}
- Style: ${overallContext.recommended_visual_style || ''}
- Summary: ${overallContext.context_summary || ''}` : '';

  const system = `You are an expert Video Prompt Engineer for Google Veo 3.
${contextBlock}

⛔ ABSOLUTE RULES:
1. NEVER use real person names (celebrities, politicians, athletes, etc.) — use roles only
2. NO graphic violence, blood, adult content, weapons, disturbing imagery
3. NO copyright characters or branded content
4. ALWAYS end with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"

Write ONE complete Veo prompt for a ${targetDuration}-second scene covering all 9 elements:
Subject/Action, Environment, Camera Movement, Lighting, Color Palette, Visual Style, Mood, Audio Cues, End Tag.

Return ONLY the prompt paragraph — no labels, no JSON, no explanation.`;

  const prompt = `Scene ${chunk.scene} | Time: ${chunk.time}
Dialogue: "${chunk.exactText}"

Write ONE complete Veo_Video_Prompt.`;

  const text = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: 1024, temperature: 0.7 });
  return text.replace(/^["'`]|["'`]$/g, '').trim();
}

// ── Tạo nhiều Veo prompts bằng Claude (batch) ────────────────────────────────
export async function generateVeoPromptBatchClaude({
  apiKey,
  model = DEFAULT_CLAUDE_MODEL,
  chunks,
  targetDuration,
  overallContext,
}) {
  const contextBlock = overallContext ? `
Content Context: Topic: ${overallContext.topic || ''} | Tone: ${overallContext.tone || ''} | Style: ${overallContext.recommended_visual_style || ''}` : '';

  const system = `You are an expert Video Prompt Engineer for Google Veo 3.${contextBlock}

⛔ ABSOLUTE RULES — NO EXCEPTIONS:
1. NEVER use real person names — use roles (e.g. "a tech entrepreneur", "a world leader")
2. NO graphic violence, blood, adult content, weapons, disturbing imagery
3. ALWAYS end each prompt with: "safe for all audiences, family-friendly, aspect ratio 16:9, cinematic shot"

For each scene, write ONE complete Veo prompt (${targetDuration}s) with: Subject, Environment, Camera, Lighting, Colors, Style, Mood, Audio, End Tag.

Return ONLY a valid JSON array of ${chunks.length} strings:
["prompt 1", "prompt 2", ...]
No markdown, no extra text.`;

  const scenesText = chunks.map(c => `Scene ${c.scene} | ${c.time}: "${c.exactText}"`).join('\n');
  const prompt = `${scenesText}\n\nGenerate ${chunks.length} Veo prompts as JSON array.`;

  const raw = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: chunks.length * 500, temperature: 0.7 });
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('Claude: không parse được JSON array');
  const prompts = JSON.parse(arrMatch[0]);
  if (!Array.isArray(prompts) || prompts.length !== chunks.length)
    throw new Error(`Claude: nhận ${prompts?.length ?? 0} prompts thay vì ${chunks.length}`);
  return prompts.map(p => String(p).replace(/^["']|["']$/g, '').trim());
}

// ── Phân tích tổng quan nội dung audio bằng Claude ───────────────────────────
export async function analyzeOverallContentClaude({ apiKey, model = DEFAULT_CLAUDE_MODEL, transcript }) {
  const system = `You are a content analyst. Analyze the given audio transcript and return ONLY valid JSON.`;
  const prompt = `Analyze this transcript for video production:
${transcript.slice(0, 8000)}

Return ONLY valid JSON:
{"topic":"main topic in 1 sentence","tone":"educational|motivational|storytelling|news|documentary","key_entities":["person/brand/place"],"visual_themes":["dominant visual themes"],"narrative_arc":"structure description","recommended_visual_style":"cinematography recommendation","context_summary":"2-3 sentence summary"}`;

  const raw = await callClaudeWithRetry({ apiKey, model, system, prompt, maxTokens: 1024, temperature: 0 });
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude: không parse được JSON analysis');
  return JSON.parse(match[0]);
}

// ── Tạo script/kịch bản bằng Claude ──────────────────────────────────────────
// Uses IDENTICAL prompts as generateScript (scriptGenerator.js) via buildScriptPrompt
export async function generateScriptClaude({
  apiKey, model = DEFAULT_CLAUDE_MODEL,
  topic, platform = 'TikTok dọc', sceneDuration = 8, totalDuration = 3,
  language = 'vi', style = 'Mặc định', goal = 'Giải trí & Viral',
  tone = 'Bi tráng & Hào hùng', audience = 'Người trẻ (Gen Z & Alpha)',
  mainChar = null, secChars = [],
}) {
  const { buildScriptPrompt } = await import('./scriptGenerator.js');
  const SCENE_CHUNK = 25;
  const numScenes   = Math.max(1, Math.round((totalDuration * 60) / sceneDuration));
  const numChunks   = Math.ceil(numScenes / SCENE_CHUNK);
  const config      = { topic, platform, sceneDuration, totalDuration, language, style, goal, tone, audience, mainChar, secChars };

  let fullScript   = '';
  let projectBible = '';

  for (let ci = 0; ci < numChunks; ci++) {
    const fromScene = ci * SCENE_CHUNK + 1;
    const toScene   = Math.min((ci + 1) * SCENE_CHUNK, numScenes);
    const isFirst   = ci === 0;

    const prompt = buildScriptPrompt(config, ci, fromScene, toScene, numChunks, numScenes, projectBible);
    const chunk  = await callClaudeWithRetry({ apiKey, model, system: '', prompt, maxTokens: 32768, temperature: 0.8 });
    if (!chunk) throw new Error(`Claude: không nhận được phản hồi cho cảnh ${fromScene}–${toScene}.`);

    if (isFirst) {
      const sceneMarker = chunk.search(/\[CẢNH\s+1\s*:/);
      projectBible = sceneMarker > 0
        ? chunk.substring(0, sceneMarker).trim()
        : chunk.substring(0, Math.min(chunk.length, 2000));
      fullScript = chunk;
    } else {
      fullScript += '\n\n' + chunk;
    }
  }

  return fullScript;
}
