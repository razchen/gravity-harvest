// Turns simulated matches into answers: verdicts per question (time, fair, fun, progress, build speed, ore) and per
// map, with the tables behind them. Thresholds are in targets.ts.
import { BUILDINGS, STAGES, UNITS, type Stage } from '@gravity-harvest/rules';
import type { TeamId } from '@gravity-harvest/shared';
import { ROSTER, catalogFor } from '@gravity-harvest/sim';
import { BIG_FIGHT_LOSS, PHASES, type Limit, type MatchResult, type SideResult } from './match.js';
import { TARGETS } from './targets.js';

export interface Verdict {
  question: string;
  ok: boolean;
  reasons: string[];
}

export interface MapVerdict {
  scenario: string;
  matches: number;
  ok: boolean;
  reasons: string[];
  medianMin: number;
  firstContactMin: number | null;
  drawRate: number;
}

export interface Report {
  text: string;
  verdicts: Verdict[];
  maps: MapVerdict[];
  summary: Record<string, unknown>;
}

// --- Small statistics -------------------------------------------------------------------------------------------

const MIN = 60_000;
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const i = (xs.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
}
const median = (xs: (number | null | undefined)[]) => quantile(nums(xs), 0.5);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
/** Wilson 95% interval for k wins out of n. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const mins = (ms: number) => (Number.isFinite(ms) ? `${(ms / MIN).toFixed(1)}` : '–');
const spread = (xs: (number | null)[]) => {
  const v = nums(xs);
  return v.length ? `${mins(quantile(v, 0.5))} (${mins(quantile(v, 0.25))}–${mins(quantile(v, 0.75))})` : '–';
};
const money = (x: number) => (Number.isFinite(x) ? `$${Math.round(x).toLocaleString('en-US')}` : '–');

function table(header: string[], rows: (string | number)[][]): string {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const w = header.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [line(cells[0]), w.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

const sideName = (s: SideResult) => `${s.faction}:${s.difficulty}`;
const sidesOf = (rs: MatchResult[]) => rs.flatMap((r) => [r.sides.player, r.sides.enemy].map((s) => ({ r, s, other: r.sides[s.slot === 'player' ? 'enemy' : 'player'] })));
const sum = (recs: Record<string, number>[]) => {
  const out: Record<string, number> = {};
  for (const r of recs) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v;
  return out;
};
const top = (r: Record<string, number>, n = 5) => Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, n);

// --- The report ----------------------------------------------------------------------------------------------------

export function buildReport(results: MatchResult[], opts: { realMs: number; workers: number }): Report {
  const out: string[] = [];
  const ok = results.filter((r) => !r.error);
  const decided = ok.filter((r) => r.winner);
  const gameMs = ok.reduce((n, r) => n + r.lengthMs, 0);
  const cpuMs = ok.reduce((n, r) => n + r.realMs, 0);
  const verdicts: Verdict[] = [];
  const verdict = (question: string, reasons: string[]) => verdicts.push({ question, ok: !reasons.length, reasons });
  const all = sidesOf(ok);

  // --- maps ---
  const maps = mapVerdicts(results);
  out.push('MAPS (worst first)');
  out.push(table(['map', 'matches', 'verdict', 'median min', 'first contact', 'draws', 'reasons'],
    maps.map((m) => [m.scenario, m.matches, m.ok ? 'OK' : 'FLAGGED', m.medianMin.toFixed(1), m.firstContactMin?.toFixed(1) ?? '–', pct(m.drawRate), m.reasons.join('; ') || '–'])));
  out.push('');
  out.push(`SPEED  ${(gameMs / MIN / (cpuMs / 1000)).toFixed(1)} game minutes per CPU second per worker, ${(gameMs / MIN / (opts.realMs / 1000)).toFixed(1)} per real second on ${opts.workers} workers `
    + `(${ok.length} matches, ${(gameMs / MIN).toFixed(0)} game minutes in ${(opts.realMs / 1000).toFixed(1)} s)`);
  if (results.length > ok.length) out.push(`ERRORS  ${results.length - ok.length} matches threw: ${results.find((r) => r.error)!.error!.split('\n')[0]}`);
  out.push('');

  // --- pairings and difficulty ---
  const pairings = [...new Set(ok.map((r) => r.pairing))];
  const pairRows = pairings.map((p) => {
    const rs = ok.filter((r) => r.pairing === p);
    const aWins = rs.filter((r) => r.winner === r.aSlot).length;
    const draws = rs.filter((r) => !r.winner).length;
    const [lo, hi] = wilson(aWins, rs.length - draws);
    return { p, n: rs.length, aWins, bWins: rs.length - draws - aWins, draws, rate: aWins / Math.max(1, rs.length - draws), lo, hi, len: median(rs.map((r) => r.lengthMs)) };
  });
  out.push('PAIRINGS (A vs B; they swap start positions every other match)');
  out.push(table(['pairing', 'n', 'A wins', 'B wins', 'draws', 'A win rate (95% CI)', 'median min'],
    pairRows.map((x) => [x.p, x.n, x.aWins, x.bWins, x.draws, `${pct(x.rate)} (${pct(x.lo)}–${pct(x.hi)})`, mins(x.len)])));
  out.push('');
  const byLevel = new Map<string, { n: number; w: number }>();
  for (const { r, s, other } of all) {
    if (sideName(s) === sideName(other)) continue;
    const k = sideName(s);
    const e = byLevel.get(k) ?? { n: 0, w: 0 };
    e.n++;
    if (r.winner === s.slot) e.w++;
    byLevel.set(k, e);
  }
  out.push('WIN RATE BY FACTION AND DIFFICULTY (non-mirror matches)');
  out.push(table(['side', 'matches', 'wins', 'win rate'], [...byLevel].sort().map(([k, e]) => [k, e.n, e.w, pct(e.w / e.n)])));
  out.push('');

  // difficulty order: in each faction, the higher level should beat the lower most of the time
  const order: string[] = [];
  for (const f of ['ordan', 'sable']) {
    for (const [hi, lo] of [['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy']]) {
      const rs = ok.filter((r) => [r.sides.player, r.sides.enemy].every((s) => s.faction === f) && new Set([r.sides.player.difficulty, r.sides.enemy.difficulty]).size === 2
        && [r.sides.player.difficulty, r.sides.enemy.difficulty].includes(hi as never) && [r.sides.player.difficulty, r.sides.enemy.difficulty].includes(lo as never));
      if (!rs.length) continue;
      const w = rs.filter((r) => r.winner && r.sides[r.winner].difficulty === hi).length;
      const d = rs.filter((r) => !r.winner).length;
      order.push(`${f}: ${hi} beat ${lo} ${w}/${rs.length - d} (${pct(w / Math.max(1, rs.length - d))}), ${d} draws`);
    }
  }
  if (order.length) out.push(`DIFFICULTY ORDER\n  ${order.join('\n  ')}\n`);

  // --- time ---
  const timeReasons: string[] = [];
  const T = TARGETS.time;
  const len = nums(decided.map((r) => r.lengthMs));
  const medLen = quantile(len, 0.5);
  if (medLen < T.matchMin * MIN || medLen > T.matchMax * MIN) timeReasons.push(`median match ${mins(medLen)} min, target ${T.matchMin}–${T.matchMax}`);
  if (quantile(len, 0.75) - quantile(len, 0.25) > T.maxSpreadMin * MIN) timeReasons.push(`match length spread ${mins(quantile(len, 0.75) - quantile(len, 0.25))} min`);
  const short = decided.filter((r) => r.lengthMs < T.tooShortMin * MIN);
  const timeouts = ok.filter((r) => !r.winner);
  if (short.length) timeReasons.push(`${short.length} matches over in under ${T.tooShortMin} min (seeds ${short.slice(0, 5).map((r) => r.seed).join(', ')})`);
  if (timeouts.length) timeReasons.push(`${timeouts.length} matches still going at the time limit`);
  const fu = median(all.map((x) => x.s.firstUnloadMs));
  if (fu > T.firstUnloadMax * MIN) timeReasons.push(`first unload at ${mins(fu)} min`);
  const fc = median(ok.map((r) => r.firstContactMs));
  if (!(fc <= T.firstContactMax * MIN)) timeReasons.push(`first contact at ${mins(fc)} min`);
  const fa = median(all.map((x) => x.s.firstAttackMs));
  if (!(fa >= T.firstAttackMin * MIN && fa <= T.firstAttackMax * MIN)) timeReasons.push(`first attack wave at ${mins(fa)} min, target ${T.firstAttackMin}–${T.firstAttackMax}`);
  const fl = median(ok.map((r) => Math.min(r.sides.player.firstBuildingLostMs ?? Infinity, r.sides.enemy.firstBuildingLostMs ?? Infinity)).map((x) => (x === Infinity ? null : x)));
  if (!(fl <= T.firstBuildingLostMax * MIN)) timeReasons.push(`first building lost at ${mins(fl)} min`);
  verdict('time', timeReasons);
  out.push('PACING (median, interquartile range in brackets; minutes)');
  const stageRows = STAGES.map((st) => [`first ${st} unit/building`, spread(all.map((x) => x.s.firstOfStage[st] ?? null))]);
  out.push(table(['milestone', 'median (IQR)'], [
    ['first harvester unload', spread(all.map((x) => x.s.firstUnloadMs))],
    ...stageRows,
    ['first combat contact', spread(ok.map((r) => r.firstContactMs))],
    ['first attack wave', spread(all.map((x) => x.s.firstAttackMs))],
    ['first building lost', spread(ok.map((r) => Math.min(r.sides.player.firstBuildingLostMs ?? Infinity, r.sides.enemy.firstBuildingLostMs ?? Infinity)).map((x) => (x === Infinity ? null : x)))],
    ['match length (decided)', spread(decided.map((r) => r.lengthMs))],
  ]));
  out.push('');

  // --- fair ---
  const F = TARGETS.fair;
  const fairReasons: string[] = [];
  const fairRows: (string | number)[][] = [];
  for (const d of ['easy', 'normal', 'hard']) {
    const rs = decided.filter((r) => r.sides.player.difficulty === d && r.sides.enemy.difficulty === d && r.sides.player.faction !== r.sides.enemy.faction);
    if (!rs.length) continue;
    const w = rs.filter((r) => r.sides[r.winner!].faction === 'ordan').length;
    const [lo, hi] = wilson(w, rs.length);
    fairRows.push([`ordan vs sable, both ${d}`, rs.length, `${pct(w / rs.length)} (${pct(lo)}–${pct(hi)})`]);
    if (w / rs.length < F.winRateLow || w / rs.length > F.winRateHigh) fairReasons.push(`ordan wins ${pct(w / rs.length)} against sable at ${d}`);
  }
  const mirror = decided.filter((r) => sideName(r.sides.player) === sideName(r.sides.enemy));
  const sameLevel = decided.filter((r) => r.sides.player.difficulty === r.sides.enemy.difficulty);
  for (const [label, rs] of [['top slot, mirror matches', mirror], ['top slot, same difficulty', sameLevel]] as const) {
    if (!rs.length) continue;
    const w = rs.filter((r) => r.winner === 'player').length;
    const [lo, hi] = wilson(w, rs.length);
    fairRows.push([label, rs.length, `${pct(w / rs.length)} (${pct(lo)}–${pct(hi)})`]);
    if (rs === mirror && (w / rs.length < F.winRateLow || w / rs.length > F.winRateHigh)) fairReasons.push(`the top slot wins ${pct(w / rs.length)} of mirror matches`);
  }
  const parity = ok.map((r) => {
    const a = r.sides.player.income5Min, b = r.sides.enemy.income5Min;
    return Math.max(a, b) ? Math.min(a, b) / Math.max(a, b) : 1;
  });
  const slotIncome = (t: TeamId) => median(ok.map((r) => r.sides[t].income5Min));
  fairRows.push(['income in 5 min, top / bottom slot', ok.length, `${money(slotIncome('player'))} / ${money(slotIncome('enemy'))}, parity ${pct(mean(parity))}`]);
  if (mean(parity) < F.incomeParity) fairReasons.push(`income parity in the first 5 minutes is ${pct(mean(parity))}`);
  verdict('fair', fairReasons);
  out.push('FAIRNESS (win rate with 95% CI)');
  out.push(table(['who', 'matches', 'win rate'], fairRows));
  out.push('');

  // --- fun ---
  const U = TARGETS.fun;
  const funReasons: string[] = [];
  // lead changes, comebacks and lock-in only mean something between equals: a level against the one below is
  // meant to be one-sided (those matches stay in the other tables)
  const even = ok.filter((r) => r.sides.player.difficulty === r.sides.enemy.difficulty);
  const evenDecided = even.filter((r) => r.winner);
  const leadChanges = mean(even.map((r) => r.leadChanges));
  const behind = evenDecided.filter((r) => r.leaderAfterBigFight);
  const comebacks = behind.filter((r) => r.leaderAfterBigFight !== r.winner).length;
  const locked = nums(evenDecided.map((r) => (r.lockedInMs !== null ? r.lockedInMs / r.lengthMs : null)));
  const engagements = mean(ok.map((r) => r.engagements));
  const fighting = mean(ok.map((r) => r.fightingShare));
  const dead = ok.filter((r) => r.longestQuietMs > U.deadTimeMin * MIN).length;
  const built = sum(all.map((x) => x.s.unitsBuilt));
  const damage = sum(all.map((x) => x.s.damage));
  const totalDamage = Object.values(damage).reduce((a, b) => a + b, 0);
  const [topDamage] = top(damage, 1);
  const orders = new Set(all.map((x) => x.s.buildOrder.slice(0, 6).join('>')));
  const variety = orders.size / Math.max(1, all.length);
  const stalemates = timeouts.length / Math.max(1, ok.length);
  if (leadChanges < U.leadChangesMin) funReasons.push(`only ${leadChanges.toFixed(1)} lead changes a match`);
  if (behind.length && comebacks / behind.length < U.comebacksMin) funReasons.push(`comebacks in ${pct(comebacks / behind.length)} of matches`);
  if (locked.length && quantile(locked, 0.5) < U.snowballBefore) funReasons.push(`the winner's lead is usually permanent from ${pct(quantile(locked, 0.5))} of the match`);
  if (engagements < U.engagementsMin) funReasons.push(`${engagements.toFixed(1)} engagements a match`);
  if (fighting < U.fightingShareMin) funReasons.push(`fighting ${pct(fighting)} of the time`);
  if (dead > ok.length * 0.25) funReasons.push(`${dead} matches with over ${U.deadTimeMin} min of nothing happening`);
  if (topDamage && topDamage[1] / totalDamage > U.dominantShare) funReasons.push(`${topDamage[0]} deals ${pct(topDamage[1] / totalDamage)} of all damage (dominant)`);
  if (stalemates > U.stalemateMax) funReasons.push(`${pct(stalemates)} stalemates`);
  if (variety < U.buildOrderVarietyMin) funReasons.push(`${orders.size} distinct openings in ${all.length} games`);
  verdict('fun', funReasons);
  out.push('FUN (proxies)');
  out.push(table(['measure', 'value', 'what it means'], [
    ['lead changes / match', leadChanges.toFixed(1), `how often the side ahead (army + defences) flips after the first real fight; ${even.length} same-level matches`],
    ['comebacks', behind.length ? `${comebacks}/${behind.length} (${pct(comebacks / behind.length)})` : '–', 'behind just after the first big fight, still won'],
    ['lead locked in at', locked.length ? `${pct(quantile(locked, 0.5))} of the match` : '–', 'how early the winner\'s lead became permanent (snowball)'],
    ['first big fight', spread(evenDecided.map((r) => r.bigFightMs)), `minutes; the first with ${money(BIG_FIGHT_LOSS)}+ lost, where comebacks are judged`],
    ['engagements / match', engagements.toFixed(1), 'separate fights (15 s without a shot ends one)'],
    ['time fighting', pct(fighting), 'share of the match with a fight going on'],
    ['dead time', `${dead} matches; longest median ${mins(median(ok.map((r) => r.longestQuietMs)))} min`, `stretches over ${U.deadTimeMin} min without a shot after first contact`],
    ['units built', top(built, 4).map(([k, v]) => `${k} ${v}`).join(', '), 'variety of what got made'],
    ['damage dealt', top(damage, 4).map(([k, v]) => `${k} ${pct(v / totalDamage)}`).join(', '), 'what mattered; one type over 60% is a dominant strategy'],
    ['stalemates', pct(stalemates), 'timeouts with no winner'],
    ['openings', `${orders.size} distinct in ${all.length}`, 'build-order variety (first 6 buildings)'],
  ]));
  out.push('');
  out.push('MOST EFFECTIVE UNITS (damage per credit built)');
  out.push(table(['unit', 'built', 'damage', 'kills', 'damage / $'], top(built, 8).map(([k, n]) => {
    const kills = sum(all.map((x) => x.s.kills))[k] ?? 0;
    return [k, n, Math.round(damage[k] ?? 0), kills, ((damage[k] ?? 0) / (n * (UNITS[k]?.cost ?? 1))).toFixed(2)];
  })));
  out.push('');

  // --- progress ---
  const progressReasons: string[] = [];
  out.push('PROGRESS (how far up the tech tree)');
  const progRows: (string | number)[][] = [];
  for (const f of ['ordan', 'sable'] as const) {
    const ss = all.filter((x) => x.s.faction === f).map((x) => x.s);
    if (!ss.length) continue;
    const cat = catalogFor(f);
    const roster = [...Object.keys(cat.buildings), ...Object.keys(cat.units)].filter((id) => (ROSTER.buildings as readonly string[]).includes(id) || (ROSTER.units as readonly string[]).includes(id));
    const ever = new Set(ss.flatMap((s) => [...Object.keys(s.unitsBuilt), ...Object.keys(s.buildingsBuilt)]));
    const never = roster.filter((id) => !ever.has(id));
    const tops = ss.map((s) => s.topStage).filter((x): x is Stage => !!x);
    const topTier = STAGES.filter((st) => roster.some((id) => (UNITS[id] ?? BUILDINGS[id]).stage === st)).at(-1)!;
    const reachTop = ss.filter((s) => s.firstOfStage[topTier] !== undefined);
    progRows.push([f, ss.length, top(Object.fromEntries(STAGES.map((st) => [st, tops.filter((t) => t === st).length])), 5).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', '),
      `${topTier}: ${pct(reachTop.length / ss.length)} at ${mins(median(reachTop.map((s) => s.firstOfStage[topTier]!)))} min`, never.join(', ') || '–']);
    if (never.length / roster.length > TARGETS.progress.neverBuiltMax) progressReasons.push(`${f}: ${never.length}/${roster.length} of its roster never built (${never.join(', ')})`);
    const peaks: Record<string, number[]> = {};
    for (const s of ss) for (const [k, n] of Object.entries(s.peakBuildings)) (peaks[k] ??= []).push(n);
    out.push(`  ${f} peak buildings (median of each side's peak): ${Object.entries(peaks).sort().map(([k, v]) => `${k} ${median(v)}`).join(', ')}`);
  }
  out.push(table(['faction', 'sides', 'highest tier reached', 'top tier: how often, when', 'never built in any match'], progRows));
  verdict('progress', progressReasons);
  out.push('');

  // --- build speed ---
  const B = TARGETS.buildSpeed;
  const speedReasons: string[] = [];
  const earlyTop = all.filter((x) => x.s.topStage === 'strategic' && (x.s.topStageMs ?? Infinity) < B.topTierBeforeMin * MIN);
  if (earlyTop.length > all.length * 0.25) speedReasons.push(`${earlyTop.length} sides reach the top tier before ${B.topTierBeforeMin} min`);
  const armyBefore = median(all.map((x) => x.s.timeline.find((t) => t.ms >= 5 * MIN)?.army ?? null));
  if (armyBefore > B.armyBeforeFirstAttack) speedReasons.push(`median army at 5 min is ${money(armyBefore)}`);
  const arrivals: Record<string, { n: number; ms: number; intendedMs: number }> = {};
  for (const { s } of all) for (const [k, a] of Object.entries(s.arrivals)) {
    const e = (arrivals[k] ??= { n: 0, ms: 0, intendedMs: a.intendedMs });
    e.n += a.n;
    e.ms += a.ms;
  }
  const slow = Object.entries(arrivals).filter(([, a]) => a.ms / a.n / a.intendedMs > B.arrivalSlowdownMax);
  if (slow.length) speedReasons.push(`slow to arrive (ordered → ready over ${B.arrivalSlowdownMax}× the rules): ${slow.map(([k, a]) => `${k} ${(a.ms / a.n / a.intendedMs).toFixed(1)}×`).join(', ')}`);
  const limitRows: (string | number)[][] = [];
  for (const f of ['ordan', 'sable'] as const) {
    const ss = all.filter((x) => x.s.faction === f).map((x) => x.s);
    if (!ss.length) continue;
    const row: (string | number)[] = [f];
    let pile = 0, starve = 0, n = 0;
    for (const ph of PHASES) {
      const t = sum(ss.map((s) => s.limits[ph])) as Record<Limit, number>;
      const total = Object.values(t).reduce((a, b) => a + b, 0);
      n += total;
      pile += t.production;
      starve += t.money;
      row.push(total ? (Object.entries(t) as [Limit, number][]).filter(([, v]) => v / total >= 0.1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / total)}`).join(', ') : '–');
    }
    limitRows.push(row);
    if (pile / n > B.limitShareMax) speedReasons.push(`${f}: money piles up (over $5,000 in hand while producing) ${pct(pile / n)} of the time: production is the limit`);
    if (starve / n > B.limitShareMax) speedReasons.push(`${f}: production idle for lack of money ${pct(starve / n)} of the time: money is the limit`);
  }
  verdict('build speed', speedReasons);
  out.push('BUILD SPEED');
  out.push(table(['what limits a side', 'early (0-5 min)', 'mid (5-15)', 'late (15+)'], limitRows));
  const at = (min: number, f: (t: SideResult['timeline'][number]) => number) => median(all.map((x) => {
    const t = x.s.timeline.find((e) => e.ms >= min * MIN);
    return t ? f(t) : null;
  }));
  out.push(table(['minute', 'buildings', 'base value', 'army value', 'harvesters', 'credits in hand'], [5, 10, 15, 20, 30].map((m) => [m, at(m, (t) => t.buildings), money(at(m, (t) => t.baseValue)), money(at(m, (t) => t.army)), at(m, (t) => t.harvesters), money(at(m, (t) => t.credits))])));
  out.push(table(['arrival (ordered → ready)', 'n', 'actual s', 'rules s', 'ratio'], Object.entries(arrivals).sort((a, b) => b[1].n - a[1].n).slice(0, 12)
    .map(([k, a]) => [k, a.n, (a.ms / a.n / 1000).toFixed(0), (a.intendedMs / 1000).toFixed(0), (a.ms / a.n / a.intendedMs).toFixed(2)])));
  out.push(`  unit cap reached by ${all.filter((x) => x.s.unitCapMs !== null).length}/${all.length} sides (median ${mins(median(all.map((x) => x.s.unitCapMs)))} min); `
    + `out of build space: ${all.filter((x) => x.s.noSpaceMs !== null).length}/${all.length} (median ${mins(median(all.map((x) => x.s.noSpaceMs)))} min)`);
  out.push('');

  // --- ore ---
  const O = TARGETS.ore;
  const oreReasons: string[] = [];
  const endShare = median(ok.map((r) => r.ore.end / r.ore.start));
  if (endShare > O.unlimitedShare) oreReasons.push(`${pct(endShare)} of the ore is still there at the end: effectively unlimited, the economy hardly matters`);
  const dry = median(all.map((x) => x.s.homeFieldDryMs));
  if (dry < O.homeDryBeforeMin * MIN) oreReasons.push(`home fields run dry at ${mins(dry)} min`);
  const stalls = all.filter((x) => x.s.homeFieldDryMs !== null && x.s.incomeByMinute.slice(-5).every((n) => n < O.stallIncomePerMin) && x.s.incomeByMinute.length > 8);
  if (stalls.length > all.length * 0.2) oreReasons.push(`${stalls.length} sides' economies stall (no income for 5 min after the ore ran out)`);
  const slot10 = (t: TeamId) => median(ok.map((r) => r.sides[t].income10Min));
  const adv = Math.abs(slot10('player') - slot10('enemy')) / Math.max(1, Math.min(slot10('player'), slot10('enemy')));
  if (adv > O.startAdvantage) oreReasons.push(`the ${slot10('player') > slot10('enemy') ? 'top' : 'bottom'} start earns ${pct(adv)} more in the first 10 minutes`);
  verdict('ore', oreReasons);
  out.push('ORE');
  const oreAt = (m: number) => median(ok.map((r) => r.ore.timeline.find(([ms]) => ms >= m * MIN)?.[1] ?? null));
  out.push(table(['minute', 'ore on map', 'income/min (median side)', 'harvesters', 'income/harvester/min', 'trip field→refinery s'], [0, 5, 10, 15, 20, 30].map((m) => {
    const inc = median(all.map((x) => x.s.incomeByMinute[m] ?? null));
    const h = at(Math.max(m, 0.5), (t) => t.harvesters);
    const trips = all.flatMap((x) => x.s.trips.filter(([mm]) => mm >= m && mm < m + 5).map(([, s]) => s));
    return [m, m ? oreAt(m) : Math.round(median(ok.map((r) => r.ore.start))), money(inc), h, money(inc / h), Number.isFinite(median(trips)) ? median(trips).toFixed(0) : '–'];
  })));
  out.push(`  start ${Math.round(median(ok.map((r) => r.ore.start)))} units; mined ${Math.round(median(ok.map((r) => r.ore.mined)))}, regrown ${Math.round(median(ok.map((r) => r.ore.regrown)))}, left ${pct(endShare)} (medians per match)`);
  out.push(`  home field dry (under 15%): top slot ${spread(ok.map((r) => r.sides.player.homeFieldDryMs))}, bottom ${spread(ok.map((r) => r.sides.enemy.homeFieldDryMs))} min; never in ${all.filter((x) => x.s.homeFieldDryMs === null).length}/${all.length}`);
  out.push(`  income in 10 min: top slot ${money(slot10('player'))}, bottom ${money(slot10('enemy'))}; harvesters at the end ${median(all.map((x) => x.s.harvestersEnd))} (peak ${median(all.map((x) => x.s.harvestersPeak))})`);
  out.push('');

  // --- verdicts first ---
  const head = ['VERDICTS', ...verdicts.map((v) => `  ${v.question.padEnd(12)} ${v.ok ? 'OK' : 'WARNING'}${v.reasons.length ? `: ${v.reasons.join('; ')}` : ''}`), ''];
  return {
    text: [...head, ...out].join('\n'),
    verdicts,
    maps,
    summary: { pairings: pairRows, levels: Object.fromEntries(byLevel), difficultyOrder: order, medianLengthMin: medLen / MIN, speedGameMinPerCpuSec: gameMs / MIN / (cpuMs / 1000) },
  };
}

/** Per map: did it work, can it be won, does it take too long. */
function mapVerdicts(results: MatchResult[]): MapVerdict[] {
  const M = TARGETS.map;
  const byMap = new Map<string, MatchResult[]>();
  for (const r of results) byMap.set(r.scenario, [...(byMap.get(r.scenario) ?? []), r]);
  const contact = new Map([...byMap].map(([k, rs]) => [k, median(rs.map((r) => r.firstContactMs))]));
  const out: MapVerdict[] = [];
  for (const [scenario, rs] of byMap) {
    const reasons: string[] = [];
    const ok = rs.filter((r) => !r.error);
    const errs = rs.length - ok.length;
    if (errs) reasons.push(`bad setup: ${errs} matches crashed (${rs.find((r) => r.error)!.error!.split('\n')[0]})`);
    if (ok.some((r) => r.setup.blockedStarts)) reasons.push(`bad setup: starting units on blocked tiles`);
    if (ok.some((r) => !r.setup.reachable)) reasons.push(`unreachable sides: no ground path between the bases in ${ok.filter((r) => !r.setup.reachable).length} matches`);
    if (ok.some((r) => r.setup.unreachableFields)) reasons.push(`ore: ${Math.max(...ok.map((r) => r.setup.unreachableFields))} fields no refinery can reach`);
    const stuck = mean(ok.map((r) => r.sides.player.stuck + r.sides.enemy.stuck));
    if (stuck > M.stuckMax) reasons.push(`stuck units: ${stuck.toFixed(1)} a match (on a move order, not moving for 30 s)`);
    const failed = mean(ok.map((r) => r.sides.player.failedOrders + r.sides.enemy.failedOrders));
    if (failed > M.failedOrdersMax) reasons.push(`orders refused: ${failed.toFixed(1)} a match`);
    const idleH = mean(ok.flatMap((r) => [r.sides.player.idleHarvesterShare, r.sides.enemy.idleHarvesterShare]));
    if (idleH > 0.25) reasons.push(`harvesters idle ${pct(idleH)} of the time (can't reach ore or a refinery)`);
    const never = ok.filter((r) => r.firstContactMs === null).length;
    if (never) reasons.push(`never fought: ${never} matches without contact`);
    const decided = ok.filter((r) => r.winner);
    for (const slot of ['player', 'enemy'] as const) {
      const w = decided.filter((r) => r.winner === slot).length;
      if (decided.length >= 10 && w / decided.length < M.oneSidedMin) reasons.push(`one-sided: the ${slot === 'player' ? 'top' : 'bottom'} slot wins ${pct(w / decided.length)}`);
    }
    const draws = (ok.length - decided.length) / Math.max(1, ok.length);
    if (draws > TARGETS.fun.stalemateMax) reasons.push(`endless: ${pct(draws)} of matches time out`);
    const len = nums(decided.map((r) => r.lengthMs));
    const med = quantile(len, 0.5);
    if (med > TARGETS.time.matchMax * MIN) reasons.push(`too long: median ${mins(med)} min`);
    if (quantile(len, 0.75) - quantile(len, 0.25) > TARGETS.time.maxSpreadMin * MIN) reasons.push(`very wide spread of match lengths`);
    const others = [...contact].filter(([k]) => k !== scenario).map(([, v]) => v).filter(Number.isFinite);
    const c = contact.get(scenario)!;
    if (others.length && c > M.contactRatioMax * median(others)) reasons.push(`first contact at ${mins(c)} min, far later than on the other maps`);
    out.push({ scenario, matches: rs.length, ok: !reasons.length, reasons, medianMin: med / MIN, firstContactMin: Number.isFinite(c) ? c / MIN : null, drawRate: draws });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length);
}
