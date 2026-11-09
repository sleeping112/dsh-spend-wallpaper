#!/usr/bin/env python3
"""Generate the built-in "Deep Sea Mood" wallpaper pack (v2 artwork).

The artwork is fully procedural (numpy noise + PIL shapes + ffmpeg encoding),
so the output is license-clean: no third-party images or fonts.

Five scenes, one per spending tier:
  0 calm     — aurora over a polar sea
  1 ripple   — moonlit water with whale silhouettes
  2 swell    — violet sunset sea with a small boat
  3 storm    — lightning, lighthouse beam, rough water
  4 tsunami  — red-black tidal wave with embers and lightning

Usage:
  python scripts/gen-assets.py [--out lib/assets/packs/default] [--skip-video]
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W_STATIC, H_STATIC = 2560, 1440
W_VIDEO, H_VIDEO = 960, 540
VIDEO_FPS = 12
VIDEO_FRAMES = 40  # 3.33 s loop

TAU = math.tau


# --------------------------------------------------------------------------- helpers

def rgb(hex_color: str) -> np.ndarray:
    value = hex_color.lstrip("#")
    return np.array([int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)], dtype=np.float32) / 255.0


def lerp(a: np.ndarray, b: np.ndarray, t: np.ndarray | float) -> np.ndarray:
    return a * (1 - t) + b * t


def smooth_noise(width: int, height: int, scale: float, seed: int, octaves: int = 4) -> np.ndarray:
    rng = np.random.default_rng(seed)
    accumulator = np.zeros((height, width), dtype=np.float32)
    amplitude = 1.0
    total = 0.0
    for octave in range(octaves):
        small_h = max(2, int(height / (scale * (2 ** octave))))
        small_w = max(2, int(width / (scale * (2 ** octave))))
        grid = rng.random((small_h, small_w)).astype(np.float32)
        upscaled = np.asarray(
            Image.fromarray((grid * 255).astype(np.uint8)).resize((width, height), Image.BICUBIC),
            dtype=np.float32,
        ) / 255.0
        accumulator += upscaled * amplitude
        total += amplitude
        amplitude *= 0.5
    accumulator /= total
    minimum, maximum = float(accumulator.min()), float(accumulator.max())
    return (accumulator - minimum) / max(1e-6, maximum - minimum)


def blur_mask(mask: np.ndarray, radius: float) -> np.ndarray:
    if radius <= 0:
        return mask
    image = Image.fromarray(np.clip(mask * 255, 0, 255).astype(np.uint8))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0


@lru_cache(maxsize=64)
def cached_noise(width: int, height: int, scale: float, seed: int, octaves: int = 4) -> np.ndarray:
    return smooth_noise(width, height, scale, seed, octaves)


@lru_cache(maxsize=32)
def cached_stars(width: int, height: int, density: float, seed: int, horizon: float) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    count = int(density * width * height / 4000)
    if count <= 0:
        return np.zeros((height, width), dtype=np.float32), np.zeros((height, width), dtype=np.float32)
    xs = rng.uniform(0, 1, count)
    ys = rng.uniform(0, horizon * 0.92, count)
    brightness = rng.uniform(0.25, 1.0, count)
    layer = np.zeros((height, width), dtype=np.float32)
    xi = np.clip((xs * (width - 1)).astype(int), 0, width - 1)
    yi = np.clip((ys * (height - 1)).astype(int), 0, height - 1)
    layer[yi, xi] = brightness
    return layer, blur_mask(layer, max(1.0, width / 640))


@lru_cache(maxsize=8)
def cached_vignette(width: int, height: int) -> np.ndarray:
    ys = np.linspace(0, 1, height, dtype=np.float32)
    xs = np.linspace(0, 1, width, dtype=np.float32)
    x_grid, y_grid = np.meshgrid(xs, ys)
    distance = np.sqrt(((x_grid - 0.5) * 2) ** 2 + ((y_grid - 0.5) * 2) ** 2) / math.sqrt(2)
    return np.clip((distance - 0.32) / 0.68, 0, 1) ** 1.5


@lru_cache(maxsize=8)
def cached_grain(width: int, height: int, seed: int = 42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.normal(0, 2.2 / 255, (height, width, 3)).astype(np.float32)


@lru_cache(maxsize=16)
def cached_rain(width: int, height: int, seed: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    layer = np.zeros((height, width), dtype=np.float32)
    count = max(400, width * height // 900)
    for _ in range(count):
        start_x = int(rng.integers(0, width))
        start_y = int(rng.integers(0, height))
        length = int(rng.integers(10, 30))
        slope = rng.uniform(0.25, 0.5)
        for step in range(length):
            x = start_x + int(step * slope)
            y = start_y + step
            if 0 <= x < width and y < height:
                layer[y, x] += rng.uniform(0.25, 0.8)
    return blur_mask(layer, 1)


@lru_cache(maxsize=16)
def cached_spray(width: int, height: int, seed: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    count = max(120, width // 12)
    xs = rng.uniform(0.22, 1.0, count)
    offsets = rng.uniform(0.005, 0.075, count) ** 1.3
    sizes = rng.uniform(0.6, 2.2, count) * (width / 1280)
    return xs, offsets, sizes


@lru_cache(maxsize=32)
def cached_silhouette(kind: str, width: int, height: int, x: float, y: float, scale: float,
                      color: tuple[int, int, int, int]) -> tuple[np.ndarray, np.ndarray]:
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    w, h = width, height
    if kind == "whale":
        cx, cy, radius = x * w, y * h, scale * h
        # Rounded head/body with a small fluke tail and one pectoral fin.
        draw.ellipse((cx - radius * 2.25, cy - radius * 0.75, cx + radius * 0.2, cy + radius * 0.75), fill=color)
        draw.polygon([(cx - radius * 2.1, cy - 0.05 * radius), (cx - radius * 2.85, cy - radius * 0.7),
                      (cx - radius * 2.55, cy), (cx - radius * 2.9, cy + radius * 0.62),
                      (cx - radius * 2.1, cy + 0.12 * radius)], fill=color)
        draw.polygon([(cx - radius * 0.75, cy + radius * 0.2), (cx - radius * 1.35, cy + radius * 0.85),
                      (cx - radius * 0.2, cy + radius * 0.5)], fill=color)
    elif kind == "boat":
        cx, cy, radius = x * w, y * h, scale * h
        draw.polygon([(cx - radius * 1.8, cy), (cx + radius * 1.8, cy), (cx + radius * 1.1, cy + radius * 0.55),
                      (cx - radius * 1.1, cy + radius * 0.55)], fill=color)
        draw.line([(cx, cy), (cx, cy - radius * 2.2)], fill=color, width=max(2, int(radius * 0.08)))
        draw.polygon([(cx, cy - radius * 2.2), (cx + radius * 1.35, cy - radius * 0.45), (cx, cy - radius * 0.45)], fill=color)
        draw.polygon([(cx, cy - radius * 1.7), (cx - radius * 1.0, cy - radius * 0.5), (cx, cy - radius * 0.5)],
                     fill=(color[0] + 18, color[1] + 22, color[2] + 28, color[3]))
    elif kind == "lighthouse":
        cx, cy, radius = x * w, y * h, scale * h
        draw.polygon([(cx - radius * 0.6, cy), (cx + radius * 0.6, cy),
                      (cx + radius * 0.32, cy - radius * 2.6), (cx - radius * 0.32, cy - radius * 2.6)], fill=color)
        draw.rectangle((cx - radius * 0.48, cy - radius * 3.05, cx + radius * 0.48, cy - radius * 2.6), fill=color)
        draw.ellipse((cx - radius * 0.23, cy - radius * 2.98, cx + radius * 0.23, cy - radius * 2.6),
                     fill=(255, 226, 150, 255))
        beam = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        beam_draw = ImageDraw.Draw(beam)
        beam_draw.polygon([(cx, cy - radius * 2.8), (cx + radius * 9.0, cy - radius * 4.6),
                           (cx + radius * 9.0, cy - radius * 1.0)], fill=(255, 226, 150, 30))
        beam = beam.filter(ImageFilter.GaussianBlur(max(4, radius * 0.35)))
        layer = Image.alpha_composite(layer, beam)
        draw = ImageDraw.Draw(layer)
        # Rocky base under the tower.
        rocks = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        rock_draw = ImageDraw.Draw(rocks)
        rock_draw.ellipse((cx - radius * 1.6, cy - radius * 0.25, cx + radius * 1.8, cy + radius * 0.55),
                          fill=(2, 7, 10, 255))
        layer = Image.alpha_composite(layer, rocks)
    elif kind == "wave":
        horizon = y * h
        peak_y = horizon - scale * h * 0.9
        peak_x = 0.68 * w
        points = []
        for step in range(96):
            t = step / 95
            xx = t * w
            envelope = math.sin(math.pi * min(1.0, t / 0.94)) ** 1.15
            yy = horizon - (horizon - peak_y) * envelope
            points.append((xx, yy))
        polygon = points + [(w, h), (0, h)]
        draw.polygon(polygon, fill=(9, 2, 2, 248))
        # Glow under the crest, then the bright crest line itself.
        draw.line(points, fill=(255, 120, 40, 55), width=max(8, int(w / 220)))
        draw.line(points, fill=(255, 150, 70, 210), width=max(3, int(w / 620)))
        rng = np.random.default_rng(77)
        for index in range(140):
            t = rng.uniform(0.05, 0.95)
            px = t * w
            envelope = math.sin(math.pi * min(1.0, t / 0.94)) ** 1.15
            py = horizon - (horizon - peak_y) * envelope
            size = rng.uniform(0.4, 1.6) * (w / 2560)
            draw.ellipse((px - size, py - size - rng.uniform(0, 10), px + size, py + size),
                         fill=(255, 180, 100, int(rng.uniform(40, 140))))
    else:
        return np.zeros((height, width, 4), dtype=np.float32), np.zeros((height, width), dtype=np.float32)
    rgba = np.asarray(layer, dtype=np.float32) / 255.0
    return rgba[..., :3], rgba[..., 3:4]


def vertical_gradient(height: int, stops: list[tuple[float, str]]) -> np.ndarray:
    ys = np.linspace(0, 1, height, dtype=np.float32)
    positions = np.array([stop[0] for stop in stops], dtype=np.float32)
    colors = np.stack([rgb(stop[1]) for stop in stops])
    result = np.zeros((height, 3), dtype=np.float32)
    for index in range(len(stops) - 1):
        start, end = positions[index], positions[index + 1]
        segment = (ys >= start) & (ys <= end)
        if not segment.any():
            continue
        local = ((ys[segment] - start) / max(1e-6, end - start))[:, None]
        result[segment] = colors[index] * (1 - local) + colors[index + 1] * local
    result[ys < positions[0]] = colors[0]
    result[ys > positions[-1]] = colors[-1]
    return result


class Scene:
    """Shared normalized coordinate grids and static/dynamic layer builders."""

    def __init__(self, tier: int, width: int, height: int, phase: float = 0.0):
        self.tier = tier
        self.width = width
        self.height = height
        self.phase = phase
        ys = np.linspace(0, 1, height, dtype=np.float32)
        xs = np.linspace(0, 1, width, dtype=np.float32)
        self.X, self.Y = np.meshgrid(xs, ys)

    # -- shapes ---------------------------------------------------------
    def add_glow(self, canvas: np.ndarray, cx: float, cy: float, radius: float,
                 color: str, intensity: float, power: float = 2.2) -> None:
        distance = np.sqrt((self.X - cx) ** 2 + (self.Y - cy) ** 2)
        falloff = np.clip(1 - distance / radius, 0, 1) ** power
        canvas += rgb(color) * (falloff[..., None] * intensity)

    def add_disc(self, canvas: np.ndarray, cx: float, cy: float, radius: float,
                 color: str, softness: float = 0.006) -> np.ndarray:
        distance = np.sqrt((self.X - cx) ** 2 + (self.Y - cy) ** 2)
        disc = np.clip((radius - distance) / softness, 0, 1)[..., None]
        canvas[:] = canvas * (1 - disc) + rgb(color) * disc
        return disc[..., 0]

    def add_clouds(self, canvas: np.ndarray, stops: list[tuple[float, str]], alpha: float,
                   scale: float, seed: int, horizon: float, drift: float = 0.0) -> None:
        noise = cached_noise(self.width, self.height, scale, seed, 4)
        if drift:
            shift = int((drift % 1.0) * self.width)
            noise = np.roll(noise, shift, axis=1)
        sky = self.Y < horizon
        t = np.clip((noise - 0.35) / 0.40, 0, 1)
        smooth = t * t * (3 - 2 * t)
        weight = smooth * sky * alpha
        weight = blur_mask(weight, max(1.5, self.width / 400))
        color = rgb(stops[-1][1]) * 0.55 + rgb(stops[0][1]) * 0.45
        blend = weight[..., None] * 0.85
        canvas[:] = canvas * (1 - blend) + color * blend

    def add_stars(self, canvas: np.ndarray, density: float, seed: int, horizon: float,
                  twinkle: float = 0.0) -> None:
        if density <= 0:
            return
        layer, glow = cached_stars(self.width, self.height, density, seed, horizon)
        pulse = 1.0 + 0.08 * math.sin(self.phase * 2.0) * twinkle
        canvas += glow[..., None] * rgb("#dfefff") * (0.85 * pulse)
        canvas += layer[..., None] * rgb("#eaf4ff") * (0.9 * pulse)

    def add_aurora(self, canvas: np.ndarray, ribbons: list[dict], phase: float) -> None:
        for index, ribbon in enumerate(ribbons):
            base = ribbon.get("base", 0.25)
            amplitude = ribbon.get("amplitude", 0.06)
            frequency = ribbon.get("frequency", 1.4)
            thickness = ribbon.get("thickness", 0.05)
            color = rgb(ribbon["color"])
            intensity = ribbon.get("intensity", 0.35)
            ribbon_phase = phase * ribbon.get("speed", 1.0) + ribbon.get("offset", 0.0)
            center = base + amplitude * np.sin(self.X * TAU * frequency + ribbon_phase)
            band = np.exp(-((self.Y - center) / thickness) ** 2)
            band = blur_mask(band, max(1.5, self.width / 320)) * intensity
            variation = cached_noise(self.width, self.height, 18, 900 + index, 2)
            canvas += (band * (0.55 + 0.45 * variation))[..., None] * color

    def add_sea(self, canvas: np.ndarray, horizon: float, stops: list[tuple[float, str]],
                glow_color: str = "#7fb6d8") -> None:
        sea = self.Y >= horizon
        rows = np.linspace(0, 1, self.height, dtype=np.float32)
        depth = np.clip((rows - horizon) / max(1e-6, 1 - horizon), 0, 1)
        positions = np.array([s[0] for s in stops], dtype=np.float32)
        colors = np.stack([rgb(s[1]) for s in stops])
        gradient = np.zeros((self.height, 3), dtype=np.float32)
        for index in range(len(stops) - 1):
            segment = (depth >= positions[index]) & (depth <= positions[index + 1])
            if not segment.any():
                continue
            local = ((depth[segment] - positions[index]) / max(1e-6, positions[index + 1] - positions[index]))[:, None]
            gradient[segment] = colors[index] * (1 - local) + colors[index + 1] * local
        widened = np.broadcast_to(gradient[:, None, :], canvas.shape)
        canvas[sea] = widened[sea]

    def add_reflection(self, canvas: np.ndarray, cx: float, horizon: float, phase: float,
                       color: str = "#a8d4ee", width: float = 0.05, intensity: float = 0.22) -> None:
        below = self.Y >= horizon
        column = np.exp(-((self.X - cx) / width) ** 2) * below
        shimmer = 0.55 + 0.45 * np.sin(self.Y * 240 + phase * 4 + np.sin(self.X * 30 + phase))
        canvas += (column * shimmer * intensity)[..., None] * rgb(color)

    def add_waves(self, canvas: np.ndarray, layers: list[dict], phase: float) -> None:
        for index, layer in enumerate(layers):
            base = layer.get("base", 0.62)
            amplitude = layer.get("amplitude", 0.02)
            frequency = layer.get("frequency", 1.2)
            color = rgb(layer["color"])
            alpha = layer.get("alpha", 0.55)
            crest = layer.get("crest")
            wave_phase = phase * layer.get("speed", 1.0) + index * 1.3
            boundary = base + amplitude * np.sin(self.X * TAU * frequency + wave_phase)
            inside = self.Y >= boundary
            canvas[inside] = canvas[inside] * (1 - alpha) + color[None, :] * alpha
            if crest:
                highlight = np.exp(-((self.Y - boundary) / max(1e-4, layer.get("crest_width", 0.004))) ** 2)
                canvas += (highlight[..., None] * rgb(crest) * layer.get("crest_intensity", 0.3))

    def add_silhouette(self, canvas: np.ndarray, kind: str, params: dict) -> None:
        if kind == "none":
            return
        color = tuple(params.get("color", (4, 9, 16, 240)))
        layer, alpha = cached_silhouette(
            kind,
            self.width,
            self.height,
            float(params.get("x", 0.62)),
            float(params.get("y", 0.55)),
            float(params.get("scale", 0.06)),
            color,
        )
        canvas[:] = canvas * (1 - alpha) + layer * alpha

    def add_lightning(self, canvas: np.ndarray, seed: int, phase: float, intensity: float = 1.0) -> None:
        flash = max(0.0, math.sin(phase * 2) - 0.82) / 0.18
        strength = (0.22 + 0.78 * flash) * intensity
        if strength <= 0.02:
            return
        rng = np.random.default_rng(seed)
        w, h = self.width, self.height
        sx, sy = rng.uniform(0.12, 0.88) * w, h * 0.02
        points = [(sx, sy)]
        x, y = sx, sy
        while y < h * (0.42 + rng.uniform(0, 0.12)):
            x += rng.uniform(-w * 0.035, w * 0.035)
            y += h * rng.uniform(0.035, 0.075)
            points.append((x, y))
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        draw.line(points, fill=(255, 236, 190, int(235 * strength)), width=max(2, w // 500), joint="curve")
        glow = layer.filter(ImageFilter.GaussianBlur(max(2, w // 300)))
        rgba = np.asarray(glow, dtype=np.float32) / 255.0
        canvas += rgba[..., :3] * (rgba[..., 3:4] * 1.6)
        canvas += rgb("#fff3d0") * 0.05 * strength

    def add_embers(self, canvas: np.ndarray, seed: int, phase: float, count: int = 40,
                   color: str = "#ffb066", strength: float = 1.0) -> None:
        rng = np.random.default_rng(seed)
        layer = np.zeros((self.height, self.width), dtype=np.float32)
        for index in range(count):
            x = (rng.uniform(0, 1) + 0.03 * math.sin(phase * 1.3 + index)) % 1.0
            y = (rng.uniform(0, 1) - phase / TAU * 0.25 - index * 0.001) % 1.0
            xi = int(x * (self.width - 1))
            yi = int(y * (self.height - 1))
            layer[max(0, yi - 1):yi + 2, max(0, xi - 1):xi + 2] += rng.uniform(0.4, 1.0)
        glow = blur_mask(layer, max(1.0, self.width / 500))
        canvas += glow[..., None] * rgb(color) * 0.9 * strength
        canvas += layer[..., None] * rgb("#ffe2b0") * 0.8 * strength

    def add_rain(self, canvas: np.ndarray, phase: float, intensity: float = 0.22) -> None:
        layer = cached_rain(self.width, self.height)
        shift = int((phase / TAU) * self.width * 0.35) % self.width
        layer = np.roll(layer, shift, axis=1)
        canvas += layer[..., None] * rgb("#bcd9e8") * intensity

    def add_tsunami(self, canvas: np.ndarray, phase: float) -> None:
        w, h = self.width, self.height
        x = self.X
        ramp = np.clip((x - 0.22) / 0.74, 0, 1) ** 0.85
        crest = 0.66 - 0.42 * ramp
        crest = crest + 0.010 * np.sin(x * TAU * 3.1 + phase * 1.4) + 0.005 * np.sin(x * TAU * 8.3 - phase * 2.1)
        crest = np.clip(crest, 0.22, 0.70)
        mask = self.Y > crest
        depth = np.clip((self.Y - crest) / 0.5, 0, 1)
        body = rgb("#3a0704") * (1 - depth[..., None]) ** 1.1 + rgb("#040101") * depth[..., None]
        canvas[mask] = body[mask]
        sheen = (0.06 + 0.10 * np.sin(self.Y * 150 + np.sin(x * 34 + phase) * 1.6)) * np.clip(1 - depth * 1.6, 0, 1)
        canvas += (np.clip(sheen, 0, 1) * mask)[..., None] * rgb("#ff5a2a")
        band = np.exp(-((self.Y - crest) / 0.008) ** 2)
        canvas += band[..., None] * rgb("#ffd7a1") * 0.65
        # Spray above the crest.
        xs, offsets, sizes = cached_spray(w, h)
        spray = np.zeros((h, w), dtype=np.float32)
        crest_row = crest[0]
        for index in range(len(xs)):
            px = int((xs[index] + 0.004 * math.sin(phase * 1.5 + index)) % 1.0 * (w - 1))
            py = int((crest_row[px] - offsets[index]) * h)
            if 0 <= py < h:
                radius = max(1, int(round(sizes[index])))
                spray[max(0, py - radius):py + radius + 1, max(0, px - radius):px + radius + 1] += 0.9
        spray = blur_mask(spray, max(1.2, w / 900))
        canvas += spray[..., None] * rgb("#ffe0b0") * 0.85

    def finish(self, canvas: np.ndarray) -> Image.Image:
        # Vignette + subtle grain keep large gradients from looking flat.
        canvas = canvas * (1 - 0.5 * cached_vignette(self.width, self.height)[..., None])
        canvas += cached_grain(self.width, self.height)
        return Image.fromarray((np.clip(canvas, 0, 1) * 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------------------- scenes

SCENES = [
    {  # 0 calm — aurora over a polar sea
        "sky": [(0.0, "#020814"), (0.34, "#06182e"), (0.58, "#0a2742"), (0.70, "#0d3a57")],
        "horizon": 0.70,
        "glow": {"x": 0.74, "y": 0.27, "r": 0.42, "color": "#2f6f9e", "intensity": 0.30},
        "clouds": {"alpha": 0.40, "scale": 70, "seed": 11},
        "stars": 0.55,
        "aurora": [
            {"base": 0.20, "amplitude": 0.055, "frequency": 1.1, "thickness": 0.055,
             "color": "#37f2b4", "intensity": 0.55, "speed": 1.1, "offset": 0.0},
            {"base": 0.30, "amplitude": 0.07, "frequency": 0.8, "thickness": 0.07,
             "color": "#7b5cff", "intensity": 0.38, "speed": 0.8, "offset": 1.9},
        ],
        "moon": {"x": 0.74, "y": 0.27, "r": 0.045, "color": "#f2f8ff", "halo": "#9ec9ff"},
        "sea": {"stops": [(0.0, "#0a2436"), (0.35, "#061a2a"), (1.0, "#02070d")]},
        "horizon_glow": {"color": "#74d7ff", "intensity": 0.22, "width": 0.05},
        "reflection": {"x": 0.74, "width": 0.045, "color": "#9ed8ff", "intensity": 0.28},
        "waves": [
            {"base": 0.735, "amplitude": 0.006, "frequency": 2.4, "color": "#0d2f45", "alpha": 0.5,
             "speed": 0.6, "crest": "#7fdcff", "crest_width": 0.0025, "crest_intensity": 0.18},
            {"base": 0.80, "amplitude": 0.010, "frequency": 1.7, "color": "#081f31", "alpha": 0.55,
             "speed": 0.9, "crest": "#59b7d8", "crest_width": 0.003, "crest_intensity": 0.10},
            {"base": 0.90, "amplitude": 0.014, "frequency": 1.2, "color": "#04121d", "alpha": 0.6,
             "speed": 1.2, "crest": "#2d7c99", "crest_width": 0.004, "crest_intensity": 0.06},
        ],
        "silhouette": {"kind": "whale", "x": 0.24, "y": 0.68, "scale": 0.022, "color": (3, 8, 14, 235)},
    },
    {  # 1 ripple — moonlit water with whales
        "sky": [(0.0, "#030b1d"), (0.30, "#071a38"), (0.55, "#0b2b52"), (0.62, "#0e3a63")],
        "horizon": 0.62,
        "glow": {"x": 0.28, "y": 0.3, "r": 0.5, "color": "#3f7bb8", "intensity": 0.32},
        "clouds": {"alpha": 0.35, "scale": 60, "seed": 21},
        "stars": 0.45,
        "moon": {"x": 0.28, "y": 0.30, "r": 0.075, "color": "#f6fbff", "halo": "#bcdcff"},
        "sea": {"stops": [(0.0, "#0b2740"), (0.4, "#06182a"), (1.0, "#02070e")]},
        "horizon_glow": {"color": "#bcdcff", "intensity": 0.28, "width": 0.055},
        "reflection": {"x": 0.28, "width": 0.055, "color": "#b9e2ff", "intensity": 0.40},
        "waves": [
            {"base": 0.665, "amplitude": 0.007, "frequency": 2.1, "color": "#123a58", "alpha": 0.5,
             "speed": 0.6, "crest": "#c9ecff", "crest_width": 0.0028, "crest_intensity": 0.24},
            {"base": 0.735, "amplitude": 0.011, "frequency": 1.6, "color": "#0c2b44", "alpha": 0.55,
             "speed": 0.9, "crest": "#8fcfee", "crest_width": 0.003, "crest_intensity": 0.14},
            {"base": 0.84, "amplitude": 0.016, "frequency": 1.15, "color": "#071d2e", "alpha": 0.6,
             "speed": 1.1, "crest": "#5aa6c6", "crest_width": 0.004, "crest_intensity": 0.08},
        ],
        "silhouettes": [
            {"kind": "whale", "x": 0.62, "y": 0.55, "scale": 0.045, "color": (2, 7, 12, 245)},
            {"kind": "whale", "x": 0.82, "y": 0.60, "scale": 0.022, "color": (2, 7, 12, 220)},
        ],
    },
    {  # 2 swell — violet sunset with a boat
        "sky": [(0.0, "#1a0734"), (0.25, "#43116b"), (0.45, "#8f2f8c"), (0.56, "#e2606a"), (0.62, "#ff9a6a")],
        "horizon": 0.62,
        "glow": {"x": 0.5, "y": 0.585, "r": 0.55, "color": "#ff8a5c", "intensity": 0.35},
        "clouds": {"alpha": 0.50, "scale": 60, "seed": 31},
        "stars": 0.0,
        "sun": {"x": 0.5, "y": 0.585, "r": 0.055, "color": "#ffd9a8", "halo": "#ff9b5f"},
        "sea": {"stops": [(0.0, "#4a1444"), (0.35, "#2a0a2e"), (1.0, "#0c030f")]},
        "horizon_glow": {"color": "#ffcf9a", "intensity": 0.48, "width": 0.035},
        "reflection": {"x": 0.5, "width": 0.07, "color": "#ffbe8f", "intensity": 0.55},
        "waves": [
            {"base": 0.665, "amplitude": 0.008, "frequency": 2.0, "color": "#5a1c55", "alpha": 0.5,
             "speed": 0.7, "crest": "#ffb98c", "crest_width": 0.003, "crest_intensity": 0.30},
            {"base": 0.74, "amplitude": 0.014, "frequency": 1.5, "color": "#3a0f3a", "alpha": 0.55,
             "speed": 1.0, "crest": "#e88a86", "crest_width": 0.0035, "crest_intensity": 0.18},
            {"base": 0.85, "amplitude": 0.02, "frequency": 1.05, "color": "#20061f", "alpha": 0.6,
             "speed": 1.3, "crest": "#a85274", "crest_width": 0.005, "crest_intensity": 0.10},
        ],
        "silhouette": {"kind": "boat", "x": 0.5, "y": 0.66, "scale": 0.028, "color": (8, 3, 10, 245)},
    },
    {  # 3 storm — lightning, lighthouse beam
        "sky": [(0.0, "#050d16"), (0.28, "#0b1c2b"), (0.50, "#14313f"), (0.60, "#1d4a56")],
        "horizon": 0.60,
        "glow": {"x": 0.16, "y": 0.38, "r": 0.35, "color": "#3f8aa0", "intensity": 0.22},
        "clouds": {"alpha": 0.60, "scale": 38, "seed": 41},
        "stars": 0.0,
        "sea": {"stops": [(0.0, "#123842"), (0.4, "#0a212b"), (1.0, "#030a0e")]},
        "horizon_glow": {"color": "#8fd4e6", "intensity": 0.16, "width": 0.06},
        "rain": 0.28,
        "lightning": True,
        "lightning_count": 2,
        "waves": [
            {"base": 0.645, "amplitude": 0.014, "frequency": 2.3, "color": "#1a4a56", "alpha": 0.55,
             "speed": 0.8, "crest": "#dcf3ff", "crest_width": 0.003, "crest_intensity": 0.42},
            {"base": 0.72, "amplitude": 0.022, "frequency": 1.6, "color": "#0f303b", "alpha": 0.6,
             "speed": 1.1, "crest": "#a8dbe8", "crest_width": 0.004, "crest_intensity": 0.28},
            {"base": 0.84, "amplitude": 0.034, "frequency": 1.0, "color": "#081b22", "alpha": 0.65,
             "speed": 1.4, "crest": "#6fa8b8", "crest_width": 0.005, "crest_intensity": 0.16},
        ],
        "silhouette": {"kind": "lighthouse", "x": 0.17, "y": 0.665, "scale": 0.065, "color": (2, 8, 12, 250)},
    },
    {  # 4 tsunami — red-black tidal wave with embers
        "sky": [(0.0, "#120202"), (0.25, "#330404"), (0.48, "#6e0f0b"), (0.58, "#a8231a")],
        "horizon": 0.58,
        "glow": {"x": 0.5, "y": 0.55, "r": 0.62, "color": "#ff5a2e", "intensity": 0.30},
        "clouds": {"alpha": 0.55, "scale": 42, "seed": 51},
        "stars": 0.0,
        "sea": {"stops": [(0.0, "#4a100c"), (0.4, "#220604"), (1.0, "#080101")]},
        "horizon_glow": {"color": "#ff8a48", "intensity": 0.34, "width": 0.05},
        "embers": {"count": 70, "color": "#ff9a4d"},
        "tsunami": True,
        "lightning": True,
        "lightning_count": 2,
        "waves": [
            {"base": 0.62, "amplitude": 0.014, "frequency": 2.2, "color": "#6e1a12", "alpha": 0.55,
             "speed": 0.9, "crest": "#ffc27a", "crest_width": 0.0035, "crest_intensity": 0.35},
            {"base": 0.70, "amplitude": 0.03, "frequency": 1.5, "color": "#3c0b07", "alpha": 0.65,
             "speed": 1.2, "crest": "#ff7a35", "crest_width": 0.005, "crest_intensity": 0.28},
        ],
    },
]


def render(tier: int, width: int, height: int, phase: float) -> Image.Image:
    spec = SCENES[tier]
    scene = Scene(tier, width, height, phase)
    canvas = np.zeros((height, width, 3), dtype=np.float32)

    # Sky gradient.
    sky = vertical_gradient(height, spec["sky"])
    canvas[:] = sky[:, None, :]

    # Halo/glow behind celestial body.
    if "glow" in spec:
        glow = spec["glow"]
        scene.add_glow(canvas, glow["x"], glow["y"], glow["r"], glow["color"], glow["intensity"])

    # Clouds.
    clouds = spec.get("clouds")
    if clouds:
        scene.add_clouds(canvas, spec["sky"], clouds["alpha"], clouds["scale"], clouds["seed"],
                         spec["horizon"], drift=phase / TAU * 0.35)

    # Stars.
    if spec.get("stars", 0) > 0:
        scene.add_stars(canvas, spec["stars"], 700 + tier, spec["horizon"])

    # Aurora.
    if "aurora" in spec:
        scene.add_aurora(canvas, spec["aurora"], phase)

    # Celestial body.
    if "moon" in spec:
        moon = spec["moon"]
        scene.add_glow(canvas, moon["x"], moon["y"], moon["r"] * 7, moon["halo"], 0.55)
        distance = np.sqrt((scene.X - moon["x"]) ** 2 + (scene.Y - moon["y"]) ** 2)
        disc = np.clip((moon["r"] - distance) / 0.006, 0, 1)
        shade = np.clip(distance / moon["r"], 0, 1)[..., None] ** 0.65
        center = rgb(moon.get("color", "#f8fbff"))
        edge = rgb(moon.get("edge", "#aebfd4"))
        moon_color = center * (1 - shade) + edge * shade
        canvas[:] = canvas * (1 - disc[..., None]) + moon_color * disc[..., None]
        # Subtle maria patches (soft, low contrast).
        for offset_x, offset_y, radius, strength in [(-0.012, -0.008, 0.16, 0.16), (0.010, 0.012, 0.20, 0.12),
                                                     (-0.004, 0.018, 0.10, 0.10)]:
            patch = np.exp(-(((scene.X - moon["x"] - offset_x) / (moon["r"] * radius)) ** 2
                             + ((scene.Y - moon["y"] - offset_y) / (moon["r"] * radius)) ** 2))
            canvas[:] = canvas * (1 - patch[..., None] * strength) + rgb("#c6d1e0") * (patch[..., None] * strength)
    if "sun" in spec:
        sun = spec["sun"]
        scene.add_glow(canvas, sun["x"], sun["y"], sun["r"] * 9, sun["halo"], 0.65)
        scene.add_disc(canvas, sun["x"], sun["y"], sun["r"], sun["color"], softness=0.01)
        # Synthwave horizontal cutouts on the lower half of the sun.
        stripe = np.sin((scene.Y - sun["y"]) * 170 + phase * 2) > -0.25
        lower_half = (scene.Y > sun["y"] - sun["r"] * 0.1) & (scene.Y < sun["y"] + sun["r"])
        cut = np.where(lower_half & ~stripe, 0.92, 0.0)[..., None]
        canvas[:] = canvas * (1 - cut) + rgb("#2a0b40") * cut

    # Sea.
    scene.add_sea(canvas, spec["horizon"], spec["sea"]["stops"])
    if "horizon_glow" in spec:
        glow = spec["horizon_glow"]
        band = np.exp(-((scene.Y - spec["horizon"]) / glow.get("width", 0.035)) ** 2)
        canvas += band[..., None] * rgb(glow["color"]) * glow.get("intensity", 0.3)
    if "reflection" in spec:
        reflection = spec["reflection"]
        scene.add_reflection(canvas, reflection["x"], spec["horizon"], phase,
                             reflection["color"], reflection["width"], reflection["intensity"])

    # Waves.
    scene.add_waves(canvas, spec["waves"], phase)
    if spec.get("tsunami"):
        scene.add_tsunami(canvas, phase)
    if spec.get("rain"):
        scene.add_rain(canvas, phase, spec["rain"])
    if spec.get("lightning"):
        for index in range(int(spec.get("lightning_count", 1))):
            scene.add_lightning(canvas, 100 + tier + index * 7, phase, intensity=1.0 - index * 0.25)
    if "embers" in spec:
        scene.add_embers(canvas, 200 + tier, phase, spec["embers"]["count"], spec["embers"]["color"])

    # Foreground silhouettes.
    if "silhouettes" in spec:
        for silhouette in spec["silhouettes"]:
            scene.add_silhouette(canvas, silhouette["kind"], silhouette)
    elif "silhouette" in spec:
        scene.add_silhouette(canvas, spec["silhouette"]["kind"], spec["silhouette"])

    return scene.finish(canvas)


# --------------------------------------------------------------------------- encode

def encode_video(tier: int, output: Path, ffmpeg: str) -> None:
    """Pipe raw RGB frames into ffmpeg (avoids slow PNG writes)."""
    command = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W_VIDEO}x{H_VIDEO}", "-r", str(VIDEO_FPS),
        "-i", "-",
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34",
        "-pix_fmt", "yuv420p", "-row-mt", "1", "-an",
        str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame in range(VIDEO_FRAMES):
            phase = frame / VIDEO_FRAMES * TAU
            image = render(tier, W_VIDEO, H_VIDEO, phase)
            process.stdin.write(image.tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {output}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "lib" / "assets" / "packs" / "default"))
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG") or shutil.which("ffmpeg"))
    parser.add_argument("--skip-video", action="store_true")
    parser.add_argument("--only-tiers", default="")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    names = ["0-calm", "1-ripple", "2-swell", "3-storm", "4-tsunami"]
    only = {int(value) for value in args.only_tiers.split(",") if value.strip()} if args.only_tiers else set(range(5))

    for tier, name in enumerate(names):
        if tier not in only:
            continue
        static_path = out / f"{name}.webp"
        print(f"[{tier + 1}/5] static {static_path.name} ({W_STATIC}x{H_STATIC})", flush=True)
        render(tier, W_STATIC, H_STATIC, phase=0.0).save(static_path, "WEBP", quality=90, method=6)

        if args.skip_video:
            continue
        if not args.ffmpeg:
            print("ffmpeg not found; pass --ffmpeg or set FFMPEG", file=sys.stderr)
            return 2
        video_path = out / f"{name}.webm"
        print(f"          dynamic {video_path.name} ({W_VIDEO}x{H_VIDEO}, {VIDEO_FRAMES} frames)", flush=True)
        encode_video(tier, video_path, args.ffmpeg)
        print(f"          -> {video_path.stat().st_size / (1024 * 1024):.2f} MiB", flush=True)

    print("done:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
