"""
Kokoro TTS synthesis script.
Usage:
  python kokoro_tts.py synthesize  --text "Hello" --voice af_heart --lang en-us --speed 1.0 --out output.wav
  python kokoro_tts.py synthesize-srt --segments '[{"text":"Hi","startMs":0,"endMs":1000}]' --voice af_heart --lang en-us --speed 1.0 --out output.wav
  python kokoro_tts.py voices
"""
import sys, os, json, argparse, struct, io, math

def find_model_dir():
    """Find kokoro model directory from env or default."""
    env = os.environ.get('KOKORO_MODEL_DIR', '')
    if env and os.path.isdir(env):
        return env
    # Default: same folder as this script
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kokoro_models')

def find_models(model_dir):
    import glob
    onnx_files = glob.glob(os.path.join(model_dir, '*.onnx'))
    voice_files = glob.glob(os.path.join(model_dir, '*.bin'))
    onnx = onnx_files[0] if onnx_files else None
    voices = voice_files[0] if voice_files else None
    return onnx, voices

def pcm_to_wav(pcm_data, sample_rate=24000, channels=1, bits=16):
    """Convert raw PCM float32 array to WAV bytes."""
    import numpy as np
    if isinstance(pcm_data, (list, )):
        pcm_data = np.array(pcm_data, dtype=np.float32)
    # Clip and convert to int16
    pcm_int16 = np.clip(pcm_data, -1.0, 1.0)
    pcm_int16 = (pcm_int16 * 32767).astype(np.int16)
    raw = pcm_int16.tobytes()

    buf = io.BytesIO()
    data_size = len(raw)
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + data_size))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))         # PCM
    buf.write(struct.pack('<H', channels))
    buf.write(struct.pack('<I', sample_rate))
    buf.write(struct.pack('<I', sample_rate * channels * bits // 8))
    buf.write(struct.pack('<H', channels * bits // 8))
    buf.write(struct.pack('<H', bits))
    buf.write(b'data')
    buf.write(struct.pack('<I', data_size))
    buf.write(raw)
    return buf.getvalue()

def make_silence(sample_rate, duration_ms):
    """Return numpy array of silence."""
    import numpy as np
    n = int(sample_rate * duration_ms / 1000)
    return np.zeros(n, dtype=np.float32)

def cmd_voices():
    voices = {
        "en-us": [
            {"id": "af_heart",   "name": "♀ Heart (Mỹ)",   "gender": "F"},
            {"id": "af_bella",   "name": "♀ Bella (Mỹ)",   "gender": "F"},
            {"id": "af_nicole",  "name": "♀ Nicole (Mỹ)",  "gender": "F"},
            {"id": "af_sarah",   "name": "♀ Sarah (Mỹ)",   "gender": "F"},
            {"id": "af_sky",     "name": "♀ Sky (Mỹ)",     "gender": "F"},
            {"id": "am_adam",    "name": "♂ Adam (Mỹ)",    "gender": "M"},
            {"id": "am_michael", "name": "♂ Michael (Mỹ)", "gender": "M"},
        ],
        "en-gb": [
            {"id": "bf_emma",    "name": "♀ Emma (Anh)",    "gender": "F"},
            {"id": "bf_isabella","name": "♀ Isabella (Anh)","gender": "F"},
            {"id": "bm_george",  "name": "♂ George (Anh)",  "gender": "M"},
            {"id": "bm_lewis",   "name": "♂ Lewis (Anh)",   "gender": "M"},
        ],
        "ja": [
            {"id": "jf_alpha",      "name": "♀ Alpha (Nhật)",     "gender": "F"},
            {"id": "jf_gongitsune", "name": "♀ Gongitsune (Nhật)","gender": "F"},
            {"id": "jm_kurosawa",   "name": "♂ Kurosawa (Nhật)",  "gender": "M"},
            {"id": "jm_nezha",      "name": "♂ Nezha (Nhật)",     "gender": "M"},
        ],
        "zh": [
            {"id": "zf_xiaobei",  "name": "♀ Xiaobei (TQ)",  "gender": "F"},
            {"id": "zf_xiaoni",   "name": "♀ Xiaoni (TQ)",   "gender": "F"},
            {"id": "zf_xiaoxiao", "name": "♀ Xiaoxiao (TQ)", "gender": "F"},
            {"id": "zf_xiaoyi",   "name": "♀ Xiaoyi (TQ)",   "gender": "F"},
            {"id": "zm_yunxi",    "name": "♂ Yunxi (TQ)",    "gender": "M"},
            {"id": "zm_yunye",    "name": "♂ Yunye (TQ)",    "gender": "M"},
        ],
        "ko": [
            {"id": "kf_dawon",   "name": "♀ Dawon (Hàn)",   "gender": "F"},
            {"id": "km_hyunwoo", "name": "♂ Hyunwoo (Hàn)", "gender": "M"},
        ],
        "fr-fr": [
            {"id": "ff_siwis",  "name": "♀ Siwis (Pháp)",  "gender": "F"},
        ],
        "es": [
            {"id": "ef_dora",   "name": "♀ Dora (TBN)",    "gender": "F"},
            {"id": "em_alex",   "name": "♂ Alex (TBN)",    "gender": "M"},
        ],
        "hi": [
            {"id": "hf_alpha",  "name": "♀ Alpha (Hindi)", "gender": "F"},
            {"id": "hm_omega",  "name": "♂ Omega (Hindi)", "gender": "M"},
        ],
        "it": [
            {"id": "if_sara",   "name": "♀ Sara (Ý)",      "gender": "F"},
            {"id": "im_nicola", "name": "♂ Nicola (Ý)",    "gender": "M"},
        ],
        "pt-br": [
            {"id": "pf_dora",   "name": "♀ Dora (BR)",     "gender": "F"},
            {"id": "pm_alex",   "name": "♂ Alex (BR)",     "gender": "M"},
        ],
    }
    print(json.dumps({"success": True, "voices": voices}))

def load_kokoro(model_dir):
    from kokoro_onnx import Kokoro
    onnx, voices_bin = find_models(model_dir)
    if not onnx or not voices_bin:
        raise FileNotFoundError(f"Không tìm thấy model trong {model_dir}. Cài Kokoro trước.")
    return Kokoro(onnx, voices_bin)

def cmd_synthesize(args):
    import numpy as np
    model_dir = find_model_dir()
    kokoro = load_kokoro(model_dir)
    samples, sr = kokoro.create(args.text, voice=args.voice, speed=args.speed, lang=args.lang)
    wav = pcm_to_wav(np.array(samples, dtype=np.float32), sr)
    with open(args.out, 'wb') as f:
        f.write(wav)
    print(json.dumps({"success": True, "path": args.out, "sampleRate": sr}))

def cmd_synthesize_srt(args):
    import numpy as np
    model_dir = find_model_dir()
    kokoro = load_kokoro(model_dir)
    segments = json.loads(args.segments)
    total = len(segments)

    all_audio = []
    sr = 24000
    success_count = 0

    for i, seg in enumerate(segments):
        text = (seg.get('text') or '').strip()
        start_ms = seg.get('startMs', 0)
        end_ms   = seg.get('endMs', start_ms + 1000)

        # Log progress mỗi 5 đoạn
        if i % 5 == 0 or i == total - 1:
            print(json.dumps({"progress": True, "done": i, "total": total}), flush=True)

        if not text:
            # Điền silence cho segment rỗng
            dur = max(0, end_ms - start_ms)
            all_audio.append(make_silence(sr, dur))
            continue

        try:
            samples, sr = kokoro.create(text, voice=args.voice, speed=args.speed, lang=args.lang)
            seg_audio = np.array(samples, dtype=np.float32)

            # Trim/pad để khớp duration của segment
            target_samples = int(sr * (end_ms - start_ms) / 1000)
            if len(seg_audio) > target_samples:
                seg_audio = seg_audio[:target_samples]
            elif len(seg_audio) < target_samples:
                pad = np.zeros(target_samples - len(seg_audio), dtype=np.float32)
                seg_audio = np.concatenate([seg_audio, pad])

            all_audio.append(seg_audio)
            success_count += 1
        except Exception as e:
            print(json.dumps({"warn": f"Segment {i+1} lỗi: {str(e)}"}), flush=True)
            dur = max(500, end_ms - start_ms)
            all_audio.append(make_silence(sr, dur))

    combined = np.concatenate(all_audio) if all_audio else np.zeros(sr, dtype=np.float32)
    wav = pcm_to_wav(combined, sr)
    with open(args.out, 'wb') as f:
        f.write(wav)
    print(json.dumps({"success": True, "path": args.out, "successCount": success_count, "total": total, "sampleRate": sr}))

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd')

    sub.add_parser('voices')

    p_syn = sub.add_parser('synthesize')
    p_syn.add_argument('--text',  required=True)
    p_syn.add_argument('--voice', default='af_heart')
    p_syn.add_argument('--lang',  default='en-us')
    p_syn.add_argument('--speed', type=float, default=1.0)
    p_syn.add_argument('--out',   required=True)

    p_srt = sub.add_parser('synthesize-srt')
    p_srt.add_argument('--segments', required=True)
    p_srt.add_argument('--voice',    default='af_heart')
    p_srt.add_argument('--lang',     default='en-us')
    p_srt.add_argument('--speed',    type=float, default=1.0)
    p_srt.add_argument('--out',      required=True)

    args = parser.parse_args()
    if args.cmd == 'voices':
        cmd_voices()
    elif args.cmd == 'synthesize':
        cmd_synthesize(args)
    elif args.cmd == 'synthesize-srt':
        cmd_synthesize_srt(args)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
