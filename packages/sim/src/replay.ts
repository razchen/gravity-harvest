import { RULES_HASH, type Faction } from '@gravity-harvest/rules';
import type { LoggedCommand } from './commands.js';
import { Sim, type CreateOptions } from './sim.js';
import type { SimSnapshot } from './snapshot.js';

/** How a match began: a new one on a scenario (all `Sim.create` takes), or the save it was loaded from. */
export type MatchStart =
  | { scenario: string; seed: number; faction?: Faction; options?: CreateOptions }
  | { snapshot: SimSnapshot };

/** Everything needed to play a match again: how it began, every command applied, and the tick it was recorded to. */
export interface MatchRecord {
  /** RULES_HASH of the rules it was played under: under other rules a replay goes differently. */
  rulesHash: string;
  start: MatchStart;
  log: LoggedCommand[];
  endTick: number;
}

/** The match a start describes, before any step. */
export function startMatch(start: MatchStart): Sim {
  if ('snapshot' in start) return Sim.restore(start.snapshot);
  return Sim.create(start.scenario, start.seed, start.faction, start.options);
}

/** A record of a match so far, as a copy (plain JSON, safe to keep while the match goes on). */
export function recordMatch(start: MatchStart, log: readonly LoggedCommand[], endTick: number): MatchRecord {
  return JSON.parse(JSON.stringify({ rulesHash: RULES_HASH, start, log, endTick })) as MatchRecord;
}

/**
 * Play a recorded match again from its start and its command log, and return the match as it was at `endTick`. The
 * sim is deterministic and the log holds every order from every side (the computer players' too), so no computer
 * player runs and the result is the same match, tick for tick, as long as the rules are the same (`rulesHash`).
 */
export function replay(record: MatchRecord): Sim {
  const sim = startMatch(record.start);
  const log = record.log;
  let i = 0;
  // everything logged at the current tick, in the order it was applied
  const applyDue = () => {
    for (; i < log.length && log[i].tick === sim.tick; i++) {
      const e = log[i];
      if ('cmd' in e) sim.command(e.team, e.cmd);
      else sim.debug(e.team, e.debug);
    }
  };
  applyDue();
  while (sim.tick < record.endTick && !sim.winner) {
    sim.step();
    applyDue();
  }
  if (i < log.length) throw new Error(`Replay stopped at tick ${sim.tick} with ${log.length - i} commands left: the log doesn't fit its start`);
  return sim;
}
