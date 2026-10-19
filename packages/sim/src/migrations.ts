// Older saves, brought up to the current format one version at a time before a match is restored from them.
import { BUILDINGS } from '@gravity-harvest/rules';
import { DEFAULT_DIFFICULTY, type TeamId } from '@gravity-harvest/shared';
import { DOCK_FACING, footprint, sceneryKind } from './layout.js';
import { SCENARIOS } from './scenarios.js';
import { OLDEST_LOADABLE_VERSION, SNAPSHOT_VERSION, type SimSnapshot } from './snapshot.js';

/**
 * A save as it was stored at some older version. The old formats live on only as these steps, so they're handled as
 * loose JSON rather than given a type each.
 */
export type RawSave = Record<string, any>;
type Step = (s: RawSave) => RawSave;

/** The sides before version 9: `player` was always the human, in the scenario's first base (now seat `a`). */
type OldSide = 'player' | 'enemy';
const oldSide = (t: TeamId): OldSide => (t === 'a' ? 'player' : 'enemy');

/**
 * One step per version: `MIGRATIONS[n]` turns a version-`n` save into a version-`n + 1` one. Each step only knows the
 * two formats it sits between, and changes only what changed then.
 */
export const MIGRATIONS: Readonly<Record<number, Step>> = {
  // version 2 had no scenery: it loads as a bare map
  2: (s) => ({ ...s, version: 3, trees: s.trees ?? [] }),

  // version 3 kept only trees, as `trees`
  3: ({ trees, ...s }) => ({ ...s, version: 4, scenery: s.scenery ?? trees ?? [] }),

  // before version 5 the Assembly Yard was assumed: each side gets the scenario's one, where it fits; the sides play
  // the scenario's factions
  4: (s) => {
    const sc = SCENARIOS[s.scenario];
    if (!sc) return { ...s, version: 5 };
    const players: RawSave = {};
    for (const [side, p] of Object.entries(s.players as RawSave)) players[side] = { ...p, faction: p.faction ?? sc.players[side === 'player' ? 'a' : 'b'].faction };
    const buildings: RawSave[] = [...s.buildings];
    let nextId: number = s.nextId;
    const blocked = new Set<string>();
    const block = (tx: number, ty: number, n: number) => {
      for (let x = tx; x < tx + n; x++) for (let y = ty; y < ty + n; y++) blocked.add(`${x},${y}`);
    };
    for (const b of buildings) block(b.tx, b.ty, footprint(b.type));
    for (const t of s.scenery as { kind: string; tx: number; ty: number }[]) if (sceneryKind(t.kind).blocks) block(t.tx, t.ty, sceneryKind(t.kind).size);
    for (const y of sc.buildings.filter((b) => b.type === 'assembly_yard')) {
      const team = oldSide(y.team);
      if (buildings.some((b) => b.team === team && b.type === y.type)) continue;
      const n = footprint(y.type);
      let free = true;
      for (let x = y.tx; x < y.tx + n; x++) for (let z = y.ty; z < y.ty + n; z++) if (x < 0 || z < 0 || x >= sc.map.width || z >= sc.map.height || blocked.has(`${x},${z}`)) free = false;
      if (!free) continue;
      buildings.push({ id: nextId++, type: y.type, team, tx: y.tx, ty: y.ty, hp: BUILDINGS[y.type].hp, progress: 1, constructed: false, seenBy: [team] });
      block(y.tx, y.ty, n);
    }
    return { ...s, version: 5, players, buildings, nextId };
  },

  // version 6 added transports' passengers: none were riding before
  5: (s) => ({ ...s, version: 6 }),

  // version 7 added the computer's difficulty: older saves play Normal
  6: (s) => ({ ...s, version: 7, players: mapValues(s.players as Record<string, RawSave>, (p) => ({ ...p, difficulty: p.difficulty ?? DEFAULT_DIFFICULTY })) }),

  // version 8 added gravity vents: older saves have none
  7: (s) => ({ ...s, version: 8, vents: s.vents ?? [] }),

  // version 9 named the sides by seat, and records which seat the human plays
  8: (s) => {
    const seat = (t: TeamId | OldSide): TeamId => (t === 'player' ? 'a' : t === 'enemy' ? 'b' : t);
    const byOld = <T>(r: Record<string, T>): Record<TeamId, T> => ({ a: r.player, b: r.enemy });
    const players = byOld(s.players as Record<string, RawSave>);
    return {
      ...s,
      version: 9,
      players: { a: { ...players.a, human: true }, b: { ...players.b, human: false } },
      buildings: s.buildings.map((b: RawSave) => ({ ...b, team: seat(b.team), seenBy: b.seenBy.map(seat) })),
      units: s.units.map((u: RawSave) => ({ ...u, team: seat(u.team) })),
      explored: byOld(s.explored),
    };
  },

  // version 10 added the rules' hash and the computer players' memory, both optional
  9: (s) => ({ ...s, version: 10 }),

  // version 11 keeps what everything is doing. Older saves didn't: every unit starts idle (harvesters look for work
  // at once, guards keep their posts), buildings at rest, and what each side sees is worked out again on load (`live`)
  10: ({ live: _, ...s }) => ({
    ...s,
    version: 11,
    buildings: s.buildings.map((b: RawSave) => ({
      id: b.id, type: b.type, team: b.team, tx: b.tx, ty: b.ty, hp: b.hp, progress: b.progress, built: b.progress >= 1, constructed: b.constructed,
      seenBy: [...new Set([b.team, ...b.seenBy])], repairing: !!b.repairing, occupant: null, boost: 1, dir: -1, target: null, cools: [],
    })),
    units: s.units.map((u: RawSave) => (u.type === 'harvester' ? idleHarvester(u, s.ore) : idleFighter(u, u))),
  }),
};

function mapValues<T, U>(r: Record<string, T>, f: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, f(v)]));
}

const idleUnit = (u: RawSave, at: RawSave) => ({ id: u.id, type: u.type, team: at.team, gx: at.gx, gy: at.gy, hp: u.hp, path: [], moving: false, stuck: 0, detours: 0 });

/** An older save's harvester, idle and looking for work: its field (the nearest one if the save didn't say) and cargo. */
function idleHarvester(u: RawSave, ore: RawSave[]): RawSave {
  let field = u.field;
  if (field === undefined) {
    let best = Infinity;
    field = -1;
    for (const t of ore) {
      const d = Math.hypot(t.tx + 0.5 - u.gx, t.ty + 0.5 - u.gy);
      if (t.rocks.length && d < best) [best, field] = [d, t.field];
    }
  }
  return {
    ...idleUnit(u, u), kind: 'harvester', dir: DOCK_FACING, state: 'idle', cargo: u.cargo ?? 0, field, home: null, oreKey: null, lastOreKey: null, timer: 0,
    unloaded: 0, parked: false, retry: 0,
  };
}

/** An older save's fighter, idle at its post; its passengers (which kept only id, type and health) inside it. */
function idleFighter(u: RawSave, at: RawSave): RawSave {
  return {
    ...idleUnit(u, at), kind: 'fighter', dir: 14, mode: 'idle', target: null, mission: null, post: u.post ?? null, resume: null, attackMove: null, rest: null,
    cools: [], cool: 0, scan: 0, repath: 0, aim: -1, service: null, passengers: (u.passengers ?? []).map((p: RawSave) => idleFighter(p, at)),
    hatch: 'closed', hatchTimer: 0, gap: 0, unloading: false, board: null,
  };
}

/**
 * A save of any loadable version in the current format (a current one is returned as it is). Throws for a save from a
 * newer version, or one too old to load (version 1 was the browser's own format, from before the server ran matches).
 */
export function migrateSnapshot(saved: SimSnapshot | RawSave): SimSnapshot {
  if (saved.version > SNAPSHOT_VERSION) throw new Error('Save is from a newer version');
  if (!(saved.version >= OLDEST_LOADABLE_VERSION)) throw new Error('Save is from an older version and can no longer be loaded');
  let s = saved as RawSave;
  while (s.version < SNAPSHOT_VERSION) {
    const step = MIGRATIONS[s.version];
    if (!step) throw new Error(`No way to load a version-${s.version} save`);
    s = step(s);
  }
  return s as SimSnapshot;
}
