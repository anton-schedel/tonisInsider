"""
Puts a club crest into a LigaInsider club image (stadium photo, crest faded behind and sharp in front).
The faded original crest is a scaled, semi-transparent copy of the sharp one, so it can be taken back out
of the photo: photo = (pixel - A * crest) / (1 - A). Fitted on borussia-dortmund-artikelbild-2025-v2:
  python3 scripts/club-banner.py bvb.jpg public/brand/schnoeselmob.png out.jpg 0.2 1.48 602 338
(args: source, crest PNG, output, opacity A, scale S of the faded crest, center x, center y)
"""
import sys, math
from PIL import Image, ImageDraw, ImageFilter
src, logo_path, out, A, S = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
im = Image.open(src).convert("RGB"); W, H = im.size
px = im.load(); orig = im.copy(); op = orig.load()
CX, CY, R = int(sys.argv[6]), int(sys.argv[7]), 238
RF = R * S                          # faded crest
clean = im.copy(); cp = clean.load()
for y in range(H):
    for x in range(W):
        dx, dy = x - CX, y - CY
        d = math.hypot(dx, dy)
        if d <= R or d > RF + 2: continue
        sx, sy = CX + dx / S, CY + dy / S
        c = op[int(sx), int(sy)]
        o = op[x, y]
        # soft edge of the faded crest
        a = A * max(0.0, min(1.0, (RF + 1 - d) / 2))
        cp[x, y] = tuple(max(0, min(255, round((o[i] - a * c[i]) / (1 - a)))) for i in range(3))
logo = Image.open(logo_path).convert("RGBA")
base = clean.convert("RGBA")
big = logo.resize((round(2 * RF), round(2 * RF)), Image.LANCZOS)
big.putalpha(big.getchannel("A").point(lambda v: int(v * 0.24)))
base.alpha_composite(big, (round(CX - RF), round(CY - RF)))
front = logo.resize((2 * R + 4, 2 * R + 4), Image.LANCZOS)
base.alpha_composite(front, (CX - R - 2, CY - R - 2))
base.convert("RGB").save(out, quality=90)
