'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

export function VisitRequestButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState('25');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startSubmit] = useTransition();

  function submit() {
    setError(null);
    startSubmit(async () => {
      const res = await fetch('/api/capacity/visit-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedVisits: Number(visits),
          message: message.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(json?.error?.message ?? 'Request failed.');
        return;
      }
      setSent(true);
      setOpen(false);
    });
  }

  if (disabled) return null;

  return (
    <div className="space-y-2">
      {sent && (
        <StatusBanner variant="success">
          Visit request sent to your org admin. They can approve it from Capacity.
        </StatusBanner>
      )}
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {!open ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Request more visits
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="space-y-1">
            <Label>Visits needed</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={visits}
              onChange={(e) => setVisits(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Note to admin (optional)</Label>
            <Input
              value={message}
              maxLength={500}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Heavy clinic week…"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={submit}>
              {pending ? 'Sending…' : 'Send request'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
