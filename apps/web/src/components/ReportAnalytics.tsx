import { Kpi } from './patterns';

/**
 * Section 16: a report is a finding, not a grid.
 *
 * The reporting service returns columns and rows and nothing else - and that
 * is deliberate, because it is also what enforces small-group suppression,
 * aggregate-only access and the export audit. So the analytic presentation
 * is derived here from the shape of what came back, rather than by giving
 * each report a bespoke renderer that could drift from its own data.
 *
 * The table still follows underneath. The figures and the chart are a way
 * in; the table remains the record, and the accessible one - the chart is
 * presentational and is hidden from assistive technology precisely because
 * the same numbers sit beside it in a real table.
 */

type Cell = string | number | null;

/** A column of numbers, and what a total of it would actually mean. */
type NumericColumn = { index: number; name: string; values: number[]; kind: 'sum' | 'average' };

const AVERAGED = /%|\brate\b|\bdays?\b|\bhours?\b|\bminutes?\b|\btime\b|\bage\b|\bavg\b/i;

function numericColumns(columns: readonly string[], rows: readonly Cell[][]): NumericColumn[] {
  if (rows.length === 0) return [];
  return columns
    .map((name, index) => {
      const cells = rows.map((r) => r[index]);
      const values = cells.filter((v): v is number => typeof v === 'number');
      // Every populated cell has to be a number, or this is a mixed column
      // and any figure drawn from it would be a fiction.
      const populated = cells.filter((v) => v !== null && v !== '').length;
      if (values.length === 0 || values.length !== populated) return null;
      return {
        index,
        name,
        values,
        // Summing a percentage or a duration produces a number that means
        // nothing. Those are averaged and labelled as averages.
        kind: AVERAGED.test(name) ? ('average' as const) : ('sum' as const),
      };
    })
    .filter((c): c is NumericColumn => c !== null);
}

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ReportAnalytics({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly Cell[][];
}) {
  const numeric = numericColumns(columns, rows);
  if (rows.length === 0) return null;

  // A chart is only honest when one number varies across named groups. Two
  // measures on one axis, or no label to name a bar, and the table says it
  // better than a picture would.
  const labelColumns = columns.map((c, i) => i).filter((i) => !numeric.some((n) => n.index === i));
  const chartable =
    numeric.length === 1 && numeric[0]!.kind === 'sum' && labelColumns.length > 0 && rows.length > 1
      ? numeric[0]!
      : null;
  const max = chartable ? Math.max(...chartable.values) : 0;

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Rows" value={String(rows.length)} />
        {numeric.map((c) => {
          const total = c.values.reduce((a, b) => a + b, 0);
          return (
            <Kpi
              key={c.index}
              label={
                c.kind === 'sum'
                  ? `Total ${c.name.toLowerCase()}`
                  : `Average ${c.name.toLowerCase()}`
              }
              value={round(c.kind === 'sum' ? total : total / c.values.length)}
            />
          );
        })}
      </div>

      {chartable && max > 0 ? (
        <div
          className="chart"
          role="img"
          aria-label={`${chartable.name} by ${columns[labelColumns[0]!]}. The same figures are listed in the table below.`}
        >
          {rows.map((row, i) => {
            const value = row[chartable.index];
            if (typeof value !== 'number') return null;
            const label = labelColumns
              .map((j) => (row[j] === null ? '-' : String(row[j])))
              .join(' · ');
            return (
              <div className="chart__row" key={i}>
                <span className="chart__label" title={label}>
                  {label}
                </span>
                <span className="chart__track">
                  <span
                    className="chart__bar"
                    style={{ width: `${Math.max(1, (value / max) * 100)}%` }}
                  />
                </span>
                <span className="chart__value numeric">{value}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
