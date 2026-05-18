'use client';

import { useStubBanner } from '../_hooks/capture-state';
import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Self-contained stub-mode banner. Reads useStubBanner() and renders nothing
 * when Soniox is configured. Lives in the capture _components folder so the
 * page.tsx can mount it inside the provider without becoming a client
 * component itself.
 */
export function ClientStubBanner() {
  const show = useStubBanner();
  if (!show) return null;
  return (
    <div className="px-4 pt-3">
      <StatusBanner variant="warning" title="Soniox not configured">
        Running in stub mode — audio capture works but no transcript is generated. Set
        <code className="mx-1 rounded bg-card px-1 py-0.5 text-xs">SONIOX_API_KEY</code>
        + <code className="mx-1 rounded bg-card px-1 py-0.5 text-xs">SONIOX_BAA_ON_FILE=true</code>
        to enable real transcription.
      </StatusBanner>
    </div>
  );
}
