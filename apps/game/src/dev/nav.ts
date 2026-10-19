// The dev pages' shell: the sidebar (every building and unit, the effect pages and the game) and the page beside it.
// Every dev page's HTML loads this. Clicking a dev link doesn't reload: the shell fetches that page's HTML, swaps its
// markup (and its <html> and <body> classes) in next to the sidebar, cleans up the old page (page.ts) and mounts the new one.
import { DEV_BUILDINGS, FACTIONS, emblem, type FactionScope, type Milestone } from './buildings';
import { leave } from './page';
import { SOUND_GROUPS, groupId } from './soundGroups';
import { DEV_UNITS, UNIT_KINDS } from './unitData';

/** Each dev page's script, by path. */
const PAGES: Record<string, () => Promise<{ default: () => void }>> = {
  '/dev/': () => import('./gallery'),
  '/dev/units.html': () => import('./unitGallery'),
  '/dev/building.html': () => import('./building'),
  '/dev/unit.html': () => import('./unit'),
  '/dev/fx.html': () => import('./fx'),
  '/dev/fire.html': () => import('./fire'),
  '/dev/weapons.html': () => import('./weapons'),
  '/dev/sounds.html': () => import('./sounds'),
};
const pathOf = (url: URL) => url.pathname.replace(/\/index\.html$/, '/');

// sidebar links: the page you're on in gold; dimmed without their art
const LINK = 'rounded-[4px] px-2 py-1 font-semibold';
const link = (href: string, text: string, on: boolean, ready = true, cls = '') =>
  `<a href="${href}" class="${LINK} ${on ? 'bg-gold text-ink' : `hover:bg-[#26292e] ${ready ? 'text-text' : 'text-[#7d7a72]'}`} ${cls}">${text}</a>`;
const SECT = 'mx-2 mb-1 mt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-muted narrow:hidden';

// the folding groups start closed, and stay as you leave them while you move between dev pages
const open: Record<string, boolean> = {};

interface Entry { id: string; name: string; faction: FactionScope; milestone: Milestone; href: string; ready: boolean }

/** One folding group per faction that has entries; `ready` counts the entries with their art. */
function groups(prefix: string, list: Entry[], current: string | null): string {
  return FACTIONS.map((f) => {
    const mine = list.filter((e) => e.faction === f.id);
    if (!mine.length) return '';
    const key = `${prefix}${f.id}`;
    const items = mine.map((e) => {
      const on = e.id === current;
      const milestone = `<i class="float-right ml-1.5 text-[12px] font-semibold not-italic ${on ? 'text-ink' : 'text-muted'}">V${e.milestone}</i>`;
      return link(e.href, `${e.name}${milestone}`, on, e.ready, 'block pl-5 narrow:pl-2');
    }).join('');
    // the ▸ before the name turns down when the group is open
    return `<details data-group="${key}" class="flex flex-col"${open[key] ? ' open' : ''}>
      <summary class="cursor-pointer select-none list-none rounded-[4px] px-2 py-1 font-bold hover:bg-[#26292e] [&::-webkit-details-marker]:hidden
        before:inline-block before:w-3 before:text-muted before:transition-transform before:duration-150 before:ease-[ease] before:content-['▸']
        [details[open]>&]:before:rotate-90 [&>img]:ml-0.5">${emblem(f.id)}${f.name} <small class="ml-1 font-medium text-muted [font-size:smaller]">${mine.filter((e) => e.ready).length}/${mine.length}</small></summary>
      ${items}
    </details>`;
  }).join('');
}

/** The sidebar for the page at `url`. */
function sidebar(url: URL): string {
  const here = pathOf(url);
  const params = url.searchParams;
  // building links keep the tab you're on (none: each opens on its 3D model)
  const mode = params.get('mode');
  const currentBuilding = here === '/dev/building.html' ? params.get('b') : null;
  const currentUnit = here === '/dev/unit.html' ? params.get('u') : null;
  const soundGroup = here === '/dev/sounds.html' ? params.get('g') : null;
  const buildings = groups('', DEV_BUILDINGS.map((b) => ({
    ...b, href: `/dev/building.html?b=${b.id}${b.construction && mode ? `&mode=${mode}` : ''}`, ready: Boolean(b.construction),
  })), currentBuilding);
  // units: infantry, vehicles, aircraft and ships, each in faction groups
  // unit links keep the tab you're on too
  const unitMode = here === '/dev/unit.html' ? mode : null;
  const units = UNIT_KINDS.map((k) => `<div class="mb-0.5 ml-3 mr-2 mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted opacity-80 narrow:hidden">${k.name}</div>`
    + groups(`units-${k.id}-`, DEV_UNITS.filter((u) => u.kind === k.id).map((u) => ({
      ...u, href: `/dev/unit.html?u=${u.id}${u.picture && unitMode ? `&mode=${unitMode}` : ''}`, ready: Boolean(u.picture),
    })), currentUnit)).join('');
  return `
    <a class="flex flex-col items-center gap-0.5 rounded-[4px] px-2 pb-2 pt-0.5 text-[17px] font-bold text-text hover:bg-[#26292e] narrow:flex-row narrow:pb-0.5" href="/dev/">
      <img class="h-auto w-full narrow:w-[130px]" src="/assets/ui/wordmark.webp" alt="Gravity Harvest"><small class="text-[12px] font-semibold uppercase tracking-[0.2em] text-gold">dev</small></a>
    <div class="${SECT}">Buildings</div>
    ${link('/dev/', 'All buildings', here === '/dev/')}
    ${buildings}
    <div class="${SECT}">Units</div>
    ${link('/dev/units.html', 'All units', here === '/dev/units.html')}
    ${units}
    <div class="${SECT}">Effects</div>
    ${link('/dev/weapons.html', 'Weapons', here === '/dev/weapons.html')}
    ${link('/dev/fire.html', 'Fire playground', here === '/dev/fire.html')}
    ${link('/dev/fx.html', 'Fire and smoke tests', here === '/dev/fx.html')}
    <div class="${SECT}">Sounds</div>
    ${link('/dev/sounds.html', 'All sounds', here === '/dev/sounds.html' && !soundGroup)}
    ${SOUND_GROUPS.map((g) => link(`/dev/sounds.html?g=${groupId(g)}`, g, here === '/dev/sounds.html' && soundGroup === groupId(g))).join('')}
    <div class="${SECT}">Game</div>
    ${link('/', 'Play the game', false)}`;
}

/** The body: the sidebar beside the page, or above it on a narrow screen. */
const SHELL = ['flex', 'min-h-screen', 'flex-row', 'narrow:h-auto', 'narrow:flex-col'];
const nav = document.createElement('nav');
nav.className = 'sticky top-0 flex h-screen w-[200px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel px-2.5 py-3'
  + ' narrow:static narrow:h-auto narrow:w-auto narrow:flex-row narrow:flex-wrap narrow:items-center narrow:border-b narrow:border-r-0';
const page = document.createElement('div');
page.className = 'flex min-w-0 flex-1 flex-col';
while (document.body.firstChild) page.append(document.body.firstChild);
document.body.append(nav, page);
document.body.classList.add(...SHELL);

function drawSidebar(url: URL): void {
  const scroll = nav.scrollTop;
  nav.innerHTML = sidebar(url);
  nav.scrollTop = scroll;
  for (const d of nav.querySelectorAll<HTMLDetailsElement>('details[data-group]')) {
    d.addEventListener('toggle', () => { open[d.dataset.group!] = d.open; });
  }
}

let visit = 0;

/** Show the dev page at `url` in place of the current one. */
async function go(url: URL, push: boolean): Promise<void> {
  const mine = ++visit;
  const html = await fetch(url.pathname).then((r) => r.text());
  if (mine !== visit) return; // clicked somewhere else meanwhile
  const doc = new DOMParser().parseFromString(html, 'text/html');
  leave();
  if (push) history.pushState(null, '', url);
  // the page's own classes on <html> and <body> (a full-height page), with the shell's
  document.documentElement.className = doc.documentElement.className;
  document.body.className = doc.body.className;
  document.body.classList.add(...SHELL);
  document.title = doc.title;
  for (const s of doc.body.querySelectorAll('script')) s.remove();
  page.replaceChildren(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  if (push) window.scrollTo(0, 0);
  await mount(new URL(location.href));
}

async function mount(url: URL): Promise<void> {
  drawSidebar(url);
  const load = PAGES[pathOf(url)];
  if (load) (await load()).default();
}

// dev links (the sidebar's, the cards', the tabs') swap the page instead of loading it
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a');
  if (!a || !a.href || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || !PAGES[pathOf(url)]) return;
  e.preventDefault();
  if (url.href === location.href) return;
  void go(url, true);
});
window.addEventListener('popstate', () => void go(new URL(location.href), false));

void mount(new URL(location.href));
