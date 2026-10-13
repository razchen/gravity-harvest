// The units the dev pages know about: every unit in the rules (design/balance.xlsx), with our art for the ones that
// have it. Like buildings.ts, this reads the full rules, which is fine because the dev pages aren't in the game build.
import { BUILDINGS, UNITS, WEAPONS } from '@gravity-harvest/rules';
import type { UnitAnims } from './anim';
import type { ModelFile } from './model';
import { DEV_BUILDINGS, type FactionScope, type Milestone } from './buildings';

/** The two kinds the dev pages split units into: soldiers (and the Hound) on foot, and everything with an engine. */
export type UnitKind = 'infantry' | 'vehicle';
export const UNIT_KINDS: { id: UnitKind; name: string }[] = [
  { id: 'infantry', name: 'Infantry' },
  { id: 'vehicle', name: 'Vehicles' },
];

export interface DevUnit {
  id: string;
  name: string;
  faction: FactionScope;
  category: string;
  /** Infantry, or a vehicle (ground support, combat, aircraft and naval). */
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
 * A vehicle rendered by tools/blender/render_vehicle.py: 16 directions, its Tripo model, and where it stands. One with
 * a `turret` that turns on its own (rendered from its rig) also shows it sweeping round, and driving while it shoots.
 */
const vehicle = (id: string, note: string, turret = false): Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'> => ({
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
          name: 'Drive & shoot', atlas: `v_${id}`, frames: (d: number) => [`v_${id}_h${d}`], overlay: (d: number) => range(6).map((f) => `v_${id}_w${d}_${f}`), fps: 12,
          fire: 'shell' as const, turret: { frame: (t: number) => `v_${id}_t${t}`, mode: 'aim' as const },
        },
      ] : []),
    ],
  },
  models: [{ name: id, file: `tripo/${id}.glb` }],
});
/**
 * A soldier rendered by tools/blender/make_infantry.py from one Meshy GLB with all his clips: 16 directions; his
 * standing model, run, and his death (`deathFrames` at `deathFps`).
 */
const soldier = (id: string, note: string, deathFrames: number, deathFps: number): Pick<DevUnit, 'picture' | 'note' | 'anims' | 'models'> => ({
  picture: { file: id, frame: 'inf_2_idle' },
  models: [{ name: 'Running, walking and death', file: `meshy/${id}/${id}_all_animations.glb` }],
  note: `Meshy rigged model (tools/blender/make_infantry.py), in matches: 16 directions; standing, run, and shot down. ${note}`,
  anims: {
    directions: 16,
    start: 14,
    list: [
      { name: 'Standing', atlas: id, frames: (d) => [`inf_${d}_idle`], fps: 1 },
      { name: 'Run', atlas: id, frames: (d) => range(12).map((i) => `inf_${d}_${i}`), fps: 18 },
      { name: 'Death', atlas: `${id}_death`, frames: (d) => range(deathFrames).map((i) => `inf_${d}_die_${i}`), fps: deathFps, once: true },
    ],
  },
});
const ART: Record<string, Pick<DevUnit, 'picture' | 'preview' | 'note' | 'anims' | 'models'>> = {
  skimmer: vehicle('skimmer', 'Fights with its light autocannon.'),
  jackal: vehicle('jackal', 'Fights with its light cannon, on the move too.', true),
  ram: vehicle('ram', 'Fights with its battle cannon.'),
  spire: vehicle('spire', 'Fires artillery shells (no arc yet).'),
  carrier: vehicle('carrier', 'Fights with its autocannon; carrying infantry comes later.'),
  watcher: vehicle('watcher', 'Drives; its radar disruption comes later.'),
  shroud: vehicle('shroud', 'Drives; hiding nearby units comes later.'),
  seeder: vehicle('seeder', 'Drives; laying mines comes later.'),
  assembler: vehicle('assembler', 'Press E with it selected to deploy it into an Assembly Yard where it stands.'),
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
  medic: soldier('medic', 'Carries his datapad in his right hand; healing comes later.', 20, 6.51),
  raider: soldier('raider', 'Unarmed; infiltrating economic buildings comes later.', 16, 8.18),
  infiltrator: soldier('infiltrator', 'Unarmed; infiltrating buildings comes later.', 16, 9.47),
  harvester: {
    picture: { file: 'harvester', frame: 'harv_02_0' },
    note: 'Meshy model, in matches (16 directions, wheels turning).',
    anims: {
      directions: 16,
      start: 2,
      list: [{ name: 'Drive', atlas: 'harvester', frames: (d) => range(8).map((i) => `harv_${String(d).padStart(2, '0')}_${i}`), fps: 12 }],
    },
  },
};

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
      kind: u.category === 'Infantry' ? 'infantry' : 'vehicle',
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
