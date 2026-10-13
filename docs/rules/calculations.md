<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Calculations

Every number the game derives from the spreadsheet comes from one function in `packages/rules/src/calc.ts`.
Spreadsheet values are already normalized; no code re-applies scale factors.

## Formulas

| Quantity | Formula | Function |
|---|---|---|
| Damage per hit | weapon damage × matrix[damage class][target armor] | `hitDamage` |
| Damage per volley | hit damage × burst | `volleyDamage` |
| Raw DPS | damage × burst ÷ fire interval | `rawDps` |
| DPS vs armor | volley damage ÷ fire interval | `effectiveDps` |
| Unit DPS | sum of its weapons' DPS | `loadoutDps` |
| Time to kill | (⌈HP ÷ volley damage⌉ − 1) × fire interval (first volley immediate) | `timeToKillSec` |
| Unload credits | resource units × value (no storage cap) | `creditsFor` |
| Full load | harvester capacity × value | `fullLoadCredits` |
| Refund (sell / cancel) | ⌊cost × 0.5⌋ | `refundFor` |
| Repair | cost × 0.2 (structures) or 0.2 (units) × HP fraction repaired | `repairCost` |
| Power | Σ positive deltas − Σ consumption; low when consumption > production | `powerBalance` |
| Operational | not (requires power and power is low) | `isOperational` |
| Movement | speed × 0.35 tiles/s (engine constant, not in the sheet) | `speedToTilesPerSec` |

## Weapon DPS against each armor

| Weapon | Unarmored | Structure | Light | Heavy | Fortified |
|---|---:|---:|---:|---:|---:|
| Service Rifle | 45 | 22.5 | 27 | 11.3 | 11.3 |
| Sky Missile | 18 | 45 | 45 | 60 | 30 |
| Armor Missile | 12.6 | 31.5 | 31.5 | 42 | 21 |
| Precision Sidearm | 600.6 | 30 | 30 | 30 | 30 |
| Field Heal | -37.5 | -0 | -0 | -0 | -0 |
| Hound Strike | 599.7 | 0 | 0 | 0 | 0 |
| Frag Grenade | 45 | 37.5 | 30 | 12.5 | 50 |
| Thermal Projector | 75.6 | 84 | 50.4 | 21 | 42 |
| Light Autocannon | 45 | 22.5 | 27 | 11.3 | 11.3 |
| Light Cannon | 11.2 | 28.1 | 28.1 | 37.5 | 18.7 |
| Battle Cannon | 10.8 | 27 | 27 | 36 | 18 |
| Heavy Cannon | 7.7 | 19.3 | 19.3 | 25.7 | 12.9 |
| Anvil Cannon | 18 | 45 | 45 | 60 | 30 |
| Support Missiles | 101.3 | 84.4 | 67.5 | 28.1 | 112.5 |
| Siege Artillery | 124.6 | 103.9 | 83.1 | 34.6 | 138.5 |
| Siege Missile | 81 | 67.5 | 54 | 22.5 | 90 |
| Rotary Cannon | 800 | 400 | 480 | 200 | 200 |
| Strike Missile | 300 | 750 | 750 | 1,000 | 500 |
| Attack Missile | 12 | 30 | 30 | 40 | 20 |
| Deck Cannon | 7.5 | 18.8 | 18.8 | 25 | 12.5 |
| Depth Charge | 24 | 60 | 60 | 80 | 40 |
| Naval Missile | 18 | 45 | 45 | 60 | 30 |
| Heavy Naval Cannon | 168.7 | 140.6 | 112.5 | 46.9 | 187.5 |
| Torpedo | 27 | 67.5 | 67.5 | 90 | 45 |
| Sentry Autocannon | 60 | 30 | 36 | 15 | 15 |
| Lance Cannon | 14.4 | 36 | 36 | 48 | 24 |
| AA Autocannon | 45 | 112.4 | 112.4 | 149.9 | 75 |
| Thermal Turret | 135 | 150 | 90 | 37.5 | 75 |
| Gravity Discharge | 50 | 50 | 50 | 50 | 50 |
| AA Missile | 45 | 112.5 | 112.5 | 150 | 75 |

## Dependency helpers

`packages/rules/src/deps.ts` answers "what depends on what" for both the full rules (server) and the public
subset (browser): `missingRequirements`, `canBuild`, `producersOf`, `productionOf`, `directlyUnlocks`,
`dependentsOf` (what you lose access to if a building dies), `prerequisiteClosure` (the full path to unlock
something), `buildOrder` and `validateCatalog`. See tech-tree.md for the graph.
