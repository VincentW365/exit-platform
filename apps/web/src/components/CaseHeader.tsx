/**
 * Business case header (Directive 6.1 AB): the case at a glance - employee,
 * routing, status, key dates and the primary next action - without opening
 * multiple sections. Server component; data comes from the case page.
 */
import Link from 'next/link';
import { formatInstant } from '@exit/domain';
import { ClassificationBadge, PurposeBadge, StatusBadge } from './ui';
import type { CaseStatus } from '@exit/domain';

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
}

function nextAction(d: CaseHeaderData): { label: string; href: string } | null {
  switch (d.status) {
    case 'DRAFT':
      return { label: 'Complete the draft and submit for HR review', href: `/cases/${d.caseId}` };
    case 'PENDING_HR_REVIEW':
      return { label: 'HR Manager review and approval', href: `/cases/${d.caseId}` };
    case 'APPROVED':
      return {
        label: 'Review the assignment plan, then activate the workflow',
        href: `/cases/${d.caseId}/assignment`,
      };
    case 'ACTIVE':
      return { label: 'Work the open tasks', href: `/cases/${d.caseId}/workflow` };
    case 'CLEARANCE_REVIEW':
      return { label: 'Final clearance review', href: `/cases/${d.caseId}/clearance` };
    default:
      return null;
  }
}

export function CaseHeader({ data }: { data: CaseHeaderData }) {
  const action = nextAction(data);
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
            <dd>
              <Link href={action.href}>{action.label}</Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
