import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listSchedules, runReport, REPORT_CATALOG } from '@exit/db';
import { can, formatInstant, RECIPIENT_CLASSES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { createScheduleAction, toggleScheduleAction } from './actions';

export const metadata: Metadata = { title: 'Reporting centre' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  if (!can(actor, 'reports.view'))
    return <p className="panel">The reporting centre requires an authorized role.</p>;

  const selected = sp.report && REPORT_CATALOG.some((r) => r.key === sp.report) ? sp.report : null;
  let output: Awaited<ReturnType<typeof runReport>> | null = null;
  let reportError: string | null = null;
  if (selected) {
    try {
      output = await runReport(actor, selected, {
        recordPurpose: sp.purpose ?? 'OPERATIONAL',
        departureType: sp.departureType || undefined,
        department: sp.department || undefined,
      });
    } catch (e) {
      if (e instanceof ServiceError) reportError = e.details.join('; ') || e.message;
      else throw e;
    }
  }
  const schedules = can(actor, 'reports.view') ? await listSchedules(actor) : [];
  const canExport = can(actor, 'reports.export');
  const canSchedule = can(actor, 'reports.schedule');

  const families = [...new Set(REPORT_CATALOG.map((r) => r.family))];

  return (
    <>
      <h1>Reporting centre</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        TRAINING/TEST records are excluded by default; restricted cases never appear for
        unauthorized viewers or in totals; identifiable survey free text is never exported; small
        groups are suppressed; every export is audited.
      </p>

      <section className="panel" aria-labelledby="cat-h">
        <h2 id="cat-h" style={{ marginTop: 0 }}>
          Report catalogue
        </h2>
        {families.map((family) => (
          <div key={family}>
            <h3>{family}</h3>
            <ul>
              {REPORT_CATALOG.filter((r) => r.family === family).map((r) => (
                <li key={r.key}>
                  <Link href={`/reports?report=${r.key}`}>{r.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {reportError ? <p className="panel">Report unavailable: {reportError}</p> : null}
      {output ? (
        <section className="panel" aria-labelledby="out-h">
          <h2 id="out-h" style={{ marginTop: 0 }}>
            {output.title}
          </h2>
          {output.note ? <p className="hint">{output.note}</p> : null}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <caption className="visually-hidden">{output.title}</caption>
              <thead>
                <tr>
                  {output.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {output.rows.length === 0 ? (
                  <tr>
                    <td colSpan={output.columns.length}>No data for the selected filters.</td>
                  </tr>
                ) : (
                  output.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j}>{v === null ? '-' : String(v)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {canExport ? (
            <p>
              <a className="button secondary" href={`/api/reports/${output.key}/csv`}>
                Export CSV (audited)
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel" aria-labelledby="sch-h">
        <h2 id="sch-h" style={{ marginTop: 0 }}>
          Scheduled reports
        </h2>
        {schedules.length === 0 ? <p>No schedules.</p> : null}
        <ul>
          {schedules.map((s) => (
            <li key={s.id}>
              {s.name} ({s.reportKey}, {s.frequency}, to {s.recipientClass}){' '}
              <span className={`badge ${s.active ? 'badge--success' : 'badge--neutral'}`}>
                {s.active ? 'active' : 'paused'}
              </span>{' '}
              next {formatInstant(s.nextRunAt)}
              {s.lastRunAt ? ` - last ${formatInstant(s.lastRunAt)} (${s.lastStatus})` : ''}
              {canSchedule ? (
                <form action={toggleScheduleAction} style={{ display: 'inline-block' }}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={String(!s.active)} />
                  <button type="submit" className="secondary">
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canSchedule ? (
          <details className="action">
            <summary>Create a schedule</summary>
            <form action={createScheduleAction}>
              <label htmlFor="sr-key">Report</label>
              <select id="sr-key" name="reportKey" required>
                {REPORT_CATALOG.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.title}
                  </option>
                ))}
              </select>
              <label htmlFor="sr-name">Name</label>
              <input id="sr-name" name="name" required maxLength={200} />
              <label htmlFor="sr-freq">Frequency</label>
              <select id="sr-freq" name="frequency" required>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <label htmlFor="sr-rec">Recipient class</label>
              <select id="sr-rec" name="recipientClass" required>
                {RECIPIENT_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="hint">
                No live email: development runs generate the report, store it privately and capture
                it in the development mailbox. Schedules inherit reporting authorization and
                suppression.
              </p>
              <button type="submit">Create schedule</button>
            </form>
          </details>
        ) : null}
      </section>
    </>
  );
}
