'use client';

import { useEffect, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  targetOrgIds: string[];
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
};

type Org = { id: string; name: string };

export function AnnouncementsClient({ orgs }: { orgs: Org[] }) {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function load() {
    startLoading(async () => {
      const res = await fetch('/api/owner/announcements');
      if (!res.ok) {
        setError('Failed to load announcements.');
        return;
      }
      const json = (await res.json()) as { data: Announcement[] };
      setRows(json.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  function handleCreated() {
    setCreating(false);
    load();
  }

  function handleDeleted() {
    setDeleteId(null);
    load();
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-md">System announcements</CardTitle>
            <CardDescription>
              Stored in <code>SystemAnnouncement</code>. Banner-render across the app lands in
              a later wave; v1 surface is the management UI only.
            </CardDescription>
          </div>
          <Button onClick={() => setCreating(true)} disabled={loading}>
            <Plus className="size-4" aria-hidden="true" />
            New announcement
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : 'No announcements yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((a) => (
                <li key={a.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{a.title}</p>
                        <SeverityBadge severity={a.severity} />
                        <span className="text-xs text-muted-foreground">
                          {a.targetOrgIds.length === 0
                            ? 'all orgs'
                            : `${a.targetOrgIds.length} org${a.targetOrgIds.length === 1 ? '' : 's'}`}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.startsAt).toLocaleString()}
                        {a.endsAt ? ` → ${new Date(a.endsAt).toLocaleString()}` : ' (no end)'}
                      </p>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(a.id)}
                      disabled={loading}
                      aria-label={`Delete announcement ${a.title}`}
                    >
                      <Trash2 className="size-4 text-[var(--status-danger-fg)]" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateAnnouncementSheet orgs={orgs} onClose={() => setCreating(false)} onCreated={handleCreated} />
      )}
      <DeleteConfirm
        id={deleteId}
        onCancel={() => setDeleteId(null)}
        onDeleted={handleDeleted}
      />
    </>
  );
}

function SeverityBadge({ severity }: { severity: 'info' | 'warning' | 'critical' }) {
  const variant = severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
  return (
    <StatusBadge variant={variant} noIcon>
      {severity}
    </StatusBadge>
  );
}

function CreateAnnouncementSheet({
  orgs,
  onClose,
  onCreated,
}: {
  orgs: Org[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('info');
  const [targetMode, setTargetMode] = useState<'all' | 'select'>('all');
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/owner/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          severity,
          targetOrgIds: targetMode === 'all' ? [] : selectedOrgIds,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Create failed (${res.status}).`);
        return;
      }
      onCreated();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-md">New system announcement</CardTitle>
          <CardDescription>
            Visible to the targeted orgs between the schedule window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 160))} maxLength={160} disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-body">Body (markdown)</Label>
            <Textarea id="ann-body" value={body} onChange={(e) => setBody(e.target.value.slice(0, 8000))} rows={5} maxLength={8000} disabled={pending} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as 'info' | 'warning' | 'critical')}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Select value={targetMode} onValueChange={(v) => setTargetMode(v as 'all' | 'select')}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All orgs</SelectItem>
                  <SelectItem value="select">Select orgs…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {targetMode === 'select' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Pick orgs ({selectedOrgIds.length} selected)</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {orgs.map((o) => {
                  const checked = selectedOrgIds.includes(o.id);
                  return (
                    <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        onChange={() =>
                          setSelectedOrgIds((curr) =>
                            curr.includes(o.id)
                              ? curr.filter((id) => id !== o.id)
                              : [...curr, o.id],
                          )
                        }
                      />
                      {o.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ann-start">Starts at</Label>
              <Input id="ann-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-end">Ends at (optional)</Label>
              <Input id="ann-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={pending} />
            </div>
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? 'Creating…' : 'Create announcement'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeleteConfirm({
  id,
  onCancel,
  onDeleted,
}: {
  id: string | null;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!id) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/announcements/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Delete failed (${res.status}).`);
        return;
      }
      onDeleted();
    });
  }

  return (
    <AlertDialog open={!!id} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete announcement?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the row permanently. The deletion is audited.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
