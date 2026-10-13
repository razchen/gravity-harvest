"""Pack a building's construction renders (tools/blender/render_construction.py) into a game atlas.

Run from the repo root (needs Python 3 with Pillow and NumPy):
    python3 tools/sprites/pack_construction.py tools/blender/construction/refinery.json

Writes apps/game/public/assets/sprites/<atlas>.{png,json} with frames `<atlas>_stage_<n>` and `<atlas>_new_<n>`
(see the render script) with their baked shadows taken out, `<atlas>_shadow_<n>`: each stage's shadow as a
full-strength mask for the game's shared shadow layer (as split_shadows.py does for buildings; overlapping shadows
never get darker there), and in `meta.construction.stages` each stage's name plus the pixels the effects use when it
arrives: `welds` (points along the new parts' edges, for welding sparks) and `dust` (where the new parts meet what's
below them). `meta.damage.spots` are points on the finished building's roofs, where a damaged building smokes and
burns. A turret also gets `<atlas>_turn_<d>` (the finished building with its head facing direction d) and
`<atlas>_turnshadow_<d>`, and `meta.turret` = {directions, rest}. A building with animations also gets
`<atlas>_anim_base` (finished, without its moving parts) and `<atlas>_<name>_<f>` for each animation (only its parts,
trimmed and packed below the grid), `meta.anims` = [{name, when, frames, fps}]; its effect points are
`meta.effects` = [{kind, x, y, color}].
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPRITES = os.path.join(ROOT, "apps", "game", "public", "assets", "sprites")
BAKED_PEAK = 145          # alpha of the darkest baked shadow (keep in sync with split_shadows.py)
BLACK = 8
COLUMNS = 5
WELD_POINTS = 60
DUST_POINTS = 14
ROOF_SPOTS = 8
ROOF_DEPTH = 18            # a roof spot needs this much solid building under it (skips antennas and pipe edges)


def shadow_pixels(rgba: np.ndarray) -> np.ndarray:
    a = rgba[:, :, 3]
    return (a > 0) & (a < 250) & (rgba[:, :, :3].max(axis=2) <= BLACK)


def split_shadow(rgba: np.ndarray):
    """The body without its baked shadow, and the shadow as a full-strength mask."""
    shadow = shadow_pixels(rgba)
    body = rgba.copy()
    body[shadow] = 0
    mask = np.zeros_like(rgba)
    mask[:, :, 3] = np.where(shadow, np.clip(rgba[:, :, 3] / BAKED_PEAK, 0, 1) * 255, 0).round().astype(np.uint8)
    return body, mask


def erode(mask: np.ndarray, n: int) -> np.ndarray:
    m = mask.copy()
    for _ in range(n):
        p = np.pad(m, 1)
        m = m & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return m


def effect_points(rgba: np.ndarray, rng: np.random.Generator):
    # the new parts themselves (opaque and not shadow-black), with specks removed
    solid = (rgba[:, :, 3] > 200) & (rgba[:, :, :3].max(axis=2) > 30)
    solid = ~erode(~erode(solid, 1), 1) & solid
    edge = solid & ~erode(solid, 2)
    ys, xs = np.nonzero(edge)
    pick = rng.choice(len(xs), size=min(WELD_POINTS, len(xs)), replace=False) if len(xs) else []
    welds = [[int(xs[i]), int(ys[i])] for i in pick]
    cols = np.nonzero(solid.any(axis=0))[0]
    dust = [[int(x), int(np.nonzero(solid[:, x])[0].max())] for x in cols[:: max(1, len(cols) // DUST_POINTS)]]
    return welds, dust


def roof_spots(rgba: np.ndarray) -> list:
    """Points just inside the top edge of the building, spread across it, where there's real roof underneath."""
    solid = (rgba[:, :, 3] > 200) & (rgba[:, :, :3].max(axis=2) > 30)
    thick = erode(solid, ROOF_DEPTH // 2)
    cols = np.nonzero(thick.any(axis=0))[0]
    if not len(cols):
        return []
    picks = np.linspace(cols[0], cols[-1], ROOF_SPOTS + 2)[1:-1].round().astype(int)
    spots = []
    for x in picks:
        ys = np.nonzero(thick[:, x])[0]
        if len(ys):
            spots.append([int(x), int(ys.min())])
    return spots


def main(config_path: str) -> None:
    C = json.load(open(config_path))
    name = C["atlas"]
    src = os.path.join(ROOT, "tools", "blender", "frames", "construction", name)
    info = json.load(open(os.path.join(src, "frames.json")))
    w, h = info["size"]["w"], info["size"]["h"]
    n = len(info["stages"])
    names = [f"stage_{s}" for s in range(1, n + 1)] + [f"new_{s}" for s in range(1, n + 1)]
    names += [f"shadow_{s}" for s in range(1, n + 1)]
    turret = info.get("turret")
    if turret:
        names += [f"turn_{d}" for d in range(turret["directions"])] + [f"turnshadow_{d}" for d in range(turret["directions"])]
    anims = info.get("anims", [])
    if anims:
        names.append("anim_base")
    rows = -(-len(names) // COLUMNS)
    sheet = np.zeros((rows * h, COLUMNS * w, 4), np.uint8)
    frames, stages, spots_roof = {}, [], []
    rng = np.random.default_rng(3)
    for i, f in enumerate(names):
        kind, s = f.split("_")
        file = {"shadow": "stage", "turnshadow": "turn"}.get(kind, kind)
        rgba = np.array(Image.open(os.path.join(src, f"{file}_{s}.png")).convert("RGBA"))
        body, mask = split_shadow(rgba)
        x, y = (i % COLUMNS) * w, (i // COLUMNS) * h
        sheet[y:y + h, x:x + w] = mask if kind in ("shadow", "turnshadow") else body
        if f == f"stage_{n}":
            spots_roof = roof_spots(body)
        frames[f"{name}_{f}"] = {"frame": {"x": x, "y": y, "w": w, "h": h}, "rotated": False, "trimmed": False,
                                 "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h}}
        if f.startswith("new_"):
            welds, dust = effect_points(rgba, rng)
            stages.append({"name": info["stages"][len(stages)], "welds": welds, "dust": dust})
    # animations: only the moving parts, cropped, in rows below the grid
    if anims:
        crops = []
        for a in anims:
            for f in range(a["frames"]):
                im = np.array(Image.open(os.path.join(src, f"anim_{a['name']}_{f}.png")).convert("RGBA"))
                ys, xs = np.nonzero(im[:, :, 3] > 2)
                x0, x1, y0, y1 = (xs.min(), xs.max() + 1, ys.min(), ys.max() + 1) if len(xs) else (0, 1, 0, 1)
                crops.append((f"{a['name']}_{f}", im[y0:y1, x0:x1], int(x0), int(y0)))
        W = COLUMNS * w
        x, y, row_h, top = 0, 0, 0, sheet.shape[0]
        spots = []
        for _, im, _, _ in crops:
            ch, cw = im.shape[:2]
            if x + cw > W:
                x, y, row_h = 0, y + row_h + 2, 0
            spots.append((x, y))
            x += cw + 2
            row_h = max(row_h, ch)
        sheet = np.concatenate([sheet, np.zeros((y + row_h, W, 4), np.uint8)])
        for (f, im, ox, oy), (px, py) in zip(crops, spots):
            ch, cw = im.shape[:2]
            sheet[top + py:top + py + ch, px:px + cw] = im
            frames[f"{name}_{f}"] = {"frame": {"x": px, "y": top + py, "w": cw, "h": ch}, "rotated": False, "trimmed": True,
                                     "spriteSourceSize": {"x": ox, "y": oy, "w": cw, "h": ch}, "sourceSize": {"w": w, "h": h}}
    Image.fromarray(sheet).save(os.path.join(SPRITES, f"{name}.png"), optimize=True)
    meta = {"image": f"{name}.png", "size": {"w": COLUMNS * w, "h": sheet.shape[0]}, "scale": "1", "anchor": info["anchor"],
            "footprint_tiles": info["footprint_tiles"], "tile_px": info["tile_px"],
            "shadow": "split: <atlas>_shadow_<n> per stage", "construction": {"stages": stages},
            "damage": {"spots": spots_roof}, **({"turret": turret} if turret else {}), **({"anims": anims} if anims else {}),
            **({"effects": info["effects"]} if info.get("effects") else {})}
    json.dump({"frames": frames, "meta": meta}, open(os.path.join(SPRITES, f"{name}.json"), "w"), indent=1)
    extra = f" + {turret['directions']} turret directions" if turret else ""
    print(f"{name}: {n} stages{extra} -> {name}.png ({COLUMNS * w}x{rows * h})")


if __name__ == "__main__":
    main(sys.argv[1])
