'use client';

import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBanner } from '@/components/ui/status-banner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { EpisodeChoice, ExternalContextSource } from './external-context-section';

const SOURCE_OPTIONS: Array<{ value: ExternalContextSource; label: string }> = [
  { value: 'PATIENT_SUPPLIED', label: 'Patient-supplied' },
  { value: 'OUTSIDE_PROVIDER', label: 'Outside provider' },
  { value: 'EARLIER_UNDOCUMENTED', label: 'Earlier undocumented visit' },
  { value: 'CLINICIAN_NOTES', label: "Clinician's notes" },
  { value: 'OTHER', label: 'Other' },
];

const MAX_TRANSCRIPT_BYTES = 200 * 1024; // 200 KB — server is source of truth, this is a UI hint
const MAX_AUDIO_MB = 200;
const NONE_EPISODE = '__none__';

/**
 * Add-prior-context modal. Two tabs: paste transcript / upload audio.
 * Common header carries date + source + optional source-label + optional
 * episode link. Submits to POST /api/patients/[id]/external-context.
 *
 * Uses Sheet (rule 22) — keeps modal surface consistent with the rest of
 * the clinical UI. Side-right placement; full-height on desktop, drawer-
 * style on mobile.
 *
 * Spec: context/specs/external-context-upload.md §UI.
 */
export function ExternalContextAddDialog({
  patientId,
  episodeChoices,
  open,
  onOpenChange,
  onAdded,
}: {
  patientId: string;
  episodeChoices: EpisodeChoice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [mode, setMode] = useState<'paste' | 'upload'>('paste');
  const [dateOfRecord, setDateOfRecord] = useState(todayIso);
  const [source, setSource] = useState<ExternalContextSource>('OUTSIDE_PROVIDER');
  const [sourceLabel, setSourceLabel] = useState('');
  const [episodeId, setEpisodeId] = useState<string>(NONE_EPISODE);

  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode('paste');
    setDateOfRecord(todayIso);
    setSource('OUTSIDE_PROVIDER');
    setSourceLabel('');
    setEpisodeId(NONE_EPISODE);
    setTranscript('');
    setAudioFile(null);
    setError(null);
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function submit() {
    setError(null);
    if (!dateOfRecord) {
      setError('Pick the date of the underlying event.');
      return;
    }
    if (mode === 'paste') {
      if (!transcript.trim()) {
        setError('Paste a transcript or switch to the upload tab.');
        return;
      }
      const bytes = new Blob([transcript]).size;
      if (bytes > MAX_TRANSCRIPT_BYTES) {
        setError('Transcript is too long. Keep it under 200 KB.');
        return;
      }
    } else {
      if (!audioFile) {
        setError('Pick an audio file (.wav / .mp3 / .m4a) or switch to the paste tab.');
        return;
      }
      if (audioFile.size > MAX_AUDIO_MB * 1024 * 1024) {
        setError(`Audio file is too large. Maximum ${MAX_AUDIO_MB} MB.`);
        return;
      }
    }

    startTransition(async () => {
      try {
        let res: Response;
        if (mode === 'paste') {
          res = await fetch(`/api/patients/${patientId}/external-context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'paste',
              dateOfRecord,
              source,
              sourceLabel: sourceLabel.trim() || null,
              episodeOfCareId: episodeId === NONE_EPISODE ? null : episodeId,
              transcript,
            }),
          });
        } else {
          const fd = new FormData();
          fd.set('dateOfRecord', dateOfRecord);
          fd.set('source', source);
          if (sourceLabel.trim()) fd.set('sourceLabel', sourceLabel.trim());
          if (episodeId !== NONE_EPISODE) fd.set('episodeOfCareId', episodeId);
          fd.set('audio', audioFile as Blob, (audioFile as File).name);
          res = await fetch(`/api/patients/${patientId}/external-context`, {
            method: 'POST',
            body: fd,
          });
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string; code?: string };
          };
          setError(body.error?.message ?? "Couldn't save. Try again.");
          return;
        }
        reset();
        onAdded();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something on our end went wrong.');
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Add prior context</SheetTitle>
          <SheetDescription>
            Reference material for this patient. Not part of any visit note.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ec-date">Date of underlying event</Label>
            <Input
              id="ec-date"
              type="date"
              max={todayIso}
              value={dateOfRecord}
              onChange={(e) => setDateOfRecord(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ec-source">Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as ExternalContextSource)}>
              <SelectTrigger id="ec-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ec-source-label">
              Source label <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="ec-source-label"
              placeholder="e.g. Dr. Smith referral letter"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              maxLength={500}
            />
          </div>

          {episodeChoices.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="ec-episode">
                Tie to active episode <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Select value={episodeId} onValueChange={setEpisodeId}>
                <SelectTrigger id="ec-episode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_EPISODE}>None</SelectItem>
                  {episodeChoices.map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      {ep.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'paste' | 'upload')} className="pt-2">
            <TabsList>
              <TabsTrigger value="paste">Paste transcript</TabsTrigger>
              <TabsTrigger value="upload">Upload audio</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-2">
              <Label htmlFor="ec-transcript" className="sr-only">
                Transcript
              </Label>
              <Textarea
                id="ec-transcript"
                placeholder="Paste the transcript, referral letter, or your recollection. Up to 200 KB."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={12}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {new Blob([transcript]).size.toLocaleString()} / {MAX_TRANSCRIPT_BYTES.toLocaleString()} bytes
              </p>
            </TabsContent>
            <TabsContent value="upload" className="space-y-2">
              <Label htmlFor="ec-audio" className="sr-only">
                Audio file
              </Label>
              <Input
                id="ec-audio"
                type="file"
                accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              />
              {audioFile ? (
                <p className="text-xs text-muted-foreground">
                  {audioFile.name} · {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_AUDIO_MB} MB. Audio is transcribed in the background; the entry
                  appears in the list with a Transcribing badge until it is ready.
                </p>
              )}
            </TabsContent>
          </Tabs>

          {error ? <StatusBanner variant="danger">{error}</StatusBanner> : null}
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={() => handleClose(false)} disabled={pending}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : 'Add to chart'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
