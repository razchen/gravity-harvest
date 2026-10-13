import { expect, test } from '@playwright/test';
import { clearSaves, debug, openGame, openTitle, scene, trackErrors, waitForMatch } from './helpers';

test.describe('menus, saving and match end', () => {
  test.beforeEach(async ({ page }) => {
    await openTitle(page);
    await clearSaves(page);
  });

  test('title screen: Continue is disabled with no saves; New Game starts a match', async ({ page }) => {
    const errors = trackErrors(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.locator('.menu-sub')).toHaveText('No saved games yet');
    await page.getByRole('button', { name: 'New Game' }).click();
    await expect(page.locator('.scenario-name')).toHaveText(['Skirmish']);
    await page.locator('.scenario-card').getByRole('button', { name: 'Start' }).click();
    await waitForMatch(page);
    await expect(page.locator('#screens')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('Esc pauses the match and opens the menu; Resume continues', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.screen-title')).toHaveText('Paused');
    expect(await page.evaluate(() => (window as any).game.scene.isPaused('game'))).toBe(true);
    const t = await scene(page, (s) => s.gameTimeMs);
    await page.waitForTimeout(800);
    expect(await scene(page, (s) => s.gameTimeMs)).toBe(t); // clock stops while paused
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('#screens')).toBeHidden();
    await expect.poll(() => scene(page, (s) => s.gameTimeMs)).toBeGreaterThan(t);
  });

  test('Esc toggles the pause menu, and stays closed after resuming', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.screen-title')).toHaveText('Paused');
    await page.keyboard.press('Escape');
    await expect(page.locator('#screens')).toBeHidden();
    await page.waitForTimeout(500); // the paused scene must not replay the Esc and reopen the menu
    await expect(page.locator('#screens')).toBeHidden();
    expect(await page.evaluate(() => (window as any).game.scene.isPaused('game'))).toBe(false);
  });

  test('W, A, S and D can be typed into the save name', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Game' }).click();
    await page.locator('#save-name').fill('');
    await page.locator('#save-name').pressSequentially('wasd base');
    await expect(page.locator('#save-name')).toHaveValue('wasd base');
  });

  test('save, overwrite, load and delete through the screens', async ({ page }) => {
    await openGame(page);
    await debug(page, { d: 'credits', amount: 1234 });
    await expect(page.locator('#credits')).toHaveText('1,234');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Game' }).click();
    await page.fill('#save-name', 'E2E save');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.save-row .save-name')).toHaveText(['E2E save']);
    await expect(page.locator('.save-row img.save-thumb')).toHaveCount(1); // thumbnail captured

    // overwrite keeps one slot with the new state
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await debug(page, { d: 'credits', amount: 2222 });
    await expect(page.locator('#credits')).toHaveText('2,222');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Game' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Overwrite' }).click();
    await expect(page.locator('.save-status')).toHaveText('Saved "E2E save"');
    await expect(page.locator('.save-row')).toHaveCount(1);

    // load from the pause menu restores it
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await debug(page, { d: 'credits', amount: 5 });
    await expect(page.locator('#credits')).toHaveText('5');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Load Game' }).click();
    await page.locator('.save-row').getByRole('button', { name: 'Load' }).click();
    await waitForMatch(page);
    await expect(page.locator('#credits')).toHaveText('2,222');

    // delete
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Load Game' }).click();
    page.once('dialog', (d) => d.accept());
    await page.locator('.save-row').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#save-list .empty')).toHaveText('No saved games yet.');
  });

  test('autosave writes one slot, and Continue resumes it from the title screen', async ({ page }) => {
    await openGame(page);
    await debug(page, { d: 'credits', amount: 777 });
    await expect(page.locator('#credits')).toHaveText('777');
    await page.evaluate(() => (window as any).flow.autosave());
    await page.evaluate(() => (window as any).flow.autosave()); // second write overwrites the same slot
    const saves = await page.evaluate(async () => (await (await fetch('/api/saves')).json()) as { kind: string; name: string }[]);
    expect(saves).toEqual([expect.objectContaining({ kind: 'auto', name: 'Autosave' })]);
    await expect(page.locator('#toast')).toHaveText('Game autosaved');

    // quit to the menu, then Continue
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quit to Main Menu' }).click();
    await expect(page.locator('.title-screen')).toBeVisible();
    await expect(page.locator('#hud')).toHaveJSProperty('hidden', true);
    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeEnabled();
    await expect(page.locator('.menu-sub')).toContainText('Autosave');
    await cont.click();
    await waitForMatch(page);
    await expect(page.locator('#credits')).toHaveText('777');
  });

  test('autosave fires on its own after the set game time', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('gravity-harvest:settings', JSON.stringify({ autosave: true, autosaveMinutes: 1 })));
    await openGame(page);
    await debug(page, { d: 'addTime', ms: 61_000 }); // fast-forward the match clock
    await expect.poll(async () => (await page.evaluate(async () => (await (await fetch('/api/saves?kind=auto')).json()) as unknown[])).length,
      { timeout: 15_000 }).toBe(1);
  });

  test('victory leads to the end screen with stats; Play Again starts a fresh match', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => (window as any).flow.autosave()); // the finished match's autosave gets cleared
    await debug(page, { d: 'destroyTeam', team: 'enemy', units: false, buildings: true });
    await expect(page.locator('.gameover-title')).toHaveText('VICTORY', { timeout: 10_000 });
    await expect(page.locator('.stat').filter({ hasText: 'Structures destroyed' }).locator('.stat-value')).toHaveText('5');
    expect(await page.evaluate(async () => (await (await fetch('/api/saves?kind=auto')).json()).length)).toBe(0);
    await page.getByRole('button', { name: 'Play Again' }).click();
    await waitForMatch(page);
    await expect(page.locator('#credits')).toHaveText('15,000');
    expect(await scene(page, (s) => s.view.stats.buildingsDestroyed)).toBe(0);
  });

  test('defeat leads to the end screen; Main Menu goes back to the title', async ({ page }) => {
    await openGame(page);
    await debug(page, { d: 'destroyTeam', team: 'player', units: true, buildings: true });
    await expect(page.locator('.gameover-title')).toHaveText('DEFEAT', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.locator('.title-screen')).toBeVisible();
  });
});
