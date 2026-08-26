import type { ReactNode } from 'react';

/**
 * Section 18: the form vocabulary.
 *
 * Every form on this platform records a decision somebody is accountable
 * for, so a field has to say four things without being asked: what it is,
 * whether it must be answered, what shape the answer takes, and - when the
 * answer was rejected - why. These primitives make that consistent instead
 * of leaving each page to invent its own arrangement of label and hint.
 */

/**
 * A named part of a long form. A twenty-field form is not made shorter by
 * sectioning it, but it becomes a sequence of small decisions rather than
 * one wall, and the reader can tell where they are in it.
 */
export function FormSection({
  step,
  title,
  note,
  children,
}: {
  step?: number;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section__head">
        {step !== undefined ? (
          <span className="form-section__step" aria-hidden="true">
            {step}
          </span>
        ) : null}
        <h3 className="form-section__title">{title}</h3>
      </div>
      {note ? <p className="form-section__note">{note}</p> : null}
      {children}
    </section>
  );
}

/**
 * One labelled control. The hint is tied to the input with aria-describedby
 * so it is announced rather than merely printed near it, and an error - when
 * the server rejected this field by name - replaces the hint in that
 * description so the reader is told the problem, not the guidance they have
 * already failed to follow.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  optional,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Marks the label. The control's own `required` still does the enforcing. */
  required?: boolean;
  /** Says so explicitly where a reader would otherwise assume it is required. */
  optional?: boolean;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
        {required ? (
          <span className="req" aria-hidden="true">
            required
          </span>
        ) : optional ? (
          <span className="opt">optional</span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Two or three fields that are read together rather than one after another. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>;
}

/**
 * The end of a form: what the button will do, and what the reader should
 * know before pressing it. The note carries the consequence - "this is
 * recorded in the audit trail", "the employee is emailed" - because that
 * belongs beside the button, not three paragraphs above it.
 */
export function FormActions({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="form-actions">
      {children}
      {note ? <p className="form-actions__note">{note}</p> : null}
    </div>
  );
}
