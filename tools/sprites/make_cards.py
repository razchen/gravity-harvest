"""Make the build panel's building cards from the dev pages' preview pictures (pack_previews.py).

Run from the repo root (needs Python 3 with Pillow):
    python3 tools/sprites/make_cards.py

For each building with a stage config (tools/blender/construction/<id>.json), its preview (apps/game/public/assets/previews/<atlas>.webp) is cropped to the building
itself (previews.json), centred in a transparent square with a small margin and written to
apps/game/public/assets/ui/<id>.png.
"""
import json
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PREVIEWS = os.path.join(ROOT, "apps", "game", "public", "assets", "previews")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "ui")
SIZE = 320
MARGIN = 0.06

CONSTRUCTION = os.path.join(ROOT, "tools", "blender", "construction")

# building id -> construction atlas, read from each building's stage config, so a new building needs no line here
CARDS = {
    f[:-5]: json.load(open(os.path.join(CONSTRUCTION, f)))["atlas"]
    for f in sorted(os.listdir(CONSTRUCTION)) if f.endswith(".json")
}


def main() -> None:
    boxes = json.load(open(os.path.join(PREVIEWS, "previews.json")))
    for bid, atlas in CARDS.items():
        b = boxes[atlas]["body"]
        im = Image.open(os.path.join(PREVIEWS, f"{atlas}.webp")).convert("RGBA").crop((b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
        inner = round(SIZE * (1 - 2 * MARGIN))
        k = inner / max(im.width, im.height)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        card = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        card.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
        card.save(os.path.join(OUT, f"{bid}.png"), optimize=True)
        print(bid, f"{atlas} -> ui/{bid}.png")


if __name__ == "__main__":
    main()
