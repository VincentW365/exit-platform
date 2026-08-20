/**
 * Zero states (owner directive, 2026-08-19).
 *
 * A blank panel with "No data." tells someone nothing about whether the
 * platform is working, whether they lack access, or what to do next. Every
 * empty surface now says what would appear here, why it is empty when that is
 * knowable, and - where one exists - offers the action that fills it.
 *
 * The icon is decorative; the title and body carry the meaning.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export type EmptyTone = 'neutral' | 'done' | 'attention' | 'info';

export function EmptyState({
  icon,
  title,
  body,
  action,
  tone = 'neutral',
  inline = true,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: { href: string; label: string };
  tone?: EmptyTone;
  inline?: boolean;
}) {
  const toneClass =
    tone === 'done'
      ? 'icon-tile--done'
      : tone === 'attention'
        ? 'icon-tile--attention'
        : tone === 'info'
          ? 'icon-tile--info'
          : '';
  return (
    <div className={`empty-state${inline ? ' empty-state--inline' : ''}`} role="status">
      <span className={`icon-tile empty-state__icon ${toneClass}`.trim()}>{icon}</span>
      <p className="empty-state__title">{title}</p>
      {body ? <p className="empty-state__body">{body}</p> : null}
      {action ? (
        <Link className="button secondary empty-state__action" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
