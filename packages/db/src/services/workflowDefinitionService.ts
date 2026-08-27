/**
 * Versioned workflow definitions (Directive 3 section B).
 *
 * HR_OFFICER drafts; HR_MANAGER activates/supersedes/retires. ACTIVE versions
 * are immutable (service rule + database trigger). Editing an active
 * definition means creating a new DRAFT version. Only one ACTIVE version per
 * workflow type (service rule + partial unique index).
 */
import { z } from 'zod';
import {
  type DepartureType,
  can,
  workflowConfigChecksum,
  workflowDefinitionErrors,
  workflowDefTransitionError,
  ROLES,
  TASK_DEPARTMENTS,
  type Actor,
  type WorkflowDefinitionShape,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

const taskDefSchema = z.object({
  taskCode: z.string().trim().min(3).max(60),
  sortOrder: z.number().int().min(0).max(1000),
  enabled: z.boolean().default(true),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  department: z.enum(TASK_DEPARTMENTS),
  requiredRole: z.enum(ROLES),
  taskKind: z.enum(['STANDARD', 'ACCESS_REVOCATION']).default('STANDARD'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
  confidential: z.boolean().default(false),
  required: z.boolean().default(true),
  waiverAllowed: z.boolean().default(false),
  waiverAuthority: z.enum(ROLES).default('HR_MANAGER'),
  dueBasis: z.enum([
    'CASE_RECEIVED',
    'WORKFLOW_ACTIVATION',
    'EFFECTIVE_SEPARATION',
    'FINAL_WORKING_DAY',
    'NONE',
  ]),
  dueOffsetDays: z.number().int().min(-90).max(90).default(0),
  dueOffsetKind: z.enum(['BUSINESS_DAYS', 'CALENDAR_DAYS', 'EXACT_TIME']).default('BUSINESS_DAYS'),
  releaseBasis: z.enum(['IMMEDIATE', 'EFFECTIVE_SEPARATION']).default('IMMEDIATE'),
  releaseOffsetHours: z
    .number()
    .int()
    .min(-24 * 90)
    .max(24 * 90)
    .default(0),
  pausesOnHold: z.boolean().default(true),
  blockPausesSla: z.boolean().default(false),
  dependsOnCodes: z.array(z.string().trim().min(3).max(60)).default([]),
  evidenceKind: z.enum(['NONE', 'NOTE', 'ATTACHMENT', 'LINKED_RECORD']).default('NOTE'),
  evidenceNote: z.string().trim().max(500).nullable().default(null),
  slaNote: z.string().trim().max(500).nullable().default(null),
  escalationNote: z.string().trim().max(500).nullable().default(null),
});

export const workflowDraftSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  activationConditions: z.string().trim().max(2000).default(''),
  changeReason: z.string().trim().min(1).max(500),
  tasks: z.array(taskDefSchema).min(1).max(100),
});
export type WorkflowDraftInput = z.infer<typeof workflowDraftSchema>;

export async function listWorkflowDefinitions(actor: Actor) {
  if (!can(actor, 'workflowDef.view')) throw ServiceError.forbidden();
  return getPrisma().workflowDefinition.findMany({
    orderBy: [{ workflowType: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      workflowType: true,
      name: true,
      version: true,
      status: true,
      configChecksum: true,
      createdAt: true,
      activatedAt: true,
      changeReason: true,
    },
  });
}

export async function getWorkflowDefinition(actor: Actor, id: string) {
  if (!can(actor, 'workflowDef.view')) throw ServiceError.forbidden();
  const def = await getPrisma().workflowDefinition.findUnique({
    where: { id },
    include: { taskDefs: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!def) throw ServiceError.notFound();
  return def;
}

/** Active definition for a workflow (departure) type; null when none. */
export async function getActiveDefinitionForType(workflowType: DepartureType) {
  return getPrisma().workflowDefinition.findFirst({
    where: { workflowType, status: 'ACTIVE' },
    include: { taskDefs: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
  });
}

function toShape(
  def: { workflowType: string; name: string; version: number },
  tasks: WorkflowDraftInput['tasks'],
): WorkflowDefinitionShape {
  return {
    workflowType: def.workflowType as WorkflowDefinitionShape['workflowType'],
    name: def.name,
    version: def.version,
    description: '',
    activationConditions: '',
    tasks: tasks.map((t) => ({ ...t })),
  };
}

/**
 * B.4: editing an active definition creates a new DRAFT version. `sourceId`
 * optionally copies an existing version's tasks as the starting point.
 */
export async function createWorkflowDraft(
  actor: Actor,
  workflowType: DepartureType,
  rawInput: unknown,
) {
  if (!can(actor, 'workflowDef.draft')) throw ServiceError.forbidden();
  const parsed = workflowDraftSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const prisma = getPrisma();
  const latest = await prisma.workflowDefinition.findFirst({
    where: { workflowType },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version ?? 0) + 1;

  const shape = toShape({ workflowType, name: input.name, version }, input.tasks);
  const errors = workflowDefinitionErrors(shape);
  if (errors.length) throw ServiceError.validation(errors);

  const checksum = workflowConfigChecksum(shape);
  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const def = await tx.workflowDefinition.create({
      data: {
        workflowType,
        name: input.name,
        version,
        status: 'DRAFT',
        description: input.description,
        activationConditions: input.activationConditions,
        changeReason: input.changeReason,
        configChecksum: checksum,
        createdById: actor.userId,
        taskDefs: {
          create: input.tasks.map((t) => ({
            taskCode: t.taskCode,
            sortOrder: t.sortOrder,
            enabled: t.enabled,
            title: t.title,
            description: t.description,
            department: t.department,
            requiredRole: t.requiredRole,
            taskKind: t.taskKind,
            priority: t.priority,
            confidential: t.confidential,
            required: t.required,
            waiverAllowed: t.waiverAllowed,
            waiverAuthority: t.waiverAuthority,
            dueBasis: t.dueBasis,
            dueOffsetDays: t.dueOffsetDays,
            dueOffsetKind: t.dueOffsetKind,
            releaseBasis: t.releaseBasis,
            releaseOffsetHours: t.releaseOffsetHours,
            pausesOnHold: t.pausesOnHold,
            blockPausesSla: t.blockPausesSla,
            dependsOnCodes: t.dependsOnCodes,
            evidenceKind: t.evidenceKind,
            evidenceNote: t.evidenceNote,
            slaNote: t.slaNote,
            escalationNote: t.escalationNote,
          })),
        },
      },
    });
    await appendAudit(tx, {
      eventType: 'WORKFLOW_DEF_DRAFTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowDefinition',
      objectId: def.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { workflowType, version, changeReason: input.changeReason },
    });
    return def;
  });
}

/** B.1: DRAFT definitions may be edited in place (replace task set). */
export async function updateWorkflowDraft(actor: Actor, definitionId: string, rawInput: unknown) {
  if (!can(actor, 'workflowDef.draft')) throw ServiceError.forbidden();
  const parsed = workflowDraftSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const prisma = getPrisma();
  const def = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { taskDefs: true },
  });
  if (!def) throw ServiceError.notFound();
  const transitionError = workflowDefTransitionError('edit', def.status);
  if (transitionError) throw ServiceError.conflict(transitionError);

  const shape = toShape(
    { workflowType: def.workflowType, name: input.name, version: def.version },
    input.tasks,
  );
  const errors = workflowDefinitionErrors(shape);
  if (errors.length) throw ServiceError.validation(errors);
  const checksum = workflowConfigChecksum(shape);

  const byCode = new Map(def.taskDefs.map((t) => [t.taskCode, t]));
  const inputCodes = new Set(input.tasks.map((t) => t.taskCode));
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    for (const t of input.tasks) {
      const existing = byCode.get(t.taskCode);
      const data = {
        sortOrder: t.sortOrder,
        enabled: t.enabled,
        title: t.title,
        description: t.description,
        department: t.department,
        requiredRole: t.requiredRole,
        taskKind: t.taskKind,
        priority: t.priority,
        confidential: t.confidential,
        required: t.required,
        waiverAllowed: t.waiverAllowed,
        waiverAuthority: t.waiverAuthority,
        dueBasis: t.dueBasis,
        dueOffsetDays: t.dueOffsetDays,
        dueOffsetKind: t.dueOffsetKind,
        releaseBasis: t.releaseBasis,
        releaseOffsetHours: t.releaseOffsetHours,
        pausesOnHold: t.pausesOnHold,
        blockPausesSla: t.blockPausesSla,
        dependsOnCodes: t.dependsOnCodes,
        evidenceKind: t.evidenceKind,
        evidenceNote: t.evidenceNote,
        slaNote: t.slaNote,
        escalationNote: t.escalationNote,
      };
      if (existing) {
        await tx.workflowTaskDefinition.update({ where: { id: existing.id }, data });
      } else {
        await tx.workflowTaskDefinition.create({
          data: { definitionId, taskCode: t.taskCode, ...data },
        });
      }
    }
    // Tasks omitted from the draft are disabled, never deleted (no-hard-delete).
    for (const existing of def.taskDefs) {
      if (!inputCodes.has(existing.taskCode) && existing.enabled) {
        await tx.workflowTaskDefinition.update({
          where: { id: existing.id },
          data: { enabled: false },
        });
      }
    }
    await tx.workflowDefinition.update({
      where: { id: definitionId },
      data: {
        name: input.name,
        description: input.description,
        activationConditions: input.activationConditions,
        changeReason: input.changeReason,
        configChecksum: checksum,
      },
    });
    await appendAudit(tx, {
      eventType: 'WORKFLOW_DEF_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowDefinition',
      objectId: definitionId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        workflowType: def.workflowType,
        version: def.version,
        changeReason: input.changeReason,
      },
    });
  });
}

/** B.2: HR_MANAGER activates; any prior ACTIVE version is superseded. */
export async function activateWorkflowDefinition(actor: Actor, definitionId: string) {
  if (!can(actor, 'workflowDef.activate')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const def = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { taskDefs: { where: { enabled: true } } },
  });
  if (!def) throw ServiceError.notFound();
  const transitionError = workflowDefTransitionError('activate', def.status);
  if (transitionError) throw ServiceError.conflict(transitionError);

  const shape = toShape(
    { workflowType: def.workflowType, name: def.name, version: def.version },
    def.taskDefs.map((t) => ({
      ...t,
      description: t.description,
      evidenceNote: t.evidenceNote,
      slaNote: t.slaNote,
      escalationNote: t.escalationNote,
    })) as WorkflowDraftInput['tasks'],
  );
  const errors = workflowDefinitionErrors(shape);
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const prior = await tx.workflowDefinition.findFirst({
      where: { workflowType: def.workflowType, status: 'ACTIVE' },
    });
    if (prior) {
      await tx.workflowDefinition.update({
        where: { id: prior.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
    }
    await tx.workflowDefinition.update({
      where: { id: definitionId },
      data: { status: 'ACTIVE', activatedById: actor.userId, activatedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'WORKFLOW_DEF_ACTIVATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowDefinition',
      objectId: definitionId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        workflowType: def.workflowType,
        version: def.version,
        supersededVersion: prior?.version ?? null,
      },
    });
  });
}

/** B.2: retire an ACTIVE or SUPERSEDED version (no new activations from it). */
export async function retireWorkflowDefinition(actor: Actor, definitionId: string, reason: string) {
  if (!can(actor, 'workflowDef.activate')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const def = await prisma.workflowDefinition.findUnique({ where: { id: definitionId } });
  if (!def) throw ServiceError.notFound();
  const transitionError = workflowDefTransitionError('retire', def.status);
  if (transitionError) throw ServiceError.conflict(transitionError);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.workflowDefinition.update({
      where: { id: definitionId },
      data: { status: 'RETIRED', retiredAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'WORKFLOW_DEF_RETIRED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowDefinition',
      objectId: definitionId,
      result: 'SUCCESS',
      correlationId,
      metadata: { workflowType: def.workflowType, version: def.version, reason },
    });
  });
}
