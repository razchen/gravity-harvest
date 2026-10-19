// The computer's scout: from time to time its fastest, cheapest free unit goes for a look at the enemy base (or where
// it guesses it is), then at places it hasn't seen.
import { UNITS } from '@gravity-harvest/rules';
import type { UnitView } from '@gravity-harvest/shared';
import { Manager, centreOf } from './brain.js';
import { addTo } from './state.js';

export class Scouting extends Manager {
  /** A scout that's gone (lost) frees the job, and the next one goes out in a while. */
  muster(units: UnitView[]): void {
    const s = this.state.scouting;
    if (s.scout && !units.some((u) => u.id === s.scout!.id)) {
      s.scout = null;
      s.nextScoutMs = this.world.timeMs + this.profile.scoutEveryMs;
    }
  }

  run(units: UnitView[]): void {
    const ai = this.ai;
    const p = this.profile;
    const w = this.world;
    const sc = this.state.scouting;
    const now = w.timeMs;
    if (!sc.scout) {
      if (sc.nextScoutMs === null || now < sc.nextScoutMs) return;
      const free = units.filter((u) => !ai.busy(u)).sort((a, b) => UNITS[b.type].speed - UNITS[a.type].speed || UNITS[a.type].cost - UNITS[b.type].cost);
      if (!free.length) return;
      sc.scout = { id: free[0].id, target: null, legs: 0 };
    }
    const s = sc.scout;
    const u = units.find((x) => x.id === s.id)!;
    const sent = this.state.orders.lastSent[u.id];
    const stuck = !u.moving && !!sent && now - sent.ms > 15_000;
    if (stuck && s.target) addTo(sc.unreachable, w.key(Math.floor(s.target.gx), Math.floor(s.target.gy)));
    if (!s.target || w.fogAt(Math.floor(s.target.gx), Math.floor(s.target.gy)) === 2 || stuck) {
      s.legs++;
      // first a look at the enemy base (the one it knows of: what defends it now? else where it guesses it is), then
      // places it hasn't seen
      const base = s.legs === 1 && w.enemyBuildings.length ? ai.nearest(w.enemyBuildings, u) : undefined;
      const guess = s.legs === 1 && !base ? ai.enemyGuess() : null;
      const unseen = guess && w.fogAt(Math.floor(guess.gx), Math.floor(guess.gy)) === 0;
      s.target = s.legs > 4 ? null : base ? ai.open(centreOf(base)) : unseen ? ai.open(guess) : ai.unexplored(u, s.legs === 1);
      if (!s.target) {
        sc.scout = null;
        sc.nextScoutMs = now + p.scoutEveryMs;
        return;
      }
      ai.moveGroup([u], s.target, true);
    } else if (!u.moving) ai.moveGroup([u], s.target);
  }
}
