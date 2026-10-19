// Orders: a player's commands, checked for legality and handed to the systems that carry them out.
import { BUILDINGS, UNITS, refundFor, capabilitiesOf } from '@gravity-harvest/rules';
import type { Command, GridPoint, TeamId } from '@gravity-harvest/shared';
import { isVehicleType, isInfantryType, type Unit } from '../entities.js';
import type { SimState } from '../state.js';
import { formation } from './collisions.js';
import { deploy, place, train } from './construction.js';
import { toast } from './events.js';
import { cancelHarvester, harvest, returnHome } from './harvesting.js';
import { destroyBuilding } from './lifecycle.js';
import { moveUnit } from './movement.js';
import { toBay, leaveBay } from './service.js';
import { isSupport } from './support.js';
import { canSee } from './visibility.js';

/** Apply a player's order. Invalid orders are ignored (with a toast explaining why, where useful). */
export function command(s: SimState, team: TeamId, cmd: Command): void {
  if (s.winner) return;
  const own = (id: number) => {
    const u = s.units.get(id);
    return u && u.alive && u.team === team ? u : null;
  };
  switch (cmd.c) {
    case 'move':
    case 'attackMove': {
      // units sent to the same point move as a group: each gets a tile of its own around it (formation())
      const fight = cmd.c === 'attackMove';
      const groups = new Map<string, { at: GridPoint; units: Unit[] }>();
      for (const o of cmd.orders) {
        const u = own(o.id);
        if (!u) continue;
        const k = `${o.gx},${o.gy}`;
        if (!groups.has(k)) groups.set(k, { at: { gx: o.gx, gy: o.gy }, units: [] });
        groups.get(k)!.units.push(u);
      }
      for (const { at, units } of groups.values()) {
        if (units.length === 1) moveUnit(s, units[0], at.gx, at.gy, fight);
        else formation(s, units, at).forEach((p, i) => moveUnit(s, units[i], p.gx, p.gy, fight));
      }
      return;
    }
    case 'attack': {
      const target = s.entity(cmd.target);
      if (!target?.alive || target.team === team || !canSee(s, team, target)) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'fighter') {
          Object.assign(u, { target: target.id, mode: 'attack', repath: 0, rest: null, attackMove: null });
        }
      }
      return;
    }
    case 'harvest': {
      const tile = s.ore.at(cmd.tx, cmd.ty);
      if (!tile?.rocks.length) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'harvester') {
          cancelHarvester(s, u);
          harvest(s, u, tile);
        }
      }
      return;
    }
    case 'dock': {
      const ref = s.buildings.get(cmd.refinery);
      if (!ref || !capabilitiesOf(ref.type).refinery || ref.team !== team || !ref.built) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'harvester') {
          cancelHarvester(s, u);
          returnHome(s, u, ref);
        }
      }
      return;
    }
    case 'service': {
      const bay = s.buildings.get(cmd.bay);
      if (!bay || !capabilitiesOf(bay.type).repairsVehicles || bay.team !== team || !bay.built) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'fighter' && isVehicleType(u.type) && u.hp < u.maxHp) toBay(s, u, bay);
      }
      return;
    }
    case 'stop':
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'harvester') {
          cancelHarvester(s, u);
          u.parked = true;
        } else if (u) Object.assign(u, { path: [], target: null, mode: 'idle', unloading: false, rest: null, attackMove: null });
      }
      return;
    case 'place':
      return place(s, team, cmd.building, cmd.tx, cmd.ty);
    case 'train':
      return train(s, team, cmd.unit, cmd.near);
    case 'cancelTrain': {
      // the last one queued: all of its money back if it hadn't started, else the rules' refund
      const q = s.players[team].queue;
      for (let i = q.length - 1; i >= 0; i--) {
        if (q[i].unit !== cmd.unit) continue;
        const [item] = q.splice(i, 1);
        const cost = UNITS[cmd.unit].cost;
        s.players[team].credits += item.progress > 0 ? refundFor(cost) : cost;
        return;
      }
      return;
    }
    case 'sell': {
      const b = s.buildings.get(cmd.building);
      if (!b || b.team !== team || !b.built) return;
      s.players[team].credits += refundFor(BUILDINGS[b.type].cost);
      toast(s, team, 'sold', `${BUILDINGS[b.type].name} sold`);
      destroyBuilding(s, b, true);
      return;
    }
    case 'deploy':
      return deploy(s, team, cmd.unit);
    case 'cancelBuild': {
      const b = s.buildings.get(cmd.building);
      if (!b || b.team !== team || b.built) return;
      s.players[team].credits += refundFor(BUILDINGS[b.type].cost);
      s.players[team].stats.buildingsBuilt = Math.max(0, s.players[team].stats.buildingsBuilt - 1);
      toast(s, team, 'cancelled', `${BUILDINGS[b.type].name} cancelled`);
      destroyBuilding(s, b, true);
      return;
    }
    case 'support': {
      // Medics and Engineers sent to a damaged unit or building of their own side (updateSupport)
      const t = s.entity(cmd.target);
      if (!t?.alive || t.team !== team) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind === 'fighter' && isSupport(u)) {
          Object.assign(u, { target: t.id, mode: 'attack', repath: 0, rest: null, attackMove: null, path: [] });
        }
      }
      return;
    }
    case 'repair': {
      const b = s.buildings.get(cmd.building);
      if (!b || b.team !== team || !b.built) return;
      if (cmd.on && b.hp >= b.maxHp) return toast(s, team, 'notDamaged', `${BUILDINGS[b.type].name} isn't damaged`);
      b.repairing = cmd.on;
      return;
    }
    case 'board': {
      const t = own(cmd.transport);
      if (t?.kind !== 'fighter' || !t.seats) return;
      for (const id of cmd.units) {
        const u = own(id);
        if (u?.kind !== 'fighter' || u.id === t.id || !isInfantryType(u.type)) continue;
        leaveBay(s, u);
        Object.assign(u, { mode: 'board', target: null, resume: null, attackMove: null, rest: null, path: [], repath: 0, board: { transport: t.id, atDoor: false, side: 1 } });
      }
      return;
    }
    case 'unload': {
      const t = own(cmd.transport);
      if (t?.kind !== 'fighter' || !t.passengers.length) return;
      leaveBay(s, t);
      Object.assign(t, { mode: 'idle', path: [], target: null, resume: null, attackMove: null, unloading: true });
      return;
    }
  }
}
