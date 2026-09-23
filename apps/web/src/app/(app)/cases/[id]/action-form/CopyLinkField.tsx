'use client';

import { useState } from 'react';

/**
 * Copy Signing Link (DEC-068, directive 2 section 6).
 *
 * The link is fetched on demand and copied whole. It is never put in the
 * address bar, a redirect, the browser history or a server request log - the
 * request that fetches it names only the signature request, and the link
 * exists only in this response and the clipboard.
 *
 * The whole URL is handled as one value: the platform never shows a token
 * separately from the address it belongs to. A browser that refuses the
 * clipboard still gets a selectable field, so the action never dead-ends.
 */
export function CopyLinkField({
  requestId,
  signerName,
}: {
  requestId: string;
  signerName: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'copied' | 'shown' | 'failed'>('idle');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const copy = async () => {
    setState('working');
    setError('');
    try {
      const response = await fetch(`/api/signatures/requests/${requestId}/link`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'The signing link could not be read.');
        setState('failed');
        return;
      }
      const { url: link } = (await response.json()) as { url: string };
      setUrl(link);
      try {
        await navigator.clipboard.writeText(link);
        setState('copied');
      } catch {
        // No clipboard permission: show the link so it can be selected.
        setState('shown');
      }
    } catch {
      setError('The signing link could not be read.');
      setState('failed');
    }
  };

  return (
    <div className="stack">
      <button
        type="button"
        className="secondary compact"
        onClick={copy}
        disabled={state === 'working'}
      >
        {state === 'working' ? 'Copying...' : 'Copy signing link'}
      </button>

      <p className="meta" aria-live="polite">
        {state === 'copied' ? `Signing link copied. Share it only with ${signerName}.` : null}
        {state === 'shown' ? 'Select the link below and copy it.' : null}
        {state === 'failed' ? error : null}
      </p>

      {state === 'shown' ? (
        <label className="field">
          <span className="sr-only">Signing link</span>
          <input
            type="text"
            className="input"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      ) : null}
    </div>
  );
}
