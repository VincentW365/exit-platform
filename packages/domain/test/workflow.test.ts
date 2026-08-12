import { describe, expect, it } from 'vitest';
import {
  businessDaysBetween,
  computeTaskDue,
  computeTaskRelease,
  endOfNthBusinessDayBefore,
  hasDependencyCycle,
  instanceTransitionError,
  lateMinutes,
  overdueSeverity,
  queueDepartmentsForActor,
  taskReadyToRelease,
  taskTransitionError,
  workflowConfigChecksum,
  workflowDefinitionErrors,
  workflowDefTransitionError,
  type BusinessCalendar,
  type TaskDefinitionShape,
  type WorkflowDefinitionShape,
} from '../src/index.ts';
import {
  notificationIdempotencyKey,
  notificationTransitionError,
  requiresManagerApproval,
  NOTIFICATION_RECIPIENT_CLASS,
} from '../src/notifications.ts';
import {
  assetDispositionError,
  assetMetrics,
  assetsSatisfyClearance,
  type AssetItemLike,
} from '../src/assets.ts';
import { credentialFindings, handoverTransitionError } from '../src/handover.ts';
import { evaluateClearance, clearanceChecksum, type ClearanceFacts } from '../src/clearance.ts';

// Synthetic calendar: 2026-08-03 and 2026-08-06 are holidays; weekends off.
const CAL: BusinessCalendar = {
  timezone: 'America/Jamaica',
  holidays: [
    { date: '2026-08-03', label: 'TEST holiday A' },
    { date: '2026-08-06', label: 'TEST holiday B' },
  ],
};

function task(overrides: Partial<TaskDefinitionShape> = {}): TaskDefinitionShape {
  return {
    taskCode: 'HR_TASK_ONE',
    sortOrder: 10,
    enabled: true,
    title: 'Task one',
    description: '',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    taskKind: 'STANDARD',
    priority: 'NORMAL',
    confidential: false,
    required: true,
    waiverAllowed: false,
    waiverAuthority: 'HR_MANAGER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 1,
    dueOffsetKind: 'BUSINESS_DAYS',
    releaseBasis: 'IMMEDIATE',
    releaseOffsetHours: 0,
    pausesOnHold: true,
    blockPausesSla: false,
    dependsOnCodes: [],
    evidenceKind: 'NOTE',
    ...overrides,
  };
}

function definition(tasks: TaskDefinitionShape[]): WorkflowDefinitionShape {
  return {
    workflowType: 'RESIGNATION_WITH_NOTICE',
    name: 'Test workflow',
    version: 1,
    description: '',
    activationConditions: '',
    tasks,
  };
}

describe('workflow definition validation (B)', () => {
  it('accepts a valid definition and rejects duplicates and cycles', () => {
    expect(workflowDefinitionErrors(definition([task()]))).toEqual([]);
    expect(workflowDefinitionErrors(definition([task(), task()]))).toContainEqual(
      expect.stringContaining('Duplicate task code'),
    );
    const a = task({ taskCode: 'TASK_A', dependsOnCodes: ['TASK_B'] });
    const b = task({ taskCode: 'TASK_B', dependsOnCodes: ['TASK_A'] });
    expect(workflowDefinitionErrors(definition([a, b]))).toContainEqual(
      expect.stringContaining('cycle'),
    );
    expect(hasDependencyCycle([a, b])).toBe(true);
    expect(hasDependencyCycle([task({ taskCode: 'TASK_A' })])).toBe(false);
  });

  it('rejects unknown/disabled dependencies and self-dependency', () => {
    expect(
      workflowDefinitionErrors(definition([task({ dependsOnCodes: ['MISSING_ONE'] })])),
    ).toContainEqual(expect.stringContaining('unknown or disabled'));
    expect(
      workflowDefinitionErrors(definition([task({ dependsOnCodes: ['HR_TASK_ONE'] })])),
    ).toContainEqual(expect.stringContaining('depend on itself'));
  });

  it('access-revocation tasks must be required, non-waivable, exact-time, non-pausing', () => {
    const bad = task({
      taskCode: 'IT_ACCESS_REVOCATION',
      taskKind: 'ACCESS_REVOCATION',
      waiverAllowed: true,
      required: false,
      pausesOnHold: true,
      dueBasis: 'CASE_RECEIVED',
      dueOffsetKind: 'BUSINESS_DAYS',
    });
    const errors = workflowDefinitionErrors(definition([bad]));
    expect(errors).toContainEqual(expect.stringContaining('cannot be waived'));
    expect(errors).toContainEqual(expect.stringContaining('must be required'));
    expect(errors).toContainEqual(expect.stringContaining('must not pause on hold'));
    expect(errors).toContainEqual(expect.stringContaining('exact effective separation time'));
  });

  it('checksum is deterministic and content-sensitive (version pinning)', () => {
    const d = definition([task()]);
    expect(workflowConfigChecksum(d)).toBe(workflowConfigChecksum(definition([task()])));
    expect(workflowConfigChecksum(d)).not.toBe(
      workflowConfigChecksum(definition([task({ title: 'Changed' })])),
    );
  });

  it('lifecycle: only drafts edit/activate; ACTIVE is immutable (B.3)', () => {
    expect(workflowDefTransitionError('edit', 'DRAFT')).toBeNull();
    expect(workflowDefTransitionError('edit', 'ACTIVE')).toContain('immutable');
    expect(workflowDefTransitionError('activate', 'DRAFT')).toBeNull();
    expect(workflowDefTransitionError('activate', 'SUPERSEDED')).toBeTruthy();
    expect(workflowDefTransitionError('supersede', 'ACTIVE')).toBeNull();
    expect(workflowDefTransitionError('retire', 'ACTIVE')).toBeNull();
    expect(workflowDefTransitionError('retire', 'DRAFT')).toBeTruthy();
  });
});

describe('due-date calculation with provenance (E)', () => {
  const dates = {
    receivedAt: new Date('2026-07-30T14:00:00Z'), // Thursday
    activationAt: new Date('2026-07-31T15:00:00Z'), // Friday
    effectiveSeparationAt: new Date('2026-08-14T22:00:00Z'), // Friday 5pm Jamaica
    confirmedLastDay: new Date('2026-08-14T00:00:00Z'),
  };

  it('business-day offsets use the configured calendar', () => {
    const due = computeTaskDue(
      { dueBasis: 'CASE_RECEIVED', dueOffsetDays: 1, dueOffsetKind: 'BUSINESS_DAYS' },
      dates,
      CAL,
    );
    // Next business day after Thu 30 Jul is Fri 31 Jul, end of day Jamaica.
    expect(due.dueAt?.toISOString()).toBe('2026-08-01T04:59:59.999Z');
    expect(due.rule).toContain('case receipt');
    expect(due.sourceAt).toEqual(dates.receivedAt);
  });

  it('holidays are skipped (synthetic Mon 3 Aug + Thu 6 Aug)', () => {
    // Activation Fri 31 Jul +2bd: Sat/Sun skipped, Mon 3 Aug is a holiday ->
    // Tue 4 Aug is bd1, Wed 5 Aug is bd2.
    const due = computeTaskDue(
      { dueBasis: 'WORKFLOW_ACTIVATION', dueOffsetDays: 2, dueOffsetKind: 'BUSINESS_DAYS' },
      dates,
      CAL,
    );
    expect(due.dueAt?.toISOString()).toBe('2026-08-06T04:59:59.999Z'); // end of Wed 5 Aug Jamaica
  });

  it('exact-time security tasks use elapsed clock time, not business days (E.2)', () => {
    const due = computeTaskDue(
      { dueBasis: 'EFFECTIVE_SEPARATION', dueOffsetDays: 0, dueOffsetKind: 'EXACT_TIME' },
      dates,
      CAL,
    );
    expect(due.dueAt).toEqual(dates.effectiveSeparationAt);
    expect(due.rule).toContain('exact effective separation instant');
  });

  it('negative offsets mean business days BEFORE the final working day', () => {
    const due = computeTaskDue(
      { dueBasis: 'FINAL_WORKING_DAY', dueOffsetDays: -2, dueOffsetKind: 'BUSINESS_DAYS' },
      dates,
      CAL,
    );
    // Fri 14 Aug minus 2 business days -> Wed 12 Aug end of day.
    expect(due.dueAt?.toISOString()).toBe('2026-08-13T04:59:59.999Z');
    expect(due.rule).toContain('before final working day');
  });

  it('short notice clamps handover lead time forward to activation +1bd', () => {
    const tight = {
      ...dates,
      activationAt: new Date('2026-08-14T13:00:00Z'),
      receivedAt: new Date('2026-08-13T13:00:00Z'),
    };
    const due = computeTaskDue(
      { dueBasis: 'FINAL_WORKING_DAY', dueOffsetDays: -2, dueOffsetKind: 'BUSINESS_DAYS' },
      tight,
      CAL,
    );
    expect(due.dueAt!.getTime()).toBeGreaterThan(tight.activationAt.getTime());
    expect(due.rule).toContain('clamped');
  });

  it('calendar-day offsets and missing anchors', () => {
    const due = computeTaskDue(
      { dueBasis: 'EFFECTIVE_SEPARATION', dueOffsetDays: 3, dueOffsetKind: 'CALENDAR_DAYS' },
      dates,
      CAL,
    );
    expect(due.dueAt?.toISOString()).toBe('2026-08-17T22:00:00.000Z');
    expect(
      computeTaskDue(
        { dueBasis: 'EFFECTIVE_SEPARATION', dueOffsetDays: 0, dueOffsetKind: 'EXACT_TIME' },
        { ...dates, effectiveSeparationAt: null },
        CAL,
      ).dueAt,
    ).toBeNull();
  });

  it('restricted release timing: released relative to the effective instant', () => {
    expect(
      computeTaskRelease(
        { releaseBasis: 'EFFECTIVE_SEPARATION', releaseOffsetHours: -1 },
        dates,
      )?.toISOString(),
    ).toBe('2026-08-14T21:00:00.000Z');
    expect(
      computeTaskRelease({ releaseBasis: 'IMMEDIATE', releaseOffsetHours: 0 }, dates),
    ).toBeNull();
  });

  it('endOfNthBusinessDayBefore and businessDaysBetween helpers', () => {
    expect(endOfNthBusinessDayBefore(new Date('2026-08-05T14:00:00Z'), 1, CAL).toISOString()).toBe(
      '2026-08-05T04:59:59.999Z',
    ); // Tue 4 Aug (Mon 3 Aug is a holiday)
    expect(
      businessDaysBetween(new Date('2026-07-31T14:00:00Z'), new Date('2026-08-05T14:00:00Z'), CAL),
    ).toBe(2);
  });
});

describe('task dependency release (D.1)', () => {
  it('requires all dependencies satisfied AND the release instant reached', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    const satisfied = new Set(['TASK_A']);
    expect(
      taskReadyToRelease({ dependsOnCodes: ['TASK_A'], releaseAt: null }, satisfied, now),
    ).toBe(true);
    expect(
      taskReadyToRelease({ dependsOnCodes: ['TASK_A', 'TASK_B'], releaseAt: null }, satisfied, now),
    ).toBe(false);
    expect(
      taskReadyToRelease(
        { dependsOnCodes: [], releaseAt: new Date('2026-08-01T13:00:00Z') },
        satisfied,
        now,
      ),
    ).toBe(false);
    expect(
      taskReadyToRelease(
        { dependsOnCodes: [], releaseAt: new Date('2026-08-01T11:00:00Z') },
        satisfied,
        now,
      ),
    ).toBe(true);
  });
});

describe('task transitions and waiver rules (D)', () => {
  const hrManager = { userId: 'u1', roles: ['HR_MANAGER' as const] };
  const officer = { userId: 'u2', roles: ['HR_OFFICER' as const] };
  const base = {
    status: 'READY' as const,
    taskKind: 'STANDARD' as const,
    waiverAllowed: true,
    waiverAuthority: 'HR_MANAGER' as const,
  };

  it('enforces state machine and reasons', () => {
    expect(taskTransitionError('start', base, officer)).toBeNull();
    expect(taskTransitionError('start', { ...base, status: 'COMPLETED' }, officer)).toContain(
      'not allowed',
    );
    expect(taskTransitionError('block', base, officer)).toContain('requires a reason');
    expect(taskTransitionError('block', base, officer, 'waiting on vendor')).toBeNull();
  });

  it('waivers: authority, reason, and access revocation never waivable (D.8-D.10, I.9)', () => {
    expect(taskTransitionError('waive', base, hrManager, 'not applicable here')).toBeNull();
    expect(taskTransitionError('waive', base, officer, 'reason')).toContain('HR_MANAGER');
    expect(taskTransitionError('waive', base, hrManager)).toContain('requires a reason');
    expect(
      taskTransitionError('waive', { ...base, waiverAllowed: false }, hrManager, 'r'),
    ).toContain('does not permit');
    expect(
      taskTransitionError('waive', { ...base, taskKind: 'ACCESS_REVOCATION' }, hrManager, 'r'),
    ).toContain('cannot be waived');
  });

  it('lateMinutes stores the exact delay (I.5)', () => {
    const due = new Date('2026-08-14T22:00:00Z');
    expect(lateMinutes(due, new Date('2026-08-14T22:47:30Z'))).toBe(48);
    expect(lateMinutes(due, new Date('2026-08-14T21:00:00Z'))).toBe(0);
    expect(lateMinutes(null, new Date())).toBeNull();
  });
});

describe('escalation defaults (I.6, N)', () => {
  const now = new Date('2026-08-15T12:00:00Z');
  it('access tasks become CRITICAL immediately at the due instant', () => {
    expect(
      overdueSeverity(
        {
          status: 'READY',
          taskKind: 'ACCESS_REVOCATION',
          dueAt: new Date('2026-08-15T11:59:00Z'),
          blockPausesSla: false,
        },
        now,
        0,
      ),
    ).toEqual({ overdue: true, severity: 'CRITICAL' });
  });
  it('ordinary tasks: WARNING at due, HIGH at 3 business days (N.4)', () => {
    const t = {
      status: 'IN_PROGRESS' as const,
      taskKind: 'STANDARD' as const,
      dueAt: new Date('2026-08-10T00:00:00Z'),
      blockPausesSla: false,
    };
    expect(overdueSeverity(t, now, 1).severity).toBe('WARNING');
    expect(overdueSeverity(t, now, 3).severity).toBe('HIGH');
  });
  it('BLOCKED pauses the SLA only when the definition says so (D.6/D.7)', () => {
    const t = {
      status: 'BLOCKED' as const,
      taskKind: 'STANDARD' as const,
      dueAt: new Date('2026-08-10T00:00:00Z'),
      blockPausesSla: true,
    };
    expect(overdueSeverity(t, now, 2).overdue).toBe(false);
    expect(overdueSeverity({ ...t, blockPausesSla: false }, now, 2).overdue).toBe(true);
  });
  it('NOT_READY and future-due tasks are never overdue', () => {
    expect(
      overdueSeverity(
        { status: 'NOT_READY', taskKind: 'STANDARD', dueAt: new Date(0), blockPausesSla: false },
        now,
        99,
      ).overdue,
    ).toBe(false);
  });
});

describe('queue access (J, R.8)', () => {
  it('maps roles to departments; SYSTEM_ADMIN gets nothing', () => {
    expect(queueDepartmentsForActor({ userId: 'u', roles: ['HR_OFFICER'] })).toEqual(['HR']);
    expect(queueDepartmentsForActor({ userId: 'u', roles: ['IT_RESPONDER'] })).toEqual(['IT']);
    expect(queueDepartmentsForActor({ userId: 'u', roles: ['FINANCE_RESPONDER'] })).toEqual([
      'FINANCE',
    ]);
    expect(queueDepartmentsForActor({ userId: 'u', roles: ['LINE_MANAGER'] })).toEqual([
      'LINE_MANAGER',
    ]);
    expect(queueDepartmentsForActor({ userId: 'u', roles: ['SYSTEM_ADMIN'] })).toEqual([]);
  });

  it('overdue severity honours the configurable HIGH threshold (Directive 6.2 K)', () => {
    const task = {
      status: 'READY' as const,
      taskKind: 'STANDARD' as const,
      dueAt: new Date('2026-08-01T00:00:00Z'),
      blockPausesSla: false,
    };
    const now = new Date('2026-08-10T00:00:00Z');
    // Default threshold (3 business days): HIGH.
    expect(overdueSeverity(task, now, 4).severity).toBe('HIGH');
    // Raised threshold via configuration: same lateness stays WARNING.
    expect(overdueSeverity(task, now, 4, 5).severity).toBe('WARNING');
    expect(overdueSeverity(task, now, 5, 5).severity).toBe('HIGH');
  });

  it('workflow instance lifecycle guards', () => {
    expect(instanceTransitionError('hold', 'ACTIVE')).toBeNull();
    expect(instanceTransitionError('hold', 'ON_HOLD')).toBeTruthy();
    expect(instanceTransitionError('complete', 'CLEARANCE_PENDING')).toBeNull();
    expect(instanceTransitionError('complete', 'ACTIVE')).toBeTruthy();
  });
});

describe('notification rules (K)', () => {
  it('idempotency key covers case, type, recipient, version and effective event (K.11)', () => {
    const args = {
      caseId: 'c1',
      notificationType: 'IT_ACCESS_REMOVAL' as const,
      recipientClass: 'INTERNAL_DEPARTMENT' as const,
      workflowVersion: 1,
      effectiveEventAt: new Date('2026-08-14T22:00:00Z'),
    };
    expect(notificationIdempotencyKey(args)).toBe(notificationIdempotencyKey({ ...args }));
    expect(notificationIdempotencyKey(args)).not.toBe(
      notificationIdempotencyKey({ ...args, workflowVersion: 2 }),
    );
    expect(notificationIdempotencyKey(args)).not.toBe(
      notificationIdempotencyKey({ ...args, effectiveEventAt: new Date('2026-08-15T22:00:00Z') }),
    );
  });

  it('external and employee-facing notifications need HR_MANAGER approval (K.2)', () => {
    expect(requiresManagerApproval('EXTERNAL_PROVIDER')).toBe(true);
    expect(requiresManagerApproval('EMPLOYEE')).toBe(true);
    expect(requiresManagerApproval('INTERNAL_DEPARTMENT')).toBe(false);
    expect(NOTIFICATION_RECIPIENT_CLASS.SAGICOR_GROUP_HEALTH_REMOVAL).toBe('EXTERNAL_PROVIDER');
  });

  it('lifecycle transitions enforce order and reasons', () => {
    expect(notificationTransitionError('approve', 'PENDING_APPROVAL')).toBeNull();
    expect(notificationTransitionError('approve', 'DRAFT')).toContain('not allowed');
    expect(notificationTransitionError('recordManualSend', 'APPROVED')).toContain('not allowed');
    expect(notificationTransitionError('recordManualSend', 'READY_FOR_MANUAL_SEND')).toBeNull();
    expect(notificationTransitionError('cancel', 'DRAFT', '')).toContain('requires a reason');
  });
});

describe('asset rules (L)', () => {
  const items: AssetItemLike[] = [
    { status: 'RETURNED', requiredForClearance: true },
    { status: 'NOT_ISSUED', requiredForClearance: true },
    { status: 'LOST', requiredForClearance: true },
    { status: 'EXPECTED', requiredForClearance: true },
    { status: 'RETURNED', requiredForClearance: false },
  ];

  it('documentation vs physical recovery use distinct denominators (L.1/L.8/L.9)', () => {
    const m = assetMetrics(items);
    expect(m.requiredCount).toBe(4);
    // Documented: RETURNED + NOT_ISSUED + LOST = 3 of 4.
    expect(m.documentationRatePct).toBe(75);
    // Physical denominator excludes NOT_ISSUED: 3; returned: 1.
    expect(m.physicalDenominator).toBe(3);
    expect(m.physicalRecoveryRatePct).toBe(33.3);
    expect(m.openCount).toBe(1);
  });

  it('reasoned dispositions and HR_MANAGER-only write-offs (L.4)', () => {
    expect(assetDispositionError('RETURNED', undefined, false)).toBeNull();
    expect(assetDispositionError('LOST', undefined, false)).toContain('requires a reason');
    expect(assetDispositionError('LOST', 'left the island', false)).toBeNull();
    expect(assetDispositionError('WRITTEN_OFF', 'value below threshold', false)).toContain(
      'HR_MANAGER',
    );
    expect(assetDispositionError('WRITTEN_OFF', 'value below threshold', true)).toBeNull();
  });

  it('clearance: open items block; UNRESOLVED needs an approved exception (L.2/L.3)', () => {
    expect(assetsSatisfyClearance(items, false).ok).toBe(false);
    const closed: AssetItemLike[] = [
      { status: 'RETURNED', requiredForClearance: true },
      { status: 'UNRESOLVED', requiredForClearance: true },
    ];
    expect(assetsSatisfyClearance(closed, false).ok).toBe(false);
    expect(assetsSatisfyClearance(closed, true).ok).toBe(true);
  });
});

describe('handover credential detection (M.2/M.3, D.15)', () => {
  it('flags likely credentials', () => {
    expect(credentialFindings('The password is hunter2')).not.toEqual([]);
    expect(credentialFindings('password: hunter2')).not.toEqual([]);
    expect(credentialFindings('-----BEGIN RSA PRIVATE KEY-----')).not.toEqual([]);
    expect(credentialFindings('api_key = sk_live_abc123xyz')).not.toEqual([]);
    expect(credentialFindings('door code: 4482')).not.toEqual([]);
    expect(credentialFindings('PIN: 1234')).not.toEqual([]);
    expect(credentialFindings('AKIAIOSFODNN7EXAMPLE')).not.toEqual([]);
  });
  it('allows ordinary operational prose', () => {
    expect(credentialFindings('Update the password policy document by Friday.')).toEqual([]);
    expect(credentialFindings('Vendor files live on the shared drive under /vendors.')).toEqual([]);
    expect(credentialFindings(null)).toEqual([]);
  });
  it('handover transitions need reasons for waiver/NA', () => {
    expect(handoverTransitionError('waive', 'IN_PROGRESS', 'employee left abruptly')).toBeNull();
    expect(handoverTransitionError('waive', 'IN_PROGRESS')).toContain('requires a reason');
    expect(handoverTransitionError('complete', 'COMPLETED')).toContain('not allowed');
  });
});

describe('clearance gate (O)', () => {
  const readyFacts: ClearanceFacts = {
    departureType: 'RESIGNATION_WITH_NOTICE',
    tasks: [
      { taskCode: 'A', title: 'A', required: true, status: 'COMPLETED', taskKind: 'STANDARD' },
      {
        taskCode: 'IT_ACCESS_REVOCATION',
        title: 'Access',
        required: true,
        status: 'COMPLETED',
        taskKind: 'ACCESS_REVOCATION',
      },
      { taskCode: 'B', title: 'B', required: false, status: 'READY', taskKind: 'STANDARD' },
    ],
    letterStatus: 'RENDERED',
    letterRequired: true,
    actionFormStatus: 'APPROVED',
    assets: [{ status: 'RETURNED', requiredForClearance: true }],
    assetUnresolvedExceptionApproved: false,
    handoverRequired: true,
    handoverStatus: 'COMPLETED',
    openCriticalExceptionCount: 0,
    accessSecurityExceptionApproved: false,
  };

  it('passes when every condition is satisfied; optional tasks never block', () => {
    const r = evaluateClearance(readyFacts);
    expect(r.ok).toBe(true);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  it('blocks on open required task / incomplete access / undocumented asset', () => {
    expect(
      evaluateClearance({
        ...readyFacts,
        tasks: [
          { taskCode: 'A', title: 'A', required: true, status: 'READY', taskKind: 'STANDARD' },
          ...readyFacts.tasks.slice(1),
        ],
      }).ok,
    ).toBe(false);
    const blockedAccess = evaluateClearance({
      ...readyFacts,
      tasks: readyFacts.tasks.map((t) =>
        t.taskKind === 'ACCESS_REVOCATION' ? { ...t, status: 'BLOCKED' as const } : t,
      ),
    });
    expect(blockedAccess.ok).toBe(false);
    expect(blockedAccess.items.find((i) => i.key === 'accessRevocation')?.ok).toBe(false);
    expect(
      evaluateClearance({
        ...readyFacts,
        assets: [{ status: 'EXPECTED', requiredForClearance: true }],
      }).ok,
    ).toBe(false);
  });

  it('incomplete access passes ONLY with an approved security exception (I.10)', () => {
    const facts = {
      ...readyFacts,
      tasks: readyFacts.tasks.map((t) =>
        t.taskKind === 'ACCESS_REVOCATION' ? { ...t, status: 'BLOCKED' as const } : t,
      ),
      accessSecurityExceptionApproved: true,
    };
    // The blocked access task is still a required task, so the gate stays
    // blocked overall - a waiver of the REQUIREMENT is impossible; only the
    // access item itself is satisfied by the security exception.
    const r = evaluateClearance(facts);
    expect(r.items.find((i) => i.key === 'accessRevocation')?.ok).toBe(true);
    expect(r.items.find((i) => i.key === 'requiredTasks')?.ok).toBe(false);
  });

  it('critical exceptions block; the survey is not an input at all (default 20)', () => {
    expect(evaluateClearance({ ...readyFacts, openCriticalExceptionCount: 1 }).ok).toBe(false);
    expect(JSON.stringify(readyFacts)).not.toContain('survey');
  });

  it('termination has no letter requirement; checksum is deterministic', () => {
    expect(
      evaluateClearance({ ...readyFacts, letterRequired: false, letterStatus: null }).items.find(
        (i) => i.key === 'documents',
      )?.ok,
    ).toBe(true);
    expect(clearanceChecksum({ a: 1 })).toBe(clearanceChecksum({ a: 1 }));
    expect(clearanceChecksum({ a: 1 })).not.toBe(clearanceChecksum({ a: 2 }));
  });
});
