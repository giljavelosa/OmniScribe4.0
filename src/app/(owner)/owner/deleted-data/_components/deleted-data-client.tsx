'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

  function confirmRestore() {
    if (!target) return;
    setError(null);
    const { kind, id } = target;
    const url =
      kind === 'org' ? `/api/owner/orgs/${id}/restore` : `/api/owner/users/${id}/restore`;
    startTransition(async () => {
      const res = await fetch(url, { method: 'POST' });
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
          <Card className="overflow-x-auto p-0" data-testid="deleted-orgs-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No deleted organizations.
                    </td>
                  </tr>
                ) : (
                  orgRows.map((o) => (
                    <tr key={o.id} className="border-b border-border last:border-b-0 align-top">
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
                          onClick={() =>
                            setTarget({ kind: 'org', id: o.id, label: o.name })
                          }
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
          <Card className="overflow-x-auto p-0" data-testid="deleted-users-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No deleted users.
                    </td>
                  </tr>
                ) : (
                  userRows.map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-b-0 align-top">
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
    </>
  );
}
