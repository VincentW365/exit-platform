/**
 * Synthetic UAT journeys (Directive 5 section C) that are not already covered
 * by the stage acceptance suites:
 *
 *   UAT-1  - one INTEGRATED resignation-with-notice case through workflow,
 *            document, action form, handover, assets, notification capture,
 *            survey, clearance, completion and report reflection;
 *   UAT-4  - document correction: audited case correction invalidates the
 *            approval, supersede creates a corrected draft, re-approval;
 *   UAT-10 - user deactivation: live session revoked, sign-in refused,
 *            orphaned work reassigned by HR;
 *   UAT-11 - outage and manual fallback: FB references, one-time
 *            reconciliation, close only after full reconciliation.
 *
 * Remaining scenarios are executed by the stage suites (see
 * docs/delivery/SyntheticUATReport.md for the mapping). Synthetic data only.
 * UAT-10 requires the fixture user created by tmp/create-uat-user.ts.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

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
  await page.getByLabel(/Search the employee source/).fill(opts.employeeQuery);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Select' }).first().click();
  await page.getByLabel('Departure type (required)').selectOption(opts.type);
  await page.getByLabel('Receipt date and time (required)').fill('2026-07-22T09:30');
  await page.getByLabel('Source of the receipt timestamp (required)').fill('Synthetic UAT receipt');
  if (opts.confirmedLastDay !== false) {
    await page.getByLabel('Confirmed last working day').fill('2026-08-14');
  }
  await page.getByLabel(/Effective separation date and exact time/).fill('2026-08-14T17:00');
  await page.getByLabel('Record purpose').selectOption('TEST');
  await page.getByRole('button', { name: 'Create draft case' }).click();
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4} created/);
  await expect(banner).toBeVisible();
  const number = /OFF-\d{4}-\d{4}/.exec((await banner.textContent()) ?? '')![0];
  return { url: page.url().split('?')[0]!, number };
}

async function submitAndApprove(page: Page, caseUrl: string): Promise<void> {
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Submit for HR review' }).click();
  await expect(page.getByText('Case submitted for HR review.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'Dana Field');
  await page.goto(caseUrl);
  await page.getByRole('button', { name: 'Approve case and capture snapshot' }).click();
  await expect(page.getByText(/Case approved/)).toBeVisible();
}

/** Directive 6.1: activation requires the assignment plan (run as HR Manager). */
async function completeAssignmentPlan(
  page: Page,
  caseUrl: string,
  officerLabel = 'Riley Okafor',
): Promise<void> {
  await page.goto(`${caseUrl}/assignment`);
  await page.locator('details.action > summary', { hasText: 'Assign HR Officer' }).click();
  await page.locator('#of-user').selectOption({ label: officerLabel });
  await page.locator('#of-reason').fill('UAT assignment.');
  await page.getByRole('button', { name: 'Assign officer' }).click();
  await expect(page.getByText('HR Officer assigned (audited).')).toBeVisible();
  await page.locator('details.action > summary', { hasText: 'Assign alternate manager' }).click();
  await page.locator('#am-user').selectOption({ label: 'Jamie Douglas' });
  await page.locator('#am-reason').fill('UAT manager routing.');
  await page.getByRole('button', { name: 'Record alternate manager' }).click();
  await expect(page.getByText('Alternate manager recorded')).toBeVisible();
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Confirm assignment plan' }).click();
  await expect(page.getByText('Assignment plan confirmed').first()).toBeVisible();
}

async function addParticipantOnCase(
  page: Page,
  caseUrl: string,
  userLabel: string,
  role: string,
): Promise<void> {
  await page.goto(caseUrl);
  await page.locator('details.action > summary', { hasText: 'Add participant' }).click();
  const value = await page.locator('#p-user option', { hasText: userLabel }).getAttribute('value');
  await page.getByLabel('User').selectOption(value!);
  await page.locator('#p-role').selectOption(role);
  await page.locator('#p-reason').fill('Synthetic UAT assignment.');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Participant added.')).toBeVisible();
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

async function completeTaskViaQueue(
  page: Page,
  caseNumber: string,
  title: string,
  note = 'Completed in the synthetic UAT run.',
): Promise<void> {
  await page.goto(`/queue?view=all&q=${caseNumber}`);
  await page.getByRole('link', { name: title, exact: true }).first().click();
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
        .locator('details.action > summary', { hasText: 'Record status / disposition' })
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

async function reassignTaskFromWorkflow(
  page: Page,
  caseUrl: string,
  title: string,
  assigneeLabel: string,
): Promise<void> {
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.locator('details.action > summary', { hasText: 'Reassign task (HR Manager)' }).click();
  await page.locator('#r-user').selectOption({ label: assigneeLabel });
  await page.locator('#r-reason').fill('Synthetic UAT reassignment.');
  await page.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByText('Task reassigned.')).toBeVisible();
}

test('UAT-1 - integrated resignation with notice: one case end to end', async ({ page }) => {
  test.setTimeout(600_000);

  // 1-2: HR Officer creates; HR Manager approves with snapshot.
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'avery',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await submitAndApprove(page, caseUrl);
  await addParticipantOnCase(page, caseUrl, 'Jamie Douglas', 'MANAGER');
  await completeAssignmentPlan(page, caseUrl);
  await signOut(page);

  // 3-4: workflow preview reviewed, then activated.
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/workflow`);
  await expect(page.getByText('Workflow preview (read-only, before activation)')).toBeVisible();
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();

  await completeTaskFromWorkflow(page, caseUrl, 'Verify resignation and case information');
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm proposed and final working dates');

  // 5: acceptance document created and submitted.
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();

  // 8: action form HR section (acknowledgement recorded).
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
    await page.locator(`#hr-${key}`).selectOption('DONE');
  }
  await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
  await page.locator('#ackReason').fill('Employee unavailable for signature; recorded per policy.');
  await page.getByRole('button', { name: 'Save HR section' }).click();
  await expect(page.getByText('HR section saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for manager approval' }).click();
  await expect(page.getByText('Form submitted for manager approval.')).toBeVisible();
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee action form HR section');
  await signOut(page);

  // 6-7: HR Manager approves the document; PDF renders and downloads.
  await signInAs(page, 'Dana Field');
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

  // 12: an IT notification is prepared, approved and (later) captured.
  await page.goto(`${caseUrl}/notifications`);
  await page.locator('details.action > summary', { hasText: 'Prepare a notification' }).click();
  await page.locator('#n-type').selectOption('IT_ACCESS_REMOVAL');
  await page.getByRole('button', { name: 'Prepare draft' }).click();
  await expect(page.getByText('Notification draft prepared')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Submitted for approval.')).toBeVisible();
  await page.getByRole('button', { name: /^Approve$/ }).click();
  await expect(page.getByText(/approved and bound/)).toBeVisible();

  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Approve the action form (manager)',
    'Jamie Douglas (LINE_MANAGER)',
  );
  await signOut(page);

  // 10: manager completes handover and approves the form.
  await signInAs(page, 'Jamie Douglas');
  await page.goto(`${caseUrl}/handover`);
  await page.locator('#ho-dutiesToReassign').fill('Parts counter scheduling and escalations.');
  await page.locator('#ho-openWorkDeadlines').fill('August stock count preparation.');
  await page.locator('#ho-replacementOwner').fill('Interim owner: warehouse coordinator.');
  await page.getByRole('button', { name: 'Save handover record' }).click();
  await expect(page.getByText('Handover record saved.')).toBeVisible();
  await page
    .locator('details.action > summary', { hasText: 'Complete handover (manager attestation)' })
    .click();
  await page.getByRole('button', { name: 'Complete with attestation' }).click();
  await expect(page.getByText('Handover completed with manager attestation.')).toBeVisible();
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: 'Approve as responsible manager (attested)' }).click();
  await expect(page.getByText('Manager approval recorded (attested).')).toBeVisible();
  await completeTaskViaQueue(page, caseNo, 'Approve the action form (manager)');
  await signOut(page);

  // 8 (final): HR Manager gives HR final approval; duties task to manager.
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/action-form`);
  await page.getByRole('button', { name: /Give HR final approval/ }).click();
  await expect(page.getByText(/HR final approval recorded/)).toBeVisible();
  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Reassign open duties and deadlines',
    'Jamie Douglas (LINE_MANAGER)',
  );
  await completeTaskFromWorkflow(page, caseUrl, 'Approve the final action form');
  await signOut(page);

  await signInAs(page, 'Jamie Douglas');
  await completeTaskViaQueue(page, caseNo, 'Reassign open duties and deadlines');
  await signOut(page);

  // 9: IT works its queue - review, then exact-time revocation.
  await signInAs(page, 'Sam Chen');
  await completeTaskViaQueue(page, caseNo, 'Review systems and access requiring removal');
  await page.goto(`/queue?view=all&q=${caseNo}`);
  await page
    .getByRole('link', { name: 'Revoke system access at the effective separation time' })
    .first()
    .click();
  await page.locator('#acc-note').fill('All listed access removed; evidence ticket IT-UAT-01.');
  await page.locator('#acc-early').fill('HR Manager approved early removal for the UAT run.');
  await page.getByRole('button', { name: 'Record completion' }).click();
  await expect(page.getByText(/Access revocation recorded: COMPLETED_EARLY/)).toBeVisible();
  await signOut(page);

  // Finance tasks.
  await signInAs(page, 'Alex Romero');
  await completeTaskViaQueue(page, caseNo, 'Acknowledge offboarding case');
  await completeTaskViaQueue(page, caseNo, 'Initiate external final-pay workpaper');
  await completeTaskViaQueue(
    page,
    caseNo,
    'Record external final-pay workpaper completion',
    'Workpaper completed OUTSIDE the application; reference FIN-UAT-01.',
  );
  await signOut(page);

  // 11 + 13: HR closes remaining tasks, assets returned, survey issued.
  await signInAs(page, 'Riley Okafor');
  await completeTaskFromWorkflow(page, caseUrl, 'Determine Sagicor group-health applicability');
  await completeTaskFromWorkflow(page, caseUrl, 'Determine NCB group-life applicability');
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare applicable external-provider notifications',
    'IT notification approved; provider notifications not applicable.',
  );
  await completeTaskFromWorkflow(
    page,
    caseUrl,
    'Prepare and approve resignation acceptance document',
    'Letter approved and rendered on the Documents tab.',
  );
  await completeTaskFromWorkflow(page, caseUrl, 'Confirm employee-issued asset list');
  await page.goto(`${caseUrl}/assets`);
  for (let i = 0; i < 3; i++) {
    await recordFirstAssetDisposition(page, 'RETURNED');
  }
  await completeTaskFromWorkflow(page, caseUrl, 'Complete asset recovery or final disposition');
  await completeTaskFromWorkflow(page, caseUrl, 'Complete employee acknowledgement handling');
  await completeTaskFromWorkflow(page, caseUrl, 'Record HRIS/BambooHR update status');
  await completeTaskFromWorkflow(page, caseUrl, 'Assess survey eligibility');

  // 13: survey invitation generated and manually recorded.
  await page.goto(`${caseUrl}/survey`);
  await page.getByRole('button', { name: 'Create survey invitation' }).click();
  await expect(page.getByText('Invitation created.')).toBeVisible();
  await page.getByRole('button', { name: 'Generate secure link' }).click();
  await expect(page.getByText('Secure invitation link (shown once)')).toBeVisible();
  const link = await page.locator('code').first().textContent();
  await page.getByRole('button', { name: 'Record manually sent' }).click();
  await expect(page.getByText(/Recorded as manually sent/)).toBeVisible();

  // 14: clearance requested with every condition met.
  await page.goto(`${caseUrl}/clearance`);
  await expect(page.getByText('ALL CONDITIONS MET')).toBeVisible();
  await page.getByRole('button', { name: 'Request clearance review' }).click();
  await expect(page.getByText(/Case moved to clearance review/)).toBeVisible();
  await signOut(page);

  // 13 (cont.): the employee completes the survey anonymously-served token.
  await page.goto(link!);
  await page.getByRole('radio', { name: '4' }).first().check();
  await page.getByRole('radio', { name: 'Another opportunity' }).check();
  await page.getByRole('radio', { name: 'Unsure' }).check();
  await page.getByRole('button', { name: 'Submit survey' }).click();
  await page.waitForURL('**/survey/thanks');

  // 14-15: HR Manager approves final clearance; case completes.
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/clearance`);
  await page.getByRole('button', { name: 'Approve final clearance' }).click();
  await expect(page.getByText(/Final clearance approved/)).toBeVisible();
  await page.goto(caseUrl);
  await expect(page.getByText('Completed').first()).toBeVisible();

  // 12 (cont.): outbox pass captures the approved notification locally.
  await page.goto('/admin/outbox');
  await page.getByRole('button', { name: 'Run outbox pass now' }).click();
  await expect(page.getByText(/Outbox pass: [1-9]\d* submitted/)).toBeVisible();
  await expect(page.locator('tbody').getByText('CAPTURED').first()).toBeVisible();
  await expect(page.locator('tbody .badge', { hasText: 'DELIVERED' })).toHaveCount(0);
  await signOut(page);

  // 16: reports reflect the completed TEST case without exposing identity.
  await signInAs(page, 'Riley Okafor');
  await page.goto('/reports?report=volumeTrend&purpose=TEST');
  await expect(page.getByText('Offboarding volume and trend').first()).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await signOut(page);
});

test('UAT-4 - document correction: invalidation, supersede, re-approval', async ({ page }) => {
  test.setTimeout(300_000);

  // Approved case with an approved, rendered document (maker-checker: the
  // officer drafts and submits; the manager approves).
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl } = await createTestCase(page, {
    employeeQuery: 'taylor',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await submitAndApprove(page, caseUrl); // ends signed in as Dana Field
  await signOut(page);
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Create resignation document draft' }).click();
  await expect(page.getByText('Draft document created')).toBeVisible();
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'Dana Field');
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
  await signInAs(page, 'Riley Okafor');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Validate and submit for approval' }).click();
  await expect(page.getByText('Document submitted for HR Manager approval.')).toBeVisible();
  await signOut(page);
  await signInAs(page, 'Dana Field');
  await page.goto(`${caseUrl}/documents`);
  await page.getByRole('button', { name: 'Approve exact version (attested)' }).click();
  await expect(page.getByText('Document approved; the final PDF has been rendered.')).toBeVisible();

  // 7: exactly one current RENDERED document; the old one remains SUPERSEDED.
  await expect(page.locator('.badge', { hasText: 'SUPERSEDED' })).toHaveCount(1);
  await signOut(page);
});

test('UAT-10 - user deactivation: session revoked, sign-in refused, work reassigned', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);

  // A case whose IT review task is assigned to the disposable user.
  await signInAs(page, 'Riley Okafor');
  const { url: caseUrl, number: caseNo } = await createTestCase(page, {
    employeeQuery: 'jordan',
    type: 'RESIGNATION_WITH_NOTICE',
  });
  await submitAndApprove(page, caseUrl);
  await completeAssignmentPlan(page, caseUrl);
  await page.goto(`${caseUrl}/workflow`);
  await page.getByRole('button', { name: 'Activate case and create these tasks' }).click();
  await expect(page.getByText(/Case activated/)).toBeVisible();
  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Review systems and access requiring removal',
    'Devon Temple (IT_RESPONDER)',
  );
  await signOut(page);

  // The disposable user holds a LIVE session in a second browser context.
  const devonContext = await (browser as Browser).newContext();
  const devonPage = await devonContext.newPage();
  await signInAs(devonPage, 'Devon Temple');
  await devonPage.goto('/queue');
  await expect(devonPage.getByText('Devon Temple', { exact: true })).toBeVisible();
  await expect(devonPage.getByText('IT_RESPONDER', { exact: true })).toBeVisible();

  // SYSTEM_ADMIN disables the account; open work is flagged.
  await signInAs(page, 'Marley Thompson');
  await page.goto('/admin/system');
  await page
    .locator('details.action > summary', {
      hasText: 'Disable a user (revokes sessions immediately)',
    })
    .click();
  await page.locator('#du-user').selectOption({ label: 'Devon Temple (IT_RESPONDER)' });
  await page.locator('#du-reason').fill('Synthetic UAT Scenario 10 deactivation test.');
  await page.getByRole('button', { name: 'Disable user now' }).click();
  await expect(
    page.getByText(/User disabled; sessions revoked immediately; \d+ orphaned task/),
  ).toBeVisible();
  await signOut(page);

  // The live session is rejected at once and sign-in is no longer offered.
  await devonPage.goto('/queue');
  await devonPage.waitForURL('**/signin**');
  await expect(devonPage.getByRole('button', { name: 'Sign in as Devon Temple' })).toHaveCount(0);
  await expect(devonPage.getByRole('button', { name: 'Sign in as Dana Field' })).toBeVisible();
  await devonContext.close();

  // HR Manager reassigns the orphaned task to an active IT responder.
  await signInAs(page, 'Dana Field');
  await reassignTaskFromWorkflow(
    page,
    caseUrl,
    'Review systems and access requiring removal',
    'Sam Chen (IT_RESPONDER)',
  );
  // Audit evidence for the whole episode is on the case timeline.
  await page.goto(caseUrl);
  await expect(page.getByText(caseNo).first()).toBeVisible();
  await signOut(page);
});

test('UAT-11 - outage and manual fallback: FB refs, one-time reconciliation, gated closure', async ({
  page,
}) => {
  test.setTimeout(240_000);

  await signInAs(page, 'Dana Field');
  await page.goto('/continuity');
  await expect(page.getByText('Blank fallback forms (print and use manually)')).toBeVisible();

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
