/**
 * Stage 2 integration: controlled documents (Directive 2 N.1-N.7, N.22).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import {
  createLetterDraft,
  downloadDocumentPdf,
  finalizeDocument,
  getCaseDocuments,
  refreshDraftFields,
  renderApprovedDocument,
  supersedeAndRecreate,
  voidDocument,
} from '../src/services/documentService.ts';
import { changeEffectiveTime, createDraft, transitionCase } from '../src/services/caseService.ts';
import { setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import { createUser, resetDb, VALID_DRAFT, FIXTURE_CONFIRMED_LAST_DAY } from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let otherOfficer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let itResponder: Awaited<ReturnType<typeof createUser>>;
let testCaseId: string;
/** A second approved case the manager holds, for the intervention test. */
let managerCaseId: string;
const restrictedCaseFreeId = () => managerCaseId;

const NOTICE_BODY = `DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE

Dear [[EMPLOYEE_LEGAL_NAME]],

We acknowledge receipt of your resignation on [[RESIGNATION_RECEIVED_DATE]] (case [[CASE_REFERENCE]]).
Your last working day is [[CONFIRMED_LAST_WORKING_DATE]]; employment ends [[EFFECTIVE_SEPARATION_DATE]].

[[HR_APPROVER_NAME]]
[[HR_APPROVER_TITLE]]`;

beforeAll(async () => {
  await resetDb();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-pdf-'))));
  officer = await createUser('S2 Officer', 'HR_OFFICER');
  otherOfficer = await createUser('S2 Other Officer', 'HR_OFFICER');
  manager = await createUser('S2 Manager', 'HR_MANAGER');
  itResponder = await createUser('S2 IT');

  const draft = await createDraftTemplate(officer.actor, {
    documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    name: 'Test notice template',
    contentBody: NOTICE_BODY,
  });
  await activateTemplate(manager.actor, draft.id);

  // TEST-purpose case: exercisable while flags stay disabled (default 26).
  const created = await createDraft(officer.actor, {
    ...VALID_DRAFT,
    recordPurpose: 'TEST',
    measurementCohort: null,
    confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
  });
  testCaseId = created.caseId;
  await setEmployeeAddress(officer.actor, testCaseId, {
    employeeAddress: '12 Synthetic Avenue, Kingston 5',
  });
  // A case the HR Manager created, approved and holds unassigned: another
  // officer can read it but never execute it.
  const managed = await createDraft(manager.actor, {
    ...VALID_DRAFT,
    employeeSourceId: 'EMP-TEST-004',
    recordPurpose: 'TEST',
    measurementCohort: null,
    confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
  });
  managerCaseId = managed.caseId;
  await setEmployeeAddress(manager.actor, managerCaseId, {
    employeeAddress: '14 Fictional Way, St. Andrew',
  });
  await transitionCase(manager.actor, managerCaseId, 'submit');
  await transitionCase(manager.actor, managerCaseId, 'approve');
});

describe('template governance', () => {
  it('only one ACTIVE version per type; officers cannot activate', async () => {
    const d2 = await createDraftTemplate(officer.actor, {
      documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
      name: 'v2 draft',
      contentBody: NOTICE_BODY + '\nRevision.',
    });
    await expect(activateTemplate(officer.actor, d2.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await activateTemplate(manager.actor, d2.id);
    const active = await prisma.documentTemplate.findMany({
      where: { documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE', status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(2);
  });

  it('the termination placeholder can never be activated (default 18)', async () => {
    const t = await createDraftTemplate(officer.actor, {
      documentType: 'TERMINATION_DOCUMENT_PLACEHOLDER',
      name: 'placeholder',
      contentBody: '',
    });
    await expect(activateTemplate(manager.actor, t.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('feature gating (defaults 25/26, N.22)', () => {
  it('OPERATIONAL/BASELINE cases cannot create documents while flags are off', async () => {
    const op = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-002',
      confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
    });
    await expect(createLetterDraft(officer.actor, op.caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // and no automatic document appeared from any transition:
    expect(await prisma.documentInstance.count({ where: { caseId: op.caseId } })).toBe(0);
  });
});

describe('single authorization gate: the case approval releases the documents (DEC-066)', () => {
  let docId: string;

  it('a document can be drafted but not finalized while the case is still a draft', async () => {
    const d = await createLetterDraft(officer.actor, testCaseId);
    docId = d.id;
    // The draft pins whatever template version is ACTIVE right now.
    const active = await prisma.documentTemplate.findFirstOrThrow({
      where: { documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE', status: 'ACTIVE' },
    });
    expect(d.templateVersion).toBe(active.version);
    await expect(finalizeDocument(officer.actor, docId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('not been approved')],
    });
    // Awaiting approval is not approval either.
    await transitionCase(officer.actor, testCaseId, 'submit');
    await expect(finalizeDocument(officer.actor, docId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('awaiting HR Manager approval')],
    });
    const still = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(still.status).toBe('DRAFT');
  });

  it('once the HR Manager approves the case, the assigned officer finalizes it alone: attested, checksummed, rendered', async () => {
    await transitionCase(manager.actor, testCaseId, 'approve');
    await finalizeDocument(officer.actor, docId);
    const d = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(d.status).toBe('RENDERED');
    expect(d.pdfObjectKey).toBeTruthy();
    expect(d.pdfChecksum).toMatch(/^[a-f0-9]{64}$/);
    // The officer who finalized it signs the letter - no manager name is
    // borrowed for a signature the manager never gave.
    expect(d.contentSnapshot).toContain('S2 Officer');
    expect(d.contentSnapshot).not.toContain('[MISSING:');
    expect(d.submittedById).toBe(officer.userId);

    const attestation = await prisma.attestation.findFirstOrThrow({
      where: { subjectType: 'DOCUMENT', subjectId: docId },
    });
    expect(attestation.kind).toBe('HR_DOCUMENT_FINALIZATION');
    expect(attestation.contentChecksum).toBe(d.contentChecksum);
    expect(attestation.actorRole).toBe('HR Officer');
    expect(attestation.actorId).toBe(officer.userId);

    // The audit trail names the case approval the finalization executed.
    const finalized = await prisma.auditEvent.findFirstOrThrow({
      where: { caseId: testCaseId, eventType: 'DOC_FINALIZED', objectId: docId },
    });
    const meta = finalized.metadata as Record<string, unknown>;
    expect(meta['authority']).toBe('CASE_APPROVAL');
    expect(meta['caseApprovedById']).toBe(manager.userId);
    expect(
      await prisma.auditEvent.count({ where: { caseId: testCaseId, eventType: 'DOC_APPROVED' } }),
    ).toBe(0);

    // Idempotent re-render: nothing changes (D.10/D.11).
    const before = { key: d.pdfObjectKey, checksum: d.pdfChecksum };
    await renderApprovedDocument(docId, 'test-correlation');
    const again = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(again.pdfObjectKey).toBe(before.key);
    expect(again.pdfChecksum).toBe(before.checksum);
  });

  it('a finalized document cannot be finalized again', async () => {
    await expect(finalizeDocument(manager.actor, docId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('another HR Officer can read the case but cannot execute it; the HR Manager can intervene', async () => {
    const draft = await createLetterDraft(manager.actor, restrictedCaseFreeId());
    await expect(finalizeDocument(otherOfficer.actor, draft.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(voidDocument(otherOfficer.actor, draft.id, 'not mine')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Manager intervention needs no assignment: they hold every case.
    await voidDocument(manager.actor, draft.id, 'Intervention: duplicate draft.');
    const voided = await prisma.documentInstance.findUniqueOrThrow({ where: { id: draft.id } });
    expect(voided.status).toBe('VOIDED');
  });

  it('authorized download verifies the checksum; unauthorized roles get nothing', async () => {
    const dl = await downloadDocumentPdf(officer.actor, docId);
    expect(dl.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(downloadDocumentPdf(itResponder.actor, docId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('material case correction supersedes the rendered doc, invalidates the attestation, and opens v+1 (D.12/N.6)', async () => {
    await changeEffectiveTime(
      manager.actor,
      testCaseId,
      new Date('2026-08-21T22:00:00.000Z'),
      'Employee agreed a later date.',
    );
    const old = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(old.status).toBe('SUPERSEDED');
    expect(old.pdfObjectKey).toBeTruthy(); // original preserved
    const attestation = await prisma.attestation.findFirstOrThrow({
      where: { subjectType: 'DOCUMENT', subjectId: docId },
    });
    expect(attestation.invalidatedAt).not.toBeNull();
    const replacement = await prisma.documentInstance.findFirst({
      where: { caseId: testCaseId, documentType: old.documentType, version: old.version + 1 },
    });
    expect(replacement?.status).toBe('DRAFT');
    // Superseded copy remains downloadable but marked superseded.
    const dl = await downloadDocumentPdf(manager.actor, docId);
    expect(dl.superseded).toBe(true);
  });

  it('restricted cases hide their documents entirely from unauthorized users (N.7)', async () => {
    const restricted = await createDraft(manager.actor, {
      ...VALID_DRAFT,
      employeeSourceId: 'EMP-TEST-003',
      departureType: 'TERMINATION',
      recordPurpose: 'TEST',
      measurementCohort: null,
    });
    await expect(getCaseDocuments(officer.actor, restricted.caseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('corrections after finalization need no second person (DEC-066 replaces the UAT-4 maker-checker fix)', () => {
  it('the replacement draft left by an audited correction is finalized by the officer again', async () => {
    const draft = await prisma.documentInstance.findFirstOrThrow({
      where: { caseId: testCaseId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });
    // Its fields were captured before the correction; the officer refreshes
    // and finalizes - one person, one step, under the same case approval.
    await refreshDraftFields(officer.actor, draft.id);
    await finalizeDocument(officer.actor, draft.id);
    const approved = await prisma.documentInstance.findUniqueOrThrow({ where: { id: draft.id } });
    expect(approved.status).toBe('RENDERED');
    expect(approved.submittedById).toBe(officer.userId);

    // A manual supersede by the manager opens a corrected draft that the
    // officer - or the manager - finalizes; nobody is deadlocked.
    const replacement = await supersedeAndRecreate(
      manager.actor,
      draft.id,
      'Corrected after an audited case change.',
    );
    expect(replacement.createdById).toBe(manager.userId);
    await finalizeDocument(manager.actor, replacement.id);
    const done = await prisma.documentInstance.findUniqueOrThrow({
      where: { id: replacement.id },
    });
    expect(done.status).toBe('RENDERED');
    const attestation = await prisma.attestation.findFirstOrThrow({
      where: { subjectType: 'DOCUMENT', subjectId: replacement.id },
    });
    expect(attestation.actorRole).toBe('HR Manager');
  });
});

describe('date-order check compares calendar days (found by the offboarding regression suite, 2026-09-09)', () => {
  it('a resignation received today with the last working day today can be finalized', async () => {
    const { isoDateInZone, parseInstantInZone } = await import('@exit/domain');
    const today = isoDateInZone(new Date());
    // The platform's own defaults for an immediate departure: received now,
    // last day today. The last working day is a date-only column (midnight
    // UTC); compared raw with the received instant it read as "before".
    const created = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      recordPurpose: 'TEST',
      measurementCohort: null,
      receivedAt: new Date(Date.now() - 60_000).toISOString(),
      confirmedLastDay: new Date(`${today}T12:00:00Z`).toISOString(),
      effectiveSeparationAt: parseInstantInZone(`${today}T23:59`)!.toISOString(),
    });
    await setEmployeeAddress(officer.actor, created.caseId, {
      employeeAddress: '14 Synthetic Avenue, Kingston 5',
    });
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');
    const d = await createLetterDraft(officer.actor, created.caseId);
    await expect(finalizeDocument(officer.actor, d.id)).resolves.not.toThrow();
    const after = await prisma.documentInstance.findUniqueOrThrow({ where: { id: d.id } });
    expect(['APPROVED', 'RENDERING', 'RENDERED']).toContain(after.status);
  });
});
