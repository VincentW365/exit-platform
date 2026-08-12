import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getWorkflowDefinition } from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  activateDefinitionAction,
  createDraftAction,
  retireDefinitionAction,
  updateDraftAction,
} from '../actions';

export const metadata: Metadata = { title: 'Workflow definition' };
export const dynamic = 'force-dynamic';

export default async function WorkflowDefinitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let def: Awaited<ReturnType<typeof getWorkflowDefinition>>;
  try {
    def = await getWorkflowDefinition(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">Workflow definitions require an HR or oversight role.</p>
        </>
      );
    throw e;
  }

  const canDraft = can(actor, 'workflowDef.draft');
  const canActivate = can(actor, 'workflowDef.activate');
  const enabledTasks = def.taskDefs.filter((t) => t.enabled);
  const tasksJson = JSON.stringify(
    enabledTasks.map((t) => ({
      taskCode: t.taskCode,
      sortOrder: t.sortOrder,
      enabled: t.enabled,
      title: t.title,
      description: t.description,
      department: t.department,
      requiredRole: t.requiredRole,
      taskKind: t.taskKind,
      priority: t.priority,
      confidential: t.confidential,
      required: t.required,
      waiverAllowed: t.waiverAllowed,
      waiverAuthority: t.waiverAuthority,
      dueBasis: t.dueBasis,
      dueOffsetDays: t.dueOffsetDays,
      dueOffsetKind: t.dueOffsetKind,
      releaseBasis: t.releaseBasis,
      releaseOffsetHours: t.releaseOffsetHours,
      pausesOnHold: t.pausesOnHold,
      blockPausesSla: t.blockPausesSla,
      dependsOnCodes: t.dependsOnCodes,
      evidenceKind: t.evidenceKind,
      evidenceNote: t.evidenceNote,
      slaNote: t.slaNote,
      escalationNote: t.escalationNote,
    })),
    null,
    2,
  );

  return (
    <>
      <h1>
        {def.name} - v{def.version} ({def.status})
      </h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        {def.workflowType} - checksum <code>{def.configChecksum}</code> - created{' '}
        {formatInstant(def.createdAt)}
        {def.activatedAt ? ` - activated ${formatInstant(def.activatedAt)}` : ''}
        {def.changeReason ? ` - change reason: ${def.changeReason}` : ''}
      </p>
      <p>{def.description}</p>
      <p className="hint">Activation conditions: {def.activationConditions || '-'}</p>

      <section className="panel" aria-labelledby="matrix-h">
        <h2 id="matrix-h" style={{ marginTop: 0 }}>
          Task matrix ({enabledTasks.length} tasks)
        </h2>
        <div style={{ overflowX: 'auto' }} tabIndex={0}>
          <table>
            <caption className="visually-hidden">Task definitions</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Code / title</th>
                <th scope="col">Department (role)</th>
                <th scope="col">Required</th>
                <th scope="col">Depends on</th>
                <th scope="col">Due-date basis</th>
                <th scope="col">Release</th>
                <th scope="col">SLA / escalation</th>
                <th scope="col">Hold / block pause</th>
                <th scope="col">Waiver</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {enabledTasks.map((t, i) => (
                <tr key={t.id}>
                  <td>{i + 1}</td>
                  <td>
                    <code>{t.taskCode}</code>
                    <br />
                    {t.title}
                    {t.taskKind === 'ACCESS_REVOCATION' ? (
                      <>
                        {' '}
                        <span className="badge badge--danger">EXACT TIME</span>
                      </>
                    ) : null}
                    {t.confidential ? (
                      <>
                        {' '}
                        <span className="badge badge--warning">Restricted</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {t.department} ({t.requiredRole})
                  </td>
                  <td>{t.required ? 'Required' : 'Optional'}</td>
                  <td>{t.dependsOnCodes.join(', ') || '-'}</td>
                  <td>
                    {t.dueBasis}
                    {t.dueBasis !== 'NONE'
                      ? ` ${t.dueOffsetDays >= 0 ? '+' : ''}${t.dueOffsetDays} ${t.dueOffsetKind}`
                      : ''}
                  </td>
                  <td>
                    {t.releaseBasis === 'IMMEDIATE'
                      ? 'Immediate'
                      : `Effective time ${t.releaseOffsetHours >= 0 ? '+' : ''}${t.releaseOffsetHours}h`}
                  </td>
                  <td>
                    {t.slaNote ?? '-'}
                    {t.escalationNote ? (
                      <>
                        <br />
                        <span className="hint">{t.escalationNote}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {t.pausesOnHold ? 'Pauses on hold' : 'Never pauses'} /{' '}
                    {t.blockPausesSla ? 'block pauses SLA' : 'block keeps SLA'}
                  </td>
                  <td>{t.waiverAllowed ? `Yes (${t.waiverAuthority})` : 'No'}</td>
                  <td>{t.evidenceKind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {def.status === 'DRAFT' && canActivate ? (
        <form action={activateDefinitionAction} style={{ marginBottom: '1rem' }}>
          <input type="hidden" name="definitionId" value={id} />
          <button type="submit">Activate this version (HR Manager)</button>
        </form>
      ) : null}
      {(def.status === 'ACTIVE' || def.status === 'SUPERSEDED') && canActivate ? (
        <details className="action">
          <summary>Retire this version (HR Manager)</summary>
          <form action={retireDefinitionAction}>
            <input type="hidden" name="definitionId" value={id} />
            <label htmlFor="ret-reason">Reason (required, audited)</label>
            <textarea id="ret-reason" name="reason" required rows={2} maxLength={500} />
            <button type="submit">Retire</button>
          </form>
        </details>
      ) : null}

      {def.status === 'DRAFT' && canDraft ? (
        <details className="action">
          <summary>Edit this draft</summary>
          <form action={updateDraftAction}>
            <input type="hidden" name="definitionId" value={id} />
            <label htmlFor="e-name">Name</label>
            <input id="e-name" name="name" defaultValue={def.name} required maxLength={200} />
            <label htmlFor="e-desc">Description</label>
            <textarea
              id="e-desc"
              name="description"
              defaultValue={def.description}
              rows={2}
              maxLength={2000}
            />
            <label htmlFor="e-cond">Activation conditions</label>
            <textarea
              id="e-cond"
              name="activationConditions"
              defaultValue={def.activationConditions}
              rows={2}
              maxLength={2000}
            />
            <label htmlFor="e-tasks">Task definitions (JSON; validated on save)</label>
            <textarea
              id="e-tasks"
              name="tasks"
              defaultValue={tasksJson}
              rows={16}
              style={{ fontFamily: 'monospace' }}
            />
            <label htmlFor="e-reason">Change reason (required)</label>
            <input id="e-reason" name="changeReason" required maxLength={500} />
            <button type="submit">Save draft</button>
          </form>
        </details>
      ) : null}

      {canDraft ? (
        <details className="action">
          <summary>Create a new draft version from this one</summary>
          <form action={createDraftAction}>
            <input type="hidden" name="workflowType" value={def.workflowType} />
            <input type="hidden" name="sourceId" value={id} />
            <label htmlFor="n-name">Name</label>
            <input id="n-name" name="name" defaultValue={def.name} required maxLength={200} />
            <label htmlFor="n-desc">Description</label>
            <textarea
              id="n-desc"
              name="description"
              defaultValue={def.description}
              rows={2}
              maxLength={2000}
            />
            <label htmlFor="n-cond">Activation conditions</label>
            <textarea
              id="n-cond"
              name="activationConditions"
              defaultValue={def.activationConditions}
              rows={2}
              maxLength={2000}
            />
            <label htmlFor="n-tasks">Task definitions (JSON)</label>
            <textarea
              id="n-tasks"
              name="tasks"
              defaultValue={tasksJson}
              rows={16}
              style={{ fontFamily: 'monospace' }}
            />
            <label htmlFor="n-reason">Change reason (required)</label>
            <input id="n-reason" name="changeReason" required maxLength={500} />
            <button type="submit">Create draft version</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
