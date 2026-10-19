# Trailer review prompt

A prompt for another AI to review and tighten [STORY.md](STORY.md) and [TRAILER.md](TRAILER.md) before any paid
video generation.

## Attach

- `docs/STORY.md`, `docs/TRAILER.md`, `docs/FACTIONS.md`
- The logo: `apps/game/public/assets/ui/logo.webp`
- The emblems: `apps/game/public/assets/ui/factions/ordan.png` and `sable.png`
- The ore: `art/scenery/source/ore_dense_1.png`
- Model previews from `apps/game/public/assets/previews/` (the `_large` versions):
  - Ordan buildings: `b_gravity_lab_build`, `b_sentry_build`, `b_lance_battery_build`
  - Sable buildings: `b_gravity_forge_build`, `b_incinerator_build`, `b_anchor_build`
  - Shared: `b_refinery_build`, `b_power_plant_build`, `v_harvester`
  - A few vehicles of each side

## Prompt

```
You are reviewing the story and trailer script for "Gravity Harvest", an isometric real-time strategy game.
I've attached:
- STORY.md: the world, its history and why the two factions fight.
- TRAILER.md: an 11-shot, roughly 75-second cinematic trailer.
- FACTIONS.md: the official look of each faction. It wins wherever it disagrees with anything else.
- The game's logo, both faction emblems, the ore art, and preview renders of our buildings and vehicles.

The trailer will be made with AI video. A still image is generated for each shot, a video model animates it into an
8-second clip, then narration (ElevenLabs), music and sound are added in editing. Your job is to make the story and
the script bulletproof before we spend money on generation.

The facts that must hold:
1. **The ore** is faceted, metallic golden rock lying on brown earth (see the ore image). It is not crystal and not
   blue.
2. **The logo** is a planet split open, with a molten orange core and fragments floating off. "GRAVITY" is in cracked
   stone letters and "HARVEST" is in glowing orange. Any shot that shows the logo or the planet's crack must match
   it.
3. **The colours** are a strict rule:
   - Blue energy means shared/Consortium technology.
   - Ordan is silver-white and pale ceramic with violet energy.
   - Sable is dark gunmetal and charcoal with orange ember energy.
   No faction uses another's energy colour. Shared machines are off-white with yellow markings and electric-blue
   energy.
4. **The emblems**: Ordan's is a bird of prey (white and violet); Sable's is a wolf head (white or charcoal and
   orange). Both are flat and geometric, as in the attached images.
5. **Sable's people speak with an Irish accent.** Any Sable voice in the trailer must be Irish. The narrator is
   neutral.
6. **Our models:** any building or vehicle that appears must look like one of our attached models, with its
   silhouette, colours and materials. Name which model each shot uses. Prefer shots where they're seen from a
   distance or partly, so small differences don't show.
7. **No humanoid soldiers.** The game's armies are vehicles and flying machines, never infantry. People may appear
   only far away or as silhouettes, if at all.
8. **An original style.** It must not imitate any existing game's cutscenes. It is a film-trailer style: big, quiet
   shots, almost no dialogue.

What I want back:
A. **Story review:** plot holes, unclear motives, or anything that contradicts the facts above. Then a tightened
   STORY.md. Keep its length and structure.
B. **Script review, shot by shot:**
   - Does each shot tell the story?
   - Does it break any of the facts?
   - Is it realistic for an 8-second AI clip? Each clip should have one clear camera move and one main action, with
     no complex choreography, no readable text other than the logo, and no fast cuts within a clip.
   Then a revised TRAILER.md, with any narration line changes.
C. **For each shot:**
   - an image prompt for the still: subject, setting, lighting, lens and camera angle, colour palette, and the model
     or emblem to match;
   - a video prompt for animating it: the camera move, what moves, the pace, and the mood;
   - a negative list: what must NOT appear, such as blue on Ordan or Sable machines, crystal ore, soldiers, or text;
   - the reference images from my attachments to give the image model.
D. **A narration sheet:**
   - every line with its timing and voice: the neutral narrator, or the Irish Sable voice;
   - direction for delivery (pace, tone, pauses);
   - music cues: where it swells, where there's silence.
E. **A continuity checklist** I can tick for each generated clip before I accept it.

Point out anything you think is weak, but don't change the core story (the Consortium, the Drop and Aster's fall,
Ordan "control" against Sable "take it", not enough ore for both) without saying why.
```
