import type { DevInfo } from './DevInfo';
import { $ } from './dom';
import type { HudBridge } from './HudBridge';

interface Item {
  keys: string[];
  label: string;
  /** Current state shown on the right (e.g. on / off), if any. */
  state?: () => string;
  /** What a click on it does (none: it only lists the keys). */
  action?: () => void;
  /** Only where the server allows debug commands. */
  debugOnly?: boolean;
}

/**
 * Debug and shortcuts panel (` key, or the gear button): every in-game shortcut with its state. Each item can also
 * be clicked. The keys themselves work without the panel open.
 */
export class DebugMenu {
  private readonly box = $('#debug-menu');
  private readonly perf = $('#perf');
  private readonly items: Item[];

  constructor(private readonly game: HudBridge, devInfo: DevInfo) {
    const onOff = (on: boolean) => (on ? 'on' : 'off');
    this.items = [
      { keys: ['F'], label: 'Fog of war', state: () => onOff(!game.fogRevealed), action: () => game.toggleFog(), debugOnly: true },
      { keys: ['T'], label: 'Fast mode (your building, production, movement)', state: () => (game.fastMode === 1 ? 'off' : `${game.fastMode}×`), action: () => game.cycleFast(), debugOnly: true },
      { keys: ['G'], label: 'Tile grid', state: () => onOff(game.gridOn), action: () => game.toggleGrid() },
      { keys: ['P'], label: 'Performance readout', state: () => onOff(!this.perf.hidden), action: () => this.togglePerf() },
      { keys: ['I'], label: 'Dev info (sounds, frame times, server link, match, selection)', state: () => onOff(devInfo.shown), action: () => devInfo.toggle() },
      { keys: ['+'], label: 'Zoom in (hold)', state: () => `${Math.round(game.zoomLevel * 100)}%`, action: () => game.zoomBy(1.25) },
      { keys: ['−'], label: 'Zoom out (hold)', action: () => game.zoomBy(0.8) },
      { keys: ['Z'], label: 'Reset zoom', action: () => game.resetZoom() },
      { keys: ['Ctrl', '1–0'], label: 'Save the selection as a control group (Cmd too, where the browser allows it)' },
      { keys: ['1–0'], label: 'Select a control group (twice quickly: centre on it)' },
      { keys: ['⇧', '1–0'], label: 'Add a control group to the selection' },
      { keys: ['`'], label: 'Close this panel', action: () => this.toggle() },
    ];
    $('#btn-settings').addEventListener('click', () => this.toggle());
    game.bus.on('debugMenu', () => this.toggle());
    this.box.addEventListener('wheel', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return !this.box.hidden;
  }

  toggle(): void {
    this.box.hidden = !this.box.hidden;
    if (this.open) this.render();
  }

  togglePerf(): void {
    this.perf.hidden = !this.perf.hidden;
    this.refresh();
  }

  private render(): void {
    this.box.replaceChildren();
    const title = document.createElement('div');
    title.className = 'debug-title';
    title.textContent = 'Shortcuts & debug';
    this.box.append(title);
    for (const [i, it] of this.items.entries()) {
      const row = document.createElement('button');
      row.className = 'debug-row';
      row.dataset.i = String(i);
      const disabled = it.debugOnly && !this.game.debugAvailable;
      row.disabled = !!disabled;
      row.classList.toggle('keys-only', !it.action);
      row.title = disabled ? 'Needs a dev server (debug commands)' : '';
      row.innerHTML = `<span class="debug-keys">${it.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>` +
        `<span class="debug-label">${it.label}</span><span class="debug-state"></span>`;
      row.addEventListener('click', () => {
        it.action?.();
        this.refresh();
      });
      this.box.append(row);
    }
    this.refresh();
  }

  /** Update the states (called by the HUD's refresh loop while open). */
  refresh(): void {
    if (!this.open) return;
    for (const row of this.box.querySelectorAll<HTMLElement>('.debug-row')) {
      const it = this.items[Number(row.dataset.i)];
      row.querySelector('.debug-state')!.textContent = it.state?.() ?? '';
    }
  }
}
