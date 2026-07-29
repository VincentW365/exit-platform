import { NextResponse } from 'next/server';
import { ServiceError, downloadAttachment } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Authorized attachment download (REQ-SEC-022). Quarantined files are refused
 * in the service layer; responses always force download, never inline
 * rendering of user-supplied content.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  try {
    const file = await downloadAttachment({ userId: user.userId, roles: user.roles }, id);
    const safeName = file.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'Download failed.' }, { status: 500 });
  }
}
