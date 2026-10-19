import { factionOf, unitArt } from '../data/art';
import { getCatalog } from '../systems/availability';
import { $ } from './dom';
import type { GroupView, HudBridge, SelectedUnit } from './HudBridge';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What a harvester is doing, in words. */
const ACTIVITY: Record<string, string> = { idle: 'idle', move: 'on the move', harvest: 'harvesting', wait: 'waiting to unload', unload: 'unloading' };

/** One tile of a mixed selection: every selected unit of a type. */
interface TypeTile {
  type: string;
  count: number;
  /** Average and lowest health (0 to 1). */
  avg: number;
  low: number;
  enemy: boolean;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;
/** The health bar's colour: green, then yellow below half, red below a quarter. */
const hpClass = (f: number) => (f > 0.5 ? 'ok' : f > 0.25 ? 'hurt' : 'bad');

/**
 * Bottom-centre panel: what's selected, and the control groups. One unit gets a card (name, health, cargo or
 * passengers); several get a tile per type (icon, count, health). Click a tile to keep only that type, shift-click to
 * drop it. The group buttons above select a group (twice quickly: centre on it; shift adds it). The DOM is rebuilt
 * only when what's shown changes shape (other types, another unit, other groups); health and counts update in place.
 */
export class SelectionPanel {
  private readonly root = $('#selection');
  private readonly groupsEl = $('#sel-groups');
  private readonly body = $('#sel-body');
  /** The shape last built (see refresh), and the selection version last seen. */
  private shape = '';
  private seen = -1;

  constructor(private readonly game: HudBridge) {
    this.body.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('.sel-tile');
      if (tile) game.selectType(tile.dataset.type!, e.shiftKey);
      this.refresh();
    });
    this.groupsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.sel-grp');
      if (b) game.tapGroup(Number(b.dataset.n), e.shiftKey);
      this.refresh();
    });
    // a click, a box or a group key changes the selection between the HUD's refreshes: show it straight away
    const watch = () => {
      if (!$('#hud').hidden && this.game.selectionVersion !== this.seen) this.refresh();
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  /** A new match: build afresh. */
  reset(): void {
    this.shape = '';
    this.refresh();
  }

  /** Called by the HUD's refresh loop (and on a selection change). */
  refresh(): void {
    this.seen = this.game.selectionVersion;
    const sel = this.game.selected();
    this.root.hidden = sel.length === 0;
    if (!sel.length) return;
    // only the groups the selected units are in (the keys still select any group)
    const groups = this.game.controlGroups().filter((g) => g.selected > 0);
    const tiles = sel.length > 1 ? this.tiles(sel) : [];
    const one = sel.length === 1 ? sel[0] : null;
    const shape = `${groups.map((g) => g.n).join(',')}|${one ? `${one.id}:${!!one.cargo}:${!!one.seats}` : tiles.map((t) => t.type).join(',')}`;
    if (shape !== this.shape) {
      this.shape = shape;
      this.groupsEl.innerHTML = groups.map((g) => `<button class="sel-grp" data-n="${g.n}">Group <b>${g.n}</b><span></span></button>`).join('');
      this.body.innerHTML = one ? this.cardHtml(one) : tiles.map((t) => this.tileHtml(t)).join('');
      this.body.classList.toggle('one', !!one);
    }
    this.updateGroups(groups, sel.length);
    if (one) this.updateCard(one);
    else this.updateTiles(tiles);
  }

  /** The selection by type, in the catalog's order. */
  private tiles(sel: SelectedUnit[]): TypeTile[] {
    const by = new Map<string, TypeTile & { sum: number }>();
    for (const u of sel) {
      const f = u.maxHp > 0 ? Math.max(0, u.hp / u.maxHp) : 1;
      const t = by.get(u.type) ?? { type: u.type, count: 0, avg: 0, low: 1, enemy: false, sum: 0 };
      t.count++;
      t.sum += f;
      t.low = Math.min(t.low, f);
      t.enemy ||= u.team !== 'player';
      by.set(u.type, t);
    }
    const order = Object.keys(getCatalog().units);
    const rank = (type: string) => (order.includes(type) ? order.indexOf(type) : order.length);
    return [...by.values()].map((t) => ({ ...t, avg: t.sum / t.count })).sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type));
  }

  private name(type: string): string {
    return getCatalog().units[type]?.name ?? type;
  }

  private tileHtml(t: TypeTile): string {
    const img = unitArt(t.type, factionOf(t.enemy ? 'enemy' : 'player', this.game.faction))?.card;
    return `<button class="sel-tile${t.enemy ? ' enemy' : ''}" data-type="${esc(t.type)}">` +
      (img ? `<img src="${img}" alt="">` : `<span class="sel-noimg">${esc(this.name(t.type).slice(0, 3))}</span>`) +
      '<span class="sel-count"></span><span class="sel-hp"><i></i></span></button>';
  }

  private updateTiles(tiles: TypeTile[]): void {
    for (const t of tiles) {
      const el = this.body.querySelector<HTMLElement>(`.sel-tile[data-type="${CSS.escape(t.type)}"]`);
      if (!el) continue;
      el.querySelector('.sel-count')!.textContent = t.count > 1 ? String(t.count) : '';
      const bar = el.querySelector<HTMLElement>('.sel-hp i')!;
      bar.style.width = pct(t.avg);
      bar.className = hpClass(t.low);
      el.title = `${t.enemy ? 'Enemy ' : ''}${this.name(t.type)} × ${t.count}: health ${pct(t.avg)} on average, lowest ${pct(t.low)}. ` +
        'Click to keep only these, shift-click to drop them';
    }
  }

  private cardHtml(u: SelectedUnit): string {
    const d = getCatalog().units[u.type];
    const img = unitArt(u.type, factionOf(u.team, this.game.faction))?.card;
    const row = (k: string) => `<div class="sel-row"><span>${k}</span><b class="sel-${k.toLowerCase()}"></b></div>`;
    return (img ? `<img src="${img}" alt="">` : '') +
      `<div class="sel-info"><div class="sel-name">${esc(this.name(u.type))}${u.team !== 'player' ? ' <em>Enemy</em>' : ''}</div>` +
      (d?.role ? `<div class="sel-role">${esc(d.role)}</div>` : '') +
      '<div class="sel-row"><span>Health</span><b class="sel-health"></b></div><span class="sel-hp big"><i></i></span>' +
      (u.cargo ? row('Ore') : '') + (u.seats ? row('Passengers') : '') + '</div>';
  }

  private updateCard(u: SelectedUnit): void {
    const f = u.maxHp > 0 ? Math.max(0, u.hp / u.maxHp) : 1;
    const set = (sel: string, text: string) => {
      const el = this.body.querySelector(sel);
      if (el) el.textContent = text;
    };
    set('.sel-health', `${Math.ceil(u.hp).toLocaleString()} / ${u.maxHp.toLocaleString()}`);
    const bar = this.body.querySelector<HTMLElement>('.sel-hp i')!;
    bar.style.width = pct(f);
    bar.className = hpClass(f);
    if (u.cargo) set('.sel-ore', `${Math.round(u.cargo.load).toLocaleString()} / ${u.cargo.capacity.toLocaleString()} · ${ACTIVITY[u.cargo.activity] ?? u.cargo.activity}`);
    if (u.seats) set('.sel-passengers', `${u.seats.used} / ${u.seats.total}`);
  }

  private updateGroups(groups: GroupView[], selected: number): void {
    for (const g of groups) {
      const el = this.groupsEl.querySelector<HTMLElement>(`.sel-grp[data-n="${g.n}"]`);
      if (!el) continue;
      el.querySelector('span')!.textContent = g.current ? '' : `· ${g.selected} of ${g.count}`;
      el.classList.toggle('current', g.current);
      el.classList.toggle('empty', g.count === 0);
      el.title = `${g.current ? 'This is' : `${g.selected} of the selected units are in`} group ${g.n} (${g.count} unit${g.count === 1 ? '' : 's'} on the map). Click (or ${g.n}) to select the whole group, twice quickly to centre on it, shift to add it`;
    }
    this.groupsEl.dataset.total = `${selected} selected`;
  }
}
