/**
 * Unexpected application errors, recorded for the people who run a hosted
 * site without access to its logs (DEC-073). Owner report, 2026-11-10: the
 * deployed site answered Review and approve with "Something Went Wrong ...
 * reference 2806405632", and nobody with access to the application could read
 * what happened. A production build never sends the message to the browser.
 *
 * Next.js calls the web app's onRequestError hook with the same reference it
 * shows the user; the hook records one audit event per error, and the System
 * page lists the latest few. The record carries the error's name, a bounded
 * message with addresses and long tokens removed, the request method and the
 * route PATTERN (never the concrete URL, which may hold identifiers). Never a
 * stack, a request body, a header, a cookie or the signed-in user.
 */
import { can, type Actor, type AuditEventType } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

export const APPLICATION_ERROR_EVENT: AuditEventType = 'APPLICATION_ERROR';

/** Below the audit metadata limit, with room for the other fields. */
const MESSAGE_LIMIT = 280;

/** A message fit for an audit row: one line, bounded, no addresses, no long tokens. */
export function safeErrorMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[address]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .trim()
    .slice(0, MESSAGE_LIMIT);
}

/**
 * Next's own refusals in words a support reader can act on (DEC-075). A
 * request body above the limit the build accepts ends as "Body exceeded N MB
 * limit" or, when the multipart stream is cut at that limit, "Unexpected end
 * of form"; neither names a file or a cause. Next's words stay first, so the
 * row still matches the host's log; its advice to developers is dropped.
 */
export function explainRequestError(message: string, builtBodyLimitMb: number | null): string {
  const words = message.replace(/\s+/g, ' ').trim();
  const bodyLimit = /^Body exceeded .*?limit\.?/i.exec(words);
  const cutOff = /^Unexpected end of form\.?$/i.test(words);
  if (!bodyLimit && !cutOff) return message;
  const limit = builtBodyLimitMb ? ` (${builtBodyLimitMb} MB)` : '';
  return `${(bodyLimit?.[0] ?? words).replace(/\.$/, '')}. The request was larger than this build accepts${limit} or was cut off: usually a file over the upload limit. See "Upload limit" under site health.`;
}

export interface ApplicationErrorInput {
  /** Next's digest: the reference the error page shows. */
  reference: string | null;
  errorName: string;
  message: string;
  /** The route pattern, such as `/cases/[id]/approve`. */
  routePath: string;
  method: string;
  routeType: string;
}

export async function recordApplicationError(input: ApplicationErrorInput): Promise<void> {
  await appendAudit(getPrisma(), {
    eventType: APPLICATION_ERROR_EVENT,
    actorType: 'SYSTEM',
    effectiveRoles: [],
    objectType: 'Route',
    objectId: input.routePath.slice(0, 200) || '/',
    result: 'FAILURE',
    correlationId: newCorrelationId(),
    metadata: {
      reference: input.reference,
      errorName: input.errorName.slice(0, 80),
      message: safeErrorMessage(input.message),
      method: input.method.slice(0, 10),
      routeType: input.routeType.slice(0, 20),
    },
  });
}

export interface RecentApplicationError {
  id: string;
  occurredAt: Date;
  reference: string | null;
  errorName: string;
  message: string;
  route: string;
  method: string;
  routeType: string;
}

/** The latest unexpected errors, newest first. HR Manager only. */
export async function listRecentApplicationErrors(
  actor: Actor,
  limit = 10,
): Promise<RecentApplicationError[]> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  const rows = await getPrisma().auditEvent.findMany({
    where: { eventType: APPLICATION_ERROR_EVENT },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, occurredAt: true, objectId: true, metadata: true },
  });
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const text = (k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '');
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      reference: text('reference') || null,
      errorName: text('errorName') || 'Error',
      message: text('message'),
      route: r.objectId,
      method: text('method'),
      routeType: text('routeType'),
    };
  });
}
