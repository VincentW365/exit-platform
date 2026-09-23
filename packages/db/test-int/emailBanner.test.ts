/**
 * Email banner delivery (owner directive 2026-09-23, DEC-067).
 *
 * The banner is a supplied JPG graphic held in object storage. Every
 * outgoing email gains an HTML part that references it as a normal image -
 * inline by Content-ID, or by a hosted URL when one is configured - while
 * the text part stays complete on its own. A personal signature is applied
 * only to emails written as coming from that person; a missing or unreadable
 * banner never stops a message. Synthetic data only.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_BANNER_CID, RESIGNATION_ACCEPTANCE_LETTER_BODY } from '@exit/domain';
import { getPrisma } from '../src/client.ts';
import { LocalStorageAdapter, setStorageForTests } from '../src/storage.ts';
import { activateTemplate, createDraftTemplate } from '../src/services/templateService.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import { processOutbox } from '../src/services/outboxService.ts';
import { transitionNotification } from '../src/services/notificationService.ts';
import {
  captureBannerBytes,
  clearDepartmentBanner,
  clearPersonalBanner,
  getDepartmentBannerConfig,
  getPersonalBanner,
  resolveEmailBannerForNotification,
  setDepartmentBannerImage,
  setPersonalBanner,
  updateDepartmentBannerOptions,
} from '../src/services/emailBannerService.ts';
import {
  createLetterDraft,
  finalizeDocument,
  refreshDraftFields,
} from '../src/services/documentService.ts';
import { issueDocumentByEmail, setEmployeeAddress } from '../src/services/letterDeliveryService.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();
const FIXTURE = readFileSync(
  path.resolve(import.meta.dirname, '../../../e2e/fixtures/email-banner.jpg'),
);
const UPLOAD = { fileName: 'hr-banner.jpg', declaredMime: 'image/jpeg', bytes: FIXTURE };

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;
let storage: LocalStorageAdapter;

const DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
  groupHealth: 'NO',
  groupLife: 'NO',
} as const;

async function activeCase(employeeSourceId: string): Promise<string> {
  const { caseId } = await createDraft(officer.actor, { ...DRAFT, employeeSourceId });
  await transitionCase(officer.actor, caseId, 'submit');
  await transitionCase(manager.actor, caseId, 'approve');
  await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(officer.actor, caseId);
  return caseId;
}

/** Release every derived record still waiting, then run one outbox pass. */
async function dispatchAll(caseId: string): Promise<void> {
  const waiting = await prisma.notificationRecord.findMany({
    where: { caseId, status: 'PENDING_APPROVAL' },
    select: { id: true },
  });
  for (const r of waiting) await transitionNotification(officer.actor, r.id, 'approve');
  await processOutbox(new Date(Date.now() + 60_000));
}

async function captureFor(caseId: string, notificationType: string) {
  return prisma.notificationCapture.findFirstOrThrow({
    where: { record: { caseId, notificationType: notificationType as never } },
    orderBy: { capturedAt: 'desc' },
  });
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  storage = new LocalStorageAdapter(mkdtempSync(path.join(tmpdir(), 'exit-banner-')));
  setStorageForTests(storage);
  officer = await createUser('Banner Officer', 'HR_OFFICER');
  manager = await createUser('Banner Manager', 'HR_MANAGER');
  lineMgr = await createUser('Banner Line Manager');
  const t = await createDraftTemplate(officer.actor, {
    documentType: 'RESIGNATION_ACCEPTANCE_WITH_NOTICE',
    name: 'Banner letter template',
    contentBody: RESIGNATION_ACCEPTANCE_LETTER_BODY,
  });
  await activateTemplate(manager.actor, t.id);
});

describe('department banner configuration (sections 2, 7, 8)', () => {
  it('rejects anything that is not a JPG, and only the HR Manager may set it', async () => {
    await expect(
      setDepartmentBannerImage(
        manager.actor,
        { ...UPLOAD, fileName: 'banner.png' },
        {
          reason: 'test',
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      setDepartmentBannerImage(officer.actor, UPLOAD, { reason: 'test' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getDepartmentBannerConfig()).toEqual({
      enabled: false,
      hostedUrl: null,
      banner: null,
    });
  });

  it('stores the supplied JPG at its own size, enables it and audits the change', async () => {
    const cfg = await setDepartmentBannerImage(manager.actor, UPLOAD, {
      reason: 'Supplied HR banner (synthetic fixture).',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.banner).toMatchObject({ width: 1500, height: 320, mimeType: 'image/jpeg' });
    expect(cfg.banner!.objectKey).toMatch(/^branding\/[a-f0-9]{48}$/);
    expect(cfg.banner!.altText).toBe("Bert's Auto Parts email signature");
    const stored = await storage.get(cfg.banner!.objectKey);
    expect(stored.equals(FIXTURE)).toBe(true); // never altered, never recreated
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'CONFIG_EMAIL_BANNER_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.actorId).toBe(manager.userId);
    expect((audit?.metadata as Record<string, unknown>)['width']).toBe(1500);
  });
});

describe('outgoing email carries the banner (sections 1, 3, 5, 6, 9)', () => {
  let caseId: string;

  it('a department notice goes out with an HTML part, the image inline and the text part complete', async () => {
    caseId = await activeCase('EMP-TEST-001');
    await dispatchAll(caseId);
    const capture = await captureFor(caseId, 'LINE_MANAGER_HANDOVER');
    expect(capture.html).toContain(`src="cid:${EMAIL_BANNER_CID}"`);
    expect(capture.html).toContain('width:100%;max-width:1500px;height:auto;');
    expect(capture.html).not.toContain('background-image');
    expect(capture.html!.match(/<img /g)).toHaveLength(1);
    expect(capture.bannerKind).toBe('DEPARTMENT');
    expect(capture.bannerWidth).toBe(1500);
    expect(capture.note).toContain('Email banner: department (1500 x 320 px, inline).');
    // The text part is untouched by the banner - complete for any client.
    expect(capture.body).not.toContain('<img');
    expect(capture.body.length).toBeGreaterThan(50);
    // The preview route can serve the very bytes the email carried.
    const served = await captureBannerBytes(manager.actor, capture.id);
    expect(served?.mimeType).toBe('image/jpeg');
    expect(served!.bytes.equals(FIXTURE)).toBe(true);
  });

  it('a personal signature applies only to emails written as coming from that person', async () => {
    const personalBytes = FIXTURE; // the same synthetic graphic, under the officer's account
    await setPersonalBanner(officer.actor, {
      ...UPLOAD,
      fileName: 'my-signature.jpg',
      bytes: personalBytes,
    });
    const mine = await getPersonalBanner(officer.userId);
    expect(mine?.altText).toBe('Banner Officer email signature');

    const second = await activeCase('EMP-TEST-002');
    await dispatchAll(second);
    // IT access removal carries the HR sender block: the officer signs it.
    const it_ = await captureFor(second, 'IT_ACCESS_REMOVAL');
    expect(it_.bannerKind).toBe('PERSONAL');
    expect(it_.bannerAlt).toBe('Banner Officer email signature');
    // The line-manager notice carries no personal sender block: department banner.
    const mgr = await captureFor(second, 'LINE_MANAGER_HANDOVER');
    expect(mgr.bannerKind).toBe('DEPARTMENT');
    expect(mgr.bannerAlt).toBe("Bert's Auto Parts email signature");
    // A manager who never uploaded one is not given the officer's signature:
    // the sender identity is the case's assigned officer, so a case the
    // manager runs personally resolves to the department banner.
    const managed = await createDraft(manager.actor, {
      ...DRAFT,
      employeeSourceId: 'EMP-TEST-004',
    });
    await transitionCase(manager.actor, managed.caseId, 'submit');
    await transitionCase(manager.actor, managed.caseId, 'approve');
    const resolved = await resolveEmailBannerForNotification({
      caseId: managed.caseId,
      notificationType: 'IT_ACCESS_REMOVAL',
      correlationId: 'test',
    });
    expect(resolved?.kind).toBe('DEPARTMENT');
    await clearPersonalBanner(officer.actor);
    expect(await getPersonalBanner(officer.userId)).toBeNull();
  });

  it('the letter to the employee carries the banner too (issued by the officer)', async () => {
    await setEmployeeAddress(officer.actor, caseId, {
      employeeAddress: '12 Synthetic Avenue, Kingston 5',
    });
    const doc = await createLetterDraft(officer.actor, caseId);
    await refreshDraftFields(officer.actor, doc.id);
    await finalizeDocument(officer.actor, doc.id);
    await issueDocumentByEmail(officer.actor, doc.id, { ccIds: [] });
    await processOutbox(new Date());
    const letter = await captureFor(caseId, 'RESIGNATION_ACCEPTANCE_LETTER');
    expect(letter.html).toContain(`cid:${EMAIL_BANNER_CID}`);
    expect(letter.note).toContain('Attached:');
    expect(letter.note).toContain('Email banner: department');
  });

  it('a hosted HTTPS URL replaces the inline part; junk URLs are refused', async () => {
    await expect(
      updateDepartmentBannerOptions(manager.actor, {
        enabled: true,
        altText: 'HR banner',
        hostedUrl: 'http://insecure.example.test/banner.jpg',
        reason: 'test',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await updateDepartmentBannerOptions(manager.actor, {
      enabled: true,
      altText: 'HR banner',
      hostedUrl: 'https://assets.example.test/hr-banner.jpg',
      reason: 'Published on the company asset host.',
    });
    const resolved = await resolveEmailBannerForNotification({
      caseId,
      notificationType: 'LINE_MANAGER_HANDOVER',
      correlationId: 'test',
    });
    expect(resolved?.inline).toBeNull();
    expect(resolved?.image.src).toBe('https://assets.example.test/hr-banner.jpg');
    expect(resolved?.image.alt).toBe('HR banner');
    await updateDepartmentBannerOptions(manager.actor, {
      enabled: true,
      altText: 'HR banner',
      hostedUrl: '',
      reason: 'Back to inline.',
    });
  });

  it('an unreadable banner is logged and skipped - the email still goes (section 12)', async () => {
    const cfg = await getDepartmentBannerConfig();
    await storage.deleteForRetention(cfg.banner!.objectKey); // simulate a lost object
    const third = await activeCase('EMP-TEST-005');
    await dispatchAll(third);
    const mgr = await captureFor(third, 'LINE_MANAGER_HANDOVER');
    expect(mgr.bannerObjectKey).toBeNull();
    expect(mgr.html).not.toContain('<img ');
    expect(mgr.note).toContain('Email banner: none configured.');
    expect(mgr.body.length).toBeGreaterThan(50);
  });

  it('disabling or removing the banner produces plain emails without a banner', async () => {
    await clearDepartmentBanner(manager.actor, 'Removed for the test.');
    expect(await getDepartmentBannerConfig()).toMatchObject({ enabled: false, banner: null });
    const resolved = await resolveEmailBannerForNotification({
      caseId,
      notificationType: 'IT_ACCESS_REMOVAL',
      correlationId: 'test',
    });
    expect(resolved).toBeNull();
    await expect(
      updateDepartmentBannerOptions(manager.actor, {
        enabled: true,
        altText: '',
        hostedUrl: '',
        reason: 'no image',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
