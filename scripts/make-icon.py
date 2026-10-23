"""Generates Vibecoder.icns from Logo-Vibecoder.png: the V mark on a dark rounded square.
Usage: make-icon.py <out.icns> [logo.png]   (needs Pillow, numpy, scipy)"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

out = sys.argv[1]
logo_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "Logo-Vibecoder.png")

# Clean the logo: keep only the largest solid shape, dropping the stray specks around it.
logo = Image.open(logo_path).convert("RGBA")
a = np.array(logo)
labels, n = ndimage.label(a[..., 3] > 40)
if n > 1:
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, n + 1))
    keep = labels == (1 + int(np.argmax(sizes)))
    keep = ndimage.binary_dilation(keep, iterations=3)  # keep the anti-aliased edge
    a[..., 3] = np.where(keep, a[..., 3], 0)
logo = Image.fromarray(a).crop(Image.fromarray(a).getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox())

S = 1024
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
m = 100  # macOS icon grid: art sits in an 824px rounded square centred on the canvas
bg = Image.new("RGBA", (S, S))
px = bg.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        v = int(44 + (22 - 44) * t)
        px[x, y] = (v, v, v + 2, 255)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([m, m, S - m, S - m], radius=185, fill=255)
im.paste(bg, (0, 0), mask)

target = int((S - 2 * m) * 0.58)
scale = target / max(logo.size)
logo = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
im.alpha_composite(logo, ((S - logo.width) // 2, (S - logo.height) // 2))

with tempfile.TemporaryDirectory() as t:
    iconset = os.path.join(t, "Vibecoder.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        im.resize((size, size), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}.png")
        im.resize((size * 2, size * 2), Image.LANCZOS).save(f"{iconset}/icon_{size}x{size}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
im.save(os.path.splitext(out)[0] + "-preview.png")
print("icon:", out)
