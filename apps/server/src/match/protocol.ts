import { SAVE_KINDS, type ClientMessage, type Command, type DebugCommand } from '@gravity-harvest/shared';

// Everything from a socket is untrusted: check the shape of each message before the simulation sees it.

const MAX_IDS = 200;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isInteger(v);
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= MAX_IDS && v.every(int);
const team = (v: unknown) => v === 'player' || v === 'enemy';
const point = (v: unknown) => isObj(v) && num(v.gx) && num(v.gy);

function command(c: unknown): c is Command {
  if (!isObj(c)) return false;
  switch (c.c) {
    case 'move':
      return Array.isArray(c.orders) && c.orders.length <= MAX_IDS && c.orders.every((o) => isObj(o) && int(o.id) && num(o.gx) && num(o.gy));
    case 'attack':
      return ids(c.units) && int(c.target);
    case 'harvest':
      return ids(c.units) && int(c.tx) && int(c.ty);
    case 'dock':
      return ids(c.units) && int(c.refinery);
    case 'stop':
      return ids(c.units);
    case 'place':
      return str(c.building) && int(c.tx) && int(c.ty);
    case 'train':
      return str(c.unit) && (c.near === undefined || point(c.near));
    case 'cancelTrain':
      return str(c.unit);
    case 'sell':
    case 'cancelBuild':
      return int(c.building);
    case 'repair':
      return int(c.building) && typeof c.on === 'boolean';
    case 'deploy':
      return int(c.unit);
    default:
      return false;
  }
}

function debug(d: unknown): d is DebugCommand {
  if (!isObj(d)) return false;
  switch (d.d) {
    case 'credits':
      return num(d.amount);
    case 'reveal':
      return typeof d.on === 'boolean';
    case 'fast':
      return num(d.factor) && d.factor >= 1 && d.factor <= 20;
    case 'teleport':
      return ids(d.units) && num(d.gx) && num(d.gy);
    case 'spawn':
      return str(d.unit) && team(d.team) && num(d.gx) && num(d.gy);
    case 'destroyTeam':
      return team(d.team) && typeof d.units === 'boolean' && typeof d.buildings === 'boolean';
    case 'addTime':
      return num(d.ms) && d.ms >= 0;
    case 'finishBuilds':
      return true;
    default:
      return false;
  }
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
      return m as ClientMessage;
    case 'cmd':
      return command(m.cmd) ? (m as ClientMessage) : null;
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
      return debug(m.cmd) ? (m as ClientMessage) : null;
    default:
      return null;
  }
}
