// Save-game API contract: GET/POST /api/saves, GET/PUT/DELETE /api/saves/:id.
// The server validates against SAVE_LIMITS; the client uses the same numbers for its forms.

export const SAVE_LIMITS = {
  nameMax: 80,
  scenarioMax: 64,
  /** ~512 KB of image data once base64-encoded, plus the data URL prefix. */
  thumbnailMax: 700_000,
  listDefault: 50,
  listMax: 100,
} as const;

/** Manual saves are made by the player; autosaves by the game (one slot per scenario, overwritten). */
export const SAVE_KINDS = ['manual', 'auto'] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];

export const THUMBNAIL_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A stored save as returned by GET /saves/:id, POST and PUT. `state` is opaque to the server. */
export interface SaveGame {
  id: string;
  name: string;
  scenario: string;
  kind: SaveKind;
  /** Save-format version written by the client (the game's SNAPSHOT_VERSION). */
  version: number;
  /** In-game elapsed time when saved. */
  gameTimeMs: number;
  thumbnail: string | null;
  state: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Each item of GET /saves (the heavy `state` is left out). */
export type SaveGameSummary = Omit<SaveGame, 'state'>;

/** Body of POST /saves (create) and PUT /saves/:id (full overwrite). */
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

/** Client-side check mirroring the server's validation (so the UI can fail fast with a clear message). */
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
