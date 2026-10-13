// Player preferences, kept in localStorage (per browser). Never required: defaults apply when storage is missing.

export interface Settings {
  autosave: boolean;
  /** Minutes of game time between autosaves. */
  autosaveMinutes: number;
}

export const AUTOSAVE_CHOICES = [1, 2, 5, 10] as const;

const KEY = 'gravity-harvest:settings';
const DEFAULTS: Settings = { autosave: true, autosaveMinutes: 2 };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      autosave: typeof raw.autosave === 'boolean' ? raw.autosave : DEFAULTS.autosave,
      autosaveMinutes: AUTOSAVE_CHOICES.includes(raw.autosaveMinutes as never) ? raw.autosaveMinutes! : DEFAULTS.autosaveMinutes,
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
