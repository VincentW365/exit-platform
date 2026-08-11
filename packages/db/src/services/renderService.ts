/**
 * Deterministic server-side PDF rendering (Directive 2 section E) via pdfkit:
 * pure JS, standard PDF fonts, no desktop dependency. Metadata is scrubbed of
 * developer identity and paths; CreationDate is pinned to the approval instant
 * so re-rendering the same version is byte-identical (idempotent).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { BRAND, formatInstant } from '@exit/domain';
import { getConfig } from '@exit/config';
import { getStorage, newObjectKey } from '../storage.ts';

const PRODUCER = "Bert's Auto Parts - Offboarding Platform";

// Document palette: conservative professional tones, print-safe.
const INK = '#111111';
const BODY_INK = '#1a1a1a';
const MUTED = '#666666';
const FAINT = '#777777';
const RULE = '#d4d8dd';
const ACCENT = '#1f3a5f';
const CONFIDENTIAL = '#8a1f11';

/**
 * Approved brand logo for formal documents (Directive 5.1 H/I). Loaded once
 * from the controlled BRAND_LOGO_PATH; when the file is missing or unreadable
 * the header falls back to the company name - document generation NEVER fails
 * because of branding (I.5).
 */
let logoCache: Buffer | null | undefined;
function brandLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  const configured = getConfig().BRAND_LOGO_PATH;
  const candidates = [
    configured,
    path.resolve(process.cwd(), configured),
    path.resolve(process.cwd(), '..', '..', configured),
    path.resolve(process.cwd(), 'public', 'brand', BRAND.logoFileName),
  ];
  for (const p of candidates) {
    try {
      logoCache = readFileSync(p);
      return logoCache;
    } catch {
      // try the next candidate
    }
  }
  logoCache = null;
  return null;
}

/** Test hook: re-evaluate the logo path on the next render. */
export function resetBrandLogoCacheForTests(): void {
  logoCache = undefined;
}

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

/**
 * Letterhead: approved logo top-left, company legal name and confidentiality
 * tag right-aligned, closed by a rule with a short accent segment. Uses
 * absolute coordinates so the layout is identical regardless of prior state.
 */
function header(doc: InstanceType<typeof PDFDocument>, confidentiality: string): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const top = doc.page.margins.top;

  const logo = brandLogo();
  let contentBottom = top;
  if (logo) {
    // Approved company logo (aspect ratio preserved by `fit`; H.5/I.4). The
    // native asset is 1184x880, comfortably above print resolution here.
    const logoW = 88;
    const logoH = Math.round((BRAND.logoHeight / BRAND.logoWidth) * logoW); // 65
    doc.image(logo, left, top, { fit: [logoW, logoH] });
    contentBottom = top + logoH;
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(INK)
      .text(BRAND.legalName, left, top + 2, { width, align: 'right', lineBreak: false });
  } else {
    // I.5: text fallback - never fail rendering over branding.
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(INK)
      .text(BRAND.legalName, left, top, { lineBreak: false });
    contentBottom = top + 18;
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .fillColor(CONFIDENTIAL)
    .text(confidentiality.toUpperCase(), left, top + 17, {
      width,
      align: 'right',
      characterSpacing: 0.6,
      lineBreak: false,
    });

  const ruleY = Math.max(contentBottom, top + 34) + 14;
  doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(1).strokeColor(RULE).stroke();
  doc
    .moveTo(left, ruleY)
    .lineTo(left + 76, ruleY)
    .lineWidth(2.25)
    .strokeColor(ACCENT)
    .stroke();

  doc.x = left;
  doc.y = ruleY + 28;
  doc.fillColor(BODY_INK);
}

function footer(doc: InstanceType<typeof PDFDocument>, refLine: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the reserved bottom band must never trigger pagination,
    // which would emit a stray trailing page. Lift the margin while we write.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const ruleY = doc.page.height - 56;
    doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(FAINT);
    doc.text(refLine, left, ruleY + 8, {
      width: right - left - 90,
      align: 'left',
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, right - 90, ruleY + 8, {
      width: 90,
      align: 'right',
      lineBreak: false,
    });
    doc.fillColor('black');
    doc.page.margins.bottom = savedBottom;
  }
}

export async function renderLetterPdf(input: LetterRenderInput): Promise<RenderedPdf> {
  const doc = newDoc(input.approvedAt, input.title);
  header(doc, input.confidentiality);

  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .fillColor(INK)
    .text(input.title, { characterSpacing: 0.2, lineGap: 2 });
  doc.moveDown(1.1);

  // Paragraphs are separated by blank lines; single newlines inside a
  // paragraph are intentional line breaks (date line, signature block) and
  // must survive rendering.
  doc.font('Helvetica').fontSize(11).fillColor(BODY_INK);
  for (const para of input.bodyText.split(/\n{2,}/)) {
    const text = para
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    doc.text(text, { align: 'left', lineGap: 2.5 });
    doc.moveDown(0.65);
  }

  // The letter signature lives in the template body; the platform attestation
  // is deliberately fine print so it reads as a record, not a second signature.
  // It anchors to the bottom of the (last) page, just above the footer band.
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const attestY = doc.page.height - doc.page.margins.bottom - 34;
  if (doc.y + 16 > attestY) doc.addPage();
  doc.moveTo(left, attestY).lineTo(right, attestY).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.x = left;
  doc.y = attestY + 10;
  const approvedBy = input.approverName
    ? `Approved by ${input.approverName}${input.approverTitle ? `, ${input.approverTitle}` : ''}. `
    : '';
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `${approvedBy}Recorded in the Offboarding Platform on ${formatInstant(input.approvedAt)} (America/Jamaica). ${input.attestationNote}`,
      { lineGap: 1.5 },
    )
    .fillColor('black');

  footer(
    doc,
    `Case ${input.caseReference} · ${input.documentReference} · Template ${input.templateVersion} · Document ${input.documentVersion}`,
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

/** Ruled section heading; never orphaned at the bottom of a page. */
function sectionHeading(doc: InstanceType<typeof PDFDocument>, text: string): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  if (doc.y > doc.page.height - doc.page.margins.bottom - 56) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(text, left, doc.y, {
    characterSpacing: 0.2,
  });
  const ruleY = doc.y + 3;
  doc.moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.x = left;
  doc.y = ruleY + 9;
}

/** Two-column field row: muted label, dark value; wraps either side cleanly. */
function fieldRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const labelW = 200;
  if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
  const y = doc.y;
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(label, left, y, { width: labelW - 14, lineGap: 1 });
  const labelBottom = doc.y;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(BODY_INK)
    .text(value || '-', left + labelW, y, { width: right - left - labelW, lineGap: 1 });
  doc.x = left;
  doc.y = Math.max(labelBottom, doc.y) + 5;
}

export async function renderActionFormPdf(input: FormRenderInput): Promise<RenderedPdf> {
  const title = 'Employee Action Form - Offboarding';
  const doc = newDoc(input.approvedAt, title);
  header(doc, input.confidentiality);
  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .fillColor(INK)
    .text(title, { characterSpacing: 0.2, lineGap: 2 });
  doc.moveDown(1);

  for (const section of input.sections) {
    sectionHeading(doc, section.heading);
    for (const [label, value] of section.rows) {
      fieldRow(doc, label, value);
    }
    doc.moveDown(0.7);
  }

  sectionHeading(doc, 'Approvals (authenticated attestations)');
  for (const a of input.approvals) {
    fieldRow(doc, a.label, `${a.name} (${a.role}) - ${formatInstant(a.at)} (America/Jamaica)`);
  }

  if (doc.y > doc.page.height - doc.page.margins.bottom - 48) doc.addPage();
  doc.moveDown(0.5);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      'Approvals are authenticated application attestation records. This document does not constitute a qualified or advanced electronic signature. Restricted fields (reason notes, rehire eligibility) are recorded in the system and intentionally not printed.',
      { lineGap: 1.5 },
    )
    .fillColor('black');

  footer(doc, `Case ${input.caseReference} · Action form ${input.formVersion}`);
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
