# Unit 06: Prior-Context Brief + Follow-up Lifecycle

## Goal

Build the precomputed 30-second pre-visit brief and the follow-up lifecycle that drives it. After this unit, a returning patient's `/prepare/[noteId]` page renders a structured brief in < 1 second, every fact has a source pill, open follow-ups display, and the sign-time sweep modal forces a decision on each open follow-up before sign completes. This is what turns OmniScribe from "scribe" into "scribe + clinical context system."

## Design

Read [`journeys/03-returning-patient-with-brief.md`](../../journeys/03-returning-patient-with-brief.md) for the user experience. Read [`references/prior-context-brief-spec.md`](../../references/prior-context-brief-spec.md), [`references/prior-context-brief-prompt.md`](../../references/prior-context-brief-prompt.md), [`references/prior-context-brief-ui-spec.md`](../../references/prior-context-brief-ui-spec.md) for the canonical detail.

The brief renders on three surfaces:

1. **`/prepare/[noteId]`** — read-only `<BriefCard>` above the setup form
2. **`/capture/[noteId]`** — `<PriorContextPanel>` in the right pane (desktop) / History tab (mobile); tappable follow-ups with Met / Drop / Carry inline actions
3. **`/sign/[noteId]`** — sign-time sweep modal forcing a decision on every still-`OPEN` `FollowUp` before sign

Components (per UI spec):
- `<BriefCard>` — `Card` container, `rounded-xl`
- `<BriefHeader>` — patient one-liner + episode + last-seen
- `<TrajectoryTable>` — division-keyed measure trajectory with trend arrows
- `<FollowUpPreviewList>` — open follow-ups with provenance pill + status toggle
- `<GoalsSnapshot>` — top 3 active goals
- `<WatchList>` — flagged items from prior visits
- `<BriefFooter>` — "sources: N signed notes" + jump-to-source links

Every fact has a **source pill** linking to source note + section. No pill = no render.

## Implementation

### A. Prisma schema additions

```prisma
model NoteBrief {
  id              String   @id @default(cuid())
  noteId          String   @unique
  note            Note     @relation(fields: [noteId], references: [id])
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  orgId           String
  organization    Organization @relation(fields: [orgId], references: [id])
  
  sourceNoteIds   String[]
  generatedAt     DateTime @default(now())
  generatorVersion String   // for invalidation when prompt changes
  model           String   // 'sonnet-4.5' | 'haiku-4.5'
  
  content         Json     // PriorContextBriefContent (Zod-validated)
  
  @@index([patientId, generatedAt])
}

model FollowUp {
  id              String   @id @default(cuid())
  orgId           String
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  episodeId       String?
  episode         EpisodeOfCare? @relation(fields: [episodeId], references: [id])
  originNoteId    String
  originNote      Note     @relation("origin", fields: [originNoteId], references: [id])
  closingNoteId   String?
  closingNote     Note?    @relation("closing", fields: [closingNoteId], references: [id])
  
  text            String
  status          FollowUpStatus @default(OPEN)
  createdAt       DateTime @default(now())
  closedAt        DateTime?
  closedByOrgUserId String?
  
  @@index([patientId, status])
  @@index([orgId, status])
}

enum FollowUpStatus {
  OPEN
  MET
  CARRIED
  DROPPED
  CLOSED_BY_DISCHARGE
}
```

### B. `PriorContextBriefContent` schema (Zod)

`src/types/brief.ts`:

```ts
import { z } from 'zod';

export const TrajectoryMeasureSchema = z.object({
  label: z.string(),
  values: z.array(z.object({ date: z.string(), value: z.string() })).max(3),
  direction: z.enum(['improving', 'declining', 'stable', 'mixed']).optional(),
});

export const MeasureValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  source: z.object({ noteId: z.string(), date: z.string() }),
});

export const GoalSnapshotSchema = z.object({
  goalId: z.string(),
  goalText: z.string(),
  goalType: z.enum(['STG', 'LTG']),
  status: z.enum(['ACTIVE', 'MET', 'NOT_MET', 'MODIFIED', 'PARTIALLY_MET']),
});

export const FollowUpPreviewSchema = z.object({
  followUpId: z.string(),
  text: z.string(),
  status: z.enum(['OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE']),
  source: z.object({ noteId: z.string(), date: z.string() }),
});

export const PriorContextBriefContentSchema = z.object({
  patientOneLine: z.string(),
  episodeContext: z.object({
    episodeId: z.string(),
    label: z.string(),
    diagnosis: z.string(),
    bodyPart: z.string().optional(),
  }).optional(),
  lastVisit: z.object({
    noteId: z.string(),
    date: z.string(),
    clinicianName: z.string(),
    noteType: z.string(),
    daysAgo: z.number(),
  }),
  chiefConcern: z.string(),
  priorAssessment: z.string(),
  trajectory: z.array(TrajectoryMeasureSchema),
  objectiveMeasures: z.array(MeasureValueSchema),
  interventionsPerformed: z.array(z.string()),
  homeProgram: z.string(),
  educationGiven: z.array(z.string()),
  carryForwardPlan: z.array(z.string()),
  topActiveGoals: z.array(GoalSnapshotSchema).max(3),
  watch: z.array(z.object({ text: z.string(), source: z.object({ noteId: z.string(), date: z.string() }) })),
  openFollowUps: z.array(FollowUpPreviewSchema),
  sourceNoteIds: z.array(z.string()),
});

export type PriorContextBriefContent = z.infer<typeof PriorContextBriefContentSchema>;
```

### C. Brief generator service

`src/services/brief/BriefGenerator.ts`:

```ts
export class BriefGenerator {
  constructor(private llm: LLMService) {}
  
  async generate(input: BriefBuilderInput): Promise<PriorContextBriefContent> {
    const system = buildBriefSystemPrompt(input.division);
    const user = buildBriefUserMessage(input);
    const result = await this.llm.generate(system, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'sonnet',
    });
    
    try {
      return PriorContextBriefContentSchema.parse(JSON.parse(result.text));
    } catch (err) {
      // Sonnet failed schema; retry with Haiku (thinner brief is still valid)
      const fallback = await this.llm.generate(system, user, { phi: true, temperature: 0, jsonMode: true, model: 'haiku' });
      return PriorContextBriefContentSchema.parse(JSON.parse(fallback.text));
    }
  }
}
```

`src/services/brief/prompt.ts` — `buildBriefSystemPrompt(division)` and `buildBriefUserMessage(input)`. Per [`references/prior-context-brief-prompt.md`](../../references/prior-context-brief-prompt.md):

**Three absolute rules in system prompt**:
1. **Source-grounded only** — no inference, no clinical conclusions beyond source notes
2. **Verbatim where precision matters** — plan items, dosages, measurements, codes quoted exactly
3. **Structured > narrative** — labeled fields + arrays over prose; ≤ 1 sentence for text fields

**User message structure**:
- Patient identity block (PHI-aware projection)
- Episode context
- 1–3 prior signed notes (oldest first; full sections)
- Open follow-ups list
- Top active goals
- Output schema reminder
- Few-shot examples (1–2 per division)

### D. `note-brief` worker

`src/workers/note-brief.worker.ts`:

```ts
export const noteBriefHandler = async (job: Job<{ noteId: string }>) => {
  const { noteId } = job.data;
  
  const signedNote = await prisma.note.findUnique({
    where: { id: noteId },
    include: { patient: true, encounter: { include: { episode: true } } },
  });
  if (!signedNote || signedNote.status !== 'SIGNED') return; // idempotent guard
  
  // Load up to 2 prior signed notes for this (patient, episode)
  const priorNotes = await prisma.note.findMany({
    where: {
      patientId: signedNote.patientId,
      orgId: signedNote.orgId,
      status: { in: ['SIGNED', 'TRANSFERRED'] },
      id: { not: noteId },
      ...(signedNote.encounter.episodeOfCareId ? { encounter: { episodeOfCareId: signedNote.encounter.episodeOfCareId } } : {}),
    },
    orderBy: { signedAt: 'desc' },
    take: 2,
  });
  
  const openFollowUps = await prisma.followUp.findMany({
    where: { patientId: signedNote.patientId, status: 'OPEN' },
  });
  
  const topGoals = signedNote.encounter.episodeOfCareId
    ? await prisma.episodeGoal.findMany({
        where: { episodeId: signedNote.encounter.episodeOfCareId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 3,
      })
    : [];
  
  const input: BriefBuilderInput = {
    patient: projectPatientForBrief(signedNote.patient),
    episode: signedNote.encounter.episode ? projectEpisodeForBrief(signedNote.encounter.episode) : undefined,
    signedNotes: [signedNote, ...priorNotes].reverse().map(projectSignedNoteForBrief), // oldest first
    openFollowUps: openFollowUps.map(projectFollowUpForBrief),
    topActiveGoals: topGoals.map(projectGoalForBrief),
    division: signedNote.division,
  };
  
  const briefGenerator = new BriefGenerator(getLLMService());
  const content = await briefGenerator.generate(input);
  
  await prisma.noteBrief.upsert({
    where: { noteId },
    create: {
      noteId,
      patientId: signedNote.patientId,
      orgId: signedNote.orgId,
      sourceNoteIds: content.sourceNoteIds,
      generatorVersion: BRIEF_GENERATOR_VERSION,
      model: 'sonnet-4.5',
      content,
    },
    update: {
      content,
      sourceNoteIds: content.sourceNoteIds,
      generatedAt: new Date(),
      generatorVersion: BRIEF_GENERATOR_VERSION,
    },
  });
  
  // Also extract follow-ups from this just-signed note's plan section
  const extractor = new FollowupExtractor(getLLMService());
  const newFollowUps = await extractor.extractFromFinalJson(noteId, signedNote.finalJson);
  await prisma.followUp.createMany({
    data: newFollowUps.map(fu => ({
      orgId: signedNote.orgId,
      patientId: signedNote.patientId,
      episodeId: signedNote.encounter.episodeOfCareId,
      originNoteId: noteId,
      text: fu.text,
      status: 'OPEN',
    })),
  });
  
  await writeAuditLog({
    orgId: signedNote.orgId,
    action: 'BRIEF_GENERATED',
    resourceType: 'NoteBrief',
    resourceId: noteId,
    metadata: {
      sourceNoteIdCount: content.sourceNoteIds.length,
      model: 'sonnet-4.5',
      followUpsCreated: newFollowUps.length,
    },
  });
};
```

JobId: `note-brief:{noteId}` (stable, idempotent).

### E. `FollowupExtractor` service

`src/services/brief/FollowupExtractor.ts`:

```ts
export class FollowupExtractor {
  constructor(private llm: LLMService) {}
  
  async extractFromFinalJson(noteId: string, finalJson: NoteFinalJson): Promise<{ text: string }[]> {
    const planSection = extractPlanSection(finalJson);
    const result = await this.llm.generate(
      EXTRACTOR_SYSTEM_PROMPT,
      `Plan section:\n${JSON.stringify(planSection)}`,
      { phi: true, temperature: 0, jsonMode: true, model: 'haiku' } // Haiku is fast + cheap enough
    );
    const parsed = z.array(z.object({ text: z.string() })).parse(JSON.parse(result.text));
    return parsed;
  }
}
```

### F. API surfaces

- `GET /api/patients/[patientId]/brief?episodeId=…` — returns most-recent `NoteBrief` for the patient (and episode if specified). Cached at the HTTP level (Cache-Control 60s); regenerated via webhook from `note-brief` worker.
- `GET /api/notes/[noteId]/brief` — admin / debug surface; returns the brief computed FROM this note (1:1)
- `POST /api/follow-ups/[id]/close` — `requireFeatureAccess('NOTE_EDIT')`; body `{ status, closingNoteId }`; updates FollowUp + audits `FOLLOWUP_CLOSED`

### G. UI components

In `src/components/brief/`:
- `<BriefCard>`, `<BriefHeader>`, `<TrajectoryTable>`, `<FollowUpPreviewList>`, `<GoalsSnapshot>`, `<WatchList>`, `<BriefFooter>` per [`references/prior-context-brief-ui-spec.md`](../../references/prior-context-brief-ui-spec.md)
- All use UI tokens; no hardcoded colors
- Source pills are clickable links to `/review/<sourceNoteId>?section=<section>` (opens source in a drawer)

In `src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx` — wraps `<BriefCard>` + inline `<FollowUpRow>` (Met / Drop / Carry) actions.

In `src/components/copilot/cards/OpenFollowUpsCard.tsx` and `PlanForTodayCard.tsx` (used in Unit 07).

In `src/components/sign/SignTimeFollowUpSweepDialog.tsx` — `<AlertDialog>` listing open follow-ups with status pickers; submit closes all atomically.

### H. Empty / edge states

- No prior signed notes → brief is `null`; UI shows "First visit — no prior context."
- Brief generation failed at sign time → brief content is `null`; UI shows banner "Couldn't generate brief — show source notes" with links to last 2 signed notes
- Brief is stale (>30 days since `generatedAt` AND patient has been seen since) → staleness chip "Last visit was N days ago"

### I. Sign integration

The sign workflow (Unit 05 §H) loads open FollowUps for this patient. If any are `OPEN`, the sign-time sweep modal blocks sign until each has a status decision. Closing a FollowUp in the sweep is the same operation as closing it via `POST /api/follow-ups/[id]/close` — same audit, same data update.

## Dependencies

- All from prior units. No new packages.

## Verify when done

- [ ] Schema: `NoteBrief` 1:1 with signed Note; `FollowUp` with lifecycle enum; migrations applied.
- [ ] `note-brief` queue + worker registered; idempotent jobId; 3-retry exp backoff.
- [ ] Brief precomputes on sign (Unit 05 sign route enqueues the job); no per-render generation.
- [ ] Brief content Zod-validated; malformed briefs rejected; second pass via Haiku 4.5.
- [ ] Three absolute rules enforced in prompt (source-grounded, verbatim, structured) — verify by reading the prompt module.
- [ ] `/prepare/[noteId]` renders `<BriefCard>` for returning patient < 1 second after page load.
- [ ] `/capture/[noteId]` `<PriorContextPanel>` shows open follow-ups with inline Met/Drop/Carry.
- [ ] `/sign/[noteId]` sweep modal forces a decision on every open follow-up before sign completes.
- [ ] Follow-up extraction runs post-sign and populates `FollowUp` rows; idempotent on retry.
- [ ] Every brief field has a source pill linking to source note + section.
- [ ] Audit: `BRIEF_GENERATED`, `FOLLOWUP_CREATED`, `FOLLOWUP_CLOSED` — all PHI-free.
- [ ] Performance: brief renders < 1 second from cache; precompute completes < 30 seconds post-sign.
- [ ] Rule 20 verified: brief reads only `Note.status ∈ {SIGNED, TRANSFERRED}` (code grep on the worker handler).
- [ ] Empty / failed / stale states render correctly.
- [ ] Three-lens evaluation: Clinician (30-second read achievable; source pills build trust), Compliance (Rule 20 — attested sources only), Auditor (source attestation enables reconstruction).
- [ ] `progress-tracker.md` updated.
