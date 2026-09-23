/**
 * Email banner assets (owner directive 2026-09-23, DEC-067).
 *
 * Two banners can exist: the DEPARTMENT banner the HR Manager configures
 * under Administration (the supplied company/HR graphic), and an optional
 * PERSONAL banner each user may keep under My Settings. Both are JPG files
 * held in object storage under system-generated keys, checksummed on write
 * and verified on read - the same discipline as rendered PDFs. Configuration
 * references the asset; swapping the graphic is an upload, never a code
 * change (section 7-8).
 *
 * Which banner an email carries is decided by the pure rule in the domain
 * (`chooseEmailBanner`): a personal signature only on an email written as
 * coming from that person, otherwise the department banner, otherwise none.
 * A banner that cannot be read is logged and skipped; the email still goes
 * (section 12).
 */
import { createHash } from 'node:crypto';
import {
  can,
  chooseEmailBanner,
  emailBannerUploadErrors,
  jpegDimensions,
  notificationCarriesSenderSignature,
  personalBannerAlt,
  EMAIL_BANNER_CID,
  EMAIL_BANNER_DEFAULT_ALT,
  type Actor,
  type EmailBannerImage,
  type EmailBannerKind,
  type EmailBannerRef,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { getStorage, newPrefixedObjectKey } from '../storage.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export const EMAIL_BANNER_CONFIG_KEY = 'email.banner';

/** The department banner as stored in system configuration. */
export interface DepartmentBannerConfig {
  enabled: boolean;
  /**
   * Optional HTTPS location of the same graphic on a host suitable for email
   * retrieval. When set, the HTML references it directly and no inline part
   * travels with the message; when absent the image travels inline (CID).
   * Section 5: evaluated in that order; both work with any provider and
   * depend on no particular host.
   */
  hostedUrl: string | null;
  banner: EmailBannerRef | null;
}

export interface BannerUpload {
  fileName: string;
  declaredMime: string;
  bytes: Uint8Array;
}

const EMPTY: DepartmentBannerConfig = { enabled: false, hostedUrl: null, banner: null };

function parseRef(v: unknown): EmailBannerRef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o['objectKey'] !== 'string' || typeof o['checksum'] !== 'string') return null;
  return {
    objectKey: o['objectKey'],
    checksum: o['checksum'],
    mimeType: typeof o['mimeType'] === 'string' ? o['mimeType'] : 'image/jpeg',
    width: typeof o['width'] === 'number' ? o['width'] : 0,
    height: typeof o['height'] === 'number' ? o['height'] : 0,
    altText: typeof o['altText'] === 'string' ? o['altText'] : EMAIL_BANNER_DEFAULT_ALT,
    fileName: typeof o['fileName'] === 'string' ? o['fileName'] : 'email-banner.jpg',
  };
}

export async function getDepartmentBannerConfig(): Promise<DepartmentBannerConfig> {
  const raw = await getSystemConfigValue(EMAIL_BANNER_CONFIG_KEY);
  if (!raw || typeof raw !== 'object') return EMPTY;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o['enabled'] === true,
    hostedUrl: typeof o['hostedUrl'] === 'string' && o['hostedUrl'] ? o['hostedUrl'] : null,
    banner: parseRef(o['banner']),
  };
}

function hostedUrlErrors(url: string): string[] {
  if (!url) return [];
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url))
    return ['The hosted banner URL must be an https:// address.'];
  if (/@/.test(url)) return ['The hosted banner URL must not contain credentials.'];
  return [];
}

/** Validate, store and describe a banner upload. The caller records the reference. */
async function storeBanner(upload: BannerUpload, altText: string): Promise<EmailBannerRef> {
  const errors = emailBannerUploadErrors(upload);
  if (errors.length) throw ServiceError.validation(errors);
  const dims = jpegDimensions(upload.bytes)!;
  const objectKey = newPrefixedObjectKey('branding');
  await getStorage().put(objectKey, upload.bytes);
  return {
    objectKey,
    checksum: createHash('sha256').update(upload.bytes).digest('hex'),
    mimeType: 'image/jpeg',
    width: dims.width,
    height: dims.height,
    altText: altText.trim() || EMAIL_BANNER_DEFAULT_ALT,
    fileName: upload.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120),
  };
}

async function writeDepartmentConfig(
  actor: Actor,
  next: DepartmentBannerConfig,
  reason: string,
  audit: Record<string, string | number | boolean | null>,
): Promise<void> {
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: EMAIL_BANNER_CONFIG_KEY },
      create: {
        key: EMAIL_BANNER_CONFIG_KEY,
        value: next as never,
        reason,
        updatedById: actor.userId,
      },
      update: { value: next as never, reason, updatedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_EMAIL_BANNER_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SystemConfig',
      objectId: EMAIL_BANNER_CONFIG_KEY,
      result: 'SUCCESS',
      correlationId,
      metadata: { reason, ...audit },
    });
  });
}

/** The HR Manager supplies (or replaces) the department banner graphic. */
export async function setDepartmentBannerImage(
  actor: Actor,
  upload: BannerUpload,
  options: { altText?: string; reason: string },
): Promise<DepartmentBannerConfig> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  if (!options.reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  const current = await getDepartmentBannerConfig();
  const banner = await storeBanner(upload, options.altText ?? current.banner?.altText ?? '');
  const next: DepartmentBannerConfig = { ...current, enabled: true, banner };
  await writeDepartmentConfig(actor, next, options.reason.trim(), {
    kind: 'DEPARTMENT',
    width: banner.width,
    height: banner.height,
    bytes: upload.bytes.byteLength,
    fileName: banner.fileName,
    replaced: current.banner !== null,
  });
  return next;
}

/** Enable/disable, alt text and the optional hosted URL - without a new upload. */
export async function updateDepartmentBannerOptions(
  actor: Actor,
  options: { enabled: boolean; altText: string; hostedUrl: string; reason: string },
): Promise<DepartmentBannerConfig> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  if (!options.reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  const errors = hostedUrlErrors(options.hostedUrl.trim());
  if (options.altText.trim().length > 200)
    errors.push('The alt text is limited to 200 characters.');
  if (errors.length) throw ServiceError.validation(errors);
  const current = await getDepartmentBannerConfig();
  if (options.enabled && !current.banner)
    throw ServiceError.validation(['Upload the banner image before enabling it.']);
  const next: DepartmentBannerConfig = {
    enabled: options.enabled,
    hostedUrl: options.hostedUrl.trim() || null,
    banner: current.banner
      ? { ...current.banner, altText: options.altText.trim() || EMAIL_BANNER_DEFAULT_ALT }
      : null,
  };
  await writeDepartmentConfig(actor, next, options.reason.trim(), {
    kind: 'DEPARTMENT',
    optionsOnly: true,
    enabled: next.enabled,
    hostedUrlSet: next.hostedUrl !== null,
  });
  return next;
}

export async function clearDepartmentBanner(actor: Actor, reason: string): Promise<void> {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  await writeDepartmentConfig(actor, EMPTY, reason.trim(), { kind: 'DEPARTMENT', cleared: true });
}

// --- personal banner ------------------------------------------------------------

export async function getPersonalBanner(userId: string): Promise<EmailBannerRef | null> {
  const u = await getPrisma().user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      emailBannerObjectKey: true,
      emailBannerChecksum: true,
      emailBannerMime: true,
      emailBannerWidth: true,
      emailBannerHeight: true,
      emailBannerAlt: true,
      emailBannerFileName: true,
    },
  });
  if (!u?.emailBannerObjectKey || !u.emailBannerChecksum) return null;
  return {
    objectKey: u.emailBannerObjectKey,
    checksum: u.emailBannerChecksum,
    mimeType: u.emailBannerMime ?? 'image/jpeg',
    width: u.emailBannerWidth ?? 0,
    height: u.emailBannerHeight ?? 0,
    altText: u.emailBannerAlt ?? personalBannerAlt(u.displayName),
    fileName: u.emailBannerFileName ?? 'email-banner.jpg',
  };
}

/** A user uploads their OWN signature image; nobody sets another account's. */
export async function setPersonalBanner(
  actor: Actor,
  upload: BannerUpload,
): Promise<EmailBannerRef> {
  const prisma = getPrisma();
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { displayName: true },
  });
  const banner = await storeBanner(upload, personalBannerAlt(me.displayName));
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: {
        emailBannerObjectKey: banner.objectKey,
        emailBannerChecksum: banner.checksum,
        emailBannerMime: banner.mimeType,
        emailBannerWidth: banner.width,
        emailBannerHeight: banner.height,
        emailBannerAlt: banner.altText,
        emailBannerFileName: banner.fileName,
        emailBannerUpdatedAt: new Date(),
      },
    });
    await appendAudit(tx, {
      eventType: 'USER_EMAIL_BANNER_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: actor.userId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        cleared: false,
        width: banner.width,
        height: banner.height,
        bytes: upload.bytes.byteLength,
      },
    });
  });
  return banner;
}

export async function clearPersonalBanner(actor: Actor): Promise<void> {
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: {
        emailBannerObjectKey: null,
        emailBannerChecksum: null,
        emailBannerMime: null,
        emailBannerWidth: null,
        emailBannerHeight: null,
        emailBannerAlt: null,
        emailBannerFileName: null,
        emailBannerUpdatedAt: new Date(),
      },
    });
    await appendAudit(tx, {
      eventType: 'USER_EMAIL_BANNER_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: actor.userId,
      result: 'SUCCESS',
      correlationId,
      metadata: { cleared: true },
    });
  });
}

// --- reading the bytes ----------------------------------------------------------

/** Verified read: the stored bytes must still match the recorded checksum. */
export async function readBannerBytes(ref: {
  objectKey: string;
  checksum: string;
}): Promise<Buffer> {
  const bytes = await getStorage().get(ref.objectKey);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== ref.checksum) throw new Error('Stored email banner failed its integrity check.');
  return bytes;
}

/** The department banner bytes, for any signed-in user (previews). */
export async function departmentBannerBytes(
  actor: Actor,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!actor.roles.length) throw ServiceError.forbidden();
  const cfg = await getDepartmentBannerConfig();
  if (!cfg.banner) return null;
  return { bytes: await readBannerBytes(cfg.banner), mimeType: cfg.banner.mimeType };
}

/** The signed-in user's own banner bytes (My Settings preview). */
export async function personalBannerBytes(
  actor: Actor,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const ref = await getPersonalBanner(actor.userId);
  if (!ref) return null;
  return { bytes: await readBannerBytes(ref), mimeType: ref.mimeType };
}

/** The banner a captured development email referenced (mailbox preview). */
export async function captureBannerBytes(
  actor: Actor,
  captureId: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!can(actor, 'mailbox.dev')) throw ServiceError.forbidden();
  if (getConfig().isProduction) throw ServiceError.forbidden();
  const capture = await getPrisma().notificationCapture.findUnique({
    where: { id: captureId },
    select: { bannerObjectKey: true, bannerChecksum: true, bannerMime: true },
  });
  if (!capture?.bannerObjectKey || !capture.bannerChecksum) return null;
  return {
    bytes: await readBannerBytes({
      objectKey: capture.bannerObjectKey,
      checksum: capture.bannerChecksum,
    }),
    mimeType: capture.bannerMime ?? 'image/jpeg',
  };
}

// --- composing an outgoing email ---------------------------------------------------

/** Everything the outbox needs to put the banner into one message. */
export interface ResolvedEmailBanner {
  kind: EmailBannerKind;
  ref: EmailBannerRef;
  image: EmailBannerImage;
  /** The bytes to attach inline; null when a hosted URL is used instead. */
  inline: { contentId: string; fileName: string; mimeType: string; bytes: Buffer } | null;
}

/**
 * Decide and load the banner for one notification. Never throws: a banner
 * that cannot be resolved or read is reported through the structured log
 * and the email goes out without it (section 12).
 */
export async function resolveEmailBannerForNotification(args: {
  caseId: string;
  notificationType: string;
  correlationId: string;
}): Promise<ResolvedEmailBanner | null> {
  try {
    const prisma = getPrisma();
    const [department, c] = await Promise.all([
      getDepartmentBannerConfig(),
      prisma.offboardingCase.findUnique({
        where: { id: args.caseId },
        select: { assignedOfficerId: true, ownerId: true },
      }),
    ]);
    // The same identity the HR sender block uses: assigned officer, else owner.
    const senderUserId = c?.assignedOfficerId ?? c?.ownerId ?? null;
    const personal = senderUserId ? await getPersonalBanner(senderUserId) : null;
    const chosen = chooseEmailBanner({
      personal,
      department: department.banner,
      departmentEnabled: department.enabled,
      signedBySender: notificationCarriesSenderSignature(args.notificationType),
    });
    if (!chosen) return null;
    const hosted = chosen.kind === 'DEPARTMENT' ? department.hostedUrl : null;
    if (hosted) {
      return {
        kind: chosen.kind,
        ref: chosen.banner,
        image: {
          src: hosted,
          alt: chosen.banner.altText,
          width: chosen.banner.width,
          height: chosen.banner.height,
        },
        inline: null,
      };
    }
    const bytes = await readBannerBytes(chosen.banner);
    return {
      kind: chosen.kind,
      ref: chosen.banner,
      image: {
        src: `cid:${EMAIL_BANNER_CID}`,
        alt: chosen.banner.altText,
        width: chosen.banner.width,
        height: chosen.banner.height,
      },
      inline: {
        contentId: EMAIL_BANNER_CID,
        fileName: chosen.banner.fileName,
        mimeType: chosen.banner.mimeType,
        bytes,
      },
    };
  } catch (e) {
    // Observable, never blocking: the message is more important than its
    // signature graphic. No address, no body, no PII in the log line.
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        source: 'outbox',
        event: 'email_banner_unavailable',
        correlationId: args.correlationId,
        notificationType: args.notificationType,
        reason: e instanceof Error ? e.message.slice(0, 160) : 'unknown',
      }),
    );
    return null;
  }
}
