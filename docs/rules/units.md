<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Units

33 units. Speed, sight and range use the spreadsheet's units (see calculations.md for how the simulation converts speed).

| ID | Name | Faction | Category | Cost | HP | Armor | Speed | Sight | Build (s) | Built at | Also needs | Weapons | Ammo | Seats |
|---|---|---|---|---:|---:|---|---:|---:|---:|---|---|---|---:|---:|
| `rifleman` | Rifleman | Both | Infantry | 150 | 200 | unarmored | 4 | 4 | 4.8 | Barracks |  | service_rifle |  |  |
| `lancer` | Lancer | Both | Infantry | 450 | 180 | unarmored | 3 | 4 | 14.4 | Barracks |  | sky_missile, armor_missile |  |  |
| `engineer` | Engineer | Both | Infantry | 750 | 100 | unarmored | 4 | 4 | 24 | Barracks |  |  |  |  |
| `operator` | Operator | Both | Infantry | 1,800 | 400 | unarmored | 5 | 6 | 57.6 | Barracks | Gravity Lab or Gravity Forge | precision_sidearm, precision_sidearm |  |  |
| `harvester` | Harvester | Both | Support Vehicle | 2,100 | 2,400 | heavy | 6 | 4 | 67.2 | Motor Works | Refinery |  |  |  |
| `assembler` | Assembler | Both | Support Vehicle | 3,750 | 2,400 | light | 6 | 4 | 120 | Motor Works | Service Bay |  |  |  |
| `seeder` | Seeder | Both | Support Vehicle | 1,200 | 400 | heavy | 9 | 5 | 38.4 | Motor Works | Service Bay |  | 5 |  |
| `lander` | Lander | Both | Naval | 1,050 | 1,400 | heavy | 14 | 6 | 33.6 | Harbor or Sub Dock |  |  |  | 5 |
| `medic` | Medic | Ordan | Infantry | 1,200 | 320 | unarmored | 4 | 3 | 38.4 | Barracks |  | field_heal |  |  |
| `infiltrator` | Infiltrator | Ordan | Infantry | 750 | 100 | unarmored | 4 | 5 | 24 | Barracks | Radar |  |  |  |
| `raider` | Raider | Ordan | Infantry | 750 | 100 | unarmored | 4 | 5 | 24 | Barracks | Gravity Lab |  |  |  |
| `hound` | Hound | Sable | Infantry | 300 | 48 | unarmored | 4 | 5 | 9.6 | Hound Kennel |  | hound_strike |  |  |
| `grenadier` | Grenadier | Sable | Infantry | 240 | 200 | unarmored | 5 | 4 | 7.68 | Barracks |  | frag_grenade |  |  |
| `breaker` | Breaker | Sable | Infantry | 450 | 160 | unarmored | 3 | 4 | 14.4 | Barracks | Gravity Forge | thermal_projector |  |  |
| `skimmer` | Skimmer | Ordan | Combat Vehicle | 900 | 600 | light | 10 | 6 | 28.8 | Motor Works |  | light_autocannon |  |  |
| `jackal` | Jackal | Ordan | Combat Vehicle | 1,050 | 1,200 | heavy | 9 | 4 | 33.6 | Motor Works |  | light_cannon |  |  |
| `ram` | Ram | Ordan | Combat Vehicle | 1,200 | 1,600 | heavy | 8 | 5 | 38.4 | Motor Works |  | battle_cannon |  |  |
| `carrier` | Carrier | Ordan | Combat Vehicle | 1,200 | 800 | heavy | 10 | 5 | 38.4 | Motor Works | Barracks | light_autocannon |  | 5 |
| `spire` | Spire | Ordan | Combat Vehicle | 900 | 300 | light | 6 | 5 | 28.8 | Motor Works |  | siege_artillery |  |  |
| `watcher` | Watcher | Ordan | Support Vehicle | 900 | 440 | light | 9 | 7 | 28.8 | Motor Works | Radar |  |  |  |
| `shroud` | Shroud | Ordan | Support Vehicle | 900 | 440 | light | 9 | 4 | 28.8 | Motor Works | Gravity Lab |  |  |  |
| `goliath` | Goliath | Sable | Combat Vehicle | 1,425 | 1,600 | heavy | 7 | 5 | 45.6 | Motor Works |  | heavy_cannon, heavy_cannon |  |  |
| `anvil` | Anvil | Sable | Combat Vehicle | 2,550 | 2,400 | heavy | 4 | 6 | 81.6 | Motor Works | Gravity Forge | anvil_cannon, support_missiles |  |  |
| `salvo` | Salvo | Sable | Combat Vehicle | 1,050 | 600 | light | 7 | 5 | 33.6 | Motor Works | Radar | siege_missile | 1 |  |
| `drift` | Drift | Ordan | Aircraft | 1,800 | 900 | heavy | 16 | 0 | 57.6 | Flight Pad |  | attack_missile, attack_missile | 6 |  |
| `shrike` | Shrike | Sable | Aircraft | 1,200 | 240 | light | 16 | 0 | 38.4 | Airfield |  | rotary_cannon, rotary_cannon | 15 |  |
| `interceptor` | Interceptor | Sable | Aircraft | 1,800 | 200 | light | 20 | 0 | 57.6 | Airfield |  | strike_missile, strike_missile | 3 |  |
| `lifter` | Lifter | Sable | Aircraft | 1,800 | 360 | light | 12 | 0 | 57.6 | Flight Pad |  |  |  | 5 |
| `hammer` | Hammer | Sable | Aircraft | 1,800 | 900 | heavy | 12 | 0 | 57.6 | Flight Pad |  | rotary_cannon | 12 |  |
| `cutter` | Cutter | Ordan | Naval | 750 | 800 | heavy | 9 | 7 | 24 | Harbor |  | deck_cannon, depth_charge |  |  |
| `warden` | Warden | Ordan | Naval | 1,500 | 1,600 | heavy | 6 | 6 | 48 | Harbor |  | naval_missile, depth_charge |  |  |
| `bastion` | Bastion | Ordan | Naval | 3,000 | 2,800 | heavy | 4 | 7 | 96 | Harbor | Gravity Lab | heavy_naval_cannon, heavy_naval_cannon |  |  |
| `wraith` | Wraith | Sable | Naval | 1,425 | 480 | light | 6 | 6 | 45.6 | Sub Dock |  | torpedo |  |  |

## What each does

- **Rifleman:** Cheap frontline infantry with a service rifle; best against other infantry.
- **Lancer:** Missile infantry that hits both armour and aircraft.
- **Engineer:** Unarmed; enters buildings to capture or repair them.
- **Operator:** Elite specialist who can infiltrate and demolish structures.
- **Harvester:** Collects ore and brings it to a Refinery; the first comes free with each Refinery.
- **Assembler:** Drives out and deploys into a new Assembly Yard, to start another base.
- **Seeder:** Lays mines (carries 5).
- **Lander:** Amphibious transport for 5 passengers.
- **Medic:** Heals nearby infantry.
- **Infiltrator:** Slips into enemy structures to gather intelligence.
- **Raider:** Infiltrates enemy economic structures.
- **Hound:** Fast hunter that runs down infantry.
- **Grenadier:** Throws fragmentation grenades at infantry and structures; explodes violently when killed.
- **Breaker:** Short-range thermal assault infantry; explodes violently when killed.
- **Skimmer:** Fast scout with a light autocannon, good against infantry.
- **Jackal:** Light tracked tank.
- **Ram:** Main battle tank.
- **Carrier:** Tracked transport for 5 infantry, with a light autocannon.
- **Spire:** Long-range artillery; must stop to fire.
- **Watcher:** Disrupts enemy radar around it.
- **Shroud:** Hides nearby units from enemy sight.
- **Goliath:** Heavy twin-gun tank.
- **Anvil:** Late-game heavy assault tank that heals itself up to half health.
- **Salvo:** Long-range missile artillery: one missile at a time, and it must stop to fire.
- **Drift:** Attack helicopter with missiles; the first comes with the first Flight Pad.
- **Shrike:** Ground-attack aircraft with rotary cannons.
- **Interceptor:** Fast strike aircraft with missiles.
- **Lifter:** Transport helicopter for 5 passengers.
- **Hammer:** Heavy attack gunship; the first comes with the first Flight Pad.
- **Cutter:** Fast patrol boat that hunts submarines.
- **Warden:** Missile destroyer that also hunts submarines.
- **Bastion:** Heavy long-range warship.
- **Wraith:** Stealth submarine that strikes with torpedoes.

## Traits

- **Engineer:** Can enter structures for capture/repair interactions.
- **Operator:** Can infiltrate and demolish structures.
- **Harvester:** Refinery completion grants one. Economic behavior may later differ by faction without changing the core resource loop.
- **Assembler:** Deploys into Assembly Yard.
- **Seeder:** Carries 5 mines.
- **Lander:** Carries 5 passengers.
- **Medic:** Heals infantry.
- **Infiltrator:** Can infiltrate structures.
- **Raider:** Can infiltrate economic structures.
- **Hound:** Special anti-personnel targeting logic.
- **Grenadier:** Explodes violently when killed.
- **Breaker:** Explodes violently when killed.
- **Jackal:** Tracked.
- **Ram:** Tracked.
- **Carrier:** Carries 5 passengers. Tracked.
- **Spire:** Must stop to fire. Tracked.
- **Watcher:** Electronic disruption support.
- **Shroud:** Mobile concealment support.
- **Goliath:** Tracked; twin-gun loadout.
- **Anvil:** Self-heals up to half health. Tracked.
- **Salvo:** Carries one missile and must stop to fire. Tracked.
- **Drift:** First one is bundled with the first Flight Pad.
- **Lifter:** Carries 5 passengers.
- **Hammer:** First one is bundled with the first Flight Pad.
- **Cutter:** Detects submerged units.
- **Warden:** Detects submerged units.
- **Bastion:** Detects submerged units.
- **Wraith:** Submerged / cloaked behavior.
