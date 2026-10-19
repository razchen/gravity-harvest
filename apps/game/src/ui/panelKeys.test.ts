import { describe, expect, it } from 'vitest';
import { cardHotkey, panelKey, stepTab } from './panelKeys';

const key = (code: string, mods: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}, k = '') => ({
  code, key: k, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...mods,
});

describe('build panel hotkeys', () => {
  it('Tab steps to the next tab, Shift+Tab to the one before', () => {
    expect(panelKey(key('Tab', {}, 'Tab'))).toEqual({ tab: 1 });
    expect(panelKey(key('Tab', { shiftKey: true }, 'Tab'))).toEqual({ tab: -1 });
    expect(panelKey(key('Tab', { ctrlKey: true }, 'Tab'))).toBeNull(); // the browser's tab switching
    expect(panelKey(key('Tab', { altKey: true }, 'Tab'))).toBeNull();
  });

  it('Alt+1 … Alt+9 and Alt+0 press the 1st … 10th card, top row or keypad, whatever character Alt types', () => {
    expect(panelKey(key('Digit1', { altKey: true }, '¡'))).toEqual({ card: 0, shift: false });
    expect(panelKey(key('Digit9', { altKey: true }, 'ª'))).toEqual({ card: 8, shift: false });
    expect(panelKey(key('Digit0', { altKey: true }, 'º'))).toEqual({ card: 9, shift: false });
    expect(panelKey(key('Numpad3', { altKey: true }))).toEqual({ card: 2, shift: false });
    expect(panelKey(key('Digit2', { altKey: true, shiftKey: true }, '€'))).toEqual({ card: 1, shift: true });
  });

  it('leaves plain digits (control groups) and Ctrl / Cmd + digit (saving one) alone', () => {
    expect(panelKey(key('Digit1', {}, '1'))).toBeNull();
    expect(panelKey(key('Digit1', { shiftKey: true }, '!'))).toBeNull();
    expect(panelKey(key('Digit1', { ctrlKey: true }, '1'))).toBeNull();
    expect(panelKey(key('Digit1', { metaKey: true }, '1'))).toBeNull();
    expect(panelKey(key('Digit1', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(panelKey(key('KeyA', { altKey: true }, 'å'))).toBeNull();
  });

  it('tabs wrap round both ways', () => {
    const tabs = ['build', 'units', 'defense'];
    expect(stepTab(tabs, 'build', 1)).toBe('units');
    expect(stepTab(tabs, 'defense', 1)).toBe('build');
    expect(stepTab(tabs, 'build', -1)).toBe('defense');
  });

  it('labels the first ten cards', () => {
    expect(cardHotkey(0, true)).toBe('⌥1');
    expect(cardHotkey(9, true)).toBe('⌥0');
    expect(cardHotkey(4, false)).toBe('Alt+5');
    expect(cardHotkey(10, false)).toBeNull();
  });
});
