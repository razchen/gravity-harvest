// Which matches to play: one pairing (--a / --b), or the standard suite that answers the report's questions.
import type { Difficulty, TeamId } from '@gravity-harvest/shared';
import type { Faction } from '@gravity-harvest/rules';
import { SCENARIOS } from '@gravity-harvest/sim';
import type { MatchSpec, SideSpec } from './match.js';

export const parseSide = (s: string): SideSpec => {
  const [faction, difficulty = 'normal'] = s.split(':');
  if (faction !== 'ordan' && faction !== 'sable') throw new Error(`Unknown faction "${faction}" (ordan or sable)`);
  if (!['easy', 'normal', 'hard'].includes(difficulty)) throw new Error(`Unknown difficulty "${difficulty}" (easy, normal or hard)`);
  return { faction: faction as Faction, difficulty: difficulty as Difficulty };
};

/**
 * The standard suite: the factions against each other at each level (fairness), each level against the one below in
 * both factions (difficulty order), and mirror matches (start positions).
 */
export const SUITE: [string, string][] = [
  ['ordan:normal', 'sable:normal'],
  ['ordan:hard', 'sable:hard'],
  ['ordan:hard', 'ordan:normal'],
  ['ordan:normal', 'ordan:easy'],
  ['sable:hard', 'sable:normal'],
  ['sable:normal', 'sable:easy'],
  ['ordan:normal', 'ordan:normal'],
  ['sable:normal', 'sable:normal'],
];

export function specs(opts: { pairings: [string, string][]; scenarios: string[]; matches: number; seed: number; maxMinutes: number }): MatchSpec[] {
  const out: MatchSpec[] = [];
  for (const scenario of opts.scenarios) {
    if (!SCENARIOS[scenario]) throw new Error(`Unknown scenario "${scenario}" (${Object.keys(SCENARIOS).join(', ')} or all)`);
    for (const [a, b] of opts.pairings) {
      for (let i = 0; i < opts.matches; i++) {
        // A and B swap start positions every other match
        const aSlot: TeamId = i % 2 === 0 ? 'player' : 'enemy';
        const [top, bottom] = aSlot === 'player' ? [a, b] : [b, a];
        out.push({ scenario, seed: opts.seed + i, maxMinutes: opts.maxMinutes, player: parseSide(top), enemy: parseSide(bottom), pairing: `${a} vs ${b}`, aSlot });
      }
    }
  }
  return out;
}
