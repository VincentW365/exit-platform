import type { DepartmentBannerConfig } from '@exit/db';
import { EMAIL_BANNER_DEFAULT_ALT, EMAIL_BANNER_MAX_BYTES } from '@exit/domain';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FileInput } from '@/components/FileInput';
import { Field, FormActions } from '@/components/forms';
import { Chip, SectionHead } from '@/components/patterns';
import { MailIcon } from '@/components/icons';

type FormAction = (formData: FormData) => Promise<void>;

/**
 * Department email banner (DEC-067, section 7-8): the supplied company/HR
 * graphic every outgoing email carries unless a personal signature applies.
 * A configurable asset reference - replacing the graphic is an upload, and
 * an optional hosted HTTPS URL switches delivery from inline to hosted.
 */
export function EmailBannerAdmin({
  config,
  actions,
}: {
  config: DepartmentBannerConfig;
  actions: { upload: FormAction; update: FormAction; clear: FormAction };
}) {
  const maxMb = Math.round(EMAIL_BANNER_MAX_BYTES / 1024 / 1024);
  const banner = config.banner;
  return (
    <section className="panel" aria-labelledby="banner-admin-h">
      <SectionHead
        id="banner-admin-h"
        icon={<MailIcon />}
        title="Email banner"
        description="The signature graphic placed at the bottom of outgoing emails. Supplied as a .jpg; shown at its own size, scaled down on small screens, never stretched."
        aside={
          banner && config.enabled ? (
            <Chip tone="done">Enabled</Chip>
          ) : banner ? (
            <Chip tone="pending">Uploaded, disabled</Chip>
          ) : (
            <Chip tone="neutral">Not configured</Chip>
          )
        }
      />

      {banner ? (
        <figure className="email-banner-preview" aria-label="Current department email banner">
          {/* eslint-disable-next-line @next/next/no-img-element -- the stored asset, served by the platform */}
          <img
            src={`/api/email-banner/department?k=${banner.checksum.slice(0, 12)}`}
            alt={banner.altText}
            width={banner.width}
            height={banner.height}
          />
          <figcaption className="meta">
            {banner.fileName} · {banner.width} × {banner.height} px · delivered{' '}
            {config.hostedUrl ? 'from the hosted URL' : 'inline with each email'}
          </figcaption>
        </figure>
      ) : (
        <p className="hint" role="note">
          No department banner yet. Emails go out without a banner until one is uploaded here.
        </p>
      )}

      <div className="case-grid">
        <form action={actions.upload} className="stack">
          <h3 className="label" style={{ margin: 0 }}>
            {banner ? 'Replace the banner' : 'Upload the banner'}
          </h3>
          <Field
            id="dept-banner-file"
            label="Banner image (JPG)"
            required
            hint={`A .jpg file up to ${maxMb} MB, as supplied - the platform does not alter it.`}
          >
            <FileInput
              id="dept-banner-file"
              name="bannerFile"
              accept=".jpg,.jpeg,image/jpeg"
              required
              maxBytes={EMAIL_BANNER_MAX_BYTES}
              limitLabel={`The limit is ${maxMb} MB.`}
            />
          </Field>
          <Field
            id="dept-banner-alt"
            label="Alt text"
            optional
            hint="Concise description for readers who cannot see the image."
          >
            <input
              id="dept-banner-alt"
              name="altText"
              type="text"
              maxLength={200}
              defaultValue={banner?.altText ?? EMAIL_BANNER_DEFAULT_ALT}
            />
          </Field>
          <Field
            id="dept-banner-reason"
            label="Reason"
            required
            hint="Recorded in the audit trail."
          >
            <input id="dept-banner-reason" name="reason" type="text" required maxLength={500} />
          </Field>
          <FormActions>
            <button type="submit">Upload banner</button>
          </FormActions>
        </form>

        {banner ? (
          <form action={actions.update} className="stack">
            <h3 className="label" style={{ margin: 0 }}>
              Banner settings
            </h3>
            <Field id="dept-banner-enabled" label="Use the banner on outgoing email">
              <select id="dept-banner-enabled" name="enabled" defaultValue={String(config.enabled)}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field id="dept-banner-alt2" label="Alt text">
              <input
                id="dept-banner-alt2"
                name="altText"
                type="text"
                maxLength={200}
                defaultValue={banner.altText}
              />
            </Field>
            <Field
              id="dept-banner-url"
              label="Hosted image URL"
              optional
              hint="Only if the same graphic is published on an https host suitable for email retrieval. Leave empty to send the image inline with each email (works with any provider and host)."
            >
              <input
                id="dept-banner-url"
                name="hostedUrl"
                type="url"
                maxLength={500}
                defaultValue={config.hostedUrl ?? ''}
                placeholder="https://"
              />
            </Field>
            <Field id="dept-banner-reason2" label="Reason" required>
              <input id="dept-banner-reason2" name="reason" type="text" required maxLength={500} />
            </Field>
            <FormActions>
              <button type="submit" className="secondary">
                Save settings
              </button>
            </FormActions>
          </form>
        ) : null}
      </div>
      {banner ? (
        <div className="actions-row" style={{ marginTop: 'var(--space-3)' }}>
          <ConfirmDialog
            trigger="Remove banner"
            triggerClassName="danger compact"
            title="Remove the department email banner?"
            consequence={[
              'Outgoing emails carry no banner unless the sender has a personal one.',
              'Nothing already sent changes; the setting is audited.',
            ]}
          >
            <form action={actions.clear} className="stack">
              <Field id="dept-banner-clear-reason" label="Reason" required>
                <input
                  id="dept-banner-clear-reason"
                  name="reason"
                  type="text"
                  required
                  maxLength={500}
                />
              </Field>
              <button type="submit" className="danger">
                Remove banner
              </button>
            </form>
          </ConfirmDialog>
        </div>
      ) : null}
    </section>
  );
}
