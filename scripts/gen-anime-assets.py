#!/usr/bin/env python3
"""Generate the "DeepSeek Eats" chibi-anime wallpaper pack.

Five tiers of DeepSeek-chan (the whale) at the dinner table. The twist: the
less money you spend, the better the meal tastes.

  0  0 元      满汉全席  — closed happy eyes, feast, sparkles & hearts
  1  <0.05 元  拉面自由  — ramen + fish, happy
  2  <0.30 元  咖喱饭    — curry rice, content
  3  <1.50 元  白饭梅干  — plain rice, worried, sweat drop
  4  >=6 元    空碗      — empty bowl, tears, rain

Everything is drawn with PIL/numpy (no third-party artwork or fonts), so the
result is license-clean. Static stills are 2560x1440 WebP; loops are short VP9
clips rendered at 960x540.

Usage:
  python scripts/gen-anime-assets.py [--out lib/assets/packs/deepseek-eats]
                                     [--skip-video] [--only-tiers 0,1]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W_STATIC, H_STATIC = 2560, 1440
W_VIDEO, H_VIDEO = 960, 540
VIDEO_FPS = 10
VIDEO_FRAMES = 30  # 3 s loop
TAU = math.tau

TIERS = [
    {
        "id": "feast", "label": {"zh": "满汉全席", "en": "Grand Feast"}, "file": "0-feast",
        "sky": ["#ffe6c2", "#ffc9dc", "#c8e6ff"], "table": "#d9a066", "cloth": "#ffe9ef",
        "food": "feast", "mood": "joy",
    },
    {
        "id": "ramen", "label": {"zh": "拉面自由", "en": "Ramen Day"}, "file": "1-ramen",
        "sky": ["#fff0cf", "#ffd8bb", "#d0eaff"], "table": "#d9a066", "cloth": "#fff1e2",
        "food": "ramen", "mood": "happy",
    },
    {
        "id": "curry", "label": {"zh": "咖喱饭", "en": "Curry Rice"}, "file": "2-curry",
        "sky": ["#fff7dd", "#ffe4bc", "#dcefff"], "table": "#cf9a62", "cloth": "#fff3df",
        "food": "curry", "mood": "fine",
    },
    {
        "id": "rice", "label": {"zh": "白饭梅干", "en": "Rice & Pickle"}, "file": "3-rice",
        "sky": ["#eef1f8", "#d3dbea", "#b3bed2"], "table": "#9b8f84", "cloth": "#e9edf4",
        "food": "plain", "mood": "worried",
    },
    {
        "id": "empty", "label": {"zh": "空碗", "en": "Empty Bowl"}, "file": "4-empty",
        "sky": ["#5d6a88", "#3f4a66", "#232a40"], "table": "#4a4650", "cloth": "#5d6070",
        "food": "empty", "mood": "cry",
    },
]


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def rgba(value: str, alpha: int) -> tuple[int, int, int, int]:
    red, green, blue = rgb(value)
    return red, green, blue, alpha


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


class Anime:
    """One scene at one resolution and animation phase."""

    def __init__(self, tier: int, width: int, height: int, phase: float, scale: int = 2):
        self.tier = tier
        self.spec = TIERS[tier]
        self.W = width * scale
        self.H = height * scale
        self.out_w = width
        self.out_h = height
        self.phase = phase
        self.scale = scale
        self.S = self.H / 1000.0
        self.dark = tier == 4
        self.gloomy = tier >= 3

    # ---------------------------------------------------------------- helpers
    def px(self, x: float) -> float:
        return x * self.W

    def py(self, y: float) -> float:
        return y * self.H

    def line_width(self, base: float = 4) -> int:
        return max(2, int(round(base * self.S)))

    def gradient(self, stops: list[str]) -> Image.Image:
        column = np.zeros((self.H, 1, 3), dtype=np.float32)
        positions = np.linspace(0, 1, len(stops))
        colors = [np.array(rgb(stop), dtype=np.float32) for stop in stops]
        for index in range(len(stops) - 1):
            start = int(positions[index] * self.H)
            end = int(positions[index + 1] * self.H)
            if end <= start:
                continue
            ratio = np.linspace(0, 1, end - start, dtype=np.float32)[:, None, None]
            column[start:end] = colors[index] * (1 - ratio) + colors[index + 1] * ratio
        column[int(positions[-1] * self.H):] = colors[-1]
        pixels = np.empty((self.H, self.W, 3), dtype=np.uint8)
        pixels[:] = column.astype(np.uint8)
        return Image.fromarray(pixels, "RGB")

    def draw_sunburst(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        cx, cy = self.px(0.5), self.py(0.34)
        radius = max(self.W, self.H) * 1.2
        rays = 28
        color = (255, 255, 255, 26 if not self.gloomy else 12)
        for index in range(rays):
            start = index / rays * TAU + self.phase * 0.15
            end = start + TAU / rays * 0.42
            draw.polygon(
                [(cx, cy), (cx + math.cos(start) * radius, cy + math.sin(start) * radius),
                 (cx + math.cos(end) * radius, cy + math.sin(end) * radius)],
                fill=color,
            )
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def add_particles(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        phase = self.phase
        if self.tier <= 2:
            # Sakura petals drifting.
            for index in range(18):
                base_x = ((index * 0.173 + 0.07 + 0.02 * math.sin(phase + index)) % 1.0)
                base_y = ((index * 0.311 + phase / TAU * 0.5) % 1.0)
                x, y = self.px(base_x), self.py(base_y)
                size = self.S * (10 + (index % 3) * 4)
                angle = phase * 0.6 + index
                petal = [(x + math.cos(angle) * size, y + math.sin(angle) * size * 0.55),
                         (x + math.cos(angle + 1.8) * size * 0.8, y + math.sin(angle + 1.8) * size * 0.45),
                         (x + math.cos(angle + 3.2) * size * 0.7, y + math.sin(angle + 3.2) * size * 0.4)]
                draw.polygon(petal, fill=rgba("#ffb7d0", 150))
        if self.tier <= 1:
            for index in range(6):
                x = self.px(0.12 + index * 0.15 + 0.01 * math.sin(phase * 1.5 + index))
                y = self.py(0.18 + 0.05 * math.sin(phase * 2 + index * 1.3))
                self.draw_heart(draw, x, y, self.S * (13 + (index % 2) * 5), rgba("#ff6f9c", 150))
        if self.tier >= 3:
            for index in range(14):
                x = self.px((index * 0.21 + phase / TAU * 0.2) % 1.0)
                y = self.py((index * 0.37 + phase / TAU * 0.7) % 1.0)
                size = self.S * (4 + index % 3)
                draw.ellipse((x - size, y - size, x + size, y + size), fill=rgba("#c9d8ea", 70))
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def draw_heart(self, draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float,
                   color: tuple[int, int, int, int]) -> None:
        points = []
        for step in range(24):
            angle = step / 24 * TAU
            x = 16 * math.sin(angle) ** 3
            y = -(13 * math.cos(angle) - 5 * math.cos(2 * angle) - 2 * math.cos(3 * angle) - math.cos(4 * angle))
            points.append((cx + x * size / 18, cy + y * size / 18))
        draw.polygon(points, fill=color)

    def draw_sparkle(self, draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float,
                     color: tuple[int, int, int, int]) -> None:
        draw.polygon([(cx, cy - size), (cx + size * 0.22, cy - size * 0.22), (cx + size, cy),
                      (cx + size * 0.22, cy + size * 0.22), (cx, cy + size),
                      (cx - size * 0.22, cy + size * 0.22), (cx - size, cy),
                      (cx - size * 0.22, cy - size * 0.22)], fill=color)

    def draw_steam(self, draw: ImageDraw.ImageDraw, cx: float, base_y: float, width: float) -> None:
        for index in range(3):
            offset = index - 1
            points = []
            for step in range(9):
                t = step / 8
                x = cx + offset * width * 0.55 + math.sin(t * 7 + self.phase * 2 + index) * width * 0.22
                y = base_y - t * self.py(0.10)
                points.append((x, y))
            draw.line(points, fill=(255, 255, 255, 120), width=self.line_width(3), joint="curve")

    # ---------------------------------------------------------------- character
    def draw_clouds(self, image: Image.Image) -> None:
        if self.tier < 3:
            return
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        color = (235, 240, 250, 70) if self.tier == 3 else (120, 132, 156, 90)
        for index in range(6):
            x = self.px(0.1 + index * 0.17)
            y = self.py(0.12 + (index % 3) * 0.05)
            w = self.px(0.18)
            h = self.py(0.05)
            draw.ellipse((x - w, y - h, x + w, y + h), fill=color)
            draw.ellipse((x - w * 0.6, y - h * 1.3, x + w * 0.5, y + h * 0.8), fill=color)
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def draw_character(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        cx, cy = self.px(0.5), self.py(0.60)
        radius = self.py(0.16)
        body = (79, 143, 232, 255) if not self.gloomy else (86, 112, 158, 255)
        belly = (223, 240, 255, 255) if not self.gloomy else (196, 210, 232, 255)
        outline = (27, 58, 102, 255)

        # Tail fluke (left side).
        draw.polygon([(cx - radius * 1.02, cy + radius * 0.08), (cx - radius * 1.62, cy - radius * 0.42),
                      (cx - radius * 1.48, cy + radius * 0.02), (cx - radius * 1.78, cy + radius * 0.52),
                      (cx - radius * 1.08, cy + radius * 0.48)],
                     fill=body, outline=outline, width=self.line_width(5))
        # Body.
        draw.ellipse((cx - radius * 1.3, cy - radius, cx + radius * 1.3, cy + radius),
                     fill=body, outline=outline, width=self.line_width(6))
        # Belly.
        draw.ellipse((cx - radius * 0.82, cy + radius * 0.05, cx + radius * 0.82, cy + radius * 1.02),
                     fill=belly, outline=outline, width=self.line_width(4))
        # Side flipper.
        draw.ellipse((cx - radius * 1.2, cy + radius * 0.35, cx - radius * 0.75, cy + radius * 0.9),
                     fill=body, outline=outline, width=self.line_width(4))
        # Top highlight.
        draw.arc((cx - radius * 1.1, cy - radius * 0.92, cx + radius * 0.4, cy - radius * 0.1),
                 start=200, end=320, fill=(255, 255, 255, 150), width=self.line_width(9))

        eye_y = cy - radius * 0.12
        eye_dx = radius * 0.46
        eye_r = radius * 0.30
        blink = math.sin(self.phase * 2 + self.tier) > 0.965
        mood = self.spec["mood"]

        if mood in ("joy", "happy") or blink:
            for side in (-1, 1):
                x = cx + side * eye_dx
                draw.arc((x - eye_r, eye_y - eye_r * 0.9, x + eye_r, eye_y + eye_r * 0.8),
                         start=200, end=340, fill=outline, width=self.line_width(7))
        elif mood == "cry":
            for side in (-1, 1):
                x = cx + side * eye_dx
                draw.arc((x - eye_r, eye_y - eye_r * 0.8, x + eye_r, eye_y + eye_r * 0.9),
                         start=20, end=160, fill=outline, width=self.line_width(7))
                # Tears.
                drop_y = eye_y + eye_r * (1.6 + 0.6 * math.sin(self.phase * 3 + side))
                draw.polygon([(x, drop_y - self.S * 16), (x - self.S * 10, drop_y + self.S * 8),
                              (x + self.S * 10, drop_y + self.S * 8)], fill=(150, 205, 255, 235))
                draw.ellipse((x - self.S * 10, drop_y + self.S * 2, x + self.S * 10, drop_y + self.S * 18),
                             fill=(150, 205, 255, 235))
        else:
            for side in (-1, 1):
                x = cx + side * eye_dx
                draw.ellipse((x - eye_r, eye_y - eye_r * 1.15, x + eye_r, eye_y + eye_r * 1.15),
                             fill=(255, 255, 255, 255), outline=outline, width=self.line_width(4))
                iris = eye_r * (0.62 if mood != "worried" else 0.4)
                draw.ellipse((x - iris, eye_y - iris, x + iris, eye_y + iris), fill=(23, 42, 88, 255))
                draw.ellipse((x - iris * 0.45, eye_y - iris * 0.45, x + iris * 0.45, eye_y + iris * 0.45),
                             fill=(0, 0, 0, 255))
                draw.ellipse((x - iris * 0.65, eye_y - iris * 0.9, x - iris * 0.05, eye_y - iris * 0.3),
                             fill=(255, 255, 255, 235))
                draw.ellipse((x + iris * 0.25, eye_y + iris * 0.2, x + iris * 0.55, eye_y + iris * 0.5),
                             fill=(255, 255, 255, 170))
            if mood == "worried":
                for side in (-1, 1):
                    x = cx + side * eye_dx
                    draw.line([(x - eye_r, eye_y - eye_r * 1.5), (x + eye_r * 0.6, eye_y - eye_r * 1.25)],
                              fill=outline, width=self.line_width(5))

        # Blush.
        if mood != "cry":
            for side in (-1, 1):
                x = cx + side * radius * 0.92
                y = cy + radius * 0.22
                draw.ellipse((x - radius * 0.22, y - radius * 0.13, x + radius * 0.22, y + radius * 0.13),
                             fill=(255, 128, 150, 110))

        # Mouth.
        mouth_y = cy + radius * 0.32
        if mood in ("joy", "happy"):
            draw.ellipse((cx - radius * 0.26, mouth_y - radius * 0.10, cx + radius * 0.26, mouth_y + radius * 0.24),
                         fill=(90, 30, 40, 255))
            draw.ellipse((cx - radius * 0.18, mouth_y + radius * 0.10, cx + radius * 0.18, mouth_y + radius * 0.22),
                         fill=(240, 140, 150, 255))
        elif mood == "fine":
            draw.arc((cx - radius * 0.22, mouth_y - radius * 0.1, cx + radius * 0.22, mouth_y + radius * 0.18),
                     start=20, end=160, fill=outline, width=self.line_width(5))
        elif mood == "worried":
            points = [(cx + math.sin(step / 8 * TAU) * radius * 0.2,
                       mouth_y + math.cos(step / 8 * TAU) * radius * 0.05) for step in range(9)]
            draw.line(points, fill=outline, width=self.line_width(5), joint="curve")
            # Sweat drop.
            sx, sy = cx + radius * 1.05, cy - radius * 0.35
            draw.polygon([(sx, sy - self.S * 14), (sx - self.S * 9, sy + self.S * 6),
                          (sx + self.S * 9, sy + self.S * 6)], fill=(160, 210, 255, 230))
            draw.ellipse((sx - self.S * 9, sy + self.S * 1, sx + self.S * 9, sy + self.S * 15),
                         fill=(160, 210, 255, 230))
        else:  # cry
            draw.ellipse((cx - radius * 0.26, mouth_y - radius * 0.2, cx + radius * 0.26, mouth_y + radius * 0.12),
                         fill=(110, 40, 50, 255))
            draw.ellipse((cx - radius * 0.14, mouth_y - radius * 0.18, cx + radius * 0.14, mouth_y - radius * 0.02),
                         fill=(180, 70, 80, 255))

        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    # ---------------------------------------------------------------- table/food
    def draw_table(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        top = self.py(0.78)
        table_color = rgb(self.spec["table"])
        draw.rectangle((0, top, self.W, self.H), fill=(*table_color, 255))
        draw.rectangle((0, top, self.W, top + self.S * 8), fill=(255, 255, 255, 40))
        # Tablecloth band.
        cloth = rgb(self.spec["cloth"])
        draw.rectangle((self.px(0.06), top + self.S * 18, self.px(0.94), self.H),
                       fill=(*cloth, 235))
        for index in range(7):
            x = self.px(0.06 + index * 0.145)
            draw.line([(x, top + self.S * 18), (x, self.H)], fill=(255, 255, 255, 60), width=self.line_width(2))
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def draw_bowl(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        cx = self.px(0.5)
        top = self.py(0.745)
        rx = self.px(0.17)
        ry = self.py(0.035)
        food = self.spec["food"]
        outline = self.line_width(5)

        # Bowl body (lower half so it reads as a bowl, not a plate).
        draw.pieslice((cx - rx, top - ry * 0.4, cx + rx, top + ry * 2.3), start=0, end=180,
                      fill=(252, 248, 242, 255), outline=(60, 55, 70, 255), width=outline)
        # Rim.
        draw.ellipse((cx - rx, top - ry, cx + rx, top + ry), fill=(255, 255, 255, 255),
                     outline=(60, 55, 70, 255), width=outline)
        inner_rx = rx * 0.88
        draw.ellipse((cx - inner_rx, top - ry * 0.78, cx + inner_rx, top + ry * 0.78),
                     fill=(235, 230, 222, 255))

        bowl_ry = ry * 0.72
        if food in ("ramen", "feast"):
            draw.ellipse((cx - inner_rx, top - bowl_ry, cx + inner_rx, top + bowl_ry), fill=(250, 226, 150, 255))
            draw.ellipse((cx - inner_rx * 0.92, top - bowl_ry * 0.88, cx + inner_rx * 0.92, top + bowl_ry * 0.88),
                         fill=(246, 194, 98, 255))
            for index in range(4):
                y0 = top - bowl_ry * 0.45 + index * bowl_ry * 0.16
                points = [(cx - inner_rx * 0.75 + step / 10 * inner_rx * 1.5,
                           y0 + math.sin(step * 0.9 + index) * bowl_ry * 0.12) for step in range(11)]
                draw.line(points, fill=(255, 238, 182, 255), width=self.line_width(7), joint="curve")
            # Egg.
            draw.ellipse((cx - inner_rx * 0.58, top - bowl_ry * 0.6, cx - inner_rx * 0.12, top - bowl_ry * 0.05),
                         fill=(255, 252, 244, 255), outline=(224, 196, 150, 255), width=self.line_width(2))
            draw.ellipse((cx - inner_rx * 0.46, top - bowl_ry * 0.46, cx - inner_rx * 0.24, top - bowl_ry * 0.2),
                         fill=(255, 192, 62, 255))
            # Naruto fish cake.
            draw.ellipse((cx + inner_rx * 0.1, top - bowl_ry * 0.4, cx + inner_rx * 0.42, top - bowl_ry * 0.02),
                         fill=(255, 244, 244, 255), outline=(220, 160, 170, 255), width=self.line_width(2))
            draw.arc((cx + inner_rx * 0.17, top - bowl_ry * 0.33, cx + inner_rx * 0.35, top - bowl_ry * 0.09),
                     start=0, end=300, fill=(240, 120, 140, 255), width=self.line_width(2))
            # Nori.
            draw.rounded_rectangle((cx + inner_rx * 0.38, top - bowl_ry * 0.28, cx + inner_rx * 0.72, top + bowl_ry * 0.12),
                                   radius=self.S * 4, fill=(42, 66, 54, 255))
            if food == "feast":
                # Extra shrimp and a second egg for the "grand feast" tier.
                draw.arc((cx - inner_rx * 0.95, top + bowl_ry * 0.02, cx - inner_rx * 0.45, top + bowl_ry * 0.55),
                         start=200, end=340, fill=(255, 132, 92, 255), width=self.line_width(6))
                draw.ellipse((cx + inner_rx * 0.5, top - bowl_ry * 0.35, cx + inner_rx * 0.74, top - bowl_ry * 0.05),
                             fill=(255, 252, 244, 255), outline=(224, 196, 150, 255), width=self.line_width(2))
                draw.ellipse((cx + inner_rx * 0.57, top - bowl_ry * 0.29, cx + inner_rx * 0.67, top - bowl_ry * 0.13),
                             fill=(255, 192, 62, 255))
            self.draw_steam(draw, cx, top - ry * 2.0, rx * 0.5)
            # A noodle strand lifted toward the mouth.
            mouth_x, mouth_y = cx, self.py(0.60) + self.py(0.16) * 0.32
            points = []
            for step in range(12):
                t = step / 11
                points.append((cx - inner_rx * 0.25 + (mouth_x - (cx - inner_rx * 0.25)) * t,
                               top - bowl_ry * 0.2 + (mouth_y - (top - bowl_ry * 0.2)) * t
                               + math.sin(t * math.pi) * self.py(0.02)))
            draw.line(points, fill=(255, 236, 176, 255), width=self.line_width(6), joint="curve")
            draw.ellipse((mouth_x - self.S * 8, mouth_y - self.S * 8, mouth_x + self.S * 8, mouth_y + self.S * 8),
                         fill=(255, 236, 176, 255))
        elif food == "curry":
            draw.ellipse((cx - inner_rx, top - bowl_ry, cx + inner_rx, top + bowl_ry), fill=(252, 248, 240, 255))
            draw.ellipse((cx - inner_rx * 0.85, top - bowl_ry * 0.72, cx + inner_rx * 0.15, top + bowl_ry * 0.62),
                         fill=(252, 250, 244, 255), outline=(210, 200, 190, 255), width=self.line_width(2))
            draw.ellipse((cx - inner_rx * 0.28, top - bowl_ry * 0.66, cx + inner_rx * 0.86, top + bowl_ry * 0.6),
                         fill=(150, 92, 46, 255))
            for dx, dy, size in [(0.18, -0.22, 0.16), (0.5, 0.1, 0.14), (0.62, -0.2, 0.1)]:
                draw.ellipse((cx + dx * inner_rx - inner_rx * size, top + dy * bowl_ry - bowl_ry * 0.22,
                              cx + dx * inner_rx + inner_rx * size, top + dy * bowl_ry + bowl_ry * 0.22),
                             fill=(226, 164, 88, 255))
            # Carrot slices.
            draw.ellipse((cx + inner_rx * 0.05, top - bowl_ry * 0.4, cx + inner_rx * 0.2, top - bowl_ry * 0.22),
                         fill=(255, 150, 70, 255))
            draw.ellipse((cx + inner_rx * 0.55, top + bowl_ry * 0.2, cx + inner_rx * 0.7, top + bowl_ry * 0.38),
                         fill=(255, 150, 70, 255))
            self.draw_steam(draw, cx, top - ry * 1.8, rx * 0.4)
        elif food == "plain":
            draw.ellipse((cx - inner_rx, top - bowl_ry, cx + inner_rx, top + bowl_ry), fill=(246, 242, 236, 255))
            draw.ellipse((cx - inner_rx * 0.92, top - bowl_ry * 0.78, cx + inner_rx * 0.92, top + bowl_ry * 0.75),
                         fill=(255, 250, 240, 255), outline=(148, 142, 136, 255), width=self.line_width(3))
            draw.ellipse((cx - inner_rx * 0.16, top - bowl_ry * 0.34, cx + inner_rx * 0.16, top + bowl_ry * 0.3),
                         fill=(196, 58, 64, 255))
            # Small soy-sauce dish next to the bowl.
            sx, sy = cx - rx * 1.25, top + ry * 0.05
            draw.ellipse((sx - rx * 0.16, sy - ry * 0.5, sx + rx * 0.16, sy + ry * 0.5),
                         fill=(250, 250, 252, 255), outline=(150, 150, 160, 255), width=self.line_width(2))
            draw.ellipse((sx - rx * 0.11, sy - ry * 0.32, sx + rx * 0.11, sy + ry * 0.32),
                         fill=(72, 46, 34, 255))
        elif food == "empty":
            draw.ellipse((cx - inner_rx, top - bowl_ry * 0.95, cx + inner_rx, top + bowl_ry * 0.95),
                         fill=(72, 66, 74, 255))
            draw.arc((cx - inner_rx, top - bowl_ry * 0.95, cx + inner_rx, top + bowl_ry * 0.95),
                     start=200, end=340, fill=(120, 112, 120, 200), width=self.line_width(3))

        # Chopsticks.
        draw.line([(cx + rx * 0.7, top - ry * 0.4), (cx - rx * 0.55, top - ry * 1.3)],
                  fill=(120, 82, 52, 255), width=self.line_width(5))
        draw.line([(cx + rx * 0.82, top - ry * 0.25), (cx - rx * 0.4, top - ry * 1.15)],
                  fill=(140, 96, 60, 255), width=self.line_width(5))

        if self.spec["food"] == "feast":
            self.draw_feast(draw)
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def draw_feast(self, draw: ImageDraw.ImageDraw) -> None:
        cx = self.px(0.5)
        top = self.py(0.745)
        # Sushi plate (left).
        px, py = self.px(0.27), top + self.py(0.02)
        draw.ellipse((px - self.px(0.10), py - self.py(0.02), px + self.px(0.10), py + self.py(0.035)),
                     fill=(250, 250, 255, 255), outline=(120, 120, 140, 255), width=self.line_width(3))
        for index in range(3):
            sx = px - self.px(0.05) + index * self.px(0.05)
            draw.ellipse((sx - self.px(0.02), py - self.py(0.012), sx + self.px(0.02), py + self.py(0.012)),
                         fill=(255, 250, 240, 255))
            draw.rounded_rectangle((sx - self.px(0.02), py - self.py(0.024), sx + self.px(0.02), py - self.py(0.004)),
                                   radius=self.S * 5, fill=(255, 138, 108, 255))
        # Cake (right).
        cx2, cy2 = self.px(0.76), top + self.py(0.005)
        draw.rounded_rectangle((cx2 - self.px(0.07), cy2 - self.py(0.05), cx2 + self.px(0.07), cy2 + self.py(0.03)),
                               radius=self.S * 8, fill=(255, 220, 232, 255), outline=(210, 120, 140, 255),
                               width=self.line_width(3))
        draw.line([(cx2 - self.px(0.07), cy2 - self.py(0.02)), (cx2 + self.px(0.07), cy2 - self.py(0.02))],
                  fill=(255, 255, 255, 255), width=self.line_width(4))
        draw.ellipse((cx2 - self.S * 10, cy2 - self.py(0.075), cx2 + self.S * 10, cy2 - self.py(0.055)),
                     fill=(230, 50, 70, 255))
        # Drink (right edge).
        dx, dy = self.px(0.90), top + self.py(0.02)
        draw.rounded_rectangle((dx - self.px(0.03), dy - self.py(0.075), dx + self.px(0.03), dy + self.py(0.02)),
                               radius=self.S * 6, fill=(255, 210, 140, 190), outline=(160, 120, 90, 255),
                               width=self.line_width(3))
        draw.line([(dx, dy - self.py(0.075)), (dx + self.px(0.015), dy - self.py(0.11))],
                  fill=(230, 90, 120, 255), width=self.line_width(4))
        # Extra fish plate (far left).
        fx, fy = self.px(0.10), top + self.py(0.03)
        draw.ellipse((fx - self.px(0.06), fy - self.py(0.015), fx + self.px(0.06), fy + self.py(0.025)),
                     fill=(250, 250, 255, 255), outline=(120, 120, 140, 255), width=self.line_width(3))
        draw.polygon([(fx - self.px(0.04), fy), (fx + self.px(0.03), fy - self.py(0.012)),
                      (fx + self.px(0.04), fy + self.py(0.005)), (fx - self.px(0.03), fy + self.py(0.01))],
                     fill=(255, 160, 130, 255))

    def draw_speech(self, image: Image.Image) -> None:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        cx, cy = self.px(0.79), self.py(0.28)
        mood = self.spec["mood"]
        if mood in ("joy", "happy"):
            radius = self.S * 50
            draw.ellipse((cx - radius, cy - radius * 0.8, cx + radius, cy + radius * 0.8),
                         fill=(255, 255, 255, 235), outline=(90, 70, 90, 200), width=self.line_width(3))
            draw.polygon([(cx - radius * 0.25, cy + radius * 0.65), (cx - radius * 0.55, cy + radius * 1.15),
                          (cx - radius * 0.02, cy + radius * 0.8)], fill=(255, 255, 255, 235))
            self.draw_heart(draw, cx, cy - self.S * 4, self.S * 26, rgba("#ff5f8f", 255))
        elif mood == "cry":
            radius = self.S * 46
            draw.ellipse((cx - radius, cy - radius * 0.75, cx + radius, cy + radius * 0.75),
                         fill=(235, 238, 248, 225), outline=(60, 60, 80, 200), width=self.line_width(3))
            draw.polygon([(cx - radius * 0.35, cy + radius * 0.55), (cx - radius * 0.7, cy + radius * 1.05),
                          (cx - radius * 0.08, cy + radius * 0.72)], fill=(235, 238, 248, 225))
            for index in range(3):
                draw.ellipse((cx - radius * 0.45 + index * radius * 0.42, cy - self.S * 6,
                              cx - radius * 0.35 + index * radius * 0.42, cy + self.S * 6),
                             fill=(80, 80, 100, 255))
        image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def draw_mood_overlay(self, image: Image.Image) -> None:
        if self.dark:
            overlay = Image.new("RGBA", image.size, (20, 26, 44, 70))
            image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))
            return
        if self.gloomy:
            overlay = Image.new("RGBA", image.size, (70, 80, 100, 30))
            image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))

    def render(self) -> Image.Image:
        image = self.gradient(self.spec["sky"])
        self.draw_sunburst(image)
        self.draw_clouds(image)
        self.add_particles(image)
        self.draw_character(image)
        self.draw_table(image)
        self.draw_bowl(image)
        self.draw_speech(image)
        if self.tier == 4:
            # Rain streaks.
            overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            for index in range(40):
                x = self.px((index * 0.137 + self.phase / TAU * 0.1) % 1.0)
                y = self.py((index * 0.271 + self.phase / TAU * 0.9) % 1.0)
                draw.line([(x, y), (x - self.S * 7, y + self.S * 26)], fill=(180, 205, 235, 90),
                          width=self.line_width(2))
            image.paste(Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB"))
        self.draw_mood_overlay(image)
        if self.out_w != self.W:
            image = image.resize((self.out_w, self.out_h), Image.LANCZOS)
        return image


# --------------------------------------------------------------------------- output

def render_image(tier: int, width: int, height: int, phase: float, scale: int) -> Image.Image:
    return Anime(tier, width, height, phase, scale).render()


def encode_video(tier: int, output: Path, ffmpeg: str) -> None:
    command = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W_VIDEO}x{H_VIDEO}", "-r", str(VIDEO_FPS), "-i", "-",
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34",
        "-pix_fmt", "yuv420p", "-row-mt", "1", "-an",
        str(output),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame in range(VIDEO_FRAMES):
            phase = frame / VIDEO_FRAMES * TAU
            image = render_image(tier, W_VIDEO, H_VIDEO, phase, scale=1)
            process.stdin.write(image.tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {output}")


def manifest() -> dict:
    return {
        "schema": 1,
        "id": "deepseek-eats",
        "name": {"zh": "DeepSeek 干饭", "en": "DeepSeek Eats"},
        "description": {
            "zh": "越省越香：DeepSeek 鲸在餐桌前的五档表情。花得越少吃得越香；花多了只能空碗流泪。",
            "en": "Chibi DeepSeek whale at the dinner table. Spend less, eat better; spend a lot and the bowl is empty.",
        },
        "author": "dsh-spend-wallpaper",
        "license": "CC0-1.0 (generated artwork)",
        "direction": "poor",
        "tiers": [
            {"id": spec["id"], "min": ["0", "0.05", "0.30", "1.50", "6.00"][index],
             "label": spec["label"], "static": f"{spec['file']}.webp",
             "dynamic": {"type": "video", "src": f"{spec['file']}.webm", "poster": f"{spec['file']}.webp"}}
            for index, spec in enumerate(TIERS)
        ],
        "defaults": {"scrim": 0.12, "dim": 0.03, "blur": 0, "transitionMs": 600},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "lib" / "assets" / "packs" / "deepseek-eats"))
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG") or shutil.which("ffmpeg"))
    parser.add_argument("--skip-video", action="store_true")
    parser.add_argument("--only-tiers", default="")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    only = {int(value) for value in args.only_tiers.split(",") if value.strip()} if args.only_tiers else set(range(5))

    for index, spec in enumerate(TIERS):
        if index not in only:
            continue
        name = spec["file"]
        static_path = out / f"{name}.webp"
        print(f"[{index + 1}/5] static {static_path.name} ({W_STATIC}x{H_STATIC})", flush=True)
        render_image(index, W_STATIC, H_STATIC, 0.0, scale=2).save(static_path, "WEBP", quality=92, method=6)
        if args.skip_video:
            continue
        if not args.ffmpeg:
            print("ffmpeg not found; pass --ffmpeg or set FFMPEG", file=sys.stderr)
            return 2
        video_path = out / f"{name}.webm"
        print(f"          dynamic {video_path.name} ({W_VIDEO}x{H_VIDEO}, {VIDEO_FRAMES} frames)", flush=True)
        encode_video(index, video_path, args.ffmpeg)
        print(f"          -> {video_path.stat().st_size / (1024 * 1024):.2f} MiB", flush=True)

    print("done:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
