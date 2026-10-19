// Anonymous player id. There are no accounts: each browser makes a random UUID once and keeps it, and the server
// scopes saves to it. It keeps players from seeing each other's saves; it is not a secret or a login.

/** HTTP requests for saves carry the id in this header. */
export const PLAYER_ID_HEADER = 'x-player-id';
/** The match WebSocket carries it as this query parameter (a browser can't set headers on a WebSocket). */
export const PLAYER_ID_PARAM = 'player';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A lowercase UUID, the shape crypto.randomUUID makes. */
export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}
