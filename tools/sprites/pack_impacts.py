"""Pack the stylised impact sprites (CC0) into sheets the game loads: what a shell or fireball bursts into where it lands.

Run from the repo root (needs Python 3 with Pillow):
    python3 tools/sprites/pack_impacts.py

Sources, downloaded to art/vfx/stylized/zips and unzipped to art/vfx/stylized/src/<zip name>:
- Kenney "Smoke particle assets" (CC0): https://opengameart.org/sites/default/files/smokeParticleAssets.zip
  painted puffs: the fire, flash, black smoke and white puff sheets (9 variations each).
- Kenney "Particle Pack" (CC0): https://opengameart.org/sites/default/files/kenney_particlePack.zip
  white-on-black shapes: scorch marks, dirt, smoke puffs and more. Their brightness becomes the alpha (white),
  so the game tints them.
  The sci-fi looks use its rings, electric arcs, lens flares, swirls, beam streaks and energy discs.
Writes apps/game/public/assets/fx/impact_<name>.png: SIZE x SIZE frames in a row (variations).
"""
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "vfx", "stylized", "src")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "fx")
SIZE = 128
SMOKE = os.path.join(SRC, "smokeParticleAssets", "PNG")
PARTICLES = os.path.join(SRC, "kenney_particlePack", "PNG")


def fit(im: Image.Image) -> Image.Image:
    """Scaled to fit a SIZE x SIZE frame, centred."""
    im = im.copy()
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    frame = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    frame.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    return frame


def white_on_black(path: str) -> Image.Image:
    """A white-on-black particle as white with its brightness for alpha."""
    lum = Image.open(path).convert("L")
    out = Image.new("RGBA", lum.size, (255, 255, 255, 0))
    out.putalpha(lum)
    return out


def sheet(name: str, frames: list) -> None:
    out = Image.new("RGBA", (SIZE * len(frames), SIZE), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.paste(fit(f), (i * SIZE, 0))
    out.save(os.path.join(OUT, f"impact_{name}.png"), optimize=True)
    print(f"impact_{name}: {len(frames)} frames")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    painted = lambda folder, stem, picks: [Image.open(os.path.join(SMOKE, folder, f"{stem}{i:02d}.png")).convert("RGBA") for i in picks]
    sheet("fire", painted("Explosion", "explosion", range(9)))
    sheet("flash", painted("Flash", "flash", range(9)))
    sheet("smoke", painted("Black smoke", "blackSmoke", range(0, 25, 3)))
    sheet("puff", painted("White puff", "whitePuff", range(0, 25, 3)))
    particle = lambda names: [white_on_black(os.path.join(PARTICLES, f"{n}.png")) for n in names]
    sheet("scorch", particle(["scorch_01", "scorch_02", "scorch_03"]))
    sheet("debris", particle(["dirt_01", "dirt_02", "dirt_03"]))
    sheet("soft", particle(["smoke_04", "smoke_07", "smoke_10"]))
    # the sci-fi looks: rings, electric arcs, lens flares, vortex swirls, beam streaks and energy discs
    sheet("ring", particle(["circle_01", "circle_02", "circle_03", "circle_05"]))
    sheet("arc", particle(["spark_01", "spark_02", "spark_03", "spark_04"]))
    sheet("flare", particle(["star_06", "star_07", "star_08", "star_09", "magic_03", "magic_04"]))
    sheet("twirl", particle(["twirl_01", "twirl_02", "twirl_03"]))
    sheet("trace", particle(["trace_01", "trace_02", "trace_05", "trace_06", "trace_07"]))
    sheet("energy", particle(["light_01", "light_02", "light_03", "fire_01", "fire_02"]))


if __name__ == "__main__":
    main()
