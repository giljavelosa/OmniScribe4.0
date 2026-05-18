import { StatusBadge } from '@/components/ui/status-badge';
import type { SseConnectionStatus } from '@/lib/sse/use-sse-stream';

/**
 * SseStatusChip — small visible indicator the live channel is healthy.
 * Lives wherever a surface depends on SSE for freshness so the clinician
 * never has to wonder why the page hasn't updated.
 */
export function SseStatusChip({ status }: { status: SseConnectionStatus }) {
  if (status === 'live') {
    return (
      <StatusBadge variant="success" noIcon aria-label="Live updates connected">
        ● live
      </StatusBadge>
    );
  }
  if (status === 'connecting') {
    return (
      <StatusBadge variant="info" noIcon aria-label="Connecting to live updates">
        ◐ connecting
      </StatusBadge>
    );
  }
  if (status === 'reconnecting') {
    return (
      <StatusBadge variant="warning" noIcon aria-label="Reconnecting to live updates">
        ↻ reconnecting
      </StatusBadge>
    );
  }
  return (
    <StatusBadge variant="danger" noIcon aria-label="Live updates offline">
      ⚠ offline
    </StatusBadge>
  );
}
