// Dev page (/dev/units.html): a card per unit, linking to its page. Not part of the game build.
import { mountGallery, tagsHtml } from './cards';
import { unitStatsHtml } from './details';
import { DEV_UNITS, UNIT_KINDS } from './unitData';

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  mountGallery(DEV_UNITS.map((u) => ({
    faction: u.faction,
    milestone: u.milestone,
    kind: u.kind,
    href: `./unit.html?u=${u.id}`,
    ready: Boolean(u.picture),
    picture: u.picture,
    body: `
      <h2>${u.name}<small>${u.category}</small></h2>
      ${tagsHtml(u, u.role)}
      <p class="desc">${u.description}</p>
      ${unitStatsHtml(u)}
      <p class="note">${u.note}</p>`,
  })), 'unit', UNIT_KINDS);
}
