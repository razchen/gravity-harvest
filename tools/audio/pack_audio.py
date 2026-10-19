"""Pack the sounds picked on the Sounds dev page (tools/audio/picks.json) into the game's audio.

Run from the repo root (needs ffmpeg):
    python3 tools/audio/pack_audio.py

For each slot's picks (files under art/audio: ElevenLabs' and the CC0 packs'), writes
apps/game/public/assets/audio/<slot>_<n>.ogg and .mp3 (the game loads the ogg, or the mp3 where ogg won't play), and
audio.json: each slot's files and whether it loops. Every sound is set to its slot's loudness (LEVEL, integrated LUFS)
so the mix is even before the game's volume settings touch it; one-shots lose their leading silence (they play the
instant they're called for) and fade out at the end (none stops abruptly), loops are only turned up or down (cutting
them would break their seam). Voice lines (tools/audio/voice_lines.json) are packed the same way, the vehicle crews'
through a radio filter.
"""
import json
import os
import re
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "audio")
OUT = os.path.join(ROOT, "apps", "game", "public", "assets", "audio")
PICKS = os.path.join(ROOT, "tools", "audio", "picks.json")
PROMPTS = os.path.join(ROOT, "tools", "audio", "sfx_prompts.json")
VOICES = os.path.join(ROOT, "tools", "audio", "voice_lines.json")

# loudness by slot (integrated LUFS, tools/audio/levels.json; the Sounds page plays candidates at it too): weapons and
# blasts up front, the interface and acknowledgements under them, loops and the ambience well below, behind everything
LEVEL: dict = json.load(open(os.path.join(ROOT, "tools", "audio", "levels.json")))
DEFAULT_LEVEL = -20
# voices: the announcer clear and up front, the units' acknowledgements a little under it
VOICE_LEVEL = {"announce_": -16, "ack_": -18}
# a vehicle crew on the radio: a narrow band, squeezed, with a little grit
RADIO_CHAIN = "highpass=f=320,lowpass=f=3300,acompressor=threshold=-22dB:ratio=6:attack=2:release=60:makeup=4,asoftclip=type=tanh"
# heavy guns: a little compression and low end, so they punch rather than only get louder
PUNCH = {"cannon_fire", "autocannon_fire", "artillery_fire", "rocket_launch"}
PUNCH_CHAIN = "bass=g=3:f=90,acompressor=threshold=-18dB:ratio=3:attack=4:release=90:makeup=2"
# fade-outs longer than the usual tenth of the sound (seconds): ones whose own ending is too sudden
FADE = {"power_up": 0.8, "power_down": 0.6}


def loudness(path: str) -> float:
    """Integrated loudness (LUFS) of a file."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r'"input_i"\s*:\s*"(-?[\d.]+|-inf)"', r.stderr)
    return float(m.group(1)) if m and m.group(1) != "-inf" else -70.0


def duration(path: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 1.0


def main() -> None:
    picks = json.load(open(PICKS))
    loops = {k for k, v in json.load(open(PROMPTS)).items() if v.get("loop")}
    voices = json.load(open(VOICES))["slots"] if os.path.exists(VOICES) else {}
    radio = {k for k, v in voices.items() if v.get("radio")}
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    manifest = {}
    for slot, files in sorted(picks.items()):
        if slot.startswith("music_"):
            continue  # streamed, not loaded with the sounds: tools/audio/pack_music.py packs them
        loop = slot in loops
        plain = slot.removeprefix("sable_")   # a side's own voices sit at the same level as the plain ones
        target = LEVEL.get(plain, next((v for k, v in VOICE_LEVEL.items() if plain.startswith(k)), DEFAULT_LEVEL))
        names = []
        for i, rel in enumerate(files, 1):
            src = os.path.join(SRC, rel)
            if not os.path.exists(src):
                print(f"  missing {rel}: skipped")
                continue
            gain = max(-30.0, min(24.0, target - loudness(src)))
            # one-shots: drop the leading silence; everything: to the slot's loudness, without clipping
            # one-shots: their tail faded out (so none stops abruptly), a tenth of their length, 30-400 ms
            fade_s = FADE.get(slot, min(0.4, max(0.03, duration(src) * 0.1)))
            fade = [] if loop else [f"areverse,afade=t=in:d={fade_s:.3f},areverse"]
            punch = [PUNCH_CHAIN] if slot in PUNCH else [RADIO_CHAIN] if slot in radio else []
            if punch:   # loudness is measured after the punch, so the level still comes out right
                tmp = os.path.join(OUT, f".{slot}_{i}.wav")
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", punch[0], tmp], check=True)
                gain = max(-30.0, min(24.0, target - loudness(tmp)))
                src = tmp
            chain = ([] if loop else ["silenceremove=start_periods=1:start_threshold=-50dB"]) + [f"volume={gain:.1f}dB"] + fade + ["alimiter=limit=0.95"]
            name = f"{slot}_{i}"
            for ext, codec in (("ogg", ["-c:a", "libvorbis", "-q:a", "5"]), ("mp3", ["-c:a", "libmp3lame", "-b:a", "128k"])):
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", ",".join(chain), "-ar", "44100", *codec,
                                os.path.join(OUT, f"{name}.{ext}")], check=True)
            names.append(name)
            if punch:
                os.remove(src)
        if names:
            manifest[slot] = {"files": names, **({"loop": True} if loop else {})}
        print(f"{slot}: {len(names)} file(s){' (loop)' if loop else ''} at {target} LUFS")
    json.dump({"note": "Made by tools/audio/pack_audio.py from tools/audio/picks.json", "slots": manifest},
              open(os.path.join(OUT, "audio.json"), "w"), indent=1)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"{len(manifest)} slots, {size // 1024} KB in {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
