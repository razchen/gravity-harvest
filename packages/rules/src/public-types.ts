// The subset of rules the browser may see (generated into src/generated/public.ts).
import type { FactionScope, Stage } from './types.js';

interface PublicEntity {
  id: string;
  name: string;
  faction: FactionScope;
  role: string | null;
  cost: number;
  stage: Stage;
  buildTimeSec: number;
}

export interface PublicBuildingDef extends PublicEntity {
  /** One line on what it does (for players). */
  description: string | null;
  power: number;
  prerequisites: string[];
}

export interface PublicUnitDef extends PublicEntity {
  /** One line on what it does (for players). */
  description: string | null;
  category: string | null;
  producedAt: string[];
  prerequisites: string[][];
}
