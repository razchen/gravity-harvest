// Fails the build if rules data reached the browser bundle. The browser must only ever get the match catalog
// (from the server, at runtime) and code; weapon stats, damage classes, AI values and the unreleased roster
// stay on the server. Run after `vite build`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist', 'assets');
/** Strings that only exist in the full rules data (packages/rules/src/generated/balance.ts). */
const SECRETS = [
  'service_rifle', 'small_arms', 'armor_piercing', 'damageClass', 'fireIntervalSec', 'aiFirstAttackMinutes',
  'harvesterCapacity', 'veil_generator', 'strategic_silo', 'goliath', 'Sable', 'Ordan',
];

const leaks = [];
for (const f of readdirSync(DIST).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(DIST, f), 'utf8');
  for (const s of SECRETS) if (src.includes(s)) leaks.push(`${f}: "${s}"`);
}
if (leaks.length) {
  console.error(`Rules data leaked into the browser bundle:\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}
console.log('Bundle check: no rules data in the browser bundle.');
