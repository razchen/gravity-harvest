"""Pack the vehicles' renders (tools/blender/render_vehicle.py) into the game's atlases, and make their build cards.

Run from the repo root (needs Python 3 with Pillow and NumPy):
    python3 tools/sprites/pack_vehicles.py [id]

For each vehicle in tools/blender/vehicles.json with renders: its directions are lightened, trimmed and packed into
apps/game/public/assets/sprites/v_<id>.{png,json} (frames `v_<id>_<d>`, and its turning wheels `v_<id>_w<d>_<f>`;
one with a turning turret also has its hull without it, `v_<id>_h<d>`, and the turret alone, `v_<id>_t<t>`, with
`meta.turret_layer`), and its card view becomes
apps/game/public/assets/ui/<id>.png (square, like the building cards).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

from trim_pack import ROOT, pack_trimmed, square_card

FRAMES = os.path.join(ROOT, "tools", "blender", "frames", "vehicles")
UI = os.path.join(ROOT, "apps", "game", "public", "assets", "ui")
CARD = 320
MARGIN = 0.06
DIRECTION_0 = "nose along world +X (grid +gx); directions turn counter-clockwise seen from above"


def card(vid: str) -> None:
    square_card(os.path.join(FRAMES, vid, "card.png"), os.path.join(UI, f"{vid}.png"), CARD, MARGIN)


def main() -> None:
    want = sys.argv[1] if len(sys.argv) > 1 else None
    for vid in json.load(open(os.path.join(ROOT, "tools", "blender", "vehicles.json"))):
        if want and vid != want:
            continue
        src = os.path.join(FRAMES, vid)
        if not os.path.exists(os.path.join(src, "frames.json")):
            print(f"{vid}: not rendered yet")
            continue
        info = json.load(open(os.path.join(src, "frames.json")))
        frames = [(f"v_{vid}_{d}", np.array(Image.open(os.path.join(src, f"dir_{d}.png")).convert("RGBA"))) for d in range(info["directions"])]
        # the wheels turning, drawn over it while it drives (no shadow of their own: the vehicle's has them)
        wf = info.get("wheel_frames", 0)
        wheels = [(f"v_{vid}_w{d}_{f}", np.array(Image.open(os.path.join(src, f"wheel_{d}_{f}.png")).convert("RGBA")))
                  for d in range(info["directions"]) for f in range(wf)]
        # a turret that turns on its own: the hull without it, and the turret alone (its pivot on the anchor)
        turret = info.get("turret")
        if turret:
            frames += [(f"v_{vid}_h{d}", np.array(Image.open(os.path.join(src, f"hull_{d}.png")).convert("RGBA"))) for d in range(info["directions"])]
            frames += [(f"v_{vid}_t{t}", np.array(Image.open(os.path.join(src, f"turret_{t}.png")).convert("RGBA"))) for t in range(turret["directions"])]
        pack_trimmed(f"v_{vid}", frames + wheels, info["w"], info["h"],
                     {"anchor": info["anchor"], "res": info["res"], "directions": info["directions"], "direction_0": DIRECTION_0,
                      **({"wheel_frames": wf} if wf else {}), **({"turret_layer": turret} if turret else {})})
        card(vid)


if __name__ == "__main__":
    main()
