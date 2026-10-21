"""
One of our players' pictures from his cut-out in our kit (transparent PNG, 1024x1024, head at the top):
  python3 scripts/player-images.py public/brand/nguyen-kit.png public/brand/schnoeselmob.png public/img/custom/schnoeselmob-banner.jpg public/img/custom/nguyen4
writes <out>-avatar.jpg (like LigaInsider's player pictures: our crest large and pale behind him on white)
and <out>-banner.jpg (him in front of our crest in the stadium).
"""
import sys
from PIL import Image, ImageFilter

cut_p, crest_p, banner_p, out = sys.argv[1:5]
person = Image.open(cut_p).convert("RGBA")
crest = Image.open(crest_p).convert("RGBA")

def shadowed(bg, p, x, y, strength=0.5, radius=16):
    sh = Image.new("RGBA", p.size, (0, 0, 0, 0))
    sh.putalpha(p.getchannel("A").point(lambda v: int(v * strength)))
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(radius)), (x + 6, y + 6))
    bg.alpha_composite(p, (x, y))
    return bg

# Avatar: head and shoulders (the top 720 px of the cut-out) on white with the pale crest.
av = Image.new("RGBA", (720, 720), (255, 255, 255, 255))
big = crest.resize((660, 660), Image.LANCZOS)
big.putalpha(big.getchannel("A").point(lambda v: int(v * 0.4)))
av.alpha_composite(big, (30, 40))
av.alpha_composite(person.crop((152, 10, 872, 730)))
av.convert("RGB").resize((240, 240), Image.LANCZOS).save(f"{out}-avatar.jpg", quality=90)

# Banner: down to the chest (crest included), in front of our crest in the stadium.
stadium = Image.open(banner_p).convert("RGBA").resize((1200, 675))
upper = person.crop((0, 20, 1024, 860))
k = 675 / upper.height * 1.0
upper = upper.resize((int(upper.width * k), int(upper.height * k)), Image.LANCZOS)
shadowed(stadium, upper, 600 - upper.width // 2, 675 - upper.height + 2).convert("RGB").save(f"{out}-banner.jpg", quality=88)
