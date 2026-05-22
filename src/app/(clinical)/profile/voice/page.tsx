import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { VoiceEnrollmentClient } from './_components/voice-enrollment-client';
import { CURRENT_CONSENT_VERSION } from '@/app/api/me/voice-profile/consent/route';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Voice profile' };

/**
 * /profile/voice — BIPA-compliant voice-enrollment surface (Sprint A, W0-01+W0-02).
 *
 * Server component: loads current enrollment state from DB and passes it
 * to the client component. The client owns mic recording, consent checkbox,
 * and the submit flow.
 */
export default async function VoiceProfilePage() {
  const session = await auth();
  if (!session?.user?.orgUserId) redirect('/login');

  const profile = await prisma.voiceProfile.findFirst({
    where: { orgUserId: session.user.orgUserId, isDeleted: false },
    select: {
      id: true,
      consentVersion: true,
      consentedAt: true,
      displayName: true,
      createdAt: true,
    },
  });

  // Check embedding status via raw query.
  let hasEmbedding = false;
  if (profile) {
    const rows = await prisma.$queryRaw<Array<{ has_emb: boolean }>>`
      SELECT (embedding IS NOT NULL) AS has_emb
      FROM "VoiceProfile" WHERE id = ${profile.id}
    `;
    hasEmbedding = rows[0]?.has_emb ?? false;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Voice profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enrolling a voice sample lets OmniScribe label transcript speakers as{' '}
          <span className="font-medium">Clinician</span> or{' '}
          <span className="font-medium">Patient</span> automatically — no manual
          relabeling needed on the review screen.
        </p>
      </div>

      <VoiceEnrollmentClient
        currentConsentVersion={CURRENT_CONSENT_VERSION}
        enrollment={
          profile
            ? {
                enrolled: true,
                hasEmbedding,
                consentVersion: profile.consentVersion,
                enrolledAt: profile.createdAt.toISOString(),
                displayName: profile.displayName ?? undefined,
              }
            : { enrolled: false }
        }
      />
    </div>
  );
}
