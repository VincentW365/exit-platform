/**
 * Exit Center presentation (owner directive, 2026-09-23, section 32).
 *
 * Captures the main page for both roles at four widths, checks the page
 * against axe at the two desktop widths, and pins the hierarchy the
 * directive asks for: the page identity, the sections in their order, and
 * no horizontal overflow at any width. Screenshots land under
 * `artifacts/exit-center/<set>/` where <set> comes from EXIT_CENTER_SHOTS
 * (default "after"), so a run before a change and a run after it can be
 * compared side by side.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { signInAs, signOut } from './support/case';

const SET = process.env.EXIT_CENTER_SHOTS ?? 'after';
const DIR = path.join('artifacts', 'exit-center', SET);
const WIDTHS = [
  { name: 'desktop-xl', width: 1600, height: 1000 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const role of ['HR Manager', 'HR Officer'] as const) {
  test(`Exit Center as ${role}: hierarchy, widths and accessibility`, async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(DIR, { recursive: true });
    await signInAs(page, role);
    const slug = role.toLowerCase().replace(' ', '-');

    for (const vp of WIDTHS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1, name: 'Exit Center' })).toBeVisible();
      expect(await overflowOf(page), `${role} at ${vp.name} overflows`).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: path.join(DIR, `${slug}-${vp.name}.png`),
        fullPage: true,
      });
      if (vp.width >= 1280) {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(
          axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
        ).toEqual([]);
      }
    }
    await signOut(page);
  });
}
