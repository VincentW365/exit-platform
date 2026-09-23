'use client';

import { useMemo, useState } from 'react';
import { SignaturePad, type SignatureMode } from './SignaturePad';

/**
 * The signing experience on the public page (DEC-068, directive 1 sections 7,
 * 14 to 16).
 *
 * Three things it is responsible for beyond collecting marks:
 *
 *  - the signer reads the form BEFORE any pad is reachable, so signing is a
 *    deliberate act rather than the first thing on the screen;
 *  - initials are drawn once and applied to the remaining places in one tap,
 *    while each placement is still recorded individually;
 *  - the declaration is an explicit tick, and submission is refused until
 *    every required mark and the declaration are present, with the reasons
 *    named rather than a disabled button that explains nothing.
 */

export interface SigningBlock {
  key: string;
  label: string;
  type: SignatureMode;
  applied: boolean;
}

interface Mark {
  dataUrl: string;
  provenance: 'DRAWN' | 'TYPED';
}

export function SigningForm({
  token,
  blocks,
  consentText,
  reviewText,
  action,
  children,
}: {
  token: string;
  blocks: readonly SigningBlock[];
  consentText: string;
  reviewText: string;
  action: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [reviewed, setReviewed] = useState(false);
  const [consented, setConsented] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const initialsBlocks = useMemo(() => blocks.filter((b) => b.type === 'INITIALS'), [blocks]);
  const signatureBlocks = useMemo(() => blocks.filter((b) => b.type === 'SIGNATURE'), [blocks]);

  const setMark = (key: string) => (dataUrl: string, provenance: 'DRAWN' | 'TYPED') =>
    setMarks((prev) => {
      const next = { ...prev };
      if (dataUrl === '') delete next[key];
      else next[key] = { dataUrl, provenance };
      return next;
    });

  /** Directive 1 section 7: draw once, place everywhere, record each place. */
  const applyInitialsEverywhere = (dataUrl: string) =>
    setMarks((prev) => {
      const next = { ...prev };
      for (const b of initialsBlocks) next[b.key] = { dataUrl, provenance: 'DRAWN' };
      return next;
    });

  const firstInitials = initialsBlocks.find((b) => marks[b.key])?.key ?? null;
  const missing = blocks.filter((b) => !marks[b.key]);
  const problems = [
    ...(reviewed ? [] : ['Confirm that you have reviewed the information above.']),
    ...missing.map(
      (b) =>
        `${b.type === 'INITIALS' ? 'Initials are' : 'A signature is'} needed for "${b.label}".`,
    ),
    ...(consented ? [] : ['Tick the declaration before submitting.']),
  ];

  return (
    <form
      action={action}
      onSubmit={(e) => {
        setAttempted(true);
        if (problems.length > 0) {
          e.preventDefault();
          return;
        }
        setSubmitting(true);
      }}
      noValidate
    >
      <input type="hidden" name="token" value={token} />
      <input
        type="hidden"
        name="marks"
        value={JSON.stringify(
          blocks
            .filter((b) => marks[b.key])
            .map((b) => ({
              blockKey: b.key,
              dataUrl: marks[b.key]!.dataUrl,
              provenance: marks[b.key]!.provenance,
            })),
        )}
      />

      <section className="signing__review" aria-labelledby="review-heading">
        <h2 id="review-heading">1. Review your details</h2>
        {children}
        <label className="check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          <span>{reviewText}</span>
        </label>
      </section>

      {initialsBlocks.length > 0 ? (
        <section className="signing__marks" aria-labelledby="initials-heading">
          <h2 id="initials-heading">2. Add your initials</h2>
          <p className="hint">
            Draw your initials once. You can then place the same initials in the remaining sections
            without drawing them again.
          </p>
          {initialsBlocks.map((b) => (
            <SignaturePad
              key={b.key}
              mode="INITIALS"
              label={b.label}
              value={marks[b.key]?.dataUrl ?? ''}
              onChange={setMark(b.key)}
              onOfferReuse={
                b.key === firstInitials && initialsBlocks.length > 1
                  ? applyInitialsEverywhere
                  : null
              }
              onReuseOffer={
                firstInitials && b.key !== firstInitials
                  ? {
                      label: 'Apply these initials',
                      onApply: () => {
                        const source = marks[firstInitials];
                        if (source) setMarks((prev) => ({ ...prev, [b.key]: source }));
                      },
                    }
                  : null
              }
            />
          ))}
        </section>
      ) : null}

      {signatureBlocks.length > 0 ? (
        <section className="signing__marks" aria-labelledby="signature-heading">
          <h2 id="signature-heading">{initialsBlocks.length > 0 ? '3.' : '2.'} Sign the form</h2>
          {signatureBlocks.map((b) => (
            <SignaturePad
              key={b.key}
              mode="SIGNATURE"
              label={b.label}
              value={marks[b.key]?.dataUrl ?? ''}
              onChange={setMark(b.key)}
            />
          ))}
        </section>
      ) : null}

      <section className="signing__consent" aria-labelledby="consent-heading">
        <h2 id="consent-heading">{initialsBlocks.length > 0 ? '4.' : '3.'} Confirm and submit</h2>
        <label className="check">
          <input
            type="checkbox"
            name="consent"
            value="yes"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <span>{consentText}</span>
        </label>

        {attempted && problems.length > 0 ? (
          <div className="alert alert--error" role="alert" aria-live="polite">
            <p>
              <strong>Before you submit</strong>
            </p>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit signed form'}
        </button>
        <p className="hint">
          Once you submit, the form is returned to Human Resources and this link stops working.
        </p>
      </section>
    </form>
  );
}
