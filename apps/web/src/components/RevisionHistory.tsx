import { formatInstant } from '@exit/domain';

/**
 * Version history of an editable document (DEC-069, directive section 4):
 * who did what to it and when, newest first, in the owner's words.
 */
export interface RevisionView {
  id: string;
  revision: number;
  kind: string;
  label: string;
  editedByName: string | null;
  editedAt: Date;
  note: string | null;
}

export function RevisionHistory({
  revisions,
  title = 'Version history',
  open = false,
}: {
  revisions: readonly RevisionView[];
  title?: string;
  open?: boolean;
}) {
  if (revisions.length === 0) return null;
  return (
    <details className="action revisions" open={open}>
      <summary>
        {title} ({revisions.length})
      </summary>
      <ol className="revisions__list" aria-label={title}>
        {revisions.map((r) => (
          <li key={r.id} className="revisions__item" data-kind={r.kind}>
            <span className="revisions__num">v{r.revision}</span>
            <span className="revisions__what">
              <strong>{r.label}</strong>
              {r.editedByName ? ` by ${r.editedByName}` : ''}
              {r.note ? <span className="meta"> - {r.note}</span> : null}
            </span>
            <span className="revisions__when meta">{formatInstant(r.editedAt)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
