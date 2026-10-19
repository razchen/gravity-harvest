import Phaser from 'phaser';

/** Effect textures, drawn in code once per game: white, so effects tint them. */
export const FX = {
  /** Soft round dot: flashes, glows, dust. */
  dot: 'fx_dot',
  /** Lumpy soft puff: explosion smoke. */
  smoke: 'fx_smoke',
  /** A soft band, bright along its middle and fading to nothing at its edges: stretched into laser beams. */
  beam: 'fx_beam',
  /** A small missile pointing along +x, in its own colours (not tinted): a pale body, a dark nose, fins at the back. */
  missile: 'fx_missile',
};

/**
 * Flipbook sheets (Unity Labs VFX, CC0; packed by tools/sprites/pack_vfx.py into public/assets/fx). Load them with
 * `loadFxSheets` in a scene's preload before using the fire and smoke effects.
 */
export const FX_SHEETS = {
  flame: { key: 'fx_flame02', file: 'assets/fx/flame02.png', frameWidth: 128, frameHeight: 256, frames: 64 },
  smoke: { key: 'fx_wispysmoke01', file: 'assets/fx/wispysmoke01.png', frameWidth: 128, frameHeight: 128, frames: 64 },
  // what shells and fireballs burst into (render/Impact.ts; Kenney, CC0, tools/sprites/pack_impacts.py): painted fire,
  // flash, smoke and dust puffs (9 variations each), and white shapes to tint
  impactFire: { key: 'fx_impact_fire', file: 'assets/fx/impact_fire.png', frameWidth: 128, frameHeight: 128, frames: 9 },
  impactFlash: { key: 'fx_impact_flash', file: 'assets/fx/impact_flash.png', frameWidth: 128, frameHeight: 128, frames: 9 },
  impactSmoke: { key: 'fx_impact_smoke', file: 'assets/fx/impact_smoke.png', frameWidth: 128, frameHeight: 128, frames: 9 },
  impactPuff: { key: 'fx_impact_puff', file: 'assets/fx/impact_puff.png', frameWidth: 128, frameHeight: 128, frames: 9 },
  impactScorch: { key: 'fx_impact_scorch', file: 'assets/fx/impact_scorch.png', frameWidth: 128, frameHeight: 128, frames: 3 },
  impactDebris: { key: 'fx_impact_debris', file: 'assets/fx/impact_debris.png', frameWidth: 128, frameHeight: 128, frames: 3 },
  impactSoft: { key: 'fx_impact_soft', file: 'assets/fx/impact_soft.png', frameWidth: 128, frameHeight: 128, frames: 3 },
  impactRing: { key: 'fx_impact_ring', file: 'assets/fx/impact_ring.png', frameWidth: 128, frameHeight: 128, frames: 4 },
  impactArc: { key: 'fx_impact_arc', file: 'assets/fx/impact_arc.png', frameWidth: 128, frameHeight: 128, frames: 4 },
  impactFlare: { key: 'fx_impact_flare', file: 'assets/fx/impact_flare.png', frameWidth: 128, frameHeight: 128, frames: 6 },
  impactTwirl: { key: 'fx_impact_twirl', file: 'assets/fx/impact_twirl.png', frameWidth: 128, frameHeight: 128, frames: 3 },
  impactTrace: { key: 'fx_impact_trace', file: 'assets/fx/impact_trace.png', frameWidth: 128, frameHeight: 128, frames: 5 },
  impactEnergy: { key: 'fx_impact_energy', file: 'assets/fx/impact_energy.png', frameWidth: 128, frameHeight: 128, frames: 5 },
};

export function loadFxSheets(scene: Phaser.Scene): void {
  for (const s of Object.values(FX_SHEETS)) {
    if (!scene.textures.exists(s.key)) scene.load.spritesheet(s.key, s.file, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
  }
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.context);
  tex.refresh();
}

/** A seeded random, so the textures look the same every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function ensureFxTextures(scene: Phaser.Scene): void {
  canvas(scene, FX.dot, 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  canvas(scene, FX.beam, 16, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 64);
  });
  canvas(scene, FX.missile, 64, 18, (ctx) => {
    // fins, top and bottom, at the back
    ctx.fillStyle = '#7d776e';
    ctx.beginPath(); ctx.moveTo(2, 1); ctx.lineTo(14, 6); ctx.lineTo(14, 12); ctx.lineTo(2, 17); ctx.lineTo(6, 9); ctx.closePath(); ctx.fill();
    // the body: lit along the top, shaded underneath
    const g = ctx.createLinearGradient(0, 5, 0, 13);
    g.addColorStop(0, '#f6f2ea');
    g.addColorStop(0.45, '#d8d2c6');
    g.addColorStop(1, '#8c867c');
    ctx.fillStyle = g;
    ctx.fillRect(6, 5, 44, 8);
    // a band, and the nose cone
    ctx.fillStyle = '#5a554e';
    ctx.fillRect(36, 5, 3, 8);
    ctx.fillStyle = '#3c3833';
    ctx.beginPath(); ctx.moveTo(50, 5); ctx.quadraticCurveTo(62, 6.5, 63, 9); ctx.quadraticCurveTo(62, 11.5, 50, 13); ctx.closePath(); ctx.fill();
  });
  canvas(scene, FX.smoke, 128, 128, (ctx) => {
    // a cluster of soft blobs: reads as a billow, not a disc
    const rnd = seeded(7);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * 26;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d;
      const r = 18 + rnd() * 20;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  });
}
