import { SAVE_LIMITS } from '@gravity-harvest/shared';
import type { SaveGameSummary } from '../../save/SaveApi';
import { button, el, fmtDate, fmtTime, screenPanel } from './kit';
import type { Screens } from './Screens';

function saveRow(save: SaveGameSummary, ...actions: HTMLElement[]): HTMLElement {
  const thumb = save.thumbnail
    ? el('img', { className: 'save-thumb', src: save.thumbnail, alt: '' })
    : el('div', { className: 'save-thumb empty-thumb' });
  return el('div', { className: 'save-row' }, thumb,
    el('div', { className: 'save-info' },
      el('div', { className: 'save-name' }, save.name, save.kind === 'auto' ? el('span', { className: 'badge-auto', textContent: 'AUTO' }) : null),
      el('div', { className: 'save-meta', textContent: `${fmtTime(save.gameTimeMs)} played · ${fmtDate(save.updatedAt)}` })),
    el('div', { className: 'save-actions' }, ...actions));
}

function listInto(box: HTMLElement, s: Screens, filter: (x: SaveGameSummary) => boolean, row: (x: SaveGameSummary) => HTMLElement,
  emptyText: string): void {
  box.replaceChildren(el('div', { className: 'empty', textContent: 'Loading…' }));
  s.actions.listSaves().then((saves) => {
    const shown = saves.filter(filter);
    box.replaceChildren(...(shown.length ? shown.map(row) : [el('div', { className: 'empty', textContent: emptyText })]));
  }).catch((err: Error) => {
    box.replaceChildren(el('div', { className: 'empty', textContent: `Save server unavailable (${err.message}). Start it with npm run dev.` }));
  });
}

function confirmDelete(s: Screens, save: SaveGameSummary, refresh: () => void): () => void {
  return () => {
    if (!window.confirm(`Delete "${save.name}"?`)) return;
    s.actions.deleteSave(save.id).then(refresh).catch(() => refresh());
  };
}

/** All saves, newest first, autosaves marked. */
export function loadScreen(s: Screens): HTMLElement {
  const box = el('div', { className: 'save-list', id: 'save-list' });
  const refresh = () => listInto(box, s, () => true, (save) => saveRow(save,
    button('Load', () => s.actions.loadSave(save.id), 'menu-btn primary small'),
    button('Delete', confirmDelete(s, save, refresh), 'menu-btn ghost small')), 'No saved games yet.');
  refresh();
  return screenPanel('Load Game', box, el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}

/** Save as a new slot, or overwrite one of your manual saves. */
export function saveScreen(s: Screens): HTMLElement {
  const name = el('input', { id: 'save-name', maxLength: SAVE_LIMITS.nameMax, autocomplete: 'off', placeholder: 'Save name', autofocus: true });
  name.value = `Skirmish · ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
  const status = el('div', { className: 'save-status' });
  const box = el('div', { className: 'save-list', id: 'save-list' });
  const doSave = (overwrite?: SaveGameSummary) => {
    const n = overwrite?.name ?? name.value.trim();
    if (!n) return void (status.textContent = 'Give the save a name');
    if (overwrite && !window.confirm(`Overwrite "${overwrite.name}"?`)) return;
    status.textContent = 'Saving…';
    s.actions.saveGame(n, overwrite?.id).then(() => {
      status.textContent = `Saved "${n}"`;
      refresh();
    }).catch((err: Error) => (status.textContent = `Save failed: ${err.message}`));
  };
  const refresh = () => listInto(box, s, (x) => x.kind !== 'auto', (save) => saveRow(save,
    button('Overwrite', () => doSave(save), 'menu-btn small'),
    button('Delete', confirmDelete(s, save, refresh), 'menu-btn ghost small')), 'No manual saves yet.');
  const form = el('form', { id: 'save-form', className: 'save-form' }, name, el('button', { type: 'submit', className: 'menu-btn primary', textContent: 'Save' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    doSave();
  });
  refresh();
  return screenPanel('Save Game', form, status, box, el('div', { className: 'screen-actions' }, button('Back', () => s.back(), 'menu-btn ghost')));
}
