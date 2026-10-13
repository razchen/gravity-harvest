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
  /** Whether TypeORM should auto-sync the schema (dev only; use migrations later). */
  dbSynchronize: boolean;
  /** Whether TypeORM should log SQL. */
  dbLogging: boolean;
  /** Accept debug commands over the match socket (dev and tests; never in production). */
  debugCommands: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Root of the server package (works from both `src/config` and `dist/config`). */
export const SERVER_ROOT = resolve(import.meta.dirname, '..', '..');

export const DEFAULTS = {
  port: DEFAULT_SERVER_PORT,
  databasePath: 'data/gravity-harvest.sqlite',
  corsOrigin: 'http://localhost:5173',
  bodyLimit: '10mb',
} as const;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULTS.port;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535`);
  }
  return port;
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
    dbSynchronize: parseBool(env.DB_SYNCHRONIZE, true),
    dbLogging: parseBool(env.DB_LOGGING, false),
    debugCommands: parseBool(env.DEBUG_COMMANDS, env.NODE_ENV !== 'production'),
  };
}
