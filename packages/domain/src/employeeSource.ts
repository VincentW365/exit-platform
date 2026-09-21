/**
 * Employee source adapter boundary (REQ-INT-001, REQ-INT-017, DEC-018).
 *
 * BambooHR integration is a Stage 5 decision; Stage 1 uses a deterministic
 * synthetic adapter only. The interface is the contract later adapters must
 * satisfy. All fixture identities are fictional (TestStrategy.md section 3);
 * never add data derived from the source DMAIC appendices.
 */
export interface EmployeeSourceEmployee {
  readonly sourceSystem: string;
  readonly sourceId: string;
  readonly displayName: string;
  /** Synthetic work email; RESTRICTED-classified personal email is never stored here. */
  readonly workEmail: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly location: string;
  // Directive 6.1 (B): synthetic organization graph so hierarchy-driven
  // routing is fully testable without any real data.
  readonly division?: string;
  readonly employeeNumber?: string;
  readonly managerName?: string;
  readonly managerSourceId?: string;
  readonly active?: boolean;
  // Employee directory (owner directive, 2026-09-15): optional extra fields
  // the fixture may carry; the sync derives name parts from displayName when
  // a fixture leaves them out.
  readonly firstName?: string;
  readonly lastName?: string;
  readonly preferredName?: string;
  readonly workPhone?: string;
  readonly workExtension?: string;
  readonly employmentStatus?: string;
  readonly hireDate?: string;
}

export interface EmployeeSourceAdapter {
  readonly sourceSystem: string;
  search(query: string): Promise<readonly EmployeeSourceEmployee[]>;
  getById(sourceId: string): Promise<EmployeeSourceEmployee | null>;
}

/**
 * Canonical synthetic fixtures from TestStrategy.md, extended (Directive 6.1)
 * with a manager graph: two synthetic managers (006, 007), a report chain,
 * one employee with no manager (009) and one whose manager is inactive (010).
 * EMP-TEST-001..005 keep their established names — E2E suites depend on them.
 *
 * Departments and locations use the company's REAL org-unit names (branch and
 * function names only - never people; DEC-040) so synthetic data matches the
 * structure the live directory syncs. The two synthetic manager records are
 * named by function to match their dev accounts. The real directory does not
 * maintain divisions, so fixtures carry none.
 */
export const SYNTHETIC_EMPLOYEES: readonly EmployeeSourceEmployee[] = [
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-001',
    displayName: 'Avery Brown',
    workEmail: 'avery.brown@example.test',
    jobTitle: 'Parts Sales Associate',
    department: 'Sales',
    location: 'Molynes Road',
    employeeNumber: '1001',
    managerName: 'Operations Manager',
    managerSourceId: 'EMP-TEST-007',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-002',
    displayName: 'Jordan Lee',
    workEmail: 'jordan.lee@example.test',
    jobTitle: 'Warehouse Coordinator',
    department: 'Warehouse',
    location: 'Main Warehouse',
    employeeNumber: '1002',
    managerName: 'Warehouse Manager',
    managerSourceId: 'EMP-TEST-006',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-003',
    displayName: 'Morgan Reed',
    workEmail: 'morgan.reed@example.test',
    jobTitle: 'Accounts Clerk',
    department: 'Finance Department',
    location: 'Camp Road',
    employeeNumber: '1003',
    managerName: 'Operations Manager',
    managerSourceId: 'EMP-TEST-007',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-004',
    displayName: 'Taylor Singh',
    workEmail: 'taylor.singh@example.test',
    jobTitle: 'Service Advisor',
    department: 'Service Centre',
    location: 'Camp Road',
    employeeNumber: '1004',
    managerName: 'Warehouse Manager',
    managerSourceId: 'EMP-TEST-006',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-005',
    displayName: 'Casey Grant',
    workEmail: 'casey.grant@example.test',
    jobTitle: 'IT Support Technician',
    department: 'IT',
    location: 'Molynes Road',
    employeeNumber: '1005',
    managerName: 'Operations Manager',
    managerSourceId: 'EMP-TEST-007',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-006',
    displayName: 'Warehouse Manager',
    workEmail: 'rowan.achebe@example.test',
    jobTitle: 'Warehouse Manager',
    department: 'Warehouse',
    location: 'Main Warehouse',
    employeeNumber: '1006',
    managerName: 'Operations Manager',
    managerSourceId: 'EMP-TEST-007',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-007',
    displayName: 'Operations Manager',
    workEmail: 'samira.cole@example.test',
    jobTitle: 'Operations Manager',
    department: 'Operations',
    location: 'Camp Road',
    employeeNumber: '1007',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-008',
    displayName: 'Harper Nunez',
    workEmail: 'harper.nunez@example.test',
    jobTitle: 'Warehouse Assistant',
    department: 'Warehouse',
    location: 'Hagley Park',
    employeeNumber: '1008',
    managerName: 'Warehouse Manager',
    managerSourceId: 'EMP-TEST-006',
    active: true,
  },
  {
    // Missing-manager scenario (F): activation must demand an alternate.
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-009',
    displayName: 'Kai Mendes',
    workEmail: 'kai.mendes@example.test',
    jobTitle: 'Courier',
    department: 'Warehouse',
    location: 'Main Warehouse',
    employeeNumber: '1009',
    active: true,
  },
  {
    // Inactive-manager scenario (C): manager exists but is inactive.
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-010',
    displayName: 'Noor Petit',
    workEmail: 'noor.petit@example.test',
    jobTitle: 'Detailer',
    department: 'Service Centre',
    location: 'Camp Road',
    employeeNumber: '1010',
    managerName: 'Sasha Winter',
    managerSourceId: 'EMP-TEST-011',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-011',
    displayName: 'Sasha Winter',
    workEmail: 'sasha.winter@example.test',
    jobTitle: 'Service Centre Supervisor',
    department: 'Service Centre',
    location: 'Camp Road',
    employeeNumber: '1011',
    managerName: 'Operations Manager',
    managerSourceId: 'EMP-TEST-007',
    active: false,
  },
  // Human Resources. A directory without HR cannot exercise anything HR
  // receives - the exit checklist, or the colleagues copied on an employee's
  // acceptance letter - so the fixture organization has an HR department like
  // the real one does.
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-012',
    displayName: 'Rowan Ellis',
    workEmail: 'rowan.ellis@example.test',
    jobTitle: 'Human Resources Manager',
    department: 'Human Resources',
    location: 'Camp Road',
    employeeNumber: '1012',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-013',
    displayName: 'Devon Marsh',
    workEmail: 'devon.marsh@example.test',
    jobTitle: 'Human Resources Officer',
    department: 'Human Resources',
    location: 'Camp Road',
    employeeNumber: '1013',
    managerName: 'Rowan Ellis',
    managerSourceId: 'EMP-TEST-012',
    active: true,
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-014',
    displayName: 'Imani Blake',
    workEmail: 'imani.blake@example.test',
    jobTitle: 'Human Resources Officer',
    department: 'Human Resources',
    location: 'Molynes Road',
    employeeNumber: '1014',
    managerName: 'Rowan Ellis',
    managerSourceId: 'EMP-TEST-012',
    active: true,
  },

  // --- Hosted UAT generic population (owner directive, 2026-09-21) -----------
  // Obviously synthetic people for the hosted testing environment: named for
  // their purpose, reserved-domain mailboxes, GENERIC location labels (Head
  // Office, Branch A/B, Warehouse, Service Centre - not org units), fictional
  // 555 phone numbers. Deterministic: a constant, so every reset produces the
  // same people and relationships. Appended after the EMP-TEST fixtures, whose
  // positions and names the end-to-end suites depend on.
  //
  // Reporting graph: Casey Manager -> Riley Supervisor -> Jamie Notice / Skyler
  // Minimal; Casey also manages Avery Immediate and Cameron Termination.
  // Morgan HR manages both HR officers. Robin Unassigned has no manager.
  // Parker Employee reports to Quinn Former Manager, who is INACTIVE.
  // Skyler Minimal deliberately carries no hire date and no work phone.
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0001',
    displayName: 'Alex Admin',
    firstName: 'Alex',
    lastName: 'Admin',
    workEmail: 'alex.admin@example.test',
    jobTitle: 'System Administrator',
    department: 'Information Technology',
    location: 'Head Office',
    employeeNumber: 'UAT-0001',
    active: true,
    hireDate: '2019-03-04',
    workPhone: '876-555-0101',
    workExtension: '101',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0002',
    displayName: 'Morgan HR',
    firstName: 'Morgan',
    lastName: 'HR',
    workEmail: 'morgan.hr@example.test',
    jobTitle: 'HR Manager',
    department: 'Human Resources',
    location: 'Head Office',
    employeeNumber: 'UAT-0002',
    active: true,
    hireDate: '2017-06-12',
    workPhone: '876-555-0102',
    workExtension: '102',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0003',
    displayName: 'Taylor Officer',
    firstName: 'Taylor',
    lastName: 'Officer',
    workEmail: 'taylor.officer@example.test',
    jobTitle: 'HR Officer',
    department: 'Human Resources',
    location: 'Head Office',
    employeeNumber: 'UAT-0003',
    managerName: 'Morgan HR',
    managerSourceId: 'UAT-0002',
    active: true,
    hireDate: '2021-01-18',
    workPhone: '876-555-0103',
    workExtension: '103',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0004',
    displayName: 'Jordan Officer',
    firstName: 'Jordan',
    lastName: 'Officer',
    workEmail: 'jordan.officer@example.test',
    jobTitle: 'HR Officer',
    department: 'Human Resources',
    location: 'Branch B',
    employeeNumber: 'UAT-0004',
    managerName: 'Morgan HR',
    managerSourceId: 'UAT-0002',
    active: true,
    hireDate: '2022-09-05',
    workPhone: '876-555-0104',
    workExtension: '104',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0100',
    displayName: 'Casey Manager',
    firstName: 'Casey',
    lastName: 'Manager',
    workEmail: 'casey.manager@example.test',
    jobTitle: 'Operations Manager',
    department: 'Operations',
    location: 'Head Office',
    employeeNumber: 'UAT-0100',
    active: true,
    hireDate: '2015-02-02',
    workPhone: '876-555-0200',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0101',
    displayName: 'Riley Supervisor',
    firstName: 'Riley',
    lastName: 'Supervisor',
    workEmail: 'riley.supervisor@example.test',
    jobTitle: 'Operations Supervisor',
    department: 'Operations',
    location: 'Head Office',
    employeeNumber: 'UAT-0101',
    managerName: 'Casey Manager',
    managerSourceId: 'UAT-0100',
    active: true,
    hireDate: '2018-11-19',
    workPhone: '876-555-0201',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0200',
    displayName: 'Sam Finance',
    firstName: 'Sam',
    lastName: 'Finance',
    workEmail: 'sam.finance@example.test',
    jobTitle: 'Finance Manager',
    department: 'Finance',
    location: 'Head Office',
    employeeNumber: 'UAT-0200',
    active: true,
    hireDate: '2016-04-25',
    workPhone: '876-555-0300',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-0300',
    displayName: 'Drew IT',
    firstName: 'Drew',
    lastName: 'IT',
    workEmail: 'drew.it@example.test',
    jobTitle: 'IT Manager',
    department: 'Information Technology',
    location: 'Head Office',
    employeeNumber: 'UAT-0300',
    active: true,
    hireDate: '2018-08-13',
    workPhone: '876-555-0400',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1001',
    displayName: 'Jamie Notice',
    firstName: 'Jamie',
    lastName: 'Notice',
    workEmail: 'jamie.notice@example.test',
    jobTitle: 'Operations Associate',
    department: 'Operations',
    location: 'Head Office',
    employeeNumber: 'UAT-1001',
    managerName: 'Riley Supervisor',
    managerSourceId: 'UAT-0101',
    active: true,
    hireDate: '2020-05-11',
    workPhone: '876-555-0501',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1002',
    displayName: 'Avery Immediate',
    firstName: 'Avery',
    lastName: 'Immediate',
    workEmail: 'avery.immediate@example.test',
    jobTitle: 'Customer Service Representative',
    department: 'Customer Service',
    location: 'Branch A',
    employeeNumber: 'UAT-1002',
    managerName: 'Casey Manager',
    managerSourceId: 'UAT-0100',
    active: true,
    hireDate: '2021-10-04',
    workPhone: '876-555-0502',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1003',
    displayName: 'Cameron Termination',
    firstName: 'Cameron',
    lastName: 'Termination',
    workEmail: 'cameron.termination@example.test',
    jobTitle: 'Warehouse Associate',
    department: 'Warehouse',
    location: 'Warehouse',
    employeeNumber: 'UAT-1003',
    managerName: 'Casey Manager',
    managerSourceId: 'UAT-0100',
    active: true,
    hireDate: '2019-07-22',
    workPhone: '876-555-0503',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1101',
    displayName: 'Robin Unassigned',
    firstName: 'Robin',
    lastName: 'Unassigned',
    workEmail: 'robin.unassigned@example.test',
    jobTitle: 'Sales Representative',
    department: 'Sales',
    location: 'Branch B',
    employeeNumber: 'UAT-1101',
    active: true,
    hireDate: '2022-03-14',
    workPhone: '876-555-0601',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1102',
    displayName: 'Parker Employee',
    firstName: 'Parker',
    lastName: 'Employee',
    workEmail: 'parker.employee@example.test',
    jobTitle: 'Sales Associate',
    department: 'Sales',
    location: 'Branch A',
    employeeNumber: 'UAT-1102',
    managerName: 'Quinn Former Manager',
    managerSourceId: 'UAT-1103',
    active: true,
    hireDate: '2020-08-31',
    workPhone: '876-555-0602',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1103',
    displayName: 'Quinn Former Manager',
    firstName: 'Quinn',
    lastName: 'Former Manager',
    workEmail: 'quinn.former@example.test',
    jobTitle: 'Sales Manager',
    department: 'Sales',
    location: 'Branch A',
    employeeNumber: 'UAT-1103',
    active: false,
    employmentStatus: 'Inactive',
    hireDate: '2014-09-08',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'UAT-1104',
    displayName: 'Skyler Minimal',
    firstName: 'Skyler',
    lastName: 'Minimal',
    workEmail: 'skyler.minimal@example.test',
    jobTitle: 'General Associate',
    department: 'Operations',
    location: 'Service Centre',
    employeeNumber: 'UAT-1104',
    managerName: 'Riley Supervisor',
    managerSourceId: 'UAT-0101',
    active: true,
    // No hireDate and no workPhone on purpose: the profile must say
    // "Not recorded", never error.
  },
] as const;

export class SyntheticEmployeeSourceAdapter implements EmployeeSourceAdapter {
  readonly sourceSystem = 'SYNTHETIC';

  search(query: string): Promise<readonly EmployeeSourceEmployee[]> {
    const q = query.trim().toLowerCase();
    if (!q) return Promise.resolve([]);
    return Promise.resolve(
      SYNTHETIC_EMPLOYEES.filter(
        (e) =>
          e.displayName.toLowerCase().includes(q) ||
          e.sourceId.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q),
      ),
    );
  }

  getById(sourceId: string): Promise<EmployeeSourceEmployee | null> {
    return Promise.resolve(SYNTHETIC_EMPLOYEES.find((e) => e.sourceId === sourceId) ?? null);
  }
}
