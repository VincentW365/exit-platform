import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConfig } from '@exit/config';
import { listActiveUsers } from '@exit/db';
import { currentUser } from '@/lib/session';
import { BrandMark } from '@/components/BrandMark';
import {
  ArrowRightIcon,
  ClipboardIcon,
  DirectoryIcon,
  LockIcon,
  ShieldCheckIcon,
  ShieldIcon,
} from '@/components/icons';
import { Chip, initialsOf } from '@/components/patterns';
import { Feedback } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { devLoginAction } from './actions';
import { roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'Sign In' };
export const dynamic = 'force-dynamic';

/**
 * The environment in words. The page still says why the role switcher exists
 * (owner directive, 2026-09-02: never a quiet choice), but it says so without
 * printing variable names at the reader: a tester needs to know which site
 * this is, not how it is configured.
 */
const ENVIRONMENT_LABEL: Record<string, string> = {
  development: 'Development environment',
  test: 'Test environment',
  uat: 'UAT environment',
};

/**
 * What each function account is for, in one line (DEC-063: the HR Manager
 * owns oversight and administration, the HR Officer processes cases). The
 * account is named after its role, so repeating the role under the name said
 * nothing; this says what the role does instead.
 */
const ROLE_PURPOSE: Record<string, string> = {
  HR_MANAGER: 'Approves cases and final clearance, and administers the platform.',
  HR_OFFICER: 'Creates offboarding cases and runs them through to clearance.',
};

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
  const environment =
    ENVIRONMENT_LABEL[config.appEnvironment] ?? `${config.appEnvironment} environment`;

  return (
    <main id="main" className="signin">
      <section className="signin__brand" aria-label="About this system">
        <div className="signin__brand-body">
          <BrandMark size="lg" />
          <p className="signin__eyebrow">Human Resources</p>
          <p className="signin__product">Offboarding Platform</p>
          <p className="signin__tagline">
            Structured, auditable employee offboarding, from the resignation letter to final
            clearance.
          </p>
          <ul className="signin__points">
            <li>
              <ClipboardIcon />
              <span>
                <strong>Every step on record</strong> in a tamper-evident audit trail.
              </span>
            </li>
            <li>
              <ShieldCheckIcon />
              <span>
                <strong>Role-based access.</strong> Each person sees only their own work.
              </span>
            </li>
            <li>
              <DirectoryIcon />
              <span>
                <strong>Routed from the company directory</strong>, so the right people are asked.
              </span>
            </li>
          </ul>
        </div>
        <p className="signin__foot">
          <LockIcon />
          Internal system. Authorized use only.
        </p>
      </section>

      <section className="signin__panel" aria-label="Sign in">
        <div className="signin__panel-top">
          <ThemeToggle initial={theme} />
        </div>
        <div className="signin__card">
          <header className="signin__head">
            <h1>Sign In</h1>
            {config.devLoginEnabled ? <Chip tone="info">{environment}</Chip> : null}
          </header>
          <Feedback err={err} />
          {config.devLoginEnabled ? (
            <section aria-labelledby="dev-login-h">
              <h2 id="dev-login-h" className="signin__subhead">
                Choose the role you are testing as
              </h2>
              <p className="signin__lede">
                These accounts are synthetic and need no password. Each one opens the platform
                exactly as that role sees it.
              </p>
              {/* Exposing a passwordless switcher to the network is a
                  deliberate UAT choice (owner directive, 2026-09-02). It
                  must never be a quiet one: the page says so where the
                  buttons are, and the startup logs say so on the host. */}
              {config.lanExposed ? (
                <p className="signin__note" role="note">
                  <ShieldIcon />
                  <span>
                    <strong>Reachable from the network.</strong> This server accepts connections
                    from other workstations, and these buttons need no password. Only authorized
                    testers should have this address; the host’s firewall rule is the control.
                  </span>
                </p>
              ) : null}
              <DevUserList />
              <p className="signin__why">
                This switcher exists only because this is the {environment.toLowerCase()} and
                development sign-in is switched on. Production uses the company identity provider
                and never shows it.
              </p>
            </section>
          ) : (
            <section className="signin__notice" aria-labelledby="sso-h">
              <h2 id="sso-h" className="signin__subhead">
                Single sign-on is not configured
              </h2>
              <p className="signin__lede">
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

async function DevUserList() {
  const users = await listActiveUsers();
  // DEC-063: two-role model - the seed leaves exactly HR Manager and HR
  // Officer active. Directory-mapped real staff (identitySubject bamboo|...)
  // are grouped separately from the function-named accounts so automated
  // tests keep unambiguous function buttons. With no mapped staff there is
  // one list and no group heading to read past.
  const mapped = users.filter((u) => u.identitySubject.startsWith('bamboo|'));
  const functions = users.filter((u) => !mapped.includes(u));
  if (mapped.length === 0) return <UserButtons users={functions} label="Function accounts" />;
  return (
    <>
      <h3 className="signin__group-title">Function accounts</h3>
      <UserButtons users={functions} label="Function accounts" />
      <h3 className="signin__group-title">Directory-mapped staff</h3>
      <p className="signin__group-hint">
        Real colleagues mapped to their application responsibilities for live-data UAT. These
        accounts exist only in this environment.
      </p>
      <UserButtons users={mapped} label="Directory-mapped staff" mapped />
    </>
  );
}

/**
 * One row is one button: monogram, name, what the role does, and the action.
 * The accessible name stays exactly "Sign in as <name>" (the visually hidden
 * prefix plus the name); the purpose line is the button's description.
 */
function UserButtons({
  users,
  label,
  mapped = false,
}: {
  users: ReadonlyArray<{ userId: string; displayName: string; roles: string[] }>;
  label: string;
  mapped?: boolean;
}) {
  return (
    <ul className="signin__users" aria-label={label}>
      {users.map((u) => {
        const descId = `signin-desc-${u.userId}`;
        const purpose = mapped
          ? roleList(u.roles)
          : ((u.roles.length === 1 ? ROLE_PURPOSE[u.roles[0]!] : undefined) ?? roleList(u.roles));
        return (
          <li key={u.userId}>
            <form action={devLoginAction}>
              <input type="hidden" name="userId" value={u.userId} />
              <button type="submit" className="signin__choice" aria-describedby={descId}>
                <span className="signin__avatar" aria-hidden="true">
                  {initialsOf(u.displayName)}
                </span>
                <span className="signin__choice-text">
                  <span className="signin__choice-name">
                    <span className="sr-only">Sign in as </span>
                    {u.displayName}
                  </span>
                  <span className="signin__choice-desc" id={descId} aria-hidden="true">
                    {purpose}
                  </span>
                </span>
                <span className="signin__choice-cta" aria-hidden="true">
                  Sign in
                  <ArrowRightIcon />
                </span>
              </button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
