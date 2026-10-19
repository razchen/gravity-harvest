// The buildings the dev pages know about: every building in the rules (design/balance.xlsx), with our art for the
// ones that have it. (/dev/ lists them, /dev/building.html?b=<id> shows one being built and destroyed.) The dev pages
// aren't part of the game build, so reading the full rules here doesn't put them in the browser bundle
// (scripts/check-bundle.mjs).
import { BUILDINGS, UNITS, WEAPONS } from '@gravity-harvest/rules';
import { FOOTPRINT } from '@gravity-harvest/sim';
import { BUILDING_REGISTRY, buildingAtlas } from '../data/registry';

export type FactionScope = 'both' | 'ordan' | 'sable';

/** The side's emblem (docs/FACTIONS.md); shared buildings have none. */
export const emblem = (f: FactionScope) => (f === 'both' ? '' : `<img class="mr-1 inline size-[1.15em] object-contain align-[-0.22em]" src="/assets/ui/factions/${f}_small.png" alt="">`);

export const FACTIONS: { id: FactionScope; name: string }[] = [
  { id: 'both', name: 'Shared' },
  { id: 'ordan', name: 'Ordan' },
  { id: 'sable', name: 'Sable' },
];

/** Release milestones (docs/MILESTONES.md). */
export type Milestone = 1 | 2 | 3 | 4;
export const MILESTONES: { id: Milestone; name: string }[] = [
  { id: 1, name: 'V1 · Ground skirmish' },
  { id: 2, name: 'V2 · Air and barriers' },
  { id: 3, name: 'V3 · Strategic layer' },
  { id: 4, name: 'V4 · Naval' },
];
const MILESTONE_OF: Record<string, Milestone> = {
  assembly_yard: 1, power_plant: 1, refinery: 1, barracks: 1, motor_works: 1, radar: 1, reactor_plant: 1, service_bay: 1,
  gravity_lab: 1, sentry: 1, lance_battery: 1, gravity_forge: 1, incinerator: 1, anchor: 1, hound_kennel: 1,
  flight_pad: 2, flak_array: 2, sky_lance: 2, airfield: 2, concrete_barrier: 2, sandbag_barrier: 2, wire_barrier: 2, hidden_sentry: 2,
  veil_generator: 3, phase_array: 3, lock_field: 3, strategic_silo: 3, decoy_yard: 3, decoy_motor_works: 3, decoy_radar: 3,
  harbor: 4, sub_dock: 4, decoy_harbor: 4,
};

export interface DevBuilding {
  id: string;
  name: string;
  faction: FactionScope;
  role: string;
  /** Which release it's in (a building missing from MILESTONE_OF counts as the last). */
  milestone: Milestone;
  /** Footprint in tiles (square); only the buildings in matches have one yet. */
  footprint?: number;
  /** One line on what it does (design/balance.xlsx, Buildings: Description). */
  description: string;
  cost: number;
  /** + produces, − consumes. */
  power: number;
  buildTimeSec: number;
  hp: number;
  armor: string;
  /** Stops working on low power. */
  requiresPower: boolean;
  /** Names of the buildings it needs. */
  needs: string[];
  /** Names of the units it produces (for its side). */
  makes: string[];
  /** Names of its weapons. */
  weapons: string[];
  /** Atlas file (public/assets/sprites) and frame of the finished building, for its picture. */
  picture?: { file: string; frame: string };
  /** Construction atlas (tools/blender/construction/<name>.json, packed by tools/sprites/pack_construction.py). */
  construction?: string;
  /** High-resolution picture for the dev pages (tools/sprites/pack_previews.py). */
  preview?: string;
  /** A line about where its art stands. */
  note: string;
  /** Its head turns (the atlas has turret frames): the page gets a Turret tab. */
  turret?: boolean;
  /** Its page gets an Animation tab: the finished building running (its moving parts, door and effects). */
  idle?: boolean;
  /** Its running animation is a generated video's frames (tools/sprites/key_video.py), as in matches. */
  video?: boolean;
  /** Its source model under art/models, for the 3D model tab. */
  model?: string;
}

/**
 * What only the dev pages say about a building with art (its look itself comes from data/registry.ts): how many parts
 * its Tripo model has, a line about it (or a whole `note` of its own), whether its head turns, and its model's file
 * where it isn't `tripo/<id>.glb`.
 */
interface DevNote {
  parts: number;
  extra?: string;
  note?: string;
  turret?: boolean;
  model?: string;
}
const TURNS = 'Its head turns to face what it shoots at.';
const NOTES: Record<string, DevNote> = {
  assembly_yard: { parts: 130, extra: 'Every base starts with one.' },
  power_plant: { parts: 133 },
  reactor_plant: { parts: 166 },
  refinery: { parts: 20, note: 'Tripo parts model (20 parts, stages picked by hand). In matches; no door animation for now.' },
  barracks: { parts: 160 },
  motor_works: { parts: 127, extra: 'Harvesters come from here.' },
  service_bay: { parts: 193, model: 'tripo/service_bay_v2.glb', extra: 'Repairs vehicles next to it; right-click it with vehicles to send them onto its pad, where its roof arms (rigged in Blender) work on them.' },
  radar: { parts: 148, extra: 'Its dish needs to spin.' },
  gravity_lab: { parts: 109, extra: 'Its gyroscope turns and its core glows while it has power.' },
  gravity_forge: { parts: 123 },
  sentry: { parts: 130, extra: TURNS, turret: true },
  lance_battery: { parts: 112, extra: TURNS, turret: true },
  incinerator: { parts: 83, extra: 'No turning head: it fires fireballs from its bunker.' },
  anchor: { parts: 199, extra: `${TURNS} Holds fire on low power.`, turret: true },
  hound_kennel: { parts: 189, extra: 'It can be built; the Hound itself has no model yet.' },
};

/** Our art, by building id: every building in the registry, with its notes. */
const ART: Record<string, Pick<DevBuilding, 'picture' | 'construction' | 'preview' | 'note' | 'turret' | 'idle' | 'video' | 'model'>> = Object.fromEntries(
  Object.entries(BUILDING_REGISTRY).map(([id, e]) => {
    const atlas = buildingAtlas(id);
    const n = NOTES[id];
    const parts = n ? `${n.parts} parts, ` : '';
    return [id, {
      picture: { file: atlas, frame: `${atlas}_stage_5` },
      construction: atlas,
      preview: `/assets/previews/${atlas}.webp`,
      note: n?.note ?? `Tripo parts model (${parts}stages grouped automatically). In matches.${n?.extra ? ` ${n.extra}` : ''}`,
      ...(n?.turret && { turret: true }),
      ...(e.video && { video: true }),
      ...(n?.model && { model: n.model }),
    }];
  }),
);

const ORDER: Record<FactionScope, number> = { both: 0, ordan: 1, sable: 2 };

const sameSide = (a: FactionScope, b: FactionScope) => a === 'both' || b === 'both' || a === b;

export const DEV_BUILDINGS: DevBuilding[] = Object.values(BUILDINGS)
  .map((b): DevBuilding => ({
    id: b.id,
    name: b.name,
    faction: b.faction as FactionScope,
    role: b.role ?? '',
    description: b.description ?? '',
    cost: b.cost,
    power: b.power,
    buildTimeSec: b.buildTimeSec,
    hp: b.hp,
    armor: b.armor,
    requiresPower: b.requiresPower,
    needs: b.prerequisites.map((p) => BUILDINGS[p]?.name ?? p),
    makes: Object.values(UNITS).filter((u) => u.producedAt.includes(b.id) && sameSide(u.faction as FactionScope, b.faction as FactionScope)).map((u) => u.name),
    weapons: b.weapons.map((w) => WEAPONS[w]?.name ?? w),
    milestone: MILESTONE_OF[b.id] ?? 4,
    ...(FOOTPRINT[b.id] && { footprint: FOOTPRINT[b.id] }),
    ...(ART[b.id] ?? { note: 'No art yet.' }),
    ...(ART[b.id]?.construction && { model: ART[b.id].model ?? `tripo/${b.id}.glb`, idle: true }),
  }))
  // by faction, then milestone; within those, buildings with stages first, then with a picture, then the rest
  .sort((a, b) => ORDER[a.faction] - ORDER[b.faction] || a.milestone - b.milestone || Number(!a.construction) - Number(!b.construction) || Number(!a.picture) - Number(!b.picture));

/** Can this faction build it? (`both` = the shared buildings only.) */
export const inFaction = (b: { faction: FactionScope }, f: FactionScope | 'all'): boolean =>
  f === 'all' || (f === 'both' ? b.faction === 'both' : b.faction === 'both' || b.faction === f);
