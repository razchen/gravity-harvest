import { describe, expect, it, vi } from 'vitest';
import { EventBus, emptyStats, type GameEvents } from './EventBus';

describe('EventBus', () => {
  it('delivers to subscribers and supports unsubscribe', () => {
    const bus = new EventBus<GameEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on('toast', a);
    bus.on('toast', b);
    bus.emit('toast', 'hello');
    offA();
    bus.emit('toast', 'again');
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('hello');
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('keeps events separate', () => {
    const bus = new EventBus<GameEvents>();
    const over = vi.fn();
    bus.on('gameOver', over);
    bus.emit('toast', 'x');
    expect(over).not.toHaveBeenCalled();
    const payload = { result: 'victory' as const, stats: emptyStats() };
    bus.emit('gameOver', payload);
    expect(over).toHaveBeenCalledWith(payload);
  });
});
