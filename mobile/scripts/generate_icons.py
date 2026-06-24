#!/usr/bin/env python3
"""Generate the app's branded icon set with zero third-party dependencies.

A small pure-Python PNG encoder (stdlib zlib/struct only) plus an analytic,
anti-aliased renderer draws a backgammon emblem: an hourglass of gold/burgundy
"points" with an ivory checker resting in the middle, on a felt-green field —
matching the in-app board palette (see mobile/src/theme.js).

Run:  python scripts/generate_icons.py
Outputs the full Expo asset set into ../assets/.
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))

# Palette (from src/theme.js)
FELT = (28, 72, 40)
FELT_EDGE = (12, 22, 15)
GOLD = (200, 149, 42)
GOLD_DARK = (150, 104, 28)
BURGUNDY = (123, 34, 34)
BURGUNDY_DARK = (92, 24, 24)
CREAM = (240, 224, 176)
CREAM_RIM = (150, 96, 30)
WHITE = (255, 255, 255)


# ---------------------------------------------------------------------------
# Pure-Python PNG writer (RGBA, 8-bit)
# ---------------------------------------------------------------------------

def write_png(path, width, height, pixels):
    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type: none
        raw += pixels[y * stride:(y + 1) * stride]

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# Tiny analytic renderer with edge anti-aliasing
# ---------------------------------------------------------------------------

def clamp01(x):
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def tri_coverage(px, py, tri):
    """Anti-aliased coverage of point (px,py) in a triangle (CCW-normalised)."""
    (ax, ay), (bx, by), (cx, cy) = tri
    # ensure CCW
    if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0:
        bx, by, cx, cy = cx, cy, bx, by
    cov = 1.0
    for (x0, y0), (x1, y1) in (((ax, ay), (bx, by)), ((bx, by), (cx, cy)), ((cx, cy), (ax, ay))):
        ex, ey = x1 - x0, y1 - y0
        length = (ex * ex + ey * ey) ** 0.5 or 1.0
        # signed distance, positive on the interior (left) side
        dist = ((ex) * (py - y0) - (ey) * (px - x0)) / length
        cov = min(cov, clamp01(dist + 0.5))
        if cov <= 0:
            return 0.0
    return cov


def disc_coverage(px, py, cx, cy, r):
    d = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
    return clamp01(r - d + 0.5)


def ring_coverage(px, py, cx, cy, r_outer, r_inner):
    d = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
    return clamp01(r_outer - d + 0.5) * clamp01(d - r_inner + 0.5)


def over(dst, src, a):
    """Composite straight-alpha src (rgb) with coverage a over dst (rgba floats)."""
    dr, dg, db, da = dst
    sr, sg, sb = src
    na = a + da * (1 - a)
    if na <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    nr = (sr * a + dr * da * (1 - a)) / na
    ng = (sg * a + dg * da * (1 - a)) / na
    nb = (sb * a + db * da * (1 - a)) / na
    return (nr, ng, nb, na)


def build_layers(size, opaque_bg, inset, monochrome):
    """Return a renderer closure f(px,py) -> (r,g,b,a) in *pixel* coords so the
    half-pixel anti-aliasing in the coverage helpers is correctly scaled."""
    # Emblem geometry inside a centred content box of side `inset`, in pixels.
    m = (1.0 - inset) / 2.0 * size  # margin in px
    span = inset * size

    def L(u, v):  # content-box coord (0..1) -> pixel coord
        return (m + u * span, m + v * span)

    top_tri = [L(0.10, 0.06), L(0.90, 0.06), L(0.50, 0.66)]      # gold, points down
    bot_tri = [L(0.10, 0.94), L(0.90, 0.94), L(0.50, 0.34)]      # burgundy, points up
    ccx, ccy = L(0.50, 0.50)
    r_chk = 0.205 * span

    def render(px, py):
        col = (0.0, 0.0, 0.0, 0.0)

        if monochrome:
            a = max(
                tri_coverage(px, py, top_tri),
                tri_coverage(px, py, bot_tri),
                disc_coverage(px, py, ccx, ccy, r_chk),
            )
            return over(col, WHITE, a)

        if opaque_bg:
            # felt field with a soft radial vignette toward the corners
            d = ((((px / size) - 0.5) ** 2 + ((py / size) - 0.5) ** 2) ** 0.5) / 0.7071
            t = clamp01(d)
            bg = tuple(FELT[i] * (1 - t) + FELT_EDGE[i] * t for i in range(3))
            col = (bg[0], bg[1], bg[2], 1.0)

        # points
        col = over(col, GOLD, tri_coverage(px, py, top_tri) * 0.96)
        col = over(col, BURGUNDY, tri_coverage(px, py, bot_tri) * 0.96)
        # subtle darker centre lines for depth
        col = over(col, GOLD_DARK, tri_coverage(px, py, [L(0.50, 0.66), L(0.40, 0.10), L(0.50, 0.10)]) * 0.25)
        col = over(col, BURGUNDY_DARK, tri_coverage(px, py, [L(0.50, 0.34), L(0.60, 0.90), L(0.50, 0.90)]) * 0.25)
        # checker: rim + ivory fill + inner accent ring
        col = over(col, CREAM_RIM, disc_coverage(px, py, ccx, ccy, r_chk))
        col = over(col, CREAM, disc_coverage(px, py, ccx, ccy, r_chk * 0.86))
        col = over(col, CREAM_RIM, ring_coverage(px, py, ccx, ccy, r_chk * 0.58, r_chk * 0.50) * 0.8)
        return col

    return render


def render_png(path, size, opaque_bg=True, inset=0.84, monochrome=False, solid_bg=None):
    render = build_layers(size, opaque_bg, inset, monochrome)
    pixels = bytearray(size * size * 4)
    for y in range(size):
        py = y + 0.5
        row = y * size * 4
        for x in range(size):
            px = x + 0.5
            if solid_bg is not None:
                r, g, b = solid_bg
                a = 1.0
            else:
                r, g, b, a = render(px, py)
            i = row + x * 4
            pixels[i] = int(r + 0.5)
            pixels[i + 1] = int(g + 0.5)
            pixels[i + 2] = int(b + 0.5)
            pixels[i + 3] = int(a * 255 + 0.5)
    write_png(path, size, size, pixels)
    print(f"  wrote {os.path.basename(path)} ({size}x{size})")


def main():
    os.makedirs(ASSETS, exist_ok=True)
    print(f"Generating icons into {ASSETS}")
    # Main store / iOS icon — opaque felt field + emblem.
    render_png(os.path.join(ASSETS, "icon.png"), 1024, opaque_bg=True, inset=0.82)
    # Splash logo — transparent, emblem centred (Expo paints the bg colour).
    render_png(os.path.join(ASSETS, "splash-icon.png"), 1024, opaque_bg=False, inset=0.64)
    # Android adaptive layers (foreground content must sit in the safe zone).
    render_png(os.path.join(ASSETS, "android-icon-foreground.png"), 512, opaque_bg=False, inset=0.56)
    render_png(os.path.join(ASSETS, "android-icon-background.png"), 512, solid_bg=FELT)
    render_png(os.path.join(ASSETS, "android-icon-monochrome.png"), 432, opaque_bg=False, inset=0.56, monochrome=True)
    # Web favicon.
    render_png(os.path.join(ASSETS, "favicon.png"), 48, opaque_bg=True, inset=0.86)
    print("Done.")


if __name__ == "__main__":
    main()
