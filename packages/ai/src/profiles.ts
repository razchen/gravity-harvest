// How well the computer plays. Every level runs the same code with the same rules, view and orders; a profile
// only sets how slow, forgetful and careless it is. Tuned with the simulator (tools/simulator) so Hard beats
// Normal and Normal beats Easy most of the time.
import type { Difficulty } from '@gravity-harvest/shared';

export interface AiProfile {
  // --- Reaction --------------------------------------------------------------------------------------------
  /** How often it looks at the battlefield and decides (ms of game time). */
  thinkMs: number;
  /** Delay between deciding and the order going out (ms, picked between the two each time). */
  reactionMs: [number, number];
  /** Orders a minute it can give at most (one order can move a whole group). */
  apm: number;
  /** Chance, per part of its plan (economy, building, army...) per think, that it doesn't get round to it. */
  skipChance: number;

  // --- Economy -----------------------------------------------------------------------------------------------
  /** Chance per think that it forgets to keep production going. */
  productionLapse: number;
  /** Units it keeps queued (it tops the queue up to this many). */
  queueDepth: number;
  /** Chance per think that it notices an idle harvester. */
  harvesterAttention: number;
  /**
   * Harvesters it wants per refinery at most. It replaces a lost one, but adds one more only when the ore it knows of
   * can keep another busy, each harvester earns its price back within a few minutes, and at full production its money
   * would run out within `economyLookaheadMin` minutes (production, not money, is usually the limit; a harvester holds
   * the vehicle queue for over a minute). A shorter look-ahead sees the shortfall coming later.
   */
  harvestersPerRefinery: number;
  economyLookaheadMin: number;
  /**
   * Chance per think that it puts the army first while a threat is near its base or its army is far behind the
   * enemy's it has seen: no harvesters then (one waiting in the queue is cancelled); lost ones are replaced once safe.
   */
  armyFirst: number;
  /** Refineries it builds at most, and how many minutes apart (after the first) it adds one. */
  maxRefineries: number;
  refineryEveryMin: number;
  /** Power surplus it keeps, as a share of the spreadsheet's `aiDesiredPowerSurplus`. */
  powerSurplusShare: number;
  /** Chance per think that it puts off building the power it needs. */
  powerLapse: number;
  /** After losing a building, how long until it starts rebuilding it (ms). */
  rebuildDelayMs: number;
  /** Repairs a building below this share of its health (0: never); chance per think it notices. */
  repairBelow: number;
  repairChance: number;
  /** Sends an Assembler to unclaimed ore once its own fields run low. */
  expands: boolean;
  /** Out of money and income: sells what it can spare to pay for a last army. */
  liquidates: boolean;

  // --- Building ------------------------------------------------------------------------------------------------
  /** Chance per think it skips its building plan. */
  buildLapse: number;
  /** Chance a building goes on a random free spot instead of a good one. */
  randomPlacement: number;
  /**
   * Defences it builds (it adds them one at a time, from `defenceFromMin` minutes on), and one more for each
   * `extraDefenceEvery` credits it has in hand over that (a defence goes up beside the building under way while units
   * wait their turn in their queues, so spare money is best spent on them), up to `maxDefences`.
   */
  defences: number;
  extraDefenceEvery: number;
  maxDefences: number;
  defenceFromMin: number;
  /** Keeps this much in hand for buildings when choosing whether to train (share of the next building's cost). */
  buildingReserve: number;

  // --- Army ------------------------------------------------------------------------------------------------------
  /** 0..1: how much what it has seen of the enemy steers its unit choice (0: it ignores it). */
  counterPick: number;
  /** How strongly it prefers its best unit (higher: a sharper pick; 0: any armed unit, equally). */
  mixSharpness: number;
  /** First attack and the gap between waves, as multiples of the spreadsheet's `aiFirstAttackMinutes` / `aiAttackIntervalMinutes`. */
  attackTimeShift: number;
  /** Smallest wave it sends (credits' worth of units); a wave leaves anyway once its army is worth `forceAttackValue`. */
  minWaveValue: number;
  forceAttackValue: number;
  /** It waits for this strength over what it has seen of the enemy's army before sending a wave (0: doesn't compare). */
  attackAdvantage: number;
  /** Chance per think its units in a fight all shoot the same target. */
  focusFire: number;
  /** Pulls a unit back below this share of its health (0: never). */
  retreatBelow: number;
  /** Calls a wave back once it has lost this share of its strength and is outmatched (1: never). */
  abortLoss: number;
  /** How long until it reacts to its base being attacked (ms), and the share of its army it sends. */
  defendDelayMs: number;
  defendShare: number;
  /** How often it sends a scout out (ms; 0: never, it finds the enemy with its waves). */
  scoutEveryMs: number;
}

export const PROFILES: Readonly<Record<Difficulty, AiProfile>> = {
  easy: {
    thinkMs: 3000,
    reactionMs: [1500, 4000],
    apm: 25,
    skipChance: 0.25,
    productionLapse: 0.4,
    queueDepth: 1,
    harvesterAttention: 0.3,
    harvestersPerRefinery: 1,
    economyLookaheadMin: 1,
    armyFirst: 0.2,
    maxRefineries: 1,
    refineryEveryMin: 99,
    powerSurplusShare: 0.2,
    powerLapse: 0.5,
    rebuildDelayMs: 90_000,
    repairBelow: 0.35,
    repairChance: 0.15,
    expands: false,
    liquidates: false,
    buildLapse: 0.45,
    randomPlacement: 0.5,
    defences: 1,
    extraDefenceEvery: Infinity,
    maxDefences: 1,
    defenceFromMin: 8,
    buildingReserve: 0,
    counterPick: 0,
    mixSharpness: 0,
    attackTimeShift: 1.4,
    minWaveValue: 600,
    forceAttackValue: 5000,
    attackAdvantage: 0,
    focusFire: 0,
    retreatBelow: 0,
    abortLoss: 1,
    defendDelayMs: 15_000,
    defendShare: 0.4,
    scoutEveryMs: 0,
  },
  normal: {
    thinkMs: 1500,
    reactionMs: [500, 1500],
    apm: 60,
    skipChance: 0.1,
    productionLapse: 0.12,
    queueDepth: 2,
    harvesterAttention: 0.7,
    harvestersPerRefinery: 2,
    economyLookaheadMin: 3,
    armyFirst: 0.7,
    maxRefineries: 2,
    refineryEveryMin: 7,
    powerSurplusShare: 0.6,
    powerLapse: 0.15,
    rebuildDelayMs: 30_000,
    repairBelow: 0.55,
    repairChance: 0.5,
    expands: true,
    liquidates: true,
    buildLapse: 0.12,
    randomPlacement: 0.15,
    defences: 2,
    extraDefenceEvery: 6000,
    maxDefences: 5,
    defenceFromMin: 5,
    buildingReserve: 0.5,
    counterPick: 0.6,
    mixSharpness: 2,
    attackTimeShift: 1.1,
    minWaveValue: 3000,
    forceAttackValue: 12_000,
    attackAdvantage: 0.8,
    focusFire: 0.5,
    retreatBelow: 0.2,
    abortLoss: 0.7,
    defendDelayMs: 5000,
    defendShare: 0.75,
    scoutEveryMs: 120_000,
  },
  hard: {
    thinkMs: 500,
    reactionMs: [150, 400],
    apm: 150,
    skipChance: 0,
    productionLapse: 0,
    queueDepth: 2,
    harvesterAttention: 1,
    harvestersPerRefinery: 2,
    economyLookaheadMin: 5,
    armyFirst: 1,
    maxRefineries: 3,
    refineryEveryMin: 5,
    powerSurplusShare: 1,
    powerLapse: 0,
    rebuildDelayMs: 5000,
    repairBelow: 0.75,
    repairChance: 1,
    expands: true,
    liquidates: true,
    buildLapse: 0,
    randomPlacement: 0,
    defences: 3,
    extraDefenceEvery: 2500,
    maxDefences: 10,
    defenceFromMin: 4,
    buildingReserve: 0.5,
    counterPick: 1,
    mixSharpness: 2.5,
    attackTimeShift: 1,
    minWaveValue: 4500,
    forceAttackValue: 15_000,
    attackAdvantage: 1.05,
    focusFire: 1,
    retreatBelow: 0.3,
    abortLoss: 0.5,
    defendDelayMs: 1000,
    defendShare: 1,
    scoutEveryMs: 60_000,
  },
};
