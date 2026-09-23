/**
 * Electronic initials and signatures (owner directives 2026-09-23, DEC-068).
 *
 * A signature REQUEST is a long-lived, revocable invitation for one named
 * signer to sign one form version. Creating it is not sending it: HR may copy
 * the secure link and share it another way, or email it from the platform,
 * and both point at the same request (directive 2 sections 9 and 20).
 *
 * Token discipline is the platform's existing one: a 256-bit CSPRNG value
 * whose sha256 hash is what the page looks up. Because a long-lived link must
 * also be copyable and re-sendable, the raw value is additionally held
 * encrypted at rest with the same box that protects recipient destinations.
 * Completion and revocation destroy that ciphertext, so nothing reusable
 * survives a final state; expiry keeps it, because the owner asked for an
 * expired link to be extended rather than replaced. The one-way hash is kept
 * throughout, only so a returning signer is told accurately which state
 * applies. The raw value never reaches a log, an audit event or a stored
 * email snapshot.
 *
 * The signature IMAGE lives in private object storage. This module records
 * who applied which mark to which block of which form version, and keeps the
 * decision (acknowledged / completed) separate from the image.
 */
import { createHash } from 'node:crypto';
import {
  blocksForSigner,
  canActOnCase,
  decodeSignatureDataUrl,
  effectiveRequestStatus,
  extendedSignatureExpiry,
  extendedSignatureExpiryErrors,
  generateSignatureToken,
  hashSignatureToken,
  isPlausibleSignatureToken,
  maskDestination,
  missingBlocks,
  pngDimensions,
  requestAcceptsSignature,
  signatureBlock,
  signatureImageErrors,
  signatureLinkLabel,
  signatureTokenMatchesHash,
  signatureLinkExpiry,
  contentChecksum,
  destinationErrors,
  hasMissingMarkers,
  substitute,
  SIGNATURE_CONSENT_TEXT,
  SIGNATURE_LINK_DEFAULT_DAYS,
  SIGNATURE_LINK_MAX_DAYS,
  SIGNER_ROLE_LABELS,
  type Actor,
  type SignatureBlock,
  type SignatureProvenance,
  type SignatureType,
  type SignerRole,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import type { PrismaClient } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { decryptValue, encryptValue } from '../secretBox.ts';
import { getStorage, newPrefixedObjectKey } from '../storage.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { enqueueOutboxTx } from './outboxService.ts';
import { routingEnvironment } from './routingService.ts';
import { loadCaseAccess } from './shared.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export const SIGNATURE_VALID_DAYS_KEY = 'signature.linkValidDays';
export const SIGNATURE_MAX_DAYS_KEY = 'signature.linkMaxDays';

/** Directive 2 section 26: configuration, not a constant in signing logic. */
export async function signatureLinkPolicy(): Promise<{ validDays: number; maxDays: number }> {
  const [valid, max] = await Promise.all([
    getSystemConfigValue(SIGNATURE_VALID_DAYS_KEY),
    getSystemConfigValue(SIGNATURE_MAX_DAYS_KEY),
  ]);
  return {
    validDays: typeof valid === 'number' && valid > 0 ? valid : SIGNATURE_LINK_DEFAULT_DAYS,
    maxDays: typeof max === 'number' && max > 0 ? max : SIGNATURE_LINK_MAX_DAYS,
  };
}

function signingUrl(rawToken: string): string {
  return `${getConfig().APP_BASE_URL.replace(/\/$/, '')}/sign/${rawToken}`;
}

/** The marker a stored email body carries instead of a working link. */
export const SIGNING_LINK_MARKER = '[signing link inserted at send time]';

async function loadRequest(actor: Actor, requestId: string) {
  const request = await getPrisma().signatureRequest.findUnique({
    where: { id: requestId },
    include: { form: { select: { id: true, status: true, version: true } } },
  });
  if (!request) throw ServiceError.notFound();
  const { c, ctx } = await loadCaseAccess(actor, request.caseId);
  return { request, c, ctx };
}

/** Manage = create, copy, email, extend, revoke: the assigned officer or the manager. */
function assertCanManage(actor: Actor, ctx: Parameters<typeof canActOnCase>[2]): void {
  if (!canActOnCase(actor, 'form.edit', ctx)) throw ServiceError.forbidden();
}

// --- creating a request ---------------------------------------------------------

export async function createSignatureRequest(
  actor: Actor,
  formId: string,
  input: { signerRole: SignerRole; signerName?: string; signerEmail?: string | null },
): Promise<{ id: string; expiresAt: Date }> {
  const prisma = getPrisma();
  const form = await prisma.actionFormVersion.findUnique({ where: { id: formId } });
  if (!form) throw ServiceError.notFound();
  const { c, ctx } = await loadCaseAccess(actor, form.caseId);
  if (!canActOnCase(actor, 'form.edit', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'SignatureRequest', 'create', form.caseId);
    throw ServiceError.forbidden();
  }
  if (['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'].includes(form.status))
    throw ServiceError.conflict(
      'This form version is finalized. Signatures are collected before completion.',
    );

  const blocks = blocksForSigner(input.signerRole);
  if (blocks.length === 0)
    throw ServiceError.validation(['This form has nothing for that signer to sign.']);

  // One live request per signer per form: resend and copy share it
  // (directive 2 section 9), rather than piling up duplicate requirements.
  const live = await prisma.signatureRequest.findFirst({
    where: { formId, signerRole: input.signerRole, status: 'PENDING' },
  });
  if (live)
    throw ServiceError.conflict(
      `A signature request for the ${SIGNER_ROLE_LABELS[input.signerRole].toLowerCase()} is already open on this form.`,
    );

  const email = (input.signerEmail ?? '').trim() || null;
  if (email) {
    const errors = destinationErrors(email, routingEnvironment());
    if (errors.length) throw ServiceError.validation(errors);
  }

  const policy = await signatureLinkPolicy();
  const now = new Date();
  const raw = generateSignatureToken();
  const correlationId = newCorrelationId();

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.signatureRequest.create({
      data: {
        caseId: form.caseId,
        formId,
        documentTitle: 'Employee Action Form',
        signerRole: input.signerRole,
        signerName: input.signerName?.trim() || c.employeeDisplayName,
        signerEmail: email,
        tokenHash: hashSignatureToken(raw),
        tokenCiphertext: encryptValue(raw),
        issuedAt: now,
        expiresAt: signatureLinkExpiry({
          issuedAt: now,
          validDays: policy.validDays,
          maxDays: policy.maxDays,
        }),
        requiredBlocks: blocks.map((b) => b.key) as string[],
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'SIGNATURE_REQUEST_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SignatureRequest',
      objectId: request.id,
      caseId: form.caseId,
      result: 'SUCCESS',
      correlationId,
      // Request id, never the token (directive 2 sections 16 and 21).
      metadata: {
        signerRole: input.signerRole,
        documentTitle: request.documentTitle,
        formVersion: form.version,
        blocks: blocks.length,
        expiresAt: request.expiresAt.toISOString(),
        destinationMask: email ? maskDestination(email) : null,
      },
    });
    return request;
  });
  return { id: created.id, expiresAt: created.expiresAt };
}

// --- delivery -------------------------------------------------------------------

/**
 * The full signing URL, for HR to share through another approved channel.
 * Audited as a copy - with the request id, never the link.
 */
export async function getSigningLink(actor: Actor, requestId: string): Promise<string> {
  const { request, ctx } = await loadRequest(actor, requestId);
  assertCanManage(actor, ctx);
  if (!request.tokenCiphertext || !requestAcceptsSignature({ ...request, now: new Date() }))
    throw ServiceError.conflict('This signing request is no longer active.');
  const raw = decryptValue(request.tokenCiphertext);
  await appendAudit(getPrisma(), {
    eventType: 'SIGNATURE_LINK_COPIED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'SignatureRequest',
    objectId: request.id,
    caseId: request.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { signerRole: request.signerRole, documentTitle: request.documentTitle },
  });
  return signingUrl(raw);
}

/**
 * Email the SAME active request. A resend reuses the live link rather than
 * issuing a second one (directive 2 section 10), so a signer who kept the
 * first message is never left with two competing requests.
 */
export async function sendSignatureRequestEmail(
  actor: Actor,
  requestId: string,
  input: { email?: string | null } = {},
): Promise<{ destinationMask: string; resend: boolean }> {
  const { request, c, ctx } = await loadRequest(actor, requestId);
  assertCanManage(actor, ctx);
  const now = new Date();
  if (!requestAcceptsSignature({ ...request, now }))
    throw ServiceError.conflict('This signing request is no longer active.');

  const email = (input.email ?? request.signerEmail ?? '').trim();
  if (!email) throw ServiceError.validation(['Enter the email address to send the request to.']);
  const destErrors = destinationErrors(email, routingEnvironment());
  if (destErrors.length) throw ServiceError.validation(destErrors);

  const prisma = getPrisma();
  const template = await prisma.notificationTemplate.findFirst({
    where: { notificationType: 'SIGNATURE_REQUEST', status: 'ACTIVE' },
  });
  if (!template)
    throw ServiceError.validation([
      'No ACTIVE signature-request email template exists. Activate one under Administration.',
    ]);

  const { hrSenderFor } = await import('./notificationService.ts');
  const sender = await hrSenderFor(request.caseId);
  const values: Record<string, string> = {
    EMPLOYEE_LEGAL_NAME: c.employeeDisplayName,
    EMPLOYEE_FIRST_NAME: c.employeeDisplayName.split(/\s+/)[0] ?? c.employeeDisplayName,
    CASE_REFERENCE: c.caseNumber,
    DOCUMENT_TITLE: request.documentTitle,
    // Resolved at dispatch from the request itself: no stored snapshot ever
    // holds a working signing link (directive 2 section 16).
    SIGNING_LINK: SIGNING_LINK_MARKER,
    SIGNING_LINK_EXPIRY: signatureLinkLabel(request.expiresAt),
    HR_SENDER_NAME: sender.name,
    HR_SENDER_TITLE: sender.title,
  };
  const subject = substitute(template.subjectTemplate, values);
  const body = substitute(template.bodyTemplate, values);
  if (hasMissingMarkers(subject) || hasMissingMarkers(body))
    throw ServiceError.validation([
      'The signature-request template needs information this case does not hold.',
    ]);

  const resend = request.sentCount > 0;
  const mask = maskDestination(email);
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    const record = await tx.notificationRecord.create({
      data: {
        caseId: request.caseId,
        notificationType: 'SIGNATURE_REQUEST',
        templateId: template.id,
        templateVersion: template.version,
        recipientClass: template.recipientClass,
        // The HR person pressing send IS the human release for this type.
        status: 'APPROVED',
        approvedById: actor.userId,
        approvedAt: now,
        idempotencyKey: `signature:${request.id}:${request.sentCount + 1}`,
        subjectSnapshot: subject,
        bodySnapshot: body,
        contentChecksum: contentChecksum(`${subject}\n${body}`),
        fieldSnapshot: values,
        signatureRequestId: request.id,
        caseRecipientCiphertext: encryptValue(email),
        caseRecipientMask: mask,
        recipientName: request.signerName,
        recipientKind: SIGNER_ROLE_LABELS[request.signerRole],
        origin: 'MANUAL',
        controlLevel: 'AUTO_SEND',
        createdById: actor.userId,
      },
    });
    await enqueueOutboxTx(
      tx,
      {
        id: record.id,
        caseId: request.caseId,
        notificationType: 'SIGNATURE_REQUEST',
        templateVersion: template.version,
        subjectSnapshot: subject,
        contentChecksum: record.contentChecksum,
        idempotencyKey: record.idempotencyKey,
      },
      { id: null, destinationMask: mask },
      0,
      actor,
      correlationId,
    );
    const u = await tx.signatureRequest.updateMany({
      where: { id: request.id, rowVersion: request.rowVersion },
      data: {
        lastSentAt: now,
        sentCount: { increment: 1 },
        lastSentToMask: mask,
        ...(email !== request.signerEmail ? { signerEmail: email } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The request changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SIGNATURE_REQUEST_EMAILED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SignatureRequest',
      objectId: request.id,
      caseId: request.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        destinationMask: mask,
        resend,
        attempt: request.sentCount + 1,
        recipientChanged: Boolean(request.signerEmail && email !== request.signerEmail),
      },
    });
  });
  return { destinationMask: mask, resend };
}

/** Resolve the live signing URL for one outgoing message. Null if it ended. */
export async function signingUrlForDispatch(requestId: string): Promise<string | null> {
  const request = await getPrisma().signatureRequest.findUnique({
    where: { id: requestId },
    select: { tokenCiphertext: true, status: true, expiresAt: true },
  });
  if (!request?.tokenCiphertext) return null;
  if (!requestAcceptsSignature({ ...request, now: new Date() })) return null;
  try {
    return signingUrl(decryptValue(request.tokenCiphertext));
  } catch {
    return null;
  }
}

// --- lifetime -------------------------------------------------------------------

export async function extendSignatureRequest(
  actor: Actor,
  requestId: string,
  input: { addDays?: number; until?: Date; reason?: string },
): Promise<{ expiresAt: Date; cappedByMaximum: boolean }> {
  const { request, ctx } = await loadRequest(actor, requestId);
  assertCanManage(actor, ctx);
  const now = new Date();
  // Directive 2 section 11: an expired link is extended or reactivated, not
  // replaced. A completed or revoked one is final.
  if (request.status !== 'PENDING' && request.status !== 'EXPIRED')
    throw ServiceError.conflict('Only an open or expired signing request can be extended.');
  if (!request.tokenCiphertext)
    throw ServiceError.conflict(
      'This signing link can no longer be reissued. Create a new request.',
    );

  const policy = await signatureLinkPolicy();
  let outcome: { expiresAt: Date; cappedByMaximum: boolean };
  if (input.until) {
    const errors = extendedSignatureExpiryErrors({
      issuedAt: request.issuedAt,
      currentExpiry: request.expiresAt,
      requested: input.until,
      now,
      maxDays: policy.maxDays,
    });
    if (errors.length) throw ServiceError.validation(errors);
    outcome = { expiresAt: input.until, cappedByMaximum: false };
  } else {
    outcome = extendedSignatureExpiry({
      issuedAt: request.issuedAt,
      currentExpiry: request.expiresAt,
      addDays: input.addDays ?? 7,
      now,
      maxDays: policy.maxDays,
    });
  }
  if (outcome.expiresAt.getTime() <= request.expiresAt.getTime())
    throw ServiceError.validation([
      `This link already runs to the maximum ${policy.maxDays} days from when it was created. Issue a new link instead.`,
    ]);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.signatureRequest.updateMany({
      where: {
        id: request.id,
        rowVersion: request.rowVersion,
        status: { in: ['PENDING', 'EXPIRED'] },
      },
      data: {
        // Extending an expired request puts it back to work on the same
        // link, which is what "please send me a new one" actually means.
        status: 'PENDING',
        expiresAt: outcome.expiresAt,
        extendedCount: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The request changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SIGNATURE_REQUEST_EXTENDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SignatureRequest',
      objectId: request.id,
      caseId: request.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        previousExpiresAt: request.expiresAt.toISOString(),
        expiresAt: outcome.expiresAt.toISOString(),
        cappedByMaximum: outcome.cappedByMaximum,
        reactivated: request.status === 'EXPIRED',
        reason: input.reason?.trim() || null,
      },
    });
  });
  return outcome;
}

export async function revokeSignatureRequest(
  actor: Actor,
  requestId: string,
  reason: string,
): Promise<void> {
  const { request, ctx } = await loadRequest(actor, requestId);
  assertCanManage(actor, ctx);
  if (request.status !== 'PENDING')
    throw ServiceError.conflict('Only an open signing request can be revoked.');

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.signatureRequest.updateMany({
      where: { id: request.id, rowVersion: request.rowVersion, status: 'PENDING' },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: reason.trim().slice(0, 300) || null,
        // The link dies immediately: the reusable value is destroyed, so it
        // can never be copied or re-sent. The one-way hash stays so the page
        // still recognises the link and can say plainly that it is no longer
        // valid, instead of implying the signer mistyped something.
        tokenCiphertext: null,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The request changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SIGNATURE_REQUEST_REVOKED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SignatureRequest',
      objectId: request.id,
      caseId: request.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reason: reason.trim().slice(0, 300) || null, signerRole: request.signerRole },
    });
  });
}

/** Worker sweep: end overdue requests so their links stop resolving. */
export async function expireSignatureRequests(now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const stale = await prisma.signatureRequest.findMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    take: 100,
  });
  let expired = 0;
  for (const r of stale) {
    const u = await prisma.signatureRequest.updateMany({
      where: { id: r.id, rowVersion: r.rowVersion, status: 'PENDING' },
      // Expiry is the one terminal state the owner asked to be reversible
      // (extend or reactivate), so the link is kept recoverable. It still
      // refuses every use while expired; completion and revocation, which
      // are final, destroy it.
      data: { status: 'EXPIRED', rowVersion: { increment: 1 } },
    });
    if (u.count === 0) continue;
    await appendAudit(prisma, {
      eventType: 'SIGNATURE_REQUEST_EXPIRED',
      actorType: 'SYSTEM',
      objectType: 'SignatureRequest',
      objectId: r.id,
      caseId: r.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { signerRole: r.signerRole, expiresAt: r.expiresAt.toISOString() },
    });
    expired += 1;
  }
  return expired;
}

// --- the HR case view -------------------------------------------------------------

export interface SignatureRequestCard {
  id: string;
  signerRole: SignerRole;
  signerLabel: string;
  signerName: string;
  documentTitle: string;
  status: ReturnType<typeof effectiveRequestStatus>;
  destinationMask: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastSentAt: Date | null;
  sentCount: number;
  signedAt: Date | null;
  revokedReason: string | null;
  appliedBlocks: number;
  requiredBlocks: number;
}

export async function listSignatureRequests(
  actor: Actor,
  caseId: string,
): Promise<{
  requests: SignatureRequestCard[];
  signatures: Array<{
    id: string;
    blockKey: string;
    blockLabel: string;
    signatureType: SignatureType;
    signerName: string;
    signerRole: SignerRole;
    signedAt: Date;
    provenance: string;
  }>;
  canManage: boolean;
}> {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'form.view', ctx)) throw ServiceError.notFound();
  const prisma = getPrisma();
  const [requests, signatures] = await Promise.all([
    prisma.signatureRequest.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { signatures: { where: { supersededAt: null } } } } },
    }),
    prisma.signatureRecord.findMany({
      where: { caseId, supersededAt: null },
      orderBy: { signedAt: 'asc' },
    }),
  ]);
  const now = new Date();
  return {
    requests: requests.map((r) => ({
      id: r.id,
      signerRole: r.signerRole,
      signerLabel: SIGNER_ROLE_LABELS[r.signerRole],
      signerName: r.signerName,
      documentTitle: r.documentTitle,
      status: effectiveRequestStatus({ status: r.status, expiresAt: r.expiresAt, now }),
      // Masked in the interface; the full address only ever appears in the
      // control where HR types or corrects it.
      destinationMask: r.signerEmail ? maskDestination(r.signerEmail) : null,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastSentAt: r.lastSentAt,
      sentCount: r.sentCount,
      signedAt: r.signedAt,
      revokedReason: r.revokedReason,
      appliedBlocks: r._count.signatures,
      requiredBlocks: r.requiredBlocks.length,
    })),
    signatures: signatures.map((s) => ({
      id: s.id,
      blockKey: s.blockKey,
      blockLabel: s.blockLabel,
      signatureType: s.signatureType,
      signerName: s.signerName,
      signerRole: s.signerRole,
      signedAt: s.signedAt,
      provenance: s.provenance,
    })),
    canManage: canActOnCase(actor, 'form.edit', ctx),
  };
}

/** Authorized read of one stored mark, for the case screen and the PDF. */
export async function readSignatureImage(
  actor: Actor,
  signatureId: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const record = await getPrisma().signatureRecord.findUnique({ where: { id: signatureId } });
  if (!record) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, record.caseId);
  if (!canActOnCase(actor, 'form.view', ctx)) throw ServiceError.notFound();
  return { bytes: await readVerifiedSignature(record), mimeType: record.mimeType };
}

/** Verified read: stored bytes must still match the recorded checksum. */
export async function readVerifiedSignature(record: {
  storageKey: string;
  checksum: string;
}): Promise<Buffer> {
  const bytes = await getStorage().get(record.storageKey);
  if (createHash('sha256').update(bytes).digest('hex') !== record.checksum)
    throw new Error('Stored signature failed its integrity check.');
  return bytes;
}

// --- applying marks ----------------------------------------------------------------

interface MarkInput {
  blockKey: string;
  dataUrl: string;
  provenance?: 'DRAWN' | 'TYPED';
}

/** Validate, store and record one mark inside an open transaction. */
/** A validated, stored mark, ready for its row to be written. */
interface PreparedMark {
  block: SignatureBlock;
  storageKey: string;
  checksum: string;
  width: number;
  height: number;
  provenance: 'DRAWN' | 'TYPED';
}

/**
 * Validate every mark and put its bytes in object storage BEFORE any
 * transaction opens. Object storage is a network call; holding a database
 * transaction across one is how a busy signing page turns into lock
 * contention. A failure here writes no rows at all, so the request stays
 * open and the signer can try again.
 */
async function prepareMarks(
  marks: readonly MarkInput[],
  signerRole: SignerRole,
): Promise<PreparedMark[]> {
  const decoded = marks.map((mark) => {
    const block = signatureBlock(mark.blockKey);
    if (!block) throw ServiceError.validation(['That section is not part of this form.']);
    if (block.signer !== signerRole)
      throw ServiceError.forbidden('That section is signed by somebody else.');
    const bytes = decodeSignatureDataUrl(mark.dataUrl);
    if (!bytes)
      throw ServiceError.validation([
        `The ${block.type === 'INITIALS' ? 'initials' : 'signature'} image was not captured correctly.`,
      ]);
    const errors = signatureImageErrors({ bytes, type: block.type });
    if (errors.length) throw ServiceError.validation(errors);
    return { block, bytes, provenance: mark.provenance === 'TYPED' ? 'TYPED' : 'DRAWN' } as const;
  });

  const prepared: PreparedMark[] = [];
  for (const d of decoded) {
    const dims = pngDimensions(d.bytes)!;
    const storageKey = newPrefixedObjectKey('signature');
    await getStorage().put(storageKey, d.bytes);
    prepared.push({
      block: d.block,
      storageKey,
      checksum: createHash('sha256').update(d.bytes).digest('hex'),
      width: dims.width,
      height: dims.height,
      provenance: d.provenance,
    });
  }
  return prepared;
}

async function recordMarkTx(
  tx: Tx,
  args: {
    mark: PreparedMark;
    caseId: string;
    formId: string;
    requestId: string | null;
    signerReference: string;
    signerName: string;
    signerRole: SignerRole;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  const block = args.mark.block;
  const storageKey = args.mark.storageKey;
  await tx.signatureRecord.create({
    data: {
      caseId: args.caseId,
      documentId: args.formId,
      requestId: args.requestId,
      signerReference: args.signerReference,
      signerName: args.signerName,
      signerRole: args.signerRole,
      signatureType: block.type,
      blockKey: block.key,
      blockLabel: block.label,
      provenance: args.mark.provenance,
      storageKey,
      checksum: args.mark.checksum,
      width: args.mark.width,
      height: args.mark.height,
      signedAt: args.now,
    },
  });
  await appendAudit(tx, {
    eventType: 'SIGNATURE_APPLIED',
    actorType: args.requestId ? 'SYSTEM' : 'USER',
    ...(args.requestId ? {} : { actorId: args.signerReference }),
    objectType: 'SignatureRecord',
    objectId: storageKey.slice(-12),
    caseId: args.caseId,
    result: 'SUCCESS',
    correlationId: args.correlationId,
    // The mark itself is never in the event - only what it was applied to.
    metadata: {
      blockKey: block.key,
      blockLabel: block.label,
      signatureType: block.type,
      signerRole: args.signerRole,
      provenance: args.mark.provenance,
      width: args.mark.width,
      height: args.mark.height,
    },
  });
}

/**
 * The HR signature applied inside the application by the person completing
 * the form. No token, no email: they are already authenticated and own the
 * case. This is a signature, not a new approval (directive 1 section 36).
 */
export async function applyHrSignature(
  actor: Actor,
  formId: string,
  input: { dataUrl: string; provenance?: 'DRAWN' | 'TYPED' },
): Promise<void> {
  const prisma = getPrisma();
  const form = await prisma.actionFormVersion.findUnique({ where: { id: formId } });
  if (!form) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, form.caseId);
  if (!canActOnCase(actor, 'form.edit', ctx)) throw ServiceError.forbidden();
  if (['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'].includes(form.status))
    throw ServiceError.conflict('This form version is finalized; its signatures are locked.');

  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const existing = await prisma.signatureRecord.findFirst({
    where: { documentId: formId, blockKey: 'hrCompletion', supersededAt: null },
  });
  if (existing) throw ServiceError.conflict('A Human Resources signature is already on this form.');

  const correlationId = newCorrelationId();
  const now = new Date();
  const [prepared] = await prepareMarks(
    [{ blockKey: 'hrCompletion', dataUrl: input.dataUrl, provenance: input.provenance }],
    'HR_OFFICER',
  );
  await prisma.$transaction(async (tx) => {
    await recordMarkTx(tx, {
      mark: prepared!,
      caseId: form.caseId,
      formId,
      requestId: null,
      signerReference: actor.userId,
      signerName: user.displayName,
      signerRole: 'HR_OFFICER',
      correlationId,
      now,
    });
  });
}

/**
 * Replace an HR signature applied by mistake, before the version is
 * finalized. The old mark is superseded, never deleted: the runtime role
 * holds no DELETE anywhere, and a signature that existed is history the
 * platform keeps (CLAUDE.md rule 13).
 */
export async function supersedeHrSignature(
  actor: Actor,
  formId: string,
  reason = 'Replaced before completion.',
): Promise<void> {
  const prisma = getPrisma();
  const form = await prisma.actionFormVersion.findUnique({ where: { id: formId } });
  if (!form) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, form.caseId);
  if (!canActOnCase(actor, 'form.edit', ctx)) throw ServiceError.forbidden();
  if (['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'].includes(form.status))
    throw ServiceError.conflict('This form version is finalized; its signatures are locked.');

  const live = await prisma.signatureRecord.findFirst({
    where: { documentId: formId, blockKey: 'hrCompletion', supersededAt: null },
  });
  if (!live) throw ServiceError.conflict('There is no Human Resources signature to replace.');

  await prisma.$transaction(async (tx) => {
    const updated = await tx.signatureRecord.updateMany({
      where: { id: live.id, supersededAt: null },
      data: {
        supersededAt: new Date(),
        supersededReason: reason.trim().slice(0, 300),
        supersededById: actor.userId,
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The signature changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'SIGNATURE_SUPERSEDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SignatureRecord',
      objectId: live.id,
      caseId: form.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: {
        blockKey: live.blockKey,
        blockLabel: live.blockLabel,
        signatureType: live.signatureType,
        reason: reason.trim().slice(0, 300),
      },
    });
  });
}

// --- the public signing page ---------------------------------------------------------

export interface SigningView {
  requestId: string;
  documentTitle: string;
  signerName: string;
  signerLabel: string;
  expiresAt: Date;
  blocks: Array<{ key: string; label: string; type: SignatureType; applied: boolean }>;
  /** Only what the signer needs to understand what they are signing. */
  form: {
    caseReference: string;
    employeeName: string;
    employeeNumber: string | null;
    position: string;
    department: string;
    location: string;
    departureType: string;
    receivedAt: string | null;
    confirmedLastDay: string | null;
    effectiveSeparationAt: string | null;
    priorStatus: string;
    newStatus: string;
  };
  consentText: string;
}

/**
 * Public read. Neutral outcomes only: the caller cannot tell an expired link
 * from a revoked one from a typo, and no case content leaks either way.
 */
export async function getSigningView(
  rawToken: string,
): Promise<{ state: 'OPEN'; view: SigningView } | { state: 'COMPLETED' | 'EXPIRED' | 'INVALID' }> {
  if (!isPlausibleSignatureToken(rawToken)) return { state: 'INVALID' };
  const prisma = getPrisma();
  const request = await prisma.signatureRequest.findUnique({
    where: { tokenHash: hashSignatureToken(rawToken) },
    include: { form: true, signatures: { select: { blockKey: true } } },
  });
  if (!request?.tokenHash) return { state: 'INVALID' };
  if (!signatureTokenMatchesHash(rawToken, request.tokenHash)) return { state: 'INVALID' };
  const now = new Date();
  const status = effectiveRequestStatus({
    status: request.status,
    expiresAt: request.expiresAt,
    now,
  });
  if (status === 'SIGNED') return { state: 'COMPLETED' };
  if (status === 'EXPIRED') return { state: 'EXPIRED' };
  if (status !== 'PENDING') return { state: 'INVALID' };
  if (['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'].includes(request.form.status))
    return { state: 'INVALID' };

  // Recorded once, and awaited: an audit entry written on a promise nobody
  // waits for is an audit entry that may never exist.
  if (!request.firstOpenedAt) {
    try {
      const claimed = await prisma.signatureRequest.updateMany({
        where: { id: request.id, firstOpenedAt: null },
        data: { firstOpenedAt: now },
      });
      if (claimed.count > 0)
        await appendAudit(prisma, {
          eventType: 'SIGNATURE_LINK_OPENED',
          actorType: 'SYSTEM',
          objectType: 'SignatureRequest',
          objectId: request.id,
          caseId: request.caseId,
          result: 'SUCCESS',
          correlationId: newCorrelationId(),
          metadata: { signerRole: request.signerRole },
        });
    } catch {
      // Recording that the page was opened must never stop the signer from
      // reading and signing the form.
    }
  }

  const snap = request.form.fieldSnapshot as Record<string, string | null>;
  const applied = new Set(request.signatures.map((s) => s.blockKey));
  return {
    state: 'OPEN',
    view: {
      requestId: request.id,
      documentTitle: request.documentTitle,
      signerName: request.signerName,
      signerLabel: SIGNER_ROLE_LABELS[request.signerRole],
      expiresAt: request.expiresAt,
      blocks: blocksForSigner(request.signerRole).map((b) => ({
        key: b.key,
        label: b.label,
        type: b.type,
        applied: applied.has(b.key),
      })),
      form: {
        caseReference: snap['caseReference'] ?? '',
        employeeName: snap['employeeName'] ?? '',
        employeeNumber: snap['employeeNumber'] ?? null,
        position: snap['position'] ?? '',
        department: snap['department'] ?? '',
        location: snap['location'] ?? '',
        departureType: snap['departureType'] ?? '',
        receivedAt: snap['receivedAt'] ?? null,
        confirmedLastDay: snap['confirmedLastDay'] ?? null,
        effectiveSeparationAt: snap['effectiveSeparationAt'] ?? null,
        priorStatus: request.form.priorStatus,
        newStatus: request.form.newStatus,
      },
      consentText: SIGNATURE_CONSENT_TEXT,
    },
  };
}

/**
 * Public submission. One atomic claim: the request flips to SIGNED and its
 * token dies in the same transaction that writes the marks, so a second
 * submission cannot land and a replayed link cannot overwrite a signature.
 */
export async function submitSignatures(
  rawToken: string,
  input: {
    marks: MarkInput[];
    consented: boolean;
    ipHash?: string | null;
    userAgent?: string | null;
  },
): Promise<
  { ok: true } | { ok: false; state: 'COMPLETED' | 'EXPIRED' | 'INVALID'; errors?: string[] }
> {
  if (!isPlausibleSignatureToken(rawToken)) return { ok: false, state: 'INVALID' };
  const prisma = getPrisma();
  const request = await prisma.signatureRequest.findUnique({
    where: { tokenHash: hashSignatureToken(rawToken) },
    include: { form: true },
  });
  if (!request?.tokenHash) return { ok: false, state: 'INVALID' };
  if (!signatureTokenMatchesHash(rawToken, request.tokenHash))
    return { ok: false, state: 'INVALID' };
  const now = new Date();
  const status = effectiveRequestStatus({
    status: request.status,
    expiresAt: request.expiresAt,
    now,
  });
  if (status === 'SIGNED') return { ok: false, state: 'COMPLETED' };
  if (status === 'EXPIRED') return { ok: false, state: 'EXPIRED' };
  if (status !== 'PENDING') return { ok: false, state: 'INVALID' };
  if (['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'].includes(request.form.status))
    return { ok: false, state: 'INVALID' };

  if (!input.consented)
    return { ok: false, state: 'INVALID', errors: ['Confirm the declaration before submitting.'] };
  const supplied = input.marks.map((m) => m.blockKey);
  const missing = missingBlocks(request.signerRole, supplied);
  if (missing.length)
    return {
      ok: false,
      state: 'INVALID',
      errors: missing.map(
        (b) => `${b.type === 'INITIALS' ? 'Initials' : 'A signature'} are needed for "${b.label}".`,
      ),
    };

  const correlationId = newCorrelationId();
  // Validate and store every mark before the claim, so a bad image never
  // consumes the request and a network put never holds a lock.
  let prepared: PreparedMark[];
  try {
    prepared = await prepareMarks(input.marks, request.signerRole);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'VALIDATION')
      return { ok: false, state: 'INVALID', errors: [...e.details] };
    return { ok: false, state: 'INVALID' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Claim first: whoever wins this update owns the submission.
      const claimed = await tx.signatureRequest.updateMany({
        where: { id: request.id, rowVersion: request.rowVersion, status: 'PENDING' },
        data: {
          status: 'SIGNED',
          signedAt: now,
          // Nothing reusable survives; the hash stays so a signer who opens
          // the link again is told it was completed.
          tokenCiphertext: null,
          consentText: SIGNATURE_CONSENT_TEXT,
          consentAt: now,
          signerIpHash: input.ipHash ?? null,
          signerUserAgent: input.userAgent?.slice(0, 300) ?? null,
          rowVersion: { increment: 1 },
        },
      });
      if (claimed.count === 0) throw ServiceError.conflict('already claimed');

      for (const mark of prepared) {
        await recordMarkTx(tx, {
          mark,
          caseId: request.caseId,
          formId: request.formId,
          requestId: request.id,
          signerReference: request.id,
          signerName: request.signerName,
          signerRole: request.signerRole,
          correlationId,
          now,
        });
      }

      // Directive 1 section 9: the DECISION is recorded as data, separately
      // from the images. The employee signing applies the acknowledgement the
      // form already carries - it does not invent a new approval.
      if (request.signerRole === 'EMPLOYEE') {
        await tx.actionFormVersion.updateMany({
          where: {
            id: request.formId,
            status: { notIn: ['COMPLETE', 'APPROVED', 'VOIDED', 'SUPERSEDED'] },
          },
          data: {
            ackStatus: 'ACKNOWLEDGED',
            ackDate: now,
            ackMethod: 'Electronic signature (secure link)',
            rowVersion: { increment: 1 },
          },
        });
      }

      await appendAudit(tx, {
        eventType: 'SIGNATURE_REQUEST_COMPLETED',
        actorType: 'SYSTEM',
        objectType: 'SignatureRequest',
        objectId: request.id,
        caseId: request.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: {
          signerRole: request.signerRole,
          signerName: request.signerName,
          documentTitle: request.documentTitle,
          marks: input.marks.length,
          consent: SIGNATURE_CONSENT_TEXT,
          formVersion: request.form.version,
        },
      });
    });
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'VALIDATION')
      return { ok: false, state: 'INVALID', errors: [...e.details] };
    return { ok: false, state: 'INVALID' };
  }
  return { ok: true };
}

/** What the completion screen and the PDF need to know about signing. */
export async function signatureSummaryForForm(formId: string): Promise<{
  applied: Array<{
    blockKey: string;
    blockLabel: string;
    signatureType: SignatureType;
    provenance: SignatureProvenance;
    signerName: string;
    signerRole: SignerRole;
    signedAt: Date;
    storageKey: string;
    checksum: string;
    width: number;
    height: number;
  }>;
  pendingRequests: number;
}> {
  const prisma = getPrisma();
  const [applied, pendingRequests] = await Promise.all([
    prisma.signatureRecord.findMany({
      where: { documentId: formId, supersededAt: null },
      orderBy: { signedAt: 'asc' },
    }),
    prisma.signatureRequest.count({ where: { formId, status: 'PENDING' } }),
  ]);
  return {
    applied: applied.map((s) => ({
      blockKey: s.blockKey,
      blockLabel: s.blockLabel,
      signatureType: s.signatureType,
      provenance: s.provenance,
      signerName: s.signerName,
      signerRole: s.signerRole,
      signedAt: s.signedAt,
      storageKey: s.storageKey,
      checksum: s.checksum,
      width: s.width,
      height: s.height,
    })),
    pendingRequests,
  };
}

/**
 * A material case correction invalidates a form version, so its open signing
 * requests must stop working: the signed facts they were issued against no
 * longer exist (directive 1 section 22).
 */
export async function revokeRequestsForFormTx(
  tx: Tx,
  formId: string,
  caseId: string,
  reason: string,
): Promise<number> {
  const revoked = await tx.signatureRequest.updateMany({
    where: { formId, status: 'PENDING' },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedReason: reason.slice(0, 300),
      tokenCiphertext: null,
      rowVersion: { increment: 1 },
    },
  });
  if (revoked.count > 0) {
    await appendAudit(tx, {
      eventType: 'SIGNATURE_REQUEST_REVOKED',
      actorType: 'SYSTEM',
      objectType: 'ActionFormVersion',
      objectId: formId,
      caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { reason, count: revoked.count },
    });
  }
  return revoked.count;
}
