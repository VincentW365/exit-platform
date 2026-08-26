'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Section 19: a short, high-risk confirmation.
 *
 * The platform's destructive actions - cancelling a case, voiding a document
 * or a form, revoking a role, dropping the directory cache - were reachable
 * behind a disclosure triangle with nothing between the click and the
 * consequence except a reason box. A reason box asks why; it never says what
 * is about to happen.
 *
 * This is a native <dialog> opened with showModal(), so focus containment,
 * Escape, the backdrop and the inert background all come from the platform
 * rather than from us re-implementing them imperfectly. It states the
 * consequence in the reader's language, then hands them the real form - the
 * server action is unchanged, and the server remains the only authority on
 * whether the action is allowed.
 *
 * Used only where the design system permits a modal: short, high-risk
 * confirmations. Anything longer stays on the page.
 */
export function ConfirmDialog({
  trigger,
  triggerClassName = 'danger',
  title,
  consequence,
  children,
}: {
  /** The button that opens the dialog. */
  trigger: string;
  triggerClassName?: string;
  title: string;
  /** What this will do, in the reader's terms. One line per effect. */
  consequence: readonly string[];
  /** The real form, including its reason field and submit button. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  // A dialog left open across a navigation would strand the reader behind a
  // backdrop with no page under it.
  useEffect(() => {
    const el = ref.current;
    return () => el?.close();
  }, []);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog ref={ref} className="dialog" aria-labelledby={headingId}>
        <div className="dialog__head">
          <h2 id={headingId} className="dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="dialog__close"
            onClick={() => ref.current?.close()}
            aria-label="Close without doing anything"
          >
            &#215;
          </button>
        </div>
        <ul className="dialog__consequence">
          {consequence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="dialog__body">{children}</div>
        <div className="dialog__foot">
          <button type="button" className="secondary" onClick={() => ref.current?.close()}>
            Leave it as it is
          </button>
        </div>
      </dialog>
    </>
  );
}
