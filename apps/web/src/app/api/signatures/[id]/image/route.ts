import { NextResponse } from 'next/server';
import { ServiceError, readSignatureImage } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * An applied signature or set of initials, served to authorized HR users only
 * (DEC-068, directive 1 section 19).
 *
 * The object store is never exposed: its key does not appear in the URL and
 * no public or pre-signed link is ever handed out. Every read is checked
 * against the case the mark belongs to and verified against the checksum
 * recorded when it was applied.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  try {
    const file = await readSignatureImage({ userId: user.userId, roles: user.roles }, id);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        // Private to one signed-in reader: never a shared or proxy cache.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'The signature could not be read.' }, { status: 500 });
  }
}
