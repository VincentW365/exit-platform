'use client';

import { useState } from 'react';
import { SignaturePad } from '@/components/SignaturePad';

/**
 * The assigned HR Officer's own signature, drawn inside the application
 * (DEC-068). They are already signed in and already own the case, so there is
 * no link and no token here - and no new approval either. This records the
 * completion the officer already attests, as a mark on the document.
 *
 * DEC-069: the same field signs the "Items received by" line of the Exit
 * Checklist for Return Items.
 */
export function HrSignatureField({
  formId,
  caseId,
  action,
  documentKind = 'ACTION_FORM',
  returnTo = '',
  label = 'Human Resources',
}: {
  formId: string;
  caseId: string;
  action: (formData: FormData) => void | Promise<void>;
  documentKind?: 'ACTION_FORM' | 'ASSET_RECEIPT';
  returnTo?: string;
  label?: string;
}) {
  const [value, setValue] = useState('');
  const [provenance, setProvenance] = useState<'DRAWN' | 'TYPED'>('DRAWN');

  return (
    <form action={action} className="stack">
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="documentKind" value={documentKind} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="dataUrl" value={value} />
      <input type="hidden" name="provenance" value={provenance} />
      <SignaturePad
        mode="SIGNATURE"
        label={label}
        value={value}
        onChange={(next, how) => {
          setValue(next);
          setProvenance(how);
        }}
      />
      <button type="submit" disabled={value === ''}>
        Add my signature
      </button>
    </form>
  );
}
