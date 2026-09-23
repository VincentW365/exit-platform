import { NextResponse } from 'next/server';
import { ServiceError, getSigningLink } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Hand the signing link to an authorized HR user so their browser can copy it
 * (DEC-068, directive 2 section 6).
 *
 * This is a POST returning the link in a response body, deliberately: a
 * redirect carrying the link as a query parameter would put it in the address
 * bar, the browser history and the server's request log, which is exactly
 * what the directive forbids. Here the link exists only in the response and
 * in the clipboard.
 *
 * The service performs the authorization and records the copy against the
 * request identifier - never the link itself.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  try {
    const url = await getSigningLink({ userId: user.userId, roles: user.roles }, id);
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'The signing link could not be read.' }, { status: 500 });
  }
}
