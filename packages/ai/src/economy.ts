// The computer's economy: harvesters kept at work, the income it watches, expansions to fresh ore, and selling off
// what it can spare when the money and the ore are gone.
import { BUILDINGS, ECONOMY, UNITS } from '@gravity-harvest/rules';
import type { BuildingView, GridPoint } from '@gravity-harvest/shared';
import { Manager, centreOf, dist } from './brain.js';
import { ENGINE_IDS } from './tech.js';
import type { OreField } from './world.js';

/** Income is judged over this long (ms). */
const INCOME_WINDOW_MS = 120_000;

export class Economy extends Manager {
  /** Credits earned (its own view's stats), kept over the last INCOME_WINDOW_MS; harvesters it has count as meant. */
  noteIncome(): void {
    const e = this.state.economy;
    const v = this.world.view!;
    e.earned.push([v.timeMs, v.stats.creditsEarned]);
    while (e.earned.length > 2 && v.timeMs - e.earned[1][0] >= INCOME_WINDOW_MS) e.earned.shift();
    const have = this.world.own.units.filter((u) => u.type === ENGINE_IDS.harvester).length;
    e.harvesterGoal = Math.max(e.harvesterGoal, have);
  }

  /** Credits a minute coming in lately; null until it has watched for a minute. */
  incomePerMin(): number | null {
    const earned = this.state.economy.earned;
    const a = earned[0], b = earned[earned.length - 1];
    if (!a || b[0] - a[0] < 60_000) return null;
    return (b[1] - a[1]) / ((b[0] - a[0]) / 60_000);
  }

  /** Idle harvesters back to work: unload if full, else the best ore it knows of. Careful players pull them out of fights. */
  harvesters(): void {
    const ai = this.ai;
    const w = this.world;
    const cap = ECONOMY.harvesterCapacity;
    for (const h of w.own.units) {
      if (h.type !== ENGINE_IDS.harvester) continue;
      const hit = w.lastHit.get(h.id);
      if (this.profile.retreatBelow > 0 && hit && w.timeMs - hit.atMs < 3000 && h.hp < h.maxHp * 0.6 && h.activity !== 'unload') {
        const ref = ai.nearest(ai.refineries(true), h);
        if (ref && ai.fresh(h.id, centreOf(ref), 8000)) ai.order({ c: 'dock', units: [h.id], refinery: ref.id });
        continue;
      }
      if (h.activity !== 'idle' || h.moving || !this.rng.chance(this.profile.harvesterAttention)) continue;
      const ref = ai.nearest(ai.refineries(true), h);
      if ((h.cargo ?? 0) >= cap * 0.9 && ref) {
        ai.order({ c: 'dock', units: [h.id], refinery: ref.id });
        continue;
      }
      const tile = this.bestOre(h, ref ? centreOf(ref) : h);
      if (tile) ai.order({ c: 'harvest', units: [h.id], tx: tile.tx, ty: tile.ty });
      else if ((h.cargo ?? 0) > 0 && ref) ai.order({ c: 'dock', units: [h.id], refinery: ref.id });
    }
  }

  /** An explored ore tile worth the trip: near the harvester and its refinery, rich, and away from enemies. */
  private bestOre(h: GridPoint, base: GridPoint): { tx: number; ty: number } | null {
    const w = this.world;
    const danger = w.sightings().filter((s) => w.timeMs - s.atMs < 20_000 && this.tech.combat.length && UNITS[s.type]?.weapons.length);
    let best: { tx: number; ty: number } | null = null;
    let bestS = Infinity;
    for (const t of w.ore.values()) {
      if (!t.rocks.size || w.fogAt(t.tx, t.ty) === 0) continue;
      const c = { gx: t.tx + 0.5, gy: t.ty + 0.5 };
      let s = dist(h, c) * 0.5 + dist(base, c) - t.rocks.size * 1.5;
      if (danger.some((d) => dist(d, c) < 7)) s += 40;
      if (s < bestS) {
        bestS = s;
        best = t;
      }
    }
    return best;
  }

  /** Once the ore near its refineries runs low, it sends an Assembler to an explored field nobody holds. */
  expand(): void {
    if (!this.profile.expands || !this.tech.has(ENGINE_IDS.assembler)) return;
    const ai = this.ai;
    const e = this.state.economy;
    const home = this.state.home;
    const w = this.world;
    const own = w.own.buildings;
    if (!e.expansion) {
      const near = (f: OreField, bs: { tx: number; ty: number; size: number }[], r: number) => bs.some((b) => dist(centreOf(b), f) < r);
      const mine = w.fields.filter((f) => near(f, ai.refineries(false), 14));
      if (mine.reduce((n, f) => n + w.fieldRocks(f), 0) > 25) return;
      const target = w.fields.filter((f) => !near(f, own, 12) && !near(f, w.enemyBuildings, 16) && w.fieldRocks(f) > 40)
        .sort((a, b) => dist(a, home) - dist(b, home))[0];
      if (target) e.expansion = { field: target.id, unit: null, tries: 0 };
      return;
    }
    const ex = e.expansion;
    const field = w.fields[ex.field];
    if (yardBy(own, field)) {
      e.expansion = null; // a yard is there: the refinery follows from the building plan
      return;
    }
    const asm = w.own.units.find((u) => u.type === ENGINE_IDS.assembler);
    ex.unit = asm?.id ?? null;
    if (!asm) return;
    const spot = ai.open({ gx: field.gx + (home.gx - field.gx) * 0.25 + (ex.tries % 3) * 2 - 2, gy: field.gy + (home.gy - field.gy) * 0.25 + Math.floor(ex.tries / 3) * 2 - 2 });
    if (dist(asm, spot) < 1.5 && !asm.moving) {
      const since = e.deployAt[asm.id];
      if (since === undefined || w.timeMs - since > 8000) {
        e.deployAt[asm.id] = w.timeMs;
        if (since !== undefined) ex.tries++; // the last try didn't fit: somewhere else nearby
        ai.order({ c: 'deploy', unit: asm.id });
      }
    } else if (ai.fresh(asm.id, spot, 10_000)) ai.order({ c: 'move', orders: [{ id: asm.id, ...spot }] });
    if (ex.tries > 9) e.expansion = null;

    function yardBy(bs: BuildingView[], f: OreField) {
      return bs.some((b) => b.type === ENGINE_IDS.yard && dist(centreOf(b), f) < 10);
    }
  }

  /**
   * Broke for a while: sell what it can do without (it keeps its yard, its power and what makes its cheapest unit) to
   * pay for a last army, as a player would.
   */
  liquidate(): void {
    const ai = this.ai;
    const e = this.state.economy;
    const w = this.world;
    if (!this.profile.liquidates || !ai.broke()) {
      e.brokeSince = null;
      return;
    }
    e.brokeSince ??= w.timeMs;
    if (w.timeMs - e.brokeSince < 45_000) return;
    const t = this.tech;
    const cheapest = t.combat.filter((id) => t.can(id, ai.builtTypes())).sort((a, b) => UNITS[a].cost - UNITS[b].cost)[0];
    const keep = new Set<string>([ENGINE_IDS.yard, ...(cheapest ? t.catalog.units[cheapest].producedAt : []), ...(cheapest ? t.catalog.units[cheapest].prerequisites.flat() : [])]);
    for (const k of [...keep]) for (const x of t.path(k, new Set()) ?? []) keep.add(x);
    const spare = w.own.buildings.filter((b) => b.built && !keep.has(b.type) && BUILDINGS[b.type].power <= 0)
      .sort((a, b) => BUILDINGS[b.type].cost - BUILDINGS[a.type].cost)[0];
    if (spare) ai.order({ c: 'sell', building: spare.id });
    e.brokeSince = w.timeMs - 30_000; // the next one in a while
  }
}
