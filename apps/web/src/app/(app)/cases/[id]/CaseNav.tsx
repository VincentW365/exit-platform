import Link from 'next/link';
import { caseNavCounts } from '@exit/db';
import { requireAuth } from '@/lib/auth';

/**
 * Case-detail section navigation (Directive 2 section I).
 *
 * The tabs carry counts where a count answers a real question - how much is
 * still outstanding in that section - so a long case says where the work is
 * without opening every tab (owner redesign, section 26). A zero count shows
 * nothing at all: silence is the good news.
 */
export async function CaseNav({ caseId, active }: { caseId: string; active: string }) {
  const { actor } = await requireAuth();
  const counts = await caseNavCounts(actor, caseId).catch(() => null);

  const tabs: Array<{ href: string; key: string; label: string; count?: number; tone?: string }> = [
    { href: `/cases/${caseId}`, key: 'overview', label: 'Overview' },
    {
      href: `/cases/${caseId}/workflow`,
      key: 'workflow',
      label: 'Workflow',
      count: counts?.tasksOpen,
      tone: 'progress',
    },
    {
      href: `/cases/${caseId}/documents`,
      key: 'documents',
      label: 'Documents',
      count: counts?.documents,
      tone: 'neutral',
    },
    { href: `/cases/${caseId}/action-form`, key: 'action-form', label: 'Action Form' },
    {
      href: `/cases/${caseId}/notifications`,
      key: 'notifications',
      label: 'Email Actions',
      count: counts?.emailsPending,
      tone: 'pending',
    },
    {
      href: `/cases/${caseId}/assets`,
      key: 'assets',
      label: 'Assets',
      count: counts?.assetsOutstanding,
      tone: 'pending',
    },
    { href: `/cases/${caseId}/clearance`, key: 'clearance', label: 'Clearance' },
    { href: `/cases/${caseId}/survey`, key: 'survey', label: 'Exit Survey' },
    { href: `/cases/${caseId}#audit-h`, key: 'audit', label: 'Audit' },
  ];

  return (
    <nav aria-label="Case sections" className="case-tabs">
      <ul>
        {tabs.map((t) => (
          <li key={t.key}>
            <Link href={t.href} aria-current={active === t.key ? 'page' : undefined}>
              {t.label}
              {t.count ? (
                <span className={`tab-count tab-count--${t.tone ?? 'neutral'}`}>
                  {t.count}
                  {/* The number alone is ambiguous to a screen reader. */}
                  <span className="sr-only"> outstanding</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
