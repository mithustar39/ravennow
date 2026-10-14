"""Generate the Open Graph share image (1200x630) with no third-party deps.

Pure stdlib: builds a PNG from scratch using zlib and struct. Draws a blocky
wordmark from a small bitmap font so the build has no font/asset dependency.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

WIDTH = 1200
HEIGHT = 630

BRAND = (209, 19, 40)      # Carleton-ish red
WHITE = (255, 255, 255)

GLYPH_W = 5
GLYPH_H = 7
SPACING = 1  # in glyph cells

# 5x7 bitmap font, uppercase A-Z only. Each glyph is 7 rows of 5 columns.
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}


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


def word_width(word: str, scale: int) -> int:
    return len(word) * (GLYPH_W + SPACING) * scale - SPACING * scale


def draw_word(
    pixels: bytearray,
    word: str,
    x0: int,
    y0: int,
    scale: int,
    color: tuple[int, int, int],
) -> None:
    advance = (GLYPH_W + SPACING) * scale
    for offset, letter in enumerate(word):
        glyph = FONT.get(letter)
        if not glyph:
            continue
        gx = x0 + offset * advance
        for gy, line in enumerate(glyph):
            for gxx, bit in enumerate(line):
                if bit == "1":
                    _rect(
                        pixels,
                        gx + gxx * scale,
                        y0 + gy * scale,
                        gx + gxx * scale + scale,
                        y0 + gy * scale + scale,
                        color,
                    )


# Lines are (text, scale) drawn top to bottom, centered.
LINES = [("RAVEN", 30), ("SCHEDULING", 16)]
LINE_GAP = 34
RULE_GAP = 44
RULE_W = 360
RULE_H = 8


def main() -> None:
    pixels = bytearray(WIDTH * HEIGHT * 3)
    _fill(pixels, BRAND)

    heights = [GLYPH_H * scale for _, scale in LINES]
    total_h = sum(heights) + LINE_GAP * (len(LINES) - 1)
    y = (HEIGHT - total_h) // 2

    for (word, scale), height in zip(LINES, heights):
        width = word_width(word, scale)
        draw_word(pixels, word, (WIDTH - width) // 2, y, scale, WHITE)
        y += height + LINE_GAP

    rule_y = y + RULE_GAP
    _rect(pixels, (WIDTH - RULE_W) // 2, rule_y, (WIDTH + RULE_W) // 2, rule_y + RULE_H, WHITE)

    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "frontend" / "public" / "og.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(_png(WIDTH, HEIGHT, pixels))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
