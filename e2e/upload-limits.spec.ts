/**
 * Uploads above 1 MB (owner report, 2026-11-11; DEC-075).
 *
 * Next.js refuses a server action's request body above a limit fixed at build
 * time - 1 MB unless configured - before any platform code runs, so a 1.3 MB
 * banner came back as "Something Went Wrong" with a reference. The build now
 * sizes that limit from MAX_UPLOAD_MB plus a margin, and every file input says
 * in words, before sending, when a chosen file is over the platform's own
 * limit. Synthetic bytes only: the fixture JPG padded to size.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openActiveHrValidatedCase, signInAs } from './support/case';

const FIXTURE = readFileSync(path.resolve(import.meta.dirname, 'fixtures/email-banner.jpg'));
const MB = 1024 * 1024;

/** The fixture JPG with trailing padding: a valid JPEG of the asked-for size. */
function jpegOf(bytes: number): Buffer {
  return Buffer.concat([FIXTURE, Buffer.alloc(bytes - FIXTURE.length)]);
}

test('a 1.5 MB department banner is accepted; a 2.5 MB one is refused in words before it is sent', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/system');
  const admin = page.locator('section[aria-labelledby="banner-admin-h"]');
  await expect(admin).toBeVisible();

  // Over Next's default body limit, under the platform's 2 MB banner rule.
  await admin.locator('#dept-banner-file').setInputFiles({
    name: 'large-banner.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegOf(1.5 * MB),
  });
  await admin.locator('#dept-banner-reason').fill('Upload-limit check (synthetic 1.5 MB asset).');
  await admin.getByRole('button', { name: 'Upload banner', exact: true }).click();
  await expect(
    page.getByText(/Department email banner saved \(1500 × 320 px\) and enabled/),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something Went Wrong' })).toHaveCount(0);

  // Over the platform's own rule: the input says so and holds the submit.
  const input = page.locator('#dept-banner-file');
  await input.setInputFiles({
    name: 'too-large-banner.jpg',
    mimeType: 'image/jpeg',
    buffer: jpegOf(2.5 * MB),
  });
  await expect
    .poll(() => input.evaluate((el) => (el as HTMLInputElement).validationMessage))
    .toBe('This file is 2.5 MB. The limit is 2 MB.');
  await page.locator('#dept-banner-reason').fill('Must not be sent.');
  await page
    .locator('section[aria-labelledby="banner-admin-h"]')
    .getByRole('button', { name: 'Upload banner', exact: true })
    .click();
  // Still on the page, nothing saved, no error page.
  await expect(page).toHaveURL(/\/admin\/system(?:\?.*)?$/);
  await expect(page.getByText(/Must not be sent/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Something Went Wrong' })).toHaveCount(0);
  expect(await input.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);

  // The support section states the limits in force.
  const uploads = page
    .locator('ul[aria-label="Site health for support"] li')
    .filter({ hasText: 'Upload limit' });
  await expect(uploads).toContainText('Files up to 10 MB are accepted');
  await expect(uploads).toContainText('This build accepts requests up to 12 MB');
  await expect(uploads.locator('[class*="chip"]')).toHaveText('Current');
});

test('a 5 MB case attachment arrives whole; the file input names the configured limit', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(caseUrl);
  const details = page.locator('details.action', { hasText: 'Upload a file' });
  await expect(details.locator('summary')).toHaveText('Upload a file (pdf, png, jpg; up to 10 MB)');
  await details.locator('summary').click();
  await page.locator('#up-file').setInputFiles({
    name: 'large-supporting-document.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.concat([
      Buffer.from('%PDF-1.7\nsynthetic large supporting document\n'),
      Buffer.alloc(5 * MB),
    ]),
  });
  await page.locator('#up-purpose').selectOption('SUPPORTING_DOCUMENT');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText(/File uploaded/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Something Went Wrong' })).toHaveCount(0);

  // Above the configured limit: refused in words, never sent.
  await page.locator('details.action', { hasText: 'Upload a file' }).locator('summary').click();
  const input = page.locator('#up-file');
  await input.setInputFiles({
    name: 'oversized.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(11 * MB)]),
  });
  await expect
    .poll(() => input.evaluate((el) => (el as HTMLInputElement).validationMessage))
    .toBe('This file is 11 MB. The limit is 10 MB.');
});
