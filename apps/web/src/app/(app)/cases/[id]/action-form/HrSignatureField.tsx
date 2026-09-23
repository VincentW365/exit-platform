'use client';

import { useState } from 'react';
import { SignaturePad } from '@/components/SignaturePad';

/**
 * The assigned HR Officer's own signature, drawn inside the application
 * (DEC-068). They are already signed in and already own the case, so there is
 * no link and no token here - and no new approval either. This records the
 * completion the officer already attests, as a mark on the form.
 */
export function HrSignatureField({
  formId,
  caseId,
  action,
}: {
  formId: string;
  caseId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [provenance, setProvenance] = useState<'DRAWN' | 'TYPED'>('DRAWN');

  return (
    <form action={action} className="stack">
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="dataUrl" value={value} />
      <input type="hidden" name="provenance" value={provenance} />
      <SignaturePad
        mode="SIGNATURE"
        label="Human Resources"
        value={value}
        onChange={(next, how) => {
          setValue(next);
          setProvenance(how);
        }}
      />
      <button type="submit" disabled={value === ''}>
        Add my signature to the form
      </button>
    </form>
  );
}
