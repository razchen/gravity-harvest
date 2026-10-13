"""Convert the Unity Labs VFX flipbooks (CC0, art/vfx/unity_labs) into sprite sheets the game loads.

Run from the repo root (needs Python 3 with Pillow):
    python3 tools/sprites/pack_vfx.py

Source: https://unity.com/blog/engine-platform/free-vfx-image-sequences-flipbooks (CC0 1.0). The zips are in
art/vfx/unity_labs/zips; their `<Name>_<cols>x<rows>.tga` sheets are extracted to art/vfx/unity_labs/sheets.
Writes apps/game/public/assets/fx/<name>.png and fx.json (each sheet's frame size and frame count). Sheets whose
size doesn't divide by their grid are resized slightly so every frame is a whole number of pixels.
"""
import json
import os
import re

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "vfx", "unity_labs", "sheets")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "fx")


# Tried and dropped (/dev/fx.html): not packed.
SKIP = {"smallflame01"}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for f in sorted(os.listdir(SRC)):
        m = re.match(r"(.+)_(\d+)x(\d+)\.tga$", f)
        if not m:
            continue
        name, cols, rows = m.group(1).lower(), int(m.group(2)), int(m.group(3))
        if name in SKIP:
            continue
        im = Image.open(os.path.join(SRC, f)).convert("RGBA")
        w, h = im.size
        fw, fh = round(w / cols), round(h / rows)
        if (fw * cols, fh * rows) != (w, h):
            im = im.resize((fw * cols, fh * rows), Image.LANCZOS)
        im.save(os.path.join(OUT, f"{name}.png"), optimize=True)
        index[name] = {"file": f"{name}.png", "frameWidth": fw, "frameHeight": fh, "frames": cols * rows}
        print(f"{name}: {cols}x{rows} frames of {fw}x{fh}")
    json.dump(index, open(os.path.join(OUT, "fx.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
