<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Crates

Crate pick-ups. **Not in the game yet.** Chance = shares ÷ total shares; spawning rules are in engine-rules.md (Crates).

| ID | Crate | Shares | Chance | Effect | Value | Notes |
|---|---|---:|---:|---|---|---|
| `money` | Money | 50 | 33.1% | Credits | 3,000 credits (least) | A random amount from 3,000 to 4,350. A side with an Assembly Yard but no Refinery and less than a Refinery's cost gets exactly a Refinery's cost. |
| `unit` | Unit | 20 | 13.3% | A free unit |  | An Assembler if the side has no buildings and no Assembler (and can afford a Refinery and a Power Plant); else a Harvester if it has a Refinery but none; else a random unit its faction can build. Money instead if it has more than 50 units. |
| `squad` | Squad | 20 | 13.3% | Five free infantry | 5 units | Our roster has no infantry: to be decided. Money instead with more than 100 infantry. |
| `air_bombardment` | Air Bombardment | 3 | 2% | One free Air Bombardment | 1 uses | Fully charged, used once. |
| `heal_base` | Heal Base | 1 | 0.7% | Everything you own back to full health |  |  |
| `cloak` | Cloak | 0 | 0% | Units and buildings nearby can cloak |  | Within crate_effect_radius, any owner. Off (0 shares). |
| `explosion` | Explosion | 5 | 3.3% | Blows up under the unit | 2,000 HP (high_explosive) | The unit takes it directly, then 5 blasts of the same land within 2 tiles. |
| `firestorm` | Firestorm | 5 | 3.3% | Fire blast | 2,400 HP (thermal) | The unit takes it directly, plus a blast between it and the crate. |
| `blackout` | Blackout | 1 | 0.7% | Hides the whole map again for that side |  | Money instead while Global Reveal is active. |
| `reveal` | Reveal | 1 | 0.7% | Reveals the whole map for that side |  |  |
| `sub_ping` | Sub Ping | 3 | 2% | One free sub ping | 1 uses | Every submarine revealed for sub_ping_duration. |
| `armor` | Armor | 10 | 6.6% | Units nearby take less damage | 2 damage ÷ | Ground units and buildings within crate_effect_radius, any owner; once per unit. Money if the unit already has it. |
| `speed` | Speed | 10 | 6.6% | Units nearby move faster | 1.7 speed × | Ground units only, within crate_effect_radius. |
| `firepower` | Firepower | 10 | 6.6% | Units nearby do more damage | 2 damage × | Within crate_effect_radius; money for an unarmed unit. |
| `strategic_missile` | Strategic Missile | 1 | 0.7% | One free Strategic Missile | 1 uses | Comes down from 15 tiles away, no silo needed. |
| `phase_quake` | Phase Quake | 3 | 2% | A phase quake hits the whole map |  | See phase_quake_damage. Rare: only if a long-odds check passes (more likely later in the match and when every side is small); otherwise money. |
| `lock_field` | Lock Field | 3 | 2% | Units nearby are protected | 60 seconds | As the Lock Field ability, for everything within crate_effect_radius. |
| `phase_vortex` | Phase Vortex | 5 | 3.3% | A phase vortex appears, after the unit |  | Share not set in the data: the default share of 5 is used. |
