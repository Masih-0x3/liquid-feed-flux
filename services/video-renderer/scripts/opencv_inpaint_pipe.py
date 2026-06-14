#!/usr/bin/env python3
import argparse
import sys

import cv2
import numpy as np


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--rect", action="append", required=True, help="x,y,w,h; may be repeated")
    parser.add_argument("--mode", choices=["fullrect", "selective", "hybrid"], default="hybrid")
    parser.add_argument("--algorithm", choices=["telea", "ns"], default="telea")
    parser.add_argument("--radius", type=float, default=2.0)
    parser.add_argument("--kernel", type=int, default=7)
    parser.add_argument("--dilate-iterations", type=int, default=2)
    parser.add_argument("--close-iterations", type=int, default=1)
    parser.add_argument("--feather", type=int, default=0)
    parser.add_argument("--max-frames", type=int, default=0)
    return parser.parse_args()


def odd_kernel_size(value):
    size = max(3, int(round(value)))
    return size if size % 2 == 1 else size + 1


def clamp_rect(rect, width, height):
    x, y, w, h = [int(round(float(part))) for part in rect.split(",")]
    x = max(0, min(width - 2, x))
    y = max(0, min(height - 2, y))
    w = max(1, min(width - x, w))
    h = max(1, min(height - y, h))
    return x, y, w, h


def fullrect_mask(shape, x, y, w, h):
    mask = np.zeros(shape, dtype=np.uint8)
    mask[y:y + h, x:x + w] = 255
    return mask


def selective_mask(frame, x, y, w, h, include_icon_box=False, kernel_size=7, dilate_iterations=2, close_iterations=1):
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    roi = frame[y:y + h, x:x + w]
    if roi.size == 0:
        return mask

    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), 5)

    blue = ((hsv[:, :, 0] >= 88) & (hsv[:, :, 0] <= 108) & (hsv[:, :, 1] >= 55) & (hsv[:, :, 2] >= 70))
    light_edges = ((gray.astype(np.int16) - blur.astype(np.int16)) >= 8) & (gray >= 118)
    pale_text = (gray >= 138) & (hsv[:, :, 1] <= 75)
    local = np.where(blue | light_edges | pale_text, 255, 0).astype(np.uint8)

    local = cv2.medianBlur(local, 3)
    if include_icon_box:
        icon_x2 = max(1, int(round(w * 0.30)))
        icon_y1 = max(0, int(round(h * 0.10)))
        icon_y2 = min(h, int(round(h * 0.86)))
        local[icon_y1:icon_y2, 0:icon_x2] = 255

    kernel_size = odd_kernel_size(kernel_size)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    if dilate_iterations > 0:
        local = cv2.dilate(local, kernel, iterations=dilate_iterations)
    if close_iterations > 0:
        local = cv2.morphologyEx(local, cv2.MORPH_CLOSE, kernel, iterations=close_iterations)
    mask[y:y + h, x:x + w] = local
    return mask


def inpaint_method(name):
    return cv2.INPAINT_NS if name == "ns" else cv2.INPAINT_TELEA


def feather_blend(original, inpainted, mask, feather):
    if feather <= 0:
        return inpainted
    size = odd_kernel_size(feather * 2 + 1)
    alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (size, size), 0)
    alpha = np.expand_dims(np.clip(alpha, 0.0, 1.0), axis=2)
    blended = original.astype(np.float32) * (1.0 - alpha) + inpainted.astype(np.float32) * alpha
    return np.clip(blended, 0, 255).astype(np.uint8)


def build_mask(frame, rects, args):
    combined = np.zeros(frame.shape[:2], dtype=np.uint8)
    frame_area = max(1, frame.shape[0] * frame.shape[1])
    for x, y, w, h in rects:
        large_translucent_region = args.mode == "hybrid" and (w * h / frame_area) >= 0.06
        if args.mode == "fullrect" or large_translucent_region:
            mask = fullrect_mask(frame.shape[:2], x, y, w, h)
        else:
            mask = selective_mask(
                frame,
                x,
                y,
                w,
                h,
                include_icon_box=args.mode == "hybrid",
                kernel_size=args.kernel,
                dilate_iterations=args.dilate_iterations,
                close_iterations=args.close_iterations,
            )
        combined = cv2.bitwise_or(combined, mask)
    return combined


def main():
    args = parse_args()
    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        raise SystemExit(f"failed to open {args.input}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    rects = [clamp_rect(rect, width, height) for rect in args.rect]
    method = inpaint_method(args.algorithm)
    frames = 0

    while True:
        if args.max_frames > 0 and frames >= args.max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break
        mask = build_mask(frame, rects, args)
        inpainted = cv2.inpaint(frame, mask, args.radius, method)
        frame = feather_blend(frame, inpainted, mask, args.feather)
        sys.stdout.buffer.write(frame.tobytes())
        frames += 1

    cap.release()


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
