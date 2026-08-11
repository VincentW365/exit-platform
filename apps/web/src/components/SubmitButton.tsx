'use client';

/**
 * Server-action submit button with a pending state (Directive 6.1 AE):
 * disables on submit and shows a quiet progress label - no double submits,
 * no consumer-style animation.
 */
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
