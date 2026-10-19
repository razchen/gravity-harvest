// One headless match: the Sim and a computer player per side, stepped as fast as the CPU allows. The AIs only get
// their views and give orders, as in a real match; this harness also reads the Sim's state directly to measure it.
import { AI_VIEW_EVERY_TICKS, ComputerPlayer, Tech } from '@gravity-harvest/ai';
import { BUILDINGS, ECONOMY, STAGES, UNITS, layerOf, volleyDamage, weapon, weaponFor, type Faction, type Stage } from '@gravity-harvest/rules';
import { TEAMS, opponentOf, type Command, type Difficulty, type MatchEvent, type TeamId } from '@gravity-harvest/shared';
import { ENGINE, SCENARIOS, Sim, TICK_MS, findPath, refineryDock, type Harvester } from '@gravity-harvest/sim';

export interface SideSpec {
  faction: Faction;
  difficulty: Difficulty;
}

export interface MatchSpec {
  scenario: string;
  seed: number;
  maxMinutes: number;
  /** Who plays seat `a` (the top start) and seat `b` (the bottom one). */
  a: SideSpec;
  b: SideSpec;
  /** Which pairing this match belongs to ("A vs B", for the report), and which slot A plays. */
  pairing: string;
  aSlot: TeamId;
}

export type Limit = 'money' | 'power' | 'production' | 'tech' | 'none';
export type Phase = 'early' | 'mid' | 'late';
export const PHASES: readonly Phase[] = ['early', 'mid', 'late'];
const phaseOf = (ms: number): Phase => (ms < 5 * 60_000 ? 'early' : ms < 15 * 60_000 ? 'mid' : 'late');

export interface SideResult extends SideSpec {
  slot: TeamId;
  won: boolean;
  firstUnloadMs: number | null;
  firstAttackMs: number | null;
  foundEnemyMs: number | null;
  /** Its own first building lost. */
  firstBuildingLostMs: number | null;
  /** First unit (or finished building) of each tech tier. */
  firstOfStage: Partial<Record<Stage, number>>;
  topStage: Stage | null;
  topStageMs: number | null;
  unitsBuilt: Record<string, number>;
  unitsLost: Record<string, number>;
  buildingsBuilt: Record<string, number>;
  buildingsLost: Record<string, number>;
  peakBuildings: Record<string, number>;
  /** Damage dealt and kills, by the type that dealt them. */
  damage: Record<string, number>;
  kills: Record<string, number>;
  creditsEarned: number;
  creditsSpent: number;
  income5Min: number;
  income10Min: number;
  /** Credits earned in each minute. */
  incomeByMinute: number[];
  harvestersPeak: number;
  harvestersEnd: number;
  /**
   * Every 30 s: army value and built defences' value (cost × health share), buildings, base value (every building at
   * cost), harvesters, credits in hand.
   */
  timeline: { ms: number; army: number; defences: number; buildings: number; baseValue: number; harvesters: number; credits: number }[];
  unitCapMs: number | null;
  noSpaceMs: number | null;
  /** Samples (every 10 s) by phase and what held the side back. */
  limits: Record<Phase, Record<Limit, number>>;
  /** Ordered (or, for units, reaching the head of the queue) → arrived, against the rules' build time, by type. */
  arrivals: Record<string, { n: number; ms: number; intendedMs: number }>;
  /** Harvester trips from the field to the refinery: [minute, seconds]. */
  trips: [number, number][];
  homeFieldDryMs: number | null;
  /** Orders the server refused (a place or train that didn't take). */
  failedOrders: number;
  failedPlacements: number;
  stuck: number;
  idleHarvesterShare: number;
  buildOrder: string[];
  army: { waves: number };
}

export interface MatchResult extends MatchSpec {
  winner: TeamId | null;
  lengthMs: number;
  realMs: number;
  error?: string;
  sides: Record<TeamId, SideResult>;
  firstContactMs: number | null;
  engagements: number;
  fightingShare: number;
  longestQuietMs: number;
  quietStretches: number;
  /** Times the side ahead (see `fightingValue`) changed, from the first real fight on. */
  leadChanges: number;
  /** The first real fight (`FIRST_FIGHT_LOSS` lost in it): who's ahead isn't judged before it. */
  firstFightMs: number | null;
  /** The end of the first big fight (`BIG_FIGHT_LOSS` lost in it), and who was ahead just after it. */
  bigFightMs: number | null;
  leaderAfterBigFight: TeamId | null;
  /** When the winner's lead became permanent (ms), if it won. */
  lockedInMs: number | null;
  ore: { start: number; end: number; mined: number; regrown: number; timeline: [number, number][]; fieldDryMs: (number | null)[] };
  setup: { blockedStarts: number; reachable: boolean; unreachableFields: number };
}

/** The weapon `from` fires at `to` (as the sim picks it: the first that reaches the target's layer), if it harms. */
const firedWeapon = (from: string, to: string) => {
  const w = weaponFor((UNITS[from] ?? BUILDINGS[from])?.weapons ?? [], layerOf(to));
  return w && weapon(w).damage > 0 ? w : null;
};

/**
 * Who is ahead. A side's fighting value: its army and its defences, each at cost × health share (defences once
 * built). *Why not the whole base, harvesters or money:* production, not money, is the limit (each of a side's production
 * queues turns at most about $1,900 a minute into units), so money in hand and the base's worth barely move with the fights
 * that decide matches, and with them counted the base (about 70% of the old measure) drowned out the armies. A side
 * ahead in fighting value has the army the other can't quickly replace; one with none left is losing however rich.
 * The side ahead must lead by `LEAD_SHARE` of the larger value and at least `LEAD_MIN` (so armies trading down
 * together don't flip it back and forth), and nobody is ahead before the first real fight (build-order noise
 * before then would otherwise set a "lead" that never changes).
 */
const LEAD_SHARE = 0.2;
const LEAD_MIN = 1000;
/** A fight (shots with no 15 s gap) in which at least this much was lost (credits, both sides) is a real one... */
const FIRST_FIGHT_LOSS = 1000;
/** ...and one with this much lost is a big one: who is ahead just after the first decides "comeback". */
export const BIG_FIGHT_LOSS = 3000;
const armorOf = (type: string) => (UNITS[type] ?? BUILDINGS[type]).armor;
const bump = (r: Record<string, number>, k: string, n = 1) => (r[k] = (r[k] ?? 0) + n);
const stageIndex = (s: Stage) => STAGES.indexOf(s);

function emptySide(spec: SideSpec, slot: TeamId): SideResult {
  const limits = () => ({ money: 0, power: 0, production: 0, tech: 0, none: 0 });
  return {
    ...spec, slot, won: false, firstUnloadMs: null, firstAttackMs: null, foundEnemyMs: null, firstBuildingLostMs: null, firstOfStage: {}, topStage: null, topStageMs: null,
    unitsBuilt: {}, unitsLost: {}, buildingsBuilt: {}, buildingsLost: {}, peakBuildings: {}, damage: {}, kills: {}, creditsEarned: 0, creditsSpent: 0,
    income5Min: 0, income10Min: 0, incomeByMinute: [], harvestersPeak: 0, harvestersEnd: 0, timeline: [], unitCapMs: null, noSpaceMs: null,
    limits: { early: limits(), mid: limits(), late: limits() }, arrivals: {}, trips: [], homeFieldDryMs: null, failedOrders: 0, failedPlacements: 0,
    stuck: 0, idleHarvesterShare: 0, buildOrder: [], army: { waves: 0 },
  };
}

/** Resource units left on the map, per field. */
function oreByField(sim: Sim, fields: number): number[] {
  const out = new Array<number>(fields).fill(0);
  for (const t of sim.ore.tiles.values()) for (const r of t.rocks) out[t.field] = (out[t.field] ?? 0) + r.amount;
  return out;
}

/** Can units get from one side's base to the other's, and to every ore field? (checked on the starting map) */
function checkSetup(sim: Sim): MatchResult['setup'] {
  const exitOf = (team: TeamId) => {
    const b = [...sim.buildings.values()].find((x) => x.team === team)!;
    return sim.map.nearestFree(Math.floor(b.tx + b.size / 2), b.ty + b.size);
  };
  const blockedStarts = [...sim.units.values()].filter((u) => sim.map.isBlocked(Math.floor(u.gx), Math.floor(u.gy))).length;
  const reachable = !!findPath(sim.map, exitOf('a'), exitOf('b'), 20_000);
  let unreachableFields = 0;
  const fields = new Map<number, { tx: number; ty: number }>();
  for (const t of sim.ore.tiles.values()) if (!fields.has(t.field) || t.richness > 0.5) fields.set(t.field, t);
  for (const t of fields.values()) {
    const ok = TEAMS.some((team) => {
      const ref = [...sim.buildings.values()].find((b) => b.team === team && b.type === 'refinery');
      const from = ref ? refineryDock(ref.tx, ref.ty).front : null;
      return from && findPath(sim.map, { tx: Math.floor(from.gx), ty: Math.floor(from.gy) }, t, 20_000);
    });
    if (!ok) unreachableFields++;
  }
  return { blockedStarts, reachable, unreachableFields };
}

export function runMatch(spec: MatchSpec): MatchResult {
  const t0 = performance.now();
  const sides = { a: emptySide(spec.a, 'a'), b: emptySide(spec.b, 'b') };
  const result: MatchResult = {
    ...spec, winner: null, lengthMs: 0, realMs: 0, sides, firstContactMs: null, engagements: 0, fightingShare: 0, longestQuietMs: 0, quietStretches: 0,
    leadChanges: 0, firstFightMs: null, bigFightMs: null, leaderAfterBigFight: null, lockedInMs: null, ore: { start: 0, end: 0, mined: 0, regrown: 0, timeline: [], fieldDryMs: [] },
    setup: { blockedStarts: 0, reachable: true, unreachableFields: 0 },
  };
  try {
    play(spec, result);
  } catch (e) {
    result.error = (e as Error).stack ?? String(e);
  }
  result.realMs = performance.now() - t0;
  return result;
}

function play(spec: MatchSpec, result: MatchResult): void {
  const sim = Sim.create(spec.scenario, spec.seed, spec.a.faction, { otherFaction: spec.b.faction, computerOnly: true, difficulty: spec.a.difficulty });
  const sides = result.sides;
  result.setup = checkSetup(sim);
  const ai = {
    a: new ComputerPlayer({ hello: sim.hello('a'), difficulty: spec.a.difficulty, seed: spec.seed * 7919 + 1 }),
    b: new ComputerPlayer({ hello: sim.hello('b'), difficulty: spec.b.difficulty, seed: spec.seed * 7919 + 2 }),
  };
  const tech = { a: new Tech(sim.hello('a').catalog, spec.a.faction), b: new Tech(sim.hello('b').catalog, spec.b.faction) };
  const nFields = SCENARIOS[spec.scenario].oreFields.length;
  const fieldStart = oreByField(sim, nFields);
  result.ore.start = fieldStart.reduce((a, b) => a + b, 0);
  result.ore.fieldDryMs = fieldStart.map(() => null);
  // each side's home field: the one nearest its starting refinery
  const homeField = {} as Record<TeamId, number>;
  for (const t of TEAMS) {
    const ref = [...sim.buildings.values()].find((b) => b.team === t && b.type === 'refinery');
    homeField[t] = ref ? sim.ore.nearestField(ref.tx + 2, ref.ty + 2) : 0;
  }
  const maxMs = spec.maxMinutes * 60_000;
  const fightSec = new Uint8Array(spec.maxMinutes * 60 + 2);
  /** Credits' worth lost (units and buildings, both sides) each second. */
  const lossSec = new Float64Array(spec.maxMinutes * 60 + 2);
  const typeOf = new Map<number, { type: string; team: TeamId }>();
  const lastShooter = new Map<number, string>();
  const trainedAt: Record<TeamId, Map<string, number[]>> = { a: new Map(), b: new Map() };
  const placedAt = new Map<number, number>();
  const lastReady = { a: 0, b: 0 };
  const stuck = new Map<number, { gx: number; gy: number; n: number }>();
  const tripFrom = new Map<number, number>();
  const idleH = { a: 0, b: 0 }, allH = { a: 0, b: 0 };
  let lastEarned = { a: 0, b: 0 };
  let lastOre = result.ore.start;

  const remember = () => {
    for (const u of sim.units.values()) if (!typeOf.has(u.id)) typeOf.set(u.id, { type: u.type, team: u.team });
    for (const b of sim.buildings.values()) if (!typeOf.has(b.id)) typeOf.set(b.id, { type: b.type, team: b.team });
  };
  const reached = (side: SideResult, type: string, ms: number) => {
    const stage = (UNITS[type] ?? BUILDINGS[type])?.stage;
    if (!stage) return;
    side.firstOfStage[stage] ??= ms;
    if (side.topStage === null || stageIndex(stage) > stageIndex(side.topStage)) {
      side.topStage = stage;
      side.topStageMs = ms;
    }
  };
  const arrive = (side: SideResult, type: string, ms: number, intendedMs: number) => {
    const a = (side.arrivals[type] ??= { n: 0, ms: 0, intendedMs });
    a.n++;
    a.ms += ms;
  };
  const events = (team: TeamId, evs: MatchEvent[]) => {
    const side = sides[team];
    const now = sim.timeMs;
    for (const e of evs) {
      switch (e.e) {
        case 'unloaded':
          side.firstUnloadMs ??= now;
          break;
        case 'shot': {
          const from = typeOf.get(e.from);
          const to = typeOf.get(e.to);
          if (!from || from.team !== team || !to) break; // each shot counted once, from its owner's view
          result.firstContactMs ??= now;
          fightSec[Math.min(fightSec.length - 1, Math.floor(now / 1000))] = 1;
          const w = firedWeapon(from.type, to.type);
          if (w) bump(side.damage, from.type, volleyDamage(w, armorOf(to.type)));
          lastShooter.set(e.to, from.type);
          break;
        }
        case 'unitDied': {
          if (typeOf.get(e.id)?.team !== team) break;
          bump(side.unitsLost, e.type);
          lossSec[Math.min(lossSec.length - 1, Math.floor(now / 1000))] += UNITS[e.type]?.cost ?? 0;
          const killer = lastShooter.get(e.id);
          if (killer) bump(sides[opponentOf(team)].kills, killer);
          break;
        }
        case 'buildingDestroyed':
          if (e.team !== team || e.sold) break;
          bump(side.buildingsLost, e.type);
          side.firstBuildingLostMs ??= now;
          lossSec[Math.min(lossSec.length - 1, Math.floor(now / 1000))] += BUILDINGS[e.type]?.cost ?? 0;
          if (lastShooter.get(e.id)) bump(sides[opponentOf(team)].kills, lastShooter.get(e.id)!);
          break;
        case 'unitReady': {
          bump(side.unitsBuilt, e.type);
          reached(side, e.type, now);
          // from when it was ordered or reached the head of the queue (the one before it came out), whichever is later
          const q = trainedAt[team].get(e.type);
          const at = q?.shift();
          if (at !== undefined) arrive(side, e.type, now - Math.max(at, lastReady[team]), UNITS[e.type].buildTimeSec * 1000);
          lastReady[team] = now;
          break;
        }
        case 'buildingDone': {
          const b = sim.buildings.get(e.id);
          if (!b) break;
          bump(side.buildingsBuilt, b.type);
          reached(side, b.type, now);
          const at = placedAt.get(e.id);
          if (at !== undefined) arrive(side, b.type, now - at, BUILDINGS[b.type].buildTimeSec * 1000);
          break;
        }
      }
    }
  };
  const give = (team: TeamId, c: Command) => {
    const side = sides[team];
    const p = sim.players[team];
    if (c.c === 'train') {
      const before = p.queue.length;
      sim.command(team, c);
      if (p.queue.length > before) {
        const q = trainedAt[team].get(c.unit) ?? [];
        q.push(sim.timeMs);
        trainedAt[team].set(c.unit, q);
      } else side.failedOrders++;
      return;
    }
    if (c.c === 'place') {
      const before = sim.buildings.size;
      sim.command(team, c);
      if (sim.buildings.size > before) {
        const b = [...sim.buildings.values()].find((x) => x.tx === c.tx && x.ty === c.ty && x.team === team);
        if (b) placedAt.set(b.id, sim.timeMs);
        if (side.buildOrder.length < 8) side.buildOrder.push(c.building);
      } else side.failedOrders++;
      return;
    }
    sim.command(team, c);
  };

  remember();
  while (!sim.winner && sim.timeMs < maxMs) {
    sim.step();
    if (sim.tick % AI_VIEW_EVERY_TICKS !== 0) continue;
    remember();
    for (const team of TEAMS) {
      const v = sim.view(team);
      events(team, v.events);
      for (const c of ai[team].update(v)) give(team, c);
    }
    // harvester trips: from leaving the field to backing onto the ramp
    for (const u of sim.units.values()) {
      if (u.kind !== 'harvester') continue;
      const h = u as Harvester;
      if ((h.state === 'toDock' || h.state === 'toWait') && !tripFrom.has(h.id) && h.cargo > 0) tripFrom.set(h.id, sim.timeMs);
      else if (h.state === 'docking' && tripFrom.has(h.id)) {
        sides[h.team].trips.push([Math.floor(sim.timeMs / 60_000), (sim.timeMs - tripFrom.get(h.id)!) / 1000]);
        tripFrom.delete(h.id);
      }
    }
    if (sim.tick % ((10_000 / TICK_MS) | 0) === 0) sample10();
  }
  finish();

  /** Every 10 s: what holds each side back, stuck units, idle harvesters, peaks; every 30 s the timelines. */
  function sample10(): void {
    const now = sim.timeMs;
    const phase = phaseOf(now);
    for (const team of TEAMS) {
      const side = sides[team];
      const p = sim.players[team];
      const units = [...sim.units.values()].filter((u) => u.team === team);
      const buildings = [...sim.buildings.values()].filter((b) => b.team === team);
      const owned = buildings.filter((b) => b.built).map((b) => b.type);
      const cheapest = Math.min(...tech[team].combat.map((id) => UNITS[id].cost));
      let limit: Limit = 'none';
      if (sim.powerOf(team).low) limit = 'power';
      else if (!tech[team].combat.some((id) => tech[team].can(id, owned))) limit = 'tech';
      else if (!p.queue.length && p.credits < cheapest) limit = 'money';
      else if (p.queue.length && p.credits > 5000) limit = 'production';
      side.limits[phase][limit]++;
      const harvesters = units.filter((u) => u.kind === 'harvester') as Harvester[];
      allH[team] += harvesters.length;
      idleH[team] += harvesters.filter((h) => h.state === 'idle').length;
      side.harvestersPeak = Math.max(side.harvestersPeak, harvesters.length);
      const counts: Record<string, number> = {};
      for (const b of buildings) bump(counts, b.type);
      for (const [k, n] of Object.entries(counts)) side.peakBuildings[k] = Math.max(side.peakBuildings[k] ?? 0, n);
      if (side.unitCapMs === null && units.length >= ENGINE.unitCap) side.unitCapMs = now;
      for (const u of units) {
        if (u.kind !== 'fighter' || u.mode !== 'move') {
          stuck.delete(u.id);
          continue;
        }
        const s = stuck.get(u.id);
        if (s && Math.hypot(s.gx - u.gx, s.gy - u.gy) < 0.2) {
          if (++s.n === 3) side.stuck++;
        } else stuck.set(u.id, { gx: u.gx, gy: u.gy, n: 0 });
      }
      if (now % 30_000 === 0) {
        const army = units.filter((u) => u.kind === 'fighter').reduce((n, u) => n + UNITS[u.type].cost * (u.hp / u.maxHp), 0);
        const defences = buildings.filter((b) => b.built && BUILDINGS[b.type].weapons.some((w) => weapon(w).damage > 0))
          .reduce((n, b) => n + BUILDINGS[b.type].cost * (b.hp / b.maxHp), 0);
        side.timeline.push({
          ms: now, army: Math.round(army), defences: Math.round(defences), buildings: buildings.length, baseValue: buildings.reduce((n, b) => n + BUILDINGS[b.type].cost, 0),
          harvesters: harvesters.length, credits: Math.floor(p.credits),
        });
      }
      if (now % 60_000 === 0) {
        side.incomeByMinute.push(Math.round(p.stats.creditsEarned - lastEarned[team]));
        lastEarned = { ...lastEarned, [team]: p.stats.creditsEarned };
      }
      if (now === 5 * 60_000) side.income5Min = Math.round(p.stats.creditsEarned);
      if (now === 10 * 60_000) side.income10Min = Math.round(p.stats.creditsEarned);
    }
    if (now % 30_000 === 0) {
      // ore: what's on the map, what was mined since (unloaded, plus what's in the harvesters), what grew back
      const byField = oreByField(sim, nFields);
      const total = byField.reduce((a, b) => a + b, 0);
      const earned = TEAMS.reduce((n, t) => n + sim.players[t].stats.creditsEarned, 0);
      const cargo = [...sim.units.values()].reduce((n, u) => n + (u.kind === 'harvester' ? u.cargo : 0), 0);
      const mined = earned / ECONOMY.commonResourceValue + cargo;
      result.ore.regrown += Math.max(0, total - lastOre + (mined - result.ore.mined));
      result.ore.mined = mined;
      lastOre = total;
      result.ore.timeline.push([now, Math.round(total)]);
      byField.forEach((n, i) => {
        if (result.ore.fieldDryMs[i] === null && n < fieldStart[i] * 0.15) result.ore.fieldDryMs[i] = now;
      });
      for (const t of TEAMS) if (sides[t].homeFieldDryMs === null) sides[t].homeFieldDryMs = result.ore.fieldDryMs[homeField[t]];
    }
  }

  /**
   * Who was ahead and when it changed (see `LEAD_SHARE`), from the timelines, starting at the first real fight; and
   * who was ahead just after the first big one.
   */
  function leads(fights: { start: number; end: number; loss: number }[]): void {
    result.firstFightMs = fights.find((f) => f.loss >= FIRST_FIGHT_LOSS)?.start ?? null;
    result.bigFightMs = fights.find((f) => f.loss >= BIG_FIGHT_LOSS)?.end ?? null;
    if (result.firstFightMs === null) return;
    const P = sides.a.timeline, E = sides.b.timeline;
    let leader: TeamId | null = null;
    let since = 0;
    let judged = false;
    for (let i = 0; i < Math.min(P.length, E.length); i++) {
      if (P[i].ms < result.firstFightMs) continue;
      const a = P[i].army + P[i].defences, b = E[i].army + E[i].defences;
      const lead: TeamId | null = Math.abs(a - b) > Math.max(LEAD_MIN, LEAD_SHARE * Math.max(a, b)) ? (a > b ? 'a' : 'b') : leader;
      if (lead !== leader) {
        if (leader !== null) result.leadChanges++;
        leader = lead;
        since = P[i].ms;
      }
      if (result.bigFightMs !== null && P[i].ms >= result.bigFightMs && !judged) {
        judged = true;
        result.leaderAfterBigFight = leader;
      }
    }
    if (sim.winner && leader === sim.winner) result.lockedInMs = since;
  }

  function finish(): void {
    const now = sim.timeMs;
    result.winner = sim.winner;
    result.lengthMs = now;
    for (const team of TEAMS) {
      const side = sides[team];
      const p = sim.players[team];
      side.won = sim.winner === team;
      side.creditsEarned = Math.round(p.stats.creditsEarned);
      side.creditsSpent = Math.round(startCredits(spec.scenario) + p.stats.creditsEarned - p.credits);
      side.harvestersEnd = [...sim.units.values()].filter((u) => u.team === team && u.kind === 'harvester').length;
      const r = ai[team].report;
      Object.assign(side, { firstAttackMs: r.firstAttackMs, foundEnemyMs: r.foundEnemyMs, noSpaceMs: r.noSpaceMs, failedPlacements: r.failedPlacements, army: { waves: r.waves } });
      side.idleHarvesterShare = allH[team] ? idleH[team] / allH[team] : 0;
      if (now < 5 * 60_000) side.income5Min = Math.round(p.stats.creditsEarned);
      if (now < 10 * 60_000) side.income10Min = Math.round(p.stats.creditsEarned);
    }
    result.ore.end = Math.round(oreByField(sim, nFields).reduce((a, b) => a + b, 0));
    result.ore.mined = Math.round(result.ore.mined);
    result.ore.regrown = Math.round(result.ore.regrown);
    // fighting: seconds with shots, grouped into engagements (a gap of 15 s ends one), with what was lost in each
    const secs = Math.floor(now / 1000);
    let fighting = 0, gap = Infinity, quiet = 0, longest = 0;
    const started = result.firstContactMs === null ? secs : Math.floor(result.firstContactMs / 1000);
    const fights: { start: number; end: number; loss: number }[] = [];
    for (let s = 0; s <= secs && s < fightSec.length; s++) {
      const fight = fights[fights.length - 1];
      if (fight && gap <= 15) fight.loss += lossSec[s];
      if (fightSec[s]) {
        if (gap > 15) {
          result.engagements++;
          fights.push({ start: s * 1000, end: s * 1000, loss: lossSec[s] });
        } else fighting += gap; // a lull inside an engagement is part of it
        fights[fights.length - 1].end = s * 1000;
        gap = 0;
        fighting++;
        if (quiet > 180) result.quietStretches++;
        longest = Math.max(longest, quiet);
        quiet = 0;
      } else {
        gap++;
        if (s >= started) quiet++;
      }
    }
    longest = Math.max(longest, quiet);
    result.longestQuietMs = longest * 1000;
    result.fightingShare = secs ? fighting / secs : 0;
    leads(fights);
  }
}

function startCredits(scenario: string): number {
  const c = SCENARIOS[scenario].players.a.credits;
  return c === 'rules' ? ECONOMY.startingCredits : c;
}
