import { redirect } from 'next/navigation';

/**
 * The assignment plan lives on the Workflow tab now (owner, 2026-08-25).
 * The route stays answerable so old links, bookmarks and audit deep-links
 * keep working - deprecated routes redirect, they never dead-end.
 */
export default async function AssignmentRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/cases/${id}/workflow`);
}
