import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConfig } from '@exit/config';
import { BRAND } from '@exit/domain';
import { listActiveUsers } from '@exit/db';
import { currentUser } from '@/lib/session';
import { Feedback } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { devLoginAction } from './actions';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await searchParams;
  if (await currentUser()) redirect('/');
  const config = getConfig();
  const themeCookie = (await cookies()).get('exit_theme')?.value;
  const theme = themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : null;

  return (
    <main id="main" className="signin">
      <section className="signin__brand" aria-label="About this system">
        <div>
          <span className="signin__logo-box">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
            <img
              src={BRAND.logoWebPath}
              alt={BRAND.logoAlt}
              className="signin-logo"
              width={BRAND.logoWidth}
              height={BRAND.logoHeight}
            />
          </span>
          <p className="signin__product">Offboarding Platform</p>
          <p className="signin__tagline">
            Structured, auditable employee offboarding for Bert&apos;s Auto Parts Ltd.
          </p>
          <ul className="signin__points">
            <li>Every step recorded in a tamper-evident audit trail</li>
            <li>Role-based access - each person sees only their work</li>
            <li>Organization-aware routing from the company directory</li>
          </ul>
        </div>
        <p className="signin__foot">Internal system - authorized use only</p>
      </section>

      <section className="signin__panel" aria-label="Sign in">
        <div className="signin__panel-top">
          <ThemeToggle initial={theme} />
        </div>
        <div className="signin__card">
          <h1>Sign in</h1>
          <Feedback err={err} />
          {config.devLoginEnabled ? (
            <section aria-labelledby="dev-login-h">
              <h2 id="dev-login-h" className="signin__subhead">
                UAT role switcher (no passwords)
              </h2>
              <p className="hint">
                Pick the function you are testing as. Accounts are synthetic and named by role; this
                switcher exists only because <code>NODE_ENV</code> is not production and{' '}
                <code>ALLOW_DEV_LOGIN=true</code>.
              </p>
              <DevUserList />
            </section>
          ) : (
            <section className="panel">
              <h2>Single sign-on is not configured</h2>
              <p>
                Production authentication uses the company identity provider once IT and Security
                approve it (decision DEC-021). No local password login exists. Contact IT for
                access.
              </p>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

const OVERSIGHT_ROLES = ['PRIVACY_OFFICER', 'AUDITOR'] as const;

async function DevUserList() {
  const users = await listActiveUsers();
  // Oversight accounts hold only oversight roles; in a small team these are
  // dual-hatted onto existing staff at pilot time (RolesAndPermissions.md).
  const oversight = users.filter(
    (u) =>
      u.roles.length > 0 &&
      u.roles.every((r) => (OVERSIGHT_ROLES as readonly string[]).includes(r)),
  );
  const daily = users.filter((u) => !oversight.includes(u));
  return (
    <>
      <h3 className="signin__group-title">Daily operations</h3>
      <UserButtons users={daily} />
      <h3 className="signin__group-title">Oversight (dual-hat roles, rarely needed)</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Privacy and audit oversight are separate roles, not separate hires: at pilot time they are
        assigned to existing team members alongside their main role.
      </p>
      <UserButtons users={oversight} />
    </>
  );
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function UserButtons({
  users,
}: {
  users: ReadonlyArray<{ userId: string; displayName: string; roles: string[] }>;
}) {
  return (
    <ul className="signin__users">
      {users.map((u) => (
        <li key={u.userId} className="signin__user">
          <form action={devLoginAction} className="signin__user-row">
            <input type="hidden" name="userId" value={u.userId} />
            <span className="signin__avatar" aria-hidden="true">
              {initials(u.displayName)}
            </span>
            <span className="signin__user-meta">
              <strong>{u.displayName}</strong>
              <span className="hint">{u.roles.join(', ') || 'no roles'}</span>
            </span>
            <button type="submit" className="compact">
              Sign in as {u.displayName}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
