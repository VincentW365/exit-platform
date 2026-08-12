/**
 * Baseline capture, export, and the attachment quarantine boundary
 * (REQ-REPORT-020, REQ-SEC-019/020/022, IC-S1-004).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@exit/config';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import {
  baselineDashboard,
  baselineExportCsv,
  listBaselineEvents,
  recordBaselineEvent,
  supersedeBaselineEvent,
} from '../src/services/baselineService.ts';
import {
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from '../src/services/attachmentService.ts';
import { createDraft } from '../src/services/caseService.ts';
import { createUser, resetDb, VALID_DRAFT } from './helpers.ts';

const prisma = getPrisma();
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);

let officer: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;
let baselineCaseId: string;
let baselineCaseNumber: string;

beforeAll(async () => {
  await resetDb();
  setStorageForTests(new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-store-'))));
  officer = await createUser('Riley Officer', 'HR_OFFICER');
  lineMgr = await createUser('Matrix Line Manager', 'LINE_MANAGER');
  const created = await createDraft(officer.actor, VALID_DRAFT);
  baselineCaseId = created.caseId;
  baselineCaseNumber = created.caseNumber;
  // A TEST-purpose record that must never reach business reporting.
  await createDraft(officer.actor, {
    ...VALID_DRAFT,
    employeeSourceId: 'EMP-TEST-005',
    measurementCohort: null,
    recordPurpose: 'TEST',
  });
});

describe('baseline facts (BaselineDataCapturePlan)', () => {
  it('records events and missing-reason rows', async () => {
    await recordBaselineEvent(officer.actor, baselineCaseId, {
      eventType: 'DOCUMENT_ISSUED',
      occurredAt: new Date('2026-07-22T16:00:00.000Z'),
      missingReason: null,
      missingNote: null,
      detail: 'Acknowledgement letter issued by hand',
      evidenceRef: 'HR file OFF/2026 drawer 3',
    });
    await recordBaselineEvent(officer.actor, baselineCaseId, {
      eventType: 'EXIT_FEEDBACK_OFFERED',
      occurredAt: null,
      missingReason: 'NOT_RECORDED_CURRENT_PROCESS',
      missingNote: null,
      detail: null,
      evidenceRef: null,
    });
    const events = await listBaselineEvents(officer.actor, baselineCaseId);
    expect(events).toHaveLength(2);
  });

  it('corrections supersede and preserve the original (timestamp integrity)', async () => {
    const events = await listBaselineEvents(officer.actor, baselineCaseId);
    const target = events.find((e) => e.eventType === 'DOCUMENT_ISSUED')!;
    await supersedeBaselineEvent(
      officer.actor,
      target.id,
      {
        eventType: 'DOCUMENT_ISSUED',
        occurredAt: new Date('2026-07-23T14:00:00.000Z'),
        missingReason: null,
        missingNote: null,
        detail: 'Corrected: issued the following day',
        evidenceRef: 'HR file OFF/2026 drawer 3',
      },
      'Original entry used the request date by mistake.',
    );
    const after = await listBaselineEvents(officer.actor, baselineCaseId);
    const originals = after.filter((e) => e.eventType === 'DOCUMENT_ISSUED');
    expect(originals).toHaveLength(2); // original + correction, both retained
    expect(originals.some((e) => e.supersededAt !== null)).toBe(true);
    await expect(
      supersedeBaselineEvent(
        officer.actor,
        target.id,
        {
          eventType: 'DOCUMENT_ISSUED',
          occurredAt: new Date('2026-07-24T14:00:00.000Z'),
          missingReason: null,
          missingNote: null,
          detail: null,
          evidenceRef: null,
        },
        'double correction',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('dashboard and CSV export cover BASELINE OPERATIONAL cases only', async () => {
    const dash = await baselineDashboard(officer.actor);
    expect(dash).toHaveLength(1);
    expect(dash[0]!.caseNumber).toBe(baselineCaseNumber);
    expect(dash[0]!.missing.length).toBeGreaterThan(0);

    const csv = await baselineExportCsv(officer.actor);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 case; TEST-purpose case excluded
    expect(lines[1]).toContain(baselineCaseNumber);
    expect(lines[1]).toContain('2026-07-23T14:00:00.000Z'); // corrected value, not original
    expect(lines[1]).toContain('NOT_RECORDED_CURRENT_PROCESS');

    const exportAudit = await prisma.auditEvent.findFirst({
      where: { eventType: 'CASE_EXPORTED' },
    });
    expect(exportAudit).not.toBeNull();
  });

  it('non-HR roles cannot record baseline facts or export', async () => {
    await expect(
      recordBaselineEvent(lineMgr.actor, baselineCaseId, {
        eventType: 'PROCESS_COMPLETED',
        occurredAt: new Date('2026-07-25T14:00:00.000Z'),
        missingReason: null,
        missingNote: null,
        detail: null,
        evidenceRef: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(baselineExportCsv(lineMgr.actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('attachments: quarantine-first uploads (REQ-SEC-019/020/022)', () => {
  it('with no scanner configured, files stay PENDING and cannot be downloaded', async () => {
    // Default config: SCAN_MODE=disabled unless the environment overrides it.
    process.env['SCAN_MODE'] = 'disabled';
    resetConfigForTests();
    const { attachmentId, scanStatus } = await uploadAttachment(
      officer.actor,
      baselineCaseId,
      { fileName: 'resignation.pdf', declaredMime: 'application/pdf', bytes: PDF_BYTES },
      'RESIGNATION_LETTER',
    );
    expect(scanStatus).toBe('PENDING');
    await expect(downloadAttachment(officer.actor, attachmentId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('dev-passthrough marks CLEAN with an explicit no-real-scan note and allows download', async () => {
    process.env['SCAN_MODE'] = 'dev-passthrough';
    resetConfigForTests();
    const { attachmentId, scanStatus } = await uploadAttachment(
      officer.actor,
      baselineCaseId,
      { fileName: 'supporting.pdf', declaredMime: 'application/pdf', bytes: PDF_BYTES },
      'SUPPORTING_DOCUMENT',
    );
    expect(scanStatus).toBe('CLEAN');

    const listed = await listAttachments(officer.actor, baselineCaseId);
    const row = listed.find((a) => a.id === attachmentId)!;
    expect(row.scanNote).toContain('no real malware scan');

    const dl = await downloadAttachment(officer.actor, attachmentId);
    expect(Buffer.from(dl.bytes).subarray(0, 4).toString('latin1')).toBe('%PDF');

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'FILE_DOWNLOADED', objectId: attachmentId },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects disallowed and oversized content server-side', async () => {
    await expect(
      uploadAttachment(
        officer.actor,
        baselineCaseId,
        { fileName: 'macro.docm', declaredMime: 'application/pdf', bytes: PDF_BYTES },
        'SUPPORTING_DOCUMENT',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      uploadAttachment(
        officer.actor,
        baselineCaseId,
        {
          fileName: 'huge.pdf',
          declaredMime: 'application/pdf',
          bytes: new Uint8Array(11 * 1024 * 1024).fill(0x25),
        },
        'SUPPORTING_DOCUMENT',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('a REJECTED file cannot be downloaded even by authorized HR', async () => {
    const { attachmentId } = await uploadAttachment(
      officer.actor,
      baselineCaseId,
      { fileName: 'rejected-later.pdf', declaredMime: 'application/pdf', bytes: PDF_BYTES },
      'SUPPORTING_DOCUMENT',
    );
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: 'REJECTED', scanNote: 'synthetic rejection for test' },
    });
    await expect(downloadAttachment(officer.actor, attachmentId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('a stored-object checksum mismatch blocks the download (integrity)', async () => {
    const { attachmentId } = await uploadAttachment(
      officer.actor,
      baselineCaseId,
      { fileName: 'tampered.pdf', declaredMime: 'application/pdf', bytes: PDF_BYTES },
      'SUPPORTING_DOCUMENT',
    );
    // Simulate on-disk tampering by changing the recorded checksum.
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { checksum: '0'.repeat(64) },
    });
    await expect(downloadAttachment(officer.actor, attachmentId)).rejects.toThrow(
      /integrity check/,
    );
  });

  it('rejects filenames with control or bidirectional-override characters', async () => {
    for (const name of ['evil\u202efdp.pdf', 'bad\u0007name.pdf', 'tab\tname.pdf']) {
      await expect(
        uploadAttachment(
          officer.actor,
          baselineCaseId,
          { fileName: name, declaredMime: 'application/pdf', bytes: PDF_BYTES },
          'SUPPORTING_DOCUMENT',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('rejects a double-extension executable masquerade', async () => {
    await expect(
      uploadAttachment(
        officer.actor,
        baselineCaseId,
        { fileName: 'report.pdf.exe', declaredMime: 'application/pdf', bytes: PDF_BYTES },
        'SUPPORTING_DOCUMENT',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('departmental roles cannot download case files', async () => {
    const it2 = await createUser('Sam IT', 'IT_RESPONDER');
    const listed = await listAttachments(officer.actor, baselineCaseId);
    await expect(downloadAttachment(it2.actor, listed[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
