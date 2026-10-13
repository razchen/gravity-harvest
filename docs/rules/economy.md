<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Economy

| Setting | Value | Notes |
|---|---:|---|
| Starting credits | 15,000 |  |
| Harvester capacity | 28 | resource units per load |
| Common resource value | 37.5 | credits per unit |
| Rare resource value | 75 | credits per unit |
| Common full load | 1,050 | calculated: capacity × value |
| Rare full load | 2,100 | calculated: capacity × value |
| Sell / cancel refund | 50% | of cost |
| Structure full repair | 20% | of cost, from 0 to full HP |
| Unit full repair | 20% | of cost, from 0 to full HP |
| Resource regrowth | on |  |
| Resource spread | on |  |
| Resource per tile (full) | 12 | resource units; rocks show it in steps of 4 |
| Starting field density | 75% | of full, on average: centre full, edges thinner |
| Growth tick | 20 s | how often fields grow and spread |
| Growth chance | 20% | per partly harvested tile per tick: +1 unit, up to full |
| Spread chance | 25% | per emptied tile next to one at least half full: +1 unit; never past the original field |
| Root regrowth chance | 10% | per emptied tile at the heart of a field: +1 unit on its own, so fields thin but never vanish |
| AI first attack (target) | 5 min | pacing target, not a rigid timer |
| AI attack interval (target) | 3 min | average |
| AI desired power surplus | 250 | power |

**No storage cap:** harvester unloads become credits immediately. One spendable currency (credits), plus power.

## Core rules

- **Economy:** One common resource, one rarer higher-value form, one spendable currency, plus power.
- **Storage:** No resource-storage cap. Harvester unloads become credits immediately.
- **Tech flow:** Establish → Economy → Warfare → Advanced → Strategic.
- **Factions:** Ordan and Sable share the same economic foundation; asymmetry comes from roster, tech and later controlled economy modifiers.
- **Harvesters:** Baseline Harvester remains shared for now. A faction-specific mobility/defense twist may be introduced later without creating a second economy.
- **Late economy:** A faction-specific late-game processing bonus is allowed as a future balancing lever, but is not enabled in the baseline.
- **Balance:** Costs/resources are scaled together; HP and damage are both ×4; timing/speed/range/sight/fire cadence stay unchanged.
- **Implementation:** All values in this workbook are already normalized. Do not reapply multipliers in code.

## Normalization

Values in the spreadsheet are already normalized. **Do not reapply these in code.**

| Scale | Factor |
|---|---:|
| Credit scale | 1.5 |
| HP scale | 4 |
| Damage scale | 4 |
| Power scale | 5 |
| Build-time scale | 1 |
| Movement scale | 1 |
| Range scale | 1 |
| Sight scale | 1 |
| Fire-rate scale | 1 |
