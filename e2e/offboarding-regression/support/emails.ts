/**
 * Email evidence (directive sections 20-24): every notification record on
 * the case becomes an .eml plus a JSON sidecar, and a routing.md that puts
 * intended and actual recipients side by side.
 *
 * The .eml is reconstructed from the platform's own records - the captured
 * subject and body, the outbox row's intended/actual masks and test-mode
 * flag - because the development capture adapter stores exactly that and no
 * MIME. The body is the outgoing body: it already carries the redirect
 * banner with the intended recipients in full, and the acknowledgement link
 * (redacted here). Nothing is invented.
 */
import type { CaseSnapshot } from './db';
import type { EmailEvidence, ScenarioEvidence } from './evidence';
import { EMAIL_LABELS, type TypeExpectation } from './expectations';
import { wallClock } from './dates';

function parseIntercept(body: string): { to: string; cc: string[] } {
  // The redirect banner lists the intended recipients in full.
  const to = /^\s*(?:Intended )?To:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
  const ccLine = /^\s*(?:Intended )?Cc:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
  const cc = ccLine ? ccLine.split(/[;,]\s*/).filter(Boolean) : [];
  return { to, cc };
}

function containsDate(body: string, isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  const shifted = new Date(d.getTime() - 5 * 3600_000);
  const day = shifted.getUTCDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const m = monthNames[shifted.getUTCMonth()]!;
  const iso = shifted.toISOString().slice(0, 10);
  const patterns = [
    iso,
    `${day} ${m} ${shifted.getUTCFullYear()}`,
    `${m} ${day}, ${shifted.getUTCFullYear()}`,
    `${m.slice(0, 3)} ${day}, ${shifted.getUTCFullYear()}`,
    `${day} ${m.slice(0, 3)} ${shifted.getUTCFullYear()}`,
    `${String(day).padStart(2, '0')}/${String(shifted.getUTCMonth() + 1).padStart(2, '0')}/${y}`,
  ];
  return patterns.some((p) => body.includes(p));
}

export interface EmailRecordingOptions {
  employee: string;
  expectation: TypeExpectation;
  caseNumber: string;
  testMailbox: string;
  /** Types whose sending is expected to be held until the effective instant. */
  heldTypes: string[];
}

export function recordEmails(
  ev: ScenarioEvidence,
  snap: CaseSnapshot,
  opts: EmailRecordingOptions,
): EmailEvidence[] {
  const out: EmailEvidence[] = [];
  const routing: string[] = [];
  routing.push(`# Routing evidence - ${opts.caseNumber}`);
  routing.push('');
  routing.push(
    `Environment: TEST / UAT (APP_ENVIRONMENT=test). Every message is redirected to the test mailbox`,
  );
  routing.push(
    `(${opts.testMailbox}) and captured by the development adapter; no message leaves the machine.`,
  );
  routing.push('');
  const c = snap.case as Record<string, unknown>;
  let index = 0;
  const sorted = [...snap.notifications].sort((a, b) =>
    String(a['createdAt']).localeCompare(String(b['createdAt'])),
  );
  for (const n of sorted) {
    index += 1;
    const type = n.notificationType;
    const label = EMAIL_LABELS[type] ?? type;
    const outbox = n.outbox[n.outbox.length - 1] as Record<string, unknown> | undefined;
    const capture = n.captures[n.captures.length - 1];
    const body = capture?.body ?? String(n['bodySnapshot'] ?? '');
    const subject = capture?.subject ?? String(n['subjectSnapshot'] ?? '');
    const intercept = parseIntercept(body);
    const intendedMask = String(outbox?.['intendedToMask'] ?? n['caseRecipientMask'] ?? '');
    const intendedTo =
      intercept.to || intendedMask || String(n['recipientName'] ?? '') || '(unresolved)';
    const intendedCc = intercept.cc.length
      ? intercept.cc
      : ((outbox?.['intendedCcMasks'] as string[] | undefined) ?? []);
    const actualTo = String(
      outbox?.['actualToMask'] ??
        outbox?.['destinationMask'] ??
        (capture ? opts.testMailbox : '(not dispatched)'),
    );
    const testMode = Boolean(outbox?.['wasTestMode']);
    const status = String(n.status);
    const deliveryStatus = outbox
      ? String(outbox['deliveryStatus'] ?? outbox['status'] ?? '')
      : null;
    const sentAt = n['sentAt'] ? wallClock(String(n['sentAt'])) : null;
    const scheduledSendAt = n['scheduledSendAt'] ? wallClock(String(n['scheduledSendAt'])) : null;
    const held = opts.heldTypes.includes(type);

    const file = `${String(index).padStart(2, '0')}-${type.replace(/_/g, '-')}.eml`;
    const jsonFile = `${String(index).padStart(2, '0')}-${type.replace(/_/g, '-')}.json`;
    const eml = [
      `From: Exit Platform (UAT) <no-reply@exit-platform.test>`,
      `To: ${actualTo}`,
      `Subject: ${subject}`,
      `Date: ${capture?.capturedAt ? new Date(capture.capturedAt).toUTCString() : new Date(String(n['updatedAt'] ?? Date.now())).toUTCString()}`,
      `X-Environment: TEST / UAT`,
      `X-Employee: ${opts.employee}`,
      `X-Intended-To: ${intendedTo}`,
      `X-Intended-CC: ${intendedCc.join(', ') || '(none)'}`,
      `X-Actual-Delivered-To: ${actualTo}`,
      `X-Notification-Type: ${type}`,
      `X-Case-ID: ${opts.caseNumber}`,
      `X-Test-Mode: ${testMode ? 'true' : capture ? 'true (captured)' : 'n/a'}`,
      `X-Record-Status: ${status}`,
      `X-Delivery-Status: ${deliveryStatus ?? (held ? 'HELD until effective instant' : 'not dispatched')}`,
      `X-Control-Level: ${String(n['controlLevel'] ?? '')}`,
      `X-Scheduled-Send-At: ${scheduledSendAt ?? ''}`,
      `X-Sent-At: ${sentAt ?? ''}`,
      `X-Source: reconstructed from NotificationRecord/NotificationOutbox/NotificationCapture; no MIME is stored by the capture adapter`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body || '(no body captured - the record was never dispatched)',
      ``,
    ].join('\r\n');
    ev.write('emails', file, eml);

    // Content checks (automated where the judgement is mechanical).
    // Employee-facing mail greets by first name; departmental mail names in full.
    const firstName = opts.employee.split(' ')[0] ?? opts.employee;
    const named = body.includes(opts.employee) || body.includes(`Dear ${firstName},`);
    const contentChecks: EmailEvidence['contentChecks'] = [];
    const dispatched = !!capture;
    if (dispatched) {
      contentChecks.push({
        title: '[TEST MODE] subject prefix',
        status: subject.startsWith('[TEST MODE]') ? 'PASS' : 'FAIL',
      });
      contentChecks.push({
        title: 'intercept banner names intended recipients',
        status: /INTERCEPTED AND NOT DELIVERED/i.test(body) && intercept.to ? 'PASS' : 'FAIL',
      });
      contentChecks.push({
        title: 'employee named',
        status: named
          ? 'PASS'
          : type === 'IT_ACCESS_REMOVAL' && opts.expectation.restricted
            ? 'WARN'
            : 'FAIL',
        detail:
          type === 'IT_ACCESS_REMOVAL' && opts.expectation.restricted && !named
            ? 'restricted case: minimum-data IT notice'
            : undefined,
      });
      contentChecks.push({
        title: 'no unresolved placeholders',
        status: /\[\[|\[MISSING:/.test(body) ? 'FAIL' : 'PASS',
      });
      const forbiddenHit = opts.expectation.forbiddenWording.exec(body);
      contentChecks.push({
        title: 'no wrong separation wording',
        status: forbiddenHit ? 'FAIL' : 'PASS',
        detail: forbiddenHit ? `found "${forbiddenHit[0]}"` : undefined,
      });
      const dateHit =
        containsDate(body, c['effectiveSeparationAt'] as string) ||
        containsDate(body, c['confirmedLastDay'] as string) ||
        containsDate(body, c['contractEndDate'] as string);
      contentChecks.push({
        title: 'separation date present',
        status: dateHit ? 'PASS' : 'HUMAN_REVIEW',
        detail: dateHit ? undefined : 'date not found in a recognised format - review body',
      });
      if (['IT_ACCESS_REMOVAL', 'FINANCE_OFFBOARDING', 'RETURN_ITEMS_CHECKLIST'].includes(type)) {
        contentChecks.push({
          title: 'secure link present',
          status: /\/(ack|checklist)\/[A-Za-z0-9_-]{43}/.test(body) ? 'PASS' : 'FAIL',
        });
      }
      if (type === 'RESIGNATION_ACCEPTANCE_LETTER') {
        contentChecks.push({
          title: 'PDF attached (capture note)',
          status:
            /Attached:/i.test(capture?.note ?? '') || n['attachedDocumentId'] ? 'PASS' : 'FAIL',
        });
      }
      contentChecks.push({
        title: 'signature / template wording',
        status: 'HUMAN_REVIEW',
        detail: 'presentation review',
      });
    } else if (held) {
      contentChecks.push({
        title: 'held until the effective instant (not sent early)',
        status: sentAt ? 'FAIL' : 'PASS',
        detail: scheduledSendAt ? `scheduled ${scheduledSendAt}` : 'no schedule recorded',
      });
    } else {
      contentChecks.push({
        title: 'dispatched',
        status: 'FAIL',
        detail: `record status ${status}; never captured`,
      });
    }
    const result: EmailEvidence['result'] = contentChecks.some((x) => x.status === 'FAIL')
      ? 'FAIL'
      : contentChecks.some((x) => x.status === 'WARN')
        ? 'WARN'
        : 'PASS';

    const evidence: EmailEvidence = {
      index,
      file: `emails/${file}`,
      jsonFile: `emails/${jsonFile}`,
      notificationType: type,
      label,
      subject,
      intendedTo,
      intendedCc,
      actualTo,
      testMode: testMode || dispatched,
      status,
      deliveryStatus,
      controlLevel: (n['controlLevel'] as string | null) ?? null,
      scheduledSendAt,
      sentAt,
      contentChecks,
      result,
    };
    ev.write(
      'emails',
      jsonFile,
      JSON.stringify(
        {
          ...evidence,
          recordId: n.id,
          origin: n['origin'],
          recipientName: n['recipientName'],
          recipientOrg: n['recipientOrg'],
          recipientKind: n['recipientKind'],
          outbox: n.outbox,
          capturedAt: capture?.capturedAt ?? null,
          captureNote: capture?.note ?? null,
          tokens: n.tokens,
          acknowledgedAt: n['acknowledgedAt'],
          acknowledgedVia: n['acknowledgedVia'],
          completionConfirmedAt: n['completionConfirmedAt'],
        },
        null,
        2,
      ),
    );
    ev.addEmail(evidence);
    out.push(evidence);

    routing.push(`## ${index}. ${label} (${type})`);
    routing.push('');
    routing.push('```text');
    routing.push(`Environment:          TEST / UAT`);
    routing.push(`Employee:             ${opts.employee}`);
    routing.push(`Intended To:          ${intendedTo}`);
    routing.push(`Intended CC:          ${intendedCc.join(', ') || '(none)'}`);
    routing.push(`Actual Delivered To:  ${actualTo}`);
    routing.push(`Notification Type:    ${type}`);
    routing.push(`Case ID:              ${opts.caseNumber}`);
    routing.push(`Record status:        ${status}${deliveryStatus ? ' / ' + deliveryStatus : ''}`);
    routing.push(`Control level:        ${String(n['controlLevel'] ?? '')}`);
    routing.push(`Scheduled / sent:     ${scheduledSendAt ?? '-'} / ${sentAt ?? '-'}`);
    routing.push(`Result:               ${result}`);
    routing.push('```');
    routing.push('');
  }
  ev.write('emails', 'routing.md', routing.join('\n'));
  return out;
}
