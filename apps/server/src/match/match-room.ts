import { Logger } from '@nestjs/common';
import { AI_VIEW_EVERY_TICKS, ComputerPlayer, type AiState } from '@gravity-harvest/ai';
import { RULES_HASH } from '@gravity-harvest/rules';
import {
  DEFAULT_DIFFICULTY, TEAMS, perTeam, type Command, type DebugCommand, type SaveGameSummary, type SaveKind, type ServerMessage, type StartMatch, type TeamId,
} from '@gravity-harvest/shared';
import {
  CommandQueue, SNAPSHOT_VERSION, TICK_MS, TeamFeed, VIEW_EVERY_TICKS, humanSeat, recordMatch, startMatch, type MatchRecord, type MatchStart,
  type SavedComputer, type Sim, type SimSnapshot,
} from '@gravity-harvest/sim';
import { randomInt } from 'node:crypto';
import type { SavesService } from '../saves/saves.service.js';

const AUTOSAVE_NAME = 'Autosave';
/** Catch up at most this many ticks at once (e.g. after the event loop stalled). */
const MAX_CATCH_UP = 10;

/** What a room needs from a seat's connection: somewhere to send that seat's messages. */
export interface SeatLink {
  send(m: ServerMessage): void;
}

/** What every room gets from whoever keeps the rooms (MatchRooms). */
export interface RoomDeps {
  saves: SavesService;
  debugCommands: boolean;
  /** How long a match waits, paused, for a player whose connection dropped before it is closed. */
  graceMs: number;
  /** Called once when the room closes for good. */
  onClose(room: MatchRoom): void;
}

/** A computer side: its player and the seed it was made with (both go into saves). */
interface Computer {
  ai: ComputerPlayer;
  seed: number;
}

/**
 * One match, run at a fixed tick: the Sim, its tick loop, the computer players, the command log and the autosave. It
 * lives on its own, not inside any socket: people's connections attach to their seat and detach again (SeatConnection,
 * seat-connection.ts). Each computer side (`human: false`) gets a ComputerPlayer that sees only its own view and gives
 * orders the way a person does. Every order, from either kind of player, waits in one CommandQueue for the start of
 * the next step, so the match goes the same whenever messages happen to arrive, and the queue's log can replay it.
 *
 * The clock only runs while every human seat has a connection: when one drops, the match autosaves (if asked to) and
 * waits, paused, for `graceMs` for the same player to come back (`rejoin`), then closes.
 */
export class MatchRoom {
  private readonly log = new Logger('Match');
  private readonly queue = new CommandQueue();
  /** One feed per seat: a connection's views (it survives reconnects), or a computer player's. */
  private readonly feeds = perTeam((t) => new TeamFeed(t));
  private readonly links = new Map<TeamId, SeatLink>();
  private readonly timer: NodeJS.Timeout;
  private grace: NodeJS.Timeout | null = null;
  private paused = false;
  private ended = false;
  private closed = false;
  private lastStep = performance.now();

  private constructor(
    /** The player whose match this is: its saves are theirs, and only they can take its human seat. */
    readonly owner: string,
    readonly sim: Sim,
    /** How the match began: a new match, or the save it was loaded from (the start of its replay). */
    private readonly start: MatchStart,
    private readonly computers: Computer[],
    private readonly autosaveOnLeave: boolean,
    private readonly deps: RoomDeps,
  ) {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** A new match, or one resumed from the owner's save. */
  static async open(owner: string, m: StartMatch, deps: RoomDeps): Promise<MatchRoom> {
    const log = new Logger('Match');
    let start: MatchStart;
    let saved: SimSnapshot | null = null;
    if (m.saveId) {
      saved = (await deps.saves.getState(owner, m.saveId)).state as SimSnapshot;
      start = { snapshot: saved };
      if (saved.rulesHash && saved.rulesHash !== RULES_HASH) log.warn(`Save ${m.saveId} was made under other rules (${saved.rulesHash.slice(0, 12)}); loading it anyway`);
    } else {
      // a fresh forest, ore and spread every match
      start = { scenario: m.scenario!, seed: randomInt(2 ** 31), ...(m.faction && { faction: m.faction }), options: { seat: m.seat, difficulty: m.difficulty ?? DEFAULT_DIFFICULTY } };
    }
    const sim = startMatch(start);
    const computers = TEAMS.filter((t) => !sim.players[t].human).map((t) => makeComputer(sim, t, saved?.computers?.[t], log));
    return new MatchRoom(owner, sim, start, computers, m.autosaveOnLeave, deps);
  }

  /** The seats people play. */
  get humanSeats(): TeamId[] {
    return TEAMS.filter((t) => this.sim.players[t].human);
  }

  /** The seat this player takes in this match, if any (for now: the owner plays the human seat). */
  seatOf(player: string): TeamId | null {
    return player === this.owner ? humanSeat(this.sim.players) : null;
  }

  /** Can this player come back to a seat here (their connection dropped and the match is still on)? */
  awaits(player: string): boolean {
    const seat = this.seatOf(player);
    return !!seat && !this.closed && !this.ended && !this.links.has(seat);
  }

  /** Is anyone missing (a human seat without a connection)? The clock stands still until they're back. */
  private get waiting(): boolean {
    return this.links.size < this.humanSeats.length;
  }

  /** Connect a seat: it gets the hello and a full view, as at the start. */
  attach(seat: TeamId, link: SeatLink): void {
    if (this.closed) throw new Error('This match is over');
    if (!this.sim.players[seat].human) throw new Error('That seat is played by the computer');
    if (this.links.has(seat)) throw new Error('That seat is already taken');
    this.links.set(seat, link);
    if (this.grace && !this.waiting) {
      clearTimeout(this.grace);
      this.grace = null;
      this.log.log(`Player back in seat ${seat}; the match goes on`);
    }
    this.lastStep = performance.now();
    link.send({ t: 'hello', ...this.sim.hello(seat), debug: this.deps.debugCommands });
    this.feeds[seat].resendFog();
    this.sendView(seat);
  }

  /**
   * A seat's connection went away. A finished match closes when its last connection does; one still going autosaves
   * (if the player asked for that) and waits for them, paused, for the grace period.
   */
  async detach(seat: TeamId, link: SeatLink): Promise<void> {
    if (this.links.get(seat) !== link) return;
    this.links.delete(seat);
    if (this.closed) return;
    if (this.ended) {
      if (!this.links.size) this.close();
      return;
    }
    if (!this.grace) this.grace = setTimeout(() => this.close(), this.deps.graceMs).unref();
    if (this.autosaveOnLeave) await this.save('auto', AUTOSAVE_NAME, null);
  }

  /** An order from a seat, for the start of the next step. Ignored while paused or once the match is over. */
  command(seat: TeamId, cmd: Command): void {
    if (this.paused || this.ended) return;
    this.queue.push(this.sim, seat, cmd);
  }

  /** A debug command (only with debug commands enabled): applied at once, and logged like an order. */
  debug(seat: TeamId, cmd: DebugCommand): void {
    if (!this.deps.debugCommands) throw new Error('Debug commands are disabled');
    if (this.ended) return;
    this.queue.debug(this.sim, seat, cmd);
    this.takeEvents();
    this.sendView(seat);
    if (this.sim.winner) void this.finish();
  }

  pause(): void {
    this.paused = true;
    for (const seat of this.links.keys()) this.sendView(seat);
  }

  resume(): void {
    this.paused = false;
    this.lastStep = performance.now();
  }

  /** Leave on purpose: the match is over, without an autosave. */
  end(): void {
    this.ended = true;
    this.close();
  }

  /** Everything needed to play this match again so far (replay(), packages/sim). */
  record(): MatchRecord {
    return recordMatch(this.start, this.queue.log, this.sim.tick);
  }

  /** Stop for good: no more ticks, and the rooms forget it. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    if (this.grace) clearTimeout(this.grace);
    this.grace = null;
    this.deps.onClose(this);
  }

  private tick(): void {
    const sim = this.sim;
    if (this.paused || this.ended || this.waiting) return;
    const now = performance.now();
    let steps = Math.min(MAX_CATCH_UP, Math.floor((now - this.lastStep) / TICK_MS));
    this.lastStep += steps * TICK_MS;
    if (now - this.lastStep > MAX_CATCH_UP * TICK_MS) this.lastStep = now; // fell far behind: drop the backlog
    while (steps-- > 0) {
      this.queue.step(sim);
      this.takeEvents();
      if (sim.tick % AI_VIEW_EVERY_TICKS === 0) this.playComputers();
      if (sim.tick % VIEW_EVERY_TICKS === 0) for (const seat of this.links.keys()) this.sendView(seat);
      if (sim.winner) return void this.finish();
    }
  }

  /** Hand each seat's feed the events of what just happened (the one place events leave the sim). */
  private takeEvents(): void {
    for (const t of TEAMS) this.feeds[t].push(this.sim.takeEvents(t));
  }

  /** Each computer side looks at its view and queues its orders, the way a player's arrive. */
  private playComputers(): void {
    for (const { ai } of this.computers) for (const cmd of ai.update(this.feeds[ai.team].view(this.sim))) this.queue.push(this.sim, ai.team, cmd);
  }

  private sendView(seat: TeamId): void {
    this.links.get(seat)?.send({ t: 'view', ...this.feeds[seat].view(this.sim, this.paused) });
  }

  private async finish(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    const sim = this.sim;
    for (const [seat, link] of this.links) {
      this.sendView(seat);
      const stats = sim.players[seat].stats;
      link.send({ t: 'gameOver', result: sim.winner === seat ? 'victory' : 'defeat', stats: { ...stats, creditsEarned: Math.floor(stats.creditsEarned) } });
    }
    // a finished match can't be continued
    const autos = await this.deps.saves.list(this.owner, { scenario: sim.scenario.id, kind: 'auto' });
    await Promise.all(autos.map((a) => this.deps.saves.remove(this.owner, a.id)));
  }

  /** Store the match: the sim's snapshot plus each computer player's seed and memory. */
  async save(kind: SaveKind, name: string, thumbnail: string | null, overwriteId?: string): Promise<SaveGameSummary> {
    const sim = this.sim;
    if (this.ended) throw new Error('No match running');
    const computers: Partial<Record<TeamId, SavedComputer>> = {};
    for (const { ai, seed } of this.computers) computers[ai.team] = { seed, state: ai.getState() };
    const snapshot: SimSnapshot = { ...sim.snapshot(), computers };
    const saves = this.deps.saves;
    const input = {
      name: kind === 'auto' ? AUTOSAVE_NAME : name,
      scenario: sim.scenario.id,
      kind,
      version: SNAPSHOT_VERSION,
      gameTimeMs: Math.round(sim.timeMs),
      thumbnail,
      state: snapshot as unknown as Record<string, unknown>,
    };
    if (kind === 'auto') {
      // one autosave slot per player and scenario
      const slot = (await saves.list(this.owner, { scenario: sim.scenario.id, kind: 'auto', limit: 1 }))[0];
      return slot ? saves.replace(this.owner, slot.id, input, true) : saves.create(this.owner, input);
    }
    return overwriteId ? saves.replace(this.owner, overwriteId, input) : saves.create(this.owner, input);
  }
}

/** A computer player for a side: carried on from its save when there is one, otherwise a fresh one with a new seed. */
function makeComputer(sim: Sim, team: TeamId, saved: SavedComputer | undefined, log: Logger): Computer {
  const opts = (seed: number) => ({ hello: sim.hello(team), difficulty: sim.players[team].difficulty, seed });
  if (saved) {
    try {
      return { ai: ComputerPlayer.fromState(opts(saved.seed), saved.state as AiState), seed: saved.seed };
    } catch (err) {
      log.warn(`The computer's saved memory for seat ${team} could not be loaded (${(err as Error).message}); it starts afresh`);
    }
  }
  const seed = randomInt(2 ** 31);
  return { ai: new ComputerPlayer(opts(seed)), seed };
}

/** Every running match, so a player whose connection dropped can get back into theirs. */
export class MatchRooms {
  private readonly rooms = new Set<MatchRoom>();

  constructor(private readonly deps: Omit<RoomDeps, 'onClose'>) {}

  async open(owner: string, m: StartMatch): Promise<MatchRoom> {
    const room = await MatchRoom.open(owner, m, { ...this.deps, onClose: (r) => this.rooms.delete(r) });
    this.rooms.add(room);
    return room;
  }

  /** The newest match waiting for this player to come back, if any. */
  awaiting(player: string): MatchRoom | null {
    return [...this.rooms].reverse().find((r) => r.awaits(player)) ?? null;
  }

  get size(): number {
    return this.rooms.size;
  }

  closeAll(): void {
    for (const r of [...this.rooms]) r.close();
  }
}
