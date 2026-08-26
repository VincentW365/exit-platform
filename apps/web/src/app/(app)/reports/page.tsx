import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listSchedules, runReport, REPORT_CATALOG } from '@exit/db';
import { can, formatInstant, RECIPIENT_CLASSES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { Chip, Row, Rows, SectionHead } from '@/components/patterns';
import { ChartIcon, ReportsIcon } from '@/components/icons';
import { countOf } from '@/lib/text';
import { createScheduleAction, toggleScheduleAction } from './actions';

export const metadata: Metadata = { title: 'Reporting Center' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  if (!can(actor, 'reports.view'))
    return (
      <>
        <h1>Access Restricted</h1>
        <p className="panel">The reporting center requires an authorized role.</p>
      </>
    );

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
      <h1 className="page-title">Reporting Center</h1>
      <p className="page-lede">
        How the offboarding process is actually performing - volumes, timeliness and outcomes, drawn
        from the same records the cases run on.
      </p>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        TRAINING/TEST records are excluded by default; restricted cases never appear for
        unauthorized viewers or in totals; identifiable survey free text is never exported; small
        groups are suppressed; every export is audited.
      </p>

      {/* The catalogue is a set of questions you can ask, grouped by subject -
          not a bulleted list of links. */}
      {families.map((family) => (
        <section key={family} aria-label={`${family} reports`}>
          <SectionHead icon={<ChartIcon />} tone="info" title={family} />
          <Rows label={`${family} reports`}>
            {REPORT_CATALOG.filter((r) => r.family === family).map((r) => (
              <Row
                key={r.key}
                mark={<ReportsIcon />}
                title={<Link href={`/reports?report=${r.key}`}>{r.title}</Link>}
                sub={selected === r.key ? 'Showing below' : undefined}
                tone={selected === r.key ? 'progress' : undefined}
              />
            ))}
          </Rows>
        </section>
      ))}

      {reportError ? <p className="panel">Report unavailable: {reportError}</p> : null}
      {output ? (
        <section className="panel" aria-labelledby="out-h">
          <SectionHead
            id="out-h"
            icon={<ChartIcon />}
            title={output.title}
            description={output.note ?? undefined}
            aside={<Chip tone="info">{countOf(output.rows.length, 'row')}</Chip>}
          />
          <div style={{ overflowX: 'auto' }} tabIndex={0}>
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
                    <td colSpan={output.columns.length} className="meta">
                      Nothing matches these filters. Widen the date range, or this measure genuinely
                      has no activity in the period.
                    </td>
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
          Scheduled Reports
        </h2>
        {schedules.length === 0 ? (
          <p className="meta">
            No scheduled reports. Schedule one below to have it delivered on a recurring basis.
          </p>
        ) : null}
        <ul>
          {schedules.map((s) => (
            <li key={s.id}>
              {s.name} ({s.reportKey}, {s.frequency}, to {s.recipientClass}){' '}
              <span className={`badge ${s.active ? 'badge--success' : 'badge--neutral'}`}>
                {s.active ? 'Active' : 'Paused'}
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
              <label htmlFor="sr-rec">Recipient Class</label>
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
