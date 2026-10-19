# Rules & Economy Checklist

What a classic isometric base-building RTS needs for its rules and economy, checked against the code on
2026-10-17 and updated on 2026-10-18, after the fixes to refunds, build slots, the Assembly Yard, production lanes,
two-weapon fire, fog, the loss rule, idle harvesters and the "base under attack" line. Everything already implemented
and working has been removed. What is left is split into:

1. **Wrong**: exists, but behaves incorrectly or against our own rules.
2. **Partial**: exists, but is incomplete.
3. **Missing**: not there at all.
4. **Decided against**: left out on purpose (kept here so nobody re-adds it by accident).

Paths are relative to the repo root. "sim" = `packages/sim/src/sim.ts`.

---

## 1. Wrong

### Economy & production
- [ ] **Losing a prerequisite doesn't affect units already queued.** The queue only stalls when no producer building
      is left, not when a prerequisite (e.g. Radar for a Watcher) is lost (sim `produce`).

### Harvesters
- [ ] **Harvesters can head for ore their side has never seen.** The last fallback in `ore.pickFor` ignores the fog
      filter (`closest(gx, gy, () => true)`).

### Announcer & feedback
- [ ] **The `WARNING = /^Enemy raid/` pattern matches nothing the server sends**, so that code never runs
      (GameScene.ts:78, 511).
- [ ] **"Insufficient funds" is triggered by matching the toast text against a regex** (GameScene.ts:509). Send a
      proper event from the sim instead.

### Smaller issues
- [ ] **The minimap layout is cached once and never reset between matches** (`apps/game/src/ui/Minimap.ts:17, 51`).
      This breaks once maps of different sizes exist.
- [ ] **Stale help text** in `apps/game/index.html:113` says the enemy only guards its base. The AI now attacks in
      waves.
- [ ] **Debug commands are allowed by default whenever `NODE_ENV` isn't `production`**
      (`apps/server/src/config/app-config.ts:68`). Make sure a deployed server can't fall through to that default.

---

## 2. Partial

### Resources & harvesting
- [ ] **Rare resource grade**: the value exists in the rules (75/unit), but no field holds it. Unloading always pays
      `creditsFor(1, 'common')`.
- [ ] **Harvester under attack**: there's no event for it. Add a sim event, a voice line, a minimap ping and
      (optionally) a flee rule.
- [ ] **Free harvester**: only refineries built during the match grant one. Check that this is intended for refineries
      placed at the start.

### Spending & production
- [ ] **Pay as you build**: units and buildings take the full cost up front, and the order is refused without enough
      money. In the genre, cost is taken gradually and production pauses when money runs out, then resumes.
- [ ] **Hold/pause**: there's no pause. You can only cancel the last unit queued. A building under construction can
      only be cancelled through Sell mode.
- [ ] **Rally points**: `near` picks the producer closest to the camera. There's no rally point per factory.
- [ ] **Build card states**: missing "on hold", and there's no progress shown on the card while a building is going
      up.
- [ ] **Credits counter**: the number jumps instead of counting up or down.
- [ ] **Power display**: text only ("used / made"). There's no power bar.

### Selling & repair
- [ ] **Sell refund**: a flat 50% of cost, not scaled by the building's hp. Selling is instant, with no "being sold"
      state.
- [ ] **Unit repair at the Service Bay**: when there's at least $1 but less than one tick's cost, the vehicle sits on
      the pad with no feedback (sim `repair` / `updateService`).

### Orders
- [ ] **Attack-move**: it's in the protocol (`packages/shared/src/match.ts:28`), but no key or click sends it.
- [ ] **Stop**: it's in the protocol, but there's no key or button (S pans the camera).
- [ ] **Guard**: the post/leash logic exists, but only scenario data sets it. Players can't give a guard order.

### Map, minimap & alerts
- [ ] **Minimap**: missing right-click orders, attack pings and jammer areas.
- [ ] **Announcer lines**: missing harvester under attack, building captured, radar online/offline, superweapon
      detected/ready, new construction options.
- [ ] **Text equivalents**: "unit lost", "low power" and "under attack" are voice only. The toast is one line that the
      next message overwrites, with no message log.
- [ ] **Rubble and wrecks**: scorch decals are cosmetic and not saved. Only harvesters leave a wreck (an oil stain).

### Tech
- [ ] **Tech tree content**: the roster leaves out walls, the Flight Pad/Airfield (so no aircraft yet), the Harbor,
      superweapons (Phase Array, Lock Field, Strategic Silo), the Veil Generator, flak/anti-air buildings and the
      Engineer (`ROSTER` in `packages/sim/src/layout.ts`).
- [ ] **Data validation**: only combat data is checked (`validateCombat`). Prerequisites, `producedAt` and roster ids
      aren't checked at load.

### AI
- [ ] **When broke**: it never sells, so with no refinery, no harvester and little money it can stall. It only repairs
      above $300.
- [ ] **Harvester raids**: waves always go for the nearest building and never target harvesters.

### Saves
- [ ] **Saves aren't a full snapshot.** These are lost on load: unit orders, paths, targets, facing, harvester state,
      AI memory and wave state (the AI is rebuilt with a new seed), control groups and camera position. A loaded match
      plays differently from the one that was saved, which also rules out replays from saves.

### End of match
- [ ] **End screen stats**: player only. Missing the opponent's stats, units built, credits spent and graphs.
      `MatchStats` has no `creditsSpent` or `unitsBuilt`.

### Debug
- [ ] **Debug tools**: the UI only exposes reveal (F) and fast mode (T). Add-credits, instant build, spawn and the rest
      are console only.

---

## 3. Missing

### Match setup
- [ ] Game options on the New Game screen: starting credits, starting units, tech level cap, superweapons on/off,
      crates on/off, short game, shroud on/off, game speed.
- [ ] More than two players, teams/alliances, shared allied vision.
- [ ] A player colour choice (currently fixed: player untinted, enemy red).

### Economy
- [ ] Capturable neutral income buildings (a lump sum on capture plus a trickle).
- [ ] Crates (money, units, heal, map reveal, veterancy), with the outcomes defined in data.
- [ ] Bounty for kills (optional, usually off).
- [ ] Cargo dropping as resource tiles when a harvester dies (optional).
- [ ] Hazardous resources that damage units standing in them (optional).

### Production
- [ ] Extra factories of the same type speeding up that category.
- [ ] A primary factory choice when there are several of the same type.
- [ ] Hotkeys for build tabs and cards.
- [ ] A unit-type cap (e.g. only one of a unique unit).
- [ ] Moving a queue to another factory of the same type when its factory is lost.

### Construction
- [ ] Packing the Assembly Yard back up into an Assembler.
- [ ] Walls: drag to place a line, auto-connecting visuals, crushable or not, whether they extend the build radius.
- [ ] Defence range shown while placing and when selected.
- [ ] Gates.
- [ ] Blocking placement under unexplored shroud.

### Power
- [ ] Powering buildings down manually (there's no protocol command for it).
- [ ] Power plant output scaling with its hp (optional).

### Fog & vision
- [ ] A shroud jammer building that hides an area from enemies.
- [ ] Temporary reveal effects (crates, superweapon targets).
- [ ] Elevation affecting vision (optional).

### Repair & healing
- [ ] Self-healing rules (e.g. up to 50% over time, or with veterancy).
- [ ] A mobile repair unit.
- [ ] Buildings working worse at low hp (optional).

### Combat
- [ ] Splash damage with falloff, and a friendly-fire rule.
- [ ] Minimum range.
- [ ] Accuracy/spread, and projectiles that can miss.
- [ ] Veterancy (XP from kills, level bonuses, chevrons).
- [ ] Turret rotation speed, and having to face the target before firing.
- [ ] Indirect fire (artillery arcs) vs direct fire.
- [ ] Target priority beyond "nearest" (prefer threats it can hurt over walls or harmless targets).
- [ ] Crushing (heavy vehicles over walls and small things).
- [ ] Building death explosions that damage neighbours (optional).

### Orders
- [ ] Force-fire (on ground or own units) and force-move.
- [ ] Patrol.
- [ ] Stances: aggressive / guard area / hold position / hold fire.
- [ ] Shift-click waypoint queues.
- [ ] Double-click to select all units of that type on screen.
- [ ] Aircraft: rearming/refuelling at a pad, landing, pad limits.

### Movement & terrain
- [ ] Terrain speed modifiers (roads faster, rough ground slower).
- [ ] Movement classes (tracked, wheeled, hover, air, naval) with passability per class. Today everything uses one
      ground grid.
- [ ] Bridges (destroyable/repairable).

### Capture & special
- [ ] Capturing buildings (who can capture, timing, ownership, power and tech switching over).
- [ ] Getting the other faction's tech from a captured factory (optional).
- [ ] Sabotage/infiltration effects.
- [ ] Stealth and detection.

### Superweapons & support powers
- [ ] Charge timers that pause or slow on low power.
- [ ] A ready indicator on the HUD, and warnings to every player when one is built, ready or launched.
- [ ] A targeting cursor and the effects.
- [ ] A rule for what happens to the timer when the building is lost, and a limit of one of each per player.

### End of match & alerts
- [ ] Surrender.
- [ ] A key that jumps the camera to the last alert.

### Tests & balance
- [ ] Automated tests for the edge cases:
  - [ ] Selling the last refinery with a harvester docked.
  - [ ] Losing the Assembly Yard with a building under construction.
  - [ ] Money reaching 0 with units queued.
  - [ ] A harvester trapped by buildings.
  - [ ] Every resource on the map running out.
- [ ] Balance targets:
  - [ ] Payback time of a harvester and a refinery.
  - [ ] Harvesters per field before they start queueing.
  - [ ] Earliest possible rush vs earliest possible defence.
- [ ] Equal economic value between the factions.

---

## 4. Decided against (by design)

- **No storage cap and no storage buildings.** Unloads become credits immediately (`docs/rules/economy.md`). So there
  is no "storage needed" warning and no credits lost to a cap.
- **No staged "ready to place" buildings.** Buildings are placed first and then built on site. Keep this, but see
  *Wrong → any number of buildings at once* and *Partial → pay as you build*.
