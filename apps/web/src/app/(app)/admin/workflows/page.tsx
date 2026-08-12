import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listWorkflowDefinitions } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';

export const metadata: Metadata = { title: 'Workflow definitions' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  ACTIVE: 'badge--success',
  SUPERSEDED: 'badge--neutral',
  RETIRED: 'badge--neutral',
};

export default async function WorkflowDefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let defs: Awaited<ReturnType<typeof listWorkflowDefinitions>>;
  try {
    defs = await listWorkflowDefinitions(actor);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">Workflow definitions require an HR role.</p>
        </>
      );
    throw e;
  }

  return (
    <>
      <h1>Workflow definitions</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        Versioned and deterministic: exactly one ACTIVE version per workflow type; active versions
        are immutable; every activated case is pinned to the exact version it started with. HR
        Officers draft; HR Managers activate, supersede and retire.
      </p>
      <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
        <table>
          <caption className="visually-hidden">Workflow definition versions</caption>
          <thead>
            <tr>
              <th scope="col">Workflow type</th>
              <th scope="col">Name</th>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Checksum</th>
              <th scope="col">Created / activated</th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.id}>
                <td>{d.workflowType}</td>
                <td>
                  <Link href={`/admin/workflows/${d.id}`}>{d.name}</Link>
                </td>
                <td>v{d.version}</td>
                <td>
                  <span className={`badge ${BADGE[d.status] ?? 'badge--neutral'}`}>{d.status}</span>
                </td>
                <td>
                  <code>{d.configChecksum.slice(0, 12)}...</code>
                </td>
                <td>
                  {formatInstant(d.createdAt)}
                  {d.activatedAt ? (
                    <>
                      <br />
                      <span className="hint">activated {formatInstant(d.activatedAt)}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
