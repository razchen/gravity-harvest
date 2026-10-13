import type { PowerView, QueueItemView } from '@gravity-harvest/shared';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { Point } from '../core/geometry';
import type { TeamId } from '../data/teams';
import type { BuyResult } from '../systems/availability';

/** What the minimap may draw: only what the human has explored / can see. */
export interface MinimapSnapshot {
  width: number;
  height: number;
  radar: 'none' | 'offline' | 'online';
  buildings: { tx: number; ty: number; size: number; team: TeamId; built: boolean }[];
  ore: { tx: number; ty: number; rocks: number }[];
  scenery: { tx: number; ty: number; kind: string }[];
  units: { gx: number; gy: number; team: TeamId; selected: boolean; harvester: boolean }[];
  /** 0 unexplored, 1 explored, 2 visible. */
  fogAt(tx: number, ty: number): number;
  /** Camera view in world pixels. */
  view: { x: number; y: number; width: number; height: number };
  iso(gx: number, gy: number): Point;
}

/**
 * The only way the HUD talks to the game. Keeps the DOM UI independent of game internals, so
 * either side can be rewritten (or the HUD moved to a framework) without touching the other.
 */
export interface HudBridge {
  readonly bus: EventBus<GameEvents>;
  credits(): number;
  power(): PowerView;
  population(): { units: number; cap: number };
  /** Unit production queue (from the server). */
  queue(): QueueItemView[];
  /** Finished building types the human owns (prerequisites). */
  ownedTypes(): string[];
  placingType(): string | null;
  startPlacement(type: string): 'ok' | 'poor';
  buyUnit(type: string): BuyResult;
  /** Remove the last queued unit of a type (right-click on its card, or its ×). */
  cancelUnit(type: string): void;
  /** Sell or repair mode: the next clicks on your buildings sell (or cancel) or repair them. */
  readonly mode: 'sell' | 'repair' | null;
  setMode(mode: 'sell' | 'repair' | null): void;
  minimap(): MinimapSnapshot;
  centerOnWorld(x: number, y: number): void;
  perfText(): string;
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
