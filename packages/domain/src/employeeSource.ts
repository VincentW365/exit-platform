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
}

export interface EmployeeSourceAdapter {
  readonly sourceSystem: string;
  search(query: string): Promise<readonly EmployeeSourceEmployee[]>;
  getById(sourceId: string): Promise<EmployeeSourceEmployee | null>;
}

/** Canonical synthetic fixtures from TestStrategy.md. */
export const SYNTHETIC_EMPLOYEES: readonly EmployeeSourceEmployee[] = [
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-001',
    displayName: 'Avery Brown',
    workEmail: 'avery.brown@example.test',
    jobTitle: 'Parts Sales Associate',
    department: 'Sales',
    location: 'Kingston',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-002',
    displayName: 'Jordan Lee',
    workEmail: 'jordan.lee@example.test',
    jobTitle: 'Warehouse Coordinator',
    department: 'Warehouse',
    location: 'Kingston',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-003',
    displayName: 'Morgan Reed',
    workEmail: 'morgan.reed@example.test',
    jobTitle: 'Accounts Clerk',
    department: 'Finance',
    location: 'Montego Bay',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-004',
    displayName: 'Taylor Singh',
    workEmail: 'taylor.singh@example.test',
    jobTitle: 'Service Advisor',
    department: 'Service',
    location: 'Kingston',
  },
  {
    sourceSystem: 'SYNTHETIC',
    sourceId: 'EMP-TEST-005',
    displayName: 'Casey Grant',
    workEmail: 'casey.grant@example.test',
    jobTitle: 'IT Support Technician',
    department: 'IT',
    location: 'Kingston',
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
