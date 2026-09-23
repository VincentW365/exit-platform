/**
 * Electronic initials and signatures, and long-lived signing links
 * (owner directives 2026-09-23, DEC-068). Synthetic data only.
 *
 * What these tests are really protecting:
 *
 *  - a signing link is a bearer credential, so the raw value must never be
 *    stored in the clear, never reach an audit event and never survive the
 *    end of the request it belongs to;
 *  - creating a request is not sending it, and copy, send and resend must all
 *    address ONE request rather than minting competing tokens;
 *  - a signature is evidence of who signed, never an authorization: the case
 *    approval remains the single gate;
 *  - a non-owning HR Officer may read a case but must not send, extend or
 *    revoke anything on it.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SIGNATURE_LINK_MAX_DAYS, blocksForSigner } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { decryptValue } from '../src/secretBox.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  completeActionForm,
  createActionForm,
  outdateFormsForCaseChange,
  submitActionForm,
  updateActionFormHr,
} from '../src/services/actionFormService.ts';
import { readVerifiedPdf } from '../src/services/renderService.ts';
import {
  applyHrSignature,
  createSignatureRequest,
  expireSignatureRequests,
  extendSignatureRequest,
  getSigningLink,
  getSigningView,
  listSignatureRequests,
  revokeSignatureRequest,
  sendSignatureRequestEmail,
  signatureSummaryForForm,
  signingUrlForDispatch,
  submitSignatures,
  supersedeHrSignature,
} from '../src/services/signatureService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();
const DAY = 86_400_000;

let officer: Awaited<ReturnType<typeof createUser>>;
let otherOfficer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
/** Every account this suite needs; signing must never add to it. */
let usersAfterSetup = 0;

const DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

/** A 24x12 opaque PNG: large enough to pass the inspector, small to store. */
function markPng(): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(24, 0);
  ihdr.writeUInt32BE(12, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  // One fully transparent scanline per row is enough: the inspector reads the
  // header, and the platform never interprets the pixels.
  const raw = Buffer.alloc(12 * (1 + 24 * 4));
  const idat = chunk('IDAT', deflateStore(raw));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    idat,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function deflateStore(data: Buffer): Buffer {
  // zlib stored-block framing, so the fixture needs no compression library.
  const blocks: Buffer[] = [Buffer.from([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const size = Math.min(65535, data.length - offset);
    const final = offset + size >= data.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = final;
    header.writeUInt16LE(size, 1);
    header.writeUInt16LE(size ^ 0xffff, 3);
    blocks.push(header, data.subarray(offset, offset + size));
    offset += size;
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  blocks.push(adler);
  return Buffer.concat(blocks);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ -1;
}

const MARK = `data:image/png;base64,${markPng().toString('base64')}`;

const HR_CHECKLIST = {
  caseInfoVerified: 'DONE',
  evidenceRecorded: 'DONE',
  contactVerified: 'DONE',
  benefitsInitiated: 'DONE',
  propertyProcessInitiated: 'DONE',
  accessRemovalRecorded: 'DONE',
  surveyEligibilityAssessed: 'DONE',
  hrisUpdate: 'DONE',
} as const;

/** An ACTIVE case with a draft action form, ready to collect signatures. */
async function activeCaseWithForm(employeeSourceId: string) {
  const { caseId } = await createDraft(officer.actor, { ...DRAFT, employeeSourceId });
  await transitionCase(officer.actor, caseId, 'submit');
  await transitionCase(manager.actor, caseId, 'approve');
  await readyAssignment(caseId, manager.actor, officer.userId);
  await activateCase(manager.actor, caseId);
  const form = await createActionForm(officer.actor, caseId);
  return { caseId, formId: form.id };
}

const auditOf = (caseId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { caseId, eventType }, orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-sig-'))));
  officer = await createUser('Sig Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Sig Other Officer', 'HR_OFFICER');
  manager = await createUser('Sig Manager', 'HR_MANAGER');
  usersAfterSetup = await prisma.user.count();
});

describe('creating a request', () => {
  it('issues a long-lived link, stores no readable token, and audits the request not the link', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-001');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
      signerEmail: 'avery.brown@example.test',
    });

    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('PENDING');
    // 30 days by default, not hours.
    expect(row.expiresAt.getTime() - row.issuedAt.getTime()).toBe(30 * DAY);
    expect(row.requiredBlocks).toHaveLength(blocksForSigner('EMPLOYEE').length);

    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    // Stored for lookup as a hash; stored for re-sending only as ciphertext.
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.tokenCiphertext).not.toContain(token);
    expect(decryptValue(row.tokenCiphertext!)).toBe(token);

    // No audit event anywhere on this case carries the link or the token.
    const events = await prisma.auditEvent.findMany({ where: { caseId } });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('/sign/');

    const createdEvents = await auditOf(caseId, 'SIGNATURE_REQUEST_CREATED');
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]!.objectId).toBe(created.id);

    const copied = await auditOf(caseId, 'SIGNATURE_LINK_COPIED');
    expect(copied).toHaveLength(1);
    expect(copied[0]!.objectId).toBe(created.id);
    expect(JSON.stringify(copied[0]!.metadata)).not.toContain(token);
  });

  it('refuses a second open request for the same signer on the same form', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-002');
    await createSignatureRequest(officer.actor, formId, { signerRole: 'EMPLOYEE' });
    await expect(
      createSignatureRequest(officer.actor, formId, { signerRole: 'EMPLOYEE' }),
    ).rejects.toThrow(/already open/i);
  });

  it('does not offer a signature block to a signer the form does not address', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-003');
    await expect(
      createSignatureRequest(officer.actor, formId, { signerRole: 'HR_MANAGER' }),
    ).rejects.toMatchObject({
      details: [expect.stringMatching(/nothing for that signer/i)],
    });
  });
});

describe('delivery', () => {
  it('sends and resends the SAME request rather than minting a second link', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-004');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
      signerEmail: 'avery.brown@example.test',
    });
    const first = await getSigningLink(officer.actor, created.id);

    const sent = await sendSignatureRequestEmail(officer.actor, created.id);
    expect(sent.resend).toBe(false);
    const resent = await sendSignatureRequestEmail(officer.actor, created.id);
    expect(resent.resend).toBe(true);

    // One request, one link, two outgoing messages.
    expect(await prisma.signatureRequest.count({ where: { formId } })).toBe(1);
    expect(await getSigningLink(officer.actor, created.id)).toBe(first);
    const records = await prisma.notificationRecord.findMany({
      where: { signatureRequestId: created.id },
    });
    expect(records).toHaveLength(2);
    // The stored snapshot keeps a marker; a working link is never persisted.
    for (const r of records) {
      expect(r.bodySnapshot).toContain('[signing link inserted at send time]');
      expect(r.bodySnapshot).not.toContain(first);
    }
    expect(await signingUrlForDispatch(created.id)).toBe(first);

    const emailed = await auditOf(caseId, 'SIGNATURE_REQUEST_EMAILED');
    expect(emailed).toHaveLength(2);
    expect(JSON.stringify(emailed)).not.toContain(first.split('/sign/')[1]!);
    // The destination is recorded masked, as everywhere else in the platform.
    expect((emailed[0]!.metadata as Record<string, unknown>)['destinationMask']).toMatch(/\*/);
  });

  it('records creation and delivery as separate events', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-005');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
      signerEmail: 'avery.brown@example.test',
    });
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_CREATED')).toHaveLength(1);
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_EMAILED')).toHaveLength(0);
    await sendSignatureRequestEmail(officer.actor, created.id);
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_EMAILED')).toHaveLength(1);
  });
});

describe('link lifetime', () => {
  it('extends an open link, audits before and after, and never passes the maximum', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-006');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const before = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });

    const out = await extendSignatureRequest(manager.actor, created.id, { addDays: 14 });
    expect(out.expiresAt.getTime()).toBe(before.expiresAt.getTime() + 14 * DAY);

    const events = await auditOf(caseId, 'SIGNATURE_REQUEST_EXTENDED');
    expect(events).toHaveLength(1);
    const meta = events[0]!.metadata as Record<string, unknown>;
    expect(meta['previousExpiresAt']).toBe(before.expiresAt.toISOString());
    expect(meta['expiresAt']).toBe(out.expiresAt.toISOString());

    // Repeated extension stops at the configured ceiling from issue.
    const capped = await extendSignatureRequest(manager.actor, created.id, { addDays: 90 });
    expect(capped.cappedByMaximum).toBe(true);
    expect(capped.expiresAt.getTime()).toBe(
      before.issuedAt.getTime() + SIGNATURE_LINK_MAX_DAYS * DAY,
    );
    await expect(
      extendSignatureRequest(manager.actor, created.id, { addDays: 30 }),
    ).rejects.toMatchObject({
      details: [expect.stringMatching(/maximum/i)],
    });
  });

  it('revokes immediately and destroys the link', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-007');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;

    await revokeSignatureRequest(officer.actor, created.id, 'Employee details corrected.');
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('REVOKED');
    // Nothing reusable survives; the one-way hash stays only so the signer
    // is told plainly that the request ended.
    expect(row.tokenCiphertext).toBeNull();

    expect(await getSigningView(token)).toEqual({ state: 'INVALID' });
    expect(await signingUrlForDispatch(created.id)).toBeNull();
    await expect(getSigningLink(officer.actor, created.id)).rejects.toThrow(/no longer active/i);
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_REVOKED')).toHaveLength(1);
  });

  it('expires an overdue link on the sweep and stops accepting it', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-008');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    await prisma.signatureRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });

    // The page reads it as expired before the sweep has run...
    expect(await getSigningView(token)).toEqual({ state: 'EXPIRED' });
    // ...and the sweep then ends it and destroys the link.
    expect(await expireSignatureRequests(new Date())).toBeGreaterThanOrEqual(1);
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('EXPIRED');
    // The signer still gets the expiry message rather than a blank refusal,
    // and an expired link refuses every use while it is expired.
    expect(await getSigningView(token)).toEqual({ state: 'EXPIRED' });
    expect(await signingUrlForDispatch(created.id)).toBeNull();
    await expect(getSigningLink(officer.actor, created.id)).rejects.toThrow(/no longer active/i);
    await expect(sendSignatureRequestEmail(officer.actor, created.id)).rejects.toThrow(
      /no longer active/i,
    );
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_EXPIRED')).toHaveLength(1);
  });

  it('puts an expired link back to work when HR extends it, on the same link', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-009');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    await prisma.signatureRequest.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });
    await expireSignatureRequests(new Date());
    expect(await getSigningView(token)).toEqual({ state: 'EXPIRED' });

    // Directive 2 section 11: extend or reactivate, not issue a second link.
    const out = await extendSignatureRequest(officer.actor, created.id, { addDays: 14 });
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('PENDING');
    expect(await getSigningLink(officer.actor, created.id)).toBe(url);
    const view = await getSigningView(token);
    expect(view.state).toBe('OPEN');
    const extended = await auditOf(caseId, 'SIGNATURE_REQUEST_EXTENDED');
    expect((extended.at(-1)!.metadata as Record<string, unknown>)['reactivated']).toBe(true);

    // A revoked or completed link is final and cannot be brought back.
    await revokeSignatureRequest(officer.actor, created.id, 'Finished with it.');
    await expect(extendSignatureRequest(officer.actor, created.id, { addDays: 7 })).rejects.toThrow(
      /open or expired/i,
    );
  });
});

describe('the public signing page', () => {
  it('shows only what the signer must read, and never the wider case', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-009');
    await prisma.caseNote.create({
      data: {
        caseId,
        authorId: officer.userId,
        body: 'Internal note that must never reach a signer.',
      },
    });
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const outcome = await getSigningView(url.split('/sign/')[1]!);
    expect(outcome.state).toBe('OPEN');
    if (outcome.state !== 'OPEN') return;
    const serialized = JSON.stringify(outcome.view);
    expect(serialized).not.toContain('Internal note');
    expect(serialized).not.toContain(caseId);
    expect(outcome.view.blocks).toHaveLength(blocksForSigner('EMPLOYEE').length);
    expect(await auditOf(caseId, 'SIGNATURE_LINK_OPENED')).toHaveLength(1);
  });

  it('refuses a guessed, malformed or foreign token without revealing anything', async () => {
    expect(await getSigningView('')).toEqual({ state: 'INVALID' });
    expect(await getSigningView('not-a-token')).toEqual({ state: 'INVALID' });
    expect(await getSigningView('a'.repeat(43))).toEqual({ state: 'INVALID' });
  });
});

describe('applying marks', () => {
  it('stores each placement separately, keeps the image out of the database and the audit', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-010');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    const blocks = blocksForSigner('EMPLOYEE');
    const usersBefore = await prisma.user.count();

    const outcome = await submitSignatures(token, {
      marks: blocks.map((b) => ({ blockKey: b.key, dataUrl: MARK })),
      consented: true,
      ipHash: 'hashed-address',
      userAgent: 'integration-test',
    });
    expect(outcome).toEqual({ ok: true });

    // One row per placement, even though one drawn set of initials was reused.
    const records = await prisma.signatureRecord.findMany({ where: { documentId: formId } });
    expect(records).toHaveLength(blocks.length);
    for (const r of records) {
      expect(r.storageKey).toMatch(/^signature\/[a-f0-9]{48}$/);
      expect(r.checksum).toHaveLength(64);
    }
    // The base64 payload is in object storage, not in a case column.
    expect(JSON.stringify(records)).not.toContain('base64');
    const applied = await auditOf(caseId, 'SIGNATURE_APPLIED');
    expect(applied).toHaveLength(blocks.length);
    expect(JSON.stringify(applied)).not.toContain(MARK.slice(30, 60));

    // Signing never creates a platform identity for the signer.
    expect(await prisma.user.count()).toBe(usersBefore);

    // The decision is data, recorded apart from the images.
    const form = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    expect(form.ackStatus).toBe('ACKNOWLEDGED');
    const completed = await auditOf(caseId, 'SIGNATURE_REQUEST_COMPLETED');
    expect(completed).toHaveLength(1);
    expect((completed[0]!.metadata as Record<string, unknown>)['consent']).toContain(
      'I confirm that the signature',
    );
  });

  it('accepts one submission only, and the link then says so', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-011');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    const marks = blocksForSigner('EMPLOYEE').map((b) => ({ blockKey: b.key, dataUrl: MARK }));

    expect(await submitSignatures(token, { marks, consented: true })).toEqual({ ok: true });
    expect(await submitSignatures(token, { marks, consented: true })).toEqual({
      ok: false,
      state: 'COMPLETED',
    });
    // Reopening the link says it was completed, in the owner's own wording.
    expect(await getSigningView(token)).toEqual({ state: 'COMPLETED' });
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('SIGNED');
    expect(row.tokenCiphertext).toBeNull();
    await expect(getSigningLink(officer.actor, created.id)).rejects.toThrow(/no longer active/i);
  });

  it('refuses a partial submission, an unticked declaration and a foreign block', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-012');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    const blocks = blocksForSigner('EMPLOYEE');
    const all = blocks.map((b) => ({ blockKey: b.key, dataUrl: MARK }));

    const noConsent = await submitSignatures(token, { marks: all, consented: false });
    expect(noConsent.ok).toBe(false);
    const partial = await submitSignatures(token, { marks: all.slice(0, 1), consented: true });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors?.join(' ')).toMatch(/needed for/i);

    // A block the employee does not own cannot be smuggled in.
    const foreign = await submitSignatures(token, {
      marks: [...all, { blockKey: 'hrCompletion', dataUrl: MARK }],
      consented: true,
    });
    expect(foreign.ok).toBe(false);
    // Nothing was written, and the request is still open.
    expect(await prisma.signatureRecord.count({ where: { documentId: formId } })).toBe(0);
    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('PENDING');
  });

  it('rejects an image that is not a PNG signature', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-013');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;
    const bad = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+';
    const outcome = await submitSignatures(token, {
      marks: blocksForSigner('EMPLOYEE').map((b) => ({ blockKey: b.key, dataUrl: bad })),
      consented: true,
    });
    expect(outcome.ok).toBe(false);
    expect(await prisma.signatureRecord.count({ where: { documentId: formId } })).toBe(0);
  });
});

describe('the HR signature applied in the application', () => {
  it('records the officer, and a correction supersedes rather than erases', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-011');
    await applyHrSignature(officer.actor, formId, { dataUrl: MARK });
    const first = await prisma.signatureRecord.findFirstOrThrow({
      where: { documentId: formId, blockKey: 'hrCompletion' },
    });
    expect(first.signerReference).toBe(officer.userId);
    expect(first.signerRole).toBe('HR_OFFICER');
    expect(first.requestId).toBeNull();

    // No second live signature can be stacked on the same block.
    await expect(applyHrSignature(officer.actor, formId, { dataUrl: MARK })).rejects.toThrow(
      /already on this (form|document)/i,
    );

    await supersedeHrSignature(officer.actor, formId, 'Signed in the wrong box.');
    await applyHrSignature(officer.actor, formId, { dataUrl: MARK });

    // Both marks survive; only the live one is presented or printed.
    const all = await prisma.signatureRecord.findMany({
      where: { documentId: formId, blockKey: 'hrCompletion' },
    });
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.supersededAt === null)).toHaveLength(1);
    const summary = await signatureSummaryForForm(formId);
    expect(summary.applied.filter((s) => s.blockKey === 'hrCompletion')).toHaveLength(1);
    expect(await auditOf(caseId, 'SIGNATURE_SUPERSEDED')).toHaveLength(1);
  });
});

describe('the final PDF', () => {
  it('renders the applied marks and locks them, and a correction revokes what is open', async () => {
    const { formId } = await activeCaseWithForm('EMP-TEST-012');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    await submitSignatures(url.split('/sign/')[1]!, {
      marks: blocksForSigner('EMPLOYEE').map((b) => ({ blockKey: b.key, dataUrl: MARK })),
      consented: true,
    });
    // DEC-069 section 5: HR's checklist work after the employee signed is
    // allowed; the HR signature then locks the version, so it is applied last.
    await updateActionFormHr(officer.actor, formId, { hrChecklist: HR_CHECKLIST });
    await applyHrSignature(officer.actor, formId, { dataUrl: MARK });
    await expect(
      updateActionFormHr(officer.actor, formId, { hrRemarks: 'Changed after signing' }),
    ).rejects.toThrow(/Your signature is on this version/i);
    await expect(
      updateActionFormHr(officer.actor, formId, { ackStatus: 'NOT_OBTAINED', ackReason: 'x' }),
    ).rejects.toThrow(/signature/i);
    await submitActionForm(officer.actor, formId);
    await completeActionForm(officer.actor, formId);

    // The render read every mark, verified each checksum and produced a PDF.
    const form = await prisma.actionFormVersion.findUniqueOrThrow({ where: { id: formId } });
    expect(form.status).toBe('COMPLETE');
    expect(form.renderError).toBeNull();
    expect(form.pdfObjectKey).not.toBeNull();
    const bytes = await readVerifiedPdf(form.pdfObjectKey!, form.pdfChecksum!);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.byteLength).toBeGreaterThan(5_000);

    // A finalized version locks its signatures.
    await expect(applyHrSignature(officer.actor, formId, { dataUrl: MARK })).rejects.toThrow(
      /finalized/i,
    );
    await expect(
      createSignatureRequest(officer.actor, formId, { signerRole: 'EMPLOYEE' }),
    ).rejects.toThrow(/finalized/i);
  });

  it('revokes open requests when a material correction supersedes the version', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-013');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
    });
    const url = await getSigningLink(officer.actor, created.id);
    const token = url.split('/sign/')[1]!;

    await outdateFormsForCaseChange(caseId, 'Effective date corrected.');

    const row = await prisma.signatureRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe('REVOKED');
    expect(row.revokedReason).toContain('Material case correction');
    expect(await getSigningView(token)).toEqual({ state: 'INVALID' });
    expect(await auditOf(caseId, 'SIGNATURE_REQUEST_REVOKED')).toHaveLength(1);
  });
});

describe('authorization', () => {
  it('lets a non-owning HR Officer read the case but never act on a signing link', async () => {
    const { caseId, formId } = await activeCaseWithForm('EMP-TEST-014');
    const created = await createSignatureRequest(officer.actor, formId, {
      signerRole: 'EMPLOYEE',
      signerEmail: 'avery.brown@example.test',
    });

    const view = await listSignatureRequests(otherOfficer.actor, caseId);
    expect(view.requests).toHaveLength(1);
    expect(view.canManage).toBe(false);

    await expect(getSigningLink(otherOfficer.actor, created.id)).rejects.toThrow();
    await expect(sendSignatureRequestEmail(otherOfficer.actor, created.id)).rejects.toThrow();
    await expect(
      extendSignatureRequest(otherOfficer.actor, created.id, { addDays: 7 }),
    ).rejects.toThrow();
    await expect(revokeSignatureRequest(otherOfficer.actor, created.id, 'no')).rejects.toThrow();
    await expect(
      createSignatureRequest(otherOfficer.actor, formId, { signerRole: 'EMPLOYEE' }),
    ).rejects.toThrow();

    // The HR Manager retains every intervention.
    expect(await listSignatureRequests(manager.actor, caseId)).toMatchObject({ canManage: true });
  });

  it('grants an external signer no platform role at all', async () => {
    // Every signer in this suite has signed by link without an account; the
    // platform's only roles remain the two it defines (DEC-063).
    const roles = await prisma.roleAssignment.findMany({ select: { role: true } });
    expect(new Set(roles.map((r) => r.role))).toEqual(new Set(['HR_OFFICER', 'HR_MANAGER']));
    expect(await prisma.user.count()).toBe(usersAfterSetup);
  });
});
