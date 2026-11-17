import Link from 'next/link';
import { Chip, SectionHead } from '@/components/patterns';
import { FlowIcon } from '@/components/icons';

/**
 * One offboarding from start to finish, as a stage-gated process map
 * (review recommendation, 2026-11-17: "a simplified step-by-step process
 * flow, comprehensive but simplified", in place of procedure text).
 *
 * The content is the approved HR-validated flow - the HR Daily Offboarding
 * Walkthrough (Directive 6.3), the single authorization gate (DEC-066) and
 * the owner's end-to-end testing flow - restated in HR's words. Each phase
 * carries who acts, what they do, what the platform does on its own, the
 * gate that ends it ("Done when") and the screen it happens on. Rules are
 * quoted, never invented here: a change to the process is a change to those
 * documents first.
 */
interface Phase {
  key: string;
  name: string;
  who: readonly string[];
  purpose: string;
  you: readonly string[];
  platform: readonly string[];
  gate: string;
  where: readonly { href: string; label: string }[];
}

const PHASES: readonly Phase[] = [
  {
    key: 'create',
    name: 'Create the case',
    who: ['HR Officer', 'HR Manager'],
    purpose: 'Record one separation from the directory record and the facts only HR knows.',
    you: [
      'Pick the employee from the directory by name, employee number, department or position. Nothing about the person is typed by hand.',
      'Enter the separation facts: departure type, when and how it was received, the last working day, whether a reason was given.',
      'Answer the benefits and providers questions, attach the resignation letter if there is one, create the draft and submit it for review.',
    ],
    platform: [
      'Fills identity, position, department, location and manager from BambooHR and keeps a snapshot of what was used.',
      'Sets the exact end-of-business time from the last working day (DEC-064).',
      'Notices a second live case for the same employee and asks you to confirm it is a separate event (DEC-061).',
    ],
    gate: 'the case reads "Awaiting approval".',
    where: [{ href: '/cases/new', label: 'Cases → New case' }],
  },
  {
    key: 'approve',
    name: 'Review and approve, once',
    who: ['HR Manager'],
    purpose: 'One decision authorizes the whole plan; nothing downstream needs a second approval.',
    you: [
      'Open Review and approve: the summary shows the employee record, exit details, who will be contacted and where, the documents and forms to come, and the workflow.',
      'Approve once, or return the case to draft with a reason the officer reads.',
      'Assign the HR Officer where the case was created unassigned, and confirm the derived line manager or override with a reason.',
    ],
    platform: [
      'Freezes the employee snapshot and authorizes the assigned officer for every downstream step (DEC-066).',
      'Activates the workflow and derives every required action from the facts; each item says why it exists.',
    ],
    gate: 'the case is Active and the Required actions panel is populated.',
    where: [{ href: '/cases', label: 'the case → Review and approve, then Assignment' }],
  },
  {
    key: 'execute',
    name: 'Execute the plan: work exceptions only',
    who: ['HR Officer'],
    purpose: 'The routine happens on its own; your work is the items that need a decision.',
    you: [
      'Treat "Requires your attention" on the case Overview as the whole to-do list; everything below it is progressing automatically.',
      'Confirm benefits (group health, group life, other provider) if still Unknown, enter a recipient where one is required, and release provider notices after your review.',
      'Draft the acceptance letter, validate and finalize it (attested), and send it. Complete the pre-filled Action Form.',
      'Record each asset return or decision: lost and damaged need a reason; waivers and write-offs need the HR Manager. Nothing here touches pay.',
    ],
    platform: [
      'Sends the IT access-removal email with the exact effective time and the Finance notice automatically, and tells the line manager who is leaving and what is expected of them.',
      'Tracks confirmations through secure links; no account is needed. If IT has not confirmed by the effective time, it raises a CRITICAL item: an email sent is never proof access was removed.',
      'Re-derives when the facts change, marks superseded items and deletes nothing. Every automatic step lands in the audit trail.',
    ],
    gate: 'nothing is left under "Requires your attention".',
    where: [
      { href: '/queue', label: 'My queue' },
      {
        href: '/cases',
        label: 'the case: Overview, Email actions, Documents, Action Form, Assets',
      },
    ],
  },
  {
    key: 'clear',
    name: 'Clearance',
    who: ['HR Officer', 'HR Manager'],
    purpose:
      'Every condition is shown; the HR Manager completes the case against exactly what was cleared.',
    you: [
      'Read the clearance summary: conditions grouped by area, unresolved items first. Resolve each one, or record an approved exception with its reason.',
      'The HR Officer requests clearance; the HR Manager approves the final clearance.',
    ],
    platform: [
      'Counts IT as ready only with confirmed completion or an approved exception, Finance once its notice went out, providers once sent where applicable; an unanswered benefit question blocks.',
      'Binds the approval to a checksummed snapshot of what was cleared.',
    ],
    gate: 'the case is Completed.',
    where: [{ href: '/cases', label: 'the case → Clearance' }],
  },
  {
    key: 'after',
    name: 'Afterwards',
    who: ['Automatic', 'HR Manager'],
    purpose: 'The record stays complete and replayable; the survey runs itself.',
    you: [
      'Nothing routine. Read the Audit tab when asked how something happened; record a verbal debrief as an HR-captured response if the employee prefers one.',
      'Reopen with a reason if something must change after completion; place a hold with a reason and a review date if a case must pause.',
    ],
    platform: [
      'Schedules the exit survey for eligible departures (invitation on day 3, reminder on day 7). Terminations need an HR Manager decision; the survey never delays clearance.',
      'Keeps the full trail, applies retention and honours holds.',
    ],
    gate: 'the retention period for the record has run.',
    where: [
      { href: '/audit', label: 'Audit centre' },
      { href: '/reports', label: 'Reports' },
    ],
  },
];

const TROUBLE: readonly { when: string; then: string }[] = [
  {
    when: 'An email could not be sent',
    then: 'it appears on the attention list with the reason. Fix the cause, usually the recipient or the template, and it retries; or record a manual send.',
  },
  {
    when: 'A confirmation link expired',
    then: 're-sending issues a fresh link; the old one is dead the moment it expires.',
  },
  {
    when: 'A derived item is wrong for this case',
    then: 'override it with a reason. The override wins until removed and is audited.',
  },
  {
    when: 'The facts change',
    then: 'the platform re-derives. Superseded items are marked, nothing is silently deleted, and a completed Action Form is superseded with a fresh one.',
  },
  {
    when: 'The platform is unavailable',
    then: 'the HR Manager declares an outage in the Continuity centre; work continues on sanitized forms and is reconciled when service returns.',
  },
];

export function ProcessFlow() {
  return (
    <section className="panel" aria-labelledby="flow-h">
      <SectionHead
        id="flow-h"
        icon={<FlowIcon />}
        title="How an offboarding runs"
        description="Five phases, each closed by a gate. The platform does the routine work; HR reviews, decides the exceptions and keeps control."
      />

      <ol className="process-strip" aria-label="The five phases at a glance">
        {PHASES.map((p) => (
          <li key={p.key}>
            <span className="process-strip__name">{p.name}</span>
            <span className="process-strip__who">{p.who.join(' · ')}</span>
          </li>
        ))}
      </ol>

      <ol className="process-map">
        {PHASES.map((p) => (
          <li key={p.key}>
            <article aria-labelledby={`phase-${p.key}`}>
              <div className="process-map__head">
                <h3 id={`phase-${p.key}`} className="process-map__title">
                  {p.name}
                </h3>
                {p.who.map((w) => (
                  <Chip key={w} tone={w === 'Automatic' ? 'progress' : 'neutral'}>
                    {w}
                  </Chip>
                ))}
              </div>
              <p className="process-map__purpose">{p.purpose}</p>
              <p className="process-map__gate">
                <strong>Done when</strong> {p.gate}
              </p>
              <details className="process-map__detail">
                <summary>Show the steps</summary>
                <div className="process-map__cols">
                  <div>
                    <h4>What you do</h4>
                    <ul>
                      {p.you.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>What the platform does</h4>
                    <ul>
                      {p.platform.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="process-map__where">
                  <strong>Where:</strong>{' '}
                  {p.where.map((w, i) => (
                    <span key={w.href + w.label}>
                      {i > 0 ? ' · ' : ''}
                      <Link href={w.href}>{w.label}</Link>
                    </span>
                  ))}
                </p>
              </details>
            </article>
          </li>
        ))}
      </ol>

      <section className="process-trouble" aria-labelledby="trouble-h">
        <h3 id="trouble-h">When something goes wrong</h3>
        <dl>
          {TROUBLE.map((t) => (
            <div key={t.when}>
              <dt>{t.when}</dt>
              <dd>{t.then}</dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  );
}
