'use client';

import { useEffect } from 'react';

/**
 * One submission per press (keyboard directive, 2026-09-09, section 25).
 *
 * Keyboard use makes a double submit easy: Enter twice on a button, or Enter
 * in a field while the previous request is still on its way. Every write on
 * this platform is a server action followed by a redirect, so the second
 * press lands on a form that is still on screen. This locks a form's submit
 * buttons the moment it submits and labels them as busy, and unlocks them
 * when the page comes back from the history cache. The server keeps its own
 * idempotency; this only stops the duplicate from being sent.
 *
 * It runs at document level so no form has to opt in, and it acts a tick
 * AFTER the submit event so the browser has already serialised the form -
 * a button disabled during submission would drop out of the form data.
 */
export function SubmitGuard() {
  useEffect(() => {
    const busy = new Set<HTMLButtonElement>();

    const buttonsOf = (form: HTMLFormElement): HTMLButtonElement[] => {
      const inside = Array.from(
        form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])'),
      );
      // A button may sit outside its form and point at it by id - the
      // accordion's "Create draft case" does exactly that.
      const outside = form.id
        ? Array.from(
            document.querySelectorAll<HTMLButtonElement>(`button[form="${CSS.escape(form.id)}"]`),
          )
        : [];
      return [...inside, ...outside];
    };

    const release = () => {
      for (const b of busy) {
        b.disabled = false;
        b.removeAttribute('aria-busy');
        if (b.dataset.idleLabel !== undefined) {
          b.textContent = b.dataset.idleLabel;
          delete b.dataset.idleLabel;
        }
      }
      busy.clear();
    };

    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      // Searches and filters navigate instantly and harmlessly; locking them
      // only makes a fast page feel slow.
      if (form.method.toLowerCase() === 'get') return;
      setTimeout(() => {
        for (const b of buttonsOf(form)) {
          if (b.disabled) continue;
          b.dataset.idleLabel = b.textContent ?? '';
          b.textContent = `${(b.textContent ?? '').replace(/…$/, '')}…`;
          b.setAttribute('aria-busy', 'true');
          b.disabled = true;
          busy.add(b);
        }
        // A failed action that never navigates must not leave the page dead.
        setTimeout(release, 20_000);
      }, 0);
    };

    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('pageshow', release);
    return () => {
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('pageshow', release);
      release();
    };
  }, []);
  return null;
}
