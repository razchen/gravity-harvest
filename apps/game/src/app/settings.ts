// Player preferences, kept in localStorage (per browser). Never required: defaults apply when storage is missing.

export interface Settings {
  autosave: boolean;
  /** Minutes of game time between autosaves. */
  autosaveMinutes: number;
  /** All sound off (the volumes are kept for when it's back on). */
  muted: boolean;
  /** Sound effects' volume (shots, explosions, units, the interface), 0..1 (0 is off). */
  effects: number;
  /** Music's volume, 0..1 (0 is off). */
  music: number;
}

export const AUTOSAVE_CHOICES = [1, 2, 5, 10] as const;

const KEY = 'gravity-harvest:settings';
const DEFAULTS: Settings = { autosave: true, autosaveMinutes: 2, muted: false, effects: 0.8, music: 0.6 };
const level = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback);

export function loadSettings(): Settings {
  try {
    // `volume` is the one sound setting older versions kept: it becomes the effects' volume
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings> & { volume?: number };
    return {
      autosave: typeof raw.autosave === 'boolean' ? raw.autosave : DEFAULTS.autosave,
      autosaveMinutes: AUTOSAVE_CHOICES.includes(raw.autosaveMinutes as never) ? raw.autosaveMinutes! : DEFAULTS.autosaveMinutes,
      muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULTS.muted,
      effects: level(raw.effects, level(raw.volume, DEFAULTS.effects)),
      music: level(raw.music, DEFAULTS.music),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
