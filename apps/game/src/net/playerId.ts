// This browser's anonymous player id. There are no accounts: the id is made once, kept in localStorage, and sent with
// every saves request and the match socket, so the server shows each browser only its own saves.
import { isPlayerId } from '@gravity-harvest/shared';

const KEY = 'gravity-harvest:player-id';

let cached: string | null = null;

/** The id, made on first use. When storage is unavailable it lasts for this page only (saves then can't be found after a reload). */
export function playerId(): string {
  if (cached) return cached;
  try {
    const kept = localStorage.getItem(KEY);
    if (isPlayerId(kept)) return (cached = kept);
  } catch {
    /* storage unavailable: a fresh id for this page */
  }
  cached = newId();
  try {
    localStorage.setItem(KEY, cached);
  } catch {
    /* not kept */
  }
  return cached;
}

/** crypto.randomUUID needs a secure context (https or localhost); over plain http on a LAN, build a v4 UUID by hand. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
