/**
 * Business case header (Directive 6.1 AB): the case at a glance - employee,
 * routing, status, key dates and the primary next action - without opening
 * multiple sections. Server component; data comes from the case page.
 */
import Link from 'next/link';
import { formatInstant } from '@exit/domain';
import { ClassificationBadge, PurposeBadge, StatusBadge } from './ui';
import type { CaseNextAction, CaseStatus } from '@exit/domain';

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
  ownerName: string;
  officerName: string | null;
  managerName: string | null;
  managerUserName: string | null;
  /** Work-aware next action (Directive 6.2 U) - from caseProgressSummary. */
  nextAction?: CaseNextAction | null;
}

export function CaseHeader({ data }: { data: CaseHeaderData }) {
  const action = data.nextAction ?? null;
  return (
    <header className="case-header panel" aria-label="Case summary header">
      <div className="case-header__main">
        <h1 style={{ margin: 0 }}>
          <span className="case-header__number">{data.caseNumber}</span> -{' '}
          {data.employeeDisplayName}
        </h1>
        <p className="case-header__meta">
          {data.departureType.replaceAll('_', ' ').toLowerCase()}
          {data.jobTitle ? ` - ${data.jobTitle}` : ''} - {data.department} / {data.location}
        </p>
        <p className="case-header__badges">
          <StatusBadge status={data.status} />{' '}
          <ClassificationBadge classification={data.classification} />{' '}
          <PurposeBadge purpose={data.recordPurpose} cohort={data.measurementCohort} />
        </p>
      </div>
      <dl className="case-header__facts">
        <div>
          <dt>Effective separation</dt>
          <dd>
            {data.effectiveSeparationAt ? formatInstant(data.effectiveSeparationAt) : 'not set'}
          </dd>
        </div>
        <div>
          <dt>Accountable / operational HR</dt>
          <dd>
            {data.ownerName}
            {data.officerName ? ` / ${data.officerName}` : ' / unassigned'}
          </dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{data.managerUserName ?? data.managerName ?? 'not derived'}</dd>
        </div>
        {action ? (
          <div>
            <dt>Next action</dt>
            <dd
              className={action.tone === 'attention' ? 'case-header__next--attention' : undefined}
            >
              <Link href={action.href}>{action.label}</Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
