<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Damage matrix

Multiplier applied to a weapon's damage depending on its damage class and the target's armor:
**final damage = weapon damage × multiplier**. Negative damage (Field Heal) heals.

| Damage class | Unarmored | Structure | Light | Heavy | Fortified |
|---|---:|---:|---:|---:|---:|
| Small Arms (`small_arms`) | 1 | 0.5 | 0.6 | 0.25 | 0.25 |
| High Explosive (`high_explosive`) | 0.9 | 0.75 | 0.6 | 0.25 | 1 |
| Armor Piercing (`armor_piercing`) | 0.3 | 0.75 | 0.75 | 1 | 0.5 |
| Thermal (`thermal`) | 0.9 | 1 | 0.6 | 0.25 | 0.5 |
| Precision (`precision`) | 1 | 0.05 | 0.05 | 0.05 | 0.05 |
| Universal (`universal`) | 1 | 1 | 1 | 1 | 1 |
| Organic (`organic`) | 1 | 0 | 0 | 0 | 0 |
| Strategic (`strategic`) | 0.9 | 1 | 0.6 | 0.25 | 0.5 |
