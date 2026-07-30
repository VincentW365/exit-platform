/**
 * Versioned reason-taxonomy management (Directive 4 section J).
 *
 * Categories are configurable reference data, never an enum (J.1). New
 * versions supersede; retiring never alters prior cases (J.4/J.5); reporting
 * groups aggregate without exposing restricted reason notes (J.6/J.7).
 */
import { can, DEPARTURE_TYPES, type Actor } from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

export const reasonInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,40}$/),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  voluntary: z.union([z.boolean(), z.null()]).default(null),
  departureTypes: z.array(z.enum(DEPARTURE_TYPES)).default([]),
  reportingGroup: z.string().trim().max(100).optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  sensitive: z.boolean().default(false),
  changeReason: z.string().trim().min(1).max(500),
});

export async function listReasonCategories(actor: Actor) {
  if (!can(actor, 'reasons.manage') && !can(actor, 'case.list')) throw ServiceError.forbidden();
  return getPrisma().reasonCategory.findMany({
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export async function upsertReasonCategory(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'reasons.manage')) throw ServiceError.forbidden();
  const parsed = reasonInputSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const prisma = getPrisma();
  const correlationId = newCorrelationId();

  const existing = await prisma.reasonCategory.findUnique({ where: { code: input.code } });
  const nextVersion = (existing?.taxonomyVersion ?? 0) + 1;
  const row = await prisma.$transaction(async (tx) => {
    const data = {
      label: input.label,
      description: input.description ?? null,
      voluntary: input.voluntary,
      departureTypes: input.departureTypes,
      reportingGroup: input.reportingGroup ?? null,
      sortOrder: input.sortOrder,
      sensitive: input.sensitive,
      changeReason: input.changeReason,
      taxonomyVersion: nextVersion,
      // Every edit clears approval: a new version needs a new approval (J.3).
      approvedById: null,
      approvedAt: null,
      isTestOnly: true,
    };
    const r = existing
      ? await tx.reasonCategory.update({ where: { code: input.code }, data })
      : await tx.reasonCategory.create({
          data: { code: input.code, ...data, createdById: actor.userId, isActive: false },
        });
    await appendAudit(tx, {
      eventType: 'REASON_CATEGORY_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReasonCategory',
      objectId: r.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { code: input.code, version: nextVersion, changeReason: input.changeReason },
    });
    return r;
  });
  return row;
}

/** HR-Manager approval activates the category version. */
export async function approveReasonCategory(actor: Actor, id: string) {
  if (!can(actor, 'reasons.manage')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const r = await tx.reasonCategory.update({
      where: { id },
      data: {
        approvedById: actor.userId,
        approvedAt: new Date(),
        isActive: true,
        effectiveFrom: new Date(),
        retiredAt: null,
        effectiveTo: null,
      },
    });
    await appendAudit(tx, {
      eventType: 'REASON_CATEGORY_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReasonCategory',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { code: r.code, action: 'approved', version: r.taxonomyVersion },
    });
  });
}

/** J.5: retirement stops NEW use only; prior cases keep their category. */
export async function retireReasonCategory(actor: Actor, id: string, reason: string) {
  if (!can(actor, 'reasons.manage')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const r = await tx.reasonCategory.update({
      where: { id },
      data: {
        isActive: false,
        retiredAt: new Date(),
        effectiveTo: new Date(),
        changeReason: reason,
      },
    });
    await appendAudit(tx, {
      eventType: 'REASON_CATEGORY_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReasonCategory',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { code: r.code, action: 'retired', reason },
    });
  });
}
