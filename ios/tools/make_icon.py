"""Renders the ToHuus app icon (green house mark with mustard door on white) from the paths in web/public/icon.svg.

The SVG house is drawn in a 32-unit box: roof/body path M4 28V14L16 4l12 10v14z, door M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z.
Usage: python3 ios/tools/make_icon.py <out.png>
"""
import sys
from PIL import Image, ImageDraw

S = 4  # supersampling
N = 1024 * S
img = Image.new("RGB", (N, N), (255, 255, 255))
d = ImageDraw.Draw(img)
GREEN = (0x17, 0x6B, 0x50)
MUSTARD = (0xE8, 0xB8, 0x65)

# centred, 24 units ≈ 600 px, so the iOS corner mask never touches the mark
U = 25
def pt(x, y):
    return ((512 + (x - 16) * U) * S, (512 + (y - 16) * U + 12) * S)

house = [pt(4, 28), pt(4, 14), pt(16, 4), pt(28, 14), pt(28, 28)]
d.polygon(house, fill=GREEN)
# door: rectangle 12.5..19.5 from y 21.5 to 28 with a semicircle top (radius 3.5, centre 16/21.5)
x0, y0 = pt(12.5, 21.5)
x1, y1 = pt(19.5, 28)
d.rectangle([x0, y0, x1, y1], fill=MUSTARD)
cx, cy = pt(16, 21.5)
r = 3.5 * U * S
d.pieslice([cx - r, cy - r, cx + r, cy + r], 180, 360, fill=MUSTARD)
img = img.resize((1024, 1024), Image.LANCZOS)
img.save(sys.argv[1] if len(sys.argv) > 1 else "AppIcon-1024.png")
