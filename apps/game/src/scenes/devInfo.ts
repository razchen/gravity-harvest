import Phaser from 'phaser';
import type { MusicStats } from '../audio/Music';
import { MIX, soundLimit, soundStats } from '../audio/Sounds';
import { toGrid } from '../core/geometry';
import { factionOfTeam, isMine } from '../data/teams';
import type { BuildingSprite } from '../entities/BuildingSprite';
import { HarvesterSprite, type UnitSprite } from '../entities/UnitSprite';
import { isBuilding, type Entity } from '../entities/types';
import type { DevInfoSection } from '../ui/HudBridge';
import type { GameScene } from './GameScene';

/** How many frames FrameTimes keeps (a couple of seconds at a high refresh rate). */
const FRAMES = 512;
/** Rows listed at most in a long list (selection, loops). */
const MAX_ROWS = 10;
/** World px per tile across (the 64 x 32 grid). */
const TILE_W = 64;

/** The scene's recent frame times: what the Dev info panel's average and worst frame come from. */
export class FrameTimes {
  private readonly at = new Float64Array(FRAMES);
  private readonly ms = new Float32Array(FRAMES);
  private n = 0;

  add(now: number, deltaMs: number): void {
    const i = this.n++ % FRAMES;
    this.at[i] = now;
    this.ms[i] = deltaMs;
  }

  /** Average and worst frame time over the last second. */
  lastSecond(now: number): { avg: number; max: number; frames: number } {
    let sum = 0;
    let max = 0;
    let frames = 0;
    for (let k = 1; k <= Math.min(this.n, FRAMES); k++) {
      const i = (this.n - k) % FRAMES;
      if (now - this.at[i] > 1000) break;
      sum += this.ms[i];
      max = Math.max(max, this.ms[i]);
      frames++;
    }
    return { avg: frames ? sum / frames : 0, max, frames };
  }
}

const f2 = (n: number) => n.toFixed(2);
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ago = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const clock = (sec: number) => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '?');
const bytes = (b: number) => (b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1 << 20)).toFixed(1)} MB`);
const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s.padEnd(n));
/** "rifleman ×3, harvester ×2": a list of types, commonest first. */
const tally = (types: string[]) => {
  const m = new Map<string, number>();
  for (const t of types) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ') || 'none';
};
const where = (gx: number, gy: number) => `${gx.toFixed(1)},${gy.toFixed(1)}`;

/**
 * Gathers the in-game Dev info panel's text (ui/DevInfo.ts), one section at a time and only for the sections that are
 * open. Reads the scene and the audio's stats; changes nothing.
 */
export class DevInfoCollector {
  /** For per-second rates: the last sample of each counter, and the rate it gave. */
  private readonly rates = new Map<string, { t: number; v: number; rate: number }>();

  constructor(private readonly s: GameScene) {}

  collect(open: ReadonlySet<DevInfoSection>, music: MusicStats | null): Partial<Record<DevInfoSection, string>> {
    const out: Partial<Record<DevInfoSection, string>> = {};
    const now = performance.now();
    if (open.has('sounds')) out.sounds = this.sounds(now, music).join('\n');
    if (open.has('perf')) out.perf = this.perf(now).join('\n');
    if (open.has('link')) out.link = this.link(now).join('\n');
    if (!this.s.view || !this.s.hello) return out;
    if (open.has('match')) out.match = this.match().join('\n');
    if (open.has('camera')) out.camera = this.camera().join('\n');
    if (open.has('selection')) out.selection = this.selection().join('\n');
    return out;
  }

  /** Change per second of a counter, measured over about a second (0 until then). */
  private rate(key: string, value: number, now: number): number {
    const r = this.rates.get(key);
    if (!r || value < r.v) {
      this.rates.set(key, { t: now, v: value, rate: 0 });
      return 0;
    }
    if (now - r.t >= 1000) this.rates.set(key, { t: now, v: value, rate: ((value - r.v) * 1000) / (now - r.t) });
    return this.rates.get(key)!.rate;
  }

  private sounds(now: number, music: MusicStats | null): string[] {
    const sm = this.s.sound;
    const context = 'context' in sm ? `Web Audio ${(sm as Phaser.Sound.WebAudioSoundManager).context.state}` : sm instanceof Phaser.Sound.NoAudioSoundManager ? 'no audio' : 'HTML5 audio';
    const lines = [
      `mix      mute ${sm.mute ? 'ON' : 'off'} · effects ${pct(MIX.effects)} · music ${music ? pct(music.volume) : '?'}`,
      `audio    ${context}${sm.locked ? ' (locked: waiting for a click)' : ''} · ${(sm as Phaser.Sound.BaseSoundManager).getAll().length} sounds alive, ${sm.getAllPlaying().length} playing`,
    ];
    if (music) {
      lines.push(`music    ${music.use ?? 'none'} set · ${music.tracks} tracks${music.waiting ? ' · waiting for the first click' : ''}`);
      for (const p of music.playing) {
        const fade = p.to === 0 ? `fading out ${pct(p.level)}` : p.level < p.to ? `fading in ${pct(p.level)}` : 'playing';
        lines.push(`  ${p.title} (${p.file}) ${clock(p.seconds)} / ${clock(p.length)} · ${p.paused ? 'paused' : fade}`);
      }
      if (!music.playing.length) lines.push('  (nothing playing)');
      lines.push(`  next: ${music.queue.slice(0, 3).join(', ') || '(reshuffle)'}${music.queue.length > 3 ? ` (+${music.queue.length - 3})` : ''}`);
    }
    const loops = this.s.sounds?.loopInfo() ?? [];
    lines.push(`loops (${loops.length})`);
    for (const l of loops.slice(0, MAX_ROWS)) lines.push(`  ${pad(l.key, 12)}${pad(l.slot, 14)}${pad(l.file, 16)}vol ${f2(l.volume)} pan ${signed(l.pan)}`);
    lines.push(`one-shots (last ${soundStats.recent.length}, newest first)`);
    for (const p of [...soundStats.recent].reverse()) {
      const at = p.at ? (({ gx, gy }) => where(gx, gy))(toGrid(p.at.x, p.at.y)) : 'ui';
      lines.push(`  ${pad(ago(now - p.ms), 7)}${pad(p.slot, 17)}${pad(p.file, 19)}${pad(at, 11)}vol ${f2(p.volume)} pan ${signed(p.pan)}`);
    }
    const dropped = [...new Set([...soundStats.limited.keys(), ...soundStats.offScreen.keys()])]
      .map((slot) => ({ slot, limited: soundStats.limited.get(slot) ?? 0, off: soundStats.offScreen.get(slot) ?? 0 }))
      .sort((a, b) => b.limited - a.limited || b.off - a.off);
    lines.push('not played (limits / off screen)');
    for (const d of dropped.slice(0, MAX_ROWS)) {
      const lim = soundLimit(d.slot);
      lines.push(`  ${pad(d.slot, 17)}${pad(`${d.limited} / ${d.off}`, 12)}max ${lim.max}, gap ${lim.gap}ms`);
    }
    if (!dropped.length) lines.push('  none');
    return lines;
  }

  private perf(now: number): string[] {
    const s = this.s;
    const f = s.frames.lastSecond(now);
    const list = s.gameObjects();
    let visible = 0;
    let emitters = 0;
    let particles = 0;
    for (const o of list) {
      if ((o as Phaser.GameObjects.Image).visible) visible++;
      if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
        emitters++;
        particles += o.getAliveParticleCount();
      }
    }
    let texBytes = 0;
    const textures = Object.values(s.textures.list);
    for (const t of textures) for (const src of t.source) texBytes += src.width * src.height * 4;
    const r = s.game.renderer;
    const lines = [
      `fps ${s.game.loop.actualFps.toFixed(0)} · frame avg ${f.avg.toFixed(1)}ms, worst ${f.max.toFixed(1)}ms (${f.frames} frames in the last second)`,
      `objects ${list.length} (${visible} visible) · tweens ${s.tweens.getTweens().length} · emitters ${emitters} (${particles} particles)`,
      `textures ${textures.length} · about ${bytes(texBytes)} if all uploaded`,
      `renderer ${r.type === Phaser.WEBGL ? 'WebGL' : 'Canvas'} · ${r.width}×${r.height}`,
    ];
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem) lines.push(`JS heap ${bytes(mem.usedJSHeapSize)} of ${bytes(mem.jsHeapSizeLimit)}`);
    return lines;
  }

  private link(now: number): string[] {
    const s = this.s;
    const net = s.net;
    if (!net) return ['no connection'];
    const a = net.stats.arrivals;
    const recent = a.filter((t) => now - t <= 1000);
    let gap = 0;
    for (let i = 1; i < a.length; i++) if (now - a[i] <= 1000) gap = Math.max(gap, a[i] - a[i - 1]);
    const v = s.view;
    const h = s.hello;
    const lines = [
      `socket ${net.state}${h ? ` · ${h.scenario} as ${factionOfTeam(h.you)} in seat ${h.you} · debug commands ${h.debug ? 'yes' : 'no'}` : ' · waiting for the hello'}`,
      `last view ${a.length ? `${ago(now - a.at(-1)!)} ago` : 'none yet'} · ${recent.length} views/s${h ? ` (expected ${(1000 / h.viewMs).toFixed(0)})` : ''} · worst gap ${Math.round(gap)}ms`,
      `received ${net.stats.views} views, ${bytes(net.stats.bytes)} · ${bytes(Math.round(this.rate('bytes', net.stats.bytes, now)))}/s`,
    ];
    if (v) lines.push(`server tick ${v.tick} (${this.rate('tick', v.tick, now).toFixed(1)}/s) · ${v.paused ? 'PAUSED' : 'running'}`);
    lines.push('round trip: not measured (orders get no reply)');
    return lines;
  }

  private match(): string[] {
    const s = this.s;
    const v = s.view!;
    const units = [...s.units.values()];
    const buildings = [...s.buildings.values()];
    const mine = units.filter((u) => isMine(u.team));
    const myB = buildings.filter((b) => isMine(b.team));
    const enemyU = units.filter((u) => !isMine(u.team));
    const enemyB = buildings.filter((b) => !isMine(b.team));
    const enemyBSeen = enemyB.filter((b) => s.fog.at(Math.floor(b.gx), Math.floor(b.gy)) === 2);
    const pop = s.population();
    const going = myB.filter((b) => !b.built);
    return [
      `time ${clock(v.timeMs / 1000)} · tick ${v.tick}${v.paused ? ' · PAUSED' : ''} · fast ${s.fastMode === 1 ? 'off' : `${s.fastMode}×`} · fog ${s.fogRevealed ? 'off' : 'on'}`,
      `credits $${Math.floor(v.credits).toLocaleString('en-US')} · power ${v.power.made} made / ${v.power.used} used${v.power.low ? ' (LOW)' : ''} · radar ${v.radar}`,
      `population ${pop.units}/${pop.cap} · queue ${v.queue.length ? v.queue.map((q) => (q.progress > 0 ? `${q.unit} ${pct(q.progress)}` : q.unit)).join(', ') : 'empty'}`,
      `your units (${mine.length}): ${tally(mine.map((u) => u.type))}`,
      `your buildings (${myB.length}): ${tally(myB.map((b) => b.type))}${going.length ? ` · going up: ${tally(going.map((b) => b.type))}` : ''}`,
      `enemy units in sight (${enemyU.length}): ${tally(enemyU.map((u) => u.type))}`,
      `enemy buildings: ${enemyBSeen.length} in sight, ${enemyB.length} known · ${tally(enemyB.map((b) => b.type))}`,
    ];
  }

  private camera(): string[] {
    const s = this.s;
    const cam = s.cameras.main;
    const w = cam.worldView;
    const c = toGrid(w.centerX, w.centerY);
    const p = s.input.activePointer;
    p.updateWorldPoint(cam);
    const g = toGrid(p.worldX, p.worldY);
    const tx = Math.floor(g.gx);
    const ty = Math.floor(g.gy);
    const lines = [
      `zoom ${pct(s.zoomLevel)} · centre ${where(c.gx, c.gy)} · view ${Math.round(w.width)}×${Math.round(w.height)} px (~${(w.width / TILE_W).toFixed(0)} tiles across)`,
      `pointer tile ${tx},${ty} (${where(g.gx, g.gy)}) · world ${Math.round(p.worldX)},${Math.round(p.worldY)} · screen ${Math.round(p.x)},${Math.round(p.y)}`,
    ];
    if (!s.map.inBounds(tx, ty)) return [...lines, '  off the map'];
    const fog = ['unexplored', 'explored', 'visible'][s.fog.at(tx, ty)];
    const ore = s.ore.at(tx, ty);
    const scenery = s.scenery.items.filter((i) => i.tx === tx && i.ty === ty).map((i) => i.kind);
    lines.push(`  fog ${fog} · ${s.map.isBlocked(tx, ty) ? 'blocked' : 'open'} · ore ${ore ? `richness ${f2(ore.richness)}, ${ore.rocks.length} rocks` : 'none'} · scenery ${scenery.join(', ') || 'none'}`);
    const b = [...s.buildings.values()].find((x) => tx >= x.tx && tx < x.tx + x.size && ty >= x.ty && ty < x.ty + x.size);
    if (b) lines.push(`  building ${building(b)}`);
    const on = [...s.units.values()].filter((u) => Math.floor(u.gx) === tx && Math.floor(u.gy) === ty);
    if (on.length) lines.push(`  units ${on.map((u) => `${u.type} #${u.id} (${u.team})`).join(', ')}`);
    const hovered = s.input.hitTestPointer(p).map((o) => o.getData('entity') as Entity | undefined).find((e): e is Entity => !!e && e.alive);
    lines.push(`hover ${hovered ? (isBuilding(hovered) ? building(hovered) : unit(hovered)) : 'nothing'}`);
    return lines;
  }

  private selection(): string[] {
    const sel = [...this.s.selection];
    if (!sel.length) return ['nothing selected (only units can be selected; hover a building for its details)'];
    const lines = [`${sel.length} selected: ${tally(sel.map((u) => u.type))}`];
    for (const u of sel.slice(0, MAX_ROWS)) lines.push(`  ${unit(u)}`);
    if (sel.length > MAX_ROWS) lines.push(`  … ${sel.length - MAX_ROWS} more`);
    return lines;
  }
}

function hp(e: { hp: number; maxHp: number }): string {
  return `hp ${Math.ceil(e.hp)}/${e.maxHp} (${pct(e.hp / e.maxHp)})`;
}

function unit(u: UnitSprite): string {
  const parts = [`${u.type} #${u.id} ${u.team}`, hp(u), `at ${where(u.gx, u.gy)}`, `dir ${u.dir}`, u.moving ? 'moving' : 'still'];
  if (u instanceof HarvesterSprite) parts.push(`${u.activity}, cargo ${Math.round(u.cargo)}/${u.capacity}`);
  if (u.seats) parts.push(`passengers ${u.passengers}/${u.seats}`);
  if (u.aim >= 0) parts.push(`turret aim ${u.aim}`);
  if (u.inside) parts.push('coming out');
  return parts.join(' · ');
}

function building(b: BuildingSprite): string {
  const parts = [`${b.type} #${b.id} ${b.team}`, hp(b), b.built ? 'built' : `going up ${pct(b.progress)}`, `at ${b.tx},${b.ty} (${b.size}×${b.size})`];
  if (!b.powered) parts.push('NO POWER');
  if (b.working) parts.push('working');
  if (b.repairing) parts.push('repairing');
  return parts.join(' · ');
}
