// The dev galleries: a card per building or unit, with faction and release filters kept in the URL
// (?faction=ordan&shared=0&v=1). Used by /dev/ (buildings) and /dev/units.html.
import { FACTIONS, MILESTONES, emblem, inFaction, type FactionScope, type Milestone } from './buildings';
import { mountPicture } from './picture';

export interface CardItem {
  faction: FactionScope;
  milestone: Milestone;
  href: string;
  /** Has its full art (stages for a building): shown bright, the others dimmed. */
  ready: boolean;
  picture?: { file: string; frame: string };
  /** High-resolution picture, used instead of the sprite frame. */
  preview?: string;
  /** The card's text, under the picture. */
  body: string;
  /** Its kind, for galleries with a kind filter (units: infantry or vehicle). */
  kind?: string;
}

type Filter = FactionScope | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ordan', label: 'Ordan' },
  { id: 'sable', label: 'Sable' },
  { id: 'both', label: 'Shared only' },
];

export const factionName = (f: FactionScope) => FACTIONS.find((x) => x.id === f)!.name;

/** The tag row every card and info page starts with: release, side, then anything else. */
export const tagsHtml = (item: { faction: FactionScope; milestone: Milestone }, ...more: string[]) =>
  `<div class="tags"><span class="tag v">V${item.milestone}</span><span class="tag ${item.faction}">${emblem(item.faction)}${factionName(item.faction)}</span>${more.filter(Boolean).map((m) => `<span class="role">${m}</span>`).join('')}</div>`;

/**
 * Put the cards in #grid and the filters in #filters. `noun` counts them ("building"). With `kinds`, there's also a
 * filter by the items' `kind` (?kind=infantry).
 */
export function mountGallery(items: CardItem[], noun: string, kinds: { id: string; name: string }[] = []): void {
  const grid = document.getElementById('grid')!;
  const bar = document.getElementById('filters')!;
  const query = new URLSearchParams(location.search);
  const asked = query.get('faction');
  let filter: Filter = FILTERS.some((f) => f.id === asked) ? (asked as Filter) : 'all';
  const askedV = Number(query.get('v'));
  let version = MILESTONES.some((m) => m.id === askedV) ? askedV : 0;
  // with one faction picked: its own only, or with the shared ones too (the default)
  let withShared = query.get('shared') !== '0';
  const askedKind = query.get('kind');
  let kind = kinds.some((k) => k.id === askedKind) ? askedKind! : '';

  const cards = items.map((item) => {
    const card = document.createElement('a');
    card.className = item.ready ? 'card' : 'card off';
    card.href = item.href;
    card.innerHTML = `<div class="pic">${item.picture ? '' : '<span class="none">No art yet</span>'}</div><div class="body">${item.body}</div>`;
    grid.append(card);
    if (item.picture) {
      mountPicture(card.querySelector<HTMLElement>('.pic')!, item.picture.file, item.picture.frame, item.preview)
        .catch(() => { card.querySelector('.pic')!.textContent = 'picture missing'; });
    }
    return { item, el: card };
  });

  const apply = () => {
    let shown = 0;
    for (const { item, el } of cards) {
      const side = filter === 'ordan' || filter === 'sable';
      const on = inFaction(item, filter) && (!side || withShared || item.faction !== 'both') && (!version || item.milestone === version) && (!kind || item.kind === kind);
      el.hidden = !on;
      if (on) shown++;
    }
    bar.innerHTML = '<span class="group">' + FILTERS.map((f) => `<button class="${f.id === filter ? 'primary' : ''}" data-f="${f.id}">${f.id === 'ordan' || f.id === 'sable' ? emblem(f.id) : ''}${f.label}</button>`).join('') + '</span>'
      + (filter === 'ordan' || filter === 'sable'
        ? `<label class="group"><input type="checkbox" id="with-shared"${withShared ? ' checked' : ''}> Include shared</label>` : '')
      + (kinds.length ? '<span class="group">' + [{ id: '', name: 'All kinds' }, ...kinds].map((k) =>
        `<button class="${k.id === kind ? 'primary' : ''}" data-k="${k.id}">${k.name}</button>`).join('') + '</span>' : '')
      + '<span class="group">' + [{ id: 0, name: 'All' }, ...MILESTONES].map((m) =>
        `<button class="${m.id === version ? 'primary' : ''}" data-v="${m.id}" title="${m.name}">${m.id ? `V${m.id}` : 'All releases'}</button>`).join('') + '</span>'
      + `<span class="count">${shown} ${noun}${shown === 1 ? '' : 's'}</span>`;
    const url = new URL(location.href);
    if (filter === 'all') url.searchParams.delete('faction');
    else url.searchParams.set('faction', filter);
    if (withShared || !(filter === 'ordan' || filter === 'sable')) url.searchParams.delete('shared');
    else url.searchParams.set('shared', '0');
    if (!kind) url.searchParams.delete('kind');
    else url.searchParams.set('kind', kind);
    if (!version) url.searchParams.delete('v');
    else url.searchParams.set('v', String(version));
    history.replaceState(null, '', url);
  };
  bar.onchange = (e) => {
    if ((e.target as HTMLElement).id !== 'with-shared') return;
    withShared = (e.target as HTMLInputElement).checked;
    apply();
  };
  bar.onclick = (e) => {
    const el = e.target as HTMLElement;
    const f = el.closest<HTMLElement>('[data-f]')?.dataset.f as Filter | undefined;
    const v = el.closest<HTMLElement>('[data-v]')?.dataset.v;
    const k = el.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (f) filter = f;
    else if (k !== undefined) kind = k;
    else if (v !== undefined) version = Number(v);
    else return;
    apply();
  };
  apply();
}
