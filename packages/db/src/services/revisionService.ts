/**
 * Version history for editable documents (DEC-069, directive section 4).
 *
 * Every save of a letter, an action form, an asset receipt or an email is a
 * revision: the editable parts as they stood after the change, who made it
 * and when. The log is append-only - the runtime role cannot update or
 * delete a row, and a trigger refuses both - so "the only copy" is never
 * overwritten and the history HR reads is the history that happened.
 */
import { createHash } from 'node:crypto';
import { REVISION_KIND_LABELS, type DocumentKind, type RevisionKind } from '@exit/domain';
import { getPrisma } from '../client.ts';
import type { Prisma } from '../client.ts';

type Tx = Prisma.TransactionClient;

/** Stable serialisation so the same content always hashes the same way. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

export function revisionChecksum(content: unknown): string {
  return createHash('sha256').update(stableJson(content), 'utf8').digest('hex');
}

/** Write the next revision of a document inside the caller's transaction. */
export async function recordRevisionTx(
  tx: Tx,
  args: {
    caseId: string;
    documentKind: DocumentKind;
    documentId: string;
    kind: RevisionKind;
    content: object;
    editedById?: string | null;
    note?: string | null;
  },
): Promise<{ id: string; revision: number; contentChecksum: string }> {
  const latest = await tx.documentRevision.findFirst({
    where: { documentKind: args.documentKind, documentId: args.documentId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const revision = (latest?.revision ?? 0) + 1;
  const contentChecksum = revisionChecksum(args.content);
  const row = await tx.documentRevision.create({
    data: {
      caseId: args.caseId,
      documentKind: args.documentKind,
      documentId: args.documentId,
      revision,
      kind: args.kind,
      content: args.content as Prisma.InputJsonValue,
      contentChecksum,
      note: args.note?.trim().slice(0, 300) || null,
      editedById: args.editedById ?? null,
    },
    select: { id: true },
  });
  return { id: row.id, revision, contentChecksum };
}

export interface RevisionEntry {
  id: string;
  revision: number;
  kind: RevisionKind;
  label: string;
  editedByName: string | null;
  editedAt: Date;
  note: string | null;
  contentChecksum: string;
}

/**
 * The history of one document, newest first, with the editors named. The
 * caller has already authorized the case; this only reads.
 */
export async function listRevisions(
  documentKind: DocumentKind,
  documentId: string,
): Promise<RevisionEntry[]> {
  const prisma = getPrisma();
  const rows = await prisma.documentRevision.findMany({
    where: { documentKind, documentId },
    orderBy: { revision: 'desc' },
  });
  const userIds = [...new Set(rows.map((r) => r.editedById).filter((v): v is string => !!v))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    kind: r.kind,
    label: REVISION_KIND_LABELS[r.kind],
    editedByName: r.editedById ? (names.get(r.editedById) ?? null) : null,
    editedAt: r.editedAt,
    note: r.note,
    contentChecksum: r.contentChecksum,
  }));
}

/** The stored content of one revision, for HR to compare or restore from. */
export async function getRevisionContent(revisionId: string): Promise<{
  documentKind: DocumentKind;
  documentId: string;
  caseId: string;
  revision: number;
  content: unknown;
} | null> {
  const row = await getPrisma().documentRevision.findUnique({ where: { id: revisionId } });
  if (!row) return null;
  return {
    documentKind: row.documentKind,
    documentId: row.documentId,
    caseId: row.caseId,
    revision: row.revision,
    content: row.content,
  };
}
