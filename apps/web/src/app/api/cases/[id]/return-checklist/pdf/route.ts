import { NextResponse } from 'next/server';
import { ServiceError, previewReturnItemsPdf } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * DEC-069 sections 13 and 14: the Exit Checklist for Return Items as a PDF -
 * the current draft, marked as such, or the checksummed final once finalized.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  try {
    const file = await previewReturnItemsPdf({ userId: user.userId, roles: user.roles }, id);
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
    return NextResponse.json({ error: 'The checklist could not be rendered.' }, { status: 500 });
  }
}
