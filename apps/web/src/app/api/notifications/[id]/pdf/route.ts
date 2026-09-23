import { NextResponse } from 'next/server';
import { ServiceError, notificationRecordPdf } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * DEC-069 sections 11 and 34: an email as a PDF - a preview before sending,
 * the record afterwards, showing the recipient it actually went to.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  try {
    const file = await notificationRecordPdf({ userId: user.userId, roles: user.roles }, id);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'The email record could not be rendered.' }, { status: 500 });
  }
}
