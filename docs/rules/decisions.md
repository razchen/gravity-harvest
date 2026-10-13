<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Design decisions (from the spreadsheet)

| Decision | Status | Why | Effect | Revisit? | Implementation |
|---|---|---|---|---|---|
| Remove resource storage caps | Locked | Storage management adds friction without improving the core harvest-build-fight loop. | No Silo requirement; income is immediately spendable. | Yes, but only if playtests show a real strategic need. | Refinery unload directly increments credits. |
| Keep one spendable currency | Locked | Preserves a simple readable economy. | All production competes for the same credits. | No for baseline. | Do not create research/fuel/material currencies. |
| Keep common + rare deposits | Locked | Creates contested high-value map zones without adding a second economy. | Rare deposits pay more but spend identically. | Yes, values can be tuned. | Same Harvester/refinery loop. |
| Simplify progression | Locked | A clean tech ladder is easier to read and balance. | Establish → Economy → Warfare → Advanced → Strategic. | Yes, individual prerequisites can move. | Use building prerequisites, not building levels. |
| Faction-specific Harvester behavior | Deferred | Useful asymmetry without changing the economy. | One side may later gain mobility; the other survivability/defense. | Yes, after baseline playtest. | Do not change cargo value or add new resource types. |
| Late-game processing bonus | Deferred | Provides economic asymmetry without a new resource system. | One faction may gain a modest yield multiplier from late tech. | Yes, after baseline playtest. | Keep disabled until factions are finalized. |

Deferred ideas are not baseline mechanics.
