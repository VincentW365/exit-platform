import { NextResponse } from 'next/server';
import { livenessCheck } from '@exit/db';

/**
 * Liveness endpoint (Directive 4 U): process + database reachability only.
 * Never exposes secrets, employee data or configuration values.
 */
export async function GET() {
  const result = await livenessCheck();
  return NextResponse.json(
    { status: result.ok ? 'ok' : 'unavailable' },
    { status: result.ok ? 200 : 503 },
  );
}
