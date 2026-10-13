import { expect, test } from '@playwright/test';
import { debug, myUnits, openGame, scene, screenAt } from './helpers';

// The match runs on the server; these drive it through the real HUD and mouse, and set up state with the
// test server's debug commands.
test.describe('skirmish', () => {
  test('boots with the starting position from the rules, and no errors', async ({ page }) => {
    const errors = await openGame(page);
    await expect(page.locator('#credits')).toHaveText('15,000');
    await expect(page.locator('#power')).toHaveText('150 / 500');
    const start = await scene(page, (s) => ({
      mine: [...s.buildings.values()].filter((b: any) => b.team === 'player').map((b: any) => b.type).sort(),
      riflemen: [...s.units.values()].filter((u: any) => u.type === 'rifleman' && u.team === 'player').length,
    }));
    expect(start).toEqual({ mine: ['power_plant', 'refinery'], riflemen: 2 });
    await expect(page.locator('.card[data-id]')).toHaveCount(4); // only the roster with art
    expect(errors).toEqual([]);
  });

  test('fog of war: the enemy is not even sent until scouted', async ({ page }) => {
    await openGame(page);
    const hidden = await scene(page, (s) => ({
      enemyUnits: [...s.units.values()].filter((u: any) => u.team === 'enemy').length,
      enemyBuildings: [...s.buildings.values()].filter((b: any) => b.team === 'enemy').length,
      enemyCorner: s.fog.at(60, 60),
      homeCorner: s.fog.at(7, 7),
    }));
    expect(hidden).toEqual({ enemyUnits: 0, enemyBuildings: 0, enemyCorner: 0, homeCorner: 2 });

    await debug(page, { d: 'teleport', units: await myUnits(page, 'rifleman'), gx: 45, gy: 48 });
    await expect.poll(() => scene(page, (s) => [...s.buildings.values()].filter((b: any) => b.team === 'enemy').length)).toBeGreaterThan(0);
    await expect.poll(() => scene(page, (s) => [...s.units.values()].filter((u: any) => u.team === 'enemy').length)).toBeGreaterThan(0);
  });

  test('the harvester mines ore and a full load pays 1,050', async ({ page }) => {
    await openGame(page);
    const rocks = await scene(page, (s) => s.ore.totalRocks());
    await debug(page, { d: 'credits', amount: 0 });
    await expect.poll(() => scene(page, (s) => s.ore.totalRocks()), { timeout: 20_000 }).toBeLessThan(rocks);
    await expect(page.locator('#credits')).toHaveText('1,050', { timeout: 45_000 });
  });

  test('placing a power plant through the HUD', async ({ page }) => {
    await openGame(page);
    await page.click('.card[data-id="power_plant"]');
    const blocked = await screenAt(page, 7, 7); // on top of the refinery
    await page.mouse.move(blocked.x, blocked.y);
    await expect.poll(() => scene(page, (s) => s.placement.problem)).toBe('Blocked');
    const ok = await screenAt(page, 2.5, 10.5);
    await page.mouse.move(ok.x, ok.y);
    await expect.poll(() => scene(page, (s) => s.placement.problem)).toBeNull();
    await page.mouse.click(ok.x, ok.y);
    await expect(page.locator('#credits')).toHaveText('14,550');
    await expect.poll(() => scene(page, (s) => [...s.buildings.values()].filter((b: any) => b.type === 'power_plant' && b.team === 'player').length)).toBe(2);
    await debug(page, { d: 'finishBuilds' });
    await expect(page.locator('#power')).toHaveText('150 / 1000');
  });

  test('units need the right building, then come out of the queue', async ({ page }) => {
    await openGame(page);
    await page.click('.tabs [data-tab="units"]');
    await expect(page.locator('.card[data-id="rifleman"]')).toHaveClass(/locked/);
    await page.click('.card[data-id="rifleman"]');
    await expect(page.locator('#toast')).toHaveText('Build a Barracks first');

    await page.click('.tabs [data-tab="build"]');
    await page.click('.card[data-id="barracks"]');
    const at = await screenAt(page, 2.5, 10.5);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    await debug(page, { d: 'finishBuilds' });
    await page.click('.tabs [data-tab="units"]');
    await expect(page.locator('.card[data-id="rifleman"]')).not.toHaveClass(/locked/);
    await page.click('.card[data-id="rifleman"]');
    await expect(page.locator('.card[data-id="rifleman"] .queue-count')).toHaveText('1');
    await expect.poll(async () => (await myUnits(page, 'rifleman')).length, { timeout: 15_000 }).toBe(3);
  });

  test('riflemen fight back', async ({ page }) => {
    await openGame(page);
    const pos = await scene(page, (s) => {
      const r = [...s.units.values()].find((u: any) => u.type === 'rifleman');
      return { gx: r.gx + 2.5, gy: r.gy };
    });
    await debug(page, { d: 'spawn', unit: 'rifleman', team: 'enemy', ...pos });
    await expect.poll(() => scene(page, (s) => s.view.stats.unitsKilled), { timeout: 20_000 }).toBe(1);
  });
});

test.describe('shadows', () => {
  test('buildings put their shadow into the shared layer, and take it out when they go', async ({ page }) => {
    await openGame(page);
    const layer = () => scene(page, (s) => ({ buildings: s.shadows.dynamic.size, scenery: s.shadows.fixed.length, alpha: s.shadows.rt.alpha }));
    expect(await layer()).toMatchObject({ buildings: 2, alpha: 0.18 }); // refinery + power plant
    expect((await layer()).scenery).toBeGreaterThan(50);
    const plant = await scene(page, (s) => [...s.buildings.values()].find((b: any) => b.type === 'power_plant').id);
    await scene(page, `(s) => s.net.command({ c: 'sell', building: ${plant} })` as never);
    await expect.poll(async () => (await layer()).buildings).toBe(1);
  });
});

test.describe('controls', () => {
  test('zoom is on the keyboard (− held zooms out, + back in no further than the default, 0 resets), not the wheel', async ({ page }) => {
    await openGame(page);
    const zoom = () => scene(page, (s) => s.zoomLevel);
    const centre = await screenAt(page, 11, 9);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(200);
    expect(await zoom()).toBe(1);
    await page.keyboard.down('Equal'); // the + key: already as close as it goes (sprites are pixel for pixel here)
    await page.waitForTimeout(500);
    await page.keyboard.up('Equal');
    expect(await zoom()).toBe(1);
    await page.keyboard.down('Minus');
    await page.waitForTimeout(800);
    await page.keyboard.up('Minus');
    const out = await zoom();
    expect(out).toBeLessThan(1);
    await page.keyboard.down('Equal');
    await page.waitForTimeout(300);
    await page.keyboard.up('Equal');
    expect(await zoom()).toBeGreaterThan(out);
    expect(await zoom()).toBeLessThanOrEqual(1);
    await page.keyboard.press('Digit0');
    expect(await zoom()).toBe(1);
  });

  test('panning stops straight at the edge of the field (a box around the map, no sliding along its sides)', async ({ page }) => {
    await openGame(page);
    const centre = () => scene(page, (s) => {
      const cam = s.cameras.main;
      return { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
    });
    // the 64 x 64 field's bounding box in world px: x from -4096 to 4096, y from 0 to 4096
    const hold = async (keys: string[], ms = 2500) => {
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(ms);
      for (const k of keys) await page.keyboard.up(k);
    };
    await hold(['KeyW']);
    const top = await centre();
    expect(top.y).toBeCloseTo(0, 0); // stopped at the top edge
    await hold(['KeyW'], 800); // keeps pushing up: must not slide sideways
    const still = await centre();
    expect(still.x).toBeCloseTo(top.x, 0);
    expect(still.y).toBeCloseTo(0, 0);
    await hold(['KeyA', 'ArrowUp']);
    expect(await centre()).toEqual({ x: -4096, y: 0 });
    await hold(['KeyS', 'KeyD'], 6000);
    const c = await centre();
    expect(c.x).toBeLessThanOrEqual(4096);
    expect(c.y).toBeLessThanOrEqual(4096);
  });

  test('the debug menu lists the shortcuts and toggles them', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#debug-menu')).toBeHidden();
    await page.keyboard.press('Backquote');
    await expect(page.locator('#debug-menu')).toBeVisible();
    const grid = page.locator('.debug-row').filter({ hasText: 'Tile grid' });
    await expect(grid.locator('.debug-state')).toHaveText('off');
    await grid.click();
    await expect(grid.locator('.debug-state')).toHaveText('on');
    const fog = page.locator('.debug-row').filter({ hasText: 'Fog of war' });
    await fog.click(); // the test server allows debug commands
    await expect(fog.locator('.debug-state')).toHaveText('off');
    await page.locator('#btn-settings').click();
    await expect(page.locator('#debug-menu')).toBeHidden();
  });

  test('clicking an enemy soldier next to a building attacks the soldier, not the building', async ({ page }) => {
    await openGame(page);
    await debug(page, { d: 'reveal', on: true });
    const radar = await scene(page, (s) => {
      const r = [...s.buildings.values()].find((b: any) => b.type === 'radar' && b.team === 'enemy');
      return r && { tx: r.tx as number, ty: r.ty as number };
    });
    expect(radar).toBeTruthy();
    // an enemy soldier just behind the radar, where the building's sprite is drawn over it
    const at = { gx: radar.tx + 1.5, gy: radar.ty - 0.4 };
    await debug(page, { d: 'spawn', unit: 'rifleman', team: 'enemy', ...at });
    const mine = await myUnits(page, 'rifleman');
    await debug(page, { d: 'teleport', units: mine, gx: radar.tx - 12, gy: radar.ty - 12 });
    await expect.poll(() => scene(page, (s) => [...s.units.values()].filter((u: any) => u.team === 'enemy' && u.type === 'rifleman').length)).toBeGreaterThan(0);
    const enemy = await scene(page, (s) => {
      const r = [...s.buildings.values()].find((b: any) => b.type === 'radar' && b.team === 'enemy');
      const u = [...s.units.values()].filter((x: any) => x.team === 'enemy').sort((a: any, b: any) =>
        Math.hypot(a.gx - (r.tx + 1.5), a.gy - (r.ty - 0.4)) - Math.hypot(b.gx - (r.tx + 1.5), b.gy - (r.ty - 0.4)))[0];
      s.cameras.main.centerOn((u.gx - u.gy) * 64, (u.gx + u.gy) * 32);
      // record the orders the browser sends
      (window as any).sent = [];
      const send = s.net.command.bind(s.net);
      s.net.command = (c: any) => { (window as any).sent.push(c); send(c); };
      s.selection.set([...s.units.values()].filter((x: any) => x.team === 'player' && x.type === 'rifleman'));
      return { id: u.id, gx: u.gx, gy: u.gy };
    });
    const p = await screenAt(page, enemy.gx, enemy.gy);
    await page.mouse.click(p.x, p.y - 30); // on the soldier's body
    const sent = await page.evaluate(() => (window as any).sent);
    expect(sent).toContainEqual(expect.objectContaining({ c: 'attack', target: enemy.id }));
  });
});
