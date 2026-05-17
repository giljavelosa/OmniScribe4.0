# OmniScribe — Code Standards

> The rules of the code. Follow them. Update this file in the same PR if your work establishes a new pattern.

## General

- **Keep modules single-purpose.** A file does one thing.
- **Fix root causes, not symptoms.** No retries-as-fix; no flaky-test bypass; no timeout-bump for a deadlock.
- **Match scope to task.** Bug fix = fix the bug. Refactors get their own units.
- **Three-lens evaluation, every feature** — Clinician / Medicare Compliance Officer / Insurance Auditor. If any lens fails, the feature isn't done.
- **Default to no comments.** Names carry meaning. Reserve comments for *why* — invariants, workarounds, non-obvious constraints. Never explain *what*.
- **Trust internal code.** Only validate at system boundaries (HTTP requests, external APIs, file uploads).

## TypeScript

- **Strict mode required.** `tsconfig.json` has `"strict": true`. Do not weaken.
- **No `any`.** Use `unknown` + narrow with type guards. Document any escape with a one-line comment.
- **Prefer interfaces for objects; types for unions and primitives.** Consistent within a file.
- **Validate `unknown` external input at boundaries** — Zod schemas at every API route, webhook handler, FHIR response parse, Stripe event parse.
- **Discriminated unions for state machines.** `Note.status`, `EpisodeStatus`, `FollowUpStatus`, `CaptureMode`. Client-side state machines mirror Prisma enums.
- **No `null` for "missing in-memory."** Use `undefined`. Prisma `null` for DB-level absence. Be explicit at the boundary.
- **Exhaustiveness over defaults.** `default` in a switch on a discriminated union should `throw assertNever(state)` — never fall through silently.

## Next.js (App Router)

- **Default to server components.** `'use client'` only for browser interactivity (state, effects, event handlers, browser APIs).
- **Thin `page.tsx`.** Composes server components, fetches data, renders. Logic lives in services or hooks.
- **`_components/` sibling folders for page-local components.** Don't promote until reused.
- **Route handlers stay focused** — one concern per handler. If a handler is "create + enqueue + notify," split the service call so the route only orchestrates.
- **Use `'use server'` actions sparingly.** v1 is mostly REST + SSE; server actions OK for simple admin form posts. Don't replace API routes for flows needing progress events or background work.

## API Routes

Every API route follows this shape:

```ts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // 1. Zod parse
  const body = SomeSchema.parse(await req.json());

  // 2. Auth + feature gate
  const { user, orgUser, error } = await requireFeatureAccess('NOTE_EDIT', req);
  if (error) return error;

  // 3. Ownership / PHI scoping
  const note = await prisma.note.findFirst({ where: { id: params.id, orgId: orgUser.orgId } });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // 4. Business logic (service call)
  const result = await someService.doThing(note, body, { actor: user });

  // 5. Audit log (NEVER swallow errors)
  await audit.write({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_EDITED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { /* PHI-free */ },
  });

  // 6. Consistent response
  return NextResponse.json({ data: result });
}
```

- **Response shape**: `{ data }` on success, `{ error: { code, message, details? } }` on failure. Status codes match (200/201/400/401/403/404/409/410/500).
- **Auth BEFORE any DB read of PHI.**
- **Ownership BEFORE any mutation.** Scope by `orgId` (or stricter).
- **No business logic in the route.** Route orchestrates; service does the work. Readable in 30 seconds.
- **Idempotency keys for unsafe POSTs.** Client-generated UUID in payload; server-side stable jobId.

## Prisma & Database

- **NEVER rename or drop a model without a migration.** Migrations are forever; assume there's prod data.
- **NEVER change `NoteStatus` enum values — only append.** Notes in flight reference these strings.
- **`Note.finalJson` is immutable after `Note.status === SIGNED`.** No code path writes it. Addenda are `NoteArtifact` records.
- **Audio files in S3 are never hard-deleted.** Soft-delete in DB only (`isDeleted` boolean + `deletedAt`).
- **Soft-delete is opt-in.** Models that support it have `isDeleted` + `deletedAt`. Audit logs + signed notes are never deleted at all.
- **Run `npx prisma db seed` after any migration.** Demo data is required for local dev to function.
- **Every PHI query has `orgId` in WHERE.** Use a repo helper if it's getting easy to forget.
- **Use transactions for multi-row mutations.** `prisma.$transaction([...])`.
- **No raw SQL unless necessary.** If so, parameterize. Never string-interpolate.

## Styling (Tailwind v4 + tokens)

- **Use design tokens only.** No hex / RGB / arbitrary OKLCH in clinical/admin surfaces.
- **No `text-[Npx]` in `(clinical)` or `(admin)`.** ESLint enforces.
- **Status colors via `<StatusBadge>` / `<StatusBanner>`.** Never `bg-red-500` / `text-emerald-600` directly.
- **Border radius via the scale.** `rounded-lg` / `rounded-xl` / `rounded-2xl`. No `rounded-[Npx]`.
- **Spacing — prefer the scale.** Tailwind defaults; rare `gap-[Npx]` allowed only with a comment.
- **Dark mode is not optional.** Every component must look correct in `.dark`. Test before merging.

## LLM (sole ingress)

- **All AI calls go through `src/services/llm/`.** No direct `@aws-sdk/client-bedrock-runtime` imports outside that folder.
- **PHI guard at the entry point.** `getLLMService().generate(system, user, { phi: true })` calls `assertProviderAllowedForPHI` which throws unless provider is in the allowlist (`bedrock`, `vllm`).
- **Prompt templates live in `src/lib/note-*-prompt.ts` / `src/services/brief/`.** Don't inline prompts in routes or components. New feature → new template module.
- **Temperature 0 for clinical generation.** Variance is a bug, not a feature.
- **Log inference metadata to `Note.inferenceLog`.** Model, region, latency, retry count, tokens. PHI-free.
- **Fallback**: Sonnet 4.5 → Haiku 4.5 on second failure. No silent fallback to non-PHI provider.

## Transcription (sole ingress)

- **All transcription goes through `src/services/transcription/`.** No direct Soniox SDK imports.
- **Long-lived Soniox key never reaches the browser.** Always mint an ephemeral 60-second key via `/api/notes/[id]/realtime-key`.
- **Ephemeral key is single-use + STT-WS-only scoped.**
- **Real-time config must keep `enable_speaker_diarization: true` and `audio_format: "pcm_s16le"`.** Worklet emits Int16.
- **Audio uploads always carry `noteId` + `orgId`.** Server validates both before writing to S3.

## BullMQ & Workers

- **Three retries, exponential backoff (5s/10s/20s).** Set in queue defaults.
- **One Redis fleet per environment.** Never run two BullMQ worker fleets concurrently against the same Redis.
- **Stable jobId for idempotency.** `note-brief:{noteId}`, `regenerate-section:{noteId}:{sectionId}:{requestId}`.
- **Worker handlers are async; transactional updates.** Update `Note.status` and `Note.inferenceLog` in the same transaction.
- **`removeOnComplete: { count: 100 }`, `removeOnFail: { count: 1000 }`.**
- **After Redis recovery, force fresh ECS deployment.** Workers in retry backoff stay stuck.

## Audit Logging

- **Audit writes NEVER wrapped in try-catch that swallows errors.** If audit fails, the request fails. Compliance > convenience.
- **PHI-free metadata.** Never put patient name / DOB / MRN / note content / transcript text in `AuditLog.metadata`. Use IDs (scoped).
- **Reconstructable state on important mutations.** Sign, transfer, sensitive-tier change, BAA acceptance — capture enough metadata to reconstruct.
- **Every PHI access logged.** Every read of patient or note data, every export, every print.

## Authentication & MFA

- **Every API route gates with `requireFeatureAccess`.** No exceptions. Even GETs.
- **MFA re-verification for sensitive actions.** Sign, payment changes, MFA reset, BAA acceptance.
- **Password hashes via `bcryptjs`.** Never plaintext. Never log passwords or tokens.
- **NextAuth session is JWT, stateless.** No session table.
- **Invite tokens expire** — verify in code, not just DB constraint. Return 410 Gone for expired.

## Testing

- **3-tap UX rule on clinical screens.** Manually verify a clinician can complete any common task in ≤ 3 taps.
- **Integration tests touch a real database.** Not mocks. The team has been burned (in other projects) by mock/prod divergence.
- **Unit tests use `happy-dom`** via `@happy-dom/global-registrator`.
- **Vitest runner; `@testing-library/react` + `@testing-library/user-event`** for component tests.
- **Test the contract, not the implementation.** Tests survive refactoring. If renaming a private function breaks a test, the test is over-coupled.
- **Snapshot tests are last resort.** They rot. Prefer explicit assertions.
- **For LLM-dependent code, mock the LLM client with deterministic fixtures.** Don't call Bedrock from a unit test.

## File Organization

| Folder | What goes here |
|---|---|
| `src/app/(group)/route/page.tsx` | Route component; thin; composes server components |
| `src/app/(group)/route/_components/` | Page-local components |
| `src/app/api/path/route.ts` | HTTP handlers; parse → auth → service → respond |
| `src/components/` | Domain-specific reusable components |
| `src/components/ui/` | shadcn / Base UI primitives (do not modify; extend with CVA) |
| `src/services/transcription/` | Soniox dispatch |
| `src/services/llm/` | LLM dispatch + PHI guard |
| `src/services/voice-id/` | TitaNet matching |
| `src/services/brief/` | Brief generator + follow-up extractor |
| `src/services/copilot/` | Copilot tool registry + agent loop (Wave 5) |
| `src/services/fhir/` | FHIR cache + sync (Wave 4) |
| `src/lib/authz/` | Feature gates, role resolvers |
| `src/lib/audit/` | Audit log writer |
| `src/lib/note-*-prompt.ts` | Division master prompts |
| `src/lib/queue.ts` | BullMQ enqueue helpers |
| `src/lib/s3/` | S3 client + presigned URLs |
| `src/workers/` | BullMQ workers (entry: `index.ts`) |
| `prisma/` | Schema, migrations, seed |
| `infra/` | AWS CDK stacks |
| `scripts/` | Build / test / maintenance scripts |

## Commit & PR Hygiene

- **One concern per PR.** Auth + capture + telehealth in one PR is too big.
- **Reference unit ID in commit subject.** `feat(unit-03): capture recording controls`.
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- **NEVER `--no-verify` or `--no-gpg-sign` without explicit user ask.** Hooks exist for a reason.
- **Update relevant context file in the same PR** if change touches architecture, scope, or invariants.
- **PR description includes**: what (1 line), why (1–3 lines), how to verify (steps), three-lens evaluation notes (Clinician / Compliance / Auditor — even one sentence each).

## Branch & Worktree

- **Worktrees in `.claude/worktrees/`** (optional convention).
- **Branch names**: `feat/unit-NN-<slug>`, `fix/<slug>`, `chore/<slug>`.
- **Never force-push to `main`.** Main is protected.
- **Squash-merge to main** so unit history stays clean.

## Things that look fine but break the system

- **Provider env vars** — `AWS_BEARER_TOKEN_BEDROCK` is NOT `AWS_ACCESS_KEY_ID`. Putting it in the wrong env var causes Bedrock to reject with `UnrecognizedClientException`.
- **Bedrock model IDs without `us.` prefix** — Sonnet 4.5 + Haiku 4.5 require the cross-region inference profile prefix. Without it, "model not found."
- **Long-lived Soniox key in the browser** — exposes the org-wide key. Always mint ephemeral.
- **A second BullMQ worker fleet against the same Redis** — quota doubles; production goes red.
- **Editing applied migrations** — write a new one instead.
- **Two `npm run dev:workers` processes on the same Redis** — same problem as the production case, locally.

## Compliance Lenses (every feature)

Apply all three before merging:

**Clinician lens** — Would a licensed provider document this way?
- Clinically natural language (not "AI-flavored")?
- Surface supports clinical reasoning, not replaces it?
- Workflow matches how clinicians actually work?
- Clinician in control of every clinical decision?

**Medicare Compliance Officer lens** — Would this establish medical necessity + skilled care and survive a MAC audit?
- Objective measures captured?
- Skilled intervention distinguishable from unskilled?
- CPT codes (if any) justified?
- Time captured if time-based?
- Signature + attestation + date-of-service present?

**Insurance Auditor lens** — Is there provenance? Could an auditor reconstruct the visit?
- Who wrote what, when, from what source?
- AI-generated vs clinician-edited segments traceable?
- Audit log complete?
- Referrals / follow-ups / orders traceable?

If any lens fails, the feature is not done. Document the evaluation in the PR description.
