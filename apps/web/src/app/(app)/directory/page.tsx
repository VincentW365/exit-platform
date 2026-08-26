import type { Metadata } from 'next';
import { formatInstant } from '@exit/domain';
import { Suspense } from 'react';
import { ServiceError, directoryOverview, organizationTree, type OrgTreeNode } from '@exit/db';
import type { Actor } from '@exit/domain';
import { SkeletonPanel } from '@/components/Skeleton';
import { requireAuth } from '@/lib/auth';
import { countOf, humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Organization Directory' };
export const dynamic = 'force-dynamic';

/**
 * One person in the reporting tree. Managers are expandable branches
 * (nested <details> - native keyboard support, no JavaScript); individual
 * contributors are leaves. The top two levels open by default so the shape
 * of the organization is visible immediately.
 */
function OrgNode({ node, depth }: { node: OrgTreeNode; depth: number }) {
  const meta = [node.jobTitle, node.department].filter(Boolean).join(' · ');
  const person = (
    <>
      <span className="org-node__name">{node.displayName}</span>
      {meta ? <span className="org-node__meta">{meta}</span> : null}
      {!node.active ? <span className="badge badge--neutral">Inactive</span> : null}
    </>
  );
  if (node.reports.length === 0) {
    return (
      <li className="org-node org-node--leaf">
        <span className="org-node__row">{person}</span>
      </li>
    );
  }
  return (
    <li className="org-node">
      <details open={depth < 2}>
        <summary className="org-node__row">
          {person}
          <span className="org-node__count">
            {node.reports.length} direct
            {node.totalBelow > node.reports.length ? ` · ${node.totalBelow} total` : ''}
          </span>
        </summary>
        <ul className="org-branch">
          {node.reports.map((child) => (
            <OrgNode key={child.sourceId} node={child} depth={depth + 1} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** The reporting tree, streamed in after the rest of the page. */
async function ReportingStructure({ actor }: { actor: Actor }) {
  const tree = await organizationTree(actor);
  if (tree.roots.length === 0 && tree.unattached.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="dir-tree-h">
      <h2 id="dir-tree-h" style={{ marginTop: 0 }}>
        Reporting Structure
      </h2>
      <p className="hint">
        {tree.totalPeople} people, {tree.maxDepth} level(s) deep. Select a manager to expand or
        collapse their team.
      </p>
      <ul className="org-tree">
        {tree.roots.map((root) => (
          <OrgNode key={root.sourceId} node={root} depth={0} />
        ))}
      </ul>
      {tree.unattached.length > 0 ? (
        <details className="action" style={{ marginTop: '0.75rem' }}>
          <summary>
            {countOf(tree.unattached.length, 'person', 'people')} whose manager is not in the
            directory
          </summary>
          <ul className="org-tree">
            {tree.unattached.map((node) => (
              <OrgNode key={node.sourceId} node={node} depth={1} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default async function DirectoryPage() {
  const { actor } = await requireAuth();
  let data: Awaited<ReturnType<typeof directoryOverview>>;
  try {
    data = await directoryOverview(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">The organization directory is limited to authorized HR roles.</p>
        </>
      );
    throw e;
  }

  return (
    <>
      <h1>Organization Directory</h1>
      <p className="hint" role="note">
        Reference view of the company directory for HR case preparation. This is not an employee
        self-service directory, and email addresses are deliberately not shown. Use &quot;New
        case&quot; to start an offboarding for someone.
      </p>

      <section className="panel" aria-labelledby="dir-totals-h">
        <h2 id="dir-totals-h" style={{ marginTop: 0 }}>
          Coverage
        </h2>
        <ul>
          <li>
            {countOf(data.totals.records, 'directory record')}: {data.totals.active} active,{' '}
            {data.totals.inactive} inactive
            {data.totals.purged > 0 ? `, ${data.totals.purged} purged` : ''}.
          </li>
          <li>{countOf(data.positions, 'distinct position')}.</li>
          <li>{countOf(data.withManager, 'record')} with manager data.</li>
          <li>
            Sources:{' '}
            {data.bySource.map((s) => `${humanize(s.sourceSystem)} (${s.records})`).join(', ') ||
              'none yet'}
            .
          </li>
        </ul>
      </section>

      {/* Section 21: the reporting structure walks every directory record
          and is the slow half of this page. It streams in behind a
          placeholder so the coverage figures are readable immediately. The
          boundary sits below the authorization check by construction - this
          branch is only reached once the actor has been admitted. */}
      <Suspense fallback={<SkeletonPanel rows={8} />}>
        <ReportingStructure actor={actor} />
      </Suspense>

      <section className="panel" aria-labelledby="dir-dept-h">
        <h2 id="dir-dept-h" style={{ marginTop: 0 }}>
          Departments and Locations
        </h2>
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption className="visually-hidden">Records per department</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Records</th>
              </tr>
            </thead>
            <tbody>
              {data.byDepartment.map((d) => (
                <tr key={d.department}>
                  <td>{d.department}</td>
                  <td>{d.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Locations:{' '}
          {data.byLocation.map((l) => `${l.location} (${l.records})`).join(', ') || 'None recorded'}
          .
        </p>
      </section>

      {/* Exception-first (owner request, 2026-08-18): the panel exists only
          when there is actually something to resolve. */}
      {data.gaps.missingDepartment.length > 0 ||
      data.gaps.missingManager.length > 0 ||
      data.gaps.missingPosition.length > 0 ? (
        <section className="panel" aria-labelledby="dir-gaps-h">
          <h2 id="dir-gaps-h" style={{ marginTop: 0 }}>
            Data Gaps to Resolve Before Case Work
          </h2>
          <ul>
            {data.gaps.missingDepartment.map((e) => (
              <li key={`d-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing department
              </li>
            ))}
            {data.gaps.missingPosition.map((e) => (
              <li key={`p-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing position
              </li>
            ))}
            {data.gaps.missingManager.map((e) => (
              <li key={`m-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing manager data
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="dir-sync-h">
        <h2 id="dir-sync-h" style={{ marginTop: 0 }}>
          Synchronization History
        </h2>
        {data.lastSyncs.length === 0 ? (
          <p className="meta">
            The directory has never been synchronized. Run a sync to pull the current employee
            records from the company directory.
          </p>
        ) : (
          <ul>
            {data.lastSyncs.map((s, i) => (
              <li key={i}>
                {humanize(s.mode)} - started {formatInstant(s.startedAt)}
                {s.finishedAt ? `, finished ${formatInstant(s.finishedAt)}` : ''} - {s.created}{' '}
                created, {s.updated} updated.
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
