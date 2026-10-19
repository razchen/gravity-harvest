type Handler<T> = (payload: T) => void;

/** Small typed pub/sub, used so game systems and the HUD never reach into each other directly. */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const h of this.handlers.get(event) ?? []) (h as Handler<Events[K]>)(payload);
  }
}

import type { MatchStats } from '@gravity-harvest/shared';

/** Everything the game announces to the outside (HUD, audio later, analytics later). */
export interface GameEvents extends Record<string, unknown> {
  toast: string;
  /** The match ended. */
  gameOver: { result: 'victory' | 'defeat'; stats: MatchStats };
  /** The player asked for the in-game menu (Esc / menu button). */
  menu: null;
  /** Show or hide the debug and shortcuts panel (` key / gear button). */
  debugMenu: null;
  /** Toggle the performance readout (P). */
  perf: null;
  /** Show or hide the Dev info panel (I). */
  devInfo: null;
  /** Sell or repair mode switched on, or off (null). */
  mode: 'sell' | 'repair' | null;
}

/** Tallies for the end-of-match screen (kept by the server, part of the match protocol). */
export { emptyStats, type MatchStats } from '@gravity-harvest/shared';
