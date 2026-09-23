import {
  SIGNATURE_EXTEND_CHOICES,
  SIGNATURE_REQUEST_STATUS_LABELS,
  formatDateOnly,
  formatInstant,
  type SignerRole,
} from '@exit/domain';
import type { listSignatureRequests } from '@exit/db';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyLinkField } from './CopyLinkField';
import { HrSignatureField } from './HrSignatureField';
import {
  applyHrSignatureAction,
  clearHrSignatureAction,
  createSignatureRequestAction,
  extendSignatureRequestAction,
  revokeSignatureRequestAction,
  sendSignatureRequestAction,
} from './actions';

/**
 * Signature status and delivery on the case (DEC-068, directive 2 sections 5
 * and 14).
 *
 * The important idea on this screen: creating a request is not sending it.
 * One request produces one link, and Copy Signing Link, Send by Email and
 * Resend Email all point at that same request - never at a second token.
 *
 * Business wording only: copy, send, resend, extend, revoke. Nothing here
 * says token, bearer or expiry policy, and none of it is an approval.
 */

type Data = Awaited<ReturnType<typeof listSignatureRequests>>;

const BADGE: Record<string, string> = {
  PENDING: 'badge--info',
  SIGNED: 'badge--ok',
  REVOKED: 'badge--neutral',
  EXPIRED: 'badge--warn',
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

export function SignaturePanel({
  caseId,
  formId,
  formEditable,
  employeeName,
  employeeEmail,
  data,
  documentKind = 'ACTION_FORM',
  returnTo,
}: {
  caseId: string;
  /** The form version or the receipt version signatures are collected on. */
  formId: string;
  /** Signatures are collected before the version is finalized. */
  formEditable: boolean;
  employeeName: string;
  employeeEmail: string | null;
  data: Data;
  /** DEC-069: the same panel serves the Exit Checklist for Return Items. */
  documentKind?: 'ACTION_FORM' | 'ASSET_RECEIPT';
  /** Where the actions return to; the action form tab unless told otherwise. */
  returnTo?: string;
}) {
  const hrBlockKey = documentKind === 'ASSET_RECEIPT' ? 'receiptReceivedBy' : 'hrCompletion';
  const requests = data.requests.filter(
    (r) => r.documentKind === documentKind && r.documentId === formId,
  );
  const signatures = data.signatures.filter(
    (s) => s.documentKind === documentKind && s.documentId === formId,
  );
  const open = requests.filter((r) => r.status === 'PENDING');
  // A new request is offered only when none is live. An expired one is
  // extended or revoked first, so two links never compete.
  const employeeRequest = requests.find(
    (r) => r.signerRole === 'EMPLOYEE' && (r.status === 'PENDING' || r.status === 'EXPIRED'),
  );
  const hrSignature = signatures.find((s) => s.blockKey === hrBlockKey);
  const manage = data.canManage && formEditable;
  const scope = { kind: documentKind, returnTo: returnTo ?? '' };

  return (
    <section className="panel" aria-labelledby="sig-heading">
      <h2 id="sig-heading">Signatures</h2>
      <p className="hint">
        The employee signs by secure link; the assigned HR Officer signs inside the platform. A
        signature records who signed what, and is not an approval: the case approval remains the
        single authorization for this work.
      </p>

      {/* --- the employee's request ------------------------------------- */}
      {!employeeRequest && manage ? (
        <form action={createSignatureRequestAction} className="stack">
          <input type="hidden" name="formId" value={formId} />
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="documentKind" value={scope.kind} />
          <input type="hidden" name="returnTo" value={scope.returnTo} />
          <input type="hidden" name="signerName" value={employeeName} />
          <label className="field">
            <span className="field__label">Send to</span>
            <input
              type="email"
              name="signerEmail"
              className="input"
              defaultValue={employeeEmail ?? ''}
              placeholder="employee@example.test"
              autoComplete="off"
            />
            <span className="hint">
              You can create the request now and decide how to deliver it afterwards.
            </span>
          </label>
          <button type="submit">Create signature request</button>
        </form>
      ) : null}

      {requests.map((r) => {
        const active = r.status === 'PENDING';
        // Expired is recoverable: the owner asked for Extend or Reactivate
        // rather than forcing HR to issue a second link.
        const recoverable = r.status === 'PENDING' || r.status === 'EXPIRED';
        return (
          <article key={r.id} className="card" style={{ marginTop: 'var(--space-3)' }}>
            <div className="actions-row">
              <strong>
                {r.signerLabel}: {r.signerName}
              </strong>
              <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>
                {SIGNATURE_REQUEST_STATUS_LABELS[r.status]}
              </span>
            </div>
            <div className="idgrid">
              <Fact label="Document:" value={r.documentTitle} />
              <Fact label="Sent to:" value={r.destinationMask ?? 'Not sent by email'} />
              <Fact label="Created:" value={formatInstant(r.createdAt)} />
              <Fact
                label="Expires:"
                value={r.status === 'SIGNED' ? 'Signed' : formatDateOnly(r.expiresAt)}
              />
              <Fact
                label="Last emailed:"
                value={r.lastSentAt ? formatInstant(r.lastSentAt) : 'Never'}
              />
              <Fact label="Marks applied:" value={`${r.appliedBlocks} of ${r.requiredBlocks}`} />
            </div>
            {r.status === 'SIGNED' && r.signedAt ? (
              <p className="meta">Signed {formatInstant(r.signedAt)}.</p>
            ) : null}
            {r.status === 'REVOKED' && r.revokedReason ? (
              <p className="meta">Revoked: {r.revokedReason}</p>
            ) : null}
            {r.status === 'EXPIRED' ? (
              <p className="meta">
                This link has expired. Extend it to put the same link back to work, or revoke it and
                create a new request.
              </p>
            ) : null}

            {manage && recoverable ? (
              <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
                {active ? (
                  <>
                    <CopyLinkField requestId={r.id} signerName={r.signerName} />

                    <form action={sendSignatureRequestAction} className="actions-row">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="caseId" value={caseId} />
                      <input type="hidden" name="returnTo" value={scope.returnTo} />
                      <label className="field field--inline">
                        <span className="field__label">Email address</span>
                        <input
                          type="email"
                          name="signerEmail"
                          className="input"
                          defaultValue={employeeEmail ?? ''}
                          autoComplete="off"
                        />
                      </label>
                      <button type="submit" className="secondary compact">
                        {r.sentCount > 0 ? 'Resend email' : 'Send by email'}
                      </button>
                    </form>
                  </>
                ) : null}

                <form action={extendSignatureRequestAction} className="actions-row">
                  <input type="hidden" name="requestId" value={r.id} />
                  <input type="hidden" name="caseId" value={caseId} />
                  <input type="hidden" name="returnTo" value={scope.returnTo} />
                  <label className="field field--inline">
                    <span className="field__label">Extend by</span>
                    <select name="addDays" className="input" defaultValue="7">
                      {SIGNATURE_EXTEND_CHOICES.map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="secondary compact">
                    Extend link
                  </button>
                </form>

                <ConfirmDialog
                  trigger="Revoke link"
                  triggerClassName="danger compact"
                  title="Revoke this signing link?"
                  consequence={[
                    'The link stops working immediately.',
                    'The signer sees that the request is no longer valid.',
                    'Any initials or signature already submitted are unaffected.',
                    'You can create a new request afterwards.',
                  ]}
                >
                  <form action={revokeSignatureRequestAction} className="stack">
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="caseId" value={caseId} />
                    <input type="hidden" name="returnTo" value={scope.returnTo} />
                    <label className="field">
                      <span className="field__label">Reason</span>
                      <input type="text" name="reason" className="input" maxLength={300} required />
                    </label>
                    <button type="submit" className="danger">
                      Revoke link
                    </button>
                  </form>
                </ConfirmDialog>
              </div>
            ) : null}
          </article>
        );
      })}

      {/* --- the HR signature -------------------------------------------- */}
      <h3 style={{ marginTop: 'var(--space-5)' }}>
        {documentKind === 'ASSET_RECEIPT'
          ? 'Items received by (Human Resources)'
          : 'Human Resources signature'}
      </h3>
      {hrSignature ? (
        <div className="stack">
          <p>
            Signed by {hrSignature.signerName} on {formatInstant(hrSignature.signedAt)}
            {hrSignature.provenance === 'TYPED' ? ' (typed)' : ''}.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- authorized private route */}
          <img
            src={`/api/signatures/${hrSignature.id}/image`}
            alt={`Signature of ${hrSignature.signerName}`}
            className="sigmark"
          />
          {manage ? (
            <form action={clearHrSignatureAction}>
              <input type="hidden" name="formId" value={formId} />
              <input type="hidden" name="caseId" value={caseId} />
              <input type="hidden" name="documentKind" value={scope.kind} />
              <input type="hidden" name="returnTo" value={scope.returnTo} />
              <button type="submit" className="secondary compact">
                Replace and sign again
              </button>
            </form>
          ) : null}
        </div>
      ) : manage ? (
        <HrSignatureField
          formId={formId}
          caseId={caseId}
          action={applyHrSignatureAction}
          documentKind={scope.kind}
          returnTo={scope.returnTo}
          label={documentKind === 'ASSET_RECEIPT' ? 'Items received by' : 'Human Resources'}
        />
      ) : (
        <p className="meta">Not signed yet.</p>
      )}

      {open.length > 0 ? (
        <p className="meta" style={{ marginTop: 'var(--space-4)' }}>
          {open.length} signature {open.length === 1 ? 'request is' : 'requests are'} still open.
          Finalizing this version closes them.
        </p>
      ) : null}
    </section>
  );
}

/** The signer roles this form can address, for future extension. */
export const FORM_SIGNER_ROLES: readonly SignerRole[] = ['EMPLOYEE', 'HR_OFFICER'];
