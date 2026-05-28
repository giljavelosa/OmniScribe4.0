import Link from 'next/link';

import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  trialEndsAt: string | null;
  isOrgAdmin?: boolean;
  expired?: boolean;
  daysLeft?: number;
  urgent?: boolean;
};

/**
 * Trial status for visit-bank orgs — shown on home, usage, and capacity.
 */
export function TrialStatusBanner({
  trialEndsAt,
  isOrgAdmin = false,
  expired = false,
  daysLeft = 0,
  urgent = false,
}: Props) {
  if (!trialEndsAt && !expired) return null;

  if (expired) {
    return (
      <StatusBanner variant="danger" title="Trial ended">
        {isOrgAdmin ? (
          <>
            Your trial has ended. Subscribe or buy visit bundles from{' '}
            <Link href="/admin/billing" className="underline font-medium">
              Billing
            </Link>{' '}
            to continue starting visits.
          </>
        ) : (
          <> Your trial has ended. Ask your org admin to choose a plan before starting new visits.</>
        )}
      </StatusBanner>
    );
  }

  const endLabel = new Date(trialEndsAt!).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <StatusBanner variant={urgent ? 'warning' : 'info'} title="Trial active">
      {daysLeft <= 1
        ? `Trial ends ${endLabel}.`
        : `${daysLeft} days left in your trial (ends ${endLabel}).`}
      {isOrgAdmin ? (
        <>
          {' '}
          Subscribe from{' '}
          <Link href="/admin/billing" className="underline font-medium">
            Billing
          </Link>
          .
        </>
      ) : (
        <> Ask your org admin to choose a plan before the trial ends.</>
      )}
    </StatusBanner>
  );
}
