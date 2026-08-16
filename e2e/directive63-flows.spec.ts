/**
 * Directive 6.3 acceptance: the HR daily journey on the HR-validated model.
 *
 * IT and Finance participate through automated controlled email notifications
 * (case "Email actions" tab, development mailbox, secure no-login /ack links)
 * instead of application sign-ins; the case Overview leads with the
 * exception-first "Required actions" panel and the "Benefits & providers"
 * confirmation; notification templates are versioned under
 * /admin/notification-templates.
 *
 * Prerequisite: seeded development database. The stakeholder UAT dataset
 * (scripts/uat-stakeholder-seed.ts) provides ACTIVE OFF-2026-* TEST cases;
 * assertions stay state-tolerant because seed states vary between runs.
 * Synthetic data only.
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

/** Business-language email-action statuses (Directive 6.3 correction 7). */
const BUSINESS_STATUS =
  /Scheduled|Sent|Needs your review|Recipient required|Being prepared|Acknowledged|Completed|Sent manually|Ready to send manually|Cancelled|Could not send|Superseded/;

/**
 * Open an ACTIVE TEST case whose Overview carries the Directive 6.3
 * "Required actions" panel (a v2/HR-validated case). Returns after
 * navigating to the case Overview.
 */
async function openActiveHrValidatedCase(page: Page): Promise<void> {
  await page.goto('/cases?status=ACTIVE&recordPurpose=TEST');
  const links = page.locator('table a[href*="/cases/"]');
  await expect(links.first()).toBeVisible();
  const hrefs = (
    await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')))
  ).filter((h): h is string => !!h && /\/cases\/[^/]+$/.test(h));
  for (const href of hrefs.slice(0, 5)) {
    await page.goto(href);
    if ((await page.getByRole('heading', { name: 'Required actions' }).count()) > 0) return;
  }
  // Fall back to the first case; the assertions below give the real failure.
  await page.goto(hrefs[0]!);
}

test('HR manager reviews an active case: required actions, benefits, email actions', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInAs(page, 'HR Manager');
  await openActiveHrValidatedCase(page);
  await expect(page.getByRole('heading', { name: /OFF-\d{4}-\d{4}/ }).first()).toBeVisible();

  // Exception-first Overview (Directive 6.3 Z): the Required actions panel
  // groups work into "Requires your attention" and "In progress
  // automatically" (either group may be empty depending on seed state).
  await expect(page.getByRole('heading', { name: 'Required actions' })).toBeVisible();
  await expect(
    page
      .getByRole('heading', { name: 'Requires your attention' })
      .or(page.getByText('Nothing needs your attention on this case.'))
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('heading', { name: 'In progress automatically' })
      .or(page.getByRole('heading', { name: 'Requires your attention' }))
      .first(),
  ).toBeVisible();

  // Benefits & providers confirmation section (Directive 6.3 V).
  await expect(page.getByRole('heading', { name: 'Benefits & providers' })).toBeVisible();
  await expect(page.getByText('Group health').first()).toBeVisible();
  await expect(page.getByText('Group life').first()).toBeVisible();

  // The Email actions tab (CaseNav link "Notifications") lists the automated
  // department/provider emails in business language - never enum names.
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('link', { name: 'Notifications' })
    .click();
  await expect(page.getByRole('heading', { name: /Email actions/ })).toBeVisible();
  const actionSections = page.locator('section[aria-label$="email action"]');
  await expect(actionSections.first()).toBeVisible();
  await expect(actionSections.first().locator('.badge').first()).toHaveText(BUSINESS_STATUS);
  await signOut(page);
});

test('no-login acknowledgement links: captured email link works logged out; invalid stays neutral', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);

  // HR reads the captured emails in the development mailbox.
  await signInAs(page, 'HR Manager');
  await page.goto('/dev/mailbox');
  await expect(page.getByText('DEVELOPMENT CAPTURE ONLY')).toBeVisible();
  const mailboxHtml = await page.content();
  const ackMatch = /\/ack\/[A-Za-z0-9_-]{43}/.exec(mailboxHtml);
  await signOut(page);

  // The department acts WITHOUT any sign-in: the secure link renders either
  // the acknowledge/confirm page (live token) or the neutral message (used or
  // expired token) - both are correct; seed state varies between runs.
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  if (ackMatch) {
    await publicPage.goto(ackMatch[0]);
    await expect(
      publicPage
        .getByRole('button', { name: /Acknowledge receipt|Confirm the action is completed/ })
        .or(publicPage.getByText(/not valid|Already recorded/))
        .first(),
    ).toBeVisible();
    // Whatever the state, no case content beyond the email's own reference
    // ever appears (minimum data; neutral failures).
    await expect(publicPage.getByText('TERMINATION')).toHaveCount(0);
  }

  // An invalid token is answered neutrally - no reason is disclosed.
  await publicPage.goto('/ack/invalidtokenvalue0000000000000000000000000000');
  await expect(publicPage.getByText(/This link is not valid/)).toBeVisible();
  await publicContext.close();
});

test('notification template administration: versioned register and drafting form', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInAs(page, 'HR Manager');
  await page.goto('/admin/notification-templates');
  await expect(page.getByRole('heading', { name: 'Notification templates' })).toBeVisible();

  // The seeded register lists versioned templates per notification type (an
  // empty register announces itself instead of rendering a dead page).
  await expect(
    page
      .getByRole('columnheader', { name: 'Version' })
      .first()
      .or(page.getByText('No notification template versions exist yet.'))
      .first(),
  ).toBeVisible();

  // Officers/managers draft new versions; activation is management-grade.
  const draft = page.locator('details.action > summary', { hasText: 'Draft a new version' });
  await expect(draft).toBeVisible();
  await draft.click();
  await expect(page.getByLabel('Notification type')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create draft version' })).toBeVisible();
  await signOut(page);
});
