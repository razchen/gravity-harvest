<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Buildings

33 buildings. Power: positive produces, negative consumes. "Requires power" buildings stop working on low power.

| ID | Name | Faction | Stage | Cost | HP | Armor | Sight | Power | Build (s) | Prerequisites | Needs power | Weapons |
|---|---|---|---|---:|---:|---|---:|---:|---:|---|---|---|
| `assembly_yard` | Assembly Yard | Both | establish | 3,750 | 4,000 | heavy | 5 | 0 | 120 |  |  |  |
| `power_plant` | Power Plant | Both | establish | 450 | 1,600 | structure | 4 | +500 | 14.4 | Assembly Yard |  |  |
| `reactor_plant` | Reactor Plant | Both | advanced | 750 | 2,800 | structure | 4 | +1000 | 24 | Power Plant |  |  |
| `refinery` | Refinery | Both | economy | 3,000 | 3,600 | structure | 6 | -150 | 96 | Power Plant |  |  |
| `barracks` | Barracks | Both | economy | 450 | 3,200 | structure | 5 | -100 | 14.4 | Power Plant |  |  |
| `motor_works` | Motor Works | Both | warfare | 3,000 | 4,000 | light | 4 | -150 | 96 | Refinery |  |  |
| `service_bay` | Service Bay | Both | advanced | 1,800 | 3,200 | structure | 5 | -150 | 57.6 | Motor Works |  |  |
| `radar` | Radar | Both | warfare | 1,500 | 4,000 | structure | 10 | -200 | 48 | Refinery | yes |  |
| `flight_pad` | Flight Pad | Both | advanced | 2,250 | 3,200 | structure | 5 | -50 | 72 | Radar |  |  |
| `concrete_barrier` | Concrete Barrier | Both | warfare | 150 | 4 | unarmored | 0 | 0 | 4.8 |  |  |  |
| `gravity_lab` | Gravity Lab | Ordan | advanced | 2,250 | 1,600 | structure | 10 | -1000 | 72 | Motor Works, Radar |  |  |
| `phase_array` | Phase Array | Ordan | strategic | 4,200 | 1,600 | structure | 10 | -1000 | 134.4 | Gravity Lab | yes |  |
| `harbor` | Harbor | Ordan | warfare | 975 | 4,000 | light | 4 | -150 | 31.2 | Power Plant |  |  |
| `sentry` | Sentry | Ordan | warfare | 600 | 1,600 | structure | 5 | -75 | 19.2 | Barracks |  | sentry_autocannon |
| `hidden_sentry` | Hidden Sentry | Ordan | warfare | 900 | 2,400 | structure | 5 | -75 | 28.8 | Barracks |  | sentry_autocannon |
| `lance_battery` | Lance Battery | Ordan | warfare | 900 | 1,600 | heavy | 6 | -200 | 28.8 | Barracks |  | lance_cannon |
| `flak_array` | Flak Array | Ordan | advanced | 900 | 1,600 | heavy | 6 | -250 | 28.8 | Radar | yes | aa_autocannon, aa_autocannon |
| `veil_generator` | Veil Generator | Ordan | advanced | 750 | 4,000 | structure | 10 | -300 | 24 | Gravity Lab | yes |  |
| `sandbag_barrier` | Sandbag Barrier | Ordan | warfare | 37.5 | 4 | unarmored | 0 | 0 | 1.2 |  |  |  |
| `decoy_yard` | Decoy Yard | Ordan | economy | 75 | 120 | unarmored | 4 | -10 | 2.4 |  |  |  |
| `decoy_motor_works` | Decoy Motor Works | Ordan | warfare | 75 | 120 | unarmored | 4 | -10 | 2.4 | Refinery |  |  |
| `decoy_harbor` | Decoy Harbor | Ordan | warfare | 75 | 120 | unarmored | 4 | -10 | 2.4 | Power Plant |  |  |
| `decoy_radar` | Decoy Radar | Ordan | warfare | 75 | 120 | unarmored | 4 | -10 | 2.4 | Refinery |  |  |
| `gravity_forge` | Gravity Forge | Sable | advanced | 2,250 | 2,400 | structure | 4 | -500 | 72 | Motor Works, Radar |  |  |
| `lock_field` | Lock Field | Sable | strategic | 4,200 | 1,600 | structure | 10 | -1000 | 134.4 | Gravity Forge | yes |  |
| `sub_dock` | Sub Dock | Sable | warfare | 975 | 4,000 | light | 4 | -150 | 31.2 | Power Plant |  |  |
| `incinerator` | Incinerator | Sable | warfare | 900 | 1,600 | heavy | 6 | -100 | 28.8 | Barracks |  | thermal_turret |
| `anchor` | Anchor | Sable | advanced | 2,250 | 1,600 | heavy | 8 | -750 | 72 | Motor Works | yes | gravity_discharge |
| `sky_lance` | Sky Lance | Sable | advanced | 1,125 | 1,600 | heavy | 5 | -100 | 36 | Radar |  | aa_missile |
| `airfield` | Airfield | Sable | advanced | 900 | 4,000 | heavy | 7 | -150 | 28.8 | Radar |  |  |
| `hound_kennel` | Hound Kennel | Sable | warfare | 300 | 1,600 | structure | 4 | -50 | 9.6 | Barracks |  |  |
| `wire_barrier` | Wire Barrier | Sable | warfare | 37.5 | 4 | unarmored | 0 | 0 | 1.2 |  |  |  |
| `strategic_silo` | Strategic Silo | Sable | strategic | 3,750 | 1,600 | heavy | 5 | -500 | 120 | Gravity Forge |  |  |

## What each does

- **Assembly Yard:** The core of the base: every other structure is built from it. Deploys from an Assembler.
- **Power Plant:** Basic power (+500). Most buildings draw power; run short and they slow down or switch off.
- **Reactor Plant:** Advanced power (+1000): twice a Power Plant's output for less than twice the price.
- **Refinery:** Harvesters unload ore here; each load turns straight into credits, with no storage limit.
- **Barracks:** Trains infantry.
- **Motor Works:** Builds ground vehicles, including Harvesters and the Assembler.
- **Service Bay:** Repairs and services vehicles.
- **Radar:** Turns on the minimap and battlefield intelligence. Switches off on low power.
- **Flight Pad:** Builds and rearms helicopters; the first pad comes with a helicopter.
- **Concrete Barrier:** Cheap, tough wall that blocks movement.
- **Gravity Lab:** Advanced technology: unlocks the side's high-tier units and systems.
- **Phase Array:** Late-game strategic mobility structure. Switches off on low power.
- **Harbor:** Builds ships. Placed on water.
- **Sentry:** Basic autocannon turret against infantry.
- **Hidden Sentry:** A camouflaged Sentry, hard for the enemy to spot.
- **Lance Battery:** Cannon emplacement against vehicles and armour.
- **Flak Array:** Twin anti-aircraft autocannons. Switches off on low power.
- **Veil Generator:** Hides the area around it from enemy radar and sight. Switches off on low power.
- **Sandbag Barrier:** Very cheap light wall.
- **Decoy Yard:** A cheap fake Assembly Yard that draws enemy attention.
- **Decoy Motor Works:** A cheap fake Motor Works that draws enemy attention.
- **Decoy Harbor:** A cheap fake Harbor that draws enemy attention.
- **Decoy Radar:** A cheap fake Radar that draws enemy attention.
- **Gravity Forge:** Advanced technology: unlocks the side's high-tier units and systems.
- **Lock Field:** Late-game strategic protection structure. Switches off on low power.
- **Sub Dock:** Builds submarines and landers. Placed on water.
- **Incinerator:** Thermal turret that burns infantry.
- **Anchor:** Heavy gravity-discharge weapon against ground forces. Switches off on low power.
- **Sky Lance:** Missile launcher against aircraft.
- **Airfield:** Builds and supports fixed-wing aircraft, and gives air-support abilities.
- **Hound Kennel:** Produces Hounds.
- **Wire Barrier:** Very cheap light wall.
- **Strategic Silo:** Late-game strategic missile: a long-range strike that can end a match.

## Notes

- **Assembly Yard:** Deploys from Assembler.
- **Reactor Plant:** Higher-output power source.
- **Refinery:** Harvester unloads are converted directly into credits. No storage cap.
- **Barracks:** Shared gameplay role; faction visuals can diverge.
- **Radar:** Stops functioning without adequate power.
- **Flight Pad:** First faction helicopter is bundled with the first pad.
- **Concrete Barrier:** Special wall interaction; raw HP is not the whole durability model.
- **Gravity Lab:** Unlocks high-tier Ordan systems.
- **Phase Array:** Strategic support structure.
- **Harbor:** Water placement.
- **Hidden Sentry:** Camouflaged defensive variant.
- **Flak Array:** Stops functioning without adequate power.
- **Veil Generator:** Stops functioning without adequate power.
- **Decoy Yard:** Reuses Assembly Yard appearance.
- **Decoy Motor Works:** Reuses Motor Works appearance.
- **Decoy Harbor:** Reuses Harbor appearance.
- **Decoy Radar:** Reuses Radar appearance.
- **Gravity Forge:** Unlocks high-tier Sable systems.
- **Lock Field:** Strategic support structure.
- **Sub Dock:** Water placement.
- **Anchor:** Stops functioning without adequate power.
- **Airfield:** Provides aircraft and air-support abilities.
- **Strategic Silo:** Strategic support structure.
