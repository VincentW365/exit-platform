/**
 * Runtime-role privilege denial (Directive 1.1 section C.10).
 *
 * Connects to the test database AS THE RUNTIME APPLICATION ROLE (exit_app)
 * and proves at the PostgreSQL privilege layer - independent of the triggers -
 * that the running application cannot tamper with protected evidence even if
 * its process were fully compromised.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft } from '../src/services/caseService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const runtimeUrl = process.env['DATABASE_URL_TEST_RUNTIME'];

let runtime: Client;
let caseId: string;
let auditId: string;
let historyId: string;

beforeAll(async () => {
  if (!runtimeUrl) throw new Error('DATABASE_URL_TEST_RUNTIME is required for privilege tests.');
  await resetDb();
  const officer = await createUser('Priv Officer', 'HR_OFFICER');
  const created = await createDraft(officer.actor, VALID_DRAFT);
  caseId = created.caseId;
  const prisma = getPrisma();
  auditId = (await prisma.auditEvent.findFirstOrThrow({ where: { caseId } })).id;
  historyId = (await prisma.caseStatusHistory.findFirstOrThrow({ where: { caseId } })).id;
  runtime = new Client({ connectionString: runtimeUrl });
  await runtime.connect();
});

afterAll(async () => {
  await runtime?.end();
});

async function expectDenied(sql: string, pattern: RegExp = /permission denied|must be owner/i) {
  await expect(runtime.query(sql)).rejects.toThrow(pattern);
}

describe('runtime role cannot tamper with audit evidence', () => {
  it('cannot UPDATE an audit event', async () => {
    await expectDenied(`UPDATE audit_event SET "eventType"='TAMPERED' WHERE id='${auditId}'`);
  });

  it('cannot DELETE an audit event', async () => {
    await expectDenied(`DELETE FROM audit_event WHERE id='${auditId}'`);
  });

  it('cannot disable the audit trigger', async () => {
    await expectDenied(`ALTER TABLE audit_event DISABLE TRIGGER trg_audit_event_no_update`);
  });

  it('cannot ALTER the audit table', async () => {
    await expectDenied(`ALTER TABLE audit_event ADD COLUMN tampered text`);
  });

  it('cannot DROP the audit trigger or table', async () => {
    await expectDenied(`DROP TRIGGER trg_audit_event_no_update ON audit_event`);
    await expectDenied(`DROP TABLE audit_event`);
  });
});

describe('runtime role cannot destroy case evidence', () => {
  it('cannot DELETE an offboarding case', async () => {
    await expectDenied(`DELETE FROM offboarding_case WHERE id='${caseId}'`);
  });

  it('cannot DELETE case status history', async () => {
    await expectDenied(`DELETE FROM case_status_history WHERE id='${historyId}'`);
  });

  it('cannot UPDATE or DELETE employee snapshots directly', async () => {
    // No snapshot row is needed: the privilege refusal is table-level.
    await expectDenied(`UPDATE employee_snapshot SET checksum='x' WHERE 1=0`);
    await expectDenied(`DELETE FROM employee_snapshot WHERE 1=0`);
  });

  it('cannot TRUNCATE protected tables', async () => {
    await expectDenied(`TRUNCATE TABLE audit_event`);
    await expectDenied(`TRUNCATE TABLE offboarding_case CASCADE`);
  });

  it('cannot grant itself privileges or create objects', async () => {
    // Postgres treats a self-GRANT without grant option as a warning no-op;
    // the material assertion is that NO privilege is actually gained.
    await runtime.query(`GRANT DELETE ON offboarding_case TO exit_app`).catch(() => undefined);
    const priv = await runtime.query(
      `SELECT has_table_privilege('exit_app','offboarding_case','DELETE') AS d`,
    );
    expect(priv.rows[0].d).toBe(false);
    await expectDenied(`CREATE TABLE sneaky (id int)`, /permission denied/i);
  });
});

describe('runtime role cannot tamper with Stage 3 workflow evidence (Directive 3 R.9)', () => {
  it('cannot DELETE workflow evidence', async () => {
    await expectDenied(`DELETE FROM workflow_definition WHERE 1=0`);
    await expectDenied(`DELETE FROM workflow_instance WHERE 1=0`);
    await expectDenied(`DELETE FROM workflow_task WHERE 1=0`);
    await expectDenied(`DELETE FROM case_exception WHERE 1=0`);
    await expectDenied(`DELETE FROM asset_recovery_item WHERE 1=0`);
    await expectDenied(`DELETE FROM handover_record WHERE 1=0`);
    await expectDenied(`DELETE FROM notification_record WHERE 1=0`);
  });

  it('cannot UPDATE or DELETE clearance records and task corrections', async () => {
    await expectDenied(`UPDATE clearance_record SET decision='TAMPERED' WHERE 1=0`);
    await expectDenied(`DELETE FROM clearance_record WHERE 1=0`);
    await expectDenied(`UPDATE task_correction SET reason='TAMPERED' WHERE 1=0`);
    await expectDenied(`DELETE FROM task_correction WHERE 1=0`);
  });

  it('cannot DELETE signing evidence (DEC-068)', async () => {
    // A signature or a signing request that existed is history. A mistaken
    // mark is superseded in place; nothing is ever removed.
    await expectDenied(`DELETE FROM signature_record WHERE 1=0`);
    await expectDenied(`DELETE FROM signature_request WHERE 1=0`);
    await expectDenied(`TRUNCATE TABLE signature_record CASCADE`);
  });

  it('cannot disable the Stage 3 protection triggers', async () => {
    await expectDenied(`ALTER TABLE workflow_task DISABLE TRIGGER trg_access_task_never_waived`);
    await expectDenied(
      `ALTER TABLE clearance_record DISABLE TRIGGER trg_clearance_record_no_update`,
    );
    await expectDenied(`DROP TRIGGER trg_workflow_definition_frozen ON workflow_definition`);
  });

  it('cannot TRUNCATE workflow evidence tables', async () => {
    await expectDenied(`TRUNCATE TABLE workflow_task CASCADE`);
    await expectDenied(`TRUNCATE TABLE clearance_record`);
  });
});

describe('runtime role cannot tamper with Stage 4 operational evidence (Directive 4)', () => {
  it('cannot DELETE outbox, pilot, backup or privacy evidence', async () => {
    await expectDenied(`DELETE FROM notification_outbox WHERE 1=0`);
    await expectDenied(`DELETE FROM recipient_config WHERE 1=0`);
    await expectDenied(`DELETE FROM pilot_activation WHERE 1=0`);
    await expectDenied(`DELETE FROM backup_record WHERE 1=0`);
    await expectDenied(`DELETE FROM disclosure_log WHERE 1=0`);
    await expectDenied(`DELETE FROM retention_policy WHERE 1=0`);
    await expectDenied(`DELETE FROM fallback_entry WHERE 1=0`);
    await expectDenied(`DELETE FROM support_ticket WHERE 1=0`);
  });

  it('cannot UPDATE append-only evidence tables (INSERT/SELECT grants only)', async () => {
    await expectDenied(`UPDATE access_review SET payload='{}' WHERE 1=0`);
    await expectDenied(`UPDATE employee_sync_run SET "createdCount"=0 WHERE 1=0`);
    await expectDenied(`UPDATE retention_run SET findings='{}' WHERE 1=0`);
    await expectDenied(`UPDATE disclosure_log SET "disclosedTo"='TAMPERED' WHERE 1=0`);
    await expectDenied(`UPDATE report_run SET status='TAMPERED' WHERE 1=0`);
    await expectDenied(`UPDATE training_completion SET module='TAMPERED' WHERE 1=0`);
  });

  it('cannot disable the Stage 4 protection triggers', async () => {
    await expectDenied(
      `ALTER TABLE notification_outbox DISABLE TRIGGER trg_notification_outbox_no_delete`,
    );
    await expectDenied(
      `ALTER TABLE backup_record DISABLE TRIGGER trg_backup_record_core_immutable`,
    );
    await expectDenied(`DROP TRIGGER trg_pilot_activation_frozen ON pilot_activation`);
  });

  it('cannot TRUNCATE Stage 4 evidence tables', async () => {
    await expectDenied(`TRUNCATE TABLE notification_outbox`);
    await expectDenied(`TRUNCATE TABLE backup_record`);
    await expectDenied(`TRUNCATE TABLE disclosure_log`);
  });
});

describe('runtime role retains exactly its working privileges', () => {
  it('can still read and insert where the application requires it', async () => {
    const read = await runtime.query(`SELECT count(*)::int AS n FROM offboarding_case`);
    expect(read.rows[0].n).toBeGreaterThan(0);
    const audit = await runtime.query(
      `INSERT INTO audit_event
        (id, "eventType", "actorType", "effectiveRoles", "objectType", "objectId", result,
         "correlationId", metadata, "appVersion", "occurredAt")
       VALUES (gen_random_uuid(), 'ACCESS_DENIED', 'SYSTEM', '{}', 'PrivilegeTest', 'x',
         'SUCCESS', 'priv-test', '{}', 'test', now())
       RETURNING id`,
    );
    expect(audit.rows[0].id).toBeTruthy();
  });
});
