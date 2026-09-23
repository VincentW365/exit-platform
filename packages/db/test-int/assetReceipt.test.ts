/**
 * The Exit Checklist for Return Items as an editable, versioned, signable
 * document (owner directive 2026-09-23, DEC-069 sections 13, 14 and 42).
 * Synthetic data only.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  blocksForSigner,
  RETURN_ITEM_CATALOGUE,
  type ReceiptRowInput,
  type ReturnItemStatus,
} from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  finalizeReturnItemsChecklist,
  getReturnItemsChecklist,
  previewReturnItemsPdf,
  startNewReceiptVersion,
  submitReturnItemsChecklist,
  updateReturnItemsChecklist,
} from '../src/services/returnItemsService.ts';
import {
  applyHrSignature,
  createSignatureRequest,
  getSigningLink,
  getSigningView,
  submitSignatures,
} from '../src/services/signatureService.ts';
import { readVerifiedPdf } from '../src/services/renderService.ts';
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
  const header = Buffer.alloc(5);
  header[0] = 1;
  header.writeUInt16LE(raw.length, 1);
  header.writeUInt16LE(raw.length ^ 0xffff, 3);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.concat([Buffer.from([0x78, 0x01]), header, raw, adler])),
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

function rowsFrom(
  view: NonNullable<Awaited<ReturnType<typeof getReturnItemsChecklist>>>,
): ReceiptRowInput[] {
  return view.items.map((i) => ({
    id: i.id,
    itemKey: i.itemKey,
    label: i.label,
    status: i.status as ReturnItemStatus,
    remarks: i.remarks,
    quantity: i.quantity,
    condition: i.condition,
    returnedAt: i.returnedAt ? i.returnedAt.toISOString().slice(0, 10) : null,
    assetReference: i.assetReference,
  }));
}

const auditOf = (caseId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { caseId, eventType }, orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-receipt-'))));
  officer = await createUser('Receipt Officer', 'HR_OFFICER');
  otherOfficer = await createUser('Receipt Other Officer', 'HR_OFFICER');
  manager = await createUser('Receipt Manager', 'HR_MANAGER');
});

describe('the receipt is generated and editable', () => {
  it('starts as a generated draft with the company rows, editable by HR with each save kept', async () => {
    const caseId = await activeCase('EMP-TEST-001');
    const view = (await getReturnItemsChecklist(officer.actor, caseId))!;
    expect(view.version).toBe(1);
    expect(view.lifecycle).toBe('DRAFT');
    expect(view.items).toHaveLength(RETURN_ITEM_CATALOGUE.length);
    expect(view.revisions).toMatchObject([{ kind: 'GENERATED' }]);
    expect(view.editable).toBe(true);

    const rows = rowsFrom(view);
    const laptop = rows.find((r) => r.itemKey === 'LAPTOP')!;
    laptop.status = 'RETURNED';
    laptop.quantity = 1;
    laptop.condition = 'Good, charger included';
    laptop.returnedAt = '2026-09-20';
    laptop.assetReference = 'LT-0042';
    const phone = rows.find((r) => r.itemKey === 'PHONE')!;
    phone.status = 'NOT_RETURNED';
    phone.remarks = 'To be couriered next week';
    rows.push({
      id: null,
      itemKey: null,
      label: 'Company vehicle key fob',
      status: 'RETURNED',
      remarks: null,
      quantity: 1,
      condition: 'Working',
      returnedAt: '2026-09-20',
      assetReference: null,
    });
    await updateReturnItemsChecklist(officer.actor, caseId, {
      rows,
      hrNotes: 'Laptop bag not issued; nothing to return.',
      receivedByName: 'Receipt Officer',
      receivedAt: '2026-09-20',
    });

    const after = (await getReturnItemsChecklist(officer.actor, caseId))!;
    expect(after.items).toHaveLength(RETURN_ITEM_CATALOGUE.length + 1);
    const savedLaptop = after.items.find((i) => i.itemKey === 'LAPTOP')!;
    expect(savedLaptop).toMatchObject({
      status: 'RETURNED',
      quantity: 1,
      assetReference: 'LT-0042',
    });
    expect(after.items.find((i) => i.custom)?.label).toBe('Company vehicle key fob');
    expect(after.hrNotes).toContain('Laptop bag');
    expect(after.unresolved.map((i) => i.label)).toContain('Phone');
    expect(after.revisions.map((r) => r.kind)).toEqual(['EDITED', 'GENERATED']);
    expect(await auditOf(caseId, 'RETURN_CHECKLIST_EDITED')).toHaveLength(1);

    // A company row cannot be dropped; a nameless added row is refused.
    await expect(
      updateReturnItemsChecklist(officer.actor, caseId, {
        rows: rows.filter((r) => r.itemKey !== 'UNIFORMS'),
      }),
    ).rejects.toMatchObject({
      details: [expect.stringMatching(/Uniforms is on the company form/)],
    });

    // The draft PDF exists now and says draft.
    const pdf = await previewReturnItemsPdf(officer.actor, caseId);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.draft).toBe(true);

    // A non-owning officer reads it and cannot edit it.
    const readOnly = (await getReturnItemsChecklist(otherOfficer.actor, caseId))!;
    expect(readOnly.editable).toBe(false);
    await expect(
      updateReturnItemsChecklist(otherOfficer.actor, caseId, { rows }),
    ).rejects.toThrow();
  });
});

describe('signing and finalizing the receipt', () => {
  it('collects the employee and HR signatures, locks the signed version, and finalizes with a PDF', async () => {
    const caseId = await activeCase('EMP-TEST-002');
    const view = (await getReturnItemsChecklist(officer.actor, caseId))!;
    const rows = rowsFrom(view).map((r) => ({ ...r, status: 'RETURNED' as const }));
    await updateReturnItemsChecklist(officer.actor, caseId, {
      rows,
      receivedByName: 'Receipt Officer',
    });

    const request = await createSignatureRequest(officer.actor, view.id, {
      signerRole: 'EMPLOYEE',
      documentKind: 'ASSET_RECEIPT',
    });
    const url = await getSigningLink(officer.actor, request.id);
    const token = url.split('/sign/')[1]!;
    const open = await getSigningView(token);
    expect(open.state).toBe('OPEN');
    if (open.state !== 'OPEN') return;
    expect(open.view.document.kind).toBe('ASSET_RECEIPT');
    if (open.view.document.kind !== 'ASSET_RECEIPT') return;
    expect(open.view.document.receipt.rows).toHaveLength(RETURN_ITEM_CATALOGUE.length);
    expect(open.view.blocks.map((b) => b.key)).toEqual(['receiptAcknowledgement']);

    expect(
      await submitSignatures(token, {
        marks: blocksForSigner('EMPLOYEE', 'ASSET_RECEIPT').map((b) => ({
          blockKey: b.key,
          dataUrl: MARK,
        })),
        consented: true,
      }),
    ).toEqual({ ok: true });
    const signed = (await getReturnItemsChecklist(officer.actor, caseId))!;
    expect(signed.employeeAcknowledgedBy).toBe(request ? signed.employeeAcknowledgedBy : null);
    expect(signed.employeeAcknowledgedAt).not.toBeNull();
    expect(signed.hasLiveSignatures).toBe(true);
    expect(signed.editable).toBe(false);
    expect(signed.displayStatus).toBe('SIGNED');
    await expect(updateReturnItemsChecklist(officer.actor, caseId, { rows })).rejects.toThrow(
      /signed/i,
    );
    await expect(
      submitReturnItemsChecklist(
        caseId,
        { items: [], receivedByName: 'x', submittedByName: 'y' },
        { via: 'USER' },
      ),
    ).rejects.toThrow();

    await applyHrSignature(officer.actor, view.id, {
      dataUrl: MARK,
      documentKind: 'ASSET_RECEIPT',
    });
    const marks = await prisma.signatureRecord.findMany({
      where: { checklistId: view.id, supersededAt: null },
    });
    expect(marks.map((m) => m.blockKey).sort()).toEqual([
      'receiptAcknowledgement',
      'receiptReceivedBy',
    ]);
    expect(marks.every((m) => m.documentKind === 'ASSET_RECEIPT' && m.documentId === null)).toBe(
      true,
    );

    await finalizeReturnItemsChecklist(officer.actor, caseId);
    const final = (await getReturnItemsChecklist(officer.actor, caseId))!;
    expect(final.lifecycle).toBe('FINAL');
    expect(final.displayStatus).toBe('FINAL');
    expect(final.pdfObjectKey).not.toBeNull();
    const bytes = await readVerifiedPdf(final.pdfObjectKey!, final.pdfChecksum!);
    expect(bytes.byteLength).toBeGreaterThan(5_000);
    expect(await auditOf(caseId, 'RETURN_CHECKLIST_FINALIZED')).toHaveLength(1);
    // Final is immutable, and the finalized PDF is what downloads.
    await expect(finalizeReturnItemsChecklist(officer.actor, caseId)).rejects.toThrow(
      /already final/i,
    );
    expect((await previewReturnItemsPdf(officer.actor, caseId)).draft).toBe(false);
  });

  it('a change after signing is a new version; the signed version and its marks are kept', async () => {
    const caseId = await activeCase('EMP-TEST-003');
    const view = (await getReturnItemsChecklist(officer.actor, caseId))!;
    await applyHrSignature(officer.actor, view.id, {
      dataUrl: MARK,
      documentKind: 'ASSET_RECEIPT',
    });
    const openRequest = await createSignatureRequest(officer.actor, view.id, {
      signerRole: 'EMPLOYEE',
      documentKind: 'ASSET_RECEIPT',
    });

    const next = await startNewReceiptVersion(officer.actor, caseId, 'Laptop returned after all.');
    expect(next.version).toBe(2);
    const old = await prisma.returnItemsChecklist.findUniqueOrThrow({ where: { id: view.id } });
    expect(old.lifecycle).toBe('SUPERSEDED');
    expect(
      await prisma.signatureRecord.count({ where: { checklistId: view.id, supersededAt: null } }),
    ).toBe(1);
    expect(await prisma.signatureRecord.count({ where: { checklistId: next.id } })).toBe(0);
    const revoked = await prisma.signatureRequest.findUniqueOrThrow({
      where: { id: openRequest.id },
    });
    expect(revoked.status).toBe('REVOKED');

    const live = (await getReturnItemsChecklist(officer.actor, caseId))!;
    expect(live.id).toBe(next.id);
    expect(live.version).toBe(2);
    expect(live.items).toHaveLength(RETURN_ITEM_CATALOGUE.length);
    expect(live.editable).toBe(true);
    expect(live.history.map((h) => h.version)).toEqual([1]);
    expect(await auditOf(caseId, 'RETURN_CHECKLIST_SUPERSEDED')).toHaveLength(1);
  });
});
