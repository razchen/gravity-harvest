import { assetUrl } from '../assets/url';
import { BUILDING_ART, UNIT_ART, unitArt } from '../data/art';
import { inGame } from '../input/InputController';
import { getCatalog, missingFor } from '../systems/availability';
import { $, $$ } from './dom';
import type { HudBridge } from './HudBridge';
import { cardHotkey, panelKey, stepTab } from './panelKeys';
import type { Toast } from './Toast';

export type Tab = 'build' | 'units' | 'defense';

interface Card {
  id: string;
  name: string;
  price: number;
  img: string;
  sub: string;
  action: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Right-hand panel: tabs and build / unit cards for the match roster. Names and prices come from the catalog the
 * server sends; cards for things whose prerequisites aren't met are locked. Right-click a unit card to cancel
 * one from the queue. Each card's i opens its info card: what it does, its numbers, what it needs and unlocks.
 * Keys (panelKeys.ts): Tab / Shift+Tab step through the tabs, Alt+1 … Alt+0 press the tab's first ten cards.
 */
export class BuildPanel {
  private tab: Tab = 'build';
  private cards: Card[] = [];
  private readonly box = $('#cards');
  private readonly info = $('#info-card');
  private infoFor: string | null = null;

  constructor(private readonly game: HudBridge, private readonly toast: Toast) {
    for (const b of $$('[data-tab]')) {
      b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab));
    }
    // sell / repair modes: each button toggles its mode
    const modes = { sell: $('#btn-sell'), repair: $('#btn-repair') };
    for (const [m, btn] of Object.entries(modes) as ['sell' | 'repair', HTMLElement][]) {
      btn.addEventListener('click', () => this.game.setMode(this.game.mode === m ? null : m));
    }
    game.bus.on('mode', (m) => {
      for (const [k, btn] of Object.entries(modes)) btn.classList.toggle('active', k === m);
      if (m === 'sell') this.toast.show('Sell: click a building (one under construction is cancelled, all of it refunded). Right-click to stop');
      else if (m === 'repair') this.toast.show('Repair: click a damaged building; click again to stop. Right-click to stop');
    });
    this.info.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.close')) this.closeInfo();
    });
    // a click anywhere else closes it
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.infoFor && !t.closest('#info-card') && !t.closest('.card .info')) this.closeInfo();
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  /** Tab / Shift+Tab: the next or previous tab. Alt+number: that card, just as a click on it (Alt+Shift: a shift-click). */
  private onKey(e: KeyboardEvent): void {
    const k = panelKey(e);
    if (!k || !inGame() || !$('#help').hidden || $('#hud').hidden) return;
    e.preventDefault(); // Tab would move the browser's focus; Alt+digit types a character on macOS
    if ('tab' in k) return this.setTab(stepTab($$('[data-tab]').map((b) => b.dataset.tab as Tab), this.tab, k.tab));
    if (e.repeat) return;
    $$('.card', this.box)[k.card]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: k.shift }));
  }

  /** Rebuild the cards (a new match may have a different roster). */
  reset(): void {
    this.render();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const b of $$('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
    this.render();
  }

  private buildCards(): Card[] {
    if (this.tab === 'build' || this.tab === 'defense') {
      const defense = this.tab === 'defense';
      return Object.values(getCatalog().buildings).filter((d) => BUILDING_ART[d.id] && d.defense === defense).map((d) => {
        const id = d.id;
        return { id, name: d.name, price: d.cost, img: BUILDING_ART[id].card, sub: `${d.power > 0 ? '+' : ''}${d.power} power`, action: () => this.place(id) };
      });
    }
    if (this.tab === 'units') {
      return Object.values(getCatalog().units).filter((d) => UNIT_ART[d.id]).map((d) => {
        const id = d.id;
        return { id, name: d.name, price: d.cost, img: unitArt(id, this.game.faction)!.card, sub: `${d.buildTimeSec}s`, action: () => this.buy(id) };
      });
    }
    return [];
  }

  private render(): void {
    this.box.innerHTML = '';
    this.cards = this.buildCards();
    if (this.infoFor) this.closeInfo();
    if (!this.cards.length) {
      this.box.innerHTML = '<div class="empty">Nothing here yet.</div>';
      return;
    }
    for (const c of this.cards) {
      const el = document.createElement('button');
      el.className = 'card';
      el.dataset.id = c.id;
      const hotkey = cardHotkey(this.cards.indexOf(c));
      if (hotkey) el.dataset.hotkey = hotkey;
      el.innerHTML = `<img src="${assetUrl(c.img)}" alt=""><div class="name">${c.name}</div>` +
        (hotkey ? `<span class="hotkey" aria-hidden="true">${hotkey}</span>` : '') +
        `<div class="price">$${c.price.toLocaleString()}</div><div class="sub">${c.sub}</div>` +
        '<div class="queue-count"></div><div class="queue-bar"></div>' +
        (this.tab === 'units' ? `<span class="cancel" role="button" tabindex="-1" title="Cancel one (all of its price back)" aria-label="Cancel one ${esc(c.name)}">×</span>` : '') +
        `<span class="info" role="button" tabindex="-1" title="What it does" aria-label="About the ${esc(c.name)}">i</span>`;
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.info')) {
          e.stopPropagation();
          this.toggleInfo(c.id);
          return;
        }
        if ((e.target as HTMLElement).closest('.cancel')) {
          e.stopPropagation();
          this.game.cancelUnit(c.id);
          return;
        }
        c.action();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.tab === 'units') this.game.cancelUnit(c.id);
      });
      this.box.appendChild(el);
    }
    this.refresh();
  }

  private toggleInfo(id: string): void {
    if (this.infoFor === id) return this.closeInfo();
    this.infoFor = id;
    this.info.innerHTML = this.infoHtml(id);
    this.info.hidden = false;
    for (const el of $$('.card', this.box)) el.classList.toggle('showing-info', el.dataset.id === id);
  }

  private closeInfo(): void {
    this.infoFor = null;
    this.info.hidden = true;
    for (const el of $$('.card', this.box)) el.classList.remove('showing-info');
  }

  /** A building's or unit's info card, from the catalog the server sent. */
  private infoHtml(id: string): string {
    const cat = getCatalog();
    const name = (x: string) => esc(cat.names[x] ?? cat.buildings[x]?.name ?? cat.units[x]?.name ?? x);
    const list = (xs: string[]) => xs.map(name).join(', ');
    const row = (k: string, v: string) => (v ? `<div class="row"><span>${k}</span><b>${v}</b></div>` : '');
    const b = cat.buildings[id];
    const u = cat.units[id];
    const d = b ?? u!;
    const img = b ? BUILDING_ART[id]?.card : unitArt(id, this.game.faction)?.card;
    let rows = row('Cost', `$${d.cost.toLocaleString()}`) + row('Build time', `${+d.buildTimeSec.toFixed(1)} s`) + row('Health', d.hp.toLocaleString());
    if (b) {
      rows += row('Power', b.power > 0 ? `+${b.power} (makes)` : b.power < 0 ? `${b.power} (uses)` : '');
      rows += row('Needs', list(b.prerequisites));
      const unlocks = Object.values(cat.buildings).filter((x) => x.prerequisites.includes(id)).map((x) => x.id);
      const trains = Object.values(cat.units).filter((x) => x.producedAt.includes(id)).map((x) => x.id);
      const enables = Object.values(cat.units).filter((x) => x.prerequisites.some((alts) => alts.includes(id))).map((x) => x.id);
      rows += row('Trains', list(trains)) + row('Unlocks', list([...unlocks, ...enables.filter((x) => !trains.includes(x))]));
    } else if (u) {
      rows += row('Built at', u.producedAt.map(name).join(' or ')) + row('Needs', u.prerequisites.map((alts) => alts.map(name).join(' or ')).join(', '));
    }
    return `<button class="close" title="Close" aria-label="Close">×</button>
      <div class="head">${img ? `<img src="${img}" alt="">` : ''}<div><h3>${esc(d.name)}</h3>${d.role ? `<div class="role">${esc(d.role)}</div>` : ''}</div></div>
      ${d.description ? `<p>${esc(d.description)}</p>` : ''}
      <div class="rows">${rows}</div>`;
  }

  private place(id: string): void {
    const d = getCatalog().buildings[id];
    const needs = missingFor(id, this.game.ownedTypes());
    if (needs) return this.toast.show(`Build a ${needs} first`, 'needPrerequisite');
    const r = this.game.startPlacement(id);
    if (r === 'poor') this.toast.show(`Need $${(d.cost - this.game.credits()).toLocaleString()} more`, 'needCredits');
    else if (r !== 'ok') this.toast.show(r.text, r.code);
    else this.toast.show(`Place the ${d.name}: left-click to build, right-click or Esc to cancel`);
  }

  private buy(id: string): void {
    const d = getCatalog().units[id];
    const r = this.game.buyUnit(id);
    if (r === 'poor') this.toast.show(`Need $${(d.cost - this.game.credits()).toLocaleString()} more`, 'needCredits');
    else if (r === 'cap') this.toast.show('Unit cap reached', 'unitCap');
    else if (r === 'queue') this.toast.show('Production queue is full', 'queueFull');
    else if (typeof r === 'object') this.toast.show(`Build a ${r.needs} first`, 'needPrerequisite');
    else this.toast.show(`${d.name} queued`);
  }

  /** Affordability, locks, the card being placed, and the production queue. */
  refresh(): void {
    const credits = this.game.credits();
    const placing = this.game.placingType();
    const owned = this.game.ownedTypes();
    const queue = this.game.queue();
    for (const el of $$('.card', this.box)) {
      const id = el.dataset.id!;
      const c = this.cards.find((x) => x.id === id);
      if (!c) continue;
      el.classList.toggle('poor', credits < c.price);
      el.classList.toggle('placing', placing === id);
      const needs = missingFor(id, owned);
      el.classList.toggle('locked', !!needs);
      el.title = [needs ? `Needs ${needs}` : '', el.dataset.hotkey ? `Hotkey: ${el.dataset.hotkey}` : ''].filter(Boolean).join(' · ');
      const mine = queue.filter((q) => q.unit === id);
      // each lane builds its first unit: the one of this type that's under way, if any
      const head = Math.max(0, ...mine.map((q) => q.progress));
      el.querySelector<HTMLElement>('.queue-count')!.textContent = mine.length ? String(mine.length) : '';
      el.classList.toggle('queued', mine.length > 0);
      el.querySelector<HTMLElement>('.queue-bar')!.style.width = `${Math.round(head * 100)}%`;
    }
  }
}
