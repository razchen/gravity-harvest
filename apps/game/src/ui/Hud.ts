import { BuildPanel } from './BuildPanel';
import { DebugMenu } from './DebugMenu';
import { DevInfo } from './DevInfo';
import { $, $$ } from './dom';
import type { HudBridge } from './HudBridge';
import { Minimap } from './Minimap';
import { ResourceBar } from './ResourceBar';
import { SelectionPanel } from './SelectionPanel';
import { Toast } from './Toast';

const HELP_SEEN_KEY = 'gravity-harvest:help-seen';

/** In-match DOM HUD over the Phaser canvas. Created once; survives scene restarts (new game, loading a save). */
export class Hud {
  private readonly toast: Toast;
  private readonly bar: ResourceBar;
  private readonly panel: BuildPanel;
  private readonly minimap: Minimap;
  private readonly debugMenu: DebugMenu;
  private readonly selection: SelectionPanel;

  /** A new match started: rebuild the cards from its catalog. */
  reset(): void {
    this.panel.reset();
    this.selection.reset();
  }

  constructor(private readonly game: HudBridge) {
    this.toast = new Toast((text) => game.toastSound(text));
    this.bar = new ResourceBar(game);
    this.panel = new BuildPanel(game, this.toast);
    this.minimap = new Minimap(game);
    this.selection = new SelectionPanel(game);
    this.debugMenu = new DebugMenu(game, new DevInfo(game));
    game.bus.on('toast', (msg) => this.toast.show(msg));
    game.bus.on('gameOver', ({ result }) => this.toast.show(result === 'victory' ? 'Victory: every enemy structure destroyed' : 'Defeat: your base has fallen'));
    $('#btn-pause').addEventListener('click', () => this.game.requestMenu());
    const unitCmds = $('#unit-cmds');
    $('#btn-unload').addEventListener('click', () => this.game.unloadSelected());

    const perf = $('#perf');
    game.bus.on('perf', () => this.debugMenu.togglePerf());
    const help = $('#help');
    $('#btn-menu').addEventListener('click', () => (help.hidden = !help.hidden));
    $('#help-close').addEventListener('click', () => (help.hidden = true));
    // Keep wheel / right-click on HUD panels from reaching the page or the game
    for (const el of $$('.panel, #sysbtns, #debug-menu')) {
      el.addEventListener('wheel', (e) => e.stopPropagation());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    try {
      if (!localStorage.getItem(HELP_SEEN_KEY)) {
        help.hidden = false;
        localStorage.setItem(HELP_SEEN_KEY, '1');
      }
    } catch {
      /* storage unavailable: skip first-run help */
    }

    const hud = $('#hud');
    window.setInterval(() => {
      if (hud.hidden) return;
      unitCmds.hidden = !this.game.canUnload();
      this.bar.refresh();
      this.panel.refresh();
      this.minimap.draw();
      this.selection.refresh();
      this.debugMenu.refresh();
      if (!perf.hidden) perf.textContent = this.game.perfText();
    }, 150);
  }
}
