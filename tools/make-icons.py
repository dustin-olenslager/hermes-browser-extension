#!/usr/bin/env python3
"""Generate the extension's PNG icons.

Chrome cannot use an SVG for `action.default_icon`, so the icons are rendered here
and committed. Deterministic and dependency-free (stdlib zlib only), so the assets
can always be regenerated rather than hand-edited:

    python3 tools/make-icons.py

Design: a rounded accent tile with a white "H" — legible down to 16px, no text.
Rendered at 8x and box-downsampled for clean edges.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 8
ACCENT = (0x3B, 0x5B, 0xDB)
ACCENT_DARK = (0x2B, 0x43, 0xA8)
GLYPH = (0xFF, 0xFF, 0xFF)
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "extension" / "icons"


def rounded_rect_coverage(x: float, y: float, w: float, h: float, radius: float) -> bool:
    """True when point (x, y) is inside a rounded rect anchored at the origin."""
    if x < 0 or y < 0 or x > w or y > h:
        return False
    for cx, cy in ((radius, radius), (w - radius, radius), (radius, h - radius), (w - radius, h - radius)):
        inside_x = (cx == radius and x < radius) or (cx != radius and x > w - radius)
        inside_y = (cy == radius and y < radius) or (cy != radius and y > h - radius)
        if inside_x and inside_y:
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2
    return True


def render(size: int) -> bytes:
    """RGBA pixels for one icon size, top-down, row-major."""
    scale = SUPERSAMPLE
    big = size * scale
    # Geometry in supersampled space.
    radius = big * 0.22
    border = max(scale, big * 0.045)
    bar_w = big * 0.135
    bar_h = big * 0.50
    bar_y = (big - bar_h) / 2
    left_x = big * 0.295
    right_x = big * 0.57
    cross_y = big * 0.45
    cross_h = big * 0.10

    acc = [[0, 0, 0, 0] for _ in range(big * big)]
    for py in range(big):
        for px in range(big):
            x, y = px + 0.5, py + 0.5
            if not rounded_rect_coverage(x, y, big, big, radius):
                continue
            # Border ring reads as depth at 48/128px and disappears cleanly at 16px.
            edge = not rounded_rect_coverage(x, y, big - border, big - border, radius * 0.85)
            color = ACCENT_DARK if edge else ACCENT
            glyph = (
                (left_x <= x <= left_x + bar_w and bar_y <= y <= bar_y + bar_h)
                or (right_x <= x <= right_x + bar_w and bar_y <= y <= bar_y + bar_h)
                or (left_x <= x <= right_x + bar_w and cross_y <= y <= cross_y + cross_h)
            )
            acc[py * big + px] = [*GLYPH, 255] if glyph else [*color, 255]

    # Box-downsample to the target size.
    out = bytearray()
    block = scale * scale
    for oy in range(size):
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(scale):
                row = (oy * scale + dy) * big + ox * scale
                for dx in range(scale):
                    pixel = acc[row + dx]
                    r += pixel[0]
                    g += pixel[1]
                    b += pixel[2]
                    a += pixel[3]
            out += bytes((r // block, g // block, b // block, a // block))
    return bytes(out)


def png(size: int, pixels: bytes) -> bytes:
    """Minimal PNG container for 8-bit RGBA."""
    raw = b"".join(b"\x00" + pixels[y * size * 4 : (y + 1) * size * 4] for y in range(size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = OUT_DIR / f"icon{size}.png"
        target.write_bytes(png(size, render(size)))
        print(f"wrote {target.relative_to(OUT_DIR.parent.parent)} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
