import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { retryWithKeyRotation } from '../services/keyRotation';

const api = window.electronAPI;

const VOICE_LIST = [
  { id: '',              label: 'Không có giọng' },
  { id: 'random',        label: '🎲 Ngẫu nhiên' },
  { id: 'Achernar',      label: 'Achernar — Nữ, nhẹ nhàng, cao' },
  { id: 'Achird',        label: 'Achird — Nam, thân thiện, trung' },
  { id: 'Algenib',       label: 'Algenib — Nam, khàn, trầm' },
  { id: 'Algieba',       label: 'Algieba — Nam, dễ chịu, trầm-vừa' },
  { id: 'Alnilam',       label: 'Alnilam — Nam, cứng rắn, trầm-vừa' },
  { id: 'Aoede',         label: 'Aoede — Nữ, nhẹ nhàng, trung-cao' },
  { id: 'Autonoe',       label: 'Autonoe — Nữ, tươi sáng, trung' },
  { id: 'Callirrhoe',    label: 'Callirrhoe — Nữ, dễ chịu, trung' },
  { id: 'Charon',        label: 'Charon — Nam, thông tin, thấp' },
  { id: 'Despina',       label: 'Despina — Nữ, mượt mà, trung' },
  { id: 'Enceladus',     label: 'Enceladus — Nam, mạnh mẽ, thấp' },
  { id: 'Gacrux',        label: 'Gacrux — Nữ, chín chắn, trung' },
  { id: 'Iapetus',       label: 'Iapetus — Nam, rõ ràng, trầm-vừa' },
  { id: 'Kore',          label: 'Kore — Nữ, mạnh mẽ, trung' },
  { id: 'Laomedeia',     label: 'Laomedeia — Nữ, vui vẻ, trung-cao' },
  { id: 'Leda',          label: 'Leda — Nữ, trẻ trung, trung-cao' },
  { id: 'Orus',          label: 'Orus — Nam, cứng, trầm-vừa' },
  { id: 'Puck',          label: 'Puck — Nam, sôi nổi, trung' },
  { id: 'Pulcherrima',   label: 'Pulcherrima — Trung tính, mạnh, trung-cao' },
  { id: 'Rasalgethi',    label: 'Rasalgethi — Nam, thông tin, trung' },
  { id: 'Sadachbia',     label: 'Sadachbia — Nam, linh hoạt, thấp' },
  { id: 'Sadaltager',    label: 'Sadaltager — Nam, am hiểu, trung' },
  { id: 'Schedar',       label: 'Schedar — Nam, đều đặn, trầm-vừa' },
  { id: 'Sulafat',       label: 'Sulafat — Nữ, ấm áp, trung' },
  { id: 'Umbriel',       label: 'Umbriel — Nam, mượt mà, thấp' },
  { id: 'Vindemiatrix',  label: 'Vindemiatrix — Nữ, nhẹ nhàng, trung' },
  { id: 'Zephyr',        label: 'Zephyr — Nữ, tươi sáng, trung-cao' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi — Nam, thoải mái, trầm-vừa' },
];
const VOICE_POOL = VOICE_LIST.filter(v => v.id && v.id !== 'random');

const VEO_MODELS = [
  'Veo 3.1 - Lite [Lower Priority]',
  'Veo 3.1 - Lite',
  'Omni 1.1 Flash',
];
const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
];
const LANGS = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

// Max ingredient images per Veo model (confirmed from VeoEngine source)
const MAX_REF = (model) => model === 'Omni 1.1 Flash' ? 7 : 3;

const STATUS_COLOR = { pending: '#6b7280', generating: '#f59e0b', done: '#22c55e', error: '#ef4444' };
const CHAR_COLORS  = ['#f97316','#a78bfa','#34d399','#f43f5e','#38bdf8','#facc15','#fb923c'];

const Sel = ({ label, value, onChange, options }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#1f2937', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  </div>
);

export default function DramaStudio() {
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [veoModel,    setVeoModel]    = useState('Veo 3.1 - Lite [Lower Priority]');
  const [lang,        setLang]        = useState('vi');
  const [outputDir,   setOutputDir]   = useState('');
  const [story,       setStory]       = useState('');
  const [duration,    setDuration]    = useState(60);

  // characters: { [name]: { description, refPath, refStatus: 'pending'|'generating'|'done'|'error' } }
  const [characters, setCharacters]   = useState({});
  // scenes: { id, narration, videoPrompt, durationSec, charactersInScene: [name,...], status, videoPath, error }
  const [scenes,     setScenes]       = useState([]);

  const [scriptBusy, setScriptBusy]   = useState(false);
  const [videoBusy,  setVideoBusy]    = useState(false);
  const [mergeBusy,  setMergeBusy]    = useState(false);
  const [log,        setLog]          = useState('');
  const [finalVideo, setFinalVideo]   = useState(null);
  const abortRef = useRef(false);
  const charNamesRef = useRef([]);  // stable list of char names in insertion order

  useEffect(() => {
    (async () => {
      const dir = await api.getSetting('outputDir', '');
      if (dir) setOutputDir(dir);
    })();
  }, []);

  // Load tất cả Gemini keys: system keys + user keys (merged in fluxy_gemini_api_keys)
  const loadAllKeys = async () => {
    try {
      const raw = await api.getSetting('fluxy_gemini_api_keys', '[]');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.filter(Boolean);
    } catch {}
    try {
      const parsed = JSON.parse(localStorage.getItem('fluxy_gemini_api_keys') || '[]');
      if (Array.isArray(parsed) && parsed.length) return parsed.filter(Boolean);
    } catch {}
    return [];
  };

  const addLog = (msg) => setLog(p => p ? `${p}\n${msg}` : msg);

  const pickFolder = async () => {
    const result = await api.selectFolder?.();
    if (result) setOutputDir(result);
  };

  // Resolve relative broll path → absolute
  const resolveAbsPath = async (result) => {
    let absPath = result.absolutePath || result.file;
    if (absPath && !absPath.includes(':') && !absPath.startsWith('/')) {
      const pubDir = await api.getRemotionPublicDir?.();
      if (pubDir) absPath = `${pubDir}\\${absPath.replace(/\//g, '\\')}`;
    }
    return absPath;
  };

  // ── Generate script ────────────────────────────────────────────────────────
  const handleGenerateScript = async () => {
    if (!story.trim()) return addLog('❌ Chưa nhập nội dung kịch bản');
    const allKeys = await loadAllKeys();
    if (!allKeys.length) return addLog('❌ Chưa có Gemini API Key — vào Cài đặt để thêm key');
    setScriptBusy(true);
    setScenes([]);
    setCharacters({});
    setFinalVideo(null);
    charNamesRef.current = [];
    addLog(`🧠 Đang phân tích kịch bản... (${allKeys.length} keys khả dụng)`);

    const langLabel = LANGS.find(l => l.value === lang)?.label || lang;
    const maxRef = MAX_REF(veoModel);
    const secPerScene = veoModel.includes('Omni') ? 10 : 8;
    const targetScenes = Math.max(3, Math.round(duration / secPerScene));

    const prompt = `Bạn là đạo diễn video AI. Phân tích kịch bản/ý tưởng sau và tạo ${targetScenes} cảnh quay cho video ${duration} giây.

Kịch bản: "${story}"

Yêu cầu:
- Ngôn ngữ narration & dialogue: ${langLabel}
- Mỗi cảnh khoảng ${secPerScene} giây (duration_sec bằng ${secPerScene})
- video_prompt: tiếng Anh chi tiết (≥15 từ): chủ thể, hành động, bối cảnh, ánh sáng, camera
- Xác định tất cả nhân vật chính (tối đa ${maxRef} nhân vật vì Veo giới hạn ${maxRef} ingredient/cảnh)
- Với mỗi nhân vật: mô tả ngoại hình nhất quán xuyên suốt (ethnicity, age, hair, outfit, build)
- characters_in_scene: liệt kê tên nhân vật XUẤT HIỆN trong cảnh đó (mảng rỗng nếu không có người)
- narration: lời dẫn truyện ngắn gọn bằng ${langLabel} (người kể chuyện)
- dialogues: lời thoại trực tiếp của từng nhân vật trong cảnh bằng ${langLabel} (mảng rỗng nếu không có thoại). Mỗi dòng thoại ngắn, tự nhiên, phù hợp tính cách nhân vật.
- video_prompt: tiếng Anh mô tả hình ảnh + ÂM THANH đầy đủ. Cấu trúc bắt buộc:
  1. Mô tả hình ảnh (cảnh quay, nhân vật, ánh sáng, camera)
  2. [SPEECH: Narrator]: "lời dẫn truyện tiếng Việt"
  3. [SPEECH: TênNhânVật]: "lời thoại tiếng Việt" (nếu có)
  Ví dụ: "Cinematic close-up of two lovers by riverside, soft golden light.\n\n[SPEECH: Narrator]: \"Giữa khói lửa chiến tranh, tình yêu vẫn nở rộ.\"\n[SPEECH: Minh]: \"Em ơi, anh sẽ trở về.\""

Trả về JSON object (không có markdown):
{
  "characters": [
    { "name": "Tên nhân vật", "description": "English physical description for Imagen AI portrait generation" }
  ],
  "scenes": [
    {
      "scene_number": 1,
      "duration_sec": ${secPerScene},
      "narration": "Lời dẫn chuyện của người kể",
      "dialogues": [
        { "character": "Tên nhân vật", "text": "Lời thoại của nhân vật" }
      ],
      "video_prompt": "Detailed English visual description.\n\n[SPEECH: Narrator]: \"Narration in Vietnamese.\"\n[SPEECH: CharName]: \"Dialogue in Vietnamese.\"",
      "characters_in_scene": ["Tên nhân vật"]
    }
  ]
}`;

    try {
      const res = await retryWithKeyRotation(async (key) => {
        const g = new GoogleGenAI({ apiKey: key });
        return await g.models.generateContent({
          model: geminiModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.7, maxOutputTokens: 8192 },
        });
      }, allKeys, {
        onSwitch: ({ fromIdx, toIdx, total }) => addLog(`🔑 Chuyển key ${fromIdx + 1}→${toIdx + 1}/${total}`),
        maxCycles: 2,
      });
      const txt = res.candidates?.[0]?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join('') || '';

      // Parse JSON object (not array)
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Gemini không trả về JSON object');
      const parsed = JSON.parse(jsonMatch[0]);

      const rawChars  = Array.isArray(parsed.characters) ? parsed.characters : [];
      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      if (!rawScenes.length) throw new Error('Không có scenes trong JSON');

      // Build characters map
      const charMap = {};
      const nameList = [];
      rawChars.forEach(c => {
        if (c.name && c.description) {
          charMap[c.name] = { description: c.description, refPath: null, refStatus: 'pending', voiceId: '' };
          nameList.push(c.name);
        }
      });
      charNamesRef.current = nameList;
      setCharacters(charMap);

      const newScenes = rawScenes.map((s, i) => ({
        id: i,
        narration: s.narration || '',
        dialogues: Array.isArray(s.dialogues) ? s.dialogues : [],
        videoPrompt: s.video_prompt || '',
        durationSec: s.duration_sec || secPerScene,
        charactersInScene: Array.isArray(s.characters_in_scene) ? s.characters_in_scene : [],
        status: 'pending',
        videoPath: null,
        error: null,
      }));
      setScenes(newScenes);
      addLog(`✅ ${rawScenes.length} cảnh | ${nameList.length} nhân vật: ${nameList.join(', ') || 'không có'}`);

      // Auto-generate reference images for each character
      if (nameList.length > 0) {
        addLog(`🖼️ Đang tạo ảnh tham chiếu cho ${nameList.length} nhân vật...`);
        for (const name of nameList) {
          const desc = charMap[name].description;
          setCharacters(p => ({ ...p, [name]: { ...p[name], refStatus: 'generating' } }));
          addLog(`  👤 Tạo ảnh: ${name}...`);
          try {
            const refRes = await api.agentAcquireBroll({
              query: `Character portrait reference: ${desc}. Full face, neutral expression, front-facing, looking at camera, clean studio background, high quality`,
              segmentId: `char_${name}`,
              durationSec: 6,
              mode: 'image',
              veoModel,
              refImagePaths: [],
            });
            if (refRes?.success && (refRes.file || refRes.absolutePath)) {
              const absPath = await resolveAbsPath(refRes);
              setCharacters(p => ({ ...p, [name]: { ...p[name], refPath: absPath, refStatus: 'done' } }));
              addLog(`  ✅ ${name} → ${absPath.split(/[\\/]/).pop()}`);
            } else {
              setCharacters(p => ({ ...p, [name]: { ...p[name], refStatus: 'error' } }));
              addLog(`  ⚠️ Không tạo được ảnh cho ${name}`);
            }
          } catch (e) {
            setCharacters(p => ({ ...p, [name]: { ...p[name], refStatus: 'error' } }));
            addLog(`  ⚠️ Lỗi ảnh ${name}: ${e.message}`);
          }
        }
        addLog('🖼️ Hoàn tất tạo ảnh tham chiếu');
      }
    } catch (e) {
      addLog(`❌ Lỗi tạo kịch bản: ${e.message}`);
    } finally {
      setScriptBusy(false);
    }
  };

  // ── Generate videos ────────────────────────────────────────────────────────
  const handleGenerateVideos = async () => {
    if (!scenes.length) return addLog('❌ Chưa có kịch bản');
    if (!outputDir)     return addLog('❌ Chưa chọn thư mục lưu');
    abortRef.current = false;
    setVideoBusy(true);
    setFinalVideo(null);
    addLog(`🎬 Bắt đầu tạo ${scenes.length} video clip...`);

    const maxRef = MAX_REF(veoModel);
    const charSnap = { ...characters };
    const usedVoices = new Set();
    const resolvedVoices = {};
    Object.entries(charSnap).forEach(([name, ch]) => {
      if (!ch.voiceId) return;
      if (ch.voiceId === 'random') {
        const pool = VOICE_POOL.filter(v => !usedVoices.has(v.id));
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) { resolvedVoices[name] = pick.id; usedVoices.add(pick.id); }
      } else {
        resolvedVoices[name] = ch.voiceId;
        usedVoices.add(ch.voiceId);
      }
    });

    const secPerScene = veoModel.includes('Omni') ? 10 : 8;
    const taskIdToSceneIdx = {};
    const tasks = [];

    scenes.forEach((scene, i) => {
      if (scene.status === 'done' && scene.videoPath) {
        addLog(`⏭️ Scene ${i + 1} đã có video`);
        return;
      }
      const sceneRefPaths = (scene.charactersInScene || [])
        .map(name => charSnap[name]?.refPath).filter(Boolean).slice(0, maxRef);
      const sceneVoiceId = (scene.charactersInScene || [])
        .map(name => resolvedVoices[name]).filter(Boolean)[0] || null;
      const charDescs = (scene.charactersInScene || [])
        .map(name => charSnap[name]?.description ? `${name}: ${charSnap[name].description}` : null)
        .filter(Boolean);
      const query = charDescs.length
        ? `${scene.videoPrompt}. Characters: ${charDescs.join('; ')} — consistent appearance`
        : scene.videoPrompt;

      const taskId = `scene_${i + 1}`;
      taskIdToSceneIdx[taskId] = i;
      const task = { id: taskId, prompt: query, fileIndex: i + 1 };
      if (sceneRefPaths.length) task.ingredientImages = sceneRefPaths;
      if (sceneVoiceId) task.voiceId = sceneVoiceId;
      tasks.push(task);

      const refLabel = sceneRefPaths.length ? ` [+${sceneRefPaths.length}ref]` : '';
      const voiceLabel = sceneVoiceId ? ` [🎙️${sceneVoiceId}]` : '';
      addLog(`📋 Scene ${i + 1}${refLabel}${voiceLabel}: ${query.slice(0, 60)}...`);
      setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'generating', error: null } : s));
    });

    if (!tasks.length) {
      addLog('✅ Tất cả scene đã có video');
      setVideoBusy(false);
      return;
    }

    addLog(`🚀 Gửi ${tasks.length} scene → VeoEngine (8 luồng nội bộ)...`);

    // Listen to veo-log for real-time per-scene updates
    const logListener = api.onVeoLog((data) => {
      const { type, text: rawText } = data;
      let jobId = null;
      let text = typeof rawText === 'string' ? rawText : '';
      const m = text.match(/^\[JOBID:(.+?)\]\s*(.*)$/);
      if (m) { jobId = m[1]; text = m[2]; }

      const sceneIdx = jobId !== null ? taskIdToSceneIdx[jobId] : undefined;

      if (type === 'job_success' && sceneIdx !== undefined) {
        const pathMatch = text.match(/\|PATH:(.+)$/);
        const absPath = pathMatch ? pathMatch[1].trim() : null;
        if (absPath) {
          setScenes(prev => prev.map((s, idx) => idx === sceneIdx
            ? { ...s, status: 'done', videoPath: absPath } : s));
          addLog(`✅ Scene ${sceneIdx + 1} → ${absPath.split(/[\\/]/).pop()}`);
        }
      } else if (type === 'job_fail' && sceneIdx !== undefined) {
        setScenes(prev => prev.map((s, idx) => idx === sceneIdx
          ? { ...s, status: 'error', error: text } : s));
        addLog(`❌ Scene ${sceneIdx + 1} lỗi: ${text}`);
      } else if (!['progress', 'job_start', 'job_success', 'job_fail', 'job_cancel'].includes(type) && text.trim()) {
        addLog(`[Veo] ${text.slice(0, 100)}`);
      }
    });

    try {
      const result = await api.runVeo({
        mediaType: 'Video',
        tasks,
        model: veoModel,
        outputFolder: outputDir,
        genCount: '1x',
        quality: '720p',
        duration: `${secPerScene}s`,
        aspectRatio: '16:9',
      });

      // Fallback: update any scenes missed by the log listener
      if (result?.files && Array.isArray(result.files)) {
        result.files.forEach(f => {
          const sceneIdx = taskIdToSceneIdx[f.id];
          if (sceneIdx !== undefined && f.filePath) {
            setScenes(prev => prev.map((s, idx) => {
              if (idx !== sceneIdx || s.status === 'done') return s;
              addLog(`✅ Scene ${sceneIdx + 1} → ${f.filePath.split(/[\\/]/).pop()}`);
              return { ...s, status: 'done', videoPath: f.filePath };
            }));
          }
        });
      }
    } catch (e) {
      addLog(`❌ Lỗi VeoEngine: ${e.message}`);
    } finally {
      if (api.offVeoLog && logListener) api.offVeoLog(logListener);
      setVideoBusy(false);
      addLog(`🏁 Xong — kết quả xem từng scene bên trên`);
    }
  };

  // ── Merge ──────────────────────────────────────────────────────────────────
  const handleMerge = async () => {
    const donePaths = scenes.filter(s => s.status === 'done' && s.videoPath).map(s => s.videoPath);
    if (donePaths.length < 2) return addLog('❌ Cần ít nhất 2 video clip');
    if (!outputDir)           return addLog('❌ Chưa chọn thư mục lưu');
    setMergeBusy(true);
    addLog(`🔗 Ghép ${donePaths.length} clips...`);
    try {
      const result = await api.mergeVideo({ files: donePaths, transition: 'Không có', outputFolder: outputDir, outputName: `drama_${Date.now()}` });
      if (result?.success) { setFinalVideo(result.path); addLog(`✅ Ghép xong → ${result.path}`); }
      else addLog(`❌ Ghép thất bại: ${result?.error || 'unknown'}`);
    } catch (e) { addLog(`❌ Ghép lỗi: ${e.message}`); }
    finally { setMergeBusy(false); }
  };

  // ── Re-generate single scene ───────────────────────────────────────────────
  const regenScene = async (i) => {
    if (!outputDir) return;
    const scene = scenes[i];
    const maxRef = MAX_REF(veoModel);
    const sceneRefPaths = (scene.charactersInScene || [])
      .map(name => characters[name]?.refPath).filter(Boolean).slice(0, maxRef);
    const charDescs = (scene.charactersInScene || [])
      .map(name => characters[name]?.description ? `${name}: ${characters[name].description}` : null)
      .filter(Boolean);
    const query = charDescs.length
      ? `${scene.videoPrompt}. Characters: ${charDescs.join('; ')} — consistent appearance`
      : scene.videoPrompt;
    const rawVoice = (scene.charactersInScene || []).map(n => characters[n]?.voiceId).filter(Boolean)[0] || null;
    const sceneVoice = rawVoice === 'random'
      ? VOICE_POOL[Math.floor(Math.random() * VOICE_POOL.length)]?.id || null
      : rawVoice;

    const taskId = `scene_${i + 1}_r${Date.now()}`;
    const task = { id: taskId, prompt: query, fileIndex: i + 1 };
    if (sceneRefPaths.length) task.ingredientImages = sceneRefPaths;
    if (sceneVoice) task.voiceId = sceneVoice;

    setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'generating', error: null } : s));

    const logListener = api.onVeoLog((data) => {
      const { type, text: rawText } = data;
      let jobId = null;
      let text = typeof rawText === 'string' ? rawText : '';
      const m = text.match(/^\[JOBID:(.+?)\]\s*(.*)$/);
      if (m) { jobId = m[1]; text = m[2]; }
      if (jobId !== taskId) return;
      if (type === 'job_success') {
        const pathMatch = text.match(/\|PATH:(.+)$/);
        if (pathMatch) {
          const absPath = pathMatch[1].trim();
          setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done', videoPath: absPath } : s));
        }
      } else if (type === 'job_fail') {
        setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error', error: text } : s));
      }
    });

    const secPerScene = veoModel.includes('Omni') ? 10 : 8;
    try {
      const result = await api.runVeo({
        mediaType: 'Video',
        tasks: [task],
        model: veoModel,
        outputFolder: outputDir,
        genCount: '1x',
        quality: '720p',
        duration: `${secPerScene}s`,
        aspectRatio: '16:9',
      });
      // Fallback if log was missed
      const f = result?.files?.[0];
      if (f?.filePath) {
        setScenes(prev => prev.map((s, idx) => {
          if (idx !== i || s.status === 'done') return s;
          return { ...s, status: 'done', videoPath: f.filePath };
        }));
      } else if (!result?.success) {
        setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error', error: result?.error || 'Fail' } : s));
      }
    } catch (e) {
      setScenes(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error', error: e.message } : s));
    } finally {
      if (api.offVeoLog && logListener) api.offVeoLog(logListener);
    }
  };

  // ── Re-generate single character ref ──────────────────────────────────────
  const regenCharRef = async (name) => {
    const desc = characters[name]?.description;
    if (!desc) return;
    setCharacters(p => ({ ...p, [name]: { ...p[name], refStatus: 'generating' } }));
    try {
      const res = await api.agentAcquireBroll({
        query: `Character portrait reference: ${desc}. Full face, neutral expression, front-facing, clean background, high quality`,
        segmentId: `char_${name}`, durationSec: 6, mode: 'image', veoModel, refImagePaths: [],
      });
      if (res?.success && (res.file || res.absolutePath)) {
        const absPath = await resolveAbsPath(res);
        setCharacters(p => ({ ...p, [name]: { ...p[name], refPath: absPath, refStatus: 'done' } }));
      } else throw new Error(res?.error || 'fail');
    } catch (e) {
      setCharacters(p => ({ ...p, [name]: { ...p[name], refStatus: 'error' } }));
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const panelSt = { background: '#111827', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };
  const btnSt   = (color, disabled) => ({
    background: disabled ? '#374151' : color, color: disabled ? '#6b7280' : '#fff',
    border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });
  const inputSt = { background: '#1f2937', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 6, padding: '7px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box' };

  const charNames     = charNamesRef.current;
  const donePaths     = scenes.filter(s => s.status === 'done' && s.videoPath);
  const maxRefN       = MAX_REF(veoModel);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0f172a', gap: 10, padding: 10, boxSizing: 'border-box', overflow: 'hidden' }}>

      {/* ── LEFT ── */}
      <div style={{ width: 290, minWidth: 270, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>

        {/* Settings */}
        <div style={panelSt}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#f97316', borderBottom: '1px solid #1f2937', paddingBottom: 8 }}>🎬 Drama AI</div>
          <Sel label="Gemini Model" value={geminiModel} onChange={setGeminiModel} options={GEMINI_MODELS} />
          <Sel label="Veo Model"    value={veoModel}    onChange={v => setVeoModel(v)} options={VEO_MODELS} />
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: -6 }}>
            Max ingredient/cảnh: <b style={{ color: '#f59e0b' }}>{maxRefN} nhân vật</b>
          </div>
          <Sel label="Ngôn ngữ"     value={lang}        onChange={setLang}        options={LANGS} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              Thời lượng: {Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}
            </span>
            <input type="range" min={15} max={600} step={15} value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#f97316' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7280' }}>
              <span>15s</span><span>5 phút</span><span>10 phút</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Thư mục lưu</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="Chọn thư mục..." style={{ ...inputSt, flex: 1 }} />
              <button onClick={pickFolder} style={{ ...btnSt('#374151', false), padding: '6px 10px' }}>📁</button>
            </div>
          </div>
        </div>

        {/* Characters panel */}
        {charNames.length > 0 && (
          <div style={panelSt}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
              👥 Nhân vật ({charNames.length}/{maxRefN} max)
            </span>
            {charNames.map((name, ci) => {
              const ch = characters[name] || {};
              const color = CHAR_COLORS[ci % CHAR_COLORS.length];
              return (
                <div key={name} style={{ background: '#1f2937', borderRadius: 8, padding: '8px 10px', border: `1px solid ${color}44` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color, flex: 1 }}>{name}</span>
                    <span style={{ fontSize: 10, color:
                      ch.refStatus === 'done' ? '#22c55e' :
                      ch.refStatus === 'generating' ? '#f59e0b' :
                      ch.refStatus === 'error' ? '#ef4444' : '#6b7280' }}>
                      {ch.refStatus === 'done' ? '✅ Có ảnh' :
                       ch.refStatus === 'generating' ? '⏳...' :
                       ch.refStatus === 'error' ? '❌' : '⏸'}
                    </span>
                    <button onClick={() => regenCharRef(name)} disabled={ch.refStatus === 'generating'}
                      title="Tạo lại ảnh tham chiếu"
                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>🔁</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                    {ch.refPath && ch.refStatus === 'done' ? (
                      <img
                        src={`file:///${encodeURI(ch.refPath.replace(/\\/g, '/'))}`}
                        style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: `1px solid ${color}66`, flexShrink: 0 }}
                        alt={name}
                      />
                    ) : (
                      <div style={{ width: 52, height: 52, borderRadius: 6, background: '#0f172a', border: `1px dashed ${color}44`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                        {ch.refStatus === 'generating' ? '⏳' : ch.refStatus === 'error' ? '❌' : '👤'}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.4 }}>{ch.description?.slice(0, 100)}...</div>
                  </div>
                  {/* Voice selection */}
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <select value={ch.voiceId || ''}
                      onChange={e => setCharacters(p => ({ ...p, [name]: { ...p[name], voiceId: e.target.value } }))}
                      style={{ background: '#0f172a', color: '#d1d5db', border: `1px solid ${color}44`, borderRadius: 4, padding: '3px 6px', fontSize: 10, flex: 1 }}>
                      {VOICE_LIST.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    {ch.voiceId && ch.voiceId !== 'random' && (
                      <button title="Nghe thử" onClick={async () => {
                        const res = await api.voicePreview({ voiceId: ch.voiceId, text: 'xin chào, tôi là nhân vật trong câu chuyện của bạn' });
                        if (res?.success && res.audioBase64) {
                          const audio = new Audio(`data:${res.mimeType || 'audio/mp3'};base64,${res.audioBase64}`);
                          audio.play().catch(() => {});
                        }
                      }} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>🔊</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Story input */}
        <div style={panelSt}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>📝 Kịch bản / Ý tưởng</span>
          <textarea value={story} onChange={e => setStory(e.target.value)}
            placeholder="Nhập ý tưởng hoặc kịch bản...&#10;VD: Câu chuyện tình yêu giữa Minh và Linh trong thời chiến"
            style={{ ...inputSt, height: 130, resize: 'vertical', lineHeight: 1.5 }} />
          <button onClick={handleGenerateScript} disabled={scriptBusy || !story.trim()}
            style={btnSt('#059669', scriptBusy || !story.trim())}>
            {scriptBusy ? '⏳ Đang phân tích...' : '🧠 Tạo Kịch Bản + Nhân Vật'}
          </button>
        </div>
      </div>

      {/* ── CENTER ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={handleGenerateVideos} disabled={videoBusy || !scenes.length || !outputDir}
            style={{ ...btnSt('#dc2626', videoBusy || !scenes.length || !outputDir), flex: 1 }}>
            {videoBusy ? '⏳ Đang tạo video...' : `🎥 Tạo ${scenes.length} Video Clip`}
          </button>
          {videoBusy && (
            <button onClick={() => { abortRef.current = true; }} style={{ ...btnSt('#374151', false), padding: '9px 14px' }}>⏹</button>
          )}
          <button onClick={handleMerge} disabled={mergeBusy || donePaths.length < 2}
            style={{ ...btnSt('#7c3aed', mergeBusy || donePaths.length < 2), flex: 1 }}>
            {mergeBusy ? '⏳ Đang ghép...' : `🔗 Ghép ${donePaths.length} Clips`}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scenes.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', gap: 8 }}>
              <span style={{ fontSize: 36 }}>🎬</span>
              <span style={{ fontSize: 13 }}>Nhập kịch bản → Tạo Kịch Bản + Nhân Vật → Scenes xuất hiện ở đây</span>
            </div>
          ) : scenes.map((scene, i) => {
            const borderColor = scene.status === 'done' ? '#16a34a' : scene.status === 'error' ? '#dc2626' : scene.status === 'generating' ? '#d97706' : '#1f2937';
            return (
              <div key={scene.id} style={{ background: '#111827', borderRadius: 10, padding: 12, border: `1px solid ${borderColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: '#1f2937', color: '#f97316', borderRadius: 5, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>Cảnh {i + 1}</span>
                  <span style={{ background: STATUS_COLOR[scene.status] + '22', color: STATUS_COLOR[scene.status], borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>
                    {scene.status === 'pending' ? '⏸ Chờ' : scene.status === 'generating' ? '⏳ Tạo...' : scene.status === 'done' ? '✅ Xong' : '❌ Lỗi'}
                  </span>
                  <span style={{ fontSize: 10, color: '#6b7280' }}>{scene.durationSec}s</span>
                  {/* Character tags */}
                  {scene.charactersInScene.map((name, ci) => {
                    const idx = charNames.indexOf(name);
                    const color = CHAR_COLORS[idx >= 0 ? idx % CHAR_COLORS.length : ci % CHAR_COLORS.length];
                    return (
                      <span key={name} style={{ background: color + '22', color, borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 600 }}>
                        👤 {name}
                      </span>
                    );
                  })}
                  {scene.status === 'done' && scene.videoPath && (
                    <button onClick={() => api.openFolder?.(scene.videoPath.replace(/[\\/][^\\/]+$/, ''))}
                      style={{ marginLeft: 'auto', background: '#1f2937', border: 'none', color: '#34d399', fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '2px 7px' }}>
                      📂 Mở
                    </button>
                  )}
                </div>

                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>Narration</span>
                  <textarea value={scene.narration} onChange={e => setScenes(p => p.map((s,j) => j===i ? {...s, narration: e.target.value} : s))}
                    style={{ ...inputSt, height: 44, resize: 'none', marginTop: 3, fontSize: 11 }} />
                </div>

                {/* Dialogues */}
                {(scene.dialogues?.length > 0) && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', fontWeight: 600 }}>💬 Lời thoại</span>
                      <button onClick={() => setScenes(p => p.map((s,j) => j===i ? {...s, dialogues: [...(s.dialogues||[]), { character: '', text: '' }]} : s))}
                        style={{ background: 'none', border: '1px solid #4b5563', color: '#9ca3af', borderRadius: 3, fontSize: 9, padding: '1px 6px', cursor: 'pointer' }}>+ Thêm</button>
                    </div>
                    {scene.dialogues.map((dlg, di) => {
                      const dIdx = charNames.indexOf(dlg.character);
                      const dColor = CHAR_COLORS[dIdx >= 0 ? dIdx % CHAR_COLORS.length : di % CHAR_COLORS.length];
                      return (
                        <div key={di} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 4 }}>
                          <select value={dlg.character}
                            onChange={e => setScenes(p => p.map((s,j) => j!==i ? s : { ...s, dialogues: s.dialogues.map((d,k) => k===di ? {...d, character: e.target.value} : d) }))}
                            style={{ background: '#0f172a', color: dColor, border: `1px solid ${dColor}55`, borderRadius: 4, padding: '3px 5px', fontSize: 10, width: 80, flexShrink: 0 }}>
                            <option value="">--</option>
                            {charNames.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <textarea value={dlg.text}
                            onChange={e => setScenes(p => p.map((s,j) => j!==i ? s : { ...s, dialogues: s.dialogues.map((d,k) => k===di ? {...d, text: e.target.value} : d) }))}
                            style={{ ...inputSt, flex: 1, height: 36, resize: 'none', fontSize: 11 }}
                            placeholder="Lời thoại nhân vật..." />
                          <button onClick={() => setScenes(p => p.map((s,j) => j!==i ? s : { ...s, dialogues: s.dialogues.filter((_,k) => k!==di) }))}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '2px', flexShrink: 0 }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(!scene.dialogues?.length) && (
                  <button onClick={() => setScenes(p => p.map((s,j) => j===i ? {...s, dialogues: [{ character: scene.charactersInScene[0] || '', text: '' }]} : s))}
                    style={{ background: 'none', border: '1px dashed #374151', color: '#6b7280', borderRadius: 4, fontSize: 10, padding: '3px 8px', cursor: 'pointer', marginBottom: 6, width: '100%' }}>
                    💬 Thêm lời thoại nhân vật
                  </button>
                )}

                <div>
                  <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>Video Prompt</span>
                  <textarea value={scene.videoPrompt} onChange={e => setScenes(p => p.map((s,j) => j===i ? {...s, videoPrompt: e.target.value} : s))}
                    style={{ ...inputSt, height: 56, resize: 'none', marginTop: 3, fontSize: 11, fontFamily: 'monospace' }} />
                </div>

                {scene.status === 'done' && scene.videoPath && (
                  <div style={{ marginTop: 8 }}>
                    <video
                      src={`file:///${encodeURI(scene.videoPath.replace(/\\/g, '/'))}`}
                      controls muted loop
                      style={{ width: '100%', borderRadius: 6, background: '#000', maxHeight: 180 }}
                    />
                  </div>
                )}

                {scene.error && (
                  <div style={{ marginTop: 5, fontSize: 10, color: '#ef4444', background: '#7f1d1d22', borderRadius: 4, padding: '3px 7px' }}>{scene.error}</div>
                )}

                {(scene.status === 'error' || scene.status === 'done') && (
                  <button onClick={() => regenScene(i)} style={{ ...btnSt('#374151', false), marginTop: 6, fontSize: 10, padding: '4px 10px' }}>
                    🔁 Tạo lại cảnh này
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT ── */}
      <div style={{ width: 270, minWidth: 230, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {finalVideo && (
          <div style={{ ...panelSt, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>🎉 Video hoàn chỉnh</span>
            <video src={`file:///${encodeURI(finalVideo.replace(/\\/g, '/'))}`} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
            <button onClick={() => api.openFolder?.(finalVideo.replace(/[\\/][^\\/]+$/, ''))}
              style={{ ...btnSt('#059669', false), fontSize: 11 }}>📂 Mở thư mục</button>
          </div>
        )}

        {scenes.length > 0 && (
          <div style={{ ...panelSt, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f97316' }}>📊 Tiến độ</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'Tổng', val: scenes.length, color: '#9ca3af' },
                { label: 'Xong', val: scenes.filter(s => s.status === 'done').length, color: '#22c55e' },
                { label: 'Lỗi', val: scenes.filter(s => s.status === 'error').length, color: '#ef4444' },
                { label: 'Chờ', val: scenes.filter(s => s.status === 'pending').length, color: '#6b7280' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: '#1f2937', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase' }}>{label}</div>
                </div>
              ))}
            </div>
            {(() => {
              const pct = Math.round(scenes.filter(s => s.status === 'done').length / scenes.length * 100);
              return (
                <div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>{pct}%</div>
                  <div style={{ background: '#1f2937', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', transition: 'width .3s' }} />
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ ...panelSt, flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>📋 Log</span>
            <button onClick={() => setLog('')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 10 }}>Xóa</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
            {log || <span style={{ color: '#6b7280' }}>Log sẽ hiện ở đây...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
