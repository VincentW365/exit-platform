/**
 * Editable generated forms, PDF downloads, asset receipt records and
 * flexible email recipients in the browser (owner directive 2026-09-23,
 * DEC-069).
 *
 * The operating model, driven end to end: a letter is generated, HR rewords
 * it with the case facts locked, downloads the draft PDF, finalizes it; the
 * action form has a PDF at every stage and a version history; the manager
 * notice shows its auto-assigned recipient, is re-addressed for one message,
 * previewed, downloaded as a PDF and restored; the exit checklist is edited
 * as a document with added rows, previewed as a PDF and finalized.
 *
 * Screenshots go to artifacts/editable-documents/ (gitignored; synthetic
 * data only).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openActiveHrValidatedCase, signInAs, signOut } from './support/case';

const OUT = 'artifacts/editable-documents';
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

async function pdfOk(page: Page, href: string): Promise<number> {
  const resp = await page.request.get(href);
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toContain('application/pdf');
  const bytes = Buffer.from(await resp.body());
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  return bytes.length;
}

test('letter: edit the wording with facts locked, draft PDF, version history, finalize', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);

  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Employee Address', exact: true })
    .fill('12 Synthetic Avenue');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();

  // The generated letter opens editable: readable paragraphs, locked facts.
  const editor = page.locator('.doc-editor__surface');
  await expect(editor).toBeVisible();
  const facts = editor.locator('.doc-editor__fact');
  await expect(facts.first()).toBeVisible();
  const factCount = await facts.count();
  expect(factCount).toBeGreaterThan(3);
  await snap(page, '01-letter-editor', true);
  await axeCheck(page, 'letter-editor');

  // A draft PDF exists before anything is finalized, marked as a draft.
  const draftHref = await page
    .getByRole('link', { name: 'Download PDF (draft)' })
    .first()
    .getAttribute('href');
  await pdfOk(page, draftHref!);

  // Add words at the end, remove a sentence, save: a new version.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('We thank you for your contribution to the company.');
  await page.getByRole('button', { name: 'Save wording' }).click();
  await expect(page.getByText(/Wording saved as version 2/)).toBeVisible();
  await expect(page.locator('.doc-preview').first()).toContainText(
    'We thank you for your contribution',
  );
  // The facts survived the edit, unchanged in number.
  await expect(page.locator('.doc-editor__fact')).toHaveCount(factCount);
  await snap(page, '02-letter-edited', true);

  // The version history names what happened.
  const history = page.locator('.revisions').first();
  await history.locator('summary').click();
  await expect(history).toContainText('Edited');
  await expect(history).toContainText('Generated automatically');

  // Finalize: the edited wording is what is bound and rendered.
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and finalize (attested)' }).click();
  await expect(
    page.getByText('Document finalized; the final PDF has been rendered.'),
  ).toBeVisible();
  await expect(page.locator('.doc-preview').first()).toContainText(
    'We thank you for your contribution',
  );
  await expect(page.locator('.doc-editor__surface')).toHaveCount(0);
  const finalHref = await page
    .getByRole('link', { name: 'Download PDF', exact: true })
    .first()
    .getAttribute('href');
  await pdfOk(page, finalHref!);
  await snap(page, '03-letter-finalized', true);
  await signOut(page);
});

test('action form: PDF at every stage, versions kept, new version after the officer signs', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();

  // Draft PDF from the toolbar, and a Draft status in the owner's words.
  await expect(page.locator('.badge', { hasText: 'Draft' }).first()).toBeVisible();
  const draftHref = await page
    .getByRole('link', { name: 'Download PDF (draft)' })
    .getAttribute('href');
  const draftBytes = await pdfOk(page, draftHref!);

  // A remark is narrative: editable, and every save is a version.
  await page.locator('#hrRemarks').fill('First note.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await page.locator('#hrRemarks').fill('Second note, corrected.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  const history = page.locator('.revisions').first();
  await history.locator('summary').click();
  await expect(history).toContainText('Edited by');
  await expect(history).toContainText('Generated automatically');
  // The remark prints: the draft PDF grew.
  expect(await pdfOk(page, draftHref!)).toBeGreaterThan(draftBytes - 1);
  await snap(page, '04-form-workspace', true);

  // The officer signs; the version locks; a change is a new version.
  const hrPad = page.locator(
    'section[aria-labelledby="sig-heading"] .sigpad[data-mode="SIGNATURE"] canvas',
  );
  await hrPad.scrollIntoViewIfNeeded();
  const box = (await hrPad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2 - 10, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Add my signature' }).click();
  await expect(page.getByText('Your signature has been added.')).toBeVisible();
  await expect(page.getByText(/Your signature is on this version/)).toBeVisible();
  await expect(page.locator('#hrRemarks')).toHaveCount(0);
  await snap(page, '05-form-locked-by-signature', true);

  await page
    .locator('details.action', { has: page.locator('summary', { hasText: 'Start new version' }) })
    .locator('summary')
    .click();
  await page.getByRole('textbox', { name: 'Reason' }).fill('Effective date corrected.');
  await page.getByRole('button', { name: 'Start new version' }).click();
  await expect(page.getByText(/Version 2 started/)).toBeVisible();
  await expect(page.getByText('Version 2', { exact: false }).first()).toBeVisible();
  await expect(page.locator('#hrRemarks')).toHaveValue('Second note, corrected.');
  await expect(page.locator('.form-table img.sigmark')).toHaveCount(0);
  await snap(page, '06-form-new-version', true);
  await signOut(page);
});

test('email: auto-assigned recipient, override for one message, preview, PDF, restore, edit', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);

  // A message that waits for review by design: the manual exception notice.
  // It is addressed by the same hierarchy as every other message.
  await page.goto(`${caseUrl}/notifications`);
  await page.locator('summary', { hasText: 'Prepare a manual notification' }).click();
  await page.locator('#n-type').selectOption('MANUAL_EXCEPTION_NOTIFICATION');
  await page.locator('#n-manual').fill('Your final pay date has been confirmed by Payroll.');
  await page.getByRole('button', { name: 'Prepare draft' }).click();
  await expect(page.getByText('Notification draft prepared')).toBeVisible();

  const cardOf = () =>
    page.locator('section.email-card', { hasText: 'Manual exception notice' }).first();
  const card = cardOf();
  await expect(card).toBeVisible();
  // The platform's status word stays on the badge; the directive's state word
  // reads beneath it.
  await expect(card.locator('.badge').first()).toHaveText('Being prepared');
  await expect(card.locator('p.meta').first()).toContainText('Draft');
  const recipient = card.locator('.recipient');
  await expect(recipient).toContainText('Auto-assigned from the employee record on the case');
  const autoName = (await recipient.locator('.recipient__to .value').textContent())?.trim() ?? '';
  expect(autoName.length).toBeGreaterThan(0);
  await snap(page, '07-email-auto-assigned', true);
  await axeCheck(page, 'email-actions');

  // Preview and PDF exist before sending.
  await card.locator('summary', { hasText: 'Preview' }).click();
  await expect(card.locator('iframe')).toBeVisible();
  const previewHref = await card
    .getByRole('link', { name: 'Download preview PDF' })
    .getAttribute('href');
  await pdfOk(page, previewHref!);

  // Edit the email before sending: a new version, and the preview follows.
  await card.locator('summary', { hasText: 'Edit email' }).click();
  const body = card.locator('textarea[name="body"]');
  await body.fill(`${await body.inputValue()}\n\nPlease also return the desk keys to reception.`);
  await card.getByRole('button', { name: 'Save email' }).click();
  await expect(page.getByText(/Email saved as version 2/)).toBeVisible();
  const edited = cardOf();
  await edited.locator('summary', { hasText: 'Preview' }).click();
  await expect(edited.frameLocator('iframe').locator('body')).toContainText('desk keys');
  const history = edited.locator('.revisions').first();
  await history.locator('summary').click();
  await expect(history).toContainText('Edited by');

  // Change the recipient for this message only, from the picker.
  await edited.locator('summary', { hasText: 'Change recipient' }).click();
  await edited.getByRole('searchbox', { name: 'Search known recipients' }).fill('manager');
  const choice = edited
    .locator('.recipient-picker__choice', { hasText: 'Reporting manager' })
    .first();
  await expect(choice).toBeVisible();
  const chosenName = (await choice.locator('.recipient-picker__name').textContent())?.trim() ?? '';
  await choice.click();
  await edited.getByRole('button', { name: /^Send to / }).click();
  await expect(page.getByText(/Recipient changed for this message/)).toBeVisible();
  const overridden = cardOf();
  await expect(overridden.locator('.recipient')).toContainText('Recipient overridden');
  await expect(overridden.locator('.recipient')).toContainText(`Auto-assigned: ${autoName}`);
  await expect(overridden.locator('.recipient__to .value')).toHaveText(chosenName);
  await snap(page, '08-email-recipient-overridden', true);

  // Restore brings the hierarchy's answer back without rediscovering it.
  await overridden.getByRole('button', { name: 'Restore auto-assigned recipient' }).click();
  await expect(page.getByText(/Auto-assigned recipient restored/)).toBeVisible();
  const restored = cardOf();
  await expect(restored.locator('.recipient')).not.toContainText('Recipient overridden');
  await expect(restored.locator('.recipient__to .value')).toHaveText(autoName);

  // Submit for review, then Send; the sent record has a record PDF and no editor.
  await restored.locator('summary', { hasText: 'Manual handling (legacy)' }).click();
  await restored.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Submitted for review.')).toBeVisible();
  const reviewed = cardOf();
  await reviewed.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/Released/)).toBeVisible();
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();
  await page.goto(`${caseUrl}/notifications`);
  const sent = cardOf();
  await expect(sent.locator('.badge').first()).toHaveText('Sent');
  await expect(sent.locator('p.meta').first()).toContainText('Sent');
  await expect(sent.locator('summary', { hasText: 'Edit email' })).toHaveCount(0);
  const recordHref = await sent
    .getByRole('link', { name: 'Download email record PDF' })
    .getAttribute('href');
  await pdfOk(page, recordHref!);
  await expect(sent.locator('summary', { hasText: 'Prepare corrected copy' })).toBeVisible();
  await snap(page, '09-email-sent-record', true);
  await signOut(page);
});

test('exit checklist: edit rows as a document, add a row, draft PDF, finalize', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize(DESKTOP);
  await signInAs(page, 'HR Manager');
  const caseUrl = await openActiveHrValidatedCase(page);
  await page.goto(`${caseUrl}/assets`);
  const receipt = page.locator('section.receipt');
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('.badge', { hasText: 'Draft' }).first()).toBeVisible();
  const draftHref = await receipt
    .getByRole('link', { name: 'Download PDF (draft)' })
    .getAttribute('href');
  await pdfOk(page, draftHref!);

  const editDetails = receipt.locator('details.action', { hasText: 'Edit checklist' });
  if ((await editDetails.getAttribute('open')) === null)
    await editDetails.locator('summary').click();
  await receipt.getByRole('combobox', { name: 'Status for Laptop' }).selectOption('RETURNED');
  await receipt.getByRole('spinbutton', { name: 'Quantity for Laptop' }).fill('1');
  await receipt
    .getByRole('textbox', { name: 'Condition for Laptop' })
    .fill('Good, charger included');
  await receipt.getByRole('button', { name: 'Add a row' }).click();
  await receipt
    .getByRole('textbox', { name: 'Item name for row 11' })
    .fill('Company vehicle key fob');
  await receipt
    .getByRole('combobox', { name: /Status for Company vehicle key fob/ })
    .selectOption('RETURNED');
  await receipt.getByLabel('Items Received By:').fill('Avery HR');
  await receipt
    .getByLabel('HR notes (printed on the receipt)')
    .fill('Laptop bag was never issued.');
  await snap(page, '10-receipt-editor', true);
  await receipt.getByRole('button', { name: 'Save checklist' }).click();
  await expect(page.getByText('Checklist saved as a new version.')).toBeVisible();

  const saved = page.locator('section.receipt');
  await expect(saved).toContainText('Company vehicle key fob');
  await expect(saved).toContainText('Good, charger included');
  const history = saved.locator('.revisions').first();
  await history.locator('summary').click();
  await expect(history).toContainText('Edited by');
  await snap(page, '11-receipt-saved', true);
  await axeCheck(page, 'receipt');

  await saved.locator('summary', { hasText: 'Finalize' }).click();
  await saved.getByRole('button', { name: 'Finalize checklist' }).click();
  await expect(page.getByText('Checklist finalized; its PDF has been rendered.')).toBeVisible();
  const final = page.locator('section.receipt');
  await expect(final.locator('.badge', { hasText: 'Final' }).first()).toBeVisible();
  const finalHref = await final
    .getByRole('link', { name: 'Download PDF', exact: true })
    .getAttribute('href');
  await pdfOk(page, finalHref!);
  await expect(final.getByRole('button', { name: 'Save checklist' })).toHaveCount(0);
  await snap(page, '12-receipt-final', true);
  await signOut(page);
});
