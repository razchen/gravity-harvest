// Rendering and input settings. Gameplay numbers live on the server (packages/rules, packages/sim).

/** Isometric tile footprint in world pixels. Art is rendered at 2x, so a tile shows as 64 x 32 at zoom 0.5. */
export const TILE_W = 128;
export const TILE_H = 64;

/**
 * Render at the screen's real pixel density (Retina = 2): the canvas has DPR x the CSS pixels so the
 * full-resolution art is shown instead of being upscaled. Capped at 2 to keep fill-rate sane.
 */
export const DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);

export const CAMERA = {
  /** Default scale: tiles at about 85 x 43 CSS px, close enough to tell soldiers apart. */
  startZoom: 0.67,
  minZoom: 0.25,
  /**
   * The closest zoom. The art is drawn pixel for pixel at 0.5 (on a Retina screen; 1.0 on others), so past that it is
   * stretched a little: soft rather than blocky, the sprites being rendered, not pixel art.
   */
  maxZoom: 0.75,
  /** Keyboard pan speed in CSS px per second. */
  panSpeed: 900,
  /** Keyboard zoom while + / − is held: the zoom changes by e^speed per second (about 3x per second). */
  zoomSpeed: 1.1,
};

/**
 * The world doesn't end at the edge of the playable map: the ground (and fog) carry on this many tiles past it on
 * every side, so you never see a black void. It's enough to fill the screen at the widest zoom with the camera
 * held over the map (CameraController keeps the view's centre on the field).
 */
export const WORLD = {
  /** Ground and fog are drawn this far past the field; past the fade below it's dark, like the page background. */
  borderTiles: 30,
  /**
   * Outside the field the ground is never fully lit (at most "explored" dim, a hint that play stops there): a visible
   * edge eases down to that over this many tiles (no line at the edge)...
   */
  outsideSoftTiles: 3,
  /** ...and the land fades into darkness by this many tiles from the field's edge. */
  outsideFadeTiles: 22,
};

/** Draw order bands. Everything on the ground sorts by isometric y inside the world band. */
export const DEPTH = {
  ground: -1e6,
  groundStain: -1e6 + 2,
  /** Base decals under trees and bushes: on the ground, under every shadow. */
  groundDecal: -1e6 + 2.5,
  debug: -1e6 + 3,
  scorch: -1e5,
  smoke: 1e7,
  fog: 1e7 + 1,
  ui: 2e7,
};

export const FOG = {
  /** How much an explored-but-not-visible tile is darkened (0 clear .. 1 black). */
  exploredAlpha: 0.55,
  /** World px per fog-canvas px; the canvas is blurred and stretched for soft edges. */
  cellPx: 16,
  blurPx: 6,
};

/** Infantry: one run cycle (all its frames) covers this many tiles at infantry scale. */
export const RUN_CYCLE_TILES = 0.89;
/** A soldier going up or down a transport's ramp moves about as fast as he runs (the rules' rifleman: 1.4 tiles/s). */
export const RAMP_TILES_PER_SEC = 1.4;
/** Infantry turn through the in-between directions at this many ms a step, instead of snapping round. */
export const INFANTRY_TURN_MS_PER_STEP = 28;

/**
 * Hovering units (render_vehicle.py `hover`): they bob this far up and down (world px) over their shadow, once every
 * `periodMs`; their lights glow on the ground under them, pulsing between `glowMin` and `glowMax` (alpha), in a pool
 * `glowTiles` wide.
 */
export const HOVER = { bob: 3, periodMs: 2200, glowMin: 0.35, glowMax: 0.55, glowTiles: 0.8 };
/**
 * A harvester at a refinery's dock tips its bed out over this long (its `v_harvester_unload` clip, sped up to fit):
 * the sim keeps it docked at least as long (packages/sim ENGINE.dockMinMs). It holds the clip's last frame, the bed
 * empty, until it drives off.
 */
export const HARVESTER_UNLOAD_MS = 3000;
/** The direction a docked harvester faces (packages/sim DOCK_FACING): the unload clip is drawn facing it. */
export const HARVESTER_DOCK_FACING = 12;
/** A vehicle's turret turns through its directions (32) at this many ms a step: a whole turn in under a second. */
export const TURRET_TURN_MS_PER_STEP = 25;
