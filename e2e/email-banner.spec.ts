/**
 * Email banner as a supplied JPG (owner directive 2026-09-23, DEC-067).
 *
 * The HR Manager uploads the department banner under Administration, an
 * officer may upload a personal one under My Settings, and a captured
 * development email then shows the complete presentation - text, links and
 * the banner image, scaled to the width of the reader's screen. Screenshots
 * go to artifacts/email-banner/ (gitignored; synthetic data only).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

const OUT = 'artifacts/email-banner';
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/email-banner.jpg');
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function noOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} overflow`).toBeLessThanOrEqual(1);
}

async function axeCheck(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    serious.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length})`),
  ).toEqual([]);
}

test('the HR Manager supplies the department banner; captured emails show it, scaled and unstretched', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);

  // --- Administration: upload the supplied JPG ------------------------------
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/system');
  const admin = page.locator('section[aria-labelledby="banner-admin-h"]');
  await expect(admin).toBeVisible();
  await admin.locator('#dept-banner-file').setInputFiles(FIXTURE);
  await admin.locator('#dept-banner-reason').fill('Supplied HR banner (synthetic test asset).');
  await admin.getByRole('button', { name: 'Upload banner', exact: true }).click();
  await expect(
    page.getByText(/Department email banner saved \(1500 × 320 px\) and enabled/),
  ).toBeVisible();
  const preview = page.locator('figure[aria-label="Current department email banner"] img');
  await expect(preview).toBeVisible();
  // The stored asset is served intact: a real JPEG at its own size.
  const src = await preview.getAttribute('src');
  const img = await page.request.get(src!);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/jpeg');
  await expect
    .poll(() => preview.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBe(1500);
  await page.screenshot({ path: `${OUT}/01-admin-department-banner.png`, fullPage: true });
  await axeCheck(page, 'admin-banner');

  // --- An email goes out: activation derives the department notices --------
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(`${caseUrl}/notifications`);
  for (let i = 0; i < 6; i++) {
    const release = page.getByRole('button', { name: /Review and release/ }).first();
    if ((await release.count()) === 0) break;
    await release.click();
    await expect(page.getByText(/Released\./)).toBeVisible();
  }
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();

  // --- Development mailbox: the complete presentation ------------------------
  await page.goto('/dev/mailbox');
  const message = page.locator('section[aria-label="Captured message"]').first();
  await expect(message).toBeVisible();
  await expect(message.locator('[data-banner-status]')).toContainText('Banner: department');
  await expect(message.locator('[data-banner-status]')).toContainText('1500 × 320 px');
  const frame = message.frameLocator('iframe');
  const bannerImg = frame.locator('img');
  await expect(bannerImg).toHaveCount(1); // never duplicated
  await expect(bannerImg).toHaveAttribute('alt', "Bert's Auto Parts email signature");
  await expect(bannerImg).toHaveAttribute(
    'style',
    /display:block;width:100%;max-width:1500px;height:auto;/,
  );
  await expect
    .poll(() => bannerImg.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBe(1500);
  const srcdoc = (await message.locator('iframe').getAttribute('srcdoc')) ?? '';
  expect(srcdoc).not.toContain('background-image');
  expect(srcdoc).toContain('/api/email-banner/capture-');
  // Desktop: the image is bounded by the column, never wider than itself.
  const desktopBox = await bannerImg.boundingBox();
  expect(desktopBox!.width).toBeLessThanOrEqual(1500);
  expect(desktopBox!.width).toBeGreaterThan(300);
  await noOverflow(page, 'mailbox desktop');
  // The evidence is the one message, not the whole mailbox.
  await message.screenshot({ path: `${OUT}/02-mailbox-desktop.png` });
  await axeCheck(page, 'mailbox');

  // Mobile width: scales down proportionally, no horizontal scroll, no clipping.
  await page.setViewportSize(MOBILE);
  await page.goto('/dev/mailbox');
  const mobileMessage = page.locator('section[aria-label="Captured message"]').first();
  const mobileImg = mobileMessage.frameLocator('iframe').locator('img');
  await expect(mobileImg).toBeVisible();
  const mobileBox = await mobileImg.boundingBox();
  expect(mobileBox!.width).toBeLessThanOrEqual(MOBILE.width);
  const ratio = mobileBox!.width / mobileBox!.height;
  expect(Math.abs(ratio - 1500 / 320)).toBeLessThan(0.15); // aspect ratio kept
  await noOverflow(page, 'mailbox mobile');
  const frameOverflow = await mobileMessage
    .frameLocator('iframe')
    .locator('body')
    .evaluate((b) => b.scrollWidth - b.clientWidth);
  expect(frameOverflow).toBeLessThanOrEqual(1);
  await mobileMessage.screenshot({ path: `${OUT}/03-mailbox-mobile.png` });
  await page.setViewportSize(DESKTOP);

  // Links stay usable without images: the plain-text part carries them.
  await page.goto('/dev/mailbox');
  const first = page.locator('section[aria-label="Captured message"]').first();
  await first.locator('details.action > summary').click();
  await expect(first.locator('pre')).toContainText(/https?:\/\//);
  await signOut(page);
});

test('a user keeps a personal signature banner under My Settings', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Officer');
  await page.getByRole('link', { name: 'My settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.locator('#bannerFile').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Upload banner', exact: true }).click();
  await expect(page.getByText(/Personal email banner saved \(1500 × 320 px\)/)).toBeVisible();
  const preview = page.locator('figure[aria-label="Current personal email banner"] img');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('alt', 'HR Officer email signature');
  await expect(page.getByText('Personal banner set')).toBeVisible();
  await page.screenshot({ path: `${OUT}/04-my-settings-personal-banner.png`, fullPage: true });
  await axeCheck(page, 'my-settings');
  await page.getByRole('button', { name: 'Remove personal banner' }).click();
  await page.getByRole('button', { name: 'Remove banner' }).click();
  await expect(page.getByText('Personal email banner removed.')).toBeVisible();
  await signOut(page);
});
