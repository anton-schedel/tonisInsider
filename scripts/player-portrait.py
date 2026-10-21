"""
One of our players in our kit, from a LigaInsider player portrait (studio shot, straight on, like his photo):
his head on the portrait's shirt, our crest behind him and on his chest, the kit's blue trim turned gold.
  python3 scripts/player-portrait.py <head.png> <portrait.jpg> <shirt-mask.png> <crest.png> <club-banner.jpg> <out>
writes <out>-avatar.jpg (the portrait, like LigaInsider's) and <out>-banner.jpg (him in front of our banner).
Fitted on Santiago-Castaneda-paderborn-2627 (large, 421x430). The head cut-out: transparent PNG with head and
neck, eyes' midpoint at (242, 297), chin at y 497, neck centre x 261.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

head_p, portrait_p, mask_p, crest_p, banner_p, out = sys.argv[1:7]
portrait = Image.open(portrait_p).convert("RGB")
W, H = portrait.size
src = np.asarray(portrait).astype(float)
shirt = np.asarray(Image.open(mask_p).convert("L").resize((W, H))).astype(float) / 255
# None of the original player's skin along the collar (it would show beside his neck).
orig_skin = (src[..., 0] > 110) & (src[..., 0] - src[..., 2] > 18) & (src[..., 0] >= src[..., 1])
shirt = shirt * ~np.asarray(Image.fromarray((orig_skin * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))).astype(bool)
crest = Image.open(crest_p).convert("RGBA")

def blur(a, r):
    return np.asarray(Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float)

# Background like LigaInsider's portraits: white, the club crest large and pale behind the player.
bg = Image.new("RGBA", (W, H), (255, 255, 255, 255))
big = crest.resize((420, 420), Image.LANCZOS)
big.putalpha(big.getchannel("A").point(lambda v: int(v * 0.42)))
bg.alpha_composite(big, (211 - 210, 215 - 210))
img = np.asarray(bg.convert("RGB")).astype(float)

# Inside the neckline, where his (slimmer) neck doesn't reach: the shirt's dark inner back.
inner = Image.new("L", (W, H), 0)
ImageDraw.Draw(inner).polygon([(150, 272), (270, 272), (300, 268), (250, 330), (210, 356), (170, 330), (122, 268)], fill=255)
inner = blur(np.asarray(inner.filter(ImageFilter.MaxFilter(9))).astype(float), 1.5)[..., None] / 255
img = img * (1 - inner) + np.array([30, 32, 38.0]) * inner

# His head: neck widened a little towards the collar, scaled to the portrait, colours moved towards its light.
head = np.asarray(Image.open(head_p).convert("RGBA")).astype(float)
# The cut-out's lower neck lies in his hoodie's shadow: continue the lit part (rows 535-550) downwards,
# slowly darker as it goes under the collar.
lit = head[535:550].mean(0)
n = 160
ext = np.repeat(lit[None], n, 0)
ext[..., :3] *= np.linspace(1, 0.82, n)[:, None, None]
head = np.concatenate([head[:550], ext], 0)
hh, hw = head.shape[:2]
for y in range(470, hh):
    f = 1 + 0.6 * min((y - 470) / 80, 1) ** 1.4
    xs = np.clip(261 + (np.arange(hw) - 261) / f, 0, hw - 1)
    row = head[y].copy()
    for c in range(4):
        head[y, :, c] = np.interp(xs, np.arange(hw), row[:, c])
s = 0.62
head_im = Image.fromarray(head.clip(0, 255).astype(np.uint8)).resize((int(hw * s), int(hh * s)), Image.LANCZOS)
h = np.asarray(head_im).astype(float)
skin = (h[..., 3] > 200) & (h[..., 0] > 110) & (h[..., 0] - h[..., 2] > 15)
face = src[80:240, 150:270].reshape(-1, 3)
face = face[(face[:, 0] > 120) & (face[:, 0] - face[:, 2] > 20)]
if skin.any() and len(face):
    mu_h, mu_p = h[skin][:, :3].mean(0), face.mean(0)
    h[..., :3] = np.clip(h[..., :3] + 0.45 * (mu_p - mu_h), 0, 255)
hx, hy = 210 - int(242 * s), 117 - int(297 * s)
layer = np.zeros((H, W, 4))
y0, x0 = max(hy, 0), max(hx, 0)
part = h[y0 - hy:, x0 - hx:][: H - y0, : W - x0]
layer[y0:y0 + part.shape[0], x0:x0 + part.shape[1]] = part
ha = layer[..., 3:4] / 255
img = img * (1 - ha) + layer[..., :3] * ha

# The portrait's shirt on top (so the collar sits in front of his neck), blue trim turned gold.
kit = src.copy()
lum = kit[..., 0] * 0.3 + kit[..., 1] * 0.55 + kit[..., 2] * 0.15
trim = (kit[..., 2] > 110) & (kit[..., 2] - kit[..., 0] > 60)
GOLD = np.array([206, 166, 84.0])
kit = np.where(trim[..., None], np.clip(GOLD * (lum[..., None] / 140) ** 0.9, 0, 255), kit)
sa = blur(shirt * 255, 0.7)[..., None] / 255
img = img * (1 - sa) + kit * sa
person_a = np.maximum(np.maximum(ha[..., 0], sa[..., 0]), inner[..., 0])

# Our crest on the chest instead of theirs.
res = Image.fromarray(img.clip(0, 255).astype(np.uint8))
patch = Image.new("L", (W, H), 0)
ImageDraw.Draw(patch).ellipse((262, 380, 356, 446), fill=255)
patch = Image.fromarray((np.asarray(patch.filter(ImageFilter.GaussianBlur(3))) * shirt).astype(np.uint8))
dark = Image.new("RGB", (W, H), tuple(int(v) for v in np.median(src[395:430, 150:250].reshape(-1, 3), 0)))
res = Image.composite(dark, res, patch)
small = crest.resize((70, 70), Image.LANCZOS)
res.paste(small, (308 - 35, 414 - 35), small)

res.crop((0, 0, W, W)).resize((240, 240), Image.LANCZOS).save(f"{out}-avatar.jpg", quality=90)

# Banner: him (head and shirt, without the portrait's background) in front of our crest in the stadium.
cut = res.convert("RGBA")
# The portrait ends at its sides: let the shoulders fade out there instead of a hard edge.
edge = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / 45, 0, 1)[None, :]
cut.putalpha(Image.fromarray((person_a * edge * 255).clip(0, 255).astype(np.uint8)))
stadium = Image.open(banner_p).convert("RGBA").resize((1200, 675))
k = 675 / H * 1.02
cut = cut.resize((int(W * k), int(H * k)), Image.LANCZOS)
shadow = Image.new("RGBA", cut.size, (0, 0, 0, 0))
shadow.putalpha(cut.getchannel("A").point(lambda v: int(v * 0.5)))
x, y = 600 - int(210 * k), 675 - cut.height + 4
stadium.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16)), (x + 8, y + 6))
stadium.alpha_composite(cut, (x, y))
stadium.convert("RGB").save(f"{out}-banner.jpg", quality=88)
