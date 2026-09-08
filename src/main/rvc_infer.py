#!/usr/bin/env python3
"""
Voice Transform — bypass ContentID audio fingerprint.
Dùng pedalboard (Spotify) thay vì rvc-python (không tương thích Python 3.12).
Pipeline: pitch shift mạnh + chorus + reverb + formant warp + spectral noise.
"""
import sys
import json
import os
import random


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'No args'}))
        return

    args = json.loads(sys.argv[1])
    cmd = args.get('cmd', 'infer')

    # ── Check ─────────────────────────────────────────────────────────────────
    if cmd == 'check':
        missing = []
        versions = {}
        for pkg in ['pedalboard', 'librosa', 'soundfile', 'numpy']:
            try:
                m = __import__(pkg)
                versions[pkg] = getattr(m, '__version__', 'ok')
            except ImportError:
                missing.append(pkg)

        if missing:
            print(json.dumps({'ok': False, 'error': f"Thiếu: {', '.join(missing)}", 'missing': missing}))
        else:
            print(json.dumps({'ok': True, 'device': 'cpu', 'versions': versions}))
        return

    # ── Install ───────────────────────────────────────────────────────────────
    if cmd == 'install':
        import subprocess

        def pip(*pkgs):
            r = subprocess.run(
                [sys.executable, '-m', 'pip', 'install', *pkgs, '--no-warn-script-location', '-q'],
                capture_output=True, text=True
            )
            return r

        print(json.dumps({'ok': True, 'progress': 'Nâng cấp pip...'}), flush=True)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip', '-q'], capture_output=True)

        print(json.dumps({'ok': True, 'progress': 'Cài pedalboard (Spotify) + librosa + soundfile...'}), flush=True)
        r = pip('pedalboard', 'librosa', 'soundfile')
        if r.returncode != 0:
            print(json.dumps({'ok': False, 'error': f'Cài lỗi: {r.stderr[-300:]}'}))
            return

        print(json.dumps({'ok': True, 'done': True}))
        return

    # ── Infer: voice transform ─────────────────────────────────────────────────
    if cmd == 'infer':
        import numpy as np
        import soundfile as sf
        import librosa
        from pedalboard import Pedalboard, PitchShift, Chorus, Reverb, Compressor, HighpassFilter, LowpassFilter

        input_path  = args['input']
        output_path = args['output']
        pitch       = int(args.get('pitch', 0))        # semitone do user chọn
        mode        = args.get('mode', 'medium')       # light / medium / strong

        if not os.path.exists(input_path):
            print(json.dumps({'ok': False, 'error': f'Input không tìm thấy: {input_path}'}))
            return

        print(json.dumps({'ok': True, 'progress': 'Đang load audio...'}), flush=True)
        y, sr = librosa.load(input_path, sr=None, mono=False)
        if y.ndim == 1:
            y = y[np.newaxis, :]  # mono → (1, N)

        # ── Tính pitch shift thực tế: user pitch + random offset ──────────────
        # Thêm random offset ±1-3 st để mỗi video khác nhau
        rand_ranges = {'light': 1, 'medium': 2, 'strong': 3}
        rand_offset = random.uniform(-rand_ranges.get(mode, 2), rand_ranges.get(mode, 2))
        # Nếu user không chọn pitch (=0), dùng mạnh hơn để đảm bảo bypass
        if pitch == 0:
            base_pitch = random.choice([-4, -3, 3, 4])  # ±3-4 st: vượt ngưỡng ContentID
        else:
            base_pitch = pitch
        final_pitch = base_pitch + rand_offset

        print(json.dumps({'ok': True, 'progress': f'Pitch shift {final_pitch:+.1f} semitone + effects...'}), flush=True)

        # ── Build pedalboard effect chain ──────────────────────────────────────
        intensity = {'light': 0.4, 'medium': 0.7, 'strong': 1.0}.get(mode, 0.7)

        board = Pedalboard([
            # 1. Pitch shift mạnh — ContentID không chịu được >±2.5st
            PitchShift(semitones=final_pitch),
            # 2. Chorus — phase modulation → phá waveform pattern
            Chorus(rate_hz=0.5 * intensity, depth=0.15 * intensity, centre_delay_ms=7.0,
                   feedback=0.1 * intensity, mix=0.3 * intensity),
            # 3. Reverb nhẹ — thay đổi spectral envelope tail
            Reverb(room_size=0.15 * intensity, damping=0.5, wet_level=0.12 * intensity,
                   dry_level=1.0, width=0.5),
            # 4. Compressor — thay đổi dynamic envelope (waveform shape)
            Compressor(threshold_db=-18, ratio=2.5, attack_ms=5.0, release_ms=100.0),
        ])

        # Xử lý từng channel
        processed = board(y, sr)

        # ── Formant warp: time-stretch nhẹ rồi resample lại ──────────────────
        # Stretch 1-3% → resample về sr gốc → độ dài giữ nguyên nhưng formant dịch
        stretch_factor = 1.0 + random.uniform(0.01, 0.03) * (1 if random.random() > 0.5 else -1)
        if processed.ndim == 2:
            channels = []
            for ch in processed:
                stretched = librosa.effects.time_stretch(ch, rate=stretch_factor)
                # Resample về đúng độ dài gốc
                target_len = y.shape[-1]
                if len(stretched) != target_len:
                    stretched = librosa.resample(stretched, orig_sr=int(sr * stretch_factor), target_sr=sr)
                    stretched = stretched[:target_len]
                    if len(stretched) < target_len:
                        stretched = np.pad(stretched, (0, target_len - len(stretched)))
                channels.append(stretched)
            processed = np.stack(channels)

        print(json.dumps({'ok': True, 'progress': 'Đang ghi file output...'}), flush=True)

        # Ghi output: soundfile cần (N, channels) hoặc (N,) cho mono
        out_data = processed.T if processed.ndim == 2 else processed
        sf.write(output_path, out_data, sr, subtype='PCM_16')

        print(json.dumps({'ok': True, 'output': output_path,
                          'pitch': round(final_pitch, 1), 'stretch': round(stretch_factor, 4)}))
        return

    print(json.dumps({'ok': False, 'error': f'Unknown cmd: {cmd}'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        import traceback
        print(json.dumps({'ok': False, 'error': str(exc), 'trace': traceback.format_exc()}))
        sys.exit(1)
