/**
 * Employee Action Form branding, initials and electronic signatures in the
 * browser (owner directives 2026-09-23, DEC-068).
 *
 * The twelve-step workflow the first directive asks for, end to end: HR opens
 * a branded form, creates a signature request, copies the link and emails it,
 * the employee opens it on a phone with no HR login, reads the details, draws
 * initials once and applies them to every section, signs, consents and
 * submits; the link then refuses a second use, HR sees the marks, signs
 * in-app, completes the form and downloads the PDF.
 *
 * Screenshots go to artifacts/action-form-signing/ (gitignored; synthetic
 * data only) as the visual evidence section 43 asks for.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

const OUT = 'artifacts/action-form-signing';
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function snap(page: Page, name: string, mobileToo = false): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.screenshot({ path: `${OUT}/${name}-desktop.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} desktop overflow`).toBeLessThanOrEqual(1);
  if (mobileToo) {
    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${OUT}/${name}-mobile.png`, fullPage: true });
    const mOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mOverflow, `${name} mobile overflow`).toBeLessThanOrEqual(1);
    await page.setViewportSize(DESKTOP);
  }
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

/**
 * Draw on a signing pad the way a finger does: one pointer down, several
 * moves, one up. Playwright's mouse emits real pointer events, which is
 * exactly the path a touch device takes through the component.
 */
async function drawOn(page: Page, pad: ReturnType<Page['locator']>): Promise<void> {
  const canvas = pad.locator('canvas');
  await expect(canvas).toBeVisible();
  // Pointer coordinates are viewport coordinates: a pad below the fold has
  // to come into view before it can be drawn on.
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (const step of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    await page.mouse.move(box.x + box.width * step, y + (step < 0.5 ? -18 : 14), { steps: 4 });
  }
  await page.mouse.up();
  await expect(pad).toHaveAttribute('data-applied', 'yes');
}

test('branded form -> signature request -> employee signs by link -> HR signs -> completed PDF', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);
  await page.setViewportSize(DESKTOP);

  // --- 1. HR Manager builds an ACTIVE case ---------------------------------
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await signOut(page);

  // --- 2. The assigned officer opens a branded Action Form ------------------
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();

  // The approved logo asset itself, at its own aspect ratio - not redrawn.
  const logo = page.locator('.paper__logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /\/brand\/berts-auto-parts\.png/);
  await expect
    .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(100);
  const ratio = await logo.evaluate((el) => {
    const img = el as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    return Math.abs(rect.width / rect.height - img.naturalWidth / img.naturalHeight);
  });
  expect(ratio, 'logo is not stretched').toBeLessThan(0.05);

  // A clean header: the facts a signer needs before signing.
  for (const label of [
    'Employee Name:',
    'Employee Number:',
    'Department/Location:',
    'Position:',
    'Separation Type:',
    'Effective Date:',
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await snap(page, '01-branded-action-form', true);
  await axeCheck(page, 'action-form');

  // --- 3. Create the signature request, then choose how to deliver it -------
  const panel = page.locator('section[aria-labelledby="sig-heading"]');
  await expect(panel).toBeVisible();
  // Creating is not sending: no HR Manager approval appears anywhere here.
  await expect(panel.getByText(/HR Manager approval/i)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Create signature request' }).click();
  await expect(page.getByText(/Signature request ready/)).toBeVisible();
  await expect(panel.getByText('Awaiting signature')).toBeVisible();
  await snap(page, '02-signature-request-created', true);

  // --- 4. Copy Signing Link gives the whole URL, and puts it nowhere else ---
  const linkResponse = page.waitForResponse((r) =>
    /\/api\/signatures\/requests\/[^/]+\/link$/.test(new URL(r.url()).pathname),
  );
  await panel.getByRole('button', { name: 'Copy signing link' }).click();
  const { url: signingUrl } = (await (await linkResponse).json()) as { url: string };
  expect(signingUrl).toContain('/sign/');
  // The link is built from the deployment's own base address; the browser
  // test drives the server under test, so it follows the token.
  const token = signingUrl.split('/sign/')[1]!;
  expect(token.length).toBeGreaterThan(30);
  const signingPath = `/sign/${token}`;
  // Directive 2 section 16: the link never reaches the address bar, so it
  // never reaches browser history or a server request log.
  expect(page.url()).not.toContain(token);
  await expect(page.getByText(/Signing link copied|Select the link below/)).toBeVisible();
  await snap(page, '03-copy-signing-link');

  // --- 5. Send by Email: the same request, captured in development ---------
  const refreshed = page.locator('section[aria-labelledby="sig-heading"]');
  await refreshed.getByRole('button', { name: 'Send by email' }).click();
  await expect(page.getByText(/Signature request sent to/)).toBeVisible();
  await signOut(page);

  // Dispatch and the development capture are an administrator's view.
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();

  await page.goto('/dev/mailbox');
  const message = page.locator('section[aria-label="Captured message"]').first();
  await expect(message).toBeVisible();
  await expect(message).toContainText('Please review and sign');
  // The captured body carries the live link, resolved at dispatch. A banner
  // is a per-sender option, so its absence here must not block the send.
  const frame = message.frameLocator('iframe');
  await expect(frame.locator('body')).toContainText(token);
  await expect(frame.locator('body')).toContainText('valid until');
  await snap(page, '04-signature-request-email', true);

  // The sent request also reads correctly on the case's own email actions,
  // in business words, with no release control left to press.
  await page.goto(`${caseUrl}/notifications`);
  const sigAction = page.getByText('Signature request').first();
  await expect(sigAction).toBeVisible();
  await expect(page.locator('body')).not.toContainText(token);
  await signOut(page);

  // --- 6. The employee: a phone, no HR login, no role ----------------------
  const phone = await browser.newContext({
    viewport: MOBILE,
    hasTouch: true,
    isMobile: true,
  });
  const signer = await phone.newPage();
  await signer.goto(signingPath);
  await expect(signer.getByRole('heading', { name: 'Employee Action Form' })).toBeVisible();
  // No HR chrome reaches this page: no navigation, no role switcher.
  await expect(signer.getByRole('button', { name: /Sign in as/ })).toHaveCount(0);
  await expect(signer.getByRole('link', { name: 'My Work' })).toHaveCount(0);
  await expect(signer.locator('.signing__brand img')).toBeVisible();
  // Only what this signer must read - never the HR case.
  await expect(signer.getByText('Case reference')).toBeVisible();
  await expect(signer.getByText(/Internal note|Audit|Workflow tasks/)).toHaveCount(0);
  await signer.screenshot({ path: `${OUT}/05-signing-page-mobile.png`, fullPage: true });
  await axeCheck(signer, 'signing-page');

  // --- 7. Refusing an incomplete submission --------------------------------
  await signer.getByRole('button', { name: 'Submit signed form' }).click();
  const problems = signer.locator('.alert--error');
  await expect(problems).toContainText('Before you submit');
  await expect(problems).toContainText('Initials are needed');

  // --- 8. Draw initials ONCE, then apply them everywhere -------------------
  await signer.getByLabel(/I confirm that I have reviewed/).check();
  const pads = signer.locator('.sigpad[data-mode="INITIALS"]');
  await expect(pads).toHaveCount(3);
  await drawOn(signer, pads.nth(0));
  await signer.getByRole('button', { name: 'Use these initials everywhere else' }).click();
  for (let i = 0; i < 3; i += 1) {
    await expect(pads.nth(i)).toHaveAttribute('data-applied', 'yes');
  }
  await signer.screenshot({ path: `${OUT}/06-initials-applied-mobile.png`, fullPage: true });

  // --- 9. The full signature, then the declaration -------------------------
  const signaturePad = signer.locator('.sigpad[data-mode="SIGNATURE"]');
  await drawOn(signer, signaturePad);
  await signer.getByLabel(/I confirm that the signature and initials/).check();
  await signer.screenshot({ path: `${OUT}/07-ready-to-submit-mobile.png`, fullPage: true });
  await signer.getByRole('button', { name: 'Submit signed form' }).click();
  await expect(signer.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await signer.screenshot({ path: `${OUT}/08-signed-confirmation-mobile.png`, fullPage: true });

  // --- 10. The link is spent ------------------------------------------------
  await signer.goto(signingPath);
  await expect(signer.getByText('This signing request has already been completed.')).toBeVisible();
  await signer.screenshot({ path: `${OUT}/09-already-completed-mobile.png`, fullPage: true });
  await phone.close();

  // --- 11. HR sees the marks and signs in the application ------------------
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/action-form`);
  const after = page.locator('section[aria-labelledby="sig-heading"]');
  await expect(after.locator('.badge', { hasText: 'Signed' })).toBeVisible();
  await expect(after.getByText('4 of 4')).toBeVisible();
  // The employee's mark is on the sheet, served from the private route.
  const employeeMark = page.locator('.form-table img.sigmark').first();
  await expect(employeeMark).toBeVisible();
  await expect(employeeMark).toHaveAttribute('src', /^\/api\/signatures\/[0-9a-f-]+\/image$/);
  await expect
    .poll(() => employeeMark.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await snap(page, '10-hr-sees-signatures', true);

  const hrPad = after.locator('.sigpad[data-mode="SIGNATURE"]');
  await drawOn(page, hrPad);
  await page.getByRole('button', { name: 'Add my signature to the form' }).click();
  await expect(page.getByText('Your signature has been added to the form.')).toBeVisible();
  await snap(page, '11-hr-signature-applied', true);

  // --- 12. Complete the form and download the signed PDF -------------------
  // The acknowledgement is already recorded as an electronic signature, so
  // the officer only records the checklist evidence around it.
  await expect(page.locator('#ackStatus')).toHaveValue('ACKNOWLEDGED');
  for (const key of [
    'caseInfoVerified',
    'evidenceRecorded',
    'contactVerified',
    'benefitsInitiated',
    'propertyProcessInitiated',
    'accessRemovalRecorded',
    'surveyEligibilityAssessed',
    'hrisUpdate',
  ]) {
    await page.locator(`#hr-${key}-DONE`).check();
  }
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  for (const key of [
    'financeNotified',
    'workpaperInitiated',
    'workpaperCompleted',
    'payrollActioned',
    'otherApprovedAction',
  ]) {
    await page.locator(`#fin-${key}-DONE`).check();
  }
  await page.getByRole('button', { name: 'Save Finance evidence' }).click();
  await expect(page.getByText('Finance evidence saved.')).toBeVisible();
  // The signature survived the save: it is evidence, not a form field.
  await expect(page.locator('.form-table img.sigmark')).toHaveCount(2);

  await page.getByRole('button', { name: 'Finish preparation (ready for review)' }).click();
  await expect(page.getByText('Form finished and ready for review.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Complete action form (attested, renders final PDF)' })
    .click();
  await expect(page.getByText(/Action form completed/)).toBeVisible();

  // The final PDF renders and downloads, with the marks on it.
  const formPdf = await page.getByRole('link', { name: 'Download final PDF' }).getAttribute('href');
  const dl = await page.request.get(formPdf!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toContain('application/pdf');
  expect((await dl.body()).byteLength).toBeGreaterThan(5_000);

  // A finalized version locks its signatures: no signing controls remain.
  const locked = page.locator('section[aria-labelledby="sig-heading"]');
  await expect(locked.getByRole('button', { name: 'Copy signing link' })).toHaveCount(0);
  await expect(locked.getByRole('button', { name: 'Replace and sign again' })).toHaveCount(0);
  await snap(page, '12-completed-form', true);
  await signOut(page);
});

test('a revoked link stops working and says so neutrally', async ({ page, browser }) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();

  const panel = page.locator('section[aria-labelledby="sig-heading"]');
  await panel.getByRole('button', { name: 'Create signature request' }).click();
  await expect(page.getByText(/Signature request ready/)).toBeVisible();
  const revokeLinkResponse = page.waitForResponse((r) =>
    /\/api\/signatures\/requests\/[^/]+\/link$/.test(new URL(r.url()).pathname),
  );
  await page
    .locator('section[aria-labelledby="sig-heading"]')
    .getByRole('button', { name: /^Copy signing link$/ })
    .click();
  const { url: revokeUrl } = (await (await revokeLinkResponse).json()) as { url: string };
  const signingPath = `/sign/${revokeUrl.split('/sign/')[1]}`;

  // Extend, then revoke - both in business language, both audited.
  const live = page.locator('section[aria-labelledby="sig-heading"]');
  await live.getByRole('button', { name: 'Extend link' }).click();
  await expect(page.getByText(/Link extended/)).toBeVisible();
  await page
    .locator('section[aria-labelledby="sig-heading"]')
    .getByRole('button', { name: 'Revoke link' })
    .click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Reason').fill('Employee details corrected.');
  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText(/no longer works/)).toBeVisible();
  await expect(page.getByText('Revoked').first()).toBeVisible();
  await snap(page, '13-revoked-request', true);

  const outside = await browser.newContext();
  const visitor = await outside.newPage();
  await visitor.goto(signingPath);
  await expect(visitor.getByText('This signing request is no longer valid.')).toBeVisible();
  // Nothing about the case leaks through the refusal.
  await expect(visitor.locator('body')).not.toContainText('Avery');
  await visitor.screenshot({ path: `${OUT}/14-revoked-link.png`, fullPage: true });
  await outside.close();
  await signOut(page);
});
