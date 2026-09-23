import { NextResponse } from 'next/server';
import {
  ServiceError,
  captureBannerBytes,
  departmentBannerBytes,
  personalBannerBytes,
} from '@exit/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Serves an email banner image to the platform's own previews (DEC-067):
 * `me` (the signed-in user's personal banner), `department` (the HR
 * Manager's configured banner) or `capture-<id>` (the banner a captured
 * development email carried). Every read is authorized on the server; the
 * bytes are the stored asset, checksum-verified. Never a public URL.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scope: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const actor = { userId: user.userId, roles: user.roles };
  const { scope } = await params;
  try {
    const file =
      scope === 'me'
        ? await personalBannerBytes(actor)
        : scope === 'department'
          ? await departmentBannerBytes(actor)
          : scope.startsWith('capture-')
            ? await captureBannerBytes(actor, scope.slice('capture-'.length))
            : null;
    if (!file) return NextResponse.json({ error: 'No banner.' }, { status: 404 });
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: 'Banner unavailable.' }, { status: 500 });
  }
}
