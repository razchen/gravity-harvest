// The units the dev pages know about: every unit in the rules (design/balance.xlsx), with our art for the ones that
// have it. Like buildings.ts, this reads the full rules, which is fine because the dev pages aren't in the game build.
import { BUILDINGS, UNITS, WEAPONS, speedToTilesPerSec } from '@gravity-harvest/rules';
import { HOVER_UNITS } from '@gravity-harvest/sim';
import { UNIT_REGISTRY } from '../data/registry';
import type { UnitAnims } from './anim';
import type { ModelFile } from './model';
import { DEV_BUILDINGS, type FactionScope, type Milestone } from './buildings';

/**
 * The kinds the dev pages split units into: soldiers (and the Hound) on foot, ground vehicles, aircraft (V2) and
 * ships (V4).
 */
export type UnitKind = 'infantry' | 'vehicle' | 'aircraft' | 'naval';
export const UNIT_KINDS: { id: UnitKind; name: string }[] = [
  { id: 'infantry', name: 'Infantry' },
  { id: 'vehicle', name: 'Vehicles' },
  { id: 'aircraft', name: 'Aircraft' },
  { id: 'naval', name: 'Naval' },
];

export interface DevUnit {
  id: string;
  name: string;
  faction: FactionScope;
  category: string;
  /** Infantry, a ground vehicle (support or combat), an aircraft or a ship. */
  kind: UnitKind;
  role: string;
  /** One line on what it does (design/balance.xlsx, Units: Description). */
  description: string;
  cost: number;
  hp: number;
  armor: string;
  speed: number;
  buildTimeSec: number;
  passengers: number;
  /** Names of the buildings that produce it (any one). */
  builtAt: string[];
  /** Extra requirements, each a set of alternatives ("Gravity Lab or Gravity Forge"). */
  needs: string[];
  weapons: string[];
  /** The earliest release it can be built in: its producer's, or a requirement's if that comes later. */
  milestone: Milestone;
  picture?: { file: string; frame: string };
  /** High-resolution picture (tools/sprites/pack_previews.py), for the picture views. */
  preview?: string;
  /** Its animations, for the player on its page. */
  anims?: UnitAnims;
  /** Its source models under art/models (one per animation clip for a rigged character), for the 3D view. */
  models?: ModelFile[];
  note: string;
}

/** Units with art, by id. */
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const clip = (name: string, file: string): ModelFile => ({ name, file: `meshy/rifleman_v2/Meshy_AI_sci_fi_rifleman_rigge_biped_Animation_${file}_withSkin.glb` });
/**
 * A rig's clip (render_vehicle.py `clips`), packed into its own atlas `v_<id>_<clip>`: its name here, frames and fps,
 * and whether it plays once (then holds and starts again) or loops.
 */
interface VehicleClip { clip: string; name: string; frames: number; fps: number; once?: boolean }
/**
 * A vehicle rendered by tools/blender/render_vehicle.py: 16 directions, its Tripo model, and where it stands. One with
 * a `turret` that turns on its own (rendered from its rig) also shows it sweeping round, and driving while it shoots;
 * one with `clips` plays them too.
 */
const vehicle = (id: string, note: string, turret = false, clips: VehicleClip[] = []): Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'> => ({
  picture: { file: `v_${id}`, frame: `v_${id}_13` },
  preview: `/assets/previews/v_${id}.webp`,
  note: `Tripo model, in matches: 16 directions${turret ? ', its turret turning on its own' : ''}. ${note}`,
  anims: {
    directions: 16,
    start: 13,
    list: [
      { name: 'Drive', atlas: `v_${id}`, frames: (d) => [`v_${id}_${d}`], overlay: (d) => range(6).map((f) => `v_${id}_w${d}_${f}`), fps: 12 },
      { name: 'Stand', atlas: `v_${id}`, frames: (d) => [`v_${id}_${d}`], fps: 1 },
      ...(turret ? [
        { name: 'Turret', atlas: `v_${id}`, frames: (d: number) => [`v_${id}_h${d}`], fps: 1, turret: { frame: (t: number) => `v_${id}_t${t}`, mode: 'sweep' as const } },
        {
          name: 'Drive & aim', atlas: `v_${id}`, frames: (d: number) => [`v_${id}_h${d}`], overlay: (d: number) => range(6).map((f) => `v_${id}_w${d}_${f}`), fps: 12,
          turret: { frame: (t: number) => `v_${id}_t${t}`, mode: 'aim' as const },
        },
      ] : []),
      ...clips.map((c) => ({
        name: c.name, atlas: `v_${id}_${c.clip}`, frames: (d: number) => range(c.frames).map((f) => `v_${id}_${c.clip}_${d}_${f}`), fps: c.fps,
        once: c.once,
      })),
    ],
  },
  models: [{ name: id, file: `tripo/${id}.glb` }],
});
/**
 * A hovering unit rendered by tools/blender/render_vehicle.py (`hover`): 16 directions, bobbing over its shadow, its
 * lights glowing underneath. Its shots are on the page under the player (weapons.ts), as a match draws them.
 */
const hovering = (id: string, model: string, note: string, clip?: VehicleClip): Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'> => ({
  picture: { file: `v_${id}`, frame: `v_${id}_13` },
  preview: `/assets/previews/v_${id}.webp`,
  note: `Tripo model, hovering, in matches: 16 directions, bobbing over its shadow. ${note}`,
  anims: { directions: 16, start: 13, list: hoverAnims(id, '', clip) },
  models: [{ name: id, file: `tripo/hover/${model}.glb` }],
});
/** A hovering unit's animations: hovering, and its clip (arms working). `label` names the side. */
const hoverAnims = (id: string, label: string, clip?: VehicleClip) => [
  { name: `Hover${label}`, atlas: `v_${id}`, frames: (d: number) => [`v_${id}_${d}`], under: (d: number) => `v_${id}_s${d}`, fps: 1 },
  ...(clip ? [{
    name: `${clip.name}${label}`, atlas: `v_${id}_${clip.clip}`, under: (d: number) => `v_${id}_s${d}`, fps: clip.fps,
    frames: (d: number) => range(clip.frames).map((f) => `v_${id}_${clip.clip}_${d}_${f}`),
  }] : []),
];
/** A shared unit each side builds to its own design (`<id>_ordan`, `<id>_sable`): both on its page. */
const hoveringBySide = (id: string, note: string, clip?: VehicleClip): Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'> => ({
  picture: { file: `v_${id}_ordan`, frame: `v_${id}_ordan_13` },
  preview: `/assets/previews/v_${id}_ordan.webp`,
  note: `Tripo models, one per side (Ordan's and Sable's), hovering, in matches: 16 directions, bobbing over its shadow. ${note}`,
  anims: { directions: 16, start: 13, list: [...hoverAnims(`${id}_ordan`, ' (Ordan)', clip), ...hoverAnims(`${id}_sable`, ' (Sable)', clip)] },
  models: [{ name: `${id} (Ordan)`, file: `tripo/hover/${id}_ordan.glb` }, { name: `${id} (Sable)`, file: `tripo/hover/${id}_sable.glb` }],
});
/**
 * What only the dev pages say about a unit with art (its look comes from data/registry.ts, and whether it hovers
 * from the sim's HOVER_UNITS): a line about it, whether its art has a turret layer to show turning, its rig clips'
 * frames and speed, and any more animations for its page.
 */
interface DevNote {
  note: string;
  turret?: boolean;
  clips?: VehicleClip[];
  anims?: UnitAnims['list'];
}
// the carrier's side doors drop into ramps (the `v_carrier_door` clip): opening and shutting, and a rifleman running in
const carrierDoors = (d: number) => range(8).map((f) => `v_carrier_door_${d}_${f}`);
const NOTES: Record<string, DevNote> = {
  skimmer: { note: 'Fights with its light autocannon.' },
  jackal: { note: 'Fights with its light cannon, on the move too.', turret: true },
  ram: { note: 'Fights with its battle cannon, on the move too; tracked (its tracks don\'t turn yet).', turret: true },
  spire: { note: 'Fires heavy artillery shells on a long, flat path from its long barrel.', turret: true },
  carrier: {
    note: 'Fights with its autocannon and carries five soldiers (its doors, and a rifleman boarding, are shown here).',
    anims: [
      { name: 'Doors', atlas: 'v_carrier_door', frames: carrierDoors, fps: 16, pingPong: true },
      { name: 'Soldier boards', atlas: 'v_carrier_door', frames: carrierDoors, fps: 16, board: { atlas: 'rifleman', tilesPerSec: speedToTilesPerSec(UNITS.rifleman.speed) } },
    ],
  },
  watcher: { note: 'Drives; its radar disruption in matches comes later (its scan loop is rendered).', clips: [{ clip: 'scan', name: 'Scan', frames: 24, fps: 6 }] },
  shroud: { note: 'Drives; hiding nearby units comes later.' },
  seeder: {
    note: 'Drives; laying mines in matches comes later (its lay-mine animation is rendered).',
    clips: [{ clip: 'lay_mine', name: 'Lay mine', frames: 12, fps: 6, once: true }],
  },
  hound: { note: 'Fires a red energy ball from each side pod.' },
  assembler: { note: 'Press E with it selected to deploy it into an Assembly Yard where it stands.' },
  medic: { note: 'Unarmed; its two arms work in its heal loop while it heals a damaged unit.', clips: [{ clip: 'heal', name: 'Heal', frames: 12, fps: 10 }] },
  raider: { note: 'Unarmed; infiltrating economic buildings comes later.' },
  infiltrator: { note: 'Unarmed; infiltrating buildings comes later.' },
  grenadier: { note: 'Lobs fragmentation grenades from the launcher on its top.' },
  breaker: { note: 'Charges up, then a column of light strikes its target.' },
  lancer: { note: 'Fires a homing missile from each pod, its exhaust in its side\'s colour.' },
  operator: { note: 'Fires a crackling energy bolt in its side\'s colour from its nose gun.' },
  engineer: { note: 'Unarmed; its arm works in its repair loop while it repairs a damaged building.', clips: [{ clip: 'work', name: 'Work', frames: 12, fps: 10 }] },
  harvester: {
    note: 'Its front drums turn while it scoops ore; at a refinery\'s dock it tips its load out (a generated video\'s frames, facing the dock only), and it drives off empty.',
    clips: [{ clip: 'harvest', name: 'Harvest', frames: 12, fps: 22 }],
    anims: [
      { name: 'Drive empty', atlas: 'v_harvester_empty', frames: (d) => [`v_harvester_empty_${d}`], overlay: (d) => range(6).map((f) => `v_harvester_empty_w${d}_${f}`), fps: 12 },
      // 96 frames over the 3 s it plays in matches (HARVESTER_UNLOAD_MS), facing the dock whichever way it's turned
      { name: 'Unload (docked)', atlas: 'v_harvester_unload', frames: () => range(96).map((f) => `v_harvester_unload_${f}`), fps: 32, once: true },
    ],
  },
};

/** Soldiers are drawn their own way (and are on their way out), so their pages are by hand. */
const INFANTRY: Record<string, Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'>> = {
  rifleman: {
    picture: { file: 'rifleman', frame: 'inf_2_idle' },
    models: [clip('Running', 'Running'), clip('Aim', 'Rifle_Aim_Turn_Right'), clip('Death', 'Shot_and_Blown_Back'), clip('Run and shoot', 'Run_and_Shoot'), clip('Walking', 'Walking')],
    note: 'Meshy rigged sci-fi rifleman (tools/blender/make_infantry.py), in matches: 16 directions; aiming stance (shooting tracer bursts), run, and shot and thrown back.',
    anims: {
      directions: 16,
      start: 14,
      list: [
        { name: 'Aim (standing)', atlas: 'rifleman', frames: (d) => [`inf_${d}_idle`], fps: 1 },
        { name: 'Shooting', atlas: 'rifleman', frames: (d) => [`inf_${d}_idle`], fps: 1, fire: true },
        { name: 'Run', atlas: 'rifleman', frames: (d) => range(12).map((i) => `inf_${d}_${i}`), fps: 18 },
        { name: 'Death', atlas: 'rifleman_death', frames: (d) => range(16).map((i) => `inf_${d}_die_${i}`), fps: 8.18, once: true },
      ],
    },
  },
};

/** A unit's art on the dev pages, from its registry entry: a vehicle, a hovering unit (one design or one per side), or a soldier. */
function devArt(id: string): Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'> {
  const e = UNIT_REGISTRY[id];
  if (e.kind === 'infantry') return INFANTRY[id] ?? { note: 'In matches.' };
  const n = NOTES[id] ?? { note: '' };
  const art = !HOVER_UNITS.has(id) ? vehicle(id, n.note, n.turret, n.clips)
    : e.sides ? hoveringBySide(id, n.note, n.clips?.[0]) : hovering(id, id, n.note, n.clips?.[0]);
  if (n.anims) art.anims!.list.push(...n.anims);
  return art;
}

/** Our art, by unit id: every unit in the registry. */
const ART: Record<string, Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'>> = Object.fromEntries(
  Object.keys(UNIT_REGISTRY).map((id) => [id, devArt(id)]),
);

const sameSide = (a: FactionScope, b: FactionScope) => a === 'both' || b === 'both' || a === b;
const milestoneOf = new Map(DEV_BUILDINGS.map((b) => [b.id, b.milestone]));
const ORDER: Record<FactionScope, number> = { both: 0, ordan: 1, sable: 2 };
const CATEGORY = ['Infantry', 'Support Vehicle', 'Combat Vehicle', 'Aircraft', 'Naval'];

export const DEV_UNITS: DevUnit[] = Object.values(UNITS)
  .map((u): DevUnit => {
    const faction = u.faction as FactionScope;
    // only the producers its side can have count (a shared unit can come out of either side's)
    const producers = u.producedAt.filter((p) => BUILDINGS[p] && sameSide(faction, BUILDINGS[p].faction as FactionScope));
    const earliest = (ids: string[]) => Math.min(...ids.map((id) => milestoneOf.get(id) ?? 4));
    const milestone = Math.max(earliest(producers.length ? producers : u.producedAt), ...u.prerequisites.map(earliest)) as Milestone;
    return {
      id: u.id,
      name: u.name,
      faction,
      category: u.category ?? '',
      kind: u.category === 'Infantry' ? 'infantry' : u.category === 'Aircraft' ? 'aircraft' : u.category === 'Naval' ? 'naval' : 'vehicle',
      role: u.role ?? '',
      description: u.description ?? '',
      cost: u.cost,
      hp: u.hp,
      armor: u.armor,
      speed: u.speed,
      buildTimeSec: u.buildTimeSec,
      passengers: u.passengers,
      builtAt: producers.map((p) => BUILDINGS[p].name),
      needs: u.prerequisites.map((alts) => alts.map((p) => BUILDINGS[p]?.name ?? p).join(' or ')),
      weapons: u.weapons.map((w) => WEAPONS[w]?.name ?? w),
      milestone,
      ...(ART[u.id] ?? { note: 'No art yet.' }),
    };
  })
  .sort((a, b) => ORDER[a.faction] - ORDER[b.faction] || a.milestone - b.milestone || CATEGORY.indexOf(a.category) - CATEGORY.indexOf(b.category));
