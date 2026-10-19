"""Generate sound candidates with ElevenLabs into art/audio/elevenlabs-<plan>/, for the Sounds dev page to pick from.

Run from the repo root (Python 3, standard library only); the key is ELEVENLABS_API_KEY in .env (see .env.example):
    python3 tools/audio/elevenlabs.py sfx [slot ...] [--yes]
    python3 tools/audio/elevenlabs.py voice [slot ...] [--yes] [--again]
    python3 tools/audio/elevenlabs.py music <name> <seconds> "<prompt>"

`voice` speaks the lines in tools/audio/voice_lines.json (the announcer's, each unit's acknowledgements) with
ElevenLabs' text to speech, one file per line, into art/audio/elevenlabs-<plan>/voice/<slot>/; a line already made
(its text in a .json there) is skipped, unless --again. `sfx` makes the sound effects in tools/audio/sfx_prompts.json (each slot of the Sounds page: a prompt, its length, whether
it loops, how many variations), all of them or the slots named, into art/audio/elevenlabs-<plan>/sfx/<slot>/. Without
--yes it only says what it would make and what that costs. Music needs a paid plan (the API refuses free accounts).

Each file gets a .json beside it with the prompt, model and plan it was made with, so a sound picked on the free plan
can be made again on a paid one (the free plan's output may not go in a released game). Music costs about 900 credits
a minute; the script says what a run will cost and how many credits are left before it spends any.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
API = "https://api.elevenlabs.io/v1"
MUSIC_MODEL = "music_v2_5"
CREDITS_PER_MUSIC_MINUTE = 900
SFX_MODEL = "eleven_text_to_sound_v2"
CREDITS_PER_SFX = 200
PROMPTS = os.path.join(ROOT, "tools", "audio", "sfx_prompts.json")
VOICES = os.path.join(ROOT, "tools", "audio", "voice_lines.json")
TTS_MODEL = "eleven_multilingual_v2"


def key() -> str:
    """ELEVENLABS_API_KEY from the environment, else from the repo's .env."""
    if os.environ.get("ELEVENLABS_API_KEY"):
        return os.environ["ELEVENLABS_API_KEY"]
    try:
        for line in open(os.path.join(ROOT, ".env")):
            name, _, value = line.strip().partition("=")
            if name.strip() == "ELEVENLABS_API_KEY" and value.strip():
                return value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    sys.exit("No ELEVENLABS_API_KEY in the environment or .env (see .env.example)")


def call(path: str, body: dict | None = None, query: str = "") -> bytes:
    req = urllib.request.Request(f"{API}{path}{query}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs said {e.code}: {e.read().decode(errors='replace')[:500]}")


def account() -> dict:
    return json.loads(call("/user/subscription"))


def music(name: str, seconds: float, prompt: str) -> None:
    acc = account()
    left = acc["character_limit"] - acc["character_count"]
    cost = round(seconds / 60 * CREDITS_PER_MUSIC_MINUTE)
    print(f"{acc['tier']} plan: {left} credits left; this track ({seconds:.0f} s) costs about {cost}")
    if cost > left:
        sys.exit("Not enough credits")
    t0 = time.time()
    audio = call("/music", {"prompt": prompt, "music_length_ms": int(seconds * 1000), "model_id": MUSIC_MODEL, "force_instrumental": True},
                 "?output_format=mp3_44100_128")
    out_dir = os.path.join(ROOT, "art", "audio", f"elevenlabs-{acc['tier']}", "music")
    os.makedirs(out_dir, exist_ok=True)
    stem = f"{name}_{time.strftime('%Y%m%d-%H%M%S')}"
    path = os.path.join(out_dir, f"{stem}.mp3")
    with open(path, "wb") as f:
        f.write(audio)
    json.dump({"kind": "music", "prompt": prompt, "seconds": seconds, "model": MUSIC_MODEL, "plan": acc["tier"],
               "made": time.strftime("%Y-%m-%d %H:%M:%S")}, open(os.path.join(out_dir, f"{stem}.json"), "w"), indent=1)
    after = account()
    print(f"saved {os.path.relpath(path, ROOT)} ({len(audio) // 1024} KB) in {time.time() - t0:.0f} s; "
          f"used {after['character_count'] - acc['character_count']} credits, {after['character_limit'] - after['character_count']} left")
    print(f"PATH {os.path.relpath(path, os.path.join(ROOT, 'art', 'audio'))}")


def sfx(slots: list[str], go: bool) -> None:
    sheet = json.load(open(PROMPTS))
    unknown = [s for s in slots if s not in sheet]
    if unknown:
        sys.exit(f"Not in sfx_prompts.json: {', '.join(unknown)}")
    todo = [(s, sheet[s]) for s in (slots or sheet)]
    runs = sum(p.get("variations", 1) for _, p in todo)
    acc = account()
    left = acc["character_limit"] - acc["character_count"]
    for s, p in todo:
        print(f"  {s}: {p.get('variations', 1)} x {p['seconds']} s{' loop' if p.get('loop') else ''}")
    print(f"{acc['tier']} plan: {runs} sounds, up to {runs * CREDITS_PER_SFX} credits at the listed price; {left} left")
    # (the account's count doesn't seem to include sound effects, so this only warns; ElevenLabs refuses when it's out)
    if runs * CREDITS_PER_SFX > left:
        print("warning: that may be more than the credits left; whatever's made before ElevenLabs refuses is kept")
    if not go:
        print("(nothing made: add --yes to make them)")
        return
    made = []
    for s, p in todo:
        out_dir = os.path.join(ROOT, "art", "audio", f"elevenlabs-{acc['tier']}", "sfx", s)
        os.makedirs(out_dir, exist_ok=True)
        for v in range(p.get("variations", 1)):
            body = {"text": p["prompt"], "duration_seconds": p["seconds"], "prompt_influence": p.get("influence", 0.4), "model_id": SFX_MODEL}
            if p.get("loop"):
                body["loop"] = True
            try:
                audio = call("/sound-generation", body, "?output_format=mp3_44100_128")
            except SystemExit as stop:
                print(f"stopped at {s} #{v + 1}: {stop}; made {len(made)} before that")
                return
            stem = f"{s}_{time.strftime('%Y%m%d-%H%M%S')}_{v + 1}"
            with open(os.path.join(out_dir, f"{stem}.mp3"), "wb") as f:
                f.write(audio)
            json.dump({"kind": "sfx", "slot": s, **body, "plan": acc["tier"], "made": time.strftime("%Y-%m-%d %H:%M:%S")},
                      open(os.path.join(out_dir, f"{stem}.json"), "w"), indent=1)
            made.append(stem)
            print(f"  made {s}/{stem}.mp3 ({len(audio) // 1024} KB)")
    after = account()
    print(f"made {len(made)}; used {after['character_count'] - acc['character_count']} credits, {after['character_limit'] - after['character_count']} left")


# how lines are spoken (a slot's own "settings" in voice_lines.json override these): some life in the delivery
VOICE_SETTINGS = {"stability": 0.45, "similarity_boost": 0.8, "style": 0.35}


def made_lines(out_dir: str) -> set[str]:
    """The lines a voice slot already has (their texts, from the .json beside each file)."""
    done = set()
    if os.path.isdir(out_dir):
        for f in os.listdir(out_dir):
            if f.endswith(".json"):
                try:
                    done.add(json.load(open(os.path.join(out_dir, f)))["text"])
                except (KeyError, ValueError):
                    pass
    return done


def voice(slots: list[str], go: bool, again: bool = False) -> None:
    script = json.load(open(VOICES))
    unknown = [s for s in slots if s not in script["slots"]]
    if unknown:
        sys.exit(f"Not in voice_lines.json: {', '.join(unknown)}")
    acc = account()
    base = os.path.join(ROOT, "art", "audio", f"elevenlabs-{acc['tier']}", "voice")
    todo = []
    for s in (slots or script["slots"]):
        v = script["slots"][s]
        done = set() if again else made_lines(os.path.join(base, s))
        lines = [l for l in v["lines"] if l not in done]
        if lines:
            todo.append((s, {**v, "lines": lines}))
    chars = sum(len(line) for _, v in todo for line in v["lines"])
    left = acc["character_limit"] - acc["character_count"]
    print(f"{acc['tier']} plan: {sum(len(v['lines']) for _, v in todo)} lines in {len(todo)} slots, about {chars} credits (one a character); {left} left")
    if not go:
        print("(nothing made: add --yes to make them)")
        return
    made = 0
    for s, v in todo:
        vid = script["voices"][v["voice"]]
        out_dir = os.path.join(base, s)
        os.makedirs(out_dir, exist_ok=True)
        start = len([f for f in os.listdir(out_dir) if f.endswith(".mp3")])
        for n, line in enumerate(v["lines"], start + 1):
            body = {"text": line, "model_id": TTS_MODEL, "voice_settings": {**VOICE_SETTINGS, **v.get("settings", {})}}
            try:
                audio = call(f"/text-to-speech/{vid}", body, "?output_format=mp3_44100_128")
            except SystemExit as stop:
                print(f"stopped at {s} line {n}: {stop}; made {made} before that")
                return
            stem = f"{s}_{time.strftime('%Y%m%d-%H%M%S')}_{n}"
            with open(os.path.join(out_dir, f"{stem}.mp3"), "wb") as f:
                f.write(audio)
            json.dump({"kind": "voice", "slot": s, "text": line, "voice": v["voice"], "voice_id": vid, "model": TTS_MODEL,
                       "plan": acc["tier"], "made": time.strftime("%Y-%m-%d %H:%M:%S")}, open(os.path.join(out_dir, f"{stem}.json"), "w"), indent=1)
            made += 1
            print(f"  {s}: \"{line}\" ({v['voice']})")
    after = account()
    print(f"made {made}; used {after['character_count'] - acc['character_count']} credits, {after['character_limit'] - after['character_count']} left")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "voice":
        voice([a for a in args[1:] if not a.startswith("--")], "--yes" in args, "--again" in args)
    elif args and args[0] == "sfx":
        sfx([a for a in args[1:] if a != "--yes"], "--yes" in args)
    elif len(args) == 4 and args[0] == "music":
        music(args[1], float(args[2]), args[3])
    else:
        sys.exit(__doc__)
