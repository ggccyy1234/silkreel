"""Decode a complete video and make contact sheets for visual review."""
import argparse
import io
import json
import math
import struct
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("video", type=Path)
parser.add_argument("--ffmpeg", required=True)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--fps", type=float, help="Override source FPS; normally read from manifest.json")
parser.add_argument("--all-frames", action="store_true", help="Save every decoded frame for agent/human inspection")
parser.add_argument("--sheet-fps", type=float, default=5, help="Contact-sheet sampling rate; set to source FPS to include every frame")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((args.video.parent / 'manifest.json').read_text(encoding='utf-8'))
render = manifest['render']
fps = args.fps or render['fps']
if fps <= 0 or abs(fps - render['fps']) > 1e-6:
    raise RuntimeError('FPS must match the render manifest')
if not math.isfinite(args.sheet_fps) or args.sheet_fps <= 0:
    raise RuntimeError('Contact-sheet FPS must be positive and finite')
sheet_fps = min(fps, args.sheet_fps)
if args.all_frames:
    (args.out / 'frames').mkdir(exist_ok=True)
process = subprocess.Popen([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(args.video),
                            "-f", "image2pipe", "-vcodec", "png", "-"], stdout=subprocess.PIPE)
sampled = []
frame_number = 0
next_sample = 0.0
while True:
    signature = process.stdout.read(8)
    if not signature:
        break
    if signature != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("Invalid PNG frame in video decode")
    data = bytearray(signature)
    while True:
        header = process.stdout.read(8)
        if len(header) != 8:
            raise RuntimeError("Truncated PNG header")
        length = struct.unpack(">I", header[:4])[0]
        payload = process.stdout.read(length + 4)
        if len(payload) != length + 4:
            raise RuntimeError("Truncated PNG payload")
        data.extend(header)
        data.extend(payload)
        if header[4:] == b"IEND":
            break
    if args.all_frames:
        (args.out / 'frames' / f'frame-{frame_number:06d}.png').write_bytes(data)
    if frame_number / fps + 1e-6 >= next_sample:
        image = Image.open(io.BytesIO(data)).convert("RGB")
        image.thumbnail((480, 270))
        sampled.append((frame_number / fps, image))
        next_sample += 1 / sheet_fps
    frame_number += 1
if process.wait() != 0:
    raise RuntimeError("Video decoding failed")
expected_frames = round(render['duration'] * fps)
if frame_number != expected_frames:
    raise RuntimeError(f'Frame count mismatch: {frame_number} decoded, {expected_frames} expected')
for start in range(0, len(sampled), 20):
    sheet = Image.new("RGB", (1920, 1450), "white")
    draw = ImageDraw.Draw(sheet)
    for index, (time, image) in enumerate(sampled[start:start + 20]):
        x, y = (index % 4) * 480, (index // 4) * 290
        sheet.paste(image, (x, y + 20))
        draw.text((x + 8, y + 3), f"{time:.2f}s", fill="black")
    sheet.save(args.out / f"sheet-{start // 20 + 1}.jpg", quality=93)
(args.out / 'decode-report.json').write_text(json.dumps({
    'decodedFrames': frame_number, 'expectedFrames': expected_frames, 'sampledFrames': len(sampled),
    'sourceFps': fps, 'sheetFps': sheet_fps, 'allFramesSaved': args.all_frames, 'visualReviewComplete': False,
    'note': 'All frames decoded; contact sheets and saved PNGs still require agent/human visual inspection.'
}, indent=2), encoding='utf-8')
print(f"Decoded {frame_number} frames; generated {len(sampled)} contact-sheet samples at up to {sheet_fps:g} fps. Visual review is still required.")
