import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { DEFAULTS, loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4310);
    expect(config.corsOrigins).toEqual([DEFAULTS.corsOrigin]);
    expect(isAbsolute(config.databasePath)).toBe(true);
    expect(config.databasePath.endsWith('data/gravity-harvest.sqlite')).toBe(true);
    expect(config.bodyLimit).toBe('10mb');
  });

  it('parses overrides', () => {
    const config = loadConfig({
      PORT: '4000',
      DATABASE_PATH: ':memory:',
      CORS_ORIGIN: 'http://a.test, http://b.test',
    });
    expect(config).toMatchObject({
      port: 4000,
      databasePath: ':memory:',
      corsOrigins: ['http://a.test', 'http://b.test'],
    });
  });

  it('syncs the schema and accepts debug commands only outside production', () => {
    expect(loadConfig({})).toMatchObject({ dbSynchronize: true, debugCommands: true });
    expect(loadConfig({ NODE_ENV: 'production' })).toMatchObject({ dbSynchronize: false, debugCommands: false });
    expect(loadConfig({ NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' }).dbSynchronize).toBe(true);
    expect(loadConfig({ DB_SYNCHRONIZE: 'false' }).dbSynchronize).toBe(false);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
  });
});
