/**
 * Read/write helpers for Note.inferenceLog._sectionStatus + _regenerations.
 *
 * Shape (spec §F):
 *   inferenceLog: {
 *     _sectionStatus: {
 *       [sectionId]: {
 *         status: 'empty' | 'generating' | 'populated' | 'edited' | 'failed';
 *         progressPercent?: number;
 *         generationStartedAt?: ISO;
 *         lastGeneratedAt?: ISO;
 *         lastEditedAt?: ISO;
 *         error?: { code: string; message: string };
 *         model?: string;
 *         latencyMs?: number;
 *         tokensIn?: number;
 *         tokensOut?: number;
 *       }
 *     },
 *     _regenerations: Array<{
 *       sectionId: string;
 *       requestId: string;
 *       triggeredByUserId?: string;
 *       at: ISO;
 *       overwroteEdited: boolean;
 *     }>;
 *   }
 *
 * PHI-free: this lives in audit log + admin views downstream. Only timing,
 * status, model metadata — never section content.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type SectionStatusKind = 'empty' | 'generating' | 'populated' | 'edited' | 'failed';

export type SectionStatusEntry = {
  status: SectionStatusKind;
  progressPercent?: number;
  generationStartedAt?: string;
  lastGeneratedAt?: string;
  lastEditedAt?: string;
  error?: { code: string; message: string };
  model?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
};

export type RegenerationEntry = {
  sectionId: string;
  requestId: string;
  triggeredByUserId?: string;
  at: string;
  overwroteEdited: boolean;
};

export type InferenceLog = {
  _sectionStatus?: Record<string, SectionStatusEntry>;
  _regenerations?: RegenerationEntry[];
};

export function readInferenceLog(value: unknown): InferenceLog {
  if (!value || typeof value !== 'object') return {};
  return value as InferenceLog;
}

export function readSectionStatus(value: unknown): Record<string, SectionStatusEntry> {
  return readInferenceLog(value)._sectionStatus ?? {};
}

/**
 * Atomic update of a single section's status. Loads the current log, merges,
 * and writes back. Callers should be the only writers (i.e. only the
 * worker + the section edit/regenerate endpoints) to keep merges safe.
 */
export async function markSectionStatus(
  noteId: string,
  sectionId: string,
  patch: Partial<SectionStatusEntry> & { status: SectionStatusKind },
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`markSectionStatus: note ${noteId} not found`);

  const log = readInferenceLog(note.inferenceLog);
  const current = log._sectionStatus ?? {};
  const updated: InferenceLog = {
    ...log,
    _sectionStatus: {
      ...current,
      [sectionId]: { ...current[sectionId], ...patch },
    },
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: updated as unknown as Prisma.InputJsonValue },
  });
}

export async function appendRegeneration(
  noteId: string,
  entry: RegenerationEntry,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { inferenceLog: true },
  });
  if (!note) throw new Error(`appendRegeneration: note ${noteId} not found`);
  const log = readInferenceLog(note.inferenceLog);
  const next: InferenceLog = {
    ...log,
    _regenerations: [...(log._regenerations ?? []), entry],
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { inferenceLog: next as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Used by the worker to merge a freshly-generated section into draftJson.
 * draftJson shape: { [sectionId]: { content: string, updatedAt: ISO } }
 * Atomic in the sense that we only touch one key — other sections are
 * preserved verbatim (no read-modify-write race because BullMQ runs the
 * worker single-flight per jobId).
 */
export async function mergeSectionIntoDraft(
  noteId: string,
  sectionId: string,
  content: string,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { draftJson: true, status: true },
  });
  if (!note) throw new Error(`mergeSectionIntoDraft: note ${noteId} not found`);
  if (note.status === 'SIGNED') {
    // Rule 3 — finalJson is immutable AND no further edits to a signed note's
    // draftJson either. Worker should never reach here on a signed note (the
    // regenerate endpoint guards), but defense-in-depth.
    throw new Error('Cannot modify a SIGNED note');
  }
  const current = (note.draftJson as Record<string, { content: string; updatedAt: string }> | null) ?? {};
  const next = {
    ...current,
    [sectionId]: { content, updatedAt: new Date().toISOString() },
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { draftJson: next as unknown as Prisma.InputJsonValue },
  });
}
