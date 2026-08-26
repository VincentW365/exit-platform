import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, trainingStatus } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { recordTrainingAction } from './actions';

export const metadata: Metadata = { title: 'Operations and Training Center' };
export const dynamic = 'force-dynamic';

/** Directive 4 section S: SOP centre with role guides and training mode. */
const SOPS: ReadonlyArray<{ module: string; title: string; audience: string; summary: string[] }> =
  [
    {
      module: 'hr-offboarding-sop',
      title: 'HR offboarding SOP',
      audience: 'HR Officer / HR Manager',
      summary: [
        'Create the case within one business day of receipt; verify evidence and dates.',
        'Route: submit -> HR Manager approval (snapshot captured) -> activate the workflow from the preview.',
        'Work the HR queue; documents and the action form are controlled records with approvals.',
        'Clearance: every gate must pass; HR Manager approves the final clearance.',
      ],
    },
    {
      module: 'it-access-removal',
      title: 'IT access removal',
      audience: 'HR (IT acts by email)',
      summary: [
        'The access-removal email is prepared and sent automatically, stating the EXACT effective time.',
        'IT confirms through the secure link in the email - no application account is needed.',
        'Delivery is never proof of removal: clearance needs confirmed completion, recorded evidence, or an approved exception.',
        'Unconfirmed at the effective time raises a CRITICAL exception; follow up and record what IT confirms.',
      ],
    },
    {
      module: 'finance-tasks',
      title: 'Finance notification',
      audience: 'HR (Finance acts by email)',
      summary: [
        'The Finance notification is prepared and sent automatically; Finance completes its process in its own systems.',
        'The platform records status only - it never calculates or changes pay.',
        'Record any acknowledgement or evidence Finance returns; asset outcomes never create payroll instructions.',
      ],
    },
    {
      module: 'asset-recovery',
      title: 'Asset-recovery procedure',
      audience: 'HR / asset owners',
      summary: [
        'Recovery items come from the issued-asset register; verify and add missing items.',
        'Every required item needs a final documented disposition; LOST/DAMAGED need reasons; WAIVED/WRITTEN_OFF need HR Manager.',
        'Documentation rate and physical recovery rate are separate measures.',
      ],
    },
    {
      module: 'survey-administration',
      title: 'Survey administration guide',
      audience: 'HR',
      summary: [
        'Invitations are due 3 days after separation; links are single-use and shown once.',
        'Terminations require an HR Manager reasoned override; completion is voluntary and never blocks clearance.',
        'Verbal debriefs are recorded as HR-captured responses.',
      ],
    },
    {
      module: 'notification-fallback',
      title: 'Notification-failure fallback',
      audience: 'HR / System administrator',
      summary: [
        'Failed dispatches appear in the outbox monitor and exception feed.',
        'Retry with a reason, or send manually through an approved channel and record the manual send.',
        'Dead-letter records require an authorized resolution note.',
      ],
    },
    {
      module: 'outage-manual-process',
      title: 'Outage / manual process',
      audience: 'All roles',
      summary: [
        'HR Manager or System Administrator declares the outage in the continuity center.',
        'Use sanitized blank forms with FB-references; reconcile every entry when service returns.',
        'Duplicates are prevented by one-time reconciliation of each reference.',
      ],
    },
    {
      module: 'privacy-access',
      title: 'Privacy and access guide',
      audience: 'All roles',
      summary: [
        'Access is least-privilege and record-level; restricted termination cases need explicit assignment.',
        'Survey answers, reason notes and rehire eligibility are restricted data.',
        'Holds suspend retention; disclosures are logged; privacy incidents go to Support.',
      ],
    },
    {
      module: 'administrator-guide',
      title: 'Administrator guide',
      audience: 'System administrator',
      summary: [
        'Technical configuration only - no HR case content access.',
        'Secrets are stored as REFERENCES; production fails closed on any development provider.',
        'Health, outbox, backups and access reviews live in the administration center.',
      ],
    },
    {
      module: 'support-escalation',
      title: 'Support escalation guide',
      audience: 'All roles',
      summary: [
        'Raise incidents/service requests in the Support area with SAFE descriptions (no personal data).',
        'CRITICAL security/privacy incidents escalate immediately to the System Administrator and HR Manager.',
        'Diagnostic bundles are PII-free: correlation IDs, versions, codes and states only.',
      ],
    },
  ];

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor, user } = await requireAuth();
  const sp = await searchParams;
  let completions: Awaited<ReturnType<typeof trainingStatus>> = [];
  try {
    completions = await trainingStatus(actor);
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  const done = new Set(completions.map((c) => c.module));

  return (
    <>
      <h1>Operations and Training</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Repository-controlled procedures (full runbooks in docs/operations). TRAINING mode: create
        cases with the TRAINING record purpose - they exercise the complete workflow and can never
        call live integrations. Recording completion is not formal certification.
      </p>
      <p>
        Quick links: <Link href="/queue">My queue</Link> -{' '}
        <Link href="/continuity">Continuity center</Link> - <Link href="/support">Support</Link> -{' '}
        <Link href="/cases/new">Start a TRAINING case</Link>
      </p>

      {SOPS.map((sop) => (
        <section className="panel" key={sop.module} aria-label={sop.title}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {sop.title} <span className="badge badge--neutral">{sop.audience}</span>{' '}
            {done.has(sop.module) ? (
              <span className="badge badge--success">Training recorded</span>
            ) : null}
          </h2>
          <ul>
            {sop.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {!done.has(sop.module) ? (
            <form action={recordTrainingAction}>
              <input type="hidden" name="module" value={sop.module} />
              <button type="submit" className="secondary">
                Record training completion ({user.roles[0] ?? 'no role'})
              </button>
            </form>
          ) : null}
        </section>
      ))}
    </>
  );
}
