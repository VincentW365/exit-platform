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
import Link from 'next/link';
import { formatDateOnly, formatInstant } from '@exit/domain';
import type { CaseNextAction, CaseStatus } from '@exit/domain';
import type { ProgressStage } from '@exit/db';
import { humanize } from '@/lib/text';
import { Chip, initialsOf, ProgressBar } from './patterns';
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

export function CaseHeader({ data }: { data: CaseHeaderData }) {
  const action = data.nextAction ?? null;
  const stages = data.stages ?? [];
  const progress = completion(stages);
  const lastDay = data.confirmedLastDay ?? null;

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
            <p className="case-head__role">
              {data.jobTitle ? `${data.jobTitle} · ` : ''}
              {data.department}
              {data.location ? ` · ${data.location}` : ''}
            </p>
            <div className="case-head__chips">
              <Chip>{humanize(data.departureType)}</Chip>
              {lastDay ? <Chip>Last day {formatDateOnly(lastDay)}</Chip> : null}
              <StatusBadge status={data.status} />
              <ClassificationBadge classification={data.classification} />
              <PurposeBadge purpose={data.recordPurpose} cohort={data.measurementCohort} />
            </div>
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
        <div className="case-head__fact">
          <span className="label">Employment ends</span>
          <span className="value">
            {data.effectiveSeparationAt ? formatInstant(data.effectiveSeparationAt) : 'Not set'}
          </span>
        </div>
        <div className="case-head__fact">
          <span className="label">HR owner</span>
          <span className="value">{data.officerName ?? data.ownerName}</span>
        </div>
        <div className="case-head__fact">
          <span className="label">Manager</span>
          <span className="value">{data.managerUserName ?? data.managerName ?? 'Not derived'}</span>
        </div>
      </div>
    </header>
  );
}
