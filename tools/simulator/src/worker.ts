// A worker thread: plays the matches it's handed, one at a time, and sends each result back.
import { parentPort } from 'node:worker_threads';
import { runMatch, type MatchSpec } from './match.js';

parentPort!.on('message', (spec: MatchSpec) => parentPort!.postMessage(runMatch(spec)));
