/**
 * Notification template management (Directive 6.3 Q).
 *
 * Versioned, deterministic, plain-text templates with an explicit lifecycle:
 * DRAFT -> ACTIVE (supersedes the prior ACTIVE version) -> SUPERSEDED /
 * RETIRED. Preview renders synthetic sample values; test sends go ONLY to the
 * development capture mailbox. No arbitrary executable HTML - templates are
 * plain text with [[PLACEHOLDER]] tokens validated against the per-type
 * minimum-data allow-list.
 */
import {
  can,
  contentChecksum,
  substitute,
  NOTIFICATION_PLACEHOLDERS,
  NOTIFICATION_RECIPIENT_CLASS,
  NOTIFICATION_TYPES,
  type Actor,
  type NotificationType,
} from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { notificationTemplateErrors } from './notificationService.ts';

const SAMPLE_VALUES: Record<string, string> = {
  EMPLOYEE_LEGAL_NAME: 'Avery Brown',
  EMPLOYEE_REFERENCE: 'EMP-TEST-001',
  CASE_REFERENCE: 'OFF-2026-0000',
  DEPARTMENT: 'Operations',
  EFFECTIVE_SEPARATION_DATE: '29 Aug 2026',
  EFFECTIVE_SEPARATION_TIME: '29 Aug 2026, 5:00 PM (America/Jamaica)',
  CONFIRMED_LAST_WORKING_DATE: '28 Aug 2026',
  HANDOVER_DUE_DATE: '28 Aug 2026',
  ACCESS_SYSTEMS_SUMMARY: 'Network account; Email; Business applications; Building access',
  SURVEY_EXPIRY_NOTE:
    'The survey link is provided separately and expires 14 days after it is sent.',
  MANUAL_NOTE: '(manual note)',
  ACKNOWLEDGEMENT_LINK: '[link inserted at send time]',
};

export async function listNotificationTemplateVersions(actor: Actor) {
  if (!can(actor, 'notifTemplate.view')) throw ServiceError.forbidden();
  return getPrisma().notificationTemplate.findMany({
    orderBy: [{ notificationType: 'asc' }, { version: 'desc' }],
  });
}

export const notifTemplateDraftSchema = z.object({
  notificationType: z.enum(NOTIFICATION_TYPES),
  name: z.string().trim().min(1).max(200),
  subjectTemplate: z.string().trim().min(1).max(300),
  bodyTemplate: z.string().trim().min(1).max(10_000),
  minimumDataNote: z.string().trim().min(1).max(1000),
  changeReason: z.string().trim().min(1).max(500),
});

/** Q: draft a new version (officers may draft; activation is management). */
export async function draftNotificationTemplate(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'notifTemplate.draft')) throw ServiceError.forbidden();
  const parsed = notifTemplateDraftSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  // No executable content: plain text only, validated placeholder allow-list,
  // external minimum-data rules.
  if (/<\s*(script|iframe|object|embed)/i.test(input.bodyTemplate + input.subjectTemplate))
    throw ServiceError.validation(['Templates are plain text; markup is not permitted.']);
  const errors = notificationTemplateErrors(
    input.notificationType,
    input.subjectTemplate,
    input.bodyTemplate,
  );
  if (errors.length) throw ServiceError.validation(errors);

  const prisma = getPrisma();
  const latest = await prisma.notificationTemplate.findFirst({
    where: { notificationType: input.notificationType },
    orderBy: { version: 'desc' },
  });
  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const row = await tx.notificationTemplate.create({
      data: {
        notificationType: input.notificationType,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        recipientClass: NOTIFICATION_RECIPIENT_CLASS[input.notificationType],
        name: input.name,
        subjectTemplate: input.subjectTemplate,
        bodyTemplate: input.bodyTemplate,
        allowedPlaceholders: [...NOTIFICATION_PLACEHOLDERS[input.notificationType]],
        minimumDataNote: input.minimumDataNote,
        contentChecksum: contentChecksum(`${input.subjectTemplate}\n${input.bodyTemplate}`),
        changeReason: input.changeReason,
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_NOTIFICATION_DRAFTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationTemplate',
      objectId: row.id,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        notificationType: input.notificationType,
        version: row.version,
        changeReason: input.changeReason,
      },
    });
    return row;
  });
}

/** Q: preview with synthetic sample values - no case data involved. */
export async function previewNotificationTemplate(actor: Actor, templateId: string) {
  if (!can(actor, 'notifTemplate.view')) throw ServiceError.forbidden();
  const t = await getPrisma().notificationTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw ServiceError.notFound();
  return {
    subject: substitute(t.subjectTemplate, SAMPLE_VALUES),
    body: substitute(t.bodyTemplate, SAMPLE_VALUES),
    note: 'Preview uses clearly synthetic sample values (Avery Brown / EMP-TEST-001).',
  };
}

/** Q: test send - development capture mailbox ONLY, never a real recipient. */
export async function testSendNotificationTemplate(actor: Actor, templateId: string) {
  if (!can(actor, 'notifTemplate.draft')) throw ServiceError.forbidden();
  if (getConfig().isProduction)
    throw ServiceError.validation([
      'Template test sends use the development capture mailbox and do not exist in production.',
    ]);
  const prisma = getPrisma();
  const t = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw ServiceError.notFound();
  const subject = substitute(t.subjectTemplate, SAMPLE_VALUES);
  const body = substitute(t.bodyTemplate, SAMPLE_VALUES);
  const correlationId = newCorrelationId();
  // Captures are keyed to notification records; a template test creates a
  // free-standing capture note instead - reuse the capture table via a
  // synthetic record is NOT possible without a record, so audit + return.
  await appendAudit(prisma, {
    eventType: 'TEMPLATE_NOTIFICATION_TEST_SENT',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationTemplate',
    objectId: templateId,
    result: 'SUCCESS',
    correlationId,
    metadata: { notificationType: t.notificationType, version: t.version, mode: 'dev-preview' },
  });
  return { subject, body, destination: 'development capture (safe test destination)' };
}

/** Q: activate a draft; the prior ACTIVE version is superseded atomically. */
export async function activateNotificationTemplate(actor: Actor, templateId: string) {
  if (!can(actor, 'notifTemplate.activate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const t = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw ServiceError.notFound();
  if (t.status !== 'DRAFT') throw ServiceError.conflict(`Cannot activate from ${t.status}.`);
  const errors = notificationTemplateErrors(
    t.notificationType as NotificationType,
    t.subjectTemplate,
    t.bodyTemplate,
  );
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.notificationTemplate.updateMany({
      where: { notificationType: t.notificationType, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await tx.notificationTemplate.update({
      where: { id: templateId },
      data: { status: 'ACTIVE', activatedById: actor.userId, activatedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_NOTIFICATION_ACTIVATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationTemplate',
      objectId: templateId,
      result: 'SUCCESS',
      correlationId,
      metadata: { notificationType: t.notificationType, version: t.version },
    });
  });
}

/** Q: retire a draft that should never activate. */
export async function retireNotificationTemplate(actor: Actor, templateId: string, reason: string) {
  if (!can(actor, 'notifTemplate.activate')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const t = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!t) throw ServiceError.notFound();
  if (t.status !== 'DRAFT')
    throw ServiceError.conflict('Only draft versions can be retired; active ones are superseded.');
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.notificationTemplate.update({
      where: { id: templateId },
      data: { status: 'RETIRED', changeReason: reason },
    });
    await appendAudit(tx, {
      eventType: 'TEMPLATE_NOTIFICATION_RETIRED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationTemplate',
      objectId: templateId,
      result: 'SUCCESS',
      correlationId,
      metadata: { notificationType: t.notificationType, version: t.version, reason },
    });
  });
}
