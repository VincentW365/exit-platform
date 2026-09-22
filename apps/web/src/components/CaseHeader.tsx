/**
 * The case header.
 *
 * A case is a person leaving, so the header opens with the person - not with
 * a reference number. In one glance it answers: who is going, what they did
 * here, what kind of departure this is, when their last day falls, how far
 * the case has run, who owns it, and what to do next.
 *
 * Server component; every value comes from the case page.
 */
import type { SeparationSummary } from '@exit/db';
import Link from 'next/link';
import { formatDateOnly } from '@exit/domain';
import type { CaseNextAction, CaseStatus } from '@exit/domain';
import type { ProgressStage } from '@exit/db';
import { humanize } from '@/lib/text';
import { Chip, initialsOf, ProgressBar, type Tone } from './patterns';
import { ClassificationBadge, PurposeBadge, StatusBadge } from './ui';

export interface CaseHeaderData {
  caseId: string;
  caseNumber: string;
  status: CaseStatus;
  classification: string;
  recordPurpose: string;
  measurementCohort: string | null;
  employeeDisplayName: string;
  jobTitle: string | null;
  department: string;
  location: string;
  departureType: string;
  effectiveSeparationAt: Date | null;
  confirmedLastDay?: Date | null;
  /**
   * The derived separation summary (owner directive, 2026-08-26, section 28).
   * Server-derived so the header cannot disagree with the workflow about how
   * urgent a departure is - it reads the answer, it does not compute one.
   */
  separation?: SeparationSummary | null;
  ownerName: string;
  officerName: string | null;
  managerName: string | null;
  managerUserName: string | null;
  /** Work-aware next action (Directive 6.2 U) - from caseProgressSummary. */
  nextAction?: CaseNextAction | null;
  /** Stage list, used only to state how far the case has run. */
  stages?: readonly ProgressStage[];
}

/**
 * Completion counts only the stages that apply to this case: a case with no
 * benefits to cancel is not permanently stuck below 100%.
 */
function completion(stages: readonly ProgressStage[]): {
  percent: number;
  done: number;
  of: number;
} {
  const applicable = stages.filter((s) => s.state !== 'NOT_APPLICABLE');
  const done = applicable.filter((s) => s.state === 'COMPLETED').length;
  const of = applicable.length;
  return { percent: of === 0 ? 0 : Math.round((done / of) * 100), done, of };
}

/**
 * Section 28: how the departure reads at a glance. Urgency comes from the
 * server's derived summary, never from re-reading the dates here - two
 * places deciding this independently is how a screen ends up disagreeing
 * with the workflow it is describing.
 */
function urgencyFor(sep: SeparationSummary | null): { label: string; tone: Tone } | null {
  if (!sep) return null;
  const days = sep.daysUntilDeparture;
  switch (sep.urgency) {
    case 'IMMEDIATE':
      return {
        label: sep.initiator === 'EMPLOYER' ? 'High priority' : 'Immediate action required',
        tone: 'critical',
      };
    case 'HISTORICAL':
      return days === null
        ? null
        : {
            label: `Departed ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
            tone: 'attention',
          };
    case 'SCHEDULED':
    case 'PLANNED':
      return days === null
        ? null
        : {
            label: `${days} day${days === 1 ? '' : 's'} remaining`,
            tone: days <= 7 ? 'attention' : 'info',
          };
  }
}

export function CaseHeader({ data }: { data: CaseHeaderData }) {
  const action = data.nextAction ?? null;
  const stages = data.stages ?? [];
  const progress = completion(stages);
  const lastDay = data.confirmedLastDay ?? null;
  const sep = data.separation ?? null;
  const urgencyChip = urgencyFor(sep);

  return (
    <header className="case-head" aria-label="Case summary">
      <div className="case-head__top">
        <div className="identity">
          <span className="identity__avatar identity__avatar--lg" aria-hidden>
            {initialsOf(data.employeeDisplayName)}
          </span>
          <div className="identity__body">
            {/* The case reference belongs to the heading, not beside it: the
                person is what you read, but the reference is how the case is
                identified in every other system and conversation. */}
            <h1 className="case-head__name">
              <span className="eyebrow" style={{ color: 'var(--on-brand-dim)' }}>
                {data.caseNumber}
              </span>
              <span className="sr-only"> - </span>
              {data.employeeDisplayName}
            </h1>
            {/* Position and department identify the person; the full
                employee record (location, manager, provenance) sits in its
                own card below, so it is not repeated here. */}
            <p className="case-head__role">
              {data.jobTitle ? `${data.jobTitle} · ` : ''}
              {data.department}
            </p>
            <div className="case-head__chips">
              <Chip>{sep?.label ?? humanize(data.departureType)}</Chip>
              {/* Section 28: the presentation reinforces the business logic.
                  An immediate departure says so where it cannot be missed;
                  a planned one says how long there is to work with. */}
              {urgencyChip ? <Chip tone={urgencyChip.tone}>{urgencyChip.label}</Chip> : null}
              {sep?.backdated ? <Chip tone="neutral">Historical record</Chip> : null}
              <StatusBadge status={data.status} />
              <ClassificationBadge classification={data.classification} />
              <PurposeBadge purpose={data.recordPurpose} cohort={data.measurementCohort} />
            </div>
            {data.status === 'DRAFT' ? (
              <p className="case-head__note">
                Draft: this case has been created but has not yet entered the active offboarding
                workflow.
              </p>
            ) : null}
          </div>
        </div>

        {action ? (
          <div>
            <span className="label" style={{ color: 'var(--on-brand-dim)' }}>
              Next action
            </span>
            <p style={{ margin: 'var(--space-1) 0 0' }}>
              <Link
                href={action.href}
                className="button button--primary"
                style={{ textDecoration: 'none' }}
              >
                {action.label}
              </Link>
            </p>
          </div>
        ) : null}
      </div>

      <div className="case-head__facts">
        {stages.length > 0 ? (
          <div className="case-head__progress">
            <span className="label" style={{ color: 'var(--on-brand-dim)' }}>
              Case completion
            </span>
            <p className="value numeric" style={{ color: 'var(--on-brand)', margin: 0 }}>
              {progress.percent}% · {progress.done} of {progress.of} stages
            </p>
            <ProgressBar percent={progress.percent} label="Case completion" />
          </div>
        ) : null}
        {/* One date at the anchor - the last working day - and the exact
            instant it resolves to lives in Exit details. The reporting
            manager belongs to the employee record. */}
        <div className="case-head__fact">
          <span className="label">Employment ends</span>
          <span className="value">
            {lastDay
              ? formatDateOnly(lastDay)
              : data.effectiveSeparationAt
                ? formatDateOnly(data.effectiveSeparationAt)
                : 'Not recorded'}
          </span>
        </div>
        <div className="case-head__fact">
          <span className="label">HR owner</span>
          <span className="value">{data.officerName ?? data.ownerName}</span>
        </div>
      </div>
    </header>
  );
}
