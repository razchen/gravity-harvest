// Power: each side's balance from its finished buildings, what low power slows down, and whether its radar works.
import { BUILDINGS, powerBalance } from '@gravity-harvest/rules';
import { TEAMS, type TeamId, type TeamView } from '@gravity-harvest/shared';
import { ENGINE } from '../layout.js';
import type { SimState } from '../state.js';

/** Recompute power from finished buildings. */
export function refresh(s: SimState): void {
  for (const t of TEAMS) s.power[t] = powerBalance(s.ownedTypes(t));
}

export function slowdown(s: SimState, team: TeamId): number {
  return s.power[team].low ? ENGINE.lowPowerSlowdown : 1;
}

export function radar(s: SimState, team: TeamId): TeamView['radar'] {
  if (!s.teamBuildings(team).some((b) => b.type === 'radar')) return 'none';
  return BUILDINGS.radar.requiresPower && s.power[team].low ? 'offline' : 'online';
}
