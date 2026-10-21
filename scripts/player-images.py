"""
A player's pictures for one of our own posts, from a cut-out photo (transparent PNG, 800x800, in our shirt):
  python3 scripts/player-images.py public/brand/nguyen.png public/img/custom/schnoeselmob-banner.jpg public/img/custom/nguyen
writes <out>-banner.jpg (in front of our crest in the stadium), <out>-photo.jpg (blurred background, like
LigaInsider's player shots) and <out>-avatar.jpg (head, for the news list).
"""
import sys
from PIL import Image, ImageDraw, ImageFilter
cut_path, bg_path, out = sys.argv[1:4]
person = Image.open(cut_path).convert("RGBA")
W, H = person.size
CX, TOP = 410, 150  # neck centre, top of the hair

def place(bg, scale, x, y):
    p = person.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    sh = Image.new("RGBA", p.size, (0, 0, 0, 0)); sh.putalpha(p.getchannel("A").point(lambda v: int(v * 0.55)))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)), (x + 10, y + 8))
    bg.alpha_composite(p, (x, y))
    return bg

stadium = Image.open(bg_path).convert("RGBA").resize((1200, 675))
s = 675 / (H - TOP) * 0.97
place(stadium.copy(), s, 600 - int(CX * s), 677 - int(H * s)).convert("RGB").save(f"{out}-banner.jpg", quality=88)

blur = Image.blend(stadium.filter(ImageFilter.GaussianBlur(22)), Image.new("RGBA", stadium.size, (20, 22, 30, 255)), 0.25)
s = 675 / (H - 130)
place(blur, s, 690 - int(CX * s), 677 - int(H * s)).convert("RGB").save(f"{out}-photo.jpg", quality=88)

av = Image.new("RGBA", (W, H), (233, 233, 236, 255)); av.alpha_composite(person)
av.crop((110, 120, 710, 720)).resize((240, 240), Image.LANCZOS).convert("RGB").save(f"{out}-avatar.jpg", quality=88)
