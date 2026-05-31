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
const MAX_DOCUMENT_MB = 25;
const MAX_DOCUMENT_FILES = 5;
const NONE_EPISODE = '__none__';
export type ExternalContextAddMode = 'paste' | 'upload' | 'document';

/**
 * Add outside records modal. Three tabs: paste transcript / upload audio /
 * upload document.
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
  initialMode = 'document',
}: {
  patientId: string;
  episodeChoices: EpisodeChoice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
  initialMode?: ExternalContextAddMode;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [mode, setMode] = useState<ExternalContextAddMode>(initialMode);
  const [dateOfRecord, setDateOfRecord] = useState(todayIso);
  const [source, setSource] = useState<ExternalContextSource>('OUTSIDE_PROVIDER');
  const [sourceLabel, setSourceLabel] = useState('');
  const [episodeId, setEpisodeId] = useState<string>(NONE_EPISODE);

  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode(initialMode);
    setDateOfRecord(todayIso);
    setSource('OUTSIDE_PROVIDER');
    setSourceLabel('');
    setEpisodeId(NONE_EPISODE);
    setTranscript('');
    setAudioFile(null);
    setDocumentFiles([]);
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
    } else if (mode === 'upload') {
      if (!audioFile) {
        setError('Pick an audio file (.wav / .mp3 / .m4a) or switch to the paste tab.');
        return;
      }
      if (audioFile.size > MAX_AUDIO_MB * 1024 * 1024) {
        setError(`Audio file is too large. Maximum ${MAX_AUDIO_MB} MB.`);
        return;
      }
    } else {
      if (documentFiles.length === 0) {
        setError('Pick a PDF or image, or use the camera capture control.');
        return;
      }
      if (documentFiles.length > MAX_DOCUMENT_FILES) {
        setError(`Upload at most ${MAX_DOCUMENT_FILES} document files at a time.`);
        return;
      }
      if (documentFiles.some((file) => file.size > MAX_DOCUMENT_MB * 1024 * 1024)) {
        setError(`Each document must be smaller than ${MAX_DOCUMENT_MB} MB.`);
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
        } else if (mode === 'upload') {
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
        } else {
          const fd = new FormData();
          fd.set('mode', 'document');
          fd.set('dateOfRecord', dateOfRecord);
          fd.set('source', source);
          if (sourceLabel.trim()) fd.set('sourceLabel', sourceLabel.trim());
          if (episodeId !== NONE_EPISODE) fd.set('episodeOfCareId', episodeId);
          for (const file of documentFiles) {
            fd.append('documents', file, file.name);
          }
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
          <SheetTitle>Add outside record</SheetTitle>
          <SheetDescription>
            Upload PDFs, images, referral notes, labs, or audio. These records stay separate from visit notes.
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

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'paste' | 'upload' | 'document')} className="pt-2">
            <TabsList>
              <TabsTrigger value="paste">Paste transcript</TabsTrigger>
              <TabsTrigger value="upload">Upload audio</TabsTrigger>
              <TabsTrigger value="document">Upload document</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-2">
              <Label htmlFor="ec-transcript" className="sr-only">
                Transcript
              </Label>
              <Textarea
                id="ec-transcript"
                placeholder="Paste a transcript, referral letter, outside note, or patient-supplied text. Up to 200 KB."
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
            <TabsContent value="document" className="space-y-3">
              <DocumentDropZone
                files={documentFiles}
                onFilesChange={setDocumentFiles}
              />
              <div className="space-y-2">
                <Label htmlFor="ec-camera">Tablet camera capture</Label>
                <Input
                  id="ec-camera"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setDocumentFiles(Array.from(e.target.files ?? []))}
                />
              </div>
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
              {pending ? 'Saving…' : mode === 'document' ? 'Upload document' : 'Add to chart'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DocumentDropZone({
  files,
  onFilesChange,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  function addFiles(list: FileList | File[]) {
    onFilesChange(Array.from(list).slice(0, MAX_DOCUMENT_FILES));
  }

  return (
    <div
      className="rounded-lg border border-dashed border-border bg-muted/30 p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="ec-document">Upload PDF or image files</Label>
        <Input
          id="ec-document"
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => addFiles(e.target.files ?? [])}
        />
        {files.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Drop up to {MAX_DOCUMENT_FILES} files here. Outside records are extracted in the background, then require review before they can inform briefs or Cleo.
          </p>
        )}
      </div>
    </div>
  );
}
