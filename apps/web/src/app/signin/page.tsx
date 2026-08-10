import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getConfig } from '@exit/config';
import { BRAND } from '@exit/domain';
import { listActiveUsers } from '@exit/db';
import { currentUser } from '@/lib/session';
import { Feedback } from '@/components/ui';
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

  return (
    <main id="main" style={{ maxWidth: '40rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img
        src={BRAND.logoWebPath}
        alt={BRAND.logoAlt}
        className="signin-logo"
        width={BRAND.logoWidth}
        height={BRAND.logoHeight}
      />
      <h1 style={{ textAlign: 'center' }}>Offboarding Platform - sign in</h1>
      <Feedback err={err} />
      {config.devLoginEnabled ? (
        <section className="panel" aria-labelledby="dev-login-h">
          <h2 id="dev-login-h">Development sign-in (synthetic users)</h2>
          <p className="hint">
            Non-production role switcher. Enabled because <code>NODE_ENV</code> is not production
            and <code>ALLOW_DEV_LOGIN=true</code>. All identities are fictional.
          </p>
          <DevUserList />
        </section>
      ) : (
        <section className="panel">
          <h2>Single sign-on is not configured</h2>
          <p>
            Production authentication uses the company identity provider once IT and Security
            approve it (decision DEC-021). No local password login exists. Contact IT for access.
          </p>
        </section>
      )}
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
      <h3 style={{ marginBottom: '0.4rem' }}>Daily operations</h3>
      <UserButtons users={daily} />
      <h3 style={{ marginBottom: '0.4rem' }}>Oversight (dual-hat roles, rarely needed)</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Privacy and audit oversight are separate roles, not separate hires: at pilot time they are
        assigned to existing team members alongside their main role.
      </p>
      <UserButtons users={oversight} />
    </>
  );
}

function UserButtons({
  users,
}: {
  users: ReadonlyArray<{ userId: string; displayName: string; roles: string[] }>;
}) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
      {users.map((u) => (
        <li key={u.userId} className="panel" style={{ margin: 0, padding: '0.6rem 1rem' }}>
          <form action={devLoginAction} className="actions-row" style={{ alignItems: 'center' }}>
            <input type="hidden" name="userId" value={u.userId} />
            <span style={{ flex: '1 1 14rem' }}>
              <strong>{u.displayName}</strong>
              <br />
              <span className="hint">{u.roles.join(', ') || 'no roles'}</span>
            </span>
            <button type="submit">Sign in as {u.displayName}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}
