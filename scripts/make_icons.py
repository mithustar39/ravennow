"""Generate simple PNG icons for the extension and PWA.

Pure standard library (zlib + struct) so it runs anywhere Python does.
Replace the generated files with real artwork before publishing.
"""

from __future__ import annotations

import pathlib
import struct
import zlib

BRAND = (209, 19, 40)  # #d11328
WHITE = (255, 255, 255)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _png(width: int, height: int, pixels: list[tuple[int, int, int]]) -> bytes:
    raw = b""
    for y in range(height):
        raw += b"\x00"  # filter type 0
        for x in range(width):
            raw += bytes(pixels[y * width + x])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def _icon(size: int) -> bytes:
    """A red rounded square with a white 'R' drawn from simple rectangles."""

    pixels: list[tuple[int, int, int]] = []
    radius = max(2, size // 6)
    for y in range(size):
        for x in range(size):
            # Rounded corners.
            corner = (
                (x < radius and y < radius and (x - radius) ** 2 + (y - radius) ** 2 > radius ** 2)
                or (x >= size - radius and y < radius and (x - (size - radius - 1)) ** 2 + (y - radius) ** 2 > radius ** 2)
                or (x < radius and y >= size - radius and (x - radius) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2)
                or (x >= size - radius and y >= size - radius and (x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2)
            )
            if corner:
                pixels.append((0, 0, 0))
                continue

            # Draw a blocky 'R'.
            stem = size * 0.30 <= x <= size * 0.40
            top = size * 0.24 <= y <= size * 0.76
            bowl_right = size * 0.40 <= x <= size * 0.66 and size * 0.24 <= y <= size * 0.50
            leg = (
                size * 0.40 <= x <= size * 0.68
                and size * 0.50 <= y <= size * 0.76
                and (x - size * 0.40) * (size * 0.26) <= (y - size * 0.50) * (size * 0.30) + size * size * 0.02
            )
            on_r = (stem or bowl_right or leg) and top
            pixels.append(WHITE if on_r else BRAND)

    return _png(size, size, pixels)


def main() -> None:
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        (out / f"icon{size}.png").write_bytes(_icon(size))
        print(f"wrote {out / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
