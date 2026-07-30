import { NextResponse } from 'next/server';
import { exportReportCsv, ServiceError } from '@exit/db';
import { requireAuth } from '@/lib/auth';

/** Audited CSV export (Directive 4 N.8/N.9). */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { actor } = await requireAuth();
  const { key } = await params;
  const url = new URL(request.url);
  try {
    const csv = await exportReportCsv(actor, key, {
      recordPurpose: url.searchParams.get('purpose') ?? 'OPERATIONAL',
    });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${key}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json(
        { error: 'not available' },
        { status: e.code === 'FORBIDDEN' ? 403 : 404 },
      );
    }
    throw e;
  }
}
