// Save-game API contract. Over HTTP saves are only listed, read and deleted: GET /api/saves, GET and DELETE
// /api/saves/:id, each scoped to the player id in the PLAYER_ID_HEADER header (player.ts). Saves are written only by
// the server's running match, on the `save` socket message (match.ts), so a player can't upload a doctored state.
// The server validates against SAVE_LIMITS; the client uses the same numbers for its forms.

export const SAVE_LIMITS = {
  nameMax: 80,
  scenarioMax: 64,
  /** ~512 KB of image data once base64-encoded, plus the data URL prefix. */
  thumbnailMax: 700_000,
  listDefault: 50,
  listMax: 100,
} as const;

/** Manual saves are made by the player; autosaves by the game (one slot per player and scenario, overwritten). */
export const SAVE_KINDS = ['manual', 'auto'] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

export const THUMBNAIL_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A stored save. `state` is the match's SimSnapshot: it stays on the server and is never sent to players. */
export interface SaveGame {
  id: string;
  name: string;
  scenario: string;
  kind: SaveKind;
  /** Snapshot format version the server's match wrote (packages/sim's SNAPSHOT_VERSION). */
  version: number;
  /** In-game elapsed time when saved. */
  gameTimeMs: number;
  thumbnail: string | null;
  state: unknown;
  createdAt: string;
  updatedAt: string;
}

/** What GET /saves (each item) and GET /saves/:id return, and the `saved` socket reply: everything but `state`. */
export type SaveGameSummary = Omit<SaveGame, 'state'>;

/** What the server's match hands SavesService to create or overwrite a save (never sent over HTTP). */
export interface SaveGameInput {
  name: string;
  scenario: string;
  /** Defaults to 'manual'. */
  kind?: SaveKind;
  version: number;
  gameTimeMs: number;
  thumbnail?: string | null;
  state: Record<string, unknown>;
}

export interface ListSavesQuery {
  scenario?: string;
  kind?: SaveKind;
  limit?: number;
}

/** The checks SavesService runs on every save it writes. Returns one message per problem (empty when valid). */
export function validateSaveInput(input: SaveGameInput): string[] {
  const errors: string[] = [];
  const name = input.name?.trim() ?? '';
  if (!name) errors.push('name must not be empty');
  if (name.length > SAVE_LIMITS.nameMax) errors.push(`name must be at most ${SAVE_LIMITS.nameMax} characters`);
  if (!input.scenario || input.scenario.length > SAVE_LIMITS.scenarioMax) errors.push('scenario is invalid');
  if (input.kind !== undefined && !SAVE_KINDS.includes(input.kind)) errors.push(`kind must be one of ${SAVE_KINDS.join(', ')}`);
  if (!Number.isInteger(input.version) || input.version < 1) errors.push('version must be an integer >= 1');
  if (!Number.isInteger(input.gameTimeMs) || input.gameTimeMs < 0) errors.push('gameTimeMs must be an integer >= 0');
  if (input.thumbnail != null && (input.thumbnail.length > SAVE_LIMITS.thumbnailMax || !THUMBNAIL_PATTERN.test(input.thumbnail))) {
    errors.push('thumbnail must be a base64 PNG or JPEG data URL under the size limit');
  }
  if (input.state === null || typeof input.state !== 'object' || Array.isArray(input.state)) errors.push('state must be a JSON object');
  return errors;
}
