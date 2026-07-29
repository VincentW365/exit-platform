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
