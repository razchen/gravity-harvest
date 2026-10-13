import type Phaser from 'phaser';
import type { PlayableFaction, ScenarioSummary } from '@gravity-harvest/shared';
import type { MatchStats } from '../core/EventBus';
import { SaveApi } from '../save/SaveApi';
import { SaveService } from '../save/SaveService';
import type { GameScene, SceneData } from '../scenes/GameScene';
import { $ } from '../ui/dom';
import { Hud } from '../ui/Hud';
import { Screens, type ScreenActions } from '../ui/screens/Screens';
import { loadSettings, saveSettings, type Settings } from './settings';

const AUTOSAVE_CHECK_MS = 5000;
const GAME_OVER_DELAY_MS = 2500;

/**
 * App-level flow: title screen ↔ match, pause, save / load / continue, autosave, victory and defeat.
 * Owns the menu screens and decides which Phaser scene runs (menu backdrop or a match). Matches run on the
 * server; this asks the scene's MatchClient to pause, resume and save.
 */
export class GameFlow implements ScreenActions {
  private readonly saves: SaveService;
  private readonly screens: Screens;
  private readonly hudEl = $('#hud');
  private hud: Hud | null = null;
  private scene: GameScene | null = null;
  private inMatch = false;
  private over = false;
  private lastAutosaveAt = 0;
  private autosaving = false;
  private prefs: Settings = loadSettings();
  private scenarioList: ScenarioSummary[] = [];
  private toast: (msg: string) => void = () => {};

  constructor(private readonly game: Phaser.Game) {
    this.saves = new SaveService(game);
    this.screens = new Screens(this);
    game.events.on('booted', () => this.showMainMenu());
    game.events.on('world-ready', (scene: GameScene) => this.onMatchReady(scene));
    game.events.on('match-failed', (msg: string) => this.onMatchFailed(msg));
    void this.loadScenarios();
    window.setInterval(() => void this.autosaveTick(), AUTOSAVE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.autosave(true);
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // --- Navigation --------------------------------------------------------------------------------

  private showMainMenu(): void {
    this.inMatch = false;
    this.hudEl.hidden = true;
    this.screens.show('main', { inGame: false, gameOver: undefined });
  }

  private async loadScenarios(): Promise<void> {
    try {
      this.scenarioList = await SaveApi.scenarios();
    } catch {
      this.scenarioList = [];
    }
  }

  private startMatch(data: SceneData): void {
    const sm = this.game.scene;
    if (sm.isActive('menu') || sm.isPaused('menu')) sm.stop('menu');
    if (sm.isActive('game') || sm.isPaused('game')) sm.stop('game');
    this.screens.hide();
    sm.start('game', data);
  }

  private onMatchReady(scene: GameScene): void {
    this.scene = scene;
    this.inMatch = true;
    this.over = false;
    this.lastAutosaveAt = scene.gameTimeMs;
    if (!this.hud) {
      this.hud = new Hud(scene);
      this.toast = (msg) => scene.bus.emit('toast', msg);
      // the scene instance (and its bus) is reused for every match, so subscribe once
      scene.bus.on('menu', () => this.togglePause());
      scene.bus.on('gameOver', ({ result, stats }) => this.onGameOver(result, stats));
    }
    this.hud.reset();
    this.hudEl.hidden = false;
    this.screens.hide();
  }

  /** The server refused the match (e.g. a save from an older version) or the connection dropped. */
  private onMatchFailed(msg: string): void {
    if (this.over) return;
    window.alert(this.inMatch ? msg : `Could not start the match: ${msg}`);
    void this.quitToMenu(false);
  }

  newGame(scenarioId: string, faction?: PlayableFaction): void {
    this.startMatch({ scenario: scenarioId, faction, autosaveOnLeave: this.prefs.autosave });
  }

  /** Same scenario, same side. */
  restart(): void {
    this.newGame(this.scene?.scenarioId || this.scenarioList[0]?.id || 'skirmish', this.scene?.faction ?? undefined);
  }

  async loadSave(id: string): Promise<void> {
    try {
      const save = await this.saves.get(id);
      this.startMatch({ saveId: id, autosaveOnLeave: this.prefs.autosave });
      this.toast(`Loaded "${save.name}"`);
    } catch (err) {
      window.alert(`Could not load the save: ${(err as Error).message}`);
    }
  }

  async continueGame(): Promise<void> {
    const latest = await this.saves.latest().catch(() => null);
    if (latest) await this.loadSave(latest.id);
  }

  private togglePause(): void {
    if (!this.inMatch || this.over) return;
    if (this.screens.current) this.resume();
    else this.pause();
  }

  private pause(): void {
    this.game.scene.pause('game');
    this.scene?.net.pause();
    this.screens.show('pause', { inGame: true, gameOver: undefined });
  }

  resume(): void {
    this.screens.hide();
    if (this.inMatch && !this.over) {
      this.game.scene.resume('game');
      this.scene?.net.resume();
    }
  }

  async quitToMenu(save = true): Promise<void> {
    if (save && this.inMatch && !this.over) await this.autosave().catch(() => undefined);
    this.inMatch = false;
    const sm = this.game.scene;
    if (sm.isActive('game') || sm.isPaused('game')) sm.stop('game');
    sm.start('menu');
    this.showMainMenu();
  }

  private onGameOver(result: 'victory' | 'defeat', stats: MatchStats): void {
    this.over = true; // the server clears this scenario's autosave: a finished match can't be continued
    window.setTimeout(() => {
      if (!this.inMatch) return;
      this.game.scene.pause('game');
      this.screens.show('gameOver', { inGame: true, gameOver: { result, stats } });
    }, GAME_OVER_DELAY_MS);
  }

  /** Esc, everywhere: close help, back out of a screen, resume from the pause menu, cancel placement, or pause. */
  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.repeat) return;
    e.preventDefault();
    if (!$('#help').hidden) return void ($('#help').hidden = true);
    if (this.screens.current) {
      if (this.screens.current === 'pause') this.resume();
      else if (this.screens.current !== 'main' && this.screens.current !== 'gameOver') this.screens.back();
      return;
    }
    if (!this.inMatch || this.over || !this.scene?.ready) return;
    if (this.scene.placement.active) this.scene.placement.cancel();
    else if (this.scene.mode) this.scene.setMode(null);
    else this.pause();
  }

  // --- Saves ---------------------------------------------------------------------------------------

  listSaves() {
    return this.saves.list();
  }

  latestSave() {
    return this.saves.latest();
  }

  deleteSave(id: string): Promise<void> {
    return this.saves.remove(id);
  }

  async saveGame(name: string, overwriteId?: string): Promise<void> {
    if (!this.scene) throw new Error('No match running');
    await this.saves.saveManual(this.scene, name, overwriteId);
  }

  /** Autosave the running match. `quick` = tab is being hidden: no thumbnail. (Closing the tab autosaves on the server.) */
  private async autosave(quick = false): Promise<void> {
    if (!this.scene || !this.inMatch || this.over || this.autosaving || !this.prefs.autosave) return;
    this.autosaving = true;
    try {
      await this.saves.autosave(this.scene, quick);
      this.lastAutosaveAt = this.scene.gameTimeMs;
      if (!quick) this.toast('Game autosaved');
    } catch {
      /* server offline: try again next interval */
    } finally {
      this.autosaving = false;
    }
  }

  private async autosaveTick(): Promise<void> {
    const sm = this.game.scene;
    if (!this.scene || !this.inMatch || this.over || !this.prefs.autosave || !sm.isActive('game')) return;
    if (this.scene.gameTimeMs - this.lastAutosaveAt >= this.prefs.autosaveMinutes * 60_000) await this.autosave();
  }

  // --- Settings and misc ---------------------------------------------------------------------------

  settings(): Settings {
    return { ...this.prefs };
  }

  updateSettings(s: Settings): void {
    this.prefs = { ...s };
    saveSettings(this.prefs);
  }

  scenarios(): ScenarioSummary[] {
    return this.scenarioList;
  }

  showHelp(): void {
    $('#help').hidden = false;
  }
}
