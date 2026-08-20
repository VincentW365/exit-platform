import type { Metadata } from 'next';
import { collectHealth, operationalDiagnostics } from '@exit/db';
import { can } from '@exit/domain';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Integration Health' };
export const dynamic = 'force-dynamic';

/** Directive 4 V.5: administrator health dashboard - PII- and secret-free. */
export default async function HealthPage() {
  const { actor } = await requireAuth();
  if (!can(actor, 'health.view'))
    return (
      <>
        <h1>Access Restricted</h1>
        <p className="panel">The health dashboard requires an authorized role.</p>
      </>
    );
  const [health, diagnostics] = await Promise.all([collectHealth(), operationalDiagnostics(actor)]);

  return (
    <>
      <h1>
        Integration and Operational Health{' '}
        <span className={`badge ${health.ok ? 'badge--success' : 'badge--danger'}`}>
          {health.ok ? 'Healthy' : 'Needs attention'}
        </span>
      </h1>
      <p className="hint" role="note">
        Component states, counts and ages only - never personal data or secrets. Development
        providers are clearly labelled and are refused by production startup validation.
      </p>
      <section className="panel" aria-labelledby="comp-h">
        <h2 id="comp-h" style={{ marginTop: 0 }}>
          Components
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {health.components.map((c) => (
            <li key={c.component} style={{ marginBottom: '0.35rem' }}>
              <span className={`badge ${c.ok ? 'badge--success' : 'badge--danger'}`}>
                {c.ok ? 'OK' : 'Down'}
              </span>{' '}
              <strong>{c.component}</strong> - {c.detail}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="diag-h">
        <h2 id="diag-h" style={{ marginTop: 0 }}>
          Operational Diagnostics
        </h2>
        <dl className="kv">
          <dt>Unassigned IT/Finance Tasks</dt>
          <dd className="tabular-nums">
            {diagnostics.unassignedDeptTasks} (oldest {diagnostics.oldestUnassignedHours}h)
          </dd>
          <dt>Blocked Tasks</dt>
          <dd className="tabular-nums">
            {diagnostics.blockedTasks} (oldest {diagnostics.oldestBlockedHours}h)
          </dd>
          <dt>Cases Awaiting HR Approval</dt>
          <dd className="tabular-nums">
            {diagnostics.approvalsWaiting} (oldest wait {diagnostics.oldestApprovalWaitHours}h)
          </dd>
          <dt>Task Claims / Reassignments (30 Days)</dt>
          <dd className="tabular-nums">
            {diagnostics.taskClaims30d} / {diagnostics.taskReassignments30d}
          </dd>
          <dt>HR Officer Reassignments (30 Days)</dt>
          <dd className="tabular-nums">{diagnostics.officerReassignments30d}</dd>
          <dt>Exceptions Raised (30 Days)</dt>
          <dd className="tabular-nums">{diagnostics.exceptions30d}</dd>
          <dt>Case Intake Data Entry</dt>
          <dd>
            {diagnostics.intakeSourceDerivedFields} fields copy from the directory;{' '}
            {diagnostics.intakeManualFields} separation-specific fields are entered by HR
          </dd>
        </dl>
      </section>
      <section className="panel" aria-labelledby="metrics-h">
        <h2 id="metrics-h" style={{ marginTop: 0 }}>
          Operational Metrics
        </h2>
        <dl className="kv">
          {Object.entries(health.metrics).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v === null ? '-' : String(v)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
