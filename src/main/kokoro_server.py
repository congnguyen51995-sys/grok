"""
Kokoro TTS Server — OpenAI-compatible API (non-VI voices only)
Endpoints:
  GET  /v1/audio/voices
  POST /v1/audio/speech  { model, input, voice, speed }
  GET  /health
Vietnamese voices are handled by Node.js (msedge-tts) — not by this server.
"""
import sys, os, json, threading, io, struct, traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT       = int(os.environ.get('KOKORO_PORT', '8008'))
MODEL_DIR  = os.environ.get('KOKORO_MODEL_DIR', '')
GPU_DEVICE = os.environ.get('FLUXY_GPU_DEVICE', 'cpu')  # 'cuda' | 'directml' | 'cpu'

def _onnx_providers():
    if GPU_DEVICE == 'cuda':
        return ['CUDAExecutionProvider', 'CPUExecutionProvider']
    if GPU_DEVICE == 'directml':
        return ['DmlExecutionProvider', 'CPUExecutionProvider']
    return ['CPUExecutionProvider']

# ── Vietnamese voices metadata (synthesis done by Node.js) ──────────────────
VI_VOICES = [
    {"id": "vi_co_gai_hoat_ngon",   "name": "Cô Gái Hoạt Ngôn",   "lang": "vi", "edge_voice": "vi-VN-HoaiMyNeural"},
    {"id": "vi_gai_nho_ngot",       "name": "Nhỏ Ngọt Ngào",       "lang": "vi", "edge_voice": "vi-VN-HoaiMyNeural"},
    {"id": "vi_nu_pho_thong",       "name": "Giọng Nữ Phổ Thông",  "lang": "vi", "edge_voice": "vi-VN-HoaiMyNeural"},
    {"id": "vi_thanh_nien_tu_tin",  "name": "Thanh Niên Tự Tin",   "lang": "vi", "edge_voice": "vi-VN-NamMinhNeural"},
    {"id": "vi_gai_be",             "name": "Giọng Bé",             "lang": "vi", "edge_voice": "vi-VN-HoaiMyNeural"},
    {"id": "vi_mai",                "name": "Mai",                   "lang": "vi", "edge_voice": "vi-VN-HoaiMyNeural"},
    {"id": "vi_minh",               "name": "Minh",                  "lang": "vi", "edge_voice": "vi-VN-NamMinhNeural"},
]

VI_IDS = {v["id"] for v in VI_VOICES}

# ── Kokoro voices (EN/JA/ZH/KO/FR/ES/HI) ────────────────────────────────────
KOKORO_VOICES = [
    {"id": "af_heart",       "name": "Heart (EN-US ♀)",     "lang": "en-us"},
    {"id": "af_bella",       "name": "Bella (EN-US ♀)",     "lang": "en-us"},
    {"id": "af_nicole",      "name": "Nicole (EN-US ♀)",    "lang": "en-us"},
    {"id": "af_sarah",       "name": "Sarah (EN-US ♀)",     "lang": "en-us"},
    {"id": "af_sky",         "name": "Sky (EN-US ♀)",       "lang": "en-us"},
    {"id": "am_adam",        "name": "Adam (EN-US ♂)",      "lang": "en-us"},
    {"id": "am_michael",     "name": "Michael (EN-US ♂)",   "lang": "en-us"},
    {"id": "bf_emma",        "name": "Emma (EN-GB ♀)",      "lang": "en-gb"},
    {"id": "bf_isabella",    "name": "Isabella (EN-GB ♀)",  "lang": "en-gb"},
    {"id": "bm_george",      "name": "George (EN-GB ♂)",    "lang": "en-gb"},
    {"id": "bm_lewis",       "name": "Lewis (EN-GB ♂)",     "lang": "en-gb"},
    {"id": "jf_alpha",       "name": "Alpha (JA ♀)",        "lang": "ja"},
    {"id": "jf_gongitsune",  "name": "Gongitsune (JA ♀)",   "lang": "ja"},
    {"id": "jm_kurosawa",    "name": "Kurosawa (JA ♂)",     "lang": "ja"},
    {"id": "jm_nezha",       "name": "Nezha (JA ♂)",        "lang": "ja"},
    {"id": "zf_xiaobei",     "name": "Xiaobei (ZH ♀)",      "lang": "zh"},
    {"id": "zf_xiaoni",      "name": "Xiaoni (ZH ♀)",       "lang": "zh"},
    {"id": "zf_xiaoxiao",    "name": "Xiaoxiao (ZH ♀)",     "lang": "zh"},
    {"id": "zm_yunxi",       "name": "Yunxi (ZH ♂)",        "lang": "zh"},
    {"id": "kf_dawon",       "name": "Dawon (KO ♀)",        "lang": "ko"},
    {"id": "km_hyunwoo",     "name": "Hyunwoo (KO ♂)",      "lang": "ko"},
    {"id": "ff_siwis",       "name": "Siwis (FR ♀)",        "lang": "fr-fr"},
    {"id": "ef_dora",        "name": "Dora (ES ♀)",         "lang": "es"},
    {"id": "hf_alpha",       "name": "Alpha (HI ♀)",        "lang": "hi"},
]

LANG_MAP = {v["id"]: v["lang"] for v in KOKORO_VOICES}

_kokoro = None
_kokoro_lock = threading.Lock()

def get_kokoro():
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    with _kokoro_lock:
        if _kokoro is not None:
            return _kokoro
        import glob
        mdir = MODEL_DIR
        if not mdir or not os.path.isdir(mdir):
            raise RuntimeError("KOKORO_MODEL_DIR không hợp lệ")
        onnx_files  = glob.glob(os.path.join(mdir, '*.onnx'))
        voice_files = glob.glob(os.path.join(mdir, '*.bin'))
        if not onnx_files or not voice_files:
            raise RuntimeError(f"Không có model trong {mdir}")
        from kokoro_onnx import Kokoro
        providers = _onnx_providers()
        try:
            _kokoro = Kokoro(onnx_files[0], voice_files[0], providers=providers)
        except TypeError:
            # Phiên bản kokoro_onnx cũ không hỗ trợ providers → fallback CPU
            _kokoro = Kokoro(onnx_files[0], voice_files[0])
        print(f"[kokoro-server] Loaded: {onnx_files[0]} [device={GPU_DEVICE}, providers={providers}]", flush=True)
        return _kokoro

def synth_kokoro(text, voice_id, speed=1.0):
    import numpy as np
    lang = LANG_MAP.get(voice_id, 'en-us')
    k = get_kokoro()
    samples, sr = k.create(text, voice=voice_id, speed=speed, lang=lang)
    samples = np.array(samples, dtype=np.float32)
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767).astype(np.int16).tobytes()
    buf = io.BytesIO()
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + len(pcm)))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<I', sr))
    buf.write(struct.pack('<I', sr * 2))
    buf.write(struct.pack('<H', 2))
    buf.write(struct.pack('<H', 16))
    buf.write(b'data')
    buf.write(struct.pack('<I', len(pcm)))
    buf.write(pcm)
    return buf.getvalue(), 'audio/wav'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_audio(self, data, mime):
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            self.send_json(200, {'status': 'ok'})
        elif path == '/v1/audio/voices':
            all_voices = [
                {"id": v["id"], "name": v["name"], "lang": v["lang"]} for v in KOKORO_VOICES
            ]
            self.send_json(200, {'voices': all_voices})
        else:
            self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != '/v1/audio/speech':
            self.send_json(404, {'error': 'not found'})
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            req = json.loads(body)
        except Exception as e:
            self.send_json(400, {'error': str(e)})
            return
        text     = req.get('input', '') or req.get('text', '')
        voice_id = req.get('voice', 'af_heart')
        speed    = float(req.get('speed', 1.0))
        if not text:
            self.send_json(400, {'error': 'input is required'})
            return
        if voice_id in VI_IDS:
            # Vietnamese voices are handled by Node.js — return redirect info
            self.send_json(400, {'error': 'vi_voice', 'vi_voice': True,
                                  'message': 'Vietnamese voices handled by Node.js Edge TTS'})
            return
        try:
            data, mime = synth_kokoro(text, voice_id, speed)
            self.send_audio(data, mime)
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {'error': str(e)})

def main():
    print(f'[kokoro-server] Starting on port {PORT}', flush=True)
    srv = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f'[kokoro-server] Ready', flush=True)
    srv.serve_forever()

if __name__ == '__main__':
    main()
