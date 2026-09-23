import { NextResponse } from 'next/server';
import { ServiceError, searchRecipientChoices } from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * DEC-069 section 24: the searchable recipient picker. Returns names and
 * masked addresses only - the full address is decrypted at send time, never
 * handed to a page.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { id } = await params;
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 80);
  try {
    const choices = await searchRecipientChoices({ userId: user.userId, roles: user.roles }, id, q);
    return NextResponse.json({ choices }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
