import type { Difficulty, TeamId } from '@gravity-harvest/shared';
import type { Faction } from '@gravity-harvest/rules';
import { Sim, TEAMS } from '@gravity-harvest/sim';
import { describe, expect, it } from 'vitest';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer } from './computer.js';

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
  const sim = Sim.create('skirmish', f.seed, f.factions[0], { enemyFaction: f.factions[1], computerOnly: true });
  const ais = TEAMS.map((t, i) => new ComputerPlayer({ hello: sim.hello(t), difficulty: f.difficulties[i], seed: f.seed * 7919 + i + 1 }));
  let hash = 0x811c9dc5;
  let orders = 0;
  while (sim.timeMs < f.minutes * 60_000 && !sim.winner) {
    sim.step();
    if (sim.tick % AI_VIEW_EVERY_TICKS) continue;
    for (const ai of ais) {
      for (const c of ai.update(sim.view(ai.team))) {
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
    expect(fingerprint({ seed: 9, factions: ['sable', 'ordan'], difficulties: ['normal', 'hard'], minutes: 14 })).toBe('orders=899 credits=1490/675 units=31 buildings=17 hash=d2f6aee8');
  });

  it('easy Ordan against normal Sable', () => {
    expect(fingerprint({ seed: 4, factions: ['ordan', 'sable'], difficulties: ['easy', 'normal'], minutes: 14 })).toBe('orders=432 credits=11774/10140 units=25 buildings=14 hash=f6b626c6');
  });
});
