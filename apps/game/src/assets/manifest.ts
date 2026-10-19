import type { EffectPoint } from '../render/BuildingFx';
import { BUILDING_REGISTRY, UNIT_REGISTRY, buildingAtlases, unitAtlases } from '../data/registry';
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
  // every unit's and building's atlases, named after its registry entry (data/registry.ts)
  ...[...Object.keys(UNIT_REGISTRY).flatMap(unitAtlases), ...Object.keys(BUILDING_REGISTRY).flatMap(buildingAtlases)]
    .map((a) => ({ ...a, file: a.key })),
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
  /**
   * Hovering units (render_vehicle.py `hover`): it floats `height_px` (frame pixels) over its ground centre, its shadow
   * alone in `<key>_s<d>`, and its lights glow `glow` (linear RGB, 0..1) on the ground under it.
   */
  hover?: { height_px: number; glow: [number, number, number] };
  /** Units with guns but no turret (render_vehicle.py `muzzle`): their tips per direction, frame pixels from the anchor. */
  muzzles?: { x: number; y: number }[][];
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
