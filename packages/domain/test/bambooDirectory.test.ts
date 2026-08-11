/**
 * Directive 5.1 K.4/K.5/K.17: field-policy mapping and branding constants.
 * Synthetic values only - never real employee data.
 */
import { describe, expect, it } from 'vitest';
import {
  BRAND,
  directoryAggregates,
  mapBambooDirectoryEmployee,
  type DirectoryEmployee,
} from '../src/index.ts';

describe('BambooHR directory field policy (C)', () => {
  const rawWithForbiddenFields = {
    id: '9001',
    displayName: 'Avery Brown',
    firstName: 'Avery',
    lastName: 'Brown',
    preferredName: 'Avery',
    workEmail: 'avery.brown@example.test',
    jobTitle: 'Parts Sales Associate',
    department: 'Sales',
    division: 'Retail',
    location: 'Kingston',
    supervisor: 'Jamie Douglas',
    employeeNumber: 'EMP-TEST-001',
    status: 'Active',
    // Everything below MUST be discarded (C: forbidden categories).
    payRate: '999999',
    salary: '999999',
    bankAccountNumber: '000-111-222',
    taxId: 'TRN-0000000',
    homeAddress: '1 Private Lane',
    homePhone: '555-0000',
    mobilePhone: '555-0001',
    personalEmail: 'private@example.invalid',
    medicalNotes: 'confidential',
    emergencyContact: 'someone',
    benefitClass: 'A',
    dateOfBirth: '1990-01-01',
    photoUrl: 'https://example.invalid/photo.jpg',
  };

  it('maps ONLY the approved minimum fields and discards everything else', () => {
    const mapped = mapBambooDirectoryEmployee(rawWithForbiddenFields)!;
    expect(mapped).toEqual({
      sourceId: '9001',
      displayName: 'Avery Brown',
      workEmail: 'avery.brown@example.test',
      jobTitle: 'Parts Sales Associate',
      department: 'Sales',
      division: 'Retail',
      location: 'Kingston',
      managerName: 'Jamie Douglas',
      managerSourceId: null,
      employeeNumber: 'EMP-TEST-001',
      active: true,
    });
    const serialized = JSON.stringify(mapped);
    for (const forbidden of [
      '999999',
      '000-111-222',
      'TRN-0000000',
      'Private Lane',
      '555-000',
      'private@example.invalid',
      'confidential',
      '1990-01-01',
      'photo',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('drops rows without a usable identifier or name', () => {
    expect(mapBambooDirectoryEmployee({ displayName: 'No Id' })).toBeNull();
    expect(mapBambooDirectoryEmployee({ id: '77' })).toBeNull();
  });

  it('derives display name and inactive status when needed', () => {
    const mapped = mapBambooDirectoryEmployee({
      id: 42,
      firstName: 'Casey',
      lastName: 'Grant',
      status: 'Inactive',
    })!;
    expect(mapped.displayName).toBe('Casey Grant');
    expect(mapped.sourceId).toBe('42');
    expect(mapped.active).toBe(false);
  });

  it('computes PII-free aggregates (L.4)', () => {
    const rows: DirectoryEmployee[] = [
      mapBambooDirectoryEmployee(rawWithForbiddenFields)!,
      mapBambooDirectoryEmployee({ id: '2', displayName: 'Jordan Lee', jobTitle: 'Coordinator' })!,
    ];
    const a = directoryAggregates(rows);
    expect(a).toEqual({
      employees: 2,
      departments: 1,
      positions: 2,
      locations: 1,
      withManager: 1,
      missingDepartment: 1,
      missingPosition: 0,
    });
  });
});

describe('approved branding configuration (H)', () => {
  it('records the controlled asset with accessible alt text and checksum', () => {
    expect(BRAND.logoAlt).toBe("Bert's Auto Parts");
    expect(BRAND.logoSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(BRAND.logoWebPath).toBe('/brand/berts-auto-parts.png');
    expect(BRAND.logoWidth / BRAND.logoHeight).toBeCloseTo(1184 / 880, 5);
  });
});
