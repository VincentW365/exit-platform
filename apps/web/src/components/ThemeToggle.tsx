'use client';

import { useState, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const query = '(prefers-color-scheme: dark)';
const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};
const systemPrefersDark = () => window.matchMedia(query).matches;

/**
 * Light/dark switch. The chosen theme is stamped on <html data-theme> (the
 * root layout re-stamps it server-side from the preference cookie so there is
 * no flash on navigation). With no stored choice the system preference
 * applies via prefers-color-scheme; the first click simply makes the choice
 * explicit.
 */
export function ThemeToggle({ initial }: { initial: Theme | null }) {
  const [choice, setChoice] = useState<Theme | null>(initial);
  const systemDark = useSyncExternalStore(subscribe, systemPrefersDark, () => false);
  const theme: Theme = choice ?? (systemDark ? 'dark' : 'light');
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="secondary compact theme-toggle"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        // Preference only - not sensitive, readable by the server layout.
        document.cookie = `exit_theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setChoice(next);
      }}
    >
      {next === 'dark' ? 'Dark mode' : 'Light mode'}
    </button>
  );
}
