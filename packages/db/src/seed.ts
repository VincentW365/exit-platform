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
  // Directive 6.1 (B/F): synthetic directory managers get application
  // accounts (matching workEmail) so hierarchy-derived manager routing
  // resolves end-to-end in development without any real data.
  {
    slug: 'ops-manager',
    name: 'Samira Cole',
    email: 'samira.cole@example.test',
    roles: ['LINE_MANAGER'],
  },
  {
    slug: 'warehouse-manager',
    name: 'Rowan Achebe',
    email: 'rowan.achebe@example.test',
    roles: ['LINE_MANAGER'],
  },
  // Disposable second IT responder: the user-deactivation drill (UAT
  // Scenario 11) disables and re-enables this account.
  {
    slug: 'it-responder-b',
    name: 'Devon Temple',
    email: 'devon.temple@example.test',
    roles: ['IT_RESPONDER'],
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

  await seedStage2(prisma);
  const { seedStage3 } = await import('./seedStage3.ts');
  await seedStage3(prisma);
  const { seedStage4 } = await import('./seedStage4.ts');
  await seedStage4(prisma);

  console.log(
    'Seed complete: synthetic users, flags (all disabled), calendar, reasons, org lists, ' +
      'DEV templates, DEV exit survey, DEV workflows, DEV notification templates, synthetic assets.',
  );
}

// --- Stage 2 seeds (Directive 2 B.9 / G) -------------------------------------

async function seedStage2(db: ReturnType<typeof getPrisma>): Promise<void> {
  const hrManager = await db.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-manager' },
  });
  const DEV_MARK = 'DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE';

  const noticeBody = `${DEV_MARK}

[[DOCUMENT_DATE]]

Dear [[EMPLOYEE_LEGAL_NAME]],

We acknowledge receipt of your resignation on [[RESIGNATION_RECEIVED_DATE]] and accept it on behalf of Bert's Auto Parts Ltd. (case [[CASE_REFERENCE]]).

We confirm that your last working day is [[CONFIRMED_LAST_WORKING_DATE]] and that your employment ends effective [[EFFECTIVE_SEPARATION_DATE]].

Human Resources will coordinate the remaining administrative steps of your offboarding with you. Please return any applicable company property on or before your last working day.

If you have any questions, please contact the Human Resources office.

Thank you for your professional service to the company.

Sincerely,

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]`;

  const immediateBody = `${DEV_MARK}

[[DOCUMENT_DATE]]

Dear [[EMPLOYEE_LEGAL_NAME]],

We acknowledge receipt of your resignation on [[RESIGNATION_RECEIVED_DATE]], effective immediately (case [[CASE_REFERENCE]]).

We confirm that your employment ends effective [[EFFECTIVE_SEPARATION_DATE]] at [[EFFECTIVE_SEPARATION_TIME]].

Human Resources will coordinate the remaining administrative steps of your offboarding. Please return any applicable company property promptly; the Human Resources office will contact you regarding arrangements.

If you have any questions, please contact the Human Resources office.

Thank you for your service to the company.

Sincerely,

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]`;

  const seedTemplates = [
    {
      documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
      name: 'DEV Resignation acceptance (with notice)',
      body: noticeBody,
      status: 'ACTIVE',
    },
    {
      documentType: 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT',
      name: 'DEV Immediate resignation acknowledgement',
      body: immediateBody,
      status: 'ACTIVE',
    },
    {
      documentType: 'OFFBOARDING_ACTION_FORM',
      name: 'DEV Offboarding action form (structure v1)',
      body: `${DEV_MARK}\n\nStructured form - sections are defined by the application, not by this template body.`,
      status: 'ACTIVE',
    },
    {
      documentType: 'MANUAL_EXCEPTION_DOCUMENT',
      name: 'Manual exception document (upload-based)',
      body: '',
      status: 'ACTIVE',
    },
    {
      documentType: 'TERMINATION_DOCUMENT_PLACEHOLDER',
      name: 'Termination placeholder (permanently disabled - no content permitted)',
      body: '',
      status: 'DRAFT',
    },
  ] as const;

  const { createHash } = await import('node:crypto');
  for (const t of seedTemplates) {
    const existing = await db.documentTemplate.findFirst({
      where: { documentType: t.documentType, version: 1 },
    });
    if (!existing) {
      await db.documentTemplate.create({
        data: {
          documentType: t.documentType,
          name: t.name,
          version: 1,
          status: t.status,
          contentBody: t.body,
          allowedPlaceholders: [
            ...new Set([...t.body.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map((m) => m[1]!)),
          ],
          contentChecksum: createHash('sha256').update(t.body, 'utf8').digest('hex'),
          changeReason: 'Synthetic development seed (Stage 2).',
          createdById: hrManager.id,
          ...(t.status === 'ACTIVE'
            ? { activatedById: hrManager.id, activatedAt: new Date() }
            : {}),
        },
      });
    }
  }

  const existingSurvey = await db.surveyTemplate.findFirst({
    where: { code: 'exit-survey-dev', version: 1 },
  });
  if (!existingSurvey) {
    await db.surveyTemplate.create({
      data: {
        code: 'exit-survey-dev',
        version: 1,
        status: 'ACTIVE',
        title: 'Exit survey (development)',
        introText:
          'Thank you for taking a few minutes to share feedback about your employment experience. ' +
          'Your answers help the company improve.',
        privacyNotice:
          'Privacy notice: your responses are reviewed by authorized Human Resources personnel. ' +
          'This survey is linked to your offboarding record, so responses are confidential but not anonymous. ' +
          'Free-text answers are optional.',
        createdById: hrManager.id,
        activatedById: hrManager.id,
        activatedAt: new Date(),
        questions: {
          create: [
            {
              order: 1,
              type: 'RATING_1_5',
              prompt: 'How would you rate your overall employment experience?',
              required: true,
              options: [],
            },
            {
              order: 2,
              type: 'SINGLE_CHOICE',
              prompt: 'What was the primary factor in your decision to leave?',
              required: true,
              options: [
                'Career growth opportunity',
                'Compensation',
                'Work environment',
                'Personal or family reasons',
                'Relocation',
                'Another opportunity',
                'Other',
                'Prefer not to say',
              ],
            },
            {
              order: 3,
              type: 'RATING_1_5',
              prompt: 'How would you rate the support you received from your direct manager?',
              required: false,
              options: [],
            },
            {
              order: 4,
              type: 'RATING_1_5',
              prompt: 'How would you rate the work environment?',
              required: false,
              options: [],
            },
            {
              order: 5,
              type: 'SHORT_TEXT',
              prompt: 'What did you value most about working here? (optional)',
              required: false,
              options: [],
              maxLength: 200,
            },
            {
              order: 6,
              type: 'LONG_TEXT',
              prompt: 'What is the most important improvement the company could make? (optional)',
              required: false,
              options: [],
              maxLength: 2000,
            },
            {
              order: 7,
              type: 'YES_NO_PNTS',
              prompt: 'Would you consider returning to the company in the future?',
              required: true,
              options: ['Yes', 'No', 'Unsure', 'Prefer not to say'],
            },
          ],
        },
      },
    });
  }
}

await main();
await prisma.$disconnect();
