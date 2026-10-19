import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_SERVER_PORT } from '@gravity-harvest/shared';

/** Strongly typed runtime configuration for the server. */
export interface AppConfig {
  /** HTTP port to listen on. */
  port: number;
  /** Absolute path to the SQLite database file, or `:memory:`. */
  databasePath: string;
  /** Origins allowed by CORS. */
  corsOrigins: string[];
  /** Max accepted JSON body size (body-parser syntax, e.g. "10mb"). */
  bodyLimit: string;
  /**
   * Whether TypeORM should also auto-sync the schema to the entities after the migrations ran (development and
   * tests only, never production: migrations own the schema there).
   */
  dbSynchronize: boolean;
  /** Whether TypeORM should log SQL. */
  dbLogging: boolean;
  /** Accept debug commands over the match socket (dev and tests; never in production). */
  debugCommands: boolean;
  /** How long a match waits, paused, for a player whose connection dropped to rejoin before it is closed (ms). */
  reconnectGraceMs: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Root of the server package (works from both `src/config` and `dist/config`). */
export const SERVER_ROOT = resolve(import.meta.dirname, '..', '..');

export const DEFAULTS = {
  port: DEFAULT_SERVER_PORT,
  databasePath: 'data/gravity-harvest.sqlite',
  corsOrigin: 'http://localhost:5173',
  bodyLimit: '10mb',
  reconnectGraceMs: 60_000,
} as const;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULTS.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535`);
  }
  return port;
}

function parseMs(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`Invalid ${name} "${raw}": expected a whole number of milliseconds`);
  return ms;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function resolveDatabasePath(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULTS.databasePath;
  if (value === ':memory:') return value;
  return isAbsolute(value) ? value : resolve(SERVER_ROOT, value);
}

/** Parse and validate configuration from environment variables, applying defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const corsOrigins = (env.CORS_ORIGIN ?? DEFAULTS.corsOrigin)
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return {
    port: parsePort(env.PORT),
    databasePath: resolveDatabasePath(env.DATABASE_PATH),
    corsOrigins,
    bodyLimit: env.BODY_LIMIT?.trim() || DEFAULTS.bodyLimit,
    dbSynchronize: parseBool(env.DB_SYNCHRONIZE, env.NODE_ENV !== 'production'),
    dbLogging: parseBool(env.DB_LOGGING, false),
    debugCommands: parseBool(env.DEBUG_COMMANDS, env.NODE_ENV !== 'production'),
    reconnectGraceMs: parseMs(env.RECONNECT_GRACE_MS, DEFAULTS.reconnectGraceMs, 'RECONNECT_GRACE_MS'),
  };
}
