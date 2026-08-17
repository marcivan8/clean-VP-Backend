"""
Generates the small built-in graphic library for the Motion Graphics
Components feature (CLAUDE.md R65). Shipped as committed PNG files (not SVG,
deliberately — PNG decoding needs no librsvg build flag, which a deployed
ffmpeg binary is not guaranteed to have; PNG has zero such risk) under
client/public/motion-assets/, the same "commit real files, reference by
ordinary URL" precedent already established for the app's 44 bundled font
TTFs (see ADR-001 Phase 5 / CLAUDE.md).

Re-run: python3 scripts/gen_motion_assets.py
"""
from PIL import Image, ImageDraw, ImageFont
import math, os

OUT = "/mnt/user-data/uploads/clean-VP-Backend/client/public/motion-assets"
os.makedirs(OUT, exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

def rounded_rect_rgba(size, radius, fill):
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size[0]-1, size[1]-1], radius=radius, fill=fill)
    return img

# 1. arrow.png — right-pointing arrow (shaft + triangular head), centred,
#    so a component can point it any direction purely via clip.rotation
#    (reuses the existing rotation-animatable prop — no per-direction assets).
def make_arrow():
    W, H = 512, 512
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cy = H // 2
    shaft_h = 60
    shaft_w = 260
    x0 = 60
    d.rounded_rectangle([x0, cy - shaft_h//2, x0 + shaft_w, cy + shaft_h//2], radius=shaft_h//2, fill=(255,255,255,255))
    head_x = x0 + shaft_w - 20
    d.polygon([(head_x, cy - 130), (head_x + 190, cy), (head_x, cy + 130)], fill=(255,255,255,255))
    img.save(f"{OUT}/arrow.png")

# 2/3. bar-dark.png / bar-light.png — a translucent rounded bar, used as the
#    background for LowerThird/Callout.
def make_bar(name, fill):
    img = rounded_rect_rgba((1280, 220), 40, fill)
    img.save(f"{OUT}/{name}.png")

# 4. quote-mark.png — a large opening quotation glyph, for QuoteCard.
def make_quote_mark():
    W, H = 420, 340
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_SERIF_BOLD, 420)
    # DejaVu Serif Bold's left double quotation mark glyph, drawn oversized
    # and cropped to its own bounding box rather than guessed-at coordinates.
    text = "“"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    d.text((-bbox[0] + (W-tw)//2, -bbox[1] + (H-th)//2), text, font=font, fill=(255,255,255,255))
    img.save(f"{OUT}/quote-mark.png")

# 5. subscribe-badge.png — a red circular badge with a simplified white bell
#    glyph, for CTAWidget's "subscribe"/"follow" presets.
def make_subscribe_badge():
    W, H = 400, 400
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([10, 10, W-10, H-10], fill=(229, 9, 20, 255))  # YouTube-red-ish, generic brand accent
    # Simplified bell: a dome (pie) + base rectangle + a small clapper circle.
    cx, cy = W//2, H//2 - 10
    d.pieslice([cx-70, cy-90, cx+70, cy+50], start=180, end=360, fill=(255,255,255,255))
    d.rectangle([cx-80, cy-10, cx+80, cy+18], fill=(255,255,255,255))
    d.polygon([(cx-80, cy+18), (cx-100, cy+46), (cx-60, cy+18)], fill=(255,255,255,255))
    d.polygon([(cx+80, cy+18), (cx+100, cy+46), (cx+60, cy+18)], fill=(255,255,255,255))
    d.ellipse([cx-16, cy+42, cx+16, cy+74], fill=(255,255,255,255))
    img.save(f"{OUT}/subscribe-badge.png")

make_arrow()
make_bar("bar-dark", (10, 10, 14, 165))
make_bar("bar-light", (255, 255, 255, 220))
make_quote_mark()
make_subscribe_badge()
print("done:", os.listdir(OUT))
