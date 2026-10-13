// The dev pages' shell: the sidebar (every building and unit, the effect pages and the game) and the page beside it.
// Every dev page's HTML loads this. Clicking a dev link doesn't reload: the shell fetches that page's HTML, swaps its
// markup and styles in next to the sidebar, cleans up the old page (page.ts) and mounts the new one.
import { DEV_BUILDINGS, FACTIONS, emblem, type FactionScope, type Milestone } from './buildings';
import { leave } from './page';
import { DEV_UNITS, UNIT_KINDS } from './unitData';

/** Each dev page's script, by path. */
const PAGES: Record<string, () => Promise<{ default: () => void }>> = {
  '/dev/': () => import('./gallery'),
  '/dev/units.html': () => import('./unitGallery'),
  '/dev/building.html': () => import('./building'),
  '/dev/unit.html': () => import('./unit'),
  '/dev/fx.html': () => import('./fx'),
  '/dev/fire.html': () => import('./fire'),
};
const pathOf = (url: URL) => url.pathname.replace(/\/index\.html$/, '/');

const link = (href: string, text: string, on: boolean, extra = '') =>
  `<a href="${href}" class="${on ? 'on' : ''}${extra}">${text}</a>`;

// the folding groups start closed, and stay as you leave them while you move between dev pages
const open: Record<string, boolean> = {};

interface Entry { id: string; name: string; faction: FactionScope; milestone: Milestone; href: string; ready: boolean }

/** One folding group per faction; `ready` counts the entries with their art. */
function groups(prefix: string, list: Entry[], current: string | null): string {
  return FACTIONS.map((f) => {
    const mine = list.filter((e) => e.faction === f.id);
    const key = `${prefix}${f.id}`;
    const items = mine.map((e) => link(e.href, `${e.name}<i>V${e.milestone}</i>`, e.id === current, e.ready ? '' : ' notready')).join('');
    return `<details data-group="${key}"${open[key] ? ' open' : ''}>
      <summary>${emblem(f.id)}${f.name} <small>${mine.filter((e) => e.ready).length}/${mine.length}</small></summary>
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
  const buildings = groups('', DEV_BUILDINGS.map((b) => ({
    ...b, href: `/dev/building.html?b=${b.id}${b.construction && mode ? `&mode=${mode}` : ''}`, ready: Boolean(b.construction),
  })), currentBuilding);
  // units: infantry and vehicles, each in faction groups
  const units = UNIT_KINDS.map((k) => `<div class="sub">${k.name}</div>`
    + groups(`units-${k.id}-`, DEV_UNITS.filter((u) => u.kind === k.id).map((u) => ({ ...u, href: `/dev/unit.html?u=${u.id}`, ready: Boolean(u.picture) })), currentUnit)).join('');
  return `
    <a class="brand" href="/dev/"><img src="/assets/ui/wordmark.webp" alt="Gravity Harvest"><small>dev</small></a>
    <div class="sect">Buildings</div>
    ${link('/dev/', 'All buildings', here === '/dev/')}
    ${buildings}
    <div class="sect">Units</div>
    ${link('/dev/units.html', 'All units', here === '/dev/units.html')}
    ${units}
    <div class="sect">Effects</div>
    ${link('/dev/fire.html', 'Fire playground', here === '/dev/fire.html')}
    ${link('/dev/fx.html', 'Fire and smoke tests', here === '/dev/fx.html')}
    <div class="sect">Game</div>
    ${link('/', 'Play the game', false)}`;
}

const nav = document.createElement('nav');
nav.className = 'sidebar';
const page = document.createElement('div');
page.className = 'page';
while (document.body.firstChild) page.append(document.body.firstChild);
document.body.append(nav, page);
document.body.classList.add('with-nav');

function drawSidebar(url: URL): void {
  const scroll = nav.scrollTop;
  nav.innerHTML = sidebar(url);
  nav.scrollTop = scroll;
  for (const d of nav.querySelectorAll<HTMLDetailsElement>('details[data-group]')) {
    d.addEventListener('toggle', () => { open[d.dataset.group!] = d.open; });
  }
}

/** The page's own styles (in its <head>), swapped along with its markup. */
let pageStyles = [...document.head.querySelectorAll('style')];
let visit = 0;

/** Show the dev page at `url` in place of the current one. */
async function go(url: URL, push: boolean): Promise<void> {
  const mine = ++visit;
  const html = await fetch(url.pathname).then((r) => r.text());
  if (mine !== visit) return; // clicked somewhere else meanwhile
  const doc = new DOMParser().parseFromString(html, 'text/html');
  leave();
  if (push) history.pushState(null, '', url);
  for (const s of pageStyles) s.remove();
  pageStyles = [...doc.head.querySelectorAll('style')].map((s) => document.head.appendChild(document.importNode(s, true)));
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
