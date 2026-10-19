<!-- GENERATED from design/balance.xlsx by packages/rules/scripts/import-balance.mjs. Do not edit by hand. -->

# Weapons

Damage already includes the HP/damage scale. Raw DPS = damage × burst ÷ fire interval (before armor; see damage-matrix.md).

| ID | Name | Damage | Interval (s) | Burst | Raw DPS | Range | Damage class | Effect | Targets |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| `service_rifle` | Service Rifle | 60 | 1.333 | 1 | 45.01 | 3 | small_arms | bullet | ground |
| `sky_missile` | Sky Missile | 200 | 3.333 | 1 | 60.01 | 7.5 | armor_piercing | guided missile | air |
| `armor_missile` | Armor Missile | 140 | 3.333 | 1 | 42 | 5 | armor_piercing | guided missile | ground |
| `precision_sidearm` | Precision Sidearm | 200 | 0.333 | 1 | 600.6 | 5.75 | precision | bullet | ground personnel |
| `field_heal` | Field Heal | -200 | 5.333 | 1 | -37.5 | 1.83 | organic | beam | friendly infantry |
| `hound_strike` | Hound Strike | 400 | 0.667 | 1 | 599.7 | 2.2 | organic | leap | ground personnel |
| `frag_grenade` | Frag Grenade | 200 | 4 | 1 | 50 | 4 | high_explosive | lobbed grenade | ground |
| `thermal_projector` | Thermal Projector | 280 | 3.333 | 1 | 84.01 | 3.5 | thermal | flame | ground |
| `light_autocannon` | Light Autocannon | 60 | 1.333 | 1 | 45.01 | 4 | small_arms | bullet | ground |
| `light_cannon` | Light Cannon | 100 | 2.667 | 1 | 37.5 | 4 | armor_piercing | shell | ground |
| `battle_cannon` | Battle Cannon | 120 | 3.333 | 1 | 36 | 4.75 | armor_piercing | shell | ground |
| `heavy_cannon` | Heavy Cannon | 120 | 4.667 | 1 | 25.71 | 4.75 | armor_piercing | shell | ground |
| `anvil_cannon` | Anvil Cannon | 160 | 5.333 | 2 | 60 | 4.75 | armor_piercing | shell | ground |
| `support_missiles` | Support Missiles | 300 | 5.333 | 2 | 112.51 | 5 | high_explosive | guided missile | air / light targets |
| `siege_artillery` | Siege Artillery | 600 | 4.333 | 1 | 138.47 | 6 | high_explosive | ballistic shell | ground |
| `siege_missile` | Siege Missile | 2,400 | 26.667 | 1 | 90 | 10 | high_explosive | heavy missile | ground / structure |
| `rotary_cannon` | Rotary Cannon | 160 | 0.2 | 1 | 800 | 5 | small_arms | bullet | ground |
| `strike_missile` | Strike Missile | 200 | 0.2 | 1 | 1,000 | 6 | armor_piercing | guided missile | air / ground |
| `attack_missile` | Attack Missile | 160 | 4 | 1 | 40 | 4 | armor_piercing | guided missile | ground |
| `deck_cannon` | Deck Cannon | 100 | 4 | 1 | 25 | 5.5 | armor_piercing | shell | surface |
| `depth_charge` | Depth Charge | 320 | 4 | 1 | 80 | 5 | armor_piercing | depth charge | submerged |
| `naval_missile` | Naval Missile | 120 | 4 | 2 | 60 | 9 | armor_piercing | guided missile | surface / air |
| `heavy_naval_cannon` | Heavy Naval Cannon | 2,000 | 10.667 | 1 | 187.49 | 22 | high_explosive | ballistic shell | surface / ground |
| `torpedo` | Torpedo | 360 | 4 | 1 | 90 | 9 | armor_piercing | torpedo | surface |
| `sentry_autocannon` | Sentry Autocannon | 160 | 2.667 | 1 | 59.99 | 5 | small_arms | bullet | ground |
| `lance_cannon` | Lance Cannon | 160 | 3.333 | 1 | 48 | 6 | armor_piercing | shell | ground armor |
| `aa_autocannon` | AA Autocannon | 100 | 0.667 | 1 | 149.93 | 6 | armor_piercing | aa projectile | air |
| `thermal_turret` | Thermal Turret | 500 | 3.333 | 1 | 150.02 | 4 | thermal | fireball | ground |
| `gravity_discharge` | Gravity Discharge | 400 | 8 | 1 | 50 | 8.5 | universal | instant discharge | ground |
| `aa_missile` | AA Missile | 200 | 1.333 | 1 | 150.04 | 7.5 | armor_piercing | guided missile | air |

## Projectiles

Data only for now (the simulation does not read these yet). Speed in tiles per second; homing turn in degrees per second.

| Name | Speed | Homing °/s | Inaccurate | Arcing | Over walls | Air | Ground | Submerged | Faster vs air | Charge-up |
|---|---:|---:|---|---|---|---|---|---|---|---|
| Service Rifle | instant |  |  |  |  |  | yes |  |  |  |
| Sky Missile | 7.5 | 421.9 |  |  | yes | yes |  |  |  |  |
| Armor Missile | 3.75 | 105.5 | yes |  | yes | yes | yes |  |  |  |
| Precision Sidearm | instant |  |  |  |  |  | yes |  |  |  |
| Field Heal | instant |  |  |  |  |  | yes |  |  |  |
| Hound Strike | 2.99 | 421.9 |  |  |  |  | yes |  |  |  |
| Frag Grenade | 0.7 |  | yes | yes | yes |  | yes |  |  |  |
| Thermal Projector | 1.76 |  |  |  |  |  | yes |  |  |  |
| Light Autocannon | instant |  |  |  |  |  | yes |  |  |  |
| Light Cannon | 5.98 |  |  |  |  |  | yes |  |  |  |
| Battle Cannon | 5.98 |  |  |  |  |  | yes |  |  |  |
| Heavy Cannon | 5.98 |  |  |  |  |  | yes |  |  |  |
| Anvil Cannon | 5.98 |  |  |  |  |  | yes |  |  |  |
| Support Missiles | 4.45 | 105.5 | yes |  | yes | yes | yes |  |  |  |
| Siege Artillery | 1.76 |  | yes | yes | yes |  | yes |  |  |  |
| Siege Missile | 3.75 |  | yes |  | yes |  | yes |  |  |  |
| Rotary Cannon | instant |  |  |  |  |  | yes |  |  |  |
| Strike Missile | 4.45 | 105.5 | yes |  | yes | yes | yes |  |  |  |
| Attack Missile | 4.45 | 105.5 | yes |  | yes | yes | yes |  |  |  |
| Deck Cannon | 3.75 |  |  |  |  |  | yes |  |  |  |
| Depth Charge | 0.7 |  | yes | yes | yes |  |  | yes |  |  |
| Naval Missile | 2.99 | 421.9 |  |  | yes | yes | yes |  | yes |  |
| Heavy Naval Cannon | 0.88 |  | yes | yes | yes |  | yes |  |  |  |
| Torpedo | 2.23 |  |  |  |  |  | yes | yes |  |  |
| Sentry Autocannon | instant |  |  |  |  |  | yes |  |  |  |
| Lance Cannon | 5.98 |  |  |  |  |  | yes |  |  |  |
| AA Autocannon | instant |  |  |  |  | yes |  |  |  |  |
| Thermal Turret | 1.76 |  |  |  |  |  | yes |  |  |  |
| Gravity Discharge | instant |  |  |  |  |  | yes |  |  | yes |
| AA Missile | 7.5 | 421.9 |  |  | yes | yes |  |  |  |  |

- **Sky Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.2 s of flight (not against aircraft).
- **Armor Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.13 s of flight (not against aircraft).
- **Field Heal:** Heals only within 0.03 tiles, unarmored targets only.
- **Hound Strike:** A leap, not a projectile: kills its infantry target outright and harms nothing else.
- **Support Missiles:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.13 s of flight (not against aircraft).
- **Siege Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.67 s of flight (not against aircraft).
- **Strike Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.13 s of flight (not against aircraft).
- **Attack Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.13 s of flight (not against aircraft).
- **Naval Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.2 s of flight (not against aircraft).
- **Torpedo:** Runs under water; bursts on leaving water.
- **AA Missile:** Fuelled missile: scatters when fired at infantry or the ground. Arms after 0.2 s of flight (not against aircraft).
