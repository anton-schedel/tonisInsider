"""
One of our players in our shirt: his head on a LigaInsider player photo (dark kit), our crest on the chest,
the kit's blue trim turned gold. Fitted on oliver-batista-meier-paderborn-2026-2027 (1200x675):
  python3 scripts/player-photo.py public/brand/nguyen-head.png paderborn.jpg public/brand/schnoeselmob.png public/img/custom/nguyen
writes <out>-banner.jpg (the article photo) and <out>-avatar.jpg (head, for the news list).
The head cut-out: transparent PNG with head and neck, eyes' midpoint at (242, 297).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

head_p, photo_p, crest_p, out = sys.argv[1:5]
photo = Image.open(photo_p).convert("RGB")
W, H = photo.size
img = np.asarray(photo).astype(float)
yy, xx = np.mgrid[0:H, 0:W]

# The kit's neckline: the original head and neck sit above it, the shirt below.
COLLAR = [(380, 395), (470, 368), (512, 342), (560, 368), (601, 410), (650, 366), (706, 327), (770, 352), (860, 400)]
def below_collar():
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon(COLLAR + [(W, H), (0, H)], fill=255)
    return np.asarray(m) > 0
shirt_side = below_collar()

# 1) Paint out the original head: everything above the collar that isn't the blurred blue background,
#    filled from the surrounding background (normalised blur, coarse to fine).
zone = Image.new("L", (W, H), 0)
ImageDraw.Draw(zone).ellipse((470, -60, 800, 440), fill=255)
hole = (np.asarray(zone) > 0) & ~shirt_side
known = ~hole & ~shirt_side
fill = img.copy()
for r in (60, 30, 14):
    k = Image.fromarray((known * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    w = np.asarray(k).astype(float) / 255
    ch = [np.asarray(Image.fromarray((img[..., c] * known).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) for c in range(3)]
    est = np.stack(ch, -1) / np.maximum(w[..., None], 1e-3)
    fill = np.where((hole & (w > 0.02))[..., None], est, fill)
# Smooth the fill (the background is out of focus anyway) and feather its edge into the photo.
fill = np.stack([np.asarray(Image.fromarray(fill[..., c].clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18))).astype(float) for c in range(3)], -1)
feather = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(float)[..., None] / 255
feather = np.where(shirt_side[..., None], 0, feather)
img = img * (1 - feather) + fill * feather
# Inside the neckline: the shirt's dark inner back, where his neck doesn't reach.
inner = Image.new("L", (W, H), 0)
ImageDraw.Draw(inner).polygon([(505, 346), (520, 330), (700, 318), (712, 330), (650, 366), (601, 410), (560, 368)], fill=255)
inner = np.asarray(inner.filter(ImageFilter.GaussianBlur(2))).astype(float)[..., None] / 255 * (~shirt_side)[..., None]
img = img * (1 - inner) + np.array([28, 30, 36.0]) * inner

# 2) His head, scaled to the original's size, matched to the photo's warm daylight, behind the collar.
head = Image.open(head_p).convert("RGBA")
s = 0.8
head = head.resize((int(head.width * s), int(head.height * s)), Image.LANCZOS)
hx, hy = 616 - int(242 * s), 188 - int(297 * s)
h = np.asarray(head).astype(float)
skin = (h[..., 3] > 200) & (h[..., 0] > 110) & (h[..., 0] - h[..., 2] > 15)
face_ref = img[150:300, 560:690][(img[150:300, 560:690, 0] > 120) & (img[150:300, 560:690, 0] - img[150:300, 560:690, 2] > 25)]
if skin.any() and len(face_ref):
    mu_h, sd_h = h[skin][:, :3].mean(0), h[skin][:, :3].std(0)
    mu_p, sd_p = face_ref.mean(0), face_ref.std(0)
    moved = (h[..., :3] - mu_h) * (0.6 + 0.4 * sd_p / sd_h) + mu_h + 0.7 * (mu_p - mu_h)
    h[..., :3] = np.clip(moved, 0, 255)
layer = np.zeros((H, W, 4))
y0, x0 = max(hy, 0), max(hx, 0)
crop = h[y0 - hy:y0 - hy + H - y0, x0 - hx:x0 - hx + W - x0]
layer[y0:y0 + crop.shape[0], x0:x0 + crop.shape[1]] = crop
soft_shirt = np.asarray(Image.fromarray((shirt_side * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
la = layer[..., 3:4] / 255 * (1 - soft_shirt[..., None])
img = img * (1 - la) + layer[..., :3] * la

# 3) Our colours: the blue trim on the shirt turns gold.
torso = Image.new("L", (W, H), 0)
ImageDraw.Draw(torso).polygon([(270, 675), (300, 520), (360, 420), (470, 372), (512, 344), (601, 412), (706, 329), (800, 368), (880, 420), (940, 520), (985, 675)], fill=255)
torso = np.asarray(torso) > 0
# Brighter than the blurred background (about 15, 97, 163), so only the kit's trim and logo change.
trim = torso & shirt_side & (((img[..., 2] > 172) & (img[..., 1] > 108)) | (img[..., 2] > 200)) & (img[..., 2] - img[..., 0] > 70)
lum = img[..., 0] * 0.3 + img[..., 1] * 0.55 + img[..., 2] * 0.15
GOLD = np.array([206, 166, 84.0])
img = np.where(trim[..., None], np.clip(GOLD * (lum[..., None] / 140) ** 0.9, 0, 255), img)

# 4) Our crest over theirs (the dark patch first, so nothing of the old one shows).
out_im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
patch = Image.new("L", (W, H), 0)
ImageDraw.Draw(patch).ellipse((652, 452, 764, 536), fill=255)
patch = patch.filter(ImageFilter.GaussianBlur(4))
dark = Image.fromarray(np.full((H, W, 3), np.median(img[540:600, 640:780].reshape(-1, 3), 0)).astype(np.uint8))
out_im = Image.composite(dark, out_im, patch)
crest = Image.open(crest_p).convert("RGBA").resize((84, 84), Image.LANCZOS)
out_im.paste(crest, (708 - 42, 494 - 42), crest)
out_im.save(f"{out}-banner.jpg", quality=88)
out_im.crop((616 - 200, 0, 616 + 200, 400)).resize((240, 240), Image.LANCZOS).save(f"{out}-avatar.jpg", quality=88)
