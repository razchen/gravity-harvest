"""Make the dev pages' building pictures from the preview renders (render_construction.py with PREVIEW=3).

Run from the repo root (needs Python 3 with Pillow and NumPy):
    python3 tools/sprites/pack_previews.py

Each tools/blender/frames/construction/<atlas>/preview.png is cropped to the building and its shadow (lightened), scaled
to at most WIDTH px wide and written to apps/game/public/assets/previews/<atlas>.webp (the gallery's), and at full size
(up to LARGE) to <atlas>_large.webp (the building page's Picture tab). previews.json records where the
building itself is in each picture: the dev pages size and centre the building by that and let its shadow spill out.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRAMES = os.path.join(ROOT, "tools", "blender", "frames", "construction")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "previews")
WIDTH = 1200
LARGE = 4000      # the Picture tab's full-size copy (<atlas>_large.webp), at most this wide
SHADOW = 0.6      # the baked shadow's strength in the picture
BLACK = 8


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    index = {}
    # buildings' previews (render_construction.py with PREVIEW) and vehicles' card views (render_vehicle.py)
    sources = [(atlas, os.path.join(FRAMES, atlas, "preview.png")) for atlas in sorted(os.listdir(FRAMES))]
    vehicles = os.path.join(ROOT, "tools", "blender", "frames", "vehicles")
    if os.path.isdir(vehicles):
        sources += [(f"v_{v}", os.path.join(vehicles, v, "card.png")) for v in sorted(os.listdir(vehicles))]
    for atlas, src in sources:
        if not os.path.exists(src):
            continue
        a = np.array(Image.open(src).convert("RGBA"))
        shadow = (a[:, :, 3] > 0) & (a[:, :, 3] < 250) & (a[:, :, :3].max(axis=2) <= BLACK)
        a[:, :, 3] = np.where(shadow, (a[:, :, 3] * SHADOW).round(), a[:, :, 3]).astype(np.uint8)
        ys, xs = np.nonzero(a[:, :, 3] > 8)
        m = int(0.02 * a.shape[1])
        y0, x0 = max(0, ys.min() - m), max(0, xs.min() - m)
        crop = a[y0:ys.max() + m, x0:xs.max() + m]
        im = Image.fromarray(crop)
        big = im if im.width <= LARGE else im.resize((LARGE, round(im.height * LARGE / im.width)), Image.LANCZOS)
        big.save(os.path.join(OUT, f"{atlas}_large.webp"), quality=92, method=6)
        k = min(1.0, WIDTH / im.width)
        if k < 1:
            im = im.resize((WIDTH, round(im.height * k)), Image.LANCZOS)
        im.save(os.path.join(OUT, f"{atlas}.webp"), quality=90, method=6)
        # where the building itself is in the picture: the pages size and centre it by that, and let the shadow spill
        by, bx = np.nonzero((crop[:, :, 3] > 200) & ~shadow[y0:y0 + crop.shape[0], x0:x0 + crop.shape[1]])
        index[atlas] = {"w": im.width, "h": im.height, "body": {"x": round(bx.min() * k), "y": round(by.min() * k),
                        "w": round((bx.max() - bx.min()) * k), "h": round((by.max() - by.min()) * k)}}
        print(f"{atlas}: {im.width}x{im.height} (large {big.width}x{big.height})")
    json.dump(index, open(os.path.join(OUT, "previews.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
