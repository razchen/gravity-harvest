// Development and test helpers (the server only accepts them with debug commands enabled).
import { TEAMS, type DebugCommand, type TeamId } from '@gravity-harvest/shared';
import type { SimState } from '../state.js';
import { cancelHarvester, autoHarvest } from './harvesting.js';
import { addUnit, killUnit, destroyBuilding, checkGameOver } from './lifecycle.js';
import { updateFog } from './visibility.js';

/** Development and test helpers (the server only accepts them with debug commands enabled). */
export function debug(s: SimState, team: TeamId, cmd: DebugCommand): void {
  switch (cmd.d) {
    case 'credits':
      s.players[team].credits = cmd.amount;
      return;
    case 'fast':
      s.fast[team] = cmd.factor;
      return;
    case 'reveal':
      s.fog[team].revealAll = cmd.on;
      updateFog(s);
      return;
    case 'teleport':
      cmd.units.forEach((id, i) => {
        const u = s.units.get(id);
        if (!u) return;
        if (u.kind === 'harvester') cancelHarvester(s, u);
        else Object.assign(u, { path: [], mode: 'idle', target: null, rest: null });
        u.gx = cmd.gx + (i % 3) * 0.8;
        u.gy = cmd.gy + Math.floor(i / 3) * 0.8;
      });
      updateFog(s);
      return;
    case 'spawn': {
      const u = addUnit(s, cmd.unit, cmd.team, cmd.gx, cmd.gy);
      updateFog(s);
      if (u.kind === 'harvester') autoHarvest(s, u, true);
      return;
    }
    case 'destroyTeam':
      if (cmd.units) for (const u of s.teamUnits(cmd.team)) killUnit(s, u);
      if (cmd.buildings) for (const b of s.teamBuildings(cmd.team, false)) destroyBuilding(s, b);
      checkGameOver(s);
      return;
    case 'addTime':
      s.timeMs += cmd.ms;
      for (const t of TEAMS) s.players[t].stats.gameTimeMs = s.timeMs;
      return;
    case 'finishBuilds':
      for (const b of s.buildings.values()) if (b.team === team && !b.built) b.progress = 0.9999;
      for (const q of s.players[team].queue) q.progress = 0.9999;
      return;
  }
}
