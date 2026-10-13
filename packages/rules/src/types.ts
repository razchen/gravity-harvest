// Shapes of the rules data generated from design/balance.xlsx.

export type Faction = 'ordan' | 'sable';
export type FactionScope = Faction | 'both';
export type Armor = 'unarmored' | 'structure' | 'light' | 'heavy' | 'fortified';
export type Stage = 'establish' | 'economy' | 'warfare' | 'advanced' | 'strategic';

export const STAGES: readonly Stage[] = ['establish', 'economy', 'warfare', 'advanced', 'strategic'];
export const ARMORS: readonly Armor[] = ['unarmored', 'structure', 'light', 'heavy', 'fortified'];

export interface EconomyRules {
  startingCredits: number;
  /** Resource units per full harvester load. */
  harvesterCapacity: number;
  /** Credits per resource unit. */
  commonResourceValue: number;
  rareResourceValue: number;
  /** Fraction of cost returned when selling a building or cancelling production. */
  refundFraction: number;
  /** Cost of repairing a structure from 0 to full HP, as a fraction of its cost. */
  structureFullRepairFraction: number;
  unitFullRepairFraction: number;
  resourceRegrowth: boolean;
  resourceSpread: boolean;
  aiFirstAttackMinutes: number;
  aiAttackIntervalMinutes: number;
  aiDesiredPowerSurplus: number;
  /** Resource units in a full tile. */
  resourceTileMaxUnits: number;
  /** Average starting density of a field, as a fraction of full (the centre starts full, the edges thinner). */
  resourceStartDensity: number;
  /** Seconds between growth / spread ticks. */
  resourceGrowthIntervalSec: number;
  /** Per partly harvested tile per tick: chance to gain 1 unit (up to full). */
  resourceGrowthChance: number;
  /** Per emptied tile next to a tile at least half full, per tick: chance to grow back 1 unit. */
  resourceSpreadChance: number;
  /** Per emptied tile at the heart of a field (its roots), per tick: chance to grow back 1 unit on its own. */
  resourceRootRegrowthChance: number;
}

export interface DamageClassDef {
  name: string;
  /** Damage multiplier against each armor type. */
  vs: Record<Armor, number>;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Damage per hit (negative heals). Already normalized. */
  damage: number;
  fireIntervalSec: number;
  rangeTiles: number;
  /** Hits per firing. */
  burst: number;
  damageClass: string;
  projectile: string | null;
  targeting: string | null;
  notes: string | null;
}

export interface BuildingDef {
  id: string;
  name: string;
  faction: FactionScope;
  role: string | null;
  cost: number;
  hp: number;
  armor: Armor;
  sight: number;
  /** Positive produces power, negative consumes it. */
  power: number;
  stage: Stage;
  /** Building IDs you must own (all of them). */
  prerequisites: string[];
  buildTimeSec: number;
  /** Stops working on low power. */
  requiresPower: boolean;
  sensors: boolean;
  weapons: string[];
  notes: string | null;
  /** One line on what it does (for players). */
  description: string | null;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: FactionScope;
  category: string | null;
  role: string | null;
  cost: number;
  hp: number;
  armor: Armor;
  /** Spreadsheet speed units (see calc.speedToTilesPerSec). */
  speed: number;
  sight: number;
  stage: Stage;
  /** Buildings that can produce it (any one). */
  producedAt: string[];
  /** Extra building requirements; each entry is a set of alternatives (own any one). */
  prerequisites: string[][];
  buildTimeSec: number;
  weapons: string[];
  ammo: number | null;
  passengers: number;
  notes: string | null;
  /** One line on what it does (for players). */
  description: string | null;
}

export interface AbilityDef {
  id: string;
  name: string;
  faction: FactionScope;
  grantedBy: string;
  rechargeSec: number;
  notes: string | null;
}
