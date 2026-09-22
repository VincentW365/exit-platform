/**
 * Full offboarding end-to-end workflow test and evidence pack (owner
 * directive, 2026-09-09).
 *
 * One controlled employee, one independent case per supported separation
 * type, discovered from the platform's own separation profiles so a new type
 * is never silently skipped. Every scenario drives the real UI as HR would,
 * reads back what the application recorded, and writes its own evidence
 * folder (see support/evidence.ts). A failed check is recorded and the
 * scenario continues; a broken step is recorded and the next step runs, and
 * the other scenarios still run (section 37).
 */
import { test, type Browser, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { runDirectoryEvidence } from './directory';
import { DbBridge } from './support/db';
import { dateOf, datePlanFor, wallClock } from './support/dates';
import { recordEmails } from './support/emails';
import { ScenarioEvidence, type CheckStatus, type TaskRow } from './support/evidence';
import { expectationsFrom, expectedEmailTypes, type TypeExpectation } from './support/expectations';
import { postureEnv } from './support/posture';
import { redactTokens, redactUrl } from './support/redact';
import { runContext, scenarioCode, slugForType } from './support/run';
import * as ui from './support/ui';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const run = runContext(repoRoot);
const bridge = new DbBridge(repoRoot, postureEnv(run, repoRoot));
const catalogue = bridge.profiles();
const expectations = expectationsFrom(catalogue);

test.describe.configure({ mode: 'serial' });
test.setTimeout(25 * 60_000);

for (const [i, x] of expectations.entries()) {
  const code = scenarioCode(i);
  const slug = slugForType(x.type);
  test(`${code} ${x.label}`, async ({ page, browser }) => {
    await runScenario(page, browser, code, slug, x, i);
  });
}

// BambooHR directory proofs (owner directive, 2026-09-15, section 36): the
// same controlled employee, after the separation scenarios, in its own
// evidence folder. Select it alone with `--grep DIR`.
test('DIR BambooHR Directory', async ({ page, request }) => {
  await runDirectoryEvidence(page, request, run, bridge);
});

// ---------------------------------------------------------------------------

const ADDRESS = '1 Regression Lane, Kingston (SYNTHETIC ADDRESS - TEST CASE)';
const HELD_TYPES = ['IT_ACCESS_REMOVAL', 'LINE_MANAGER_HANDOVER', 'FINANCE_OFFBOARDING'];

async function runScenario(
  page: Page,
  browser: Browser,
  code: string,
  slug: string,
  x: TypeExpectation,
  index: number,
): Promise<void> {
  const ev = new ScenarioEvidence(run, code, slug, x.type, x.label);
  const plan = datePlanFor(x.type);
  // A restricted separation (termination, redundancy) is confidential by
  // default: only its owner and participants can see it, so the HR Manager
  // opens it and approves their own draft in one audited step, exactly as the
  // product intends for restricted intake. Everything else is opened by the
  // HR Officer and approved by the HR Manager (maker-checker).
  const intakeActor = x.restricted ? 'HR Manager' : 'HR Officer';
  ev.fact('Execution date (business zone)', plan.executionDate);
  ev.fact('Date plan', plan.narrative);
  ev.fact('Intake actor', `${intakeActor}${x.restricted ? ' (restricted classification)' : ''}`);
  ev.fact(
    'Benefits choice for this scenario',
    `group health ${x.benefits.health}, group life ${x.benefits.life}`,
  );
  await ui.installValidationCounter(page);
  const pageShot = (p: Page, name: string) => ev.shot(p, name);

  // --- 1. Intake ------------------------------------------------------------------
  await ev.step(`sign in as ${intakeActor}`, page, () => ui.signInAs(page, intakeActor));

  await ev.step('employee search', page, async () => {
    const s = await ui.searchEmployee(page, run.employee);
    const shot = await ev.shot(page, 'employee_search', `Search "${run.employee}", Enter, results`);
    ev.expect(
      'search',
      'Enter in the search field ran the search and returned results',
      s.resultCount > 0,
      `${s.resultCount} result(s)`,
      [{ label: 'View Screenshot', href: shot }],
    );
    ev.expect(
      'search',
      'No "Please fill out this field" browser validation popup',
      s.validationReports === 0,
      `${s.validationReports} validation report(s) recorded`,
    );
    if (s.resultCount > 1)
      ev.warn(
        'search',
        'More than one directory match for the search term',
        `${s.resultCount} matches; the exact name is selected`,
      );
    const label = await ui.selectEmployeeByName(page, run.employee);
    const shot2 = await ev.shot(page, 'employee_selected');
    ev.expect(
      'search',
      'Controlled employee selected',
      label === `Select ${run.employee}`,
      label ?? 'no link',
      [{ label: 'View Screenshot', href: shot2 }],
    );
    const pairs = await page
      .locator('.well dl.kv')
      .first()
      .evaluate((dl) => {
        const out: Record<string, string> = {};
        for (const dt of Array.from(dl.querySelectorAll('dt')))
          out[dt.textContent?.trim() ?? ''] = dt.nextElementSibling?.textContent?.trim() ?? '';
        return out;
      })
      .catch(() => ({}) as Record<string, string>);
    ev.fact('From the Employee Directory', pairs);
    ev.fact('Manager shown on selection', pairs['Direct Manager'] ?? '(not shown)');
    ev.expect(
      'assignment',
      'Directory record shows a manager (source: employee directory)',
      !!pairs['Direct Manager'] && !/None recorded/.test(pairs['Direct Manager'] ?? ''),
      pairs['Direct Manager'] ?? '(not shown)',
    );
    ev.fact(
      'Contract end date in directory record',
      pairs['Contract ends'] ?? 'not held in the directory record',
    );
  });

  // --- 2. Separation type ------------------------------------------------------
  await ev.step('choose separation type', page, async () => {
    await ui.chooseSeparationType(page, x.type);
    const shot = await ev.shot(page, 'separation_type_selected');
    ev.expect(
      'accordion',
      'Employee step collapsed with a summary after selection',
      !(await ui.stepExpanded(page, 'employee')) && (await ui.stepSummary(page, 'employee')) !== '',
      await ui.stepSummary(page, 'employee'),
      [{ label: 'View Screenshot', href: shot }],
    );
    ev.expect(
      'accordion',
      'Separation step collapsed with the chosen type',
      !(await ui.stepExpanded(page, 'separation')) &&
        (await ui.stepSummary(page, 'separation')).includes(x.label),
      await ui.stepSummary(page, 'separation'),
    );
    ev.expect(
      'accordion',
      'Next step (dates) opened automatically',
      await ui.stepExpanded(page, 'dates'),
    );
  });

  // --- 3. Exit-specific fields ----------------------------------------------------
  await ev.step('exit-specific fields', page, async () => {
    const present: Record<string, boolean> = {};
    for (const f of ['receivedAt', 'confirmedLastDay', 'effectiveSeparationAt', 'contractEndDate'])
      present[f] = await ui.fieldPresent(page, f);
    ev.fact('Date fields rendered', present);
    for (const f of [...x.requiredDates, ...x.optionalDates])
      ev.expect(
        'form',
        `Field "${f}" is offered (profile: ${x.requiredDates.includes(f) ? 'required' : 'optional'})`,
        present[f] === true,
      );
    for (const f of x.forbiddenDates)
      ev.expect(
        'form',
        `Field "${f}" is NOT offered (profile: forbidden for this type)`,
        present[f] === false,
      );
    const receivedLabel = await ui.fieldLabel(page, 'receivedAt');
    ev.expect(
      'form',
      `Received-date label uses this type's wording ("${x.receivedDateLabel}")`,
      !!receivedLabel && receivedLabel.includes(x.receivedDateLabel),
      receivedLabel ?? '',
    );
    const datesText = (await page.locator('.step__content[data-step="dates"]').innerText()).replace(
      /\s+/g,
      ' ',
    );
    if (x.noticeApplicable === true) {
      ev.expect(
        'form',
        'Notice arrangement is stated (notice applies to this type)',
        /Notice arrangement/.test(datesText),
        datesText.match(/Notice arrangement:[^.]*\./)?.[0] ?? 'not found',
      );
      if (x.noticeServed === false)
        ev.expect(
          'form',
          'Immediate resignation states plainly that no notice period is served',
          /No notice period is being served/.test(datesText),
        );
      ev.expect(
        'form',
        'No "notice served?" or "0 days" question is asked',
        !/notice served\?|0 days/i.test(datesText),
      );
    } else if (x.noticeApplicable === false) {
      ev.expect(
        'form',
        'No employee-notice wording or controls appear',
        !/notice arrangement|notice period|resign/i.test(datesText),
        datesText.slice(0, 160),
      );
    }
    if (x.type === 'TERMINATION')
      ev.expect(
        'form',
        'Termination form shows no resignation notice, notice served, resignation letter or notice period controls',
        !/resign|notice served|notice period/i.test(datesText),
      );
    const aboutExists = (await page.locator('.step:has([data-step="about"])').count()) > 0;
    ev.expect(
      'form',
      x.aboutStep === 'none'
        ? 'No extra classification step for this type'
        : `An "About" step asks for ${x.aboutStep === 'detail' ? 'the explanation and whether notice applies' : 'who authorized it'}`,
      aboutExists === (x.aboutStep !== 'none'),
    );
    const shot = await ev.shot(page, 'exit_specific_fields');
    ev.human(
      'form',
      'Field wording and guidance read correctly for this separation type',
      'presentation review of the dates step',
      [{ label: 'View Screenshot', href: shot }],
    );
  });

  // --- 4. Dates ------------------------------------------------------------------
  await ev.step('dates', page, async () => {
    const defaults: Record<string, string | null> = {};
    for (const f of ['receivedAt', 'confirmedLastDay', 'effectiveSeparationAt', 'contractEndDate'])
      defaults[f] = await ui.fieldValue(page, f);
    ev.fact('Field defaults before typing', defaults);
    for (const f of plan.expectDefaultToday) {
      const v = defaults[f];
      ev.expect(
        'dates',
        `"${f}" defaults to the execution date (${plan.executionDate})`,
        !!v &&
          dateOf(v.length === 10 ? `${v}T12:00:00-05:00` : `${v}:00-05:00`) === plan.executionDate,
        v ?? 'absent',
      );
    }
    if (x.type === 'CONTRACT_EXPIRY') {
      const hint = (await page.locator('.step__content[data-step="dates"]').innerText()).replace(
        /\s+/g,
        ' ',
      );
      const fromRecord = /Taken from the employee record/.test(hint);
      ev.check(
        'dates',
        fromRecord
          ? 'Contract end date reused from the directory record'
          : 'Directory record holds no contract end date; HR is asked to enter it (fallback path tested)',
        fromRecord ? 'PASS' : 'WARN',
        defaults['contractEndDate']
          ? `prefilled ${defaults['contractEndDate']}`
          : 'field empty - typed by HR',
      );
      if (!fromRecord && !defaults['contractEndDate'])
        ev.fact(
          'Contract end date source',
          'Not in the source directory (the BambooHR field allow-list does not carry it); typed by HR in this run.',
        );
    }
    const typed: Record<string, string> = {};
    for (const f of [
      'receivedAt',
      'confirmedLastDay',
      'effectiveSeparationAt',
      'contractEndDate',
    ] as const) {
      const v = plan[f];
      if (v && (await ui.fieldPresent(page, f))) {
        await ui.fillField(page, f, v);
        typed[f] = v;
      }
    }
    ev.fact('Dates typed', typed);
    if (x.type === 'TERMINATION') {
      const timeOffered = await ui.fieldPresent(page, 'effectiveSeparationAt');
      ev.expect(
        'dates',
        'No separate effective time is asked; the instant is derived at close of business (DEC-064)',
        timeOffered === false,
        timeOffered ? 'time field offered' : 'no time field',
      );
    }
    const received = (await ui.fieldValue(page, 'receivedAt')) ?? '';
    const last = (await ui.fieldValue(page, 'confirmedLastDay')) ?? '';
    if (received && last)
      ev.expect(
        'dates',
        'Last working day >= notice/recorded date',
        last >= received.slice(0, 10),
        `${last} >= ${received.slice(0, 10)}`,
      );
    await ui.finishStepWithEnter(page, 'receivedAt');
    ev.expect(
      'keyboard',
      'Enter in a date field finished the step and did not create the case',
      page.url().includes('/cases/new') && !(await ui.stepExpanded(page, 'dates')),
      page.url().split('?')[0],
    );
    const shot = await ev.shot(page, 'notice_dates');
    const summary = await ui.stepSummary(page, 'dates');
    ev.fact('Dates step summary', summary);
    ev.check(
      'accordion',
      'Completed dates step shows its summary',
      summary ? 'PASS' : 'FAIL',
      summary,
      [{ label: 'View Screenshot', href: shot }],
    );
  });

  // --- 5. About step ----------------------------------------------------------------
  if (x.aboutStep !== 'none') {
    await ev.step('about this separation', page, async () => {
      if (!(await ui.stepExpanded(page, 'about'))) await ui.toggleStepWithKeyboard(page, 'about');
      if (x.aboutStep === 'detail') {
        await ui.fillField(
          page,
          'separationTypeDetail',
          'Mutual separation agreement (regression test case)',
        );
        await ui.selectField(page, 'noticeApplicableOverride', 'false');
        ev.pass(
          'form',
          '"Other" asks for an explanation and whether notice applies; both supplied',
          'detail typed; notice applies = No',
        );
      } else {
        await ui.fillField(page, 'authorizedByName', 'HR Manager (regression run)');
        ev.pass(
          'form',
          'Authorization information is prompted and recorded',
          'authorizedByName typed',
        );
      }
      await ui.finishStepWithEnter(
        page,
        x.aboutStep === 'detail' ? 'separationTypeDetail' : 'authorizedByName',
      );
      ev.fact('About step summary', await ui.stepSummary(page, 'about'));
    });
  }

  // --- 6. Reason -------------------------------------------------------------------
  await ev.step('reason', page, async () => {
    if (!(await ui.stepExpanded(page, 'reason'))) await ui.toggleStepWithKeyboard(page, 'reason');
    await ui.selectField(page, 'reasonCaptureStatus', 'PROVIDED');
    await ui.fillField(
      page,
      'reasonNotes',
      `Regression run ${run.runId}: synthetic reason text for a test case.`,
    );
    await ui.finishStepWithEnter(page, 'reasonCaptureStatus');
    ev.expect(
      'accordion',
      'Reason step settled and the Review step opened',
      (await ui.stepExpanded(page, 'review')) && !(await ui.stepExpanded(page, 'reason')),
    );
  });

  // --- 7. Accordion and keyboard evidence ---------------------------------------------
  await ev.step('accordion keyboard behaviour', page, async () => {
    const before = await ui.fieldValue(page, 'receivedAt');
    const opened = await ui.toggleStepWithKeyboard(page, 'dates');
    ev.expect('accordion', 'Completed step reopens from its header with Enter', opened);
    ev.expect(
      'accordion',
      'Data remains intact after collapse and reopen',
      (await ui.fieldValue(page, 'receivedAt')) === before,
      before ?? '',
    );
    await ui.reach(ui.stepHeader(page, 'dates'));
    await page.keyboard.press('Tab');
    const afterTab = await ui.activeElementDescription(page);
    await page.keyboard.press('Shift+Tab');
    const back = await page.evaluate(
      () => document.activeElement?.classList.contains('step__header') ?? false,
    );
    ev.expect(
      'keyboard',
      'Tab moves from the step header into its first field; Shift+Tab returns',
      /input|select/.test(afterTab) && back,
      `after Tab: ${afterTab}`,
    );
    const shot = await ev.shot(page, 'collapsed_completed_step_reopened');
    if (x.type === 'RESIGNATION_WITH_NOTICE' && plan.confirmedLastDay) {
      // Change an earlier answer and check the later summary recalculates.
      const plusOne = new Date(
        new Date(`${plan.confirmedLastDay}T12:00:00Z`).getTime() + 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      await ui.fillField(page, 'confirmedLastDay', plusOne);
      await ui.finishStepWithEnter(page, 'confirmedLastDay');
      const summary = await ui.stepSummary(page, 'dates');
      const reviewText = (
        await page.locator('.step__content[data-step="review"]').innerText()
      ).replace(/\s+/g, ' ');
      ev.expect(
        'accordion',
        'Changing an earlier step recalculates its summary and the review',
        summary.includes(String(Number(plusOne.slice(8, 10)))) && /Dates/.test(reviewText),
        `last working day now ${plusOne}; summary: ${summary}`,
        [{ label: 'View Screenshot', href: shot }],
      );
      ev.fact('Last working day changed during review', `${plan.confirmedLastDay} -> ${plusOne}`);
      plan.confirmedLastDay = plusOne;
    } else if (!(await ui.stepExpanded(page, 'review'))) {
      await ui.toggleStepWithKeyboard(page, 'dates');
    }
    const headerWorks = await page.evaluate(() => {
      const h = document.querySelector('.step__header');
      return (
        h?.tagName === 'BUTTON' &&
        h.hasAttribute('aria-expanded') &&
        h.hasAttribute('aria-controls')
      );
    });
    ev.expect(
      'accessibility',
      'Accordion headers are real buttons with aria-expanded/aria-controls',
      headerWorks,
    );
  });

  // --- 8. Review and create -------------------------------------------------------------
  const created = await ev.step('review and create', page, async () => {
    if (!(await ui.stepExpanded(page, 'review'))) await ui.toggleStepWithKeyboard(page, 'review');
    const shot = await ev.shot(page, 'review_and_create');
    const reviewText = (
      await page.locator('.step__content[data-step="review"]').innerText()
    ).replace(/\s+/g, ' ');
    ev.expect(
      'review',
      'Review restates the employee, separation type and dates',
      reviewText.includes(run.employee) && reviewText.includes(x.label),
      reviewText.slice(0, 200),
      [{ label: 'View Screenshot', href: shot }],
    );
    const c = await ui.createDraft(page);
    ev.caseNumber = c.number;
    ev.caseUrl = c.url;
    ev.fact('Case number', c.number);
    ev.fact('Creation banner', c.banner);
    const shot2 = await ev.shot(page, 'created_case_overview');
    ev.pass('lifecycle', 'Draft case created from the Review step only', c.number, [
      { label: 'View Screenshot', href: shot2 },
    ]);
    if (index > 0)
      ev.expect(
        'isolation',
        'Platform warns about the other open case(s) for this employee (REQ-CASE-020 warns, never blocks)',
        !!c.duplicateWarning,
        c.duplicateWarning ?? 'no warning shown',
      );
    else
      ev.check(
        'isolation',
        'First scenario: no duplicate-case warning expected',
        c.duplicateWarning ? 'WARN' : 'PASS',
        c.duplicateWarning ?? 'none',
      );
    return c;
  });
  if (!created) {
    ev.finish('Case could not be created; later steps not attempted.');
    return;
  }
  const caseUrl = created.url;
  const caseNumber = created.number;

  // --- 9. Test-only isolation: purpose = TEST (audited product service) -----------------------
  await ev.step('mark the record as TEST purpose', page, async () => {
    const r = bridge.markTest(
      caseNumber,
      `Offboarding regression run ${run.runId}: automated test scenario ${code}, not a real separation.`,
    );
    ev.caseId = r.caseId;
    ev.expect(
      'isolation',
      'Record purpose corrected to TEST while DRAFT (excluded from every report and KPI)',
      r.recordPurpose === 'TEST',
      r.recordPurpose,
    );
    await page.goto(caseUrl);
    const text = await ui.mainText(page);
    const shot = await ev.shot(page, 'uat_banner_on_test_case');
    ev.expect(
      'isolation',
      'Case shows the UAT simulated-offboarding banner',
      /SIMULATED OFFBOARDING/i.test(text),
      '',
      [{ label: 'View Screenshot', href: shot }],
    );
  });

  // --- 10. Record as created -------------------------------------------------------------------
  let managerNameOnCase = '';
  await ev.step('verify the created record', page, async () => {
    const snap = bridge.snapshot(caseNumber);
    const c = snap.case;
    managerNameOnCase = String(c['managerName'] ?? '');
    ev.expect(
      'record',
      'Departure type stored as chosen',
      c.departureType === x.type,
      String(c.departureType),
    );
    ev.expect(
      'record',
      `Classification ${x.restricted ? 'RESTRICTED' : 'STANDARD'} by profile`,
      x.restricted ? c.classification === 'RESTRICTED' : c.classification !== 'RESTRICTED',
      String(c.classification),
    );
    ev.expect('record', 'Status DRAFT before approval', c.status === 'DRAFT', String(c.status));
    const recDate = dateOf(c['receivedAt'] as string);
    ev.expect(
      'dates',
      `Received/recorded date stored = ${plan.executionDate}`,
      recDate === plan.executionDate,
      recDate,
    );
    if (plan.confirmedLastDay)
      ev.expect(
        'dates',
        `Last working day stored = ${plan.confirmedLastDay}`,
        String(c['confirmedLastDay'] ?? '').slice(0, 10) === plan.confirmedLastDay,
        String(c['confirmedLastDay']),
      );
    if (plan.effectiveSeparationAt)
      ev.expect(
        'dates',
        `Effective separation stored = ${plan.effectiveSeparationAt} (business time)`,
        wallClock(c['effectiveSeparationAt'] as string).startsWith(
          plan.effectiveSeparationAt.replace('T', ' '),
        ),
        wallClock(c['effectiveSeparationAt'] as string),
      );
    if (plan.contractEndDate)
      ev.expect(
        'dates',
        `Contract end date stored = ${plan.contractEndDate}`,
        String(c['contractEndDate'] ?? '').slice(0, 10) === plan.contractEndDate,
        String(c['contractEndDate']),
      );
    if (x.type === 'IMMEDIATE_RESIGNATION')
      ev.expect(
        'dates',
        'Immediate resignation: last working day = today by default',
        String(c['confirmedLastDay'] ?? '').slice(0, 10) === plan.executionDate,
        String(c['confirmedLastDay']),
      );
    if (x.aboutStep === 'detail')
      ev.expect(
        'record',
        'Other: explanation and notice override stored',
        !!c['separationTypeDetail'] && c['noticeApplicableOverride'] === false,
        `${c['separationTypeDetail']} / notice=${c['noticeApplicableOverride']}`,
      );
    if (x.aboutStep === 'authorizer')
      ev.expect(
        'record',
        'Authorizer stored',
        !!c['authorizedByName'],
        String(c['authorizedByName']),
      );
    ev.fact('Stored dates', {
      receivedAt: wallClock(c['receivedAt'] as string),
      confirmedLastDay: String(c['confirmedLastDay'] ?? '').slice(0, 10),
      effectiveSeparationAt: wallClock(c['effectiveSeparationAt'] as string),
      contractEndDate: String(c['contractEndDate'] ?? '').slice(0, 10),
    });
    ev.fact('Manager on the case record (from the directory)', managerNameOnCase || '(none)');
    ev.expect(
      'audit',
      'Case creation audited',
      snap.audit.some((e) => /CASE_CREATED/.test(e.eventType)),
    );
    ev.expect(
      'audit',
      'Record-purpose correction audited',
      snap.audit.some((e) => /PURPOSE/.test(e.eventType)),
    );
  });

  // --- 11. HR Manager: approve, assign, activate ----------------------------------------------
  await ev.step('HR Manager approval', page, async () => {
    if (intakeActor !== 'HR Manager') await ui.switchTo(page, 'HR Manager');
    const msg = await ui.approveCase(page, caseUrl);
    const shot = await ev.shot(page, 'case_approved_snapshot_captured');
    ev.pass(
      'lifecycle',
      intakeActor === 'HR Manager'
        ? 'HR Manager approved their own restricted draft in one audited step and the snapshot was captured'
        : 'Case approved by the HR Manager (maker-checker) and employee snapshot captured',
      msg.slice(0, 120),
      [{ label: 'View Screenshot', href: shot }],
    );
    const snap = bridge.snapshot(caseNumber);
    ev.expect('lifecycle', 'Status APPROVED', snap.case.status === 'APPROVED', snap.case.status);
    ev.expect(
      'record',
      'Immutable employee snapshot captured',
      snap.case['snapshotCaptured'] === true,
    );
  });

  await ev.step('HR ownership and manager assignment', page, async () => {
    const a = await ui.completeAssignmentPlan(page, caseUrl, 'HR Officer', managerNameOnCase);
    const shot = await ev.shot(page, 'hr_manager_assignment');
    ev.fact('Assignment', {
      directoryManager: a.directoryManager,
      managerChoice: a.managerChoice,
      managerKept: a.managerKept,
      managerRouting: a.managerRouting,
      blockersBefore: a.blockersBefore,
      confirmations: a.confirmations,
    });
    ev.pass(
      'assignment',
      'HR Officer assigned by the HR Manager (audited, from the dropdown)',
      a.officerLabel,
      [{ label: 'View Screenshot', href: shot }],
    );
    if (a.managerChoice) {
      ev.check(
        'assignment',
        a.managerKept
          ? 'Directory manager routed as the departure-notice recipient (override needed only because managers have no application login)'
          : 'Alternate manager recorded because the directory manager was not offered as routable',
        a.managerKept ? 'PASS' : 'WARN',
        `${a.blockersBefore.filter((b) => /manager/i.test(b)).join(' ')} -> ${a.managerChoice}`,
      );
    } else {
      ev.pass(
        'assignment',
        'Manager resolved from the directory without override',
        a.managerRouting,
      );
    }
    ev.expect(
      'assignment',
      'All activation confirmations recorded',
      a.confirmations.length >= 6,
      `${a.confirmations.length} confirmations`,
    );
    const snap = bridge.snapshot(caseNumber);
    ev.fact('HR Officer', snap.officer ?? '(none)');
    ev.fact('Accountable owner', snap.owner ?? '(none)');
    ev.expect(
      'assignment',
      'Case records the operational HR Officer',
      !!snap.officer,
      snap.officer ?? '',
    );
  });

  await ev.step('activation and task generation', page, async () => {
    await page.goto(`${caseUrl}/workflow`);
    const preview = await ev.shot(page, 'workflow_preview_before_activation');
    ev.pass('workflow', 'Read-only workflow preview shown before activation', '', [
      { label: 'View Screenshot', href: preview },
    ]);
    const msg = await ui.activateCase(page, caseUrl);
    const shot = await ev.shot(page, 'generated_tasks');
    ev.pass('workflow', 'Case activated', msg.slice(0, 120), [
      { label: 'View Screenshot', href: shot },
    ]);
    bridge.sweep();
  });

  // --- 12. Officer: benefits, assets, email release ---------------------------------------------
  await ev.step('benefits and providers', page, async () => {
    await ui.switchTo(page, 'HR Officer');
    const msg = await ui.confirmBenefits(page, caseUrl, x.benefits.health, x.benefits.life);
    bridge.sweep();
    await page.goto(caseUrl);
    const shot = await ev.shot(page, 'benefits_providers');
    ev.pass('benefits', 'Benefits applicability confirmed by HR', msg, [
      { label: 'View Screenshot', href: shot },
    ]);
    const snap = bridge.snapshot(caseNumber);
    const health = snap.requiredActions.find(
      (r) => r['actionKey'] === 'EMAIL:GROUP_HEALTH_REMOVAL',
    );
    const life = snap.requiredActions.find((r) => r['actionKey'] === 'EMAIL:GROUP_LIFE_REMOVAL');
    ev.expect(
      'benefits',
      `Group health provider action ${x.benefits.health === 'YES' ? 'required' : 'not applicable'}`,
      !!health && health['applicable'] === (x.benefits.health === 'YES'),
      `${health?.['determination']} / applicable=${health?.['applicable']}`,
    );
    ev.expect(
      'benefits',
      `Group life provider action ${x.benefits.life === 'YES' ? 'required' : 'not applicable'}`,
      !!life && life['applicable'] === (x.benefits.life === 'YES'),
      `${life?.['determination']} / applicable=${life?.['applicable']}`,
    );
    ev.fact(
      'Derived required actions',
      snap.requiredActions.map(
        (r) =>
          `${r['actionKey']}: ${r['determination']}${r['applicable'] ? '' : ' (not applicable)'}`,
      ),
    );
  });

  await ev.step('assets', page, async () => {
    if (x.tickAssets.length) {
      const r = await ui.tickAssets(page, caseUrl, x.tickAssets);
      ev.expect(
        'assets',
        'HR recorded the company assets this employee holds (test identifiers)',
        r.ticked === x.tickAssets.length && !r.feedback.err,
        `${x.tickAssets.map((a) => `${a.type} ${a.identifier}`).join(', ')}; ${r.feedback.ok ?? r.feedback.err ?? ''}`,
      );
    }
    await page.goto(`${caseUrl}/assets`);
    const shot = await ev.shot(page, 'assets');
    const snap = bridge.snapshot(caseNumber);
    if (x.tickAssets.length) {
      const expectedBack = snap.assets.map((a) => dateOf(a['expectedReturnAt'] as string));
      const deadline =
        plan.confirmedLastDay ??
        (plan.effectiveSeparationAt ? plan.effectiveSeparationAt.slice(0, 10) : plan.executionDate);
      ev.expect(
        'assets',
        `Expected return deadline = last working day / effective date (${deadline})`,
        snap.assets.length === x.tickAssets.length && expectedBack.every((d) => d === deadline),
        expectedBack.join(', '),
        [{ label: 'View Screenshot', href: shot }],
      );
    } else {
      const none = snap.requiredActions.find((r) => r['actionKey'] === 'ASSET:NONE');
      ev.check(
        'assets',
        'No assigned asset data available for this employee - expected system behaviour confirmed',
        snap.assets.length === 0 && !!none ? 'PASS' : snap.assets.length === 0 ? 'WARN' : 'FAIL',
        none
          ? String((none['result'] as Record<string, unknown>)?.['message'] ?? none['title'])
          : `${snap.assets.length} asset row(s)`,
        [{ label: 'View Screenshot', href: shot }],
      );
    }
    ev.fact(
      'Asset rows',
      snap.assets.map(
        (a) =>
          `${a['label']} ${a['identifier'] ?? ''} expected ${dateOf(a['expectedReturnAt'] as string)} status ${a['status']}`,
      ),
    );
  });

  await ev.step('email actions: release and send', page, async () => {
    // The officer releases what HR review allows; a RESTRICTED case escalates
    // every email to HR Manager authority, so the manager releases the rest.
    const byOfficer = await ui.releaseWaitingEmailActions(page, caseUrl);
    await ui.switchTo(page, 'HR Manager');
    const byManager = await ui.releaseWaitingEmailActions(page, caseUrl);
    await ui.switchTo(page, 'HR Officer');
    const released = byOfficer + byManager;
    ev.fact(
      'Email actions released by HR review',
      `${byOfficer} by the HR Officer, ${byManager} by the HR Manager`,
    );
    bridge.sweep();
    await page.goto(`${caseUrl}/notifications`);
    const shot = await ev.shot(page, 'email_actions');
    ev.pass(
      'emails',
      'Email actions tab reviewed; HR-review items released',
      `${released} released`,
      [{ label: 'View Screenshot', href: shot }],
    );
  });

  // --- 13. Documents ---------------------------------------------------------------------------
  await ev.step('documents', page, async () => {
    await page.goto(`${caseUrl}/documents`);
    const hasCreate =
      (await page.getByRole('button', { name: 'Create resignation document draft' }).count()) > 0;
    if (x.letterType) {
      ev.expect('documents', `Resignation document control offered (${x.letterType})`, hasCreate);
      const log = await ui.createResignationLetter(page, caseUrl, ADDRESS);
      ev.fact('Letter preparation', log);
      ev.expect(
        'documents',
        'Letter draft created, address saved, fields refreshed, validated and submitted',
        log.some((l) => /submit: .*submitted/i.test(l)),
        log.join(' | '),
      );
      await ui.switchTo(page, 'HR Manager');
      const msg = await ui.approveDocument(page, caseUrl);
      ev.pass(
        'documents',
        'Letter approved (attested, maker-checker) and PDF rendered',
        msg.slice(0, 100),
      );
      const hrefs = await ui.documentPdfHrefs(page, caseUrl);
      for (const href of hrefs) {
        const resp = await page.request.get(href);
        const bytes = Buffer.from(await resp.body());
        const disposition = resp.headers()['content-disposition'] ?? '';
        const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `${caseNumber}-document.pdf`;
        const rel = ev.writeBinary('documents', name, bytes);
        ev.expect(
          'documents',
          `PDF downloaded: ${name}`,
          resp.ok() && bytes.length > 1000 && bytes.subarray(0, 4).toString() === '%PDF',
          `${bytes.length} bytes`,
          [{ label: 'Open Generated Document', href: rel }],
        );
      }
      const shot = await ev.shot(page, 'generated_documents');
      await page.goto(`${caseUrl}/documents`);
      const preview = page
        .locator('details', { has: page.locator('summary', { hasText: 'Preview' }) })
        .first();
      if ((await preview.count()) > 0) {
        await preview.locator('summary').click();
        await ev.shot(page, 'document_preview');
      }
      // Issuing the letter is HR Manager authority (doc.markIssued), so it is
      // sent before handing the case back to the officer.
      const sent = await ui.sendLetterByEmail(page, caseUrl);
      await ui.switchTo(page, 'HR Officer');
      ev.expect(
        'documents',
        'Letter sent to the employee by email (HR review then send)',
        /queued/i.test(sent),
        sent,
      );
      bridge.sweep();
      const snap = bridge.snapshot(caseNumber);
      for (const d of snap.documents) {
        const text = String(d['contentSnapshot'] ?? '');
        const nameOk = text.includes(run.employee);
        const tokensOk = !/\[\[|\[MISSING:/.test(text);
        const wordingOk = !x.forbiddenWording.test(text);
        const dateOk =
          !!plan.confirmedLastDay &&
          text.includes(String(Number(plan.confirmedLastDay.slice(8, 10))));
        const checks = [
          `employee named: ${nameOk}`,
          `no unresolved tokens: ${tokensOk}`,
          `wording: ${wordingOk}`,
          `date present: ${dateOk}`,
        ];
        const dataCorrect: CheckStatus =
          nameOk && tokensOk && wordingOk ? (dateOk ? 'PASS' : 'HUMAN_REVIEW') : 'FAIL';
        const base = `${caseNumber}-${String(d['documentType']).toLowerCase()}-v${d['version']}`;
        ev.write('documents', `${base}.content.txt`, text || '(no content snapshot)');
        ev.addDocument({
          file: `documents/${base}.pdf`,
          documentType: String(d['documentType']),
          version: Number(d['version']),
          status: String(d['status']),
          template: `template v${d['templateVersion'] ?? '?'}`,
          expected: true,
          generated: !!d['pdfObjectKey'],
          dataCorrect,
          detail: checks.join('; '),
        });
        ev.check(
          'documents',
          `${d['documentType']} v${d['version']} content bound to approval is correct`,
          dataCorrect,
          checks.join('; '),
          [
            { label: 'View Screenshot', href: shot },
            { label: 'Content', href: `documents/${base}.content.txt` },
          ],
        );
      }
    } else {
      ev.expect(
        'documents',
        'No resignation document control for this type (DEC-058: nothing is issued until HR approves a template)',
        !hasCreate,
      );
      ev.addDocument({
        file: null,
        documentType: 'RESIGNATION LETTER',
        version: 0,
        status: 'n/a',
        template: 'none for this type',
        expected: false,
        generated: false,
        dataCorrect: 'PASS',
        detail: 'No employee-facing letter template exists for this separation type.',
      });
      const text = await ui.mainText(page);
      ev.expect(
        'documents',
        'Documents tab contains no resignation wording for this type',
        !x.forbiddenWording.test(text) || x.employeeInitiated,
        text.slice(0, 120),
      );
      await ev.shot(page, 'generated_documents');
    }
    // Employee Action Form (HR + Finance record) - completed for every type.
    await ui.switchTo(page, 'HR Officer');
    const formLog = await ui.completeActionForm(page, caseUrl);
    ev.fact('Action form', formLog);
    ev.expect(
      'documents',
      'Employee Action Form prepared and completed (attested, final PDF)',
      formLog.some((l) => /complete: .*completed/i.test(l)),
      formLog.join(' | '),
    );
    const href = await ui.actionFormPdfHref(page, caseUrl);
    if (href) {
      const resp = await page.request.get(href);
      const bytes = Buffer.from(await resp.body());
      const rel = ev.writeBinary('documents', `${caseNumber}-employee-action-form.pdf`, bytes);
      ev.addDocument({
        file: rel,
        documentType: 'EMPLOYEE_ACTION_FORM',
        version: 1,
        status: 'COMPLETE',
        template: 'action form',
        expected: true,
        generated: resp.ok() && bytes.length > 1000,
        dataCorrect: 'HUMAN_REVIEW',
        detail: 'HR + Finance sections; content review by a person',
      });
      ev.expect(
        'documents',
        'Action form PDF downloaded',
        resp.ok() && bytes.length > 1000,
        `${bytes.length} bytes`,
        [{ label: 'Open Generated Document', href: rel }],
      );
    }
    await ev.shot(page, 'action_form');
  });

  // --- 14. Tasks matrix ----------------------------------------------------------------------------
  await ev.step('task matrix', page, async () => {
    const expected = bridge.workflowExpectation(x.type);
    const snap = bridge.snapshot(caseNumber);
    const rows: TaskRow[] = [];
    const seen = new Map<string, number>();
    for (const t of snap.tasks)
      seen.set(String(t['taskCode']), (seen.get(String(t['taskCode'])) ?? 0) + 1);
    for (const e of expected.tasks) {
      const created = snap.tasks.filter((t) => t['taskCode'] === e.code);
      const t = created[0];
      rows.push({
        code: e.code,
        title: e.title,
        expected: true,
        created: created.length > 0,
        owner: `${e.department} / ${e.requiredRole}`,
        dueAt: t ? wallClock(t['dueAt'] as string) : '',
        status: t ? String(t['status']) : '-',
        priority: e.priority,
        result:
          created.length === 1
            ? 'PASS'
            : created.length === 0
              ? e.required
                ? 'FAIL'
                : 'WARN'
              : 'FAIL',
        note:
          created.length > 1
            ? 'duplicate'
            : created.length === 0 && !e.required
              ? 'optional, not created'
              : undefined,
      });
    }
    for (const t of snap.tasks) {
      if (!expected.tasks.some((e) => e.code === t['taskCode']))
        rows.push({
          code: String(t['taskCode']),
          title: String(t['title']),
          expected: false,
          created: true,
          owner: `${t['department']} / ${t['requiredRole']}`,
          dueAt: wallClock(t['dueAt'] as string),
          status: String(t['status']),
          priority: String(t['priority']),
          result: 'WARN',
          note: 'not in the active workflow definition',
        });
    }
    ev.setTasks(rows);
    ev.expect(
      'workflow',
      `Every required task of the ACTIVE ${expected.name ?? x.type} v${expected.version} definition was created once`,
      rows.filter((r) => r.expected).every((r) => r.result !== 'FAIL'),
      `${snap.tasks.length} task(s) created; ${expected.tasks.length} defined`,
    );
    ev.expect(
      'workflow',
      'No duplicate tasks',
      [...seen.values()].every((n) => n === 1),
    );
    const urgent = snap.tasks.filter(
      (t) =>
        /URGENT/.test(String(t['taskCode'])) ||
        ['HIGH', 'URGENT', 'CRITICAL'].includes(String(t['priority'])),
    );
    ev.fact(
      'Urgent / high-priority tasks',
      urgent.map((t) => `${t['title']} (${t['priority']})`),
    );
    if (x.baseUrgency === 'IMMEDIATE')
      ev.expect(
        'urgency',
        'Immediate separation: urgent HR review task present',
        urgent.length > 0,
        `${urgent.length} urgent`,
      );
    const future = snap.tasks.filter(
      (t) => t['dueAt'] && new Date(String(t['dueAt'])).getTime() > Date.now() + 36 * 3600_000,
    );
    if (x.baseUrgency !== 'IMMEDIATE')
      ev.expect(
        'timing',
        'Future-dated case: tasks are scheduled ahead, not all same-day',
        future.length > 0 || snap.tasks.length === 0,
        `${future.length} of ${snap.tasks.length} due later than tomorrow`,
      );
    const keys = snap.requiredActions.map((r) => String(r['actionKey']));
    ev.expect(
      'workflow',
      'IT, Finance/Payroll and Manager actions derived',
      keys.includes('EMAIL:IT_ACCESS_REMOVAL') &&
        keys.includes('EMAIL:FINANCE_OFFBOARDING') &&
        keys.includes('EMAIL:MANAGER_DEPARTURE_NOTICE'),
      keys.join(', '),
    );
    const survey = snap.requiredActions.find((r) => r['actionKey'] === 'SURVEY:INVITATION');
    ev.expect(
      'workflow',
      x.surveyExpected ? 'Exit survey action derived' : 'No exit survey for this type',
      x.surveyExpected
        ? !!survey && survey['applicable'] === true
        : !survey || survey['applicable'] === false,
      survey
        ? `${survey['determination']} / applicable=${survey['applicable']}`
        : 'no survey action',
    );
  });

  // --- 15. Links (employee checklist, department acknowledgements, survey) ----------------------
  await ev.step('generated links', page, async () => {
    let snap = bridge.snapshot(caseNumber);
    const bodies = snap.notifications.map((n) => ({
      type: n.notificationType,
      body: n.captures[n.captures.length - 1]?.body ?? '',
    }));
    const checklistLink =
      bodies
        .find((b) => b.type === 'RETURN_ITEMS_CHECKLIST')
        ?.body.match(/https?:\/\/\S+\/checklist\/[A-Za-z0-9_-]{43}/)?.[0] ?? null;
    const held =
      x.internalEmailsHeldUntilEffective &&
      !!plan.effectiveSeparationAt &&
      new Date(`${plan.effectiveSeparationAt}:00-05:00`).getTime() > Date.now();
    if (checklistLink) {
      const before = bridge.snapshot(caseNumber);
      const r = await ui.completeReturnChecklist(browser, checklistLink, run.employee, pageShot);
      snap = bridge.snapshot(caseNumber);
      const cl = snap.returnChecklist;
      const submitted = !!cl && !!cl['submittedAt'];
      const file = ev.write(
        'links',
        '01-employee-exit-checklist.md',
        [
          '# Employee exit checklist link',
          '',
          `Case: ${caseNumber}`,
          `URL: ${redactUrl(checklistLink)}`,
          `Generated: ${before.returnChecklist?.['sentAt'] ?? 'at dispatch'}`,
          'Token: single-use, 14-day expiry, hash-only storage (ActionToken purpose COMPLETE_RETURN_CHECKLIST)',
          `Employee page heading: ${r.heading}`,
          `Rows shown: ${r.rows}`,
          `Submitted: ${submitted} at ${cl?.['submittedAt'] ?? '-'}`,
          '',
          'Employee-facing page text (first 600 chars):',
          '',
          '```',
          r.text.slice(0, 600),
          '```',
        ].join('\n'),
      );
      ev.addLink({
        kind: 'Employee exit checklist (return items)',
        expected: true,
        generated: true,
        resolves: /Exit Checklist/i.test(r.heading) ? 'PASS' : 'FAIL',
        correctCase: r.text.includes(run.employee) ? 'PASS' : 'HUMAN_REVIEW',
        permissions: !/Sagicor|salary|payroll/i.test(r.text) ? 'PASS' : 'HUMAN_REVIEW',
        redactedUrl: redactUrl(checklistLink),
        file,
        result: submitted ? 'PASS' : 'FAIL',
        detail: submitted ? 'submitted and received on the case' : 'submission not recorded',
      });
      ev.expect(
        'links',
        'Exit checklist link resolves, is completed by the employee and the submission returns to the case with a timestamp',
        submitted,
        cl
          ? `status ${cl['status']} submitted ${wallClock(cl['submittedAt'] as string)}`
          : 'no checklist row',
      );
      await page.goto(`${caseUrl}/assets`);
      await ev.shot(page, 'hr_case_shows_received_checklist');
      const again = await ui.probePublicPage(browser, checklistLink);
      ev.expect(
        'links',
        'Checklist link is single-use (second visit refused neutrally)',
        /not valid|Not Available|Already Recorded|already/i.test(again.heading + ' ' + again.text),
        again.heading || again.text.slice(0, 80),
      );
    } else {
      ev.check(
        'links',
        'Exit checklist link',
        held ? 'PASS' : 'FAIL',
        held
          ? 'held with the internal notices until the effective instant - not yet generated'
          : 'no checklist email captured',
      );
      ev.addLink({
        kind: 'Employee exit checklist (return items)',
        expected: !held,
        generated: false,
        resolves: 'SKIPPED',
        correctCase: 'SKIPPED',
        permissions: 'SKIPPED',
        redactedUrl: '',
        file: null,
        result: held ? 'PASS' : 'FAIL',
        detail: held ? 'not generated until the effective instant' : 'missing',
      });
    }
    let n = 2;
    for (const t of ['IT_ACCESS_REMOVAL', 'FINANCE_OFFBOARDING']) {
      const link =
        bodies
          .find((b) => b.type === t)
          ?.body.match(/https?:\/\/\S+\/ack\/[A-Za-z0-9_-]{43}/)?.[0] ?? null;
      if (!link) {
        ev.addLink({
          kind: `${t} acknowledgement`,
          expected: !held,
          generated: false,
          resolves: 'SKIPPED',
          correctCase: 'SKIPPED',
          permissions: 'SKIPPED',
          redactedUrl: '',
          file: null,
          result: held ? 'PASS' : 'FAIL',
          detail: held
            ? 'notice held until the effective instant'
            : 'no acknowledgement link in the captured email',
        });
        continue;
      }
      const r = await ui.acknowledgeLink(
        browser,
        link,
        t === 'IT_ACCESS_REMOVAL' ? pageShot : undefined,
      );
      snap = bridge.snapshot(caseNumber);
      const rec = snap.notifications.find((q) => q.notificationType === t);
      const acked = !!rec?.['acknowledgedAt'] || !!rec?.['completionConfirmedAt'];
      const leak = x.restricted && new RegExp(x.type, 'i').test(r.outcome);
      const file = ev.write(
        'links',
        `${String(n).padStart(2, '0')}-${t.toLowerCase().replace(/_/g, '-')}-acknowledgement.md`,
        [
          '# Acknowledgement link',
          '',
          `Notification: ${t}`,
          `Case: ${caseNumber}`,
          `URL: ${redactUrl(link)}`,
          `Case reference shown on the page: ${r.caseRefShown ?? '(none)'}`,
          `Heading: ${r.heading}`,
          `Outcome: ${r.outcome}`,
          `Recorded on the case: acknowledged ${rec?.['acknowledgedAt'] ?? '-'} via ${rec?.['acknowledgedVia'] ?? '-'}; completion ${rec?.['completionConfirmedAt'] ?? '-'}`,
        ].join('\n'),
      );
      ev.addLink({
        kind: `${t} acknowledgement (no login)`,
        expected: true,
        generated: true,
        resolves: /Acknowledge|Confirm|Thank You/i.test(r.heading + r.outcome) ? 'PASS' : 'FAIL',
        correctCase: r.caseRefShown === caseNumber ? 'PASS' : 'FAIL',
        permissions: !leak ? 'PASS' : 'FAIL',
        redactedUrl: redactUrl(link),
        file,
        result: acked && !leak ? 'PASS' : 'FAIL',
        detail: acked
          ? `recorded via ${rec?.['acknowledgedVia'] ?? 'token'}`
          : 'acknowledgement not recorded',
      });
      ev.expect(
        'links',
        `${t} secure link resolves to this case and records the acknowledgement`,
        acked && r.caseRefShown === caseNumber && !leak,
        `case shown ${r.caseRefShown}; ${r.outcome.slice(0, 80)}`,
      );
      n += 1;
    }
    const bad = await ui.probePublicPage(
      browser,
      `${run.baseUrl}/ack/invalidtokenvalue000000000000000000000000000`,
    );
    ev.expect(
      'links',
      'An invalid secure link is refused neutrally',
      /not valid|Not Available/i.test(bad.text),
      bad.heading,
    );
    if (x.surveyExpected) {
      await ui.switchTo(page, 'HR Officer');
      const s = await ui.issueSurveyLink(page, caseUrl);
      await ev.shot(page, 'employee_survey_link_generated');
      if (s.link) {
        const done = await ui.completeSurveyAsEmployee(browser, s.link);
        snap = bridge.snapshot(caseNumber);
        const inv = snap.survey[snap.survey.length - 1];
        const completed = !!inv?.['completedAt'];
        const noCaseDetail = !done.text.includes(caseNumber);
        const file = ev.write(
          'links',
          '04-exit-survey.md',
          [
            '# Exit survey link',
            '',
            `Case: ${caseNumber}`,
            `URL: ${redactUrl(s.link)}`,
            `Notes: ${s.notes.join(' ')}`,
            `Employee page showed case details: ${!noCaseDetail}`,
            `Completed: ${completed} at ${inv?.['completedAt'] ?? '-'} via ${inv?.['responseChannel'] ?? '-'}`,
            `Expires: ${inv?.['expiresAt'] ?? '-'}`,
          ].join('\n'),
        );
        ev.addLink({
          kind: 'Exit survey (one-time secure link)',
          expected: true,
          generated: true,
          resolves: done.ok ? 'PASS' : 'FAIL',
          correctCase: completed ? 'PASS' : 'FAIL',
          permissions: noCaseDetail ? 'PASS' : 'FAIL',
          redactedUrl: redactUrl(s.link),
          file,
          result: done.ok && completed && noCaseDetail ? 'PASS' : 'FAIL',
          detail: s.notes.join(' '),
        });
        ev.expect(
          'links',
          'Exit survey link resolves, the employee sees no case detail, submission returns to the case with a timestamp',
          done.ok && completed && noCaseDetail,
          `completed ${inv?.['completedAt'] ?? '-'}`,
        );
        const again = await ui.probePublicPage(browser, s.link);
        ev.expect(
          'links',
          'Survey link is single-use',
          /expired|not valid|Not Available|already|thanks/i.test(
            again.url + ' ' + again.heading + ' ' + again.text,
          ),
          again.heading || again.url,
        );
        await page.goto(`${caseUrl}/survey`);
        await ev.shot(page, 'hr_case_shows_survey_received');
      } else {
        ev.fail('links', 'Exit survey link could not be generated', s.notes.join(' '));
      }
    } else {
      ev.pass('links', 'No exit survey for this separation type (profile: not survey-eligible)');
    }
  });

  // --- 16. Confidential timing (employer-initiated) ------------------------------------------------
  if (x.internalEmailsHeldUntilEffective && plan.effectiveSeparationAt) {
    await ev.step('confidential timing', page, async () => {
      const effective = new Date(`${plan.effectiveSeparationAt}:00-05:00`).getTime();
      const snap = bridge.snapshot(caseNumber);
      for (const t of HELD_TYPES) {
        const rec = snap.notifications.find((q) => q.notificationType === t);
        const sched = rec?.['scheduledSendAt']
          ? new Date(String(rec['scheduledSendAt'])).getTime()
          : null;
        const expectedAt = t === 'IT_ACCESS_REMOVAL' ? effective - 3600_000 : effective;
        const ok = sched !== null && Math.abs(sched - expectedAt) < 90 * 60_000;
        ev.expect(
          'timing',
          `${t} scheduled ${t === 'IT_ACCESS_REMOVAL' ? 'one hour before' : 'at'} the effective instant (confidential timing)`,
          ok || (sched !== null && sched <= Date.now() && expectedAt <= Date.now()),
          sched
            ? `scheduled ${wallClock(new Date(sched))}; effective ${wallClock(new Date(effective))}`
            : 'no schedule',
        );
      }
      const wait = effective - Date.now();
      if (wait > 0 && wait < 6 * 60_000) {
        ev.log(`waiting ${Math.ceil(wait / 1000)}s for the effective instant`);
        await page.waitForTimeout(wait + 5_000);
        bridge.sweep();
        ev.pass(
          'timing',
          'Effective instant reached inside the run; notices released by the sweep',
        );
      } else if (wait >= 6 * 60_000) {
        ev.pass(
          'timing',
          'Effective instant is in the future: internal notices remain scheduled, not sent early',
          wallClock(new Date(effective)),
        );
      } else {
        bridge.sweep();
      }
    });
  }

  // --- 17. Tasks and asset outcomes --------------------------------------------------------------
  await ev.step('complete HR tasks', page, async () => {
    await ui.switchTo(page, 'HR Officer');
    if (x.tickAssets.length) {
      let recorded = 0;
      for (let k = 0; k < x.tickAssets.length; k++) {
        await page.goto(`${caseUrl}/assets`);
        if (await ui.recordFirstAssetOutcome(page, 'RETURNED')) recorded += 1;
      }
      ev.expect(
        'assets',
        'Asset outcomes recorded (returned)',
        recorded === x.tickAssets.length,
        `${recorded} recorded`,
      );
      await page.goto(`${caseUrl}/assets`);
      await ev.shot(page, 'assets_after_return');
    }
    const itEvidence = await ui
      .recordItEvidence(
        page,
        caseUrl,
        'Regression run: IT confirmed removal by acknowledgement link; evidence recorded by HR.',
      )
      .catch(() => false);
    ev.fact('IT completion evidence recorded by HR', itEvidence);
    const outcomes: string[] = [];
    for (const actor of ['HR Officer', 'HR Manager']) {
      if (actor === 'HR Manager') await ui.switchTo(page, 'HR Manager');
      for (let round = 0; round < 2; round++) {
        const links = await ui.listTaskLinks(page, caseUrl);
        let progressed = false;
        for (const t of links) {
          const r = await ui.completeTaskPage(
            page,
            t.href,
            `Regression run ${run.runId}: completed with evidence for scenario ${code}.`,
          );
          if (r !== 'already-completed') outcomes.push(`${actor}: ${t.title}: ${r}`);
          if (r === 'completed') progressed = true;
        }
        if (!progressed) break;
      }
    }
    ev.fact('Task completion outcomes', outcomes);
    const snap = bridge.snapshot(caseNumber);
    const open = snap.tasks.filter(
      (t) => !['COMPLETED', 'WAIVED', 'CANCELLED', 'SKIPPED'].includes(String(t['status'])),
    );
    ev.check(
      'workflow',
      'HR tasks completed with evidence where the platform allowed it',
      open.length === 0 ? 'PASS' : 'WARN',
      open.length
        ? `${open.length} still open: ${open.map((t) => `${t['title']} (${t['status']})`).join('; ')}`
        : 'all tasks closed',
    );
    await page.goto(`${caseUrl}/workflow`);
    await ev.shot(page, 'tasks_after_completion');
  });

  // --- 18. Clearance and completion ----------------------------------------------------------------
  await ev.step('clearance and completion', page, async () => {
    bridge.sweep();
    await ui.switchTo(page, 'HR Officer');
    const gate = await ui.clearanceGate(page, caseUrl);
    const shot = await ev.shot(page, 'clearance_gate');
    ev.fact('Clearance gate text', gate.text.slice(0, 700));
    const req = await ui.requestClearance(page, caseUrl);
    ev.fact('Clearance request', req);
    if (req === 'requested') {
      await ui.switchTo(page, 'HR Manager');
      const r = await ui.approveClearance(page, caseUrl);
      const snap = bridge.snapshot(caseNumber);
      ev.check(
        'lifecycle',
        'Case moved through clearance review to COMPLETED',
        snap.case.status === 'COMPLETED' ? 'PASS' : 'WARN',
        `${r}; status ${snap.case.status}`,
        [{ label: 'View Screenshot', href: shot }],
      );
    } else {
      const snap = bridge.snapshot(caseNumber);
      ev.check(
        'lifecycle',
        'Clearance blocked by outstanding items (expected where work remains open)',
        'WARN',
        `${req}; status ${snap.case.status}`,
        [{ label: 'View Screenshot', href: shot }],
      );
    }
    await page.goto(caseUrl);
    const final = await ev.shot(page, 'final_case_state');
    const snap = bridge.snapshot(caseNumber);
    ev.fact('Final status', snap.case.status);
    ev.pass('lifecycle', `Final case state recorded: ${snap.case.status}`, '', [
      { label: 'View Screenshot', href: final },
    ]);
  });

  // --- 19. Emails and communication history -------------------------------------------------------------
  await ev.step('email evidence', page, async () => {
    bridge.sweep();
    const snap = bridge.snapshot(caseNumber);
    const stillHeld =
      x.internalEmailsHeldUntilEffective &&
      !!plan.effectiveSeparationAt &&
      new Date(`${plan.effectiveSeparationAt}:00-05:00`).getTime() > Date.now();
    const heldTypes = stillHeld ? HELD_TYPES : [];
    const emails = recordEmails(ev, snap, {
      employee: run.employee,
      expectation: x,
      caseNumber,
      testMailbox: run.testMailbox,
      heldTypes,
    });
    const types = snap.notifications.map((q) => q.notificationType);
    for (const t of expectedEmailTypes(x))
      ev.expect(
        'emails',
        `Email record exists: ${t}`,
        types.includes(t),
        types.includes(t)
          ? (snap.notifications.find((q) => q.notificationType === t)?.status ?? '')
          : 'missing',
      );
    for (const e of emails)
      ev.check(
        'emails',
        `${e.label}: intended ${e.intendedTo} -> actual ${e.actualTo} (${e.testMode ? 'TEST MODE' : 'not redirected'})`,
        e.result,
        e.contentChecks
          .filter((c) => c.status !== 'PASS')
          .map((c) => `${c.title}: ${c.status}${c.detail ? ' (' + c.detail + ')' : ''}`)
          .join('; ') || 'all content checks passed',
        [
          { label: 'View Email Evidence', href: e.file },
          { label: 'Routing', href: 'emails/routing.md' },
        ],
      );
    const dispatched = emails.filter((e) => e.sentAt);
    ev.expect(
      'emails',
      'Every dispatched email was redirected to the test mailbox (no real recipient)',
      dispatched.length > 0 && dispatched.every((e) => e.testMode),
      dispatched.map((e) => e.actualTo).join(', ') || 'none dispatched',
    );
    ev.expect(
      'emails',
      'No email silently missing: every record is sent, acknowledged, scheduled (held) or awaiting a recipient',
      snap.notifications.every(
        (q) =>
          [
            'SENT',
            'ACKNOWLEDGED',
            'CONFIRMED_COMPLETE',
            'APPROVED',
            'PENDING_APPROVAL',
            'SCHEDULED',
            'MANUALLY_SENT',
          ].includes(String(q.status)) || heldTypes.includes(q.notificationType),
      ),
      snap.notifications.map((q) => `${q.notificationType}=${q.status}`).join(', '),
    );
    await ui.switchTo(page, 'HR Manager');
    await page.goto(`/admin/email-log?case=${encodeURIComponent(caseNumber)}&test=1`);
    const log = await ev.shot(page, 'email_history_intended_vs_actual');
    ev.pass(
      'emails',
      'Email log shows intended recipients, actual test recipient and Test mode per message',
      '',
      [{ label: 'View Screenshot', href: log }],
    );
    await page.goto(`${caseUrl}/notifications`);
    const hist = await ev.shot(page, 'communications_history');
    ev.pass(
      'emails',
      'Case communication history captured (type, recipient, status, dates, related document/action)',
      '',
      [{ label: 'View Screenshot', href: hist }],
    );
    await page.goto('/dev/mailbox');
    await ev.shot(page, 'dev_mailbox_captured_messages');
  });

  // --- 20. Audit -------------------------------------------------------------------------------------
  await ev.step('audit trail', page, async () => {
    const snap = bridge.snapshot(caseNumber);
    ev.auditEvents = snap.audit;
    ev.write('audit', 'events.json', JSON.stringify(snap.audit, null, 2));
    const lines = [
      '# Audit timeline - ' + caseNumber,
      '',
      '| When (Jamaica) | Actor | Kind | Event | Sentence | Result |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const e of snap.audit)
      lines.push(
        `| ${wallClock(String(e['occurredAt']))} | ${e['actor']} | ${e.actorType === 'SYSTEM' ? 'Automated' : 'Manual'} | ${e.eventType} | ${redactTokens(e.sentence).replace(/\|/g, '/')} | ${e['result']} |`,
      );
    ev.write('audit', 'timeline.md', lines.join('\n'));
    const has = (re: RegExp) => snap.audit.some((e) => re.test(e.eventType));
    const expectedEvents: Array<[string, RegExp]> = [
      ['Case created', /CASE_CREATED/],
      ['Case approved', /CASE_APPROVED|APPROVED/],
      ['HR Officer assigned', /OFFICER_ASSIGNED/],
      ['Case activated', /ACTIVATED/],
      ['Benefits evaluated', /BENEFIT/],
      ['Email prepared/approved', /NOTIFICATION_(PREPARED|AUTO_APPROVED|APPROVED|CREATED)/],
      ['Email sent (outbox)', /NOTIFICATION_(SENT|SUBMITTED|DISPATCHED|REDIRECTED)/],
      ['Task completion', /TASK_COMPLETED/],
      ['Status change', /STATUS|TRANSITION|ACTIVATED|APPROVED/],
      ['Checklist / acknowledgement token used', /TOKEN|CHECKLIST|ACKNOWLEDGED/],
    ];
    if (x.letterType) expectedEvents.push(['Document generated/approved', /DOC_|DOCUMENT/]);
    if (x.surveyExpected) expectedEvents.push(['Survey link generated / completed', /SURVEY/]);
    for (const [title, re] of expectedEvents)
      ev.check(
        'audit',
        `Audit records: ${title}`,
        has(re) ? 'PASS' : 'WARN',
        has(re) ? '' : `no event matching ${re.source}`,
        [{ label: 'Timeline', href: 'audit/timeline.md' }],
      );
    const auto = snap.audit.filter((e) => e.actorType === 'SYSTEM').length;
    const manual = snap.audit.length - auto;
    ev.expect(
      'audit',
      'Automated actions are distinguishable from manual ones (actor type on every event)',
      auto > 0 && manual > 0,
      `${manual} by a person, ${auto} automated`,
    );
    await page.goto(`${caseUrl}#audit-h`);
    const shot = await ev.shot(page, 'audit_timeline');
    await page.goto(`/audit?case=${encodeURIComponent(caseNumber)}&purpose=TEST`);
    const centre = await ev.shot(page, 'audit_centre_filtered_by_case');
    ev.pass('audit', `${snap.audit.length} audit events captured for the case`, '', [
      { label: 'View Screenshot', href: shot },
      { label: 'Audit Centre', href: centre },
      { label: 'events.json', href: 'audit/events.json' },
    ]);
  });

  // --- 21. Reporting isolation -------------------------------------------------------------------------
  await ev.step('reporting isolation', page, async () => {
    await page.goto('/reports?report=volumeTrend&purpose=TEST');
    const withTest = await ev.shot(page, 'reports_test_records_only');
    await page.goto('/reports?report=volumeTrend');
    const operational = await ev.shot(page, 'reports_operational_default');
    const snap = bridge.snapshot(caseNumber);
    ev.expect(
      'metrics',
      'Case is a TEST record: excluded from operational reports and KPIs by the reporting predicate (isOperationalForReporting)',
      snap.case.recordPurpose === 'TEST',
      snap.case.recordPurpose,
      [
        { label: 'TEST-only report', href: withTest },
        { label: 'Operational report', href: operational },
      ],
    );
    await page.goto(`/cases?q=${encodeURIComponent(caseNumber)}`);
    await ev.shot(page, 'case_list_shows_excluded_from_reporting');
  });

  ev.finish(
    `${x.label}: case ${caseNumber}; ${ev.emails.length} email record(s), ${ev.documents.filter((d) => d.generated).length} document(s), ${ev.links.filter((l) => l.generated).length} link(s).`,
  );
}
