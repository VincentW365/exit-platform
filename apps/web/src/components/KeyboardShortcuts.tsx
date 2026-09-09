'use client';

import { useEffect } from 'react';

/**
 * The platform's only application-wide shortcut (keyboard directive,
 * 2026-09-09, section 22): `/` puts the cursor in the case search, the way
 * it does on GitHub and most documentation sites.
 *
 * Deliberately just the one. It fires only when the reader is not already
 * typing somewhere, never with a modifier held, and never touches the
 * browser's own keys (section 23). Ctrl+S was considered and not added:
 * a case page carries several independent server-action forms, and
 * "save" would have to guess which one the reader meant.
 */
export function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      const box = document.getElementById('topbar-q');
      if (!(box instanceof HTMLInputElement)) return;
      e.preventDefault();
      box.focus();
      box.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return null;
}
