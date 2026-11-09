#!/usr/bin/env python3
"""Generate the built-in "Deep Sea Mood" wallpaper pack.

The artwork is fully procedural (gradients + sine-wave layers + a polygon
whale), so the output is license-clean: no third-party images or fonts.

Usage:
  python scripts/gen-assets.py [--out lib/assets/packs/default] [--ffmpeg PATH]

Static tiers are 2560x1440 WebP; dynamic tiers are 1280x720 VP9 WebM loops
(6 s at 15 fps). Videos are encoded with ffmpeg, which must be on PATH or
passed via --ffmpeg.
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W_STATIC, H_STATIC = 2560, 1440
W_VIDEO, H_VIDEO = 1280, 720
VIDEO_FPS = 15
VIDEO_FRAMES = 90  # 6 s loop

# (top, bottom, mid-glow, wave colors back->front, accent)
PALETTES = [
    {
        "top": (9, 21, 42), "bottom": (4, 10, 22), "glow": (36, 78, 140),
        "waves": [(24, 62, 110, 90), (18, 48, 92, 130), (12, 32, 66, 170)],
        "stars": 90, "whale": True, "lightning": False, "coins": False,
    },
    {
        "top": (10, 30, 56), "bottom": (5, 14, 30), "glow": (42, 120, 168),
        "waves": [(26, 92, 132, 90), (20, 68, 108, 120), (13, 46, 78, 160), (9, 30, 56, 200)],
        "stars": 70, "whale": True, "lightning": False, "coins": False,
    },
    {
        "top": (28, 20, 62), "bottom": (10, 8, 28), "glow": (126, 78, 190),
        "waves": [(60, 40, 108, 90), (46, 28, 92, 120), (32, 20, 74, 150), (20, 12, 52, 200)],
        "stars": 40, "whale": False, "lightning": False, "coins": True,
    },
    {
        "top": (78, 26, 18), "bottom": (20, 6, 6), "glow": (220, 92, 42),
        "waves": [(120, 44, 26, 70), (92, 32, 22, 100), (64, 22, 18, 140), (40, 12, 12, 190)],
        "stars": 0, "whale": False, "lightning": True, "coins": True,
    },
    {
        "top": (34, 6, 6), "bottom": (6, 2, 2), "glow": (188, 32, 32),
        "waves": [(96, 12, 12, 60), (72, 8, 8, 90), (52, 6, 6, 130), (34, 4, 4, 185)],
        "stars": 0, "whale": False, "lightning": True, "coins": True,
    },
]


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vertical_gradient(width: int, height: int, palette: dict) -> Image.Image:
    column = np.zeros((height, 1, 3), dtype=np.float32)
    for y in range(height):
        t = y / max(1, height - 1)
        eased = t ** 0.85
        column[y, 0] = mix(palette["top"], palette["bottom"], eased)
    return Image.fromarray(np.repeat(column, width, axis=1).astype(np.uint8), mode="RGB")


def add_glow(image: Image.Image, palette: dict, center: tuple[float, float], radius: float) -> None:
    width, height = image.size
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    cx, cy = center[0] * width, center[1] * height
    distance = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    falloff = np.clip(1.0 - distance / radius, 0.0, 1.0) ** 2.2
    glow = np.array(palette["glow"], dtype=np.float32)
    base = np.asarray(image, dtype=np.float32)
    blended = base + (glow - base) * (falloff[..., None] * 0.55)
    image.paste(Image.fromarray(np.clip(blended, 0, 255).astype(np.uint8), mode="RGB"))


def add_stars(image: Image.Image, count: int, phase: float) -> None:
    if count <= 0:
        return
    width, height = image.size
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    rng = np.random.default_rng(20261109)
    for index in range(count):
        x = rng.uniform(0, width)
        y = rng.uniform(0, height * 0.55)
        twinkle = 0.5 + 0.5 * math.sin(phase * 2 + index * 1.7)
        radius = 0.7 + rng.uniform(0, 1.4) * (0.6 + 0.4 * twinkle)
        alpha = int(60 + 130 * twinkle)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(220, 235, 255, alpha))
    image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))


def wave_polygon(width: int, height: int, base_y: float, amplitude: float, wavelength: float, phase: float, tilt: float) -> list[tuple[float, float]]:
    points = []
    step = max(4, width // 320)
    for x in range(0, width + step, step):
        y = base_y + amplitude * math.sin((x / wavelength) * math.tau + phase) + tilt * (x / width - 0.5)
        points.append((float(x), float(y)))
    points.append((float(width), float(height)))
    points.append((0.0, float(height)))
    return points


def draw_waves(image: Image.Image, palette: dict, phase: float, tier: int) -> None:
    width, height = image.size
    layers = palette["waves"]
    count = len(layers)
    for index, (red, green, blue, alpha) in enumerate(layers):
        layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        base = height * (0.62 + 0.08 * index / max(1, count - 1))
        amplitude = height * (0.018 + 0.012 * tier + 0.01 * index)
        wavelength = width / (1.6 + tier * 0.55 + index * 0.35)
        offset = phase * (1.0 + 0.35 * index)
        tilt = height * (0.01 + 0.015 * index)
        draw.polygon(
            wave_polygon(width, height, base, amplitude, wavelength, offset, tilt),
            fill=(red, green, blue, alpha),
        )
        image.paste(Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB"))


def draw_whale(image: Image.Image, tier: int) -> None:
    width, height = image.size
    scale = height * (0.055 + 0.006 * tier)
    cx, cy = width * 0.66, height * 0.58
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    body = (6, 10, 20, 210)
    draw.ellipse((cx - scale * 1.9, cy - scale * 0.75, cx + scale * 0.2, cy + scale * 0.75), fill=body)
    draw.polygon(
        [
            (cx - scale * 1.8, cy - scale * 0.05),
            (cx - scale * 2.9, cy - scale * 0.95),
            (cx - scale * 2.5, cy + scale * 0.05),
            (cx - scale * 2.95, cy + scale * 0.75),
        ],
        fill=body,
    )
    draw.polygon(
        [
            (cx - scale * 0.9, cy + scale * 0.2),
            (cx - scale * 1.5, cy + scale * 1.05),
            (cx - scale * 0.35, cy + scale * 0.55),
        ],
        fill=body,
    )
    # Tiny eye highlight.
    draw.ellipse((cx + scale * 0.05, cy - scale * 0.22, cx + scale * 0.2, cy - scale * 0.08), fill=(150, 190, 220, 120))
    image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))


def draw_lightning(image: Image.Image, phase: float, tier: int) -> None:
    width, height = image.size
    # Two flashes per loop, deterministic by phase.
    flash = max(0.0, math.sin(phase * 2) - 0.86) / 0.14
    if flash <= 0:
        return
    rng = np.random.default_rng(int(1000 * tier))
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    start_x = width * rng.uniform(0.15, 0.85)
    x, y = start_x, height * 0.02
    points = [(x, y)]
    while y < height * 0.55:
        x += rng.uniform(-width * 0.03, width * 0.03)
        y += height * rng.uniform(0.04, 0.09)
        points.append((x, y))
    alpha = int(150 * flash)
    draw.line(points, fill=(255, 226, 180, alpha), width=max(2, width // 480), joint="curve")
    glow = overlay.filter(ImageFilter.GaussianBlur(max(2, width // 320)))
    image.paste(Image.alpha_composite(image.convert("RGBA"), glow).convert("RGB"))


def draw_coins(image: Image.Image, phase: float, tier: int) -> None:
    width, height = image.size
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    rng = np.random.default_rng(7)
    count = 6 + tier * 4
    for index in range(count):
        x = rng.uniform(0.05, 0.95) * width
        speed = rng.uniform(0.35, 0.8)
        y = ((phase / math.tau + index / count) % 1.0) * (height * 1.15) - height * 0.1
        radius = height * rng.uniform(0.006, 0.012) * (1.0 + tier * 0.15)
        alpha = int(120 * (0.5 + 0.5 * math.sin(phase + index)))
        color = (226, 178, 74, alpha)
        draw.ellipse((x - radius, y - radius * 0.7, x + radius, y + radius * 0.7), outline=color, width=max(1, int(radius * 0.25)))
    image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))


def vignette(image: Image.Image) -> None:
    width, height = image.size
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    nx = (xx / width - 0.5) * 2
    ny = (yy / height - 0.5) * 2
    distance = np.sqrt(nx * nx + ny * ny) / math.sqrt(2)
    mask = np.clip((distance - 0.35) / 0.65, 0, 1) ** 1.6
    base = np.asarray(image, dtype=np.float32)
    darkened = base * (1.0 - 0.55 * mask[..., None])
    image.paste(Image.fromarray(np.clip(darkened, 0, 255).astype(np.uint8), mode="RGB"))


def grain(image: Image.Image, amount: float = 3.0) -> None:
    width, height = image.size
    rng = np.random.default_rng(42)
    noise = rng.normal(0, amount, (height, width, 1)).astype(np.float32)
    base = np.asarray(image, dtype=np.float32) + noise
    image.paste(Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), mode="RGB"))


def render(tier: int, width: int, height: int, phase: float) -> Image.Image:
    palette = PALETTES[tier]
    image = vertical_gradient(width, height, palette)
    add_glow(image, palette, center=(0.5, 0.08), radius=max(width, height) * 0.85)
    add_stars(image, palette["stars"], phase)
    draw_waves(image, palette, phase, tier)
    if palette["whale"]:
        draw_whale(image, tier)
    if palette["lightning"]:
        draw_lightning(image, phase, tier)
    if palette["coins"]:
        draw_coins(image, phase, tier)
    vignette(image)
    grain(image)
    return image


def encode_video(frames_dir: Path, output: Path, ffmpeg: str) -> None:
    command = [
        ffmpeg, "-y", "-loglevel", "error",
        "-framerate", str(VIDEO_FPS),
        "-i", str(frames_dir / "frame_%04d.png"),
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36",
        "-pix_fmt", "yuv420p", "-row-mt", "1", "-an",
        str(output),
    ]
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "lib" / "assets" / "packs" / "default"))
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG") or shutil.which("ffmpeg"))
    parser.add_argument("--skip-video", action="store_true")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    names = ["0-calm", "1-ripple", "2-swell", "3-storm", "4-tsunami"]

    for tier, name in enumerate(names):
        static_path = out / f"{name}.webp"
        print(f"[{tier + 1}/5] static {static_path.name} ({W_STATIC}x{H_STATIC})")
        image = render(tier, W_STATIC, H_STATIC, phase=0.0)
        image.save(static_path, "WEBP", quality=88, method=6)

        if args.skip_video:
            continue
        if not args.ffmpeg:
            print("ffmpeg not found; pass --ffmpeg or set FFMPEG", file=sys.stderr)
            return 2
        video_path = out / f"{name}.webm"
        print(f"          dynamic {video_path.name} ({W_VIDEO}x{H_VIDEO}, {VIDEO_FRAMES} frames)")
        with tempfile.TemporaryDirectory(prefix="dswp-frames-") as temporary:
            frames_dir = Path(temporary)
            for frame in range(VIDEO_FRAMES):
                phase = frame / VIDEO_FRAMES * math.tau
                frame_image = render(tier, W_VIDEO, H_VIDEO, phase)
                frame_image.save(frames_dir / f"frame_{frame + 1:04d}.png", "PNG")
            encode_video(frames_dir, video_path, args.ffmpeg)
        size_mb = video_path.stat().st_size / (1024 * 1024)
        print(f"          -> {size_mb:.2f} MiB")

    print("done:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
