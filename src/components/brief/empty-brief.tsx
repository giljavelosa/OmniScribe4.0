import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * EmptyBrief — three variants per UI spec §2.5:
 *   - 'first-visit'           → identity only + "First visit with this patient"
 *   - 'unavailable'           → amber chip + "open chart manually" link
 *   - 'loading'               → skeleton placeholder
 */
export function EmptyBrief({
  variant,
  patientName,
  patientId,
  className,
}: {
  variant: 'first-visit' | 'unavailable' | 'loading';
  patientName: string;
  patientId: string;
  className?: string;
}) {
  if (variant === 'loading') {
    return (
      <Card className={className} aria-busy="true">
        <CardHeader>
          <CardTitle className="text-md">Prior context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
          <div className="h-12 w-full rounded bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (variant === 'first-visit') {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-md">Prior context — {patientName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            First visit with this patient — no prior context to surface.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-md">Prior context — {patientName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <StatusBadge variant="warning" noIcon>Brief unavailable</StatusBadge>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t precompute a brief for this patient.{' '}
          <Link
            href={`/patients/${patientId}`}
            className="underline-offset-2 hover:underline text-foreground"
          >
            Open chart manually ↗
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
