// Events: what each side is told happened (shots, deaths, doors, toasts), queued until whoever runs the match takes
// them (Sim.takeEvents). A side only hears of what it may know.
import { TEAMS, type GridPoint, type MatchEvent, type ToastCode, type TeamId } from '@gravity-harvest/shared';
import type { OreChange } from '../ore.js';
import type { SimState } from '../state.js';

export function emit(s: SimState, team: TeamId, ev: MatchEvent): void {
  s.pending[team].push(ev);
}

export function toast(s: SimState, team: TeamId, code: ToastCode, text: string): void {
  if (s.players[team].human) emit(s, team, { e: 'toast', text, code });
}

/** Send an event to the owner and to every team that can see the spot. */
export function emitSeen(s: SimState, ev: MatchEvent, at: GridPoint, owner?: TeamId): void {
  for (const t of TEAMS) if (t === owner || s.fog[t].isVisible(at.gx, at.gy)) emit(s, t, ev);
}

export function emitOre(s: SimState, changes: OreChange[]): void {
  for (const c of changes) for (const t of TEAMS) emit(s, t, c);
}
