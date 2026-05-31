'use client';

import { useMemo, useState, useTransition, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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

type DeletedOrg = {
  id: string;
  name: string;
  deletedAt: string | null;
  deletedBy: string | null;
  members: number;
  patients: number;
  seats: number;
};

type DeletedUser = {
  id: string;
  anonymizedEmail: string;
  originalEmail: string | null;
  originalName: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  membershipCount: number;
  recoverable: boolean;
};

type RestoreKind = 'org' | 'user';
type RestoreTarget = { kind: RestoreKind; id: string; label: string };

const restoreUrl = (kind: RestoreKind, id: string) =>
  kind === 'org' ? `/api/owner/orgs/${id}/restore` : `/api/owner/users/${id}/restore`;

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function DeletedDataClient({
  orgs,
  users,
}: {
  orgs: DeletedOrg[];
  users: DeletedUser[];
}) {
  const router = useRouter();
  const [orgRows, setOrgRows] = useState(orgs);
  const [userRows, setUserRows] = useState(users);
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkKind, setBulkKind] = useState<RestoreKind | null>(null);
  const [bulkFailures, setBulkFailures] = useState<BulkOutcome[]>([]);
  const [bulkPending, startBulk] = useTransition();

  const selectedOrgList = useMemo(
    () => orgRows.filter((o) => selectedOrgs.has(o.id)),
    [orgRows, selectedOrgs],
  );
  const recoverableUsers = useMemo(() => userRows.filter((u) => u.recoverable), [userRows]);
  const selectedUserList = useMemo(
    () => recoverableUsers.filter((u) => selectedUsers.has(u.id)),
    [recoverableUsers, selectedUsers],
  );

  const orgHeaderState: boolean | 'indeterminate' =
    selectedOrgList.length === 0 ? false : selectedOrgList.length === orgRows.length ? true : 'indeterminate';
  const userHeaderState: boolean | 'indeterminate' =
    selectedUserList.length === 0
      ? false
      : selectedUserList.length === recoverableUsers.length
        ? true
        : 'indeterminate';

  function toggle(set: Dispatch<SetStateAction<Set<string>>>, id: string, on: boolean) {
    set((curr) => {
      const next = new Set(curr);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirmRestore() {
    if (!target) return;
    setError(null);
    const { kind, id } = target;
    startTransition(async () => {
      const res = await fetch(restoreUrl(kind, id), { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Restore failed (${res.status}).`);
        return;
      }
      if (kind === 'org') setOrgRows((rows) => rows.filter((r) => r.id !== id));
      else setUserRows((rows) => rows.filter((r) => r.id !== id));
      setTarget(null);
      router.refresh();
    });
  }

  const bulkList = bulkKind === 'org' ? selectedOrgList : selectedUserList;
  const bulkLabels = useMemo(
    () =>
      bulkKind === 'org'
        ? selectedOrgList.map((o) => ({ id: o.id, label: o.name }))
        : selectedUserList.map((u) => ({ id: u.id, label: u.originalEmail ?? u.anonymizedEmail })),
    [bulkKind, selectedOrgList, selectedUserList],
  );

  function confirmBulk() {
    if (!bulkKind || bulkLabels.length === 0) return;
    const kind = bulkKind;
    setBulkFailures([]);
    startBulk(async () => {
      const outcomes = await bulkSettle(bulkLabels, (item) =>
        fetch(restoreUrl(kind, item.id), { method: 'POST' }),
      );
      const okIds = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
      const failed = outcomes.filter((o) => !o.ok);
      if (kind === 'org') {
        setOrgRows((rows) => rows.filter((r) => !okIds.has(r.id)));
        setSelectedOrgs((curr) => {
          const next = new Set(curr);
          okIds.forEach((id) => next.delete(id));
          return next;
        });
      } else {
        setUserRows((rows) => rows.filter((r) => !okIds.has(r.id)));
        setSelectedUsers((curr) => {
          const next = new Set(curr);
          okIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      setBulkFailures(failed);
      router.refresh();
      if (failed.length === 0) setBulkKind(null);
    });
  }

  return (
    <>
      <Tabs defaultValue="orgs" className="flex-1 min-h-0">
        <TabsList>
          <TabsTrigger value="orgs" data-testid="deleted-tab-orgs">
            Organizations ({orgRows.length})
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="deleted-tab-users">
            Users ({userRows.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orgs">
          {selectedOrgList.length > 0 && (
            <div
              className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
              data-testid="deleted-orgs-bulk-bar"
            >
              <span className="text-xs font-medium">
                {selectedOrgList.length} selected
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedOrgs(new Set())}>
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="deleted-orgs-bulk-restore"
                  onClick={() => {
                    setBulkFailures([]);
                    setBulkKind('org');
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Restore {selectedOrgList.length}
                </Button>
              </div>
            </div>
          )}
          <Card className="overflow-x-auto p-0" data-testid="deleted-orgs-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-9 px-4 py-2">
                    <Checkbox
                      checked={orgHeaderState}
                      onCheckedChange={(v) =>
                        setSelectedOrgs(v === true ? new Set(orgRows.map((o) => o.id)) : new Set())
                      }
                      disabled={orgRows.length === 0}
                      aria-label="Select all deleted organizations"
                    />
                  </th>
                  <th className="text-left px-4 py-2 font-medium">Organization</th>
                  <th className="text-left px-4 py-2 font-medium">Original ID</th>
                  <th className="text-left px-4 py-2 font-medium">Deleted</th>
                  <th className="text-left px-4 py-2 font-medium">Deleted by</th>
                  <th className="text-left px-4 py-2 font-medium">Retained</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {orgRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No deleted organizations.
                    </td>
                  </tr>
                ) : (
                  orgRows.map((o) => (
                    <tr key={o.id} className="border-b border-border last:border-b-0 align-top">
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedOrgs.has(o.id)}
                          onCheckedChange={(v) => toggle(setSelectedOrgs, o.id, v === true)}
                          aria-label={`Select organization ${o.name}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">{o.name}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{o.id}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(o.deletedAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{o.deletedBy ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge variant="neutral" noIcon>{o.members} members</StatusBadge>
                          <StatusBadge variant="neutral" noIcon>{o.patients} patients</StatusBadge>
                          <StatusBadge variant="neutral" noIcon>{o.seats} seats</StatusBadge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={`restore-org-${o.id}`}
                          onClick={() => setTarget({ kind: 'org', id: o.id, label: o.name })}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                          Restore
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          {selectedUserList.length > 0 && (
            <div
              className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2"
              data-testid="deleted-users-bulk-bar"
            >
              <span className="text-xs font-medium">
                {selectedUserList.length} selected
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedUsers(new Set())}>
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="deleted-users-bulk-restore"
                  onClick={() => {
                    setBulkFailures([]);
                    setBulkKind('user');
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Restore {selectedUserList.length}
                </Button>
              </div>
            </div>
          )}
          <Card className="overflow-x-auto p-0" data-testid="deleted-users-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-9 px-4 py-2">
                    <Checkbox
                      checked={userHeaderState}
                      onCheckedChange={(v) =>
                        setSelectedUsers(
                          v === true ? new Set(recoverableUsers.map((u) => u.id)) : new Set(),
                        )
                      }
                      disabled={recoverableUsers.length === 0}
                      aria-label="Select all recoverable users"
                    />
                  </th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Original ID</th>
                  <th className="text-left px-4 py-2 font-medium">Deleted</th>
                  <th className="text-left px-4 py-2 font-medium">Deleted by</th>
                  <th className="text-left px-4 py-2 font-medium">Memberships</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                      No deleted users.
                    </td>
                  </tr>
                ) : (
                  userRows.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-b-0 align-top">
                      <td className="px-4 py-3">
                        {u.recoverable ? (
                          <Checkbox
                            checked={selectedUsers.has(u.id)}
                            onCheckedChange={(v) => toggle(setSelectedUsers, u.id, v === true)}
                            aria-label={`Select user ${u.originalEmail ?? u.anonymizedEmail}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {u.originalEmail ?? u.anonymizedEmail}
                      </td>
                      <td className="px-4 py-3">{u.originalName ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{u.id}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(u.deletedAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.deletedBy ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.membershipCount}</td>
                      <td className="px-4 py-3 text-right">
                        {u.recoverable ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`restore-user-${u.id}`}
                            onClick={() =>
                              setTarget({
                                kind: 'user',
                                id: u.id,
                                label: u.originalEmail ?? u.anonymizedEmail,
                              })
                            }
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                            Restore
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">no ledger</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {target?.kind === 'org' ? 'organization' : 'user'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.kind === 'org'
                ? `“${target?.label}” returns to owner and app surfaces and its members + seats are reactivated. Reassign seats afterward as needed.`
                : `“${target?.label}” is reconstituted from the recovery ledger and returns to normal surfaces. Their memberships reactivate; reassign seats afterward as needed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore} disabled={pending}>
              {pending ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!bulkKind}
        onOpenChange={(open) => {
          if (!open && !bulkPending) {
            setBulkKind(null);
            setBulkFailures([]);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore {bulkList.length} {bulkKind === 'org' ? 'organization' : 'user'}
              {bulkList.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkKind === 'org'
                ? 'Each organization returns to owner and app surfaces with its members and seats reactivated. Runs once per org.'
                : 'Each user is reconstituted from the recovery ledger and returns to normal surfaces with memberships reactivated. Runs once per user.'}{' '}
              Reassign seats afterward as needed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2">
            <ul className="space-y-1">
              {bulkLabels.map((item) => {
                const failure = bulkFailures.find((f) => f.id === item.id);
                return (
                  <li key={item.id} className="text-xs flex items-center justify-between gap-2">
                    <span className={bulkKind === 'user' ? 'font-mono text-[11px]' : 'font-medium'}>
                      {item.label}
                    </span>
                    {failure && <span className="text-destructive">{failure.message}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {bulkFailures.length > 0 && (
            <StatusBanner variant="danger">
              {bulkFailures.length} could not be restored and remain selected. Retry or clear them.
            </StatusBanner>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>
              {bulkFailures.length > 0 ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulk} disabled={bulkPending}>
              {bulkPending
                ? 'Restoring…'
                : bulkFailures.length > 0
                  ? 'Retry'
                  : `Restore ${bulkList.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
