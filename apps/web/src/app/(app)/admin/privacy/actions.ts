'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  anonymizeCase,
  approveRetentionPolicy,
  placeHold,
  prepareDsrPackage,
  recordDisclosure,
  releaseHold,
  retentionDryRun,
  upsertRetentionPolicy,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/privacy?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function upsertPolicyAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await upsertRetentionPolicy(actor, {
      recordType: str(formData, 'recordType'),
      retainYears: str(formData, 'retainYears'),
      basis: str(formData, 'basis'),
      reason: str(formData, 'reason'),
    });
    revalidatePath('/admin/privacy');
    back({ ok: 'Retention policy version created (synthetic; approval required).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function approvePolicyAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await approveRetentionPolicy(actor, str(formData, 'id'));
    revalidatePath('/admin/privacy');
    back({ ok: 'Retention policy approved and activated (development schedule).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function placeHoldAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await placeHold(actor, str(formData, 'caseId'), str(formData, 'reason'));
    revalidatePath('/admin/privacy');
    back({ ok: 'Hold placed: retention action is suspended for the case.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function releaseHoldAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await releaseHold(actor, str(formData, 'holdId'), str(formData, 'note'));
    revalidatePath('/admin/privacy');
    back({ ok: 'Hold released.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function dryRunAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await retentionDryRun(actor);
    revalidatePath('/admin/privacy');
    back({
      ok: `Dry run recorded: ${result.findings.length} record(s) evaluated, ${result.findings.filter((f) => f.eligible).length} eligible, nothing deleted.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function anonymizeAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await anonymizeCase(actor, str(formData, 'caseId'), str(formData, 'reason'));
    revalidatePath('/admin/privacy');
    back({ ok: 'Case identity fields anonymized; audit integrity preserved.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function dsrPackageAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await prepareDsrPackage(actor, str(formData, 'subjectRef'));
    revalidatePath('/admin/privacy');
    back({ ok: `Data-subject export package prepared (stored privately: ${result.objectKey}).` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function disclosureAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await recordDisclosure(actor, {
      subjectRef: str(formData, 'subjectRef'),
      disclosedTo: str(formData, 'disclosedTo'),
      description: str(formData, 'description'),
      lawfulBasis: str(formData, 'lawfulBasis'),
    });
    revalidatePath('/admin/privacy');
    back({ ok: 'Disclosure recorded in the append-only log.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
