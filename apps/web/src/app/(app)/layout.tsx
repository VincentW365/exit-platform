import Link from 'next/link';
import { cookies } from 'next/headers';
import { can } from '@exit/domain';
import { liveDirectoryPresence } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { logoutAction } from '@/app/signin/actions';
import { ActiveLink, BackButton, Breadcrumbs, MobileMenu } from '@/components/chrome';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ReactNode } from 'react';
import { roleList } from '@/lib/text';
import {
  AdminIcon,
  AlertIcon,
  AuditIcon,
  BookIcon,
  CasesIcon,
  ChartIcon,
  DirectoryIcon,
  DocumentIcon,
  HomeIcon,
  LifebuoyIcon,
  QueueIcon,
  ReportsIcon,
  ShieldIcon,
} from '@/components/icons';

/** Human role names for the topbar (correction 7); retired roles kept for safety. */

/** Two-letter monogram for the signed-in person's avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireAuth();
  const themeCookie = (await cookies()).get('exit_theme')?.value;
  const theme = themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : null;
  const liveDirectory = await liveDirectoryPresence().catch(() => ({ present: false, records: 0 }));

  // Small-team navigation: grouped sidebar. Users with Administration access
  // reach Templates, Workflows and Baseline through the hub; everyone else
  // keeps direct links (they cannot open /admin).
  const hasAdminHub = can(actor, 'admin.roles') || can(actor, 'admin.calendar');
  type Item = { href: string; label: string; icon: ReactNode };
  const work: Item[] = [{ href: '/', label: 'Exit Center', icon: <HomeIcon /> }];
  if (can(actor, 'case.list')) work.push({ href: '/cases', label: 'Cases', icon: <CasesIcon /> });
  if (can(actor, 'queue.view'))
    work.push({ href: '/queue', label: 'My Work', icon: <QueueIcon /> });
  if (can(actor, 'exceptions.viewFeed'))
    work.push({ href: '/exceptions', label: 'Exceptions', icon: <AlertIcon /> });

  const insight: Item[] = [];
  if (can(actor, 'employeeSource.search'))
    insight.push({ href: '/directory', label: 'Directory', icon: <DirectoryIcon /> });
  if (can(actor, 'reports.view'))
    insight.push({ href: '/reports', label: 'Reports', icon: <ReportsIcon /> });
  if (!hasAdminHub && can(actor, 'baseline.viewDashboard'))
    insight.push({ href: '/baseline', label: 'Baseline', icon: <ChartIcon /> });
  if (can(actor, 'audit.viewGlobal') || can(actor, 'audit.viewTechnical'))
    insight.push({ href: '/audit', label: 'Audit Center', icon: <AuditIcon /> });

  const manage: Item[] = [];
  if (!hasAdminHub && can(actor, 'template.view'))
    manage.push({ href: '/admin/templates', label: 'Templates', icon: <DocumentIcon /> });
  if (!hasAdminHub && can(actor, 'workflowDef.view'))
    manage.push({ href: '/admin/workflows', label: 'Workflows', icon: <ShieldIcon /> });
  if (hasAdminHub) manage.push({ href: '/admin', label: 'Administration', icon: <AdminIcon /> });

  const help: Item[] = [];
  if (can(actor, 'sop.view'))
    help.push({ href: '/operations', label: 'Operations', icon: <BookIcon /> });
  if (can(actor, 'support.use'))
    help.push({ href: '/support', label: 'Support', icon: <LifebuoyIcon /> });

  const groups = [
    { title: 'Work', items: work },
    { title: 'Insight', items: insight },
    { title: 'Manage', items: manage },
    { title: 'Help', items: help },
  ].filter((g) => g.items.length > 0);

  const nav = (label: string) => (
    <nav className="side-nav" aria-label={label}>
      {groups.map((g) => (
        <div key={g.title} className="side-nav__group">
          <p className="side-nav__title">{g.title}</p>
          {g.items.map((l) => (
            <ActiveLink key={l.href} href={l.href}>
              {l.icon}
              <span>{l.label}</span>
            </ActiveLink>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="sidebar__brand" href="/">
          <BrandMark />
          <span>Offboarding</span>
        </Link>
        {nav('Primary')}
      </aside>

      <div className="app-main">
        <p className="env-banner">
          UAT environment - simulated offboarding only - no live external side effects
        </p>
        {liveDirectory.present ? (
          <p className="env-banner env-banner--live" role="alert">
            LIVE HR DIRECTORY DATA — DO NOT USE REAL NAMES IN SHARED SCREENSHOTS OR EVIDENCE
          </p>
        ) : null}

        <header className="topbar">
          <MobileMenu>
            <Link className="sidebar__brand" href="/">
              <BrandMark />
              <span>Offboarding</span>
            </Link>
            {nav('Mobile')}
          </MobileMenu>
          <BackButton />
          <Breadcrumbs />
          {can(actor, 'case.list') ? (
            <form action="/cases" method="get" role="search" className="topbar__search">
              <label className="sr-only" htmlFor="topbar-q">
                Find a Case by Number or Employee
              </label>
              <input
                id="topbar-q"
                type="search"
                name="q"
                placeholder="Find case…"
                autoComplete="off"
              />
            </form>
          ) : null}
          <div className="topbar__user">
            <span className="avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <span className="topbar__identity">
              <strong>{user.displayName}</strong>
              <span className="topbar__roles">{roleList(user.roles)}</span>
            </span>
            <ThemeToggle initial={theme} />
            <form action={logoutAction}>
              <button type="submit" className="secondary compact">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main id="main">{children}</main>
      </div>
    </div>
  );
}
