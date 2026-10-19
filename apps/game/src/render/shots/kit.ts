import type Phaser from 'phaser';
import type { Point } from '../../core/geometry';
import type { ImpactStyle } from '../Impact';
import type { ShotHit } from '../Effects';

/**
 * One shot as the game draws it, handed to a look (shots/index.ts). World px throughout. The server has already
 * decided whether it hits and for how much: this is only how it looks.
 */
export interface Shot {
  /** Where it leaves: the gun that fires next (a turret's barrel tip, or one of a unit's guns in turn). */
  from: Point;
  /** Every gun the unit has (frame-accurate, per direction): for looks that fire from all of them, or each in turn. Empty for most turrets and buildings. */
  guns: Point[];
  /** Where it's aimed: on the target (a little above the ground for a unit, a building's middle). */
  to: Point;
  /** The ground under the target when it's a unit (or the spot itself), for scorch marks and dust; a building's centre for looks in STRIKES_GROUND. */
  ground?: Point;
  /** A muzzle flash where it leaves (off for a Harvester's self-defence and the like). */
  flash: boolean;
  /** What it hits: its sprites, to flash, and their depth, to draw a burst just in front of them. */
  hit?: ShotHit;
  /** The firing side's energy colour (purple Ordan, red Sable): for energy weapons. Plain guns can ignore it. */
  glow?: number;
}

/** Something on screen for a while: `step` is called every frame with the ms since the last; return false once it's done (and has destroyed what it made). */
export interface Live {
  step(ms: number, g: Phaser.GameObjects.Graphics): boolean;
}

/** What a look gets to draw with. */
export interface Kit {
  scene: Phaser.Scene;
  /** Keep `l` stepping every frame until it's done. `g` (in step) is a shared additive Graphics, cleared every frame. */
  add(l: Live): void;
  /** The burst look shells use (render/Impact.ts `impact`). */
  impactStyle: ImpactStyle;
  /** Say a round has landed, for its sound: 'bullet' for a small hit, 'shell' for a heavy one. */
  landed(kind: 'bullet' | 'shell', at: Point): void;
  /** The old look for projectile `p` (render/Effects.ts), for a look that isn't written yet. */
  legacy(p: string, s: Shot): void;
}

/** A unit's shot look: draws `s`, adding whatever it needs to keep moving with kit.add. */
export type Look = (kit: Kit, s: Shot) => void;
