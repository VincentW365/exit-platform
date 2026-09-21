import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { getConfig } from '@exit/config';
import {
  directorySyncSettings,
  recordWebhookReceipt,
  requestDirectorySync,
  runQueuedDirectorySyncs,
} from '@exit/db';
import { parseBambooWebhookEmployees, verifyBambooWebhookSignature } from '@exit/domain';

export const dynamic = 'force-dynamic';

/** A webhook body larger than this is not an employee-change notification. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * BambooHR employee-change webhook (owner directive, 2026-09-15, sections
 * 10-11). Every request must carry a valid HMAC signature made with the
 * webhook's private key; anything else is refused and audited by category.
 * The payload is trusted for one thing only - WHICH employees changed. Their
 * current records are then read from BambooHR by the synchronization engine
 * (never taken from the payload), one queued run per employee, executed
 * after this response is sent. Repeated deliveries are harmless: the upsert
 * is idempotent.
 *
 * The endpoint does not exist (404) until BAMBOOHR_WEBHOOK_PRIVATE_KEY is
 * configured, so an unconfigured installation accepts nothing.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const key = getConfig().BAMBOOHR_WEBHOOK_PRIVATE_KEY?.trim();
  if (!key) return new NextResponse(null, { status: 404 });

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });

  const settings = await directorySyncSettings();
  const verification = verifyBambooWebhookSignature({
    rawBody,
    timestamp: request.headers.get('x-bamboohr-timestamp'),
    signature: request.headers.get('x-bamboohr-signature'),
    privateKey: key,
    maxSkewSeconds: settings.webhookMaxSkewSeconds,
  });
  if (!verification.ok) {
    await recordWebhookReceipt({
      ok: false,
      reason: verification.reason,
      employees: 0,
      runIds: [],
    });
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    await recordWebhookReceipt({ ok: false, reason: 'BAD_JSON', employees: 0, runIds: [] });
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 400 });
  }
  const changes = parseBambooWebhookEmployees(body);
  if (changes.length === 0) {
    // A genuine but empty notification (or a test ping): acknowledged, nothing to do.
    await recordWebhookReceipt({ ok: true, employees: 0, runIds: [] });
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  const changedFields = [...new Set(changes.flatMap((c) => c.changedFields))].slice(0, 60);
  const { runIds } = await requestDirectorySync({
    kind: 'WEBHOOK',
    employeeSourceIds: changes.map((c) => c.sourceId),
    changedFields,
  });
  await recordWebhookReceipt({ ok: true, employees: changes.length, runIds });

  // Execute once the response has gone; the worker's minute tick would run
  // the queued follow-ups anyway, and the lease guarantees only one does.
  after(async () => {
    try {
      await runQueuedDirectorySyncs({ holder: `web-webhook:${process.pid}` });
    } catch {
      // The failure is on the run row; nothing else to do here.
    }
  });
  return NextResponse.json({ accepted: changes.length, runs: runIds.length }, { status: 202 });
}
