import { describe, expect, it } from 'vitest';
import { ControlGroups, DOUBLE_TAP_MS } from './ControlGroups';

describe('ControlGroups', () => {
  it('saves, replaces and empties groups, listed 1 to 9 then 0', () => {
    const g = new ControlGroups();
    g.save(0, [1]);
    g.save(3, [4, 5]);
    g.save(1, [2]);
    expect(g.numbers()).toEqual([1, 3, 0]);
    g.save(3, [6]);
    expect(g.ids(3)).toEqual([6]);
    g.save(3, []);
    expect(g.numbers()).toEqual([1, 0]);
  });

  it('drops a dead unit from every group, and a group left empty', () => {
    const g = new ControlGroups();
    g.save(1, [7, 8]);
    g.save(2, [7]);
    g.forget(7);
    expect(g.ids(1)).toEqual([8]);
    expect(g.numbers()).toEqual([1]);
  });

  it('counts a second press of the same number soon after as a double tap', () => {
    const g = new ControlGroups();
    expect(g.tap(1, 0)).toBe(false);
    expect(g.tap(1, DOUBLE_TAP_MS - 1)).toBe(true);
    expect(g.tap(1, DOUBLE_TAP_MS)).toBe(false); // a third press starts over
    expect(g.tap(2, DOUBLE_TAP_MS + 10)).toBe(false);
    expect(g.tap(2, DOUBLE_TAP_MS * 3)).toBe(false);
  });
});
