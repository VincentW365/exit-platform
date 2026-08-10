import Link from 'next/link';
import { BRAND, can } from '@exit/domain';
import { liveDirectoryPresence } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { logoutAction } from '@/app/signin/actions';
import { ActiveLink, BackButton, Breadcrumbs, MobileMenu } from '@/components/chrome';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireAuth();
  const liveDirectory = await liveDirectoryPresence().catch(() => ({ present: false, records: 0 }));

  // Small-team navigation: grouped sidebar. Users with Administration access
  // reach Templates, Workflows and Baseline through the hub; everyone else
  // keeps direct links (they cannot open /admin).
  const hasAdminHub = can(actor, 'admin.roles') || can(actor, 'admin.calendar');
  type Item = { href: string; label: string };
  const work: Item[] = [{ href: '/', label: 'Dashboard' }];
  if (can(actor, 'case.list')) work.push({ href: '/cases', label: 'Cases' });
  if (can(actor, 'case.create')) work.push({ href: '/cases/new', label: 'New case' });
  if (can(actor, 'queue.view')) work.push({ href: '/queue', label: 'My queue' });
  if (can(actor, 'exceptions.viewFeed')) work.push({ href: '/exceptions', label: 'Exceptions' });

  const insight: Item[] = [];
  if (can(actor, 'employeeSource.search')) insight.push({ href: '/directory', label: 'Directory' });
  if (can(actor, 'reports.view')) insight.push({ href: '/reports', label: 'Reports' });
  if (!hasAdminHub && can(actor, 'baseline.viewDashboard'))
    insight.push({ href: '/baseline', label: 'Baseline' });
  if (can(actor, 'audit.viewGlobal')) insight.push({ href: '/audit', label: 'Audit feed' });

  const manage: Item[] = [];
  if (!hasAdminHub && can(actor, 'template.view'))
    manage.push({ href: '/admin/templates', label: 'Templates' });
  if (!hasAdminHub && can(actor, 'workflowDef.view'))
    manage.push({ href: '/admin/workflows', label: 'Workflows' });
  if (hasAdminHub) manage.push({ href: '/admin', label: 'Administration' });

  const help: Item[] = [];
  if (can(actor, 'sop.view')) help.push({ href: '/operations', label: 'Operations' });
  if (can(actor, 'support.use')) help.push({ href: '/support', label: 'Support' });

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
              {l.label}
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
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
          <img
            src={BRAND.logoWebPath}
            alt={BRAND.logoAlt}
            className="sidebar__logo"
            width={BRAND.logoWidth}
            height={BRAND.logoHeight}
          />
          <span>Offboarding</span>
        </Link>
        {nav('Primary')}
      </aside>

      <div className="app-main">
        <p className="env-banner">
          Stage 1 baseline capture - improvement automation disabled - synthetic data only
        </p>
        {liveDirectory.present ? (
          <p className="env-banner env-banner--live" role="alert">
            LIVE HR DIRECTORY DATA — DO NOT USE FOR SCREENSHOTS OR TEST EVIDENCE
          </p>
        ) : null}

        <header className="topbar">
          <MobileMenu>
            <Link className="sidebar__brand" href="/">
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
              <img
                src={BRAND.logoWebPath}
                alt={BRAND.logoAlt}
                className="sidebar__logo"
                width={BRAND.logoWidth}
                height={BRAND.logoHeight}
              />
              <span>Offboarding</span>
            </Link>
            {nav('Mobile')}
          </MobileMenu>
          <BackButton />
          <Breadcrumbs />
          <div className="topbar__user">
            <span className="topbar__identity">
              <strong>{user.displayName}</strong>
              <span className="topbar__roles">{user.roles.join(', ') || 'no role'}</span>
            </span>
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
