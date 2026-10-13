import type { GridPoint, MatchStats, TeamId } from '@gravity-harvest/shared';
import type { Rock } from './ore.js';
import type { Scenery } from './scenery.js';

/**
 * Bump when the shape changes. Version 1 was the browser-side format (before the server ran matches);
 * version 2 had no scenery (still loads, as a bare map); version 3 had trees only (`trees`); before version 5 the
 * Assembly Yard was assumed (loading gives each side the scenario's one, where it fits).
 */
export const SNAPSHOT_VERSION = 5;
export const OLDEST_LOADABLE_VERSION = 2;

/**
 * Everything needed to resume a match. Plain JSON, stored server-side as the save's state; never sent to
 * players. Transient things (paths, timers, current targets) are not saved: units resume their default
 * behaviour on load (harvesters go back to work, guards return to their posts).
 */
export interface SimSnapshot {
  version: number;
  scenario: string;
  tick: number;
  timeMs: number;
  nextId: number;
  rng: number;
  /** `faction` since version 5 (older saves play the scenario's sides). */
  players: Record<TeamId, { credits: number; queue: { unit: string; progress: number; near?: GridPoint }[]; stats: MatchStats; faction?: 'ordan' | 'sable' }>;
  buildings: { id: number; type: string; team: TeamId; tx: number; ty: number; hp: number; progress: number; constructed: boolean; seenBy: TeamId[]; repairing?: boolean }[];
  units: { id: number; type: string; team: TeamId; gx: number; gy: number; hp: number; cargo?: number; field?: number; post?: GridPoint | null }[];
  ore: { tx: number; ty: number; field: number; richness: number; rocks: Rock[] }[];
  /** Since version 4 (version 3 called it `trees`). */
  scenery?: Scenery[];
  trees?: Scenery[];
  /** Per team, one char per tile: 1 = explored. */
  explored: Record<TeamId, string>;
}
