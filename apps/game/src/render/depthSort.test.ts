import { describe, expect, it } from 'vitest';
import { insertionSortByDepth } from './depthSort';

/** Objects with a depth (from a small range, so there are ties) and their place in the list before sorting. */
const make = (n: number, seed: number) => {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return Array.from({ length: n }, (_, i) => ({ _depth: Math.floor(rand() * 20) - 5, i }));
};
const stable = <T extends { _depth: number }>(list: T[]) => [...list].sort((a, b) => a._depth - b._depth);

describe('insertionSortByDepth', () => {
  it('sorts as a stable sort does: equal depths keep their order', () => {
    for (let seed = 1; seed < 20; seed++) {
      const list = make(300, seed);
      const want = stable(list);
      expect(insertionSortByDepth(list, Infinity)).toBe(true);
      expect(list).toEqual(want);
    }
  });

  it('sorts a nearly sorted list (a few moved, a few added at the end) within its budget', () => {
    const list = stable(make(5000, 7));
    list[100]._depth += 3;
    list[4000]._depth -= 2;
    list.push({ _depth: -5, i: -1 }, { _depth: 14, i: -2 });
    const want = stable(list);
    expect(insertionSortByDepth(list)).toBe(true);
    expect(list).toEqual(want);
  });

  it('gives up past its budget, leaving the list for a stable sort to finish the same way', () => {
    const list = make(2000, 3);
    const want = stable(list);
    expect(insertionSortByDepth(list, 100)).toBe(false);
    list.sort((a, b) => a._depth - b._depth);
    expect(list).toEqual(want);
  });
});
