// Smoke test for the dev pages (dev/*.html, served by the dev server only): each one opens and runs for a moment
// without a console error or an uncaught exception. They aren't built or type-checked as pages, so this is what
// notices one broken by a change elsewhere.
import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

const PAGES = readdirSync(new URL('../dev/', import.meta.url)).filter((f) => f.endsWith('.html')).sort();
/** The building page's Animation tab runs units through a real sim: a building with each kind of trip. */
const TRAFFIC = ['barracks', 'refinery', 'service_bay'].map((b) => `building.html?b=${b}&mode=idle`);
/** How long each page runs before it's judged (ms): enough to load its art and play a little. */
const RUN_MS = 3000;

test.describe('dev pages', () => {
  for (const page of [...PAGES, ...TRAFFIC]) {
    test(`${page} opens without errors`, async ({ page: p }) => {
      const errors = trackErrors(p);
      await p.goto(`/dev/${page}`);
      await p.waitForLoadState('load');
      await p.waitForTimeout(RUN_MS);
      if (TRAFFIC.includes(page)) await expect(p.locator('#traffic')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});
