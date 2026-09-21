import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getDirectoryProfile } from '@exit/db';
import { can, formatDateOnly, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { EmptyState } from '@/components/EmptyState';
import { CasesIcon, DirectoryIcon, FlowIcon, MailIcon, UserIcon } from '@/components/icons';
import {
  Avatar,
  Chip,
  Fact,
  Facts,
  Identity,
  Row,
  Rows,
  SectionHead,
  type Tone,
} from '@/components/patterns';
import { StatusBadge } from '@/components/ui';
import { humanize } from '@/lib/text';
import type { CaseStatus } from '@exit/domain';

export const metadata: Metadata = { title: 'Employee Profile' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, Tone> = {
  Active: 'done',
  Inactive: 'neutral',
  Terminated: 'attention',
  Archived: 'neutral',
};

/**
 * One employee's directory profile (owner directive, 2026-09-15, section 5):
 * employment, reporting line, work contact and offboarding - all from the
 * local mirror. Every BambooHR-owned field is read-only here by construction;
 * the platform never writes employee data back.
 */
export default async function DirectoryProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  if (!can(actor, 'employeeSource.search'))
    return (
      <>
        <h1 className="page-title">Access Restricted</h1>
        <p className="panel">The employee directory is limited to authorized HR roles.</p>
      </>
    );
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let profile: Awaited<ReturnType<typeof getDirectoryProfile>>;
  try {
    profile = await getDirectoryProfile(actor, id);
  } catch (e) {
    if (e instanceof ServiceError) profile = null;
    else throw e;
  }
  if (!profile) notFound();
  const r = profile.record;
  const startHref = `/cases/new?q=${encodeURIComponent(r.displayName)}&employee=${encodeURIComponent(r.sourceId)}`;
  const live = profile.cases.live;

  return (
    <>
      <p className="crumbs">
        <Link href="/directory">Employee Directory</Link>
      </p>
      <div className="case-head">
        <div className="case-head__top">
          <Identity
            large
            name={r.displayName}
            role={[r.jobTitle, r.department].filter(Boolean).join(' · ') || null}
          />
          <div className="case-head__chips">
            <Chip tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Chip>
            {r.employeeNumber ? <Chip>Employee #{r.employeeNumber}</Chip> : null}
            {r.location ? <Chip>{r.location}</Chip> : null}
          </div>
        </div>
      </div>

      <DirectoryFreshnessNote
        freshness={profile.freshness}
        lastSuccessfulAt={profile.lastSuccessfulAt}
        admin={can(actor, 'admin.system')}
      />

      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="emp-h">
            <SectionHead
              id="emp-h"
              icon={<UserIcon />}
              tone="info"
              title="Employment"
              description="From BambooHR. Read-only: corrections are made in BambooHR and arrive here with the next synchronization."
            />
            <Facts>
              <Fact label="Employee #">{r.employeeNumber ?? 'Not recorded'}</Fact>
              <Fact label="Job title">{r.jobTitle ?? '-'}</Fact>
              <Fact label="Department">{r.department ?? '-'}</Fact>
              {r.division ? <Fact label="Division">{r.division}</Fact> : null}
              <Fact label="Location">{r.location ?? '-'}</Fact>
              <Fact label="Employment status">{r.employmentStatus ?? r.status}</Fact>
              <Fact label="Hire date">
                {r.hireDate ? formatDateOnly(r.hireDate) : 'Not recorded'}
              </Fact>
              {r.contractEndDate ? (
                <Fact label="Contract ends" isKey>
                  {formatDateOnly(r.contractEndDate)}
                </Fact>
              ) : null}
              {r.preferredName ? <Fact label="Preferred name">{r.preferredName}</Fact> : null}
            </Facts>
          </section>

          <section className="panel" aria-labelledby="rep-h">
            <SectionHead
              id="rep-h"
              icon={<DirectoryIcon />}
              tone="info"
              title="Reporting Structure"
              description="Manager and direct reports, linked by BambooHR identifier."
            />
            {profile.manager ? (
              <Rows label="Manager">
                <Row
                  mark={<Avatar name={profile.manager.displayName} />}
                  title={
                    <Link href={`/directory/${profile.manager.id}`}>
                      {profile.manager.displayName}
                    </Link>
                  }
                  sub={
                    [profile.manager.jobTitle, profile.manager.department]
                      .filter(Boolean)
                      .join(' · ') || 'Manager'
                  }
                  facts={<Chip>Manager</Chip>}
                />
              </Rows>
            ) : (
              <p className="hint" data-manager="none">
                {r.managerName
                  ? `Manager recorded as "${r.managerName}", who is not (yet) a directory record. HR assigns an alternate at intake if needed.`
                  : 'No manager recorded in BambooHR. HR assigns an alternate at intake.'}
              </p>
            )}
            {profile.reportsTotal > 0 ? (
              <>
                <h3 style={{ fontSize: 'var(--text-base)' }}>
                  Direct reports ({profile.reportsTotal})
                </h3>
                <Rows label="Direct reports">
                  {profile.reports.map((p) => (
                    <Row
                      key={p.id}
                      mark={<Avatar name={p.displayName} />}
                      title={<Link href={`/directory/${p.id}`}>{p.displayName}</Link>}
                      sub={[p.jobTitle, p.department].filter(Boolean).join(' · ') || '-'}
                      facts={<Chip tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Chip>}
                      muted={!p.active}
                    />
                  ))}
                </Rows>
                {profile.reportsTotal > profile.reports.length ? (
                  <p className="hint">
                    <Link href={`/directory?manager=${r.id}&status=all`}>
                      See all {profile.reportsTotal} direct reports
                    </Link>
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="contact-h">
            <SectionHead
              id="contact-h"
              icon={<MailIcon />}
              tone="info"
              title="Work Contact"
              description="Work channels only. Personal contact details are never mirrored."
            />
            <Facts>
              <Fact label="Work email">
                {r.workEmail ? <a href={`mailto:${r.workEmail}`}>{r.workEmail}</a> : 'Not recorded'}
              </Fact>
              <Fact label="Work phone">
                {r.workPhone ?? 'Not recorded'}
                {r.workExtension ? ` ext. ${r.workExtension}` : ''}
              </Fact>
            </Facts>
          </section>
        </div>

        <aside className="stack">
          <section className="panel" aria-labelledby="off-h">
            <SectionHead
              id="off-h"
              icon={<FlowIcon />}
              tone={live.length ? 'attention' : 'pending'}
              title="Offboarding"
              description={
                live.length
                  ? 'This employee already has an active offboarding case.'
                  : 'No active offboarding case for this employee.'
              }
            />
            {live.length > 0 ? (
              <div
                className="panel panel--edge panel--edge-attention"
                role="status"
                data-existing-case
              >
                <p style={{ marginTop: 0 }}>
                  <strong>{r.displayName}</strong> already has an active offboarding case
                  {live.length > 1 ? 's' : ''}: {live.map((c) => c.caseNumber).join(', ')}. Open it
                  rather than creating a duplicate.
                </p>
                <div className="actions-row">
                  {live.map((c) => (
                    <Link key={c.id} className="button" href={`/cases/${c.id}`}>
                      Open existing case {live.length > 1 ? c.caseNumber : ''}
                    </Link>
                  ))}
                </div>
                {profile.canStartOffboarding ? (
                  <p className="hint" style={{ marginBottom: 0 }}>
                    A genuinely separate separation event (a return and a second departure) can
                    still be recorded: <Link href={startHref}>start another case</Link> - the intake
                    asks you to confirm.
                  </p>
                ) : null}
              </div>
            ) : profile.canStartOffboarding ? (
              <div className="actions-row">
                <Link className="button" href={startHref} data-start-offboarding>
                  Start offboarding
                </Link>
              </div>
            ) : (
              <p className="hint">
                {r.active
                  ? 'Your role cannot create cases.'
                  : 'Inactive in BambooHR - a new case is not offered. Existing cases stay reachable below.'}
              </p>
            )}
            {live.length > 0 ? (
              <Rows label="Active cases">
                {live.map((c) => (
                  <Row
                    key={c.id}
                    mark={<CasesIcon />}
                    title={<Link href={`/cases/${c.id}`}>{c.caseNumber}</Link>}
                    sub={humanize(c.departureType)}
                    facts={<StatusBadge status={c.status as CaseStatus} />}
                  />
                ))}
              </Rows>
            ) : null}
            {profile.cases.history.length > 0 ? (
              <>
                <h3 style={{ fontSize: 'var(--text-base)' }}>Offboarding history</h3>
                <Rows label="Offboarding history">
                  {profile.cases.history.map((c) => (
                    <Row
                      key={c.id}
                      mark={<CasesIcon />}
                      title={<Link href={`/cases/${c.id}`}>{c.caseNumber}</Link>}
                      sub={`${humanize(c.departureType)} · opened ${formatDateOnly(c.createdAt)}`}
                      facts={<StatusBadge status={c.status as CaseStatus} />}
                      muted
                    />
                  ))}
                </Rows>
              </>
            ) : live.length === 0 ? (
              <EmptyState
                icon={<CasesIcon />}
                title="No offboarding history"
                body="No case you can see has been opened for this employee."
              />
            ) : null}
          </section>

          <section className="panel" aria-labelledby="prov-h">
            <SectionHead id="prov-h" title="Record provenance" />
            <Facts>
              <Fact label="Source">
                {r.sourceSystem === 'BAMBOOHR'
                  ? 'BambooHR (read-only mirror)'
                  : humanize(r.sourceSystem)}
              </Fact>
              <Fact label="BambooHR id">{r.sourceId}</Fact>
              <Fact label="Record last synchronized">
                {r.lastSyncedAt ? formatInstant(r.lastSyncedAt) : formatInstant(r.retrievedAt)}
              </Fact>
              {r.sourceUpdatedAt ? (
                <Fact label="Last changed in BambooHR">{formatInstant(r.sourceUpdatedAt)}</Fact>
              ) : null}
              {r.archivedAt ? (
                <Fact label="Archived">
                  {formatInstant(r.archivedAt)} - no longer listed by BambooHR; kept for history
                </Fact>
              ) : null}
            </Facts>
          </section>
        </aside>
      </div>
    </>
  );
}
