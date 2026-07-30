import type { Metadata } from 'next';
import { collectHealth } from '@exit/db';
import { can } from '@exit/domain';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Integration health' };
export const dynamic = 'force-dynamic';

/** Directive 4 V.5: administrator health dashboard - PII- and secret-free. */
export default async function HealthPage() {
  const { actor } = await requireAuth();
  if (!can(actor, 'health.view'))
    return <p className="panel">The health dashboard requires an authorized role.</p>;
  const health = await collectHealth();

  return (
    <>
      <h1>
        Integration and operational health{' '}
        <span className={`badge ${health.ok ? 'badge--success' : 'badge--danger'}`}>
          {health.ok ? 'HEALTHY' : 'ATTENTION'}
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
                {c.ok ? 'OK' : 'DOWN'}
              </span>{' '}
              <strong>{c.component}</strong> - {c.detail}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="metrics-h">
        <h2 id="metrics-h" style={{ marginTop: 0 }}>
          Operational metrics
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
