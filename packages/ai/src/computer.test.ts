import { BUILDINGS } from '@gravity-harvest/rules';
import { TEAMS, perTeam, type Command, type Difficulty, type TeamId, type TeamView } from '@gravity-harvest/shared';
import { Sim, TeamFeed, type Harvester } from '@gravity-harvest/sim';
import { describe, expect, it } from 'vitest';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer } from './computer.js';
import { PROFILES } from './profiles.js';

/**
 * Step a match for `ms`, letting each given computer side see its view and give its orders; `seen` sees every order,
 * `looked` every view.
 */
function play(sim: Sim, ais: ComputerPlayer[], ms: number, seen?: (team: TeamId, c: Command, view: TeamView) => void, looked?: (team: TeamId, view: TeamView) => void): void {
  const end = sim.timeMs + ms;
  const feeds = perTeam((t) => new TeamFeed(t));
  while (sim.timeMs < end && !sim.winner) {
    sim.step();
    if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
    for (const ai of ais) {
      feeds[ai.team].push(sim.takeEvents(ai.team));
      const v = feeds[ai.team].view(sim);
      looked?.(ai.team, v);
      for (const c of ai.update(v)) {
        seen?.(ai.team, c, v);
        sim.command(ai.team, c);
      }
    }
  }
}

const computer = (sim: Sim, team: TeamId, difficulty: Difficulty = 'hard', seed = 5) => new ComputerPlayer({ hello: sim.hello(team), difficulty, seed });

describe('the computer player', () => {
  it('builds power when it runs low', () => {
    const sim = Sim.create('skirmish', 3);
    for (const b of [...sim.buildings.values()]) if (b.team === 'b' && b.type === 'power_plant') sim.destroyBuilding(b);
    expect(sim.powerOf('b').low).toBe(true);
    const placed: string[] = [];
    play(sim, [computer(sim, 'b')], 20_000, (_, c) => c.c === 'place' && placed.push(c.building));
    expect(placed.length).toBeGreaterThan(0);
    expect(BUILDINGS[placed[0]].power).toBeGreaterThan(0); // power first
    play(sim, [computer(sim, 'b')], 30_000);
    expect(sim.powerOf('b').low).toBe(false);
  });

  it('keeps its harvesters busy', () => {
    const sim = Sim.create('skirmish', 3);
    const ai = computer(sim, 'b', 'normal');
    play(sim, [ai], 2000);
    const h = [...sim.units.values()].find((u) => u.team === 'b' && u.kind === 'harvester') as Harvester;
    sim.command('b', { c: 'stop', units: [h.id] });
    expect(h.state).toBe('idle');
    play(sim, [ai], 15_000);
    expect(h.state).not.toBe('idle');
  });

  it('only orders its own units, and only attacks what its side has been shown', () => {
    const sim = Sim.create('skirmish', 4, 'ordan', { otherFaction: 'sable', computerOnly: true });
    const ais = TEAMS.map((t) => computer(sim, t, 'hard', t === 'a' ? 1 : 2));
    const owned: Record<TeamId, Set<number>> = perTeam(() => new Set());
    const shown: Record<TeamId, Set<number>> = perTeam(() => new Set());
    let attacks = 0;
    play(sim, ais, 12 * 60_000, (team, c) => {
      for (const u of sim.units.values()) owned[u.team].add(u.id);
      const ids = 'units' in c ? c.units : c.c === 'move' || c.c === 'attackMove' ? c.orders.map((o) => o.id) : c.c === 'deploy' ? [c.unit] : [];
      for (const id of ids) expect(owned[team].has(id), `${team} ordered unit ${id} (${c.c})`).toBe(true);
      if (c.c === 'attack') {
        attacks++;
        expect(shown[team].has(c.target), `${team} attacked ${c.target}, which it was never shown`).toBe(true);
      }
    }, (team, view) => {
      // everything a side was ever shown, orders or not (it may remember an enemy and go for it later)
      for (const e of [...view.units, ...view.buildings]) if (e.team !== team) shown[team].add(e.id);
    });
    expect(attacks).toBeGreaterThan(0);
  });

  it('plays the same match for the same seed', () => {
    const run = () => {
      const sim = Sim.create('skirmish', 9, 'sable', { otherFaction: 'ordan', computerOnly: true });
      const log: string[] = [];
      const ais = TEAMS.map((t) => computer(sim, t, 'normal', t === 'a' ? 11 : 12));
      play(sim, ais, 6 * 60_000, (team, c) => log.push(`${sim.tick} ${team} ${JSON.stringify(c)}`));
      return { log, credits: TEAMS.map((t) => sim.players[t].credits) };
    };
    const a = run();
    expect(a.log.length).toBeGreaterThan(50);
    expect(run()).toEqual(a);
  });

  it('adds harvesters by cash flow, not cash in hand: buying a factory early is no reason for one', () => {
    // Ordan's army comes from a Motor Works ($3,000), which takes it well under its starting money in the first
    // minutes; its one harvester still earns more than its queues can spend, so it keeps building the army
    const sim = Sim.create('skirmish', 2, 'sable', { otherFaction: 'ordan', computerOnly: true });
    const trained: { ms: number; unit: string }[] = [];
    let lowest = Infinity;
    play(sim, [computer(sim, 'b', 'normal')], 4 * 60_000, (_, c) => c.c === 'train' && trained.push({ ms: sim.timeMs, unit: c.unit }), (team, v) => {
      if (team === 'b') lowest = Math.min(lowest, v.credits);
    });
    expect(lowest).toBeLessThan(12_000); // the old rule (cash in hand under $12,000) would have bought one here
    expect(trained.length).toBeGreaterThan(5);
    expect(trained.filter((t) => t.unit === 'harvester')).toEqual([]);
  });

  it('puts the army first under attack: no harvester holds the queue, and the lost one comes back once safe', () => {
    const sim = Sim.create('skirmish', 3, 'sable', { otherFaction: 'ordan', computerOnly: true });
    const ai = computer(sim, 'b', 'hard');
    play(sim, [ai], 3 * 60_000);
    expect([...sim.buildings.values()].some((b) => b.team === 'b' && b.type === 'motor_works' && b.built)).toBe(true);
    // its harvester is lost, and a raid is in its base
    for (const u of [...sim.units.values()]) if (u.team === 'b' && u.kind === 'harvester') sim.killUnit(u);
    for (let i = 0; i < 8; i++) sim.debug('a', { d: 'spawn', unit: 'rifleman', team: 'a', gx: 55.5 + (i % 4), gy: 11.5 + Math.floor(i / 4) });
    // they push in (riflemen only go for what their side can see)
    const raid = [...sim.units.values()].filter((u) => u.team === 'a' && u.type === 'rifleman' && u.gx > 50);
    sim.command('a', { c: 'attackMove', orders: raid.map((u) => ({ id: u.id, gx: 70.5, gy: 8.5 })) });
    sim.players.b.credits = 20_000;
    sim.command('b', { c: 'train', unit: 'harvester' }); // as if it had asked for one just before
    const trained: string[] = [];
    let cancelled = false;
    play(sim, [ai], 8000, (_, c) => {
      if (c.c === 'train') trained.push(c.unit);
      if (c.c === 'cancelTrain' && c.unit === 'harvester') cancelled = true;
    });
    expect(cancelled).toBe(true);
    expect(trained).not.toContain('harvester');
    expect(sim.players.b.queue.some((q) => q.unit === 'harvester')).toBe(false);
    // once the raid is over, it replaces the harvester
    for (const u of [...sim.units.values()]) if (u.team === 'a' && u.type === 'rifleman') sim.killUnit(u);
    let replaced = false;
    play(sim, [ai], 60_000, (_, c) => c.c === 'train' && c.unit === 'harvester' && (replaced = true));
    expect(replaced).toBe(true);
  });

  it('every difficulty is the same code with a different profile', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) expect(Object.keys(PROFILES[d]).sort()).toEqual(Object.keys(PROFILES.normal).sort());
    // fewer mistakes up the levels
    expect(PROFILES.easy.thinkMs).toBeGreaterThan(PROFILES.normal.thinkMs);
    expect(PROFILES.normal.thinkMs).toBeGreaterThan(PROFILES.hard.thinkMs);
    expect(PROFILES.easy.productionLapse).toBeGreaterThan(PROFILES.normal.productionLapse);
    expect(PROFILES.normal.productionLapse).toBeGreaterThanOrEqual(PROFILES.hard.productionLapse);
  });
});
