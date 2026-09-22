/**
 * Resignation acceptance letter issued by email (DEC-054).
 *
 * The letter is drafted, approved and rendered through the existing
 * maker-checker chain; this suite covers the step HR asked for on top of it:
 * addressing the letter from the resignation scan, and sending the rendered
 * PDF to the employee with chosen HR colleagues copied - through the same
 * outbox and capture provider as every other email.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RESIGNATION_ACCEPTANCE_LETTER_BODY } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  createLetterDraft,
  finalizeDocument,
  refreshDraftFields,
} from '../src/services/documentService.ts';
import {
  issueDocumentByEmail,
  listHrCcContacts,
  setEmployeeAddress,
} from '../src/services/letterDeliveryService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { runReport } from '../src/services/reportingService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let otherOfficer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const ADDRESS = '14 Fictional Way,\nSt. Andrew';

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

async function activeCase(): Promise<string> {
  const created = await createDraft(officer.actor, {
    ...TEST_DRAFT,
    employeeSourceId: 'EMP-TEST-001',
  });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, created.caseId);
  return created.caseId;
}

/**
 * Draft, address, finalize and render the acceptance letter. The assigned
 * HR Officer does all of it under the case approval (DEC-066) - no manager
 * approval of the letter exists.
 */
async function renderedLetter(caseId: string): Promise<string> {
  const draft = await createLetterDraft(officer.actor, caseId);
  await setEmployeeAddress(officer.actor, caseId, { employeeAddress: ADDRESS });
  await refreshDraftFields(officer.actor, draft.id);
  await finalizeDocument(officer.actor, draft.id);
  return draft.id;
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-letter-'))));
  officer = await createUser('Letter Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Letter Other Officer', 'HR_OFFICER');
  manager = await createUser('Letter Manager', 'HR_MANAGER');
  lineMgr = await createUser('Letter Line Manager');

  // The letter under test is the canonical one the seed ships.
  const template = await createDraftTemplate(officer.actor, {
    documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    name: 'Resignation acceptance (HR sample wording)',
    contentBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
  });
  await activateTemplate(manager.actor, template.id);
});

describe('the letter is addressed from the resignation scan', () => {
  it('cannot be finalized until HR records the address', async () => {
    const caseId = await activeCase();
    const draft = await createLetterDraft(officer.actor, caseId);
    await expect(finalizeDocument(officer.actor, draft.id)).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    await setEmployeeAddress(officer.actor, caseId, { employeeAddress: ADDRESS });
    await refreshDraftFields(officer.actor, draft.id);
    await finalizeDocument(officer.actor, draft.id);
    const after = await prisma.documentInstance.findUniqueOrThrow({ where: { id: draft.id } });
    expect(['APPROVED', 'RENDERING', 'RENDERED']).toContain(after.status);
    expect(after.contentSnapshot).toContain('St. Andrew');
  });

  it('keeps the address itself out of the audit trail', async () => {
    const caseId = await activeCase();
    await setEmployeeAddress(officer.actor, caseId, { employeeAddress: ADDRESS });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { caseId, eventType: 'CASE_EMPLOYEE_ADDRESS_RECORDED' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Fictional');
    expect(audit.metadata).toMatchObject({ nowRecorded: true });
  });

  it('carries the HR sample wording, addressed and dated', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);
    const doc = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    const body = doc.contentSnapshot ?? '';
    expect(body).toContain('Re: Acknowledgement of Resignation');
    expect(body).toContain('We acknowledge receipt and acceptance of your resignation.');
    expect(body).toContain('is returned to the HR Department no later than');
    expect(body).not.toContain('[MISSING:');
    // The property-return date restates the confirmed last working day; it is
    // not a new deadline the platform invented.
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    const snap = doc.fieldSnapshot as Record<string, string>;
    expect(snap.PROPERTY_RETURN_DEADLINE).toBe(snap.CONFIRMED_LAST_WORKING_DATE);
    expect(c.confirmedLastDay).not.toBeNull();
  });
});

/**
 * Issuing an employee-facing letter stays management-grade: maker-checker on
 * DOCUMENTS was explicitly preserved, so the HR Manager who approved it is
 * the one who sends it.
 */
describe('issuing the letter by email', () => {
  it('sends the PDF to the employee, copying the chosen HR colleagues', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);

    const contacts = await listHrCcContacts(manager.actor, caseId);
    expect(contacts.length).toBeGreaterThan(0);
    // A dropdown never carries whole addresses.
    for (const contact of contacts) expect(contact.emailMask).toContain('*');

    const outcome = await issueDocumentByEmail(manager.actor, docId, {
      ccIds: [contacts[0]!.sourceId],
    });
    expect(outcome.ccCount).toBe(1);

    const doc = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.status).toBe('ISSUED_BY_EMAIL');
    expect(doc.issueMethod).toBe('EMAIL');
    expect(doc.issuedById).toBe(manager.userId);

    const record = await prisma.notificationRecord.findUniqueOrThrow({
      where: { id: outcome.recordId },
    });
    expect(record.attachedDocumentId).toBe(docId);
    expect(record.ccNames).toHaveLength(1);
    expect(record.ccMasks[0]).toContain('*');
    // The addresses are encrypted, never stored in the clear.
    expect(record.ccCiphertext).toBeTruthy();
    expect(record.ccCiphertext).not.toContain('@');

    await processOutbox(new Date());
    const sent = await prisma.notificationRecord.findUniqueOrThrow({
      where: { id: outcome.recordId },
    });
    expect(sent.status).toBe('SENT');

    // The capture records what travelled - the attachment by name and size,
    // never its bytes and never an address.
    const capture = await prisma.notificationCapture.findFirstOrThrow({
      where: { recordId: outcome.recordId },
    });
    expect(capture.note).toContain('Attached:');
    expect(capture.note).toContain('.pdf');
    expect(capture.note).toContain('Copied recipients: 1');
    expect(capture.body).not.toContain('Fictional');
  });

  it('offers every HR colleague with an email, and nobody outside HR', async () => {
    const caseId = await activeCase();
    const contacts = await listHrCcContacts(manager.actor, caseId);
    expect(contacts.length).toBeGreaterThan(0);

    const hr = await prisma.employeeSourceRecord.findMany({
      where: { department: 'Human Resources', active: true },
      select: { sourceId: true, workEmail: true },
    });
    const reachable = hr.filter((r) => r.workEmail?.trim());
    // Everyone in HR who can receive an email is offered - no more, no fewer.
    expect(contacts.map((c) => c.sourceId).sort()).toEqual(reachable.map((r) => r.sourceId).sort());

    // And nobody outside HR is on the list.
    const outside = await prisma.employeeSourceRecord.findMany({
      where: { NOT: { department: 'Human Resources' } },
      select: { sourceId: true },
    });
    const offered = new Set(contacts.map((c) => c.sourceId));
    for (const o of outside) expect(offered.has(o.sourceId)).toBe(false);
  });

  it('refuses a copied recipient who is not in Human Resources', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);
    const outsider = await prisma.employeeSourceRecord.findFirstOrThrow({
      where: { NOT: { department: 'Human Resources' }, workEmail: { not: null } },
      select: { sourceId: true },
    });
    await expect(
      issueDocumentByEmail(manager.actor, docId, { ccIds: [outsider.sourceId] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses to send twice, and the audit records masks rather than addresses', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);
    await issueDocumentByEmail(manager.actor, docId, { ccIds: [] });

    await expect(issueDocumentByEmail(manager.actor, docId, { ccIds: [] })).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { caseId, eventType: 'DOC_ISSUED_BY_EMAIL' },
    });
    const metadata = JSON.stringify(audit.metadata);
    expect(metadata).toContain('*');
    expect(metadata).not.toContain('@example.test');
  });

  it('reports how letters were issued (directive section 10)', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);
    await issueDocumentByEmail(manager.actor, docId, { ccIds: [] });

    const report = await runReport(officer.actor, 'letterIssuance', { recordPurpose: 'TEST' });
    const value = (label: string) => report.rows.find((r) => r[0] === label)?.[1];
    expect(Number(value('Letters created'))).toBeGreaterThan(0);
    expect(Number(value('Issued by: EMAIL'))).toBeGreaterThan(0);
    expect(value('Status: ISSUED_BY_EMAIL')).toBeDefined();
    expect(report.note).toContain('cannot be recalled');
  });

  it('refuses a document that was never rendered', async () => {
    const caseId = await activeCase();
    const draft = await createLetterDraft(officer.actor, caseId);
    await expect(
      issueDocumentByEmail(manager.actor, draft.id, { ccIds: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('the assigned officer issues it under the case approval; a non-owning officer is refused (DEC-066)', async () => {
    const caseId = await activeCase();
    const docId = await renderedLetter(caseId);
    await expect(
      issueDocumentByEmail(otherOfficer.actor, docId, { ccIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listHrCcContacts(otherOfficer.actor, caseId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(listHrCcContacts(officer.actor, caseId)).resolves.toBeDefined();
    const outcome = await issueDocumentByEmail(officer.actor, docId, { ccIds: [] });
    expect(outcome.destinationMask).toContain('*');
    const issued = await prisma.documentInstance.findUniqueOrThrow({ where: { id: docId } });
    expect(issued.status).toBe('ISSUED_BY_EMAIL');
    expect(issued.issuedById).toBe(officer.userId);
  });
});
