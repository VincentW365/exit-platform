import { NextResponse, type NextRequest } from 'next/server';
import { ServiceError, exportGlobalAuditCsv, type GlobalAuditFilter } from '@exit/db';
import type { AuditCategory } from '@exit/domain';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

function parseDate(v: string | null, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Directive 6.1 (O): audited, permission-controlled audit-evidence export. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const filter: GlobalAuditFilter = {
    from: parseDate(sp.get('from')),
    to: parseDate(sp.get('to'), true),
    actorId: sp.get('actor') || undefined,
    category: (sp.get('category') as AuditCategory) || undefined,
    eventType: sp.get('eventType') || undefined,
    caseNumber: sp.get('caseNumber') || undefined,
    result: (sp.get('result') as GlobalAuditFilter['result']) || undefined,
    recordPurpose: (sp.get('purpose') as GlobalAuditFilter['recordPurpose']) || undefined,
  };
  try {
    const csv = await exportGlobalAuditCsv({ userId: user.userId, roles: user.roles }, filter);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-export-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 });
  }
}
