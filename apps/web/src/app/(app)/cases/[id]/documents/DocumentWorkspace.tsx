import { segmentBody, PLACEHOLDER_LABELS, type DocumentFieldSnapshot } from '@exit/domain';
import { DocumentEditor, type EditorFact } from '@/components/DocumentEditor';
import { RevisionHistory, type RevisionView } from '@/components/RevisionHistory';
import { updateDraftBodyAction } from './actions';

/**
 * The editing surface of a draft letter (DEC-069 sections 1 to 3): the
 * generated wording as readable paragraphs, with the case facts locked and
 * everything else HR's to change. Saving records a revision; the version
 * history sits underneath.
 */
export function DocumentWorkspace({
  caseId,
  docId,
  body,
  fieldSnapshot,
  revisions,
  editable,
}: {
  caseId: string;
  docId: string;
  /** The current wording, in the template's format (placeholders retained). */
  body: string;
  fieldSnapshot: DocumentFieldSnapshot;
  revisions: readonly RevisionView[];
  editable: boolean;
}) {
  const paragraphs = segmentBody(body);
  const facts: Record<string, EditorFact> = {};
  for (const segments of paragraphs)
    for (const s of segments)
      if (s.kind === 'fact' && !facts[s.placeholder])
        facts[s.placeholder] = {
          placeholder: s.placeholder,
          label: PLACEHOLDER_LABELS[s.placeholder],
          value:
            (fieldSnapshot as Record<string, string | undefined>)[s.placeholder] ??
            (s.placeholder === 'HR_APPROVER_NAME'
              ? '(signatory name - completed when finalized)'
              : s.placeholder === 'HR_APPROVER_TITLE'
                ? '(signatory title - completed when finalized)'
                : ''),
        };

  return (
    <div className="workspace">
      {editable ? (
        <details className="action" open>
          <summary>Edit wording</summary>
          <form action={updateDraftBodyAction} className="stack">
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="docId" value={docId} />
            <DocumentEditor name="body" paragraphs={paragraphs} facts={facts} initialBody={body} />
            <div className="actions-row">
              <button type="submit">Save wording</button>
              <span className="meta">
                Each save is kept as a version. Facts shown in a highlighted box come from the case;
                correct them on the case if they are wrong.
              </span>
            </div>
          </form>
        </details>
      ) : null}
      <RevisionHistory revisions={revisions} />
    </div>
  );
}
