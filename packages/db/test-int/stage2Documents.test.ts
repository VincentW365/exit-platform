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
  approveDocument,
  createLetterDraft,
  downloadDocumentPdf,
  getCaseDocuments,
  renderApprovedDocument,
  submitDocument,
} from '../src/services/documentService.ts';
import { changeEffectiveTime, createDraft } from '../src/services/caseService.ts';
import { setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import { createUser, resetDb, VALID_DRAFT, FIXTURE_CONFIRMED_LAST_DAY } from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let manager2: Awaited<ReturnType<typeof createUser>>;
let itResponder: Awaited<ReturnType<typeof createUser>>;
let testCaseId: string;

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
  manager = await createUser('S2 Manager', 'HR_MANAGER');
  manager2 = await createUser('S2 Manager Two', 'HR_MANAGER');
  itResponder = await createUser('S2 IT', 'IT_RESPONDER');

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

describe('document maker-checker flow', () => {
  let docId: string;

  it('officer creates and submits a draft from the ACTIVE template', async () => {
    const d = await createLetterDraft(officer.actor, testCaseId);
    docId = d.id;
    // The draft pins whatever template version is ACTIVE right now.
    const active = await prisma.documentTemplate.findFirstOrThrow({
      where: { documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE', status: 'ACTIVE' },
    });
    expect(d.templateVersion).toBe(active.version);
    await submitDocument(officer.actor, docId);
    const after = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(after.status).toBe('PENDING_APPROVAL');
    expect(after.contentSnapshot).toContain('Avery Brown');
    expect(after.contentSnapshot).not.toContain('[MISSING:');
  });

  it('the creator cannot approve; an HR officer cannot approve (D.8)', async () => {
    await expect(approveDocument(officer.actor, docId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('HR Manager approval binds attestation to checksum and renders exactly one PDF', async () => {
    await approveDocument(manager.actor, docId);
    const d = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(d.status).toBe('RENDERED');
    expect(d.pdfObjectKey).toBeTruthy();
    expect(d.pdfChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(d.contentSnapshot).toContain('S2 Manager');

    const attestation = await prisma.attestation.findFirstOrThrow({
      where: { subjectType: 'DOCUMENT', subjectId: docId },
    });
    expect(attestation.contentChecksum).toBe(d.contentChecksum);
    expect(attestation.actorRole).toBe('HR Manager');

    // Idempotent re-render: nothing changes (D.10/D.11).
    const before = { key: d.pdfObjectKey, checksum: d.pdfChecksum };
    await renderApprovedDocument(docId, 'test-correlation');
    const again = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(again.pdfObjectKey).toBe(before.key);
    expect(again.pdfChecksum).toBe(before.checksum);
  });

  it('a second HR Manager could also approve pending docs, but a decided one cannot be re-approved', async () => {
    await expect(approveDocument(manager2.actor, docId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('authorized download verifies the checksum; unauthorized roles get nothing', async () => {
    const dl = await downloadDocumentPdf(officer.actor, docId);
    expect(dl.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(downloadDocumentPdf(itResponder.actor, docId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('material case correction supersedes the rendered doc, invalidates the approval, and opens v+1 (D.12/N.6)', async () => {
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

describe('UAT-4 defect fix: submitter-based maker-checker (Directive 5)', () => {
  it('supersede-recreated draft works in a single-manager org (submitter is the maker)', async () => {
    // The audited correction above left a system-created DRAFT replacement.
    const draft = await prisma.documentInstance.findFirstOrThrow({
      where: { caseId: testCaseId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });
    // The OFFICER validates and submits it - the officer is the maker.
    await submitDocument(officer.actor, draft.id);
    // The (only) manager may approve: two distinct humans attested it.
    await approveDocument(manager.actor, draft.id);
    const approved = await prisma.documentInstance.findUniqueOrThrow({ where: { id: draft.id } });
    expect(approved.status).toBe('RENDERED');
    expect(approved.submittedById).toBe(officer.userId);

    // Manual supersede by the manager reproduces the UAT-4 single-manager
    // deadlock shape: the corrected draft is created UNDER THE MANAGER.
    const { supersedeAndRecreate } = await import('../src/services/documentService.ts');
    const replacement = await supersedeAndRecreate(
      manager.actor,
      draft.id,
      'UAT-4: corrected after an audited case change.',
    );
    expect(replacement.createdById).toBe(manager.userId);
    await submitDocument(officer.actor, replacement.id);
    await approveDocument(manager.actor, replacement.id); // no deadlock
  });

  it('keeps the control: the submitter can never also approve', async () => {
    const { supersedeAndRecreate } = await import('../src/services/documentService.ts');
    const rendered = await prisma.documentInstance.findFirstOrThrow({
      where: { caseId: testCaseId, status: 'RENDERED' },
      orderBy: { version: 'desc' },
    });
    const replacement = await supersedeAndRecreate(
      manager.actor,
      rendered.id,
      'UAT-4: second correction to prove the submitter block.',
    );
    // The manager submits their own recreated draft, then tries to approve.
    await submitDocument(manager.actor, replacement.id);
    await expect(approveDocument(manager.actor, replacement.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // A DIFFERENT manager may approve (distinct submitter and approver).
    await approveDocument(manager2.actor, replacement.id);
  });
});
