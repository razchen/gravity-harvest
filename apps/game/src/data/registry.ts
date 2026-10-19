import type { PlayableFaction } from '@gravity-harvest/shared';

// The art registry: one entry per enabled unit and building, keyed by the rules ID (design/balance.xlsx). Everything
// else about an entity's look is derived from it by naming convention: the atlases the game loads (ATLASES in
// assets/manifest.ts), its card, and the art tables the game draws from (BUILDING_ART and UNIT_ART in data/art.ts).
// So adding an entity's art is one entry here. The content tests check it against the roster and the files on disk.

/**
 * A doorway in the building's lower-left face (the side the sim brings units out of), in its frame's pixels: the
 * opening's bottom-centre on the ground, and its width and height. Measured by eye on the door's open frame (a
 * door video's whole front moves as it opens, so the opening can't be told from the frames reliably).
 */
export interface Doorway {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A building: its construction atlas `b_<id>_build` (tools/blender/render_construction.py +
 * tools/sprites/pack_construction.py), whose last stage is the finished building and whose stages' shadows are frames
 * of the same atlas, and its card `assets/ui/<id>.png` (tools/sprites/make_cards.py).
 */
export interface BuildingEntry {
  /** Its construction atlas, where it isn't named `b_<id>_build`. */
  atlas?: string;
  /** The doorway units come out of, if it has a door (render/DoorExit.ts). */
  door?: Doorway;
  /**
   * A generated video's frames, keyed out (tools/sprites/key_video.py), in the atlas `<atlas>_video`: its running
   * animation (`loop`), or its door opening (`door`).
   */
  video?: 'loop' | 'door';
}

/**
 * A unit. Vehicles (the harvester and the hovering units too) are 16 directions in `v_<id>` (tools/blender/render_vehicle.py
 * + tools/sprites/pack_vehicles.py); infantry are 16 directions with a run cycle in `<id>`, and their death in
 * `<id>_death` (tools/blender/make_infantry.py + tools/sprites/pack_infantry.py). Its card is `assets/ui/<id>.png`.
 */
export interface UnitEntry {
  kind: 'harvester' | 'vehicle' | 'infantry';
  /**
   * How its shots look and sound, over the rules' projectile (the Hound's rules say it leaps and bites; the hovering
   * Hound fires a red energy ball from each side pod).
   */
  fire?: string;
  /** Its working loop (a Medic's arms healing, an Engineer's arm repairing): the clip atlas `<atlas>_<clip>`. */
  clip?: string;
  /**
   * A shared unit (the same rules for both sides) that each side builds to its own design: atlases `v_<id>_<side>`
   * and cards `assets/ui/<id>_<side>.png`. The first side's is its default look.
   */
  sides?: readonly PlayableFaction[];
  /** More rig clips the game plays (render_vehicle.py `clips`, frames `<dir>_<frame>`), each in `<atlas>_<name>`. */
  clips?: readonly string[];
  /** Whole other renders of it (frames `<dir>`, or one facing only), each in `<atlas>_<name>`. */
  variants?: readonly string[];
}

export const BUILDING_REGISTRY: Readonly<Record<string, BuildingEntry>> = {
  assembly_yard: { atlas: 'b_assembly_build' },
  power_plant: {},
  reactor_plant: { video: 'loop' },
  refinery: {},
  barracks: { door: { x: 108, y: 183, w: 50, h: 34 }, video: 'door' },
  radar: {},
  motor_works: { door: { x: 80, y: 188, w: 52, h: 36 }, video: 'door' },
  service_bay: {},
  gravity_lab: {},
  gravity_forge: {},
  sentry: {},
  lance_battery: {},
  incinerator: {},
  anchor: {},
  hound_kennel: {},
};

export const UNIT_REGISTRY: Readonly<Record<string, UnitEntry>> = {
  // its drums turning while it scoops ore; empty (no ore in its bed); tipping its bed out at a refinery's dock (a
  // generated video's frames, keyed out: tools/sprites/key_video.py vehicle; facing HARVESTER_DOCK_FACING only)
  harvester: { kind: 'harvester', clips: ['harvest'], variants: ['empty', 'unload'] },
  skimmer: { kind: 'vehicle', fire: 'rapid autocannon' },
  jackal: { kind: 'vehicle', fire: 'light shell' },
  ram: { kind: 'vehicle', fire: 'battle shell' },
  spire: { kind: 'vehicle', fire: 'artillery shell' },
  // its side doors dropping into ramps (closed → open; played backwards to shut), for its passengers
  carrier: { kind: 'vehicle', fire: 'heavy autocannon', clips: ['door'] },
  watcher: { kind: 'vehicle' },
  shroud: { kind: 'vehicle' },
  seeder: { kind: 'vehicle' },
  assembler: { kind: 'vehicle' },
  hound: { kind: 'vehicle', fire: 'twin plasma' },
  rifleman: { kind: 'infantry' },
  medic: { kind: 'vehicle', clip: 'heal' },
  raider: { kind: 'vehicle' },
  infiltrator: { kind: 'vehicle' },
  grenadier: { kind: 'vehicle', fire: 'frag grenade' },
  breaker: { kind: 'vehicle', fire: 'light column' },
  lancer: { kind: 'vehicle', fire: 'guided missile', sides: ['ordan', 'sable'] },
  operator: { kind: 'vehicle', fire: 'arc bolt', sides: ['ordan', 'sable'] },
  engineer: { kind: 'vehicle', clip: 'work', sides: ['ordan', 'sable'] },
};

/** An atlas the game loads: its texture key (also its file name in public/assets/sprites) and a frame every copy has. */
export interface RegistryAtlas {
  key: string;
  firstFrame: string;
}

/** A building's construction atlas. */
export const buildingAtlas = (id: string): string => BUILDING_REGISTRY[id]?.atlas ?? `b_${id}_build`;

/** A building's atlases: its construction stages, and its video if it has one. */
export function buildingAtlases(id: string): RegistryAtlas[] {
  const atlas = buildingAtlas(id);
  const video = BUILDING_REGISTRY[id].video;
  return [
    { key: atlas, firstFrame: `${atlas}_stage_1` },
    ...(video ? [{ key: `${atlas}_video`, firstFrame: video === 'door' ? `${atlas}_door_0` : `${atlas}_video_0` }] : []),
  ];
}

/** A unit's main atlas on each of its designs: one, or one per side. */
export function unitSprites(id: string): { side?: PlayableFaction; sprite: string; card: string }[] {
  const e = UNIT_REGISTRY[id];
  if (e.sides) return e.sides.map((side) => ({ side, sprite: `v_${id}_${side}`, card: `assets/ui/${id}_${side}.png` }));
  return [{ sprite: e.kind === 'infantry' ? id : `v_${id}`, card: `assets/ui/${id}.png` }];
}

/** A unit's atlases, for each of its designs: its body, its death or clips, and its other renders. */
export function unitAtlases(id: string): RegistryAtlas[] {
  const e = UNIT_REGISTRY[id];
  return unitSprites(id).flatMap(({ sprite }) => {
    if (e.kind === 'infantry') return [{ key: sprite, firstFrame: 'inf_0_idle' }, { key: `${sprite}_death`, firstFrame: 'inf_0_die_0' }];
    const clips = [...(e.clip ? [e.clip] : []), ...(e.clips ?? [])];
    return [
      { key: sprite, firstFrame: `${sprite}_0` },
      ...clips.map((c) => ({ key: `${sprite}_${c}`, firstFrame: `${sprite}_${c}_0_0` })),
      ...(e.variants ?? []).map((v) => ({ key: `${sprite}_${v}`, firstFrame: `${sprite}_${v}_0` })),
    ];
  });
}
