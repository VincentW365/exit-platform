import { redirect } from 'next/navigation';

/**
 * /dev has no content of its own - the breadcrumb for /dev/mailbox links the
 * intermediate segment, and a crumb that 404s is a dead end. It goes to the
 * one thing that lives under it.
 */
export default function DevIndex() {
  redirect('/dev/mailbox');
}
