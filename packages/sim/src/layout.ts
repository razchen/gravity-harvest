// Match layout and engine constants that are not secret: what is enabled, footprints, placement rules.
// No rules data is imported here (types only), so the browser can use this for placement previews and
// build-panel availability without receiving the full rules.
import type { Catalog } from '@gravity-harvest/rules/deps';

// the browser draws units facing the way the sim works it out (geometry.ts has no rules data either)
export { facing } from './geometry.js';

/** Simulation step. */
export const TICK_MS = 50;
/** A view is sent to each player every this many ticks. */
export const VIEW_EVERY_TICKS = 2;

/**
 * What is enabled in matches: only entities that have art. Everything else stays in the spreadsheet and is
 * never sent to players. Add an ID here when its sprites exist (see docs/ADDING_CONTENT.md).
 */
export const ROSTER = {
  buildings: [
    'assembly_yard', 'power_plant', 'reactor_plant', 'refinery', 'barracks', 'radar', 'motor_works', 'service_bay',
    'gravity_lab', 'gravity_forge', 'sentry', 'lance_battery', 'incinerator', 'anchor', 'hound_kennel',
  ],
  units: ['harvester', 'rifleman', 'medic', 'raider', 'infiltrator', 'hound', 'engineer', 'breaker', 'grenadier', 'operator', 'lancer', 'skimmer', 'jackal', 'ram', 'spire', 'carrier', 'watcher', 'shroud', 'seeder', 'assembler'],
} as const;

/**
 * Stand-ins while parts of the tech tree have no art: prerequisites treated as owned, and where units come
 * out of instead. Remove an entry once the real building is in the roster.
 */
export const STAND_INS = {
  assumeOwned: [] as readonly string[],
  producedAt: {} as Readonly<Record<string, readonly string[]>>,
};

/**
 * Each faction's building that does the same job as the other side's: a scenario's starting buildings are swapped
 * for the owner's own when it plays the other faction.
 */
export const FACTION_COUNTERPART: Readonly<Record<string, string>> = {
  sentry: 'incinerator', incinerator: 'sentry',
  lance_battery: 'anchor', anchor: 'lance_battery',
  gravity_lab: 'gravity_forge', gravity_forge: 'gravity_lab',
};

/** Footprint (size x size tiles) of each building. Art-driven, so it lives here rather than in the spreadsheet. */
export const FOOTPRINT: Readonly<Record<string, number>> = {
  assembly_yard: 4,
  power_plant: 3,
  reactor_plant: 3,
  refinery: 4,
  barracks: 3,
  radar: 3,
  motor_works: 3,
  service_bay: 3,
  gravity_lab: 3,
  gravity_forge: 3,
  sentry: 1,
  lance_battery: 2,
  incinerator: 1,
  anchor: 2,
  hound_kennel: 2,
};

export const footprint = (type: string): number => FOOTPRINT[type] ?? 3;

/**
 * Vehicles whose turret turns on its own (their art has a turret layer): they aim it at what they shoot instead of
 * turning the hull. Art-driven, like the footprints.
 */
export const TURRET_UNITS: ReadonlySet<string> = new Set(['jackal']);

/**
 * The hovering units (art-driven: render_vehicle.py `hover`): they take the rules of the soldiers they replaced (they
 * board transports, a Service Bay doesn't repair them) but their bodies are bigger (ENGINE.hoverRadius).
 */
export const HOVER_UNITS: ReadonlySet<string> = new Set([
  'hound', 'lancer', 'operator', 'engineer', 'medic', 'raider', 'infiltrator', 'grenadier', 'breaker',
]);

/** Units that repair their side's damaged buildings, working at them from outside (the Engineer). */
export const FIXERS: ReadonlySet<string> = new Set(['engineer']);

/**
 * Grid direction out of a transport's side door, facing `dir` (of 16): `side` 1 is its left (a quarter turn
 * counter-clockwise from the way it faces), -1 its right.
 */
export function doorSide(dir: number, side: 1 | -1): { gx: number; gy: number } {
  const a = ((dir * 360) / 16 + 90 * side) * (Math.PI / 180);
  return { gx: Math.cos(a), gy: -Math.sin(a) };
}

/** The side door seen from the camera's side (the one that faces down the screen); its left one if neither does. */
export function viewerSide(dir: number): 1 | -1 {
  const l = doorSide(dir, 1);
  return l.gx + l.gy >= -1e-9 ? 1 : -1;
}

/** Engine tuning that the spreadsheet doesn't cover. */
export const ENGINE = {
  unitCap: 50,
  /** New buildings must be within this many tiles of one of yours. */
  buildRadius: 6,
  /** Units in the production queue at once. */
  queueMax: 5,
  harvestMsPerUnit: 250,
  unloadMsPerUnit: 60,
  /** The refinery door animation, opening or closing. */
  doorMs: 700,
  /**
   * A harvester stays docked at least this long, however little it unloads: its bed tipping its load out is drawn
   * over this long (the game's HARVESTER_UNLOAD_MS).
   */
  dockMinMs: 3000,
  /** Low power: construction and production run this many times slower, unloading too. */
  lowPowerSlowdown: 2,
  /** An Assembler deploying: its Assembly Yard unpacks in this many seconds. */
  deploySec: 4,
  /** Repairing a building takes it from nothing to full health in this many seconds (it pays as it goes). */
  repairSecondsForFull: 30,
  /** Service Bay: the vehicle on its pad is repaired by this share of its health a second (half as fast on low power). */
  repairSharePerSec: 0.04,
  /**
   * Units keep apart: a vehicle's body is this radius (tiles; about a tile across), a soldier's less. Overlaps are
   * eased apart by at most `pushTilesPerTick` a tick, the idle one giving way most. A unit that makes no headway for
   * `stuckMs` goes round whoever is in its way, up to `detours` times, then settles on the nearest free tile; within
   * `settleTiles` of where it was going it counts as there.
   */
  vehicleRadius: 0.45,
  infantryRadius: 0.3,
  /** A hovering unit's body (they're 0.8 to 1 tile long, a little smaller than the vehicles). */
  hoverRadius: 0.38,
  /**
   * Medics and Engineers: how far they look for a damaged unit or building of their side to see to (tiles; their sight
   * if it's more), how close an Engineer works from (tiles from the building's edge), and how long its work takes to
   * mend a building from nothing to full (s; free, unlike a paid repair).
   */
  supportLook: 6,
  fixReach: 0.9,
  fixSecondsForFull: 40,
  /** A Medic's or Engineer's arms keep working this long (ms) after each heal or repair step, for its animation. */
  workMs: 900,
  pushTilesPerTick: 0.12,
  stuckMs: 800,
  detours: 2,
  settleTiles: 1.6,
  /** Group moves: a formation is at most this many tiles from its middle per square root of its size (wider groups close up). */
  formationSpread: 0.5,
  /** An idle unit nudged further than this from where it stopped goes back once its spot is free. */
  restSlack: 0.6,
  /** Guards chase intruders at most this far from their post. */
  guardLeash: 9,
  /**
   * Idle units notice enemies this far beyond their weapon range (or their sight, if larger) and move in to fight.
   * A rifleman (range 3, sight 4) reacts at 6 tiles.
   */
  acquireMargin: 3,
  /**
   * Transports (units with passengers): the foot of each side door's ramp is this far out from its middle (tiles); a
   * soldier at it (or within `boardReachTiles` once he can get no nearer) gets in. Its doors take `hatchMs` to open or
   * shut (the art's door clip: 8 frames at 16 fps), passengers go in or out one every `boardGapMs`, and the doors stay
   * open `hatchHoldMs` after the last one.
   */
  transportDoorTiles: 1.1,
  boardReachTiles: 1.6,
  hatchMs: 500,
  boardGapMs: 450,
  hatchHoldMs: 600,
  fogUpdateMs: 200,
  /**
   * Gravity vents (map features the scenario places; footprint and art are the `gravity_vent` scenery kind): each owns
   * a ring of ore around it, about `ventOreRadius` tiles from its middle (about 34 tiles), a field of its own that never
   * dies out. On every growth tick (the spreadsheet's `resourceGrowthIntervalSec`) each of its tiles below full gains a
   * unit with `ventGrowthChance`, emptied ones too (a normal field only grows partly harvested tiles, and restarts
   * emptied ones rarely), and an emptied tile touching the vent always starts again. Tuned so a vent keeps about one
   * harvester busy for the whole match, about $1,260 a minute from a home refinery 30 tiles away (a fresh home field
   * gives one about $2,100), and a second harvester adds little: an income worth fighting over, not a replacement for
   * expanding (measured in ore.test.ts). These could move to the spreadsheet's Economy sheet.
   */
  ventOreRadius: 3.6,
  ventGrowthChance: 0.2,
} as const;

// --- Scenery ----------------------------------------------------------------------------------------------------

export type SceneryCategory = 'tree' | 'rock' | 'bush' | 'log' | 'debris' | 'wreck' | 'grass' | 'decal' | 'vent';

export interface SceneryKind {
  /** Frame in the `scenery` atlas (tools/sprites/make_scenery.py). */
  id: string;
  category: SceneryCategory;
  /** Footprint in tiles (size x size). */
  size: 1 | 2;
  /** Trees, rocks, debris, wrecks and vents block movement and building; bushes, logs, grass and decals are decoration. */
  blocks: boolean;
  /** Lies flat on the ground (craters, scorch marks, stains): drawn under every shadow, not depth-sorted, no shadow. */
  flat?: boolean;
  /**
   * Among flat kinds, which go under which (higher on top): ground patches 0 (loose dirt), 1 (cracked earth,
   * gravel); craters, scorch marks, stains and ore bits 2 (the default).
   */
  flatLayer?: 0 | 1 | 2;
}

const numbered = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);

export const SCENERY_KINDS: readonly SceneryKind[] = [
  ...['olive', 'deadwood', 'cypress', 'oak', 'evergreen'].map((id) => ({ id, category: 'tree' as const, size: 1 as const, blocks: true })),
  ...['boulders', 'rubble', 'ledge'].map((id) => ({ id, category: 'rock' as const, size: 1 as const, blocks: true })),
  ...['crag', 'stack', 'spire'].map((id) => ({ id, category: 'rock' as const, size: 2 as const, blocks: true })),
  ...['shrub', 'sage', 'thornbush', 'drybrush', 'rockbush', 'juniper'].map((id) => ({ id, category: 'bush' as const, size: 1 as const, blocks: false })),
  ...['log', 'mossy_log', 'stump', 'snag'].map((id) => ({ id, category: 'log' as const, size: 1 as const, blocks: false })),
  ...numbered('debris', 4).map((id) => ({ id, category: 'debris' as const, size: 1 as const, blocks: true })),
  ...['wreck_generator', 'wreck_pump', 'wreck_drill', 'wreck_unit'].map((id) => ({ id, category: 'wreck' as const, size: 2 as const, blocks: true })),
  // a map feature, not grown: the scenario places it (ScenarioDef.vents) and it seeds ore around itself (ore.ts)
  { id: 'gravity_vent', category: 'vent', size: 2, blocks: true },
  ...[...numbered('grass', 8), ...numbered('grass_patch', 8)].map((id) => ({ id, category: 'grass' as const, size: 1 as const, blocks: false })),
  ...[...numbered('crater', 4), ...numbered('scorch', 4), ...numbered('oil', 2), 'ore_scar', ...numbered('ore_bits', 6)]
    .map((id) => ({ id, category: 'decal' as const, size: 1 as const, blocks: false, flat: true })),
  ...numbered('dirt', 6).map((id) => ({ id, category: 'decal' as const, size: 1 as const, blocks: false, flat: true, flatLayer: 0 as const })),
  ...[...numbered('gravel', 4), ...numbered('cracked', 4)]
    .map((id) => ({ id, category: 'decal' as const, size: 1 as const, blocks: false, flat: true, flatLayer: 1 as const })),
];

/** Decals the server never places: the browser shows them where things happen (mined-out ore). */
export const EVENT_ONLY_SCENERY: readonly string[] = ['ore_scar'];

/** The gravity vent's scenery kind: placed by the scenario (never grown), a 2 x 2 blocker that seeds ore forever. */
export const VENT_KIND = 'gravity_vent';

const KIND_BY_ID = new Map(SCENERY_KINDS.map((k) => [k.id, k]));
export function sceneryKind(id: string): SceneryKind {
  const k = KIND_BY_ID.get(id);
  if (!k) throw new Error(`Unknown scenery kind "${id}"`);
  return k;
}

/** How the landscape is grown (packages/sim/src/scenery.ts). */
export const SCENERY = {
  /** Blockers stay this many tiles from starting buildings; decoration this many. And blockers stay off ore by this. */
  baseClearance: 8,
  decorBaseClearance: 2,
  oreClearance: 2,
  /** Roads prefer gaps: a tree or rock tile costs this much more than open ground. */
  roadBlockerCost: 6,
  trees: {
    /** Noise cell sizes in tiles: groves, their ragged edges, and species regions. */
    groveCell: 11,
    detailCell: 4,
    speciesCell: 16,
    /** Groves form where the density noise rises from `groveFrom` to `groveTo`, filled up to `groveFill`. */
    groveFrom: 0.53,
    groveTo: 0.66,
    groveFill: 0.95,
    /** Chance of a lone tree anywhere else. */
    loneChance: 0.015,
    /** Minimum distance between trees (tiles), for the blue-noise spacing. */
    spacing: 1.02,
    /** Near a grove's edge, chance a tree is dead; elsewhere, chance it isn't the grove's main species. */
    deadChance: 0.35,
    mixChance: 0.22,
  },
  rocks: {
    /** Outcrop centres are at least this far apart; each becomes an outcrop with this chance. */
    outcropSpacing: 10,
    outcropChance: 0.35,
    /** Smaller rocks around an outcrop's big rock, within this radius. */
    smallMin: 1,
    smallMax: 4,
    outcropRadius: 3.2,
    /** Boulders on their own, anywhere. */
    loneRocks: 10,
  },
  /** Scenery past the edge of the field (drawn, never reached): this many tiles out, denser towards the far end. */
  outside: {
    margin: 16,
    thicken: 0.08,
  },
  decor: {
    spacing: 1.6,
    /** Next to trees or rocks: chance of a bush. Anywhere: chance of a bush. In the woods: chance of a log or stump. */
    edgeBushChance: 0.32,
    loneBushChance: 0.025,
    logChance: 0.22,
  },
  /** Abandoned industrial sites: a wreck (2 x 2) with rubble around it, an oil stain, sometimes a scorch mark. */
  sites: {
    /** In the field: `fieldMin` to `fieldMax`; past the edge, one with this chance. */
    fieldMin: 1,
    fieldMax: 3,
    outsideChance: 0.6,
    /** A site takes up about this many tiles around its wreck; it's kept clear of trees and rocks. */
    radius: 3,
    /** Gap from the site's area to starting buildings is at least baseClearance + this; to ore, at least `oreGap`. */
    baseGapExtra: 2,
    oreGap: 6,
    /** Sites are at least this far apart (tiles), and at least `edge` tiles inside the field. */
    spacing: 14,
    edge: 3,
    debrisMin: 2,
    debrisMax: 4,
    scorchChance: 0.5,
    /** Roads go around a site: its open ground costs this much (its wreck and rubble cost `roadBlockerCost`). */
    roadCost: 3,
  },
  /** Rubble in small clusters: often next to rock outcrops, sometimes in the open, rarely in the woods. */
  debris: {
    clusterSpacing: 8,
    nearRocksChance: 0.45,
    openChance: 0.1,
    woodsChance: 0.02,
    min: 2,
    max: 4,
    radius: 1.8,
  },
  /** Grass: patches where its own noise field is high (a cluster with tufts around it), plus a sprinkle elsewhere. */
  grass: {
    cell: 7,
    patchSpacing: 3.8,
    /** Patches grow where the grass noise rises from `from` to `to`. */
    from: 0.46,
    to: 0.66,
    tuftsMin: 3,
    tuftsMax: 7,
    tuftRadius: 2.4,
    /** Single tufts elsewhere: at grove and outcrop edges, and in the open. */
    sprinkleSpacing: 2.3,
    edgeChance: 0.2,
    openChance: 0.06,
  },
  /** Old battlefield scars in the open, over the field and the margin. */
  scars: {
    cratersMin: 2,
    cratersMax: 5,
    scorchMin: 1,
    scorchMax: 3,
  },
  /**
   * Ground patches (big flat decals that break up the tiled ground), over the field and the margin. Loose dirt
   * anywhere, blue-noise spaced (`dirtSpacing` tiles apart), kept with this chance, `dirtOreGap` tiles from ore.
   * Gravel next to rock outcrops and rubble, and along the roads. Cracked earth in dry open ground (forest density
   * under `crackedForestMax`), and some next to abandoned sites. Patches of one kind stay `spacing` tiles apart.
   */
  ground: {
    dirtSpacing: 6.5,
    dirtChance: 0.85,
    dirtOreGap: 2,
    gravelSpacing: 7,
    gravelNearRocksChance: 0.55,
    gravelRoadChance: 0.1,
    gravelRoadSpacing: 9,
    crackedSpacing: 7,
    crackedForestMax: 0.47,
    crackedChance: 0.6,
    crackedSiteChance: 0.6,
    /** Every ground patch stays off ore, off starting buildings and this many tiles from them. */
    buildingGap: 1,
  },
  /** Ore bits: scattered 1-2 tiles around each ore field, and a few under its edge tiles. */
  oreBits: {
    ringMin: 4,
    ringMax: 7,
    edgeMin: 1,
    edgeMax: 3,
  },
} as const;

// --- Refinery dock (relative to the footprint corner; matches the refinery sprite's ramp) ----------------

export const refineryDock = (tx: number, ty: number) => ({
  /** Parked on the ramp, nose out (it backs up onto it). */
  dock: { gx: tx + 2.1, gy: ty + 4.2 },
  /**
   * On the ramp's axis (it runs along gy), a tile out in front of it: harvesters back onto the ramp in a straight line
   * from here, and drive forward off it in a straight line to here, before turning.
   */
  front: { gx: tx + 2.1, gy: ty + 5.9 },
  /** Queue spot when the dock is busy. */
  wait: { gx: tx + 2.5, gy: ty + 6.6 },
  /** Tiles in front that must stay open. */
  ramp: [{ tx: tx + 2, ty: ty + 4 }, { tx: tx + 2, ty: ty + 5 }, { tx: tx + 2, ty: ty + 6 }],
});

/** Harvester sprite direction that points the nose out of a refinery bay (along +gy): it backs onto the dock. */
export const DOCK_FACING = 12;

// --- Service Bay pad (relative to the footprint corner; matches the bay sprite's pad, under its roof arms) ----------

export const serviceBayPad = (tx: number, ty: number) => ({
  /**
   * Parked on the pad, nose out along +gy (it backs on, as onto a refinery's ramp): the pad fills the front of the
   * footprint, and its rear sits under where the roof arms reach down (service_bay_v2.blend).
   */
  pad: { gx: tx + 1.38, gy: ty + 1.8 },
  /**
   * On the pad's axis (it runs along gy), just out in front of the bay: vehicles back onto the pad in a straight line
   * from here, and drive forward off it in a straight line to here.
   */
  front: { gx: tx + 1.38, gy: ty + 3.9 },
  /** Where one waits while the pad is taken (near enough to be repaired from there already). */
  wait: { gx: tx + 2.7, gy: ty + 4.2 },
  /** The tile in front of the pad, which must stay open. */
  apron: [{ tx: tx + 1, ty: ty + 3 }],
});

// --- Placement --------------------------------------------------------------------------------------------

export interface PlacementWorld {
  isBlocked(tx: number, ty: number): boolean;
  hasOre(tx: number, ty: number): boolean;
  unitOn(tx: number, ty: number): boolean;
  /** Footprints of the placing team's buildings. */
  ownBuildings: Iterable<{ tx: number; ty: number; size: number }>;
}

export interface PlacementCheck {
  problem: string | null;
  /** Tiles to highlight (footprint plus any extra tiles the building needs). */
  tiles: { tx: number; ty: number; bad: boolean; extra: boolean }[];
}

export const TOO_FAR = 'Too far from your base';

/** Whether a building fits at (tx, ty). The server decides; the browser uses the same check for the preview. */
export function checkPlacement(type: string, tx: number, ty: number, w: PlacementWorld): PlacementCheck {
  const n = footprint(type);
  const tiles: PlacementCheck['tiles'] = [];
  let problem: string | null = null;
  for (let x = tx; x < tx + n; x++) {
    for (let y = ty; y < ty + n; y++) {
      let why: string | null = null;
      if (w.isBlocked(x, y)) why = 'Blocked';
      else if (w.hasOre(x, y)) why = "Can't build on ore";
      else if (w.unitOn(x, y)) why = 'A unit is in the way';
      tiles.push({ tx: x, ty: y, bad: !!why, extra: false });
      problem ??= why;
    }
  }
  if (type === 'refinery') {
    for (const t of refineryDock(tx, ty).ramp) {
      const bad = w.isBlocked(t.tx, t.ty);
      tiles.push({ ...t, bad, extra: true });
      if (bad) problem ??= 'The ramp needs open ground in front';
    }
  }
  if (type === 'service_bay') {
    for (const t of serviceBayPad(tx, ty).apron) {
      const bad = w.isBlocked(t.tx, t.ty);
      tiles.push({ ...t, bad, extra: true });
      if (bad) problem ??= 'The pad needs open ground in front';
    }
  }
  let near = false;
  for (const b of w.ownBuildings) {
    if (Math.max(b.tx - (tx + n), tx - (b.tx + b.size), b.ty - (ty + n), ty - (b.ty + b.size)) <= ENGINE.buildRadius) near = true;
  }
  if (!near) problem ??= TOO_FAR;
  return { problem, tiles };
}

// --- Availability -------------------------------------------------------------------------------------------

/** A catalog limited to the roster, with stand-ins applied (works on the full or the public catalog). */
export function matchCatalog<C extends Catalog>(cat: C): Catalog {
  const buildings: Catalog['buildings'] = Object.fromEntries(ROSTER.buildings.map((id) => [id, cat.buildings[id]]));
  const units: Catalog['units'] = Object.fromEntries(ROSTER.units.map((id) => {
    const u = cat.units[id];
    const producedAt = STAND_INS.producedAt[id];
    return [id, producedAt ? { ...u, producedAt: [...producedAt], prerequisites: u.prerequisites.filter((alts) => !alts.some((a) => producedAt.includes(a))) } : u];
  }));
  return { buildings, units };
}

export const ASSUME_OWNED: ReadonlySet<string> = new Set(STAND_INS.assumeOwned);
