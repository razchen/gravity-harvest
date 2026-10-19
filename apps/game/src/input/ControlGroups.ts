/** How soon a second press of the same group number counts as a double tap (it also centres the camera). */
export const DOUBLE_TAP_MS = 300;

/**
 * The human's control groups: Ctrl+number saves the selection as group N, the number alone selects it again.
 * Kept by unit id, client side only, and cleared when a new match starts. A unit that dies leaves its groups; one
 * out of sight for a while (a passenger inside a transport) stays in them and is picked again once it's back.
 */
export class ControlGroups {
  private readonly groups = new Map<number, number[]>();
  private lastTap: { n: number; at: number } | null = null;

  /** Group `n` becomes these units (none: the group is emptied). */
  save(n: number, ids: number[]): void {
    if (ids.length) this.groups.set(n, [...ids]);
    else this.groups.delete(n);
  }

  ids(n: number): number[] {
    return this.groups.get(n) ?? [];
  }

  /** The group numbers in use, in keyboard order (1 to 9, then 0). */
  numbers(): number[] {
    return [...this.groups.keys()].sort((a, b) => (a || 10) - (b || 10));
  }

  /** A unit died: it leaves every group (an empty group goes). */
  forget(id: number): void {
    for (const [n, ids] of this.groups) {
      const i = ids.indexOf(id);
      if (i < 0) continue;
      ids.splice(i, 1);
      if (!ids.length) this.groups.delete(n);
    }
  }

  /** A press of group `n`: true if it's the second of a double tap. */
  tap(n: number, now: number): boolean {
    const double = this.lastTap?.n === n && now - this.lastTap.at <= DOUBLE_TAP_MS;
    this.lastTap = double ? null : { n, at: now };
    return double;
  }

  clear(): void {
    this.groups.clear();
    this.lastTap = null;
  }
}
