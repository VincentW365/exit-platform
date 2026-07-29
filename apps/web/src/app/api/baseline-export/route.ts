import { NextResponse } from 'next/server';
import { ServiceError, baselineExportCsv } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Audited CSV export of baseline facts (REQ-REPORT-020). */
export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    const csv = await baselineExportCsv({ userId: user.userId, roles: user.roles });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="baseline-export.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    return NextResponse.json({ error: 'Export failed.' }, { status: 500 });
  }
}
