// Browser-safe rules: names, costs, power, build times, prerequisites (all of which the UI shows anyway).
// Never import ./index or ./generated/balance from here: that would ship the full rules to players.
import type { Catalog } from './deps.js';
import { PUBLIC_BUILDINGS, PUBLIC_UNITS } from './generated/public.js';

export type { PublicBuildingDef, PublicUnitDef } from './public-types.js';
export type { FactionScope, Stage } from './types.js';
export { PUBLIC_BUILDINGS, PUBLIC_ECONOMY, PUBLIC_UNITS } from './generated/public.js';
export { canBuild, missingRequirements, producersOf, productionOf, requirementsOf, type Catalog, type Requirement } from './deps.js';

export const PUBLIC_CATALOG: Catalog = { buildings: PUBLIC_BUILDINGS, units: PUBLIC_UNITS };
