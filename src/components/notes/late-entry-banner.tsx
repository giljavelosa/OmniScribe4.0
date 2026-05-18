import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  /** ISO date — when the underlying care was delivered. */
  dateOfService: string;
  /** Days between dateOfService and (signedAt ?? today). Stamped at note
   *  creation; we just render. */
  lateEntryDaysGap: number;
  /** Optional ISO datetime — when the note was signed/documented. Falls
   *  back to "today" for unsigned late entries (which is when the
   *  clinician is currently looking at this banner anyway). */
  signedAt?: string | null;
};

/**
 * LateEntryBanner — the explicit banner that appears across the top of
 * /capture, /review, and /sign for any note where isLateEntry === true.
 *
 * Copy is locked to the spec — kept here in one place so the surfaces stay
 * in sync (and so a future copy tweak is one diff, not three).
 */
export function LateEntryBanner({ dateOfService, lateEntryDaysGap, signedAt }: Props) {
  const careLabel = formatLabelDate(dateOfService);
  const documentedLabel = formatLabelDate(signedAt ?? new Date().toISOString());
  return (
    <StatusBanner variant="warning" title="Late entry">
      Care delivered {careLabel} · documented {documentedLabel} ({lateEntryDaysGap} days late).
    </StatusBanner>
  );
}

function formatLabelDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
