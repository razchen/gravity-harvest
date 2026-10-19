<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Abilities

| ID | Name | Faction | Granted by | Recharge | Notes |
|---|---|---|---|---:|---|
| `phase_shift` | Phase Shift | Ordan | Phase Array | 7 min | Temporarily relocates a target unit. |
| `global_reveal` | Global Reveal | Ordan | Gravity Lab | 8 min | Reveals battlefield information globally. |
| `lock_field` | Lock Field | Sable | Lock Field | 11 min | Temporary invulnerability effect; duration 45 seconds. |
| `recon_flight` | Recon Flight | Sable | Airfield | 3 min | Temporary aerial reconnaissance pass. |
| `drop_team` | Drop Team | Sable | Airfield | 7 min | Air-delivered infantry support. |
| `air_bombardment` | Air Bombardment | Sable | Airfield | 14 min | Air-delivered bombing support. |
| `strategic_missile` | Strategic Missile | Sable | Strategic Silo | 13 min | High-damage strategic strike. |

## Parameters

Data only for now. Damage is already ×4; radius in tiles.

| Name | Targets | Damage | Radius | Duration (s) | Arrives | Delay (s) | Warns | Pauses on low power |
|---|---|---|---:|---:|---|---:|---|---|
| Phase Shift | One of your vehicles or ships, then where to send it (not transports or an Assembler deploying). |  |  | 180 |  |  |  | yes |
| Global Reveal | None: fires itself as soon as it is charged. |  |  |  |  |  |  | yes |
| Lock Field | One vehicle, building, ship or aircraft (not infantry). |  |  | 45 |  |  |  | yes |
| Recon Flight | A point on the map. |  | 9 |  | 1 × Recon plane |  |  |  |
| Drop Team | A point on the map. |  | 4 |  | 5 × Riflemen, dropped from one transport plane |  | ? |  |
| Air Bombardment | A point on the map. | 1,200 high_explosive | 1.5 |  | 5 × Bomber |  | ? |  |
| Strategic Missile | A point on the map. | 800 thermal | 3 |  |  | 11 | yes | yes |

- **Phase Shift:** Sends the unit to the chosen spot for 180 s, then back where it was. Cargo aboard is destroyed (on the way there and back). Infantry sent would die. Each use may set off a phase quake or a phase vortex (Engine Rules: phase_*). The charge is used once the destination is chosen.
- **Global Reveal:** Reveals the whole map and keeps the minimap on without Radar or power, unjammable, for as long as the Gravity Lab stands; losing the lab hides the map again. Once per Gravity Lab. Radius: whole map; duration: while the lab stands. Proposed for our three-state fog: the map counts as explored; whether it also gives live sight is to be decided.
- **Lock Field:** The target takes no damage of any kind (healing is blocked too) but can still move, fire and be captured. Demolition charges cannot be planted on it.
- **Recon Flight:** The plane flies in from the map edge (speed 40, 8000 HP, heavy armor; anti-air can shoot it down), sees nothing on the way, reveals a 9-tile circle once over the target, then leaves. Delay depends on the distance from the edge.
- **Drop Team:** Radius: the drop zone is revealed for 4 tiles around it. The plane: 240 HP, light armor, speed 16. Our roster has no infantry any more: what arrives is to be decided (proposed: the same count of light flying units). Warns opponent: no rule found.
- **Air Bombardment:** Damage per bomb; Count = bombs (one bomber, 240 HP). Bombs are dropped along its path near the target, arm after 1.6 s and splash normally (1.5 tiles). Units at the target may try to get out of the way. Proposed: these are single-player values (there are no multiplayer ones for this ability), used as they are for our 1v1. Warns opponent: no rule found.
- **Strategic Missile:** Multiplayer values (this game is 1v1 multiplayer only); single-player: 4000 damage over 4 tiles. The impact point also takes an 800 strategic-class blast with normal splash. Every player hears the launch; there is no target marker. Delay: the missile comes down from about 64 tiles away (≈ 11 s; less for targets near the top edge), after about 1 s of the silo door opening. Area damage per tile: see Engine Rules: area_damage.

Do not invent extra abilities during implementation.
