import { Clock, Plug } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EHR_VENDORS } from '@/services/fhir/vendor-registry';

/**
 * Supported EHRs reference panel — Unit 24 / F6.
 *
 * Static rundown of the vendors OmniScribe is architected to support.
 * NextGen is 'active' (canonical reference implementation; env-driven);
 * Epic + Cerner are 'planned' — adapter is in place + the OrgEhrConnection
 * schema is ready; what's missing is per-customer client credentials +
 * the per-org config UI that lands when the first customer demands it.
 *
 * Read-only in v1. No "Add Epic connection" CTA because there's no
 * config flow to drive yet; the enablementNote per row tells the
 * admin what's pending.
 */
export function SupportedEhrsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" aria-hidden />
          Supported EHRs
        </CardTitle>
        <CardDescription>
          NextGen is the canonical reference implementation in v1. Epic and Cerner adapters are
          in place; per-customer credentials land when a customer demands them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {EHR_VENDORS.map((vendor) => (
            <li
              key={vendor.id}
              className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{vendor.displayName}</p>
                  {vendor.status === 'active' ? (
                    <StatusBadge variant="success" noIcon>Active</StatusBadge>
                  ) : (
                    <StatusBadge variant="warning" noIcon>
                      <Clock className="h-3 w-3 mr-1" aria-hidden />
                      Planned
                    </StatusBadge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{vendor.enablementNote}</p>
                {vendor.mrnIdentifierSystem && (
                  <p className="text-[11px] text-muted-foreground font-mono mt-1 break-all">
                    MRN system: {vendor.mrnIdentifierSystem}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
