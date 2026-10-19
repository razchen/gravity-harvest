#!/usr/bin/env node
// npm run simulate -- [--quick] [--matches 20] [--a ordan:hard --b sable:normal] [--scenario skirmish|all] [--seed 1]
//                     [--max-minutes 40] [--workers N] [--out tools/simulator/out]
// Plays computer-against-computer matches with no rendering, as fast as the CPU allows (across worker threads),
// prints the verdicts and tables, and writes everything as JSON to the output directory.
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SCENARIOS } from '@gravity-harvest/sim';
import { runMatch, type MatchResult, type MatchSpec } from './match.js';
import { buildReport } from './report.js';
import { SUITE, specs } from './suite.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function args(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const quick = argv.includes('--quick');
  const a = get('a'), b = get('b');
  if (!!a !== !!b) throw new Error('Give both --a and --b, or neither (the standard suite)');
  const scenario = get('scenario') ?? (quick ? 'all' : 'skirmish');
  return {
    quick,
    matches: Number(get('matches') ?? 20),
    pairings: a && b ? [[a, b] as [string, string]] : SUITE,
    scenarios: scenario === 'all' ? Object.keys(SCENARIOS) : [scenario],
    seed: Number(get('seed') ?? 1),
    maxMinutes: Number(get('max-minutes') ?? 40),
    workers: Math.max(1, Number(get('workers') ?? Math.max(1, availableParallelism() - 1))),
    out: resolve(get('out') ?? join(HERE, '..', 'out')),
  };
}

/** Run the matches on a pool of worker threads (results in the order of the specs, so a seed always reads the same). */
function runAll(list: MatchSpec[], workers: number): Promise<MatchResult[]> {
  if (workers <= 1) return Promise.resolve(list.map((s, i) => (progress(i + 1, list.length), runMatch(s))));
  return new Promise((done, fail) => {
    const results: MatchResult[] = new Array(list.length);
    let next = 0, finished = 0;
    const pool = Array.from({ length: Math.min(workers, list.length) }, () => new Worker(join(HERE, 'worker.js')));
    const feed = (w: Worker) => {
      if (next >= list.length) return void w.terminate();
      const i = next++;
      w.once('message', (r: MatchResult) => {
        results[i] = r;
        progress(++finished, list.length);
        if (finished === list.length) done(results);
        feed(w);
      });
      w.postMessage(list[i]);
    };
    for (const w of pool) {
      w.on('error', fail);
      feed(w);
    }
  });
}

function progress(n: number, of: number): void {
  if (process.stderr.isTTY) process.stderr.write(`\r  ${n}/${of} matches`);
}

const opts = args(process.argv.slice(2));
const list = specs(opts);
process.stderr.write(`Simulating ${list.length} matches (${opts.pairings.length} pairings × ${opts.scenarios.length} maps × ${opts.matches}) on ${opts.workers} workers, up to ${opts.maxMinutes} game minutes each\n`);
const t0 = performance.now();
const results = await runAll(list, opts.workers);
const realMs = performance.now() - t0;
if (process.stderr.isTTY) process.stderr.write('\n');
const report = buildReport(results, { realMs, workers: opts.workers });
console.log(report.text);
mkdirSync(opts.out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(opts.out, `simulation-${stamp}.json`);
const json = JSON.stringify({ options: { ...opts, out: undefined }, verdicts: report.verdicts, maps: report.maps, summary: report.summary, matches: results }, null, 1);
writeFileSync(file, json);
writeFileSync(join(opts.out, 'latest.json'), json);
console.log(`\nWrote ${file}`);
