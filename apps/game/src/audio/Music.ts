/**
 * The game's music (tools/audio/pack_music.py: assets/music, music.json lists the tracks): the menu's track on the
 * menus, the match tracks one after another in a shuffled order during a match, and the player's side's victory or
 * defeat sting (once) when a match ends. Tracks are streamed (an <audio> element
 * each, nothing loaded up front) and crossfade into each other; the Music volume and Mute (Settings) apply at once.
 * Browsers keep a page quiet until it's been used, so it starts on the first click or key if it couldn't before.
 */
import { assetUrl } from '../assets/url';

type Use = 'menu' | 'match' | 'victory' | 'defeat';
type Side = 'ordan' | 'sable';
/** The sets played once, straight in (no fade-in), and then silence. */
const STINGS: ReadonlySet<Use> = new Set(['victory', 'defeat']);

interface Track {
  file: string;
  title: string;
  use: Use;
  /** A sting's side (none: for both). */
  side?: Side;
  seconds: number;
}

const DIR = assetUrl('assets/music/');
/** How long one track fades into the next, or into the other set (menu / match), in ms. */
const FADE_MS = 3000;
/** How often the fades step, in ms. */
const STEP_MS = 50;

/** Ogg where the browser plays it, mp3 elsewhere. */
const EXT = typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';

interface Playing {
  el: HTMLAudioElement;
  track: Track;
  /** 0..1: how far faded in. */
  level: number;
  /** Where it's fading to (0: out, then gone). */
  to: number;
}

/** Read-only state for the Dev info panel (ui/DevInfo.ts). */
export interface MusicStats {
  use: Use | null;
  /** Tracks known (music.json), in all sets. */
  tracks: number;
  volume: number;
  muted: boolean;
  /** Waiting for the page's first click or key to start. */
  waiting: boolean;
  /** Fading in, playing or fading out (the last one is the current track). */
  playing: { title: string; file: string; seconds: number; length: number; level: number; to: number; paused: boolean }[];
  /** What plays next, in order (empty: the set reshuffles). */
  queue: string[];
}

export class Music {
  private tracks: Track[] = [];
  private use: Use | null = null;
  private side: Side = 'ordan';
  private queue: Track[] = [];
  private playing: Playing[] = [];
  private volume = 1;
  private muted = false;
  private waiting = false;

  constructor() {
    void fetch(`${DIR}music.json`).then((r) => r.json()).then((j: { tracks: Track[] }) => {
      this.tracks = j.tracks;
      if (this.use) this.next();
    }).catch(() => { /* no music: the game plays without it */ });
    window.setInterval(() => this.step(), STEP_MS);
  }

  /** The menu's music, the match's or a sting (`side`: whose; null: none). Changing over crossfades. */
  set(use: Use | null, side: Side = 'ordan'): void {
    if (use === this.use && side === this.side) return;
    this.use = use;
    this.side = side;
    this.queue = [];
    for (const p of this.playing) p.to = 0;
    if (use) this.next();
  }

  /** The player's Music volume (0..1) and Mute. */
  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.apply();
  }

  /** Start the set's next track, fading in (and the one before it out). */
  private next(): void {
    if (!this.use || !this.tracks.length) return;
    const sting = STINGS.has(this.use);
    const set = this.tracks.filter((t) => t.use === this.use && (!t.side || t.side === this.side));
    if (!this.queue.length) {
      if (sting && this.playing.some((p) => p.to > 0)) return; // a sting plays once
      this.queue = set.sort(() => Math.random() - 0.5).slice(0, sting ? 1 : undefined);
    }
    const t = this.queue.shift();
    if (!t) return;
    for (const p of this.playing) p.to = 0;
    const el = new Audio(`${DIR}${t.file}.${EXT}`);
    el.preload = 'auto';
    // a set with one track (the menu's) loops it; otherwise the next one takes over as this one ends
    el.loop = !sting && set.length === 1;
    el.addEventListener('timeupdate', () => {
      if (!el.loop && el.duration && el.duration - el.currentTime < FADE_MS / 1000 && this.playing.at(-1)?.el === el) this.next();
    });
    el.addEventListener('ended', () => {
      if (sting) {
        for (const p of this.playing) if (p.el === el) p.to = 0;
      } else if (this.playing.at(-1)?.el === el) this.next();
    });
    this.playing.push({ el, track: t, level: sting ? 1 : 0, to: 1 });
    this.start(el);
  }

  /** Play it, or wait for the page's first click or key if the browser won't yet. */
  private start(el: HTMLAudioElement): void {
    el.volume = 0;
    el.play().catch(() => {
      if (this.waiting) return;
      this.waiting = true;
      const go = () => {
        this.waiting = false;
        for (const p of this.playing) if (p.to > 0) void p.el.play().catch(() => undefined);
      };
      window.addEventListener('pointerdown', go, { once: true });
      window.addEventListener('keydown', go, { once: true });
    });
  }

  stats(): MusicStats {
    return {
      use: this.use, tracks: this.tracks.length, volume: this.volume, muted: this.muted, waiting: this.waiting,
      playing: this.playing.map((p) => ({
        title: p.track.title, file: p.track.file, seconds: p.el.currentTime, length: p.el.duration || p.track.seconds,
        level: p.level, to: p.to, paused: p.el.paused,
      })),
      queue: this.queue.map((t) => t.title),
    };
  }

  private step(): void {
    const k = STEP_MS / FADE_MS;
    for (const p of this.playing) p.level = p.to > p.level ? Math.min(p.to, p.level + k) : Math.max(p.to, p.level - k);
    for (const p of this.playing.filter((x) => x.to === 0 && x.level === 0)) {
      p.el.pause();
      p.el.removeAttribute('src');
      p.el.load();
    }
    this.playing = this.playing.filter((x) => x.to > 0 || x.level > 0);
    this.apply();
  }

  private apply(): void {
    for (const p of this.playing) p.el.volume = this.muted ? 0 : Math.min(1, this.volume * p.level);
  }
}
