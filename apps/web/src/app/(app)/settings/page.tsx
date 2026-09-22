import type { Metadata } from 'next';
import { getMySettings } from '@exit/db';
import { EMAIL_BANNER_MAX_CHARS, EMAIL_BANNER_MAX_LINES, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { Field, FormActions } from '@/components/forms';
import { Fact, Facts, SectionHead } from '@/components/patterns';
import { MailIcon, UserIcon } from '@/components/icons';
import { roleList } from '@/lib/text';
import { saveEmailBannerAction } from './actions';

export const metadata: Metadata = { title: 'My Settings' };
export const dynamic = 'force-dynamic';

/**
 * My Settings (owner directive 2026-09-22, section 8; DEC-066).
 *
 * Every signed-in user keeps their own email banner: the plain-text lines the
 * platform appends beneath their name and title on every outgoing email they
 * are the sender of (letters and notifications on their cases). It is the
 * user's own signature block, not a company setting, and only its owner
 * edits it.
 */
export default async function MySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  const me = await getMySettings(actor);

  const preview = [me.displayName, me.jobTitle, ...(me.emailBanner ?? '').split('\n')]
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

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
            description="Added beneath your name and title on every email the platform sends on your behalf."
          />
          <form action={saveEmailBannerAction} className="stack">
            <Field
              id="emailBanner"
              label="Banner lines"
              optional
              hint={`Up to ${EMAIL_BANNER_MAX_LINES} lines and ${EMAIL_BANNER_MAX_CHARS} characters of plain text - a phone number, an extension, a department line. Leave empty for no banner.`}
            >
              <textarea
                id="emailBanner"
                name="emailBanner"
                rows={5}
                maxLength={EMAIL_BANNER_MAX_CHARS}
                defaultValue={me.emailBanner ?? ''}
                placeholder={'Human Resources Department\n876-555-0100 ext. 12'}
              />
            </Field>
            <FormActions
              note={
                me.emailBannerUpdatedAt
                  ? `Last changed ${formatInstant(me.emailBannerUpdatedAt)}.`
                  : 'No banner yet.'
              }
            >
              <button type="submit">Save banner</button>
            </FormActions>
          </form>
          <h3 className="label" style={{ marginBottom: 'var(--space-2)' }}>
            How your signature will read
          </h3>
          <pre
            className="well"
            style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}
            aria-label="Signature preview"
          >
            {preview}
          </pre>
        </section>
      </div>
    </>
  );
}
