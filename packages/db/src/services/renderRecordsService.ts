/**
 * PDF records for emails and the Exit Checklist for Return Items (DEC-069).
 *
 * Both follow the platform's letters and forms: the approved logo, the
 * confidentiality line, the ruled sections, standard fonts, deterministic
 * metadata. An email PDF is the message as a reader would see it, with the
 * recipient it actually went to; a receipt PDF is the company's printed
 * checklist with the recorded outcome of every row and the marks applied to
 * it. Neither is a data dump.
 */
import { createHash } from 'node:crypto';
import { formatInstant } from '@exit/domain';
import { getStorage, newObjectKey } from '../storage.ts';
import {
  BODY_INK,
  INK,
  MUTED,
  RULE,
  collect,
  draftNotice,
  fieldRow,
  footer,
  header,
  newDoc,
  sectionHeading,
  signatureRow,
  type FormRenderInput,
  type Pdf,
  type RenderedPdf,
} from './renderService.ts';

// --- email record ---------------------------------------------------------------

export interface EmailRecordRenderInput {
  kind: 'PREVIEW' | 'RECORD';
  title: string;
  caseReference: string;
  recordReference: string;
  to: Array<{ name: string | null; address: string }>;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  generatedAt: Date;
  sentAt: Date | null;
  sender: string;
  attachments: string[];
  /** The JPG banner the message carries, if any, at its own proportions. */
  banner: { bytes: Buffer; width: number; height: number } | null;
  /** Internal note for the record, never sent to the recipient. */
  note: string | null;
  /** Rehearsal delivery: where the message really went. */
  redirectedTo: string | null;
}

function paragraphs(doc: Pdf, text: string): void {
  doc.font('Helvetica').fontSize(10.5).fillColor(BODY_INK);
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = para
      .split('\n')
      .map((l) => l.replace(/\s+$/g, ''))
      .filter((l) => l.length > 0)
      .join('\n');
    if (!lines) continue;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    doc.text(lines, { align: 'left', lineGap: 2.2 });
    doc.moveDown(0.6);
  }
}

export async function renderEmailRecordPdfBytes(input: EmailRecordRenderInput): Promise<Buffer> {
  const title = input.kind === 'RECORD' ? 'Email Record' : 'Email Preview';
  const doc = newDoc(input.sentAt ?? input.generatedAt, `${title} - ${input.title}`);
  header(doc, 'Restricted - HR communication record');

  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .fillColor(INK)
    .text(`${title}: ${input.title}`, { characterSpacing: 0.2, lineGap: 2 });
  doc.moveDown(0.5);
  if (input.kind === 'PREVIEW') draftNotice(doc, 'email');
  else
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text('This is the record of a message as it was handed to the email service.', {
        lineGap: 1,
      })
      .moveDown(0.6);

  sectionHeading(doc, 'Message');
  fieldRow(
    doc,
    'To',
    input.to.map((t) => (t.name ? `${t.name} <${t.address}>` : t.address)).join('; ') || '-',
  );
  if (input.cc.length) fieldRow(doc, 'Cc', input.cc.join('; '));
  if (input.bcc.length) fieldRow(doc, 'Bcc', input.bcc.join('; '));
  fieldRow(doc, 'Subject', input.subject);
  fieldRow(doc, 'From', input.sender);
  fieldRow(
    doc,
    input.kind === 'RECORD' ? 'Sent' : 'Generated',
    formatInstant(input.sentAt ?? input.generatedAt),
  );
  if (
    input.kind === 'RECORD' &&
    input.generatedAt.getTime() !== (input.sentAt ?? input.generatedAt).getTime()
  )
    fieldRow(doc, 'Prepared', formatInstant(input.generatedAt));
  if (input.attachments.length) fieldRow(doc, 'Attachments', input.attachments.join('; '));
  if (input.redirectedTo)
    fieldRow(doc, 'Rehearsal delivery', `Diverted to the test mailbox ${input.redirectedTo}`);
  fieldRow(doc, 'Case reference', input.caseReference);
  doc.moveDown(0.5);

  sectionHeading(doc, 'Body');
  paragraphs(doc, input.body);

  if (input.banner) {
    // The supplied graphic, never stretched: fit to the text width, height
    // follows from its own proportions.
    const left = doc.page.margins.left;
    const width = Math.min(doc.page.width - doc.page.margins.left - doc.page.margins.right, 420);
    const height = Math.round((input.banner.height / input.banner.width) * width);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
    try {
      doc.image(input.banner.bytes, left, doc.y + 6, { width, height });
      doc.y += height + 12;
    } catch {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('[email banner image]');
    }
  }

  if (input.note) {
    doc.moveDown(0.5);
    sectionHeading(doc, 'Internal note');
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(input.note, { lineGap: 1.5 });
  }

  footer(
    doc,
    `${input.kind === 'PREVIEW' ? 'DRAFT PREVIEW · ' : ''}Case ${input.caseReference} · Email ${input.recordReference}`,
  );
  return collect(doc);
}

// --- exit checklist for return items ------------------------------------------------

export interface ReturnItemsRenderInput {
  draft: boolean;
  caseReference: string;
  version: number;
  employeeName: string;
  reasonForExit: string;
  dateOfExit: string;
  rows: Array<{
    number: number;
    label: string;
    group: 'KEYS' | null;
    status: string;
    remarks: string | null;
    quantity: number | null;
    condition: string | null;
    returnedAt: string | null;
    assetReference: string | null;
  }>;
  receivedByName: string | null;
  receivedAt: string | null;
  submittedByName: string | null;
  employeeAcknowledgedBy: string | null;
  hrNotes: string | null;
  outstanding: string[];
  signatures: NonNullable<FormRenderInput['signatures']>;
  renderedAt: Date;
}

const COLS = [
  { key: 'num', title: '', width: 24 },
  { key: 'item', title: 'Items', width: 138 },
  { key: 'status', title: 'Check', width: 78 },
  { key: 'detail', title: 'Qty / condition / date / ref', width: 118 },
  { key: 'remarks', title: 'Remarks', width: 0 },
] as const;

function detailOf(row: ReturnItemsRenderInput['rows'][number]): string {
  const bits: string[] = [];
  if (row.quantity != null) bits.push(`Qty ${row.quantity}`);
  if (row.condition) bits.push(row.condition);
  if (row.returnedAt) bits.push(`Returned ${row.returnedAt}`);
  if (row.assetReference) bits.push(`Ref ${row.assetReference}`);
  return bits.join(' · ') || '-';
}

function tableRow(doc: Pdf, cells: string[], opts: { bold?: boolean; head?: boolean }): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const widths: number[] = COLS.map((c) => c.width as number);
  widths[widths.length - 1] = right - left - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  doc.font(opts.bold || opts.head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  const pad = 4;
  const heights = cells.map((text, i) =>
    doc.heightOfString(text || ' ', { width: widths[i]! - pad * 2, lineGap: 1 }),
  );
  const rowH = Math.max(...heights, 12) + pad * 2;
  if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 16) {
    doc.addPage();
  }
  const top = doc.y;
  let x = left;
  doc.fillColor(opts.head ? MUTED : BODY_INK);
  cells.forEach((text, i) => {
    doc.text(text || (opts.head ? '' : '-'), x + pad, top + pad, {
      width: widths[i]! - pad * 2,
      lineGap: 1,
    });
    x += widths[i]!;
  });
  doc
    .moveTo(left, top + rowH)
    .lineTo(right, top + rowH)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke();
  doc.x = left;
  doc.y = top + rowH;
}

export async function renderReturnItemsPdfBytes(input: ReturnItemsRenderInput): Promise<Buffer> {
  const title = 'Exit Checklist for Return Items';
  const doc = newDoc(input.renderedAt, title);
  header(
    doc,
    input.draft ? 'Restricted - HR internal record - draft' : 'Restricted - HR internal record',
  );
  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .fillColor(INK)
    .text(title, { characterSpacing: 0.2, lineGap: 2 });
  doc.moveDown(0.5);
  if (input.draft) draftNotice(doc, 'checklist');

  fieldRow(doc, 'Employee', input.employeeName);
  fieldRow(doc, 'Reason for Exit', input.reasonForExit);
  fieldRow(doc, 'Date of Exit', input.dateOfExit);
  fieldRow(doc, 'Case reference', `${input.caseReference} · checklist version ${input.version}`);
  doc.moveDown(0.6);

  const main = input.rows.filter((r) => r.group !== 'KEYS');
  const keys = input.rows.filter((r) => r.group === 'KEYS');
  tableRow(
    doc,
    COLS.map((c) => c.title),
    { head: true },
  );
  for (const r of main)
    tableRow(doc, [`${r.number}.`, r.label, r.status, detailOf(r), r.remarks ?? ''], {});
  if (keys.length) {
    tableRow(doc, ['', 'Keys', '', '', ''], { bold: true });
    for (const r of keys)
      tableRow(doc, [`${r.number}.`, r.label, r.status, detailOf(r), r.remarks ?? ''], {});
  }
  doc.moveDown(0.8);

  sectionHeading(doc, 'Received By');
  fieldRow(doc, 'Items received by', input.receivedByName ?? '-');
  fieldRow(doc, 'Date', input.receivedAt ?? '-');
  fieldRow(doc, 'Completed by', input.submittedByName ?? '-');
  fieldRow(doc, 'Employee acknowledgement', input.employeeAcknowledgedBy ?? '-');

  if (input.outstanding.length) {
    doc.moveDown(0.4);
    sectionHeading(doc, 'Still outstanding');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(BODY_INK)
      .text(input.outstanding.join(', '), { lineGap: 2 });
  }

  if (input.hrNotes) {
    doc.moveDown(0.4);
    sectionHeading(doc, 'HR notes');
    paragraphs(doc, input.hrNotes);
  }

  if (input.signatures.length > 0) {
    doc.moveDown(0.4);
    sectionHeading(doc, 'Signatures');
    for (const mark of input.signatures) signatureRow(doc, mark);
  }

  footer(
    doc,
    `${input.draft ? 'DRAFT PREVIEW · ' : ''}Case ${input.caseReference} · Exit checklist v${input.version}`,
  );
  return collect(doc);
}

export async function renderReturnItemsPdf(input: ReturnItemsRenderInput): Promise<RenderedPdf> {
  const bytes = await renderReturnItemsPdfBytes(input);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const objectKey = newObjectKey();
  await getStorage().put(objectKey, bytes);
  return { objectKey, checksum, byteLength: bytes.byteLength };
}
