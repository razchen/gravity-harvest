/** Small seeded random generator (mulberry32, as the sim's): the AI never uses Math.random, so a match replays the same. */
export class Rng {
  constructor(public state: number) {}

  /** 0 <= x < 1 */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return p > 0 && this.next() < p;
  }

  pick<T>(list: readonly T[]): T | undefined {
    return list.length ? list[this.int(list.length)] : undefined;
  }

  /** One of `items`, with probability proportional to its weight (the first if every weight is 0). */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    const total = items.reduce((n, t) => n + Math.max(0, weight(t)), 0);
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const t of items) if ((r -= Math.max(0, weight(t))) < 0) return t;
    return items[items.length - 1];
  }
}
