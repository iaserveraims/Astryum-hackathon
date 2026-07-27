#!/usr/bin/env python3
"""Generate the Astryum social preview (Open Graph / Twitter) card.

Dark space backdrop + comet-asteroid mark + white "Astryum" wordmark + gold tagline.
Fixes the washed-out white preview: the previous OG image was a transparent PNG that
messengers composite onto white, hiding the white wordmark.

Usage:  pip install Pillow && python3 frontend/scripts/generate-og-image.py
Output: frontend/public/astryum-og.png  (referenced from src/app/layout.tsx)
"""
import math, random, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

PUB = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "public"))
W, H = 1200, 630
GOLD = (201, 162, 39)          # #C9A227 brand gold
GOLD_HOT = (245, 179, 1)       # warmer gold used in the mark
random.seed(7)

# ---------- background: dark space with a lifted upper third ----------
card = Image.new("RGB", (W, H), (6, 6, 12))
grad = Image.new("L", (1, H))
for y in range(H):
    t = y / H
    v = int(255 * math.exp(-((t - 0.30) ** 2) / 0.16))  # brightest ~30% down
    grad.putpixel((0, y), v)
grad = grad.resize((W, H))
card = Image.composite(Image.new("RGB", (W, H), (22, 22, 38)), card, grad)

draw = ImageDraw.Draw(card, "RGBA")

# ---------- stars ----------
def star(cx, cy, r, col, a):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (a,))

for _ in range(170):
    x = random.randint(0, W); y = random.randint(0, H)
    r = random.choice([0, 0, 0, 1, 1, 1])
    a = random.randint(40, 170)
    if random.random() < 0.10:
        star(x, y, max(r, 1), GOLD, a)
    else:
        star(x, y, r, (255, 255, 255), a)
for _ in range(9):  # brighter sparkle stars with cross rays
    x = random.randint(60, W - 60); y = random.randint(40, H - 40)
    a = random.randint(150, 230)
    star(x, y, 1, (255, 255, 255), a)
    draw.line([x - 6, y, x + 6, y], fill=(255, 255, 255, a // 2))
    draw.line([x, y - 6, x, y + 6], fill=(255, 255, 255, a // 2))

# ---------- gold glow behind the mark ----------
Xd, Yd = 452, 262          # disc centre on the card (lockup visually centred)
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for rad, al in [(260, 26), (190, 34), (130, 46), (80, 60)]:
    gd.ellipse([Xd - rad, Yd - rad, Xd + rad, Yd + rad], fill=GOLD_HOT + (al,))
glow = glow.filter(ImageFilter.GaussianBlur(46))
card = Image.alpha_composite(card.convert("RGBA"), glow).convert("RGB")

# ---------- asteroid + comet streaks ----------
ast = Image.open(os.path.join(PUB, "astryum_logo-nobackground.png")).convert("RGBA")
solid = (524, 198, 968, 695)                 # streaks + disc bbox
crop = ast.crop((solid[0] - 10, solid[1] - 10, solid[2] + 10, solid[3] + 10))
disc_d = 190
s = disc_d / 264.0
crop = crop.resize((round(crop.width * s), round(crop.height * s)), Image.LANCZOS)
dcx, dcy = round(302 * s), round(341 * s)    # disc centre inside padded crop
card.paste(crop, (Xd - dcx, Yd - dcy), crop)

# ---------- wordmark (crop just the "Astryum" letters from the white lockup) ----------
lock = Image.open(os.path.join(PUB, "astryum-logo-white.png")).convert("RGBA")
word = lock.crop((148, 22, 540, 164))       # excludes mini-asteroid + white tagline
word = word.crop(word.getbbox())
wh = 108
ww = round(word.width * wh / word.height)
word = word.resize((ww, wh), Image.LANCZOS)
wx = Xd + 95 + 40            # right of the disc
card.paste(word, (wx, Yd - wh // 2), word)

# ---------- tagline + url ----------
draw = ImageDraw.Draw(card, "RGBA")
mono = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 30)
url_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 24)

def spaced_centered(text, font, y, fill, tracking):
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (W - total) / 2
    for ch, wch in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += wch + tracking

spaced_centered("FINANCIAL CONTROL. TOTAL CLARITY.", mono, 430, GOLD + (255,), 6)
spaced_centered("astryum.xyz", url_font, 512, (150, 150, 165, 255), 4)

# ---------- subtle vignette ----------
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.25, -H * 0.25, W * 1.25, H * 1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(120))
card = Image.composite(card, Image.new("RGB", (W, H), (0, 0, 0)), vig)

out = os.path.join(PUB, "astryum-og.png")
card.save(out, "PNG")
print("wrote", out, card.size)
