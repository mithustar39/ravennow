"""Generate the Open Graph share image for the landing page.

Pure standard library (zlib + struct) so it runs anywhere Python does, matching
``scripts/make_icons.py``. The wordmark is drawn from a tiny 5x7 bitmap font and
scaled into blocks. Replace the output with real artwork before a big launch.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

WIDTH = 1200
HEIGHT = 630
BRAND = (209, 19, 40)  # #d11328
WHITE = (255, 255, 255)

# 5 wide by 7 tall block letters, only the glyphs the wordmark needs.
FONT = {
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "W": ["10001", "10001", "10001", "10001", "10101", "10101", "01010"],
}

GLYPH_W = 5
GLYPH_H = 7
SPACING = 1  # in glyph cells
SCALE = 24
WORD = "RAVENNOW"


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _png(width: int, height: int, pixels: bytearray) -> bytes:
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw += b"\x00"  # filter type 0
        raw += pixels[y * stride : (y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def _fill(pixels: bytearray, color: tuple[int, int, int]) -> None:
    r, g, b = color
    for index in range(0, len(pixels), 3):
        pixels[index] = r
        pixels[index + 1] = g
        pixels[index + 2] = b


def _rect(
    pixels: bytearray,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    color: tuple[int, int, int],
) -> None:
    r, g, b = color
    for y in range(max(0, y0), min(HEIGHT, y1)):
        row = y * WIDTH * 3
        for x in range(max(0, x0), min(WIDTH, x1)):
            index = row + x * 3
            pixels[index] = r
            pixels[index + 1] = g
            pixels[index + 2] = b


def _draw_word(pixels: bytearray, word: str, x0: int, y0: int) -> None:
    cell = GLYPH_W * SCALE
    advance = (GLYPH_W + SPACING) * SCALE
    for offset, letter in enumerate(word):
        glyph = FONT[letter]
        gx = x0 + offset * advance
        for gy, line in enumerate(glyph):
            for gxx, bit in enumerate(line):
                if bit == "1":
                    _rect(
                        pixels,
                        gx + gxx * SCALE,
                        y0 + gy * SCALE,
                        gx + gxx * SCALE + SCALE,
                        y0 + gy * SCALE + SCALE,
                        WHITE,
                    )
    del cell


def main() -> None:
    pixels = bytearray(WIDTH * HEIGHT * 3)
    _fill(pixels, BRAND)

    advance = (GLYPH_W + SPACING) * SCALE
    total_w = len(WORD) * advance - SPACING * SCALE
    start_x = (WIDTH - total_w) // 2
    start_y = (HEIGHT - GLYPH_H * SCALE) // 2 - 40
    _draw_word(pixels, WORD, start_x, start_y)

    # A short white rule beneath the wordmark.
    rule_w = 320
    rule_y = start_y + GLYPH_H * SCALE + 70
    _rect(pixels, (WIDTH - rule_w) // 2, rule_y, (WIDTH + rule_w) // 2, rule_y + 8, WHITE)

    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "frontend" / "public" / "og.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(_png(WIDTH, HEIGHT, pixels))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
