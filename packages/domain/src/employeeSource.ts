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
