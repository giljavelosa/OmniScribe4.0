'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
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
import {
  SCROLLABLE_TABLE_HEAD_ROW,
  ScrollableTablePanel,
} from '@/components/ui/scrollable-table-panel';
import { bulkSettle, type BulkOutcome } from '@/lib/bulk-settle';

type OwnerUser = {
  id: string;
  email: string;
  name: string | null;
  platformRole: string;
  createdAt: string;
  orgs: Array<{
    orgId: string;
    orgName: string;
    role: string;
    division: string;
    isActive: boolean;
  }>;
};

const isDeletable = (u: OwnerUser) => u.platformRole !== 'PLATFORM_OWNER';

export function UsersSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<OwnerUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnerUser | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<BulkOutcome[]>([]);
  const [bulkPending, startBulk] = useTransition();
  const [loading, startLoading] = useTransition();

  const queryString = useMemo(() => {
    const out = new URLSearchParams();
    if (q.trim()) out.set('q', q.trim());
    return out.toString();
  }, [q]);

  const eligible = useMemo(() => rows.filter(isDeletable), [rows]);
  const selectedUsers = useMemo(
    () => eligible.filter((u) => selected.has(u.id)),
    [eligible, selected],
  );
  const allSelected = eligible.length > 0 && selectedUsers.length === eligible.length;
  const headerState: boolean | 'indeterminate' =
    selectedUsers.length === 0 ? false : allSelected ? true : 'indeterminate';

  function toggleOne(id: string, on: boolean) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(eligible.map((u) => u.id)) : new Set());
  }

  function load(opts: { append?: boolean; cursor?: string | null } = {}) {
    setError(null);
    startLoading(async () => {
      const url = new URLSearchParams(queryString);
      if (opts.cursor) url.set('cursor', opts.cursor);
      const res = await fetch(`/api/owner/users?${url.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Load failed (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { data: OwnerUser[]; nextCursor: string | null };
      setRows((curr) => (opts.append ? [...curr, ...json.data] : json.data));
      setNextCursor(json.nextCursor);
      // A fresh result set can drop rows the user had selected; clear to avoid
      // archiving a row that is no longer on screen.
      if (!opts.append) setSelected(new Set());
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  function confirmBulk() {
    if (selectedUsers.length === 0) return;
    setBulkFailures([]);
    startBulk(async () => {
      const outcomes = await bulkSettle(
        selectedUsers.map((u) => ({ id: u.id, label: u.email })),
        (item) =>
          fetch(`/api/owner/users/${item.id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmEmail: item.label }),
          }),
      );
      const ok = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
      const failed = outcomes.filter((o) => !o.ok);
      setRows((curr) => curr.filter((r) => !ok.has(r.id)));
      setSelected((curr) => {
        const next = new Set(curr);
        ok.forEach((id) => next.delete(id));
        return next;
      });
      setBulkFailures(failed);
      if (failed.length === 0) setBulkOpen(false);
    });
  }

  return (
    <>
      <Card className="flex flex-col flex-1 min-h-0 gap-0 py-0 overflow-hidden">
        <CardHeader className="shrink-0 pb-4">
          <CardTitle className="text-md">Cross-org user search</CardTitle>
          <CardDescription>
            Owner-only. Every search writes a PLATFORM_USERS_VIEWED row to PlatformAuditLog.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden pb-6">
          <div className="shrink-0 space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="users-q" className="text-xs">Email search</Label>
                <Input
                  id="users-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value.slice(0, 200))}
                  placeholder="contains…"
                  disabled={loading}
                />
              </div>
              {q && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setQ('')} disabled={loading}>
                  Clear
                </Button>
              )}
            </div>

            {error && <StatusBanner variant="danger">{error}</StatusBanner>}

            {selectedUsers.length > 0 && (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
                data-testid="owner-users-bulk-bar"
              >
                <span className="text-xs font-medium">
                  {selectedUsers.length} user{selectedUsers.length === 1 ? '' : 's'} selected
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
                    data-testid="owner-users-bulk-archive"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Archive {selectedUsers.length}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <ScrollableTablePanel className="flex-1 min-h-0">
            <table className="w-full text-xs">
              <thead>
                <tr className={SCROLLABLE_TABLE_HEAD_ROW}>
                  <th className="w-9 px-3 py-2">
                    <Checkbox
                      checked={headerState}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      disabled={eligible.length === 0}
                      aria-label="Select all deletable users"
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Orgs</th>
                  <th className="text-left px-3 py-2 font-medium">Platform</th>
                  <th className="text-left px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      {loading ? 'Loading…' : 'No users match.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-b-0 align-top">
                      <td className="px-3 py-2">
                        {isDeletable(u) ? (
                          <Checkbox
                            checked={selected.has(u.id)}
                            onCheckedChange={(v) => toggleOne(u.id, v === true)}
                            aria-label={`Select user ${u.email}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{u.email}</td>
                      <td className="px-3 py-2">{u.name ?? '—'}</td>
                      <td className="px-3 py-2 space-y-1">
                        {u.orgs.length === 0 ? (
                          <span className="text-muted-foreground italic">no orgs</span>
                        ) : (
                          u.orgs.map((o) => (
                            <div key={o.orgId} className="flex items-center gap-1 flex-wrap">
                              <span className="font-medium">{o.orgName}</span>
                              <StatusBadge variant="neutral" noIcon>{o.role}</StatusBadge>
                              <StatusBadge variant="neutral" noIcon>{o.division}</StatusBadge>
                              {!o.isActive && (
                                <StatusBadge variant="warning" noIcon>inactive</StatusBadge>
                              )}
                            </div>
                          ))
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {u.platformRole === 'PLATFORM_OWNER' ? (
                          <StatusBadge variant="violet" noIcon>owner</StatusBadge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isDeletable(u) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(u)}
                            aria-label={`Delete user ${u.email}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTablePanel>

          {nextCursor && (
            <div className="shrink-0 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => load({ append: true, cursor: nextCursor })}
                disabled={loading}
              >
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteUserDialog
        user={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onDeleted={(userId) => {
          setRows((curr) => curr.filter((row) => row.id !== userId));
          setDeleteTarget(null);
        }}
      />

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
              Archive {selectedUsers.length} user{selectedUsers.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each user identity is anonymized, their organization memberships are
              deactivated, active sessions are removed, and clinical records plus
              audit history are retained. This runs once per user and is reversible
              from Deleted data.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2">
            <ul className="space-y-1">
              {selectedUsers.map((u) => {
                const failure = bulkFailures.find((f) => f.id === u.id);
                return (
                  <li key={u.id} className="font-mono text-[11px] flex items-center justify-between gap-2">
                    <span>{u.email}</span>
                    {failure && (
                      <span className="text-destructive not-italic">{failure.message}</span>
                    )}
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
                  : `Archive ${selectedUsers.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeleteUserDialog({
  user,
  onCancel,
  onDeleted,
}: {
  user: OwnerUser | null;
  onCancel: () => void;
  onDeleted: (userId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    if (!user) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: user.email }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Delete failed (${res.status}).`);
        return;
      }
      onDeleted(user.id);
    });
  }

  return (
    <AlertDialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user?</AlertDialogTitle>
          <AlertDialogDescription>
            This anonymizes the user identity, deactivates their organization
            memberships, removes active sessions, and retains clinical records
            plus audit history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={confirmDelete}
            disabled={pending}
          >
            {pending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
