import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getHandover } from '@exit/db';
import { formatInstant, CREDENTIAL_WARNING } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { handoverReviewAction, handoverTransitionAction, updateHandoverAction } from './actions';

export const metadata: Metadata = { title: 'Handover' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  NOT_STARTED: 'badge--neutral',
  IN_PROGRESS: 'badge--info',
  COMPLETED: 'badge--success',
  NOT_APPLICABLE: 'badge--neutral',
  WAIVED: 'badge--warning',
};

export default async function CaseHandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getHandover>>;
  try {
    data = await getHandover(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">This area requires case assignment.</p>
        </>
      );
    throw e;
  }
  const r = data.record;

  return (
    <>
      <h1>
        Knowledge transfer / handover - {data.caseNumber}{' '}
        <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>{r.status}</span>
      </h1>
      <CaseNav caseId={id} active="handover" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        {CREDENTIAL_WARNING} Likely credentials are rejected automatically. The line manager owns
        this content; HR monitors completion.
      </p>

      {r.status === 'WAIVED' ? (
        <p className="panel">
          Waived {r.waivedAt ? formatInstant(r.waivedAt) : ''}: {r.waiverReason}
        </p>
      ) : null}
      {r.status === 'NOT_APPLICABLE' ? (
        <p className="panel">Not applicable: {r.notApplicableReason}</p>
      ) : null}
      {r.status === 'COMPLETED' ? (
        <p className="panel">
          Completed {r.completedAt ? formatInstant(r.completedAt) : ''} with manager attestation
          {r.managerAttestedAt ? ` (${formatInstant(r.managerAttestedAt)})` : ''}.
        </p>
      ) : null}
      {r.hrReviewedAt ? (
        <p className="panel">
          HR review {formatInstant(r.hrReviewedAt)}: {r.hrReviewNote}
        </p>
      ) : null}

      {data.canEdit ? (
        <section className="panel" aria-labelledby="ho-edit-h">
          <h2 id="ho-edit-h" style={{ marginTop: 0 }}>
            Handover record (manager-owned)
          </h2>
          <form action={updateHandoverAction}>
            <input type="hidden" name="caseId" value={id} />
            {data.sections.map((s) => (
              <div key={s.key}>
                <label htmlFor={`ho-${s.key}`}>{s.label}</label>
                <textarea
                  id={`ho-${s.key}`}
                  name={s.key}
                  rows={2}
                  maxLength={4000}
                  defaultValue={(r as unknown as Record<string, string | null>)[s.key] ?? ''}
                />
              </div>
            ))}
            <button type="submit">Save handover record</button>
          </form>
        </section>
      ) : (
        <section className="panel" aria-labelledby="ho-view-h">
          <h2 id="ho-view-h" style={{ marginTop: 0 }}>
            Handover record
          </h2>
          <dl className="kv">
            {data.sections.map((s) => (
              <div key={s.key} style={{ display: 'contents' }}>
                <dt>{s.label}</dt>
                <dd>{(r as unknown as Record<string, string | null>)[s.key] || '-'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {data.canComplete ? (
        <details className="action">
          <summary>Complete handover (manager attestation)</summary>
          <form action={handoverTransitionAction}>
            <input type="hidden" name="caseId" value={id} />
            <input type="hidden" name="action" value="complete" />
            <p>
              Completing attests the recorded information is accurate and complete. Duties requiring
              reassignment and a replacement owner must be recorded first.
            </p>
            <button type="submit">Complete with attestation</button>
          </form>
        </details>
      ) : null}
      {data.canWaive ? (
        <>
          <details className="action">
            <summary>Mark not applicable (HR Manager)</summary>
            <form action={handoverTransitionAction}>
              <input type="hidden" name="caseId" value={id} />
              <input type="hidden" name="action" value="notApplicable" />
              <label htmlFor="na-reason">Reason (required, audited)</label>
              <textarea id="na-reason" name="reason" required rows={2} maxLength={500} />
              <button type="submit">Mark not applicable</button>
            </form>
          </details>
          <details className="action">
            <summary>Waive handover (HR Manager)</summary>
            <form action={handoverTransitionAction}>
              <input type="hidden" name="caseId" value={id} />
              <input type="hidden" name="action" value="waive" />
              <label htmlFor="wv-reason">Reason (required, audited)</label>
              <textarea id="wv-reason" name="reason" required rows={2} maxLength={500} />
              <button type="submit">Waive handover</button>
            </form>
          </details>
        </>
      ) : null}
      {data.canReview ? (
        <details className="action">
          <summary>Record HR review note</summary>
          <form action={handoverReviewAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="rv-note">Review note (monitoring only; HR never edits content)</label>
            <textarea id="rv-note" name="note" required rows={2} maxLength={2000} />
            <button type="submit">Record review</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
