// The Sounds dev page's categories, in order: the sidebar (nav.ts) links each, the page (sounds.ts) shows one at a time.
export const SOUND_GROUPS = [
  'Weapons', 'Hits and explosions', 'Units', 'Buildings', 'Interface and alerts', 'Music and ambience',
  'Ordan announcer', 'Ordan unit voices', 'Sable announcer', 'Sable unit voices',
] as const;

/** A category's id in the page's address (`?g=hits-and-explosions`). */
export const groupId = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '-');
