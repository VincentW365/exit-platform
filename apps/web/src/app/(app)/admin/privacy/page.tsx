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

export const metadata: Metadata = { title: 'Privacy and retention' };
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
      return <p className="panel">Privacy operations require an authorized role.</p>;
    throw e;
  }
  const canOperate = can(actor, 'privacy.operate');

  return (
    <>
      <h1>Privacy, retention and data-subject operations</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Development uses SYNTHETIC retention schedules; nothing deletes automatically; holds always
        suspend retention; destructive operations need a dry run and authorized approval. Immutable
        audit evidence follows the approved retention design.
      </p>

      <section className="panel" aria-labelledby="pol-h">
        <h2 id="pol-h" style={{ marginTop: 0 }}>
          Retention policies (versioned, synthetic)
        </h2>
        <ul>
          {data.policies.map((p) => (
            <li key={p.id}>
              {p.recordType} v{p.version}: retain {p.retainYears} year(s) - {p.basis}{' '}
              {p.active ? (
                <span className="badge badge--success">ACTIVE</span>
              ) : (
                <span className="badge badge--neutral">inactive</span>
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
              <label htmlFor="rp-type">Record type</label>
              <select id="rp-type" name="recordType" required>
                <option value="OFFBOARDING_CASE">OFFBOARDING_CASE</option>
                <option value="SURVEY_RESPONSE">SURVEY_RESPONSE</option>
                <option value="AUDIT_EVENT">AUDIT_EVENT</option>
                <option value="ATTACHMENT">ATTACHMENT</option>
              </select>
              <label htmlFor="rp-years">Retain (years)</label>
              <input id="rp-years" name="retainYears" type="number" min={1} max={50} required />
              <label htmlFor="rp-basis">Basis (synthetic development value)</label>
              <input id="rp-basis" name="basis" required maxLength={500} />
              <label htmlFor="rp-reason">Reason (audited)</label>
              <input id="rp-reason" name="reason" required maxLength={500} />
              <button type="submit">Create version (approval required)</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="hold-h">
        <h2 id="hold-h" style={{ marginTop: 0 }}>
          Legal / administrative holds
        </h2>
        <ul>
          {data.holds.map((h) => (
            <li key={h.id}>
              {h.case.caseNumber}: {h.reason} - placed {formatInstant(h.placedAt)}{' '}
              {h.releasedAt ? (
                <span className="badge badge--neutral">released</span>
              ) : (
                <>
                  <span className="badge badge--warning">ACTIVE</span>{' '}
                  {canOperate ? (
                    <details className="action" style={{ display: 'inline-block' }}>
                      <summary>Release</summary>
                      <form action={releaseHoldAction}>
                        <input type="hidden" name="holdId" value={h.id} />
                        <label htmlFor={`rh-${h.id}`}>Release note (audited)</label>
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
              <label htmlFor="ph-reason">Reason (audited)</label>
              <input id="ph-reason" name="reason" required maxLength={500} />
              <button type="submit">Place hold</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="run-h">
        <h2 id="run-h" style={{ marginTop: 0 }}>
          Retention runs and controlled anonymization
        </h2>
        {canOperate ? (
          <form action={dryRunAction} style={{ display: 'inline-block' }}>
            <button type="submit">Run retention DRY RUN (nothing is deleted)</button>
          </form>
        ) : null}
        <ul>
          {data.runs.map((r) => (
            <li key={r.id}>
              {r.mode} under policy v{r.policyVersion} at {formatInstant(r.startedAt)} -{' '}
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
              <label htmlFor="an-reason">Reason (required, audited)</label>
              <input id="an-reason" name="reason" required maxLength={500} />
              <button type="submit">Anonymize case</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="dsr-h">
        <h2 id="dsr-h" style={{ marginTop: 0 }}>
          Data-subject requests and disclosures
        </h2>
        <ul>
          {data.dsrs.map((d) => (
            <li key={d.id}>
              {d.type} for <code>{d.subjectRef}</code> - {d.status} ({formatInstant(d.requestedAt)})
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
                <label htmlFor="dsr-ref">Subject reference (employee source ID)</label>
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
                <label htmlFor="dl-ref">Subject reference</label>
                <input id="dl-ref" name="subjectRef" required maxLength={40} />
                <label htmlFor="dl-to">Disclosed to</label>
                <input id="dl-to" name="disclosedTo" required maxLength={200} />
                <label htmlFor="dl-desc">Description (safe)</label>
                <input id="dl-desc" name="description" required maxLength={500} />
                <label htmlFor="dl-basis">Lawful basis</label>
                <input id="dl-basis" name="lawfulBasis" required maxLength={200} />
                <button type="submit">Record disclosure</button>
              </form>
            </details>
          </>
        ) : null}
        {data.incidents.length > 0 ? (
          <>
            <h3>Privacy incidents (support records)</h3>
            <ul>
              {data.incidents.map((i) => (
                <li key={i.id}>
                  {i.title} - {i.severity} - {i.status}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}
