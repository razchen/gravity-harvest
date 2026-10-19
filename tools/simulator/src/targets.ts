// What a good match looks like: the numbers the simulator's verdicts compare against. Edit freely; nothing else
// depends on them. Times are in game minutes unless the name says otherwise.

export const TARGETS = {
  time: {
    /** A typical match lasts this long (median). */
    matchMin: 15,
    matchMax: 30,
    /** A match over sooner than this is an outlier (a rush, or a broken start). */
    tooShortMin: 8,
    /** Spread (interquartile range) wider than this is flagged. */
    maxSpreadMin: 15,
    /** First harvester unload, first contact, first attack wave, first building lost: medians later than these are slow. */
    firstUnloadMax: 1.5,
    firstContactMax: 8,
    firstAttackMin: 3,
    firstAttackMax: 10,
    firstBuildingLostMax: 15,
  },
  fair: {
    /** Win rates of a faction (same difficulty) or a start position outside this band are flagged. */
    winRateLow: 0.45,
    winRateHigh: 0.55,
    /** Income in the first 5 minutes: the poorer side should earn at least this share of the richer one's. */
    incomeParity: 0.85,
  },
  fun: {
    // Lead changes, comebacks and lock-in are measured over same-difficulty matches only, on who is ahead in army
    // plus defences (match.ts, `LEAD_SHARE`), from the first real fight on.
    /** At least this many lead changes per match on average. */
    leadChangesMin: 1,
    /** Comebacks (behind just after the first big fight, still won): at least this share of decided matches. */
    comebacksMin: 0.15,
    /** The winner's lead becoming permanent before this share of the match is a snowball. */
    snowballBefore: 0.35,
    /** Distinct engagements per match, and the share of match time with fighting going on. */
    engagementsMin: 4,
    fightingShareMin: 0.15,
    /** A stretch with no shots fired for longer than this (after the first contact) is dead time. */
    deadTimeMin: 3,
    /** One unit type dealing more than this share of all damage is a dominant strategy. */
    dominantShare: 0.6,
    /** Timeouts (no winner by --max-minutes) above this share are stalemates. */
    stalemateMax: 0.1,
    /** Distinct opening build orders (first 6 buildings) per match: below this share they all play the same. */
    buildOrderVarietyMin: 0.3,
  },
  progress: {
    /** Share of a side's roster never built in any match above this is flagged (unreachable, too dear, or useless). */
    neverBuiltMax: 0.3,
  },
  buildSpeed: {
    /** The top tech tier reached before this is too fast. */
    topTierBeforeMin: 10,
    /** An army worth more than this (credits) before the first wave could reasonably come (aiFirstAttackMinutes). */
    armyBeforeFirstAttack: 12_000,
    /** Credits in hand above this count as money piling up (production is the limit). */
    pileCredits: 5000,
    /** Flagged when a side spends more than this share of the match in one limit (money piling, or idle for money). */
    limitShareMax: 0.5,
    /** Things arriving this many times slower than the rules' build time (low power, a stalled queue) are flagged. */
    arrivalSlowdownMax: 1.6,
  },
  ore: {
    /** Ore left at the end above this share of the start: effectively unlimited. */
    unlimitedShare: 0.8,
    /** The home field running dry before this is too soon; income below this per minute with no ore left is a stall. */
    homeDryBeforeMin: 6,
    stallIncomePerMin: 300,
    /** One start position's income (first 10 minutes) more than this share above the other's is an ore advantage. */
    startAdvantage: 0.1,
  },
  map: {
    /** Unit-samples stuck (on a move order, not moving, 30 s or more) per match above this. */
    stuckMax: 10,
    /** Orders the server refused (placement, training) per match above this. */
    failedOrdersMax: 15,
    /** A side winning less than this share of its matches is one-sided (across difficulties and slots). */
    oneSidedMin: 0.1,
    /** A map's median first contact more than this many times the others' is too big or its bases too far apart. */
    contactRatioMax: 1.75,
  },
} as const;
