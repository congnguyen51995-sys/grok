#!/usr/bin/env python3
"""
Auto watermark detector + remover.
Uses frame variance analysis: pixels that barely change across frames = static logo.
Usage: python watermark_auto.py <folder_path> [--detect-only]
"""
import sys, os, json, glob
import cv2
import numpy as np


# cv2.imread/imwrite không xử lý được Unicode path trên Windows
# Dùng np.fromfile + imdecode / imencode + tofile thay thế
def imread(path, flags=cv2.IMREAD_COLOR):
    buf = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(buf, flags)

def imwrite(path, img, params=None):
    ext = os.path.splitext(path)[1].lower()
    encode_params = params or []
    ok, buf = cv2.imencode(ext, img, encode_params)
    if ok:
        buf.tofile(path)
    return ok


def build_variance_mask(files, h, w, n_samples=50):
    # Luôn lấy ~10 frame đầu để bắt intro logo, còn lại lấy đều từ toàn bộ
    n_head = min(10, len(files))
    head_indices = list(range(n_head))
    tail_n = max(0, min(n_samples - n_head, len(files) - n_head))
    if tail_n > 0:
        tail_indices = list(np.linspace(n_head, len(files) - 1, tail_n, dtype=int))
    else:
        tail_indices = []
    all_indices = list(dict.fromkeys(head_indices + tail_indices))  # dedupe, preserve order

    samples = []
    for i in all_indices:
        img = imread(files[i], cv2.IMREAD_GRAYSCALE)
        if img is not None and img.shape == (h, w):
            samples.append(img.astype(np.float32))

    if len(samples) < 3:
        return None

    stack = np.stack(samples, axis=0)
    variance = np.var(stack, axis=0)
    var_max = variance.max()
    if var_max < 1:
        return None

    var_norm = (variance / var_max * 255).astype(np.uint8)
    _, static_mask = cv2.threshold(var_norm, 10, 255, cv2.THRESH_BINARY_INV)

    # Only look in edge/corner zones — mở rộng để bắt logo lớn hơn
    edge_mask = np.zeros_like(static_mask)
    top_h  = int(h * 0.20)
    bot_h  = int(h * 0.14)
    side_w = int(w * 0.25)
    edge_mask[:top_h, :]      = static_mask[:top_h, :]
    edge_mask[h - bot_h:, :]  = static_mask[h - bot_h:, :]
    edge_mask[:, :side_w]     = static_mask[:, :side_w]
    edge_mask[:, w - side_w:] = static_mask[:, w - side_w:]

    k3  = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    k7  = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    k12 = cv2.getStructuringElement(cv2.MORPH_RECT, (12, 12))
    edge_mask = cv2.morphologyEx(edge_mask, cv2.MORPH_CLOSE,  k12)
    edge_mask = cv2.morphologyEx(edge_mask, cv2.MORPH_DILATE, k7)
    edge_mask = cv2.morphologyEx(edge_mask, cv2.MORPH_OPEN,   k3)

    return edge_mask


def get_regions(mask, w, h):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    max_area = w * h * 0.06
    min_area = 200
    regions = []
    for c in contours:
        rx, ry, rw, rh = cv2.boundingRect(c)
        if min_area < rw * rh < max_area:
            cx = rx + rw / 2
            cy = ry + rh / 2
            horiz = 'left' if cx < w * 0.33 else ('right' if cx > w * 0.67 else 'center')
            vert  = 'top'  if cy < h * 0.33 else ('bottom' if cy > h * 0.67 else 'middle')
            pos = f'{vert}-{horiz}' if horiz != 'center' else vert
            regions.append({'x': int(rx), 'y': int(ry), 'w': int(rw), 'h': int(rh), 'pos': pos})
    return regions


def sample_bg_color(img, rx, ry, rw, rh, pad=6):
    ih, iw = img.shape[:2]
    x0, y0 = max(0, rx - pad), max(0, ry - pad)
    x1, y1 = min(iw, rx + rw + pad), min(ih, ry + rh + pad)
    border = img[y0:y1, x0:x1].copy()
    inner_x0, inner_y0 = rx - x0, ry - y0
    inner_x1, inner_y1 = inner_x0 + rw, inner_y0 + rh
    mask_inner = np.zeros(border.shape[:2], dtype=bool)
    if inner_x0 >= 0 and inner_y0 >= 0 and inner_x1 <= border.shape[1] and inner_y1 <= border.shape[0]:
        mask_inner[inner_y0:inner_y1, inner_x0:inner_x1] = True
    pixels = border[~mask_inner]
    if len(pixels) > 0:
        return tuple(int(v) for v in np.median(pixels.reshape(-1, 3), axis=0))
    return (0, 0, 0)


def detect_and_remove(folder):
    files = sorted(glob.glob(os.path.join(folder, '*.jpg')))
    if not files:
        print('ERROR:No JPG files found', flush=True)
        return

    total = len(files)
    n_samples = min(50, total)

    first = imread(files[0], cv2.IMREAD_GRAYSCALE)
    if first is None:
        print('ERROR:Cannot read images', flush=True)
        return
    h, w = first.shape

    print(f'INFO:Phan tich {n_samples} frame mau tu {total} anh...', flush=True)

    inpaint_mask = build_variance_mask(files, h, w, n_samples)
    if inpaint_mask is None:
        print('REGIONS:[]', flush=True)
        print('INFO:Khong phat hien logo nao', flush=True)
        return

    regions = get_regions(inpaint_mask, w, h)
    print(f'REGIONS:{json.dumps(regions)}', flush=True)
    print(f'TOTAL:{total}', flush=True)

    if not regions:
        print('INFO:Khong phat hien logo nao', flush=True)
        return

    print(f'INFO:Phat hien {len(regions)} vung logo - dang xoa bang solid fill...', flush=True)

    done = 0
    for fpath in files:
        img = imread(fpath)
        if img is None:
            done += 1
            continue

        fh, fw = img.shape[:2]
        scale_x = fw / w
        scale_y = fh / h
        for r in regions:
            # Lấy màu nền từ chính frame hiện tại để xóa chính xác hơn
            color = sample_bg_color(img, int(r['x']*scale_x), int(r['y']*scale_y),
                                    int(r['w']*scale_x), int(r['h']*scale_y))
            rx = int(r['x'] * scale_x)
            ry = int(r['y'] * scale_y)
            rw = int(r['w'] * scale_x)
            rh = int(r['h'] * scale_y)
            pad = 4
            rx1 = max(0, rx - pad)
            ry1 = max(0, ry - pad)
            rx2 = min(fw, rx + rw + pad)
            ry2 = min(fh, ry + rh + pad)
            img[ry1:ry2, rx1:rx2] = color
            # Blur nhẹ viền để blend tự nhiên
            blur_pad = min(8, (rx2-rx1)//4, (ry2-ry1)//4)
            if blur_pad >= 2:
                r_slice = img[max(0,ry1-blur_pad):min(fh,ry2+blur_pad), max(0,rx1-blur_pad):min(fw,rx2+blur_pad)]
                if r_slice.size > 0:
                    k = blur_pad * 2 + 1
                    img[max(0,ry1-blur_pad):min(fh,ry2+blur_pad), max(0,rx1-blur_pad):min(fw,rx2+blur_pad)] = cv2.GaussianBlur(r_slice, (k|1, k|1), 0)

        imwrite(fpath, img, [cv2.IMWRITE_JPEG_QUALITY, 95])

        done += 1
        if done % 50 == 0 or done == total:
            print(f'PROGRESS:{done}/{total}', flush=True)

    print(f'DONE:{json.dumps({"regions": regions, "total": total})}', flush=True)


def detect_only(folder):
    files = sorted(glob.glob(os.path.join(folder, '*.jpg')))
    if not files:
        print('REGIONS:[]', flush=True)
        return

    first = imread(files[0], cv2.IMREAD_GRAYSCALE)
    if first is None:
        print('REGIONS:[]', flush=True)
        return
    h, w = first.shape

    inpaint_mask = build_variance_mask(files, h, w)
    if inpaint_mask is None:
        print('REGIONS:[]', flush=True)
        print(f'IMG_SIZE:{w}x{h}', flush=True)
        return

    regions = get_regions(inpaint_mask, w, h)
    print(f'REGIONS:{json.dumps(regions)}', flush=True)
    print(f'IMG_SIZE:{w}x{h}', flush=True)


def detect_only_dynamic(folder):
    """
    Phát hiện logo động: xuất hiện ở đầu/giữa/cuối video.
    Frames được sắp xếp theo thứ tự thời gian (intro trước, outro sau).
    Chạy variance riêng cho từng nhóm intro/middle/outro rồi hợp nhất.
    """
    files = sorted(glob.glob(os.path.join(folder, '*.jpg')))
    if not files:
        print('REGIONS:[]', flush=True)
        return

    first = imread(files[0], cv2.IMREAD_GRAYSCALE)
    if first is None:
        print('REGIONS:[]', flush=True)
        return
    h, w = first.shape

    n = len(files)
    # Chia thành 3 cửa sổ thời gian bằng nhau
    third = max(3, n // 3)
    windows = [
        files[:third],             # intro
        files[third:2*third],      # middle
        files[2*third:],           # outro
    ]

    combined_mask = np.zeros((h, w), dtype=np.uint8)
    for window_files in windows:
        if len(window_files) < 2:
            continue
        mask = build_variance_mask(window_files, h, w, n_samples=len(window_files))
        if mask is not None:
            combined_mask = cv2.bitwise_or(combined_mask, mask)

    regions = get_regions(combined_mask, w, h) if combined_mask.any() else []
    print(f'REGIONS:{json.dumps(regions)}', flush=True)
    print(f'IMG_SIZE:{w}x{h}', flush=True)


def detect_and_crop(folder):
    """Crop all frames to remove logo edges instead of inpainting."""
    files = sorted(glob.glob(os.path.join(folder, '*.jpg')))
    if not files:
        print('ERROR:No JPG files found', flush=True)
        return

    total = len(files)
    n_samples = min(50, total)

    first = imread(files[0], cv2.IMREAD_GRAYSCALE)
    if first is None:
        print('ERROR:Cannot read images', flush=True)
        return
    h, w = first.shape

    print(f'INFO:Phan tich {n_samples} frame mau tu {total} anh...', flush=True)

    inpaint_mask = build_variance_mask(files, h, w, n_samples)
    if inpaint_mask is None:
        print('REGIONS:[]', flush=True)
        print('INFO:Khong phat hien logo nao', flush=True)
        return

    regions = get_regions(inpaint_mask, w, h)
    print(f'REGIONS:{json.dumps(regions)}', flush=True)
    print(f'TOTAL:{total}', flush=True)

    if not regions:
        print('INFO:Khong phat hien logo nao — khong can cat', flush=True)
        return

    # Compute crop margins: for each region determine which edge to trim
    crop_top = crop_bot = crop_left = crop_right = 0
    for r in regions:
        rx, ry, rw, rh = r['x'], r['y'], r['w'], r['h']
        cx, cy = rx + rw / 2, ry + rh / 2
        # Top edge
        if cy < h * 0.33:
            crop_top = max(crop_top, ry + rh + 4)
        # Bottom edge
        if cy > h * 0.67:
            crop_bot = max(crop_bot, h - ry + 4)
        # Left edge
        if cx < w * 0.33:
            crop_left = max(crop_left, rx + rw + 4)
        # Right edge
        if cx > w * 0.67:
            crop_right = max(crop_right, w - rx + 4)

    # Ensure valid crop bounds
    x0 = crop_left
    x1 = w - crop_right
    y0 = crop_top
    y1 = h - crop_bot
    if x1 <= x0 or y1 <= y0:
        print('ERROR:Crop bounds invalid — regions too large', flush=True)
        return

    crop_info = {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1,
                 'orig_w': w, 'orig_h': h,
                 'new_w': x1 - x0, 'new_h': y1 - y0}
    print(f'INFO:Cat xen: x={x0}-{x1}, y={y0}-{y1} (giu lai {x1-x0}x{y1-y0} px)', flush=True)

    done = 0
    for fpath in files:
        img = imread(fpath)
        if img is None:
            done += 1
            continue

        fh, fw = img.shape[:2]
        sx = fw / w
        sy = fh / h
        fx0 = int(x0 * sx)
        fx1 = int(x1 * sx)
        fy0 = int(y0 * sy)
        fy1 = int(y1 * sy)
        cropped = img[fy0:fy1, fx0:fx1]
        imwrite(fpath, cropped, [cv2.IMWRITE_JPEG_QUALITY, 95])

        done += 1
        if done % 50 == 0 or done == total:
            print(f'PROGRESS:{done}/{total}', flush=True)

    print(f'DONE:{json.dumps({"regions": regions, "total": total, "crop": crop_info})}', flush=True)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('ERROR:Missing folder argument', flush=True)
        sys.exit(1)
    if '--detect-dynamic' in sys.argv:
        folder = next(a for a in sys.argv[1:] if not a.startswith('--'))
        detect_only_dynamic(folder)
    elif '--detect-only' in sys.argv:
        folder = next(a for a in sys.argv[1:] if not a.startswith('--'))
        detect_only(folder)
    elif '--crop' in sys.argv:
        folder = next(a for a in sys.argv[1:] if not a.startswith('--'))
        detect_and_crop(folder)
    else:
        detect_and_remove(sys.argv[1])
