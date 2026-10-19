"""Turn an AI-generated video of a building into transparent animation frames for the game.

The video is made from a still of the finished building on a flat green screen (no shadow, which the game draws
itself), with that still as both its first and last frame so it loops. Two steps, run from the repo root:

    uv run --no-project --with pillow --with numpy python tools/sprites/key_video.py prepare b_assembly_build
        -> art/video/b_assembly_build_green.png (feed it to the video generator as first and last frame); a picture
           on the preview's canvas after the atlas starts from that instead (the preview with a unit drawn in)
    uv run --no-project --with pillow --with numpy python tools/sprites/key_video.py key b_assembly_build art/video/x.mp4
        -> art/video/b_assembly_build_video/<f>.png (transparent, full video resolution)
        -> apps/game/public/assets/sprites/b_assembly_build_video.{png,json}: frames `<atlas>_video_<f>` on the
           building's own canvas and anchor (so they sit exactly where its sprite does), meta.video = {frames, fps}

With `--door <x0>,<y0>,<x1>,<y1>` (a box round the door in video pixels) the clip is a door's instead: it closes its
door, holds it shut and opens it again (`--closed`: it starts with the door shut, opens it and closes it again). The
frames from the door fully shut to fully open are found by how much the box differs from the clip's first frame
(`--door <first>-<last> <box>`, frame numbers at FPS, picks them by hand; first after last plays them backwards, to
open a door from a clip that only closes it well), and just the door is cut out of them (what
changes inside the box) as `<atlas>_door_<f>`, closed at 0: the building's door animation, drawn over its rendered
base in place of the one rendered from its model; meta.video = {fps, door: {frames}}.

A vehicle's clip (`vehicle <name> <video> <vehicle id> <its still>`) is made from a still render_vehicle.py made of it
(STILL=<d>,<k>): its frames land on the vehicle's own sprite canvas, `<name>_<f>`, played once; `--freeze-left <x>` keeps
everything left of x (video px) as in the first frame.

The green is keyed out by how much greener than red and blue each pixel is, and what's left of it on the edges is
taken out (despill). Needs ffmpeg.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from trim_pack import BLACK, ROOT, pack_trimmed  # noqa: E402

FRAMES = os.path.join(ROOT, "tools", "blender", "frames", "construction")
VIDEO = os.path.join(ROOT, "art", "video")
GREEN = (0, 177, 64)
SIZE = (1920, 1080)        # the still fed to the generator (16:9)
FILL = 0.78                # share of its height the building takes
FPS = 12                   # frames kept per second of video
KEY = (40, 90)             # greenness (g - max(r, b)) where a pixel starts and finishes being see-through
DOOR_DIFF = 30             # how far (in 0-255 per channel) a pixel must change to be part of the door
DOOR_GROW = 6              # px the door's mask is grown by, then feathered by
DOOR_SHUT = 0.95           # share of its biggest change where the door counts as fully closed
DOOR_OPEN = 0.12           # ... and where it counts as fully open again
PAD = 4                    # px round a vehicle's canvas (render_vehicle.py frame_canvas)
FREEZE_BLEND = 30          # px over which a frozen part (`--freeze-left`) blends into the moving one


def body(rgba: np.ndarray) -> np.ndarray:
    """The building without its baked shadow: opaque pixels that aren't shadow-black."""
    return (rgba[:, :, 3] > 200) & ~((rgba[:, :, 3] < 250) & (rgba[:, :, :3].max(axis=2) <= BLACK))


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def prepare(atlas: str, still: str = "") -> None:
    """`still`: another picture on the preview's canvas to start from (the preview with a unit drawn in, say)."""
    a = np.array(Image.open(still or os.path.join(FRAMES, atlas, "preview.png")).convert("RGBA"))
    shadow = (a[:, :, 3] > 0) & (a[:, :, 3] < 250) & (a[:, :, :3].max(axis=2) <= BLACK)
    a[shadow | (a[:, :, 3] < 6), 3] = 0
    x0, y0, x1, y1 = bbox(a[:, :, 3] > 0)
    im = Image.fromarray(a[y0:y1, x0:x1])
    k = min(FILL * SIZE[1] / im.height, 0.7 * SIZE[0] / im.width)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    at = ((SIZE[0] - im.width) // 2, (SIZE[1] - im.height) // 2)
    still = Image.new("RGBA", SIZE, GREEN + (255,))
    still.alpha_composite(im, at)
    os.makedirs(VIDEO, exist_ok=True)
    still.convert("RGB").save(os.path.join(VIDEO, f"{atlas}_green.png"))
    # where the preview's pixels went, to put the video's frames back on the game canvas
    json.dump({"crop": [int(x0), int(y0)], "scale": k, "at": list(at), "size": list(SIZE)},
              open(os.path.join(VIDEO, f"{atlas}_green.json"), "w"), indent=1)
    print(f"{atlas}_green.png: building {im.width}x{im.height} at {at}")


def key(rgb: np.ndarray) -> np.ndarray:
    """RGBA: the green screen see-through, its spill on the edges taken out."""
    f = rgb.astype(np.float32)
    r, g, b = f[:, :, 0], f[:, :, 1], f[:, :, 2]
    green = g - np.maximum(r, b)
    alpha = 1 - np.clip((green - KEY[0]) / (KEY[1] - KEY[0]), 0, 1)
    out = f.copy()
    out[:, :, 1] = np.minimum(g, np.maximum(r, b))           # despill: nothing greener than its red or blue
    return np.dstack([out, alpha * 255]).round().clip(0, 255).astype(np.uint8)


def door_mask(frames: list, box) -> np.ndarray:
    """Where the door is: what changes from the first frame inside the box, its rows filled across, grown, feathered."""
    first = frames[0].astype(np.int16)
    x0, y0, x1, y1 = box
    hit = np.zeros(first.shape[:2], bool)
    for f in frames[1:]:
        hit |= np.abs(f.astype(np.int16) - first).max(axis=2) > DOOR_DIFF
    inside = np.zeros_like(hit)
    inside[y0:y1, x0:x1] = True
    hit &= inside
    for y in np.nonzero(hit.any(axis=1))[0]:
        xs = np.nonzero(hit[y])[0]
        hit[y, xs.min():xs.max() + 1] = True
    m = Image.fromarray((hit * 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(2 * DOOR_GROW + 1)).filter(ImageFilter.GaussianBlur(DOOR_GROW / 2))
    return np.array(m).astype(np.float32) / 255


def door_frames(raw: list, box, closed: bool) -> tuple:
    """The door opening, from fully shut to fully open, by how unlike the clip's first frame the box is (most unlike:
    shut when the clip starts open, open when it starts closed)."""
    x0, y0, x1, y1 = box
    first = raw[0][y0:y1, x0:x1].astype(np.int16)
    diff = np.array([np.abs(f[y0:y1, x0:x1].astype(np.int16) - first).mean() for f in raw])
    far = np.nonzero(diff >= DOOR_SHUT * diff.max())[0]
    near = diff <= DOOR_OPEN * diff.max()
    if closed:
        b = int(far.min())                                     # first fully open
        a = int(np.nonzero(near[:b])[0].max())                 # last still shut before it
    else:
        a = int(far.max())                                     # last fully shut
        b = a + int(np.nonzero(near[a:])[0][0])                # first open again after it
    print("door change by frame:", " ".join(f"{d:.0f}" for d in diff))
    print(f"door opening: frames {a}-{b}")
    return a, b


def run_key(atlas: str, video: str, door=None, closed=False) -> None:
    box = json.load(open(os.path.join(VIDEO, f"{atlas}_green.json")))
    info = json.load(open(os.path.join(FRAMES, atlas, "frames.json")))
    W, H = info["size"]["w"], info["size"]["h"]
    # the preview's building onto the game canvas: line up the two renders' bodies (same camera, different size)
    stage = np.array(Image.open(os.path.join(FRAMES, atlas, f"stage_{len(info['stages'])}.png")).convert("RGBA"))
    prev = np.array(Image.open(os.path.join(FRAMES, atlas, "preview.png")).convert("RGBA"))
    sx0, sy0, sx1, sy1 = bbox(body(stage))
    px0, py0, px1, py1 = bbox(body(prev))
    s = (sx1 - sx0) / (px1 - px0)                             # preview px -> game px
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={FPS}", os.path.join(tmp, "%04d.png")], check=True)
        files = sorted(os.listdir(tmp))
        # the last frame is the first again: keep one of them
        files = files[:-1]
        vw, vh = Image.open(os.path.join(tmp, files[0])).size
        v = box["size"][0] / vw                                # video px -> still px
        # still px -> preview px: minus where it was put, over its scale, plus where the preview was cropped
        # so video px -> game px: x * F + (O)
        F = v / box["scale"] * s
        ox = (-box["at"][0] / box["scale"] + box["crop"][0] - px0) * s + sx0
        oy = (-box["at"][1] / box["scale"] + box["crop"][1] - py0) * s + sy0
        out = os.path.join(VIDEO, f"{atlas}_video")
        os.makedirs(out, exist_ok=True)

        def to_game(rgba: np.ndarray) -> np.ndarray:
            small = Image.fromarray(rgba).resize((round(vw * F), round(vh * F)), Image.LANCZOS)
            canvas = Image.new("RGBA", (W, H))
            canvas.paste(small, (round(ox), round(oy)), small)
            a = np.array(canvas)
            a[a[:, :, 3] < 6, 3] = 0
            return a

        raw = [np.array(Image.open(os.path.join(tmp, name)).convert("RGB")) for name in files]
        frames = []
        for i, rgb in enumerate(raw):
            rgba = key(rgb)
            Image.fromarray(rgba).save(os.path.join(out, f"{i:03d}.png"))
            if not door:
                frames.append((f"{atlas}_video_{i}", to_game(rgba)))
        meta = {"frames": len(frames), "fps": FPS}
        if door:
            span, box = door
            a, b = span or door_frames(raw, box, closed)
            picked = raw[a:b + 1] if a <= b else raw[b:a + 1][::-1]
            mask = door_mask([raw[0]] + picked, box)
            for j, rgb in enumerate(picked):
                rgba = key(rgb)
                rgba[:, :, 3] = (rgba[:, :, 3] * mask).round().astype(np.uint8)
                frames.append((f"{atlas}_door_{j}", to_game(rgba)))
            meta = {"fps": FPS, "door": {"frames": len(picked)}}
    pack_trimmed(f"{atlas}_video", frames, W, H, {"anchor": info["anchor"], "video": meta}, lighten=False)
    print(f"{len(frames)} frames, video px x {F:.3f} at ({ox:.1f}, {oy:.1f})")


def key_vehicle(name: str, video: str, vid: str, still: str, freeze_left: int = 0) -> None:
    """A clip of a vehicle made from one of its stills (render_vehicle.py STILL=<d>,<k>: k x its sprite canvas, same
    anchor): its frames, keyed, on the vehicle's own sprite canvas as `<name>_<f>` in the atlas `<name>`, with its
    anchor and res, and meta `frames` and `fps` (it plays once). `freeze_left`: everything left of that x (video px)
    stays as in the first frame (what the generator moved that shouldn't, like the harvester's front drums), blended
    into the moving part over FREEZE_BLEND px."""
    box = json.load(open(os.path.join(VIDEO, f"{name}_green.json")))
    info = json.load(open(os.path.join(ROOT, "tools", "blender", "frames", "vehicles", vid, "frames.json")))
    k = int(still.rsplit("_x", 1)[1].split("_")[0].split(".")[0])     # still_<d>_x<k>[...].png
    W, H = info["w"], info["h"]
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={FPS}", os.path.join(tmp, "%04d.png")], check=True)
        files = sorted(os.listdir(tmp))
        vw, vh = Image.open(os.path.join(tmp, files[0])).size
        # video px -> still px (minus where it was put, over its scale, plus its crop) -> sprite px (over k)
        F = box["size"][0] / vw / box["scale"] / k
        # render_vehicle.py pads its canvas by the same PAD px at any scale: the still's corner is that much closer in
        ox = (-box["at"][0] / box["scale"] + box["crop"][0]) / k + PAD * (1 - 1 / k)
        oy = (-box["at"][1] / box["scale"] + box["crop"][1]) / k + PAD * (1 - 1 / k)
        out = os.path.join(VIDEO, name)
        os.makedirs(out, exist_ok=True)
        frames = []
        first = key(np.array(Image.open(os.path.join(tmp, files[0])).convert("RGB"))).astype(np.float32)
        still_share = np.clip((freeze_left + FREEZE_BLEND / 2 - np.arange(vw)) / FREEZE_BLEND, 0, 1)[None, :, None]
        for i, f in enumerate(files):
            rgba = key(np.array(Image.open(os.path.join(tmp, f)).convert("RGB")))
            if freeze_left:
                rgba = (first * still_share + rgba * (1 - still_share)).round().astype(np.uint8)
            Image.fromarray(rgba).save(os.path.join(out, f"{i:03d}.png"))
            small = Image.fromarray(rgba).resize((round(vw * F), round(vh * F)), Image.LANCZOS)
            canvas = Image.new("RGBA", (W, H))
            canvas.paste(small, (round(ox), round(oy)), small)
            a = np.array(canvas)
            a[a[:, :, 3] < 6, 3] = 0
            frames.append((f"{name}_{i}", a))
    pack_trimmed(name, frames, W, H, {"anchor": info["anchor"], "res": info["res"], "frames": len(frames), "fps": FPS}, lighten=False)
    print(f"{len(frames)} frames, video px x {F:.3f} at ({ox:.1f}, {oy:.1f})")


if __name__ == "__main__":
    if sys.argv[1] == "vehicle":
        freeze = int(sys.argv[sys.argv.index("--freeze-left") + 1]) if "--freeze-left" in sys.argv else 0
        key_vehicle(*sys.argv[2:6], freeze_left=freeze)
    elif sys.argv[1] == "prepare":
        prepare(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    else:
        door = None
        if "--door" in sys.argv:
            i = sys.argv.index("--door")
            hand = "-" in sys.argv[i + 1]
            span = tuple(int(n) for n in sys.argv[i + 1].split("-")) if hand else None
            door = (span, tuple(int(n) for n in sys.argv[i + 1 + hand].split(",")))
        run_key(sys.argv[2], sys.argv[3], door, "--closed" in sys.argv)
