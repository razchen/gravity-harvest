import type { ClientMessage, MatchHello, ServerMessage } from '@gravity-harvest/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchClient, reconnectDelay, type MatchHandlers } from './MatchClient';

/** A stand-in for the browser's WebSocket: the test plays the server. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ClientMessage);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  // the server's side
  accept(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  say(m: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];
const hello = { t: 'hello', scenario: 'skirmish', you: 'a', reconnectMs: 5000 } as unknown as MatchHello & { t: 'hello' };

function handlers() {
  return { hello: vi.fn(), view: vi.fn(), gameOver: vi.fn(), failed: vi.fn(), error: vi.fn(), reconnecting: vi.fn(), reconnected: vi.fn() } satisfies MatchHandlers;
}

/** A client in a running match (hello received). */
function inMatch() {
  const on = handlers();
  const client = new MatchClient(on);
  client.start({ scenario: 'skirmish', autosaveOnLeave: true });
  latest().accept();
  latest().say(hello);
  return { on, client };
}

describe('the match connection', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits longer between tries, up to two seconds', () => {
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelay)).toEqual([250, 500, 1000, 2000, 2000, 2000]);
  });

  it('after a drop mid-match, reconnects and rejoins the same match', () => {
    const { on } = inMatch();
    expect(latest().sent).toEqual([{ t: 'start', scenario: 'skirmish', autosaveOnLeave: true }]);
    latest().close();
    expect(on.reconnecting).toHaveBeenCalledTimes(1);
    expect(on.failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(FakeSocket.all).toHaveLength(2);
    latest().accept();
    expect(latest().sent).toEqual([{ t: 'rejoin' }]);
    latest().say(hello);
    expect(on.reconnected).toHaveBeenCalledTimes(1);
    expect(on.hello).toHaveBeenCalledTimes(1); // the world isn't built again
    latest().say({ t: 'view' } as ServerMessage);
    expect(on.view).toHaveBeenCalledTimes(1);
  });

  it('keeps trying while the server is unreachable, and gives up when the server stops waiting', () => {
    const { on } = inMatch();
    latest().close();
    // every try fails to connect
    for (let ms = 0; ms < 5000; ms += 50) {
      vi.advanceTimersByTime(50);
      if (latest().readyState === 0) latest().close();
    }
    expect(on.reconnecting.mock.calls.length).toBeGreaterThan(3);
    expect(on.failed).toHaveBeenCalledTimes(1);
    expect(on.failed).toHaveBeenCalledWith('Connection to the server was lost');
    const sockets = FakeSocket.all.length;
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(sockets);
  });

  it('gives up when the match is gone (the server refuses the rejoin)', () => {
    const { on } = inMatch();
    latest().close();
    vi.advanceTimersByTime(250);
    latest().accept();
    latest().say({ t: 'error', message: 'No match to rejoin' });
    expect(on.failed).toHaveBeenCalledWith('Could not get back into the match: No match to rejoin');
    expect(on.error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('does not reconnect before the match started, after it is over, or after leaving on purpose', () => {
    const before = handlers();
    new MatchClient(before).start({ scenario: 'skirmish', autosaveOnLeave: false });
    latest().close();
    expect(before.failed).toHaveBeenCalledWith('Could not reach the game server');
    expect(before.reconnecting).not.toHaveBeenCalled();

    const over = inMatch();
    latest().say({ t: 'gameOver', result: 'victory', stats: {} } as ServerMessage);
    latest().close();
    expect(over.on.reconnecting).not.toHaveBeenCalled();

    const left = inMatch();
    left.client.close();
    vi.advanceTimersByTime(10_000);
    expect(left.on.reconnecting).not.toHaveBeenCalled();
    expect(left.on.failed).not.toHaveBeenCalled();

    // leaving while it's reconnecting stops the tries
    const quitting = inMatch();
    latest().close();
    const sockets = FakeSocket.all.length;
    quitting.client.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(sockets);
  });
});
