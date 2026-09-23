/**
 * Case Approval Summary (owner directive 2026-09-22, DEC-066).
 *
 * The HR Manager approves the offboarding case ONCE, and that approval
 * authorizes the assigned HR Officer to execute everything downstream. For
 * the approval to mean something the Manager has to see what it authorizes:
 * the employee, the exit details, who will execute the case, which benefits
 * and providers were selected, WHO will be contacted (and whether each
 * recipient actually resolves), which documents and forms the case will
 * produce, and what happens the moment the case is approved.
 *
 * Everything here is derived from the same facts and rules that drive the
 * real work at activation (the derived-actions engine, centralized routing,
 * the document type per separation, survey eligibility) - so the plan the
 * Manager approves is the plan the platform will run, not a second opinion.
 * Read-only; the decision itself is the ordinary audited case transition.
 */
import {
  canActOnCase,
  canViewCase,
  deriveRequiredActions,
  destinationLabel,
  hasRole,
  letterTypeForDeparture,
  maskDestination,
  separationProfile,
  surveyEligibility,
  type Actor,
  type BenefitsApplicability,
  type DestinationKey,
  type DocumentType,
  type NotificationType,
  type SeparationInitiator,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { gatherFacts } from './derivedActionService.ts';
import { resolveRoute, routeFor, type RouteResolution } from './routingService.ts';
import { assertFullView, loadCaseAccess } from './shared.ts';

// --- audiences ----------------------------------------------------------------

/** The people and groups a Manager thinks in, not destination keys. */
export const COMMUNICATION_AUDIENCES = [
  'EMPLOYEE',
  'MANAGER',
  'IT',
  'FINANCE',
  'HR',
  'PROVIDERS',
  'OTHER',
] as const;
export type CommunicationAudience = (typeof COMMUNICATION_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<CommunicationAudience, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Reporting Manager',
  IT: 'IT',
  FINANCE: 'Finance',
  HR: 'Human Resources',
  PROVIDERS: 'Benefit providers',
  OTHER: 'Other recipients',
};

/** Which audience a route's primary destination belongs to. */
export function audienceForDestination(key: DestinationKey | string): CommunicationAudience {
  switch (key) {
    case 'dynamic:EMPLOYEE':
      return 'EMPLOYEE';
    case 'dynamic:EMPLOYEE_MANAGER':
      return 'MANAGER';
    case 'static:IT':
    case 'static:SECURITY':
      return 'IT';
    case 'static:FINANCE':
    case 'static:PAYROLL':
    case 'static:PAYROLL_BANK':
      return 'FINANCE';
    case 'static:HR':
    case 'static:HR_OFFICERS':
    case 'dynamic:ASSIGNED_HR_OFFICER':
    case 'dynamic:CASE_OWNER':
      return 'HR';
    case 'static:GROUP_HEALTH_PROVIDER':
    case 'static:GROUP_LIFE_PROVIDER':
    case 'static:PENSION_PROVIDER':
    case 'static:OTHER_APPROVED_EXTERNAL':
      return 'PROVIDERS';
    default:
      return 'OTHER';
  }
}

/** Business-language purpose of each communication the plan can contain. */
const PURPOSE: Record<NotificationType, string> = {
  IT_ACCESS_REMOVAL: 'Access removal notification',
  FINANCE_OFFBOARDING: 'Payroll and final-pay notification',
  LINE_MANAGER_HANDOVER: 'Departure notice and what is expected',
  RETURN_ITEMS_CHECKLIST: 'Exit checklist for return items (secure link)',
  RESIGNATION_ACCEPTANCE_LETTER: 'Resignation acknowledgement letter (PDF attached)',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'Group health cover removal',
  NCB_GROUP_LIFE_REMOVAL: 'Group life cover removal',
  SURVEY_INVITATION_REFERENCE: 'Exit survey invitation',
  SIGNATURE_REQUEST: 'Request to review and sign a form (secure link)',
  MANUAL_EXCEPTION_NOTIFICATION: 'Manual exception notice',
  PAYROLL_OR_BANK_NOTIFICATION: 'Payroll or bank notification',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'Other provider notification',
};

// --- plan shapes --------------------------------------------------------------

export type CommunicationReadiness =
  'READY' | 'NOT_REQUIRED' | 'MISSING_RECIPIENT' | 'WAITING_ON_CASE';

export const READINESS_LABELS: Record<CommunicationReadiness, string> = {
  READY: 'Ready',
  NOT_REQUIRED: 'Not required',
  MISSING_RECIPIENT: 'Recipient not configured',
  WAITING_ON_CASE: 'Waiting on case information',
};

export interface PlannedDestination {
  /** Business label of the destination ("IT", "The departing employee"). */
  label: string;
  /** The address, full for the HR Manager and masked for everyone else. */
  address: string;
  /** Where the address came from, in words. */
  source: 'CASE' | 'DIRECTORY' | 'CONFIGURATION';
}

export interface PlannedCommunication {
  key: string;
  notificationType: NotificationType;
  purpose: string;
  audience: CommunicationAudience;
  applicable: boolean;
  /** Why it is or is not required, in one line. */
  note: string;
  timing: string;
  readiness: CommunicationReadiness;
  to: PlannedDestination | null;
  cc: PlannedDestination[];
  /** Business-language reasons a destination could not be resolved. */
  unresolved: string[];
}

export interface AudienceGroup {
  audience: CommunicationAudience;
  label: string;
  readiness: CommunicationReadiness;
  items: PlannedCommunication[];
}

export interface PlannedArtifact {
  key: string;
  title: string;
  kind: 'LETTER' | 'FORM' | 'CHECKLIST' | 'PROVIDER_NOTICE' | 'SURVEY';
  applicable: boolean;
  note: string;
}

export interface CaseApprovalSummary {
  caseId: string;
  caseNumber: string;
  status: string;
  classification: string;
  recordPurpose: string;
  version: number;
  employee: {
    displayName: string;
    employeeNumber: string | null;
    jobTitle: string | null;
    department: string;
    location: string;
    managerName: string | null;
    workEmailMask: string | null;
    sourceSystem: string;
  };
  exit: {
    separationType: string;
    separationLabel: string;
    initiator: SeparationInitiator;
    noticeArrangement: string | null;
    receivedDateLabel: string;
    receivedAt: Date;
    receiptSource: string;
    confirmedLastDay: Date | null;
    effectiveSeparationAt: Date | null;
    contractEndDate: Date | null;
    separationTypeDetail: string | null;
    authorizedByName: string | null;
    reasonCaptureStatus: string;
    reasonCategory: string | null;
    dateOverrideReason: string | null;
  };
  ownership: {
    assignedOfficerId: string | null;
    assignedOfficerName: string | null;
    createdById: string;
    createdByName: string;
    createdAt: Date;
    submittedAt: Date | null;
    submittedByName: string | null;
  };
  benefits: {
    groupHealth: BenefitsApplicability;
    groupLife: BenefitsApplicability;
    source: string | null;
    confirmedAt: Date | null;
  };
  communications: {
    groups: AudienceGroup[];
    /** Null when the plan could be built; otherwise why not (no effective date). */
    unavailableReason: string | null;
    missingRecipients: number;
  };
  artifacts: PlannedArtifact[];
  workflow: {
    definitionName: string | null;
    definitionVersion: number | null;
    hrTaskCount: number;
    /** Manager-approval tasks in the definition: must be zero (DEC-066). */
    managerTaskCount: number;
  };
  capabilities: {
    /** Approve a submitted case. */
    canApprove: boolean;
    /** Approve the manager's own draft in one audited step. */
    canApproveDraft: boolean;
    canReturn: boolean;
    /** Full addresses are shown only to the approving HR Manager. */
    seesFullAddresses: boolean;
  };
}

// --- building the plan --------------------------------------------------------

function destinationOf(resolved: RouteResolution['to'], full: boolean): PlannedDestination | null {
  if (!resolved) return null;
  const [kind] = resolved.destination.split(':');
  return {
    label: resolved.displayName ?? resolved.label,
    address: full ? resolved.email : maskDestination(resolved.email),
    source:
      kind === 'dynamic'
        ? resolved.destination === 'dynamic:EMPLOYEE'
          ? 'CASE'
          : 'DIRECTORY'
        : 'CONFIGURATION',
  };
}

async function planCommunication(args: {
  key: string;
  notificationType: NotificationType;
  applicable: boolean;
  note: string;
  timing: string;
  caseFacts: Parameters<typeof resolveRoute>[1];
  full: boolean;
}): Promise<PlannedCommunication> {
  const route = await routeFor(args.notificationType);
  const audience = audienceForDestination(route.to);
  if (!args.applicable) {
    return {
      key: args.key,
      notificationType: args.notificationType,
      purpose: PURPOSE[args.notificationType],
      audience,
      applicable: false,
      note: args.note,
      timing: args.timing,
      readiness: 'NOT_REQUIRED',
      to: null,
      cc: [],
      unresolved: [],
    };
  }
  const resolution = await resolveRoute(args.notificationType, args.caseFacts);
  const to = destinationOf(resolution.to, args.full);
  const [toKind] = route.to.split(':');
  // A person on the case with no address is case information HR can still
  // supply (an email, an alternate manager); a department or provider with no
  // approved mailbox is configuration an administrator must fix.
  const readiness: CommunicationReadiness = to
    ? 'READY'
    : toKind === 'dynamic'
      ? 'WAITING_ON_CASE'
      : 'MISSING_RECIPIENT';
  return {
    key: args.key,
    notificationType: args.notificationType,
    purpose: PURPOSE[args.notificationType],
    audience,
    applicable: true,
    note: args.note,
    timing: args.timing,
    readiness,
    to,
    cc: resolution.cc
      .map((r) => destinationOf(r, args.full))
      .filter((d): d is PlannedDestination => d !== null),
    unresolved: resolution.unresolved.map((u) => `${destinationLabel(route.to)}: ${u}`.trim()),
  };
}

const GROUP_ORDER: CommunicationAudience[] = [
  'EMPLOYEE',
  'MANAGER',
  'IT',
  'FINANCE',
  'HR',
  'PROVIDERS',
  'OTHER',
];

function worst(items: readonly PlannedCommunication[]): CommunicationReadiness {
  const rank: Record<CommunicationReadiness, number> = {
    MISSING_RECIPIENT: 3,
    WAITING_ON_CASE: 2,
    READY: 1,
    NOT_REQUIRED: 0,
  };
  return items.reduce<CommunicationReadiness>(
    (acc, i) => (rank[i.readiness] > rank[acc] ? i.readiness : acc),
    'NOT_REQUIRED',
  );
}

export async function getCaseApprovalSummary(
  actor: Actor,
  caseId: string,
): Promise<CaseApprovalSummary> {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  if (!canViewCase(actor, ctx)) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const now = new Date();

  const [officer, creator, submission, reasonCategory, definition] = await Promise.all([
    c.assignedOfficerId
      ? prisma.user.findUnique({
          where: { id: c.assignedOfficerId },
          select: { displayName: true },
        })
      : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: c.createdById }, select: { displayName: true } }),
    prisma.caseStatusHistory.findFirst({
      where: { caseId, toStatus: 'PENDING_HR_REVIEW' },
      orderBy: { occurredAt: 'desc' },
      select: { actorId: true, occurredAt: true },
    }),
    c.reasonCategoryId
      ? prisma.reasonCategory.findUnique({
          where: { id: c.reasonCategoryId },
          select: { label: true },
        })
      : Promise.resolve(null),
    prisma.workflowDefinition.findFirst({
      where: { workflowType: c.departureType as never, status: 'ACTIVE' },
      select: {
        name: true,
        version: true,
        taskDefs: { select: { department: true, requiredRole: true } },
      },
    }),
  ]);
  const submitter = submission
    ? await prisma.user.findUnique({
        where: { id: submission.actorId },
        select: { displayName: true },
      })
    : null;

  const profile = separationProfile(c.departureType);
  const full = hasRole(actor, 'HR_MANAGER');
  const caseFacts = {
    caseId: c.id,
    employeeSourceSystem: c.employeeSourceSystem,
    employeeWorkEmail: c.employeeWorkEmail,
    employeeDisplayName: c.employeeDisplayName,
    managerSourceId: c.managerSourceId,
    assignedOfficerId: c.assignedOfficerId,
    ownerId: c.ownerId,
  };

  // --- communications: the same rules engine that runs at activation --------
  const planned: PlannedCommunication[] = [];
  let unavailableReason: string | null = null;
  const gathered = await gatherFacts(caseId);
  if (!gathered) {
    unavailableReason =
      'The communication plan needs the employment end date; record it on the case first.';
  } else {
    const specs = deriveRequiredActions(gathered.facts, now);
    for (const spec of specs) {
      if (spec.kind !== 'EMAIL_ACTION') continue;
      // A benefits rule with UNKNOWN applicability has no notification type
      // yet; it is still shown so the Manager sees the open question.
      const type: NotificationType | null =
        spec.notificationType ??
        (spec.actionKey === 'EMAIL:GROUP_HEALTH_REMOVAL'
          ? 'SAGICOR_GROUP_HEALTH_REMOVAL'
          : spec.actionKey === 'EMAIL:GROUP_LIFE_REMOVAL'
            ? 'NCB_GROUP_LIFE_REMOVAL'
            : spec.actionKey === 'EMAIL:OTHER_PROVIDER'
              ? 'OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION'
              : null);
      if (!type) continue;
      const schedule =
        typeof spec.result['schedule'] === 'string' ? (spec.result['schedule'] as string) : '';
      const reason =
        typeof spec.result['reason'] === 'string' ? (spec.result['reason'] as string) : '';
      planned.push(
        await planCommunication({
          key: spec.actionKey,
          notificationType: type,
          applicable: spec.applicable,
          note: reason || schedule || spec.title,
          timing: schedule || 'Released by the assigned HR Officer when the case is active.',
          caseFacts,
          full,
        }),
      );
    }
    // The letter and the survey are not derived actions; they belong to the
    // plan all the same, because the Manager is approving them too.
    const letterType = letterTypeForDeparture(c.departureType);
    planned.unshift(
      await planCommunication({
        key: 'LETTER:ACCEPTANCE',
        notificationType: 'RESIGNATION_ACCEPTANCE_LETTER',
        applicable: letterType !== null,
        note: letterType
          ? 'Prepared and finalized by the assigned HR Officer, then sent with the PDF attached.'
          : 'No operational letter exists for this separation type.',
        timing: 'Sent by the assigned HR Officer once the letter is finalized.',
        caseFacts,
        full,
      }),
    );
    const survey = surveyEligibility(c.departureType);
    planned.push(
      await planCommunication({
        key: 'SURVEY:INVITATION',
        notificationType: 'SURVEY_INVITATION_REFERENCE',
        applicable: survey.eligibleByDefault,
        note: survey.eligibleByDefault
          ? 'Eligible by default for this separation type.'
          : 'Not sent for this separation type without an explicit HR Manager override.',
        timing: 'Scheduled after the effective separation.',
        caseFacts,
        full,
      }),
    );
  }
  const groups: AudienceGroup[] = GROUP_ORDER.map((audience) => {
    const items = planned.filter((p) => p.audience === audience);
    return { audience, label: AUDIENCE_LABELS[audience], readiness: worst(items), items };
  }).filter((g) => g.items.length > 0);

  // --- documents and forms ----------------------------------------------------
  const letterType: DocumentType | null = letterTypeForDeparture(c.departureType);
  const benefitsNote = (v: BenefitsApplicability) =>
    v === 'YES'
      ? 'Selected at intake - the provider notification is prepared for the HR Officer to send.'
      : v === 'NO'
        ? 'Not selected at intake - nothing is sent to this provider.'
        : 'Not yet decided - resolve before the provider notification can be prepared.';
  const survey = surveyEligibility(c.departureType);
  const artifacts: PlannedArtifact[] = [
    {
      key: 'LETTER',
      title:
        letterType === 'IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT'
          ? 'Immediate resignation acknowledgement'
          : 'Resignation acknowledgement and acceptance letter',
      kind: 'LETTER',
      applicable: letterType !== null,
      note: letterType
        ? 'Generated from the active template; finalized and sent by the assigned HR Officer.'
        : 'No operational letter exists for this separation type.',
    },
    {
      key: 'ACTION_FORM',
      title: 'Employee action form',
      kind: 'FORM',
      applicable: true,
      note: 'Prepared and completed by the assigned HR Officer (attested, final PDF).',
    },
    {
      key: 'RETURN_ITEMS',
      title: 'Exit checklist for return items',
      kind: 'CHECKLIST',
      applicable: true,
      note: 'Sent as a secure link; completion is the submitted checklist.',
    },
    {
      key: 'GROUP_HEALTH',
      title: 'Group health provider notification',
      kind: 'PROVIDER_NOTICE',
      applicable: c.groupHealthApplicability === 'YES',
      note: benefitsNote(c.groupHealthApplicability),
    },
    {
      key: 'GROUP_LIFE',
      title: 'Group life provider notification',
      kind: 'PROVIDER_NOTICE',
      applicable: c.groupLifeApplicability === 'YES',
      note: benefitsNote(c.groupLifeApplicability),
    },
    {
      key: 'SURVEY',
      title: 'Exit survey invitation',
      kind: 'SURVEY',
      applicable: survey.eligibleByDefault,
      note: survey.eligibleByDefault
        ? 'Scheduled after the effective separation; never blocks clearance.'
        : 'Suppressed for this separation type unless the HR Manager overrides.',
    },
  ];

  return {
    caseId: c.id,
    caseNumber: c.caseNumber,
    status: c.status,
    classification: c.classification,
    recordPurpose: c.recordPurpose,
    version: c.version,
    employee: {
      displayName: c.employeeDisplayName,
      employeeNumber: c.employeeNumber,
      jobTitle: c.jobTitle,
      department: c.department,
      location: c.location,
      managerName: c.managerName,
      workEmailMask: c.employeeWorkEmail ? maskDestination(c.employeeWorkEmail) : null,
      sourceSystem: c.employeeSourceSystem,
    },
    exit: {
      separationType: c.departureType,
      separationLabel: profile.label,
      initiator: profile.initiator,
      noticeArrangement: profile.noticeArrangement ?? null,
      receivedDateLabel: profile.receivedDateLabel,
      receivedAt: c.receivedAt,
      receiptSource: c.receiptSource,
      confirmedLastDay: c.confirmedLastDay,
      effectiveSeparationAt: c.effectiveSeparationAt,
      contractEndDate: c.contractEndDate,
      separationTypeDetail: c.separationTypeDetail,
      authorizedByName: c.authorizedByName,
      reasonCaptureStatus: c.reasonCaptureStatus,
      reasonCategory: reasonCategory?.label ?? null,
      dateOverrideReason: c.dateOverrideReason,
    },
    ownership: {
      assignedOfficerId: c.assignedOfficerId,
      assignedOfficerName: officer?.displayName ?? null,
      createdById: c.createdById,
      createdByName: creator?.displayName ?? 'Unknown',
      createdAt: c.createdAt,
      submittedAt: submission?.occurredAt ?? null,
      submittedByName: submitter?.displayName ?? null,
    },
    benefits: {
      groupHealth: c.groupHealthApplicability,
      groupLife: c.groupLifeApplicability,
      source: c.benefitsSource,
      confirmedAt: c.benefitsConfirmedAt,
    },
    communications: {
      groups,
      unavailableReason,
      missingRecipients: planned.filter(
        (p) => p.readiness === 'MISSING_RECIPIENT' || p.readiness === 'WAITING_ON_CASE',
      ).length,
    },
    artifacts,
    workflow: {
      definitionName: definition?.name ?? null,
      definitionVersion: definition?.version ?? null,
      hrTaskCount: definition?.taskDefs.filter((t) => t.department === 'HR').length ?? 0,
      managerTaskCount:
        definition?.taskDefs.filter((t) => (t.requiredRole as string) === 'HR_MANAGER').length ?? 0,
    },
    capabilities: {
      canApprove: canActOnCase(actor, 'case.approve', ctx) && c.status === 'PENDING_HR_REVIEW',
      canApproveDraft: canActOnCase(actor, 'case.approve', ctx) && c.status === 'DRAFT',
      canReturn: canActOnCase(actor, 'case.return', ctx) && c.status === 'PENDING_HR_REVIEW',
      seesFullAddresses: full,
    },
  };
}
