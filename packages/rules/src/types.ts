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
  // Rule data (not read by the simulation yet). See docs/rules/engine-rules.md.
  /** Splash falloff: damage at distance r = damage ÷ (r ÷ step), up to ÷16 (tiles). */
  falloffStepTiles?: number | null;
  damagesWalls?: boolean | null;
  damagesWoodenWalls?: boolean | null;
  /** A blast removes ore from its tile (damage ÷ 40 units). */
  damagesOre?: boolean | null;
  ruleNotes?: string | null;
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
  // Rule data (not read by the simulation yet). See docs/rules/engine-rules.md.
  /** Tiles per second; null for instant-hit weapons. Arcing shots fly faster the further the target. */
  projectileSpeedTilesPerSec?: number | null;
  instantHit?: boolean | null;
  /** Degrees per second; null if not homing. */
  homingTurnDegPerSec?: number | null;
  /** Scatters even when the shooter stands still. */
  inaccurate?: boolean | null;
  arcing?: boolean | null;
  /** False: bursts on walls that block low shots. */
  fliesOverWalls?: boolean | null;
  hitsAir?: boolean | null;
  hitsGround?: boolean | null;
  hitsSubmerged?: boolean | null;
  /** Projectile 1.5× faster against aircraft. */
  fasterVsAircraft?: boolean | null;
  chargeUp?: boolean | null;
  ruleNotes?: string | null;
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
  // Rule data (not read by the simulation yet). See docs/rules/engine-rules.md.
  capturable?: boolean | null;
  /** Crew that walk out when it is sold or destroyed (0 = none). */
  survivors?: number | null;
  repairable?: boolean | null;
  /** 1: within a one-tile gap of a building that extends the base; above 1: up to that many tiles. */
  placementAdjacency?: number | null;
  /** Other buildings may be placed next to it. */
  extendsBase?: boolean | null;
  waterPlacement?: boolean | null;
  /** Degrees per second; null: no turret. */
  turretTurnDegPerSec?: number | null;
  ammo?: number | null;
  wallDamageLevels?: number | null;
  /** Damage that takes one wall level off (already ×4). */
  wallDamagePerLevel?: number | null;
  crushableWall?: boolean | null;
  blocksLowShots?: boolean | null;
  ruleNotes?: string | null;
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
  // Rule data (not read by the simulation yet). See docs/rules/engine-rules.md.
  /** Degrees per second; null: turns at once. */
  turnDegPerSec?: number | null;
  crushable?: boolean | null;
  crushes?: boolean | null;
  /** Chance (0-1) a crew member survives its destruction. */
  survivorChance?: number | null;
  /** Heals itself for free up to half health. */
  selfHeals?: boolean | null;
  explodesOnDeath?: boolean | null;
  deathExplosionDamage?: number | null;
  deathExplosionRadiusTiles?: number | null;
  cloaks?: boolean | null;
  detectsCloaked?: boolean | null;
  cantFireMoving?: boolean | null;
  /** Null: its weapon range. */
  guardRangeTiles?: number | null;
  ruleNotes?: string | null;
}

export interface AbilityDef {
  id: string;
  name: string;
  faction: FactionScope;
  grantedBy: string;
  rechargeSec: number;
  notes: string | null;
  // Rule data (not read by the simulation yet).
  targets?: string | null;
  /** Already ×4. */
  damage?: number | null;
  damageClass?: string | null;
  radiusTiles?: number | null;
  durationSec?: number | null;
  arrives?: string | null;
  count?: number | null;
  delaySec?: number | null;
  warnsOpponent?: boolean | null;
  /** Stops charging on low power (keeps its progress). */
  pausesOnLowPower?: boolean | null;
  ruleNotes?: string | null;
}

export type EngineRuleStatus = 'In game' | 'Ours differs (kept)' | 'Ours differs (not changed)' | 'Not in game yet' | 'Proposed';

/** One row of the Engine Rules sheet: how the rules behave. Data only: the simulation does not read it yet. */
export interface EngineRuleDef {
  id: string;
  topic: string | null;
  rule: string | null;
  /** A number (scaled like the rest of the workbook), a yes/no, a short formula or text, or null. */
  value: number | boolean | string | null;
  unit: string | null;
  /** Whether our game already works this way. */
  inGame: EngineRuleStatus;
  notes: string | null;
}

/** A crate pick-up (not in the game yet). */
export interface CrateDef {
  id: string;
  name: string | null;
  /** Weight in the random pick. */
  shares: number | null;
  /** shares ÷ total shares. */
  chance: number | null;
  effect: string | null;
  value: number | null;
  unit: string | null;
  notes: string | null;
}
