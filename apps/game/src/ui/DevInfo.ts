import { $ } from './dom';
import type { DevInfoSection, HudBridge } from './HudBridge';

const KEY = 'gravity-harvest:dev-info';
/** How often the open sections are re-read, in ms (a few times a second, not every frame). */
const REFRESH_MS = 250;

const SECTIONS: { id: DevInfoSection; title: string }[] = [
  { id: 'sounds', title: 'Sounds' },
  { id: 'perf', title: 'Performance' },
  { id: 'link', title: 'Server link' },
  { id: 'match', title: 'Match' },
  { id: 'camera', title: 'Camera & pointer' },
  { id: 'selection', title: 'Selection' },
];

interface Saved {
  shown: boolean;
  /** Sections folded shut. */
  closed: DevInfoSection[];
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { shown: raw.shown === true, closed: Array.isArray(raw.closed) ? raw.closed : [] };
  } catch {
    return { shown: false, closed: [] };
  }
}

/**
 * Dev info (I key, or its row in the debug menu): what the game is doing right now, in foldable sections: the sounds
 * playing and dropped, frame times, the server link, the match, the camera and pointer, the selection. Whether it's
 * shown and which sections are folded are kept per browser. Only the open sections are read, a few times a second.
 */
export class DevInfo {
  private readonly box = $('#dev-info');
  private readonly bodies = new Map<DevInfoSection, HTMLPreElement>();
  private readonly open = new Set<DevInfoSection>();

  constructor(private readonly game: HudBridge) {
    const saved = load();
    const title = document.createElement('div');
    title.className = 'dev-title';
    title.innerHTML = '<span>Dev info <kbd>I</kbd></span>';
    const close = document.createElement('button');
    close.className = 'dev-close';
    close.textContent = '×';
    close.title = 'Close (I)';
    close.addEventListener('click', () => this.toggle());
    title.append(close);
    this.box.append(title);
    for (const s of SECTIONS) {
      const d = document.createElement('details');
      d.open = !saved.closed.includes(s.id);
      if (d.open) this.open.add(s.id);
      const sum = document.createElement('summary');
      sum.textContent = s.title;
      const pre = document.createElement('pre');
      d.append(sum, pre);
      d.addEventListener('toggle', () => {
        if (d.open) this.open.add(s.id);
        else this.open.delete(s.id);
        this.save();
        this.refresh();
      });
      this.bodies.set(s.id, pre);
      this.box.append(d);
    }
    this.box.hidden = !saved.shown;
    game.bus.on('devInfo', () => this.toggle());
    const hud = $('#hud');
    window.setInterval(() => {
      if (!hud.hidden && this.shown) this.refresh();
    }, REFRESH_MS);
  }

  get shown(): boolean {
    return !this.box.hidden;
  }

  toggle(): void {
    this.box.hidden = !this.box.hidden;
    this.save();
    if (this.shown) this.refresh();
  }

  private refresh(): void {
    const text = this.game.devInfo(this.open);
    for (const id of this.open) {
      const pre = this.bodies.get(id)!;
      const t = text[id] ?? '(waiting for the match)';
      if (pre.textContent !== t) pre.textContent = t;
    }
  }

  private save(): void {
    try {
      const closed = SECTIONS.map((s) => s.id).filter((id) => !this.open.has(id));
      localStorage.setItem(KEY, JSON.stringify({ shown: this.shown, closed } satisfies Saved));
    } catch {
      /* storage unavailable: it resets next time */
    }
  }
}
