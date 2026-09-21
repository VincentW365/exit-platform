'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * While a directory synchronization is queued or running, re-read the page
 * every few seconds so the administrator watches it progress without a
 * manual reload (owner directive, 2026-09-15, section 17). Stops on its own
 * once the run has finished - the server stops rendering this component.
 */
export function RefreshWatcher({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  if (!active) return null;
  return (
    <p className="hint" role="status" aria-live="polite">
      <span className="badge badge--info">In progress</span> Refreshing the employee directory from
      BambooHR… this page updates itself as the run proceeds.
    </p>
  );
}
