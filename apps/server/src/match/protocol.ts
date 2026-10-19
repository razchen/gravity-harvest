import { DIFFICULTIES, SAVE_KINDS, TEAMS, type ClientMessage, type Command, type DebugCommand } from '@gravity-harvest/shared';

// Everything from a socket is untrusted: check the shape of each message before the simulation sees it.

const MAX_IDS = 200;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= MAX_IDS && v.every(int);
const team = (v: unknown) => TEAMS.includes(v as never);
const point = (v: unknown) => isObj(v) && num(v.gx) && num(v.gy);
const orders = (v: unknown) => Array.isArray(v) && v.length <= MAX_IDS && v.every((o) => isObj(o) && int(o.id) && num(o.gx) && num(o.gy));

type CommandName = Command['c'];
type Fields = Record<string, unknown>;

/**
 * One shape check per command. Typed as a full map over `Command['c']` so adding a command to the protocol without
 * a check here is a compile error, not a "Malformed message" at runtime.
 */
export type CommandChecks = { readonly [K in CommandName]: (c: Fields) => boolean };

const COMMANDS: CommandChecks = {
  move: (c) => orders(c.orders),
  attackMove: (c) => orders(c.orders),
  attack: (c) => ids(c.units) && int(c.target),
  harvest: (c) => ids(c.units) && int(c.tx) && int(c.ty),
  dock: (c) => ids(c.units) && int(c.refinery),
  service: (c) => ids(c.units) && int(c.bay),
  stop: (c) => ids(c.units),
  place: (c) => str(c.building) && int(c.tx) && int(c.ty),
  train: (c) => str(c.unit) && (c.near === undefined || point(c.near)),
  cancelTrain: (c) => str(c.unit),
  sell: (c) => int(c.building),
  cancelBuild: (c) => int(c.building),
  repair: (c) => int(c.building) && typeof c.on === 'boolean',
  support: (c) => ids(c.units) && int(c.target),
  deploy: (c) => int(c.unit),
  board: (c) => ids(c.units) && int(c.transport),
  unload: (c) => int(c.transport),
};

/** Is this a known command with the right fields? */
export function isCommand(c: unknown): c is Command {
  if (!isObj(c) || typeof c.c !== 'string' || !Object.hasOwn(COMMANDS, c.c)) return false;
  return COMMANDS[c.c as CommandName](c);
}

/** The same for debug commands. */
const DEBUG: { readonly [K in DebugCommand['d']]: (d: Fields) => boolean } = {
  credits: (d) => num(d.amount),
  reveal: (d) => typeof d.on === 'boolean',
  fast: (d) => num(d.factor) && d.factor >= 1 && d.factor <= 20,
  teleport: (d) => ids(d.units) && num(d.gx) && num(d.gy),
  spawn: (d) => str(d.unit) && team(d.team) && num(d.gx) && num(d.gy),
  destroyTeam: (d) => team(d.team) && typeof d.units === 'boolean' && typeof d.buildings === 'boolean',
  addTime: (d) => num(d.ms) && d.ms >= 0,
  finishBuilds: () => true,
};

function isDebugCommand(d: unknown): d is DebugCommand {
  if (!isObj(d) || typeof d.d !== 'string' || !Object.hasOwn(DEBUG, d.d)) return false;
  return DEBUG[d.d as DebugCommand['d']](d);
}

/** Parse and check a raw socket message. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'start':
      if (typeof m.autosaveOnLeave !== 'boolean') return null;
      if ((m.scenario === undefined) === (m.saveId === undefined)) return null;
      if (m.scenario !== undefined && !str(m.scenario)) return null;
      if (m.saveId !== undefined && !str(m.saveId)) return null;
      if (m.faction !== undefined && m.faction !== 'ordan' && m.faction !== 'sable') return null;
      if (m.difficulty !== undefined && !DIFFICULTIES.includes(m.difficulty as never)) return null;
      if (m.seat !== undefined && !team(m.seat)) return null;
      return m as ClientMessage;
    case 'cmd':
      return isCommand(m.cmd) ? (m as ClientMessage) : null;
    case 'pause':
    case 'resume':
    case 'end':
      return m as ClientMessage;
    case 'save':
      if (!int(m.req) || typeof m.name !== 'string' || !SAVE_KINDS.includes(m.kind as never)) return null;
      if (m.overwriteId !== undefined && !str(m.overwriteId)) return null;
      if (m.thumbnail !== null && typeof m.thumbnail !== 'string') return null;
      return m as ClientMessage;
    case 'debug':
      return isDebugCommand(m.cmd) ? (m as ClientMessage) : null;
    default:
      return null;
  }
}
