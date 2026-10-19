// Dev page (/dev/sounds.html): pick the game's sound effects and music from the candidate files in art/audio (served by
// the dev server, vite.config.ts artAudio). Each slot is a sound the game will play; its picks (one or more files, one
// played at random) are saved to tools/audio/picks.json, which the audio packer reads. Not part of the game build.
import { onLeave } from './page';
import { groupId } from './soundGroups';

type Kind = 'once' | 'loop' | 'music' | 'voice';

interface Slot {
  id: string;
  name: string;
  /** When a match plays it (scenes/GameScene.ts, input/InputController.ts, app/GameFlow.ts). */
  note: string;
  kind: Kind;
  /** Hooked up in matches (false: made ready for something the game doesn't have yet). */
  game: boolean;
  /** Why it isn't played yet. */
  later?: string;
}

/** The sounds the game needs, by group. */
const SLOTS: { group: string; slots: Slot[] }[] = [
  {
    group: 'Weapons',
    slots: [
      { id: 'rifle_fire', name: 'Rifle burst', note: 'a soldier fires (riflemen)', kind: 'once', game: true },
      { id: 'autocannon_fire', name: 'Autocannon', note: 'a vehicle or a defence fires bullets (Skimmer, Carrier, Sentry)', kind: 'once', game: true },
      { id: 'cannon_fire', name: 'Cannon shot', note: 'a shell is fired: a Jackal, a Ram or the Lance Battery', kind: 'once', game: true },
      { id: 'rocket_launch', name: 'Rocket launch', note: 'a guided missile is fired', kind: 'once', game: false, later: 'the Lancer, the first rocket unit, isn\'t in yet' },
      { id: 'plasma_fire', name: 'Energy balls', note: 'the Hound fires a ball from each side pod', kind: 'once', game: true },
      { id: 'laser_fire', name: 'Laser', note: 'a Lancer fires its laser from its two pods', kind: 'once', game: true },
      { id: 'column_fire', name: 'Column of light', note: 'a Breaker\'s column of light strikes its target', kind: 'once', game: true },
      { id: 'artillery_fire', name: 'Artillery', note: 'the Spire fires', kind: 'once', game: true },
      { id: 'flame_fire', name: 'Fireball', note: 'the Incinerator fires', kind: 'once', game: true },
      { id: 'discharge_fire', name: 'Discharge', note: 'the Anchor fires its gravity discharge', kind: 'once', game: true },
      { id: 'sidearm_fire', name: 'Pistol shots', note: 'the Operator fires (a rifle burst until picked)', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'flamethrower_fire', name: 'Flamethrower', note: 'the Breaker fires', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'grenade_throw', name: 'Grenade throw', note: 'the Grenadier throws', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'heavy_missile_launch', name: 'Heavy missile launch', note: 'the Salvo fires its missile', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'heal_beam', name: 'Healing', note: 'the Medic heals a soldier', kind: 'once', game: false, later: 'the Medic is in, its healing shows no shot yet' },
      { id: 'hound_strike', name: 'Hound lunge', note: 'a Hound leaps at a soldier', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
    ],
  },
  {
    group: 'Hits and explosions',
    slots: [
      { id: 'bullet_hit', name: 'Bullet hit', note: 'bullets strike what they were fired at, as they land', kind: 'once', game: true },
      { id: 'shell_hit', name: 'Shell hit', note: 'a shell or fireball bursts, or a discharge strikes', kind: 'once', game: true },
      { id: 'rocket_hit', name: 'Rocket hit', note: 'a rocket bursts', kind: 'once', game: false, later: 'no rockets until the Lancer' },
      { id: 'vehicle_explode', name: 'Vehicle destroyed', note: 'a vehicle (harvesters too) is destroyed', kind: 'once', game: true },
      { id: 'building_explode', name: 'Building destroyed', note: 'a building is destroyed', kind: 'once', game: true },
      { id: 'grenade_explode', name: 'Grenade burst', note: "a Grenadier's grenade lands", kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'heavy_missile_hit', name: 'Heavy missile hit', note: "a Salvo's missile lands", kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'mine_explode', name: 'Mine goes off', note: "a vehicle drives over a Seeder's mine", kind: 'once', game: false, later: 'mines aren\'t in the game yet' },
      { id: 'infantry_explode', name: 'Soldier blows up', note: 'a Grenadier or Breaker is killed and what they carry goes off', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
      { id: 'infantry_death', name: 'Soldier down', note: 'a soldier is shot down (one out of sight is heard, not seen)', kind: 'once', game: true },
    ],
  },
  {
    group: 'Units',
    slots: [
      { id: 'mine_lay', name: 'Mine laid', note: 'a Seeder drops a mine', kind: 'once', game: false, later: 'mines aren\'t in the game yet' },
      { id: 'assembler_deploy', name: 'Assembler unfolds', note: 'an Assembler deploys into an Assembly Yard', kind: 'once', game: false, later: 'not hooked up yet' },
      { id: 'infiltrate', name: 'Slips inside', note: 'an Engineer, Infiltrator, Raider or Operator goes into a building', kind: 'once', game: false, later: 'entering buildings isn\'t in the game yet' },
      { id: 'demolition_charge', name: 'Demolition charge', note: 'an Operator blows up a building', kind: 'once', game: false, later: 'the Operator isn\'t in the game yet' },
      { id: 'jammer_on', name: 'Jammer on', note: 'a Watcher starts jamming radar', kind: 'once', game: false, later: 'not hooked up yet' },
      { id: 'cloak_field', name: 'Cloak field on', note: 'a Shroud hides the units around it', kind: 'once', game: false, later: 'not hooked up yet' },
      { id: 'self_repair', name: 'Self-repair', note: 'an Anvil mends itself', kind: 'once', game: false, later: 'the unit isn\'t in the game yet' },
    ],
  },
  {
    group: 'Buildings',
    slots: [
      { id: 'building_place', name: 'Building placed', note: 'you place a building and it starts going up', kind: 'once', game: true },
      { id: 'construction', name: 'Construction', note: 'while buildings go up: the 2 nearest the middle of the screen', kind: 'loop', game: true },
      { id: 'building_done', name: 'Building finished', note: 'a building finishes going up', kind: 'once', game: true },
      { id: 'building_sold', name: 'Sold', note: 'a building is sold (not when one still going up is cancelled)', kind: 'once', game: true },
      { id: 'door', name: 'Door', note: 'a unit comes out of the Barracks or Motor Works (the refinery bay is silent: every load was only noise)', kind: 'once', game: true },
      { id: 'power_down', name: 'Power down', note: 'your power runs low', kind: 'once', game: true },
      { id: 'power_up', name: 'Power back', note: 'your power is enough again', kind: 'once', game: true },
    ],
  },
  {
    group: 'Interface and alerts',
    slots: [
      { id: 'ui_click', name: 'Click', note: 'any button or build card is clicked', kind: 'once', game: true },
      { id: 'ui_hover', name: 'Hover', note: 'the pointer comes onto a build card', kind: 'once', game: true },
      { id: 'ui_error', name: "Can't", note: 'you are refused something: not enough money, a building missing first, a bad spot to build, the unit cap, a full queue…', kind: 'once', game: true },
      { id: 'unit_ready', name: 'Unit ready', note: 'a unit you trained is ready', kind: 'once', game: true },
      { id: 'building_ready', name: 'Construction complete', note: 'a building is ready to place', kind: 'once', game: false, later: 'buildings go up where they are placed: there is no "ready to place" moment yet' },
      { id: 'credits', name: 'Credits', note: 'money comes in (a harvester finishes unloading)', kind: 'once', game: true },
      { id: 'under_attack', name: 'Under attack', note: 'your buildings or units are hit, or an enemy raid is coming (at most every 15 s)', kind: 'once', game: true },
    ],
  },
  {
    group: 'Music and ambience',
    slots: [
      { id: 'music_menu', name: 'Menu music', note: 'title and menus (loops when it\'s the only pick; packed by tools/audio/pack_music.py)', kind: 'music', game: true },
      { id: 'music_battle', name: 'Battle music', note: 'during a match, the picks shuffled one after another (tools/audio/pack_music.py)', kind: 'music', game: true },
      { id: 'music_victory', name: 'Victory (Ordan)', note: 'you win as Ordan: played once, as the match\'s music fades', kind: 'music', game: true },
      { id: 'music_defeat', name: 'Defeat (Ordan)', note: 'you lose as Ordan: played once', kind: 'music', game: true },
      { id: 'music_sable_victory', name: 'Victory (Sable)', note: 'you win as Sable: played once, as the match\'s music fades', kind: 'music', game: true },
      { id: 'music_sable_defeat', name: 'Defeat (Sable)', note: 'you lose as Sable: played once', kind: 'music', game: true },
      { id: 'ambience', name: 'Ambience', note: 'always, under everything in a match', kind: 'loop', game: true },
    ],
  },
];

/** The groups above (the voices' are added each time the page mounts, after them). */
const BASE_GROUPS = SLOTS.length;
let ALL = SLOTS.flatMap((g) => g.slots);

/** When the announcer says each line (scenes/GameScene.ts). */
const ANNOUNCED: Record<string, string> = {
  announce_construction_complete: 'your building finishes',
  announce_unit_ready: 'a unit you trained is ready',
  announce_low_power: 'your power runs low',
  announce_power_restored: 'your power is enough again',
  announce_base_attack: 'your buildings or units are hit, or an enemy raid is coming (at most every 20 s); the Under attack alarm sounds first',
  announce_unit_lost: 'one of your units is destroyed',
  announce_building_lost: 'one of your buildings is destroyed',
  announce_insufficient_funds: "you can't afford something",
  announce_victory: 'you win the match',
  announce_defeat: 'you lose the match',
};
const ACK: Record<string, string> = { select: 'is selected', move: 'is ordered to move', attack: 'is ordered to attack' };

/** The voice lines' slots (tools/audio/voice_lines.json) as two more groups: the announcer, and each unit's answers. */
function addVoiceSlots(script: { slots: Record<string, { voice: string; lines: string[]; radio?: boolean; side?: string }> }): void {
  const announcer: Slot[] = [];
  const units: Slot[] = [];
  const sableAnnouncer: Slot[] = [];
  const sableUnits: Slot[] = [];
  for (const [id, v] of Object.entries(script.slots)) {
    // the Sable side's own voices (sable_<slot>): played instead of the plain slot when the player is Sable
    // (and the Sable-only units' voices: side 'sable')
    const sable = id.startsWith('sable_') || v.side === 'sable';
    const plain = id.replace(/^sable_/, '');
    const lines = v.lines.map((l) => `"${l}"`).join(' · ');
    if (plain.startsWith('announce_')) {
      (sable ? sableAnnouncer : announcer).push({ id, name: v.lines[0].replace(/\.$/, ''), note: `${ANNOUNCED[plain] ?? '…'}, in ${v.voice}'s voice`, kind: 'voice', game: true });
    } else {
      const [, unit, what] = plain.match(/^ack_(.+)_(select|move|attack)$/) ?? [];
      if (!unit) continue;
      const name = unit[0].toUpperCase() + unit.slice(1);
      (sable ? sableUnits : units).push({ id, name: `${name}: ${what}`, note: `the ${name} ${ACK[what]}: ${lines} (${v.voice}${v.radio ? ', on the radio' : ''})`, kind: 'voice', game: true });
    }
  }
  // the Hound barks and snarls: sound effects (tools/audio/sfx_prompts.json), not a voice
  for (const [what, sound] of [['select', 'barks'], ['move', 'barks and runs off'], ['attack', 'snarls']]) {
    sableUnits.push({ id: `ack_hound_${what}`, name: `Hound: ${what}`, note: `the Hound ${ACK[what]}: it ${sound}`, kind: 'once', game: false, later: "the unit isn't in the game yet" });
  }
  SLOTS.length = BASE_GROUPS;   // (not twice when the page mounts again)
  SLOTS.push({ group: 'Ordan announcer', slots: announcer }, { group: 'Ordan unit voices', slots: units },
    { group: 'Sable announcer', slots: sableAnnouncer }, { group: 'Sable unit voices', slots: sableUnits });
  ALL = SLOTS.flatMap((g) => g.slots);
}
const KIND_LABEL: Record<Kind, string> = { once: '', loop: 'loops', music: 'music', voice: 'voice' };

export default function mount(): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  let files: string[] = [];
  let picks: Record<string, string[]> = {};
  /** Each slot's loudness in the game (LUFS, tools/audio/levels.json). */
  let levels: Record<string, number> = {};
  /** What each made sound says or is (GET /art-audio/labels, from the .json next to it). */
  let labels: Record<string, string> = {};
  /** A file's name on the page: its line or short name (and its take, \`#3\`), else its file name tidied. */
  const nameOf = (f: string) => {
    const base = f.split('/').pop()!.replace(/\.[^.]+$/, '');
    const take = base.match(/_(\d+)$/)?.[1];
    if (labels[f]) return labels[f].startsWith('“') || !take ? labels[f] : `${labels[f]} #${take}`;
    return base.replace(/_\d+bpm|_\d{8}-\d{6}/g, '').replace(/_/g, ' ');
  };
  /** The ElevenLabs prompt of each slot (tools/audio/sfx_prompts.json), and edits not saved yet. */
  interface Prompt { prompt: string; seconds: number; loop?: boolean; variations?: number }
  let prompts: Record<string, Prompt> = {};
  const draft: Record<string, Prompt> = {};
  let busy = '';
  // the category the sidebar chose (?g=…; none: all of them)
  const only = new URL(location.href).searchParams.get('g');
  const shown = () => SLOTS.filter((g) => !only || groupId(g.group) === only);
  let current = ALL[0].id;
  const playing = new Set<HTMLAudioElement>();
  const durations = new Map<string, number>();
  /** The sound that started last: the seek bar follows it. */
  let last: HTMLAudioElement | null = null;

  // --- playback -------------------------------------------------------------------------------------------------------
  const volume = () => +$<HTMLInputElement>('volume').value;
  /** Bumped to stop a Play all run. */
  let run = 0;
  const stopAll = () => {
    run++;
    for (const a of playing) a.pause();
    playing.clear();
    last = null;
    $('now').hidden = true;
    document.querySelectorAll('[data-playing]').forEach((el) => el.removeAttribute('data-playing'));
  };
  // played at the game's loudness: each file measured once, and turned to its slot's level (tools/audio/levels.json),
  // through a limiter, as the packer does; or as the file is, to compare
  let ctx: AudioContext | null = null;
  let limiter: DynamicsCompressorNode | null = null;
  const gains = new Map<HTMLAudioElement, { node: GainNode; norm: number }>();
  const loud = new Map<string, Promise<number>>();
  /** A file's loudness (dB, near LUFS): its RMS over 50 ms blocks, the quiet ones (under -50 dB) left out. */
  const loudnessOf = (url: string) => {
    let p = loud.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b)).then((buf) => {
        const block = Math.max(1, Math.round(buf.sampleRate * 0.05));
        const squares: number[] = [];
        for (let i = 0; i + block <= buf.length; i += block) {
          let sum = 0;
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let k = i; k < i + block; k++) sum += d[k] * d[k];
          }
          squares.push(sum / (block * buf.numberOfChannels));
        }
        const kept = squares.filter((m) => m > 1e-5);   // -50 dB
        const mean = kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 1e-9;
        return 10 * Math.log10(mean);
      }).catch(() => -20);
      loud.set(url, p);
    }
    return p;
  };
  const applyGain = (a: HTMLAudioElement) => {
    const g = gains.get(a);
    if (g) g.node.gain.value = ($<HTMLInputElement>('normalize').checked ? g.norm : 1) * volume();
  };
  const play = async (file: string, kind: Kind = 'once', slot = current) => {
    const repeats = kind === 'loop' || kind === 'music';
    if (repeats) stopAll();                     // one loop or track at a time
    const url = `/art-audio/${file.split('/').map(encodeURIComponent).join('/')}`;
    ctx ??= new AudioContext();
    if (!limiter) {
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      limiter.connect(ctx.destination);
    }
    void ctx.resume();
    const target = levels[slot] ?? -20;
    const norm = Math.min(20, Math.max(0.05, 10 ** ((target - (await loudnessOf(url))) / 20)));
    const a = new Audio(url);
    const node = ctx.createGain();
    ctx.createMediaElementSource(a).connect(node).connect(limiter);
    gains.set(a, { node, norm });
    applyGain(a);
    a.loop = repeats;
    if (kind === 'once' && $<HTMLInputElement>('vary').checked) {   // (voices keep their pitch)
      a.preservesPitch = false;
      a.playbackRate = 0.92 + Math.random() * 0.16;
    }
    playing.add(a);
    a.onended = () => { playing.delete(a); gains.delete(a); };
    void a.play();
    last = a;
    $('now-name').textContent = nameOf(file);
    $('now-name').title = file;
    $('now').hidden = false;
    return a;
  };
  /** A slot's picks one after another, each once (loops and tracks too), until the last or Stop all. */
  const playAll = async (list: string[], slot: string) => {
    stopAll();
    const mine = run;
    for (const f of list) {
      const a = await play(f, 'voice', slot);
      if (mine !== run) return a.pause();
      a.loop = false;
      await new Promise<void>((done) => { a.addEventListener('ended', () => done()); a.addEventListener('pause', () => done()); });
      if (mine !== run) return;
      await new Promise((r) => setTimeout(r, 350));
      if (mine !== run) return;
    }
  };
  // the seek bar: where the last sound is (drag it to jump), and its time out of its length
  const seek = $<HTMLInputElement>('seek');
  let dragging = false;
  // minutes and seconds for music, tenths of a second for the short sounds
  const clock = (s: number, long: boolean) => (long ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
  seek.onpointerdown = () => { dragging = true; };
  seek.onpointerup = () => { dragging = false; };
  seek.oninput = () => {
    if (last?.duration) last.currentTime = (+seek.value / 1000) * last.duration;
  };
  let raf = 0;
  const follow = () => {
    if (last && last.duration) {
      if (!dragging) seek.value = String(Math.round((last.currentTime / last.duration) * 1000));
      const long = last.duration >= 10;
      $('now-time').textContent = `${clock(last.currentTime, long)} / ${clock(last.duration, long)}`;
    }
    raf = requestAnimationFrame(follow);
  };
  raf = requestAnimationFrame(follow);
  onLeave(() => cancelAnimationFrame(raf));
  $('volume').oninput = () => { for (const a of playing) applyGain(a); };
  $('normalize').onchange = () => { for (const a of playing) applyGain(a); };
  $('stop').onclick = stopAll;
  onLeave(stopAll);

  // --- picks ----------------------------------------------------------------------------------------------------------
  let saveTimer = 0;
  const save = () => {
    window.clearTimeout(saveTimer);
    $('saved').textContent = 'Saving…';
    saveTimer = window.setTimeout(async () => {
      const ok = await fetch('/art-audio/picks', { method: 'POST', body: JSON.stringify(picks) }).then((r) => r.ok).catch(() => false);
      $('saved').textContent = ok ? 'Saved to tools/audio/picks.json' : 'Could not save (is the dev server running?)';
    }, 250);
  };
  const toggle = (file: string) => {
    const list = picks[current] ?? [];
    picks[current] = list.includes(file) ? list.filter((f) => f !== file) : [...list, file];
    if (!picks[current].length) delete picks[current];
    save();
    renderSlots();
    renderHead();
    renderLibrary();
  };

  // --- the slots ------------------------------------------------------------------------------------------------------
  const renderSlots = () => {
    $('slots').innerHTML = shown().map((g) => `
      <div class="mb-1 mt-2 text-[12px] font-bold uppercase tracking-[0.08em] text-muted first:mt-0">${g.group}</div>
      ${g.slots.map((s) => {
        const n = picks[s.id]?.length ?? 0;
        const on = s.id === current;
        return `<div data-slot="${s.id}" class="mb-0.5 flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1 ${on ? 'bg-gold text-ink' : 'hover:bg-[#26292e]'}">
          <button data-playslot="${s.id}" title="Play" class="w-6 flex-none rounded-[3px] ${n ? '' : 'opacity-30'} ${on ? 'text-ink' : 'text-gold'}">▶</button>
          <span class="flex-1"><b class="font-semibold">${s.name}</b> <span class="${on ? 'text-ink/70' : 'text-muted'}">${s.note}</span>${madeForSlot(s.id) ? ` <span class="rounded-[3px] ${on ? 'bg-ink/20 text-ink' : 'bg-[#6a4cff] text-white'} px-1 text-[11px] font-bold" title="Made with ElevenLabs for this slot">AI ${madeForSlot(s.id)}</span>` : ''}</span>
          ${KIND_LABEL[s.kind] ? `<span class="text-[12px] ${on ? 'text-ink/70' : 'text-muted'}">${KIND_LABEL[s.kind]}</span>` : ''}
          <span title="${s.game ? 'Plays in matches' : `Not in matches yet: ${esc(s.later ?? '')}`}" class="h-2 w-2 flex-none rounded-full ${s.game ? 'bg-[#4caf50]' : 'bg-[#6f6b62]'}"></span>
          <span class="min-w-[18px] text-right font-semibold ${n ? '' : on ? 'text-ink/50' : 'text-[#6f6b62]'}">${n || '–'}</span>
        </div>`;
      }).join('')}`).join('');
  };
  $('slots').onclick = (e) => {
    const t = e.target as HTMLElement;
    const playId = t.closest<HTMLElement>('[data-playslot]')?.dataset.playslot;
    if (playId) {
      const list = picks[playId] ?? [];
      const slot = ALL.find((s) => s.id === playId)!;
      if (list.length) void play(list[Math.floor(Math.random() * list.length)], slot.kind, slot.id);
      return;
    }
    const id = t.closest<HTMLElement>('[data-slot]')?.dataset.slot;
    if (id) {
      current = id;
      renderSlots();
      renderHead();
      renderLibrary();
    }
  };

  // the selected slot and its picks
  const renderHead = () => {
    const s = ALL.find((x) => x.id === current)!;
    const list = picks[current] ?? [];
    const p = draft[current] ?? prompts[current] ?? { prompt: '', seconds: s.kind === 'once' ? 1.5 : 6, loop: s.kind !== 'once', variations: 2 };
    const status = s.game
      ? '<span class="rounded-[3px] bg-[#2f6b33] px-1.5 text-[12px] font-bold text-white">In the game</span>'
      : `<span class="rounded-[3px] bg-[#55524b] px-1.5 text-[12px] font-bold text-white">Not yet</span> <span class="text-muted">${esc(s.later ?? '')}</span>`;
    const canMake = s.kind !== 'music' && s.kind !== 'voice';
    $('slothead').innerHTML = `
      <div class="flex flex-wrap items-baseline gap-x-3"><b class="text-[18px]">${s.name}</b>${status}</div>
      <div class="mt-0.5 text-muted">Plays when ${esc(s.note)}${KIND_LABEL[s.kind] ? ` · ${KIND_LABEL[s.kind]}` : ''}</div>
      <div class="mt-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Picked for the game${list.length > 1 ? ' (one at random each time)' : ''}${list.length > 1 ? ` <button data-playall class="ml-2 rounded-[3px] border border-gold/60 px-1.5 normal-case tracking-normal text-gold hover:bg-gold hover:text-ink">▶ Play all ${list.length}</button>` : ''}</div>
      ${canMake ? `
      <details class="mt-2.5" ${draft[current] ? 'open' : ''}>
        <summary class="cursor-pointer text-[12px] font-bold uppercase tracking-[0.06em] text-muted">ElevenLabs prompt${prompts[current] ? '' : ' (none yet)'}</summary>
        <textarea id="p-text" rows="3" class="mt-1.5 w-full rounded-[4px] border border-line bg-bg px-2 py-1 text-text" placeholder="Describe the sound: what makes it, how it sounds, how long, indoors or out…">${esc(p.prompt)}</textarea>
        <div class="mt-1.5 flex flex-wrap items-center gap-3 text-muted">
          <label>Length <input id="p-sec" type="number" min="0.5" max="30" step="0.1" value="${p.seconds}" class="w-[64px] rounded-[4px] border border-line bg-bg px-1.5 py-0.5 text-text"> s</label>
          <label class="inline-flex items-center gap-1.5"><input id="p-loop" type="checkbox" ${p.loop ? 'checked' : ''}> Seamless loop</label>
          <label>Variations <input id="p-var" type="number" min="1" max="5" step="1" value="${p.variations ?? 2}" class="w-[48px] rounded-[4px] border border-line bg-bg px-1.5 py-0.5 text-text"></label>
          <button id="p-save" class="rounded-[4px] border border-line px-2.5 py-0.5 font-semibold text-text hover:border-gold" ${busy ? 'disabled' : ''}>Save prompt</button>
          <button id="p-make" class="rounded-[4px] bg-[#6a4cff] px-2.5 py-0.5 font-semibold text-white disabled:opacity-50" ${busy ? 'disabled' : ''}>Make ${p.variations ?? 2} new</button>
          <span id="p-status" class="text-muted">${esc(busy)}</span>
        </div>
      </details>` : ''}`;
    if (!canMake) return;
    const read = (): Prompt => ({
      prompt: $<HTMLTextAreaElement>('p-text').value,
      seconds: Number($<HTMLInputElement>('p-sec').value) || 1,
      loop: $<HTMLInputElement>('p-loop').checked,
      variations: Number($<HTMLInputElement>('p-var').value) || 2,
    });
    for (const id of ['p-text', 'p-sec', 'p-loop', 'p-var']) $(id).addEventListener('input', () => { draft[current] = read(); });
    const savePrompt = async () => {
      const v = read();
      const ok = await fetch('/art-audio/prompts', { method: 'POST', body: JSON.stringify({ slot: current, ...v }) }).then((r) => r.ok).catch(() => false);
      if (ok) {
        prompts[current] = v;
        delete draft[current];
      }
      return ok;
    };
    $('p-save').onclick = async () => {
      $('p-status').textContent = (await savePrompt()) ? 'Saved' : 'Could not save';
    };
    $('p-make').onclick = async () => {
      const slot = current;
      if (!read().prompt.trim()) return void ($('p-status').textContent = 'Write a prompt first');
      if (!(await savePrompt())) return void ($('p-status').textContent = 'Could not save the prompt');
      busy = `Making ${read().variations} with ElevenLabs…`;
      renderHead();
      const r = await fetch('/art-audio/generate', { method: 'POST', body: JSON.stringify({ slot }) })
        .then((x) => x.json() as Promise<{ ok: boolean; out: string }>).catch(() => ({ ok: false, out: 'no answer from the dev server' }));
      busy = '';
      await reloadFiles();
      const made = (r.out.match(/made \d+/) ?? [''])[0];
      if (current === slot) {
        renderHead();
        $('p-status').textContent = r.ok ? `Done: ${made || 'made'} (at the top of the list below)` : `Failed: ${r.out.split('\n').pop()}`;
      }
    };
  };

  // --- the library ----------------------------------------------------------------------------------------------------
  const packOf = (f: string) => f.split('/').slice(0, 2).join('/');
  /** Made with ElevenLabs (tools/audio/elevenlabs.py), not from a downloaded pack. */
  const isAi = (f: string) => f.startsWith('elevenlabs');
  const AI_BADGE = '<span class="rounded-[3px] bg-[#6a4cff] px-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-white">ElevenLabs</span>';
  const madeForSlot = (slot: string) => files.filter((f) => f.includes(`/sfx/${slot}/`) || f.includes(`/voice/${slot}/`) || f.includes(`/music/${slot}`)).length;
  // the slot's picks only, until you ask to find more (then the whole library, the slot's own takes first)
  let finding = false;
  let finderSlot = '';
  const renderPicks = () => {
    const list = picks[current] ?? [];
    const takes = files.filter((f) => f.includes(`/sfx/${current}/`) || f.includes(`/voice/${current}/`) || f.includes(`/music/${current}`)).filter((f) => !list.includes(f)).length;
    $('count').textContent = '';
    $('library').innerHTML = `${list.map((f) => {
      const d = durations.get(f);
      return `<div class="flex items-center gap-2 rounded-[4px] px-1.5 py-1 hover:bg-[#26292e]">
        <button data-play="${esc(f)}" class="w-6 flex-none text-gold">▶</button>
        <span class="flex flex-1 items-center gap-1.5 truncate" title="${esc(f)}">${isAi(f) ? AI_BADGE : ''}${esc(nameOf(f))}</span>
        <span class="w-[46px] text-right text-[13px] text-muted">${d ? `${d.toFixed(1)}s` : ''}</span>
        <button data-pick="${esc(f)}" title="Take it out of the game" class="w-[78px] flex-none rounded-[3px] border border-line px-1.5 text-[13px] font-semibold text-muted hover:border-[#c0392b] hover:text-text">Remove</button>
      </div>`;
    }).join('') || '<p class="text-muted">Nothing picked for this slot yet.</p>'}
      <button data-find class="mt-3 rounded-[4px] border border-line px-3 py-1 font-semibold text-muted hover:border-gold hover:text-text">+ Find more sounds${takes ? ` (${takes} other take${takes > 1 ? 's' : ''} made for this slot)` : ''}</button>`;
  };
  const renderLibrary = () => {
    if (finderSlot !== current) {
      finderSlot = current;
      finding = false;
    }
    $('finder').hidden = !finding;
    if (!finding) return renderPicks();
    const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
    const pack = $<HTMLSelectElement>('pack').value;
    // the ones generated for this slot (tools/audio/elevenlabs.py: <pack>/sfx/<slot>/) first
    const madeFor = (f: string) => f.includes(`/sfx/${current}/`) || f.includes(`/voice/${current}/`) || f.includes(`/music/${current}`);
    const shown = files.filter((f) => (!pack || packOf(f) === pack) && (!q || f.toLowerCase().includes(q) || nameOf(f).toLowerCase().includes(q)))
      .sort((x, y) => +madeFor(y) - +madeFor(x));
    $('count').textContent = `${shown.length} of ${files.length}`;
    const mine = new Set(picks[current] ?? []);
    let folder = '';
    $('library').innerHTML = shown.map((f) => {
      const dir = madeFor(f) ? 'Made for this slot' : f.slice(0, f.lastIndexOf('/'));
      const head = dir !== folder
        ? `<div class="mb-1 mt-2.5 text-[12px] font-bold uppercase tracking-[0.06em] ${madeFor(f) ? 'text-gold' : 'text-muted'} first:mt-0">${esc((folder = dir))}</div>`
        : '';
      const d = durations.get(f);
      return `${head}<div class="flex items-center gap-2 rounded-[4px] px-1.5 py-0.5 hover:bg-[#26292e]">
        <button data-play="${esc(f)}" class="w-6 flex-none text-gold">▶</button>
        <span class="flex flex-1 items-center gap-1.5 truncate" title="${esc(f)}">${isAi(f) ? AI_BADGE : ''}${esc(nameOf(f))}</span>
        <span class="w-[46px] text-right text-[13px] text-muted">${d ? `${d.toFixed(1)}s` : ''}</span>
        <button data-pick="${esc(f)}" class="w-[78px] flex-none rounded-[3px] border px-1.5 text-[13px] font-semibold ${mine.has(f) ? 'border-gold bg-gold text-ink' : 'border-line text-muted hover:border-gold hover:text-text'}">${mine.has(f) ? 'Picked' : '+ Add'}</button>
      </div>`;
    }).join('') || '<p class="text-muted">No sounds match.</p>';
  };
  const onListClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-playall]')) return void playAll(picks[current] ?? [], current);
    if (t.closest('[data-find]')) {
      finding = true;
      renderLibrary();
      return void $('search').focus();
    }
    const p = t.closest<HTMLElement>('[data-play]')?.dataset.play;
    if (p) {
      const slot = ALL.find((s) => s.id === current)!;
      // a loop or a track plays as it will in the game; anything else once
      void play(p, slot.kind === 'once' ? 'once' : slot.kind);
      return;
    }
    const k = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    if (k) toggle(k);
  };
  $('library').onclick = onListClick;
  $('finder-close').onclick = () => {
    finding = false;
    renderLibrary();
  };
  $('slothead').onclick = onListClick;
  $('search').oninput = renderLibrary;
  $('pack').onchange = renderLibrary;

  const reloadFiles = async () => {
    files = await fetch('/art-audio/index.json').then((r) => r.json() as Promise<string[]>).catch(() => files);
    labels = await fetch('/art-audio/labels').then((r) => r.json() as Promise<Record<string, string>>).catch(() => labels);
    renderSlots();
    renderLibrary();
  };

  // update the game: pack the picks into its audio (tools/audio/pack_audio.py)
  $('update').onclick = async () => {
    $('update').setAttribute('disabled', '');
    $('updated').textContent = 'Packing the picks into the game…';
    const r = await fetch('/art-audio/pack', { method: 'POST' }).then((x) => x.json() as Promise<{ ok: boolean; out: string }>).catch(() => ({ ok: false, out: 'no answer' }));
    $('update').removeAttribute('disabled');
    const last = r.out.split('\n').pop() ?? '';
    $('updated').textContent = r.ok ? `Done (${last}). Reload the game to hear them.` : `Failed: ${last}`;
  };

  // --- load -----------------------------------------------------------------------------------------------------------
  void (async () => {
    [files, picks, prompts] = await Promise.all([
      fetch('/art-audio/index.json').then((r) => r.json() as Promise<string[]>).catch(() => []),
      fetch('/art-audio/picks').then((r) => r.json() as Promise<Record<string, string[]>>).catch(() => ({})),
      fetch('/art-audio/prompts').then((r) => r.json() as Promise<Record<string, Prompt>>).catch(() => ({})),
    ]);
    labels = await fetch('/art-audio/labels').then((r) => r.json() as Promise<Record<string, string>>).catch(() => ({}));
    levels = await fetch('/art-audio/levels').then((r) => r.json() as Promise<Record<string, number>>).catch(() => ({}));
    const script = await fetch('/art-audio/voices').then((r) => r.json()).catch(() => null);
    if (script?.slots) addVoiceSlots(script);
    current = shown()[0]?.slots[0]?.id ?? current;
    const packs = [...new Set(files.map(packOf))];
    const label = (p: string) => (p.startsWith('elevenlabs') ? `ElevenLabs (${p.split('/')[0].replace('elevenlabs-', '')} plan, ${p.split('/')[1] ?? ''})` : p);
    packs.sort((a, b) => +isAi(b) - +isAi(a));
    $<HTMLSelectElement>('pack').innerHTML = `<option value="">All packs</option>${packs.map((p) => `<option value="${esc(p)}">${esc(label(p))}</option>`).join('')}`;
    renderSlots();
    renderHead();
    renderLibrary();
    if (!files.length) $('library').innerHTML = '<p class="text-muted">No sounds in art/audio yet.</p>';
    // lengths, a few at a time (metadata only)
    for (const f of files) {
      if (!document.body.contains($('library'))) break;
      await new Promise<void>((done) => {
        const a = new Audio();
        a.preload = 'metadata';
        a.onloadedmetadata = () => { durations.set(f, a.duration); done(); };
        a.onerror = () => done();
        a.src = `/art-audio/${f.split('/').map(encodeURIComponent).join('/')}`;
      });
      if (durations.size % 25 === 0) renderLibrary();
    }
    renderLibrary();
  })();
}
