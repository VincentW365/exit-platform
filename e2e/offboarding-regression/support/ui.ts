/**
 * The application as a person drives it. Every helper here is a sequence of
 * clicks, keystrokes and page reads against the real UI; none of them reach
 * around the application. Selectors are the ones the platform's own e2e
 * suites have proven (e2e/stage3-flows, e2e/uat-scenarios, e2e/keyboard).
 *
 * Feedback is read from the page's own feedback elements (`.ok-summary`,
 * `.error-summary`), never from the first `role=alert` on the page: the live
 * directory banner is a permanent alert and would be mistaken for a refusal.
 */
import { expect, type Browser, type Locator, type Page } from '@playwright/test';

export const CASE_NUMBER = /OFF-\d{4}-\d{4,}(?:-\d)?/;

// --- session ------------------------------------------------------------

export async function signInAs(page: Page, displayName: string): Promise<void> {
  await page.goto('/signin');
  const button = page.getByRole('button', { name: `Sign in as ${displayName}` });
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/');
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  const out = page.getByRole('button', { name: 'Sign out' });
  if ((await out.count()) === 0) return;
  await out.click();
  await page.waitForURL('**/signin');
}

export async function switchTo(page: Page, displayName: string): Promise<void> {
  await signOut(page);
  await signInAs(page, displayName);
}

// --- feedback ------------------------------------------------------------

export interface Feedback {
  ok: string | null;
  err: string | null;
}

/** The page's own success / error feedback, if any. */
export async function readFeedback(page: Page): Promise<Feedback> {
  const ok = page.locator('.ok-summary').first();
  const err = page.locator('.error-summary').first();
  return {
    ok:
      (await ok.count()) > 0 ? ((await ok.textContent()) ?? '').replace(/\s+/g, ' ').trim() : null,
    err:
      (await err.count()) > 0
        ? ((await err.textContent()) ?? '').replace(/\s+/g, ' ').trim()
        : null,
  };
}

/**
 * Click a form button and wait for the server action's redirect to land,
 * then read the feedback. Every write on this platform is a server action
 * followed by a redirect carrying ?ok= or ?err=, so the address changes.
 */
export async function act(page: Page, button: Locator, timeout = 60_000): Promise<Feedback> {
  const before = page.url();
  await button.click();
  await page.waitForFunction((b) => location.href !== b, before, { timeout }).catch(() => null);
  await page.waitForLoadState('load');
  return readFeedback(page);
}

// --- keyboard-first primitives -------------------------------------------

/** Focus a control once it is visible - as a person does - then confirm. */
export async function reach(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.focus();
  await expect(target).toBeFocused();
}

/**
 * Count browser validation reports ("Please fill out this field") across
 * navigations: every bubble is preceded by an `invalid` event.
 */
export async function installValidationCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener(
      'invalid',
      () => {
        const n = Number(sessionStorage.getItem('validationReports') ?? '0');
        sessionStorage.setItem('validationReports', String(n + 1));
      },
      true,
    );
  });
}

export async function validationReports(page: Page): Promise<number> {
  return page.evaluate(() => Number(sessionStorage.getItem('validationReports') ?? '0'));
}

export async function activeElementDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return 'none';
    const id = el.id ? `#${el.id}` : '';
    const name = el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : '';
    const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
    return `${el.tagName.toLowerCase()}${id}${name} "${label}"`;
  });
}

export async function mainText(page: Page): Promise<string> {
  return (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
}

// --- intake ---------------------------------------------------------------

export interface SearchOutcome {
  resultCount: number;
  validationReports: number;
}

/** Search from the keyboard: type the name, press Enter, read the results. */
export async function searchEmployee(page: Page, name: string): Promise<SearchOutcome> {
  await page.goto('/cases/new');
  const q = page.getByLabel('Employee Name or Number');
  await expect(q).toBeVisible();
  await expect(q).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/cases\/new\?q=/);
  const links = page.getByRole('link', { name: /^Select / });
  await expect(links.first()).toBeVisible();
  const resultCount = await links.count();
  const reports = await validationReports(page);
  return { resultCount, validationReports: reports };
}

export async function selectEmployeeByName(page: Page, name: string): Promise<string | null> {
  const exact = page.getByRole('link', { name: `Select ${name}`, exact: true });
  const target =
    (await exact.count()) > 0
      ? exact.first()
      : page.getByRole('link', { name: /^Select / }).first();
  const label = await target.getAttribute('aria-label');
  await reach(target);
  await page.keyboard.press('Enter');
  await page.waitForURL(/employee=/);
  return label;
}

export async function chooseSeparationType(page: Page, type: string): Promise<void> {
  const radio = page.locator(`input[name="type"][value=${JSON.stringify(type)}]`);
  await reach(radio);
  await page.keyboard.press('Space');
  await reach(page.getByRole('button', { name: 'Use this separation type' }));
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`type=${type}`));
}

export async function fieldPresent(page: Page, name: string): Promise<boolean> {
  return (await page.locator(`[name=${JSON.stringify(name)}]`).count()) > 0;
}

export async function fieldValue(page: Page, name: string): Promise<string | null> {
  const f = page.locator(`[name=${JSON.stringify(name)}]`);
  if ((await f.count()) === 0) return null;
  return f.first().inputValue();
}

export async function fieldLabel(page: Page, name: string): Promise<string | null> {
  const f = page.locator(`[name=${JSON.stringify(name)}]`).first();
  if ((await f.count()) === 0) return null;
  const id = await f.getAttribute('id');
  if (!id) return null;
  const label = page.locator(`label[for=${JSON.stringify(id)}]`);
  if ((await label.count()) === 0) return null;
  return (await label.first().textContent())?.replace(/\s+/g, ' ').trim() ?? null;
}

export async function fillField(page: Page, name: string, value: string): Promise<void> {
  const f = page.locator(`[name=${JSON.stringify(name)}]`).first();
  await reach(f);
  await f.fill(value);
}

export async function selectField(page: Page, name: string, value: string): Promise<void> {
  const f = page.locator(`select[name=${JSON.stringify(name)}]`).first();
  await reach(f);
  await f.selectOption(value);
}

/** Enter in a step field finishes the step and opens the next (never submits). */
export async function finishStepWithEnter(page: Page, fieldName: string): Promise<void> {
  const f = page.locator(`[name=${JSON.stringify(fieldName)}]`).first();
  await reach(f);
  await page.keyboard.press('Enter');
}

export function stepHeader(page: Page, stepId: string): Locator {
  return page.locator(`.step:has([data-step=${JSON.stringify(stepId)}]) .step__header`);
}

export async function stepExpanded(page: Page, stepId: string): Promise<boolean> {
  return (await stepHeader(page, stepId).getAttribute('aria-expanded')) === 'true';
}

export async function stepSummary(page: Page, stepId: string): Promise<string> {
  const s = page.locator(`.step:has([data-step=${JSON.stringify(stepId)}]) .step__summary`);
  if ((await s.count()) === 0) return '';
  return (await s.first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';
}

/** Open (or close) a step from its header with the keyboard. */
export async function toggleStepWithKeyboard(page: Page, stepId: string): Promise<boolean> {
  const header = stepHeader(page, stepId);
  await reach(header);
  await page.keyboard.press('Enter');
  return stepExpanded(page, stepId);
}

export interface CreatedDraft {
  url: string;
  number: string;
  banner: string;
  duplicateWarning: string | null;
}

export async function createDraft(page: Page): Promise<CreatedDraft> {
  if (!(await stepExpanded(page, 'review'))) await toggleStepWithKeyboard(page, 'review');
  // DEC-061: a fixture employee may already have a live case; confirm the deliberate
  // second one. The confirmation lives in the Review step, so make sure it is open.
  if (await page.getByLabel(/I confirm this is a separate separation event/).count()) {
    const reviewHeader = page.locator('.step:has([data-step="review"]) .step__header');
    if ((await reviewHeader.getAttribute('aria-expanded')) !== 'true') await reviewHeader.click();
    await page.getByLabel(/I confirm this is a separate separation event/).check();
  }
  await reach(page.getByRole('button', { name: 'Create draft case' }));
  await page.keyboard.press('Enter');
  const banner = page.getByText(/Draft case OFF-\d{4}-\d{4,}(?:-\d)? created/);
  // A freshly rebuilt environment compiles the create action on first use;
  // give the first creation of a run the time a cold server needs.
  await expect(banner).toBeVisible({ timeout: 120_000 });
  const text = (await banner.textContent()) ?? '';
  const number = CASE_NUMBER.exec(text)![0];
  const warning = /Warning: (.*)$/.exec(text)?.[1] ?? null;
  return { url: page.url().split('?')[0]!, number, banner: text, duplicateWarning: warning };
}

// --- approval, assignment, activation ------------------------------------

export async function approveCase(page: Page, caseUrl: string): Promise<string> {
  await page.goto(caseUrl);
  const fb = await act(
    page,
    page.getByRole('button', { name: 'Approve case and capture snapshot' }),
  );
  if (!fb.ok || !/Case approved/.test(fb.ok))
    throw new Error(`approve: ${fb.err ?? fb.ok ?? 'no feedback'}`);
  return fb.ok;
}

export interface AssignmentOutcome {
  officerLabel: string;
  directoryManager: string;
  managerRouting: string;
  managerChoice: string | null;
  managerKept: boolean;
  blockersBefore: string[];
  confirmations: string[];
}

/**
 * Assign the HR Officer, route the departure notice, confirm the six
 * confirmations. Where the platform resolved the manager, nothing is
 * overridden. Where it asks for an alternate, the directory manager (by the
 * name the case holds) is chosen when offered, so the departure notice is
 * still routed to the real manager; only failing that is the first person
 * offered used, and the outcome says so.
 */
export async function completeAssignmentPlan(
  page: Page,
  caseUrl: string,
  officerLabel = 'HR Officer',
  directoryManager = '',
): Promise<AssignmentOutcome> {
  await page.goto(`${caseUrl}/workflow`);
  const text = await mainText(page);
  const blockersBefore = Array.from(
    text.matchAll(
      /(HR Officer not assigned[^.]*\.|Directory manager "[^"]*" has no active application account[^.]*\.|No manager on record[^.]*\.|No ACTIVE workflow definition[^.]*\.)/g,
    ),
  ).map((m) => m[1]!);

  // HR Officer.
  const officerSummary = page.locator('details.action > summary', {
    hasText: /Assign HR Officer|Reassign HR Officer/,
  });
  if ((await officerSummary.count()) > 0) {
    await officerSummary.first().click();
    const option = page.locator('#of-user option', { hasText: officerLabel }).first();
    const value = await option.getAttribute('value');
    await page.locator('#of-user').selectOption(value!);
    await page
      .locator('#of-reason')
      .fill('Offboarding regression run: operational officer for the test case.');
    const fb = await act(page, page.getByRole('button', { name: /Assign officer|Reassign case/ }));
    if (!fb.ok) throw new Error(`assign officer: ${fb.err ?? 'no feedback'}`);
  }

  // Manager routing: only if the platform says one is needed.
  let managerChoice: string | null = null;
  let managerKept = false;
  const needsAlternate = /has no active application account|No manager on record/.test(text);
  if (needsAlternate) {
    const alt = page.locator('details.action > summary', { hasText: 'Assign alternate manager' });
    if ((await alt.count()) > 0) {
      await alt.first().click();
      const options = page.locator('#am-user option');
      const labels = await options.allTextContents();
      const values = await options.evaluateAll((els) =>
        els.map((e) => (e as HTMLOptionElement).value),
      );
      let pick = -1;
      if (directoryManager) {
        const wanted = directoryManager.trim().toLowerCase();
        pick = labels.findIndex((l) => l.trim().toLowerCase().startsWith(wanted));
      }
      managerKept = pick >= 0;
      if (pick < 0) pick = labels.findIndex((_, i) => values[i] !== '');
      if (pick >= 0) {
        await page.locator('#am-user').selectOption(values[pick]!);
        managerChoice = labels[pick]!.trim();
        await page
          .locator('#am-reason')
          .fill(
            managerKept
              ? 'Offboarding regression run: directory manager routed as the departure-notice recipient (no application account needed).'
              : 'Offboarding regression run: directory manager not offered; first routable person recorded for the test case.',
          );
        const fb = await act(page, page.getByRole('button', { name: 'Record alternate manager' }));
        if (!fb.ok) throw new Error(`alternate manager: ${fb.err ?? 'no feedback'}`);
      }
    }
  }

  // Confirmations.
  const confirmations: string[] = [];
  for (const box of await page.locator('input[name="confirmations"]').all()) {
    const id = await box.getAttribute('id');
    const label = id
      ? await page
          .locator(`label[for="${id}"]`)
          .first()
          .textContent()
          .catch(() => null)
      : null;
    confirmations.push((label ?? (await box.getAttribute('value')) ?? '').trim());
    if (!(await box.isChecked())) await box.check();
  }
  const fb = await act(page, page.getByRole('button', { name: 'Confirm assignment plan' }));
  if (!fb.ok || !/Assignment plan confirmed/.test(fb.ok))
    throw new Error(`confirm plan: ${fb.err ?? fb.ok ?? 'no feedback'}`);

  const after = await mainText(page);
  const managerRouting =
    /Receives the Departure Notice\s*([^]*?)(?:Confirmed|HR Ownership)/
      .exec(after)?.[1]
      ?.trim()
      .slice(0, 120) ?? '';
  return {
    officerLabel,
    directoryManager,
    managerRouting,
    managerChoice,
    managerKept,
    blockersBefore,
    confirmations,
  };
}

export async function activateCase(page: Page, caseUrl: string): Promise<string> {
  await page.goto(`${caseUrl}/workflow`);
  const fb = await act(
    page,
    page.getByRole('button', { name: 'Activate case and create these tasks' }),
    60_000,
  );
  if (!fb.ok || !/Case activated/.test(fb.ok))
    throw new Error(`activate: ${fb.err ?? fb.ok ?? 'no feedback'}`);
  return fb.ok;
}

// --- benefits, assets, email actions ---------------------------------------

export async function confirmBenefits(
  page: Page,
  caseUrl: string,
  health: 'YES' | 'NO' | 'UNKNOWN',
  life: 'YES' | 'NO' | 'UNKNOWN',
): Promise<string> {
  await page.goto(caseUrl);
  const details = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Confirm which benefits apply' }) })
    .first();
  await expect(details).toBeVisible();
  const isOpen = await details.evaluate((d) => (d as HTMLDetailsElement).open);
  if (!isOpen) await details.locator('summary').click();
  await page.locator('#ben-health').selectOption(health);
  await page.locator('#ben-life').selectOption(life);
  const fb = await act(page, page.getByRole('button', { name: 'Confirm applicability' }));
  if (!fb.ok || !/Benefits applicability confirmed/.test(fb.ok))
    throw new Error(`benefits: ${fb.err ?? fb.ok ?? 'no feedback'}`);
  return fb.ok;
}

export async function tickAssets(
  page: Page,
  caseUrl: string,
  picks: Array<{ type: string; identifier: string }>,
): Promise<{ ticked: number; feedback: Feedback }> {
  await page.goto(`${caseUrl}/assets`);
  let ticked = 0;
  for (const p of picks) {
    const box = page.locator(
      `input[type="checkbox"][name="assetType"][value=${JSON.stringify(p.type)}]`,
    );
    if ((await box.count()) === 0) continue;
    await box.check();
    const ident = page.locator(`input[name=${JSON.stringify(`identifier.${p.type}`)}]`);
    if ((await ident.count()) > 0) await ident.fill(p.identifier);
    ticked += 1;
  }
  let feedback: Feedback = { ok: null, err: null };
  if (ticked > 0) {
    feedback = await act(page, page.getByRole('button', { name: 'Add the ticked assets' }));
  }
  return { ticked, feedback };
}

/** Record a disposition on the first actionable asset row (retrying re-renders). */
export async function recordFirstAssetOutcome(
  page: Page,
  status: string,
  reason?: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.waitForTimeout(500);
      const summary = page
        .locator('details.action > summary', { hasText: 'Record outcome' })
        .first();
      if ((await summary.count()) === 0) return false;
      await summary.click({ timeout: 5000 });
      const details = page
        .locator('details[open]', { has: page.locator('select[name="status"]') })
        .first();
      await details.locator('select[name="status"]').selectOption(status, { timeout: 4000 });
      if (reason) await details.locator('input[name="reason"]').fill(reason, { timeout: 4000 });
      const fb = await act(page, details.getByRole('button', { name: 'Record', exact: true }));
      if (fb.ok && /Asset status recorded/.test(fb.ok)) return true;
      throw new Error(fb.err ?? 'no feedback');
    } catch (e) {
      if (attempt === 3) throw e;
      await page.reload();
    }
  }
  return false;
}

/** Release every email action waiting on HR review; returns how many. */
export async function releaseWaitingEmailActions(page: Page, caseUrl: string): Promise<number> {
  await page.goto(`${caseUrl}/notifications`);
  let released = 0;
  for (let i = 0; i < 8; i++) {
    const release = page.getByRole('button', { name: /Review and release/ }).first();
    if ((await release.count()) === 0) break;
    const fb = await act(page, release);
    if (!fb.ok || !/Released/.test(fb.ok)) break;
    released += 1;
  }
  return released;
}

export async function runOutboxPass(page: Page): Promise<string> {
  await page.goto('/admin/outbox');
  const fb = await act(page, page.getByRole('button', { name: 'Run outbox pass now' }));
  return fb.ok ?? fb.err ?? '';
}

export async function recordItEvidence(
  page: Page,
  caseUrl: string,
  note: string,
): Promise<boolean> {
  await page.goto(`${caseUrl}/notifications`);
  const section = page.locator('section[aria-label="IT access removal email action"]');
  if ((await section.count()) === 0) return false;
  const summary = section.locator('details.action > summary', { hasText: 'Record evidence' });
  if ((await summary.count()) === 0) return false;
  await summary.click();
  await section.locator('select[name="kind"]').selectOption('COMPLETED');
  await section.locator('textarea[name="note"]').fill(note);
  const fb = await act(page, section.getByRole('button', { name: 'Record evidence' }));
  return !!fb.ok && /evidence recorded/i.test(fb.ok);
}

// --- documents and action form ----------------------------------------------

export async function createResignationLetter(
  page: Page,
  caseUrl: string,
  address: string,
): Promise<string[]> {
  const log: string[] = [];
  await page.goto(`${caseUrl}/documents`);
  const create = page.getByRole('button', { name: 'Create resignation document draft' });
  if ((await create.count()) === 0) return ['no create control'];
  let fb = await act(page, create);
  log.push(`create: ${fb.ok ?? fb.err}`);
  if (!fb.ok) return log;
  const addr = page.getByLabel(/Employee Address/);
  if ((await addr.count()) > 0) {
    await addr.first().fill(address);
    fb = await act(page, page.getByRole('button', { name: 'Save address' }));
    log.push(`address: ${fb.ok ?? fb.err}`);
  }
  const refresh = page.getByRole('button', { name: 'Refresh fields from case' });
  if ((await refresh.count()) > 0) {
    fb = await act(page, refresh);
    log.push(`refresh: ${fb.ok ?? fb.err}`);
  }
  fb = await act(page, page.getByRole('button', { name: 'Validate and submit for approval' }));
  log.push(`submit: ${fb.ok ?? fb.err}`);
  return log;
}

export async function approveDocument(page: Page, caseUrl: string): Promise<string> {
  await page.goto(`${caseUrl}/documents`);
  const fb = await act(
    page,
    page.getByRole('button', { name: 'Approve exact version (attested)' }),
    60_000,
  );
  if (!fb.ok || !/approved/i.test(fb.ok))
    throw new Error(`approve document: ${fb.err ?? fb.ok ?? 'no feedback'}`);
  return fb.ok;
}

export async function documentPdfHrefs(page: Page, caseUrl: string): Promise<string[]> {
  await page.goto(`${caseUrl}/documents`);
  return page
    .locator('a[href*="/api/documents/"][href$="/pdf"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
}

export async function sendLetterByEmail(page: Page, caseUrl: string): Promise<string> {
  await page.goto(`${caseUrl}/documents`);
  const summary = page.locator('details.action > summary', {
    hasText: 'Send to the employee by email',
  });
  if ((await summary.count()) === 0) return 'no send control';
  await summary.first().click();
  const send = page.getByRole('button', { name: 'Send letter' });
  if ((await send.count()) === 0) return 'no send button';
  const fb = await act(page, send);
  return fb.ok ?? fb.err ?? 'no feedback';
}

export async function completeActionForm(page: Page, caseUrl: string): Promise<string[]> {
  const log: string[] = [];
  await page.goto(`${caseUrl}/action-form`);
  const create = page.getByRole('button', { name: 'Create action form' });
  if ((await create.count()) > 0) {
    const fb = await act(page, create);
    log.push(`create: ${fb.ok ?? fb.err}`);
  }
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
    const box = page.locator(`#hr-${key}-DONE`);
    if ((await box.count()) > 0) await box.check();
  }
  if ((await page.locator('#ackStatus').count()) > 0) {
    await page.locator('#ackStatus').selectOption('NOT_OBTAINED');
    await page
      .locator('#ackReason')
      .fill('Regression run: acknowledgement not collected for a test case.');
  }
  let fb = await act(page, page.getByRole('button', { name: 'Save HR section' }));
  log.push(`save: ${fb.ok ?? fb.err}`);
  fb = await act(page, page.getByRole('button', { name: 'Finish preparation (ready for review)' }));
  log.push(`finish: ${fb.ok ?? fb.err}`);
  const complete = page.getByRole('button', {
    name: 'Complete action form (attested, renders final PDF)',
  });
  if ((await complete.count()) === 0) {
    log.push('complete: control not offered');
    return log;
  }
  fb = await act(page, complete, 60_000);
  log.push(`complete: ${fb.ok ?? fb.err}`);
  return log;
}

export async function actionFormPdfHref(page: Page, caseUrl: string): Promise<string | null> {
  await page.goto(`${caseUrl}/action-form`);
  const a = page.locator('a[href*="/api/action-forms/"][href$="/pdf"]').first();
  if ((await a.count()) === 0) return null;
  return a.getAttribute('href');
}

// --- tasks --------------------------------------------------------------------

export interface TaskLinkInfo {
  title: string;
  href: string;
}

export async function listTaskLinks(page: Page, caseUrl: string): Promise<TaskLinkInfo[]> {
  await page.goto(`${caseUrl}/workflow`);
  return page.locator('a[href^="/tasks/"]').evaluateAll((els) =>
    els.map((e) => ({
      title: (e.textContent ?? '').trim(),
      href: (e as HTMLAnchorElement).getAttribute('href') ?? '',
    })),
  );
}

/** Complete one task page with evidence; returns what happened. */
export async function completeTaskPage(page: Page, href: string, note: string): Promise<string> {
  await page.goto(href);
  const start = page.getByRole('button', { name: 'Start task' });
  if ((await start.count()) > 0) {
    const fb = await act(page, start);
    if (fb.err) return `start refused: ${fb.err.slice(0, 160)}`;
  }
  const summary = page.locator('details.action > summary', { hasText: 'Complete with evidence' });
  if ((await summary.count()) === 0) {
    const t = await mainText(page);
    if (/Completed/.test(t)) return 'already-completed';
    return `not-completable (${/Blocked|blocked/.test(t) ? 'blocked' : 'no completion control'})`;
  }
  const isOpen = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
  if (!isOpen) await summary.click();
  await page.locator('#c-note').fill(note);
  const fb = await act(page, page.getByRole('button', { name: 'Complete task' }));
  if (fb.ok && /Task completed/.test(fb.ok)) return 'completed';
  return `refused: ${(fb.err ?? fb.ok ?? 'no feedback').slice(0, 160)}`;
}

// --- survey, clearance ---------------------------------------------------------

export async function issueSurveyLink(
  page: Page,
  caseUrl: string,
): Promise<{ link: string | null; notes: string[] }> {
  const notes: string[] = [];
  await page.goto(`${caseUrl}/survey`);
  const create = page.getByRole('button', { name: 'Create survey invitation' });
  if ((await create.count()) > 0) {
    const fb = await act(page, create);
    notes.push(`Invitation created by HR: ${fb.ok ?? fb.err}`);
  } else {
    notes.push('Invitation already present (prepared by the platform).');
  }
  const gen = page.getByRole('button', { name: 'Generate secure link' });
  if ((await gen.count()) === 0) {
    const t = await mainText(page);
    notes.push(`No "Generate secure link" control: ${t.slice(0, 200)}`);
    return { link: null, notes };
  }
  await act(page, gen);
  await expect(page.getByText('Secure Invitation Link (Shown Once)')).toBeVisible();
  const link = (await page.locator('code').first().textContent())?.trim() ?? null;
  const fb = await act(page, page.getByRole('button', { name: 'Record manually sent' }));
  notes.push(`Link generated once; ${fb.ok ?? fb.err}`);
  return { link, notes };
}

export async function completeSurveyAsEmployee(
  browser: Browser,
  link: string,
): Promise<{ ok: boolean; text: string; pageUrl: string }> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await p.goto(link);
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    const radio4 = p.getByRole('radio', { name: '4' }).first();
    if ((await radio4.count()) > 0) await radio4.check();
    const opp = p.getByRole('radio', { name: 'Another opportunity' });
    if ((await opp.count()) > 0) await opp.check();
    const unsure = p.getByRole('radio', { name: 'Unsure' });
    if ((await unsure.count()) > 0) await unsure.check();
    const submit = p.getByRole('button', { name: 'Submit survey' });
    if ((await submit.count()) === 0) return { ok: false, text, pageUrl: p.url() };
    await submit.click();
    await p.waitForURL('**/survey/thanks', { timeout: 20_000 });
    return { ok: true, text, pageUrl: p.url() };
  } finally {
    await ctx.close();
  }
}

export interface PublicPageProbe {
  url: string;
  status: number | null;
  heading: string;
  text: string;
}

export async function probePublicPage(browser: Browser, url: string): Promise<PublicPageProbe> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const resp = await p.goto(url);
    const heading =
      (await p
        .locator('h1')
        .first()
        .textContent()
        .catch(() => '')) ?? '';
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    return { url: p.url(), status: resp?.status() ?? null, heading: heading.trim(), text };
  } finally {
    await ctx.close();
  }
}

export async function completeReturnChecklist(
  browser: Browser,
  link: string,
  employeeName: string,
  screenshot: (p: Page, name: string) => Promise<unknown>,
): Promise<{ submitted: boolean; heading: string; text: string; rows: number }> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await p.goto(link);
    const heading =
      (await p
        .locator('h1')
        .first()
        .textContent()
        .catch(() => '')) ?? '';
    await screenshot(p, 'employee_checklist_link_page');
    const rows = p.getByRole('row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const returned = rows.nth(i).getByRole('radio', { name: 'Returned', exact: true });
      const na = rows.nth(i).getByRole('radio', { name: /Not applicable/i });
      if ((await returned.count()) > 0) {
        if (i % 2 === 0) await returned.check();
        else if ((await na.count()) > 0) await na.check();
        else await returned.check();
      }
    }
    const receivedBy = p.getByLabel('Items Received By');
    if ((await receivedBy.count()) > 0) await receivedBy.fill('HR Officer (regression run)');
    const yourName = p.getByLabel('Your Name');
    if ((await yourName.count()) > 0) await yourName.fill(employeeName);
    await screenshot(p, 'employee_checklist_completed');
    const submit = p.getByRole('button', { name: 'Submit Checklist' });
    if ((await submit.count()) === 0) {
      return {
        submitted: false,
        heading: heading.trim(),
        text: (await p.locator('body').innerText()).replace(/\s+/g, ' '),
        rows: n,
      };
    }
    // The action answers with its own marker (?done=1, ?err=, ?retry=1). A
    // click that never reached the server leaves the form on screen, so the
    // submission is retried a few times rather than assumed.
    let submitted = false;
    let text = '';
    for (let attempt = 0; attempt < 3 && !submitted; attempt++) {
      const before = p.url();
      await submit.click();
      await p
        .waitForFunction((b) => location.href !== b, before, { timeout: 30_000 })
        .catch(() => null);
      await p.waitForLoadState('load');
      text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
      submitted = /[?&]done=1/.test(p.url()) || /has been recorded/i.test(text);
      if (!submitted && /[?&]retry=1/.test(p.url())) await p.waitForTimeout(65_000);
      if (!submitted && (await submit.count()) === 0) break;
    }
    await screenshot(p, 'employee_checklist_after_submit');
    return { submitted, heading: heading.trim(), text, rows: n };
  } finally {
    await ctx.close();
  }
}

export async function acknowledgeLink(
  browser: Browser,
  link: string,
  screenshot?: (p: Page, name: string) => Promise<unknown>,
): Promise<{ heading: string; outcome: string; caseRefShown: string | null }> {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await p.goto(link);
    const heading = (
      (await p
        .locator('h1')
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    ).trim();
    const before = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    const caseRefShown = /Case reference:\s*(OFF-[\d-]+)/.exec(before)?.[1] ?? null;
    if (screenshot) await screenshot(p, 'acknowledgement_link_page');
    const button = p.getByRole('button', {
      name: /Acknowledge receipt|Confirm the action is completed/,
    });
    if ((await button.count()) === 0)
      return { heading, outcome: before.slice(0, 200), caseRefShown };
    await button.click();
    await p.waitForLoadState('load');
    const after = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    return { heading, outcome: after.slice(0, 200), caseRefShown };
  } finally {
    await ctx.close();
  }
}

export async function clearanceGate(
  page: Page,
  caseUrl: string,
): Promise<{ ready: boolean; text: string }> {
  await page.goto(`${caseUrl}/clearance`);
  const text = await mainText(page);
  return { ready: /All conditions met/.test(text) && !/Not ready/.test(text), text };
}

export async function requestClearance(page: Page, caseUrl: string): Promise<string> {
  await page.goto(`${caseUrl}/clearance`);
  const button = page.getByRole('button', { name: 'Request clearance review' });
  if ((await button.count()) === 0) return 'no-button';
  const fb = await act(page, button);
  if (fb.ok && /clearance review/i.test(fb.ok)) return 'requested';
  return `refused: ${(fb.err ?? fb.ok ?? 'no feedback').slice(0, 200)}`;
}

export async function approveClearance(page: Page, caseUrl: string): Promise<string> {
  await page.goto(`${caseUrl}/clearance`);
  const button = page.getByRole('button', { name: 'Approve final clearance' });
  if ((await button.count()) === 0) return 'no-button';
  const fb = await act(page, button, 60_000);
  const text = await mainText(page);
  return /Completed/.test(text)
    ? 'completed'
    : `not-completed: ${(fb.err ?? fb.ok ?? text).slice(0, 200)}`;
}
