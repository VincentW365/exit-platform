import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not authorized' };

export default function UnauthorizedPage() {
  return (
    <>
      <h1>You are not authorized to view this page</h1>
      <p className="panel">
        Access follows least privilege: your roles do not include this capability. If you believe
        you need it, ask the HR Manager or system administrator - access grants are recorded and
        audited.
      </p>
    </>
  );
}
