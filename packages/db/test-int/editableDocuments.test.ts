/**
 * Editable generated documents, version history and signed-document
 * protection (owner directive 2026-09-23, DEC-069). Synthetic data only.
 *
 * What these tests protect:
 *
 *  - a generated letter can be reworded by HR, but the case facts it carries
 *    cannot be removed or contradicted;
 *  - every save is a revision that is kept, never an overwrite of the only
 *    copy, and the revision log cannot be altered by the runtime role;
 *  - a PDF exists at every stage and the draft one says it is a draft;
 *  - a signed form version is never modified in place: a change is a new
 *    version, the old one is kept, its open signing requests stop working.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RESIGNATION_ACCEPTANCE_LETTER_BODY, blocksForSigner } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import {
  createLetterDraft,
  finalizeDocument,
  getCaseDocuments,
  previewDocumentPdf,
  supersedeAndRecreate,
  updateDraftBody,
} from '../src/services/documentService.ts';
import {
  createActionForm,
  getActionForm,
  previewActionFormPdf,
  startNewFormVersion,
  updateActionFormHr,
} from '../src/services/actionFormService.ts';
import {
  applyHrSignature,
  createSignatureRequest,
  getSigningLink,
  getSigningView,
  submitSignatures,
} from '../src/services/signatureService.ts';
import { listRevisions } from '../src/services/revisionService.ts';
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

const DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

/** The same 24x12 PNG the signature suite uses. */
const PNG = (() => {
  const CRC = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC[n] = c;
  }
  const crc32 = (buf: Buffer) => {
    let c = -1;
    for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(24, 0);
  ihdr.writeUInt32BE(12, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(12 * (1 + 24 * 4));
  const stored: Buffer[] = [Buffer.from([0x78, 0x01])];
  const header = Buffer.alloc(5);
  header[0] = 1;
  header.writeUInt16LE(raw.length, 1);
  header.writeUInt16LE(raw.length ^ 0xffff, 3);
  stored.push(header, raw);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  stored.push(adler);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.concat(stored)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();
const MARK = `data:image/png;base64,${PNG.toString('base64')}`;

async function activeCase(employeeSourceId: string) {
  const { caseId } = await createDraft(officer.actor, { ...DRAFT, employeeSourceId });
  await transitionCase(officer.actor, caseId, 'submit');
  await transitionCase(manager.actor, caseId, 'approve');
  await readyAssignment(caseId, manager.actor, officer.userId);
  await activateCase(manager.actor, caseId);
  return caseId;
}

const auditOf = (caseId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { caseId, eventType }, orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-edit-'))));
  officer = await createUser('Edit Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Edit Other Officer', 'HR_OFFICER');
  manager = await createUser('Edit Manager', 'HR_MANAGER');
  const t = await createDraftTemplate(officer.actor, {
    documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    name: 'Edit template',
    contentBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
  });
  await activateTemplate(manager.actor, t.id);
});

describe('editing a generated letter', () => {
  it('opens editable, keeps every save as a version, and prints the edit in the PDF', async () => {
    const caseId = await activeCase('EMP-TEST-001');
    await setEmployeeAddress(officer.actor, caseId, { employeeAddress: '1 Fictional Way' });
    const doc = await createLetterDraft(officer.actor, caseId);

    // Generated: one revision already.
    expect(await listRevisions('LETTER', doc.id)).toMatchObject([
      { revision: 1, kind: 'GENERATED' },
    ]);

    // Add words, remove words.
    const added = `${RESIGNATION_ACCEPTANCE_LETTER_BODY}\n\nWe thank you for your service and wish you well.`;
    const first = await updateDraftBody(officer.actor, doc.id, added);
    expect(first).toMatchObject({ changed: true, revision: 2 });
    const trimmed = added.replace(
      'We thank you for your service and wish you well.',
      'We wish you well.',
    );
    const second = await updateDraftBody(officer.actor, doc.id, trimmed);
    expect(second).toMatchObject({ changed: true, revision: 3 });

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.editedBody).toContain('We wish you well.');
    expect(row.editedBody).not.toContain('thank you for your service');
    // The template itself is untouched.
    const template = await prisma.documentTemplate.findUniqueOrThrow({
      where: { id: doc.templateId! },
    });
    expect(template.contentBody).toBe(RESIGNATION_ACCEPTANCE_LETTER_BODY);

    const revisions = await listRevisions('LETTER', doc.id);
    expect(revisions.map((r) => r.kind)).toEqual(['EDITED', 'EDITED', 'GENERATED']);
    expect(revisions[0]!.editedByName).toBe('Edit Officer');
    expect(await auditOf(caseId, 'DOC_CONTENT_EDITED')).toHaveLength(2);

    // The draft PDF exists before finalization and says it is a draft.
    const preview = await previewDocumentPdf(officer.actor, doc.id);
    expect(preview.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(preview.fileName).toContain('draft');

    // Finalizing uses the edited wording, not the template's.
    await finalizeDocument(officer.actor, doc.id);
    const finalized = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(finalized.contentSnapshot).toContain('We wish you well.');
    expect(finalized.contentSnapshot).not.toContain('[[');
    expect((await listRevisions('LETTER', doc.id))[0]!.kind).toBe('FINALIZED');

    // The page data carries the edited body and the history.
    const view = await getCaseDocuments(officer.actor, caseId);
    expect(view.revisions[doc.id]!.length).toBe(4);
  });

  it('protects the case facts: a removed fact is refused, a wrong fact is corrected on the case', async () => {
    const caseId = await activeCase('EMP-TEST-002');
    await setEmployeeAddress(officer.actor, caseId, { employeeAddress: '2 Fictional Way' });
    const doc = await createLetterDraft(officer.actor, caseId);
    const withoutName = RESIGNATION_ACCEPTANCE_LETTER_BODY.replace(
      '[[EMPLOYEE_LEGAL_NAME]]',
      'Somebody Else',
    );
    await expect(updateDraftBody(officer.actor, doc.id, withoutName)).rejects.toMatchObject({
      details: [expect.stringMatching(/Employee legal name is a case fact/)],
    });
    await expect(
      updateDraftBody(
        officer.actor,
        doc.id,
        `${RESIGNATION_ACCEPTANCE_LETTER_BODY}<script>x</script>`,
      ),
    ).rejects.toMatchObject({ details: [expect.stringMatching(/plain text/)] });
    // Nothing was written by the refused saves.
    expect(await listRevisions('LETTER', doc.id)).toHaveLength(1);
  });

  it('is finalized-then-locked, and a correction carries the wording into the new version', async () => {
    const caseId = await activeCase('EMP-TEST-003');
    await setEmployeeAddress(officer.actor, caseId, { employeeAddress: '3 Fictional Way' });
    const doc = await createLetterDraft(officer.actor, caseId);
    await updateDraftBody(
      officer.actor,
      doc.id,
      `${RESIGNATION_ACCEPTANCE_LETTER_BODY}\n\nKept wording.`,
    );
    await finalizeDocument(officer.actor, doc.id);
    await expect(updateDraftBody(officer.actor, doc.id, 'anything')).rejects.toThrow(/finalized/i);

    // Wait for the render so the version can be superseded.
    await new Promise((r) => setTimeout(r, 50));
    const replacement = await supersedeAndRecreate(officer.actor, doc.id, 'Date corrected.');
    expect(replacement.editedBody).toContain('Kept wording.');
    const history = await listRevisions('LETTER', replacement.id);
    expect(history[0]).toMatchObject({ kind: 'GENERATED' });
    expect(history[0]!.note).toContain('keeping its edited wording');
  });

  it('refuses edits from an officer who does not own the case', async () => {
    const caseId = await activeCase('EMP-TEST-004');
    const doc = await createLetterDraft(officer.actor, caseId);
    await expect(
      updateDraftBody(otherOfficer.actor, doc.id, `${RESIGNATION_ACCEPTANCE_LETTER_BODY}\n\nx`),
    ).rejects.toThrow();
    await expect(previewDocumentPdf(otherOfficer.actor, doc.id)).resolves.toBeTruthy();
  });
});

describe('the revision log', () => {
  it('cannot be altered by the runtime role', async () => {
    const caseId = await activeCase('EMP-TEST-005');
    const doc = await createLetterDraft(officer.actor, caseId);
    const [rev] = await listRevisions('LETTER', doc.id);
    // The trigger refuses updates and deletes even for the schema owner.
    await expect(
      prisma.documentRevision.update({ where: { id: rev!.id }, data: { note: 'tampered' } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.documentRevision.delete({ where: { id: rev!.id } })).rejects.toThrow(
      /immutable/,
    );
  });
});

describe('the action form', () => {
  it('keeps every save as a version and offers a PDF before completion', async () => {
    const caseId = await activeCase('EMP-TEST-006');
    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, { hrRemarks: 'First remark.' });
    await updateActionFormHr(officer.actor, form.id, { hrRemarks: 'Second remark, corrected.' });
    const revisions = await listRevisions('ACTION_FORM', form.id);
    expect(revisions.map((r) => r.kind)).toEqual(['EDITED', 'EDITED', 'GENERATED']);
    const preview = await previewActionFormPdf(officer.actor, form.id);
    expect(preview.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(preview.fileName).toContain('draft');
    const view = await getActionForm(officer.actor, caseId);
    expect(view.revisions).toHaveLength(3);
    expect(view.signedLock).toBe(false);
  });

  it('never modifies a signed version silently: a change is a new version, the old one is kept', async () => {
    const caseId = await activeCase('EMP-TEST-007');
    const form = await createActionForm(officer.actor, caseId);
    await updateActionFormHr(officer.actor, form.id, { hrRemarks: 'Before signing.' });

    // The employee signs by link; the officer signs in the application.
    const request = await createSignatureRequest(officer.actor, form.id, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, request.id);
    const token = url.split('/sign/')[1]!;
    expect(
      await submitSignatures(token, {
        marks: blocksForSigner('EMPLOYEE').map((b) => ({ blockKey: b.key, dataUrl: MARK })),
        consented: true,
      }),
    ).toEqual({ ok: true });
    // HR's checklist work after the employee signed is not a change to what
    // the employee signed...
    await updateActionFormHr(officer.actor, form.id, {
      hrRemarks: 'HR note after employee signed.',
    });
    // ...but the acknowledgement the employee signed is.
    await expect(
      updateActionFormHr(officer.actor, form.id, { ackStatus: 'NOT_OBTAINED', ackReason: 'no' }),
    ).rejects.toThrow(/employee has signed/i);
    await applyHrSignature(officer.actor, form.id, { dataUrl: MARK });
    await expect(
      updateActionFormHr(officer.actor, form.id, { hrRemarks: 'After HR signed.' }),
    ).rejects.toThrow(/Your signature is on this version/i);

    const before = await getActionForm(officer.actor, caseId);
    expect(before.signedLock).toBe(true);

    // A second, open request on the same version must stop working.
    const openRequest = await prisma.signatureRequest.create({
      data: {
        caseId,
        formId: form.id,
        documentKind: 'ACTION_FORM',
        documentTitle: 'Employee Action Form',
        signerRole: 'HR_MANAGER',
        signerName: 'Someone',
        tokenHash: 'x'.repeat(64),
        tokenCiphertext: null,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        requiredBlocks: [],
        createdById: officer.userId,
      },
    });

    const next = await startNewFormVersion(officer.actor, form.id, 'Effective date corrected.');
    expect(next.version).toBe(2);

    const old = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: form.id } });
    expect(old.status).toBe('SUPERSEDED');
    expect(old.hrRemarks).toBe('HR note after employee signed.');
    // The old signatures stay with the old version; none moved.
    expect(
      await prisma.signatureRecord.count({ where: { documentId: form.id, supersededAt: null } }),
    ).toBe(5);
    expect(await prisma.signatureRecord.count({ where: { documentId: next.id } })).toBe(0);
    const revoked = await prisma.signatureRequest.findUniqueOrThrow({
      where: { id: openRequest.id },
    });
    expect(revoked.status).toBe('REVOKED');
    expect(await getSigningView(token)).toEqual({ state: 'COMPLETED' });

    const fresh = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: next.id } });
    expect(fresh.status).toBe('DRAFT');
    expect(fresh.hrRemarks).toBe('HR note after employee signed.');
    expect(fresh.ackStatus).toBe('PENDING');
    const history = await listRevisions('ACTION_FORM', next.id);
    expect(history[0]!.note).toContain('Started from version 1');
    expect((await listRevisions('ACTION_FORM', form.id))[0]!.kind).toBe('SUPERSEDED');
    expect(await auditOf(caseId, 'FORM_SUPERSEDED')).toHaveLength(1);
  });
});
