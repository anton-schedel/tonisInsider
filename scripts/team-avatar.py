"""A team photo's avatar (480x480 JPEG), like Kevin's first one: the cut-out player's head and shoulders on white, our
crest at 60% behind him in its own colours. Runs on the owner's Mac (needs Pillow), never in the build.

  swift scripts/lift-subject.swift photo.jpg cut.png
  python3 scripts/team-avatar.py cut.png public/brand/schnoeselmob.png avatar.jpg

Then, signed in on /schnoeselmob/ (the browser's "coach" cookie), upload it and attach it to the player's team photo:
  curl -b coach=… -H "Origin: $SITE" -H "content-type: image/jpeg" --data-binary @avatar.jpg "$SITE/api/coach/images/?w=480&h=480"  → {"id"}
  curl -b coach=… -H "Origin: $SITE" -X PUT -d '{"player":"Luca Loibl","imageId":"<his team photo>","avatarId":"<id>"}' "$SITE/api/coach/team-photos/"
"""
import sys
from PIL import Image, ImageFilter

cut_p, crest_p, out_p = sys.argv[1:4]
person = Image.open(cut_p).convert("RGBA")
a = person.getchannel("A")
W, H = person.size
# Head: the top of the subject, and its middle from the rows just below (the face).
solid = a.point(lambda v: 255 if v > 128 else 0)
top = solid.getbbox()[1]
row = solid.crop((0, top + int(0.06 * H), W, top + int(0.14 * H))).getbbox()
cx = (row[0] + row[2]) // 2
# Kevin's framing: a square 70% of the photo wide, the hair a little below the top edge.
side = int(0.70 * W)
x0, y0 = cx - side // 2, top - int(0.02 * H)

out = Image.new("RGBA", (side, side), (255, 255, 255, 255))
crest = Image.open(crest_p).convert("RGBA")
size = int(side * 660 / 720)
crest = crest.resize((size, size), Image.LANCZOS)
crest.putalpha(crest.getchannel("A").point(lambda v: int(v * 0.6)))
out.alpha_composite(crest, (int(side * 30 / 720), int(side * 40 / 720)))
out.alpha_composite(person.crop((x0, y0, x0 + side, y0 + side)))
# 480 px: the feed circle is 64 pt, 192 px on a 3x iPhone, so there's room to spare; a light unsharp mask gives
# back the crispness the shrinking takes.
small = out.convert("RGB").resize((480, 480), Image.LANCZOS)
small.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2)).save(out_p, quality=90)
