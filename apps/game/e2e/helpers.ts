import { expect, type Page } from '@playwright/test';

/** Collect page errors (ignoring the missing favicon). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  return errors;
}

/** Open the app on the title screen (first-run help dismissed). */
export async function openTitle(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('gravity-harvest:help-seen', '1'));
  await page.goto('/');
  await expect(page.locator('.title-screen')).toBeVisible({ timeout: 20_000 });
}

/** Title screen → New Game → Start, and wait until the match is running. */
export async function openGame(page: Page): Promise<string[]> {
  const errors = trackErrors(page);
  await openTitle(page);
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.locator('.scenario-card').getByRole('button', { name: 'Start' }).click();
  await waitForMatch(page);
  return errors;
}

export async function waitForMatch(page: Page): Promise<void> {
  // reports what's missing, so a timeout says why
  await expect.poll(() => page.evaluate(() => {
    const g = (window as any).game;
    const s = g?.scene?.getScene('game');
    if (!g) return 'no game';
    if (!g.scene.isActive('game')) return `game scene not active (status ${s?.sys.settings.status})`;
    if (!s.ready) return 'no view from the server yet';
    if (!s.units.size) return 'no units drawn';
    return 'ready';
  }), { timeout: 20_000 }).toBe('ready');
  await expect(page.locator('#hud')).toHaveJSProperty('hidden', false);
}

/** Run a function against the live GameScene in the page (it draws the server's match; see `debug`). */
export function scene<T>(page: Page, fn: (s: any) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.game.scene.getScene('game'))`) as Promise<T>;
}

/** Screen position (CSS px) of a grid point, for real mouse clicks. */
export function screenAt(page: Page, gx: number, gy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([gx, gy]) => {
    const s = (window as any).game.scene.getScene('game');
    const cam = s.cameras.main;
    const rect = s.game.canvas.getBoundingClientRect();
    const k = rect.width / s.game.canvas.width;
    const x = (gx - gy) * 64;
    const y = (gx + gy) * 32;
    return { x: rect.left + (x - cam.worldView.x) * cam.zoom * k, y: rect.top + (y - cam.worldView.y) * cam.zoom * k };
  }, [gx, gy] as const);
}

/** Send a debug command to the test server's match (the only way to change match state from a test). */
export async function debug(page: Page, cmd: Record<string, unknown>): Promise<void> {
  await page.evaluate((c) => (window as any).game.scene.getScene('game').net.debug(c), cmd);
}

/** IDs of the human's units of a type, as currently drawn. */
export function myUnits(page: Page, type: string): Promise<number[]> {
  return page.evaluate((t) => [...(window as any).game.scene.getScene('game').units.values()]
    .filter((u: any) => u.team === 'player' && u.type === t).map((u: any) => u.id as number), type);
}

/** Delete every save on the (throwaway) test server. */
export async function clearSaves(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const list = (await (await fetch('/api/saves')).json()) as { id: string }[];
    await Promise.all(list.map((s) => fetch(`/api/saves/${s.id}`, { method: 'DELETE' })));
  });
}
