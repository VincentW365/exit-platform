'use client';

import { useEffect, useId, useState } from 'react';

/**
 * Change Recipient (DEC-069, directive sections 24 to 26).
 *
 * A searchable picker over people HR already knows - the case's own parties,
 * the configured groups and providers, and the directory - so an address is
 * never retyped when it already exists. "Enter another email" is there for
 * the genuine exception and is marked as a manual recipient. The choice
 * lands in hidden inputs for the server action; only masked addresses ever
 * reach this component.
 */
interface Choice {
  kind: 'DIRECTORY' | 'CONFIG' | 'CASE_PARTY';
  id: string;
  name: string;
  detail: string;
  mask: string;
}

export function RecipientPicker({
  caseId,
  recordId,
  action,
}: {
  caseId: string;
  recordId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [manual, setManual] = useState(false);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/cases/${caseId}/recipient-search?q=${encodeURIComponent(query)}`,
          { cache: 'no-store' },
        );
        const body = (await res.json()) as { choices?: Choice[] };
        if (!cancelled) setChoices(body.choices ?? []);
      } catch {
        if (!cancelled) setChoices([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [caseId, query]);

  return (
    <form action={action} className="stack recipient-picker">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="choiceKind" value={manual ? 'MANUAL' : (chosen?.kind ?? '')} />
      <input type="hidden" name="choiceId" value={manual ? '' : (chosen?.id ?? '')} />

      {!manual ? (
        <>
          <label className="field">
            <span className="field__label">Search known recipients</span>
            <input
              type="search"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, title, department, email or group"
              aria-controls={listId}
              autoComplete="off"
            />
          </label>
          <ul id={listId} className="recipient-picker__list" aria-label="Matching recipients">
            {loading && choices.length === 0 ? <li className="meta">Searching...</li> : null}
            {!loading && choices.length === 0 ? (
              <li className="meta">
                No known recipient matches. Try another spelling, or enter another email.
              </li>
            ) : null}
            {choices.map((c) => (
              <li key={`${c.kind}:${c.id}`}>
                <button
                  type="button"
                  className={`recipient-picker__choice${chosen?.id === c.id && chosen?.kind === c.kind ? ' is-chosen' : ''}`}
                  onClick={() => setChosen(c)}
                  aria-pressed={chosen?.id === c.id && chosen?.kind === c.kind}
                >
                  <span className="recipient-picker__name">{c.name}</span>
                  <span className="meta">
                    {c.detail}
                    {c.detail ? ' · ' : ''}
                    {c.mask}
                    {' · '}
                    {c.kind === 'CONFIG'
                      ? 'configured recipient'
                      : c.kind === 'CASE_PARTY'
                        ? 'on this case'
                        : 'directory'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="hint">
            <strong>Manual recipient.</strong> Use this only when the person is not in the directory
            or the configured recipients. The address is checked and shown before sending.
          </p>
          <label className="field">
            <span className="field__label">Recipient name</span>
            <input type="text" name="name" className="input" maxLength={120} required />
          </label>
          <label className="field">
            <span className="field__label">Email address</span>
            <input type="email" name="email" className="input" maxLength={254} required />
          </label>
          <label className="field">
            <span className="field__label">Organization (optional)</span>
            <input type="text" name="organization" className="input" maxLength={200} />
          </label>
        </>
      )}

      <label className="field">
        <span className="field__label">Reason (optional)</span>
        <input type="text" name="reason" className="input" maxLength={300} />
      </label>

      <div className="actions-row">
        <button type="submit" disabled={!manual && !chosen}>
          {manual ? 'Use this recipient' : chosen ? `Send to ${chosen.name}` : 'Choose a recipient'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setManual((m) => !m);
            setChosen(null);
          }}
        >
          {manual ? 'Search known recipients instead' : 'Enter another email'}
        </button>
      </div>
    </form>
  );
}
