import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, trainingStatus } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { recordTrainingAction } from './actions';

export const metadata: Metadata = { title: 'Operations and training centre' };
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
      title: 'IT access-removal procedure',
      audience: 'IT responder',
      summary: [
        'Work from My queue; review systems early; the revocation task is due at the EXACT effective time.',
        'Never enter passwords, access codes, private keys or credentials in any field.',
        'Early completion needs a recorded authorized reason; partial completion opens a CRITICAL exception.',
        'During an outage, remove access manually at the exact time and record it on the fallback log.',
      ],
    },
    {
      module: 'finance-tasks',
      title: 'Finance task procedure',
      audience: 'Finance responder',
      summary: [
        'Acknowledge the case, then initiate and complete the final-pay workpaper OUTSIDE the application.',
        'The platform records status only - it never calculates or changes pay.',
        'Asset outcomes never create payroll instructions.',
      ],
    },
    {
      module: 'manager-handover',
      title: 'Line-manager handover guide',
      audience: 'Line manager',
      summary: [
        'Record duties, open work, locations and the replacement owner in the handover record.',
        'Complete with attestation before the final working day where notice permits.',
        'Never record credentials; the form rejects likely secrets.',
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
        'HR Manager or System Administrator declares the outage in the continuity centre.',
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
        'Health, outbox, backups and access reviews live in the administration centre.',
      ],
    },
    {
      module: 'support-escalation',
      title: 'Support escalation guide',
      audience: 'All roles',
      summary: [
        'Raise incidents/service requests in the Support area with SAFE descriptions (no personal data).',
        'CRITICAL security/privacy incidents escalate immediately to the System Administrator and Privacy Officer.',
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
      <h1>Operations, SOPs and training</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Repository-controlled procedures (full runbooks in docs/operations). TRAINING mode: create
        cases with the TRAINING record purpose - they exercise the complete workflow and can never
        call live integrations. Recording completion is not formal certification.
      </p>
      <p>
        Quick links: <Link href="/queue">My queue</Link> -{' '}
        <Link href="/continuity">Continuity centre</Link> - <Link href="/support">Support</Link> -{' '}
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
