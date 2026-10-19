import { describe, expect, it } from 'vitest';
import { isPlayerId } from './player.js';

describe('isPlayerId', () => {
  it('accepts a lowercase UUID', () => {
    expect(isPlayerId('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of [
      undefined,
      null,
      42,
      '',
      'abc',
      '3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B',
      ' 3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b',
      '3f2b8c1e9a4d4e6f8b2a1c3d5e7f9a0b',
    ]) {
      expect(isPlayerId(v)).toBe(false);
    }
  });
});
