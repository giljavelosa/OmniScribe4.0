import Link from 'next/link';

import { cn } from '@/lib/cn';

/**
 * Source pill — every fact in the brief carries one of these. Spec rule:
 * "no pill = no render." Clicking opens the source note in /review.
 *
 * Visual is intentionally minimal: small caps, muted background, underline
 * on hover. The pill is the trust signal, not a CTA — it should fade behind
 * the content it cites until the clinician needs to verify.
 */
export function SourcePill({
  noteId,
  date,
  label,
  className,
}: {
  noteId: string;
  /** ISO date string (YYYY-MM-DD) for the source note. */
  date: string;
  /** Optional label override (defaults to formatted date). */
  label?: string;
  className?: string;
}) {
  const display = label ?? formatDate(date);
  return (
    <Link
      href={`/review/${noteId}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline',
        className,
      )}
      aria-label={`Open source note from ${display}`}
    >
      <span aria-hidden="true">↗</span>
      <span>{display}</span>
    </Link>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
