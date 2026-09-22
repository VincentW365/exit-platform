/**
 * Child-process bridge between the regression suite and the repository's
 * service layer. Invoked as:
 *
 *   pnpm exec tsx e2e/offboarding-regression/support/db-bridge.ts <op> <base64 json>
 *
 * It prints a single JSON result after the @@RESULT@@ marker. It loads the
 * root .env exactly as the seed scripts do; the calling process sets the
 * UAT posture (APP_ENVIRONMENT=test, TEST_EMAIL) in the environment first,
 * and loadRootEnvFile never overrides what is already set.
 *
 * Reads return records with secrets removed (token hashes, ciphertexts).
 * Writes are the audited product services only - no direct table edits.
 */
import { loadRootEnvFile } from '../../../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const RESULT_MARK = '@@RESULT@@';
const SECRET_KEYS = /ciphertext|tokenHash|secret|password/i;

function strip<T>(value: T): T {
  if (Array.isArray(value)) return value.map(strip) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) continue;
      out[k] = strip(v);
    }
    return out as T;
  }
  return value;
}

async function main(): Promise<void> {
  const [op, payload] = process.argv.slice(2);
  const arg = payload
    ? (JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>)
    : {};
  const db = await import('../../../packages/db/src/index.ts');
  const domain = await import('../../../packages/domain/src/index.ts');
  const { getConfig } = await import('../../../packages/config/src/index.ts');
  const prisma = db.getPrisma();

  const actorFor = async (slug: string, role: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { identitySubject: `dev|${slug}` } });
    return { userId: u.id, roles: [role] as never };
  };
  // Catalogue reads need no actor; everything else acts as the HR Manager,
  // the single authority the product gives these operations (DEC-063).
  const managerActor = () => actorFor('hr-manager', 'HR_MANAGER');
  const adminActor = managerActor;

  const caseByNumber = async (caseNumber: string) => {
    const c = await prisma.offboardingCase.findFirst({ where: { caseNumber } });
    if (!c) throw new Error(`No case ${caseNumber}`);
    return c;
  };

  let value: unknown;
  switch (op) {
    case 'prepare-run': {
      const employee = String(arg['employee']);
      const runId = String(arg['runId']);
      const cfg = getConfig();
      const flags = await prisma.featureFlag.findMany({
        where: { key: { startsWith: 'automation.' } },
      });
      let rehearsal: unknown = null;
      try {
        rehearsal = await db.getTestMode(await adminActor());
      } catch {
        rehearsal = null;
      }
      const posture = {
        appEnvironment: cfg.appEnvironment,
        emailMode: cfg.EMAIL_MODE,
        testEmail: cfg.TEST_EMAIL ?? null,
        rehearsalMode: rehearsal,
        automationFlags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
      };
      // Leftovers from earlier runs: TEST-purpose cases for this employee
      // that are still live are voided (audited) so the run starts from a
      // known state. Completed ones are terminal and already excluded from
      // every report, so they are left as history.
      const live = await prisma.offboardingCase.findMany({
        where: {
          employeeDisplayName: employee,
          recordPurpose: 'TEST',
          status: { notIn: ['VOIDED', 'CANCELLED', 'COMPLETED'] },
        },
        select: { id: true, caseNumber: true, status: true },
      });
      const voided: Array<{ caseNumber: string; from: string }> = [];
      const leftAlone: Array<{ caseNumber: string; status: string }> = [];
      const reason = `Offboarding regression run ${runId}: superseded test case from an earlier run.`;
      const manager = await managerActor();
      for (const c of live) {
        try {
          if (c.status === 'CLEARANCE_REVIEW') {
            await db.transitionCase(manager, c.id, 'clearanceReturn' as never, reason);
          }
          await db.transitionCase(manager, c.id, 'void' as never, reason);
          voided.push({ caseNumber: c.caseNumber, from: c.status });
        } catch (e) {
          leftAlone.push({
            caseNumber: c.caseNumber,
            status: `${c.status} (${String(e).slice(0, 120)})`,
          });
        }
      }
      value = { posture, voided, leftAlone };
      break;
    }
    case 'directory-facts': {
      const employee = String(arg['employee']);
      const rows = await prisma.employeeSourceRecord.findMany({
        where: { displayName: employee, active: true },
        orderBy: { sourceSystem: 'asc' },
      });
      const row = rows[0] ?? null;
      const present: Record<string, boolean> = {};
      if (row) {
        for (const k of [
          'employeeNumber',
          'workEmail',
          'jobTitle',
          'department',
          'location',
          'managerName',
          'managerSourceId',
          'contractEndDate',
          'lastSyncedAt',
        ]) {
          const v = (row as Record<string, unknown>)[k];
          present[k] = v !== null && v !== undefined && v !== '';
        }
      }
      let managerFacts: { onRecord: boolean; hasWorkEmail: boolean; name: string | null } | null =
        null;
      if (row) {
        const mgr = row.managerSourceId
          ? await prisma.employeeSourceRecord.findUnique({
              where: {
                sourceSystem_sourceId: {
                  sourceSystem: row.sourceSystem,
                  sourceId: row.managerSourceId,
                },
              },
            })
          : null;
        managerFacts = {
          onRecord: !!(row.managerName || row.managerSourceId),
          hasWorkEmail: !!mgr?.workEmail,
          name: row.managerName ?? mgr?.displayName ?? null,
        };
      }
      value = {
        matches: rows.length,
        sourceSystem: row?.sourceSystem ?? null,
        sourceId: row?.sourceId ?? null,
        present,
        manager: managerFacts,
      };
      break;
    }
    case 'mark-test': {
      const c = await caseByNumber(String(arg['caseNumber']));
      await db.correctRecordPurpose(await managerActor(), c.id, 'TEST', String(arg['reason']));
      const after = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: c.id } });
      value = { caseId: c.id, recordPurpose: after.recordPurpose };
      break;
    }
    case 'sweep': {
      const sweep = await db.runStage3Sweep(new Date());
      const outbox = await db.processOutbox(new Date());
      value = { sweep, outbox };
      break;
    }
    case 'void-case': {
      const c = await caseByNumber(String(arg['caseNumber']));
      const manager = await managerActor();
      if (c.status === 'CLEARANCE_REVIEW')
        await db.transitionCase(manager, c.id, 'clearanceReturn' as never, String(arg['reason']));
      await db.transitionCase(manager, c.id, 'void' as never, String(arg['reason']));
      const after = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: c.id } });
      value = { status: after.status };
      break;
    }
    case 'workflow-expectation': {
      const type = String(arg['type']);
      const def = await prisma.workflowDefinition.findFirst({
        where: { workflowType: type as never, status: 'ACTIVE' },
        include: { taskDefs: { orderBy: { sortOrder: 'asc' } } },
      });
      value = {
        found: !!def,
        name: def?.name ?? null,
        version: def?.version ?? null,
        tasks: (def?.taskDefs ?? [])
          .filter((t) => t.enabled)
          .map((t) => ({
            code: t.taskCode,
            title: t.title,
            department: t.department,
            requiredRole: t.requiredRole,
            required: t.required,
            priority: t.priority,
          })),
      };
      break;
    }
    case 'snapshot': {
      const c = await caseByNumber(String(arg['caseNumber']));
      const users = await prisma.user.findMany({ select: { id: true, displayName: true } });
      const nameOf = (id: string | null | undefined) =>
        id ? (users.find((u) => u.id === id)?.displayName ?? null) : null;
      const snapshot = await prisma.employeeSnapshot
        .findFirst({ where: { caseId: c.id } })
        .catch(() => null);
      const tasks = await prisma.workflowTask.findMany({
        where: { caseId: c.id },
        orderBy: { sortOrder: 'asc' },
      });
      const requiredActions = await prisma.caseRequiredAction.findMany({
        where: { caseId: c.id },
        orderBy: { actionKey: 'asc' },
      });
      const records = await prisma.notificationRecord.findMany({
        where: { caseId: c.id },
        orderBy: { createdAt: 'asc' },
      });
      const ids = records.map((r) => r.id);
      const outbox = await prisma.notificationOutbox.findMany({
        where: { notificationRecordId: { in: ids } },
      });
      const captures = await prisma.notificationCapture.findMany({
        where: { recordId: { in: ids } },
        orderBy: { capturedAt: 'asc' },
      });
      const tokens = await prisma.actionToken.findMany({
        where: { notificationRecordId: { in: ids } },
      });
      const notifications = records.map((r) => ({
        ...r,
        outbox: outbox.filter((o) => o.notificationRecordId === r.id),
        captures: captures
          .filter((x) => x.recordId === r.id)
          .map((x) => ({
            subject: x.subject,
            body: x.body,
            capturedAt: x.capturedAt,
            note: x.note,
          })),
        tokens: tokens.filter((t) => t.notificationRecordId === r.id),
      }));
      const documents = await prisma.documentInstance.findMany({
        where: { caseId: c.id },
        orderBy: [{ documentType: 'asc' }, { version: 'asc' }],
      });
      const actionForms = await prisma.actionFormVersion
        .findMany({ where: { caseId: c.id } })
        .catch(() => []);
      const assets = await prisma.assetRecoveryItem.findMany({ where: { caseId: c.id } });
      const returnChecklist = await prisma.returnItemsChecklist
        .findUnique({ where: { caseId: c.id }, include: { items: true } })
        .catch(() => null);
      const survey = await prisma.surveyInvitation.findMany({ where: { caseId: c.id } });
      const exceptions = await prisma.caseException.findMany({ where: { caseId: c.id } });
      const auditRows = await prisma.auditEvent.findMany({
        where: { caseId: c.id },
        orderBy: { occurredAt: 'asc' },
      });
      const audit = auditRows.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        actorType: e.actorType,
        actor: e.actorType === 'SYSTEM' ? 'System' : (nameOf(e.actorId) ?? 'Unknown user'),
        effectiveRoles: e.effectiveRoles,
        objectType: e.objectType,
        objectId: e.objectId,
        result: e.result,
        correlationId: e.correlationId,
        metadata: e.metadata,
        sentence: domain.humanizeAuditEvent({
          eventType: e.eventType,
          result: e.result,
          actorType: e.actorType,
          actorDisplayName: e.actorType === 'SYSTEM' ? null : nameOf(e.actorId),
          metadata: e.metadata as never,
        }),
      }));
      let clearance: unknown = null;
      try {
        clearance = await db.getClearanceView(await managerActor(), c.id);
      } catch (e) {
        clearance = { unavailable: String(e).slice(0, 200) };
      }
      value = strip({
        case: { ...c, snapshotCaptured: !!snapshot },
        officer: nameOf(c.assignedOfficerId),
        owner: nameOf(c.ownerId),
        manager: nameOf(c.managerUserId),
        tasks,
        requiredActions,
        notifications,
        documents: documents.map((d) => ({ ...d, contentSnapshot: d.contentSnapshot ?? null })),
        actionForms,
        assets,
        returnChecklist,
        survey,
        exceptions,
        audit,
        clearance,
      });
      break;
    }
    // --- BambooHR directory (owner directive, 2026-09-15) -------------------
    // Reads are the product's own directory services; synchronizations are the
    // product's own engine. Nothing here touches the mirror directly.
    case 'directory-status': {
      value = await db.directorySyncStatus();
      break;
    }
    case 'directory-profile': {
      const employee = String(arg['employee']);
      const mode =
        (await db.getSystemConfigValue('bamboohr.mode')) === 'live' ? 'BAMBOOHR' : 'SYNTHETIC';
      const row =
        (await prisma.employeeSourceRecord.findFirst({
          where: { displayName: employee, sourceSystem: mode },
          orderBy: { active: 'desc' },
        })) ??
        (await prisma.employeeSourceRecord.findFirst({
          where: { displayName: employee },
          orderBy: { active: 'desc' },
        }));
      value = row ? await db.getDirectoryProfile(await managerActor(), row.id) : null;
      break;
    }
    case 'directory-refresh': {
      value = await db.runDirectorySyncNow({
        kind: 'MANUAL',
        actor: await adminActor(),
        waitMs: 180_000,
      });
      break;
    }
    case 'directory-hourly': {
      const scheduledSyncEnabled =
        (await db.getSystemConfigValue('bamboohr.scheduledSync')) === true;
      const tick = await db.directorySyncTick(new Date());
      const forced = await db.runDirectorySyncNow({ kind: 'HOURLY', waitMs: 180_000 });
      value = { scheduledSyncEnabled, tick, forced };
      break;
    }
    case 'directory-outage': {
      const on = Boolean(arg['on']);
      await db.setSystemConfig(
        await adminActor(),
        'bamboohr.simulateOutage',
        on,
        `Offboarding regression: simulated BambooHR outage ${on ? 'ON' : 'OFF'}`,
      );
      value = { on };
      break;
    }
    case 'directory-runs': {
      value = await db.listDirectorySyncRuns(await managerActor(), {
        kind: arg['kind'] ? String(arg['kind']) : undefined,
        limit: Number(arg['limit'] ?? 20),
      });
      break;
    }
    case 'directory-search': {
      const r = await db.listDirectory(await managerActor(), {
        q: String(arg['q']),
        status: 'all',
      });
      value = {
        total: r.total,
        rows: r.rows.slice(0, 5).map((x) => ({
          sourceId: x.sourceId,
          displayName: x.displayName,
          jobTitle: x.jobTitle,
          department: x.department,
          managerName: x.managerName,
          employeeNumber: x.employeeNumber,
          status: x.status,
        })),
        freshness: r.sync.freshness,
      };
      break;
    }
    case 'profiles': {
      value = {
        types: domain.DEPARTURE_TYPES.map((t: string) => ({
          type: t,
          profile: domain.separationProfile(t as never),
          letterType: domain.letterTypeForDeparture(t as never),
        })),
        confirmationKeys: domain.CONFIRMATION_KEYS,
      };
      break;
    }
    default:
      throw new Error(`Unknown op ${op}`);
  }
  process.stdout.write(`\n${RESULT_MARK}${JSON.stringify({ ok: true, value })}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  process.stdout.write(
    `\n${RESULT_MARK}${JSON.stringify({ ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) })}\n`,
  );
  process.exit(1);
});
