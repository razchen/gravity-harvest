// Match protocol: the browser and the server talk over one WebSocket per match at MATCH_PATH.
// The server runs the simulation; the browser sends orders and draws the TeamView it is sent.
// A TeamView only ever contains what that team may know (its own state, plus what its fog reveals).
// The socket URL carries the player's anonymous id (`?player=<id>`, see player.ts); saves the match loads and writes
// are that player's.

import type { SaveGameSummary, SaveKind } from './saves.js';

export const MATCH_PATH = '/api/match';

export type TeamId = 'player' | 'enemy';

export interface GridPoint {
  gx: number;
  gy: number;
}

// --- Orders (browser → server) -------------------------------------------------------------------

export type Command =
  /**
   * Move each unit to its point. Units sent to the same point move as a group: the server gives each a tile of its own
   * around it, in formation.
   */
  | { c: 'move'; orders: { id: number; gx: number; gy: number }[] }
  /**
   * Attack-move: as `move` (same formation), but on the way each armed unit stops to fight any enemy, unit or building,
   * it comes across, then carries on to its point. Harvesters and unarmed units just move.
   */
  | { c: 'attackMove'; orders: { id: number; gx: number; gy: number }[] }
  | { c: 'attack'; units: number[]; target: number }
  /** Harvesters: mine this ore tile. */
  | { c: 'harvest'; units: number[]; tx: number; ty: number }
  /** Harvesters: unload at this refinery. */
  | { c: 'dock'; units: number[]; refinery: number }
  /** Vehicles: back onto this Service Bay's pad to be repaired, one at a time (the others wait by it). */
  | { c: 'service'; units: number[]; bay: number }
  | { c: 'stop'; units: number[] }
  | { c: 'place'; building: string; tx: number; ty: number }
  /** Queue a unit; `near` picks which producer it comes out of (the one nearest the camera). */
  | { c: 'train'; unit: string; near?: GridPoint }
  /** Remove the last queued unit of this type (refunds per the rules). */
  | { c: 'cancelTrain'; unit: string }
  | { c: 'sell'; building: number }
  /** Remove one of your buildings still under construction; everything paid is refunded. */
  | { c: 'cancelBuild'; building: number }
  /** An Assembler unpacks into an Assembly Yard where it stands (anywhere it fits). */
  | { c: 'deploy'; unit: number }
  /** Medics and Engineers: see to this damaged unit or building of yours (heal it, or repair it for free). */
  | { c: 'support'; units: number[]; target: number }
  /** Start or stop repairing one of your buildings (it costs as it heals). */
  | { c: 'repair'; building: number; on: boolean }
  /** Infantry: walk to this transport of yours and get in through its nearer side door, one by one, while it has room. */
  | { c: 'board'; units: number[]; transport: number }
  /** A transport stops, opens its doors and lets its passengers out one by one. */
  | { c: 'unload'; transport: number };

/** Development / test only: rejected unless the server runs with debug commands enabled. */
export type DebugCommand =
  | { d: 'credits'; amount: number }
  | { d: 'reveal'; on: boolean }
  | { d: 'teleport'; units: number[]; gx: number; gy: number }
  | { d: 'spawn'; unit: string; team: TeamId; gx: number; gy: number }
  | { d: 'destroyTeam'; team: TeamId; units: boolean; buildings: boolean }
  | { d: 'addTime'; ms: number }
  /** Testing: this team builds, produces and moves `factor` times faster (1 = normal). */
  | { d: 'fast'; factor: number }
  | { d: 'finishBuilds' };

export type PlayableFaction = 'ordan' | 'sable';

/**
 * How well the computer plays. Every level plays by the same rules, sees only its own fog-limited view and gives the
 * same orders a player does; they differ only in how many mistakes it makes (packages/ai profiles).
 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export interface StartMatch {
  /** New match on a scenario, or resume a saved game. */
  scenario?: string;
  saveId?: string;
  /** New match: the side you play (the computer takes the other). Default: the scenario's. */
  faction?: PlayableFaction;
  /** New match: how well the computer plays. Default: DEFAULT_DIFFICULTY. A save keeps its own. */
  difficulty?: Difficulty;
  /** Write the autosave slot when the connection closes mid-match. */
  autosaveOnLeave: boolean;
}

export type ClientMessage =
  | ({ t: 'start' } & StartMatch)
  | { t: 'cmd'; cmd: Command }
  | { t: 'pause' }
  | { t: 'resume' }
  /** `req` is echoed back in the reply so the client can match it. */
  | { t: 'save'; req: number; name: string; kind: SaveKind; overwriteId?: string; thumbnail: string | null }
  | { t: 'debug'; cmd: DebugCommand }
  /** Leaving on purpose (quit, load, new game): end the match without the autosave a dropped connection gets. */
  | { t: 'end' };

// --- State (server → browser) ---------------------------------------------------------------------

export interface BuildingView {
  id: number;
  type: string;
  team: TeamId;
  tx: number;
  ty: number;
  size: number;
  hp: number;
  maxHp: number;
  /** 0..1 while under construction; 1 when finished. */
  progress: number;
  built: boolean;
  /** False when low power stops it working (buildings that need power). */
  powered: boolean;
  /** Yours, being repaired. */
  repairing?: boolean;
  /** Busy: producing (the producer of what its side is making), repairing the vehicle on its pad (a Service Bay), or building (an Assembly Yard while its side builds). */
  working?: boolean;
  /** Defences: which way the head points (32 directions, 0 = +gx, counter-clockwise); absent while at rest. */
  facing?: number;
}

export type HarvesterActivity = 'idle' | 'move' | 'harvest' | 'wait' | 'unload';

export interface UnitView {
  id: number;
  type: string;
  team: TeamId;
  gx: number;
  gy: number;
  /** Sprite direction (16 steps, 0 = +gx, counter-clockwise). */
  dir: number;
  /** A vehicle whose turret turns on its own: which way it aims (32 directions, as `dir`); absent while it points along the hull. */
  aim?: number;
  hp: number;
  maxHp: number;
  moving: boolean;
  /** Harvesters only (own team). */
  cargo?: number;
  capacity?: number;
  activity?: HarvesterActivity;
  /** Your transports only: how many it carries, and how many it can. */
  passengers?: number;
  seats?: number;
  /** A Medic or Engineer healing or repairing right now (its arms work). */
  work?: boolean;
}

export interface RockView {
  id: number;
  tx: number;
  ty: number;
  gx: number;
  gy: number;
  /** Which of the rock shapes to draw. */
  shape: number;
}

/**
 * Scenery: trees and rocks (block their tiles) and bushes, logs and stumps (decoration). The kind's footprint and
 * whether it blocks are in SCENERY_KINDS (packages/sim layout). Drawn at (gx, gy) at `scale` times its normal size.
 */
export interface SceneryView {
  id: number;
  kind: string;
  tx: number;
  ty: number;
  gx: number;
  gy: number;
  scale: number;
}

export interface OreTileView {
  tx: number;
  ty: number;
  /** 0..1, higher in the middle of a field. */
  richness: number;
}

export interface QueueItemView {
  unit: string;
  /** 0..1 for the item being built; 0 for the ones waiting. */
  progress: number;
}

export interface PowerView {
  made: number;
  used: number;
  low: boolean;
}

export interface MatchStats {
  gameTimeMs: number;
  creditsEarned: number;
  unitsKilled: number;
  unitsLost: number;
  buildingsDestroyed: number;
  buildingsLost: number;
  buildingsBuilt: number;
}

export const emptyStats = (): MatchStats => ({
  gameTimeMs: 0, creditsEarned: 0, unitsKilled: 0, unitsLost: 0, buildingsDestroyed: 0, buildingsLost: 0, buildingsBuilt: 0,
});

/** Things that happened since the last view, for effects and sounds. Filtered by what the team can see. */
export type MatchEvent =
  /** `p`: what the weapon fires (the rules' projectile: bullet, shell, fireball, instant discharge). */
  | { e: 'shot'; from: number; to: number; at: GridPoint; p?: string }
  | { e: 'unitDied'; id: number; gx: number; gy: number; type: string }
  /** `sold`: removed by its owner (no explosion). */
  | { e: 'buildingDestroyed'; id: number; tx: number; ty: number; size: number; type: string; team: TeamId; sold: boolean }
  | { e: 'buildingDone'; id: number }
  /** A unit came out of this building (its door opens, and the unit drives out of it). */
  | { e: 'unitOut'; building: number; unit: number }
  | { e: 'rockGone'; id: number }
  | { e: 'rockAdded'; rock: RockView }
  | { e: 'oreTile'; tile: OreTileView }
  | { e: 'door'; refinery: number; open: boolean }
  | { e: 'unloaded'; refinery: number; credits: number }
  | { e: 'unitReady'; id: number; type: string }
  /** A transport's side doors (the ramps) open or close. */
  | { e: 'hatch'; unit: number; open: boolean }
  /**
   * A soldier went into a transport from (gx, gy), through the door on `side` (1: left of the way it faces, -1: right)
   * and is gone from the views until he comes out.
   */
  | { e: 'boarded'; unit: number; type: string; transport: number; gx: number; gy: number; side: 1 | -1 }
  /** A passenger came out of a transport through the door on `side`, down its ramp to where the view has him. */
  | { e: 'disembarked'; unit: number; transport: number; side: 1 | -1 }
  /** A message for the player: `text` to show (it may be reworded), `code` for what it means (the browser picks its sound by it). */
  | { e: 'toast'; text: string; code: ToastCode };

/** What a toast is about: stable, unlike its text. */
export type ToastCode =
  // refusals: an order the server won't carry out, and why
  | 'needCredits' | 'needPrerequisite' | 'needAssemblyYard' | 'alreadyBuilding' | 'cantPlace' | 'cantDeploy'
  | 'unitCap' | 'queueFull' | 'notDamaged' | 'repairNoCredits'
  // news
  | 'sold' | 'cancelled' | 'buildingReady' | 'unitReady' | 'repaired' | 'buildingDestroyed' | 'enemyBuildingDestroyed';

/** Everything one team is allowed to know right now. */
export interface TeamView {
  tick: number;
  /** Match clock (stops while paused). */
  timeMs: number;
  paused: boolean;
  credits: number;
  power: PowerView;
  radar: 'none' | 'offline' | 'online';
  units: UnitView[];
  /** Own buildings, plus enemy buildings this team has discovered: in sight as they are, otherwise as last seen. */
  buildings: BuildingView[];
  /** Unit production queue, in order (each lane builds its first: CatalogUnit.lane). */
  queue: QueueItemView[];
  unitCap: number;
  /** Fog per tile (row-major, y * width + x): '0' unexplored, '1' explored, '2' visible. Only sent when it changed. */
  fog?: string;
  events: MatchEvent[];
  stats: MatchStats;
}

/**
 * What the browser may know about the entities in this match: names, costs, build times, power and
 * prerequisites, for the enabled roster only. Sent with the hello, so nothing else ever reaches the browser.
 */
export interface CatalogBuilding {
  id: string;
  name: string;
  faction: 'ordan' | 'sable' | 'both';
  stage: 'establish' | 'economy' | 'warfare' | 'advanced' | 'strategic';
  cost: number;
  buildTimeSec: number;
  power: number;
  prerequisites: string[];
  /** For its info card: what it does (one line), its role, and its health. */
  description: string;
  role: string;
  hp: number;
  /** It shoots (a defence): listed on the Defense tab. */
  defense: boolean;
}

export interface CatalogUnit {
  id: string;
  name: string;
  faction: 'ordan' | 'sable' | 'both';
  stage: 'establish' | 'economy' | 'warfare' | 'advanced' | 'strategic';
  cost: number;
  buildTimeSec: number;
  producedAt: string[];
  prerequisites: string[][];
  /** Its production queue: each kind of factory has its own, and they build side by side. */
  lane: 'infantry' | 'vehicle' | 'air' | 'naval';
  /** For its info card: what it does (one line), its role, and its health. */
  description: string;
  role: string;
  hp: number;
}

export interface MatchCatalog {
  buildings: Record<string, CatalogBuilding>;
  units: Record<string, CatalogUnit>;
  /** Prerequisites treated as owned (parts of the tech tree not in this match yet). */
  assumeOwned: string[];
  /** Display names for prerequisite IDs. */
  names: Record<string, string>;
  /** Units queued at once, per production lane. */
  queueMax: number;
}

export interface MatchHello {
  scenario: string;
  team: TeamId;
  map: { width: number; height: number };
  /** Where the camera starts. */
  camera: GridPoint;
  /** Milliseconds between views; the client interpolates over this. */
  viewMs: number;
  ore: { tiles: OreTileView[]; rocks: RockView[] };
  scenery: SceneryView[];
  catalog: MatchCatalog;
  debug: boolean;
  /** The side you're playing. */
  faction: PlayableFaction;
  /** How well the computer opponent plays. */
  difficulty: Difficulty;
}

export type ServerMessage =
  | ({ t: 'hello' } & MatchHello)
  | ({ t: 'view' } & TeamView)
  | { t: 'gameOver'; result: 'victory' | 'defeat'; stats: MatchStats }
  | { t: 'saved'; req: number; save: SaveGameSummary }
  | { t: 'error'; message: string; req?: number };

/** The New Game screen's list (GET /api/scenarios): no layout, so enemy positions stay on the server. */
export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  map: { width: number; height: number };
  startingCredits: number;
  /** The sides you can play, and the one picked by default. */
  factions: { id: PlayableFaction; name: string; tagline: string }[];
  defaultFaction: PlayableFaction;
}
