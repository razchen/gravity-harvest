import { button, el, fmtTime } from './kit';
import type { Screens } from './Screens';

/** Victory / defeat: result, match stats, and where to go next. */
export function gameOverScreen(s: Screens): HTMLElement {
  const go = s.ctx.gameOver;
  const victory = go?.result === 'victory';
  const st = go?.stats;
  const stat = (label: string, value: string) =>
    el('div', { className: 'stat' }, el('div', { className: 'stat-value', textContent: value }), el('div', { className: 'stat-label', textContent: label }));
  return el('div', { className: `gameover ${victory ? 'victory' : 'defeat'}` },
    el('div', { className: 'gameover-title', textContent: victory ? 'VICTORY' : 'DEFEAT' }),
    el('div', { className: 'gameover-sub', textContent: victory ? 'Every enemy structure has been destroyed.' : 'Your base has fallen.' }),
    st ? el('div', { className: 'stats panel' },
      stat('Time', fmtTime(st.gameTimeMs)),
      stat('Credits earned', `$${st.creditsEarned.toLocaleString()}`),
      stat('Units destroyed', String(st.unitsKilled)),
      stat('Units lost', String(st.unitsLost)),
      stat('Structures destroyed', String(st.buildingsDestroyed)),
      stat('Structures built', String(st.buildingsBuilt)),
      stat('Structures lost', String(st.buildingsLost))) : null,
    el('div', { className: 'gameover-actions' },
      button('Play Again', () => s.actions.restart(), 'menu-btn primary'),
      button('Load Game', () => s.show('load')),
      button('Main Menu', () => s.actions.quitToMenu(), 'menu-btn ghost')));
}
