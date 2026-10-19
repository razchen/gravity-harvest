// The buildings the dev pages know about: every building in the rules (design/balance.xlsx), with our art for the
// ones that have it. (/dev/ lists them, /dev/building.html?b=<id> shows one being built and destroyed.) The dev pages
// aren't part of the game build, so reading the full rules here doesn't put them in the browser bundle
// (scripts/check-bundle.mjs).
import { BUILDINGS, UNITS, WEAPONS } from '@gravity-harvest/rules';
import { footprint } from '@gravity-harvest/sim';

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
  /** Footprint in tiles (square). */
  footprint: number;
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

const tripo = (atlasId: string, parts: number, extra = '') => ({
  picture: { file: `b_${atlasId}_build`, frame: `b_${atlasId}_build_stage_5` },
  construction: `b_${atlasId}_build`,
  preview: `/assets/previews/b_${atlasId}_build.webp`,
  note: `Tripo parts model (${parts} parts, stages grouped automatically). In matches.${extra && ` ${extra}`}`,
});
const TURNS = 'Its head turns to face what it shoots at.';

/** Our art, by building id. */
const ART: Record<string, Pick<DevBuilding, 'picture' | 'construction' | 'preview' | 'note' | 'turret' | 'idle' | 'video' | 'model'>> = {
  assembly_yard: tripo('assembly', 130, 'Every base starts with one.'),
  power_plant: tripo('power_plant', 133),
  reactor_plant: { ...tripo('reactor_plant', 166), video: true },
  refinery: {
    ...tripo('refinery', 20),
    note: 'Tripo parts model (20 parts, stages picked by hand). In matches; no door animation for now.',
  },
  barracks: { ...tripo('barracks', 160), video: true },
  motor_works: { ...tripo('motor_works', 127, 'Harvesters come from here.'), video: true },
  service_bay: { model: 'tripo/service_bay_v2.glb', ...tripo('service_bay', 193, 'Repairs vehicles next to it; right-click it with vehicles to send them onto its pad, where its roof arms (rigged in Blender) work on them.') },
  radar: tripo('radar', 148, 'Its dish needs to spin.'),
  gravity_lab: tripo('gravity_lab', 109, 'Its gyroscope turns and its core glows while it has power.'),
  gravity_forge: tripo('gravity_forge', 123),
  sentry: { ...tripo('sentry', 130, TURNS), turret: true },
  lance_battery: { ...tripo('lance_battery', 112, TURNS), turret: true },
  incinerator: tripo('incinerator', 83, 'No turning head: it fires fireballs from its bunker.'),
  anchor: { ...tripo('anchor', 199, `${TURNS} Holds fire on low power.`), turret: true },
  hound_kennel: tripo('hound_kennel', 189, 'It can be built; the Hound itself has no model yet.'),
};

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
    footprint: footprint(b.id),
    ...(ART[b.id] ?? { note: 'No art yet.' }),
    ...(ART[b.id]?.construction && { model: ART[b.id].model ?? `tripo/${b.id}.glb`, idle: true }),
  }))
  // by faction, then milestone; within those, buildings with stages first, then with a picture, then the rest
  .sort((a, b) => ORDER[a.faction] - ORDER[b.faction] || a.milestone - b.milestone || Number(!a.construction) - Number(!b.construction) || Number(!a.picture) - Number(!b.picture));

/** Can this faction build it? (`both` = the shared buildings only.) */
export const inFaction = (b: { faction: FactionScope }, f: FactionScope | 'all'): boolean =>
  f === 'all' || (f === 'both' ? b.faction === 'both' : b.faction === 'both' || b.faction === f);
