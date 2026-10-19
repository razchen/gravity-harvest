// Full rules: server and simulation only. The browser must import '@gravity-harvest/rules/public'.
import { BUILDINGS, UNITS } from './generated/balance.js';
import type { Catalog } from './deps.js';

export * from './types.js';
export * from './generated/balance.js';
export * from './calc.js';
export * from './deps.js';
export * from './capabilities.js';

/** The full catalog, for the dependency helpers in deps.ts. */
export const CATALOG: Catalog = { buildings: BUILDINGS, units: UNITS };
