# Trailer shots

> **Out of date:** written for the earlier, slower script. It will be rewritten for the current shot list in
> [TRAILER.md](TRAILER.md) when the new stills are made.

Prompts, narration and acceptance checks for each shot in [TRAILER.md](TRAILER.md). The story is in
[STORY.md](STORY.md); [FACTIONS.md](FACTIONS.md) wins wherever anything here disagrees with it.

Reference image paths are short names:

| Name | File |
|---|---|
| ore | `art/scenery/source/ore_dense_1.png` |
| logo | `apps/game/public/assets/ui/logo.webp` |
| ordan emblem / sable emblem | `apps/game/public/assets/ui/factions/ordan.png`, `sable.png` |
| a model, e.g. `harvester` | `apps/game/public/assets/previews/v_harvester_large.webp` (buildings: `b_<id>_build_large.webp`) |

## Every shot

**Style (append to every image prompt):** cinematic film still, photoreal, anamorphic 2.39:1 framing, shallow haze
and atmospheric depth, large quiet compositions with a lot of sky or darkness, subtle film grain, muted grade with
one strong accent colour. Original science-fiction world; not a video-game screenshot, no HUD, no cutscene look.

**Video (append to every video prompt):** one slow, steady camera move, no cuts, no zooms snapping, no new objects
entering frame, physics stays heavy and slow. 8 seconds.

**Negatives (add to every shot):** text, letters, numbers, logos, watermarks, subtitles, UI, HUD; humans, soldiers,
infantry, pilots, walking robots or mechs, faces; blue or purple crystals, glowing gems, gemstones; cartoon style,
low-poly, toy-like, video-game screenshot.

**Colour keys:**

| | Body | Energy / light | Never |
|---|---|---|---|
| Ore | faceted metallic gold rock on brown earth | warm gold-yellow | crystal, blue, purple, orange-red |
| Consortium / shared | off-white and yellow, dark machinery | electric blue | violet, ember orange |
| Ordan | silver-white, pale ceramic, graphite | violet / ultraviolet | blue, orange, red, flames, sparks |
| Sable | dark gunmetal, charcoal | orange ember, amber | blue, violet, **red** |

## Shots

### 1. The ore (0:00–0:07)

- **Image:** Extreme close-up of a cluster of faceted, metallic golden ore rocks half-buried in dark brown earth, in
  near-total darkness. A faint warm gold glow lives inside the facets. Macro lens, 100 mm, eye-level with the ground,
  very shallow depth of field. Palette: black, deep brown, gold.
- **Video:** Very slow push in. The gold glow inside the ore swells and fades twice, like a slow heartbeat. Dust
  motes hang in the air. Still, reverent.
- **Negatives:** crystals, translucent gems, blue or orange glow, sparkles, lens flares.
- **References:** ore.

### 2. The floating city (0:07–0:14)

- **Image:** Wide aerial view at dawn of a vast floating city high above golden plains, seen from far away. Its
  underside is a huge inverted mass of rock and gold ore; above it, terraced industrial towers in off-white armour
  with yellow markings and small electric-blue lights. Beneath it, loose golden stones hang in the air. Thin clouds
  at the city's level. Wide lens, 24 mm, from slightly below. Palette: pale dawn sky, gold plains, off-white, small
  blue accents.
- **Video:** Slow upward tilt from the plains to the city. The loose stones drift slowly upward; clouds move slowly
  past the city. Calm, majestic.
- **Negatives:** violet, orange energy, fantasy castles, waterfalls off the city, birds, aircraft.
- **References:** refinery, power_plant (materials and markings only), ore.

### 3. The harvest (0:14–0:20)

- **Image:** A heavy yellow and off-white mining harvester with a roller-drum front and six large wheels, seen from
  a low three-quarter rear angle, working a field of faceted golden ore on brown earth at sunrise. Far behind it, a
  Consortium refinery (off-white, yellow trim, cylindrical tanks, small blue lights) in haze. Long lens, 85 mm,
  compressed perspective, golden backlight.
- **Video:** Slow lateral track alongside the harvester as it rolls forward; its front drums turn and kick up gold
  dust. Patient, warm.
- **Model:** `harvester` (keep its ore bin out of frame or show it full of gold ore; the render shows grey rock),
  `refinery` in the distance.
- **Negatives:** violet, orange energy, grey ore, blue ore, fast motion.
- **References:** harvester, refinery, ore.

### 4. Too deep (0:20–0:26)

- **Image:** Close, low view across a golden ore field toward a wide, deep borehole; the edge of an off-white
  Consortium drilling rig with yellow markings at the top of frame, its blue lights reflected in the ore. The ore
  around the hole glows warm gold. Dusk. 35 mm, low angle. Palette: gold, brown, off-white, small blue.
- **Video:** Static camera, slow push in. The gold glow in the ore goes dark in a ring spreading out from the hole,
  and one crack runs through the earth toward camera. Ominous, quiet.
- **Negatives:** explosions, fire, lava, people, violet, orange.
- **References:** ore, refinery (materials only).

### 5. The fall of Aster (0:26–0:34)

- **Image:** Made by editing shot 2's still: the same floating city at night under a dark sky, its blue lights
  flickering, the city starting to tilt; chunks of rock and gold ore breaking away and hanging in the air around it.
  Far below, the dark plain. Same lens and angle as shot 2. Palette: deep blue-black night, faint gold, dying blue
  lights.
- **Video:** Very slow pull back. The city tilts further and sinks slowly downward; debris drifts in slow motion
  around it. No impact in frame. Silent, tragic.
- **Negatives:** explosions, fireballs, orange fire, smoke columns, impact, people, violet.
- **References:** shot 2 still.

### 6. Ordan (0:34–0:41)

- **Image:** An Ordan compound at dusk on a plain, seen from a distance: symmetric silver-white and pale ceramic
  structures with graphite parts, circular gravity rings, vertical spines and a large ring-mounted cannon tower. On the
  flat armoured wall nearest camera, the flat geometric bird-of-prey emblem in white and violet, painted like a
  stencil. Two silver-white tanks parked in perfect alignment in front. Wide lens, 28 mm, slightly low.
  Palette: cold blue-grey dusk sky, silver-white, deep violet lights.
- **Video:** Slow crane up. Violet lights switch on, one structure after another, from front to back. Precise,
  cold, controlled. Nothing else moves.
- **Model:** `gravity_lab` (rings), `sentry` (ring cannon), `lance_battery` (spined tower), `ram` (the tanks).
- **Negatives:** blue lights, orange, red, flames, sparks, smoke, banners or flags, cloth, emblem with extra detail.
- **References:** gravity_lab, sentry, lance_battery, ram, ordan emblem.

### 7. Sable (0:41–0:48)

- **Image:** A Sable foundry at night: low, heavy, angular dark gunmetal and charcoal buildings with thick braces,
  exposed pipes and pressure chambers, orange ember heat glowing through vents and a wide open furnace door. Smoke
  rolls across the ground. Out of the smoke a heavy, slab-armoured hovering war machine, dark charcoal with orange
  ember light under it, rises at mid-distance. On a front armour plate of the main building, the flat geometric wolf
  head in white, charcoal and orange. 35 mm, low angle. Palette: black, charcoal, ember orange.
- **Video:** Slow push in. The hovering machine rises slowly out of the smoke; the furnace glow pulses. Heavy,
  hot, threatening.
- **Model:** `gravity_forge`, `incinerator`, `anchor` (its front shield carries the wolf head), the hovering machine
  shaped like `breaker`, kept dark and in smoke so its colour reads as charcoal and orange.
- **Negatives:** red, crimson, blue, violet, white armour, banners or flags, tracks or wheels on the hovering
  machine.
- **References:** gravity_forge, incinerator, anchor, breaker (silhouette only), sable emblem.

### 8. The last field (0:48–0:55)

- **Image:** Very wide view at overcast dusk of a pitted golden ore field, half mined out, small new ore just
  breaking through the brown earth. Two low ridges face each other across it. On the left ridge, small silver-white
  tanks and artillery with violet lights; on the right, dark hovering machines with orange glow. Both armies small
  in frame, silhouetted. 24 mm, from behind and above the field's centre. Palette: grey sky, gold field, violet left,
  orange right.
- **Video:** Slow push forward over the field toward the gap between the ridges. Wind moves dust; the armies stay
  still. Tense.
- **Model:** `ram`, `spire` (left), `hound`, `breaker` silhouettes (right).
- **Negatives:** blue on either army, red, battle, fire, soldiers on the ridges.
- **References:** ram, spire, hound, breaker, ore.

### 8b. The clash (0:55–1:01)

- **Image:** Aerial war photograph from high above at dusk, 35 mm, looking down at an angle over a vast golden ore field in
  battle. On the left, a line of silver-white tanks fires straight violet beams across the field; on the right, dark
  charcoal machines hover above the ground and fire orange ember bolts back. Hits throw fountains of gold ore and dust.
  Smoke lit violet on the left, orange on the right. Both armies small in frame.
- **Video:** Slow aerial drift forward. Beams and bolts keep firing; fountains of ore rise and fall. Epic, relentless.
- **Model:** `ram` (left), `breaker` (right; dark charcoal only).
- **Negatives:** red, blue beams or lights, soldiers, aircraft, miniature or diorama look.
- **References:** ram, breaker.

### 8c. In the thick of it (1:01–1:07)

- **Image:** Low ground-level telephoto war photograph at dusk on the ore field: a heavy, wedge-shaped, dark charcoal
  hovering machine with an orange glow beneath it sweeps low toward camera, blasting up gold ore and dust; a violet beam
  from off-frame left streaks past it; silver-white tanks with violet light far behind in the smoke.
- **Video:** Slow push in as the machine glides toward camera; dust and ore fly; the beam flickers past. Heavy, fast but
  one action.
- **Model:** `breaker` (shape only, described in text: its render's red stripes break the Sable colour rule), `ram`
  behind.
- **Negatives:** red, crimson, blue, soldiers, aircraft, wheels or tracks on the hovering machine.
- **References:** ram.

### 9a. Violet (1:07–1:09)

- **Image:** Dark battlefield at night in smoke; a thick, perfectly straight violet energy beam from left of frame
  strikes dark ground, lighting the smoke violet. 50 mm. Palette: black, violet.
- **Video:** Static camera. The beam fires and holds; smoke swirls around it. Fast but one action.
- **Model:** `lance_battery` edge of frame (optional).
- **Negatives:** orange, blue, red, sparks shower, people.

### 9b. Orange (1:09–1:11)

- **Image:** Night, a wall of orange heat and burning ember blast blooming against the silver-white armour flank of
  a tank in the foreground, armour lit orange. 50 mm. Palette: black, ember orange, silver.
- **Video:** Static camera. The orange blast blooms and rolls across the armour. Violent.
- **Model:** `ram` (flank only).
- **Negatives:** red, blue, violet, people, debris flying at camera.

### 9c. The harvester (1:11–1:13)

- **Image:** Low front three-quarter view of the yellow and off-white harvester driving through heavy dust at
  night, its blue headlights cutting the dust; far behind, out of focus, violet and orange flashes. 35 mm.
- **Video:** Slow backward track as the harvester drives toward camera. Relentless.
- **Model:** `harvester`.
- **Negatives:** the harvester firing weapons, people, fast camera shake.

### 10. One stone (1:13–1:19)

- **Image:** Ground-level view across the brown earth of the field; in the centre, one faceted golden ore stone
  floating a hand's width above the ground, in sharp focus. Far behind on the left, blurred violet lights; far behind
  on the right, blurred orange glow. 85 mm, very shallow depth of field. Palette: brown, gold, violet left, orange
  right.
- **Video:** Static camera. The stone rises slowly upward and turns once. Dust falls off it. Silent, suspended.
- **Negatives:** crystal, sparkles, blue, people, motion in the background.
- **References:** ore.

### 11. The crack and the logo (1:19–1:27)

- **Image:** A dark, cratered, brown-grey rocky planet in black space, filling most of the frame, seen from the
  left. A jagged crack splits its right side open, showing a molten orange and gold core; rock fragments break away
  to the upper right. Match the planet in the logo, without any letters. 50 mm. Palette: black, brown rock, molten
  orange.
- **Video:** Slow push in. The crack widens and glows brighter; fragments drift slowly up and away. Epic,
  inevitable. The last 2 seconds hold nearly still (the logo fades in over them in the edit).
- **Edit:** crossfade the real `logo.webp` in over the last 2–3 seconds, its planet lined up with the clip's.
- **Negatives:** letters or any text, a second planet, moons, blue, violet, stars that streak.
- **References:** logo (planet only; ask for no text).

## Narration sheet

| Time | Voice | Line | Delivery |
|---|---|---|---|
| 0:01 | Narrator | "On Veyra, the ground itself holds the sky." | Low, slow, close to the mic. A breath after "Veyra". |
| 0:08 | Narrator | "For a hundred years, we harvested it together." | Warm, remembering. Slight weight on "together". |
| 0:15 | Narrator | "Carefully. Patiently." | Two separate words, a full beat between them. |
| 0:21 | Narrator | "Until patience ran out." | Flatter, colder. Stop dead after "out". |
| 0:28 | Narrator | "The night Aster fell, the Consortium died with it." | Quiet, grave. Pause after "fell". |
| 0:35 | Narrator | "Ordan swore the harvest must be controlled." | Measured, precise, each word clipped. |
| 0:42 | Sable voice (Irish) | "We say it's ours to take." | Rough, low, unhurried; a threat, not a shout. Rural Irish, older man or woman. |
| 0:49 | Narrator | "There is no longer enough for both." | Plain, final. |
| 1:14 | Narrator | "What holds the world together…" | Almost a whisper, into silence. Leave the line hanging. |
| 1:21 | Narrator | "…will tear it apart." | Over the crack. Firmer, landing on "apart" as the logo appears. |

The narrator is neutral: no regional accent, mid-low voice, never theatrical. The Sable voice is the only other
voice; keep its line short so the accent is the whole performance.

**Music cues:**

| Time | Music |
|---|---|
| 0:00–0:20 | A single low sustained tone, then a slow, sparse theme (piano or low strings). Room for every word. |
| 0:20 | A low drone creeps in under "Until patience ran out." |
| 0:26–0:34 | Music drops almost to nothing for the fall; a deep sub rumble only. |
| 0:34–0:48 | Percussion enters: precise and metallic under Ordan, heavier and distorted under Sable. |
| 0:48–0:55 | Build: rising strings and drums. |
| 0:55–1:13 | Full battle: the swell peaks over 8b and 8c, hardest hits on the 9a/9b/9c cuts. |
| 1:13 | Hard cut to silence. Only wind and one low hum while the stone rises. |
| 1:21–1:27 | One huge hit as the planet cracks, then the theme resolves under the logo and rings out. |

## Acceptance checklist (each clip)

- [ ] One camera move, one main action, no cuts or jump frames inside the clip.
- [ ] No text, letters, numbers or garbled symbols anywhere (except the composited logo in 11).
- [ ] No humans, soldiers, pilots, faces or walking robots; distant silhouettes only, if any.
- [ ] Ore is faceted metallic gold on brown earth: not crystal, not blue, not orange-red.
- [ ] Shared machines: off-white and yellow with blue lights only.
- [ ] Ordan: silver-white and pale ceramic, violet light only; no blue, orange, flames or sparks.
- [ ] Sable: charcoal and gunmetal, orange ember light only; no blue, violet or red.
- [ ] Every building or vehicle has the silhouette and materials of the named model; nothing new and prominent.
- [ ] Emblems (6, 7) are flat, geometric and match the reference; if they warp, mark for an overlay in the edit.
- [ ] Physics is slow and heavy; nothing melts, morphs or changes shape mid-clip.
- [ ] Lighting and time of day match the shot description and the shots either side of it.
- [ ] The first and last second are clean enough to trim and cut on.
- [ ] Audio stripped before review.
