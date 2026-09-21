/**
 * Evidence recorder for the BambooHR directory checks (owner directive,
 * 2026-09-15, section 36). One folder, `BambooHR Directory/`, with a
 * subfolder per proof:
 *
 *   initial-sync/           the employee's profile after synchronization
 *   manager-resolution/     the manager linked by identifier
 *   manual-refresh/         Refresh Directory Now, progress and result
 *   webhook-update/         a signed employee-change webhook, and a refused one
 *   hourly-reconciliation/  the scheduler's decision and an hourly run
 *   offline-cache/          a simulated outage: cached directory still usable, then recovery
 *
 * Each subfolder holds numbered screenshots, the JSON the platform reported
 * (counts, statuses, field names - never a webhook key) and a notes.md a
 * reader can follow. Checks never throw; a failure is recorded and the next
 * proof runs (section 37).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Check, CheckStatus, EvidenceLink } from './evidence';
import { redactTokens } from './redact';
import { updateExecution, type RunContext } from './run';

export const DIRECTORY_DIR = 'BambooHR Directory';
export const DIRECTORY_SECTIONS = [
  'initial-sync',
  'manager-resolution',
  'manual-refresh',
  'webhook-update',
  'hourly-reconciliation',
  'offline-cache',
] as const;
export type DirectorySection = (typeof DIRECTORY_SECTIONS)[number];

export interface DirectorySectionSummary {
  name: DirectorySection;
  dir: string;
  screenshots: number;
  files: number;
  headline: string;
}

export interface DirectorySummary {
  result: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' | 'RUNNING';
  dir: string;
  checks: { pass: number; fail: number; warn: number; humanReview: number };
  sections: DirectorySectionSummary[];
  startedAt: string;
  completedAt: string | null;
  headline: string;
}

export interface DirectoryResultJson {
  employee: string;
  result: DirectorySummary['result'];
  checks: Check[];
  sections: DirectorySectionSummary[];
  facts: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
}

const SECRET_KEYS = /privateKey|secret|apiKey|signature|password|token/i;

/** Strip anything that could be a secret before it reaches a file. */
function safe<T>(value: T): T {
  if (Array.isArray(value)) return value.map(safe) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) continue;
      out[k] = safe(v);
    }
    return out as T;
  }
  return value;
}

export class DirectoryEvidence {
  readonly dir: string;
  readonly startedAt = new Date().toISOString();
  readonly checks: Check[] = [];
  readonly facts: Record<string, unknown> = {};
  private readonly lines: string[] = [];
  private readonly sections = new Map<DirectorySection, DirectorySectionSummary>();
  private readonly notes = new Map<DirectorySection, string[]>();
  private readonly shotIndex = new Map<DirectorySection, number>();
  private checkIndex = 0;

  constructor(readonly run: RunContext) {
    this.dir = path.join(run.runDir, DIRECTORY_DIR);
    for (const s of DIRECTORY_SECTIONS) mkdirSync(path.join(this.dir, s), { recursive: true });
    updateExecution(run.runDir, (ex) => {
      ex.directory = {
        result: 'RUNNING',
        dir: DIRECTORY_DIR,
        checks: { pass: 0, fail: 0, warn: 0, humanReview: 0 },
        sections: [],
        startedAt: this.startedAt,
        completedAt: null,
        headline: '',
      };
    });
    this.log('BambooHR Directory evidence started.');
  }

  log(line: string): void {
    this.lines.push(`${new Date().toISOString()} ${redactTokens(line)}`);
    writeFileSync(path.join(this.dir, 'steps.log'), this.lines.join('\n') + '\n');
  }

  fact(key: string, value: unknown): void {
    this.facts[key] = typeof value === 'string' ? redactTokens(value) : safe(value);
  }

  private summary(section: DirectorySection): DirectorySectionSummary {
    let s = this.sections.get(section);
    if (!s) {
      s = {
        name: section,
        dir: `${DIRECTORY_DIR}/${section}`,
        screenshots: 0,
        files: 0,
        headline: '',
      };
      this.sections.set(section, s);
    }
    return s;
  }

  /** A reader-facing line for the section's notes.md. */
  note(section: DirectorySection, line: string): void {
    const list = this.notes.get(section) ?? [];
    list.push(redactTokens(line));
    this.notes.set(section, list);
    this.writeNotes(section);
  }

  headline(section: DirectorySection, text: string): void {
    this.summary(section).headline = redactTokens(text);
  }

  async shot(
    section: DirectorySection,
    page: Page,
    name: string,
    caption?: string,
  ): Promise<string> {
    const n = (this.shotIndex.get(section) ?? 0) + 1;
    this.shotIndex.set(section, n);
    const file = `${String(n).padStart(2, '0')}_${name.replace(/[^a-z0-9]+/gi, '_')}.png`;
    const abs = path.join(this.dir, section, file);
    try {
      await page.screenshot({ path: abs, fullPage: true });
    } catch (e) {
      this.log(`screenshot ${section}/${file} failed: ${String(e)}`);
      return '';
    }
    this.summary(section).screenshots += 1;
    this.note(section, `Screenshot: [${caption ?? name.replace(/_/g, ' ')}](${file})`);
    return `${section}/${file}`;
  }

  /** Write what the platform reported, with secrets stripped. */
  json(section: DirectorySection, name: string, value: unknown): string {
    const file = `${name.replace(/[^a-z0-9.-]+/gi, '_')}.json`;
    writeFileSync(
      path.join(this.dir, section, file),
      redactTokens(JSON.stringify(safe(value), null, 2)),
    );
    this.summary(section).files += 1;
    this.note(section, `Data: [${file}](${file})`);
    return `${section}/${file}`;
  }

  text(section: DirectorySection, name: string, content: string): string {
    writeFileSync(path.join(this.dir, section, name), redactTokens(content));
    this.summary(section).files += 1;
    this.note(section, `File: [${name}](${name})`);
    return `${section}/${name}`;
  }

  private writeNotes(section: DirectorySection): void {
    const lines = this.notes.get(section) ?? [];
    const md = [
      `# ${section}`,
      '',
      `Employee: ${this.run.employee}`,
      '',
      ...lines.map((l) => `- ${l}`),
      '',
    ];
    writeFileSync(path.join(this.dir, section, 'notes.md'), md.join('\n'));
  }

  check(
    section: DirectorySection,
    title: string,
    status: CheckStatus,
    detail = '',
    evidence: EvidenceLink[] = [],
  ): Check {
    this.checkIndex += 1;
    const c: Check = {
      id: `DIR-C${String(this.checkIndex).padStart(2, '0')}`,
      area: section,
      title,
      status,
      detail: redactTokens(detail),
      evidence,
      automated: true,
      at: new Date().toISOString(),
    };
    this.checks.push(c);
    this.log(`${status.padEnd(12)} ${section}: ${title}${detail ? ' - ' + detail : ''}`);
    this.note(section, `${status}: ${title}${detail ? ` - ${detail}` : ''}`);
    return c;
  }

  expect(
    section: DirectorySection,
    title: string,
    condition: boolean,
    detail?: string,
    evidence?: EvidenceLink[],
  ): boolean {
    this.check(section, title, condition ? 'PASS' : 'FAIL', detail, evidence);
    return condition;
  }
  warn(section: DirectorySection, title: string, detail?: string): void {
    this.check(section, title, 'WARN', detail);
  }
  skip(section: DirectorySection, title: string, detail?: string): void {
    this.check(section, title, 'SKIPPED', detail);
  }

  /** Run a proof; an exception is recorded as a failure and the next proof runs. */
  async step<T>(
    section: DirectorySection,
    name: string,
    page: Page | null,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    this.log(`STEP ${section}: ${name}`);
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof Error ? (e.stack ?? e.message) : String(e);
      let shot = '';
      if (page) shot = await this.shot(section, page, `failure_${name}`, `Failure during ${name}`);
      this.text(
        section,
        `failure_${name.replace(/[^a-z0-9]+/gi, '_')}.md`,
        `# Failure: ${name}\n\n\`\`\`\n${err}\n\`\`\`\n`,
      );
      this.check(
        section,
        `Step "${name}" completed without error`,
        'FAIL',
        err.split('\n')[0] ?? err,
        shot ? [{ label: 'Screenshot', href: shot }] : [],
      );
      return undefined;
    }
  }

  get result(): DirectorySummary['result'] {
    if (this.checks.some((c) => c.status === 'FAIL')) return 'FAIL';
    if (this.checks.some((c) => c.status === 'WARN')) return 'WARN';
    return 'PASS';
  }

  counts(): DirectorySummary['checks'] {
    return {
      pass: this.checks.filter((c) => c.status === 'PASS').length,
      fail: this.checks.filter((c) => c.status === 'FAIL').length,
      warn: this.checks.filter((c) => c.status === 'WARN').length,
      humanReview: this.checks.filter((c) => c.status === 'HUMAN_REVIEW').length,
    };
  }

  finish(headline: string): DirectoryResultJson {
    const completedAt = new Date().toISOString();
    const sections = DIRECTORY_SECTIONS.map((s) => this.summary(s));
    const json: DirectoryResultJson = {
      employee: this.run.employee,
      result: this.result,
      checks: this.checks,
      sections,
      facts: this.facts,
      startedAt: this.startedAt,
      completedAt,
    };
    writeFileSync(path.join(this.dir, 'result.json'), redactTokens(JSON.stringify(json, null, 2)));
    const md: string[] = [];
    md.push(`# BambooHR Directory - ${this.result}`);
    md.push('');
    md.push(
      `Employee: **${this.run.employee}** · started ${this.startedAt} · completed ${completedAt}`,
    );
    md.push('');
    md.push(headline);
    md.push('');
    md.push('## Proofs');
    md.push('');
    for (const s of sections) {
      md.push(
        `- [${s.name}](${s.name}/notes.md) - ${s.screenshots} screenshot(s), ${s.files} file(s)${s.headline ? ` - ${s.headline}` : ''}`,
      );
    }
    md.push('');
    md.push('## Checks');
    md.push('');
    md.push('| Result | Proof | Check | Detail |');
    md.push('| --- | --- | --- | --- |');
    for (const c of this.checks) md.push(`| ${c.status} | ${c.area} | ${c.title} | ${c.detail} |`);
    md.push('');
    md.push('## Facts');
    md.push('');
    md.push('```json');
    md.push(redactTokens(JSON.stringify(this.facts, null, 2)));
    md.push('```');
    md.push('');
    writeFileSync(path.join(this.dir, 'result.md'), md.join('\n'));
    updateExecution(this.run.runDir, (ex) => {
      ex.directory = {
        result: this.result,
        dir: DIRECTORY_DIR,
        checks: this.counts(),
        sections,
        startedAt: this.startedAt,
        completedAt,
        headline,
      };
      for (const c of this.checks) {
        if (c.status === 'FAIL' || c.status === 'WARN')
          ex.exceptions.push({
            level: c.status === 'FAIL' ? 'FAIL' : 'WARNING',
            scenario: 'DIR BambooHR Directory',
            text: `${c.area}: ${c.title}${c.detail ? ': ' + c.detail : ''}`,
            href: `${DIRECTORY_DIR}/result.md`,
          });
      }
    });
    return json;
  }
}
