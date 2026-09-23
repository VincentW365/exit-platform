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

/** A rendered document travelling with the message (DEC-054). */
export interface OutboundAttachment {
  fileName: string;
  mimeType: string;
  /** Read from object storage and checksum-verified by the caller. */
  bytes: Buffer;
}

/** An image the HTML part references by Content-ID (DEC-067 email banner). */
export interface InlineImage {
  contentId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface OutboundMessage {
  outboxId: string;
  subject: string;
  /** The plain-text part: always present, always complete on its own. */
  body: string;
  /**
   * The HTML part (DEC-067): the same text with usable links plus the banner
   * image near the bottom. Absent when nothing needs HTML.
   */
  html?: string;
  inlineImages?: readonly InlineImage[];
  /** Decrypted destination - held in memory only, never logged. */
  destination: string;
  /** Decrypted copied recipients - same handling as the destination. */
  cc?: readonly string[];
  /** Decrypted blind copies - never shown to the other recipients. */
  bcc?: readonly string[];
  attachments?: readonly OutboundAttachment[];
  correlationId: string;
  /** What the development mailbox records about the banner it carried. */
  bannerCapture?: {
    objectKey: string;
    checksum: string;
    mimeType: string;
    alt: string;
    width: number;
    height: number;
    kind: string;
  } | null;
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
    const attached = (message.attachments ?? [])
      .map((a) => `${a.fileName} (${a.bytes.byteLength} bytes)`)
      .join(', ');
    const banner = message.bannerCapture ?? null;
    const capture = await prisma.notificationCapture.create({
      data: {
        recordId: outbox.notificationRecordId,
        subject: message.subject,
        body: message.body,
        html: message.html ?? null,
        bannerObjectKey: banner?.objectKey ?? null,
        bannerChecksum: banner?.checksum ?? null,
        bannerMime: banner?.mimeType ?? null,
        bannerAlt: banner?.alt ?? null,
        bannerWidth: banner?.width ?? null,
        bannerHeight: banner?.height ?? null,
        bannerKind: banner?.kind ?? null,
        note: [
          `Captured by the DEVELOPMENT mailbox (outbox ${message.outboxId}). NOT an external delivery.`,
          message.cc?.length ? `Copied recipients: ${message.cc.length}.` : null,
          message.bcc?.length ? `Blind copies: ${message.bcc.length}.` : null,
          attached ? `Attached: ${attached}.` : null,
          // Section 6: the banner is named even when a preview cannot show it.
          banner
            ? `Email banner: ${banner.kind.toLowerCase()} (${banner.width} x ${banner.height} px, ${message.inlineImages?.length ? 'inline' : 'hosted'}).`
            : 'Email banner: none configured.',
        ]
          .filter(Boolean)
          .join(' '),
      },
    });
    return { providerMessageRef: `capture:${capture.id}`, deliveryStatus: 'CAPTURED' };
  }
}

/** Microsoft Graph request shape - deterministic, minimum data. */
export function buildGraphSendRequest(message: {
  subject: string;
  body: string;
  html?: string;
  inlineImages?: readonly InlineImage[];
  destination: string;
  senderMailbox: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  attachments?: readonly OutboundAttachment[];
}): { url: string; payload: Record<string, unknown> } {
  const inner: Record<string, unknown> = {
    subject: message.subject,
    // DEC-067: the HTML part carries the banner; Graph sends one body, so
    // the HTML is used when present and the text body otherwise.
    body: message.html
      ? { contentType: 'HTML', content: message.html }
      : { contentType: 'Text', content: message.body },
    toRecipients: [{ emailAddress: { address: message.destination } }],
  };
  if (message.cc?.length) {
    inner.ccRecipients = message.cc.map((address) => ({ emailAddress: { address } }));
  }
  if (message.bcc?.length) {
    inner.bccRecipients = message.bcc.map((address) => ({ emailAddress: { address } }));
  }
  const attachments = [
    ...(message.attachments ?? []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.fileName,
      contentType: a.mimeType,
      contentBytes: a.bytes.toString('base64'),
    })),
    // Inline images are file attachments flagged inline with a Content-ID
    // the HTML references as cid:... - the reliable Graph mechanism.
    ...(message.inlineImages ?? []).map((i) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: i.fileName,
      contentType: i.mimeType,
      contentBytes: i.bytes.toString('base64'),
      isInline: true,
      contentId: i.contentId,
    })),
  ];
  if (attachments.length) inner.attachments = attachments;
  return {
    url: `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(message.senderMailbox)}/sendMail`,
    payload: { message: inner, saveToSentItems: true },
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
      const allowed = c.GRAPH_ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase());
      const everyRecipient = [message.destination, ...(message.cc ?? []), ...(message.bcc ?? [])];
      for (const address of everyRecipient) {
        const domain = address.split('@')[1]?.toLowerCase() ?? '';
        if (!allowed.includes(domain)) {
          throw new ProviderError('RECIPIENT_REJECTED', 'Recipient domain is not allow-listed.');
        }
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
