// The computer opponent. It plays one side from that side's view only (what a player on that side is sent) and
// acts only by giving the orders a player gives. Each think it looks after its economy, its buildings, its
// production and its army; its difficulty profile decides how often it thinks, how slowly its orders go out and
// how many mistakes it makes on the way. Deterministic: the same views and seed give the same orders.
import { BUILDINGS, ECONOMY, UNITS, type Faction } from '@gravity-harvest/rules';
import type { BuildingView, Command, Difficulty, GridPoint, MatchHello, TeamId, TeamView, UnitView } from '@gravity-harvest/shared';
import { footprint, refineryDock } from '@gravity-harvest/sim/layout';
import { findSpot } from './placement.js';
import { PROFILES, type AiProfile } from './profiles.js';
import { Rng } from './rng.js';
import { ENGINE_IDS, Tech, evenMix, isAircraft, isDefence, isVehicle, rangeOf, type ArmorMix } from './tech.js';
import { World, type OreField, type Sighting } from './world.js';

export interface ComputerOptions {
  /** The hello this side was sent (map, ore, scenery, its catalog and faction). */
  hello: MatchHello;
  difficulty: Difficulty;
  seed: number;
  /** Tweaks on top of the difficulty's profile (tuning and tests). */
  profile?: Partial<AiProfile>;
}

/** What it did, for the simulator's reports. */
export interface AiReport {
  orders: number;
  waves: number;
  firstAttackMs: number | null;
  /** Buildings it ordered that never appeared (the spot turned out to be taken). */
  failedPlacements: number;
  /** When it first knew where an enemy building was. */
  foundEnemyMs: number | null;
  /** When it first found no room for a building it wanted (its base is out of space). */
  noSpaceMs: number | null;
}

/**
 * Feed the computer a view of its side every this many sim ticks (500 ms): how soon it can see things and give
 * orders, the same in matches and simulations (its profile's think rate and reaction time come on top).
 */
export const AI_VIEW_EVERY_TICKS = 10;

interface Wave {
  units: Set<number>;
  /** An enemy building, or a place to look for them (and how close it has got to that place, and when). */
  target: number | null;
  explore: GridPoint | null;
  closest: { d: number; ms: number };
  launchedValue: number;
}

interface Pending {
  due: number;
  cmd: Command;
}

const dist = (a: GridPoint, b: GridPoint) => Math.hypot(a.gx - b.gx, a.gy - b.gy);
const centreOf = (b: { tx: number; ty: number; size: number }): GridPoint => ({ gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 });
const RECENT_MS = 6000;
/** Enemies this close to our buildings (tiles) are an attack on the base. */
const BASE_RADIUS = 11;
/** A harvester this close to a gravity vent (tiles) is working it; one of the enemy's seen there this recently counts. */
const VENT_REACH = 6;
const VENT_SEEN_MS = 30_000;
/** Income is judged over this long (ms). */
const INCOME_WINDOW_MS = 120_000;
/** An extra harvester must earn its price back within this many minutes (from what each one earns now). */
const HARVESTER_PAYBACK_MIN = 3;
/** Its army is far behind when it's worth less than this share of the enemy army it saw in the last minute... */
const BEHIND_SHARE = 0.5;
/** ...and that army was worth at least this (credits): a couple of scouts don't count. */
const BEHIND_MIN_ENEMY = 1500;

export class ComputerPlayer {
  readonly team: TeamId;
  readonly difficulty: Difficulty;
  readonly profile: AiProfile;
  readonly report: AiReport = { orders: 0, waves: 0, firstAttackMs: null, failedPlacements: 0, foundEnemyMs: null, noSpaceMs: null };
  private readonly world: World;
  private readonly tech: Tech;
  private readonly rng: Rng;
  private nextThink = 0;
  private pending: Pending[] = [];
  private tokens = 5;
  private tokenMs = 0;
  private home: GridPoint = { gx: 0, gy: 0 };
  private rally: GridPoint = { gx: 0, gy: 0 };
  private wave: Wave | null = null;
  private nextWaveMs: number;
  private waveWaits = 0;
  private scout: { id: number; target: GridPoint | null; legs: number } | null = null;
  private nextScoutMs: number;
  private threatSince: number | null = null;
  private readonly defenders = new Set<number>();
  private readonly retreating = new Set<number>();
  /** When we lost a building of each type (it waits `rebuildDelayMs` before putting it up again). */
  private readonly lostAt = new Map<string, number>();
  private placed: { type: string; tx: number; ty: number; checkAt: number }[] = [];
  private readonly badSpots = new Set<number>();
  private readonly lastOrder = new Map<number, { gx: number; gy: number; ms: number }>();
  /** Cost of the building it is saving up for (production keeps some of it in hand). */
  private savingFor = 0;
  private expansion: { field: OreField; unit: number | null; tries: number } | null = null;
  private deployAt = new Map<number, number>();
  private brokeSince: number | null = null;
  /** Places to look at that it couldn't get to. */
  private readonly unreachable = new Set<number>();
  /** When it last had a good look at the enemy's army. */
  private sawArmyMs = -Infinity;
  /** How many harvesters it means to have (lost ones are replaced up to this). */
  private harvesterGoal = 1;
  /** Credits earned so far, sampled each think over the last INCOME_WINDOW_MS: [time, earned]. */
  private earned: [number, number][] = [];

  constructor(opts: ComputerOptions) {
    this.team = opts.hello.team;
    this.difficulty = opts.difficulty;
    this.profile = { ...PROFILES[opts.difficulty], ...opts.profile };
    this.world = new World(opts.hello);
    this.tech = new Tech(opts.hello.catalog, opts.hello.faction as Faction);
    this.rng = new Rng(opts.seed >>> 0 || 1);
    this.nextWaveMs = ECONOMY.aiFirstAttackMinutes * 60_000 * this.profile.attackTimeShift;
    this.nextScoutMs = this.profile.scoutEveryMs ? 20_000 : Infinity;
  }

  /**
   * Take in a view of this side (feed it every view fetched, in order) and return the orders to give now. It only
   * decides every `thinkMs`; in between it just lets out the orders whose reaction delay is over.
   */
  update(view: TeamView): Command[] {
    this.world.observe(view);
    if (view.timeMs >= this.nextThink && !view.paused) {
      this.nextThink = view.timeMs + this.profile.thinkMs;
      this.think();
      this.world.events = [];
    }
    return this.release(view.timeMs);
  }

  // --- Orders: delayed by reaction time, limited by actions per minute ------------------------------------------

  private order(cmd: Command): void {
    const [a, b] = this.profile.reactionMs;
    this.pending.push({ due: this.world.timeMs + this.rng.range(a, b), cmd });
  }

  private release(now: number): Command[] {
    const p = this.profile;
    this.tokens = Math.min(Math.max(3, p.apm / 10), this.tokens + ((now - this.tokenMs) / 60_000) * p.apm);
    this.tokenMs = now;
    const out: Command[] = [];
    const keep: Pending[] = [];
    for (const o of this.pending) {
      if (o.due <= now && this.tokens >= 1) {
        this.tokens -= 1;
        out.push(o.cmd);
      } else keep.push(o);
    }
    this.pending = keep;
    this.report.orders += out.length;
    return out;
  }

  /** Orders decided but not given yet: production and buildings already asked for count as on their way. */
  private pendingOf<C extends Command['c']>(c: C): Extract<Command, { c: C }>[] {
    return this.pending.map((p) => p.cmd).filter((x): x is Extract<Command, { c: C }> => x.c === c);
  }

  // --- Thinking -------------------------------------------------------------------------------------------------------

  private think(): void {
    const p = this.profile;
    const w = this.world;
    const v = w.view!;
    if (!w.own.buildings.length && !w.own.units.length) return;
    this.locate();
    this.noteLosses();
    this.noteIncome();
    if (this.report.foundEnemyMs === null && w.enemyBuildings.length) this.report.foundEnemyMs = v.timeMs;
    const skip = () => this.rng.chance(p.skipChance);
    if (!skip()) this.harvesters();
    if (!skip() && !this.rng.chance(p.buildLapse)) this.build();
    if (!skip() && this.rng.chance(p.repairChance)) this.repairs();
    if (!skip() && !this.rng.chance(p.productionLapse)) this.produce();
    if (!skip()) this.expand();
    if (!skip()) this.liquidate();
    if (!skip()) this.army();
  }

  /** Where home is (the middle of our buildings) and where the army gathers (out in front, towards the enemy). */
  private locate(): void {
    const own = this.world.own.buildings;
    if (own.length) {
      this.home = {
        gx: own.reduce((n, b) => n + b.tx + b.size / 2, 0) / own.length,
        gy: own.reduce((n, b) => n + b.ty + b.size / 2, 0) / own.length,
      };
    } else if (this.world.own.units.length) this.home = { gx: this.world.own.units[0].gx, gy: this.world.own.units[0].gy };
    const to = this.enemyGuess();
    const d = dist(this.home, to) || 1;
    const out = Math.min(9, d / 3);
    this.rally = this.open({ gx: this.home.gx + ((to.gx - this.home.gx) / d) * out, gy: this.home.gy + ((to.gy - this.home.gy) / d) * out });
  }

  /**
   * Where the enemy is: its buildings we know of, else by the ore field farthest from us (every base starts by a field
   * of its own, and the map's ore is in plain sight from the start, as for a player), else the middle of the map.
   */
  private enemyGuess(): GridPoint {
    const w = this.world;
    const eb = w.enemyBuildings;
    if (eb.length) return { gx: eb.reduce((n, b) => n + b.tx + b.size / 2, 0) / eb.length, gy: eb.reduce((n, b) => n + b.ty + b.size / 2, 0) / eb.length };
    const field = w.fields.filter((f) => !w.vents.some((v) => dist(v, f) < VENT_REACH))
      .reduce<OreField | undefined>((a, f) => (!a || dist(f, this.home) > dist(a, this.home) ? f : a), undefined);
    return field && dist(field, this.home) > BASE_RADIUS ? { gx: field.gx, gy: field.gy } : { gx: w.width / 2, gy: w.height / 2 };
  }

  /** The nearest open tile's middle to a point. */
  private open(at: GridPoint): GridPoint {
    const w = this.world;
    const tx = Math.floor(at.gx), ty = Math.floor(at.gy);
    for (let r = 0; r < 8; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!w.isBlocked(tx + dx, ty + dy) && !w.hasOre(tx + dx, ty + dy)) return { gx: tx + dx + 0.5, gy: ty + dy + 0.5 };
      }
    }
    return { gx: tx + 0.5, gy: ty + 0.5 };
  }

  /** Buildings we lost (they're rebuilt after a while), and buildings we ordered that never went up. */
  private noteLosses(): void {
    const w = this.world;
    for (const e of w.events) if (e.e === 'buildingDestroyed' && e.team === this.team && !e.sold) this.lostAt.set(e.type, w.timeMs);
    const now = w.timeMs;
    this.placed = this.placed.filter((o) => {
      if (now < o.checkAt) return true;
      if (!w.own.buildings.some((b) => b.tx === o.tx && b.ty === o.ty && b.type === o.type)) {
        this.report.failedPlacements++;
        this.badSpots.add(w.key(o.tx, o.ty));
      }
      return false;
    });
  }

  // --- Economy ------------------------------------------------------------------------------------------------------

  private credits(): number {
    const queued = this.pendingOf('train').reduce((n, c) => n + UNITS[c.unit].cost, 0) + this.pendingOf('place').reduce((n, c) => n + BUILDINGS[c.building].cost, 0);
    return this.world.view!.credits - queued;
  }

  private refineries(builtOnly: boolean): BuildingView[] {
    return this.world.own.buildings.filter((b) => b.type === ENGINE_IDS.refinery && (!builtOnly || b.built));
  }

  /** Idle harvesters back to work: unload if full, else the best ore it knows of. Careful players pull them out of fights. */
  private harvesters(): void {
    const w = this.world;
    const cap = ECONOMY.harvesterCapacity;
    for (const h of w.own.units) {
      if (h.type !== ENGINE_IDS.harvester) continue;
      const hit = w.lastHit.get(h.id);
      if (this.profile.retreatBelow > 0 && hit && w.timeMs - hit.atMs < 3000 && h.hp < h.maxHp * 0.6 && h.activity !== 'unload') {
        const ref = this.nearest(this.refineries(true), h);
        if (ref && this.fresh(h.id, centreOf(ref), 8000)) this.order({ c: 'dock', units: [h.id], refinery: ref.id });
        continue;
      }
      if (h.activity !== 'idle' || h.moving || !this.rng.chance(this.profile.harvesterAttention)) continue;
      const ref = this.nearest(this.refineries(true), h);
      if ((h.cargo ?? 0) >= cap * 0.9 && ref) {
        this.order({ c: 'dock', units: [h.id], refinery: ref.id });
        continue;
      }
      const tile = this.bestOre(h, ref ? centreOf(ref) : h);
      if (tile) this.order({ c: 'harvest', units: [h.id], tx: tile.tx, ty: tile.ty });
      else if ((h.cargo ?? 0) > 0 && ref) this.order({ c: 'dock', units: [h.id], refinery: ref.id });
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

  /** Damaged buildings: repair them while there's money for it. */
  private repairs(): void {
    const v = this.world.view!;
    for (const b of this.world.own.buildings) {
      if (!b.built || b.repairing || b.hp >= b.maxHp * this.profile.repairBelow) continue;
      if (v.credits < 300) return;
      this.order({ c: 'repair', building: b.id, on: true });
    }
  }

  /** A harvester at work and ore left for it. */
  private hasIncome(): boolean {
    const w = this.world;
    return w.own.units.some((u) => u.type === ENGINE_IDS.harvester) && w.fields.some((f) => w.fieldRocks(f) > 3);
  }

  /** No money for even its cheapest unit, and no harvester bringing more in. */
  private broke(): boolean {
    const cheapest = Math.min(...this.tech.combat.map((id) => UNITS[id].cost));
    return this.credits() < cheapest && !this.hasIncome() && !this.world.view!.queue.length;
  }

  /**
   * Broke for a while: sell what it can do without (it keeps its yard, its power and what makes its cheapest unit) to
   * pay for a last army, as a player would.
   */
  private liquidate(): void {
    const w = this.world;
    if (!this.profile.liquidates || !this.broke()) {
      this.brokeSince = null;
      return;
    }
    this.brokeSince ??= w.timeMs;
    if (w.timeMs - this.brokeSince < 45_000) return;
    const t = this.tech;
    const cheapest = t.combat.filter((id) => t.can(id, this.builtTypes())).sort((a, b) => UNITS[a].cost - UNITS[b].cost)[0];
    const keep = new Set<string>([ENGINE_IDS.yard, ...(cheapest ? t.catalog.units[cheapest].producedAt : []), ...(cheapest ? t.catalog.units[cheapest].prerequisites.flat() : [])]);
    for (const k of [...keep]) for (const x of t.path(k, new Set()) ?? []) keep.add(x);
    const spare = w.own.buildings.filter((b) => b.built && !keep.has(b.type) && BUILDINGS[b.type].power <= 0)
      .sort((a, b) => BUILDINGS[b.type].cost - BUILDINGS[a.type].cost)[0];
    if (spare) this.order({ c: 'sell', building: spare.id });
    this.brokeSince = w.timeMs - 30_000; // the next one in a while
  }

  // --- Building -----------------------------------------------------------------------------------------------------

  /** Building types we have or will have (under construction, or ordered). */
  private ownedTypes(): Set<string> {
    return new Set([...this.world.own.buildings.map((b) => b.type), ...this.pendingOf('place').map((c) => c.building)]);
  }

  private builtTypes(): string[] {
    return this.world.own.buildings.filter((b) => b.built).map((b) => b.type);
  }

  private count(type: string): number {
    return this.world.own.buildings.filter((b) => b.type === type).length + this.pendingOf('place').filter((c) => c.building === type).length;
  }

  /** What the enemy's army is made of (what it has seen of it), blended with an even guess by how much it counter-picks. */
  private enemyMix(): ArmorMix {
    const mix = evenMix();
    const seen = this.world.sightings();
    const total = seen.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0), 0);
    const k = total > 0 ? this.profile.counterPick : 0;
    for (const a of Object.keys(mix) as (keyof ArmorMix)[]) mix[a] *= 1 - k;
    for (const s of seen) {
      const u = UNITS[s.type];
      if (!u || !total) continue;
      const share = (u.cost / total) * k;
      if (isAircraft(s.type)) mix.air += share;
      else mix[u.armor] += share;
    }
    return mix;
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
    const surplus = [...this.world.own.buildings.map((b) => b.type), ...this.pendingOf('place').map((c) => c.building)].reduce((n, id) => n + BUILDINGS[id].power, 0);
    if (surplus < ECONOMY.aiDesiredPowerSurplus * p.powerSurplusShare && !this.rng.chance(p.powerLapse)) {
      want(t.power.slice().sort((a, b) => BUILDINGS[b].power / BUILDINGS[b].cost - BUILDINGS[a].power / BUILDINGS[a].cost).find((id) => t.path(id, owned)?.length === 0) ?? t.power[0]);
    }
    // a refinery to start with, more as the match goes on
    const refineries = Math.min(p.maxRefineries, 1 + Math.floor(minutes / p.refineryEveryMin)) + (this.world.own.buildings.filter((b) => b.type === ENGINE_IDS.yard).length > 1 ? 1 : 0);
    if (this.count(ENGINE_IDS.refinery) < refineries && t.has(ENGINE_IDS.refinery)) out.push(ENGINE_IDS.refinery);
    // whatever makes harvesters, and the army's best units
    want(ENGINE_IDS.harvester);
    const mix = this.enemyMix();
    const worth = new Map(t.combat.map((id) => [id, t.value(id, mix)]));
    const ranked = t.combat.filter((id) => t.path(id, owned)).sort((a, b) => worth.get(b)! - worth.get(a)!);
    const best = ranked.length ? worth.get(ranked[0])! : 0;
    for (const id of ranked) if (worth.get(id)! >= best * 0.6) want(id);
    // defences, once the economy is going
    if (minutes >= p.defenceFromMin && t.defences.length) {
      const have = t.defences.reduce((n, id) => n + this.count(id), 0);
      const extra = Math.floor(Math.max(0, this.credits() - 3000) / p.extraDefenceEvery);
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
    return out.filter((id, i) => {
      const lost = this.lostAt.get(id);
      if (lost !== undefined && this.world.timeMs - lost < p.rebuildDelayMs && !owned.has(id) && !t.power.includes(id)) return false;
      return !owned.has(id) || id === ENGINE_IDS.refinery || t.power.includes(id) || t.defences.includes(id) || out.indexOf(id) !== i;
    });
  }

  private build(): void {
    const t = this.tech;
    const p = this.profile;
    let credits = this.credits();
    let places = p.thinkMs <= 1000 ? 2 : 1;
    this.savingFor = 0;
    // buildings go up from an Assembly Yard, one at a time, and one defence at a time beside it
    const yard = this.world.own.buildings.some((b) => b.type === ENGINE_IDS.yard && b.built);
    const busy = new Set([
      ...this.world.own.buildings.filter((b) => !b.built && b.type !== ENGINE_IDS.yard).map((b) => isDefence(b.type)),
      ...this.pendingOf('place').map((c) => isDefence(c.building)),
    ]);
    for (const id of this.wishlist()) {
      if (places <= 0 || !yard) break;
      if (busy.has(isDefence(id))) continue;
      if (!t.can(id, this.builtTypes())) continue; // waiting for a prerequisite to finish
      const cost = BUILDINGS[id].cost;
      if (credits < cost) {
        this.savingFor = cost;
        break;
      }
      const spot = this.spotFor(id);
      if (!spot) {
        this.report.noSpaceMs ??= this.world.timeMs;
        continue;
      }
      this.order({ c: 'place', building: id, tx: spot.tx, ty: spot.ty });
      busy.add(isDefence(id));
      this.placed.push({ type: id, tx: spot.tx, ty: spot.ty, checkAt: this.world.timeMs + p.reactionMs[1] + 3000 });
      credits -= cost;
      places--;
    }
  }

  private spotFor(type: string): { tx: number; ty: number } | null {
    const w = this.world;
    const home = this.home;
    const front = this.rally;
    const bad = (c: GridPoint) => (this.badSpots.has(w.key(Math.round(c.gx - footprint(type) / 2), Math.round(c.gy - footprint(type) / 2))) ? 1000 : 0);
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

  // --- Production -----------------------------------------------------------------------------------------------------

  /** Credits earned (its own view's stats), kept over the last INCOME_WINDOW_MS; harvesters it has count as meant. */
  private noteIncome(): void {
    const v = this.world.view!;
    this.earned.push([v.timeMs, v.stats.creditsEarned]);
    while (this.earned.length > 2 && v.timeMs - this.earned[1][0] >= INCOME_WINDOW_MS) this.earned.shift();
    const have = this.world.own.units.filter((u) => u.type === ENGINE_IDS.harvester).length;
    this.harvesterGoal = Math.max(this.harvesterGoal, have);
  }

  /** Credits a minute coming in lately; null until it has watched for a minute. */
  private incomePerMin(): number | null {
    const a = this.earned[0], b = this.earned[this.earned.length - 1];
    if (!a || b[0] - a[0] < 60_000) return null;
    return (b[1] - a[1]) / ((b[0] - a[0]) / 60_000);
  }

  /**
   * Whether one more harvester is worth holding the queue for: the ore it knows of can keep another busy (the caller
   * checks), each harvester earns its price back within HARVESTER_PAYBACK_MIN minutes, and at full production its
   * money would run out within the profile's look-ahead. Cash flow, not cash in hand: a side that has just bought a
   * factory but earns more than it can spend doesn't need one.
   */
  private moreHarvesters(harvesters: number, options: string[]): boolean {
    if (harvesters === 0) return true;
    const income = this.incomePerMin();
    if (income === null) return false;
    const perHarvester = income / harvesters;
    if (perHarvester * HARVESTER_PAYBACK_MIN < UNITS[ENGINE_IDS.harvester].cost) return false;
    // what one production queue can spend a minute on the army (build times follow costs, so this is about the same for all)
    const spend = Math.max(0, ...options.map((id) => (UNITS[id].cost / UNITS[id].buildTimeSec) * 60));
    const short = spend - income;
    return short > 0 && this.credits() / short < this.profile.economyLookaheadMin;
  }

  /** A threat near its base, or its army far behind the enemy army it saw in the last minute. */
  private inDanger(): boolean {
    if (this.threats()) return true;
    const w = this.world;
    const enemy = w.sightings().filter((s) => (UNITS[s.type]?.weapons.length ?? 0) > 0 && w.timeMs - s.atMs < 60_000)
      .reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0) * (s.hp / s.maxHp), 0);
    const own = this.value(w.own.units.filter((u) => this.tech.combat.includes(u.type)));
    return enemy >= BEHIND_MIN_ENEMY && own < enemy * BEHIND_SHARE;
  }

  private produce(): void {
    const p = this.profile;
    const t = this.tech;
    const v = this.world.view!;
    const built = this.builtTypes();
    const options = t.combat.filter((id) => t.can(id, built));
    // under attack or far behind, the army comes first: a harvester would hold the vehicle queue for over a minute, so
    // one that hasn't got far is taken out of it (with none at all, it trains one when it can't pay for any army)
    const affordable = options.some((id) => UNITS[id].cost <= this.credits());
    const armyFirst = affordable && this.inDanger() && this.rng.chance(p.armyFirst);
    if (armyFirst && v.queue.some((q) => q.unit === ENGINE_IDS.harvester && q.progress < 0.6) && !this.pendingOf('cancelTrain').length) {
      this.order({ c: 'cancelTrain', unit: ENGINE_IDS.harvester });
    }
    const queued = [...v.queue.map((q) => q.unit), ...this.pendingOf('train').map((c) => c.unit)];
    if (queued.length >= p.queueDepth) return;
    if (this.world.own.units.length + queued.length >= v.unitCap - 1) return;
    const credits = this.credits();
    const train = (unit: string) => this.order({ c: 'train', unit, near: this.rally });
    // harvesters: the ones it lost back once it's safe, and one more when the economy needs it (see `moreHarvesters`)
    const harvesters = this.world.own.units.filter((u) => u.type === ENGINE_IDS.harvester).length + queued.filter((u) => u === ENGINE_IDS.harvester).length;
    const ore = this.world.fields.reduce((n, f) => n + this.world.fieldRocks(f), 0);
    const wantH = Math.min(this.refineries(true).length * p.harvestersPerRefinery, Math.ceil(ore / 25));
    if (!armyFirst && harvesters < wantH && t.can(ENGINE_IDS.harvester, built) && (harvesters < this.harvesterGoal || this.moreHarvesters(harvesters, options))) {
      if (credits >= UNITS[ENGINE_IDS.harvester].cost) {
        this.harvesterGoal = Math.max(this.harvesterGoal, harvesters + 1);
        return train(ENGINE_IDS.harvester);
      }
      if (this.hasIncome()) return; // saving up for it; with nothing coming in it would wait for ever
    }
    // an Assembler for an expansion
    if (this.expansion && this.expansion.unit === null && !queued.includes(ENGINE_IDS.assembler) && t.can(ENGINE_IDS.assembler, built)) {
      if (credits >= UNITS[ENGINE_IDS.assembler].cost) train(ENGINE_IDS.assembler);
      return;
    }
    // the army: a mix weighted by what each unit is worth against what it has seen of the enemy
    const mix = this.enemyMix();
    if (!options.length) return;
    const weights = new Map(options.map((id) => [id, Math.pow(t.value(id, mix), p.mixSharpness)]));
    const unit = this.rng.weighted(options, (id) => weights.get(id)!)!;
    // it keeps money back for the building it's saving for, unless no more is coming in (then the army comes first)
    if (credits >= UNITS[unit].cost + (this.hasIncome() ? this.savingFor * p.buildingReserve : 0)) train(unit);
  }

  // --- Expanding --------------------------------------------------------------------------------------------------------

  /** Once the ore near its refineries runs low, it sends an Assembler to an explored field nobody holds. */
  private expand(): void {
    if (!this.profile.expands || !this.tech.has(ENGINE_IDS.assembler)) return;
    const w = this.world;
    const own = w.own.buildings;
    if (!this.expansion) {
      const near = (f: OreField, bs: { tx: number; ty: number; size: number }[], r: number) => bs.some((b) => dist(centreOf(b), f) < r);
      const mine = w.fields.filter((f) => near(f, this.refineries(false), 14));
      if (mine.reduce((n, f) => n + w.fieldRocks(f), 0) > 25) return;
      const target = w.fields.filter((f) => !near(f, own, 12) && !near(f, w.enemyBuildings, 16) && w.fieldRocks(f) > 40)
        .sort((a, b) => dist(a, this.home) - dist(b, this.home))[0];
      if (target) this.expansion = { field: target, unit: null, tries: 0 };
      return;
    }
    const ex = this.expansion;
    if (near2(own, ex.field)) {
      this.expansion = null; // a yard is there: the refinery follows from the building plan
      return;
    }
    const asm = w.own.units.find((u) => u.type === ENGINE_IDS.assembler);
    ex.unit = asm?.id ?? null;
    if (!asm) return;
    const spot = this.open({ gx: ex.field.gx + (this.home.gx - ex.field.gx) * 0.25 + (ex.tries % 3) * 2 - 2, gy: ex.field.gy + (this.home.gy - ex.field.gy) * 0.25 + Math.floor(ex.tries / 3) * 2 - 2 });
    if (dist(asm, spot) < 1.5 && !asm.moving) {
      const since = this.deployAt.get(asm.id);
      if (since === undefined || w.timeMs - since > 8000) {
        this.deployAt.set(asm.id, w.timeMs);
        if (since !== undefined) ex.tries++; // the last try didn't fit: somewhere else nearby
        this.order({ c: 'deploy', unit: asm.id });
      }
    } else if (this.fresh(asm.id, spot, 10_000)) this.order({ c: 'move', orders: [{ id: asm.id, ...spot }] });
    if (ex.tries > 9) this.expansion = null;

    function near2(bs: BuildingView[], f: OreField) {
      return bs.some((b) => b.type === ENGINE_IDS.yard && dist(centreOf(b), f) < 10);
    }
  }

  // --- Army ------------------------------------------------------------------------------------------------------------

  private army(): void {
    const w = this.world;
    const now = w.timeMs;
    const units = w.own.units.filter((u) => this.tech.combat.includes(u.type));
    const ids = new Set(units.map((u) => u.id));
    for (const set of [this.defenders, this.retreating]) for (const id of set) if (!ids.has(id)) set.delete(id);
    if (this.scout && !ids.has(this.scout.id)) {
      this.scout = null;
      this.nextScoutMs = now + this.profile.scoutEveryMs;
    }
    this.lookAtEnemyArmy(this.value(units));
    this.retreats(units);
    this.defend(units);
    this.attack(units);
    this.scouting(units);
    // the rest gather in front of the base, or go for a gravity vent the enemy is harvesting
    const hold = this.ventToHold();
    const gather = hold ?? this.rally;
    this.moveGroup(units.filter((u) => !this.busy(u) && !u.moving && dist(u, gather) >= 4 && !(now - (w.lastShot.get(u.id) ?? -1e9) < 4000)), gather, false, !!hold);
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
    return vent ? this.open(vent) : null;
  }

  private busy(u: UnitView): boolean {
    return this.defenders.has(u.id) || this.retreating.has(u.id) || this.scout?.id === u.id || !!this.wave?.units.has(u.id);
  }

  /** Badly hurt units pull back: vehicles onto a Service Bay, the rest home. */
  private retreats(units: UnitView[]): void {
    const p = this.profile;
    const w = this.world;
    for (const u of units) {
      if (this.retreating.has(u.id)) {
        if (dist(u, this.rally) < 4 || u.hp >= u.maxHp * 0.8) this.retreating.delete(u.id);
        continue;
      }
      const hit = w.lastHit.get(u.id);
      if (!p.retreatBelow || u.hp >= u.maxHp * p.retreatBelow || !hit || w.timeMs - hit.atMs > RECENT_MS) continue;
      this.retreating.add(u.id);
      this.wave?.units.delete(u.id);
      this.defenders.delete(u.id);
      const bay = w.own.buildings.find((b) => b.type === ENGINE_IDS.serviceBay && b.built);
      if (bay && isVehicle(u.type)) this.order({ c: 'service', units: [u.id], bay: bay.id });
      else this.moveGroup([u], this.rally, true);
    }
  }

  /** Enemies near the base (seen, or shooting at it from out of sight). */
  private threats(): { at: GridPoint; seen: Sighting[] } | null {
    const w = this.world;
    const now = w.timeMs;
    const mine = [...w.own.buildings.map(centreOf), ...w.own.units.filter((u) => u.type === ENGINE_IDS.harvester)];
    const seen = w.sightings().filter((s) => now - s.atMs < RECENT_MS && (UNITS[s.type]?.weapons.length ?? 0) > 0 && mine.some((m) => dist(m, s) < BASE_RADIUS));
    if (seen.length) return { at: { gx: seen.reduce((n, s) => n + s.gx, 0) / seen.length, gy: seen.reduce((n, s) => n + s.gy, 0) / seen.length }, seen };
    for (const [id, hit] of w.lastHit) {
      if (now - hit.atMs > 3000) continue;
      const b = w.own.buildings.find((x) => x.id === id);
      const h = w.own.units.find((x) => x.id === id && x.type === ENGINE_IDS.harvester);
      if (b || h) return { at: { gx: hit.gx, gy: hit.gy }, seen: [] };
    }
    return null;
  }

  private defend(units: UnitView[]): void {
    const p = this.profile;
    const now = this.world.timeMs;
    const threat = this.threats();
    if (!threat) {
      this.threatSince = null;
      this.defenders.clear();
      return;
    }
    this.threatSince ??= now;
    if (now - this.threatSince < p.defendDelayMs) return;
    const threatValue = threat.seen.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0), 0);
    // a strong attack on the base calls the wave home (if it's careful enough to notice)
    if (this.wave && p.abortLoss < 1 && threatValue > this.value(units.filter((u) => !this.busy(u)))) {
      for (const id of this.wave.units) this.defenders.add(id);
      this.endWave(now + 30_000);
    }
    const free = units.filter((u) => !this.busy(u) || this.defenders.has(u.id)).sort((a, b) => dist(a, threat.at) - dist(b, threat.at));
    const n = Math.ceil(free.length * p.defendShare);
    for (const u of free.slice(0, n)) this.defenders.add(u.id);
    const group = units.filter((u) => this.defenders.has(u.id));
    this.engage(group, threat.at, threat.seen);
  }

  /** Fight around a point: focus on one target if it's that careful, otherwise go there and let them pick. */
  private engage(group: UnitView[], at: GridPoint, seen: Sighting[]): void {
    if (!group.length) return;
    const w = this.world;
    const visible = w.view!.units.filter((u) => u.team !== this.team && seen.some((s) => s.id === u.id));
    if (visible.length && this.rng.chance(this.profile.focusFire)) {
      // the weakest of the most dangerous: least health left per credit it's worth
      const target = visible.reduce((a, b) => (b.hp / ((UNITS[b.type]?.cost ?? 1) + 1) < a.hp / ((UNITS[a.type]?.cost ?? 1) + 1) ? b : a));
      const near = group.filter((u) => dist(u, target) < rangeOf(u.type) + 6);
      const ids = near.filter((u) => this.fresh(u.id, target, 2500, 0.5)).map((u) => u.id);
      if (ids.length) this.order({ c: 'attack', units: ids, target: target.id });
      const rest = group.filter((u) => !near.includes(u));
      if (rest.length) this.moveGroup(rest, at, false, true);
      return;
    }
    this.moveGroup(group.filter((u) => !u.moving), at, false, true);
  }

  private value(units: UnitView[]): number {
    return units.reduce((n, u) => n + (UNITS[u.type]?.cost ?? 0) * (u.hp / u.maxHp), 0);
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
    const fresh = w.timeMs - this.sawArmyMs < 60_000;
    return (fresh ? army : Math.max(army, own)) + defences;
  }

  /** Note when it last saw a good part of the enemy's army at once (a third of its own, or more). */
  private lookAtEnemyArmy(own: number): void {
    const w = this.world;
    const inSight = w.view!.units.filter((u) => u.team !== this.team && (UNITS[u.type]?.weapons.length ?? 0) > 0);
    const value = inSight.reduce((n, u) => n + (UNITS[u.type]?.cost ?? 0), 0);
    // a good part of its army in sight, or a look at its base (whatever defends it is in sight too)
    if (value >= own / 3 || w.enemyBuildings.some((b) => w.fogAt(b.tx, b.ty) === 2)) this.sawArmyMs = w.timeMs;
  }

  private endWave(next: number): void {
    this.wave = null;
    this.nextWaveMs = next;
  }

  /** Waves: gather, go when it's time and the force is big enough, push from building to building, pull back if beaten. */
  private attack(units: UnitView[]): void {
    const p = this.profile;
    const w = this.world;
    const now = w.timeMs;
    const interval = ECONOMY.aiAttackIntervalMinutes * 60_000 * p.attackTimeShift;
    if (!this.wave) {
      if (now < this.nextWaveMs) return;
      const pool = units.filter((u) => !this.busy(u));
      const value = this.value(pool);
      // the longer it has waited, the less it asks for (so it never just sits there)
      const relax = Math.max(0.6, 1 - this.waveWaits * 0.04);
      const enough = value >= p.minWaveValue * Math.max(0.4, 1 - this.waveWaits * 0.15) && (!p.attackAdvantage || value >= p.attackAdvantage * relax * this.enemyStrength(value));
      // all in: an army at the cap, or no money and no income left to build a bigger one
      const forced = value >= p.forceAttackValue || w.own.units.length >= w.view!.unitCap - 3 || (this.broke() && value > 0);
      if (!enough && !forced) {
        // not ready: look again in a while, a little less demanding each time (so it never just sits there)
        this.waveWaits++;
        this.nextWaveMs = now + 20_000;
        return;
      }
      this.waveWaits = 0;
      this.wave = { units: new Set(pool.map((u) => u.id)), target: null, explore: null, closest: { d: Infinity, ms: now }, launchedValue: value };
      this.report.waves++;
      this.report.firstAttackMs ??= now;
    }
    const wave = this.wave;
    // reinforcements: what has gathered since joins it, once it's worth sending
    const fresh = units.filter((u) => !this.busy(u));
    if (fresh.length && (this.value(fresh) >= p.minWaveValue / 2 || w.own.units.length >= w.view!.unitCap - 3)) for (const u of fresh) wave.units.add(u.id);
    const group = units.filter((u) => wave.units.has(u.id));
    for (const id of wave.units) if (!group.some((u) => u.id === id)) wave.units.delete(id);
    if (!group.length) return this.endWave(now + interval);
    const value = this.value(group);
    const centre = { gx: group.reduce((n, u) => n + u.gx, 0) / group.length, gy: group.reduce((n, u) => n + u.gy, 0) / group.length };
    const nearby = w.sightings().filter((s) => now - s.atMs < RECENT_MS && dist(s, centre) < 10);
    const local = nearby.reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0) * (s.hp / s.maxHp), 0)
      + w.enemyBuildings.filter((b) => (BUILDINGS[b.type]?.weapons.length ?? 0) > 0 && dist(centreOf(b), centre) < 10).reduce((n, b) => n + BUILDINGS[b.type].cost, 0);
    if (value < wave.launchedValue * (1 - p.abortLoss) && local > value) {
      this.moveGroup(group, this.rally, true);
      return this.endWave(now + interval / 2);
    }
    // what to go for: the nearest enemy building we know of, else somewhere we haven't looked
    let target = wave.target !== null ? w.enemyBuildings.find((b) => b.id === wave.target) : undefined;
    if (!target) {
      target = w.enemyBuildings.length ? w.enemyBuildings.reduce((a, b) => (dist(centreOf(b), centre) < dist(centreOf(a), centre) ? b : a)) : undefined;
      wave.target = target?.id ?? null;
    }
    if (!target && wave.explore) {
      // a place it can't get any nearer to (blocked off, or across the trees) is given up for another
      const d = dist(centre, wave.explore);
      if (d < wave.closest.d - 1) wave.closest = { d, ms: now };
      else if (now - wave.closest.ms > 25_000) {
        this.unreachable.add(w.key(Math.floor(wave.explore.gx), Math.floor(wave.explore.gy)));
        wave.explore = null;
      }
    }
    if (!target && (!wave.explore || w.fogAt(Math.floor(wave.explore.gx), Math.floor(wave.explore.gy)) === 2)) {
      wave.explore = this.unexplored(centre);
      wave.closest = { d: Infinity, ms: now };
    }
    if (!target && !wave.explore) {
      this.moveGroup(group, this.rally);
      return this.endWave(now + interval);
    }
    // enemy units in the way: fight them
    const fighting = nearby.filter((s) => w.view!.units.some((u) => u.id === s.id));
    if (fighting.length) return this.engage(group, centre, fighting);
    const goal = target ? centreOf(target) : wave.explore!;
    const idle = group.filter((u) => !u.moving && !(now - (w.lastShot.get(u.id) ?? -1e9) < 3000));
    if (target) {
      const close = idle.filter((u) => dist(u, goal) < rangeOf(u.type) + target!.size);
      if (close.length) this.order({ c: 'attack', units: close.map((u) => u.id), target: target.id });
      this.moveGroup(idle.filter((u) => !close.includes(u)), goal, false, true);
    } else this.moveGroup(idle, goal, false, true);
  }

  /** The unexplored spot to look at next: the nearest to `from`, or (first time out) the farthest from home. */
  private unexplored(from: GridPoint, farthest = false): GridPoint | null {
    const w = this.world;
    let best: GridPoint | null = null;
    let bestS = Infinity;
    for (let tx = 3; tx < w.width; tx += 6) {
      for (let ty = 3; ty < w.height; ty += 6) {
        if (w.fogAt(tx, ty) !== 0 || w.isBlocked(tx, ty) || this.unreachable.has(w.key(tx, ty))) continue;
        const c = { gx: tx + 0.5, gy: ty + 0.5 };
        const s = farthest ? -dist(c, this.home) : dist(c, from);
        if (s < bestS) {
          bestS = s;
          best = c;
        }
      }
    }
    return best;
  }

  private scouting(units: UnitView[]): void {
    const p = this.profile;
    const w = this.world;
    const now = w.timeMs;
    if (!this.scout) {
      if (now < this.nextScoutMs) return;
      const free = units.filter((u) => !this.busy(u)).sort((a, b) => UNITS[b.type].speed - UNITS[a.type].speed || UNITS[a.type].cost - UNITS[b.type].cost);
      if (!free.length) return;
      this.scout = { id: free[0].id, target: null, legs: 0 };
    }
    const s = this.scout;
    const u = units.find((x) => x.id === s.id)!;
    const sent = this.lastOrder.get(u.id);
    const stuck = !u.moving && !!sent && now - sent.ms > 15_000;
    if (stuck && s.target) this.unreachable.add(w.key(Math.floor(s.target.gx), Math.floor(s.target.gy)));
    if (!s.target || w.fogAt(Math.floor(s.target.gx), Math.floor(s.target.gy)) === 2 || stuck) {
      s.legs++;
      // first a look at the enemy base (the one it knows of: what defends it now? else where it guesses it is), then
      // places it hasn't seen
      const base = s.legs === 1 && w.enemyBuildings.length ? this.nearest(w.enemyBuildings, u) : undefined;
      const guess = s.legs === 1 && !base ? this.enemyGuess() : null;
      const unseen = guess && w.fogAt(Math.floor(guess.gx), Math.floor(guess.gy)) === 0;
      s.target = s.legs > 4 ? null : base ? this.open(centreOf(base)) : unseen ? this.open(guess) : this.unexplored(u, s.legs === 1);
      if (!s.target) {
        this.scout = null;
        this.nextScoutMs = now + p.scoutEveryMs;
        return;
      }
      this.moveGroup([u], s.target, true);
    } else if (!u.moving) this.moveGroup([u], s.target);
  }

  /** Whether `id` wasn't already sent near `to` in the last `ms` (so orders aren't repeated every think). */
  private fresh(id: number, to: GridPoint, ms: number, slack = 2): boolean {
    const o = this.lastOrder.get(id);
    const now = this.world.timeMs;
    if (o && now - o.ms < ms && Math.hypot(o.gx - to.gx, o.gy - to.gy) < slack) return false;
    this.lastOrder.set(id, { gx: to.gx, gy: to.gy, ms: now });
    return true;
  }

  /**
   * Send units to a point (the server spreads a group sent to one point into formation). With `fight`, an attack-move:
   * they fight whatever they meet on the way, then carry on.
   */
  private moveGroup(group: UnitView[], to: GridPoint, force = false, fight = false): void {
    const send = group.filter((u) => (force ? this.fresh(u.id, to, 0) : this.fresh(u.id, to, 6000)));
    if (!send.length) return;
    const at = this.open(to);
    this.order({ c: fight ? 'attackMove' : 'move', orders: send.map((u) => ({ id: u.id, gx: at.gx, gy: at.gy })) });
  }

  private nearest<T extends { tx: number; ty: number; size: number }>(list: T[], at: GridPoint): T | undefined {
    return list.reduce<T | undefined>((a, b) => (!a || dist(centreOf(b), at) < dist(centreOf(a), at) ? b : a), undefined);
  }
}
