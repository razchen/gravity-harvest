import { TEAMS, perTeam, type Difficulty, type TeamId } from '@gravity-harvest/shared';
import type { Faction } from '@gravity-harvest/rules';
import { CommandQueue, Sim, TeamFeed, recordMatch, replay, startMatch, type MatchRecord } from '@gravity-harvest/sim';
import { describe, expect, it } from 'vitest';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer } from './computer.js';

/** The next view for a side's one viewer: what it sees now, with the events since its last look. */
function look(sim: Sim, feed: TeamFeed) {
  feed.push(sim.takeEvents(feed.team));
  return feed.view(sim);
}

/** FNV-1a over a string (32 bits, as hex): enough to tell one command stream from another. */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

interface Fixture {
  seed: number;
  factions: [Faction, Faction];
  difficulties: [Difficulty, Difficulty];
  minutes: number;
}

/** Play a computer-only match and fingerprint it: every order given (tick, side, order) hashed, and where it ended. */
function fingerprint(f: Fixture): string {
  const sim = Sim.create('skirmish', f.seed, f.factions[0], { otherFaction: f.factions[1], computerOnly: true });
  const ais = TEAMS.map((t, i) => new ComputerPlayer({ hello: sim.hello(t), difficulty: f.difficulties[i], seed: f.seed * 7919 + i + 1 }));
  const feeds = perTeam((t) => new TeamFeed(t));
  let hash = 0x811c9dc5;
  let orders = 0;
  while (sim.timeMs < f.minutes * 60_000 && !sim.winner) {
    sim.step();
    if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
    for (const ai of ais) {
      for (const c of ai.update(look(sim, feeds[ai.team]))) {
        hash = fnv(`${sim.tick} ${ai.team} ${JSON.stringify(c)}\n`, hash);
        orders++;
        sim.command(ai.team, c);
      }
    }
  }
  const credits = TEAMS.map((t: TeamId) => Math.round(sim.players[t].credits)).join('/');
  return `orders=${orders} credits=${credits} units=${sim.units.size} buildings=${sim.buildings.size} hash=${hash.toString(16)}`;
}

// The computer's exact play, pinned: a change to how it decides (or to the sim under it) shows up here. When the
// change is meant, play a few matches in the simulator to check it plays as well as before, then update the prints.
describe('the computer plays exactly as before', () => {
  it('normal Sable against hard Ordan', () => {
    expect(fingerprint({ seed: 9, factions: ['sable', 'ordan'], difficulties: ['normal', 'hard'], minutes: 14 })).toBe('orders=899 credits=1490/675 units=31 buildings=17 hash=956084de');
  });

  it('easy Ordan against normal Sable', () => {
    expect(fingerprint({ seed: 4, factions: ['ordan', 'sable'], difficulties: ['easy', 'normal'], minutes: 14 })).toBe('orders=432 credits=11774/10140 units=25 buildings=14 hash=99d9d4ea');
  });
});

describe('the computer saved and restored', () => {
  it('plays on exactly as the one it was saved from', () => {
    const sim = Sim.create('skirmish', 6, 'ordan', { otherFaction: 'sable', computerOnly: true });
    const opts = TEAMS.map((t, i) => ({ hello: sim.hello(t), difficulty: 'hard' as const, seed: 100 + i }));
    const ais = opts.map((o) => new ComputerPlayer(o));
    const feeds = perTeam((t) => new TeamFeed(t));
    let copies: ComputerPlayer[] = [];
    let compared = 0;
    // saved twice: once mid-match, once later between thinks with orders still on their way
    const saveAt = new Set([6 * 60_000, 9 * 60_000 + 17_500]);
    while (sim.timeMs < 12 * 60_000 && !sim.winner) {
      sim.step();
      if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
      if (saveAt.has(sim.timeMs)) {
        // through JSON, as a save game would keep it
        copies = ais.map((ai, i) => ComputerPlayer.fromState(opts[i], JSON.parse(JSON.stringify(ai.getState()))));
        expect(copies.map((c) => c.getState())).toEqual(ais.map((a) => a.getState()));
      }
      ais.forEach((ai, i) => {
        const v = look(sim, feeds[ai.team]);
        const orders = ai.update(v);
        if (copies.length) {
          expect(copies[i].update(v)).toEqual(orders);
          compared += orders.length;
        }
        for (const c of orders) sim.command(ai.team, c);
      });
    }
    expect(compared).toBeGreaterThan(100);
    expect(copies.map((c) => c.report)).toEqual(ais.map((a) => a.report));
  });
});

describe('a computer-only match replayed', () => {
  it('from its start and command log ends exactly as it was played', () => {
    const start = { scenario: 'skirmish', seed: 12, faction: 'ordan' as const, options: { otherFaction: 'sable' as const, computerOnly: true } };
    const sim = startMatch(start);
    const queue = new CommandQueue();
    const feeds = perTeam((t) => new TeamFeed(t));
    const ais = TEAMS.map((t, i) => new ComputerPlayer({ hello: sim.hello(t), difficulty: 'hard', seed: 300 + i }));
    // the way the server runs a match: orders queued for the next step, events handed out after every step
    while (sim.timeMs < 8 * 60_000 && !sim.winner) {
      queue.step(sim);
      for (const t of TEAMS) feeds[t].push(sim.takeEvents(t));
      if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
      for (const ai of ais) for (const c of ai.update(feeds[ai.team].view(sim))) queue.push(sim, ai.team, c);
    }
    const record = JSON.parse(JSON.stringify(recordMatch(start, queue.log, sim.tick))) as MatchRecord;
    expect(record.log.length).toBeGreaterThan(200);
    const again = replay(record);
    expect(again.tick).toBe(sim.tick);
    expect(JSON.stringify(again.snapshot())).toBe(JSON.stringify(sim.snapshot()));
    for (const t of TEAMS) expect(again.view(t)).toEqual(sim.view(t));
  });
});
