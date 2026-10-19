import type { Difficulty, GridPoint, MatchStats, TeamId } from '@gravity-harvest/shared';
import type { Rock, Vent } from './ore.js';
import type { Scenery } from './scenery.js';

/**
 * Bump when the shape changes. Version 1 was the browser-side format (before the server ran matches);
 * version 2 had no scenery (still loads, as a bare map); version 3 had trees only (`trees`); before version 5 the
 * Assembly Yard was assumed (loading gives each side the scenario's one, where it fits); version 6 added transports'
 * passengers; version 7 added the computer's difficulty (older saves play Normal); version 8 added gravity vents
 * (older saves have none, and play on as they were); version 9 named the sides by seat (`a`, `b`) instead of
 * `player` and `enemy`, and records which seat the human plays (`human`). Older saves are migrated on load
 * (`migrateSnapshot`).
 */
export const SNAPSHOT_VERSION = 9;
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
  /**
   * `faction` since version 5 (older saves play the scenario's sides); `difficulty` since version 7; `human` (a person
   * plays this seat, not the computer) since version 9.
   */
  players: Record<TeamId, { credits: number; queue: { unit: string; progress: number; near?: GridPoint }[]; stats: MatchStats; human?: boolean; faction?: 'ordan' | 'sable'; difficulty?: Difficulty }>;
  buildings: { id: number; type: string; team: TeamId; tx: number; ty: number; hp: number; progress: number; constructed: boolean; seenBy: TeamId[]; repairing?: boolean }[];
  /** `passengers`: who rides in a transport (since version 6). */
  units: {
    id: number; type: string; team: TeamId; gx: number; gy: number; hp: number; cargo?: number; field?: number; post?: GridPoint | null;
    passengers?: { id: number; type: string; hp: number }[];
  }[];
  ore: { tx: number; ty: number; field: number; richness: number; rocks: Rock[] }[];
  /** Gravity vents and the ore field each seeds (since version 8; the vent itself is in `scenery`). */
  vents?: Vent[];
  /** Since version 4 (version 3 called it `trees`). */
  scenery?: Scenery[];
  trees?: Scenery[];
  /** Per team, one char per tile: 1 = explored. */
  explored: Record<TeamId, string>;
}

/**
 * Before version 9 the sides were `player` (always the human, in the scenario's first base: now seat `a`) and `enemy`
 * (the computer, in the second: seat `b`). Renames them in an older save, so the rest of loading only knows seats.
 * A current save is returned as it is.
 */
export function migrateSnapshot(raw: SimSnapshot): SimSnapshot {
  if (raw.version >= 9) return raw;
  type Old = 'player' | 'enemy';
  const seat = (t: TeamId | Old): TeamId => (t === 'player' ? 'a' : t === 'enemy' ? 'b' : t);
  const byOld = <T>(r: Record<string, T>): Record<TeamId, T> => ({ a: r.player, b: r.enemy });
  const players = byOld(raw.players);
  return {
    ...raw,
    players: { a: { ...players.a, human: true }, b: { ...players.b, human: false } },
    buildings: raw.buildings.map((b) => ({ ...b, team: seat(b.team), seenBy: b.seenBy.map(seat) })),
    units: raw.units.map((u) => ({ ...u, team: seat(u.team) })),
    explored: byOld(raw.explored),
  };
}
