import sys
import json
import os

def main():
    frames_dir = sys.argv[1]
    lang_list = sys.argv[2].split(',') if len(sys.argv) > 2 else ['ch_sim', 'en']

    try:
        import easyocr
    except ImportError:
        print(json.dumps({"error": "easyocr_not_installed"}))
        sys.exit(1)

    try:
        import torch
        use_gpu = torch.cuda.is_available()
    except ImportError:
        use_gpu = False
    sys.stderr.write(f"GPU: {'YES (CUDA)' if use_gpu else 'NO (CPU)'}\n")
    sys.stderr.flush()
    reader = easyocr.Reader(lang_list, gpu=use_gpu, verbose=False)

    files = sorted([f for f in os.listdir(frames_dir) if f.endswith('.jpg')])
    results = []

    for fname in files:
        fpath = os.path.join(frames_dir, fname)
        try:
            detections = reader.readtext(fpath, detail=1, paragraph=False)
            # Lọc confidence > 0.4, lấy text có CJK
            texts = []
            for (bbox, text, conf) in detections:
                if conf >= 0.4 and text.strip():
                    cjk_count = len([c for c in text if '一' <= c <= '鿿' or '㐀' <= c <= '䶿'])
                    if cjk_count >= 2:
                        texts.append(text.strip())
            results.append({"file": fname, "text": " ".join(texts)})
        except Exception as e:
            results.append({"file": fname, "text": "", "err": str(e)})

        # Flush mỗi 10 frame để main process biết tiến độ
        if len(results) % 10 == 0:
            sys.stderr.write(f"PROGRESS:{len(results)}/{len(files)}\n")
            sys.stderr.flush()

    print(json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
