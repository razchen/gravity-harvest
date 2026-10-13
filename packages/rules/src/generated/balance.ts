// GENERATED from design/balance.xlsx by scripts/import-balance.mjs. Do not edit; edit the spreadsheet and re-run `npm run import`.
/* eslint-disable */
import type { AbilityDef, BuildingDef, DamageClassDef, EconomyRules, UnitDef, WeaponDef } from '../types.js';

export const ECONOMY: EconomyRules = {
  "startingCredits": 15000,
  "harvesterCapacity": 28,
  "commonResourceValue": 37.5,
  "rareResourceValue": 75,
  "refundFraction": 0.5,
  "structureFullRepairFraction": 0.2,
  "unitFullRepairFraction": 0.2,
  "resourceRegrowth": true,
  "resourceSpread": true,
  "aiFirstAttackMinutes": 5,
  "aiAttackIntervalMinutes": 3,
  "aiDesiredPowerSurplus": 250,
  "resourceTileMaxUnits": 12,
  "resourceStartDensity": 0.75,
  "resourceGrowthIntervalSec": 20,
  "resourceGrowthChance": 0.2,
  "resourceSpreadChance": 0.25,
  "resourceRootRegrowthChance": 0.1
};

export const NORMALIZATION: Readonly<Record<string, number>> = {
  "Credit scale": 1.5,
  "HP scale": 4,
  "Damage scale": 4,
  "Power scale": 5,
  "Build-time scale": 1,
  "Movement scale": 1,
  "Range scale": 1,
  "Sight scale": 1,
  "Fire-rate scale": 1
};

export const DAMAGE_MATRIX: Readonly<Record<string, DamageClassDef>> = {
  "small_arms": {
    "name": "Small Arms",
    "vs": {
      "unarmored": 1,
      "structure": 0.5,
      "light": 0.6,
      "heavy": 0.25,
      "fortified": 0.25
    }
  },
  "high_explosive": {
    "name": "High Explosive",
    "vs": {
      "unarmored": 0.9,
      "structure": 0.75,
      "light": 0.6,
      "heavy": 0.25,
      "fortified": 1
    }
  },
  "armor_piercing": {
    "name": "Armor Piercing",
    "vs": {
      "unarmored": 0.3,
      "structure": 0.75,
      "light": 0.75,
      "heavy": 1,
      "fortified": 0.5
    }
  },
  "thermal": {
    "name": "Thermal",
    "vs": {
      "unarmored": 0.9,
      "structure": 1,
      "light": 0.6,
      "heavy": 0.25,
      "fortified": 0.5
    }
  },
  "precision": {
    "name": "Precision",
    "vs": {
      "unarmored": 1,
      "structure": 0.05,
      "light": 0.05,
      "heavy": 0.05,
      "fortified": 0.05
    }
  },
  "universal": {
    "name": "Universal",
    "vs": {
      "unarmored": 1,
      "structure": 1,
      "light": 1,
      "heavy": 1,
      "fortified": 1
    }
  },
  "organic": {
    "name": "Organic",
    "vs": {
      "unarmored": 1,
      "structure": 0,
      "light": 0,
      "heavy": 0,
      "fortified": 0
    }
  },
  "strategic": {
    "name": "Strategic",
    "vs": {
      "unarmored": 0.9,
      "structure": 1,
      "light": 0.6,
      "heavy": 0.25,
      "fortified": 0.5
    }
  }
};

export const WEAPONS: Readonly<Record<string, WeaponDef>> = {
  "service_rifle": {
    "id": "service_rifle",
    "name": "Service Rifle",
    "damage": 60,
    "fireIntervalSec": 1.333,
    "rangeTiles": 3,
    "burst": 1,
    "damageClass": "small_arms",
    "projectile": "bullet",
    "targeting": "ground",
    "notes": null
  },
  "sky_missile": {
    "id": "sky_missile",
    "name": "Sky Missile",
    "damage": 200,
    "fireIntervalSec": 3.333,
    "rangeTiles": 7.5,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "air",
    "notes": null
  },
  "armor_missile": {
    "id": "armor_missile",
    "name": "Armor Missile",
    "damage": 140,
    "fireIntervalSec": 3.333,
    "rangeTiles": 5,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "ground",
    "notes": null
  },
  "precision_sidearm": {
    "id": "precision_sidearm",
    "name": "Precision Sidearm",
    "damage": 200,
    "fireIntervalSec": 0.333,
    "rangeTiles": 5.75,
    "burst": 1,
    "damageClass": "precision",
    "projectile": "bullet",
    "targeting": "ground personnel",
    "notes": null
  },
  "field_heal": {
    "id": "field_heal",
    "name": "Field Heal",
    "damage": -200,
    "fireIntervalSec": 5.333,
    "rangeTiles": 1.83,
    "burst": 1,
    "damageClass": "organic",
    "projectile": "beam",
    "targeting": "friendly infantry",
    "notes": null
  },
  "hound_strike": {
    "id": "hound_strike",
    "name": "Hound Strike",
    "damage": 400,
    "fireIntervalSec": 0.667,
    "rangeTiles": 2.2,
    "burst": 1,
    "damageClass": "organic",
    "projectile": "leap",
    "targeting": "ground personnel",
    "notes": null
  },
  "frag_grenade": {
    "id": "frag_grenade",
    "name": "Frag Grenade",
    "damage": 200,
    "fireIntervalSec": 4,
    "rangeTiles": 4,
    "burst": 1,
    "damageClass": "high_explosive",
    "projectile": "lobbed grenade",
    "targeting": "ground",
    "notes": null
  },
  "thermal_projector": {
    "id": "thermal_projector",
    "name": "Thermal Projector",
    "damage": 280,
    "fireIntervalSec": 3.333,
    "rangeTiles": 3.5,
    "burst": 1,
    "damageClass": "thermal",
    "projectile": "flame",
    "targeting": "ground",
    "notes": null
  },
  "light_autocannon": {
    "id": "light_autocannon",
    "name": "Light Autocannon",
    "damage": 60,
    "fireIntervalSec": 1.333,
    "rangeTiles": 4,
    "burst": 1,
    "damageClass": "small_arms",
    "projectile": "bullet",
    "targeting": "ground",
    "notes": null
  },
  "light_cannon": {
    "id": "light_cannon",
    "name": "Light Cannon",
    "damage": 100,
    "fireIntervalSec": 2.667,
    "rangeTiles": 4,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "ground",
    "notes": null
  },
  "battle_cannon": {
    "id": "battle_cannon",
    "name": "Battle Cannon",
    "damage": 120,
    "fireIntervalSec": 3.333,
    "rangeTiles": 4.75,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "ground",
    "notes": null
  },
  "heavy_cannon": {
    "id": "heavy_cannon",
    "name": "Heavy Cannon",
    "damage": 120,
    "fireIntervalSec": 4.667,
    "rangeTiles": 4.75,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "ground",
    "notes": null
  },
  "anvil_cannon": {
    "id": "anvil_cannon",
    "name": "Anvil Cannon",
    "damage": 160,
    "fireIntervalSec": 5.333,
    "rangeTiles": 4.75,
    "burst": 2,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "ground",
    "notes": null
  },
  "support_missiles": {
    "id": "support_missiles",
    "name": "Support Missiles",
    "damage": 300,
    "fireIntervalSec": 5.333,
    "rangeTiles": 5,
    "burst": 2,
    "damageClass": "high_explosive",
    "projectile": "guided missile",
    "targeting": "air / light targets",
    "notes": null
  },
  "siege_artillery": {
    "id": "siege_artillery",
    "name": "Siege Artillery",
    "damage": 600,
    "fireIntervalSec": 4.333,
    "rangeTiles": 6,
    "burst": 1,
    "damageClass": "high_explosive",
    "projectile": "ballistic shell",
    "targeting": "ground",
    "notes": null
  },
  "siege_missile": {
    "id": "siege_missile",
    "name": "Siege Missile",
    "damage": 2400,
    "fireIntervalSec": 26.667,
    "rangeTiles": 10,
    "burst": 1,
    "damageClass": "high_explosive",
    "projectile": "heavy missile",
    "targeting": "ground / structure",
    "notes": null
  },
  "rotary_cannon": {
    "id": "rotary_cannon",
    "name": "Rotary Cannon",
    "damage": 160,
    "fireIntervalSec": 0.2,
    "rangeTiles": 5,
    "burst": 1,
    "damageClass": "small_arms",
    "projectile": "bullet",
    "targeting": "ground",
    "notes": null
  },
  "strike_missile": {
    "id": "strike_missile",
    "name": "Strike Missile",
    "damage": 200,
    "fireIntervalSec": 0.2,
    "rangeTiles": 6,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "air / ground",
    "notes": null
  },
  "attack_missile": {
    "id": "attack_missile",
    "name": "Attack Missile",
    "damage": 160,
    "fireIntervalSec": 4,
    "rangeTiles": 4,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "ground",
    "notes": null
  },
  "deck_cannon": {
    "id": "deck_cannon",
    "name": "Deck Cannon",
    "damage": 100,
    "fireIntervalSec": 4,
    "rangeTiles": 5.5,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "surface",
    "notes": null
  },
  "depth_charge": {
    "id": "depth_charge",
    "name": "Depth Charge",
    "damage": 320,
    "fireIntervalSec": 4,
    "rangeTiles": 5,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "depth charge",
    "targeting": "submerged",
    "notes": null
  },
  "naval_missile": {
    "id": "naval_missile",
    "name": "Naval Missile",
    "damage": 120,
    "fireIntervalSec": 4,
    "rangeTiles": 9,
    "burst": 2,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "surface / air",
    "notes": null
  },
  "heavy_naval_cannon": {
    "id": "heavy_naval_cannon",
    "name": "Heavy Naval Cannon",
    "damage": 2000,
    "fireIntervalSec": 10.667,
    "rangeTiles": 22,
    "burst": 1,
    "damageClass": "high_explosive",
    "projectile": "ballistic shell",
    "targeting": "surface / ground",
    "notes": null
  },
  "torpedo": {
    "id": "torpedo",
    "name": "Torpedo",
    "damage": 360,
    "fireIntervalSec": 4,
    "rangeTiles": 9,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "torpedo",
    "targeting": "surface",
    "notes": null
  },
  "sentry_autocannon": {
    "id": "sentry_autocannon",
    "name": "Sentry Autocannon",
    "damage": 160,
    "fireIntervalSec": 2.667,
    "rangeTiles": 5,
    "burst": 1,
    "damageClass": "small_arms",
    "projectile": "bullet",
    "targeting": "ground",
    "notes": null
  },
  "lance_cannon": {
    "id": "lance_cannon",
    "name": "Lance Cannon",
    "damage": 160,
    "fireIntervalSec": 3.333,
    "rangeTiles": 6,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "shell",
    "targeting": "ground armor",
    "notes": null
  },
  "aa_autocannon": {
    "id": "aa_autocannon",
    "name": "AA Autocannon",
    "damage": 100,
    "fireIntervalSec": 0.667,
    "rangeTiles": 6,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "aa projectile",
    "targeting": "air",
    "notes": null
  },
  "thermal_turret": {
    "id": "thermal_turret",
    "name": "Thermal Turret",
    "damage": 500,
    "fireIntervalSec": 3.333,
    "rangeTiles": 4,
    "burst": 1,
    "damageClass": "thermal",
    "projectile": "fireball",
    "targeting": "ground",
    "notes": null
  },
  "gravity_discharge": {
    "id": "gravity_discharge",
    "name": "Gravity Discharge",
    "damage": 400,
    "fireIntervalSec": 8,
    "rangeTiles": 8.5,
    "burst": 1,
    "damageClass": "universal",
    "projectile": "instant discharge",
    "targeting": "ground",
    "notes": null
  },
  "aa_missile": {
    "id": "aa_missile",
    "name": "AA Missile",
    "damage": 200,
    "fireIntervalSec": 1.333,
    "rangeTiles": 7.5,
    "burst": 1,
    "damageClass": "armor_piercing",
    "projectile": "guided missile",
    "targeting": "air",
    "notes": null
  }
};

export const BUILDINGS: Readonly<Record<string, BuildingDef>> = {
  "assembly_yard": {
    "id": "assembly_yard",
    "name": "Assembly Yard",
    "faction": "both",
    "role": "Base construction / core",
    "cost": 3750,
    "hp": 4000,
    "armor": "heavy",
    "sight": 5,
    "power": 0,
    "stage": "establish",
    "prerequisites": [],
    "buildTimeSec": 120,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Deploys from Assembler.",
    "description": "The core of the base: every other structure is built from it. Deploys from an Assembler."
  },
  "power_plant": {
    "id": "power_plant",
    "name": "Power Plant",
    "faction": "both",
    "role": "Power generation",
    "cost": 450,
    "hp": 1600,
    "armor": "structure",
    "sight": 4,
    "power": 500,
    "stage": "establish",
    "prerequisites": [
      "assembly_yard"
    ],
    "buildTimeSec": 14.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Basic power (+500). Most buildings draw power; run short and they slow down or switch off."
  },
  "reactor_plant": {
    "id": "reactor_plant",
    "name": "Reactor Plant",
    "faction": "both",
    "role": "Advanced power generation",
    "cost": 750,
    "hp": 2800,
    "armor": "structure",
    "sight": 4,
    "power": 1000,
    "stage": "advanced",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 24,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Higher-output power source.",
    "description": "Advanced power (+1000): twice a Power Plant's output for less than twice the price."
  },
  "refinery": {
    "id": "refinery",
    "name": "Refinery",
    "faction": "both",
    "role": "Resource processing",
    "cost": 3000,
    "hp": 3600,
    "armor": "structure",
    "sight": 6,
    "power": -150,
    "stage": "economy",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 96,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Harvester unloads are converted directly into credits. No storage cap.",
    "description": "Harvesters unload ore here; each load turns straight into credits, with no storage limit."
  },
  "barracks": {
    "id": "barracks",
    "name": "Barracks",
    "faction": "both",
    "role": "Infantry production",
    "cost": 450,
    "hp": 3200,
    "armor": "structure",
    "sight": 5,
    "power": -100,
    "stage": "economy",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 14.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Shared gameplay role; faction visuals can diverge.",
    "description": "Trains infantry."
  },
  "motor_works": {
    "id": "motor_works",
    "name": "Motor Works",
    "faction": "both",
    "role": "Ground vehicle production",
    "cost": 3000,
    "hp": 4000,
    "armor": "light",
    "sight": 4,
    "power": -150,
    "stage": "warfare",
    "prerequisites": [
      "refinery"
    ],
    "buildTimeSec": 96,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Builds ground vehicles, including Harvesters and the Assembler."
  },
  "service_bay": {
    "id": "service_bay",
    "name": "Service Bay",
    "faction": "both",
    "role": "Vehicle repair / service",
    "cost": 1800,
    "hp": 3200,
    "armor": "structure",
    "sight": 5,
    "power": -150,
    "stage": "advanced",
    "prerequisites": [
      "motor_works"
    ],
    "buildTimeSec": 57.6,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Repairs and services vehicles."
  },
  "radar": {
    "id": "radar",
    "name": "Radar",
    "faction": "both",
    "role": "Minimap / battlefield intelligence",
    "cost": 1500,
    "hp": 4000,
    "armor": "structure",
    "sight": 10,
    "power": -200,
    "stage": "warfare",
    "prerequisites": [
      "refinery"
    ],
    "buildTimeSec": 48,
    "requiresPower": true,
    "sensors": true,
    "weapons": [],
    "notes": "Stops functioning without adequate power.",
    "description": "Turns on the minimap and battlefield intelligence. Switches off on low power."
  },
  "flight_pad": {
    "id": "flight_pad",
    "name": "Flight Pad",
    "faction": "both",
    "role": "Helicopter production / rearm",
    "cost": 2250,
    "hp": 3200,
    "armor": "structure",
    "sight": 5,
    "power": -50,
    "stage": "advanced",
    "prerequisites": [
      "radar"
    ],
    "buildTimeSec": 72,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "First faction helicopter is bundled with the first pad.",
    "description": "Builds and rearms helicopters; the first pad comes with a helicopter."
  },
  "concrete_barrier": {
    "id": "concrete_barrier",
    "name": "Concrete Barrier",
    "faction": "both",
    "role": "Wall / hard obstruction",
    "cost": 150,
    "hp": 4,
    "armor": "unarmored",
    "sight": 0,
    "power": 0,
    "stage": "warfare",
    "prerequisites": [],
    "buildTimeSec": 4.8,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Special wall interaction; raw HP is not the whole durability model.",
    "description": "Cheap, tough wall that blocks movement."
  },
  "gravity_lab": {
    "id": "gravity_lab",
    "name": "Gravity Lab",
    "faction": "ordan",
    "role": "Advanced technology",
    "cost": 2250,
    "hp": 1600,
    "armor": "structure",
    "sight": 10,
    "power": -1000,
    "stage": "advanced",
    "prerequisites": [
      "motor_works",
      "radar"
    ],
    "buildTimeSec": 72,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Unlocks high-tier Ordan systems.",
    "description": "Advanced technology: unlocks the side's high-tier units and systems."
  },
  "phase_array": {
    "id": "phase_array",
    "name": "Phase Array",
    "faction": "ordan",
    "role": "Strategic mobility system",
    "cost": 4200,
    "hp": 1600,
    "armor": "structure",
    "sight": 10,
    "power": -1000,
    "stage": "strategic",
    "prerequisites": [
      "gravity_lab"
    ],
    "buildTimeSec": 134.4,
    "requiresPower": true,
    "sensors": false,
    "weapons": [],
    "notes": "Strategic support structure.",
    "description": "Late-game strategic mobility structure. Switches off on low power."
  },
  "harbor": {
    "id": "harbor",
    "name": "Harbor",
    "faction": "ordan",
    "role": "Naval production",
    "cost": 975,
    "hp": 4000,
    "armor": "light",
    "sight": 4,
    "power": -150,
    "stage": "warfare",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 31.2,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Water placement.",
    "description": "Builds ships. Placed on water."
  },
  "sentry": {
    "id": "sentry",
    "name": "Sentry",
    "faction": "ordan",
    "role": "Basic anti-infantry defense",
    "cost": 600,
    "hp": 1600,
    "armor": "structure",
    "sight": 5,
    "power": -75,
    "stage": "warfare",
    "prerequisites": [
      "barracks"
    ],
    "buildTimeSec": 19.2,
    "requiresPower": false,
    "sensors": true,
    "weapons": [
      "sentry_autocannon"
    ],
    "notes": null,
    "description": "Basic autocannon turret against infantry."
  },
  "hidden_sentry": {
    "id": "hidden_sentry",
    "name": "Hidden Sentry",
    "faction": "ordan",
    "role": "Camouflaged anti-infantry defense",
    "cost": 900,
    "hp": 2400,
    "armor": "structure",
    "sight": 5,
    "power": -75,
    "stage": "warfare",
    "prerequisites": [
      "barracks"
    ],
    "buildTimeSec": 28.8,
    "requiresPower": false,
    "sensors": true,
    "weapons": [
      "sentry_autocannon"
    ],
    "notes": "Camouflaged defensive variant.",
    "description": "A camouflaged Sentry, hard for the enemy to spot."
  },
  "lance_battery": {
    "id": "lance_battery",
    "name": "Lance Battery",
    "faction": "ordan",
    "role": "Anti-armor defense",
    "cost": 900,
    "hp": 1600,
    "armor": "heavy",
    "sight": 6,
    "power": -200,
    "stage": "warfare",
    "prerequisites": [
      "barracks"
    ],
    "buildTimeSec": 28.8,
    "requiresPower": false,
    "sensors": true,
    "weapons": [
      "lance_cannon"
    ],
    "notes": null,
    "description": "Cannon emplacement against vehicles and armour."
  },
  "flak_array": {
    "id": "flak_array",
    "name": "Flak Array",
    "faction": "ordan",
    "role": "Anti-air defense",
    "cost": 900,
    "hp": 1600,
    "armor": "heavy",
    "sight": 6,
    "power": -250,
    "stage": "advanced",
    "prerequisites": [
      "radar"
    ],
    "buildTimeSec": 28.8,
    "requiresPower": true,
    "sensors": false,
    "weapons": [
      "aa_autocannon",
      "aa_autocannon"
    ],
    "notes": "Stops functioning without adequate power.",
    "description": "Twin anti-aircraft autocannons. Switches off on low power."
  },
  "veil_generator": {
    "id": "veil_generator",
    "name": "Veil Generator",
    "faction": "ordan",
    "role": "Radar / visibility denial",
    "cost": 750,
    "hp": 4000,
    "armor": "structure",
    "sight": 10,
    "power": -300,
    "stage": "advanced",
    "prerequisites": [
      "gravity_lab"
    ],
    "buildTimeSec": 24,
    "requiresPower": true,
    "sensors": false,
    "weapons": [],
    "notes": "Stops functioning without adequate power.",
    "description": "Hides the area around it from enemy radar and sight. Switches off on low power."
  },
  "sandbag_barrier": {
    "id": "sandbag_barrier",
    "name": "Sandbag Barrier",
    "faction": "ordan",
    "role": "Light wall",
    "cost": 37.5,
    "hp": 4,
    "armor": "unarmored",
    "sight": 0,
    "power": 0,
    "stage": "warfare",
    "prerequisites": [],
    "buildTimeSec": 1.2,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Very cheap light wall."
  },
  "decoy_yard": {
    "id": "decoy_yard",
    "name": "Decoy Yard",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "hp": 120,
    "armor": "unarmored",
    "sight": 4,
    "power": -10,
    "stage": "economy",
    "prerequisites": [],
    "buildTimeSec": 2.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Reuses Assembly Yard appearance.",
    "description": "A cheap fake Assembly Yard that draws enemy attention."
  },
  "decoy_motor_works": {
    "id": "decoy_motor_works",
    "name": "Decoy Motor Works",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "hp": 120,
    "armor": "unarmored",
    "sight": 4,
    "power": -10,
    "stage": "warfare",
    "prerequisites": [
      "refinery"
    ],
    "buildTimeSec": 2.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Reuses Motor Works appearance.",
    "description": "A cheap fake Motor Works that draws enemy attention."
  },
  "decoy_harbor": {
    "id": "decoy_harbor",
    "name": "Decoy Harbor",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "hp": 120,
    "armor": "unarmored",
    "sight": 4,
    "power": -10,
    "stage": "warfare",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 2.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Reuses Harbor appearance.",
    "description": "A cheap fake Harbor that draws enemy attention."
  },
  "decoy_radar": {
    "id": "decoy_radar",
    "name": "Decoy Radar",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "hp": 120,
    "armor": "unarmored",
    "sight": 4,
    "power": -10,
    "stage": "warfare",
    "prerequisites": [
      "refinery"
    ],
    "buildTimeSec": 2.4,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Reuses Radar appearance.",
    "description": "A cheap fake Radar that draws enemy attention."
  },
  "gravity_forge": {
    "id": "gravity_forge",
    "name": "Gravity Forge",
    "faction": "sable",
    "role": "Advanced technology",
    "cost": 2250,
    "hp": 2400,
    "armor": "structure",
    "sight": 4,
    "power": -500,
    "stage": "advanced",
    "prerequisites": [
      "motor_works",
      "radar"
    ],
    "buildTimeSec": 72,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Unlocks high-tier Sable systems.",
    "description": "Advanced technology: unlocks the side's high-tier units and systems."
  },
  "lock_field": {
    "id": "lock_field",
    "name": "Lock Field",
    "faction": "sable",
    "role": "Strategic protection system",
    "cost": 4200,
    "hp": 1600,
    "armor": "structure",
    "sight": 10,
    "power": -1000,
    "stage": "strategic",
    "prerequisites": [
      "gravity_forge"
    ],
    "buildTimeSec": 134.4,
    "requiresPower": true,
    "sensors": false,
    "weapons": [],
    "notes": "Strategic support structure.",
    "description": "Late-game strategic protection structure. Switches off on low power."
  },
  "sub_dock": {
    "id": "sub_dock",
    "name": "Sub Dock",
    "faction": "sable",
    "role": "Naval production",
    "cost": 975,
    "hp": 4000,
    "armor": "light",
    "sight": 4,
    "power": -150,
    "stage": "warfare",
    "prerequisites": [
      "power_plant"
    ],
    "buildTimeSec": 31.2,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Water placement.",
    "description": "Builds submarines and landers. Placed on water."
  },
  "incinerator": {
    "id": "incinerator",
    "name": "Incinerator",
    "faction": "sable",
    "role": "Anti-infantry defense",
    "cost": 900,
    "hp": 1600,
    "armor": "heavy",
    "sight": 6,
    "power": -100,
    "stage": "warfare",
    "prerequisites": [
      "barracks"
    ],
    "buildTimeSec": 28.8,
    "requiresPower": false,
    "sensors": true,
    "weapons": [
      "thermal_turret"
    ],
    "notes": null,
    "description": "Thermal turret that burns infantry."
  },
  "anchor": {
    "id": "anchor",
    "name": "Anchor",
    "faction": "sable",
    "role": "Advanced anti-ground defense",
    "cost": 2250,
    "hp": 1600,
    "armor": "heavy",
    "sight": 8,
    "power": -750,
    "stage": "advanced",
    "prerequisites": [
      "motor_works"
    ],
    "buildTimeSec": 72,
    "requiresPower": true,
    "sensors": true,
    "weapons": [
      "gravity_discharge"
    ],
    "notes": "Stops functioning without adequate power.",
    "description": "Heavy gravity-discharge weapon against ground forces. Switches off on low power."
  },
  "sky_lance": {
    "id": "sky_lance",
    "name": "Sky Lance",
    "faction": "sable",
    "role": "Anti-air missile defense",
    "cost": 1125,
    "hp": 1600,
    "armor": "heavy",
    "sight": 5,
    "power": -100,
    "stage": "advanced",
    "prerequisites": [
      "radar"
    ],
    "buildTimeSec": 36,
    "requiresPower": false,
    "sensors": false,
    "weapons": [
      "aa_missile"
    ],
    "notes": null,
    "description": "Missile launcher against aircraft."
  },
  "airfield": {
    "id": "airfield",
    "name": "Airfield",
    "faction": "sable",
    "role": "Fixed-wing aircraft production / support",
    "cost": 900,
    "hp": 4000,
    "armor": "heavy",
    "sight": 7,
    "power": -150,
    "stage": "advanced",
    "prerequisites": [
      "radar"
    ],
    "buildTimeSec": 28.8,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Provides aircraft and air-support abilities.",
    "description": "Builds and supports fixed-wing aircraft, and gives air-support abilities."
  },
  "hound_kennel": {
    "id": "hound_kennel",
    "name": "Hound Kennel",
    "faction": "sable",
    "role": "Hound production",
    "cost": 300,
    "hp": 1600,
    "armor": "structure",
    "sight": 4,
    "power": -50,
    "stage": "warfare",
    "prerequisites": [
      "barracks"
    ],
    "buildTimeSec": 9.6,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Produces Hounds."
  },
  "wire_barrier": {
    "id": "wire_barrier",
    "name": "Wire Barrier",
    "faction": "sable",
    "role": "Light wall",
    "cost": 37.5,
    "hp": 4,
    "armor": "unarmored",
    "sight": 0,
    "power": 0,
    "stage": "warfare",
    "prerequisites": [],
    "buildTimeSec": 1.2,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": null,
    "description": "Very cheap light wall."
  },
  "strategic_silo": {
    "id": "strategic_silo",
    "name": "Strategic Silo",
    "faction": "sable",
    "role": "Strategic missile system",
    "cost": 3750,
    "hp": 1600,
    "armor": "heavy",
    "sight": 5,
    "power": -500,
    "stage": "strategic",
    "prerequisites": [
      "gravity_forge"
    ],
    "buildTimeSec": 120,
    "requiresPower": false,
    "sensors": false,
    "weapons": [],
    "notes": "Strategic support structure.",
    "description": "Late-game strategic missile: a long-range strike that can end a match."
  }
};

export const UNITS: Readonly<Record<string, UnitDef>> = {
  "rifleman": {
    "id": "rifleman",
    "name": "Rifleman",
    "faction": "both",
    "category": "Infantry",
    "role": "Cheap frontline / anti-infantry",
    "cost": 150,
    "hp": 200,
    "armor": "unarmored",
    "speed": 4,
    "sight": 4,
    "stage": "establish",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [],
    "buildTimeSec": 4.8,
    "weapons": [
      "service_rifle"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": null,
    "description": "Cheap frontline infantry with a service rifle; best against other infantry."
  },
  "lancer": {
    "id": "lancer",
    "name": "Lancer",
    "faction": "both",
    "category": "Infantry",
    "role": "Anti-air / anti-armor infantry",
    "cost": 450,
    "hp": 180,
    "armor": "unarmored",
    "speed": 3,
    "sight": 4,
    "stage": "warfare",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [],
    "buildTimeSec": 14.4,
    "weapons": [
      "sky_missile",
      "armor_missile"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": null,
    "description": "Missile infantry that hits both armour and aircraft."
  },
  "engineer": {
    "id": "engineer",
    "name": "Engineer",
    "faction": "both",
    "category": "Infantry",
    "role": "Capture / repair / interact",
    "cost": 750,
    "hp": 100,
    "armor": "unarmored",
    "speed": 4,
    "sight": 4,
    "stage": "warfare",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [],
    "buildTimeSec": 24,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Can enter structures for capture/repair interactions.",
    "description": "Unarmed; enters buildings to capture or repair them."
  },
  "operator": {
    "id": "operator",
    "name": "Operator",
    "faction": "both",
    "category": "Infantry",
    "role": "Elite specialist / demolition",
    "cost": 1800,
    "hp": 400,
    "armor": "unarmored",
    "speed": 5,
    "sight": 6,
    "stage": "advanced",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_lab",
        "gravity_forge"
      ]
    ],
    "buildTimeSec": 57.6,
    "weapons": [
      "precision_sidearm",
      "precision_sidearm"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Can infiltrate and demolish structures.",
    "description": "Elite specialist who can infiltrate and demolish structures."
  },
  "harvester": {
    "id": "harvester",
    "name": "Harvester",
    "faction": "both",
    "category": "Support Vehicle",
    "role": "Resource collection",
    "cost": 2100,
    "hp": 2400,
    "armor": "heavy",
    "speed": 6,
    "sight": 4,
    "stage": "economy",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "refinery"
      ]
    ],
    "buildTimeSec": 67.2,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Refinery completion grants one. Economic behavior may later differ by faction without changing the core resource loop.",
    "description": "Collects ore and brings it to a Refinery; the first comes free with each Refinery."
  },
  "assembler": {
    "id": "assembler",
    "name": "Assembler",
    "faction": "both",
    "category": "Support Vehicle",
    "role": "Deploys a new Assembly Yard",
    "cost": 3750,
    "hp": 2400,
    "armor": "light",
    "speed": 6,
    "sight": 4,
    "stage": "strategic",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "service_bay"
      ]
    ],
    "buildTimeSec": 120,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Deploys into Assembly Yard.",
    "description": "Drives out and deploys into a new Assembly Yard, to start another base."
  },
  "seeder": {
    "id": "seeder",
    "name": "Seeder",
    "faction": "both",
    "category": "Support Vehicle",
    "role": "Mine layer",
    "cost": 1200,
    "hp": 400,
    "armor": "heavy",
    "speed": 9,
    "sight": 5,
    "stage": "advanced",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "service_bay"
      ]
    ],
    "buildTimeSec": 38.4,
    "weapons": [],
    "ammo": 5,
    "passengers": 0,
    "notes": "Carries 5 mines.",
    "description": "Lays mines (carries 5)."
  },
  "lander": {
    "id": "lander",
    "name": "Lander",
    "faction": "both",
    "category": "Naval",
    "role": "Amphibious transport",
    "cost": 1050,
    "hp": 1400,
    "armor": "heavy",
    "speed": 14,
    "sight": 6,
    "stage": "warfare",
    "producedAt": [
      "harbor",
      "sub_dock"
    ],
    "prerequisites": [],
    "buildTimeSec": 33.6,
    "weapons": [],
    "ammo": null,
    "passengers": 5,
    "notes": "Carries 5 passengers.",
    "description": "Amphibious transport for 5 passengers."
  },
  "medic": {
    "id": "medic",
    "name": "Medic",
    "faction": "ordan",
    "category": "Infantry",
    "role": "Infantry healing",
    "cost": 1200,
    "hp": 320,
    "armor": "unarmored",
    "speed": 4,
    "sight": 3,
    "stage": "warfare",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [],
    "buildTimeSec": 38.4,
    "weapons": [
      "field_heal"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Heals infantry.",
    "description": "Heals nearby infantry."
  },
  "infiltrator": {
    "id": "infiltrator",
    "name": "Infiltrator",
    "faction": "ordan",
    "category": "Infantry",
    "role": "Intelligence / infiltration",
    "cost": 750,
    "hp": 100,
    "armor": "unarmored",
    "speed": 4,
    "sight": 5,
    "stage": "advanced",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ],
    "buildTimeSec": 24,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Can infiltrate structures.",
    "description": "Slips into enemy structures to gather intelligence."
  },
  "raider": {
    "id": "raider",
    "name": "Raider",
    "faction": "ordan",
    "category": "Infantry",
    "role": "Economic infiltration",
    "cost": 750,
    "hp": 100,
    "armor": "unarmored",
    "speed": 4,
    "sight": 5,
    "stage": "advanced",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ],
    "buildTimeSec": 24,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Can infiltrate economic structures.",
    "description": "Infiltrates enemy economic structures."
  },
  "hound": {
    "id": "hound",
    "name": "Hound",
    "faction": "sable",
    "category": "Infantry",
    "role": "Fast anti-infantry hunter",
    "cost": 300,
    "hp": 48,
    "armor": "unarmored",
    "speed": 4,
    "sight": 5,
    "stage": "warfare",
    "producedAt": [
      "hound_kennel"
    ],
    "prerequisites": [],
    "buildTimeSec": 9.6,
    "weapons": [
      "hound_strike"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Special anti-personnel targeting logic.",
    "description": "Fast hunter that runs down infantry."
  },
  "grenadier": {
    "id": "grenadier",
    "name": "Grenadier",
    "faction": "sable",
    "category": "Infantry",
    "role": "Explosive anti-infantry / structure",
    "cost": 240,
    "hp": 200,
    "armor": "unarmored",
    "speed": 5,
    "sight": 4,
    "stage": "establish",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [],
    "buildTimeSec": 7.68,
    "weapons": [
      "frag_grenade"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Explodes violently when killed.",
    "description": "Throws fragmentation grenades at infantry and structures; explodes violently when killed."
  },
  "breaker": {
    "id": "breaker",
    "name": "Breaker",
    "faction": "sable",
    "category": "Infantry",
    "role": "Short-range thermal assault",
    "cost": 450,
    "hp": 160,
    "armor": "unarmored",
    "speed": 3,
    "sight": 4,
    "stage": "advanced",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_forge"
      ]
    ],
    "buildTimeSec": 14.4,
    "weapons": [
      "thermal_projector"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Explodes violently when killed.",
    "description": "Short-range thermal assault infantry; explodes violently when killed."
  },
  "skimmer": {
    "id": "skimmer",
    "name": "Skimmer",
    "faction": "ordan",
    "category": "Combat Vehicle",
    "role": "Fast scout / light anti-infantry",
    "cost": 900,
    "hp": 600,
    "armor": "light",
    "speed": 10,
    "sight": 6,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [],
    "buildTimeSec": 28.8,
    "weapons": [
      "light_autocannon"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": null,
    "description": "Fast scout with a light autocannon, good against infantry."
  },
  "jackal": {
    "id": "jackal",
    "name": "Jackal",
    "faction": "ordan",
    "category": "Combat Vehicle",
    "role": "Light armor",
    "cost": 1050,
    "hp": 1200,
    "armor": "heavy",
    "speed": 9,
    "sight": 4,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [],
    "buildTimeSec": 33.6,
    "weapons": [
      "light_cannon"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Tracked.",
    "description": "Light tracked tank."
  },
  "ram": {
    "id": "ram",
    "name": "Ram",
    "faction": "ordan",
    "category": "Combat Vehicle",
    "role": "Main battle armor",
    "cost": 1200,
    "hp": 1600,
    "armor": "heavy",
    "speed": 8,
    "sight": 5,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [],
    "buildTimeSec": 38.4,
    "weapons": [
      "battle_cannon"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Tracked.",
    "description": "Main battle tank."
  },
  "carrier": {
    "id": "carrier",
    "name": "Carrier",
    "faction": "ordan",
    "category": "Combat Vehicle",
    "role": "Infantry transport",
    "cost": 1200,
    "hp": 800,
    "armor": "heavy",
    "speed": 10,
    "sight": 5,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "barracks"
      ]
    ],
    "buildTimeSec": 38.4,
    "weapons": [
      "light_autocannon"
    ],
    "ammo": null,
    "passengers": 5,
    "notes": "Carries 5 passengers. Tracked.",
    "description": "Tracked transport for 5 infantry, with a light autocannon."
  },
  "spire": {
    "id": "spire",
    "name": "Spire",
    "faction": "ordan",
    "category": "Combat Vehicle",
    "role": "Long-range artillery",
    "cost": 900,
    "hp": 300,
    "armor": "light",
    "speed": 6,
    "sight": 5,
    "stage": "advanced",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [],
    "buildTimeSec": 28.8,
    "weapons": [
      "siege_artillery"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Must stop to fire. Tracked.",
    "description": "Long-range artillery; must stop to fire."
  },
  "watcher": {
    "id": "watcher",
    "name": "Watcher",
    "faction": "ordan",
    "category": "Support Vehicle",
    "role": "Mobile radar disruption",
    "cost": 900,
    "hp": 440,
    "armor": "light",
    "speed": 9,
    "sight": 7,
    "stage": "advanced",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ],
    "buildTimeSec": 28.8,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Electronic disruption support.",
    "description": "Disrupts enemy radar around it."
  },
  "shroud": {
    "id": "shroud",
    "name": "Shroud",
    "faction": "ordan",
    "category": "Support Vehicle",
    "role": "Mobile visibility denial",
    "cost": 900,
    "hp": 440,
    "armor": "light",
    "speed": 9,
    "sight": 4,
    "stage": "advanced",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ],
    "buildTimeSec": 28.8,
    "weapons": [],
    "ammo": null,
    "passengers": 0,
    "notes": "Mobile concealment support.",
    "description": "Hides nearby units from enemy sight."
  },
  "goliath": {
    "id": "goliath",
    "name": "Goliath",
    "faction": "sable",
    "category": "Combat Vehicle",
    "role": "Heavy armor",
    "cost": 1425,
    "hp": 1600,
    "armor": "heavy",
    "speed": 7,
    "sight": 5,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [],
    "buildTimeSec": 45.6,
    "weapons": [
      "heavy_cannon",
      "heavy_cannon"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Tracked; twin-gun loadout.",
    "description": "Heavy twin-gun tank."
  },
  "anvil": {
    "id": "anvil",
    "name": "Anvil",
    "faction": "sable",
    "category": "Combat Vehicle",
    "role": "Late heavy assault",
    "cost": 2550,
    "hp": 2400,
    "armor": "heavy",
    "speed": 4,
    "sight": 6,
    "stage": "advanced",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "gravity_forge"
      ]
    ],
    "buildTimeSec": 81.6,
    "weapons": [
      "anvil_cannon",
      "support_missiles"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Self-heals up to half health. Tracked.",
    "description": "Late-game heavy assault tank that heals itself up to half health."
  },
  "salvo": {
    "id": "salvo",
    "name": "Salvo",
    "faction": "sable",
    "category": "Combat Vehicle",
    "role": "Long-range missile artillery",
    "cost": 1050,
    "hp": 600,
    "armor": "light",
    "speed": 7,
    "sight": 5,
    "stage": "warfare",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ],
    "buildTimeSec": 33.6,
    "weapons": [
      "siege_missile"
    ],
    "ammo": 1,
    "passengers": 0,
    "notes": "Carries one missile and must stop to fire. Tracked.",
    "description": "Long-range missile artillery: one missile at a time, and it must stop to fire."
  },
  "drift": {
    "id": "drift",
    "name": "Drift",
    "faction": "ordan",
    "category": "Aircraft",
    "role": "Attack helicopter",
    "cost": 1800,
    "hp": 900,
    "armor": "heavy",
    "speed": 16,
    "sight": 0,
    "stage": "advanced",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": [],
    "buildTimeSec": 57.6,
    "weapons": [
      "attack_missile",
      "attack_missile"
    ],
    "ammo": 6,
    "passengers": 0,
    "notes": "First one is bundled with the first Flight Pad.",
    "description": "Attack helicopter with missiles; the first comes with the first Flight Pad."
  },
  "shrike": {
    "id": "shrike",
    "name": "Shrike",
    "faction": "sable",
    "category": "Aircraft",
    "role": "Ground-attack aircraft",
    "cost": 1200,
    "hp": 240,
    "armor": "light",
    "speed": 16,
    "sight": 0,
    "stage": "advanced",
    "producedAt": [
      "airfield"
    ],
    "prerequisites": [],
    "buildTimeSec": 38.4,
    "weapons": [
      "rotary_cannon",
      "rotary_cannon"
    ],
    "ammo": 15,
    "passengers": 0,
    "notes": null,
    "description": "Ground-attack aircraft with rotary cannons."
  },
  "interceptor": {
    "id": "interceptor",
    "name": "Interceptor",
    "faction": "sable",
    "category": "Aircraft",
    "role": "Fast strike aircraft",
    "cost": 1800,
    "hp": 200,
    "armor": "light",
    "speed": 20,
    "sight": 0,
    "stage": "advanced",
    "producedAt": [
      "airfield"
    ],
    "prerequisites": [],
    "buildTimeSec": 57.6,
    "weapons": [
      "strike_missile",
      "strike_missile"
    ],
    "ammo": 3,
    "passengers": 0,
    "notes": null,
    "description": "Fast strike aircraft with missiles."
  },
  "lifter": {
    "id": "lifter",
    "name": "Lifter",
    "faction": "sable",
    "category": "Aircraft",
    "role": "Transport helicopter",
    "cost": 1800,
    "hp": 360,
    "armor": "light",
    "speed": 12,
    "sight": 0,
    "stage": "advanced",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": [],
    "buildTimeSec": 57.6,
    "weapons": [],
    "ammo": null,
    "passengers": 5,
    "notes": "Carries 5 passengers.",
    "description": "Transport helicopter for 5 passengers."
  },
  "hammer": {
    "id": "hammer",
    "name": "Hammer",
    "faction": "sable",
    "category": "Aircraft",
    "role": "Attack gunship",
    "cost": 1800,
    "hp": 900,
    "armor": "heavy",
    "speed": 12,
    "sight": 0,
    "stage": "advanced",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": [],
    "buildTimeSec": 57.6,
    "weapons": [
      "rotary_cannon"
    ],
    "ammo": 12,
    "passengers": 0,
    "notes": "First one is bundled with the first Flight Pad.",
    "description": "Heavy attack gunship; the first comes with the first Flight Pad."
  },
  "cutter": {
    "id": "cutter",
    "name": "Cutter",
    "faction": "ordan",
    "category": "Naval",
    "role": "Fast patrol / anti-sub",
    "cost": 750,
    "hp": 800,
    "armor": "heavy",
    "speed": 9,
    "sight": 7,
    "stage": "warfare",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": [],
    "buildTimeSec": 24,
    "weapons": [
      "deck_cannon",
      "depth_charge"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Detects submerged units.",
    "description": "Fast patrol boat that hunts submarines."
  },
  "warden": {
    "id": "warden",
    "name": "Warden",
    "faction": "ordan",
    "category": "Naval",
    "role": "Missile destroyer / anti-sub",
    "cost": 1500,
    "hp": 1600,
    "armor": "heavy",
    "speed": 6,
    "sight": 6,
    "stage": "advanced",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": [],
    "buildTimeSec": 48,
    "weapons": [
      "naval_missile",
      "depth_charge"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Detects submerged units.",
    "description": "Missile destroyer that also hunts submarines."
  },
  "bastion": {
    "id": "bastion",
    "name": "Bastion",
    "faction": "ordan",
    "category": "Naval",
    "role": "Heavy long-range warship",
    "cost": 3000,
    "hp": 2800,
    "armor": "heavy",
    "speed": 4,
    "sight": 7,
    "stage": "advanced",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ],
    "buildTimeSec": 96,
    "weapons": [
      "heavy_naval_cannon",
      "heavy_naval_cannon"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Detects submerged units.",
    "description": "Heavy long-range warship."
  },
  "wraith": {
    "id": "wraith",
    "name": "Wraith",
    "faction": "sable",
    "category": "Naval",
    "role": "Stealth submarine",
    "cost": 1425,
    "hp": 480,
    "armor": "light",
    "speed": 6,
    "sight": 6,
    "stage": "warfare",
    "producedAt": [
      "sub_dock"
    ],
    "prerequisites": [],
    "buildTimeSec": 45.6,
    "weapons": [
      "torpedo"
    ],
    "ammo": null,
    "passengers": 0,
    "notes": "Submerged / cloaked behavior.",
    "description": "Stealth submarine that strikes with torpedoes."
  }
};

export const ABILITIES: Readonly<Record<string, AbilityDef>> = {
  "phase_shift": {
    "id": "phase_shift",
    "name": "Phase Shift",
    "faction": "ordan",
    "grantedBy": "phase_array",
    "rechargeSec": 420,
    "notes": "Temporarily relocates a target unit."
  },
  "global_reveal": {
    "id": "global_reveal",
    "name": "Global Reveal",
    "faction": "ordan",
    "grantedBy": "gravity_lab",
    "rechargeSec": 480,
    "notes": "Reveals battlefield information globally."
  },
  "lock_field": {
    "id": "lock_field",
    "name": "Lock Field",
    "faction": "sable",
    "grantedBy": "lock_field",
    "rechargeSec": 660,
    "notes": "Temporary invulnerability effect; duration 45 seconds."
  },
  "recon_flight": {
    "id": "recon_flight",
    "name": "Recon Flight",
    "faction": "sable",
    "grantedBy": "airfield",
    "rechargeSec": 180,
    "notes": "Temporary aerial reconnaissance pass."
  },
  "drop_team": {
    "id": "drop_team",
    "name": "Drop Team",
    "faction": "sable",
    "grantedBy": "airfield",
    "rechargeSec": 420,
    "notes": "Air-delivered infantry support."
  },
  "air_bombardment": {
    "id": "air_bombardment",
    "name": "Air Bombardment",
    "faction": "sable",
    "grantedBy": "airfield",
    "rechargeSec": 840,
    "notes": "Air-delivered bombing support."
  },
  "strategic_missile": {
    "id": "strategic_missile",
    "name": "Strategic Missile",
    "faction": "sable",
    "grantedBy": "strategic_silo",
    "rechargeSec": 780,
    "notes": "High-damage strategic strike."
  }
};

export const FACTION_NAMES = [
  "Ordan",
  "Sable"
] as const;
