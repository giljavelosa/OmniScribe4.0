'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { AuditMetadataDiff } from '@/components/audit/audit-metadata-diff';

type AuditRow = {
  id: string;
  createdAt: string;
  orgId: string | null;
  orgName: string | null;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
};

type Filter = {
  from: string;
  to: string;
  action: string;
  orgId: string;
  userId: string;
  resourceId: string;
};

const EMPTY: Filter = { from: '', to: '', action: '', orgId: '', userId: '', resourceId: '' };

type Props = {
  knownActions: string[];
  knownOrgs: { id: string; name: string }[];
  /** Unit 33 — endpoint overrides so /ops/audit (PLATFORM_STAFF-gated)
   *  can reuse this component pointed at `/api/ops/audit-search` instead
   *  of the owner's `/api/owner/audit`. Defaults preserve the original
   *  /owner/audit behavior so nothing breaks. */
  searchPath?: string;
  exportPath?: string;
  /** Header copy — defaults to the owner-console phrasing; the ops
   *  page overrides to clarify the gate distinction. */
  title?: string;
  description?: string;
};

export function PlatformAuditTable({
  knownActions,
  knownOrgs,
  searchPath = '/api/owner/audit',
  exportPath = '/api/owner/audit/export',
  title = 'Platform-wide audit',
  description = "Every org's audit rows in one place. PHI-free by the writeAuditLog denylist; reads themselves audit to PlatformAuditLog as PLATFORM_AUDIT_VIEWED.",
}: Props) {
  const [filter, setFilter] = useState<Filter>(EMPTY);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => buildQuery(filter), [filter]);

  function load(opts: { append?: boolean; cursor?: string | null } = {}) {
    setError(null);
    startLoading(async () => {
      const q = new URLSearchParams(queryString);
      if (opts.cursor) q.set('cursor', opts.cursor);
      const res = await fetch(`${searchPath}?${q.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Load failed (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { data: AuditRow[]; nextCursor: string | null };
      setRows((curr) => (opts.append ? [...curr, ...json.data] : json.data));
      setNextCursor(json.nextCursor);
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  function downloadCsv() {
    const q = new URLSearchParams(queryString);
    window.open(`${exportPath}?${q.toString()}`, '_blank');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="po-from">From</Label>
            <Input id="po-from" type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} disabled={loading} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="po-to">To</Label>
            <Input id="po-to" type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} disabled={loading} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Org</Label>
            <Select value={filter.orgId || '__all__'} onValueChange={(v) => setFilter({ ...filter, orgId: v === '__all__' ? '' : v })}>
              <SelectTrigger disabled={loading}><SelectValue placeholder="(any)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">(any org)</SelectItem>
                {knownOrgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={filter.action || '__all__'} onValueChange={(v) => setFilter({ ...filter, action: v === '__all__' ? '' : v })}>
              <SelectTrigger disabled={loading}><SelectValue placeholder="(any)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">(any action)</SelectItem>
                {knownActions.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="po-user">User ID</Label>
            <Input id="po-user" value={filter.userId} onChange={(e) => setFilter({ ...filter, userId: e.target.value.slice(0, 64) })} placeholder="exact" disabled={loading} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="po-resource">Resource ID</Label>
            <Input id="po-resource" value={filter.resourceId} onChange={(e) => setFilter({ ...filter, resourceId: e.target.value.slice(0, 64) })} placeholder="contains…" disabled={loading} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => setFilter(EMPTY)} disabled={loading}>Clear filters</Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={loading}>
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>

        {error && <StatusBanner variant="danger">{error}</StatusBanner>}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Org</th>
                <th className="text-left px-3 py-2 font-medium">Actor</th>
                <th className="text-left px-3 py-2 font-medium">Action</th>
                <th className="text-left px-3 py-2 font-medium">Resource</th>
                <th className="text-left px-3 py-2 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{loading ? 'Loading…' : 'No audit rows match the current filters.'}</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.orgName ?? <span className="text-muted-foreground">(platform)</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {r.userEmail ?? (r.userId ? `id:${r.userId.slice(0, 6)}…` : '(system)')}
                    </td>
                    <td className="px-3 py-2"><StatusBadge variant="neutral" noIcon>{r.action}</StatusBadge></td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.resourceType ? `${r.resourceType}:${r.resourceId ?? '?'}` : '—'}</td>
                    <td className="px-3 py-2 max-w-md">
                      <AuditMetadataDiff metadata={r.metadata} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {nextCursor && (
          <div className="flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={() => load({ append: true, cursor: nextCursor })} disabled={loading}>
              Load more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildQuery(filter: Filter): string {
  const out = new URLSearchParams();
  if (filter.from) out.set('from', `${filter.from}T00:00:00.000Z`);
  if (filter.to) out.set('to', `${filter.to}T23:59:59.999Z`);
  if (filter.action) out.set('action', filter.action);
  if (filter.orgId) out.set('orgId', filter.orgId);
  if (filter.userId) out.set('userId', filter.userId);
  if (filter.resourceId) out.set('resourceId', filter.resourceId);
  return out.toString();
}
