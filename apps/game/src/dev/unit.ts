// Dev page (/dev/unit.html?u=<id>): one unit's picture (if it has art), what it does and its numbers.
// Not part of the game build.
import { tagsHtml } from './cards';
import { unitStatsHtml } from './details';
import { mountAnimPlayer } from './anim';
import { mountModel } from './model';
import { mountPictureViews } from './pictureView';
import { mountPicture } from './picture';
import { DEV_UNITS } from './unitData';

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  const id = new URLSearchParams(location.search).get('u');
  const u = DEV_UNITS.find((x) => x.id === id);
  const info = document.getElementById('info')!;
  if (!u) {
    document.getElementById('title')!.textContent = 'Unknown unit';
    info.innerHTML = '<p>No unit with that id. <a href="./units.html">See all units</a></p>';
  } else {
    document.getElementById('title')!.textContent = u.name;
    document.title = u.name;
    info.innerHTML = `
      <div class="pic${u.anims ? ' anim' : ''}">${u.picture ? '' : '<span class="none">No art yet</span>'}</div>
      <div class="body">
        ${tagsHtml(u, u.category, u.role)}
        <p class="desc">${u.description}</p>
        ${unitStatsHtml(u)}
        <p class="note">${u.note}</p>
      </div>`;
    // with animations, the player shows it at the game's size: only the high-res picture is left to show here
    if (u.picture && (u.preview || !u.anims)) {
      const pics = document.createElement('section');
      pics.className = 'unit-picture';
      info.after(pics);
      mountPictureViews(pics, u.picture.file, u.picture.frame, u.preview, !u.anims);
    }
    if (u.models?.length) {
      const box = document.createElement('section');
      box.className = 'unit-model';
      box.innerHTML = `<div class="model-wait"><button class="primary">Show the 3D model</button>
        <small>${u.models.length > 1 ? `${u.models.length} clips, ` : ''}about 20 MB each, loaded one at a time; the rifle is added at render time</small></div>`;
      box.querySelector('button')!.onclick = () => void mountModel(box, u.models!);
      (document.querySelector('.unit-picture') ?? info).after(box);
    }
    if (u.anims) {
      mountAnimPlayer(info.querySelector<HTMLElement>('.pic')!, u.anims)
        .catch(() => { info.querySelector('.pic')!.textContent = 'animations missing'; });
    } else if (u.picture) {
      mountPicture(info.querySelector<HTMLElement>('.pic')!, u.picture.file, u.picture.frame)
        .catch(() => { info.querySelector('.pic')!.textContent = 'picture missing'; });
    }
  }
}
