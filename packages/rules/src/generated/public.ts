// GENERATED from design/balance.xlsx by scripts/import-balance.mjs. Do not edit; edit the spreadsheet and re-run `npm run import`.
/* eslint-disable */
import type { PublicBuildingDef, PublicUnitDef } from '../public-types.js';

/** Safe to ship to the browser: only what the UI shows. Full rules stay on the server. */
export const PUBLIC_BUILDINGS: Readonly<Record<string, PublicBuildingDef>> = {
  "assembly_yard": {
    "id": "assembly_yard",
    "name": "Assembly Yard",
    "faction": "both",
    "role": "Base construction / core",
    "cost": 3750,
    "stage": "establish",
    "buildTimeSec": 120,
    "description": "The core of the base: every other structure is built from it. Deploys from an Assembler.",
    "power": 0,
    "prerequisites": []
  },
  "power_plant": {
    "id": "power_plant",
    "name": "Power Plant",
    "faction": "both",
    "role": "Power generation",
    "cost": 450,
    "stage": "establish",
    "buildTimeSec": 14.4,
    "description": "Basic power (+500). Most buildings draw power; run short and they slow down or switch off.",
    "power": 500,
    "prerequisites": [
      "assembly_yard"
    ]
  },
  "reactor_plant": {
    "id": "reactor_plant",
    "name": "Reactor Plant",
    "faction": "both",
    "role": "Advanced power generation",
    "cost": 750,
    "stage": "advanced",
    "buildTimeSec": 24,
    "description": "Advanced power (+1000): twice a Power Plant's output for less than twice the price.",
    "power": 1000,
    "prerequisites": [
      "power_plant"
    ]
  },
  "refinery": {
    "id": "refinery",
    "name": "Refinery",
    "faction": "both",
    "role": "Resource processing",
    "cost": 3000,
    "stage": "economy",
    "buildTimeSec": 96,
    "description": "Harvesters unload ore here; each load turns straight into credits, with no storage limit.",
    "power": -150,
    "prerequisites": [
      "power_plant"
    ]
  },
  "barracks": {
    "id": "barracks",
    "name": "Barracks",
    "faction": "both",
    "role": "Infantry production",
    "cost": 450,
    "stage": "economy",
    "buildTimeSec": 14.4,
    "description": "Trains infantry.",
    "power": -100,
    "prerequisites": [
      "power_plant"
    ]
  },
  "motor_works": {
    "id": "motor_works",
    "name": "Motor Works",
    "faction": "both",
    "role": "Ground vehicle production",
    "cost": 3000,
    "stage": "warfare",
    "buildTimeSec": 96,
    "description": "Builds ground vehicles, including Harvesters and the Assembler.",
    "power": -150,
    "prerequisites": [
      "refinery"
    ]
  },
  "service_bay": {
    "id": "service_bay",
    "name": "Service Bay",
    "faction": "both",
    "role": "Vehicle repair / service",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Repairs and services vehicles.",
    "power": -150,
    "prerequisites": [
      "motor_works"
    ]
  },
  "radar": {
    "id": "radar",
    "name": "Radar",
    "faction": "both",
    "role": "Minimap / battlefield intelligence",
    "cost": 1500,
    "stage": "warfare",
    "buildTimeSec": 48,
    "description": "Turns on the minimap and battlefield intelligence. Switches off on low power.",
    "power": -200,
    "prerequisites": [
      "refinery"
    ]
  },
  "flight_pad": {
    "id": "flight_pad",
    "name": "Flight Pad",
    "faction": "both",
    "role": "Helicopter production / rearm",
    "cost": 2250,
    "stage": "advanced",
    "buildTimeSec": 72,
    "description": "Builds and rearms helicopters; the first pad comes with a helicopter.",
    "power": -50,
    "prerequisites": [
      "radar"
    ]
  },
  "concrete_barrier": {
    "id": "concrete_barrier",
    "name": "Concrete Barrier",
    "faction": "both",
    "role": "Wall / hard obstruction",
    "cost": 150,
    "stage": "warfare",
    "buildTimeSec": 4.8,
    "description": "Cheap, tough wall that blocks movement.",
    "power": 0,
    "prerequisites": []
  },
  "gravity_lab": {
    "id": "gravity_lab",
    "name": "Gravity Lab",
    "faction": "ordan",
    "role": "Advanced technology",
    "cost": 2250,
    "stage": "advanced",
    "buildTimeSec": 72,
    "description": "Advanced technology: unlocks the side's high-tier units and systems.",
    "power": -1000,
    "prerequisites": [
      "motor_works",
      "radar"
    ]
  },
  "phase_array": {
    "id": "phase_array",
    "name": "Phase Array",
    "faction": "ordan",
    "role": "Strategic mobility system",
    "cost": 4200,
    "stage": "strategic",
    "buildTimeSec": 134.4,
    "description": "Late-game strategic mobility structure. Switches off on low power.",
    "power": -1000,
    "prerequisites": [
      "gravity_lab"
    ]
  },
  "harbor": {
    "id": "harbor",
    "name": "Harbor",
    "faction": "ordan",
    "role": "Naval production",
    "cost": 975,
    "stage": "warfare",
    "buildTimeSec": 31.2,
    "description": "Builds ships. Placed on water.",
    "power": -150,
    "prerequisites": [
      "power_plant"
    ]
  },
  "sentry": {
    "id": "sentry",
    "name": "Sentry",
    "faction": "ordan",
    "role": "Basic anti-infantry defense",
    "cost": 600,
    "stage": "warfare",
    "buildTimeSec": 19.2,
    "description": "Basic autocannon turret against infantry.",
    "power": -75,
    "prerequisites": [
      "barracks"
    ]
  },
  "hidden_sentry": {
    "id": "hidden_sentry",
    "name": "Hidden Sentry",
    "faction": "ordan",
    "role": "Camouflaged anti-infantry defense",
    "cost": 900,
    "stage": "warfare",
    "buildTimeSec": 28.8,
    "description": "A camouflaged Sentry, hard for the enemy to spot.",
    "power": -75,
    "prerequisites": [
      "barracks"
    ]
  },
  "lance_battery": {
    "id": "lance_battery",
    "name": "Lance Battery",
    "faction": "ordan",
    "role": "Anti-armor defense",
    "cost": 900,
    "stage": "warfare",
    "buildTimeSec": 28.8,
    "description": "Cannon emplacement against vehicles and armour.",
    "power": -200,
    "prerequisites": [
      "barracks"
    ]
  },
  "flak_array": {
    "id": "flak_array",
    "name": "Flak Array",
    "faction": "ordan",
    "role": "Anti-air defense",
    "cost": 900,
    "stage": "advanced",
    "buildTimeSec": 28.8,
    "description": "Twin anti-aircraft autocannons. Switches off on low power.",
    "power": -250,
    "prerequisites": [
      "radar"
    ]
  },
  "veil_generator": {
    "id": "veil_generator",
    "name": "Veil Generator",
    "faction": "ordan",
    "role": "Radar / visibility denial",
    "cost": 750,
    "stage": "advanced",
    "buildTimeSec": 24,
    "description": "Hides the area around it from enemy radar and sight. Switches off on low power.",
    "power": -300,
    "prerequisites": [
      "gravity_lab"
    ]
  },
  "sandbag_barrier": {
    "id": "sandbag_barrier",
    "name": "Sandbag Barrier",
    "faction": "ordan",
    "role": "Light wall",
    "cost": 37.5,
    "stage": "warfare",
    "buildTimeSec": 1.2,
    "description": "Very cheap light wall.",
    "power": 0,
    "prerequisites": []
  },
  "decoy_yard": {
    "id": "decoy_yard",
    "name": "Decoy Yard",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "stage": "economy",
    "buildTimeSec": 2.4,
    "description": "A cheap fake Assembly Yard that draws enemy attention.",
    "power": -10,
    "prerequisites": []
  },
  "decoy_motor_works": {
    "id": "decoy_motor_works",
    "name": "Decoy Motor Works",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "stage": "warfare",
    "buildTimeSec": 2.4,
    "description": "A cheap fake Motor Works that draws enemy attention.",
    "power": -10,
    "prerequisites": [
      "refinery"
    ]
  },
  "decoy_harbor": {
    "id": "decoy_harbor",
    "name": "Decoy Harbor",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "stage": "warfare",
    "buildTimeSec": 2.4,
    "description": "A cheap fake Harbor that draws enemy attention.",
    "power": -10,
    "prerequisites": [
      "power_plant"
    ]
  },
  "decoy_radar": {
    "id": "decoy_radar",
    "name": "Decoy Radar",
    "faction": "ordan",
    "role": "Deception structure",
    "cost": 75,
    "stage": "warfare",
    "buildTimeSec": 2.4,
    "description": "A cheap fake Radar that draws enemy attention.",
    "power": -10,
    "prerequisites": [
      "refinery"
    ]
  },
  "gravity_forge": {
    "id": "gravity_forge",
    "name": "Gravity Forge",
    "faction": "sable",
    "role": "Advanced technology",
    "cost": 2250,
    "stage": "advanced",
    "buildTimeSec": 72,
    "description": "Advanced technology: unlocks the side's high-tier units and systems.",
    "power": -500,
    "prerequisites": [
      "motor_works",
      "radar"
    ]
  },
  "lock_field": {
    "id": "lock_field",
    "name": "Lock Field",
    "faction": "sable",
    "role": "Strategic protection system",
    "cost": 4200,
    "stage": "strategic",
    "buildTimeSec": 134.4,
    "description": "Late-game strategic protection structure. Switches off on low power.",
    "power": -1000,
    "prerequisites": [
      "gravity_forge"
    ]
  },
  "sub_dock": {
    "id": "sub_dock",
    "name": "Sub Dock",
    "faction": "sable",
    "role": "Naval production",
    "cost": 975,
    "stage": "warfare",
    "buildTimeSec": 31.2,
    "description": "Builds submarines and landers. Placed on water.",
    "power": -150,
    "prerequisites": [
      "power_plant"
    ]
  },
  "incinerator": {
    "id": "incinerator",
    "name": "Incinerator",
    "faction": "sable",
    "role": "Anti-infantry defense",
    "cost": 900,
    "stage": "warfare",
    "buildTimeSec": 28.8,
    "description": "Thermal turret that burns infantry.",
    "power": -100,
    "prerequisites": [
      "barracks"
    ]
  },
  "anchor": {
    "id": "anchor",
    "name": "Anchor",
    "faction": "sable",
    "role": "Advanced anti-ground defense",
    "cost": 2250,
    "stage": "advanced",
    "buildTimeSec": 72,
    "description": "Heavy gravity-discharge weapon against ground forces. Switches off on low power.",
    "power": -750,
    "prerequisites": [
      "motor_works"
    ]
  },
  "sky_lance": {
    "id": "sky_lance",
    "name": "Sky Lance",
    "faction": "sable",
    "role": "Anti-air missile defense",
    "cost": 1125,
    "stage": "advanced",
    "buildTimeSec": 36,
    "description": "Missile launcher against aircraft.",
    "power": -100,
    "prerequisites": [
      "radar"
    ]
  },
  "airfield": {
    "id": "airfield",
    "name": "Airfield",
    "faction": "sable",
    "role": "Fixed-wing aircraft production / support",
    "cost": 900,
    "stage": "advanced",
    "buildTimeSec": 28.8,
    "description": "Builds and supports fixed-wing aircraft, and gives air-support abilities.",
    "power": -150,
    "prerequisites": [
      "radar"
    ]
  },
  "hound_kennel": {
    "id": "hound_kennel",
    "name": "Hound Kennel",
    "faction": "sable",
    "role": "Hound production",
    "cost": 300,
    "stage": "warfare",
    "buildTimeSec": 9.6,
    "description": "Produces Hounds.",
    "power": -50,
    "prerequisites": [
      "barracks"
    ]
  },
  "wire_barrier": {
    "id": "wire_barrier",
    "name": "Wire Barrier",
    "faction": "sable",
    "role": "Light wall",
    "cost": 37.5,
    "stage": "warfare",
    "buildTimeSec": 1.2,
    "description": "Very cheap light wall.",
    "power": 0,
    "prerequisites": []
  },
  "strategic_silo": {
    "id": "strategic_silo",
    "name": "Strategic Silo",
    "faction": "sable",
    "role": "Strategic missile system",
    "cost": 3750,
    "stage": "strategic",
    "buildTimeSec": 120,
    "description": "Late-game strategic missile: a long-range strike that can end a match.",
    "power": -500,
    "prerequisites": [
      "gravity_forge"
    ]
  }
};

export const PUBLIC_UNITS: Readonly<Record<string, PublicUnitDef>> = {
  "rifleman": {
    "id": "rifleman",
    "name": "Rifleman",
    "faction": "both",
    "role": "Cheap frontline / anti-infantry",
    "cost": 150,
    "stage": "establish",
    "buildTimeSec": 4.8,
    "description": "Cheap frontline infantry with a service rifle; best against other infantry.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": []
  },
  "lancer": {
    "id": "lancer",
    "name": "Lancer",
    "faction": "both",
    "role": "Anti-air / anti-armor infantry",
    "cost": 450,
    "stage": "warfare",
    "buildTimeSec": 14.4,
    "description": "Missile infantry that hits both armour and aircraft.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": []
  },
  "engineer": {
    "id": "engineer",
    "name": "Engineer",
    "faction": "both",
    "role": "Capture / repair / interact",
    "cost": 750,
    "stage": "warfare",
    "buildTimeSec": 24,
    "description": "Unarmed; enters buildings to capture or repair them.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": []
  },
  "operator": {
    "id": "operator",
    "name": "Operator",
    "faction": "both",
    "role": "Elite specialist / demolition",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Elite specialist who can infiltrate and demolish structures.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_lab",
        "gravity_forge"
      ]
    ]
  },
  "harvester": {
    "id": "harvester",
    "name": "Harvester",
    "faction": "both",
    "role": "Resource collection",
    "cost": 2100,
    "stage": "economy",
    "buildTimeSec": 67.2,
    "description": "Collects ore and brings it to a Refinery; the first comes free with each Refinery.",
    "category": "Support Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "refinery"
      ]
    ]
  },
  "assembler": {
    "id": "assembler",
    "name": "Assembler",
    "faction": "both",
    "role": "Deploys a new Assembly Yard",
    "cost": 3750,
    "stage": "strategic",
    "buildTimeSec": 120,
    "description": "Drives out and deploys into a new Assembly Yard, to start another base.",
    "category": "Support Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "service_bay"
      ]
    ]
  },
  "seeder": {
    "id": "seeder",
    "name": "Seeder",
    "faction": "both",
    "role": "Mine layer",
    "cost": 1200,
    "stage": "advanced",
    "buildTimeSec": 38.4,
    "description": "Lays mines (carries 5).",
    "category": "Support Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "service_bay"
      ]
    ]
  },
  "lander": {
    "id": "lander",
    "name": "Lander",
    "faction": "both",
    "role": "Amphibious transport",
    "cost": 1050,
    "stage": "warfare",
    "buildTimeSec": 33.6,
    "description": "Amphibious transport for 5 passengers.",
    "category": "Naval",
    "producedAt": [
      "harbor",
      "sub_dock"
    ],
    "prerequisites": []
  },
  "medic": {
    "id": "medic",
    "name": "Medic",
    "faction": "ordan",
    "role": "Infantry healing",
    "cost": 1200,
    "stage": "warfare",
    "buildTimeSec": 38.4,
    "description": "Heals nearby infantry.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": []
  },
  "infiltrator": {
    "id": "infiltrator",
    "name": "Infiltrator",
    "faction": "ordan",
    "role": "Intelligence / infiltration",
    "cost": 750,
    "stage": "advanced",
    "buildTimeSec": 24,
    "description": "Slips into enemy structures to gather intelligence.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ]
  },
  "raider": {
    "id": "raider",
    "name": "Raider",
    "faction": "ordan",
    "role": "Economic infiltration",
    "cost": 750,
    "stage": "advanced",
    "buildTimeSec": 24,
    "description": "Infiltrates enemy economic structures.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ]
  },
  "hound": {
    "id": "hound",
    "name": "Hound",
    "faction": "sable",
    "role": "Fast anti-infantry hunter",
    "cost": 300,
    "stage": "warfare",
    "buildTimeSec": 9.6,
    "description": "Fast hunter that runs down infantry.",
    "category": "Infantry",
    "producedAt": [
      "hound_kennel"
    ],
    "prerequisites": []
  },
  "grenadier": {
    "id": "grenadier",
    "name": "Grenadier",
    "faction": "sable",
    "role": "Explosive anti-infantry / structure",
    "cost": 240,
    "stage": "establish",
    "buildTimeSec": 7.68,
    "description": "Throws fragmentation grenades at infantry and structures; explodes violently when killed.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": []
  },
  "breaker": {
    "id": "breaker",
    "name": "Breaker",
    "faction": "sable",
    "role": "Short-range thermal assault",
    "cost": 450,
    "stage": "advanced",
    "buildTimeSec": 14.4,
    "description": "Short-range thermal assault infantry; explodes violently when killed.",
    "category": "Infantry",
    "producedAt": [
      "barracks"
    ],
    "prerequisites": [
      [
        "gravity_forge"
      ]
    ]
  },
  "skimmer": {
    "id": "skimmer",
    "name": "Skimmer",
    "faction": "ordan",
    "role": "Fast scout / light anti-infantry",
    "cost": 900,
    "stage": "warfare",
    "buildTimeSec": 28.8,
    "description": "Fast scout with a light autocannon, good against infantry.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": []
  },
  "jackal": {
    "id": "jackal",
    "name": "Jackal",
    "faction": "ordan",
    "role": "Light armor",
    "cost": 1050,
    "stage": "warfare",
    "buildTimeSec": 33.6,
    "description": "Light tracked tank.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": []
  },
  "ram": {
    "id": "ram",
    "name": "Ram",
    "faction": "ordan",
    "role": "Main battle armor",
    "cost": 1200,
    "stage": "warfare",
    "buildTimeSec": 38.4,
    "description": "Main battle tank.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": []
  },
  "carrier": {
    "id": "carrier",
    "name": "Carrier",
    "faction": "ordan",
    "role": "Infantry transport",
    "cost": 1200,
    "stage": "warfare",
    "buildTimeSec": 38.4,
    "description": "Tracked transport for 5 infantry, with a light autocannon.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "barracks"
      ]
    ]
  },
  "spire": {
    "id": "spire",
    "name": "Spire",
    "faction": "ordan",
    "role": "Long-range artillery",
    "cost": 900,
    "stage": "advanced",
    "buildTimeSec": 28.8,
    "description": "Long-range artillery; must stop to fire.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": []
  },
  "watcher": {
    "id": "watcher",
    "name": "Watcher",
    "faction": "ordan",
    "role": "Mobile radar disruption",
    "cost": 900,
    "stage": "advanced",
    "buildTimeSec": 28.8,
    "description": "Disrupts enemy radar around it.",
    "category": "Support Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ]
  },
  "shroud": {
    "id": "shroud",
    "name": "Shroud",
    "faction": "ordan",
    "role": "Mobile visibility denial",
    "cost": 900,
    "stage": "advanced",
    "buildTimeSec": 28.8,
    "description": "Hides nearby units from enemy sight.",
    "category": "Support Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ]
  },
  "goliath": {
    "id": "goliath",
    "name": "Goliath",
    "faction": "sable",
    "role": "Heavy armor",
    "cost": 1425,
    "stage": "warfare",
    "buildTimeSec": 45.6,
    "description": "Heavy twin-gun tank.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": []
  },
  "anvil": {
    "id": "anvil",
    "name": "Anvil",
    "faction": "sable",
    "role": "Late heavy assault",
    "cost": 2550,
    "stage": "advanced",
    "buildTimeSec": 81.6,
    "description": "Late-game heavy assault tank that heals itself up to half health.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "gravity_forge"
      ]
    ]
  },
  "salvo": {
    "id": "salvo",
    "name": "Salvo",
    "faction": "sable",
    "role": "Long-range missile artillery",
    "cost": 1050,
    "stage": "warfare",
    "buildTimeSec": 33.6,
    "description": "Long-range missile artillery: one missile at a time, and it must stop to fire.",
    "category": "Combat Vehicle",
    "producedAt": [
      "motor_works"
    ],
    "prerequisites": [
      [
        "radar"
      ]
    ]
  },
  "drift": {
    "id": "drift",
    "name": "Drift",
    "faction": "ordan",
    "role": "Attack helicopter",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Attack helicopter with missiles; the first comes with the first Flight Pad.",
    "category": "Aircraft",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": []
  },
  "shrike": {
    "id": "shrike",
    "name": "Shrike",
    "faction": "sable",
    "role": "Ground-attack aircraft",
    "cost": 1200,
    "stage": "advanced",
    "buildTimeSec": 38.4,
    "description": "Ground-attack aircraft with rotary cannons.",
    "category": "Aircraft",
    "producedAt": [
      "airfield"
    ],
    "prerequisites": []
  },
  "interceptor": {
    "id": "interceptor",
    "name": "Interceptor",
    "faction": "sable",
    "role": "Fast strike aircraft",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Fast strike aircraft with missiles.",
    "category": "Aircraft",
    "producedAt": [
      "airfield"
    ],
    "prerequisites": []
  },
  "lifter": {
    "id": "lifter",
    "name": "Lifter",
    "faction": "sable",
    "role": "Transport helicopter",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Transport helicopter for 5 passengers.",
    "category": "Aircraft",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": []
  },
  "hammer": {
    "id": "hammer",
    "name": "Hammer",
    "faction": "sable",
    "role": "Attack gunship",
    "cost": 1800,
    "stage": "advanced",
    "buildTimeSec": 57.6,
    "description": "Heavy attack gunship; the first comes with the first Flight Pad.",
    "category": "Aircraft",
    "producedAt": [
      "flight_pad"
    ],
    "prerequisites": []
  },
  "cutter": {
    "id": "cutter",
    "name": "Cutter",
    "faction": "ordan",
    "role": "Fast patrol / anti-sub",
    "cost": 750,
    "stage": "warfare",
    "buildTimeSec": 24,
    "description": "Fast patrol boat that hunts submarines.",
    "category": "Naval",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": []
  },
  "warden": {
    "id": "warden",
    "name": "Warden",
    "faction": "ordan",
    "role": "Missile destroyer / anti-sub",
    "cost": 1500,
    "stage": "advanced",
    "buildTimeSec": 48,
    "description": "Missile destroyer that also hunts submarines.",
    "category": "Naval",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": []
  },
  "bastion": {
    "id": "bastion",
    "name": "Bastion",
    "faction": "ordan",
    "role": "Heavy long-range warship",
    "cost": 3000,
    "stage": "advanced",
    "buildTimeSec": 96,
    "description": "Heavy long-range warship.",
    "category": "Naval",
    "producedAt": [
      "harbor"
    ],
    "prerequisites": [
      [
        "gravity_lab"
      ]
    ]
  },
  "wraith": {
    "id": "wraith",
    "name": "Wraith",
    "faction": "sable",
    "role": "Stealth submarine",
    "cost": 1425,
    "stage": "warfare",
    "buildTimeSec": 45.6,
    "description": "Stealth submarine that strikes with torpedoes.",
    "category": "Naval",
    "producedAt": [
      "sub_dock"
    ],
    "prerequisites": []
  }
};

export const PUBLIC_ECONOMY = {
  "startingCredits": 15000
} as const;
