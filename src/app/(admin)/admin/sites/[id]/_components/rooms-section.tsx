'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type Room = {
  id: string;
  name: string;
  isArchived: boolean;
  archivedAt: Date | null;
};

type Props = {
  siteId: string;
  siteIsArchived: boolean;
  rooms: Room[];
};

/**
 * RoomsSection — nested-CRUD UI for rooms under a single site. Inline rename
 * for active rooms; archive / unarchive single-tap. Adding rooms uses a small
 * inline form (no sheet — adding a room is a one-field operation).
 */
export function RoomsSection({ siteId, siteIsArchived, rooms }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commitCreate() {
    setError(null);
    if (!newName.trim()) {
      setError('Room name is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/sites/${siteId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Create failed (${res.status}).`);
        return;
      }
      setNewName('');
      setAddOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-md font-medium">Rooms</h2>
        {!siteIsArchived && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAddOpen((v) => !v)}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add room
          </Button>
        )}
      </div>

      {siteIsArchived && (
        <StatusBanner variant="info">
          Site is archived — unarchive to manage rooms.
        </StatusBanner>
      )}

      {addOpen && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <Label htmlFor="new-room-name" className="text-xs">
            Room name
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="new-room-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value.slice(0, 80))}
              placeholder="Exam Room 3"
              maxLength={80}
              disabled={pending}
              autoFocus
            />
            <Button type="button" size="sm" onClick={commitCreate} disabled={pending}>
              {pending ? 'Adding…' : 'Add'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAddOpen(false);
                setNewName('');
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
        </div>
      )}

      {rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rooms yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rooms.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2">
              <RoomRow room={r} disabled={pending || siteIsArchived} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoomRow({ room, disabled }: { room: Room; disabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lockDisabled = disabled || pending;

  function commitRename() {
    setError(null);
    if (!name.trim()) {
      setError('Required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function toggleArchive() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/rooms/${room.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: room.isArchived ? 'unarchive' : 'archive' }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Action failed (${res.status}).`);
        return;
      }
      router.refresh();
    });
  }

  if (editing) {
    return (
      <>
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 80))}
            maxLength={80}
            disabled={pending}
            autoFocus
          />
          {error && <span className="text-xs text-[var(--status-danger-fg)]">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={commitRename} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(room.name);
              setError(null);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-medium">{room.name}</span>
        {room.isArchived && (
          <StatusBadge variant="neutral" noIcon>archived</StatusBadge>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!room.isArchived && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={lockDisabled}
          >
            Rename
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleArchive}
          disabled={lockDisabled}
        >
          {room.isArchived ? 'Unarchive' : 'Archive'}
        </Button>
      </div>
    </>
  );
}
