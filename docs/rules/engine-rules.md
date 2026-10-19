<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Engine rules

How the rules behave: formulas, rates and effects. **Data only for now: the simulation does not read these yet.**
Scaled like the rest of the workbook (credits ×1.5, HP and damage ×4, distances in tiles, times in seconds).
"In our game" says whether our game already works this way.

## Production

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `build_seconds_per_credit` | Build time per credit of cost | 0.032 | seconds per credit | In game | At full power with one producer. A 1,500-credit item takes 48 s. The Build Time columns on the Buildings and Units sheets follow it. |
| `production_steps` | Steps per item in production | 54 | steps | Not in game yet | Each step costs 1/54 of the price. Without the money for a step, production waits (no debt). |
| `production_rate_fixed_at_start` | Build speed is fixed when an item starts | yes | boolean | Not in game yet | A change in power or in the number of producers only applies after the item is put on hold and resumed. |
| `producer_count_speedup` | More producers of the same kind build faster | yes | boolean | Ours differs (not changed) | Build time ÷ the number of producers of that kind you own (powered or not). No cap; an alternative caps the divisor at 2. Ours: one producer per lane. |
| `low_power_build_penalty` | Build time on low power | time ÷ p1 ÷ p2 | formula | Ours differs (not changed) | p = power output ÷ drain. p1 = 0.75 at 75–99% power, p at 50–75%, 0.5 below 50%; p2 = p, at least 1/16. So 90% power ≈ ×1.48, 60% ≈ ×2.78, 25% ≈ ×8. A simpler alternative: ×1.5 below full, ×2.5 below half, ×4 at zero. Ours: a flat ×2 (ENGINE.lowPowerSlowdown). |
| `cancel_refund` | Refund when cancelling production | 1 | fraction of money paid so far | Ours differs (not changed) | Ours: refund_percent (Economy sheet) applies to cancelling too. |

## Power

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `power_level` | Power level | output ÷ drain | formula | In game | 1 (full) when output ≥ drain. Low power = below 1. |
| `power_output_scales_with_health` | A power plant's output scales with its health | yes | boolean | Not in game yet | Output = Power Delta × current HP ÷ max HP. Drain is always full. |
| `low_power_damage` | Low power: damage to power-drawing buildings | 4 | HP (armor_piercing) | Not in game yet | Every low_power_damage_interval, each of your buildings that draws power and is above half health takes this. Never takes one below half. |
| `low_power_damage_interval` | Low power: damage interval | 60 | seconds | Not in game yet |  |
| `low_power_radar_off` | Low power turns the minimap off | yes | boolean | In game | On again when power returns. An active Global Reveal keeps it on. |
| `low_power_stops_powered_buildings` | Low power stops buildings that Require Power | yes | boolean | In game | They can't fire or turn their turrets. The Anchor also charges only at full power. |
| `low_power_pauses_abilities` | Low power pauses some abilities | yes | boolean | Not in game yet | Abilities with Pauses on Low Power stop charging (no reset) and carry on when power returns. One that becomes available during low power starts paused. |
| `aircraft_reload_seconds` | Aircraft reload time per ammo, on their pad or airfield | 2.4 | seconds | Not in game yet | On low power: ÷ p (p at least 0.5), so up to twice as slow. |

## Repair

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `building_repair_step` | Building repair: HP per step | 28 | HP | Ours differs (not changed) | Each step costs cost ÷ (max HP ÷ 28) × structure_full_repair_cost, so a full repair costs about structure_full_repair_cost × cost. Ours: full repair in ENGINE.repairSecondsForFull (30 s) whatever the size. |
| `building_repair_interval` | Building repair: time per step | 0.933 | seconds | Ours differs (not changed) | About 30 HP a second for every building. |
| `repair_stops_without_money` | Repair switches off when you cannot pay a step | yes | boolean | Not in game yet | It does not wait for money. Turning repair on or off is free. |
| `repair_ignores_power` | Repair speed ignores low power | yes | boolean | Ours differs (not changed) | Building repair and the Service Bay. Ours: the Service Bay repairs half as fast on low power. |
| `unit_repair_step` | Service Bay: HP per step | 40 | HP | Ours differs (not changed) | Each step costs cost ÷ (max HP ÷ 40) × unit_full_repair_cost. Ours: ENGINE.repairSharePerSec (4% of health a second). |
| `unit_repair_interval` | Service Bay: time per step | 0.933 | seconds | Ours differs (not changed) | About 43 HP a second whatever the unit. |
| `service_bay_rearms_seeder` | Service Bay re-arms a Seeder | yes | boolean | Not in game yet | All mines, free and at once, before any repair; it takes a Seeder in even at full health. |
| `self_heal_amount` | Self-heal: HP per step | 4 | HP | Not in game yet | Units with Self-Heals (Units sheet). Free. |
| `self_heal_interval` | Self-heal: time per step | 0.933 | seconds | Not in game yet |  |
| `self_heal_cap` | Self-heal stops at | 0.5 | fraction of max HP | Not in game yet | It only heals while at or below half health. |
| `sell_refund_ignores_health` | Selling refunds the same whatever its health | yes | boolean | Not in game yet | refund_percent (Economy sheet) of its cost. |
| `sell_refund_excludes_free_unit` | Selling a building that came with a free unit refunds without that unit | yes | boolean | Not in game yet | A Refinery sells for (3,000 − 2,100) × 50% = 450. If the free unit could not be placed, its cost is refunded at once. |
| `survivor_fraction` | Building crew share | 0.4 | fraction of cost | Not in game yet | Survivors = cost × 0.4 ÷ 150, 1 to 5 (Buildings sheet). All walk out when sold. When destroyed, each tile has a 1 in 3 chance (1 in 2 if it was attacking, 1 in 9 if it had been captured); none when destroyed by a demolition charge. Our roster has no humanoids: survivors would need a non-human stand-in. |

## Economy

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `storage_cap` | Resource storage cap | none | credits | Ours differs (kept) | Design Decisions: no storage cap; unloads become credits at once. The alternative stores ore money in refineries and silos, loses what does not fit, and loses the excess when a store is destroyed. |
| `harvest_seconds_per_unit` | Harvesting: time per resource unit | 0.6 | seconds | Ours differs (not changed) | Ours: ENGINE.harvestMsPerUnit (0.25 s). |
| `rare_units_per_pick` | Rare deposits: units per harvesting step | 4 | resource units | Not in game yet | One step on a rare tile loads 4 units (if there is room) in the time of one. |
| `unload_seconds` | Unloading a full harvester | 1.467 | seconds | Ours differs (not changed) | Credits are paid all at once at the end. The harvester first turns to face the dock. Ours: ENGINE.unloadMsPerUnit and dockMinMs. |
| `ore_search_near` | Harvester search radius after its tile runs out | 6 | tiles | Not in game yet | It takes the first ore tile found, ring by ring. |
| `ore_search_far` | Harvester search radius when looking for a field | 32 | tiles | Not in game yet |  |
| `resource_growth_model` | How fields grow | Economy sheet | text | Ours differs (kept) | Ours: the resource_* rows on the Economy sheet. The alternative: one pass over the map every 2 minutes, at most 64 tiles grow and 64 spread per pass, only tiles above half full spread, and rare deposits never grow. |
| `free_harvester_with_refinery` | A finished Refinery comes with a Harvester | yes | boolean | In game | Paid for inside the Refinery price. |
| `free_aircraft_with_flight_pad` | A Flight Pad comes with an aircraft | yes | boolean | In game |  |

## Combat

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `splash_radius` | Blast reach | 1.5 | tiles | Ours differs (not changed) | Everything within 1.5 tiles of the impact (and in its tile or the 8 around it) takes damage, reduced by distance (splash_falloff). The shooter is never hurt. Ours: direct hits only. |
| `splash_falloff` | Damage at a distance from the blast | damage ÷ (distance ÷ step) | formula | Not in game yet | step = Falloff Step on the Damage Matrix; at most ÷16. Within 4 steps a hit does at least min_damage. A building takes full damage when the blast lands on one of its tiles. |
| `min_damage` | Least damage of a hit close to the blast | 4 | HP | Not in game yet |  |
| `max_damage` | Most damage of one hit | 4,000 | HP | Not in game yet |  |
| `heal_reach` | Healing reach | 0.03 | tiles | Not in game yet | Negative damage heals only a target within this distance, and only unarmored ones. |
| `burst_gap` | Gap between the shots of a burst | 0.2 | seconds | Not in game yet | Burst 2 (or the same weapon in both slots): the second shot 0.2 s after the first, then the full fire interval. Bursts above 2 act as 2. |
| `weapon_choice` | Which weapon a unit uses | better against the armor | text | Not in game yet | Score = damage-matrix multiplier, doubled if in range, zero if it cannot fire at the target. The secondary is used only if it scores strictly higher. |
| `scatter_moving_shooter` | Shots fired on the move scatter | yes | boolean | Not in game yet | Also scattering: weapons marked Inaccurate, and armor-piercing or fuelled-missile shots at infantry or the ground. |
| `scatter_arcing_max` | Most scatter of an arcing shot | 2 | tiles | Not in game yet | Scatter = up to (distance ÷ 16 − 0.25 tiles), at most this. Lands anywhere around the target. |
| `scatter_direct_max` | Most scatter of a direct shot | 1 | tiles | Not in game yet | Overshoots along the line of fire. |
| `projectile_flight_time` | Projectile flight time | distance ÷ speed + 0.27 s | formula | Not in game yet | Projectile Speed on the Weapons sheet. Instant Hit weapons land at once. Homing projectiles start in the direction the shooter faces and re-aim every 0.13 s. |
| `fire_facing_tolerance` | Facing needed to fire | 11.25 | degrees | Not in game yet | Within this of the target; 45° for homing weapons. Units cannot fire while turning unless the weapon homes. |
| `faster_vs_aircraft_multiplier` | Projectile speed against aircraft (Faster vs Aircraft) | 1.5 | multiplier | Not in game yet |  |
| `anti_air_burst_reach` | Anti-air shots burst this close to an aircraft | 0.5 | tiles | Not in game yet |  |
| `cloaked_untargetable` | Cloaked units cannot be targeted | yes | boolean | Not in game yet |  |
| `landed_aircraft_are_ground` | Landed aircraft count as ground targets | yes | boolean | Not in game yet | The Sky Lance ignores them. |
| `death_explosion_spread` | Death explosion radius per max HP | 0.3 | tiles per 1,024 HP | Not in game yet | Units with Explodes on Death. Rounded up to whole tiles. Damage = its max HP, in its primary weapon's damage class (high explosive if unarmed). |
| `area_damage` | Area damage over several tiles | per-tile blasts | text | Proposed | Death explosions and the Strategic Missile: every tile within the radius gets its own blast (so things can be hit by several). The centre tile gets full damage and the others damage × their distance ÷ the radius, so tiles further out get more (up to ×1.5 at the corners). Proposed: damage falling off from the centre instead. |
| `harvester_explodes_with_ore` | A loaded harvester explodes when killed | no | boolean | Not in game yet | If turned on: 1.5 tiles, damage = its load in credits + its max HP. |
| `prone_damage` | Damage to infantry lying down | 0.5 | fraction | Not in game yet | Infantry lie down when shot at. Our roster has no humanoids. |
| `crush_reach` | Crushing reach | 0.5 | tiles | Not in game yet | A unit that Crushes kills crushable enemies within this of the centre of a tile it drives onto; infantry in its way first try to scatter. Players crush only by driving over; a computer side drives over rather than shoots when the target is within 1.5 tiles (proposed for ours: same rule for both sides). |
| `wall_damage` | Wearing walls down | per hit on the wall tile | text | Not in game yet | Only classes with Damages Walls. A hit ≥ Wall Damage per Level takes one level off; a smaller one has (damage ÷ per level) chance to. Removed after Wall Damage Levels. Armor does not apply. |

## Infiltration

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `engineer_capture_health` | Engineer captures an enemy building at or below | 0.25 | fraction of max HP | Ours differs (not changed) | The Engineer is used up. Only buildings with Capturable. Ours: the Engineer repairs its own buildings from outside, for free. |
| `engineer_damage` | Engineer entering an enemy building above capture health | 0.333 | fraction of max HP | Not in game yet | Damage; it never destroys the building. The Engineer is used up. |
| `engineer_repair_friendly` | Engineer entering one of its own buildings | repairs to full | text | Ours differs (not changed) | At once; the Engineer is used up. |
| `infiltrator_radar` | Infiltrator in an enemy Radar | see that side's minimap | text | Not in game yet | Until that Radar is destroyed or captured. Infiltrators are used up. |
| `infiltrator_producer` | Infiltrator in an enemy producer | see what it is producing | text | Not in game yet | Barracks, Motor Works, Harbor, Sub Dock, Flight Pad, Airfield. |
| `infiltrator_refinery` | Infiltrator in an enemy Refinery | see that side's credits | text | Not in game yet | Any one Refinery is enough. |
| `infiltrator_power` | Infiltrator in an enemy power plant | see their power output and drain | text | Not in game yet |  |
| `infiltrator_sub_dock` | Infiltrator in an enemy Sub Dock | repeating sub ping | text | Not in game yet | Every 10 minutes while that Sub Dock stands, every submarine on the map is revealed for sub_ping_duration. |
| `infiltrator_any` | Infiltrator in any enemy building | see its health and contents | text | Not in game yet | Decoys show as decoys. Only Hounds attack Infiltrators on their own. |
| `infiltrator_airfield` | Infiltrator in an enemy Airfield | one free Air Bombardment | text | Proposed | Only in an alternative rule set. |
| `raider_steal_fraction` | Raider in an enemy Refinery steals | 0.5 | fraction of that side's credits | Not in game yet | Into your credits. The Raider is used up. |
| `demolition_delay` | Operator demolition charge fuse | 1.8 | seconds | Not in game yet | Always destroys the building, with no survivors. Not on a building under Lock Field or being sold. |
| `hound_rules` | Hound | kills its target outright | text | Not in game yet | Targets infantry only (and is the only unit that attacks Infiltrators by itself); double speed while chasing; units cannot fire back at it. |
| `sub_ping_duration` | Sub ping: submarines revealed for | 15 | seconds | Not in game yet | They cannot cloak again until it ends. |

## Mines

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `mine_type_ordan` | Mines an Ordan Seeder lays | anti-vehicle | text | Not in game yet |  |
| `mine_type_sable` | Mines a Sable Seeder lays | anti-personnel | text | Not in game yet |  |
| `mine_anti_vehicle_damage` | Anti-vehicle mine damage | 4,800 | HP (high_explosive) | Not in game yet | To the enemy vehicle that drives onto it only (no splash). Infantry neither trigger nor are blocked by it. |
| `mine_anti_personnel_damage` | Anti-personnel mine damage | 4,000 | HP (high_explosive) | Not in game yet | To all infantry within mine_anti_personnel_radius, triggered by any infantry reaching it (no owner check). A vehicle driving over one takes 40. |
| `mine_anti_personnel_radius` | Anti-personnel mine reach | 0.75 | tiles | Not in game yet |  |
| `mines_block_own_units` | Your own mines block your units | yes | boolean | Not in game yet | One mine per Seeder ammo; only on tiles without a building. A Seeder ignores its side's mines. |

## Vision

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `fog_model` | Fog of war | three-state | text | Ours differs (kept) | Ours: unexplored / explored (dimmed) / in sight. The alternative: two states (explored ground stays fully visible), with explored ground going dark again every 4 minutes where nothing sees it. |
| `sight_cap` | Greatest sight | 10 | tiles | In game | No Sight on the sheets is above it. |
| `veil_radius` | Veil Generator: hidden radius | 10 | tiles | Not in game yet | Hidden from enemies (their own units still see around themselves). Only at full power; drops at once on low power or when destroyed. |
| `veil_refresh` | Veil Generator: re-hides every | 6 | seconds | Not in game yet | Plus up to 1 s at random. |
| `shroud_pattern` | Shroud: hidden area | 31 tiles | tiles | Not in game yet | Rows of 3, 5, 5, 5, 5, 5, 3 tiles around it (about 3 tiles out), refreshed every second while it is not moving. Needs no power. |
| `watcher_jam_radius` | Watcher: jamming radius | 15 | tiles | Not in game yet | Checked every second: an enemy Radar or Sky Lance within this is jammed. A jammed Sky Lance cannot fire; a side whose Radars are all jammed sees static on the minimap. |
| `recloak_delay` | Time before a unit can cloak again | 1.2 | seconds | Not in game yet | A cloaked unit shows itself when it takes damage, wants to fire, crushes something, is pinged, or ends a move next to an enemy that Detects Cloaked. At or below 25% health cloaking often fails. |

## Abilities

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `ability_charge_lost_with_building` | Losing the building throws away the charge | yes | boolean | Not in game yet | Charging starts when the building is finished; using it restarts the full charge; a rebuilt building starts from zero. |
| `phase_quake_chance` | Phase Shift: chance of a phase quake | 0.2 | fraction per use | Not in game yet |  |
| `phase_quake_damage` | Phase quake damage | 0.33 | fraction of max HP | Not in game yet | To every unit and building on the map, both sides; armor does not apply, Lock Field still protects. |
| `phase_vortex_chance` | Phase Shift: chance of a phase vortex | 0.2 | fraction per use | Not in game yet | A vortex appears somewhere on the map, wanders, and now and then zaps something within phase_vortex_range. |
| `phase_vortex_damage` | Phase vortex damage per zap | 800 | HP | Not in game yet |  |
| `phase_vortex_range` | Phase vortex reach | 10 | tiles | Not in game yet |  |

## Placement

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `placement_rule` | Where a new building may go | within a one-tile gap | text | Ours differs (not changed) | A tile of it within 2 tiles of one of your buildings that Extends Base (Buildings sheet); walls may chain off walls; Placement Adjacency above 1 allows more. Ours: within ENGINE.buildRadius (6 tiles). |
| `assembly_yard_undeploy` | An Assembly Yard can pack up into an Assembler again | no | boolean | Not in game yet | A deployed yard keeps the Assembler's health share. |
| `difficulty_handicaps` | Difficulty handicaps | none | text | Ours differs (kept) | Ours: the computer plays by the same rules at every level; levels differ in mistakes (Design Decisions). The alternative gives each level damage, armor, speed, cost and build-time multipliers. |

## Crates

| ID | Rule | Value | Unit | In our game | Notes |
|---|---|---:|---|---|---|
| `crates_per_player` | Crates on the map at the start | 1 | per player | Not in game yet | At least one each. Picking one up places a new one at once. |
| `crate_lifetime_min` | Crate lifetime: shortest | 90 | seconds | Not in game yet | An unclaimed crate moves somewhere else after a random time between these. |
| `crate_lifetime_max` | Crate lifetime: longest | 360 | seconds | Not in game yet |  |
| `crate_water_chance` | Chance a new crate is on water | 0.2 | fraction | Not in game yet | A water crate can only give money-type crates (Unit and Squad turn into Money). |
| `crate_effect_radius` | Reach of area crates | 3 | tiles | Not in game yet | Cloak, Armor, Speed, Firepower and Lock Field crates affect everything within this, whoever owns it. |
