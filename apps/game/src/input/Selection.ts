import type { UnitSprite } from '../entities/UnitSprite';

/** The human's current unit selection. */
export class Selection {
  private readonly units = new Set<UnitSprite>();

  get size(): number {
    return this.units.size;
  }

  [Symbol.iterator](): Iterator<UnitSprite> {
    return this.units[Symbol.iterator]();
  }

  has(u: UnitSprite): boolean {
    return this.units.has(u);
  }

  ids(): number[] {
    return [...this.units].map((u) => u.id);
  }

  set(list: Iterable<UnitSprite>, add = false): void {
    if (!add) this.clear();
    for (const u of list) {
      u.selected = true;
      this.units.add(u);
    }
  }

  clear(): void {
    for (const u of this.units) u.selected = false;
    this.units.clear();
  }

  remove(u: UnitSprite): void {
    u.selected = false;
    this.units.delete(u);
  }
}
