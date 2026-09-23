/**
 * Stage 3 synthetic seeds (Directive 3 sections F, G, H, K, L; extended by
 * Directive 6.3).
 *
 * Everything here is clearly-labelled synthetic development configuration:
 * the development workflow definitions (one per departure type - version 1
 * preserved as frozen history, version 2 is the HR-validated Directive 6.3
 * simplification), deterministic notification templates, the asset catalogue
 * and synthetic employee-issued assets. Nothing is production-approved.
 */
import { createHash } from 'node:crypto';
import { workflowConfigChecksum, NOTIFICATION_PLACEHOLDERS } from '@exit/domain';
import type { getPrisma } from './client.ts';

type Db = ReturnType<typeof getPrisma>;

export const DEV_WORKFLOW_MARK =
  'DEVELOPMENT WORKFLOW - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE';
const DEV_TEMPLATE_MARK = 'DEVELOPMENT TEMPLATE - REQUIRES HR APPROVAL BEFORE OPERATIONAL USE';

interface SeedTask {
  taskCode: string;
  title: string;
  description: string;
  department: 'HR' | 'IT' | 'FINANCE' | 'LINE_MANAGER';
  requiredRole: 'HR_MANAGER' | 'HR_OFFICER' | 'IT_RESPONDER' | 'FINANCE_RESPONDER' | 'LINE_MANAGER';
  taskKind?: 'STANDARD' | 'ACCESS_REVOCATION';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  confidential?: boolean;
  required?: boolean;
  waiverAllowed?: boolean;
  dueBasis:
    'CASE_RECEIVED' | 'WORKFLOW_ACTIVATION' | 'EFFECTIVE_SEPARATION' | 'FINAL_WORKING_DAY' | 'NONE';
  dueOffsetDays?: number;
  dueOffsetKind?: 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'EXACT_TIME';
  releaseBasis?: 'IMMEDIATE' | 'EFFECTIVE_SEPARATION';
  releaseOffsetHours?: number;
  pausesOnHold?: boolean;
  blockPausesSla?: boolean;
  dependsOnCodes?: string[];
  evidenceKind?: 'NONE' | 'NOTE' | 'ATTACHMENT' | 'LINKED_RECORD';
  evidenceNote?: string;
  slaNote?: string;
  escalationNote?: string;
}

const ACCESS_TASK_BASE = {
  taskKind: 'ACCESS_REVOCATION' as const,
  priority: 'CRITICAL' as const,
  required: true,
  waiverAllowed: false,
  dueBasis: 'EFFECTIVE_SEPARATION' as const,
  dueOffsetKind: 'EXACT_TIME' as const,
  pausesOnHold: false,
  evidenceKind: 'NOTE' as const,
  slaNote: 'Due at the exact approved effective separation time (elapsed clock time).',
  escalationNote:
    'CRITICAL at the due instant; second escalation after 15 minutes. Cannot be waived.',
};

/** Section F: resignation with notice (24 seeded obligations). */
const RESIGNATION_TASKS: SeedTask[] = [
  {
    taskCode: 'HR_VERIFY_CASE',
    title: 'Verify resignation and case information',
    description: 'Confirm the resignation evidence, employee identity and case data are correct.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 1,
    slaNote: 'Within one business day of receipt.',
  },
  {
    taskCode: 'HR_CONFIRM_DATES',
    title: 'Confirm proposed and final working dates',
    description: 'Confirm the proposed last day and record the confirmed final working date.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 1,
    dependsOnCodes: ['HR_VERIFY_CASE'],
  },
  {
    taskCode: 'HR_RESIGNATION_DOC',
    title: 'Prepare and approve resignation acceptance document',
    description:
      'Draft, validate and route the resignation acceptance letter for HR Manager approval.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 2,
    dependsOnCodes: ['HR_VERIFY_CASE'],
    evidenceKind: 'LINKED_RECORD',
    evidenceNote: 'Approved and rendered document on the Documents tab.',
    slaNote: 'Within two business days of receipt.',
  },
  {
    taskCode: 'HR_ACTION_FORM_HR',
    title: 'Complete employee action form HR section',
    description:
      'Complete the HR checklist and acknowledgement sections of the digital action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
    dependsOnCodes: ['HR_VERIFY_CASE'],
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'MGR_HANDOVER_PLAN',
    title: 'Prepare handover plan',
    description:
      'Record duties requiring reassignment, open work and key locations in the handover record.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: -2,
    waiverAllowed: true,
    slaNote: 'No later than two business days before the final working day where notice permits.',
  },
  {
    taskCode: 'MGR_REASSIGN_DUTIES',
    title: 'Reassign open duties and deadlines',
    description: 'Reassign open work to the replacement or temporary owner.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: -1,
    waiverAllowed: true,
    dependsOnCodes: ['MGR_HANDOVER_PLAN'],
  },
  {
    taskCode: 'MGR_HANDOVER_COMPLETE',
    title: 'Confirm knowledge-transfer completion',
    description: 'Attest that the handover record is complete and accurate.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    waiverAllowed: true,
    dependsOnCodes: ['MGR_HANDOVER_PLAN'],
    evidenceKind: 'LINKED_RECORD',
    evidenceNote: 'Completed handover record with manager attestation.',
  },
  {
    taskCode: 'IT_ACCESS_REVIEW',
    title: 'Review systems and access requiring removal',
    description:
      'List the systems and access categories to be removed at separation. Do not enter passwords, access codes, private keys or authentication credentials.',
    department: 'IT',
    requiredRole: 'IT_RESPONDER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: -1,
    slaNote: 'Before the effective separation time.',
  },
  {
    taskCode: 'IT_ACCESS_REVOCATION',
    title: 'Revoke system access at the effective separation time',
    description:
      'Remove all listed access at the exact approved effective separation time and record completion evidence.',
    department: 'IT',
    requiredRole: 'IT_RESPONDER',
    dependsOnCodes: ['IT_ACCESS_REVIEW'],
    ...ACCESS_TASK_BASE,
  },
  {
    taskCode: 'FIN_ACKNOWLEDGE',
    title: 'Acknowledge offboarding case',
    description: 'Finance acknowledges the offboarding case for external processing.',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'FIN_WORKPAPER_INIT',
    title: 'Initiate external final-pay workpaper',
    description:
      'Initiate the final-pay workpaper OUTSIDE the application. The application never calculates or alters pay.',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
    dependsOnCodes: ['FIN_ACKNOWLEDGE'],
  },
  {
    taskCode: 'FIN_WORKPAPER_DONE',
    title: 'Record external final-pay workpaper completion',
    description:
      'Record that the external workpaper was completed outside the application (status record only).',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    dependsOnCodes: ['FIN_WORKPAPER_INIT'],
    waiverAllowed: true,
  },
  {
    taskCode: 'HR_SAGICOR_APPLICABILITY',
    title: 'Determine Sagicor group-health applicability',
    description: 'Record whether Sagicor group-health removal applies to this employee.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_NCB_APPLICABILITY',
    title: 'Determine NCB group-life applicability',
    description: 'Record whether NCB group-life removal applies to this employee.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_EXTERNAL_NOTIFICATIONS',
    title: 'Prepare applicable external-provider notifications',
    description:
      'Prepare controlled notifications ONLY where applicability was confirmed. Nothing is emailed by the system.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
    dependsOnCodes: ['HR_SAGICOR_APPLICABILITY', 'HR_NCB_APPLICABILITY'],
    waiverAllowed: true,
  },
  {
    taskCode: 'HR_ASSET_LIST',
    title: 'Confirm employee-issued asset list',
    description:
      'Verify the case asset-recovery list against issued-asset records; add missing items.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HR_ASSET_RECOVERY',
    title: 'Complete asset recovery or final disposition',
    description:
      'Every required asset needs a documented final disposition. Asset status never affects pay.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    dependsOnCodes: ['HR_ASSET_LIST'],
    slaNote: 'Asset return target: by the final working day.',
  },
  {
    taskCode: 'HR_EMPLOYEE_ACK',
    title: 'Complete employee acknowledgement handling',
    description: 'Record the employee acknowledgement outcome on the action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    dependsOnCodes: ['HR_RESIGNATION_DOC'],
  },
  {
    taskCode: 'MGR_ACTION_FORM_APPROVE',
    title: 'Approve the action form (manager)',
    description: 'Line manager reviews and approves the action form where applicable.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
    dependsOnCodes: ['HR_ACTION_FORM_HR'],
    waiverAllowed: true,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HRM_ACTION_FORM_FINAL',
    title: 'Approve the final action form',
    description: 'HR Manager grants the final action-form approval.',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
    dependsOnCodes: ['MGR_ACTION_FORM_APPROVE'],
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR update status',
    description:
      'Record the manual HRIS/BambooHR update as completed, pending or not applicable. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HR_SURVEY_ELIGIBILITY',
    title: 'Assess survey eligibility',
    description: 'Assess exit-survey eligibility per the survey rules.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 1,
  },
  {
    taskCode: 'HR_SURVEY_INVITE',
    title: 'Generate survey invitation when due',
    description: 'Generate the survey invitation when due (voluntary; never blocks clearance).',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
    dueOffsetKind: 'CALENDAR_DAYS',
    dependsOnCodes: ['HR_SURVEY_ELIGIBILITY'],
    required: false,
    waiverAllowed: true,
  },
  {
    taskCode: 'HRM_FINAL_CLEARANCE',
    title: 'Perform final clearance review',
    description:
      'HR Manager reviews the clearance summary and approves final clearance (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
];

/** Section G: immediate resignation - urgent, security-first sequencing. */
const IMMEDIATE_TASKS: SeedTask[] = [
  {
    taskCode: 'HR_URGENT_REVIEW',
    title: 'Urgent HR case review',
    description: 'Immediate review of the resignation-without-notice case.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    slaNote: 'Same business day.',
  },
  {
    taskCode: 'HR_CONFIRM_EFFECTIVE_TIME',
    title: 'Confirm exact effective separation time',
    description: 'Confirm the exact effective separation date and time.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
  },
  {
    taskCode: 'IT_ACCESS_REVIEW',
    title: 'Immediate IT access review',
    description:
      'Immediately list systems and access requiring removal. Do not enter passwords, access codes, private keys or authentication credentials.',
    department: 'IT',
    requiredRole: 'IT_RESPONDER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
  },
  {
    taskCode: 'IT_ACCESS_REVOCATION',
    title: 'Immediate or exact-time access revocation',
    description:
      'Revoke access at the approved effective time. If that time has passed, this task is immediately overdue and critically escalated.',
    department: 'IT',
    requiredRole: 'IT_RESPONDER',
    ...ACCESS_TASK_BASE,
  },
  {
    taskCode: 'HR_ASSET_URGENT_REVIEW',
    title: 'Immediate asset-location and recovery review',
    description: 'Immediately establish where issued assets are and how they will be recovered.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 1,
  },
  {
    taskCode: 'HR_IMMEDIATE_ACK_DOC',
    title: 'Immediate-resignation acknowledgement document',
    description: 'Prepare and approve the immediate-resignation acknowledgement letter.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HR_ACTION_FORM_HR',
    title: 'Complete HR action-form sections',
    description: 'Complete the HR checklist and acknowledgement handling on the action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'FIN_ACKNOWLEDGE',
    title: 'Finance acknowledgement',
    description: 'Finance acknowledges the urgent offboarding case.',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 1,
  },
  {
    taskCode: 'FIN_WORKPAPER_INIT',
    title: 'Initiate external final-pay workpaper',
    description:
      'Initiate the external workpaper OUTSIDE the application; no pay calculation here.',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
    dependsOnCodes: ['FIN_ACKNOWLEDGE'],
  },
  {
    taskCode: 'HR_BENEFITS_REVIEW',
    title: 'Benefits and external-provider applicability review',
    description: 'Determine Sagicor/NCB and other external-provider applicability.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'MGR_HANDOVER_RECORDS',
    title: 'Manager-recorded handover from available records',
    description: 'The manager reconstructs the handover from available organizational records.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
    waiverAllowed: true,
  },
  {
    taskCode: 'MGR_HANDOVER_COMPLETE',
    title: 'Handover completion, not applicable or waiver',
    description:
      'Complete the handover, mark it not applicable, or obtain an HR Manager waiver with a reason.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 5,
    dependsOnCodes: ['MGR_HANDOVER_RECORDS'],
    waiverAllowed: true,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HR_EMPLOYEE_ACK',
    title: 'Employee acknowledgement handling',
    description:
      'Record ACKNOWLEDGED, NOT_OBTAINED with reason, or NOT_APPLICABLE where authorized. Lack of employee participation never skips required work.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_SURVEY_ELIGIBILITY',
    title: 'Survey eligibility and delayed invitation',
    description:
      'Assess survey eligibility; the invitation is delayed to the standard post-separation schedule.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
    dueOffsetKind: 'CALENDAR_DAYS',
    required: false,
    waiverAllowed: true,
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR manual update',
    description: 'Record the manual HRIS update status. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HRM_FINAL_CLEARANCE',
    title: 'Final clearance review',
    description: 'HR Manager clearance review (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
];

/** Section H: restricted termination - minimum data, restricted timing. */
const TERMINATION_TASKS: SeedTask[] = [
  {
    taskCode: 'HR_RESTRICTED_PREP',
    title: 'Restricted HR preparation',
    description: 'Restricted preparation by explicitly assigned HR participants only.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
  },
  {
    taskCode: 'HRM_AUTHORIZATION',
    title: 'Authorized HR Manager approval',
    description: 'HR Manager confirms authorization for the restricted process.',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    dependsOnCodes: ['HR_RESTRICTED_PREP'],
  },
  {
    taskCode: 'HR_CONFIRM_EFFECTIVE_TIME',
    title: 'Confirm exact effective separation date and time',
    description: 'Confirm the exact effective separation instant for the security tasks.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    dependsOnCodes: ['HRM_AUTHORIZATION'],
  },
  {
    taskCode: 'IT_ACCESS_REVOCATION',
    title: 'Revoke system access at the effective time',
    description:
      'Minimum-data access removal task. Released shortly before the approved effective time under the restricted timing rule; due at the exact effective time.',
    department: 'IT',
    requiredRole: 'IT_RESPONDER',
    confidential: true,
    dependsOnCodes: ['HR_CONFIRM_EFFECTIVE_TIME'],
    releaseBasis: 'EFFECTIVE_SEPARATION',
    releaseOffsetHours: -1,
    ...ACCESS_TASK_BASE,
  },
  {
    taskCode: 'HR_RESTRICTED_ACTION_FORM',
    title: 'Restricted action-form processing',
    description: 'Process the action form under restricted-case rules.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'FIN_MINIMUM_TASK',
    title: 'Finance processing (minimum data)',
    description:
      'Finance receives only the minimum information required for approved external processing.',
    department: 'FINANCE',
    requiredRole: 'FINANCE_RESPONDER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
    releaseBasis: 'EFFECTIVE_SEPARATION',
    releaseOffsetHours: 0,
  },
  {
    taskCode: 'HR_BENEFITS_REVIEW',
    title: 'Benefits and external-provider applicability',
    description:
      'Determine external-provider applicability; providers never receive departure details.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_ASSET_RECOVERY',
    title: 'Asset recovery or disposition',
    description: 'Recover issued assets or record final dispositions. No payroll effect.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'MGR_HANDOVER_AUTHORIZED',
    title: 'Manager handover (only where authorized)',
    description:
      'Handover only where expressly authorized and applicable; released at the effective time.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    confidential: true,
    required: false,
    waiverAllowed: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
    releaseBasis: 'EFFECTIVE_SEPARATION',
    releaseOffsetHours: 0,
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR manual update',
    description: 'Record the manual HRIS update status. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HRM_RESTRICTED_CLEARANCE',
    title: 'Restricted final-clearance review',
    description:
      'Restricted clearance review by an authorized HR Manager participant (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
  // H.11: the exit survey is disabled by default for terminations - there is
  // deliberately NO survey task in this workflow.
];

const WORKFLOWS = [
  {
    workflowType: 'RESIGNATION_WITH_NOTICE' as const,
    name: 'DEV Resignation with notice workflow',
    tasks: RESIGNATION_TASKS,
  },
  {
    workflowType: 'IMMEDIATE_RESIGNATION' as const,
    name: 'DEV Immediate resignation workflow',
    tasks: IMMEDIATE_TASKS,
  },
  {
    workflowType: 'TERMINATION' as const,
    name: 'DEV Restricted termination workflow',
    tasks: TERMINATION_TASKS,
  },
];

// --- Directive 6.3: HR-validated workflow version 2 --------------------------
// IT and Finance obligations moved to the deterministic derived email engine
// (controlled notifications with no-login confirmation links), the manager
// approval of the Action Form is removed, external-provider and survey work
// is derived from the single benefits confirmation. The exact-time access-
// revocation guarantee lives in the derived IT email (stating the exact
// effective time), so v2 deliberately carries no ACCESS_REVOCATION task.

/**
 * Directive 6.3 V: the single HR benefits confirmation that feeds the derived
 * provider notifications - shared shape across the three v2 workflows.
 */
const BENEFITS_CONFIRM_BASE = {
  taskCode: 'HR_BENEFITS_CONFIRM',
  title: 'Confirm benefits and provider applicability',
  description:
    'Confirm group health, group life and other-provider applicability under Benefits & providers.',
  department: 'HR' as const,
  requiredRole: 'HR_OFFICER' as const,
  evidenceKind: 'LINKED_RECORD' as const,
  evidenceNote: 'Benefits applicability confirmation recorded on the case.',
};

/** Directive 6.3: resignation with notice v2 (12 HR-validated obligations). */
const RESIGNATION_TASKS_V2: SeedTask[] = [
  {
    taskCode: 'HR_VERIFY_CASE',
    title: 'Verify resignation and case information',
    description: 'Confirm the resignation evidence, employee identity and case data are correct.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 1,
    slaNote: 'Within one business day of receipt.',
  },
  {
    taskCode: 'HR_CONFIRM_DATES',
    title: 'Confirm proposed and final working dates',
    description: 'Confirm the proposed last day and record the confirmed final working date.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 1,
    dependsOnCodes: ['HR_VERIFY_CASE'],
  },
  {
    taskCode: 'HR_RESIGNATION_DOC',
    title: 'Prepare and approve resignation acceptance document',
    description:
      'Draft, validate and route the resignation acceptance letter for HR Manager approval.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 2,
    dependsOnCodes: ['HR_VERIFY_CASE'],
    evidenceKind: 'LINKED_RECORD',
    evidenceNote: 'Approved and rendered document on the Documents tab.',
    slaNote: 'Within two business days of receipt.',
  },
  {
    taskCode: 'HR_ACTION_FORM_HR',
    title: 'Complete employee action form HR section',
    description:
      'Complete the HR checklist and acknowledgement sections of the digital action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
    dependsOnCodes: ['HR_VERIFY_CASE'],
    evidenceKind: 'LINKED_RECORD',
  },
  {
    ...BENEFITS_CONFIRM_BASE,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'MGR_HANDOVER_PLAN',
    title: 'Prepare handover plan',
    description:
      'Record duties requiring reassignment, open work and key locations in the handover record.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: -2,
    waiverAllowed: true,
    slaNote: 'No later than two business days before the final working day where notice permits.',
  },
  {
    taskCode: 'MGR_REASSIGN_DUTIES',
    title: 'Reassign open duties and deadlines',
    description: 'Reassign open work to the replacement or temporary owner.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: -1,
    waiverAllowed: true,
    dependsOnCodes: ['MGR_HANDOVER_PLAN'],
  },
  {
    taskCode: 'MGR_HANDOVER_COMPLETE',
    title: 'Confirm knowledge-transfer completion',
    description: 'Attest that the handover record is complete and accurate.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    waiverAllowed: true,
    dependsOnCodes: ['MGR_HANDOVER_PLAN'],
    evidenceKind: 'LINKED_RECORD',
    evidenceNote: 'Completed handover record with manager attestation.',
  },
  {
    taskCode: 'HR_ASSET_RECOVERY',
    title: 'Complete asset recovery or final disposition',
    description:
      'Every required asset needs a documented final disposition. Asset status never affects pay.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    slaNote: 'Asset return target: by the final working day.',
  },
  {
    taskCode: 'HR_EMPLOYEE_ACK',
    title: 'Complete employee acknowledgement handling',
    description: 'Record the employee acknowledgement outcome on the action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'FINAL_WORKING_DAY',
    dueOffsetDays: 0,
    dependsOnCodes: ['HR_RESIGNATION_DOC'],
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR update status',
    description:
      'Record the manual HRIS/BambooHR update as completed, pending or not applicable. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HRM_FINAL_CLEARANCE',
    title: 'Perform final clearance review',
    description:
      'HR Manager reviews the clearance summary and approves final clearance (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
];

/** Directive 6.3: immediate resignation v2 (11 HR-validated obligations). */
const IMMEDIATE_TASKS_V2: SeedTask[] = [
  {
    taskCode: 'HR_URGENT_REVIEW',
    title: 'Urgent HR case review',
    description: 'Immediate review of the resignation-without-notice case.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    slaNote: 'Same business day.',
  },
  {
    taskCode: 'HR_CONFIRM_EFFECTIVE_TIME',
    title: 'Confirm exact effective separation time',
    description: 'Confirm the exact effective separation date and time.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
  },
  {
    taskCode: 'HR_ASSET_URGENT_REVIEW',
    title: 'Immediate asset-location and recovery review',
    description: 'Immediately establish where issued assets are and how they will be recovered.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 1,
  },
  {
    taskCode: 'HR_IMMEDIATE_ACK_DOC',
    title: 'Immediate-resignation acknowledgement document',
    description: 'Prepare and approve the immediate-resignation acknowledgement letter.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'CASE_RECEIVED',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HR_ACTION_FORM_HR',
    title: 'Complete HR action-form sections',
    description: 'Complete the HR checklist and acknowledgement handling on the action form.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    ...BENEFITS_CONFIRM_BASE,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'MGR_HANDOVER_RECORDS',
    title: 'Manager-recorded handover from available records',
    description: 'The manager reconstructs the handover from available organizational records.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
    waiverAllowed: true,
  },
  {
    taskCode: 'MGR_HANDOVER_COMPLETE',
    title: 'Handover completion, not applicable or waiver',
    description:
      'Complete the handover, mark it not applicable, or obtain an HR Manager waiver with a reason.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 5,
    dependsOnCodes: ['MGR_HANDOVER_RECORDS'],
    waiverAllowed: true,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    taskCode: 'HR_EMPLOYEE_ACK',
    title: 'Employee acknowledgement handling',
    description:
      'Record ACKNOWLEDGED, NOT_OBTAINED with reason, or NOT_APPLICABLE where authorized. Lack of employee participation never skips required work.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR manual update',
    description: 'Record the manual HRIS update status. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HRM_FINAL_CLEARANCE',
    title: 'Final clearance review',
    description: 'HR Manager clearance review (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
];

/** Directive 6.3: restricted termination v2 (9 obligations, all confidential). */
const TERMINATION_TASKS_V2: SeedTask[] = [
  {
    taskCode: 'HR_RESTRICTED_PREP',
    title: 'Restricted HR preparation',
    description: 'Restricted preparation by explicitly assigned HR participants only.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
  },
  {
    taskCode: 'HRM_AUTHORIZATION',
    title: 'Authorized HR Manager approval',
    description: 'HR Manager confirms authorization for the restricted process.',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    dependsOnCodes: ['HR_RESTRICTED_PREP'],
  },
  {
    taskCode: 'HR_CONFIRM_EFFECTIVE_TIME',
    title: 'Confirm exact effective separation date and time',
    description: 'Confirm the exact effective separation instant for the security notifications.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    priority: 'HIGH',
    confidential: true,
    dueBasis: 'WORKFLOW_ACTIVATION',
    dueOffsetDays: 0,
    dependsOnCodes: ['HRM_AUTHORIZATION'],
  },
  {
    taskCode: 'HR_RESTRICTED_ACTION_FORM',
    title: 'Restricted action-form processing',
    description: 'Process the action form under restricted-case rules.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
    evidenceKind: 'LINKED_RECORD',
  },
  {
    ...BENEFITS_CONFIRM_BASE,
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
  },
  {
    taskCode: 'HR_ASSET_RECOVERY',
    title: 'Asset recovery or disposition',
    description: 'Recover issued assets or record final dispositions. No payroll effect.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'MGR_HANDOVER_AUTHORIZED',
    title: 'Manager handover (only where authorized)',
    description:
      'Handover only where expressly authorized and applicable; released at the effective time.',
    department: 'LINE_MANAGER',
    requiredRole: 'LINE_MANAGER',
    confidential: true,
    required: false,
    waiverAllowed: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 3,
    releaseBasis: 'EFFECTIVE_SEPARATION',
    releaseOffsetHours: 0,
  },
  {
    taskCode: 'HR_HRIS_UPDATE',
    title: 'Record HRIS/BambooHR manual update',
    description: 'Record the manual HRIS update status. No live system is called.',
    department: 'HR',
    requiredRole: 'HR_OFFICER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 2,
  },
  {
    taskCode: 'HRM_RESTRICTED_CLEARANCE',
    title: 'Restricted final-clearance review',
    description:
      'Restricted clearance review by an authorized HR Manager participant (completed by the clearance approval itself).',
    department: 'HR',
    requiredRole: 'HR_MANAGER',
    confidential: true,
    dueBasis: 'EFFECTIVE_SEPARATION',
    dueOffsetDays: 5,
    required: false,
  },
];

/** Directive 6.3: the v2 redesign, stated on every v2 definition. */
const V2_REDESIGN_NOTE =
  'HR-validated workflow v2 (Directive 6.3): IT and Finance participate through automated ' +
  'controlled email notifications with no-login confirmation links; no manager approval of ' +
  'the Action Form.';

const WORKFLOWS_V2 = [
  {
    workflowType: 'RESIGNATION_WITH_NOTICE' as const,
    name: 'DEV Resignation with notice workflow',
    tasks: RESIGNATION_TASKS_V2,
  },
  {
    workflowType: 'IMMEDIATE_RESIGNATION' as const,
    name: 'DEV Immediate resignation workflow',
    tasks: IMMEDIATE_TASKS_V2,
  },
  {
    workflowType: 'TERMINATION' as const,
    name: 'DEV Restricted termination workflow',
    tasks: TERMINATION_TASKS_V2,
  },
];

const V3_REDESIGN_NOTE =
  'HR-validated workflow v3 (owner decision, 2026-08-19): the line manager has no login and ' +
  'no task in the platform. A single controlled email tells the manager who is leaving and ' +
  'what is expected of them; the platform records no handover.';

/** v3 = v2 minus everything the line manager used to be asked to do. */
const withoutManagerTasks = (tasks: SeedTask[]): SeedTask[] =>
  tasks.filter((task) => task.department !== 'LINE_MANAGER');

/**
 * The four separation types added by the 2026-08-26 canonical model need a
 * workflow of their own: without one, activation fails outright, and reusing
 * the resignation workflow is exactly the accidental inheritance the
 * directive forbids.
 *
 * They are built from the resignation spine - verify, confirm dates, action
 * form, assets, acknowledgement, HRIS, clearance - with the parts that only
 * belong to a resignation removed. Nothing new is invented: a retirement
 * letter, a redundancy notice and their approval steps are HR's own
 * documents and wording, which the platform must not author (CLAUDE.md rule
 * 4). Where HR approves such a template, its preparation task is added to
 * the relevant workflow as a normal versioned change.
 */
const RESIGNATION_ONLY_TASKS = ['HR_RESIGNATION_DOC'];

/** The common offboarding spine, with resignation-specific work removed. */
function commonSpine(retitle: Record<string, string> = {}): SeedTask[] {
  return withoutManagerTasks(RESIGNATION_TASKS_V2)
    .filter((task) => !RESIGNATION_ONLY_TASKS.includes(task.taskCode))
    .map((task) => {
      // A dependency on a task that no longer exists would never release.
      const dependsOnCodes = task.dependsOnCodes?.filter(
        (code) => !RESIGNATION_ONLY_TASKS.includes(code),
      );
      return {
        ...task,
        ...(dependsOnCodes ? { dependsOnCodes } : {}),
        ...(retitle[task.taskCode] ? { title: retitle[task.taskCode]! } : {}),
      };
    });
}

const WORKFLOWS_V3 = [
  {
    workflowType: 'RESIGNATION_WITH_NOTICE' as const,
    name: 'DEV Resignation with notice workflow',
    tasks: withoutManagerTasks(RESIGNATION_TASKS_V2),
  },
  {
    workflowType: 'IMMEDIATE_RESIGNATION' as const,
    name: 'DEV Immediate resignation workflow',
    tasks: withoutManagerTasks(IMMEDIATE_TASKS_V2),
  },
  {
    workflowType: 'TERMINATION' as const,
    name: 'DEV Restricted termination workflow',
    tasks: withoutManagerTasks(TERMINATION_TASKS_V2),
  },
  {
    workflowType: 'RETIREMENT' as const,
    name: 'DEV Retirement workflow',
    // Notified in advance like a resignation with notice, but nothing here
    // calls it a resignation.
    tasks: commonSpine({
      HR_VERIFY_CASE: 'Verify the retirement notification and case information',
      HR_CONFIRM_DATES: 'Confirm the retirement date and final working date',
    }),
  },
  {
    workflowType: 'CONTRACT_EXPIRY' as const,
    name: 'DEV End of contract workflow',
    // Nobody gave notice: the end date was agreed when the contract started,
    // so the first task is confirming it rather than verifying a resignation.
    tasks: commonSpine({
      HR_VERIFY_CASE: 'Verify the contract end date and case information',
      HR_CONFIRM_DATES: 'Confirm the contract end date and final working date',
    }),
  },
  {
    workflowType: 'REDUNDANCY' as const,
    name: 'DEV Redundancy workflow',
    // Employer-initiated and restricted by default, so it carries the same
    // authorization step the termination workflow uses.
    tasks: [
      ...commonSpine({
        HR_VERIFY_CASE: 'Verify the redundancy decision and case information',
        HR_CONFIRM_DATES: 'Confirm the effective date and final working date',
      }),
      {
        taskCode: 'HRM_AUTHORIZATION',
        title: 'Authorized HR Manager approval',
        description: 'HR Manager confirms authorization for the redundancy.',
        department: 'HR' as const,
        requiredRole: 'HR_MANAGER' as const,
        priority: 'HIGH' as const,
        confidential: true,
        dueBasis: 'WORKFLOW_ACTIVATION' as const,
        dueOffsetDays: 1,
      },
    ],
  },
  {
    workflowType: 'OTHER' as const,
    name: 'DEV Other separation workflow',
    // The neutral baseline. HR has already described what happened on the
    // case; the platform adds no work it cannot justify.
    tasks: commonSpine({
      HR_VERIFY_CASE: 'Verify the separation and case information',
      HR_CONFIRM_DATES: 'Confirm the effective date and final working date',
    }),
  },
];

/**
 * v4 (owner directive 2026-09-22, DEC-066): the HR Manager approves the CASE
 * once, on the Case Approval Summary. The "Authorized HR Manager approval"
 * task that the restricted termination and redundancy workflows carried was
 * the same authorization asked for a second time, so it is removed and the
 * work that waited on it now waits on the restricted preparation instead.
 * Every other task is unchanged. Instances already running stay pinned to
 * the version they started on.
 */
const V4_SINGLE_APPROVAL_NOTE =
  'Single authorization gate v4 (DEC-066): the HR Manager approval of the case is the only ' +
  'management approval; the duplicate "Authorized HR Manager approval" task is removed.';

const REDUNDANT_APPROVAL_TASKS = ['HRM_AUTHORIZATION'];

/** Remove the duplicate approval task and re-point anything that waited on it. */
function withoutRedundantApproval(tasks: SeedTask[]): SeedTask[] {
  const removed = tasks.filter((t) => REDUNDANT_APPROVAL_TASKS.includes(t.taskCode));
  return tasks
    .filter((t) => !REDUNDANT_APPROVAL_TASKS.includes(t.taskCode))
    .map((task) => {
      if (!task.dependsOnCodes?.some((c) => REDUNDANT_APPROVAL_TASKS.includes(c))) return task;
      // A task that waited on the removed approval now waits on whatever the
      // approval itself waited on (the restricted preparation), so the chain
      // keeps its order without the duplicate step.
      const inherited = removed.flatMap((r) => r.dependsOnCodes ?? []);
      const dependsOnCodes = [
        ...task.dependsOnCodes.filter((c) => !REDUNDANT_APPROVAL_TASKS.includes(c)),
        ...inherited.filter((c) => !task.dependsOnCodes!.includes(c)),
      ];
      return { ...task, ...(dependsOnCodes.length ? { dependsOnCodes } : {}) };
    })
    .map(({ dependsOnCodes, ...rest }) =>
      dependsOnCodes && dependsOnCodes.length ? { ...rest, dependsOnCodes } : rest,
    );
}

const WORKFLOWS_V4 = WORKFLOWS_V3.filter((wf) =>
  wf.tasks.some((t) => REDUNDANT_APPROVAL_TASKS.includes(t.taskCode)),
).map((wf) => ({ ...wf, tasks: withoutRedundantApproval(wf.tasks) }));

/** Section K: deterministic development notification templates. */
const NOTIFICATION_TEMPLATES = [
  {
    notificationType: 'IT_ACCESS_REMOVAL' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV IT access removal notice',
    subjectTemplate: 'Access Removal - [[EMPLOYEE_LEGAL_NAME]] ([[CASE_REFERENCE]])',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nGood afternoon, IT Team,\n\nKindly assist in removing all accesses from the below past employee:\n\n  - [[EMPLOYEE_LEGAL_NAME]] | [[JOB_TITLE]] | [[DEPARTMENT]]\n\nAccess ends [[EFFECTIVE_SEPARATION_DATE]] at [[EFFECTIVE_SEPARATION_TIME]].\nAccess categories on record: [[ACCESS_SYSTEMS_SUMMARY]]\n\nThank you.\n\nRegards,\n[[HR_SENDER_NAME]]\n[[HR_SENDER_TITLE]]\n\nCase reference: [[CASE_REFERENCE]]. Please confirm once the accesses are removed.`,
    minimumDataNote:
      'Name, job title, department, case reference, exact effective time and access categories only. No departure reason, no personal contact data.',
  },
  {
    notificationType: 'RESIGNATION_ACCEPTANCE_LETTER' as const,
    recipientClass: 'EMPLOYEE' as const,
    name: 'DEV Resignation acceptance letter cover',
    subjectTemplate: 'Acknowledgement of Resignation - [[EMPLOYEE_LEGAL_NAME]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}

Dear [[EMPLOYEE_FIRST_NAME]],

Please find attached the Company's acknowledgement and acceptance of your resignation.

Your last working day is recorded as [[CONFIRMED_LAST_WORKING_DATE]]. The attached letter sets out what is expected regarding the return of Company property.

If anything in the letter does not match your understanding, please contact Human Resources.

Regards,
[[HR_SENDER_NAME]]
[[HR_SENDER_TITLE]]
Human Resources, Bert's Auto Parts Ltd.

Case reference: [[CASE_REFERENCE]]`,
    minimumDataNote:
      'The employee, their last working date and the case reference only. The letter itself travels as the attached PDF; the covering email states no reason, no amount and no third-party data.',
  },
  {
    notificationType: 'RETURN_ITEMS_CHECKLIST' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV Exit checklist for return items',
    subjectTemplate:
      'Exit Checklist for Return Items - [[EMPLOYEE_LEGAL_NAME]] ([[CASE_REFERENCE]])',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nGood afternoon,\n\nKindly complete the exit checklist for return items for the below past employee:\n\n  - [[EMPLOYEE_LEGAL_NAME]] | [[JOB_TITLE]] | [[DEPARTMENT]]\n\nLast working date: [[CONFIRMED_LAST_WORKING_DATE]]\n\nThe secure link below opens this employee's checklist directly - no sign-in is required. Record each item as returned, not returned, not applicable, or lost / damaged, with a remark where an item is not returned.\n\n[[ACKNOWLEDGEMENT_LINK]]\n\nThank you.\n\nRegards,\n[[HR_SENDER_NAME]]\n[[HR_SENDER_TITLE]]\nCase reference: [[CASE_REFERENCE]]`,
    minimumDataNote:
      'Name, job title, department, last working date, case reference and the secure form link only. No departure reason, no personal contact data.',
  },
  {
    notificationType: 'FINANCE_OFFBOARDING' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV Finance offboarding notice',
    subjectTemplate: 'Offboarding notice: [[EMPLOYEE_LEGAL_NAME]] ([[CASE_REFERENCE]])',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nTo: Finance Department\n\n[[EMPLOYEE_LEGAL_NAME]] ([[DEPARTMENT]]) separates effective [[EFFECTIVE_SEPARATION_DATE]]; final working date [[CONFIRMED_LAST_WORKING_DATE]].\n\nPlease initiate the external final-pay workpaper outside the application. The offboarding system performs no pay calculation.\n\nCase reference: [[CASE_REFERENCE]].`,
    minimumDataNote:
      'Name, department, dates and case reference only. No reason, no pay figures, no personal contact data.',
  },
  {
    notificationType: 'LINE_MANAGER_HANDOVER' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV Line manager departure notice',
    subjectTemplate: 'Departure notice: [[EMPLOYEE_LEGAL_NAME]] ([[CASE_REFERENCE]])',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nTo: Line Manager\n\n[[EMPLOYEE_LEGAL_NAME]] ([[DEPARTMENT]]) is leaving the company. Their final working date is [[CONFIRMED_LAST_WORKING_DATE]] and their employment ends [[EFFECTIVE_SEPARATION_DATE]].\n\nWhat is expected of you before that date:\n  - reassign their open work and deadlines within your team;\n  - arrange any knowledge transfer your team needs;\n  - make sure company property they hold is returned to HR;\n  - tell HR about anything that affects the departure date.\n\nIT access removal, final pay and benefits are handled centrally - you do not need to raise them.\n\nReply to HR with any questions. Case reference: [[CASE_REFERENCE]].`,
    minimumDataNote:
      'Name, department, dates and case reference only. No reason for leaving and no HR-restricted content.',
  },
  {
    notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL' as const,
    recipientClass: 'EXTERNAL_PROVIDER' as const,
    name: 'DEV Sagicor group-health removal notice',
    subjectTemplate: 'Group Health Removal - [[EMPLOYEE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nGood afternoon,\n\nI trust you are well.\n\nKindly assist in Group Health removal for the below past employee:\n\n1. [[EMPLOYEE_LEGAL_NAME]] | Last workday is [[CONFIRMED_LAST_WORKING_DATE]]\n\nThank you.\n\nBest Regards,\n[[HR_SENDER_NAME]]`,
    minimumDataNote:
      'Name, employee reference and effective date ONLY. External providers never receive departure details (K.16).',
  },
  {
    notificationType: 'NCB_GROUP_LIFE_REMOVAL' as const,
    recipientClass: 'EXTERNAL_PROVIDER' as const,
    name: 'DEV NCB group-life removal notice',
    subjectTemplate: 'Group Life Removal - [[EMPLOYEE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nGood afternoon, NCB Team,\n\nI trust you are well.\n\nKindly assist in Group Life removal for the below past employee:\n\n1. [[EMPLOYEE_LEGAL_NAME]] | Last workday is [[CONFIRMED_LAST_WORKING_DATE]]\n\nThank you.\n\nBest Regards,\n[[HR_SENDER_NAME]]`,
    minimumDataNote:
      'Name, employee reference and effective date ONLY. External providers never receive departure details (K.16).',
  },
  {
    notificationType: 'SURVEY_INVITATION_REFERENCE' as const,
    recipientClass: 'EMPLOYEE' as const,
    name: 'DEV Survey invitation reference',
    subjectTemplate: 'Exit survey invitation - [[CASE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nDear [[EMPLOYEE_LEGAL_NAME]],\n\nYou are invited to complete a short, voluntary exit survey about your employment experience.\n\n[[SURVEY_EXPIRY_NOTE]]\n\nCase reference: [[CASE_REFERENCE]].`,
    minimumDataNote:
      'Name and case reference only; the survey link is generated separately and never stored in this record.',
  },
  // DEC-068: asks a named signer to open the form and sign it. The link
  // itself is never stored here - the marker is replaced at dispatch.
  {
    notificationType: 'SIGNATURE_REQUEST' as const,
    recipientClass: 'EMPLOYEE' as const,
    name: 'DEV Signature request',
    subjectTemplate: 'Please review and sign: [[DOCUMENT_TITLE]] - [[CASE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nDear [[EMPLOYEE_FIRST_NAME]],\n\nYour [[DOCUMENT_TITLE]] is ready for your review and signature. Please open the secure link below, read the details shown, and add your initials and signature.\n\n[[SIGNING_LINK]]\n\nThis link is valid until [[SIGNING_LINK_EXPIRY]]. If it expires before you have signed, contact Human Resources and we will send you a new one.\n\nCase reference: [[CASE_REFERENCE]].\n\n[[HR_SENDER_NAME]]\n[[HR_SENDER_TITLE]]`,
    minimumDataNote:
      'Name, document title, case reference and the signing link only. The link is resolved at dispatch and never stored in this record (DEC-068).',
  },
  {
    notificationType: 'MANUAL_EXCEPTION_NOTIFICATION' as const,
    recipientClass: 'EMPLOYEE' as const,
    name: 'DEV Manual exception notification',
    subjectTemplate: 'Notice regarding your offboarding - [[CASE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nDear [[EMPLOYEE_LEGAL_NAME]],\n\n[[MANUAL_NOTE]]\n\nCase reference: [[CASE_REFERENCE]].`,
    minimumDataNote:
      'Name, case reference and an HR-approved note only. HR Manager approval is required before ready-to-send.',
  },
  // Directive 6.3 K/N: configurable external purposes beyond Sagicor/NCB.
  // Neutral wording by rule - external providers never receive departure
  // details, and the validator rejects departure vocabulary outright.
  {
    notificationType: 'PAYROLL_OR_BANK_NOTIFICATION' as const,
    recipientClass: 'EXTERNAL_PROVIDER' as const,
    name: 'DEV Payroll/bank offboarding notice',
    subjectTemplate: 'Employee offboarding notification - [[EMPLOYEE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nTo: Payroll/bank contact on file\n\nPlease update your records for [[EMPLOYEE_LEGAL_NAME]] (employee reference [[EMPLOYEE_REFERENCE]]), whose employment with Bert's Auto Parts Ltd. ends effective [[EFFECTIVE_SEPARATION_DATE]].\n\nThis notice is prepared for controlled sending by authorized HR staff only.`,
    minimumDataNote:
      'Name, employee reference and effective date ONLY. External providers never receive departure details (K.16).',
  },
  {
    notificationType: 'OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION' as const,
    recipientClass: 'EXTERNAL_PROVIDER' as const,
    name: 'DEV Other approved provider notice',
    subjectTemplate: 'Employee offboarding notification - [[EMPLOYEE_REFERENCE]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nTo: Approved external provider on file\n\nPlease update your records for [[EMPLOYEE_LEGAL_NAME]] (employee reference [[EMPLOYEE_REFERENCE]]), whose employment with Bert's Auto Parts Ltd. ends effective [[EFFECTIVE_SEPARATION_DATE]].\n\nThis notice is prepared for controlled sending by authorized HR staff only.`,
    minimumDataNote:
      'Name, employee reference and effective date ONLY. External providers never receive departure details (K.16).',
  },
];

/**
 * Directive 6.3 (K/Q): version-2 department templates - DMAIC-structured
 * minimum data carried by the automated controlled email, confirmed through
 * the secure no-login acknowledgement link. Version 1 stays as frozen history.
 */
const NOTIFICATION_TEMPLATES_V2 = [
  {
    notificationType: 'IT_ACCESS_REMOVAL' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV IT access removal notice',
    subjectTemplate: 'Access Removal - [[EMPLOYEE_LEGAL_NAME]] ([[CASE_REFERENCE]])',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nGood afternoon, IT Team,\n\nKindly assist in removing all accesses from the below past employee:\n\n  - [[EMPLOYEE_LEGAL_NAME]] | [[JOB_TITLE]] | [[DEPARTMENT]]\n\nAccess should be removed effective [[EFFECTIVE_SEPARATION_TIME]].\nSystems and access on record: [[ACCESS_SYSTEMS_SUMMARY]]\n\nPlease confirm once this is done using the secure link below - no sign-in is required.\n\n[[ACKNOWLEDGEMENT_LINK]]\n\nThank you.\n\nRegards,\n[[HR_SENDER_NAME]]\n[[HR_SENDER_TITLE]]\nCase reference: [[CASE_REFERENCE]]`,
    minimumDataNote:
      'Name, job title, department, case reference, exact effective date and time, access categories and the secure confirmation link only. No departure reason, no survey or rehire information, no personal contact data.',
  },
  {
    notificationType: 'FINANCE_OFFBOARDING' as const,
    recipientClass: 'INTERNAL_DEPARTMENT' as const,
    name: 'DEV Finance offboarding notice',
    subjectTemplate:
      'Employee Offboarding Notification - Finance Action Required - [[EMPLOYEE_LEGAL_NAME]]',
    bodyTemplate: `${DEV_TEMPLATE_MARK}\n\nTo: Finance Department\n\nEmployee: [[EMPLOYEE_LEGAL_NAME]]\nEmployee reference: [[EMPLOYEE_REFERENCE]]\nCase reference: [[CASE_REFERENCE]]\nDepartment: [[DEPARTMENT]]\nConfirmed last working date: [[CONFIRMED_LAST_WORKING_DATE]]\nEffective separation date: [[EFFECTIVE_SEPARATION_DATE]]\n\nPlease complete the applicable offboarding and final-pay process under Finance procedures. This notice carries no amounts; the offboarding system performs no pay calculation.\n\nConfirm completion through the secure link below; no application sign-in is required.\n\n[[ACKNOWLEDGEMENT_LINK]]\n\nHuman Resources, Bert's Auto Parts Ltd. (synthetic development template)`,
    minimumDataNote:
      'Name, employee reference, case reference, department, dates and the secure confirmation link only. No departure reason, no pay figures, no personal contact data.',
  },
];

/** Section L: approved asset catalogue. */
const ASSET_CATALOGUE = [
  {
    assetType: 'EMPLOYEE_ID_CARD' as const,
    label: 'Employee identification card',
    issuingDepartment: 'Administration',
    trackIdentifier: true,
  },
  {
    assetType: 'ACCESS_CARD' as const,
    label: 'Access card / door pass',
    issuingDepartment: 'Administration',
    trackIdentifier: true,
  },
  {
    assetType: 'HEALTH_CARD' as const,
    label: 'Health card',
    issuingDepartment: 'Administration',
    trackIdentifier: false,
  },
  {
    assetType: 'LUNCH_CARD' as const,
    label: 'Lunch card',
    issuingDepartment: 'Administration',
    trackIdentifier: false,
  },
  {
    assetType: 'UNIFORM' as const,
    label: 'Uniform',
    issuingDepartment: 'Administration',
    trackIdentifier: false,
  },
  { assetType: 'LAPTOP' as const, label: 'Laptop', issuingDepartment: 'IT', trackIdentifier: true },
  {
    assetType: 'MOBILE_PHONE' as const,
    label: 'Mobile phone',
    issuingDepartment: 'IT',
    trackIdentifier: true,
  },
  {
    assetType: 'KEYS' as const,
    label: 'Keys',
    issuingDepartment: 'Administration',
    trackIdentifier: true,
  },
  {
    assetType: 'OTHER' as const,
    label: 'Other approved asset',
    issuingDepartment: 'Administration',
    trackIdentifier: false,
  },
];

/**
 * Catalogue entries retired by the owner (2026-09-22). Their rows are never
 * deleted - a rebuilt environment simply marks them inactive, and their
 * enum values stay in the database for historical recovery items.
 */
const RETIRED_ASSET_LABELS = ['Employee handbook', 'Company documents'] as const;

/** Synthetic employee-issued assets (all fictional, ties to EMP-TEST-*). */
const ISSUED_ASSETS: ReadonlyArray<{
  employeeSourceId: string;
  assetType: (typeof ASSET_CATALOGUE)[number]['assetType'];
  label: string;
  identifier?: string;
  serialNumber?: string;
  issuingDepartment: string;
}> = [
  {
    employeeSourceId: 'EMP-TEST-001',
    assetType: 'EMPLOYEE_ID_CARD',
    label: 'Employee identification card',
    identifier: 'ID-TEST-0101',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-001',
    assetType: 'ACCESS_CARD',
    label: 'Access card / door pass',
    identifier: 'AC-TEST-0102',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-001',
    assetType: 'LAPTOP',
    label: 'Laptop',
    identifier: 'LT-TEST-0103',
    serialNumber: 'SN-TEST-A1B2C3',
    issuingDepartment: 'IT',
  },
  {
    employeeSourceId: 'EMP-TEST-002',
    assetType: 'EMPLOYEE_ID_CARD',
    label: 'Employee identification card',
    identifier: 'ID-TEST-0201',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-002',
    assetType: 'ACCESS_CARD',
    label: 'Access card / door pass',
    identifier: 'AC-TEST-0202',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-002',
    assetType: 'KEYS',
    label: 'Warehouse keys',
    identifier: 'KY-TEST-0203',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-003',
    assetType: 'EMPLOYEE_ID_CARD',
    label: 'Employee identification card',
    identifier: 'ID-TEST-0301',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-003',
    assetType: 'LUNCH_CARD',
    label: 'Lunch card',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-004',
    assetType: 'EMPLOYEE_ID_CARD',
    label: 'Employee identification card',
    identifier: 'ID-TEST-0401',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-004',
    assetType: 'UNIFORM',
    label: 'Uniform (2 sets)',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-005',
    assetType: 'EMPLOYEE_ID_CARD',
    label: 'Employee identification card',
    identifier: 'ID-TEST-0501',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-005',
    assetType: 'ACCESS_CARD',
    label: 'Access card / door pass',
    identifier: 'AC-TEST-0502',
    issuingDepartment: 'Administration',
  },
  {
    employeeSourceId: 'EMP-TEST-005',
    assetType: 'LAPTOP',
    label: 'Laptop',
    identifier: 'LT-TEST-0503',
    serialNumber: 'SN-TEST-D4E5F6',
    issuingDepartment: 'IT',
  },
  {
    employeeSourceId: 'EMP-TEST-005',
    assetType: 'MOBILE_PHONE',
    label: 'Mobile phone',
    identifier: 'MP-TEST-0504',
    serialNumber: 'SN-TEST-G7H8I9',
    issuingDepartment: 'IT',
  },
];

/** Map seed tasks to task-definition create inputs (shared by v1 and v2). */
function taskDefCreateInputs(tasks: SeedTask[]) {
  return tasks.map((t, i) => ({
    taskCode: t.taskCode,
    sortOrder: (i + 1) * 10,
    enabled: true,
    title: t.title,
    description: t.description,
    department: t.department,
    requiredRole: t.requiredRole,
    taskKind: t.taskKind ?? ('STANDARD' as const),
    priority: t.priority ?? ('NORMAL' as const),
    confidential: t.confidential ?? false,
    required: t.required ?? true,
    waiverAllowed: t.waiverAllowed ?? false,
    waiverAuthority: 'HR_MANAGER' as const,
    dueBasis: t.dueBasis,
    dueOffsetDays: t.dueOffsetDays ?? 0,
    dueOffsetKind: t.dueOffsetKind ?? ('BUSINESS_DAYS' as const),
    releaseBasis: t.releaseBasis ?? ('IMMEDIATE' as const),
    releaseOffsetHours: t.releaseOffsetHours ?? 0,
    pausesOnHold: t.pausesOnHold ?? true,
    blockPausesSla: t.blockPausesSla ?? false,
    dependsOnCodes: t.dependsOnCodes ?? [],
    evidenceKind: t.evidenceKind ?? ('NOTE' as const),
    evidenceNote: t.evidenceNote ?? null,
    slaNote: t.slaNote ?? null,
    escalationNote: t.escalationNote ?? null,
  }));
}

export async function seedStage3(db: Db): Promise<void> {
  const hrManager = await db.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-manager' },
  });

  // Stage 3 automation flag - enabled by default like the other automation
  // flags (final-product operating mode, owner request 2026-08-17); a re-run
  // never overrides a later audited operator choice.
  await db.featureFlag.upsert({
    where: { key: 'automation.workflowEngine' },
    create: {
      key: 'automation.workflowEngine',
      description:
        'Stage 3: workflow instantiation for OPERATIONAL records (TRAINING/TEST always permitted).',
      enabled: true,
    },
    update: {}, // never silently flip a choice
  });

  // Development workflow definitions (B.7/B.8): create v1 as DRAFT with its
  // tasks, then activate - the freeze trigger permits lifecycle changes only.
  for (const wf of WORKFLOWS) {
    const existing = await db.workflowDefinition.findFirst({
      where: { workflowType: wf.workflowType, version: 1 },
    });
    if (existing) continue;
    const tasks = taskDefCreateInputs(wf.tasks);
    const checksum = workflowConfigChecksum({
      workflowType: wf.workflowType,
      name: wf.name,
      version: 1,
      description: '',
      activationConditions: '',
      tasks: tasks.map((t) => ({ ...t })),
    });
    const def = await db.workflowDefinition.create({
      data: {
        workflowType: wf.workflowType,
        name: wf.name,
        version: 1,
        status: 'DRAFT',
        description: `${DEV_WORKFLOW_MARK}. Synthetic development configuration for ${wf.workflowType}.`,
        activationConditions:
          'Case APPROVED with an exact effective separation time; TRAINING/TEST records always; OPERATIONAL records only with the automation.workflowEngine flag.',
        changeReason: 'Synthetic development seed (Stage 3).',
        configChecksum: checksum,
        createdById: hrManager.id,
        taskDefs: { create: tasks },
      },
    });
    await db.workflowDefinition.update({
      where: { id: def.id },
      data: { status: 'ACTIVE', activatedById: hrManager.id, activatedAt: new Date() },
    });
  }

  // Directive 6.3: HR-validated v2 definitions. Create v2 as DRAFT with its
  // tasks, mark the ACTIVE v1 SUPERSEDED (a lifecycle-only update - the
  // freeze trigger keeps the content immutable), then activate v2 so at most
  // one version per type is ACTIVE (B.5). Skipped once version 2 exists.
  for (const wf of WORKFLOWS_V2) {
    const existing = await db.workflowDefinition.findFirst({
      where: { workflowType: wf.workflowType, version: 2 },
    });
    if (existing) continue;
    const tasks = taskDefCreateInputs(wf.tasks);
    const checksum = workflowConfigChecksum({
      workflowType: wf.workflowType,
      name: wf.name,
      version: 2,
      description: '',
      activationConditions: '',
      tasks: tasks.map((t) => ({ ...t })),
    });
    const def = await db.workflowDefinition.create({
      data: {
        workflowType: wf.workflowType,
        name: wf.name,
        version: 2,
        status: 'DRAFT',
        description: `${DEV_WORKFLOW_MARK}. ${V2_REDESIGN_NOTE}`,
        activationConditions:
          'Case APPROVED with an exact effective separation time; TRAINING/TEST records always; ' +
          `OPERATIONAL records only with the automation.workflowEngine flag. ${V2_REDESIGN_NOTE}`,
        changeReason: 'Directive 6.3: HR-validated workflow simplification.',
        configChecksum: checksum,
        createdById: hrManager.id,
        taskDefs: { create: tasks },
      },
    });
    await db.workflowDefinition.updateMany({
      where: { workflowType: wf.workflowType, version: 1, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await db.workflowDefinition.update({
      where: { id: def.id },
      data: { status: 'ACTIVE', activatedById: hrManager.id, activatedAt: new Date() },
    });
  }

  // Owner decision 2026-08-19: v3 removes the line-manager tasks. Same
  // non-destructive lifecycle as v2 - create the new version, supersede the
  // previous ACTIVE one, then activate. Instances already running stay pinned
  // to the version they started on, so live cases keep their own history.
  for (const wf of WORKFLOWS_V3) {
    const existing = await db.workflowDefinition.findFirst({
      where: { workflowType: wf.workflowType, version: 3 },
    });
    if (existing) continue;
    const tasks = taskDefCreateInputs(wf.tasks);
    const checksum = workflowConfigChecksum({
      workflowType: wf.workflowType,
      name: wf.name,
      version: 3,
      description: '',
      activationConditions: '',
      tasks: tasks.map((t) => ({ ...t })),
    });
    const def = await db.workflowDefinition.create({
      data: {
        workflowType: wf.workflowType,
        name: wf.name,
        version: 3,
        status: 'DRAFT',
        description: `${DEV_WORKFLOW_MARK}. ${V3_REDESIGN_NOTE}`,
        activationConditions:
          'Case APPROVED with an exact effective separation time; TRAINING/TEST records always; ' +
          `OPERATIONAL records only with the automation.workflowEngine flag. ${V3_REDESIGN_NOTE}`,
        changeReason: 'Owner decision: the line manager is notified by email and holds no tasks.',
        configChecksum: checksum,
        createdById: hrManager.id,
        taskDefs: { create: tasks },
      },
    });
    await db.workflowDefinition.updateMany({
      where: { workflowType: wf.workflowType, version: 2, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await db.workflowDefinition.update({
      where: { id: def.id },
      data: { status: 'ACTIVE', activatedById: hrManager.id, activatedAt: new Date() },
    });
  }

  // DEC-066 (owner directive 2026-09-22): v4 for the workflows that carried
  // the duplicate "Authorized HR Manager approval" task. Same non-destructive
  // lifecycle: create v4, supersede the ACTIVE v3, activate v4. Running
  // instances stay pinned to their own version.
  for (const wf of WORKFLOWS_V4) {
    const existing = await db.workflowDefinition.findFirst({
      where: { workflowType: wf.workflowType, version: 4 },
    });
    if (existing) continue;
    const tasks = taskDefCreateInputs(wf.tasks);
    const checksum = workflowConfigChecksum({
      workflowType: wf.workflowType,
      name: wf.name,
      version: 4,
      description: '',
      activationConditions: '',
      tasks: tasks.map((t) => ({ ...t })),
    });
    const def = await db.workflowDefinition.create({
      data: {
        workflowType: wf.workflowType,
        name: wf.name,
        version: 4,
        status: 'DRAFT',
        description: `${DEV_WORKFLOW_MARK}. ${V4_SINGLE_APPROVAL_NOTE}`,
        activationConditions:
          'Case APPROVED with an exact effective separation time; TRAINING/TEST records always; ' +
          `OPERATIONAL records only with the automation.workflowEngine flag. ${V4_SINGLE_APPROVAL_NOTE}`,
        changeReason:
          'Owner directive 2026-09-22 (DEC-066): one HR Manager approval of the case; the duplicate authorization task is removed.',
        configChecksum: checksum,
        createdById: hrManager.id,
        taskDefs: { create: tasks },
      },
    });
    await db.workflowDefinition.updateMany({
      where: { workflowType: wf.workflowType, version: 3, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await db.workflowDefinition.update({
      where: { id: def.id },
      data: { status: 'ACTIVE', activatedById: hrManager.id, activatedAt: new Date() },
    });
  }

  // Notification templates (K): v1 ACTIVE, deterministic, minimum-data.
  for (const t of NOTIFICATION_TEMPLATES) {
    const existing = await db.notificationTemplate.findFirst({
      where: { notificationType: t.notificationType, version: 1 },
    });
    if (existing) continue;
    const allowed = NOTIFICATION_PLACEHOLDERS[t.notificationType];
    await db.notificationTemplate.create({
      data: {
        notificationType: t.notificationType,
        version: 1,
        status: 'ACTIVE',
        recipientClass: t.recipientClass,
        name: t.name,
        subjectTemplate: t.subjectTemplate,
        bodyTemplate: t.bodyTemplate,
        allowedPlaceholders: [...allowed],
        minimumDataNote: t.minimumDataNote,
        contentChecksum: createHash('sha256')
          .update(`${t.subjectTemplate}\n${t.bodyTemplate}`, 'utf8')
          .digest('hex'),
        changeReason: 'Synthetic development seed (Stage 3).',
        createdById: hrManager.id,
        activatedById: hrManager.id,
        activatedAt: new Date(),
      },
    });
  }

  // Directive 6.3 (K/Q): v2 department templates activate atomically - the
  // prior ACTIVE version is marked SUPERSEDED first (frozen history, never
  // edited or deleted). Skipped once version 2 exists.
  for (const t of NOTIFICATION_TEMPLATES_V2) {
    const existing = await db.notificationTemplate.findFirst({
      where: { notificationType: t.notificationType, version: 2 },
    });
    if (existing) continue;
    await db.notificationTemplate.updateMany({
      where: { notificationType: t.notificationType, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    const allowed = NOTIFICATION_PLACEHOLDERS[t.notificationType];
    await db.notificationTemplate.create({
      data: {
        notificationType: t.notificationType,
        version: 2,
        status: 'ACTIVE',
        recipientClass: t.recipientClass,
        name: t.name,
        subjectTemplate: t.subjectTemplate,
        bodyTemplate: t.bodyTemplate,
        allowedPlaceholders: [...allowed],
        minimumDataNote: t.minimumDataNote,
        contentChecksum: createHash('sha256')
          .update(`${t.subjectTemplate}\n${t.bodyTemplate}`, 'utf8')
          .digest('hex'),
        changeReason:
          'Directive 6.3: DMAIC-structured controlled email with no-login acknowledgement link.',
        createdById: hrManager.id,
        activatedById: hrManager.id,
        activatedAt: new Date(),
      },
    });
  }

  // Asset catalogue + synthetic issued assets (L).
  for (const item of ASSET_CATALOGUE) {
    await db.assetCatalogueItem.upsert({
      where: { label: item.label },
      create: item,
      update: { active: true },
    });
  }
  await db.assetCatalogueItem.updateMany({
    where: { label: { in: [...RETIRED_ASSET_LABELS] } },
    data: { active: false },
  });
  for (const a of ISSUED_ASSETS) {
    const existing = await db.issuedAsset.findFirst({
      where: { employeeSourceId: a.employeeSourceId, catalogueLabel: a.label },
    });
    if (!existing) {
      await db.issuedAsset.create({
        data: {
          employeeSourceSystem: 'SYNTHETIC',
          employeeSourceId: a.employeeSourceId,
          assetType: a.assetType,
          catalogueLabel: a.label,
          identifier: a.identifier ?? null,
          serialNumber: a.serialNumber ?? null,
          issuingDepartment: a.issuingDepartment,
          issuedAt: new Date('2025-01-15T14:00:00Z'),
          currentHolderNote: 'Issued to the employee (synthetic seed).',
        },
      });
    }
  }
}
