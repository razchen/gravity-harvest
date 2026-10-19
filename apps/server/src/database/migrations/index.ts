import { InitialSchema1792281600000 } from './1792281600000-initial-schema.js';
import { SaveOwner1792281660000 } from './1792281660000-save-owner.js';

/**
 * Every migration, oldest first. Listed by hand rather than found by a file glob so the same list works from
 * `src/` (tests, watch mode) and `dist/` (compiled), and a migration can't be skipped by a build that misses a file.
 */
export const MIGRATIONS = [InitialSchema1792281600000, SaveOwner1792281660000];
