// Tailwind classes the dev pages' scripts share (dev/dev.css; the HTML pages spell the same ones out). A class like
// `primary` or `on` that a page toggles stays as a plain marker, styled here by a `[&.primary]:` variant.
import type { FactionScope } from './buildings';

/** A button; with `primary` (in the markup or toggled by a page) the gold one. */
export const BUTTON = 'cursor-pointer rounded-[4px] border border-line bg-panel px-3 py-1 font-semibold text-text hover:border-gold'
  + ' [&.primary]:min-w-[72px] [&.primary]:border-gold [&.primary]:bg-gold [&.primary]:text-ink';
export const SELECT = 'rounded-[4px] border border-line bg-panel px-1.5 py-[3px] text-text';
export const LABEL = 'inline-flex items-center gap-1.5 text-muted';
/** A checkbox keeps the browser's own margin (the reset takes it away). */
export const CHECKBOX = 'm-[3px_3px_3px_4px]';
export const LINK = 'text-gold hover:underline';

/** The game's ground under a picture or a unit (`size`: its tile in px). */
export const ground = (size: 128 | 256) =>
  `bg-[#8a6c47] bg-[url(/assets/terrain/dry_earth.png)] ${size === 128 ? 'bg-[length:128px]' : 'bg-[length:256px]'}`;

/** A picture's box (cards, info pages): mountPicture's img.fit fills it, an img.placed may spill past it. */
export const PIC = 'relative grid place-items-center'
  + ' [&>img.fit]:absolute [&>img.fit]:inset-0 [&>img.fit]:size-full [&>img.fit]:p-2.5 [&>img.fit]:object-contain'
  + ' [&>img.placed]:pointer-events-none [&>img.placed]:absolute [&>img.placed]:z-[1] [&>img.placed]:max-w-none';
/** "No art yet" over an empty picture. */
export const NONE = 'rounded-[4px] bg-[rgba(18,19,21,0.6)] px-2.5 py-0.5 font-semibold';

/** A bar of controls under a view (model, picture, animation). */
export const BAR = 'flex flex-wrap items-center border-t border-line bg-[rgba(18,19,21,0.85)] px-2.5 py-2';
export const STATUS = 'text-muted';

/** The tag row: release, side, then anything else. */
export const TAGS = 'flex flex-wrap items-center gap-1.5';
const TAG = 'rounded-[4px] px-2 text-[13px] font-bold';
export const TAG_V = `${TAG} bg-gold text-ink`;
export const tagSide = (f: FactionScope) => `${TAG} ${{
  both: 'bg-[#3a3d44] text-text', ordan: 'bg-[#3b2a66] text-[#efe6ff]', sable: 'bg-[#6e2a10] text-[#ffe9dc]',
}[f]}`;
export const ROLE = 'text-[13px] text-muted';

/** A label over a Phaser view, placed by the page (its <small>: the line under it). */
export const VIEW_LABEL = 'absolute -translate-x-1/2 whitespace-nowrap rounded-[4px] px-2 py-0.5 font-semibold';
