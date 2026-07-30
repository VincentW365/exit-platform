/**
 * Provider-neutral email boundary (Directive 4 section C).
 *
 * Two implementations:
 *  - DevCaptureProvider: non-production only, TEST/TRAINING records only,
 *    writes to the development mailbox (notification_capture) and never
 *    claims external delivery.
 *  - GraphProvider: the Microsoft Graph BOUNDARY. It is disabled without
 *    complete configuration, requests nothing over the network in this
 *    increment (no live Azure application exists), and fails closed with
 *    normalized errors. Request shaping and error mapping are implemented and
 *    unit-tested; the actual HTTP call is gated behind configuration that
 *    does not exist in this repository.
 */
import { getConfig } from '@exit/config';
import { normalizeProviderError, ProviderError } from '@exit/domain';
import { getPrisma } from '../client.ts';

export interface OutboundMessage {
  outboxId: string;
  subject: string;
  body: string;
  /** Decrypted destination - held in memory only, never logged. */
  destination: string;
  correlationId: string;
}

export interface SendResult {
  providerMessageRef: string;
  /** 'CAPTURED' (dev) or 'SUBMITTED' (live provider acceptance) - never
   *  'DELIVERED' without provider delivery evidence (B.6). */
  deliveryStatus: 'CAPTURED' | 'SUBMITTED';
}

export interface EmailProvider {
  readonly mode: string;
  validateConfig(): string[];
  health(): Promise<{ ok: boolean; detail: string }>;
  send(message: OutboundMessage): Promise<SendResult>;
}

class DevCaptureProvider implements EmailProvider {
  readonly mode = 'dev-capture';

  validateConfig(): string[] {
    return getConfig().isProduction
      ? ['The development capture provider is unavailable in production.']
      : [];
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    return getConfig().isProduction
      ? { ok: false, detail: 'unavailable in production' }
      : { ok: true, detail: 'development capture mailbox ready' };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (getConfig().isProduction) {
      throw new ProviderError('CONFIG_INVALID', 'dev-capture is unavailable in production');
    }
    const prisma = getPrisma();
    const outbox = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: message.outboxId },
      select: { notificationRecordId: true },
    });
    const capture = await prisma.notificationCapture.create({
      data: {
        recordId: outbox.notificationRecordId,
        subject: message.subject,
        body: message.body,
        note: `Captured by the DEVELOPMENT mailbox (outbox ${message.outboxId}). NOT an external delivery.`,
      },
    });
    return { providerMessageRef: `capture:${capture.id}`, deliveryStatus: 'CAPTURED' };
  }
}

/** Microsoft Graph request shape - deterministic, minimum data. */
export function buildGraphSendRequest(message: {
  subject: string;
  body: string;
  destination: string;
  senderMailbox: string;
}): { url: string; payload: Record<string, unknown> } {
  return {
    url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(message.senderMailbox)}/sendMail`,
    payload: {
      message: {
        subject: message.subject,
        body: { contentType: 'Text', content: message.body },
        toRecipients: [{ emailAddress: { address: message.destination } }],
      },
      saveToSentItems: true,
    },
  };
}

class GraphProvider implements EmailProvider {
  readonly mode = 'graph';

  validateConfig(): string[] {
    const c = getConfig();
    const errors: string[] = [];
    if (!c.GRAPH_TENANT_ID) errors.push('GRAPH_TENANT_ID is not configured.');
    if (!c.GRAPH_CLIENT_ID) errors.push('GRAPH_CLIENT_ID is not configured.');
    if (!c.GRAPH_CLIENT_SECRET_REF)
      errors.push('GRAPH_CLIENT_SECRET_REF (secret reference) is not configured.');
    if (!c.GRAPH_SENDER_MAILBOX) errors.push('GRAPH_SENDER_MAILBOX is not configured.');
    return errors;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    const errors = this.validateConfig();
    return errors.length
      ? { ok: false, detail: `not configured: ${errors.length} item(s) missing` }
      : { ok: true, detail: 'configuration present (live connectivity untested - no credentials)' };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const errors = this.validateConfig();
    if (errors.length) {
      // Fail closed: the boundary never fabricates a submission (C).
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', errors.join(' '));
    }
    const c = getConfig();
    // Allowed-domain enforcement before any network activity.
    if (c.GRAPH_ALLOWED_DOMAINS) {
      const domain = message.destination.split('@')[1]?.toLowerCase() ?? '';
      const allowed = c.GRAPH_ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase());
      if (!allowed.includes(domain)) {
        throw new ProviderError('RECIPIENT_REJECTED', 'Recipient domain is not allow-listed.');
      }
    }
    // No live Azure application, tenant consent or credential exists in this
    // repository (Directive 4 section C prohibition). The adapter therefore
    // fails closed here; when the company provisions credentials, the send
    // call is implemented against buildGraphSendRequest with retry-after and
    // throttling honoured via normalizeProviderError.
    throw new ProviderError(
      'PROVIDER_NOT_CONFIGURED',
      'Microsoft Graph credentials are not provisioned; live sending is disabled.',
    );
  }
}

/** Map a Graph HTTP failure (incl. Retry-After) to outbox semantics. */
export function classifyGraphFailure(
  httpStatus: number,
  retryAfterSeconds?: number,
): ProviderError {
  const code = normalizeProviderError({ httpStatus });
  return new ProviderError(
    code,
    `graph http ${httpStatus}`,
    retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : undefined,
  );
}

let providerOverride: EmailProvider | undefined;

/** Test hook: inject a provider (e.g. failing) for outbox integration tests. */
export function setEmailProviderForTests(provider: EmailProvider | undefined): void {
  providerOverride = provider;
}

export function getEmailProvider(): EmailProvider {
  if (providerOverride) return providerOverride;
  const mode = getConfig().EMAIL_MODE;
  switch (mode) {
    case 'graph':
      return new GraphProvider();
    case 'dev-capture':
    case 'sink':
      return new DevCaptureProvider();
    case 'disabled':
    default:
      return {
        mode: 'disabled',
        validateConfig: () => ['Email is disabled.'],
        health: async () => ({ ok: false, detail: 'email disabled' }),
        send: async () => {
          throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Email is disabled.');
        },
      };
  }
}
