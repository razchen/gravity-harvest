import { expect, test, type CDPSession, type Page } from '@playwright/test';

// How long a frame takes with a big battle on screen. Opens a skirmish, builds a radar (so the minimap draws), then
// measures five phases: the start position; ~300 of your units marching back and forth; the same with the mouse
// sweeping over them; with the camera panning; and those units fighting an enemy force that walks into sight. For
// each it prints the JS time per frame (Phaser's whole step: update and render calls), the scene's update, the display
// list's depth sort and how often it ran, pointer hit tests, fog redraws, and the functions that took the most time (a
// CPU profile: the HUD's timers too, which run outside the step).
//
// Every match grows a new landscape, so object counts (and the battle) differ from run to run: run it a couple of
// times before and after a rendering change and compare. npm run perf -w @gravity-harvest/game

const PHASE_MS = 10_000;
const OWN_UNITS = 300;
const ENEMY_UNITS = 100;
const TYPES = ['jackal', 'ram', 'skimmer', 'hound', 'lancer', 'grenadier'];

const scene = <T>(page: Page, fn: (s: any) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.game.scene.getScene('game'))`) as Promise<T>;

async function openMatch(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('gravity-harvest:help-seen', '1'));
  await page.goto('/');
  await expect(page.locator('.title-screen')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.locator('.scenario-card').getByRole('button', { name: 'Start' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).game?.scene.getScene('game')?.units?.size), { timeout: 30_000 }).toBe(true);
}

/** Wrap the game loop, the scene's update, the depth sort, hit tests and fog redraws with timers (in the page). */
async function instrument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).game;
    const s = g.scene.getScene('game');
    const rec = { step: [] as number[], update: [] as number[], sortMs: 0, sorts: 0, hitMs: 0, hits: 0, fogMs: 0, fogs: 0, frames: 0, on: false };
    (window as any).__perf = rec;
    const loop = g.loop;
    const step = loop.callback;
    loop.callback = (t: number, d: number) => {
      const a = performance.now();
      step(t, d);
      if (rec.on) {
        rec.step.push(performance.now() - a);
        rec.frames++;
      }
    };
    const update = s.sys.sceneUpdate;
    s.sys.sceneUpdate = function (this: unknown, t: number, d: number) {
      const a = performance.now();
      update.call(this, t, d);
      if (rec.on) rec.update.push(performance.now() - a);
    };
    const list = s.sys.displayList;
    const sort = list.depthSort.bind(list);
    list.depthSort = () => {
      const a = performance.now();
      const will = list.sortChildrenFlag;
      sort();
      if (rec.on && will) {
        rec.sorts++;
        rec.sortMs += performance.now() - a;
      }
    };
    const fog = s.fog;
    const apply = fog.apply.bind(fog);
    fog.apply = (f: string) => {
      const a = performance.now();
      apply(f);
      if (rec.on) {
        rec.fogs++;
        rec.fogMs += performance.now() - a;
      }
    };
    const input = s.input;
    const hitTest = input.hitTestPointer.bind(input);
    input.hitTestPointer = (p: unknown) => {
      const a = performance.now();
      const out = hitTest(p);
      if (rec.on) {
        rec.hits++;
        rec.hitMs += performance.now() - a;
      }
      return out;
    };
  });
}

interface Row {
  phase: string;
  objects: number;
  units: number;
  fps: number;
  step: string;
  update: string;
  sort: string;
  hits: string;
  fog: string;
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const avg = s.reduce((n, x) => n + x, 0) / Math.max(1, s.length);
  const p95 = s[Math.floor(s.length * 0.95)] ?? 0;
  return `${avg.toFixed(2)} avg / ${p95.toFixed(2)} p95 / ${(s[s.length - 1] ?? 0).toFixed(1)} max`;
};

async function measure(page: Page, cdp: CDPSession, phase: string): Promise<{ row: Row; top: string[] }> {
  await page.evaluate(() => Object.assign((window as any).__perf, { step: [], update: [], sortMs: 0, sorts: 0, hitMs: 0, hits: 0, fogMs: 0, fogs: 0, frames: 0, on: true }));
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.waitForTimeout(PHASE_MS);
  const { profile } = await cdp.send('Profiler.stop');
  const ms = Date.now() - t0;
  const r = await page.evaluate(() => {
    const p = (window as any).__perf;
    p.on = false;
    const s = (window as any).game.scene.getScene('game');
    return { step: p.step, update: p.update, sortMs: p.sortMs, sorts: p.sorts, hitMs: p.hitMs, hits: p.hits, fogMs: p.fogMs, fogs: p.fogs, frames: p.frames, objects: (s.gameObjects?.() ?? s.children.list).length, units: s.units.size };
  });
  // time per function from the samples: self time (anything), and total time with what it calls (the game's own code)
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (f: { functionName: string; url: string; lineNumber: number }) =>
    `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()?.split('?')[0] ?? ''}:${f.lineNumber + 1}`;
  const dt = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((id, i) => {
    const t = (dt[i] ?? 0) / 1000;
    const key = name(byId.get(id)!.callFrame);
    self.set(key, (self.get(key) ?? 0) + t);
    const seen = new Set<string>();
    for (let n: number | undefined = id; n !== undefined; n = parent.get(n)) {
      const f = byId.get(n)!.callFrame;
      if (!f.url.includes('/src/')) continue;
      const k = name(f);
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) ?? 0) + t);
    }
  });
  const list = (m: Map<string, number>, n: number) => [...m].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)'))
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${((v / ms) * 1000).toFixed(1).padStart(6)} ms/s  ${k}`);
  const top = ['self:', ...list(self, 14), 'total (game code):', ...list(total, 24)];
  return {
    row: {
      phase,
      objects: r.objects,
      units: r.units,
      fps: Math.round((r.frames / ms) * 1000),
      step: stats(r.step),
      update: stats(r.update),
      sort: `${r.sorts}/${r.frames} frames, ${(r.sortMs / Math.max(1, r.sorts)).toFixed(2)} ms each`,
      hits: `${r.hits}, ${(r.hitMs / Math.max(1, r.hits)).toFixed(3)} ms each`,
      fog: `${r.fogs} redraws, ${(r.fogMs / Math.max(1, r.fogs)).toFixed(2)} ms each`,
    },
    top,
  };
}

test('frame times with ~300 units on screen', async ({ page }) => {
  await openMatch(page);
  // a radar, so the minimap draws the map rather than static
  await scene(page, (s) => s.orders.send({ c: 'place', building: 'radar', tx: 2, ty: 10 }));
  await page.waitForTimeout(500);
  await scene(page, (s) => s.net.debug({ d: 'finishBuilds' }));
  await expect.poll(() => scene(page, (s) => s.view?.radar), { timeout: 15_000 }).toBe('online');
  await instrument(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const results: { row: Row; top: string[] }[] = [];

  await page.waitForTimeout(2000);
  results.push(await measure(page, cdp, 'start position'));

  // your army: a block in the open field below the base, the camera over it
  await page.evaluate(([n, types]) => {
    const s = (window as any).game.scene.getScene('game');
    for (let i = 0; i < n; i++) s.net.debug({ d: 'spawn', unit: types[i % types.length], team: 'a', gx: 14 + (i % 20) * 1.1, gy: 18 + Math.floor(i / 20) * 1.1 });
  }, [OWN_UNITS, TYPES] as const);
  await expect.poll(() => scene(page, (s) => s.units.size), { timeout: 15_000 }).toBeGreaterThanOrEqual(OWN_UNITS);
  const centre = () => scene(page, (s) => {
    const mine = [...s.units.values()].filter((u: any) => u.team === 'a');
    const gx = mine.reduce((n: number, u: any) => n + u.gx, 0) / mine.length;
    const gy = mine.reduce((n: number, u: any) => n + u.gy, 0) / mine.length;
    s.centerOnWorld((gx - gy) * 64, (gx + gy) * 32);
  });
  /** Every unit of yours but the starting harvester and riflemen moves to (gx, gy). */
  const go = (gx: number, gy: number) => page.evaluate(([gx, gy]) => {
    const s = (window as any).game.scene.getScene('game');
    const ids = [...s.units.values()].filter((u: any) => u.team === 'a' && u.type !== 'harvester' && u.type !== 'rifleman').map((u: any) => u.id);
    s.orders.send({ c: 'move', orders: ids.map((id: number) => ({ id, gx, gy })) });
  }, [gx, gy]);
  await centre();
  await go(40, 30);
  await page.waitForTimeout(1500);
  await centre();
  // back the other way halfway through, so they keep moving
  const turn = setTimeout(() => void go(18, 22), PHASE_MS / 2);
  results.push(await measure(page, cdp, `${OWN_UNITS} units marching`));
  clearTimeout(turn);

  // the same, with the mouse sweeping over them (every move hit-tests the units under it)
  await centre();
  void go(40, 30);
  let sweeping = true;
  const sweep = (async () => {
    for (let k = 0; sweeping; k++) {
      await page.mouse.move(300 + (k % 2) * 800, 250 + (k % 3) * 200, { steps: 60 });
    }
  })();
  results.push(await measure(page, cdp, `${OWN_UNITS} units marching, mouse moving`));
  sweeping = false;
  await sweep;

  // the camera panning across the field and back (keyboard): new ground comes into view all the time
  await page.mouse.move(720, 450);
  await page.keyboard.down('d');
  const back = setTimeout(() => void page.keyboard.up('d').then(() => page.keyboard.down('a')), PHASE_MS / 2);
  results.push(await measure(page, cdp, `${OWN_UNITS} units, camera panning`));
  clearTimeout(back);
  await page.keyboard.up('d');
  await page.keyboard.up('a');

  // an enemy force walks into sight: units appear at the fog edge, shots, hits and deaths
  await centre();
  await page.evaluate(([n, types]) => {
    const s = (window as any).game.scene.getScene('game');
    const mine = [...s.units.values()].filter((u: any) => u.team === 'a');
    const gx = mine.reduce((n: number, u: any) => n + u.gx, 0) / mine.length;
    const gy = mine.reduce((n: number, u: any) => n + u.gy, 0) / mine.length;
    for (let i = 0; i < n; i++) s.net.debug({ d: 'spawn', unit: types[i % types.length], team: 'b', gx: gx + 14 + (i % 10) * 1.1, gy: gy - 4 + Math.floor(i / 10) * 1.1 });
  }, [ENEMY_UNITS, TYPES.slice(0, 4)] as const);
  await page.waitForTimeout(500);
  await scene(page, (s) => {
    const mine = [...s.units.values()].filter((u: any) => u.team === 'a');
    const gx = mine.reduce((n: number, u: any) => n + u.gx, 0) / mine.length;
    const gy = mine.reduce((n: number, u: any) => n + u.gy, 0) / mine.length;
    s.orders.send({ c: 'attackMove', orders: mine.map((u: any) => ({ id: u.id, gx: gx + 16, gy })) });
  });
  results.push(await measure(page, cdp, `battle (+${ENEMY_UNITS} enemies)`));

  console.log('\n' + results.map(({ row }) =>
    `${row.phase}: ${row.fps} fps, ${row.units} units, ${row.objects} objects\n  step ms ${row.step}\n  update ms ${row.update}\n  depth sort ${row.sort}\n  pointer hit tests ${row.hits}\n  fog ${row.fog}`).join('\n'));
  for (const { row, top } of results) console.log(`\nWhere the time went, ${row.phase}:\n${top.join('\n')}`);
});
