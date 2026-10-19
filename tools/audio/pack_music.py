"""Pack the game's music, the tracks picked for the music slots on the Sounds dev page (tools/audio/picks.json:
`music_menu`, `music_battle`, and each side's victory and defeat stings; files under art/audio), into the game.

Run from the repo root (needs ffmpeg):
    python3 tools/audio/pack_music.py

Writes apps/game/public/assets/music/<id>.ogg and .mp3 (the game streams the ogg, or the mp3 where ogg won't play) at
a size a browser can stream, each set to LEVEL (integrated LUFS) so the tracks sit evenly under the sound effects
before the Music volume touches them, and music.json: each track's file, title, where it plays (`menu` or `match`) and
its length, and the side a sting is for (`ordan`, `sable`). Music is apart from the sounds (tools/audio/pack_audio.py, which skips the music slots and clears its own
folder): it's streamed as it plays, not loaded with them. Every track's licence is next to it in art/audio/music.
"""
import json
import os
import re
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "audio")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "music")
PICKS = os.path.join(ROOT, "tools", "audio", "picks.json")
# the music slots the game plays, where, and for which side (None: both)
SLOTS = {"music_menu": ("menu", None), "music_battle": ("match", None),
         "music_victory": ("victory", "ordan"), "music_defeat": ("defeat", "ordan"),
         "music_sable_victory": ("victory", "sable"), "music_sable_defeat": ("defeat", "sable")}

LEVEL = -23                  # LUFS: well under the effects (their slots sit at -14 to -27, tools/audio/pack_audio.py)
STING_LEVEL = -19            # LUFS: a victory or defeat sting, the end of the match, a little louder than the music under play
OGG_QUALITY = "3"            # Vorbis q3: about 112 kbps
MP3_BITRATE = "128k"


def loudness(path: str) -> float:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])


def duration(path: str) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True, check=True).stdout)


def track_id(rel: str) -> str:
    """A track's file name in the game: its source's, without the tempo, copy or made-at suffixes (`ai_fight_120bpm` ->
    `ai_fight`, `dust_road_20261017-104308` -> `dust_road`)."""
    name = os.path.splitext(os.path.basename(rel))[0]
    return re.sub(r"(_\d{8}-\d{6})?(_\d+bpm)?(_\d+)?$", "", name)


def main() -> None:
    picks = json.load(open(PICKS))
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    listed = []
    for slot, (use, side) in SLOTS.items():
        for rel in picks.get(slot, []):
            src = os.path.join(SRC, rel)
            tid = track_id(rel)
            gain = (STING_LEVEL if use in ("victory", "defeat") else LEVEL) - loudness(src)
            for ext, codec in (("ogg", ["-c:a", "libvorbis", "-q:a", OGG_QUALITY]), ("mp3", ["-c:a", "libmp3lame", "-b:a", MP3_BITRATE])):
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", f"volume={gain:.2f}dB", "-ar", "44100", *codec,
                                os.path.join(OUT, f"{tid}.{ext}")], check=True)
            listed.append({"file": tid, "title": tid.replace("_", " ").title(), "use": use, **({"side": side} if side else {}), "seconds": round(duration(src), 1)})
            print(f"{slot}: {tid} {gain:+.1f} dB")
    json.dump({"tracks": listed}, open(os.path.join(OUT, "music.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
