import Link from 'next/link';
import { Camera } from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Prepare visit — shortcut to the chart's Scans tab. Phase B / C of the
 * scanned-documents follow-on. Deep-links with `?tab=scans&openScan=1`
 * so the patient lands directly in the Scan dialog.
 */
export function PrepareScanBanner({ patientId }: { patientId: string }) {
  return (
    <StatusBanner variant="info" title="Patient brought paperwork?">
      <p className="text-sm">
        Photograph med lists, labs, or outside records before you start — accepted scans feed
        the pre-visit brief and Miss Cleo&apos;s read.
      </p>
      <Link
        href={`/patients/${patientId}?tab=scans&openScan=1`}
        className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline mt-2"
      >
        <Camera className="size-4" aria-hidden />
        Scan documents
      </Link>
    </StatusBanner>
  );
}
