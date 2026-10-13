import { describe, expect, it } from 'vitest';
import { SAVE_LIMITS, validateSaveInput, type SaveGameInput } from './saves.js';

const valid: SaveGameInput = { name: 'My base', scenario: 'skirmish', version: 1, gameTimeMs: 1234, thumbnail: null, state: { a: 1 } };

describe('validateSaveInput', () => {
  it('accepts a valid save', () => {
    expect(validateSaveInput(valid)).toEqual([]);
  });

  it('rejects an empty or too long name', () => {
    expect(validateSaveInput({ ...valid, name: '   ' })).toContain('name must not be empty');
    expect(validateSaveInput({ ...valid, name: 'x'.repeat(SAVE_LIMITS.nameMax + 1) })[0]).toMatch(/at most/);
  });

  it('rejects non-object state', () => {
    for (const state of [[], null, 'x', 3]) {
      expect(validateSaveInput({ ...valid, state: state as never })).toContain('state must be a JSON object');
    }
  });

  it('rejects bad numbers', () => {
    expect(validateSaveInput({ ...valid, version: 0 })).toContain('version must be an integer >= 1');
    expect(validateSaveInput({ ...valid, gameTimeMs: -1 })).toContain('gameTimeMs must be an integer >= 0');
    expect(validateSaveInput({ ...valid, gameTimeMs: 1.5 })).toContain('gameTimeMs must be an integer >= 0');
  });

  it('checks the kind', () => {
    expect(validateSaveInput({ ...valid, kind: 'auto' })).toEqual([]);
    expect(validateSaveInput({ ...valid, kind: 'other' as never })).toEqual(['kind must be one of manual, auto']);
  });

  it('checks thumbnails', () => {
    expect(validateSaveInput({ ...valid, thumbnail: 'data:image/png;base64,iVBORw0KGgo=' })).toEqual([]);
    expect(validateSaveInput({ ...valid, thumbnail: 'data:image/gif;base64,R0lGOD' })).toHaveLength(1);
  });
});
