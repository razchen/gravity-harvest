// Dev page (/dev/unit.html?u=<id>&mode=animation|picture|model): one unit, like the building pages: tabs for its
// animations (as the game draws them), its high-resolution picture and its source model, what it does and its numbers.
// Not part of the game build.
import { tagsHtml } from './cards';
import { unitStatsHtml } from './details';
import { mountAnimPlayer } from './anim';
import { mountModel } from './model';
import { mountPictureViews } from './pictureView';
import { mountPicture } from './picture';
import { LINK, ground } from './ui';
import { DEV_UNITS, type DevUnit } from './unitData';
import { ARMED, mountWeaponView } from './weapons';

type Mode = 'animation' | 'picture' | 'model';

/** The tabs a unit has: its animations, its picture (high-res, or the sprite where it has no animations), its model. */
function modes(u: DevUnit): Mode[] {
  return [
    ...(u.anims ? ['animation' as const] : []),
    ...(u.picture && (u.preview || !u.anims) ? ['picture' as const] : []),
    ...(u.models?.length ? ['model' as const] : []),
  ];
}

/** Set up the page in the markup the sidebar has just put in (nav.ts). */
export default function mount(): void {
  const params = new URLSearchParams(location.search);
  const u = DEV_UNITS.find((x) => x.id === params.get('u'));
  const $ = (id: string) => document.getElementById(id)!;
  const view = $('view');
  if (!u) {
    $('title').textContent = 'Unknown unit';
    view.hidden = true;
    $('details').innerHTML = `<p class="my-[1em]">No unit with that id. <a class="${LINK}" href="./units.html">See all units</a></p>`;
    return;
  }
  const have = modes(u);
  const asked = params.get('mode') as Mode | null;
  const mode = asked && have.includes(asked) ? asked : have[0];
  const title = { animation: 'Animation', picture: 'Picture', model: '3D model' };
  $('title').textContent = mode ? `${u.name}: ${title[mode].toLowerCase()}` : u.name;
  document.title = mode ? `${u.name} ${title[mode]}` : u.name;
  $('blurb').textContent = mode ? {
    animation: 'As the game draws it, in every direction: pick an animation, turn it round, and see it at the game\'s size or close up.',
    picture: 'Rendered from its model at high resolution.',
    model: 'The source model the sprites are rendered from. Drag to orbit, scroll to zoom. It loads only here, and is let go when you leave.',
  }[mode] : '';
  const where = u.builtAt.length ? ` · built at ${u.builtAt.join(' or ')}` : '';
  $('about').innerHTML = `${u.description} <span>· $${u.cost.toLocaleString('en')} · ${+u.buildTimeSec.toFixed(1)} s to build${where}${u.needs.length ? ` · needs ${u.needs.join(', ')}` : ''}</span>`;
  for (const a of $('tabs').querySelectorAll<HTMLAnchorElement>('a')) {
    a.href = `?u=${encodeURIComponent(u.id)}&mode=${a.dataset.mode}`;
    a.classList.toggle('on', a.dataset.mode === mode);
    a.hidden = !have.includes(a.dataset.mode as Mode);
  }
  $('details').innerHTML = `
    ${tagsHtml(u, u.category, u.role)}
    ${unitStatsHtml(u)}
    <p class="italic text-muted">${u.note}</p>`;

  if (mode === 'animation') {
    view.classList.add(...ground(128).split(' '));
    mountAnimPlayer(view, u.anims!).catch(() => { view.textContent = 'animations missing'; });
    if (ARMED.includes(u.id)) {
      // its shots as a match draws them (the player above doesn't draw them)
      const shots = document.createElement('section');
      shots.className = 'mx-4 mt-3.5';
      shots.innerHTML = `<h2 class="mb-1.5 text-[17px] font-bold">Shooting</h2>
        <p class="mb-2 text-muted">As a match draws its shots, from its own guns, in its side's colour. Drag to pan.</p>
        <div class="relative flex min-h-[480px] flex-col overflow-hidden rounded-[6px] border border-line"></div>`;
      view.after(shots);
      mountWeaponView(shots.querySelector('div')!, { unit: u.id });
    }
  } else if (mode === 'picture') {
    view.classList.add(...ground(128).split(' '));
    // a unit with animations shows its game size there: here only the high-res picture
    if (u.anims || u.preview) mountPictureViews(view, u.picture!.file, u.picture!.frame, u.preview, !u.anims);
    else mountPicture(view, u.picture!.file, u.picture!.frame).catch(() => { view.textContent = 'picture missing'; });
  } else if (mode === 'model') {
    void mountModel(view, u.models!);
  } else {
    view.hidden = true;
    $('tabs').hidden = true;
    $('details').insertAdjacentHTML('afterbegin', '<p class="italic text-muted">No art yet.</p>');
  }
}
