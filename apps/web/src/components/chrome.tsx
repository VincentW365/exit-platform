'use client';

/**
 * Client-side application chrome: active-aware navigation links, the mobile
 * navigation drawer, breadcrumbs and a safe Back control. Pure presentation -
 * no data access and no authorization decisions happen here (the server
 * layout decides which links exist).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

export function ActiveLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className="nav-link" aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Hamburger + slide-in drawer for narrow viewports; closes on navigation. */
export function MobileMenu({ children }: { children: ReactNode }) {
  // The drawer is "open" only for the pathname it was opened on, so any
  // navigation closes it without needing an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openedAt === pathname;
  return (
    <div className="mobile-menu">
      <button
        type="button"
        className="mobile-menu__toggle"
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpenedAt(open ? null : pathname)}
      >
        <span aria-hidden="true">☰</span> Menu
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="mobile-menu__backdrop"
            aria-label="Close the menu"
            onClick={() => setOpenedAt(null)}
          />
          <div id="mobile-drawer" className="mobile-menu__drawer">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

const CRUMB_LABELS: Record<string, string> = {
  cases: 'Cases',
  new: 'New case',
  queue: 'My queue',
  exceptions: 'Exceptions',
  baseline: 'Baseline',
  reports: 'Reports',
  directory: 'Directory',
  admin: 'Administration',
  templates: 'Templates',
  workflows: 'Workflows',
  system: 'System',
  health: 'Health',
  outbox: 'Outbox',
  recipients: 'Recipients',
  reasons: 'Reasons',
  pilot: 'Pilot',
  privacy: 'Privacy',
  operations: 'Operations',
  support: 'Support',
  continuity: 'Continuity',
  audit: 'Audit',
  dev: 'Development',
  mailbox: 'Mailbox',
  documents: 'Documents',
  'action-form': 'Action form',
  workflow: 'Workflow',
  assets: 'Assets',
  handover: 'Handover',
  clearance: 'Clearance',
  survey: 'Exit survey',
  verbal: 'Verbal capture',
  tasks: 'Tasks',
};

/** Opaque database ids in the URL become a generic, readable label. */
function crumbLabel(segment: string, prev: string | undefined): string {
  const known = CRUMB_LABELS[segment];
  if (known) return known;
  if (/^[a-z0-9][a-z0-9-]{15,}$/i.test(segment)) {
    if (prev === 'cases') return 'Case';
    if (prev === 'tasks') return 'Task';
    return 'Detail';
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const crumbs = segments.map((seg, i) => ({
    href: `/${segments.slice(0, i + 1).join('/')}`,
    label: crumbLabel(seg, segments[i - 1]),
    last: i === segments.length - 1,
  }));
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        <li>
          <Link href="/">Home</Link>
        </li>
        {crumbs.map((c) => (
          <li key={c.href}>
            {c.last ? (
              <span aria-current="page">{c.label}</span>
            ) : (
              <Link href={c.href}>{c.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Safe "go back" that never strands the user: falls back to the dashboard. */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <button
      type="button"
      className="backlink"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
    >
      <span aria-hidden="true">←</span> Back
    </button>
  );
}
