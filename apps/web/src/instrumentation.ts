import type { Instrumentation } from 'next';

/**
 * Server startup hook (Directive 1.1 section D.1): configuration is validated
 * when the server process boots, not lazily on the first request. A
 * production process with ALLOW_DEV_LOGIN=true or SCAN_MODE=dev-passthrough
 * therefore FAILS AT STARTUP (fail closed), before serving any traffic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getConfig } = await import('@exit/config');
    try {
      getConfig();
    } catch (error) {
      // Hard exit: an unsafe production configuration must never leave a
      // half-prepared server process holding the port.
      console.error(error instanceof Error ? error.message : 'Invalid configuration.');
      process.exit(1);
    }
  }
}

/**
 * Every unexpected server error, recorded with the reference Next shows the
 * user (DEC-073). The deployed site's owner cannot read the host's logs;
 * Administration > System > Recent errors shows the same reference with the
 * error's name and a bounded message. Nothing here may throw or slow the
 * response: an error that cannot be recorded goes to the server log, with its
 * reference, and is dropped.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const e = error as { digest?: unknown; name?: unknown; message?: unknown } | null;
  const reference = typeof e?.digest === 'string' ? e.digest : null;
  const errorName = typeof e?.name === 'string' ? e.name : 'Error';
  const message = typeof e?.message === 'string' ? e.message : String(error);
  try {
    const { recordApplicationError } = await import('@exit/db');
    await recordApplicationError({
      reference,
      errorName,
      message,
      routePath: context.routePath,
      method: request.method,
      routeType: context.routeType,
    });
  } catch (cause) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'application_error_unrecorded',
        reference,
        errorName,
        routePath: context.routePath,
        cause: cause instanceof Error ? cause.message : 'unknown',
      }),
    );
  }
};
