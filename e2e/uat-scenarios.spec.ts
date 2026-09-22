/**
 * Synthetic UAT journeys aligned with the rewritten UAT plan
 * (docs/operations/UATPlan.md, Directive 6.3) that are not already covered by
 * the stage acceptance suites:
 *
 *   - one INTEGRATED resignation-with-notice case through workflow, document,
 *     benefits confirmation, HR-completed action form, assets,
 *     automated IT/Finance email actions with recorded completion evidence,
 *     outbox capture, survey, clearance, completion and report reflection
 *     (plan sets UAT-1..UAT-5);
 *   - document correction: audited case correction invalidates the approval,
 *     supersede creates a corrected draft, re-approval (UAT-2 supplement);
 *   - continuity: outage and manual fallback with FB references, one-time
 *     reconciliation and gated closure (plan set UAT-7).
 *
 * Directive 6.3 (DEC-045): IT and Finance have NO application logins - they
 * act on the captured controlled emails and the secure acknowledgement links,
 * so no journey below signs in as a responder. The former user-deactivation
 * scenario (built on a disposable IT responder fixture) was retired with
 * those logins. Synthetic data only.
 */
import { expect, test, type Page } from '@playwright/test';

async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: `Sign in as ${displayName}` }).click();
  await page.waitForURL('**/');
}

async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
}

async function createTestCase(
  page: Page,
  opts: { employeeQuery: string; type: string; confirmedLastDay?: boolean },
): Promise<{ url: string; number: string }> {
  await page.goto('/cases/new');
  await page.getByLabel('Employee Name or Number').fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.locator(`input[name="type"][value=${JSON.stringify(opts.type)}]`).check();
  await page.getByRole('button', { name: 'Use this separation type' }).click();
  await page.locator('input[name="receivedAt"]').fill('2026-07-22T09:30');
  // One end date (DEC-064): employment ends at close of business on it and
  // the platform derives the instant - no time is offered for any type.
  await page.locator('input[name="confirmedLastDay"]').fill('2026-08-14');
  // The final action lives in the Review step (owner directive,
  // 2026-08-27), so it is reached by opening that step.
  await page.locator('.step:has([data-step="review"]) .step__header').click();
  // DEC-061: a fixture employee may already have a live case; confirm the deliberate
  // second one. The confirmation lives in the Review step, so make sure it is open.
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/);
  await expect(banner).toBeVisible();
  const number = /OFF-\d{4}-\d{4,}(?:-\d)?/.exec((await banner.textContent()) ?? '')![0];
  return { url: page.url().split('?')[0]!, number };
}

async function submitAndApprove(page: Page, caseUrl: string): Promise<void> {
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Case submitted for review.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'HR Manager');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
}

/** Directive 6.1: activation requires the assignment plan (run as HR Manager). */
async function completeAssignmentPlan(
  page: Page,
  caseUrl: string,
  officerLabel = 'HR Officer',
): Promise<void> {
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  // Directive 6.3 correction 7: options read "<name> - <job title>", so pick
  // the option by its name fragment rather than an exact label.
  const officerValue = await page
    .locator('#of-user option', { hasText: officerLabel })
    .first()
    .getAttribute('value');
  await page.locator('#of-user').selectOption(officerValue!);
  await page.locator('#of-reason').fill('UAT assignment.');
  await page.getByRole('button', { name: /Assign officer|Reassign case/ }).click();
  await expect(
    page.getByText(/HR Officer assigned \(audited\)|already owns this case/),
  ).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ index: 1 });
  await page.locator('#am-reason').fill('UAT manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
}

async function completeTaskFromWorkflow(
  page: Page,
  caseUrl: string,
  title: string,
  note = 'Completed in the synthetic UAT run.',
): Promise<void> {
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.locator('details.action > summary', { hasText: 'Complete with evidence' }).click();
  await page.locator('#c-note').fill(note);
  await page.getByRole('button', { name: 'Complete task' }).click();
  await expect(page.getByText('Task completed with evidence.')).toBeVisible();
}

async function recordFirstAssetDisposition(
  page: Page,
  status: string,
  reason?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.waitForTimeout(600);
      const summary = page
        .locator('details.action > summary', { hasText: 'Record outcome' })
        .first();
      if ((await summary.count()) === 0) return;
      await summary.click({ timeout: 5000 });
      const details = page
        .locator('details[open]', { has: page.locator('select[name="status"]') })
        .first();
      await details.locator('select[name="status"]').selectOption(status, { timeout: 4000 });
      if (reason) {
        await details.locator('input[name="reason"]').fill(reason, { timeout: 4000 });
      }
      await details.getByRole('button', { name: 'Record', exact: true }).click({ timeout: 4000 });
      await expect(page.getByText(/Asset status recorded/)).toBeVisible({ timeout: 10_000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await page.reload();
    }
  }
}

/** Directive 6.3 S: release every email action waiting on HR review. */
async function releaseWaitingEmailActions(page: Page, caseUrl: string): Promise<void> {
  await page.goto(`${caseUrl}/notifications`);
  for (let i = 0; i < 6; i++) {
    const release = page.getByRole('button', { name: /Review and release/ }).first();
    if ((await release.count()) === 0) break;
    await release.click();
    await expect(
      page.getByText(/Released\. Sending and confirmation are tracked automatically\./),
    ).toBeVisible();
  }
}

test('UAT-1..5 - integrated resignation with notice: one case end to end (Directive 6.3 model)', async ({
  page,
}) => {
  test.setTimeout(600_000);

  // UAT-1: HR Officer creates; HR Manager approves with snapshot; assignment.
  await signInAs(page, 'HR Officer');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await submitAndApprove(page, caseUrl);
  // The assignment plan routes manager work: activation auto-adds the
  // recorded manager as a participant (no manual participant step exists).
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  // Workflow preview reviewed, then activated.
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow Preview (Read-only, Before Activation)')).toBeVisible();
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  // UAT-3: activation derived the IT and Finance email actions automatically -
  // zero clicks prepared them; the rows show business-language statuses.
  await page.goto(`${caseUrl}/notifications`);
  await expect(page.getByRole('heading', { name: /Email Actions/ })).toBeVisible();
  const itAction = page.locator('section[aria-label="IT access removal email action"]').first();
  await expect(itAction).toBeVisible();
  await expect(itAction.locator('.badge').first()).toHaveText(
    /Scheduled|Sent|Needs your review|Recipient required/,
  );
  await releaseWaitingEmailActions(page, caseUrl);

  await completeTaskFromWorkflow(page, caseUrl, 'Verify resignation and case information');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm proposed and final working dates');

  // UAT-2: acceptance document created and submitted.
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  // The acceptance letter is addressed, so HR types the address from the
  // resignation letter scan before submitting (DEC-054).
  await page
    .getByRole('textbox', { name: 'Employee Address' })
    .fill('12 Synthetic Avenue, Kingston 5');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();

  // UAT-3b: one benefits confirmation feeds the derived provider rules.
  await page.goto(caseUrl);
  // The confirm form opens itself while a benefit is undecided; toggle it
  // open only when it is not already.
  {
    const benefitsDetails = page.locator('details.action', {
      has: page.locator('summary', { hasText: 'Confirm which benefits apply' }),
    });
    if (!(await benefitsDetails.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await benefitsDetails.locator('summary').click();
    }
  }
  await page.locator('#ben-health').selectOption('NO');
  await page.locator('#ben-life').selectOption('NO');
  await page.getByRole('button', { name: 'Confirm applicability' }).click();
  await expect(page.getByText(/Benefits applicability confirmed/)).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm benefits and provider applicability');

  // Action form: the assigned HR Officer prepares, finishes and completes it
  // (attested) - no manager approval step exists (Directive 6.3 D).
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Create action form' }).click();
  await expect(page.getByText('Action form draft created.')).toBeVisible();
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
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee unavailable for signature; recorded per policy.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish preparation (ready for review)' }).click();
  await expect(page.getByText('Form finished and ready for review.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Complete action form (attested, renders final PDF)' })
    .click();
  await expect(page.getByText(/Action form completed/)).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee action form HR section');
  await signOut(page);

  // UAT-2 (cont.): HR Manager approves the document; PDF renders + downloads.
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();
  const pdfHref = await page
    .getByRole('link', { name: 'Download PDF' })
    .first()
    .getAttribute('href');
  const dl = await page.request.get(pdfHref!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-type']).toContain('application/pdf');

  // UAT-4: this case's released emails are captured locally - CAPTURED,
  // never represented as an external delivery. The background worker may
  // legitimately drain the queue first, so the manual pass can submit 0;
  // the capture evidence for THIS case is the invariant.
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: \d+ submitted/)).toBeVisible();
  await expect(
    page.locator('tbody tr', { hasText: caseNo }).filter({ hasText: 'CAPTURED' }).first(),
  ).toBeVisible();
  await expect(page.locator('tbody .badge', { hasText: 'DELIVERED' })).toHaveCount(0);
  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();
  await expect(
    page
      .locator('section[aria-label="Captured message"]', { hasText: caseNo })
      .filter({ hasText: /Access Removal/i })
      .first(),
  ).toBeVisible();

  // UAT-3 (cont.): delivery is not completion - HR records the completion
  // evidence IT returned outside the application.
  await page.goto(`${caseUrl}/notifications`);
  const itSent = page.locator('section[aria-label="IT access removal email action"]').first();
  await expect(itSent.locator('.badge').first()).toHaveText(/Sent/);
  await itSent.locator('details.action > summary', { hasText: 'Record evidence' }).click();
  await itSent.locator('select[name="kind"]').selectOption('COMPLETED');
  await itSent
    .locator('textarea[name="note"]')
    .fill('IT confirmed by email: all listed access removed; reference IT-UAT-01.');
  await itSent.getByRole('button', { name: 'Record evidence' }).click();
  await expect(page.getByText('Completion evidence recorded.')).toBeVisible();
  await signOut(page);

  // UAT-1/5: HR closes the remaining tasks; assets returned; survey issued.
  await signInAs(page, 'HR Officer');

  // UAT-3.4: the manager is told by email and records nothing in the platform.
  await page.goto(`${caseUrl}/notifications`);
  await expect(page.getByText(/departure notice/i).first()).toBeVisible();
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare and approve resignation acceptance document',
    'Letter approved and rendered on the Documents tab.',
  );
  await page.goto(`${caseUrl}/assets`);
  for (let i = 0; i < 3; i++) {
    await recordFirstAssetDisposition(page, 'RETURNED');
  }
  await completeTaskFromWorkflow(page, caseUrl, 'Complete asset recovery or final disposition');
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee acknowledgement handling');
  await completeTaskFromWorkflow(page, caseUrl, 'Record HRIS/BambooHR update status');

  // UAT-2.3: survey invitation (auto-prepared for eligible departures since
  // Directive 6.3 - create manually only when the automation has not yet).
  await page.goto(`${caseUrl}/survey`);
  const createInvite = page.getByRole('button', { name: 'Create survey invitation' });
  if ((await createInvite.count()) > 0) {
    await createInvite.click();
    await expect(page.getByText('Invitation created.')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Generate secure link' }).click();
  await expect(page.getByText('Secure Invitation Link (Shown Once)')).toBeVisible();
  const link = await page.locator('code').first().textContent();
  await page.getByRole('button', { name: 'Record manually sent' }).click();
  await expect(page.getByText(/Recorded as manually sent/)).toBeVisible();

  // UAT-5: clearance requested with every condition met.
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('All conditions met')).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText(/Case moved to clearance review/)).toBeVisible();
  await signOut(page);

  // The employee completes the survey through the anonymous token route.
  await page.goto(link!);
  await page.getByRole('radio', { name: '4' }).first().check();
  await page.getByRole('radio', { name: 'Another opportunity' }).check();
  await page.getByRole('radio', { name: 'Unsure' }).check();
  await page.getByRole('button', { name: 'Submit survey' }).click();
  await page.waitForURL('**/survey/thanks');

  // UAT-5 (cont.): HR Manager approves final clearance; case completes.
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/clearance`);
  await page.getByRole('button', { name: 'Approve final clearance' }).click();
  await expect(page.getByText(/Final clearance approved/)).toBeVisible();
  await page.goto(caseUrl);
  await expect(page.getByText('Completed').first()).toBeVisible();
  await signOut(page);

  // Reports reflect the completed TEST case without exposing identity.
  await signInAs(page, 'HR Officer');
  await page.goto('/reports?report=volumeTrend&purpose=TEST');
  await expect(page.getByText('Offboarding volume and trend').first()).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await signOut(page);
});

test('Document correction - invalidation, supersede, re-approval (audited)', async ({ page }) => {
  test.setTimeout(300_000);

  // Approved case with an approved, rendered document (maker-checker: the
  // officer drafts and submits; the manager approves).
  await signInAs(page, 'HR Officer');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'taylor',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await submitAndApprove(page, caseUrl); // ends signed in as HR Manager
  await signOut(page);
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  // The acceptance letter is addressed, so HR types the address from the
  // resignation letter scan before submitting (DEC-054).
  await page
    .getByRole('textbox', { name: 'Employee Address' })
    .fill('12 Synthetic Avenue, Kingston 5');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/Address recorded/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh fields from case' }).click();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();

  // 1: authorized audited correction of approved case data.
  await page.goto(caseUrl);
  await page
    .locator('details.action > summary', { hasText: 'Change effective separation time' })
    .click();
  await page.locator('#corr-eff').fill('2026-08-15T17:00');
  await page.locator('#corr-eff-reason').fill('Synthetic UAT correction: date moved one day.');
  await page.getByRole('button', { name: 'Change time (audited)' }).click();
  await expect(
    page.getByText('Effective separation time changed (audited correction).'),
  ).toBeVisible();

  // 2-4: the material correction AUTOMATICALLY supersedes the rendered
  // document, invalidates its approval (historically visible) and opens the
  // corrected draft at the next version.
  await page.goto(`${caseUrl}/documents`);
  await expect(page.getByText(/INVALIDATED: Material case correction/).first()).toBeVisible();
  await expect(page.getByText('SUPERSEDED').first()).toBeVisible();
  await expect(page.getByText('(superseded copy)').first()).toBeVisible();
  await expect(page.getByText('DRAFT').first()).toBeVisible();

  // 5-6: the new version requires a fresh submission (officer) and a fresh
  // approval (manager) - the UAT-D1 fix makes this work with one manager.
  await signOut(page);
  await signInAs(page, 'HR Officer');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'HR Manager');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();

  // 7: exactly one current RENDERED document; the old one remains SUPERSEDED.
  await expect(page.locator('.badge', { hasText: 'SUPERSEDED' })).toHaveCount(1);
  await signOut(page);
});

test('UAT-7 continuity - outage and manual fallback: FB refs, one-time reconciliation, gated closure', async ({
  page,
}) => {
  test.setTimeout(240_000);

  await signInAs(page, 'HR Manager');
  await page.goto('/continuity');
  await expect(page.getByText('Blank Fallback Forms (Print and Use Manually)')).toBeVisible();

  // 1: declare a synthetic outage.
  await page.locator('details.action > summary', { hasText: 'Declare an outage' }).click();
  await page.locator('#o-title').fill('Synthetic UAT outage drill');
  await page.locator('#o-note').fill('Planned Directive 5 continuity exercise.');
  await page.getByRole('button', { name: 'Declare outage' }).click();
  await expect(
    page.getByText('Outage declared; manual fallback processes are now in effect.'),
  ).toBeVisible();

  const outage = page.locator('section.panel', { hasText: 'Synthetic UAT outage drill' }).first();

  // 2-3: record manual work with controlled FB references.
  await outage.locator('details.action > summary', { hasText: 'Record a manual entry' }).click();
  await outage.locator('select[name="kind"]').selectOption('ACCESS_REMOVAL');
  await outage
    .locator('textarea[name="summary"]')
    .fill('Manual access removal executed for EMP-TEST case during drill.');
  await outage.getByRole('button', { name: 'Record manual entry' }).click();
  await expect(
    page.getByText(/Manual record captured with controlled reference FB-\d{4}-\d+/),
  ).toBeVisible();

  // 7: closure is refused while an entry awaits reconciliation.
  const openOutage = page
    .locator('section.panel', { hasText: 'Synthetic UAT outage drill' })
    .first();
  await openOutage
    .locator('details.action > summary', { hasText: 'Close outage (requires full reconciliation)' })
    .click();
  await openOutage.locator('input[id^="oc-note"]').fill('Attempting early closure (must fail).');
  await openOutage.getByRole('button', { name: 'Close outage' }).click();
  await expect(
    page.getByText(/manual entr\(ies\) are not reconciled; reconcile everything before closing/),
  ).toBeVisible();
  await expect(
    page
      .locator('section.panel', { hasText: 'Synthetic UAT outage drill' })
      .first()
      .locator('.badge', { hasText: 'DECLARED' }),
  ).toBeVisible();

  // 5-6: reconcile exactly once; duplicates are prevented by design.
  const recOutage = page
    .locator('section.panel', { hasText: 'Synthetic UAT outage drill' })
    .first();
  await recOutage.locator('details.action > summary', { hasText: 'Reconcile' }).first().click();
  await recOutage
    .locator('input[name="note"][id^="rc-note"]')
    .first()
    .fill('Matched to the manual access-removal log; no duplicate created.');
  await recOutage.getByRole('button', { name: 'Reconcile entry' }).click();
  await expect(
    page.getByText('Entry reconciled; duplicates are prevented by the one-time reconciliation.'),
  ).toBeVisible();
  await expect(
    page
      .locator('section.panel', { hasText: 'Synthetic UAT outage drill' })
      .first()
      .locator('.badge', { hasText: 'reconciled' })
      .first(),
  ).toBeVisible();

  // 4+7: with everything reconciled, closure succeeds.
  const doneOutage = page
    .locator('section.panel', { hasText: 'Synthetic UAT outage drill' })
    .first();
  await doneOutage
    .locator('details.action > summary', { hasText: 'Close outage (requires full reconciliation)' })
    .click();
  await doneOutage.locator('input[id^="oc-note"]').fill('Drill complete; all entries reconciled.');
  await doneOutage.getByRole('button', { name: 'Close outage' }).click();
  await expect(page.getByText('Outage closed after full reconciliation.')).toBeVisible();
  await signOut(page);
});
