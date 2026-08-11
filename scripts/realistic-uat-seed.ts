/**
 * Realistic-UAT case seed (Directive 6.1 section U).
 *
 * Creates the scenario DRAFT/submitted cases for the aliased employees in
 * the LOCAL mapping (scripts/uat-alias.ts create must run first). Employees
 * are referenced by their mapping entries - never by hard-coded names. All
 * cases are record purpose TEST and carry the UAT banner note; assignment,
 * activation and the journeys are performed through the UI per
 * docs/operations/RealisticStakeholderUATWalkthrough.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const MAPPING_PATH = path.resolve(import.meta.dirname, '..', 'uat-local-real-person-mapping.json');
const LABEL = 'UAT ONLY — SIMULATED OFFBOARDING — NOT A REAL EMPLOYEE SEPARATION';

interface MappingEntry {
  alias: string;
  sourceSystem: string;
  sourceId: string;
}

async function main(): Promise<void> {
  if (!existsSync(MAPPING_PATH)) {
    throw new Error('No local mapping - run `pnpm exec tsx scripts/uat-alias.ts create` first.');
  }
  const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as { entries: MappingEntry[] };
  const byAlias = new Map(mapping.entries.map((e) => [e.alias, e]));
  const need = (alias: string): MappingEntry => {
    const e = [...byAlias.entries()].find(([k]) => k.startsWith(alias))?.[1];
    if (!e) throw new Error(`Mapping is missing the "${alias}" alias - recreate it.`);
    return e;
  };

  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();
  const officerRow = await prisma.user.findFirstOrThrow({
    where: { roleAssignments: { some: { role: 'HR_OFFICER', revokedAt: null } }, isActive: true },
  });
  const officer = { userId: officerRow.id, roles: ['HR_OFFICER'] as never };

  const draft = async (alias: string, type: string, effectiveInDays: number) => {
    const entry = need(alias);
    const received = new Date(Date.now() - 2 * 86_400_000);
    const effective = new Date(Date.now() + effectiveInDays * 86_400_000);
    effective.setHours(17, 0, 0, 0);
    const created = await db.createDraft(officer as never, {
      employeeSourceId: entry.sourceId,
      departureType: type,
      receivedAt: received.toISOString(),
      receiptSource: `${LABEL} - synthetic receipt`,
      confirmedLastDay: effective.toISOString().slice(0, 10),
      effectiveSeparationAt: effective.toISOString(),
      measurementCohort: null,
      recordPurpose: 'TEST',
    });
    await db.addNote(
      officer as never,
      created.caseId,
      `${LABEL} - ${alias} (see the local alias mapping; walkthrough scenario data).`,
      'HR_AND_OVERSIGHT',
    );
    console.log(`${created.caseNumber}: ${alias} (${type})`);
    return created.caseId;
  };

  await draft('UAT Employee A', 'RESIGNATION_WITH_NOTICE', 14); // Scenario A/C/H
  await draft('UAT Employee B', 'IMMEDIATE_RESIGNATION', 0); // Scenario B
  await draft('UAT Employee C', 'RESIGNATION_WITH_NOTICE', 10); // Scenario D/E
  await draft('UAT Employee D', 'RESIGNATION_WITH_NOTICE', 12); // Scenario F (missing manager)

  console.log(
    'Drafts ready. Continue in the UI: submit → approve → Assignment tab → activate (walkthrough Parts 6-15).',
  );
  await prisma.$disconnect();
}

void main();
