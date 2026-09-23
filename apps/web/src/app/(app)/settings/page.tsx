import type { Metadata } from 'next';
import { getDepartmentBannerConfig, getMySettings } from '@exit/db';
import { EMAIL_BANNER_MAX_BYTES, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Feedback } from '@/components/ui';
import { Field, FormActions } from '@/components/forms';
import { Chip, Fact, Facts, SectionHead } from '@/components/patterns';
import { MailIcon, UserIcon } from '@/components/icons';
import { roleList } from '@/lib/text';
import { clearPersonalBannerAction, uploadPersonalBannerAction } from './actions';

export const metadata: Metadata = { title: 'My Settings' };
export const dynamic = 'force-dynamic';

/**
 * My Settings (owner directives 2026-09-22 section 8 and 2026-09-23; DEC-067).
 *
 * A user may keep a PERSONAL email signature banner: a supplied JPG graphic,
 * never recreated from text. It is attached only to emails written as coming
 * from this person (the HR sender block names them). Everything else carries
 * the department banner the HR Manager configures under Administration.
 */
export default async function MySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  const [me, department] = await Promise.all([getMySettings(actor), getDepartmentBannerConfig()]);
  const maxMb = Math.round(EMAIL_BANNER_MAX_BYTES / 1024 / 1024);
  // A changing query string defeats the browser cache after an upload.
  const bust = me.personalBanner?.updatedAt?.getTime() ?? 0;

  return (
    <>
      <h1 className="page-title">My Settings</h1>
      <Feedback err={sp.err} ok={sp.ok} />

      <div className="case-grid">
        <section className="panel" aria-labelledby="me-h">
          <SectionHead id="me-h" icon={<UserIcon />} tone="info" title="Your account" />
          <Facts className="facts--pairs">
            <Fact label="Name" isKey>
              {me.displayName}
            </Fact>
            <Fact label="Work email">{me.workEmail}</Fact>
            <Fact label="Title">{me.jobTitle}</Fact>
            <Fact label="Roles">{roleList(me.roles)}</Fact>
          </Facts>
          <p className="hint" style={{ marginBottom: 0 }}>
            Name, email and title come from the identity provider and the directory; the HR Manager
            manages roles under Administration.
          </p>
        </section>

        <section className="panel" aria-labelledby="banner-h">
          <SectionHead
            id="banner-h"
            icon={<MailIcon />}
            title="Email banner"
            description="Your personal signature graphic, placed at the bottom of emails that are written as coming from you."
            aside={
              me.personalBanner ? (
                <Chip tone="done">Personal banner set</Chip>
              ) : department.enabled && department.banner ? (
                <Chip tone="neutral">Using the department banner</Chip>
              ) : (
                <Chip tone="neutral">No banner</Chip>
              )
            }
          />

          {me.personalBanner ? (
            <figure className="email-banner-preview" aria-label="Current personal email banner">
              {/* eslint-disable-next-line @next/next/no-img-element -- the stored asset, served by the platform */}
              <img
                src={`/api/email-banner/me?v=${bust}`}
                alt={me.personalBanner.altText}
                width={me.personalBanner.width}
                height={me.personalBanner.height}
              />
              <figcaption className="meta">
                {me.personalBanner.fileName} · {me.personalBanner.width} ×{' '}
                {me.personalBanner.height} px
                {me.personalBanner.updatedAt
                  ? ` · uploaded ${formatInstant(me.personalBanner.updatedAt)}`
                  : ''}
              </figcaption>
            </figure>
          ) : department.enabled && department.banner ? (
            <p className="hint" role="note">
              Until you upload one, your emails carry the department banner configured by the HR
              Manager.
            </p>
          ) : (
            <p className="hint" role="note">
              No banner is configured yet. Emails go out without one until the HR Manager sets the
              department banner or you upload a personal one.
            </p>
          )}

          <form action={uploadPersonalBannerAction} className="stack">
            <Field
              id="bannerFile"
              label={me.personalBanner ? 'Replace banner (JPG)' : 'Upload banner (JPG)'}
              hint={`A .jpg file up to ${maxMb} MB. It is shown at its own size and scales down on small screens; it is never stretched or cropped.`}
            >
              <input
                id="bannerFile"
                name="bannerFile"
                type="file"
                accept=".jpg,.jpeg,image/jpeg"
                required
              />
            </Field>
            <FormActions note="Plain-text emails always keep their text; the banner is added to the HTML version.">
              <button type="submit">Upload banner</button>
            </FormActions>
          </form>

          {me.personalBanner ? (
            <ConfirmDialog
              trigger="Remove personal banner"
              triggerClassName="secondary compact"
              title="Remove your personal email banner?"
              consequence={[
                'Emails written as coming from you will carry the department banner instead, or none if there is no department banner.',
                'Nothing already sent changes.',
              ]}
            >
              <form action={clearPersonalBannerAction} className="stack">
                <button type="submit" className="danger">
                  Remove banner
                </button>
              </form>
            </ConfirmDialog>
          ) : null}
        </section>
      </div>
    </>
  );
}
