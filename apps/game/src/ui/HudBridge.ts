import type { PowerView, QueueItemView, PlayableFaction } from '@gravity-harvest/shared';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Point } from '../core/geometry';
import type { TeamId } from '../data/teams';
import type { ToastCode } from '../data/toasts';
import type { BuyResult } from '../systems/availability';

/** What the minimap may draw: only what the human has explored / can see. */
export interface MinimapSnapshot {
  width: number;
  height: number;
  radar: 'none' | 'offline' | 'online';
  buildings: { tx: number; ty: number; size: number; team: TeamId; built: boolean }[];
  /** Ore and scenery in explored ground (worked out when read: the minimap only reads them when its map changes). */
  readonly ore: { tx: number; ty: number; rocks: number }[];
  readonly scenery: { tx: number; ty: number; kind: string }[];
  /** These count up whenever the fog or the ore changes, so the minimap knows when to redraw its map. */
  fogVersion: number;
  oreVersion: number;
  units: { gx: number; gy: number; team: TeamId; selected: boolean; harvester: boolean }[];
  /** 0 unexplored, 1 explored, 2 visible. */
  fogAt(tx: number, ty: number): number;
  /** Camera view in world pixels. */
  view: { x: number; y: number; width: number; height: number };
  iso(gx: number, gy: number): Point;
}

/** A selected unit, for the selection panel. */
export interface SelectedUnit {
  id: number;
  type: string;
  team: TeamId;
  hp: number;
  maxHp: number;
  /** Harvesters: ore carried, how much fits, and what it's doing. */
  cargo?: { load: number; capacity: number; activity: string };
  /** Transports: soldiers inside, and seats. */
  seats?: { used: number; total: number };
}

/** A control group in use: how many of its units are on the map, and whether it's exactly the selection. */
export interface GroupView {
  n: number;
  count: number;
  /** How many of the selected units are in it. */
  selected: number;
  current: boolean;
}

/** The Dev info panel's sections (I key; ui/DevInfo.ts). */
export type DevInfoSection = 'sounds' | 'perf' | 'link' | 'match' | 'camera' | 'selection';

/**
 * The only way the HUD talks to the game. Keeps the DOM UI independent of game internals, so
 * either side can be rewritten (or the HUD moved to a framework) without touching the other.
 */
export interface HudBridge {
  readonly bus: EventBus<GameEvents>;
  /** A message is shown: its code's sound, if it has one (a refusal's error; data/toasts.ts). */
  toastSound(code: ToastCode | undefined): void;
  /** The side you play (each side builds the shared units to its own design). */
  readonly faction: PlayableFaction | null;
  credits(): number;
  power(): PowerView;
  population(): { units: number; cap: number };
  /** Unit production queue (from the server). */
  queue(): QueueItemView[];
  /** Finished building types the human owns (prerequisites). */
  ownedTypes(): string[];
  placingType(): string | null;
  /** Start placing a building; a message says why it can't be started now (see buildBlocker). */
  startPlacement(type: string): 'ok' | 'poor' | { text: string; code: ToastCode };
  buyUnit(type: string): BuyResult;
  /** Remove the last queued unit of a type (right-click on its card, or its ×). */
  cancelUnit(type: string): void;
  /** Sell or repair mode: the next clicks on your buildings sell (or cancel) or repair them. */
  readonly mode: 'sell' | 'repair' | null;
  setMode(mode: 'sell' | 'repair' | null): void;
  /** A transport of yours with passengers is selected; unload them (E, or the Unload button). */
  canUnload(): boolean;
  unloadSelected(): void;
  /** The selection, for the selection panel; `selectionVersion` goes up whenever it changes. */
  selected(): SelectedUnit[];
  readonly selectionVersion: number;
  /** Narrow the selection to one unit type, or (`drop`) take that type out of it. */
  selectType(type: string, drop: boolean): void;
  /** Control groups in use (Ctrl+number saves one, the number selects it). */
  controlGroups(): GroupView[];
  /** Select group `n` (`add`: add it to the selection); a double tap also centres the camera on it. */
  tapGroup(n: number, add: boolean): void;
  minimap(): MinimapSnapshot;
  centerOnWorld(x: number, y: number): void;
  perfText(): string;
  /** The Dev info panel's text for the sections that are open (skipped: closed ones, and match ones before the first view). */
  devInfo(open: ReadonlySet<DevInfoSection>): Partial<Record<DevInfoSection, string>>;
  /** Open the in-game menu (pause, save, load, quit). */
  requestMenu(): void;
  // debug and shortcuts panel
  readonly debugAvailable: boolean;
  readonly fogRevealed: boolean;
  /** Debug fast mode's speed-up for your side (1 = off). */
  readonly fastMode: number;
  readonly gridOn: boolean;
  readonly zoomLevel: number;
  toggleFog(): void;
  cycleFast(): void;
  toggleGrid(): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
}
