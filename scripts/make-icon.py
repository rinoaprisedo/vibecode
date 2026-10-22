"""Generates Vibecode.icns: an orange rounded square with the sparkle mark."""
import math, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

out = sys.argv[1]
S = 1024
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# macOS icon grid: art sits in an 824px rounded square centred on the canvas
m = 100
grad = Image.new("RGBA", (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = (int(233 + (185 - 233) * t), int(148 + (85 - 148) * t), int(111 + (58 - 111) * t), 255)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([m, m, S - m, S - m], radius=185, fill=255)
im.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(im)
c = S / 2
for i in range(8):
    a = i * math.pi / 4
    long = i % 2 == 0
    r0, r1 = 70, 290 if long else 215
    w = 46 if long else 34
    p0 = (c + math.cos(a) * r0, c + math.sin(a) * r0)
    p1 = (c + math.cos(a) * r1, c + math.sin(a) * r1)
    d.line([p0, p1], fill=(255, 255, 255, 255), width=w)
    for p in (p0, p1):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=(255, 255, 255, 255))

with tempfile.TemporaryDirectory() as t:
    iconset = os.path.join(t, "Vibecode.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        im.resize((size, size), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}.png")
        im.resize((size * 2, size * 2), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
print("icon:", out)
