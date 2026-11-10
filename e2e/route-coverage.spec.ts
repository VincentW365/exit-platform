/**
 * Route-coverage gap-proofing (owner request): every page in the application
 * renders for every representative role without a server error or a dead
 * screen. A route may show its content OR a polite authorization denial -
 * never a 500, never the error boundary, never an empty shell. This is the
 * "no missing forms, no broken pages after deployment" guarantee.
 */
import { expect, test, type Page } from '@playwright/test';

const STATIC_ROUTES = [
  '/',
  '/cases',
  '/cases/new',
  '/queue',
  '/exceptions',
  '/directory',
  '/reports',
  '/baseline',
  '/audit',
  '/operations',
  '/support',
  '/continuity',
  '/dev/mailbox',
  '/admin',
  '/admin/system',
  '/admin/health',
  '/admin/pilot',
  '/admin/privacy',
  '/admin/recipients',
  '/admin/outbox',
  '/admin/reasons',
  '/admin/templates',
  // Directive 6.3 Q: versioned notification templates. HR roles see the
  // register; everyone else is politely redirected to /admin by the guard.
  '/admin/notification-templates',
  '/admin/workflows',
  '/admin/organization',
  '/unauthorized',
];

// DEC-063: exactly two application roles exist - the HR Manager and the HR
// Officer - and together they cover every reachable surface. (Note: the
// /queue page heading is now "My work".)
const ROLES = ['HR Manager', 'HR Officer'];

async function assertHealthy(page: Page, label: string): Promise<void> {
  // The global error boundary and Next's static error page must never show.
  await expect(page.getByRole('heading', { name: 'Something Went Wrong' }), label).toHaveCount(0);
  await expect(
    page.getByText('Application error: a client-side exception has occurred'),
    label,
  ).toHaveCount(0);
  // Every page renders a heading (content or a denial screen with a heading).
  expect(await page.locator('h1, h2').count(), `${label}: no heading rendered`).toBeGreaterThan(0);
}

test('every route renders for every role (no dead pages)', async ({ page }) => {
  test.setTimeout(600_000);
  for (const role of ROLES) {
    await page.goto('/signin');
    await page.getByRole('button', { name: `Sign in as ${role}`, exact: true }).click();
    await page.waitForURL('**/');
    for (const route of STATIC_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${role} ${route} HTTP status`).toBeLessThan(500);
      await assertHealthy(page, `${role} ${route}`);
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/signin');
  }
});

test('every case tab renders for the HR Manager on a real case', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Sign in as HR Manager', exact: true }).click();
  await page.waitForURL('**/');
  await page.goto('/cases');
  const firstCase = page.locator('.rows a[href*="/cases/"]').first();
  await expect(firstCase).toBeVisible();
  await firstCase.click();
  await page.waitForURL('**/cases/**');
  const caseUrl = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
  const tabs = [
    '',
    '/assignment',
    '/documents',
    '/action-form',
    '/workflow',
    '/assets',
    '/clearance',
    '/notifications', // titled "Email actions" since Directive 6.3
    '/survey',
  ];
  for (const tab of tabs) {
    const response = await page.goto(`${caseUrl}${tab}`);
    expect(response?.status(), `case tab ${tab || '(overview)'} HTTP status`).toBeLessThan(500);
    await assertHealthy(page, `case tab ${tab || '(overview)'}`);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/signin');
});
