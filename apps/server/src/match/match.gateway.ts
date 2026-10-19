import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { isPlayerId, MATCH_PATH, PLAYER_ID_PARAM } from '@gravity-harvest/shared';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { SavesService } from '../saves/saves.service.js';
import { MatchRooms } from './match-room.js';
import { SeatConnection } from './seat-connection.js';

/**
 * The match WebSocket (MATCH_PATH) on the same HTTP server as the API. Each connection is a SeatConnection; the
 * matches themselves are MatchRooms, kept here so a player whose connection dropped can rejoin theirs.
 */
@Injectable()
export class MatchGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('MatchGateway');
  private wss: WebSocketServer | null = null;
  private readonly rooms: MatchRooms;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly saves: SavesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.rooms = new MatchRooms({ saves, debugCommands: config.debugCommands, graceMs: config.reconnectGraceMs });
  }

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({ server, path: MATCH_PATH, maxPayload: 1024 * 1024, verifyClient: (info, done) => this.verify(info.req, done) });
    this.wss.on('connection', (ws, req) => new SeatConnection(ws, this.rooms, playerId(req)!));
    if (this.config.debugCommands) this.log.warn('Debug commands are enabled (set NODE_ENV=production or DEBUG_COMMANDS=false to disable)');
  }

  /**
   * Same origins as CORS (requests without an Origin, i.e. tools and tests, are allowed), and the connection must
   * carry the player's id: the match loads and writes only that player's saves.
   */
  private verify(req: IncomingMessage, done: (ok: boolean, code?: number, message?: string) => void): void {
    const origin = req.headers.origin;
    if (origin && !this.config.corsOrigins.includes(origin)) return done(false, 403, 'Origin not allowed');
    if (!playerId(req)) return done(false, 400, `Missing or invalid "${PLAYER_ID_PARAM}" query parameter: expected the player's id (a lowercase UUID)`);
    done(true);
  }

  onApplicationShutdown(): void {
    for (const c of this.wss?.clients ?? []) c.terminate();
    this.wss?.close();
    this.rooms.closeAll();
  }
}

/** The player id from the socket URL's query (`?player=<uuid>`), or null when missing or malformed. */
function playerId(req: IncomingMessage): string | null {
  const value = new URL(req.url ?? '', 'http://localhost').searchParams.get(PLAYER_ID_PARAM);
  return isPlayerId(value) ? value : null;
}
