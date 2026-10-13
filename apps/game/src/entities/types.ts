import type { BuildingSprite } from './BuildingSprite';
import type { UnitSprite } from './UnitSprite';

/** Anything that can be selected or targeted. */
export type Entity = BuildingSprite | UnitSprite;

export const isBuilding = (e: Entity): e is BuildingSprite => e.cat === 'building';
export const isUnit = (e: Entity): e is UnitSprite => e.cat === 'unit';
