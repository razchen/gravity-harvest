import Phaser from 'phaser';
import { DEPTH } from '../config/game';
import { iso, toGrid } from '../core/geometry';
import type { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, type UnitSprite } from '../entities/UnitSprite';
import { isBuilding, isUnit, type Entity } from '../entities/types';
import type { GameScene } from '../scenes/GameScene';
import { $ } from '../ui/dom';
import { typingInField } from './CameraController';
import type { OreTileSprite } from '../world/OreLayer';

/** The cursor over a building you can sell or repair: a coin or a wrench. */
const svgCursor = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${svg}</svg>`)}") 16 16, pointer`;
const MODE_CURSOR = {
  sell: svgCursor("<circle cx='16' cy='16' r='13' fill='#ffc61a' stroke='#1a1406' stroke-width='2.5'/><text x='16' y='22.5' font-family='Arial' font-weight='bold' font-size='18' text-anchor='middle' fill='#1a1406'>$</text>"),
  repair: svgCursor("<path d='M26.5 22.6 17.7 13.8a6.4 6.4 0 0 0-8.2-8.2l3.8 3.8-3.3 3.3-3.8-3.8a6.4 6.4 0 0 0 8.2 8.2l8.8 8.8a2.3 2.3 0 0 0 3.3-3.3z' fill='#ffc61a' stroke='#1a1406' stroke-width='2'/>"),
};

/** How close (world px) a click must be to a unit's body to pick it. */
const UNIT_PICK_RADIUS = 56;

/**
 * Mouse and keyboard for the human player, classic RTS controls:
 * left-click selects (shift adds), left-drag box-selects, left-click with a selection gives an order
 * (ore = harvest, own refinery = unload there, enemy = attack, ground = move), right-click deselects.
 * While placing a building, left-click places and right-click / Esc cancels (Esc is handled in GameFlow).
 * Orders are sent to the server; markers show up straight away so the round trip isn't felt.
 */
export class InputController {
  private boxStart: { x: number; y: number } | null = null;
  private readonly boxGfx: Phaser.GameObjects.Graphics;

  constructor(private readonly world: GameScene) {
    this.boxGfx = world.add.graphics().setDepth(DEPTH.ui + 1);
    const input = world.input;
    input.mouse?.disableContextMenu();
    const kb = input.keyboard!;
    // Esc (cancel placement / open the menu) is handled by GameFlow on the page, so it works while paused too.
    // Phaser keeps key events from while the scene was paused, so ignore anything typed into a field or a menu.
    const inGame = () => !typingInField() && $('#screens').hidden;
    kb.on('keydown-F', () => inGame() && world.toggleFog());
    kb.on('keydown-G', () => inGame() && world.toggleGrid());
    kb.on('keydown-T', () => inGame() && world.cycleFast());
    kb.on('keydown-E', () => inGame() && world.deploySelected());
    kb.on('keydown-P', () => inGame() && world.bus.emit('perf', null));
    kb.on('keydown-ZERO', () => inGame() && world.resetZoom());
    kb.on('keydown-NUMPAD_ZERO', () => inGame() && world.resetZoom());
    kb.on('keydown-BACKTICK', () => inGame() && world.bus.emit('debugMenu', null));
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() && !world.placement.active) this.boxStart = { x: p.worldX, y: p.worldY };
    });
    input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onUp(p, over));
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const w = this.world;
    if (w.placement.active) return w.placement.update(p.worldX, p.worldY);
    this.boxGfx.clear();
    if (this.boxStart && p.leftButtonDown() && p.getDistance() > 6) {
      const b = this.boxRect(p, this.boxStart);
      const cam = w.cameras.main;
      this.boxGfx.lineStyle(2 / cam.zoom, 0x7dff6a, 1).strokeRect(b.x, b.y, b.width, b.height)
        .fillStyle(0x7dff6a, 0.08).fillRect(b.x, b.y, b.width, b.height);
    }
    if (w.mode) {
      const over = w.input.hitTestPointer(p).some((o) => {
        const e = o.getData('entity') as Entity | undefined;
        return !!e && isBuilding(e) && e.team === 'player' && (w.mode === 'sell' || e.built);
      });
      w.game.canvas.style.cursor = over ? MODE_CURSOR[w.mode] : 'not-allowed';
      return;
    }
    const harvesterSelected = [...w.selection].some((u) => u instanceof HarvesterSprite);
    w.game.canvas.style.cursor = harvesterSelected && w.ore.under(p.worldX, p.worldY) ? 'crosshair' : 'default';
  }

  private onUp(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    const w = this.world;
    const start = this.boxStart;
    this.boxStart = null;
    this.boxGfx.clear();
    if (p.event && p.event.target !== w.game.canvas) return; // released over the HUD, not the map
    const dragged = p.getDistance() > 6;
    if (p.rightButtonReleased()) {
      if (!dragged) {
        if (w.placement.active) w.placement.cancel();
        else if (w.mode) w.setMode(null);
        else w.selection.clear();
      }
      return;
    }
    // sell / repair mode: a click on one of your buildings sells (or cancels) or repairs it; the mode stays on
    if (w.mode) {
      if (dragged) return;
      const b = over.map((o) => o.getData('entity') as Entity | undefined).find((e): e is BuildingSprite => !!e && isBuilding(e) && e.alive && e.team === 'player');
      if (b) {
        if (w.mode === 'sell') w.sellOrCancel(b);
        else w.toggleRepair(b);
      }
      return;
    }
    if (w.placement.active) {
      if (!dragged) w.placement.confirm();
      return;
    }
    const shift = (p.event as MouseEvent | undefined)?.shiftKey ?? false;
    if (dragged && start) {
      const b = this.boxRect(p, start);
      w.selection.set([...w.units.values()].filter((u) => u.team === 'player' && !u.inside && b.contains(u.sprite.x, u.sprite.y - 20)), shift);
      return;
    }
    const hits = over.map((o) => o.getData('entity') as Entity | undefined).filter((e): e is Entity => !!e && e.alive);
    // units win over buildings: a soldier standing in front of (or behind) a building is what you meant
    const hitUnit = this.unitAt(p.worldX, p.worldY) ?? hits.find(isUnit);
    if (hitUnit?.team === 'player') return w.selection.set([hitUnit], shift);
    if (!w.selection.size) return;
    const hitBuilding = hits.filter(isBuilding).find((b) => b.built);
    // (own units returned above, so any unit hit here is hostile)
    const enemy: Entity | null = hitUnit ?? (hitBuilding && hitBuilding.team !== 'player' ? hitBuilding : null);
    const ownRefinery = hitBuilding?.type === 'refinery' && hitBuilding.team === 'player' ? hitBuilding : null;
    const ore = w.ore.under(p.worldX, p.worldY);
    this.issueOrders(enemy, ownRefinery, ore, toGrid(p.worldX, p.worldY));
  }

  private issueOrders(enemy: Entity | null, ownRefinery: BuildingSprite | null, ore: OreTileSprite | null, g: { gx: number; gy: number }): void {
    const w = this.world;
    const harvesters = [...w.selection].filter((u) => u instanceof HarvesterSprite).map((u) => u.id);
    const others = [...w.selection].filter((u) => !(u instanceof HarvesterSprite));
    const movers = [...(ownRefinery || ore ? [] : harvesters.map((id) => w.units.get(id)!)), ...(enemy ? [] : others)];
    if (ownRefinery && harvesters.length) w.net.command({ c: 'dock', units: harvesters, refinery: ownRefinery.id });
    else if (ore && harvesters.length) w.net.command({ c: 'harvest', units: harvesters, tx: ore.tx, ty: ore.ty });
    if (enemy && others.length) w.net.command({ c: 'attack', units: others.map((u) => u.id), target: enemy.id });
    if (movers.length) {
      // spread a group around the target
      w.net.command({
        c: 'move',
        orders: movers.map((u, i) => {
          const a = i * 2.4;
          const r = i ? 0.9 * Math.sqrt(i) : 0;
          return { id: u.id, gx: g.gx + Math.cos(a) * r, gy: g.gy + Math.sin(a) * r };
        }),
      });
    }
    if (enemy) w.effects.targetMarker(enemy.gx, enemy.gy, isBuilding(enemy) ? enemy.size * 1.4 : 1);
    else if (!ownRefinery && !ore) w.effects.moveMarker(Math.floor(g.gx), Math.floor(g.gy));
  }

  /** The unit whose body is under (or nearest to) a world point, within a small radius. */
  private unitAt(x: number, y: number): UnitSprite | null {
    let best: UnitSprite | null = null;
    let bestD = UNIT_PICK_RADIUS;
    for (const u of this.world.units.values()) {
      if (u.inside) continue; // still coming out of a building
      const c = iso(u.gx, u.gy);
      const body = u instanceof HarvesterSprite ? 40 : 60; // pick around the middle of the body, not the feet
      const d = Math.hypot(c.x - x, c.y - body - y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private boxRect(p: Phaser.Input.Pointer, s: { x: number; y: number }): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(Math.min(s.x, p.worldX), Math.min(s.y, p.worldY), Math.abs(p.worldX - s.x), Math.abs(p.worldY - s.y));
  }
}
