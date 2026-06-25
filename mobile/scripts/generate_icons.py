#!/usr/bin/env python3
"""Generate the app's branded icon set with zero third-party dependencies.

A small pure-Python PNG encoder (stdlib zlib/struct only) plus an analytic,
anti-aliased renderer draws the "Crossed Points" emblem: two backgammon points
meeting tip-to-tip at the centre to form a vertical hourglass/bowtie — a deep
mahogany point coming down from the top, an antique-ivory point rising from the
bottom — on a near-black field. A single thin-rimmed gold circle sits exactly at
the crossing, like a checker balanced at the crux of the game. The negative
space on either side reads as two dark triangles, giving a heraldic, bilaterally
symmetric device.

Run:  python scripts/generate_icons.py
Outputs the full Expo asset set into ../assets/.
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))

# "The Crossed Points" palette
NEAR_BLACK = (24, 24, 24)     # #181818  background
MAHOGANY = (92, 32, 16)       # #5C2010  top point (pointing down)
IVORY = (245, 236, 215)       # #F5ECD7  bottom point (pointing up)
GOLD = (201, 162, 39)         # #C9A227  thin ring at the crossing
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

    # Two points meeting tip-to-tip at the centre -> a vertical hourglass.
    # Full-width bases keep the left/right negative space as two clean, sharp
    # dark triangles; the apexes meet exactly at the centre crossing point.
    top_tri = [L(0.0, 0.0), L(1.0, 0.0), L(0.5, 0.5)]   # mahogany, points down
    bot_tri = [L(0.0, 1.0), L(1.0, 1.0), L(0.5, 0.5)]   # ivory, points up
    ccx, ccy = L(0.5, 0.5)
    # Thin gold rim at the crossing. Floor the rim in pixels so it survives the
    # tiny (favicon / 60px) renders without vanishing.
    r_outer = 0.165 * span
    rim = max(1.5, 0.016 * size)
    r_inner = r_outer - rim

    def render(px, py):
        col = (0.0, 0.0, 0.0, 0.0)

        if monochrome:
            a = max(
                tri_coverage(px, py, top_tri),
                tri_coverage(px, py, bot_tri),
            )
            a = max(a, ring_coverage(px, py, ccx, ccy, r_outer, r_inner))
            return over(col, WHITE, a)

        if opaque_bg:
            col = (NEAR_BLACK[0], NEAR_BLACK[1], NEAR_BLACK[2], 1.0)

        # The crossed points (sharp, no rounding).
        col = over(col, MAHOGANY, tri_coverage(px, py, top_tri))
        col = over(col, IVORY, tri_coverage(px, py, bot_tri))
        # Thin-rimmed gold circle at the crossing — outline only, fill stays
        # transparent so the meeting tips show through the centre.
        col = over(col, GOLD, ring_coverage(px, py, ccx, ccy, r_outer, r_inner))
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
    # Main store / iOS icon — opaque near-black field + emblem.
    render_png(os.path.join(ASSETS, "icon.png"), 1024, opaque_bg=True, inset=0.84)
    # Android adaptive foreground — transparent, emblem kept inside the safe
    # zone (Expo paints the near-black backgroundColour behind it).
    render_png(os.path.join(ASSETS, "adaptive-icon.png"), 1024, opaque_bg=False, inset=0.62)
    # Splash logo — transparent, emblem centred (Expo paints the bg colour).
    render_png(os.path.join(ASSETS, "splash-icon.png"), 1024, opaque_bg=False, inset=0.70)
    # Web favicon — opaque, rendered small to confirm it stays crisp at 48px.
    render_png(os.path.join(ASSETS, "favicon.png"), 48, opaque_bg=True, inset=0.88)
    print("Done.")


if __name__ == "__main__":
    main()
