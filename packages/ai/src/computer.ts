// The computer opponent. It plays one side from that side's view only (what a player on that side is sent) and
// acts only by giving the orders a player gives. Each think it looks after its economy, its buildings, its
// production and its army; its difficulty profile decides how often it thinks, how slowly its orders go out and
// how many mistakes it makes on the way. Deterministic: the same views and seed give the same orders.
//
// This class only runs the parts in order; each part is a manager of its own (economy.ts, base.ts, production.ts,
// army.ts, scouting.ts) sharing one Brain (brain.ts) and one plain state (state.ts).
import type { Command, Difficulty, MatchHello, TeamId, TeamView } from '@gravity-harvest/shared';
import { Army } from './army.js';
import { Base } from './base.js';
import { Brain } from './brain.js';
import { Economy } from './economy.js';
import { Production } from './production.js';
import { PROFILES, type AiProfile } from './profiles.js';
import { Scouting } from './scouting.js';
import type { AiReport, AiState } from './state.js';

export type { AiReport, AiState } from './state.js';

export interface ComputerOptions {
  /** The hello this side was sent (map, ore, scenery, its catalog and faction). */
  hello: MatchHello;
  difficulty: Difficulty;
  seed: number;
  /** Tweaks on top of the difficulty's profile (tuning and tests). */
  profile?: Partial<AiProfile>;
}

/**
 * Feed the computer a view of its side every this many sim ticks (500 ms): how soon it can see things and give
 * orders, the same in matches and simulations (its profile's think rate and reaction time come on top).
 */
export const AI_VIEW_EVERY_TICKS = 10;

export class ComputerPlayer {
  readonly team: TeamId;
  readonly difficulty: Difficulty;
  readonly profile: AiProfile;
  private readonly ai: Brain;
  private readonly economy: Economy;
  private readonly base: Base;
  private readonly production: Production;
  private readonly army: Army;
  private readonly scouting: Scouting;

  constructor(opts: ComputerOptions) {
    this.team = opts.hello.you;
    this.difficulty = opts.difficulty;
    this.profile = { ...PROFILES[opts.difficulty], ...opts.profile };
    this.ai = new Brain(opts.hello, this.profile, opts.seed);
    this.economy = new Economy(this.ai);
    this.base = new Base(this.ai);
    this.production = new Production(this.ai, this.economy);
    this.army = new Army(this.ai);
    this.scouting = new Scouting(this.ai);
  }

  /**
   * A player that carries on from a `getState()`, giving the same orders the saved one would have from then on. The
   * options must be the ones it was made with (its seed doesn't matter: the random generator's state is in `state`).
   */
  static fromState(opts: ComputerOptions, state: AiState): ComputerPlayer {
    const p = new ComputerPlayer(opts);
    p.ai.load(state);
    return p;
  }

  /** What it did, for the simulator's reports. */
  get report(): AiReport {
    return this.ai.state.report;
  }

  /** Everything it remembers, as plain JSON-safe data (a copy), for `fromState`. */
  getState(): AiState {
    return this.ai.save();
  }

  /**
   * Take in a view of this side (feed it every view fetched, in order) and return the orders to give now. It only
   * decides every `thinkMs`; in between it just lets out the orders whose reaction delay is over.
   */
  update(view: TeamView): Command[] {
    const ai = this.ai;
    ai.world.observe(view);
    if (view.timeMs >= ai.state.orders.nextThinkMs && !view.paused) {
      ai.state.orders.nextThinkMs = view.timeMs + this.profile.thinkMs;
      this.think();
      ai.world.events = [];
    }
    return ai.release(view.timeMs);
  }

  /** Each part in turn, always in this order; any of them may be skipped (a lapse of attention, by its profile). */
  private think(): void {
    const p = this.profile;
    const ai = this.ai;
    const w = ai.world;
    if (!w.own.buildings.length && !w.own.units.length) return;
    ai.locate();
    this.base.noteLosses();
    this.economy.noteIncome();
    if (ai.state.report.foundEnemyMs === null && w.enemyBuildings.length) ai.state.report.foundEnemyMs = w.timeMs;
    const skip = () => ai.rng.chance(p.skipChance);
    if (!skip()) this.economy.harvesters();
    if (!skip() && !ai.rng.chance(p.buildLapse)) this.base.build();
    if (!skip() && ai.rng.chance(p.repairChance)) this.base.repairs();
    if (!skip() && !ai.rng.chance(p.productionLapse)) this.production.produce();
    if (!skip()) this.economy.expand();
    if (!skip()) this.economy.liquidate();
    if (!skip()) {
      const units = ai.combatUnits();
      this.army.muster(units);
      this.scouting.muster(units);
      this.army.fight(units);
      this.scouting.run(units);
      this.army.gather(units);
    }
  }
}
