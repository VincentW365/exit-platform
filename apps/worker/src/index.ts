/**
 * Background worker skeleton (Architecture.md: separate worker process).
 *
 * Stage 1 has no asynchronous business work by design: the outbox arrives at
 * Stage 5 and reminders/escalation at Stage 3, and baseline capture keeps all
 * improvement automation off (DEC-007 / IC-S1-004). This process establishes
 * the boundary: configuration validation, database connectivity, a heartbeat,
 * and clean shutdown - so later stages add job handlers, not infrastructure.
 *
 * Logs are structured and PII-free (REQ-SEC-023): identifiers and counts
 * only, never employee data.
 */
import { loadRootEnvFile, getConfig } from '@exit/config';

loadRootEnvFile(import.meta.dirname);

const { getPrisma } = await import('@exit/db');

const HEARTBEAT_MS = 60_000;

function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), source: 'worker', event, ...fields }));
}

const config = getConfig(); // fail-closed guards run before anything else
const prisma = getPrisma();

let running = true;

async function heartbeat(): Promise<void> {
  try {
    // Connectivity probe plus a safety assertion: in Stage 1 every automation
    // flag must remain disabled; a flipped flag is loudly reported.
    const enabledFlags = await prisma.featureFlag.count({ where: { enabled: true } });
    log('heartbeat', {
      env: config.NODE_ENV,
      emailMode: config.EMAIL_MODE,
      enabledAutomationFlags: enabledFlags,
      stage1AutomationExpected: 0,
    });
    if (enabledFlags > 0) {
      log('warning', {
        message: 'automation flags enabled while Stage 1 baseline capture is active',
        enabledAutomationFlags: enabledFlags,
      });
    }
  } catch (e) {
    log('heartbeat_error', { message: e instanceof Error ? e.message : 'unknown' });
  }
}

log('started', { env: config.NODE_ENV, heartbeatMs: HEARTBEAT_MS });
await heartbeat();
const timer = setInterval(() => void heartbeat(), HEARTBEAT_MS);

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  running = false;
  log('shutdown', { signal });
  clearInterval(timer);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
