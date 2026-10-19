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
  /** The match could not start (e.g. a save that can't be loaded), or the connection dropped. */
  failed(message: string): void;
  error(message: string): void;
}

const SAVE_TIMEOUT_MS = 15_000;
/** How many view arrivals the link stats remember. */
const ARRIVALS = 64;

/** Read-only numbers about the connection, for the Dev info panel (ui/DevInfo.ts). */
export interface LinkStats {
  /** Views received this match. */
  views: number;
  /** Bytes of messages received (as text). */
  bytes: number;
  /** performance.now() of the last views (oldest first, at most ARRIVALS). */
  arrivals: number[];
}

export class MatchClient {
  private ws: WebSocket | null = null;
  private started = false;
  private req = 0;
  private readonly pending = new Map<number, { resolve(s: SaveGameSummary): void; reject(e: Error): void }>();
  readonly stats: LinkStats = { views: 0, bytes: 0, arrivals: [] };

  constructor(private readonly on: MatchHandlers) {}

  /** Open the socket and start (or resume) a match. */
  start(m: StartMatch): void {
    this.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // the player id rides on the URL (a browser can't set headers on a WebSocket): the match saves and loads as this player
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}${MATCH_PATH}?${PLAYER_ID_PARAM}=${playerId()}`));
    this.started = false;
    ws.onopen = () => this.send({ t: 'start', ...m });
    ws.onmessage = (e) => {
      const text = String(e.data);
      this.stats.bytes += text.length;
      this.receive(JSON.parse(text) as ServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // replaced by a newer match
      this.ws = null;
      for (const p of this.pending.values()) p.reject(new Error('Connection to the server was lost'));
      this.pending.clear();
      this.on.failed(this.started ? 'Connection to the server was lost' : 'Could not reach the game server');
    };
  }

  private receive(m: ServerMessage): void {
    switch (m.t) {
      case 'hello':
        this.started = true;
        return this.on.hello(m);
      case 'view':
        this.stats.views++;
        this.stats.arrivals.push(performance.now());
        if (this.stats.arrivals.length > ARRIVALS) this.stats.arrivals.shift();
        return this.on.view(m);
      case 'gameOver':
        return this.on.gameOver(m.result, m.stats);
      case 'saved':
        this.pending.get(m.req)?.resolve(m.save);
        this.pending.delete(m.req);
        return;
      case 'error':
        if (m.req !== undefined && this.pending.has(m.req)) {
          this.pending.get(m.req)!.reject(new Error(m.message));
          this.pending.delete(m.req);
        } else if (!this.started) this.on.failed(m.message);
        else this.on.error(m.message);
    }
  }

  /** The socket's state: connecting, open, closing or closed. */
  get state(): string {
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
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'end' } satisfies ClientMessage));
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }
}
