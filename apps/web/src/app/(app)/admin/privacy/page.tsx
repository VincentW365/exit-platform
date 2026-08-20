import type { Metadata } from 'next';
import { ServiceError, privacyOverview } from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  anonymizeAction,
  approvePolicyAction,
  disclosureAction,
  dryRunAction,
  dsrPackageAction,
  placeHoldAction,
  releaseHoldAction,
  upsertPolicyAction,
} from './actions';
import { humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Privacy and Retention' };
export const dynamic = 'force-dynamic';

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof privacyOverview>>;
  try {
    data = await privacyOverview(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">Privacy operations require an authorized role.</p>
        </>
      );
    throw e;
  }
  const canOperate = can(actor, 'privacy.operate');

  return (
    <>
      <h1>Privacy and Retention</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Development uses SYNTHETIC retention schedules; nothing deletes automatically; holds always
        suspend retention; destructive operations need a dry run and authorized approval. Immutable
        audit evidence follows the approved retention design.
      </p>

      <section className="panel" aria-labelledby="pol-h">
        <h2 id="pol-h" style={{ marginTop: 0 }}>
          Retention Policies
        </h2>
        <ul>
          {data.policies.map((p) => (
            <li key={p.id}>
              {p.recordType} v{p.version}: retain {p.retainYears} year(s) - {p.basis}{' '}
              {p.active ? (
                <span className="badge badge--success">Active</span>
              ) : (
                <span className="badge badge--neutral">Inactive</span>
              )}
              {p.approvedById ? (
                <span className="hint"> approved</span>
              ) : (
                <span className="hint"> unapproved</span>
              )}{' '}
              {canOperate && !p.approvedById ? (
                <form action={approvePolicyAction} style={{ display: 'inline-block' }}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="secondary">
                    Approve + activate
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canOperate ? (
          <details className="action">
            <summary>Create a policy version</summary>
            <form action={upsertPolicyAction}>
              <label htmlFor="rp-type">Record Type</label>
              <select id="rp-type" name="recordType" required>
                <option value="OFFBOARDING_CASE">Offboarding case</option>
                <option value="SURVEY_RESPONSE">Survey response</option>
                <option value="AUDIT_EVENT">Audit event</option>
                <option value="ATTACHMENT">Attachment</option>
              </select>
              <label htmlFor="rp-years">Retain (Years)</label>
              <input id="rp-years" name="retainYears" type="number" min={1} max={50} required />
              <label htmlFor="rp-basis">Basis (Synthetic Development Value)</label>
              <input id="rp-basis" name="basis" required maxLength={500} />
              <label htmlFor="rp-reason">Reason (Audited)</label>
              <input id="rp-reason" name="reason" required maxLength={500} />
              <button type="submit">Create version (approval required)</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="hold-h">
        <h2 id="hold-h" style={{ marginTop: 0 }}>
          Legal / Administrative Holds
        </h2>
        <ul>
          {data.holds.map((h) => (
            <li key={h.id}>
              {h.case.caseNumber}: {h.reason} - placed {formatInstant(h.placedAt)}{' '}
              {h.releasedAt ? (
                <span className="badge badge--neutral">Released</span>
              ) : (
                <>
                  <span className="badge badge--warning">Active</span>{' '}
                  {canOperate ? (
                    <details className="action" style={{ display: 'inline-block' }}>
                      <summary>Release</summary>
                      <form action={releaseHoldAction}>
                        <input type="hidden" name="holdId" value={h.id} />
                        <label htmlFor={`rh-${h.id}`}>Release Note (Audited)</label>
                        <input id={`rh-${h.id}`} name="note" required maxLength={500} />
                        <button type="submit">Release hold</button>
                      </form>
                    </details>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
        {canOperate ? (
          <details className="action">
            <summary>Place a hold on a case</summary>
            <form action={placeHoldAction}>
              <label htmlFor="ph-case">Case ID</label>
              <input id="ph-case" name="caseId" required maxLength={40} />
              <label htmlFor="ph-reason">Reason (Audited)</label>
              <input id="ph-reason" name="reason" required maxLength={500} />
              <button type="submit">Place hold</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="run-h">
        <h2 id="run-h" style={{ marginTop: 0 }}>
          Retention Runs and Controlled Anonymization
        </h2>
        {canOperate ? (
          <form action={dryRunAction} style={{ display: 'inline-block' }}>
            <button type="submit">Run retention DRY RUN (nothing is deleted)</button>
          </form>
        ) : null}
        <ul>
          {data.runs.map((r) => (
            <li key={r.id}>
              {humanize(r.mode)} under policy v{r.policyVersion} at {formatInstant(r.startedAt)} -{' '}
              {Array.isArray(r.findings)
                ? `${(r.findings as unknown[]).length} record(s) evaluated`
                : 'recorded'}
            </li>
          ))}
        </ul>
        {canOperate ? (
          <details className="action">
            <summary>Anonymize a closed TEST/TRAINING case (high-impact, audited)</summary>
            <form action={anonymizeAction}>
              <p className="hint">
                Replaces case identity fields with an anonymized marker. Immutable snapshots,
                attestations and audit rows are protected by database triggers and are the
                documented anonymization boundary. Holds block this operation.
              </p>
              <label htmlFor="an-case">Case ID</label>
              <input id="an-case" name="caseId" required maxLength={40} />
              <label htmlFor="an-reason">Reason (Required, Audited)</label>
              <input id="an-reason" name="reason" required maxLength={500} />
              <button type="submit">Anonymize case</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="dsr-h">
        <h2 id="dsr-h" style={{ marginTop: 0 }}>
          Data-subject Requests and Disclosures
        </h2>
        <ul>
          {data.dsrs.map((d) => (
            <li key={d.id}>
              {humanize(d.type)} for <code>{d.subjectRef}</code> - {humanize(d.status)} (
              {formatInstant(d.requestedAt)})
            </li>
          ))}
          {data.disclosures.map((d) => (
            <li key={d.id}>
              Disclosure to {d.disclosedTo} for <code>{d.subjectRef}</code> ({d.lawfulBasis}) -{' '}
              {formatInstant(d.disclosedAt)}
            </li>
          ))}
        </ul>
        {canOperate ? (
          <>
            <details className="action">
              <summary>Prepare a data-subject export package</summary>
              <form action={dsrPackageAction}>
                <label htmlFor="dsr-ref">Subject Reference (Employee Source ID)</label>
                <input id="dsr-ref" name="subjectRef" required maxLength={40} />
                <p className="hint">
                  Excludes other employees personal data, restricted notes, secrets and internal
                  security details (P.8).
                </p>
                <button type="submit">Prepare package</button>
              </form>
            </details>
            <details className="action">
              <summary>Record a disclosure</summary>
              <form action={disclosureAction}>
                <label htmlFor="dl-ref">Subject Reference</label>
                <input id="dl-ref" name="subjectRef" required maxLength={40} />
                <label htmlFor="dl-to">Disclosed To</label>
                <input id="dl-to" name="disclosedTo" required maxLength={200} />
                <label htmlFor="dl-desc">Description (Safe)</label>
                <input id="dl-desc" name="description" required maxLength={500} />
                <label htmlFor="dl-basis">Lawful Basis</label>
                <input id="dl-basis" name="lawfulBasis" required maxLength={200} />
                <button type="submit">Record disclosure</button>
              </form>
            </details>
          </>
        ) : null}
        {data.incidents.length > 0 ? (
          <>
            <h3>Privacy Incidents</h3>
            <ul>
              {data.incidents.map((i) => (
                <li key={i.id}>
                  {i.title} - {humanize(i.severity)} - {humanize(i.status)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}
