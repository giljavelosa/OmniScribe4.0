'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type OwnerUser = {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
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

export function UsersSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<OwnerUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const queryString = useMemo(() => {
    const out = new URLSearchParams();
    if (q.trim()) out.set('q', q.trim());
    return out.toString();
  }, [q]);

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
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Cross-org user search</CardTitle>
        <CardDescription>
          Owner-only. Every search writes a PLATFORM_USERS_VIEWED row to PlatformAuditLog.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Orgs</th>
                <th className="text-left px-3 py-2 font-medium">Authenticator</th>
                <th className="text-left px-3 py-2 font-medium">Platform</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    {loading ? 'Loading…' : 'No users match.'}
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-b-0 align-top">
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
                      <StatusBadge variant={u.mfaEnabled ? 'success' : 'warning'} noIcon>
                        {u.mfaEnabled ? 'enrolled' : 'not enrolled'}
                      </StatusBadge>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="flex justify-center">
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
  );
}
