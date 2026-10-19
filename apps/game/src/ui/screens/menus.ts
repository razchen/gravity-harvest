import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty, type PlayableFaction } from '@gravity-harvest/shared';
import { AUTOSAVE_CHOICES } from '../../app/settings';
import { assetUrl } from '../../assets/url';
import { button, el, fmtDate, fmtTime, screenPanel } from './kit';
import type { Screens } from './Screens';

/** Title screen: New Game, Continue (latest save), Load Game, Settings, Controls. */
export function mainMenu(s: Screens): HTMLElement {
  const a = s.actions;
  const cont = button('Continue', () => a.continueGame(), 'menu-btn', true);
  const contSub = el('div', { className: 'menu-sub', textContent: 'Checking saves…' });
  const wrap = el('div', { className: 'title-screen' },
    el('img', { className: 'logo', src: assetUrl('assets/ui/logo.webp'), alt: 'Gravity Harvest', draggable: false }),
    el('div', { className: 'menu-col panel' },
      button('New Game', () => s.show('newGame'), 'menu-btn primary'),
      el('div', { className: 'menu-pair' }, cont, contSub),
      button('Load Game', () => s.show('load')),
      button('Settings', () => s.show('settings')),
      button('Controls', () => a.showHelp())),
  );
  a.latestSave().then((latest) => {
    if (latest) {
      cont.disabled = false;
      contSub.textContent = `${latest.name} · ${fmtTime(latest.gameTimeMs)} · ${fmtDate(latest.updatedAt)}`;
    } else contSub.textContent = 'No saved games yet';
  }).catch(() => (contSub.textContent = 'Save server offline'));
  return wrap;
}

const FACTION_KEY = 'gh-faction';
const DIFFICULTY_KEY = 'gh-difficulty';

/** How each difficulty plays: every level has the same rules and income and sees only what you'd see. */
const DIFFICULTY_TEXT: Record<Difficulty, { name: string; hint: string }> = {
  easy: { name: 'Easy', hint: 'Slow to react, forgets to build and attacks carelessly.' },
  normal: { name: 'Normal', hint: 'A steady opponent that makes the odd mistake.' },
  hard: { name: 'Hard', hint: 'Quick, careful and economical. Few mistakes.' },
};
export const difficultyName = (d: Difficulty): string => DIFFICULTY_TEXT[d].name;

/** Pick your side and a scenario, and start. The side you pick is remembered for next time. */
export function newGameScreen(s: Screens): HTMLElement {
  const a = s.actions;
  const list = el('div', { className: 'scenario-list' });
  const first = a.scenarios()[0];
  let picked: PlayableFaction | undefined;
  try { picked = (localStorage.getItem(FACTION_KEY) as PlayableFaction | null) ?? undefined; } catch { /* not kept */ }
  if (first && !first.factions.some((f) => f.id === picked)) picked = first.defaultFaction;
  let level: Difficulty = DEFAULT_DIFFICULTY;
  try {
    const kept = localStorage.getItem(DIFFICULTY_KEY) as Difficulty | null;
    if (kept && DIFFICULTIES.includes(kept)) level = kept;
  } catch { /* not kept */ }
  if (first) {
    const sides = el('div', { className: 'faction-pick' });
    const draw = () => {
      sides.replaceChildren(...first.factions.map((f) => {
        const b = el('button', { className: `faction-card ${f.id}${f.id === picked ? ' on' : ''}` },
          el('img', { src: assetUrl(`assets/ui/factions/${f.id}_small.png`), alt: '' }),
          el('div', { className: 'faction-text' },
            el('div', { className: 'faction-name', textContent: f.name }),
            el('div', { className: 'faction-tagline', textContent: f.tagline })));
        b.addEventListener('click', () => {
          picked = f.id;
          try { localStorage.setItem(FACTION_KEY, f.id); } catch { /* not kept */ }
          draw();
        });
        return b;
      }));
    };
    draw();
    const levels = el('div', { className: 'difficulty-pick' });
    const hint = el('div', { className: 'difficulty-hint' });
    const drawLevels = () => {
      levels.replaceChildren(...DIFFICULTIES.map((d) => {
        const b = el('button', { type: 'button', className: `difficulty-card${d === level ? ' on' : ''}`, textContent: DIFFICULTY_TEXT[d].name });
        b.dataset.difficulty = d;
        b.addEventListener('click', () => {
          level = d;
          try { localStorage.setItem(DIFFICULTY_KEY, d); } catch { /* not kept */ }
          drawLevels();
        });
        return b;
      }));
      hint.textContent = DIFFICULTY_TEXT[level].hint;
    };
    drawLevels();
    list.append(el('div', { className: 'faction-label', textContent: 'Your side' }), sides,
      el('div', { className: 'faction-label', textContent: 'Opponent' }), levels, hint,
      el('div', { className: 'faction-label', textContent: 'Scenario' }));
  }
  if (!a.scenarios().length) list.append(el('div', { className: 'empty', textContent: 'The game server is offline. Start it with npm run dev.' }));
  for (const sc of a.scenarios()) {
    list.append(el('div', { className: 'scenario-card' },
      el('div', { className: 'scenario-info' },
        el('div', { className: 'scenario-name', textContent: sc.name }),
        el('div', { className: 'scenario-desc', textContent: sc.description }),
        el('div', { className: 'scenario-meta', textContent: `${sc.map.width} × ${sc.map.height} map · 1 vs 1 · $${sc.startingCredits.toLocaleString()} starting credits` })),
      button('Start', () => a.newGame(sc.id, picked, level), 'menu-btn primary')));
  }
  return screenPanel('New Game', list, el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}

/** In-game menu (the match is paused while it's open). */
export function pauseMenu(s: Screens): HTMLElement {
  const a = s.actions;
  const level = a.difficulty();
  return screenPanel('Paused',
    el('div', { className: 'menu-col' },
      button('Resume', () => a.resume(), 'menu-btn primary'),
      button('Save Game', () => s.show('save')),
      button('Load Game', () => s.show('load')),
      button('Settings', () => s.show('settings')),
      button('Controls', () => a.showHelp()),
      button('Quit to Main Menu', () => a.quitToMenu(), 'menu-btn ghost')),
    el('div', { className: 'menu-hint', textContent: `${level ? `Opponent: ${difficultyName(level)} · ` : ''}Esc resumes` }));
}

export function settingsScreen(s: Screens): HTMLElement {
  const a = s.actions;
  const cur = a.settings();
  const toggle = el('input', { type: 'checkbox', checked: cur.autosave, id: 'set-autosave' });
  const every = el('select', { id: 'set-autosave-min', disabled: !cur.autosave });
  for (const m of AUTOSAVE_CHOICES) every.append(el('option', { value: String(m), textContent: `Every ${m} minute${m > 1 ? 's' : ''}`, selected: m === cur.autosaveMinutes }));
  const mute = el('input', { type: 'checkbox', checked: cur.muted, id: 'set-mute' });
  const slider = (id: string, v: number) => {
    const range = el('input', { type: 'range', id, min: '0', max: '100', step: '5', value: String(Math.round(v * 100)) });
    const text = el('span', { className: 'setting-value' });
    return { range, text, row: el('div', { className: 'setting-range' }, range, text) };
  };
  const effects = slider('set-effects', cur.effects);
  const music = slider('set-music', cur.music);
  const apply = () => {
    every.disabled = !toggle.checked;
    for (const sl of [effects, music]) {
      const v = Number(sl.range.value);
      sl.text.textContent = v ? `${v}%` : 'Off';
      sl.range.disabled = mute.checked;
    }
    a.updateSettings({
      autosave: toggle.checked, autosaveMinutes: Number(every.value),
      muted: mute.checked, effects: Number(effects.range.value) / 100, music: Number(music.range.value) / 100,
    });
  };
  for (const c of [toggle, every, mute]) c.addEventListener('change', apply);
  for (const sl of [effects, music]) sl.range.addEventListener('input', apply);
  apply();
  return screenPanel('Settings',
    el('div', { className: 'settings-grid' },
      el('label', { htmlFor: 'set-mute', className: 'setting-label', textContent: 'Mute' }), mute,
      el('label', { htmlFor: 'set-effects', className: 'setting-label', textContent: 'Effects' }), effects.row,
      el('label', { htmlFor: 'set-music', className: 'setting-label', textContent: 'Music' }), music.row,
      el('label', { htmlFor: 'set-autosave', className: 'setting-label', textContent: 'Autosave' }), toggle,
      el('label', { htmlFor: 'set-autosave-min', className: 'setting-label', textContent: 'Frequency' }), every,
      el('div', { className: 'setting-note', textContent: 'Autosave keeps one slot per map, counted in game time, and also saves when you quit to the menu or leave the tab.' })),
    el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}
