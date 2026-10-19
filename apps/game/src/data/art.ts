import type { PlayableFaction } from '@gravity-harvest/shared';
import { BUILDING_REGISTRY, UNIT_REGISTRY, buildingAtlas, unitSprites, type Doorway } from './registry';

export type { Doorway } from './registry';

// How each enabled entity looks, as the game reads it. Keyed by the rules ID (design/balance.xlsx), and derived from
// the art registry (data/registry.ts): add art there, not here. Gameplay numbers are not here: the server owns them,
// and sends the browser only the roster's names, costs and prerequisites (MatchCatalog).

export interface BuildingArt {
  /** Its construction atlas (assets/manifest.ts): it goes up stage by stage, and the last stage is the finished building. */
  sprite: string;
  /** Build-panel card image. */
  card: string;
  /** The doorway units come out of, if it has a door (render/DoorExit.ts). */
  door?: Doorway;
}

export interface UnitArt {
  /** Atlas key. */
  sprite: string;
  card: string;
  /**
   * Vehicles, the harvester too, are 16 directions (`v_<id>_<d>`, tools/blender/render_vehicle.py; the harvester's
   * drums turn in its `v_harvester_harvest` clip); infantry 16 directions with a run cycle, and their death in `<sprite>_death`
   * (tools/blender/make_infantry.py).
   */
  kind: 'harvester' | 'vehicle' | 'infantry';
  /**
   * How its shots look and sound, over the rules' projectile (the Hound's rules say it leaps and bites; the hovering
   * Hound fires a red energy ball from each side pod).
   */
  fire?: string;
  /** Its working loop (a Medic's arms healing, an Engineer's arm repairing): the clip atlas `<sprite>_<clip>`. */
  clip?: string;
  /** A shared unit (the same rules for both sides) that each side builds to its own design: its atlas and card per side. */
  sides?: Partial<Record<PlayableFaction, { sprite: string; card: string }>>;
}

/** How a unit of `type` looks on `faction`'s side: its own design where it has one per side. */
export function unitArt(type: string, faction: PlayableFaction | null | undefined): UnitArt | undefined {
  const a = UNIT_ART[type];
  const side = faction ? a?.sides?.[faction] : undefined;
  return side ? { ...a, ...side } : a;
}

/** Each side's energy colour: its hovering units' lights and their lasers, beams and energy balls. */
export const SIDE_GLOW: Readonly<Record<PlayableFaction, number>> = { ordan: 0xa04cff, sable: 0xff2a1a };

export const BUILDING_ART: Readonly<Record<string, BuildingArt>> = Object.fromEntries(
  Object.entries(BUILDING_REGISTRY).map(([id, e]) => [id, { sprite: buildingAtlas(id), card: `assets/ui/${id}.png`, ...(e.door && { door: e.door }) }]),
);

export const UNIT_ART: Readonly<Record<string, UnitArt>> = Object.fromEntries(
  Object.entries(UNIT_REGISTRY).map(([id, e]): [string, UnitArt] => {
    const looks = unitSprites(id);
    const art: UnitArt = { sprite: looks[0].sprite, card: looks[0].card, kind: e.kind, ...(e.fire && { fire: e.fire }), ...(e.clip && { clip: e.clip }) };
    if (e.sides) art.sides = Object.fromEntries(looks.map((l) => [l.side, { sprite: l.sprite, card: l.card }]));
    return [id, art];
  }),
);
