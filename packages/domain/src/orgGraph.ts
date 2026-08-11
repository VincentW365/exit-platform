/**
 * Organization graph and validation (Directive 6.1 sections B/C).
 *
 * Pure functions over the synchronized directory: build the manager graph
 * (employee → manager, manager → direct reports, manager's manager) and
 * validate it before hierarchy-driven routing is trusted. No employee names
 * are hard-coded anywhere; callers feed synchronized records.
 */

export interface OrgPerson {
  readonly sourceId: string;
  readonly displayName: string;
  readonly workEmail: string | null;
  readonly jobTitle: string | null;
  readonly department: string | null;
  readonly division: string | null;
  readonly location: string | null;
  readonly employeeNumber: string | null;
  readonly managerName: string | null;
  readonly managerSourceId: string | null;
  readonly active: boolean;
}

export interface OrgGraph {
  readonly people: readonly OrgPerson[];
  readonly bySourceId: ReadonlyMap<string, OrgPerson>;
  /** employee sourceId → resolved manager (null when unresolved/missing). */
  readonly managerOf: ReadonlyMap<string, OrgPerson | null>;
  /** manager sourceId → direct reports. */
  readonly directReports: ReadonlyMap<string, readonly OrgPerson[]>;
  /** display names that appear on more than one person (ambiguous manager refs). */
  readonly ambiguousNames: ReadonlySet<string>;
}

export function buildOrgGraph(people: readonly OrgPerson[]): OrgGraph {
  const bySourceId = new Map<string, OrgPerson>();
  const byName = new Map<string, OrgPerson[]>();
  for (const p of people) {
    bySourceId.set(p.sourceId, p);
    const list = byName.get(p.displayName) ?? [];
    list.push(p);
    byName.set(p.displayName, list);
  }
  const ambiguousNames = new Set<string>();
  for (const [name, list] of byName) if (list.length > 1) ambiguousNames.add(name);

  const managerOf = new Map<string, OrgPerson | null>();
  const directReports = new Map<string, OrgPerson[]>();
  for (const p of people) {
    let manager: OrgPerson | null = null;
    if (p.managerSourceId) {
      manager = bySourceId.get(p.managerSourceId) ?? null;
    } else if (p.managerName && !ambiguousNames.has(p.managerName)) {
      manager = byName.get(p.managerName)?.[0] ?? null;
    }
    managerOf.set(p.sourceId, manager);
    if (manager) {
      const reports = directReports.get(manager.sourceId) ?? [];
      reports.push(p);
      directReports.set(manager.sourceId, reports);
    }
  }
  return { people, bySourceId, managerOf, directReports, ambiguousNames };
}

export function managerChain(
  graph: OrgGraph,
  sourceId: string,
): { manager: OrgPerson | null; secondLevel: OrgPerson | null } {
  const manager = graph.managerOf.get(sourceId) ?? null;
  const secondLevel = manager ? (graph.managerOf.get(manager.sourceId) ?? null) : null;
  return { manager, secondLevel };
}

/** Detect manager cycles (self-reference is a length-1 cycle). */
export function managerCycles(graph: OrgGraph): readonly string[][] {
  const cycles: string[][] = [];
  const seenInCycle = new Set<string>();
  for (const p of graph.people) {
    if (seenInCycle.has(p.sourceId)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: OrgPerson | null = p;
    while (current) {
      const existing = pathIndex.get(current.sourceId);
      if (existing !== undefined) {
        const cycle = path.slice(existing);
        for (const id of cycle) seenInCycle.add(id);
        cycles.push(cycle);
        break;
      }
      if (seenInCycle.has(current.sourceId)) break;
      pathIndex.set(current.sourceId, path.length);
      path.push(current.sourceId);
      current = graph.managerOf.get(current.sourceId) ?? null;
    }
  }
  return cycles;
}

export type OrgSeverity = 'INFO' | 'WARNING' | 'ACTION_REQUIRED';
export type OrgHealth = 'HEALTHY' | 'WARNING' | 'ACTION_REQUIRED';

export interface OrgFinding {
  readonly checkId: string;
  readonly severity: OrgSeverity;
  /** Aggregate-safe subject (counts or reference ids; names only where HR-facing). */
  readonly subject: string;
  readonly detail: string;
}

export interface ResponderCoverage {
  /** Departments present in the directory. */
  readonly departments: readonly string[];
  /** Departments that have at least one HR/IT/Finance responder configured. */
  readonly coveredDepartments: readonly string[];
  readonly itResponders: number;
  readonly financeResponders: number;
  readonly hrResponders: number;
}

export interface OrgValidationReport {
  readonly health: OrgHealth;
  readonly stats: {
    readonly employees: number;
    readonly activeEmployees: number;
    readonly inactiveEmployees: number;
    readonly departments: number;
    readonly divisions: number;
    readonly positions: number;
    readonly locations: number;
    readonly managerRelationships: number;
  };
  readonly findings: readonly OrgFinding[];
}

export function validateOrg(graph: OrgGraph, coverage: ResponderCoverage): OrgValidationReport {
  const findings: OrgFinding[] = [];
  const people = graph.people;
  const active = people.filter((p) => p.active);

  const distinct = (values: Array<string | null>): number =>
    new Set(values.filter((v): v is string => Boolean(v && v.trim()))).size;

  const stats = {
    employees: people.length,
    activeEmployees: active.length,
    inactiveEmployees: people.length - active.length,
    departments: distinct(people.map((p) => p.department)),
    divisions: distinct(people.map((p) => p.division)),
    positions: distinct(people.map((p) => p.jobTitle)),
    locations: distinct(people.map((p) => p.location)),
    managerRelationships: [...graph.managerOf.values()].filter(Boolean).length,
  };

  const add = (checkId: string, severity: OrgSeverity, subject: string, detail: string) =>
    findings.push({ checkId, severity, subject, detail });

  // Missing managers (active employees only - departures don't need routing).
  const missingManager = active.filter(
    (p) =>
      !p.managerName && !p.managerSourceId && (graph.managerOf.get(p.sourceId) ?? null) === null,
  );
  if (missingManager.length > 0)
    add(
      'MISSING_MANAGER',
      'ACTION_REQUIRED',
      `${missingManager.length} active employee(s)`,
      `No manager recorded: ${missingManager
        .map((p) => p.sourceId)
        .slice(0, 10)
        .join(
          ', ',
        )}${missingManager.length > 10 ? '…' : ''}. Case activation for these employees will require an alternate manager.`,
    );

  // Manager referenced but not resolvable to a directory row.
  const unresolved = active.filter(
    (p) =>
      (p.managerName || p.managerSourceId) && (graph.managerOf.get(p.sourceId) ?? null) === null,
  );
  if (unresolved.length > 0)
    add(
      'MANAGER_NOT_IN_DIRECTORY',
      'WARNING',
      `${unresolved.length} employee(s)`,
      `Manager reference does not match a directory record (missing or ambiguous): ${unresolved
        .map((p) => p.sourceId)
        .slice(0, 10)
        .join(', ')}${unresolved.length > 10 ? '…' : ''}.`,
    );

  // Ambiguous manager names.
  if (graph.ambiguousNames.size > 0)
    add(
      'AMBIGUOUS_MANAGER_NAME',
      'WARNING',
      `${graph.ambiguousNames.size} duplicate display name(s)`,
      'More than one person shares a display name; name-based manager references are not auto-resolved for them.',
    );

  // Inactive managers with active reports.
  const inactiveManagers = new Set<string>();
  for (const p of active) {
    const m = graph.managerOf.get(p.sourceId);
    if (m && !m.active) inactiveManagers.add(m.sourceId);
  }
  if (inactiveManagers.size > 0)
    add(
      'INACTIVE_MANAGER',
      'ACTION_REQUIRED',
      `${inactiveManagers.size} manager(s)`,
      `Inactive manager(s) still have active reports: ${[...inactiveManagers].slice(0, 10).join(', ')}. Routing to them requires an alternate.`,
    );

  // Self-manager relationships.
  const selfManaged = people.filter(
    (p) => graph.managerOf.get(p.sourceId)?.sourceId === p.sourceId,
  );
  if (selfManaged.length > 0)
    add(
      'SELF_MANAGER',
      'ACTION_REQUIRED',
      `${selfManaged.length} record(s)`,
      `Employee listed as their own manager: ${selfManaged.map((p) => p.sourceId).join(', ')}.`,
    );

  // Circular hierarchy (excluding pure self-cycles reported above).
  const cycles = managerCycles(graph).filter((c) => c.length > 1);
  if (cycles.length > 0)
    add(
      'CIRCULAR_HIERARCHY',
      'ACTION_REQUIRED',
      `${cycles.length} cycle(s)`,
      `Manager relationships form a loop: ${cycles
        .map((c) => c.join(' → '))
        .slice(0, 3)
        .join(' | ')}.`,
    );

  // Duplicates.
  const dupBy = (label: string, values: Array<[string, string | null]>): void => {
    const seen = new Map<string, string[]>();
    for (const [id, v] of values) {
      if (!v) continue;
      const list = seen.get(v) ?? [];
      list.push(id);
      seen.set(v, list);
    }
    const dups = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    if (dups.length > 0)
      add(
        `DUPLICATE_${label}`,
        'WARNING',
        `${dups.length} duplicated value(s)`,
        dups
          .slice(0, 5)
          .map(([v, ids]) => `${v}: ${ids.join(', ')}`)
          .join(' | '),
      );
  };
  dupBy(
    'EMPLOYEE_NUMBER',
    people.map((p) => [p.sourceId, p.employeeNumber]),
  );
  dupBy(
    'WORK_EMAIL',
    people.map((p) => [p.sourceId, p.workEmail?.toLowerCase() ?? null]),
  );

  // Field completeness.
  const missingField = (
    label: string,
    predicate: (p: OrgPerson) => boolean,
    severity: OrgSeverity,
  ): void => {
    const rows = active.filter(predicate);
    if (rows.length > 0)
      add(
        `MISSING_${label}`,
        severity,
        `${rows.length} active employee(s)`,
        `${rows
          .map((p) => p.sourceId)
          .slice(0, 10)
          .join(', ')}${rows.length > 10 ? '…' : ''}`,
      );
  };
  missingField('DEPARTMENT', (p) => !p.department, 'ACTION_REQUIRED');
  missingField('POSITION', (p) => !p.jobTitle, 'WARNING');
  missingField('LOCATION', (p) => !p.location, 'WARNING');

  // Responder coverage per department.
  const uncovered = coverage.departments.filter((d) => !coverage.coveredDepartments.includes(d));
  if (coverage.itResponders === 0)
    add('NO_IT_RESPONDERS', 'ACTION_REQUIRED', 'IT', 'No active IT responders are configured.');
  if (coverage.financeResponders === 0)
    add(
      'NO_FINANCE_RESPONDERS',
      'ACTION_REQUIRED',
      'Finance',
      'No active Finance responders are configured.',
    );
  if (coverage.hrResponders === 0)
    add('NO_HR_RESPONDERS', 'ACTION_REQUIRED', 'HR', 'No active HR users are configured.');
  if (uncovered.length > 0)
    add(
      'DEPARTMENT_WITHOUT_RESPONDERS',
      'INFO',
      `${uncovered.length} department(s)`,
      `Departments with no department-specific responders (central IT/Finance/HR still route): ${uncovered.slice(0, 10).join(', ')}.`,
    );

  const health: OrgHealth = findings.some((f) => f.severity === 'ACTION_REQUIRED')
    ? 'ACTION_REQUIRED'
    : findings.some((f) => f.severity === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

  return { health, stats, findings };
}
