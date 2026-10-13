import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MATCH_PATH } from '@gravity-harvest/shared';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { SavesService } from '../saves/saves.service.js';
import { MatchSession } from './match-session.js';

/** The match WebSocket (MATCH_PATH) on the same HTTP server as the API. One MatchSession per connection. */
@Injectable()
export class MatchGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('MatchGateway');
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly saves: SavesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({ server, path: MATCH_PATH, maxPayload: 1024 * 1024, verifyClient: ({ req }: { req: IncomingMessage }) => this.allowed(req) });
    this.wss.on('connection', (ws) => new MatchSession(ws, this.saves, this.config.debugCommands));
    if (this.config.debugCommands) this.log.warn('Debug commands are enabled (set NODE_ENV=production or DEBUG_COMMANDS=false to disable)');
  }

  /** Same origins as CORS; requests without an Origin (tools, tests) are allowed. */
  private allowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return !origin || this.config.corsOrigins.includes(origin);
  }

  onApplicationShutdown(): void {
    for (const c of this.wss?.clients ?? []) c.terminate();
    this.wss?.close();
  }
}
