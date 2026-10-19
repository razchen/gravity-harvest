import type { MatchEvent, TeamId, TeamView } from '@gravity-harvest/shared';
import type { Sim } from './sim.js';

/**
 * One viewer's stream of views of a side: a connection's, or a computer player's. `Sim.view` is pure and always has
 * the whole fog and no events; a feed keeps what this viewer has been sent, so each view carries the events since its
 * last one and the fog only when it changed. Whoever runs the match hands every feed its side's events after each
 * step (`push`), so how often a feed is looked at never decides who gets which events.
 */
export class TeamFeed {
  private lastFog = '';
  private inbox: MatchEvent[] = [];

  constructor(readonly team: TeamId) {}

  /** Events for this side (from `Sim.takeEvents`), kept until the next view. */
  push(events: readonly MatchEvent[]): void {
    for (const e of events) this.inbox.push(e);
  }

  /** The next view of this side: as it is now, with the events since the last one and the fog only when it changed. */
  view(sim: Sim, paused = false): TeamView {
    const v = sim.view(this.team, paused);
    const fog = v.fog!;
    const out: TeamView = { ...v, events: this.inbox };
    this.inbox = [];
    if (fog === this.lastFog) delete out.fog;
    this.lastFog = fog;
    return out;
  }

  /** Send the whole fog with the next view (the viewer just (re)connected). */
  resendFog(): void {
    this.lastFog = '';
  }
}
