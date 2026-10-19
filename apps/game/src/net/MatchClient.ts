// The browser's side of a match: one WebSocket to the server (MATCH_PATH). Orders go up, views come down.
// The browser never runs the rules; it draws the TeamView it is sent and asks the server to act.
import {
  MATCH_PATH, PLAYER_ID_PARAM, type ClientMessage, type Command, type DebugCommand, type MatchHello, type MatchStats, type SaveGameSummary,
  type SaveKind, type ServerMessage, type StartMatch, type TeamView,
} from '@gravity-harvest/shared';
import { playerId } from './playerId';

export interface MatchHandlers {
  hello(h: MatchHello): void;
  view(v: TeamView): void;
  gameOver(result: 'victory' | 'defeat', stats: MatchStats): void;
  /** The match could not start (e.g. a save that can't be loaded), or the connection dropped for good. */
  failed(message: string): void;
  error(message: string): void;
  /** The connection dropped mid-match: it is trying to get back in (called before every try). */
  reconnecting(): void;
  /** Back in the match after a dropped connection (the views carry on; there is no second `hello`). */
  reconnected(): void;
}

const SAVE_TIMEOUT_MS = 15_000;
/** How many view arrivals the link stats remember. */
const ARRIVALS = 64;
/** How long the server waits for a dropped connection to come back, if its hello doesn't say (its default). */
const DEFAULT_RECONNECT_MS = 60_000;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 2000;

/**
 * How long to wait before reconnecting try `n` (0 = the first): doubling from a quarter of a second, at most two
 * seconds, so a blip is over at once and a longer outage doesn't hammer the server.
 */
export const reconnectDelay = (n: number): number => Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** n);

/** Read-only numbers about the connection, for the Dev info panel (ui/DevInfo.ts). */
export interface LinkStats {
  /** Views received this match. */
  views: number;
  /** Bytes of messages received (as text). */
  bytes: number;
  /** performance.now() of the last views (oldest first, at most ARRIVALS). */
  arrivals: number[];
}

/**
 * The match socket. When it drops mid-match (not on purpose, not after the game is over), the server keeps the match
 * waiting, paused, for `reconnectMs`: this tries to get back in for that long, sending `rejoin` on a fresh socket, and
 * only then reports the match as lost.
 */
export class MatchClient {
  private ws: WebSocket | null = null;
  private started = false;
  private over = false;
  private req = 0;
  private readonly pending = new Map<number, { resolve(s: SaveGameSummary): void; reject(e: Error): void }>();
  /** How long the server waits for us after a drop (from its hello). */
  private reconnectMs = DEFAULT_RECONNECT_MS;
  /** While reconnecting: when the connection dropped (performance.now()), the tries so far, and the next one's timer. */
  private lostAt: number | null = null;
  private tries = 0;
  private retry = 0;
  readonly stats: LinkStats = { views: 0, bytes: 0, arrivals: [] };

  constructor(private readonly on: MatchHandlers) {}

  /** Open the socket and start (or resume) a match. */
  start(m: StartMatch): void {
    this.close();
    this.started = false;
    this.over = false;
    this.open({ t: 'start', ...m });
  }

  /** A fresh socket whose first message is `first` (start, or rejoin after a drop). */
  private open(first: ClientMessage): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // the player id rides on the URL (a browser can't set headers on a WebSocket): the match saves and loads as this player
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}${MATCH_PATH}?${PLAYER_ID_PARAM}=${playerId()}`));
    ws.onopen = () => this.send(first);
    ws.onmessage = (e) => {
      const text = String(e.data);
      this.stats.bytes += text.length;
      this.receive(JSON.parse(text) as ServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // replaced by a newer match, or closed on purpose
      this.ws = null;
      for (const p of this.pending.values()) p.reject(new Error('Connection to the server was lost'));
      this.pending.clear();
      if (this.started && !this.over) this.reconnect();
      else this.on.failed(this.started ? 'Connection to the server was lost' : 'Could not reach the game server');
    };
  }

  /** Try again after a pause, for as long as the server keeps the match waiting; then give up. */
  private reconnect(): void {
    const now = performance.now();
    this.lostAt ??= now;
    const left = this.lostAt + this.reconnectMs - now;
    if (left <= 0) return this.giveUp('Connection to the server was lost');
    this.on.reconnecting();
    this.retry = window.setTimeout(() => this.open({ t: 'rejoin' }), Math.min(reconnectDelay(this.tries++), left));
  }

  private giveUp(message: string): void {
    this.lostAt = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.on.failed(message);
  }

  private receive(m: ServerMessage): void {
    switch (m.t) {
      case 'hello':
        if (this.lostAt !== null) {
          // back in the same match: the world is already built, and views pick up where they left off
          this.lostAt = null;
          this.tries = 0;
          return this.on.reconnected();
        }
        this.started = true;
        this.reconnectMs = m.reconnectMs ?? DEFAULT_RECONNECT_MS;
        return this.on.hello(m);
      case 'view':
        this.stats.views++;
        this.stats.arrivals.push(performance.now());
        if (this.stats.arrivals.length > ARRIVALS) this.stats.arrivals.shift();
        return this.on.view(m);
      case 'gameOver':
        this.over = true;
        return this.on.gameOver(m.result, m.stats);
      case 'saved':
        this.pending.get(m.req)?.resolve(m.save);
        this.pending.delete(m.req);
        return;
      case 'error':
        if (m.req !== undefined && this.pending.has(m.req)) {
          this.pending.get(m.req)!.reject(new Error(m.message));
          this.pending.delete(m.req);
        } else if (this.lostAt !== null) this.giveUp(`Could not get back into the match: ${m.message}`); // e.g. it closed meanwhile
        else if (!this.started) this.on.failed(m.message);
        else this.on.error(m.message);
    }
  }

  /** The socket's state: connecting, open, closing or closed, or reconnecting after a drop. */
  get state(): string {
    if (this.lostAt !== null) return 'reconnecting';
    return ['connecting', 'open', 'closing', 'closed'][this.ws?.readyState ?? WebSocket.CLOSED];
  }

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  command(cmd: Command): void {
    this.send({ t: 'cmd', cmd });
  }

  debug(cmd: DebugCommand): void {
    this.send({ t: 'debug', cmd });
  }

  pause(): void {
    this.send({ t: 'pause' });
  }

  resume(): void {
    this.send({ t: 'resume' });
  }

  /** Ask the server to save the running match. Resolves with the stored save's summary. */
  save(kind: SaveKind, name: string, thumbnail: string | null, overwriteId?: string): Promise<SaveGameSummary> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the game server'));
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(req);
        reject(new Error('The server did not answer'));
      }, SAVE_TIMEOUT_MS);
      this.pending.set(req, {
        resolve: (s) => (window.clearTimeout(timer), resolve(s)),
        reject: (e) => (window.clearTimeout(timer), reject(e)),
      });
      this.send({ t: 'save', req, name, kind, thumbnail, ...(overwriteId && { overwriteId }) });
    });
  }

  /** Leave the match on purpose (no autosave on the server; quitting saves explicitly first). */
  close(): void {
    window.clearTimeout(this.retry);
    this.lostAt = null;
    this.tries = 0;
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'end' } satisfies ClientMessage));
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }
}
