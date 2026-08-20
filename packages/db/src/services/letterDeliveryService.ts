/**
 * Issuing an approved letter to the employee by email (DEC-054).
 *
 * The resignation acceptance letter is drafted, approved and rendered through
 * the existing maker-checker document chain. This service adds the last step
 * HR asked for: send the rendered PDF to the employee, copying the HR
 * colleagues the officer selects from the directory.
 *
 * Nothing here bypasses an existing control. The letter must already be
 * RENDERED, the send goes through the same transactional outbox and provider
 * boundary as every other email (so development captures rather than
 * delivers), and the PDF is read from object storage and checksum-verified at
 * dispatch rather than copied around.
 */
import {
  type Actor,
  canActOnCase,
  contentChecksum,
  destinationErrors,
  docTransitionError,
  firstNameOf,
  formatDateOnly,
  maskDestination,
  notificationIdempotencyKey,
  RENDERABLE_LETTER_TYPES,
  substitute,
  type DocumentType,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { encryptValue } from '../secretBox.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { enqueueOutboxTx } from './outboxService.ts';
import { resolveRoute, routingEnvironment } from './routingService.ts';

/** One person the letter may be copied to. */
export interface LetterCcContact {
  /** Directory source id where the contact came from the directory. */
  sourceId: string;
  displayName: string;
  jobTitle: string | null;
  /** Masked for display; the address itself is never returned to a page. */
  emailMask: string;
}

/**
 * The HR colleagues who may be copied on an employee letter.
 *
 * "The Human Resources in the directory" is read two ways, because neither
 * alone is complete: directory records whose department reads as Human
 * Resources, plus the people who actually hold HR roles in this application.
 * This is a display filter for a dropdown, not an authorization rule - the
 * authority to send is checked separately.
 */
export async function listHrCcContacts(actor: Actor, caseId: string): Promise<LetterCcContact[]> {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'doc.markIssued', ctx)) throw ServiceError.forbidden();
  const prisma = getPrisma();

  const [byDepartment, hrUsers] = await Promise.all([
    prisma.employeeSourceRecord.findMany({
      where: {
        active: true,
        NOT: [{ workEmail: null }, { workEmail: '' }],
        OR: [
          { department: { contains: 'human resource', mode: 'insensitive' } },
          { department: { equals: 'HR', mode: 'insensitive' } },
        ],
      },
      select: { sourceId: true, displayName: true, jobTitle: true, workEmail: true },
      orderBy: { displayName: 'asc' },
    }),
    prisma.user.findMany({
      where: {
        deactivatedAt: null,
        workEmail: { notIn: [''] },
        roleAssignments: {
          some: { revokedAt: null, role: { in: ['HR_OFFICER', 'HR_MANAGER'] } },
        },
      },
      select: { displayName: true, workEmail: true },
      orderBy: { displayName: 'asc' },
    }),
  ]);

  const byEmail = new Map<string, LetterCcContact>();
  for (const row of byDepartment) {
    const email = row.workEmail!.trim().toLowerCase();
    byEmail.set(email, {
      sourceId: row.sourceId,
      displayName: row.displayName,
      jobTitle: row.jobTitle,
      emailMask: maskDestination(email),
    });
  }
  // An HR account without a directory record still needs to be selectable, so
  // it is keyed by its own work email.
  for (const user of hrUsers) {
    const email = user.workEmail.trim().toLowerCase();
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      sourceId: `user:${email}`,
      displayName: user.displayName,
      jobTitle: 'Human Resources',
      emailMask: maskDestination(email),
    });
  }
  return [...byEmail.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Resolve the selected ids back to addresses, refusing anything unknown. */
async function resolveCc(
  ids: readonly string[],
): Promise<{ emails: string[]; names: string[]; masks: string[] }> {
  const prisma = getPrisma();
  const emails: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    let email: string | null = null;
    let name = '';
    if (id.startsWith('user:')) {
      const user = await prisma.user.findFirst({
        where: { workEmail: { equals: id.slice(5), mode: 'insensitive' }, deactivatedAt: null },
        select: { displayName: true, workEmail: true },
      });
      email = user?.workEmail ?? null;
      name = user?.displayName ?? '';
    } else {
      const row = await prisma.employeeSourceRecord.findFirst({
        where: { sourceId: id, active: true },
        select: { displayName: true, workEmail: true },
      });
      email = row?.workEmail ?? null;
      name = row?.displayName ?? '';
    }
    if (!email?.trim())
      throw ServiceError.validation(['A selected copied recipient has no work email on record.']);
    const normalized = email.trim();
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    emails.push(normalized);
    names.push(name);
  }
  return { emails, names, masks: emails.map(maskDestination) };
}

const addressSchema = z.object({
  employeeAddress: z.string().trim().max(300),
});

/**
 * Record the address the acceptance letter is written to. HR types it from
 * the resignation letter scan (DEC-054): the directory holds no home address
 * and the platform must not invent one. Stored on the case, used only in the
 * addressed letter, and never carried into logs, emails or audit metadata.
 */
export async function setEmployeeAddress(
  actor: Actor,
  caseId: string,
  rawInput: unknown,
): Promise<void> {
  const parsed = addressSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const address = parsed.data.employeeAddress || null;

  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'doc.edit', ctx)) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const before = await prisma.offboardingCase.findUniqueOrThrow({
    where: { id: caseId },
    select: { employeeAddress: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.offboardingCase.update({ where: { id: caseId }, data: { employeeAddress: address } });
    await appendAudit(tx, {
      eventType: 'CASE_EMPLOYEE_ADDRESS_RECORDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      // The address is personal data: the trail records THAT it changed and
      // who changed it, never the value itself.
      metadata: {
        previouslyRecorded: before.employeeAddress !== null,
        nowRecorded: address !== null,
      },
    });
  });
}

const issueSchema = z.object({
  ccIds: z.array(z.string().min(1).max(200)).max(20).default([]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Send an approved, rendered letter to the employee with the PDF attached.
 * Returns the notification record so the case can show the delivery state.
 */
export async function issueDocumentByEmail(
  actor: Actor,
  docId: string,
  rawInput: unknown,
): Promise<{ recordId: string; destinationMask: string; ccCount: number }> {
  const parsed = issueSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const prisma = getPrisma();
  const doc = await prisma.documentInstance.findUnique({
    where: { id: docId },
    include: { case: true },
  });
  if (!doc) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, doc.caseId);
  if (!canActOnCase(actor, 'doc.markIssued', ctx)) throw ServiceError.forbidden();

  const guard = docTransitionError('issueByEmail', doc.status);
  if (guard) throw ServiceError.validation([guard]);
  if (!RENDERABLE_LETTER_TYPES.includes(doc.documentType as DocumentType))
    throw ServiceError.validation(['Only a rendered letter can be issued by email.']);
  if (!doc.pdfObjectKey || !doc.pdfChecksum)
    throw ServiceError.validation(['The letter has no rendered PDF to attach.']);

  const c = doc.case;
  // Centralized routing decides where the letter goes (DEC-056). By default
  // that is the departing employee, but an administrator can re-address the
  // letter without anyone touching this code.
  const routed = await resolveRoute('RESIGNATION_ACCEPTANCE_LETTER', {
    caseId: c.id,
    employeeSourceSystem: c.employeeSourceSystem,
    employeeWorkEmail: c.employeeWorkEmail,
    employeeDisplayName: c.employeeDisplayName,
    managerSourceId: c.managerSourceId,
    assignedOfficerId: c.assignedOfficerId,
    ownerId: c.ownerId,
  });
  if (!routed.to)
    throw ServiceError.validation(
      routed.unresolved.length
        ? routed.unresolved
        : ['This case has no employee email address. Record one before issuing the letter.'],
    );
  const destination = routed.to.email;
  const errors = destinationErrors(destination, routingEnvironment());
  if (errors.length) throw ServiceError.validation(errors);

  const chosen = await resolveCc(input.ccIds);
  // Copies configured on the route come first, then the colleagues the
  // officer picked for this case; an address is never listed twice.
  const cc = {
    emails: [...routed.cc.map((r) => r.email), ...chosen.emails],
    names: [...routed.cc.map((r) => r.displayName ?? r.label), ...chosen.names],
    masks: [...routed.cc.map((r) => maskDestination(r.email)), ...chosen.masks],
  };
  const seenCc = new Set<string>();
  for (let i = cc.emails.length - 1; i >= 0; i -= 1) {
    const key = cc.emails[i]!.toLowerCase();
    if (seenCc.has(key) || key === destination.toLowerCase()) {
      cc.emails.splice(i, 1);
      cc.names.splice(i, 1);
      cc.masks.splice(i, 1);
      continue;
    }
    seenCc.add(key);
  }
  for (const address of cc.emails) {
    const ccErrors = destinationErrors(address, routingEnvironment());
    if (ccErrors.length) throw ServiceError.validation(ccErrors);
  }

  const template = await prisma.notificationTemplate.findFirst({
    where: { notificationType: 'RESIGNATION_ACCEPTANCE_LETTER', status: 'ACTIVE' },
  });
  if (!template)
    throw ServiceError.validation([
      'No active template exists for the acceptance letter email. Activate one under Administration.',
    ]);

  const officer = await hrSender(c.assignedOfficerId ?? c.ownerId);
  const values: Record<string, string> = {
    EMPLOYEE_LEGAL_NAME: c.employeeDisplayName,
    EMPLOYEE_FIRST_NAME: firstNameOf(c.employeeDisplayName),
    CASE_REFERENCE: c.caseNumber,
    CONFIRMED_LAST_WORKING_DATE: c.confirmedLastDay ? formatDateOnly(c.confirmedLastDay) : '',
    HR_SENDER_NAME: officer.name,
    HR_SENDER_TITLE: officer.title,
  };
  const subject = substitute(template.subjectTemplate, values);
  const body = substitute(template.bodyTemplate, values);

  const now = new Date();
  const correlationId = newCorrelationId();
  const idempotencyKey = `${notificationIdempotencyKey({
    caseId: c.id,
    notificationType: 'RESIGNATION_ACCEPTANCE_LETTER',
    recipientClass: 'EMPLOYEE',
    workflowVersion: 0,
    effectiveEventAt: c.effectiveSeparationAt,
  })}:doc${doc.id}:v${doc.version}`;

  const recordId = await prisma.$transaction(async (tx) => {
    const record = await tx.notificationRecord.create({
      data: {
        caseId: c.id,
        notificationType: 'RESIGNATION_ACCEPTANCE_LETTER',
        templateId: template.id,
        templateVersion: template.version,
        recipientClass: 'EMPLOYEE',
        // HR issued this deliberately, letter in hand: it is approved by the
        // act of sending, not by a second queue.
        status: 'APPROVED',
        idempotencyKey,
        subjectSnapshot: subject,
        bodySnapshot: body,
        contentChecksum: contentChecksum(`${subject}\n${body}`),
        fieldSnapshot: values,
        origin: 'MANUAL',
        controlLevel: 'HR_REVIEW_THEN_SEND',
        recipientName: c.employeeDisplayName,
        recipientKind: 'EXTERNAL',
        caseRecipientCiphertext: encryptValue(destination),
        caseRecipientMask: maskDestination(destination),
        ccCiphertext: cc.emails.length ? encryptValue(JSON.stringify(cc.emails)) : null,
        ccNames: cc.names,
        ccMasks: cc.masks,
        // A manually issued letter carries no blind copies: the officer sees
        // exactly who receives it.
        bccNames: [],
        bccMasks: [],
        attachedDocumentId: doc.id,
        approvedById: actor.userId,
        approvedAt: now,
        createdById: actor.userId,
      },
    });

    await enqueueOutboxTx(
      tx,
      {
        id: record.id,
        caseId: c.id,
        notificationType: 'RESIGNATION_ACCEPTANCE_LETTER',
        templateVersion: template.version,
        subjectSnapshot: subject,
        contentChecksum: record.contentChecksum,
        idempotencyKey,
      },
      { id: null, destinationMask: maskDestination(destination) },
      0,
      actor,
      correlationId,
    );

    const updated = await tx.documentInstance.updateMany({
      where: { id: doc.id, rowVersion: doc.rowVersion, status: 'RENDERED' },
      data: {
        status: 'ISSUED_BY_EMAIL',
        issuedById: actor.userId,
        issuedAt: now,
        issueMethod: 'EMAIL',
        recipientClass: 'EMPLOYEE',
        issueNote: input.note || null,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');

    await appendAudit(tx, {
      eventType: 'DOC_ISSUED_BY_EMAIL',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: doc.id,
      caseId: c.id,
      result: 'SUCCESS',
      correlationId,
      // Masks and names only - no address ever reaches the audit trail.
      metadata: {
        documentType: doc.documentType,
        documentVersion: doc.version,
        notificationRecordId: record.id,
        destinationMask: maskDestination(destination),
        copiedTo: cc.names,
        copiedMasks: cc.masks,
      },
    });
    return record.id;
  });

  return { recordId, destinationMask: maskDestination(destination), ccCount: cc.emails.length };
}

/** Name and title for the officer whose signature block the email carries. */
async function hrSender(userId: string | null): Promise<{ name: string; title: string }> {
  if (!userId) return { name: 'Human Resources', title: 'Human Resources' };
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, workEmail: true },
  });
  if (!user) return { name: 'Human Resources', title: 'Human Resources' };
  const directory = user.workEmail
    ? await prisma.employeeSourceRecord.findFirst({
        where: { workEmail: user.workEmail },
        select: { jobTitle: true },
      })
    : null;
  return { name: user.displayName, title: directory?.jobTitle ?? 'Human Resources' };
}
