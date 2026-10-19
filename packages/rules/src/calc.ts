// Calculations on the rules data. Pure functions; the simulation and tools call these instead of
// re-deriving numbers. Spreadsheet values are already normalized: nothing here re-applies scale factors.
import { BUILDINGS, DAMAGE_MATRIX, ECONOMY, UNITS, WEAPONS } from './generated/balance.js';
import type { Armor, BuildingDef, UnitDef, WeaponDef } from './types.js';

// --- Engine constants (not in the spreadsheet: they translate its units into the simulation's) ---------

export const ENGINE = {
  /**
   * Tiles per second per spreadsheet speed point. Rifleman (speed 4) → 1.4 tiles/s, Harvester (6) → 2.1 tiles/s,
   * fast aircraft (20) → 7 tiles/s. Tuned for the 64 x 32 tile scale.
   */
  tilesPerSecPerSpeed: 0.35,
} as const;

export const speedToTilesPerSec = (speed: number): number => speed * ENGINE.tilesPerSecPerSpeed;

// --- Lookups ---------------------------------------------------------------------------------------------

export function weapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`Unknown weapon "${id}"`);
  return w;
}

export function entity(id: string): BuildingDef | UnitDef {
  const e = BUILDINGS[id] ?? UNITS[id];
  if (!e) throw new Error(`Unknown entity "${id}"`);
  return e;
}

// --- Combat ------------------------------------------------------------------------------------------------

/** Damage-matrix multiplier for a damage class against an armor type. */
export function damageMultiplier(damageClass: string, armor: Armor): number {
  const dc = DAMAGE_MATRIX[damageClass];
  if (!dc) throw new Error(`Unknown damage class "${damageClass}"`);
  return dc.vs[armor];
}

/** Damage of one hit after armor. Negative = healing. */
export function hitDamage(weaponId: string, targetArmor: Armor): number {
  const w = weapon(weaponId);
  return w.damage * damageMultiplier(w.damageClass, targetArmor);
}

// --- Targeting ---------------------------------------------------------------------------------------------

/** Where something is, as far as weapons go: aircraft fly, everything else (buildings too) is on the ground. */
export type Layer = 'ground' | 'air';

export function layerOf(id: string): Layer {
  return UNITS[id]?.category === 'Aircraft' ? 'air' : 'ground';
}

/** Whether a weapon reaches this layer, from its targeting ("ground", "air", "air / ground", "surface"...; none = ground). */
export function canHit(weaponId: string, layer: Layer): boolean {
  const t = weapon(weaponId).targeting;
  if (layer === 'air') return !!t && /air/.test(t);
  return !t || /ground|surface|structure|personnel|armor|light|infantry/.test(t);
}

/** The weapon an entity uses on something in this layer: the first of its weapons that reaches it, if any. */
export function weaponFor(weapons: readonly string[], layer: Layer): string | null {
  return weapons.find((w) => canHit(w, layer)) ?? null;
}

/** Damage per firing (all hits of a burst) after armor. */
export function volleyDamage(weaponId: string, targetArmor: Armor): number {
  return hitDamage(weaponId, targetArmor) * weapon(weaponId).burst;
}

/** Damage per second before armor: damage × burst ÷ fire interval. */
export function rawDps(weaponId: string): number {
  const w = weapon(weaponId);
  return (w.damage * w.burst) / w.fireIntervalSec;
}

/** Damage per second against an armor type. */
export function effectiveDps(weaponId: string, targetArmor: Armor): number {
  return volleyDamage(weaponId, targetArmor) / weapon(weaponId).fireIntervalSec;
}

/** Combined DPS of everything an entity carries (both weapons fire independently). */
export function loadoutDps(entityId: string, targetArmor: Armor): number {
  return entity(entityId).weapons.reduce((sum, w) => sum + effectiveDps(w, targetArmor), 0);
}

/**
 * Seconds for one weapon to destroy a target, assuming the first volley fires immediately and every hit lands.
 * Infinity if the weapon can't hurt that armor.
 */
export function timeToKillSec(weaponId: string, targetId: string): number {
  const target = entity(targetId);
  const perVolley = volleyDamage(weaponId, target.armor);
  if (perVolley <= 0) return Infinity;
  const volleys = Math.ceil(target.hp / perVolley);
  return (volleys - 1) * weapon(weaponId).fireIntervalSec;
}

/** Longest range of an entity's weapons (0 if unarmed). */
export function maxRange(entityId: string): number {
  return Math.max(0, ...entity(entityId).weapons.map((w) => weapon(w).rangeTiles));
}

// --- Economy -------------------------------------------------------------------------------------------------

export type ResourceKind = 'common' | 'rare';

/** Credits per resource unit. */
export const resourceValue = (kind: ResourceKind): number => (kind === 'rare' ? ECONOMY.rareResourceValue : ECONOMY.commonResourceValue);

/** Credits for unloading `units` of a resource (no storage cap: all of it becomes credits). */
export const creditsFor = (units: number, kind: ResourceKind): number => units * resourceValue(kind);

/** Credits for a full harvester load. */
export const fullLoadCredits = (kind: ResourceKind): number => creditsFor(ECONOMY.harvesterCapacity, kind);

/** Credits returned when selling a building or cancelling production. */
export const refundFor = (cost: number): number => Math.floor(cost * ECONOMY.refundFraction);

/** Cost to repair a structure or unit by `hpFraction` (0..1) of its max HP. */
export function repairCost(entityId: string, hpFraction: number): number {
  const e = entity(entityId);
  const full = e.id in BUILDINGS ? ECONOMY.structureFullRepairFraction : ECONOMY.unitFullRepairFraction;
  return e.cost * full * Math.max(0, Math.min(1, hpFraction));
}

export const buildTimeMs = (entityId: string): number => entity(entityId).buildTimeSec * 1000;

// --- Power -----------------------------------------------------------------------------------------------------

export interface PowerBalance {
  produced: number;
  consumed: number;
  /** produced - consumed */
  surplus: number;
  low: boolean;
}

/** Power from a list of finished building IDs (duplicates count). Low power = consumption exceeds production. */
export function powerBalance(buildingIds: Iterable<string>): PowerBalance {
  let produced = 0;
  let consumed = 0;
  for (const id of buildingIds) {
    const b = BUILDINGS[id];
    if (!b) throw new Error(`Unknown building "${id}"`);
    if (b.power > 0) produced += b.power;
    else consumed -= b.power;
  }
  return { produced, consumed, surplus: produced - consumed, low: consumed > produced };
}

/** Whether a building does its job right now (buildings that require power stop on low power). */
export const isOperational = (buildingId: string, power: PowerBalance): boolean =>
  !(BUILDINGS[buildingId]?.requiresPower && power.low);

// --- Validation ------------------------------------------------------------------------------------------------

/** Problems with the combat data: unknown weapons or damage classes. Empty = consistent. */
export function validateCombat(): string[] {
  const problems: string[] = [];
  for (const w of Object.values(WEAPONS)) if (!DAMAGE_MATRIX[w.damageClass]) problems.push(`${w.id}: unknown damage class "${w.damageClass}"`);
  for (const e of [...Object.values(BUILDINGS), ...Object.values(UNITS)]) {
    for (const w of e.weapons) if (!WEAPONS[w]) problems.push(`${e.id}: unknown weapon "${w}"`);
  }
  return problems;
}
