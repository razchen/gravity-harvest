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

/** `queue`: the whole production queue (every lane counts towards the cap; only the unit's own lane can be full). */
export function trainResult(type: string, credits: number, owned: string[], pop: { units: number; cap: number }, queue: readonly { unit: string }[]): BuyResult {
  const needs = missingFor(type, owned);
  if (needs) return { needs };
  if (credits < catalog.units[type].cost) return 'poor';
  if (pop.units + queue.length >= pop.cap) return 'cap';
  const lane = catalog.units[type].lane;
  if (queue.filter((q) => catalog.units[q.unit]?.lane === lane).length >= catalog.queueMax) return 'queue';
  return 'ok';
}

/**
 * Why a building can't be started now, besides money and prerequisites: buildings go up from an Assembly Yard, one at a
 * time, and one defence at a time beside it. `own`: the human's buildings (a yard still unpacking doesn't count).
 */
export function buildBlocker(type: string, own: readonly { type: string; built: boolean }[]): string | null {
  if (!assumeOwned.has('assembly_yard') && !own.some((b) => b.type === 'assembly_yard' && b.built)) return 'Needs an Assembly Yard';
  const defence = !!catalog.buildings[type]?.defense;
  const busy = own.find((b) => !b.built && b.type !== 'assembly_yard' && !!catalog.buildings[b.type]?.defense === defence);
  return busy ? `Already building a ${name(busy.type)}` : null;
}
