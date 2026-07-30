import { NextResponse } from 'next/server';
import { readinessCheck } from '@exit/db';

/**
 * Readiness endpoint (Directive 4 U.7): database plus required-provider
 * availability. Component NAMES only - no secrets, no employee data.
 */
export async function GET() {
  const result = await readinessCheck();
  return NextResponse.json(
    { status: result.ok ? 'ready' : 'not-ready', failing: result.failing },
    { status: result.ok ? 200 : 503 },
  );
}
