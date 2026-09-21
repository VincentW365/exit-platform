/**
 * Database-backed verification and test-only isolation, from the test
 * process.
 *
 * The suite reads what the application wrote - tasks, email records, audit
 * events, tokens' metadata - so the evidence is the record itself rather than
 * a scrape of a page. Writes are limited to three audited product services:
 * correcting a record's purpose to TEST (while DRAFT), voiding a previous
 * run's leftover TEST cases, and running the same sweeps the worker runs.
 *
 * Every call runs `db-bridge.ts` under tsx in a child process: the bridge
 * loads the repository packages exactly as the seed scripts do, which keeps
 * Prisma and its generated client out of Playwright's own TypeScript loader.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const RESULT_MARK = '@@RESULT@@';

export interface Posture {
  appEnvironment: string;
  emailMode: string;
  testEmail: string | null;
  rehearsalMode: { enabled: boolean; redirectTo: string; note?: string } | null;
  automationFlags: Record<string, boolean>;
}

export interface PrepareRunResult {
  posture: Posture;
  voided: Array<{ caseNumber: string; from: string }>;
  leftAlone: Array<{ caseNumber: string; status: string }>;
}

export interface DirectoryFacts {
  matches: number;
  sourceSystem: string | null;
  sourceId: string | null;
  present: Record<string, boolean>;
  manager: { onRecord: boolean; hasWorkEmail: boolean; name: string | null } | null;
}

export interface CaseSnapshot {
  case: Record<string, unknown> & {
    id: string;
    caseNumber: string;
    status: string;
    departureType: string;
    recordPurpose: string;
    classification: string;
  };
  officer: string | null;
  owner: string | null;
  tasks: Array<Record<string, unknown>>;
  requiredActions: Array<Record<string, unknown>>;
  notifications: Array<
    Record<string, unknown> & {
      id: string;
      notificationType: string;
      status: string;
      outbox: Array<Record<string, unknown>>;
      captures: Array<{ subject: string; body: string; capturedAt: string; note: string | null }>;
      tokens: Array<Record<string, unknown>>;
    }
  >;
  documents: Array<Record<string, unknown>>;
  actionForms: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  returnChecklist: Record<string, unknown> | null;
  survey: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  audit: Array<
    Record<string, unknown> & { eventType: string; actorType: string; sentence: string }
  >;
  clearance: unknown;
}

export interface WorkflowExpectation {
  found: boolean;
  name: string | null;
  version: number | null;
  tasks: Array<{
    code: string;
    title: string;
    department: string;
    requiredRole: string;
    required: boolean;
    priority: string;
  }>;
}

export interface ProfileCatalogue {
  types: Array<{
    type: string;
    profile: {
      label: string;
      receivedDateLabel: string;
      initiator: string;
      noticeApplicable: boolean | null;
      noticeServed: boolean | null;
      requiredDates: string[];
      optionalDates: string[];
      forbiddenDates: string[];
      defaultsToToday: string[];
      baseUrgency: string;
      restrictedByDefault: boolean;
      surveyEligibleByDefault: boolean;
      authorizerExpected: boolean;
      requiresDetail: boolean;
      guidance?: string;
      noticeArrangement?: string | null;
    };
    letterType: string | null;
  }>;
  confirmationKeys: string[];
}

export class DbBridge {
  constructor(
    private readonly repoRoot: string,
    private readonly env: Record<string, string>,
  ) {}

  private call<T>(op: string, arg: unknown = {}): T {
    const bridge = path.join(
      this.repoRoot,
      'e2e',
      'offboarding-regression',
      'support',
      'db-bridge.ts',
    );
    const payload = Buffer.from(JSON.stringify(arg)).toString('base64');
    // Windows needs a shell for pnpm.cmd, and a shell splits an unquoted
    // path at its spaces - the repository lives in one.
    const quoted = process.platform === 'win32' ? `"${bridge}"` : bridge;
    const r = spawnSync('pnpm', ['exec', 'tsx', quoted, op, payload], {
      cwd: this.repoRoot,
      env: { ...process.env, ...this.env },
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    });
    const out = r.stdout ?? '';
    const at = out.lastIndexOf(RESULT_MARK);
    if (r.status !== 0 || at < 0) {
      throw new Error(
        `db-bridge ${op} failed (exit ${r.status}): ${(r.stderr ?? '').slice(-2000)}\n${out.slice(-1000)}`,
      );
    }
    const parsed = JSON.parse(out.slice(at + RESULT_MARK.length).trim()) as
      { ok: true; value: T } | { ok: false; error: string };
    if (!parsed.ok) throw new Error(`db-bridge ${op}: ${parsed.error}`);
    return parsed.value;
  }

  prepareRun(input: { employee: string; runId: string }): PrepareRunResult {
    return this.call('prepare-run', input);
  }
  directoryFacts(employee: string): DirectoryFacts {
    return this.call('directory-facts', { employee });
  }
  markTest(caseNumber: string, reason: string): { caseId: string; recordPurpose: string } {
    return this.call('mark-test', { caseNumber, reason });
  }
  sweep(): { sweep: unknown; outbox: { submitted: number; failed: number; deadLettered: number } } {
    return this.call('sweep', {});
  }
  snapshot(caseNumber: string): CaseSnapshot {
    return this.call('snapshot', { caseNumber });
  }
  workflowExpectation(type: string): WorkflowExpectation {
    return this.call('workflow-expectation', { type });
  }
  profiles(): ProfileCatalogue {
    return this.call('profiles', {});
  }
  voidCase(caseNumber: string, reason: string): { status: string } {
    return this.call('void-case', { caseNumber, reason });
  }

  // --- BambooHR directory (owner directive, 2026-09-15) ---------------------

  directoryStatus(): DirectoryStatus {
    return this.call('directory-status', {});
  }
  directoryProfile(employee: string): DirectoryProfileFacts | null {
    return this.call('directory-profile', { employee });
  }
  directoryRefresh(): DirectoryRunResult {
    return this.call('directory-refresh', {});
  }
  directoryHourly(): {
    scheduledSyncEnabled: boolean;
    tick: { queued: string[]; executed: DirectoryRunResult[]; skipped: string | null };
    forced: DirectoryRunResult;
  } {
    return this.call('directory-hourly', {});
  }
  directoryOutage(on: boolean): { on: boolean } {
    return this.call('directory-outage', { on });
  }
  directoryRuns(filter: { kind?: string; limit?: number }): DirectoryRunRow[] {
    return this.call('directory-runs', filter);
  }
  directorySearch(q: string): {
    total: number;
    rows: Array<{
      sourceId: string;
      displayName: string;
      jobTitle: string | null;
      department: string | null;
      managerName: string | null;
      employeeNumber: string | null;
      status: string;
    }>;
    freshness: { state: string; message: string };
  } {
    return this.call('directory-search', { q });
  }
}

export interface DirectoryStatus {
  mode: string;
  sourceSystem: string;
  scheduledSyncEnabled: boolean;
  webhookConfigured: boolean;
  simulatedOutage: boolean;
  employees: number;
  totalRecords: number;
  archived: number;
  lastEventAt: string | null;
  lastIncrementalAt: string | null;
  lastFullAt: string | null;
  lastSuccessfulAt: string | null;
  lastRun: Record<string, unknown> | null;
  activeRun: Record<string, unknown> | null;
  connection: 'HEALTHY' | 'FAILING' | 'UNKNOWN';
  freshness: { state: string; label: string; message: string; audience: string };
}

export interface DirectoryPerson {
  id: string;
  sourceId: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  managerName: string | null;
  managerDirectoryId: string | null;
  employeeNumber: string | null;
  status: string;
  active: boolean;
}

export interface DirectoryProfileFacts {
  record: DirectoryPerson & { lastSyncedAt: string | null };
  manager: (DirectoryPerson & { reportsCount: number }) | null;
  reports: DirectoryPerson[];
  reportsTotal: number;
  cases: {
    live: Array<{ caseNumber: string; status: string }>;
    history: Array<{ caseNumber: string; status: string }>;
  };
}

export interface DirectoryRunResult {
  runId: string;
  kind: string;
  status: string;
  mode: string;
  errorCode: string | null;
  checked: number;
  added: number;
  updated: number;
  unchanged: number;
  archived: number;
  failed: number;
}

export interface DirectoryRunRow {
  id: string;
  kind: string;
  status: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  employeeSourceId: string | null;
  employee: { displayName: string; id: string } | null;
  checked: number;
  added: number;
  updated: number;
  unchanged: number;
  archived: number;
  failed: number;
  errorCode: string | null;
  errorDetail: string | null;
  changedFields: string[];
}
