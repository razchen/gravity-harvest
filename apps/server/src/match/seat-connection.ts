import { Logger } from '@nestjs/common';
import type { ClientMessage, ServerMessage, TeamId } from '@gravity-harvest/shared';
import type { WebSocket } from 'ws';
import type { MatchRoom, MatchRooms, SeatLink } from './match-room.js';
import { parseClientMessage } from './protocol.js';

/**
 * One browser connection: a socket and the seat it plays in a MatchRoom. It starts a match (or loads one), or rejoins
 * the player's match after a dropped connection, and passes the player's messages on to the room. The room outlives
 * it: when the socket closes the room waits for the player to come back instead of ending.
 */
export class SeatConnection implements SeatLink {
  private readonly log = new Logger('Match');
  private room: MatchRoom | null = null;
  private seat: TeamId = 'a';
  /** Serialize message handling (start and save are async). */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ws: WebSocket,
    private readonly rooms: MatchRooms,
    /** The connecting player's anonymous id: every save this match reads or writes is theirs. */
    private readonly player: string,
  ) {
    ws.on('message', (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return this.send({ t: 'error', message: 'Malformed message' });
      this.chain = this.chain.then(() => this.handle(msg)).catch((err: Error) => {
        this.send({ t: 'error', message: err.message, ...('req' in msg && { req: msg.req }) });
      });
    });
    ws.on('close', () => {
      this.chain = this.chain.then(() => this.leave()).catch((err: Error) => this.log.warn(`Autosave on leave failed: ${err.message}`));
    });
  }

  send(m: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async handle(m: ClientMessage): Promise<void> {
    if (m.t === 'start') {
      // a new match replaces this connection's current one
      this.room?.end();
      this.room = null;
      const room = await this.rooms.open(this.player, m);
      return this.join(room);
    }
    if (m.t === 'rejoin') {
      const room = this.rooms.awaiting(this.player);
      if (!room) throw new Error('No match to rejoin');
      this.room?.end();
      return this.join(room);
    }
    const room = this.room;
    switch (m.t) {
      case 'cmd':
        return room?.command(this.seat, m.cmd);
      case 'pause':
        return room?.pause();
      case 'resume':
        return room?.resume();
      case 'save': {
        if (!room) throw new Error('No match running');
        const save = await room.save(m.kind, m.name, m.thumbnail, m.overwriteId);
        this.send({ t: 'saved', req: m.req, save });
        return;
      }
      case 'end':
        room?.end();
        this.room = null;
        return;
      case 'debug':
        return room?.debug(this.seat, m.cmd);
    }
  }

  private join(room: MatchRoom): void {
    const seat = room.seatOf(this.player);
    if (!seat) throw new Error('No seat for this player in that match');
    this.room = room;
    this.seat = seat;
    room.attach(seat, this);
  }

  private async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    await room?.detach(this.seat, this);
  }
}
