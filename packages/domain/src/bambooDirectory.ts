/**
 * BambooHR directory field policy (Directive 5.1 sections B/C).
 *
 * The live adapter is READ-ONLY and this module is the single mapping
 * boundary: whatever the API returns, only the allowed minimum fields survive
 * into memory or persistence - everything else is discarded here, before any
 * caller sees it. Pure functions; unit-tested with synthetic values only.
 */

/** C: the approved minimum directory field set (BambooHR directory names). */
export const BAMBOO_ALLOWED_SOURCE_FIELDS = [
  'id',
  'employeeNumber',
  'firstName',
  'lastName',
  'preferredName',
  'displayName',
  'workEmail',
  'department',
  'division',
  'location',
  'jobTitle',
  'supervisor',
  'status',
] as const;

/**
 * C: categories that must never be imported. Kept as an executable denylist so
 * a test can prove the mapper discards them even when the API returns them.
 */
export const BAMBOO_FORBIDDEN_FIELD_PATTERNS = [
  /salary|pay(rate|roll)?|compensation/i,
  /bank|account|routing/i,
  /tax|trn|nis|ssn|national/i,
  /home|address|city|state|zip/i,
  /personal(phone|email)|mobilePhone|homePhone/i,
  /medical|health/i,
  /emergency/i,
  /benefit/i,
  /disciplin|performance/i,
  /note|attachment|photo/i,
  /birth|dob|age|gender|marital|ethnicity/i,
] as const;

export interface DirectoryEmployee {
  sourceId: string;
  displayName: string;
  workEmail: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  managerName: string | null;
  employeeNumber: string | null;
  active: boolean;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Map ONE raw directory row to the approved minimum shape. Returns null when
 * the row has no usable identifier or name. Every field not explicitly mapped
 * here is dropped (C: "discard them before persistence").
 */
export function mapBambooDirectoryEmployee(raw: Record<string, unknown>): DirectoryEmployee | null {
  const sourceId = str(raw['id']) ?? (typeof raw['id'] === 'number' ? String(raw['id']) : null);
  const displayName =
    str(raw['displayName']) ??
    (str(raw['preferredName']) || str(raw['firstName'])
      ? `${str(raw['preferredName']) ?? str(raw['firstName']) ?? ''} ${str(raw['lastName']) ?? ''}`.trim()
      : null);
  if (!sourceId || !displayName) return null;
  const status = str(raw['status']);
  return {
    sourceId,
    displayName,
    workEmail: str(raw['workEmail']),
    jobTitle: str(raw['jobTitle']),
    department: str(raw['department']),
    division: str(raw['division']),
    location: str(raw['location']),
    managerName: str(raw['supervisor']),
    employeeNumber: str(raw['employeeNumber']),
    // The public directory returns active employees; honour an explicit
    // status field when present.
    active: status === null ? true : status.toLowerCase() === 'active',
  };
}

/** L.4: aggregate, PII-free connection-proof counts. */
export interface DirectoryAggregates {
  employees: number;
  departments: number;
  positions: number;
  locations: number;
  withManager: number;
  missingDepartment: number;
  missingPosition: number;
}

export function directoryAggregates(
  rows: ReadonlyArray<
    Pick<DirectoryEmployee, 'department' | 'jobTitle' | 'location' | 'managerName'>
  >,
): DirectoryAggregates {
  const departments = new Set<string>();
  const positions = new Set<string>();
  const locations = new Set<string>();
  let withManager = 0;
  let missingDepartment = 0;
  let missingPosition = 0;
  for (const r of rows) {
    if (r.department) departments.add(r.department);
    else missingDepartment += 1;
    if (r.jobTitle) positions.add(r.jobTitle);
    else missingPosition += 1;
    if (r.location) locations.add(r.location);
    if (r.managerName) withManager += 1;
  }
  return {
    employees: rows.length,
    departments: departments.size,
    positions: positions.size,
    locations: locations.size,
    withManager,
    missingDepartment,
    missingPosition,
  };
}
