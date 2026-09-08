#!/usr/bin/env python3
"""
Tách nhạc nền — giữ Vocals, bỏ nhạc nền.
Ưu tiên: htdemucs_ft (Demucs fine-tuned, chính xác nhất)
Fallback: UVR-MDX-NET-Voc_FT.onnx (audio-separator)
Usage: python audio_separate.py <input_path> <output_dir> [model_name]
Output JSON: {"vocals": "path", "instrumental": "path"}
"""
import sys, os, json, glob

def separate_demucs(input_path, output_dir, model='htdemucs_ft'):
    """Dùng Facebook Demucs — tách 4 stems, giữ vocals."""
    import subprocess, shutil
    gpu_device = os.environ.get('FLUXY_GPU_DEVICE', 'cpu')
    device_flag = 'cuda' if gpu_device == 'cuda' else 'cpu'
    cmd = [
        sys.executable, '-m', 'demucs',
        '--two-stems=vocals',   # chỉ tách vocals vs no_vocals
        '-n', model,
        '-o', output_dir,
        '--device', device_flag,
        '--mp3',                # output mp3 để nhẹ hơn wav
        input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-600:])

    # Demucs output: output_dir/<model>/<stem_name>/vocals.mp3 + no_vocals.mp3
    base = os.path.splitext(os.path.basename(input_path))[0]
    stem_dir = os.path.join(output_dir, model, base)

    vocals_path = None
    inst_path   = None
    for ext in ('mp3', 'wav', 'flac'):
        v = os.path.join(stem_dir, f'vocals.{ext}')
        n = os.path.join(stem_dir, f'no_vocals.{ext}')
        if os.path.exists(v):   vocals_path = v
        if os.path.exists(n):   inst_path   = n
        if vocals_path: break

    if not vocals_path:
        # Fallback tìm bất kỳ file nào có "vocal" trong tên
        matches = glob.glob(os.path.join(stem_dir, '*vocal*'))
        if matches: vocals_path = matches[0]

    if not vocals_path:
        raise FileNotFoundError(f'Không tìm thấy file vocals trong {stem_dir}')

    return vocals_path, inst_path

def separate_uvr(input_path, output_dir, model='UVR-MDX-NET-Voc_FT.onnx'):
    """Fallback: dùng audio-separator (UVR models)."""
    from audio_separator.separator import Separator
    sep = Separator(
        output_dir=output_dir,
        output_format='WAV',
        normalization_threshold=0.9,
        log_level=30,
    )
    sep.load_model(model_filename=model)
    outputs = sep.separate(input_path)

    vocals_path = None
    inst_path   = None
    for f in outputs:
        fl = f.lower()
        if 'vocal' in fl:
            vocals_path = f
        elif 'instru' in fl or 'accomp' in fl or 'no_vocal' in fl or 'music' in fl:
            inst_path = f
    if not vocals_path and outputs:
        vocals_path = outputs[0]
    return vocals_path, inst_path

def separate(input_path, output_dir, model='htdemucs_ft'):
    os.makedirs(output_dir, exist_ok=True)

    # Thử Demucs trước
    if model in ('htdemucs_ft', 'htdemucs', 'mdx_extra', 'mdx_extra_q'):
        try:
            vocals, inst = separate_demucs(input_path, output_dir, model)
            print(json.dumps({'vocals': vocals, 'instrumental': inst}))
            return
        except ModuleNotFoundError:
            # Demucs chưa cài → fallback UVR
            pass
        except Exception as e:
            print(json.dumps({'error': f'Demucs lỗi: {e}'}))
            sys.exit(1)

    # Fallback audio-separator (UVR)
    uvr_model = 'UVR-MDX-NET-Voc_FT.onnx' if model == 'htdemucs_ft' else model
    try:
        vocals, inst = separate_uvr(input_path, output_dir, uvr_model)
        print(json.dumps({'vocals': vocals, 'instrumental': inst}))
    except ImportError:
        print(json.dumps({'error': 'Chưa cài demucs hoặc audio-separator. Chạy: pip install demucs'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({'error': 'Usage: audio_separate.py <input> <output_dir> [model]'}))
        sys.exit(1)
    separate(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'htdemucs_ft')
