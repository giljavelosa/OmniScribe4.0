import Link from 'next/link';
import { Mic } from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * ResumeRecordingBanner — surfaces in-flight capture sessions so a paused
 * (or walked-away-from) recording never silently disappears.
 *
 * A note sits at RECORDING/PAUSED on the server the moment the clinician
 * pauses or navigates off /capture. Neither home nor the patient chart used
 * to query those statuses, so the only way back was the raw /capture URL.
 * This banner is the dedicated re-entry surface on both.
 *
 * Renders nothing when there's no in-flight recording — zero weight in the
 * happy path. The "Resume" link targets /capture/[noteId], which accepts
 * exactly PREPARING/RECORDING/PAUSED.
 */
export type ResumableRecording = {
  noteId: string;
  status: 'RECORDING' | 'PAUSED';
  patientId: string;
  patientName: string;
  mrn: string | null;
  updatedAtIso: string;
};

function timeAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export function ResumeRecordingBanner({
  recordings,
  showPatientName = true,
  className,
}: {
  recordings: ResumableRecording[];
  /** Hide the patient name/MRN when the surface is already patient-scoped. */
  showPatientName?: boolean;
  className?: string;
}) {
  if (recordings.length === 0) return null;

  const count = recordings.length;

  return (
    <StatusBanner
      variant="warning"
      icon={<Mic className="h-5 w-5" aria-hidden />}
      title={count === 1 ? 'Unfinished recording' : `${count} unfinished recordings`}
      className={className}
    >
      <ul className="space-y-1.5">
        {recordings.map((r) => (
          <li key={r.noteId} className="flex items-center gap-2 flex-wrap text-sm">
            <StatusBadge variant="neutral" noIcon className="text-[10px]">
              {r.status === 'PAUSED' ? 'Paused' : 'Recording'}
            </StatusBadge>
            {showPatientName && (
              <>
                <span className="font-medium">{r.patientName}</span>
                {r.mrn && <span className="text-xs text-muted-foreground">{r.mrn}</span>}
              </>
            )}
            <span className="text-xs text-muted-foreground">{timeAgo(r.updatedAtIso)}</span>
            <Link
              href={`/capture/${r.noteId}`}
              className="ml-auto inline-flex items-center min-h-[var(--touch-min)] font-medium underline underline-offset-2 hover:no-underline"
            >
              Resume →
            </Link>
          </li>
        ))}
      </ul>
    </StatusBanner>
  );
}
