// The computer's base: what to put up next (power, refineries, the way to its best units, defences, rebuilding what
// it lost), where to put it, and repairs.
import { BUILDINGS, ECONOMY } from '@gravity-harvest/rules';
import type { GridPoint } from '@gravity-harvest/shared';
import { footprint, refineryDock } from '@gravity-harvest/sim/layout';
import { Manager, dist } from './brain.js';
import { findSpot } from './placement.js';
import { addTo } from './state.js';
import { ENGINE_IDS, isDefence, isVehicle } from './tech.js';

export class Base extends Manager {
  /** Buildings we lost (they're rebuilt after a while), and buildings we ordered that never went up. */
  noteLosses(): void {
    const b = this.state.base;
    const w = this.world;
    for (const e of w.events) if (e.e === 'buildingDestroyed' && e.team === this.ai.team && !e.sold) b.lostAt[e.type] = w.timeMs;
    const now = w.timeMs;
    b.placed = b.placed.filter((o) => {
      if (now < o.checkAt) return true;
      if (!w.own.buildings.some((x) => x.tx === o.tx && x.ty === o.ty && x.type === o.type)) {
        this.state.report.failedPlacements++;
        addTo(b.badSpots, w.key(o.tx, o.ty));
      }
      return false;
    });
  }

  /** Damaged buildings: repair them while there's money for it. */
  repairs(): void {
    const v = this.world.view!;
    for (const b of this.world.own.buildings) {
      if (!b.built || b.repairing || b.hp >= b.maxHp * this.profile.repairBelow) continue;
      if (v.credits < 300) return;
      this.ai.order({ c: 'repair', building: b.id, on: true });
    }
  }

  /** Building types we have or will have (under construction, or ordered). */
  private ownedTypes(): Set<string> {
    return new Set([...this.world.own.buildings.map((b) => b.type), ...this.ai.pendingOf('place').map((c) => c.building)]);
  }

  private count(type: string): number {
    return this.world.own.buildings.filter((b) => b.type === type).length + this.ai.pendingOf('place').filter((c) => c.building === type).length;
  }

  /** What to put up next, most needed first. */
  private wishlist(): string[] {
    const p = this.profile;
    const t = this.tech;
    const owned = this.ownedTypes();
    const minutes = this.world.timeMs / 60_000;
    const out: string[] = [];
    const want = (id: string | null | undefined) => {
      if (!id) return;
      const path = t.path(id, owned);
      if (!path) return;
      for (const x of [...path, id]) if (!out.includes(x) && t.has(x) && t.catalog.buildings[x]) out.push(x);
    };
    // power first: keep the surplus up (counting what's going up)
    const surplus = [...this.world.own.buildings.map((b) => b.type), ...this.ai.pendingOf('place').map((c) => c.building)].reduce((n, id) => n + BUILDINGS[id].power, 0);
    if (surplus < ECONOMY.aiDesiredPowerSurplus * p.powerSurplusShare && !this.rng.chance(p.powerLapse)) {
      want(t.power.slice().sort((a, b) => BUILDINGS[b].power / BUILDINGS[b].cost - BUILDINGS[a].power / BUILDINGS[a].cost).find((id) => t.path(id, owned)?.length === 0) ?? t.power[0]);
    }
    // a refinery to start with, more as the match goes on
    const refineries = Math.min(p.maxRefineries, 1 + Math.floor(minutes / p.refineryEveryMin)) + (this.world.own.buildings.filter((b) => b.type === ENGINE_IDS.yard).length > 1 ? 1 : 0);
    if (this.count(ENGINE_IDS.refinery) < refineries && t.has(ENGINE_IDS.refinery)) out.push(ENGINE_IDS.refinery);
    // whatever makes harvesters, and the army's best units
    want(ENGINE_IDS.harvester);
    const mix = this.ai.enemyMix();
    const worth = new Map(t.combat.map((id) => [id, t.value(id, mix)]));
    const ranked = t.combat.filter((id) => t.path(id, owned)).sort((a, b) => worth.get(b)! - worth.get(a)!);
    const best = ranked.length ? worth.get(ranked[0])! : 0;
    for (const id of ranked) if (worth.get(id)! >= best * 0.6) want(id);
    // defences, once the economy is going
    if (minutes >= p.defenceFromMin && t.defences.length) {
      const have = t.defences.reduce((n, id) => n + this.count(id), 0);
      const extra = Math.floor(Math.max(0, this.ai.credits() - 3000) / p.extraDefenceEvery);
      if (have < Math.min(p.maxDefences, p.defences + extra)) {
        const d = t.defences.filter((id) => t.path(id, owned)).sort((a, b) => t.value(b, mix, 0) - t.value(a, mix, 0))[0];
        if (d) {
          want(d);
          if (owned.has(d)) out.push(d);
        }
      }
    }
    // a Service Bay once there are vehicles to repair
    if (this.world.own.units.filter((u) => isVehicle(u.type) && u.type !== ENGINE_IDS.harvester).length >= 4) want(ENGINE_IDS.serviceBay);
    // rebuild what was lost (after a while: power has its own lapses), but nothing we already have unless it was
    // asked for twice
    const lostAt = this.state.base.lostAt;
    return out.filter((id, i) => {
      const lost = lostAt[id];
      if (lost !== undefined && this.world.timeMs - lost < p.rebuildDelayMs && !owned.has(id) && !t.power.includes(id)) return false;
      return !owned.has(id) || id === ENGINE_IDS.refinery || t.power.includes(id) || t.defences.includes(id) || out.indexOf(id) !== i;
    });
  }

  build(): void {
    const ai = this.ai;
    const t = this.tech;
    const p = this.profile;
    const b = this.state.base;
    let credits = ai.credits();
    let places = p.thinkMs <= 1000 ? 2 : 1;
    b.savingFor = 0;
    // buildings go up from an Assembly Yard, one at a time, and one defence at a time beside it
    const yard = this.world.own.buildings.some((x) => x.type === ENGINE_IDS.yard && x.built);
    const busy = new Set([
      ...this.world.own.buildings.filter((x) => !x.built && x.type !== ENGINE_IDS.yard).map((x) => isDefence(x.type)),
      ...ai.pendingOf('place').map((c) => isDefence(c.building)),
    ]);
    for (const id of this.wishlist()) {
      if (places <= 0 || !yard) break;
      if (busy.has(isDefence(id))) continue;
      if (!t.can(id, ai.builtTypes())) continue; // waiting for a prerequisite to finish
      const cost = BUILDINGS[id].cost;
      if (credits < cost) {
        b.savingFor = cost;
        break;
      }
      const spot = this.spotFor(id);
      if (!spot) {
        this.state.report.noSpaceMs ??= this.world.timeMs;
        continue;
      }
      ai.order({ c: 'place', building: id, tx: spot.tx, ty: spot.ty });
      busy.add(isDefence(id));
      b.placed.push({ type: id, tx: spot.tx, ty: spot.ty, checkAt: this.world.timeMs + p.reactionMs[1] + 3000 });
      credits -= cost;
      places--;
    }
  }

  private spotFor(type: string): { tx: number; ty: number } | null {
    const w = this.world;
    const home = this.state.home;
    const front = this.state.rally;
    const badSpots = this.state.base.badSpots;
    const bad = (c: GridPoint) => (badSpots.includes(w.key(Math.round(c.gx - footprint(type) / 2), Math.round(c.gy - footprint(type) / 2))) ? 1000 : 0);
    let score: (c: GridPoint) => number;
    if (type === ENGINE_IDS.refinery) {
      // its ramp near rich ore it has seen
      const rich = [...w.ore.values()].filter((t) => t.rocks.size > 0 && w.fogAt(t.tx, t.ty) > 0);
      score = (c) => {
        const d = refineryDock(c.gx - 2, c.gy - 2).front;
        let near = Infinity;
        for (const t of rich) near = Math.min(near, Math.hypot(t.tx + 0.5 - d.gx, t.ty + 0.5 - d.gy));
        return near + dist(c, home) * 0.2 + bad(c);
      };
    } else if (this.tech.defences.includes(type)) score = (c) => dist(c, front) + bad(c);
    else score = (c) => dist(c, home) + dist(c, front) * 0.3 + bad(c);
    return findSpot(w, type, score, this.rng, this.rng.chance(this.profile.randomPlacement));
  }
}
