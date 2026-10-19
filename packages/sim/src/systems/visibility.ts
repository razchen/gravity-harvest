// Visibility: what each side sees (its fog), the enemy buildings it has discovered, and its memory of them as last
// seen (ghosts) once they're out of sight.
import { BUILDINGS } from '@gravity-harvest/rules';
import { TEAMS, type TeamId } from '@gravity-harvest/shared';
import type { Viewer } from '../fog.js';
import { centre, type Entity } from '../entities.js';
import type { SimState } from '../state.js';
import { buildingView } from './views.js';

/** Known to `team`: its own, an enemy unit in sight, or an enemy building it has discovered (seen as it was last). */
export function canSee(s: SimState, team: TeamId, e: Entity): boolean {
  if (e.team === team) return true;
  return e.cat === 'building' ? e.seenBy.has(team) : s.fog[team].isVisible(e.gx, e.gy);
}

/** In `team`'s sight right now (a building: any tile of it). */
export function inSight(s: SimState, team: TeamId, e: Entity): boolean {
  if (e.team === team) return true;
  return e.cat === 'building' ? s.fog[team].anyVisible(e.tx, e.ty, e.size) : s.fog[team].isVisible(e.gx, e.gy);
}

export function updateFog(s: SimState): void {
  for (const t of TEAMS) {
    const viewers: Viewer[] = [];
    for (const u of s.units.values()) if (u.team === t) viewers.push({ gx: u.gx, gy: u.gy, sight: u.sight });
    for (const b of s.buildings.values()) if (b.team === t) viewers.push({ ...centre(b), sight: BUILDINGS[b.type].sight + b.size / 2 });
    s.fog[t].update(viewers);
    // enemy buildings in sight are discovered, and remembered as they are now
    for (const b of s.buildings.values()) {
      if (b.team === t || !inSight(s, t, b)) continue;
      b.seenBy.add(t);
      s.ghosts[t].set(b.id, buildingView(s, b, t));
    }
    // one that's gone is forgotten once its spot is seen again
    for (const [id, g] of s.ghosts[t]) if (!s.buildings.has(id) && s.fog[t].anyVisible(g.tx, g.ty, g.size)) s.ghosts[t].delete(id);
  }
}
