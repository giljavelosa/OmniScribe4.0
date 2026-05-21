/**
 * Shared builders for the demo visit seed corpus.
 */

export type FinalSectionSeed = {
  id: string;
  label: string;
  content: string;
  required?: boolean;
};

export type TranscriptLineSeed = {
  speaker: 'CLINICIAN' | 'PATIENT';
  text: string;
  startMs?: number;
};

export type HandoutSeed = {
  plainLanguage: string;
  bulletPoints: string[];
  whatToWatchFor: string[];
  whenToCallUs: string[];
};

export type ReferralLetterSeed = {
  recipient: string;
  subject: string;
  body: string;
};

export type SeedVisitCorpus = {
  noteId: string;
  orgId?: string;
  siteId?: string;
  patientId: string;
  patientFirstName: string;
  clinicianEmail: string;
  division: import('@prisma/client').Division;
  templateId: string;
  signedDaysAgo: number;
  departmentKey: 'medical' | 'rehab' | 'bh';
  episodeId?: string;
  isLateEntry?: boolean;
  lateEntryDaysGap?: number;
  sections: FinalSectionSeed[];
  transcript: TranscriptLineSeed[];
  handout: HandoutSeed;
  referralLetter?: ReferralLetterSeed;
};

export function buildFinalJson(sections: FinalSectionSeed[], signedAt: Date) {
  return {
    schemaVersion: 1,
    signedAt: signedAt.toISOString(),
    sections: sections.map((s) => ({
      id: s.id,
      label: s.label,
      content: s.content,
      required: s.required ?? true,
    })),
  };
}

export function buildTranscriptClean(lines: TranscriptLineSeed[]) {
  const structured = lines.map((line, i) => ({
    text: line.text,
    speaker: line.speaker,
    originalSpeaker: line.speaker === 'CLINICIAN' ? 1 : 2,
    startMs: line.startMs ?? i * 12_000,
    endMs: (line.startMs ?? i * 12_000) + 10_000,
  }));
  const plaintext = structured.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  const wordCount = plaintext.split(/\s+/).filter(Boolean).length;
  const last = structured[structured.length - 1];
  const durationMs = last ? (last.endMs ?? last.startMs ?? 0) + 5000 : 0;
  return {
    plaintext,
    structured,
    durationMs,
    wordCount,
    speakerCount: 2,
    source: 'realtime' as const,
  };
}

/** Spread transcript lines across a realistic visit duration (default 35 min). */
export function timedTranscript(
  lines: Array<{ speaker: 'CLINICIAN' | 'PATIENT'; text: string }>,
  durationMinutes = 35,
): TranscriptLineSeed[] {
  if (lines.length === 0) return [];
  const totalMs = durationMinutes * 60 * 1000;
  const gapMs = Math.floor(totalMs / lines.length);
  return lines.map((line, i) => ({
    ...line,
    startMs: i * gapMs,
  }));
}

/** Standard handout builder from plan bullets. */
export function handout(
  summary: string,
  bullets: string[],
  watch: string[],
  call: string[],
): HandoutSeed {
  return {
    plainLanguage: summary,
    bulletPoints: bullets,
    whatToWatchFor: watch,
    whenToCallUs: call,
  };
}
