// What every part of the computer shares: what it knows (the World), what it can build (Tech), its random generator,
// its state (state.ts), the orders on their way out, and the judgements more than one part makes (where the enemy
// is, whether the base is under attack, whether it's broke). The parts (economy, base, production, army, scouting)
// each look after their own section of the state and give orders through `order`.
import { BUILDINGS, UNITS, type Faction } from '@gravity-harvest/rules';
import type { BuildingView, Command, GridPoint, MatchHello, TeamId, UnitView } from '@gravity-harvest/shared';
import type { AiProfile } from './profiles.js';
import { Rng } from './rng.js';
import { startState, type AiState, type LiveState } from './state.js';
import { ENGINE_IDS, Tech, evenMix, isAircraft, type ArmorMix } from './tech.js';
import { World, type OreField, type Sighting } from './world.js';

export const dist = (a: GridPoint, b: GridPoint) => Math.hypot(a.gx - b.gx, a.gy - b.gy);
export const centreOf = (b: { tx: number; ty: number; size: number }): GridPoint => ({ gx: b.tx + b.size / 2, gy: b.ty + b.size / 2 });
export const RECENT_MS = 6000;
/** Enemies this close to our buildings (tiles) are an attack on the base. */
export const BASE_RADIUS = 11;
/** A harvester this close to a gravity vent (tiles) is working it; one of the enemy's seen there this recently counts. */
export const VENT_REACH = 6;

export class Brain {
  readonly team: TeamId;
  readonly world: World;
  readonly tech: Tech;
  readonly rng: Rng;
  state: LiveState;

  constructor(hello: MatchHello, readonly profile: AiProfile, seed: number) {
    this.team = hello.team;
    this.world = new World(hello);
    this.tech = new Tech(hello.catalog, hello.faction as Faction);
    this.rng = new Rng(seed >>> 0 || 1);
    this.state = startState(profile);
  }

  /** Its whole state as plain data (a copy: it doesn't change as it plays on). */
  save(): AiState {
    return JSON.parse(JSON.stringify({ ...this.state, rng: this.rng.state, world: this.world.memory() })) as AiState;
  }

  /** Take back a state from `save` (made by a player for the same side of the same match). */
  load(saved: AiState): void {
    const { rng, world, ...live } = JSON.parse(JSON.stringify(saved)) as AiState;
    this.rng.state = rng;
    this.world.remember(world);
    this.state = live;
  }

  // --- Orders: delayed by reaction time, limited by actions per minute ------------------------------------------

  order(cmd: Command): void {
    const [a, b] = this.profile.reactionMs;
    this.state.orders.pending.push({ due: this.world.timeMs + this.rng.range(a, b), cmd });
  }

  /** The orders whose reaction delay is over, as many as its actions per minute allow. */
  release(now: number): Command[] {
    const p = this.profile;
    const o = this.state.orders;
    o.tokens = Math.min(Math.max(3, p.apm / 10), o.tokens + ((now - o.tokenMs) / 60_000) * p.apm);
    o.tokenMs = now;
    const out: Command[] = [];
    const keep: AiState['orders']['pending'] = [];
    for (const x of o.pending) {
      if (x.due <= now && o.tokens >= 1) {
        o.tokens -= 1;
        out.push(x.cmd);
      } else keep.push(x);
    }
    o.pending = keep;
    this.state.report.orders += out.length;
    return out;
  }

  /** Orders decided but not given yet: production and buildings already asked for count as on their way. */
  pendingOf<C extends Command['c']>(c: C): Extract<Command, { c: C }>[] {
    return this.state.orders.pending.map((p) => p.cmd).filter((x): x is Extract<Command, { c: C }> => x.c === c);
  }

  /** Whether `id` wasn't already sent near `to` in the last `ms` (so orders aren't repeated every think). */
  fresh(id: number, to: GridPoint, ms: number, slack = 2): boolean {
    const last = this.state.orders.lastSent;
    const o = last[id];
    const now = this.world.timeMs;
    if (o && now - o.ms < ms && Math.hypot(o.gx - to.gx, o.gy - to.gy) < slack) return false;
    last[id] = { gx: to.gx, gy: to.gy, ms: now };
    return true;
  }

  /**
   * Send units to a point (the server spreads a group sent to one point into formation). With `fight`, an attack-move:
   * they fight whatever they meet on the way, then carry on.
   */
  moveGroup(group: UnitView[], to: GridPoint, force = false, fight = false): void {
    const send = group.filter((u) => (force ? this.fresh(u.id, to, 0) : this.fresh(u.id, to, 6000)));
    if (!send.length) return;
    const at = this.open(to);
    this.order({ c: fight ? 'attackMove' : 'move', orders: send.map((u) => ({ id: u.id, gx: at.gx, gy: at.gy })) });
  }

  // --- Where things are -------------------------------------------------------------------------------------------

  /** Where home is (the middle of our buildings) and where the army gathers (out in front, towards the enemy). */
  locate(): void {
    const s = this.state;
    const own = this.world.own.buildings;
    if (own.length) {
      s.home = {
        gx: own.reduce((n, b) => n + b.tx + b.size / 2, 0) / own.length,
        gy: own.reduce((n, b) => n + b.ty + b.size / 2, 0) / own.length,
      };
    } else if (this.world.own.units.length) s.home = { gx: this.world.own.units[0].gx, gy: this.world.own.units[0].gy };
    const to = this.enemyGuess();
    const d = dist(s.home, to) || 1;
    const out = Math.min(9, d / 3);
    s.rally = this.open({ gx: s.home.gx + ((to.gx - s.home.gx) / d) * out, gy: s.home.gy + ((to.gy - s.home.gy) / d) * out });
  }

  /**
   * Where the enemy is: its buildings we know of, else by the ore field farthest from us (every base starts by a field
   * of its own, and the map's ore is in plain sight from the start, as for a player), else the middle of the map.
   */
  enemyGuess(): GridPoint {
    const w = this.world;
    const home = this.state.home;
    const eb = w.enemyBuildings;
    if (eb.length) return { gx: eb.reduce((n, b) => n + b.tx + b.size / 2, 0) / eb.length, gy: eb.reduce((n, b) => n + b.ty + b.size / 2, 0) / eb.length };
    const field = w.fields.filter((f) => !w.vents.some((v) => dist(v, f) < VENT_REACH))
      .reduce<OreField | undefined>((a, f) => (!a || dist(f, home) > dist(a, home) ? f : a), undefined);
    return field && dist(field, home) > BASE_RADIUS ? { gx: field.gx, gy: field.gy } : { gx: w.width / 2, gy: w.height / 2 };
  }

  /** The nearest open tile's middle to a point. */
  open(at: GridPoint): GridPoint {
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

  nearest<T extends { tx: number; ty: number; size: number }>(list: T[], at: GridPoint): T | undefined {
    return list.reduce<T | undefined>((a, b) => (!a || dist(centreOf(b), at) < dist(centreOf(a), at) ? b : a), undefined);
  }

  /** The unexplored spot to look at next: the nearest to `from`, or (first time out) the farthest from home. */
  unexplored(from: GridPoint, farthest = false): GridPoint | null {
    const w = this.world;
    const unreachable = this.state.scouting.unreachable;
    let best: GridPoint | null = null;
    let bestS = Infinity;
    for (let tx = 3; tx < w.width; tx += 6) {
      for (let ty = 3; ty < w.height; ty += 6) {
        if (w.fogAt(tx, ty) !== 0 || w.isBlocked(tx, ty) || unreachable.includes(w.key(tx, ty))) continue;
        const c = { gx: tx + 0.5, gy: ty + 0.5 };
        const s = farthest ? -dist(c, this.state.home) : dist(c, from);
        if (s < bestS) {
          bestS = s;
          best = c;
        }
      }
    }
    return best;
  }

  // --- What it has -------------------------------------------------------------------------------------------------

  /** Credits in hand, less what the orders on their way will spend. */
  credits(): number {
    const queued = this.pendingOf('train').reduce((n, c) => n + UNITS[c.unit].cost, 0) + this.pendingOf('place').reduce((n, c) => n + BUILDINGS[c.building].cost, 0);
    return this.world.view!.credits - queued;
  }

  refineries(builtOnly: boolean): BuildingView[] {
    return this.world.own.buildings.filter((b) => b.type === ENGINE_IDS.refinery && (!builtOnly || b.built));
  }

  builtTypes(): string[] {
    return this.world.own.buildings.filter((b) => b.built).map((b) => b.type);
  }

  /** Its units that fight. */
  combatUnits(): UnitView[] {
    return this.world.own.units.filter((u) => this.tech.combat.includes(u.type));
  }

  /** A harvester at work and ore left for it. */
  hasIncome(): boolean {
    const w = this.world;
    return w.own.units.some((u) => u.type === ENGINE_IDS.harvester) && w.fields.some((f) => w.fieldRocks(f) > 3);
  }

  /** No money for even its cheapest unit, and no harvester bringing more in. */
  broke(): boolean {
    const cheapest = Math.min(...this.tech.combat.map((id) => UNITS[id].cost));
    return this.credits() < cheapest && !this.hasIncome() && !this.world.view!.queue.length;
  }

  value(units: UnitView[]): number {
    return units.reduce((n, u) => n + (UNITS[u.type]?.cost ?? 0) * (u.hp / u.maxHp), 0);
  }

  /** A unit with a job already: defending, pulling back, scouting or in a wave. */
  busy(u: UnitView): boolean {
    const a = this.state.army;
    return a.defenders.includes(u.id) || a.retreating.includes(u.id) || this.state.scouting.scout?.id === u.id || !!a.wave?.units.includes(u.id);
  }

  // --- What it knows of the enemy ----------------------------------------------------------------------------------

  /** What the enemy's army is made of (what it has seen of it), blended with an even guess by how much it counter-picks. */
  enemyMix(): ArmorMix {
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

  /** Enemies near the base (seen, or shooting at it from out of sight). */
  threats(): { at: GridPoint; seen: Sighting[] } | null {
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
}

/** One part of the computer: it reads and changes its section of the shared state, and gives orders through the brain. */
export abstract class Manager {
  constructor(protected readonly ai: Brain) {}

  protected get world(): World {
    return this.ai.world;
  }

  protected get tech(): Tech {
    return this.ai.tech;
  }

  protected get rng(): Rng {
    return this.ai.rng;
  }

  protected get profile(): AiProfile {
    return this.ai.profile;
  }

  protected get state(): LiveState {
    return this.ai.state;
  }
}
