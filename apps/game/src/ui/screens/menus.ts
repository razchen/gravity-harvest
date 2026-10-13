import type { PlayableFaction } from '@gravity-harvest/shared';
import { AUTOSAVE_CHOICES } from '../../app/settings';
import { button, el, fmtDate, fmtTime, screenPanel } from './kit';
import type { Screens } from './Screens';

/** Title screen: New Game, Continue (latest save), Load Game, Settings, Controls. */
export function mainMenu(s: Screens): HTMLElement {
  const a = s.actions;
  const cont = button('Continue', () => a.continueGame(), 'menu-btn', true);
  const contSub = el('div', { className: 'menu-sub', textContent: 'Checking saves…' });
  const wrap = el('div', { className: 'title-screen' },
    el('img', { className: 'logo', src: 'assets/ui/logo.webp', alt: 'Gravity Harvest', draggable: false }),
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

/** Pick your side and a scenario, and start. The side you pick is remembered for next time. */
export function newGameScreen(s: Screens): HTMLElement {
  const a = s.actions;
  const list = el('div', { className: 'scenario-list' });
  const first = a.scenarios()[0];
  let picked: PlayableFaction | undefined;
  try { picked = (localStorage.getItem(FACTION_KEY) as PlayableFaction | null) ?? undefined; } catch { /* not kept */ }
  if (first && !first.factions.some((f) => f.id === picked)) picked = first.defaultFaction;
  if (first) {
    const sides = el('div', { className: 'faction-pick' });
    const draw = () => {
      sides.replaceChildren(...first.factions.map((f) => {
        const b = el('button', { className: `faction-card ${f.id}${f.id === picked ? ' on' : ''}` },
          el('img', { src: `assets/ui/factions/${f.id}_small.png`, alt: '' }),
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
    list.append(el('div', { className: 'faction-label', textContent: 'Your side' }), sides, el('div', { className: 'faction-label', textContent: 'Scenario' }));
  }
  if (!a.scenarios().length) list.append(el('div', { className: 'empty', textContent: 'The game server is offline. Start it with npm run dev.' }));
  for (const sc of a.scenarios()) {
    list.append(el('div', { className: 'scenario-card' },
      el('div', { className: 'scenario-info' },
        el('div', { className: 'scenario-name', textContent: sc.name }),
        el('div', { className: 'scenario-desc', textContent: sc.description }),
        el('div', { className: 'scenario-meta', textContent: `${sc.map.width} × ${sc.map.height} map · 1 vs 1 · $${sc.startingCredits.toLocaleString()} starting credits` })),
      button('Start', () => a.newGame(sc.id, picked), 'menu-btn primary')));
  }
  return screenPanel('New Game', list, el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}

/** In-game menu (the match is paused while it's open). */
export function pauseMenu(s: Screens): HTMLElement {
  const a = s.actions;
  return screenPanel('Paused',
    el('div', { className: 'menu-col' },
      button('Resume', () => a.resume(), 'menu-btn primary'),
      button('Save Game', () => s.show('save')),
      button('Load Game', () => s.show('load')),
      button('Settings', () => s.show('settings')),
      button('Controls', () => a.showHelp()),
      button('Quit to Main Menu', () => a.quitToMenu(), 'menu-btn ghost')),
    el('div', { className: 'menu-hint', textContent: 'Esc resumes' }));
}

export function settingsScreen(s: Screens): HTMLElement {
  const a = s.actions;
  const cur = a.settings();
  const toggle = el('input', { type: 'checkbox', checked: cur.autosave, id: 'set-autosave' });
  const every = el('select', { id: 'set-autosave-min', disabled: !cur.autosave });
  for (const m of AUTOSAVE_CHOICES) every.append(el('option', { value: String(m), textContent: `Every ${m} minute${m > 1 ? 's' : ''}`, selected: m === cur.autosaveMinutes }));
  const apply = () => {
    every.disabled = !toggle.checked;
    a.updateSettings({ autosave: toggle.checked, autosaveMinutes: Number(every.value) });
  };
  toggle.addEventListener('change', apply);
  every.addEventListener('change', apply);
  return screenPanel('Settings',
    el('div', { className: 'settings-grid' },
      el('label', { htmlFor: 'set-autosave', className: 'setting-label', textContent: 'Autosave' }), toggle,
      el('label', { htmlFor: 'set-autosave-min', className: 'setting-label', textContent: 'Frequency' }), every,
      el('div', { className: 'setting-note', textContent: 'Autosave keeps one slot per map, counted in game time, and also saves when you quit to the menu or leave the tab.' })),
    el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}
