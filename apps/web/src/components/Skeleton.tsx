/**
 * Section 21: what the reader sees while the server is still answering.
 *
 * Every page here is server-rendered against the database, so a navigation
 * used to leave the previous screen sitting there until the new one was
 * ready - which reads as a click that did not register. These are the
 * placeholders Next streams in the meantime: the shape of the page that is
 * coming, not a spinner that says nothing about it.
 *
 * The whole block is aria-hidden with a single polite status beside it, so
 * a screen reader hears "Loading" once rather than being read a wireframe.
 */

export function SkeletonLine({ width = '100%' }: { width?: string }) {
  return <span className="skeleton skeleton--line" style={{ width }} />;
}

/** The stand-in for one entity row - mark, title, sub, facts. */
export function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <span className="skeleton skeleton--mark" />
      <div className="skeleton-row__text">
        <SkeletonLine width="38%" />
        <SkeletonLine width="62%" />
      </div>
      <SkeletonLine width="8rem" />
    </div>
  );
}

export function SkeletonPanel({ rows = 3 }: { rows?: number }) {
  return (
    <div className="panel">
      <SkeletonLine width="14rem" />
      <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: '0.6rem' }}>
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * A whole page's worth, under the page's real heading.
 *
 * The heading is NOT a placeholder. A loading state that withholds it leaves
 * the reader - and a screen reader - on a page that cannot say where it is,
 * and it breaks the invariant that every rendered page has a heading. So a
 * route only gets a skeleton when its title is known without fetching
 * anything; where the title is itself data (a case number, a person's name)
 * the page waits for the server instead.
 */
export function SkeletonPage({
  title,
  panels = 2,
  rows = 4,
}: {
  title: string;
  panels?: number;
  rows?: number;
}) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <p className="sr-only" role="status">
        Loading {title}
      </p>
      <div aria-hidden="true">
        {Array.from({ length: panels }, (_, i) => (
          <SkeletonPanel key={i} rows={rows} />
        ))}
      </div>
    </>
  );
}
