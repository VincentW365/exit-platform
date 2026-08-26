'use client';

import { useEffect, useRef } from 'react';

/**
 * Section 18: what a rejected submit owes the reader.
 *
 * A redirect back to the form with a message at the top is only half an
 * error. A keyboard or screen-reader user is returned to the top of a
 * re-rendered document with nothing announced and nothing focused, so the
 * rejection is silent to them. This box takes focus when it appears and
 * says how many problems there are before listing them, which is the
 * difference between an error being reported and an error being noticed.
 */
export function ErrorSummary({ messages }: { messages: readonly string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = messages.join('|');

  useEffect(() => {
    box.current?.focus();
  }, [shown]);

  return (
    <div
      ref={box}
      className="error-summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby="err-heading"
    >
      <h2 id="err-heading">
        {messages.length === 1 ? 'There Is a Problem' : `There Are ${messages.length} Problems`}
      </h2>
      <ul>
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
