import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { prisma } from '@/lib/prisma';
import { OnboardingWizard } from './_components/wizard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Set up your account' };

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { organization: true },
  });

  if (!invite) {
    return (
      <StatusBanner variant="danger" title="Link not found">
        This invite link is invalid. Ask your administrator to send a fresh invitation.
      </StatusBanner>
    );
  }

  if (invite.expiresAt < new Date() || invite.consumedAt) {
    return (
      <StatusBanner variant="danger" title="Link expired or already used">
        This invite link is no longer valid. Ask your administrator to send a fresh invitation.
      </StatusBanner>
    );
  }

  const invitor = invite.invitedByUserId
    ? await prisma.user.findUnique({ where: { id: invite.invitedByUserId } })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to {invite.organization.name}</CardTitle>
        <CardDescription>
          {invitor?.name ?? invitor?.email ?? 'An administrator'} invited <span className="font-mono">{invite.email}</span>
          {' '}to join. Let&apos;s get you set up — takes about a minute.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OnboardingWizard token={token} email={invite.email} />
      </CardContent>
    </Card>
  );
}
