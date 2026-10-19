// Dev building page, Animation tab: the match side of a building's traffic (traffic.ts draws it). Each trip runs in a
// real Sim (packages/sim) on a little map of its own, so units come out, find their way, keep apart, back onto a ramp
// or a pad and drive off exactly as they do in matches; nothing here moves a unit itself. No Phaser, so it can be
// tested (trafficSim.test.ts).
import { BUILDINGS, ECONOMY, UNITS, missingRequirements, powerBalance } from '@gravity-harvest/rules';
import { ASSUME_OWNED, Grid, MATCH_CATALOG, Sim, footprint, sceneryKind, type ScenarioDef } from '@gravity-harvest/sim';
import type { GridPoint, TeamView } from '@gravity-harvest/shared';
import { UNIT_ART } from '../data/art';

/** Out of the building (it produces the unit), docking at it (a refinery) or on its pad to be repaired (a Service Bay). */
export type TripKind = 'out' | 'dock' | 'service';

export interface Trip {
  unit: string;
  kind: TripKind;
}

/** A unit coming to the building starts this far out in front of it (tiles), and leaves to the front-right. */
const FROM_TILES = 4;
/** Service Bay: the vehicle comes in at this share of its health, so there's something to repair. */
const ARRIVE_HEALTH = 0.8;
/** Plenty for anything the trip buys (the unit, a repair). */
const CREDITS = 100_000;

/** Every unit with art, in UNIT_ART's order. */
const WITH_ART = Object.keys(UNIT_ART).filter((u) => MATCH_CATALOG.units[u]);

const factionOf = (id: string) => (BUILDINGS[id] ?? UNITS[id]).faction;

/** What comes out of a building (the units it produces, for its faction) and what comes to it. */
export function tripsFor(building: string): Trip[] {
  const side = factionOf(building);
  const out: Trip[] = WITH_ART
    .filter((u) => MATCH_CATALOG.units[u].producedAt.includes(building) && (side === 'both' || [side, 'both'].includes(factionOf(u))))
    .map((unit) => ({ unit, kind: 'out' }));
  if (building === 'refinery') out.push({ unit: 'harvester', kind: 'dock' });
  if (building === 'service_bay') {
    // the vehicles that use its pad in matches (ground vehicles, not the harvester, as the sim decides); the Jackal
    // first, so it's the one shown
    const vehicles = WITH_ART.filter((u) => u !== 'harvester' && UNITS[u].category?.endsWith('Vehicle'))
      .sort((a, b) => +(b === 'jackal') - +(a === 'jackal'));
    for (const u of vehicles) out.push({ unit: u, kind: 'service' });
  }
  return out;
}

/** The building on the page's stand-in map: its footprint corner and size, in tiles. */
export interface Site {
  type: string;
  tx: number;
  ty: number;
  size: number;
}

/**
 * One trip in its own match: the building, and only what the trip needs. The unit being produced needs its
 * prerequisites owned and power to be built at the normal speed, so those buildings stand in a row along the far
 * edge of the map, out of the page's view; the enemy has a power plant in the opposite corner, so the match isn't
 * over at once. Nothing grows on the map (the page draws none of it).
 */
export class TripRun {
  readonly sim: Sim;
  /** The building's ID in the sim, and the visiting unit's once it's there (a produced one appears a tick later). */
  readonly building: number;
  unit: number | null = null;
  /**
   * `visit`: coming out, or at the building; `away`: done there and driving off to the front-right; `done`: stopped
   * (the page fades it out).
   */
  stage: 'visit' | 'away' | 'done' = 'visit';
  private readonly away: GridPoint;

  constructor(readonly trip: Trip, site: Site, mapSize: number) {
    const { tx, ty, size } = site;
    // where units come from and go to: the free tile nearest a spot in front of the building
    const ground = new Grid(mapSize, mapSize);
    ground.setFootprint(tx, ty, size, true);
    const free = (gx: number, gy: number): GridPoint => {
      const t = ground.nearestFree(Math.floor(gx), Math.floor(gy)) ?? { tx: Math.floor(gx), ty: Math.floor(gy) };
      return { gx: t.tx + 0.5, gy: t.ty + 0.5 };
    };
    this.away = free(tx + size + FROM_TILES, ty + size + 1);
    const from = free(tx + size / 2 - 1, ty + size + FROM_TILES);

    // the side that owns this building (and builds this unit), so neither gets swapped for the other faction's
    const sides = [factionOf(site.type), factionOf(trip.unit)].filter((f) => f !== 'both');
    const faction = sides[0] ?? 'ordan';
    const helpers: string[] = [];
    if (trip.kind === 'out') {
      const owned = new Set([site.type]);
      for (let miss = missingRequirements(MATCH_CATALOG, trip.unit, owned, { assumeOwned: ASSUME_OWNED }); miss.length;
        miss = missingRequirements(MATCH_CATALOG, trip.unit, owned, { assumeOwned: ASSUME_OWNED })) {
        const pick = miss[0].find((id) => [faction, 'both'].includes(factionOf(id))) ?? miss[0][0];
        owned.add(pick);
        helpers.push(pick);
      }
    }
    while (powerBalance([site.type, ...helpers]).low) helpers.push('power_plant');
    let x = 1;
    const row = helpers.map((type) => {
      const b = { type, team: 'a' as const, tx: x, ty: 1 };
      x += footprint(type) + 1;
      return b;
    });

    const scenario: ScenarioDef = {
      id: 'dev-traffic',
      name: 'Traffic',
      description: 'Dev building page: one unit coming out of a building or coming to it.',
      map: { width: mapSize, height: mapSize },
      players: {
        a: { credits: CREDITS, human: true, faction },
        b: { credits: 0, human: false, faction: faction === 'ordan' ? 'sable' : 'ordan' },
      },
      oreFields: [],
      buildings: [
        { type: site.type, team: 'a', tx, ty },
        ...row,
        { type: 'power_plant', team: 'b', tx: mapSize - 4, ty: mapSize - 4 },
      ],
      units: trip.kind === 'out' ? [] : [{ type: trip.unit, team: 'a', ...from }],
      camera: { a: { gx: tx, gy: ty }, b: { gx: mapSize - 2, gy: mapSize - 2 } },
    };
    this.sim = Sim.create(scenario);
    for (const s of this.sim.scenery) {
      const k = sceneryKind(s.kind);
      if (k.blocks) this.sim.map.setFootprint(s.tx, s.ty, k.size, false);
    }
    this.sim.scenery = [];
    this.building = [...this.sim.buildings.values()].find((b) => b.tx === tx && b.ty === ty)!.id;

    if (trip.kind === 'out') {
      // queued and finished at once: it comes out on the next tick
      this.sim.command('a', { c: 'train', unit: trip.unit, near: { gx: tx + size / 2, gy: ty + size / 2 } });
      this.sim.debug('a', { d: 'finishBuilds' });
      return;
    }
    const u = [...this.sim.units.values()][0];
    this.unit = u.id;
    if (u.kind === 'harvester') {
      // a full load: with nothing better to do it heads for its refinery on the first tick
      u.cargo = ECONOMY.harvesterCapacity;
    } else {
      u.hp = Math.round(u.maxHp * ARRIVE_HEALTH);
      this.sim.command('a', { c: 'service', units: [u.id], bay: this.building });
    }
  }

  /** One tick of the match; what the player's side sees after it (the building's state and the events). */
  step(): TeamView {
    this.sim.step();
    const view = this.sim.view('a');
    if (this.unit === null) {
      const out = view.events.find((e) => e.e === 'unitOut' && e.building === this.building);
      if (out?.e === 'unitOut') this.unit = out.unit;
    }
    const u = this.unit !== null ? this.sim.units.get(this.unit) : undefined;
    if (u && this.stage !== 'done' && this.settled()) {
      if (this.stage === 'visit' && this.trip.kind !== 'out') {
        this.sim.command('a', { c: 'move', orders: [{ id: u.id, ...this.away }] });
        this.stage = 'away';
      } else this.stage = 'done';
    }
    return view;
  }

  /** The unit has nothing left to do: it stopped where it was going, unloaded, or was repaired and drove off the pad. */
  private settled(): boolean {
    const u = this.sim.units.get(this.unit!);
    if (!u || u.path.length) return false;
    return u.kind === 'harvester' ? u.state === 'idle' && u.cargo === 0 : u.mode === 'idle' && !u.service;
  }
}
