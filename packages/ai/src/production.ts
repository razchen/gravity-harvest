// The computer's production queue: harvesters when the economy needs them, an Assembler for an expansion, and the
// army's mix (the army first when the base is under attack or far behind).
import { UNITS } from '@gravity-harvest/rules';
import { Manager, type Brain } from './brain.js';
import type { Economy } from './economy.js';
import { ENGINE_IDS } from './tech.js';

/** An extra harvester must earn its price back within this many minutes (from what each one earns now). */
const HARVESTER_PAYBACK_MIN = 3;
/** Its army is far behind when it's worth less than this share of the enemy army it saw in the last minute... */
const BEHIND_SHARE = 0.5;
/** ...and that army was worth at least this (credits): a couple of scouts don't count. */
const BEHIND_MIN_ENEMY = 1500;

export class Production extends Manager {
  constructor(ai: Brain, private readonly economy: Economy) {
    super(ai);
  }

  produce(): void {
    const ai = this.ai;
    const p = this.profile;
    const t = this.tech;
    const e = this.state.economy;
    const v = this.world.view!;
    const built = ai.builtTypes();
    const options = t.combat.filter((id) => t.can(id, built));
    // under attack or far behind, the army comes first: a harvester would hold the vehicle queue for over a minute, so
    // one that hasn't got far is taken out of it (with none at all, it trains one when it can't pay for any army)
    const affordable = options.some((id) => UNITS[id].cost <= ai.credits());
    const armyFirst = affordable && this.inDanger() && this.rng.chance(p.armyFirst);
    if (armyFirst && v.queue.some((q) => q.unit === ENGINE_IDS.harvester && q.progress < 0.6) && !ai.pendingOf('cancelTrain').length) {
      ai.order({ c: 'cancelTrain', unit: ENGINE_IDS.harvester });
    }
    const queued = [...v.queue.map((q) => q.unit), ...ai.pendingOf('train').map((c) => c.unit)];
    if (queued.length >= p.queueDepth) return;
    if (this.world.own.units.length + queued.length >= v.unitCap - 1) return;
    const credits = ai.credits();
    const train = (unit: string) => ai.order({ c: 'train', unit, near: this.state.rally });
    // harvesters: the ones it lost back once it's safe, and one more when the economy needs it (see `moreHarvesters`)
    const harvesters = this.world.own.units.filter((u) => u.type === ENGINE_IDS.harvester).length + queued.filter((u) => u === ENGINE_IDS.harvester).length;
    const ore = this.world.fields.reduce((n, f) => n + this.world.fieldRocks(f), 0);
    const wantH = Math.min(ai.refineries(true).length * p.harvestersPerRefinery, Math.ceil(ore / 25));
    if (!armyFirst && harvesters < wantH && t.can(ENGINE_IDS.harvester, built) && (harvesters < e.harvesterGoal || this.moreHarvesters(harvesters, options))) {
      if (credits >= UNITS[ENGINE_IDS.harvester].cost) {
        e.harvesterGoal = Math.max(e.harvesterGoal, harvesters + 1);
        return train(ENGINE_IDS.harvester);
      }
      if (ai.hasIncome()) return; // saving up for it; with nothing coming in it would wait for ever
    }
    // an Assembler for an expansion
    if (e.expansion && e.expansion.unit === null && !queued.includes(ENGINE_IDS.assembler) && t.can(ENGINE_IDS.assembler, built)) {
      if (credits >= UNITS[ENGINE_IDS.assembler].cost) train(ENGINE_IDS.assembler);
      return;
    }
    // the army: a mix weighted by what each unit is worth against what it has seen of the enemy
    const mix = ai.enemyMix();
    if (!options.length) return;
    const weights = new Map(options.map((id) => [id, Math.pow(t.value(id, mix), p.mixSharpness)]));
    const unit = this.rng.weighted(options, (id) => weights.get(id)!)!;
    // it keeps money back for the building it's saving for, unless no more is coming in (then the army comes first)
    if (credits >= UNITS[unit].cost + (ai.hasIncome() ? this.state.base.savingFor * p.buildingReserve : 0)) train(unit);
  }

  /**
   * Whether one more harvester is worth holding the queue for: the ore it knows of can keep another busy (the caller
   * checks), each harvester earns its price back within HARVESTER_PAYBACK_MIN minutes, and at full production its
   * money would run out within the profile's look-ahead. Cash flow, not cash in hand: a side that has just bought a
   * factory but earns more than it can spend doesn't need one.
   */
  private moreHarvesters(harvesters: number, options: string[]): boolean {
    if (harvesters === 0) return true;
    const income = this.economy.incomePerMin();
    if (income === null) return false;
    const perHarvester = income / harvesters;
    if (perHarvester * HARVESTER_PAYBACK_MIN < UNITS[ENGINE_IDS.harvester].cost) return false;
    // what one production queue can spend a minute on the army (build times follow costs, so this is about the same for all)
    const spend = Math.max(0, ...options.map((id) => (UNITS[id].cost / UNITS[id].buildTimeSec) * 60));
    const short = spend - income;
    return short > 0 && this.ai.credits() / short < this.profile.economyLookaheadMin;
  }

  /** A threat near its base, or its army far behind the enemy army it saw in the last minute. */
  private inDanger(): boolean {
    if (this.ai.threats()) return true;
    const w = this.world;
    const enemy = w.sightings().filter((s) => (UNITS[s.type]?.weapons.length ?? 0) > 0 && w.timeMs - s.atMs < 60_000)
      .reduce((n, s) => n + (UNITS[s.type]?.cost ?? 0) * (s.hp / s.maxHp), 0);
    const own = this.ai.value(this.ai.combatUnits());
    return enemy >= BEHIND_MIN_ENEMY && own < enemy * BEHIND_SHARE;
  }
}
