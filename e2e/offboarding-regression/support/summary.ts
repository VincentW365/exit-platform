/**
 * The run-level report (directive sections 34-36): one page that says what
 * was tested, what passed, what needs attention, and links straight to the
 * evidence. Built only from the files in the run folder.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readExecution, type Execution } from './run';
import type { ScenarioResultJson } from './evidence';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadScenarioResults(runDir: string): ScenarioResultJson[] {
  const out: ScenarioResultJson[] = [];
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^TEST-\d+-/.test(entry.name)) continue;
    const p = path.join(runDir, entry.name, 'result.json');
    if (!existsSync(p)) continue;
    try {
      out.push(JSON.parse(readFileSync(p, 'utf8')) as ScenarioResultJson);
    } catch {
      /* a half-written file is reported as missing */
    }
  }
  return out.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

function listFailures(runDir: string): string[] {
  const dir = path.join(runDir, 'failures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function overall(ex: Execution, results: ScenarioResultJson[]) {
  const passed = results.filter((r) => r.result === 'PASS').length;
  const warned = results.filter((r) => r.result === 'WARN').length;
  const failed = results.filter((r) => r.result === 'FAIL').length;
  const planned = ex.scenarios.length;
  const notRun = planned - results.length;
  const warnings = results.reduce(
    (n, r) => n + r.checks.filter((c) => c.status === 'WARN').length,
    0,
  );
  const human = results.reduce(
    (n, r) => n + r.checks.filter((c) => c.status === 'HUMAN_REVIEW').length,
    0,
  );
  return { passed, warned, failed, planned, notRun, warnings, human };
}

const MARK: Record<string, string> = {
  PASS: '✓',
  WARN: '△',
  FAIL: '✗',
  SKIPPED: '–',
  RUNNING: '…',
};

export function buildSummary(runDir: string): void {
  const ex = readExecution(runDir);
  if (!ex) return;
  const results = loadScenarioResults(runDir);
  const o = overall(ex, results);
  const failures = listFailures(runDir);
  const resultOf = (code: string) => results.find((r) => r.scenario === code);

  // Exceptions at the top: FAIL first, then WARNING, then HUMAN REVIEW.
  const order = { FAIL: 0, WARNING: 1, HUMAN_REVIEW: 2, PASS: 3 } as const;
  const exceptions = [...ex.exceptions].sort((a, b) => order[a.level] - order[b.level]);
  const critical = exceptions.filter((e) => e.level === 'FAIL');

  // ---------- summary.md ----------
  const md: string[] = [];
  md.push(`# Offboarding end-to-end regression - run ${ex.runId}`);
  md.push('');
  md.push('## Exceptions / Issues Requiring Attention');
  md.push('');
  if (critical.length === 0) md.push('**No critical exceptions detected.**');
  for (const e of exceptions) {
    if (e.level === 'PASS') continue;
    md.push(
      `- **${e.level === 'HUMAN_REVIEW' ? 'HUMAN REVIEW' : e.level}** ${e.scenario}: ${e.text}${e.href ? ` ([evidence](${e.href}))` : ''}`,
    );
  }
  md.push('');
  md.push('## Overall Run');
  md.push('');
  md.push('```text');
  md.push(`Employee:    ${ex.employee}`);
  md.push(`Environment: ${ex.environment} (APP_ENVIRONMENT=test)`);
  md.push(
    `Email Mode:  ${ex.emailMode} - every message redirected to ${ex.testMailbox}; provider = development capture (nothing leaves the machine)`,
  );
  md.push(`Application: commit ${ex.appCommit ?? 'unknown'} at ${ex.baseUrl}`);
  md.push(`Started:     ${ex.startedAt}`);
  md.push(`Completed:   ${ex.completedAt ?? 'not completed'}`);
  md.push(`Scenarios:   ${o.planned}`);
  md.push(`Passed:      ${o.passed}`);
  md.push(`Passed with warnings: ${o.warned}`);
  md.push(`Failed:      ${o.failed}${o.notRun ? ` (not run: ${o.notRun})` : ''}`);
  md.push(`Warnings:    ${o.warnings}`);
  md.push(`Human review items: ${o.human}`);
  md.push('```');
  md.push('');
  md.push('## Scenarios');
  md.push('');
  md.push(
    '| | Scenario | Type | Case | Result | Checks (pass/fail/warn/human) | Emails | Documents | Links | Screenshots | Evidence |',
  );
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of ex.scenarios) {
    const r = resultOf(s.code);
    const c = s.checks;
    md.push(
      `| ${MARK[s.result] ?? '?'} | ${s.code} ${s.label} | ${s.type} | ${s.caseNumber ?? '-'} | ${s.result} | ${c.pass}/${c.fail}/${c.warn}/${c.humanReview} | ${s.emails} | ${s.documents} | ${s.links} | ${s.screenshots} | ${r ? `[result.md](${s.dir}/result.md)` : '(no result file)'} |`,
    );
  }
  md.push('');
  md.push('## Run notes');
  md.push('');
  for (const n of ex.notes) md.push(`- ${n}`);
  md.push('');
  if (failures.length) {
    md.push('## Failure records');
    md.push('');
    for (const f of failures) md.push(`- [failures/${f}](failures/${f}/failure.md)`);
    md.push('');
  }
  writeFileSync(path.join(runDir, 'summary.md'), md.join('\n'));

  // ---------- README.md ----------
  const readme = [
    `# Offboarding regression evidence - ${ex.runId}`,
    '',
    'Open **summary.html** in a browser for the navigable report, or **summary.md** for the same in text.',
    '',
    '```text',
    `Employee:      ${ex.employee}`,
    `Environment:   UAT (APP_ENVIRONMENT=test)`,
    `Email mode:    TEST - redirected to ${ex.testMailbox}, captured by the development adapter`,
    `Scenarios:     ${o.planned} planned, ${o.passed} passed, ${o.warned} passed with warnings, ${o.failed} failed`,
    '```',
    '',
    '## Folder layout',
    '',
    '```text',
    'README.md          this file',
    'summary.html       navigable report with the exception section first',
    'summary.md         the same report as text',
    'execution.json     machine-readable run record',
    'run-context.json   posture, directory facts, mailbox',
    'failures/          one folder per recorded failure (error, log, screenshot)',
    'TEST-0N-<type>/    one folder per separation type:',
    '  result.md        human-readable result with every check and matrix',
    '  result.json      machine-readable result',
    '  screenshots/     numbered, named screenshots',
    '  emails/          NN-<Type>.eml + .json for every email record, routing.md',
    '  documents/       generated PDFs and their checks',
    '  links/           one file per generated link (tokens redacted)',
    '  logs/            step log',
    '  audit/           events.json and timeline.md',
    '```',
    '',
    '## How to read a scenario',
    '',
    '1. Its result.md opens with the case number, dates and the outcome.',
    '2. The Checks table is the verdict list: AUTOMATED PASS/FAIL rows are machine-judged;',
    '   HUMAN REVIEW REQUIRED rows are staged for a person (wording, presentation).',
    '3. Task, document, email and link matrices follow, each linking to its evidence.',
    '',
    '## Safety',
    '',
    '- Every case is a TEST-purpose record: excluded from every report and KPI, shown with the UAT banner.',
    '- The source directory record was read, never written.',
    '- No email left the machine: the development capture adapter is the only provider available,',
    '  and the UAT posture redirects every message to the one test mailbox before that.',
    '- Secret link tokens are redacted in every file here.',
    '- When the controlled employee is a real directory person, this folder holds live HR directory',
    '  data (names, work addresses in email evidence). It is gitignored: keep it local, never share it',
    '  or commit it (CLAUDE.md, platform banner).',
    '',
  ];
  writeFileSync(path.join(runDir, 'README.md'), readme.join('\n'));

  // ---------- summary.html ----------
  const h: string[] = [];
  h.push(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  );
  h.push(`<title>Offboarding regression - ${esc(ex.runId)}</title>`);
  h.push('<style>');
  h.push(
    'body{font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1c2430}main{max-width:1180px;margin:0 auto;padding:24px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}.sub{color:#5b6573;margin:0 0 18px}.card{background:#fff;border:1px solid #dfe3e8;border-radius:8px;padding:16px 18px;margin:12px 0}.exc{border-left:5px solid #c62828}.exc.ok{border-left-color:#2e7d32}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em}.PASS{background:#e6f4ea;color:#1e6b34}.WARN,.WARNING{background:#fff4e0;color:#8a5a00}.FAIL{background:#fdecea;color:#a12622}.HUMAN_REVIEW{background:#e8eefc;color:#2c4a9a}.SKIPPED,.RUNNING{background:#eef0f3;color:#4b5563}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e6e9ee;padding:7px 8px;text-align:left;vertical-align:top}th{background:#f0f2f5;font-weight:600}code{background:#f0f2f5;padding:1px 4px;border-radius:3px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}.mark{font-size:18px;width:1.4em;display:inline-block}ul.tight{margin:6px 0;padding-left:18px}ul.tight li{margin:3px 0}.muted{color:#6b7480}a{color:#1a4fa3}.kv{display:grid;grid-template-columns:180px 1fr;gap:4px 12px;font-size:13px}.kv b{font-weight:600}',
  );
  h.push('</style></head><body><main>');
  h.push(
    `<h1>Offboarding end-to-end regression</h1><p class="sub">Run ${esc(ex.runId)} · Employee <b>${esc(ex.employee)}</b> · Environment UAT · Email mode TEST · Application commit <code>${esc(ex.appCommit ?? 'unknown')}</code></p>`,
  );

  h.push(
    `<div class="card exc${critical.length ? '' : ' ok'}"><h2 style="margin-top:0">Exceptions / Issues Requiring Attention</h2>`,
  );
  if (critical.length === 0) h.push('<p><b>No critical exceptions detected.</b></p>');
  if (exceptions.some((e) => e.level !== 'PASS')) {
    h.push('<ul class="tight">');
    for (const e of exceptions) {
      if (e.level === 'PASS') continue;
      h.push(
        `<li><span class="badge ${esc(e.level)}">${esc(e.level === 'HUMAN_REVIEW' ? 'HUMAN REVIEW' : e.level)}</span> <b>${esc(e.scenario)}</b>: ${esc(e.text)}${e.href ? ` <a href="${esc(e.href)}">evidence</a>` : ''}</li>`,
      );
    }
    h.push('</ul>');
  }
  h.push('</div>');

  h.push('<div class="card"><h2 style="margin-top:0">Overall Run</h2><div class="kv">');
  const kv: Array<[string, string]> = [
    ['Employee', ex.employee],
    ['Environment', 'UAT (APP_ENVIRONMENT=test)'],
    [
      'Email mode',
      `TEST - every message redirected to ${ex.testMailbox}; provider = development capture (nothing leaves the machine)`,
    ],
    ['Application', `${ex.baseUrl} (commit ${ex.appCommit ?? 'unknown'})`],
    ['Started / completed', `${ex.startedAt} / ${ex.completedAt ?? 'not completed'}`],
    ['Scenarios', String(o.planned)],
    ['Passed', `${o.passed}${o.warned ? ` (+${o.warned} with warnings)` : ''}`],
    ['Failed', `${o.failed}${o.notRun ? ` (not run: ${o.notRun})` : ''}`],
    ['Warnings', String(o.warnings)],
    ['Human review items', String(o.human)],
  ];
  for (const [k, v] of kv) h.push(`<b>${esc(k)}</b><span>${esc(v)}</span>`);
  h.push('</div></div>');

  h.push('<h2>Workflows</h2><div class="grid">');
  for (const s of ex.scenarios) {
    const r = resultOf(s.code);
    h.push(
      `<div class="card"><div><span class="mark">${esc(MARK[s.result] ?? '?')}</span><b>${esc(s.code)} ${esc(s.label)}</b> <span class="badge ${esc(s.result)}">${esc(s.result)}</span></div>`,
    );
    h.push(`<div class="muted">${esc(s.type)} · case ${esc(s.caseNumber ?? '-')}</div>`);
    h.push(
      `<div class="kv" style="margin-top:8px"><b>Checks</b><span>${s.checks.pass} pass · ${s.checks.fail} fail · ${s.checks.warn} warn · ${s.checks.humanReview} human review</span><b>Emails</b><span>${s.emails}</span><b>Documents</b><span>${s.documents}</span><b>Links</b><span>${s.links}</span><b>Screenshots</b><span>${s.screenshots}</span></div>`,
    );
    if (s.headline) h.push(`<p>${esc(s.headline)}</p>`);
    if (r) {
      h.push('<ul class="tight">');
      h.push(
        `<li><a href="${esc(s.dir)}/result.md">Scenario result (result.md)</a> · <a href="${esc(s.dir)}/result.json">result.json</a></li>`,
      );
      h.push(
        `<li><a href="${esc(s.dir)}/screenshots/">Screenshots</a> · <a href="${esc(s.dir)}/emails/">Emails</a> · <a href="${esc(s.dir)}/documents/">Documents</a> · <a href="${esc(s.dir)}/links/">Links</a> · <a href="${esc(s.dir)}/audit/timeline.md">Audit timeline</a></li>`,
      );
      h.push('</ul>');
      const notable = r.checks.filter((c) => c.status !== 'PASS');
      if (notable.length) {
        h.push('<details><summary>Checks needing attention</summary><ul class="tight">');
        for (const c of notable)
          h.push(
            `<li><span class="badge ${esc(c.status)}">${esc(c.status === 'HUMAN_REVIEW' ? 'HUMAN REVIEW' : c.status)}</span> ${esc(c.title)}${c.detail ? ` - ${esc(c.detail)}` : ''}${c.evidence.map((e) => ` <a href="${esc(s.dir)}/${esc(e.href)}">${esc(e.label)}</a>`).join('')}</li>`,
          );
        h.push('</ul></details>');
      }
      h.push(
        '<details><summary>All checks</summary><table><tr><th>Area</th><th>Check</th><th>Result</th><th>Detail</th><th>Evidence</th></tr>',
      );
      for (const c of r.checks)
        h.push(
          `<tr><td>${esc(c.area)}</td><td>${esc(c.title)}</td><td><span class="badge ${esc(c.status)}">${esc(c.status === 'HUMAN_REVIEW' ? 'HUMAN REVIEW' : c.status)}</span>${c.automated ? '' : ' <span class="muted">(human)</span>'}</td><td>${esc(c.detail)}</td><td>${c.evidence.map((e) => `<a href="${esc(s.dir)}/${esc(e.href)}">${esc(e.label)}</a>`).join(' · ')}</td></tr>`,
        );
      h.push('</table></details>');
    } else {
      h.push('<p class="muted">No result file was written for this scenario.</p>');
    }
    h.push('</div>');
  }
  h.push('</div>');

  h.push('<h2>Run notes</h2><div class="card"><ul class="tight">');
  for (const n of ex.notes) h.push(`<li>${esc(n)}</li>`);
  h.push('</ul></div>');
  if (failures.length) {
    h.push('<h2>Failure records</h2><div class="card"><ul class="tight">');
    for (const f of failures)
      h.push(`<li><a href="failures/${esc(f)}/failure.md">${esc(f)}</a></li>`);
    h.push('</ul></div>');
  }
  h.push(
    '<p class="muted">AUTOMATED PASS/FAIL rows are machine-judged. HUMAN REVIEW REQUIRED rows are presentational or business-content judgements that the suite can only stage. Secret link tokens are redacted throughout.</p>',
  );
  h.push('</main></body></html>');
  writeFileSync(path.join(runDir, 'summary.html'), h.join('\n'));
}
