"""Shared by the packers: crop frames to what's in them and pack them onto power-of-two sheets (more than one page,
in Phaser's multi-atlas format, when they don't fit on one MAX x MAX sheet).

Frames are written "trimmed" in the Phaser JSON Hash sense: `spriteSourceSize` says where the crop sits in the full
canvas (`sourceSize`), so anchors and other points in the meta stay in canvas pixels.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPRITES = os.path.join(ROOT, "apps", "game", "public", "assets", "sprites")
MAX = 4096
PAD = 2                     # empty pixels around each crop (no bleeding when mipmapped)
BLACK = 8
BAKED_PEAK = 145            # alpha of the darkest baked shadow (keep in sync with split_shadows.py)
SHARED_ALPHA = 0.18         # the shared shadow layer's opacity (ShadowLayer.ts)
FAINT = 6                   # alpha below this (about 2%) is dropped after lightening
pot = lambda n: 1 << max(0, (n - 1).bit_length())


def lighten_shadow(rgba: np.ndarray) -> np.ndarray:
    """A moving thing's baked shadow, lightened to match the buildings' shared shadow layer (as split_shadows.py)."""
    a = rgba[:, :, 3]
    shadow = (a > 0) & (a < 250) & (rgba[:, :, :3].max(axis=2) <= BLACK)
    out = rgba.copy()
    out[:, :, 3] = np.where(shadow, np.round(a * (SHARED_ALPHA / (BAKED_PEAK / 255))), a).astype(np.uint8)
    return out


def square_card(path: str, out: str, size: int = 320, margin: float = 0.06) -> None:
    """A build card from a big render: its baked shadow lightened, cropped to the object (the shadow can stay in the
    box), centred in a transparent square with a small margin."""
    im = lighten_shadow(np.array(Image.open(path).convert("RGBA")))
    ys, xs = np.nonzero(im[:, :, 3] > 200)
    crop = Image.fromarray(im[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    inner = round(size * (1 - 2 * margin))
    k = inner / max(crop.width, crop.height)
    crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    card.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2), crop)
    card.save(out, optimize=True)


def pack_trimmed(name: str, frames: list, W: int, H: int, meta: dict, lighten: bool = True) -> None:
    """`frames`: (frame name, RGBA array of the full W x H canvas). Writes apps/game/public/assets/sprites/<name>.*
    With `lighten`, baked shadows are lightened first (moving things keep their shadow in the sprite)."""
    if lighten:
        frames = [(f, lighten_shadow(im)) for f, im in frames]
        # the shadow catcher's faint darkening far from the object (invisible once lightened) would defeat trimming
        for _, im in frames:
            im[im[:, :, 3] < FAINT, 3] = 0
        meta = {**meta, "shadow": f"baked, lightened to {round(SHARED_ALPHA * 100)}%"}
    crops = []
    for f, im in frames:
        ys, xs = np.nonzero(im[:, :, 3])
        x0, x1, y0, y1 = (xs.min(), xs.max() + 1, ys.min(), ys.max() + 1) if len(xs) else (0, 1, 0, 1)
        crops.append((f, im[y0:y1, x0:x1], int(x0), int(y0)))
    # rows, tallest first, onto as many MAX x MAX pages as it takes
    order = sorted(range(len(crops)), key=lambda i: -crops[i][1].shape[0])
    places, page, x, y, row_h = {}, 0, 0, 0, 0
    for i in order:
        h, w = crops[i][1].shape[:2]
        if x + w + PAD > MAX:
            x, y, row_h = 0, y + row_h + PAD, 0
        if y + h > MAX:
            page, x, y, row_h = page + 1, 0, 0, 0
        places[i] = (page, x, y)
        x += w + PAD
        row_h = max(row_h, h)
    pages = page + 1
    textures = []
    for pg in range(pages):
        mine = [i for i in places if places[i][0] == pg]
        SW = pot(max(places[i][1] + crops[i][1].shape[1] for i in mine))
        SH = pot(max(places[i][2] + crops[i][1].shape[0] for i in mine))
        sheet = np.zeros((SH, SW, 4), np.uint8)
        out = {}
        for i in mine:
            f, im, ox, oy = crops[i]
            _, px, py = places[i]
            h, w = im.shape[:2]
            sheet[py:py + h, px:px + w] = im
            out[f] = {"frame": {"x": px, "y": py, "w": w, "h": h}, "rotated": False, "trimmed": True,
                      "spriteSourceSize": {"x": ox, "y": oy, "w": w, "h": h}, "sourceSize": {"w": W, "h": H}}
        image = f"{name}.png" if pages == 1 else f"{name}_{pg}.png"
        Image.fromarray(sheet).save(os.path.join(SPRITES, image), optimize=True)
        textures.append({"image": image, "size": {"w": SW, "h": SH}, "frames": out})
    if pages == 1:
        t = textures[0]
        data = {"frames": t["frames"], "meta": {"image": t["image"], "size": t["size"], "scale": "1", **meta}}
    else:
        # Phaser's multi-atlas: several images under one texture key (load.multiatlas)
        data = {"textures": [{"image": t["image"], "format": "RGBA8888", "size": t["size"], "scale": 1,
                              "frames": [{"filename": f, **e} for f, e in t["frames"].items()]} for t in textures],
                "meta": {"scale": "1", "pages": pages, **meta}}
    json.dump(data, open(os.path.join(SPRITES, f"{name}.json"), "w"), indent=1)
    sizes = ", ".join(f"{t['size']['w']}x{t['size']['h']}" for t in textures)
    used = sum(c[1].shape[0] * c[1].shape[1] for c in crops) / (len(crops) * W * H)
    print(f"{name}: {len(crops)} frames of {W}x{H}, trimmed to {used:.0%} -> {sizes}")
