/**
 * Deterministic synthetic seed (REQ-SEC-031, BR-GOV-004).
 *
 * Everything here is fictional. Users exist for the guarded development role
 * switcher; the holiday calendar is clearly synthetic TEST data because the
 * production calendar is not approved (DEC-027 PROVISIONAL); reason
 * categories are TEST-ONLY because DEC-031 is OPEN (IC-S1-008).
 */
import { loadRootEnvFile } from '@exit/config';
loadRootEnvFile(import.meta.dirname);

const { getPrisma } = await import('./client.ts');

const prisma = getPrisma();

const DEV_USERS: ReadonlyArray<{ slug: string; name: string; email: string; roles: string[] }> = [
  {
    slug: 'hr-manager',
    name: 'Dana Field',
    email: 'dana.field@example.test',
    roles: ['HR_MANAGER'],
  },
  {
    slug: 'hr-officer',
    name: 'Riley Okafor',
    email: 'riley.okafor@example.test',
    roles: ['HR_OFFICER'],
  },
  {
    slug: 'it-responder',
    name: 'Sam Chen',
    email: 'sam.chen@example.test',
    roles: ['IT_RESPONDER'],
  },
  {
    slug: 'finance-responder',
    name: 'Alex Romero',
    email: 'alex.romero@example.test',
    roles: ['FINANCE_RESPONDER'],
  },
  {
    slug: 'line-manager',
    name: 'Jamie Douglas',
    email: 'jamie.douglas@example.test',
    roles: ['LINE_MANAGER'],
  },
  {
    slug: 'auditor',
    name: 'Quinn Baptiste',
    email: 'quinn.baptiste@example.test',
    roles: ['AUDITOR'],
  },
  {
    slug: 'privacy-officer',
    name: 'Rowan Silvera',
    email: 'rowan.silvera@example.test',
    roles: ['PRIVACY_OFFICER'],
  },
  {
    slug: 'system-admin',
    name: 'Marley Thompson',
    email: 'marley.thompson@example.test',
    roles: ['SYSTEM_ADMIN'],
  },
];

const FEATURE_FLAGS: ReadonlyArray<{ key: string; description: string }> = [
  {
    key: 'automation.letterGeneration',
    description: 'Stage 2: controlled letter generation (disabled in Stage 1).',
  },
  {
    key: 'automation.surveyInvitations',
    description: 'Stage 2: post-departure survey scheduling (disabled in Stage 1).',
  },
  {
    key: 'automation.notifications',
    description: 'Stage 5: notification dispatch (disabled in Stage 1).',
  },
  {
    key: 'automation.remindersEscalation',
    description: 'Stage 3: reminders and escalation (disabled in Stage 1).',
  },
];

const INTEGRATIONS: ReadonlyArray<{ key: string; displayName: string; notes: string }> = [
  {
    key: 'IDENTITY',
    displayName: 'Identity provider (SSO)',
    notes: 'DEC-021 OPEN: dev login only; no production IdP selected.',
  },
  {
    key: 'BAMBOOHR',
    displayName: 'BambooHR employee source',
    notes: 'DEC-018: synthetic adapter only in Stage 1.',
  },
  {
    key: 'EMAIL',
    displayName: 'Email provider',
    notes: 'DEC-020 OPEN: sink adapter only; no live send.',
  },
  {
    key: 'OBJECT_STORAGE',
    displayName: 'Object storage',
    notes: 'Local development adapter; production storage undecided (DEC-022).',
  },
  {
    key: 'SCANNER',
    displayName: 'Malware scanner',
    notes: 'No scanner in Stage 1: uploads quarantine unless dev-passthrough.',
  },
];

// Clearly synthetic holidays - NOT the approved Jamaica public-holiday list.
const TEST_HOLIDAYS: ReadonlyArray<{ date: string; label: string }> = [
  { date: '2026-08-03', label: 'TEST holiday A (synthetic)' },
  { date: '2026-08-06', label: 'TEST holiday B (synthetic)' },
  { date: '2026-12-25', label: 'TEST holiday C (synthetic)' },
];

const TEST_REASONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'TEST-REASON-A', label: 'TEST ONLY - Category A (placeholder until DEC-031)' },
  { code: 'TEST-REASON-B', label: 'TEST ONLY - Category B (placeholder until DEC-031)' },
];

async function main(): Promise<void> {
  for (const u of DEV_USERS) {
    const user = await prisma.user.upsert({
      where: { identitySubject: `dev|${u.slug}` },
      create: {
        identitySubject: `dev|${u.slug}`,
        displayName: u.name,
        workEmail: u.email,
      },
      update: { displayName: u.name, workEmail: u.email, isActive: true },
    });
    for (const role of u.roles) {
      const existing = await prisma.roleAssignment.findFirst({
        where: { userId: user.id, role: role as never, revokedAt: null },
      });
      if (!existing) {
        await prisma.roleAssignment.create({
          data: {
            userId: user.id,
            role: role as never,
            reason: 'Synthetic development seed (Stage 1).',
          },
        });
      }
    }
  }

  for (const f of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      create: { key: f.key, description: f.description, enabled: false },
      update: { description: f.description }, // never silently enable
    });
  }

  for (const i of INTEGRATIONS) {
    await prisma.integrationPlaceholder.upsert({
      where: { key: i.key },
      create: { key: i.key, displayName: i.displayName, notes: i.notes },
      update: { displayName: i.displayName, notes: i.notes, configured: false, mode: 'stub' },
    });
  }

  const activeCal = await prisma.holidayCalendar.findFirst({ where: { isActive: true } });
  if (!activeCal) {
    await prisma.holidayCalendar.create({
      data: {
        name: 'synthetic-dev-calendar',
        version: 1,
        isActive: true,
        holidays: { create: TEST_HOLIDAYS.map((h) => ({ date: h.date, label: h.label })) },
      },
    });
  }

  for (const r of TEST_REASONS) {
    await prisma.reasonCategory.upsert({
      where: { code: r.code },
      create: {
        code: r.code,
        label: r.label,
        taxonomyVersion: 0,
        isActive: true,
        isTestOnly: true,
      },
      update: { label: r.label, isTestOnly: true },
    });
  }

  const departments = ['Sales', 'Warehouse', 'Finance', 'Service', 'IT', 'Administration'];
  const locations = ['Kingston', 'Montego Bay'];
  const sysAdmin = await prisma.user.findUnique({ where: { identitySubject: 'dev|hr-manager' } });
  for (const d of departments) {
    await prisma.configListItem.upsert({
      where: { kind_value: { kind: 'DEPARTMENT', value: d } },
      create: { kind: 'DEPARTMENT', value: d, createdById: sysAdmin!.id },
      update: { isActive: true },
    });
  }
  for (const l of locations) {
    await prisma.configListItem.upsert({
      where: { kind_value: { kind: 'LOCATION', value: l } },
      create: { kind: 'LOCATION', value: l, createdById: sysAdmin!.id },
      update: { isActive: true },
    });
  }

  console.log(
    'Seed complete: synthetic users, flags (all disabled), calendar, reasons, org lists.',
  );
}

await main();
await prisma.$disconnect();
