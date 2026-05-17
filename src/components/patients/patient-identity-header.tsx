import type { Patient } from '@prisma/client';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/ui/status-badge';
import { SectionLabel } from '@/components/ui/section-label';

type Props = {
  patient: Pick<
    Patient,
    'firstName' | 'lastName' | 'mrn' | 'dob' | 'sex' | 'division' | 'preferredLanguage' | 'isDeleted'
  >;
  className?: string;
};

/**
 * PatientIdentityHeader — name · sex/age · MRN · DOB · preferred language ·
 * accessibility flags. Used at the top of /patients/[id] and on the
 * /prepare/[noteId] surface (Unit 03).
 */
export function PatientIdentityHeader({ patient, className }: Props) {
  const age = ageInYears(patient.dob);
  return (
    <header className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2lg font-semibold leading-tight">
          {patient.firstName} {patient.lastName}
        </h1>
        <StatusBadge variant="neutral" noIcon>
          {patient.sex} · {age}
        </StatusBadge>
        <StatusBadge variant="neutral" noIcon>
          {patient.division}
        </StatusBadge>
        {patient.isDeleted && <StatusBadge variant="danger">deleted</StatusBadge>}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm text-muted-foreground">
        <div>
          <SectionLabel>MRN</SectionLabel>
          <dd className="font-mono">{patient.mrn}</dd>
        </div>
        <div>
          <SectionLabel>DOB</SectionLabel>
          <dd>{patient.dob.toLocaleDateString()}</dd>
        </div>
        <div>
          <SectionLabel>Language</SectionLabel>
          <dd>{patient.preferredLanguage ?? '—'}</dd>
        </div>
      </dl>
    </header>
  );
}

function ageInYears(dob: Date) {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return `${age}y`;
}
