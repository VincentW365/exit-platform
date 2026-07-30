import Link from 'next/link';
import { can } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { logoutAction } from '@/app/signin/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireAuth();

  const links: Array<{ href: string; label: string }> = [{ href: '/', label: 'Dashboard' }];
  if (can(actor, 'case.list')) links.push({ href: '/cases', label: 'Cases' });
  if (can(actor, 'case.create')) links.push({ href: '/cases/new', label: 'New case' });
  if (can(actor, 'queue.view')) links.push({ href: '/queue', label: 'My queue' });
  if (can(actor, 'exceptions.viewFeed')) links.push({ href: '/exceptions', label: 'Exceptions' });
  if (can(actor, 'baseline.viewDashboard')) links.push({ href: '/baseline', label: 'Baseline' });
  if (can(actor, 'template.view')) links.push({ href: '/admin/templates', label: 'Templates' });
  if (can(actor, 'workflowDef.view')) links.push({ href: '/admin/workflows', label: 'Workflows' });
  if (can(actor, 'audit.viewGlobal')) links.push({ href: '/audit', label: 'Audit feed' });
  if (can(actor, 'admin.roles') || can(actor, 'admin.calendar'))
    links.push({ href: '/admin', label: 'Administration' });

  return (
    <>
      <p className="env-banner">
        Stage 1 baseline capture - improvement automation disabled - synthetic data only
      </p>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="site-header__brand" href="/">
            Bert&apos;s Auto Parts - Offboarding
          </Link>
          <nav className="site-nav" aria-label="Primary">
            {links.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="site-header__user">
            <span>
              {user.displayName} ({user.roles.join(', ') || 'no role'})
            </span>
            <form action={logoutAction}>
              <button type="submit" className="secondary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
