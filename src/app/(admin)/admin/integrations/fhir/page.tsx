import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExternalLink, Plug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { smartConfig } from '@/services/fhir/smart-client';
import { FhirIdentityRow } from './_components/fhir-identity-row';
import { SupportedEhrsPanel } from './_components/supported-ehrs-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'EHR integrations' };

const ADMIN_ROLES = new Set(['ORG_ADMIN', 'SITE_ADMIN']);

/**
 * /admin/integrations/fhir — F1 admin surface.
 *
 * Lists FhirIdentity rows for the org (one per clinician × EHR system)
 * + provides a stub-mode "Connect to NextGen sandbox" launcher so the
 * full flow can be exercised in dev without a real EHR. In real mode
 * the launcher hands the clinician instructions ("From your NextGen
 * patient chart, click the OmniScribe launch button"); the OAuth
 * itself is provider-initiated and lands at /api/fhir/launch.
 *
 * Surfaces error / success banners based on the query param the
 * callback redirects with (?connected=<system> | ?error=<reason>).
 */
export default async function AdminFhirIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!session.user.role || !ADMIN_ROLES.has(session.user.role)) redirect('/home');
  const { orgId, orgUserId } = session.user;
  void orgUserId;
  const sp = await searchParams;

  const identities = await prisma.fhirIdentity.findMany({
    where: { orgId },
    include: {
      clinician: { include: { user: { select: { name: true, email: true } } } },
    },
    orderBy: [{ ehrSystem: 'asc' }, { createdAt: 'desc' }],
  });

  const connected = sp.connected;
  const error = sp.error;
  // Default FHIR base URL for the stub-mode launcher. Real-mode uses
  // whatever `iss` NextGen sends in the launch redirect.
  const stubIss = 'https://stub.fhir.local/r4';
  // Server component runs once per request; capture "now" so the row
  // component (client) can compute expiring-soon without a non-pure
  // Date.now() call at render.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">EHR integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect clinician accounts to your EHR via SMART on FHIR. v1 ships read-only access for
          NextGen.
        </p>
      </div>

      {connected && (
        <StatusBanner variant="success" title="Connected">
          Your {connected} connection is active. Tokens are encrypted at rest and will refresh
          automatically before expiry.
        </StatusBanner>
      )}
      {error && (
        <StatusBanner variant="danger" title="Connection failed">
          {humanizeError(error)}
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" aria-hidden />
            NextGen
          </CardTitle>
          <CardDescription>
            {smartConfig.isStubMode
              ? 'Running in stub mode — clicking "Connect" runs a synthetic SMART launch end-to-end. Set FHIR_NEXTGEN_CLIENT_ID + FHIR_NEXTGEN_CLIENT_SECRET in your env to talk to the real NextGen sandbox.'
              : 'Real-mode launch. From your NextGen patient chart, click the OmniScribe launch button — NextGen will send the clinician here, and the OAuth handshake completes automatically.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/fhir/launch?iss=${encodeURIComponent(stubIss)}&launch=stub-launch-token`}>
              <ExternalLink className="h-3 w-3 mr-1" aria-hidden />
              {smartConfig.isStubMode ? 'Connect (stub launch)' : 'Test connection'}
            </Link>
          </Button>
          {smartConfig.isStubMode && <StatusBadge variant="warning" noIcon>Stub mode</StatusBadge>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active connections</CardTitle>
          <CardDescription>
            One row per clinician × EHR system. Disconnecting wipes the encrypted tokens and forces
            a fresh launch on the next sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identities.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No active EHR connections yet. Use the launcher above (stub mode) or have a clinician
              launch OmniScribe from their NextGen chart.
            </p>
          ) : (
            <div className="space-y-2">
              {identities.map((identity) => (
                <FhirIdentityRow
                  key={identity.id}
                  id={identity.id}
                  ehrSystem={identity.ehrSystem}
                  fhirBaseUrl={identity.fhirBaseUrl}
                  scope={identity.scope}
                  expiresAtIso={identity.expiresAt.toISOString()}
                  refreshedAtIso={identity.refreshedAt?.toISOString() ?? null}
                  hasLaunchPatient={!!identity.launchPatientFhirId}
                  clinicianName={identity.clinician.user.name ?? identity.clinician.user.email}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SupportedEhrsPanel />
    </div>
  );
}

function humanizeError(raw: string): string {
  if (raw === 'state_unknown') return 'The launch state was not recognized — try the launch button again.';
  if (raw === 'state_expired') return 'The launch state expired before the EHR redirected back. Try again.';
  if (raw === 'missing_state_or_code') return 'The EHR redirected without the expected OAuth parameters. Try again.';
  if (raw.startsWith('ehr_')) return `The EHR refused authorization (${raw.slice(4)}). Confirm the clinician has launch access in NextGen.`;
  if (raw.startsWith('token_exchange_failed')) return 'The EHR rejected the token exchange. Confirm client id / secret in env and retry.';
  return `Connection failed (${raw}).`;
}
