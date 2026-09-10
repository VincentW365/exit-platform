/**
 * The evidence recorder: everything a scenario learns goes through here, so
 * a reader can open one folder and understand what happened without the
 * test code (directive sections 30-38).
 *
 *   <run>/TEST-0N-<slug>/
 *     result.md      human-readable
 *     result.json    machine-readable
 *     screenshots/   NN_name.png, numbered in the order they were taken
 *     emails/        NN-<Type>.eml + .json (+ routing.md)
 *     documents/     generated PDFs + a matrix
 *     links/         one file per generated link (tokens redacted)
 *     logs/          step log, request log
 *     audit/         events.json, timeline.md
 *
 * A failed check never throws: the scenario keeps going and the failure is
 * recorded (section 37). Only an unrecoverable error inside a step ends the
 * scenario, and even then the record written so far survives.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { redactTokens } from './redact';
import { scenarioDirName, updateExecution, type RunContext, type ScenarioSummary } from './run';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'HUMAN_REVIEW' | 'SKIPPED';

export interface EvidenceLink {
  label: string;
  /** Path relative to the scenario folder. */
  href: string;
}

export interface Check {
  id: string;
  area: string;
  title: string;
  status: CheckStatus;
  detail: string;
  evidence: EvidenceLink[];
  /** AUTOMATED unless the judgement is presentational (section 42). */
  automated: boolean;
  at: string;
}

export interface EmailEvidence {
  index: number;
  file: string;
  jsonFile: string;
  notificationType: string;
  label: string;
  subject: string;
  intendedTo: string;
  intendedCc: string[];
  actualTo: string;
  testMode: boolean;
  status: string;
  deliveryStatus: string | null;
  controlLevel: string | null;
  scheduledSendAt: string | null;
  sentAt: string | null;
  contentChecks: Array<{ title: string; status: CheckStatus; detail?: string }>;
  result: CheckStatus;
}

export interface DocumentEvidence {
  file: string | null;
  documentType: string;
  version: number;
  status: string;
  template: string;
  expected: boolean;
  generated: boolean;
  dataCorrect: CheckStatus;
  detail: string;
}

export interface LinkEvidence {
  kind: string;
  expected: boolean;
  generated: boolean;
  resolves: CheckStatus;
  correctCase: CheckStatus;
  permissions: CheckStatus;
  redactedUrl: string;
  file: string | null;
  result: CheckStatus;
  detail: string;
}

export interface TaskRow {
  code: string;
  title: string;
  expected: boolean;
  created: boolean;
  owner: string;
  dueAt: string;
  status: string;
  priority: string;
  result: CheckStatus;
  note?: string;
}

export interface Failure {
  scenario: string;
  step: string;
  expected: string;
  actual: string;
  error: string;
  screenshot: string | null;
  logs: string;
  reproduction: string;
  at: string;
}

export interface ScenarioResultJson {
  scenario: string;
  slug: string;
  label: string;
  employee: string;
  caseId: string | null;
  caseNumber: string | null;
  caseUrl: string | null;
  separationType: string;
  result: 'PASS' | 'FAIL' | 'WARN';
  checks: Check[];
  emails: EmailEvidence[];
  documents: DocumentEvidence[];
  tasks: TaskRow[];
  links: LinkEvidence[];
  screenshots: Array<{ file: string; caption: string }>;
  auditEvents: unknown[];
  errors: Failure[];
  facts: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

const SUB = ['screenshots', 'emails', 'documents', 'links', 'logs', 'audit'] as const;

export class ScenarioEvidence {
  readonly code: string;
  readonly slug: string;
  readonly type: string;
  readonly label: string;
  readonly dir: string;
  readonly startedAt = new Date().toISOString();
  caseId: string | null = null;
  caseNumber: string | null = null;
  caseUrl: string | null = null;
  readonly checks: Check[] = [];
  readonly emails: EmailEvidence[] = [];
  readonly documents: DocumentEvidence[] = [];
  readonly tasks: TaskRow[] = [];
  readonly links: LinkEvidence[] = [];
  readonly screenshots: Array<{ file: string; caption: string }> = [];
  readonly errors: Failure[] = [];
  readonly facts: Record<string, unknown> = {};
  auditEvents: unknown[] = [];
  private readonly lines: string[] = [];
  private shotIndex = 0;
  private checkIndex = 0;
  private failureIndex = 0;

  constructor(
    readonly run: RunContext,
    code: string,
    slug: string,
    type: string,
    label: string,
  ) {
    this.code = code;
    this.slug = slug;
    this.type = type;
    this.label = label;
    this.dir = path.join(run.runDir, scenarioDirName(code, slug));
    for (const s of SUB) mkdirSync(path.join(this.dir, s), { recursive: true });
    this.log(`Scenario ${code} - ${label} (${type}) started.`);
    updateExecution(run.runDir, (ex) => {
      const existing = ex.scenarios.find((s) => s.code === code);
      const entry: ScenarioSummary = {
        code,
        slug,
        type,
        label,
        result: 'RUNNING',
        caseNumber: null,
        caseUrl: null,
        dir: scenarioDirName(code, slug),
        checks: { pass: 0, fail: 0, warn: 0, humanReview: 0 },
        emails: 0,
        documents: 0,
        links: 0,
        screenshots: 0,
        startedAt: this.startedAt,
        completedAt: null,
        headline: '',
      };
      if (existing) Object.assign(existing, entry);
      else ex.scenarios.push(entry);
    });
  }

  // --- logging ------------------------------------------------------------

  log(line: string): void {
    const stamped = `${new Date().toISOString()} ${redactTokens(line)}`;
    this.lines.push(stamped);
    writeFileSync(path.join(this.dir, 'logs', 'steps.log'), this.lines.join('\n') + '\n');
  }

  /** Remember a fact for the result file (dates chosen, manager shown, ...). */
  fact(key: string, value: unknown): void {
    this.facts[key] = typeof value === 'string' ? redactTokens(value) : value;
  }

  // --- screenshots --------------------------------------------------------

  /** A numbered, named, full-page screenshot; returns its relative path. */
  async shot(page: Page, name: string, caption?: string): Promise<string> {
    this.shotIndex += 1;
    const file = `${String(this.shotIndex).padStart(2, '0')}_${name.replace(/[^a-z0-9]+/gi, '_')}.png`;
    const abs = path.join(this.dir, 'screenshots', file);
    try {
      await page.screenshot({ path: abs, fullPage: true });
    } catch (e) {
      this.log(`screenshot ${file} failed: ${String(e)}`);
      return '';
    }
    const rel = `screenshots/${file}`;
    this.screenshots.push({ file: rel, caption: caption ?? name.replace(/_/g, ' ') });
    this.log(`screenshot ${rel}`);
    return rel;
  }

  // --- checks -------------------------------------------------------------

  check(
    area: string,
    title: string,
    status: CheckStatus,
    detail = '',
    evidence: EvidenceLink[] = [],
    automated = true,
  ): Check {
    this.checkIndex += 1;
    const c: Check = {
      id: `${this.code}-C${String(this.checkIndex).padStart(2, '0')}`,
      area,
      title,
      status,
      detail: redactTokens(detail),
      evidence,
      automated,
      at: new Date().toISOString(),
    };
    this.checks.push(c);
    this.log(`${status.padEnd(12)} ${area}: ${title}${detail ? ' - ' + detail : ''}`);
    return c;
  }

  pass(area: string, title: string, detail?: string, evidence?: EvidenceLink[]): Check {
    return this.check(area, title, 'PASS', detail, evidence);
  }
  fail(area: string, title: string, detail?: string, evidence?: EvidenceLink[]): Check {
    return this.check(area, title, 'FAIL', detail, evidence);
  }
  warn(area: string, title: string, detail?: string, evidence?: EvidenceLink[]): Check {
    return this.check(area, title, 'WARN', detail, evidence);
  }
  human(area: string, title: string, detail?: string, evidence?: EvidenceLink[]): Check {
    return this.check(area, title, 'HUMAN_REVIEW', detail, evidence, false);
  }

  /** Assert-like: PASS when the condition holds, FAIL otherwise. */
  expect(
    area: string,
    title: string,
    condition: boolean,
    detail?: string,
    evidence?: EvidenceLink[],
  ): boolean {
    this.check(area, title, condition ? 'PASS' : 'FAIL', detail, evidence);
    return condition;
  }

  // --- steps and failures -------------------------------------------------

  /**
   * Run a step; an exception becomes a recorded failure with a screenshot
   * and the scenario continues with the next step (section 37). Returns
   * undefined when the step failed.
   */
  async step<T>(name: string, page: Page | null, fn: () => Promise<T>): Promise<T | undefined> {
    this.log(`STEP ${name}`);
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof Error ? (e.stack ?? e.message) : String(e);
      let shotRel: string | null = null;
      if (page) shotRel = await this.shot(page, `failure_${name}`, `Failure during: ${name}`);
      this.failure({
        step: name,
        expected: 'Step completes without error.',
        actual: err.split('\n')[0] ?? 'error',
        error: err,
        screenshot: shotRel,
        reproduction: `Scenario ${this.code} (${this.type}) for "${this.run.employee}"; step "${name}"; case ${this.caseNumber ?? 'not yet created'}.`,
      });
      this.fail('run', `Step "${name}" completed`, err.split('\n')[0]);
      return undefined;
    }
  }

  failure(f: Omit<Failure, 'scenario' | 'logs' | 'at'>): void {
    this.failureIndex += 1;
    const record: Failure = {
      scenario: this.code,
      ...f,
      error: redactTokens(f.error),
      logs: this.lines.slice(-40).join('\n'),
      at: new Date().toISOString(),
    };
    this.errors.push(record);
    const folder = path.join(
      this.run.runDir,
      'failures',
      `${this.code}-${String(this.failureIndex).padStart(2, '0')}-${f.step.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    );
    mkdirSync(folder, { recursive: true });
    if (f.screenshot) {
      const src = path.join(this.dir, f.screenshot);
      if (existsSync(src)) copyFileSync(src, path.join(folder, path.basename(f.screenshot)));
    }
    writeFileSync(path.join(folder, 'error.txt'), record.error + '\n');
    writeFileSync(path.join(folder, 'recent.log'), record.logs + '\n');
    writeFileSync(
      path.join(folder, 'failure.md'),
      [
        `# Failure - ${this.code} - ${f.step}`,
        '',
        `- Scenario: ${this.code} ${this.label} (${this.type})`,
        `- Case: ${this.caseNumber ?? 'not created'}`,
        `- Step: ${f.step}`,
        `- Expected: ${f.expected}`,
        `- Actual: ${f.actual}`,
        `- Screenshot: ${f.screenshot ? path.basename(f.screenshot) : 'none'}`,
        `- Reproduction: ${f.reproduction}`,
        '',
        '## Error',
        '',
        '```',
        record.error,
        '```',
        '',
        '## Recent log',
        '',
        '```',
        record.logs,
        '```',
        '',
      ].join('\n'),
    );
  }

  // --- artefacts ----------------------------------------------------------

  /** Write a text artefact under a sub-folder; returns the relative path. */
  write(sub: (typeof SUB)[number] | '', file: string, content: string | Buffer): string {
    const rel = sub ? `${sub}/${file}` : file;
    const abs = path.join(this.dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? redactTokens(content) : content);
    return rel;
  }

  /** Binary artefacts (PDFs) are stored as-is - nothing to redact. */
  writeBinary(sub: (typeof SUB)[number], file: string, content: Buffer): string {
    const rel = `${sub}/${file}`;
    writeFileSync(path.join(this.dir, rel), content);
    return rel;
  }

  addEmail(e: EmailEvidence): void {
    this.emails.push(e);
  }
  addDocument(d: DocumentEvidence): void {
    this.documents.push(d);
  }
  addLink(l: LinkEvidence): void {
    this.links.push(l);
  }
  setTasks(rows: TaskRow[]): void {
    this.tasks.splice(0, this.tasks.length, ...rows);
  }

  // --- finish -------------------------------------------------------------

  get result(): 'PASS' | 'FAIL' | 'WARN' {
    if (this.checks.some((c) => c.status === 'FAIL') || this.errors.length) return 'FAIL';
    if (this.checks.some((c) => c.status === 'WARN')) return 'WARN';
    return 'PASS';
  }

  counts(): ScenarioSummary['checks'] {
    return {
      pass: this.checks.filter((c) => c.status === 'PASS').length,
      fail: this.checks.filter((c) => c.status === 'FAIL').length,
      warn: this.checks.filter((c) => c.status === 'WARN').length,
      humanReview: this.checks.filter((c) => c.status === 'HUMAN_REVIEW').length,
    };
  }

  /** Write result.md and result.json and update execution.json. */
  finish(headline?: string): ScenarioResultJson {
    const completedAt = new Date().toISOString();
    const json: ScenarioResultJson = {
      scenario: this.code,
      slug: this.slug,
      label: this.label,
      employee: this.run.employee,
      caseId: this.caseId,
      caseNumber: this.caseNumber,
      caseUrl: this.caseUrl,
      separationType: this.type,
      result: this.result,
      checks: this.checks,
      emails: this.emails,
      documents: this.documents,
      tasks: this.tasks,
      links: this.links,
      screenshots: this.screenshots,
      auditEvents: this.auditEvents,
      errors: this.errors,
      facts: this.facts,
      startedAt: this.startedAt,
      completedAt,
    };
    writeFileSync(path.join(this.dir, 'result.json'), redactTokens(JSON.stringify(json, null, 2)));
    writeFileSync(path.join(this.dir, 'result.md'), this.renderMarkdown(json));
    updateExecution(this.run.runDir, (ex) => {
      const s = ex.scenarios.find((x) => x.code === this.code);
      if (!s) return;
      s.result = this.result;
      s.caseNumber = this.caseNumber;
      s.caseUrl = this.caseUrl;
      s.checks = this.counts();
      s.emails = this.emails.length;
      s.documents = this.documents.filter((d) => d.generated).length;
      s.links = this.links.filter((l) => l.generated).length;
      s.screenshots = this.screenshots.length;
      s.completedAt = completedAt;
      s.headline = headline ?? '';
      for (const c of this.checks) {
        if (c.status === 'FAIL')
          ex.exceptions.push({
            level: 'FAIL',
            scenario: `${this.code} ${this.label}`,
            text: `${c.title}${c.detail ? ': ' + c.detail : ''}`,
            href: `${scenarioDirName(this.code, this.slug)}/result.md`,
          });
        else if (c.status === 'WARN')
          ex.exceptions.push({
            level: 'WARNING',
            scenario: `${this.code} ${this.label}`,
            text: `${c.title}${c.detail ? ': ' + c.detail : ''}`,
            href: `${scenarioDirName(this.code, this.slug)}/result.md`,
          });
        else if (c.status === 'HUMAN_REVIEW')
          ex.exceptions.push({
            level: 'HUMAN_REVIEW',
            scenario: `${this.code} ${this.label}`,
            text: `${c.title}${c.detail ? ': ' + c.detail : ''}`,
            href: `${scenarioDirName(this.code, this.slug)}/result.md`,
          });
      }
      for (const f of this.errors)
        ex.exceptions.push({
          level: 'FAIL',
          scenario: `${this.code} ${this.label}`,
          text: `Step "${f.step}" failed: ${f.actual}`,
          href: `failures/`,
        });
    });
    this.log(`Scenario finished: ${this.result}.`);
    return json;
  }

  private renderMarkdown(j: ScenarioResultJson): string {
    const md: string[] = [];
    const facts = j.facts;
    md.push(`# ${j.scenario} - ${j.label}`);
    md.push('');
    md.push('```text');
    md.push(`Scenario:        ${j.scenario} - ${j.label}`);
    md.push(`Separation type: ${j.separationType}`);
    md.push(`Employee:        ${j.employee}`);
    md.push(`Result:          ${j.result}`);
    md.push(`Case ID:         ${j.caseNumber ?? 'not created'}`);
    md.push(
      `Environment:     UAT (APP_ENVIRONMENT=test) - email redirected to ${this.run.testMailbox}`,
    );
    md.push(`Started:         ${j.startedAt}`);
    md.push(`Completed:       ${j.completedAt}`);
    md.push('```');
    md.push('');
    if (Object.keys(facts).length) {
      md.push('## Facts recorded');
      md.push('');
      for (const [k, v] of Object.entries(facts)) {
        md.push(`- **${k}:** ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
      md.push('');
    }
    md.push('## Checks');
    md.push('');
    md.push('| # | Area | Check | Result | Detail | Evidence |');
    md.push('| --- | --- | --- | --- | --- | --- |');
    for (const c of j.checks) {
      const ev = c.evidence.map((e) => `[${e.label}](${e.href})`).join(' · ');
      const mark = c.automated ? c.status : `${c.status} (human)`;
      md.push(`| ${c.id} | ${c.area} | ${esc(c.title)} | ${mark} | ${esc(c.detail)} | ${ev} |`);
    }
    md.push('');
    md.push('AUTOMATED PASS/FAIL rows are machine-judged. HUMAN REVIEW REQUIRED rows are');
    md.push('presentational or business-content judgements the suite can only stage.');
    md.push('');
    md.push('## Summary');
    md.push('');
    md.push('```text');
    md.push(`Emails Generated:    ${j.emails.length}`);
    md.push(`Documents Generated: ${j.documents.filter((d) => d.generated).length}`);
    md.push(`Links Generated:     ${j.links.filter((l) => l.generated).length}`);
    md.push(`Screenshots:         ${j.screenshots.length}`);
    md.push(
      `Failures:            ${j.errors.length === 0 && j.checks.every((c) => c.status !== 'FAIL') ? 'None' : String(j.errors.length + j.checks.filter((c) => c.status === 'FAIL').length)}`,
    );
    md.push('```');
    md.push('');
    if (j.tasks.length) {
      md.push('## Task matrix');
      md.push('');
      md.push('| Task | Expected | Created | Owner | Due | Status | Priority | Result |');
      md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const t of j.tasks)
        md.push(
          `| ${esc(t.title)} (${t.code}) | ${yn(t.expected)} | ${yn(t.created)} | ${t.owner} | ${t.dueAt} | ${t.status} | ${t.priority} | ${t.result}${t.note ? ' - ' + esc(t.note) : ''} |`,
        );
      md.push('');
    }
    md.push('## Document matrix');
    md.push('');
    md.push(
      '| Document | Expected | Generated | Template | Status | Data correct | Result | File |',
    );
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    if (j.documents.length === 0)
      md.push('| (none expected for this separation type) | - | - | - | - | - | - | - |');
    for (const d of j.documents)
      md.push(
        `| ${d.documentType} v${d.version} | ${yn(d.expected)} | ${yn(d.generated)} | ${esc(d.template)} | ${d.status} | ${d.dataCorrect} | ${d.expected === d.generated ? (d.generated ? d.dataCorrect : 'PASS') : 'FAIL'} | ${d.file ? `[Open](${d.file})` : '-'} |`,
      );
    md.push('');
    md.push('## Email matrix');
    md.push('');
    md.push(
      '| # | Email | Intended recipient | Test recipient | Test mode | Status | Sent | Content | Result | Evidence |',
    );
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const e of j.emails)
      md.push(
        `| ${e.index} | ${esc(e.label)} | ${esc(e.intendedTo)}${e.intendedCc.length ? ' cc ' + esc(e.intendedCc.join(', ')) : ''} | ${esc(e.actualTo)} | ${e.testMode ? 'TEST' : 'LIVE'} | ${e.status}${e.deliveryStatus ? ' / ' + e.deliveryStatus : ''} | ${e.sentAt ?? (e.scheduledSendAt ? 'scheduled ' + e.scheduledSendAt : '-')} | ${e.contentChecks.every((c) => c.status === 'PASS') ? 'PASS' : e.contentChecks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'WARN'} | ${e.result} | [.eml](${e.file}) · [json](${e.jsonFile}) |`,
      );
    if (j.emails.length === 0)
      md.push('| - | (no email records on this case) | - | - | - | - | - | - | - | - |');
    md.push('');
    md.push('## Link matrix');
    md.push('');
    md.push(
      '| Link type | Expected | Generated | Resolves | Correct case | Permissions | Result | Evidence |',
    );
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const l of j.links)
      md.push(
        `| ${l.kind} | ${yn(l.expected)} | ${yn(l.generated)} | ${l.resolves} | ${l.correctCase} | ${l.permissions} | ${l.result} | ${l.file ? `[View](${l.file})` : '-'} |`,
      );
    if (j.links.length === 0) md.push('| - | - | - | - | - | - | - | - |');
    md.push('');
    md.push('## Screenshots');
    md.push('');
    for (const s of j.screenshots) md.push(`- [${esc(s.caption)}](${s.file})`);
    md.push('');
    md.push('## Audit');
    md.push('');
    md.push(
      `- ${j.auditEvents.length} audit events captured: [audit/timeline.md](audit/timeline.md), [audit/events.json](audit/events.json)`,
    );
    md.push('');
    if (j.errors.length) {
      md.push('## Failures');
      md.push('');
      for (const f of j.errors)
        md.push(`- **${esc(f.step)}**: ${esc(f.actual)} (see failures/ at the run root)`);
      md.push('');
    }
    md.push('## Logs');
    md.push('');
    md.push('- [logs/steps.log](logs/steps.log)');
    md.push('');
    return md.join('\n');
  }
}

function esc(s: string | undefined | null): string {
  return (s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
function yn(b: boolean): string {
  return b ? 'Yes' : 'No';
}
