<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Rules and economy

Generated from `design/balance.xlsx`, the source of truth. To change a number, edit the spreadsheet and run
`npm run import --workspace @gravity-harvest/rules`; this regenerates the typed data and these pages.

- [Economy](economy.md): credits, harvesting, refunds, repairs, AI pacing
- [Buildings](buildings.md) and [Units](units.md)
- [Weapons](weapons.md) and the [damage matrix](damage-matrix.md)
- [Abilities](abilities.md)
- [Engine rules](engine-rules.md): formulas, rates and effects (data only for now) and [crates](crates.md)
- [Tech tree](tech-tree.md): stages and the dependency graph
- [Calculations](calculations.md): every formula and the function that implements it
- [Design decisions](decisions.md)

Only the public subset (names, costs, power, build times, prerequisites) is ever shipped to the browser;
everything else stays on the server. See docs/DECISIONS.md, "Rules and protection".
