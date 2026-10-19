import { TEAMS, type Command, type DebugCommand, type TeamId } from '@gravity-harvest/shared';
import type { Sim } from './sim.js';

/**
 * One entry of a match's command log: an order or a debug command, and the tick it was applied at. Entries are in the
 * order they were applied; those with tick `n` were applied after step `n` and before step `n + 1` (debug commands
 * the moment they came, orders at the start of the next step).
 */
export type LoggedCommand = { tick: number; team: TeamId } & ({ cmd: Command } | { debug: DebugCommand });

/**
 * Orders wait here until the start of the next step, from every side (people and computer players alike), so when an
 * order arrives between ticks never matters: each step starts by applying everything queued, sorted by the tick it
 * came in, then seat (`a` before `b`), then arrival. Everything applied goes into `log`, which with the match's start
 * is enough to play the match again (`replay`, replay.ts).
 */
export class CommandQueue {
  /** Everything applied so far, in order. */
  readonly log: LoggedCommand[] = [];
  private queued: { tick: number; team: TeamId; seq: number; cmd: Command }[] = [];
  private seq = 0;

  /** Queue an order from `team` for the start of the next step. */
  push(sim: Sim, team: TeamId, cmd: Command): void {
    this.queued.push({ tick: sim.tick, team, seq: this.seq++, cmd });
  }

  /**
   * Apply a debug command now. Unlike orders it doesn't wait for the next step: a developer wants to see it at once,
   * even while paused. It is logged at the current tick, ahead of the orders still waiting.
   */
  debug(sim: Sim, team: TeamId, cmd: DebugCommand): void {
    sim.debug(team, cmd);
    this.log.push({ tick: sim.tick, team, debug: cmd });
  }

  /** Apply the queued orders in order, then advance the match one tick. */
  step(sim: Sim): void {
    const seat = (t: TeamId) => TEAMS.indexOf(t);
    const due = this.queued.sort((x, y) => x.tick - y.tick || seat(x.team) - seat(y.team) || x.seq - y.seq);
    this.queued = [];
    for (const q of due) {
      sim.command(q.team, q.cmd);
      this.log.push({ tick: sim.tick, team: q.team, cmd: q.cmd });
    }
    sim.step();
  }
}
