// What the human can build right now. Worked out in the browser from the match catalog the server sends with
// the hello (the enabled roster's names, costs and prerequisites; nothing else). The server checks again and
// has the final say; this keeps the HUD honest and fast.
import type { MatchCatalog } from '@gravity-harvest/shared';
import { missingRequirements } from '@gravity-harvest/rules/deps';

let catalog: MatchCatalog = { buildings: {}, units: {}, assumeOwned: [], names: {}, queueMax: 0 };
let assumeOwned: ReadonlySet<string> = new Set();

/** Called when a match starts (from the hello). */
export function setCatalog(c: MatchCatalog): void {
  catalog = c;
  assumeOwned = new Set(c.assumeOwned);
}

export const getCatalog = (): MatchCatalog => catalog;

export type BuyResult = 'ok' | 'poor' | 'cap' | 'queue' | { needs: string };

const name = (id: string) => catalog.names[id] ?? id;

/** First missing requirement as display text ("Barracks", "Radar or Refinery"), or null. */
export function missingFor(id: string, owned: string[]): string | null {
  const miss = missingRequirements(catalog, id, owned, { assumeOwned });
  return miss.length ? miss[0].map(name).join(' or ') : null;
}

export function trainResult(type: string, credits: number, owned: string[], pop: { units: number; cap: number }, queued: number): BuyResult {
  const needs = missingFor(type, owned);
  if (needs) return { needs };
  if (credits < catalog.units[type].cost) return 'poor';
  if (pop.units + queued >= pop.cap) return 'cap';
  if (queued >= catalog.queueMax) return 'queue';
  return 'ok';
}
