// What the computer can build and what each thing is good for, worked out from the match catalog (what its side
// may build) and the rules' numbers. No unit is named here: the army is chosen by role and stats, so it adapts
// when the roster changes.
import { ARMORS, BUILDINGS, UNITS, canBuild, canHit, effectiveDps, weapon, withCapability, type Armor, type Capabilities, type Catalog, type Faction } from '@gravity-harvest/rules';
import type { MatchCatalog } from '@gravity-harvest/shared';

/** The one entity with a capability (packages/rules/src/capabilities.ts; a test there checks there is one). */
const only = (cap: keyof Capabilities): string => withCapability(cap)[0];

/**
 * Entities the sim gives a behaviour of their own, found by their capabilities: ore is unloaded at a refinery, by
 * harvesters; a Service Bay repairs vehicles; buildings go up from an Assembly Yard, which an Assembler deploys
 * into. Everything else the AI judges by its numbers.
 */
export const ENGINE_IDS = {
  refinery: only('refinery'),
  harvester: only('harvester'),
  serviceBay: only('repairsVehicles'),
  yard: only('constructs'),
  assembler: only('deploysInto'),
} as const;

export const isAircraft = (type: string) => UNITS[type]?.category === 'Aircraft';
export const isVehicle = (type: string) => UNITS[type]?.category?.endsWith('Vehicle') ?? false;
/** A defence (it shoots): the sim builds one at a time beside one other building. */
export const isDefence = (type: string) => (BUILDINGS[type]?.weapons.length ?? 0) > 0;

const dpsCache = new Map<string, number>();

/** Damage per second of an entity's weapons against a target of this armor (on the ground, or in the air). */
export function dpsAgainst(id: string, armor: Armor, air = false): number {
  const key = `${id}|${armor}|${air}`;
  let v = dpsCache.get(key);
  if (v === undefined) dpsCache.set(key, (v = computeDps(id, armor, air)));
  return v;
}

function computeDps(id: string, armor: Armor, air: boolean): number {
  const e = UNITS[id] ?? BUILDINGS[id];
  // every weapon the sim fires at a target there: each that reaches its layer and does damage, side by side
  const layer = air ? 'air' : 'ground';
  return (e?.weapons ?? []).filter((w) => canHit(w, layer) && weapon(w).damage > 0).reduce((n, w) => n + effectiveDps(w, armor), 0);
}

export function rangeOf(id: string): number {
  const e = UNITS[id] ?? BUILDINGS[id];
  return Math.max(0, ...(e?.weapons ?? []).filter((w) => weapon(w).damage > 0).map((w) => weapon(w).rangeTiles));
}

/** What the enemy is made of, as shares per armor (and how much of it flies). */
export type ArmorMix = Record<Armor, number> & { air: number };

export const evenMix = (): ArmorMix => ({ ...Object.fromEntries(ARMORS.map((a) => [a, a === 'fortified' ? 0 : 0.25])) as Record<Armor, number>, air: 0 });

export class Tech {
  /** Everything this side may build in this match. */
  readonly buildings: string[];
  readonly units: string[];
  /** Units that can fight (an armed weapon), harvesters aside. */
  readonly combat: string[];
  /** Buildings that shoot. */
  readonly defences: string[];
  /** Buildings that make power. */
  readonly power: string[];
  private readonly cat: Catalog;
  private readonly assume: ReadonlySet<string>;

  constructor(readonly catalog: MatchCatalog, readonly faction: Faction) {
    this.cat = catalog as unknown as Catalog;
    this.assume = new Set(catalog.assumeOwned);
    this.buildings = Object.keys(catalog.buildings).filter((id) => BUILDINGS[id]);
    this.units = Object.keys(catalog.units).filter((id) => UNITS[id]);
    this.combat = this.units.filter((id) => id !== ENGINE_IDS.harvester && ARMORS.some((a) => dpsAgainst(id, a) > 0 || dpsAgainst(id, a, true) > 0));
    this.defences = this.buildings.filter((id) => ARMORS.some((a) => dpsAgainst(id, a) > 0 || dpsAgainst(id, a, true) > 0));
    this.power = this.buildings.filter((id) => BUILDINGS[id].power > 0);
  }

  has(id: string): boolean {
    return id in this.catalog.buildings || id in this.catalog.units;
  }

  /** Whether `id` may be built now, owning these (finished) buildings. */
  can(id: string, owned: Iterable<string>): boolean {
    return this.has(id) && canBuild(this.cat, id, this.faction, owned, { assumeOwned: this.assume });
  }

  /**
   * Buildings still missing before `id` can be built, prerequisites first, taking the cheapest way where there is a
   * choice. `owned` counts buildings under construction too (they'll be there). Null if it can't be reached at all.
   */
  path(id: string, owned: ReadonlySet<string>): string[] | null {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (x: string): boolean => {
      const b = this.catalog.buildings[x];
      const u = this.catalog.units[x];
      if (!b && !u) return false;
      const reqs: string[][] = b ? b.prerequisites.map((p) => [p]) : [u!.producedAt, ...u!.prerequisites];
      for (const alts of reqs) {
        if (alts.some((a) => owned.has(a) || this.assume.has(a) || out.includes(a))) continue;
        const options = alts.filter((a) => this.catalog.buildings[a]).sort((p, q) => BUILDINGS[p].cost - BUILDINGS[q].cost);
        let done = false;
        for (const a of options) {
          if (seen.has(a)) continue;
          seen.add(a);
          if (visit(a)) {
            out.push(a);
            done = true;
            break;
          }
        }
        if (!done) return false;
      }
      return true;
    };
    return visit(id) ? out : null;
  }

  cost(id: string): number {
    return (UNITS[id] ?? BUILDINGS[id]).cost;
  }

  hp(id: string): number {
    return (UNITS[id] ?? BUILDINGS[id]).hp;
  }

  /**
   * How much fighting a unit or defence gives per credit against this mix of enemies: the square root of its
   * damage times its health (what decides a fair fight), over its cost, a little more for range. `structures` is the
   * weight given to hurting buildings (what wins the match).
   */
  value(id: string, mix: ArmorMix, structures = 0.25): number {
    let dps = 0;
    const ground = 1 - mix.air;
    for (const a of ARMORS) dps += mix[a] * ground * dpsAgainst(id, a);
    // aircraft armor is unknown until they're in the roster: take the light-armor number for them
    dps += mix.air * dpsAgainst(id, 'light', true);
    dps += structures * dpsAgainst(id, 'structure');
    const e = UNITS[id] ?? BUILDINGS[id];
    return (Math.sqrt(Math.max(0, dps) * e.hp) / e.cost) * (1 + rangeOf(id) / 12);
  }
}
