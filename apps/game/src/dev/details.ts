// A building's or unit's numbers from the rules, as the dev pages show them (cards and their pages).
import type { DevBuilding } from './buildings';
import type { DevUnit } from './unitData';

export function statsHtml(b: DevBuilding): string {
  return `<dl class="stats">
    <dt>Cost</dt><dd>$${b.cost.toLocaleString('en')}</dd>
    <dt>Power</dt><dd class="${b.power > 0 ? 'plus' : b.power < 0 ? 'minus' : ''}">${b.power > 0 ? '+' : ''}${b.power}${b.requiresPower ? ' · stops on low power' : ''}</dd>
    <dt>Build</dt><dd>${+b.buildTimeSec.toFixed(1)} s</dd>
    <dt>HP</dt><dd>${b.hp.toLocaleString('en')} · ${b.armor}</dd>
    <dt>Needs</dt><dd>${b.needs.join(', ') || 'nothing'}</dd>
    ${b.makes.length ? `<dt>Makes</dt><dd>${b.makes.join(', ')}</dd>` : ''}
    ${b.weapons.length ? `<dt>Weapons</dt><dd>${b.weapons.join(', ')}</dd>` : ''}
  </dl>`;
}

export function unitStatsHtml(u: DevUnit): string {
  return `<dl class="stats">
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
