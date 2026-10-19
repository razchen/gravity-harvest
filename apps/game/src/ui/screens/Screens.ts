import type { MatchStats } from '../../core/EventBus';
import type { SaveGameSummary } from '../../save/SaveApi';
import type { Difficulty, PlayableFaction, ScenarioSummary } from '@gravity-harvest/shared';
import type { Settings } from '../../app/settings';
import { $ } from '../dom';
import { gameOverScreen } from './gameOver';
import { loadScreen, saveScreen } from './saves';
import { mainMenu, newGameScreen, pauseMenu, settingsScreen } from './menus';

/** What the screens can ask the app to do. Implemented by GameFlow. */
export interface ScreenActions {
  newGame(scenarioId: string, faction?: PlayableFaction, difficulty?: Difficulty): void;
  /** How well the computer plays in the running match (null outside one). */
  difficulty(): Difficulty | null;
  continueGame(): void;
  loadSave(id: string): void;
  deleteSave(id: string): Promise<void>;
  listSaves(): Promise<SaveGameSummary[]>;
  latestSave(): Promise<SaveGameSummary | null>;
  saveGame(name: string, overwriteId?: string): Promise<void>;
  resume(): void;
  quitToMenu(): void;
  restart(): void;
  settings(): Settings;
  updateSettings(s: Settings): void;
  scenarios(): ScenarioSummary[];
  showHelp(): void;
}

export type ScreenName = 'main' | 'newGame' | 'load' | 'save' | 'pause' | 'settings' | 'gameOver';

/** Where a screen's Back button goes: the main menu outside a match, the pause menu inside one. */
export interface ScreenContext {
  inGame: boolean;
  gameOver?: { result: 'victory' | 'defeat'; stats: MatchStats };
}

/** Full-screen menus over the canvas. One screen at a time; plain DOM, styled by hud.css. */
export class Screens {
  private readonly root = $('#screens');
  current: ScreenName | null = null;
  ctx: ScreenContext = { inGame: false };

  constructor(readonly actions: ScreenActions) {}

  show(name: ScreenName, ctx: Partial<ScreenContext> = {}): void {
    this.ctx = { ...this.ctx, ...ctx };
    this.current = name;
    this.root.hidden = false;
    this.root.className = `screen-root screen-${name}${this.ctx.inGame && name !== 'gameOver' ? ' over-game' : ''}`;
    this.root.replaceChildren(this.build(name));
    this.root.querySelector<HTMLElement>('[autofocus], .primary')?.focus();
  }

  hide(): void {
    this.current = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /** Back from a sub-screen. */
  back(): void {
    if (this.ctx.gameOver) this.show('gameOver');
    else this.show(this.ctx.inGame ? 'pause' : 'main');
  }

  private build(name: ScreenName): HTMLElement {
    switch (name) {
      case 'main': return mainMenu(this);
      case 'newGame': return newGameScreen(this);
      case 'pause': return pauseMenu(this);
      case 'settings': return settingsScreen(this);
      case 'load': return loadScreen(this);
      case 'save': return saveScreen(this);
      case 'gameOver': return gameOverScreen(this);
    }
  }
}
