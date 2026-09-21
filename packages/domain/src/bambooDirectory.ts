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
  // Directive 6.1 (A): the manager RELATIONSHIP is an approved field; the id
  // variants let the org graph resolve managers without name matching.
  'supervisorId',
  'supervisorEId',
  'status',
  // Employee directory (owner directive, 2026-09-15): the remaining minimum
  // fields a directory needs - name parts for search, work phone and
  // extension for contact, hire date and employment status, and the source
  // system's own change stamp. Still no home, personal or pay data.
  'middleName',
  'workPhone',
  'workPhoneExtension',
  'hireDate',
  'lastChanged',
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
  /** Directory id of the supervisor when the API provides it (Directive 6.1 B). */
  managerSourceId: string | null;
  employeeNumber: string | null;
  active: boolean;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
  workPhone: string | null;
  workExtension: string | null;
  /** BambooHR employment status text (e.g. Active, Terminated) where returned. */
  employmentStatus: string | null;
  /** ISO date (yyyy-mm-dd) where returned. */
  hireDate: string | null;
  /** ISO instant where the API reports when the record last changed. */
  sourceUpdatedAt: string | null;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

// A date the API gives as yyyy-mm-dd (or a longer ISO string); "0000-00-00" is
// how BambooHR spells "none".
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s) || s.startsWith('0000')) return null;
  return s.slice(0, 10);
};
const isoInstant = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

// BambooHR renders an unset list field as the literal string "None"; treat it
// as absent so org statistics and validation never count a phantom unit.
const unitName = (v: unknown): string | null => {
  const s = str(v);
  return s && s.toLowerCase() !== 'none' ? s : null;
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
    department: unitName(raw['department']),
    division: unitName(raw['division']),
    location: unitName(raw['location']),
    managerName: str(raw['supervisor']),
    managerSourceId:
      str(raw['supervisorEId']) ??
      str(raw['supervisorId']) ??
      (typeof raw['supervisorEId'] === 'number'
        ? String(raw['supervisorEId'])
        : typeof raw['supervisorId'] === 'number'
          ? String(raw['supervisorId'])
          : null),
    employeeNumber: str(raw['employeeNumber']),
    // The public directory returns active employees; honour an explicit
    // status field when present.
    active: status === null ? true : status.toLowerCase() === 'active',
    firstName: str(raw['firstName']),
    middleName: str(raw['middleName']),
    lastName: str(raw['lastName']),
    preferredName: str(raw['preferredName']),
    workPhone: str(raw['workPhone']),
    workExtension: str(raw['workPhoneExtension']),
    employmentStatus: status,
    hireDate: isoDate(raw['hireDate']),
    sourceUpdatedAt: isoInstant(raw['lastChanged']),
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
