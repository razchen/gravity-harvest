// Soldiers getting into and out of transports, as drawn in matches. The sim decides who goes in or out, when, and
// where they stand; here a soldier going in runs up the ramp into the doorway, fading out, and one coming out comes
// down it, fading in (UnitSprite.downRamp). The ramps are found in the transport's door clip (render/ramps.ts).
import Phaser from 'phaser';
import { ENGINE, doorSide } from '@gravity-harvest/sim/layout';
import type { MatchEvent } from '@gravity-harvest/shared';
import { anchorOrigin, meta } from '../assets/manifest';
import { RAMP_TILES_PER_SEC, RUN_CYCLE_TILES } from '../config/game';
import { facing, iso, toGrid, type Point } from '../core/geometry';
import { TEAMS, type TeamId } from '../data/teams';
import { factionOf, unitArt } from '../data/art';
import type { VehicleSprite } from '../entities/UnitSprite';
import type { GameScene } from '../scenes/GameScene';
import { findRamps, framePixels, gridToPx, pxToGrid, type Ramp } from './ramps';

/** Per door atlas and direction, its ramps (read from the frames once, when first needed). */
const found = new Map<string, Ramp[]>();

/**
 * A transport's ramp on `side`, as drawn now: world px of its foot and its doorway, and its length (tiles). From its
 * door clip where that side shows; otherwise (hidden behind the hull, or no clip) where the sim puts the door's foot,
 * up to a doorway a little way in.
 */
export function rampOf(world: Phaser.Scene, t: VehicleSprite, side: 1 | -1): { foot: Point; door: Point; tiles: number } {
  const dir = t.shownDir;
  let ramp: Ramp | undefined;
  const key = t.doorKey;
  if (key) {
    const id = `${key}:${dir}`;
    let ramps = found.get(id);
    if (!ramps) {
      const m = meta(key);
      const n = m.frames ?? 8;
      const read = (f: number) => {
        const fr = world.textures.getFrame(key, `${key}_${dir}_${f}`);
        if (!fr) return null;
        // (a trimmed frame's x, y: where its crop sits in the full canvas)
        return framePixels(fr.source.image as CanvasImageSource, { x: fr.cutX, y: fr.cutY, w: fr.cutWidth, h: fr.cutHeight }, { x: fr.x, y: fr.y }, { w: fr.realWidth, h: fr.realHeight });
      };
      const shut = read(0), open = read(n - 1);
      ramps = shut && open ? findRamps(shut, open, m.anchor, m.res ?? 1, dir, m.directions ?? 16) : [];
      found.set(id, ramps);
    }
    ramp = ramps.find((r) => r.side === side);
  }
  const v = doorSide(dir, side);
  const foot = ramp?.foot ?? gridToPx(v.gx * ENGINE.transportDoorTiles, v.gy * ENGINE.transportDoorTiles);
  const inside = gridToPx(v.gx * 0.45, v.gy * 0.45);
  const door = ramp?.door ?? { x: inside.x, y: inside.y - 16 };
  const up = pxToGrid({ x: door.x - foot.x, y: door.y - foot.y });
  const at = { x: t.sprite.x, y: t.sprite.y };
  return { foot: { x: at.x + foot.x, y: at.y + foot.y }, door: { x: at.x + door.x, y: at.y + door.y }, tiles: Math.max(0.3, Math.hypot(up.gx, up.gy)) };
}

interface Rider {
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  transport: VehicleSprite;
  side: 1 | -1;
  /** Where he started (world px), and how far he has run (tiles). */
  start: Point;
  run: number;
}

/** Soldiers running up a transport's ramp into its doorway, fading out as they go. */
export class Boarding {
  private riders: Rider[] = [];

  constructor(private readonly world: GameScene) {}

  /** A soldier went in (the sim has taken him off the map): draw him going up the ramp from where he stood. */
  board(e: Extract<MatchEvent, { e: 'boarded' }>, t: VehicleSprite, team: TeamId): void {
    const key = unitArt(e.type, factionOf(team, this.world.faction))?.sprite ?? 'rifleman';
    const m = meta(key);
    const start = iso(e.gx, e.gy);
    const sprite = this.world.add.sprite(start.x, start.y, key, m.hover ? `${key}_0` : 'inf_0_idle').setOrigin(...anchorOrigin(m)).setScale(1 / (m.res ?? 1));
    const tint = TEAMS[team].tint;
    if (tint !== null) sprite.setTint(tint);
    this.riders.push({ sprite, key, transport: t, side: e.side, start, run: 0 });
  }

  update(deltaMs: number): void {
    this.riders = this.riders.filter((r) => {
      if (!r.transport.alive) return void r.sprite.destroy();
      const ramp = rampOf(this.world, r.transport, r.side);
      const toFoot = pxToGrid({ x: ramp.foot.x - r.start.x, y: ramp.foot.y - r.start.y });
      const approach = Math.hypot(toFoot.gx, toFoot.gy);
      r.run += (RAMP_TILES_PER_SEC * deltaMs) / 1000;
      const climbing = r.run >= approach;
      const k = climbing ? Math.min(1, (r.run - approach) / ramp.tiles) : r.run / (approach || 1);
      const [from, to] = climbing ? [ramp.foot, ramp.door] : [r.start, ramp.foot];
      const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k;
      const way = climbing ? pxToGrid({ x: ramp.door.x - ramp.foot.x, y: ramp.door.y - ramp.foot.y }) : toFoot;
      const m = meta(r.key);
      const n = m.directions ?? 16, frames = m.run_frames ?? 12;
      const d = facing(way.gx, way.gy, 16) % n;
      // in front of the hull at the door nearer the viewer, behind it at the far one
      const hull = r.transport.sprite.depth;
      const near = ramp.foot.y > r.transport.sprite.y;
      const g = toGrid(x, y);
      const depth = this.world.map.depthAt(g.gx, g.gy) + 0.4;
      r.sprite.setPosition(x, y).setDepth(near ? Math.max(depth, hull + 0.01) : Math.min(depth, hull - 0.01))
        // a soldier runs; a hovering unit glides, facing the way it goes
        .setFrame(m.hover ? `${r.key}_${d}` : `inf_${d}_${Math.floor((r.run * frames) / RUN_CYCLE_TILES) % frames}`)
        .setAlpha(climbing ? 1 - k : 1);
      if (climbing && k >= 1) return void r.sprite.destroy();
      return true;
    });
  }
}
