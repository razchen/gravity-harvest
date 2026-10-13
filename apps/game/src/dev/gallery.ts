// Dev page (/dev/): a card per building, linking to its page (construction and destruction, or its details).
// Not part of the game build.
import { DEV_BUILDINGS } from './buildings';
import { mountGallery, tagsHtml } from './cards';
import { statsHtml } from './details';

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  mountGallery(DEV_BUILDINGS.map((b) => ({
    faction: b.faction,
    milestone: b.milestone,
    href: `./building.html?b=${b.id}`,
    ready: Boolean(b.construction),
    picture: b.picture,
    preview: b.preview,
    body: `
      <h2>${b.name}<small>${b.footprint}×${b.footprint}</small></h2>
      ${tagsHtml(b, b.role)}
      <p class="desc">${b.description}</p>
      ${statsHtml(b)}
      <p class="note">${b.note}</p>
      <span class="chip">${b.construction ? '3D model · construction · destruction' : 'Details · no stages yet'}</span>`,
  })), 'building');
}
