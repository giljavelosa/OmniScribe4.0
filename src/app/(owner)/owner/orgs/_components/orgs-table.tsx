'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { ScrollableTablePanel } from '@/components/ui/scrollable-table-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { bulkSettle, type BulkOutcome } from '@/lib/bulk-settle';
import { DeleteOrganizationButton } from './delete-organization-button';

type OrgRow = {
  id: string;
  name: string;
  division: string;
  complianceProfile: string;
  hasBaa: boolean;
  baaVersion: string | null;
  users: number;
  seats: number;
};

export function OrgsTable({ orgs }: { orgs: OrgRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<BulkOutcome[]>([]);
  const [bulkPending, startBulk] = useTransition();

  // Derive from current props so rows removed by a refresh drop out of the
  // selection automatically (no stale ids).
  const selectedOrgs = useMemo(() => orgs.filter((o) => selected.has(o.id)), [orgs, selected]);
  const allSelected = orgs.length > 0 && selectedOrgs.length === orgs.length;
  const headerState: boolean | 'indeterminate' =
    selectedOrgs.length === 0 ? false : allSelected ? true : 'indeterminate';

  function toggleOne(id: string, on: boolean) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirmBulk() {
    if (selectedOrgs.length === 0) return;
    setBulkFailures([]);
    startBulk(async () => {
      const outcomes = await bulkSettle(
        selectedOrgs.map((o) => ({ id: o.id, label: o.name })),
        (item) =>
          fetch(`/api/owner/orgs/${item.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmName: item.label }),
          }),
      );
      const failed = outcomes.filter((o) => !o.ok);
      const okIds = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
      setSelected((curr) => {
        const next = new Set(curr);
        okIds.forEach((id) => next.delete(id));
        return next;
      });
      setBulkFailures(failed);
      // Re-query the force-dynamic page so archived orgs leave the list.
      router.refresh();
      if (failed.length === 0) setBulkOpen(false);
    });
  }

  return (
    <>
      {selectedOrgs.length > 0 && (
        <div
          className="shrink-0 mx-6 mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="owner-orgs-bulk-bar"
        >
          <span className="text-xs font-medium">
            {selectedOrgs.length} org{selectedOrgs.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setBulkFailures([]);
                setBulkOpen(true);
              }}
              data-testid="owner-orgs-bulk-archive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Archive {selectedOrgs.length}
            </Button>
          </div>
        </div>
      )}

      <ScrollableTablePanel className="flex-1 min-h-0 mx-6 mb-6 border-0 rounded-none">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground sticky top-0 z-10 bg-card backdrop-blur-sm">
              <th className="w-9 px-4 py-2">
                <Checkbox
                  checked={headerState}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(orgs.map((o) => o.id)) : new Set())}
                  disabled={orgs.length === 0}
                  aria-label="Select all organizations"
                />
              </th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Division</th>
              <th className="text-left px-4 py-2 font-medium">Compliance</th>
              <th className="text-left px-4 py-2 font-medium">BAA</th>
              <th className="text-left px-4 py-2 font-medium">Users</th>
              <th className="text-left px-4 py-2 font-medium">Seats</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr key={org.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3">
                  <Checkbox
                    checked={selected.has(org.id)}
                    onCheckedChange={(v) => toggleOne(org.id, v === true)}
                    aria-label={`Select organization ${org.name}`}
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/owner/orgs/${org.id}`} className="hover:underline">
                    {org.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{org.division}</td>
                <td className="px-4 py-3">{org.complianceProfile}</td>
                <td className="px-4 py-3">
                  {org.hasBaa ? (
                    <StatusBadge variant="success">on file ({org.baaVersion ?? '—'})</StatusBadge>
                  ) : (
                    <StatusBadge variant="danger">missing</StatusBadge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{org.users}</td>
                <td className="px-4 py-3 text-muted-foreground">{org.seats}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/owner/orgs/${org.id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Open →
                    </Link>
                    <DeleteOrganizationButton orgId={org.id} orgName={org.name} />
                  </div>
                </td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  No orgs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollableTablePanel>

      <AlertDialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open && !bulkPending) {
            setBulkOpen(false);
            setBulkFailures([]);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {selectedOrgs.length} organization{selectedOrgs.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each organization is hidden from owner and app surfaces and its users
              and seats are deactivated. Clinical records plus audit history stay
              retained. This runs once per org and is reversible from Deleted data.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2">
            <ul className="space-y-1">
              {selectedOrgs.map((o) => {
                const failure = bulkFailures.find((f) => f.id === o.id);
                return (
                  <li key={o.id} className="text-xs flex items-center justify-between gap-2">
                    <span className="font-medium">{o.name}</span>
                    {failure && <span className="text-destructive">{failure.message}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {bulkFailures.length > 0 && (
            <StatusBanner variant="danger">
              {bulkFailures.length} could not be archived and remain selected. Retry or clear them.
            </StatusBanner>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>
              {bulkFailures.length > 0 ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmBulk} disabled={bulkPending}>
              {bulkPending
                ? 'Archiving…'
                : bulkFailures.length > 0
                  ? 'Retry'
                  : `Archive ${selectedOrgs.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
