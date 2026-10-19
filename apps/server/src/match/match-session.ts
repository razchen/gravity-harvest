import { Logger } from '@nestjs/common';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer } from '@gravity-harvest/ai';
import { DEFAULT_DIFFICULTY, type ClientMessage, type SaveKind, type ServerMessage, type StartMatch } from '@gravity-harvest/shared';
import { SNAPSHOT_VERSION, Sim, TEAMS, TICK_MS, VIEW_EVERY_TICKS, type SimSnapshot } from '@gravity-harvest/sim';
import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { SavesService } from '../saves/saves.service.js';
import { parseClientMessage } from './protocol.js';

const AUTOSAVE_NAME = 'Autosave';
/** Catch up at most this many ticks at once (e.g. after the event loop stalled). */
const MAX_CATCH_UP = 10;

/**
 * One browser connection: at most one match at a time, run at a fixed tick. The human is always 'player';
 * each computer side (`human: false` in the scenario) gets a ComputerPlayer that sees only its own view and gives
 * orders through the same Sim.command a human's go through. Sends the player a view every few ticks with only what
 * it may see.
 */
export class MatchSession {
  private readonly log = new Logger('Match');
  private sim: Sim | null = null;
  private computers: ComputerPlayer[] = [];
  private timer: NodeJS.Timeout | null = null;
  private paused = false;
  private ended = false;
  private autosaveOnLeave = false;
  private lastStep = 0;
  /** Serialize message handling (start and save are async). */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ws: WebSocket,
    private readonly saves: SavesService,
    private readonly debugCommands: boolean,
  ) {
    ws.on('message', (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return this.send({ t: 'error', message: 'Malformed message' });
      this.chain = this.chain.then(() => this.handle(msg)).catch((err: Error) => {
        this.send({ t: 'error', message: err.message, ...('req' in msg && { req: msg.req }) });
      });
    });
    ws.on('close', () => {
      this.chain = this.chain.then(() => this.onClose()).catch((err: Error) => this.log.warn(`Autosave on leave failed: ${err.message}`));
    });
  }

  private send(m: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async handle(m: ClientMessage): Promise<void> {
    switch (m.t) {
      case 'start':
        return this.start(m);
      case 'cmd':
        if (this.sim && !this.paused) this.sim.command('player', m.cmd);
        return;
      case 'pause':
        this.paused = true;
        this.sendView();
        return;
      case 'resume':
        this.paused = false;
        this.lastStep = performance.now();
        return;
      case 'save': {
        const save = await this.save(m.kind, m.name, m.thumbnail, m.overwriteId);
        this.send({ t: 'saved', req: m.req, save });
        return;
      }
      case 'end':
        this.stop();
        return;
      case 'debug':
        if (!this.debugCommands) throw new Error('Debug commands are disabled');
        this.sim?.debug('player', m.cmd);
        this.sendView();
        return;
    }
  }

  private async start(m: StartMatch): Promise<void> {
    this.stop();
    if (m.saveId) {
      const { state } = await this.saves.getState(m.saveId);
      this.sim = Sim.restore(state as SimSnapshot);
    } else {
      // a fresh forest, ore and spread every match
      this.sim = Sim.create(m.scenario!, randomInt(2 ** 31), m.faction, { difficulty: m.difficulty ?? DEFAULT_DIFFICULTY });
    }
    const sim = this.sim;
    this.computers = TEAMS.filter((t) => !sim.players[t].human)
      .map((t) => new ComputerPlayer({ hello: sim.hello(t), difficulty: sim.players[t].difficulty, seed: randomInt(2 ** 31) }));
    this.autosaveOnLeave = m.autosaveOnLeave;
    this.paused = false;
    this.ended = false;
    this.send({ t: 'hello', ...this.sim.hello('player'), debug: this.debugCommands });
    this.sim.resendFog('player');
    this.sendView();
    this.lastStep = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const sim = this.sim;
    if (!sim || this.paused || this.ended) return;
    const now = performance.now();
    let steps = Math.min(MAX_CATCH_UP, Math.floor((now - this.lastStep) / TICK_MS));
    this.lastStep += steps * TICK_MS;
    if (now - this.lastStep > MAX_CATCH_UP * TICK_MS) this.lastStep = now; // fell far behind: drop the backlog
    while (steps-- > 0) {
      sim.step();
      if (sim.tick % AI_VIEW_EVERY_TICKS === 0) this.playComputers(sim);
      if (sim.tick % VIEW_EVERY_TICKS === 0) this.sendView();
      if (sim.winner) return void this.finish(sim);
    }
  }

  /** Each computer side looks at its view and gives its orders, the way a player's arrive. */
  private playComputers(sim: Sim): void {
    for (const ai of this.computers) for (const cmd of ai.update(sim.view(ai.team))) sim.command(ai.team, cmd);
  }

  private sendView(): void {
    if (this.sim) this.send({ t: 'view', ...this.sim.view('player', this.paused) });
  }

  private async finish(sim: Sim): Promise<void> {
    this.ended = true;
    this.stop(false);
    this.sendView();
    this.send({ t: 'gameOver', result: sim.winner === 'player' ? 'victory' : 'defeat', stats: { ...sim.players.player.stats, creditsEarned: Math.floor(sim.players.player.stats.creditsEarned) } });
    // a finished match can't be continued
    const autos = await this.saves.list({ scenario: sim.scenario.id, kind: 'auto' });
    await Promise.all(autos.map((a) => this.saves.remove(a.id)));
  }

  private async save(kind: SaveKind, name: string, thumbnail: string | null, overwriteId?: string) {
    const sim = this.sim;
    if (!sim || this.ended) throw new Error('No match running');
    const input = {
      name: kind === 'auto' ? AUTOSAVE_NAME : name,
      scenario: sim.scenario.id,
      kind,
      version: SNAPSHOT_VERSION,
      gameTimeMs: Math.round(sim.timeMs),
      thumbnail,
      state: sim.snapshot() as unknown as Record<string, unknown>,
    };
    if (kind === 'auto') {
      const slot = (await this.saves.list({ scenario: sim.scenario.id, kind: 'auto', limit: 1 }))[0];
      return slot ? this.saves.replace(slot.id, input, true) : this.saves.create(input);
    }
    return overwriteId ? this.saves.replace(overwriteId, input) : this.saves.create(input);
  }

  private async onClose(): Promise<void> {
    const leaving = this.sim && !this.ended && this.autosaveOnLeave;
    this.stop(false);
    if (leaving) await this.save('auto', AUTOSAVE_NAME, null);
    this.sim = null;
  }

  private stop(clear = true): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (clear) this.sim = null;
  }
}
