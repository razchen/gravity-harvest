"""Take the baked ground shadows out of the rendered sprites, so every static shadow shares one mask in the game.

Run from the repo root after rendering sprites (needs Python 3 with Pillow and NumPy):
    python3 tools/sprites/split_shadows.py

The Blender renders bake a shadow catcher into each sprite: pure black pixels at up to ~57% opacity. Those are easy
to tell apart from the object itself (whose edges are coloured), so:

- Buildings (BUILDINGS): the shadow is removed from every frame and written as a separate full-strength mask,
  `<file>_shadow.{png,json}` (one frame, same size and anchor as the body; for animated atlases the union of all
  frames). The game draws it into the shared shadow layer with the scenery's shadows, shown at 18% at most, so
  overlapping shadows never get darker (apps/game/src/world/ShadowLayer.ts).
- Moving things and ore (SCALED): the baked shadow stays in the sprite (it moves with it) but is lightened to match
  the shared layer's 18%.

Untouched renders are copied to art/sprites/baked/ first (gitignored originals) and every run starts from those, so
the script can be re-run any time. A fresh render (its JSON has no "shadow" field yet) replaces the stored copy.
"""
import json
import os
import shutil

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPRITES = os.path.join(ROOT, "apps", "game", "public", "assets", "sprites")
BAKED = os.path.join(ROOT, "art", "sprites", "baked")

# atlas file -> the texture key the game uses for it (apps/game/src/assets/manifest.ts)
BUILDINGS = {"b_power": "b_power", "b_barracks": "b_barracks", "b_radar": "b_radar", "refinery_door": "door"}
SCALED = ["harvester", "rifleman"]  # (ore is drawn from flat decals in the scenery atlas now)

BAKED_PEAK = 145          # alpha of the darkest baked shadow (~57%); maps to full strength in the mask
SHARED_ALPHA = 0.18       # the shared shadow layer's opacity (keep in sync with ShadowLayer.ts)
BLACK = 8                 # a shadow pixel's colour is at most this bright


def load_original(name: str):
    """The untouched render (and its JSON), keeping a copy in art/sprites/baked."""
    png, js = os.path.join(SPRITES, f"{name}.png"), os.path.join(SPRITES, f"{name}.json")
    os.makedirs(BAKED, exist_ok=True)
    data = json.load(open(js))
    if "shadow" not in data["meta"]:                      # fresh render: this is the original
        shutil.copy2(png, os.path.join(BAKED, f"{name}.png"))
        shutil.copy2(js, os.path.join(BAKED, f"{name}.json"))
    src = os.path.join(BAKED, f"{name}.png")
    if not os.path.exists(src):
        raise SystemExit(f"{name}: already processed but art/sprites/baked/{name}.png is missing; re-render it")
    return np.array(Image.open(src).convert("RGBA")), json.load(open(os.path.join(BAKED, f"{name}.json")))


def shadow_pixels(rgba: np.ndarray) -> np.ndarray:
    a = rgba[:, :, 3]
    return (a > 0) & (a < 250) & (rgba[:, :, :3].max(axis=2) <= BLACK)


def split(name: str, key: str) -> None:
    rgba, data = load_original(name)
    shadow = shadow_pixels(rgba)
    strength = np.where(shadow, np.clip(rgba[:, :, 3] / BAKED_PEAK, 0, 1), 0)
    body = rgba.copy()
    body[shadow] = 0
    frames = data["frames"]
    w, h = next(iter(frames.values()))["frame"]["w"], next(iter(frames.values()))["frame"]["h"]
    mask = np.zeros((h, w), np.float32)
    for f in frames.values():
        r = f["frame"]
        mask = np.maximum(mask, strength[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]])
    Image.fromarray(body).save(os.path.join(SPRITES, f"{name}.png"), optimize=True)
    data["meta"]["shadow"] = f"split: see {name}_shadow.png"
    json.dump(data, open(os.path.join(SPRITES, f"{name}.json"), "w"), indent=1)
    out = np.zeros((h, w, 4), np.uint8)
    out[:, :, 3] = (mask * 255).round().astype(np.uint8)
    frame = f"{key}_shadow"
    Image.fromarray(out).save(os.path.join(SPRITES, f"{name}_shadow.png"), optimize=True)
    meta = {"image": f"{name}_shadow.png", "size": {"w": w, "h": h}, "scale": "1", "anchor": data["meta"]["anchor"],
            "shadow": "mask (full strength; the game shows the shared layer at 18%)"}
    entry = {"frame": {"x": 0, "y": 0, "w": w, "h": h}, "rotated": False, "trimmed": False,
             "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}
    json.dump({"frames": {frame: entry}, "meta": meta}, open(os.path.join(SPRITES, f"{name}_shadow.json"), "w"), indent=1)
    print(f"{name}: shadow split out of {len(frames)} frame(s) -> {name}_shadow.png ({w}x{h})")


def scale(name: str) -> None:
    rgba, data = load_original(name)
    shadow = shadow_pixels(rgba)
    out = rgba.copy()
    k = SHARED_ALPHA / (BAKED_PEAK / 255)
    out[:, :, 3] = np.where(shadow, np.round(rgba[:, :, 3] * k), rgba[:, :, 3]).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(SPRITES, f"{name}.png"), optimize=True)
    data["meta"]["shadow"] = f"baked, lightened to {round(SHARED_ALPHA * 100)}%"
    json.dump(data, open(os.path.join(SPRITES, f"{name}.json"), "w"), indent=1)
    print(f"{name}: baked shadow lightened to {round(SHARED_ALPHA * 100)}%")


if __name__ == "__main__":
    for name, key in BUILDINGS.items():
        split(name, key)
    for name in SCALED:
        scale(name)
