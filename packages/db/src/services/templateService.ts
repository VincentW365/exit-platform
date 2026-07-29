/**
 * Controlled document templates (Directive 2 section B).
 * Officers draft; managers activate/supersede/retire; ACTIVE is immutable;
 * exactly one ACTIVE version per type (DB partial unique index backs this).
 */
import {
  can,
  contentChecksum,
  extractPlaceholders,
  isTypePermanentlyDisabled,
  templateContentErrors,
  templateTransitionError,
  DOCUMENT_PLACEHOLDERS,
  type Actor,
  type DocumentType,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

export async function listTemplates(actor: Actor) {
  if (!can(actor, 'template.view')) throw ServiceError.forbidden();
  return getPrisma().documentTemplate.findMany({
    orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
  });
}

export async function getTemplate(actor: Actor, id: string) {
  if (!can(actor, 'template.view')) throw ServiceError.forbidden();
  const t = await getPrisma().documentTemplate.findUnique({ where: { id } });
  if (!t) throw ServiceError.notFound();
  return t;
}

export async function getActiveTemplate(documentType: DocumentType) {
  return getPrisma().documentTemplate.findFirst({
    where: { documentType, status: 'ACTIVE' },
  });
}

/** Create a new DRAFT version (from scratch or copying the latest version). */
export async function createDraftTemplate(
  actor: Actor,
  input: { documentType: DocumentType; name: string; contentBody: string; changeReason?: string },
) {
  if (!can(actor, 'template.draft')) throw ServiceError.forbidden();
  if (isTypePermanentlyDisabled(input.documentType) && input.contentBody.trim().length > 0) {
    throw ServiceError.validation([
      'The termination placeholder must not contain content (permanently disabled boundary).',
    ]);
  }
  const allowed = [...DOCUMENT_PLACEHOLDERS];
  const errors = input.contentBody.trim().length
    ? templateContentErrors(input.contentBody, allowed)
    : [];
  if (!input.name.trim() || input.name.length > 120) errors.push('Name must be 1-120 characters.');
  if (errors.length) throw ServiceError.validation(errors);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const latest = await tx.documentTemplate.findFirst({
      where: { documentType: input.documentType },
      orderBy: { version: 'desc' },
    });
    const existingDraft = await tx.documentTemplate.findFirst({
      where: { documentType: input.documentType, status: 'DRAFT' },
    });
    if (existingDraft)
      throw ServiceError.conflict(
        'A DRAFT version already exists for this document type; edit it instead.',
      );
    const t = await tx.documentTemplate.create({
      data: {
        documentType: input.documentType,
        name: input.name.trim(),
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        contentBody: input.contentBody,
        allowedPlaceholders: extractPlaceholders(input.contentBody),
        contentChecksum: contentChecksum(input.contentBody),
        changeReason: input.changeReason?.trim() || null,
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentTemplate',
      objectId: t.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: t.documentType, templateVersion: t.version },
    });
    return t;
  });
}

export async function updateDraftTemplate(
  actor: Actor,
  id: string,
  input: { name?: string; contentBody?: string; changeReason?: string },
) {
  if (!can(actor, 'template.draft')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const t = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!t) throw ServiceError.notFound();
  const guard = templateTransitionError('edit', t.status, t.documentType);
  if (guard) throw ServiceError.conflict(guard);

  const body = input.contentBody ?? t.contentBody;
  const errors = templateContentErrors(body, [...DOCUMENT_PLACEHOLDERS]);
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.documentTemplate.update({
      where: { id },
      data: {
        name: input.name?.trim() || t.name,
        contentBody: body,
        allowedPlaceholders: extractPlaceholders(body),
        contentChecksum: contentChecksum(body),
        changeReason: input.changeReason?.trim() || t.changeReason,
      },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentTemplate',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: t.documentType, templateVersion: t.version },
    });
    return updated;
  });
}

/** Activate a DRAFT; any previously ACTIVE version becomes SUPERSEDED. */
export async function activateTemplate(actor: Actor, id: string) {
  if (!can(actor, 'template.activate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const t = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!t) throw ServiceError.notFound();
  const guard = templateTransitionError('activate', t.status, t.documentType);
  if (guard) throw ServiceError.conflict(guard);
  if (!t.contentBody.trim() && t.documentType !== 'MANUAL_EXCEPTION_DOCUMENT')
    throw ServiceError.validation(['An empty template cannot be activated.']);

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const prior = await tx.documentTemplate.findFirst({
      where: { documentType: t.documentType, status: 'ACTIVE' },
    });
    if (prior) {
      await tx.documentTemplate.update({
        where: { id: prior.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await appendAudit(tx, {
        eventType: 'TEMPLATE_SUPERSEDED',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'DocumentTemplate',
        objectId: prior.id,
        result: 'SUCCESS',
        correlationId,
        metadata: { documentType: t.documentType, templateVersion: prior.version },
      });
    }
    const activated = await tx.documentTemplate.update({
      where: { id },
      data: { status: 'ACTIVE', activatedById: actor.userId, activatedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_ACTIVATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentTemplate',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: t.documentType, templateVersion: t.version },
    });
    return activated;
  });
}

export async function retireTemplate(actor: Actor, id: string, reason: string) {
  if (!can(actor, 'template.activate')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required to retire a template.']);
  const prisma = getPrisma();
  const t = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!t) throw ServiceError.notFound();
  const guard = templateTransitionError('retire', t.status, t.documentType);
  if (guard) throw ServiceError.conflict(guard);

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const retired = await tx.documentTemplate.update({
      where: { id },
      data: { status: 'RETIRED', retiredAt: new Date(), changeReason: reason },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_RETIRED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentTemplate',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: t.documentType, templateVersion: t.version, reason },
    });
    return retired;
  });
}
