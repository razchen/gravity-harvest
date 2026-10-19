import { RULES_HASH } from '@gravity-harvest/rules';
import { perTeam } from '@gravity-harvest/shared';
import { describe, expect, it } from 'vitest';
import { CommandQueue } from './commands.js';
import { TeamFeed } from './feed.js';
import { TICK_MS } from './layout.js';
import { recordMatch, replay, startMatch, type MatchStart } from './replay.js';
import { Sim } from './sim.js';

const mine = (sim: Sim, type: string) => [...sim.units.values()].filter((u) => u.team === 'a' && u.type === type);
/** Everything both sides see, and the saved state: two matches that agree on all of it are the same match. */
const fingerprint = (sim: Sim) => JSON.stringify({ snapshot: sim.snapshot(), views: perTeam((t) => sim.view(t)) });

describe('looking at the match', () => {
  it('is pure: viewing, from either seat in either order, never changes the match', () => {
    const looked = Sim.create('skirmish', 11);
    const control = Sim.create('skirmish', 11);
    for (let i = 0; i < 400; i++) {
      looked.step();
      control.step();
      if (i % 3 === 0) {
        const ab = [looked.view('a'), looked.view('b')];
        const ba = [looked.view('b'), looked.view('a')].reverse();
        expect(ab).toEqual(ba);
      }
    }
    expect(fingerprint(looked)).toBe(fingerprint(control));
  });

  it('events leave the sim only through takeEvents', () => {
    const sim = Sim.create('skirmish');
    sim.command('a', { c: 'place', building: 'gravity_lab', tx: 1, ty: 14 });
    expect(sim.view('a').events).toEqual([]);
    expect(sim.takeEvents('a').length).toBeGreaterThan(0);
    expect(sim.takeEvents('a')).toEqual([]);
  });

  it('a feed sends the events since its last view, and the fog only when it changed', () => {
    const sim = Sim.create('skirmish');
    const feed = new TeamFeed('a');
    const first = feed.view(sim);
    expect(first.fog).toHaveLength(sim.map.width * sim.map.height);
    expect(feed.view(sim).fog).toBeUndefined(); // unchanged: not resent
    sim.command('a', { c: 'place', building: 'gravity_lab', tx: 1, ty: 14 });
    feed.push(sim.takeEvents('a'));
    expect(feed.view(sim).events.length).toBeGreaterThan(0);
    expect(feed.view(sim).events).toEqual([]);
    feed.resendFog();
    expect(feed.view(sim).fog).toBe(first.fog);
  });
});

describe('the command queue', () => {
  it('applies orders at the start of the next step: by tick, then seat, then arrival', () => {
    const sim = Sim.create('skirmish');
    const q = new CommandQueue();
    const [r1, r2] = mine(sim, 'rifleman');
    const enemy = [...sim.units.values()].find((u) => u.team === 'b')!;
    q.push(sim, 'b', { c: 'stop', units: [enemy.id] });
    q.push(sim, 'a', { c: 'move', orders: [{ id: r1.id, gx: 20, gy: 20 }] });
    q.push(sim, 'a', { c: 'move', orders: [{ id: r2.id, gx: 21, gy: 20 }] });
    expect(r1.path).toEqual([]); // nothing happens until the step
    q.step(sim);
    expect(r1.path.length).toBeGreaterThan(0);
    expect(q.log.map((e) => [e.tick, e.team, 'cmd' in e && e.cmd.c === 'move' ? e.cmd.orders[0].id : 'stop'])).toEqual([
      [0, 'a', r1.id], [0, 'a', r2.id], [0, 'b', 'stop'],
    ]);
  });
});

describe('replays', () => {
  /** A scripted match: orders and debug commands at set times, recorded through a CommandQueue. */
  function play(start: MatchStart, ms: number) {
    const sim = startMatch(start);
    const q = new CommandQueue();
    const t0 = sim.tick;
    const rifles = mine(sim, 'rifleman').map((u) => u.id);
    while ((sim.tick - t0) * TICK_MS < ms && !sim.winner) {
      const at = (sim.tick - t0) * TICK_MS;
      if (at === 1000) q.push(sim, 'a', { c: 'place', building: 'barracks', tx: 1, ty: 10 });
      if (at === 2000) q.debug(sim, 'a', { d: 'finishBuilds' });
      if (at === 3000) q.push(sim, 'a', { c: 'attackMove', orders: rifles.map((id, i) => ({ id, gx: 60 + i, gy: 14 })) });
      if (at === 3000) q.push(sim, 'b', { c: 'train', unit: 'harvester' });
      if (at === 9000) q.push(sim, 'a', { c: 'train', unit: 'rifleman' });
      q.step(sim);
    }
    return { sim, record: recordMatch(start, q.log, sim.tick) };
  }

  it('a match played again from its start and command log ends exactly the same', () => {
    const { sim, record } = play({ scenario: 'skirmish', seed: 5, faction: 'sable', options: { seat: 'b' } }, 40_000);
    expect(record.rulesHash).toBe(RULES_HASH);
    expect(record.log.map((e) => e.tick)).toEqual([20, 40, 60, 60, 180]);
    expect(fingerprint(replay(record))).toBe(fingerprint(sim));
    // and through JSON, as a stored replay would be
    expect(fingerprint(replay(JSON.parse(JSON.stringify(record))))).toBe(fingerprint(sim));
  });

  it('works from a snapshot start too (a match loaded from a save)', () => {
    const before = Sim.create('skirmish', 8);
    for (let i = 0; i < 300; i++) before.step();
    const { sim, record } = play({ snapshot: JSON.parse(JSON.stringify(before.snapshot())) }, 30_000);
    expect(fingerprint(replay(record))).toBe(fingerprint(sim));
  });

  it('a log that does not fit its start is refused', () => {
    const { record } = play({ scenario: 'skirmish', seed: 5 }, 5000);
    expect(() => replay({ ...record, endTick: 10 })).toThrow(/commands left/);
  });
});
