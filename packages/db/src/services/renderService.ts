/**
 * Deterministic server-side PDF rendering (Directive 2 section E) via pdfkit:
 * pure JS, standard PDF fonts, no desktop dependency. Metadata is scrubbed of
 * developer identity and paths; CreationDate is pinned to the approval instant
 * so re-rendering the same version is byte-identical (idempotent).
 */
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { formatInstant } from '@exit/domain';
import { getStorage, newObjectKey } from '../storage.ts';

const PRODUCER = "Bert's Auto Parts - Offboarding Platform";

export interface RenderedPdf {
  objectKey: string;
  checksum: string;
  byteLength: number;
}

interface LetterRenderInput {
  title: string;
  confidentiality: string;
  caseReference: string;
  documentReference: string;
  templateVersion: string;
  documentVersion: string;
  bodyText: string;
  approverName: string;
  approverTitle: string;
  approvedAt: Date;
  attestationNote: string;
}

function newDoc(deterministicDate: Date, title: string): InstanceType<typeof PDFDocument> {
  return new PDFDocument({
    size: 'LETTER',
    margins: { top: 72, bottom: 72, left: 72, right: 72 },
    bufferPages: true,
    info: {
      Title: title,
      Author: PRODUCER,
      Creator: PRODUCER,
      Producer: PRODUCER,
      CreationDate: deterministicDate,
      ModDate: deterministicDate,
    },
  });
}

function collect(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: InstanceType<typeof PDFDocument>, confidentiality: string): void {
  doc.font('Helvetica-Bold').fontSize(14).text("BERT'S AUTO PARTS LTD.", { align: 'left' });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555555')
    .text('DEVELOPMENT BRANDING - approved company brand asset required before pilot', {
      align: 'left',
    });
  doc.moveDown(0.3);
  doc.fillColor('#8a1f11').fontSize(9).font('Helvetica-Bold').text(confidentiality.toUpperCase());
  doc.fillColor('black');
  doc.moveDown(0.8);
}

function footer(doc: InstanceType<typeof PDFDocument>, refLine: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 54;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555555')
      .text(`${refLine}  |  Page ${i + 1} of ${range.count}`, 72, bottom, {
        width: doc.page.width - 144,
        align: 'center',
        lineBreak: false,
      });
    doc.fillColor('black');
  }
}

export async function renderLetterPdf(input: LetterRenderInput): Promise<RenderedPdf> {
  const doc = newDoc(input.approvedAt, input.title);
  header(doc, input.confidentiality);

  doc.font('Helvetica-Bold').fontSize(12).text(input.title);
  doc.moveDown(0.8);

  doc.font('Helvetica').fontSize(11);
  for (const para of input.bodyText.split(/\n{2,}/)) {
    doc.text(para.replace(/\n/g, ' ').trim(), { align: 'left', lineGap: 2 });
    doc.moveDown(0.7);
  }

  doc.moveDown(1);
  doc.font('Helvetica-Bold').text(input.approverName);
  doc.font('Helvetica').text(input.approverTitle);
  doc
    .fontSize(9)
    .fillColor('#555555')
    .text(
      `Approved in the Offboarding Platform on ${formatInstant(input.approvedAt)} (America/Jamaica). ${input.attestationNote}`,
      { lineGap: 1 },
    )
    .fillColor('black');

  footer(
    doc,
    `${input.caseReference}  ${input.documentReference}  template ${input.templateVersion}  document ${input.documentVersion}`,
  );

  const bytes = await collect(doc);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const objectKey = newObjectKey();
  await getStorage().put(objectKey, bytes);
  return { objectKey, checksum, byteLength: bytes.byteLength };
}

interface FormRenderInput {
  confidentiality: string;
  caseReference: string;
  formVersion: string;
  sections: ReadonlyArray<{ heading: string; rows: ReadonlyArray<[string, string]> }>;
  approvals: ReadonlyArray<{ label: string; name: string; role: string; at: Date }>;
  approvedAt: Date;
}

export async function renderActionFormPdf(input: FormRenderInput): Promise<RenderedPdf> {
  const title = 'Employee Action Form - Offboarding';
  const doc = newDoc(input.approvedAt, title);
  header(doc, input.confidentiality);
  doc.font('Helvetica-Bold').fontSize(12).text(title);
  doc.moveDown(0.6);

  for (const section of input.sections) {
    doc.font('Helvetica-Bold').fontSize(10.5).text(section.heading);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10);
    for (const [label, value] of section.rows) {
      doc.text(`${label}: ${value || '-'}`, { indent: 12, lineGap: 1 });
    }
    doc.moveDown(0.5);
  }

  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10.5).text('Approvals (authenticated attestations)');
  doc.font('Helvetica').fontSize(10);
  for (const a of input.approvals) {
    doc.text(`${a.label}: ${a.name} (${a.role}) - ${formatInstant(a.at)} (America/Jamaica)`, {
      indent: 12,
      lineGap: 1,
    });
  }
  doc
    .moveDown(0.4)
    .fontSize(8.5)
    .fillColor('#555555')
    .text(
      'Approvals are authenticated application attestation records. This document does not constitute a qualified or advanced electronic signature. Restricted fields (reason notes, rehire eligibility) are recorded in the system and intentionally not printed.',
    )
    .fillColor('black');

  footer(doc, `${input.caseReference}  Action form ${input.formVersion}`);
  const bytes = await collect(doc);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const objectKey = newObjectKey();
  await getStorage().put(objectKey, bytes);
  return { objectKey, checksum, byteLength: bytes.byteLength };
}

/** Verify stored PDF bytes against the recorded checksum before download. */
export async function readVerifiedPdf(
  objectKey: string,
  expectedChecksum: string,
): Promise<Buffer> {
  const bytes = await getStorage().get(objectKey);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== expectedChecksum) {
    throw new Error('Stored PDF failed its integrity check.');
  }
  return bytes;
}
