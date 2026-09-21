/**
 * Hosted UAT generic population (owner directive, 2026-09-21).
 *
 * The hosted testing environment is populated with obviously synthetic
 * people whose relationships are DETERMINISTIC - a constant in the fixture
 * source - so every reset produces the same organization. These tests pin
 * the shape the UAT acceptance checks rely on, and the boundaries that keep
 * it synthetic: reserved-domain mailboxes, generic location labels, fictional
 * phone numbers, no real org units.
 */
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_EMPLOYEES, type EmployeeSourceEmployee } from '../src/employeeSource.ts';

const UAT = SYNTHETIC_EMPLOYEES.filter((e) => e.sourceId.startsWith('UAT-'));
const byId = new Map<string, EmployeeSourceEmployee>(UAT.map((e) => [e.sourceId, e]));
const get = (id: string): EmployeeSourceEmployee => {
  const e = byId.get(id);
  if (!e) throw new Error(`missing ${id}`);
  return e;
};

const GENERIC_LOCATIONS = ['Head Office', 'Branch A', 'Branch B', 'Warehouse', 'Service Centre'];
const DIRECTIVE_DEPARTMENTS = [
  'Operations',
  'Finance',
  'Human Resources',
  'Information Technology',
  'Sales',
  'Customer Service',
  'Warehouse',
];

describe('hosted UAT generic population', () => {
  it('is appended after the EMP-TEST fixtures, which the e2e suites index by position', () => {
    expect(SYNTHETIC_EMPLOYEES[0]?.sourceId).toBe('EMP-TEST-001');
    const firstUat = SYNTHETIC_EMPLOYEES.findIndex((e) => e.sourceId.startsWith('UAT-'));
    const lastEmp = SYNTHETIC_EMPLOYEES.map((e) => e.sourceId.startsWith('EMP-TEST-')).lastIndexOf(
      true,
    );
    expect(firstUat).toBeGreaterThan(lastEmp);
  });

  it('has the fifteen directive identities, each once, numbered as specified', () => {
    expect(UAT).toHaveLength(15);
    expect(new Set(UAT.map((e) => e.sourceId)).size).toBe(15);
    for (const [id, name] of [
      ['UAT-0001', 'Alex Admin'],
      ['UAT-0002', 'Morgan HR'],
      ['UAT-0003', 'Taylor Officer'],
      ['UAT-0004', 'Jordan Officer'],
      ['UAT-0100', 'Casey Manager'],
      ['UAT-0101', 'Riley Supervisor'],
      ['UAT-0200', 'Sam Finance'],
      ['UAT-0300', 'Drew IT'],
      ['UAT-1001', 'Jamie Notice'],
      ['UAT-1002', 'Avery Immediate'],
      ['UAT-1003', 'Cameron Termination'],
      ['UAT-1101', 'Robin Unassigned'],
      ['UAT-1102', 'Parker Employee'],
      ['UAT-1103', 'Quinn Former Manager'],
      ['UAT-1104', 'Skyler Minimal'],
    ] as const) {
      expect(get(id).displayName).toBe(name);
      // The employee number IS the identifier: obviously synthetic, searchable.
      expect(get(id).employeeNumber).toBe(id);
    }
  });

  it('stays synthetic: reserved-domain mail, generic locations, fictional phones, no org units', () => {
    for (const e of UAT) {
      expect(e.sourceSystem).toBe('SYNTHETIC');
      expect(e.workEmail.endsWith('@example.test')).toBe(true);
      expect(GENERIC_LOCATIONS).toContain(e.location);
      expect(DIRECTIVE_DEPARTMENTS).toContain(e.department);
      if (e.workPhone) expect(e.workPhone).toMatch(/^876-555-\d{4}$/);
      expect(e.firstName && e.lastName).toBeTruthy();
    }
  });

  it('links every manager by identifier to a record in the same population', () => {
    for (const e of UAT) {
      if (!e.managerSourceId) continue;
      expect(byId.has(e.managerSourceId)).toBe(true);
      expect(e.managerName).toBe(get(e.managerSourceId).displayName);
    }
  });

  it('carries the reporting chain the acceptance checks walk', () => {
    expect(get('UAT-0101').managerSourceId).toBe('UAT-0100'); // Riley -> Casey
    expect(get('UAT-1001').managerSourceId).toBe('UAT-0101'); // Jamie -> Riley
    expect(get('UAT-1002').managerSourceId).toBe('UAT-0100'); // Avery Immediate -> Casey
    expect(get('UAT-1003').managerSourceId).toBe('UAT-0100'); // Cameron -> Casey
    expect(get('UAT-0003').managerSourceId).toBe('UAT-0002'); // Taylor -> Morgan HR
    expect(get('UAT-0004').managerSourceId).toBe('UAT-0002'); // Jordan -> Morgan HR
    for (const root of ['UAT-0001', 'UAT-0002', 'UAT-0100', 'UAT-0200', 'UAT-0300']) {
      expect(get(root).managerSourceId).toBeUndefined();
    }
  });

  it('carries the directory edge cases', () => {
    // No manager at all.
    expect(get('UAT-1101').managerSourceId).toBeUndefined();
    expect(get('UAT-1101').managerName).toBeUndefined();
    // Inactive manager, link preserved.
    expect(get('UAT-1103').active).toBe(false);
    expect(get('UAT-1103').employmentStatus).toBe('Inactive');
    expect(get('UAT-1102').managerSourceId).toBe('UAT-1103');
    // Missing optional fields -> "Not recorded", never an error.
    expect(get('UAT-1104').hireDate).toBeUndefined();
    expect(get('UAT-1104').workPhone).toBeUndefined();
    expect(get('UAT-1104').active).toBe(true);
  });

  it('gives the three separation workflows their own employees', () => {
    const workflow = ['UAT-1001', 'UAT-1002', 'UAT-1003'].map(get);
    expect(new Set(workflow.map((e) => e.sourceId)).size).toBe(3);
    expect(workflow.every((e) => e.active)).toBe(true);
    // Deliberately distinct departments and locations, so filters can tell them apart.
    expect(new Set(workflow.map((e) => e.department)).size).toBe(3);
    expect(new Set(workflow.map((e) => e.location)).size).toBe(3);
  });
});
