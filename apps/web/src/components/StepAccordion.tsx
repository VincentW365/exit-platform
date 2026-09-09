'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The progressive step accordion (owner directive, 2026-08-27).
 *
 * A long intake form asks the reader to keep adding information. This asks
 * them to finish one decision at a time: complete a step, watch it resolve
 * into a one-line summary and move out of the way, and open the next one.
 * Nothing is hidden permanently - every settled step reopens from its own
 * header.
 *
 * Three rules shape the implementation:
 *
 * 1. COLLAPSING IS PRESENTATION ONLY. Every step's content stays mounted and
 *    every field keeps its value; a closed step is hidden with the `hidden`
 *    attribute, never unmounted. Collapsing must never cost a keystroke
 *    (directive section 10).
 *
 * 2. COMPLETION IS EARNED, NOT CLAIMED. A step resolves because its required
 *    fields actually hold values, re-checked on every edit - not because
 *    somebody pressed Continue. Empty a field on a settled step and it flips
 *    back to needing attention (sections 8 and 9). The server remains the
 *    authority on whether the case is valid; this is the reader's running
 *    account of where they are.
 *
 * 3. THE ACCORDION IS NOT A FORM. The first steps carry their own GET forms
 *    (choosing an employee, choosing a separation type), and a form cannot
 *    contain another. The fields of the later steps belong to one form
 *    rendered beside the accordion and joined to it by the HTML `form`
 *    attribute, which is how the rest of this application already associates
 *    a control with a distant form.
 */

export type StepState = 'upcoming' | 'active' | 'settled' | 'attention';

export interface StepSummaryField {
  /** Name of the form control whose value is summarized. */
  field: string;
  /** What to call it in the collapsed line. Omitted for a bare value. */
  label?: string;
  /** Values worth naming rather than printing raw ("true" -> "Yes"). */
  display?: Readonly<Record<string, string>>;
  /**
   * Render a date control's value as a date rather than as its raw
   * "2026-08-27T12:05" input format. The value is already a local wall
   * clock, so it is formatted from its own parts - no timezone maths, which
   * is what would introduce an off-by-one day.
   */
  as?: 'date' | 'datetime';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-27T12:05" -> "27 Aug 2026, 12:05 PM". Never re-zoned. */
function formatWallClock(raw: string, as: 'date' | 'datetime'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, hh, mm] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  const date = `${Number(d)} ${month} ${y}`;
  if (as === 'date' || hh === undefined || mm === undefined) return date;
  const hour = Number(hh);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${date}, ${twelve}:${mm} ${suffix}`;
}

export interface StepSpec {
  id: string;
  title: string;
  /** One line under the title while the step is open. */
  note?: string;
  /**
   * A step the SERVER already settled - choosing the employee, choosing the
   * separation type. It carries its own summary and needs no field check.
   */
  settledByServer?: boolean;
  /** Summary for a server-settled step. */
  staticSummary?: ReactNode;
  /** Field names that must hold a value for this step to be complete. */
  requiredFields?: readonly string[];
  /** What the collapsed line shows once the step is complete. */
  summaryFields?: readonly StepSummaryField[];
  /** The last step: it carries the real submit, so it has no forward button. */
  finalStep?: boolean;
  /**
   * Section 12: the review step restates what every earlier step decided,
   * each block with a way straight back to it. Rendered by the accordion
   * rather than by the page, because only the accordion can reopen a step.
   */
  reviewGroups?: readonly {
    /** The step this block summarizes, and which its Edit action opens. */
    stepId: string;
    heading: string;
    /** A line the server already knows - the employee, the separation type. */
    staticLines?: readonly string[];
  }[];
  content: ReactNode;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="step__chev" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.5 5 4.5-5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const STATE_WORD: Record<StepState, string> = {
  upcoming: 'Not started',
  active: 'In progress',
  settled: 'Complete',
  attention: 'Needs attention',
};

/** The value a named control currently holds, '' when absent or unchecked. */
function readField(form: HTMLFormElement | null, name: string): string {
  if (!form) return '';
  const el = form.elements.namedItem(name);
  if (!el) return '';
  if (typeof RadioNodeList !== 'undefined' && el instanceof RadioNodeList) return el.value ?? '';
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? el.value || 'on' : '';
    return el.value;
  }
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return el.value;
  return '';
}

export function StepAccordion({
  steps,
  formId,
}: {
  steps: readonly StepSpec[];
  /** The form whose controls the later steps contribute to. */
  formId: string;
}) {
  const baseId = useId();
  const headerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  const getForm = useCallback(
    () => (typeof document === 'undefined' ? null : document.forms.namedItem(formId)),
    [formId],
  );

  // Field values, re-read from the live form on every edit, so a step's
  // completion is a pure function of what is actually entered.
  const [values, setValues] = useState<Record<string, string>>({});
  const refresh = useCallback(() => {
    const form = getForm();
    if (!form) return;
    const next: Record<string, string> = {};
    for (const step of steps) {
      for (const name of step.requiredFields ?? []) next[name] = readField(form, name);
      for (const s of step.summaryFields ?? []) next[s.field] = readField(form, s.field);
    }
    setValues(next);
  }, [steps, getForm]);

  /** Steps the reader has finished with, so an emptied one can ask for help. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const complete = useMemo(() => {
    const done: Record<string, boolean> = {};
    for (const step of steps) {
      if (step.settledByServer !== undefined) {
        // The server decided this one - choosing an employee, choosing a
        // separation type. An unchosen step is not complete just because it
        // asks for nothing the client can measure.
        done[step.id] = step.settledByServer;
      } else if ((step.requiredFields ?? []).length > 0) {
        // Both halves matter: the profile prefills several of these fields,
        // and counting a step the reader has never opened would report
        // progress they have not made.
        done[step.id] =
          touched[step.id] === true &&
          step.requiredFields!.every((n) => (values[n] ?? '').trim() !== '');
      } else {
        // Nothing required: complete once the reader has been through it.
        done[step.id] = touched[step.id] === true;
      }
    }
    // The review step is finished when everything it reviews is.
    const finalStep = steps.find((s) => s.finalStep);
    if (finalStep) {
      done[finalStep.id] = steps.every((s) => s.finalStep || done[s.id]);
    }
    return done;
  }, [steps, values, touched]);

  // On arrival, the open step is the first one the reader has not been
  // through, which on a fresh page is the first one the server has not
  // already settled: returning to a partly-filled case should not mean
  // scrolling past what is done (directive section 11).
  //
  // Deliberately NOT "the first step whose fields are empty": several steps
  // arrive prefilled from the separation profile, and skipping them would
  // land the reader on Review having never seen the dates the case is about
  // to be created with.
  //
  // This is decided from the step list alone, so it is decided ONCE, on the
  // server, and the page arrives with that step already open. Deciding it
  // after hydration rendered every step hidden until JavaScript had run:
  // the first keystrokes of a reader who started typing at once went to a
  // field that was not there yet, and the search results a reader had just
  // asked for were invisible for the same beat (keyboard directive,
  // 2026-09-09, section 14).
  const [open, setOpen] = useState<string | null>(
    () => steps.find((s) => s.settledByServer !== true)?.id ?? steps[steps.length - 1]?.id ?? null,
  );

  // Seed the field values from the live form once the page has painted.
  useEffect(() => {
    // Read on the next frame rather than during the effect: the form this
    // reads lives outside the accordion, so it is only guaranteed to be in
    // the document once the whole page has painted.
    const frame = requestAnimationFrame(() => {
      // The form only exists once the earlier steps have been answered, so
      // its absence is normal.
      const form = getForm();
      if (!form) return;
      const seed: Record<string, string> = {};
      for (const step of steps) {
        for (const name of step.requiredFields ?? []) seed[name] = readField(form, name);
        for (const s of step.summaryFields ?? []) seed[s.field] = readField(form, s.field);
      }
      setValues(seed);
    });
    return () => cancelAnimationFrame(frame);
    // The step list is stable for the life of the page; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * What is TRUE of the step, independent of whether it happens to be open.
   * A step the reader has worked through that no longer holds what it needs
   * is not "not started" - it is asking for something back, and it says so
   * whether or not it is the step they are looking at.
   */
  const stateOf = (step: StepSpec): StepState => {
    if (complete[step.id]) return 'settled';
    return touched[step.id] ? 'attention' : 'upcoming';
  };

  const openStep = useCallback((id: string) => {
    setOpen(id);
    // Focus the header rather than the first field: it announces the step
    // and leaves the reader in control of where they type.
    requestAnimationFrame(() => {
      const header = headerRefs.current[id];
      header?.focus();
      header?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const advance = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step) return;
      // Native constraint validation first, so the browser reports a missing
      // or malformed field in its own words before anything collapses.
      const scope = rootRef.current?.querySelector<HTMLElement>(`[data-step="${step.id}"]`);
      // Only the controls that belong to the accordion's OWN form are this
      // step's business. A step can also host other forms - the employee
      // search, the manual directory entry, the separation-type choice -
      // and their required fields are theirs to enforce when THEY submit.
      // Validating them here surfaced "Please fill out this field" from an
      // empty manual-entry form nobody had opened (keyboard directive,
      // 2026-09-09, section 2).
      const own = getForm();
      for (const control of scope?.querySelectorAll<HTMLInputElement>('input, select, textarea') ??
        []) {
        if (control.form !== own) continue;
        if (!control.checkValidity()) {
          control.reportValidity();
          return;
        }
      }
      refresh();
      setTouched((t) => ({ ...t, [step.id]: true }));
      const next = steps[index + 1];
      if (next) openStep(next.id);
      else setOpen(null);
    },
    [steps, refresh, openStep, getForm],
  );

  const summaryFor = (step: StepSpec): ReactNode => {
    if (step.staticSummary) return <div className="step__summary">{step.staticSummary}</div>;
    const parts: { label?: string; shown: string }[] = [];
    for (const s of step.summaryFields ?? []) {
      const raw = (values[s.field] ?? '').trim();
      if (!raw) continue;
      const shown = s.display?.[raw] ?? (s.as ? formatWallClock(raw, s.as) : raw);
      parts.push({ label: s.label, shown });
    }
    if (parts.length === 0) return null;
    return (
      <span className="step__summary">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 ? <span className="sep">·</span> : null}
            {p.label ? <span className="label">{p.label}: </span> : null}
            {p.shown}
          </span>
        ))}
      </span>
    );
  };

  // Progress counts the steps that collect something; the review step is
  // the destination, not a sixth thing to fill in.
  const counted = steps.filter((s) => !s.finalStep);
  const settledCount = counted.filter((s) => complete[s.id]).length;
  const percent = counted.length === 0 ? 0 : Math.round((settledCount / counted.length) * 100);

  /**
   * Enter inside a field must not create the case.
   *
   * The step fields belong to the create form through their `form`
   * attribute, so a browser's implicit submission would run the real action
   * from any step - skipping every remaining step and the review. Enter now
   * does what the reader meant: finish this step and open the next.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // A textarea takes newlines, and a button press is already explicit.
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    // Enter means "submit the form that owns this field". Only fields of the
    // accordion's own create form are redirected to "finish this step"; a
    // field that belongs to another form - the employee search, the manual
    // directory entry, the separation-type choice - is left to the browser,
    // which submits THAT form. Intercepting those was the bug: Enter in the
    // search box never searched (keyboard directive, 2026-09-09, section 1).
    if (target.form !== getForm()) return;
    const stepId = target.closest<HTMLElement>('[data-step]')?.dataset.step;
    const index = steps.findIndex((s) => s.id === stepId);
    if (index < 0 || steps[index]!.finalStep) return;
    e.preventDefault();
    advance(index);
  };

  return (
    <div ref={rootRef} onInput={refresh} onChange={refresh} onKeyDown={onKeyDown}>
      <div className="step-progress">
        <span className="step-progress__text" role="status" aria-live="polite">
          {settledCount} of {counted.length} steps complete
        </span>
        <span className="step-progress__bar">
          <span
            className="progress-bar progress-bar--light"
            role="progressbar"
            aria-label="Case creation progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="progress-bar__fill" style={{ width: `${percent}%` }} />
          </span>
        </span>
      </div>

      <div className="steps">
        {steps.map((step, index) => {
          const state = stateOf(step);
          const isOpen = open === step.id;
          // "Active" is a second, additive class: where the reader is, on top
          // of what the step is.
          const className = `step step--${state}${isOpen ? ' step--active' : ''}`;
          const word = isOpen && state === 'upcoming' ? STATE_WORD.active : STATE_WORD[state];
          const headerId = `${baseId}-${step.id}-h`;
          const panelId = `${baseId}-${step.id}-p`;
          const summary = !isOpen ? summaryFor(step) : null;
          return (
            <section key={step.id} className={className}>
              <h2 style={{ margin: 0 }}>
                <button
                  type="button"
                  id={headerId}
                  ref={(el) => {
                    headerRefs.current[step.id] = el;
                  }}
                  className="step__header"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => (isOpen ? setOpen(null) : openStep(step.id))}
                >
                  <span className="step__mark">
                    {state === 'settled' ? <CheckIcon /> : state === 'attention' ? '!' : index + 1}
                  </span>
                  <span className="step__body">
                    <span className="step__title">{step.title}</span>
                    {isOpen && step.note ? <span className="step__note">{step.note}</span> : null}
                    {summary}
                  </span>
                  {/* The state is a WORD as well as a colour and a mark, so it
                      survives a monochrome screen (section 17). */}
                  <span className="step__state">
                    {word}
                    <Chevron />
                  </span>
                </button>
              </h2>
              <div
                id={panelId}
                role="region"
                aria-labelledby={headerId}
                className="step__content"
                data-step={step.id}
                hidden={!isOpen}
              >
                {step.reviewGroups ? (
                  <div className="review-groups">
                    {step.reviewGroups.map((group) => {
                      const source = steps.find((s) => s.id === group.stepId);
                      const lines = group.staticLines ?? [];
                      // A block states its lines OR the step's own summary,
                      // never both - the server-settled steps carry the same
                      // text in each and printed it twice.
                      const derived = lines.length === 0 && source ? summaryFor(source) : null;
                      const missing =
                        source && !complete[source.id] ? 'Still needs information' : null;
                      return (
                        <div key={group.stepId} className="review-group">
                          <div className="review-group__head">
                            <span className="label">{group.heading}</span>
                            <button
                              type="button"
                              className="secondary compact"
                              onClick={() => openStep(group.stepId)}
                            >
                              Edit
                            </button>
                          </div>
                          {lines.map((line) => (
                            <p key={line} className="review-group__line">
                              {line}
                            </p>
                          ))}
                          {derived ? <p className="review-group__line">{derived}</p> : null}
                          {missing ? (
                            <p className="review-group__line review-group__line--missing">
                              {missing}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* The content is built on the server and held in a variable
                    before it is handed over, so it arrives without the mark a
                    JSX child gets - and can arrive lazily, after this element
                    was created. Between siblings it would then be asked for a
                    key it cannot have; in a keyed slot of its own it is a sole
                    child and nothing asks. */}
                <React.Fragment key="content">{step.content}</React.Fragment>
                <div className="step__nav" hidden={step.finalStep && index === 0}>
                  {index > 0 ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openStep(steps[index - 1]!.id)}
                    >
                      Back
                    </button>
                  ) : null}
                  {!step.finalStep ? (
                    <button type="button" className="step__forward" onClick={() => advance(index)}>
                      Save &amp; continue
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
