/**
 * Dev-only service timing (Directive 6.2 AB). Enabled by EXIT_TIMING=1 in a
 * non-production environment; logs one line per labelled call so page and
 * query costs are measurable at live directory volume. Never logs data.
 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === 'production' || process.env['EXIT_TIMING'] !== '1') return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    // warn-level so the default console policy permits it; dev-only anyway.
    console.warn(`[timing] ${label}: ${Math.round(performance.now() - start)}ms`);
  }
}
