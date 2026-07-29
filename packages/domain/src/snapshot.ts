/**
 * Immutable employee snapshot (REQ-CASE-004, BR-CASE-003).
 *
 * Created exactly once, at case approval, from the employee-source record and
 * the approved case facts. The snapshot is the case's frozen truth; the
 * source cache may refresh later, the snapshot never changes.
 */
import { createHash } from 'node:crypto';
import type { EmployeeSourceEmployee } from './employeeSource.ts';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface EmployeeSnapshotPayload {
  readonly schemaVersion: number;
  readonly sourceSystem: string;
  readonly sourceId: string;
  readonly displayName: string;
  readonly workEmail: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly location: string;
  /** ISO instant the source record was retrieved. */
  readonly sourceRetrievedAt: string;
}

export function buildSnapshotPayload(
  source: EmployeeSourceEmployee,
  sourceRetrievedAt: Date,
): EmployeeSnapshotPayload {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourceSystem: source.sourceSystem,
    sourceId: source.sourceId,
    displayName: source.displayName,
    workEmail: source.workEmail,
    jobTitle: source.jobTitle,
    department: source.department,
    location: source.location,
    sourceRetrievedAt: sourceRetrievedAt.toISOString(),
  };
}

/** Deterministic checksum over a canonical (sorted-key) JSON encoding. */
export function snapshotChecksum(payload: EmployeeSnapshotPayload): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
