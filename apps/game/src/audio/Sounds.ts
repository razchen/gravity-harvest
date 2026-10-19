import Phaser from 'phaser';
import type { Point } from '../core/geometry';

/**
 * The game's sound effects: each slot (a sound the game plays, tools/audio/picks.json) is one or more files packed by
 * tools/audio/pack_audio.py into assets/audio (audio.json lists them). A slot plays one of its files at random, a
 * little higher or lower each time; a sound somewhere in the world is as loud as it is near the middle of the screen
 * (fading out past its edges, silent well off it) and panned towards its side; each slot has a cap on how many play at
 * once and how soon after each other, so a firefight doesn't stack dozens of the same shot.
 */
export interface AudioSlot {
  files: string[];
  loop?: boolean;
}

const DIR = 'assets/audio/';
const MANIFEST = 'audio_manifest';
let slots: Record<string, AudioSlot> = {};

/** Queue the manifest and every sound (ogg, or mp3 where ogg won't play) in a scene's preload. */
export function loadAudio(scene: Phaser.Scene): void {
  scene.load.json(MANIFEST, `${DIR}audio.json`);
  scene.load.once(`filecomplete-json-${MANIFEST}`, (_key: string, _type: string, data: { slots: Record<string, AudioSlot> }) => {
    slots = data.slots;
    for (const s of Object.values(slots)) for (const f of s.files) scene.load.audio(f, [`${DIR}${f}.ogg`, `${DIR}${f}.mp3`]);
  });
}

/** How the sounds behave, per slot: at most `max` at once, starts at least `gap` ms apart, and its pitch spread. */
const LIMITS: Record<string, { max: number; gap: number }> = {
  rifle_fire: { max: 4, gap: 45 }, autocannon_fire: { max: 3, gap: 60 }, bullet_hit: { max: 4, gap: 40 },
  shell_hit: { max: 4, gap: 60 }, rocket_hit: { max: 4, gap: 60 }, cannon_fire: { max: 3, gap: 70 },
  vehicle_explode: { max: 3, gap: 120 }, building_explode: { max: 2, gap: 300 }, infantry_death: { max: 3, gap: 120 },
  ui_click: { max: 2, gap: 40 }, ui_hover: { max: 1, gap: 60 }, ui_error: { max: 1, gap: 400 },
  unit_ready: { max: 1, gap: 600 }, building_ready: { max: 1, gap: 600 }, under_attack: { max: 1, gap: 15000 },
  credits: { max: 1, gap: 250 }, power_down: { max: 1, gap: 2000 }, power_up: { max: 1, gap: 2000 },
  door: { max: 2, gap: 300 },
};
const DEFAULT_LIMIT = { max: 3, gap: 80 };
/** A one-shot plays up to this many cents higher or lower (UI sounds stay true). */
const DETUNE = 120;
const STEADY = new Set(['ui_click', 'ui_hover', 'ui_error', 'unit_ready', 'building_ready', 'under_attack', 'credits']);

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const slotsOf = (slot: string) => slots[slot]?.files ?? [];

/** The player's effects volume (Settings), 0..1: every sound here, the ambience too (music is audio/Music.ts). */
export const MIX = { effects: 1 };
const channel = (_slot: string) => MIX.effects;

/** A one-shot that played (for the Dev info panel). `at` is its place in the world (none: the interface's). */
export interface PlayedSound {
  slot: string;
  file: string;
  at?: Point;
  /** After distance and the effects volume. */
  volume: number;
  pan: number;
  /** performance.now() when it started. */
  ms: number;
}

/** Read-only numbers for the Dev info panel (ui/DevInfo.ts): the last one-shots, and the ones not played, per slot. */
export const soundStats = {
  recent: [] as PlayedSound[],
  /** Skipped by the slot's limits (too many at once, or too soon after the last). */
  limited: new Map<string, number>(),
  /** Skipped for being too far off screen to hear. */
  offScreen: new Map<string, number>(),
};
const RECENT_MAX = 12;
const played = (p: PlayedSound) => {
  soundStats.recent.push(p);
  if (soundStats.recent.length > RECENT_MAX) soundStats.recent.shift();
};
const tally = (m: Map<string, number>, slot: string) => m.set(slot, (m.get(slot) ?? 0) + 1);

/** A slot's limits (how many at once, how many ms apart). */
export const soundLimit = (slot: string) => LIMITS[slot] ?? DEFAULT_LIMIT;

/** A sound with no place in the world (the interface's): `game.sound` of any scene. */
export function playUi(sound: Phaser.Sound.BaseSoundManager, slot: string, volume = 1): void {
  const s = slots[slot];
  if (!s) return;
  const key = pick(s.files);
  if (!sound.game.cache.audio.exists(key)) return;
  sound.play(key, { volume: volume * channel(slot) });
  played({ slot, file: key, volume: volume * channel(slot), pan: 0, ms: performance.now() });
}

export interface LoopWanted {
  /** Who it belongs to (one loop per key: a harvester's id, a building's). */
  key: string;
  slot: string;
  /** Where it is in the world (none: everywhere, like the ambience). */
  at?: Point;
  volume?: number;
}

interface Playing {
  sound: Phaser.Sound.BaseSound;
  at?: Point;
  volume: number;
  slot: string;
  pan: number;
}

/** A loop that's on (for the Dev info panel). */
export interface LoopInfo {
  key: string;
  slot: string;
  file: string;
  volume: number;
  pan: number;
}

/**
 * The announcer: at least this long (ms) between two of the same line (a base under attack says so now and then, not
 * at every shot).
 */
const ANNOUNCE_GAP: Record<string, number> = {
  announce_base_attack: 20000, announce_unit_lost: 8000, announce_building_lost: 4000, announce_insufficient_funds: 3000,
  announce_low_power: 4000, announce_power_restored: 4000,
};
const DEFAULT_ANNOUNCE_GAP = 1200;
/** Lines the base alarm sounds before, and how long (ms) it sounds before the announcer speaks over its tail. */
const ALARM: Record<string, string> = { announce_base_attack: 'under_attack' };
/** A side's own voice slot (`sable_announce_unit_lost`) as the plain one, for the gaps and alarms. */
const plain = (slot: string) => slot.replace(/^sable_/, '');
const ALARM_LEAD = 700;
/** At most this many lines wait their turn (older ones are dropped: news goes stale). */
const ANNOUNCE_QUEUE = 3;

/** Whether a slot has a sound the game can play. */
const has = (scene: Phaser.Scene, slot: string) => !!slots[slot]?.files.some((f) => scene.cache.audio.exists(f));

/** A scene's sounds, placed against its main camera. */
export class Sounds {
  private readonly starts = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  private readonly loopsOn = new Map<string, Playing>();
  /** The announcer's line playing, the ones waiting, and when each was last said. */
  private speaking: Phaser.Sound.BaseSound | null = null;
  private readonly waiting: string[] = [];
  private readonly said = new Map<string, number>();
  /** A unit's acknowledgement playing (a new one cuts it off: only the latest order is answered). */
  private answering: Phaser.Sound.BaseSound | null = null;
  /** The player's side's voices: `sable_` plays the Sable slots (their own announcer and crews), where they're made. */
  side = '';

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once('shutdown', () => this.stopAll());
  }

  /** How loud a sound at `at` is from where the camera looks (1 on screen, fading to 0 a little past its edges), and its pan. */
  private place(at?: Point): { gain: number; pan: number } {
    if (!at) return { gain: 1, pan: 0 };
    const v = this.scene.cameras.main.worldView;
    const dx = Math.max(v.x - at.x, 0, at.x - v.right);
    const dy = Math.max(v.y - at.y, 0, at.y - v.bottom);
    const out = Math.hypot(dx, dy) / (0.5 * Math.max(v.width, v.height));
    const pan = Phaser.Math.Clamp((at.x - v.centerX) / (v.width / 2), -1, 1) * 0.6;
    return { gain: Math.max(0, 1 - out), pan };
  }

  /** Play one of a slot's sounds, at a place in the world (or everywhere). Returns whether it played. */
  play(slot: string, at?: Point, volume = 1): boolean {
    const s = slots[slot];
    if (!s?.files.length) return false;
    const { gain, pan } = this.place(at);
    if (gain <= 0.02) {
      tally(soundStats.offScreen, slot);
      return false;
    }
    const now = this.scene.time.now;
    const lim = LIMITS[slot] ?? DEFAULT_LIMIT;
    if (now - (this.starts.get(slot) ?? -1e9) < lim.gap || (this.counts.get(slot) ?? 0) >= lim.max) {
      tally(soundStats.limited, slot);
      return false;
    }
    const key = pick(s.files);
    if (!this.scene.cache.audio.exists(key)) return false;
    const snd = this.scene.sound.add(key, { volume: volume * gain * channel(slot), detune: STEADY.has(slot) ? 0 : Phaser.Math.Between(-DETUNE, DETUNE) });
    if ('setPan' in snd) (snd as Phaser.Sound.WebAudioSound).setPan(pan);
    this.starts.set(slot, now);
    this.counts.set(slot, (this.counts.get(slot) ?? 0) + 1);
    snd.once(Phaser.Sound.Events.COMPLETE, () => {
      this.counts.set(slot, Math.max(0, (this.counts.get(slot) ?? 1) - 1));
      snd.destroy();
    });
    snd.play();
    played({ slot, file: key, at, volume: volume * gain * channel(slot), pan, ms: performance.now() });
    return true;
  }

  /**
   * The loops that should be playing now (call every frame or so): new ones start, gone ones stop, and each follows its
   * place (louder as the camera comes to it).
   */
  loops(wanted: LoopWanted[]): void {
    const keep = new Set<string>();
    for (const w of wanted) {
      keep.add(w.key);
      let p = this.loopsOn.get(w.key);
      const { gain, pan } = this.place(w.at);
      const vol = (w.volume ?? 1) * gain * channel(w.slot);
      if (!p) {
        const s = slots[w.slot];
        const file = s?.files.length ? pick(s.files) : null;
        if (!file || !this.scene.cache.audio.exists(file)) continue;
        const sound = this.scene.sound.add(file, { loop: true, volume: 0 });
        // start somewhere in the loop, so two of the same don't drone in step
        sound.play({ loop: true, volume: 0, seek: Math.random() * Math.max(0, sound.duration - 0.1) });
        p = { sound, at: w.at, volume: 0, slot: w.slot, pan };
        this.loopsOn.set(w.key, p);
      }
      // ease towards its level (no clicks as it starts or the camera moves)
      p.volume += (vol - p.volume) * 0.15;
      p.at = w.at;
      p.pan = pan;
      const s = p.sound as Phaser.Sound.WebAudioSound;
      s.setVolume(p.volume);
      if ('setPan' in s) s.setPan(pan);
    }
    for (const [key, p] of this.loopsOn) {
      if (keep.has(key)) continue;
      p.sound.stop();
      p.sound.destroy();
      this.loopsOn.delete(key);
    }
  }

  /** The loops on now (for the Dev info panel). */
  loopInfo(): LoopInfo[] {
    return [...this.loopsOn].map(([key, p]) => ({ key, slot: p.slot, file: p.sound.key, volume: p.volume, pan: p.pan }));
  }

  /**
   * The announcer says a line (one of the slot's), after any it's saying, never two at once; `fallback`: the sound to
   * play instead while the slot has no voice yet.
   */
  announce(slot: string, fallback?: string): void {
    slot = this.voiced(slot);
    if (!has(this.scene, slot)) {
      if (fallback) this.play(fallback);
      return;
    }
    const now = this.scene.time.now;
    if (now - (this.said.get(slot) ?? -1e9) < (ANNOUNCE_GAP[plain(slot)] ?? DEFAULT_ANNOUNCE_GAP) || this.waiting.includes(slot)) return;
    this.said.set(slot, now);
    this.waiting.push(slot);
    while (this.waiting.length > ANNOUNCE_QUEUE) this.waiting.shift();
    if (!this.speaking) this.nextLine();
  }

  private nextLine(): void {
    const slot = this.waiting.shift();
    if (!slot) {
      this.speaking = null;
      return;
    }
    const key = pick(slots[slot].files.filter((f) => this.scene.cache.audio.exists(f)));
    const line = this.scene.sound.add(key, { volume: channel(slot) });
    this.speaking = line;
    line.once(Phaser.Sound.Events.COMPLETE, () => {
      line.destroy();
      this.nextLine();
    });
    const alarm = ALARM[plain(slot)];
    if (alarm && this.play(alarm)) this.scene.time.delayedCall(ALARM_LEAD, () => this.speaking === line && line.play());
    else line.play();
  }

  /**
   * A unit answers (selected, or given an order): the first of `slots` that has a voice (its own line, else a more
   * general one); a unit with no voice says nothing. A new answer cuts the last one off.
   */
  answer(slots: string[]): void {
    const slot = slots.map((s) => this.voiced(s)).find((s) => has(this.scene, s));
    if (!slot) return;
    const now = this.scene.time.now;
    if (now - (this.starts.get('answer') ?? -1e9) < 200) return;
    this.starts.set('answer', now);
    this.answering?.stop();
    this.answering?.destroy();
    const key = pick(slotsOf(slot).filter((f) => this.scene.cache.audio.exists(f)));
    const line = this.scene.sound.add(key, { volume: channel(slot) });
    this.answering = line;
    line.once(Phaser.Sound.Events.COMPLETE, () => {
      if (this.answering === line) this.answering = null;
      line.destroy();
    });
    line.play();
  }

  /** The slot has a sound in the game. */
  has(slot: string): boolean {
    return has(this.scene, slot);
  }

  /** The side's own voice for a slot, if it has one. */
  private voiced(slot: string): string {
    return this.side && has(this.scene, this.side + slot) ? this.side + slot : slot;
  }

  stopAll(): void {
    for (const p of this.loopsOn.values()) {
      p.sound.stop();
      p.sound.destroy();
    }
    this.loopsOn.clear();
    for (const s of [this.speaking, this.answering]) {
      s?.stop();
      s?.destroy();
    }
    this.speaking = this.answering = null;
    this.waiting.length = 0;
  }
}
