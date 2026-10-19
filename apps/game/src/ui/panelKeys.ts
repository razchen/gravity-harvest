/**
 * Build panel hotkeys: Tab / Shift+Tab step through its tabs, Alt+1 … Alt+9 and Alt+0 press the 1st … 10th card of the
 * tab shown (Alt+Shift as a shift-click). Read from `e.code`, not `e.key`: on macOS Alt (Option) + a digit types a
 * special character. Plain digits are control groups and Ctrl / Cmd + digit saves one, so those are left alone.
 */
export type PanelKey = { tab: 1 | -1 } | { card: number; shift: boolean };

type Keys = Pick<KeyboardEvent, 'code' | 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;

/** What a key press does to the build panel, if anything. `card` counts from 0. */
export function panelKey(e: Keys): PanelKey | null {
  if (e.ctrlKey || e.metaKey) return null;
  if (e.key === 'Tab' || e.code === 'Tab') return e.altKey ? null : { tab: e.shiftKey ? -1 : 1 };
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (!m || !e.altKey) return null;
  const n = Number(m[1]);
  return { card: n === 0 ? 9 : n - 1, shift: e.shiftKey };
}

/** The tab after (or before) `current`, wrapping round. */
export function stepTab<T>(tabs: readonly T[], current: T, dir: 1 | -1): T {
  const i = tabs.indexOf(current);
  return tabs[(((i < 0 ? 0 : i) + dir) % tabs.length + tabs.length) % tabs.length];
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The hotkey of the card at `index` (from 0), as shown on it: "⌥1" on a Mac, "Alt+1" elsewhere; none past the 10th. */
export function cardHotkey(index: number, mac = IS_MAC): string | null {
  if (index < 0 || index > 9) return null;
  const digit = String((index + 1) % 10);
  return mac ? `⌥${digit}` : `Alt+${digit}`;
}
