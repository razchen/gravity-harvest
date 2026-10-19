"""Turn cut-out scenery images (trees, rocks, bushes, logs, debris, wrecks, grass, ground decals) into the game's `scenery` atlas.

No 3D: plain images (AI-generated is fine), with the shadow cast in code. Run from the repo root (needs Python 3
with Pillow, NumPy and SciPy):
    python3 tools/sprites/make_scenery.py
Reads art/scenery/source/*.png (gitignored originals) and writes apps/game/public/assets/sprites/scenery.{png,json}.

For each cut-out image:
  - clean the edges: nearly transparent pixels (the leftovers of background removal, often bright red / yellow)
    are cleared, stray specks away from the object are removed, and every transparent pixel takes the colour of the
    nearest visible one, so texture filtering never bleeds a halo into the edge
  - trim, then scale to the target height with premultiplied alpha, and grade towards the game's palette
  - anchor where the object stands: where a tree's trunk or a bush's stem meets the ground, or the centre of a low
    object's footprint
  - cast a ground shadow from the silhouette with the same sun as the Blender sprites: the sun is at
    rotation (50, 0, -35) degrees and the camera at (60, 0, 45), so a point h pixels above the ground throws its
    shadow 1.355 h to the right and 0.12 h up on screen. Shadows are separate frames (`<kind>_shadow`, full
    strength): the game composites them all into one cached mask shown at 18% at most, so where shadows overlap
    they don't get darker
  - trees and bushes come as two images: the object (no ground, no shadow) and a base decal (the ground patch under
    it: dirt, roots, grass, pebbles). The decal is cleaned and graded the same way, scaled to a width, and becomes
    `<kind>_base`, anchored where the trunk or stem stands. The game lays it flat on the ground, under the shadows
  - a contact shadow for each tree and bush (`<kind>_contact`, full strength): a small soft 2:1 ellipse sized from the
    trunk or stem width, where it meets the ground. The game composites these into a second cached layer, shown at
    40% at most, so they never stack either. Debris and wrecks get one too (`contact`: its width as a fraction of
    the object's width at the ground), as they rest on the ground with their whole footprint
  - grass casts a shorter, fainter shadow than its height would give (`shadow_scale`): blades are thin and let
    light through, and a full-height disc shadow reads as a dark blob
  - flat ground decals (`decal`: craters, scorch marks, oil stains, dug-out ground, loose ore) are cleaned, trimmed,
    graded gently (they stay dark), squashed to the 2:1 ground where the image was drawn from above (`squash`),
    scaled to a `width` and anchored at their centre (the centroid of the alpha). They lie on the ground, so they
    get no shadow and no contact shadow. Ground patches (loose dirt, gravel, cracked earth) are also blended into the
    ground: toned towards the ground texture's colour, feathered at the edge, faded towards an ellipse, a little
    see-through (`tone`, `sat`, `feather`, `round`, `opacity`); ore patches keep their nuggets solid and let their own
    dirt go see-through (`dirt_alpha`)
The kinds must match SCENERY_KINDS in packages/sim/src/layout.ts (the server decides what goes where).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "scenery", "source")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "sprites")

# kind -> source image and target height in art pixels (2x art scale: one tile is 128 px wide).
# `low`: anchored at the centre of its footprint (rocks, logs) rather than on a ground patch or trunk.
# `trunk`: a tree or bush without a ground patch, anchored where the trunk or stem meets the ground.
# `base`: the base decal image, `base_width` its width in art px, `base_anchor` where the trunk stands on it (fractions
# of the trimmed decal; default: the middle of its alpha). These also get a contact shadow, sized from the trunk, or
# `contact_width` px wide (bushes: about half the bush, as the stems are thin but the whole bush shades the ground).
# `contact` (low objects): add a contact shadow this fraction of the object's width at the ground.
# `shadow_scale`: shorten the cast shadow, as if the object were this fraction of its height (grass).
# `shadow_rows`: only the lowest this fraction of the object casts a shadow (what floats above it doesn't).
# `decal`: a flat ground decal, scaled to `width` (art px) and squashed vertically by `squash` (1 = as drawn).
# `feather` (art px): fade the alpha in over this distance from the edge (for hard cut-outs); `tone`: shift the
# decal's mean colour this fraction of the way to the ground texture's; `sat`: scale its saturation; `opacity`;
# `round`: fade out towards an ellipse inscribed in the patch, from this fraction of its radius (no square corners).
# To add something: drop the cut-out in art/scenery/source, add a line here and to SCENERY_KINDS in layout.ts.
GROUND_PATCH = {"feather": 22, "tone": 0.8, "sat": 0.9, "opacity": 0.85, "round": 0.55}
GRAVEL_PATCH = {"feather": 16, "tone": 0.5, "sat": 0.9, "opacity": 0.95, "round": 0.45}
CRACKED_PATCH = {"feather": 24, "tone": 0.8, "sat": 0.8, "opacity": 0.85, "round": 0.6}

SCENERY = [
    # trees
    # (the first set, tree_src_1..4 + tree_evergreen, had a patch of ground at the base; these stand on the trunk)
    {"kind": "olive", "file": "tree_v2_5.png", "height": 235, "trunk": True,
     "base": "tree_v2_5_base.png", "base_width": 205, "base_anchor": (0.48, 0.42)},
    {"kind": "deadwood", "file": "tree_v2_4.png", "height": 245, "trunk": True,
     "base": "tree_v2_4_base.png", "base_width": 215, "base_anchor": (0.53, 0.42)},
    {"kind": "cypress", "file": "tree_v2_3.png", "height": 290, "trunk": True,
     "base": "tree_v2_3_base.png", "base_width": 175, "base_anchor": (0.47, 0.50)},
    {"kind": "oak", "file": "tree_v2_2.png", "height": 255, "trunk": True,
     "base": "tree_v2_2_base.png", "base_width": 220, "base_anchor": (0.50, 0.42)},
    {"kind": "evergreen", "file": "tree_v2_1.png", "height": 300, "trunk": True,
     "base": "tree_v2_1_base.png", "base_width": 200, "base_anchor": (0.50, 0.43)},
    # rocks (crag, stack and spire cover 2 x 2 tiles)
    {"kind": "boulders", "file": "rock_01.png", "height": 112, "low": True},
    {"kind": "stack", "file": "rock_02.png", "height": 225, "low": True},
    {"kind": "rubble", "file": "rock_03.png", "height": 96, "low": True},
    {"kind": "crag", "file": "rock_04.png", "height": 190, "low": True},
    {"kind": "spire", "file": "rock_05.png", "height": 230, "low": True},
    {"kind": "ledge", "file": "rock_06.png", "height": 78, "low": True},
    # bushes (the first set, bush_08..13, had the ground in the image; these are cut-outs plus a base decal)
    {"kind": "shrub", "file": "bush_v2_1.png", "height": 92, "trunk": True,
     "base": "bush_v2_1_base.png", "base_width": 128, "contact_width": 64},
    {"kind": "sage", "file": "bush_v2_6.png", "height": 84, "trunk": True,
     "base": "bush_v2_6_base.png", "base_width": 120, "contact_width": 54},
    {"kind": "thornbush", "file": "bush_v2_5.png", "height": 100, "trunk": True,
     "base": "bush_v2_5_base.png", "base_width": 116, "contact_width": 48},
    {"kind": "drybrush", "file": "bush_v2_2.png", "height": 84, "trunk": True,
     "base": "bush_v2_2_base.png", "base_width": 124, "contact_width": 52},
    {"kind": "rockbush", "file": "bush_v2_3.png", "height": 64, "trunk": True,
     "base": "bush_v2_3_base.png", "base_width": 124, "contact_width": 56},
    {"kind": "juniper", "file": "bush_v2_4.png", "height": 96, "trunk": True,
     "base": "bush_v2_4_base.png", "base_width": 136, "contact_width": 64},
    # logs and stumps
    {"kind": "log", "file": "log_14.png", "height": 92, "low": True},
    {"kind": "mossy_log", "file": "log_15.png", "height": 84, "low": True},
    {"kind": "stump", "file": "log_16.png", "height": 72, "low": True},
    {"kind": "snag", "file": "log_17.png", "height": 104, "low": True},
    # debris piles (about a tile) and wrecked machines (2 x 2 tiles)
    {"kind": "debris_1", "file": "debris_1.png", "height": 118, "low": True, "contact": 0.8},
    {"kind": "debris_2", "file": "debris_2.png", "height": 135, "low": True, "contact": 0.8},
    {"kind": "debris_3", "file": "debris_3.png", "height": 135, "low": True, "contact": 0.8},
    {"kind": "debris_4", "file": "debris_4.png", "height": 120, "low": True, "contact": 0.8},
    {"kind": "wreck_generator", "file": "wreck_generator.png", "height": 239, "low": True, "contact": 0.85},
    {"kind": "wreck_pump", "file": "wreck_pump.png", "height": 212, "low": True, "contact": 0.75},
    {"kind": "wreck_drill", "file": "wreck_drill.png", "height": 246, "low": True, "contact": 0.75},
    {"kind": "wreck_unit", "file": "wreck_unit.png", "height": 201, "low": True, "contact": 0.85},
    # the gravity vent (2 x 2 tiles, placed by the scenario): a rock cone with golden ore floating up out of it. Only
    # the cone casts a shadow; the floating stones would throw loose blobs far off to the right
    {"kind": "gravity_vent", "file": "gravity_vent.png", "height": 290, "low": True, "contact": 0.85, "shadow_rows": 0.72},
    # grass tufts and patches
    {"kind": "grass_1", "file": "grass_1.png", "height": 57, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_2", "file": "grass_2.png", "height": 66, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_3", "file": "grass_3.png", "height": 74, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_4", "file": "grass_4.png", "height": 53, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_5", "file": "grass_5.png", "height": 60, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_6", "file": "grass_6.png", "height": 63, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_7", "file": "grass_7.png", "height": 65, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_8", "file": "grass_8.png", "height": 47, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_1", "file": "grass_patch_1.png", "height": 106, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_2", "file": "grass_patch_2.png", "height": 85, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_3", "file": "grass_patch_3.png", "height": 107, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_4", "file": "grass_patch_4.png", "height": 107, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_5", "file": "grass_patch_5.png", "height": 111, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_6", "file": "grass_patch_6.png", "height": 118, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_7", "file": "grass_patch_7.png", "height": 108, "low": True, "shadow_scale": 0.5},
    {"kind": "grass_patch_8", "file": "grass_patch_8.png", "height": 105, "low": True, "shadow_scale": 0.5},
    # flat ground decals (most were drawn from above: `squash` lays them on the 2:1 ground)
    {"kind": "crater_1", "file": "crater_1.png", "decal": True, "width": 230, "squash": 0.55},
    {"kind": "crater_2", "file": "crater_2.png", "decal": True, "width": 250, "squash": 0.55},
    {"kind": "crater_3", "file": "crater_3.png", "decal": True, "width": 215, "squash": 0.6},
    {"kind": "crater_4", "file": "crater_4.png", "decal": True, "width": 270, "squash": 0.6},
    {"kind": "scorch_1", "file": "scorch_1.png", "decal": True, "width": 250, "squash": 0.55},
    {"kind": "scorch_2", "file": "scorch_2.png", "decal": True, "width": 280, "squash": 0.55},
    {"kind": "scorch_3", "file": "scorch_3.png", "decal": True, "width": 300},
    {"kind": "scorch_4", "file": "scorch_4.png", "decal": True, "width": 260, "squash": 0.55},
    {"kind": "oil_1", "file": "oil_1.png", "decal": True, "width": 175, "squash": 0.6},
    {"kind": "oil_2", "file": "oil_2.png", "decal": True, "width": 195, "squash": 0.6},
    # ore tiles, by density (the game picks one per tile: dense = full, medium = two thirds, ore_bits = a last third);
    # they are 2:1 diamonds already, drawn a little larger than a tile (128 px) so neighbours join up
    # (`dirt_alpha`: the images' darker dirt between nuggets goes see-through, so tiles don't show as darker diamonds)
    *[{"kind": f"ore_dense_{i}", "file": f"ore_dense_{i}.png", "decal": True, "width": 170, "feather": 10, "dirt_alpha": 0.5} for i in range(1, 5)],
    *[{"kind": f"ore_medium_{i}", "file": f"ore_medium_{i}.png", "decal": True, "width": 170, "feather": 10, "dirt_alpha": 0.3} for i in range(1, 5)],
    {"kind": "ore_scar", "file": "ore_scar.png", "decal": True, "width": 145, "squash": 0.65},
    {"kind": "ore_bits_1", "file": "ore_bits_1.png", "decal": True, "width": 80},
    {"kind": "ore_bits_2", "file": "ore_bits_2.png", "decal": True, "width": 120, "squash": 0.7},
    {"kind": "ore_bits_3", "file": "ore_bits_3.png", "decal": True, "width": 110},
    {"kind": "ore_bits_4", "file": "ore_bits_4.png", "decal": True, "width": 105},
    {"kind": "ore_bits_5", "file": "ore_bits_5.png", "decal": True, "width": 120},
    {"kind": "ore_bits_6", "file": "ore_bits_6.png", "decal": True, "width": 70},
    # ground patches that break up the tiled ground texture (drawn from above; softened and toned to the ground):
    # loose dirt (big), gravel and cracked earth
    {"kind": "dirt_1", "file": "dirt_1.png", "decal": True, "width": 440, "squash": 0.55, **GROUND_PATCH},
    {"kind": "dirt_2", "file": "dirt_2.png", "decal": True, "width": 480, "squash": 0.55, **GROUND_PATCH},
    {"kind": "dirt_3", "file": "dirt_3.png", "decal": True, "width": 400, "squash": 0.55, **GROUND_PATCH},
    {"kind": "dirt_4", "file": "dirt_4.png", "decal": True, "width": 460, "squash": 0.55, **GROUND_PATCH},
    {"kind": "dirt_5", "file": "dirt_5.png", "decal": True, "width": 500, "squash": 0.55, **GROUND_PATCH},
    {"kind": "dirt_6", "file": "dirt_6.png", "decal": True, "width": 360, "squash": 0.55, **GROUND_PATCH},
    {"kind": "gravel_1", "file": "gravel_1.png", "decal": True, "width": 280, "squash": 0.55, **GRAVEL_PATCH},
    {"kind": "gravel_2", "file": "gravel_2.png", "decal": True, "width": 250, "squash": 0.6, **GRAVEL_PATCH},
    {"kind": "gravel_3", "file": "gravel_3.png", "decal": True, "width": 220, "squash": 0.55, **GRAVEL_PATCH},
    {"kind": "gravel_4", "file": "gravel_4.png", "decal": True, "width": 300, "squash": 0.55, **GRAVEL_PATCH},
    {"kind": "cracked_1", "file": "cracked_1.png", "decal": True, "width": 340, "squash": 0.55, **CRACKED_PATCH},
    {"kind": "cracked_2", "file": "cracked_2.png", "decal": True, "width": 300, "squash": 0.55, **CRACKED_PATCH},
    {"kind": "cracked_3", "file": "cracked_3.png", "decal": True, "width": 360, "squash": 0.55, **CRACKED_PATCH},
    {"kind": "cracked_4", "file": "cracked_4.png", "decal": True, "width": 280, "squash": 0.55, **CRACKED_PATCH},
]

SHADOW_DX, SHADOW_DY = 1.355, -0.12   # screen offset per pixel of height (see docstring)
SHADOW_BLUR = 4.0                     # soft edge, in art pixels
PAD = 6
CONTACT_SPREAD = 2.2                  # contact shadow width / trunk width (bushes set `contact_width`)
CONTACT_MIN, CONTACT_MAX = 40, 80     # its width limits, in art pixels


def clean_edges(rgba: np.ndarray, min_speck=200) -> np.ndarray:
    """Clear near-transparent fringe pixels and stray specks smaller than `min_speck` pixels; give every transparent
    pixel the colour of its nearest visible one."""
    a = rgba[:, :, 3]
    a[a < 24] = 0
    a[a >= 245] = 255
    # keep only pieces of real size: stray specks left by background removal go (they would also widen the trim)
    labels, n = ndimage.label(a > 0)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(a), labels, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= max(min_speck, sizes.max() * 0.002)
        a[~keep[labels]] = 0
    visible = a > 0
    rgb = rgba[:, :, :3].astype(np.float32)
    filled = visible.copy()
    out = rgb * filled[:, :, None]
    # grow the colours outwards a ring at a time (enough rings to cover the filter footprint)
    for _ in range(12):
        acc = np.zeros_like(out)
        cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            acc += np.roll(np.roll(out, dy, 0), dx, 1)
            cnt += np.roll(np.roll(filled, dy, 0), dx, 1)
        grow = (~filled) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow, None]
        filled |= grow
    rgba[:, :, :3] = np.clip(out, 0, 255).astype(np.uint8)
    return rgba


def trim(rgba: np.ndarray, pad=PAD):
    ys, xs = np.where(rgba[:, :, 3] > 0)
    y0, y1, x0, x1 = max(ys.min() - pad, 0), ys.max() + pad + 1, max(xs.min() - pad, 0), xs.max() + pad + 1
    return rgba[y0:y1, x0:x1], x0, y0


def resize_premultiplied(rgba: np.ndarray, w: int, h: int) -> np.ndarray:
    f = rgba.astype(np.float32) / 255
    f[:, :, :3] *= f[:, :, 3:4]
    chans = [np.asarray(Image.fromarray(f[:, :, c]).resize((w, h), Image.LANCZOS)) for c in range(4)]
    out = np.clip(np.stack(chans, axis=2), 0, 1)
    a = out[:, :, 3:4]
    out[:, :, :3] = np.where(a > 1e-4, out[:, :, :3] / np.maximum(a, 1e-4), 0)
    return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)


def ground_patch(alpha: np.ndarray):
    """(anchor_x, anchor_y, patch_top): the centre of the ground patch the tree stands on, found from the bottom
    rows (the patch is the wide band at the bottom; it ends where the silhouette narrows into the trunk)."""
    h = alpha.shape[0]
    solid = alpha > 128
    rows = np.where(solid.any(axis=1))[0]
    bottom = rows.max()
    width = lambda y: (int(np.ptp(np.where(solid[y])[0])) if solid[y].any() else 0)
    lowest = range(bottom, int(bottom - 0.3 * h), -1)
    widest = max(width(y) for y in lowest)
    top = int(bottom - 0.25 * h)
    for y in range(bottom - int(0.04 * h), int(bottom - 0.3 * h), -1):
        if width(y) < 0.6 * widest:
            top = y
            break
    band = solid[top:bottom + 1]
    ys, xs = np.where(band)
    return float(xs.mean()), (top + bottom) / 2, top


def trunk_base(alpha: np.ndarray):
    """(anchor_x, anchor_y, top) for a tree standing on its trunk (no ground patch): the middle of the lowest rows
    (where the trunk and roots meet the ground), a little above the lowest root tip. Nothing below casts a shadow."""
    solid = alpha > 128
    ys, xs = np.where(solid)
    bottom, height = ys.max(), ys.max() - ys.min()
    band = solid[int(bottom - 0.06 * height):bottom + 1]
    bx = np.where(band)[1]
    ay = bottom - 0.02 * height
    return float(np.median(bx)), float(ay), int(ay)


def footprint_centre(alpha: np.ndarray):
    """(anchor_x, anchor_y, top) for a low object: the centre of its footprint, which on the 2:1 camera sits about a
    quarter of its width above its lowest point (capped for tall, narrow ones). Rows below the anchor cast nothing."""
    solid = alpha > 128
    ys, xs = np.where(solid)
    bottom = ys.max()
    width = xs.max() - xs.min()
    ay = bottom - min(width / 4, 0.4 * (bottom - ys.min()))
    band = solid[int(ay):bottom + 1]
    bx = np.where(band)[1]
    return float(bx.mean()), float(ay), int(ay)


def cast_shadow(rgba: np.ndarray, ax: float, ay: float, patch_top: int, scale=1.0, from_row=0):
    """Project the tree onto the ground. Returns (canvas, new_anchor).

    A cut-out has no depth, so each horizontal run of the silhouette is treated as a disc (a round crown seen from
    the side): a disc of radius r lying h pixels up casts a disc of radius r on the ground, which the 2:1 camera
    shows as an ellipse r wide and r / 2 tall, shifted by the sun's offset. Thin branches stay thin; a crown gets a
    proper blob. The ground patch itself lies on the ground and casts nothing. `scale` < 1 shortens the shadow (and
    thins it a little), for grass. Rows above `from_row` cast nothing (things floating over the object).
    """
    from PIL import ImageDraw

    h, w = rgba.shape[:2]
    solid = rgba[:, :, 3] > 100
    tall = max(0.0, ay - 0) * scale
    reach_x = int(np.ceil(tall * SHADOW_DX + w * 0.5)) + 8
    reach_y = int(np.ceil(tall * -SHADOW_DY)) + 8
    W, H = w + reach_x, h + reach_y
    ox, oy = 0, reach_y                                          # where the tree sits on the new canvas
    mask = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(mask)
    for y in range(from_row, min(patch_top, h), 2):
        row = solid[y]
        if not row.any():
            continue
        hh = max(0.0, ay - y) * scale
        edges = np.flatnonzero(np.diff(np.concatenate(([0], row.astype(np.int8), [0]))))
        for x0, x1 in zip(edges[::2], edges[1::2]):
            r = (x1 - x0) / 2 * (0.5 + 0.5 * scale)
            cx = (x0 + x1) / 2 + hh * SHADOW_DX + ox
            cy = ay + hh * SHADOW_DY + oy
            draw.ellipse((cx - r, cy - r / 2 - 0.5, cx + r, cy + r / 2 + 0.5), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    shadow = np.zeros((H, W, 4), np.uint8)
    shadow[:, :, 3] = np.asarray(mask)                           # full strength; the game fades the whole layer
    tree = np.zeros((H, W, 4), np.uint8)
    tree[oy:oy + h, ox:ox + w] = rgba
    return tree, shadow, (ax + ox, ay + oy)


def stem_width(alpha: np.ndarray) -> float:
    """Width of the trunk or stems just above the ground (the middle 80% of the solid pixels in the lowest rows)."""
    solid = alpha > 128
    ys, _ = np.where(solid)
    bottom, height = ys.max(), ys.max() - ys.min()
    xs = np.where(solid[int(bottom - 0.08 * height):int(bottom - 0.02 * height) + 1])[1]
    return float(np.percentile(xs, 90) - np.percentile(xs, 10)) if xs.size else 0.0


def contact_shadow(width: float, fixed=None):
    """A soft 2:1 ellipse `width` wide, darkest in the middle: the ambient occlusion where a trunk meets the ground.
    Returns (mask, anchor); the centre sits a touch right of the anchor (the sun is on the left)."""
    w = float(fixed or np.clip(width * CONTACT_SPREAD, CONTACT_MIN, CONTACT_MAX))
    rx, ry = w / 2, w / 4
    W, H = int(np.ceil(w)) + 2 * PAD, int(np.ceil(w / 2)) + 2 * PAD
    cx, cy = W / 2, H / 2
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    r2 = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    a = np.clip(1 - r2, 0, 1) ** 1.6                              # smooth falloff to nothing at the rim
    mask = np.zeros((H, W, 4), np.uint8)
    mask[:, :, 3] = (a * 255).round().astype(np.uint8)
    return mask, (cx - 0.08 * w, cy)


def base_decal(entry):
    """The ground patch under a tree or bush: cleaned, trimmed, scaled to `base_width`, graded. Returns (img, anchor)."""
    rgba = clean_edges(np.array(Image.open(os.path.join(SRC, entry["base"])).convert("RGBA")))
    rgba, _, _ = trim(rgba, pad=0)
    k = entry["base_width"] / rgba.shape[1]
    rgba = resize_premultiplied(rgba, entry["base_width"], max(1, round(rgba.shape[0] * k)))
    rgba = clean_edges(grade(rgba))
    h, w = rgba.shape[:2]
    if "base_anchor" in entry:
        ax, ay = entry["base_anchor"][0] * w, entry["base_anchor"][1] * h
    else:
        ys, xs = np.nonzero(rgba[:, :, 3])
        wt = rgba[ys, xs, 3].astype(np.float32)
        ax, ay = float((xs * wt).sum() / wt.sum()), float((ys * wt).sum() / wt.sum())
    img, x0, y0 = trim(rgba)
    return img, (ax - x0, ay - y0)


def grade(rgba: np.ndarray, amount=1.0) -> np.ndarray:
    """Pull the cut-outs a little towards the game's dusty palette (slightly less saturated, a touch warmer).
    `amount` < 1 grades more gently (ground decals)."""
    rgb = rgba[:, :, :3].astype(np.float32)
    grey = rgb.mean(axis=2, keepdims=True)
    rgb = grey + (rgb - grey) * (1 - 0.12 * amount)
    rgb *= 1 + amount * (np.array([1.02, 1.0, 0.95]) - 1)
    rgba[:, :, :3] = np.clip(rgb * (1 - 0.03 * amount), 0, 255).astype(np.uint8)
    return rgba


GROUND_RGB = None


def ground_rgb() -> np.ndarray:
    """Mean colour of the tiled ground texture (what ground patches are toned towards)."""
    global GROUND_RGB
    if GROUND_RGB is None:
        tex = np.asarray(Image.open(os.path.join(OUT, "..", "terrain", "dry_earth.png")).convert("RGB"), np.float32)
        GROUND_RGB = tex.reshape(-1, 3).mean(axis=0)
    return GROUND_RGB


def soften(rgba: np.ndarray, entry) -> np.ndarray:
    """Blend a ground patch into the ground: tone its colour towards the ground texture (`tone`, `sat`), feather its
    edge (`feather` px: alpha fades in from the edge, after a little blur so the fade follows the outline's shape, not
    each grain) and scale its alpha (`opacity`)."""
    a = rgba[:, :, 3].astype(np.float32) / 255
    if "tone" in entry or "sat" in entry:
        rgb = rgba[:, :, :3].astype(np.float32)
        solid = a > 0.5
        mean = rgb[solid].mean(axis=0) if solid.any() else rgb.reshape(-1, 3).mean(axis=0)
        rgb += (ground_rgb() - mean) * entry.get("tone", 0.0)
        grey = rgb.mean(axis=2, keepdims=True)
        rgb = grey + (rgb - grey) * entry.get("sat", 1.0)
        rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    if entry.get("feather"):
        f = float(entry["feather"])
        body = ndimage.gaussian_filter(a, f / 4) > 0.5
        dist = ndimage.distance_transform_edt(body)
        t = np.clip(dist / f, 0, 1)
        a = a * (t * t * (3 - 2 * t))
    if entry.get("round"):
        h, w = a.shape
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
        r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
        t = np.clip((1 - r) / (1 - entry["round"]), 0, 1)
        a = a * (t * t * (3 - 2 * t))
    if "dirt_alpha" in entry:
        # keep the bright ore / crystals solid and let the image's own (darker) dirt between them go see-through, so
        # the game's ground shows instead of a darker square of someone else's dirt
        rgb = rgba[:, :, :3].astype(np.float32)
        lum = ndimage.gaussian_filter(0.3 * rgb[:, :, 0] + 0.6 * rgb[:, :, 1] + 0.1 * rgb[:, :, 2], 1.0)
        t = np.clip((lum - 100) / 50, 0, 1)
        bright = t * t * (3 - 2 * t)
        a = a * (entry["dirt_alpha"] + (1 - entry["dirt_alpha"]) * bright)
    a = a * entry.get("opacity", 1.0)
    rgba[:, :, 3] = np.clip(a * 255, 0, 255).round().astype(np.uint8)
    return rgba


def build_decal(entry):
    """A flat ground decal: cleaned (small specks kept: scattered dust and grit are part of it), trimmed, graded
    gently, scaled to `width` and squashed by `squash`, anchored at the centroid of its alpha. No shadow frames."""
    rgba = clean_edges(np.array(Image.open(os.path.join(SRC, entry["file"])).convert("RGBA")), min_speck=60)
    rgba, _, _ = trim(rgba, pad=0)
    w = entry["width"]
    h = max(1, round(rgba.shape[0] * w / rgba.shape[1] * entry.get("squash", 1.0)))
    rgba = resize_premultiplied(rgba, w, h)
    # (softened after cleaning: the feathered edge keeps its faintest pixels)
    rgba = soften(clean_edges(grade(rgba, 0.5), min_speck=1), entry)
    ys, xs = np.nonzero(rgba[:, :, 3])
    wt = rgba[ys, xs, 3].astype(np.float32)
    ax, ay = float((xs * wt).sum() / wt.sum()), float((ys * wt).sum() / wt.sum())
    img, x0, y0 = trim(rgba)
    return [(entry["kind"], img, (ax - x0, ay - y0))]


def build(entry):
    path = os.path.join(SRC, entry["file"])
    if not os.path.exists(path):
        print(f"skip {entry['kind']}: {path} not found")
        return None
    if entry.get("decal"):
        return build_decal(entry)
    rgba = clean_edges(np.array(Image.open(path).convert("RGBA")))
    rgba, _, _ = trim(rgba, pad=0)
    k = entry["height"] / rgba.shape[0]
    rgba = resize_premultiplied(rgba, max(1, round(rgba.shape[1] * k)), entry["height"])
    rgba = clean_edges(grade(rgba))
    if entry.get("low"):
        ax, ay, top = footprint_centre(rgba[:, :, 3])
    elif entry.get("trunk"):
        ax, ay, top = trunk_base(rgba[:, :, 3])
    else:
        ax, ay, top = ground_patch(rgba[:, :, 3])
    if entry.get("contact"):                              # sized from the object's width at the ground
        solid = rgba[int(ay):, :, 3] > 128
        xs = np.where(solid)[1]
        ground_w = float(np.percentile(xs, 98) - np.percentile(xs, 2)) if xs.size else rgba.shape[1]
        contact = (f"{entry['kind']}_contact", *contact_shadow(0, entry["contact"] * ground_w))
    from_row = int(rgba.shape[0] * (1 - entry.get("shadow_rows", 1.0)))
    tree, shadow, (ax, ay) = cast_shadow(rgba, ax, ay, top, entry.get("shadow_scale", 1.0), from_row)
    frames = []
    if entry.get("contact"):
        frames.append(contact)
    if entry.get("base"):
        frames.append((f"{entry['kind']}_base", *base_decal(entry)))
        frames.append((f"{entry['kind']}_contact", *contact_shadow(stem_width(rgba[:, :, 3]), entry.get("contact_width"))))
    tree, tx0, ty0 = trim(tree)
    shadow, sx0, sy0 = trim(shadow)
    return [(entry["kind"], tree, (ax - tx0, ay - ty0)), (f"{entry['kind']}_shadow", shadow, (ax - sx0, ay - sy0))] + frames


def main():
    built = [frame for b in (build(e) for e in SCENERY) if b for frame in b]
    if not built:
        sys.exit("nothing built")
    # shelf packing into rows at most MAX_W wide
    MAX_W = 4096
    placed, x, y, row_h, w = [], 0, 0, 0, 0
    for kind, img, anchor in sorted(built, key=lambda b: -b[1].shape[0]):
        ih, iw = img.shape[:2]
        if x and x + iw > MAX_W:  # (MAX_W is a common GPU texture limit)
            x, y, row_h = 0, y + row_h + PAD, 0
        placed.append((kind, img, anchor, x, y))
        w = max(w, x + iw)                                    # no padding after the last frame of a row
        x += iw + PAD
        row_h = max(row_h, ih)
    h = y + row_h
    sheet = np.zeros((h, w, 4), np.uint8)
    frames, anchors = {}, {}
    for kind, img, (ax, ay), x, y in placed:
        ih, iw = img.shape[:2]
        sheet[y:y + ih, x:x + iw] = img
        frames[kind] = {"frame": {"x": x, "y": y, "w": iw, "h": ih}, "rotated": False, "trimmed": False,
                        "spriteSourceSize": {"x": 0, "y": 0, "w": iw, "h": ih}, "sourceSize": {"w": iw, "h": ih}}
        anchors[kind] = {"x": round(float(ax), 1), "y": round(float(ay), 1)}
        if not kind.endswith(("_shadow", "_base", "_contact")):
            print(f"{kind}: {iw}x{ih}, anchor {anchors[kind]}")
    Image.fromarray(sheet).save(os.path.join(OUT, "scenery.png"), optimize=True)
    meta = {"image": "scenery.png", "size": {"w": w, "h": h}, "scale": "1", "anchors": anchors, "tile_px": 128}
    with open(os.path.join(OUT, "scenery.json"), "w") as fh:
        json.dump({"frames": frames, "meta": meta}, fh, indent=1)
    kinds = sum(1 for k, _, _ in built if not k.endswith(("_shadow", "_base", "_contact")))
    print(f"wrote scenery.png {w}x{h} with {kinds} kinds (and their shadows, base decals and contact shadows)")


if __name__ == "__main__":
    main()
