// The computer's army: hurt units pull back, a share of it defends the base, waves go out when they're strong enough
// (and come back when beaten), and the rest gather in front of the base or at a gravity vent the enemy works.
import { BUILDINGS, ECONOMY, UNITS } from '@gravity-harvest/rules';
import type { GridPoint, UnitView } from '@gravity-harvest/shared';
import { Manager, RECENT_MS, VENT_REACH, centreOf, dist } from './brain.js';
import { addTo, removeFrom } from './state.js';
import { ENGINE_IDS, isVehicle, rangeOf } from './tech.js';
import type { Sighting } from './world.js';

const VENT_SEEN_MS = 30_000;

export class Army extends Manager {
  /** Forget units that are gone, and note whether it has a good look at the enemy's army. */
  muster(units: UnitView[]): void {
    const a = this.state.army;
    const ids = new Set(units.map((u) => u.id));
    a.defenders = a.defenders.filter((id) => ids.has(id));
    a.retreating = a.retreating.filter((id) => ids.has(id));
    this.lookAtEnemyArmy(this.ai.value(units));
  }

  fight(units: UnitView[]): void {
    this.retreats(units);
    this.defend(units);
    this.attack(units);
  }

  /** The rest gather in front of the base, or go for a gravity vent the enemy is harvesting. */
  gather(units: UnitView[]): void {
    const w = this.world;
    const now = w.timeMs;
    const hold = this.ventToHold();
    const at = hold ?? this.state.rally;
    this.ai.moveGroup(units.filter((u) => !this.ai.busy(u) && !u.moving && dist(u, at) >= 4 && !(now - (w.lastShot.get(u.id) ?? -1e9) < 4000)), at, false, !!hold);
  }

  /**
   * A gravity vent worth holding (its ore never runs out), as the place for the army to gather: one the enemy's
   * harvesters were seen working lately. The army attack-moves there to stop them. (Gathering at a vent its own
   * harvesters work too was tried: matches dragged on, with the armies parked in the middle.)
   */
  private ventToHold(): GridPoint | null {
    const w = this.world;
    const theirs = w.sightings().filter((s) => s.type === ENGINE_IDS.harvester && w.timeMs - s.atMs < VENT_SEEN_MS);
    const vent = w.vents.find((v) => theirs.some((h) => dist(h, v) < VENT_REACH));
    return vent ? this.ai.open(vent) : null;
  }

  /** Badly hurt units pull back: vehicles onto a Service Bay, the rest home. */
  private retreats(units: UnitView[]): void {
    const p = this.profile;
    const w = this.world;
    const a = this.state.army;
    for (const u of units) {
      if (a.retreating.includes(u.id)) {
        if (dist(u, this.state.rally) < 4 || u.hp >= u.maxHp * 0.8) removeFrom(a.retreating, u.id);
        continue;
      }
      const hit = w.lastHit.get(u.id);
      if (!p.retreatBelow || u.hp >= u.maxHp * p.retreatBelow || !hit || w.timeMs - hit.atMs > RECENT_MS) continue;
      addTo(a.retreating, u.id);
      if (a.wave) removeFrom(a.wave.units, u.id);
      removeFrom(a.defenders, u.id);
      const bay = w.own.buildings.find((b) => b.type === ENGINE_IDS.serviceBay && b.built);
      if (bay && isVehicle(u.type)) this.ai.order({ c: 'service', units: [u.id], bay: bay.id });
      else this.ai.moveGroup([u], this.state.rally, true);
    }
  }

  private defend(units: UnitView[]): void {
    const ai = this.ai;
    const p = this.profile;
    const a = this.state.army;
    const now = this.world.timeMs;
    const threat = ai.threats();
    if (!threat) {
      a.threatSince = null;
      a.defenders = [];
      return;
    }
    a.threatSince ??= now;
    if (now - a.threatSince < p.defendDelayMs) return;
    const threatValue = threat.seen.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0), 0);
    // a strong attack on the base calls the wave home (if it's careful enough to notice)
    if (a.wave && p.abortLoss < 1 && threatValue > ai.value(units.filter((u) => !ai.busy(u)))) {
      for (const id of a.wave.units) addTo(a.defenders, id);
      this.endWave(now + 30_000);
    }
    const free = units.filter((u) => !ai.busy(u) || a.defenders.includes(u.id)).sort((x, y) => dist(x, threat.at) - dist(y, threat.at));
    const n = Math.ceil(free.length * p.defendShare);
    for (const u of free.slice(0, n)) addTo(a.defenders, u.id);
    const group = units.filter((u) => a.defenders.includes(u.id));
    this.engage(group, threat.at, threat.seen);
  }

  /** Fight around a point: focus on one target if it's that careful, otherwise go there and let them pick. */
  private engage(group: UnitView[], at: GridPoint, seen: Sighting[]): void {
    if (!group.length) return;
    const ai = this.ai;
    const w = this.world;
    const visible = w.view!.units.filter((u) => u.team !== ai.team && seen.some((s) => s.id === u.id));
    if (visible.length && this.rng.chance(this.profile.focusFire)) {
      // the weakest of the most dangerous: least health left per credit it's worth
      const target = visible.reduce((a, b) => (b.hp / ((UNITS[b.type]?.cost ?? 1) + 1) < a.hp / ((UNITS[a.type]?.cost ?? 1) + 1) ? b : a));
      const near = group.filter((u) => dist(u, target) < rangeOf(u.type) + 6);
      const ids = near.filter((u) => ai.fresh(u.id, target, 2500, 0.5)).map((u) => u.id);
      if (ids.length) ai.order({ c: 'attack', units: ids, target: target.id });
      const rest = group.filter((u) => !near.includes(u));
      if (rest.length) ai.moveGroup(rest, at, false, true);
      return;
    }
    ai.moveGroup(group.filter((u) => !u.moving), at, false, true);
  }

  /**
   * What we know of the enemy's strength: its army as seen lately and its defences. Without a fresh look at a good part
   * of its army (the last one over a minute ago) it assumes the enemy has kept up with it: a careful player doesn't
   * attack blind.
   */
  private enemyStrength(own: number): number {
    const w = this.world;
    const recent = w.sightings().filter((s) => (UNITS[s.type]?.weapons.length ?? 0) > 0 && w.timeMs - s.atMs < 60_000);
    const army = recent.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0) * (s.hp / s.maxHp), 0);
    const defences = w.enemyBuildings.filter((b) => (BUILDINGS[b.type]?.weapons.length ?? 0) > 0).reduce((n, b) => n + BUILDINGS[b.type].cost, 0);
    const saw = this.state.army.sawArmyMs;
    const fresh = saw !== null && w.timeMs - saw < 60_000;
    return (fresh ? army : Math.max(army, own)) + defences;
  }

  /** Note when it last saw a good part of the enemy's army at once (a third of its own, or more). */
  private lookAtEnemyArmy(own: number): void {
    const w = this.world;
    const inSight = w.view!.units.filter((u) => u.team !== this.ai.team && (UNITS[u.type]?.weapons.length ?? 0) > 0);
    const value = inSight.reduce((n, u) => n + (UNITS[u.type]?.cost ?? 0), 0);
    // a good part of its army in sight, or a look at its base (whatever defends it is in sight too)
    if (value >= own / 3 || w.enemyBuildings.some((b) => w.fogAt(b.tx, b.ty) === 2)) this.state.army.sawArmyMs = w.timeMs;
  }

  private endWave(next: number): void {
    this.state.army.wave = null;
    this.state.army.nextWaveMs = next;
  }

  /** Waves: gather, go when it's time and the force is big enough, push from building to building, pull back if beaten. */
  private attack(units: UnitView[]): void {
    const ai = this.ai;
    const p = this.profile;
    const w = this.world;
    const a = this.state.army;
    const now = w.timeMs;
    const interval = ECONOMY.aiAttackIntervalMinutes * 60_000 * p.attackTimeShift;
    if (!a.wave) {
      if (now < a.nextWaveMs) return;
      const pool = units.filter((u) => !ai.busy(u));
      const value = ai.value(pool);
      // the longer it has waited, the less it asks for (so it never just sits there)
      const relax = Math.max(0.6, 1 - a.waveWaits * 0.04);
      const enough = value >= p.minWaveValue * Math.max(0.4, 1 - a.waveWaits * 0.15) && (!p.attackAdvantage || value >= p.attackAdvantage * relax * this.enemyStrength(value));
      // all in: an army at the cap, or no money and no income left to build a bigger one
      const forced = value >= p.forceAttackValue || w.own.units.length >= w.view!.unitCap - 3 || (ai.broke() && value > 0);
      if (!enough && !forced) {
        // not ready: look again in a while, a little less demanding each time (so it never just sits there)
        a.waveWaits++;
        a.nextWaveMs = now + 20_000;
        return;
      }
      a.waveWaits = 0;
      a.wave = { units: pool.map((u) => u.id), target: null, explore: null, closest: { d: null, ms: now }, launchedValue: value };
      this.state.report.waves++;
      this.state.report.firstAttackMs ??= now;
    }
    const wave = a.wave;
    // reinforcements: what has gathered since joins it, once it's worth sending
    const fresh = units.filter((u) => !ai.busy(u));
    if (fresh.length && (ai.value(fresh) >= p.minWaveValue / 2 || w.own.units.length >= w.view!.unitCap - 3)) for (const u of fresh) addTo(wave.units, u.id);
    const group = units.filter((u) => wave.units.includes(u.id));
    wave.units = wave.units.filter((id) => group.some((u) => u.id === id));
    if (!group.length) return this.endWave(now + interval);
    const value = ai.value(group);
    const centre = { gx: group.reduce((n, u) => n + u.gx, 0) / group.length, gy: group.reduce((n, u) => n + u.gy, 0) / group.length };
    const nearby = w.sightings().filter((s) => now - s.atMs < RECENT_MS && dist(s, centre) < 10);
    const local = nearby.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0) * (s.hp / s.maxHp), 0)
      + w.enemyBuildings.filter((b) => (BUILDINGS[b.type]?.weapons.length ?? 0) > 0 && dist(centreOf(b), centre) < 10).reduce((n, b) => n + BUILDINGS[b.type].cost, 0);
    if (value < wave.launchedValue * (1 - p.abortLoss) && local > value) {
      ai.moveGroup(group, this.state.rally, true);
      return this.endWave(now + interval / 2);
    }
    // what to go for: the nearest enemy building we know of, else somewhere we haven't looked
    let target = wave.target !== null ? w.enemyBuildings.find((b) => b.id === wave.target) : undefined;
    if (!target) {
      target = w.enemyBuildings.length ? w.enemyBuildings.reduce((x, y) => (dist(centreOf(y), centre) < dist(centreOf(x), centre) ? y : x)) : undefined;
      wave.target = target?.id ?? null;
    }
    if (!target && wave.explore) {
      // a place it can't get any nearer to (blocked off, or across the trees) is given up for another
      const d = dist(centre, wave.explore);
      if (wave.closest.d === null || d < wave.closest.d - 1) wave.closest = { d, ms: now };
      else if (now - wave.closest.ms > 25_000) {
        addTo(this.state.scouting.unreachable, w.key(Math.floor(wave.explore.gx), Math.floor(wave.explore.gy)));
        wave.explore = null;
      }
    }
    if (!target && (!wave.explore || w.fogAt(Math.floor(wave.explore.gx), Math.floor(wave.explore.gy)) === 2)) {
      wave.explore = ai.unexplored(centre);
      wave.closest = { d: null, ms: now };
    }
    if (!target && !wave.explore) {
      ai.moveGroup(group, this.state.rally);
      return this.endWave(now + interval);
    }
    // enemy units in the way: fight them
    const fighting = nearby.filter((s) => w.view!.units.some((u) => u.id === s.id));
    if (fighting.length) return this.engage(group, centre, fighting);
    const goal = target ? centreOf(target) : wave.explore!;
    const idle = group.filter((u) => !u.moving && !(now - (w.lastShot.get(u.id) ?? -1e9) < 3000));
    if (target) {
      const close = idle.filter((u) => dist(u, goal) < rangeOf(u.type) + target!.size);
      if (close.length) ai.order({ c: 'attack', units: close.map((u) => u.id), target: target.id });
      ai.moveGroup(idle.filter((u) => !close.includes(u)), goal, false, true);
    } else ai.moveGroup(idle, goal, false, true);
  }
}
