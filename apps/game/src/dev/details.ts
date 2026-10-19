// A building's or unit's numbers from the rules, as the dev pages show them (cards and their pages).
import type { DevBuilding } from './buildings';
import type { DevUnit } from './unitData';

/** Names in a column on the left, numbers on the right (a page can size it from outside: [&>dl]:text-[16px]). */
const STATS = 'mt-0.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-px text-[14px] [&>dt]:text-muted';

export function statsHtml(b: DevBuilding): string {
  return `<dl class="${STATS}">
    <dt>Cost</dt><dd>$${b.cost.toLocaleString('en')}</dd>
    <dt>Power</dt><dd class="${b.power > 0 ? 'text-[#8fd36a]' : b.power < 0 ? 'text-[#ff9a7a]' : ''}">${b.power > 0 ? '+' : ''}${b.power}${b.requiresPower ? ' · stops on low power' : ''}</dd>
    <dt>Build</dt><dd>${+b.buildTimeSec.toFixed(1)} s</dd>
    <dt>HP</dt><dd>${b.hp.toLocaleString('en')} · ${b.armor}</dd>
    <dt>Needs</dt><dd>${b.needs.join(', ') || 'nothing'}</dd>
    ${b.makes.length ? `<dt>Makes</dt><dd>${b.makes.join(', ')}</dd>` : ''}
    ${b.weapons.length ? `<dt>Weapons</dt><dd>${b.weapons.join(', ')}</dd>` : ''}
  </dl>`;
}

export function unitStatsHtml(u: DevUnit): string {
  return `<dl class="${STATS}">
    <dt>Cost</dt><dd>$${u.cost.toLocaleString('en')}</dd>
    <dt>Build</dt><dd>${+u.buildTimeSec.toFixed(1)} s</dd>
    <dt>HP</dt><dd>${u.hp.toLocaleString('en')} · ${u.armor}</dd>
    <dt>Speed</dt><dd>${u.speed}</dd>
    <dt>Built at</dt><dd>${u.builtAt.join(' or ') || '—'}</dd>
    ${u.needs.length ? `<dt>Needs</dt><dd>${u.needs.join(', ')}</dd>` : ''}
    ${u.weapons.length ? `<dt>Weapons</dt><dd>${u.weapons.join(', ')}</dd>` : ''}
    ${u.passengers ? `<dt>Carries</dt><dd>${u.passengers} passengers</dd>` : ''}
  </dl>`;
}
