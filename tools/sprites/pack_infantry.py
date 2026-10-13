"""Pack a soldier's renders (tools/blender/make_infantry.py) into the game's atlases, trimmed, and make his build card.

Run from the repo root (needs Python 3 with Pillow and NumPy):
    python3 tools/sprites/pack_infantry.py rifleman

Reads tools/blender/frames/<unit>/frames.json and its frames, trims and packs them (trim_pack.py) and writes
apps/game/public/assets/sprites/<unit>.{png,json} and <unit>_death.{png,json}; with a card view (card.png), also
apps/game/public/assets/ui/<unit>.png (square, like the building cards).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

from trim_pack import ROOT, pack_trimmed, square_card

DIRECTION_0 = "facing world +X (grid +gx); directions turn counter-clockwise seen from above"


def main() -> None:
    unit = sys.argv[1]
    src = os.path.join(ROOT, "tools", "blender", "frames", unit)
    info = json.load(open(os.path.join(src, "frames.json")))
    for name, group in info.items():
        frames = [(f, np.array(Image.open(os.path.join(src, f"{f}.png")).convert("RGBA"))) for f in group["frames"]]
        meta = {k: v for k, v in group.items() if k not in ("frames", "w", "h")}
        pack_trimmed(name, frames, group["w"], group["h"], {"direction_0": DIRECTION_0, **meta})
    if os.path.exists(os.path.join(src, "card.png")):
        square_card(os.path.join(src, "card.png"), os.path.join(ROOT, "apps", "game", "public", "assets", "ui", f"{unit}.png"))


if __name__ == "__main__":
    main()
