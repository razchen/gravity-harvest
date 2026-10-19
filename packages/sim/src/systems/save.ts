// Saves: the whole match as plain JSON, and saved units and buildings back on the map (the format is snapshot.ts).
import { RULES_HASH } from '@gravity-harvest/rules';
import { TEAMS, perTeam, type TeamId } from '@gravity-harvest/shared';
import { sceneryKind } from '../layout.js';
import { migrateSnapshot, type RawSave } from '../migrations.js';
import { SCENARIOS, scenarioHash } from '../scenarios.js';
import { SNAPSHOT_VERSION, type SavedBuilding, type SavedFighter, type SavedUnit, type SimSnapshot } from '../snapshot.js';
import type { Building, Fighter, Unit } from '../entities.js';
import { SimState } from '../state.js';
import { addBuilding, addUnit } from './lifecycle.js';
import { refresh } from './power.js';
import { buildingView } from './views.js';
import { updateFog } from './visibility.js';

/**
 * Carry on a saved match exactly where it was (an older save is migrated first; it loads with every unit idle). The
 * scenario is rebuilt from code: a save made on an earlier version of its map still loads (see `saveWarnings`).
 */
export function restoreMatch(saved: SimSnapshot | RawSave): SimState {
  const raw = migrateSnapshot(saved);
  const sc = SCENARIOS[raw.scenario];
  if (!sc) throw new Error(`Unknown scenario "${raw.scenario}"`);
  const s = new SimState(sc, raw.rng);
  s.tick = raw.tick;
  s.timeMs = raw.timeMs;
  for (const team of TEAMS) {
    const p = raw.players[team];
    Object.assign(s.players[team], { credits: p.credits, queue: p.queue.map((q) => ({ ...q })), stats: { ...p.stats }, human: p.human, faction: p.faction, difficulty: p.difficulty });
    s.fog[team].restoreExplored(raw.explored[team]);
  }
  for (const b of raw.buildings) restoreBuilding(s, b);
  s.scenery = raw.scenery.map((t) => ({ ...t }));
  for (const t of s.scenery) {
    const k = sceneryKind(t.kind);
    if (k.blocks) s.map.setFootprint(t.tx, t.ty, k.size, true);
  }
  for (const t of raw.ore) s.ore.tiles.set(s.map.key(t.tx, t.ty), { ...t, rocks: t.rocks.map((r) => ({ ...r })) });
  for (const v of raw.vents) s.ore.vents.push({ ...v });
  for (const u of raw.units) restoreUnit(s, u);
  s.nextId = raw.nextId;
  // (making the units drew from the generator: it carries on from where the save left it)
  s.rng.state = raw.rng;
  const live = raw.live;
  if (live) {
    for (const t of TEAMS) {
      s.fog[t].restore(live.fog[t]);
      s.fog[t].revealAll = live.revealAll[t];
      for (const g of live.ghosts[t]) s.ghosts[t].set(g.id, { ...g });
      s.power[t] = { ...live.power[t] };
      s.fast[t] = live.fast[t];
    }
    s.fogTimer = live.fogTimer;
    s.growTimer = live.growTimer;
    s.winner = live.winner;
  } else {
    // an older save: what each side sees, and remembers of the other's buildings, starts from how things are now
    refresh(s);
    updateFog(s);
    for (const t of TEAMS) for (const b of s.buildings.values()) if (b.team !== t && b.seenBy.has(t) && !s.ghosts[t].has(b.id)) s.ghosts[t].set(b.id, buildingView(s, b, t));
  }
  return s;
}

/** The whole match, as plain JSON (a copy: it never changes with the match). */
export function snapshot(s: SimState): SimSnapshot {
  const building = ({ cat: _c, size: _s, maxHp: _m, armor: _a, alive: _l, seenBy, ...b }: Building): SavedBuilding => ({ ...b, seenBy: [...seenBy] });
  const unit = (u: Unit): SavedUnit => {
    if (u.kind === 'harvester') {
      const { cat: _c, maxHp: _m, armor: _a, alive: _l, speed: _s, sight: _v, ...h } = u;
      return h;
    }
    const { cat: _c, maxHp: _m, armor: _a, alive: _l, speed: _s, sight: _v, weapons: _w, seats: _n, passengers, ...f } = u;
    return { ...f, passengers: passengers.map((p) => unit(p) as SavedFighter) };
  };
  const snap: SimSnapshot = {
    version: SNAPSHOT_VERSION,
    scenario: s.scenario.id,
    scenarioHash: scenarioHash(s.scenario),
    tick: s.tick,
    timeMs: s.timeMs,
    nextId: s.nextId,
    rng: s.rng.state,
    players: perTeam((t) => {
      const p = s.players[t];
      return { credits: p.credits, queue: p.queue, stats: p.stats, human: p.human, faction: p.faction, difficulty: p.difficulty };
    }),
    buildings: [...s.buildings.values()].map(building),
    units: [...s.units.values()].map(unit),
    ore: [...s.ore.tiles.values()].map((t) => ({ tx: t.tx, ty: t.ty, field: t.field, richness: t.richness, rocks: t.rocks })),
    vents: s.ore.vents,
    scenery: s.scenery,
    explored: perTeam((t) => s.fog[t].serializeExplored()),
    live: {
      fog: perTeam((t) => s.fog[t].serialize()),
      revealAll: perTeam((t) => s.fog[t].revealAll),
      ghosts: perTeam((t) => [...s.ghosts[t].values()]),
      power: s.power,
      fogTimer: s.fogTimer,
      growTimer: s.growTimer,
      fast: s.fast,
      winner: s.winner,
    },
    rulesHash: RULES_HASH,
  };
  // through JSON: a copy that shares nothing with the match, exactly as it will be stored
  return JSON.parse(JSON.stringify(snap)) as SimSnapshot;
}

/** A saved building back on the map: what its type gives it from the rules, everything else as saved. */
function restoreBuilding(s: SimState, saved: SavedBuilding): void {
  const { seenBy, cools, ...rest } = saved;
  const b = addBuilding(s, saved.type, saved.team, saved.tx, saved.ty, saved.built, saved.id);
  Object.assign(b, rest, { seenBy: new Set<TeamId>(seenBy), cools: b.cools.map((_, i) => cools[i] ?? 0) });
}

/** A saved unit back on the map (a passenger: back inside its transport, off the map). */
function restoreUnit(s: SimState, saved: SavedUnit, passenger = false): Unit {
  const u = addUnit(s, saved.type, saved.team, saved.gx, saved.gy, saved.id);
  if (passenger) s.dropUnit(u);
  // (copies: the same save may be loaded again)
  if (saved.kind === 'harvester' || u.kind === 'harvester') return Object.assign(u, JSON.parse(JSON.stringify(saved)) as SavedUnit);
  const { passengers, cools, ...rest } = saved;
  Object.assign(u, JSON.parse(JSON.stringify(rest)) as typeof rest, { cools: u.cools.map((_, i) => cools[i] ?? 0) });
  u.passengers = passengers.map((p) => restoreUnit(s, p, true) as Fighter);
  return u;
}
