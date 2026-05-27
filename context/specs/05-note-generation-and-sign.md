# Unit 05: Note Generation & Sign

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


## Goal

Build the LLM abstraction (sole AI ingress + PHI guard), the division-aware master prompts (medical/BH/rehab), the section-by-section ai-generation worker with per-section progress, the review UI with inline editing + section regenerate, the `/processing` reassurance screen, and the sign workflow that freezes `finalJson` (immutable forever after) and enqueues post-sign artifacts + next-visit brief precompute. After this unit, OmniScribe is technically a working medical AI scribe.

## Design

UI surfaces:
- **`/processing/[noteId]`** — transient screen with `<ProcessingIndicator>` (3-gear spinner) + escalating empathy copy
- **`/review/[noteId]`** — section accordions with inline TipTap editor, `<SectionProgressStrip>`, regenerate buttons, readiness panel, follow-up sweep area (full sweep in Unit 06)
- **`/sign/[noteId]`** — read-only final preview, attestation, MFA re-verify modal, sign-time follow-up sweep modal (Unit 06)

References: [`journeys/02-typical-visit.md`](../../journeys/02-typical-visit.md) Steps 4–5, [`journeys/04-section-regenerate.md`](../../journeys/04-section-regenerate.md), [`references/section-progress-spec.md`](../../references/section-progress-spec.md), [`references/section-progress-ui-spec.md`](../../references/section-progress-ui-spec.md).

## Implementation

### A. LLM abstraction (`src/services/llm/`)

`src/services/llm/types.ts`:

```ts
export type Provider = 'bedrock' | 'vllm' | 'openai' | 'openrouter' | 'anthropic-direct';

export interface GenerateOptions {
  phi: boolean;
  temperature?: number;     // default 0
  maxTokens?: number;
  model?: 'sonnet' | 'haiku';
  jsonMode?: boolean;
  requestId?: string;
}

export interface GenerateResult {
  text: string;
  model: string;
  region?: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface LLMService {
  generate(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  generateStream(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): AsyncIterable<{ delta: string; done?: boolean }>;
}
```

`src/services/llm/phi-guard.ts`:

```ts
const PHI_ALLOWED_PROVIDERS: Provider[] = ['bedrock', 'vllm'];

export function assertProviderAllowedForPHI(provider: Provider): void {
  if (!PHI_ALLOWED_PROVIDERS.includes(provider)) {
    throw new Error(`Provider ${provider} is not in the PHI allowlist. Use bedrock or vllm.`);
  }
}
```

`src/services/llm/index.ts`:

```ts
import { BedrockService } from './bedrock';
import { VllmService } from './vllm';
import { OpenAiService } from './openai'; // dev only
import { assertProviderAllowedForPHI } from './phi-guard';

let cached: LLMService | null = null;

export function getLLMService(): LLMService {
  if (cached) return cached;
  const provider = process.env.LLM_PROVIDER as Provider || 'bedrock';
  switch (provider) {
    case 'bedrock': cached = new BedrockService(); break;
    case 'vllm': cached = new VllmService(); break;
    case 'openai': cached = new OpenAiService(); break;
    default: throw new Error(`Unknown provider: ${provider}`);
  }
  // Wrap to enforce PHI guard
  const inner = cached;
  return {
    async generate(sys, user, opts) {
      if (opts?.phi) assertProviderAllowedForPHI(provider);
      return inner.generate(sys, user, opts);
    },
    async *generateStream(sys, user, opts) {
      if (opts?.phi) assertProviderAllowedForPHI(provider);
      yield* inner.generateStream(sys, user, opts);
    },
  };
}
```

### B. Bedrock provider

`src/services/llm/bedrock.ts`:

```ts
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

export class BedrockService implements LLMService {
  private client = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    // AWS_BEARER_TOKEN_BEDROCK is auto-detected by SDK from env
  });
  
  async generate(systemPrompt: string, userPrompt: string, opts: GenerateOptions = { phi: false }): Promise<GenerateResult> {
    const modelId = opts.model === 'haiku'
      ? process.env.BEDROCK_FAST_MODEL_ID!
      : process.env.BEDROCK_MODEL_ID!;
    // Both must include `us.` cross-region prefix
    
    const start = Date.now();
    const cmd = new InvokeModelCommand({
      modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: opts.maxTokens || 4096,
        temperature: opts.temperature ?? 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const resp = await this.client.send(cmd);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body));
    return {
      text: parsed.content[0].text,
      model: modelId,
      region: process.env.BEDROCK_REGION,
      latencyMs: Date.now() - start,
      tokensIn: parsed.usage.input_tokens,
      tokensOut: parsed.usage.output_tokens,
    };
  }
  
  async *generateStream(systemPrompt: string, userPrompt: string, opts: GenerateOptions = { phi: false }) {
    // Similar but with InvokeModelWithResponseStreamCommand
  }
}
```

Env vars (per `architecture.md`):
- `BEDROCK_REGION=us-east-1`
- `BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-...` (`us.` prefix required)
- `BEDROCK_FAST_MODEL_ID=us.anthropic.claude-haiku-4-5-...`
- `AWS_BEARER_TOKEN_BEDROCK=ABSK…` (NOT `AWS_ACCESS_KEY_ID`)

### C. Division-aware master prompts

`src/lib/note-medical-prompt.ts`, `note-behavioral-health-prompt.ts`, `note-rehab-master-prompt.ts` — each exports `buildMasterPrompt(input: BuildPromptInput): { system, user }`.

Each prompt module:
- Composes a system prompt with division-appropriate clinical voice, output schema (matches template's `sectionSchema`), Rule 20 + Rule 23 reminders
- Composes a user message with patient one-liner (PHI-aware projection), prior context summary (from Unit 06's brief if available), episode context, full transcript, template hints
- Returns the pair for `getLLMService().generate(...)`

Temperature 0 across all prompts. JSON mode for structured output.

### D. Note model additions

```prisma
model Note {
  // ... fields from Unit 03 ...
  draftJson       Json?
  finalJson       Json?     // IMMUTABLE after status === SIGNED
  inferenceLog    Json?     // tracks _sectionStatus, regenerations, model metadata
  
  templateId      String?
  template        NoteTemplate? @relation(fields: [templateId], references: [id])
  templateVersion Int?
  noteStyle       NoteStyle @default(HYBRID)
  division        Division
  sensitivityLevel NoteSensitivityLevel @default(STANDARD_CLINICAL)
  
  signedAt        DateTime?
  signedByUserId  String?
  
  backfilledAt    DateTime?
  backfillReason  String?
  
  artifacts       NoteArtifact[]
  
  @@index([orgId, status])
  @@index([patientId, status])
}

model NoteTemplate {
  id              String   @id @default(cuid())
  orgId           String?
  organization    Organization? @relation(fields: [orgId], references: [id])
  name            String
  description     String?
  division        Division
  specialty       String?
  visibility      String   // 'PERSONAL' | 'TEAM' | 'PUBLIC'
  isPreset        Boolean  @default(false)
  sectionSchema   Json
  promptHints     Json?
  sensitivityDefault NoteSensitivityLevel @default(STANDARD_CLINICAL)
  version         Int      @default(1)
  createdByOrgUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  notes           Note[]
}

model NoteArtifact {
  id              String   @id @default(cuid())
  noteId          String
  note            Note     @relation(fields: [noteId], references: [id])
  kind            NoteArtifactKind
  content         Json
  generatedAt     DateTime @default(now())
}

enum NoteArtifactKind {
  REFERRAL_LETTER
  PATIENT_INSTRUCTIONS
}
```

### E. ai-generation worker (`src/workers/ai-generation.worker.ts`)

Handles both `generate-note` and `regenerate-section` job types:

```ts
export const aiGenerationHandler = async (job: Job<AiGenerationJobPayload>) => {
  const { noteId, type } = job.data;
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { template: true, patient: true, encounter: { include: { episode: true } } },
  });
  if (!note) return;
  
  const llm = getLLMService();
  const prompt = buildMasterPrompt({
    division: note.division,
    transcriptClean: note.transcriptClean,
    template: note.template,
    noteStyle: note.noteStyle,
    patient: projectPatientForPrompt(note.patient),
    episode: note.encounter.episode ? projectEpisodeForPrompt(note.encounter.episode) : undefined,
    priorContext: await loadPriorContextBrief(note.patientId, note.encounter.episodeOfCareId), // Unit 06
  });
  
  if (type === 'generate-note') {
    // Stream all sections
    for (const section of note.template.sectionSchema.sections) {
      await markSectionStatus(noteId, section.id, 'generating');
      try {
        const sectionResult = await llm.generate(prompt.system, buildSectionPrompt(prompt.user, section), { phi: true, temperature: 0, jsonMode: true });
        await mergeSectionIntoNote(noteId, section.id, sectionResult.text);
        await markSectionStatus(noteId, section.id, 'populated', { lastGeneratedAt: new Date() });
      } catch (err) {
        await markSectionStatus(noteId, section.id, 'failed', { error: { code: 'GENERATION_FAILED', message: err.message } });
        if (job.attemptsMade >= 1) {
          // Fallback to Haiku on second attempt
          // ...
        }
      }
    }
    await prisma.note.update({ where: { id: noteId }, data: { status: 'DRAFT' } });
  } else if (type === 'regenerate-section') {
    const { sectionId, requestId } = job.data;
    await markSectionStatus(noteId, sectionId, 'generating');
    const section = note.template.sectionSchema.sections.find(s => s.id === sectionId);
    const sectionResult = await llm.generate(prompt.system, buildSectionPrompt(prompt.user, section), { phi: true, temperature: 0, jsonMode: true });
    await replaceSectionAtomically(noteId, sectionId, sectionResult.text); // Atomic JSON merge
    await markSectionStatus(noteId, sectionId, 'populated', { lastGeneratedAt: new Date() });
    await appendInferenceLogRegeneration(noteId, { sectionId, requestId, triggeredByUserId: job.data.triggeredByUserId, at: new Date(), overwroteEdited: job.data.overwroteEdited });
  }
  
  await writeAuditLog({
    orgId: job.data.orgId,
    action: type === 'generate-note' ? 'NOTE_GENERATION_COMPLETED' : 'SECTION_REGENERATED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { /* model, latency, tokens, retryCount; PHI-free */ },
  });
};
```

JobIds:
- `ai-generation:{noteId}:generate-note:{requestId}` — stable, idempotent
- `regenerate-section:{noteId}:{sectionId}:{requestId}` — stable, idempotent (double-tap deduped)

### F. Section status JSON

`Note.inferenceLog._sectionStatus`:

```ts
{
  [sectionId: string]: {
    status: 'empty' | 'generating' | 'populated' | 'edited' | 'failed';
    progressPercent?: number;
    generationStartedAt?: string;
    lastGeneratedAt?: string;
    error?: { code: string; message: string };
  }
}
```

Plus `_regenerations: [{ sectionId, requestId, triggeredByUserId, at, overwroteEdited }]`.

Derived to UI via `src/lib/notes/derive-progress-strip.ts`.

### G. Review screen

`/review/[noteId]/page.tsx`:
- Server component loads `Note + Patient + Template + Episode + FollowUp[]` (open from prior visit, populated in Unit 06)
- Renders accordion per template section, each with `<SectionAccordion>`
- `<SectionAccordion>` has: status glyph header, expand/collapse, TipTap editor for content, regenerate button
- Right side (desktop) / collapsible (mobile): `<ReadinessPanel>` — required-section completeness, AI compliance flags, open follow-ups count
- Section edit auto-saves debounced 1s → `PATCH /api/notes/[id]/sections/[sectionId]` → sets `_sectionStatus[sectionId].status = 'edited'`
- Regenerate button: tap → if `_sectionStatus[sectionId].status === 'edited'`, open `<SectionRegenerateConfirmDialog>`; otherwise fire immediately → POST `/api/notes/[id]/regenerate-section` with `requestId`

### H. Sign screen + transaction

`/sign/[noteId]/page.tsx`:
- Compute `signReadiness`: required sections populated + no blocking flags + open-follow-ups sweep completed
- If not ready → redirect to `/review` with warning
- Show human-readable preview (compose sections via `composeFinalView(draftJson, template)`)
- Show open-follow-up sweep modal (Unit 06) if any prior-visit FollowUps still `OPEN`
- Show MFA challenge if `org.forceMfa || lastMfaVerifiedAt > 1h`
- On "Sign Note":

```ts
await prisma.$transaction(async (tx) => {
  // 1. Re-verify MFA (if challenged)
  // 2. Set Note.status = SIGNED, freeze finalJson
  await tx.note.update({
    where: { id: noteId },
    data: {
      status: 'SIGNED',
      finalJson: canonicalize(note.draftJson),
      signedAt: new Date(),
      signedByUserId: user.id,
    },
  });
  // 3. Close swept follow-ups
  for (const sweep of follow_up_sweeps) {
    await tx.followUp.update({
      where: { id: sweep.followUpId },
      data: { status: sweep.status, closedAt: new Date(), closingNoteId: noteId },
    });
  }
});

// 4. Enqueue note-brief job (precompute next visit's brief; Unit 06)
await enqueueNoteBriefJob({ noteId });

// 5. Enqueue post-sign artifacts
await enqueuePostSignArtifactsJob({ noteId, kinds: ['PATIENT_INSTRUCTIONS', ...(hasReferral(draftJson) ? ['REFERRAL_LETTER'] : [])] });

// 6. Audit
await writeAuditLog({
  userId: user.id,
  orgId: orgUser.orgId,
  action: 'NOTE_SIGNED',
  resourceType: 'Note',
  resourceId: noteId,
  metadata: { mfaReverified: true, /* PHI-free */ },
});
```

### I. `finalJson` immutability enforcement

**The sign route is the ONLY code path that writes `Note.finalJson`.**

All other write paths (PATCH section, regenerate-section worker) must guard:

```ts
if (note.status === 'SIGNED') throw new Error('Cannot modify signed note');
```

Static check (CI): grep that confirms `finalJson:` assignments only in the sign route handler.

### J. Post-sign artifacts worker

`src/workers/post-sign-artifacts.worker.ts` — calls LLM (separate calls per artifact kind, temp 0, PHI-allowed), writes `NoteArtifact` rows. Does NOT touch `finalJson`.

### K. `/processing` page

Transient screen. Subscribes to SSE `/api/notes/[id]/stream?include=status`. Renders `<ProcessingIndicator>` + escalating empathy copy based on `elapsed` time. Auto-routes to `/review` on note exiting `DRAFTING`.

## Dependencies

- `@aws-sdk/client-bedrock-runtime@3.x`
- `@tiptap/react@3.x`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder`
- All BullMQ + Prisma + Zod from earlier units

## Verify when done

- [ ] `getLLMService()` is the only path to LLM calls (grep verifies no direct `bedrock-runtime` / `openai` imports outside `src/services/llm/`).
- [ ] `assertProviderAllowedForPHI` throws for openai/openrouter when `phi: true`.
- [ ] Bedrock model IDs include `us.` cross-region prefix.
- [ ] `AWS_BEARER_TOKEN_BEDROCK` is the only env var holding the Bedrock key.
- [ ] Full happy path: cleaned transcript → ai-generation worker → sections stream via SSE → review UI renders progress → clinician edits one section → regenerates another (preserving the edit) → sign → `finalJson` frozen → post-sign artifacts generated → next visit's brief precompute enqueued.
- [ ] Section status transitions: `empty → generating → populated`, `populated → edited` on clinician edit, `populated → failed` on worker exception.
- [ ] Sign re-verifies MFA when `org.forceMfa || lastVerified > 1h`.
- [ ] `Note.finalJson` writes appear ONLY in the sign route (grep verified); attempts to write `draftJson` after sign throw.
- [ ] `Note.inferenceLog` captures model, region, tokens, latency, retry count — PHI-free.
- [ ] Audit log entries for every generation, every regenerate, every sign, every artifact generation.
- [ ] Section regenerate uses `ai-generation` queue (NOT a new queue) with `type: 'regenerate-section'` discriminator (rule 18).
- [ ] Atomic JSON merge for section replacement (other sections untouched; regression test).
- [ ] Three-lens evaluation: Clinician (review respects edits; sign is intentional with re-MFA), Compliance (sign attested + auditable; finalJson immutable; division-appropriate prompts), Auditor (full reconstructability via inferenceLog + transcriptRaw + audit log).
- [ ] `progress-tracker.md` updated.
