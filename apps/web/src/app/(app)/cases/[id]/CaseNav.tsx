import Link from 'next/link';

/** Case-detail section navigation (Directive 2 section I). */
export function CaseNav({ caseId, active }: { caseId: string; active: string }) {
  const tabs = [
    { href: `/cases/${caseId}`, key: 'overview', label: 'Overview' },
    { href: `/cases/${caseId}/workflow`, key: 'workflow', label: 'Workflow' },
    { href: `/cases/${caseId}/documents`, key: 'documents', label: 'Documents' },
    { href: `/cases/${caseId}/action-form`, key: 'action-form', label: 'Action Form' },
    { href: `/cases/${caseId}/notifications`, key: 'notifications', label: 'Notifications' },
    { href: `/cases/${caseId}/assets`, key: 'assets', label: 'Assets' },
    { href: `/cases/${caseId}/handover`, key: 'handover', label: 'Handover' },
    { href: `/cases/${caseId}/clearance`, key: 'clearance', label: 'Clearance' },
    { href: `/cases/${caseId}/survey`, key: 'survey', label: 'Exit Survey' },
    { href: `/cases/${caseId}#audit-h`, key: 'audit', label: 'Audit' },
  ];
  return (
    <nav aria-label="Case sections" className="panel" style={{ padding: '0.4rem 0.75rem' }}>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.25rem',
        }}
      >
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={active === t.key ? 'page' : undefined}
              className="button secondary"
              style={
                active === t.key
                  ? { background: 'var(--brand-blue)', color: '#fff' }
                  : { border: '1px solid transparent' }
              }
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
