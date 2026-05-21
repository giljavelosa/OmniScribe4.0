import Link from 'next/link';
import { ExternalLink, Link2, ShieldCheck, ShieldQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { MatchDialogTrigger } from './match-dialog';
import { SyncStatus } from './sync-status';
import { UnlinkButton } from './unlink-button';

const EHR_SYSTEM = 'nextgen';

/**
 * EhrLinkPanel — Unit 20 (Wave 4 / F2) surface on /patients/[id].
 *
 * Three render states:
 *   1. Clinician hasn't connected to the EHR yet → "Connect EHR first"
 *      CTA pointing at /admin/integrations/fhir
 *   2. Patient has a 'verified' link → green badge + Unlink action
 *   3. Patient has a 'high'/'manual' link → yellow "Confirm match"
 *      banner + Verify CTA (uses the same MatchDialog, prefilled)
 *   4. No link yet → "Link to NextGen" CTA opens MatchDialog
 *
 * Renders server-side so the initial paint shows the right state
 * without a flash; mutations route through the client subcomponents.
 */
export async function EhrLinkPanel({
  patientId,
  patient,
}: {
  patientId: string;
  patient: { firstName: string; lastName: string; mrn: string | null; dobIso: string };
}) {
  const session = await auth();
  const orgUserId = session?.user?.orgUserId;
  if (!orgUserId) return null;

  // 1. Does the clinician have an EHR connection at all?
  const fhirIdentity = await prisma.fhirIdentity.findUnique({
    where: {
      clinicianOrgUserId_ehrSystem: {
        clinicianOrgUserId: orgUserId,
        ehrSystem: EHR_SYSTEM,
      },
    },
    select: { id: true, fhirBaseUrl: true, launchPatientFhirId: true },
  });

  // 2. Does this patient already have any link?
  const existingLinks = await prisma.patientFhirIdentity.findMany({
    where: { patientId, ehrSystem: EHR_SYSTEM },
    orderBy: { createdAt: 'desc' },
  });
  const primary = existingLinks[0] ?? null;

  if (!fhirIdentity) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <Link2 className="h-4 w-4" aria-hidden /> EHR link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            You haven&apos;t connected to your EHR yet. Linking this patient to their EHR record
            requires a NextGen connection first.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/integrations/fhir">
              <ExternalLink className="h-3 w-3 mr-1" aria-hidden />
              Connect to NextGen
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (primary && primary.matchConfidence === 'verified') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--status-success-fg)]" aria-hidden />
            EHR link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge variant="success" noIcon>Verified</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{EHR_SYSTEM}</StatusBadge>
          </div>
          <p className="font-mono text-xs text-muted-foreground break-all">
            {primary.fhirPatientId}
          </p>
          {primary.verifiedAt && (
            <p className="text-xs text-muted-foreground">
              Verified {new Date(primary.verifiedAt).toLocaleDateString()}
            </p>
          )}
          <div className="border-t border-border pt-3">
            <SyncStatus patientId={patientId} />
          </div>
          <div className="pt-1">
            <UnlinkButton patientId={patientId} fid={primary.id} ehrSystem={EHR_SYSTEM} />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (primary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4 text-[var(--status-warning-fg)]" aria-hidden />
            EHR link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <StatusBadge variant="warning" noIcon>
            {primary.matchConfidence === 'high' ? 'Pending confirmation (auto-match)' : 'Pending confirmation'}
          </StatusBadge>
          <p className="text-muted-foreground">
            We have a suggested {EHR_SYSTEM} match for this patient but you haven&apos;t confirmed
            it yet. EHR resource fetches will stay blocked until you verify.
          </p>
          <p className="font-mono text-xs text-muted-foreground break-all">
            {primary.fhirPatientId}
          </p>
          <MatchDialogTrigger
            patientId={patientId}
            patient={patient}
            existingFhirPatientId={primary.fhirPatientId}
            launchHintFhirPatientId={fhirIdentity.launchPatientFhirId}
            label="Confirm or replace match"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md flex items-center gap-2">
          <Link2 className="h-4 w-4" aria-hidden /> EHR link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Link this patient to their {EHR_SYSTEM} record so OmniScribe can include their EHR
          history in future notes and briefs.
        </p>
        <MatchDialogTrigger
          patientId={patientId}
          patient={patient}
          launchHintFhirPatientId={fhirIdentity.launchPatientFhirId}
          label="Link to NextGen"
        />
      </CardContent>
    </Card>
  );
}
