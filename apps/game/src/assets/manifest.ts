import type { EffectPoint } from '../render/BuildingFx';
// Every sprite atlas the game loads. Atlases are rendered in Blender by tools/blender/*.py and
// written to public/assets/sprites as <file>.png + <file>.json (Phaser "JSON Hash" + a `meta` block).

export interface AtlasEntry {
  /** Texture key used in code. */
  key: string;
  /** File name (without extension) in public/assets/sprites. */
  file: string;
  /** A frame that exists in every atlas, used to read the frame size. */
  firstFrame: string;
}

export const ATLASES: AtlasEntry[] = [
  { key: 'scenery', file: 'scenery', firstFrame: 'olive' },
  { key: 'harvester', file: 'harvester', firstFrame: 'harv_00_0' },
  { key: 'rifleman', file: 'rifleman', firstFrame: 'inf_0_idle' },
  { key: 'rifleman_death', file: 'rifleman_death', firstFrame: 'inf_0_die_0' },
  { key: 'medic', file: 'medic', firstFrame: 'inf_0_idle' },
  { key: 'medic_death', file: 'medic_death', firstFrame: 'inf_0_die_0' },
  { key: 'raider', file: 'raider', firstFrame: 'inf_0_idle' },
  { key: 'raider_death', file: 'raider_death', firstFrame: 'inf_0_die_0' },
  { key: 'infiltrator', file: 'infiltrator', firstFrame: 'inf_0_idle' },
  { key: 'infiltrator_death', file: 'infiltrator_death', firstFrame: 'inf_0_die_0' },
  // vehicles: 16 directions each (tools/blender/render_vehicle.py + tools/sprites/pack_vehicles.py)
  { key: 'v_skimmer', file: 'v_skimmer', firstFrame: 'v_skimmer_0' },
  { key: 'v_jackal', file: 'v_jackal', firstFrame: 'v_jackal_0' },
  { key: 'v_ram', file: 'v_ram', firstFrame: 'v_ram_0' },
  { key: 'v_spire', file: 'v_spire', firstFrame: 'v_spire_0' },
  { key: 'v_carrier', file: 'v_carrier', firstFrame: 'v_carrier_0' },
  { key: 'v_watcher', file: 'v_watcher', firstFrame: 'v_watcher_0' },
  { key: 'v_shroud', file: 'v_shroud', firstFrame: 'v_shroud_0' },
  { key: 'v_seeder', file: 'v_seeder', firstFrame: 'v_seeder_0' },
  { key: 'v_assembler', file: 'v_assembler', firstFrame: 'v_assembler_0' },
  // buildings: their construction stages (tools/blender/render_construction.py + tools/sprites/pack_construction.py);
  // the last stage is the finished building, and each stage's shadow is a frame of the same atlas
  { key: 'b_assembly_build', file: 'b_assembly_build', firstFrame: 'b_assembly_build_stage_1' },
  { key: 'b_power_plant_build', file: 'b_power_plant_build', firstFrame: 'b_power_plant_build_stage_1' },
  { key: 'b_reactor_plant_build', file: 'b_reactor_plant_build', firstFrame: 'b_reactor_plant_build_stage_1' },
  // its running animation is a generated video's frames, keyed out (tools/sprites/key_video.py)
  { key: 'b_reactor_plant_build_video', file: 'b_reactor_plant_build_video', firstFrame: 'b_reactor_plant_build_video_0' },
  { key: 'b_refinery_build', file: 'b_refinery_build', firstFrame: 'b_refinery_build_stage_1' },
  { key: 'b_barracks_build', file: 'b_barracks_build', firstFrame: 'b_barracks_build_stage_1' },
  { key: 'b_barracks_build_video', file: 'b_barracks_build_video', firstFrame: 'b_barracks_build_door_0' },
  { key: 'b_radar_build', file: 'b_radar_build', firstFrame: 'b_radar_build_stage_1' },
  { key: 'b_motor_works_build', file: 'b_motor_works_build', firstFrame: 'b_motor_works_build_stage_1' },
  { key: 'b_motor_works_build_video', file: 'b_motor_works_build_video', firstFrame: 'b_motor_works_build_door_0' },
  { key: 'b_service_bay_build', file: 'b_service_bay_build', firstFrame: 'b_service_bay_build_stage_1' },
  { key: 'b_gravity_lab_build', file: 'b_gravity_lab_build', firstFrame: 'b_gravity_lab_build_stage_1' },
  { key: 'b_gravity_forge_build', file: 'b_gravity_forge_build', firstFrame: 'b_gravity_forge_build_stage_1' },
  { key: 'b_sentry_build', file: 'b_sentry_build', firstFrame: 'b_sentry_build_stage_1' },
  { key: 'b_lance_battery_build', file: 'b_lance_battery_build', firstFrame: 'b_lance_battery_build_stage_1' },
  { key: 'b_incinerator_build', file: 'b_incinerator_build', firstFrame: 'b_incinerator_build_stage_1' },
  { key: 'b_anchor_build', file: 'b_anchor_build', firstFrame: 'b_anchor_build_stage_1' },
  { key: 'b_hound_kennel_build', file: 'b_hound_kennel_build', firstFrame: 'b_hound_kennel_build_stage_1' },
];

/** A construction atlas's finished building: its last stage frame, and that stage's shadow mask. */
export function finishedFrames(atlas: string): { body: string; shadow: string } {
  const n = sprites[atlas]?.construction?.stages.length ?? 5;
  return { body: `${atlas}_stage_${n}`, shadow: `${atlas}_shadow_${n}` };
}

export const TERRAIN = { earth: { key: 'terrain_earth', file: 'assets/terrain/dry_earth.png' } };

/** The `meta` block each atlas JSON carries, plus the frame size read at load time. */
export interface SpriteMeta {
  /** Pixel in the frame where the object's ground centre sits. */
  anchor: { x: number; y: number };
  w: number;
  h: number;
  fps?: number;
  frames?: number;
  /** Antenna-tip pixels for blinking beacons. */
  lights?: { x: number; y: number }[];
  /** Infantry: directions and frames per run cycle (tools/blender/make_infantry.py). */
  directions?: number;
  run_frames?: number;
  /** Infantry: rifle muzzle pixel per direction (idle stance). */
  muzzle?: { x: number; y: number }[];
  /** Infantry death atlas (tools/blender/make_infantry.py): frames per direction (they play at `fps`). */
  death_frames?: number;
  /** Vehicles: frames of their wheels turning (`<key>_w<d>_<f>`), drawn over them while they drive. */
  wheel_frames?: number;
  /**
   * Vehicles whose turret turns on its own (tools/blender/render_vehicle.py `rig`): their hull without it
   * (`<key>_h<d>`), and the turret alone (`<key>_t<t>`, `directions` of them) drawn over it with its anchor at `pivot[d]`
   * (frame pixels from the hull's anchor, per hull direction); its gun fires from `muzzle[t]` (from the turret's anchor).
   */
  turret_layer?: { directions: number; pivot: { x: number; y: number }[]; muzzle: { x: number; y: number }[] };
  /** Art rendered at `res` x the game's art scale; draw at 1 / res. */
  res?: number;
  /** Ore and tree atlases: one anchor per frame. */
  anchors?: Record<string, { x: number; y: number }>;
  /** Construction atlases (tools/sprites/pack_construction.py): the stages, in order. */
  construction?: { stages: ConstructionStage[] };
  /** Buildings: points on the roofs where a damaged building smokes and burns. */
  damage?: { spots: [number, number][] };
  /** Turrets: frames `<atlas>_turn_<d>` (and `_turnshadow_<d>`) with the head facing direction d; rest = the last stage's. */
  turret?: { directions: number; rest: number };
  /**
   * Buildings' animations (render_construction.py `anims`): `<atlas>_anim_base` (finished, without the moving parts)
   * with `<atlas>_<name>_<f>` over it; `when` always (while powered), working (while busy) or door (opens when a unit
   * comes out).
   */
  anims?: { name: string; when: 'always' | 'working' | 'door'; frames: number; fps: number }[];
  /** Points the game draws running effects at (render/BuildingFx.ts). */
  effects?: EffectPoint[];
  /**
   * A building's generated video (tools/sprites/key_video.py, `<atlas>_video`): its running loop (`frames`) or its
   * door opening (`door.frames`, closed at 0), at `fps`.
   */
  video?: { frames?: number; fps: number; door?: { frames: number } };
}

/** A construction stage: its name and the frame pixels its arrival effects use. */
export interface ConstructionStage {
  name: string;
  /** Points on the new parts' edges: where welding sparks fly as they arrive. */
  welds: [number, number][];
  /** Points where the new parts meet what's below them: where dust puffs up. */
  dust: [number, number][];
}

/** Filled by BootScene once atlases are loaded. */
export const sprites: Record<string, SpriteMeta> = {};

export function meta(key: string): SpriteMeta {
  const m = sprites[key];
  if (!m) throw new Error(`No sprite meta for "${key}" (is it in ATLASES?)`);
  return m;
}

/** Set a sprite's origin so `anchor` lands on its position. */
export function anchorOrigin(m: SpriteMeta): [number, number] {
  return [m.anchor.x / m.w, m.anchor.y / m.h];
}
