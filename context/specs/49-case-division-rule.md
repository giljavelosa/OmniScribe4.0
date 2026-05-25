# Unit 49: Case-Division Rule — Division-Gated Cases + Cleo as Biller

> **Wave 1 follow-on / Unit 06 + Unit 48 extension.** Not Wave 8 (Miss Cleo persona work) — the rule itself ships unflagged; only the new Cleo UX surfaces sit behind a single feature flag. The polish gate ahead of Wave 7/8 does not apply.

## Goal

Pin every `CaseManagement` to a single division at birth, enforce that only same-division clinicians can attach a visit (audio + transcript + signed note) to that case, and turn Miss Cleo into a three-moment guide-then-biller: she nominates the right case **pre-visit**, sanity-checks intent vs. case **pre-sign**, and audits narrative ↔ ICD ↔ profession **post-sign**.

Today, a case carries one or two ICD codes but no division. So a PT (REHAB) can accept a case opened by a primary-care doc (MEDICAL), and nothing in the API or UI stops them. Follow-ups have the same hole — the brief query at [note-brief/handler.ts:260](../../src/workers/note-brief/handler.ts:260) returns all of a patient's open follow-ups regardless of viewer division, so any clinician can `MET / DROPPED / CARRIED` another division's clinical decisions.

The rule (immutable):

> Cases are defined by **ICD codes AND division.** Only clinicians whose profession maps to the case's division (or whose division is `MULTI`) may record audio, attach transcripts, or sign notes against that case. Follow-ups inherit the division of their origin note and are triage-gated the same way.

This unit:

1. Adds a `division` column to `CaseManagement` (and `FollowUp`), backfilled and enforced.
2. Routes case-router proposals through a division gate — shared ICDs across divisions produce **parallel same-division cases**, never cross-division attaches.
3. Wires Miss Cleo into three moments — nominator (pre-visit), intent-fit nudge (pre-sign), biller advisory (post-sign) — without ever blocking the clinician.
4. Ships the rule unflagged (column + filters + 403s) and the new UX surfaces behind `cleo.caseRule.v1` so the gate-tightening is risk-isolated from the persona surfaces.

> **Unit 49 ships when** a PT cannot attach a visit to a MEDICAL case (403 + audit), the start-visit dialog highlights one Cleo-nominated case for the visit, the review screen shows a nudge when intent ≠ case ICD, and the post-sign biller advisory card appears on the case-routing panel when Cleo finds a narrative/ICD/profession mismatch.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Division stamp is **set at case creation, immutable afterward** | Set from `openedByOrgUserId.division` on insert. No update path exposed. Mirrors `Note.division` discipline. |
| 2 | Division enforcement uses a **single helper** | New `assertCanContinueCase(case, clinician)` in `src/lib/case-access.ts`. Throws 403 on mismatch; `MULTI` passes. Wired into accept, edit, continue routes. |
| 3 | Off-division cases are **silently filtered**, not badged (Base option 1) | Cases panel, case picker, home dashboard add `WHERE division IN (viewerDivision, 'MULTI')`. Short, focused pickers. Visibility into other divisions deferred — `MULTI` is the escape hatch. |
| 4 | Shared ICDs across divisions yield **parallel cases per division** (Overlap option A) | F41.1 in BH and F41.1 in MEDICAL are two distinct cases. The router scans candidates scoped to the clinician's division first; if none, proposes `open-new` (never proposes cross-division attach). |
| 5 | `FollowUp` gains a **division stamp** inherited from the origin note | The rule extends naturally: a clinician triages only their own division's follow-ups. The worker brief query and the triage endpoint both filter by viewer division. |
| 6 | Carry-over **does not migrate** episode or case | `CARRIED` follow-ups stay attached to their origin episode and case. If a different-division clinician opens the patient next visit, the carried follow-up is **hidden, not re-triaged**. |
| 7 | Miss Cleo **never blocks** at the moment of decision | Pre-visit nominator is a badge; pre-sign nudge is a one-line chip; post-sign advisory is a card with proposed actions. The clinician retains authority at every step. |
| 8 | Pre-sign Cleo is **rule-20 safe** | She compares `Encounter.intentMeta` (structured) vs. `CaseManagement.primaryIcd` (structured). She never reads the draft narrative. |
| 9 | Post-sign Cleo writes a **biller advisory** to `Note.billerAdvisoryJson` | Single JSON column on `Note` (additive, nullable). Never modifies `Note.finalJson` (rule 3 holds). Advisory proposes one of `ADDENDUM`, `OPEN_NEW_NEXT_VISIT`, `MARK_CLEARED`. |
| 10 | Cross-division re-route is **not** an action Cleo can take | If the biller verdict is "narrative supports a different division's ICD," Cleo's recommendation stops at "next time, route at intake to that division — your profession cannot bill this narrative as written." |
| 11 | Single feature flag `cleo.caseRule.v1` gates **UX only** | The rule itself — column, filters, 403s, follow-up gate — ships unflagged. The flag toggles the pre-visit nominator badge, the pre-sign intent-fit chip, and the post-sign biller advisory card. The rule lands dark before the UX surfaces light up. |
| 12 | Three-PR sequencing, each independently verifiable | PR1: base + parallel cases + nominator + nudge (~3% regression). PR2: follow-up division gate (~2% regression). PR3: biller advisory + optional snapshot polish (~3% regression). PR2 lands before PR3. |
| 13 | Three-lens applies | Clinician (Cleo whispers, never blocks), Compliance (audit-logged 403s + biller advisory chain), Auditor (every case + follow-up traceable to a division; advisory `JSON` is a reconstructable AI-reasoning record). |
| 14 | New invariants added to `context/architecture.md` | "CaseManagement carries a division stamp set at creation; only same-division (or MULTI) clinicians may write to a case." + "FollowUp inherits division from its origin note; brief queries and triage filter by viewer division." |

## Design

### The flow (three moments)

```
PRE-VISIT
  Clinician taps a patient → start-visit dialog opens
        │
        ▼
  Cleo case-nominator runs (GET /api/copilot/case-suggestions)
        │
        ▼
  Dialog renders cases scoped to clinician's division;
  ONE case wears a "Cleo: best match" badge with a why-tooltip:
     "Recent intent (back pain) + REHAB division + active 4d ago"
        │
        ▼
  Clinician confirms (badge default) OR picks another listed case
  OR taps "Open new case for today's visit"
        │
        ▼
  Encounter created, intent stamped (Unit 48), case bound

VISIT happens, transcription + draft generation runs (unchanged)

PRE-SIGN
  Clinician reviews on /review/[noteId]
        │
        ▼
  IntentCaseFit chip renders above the sign button:
     GREEN  "Intent + case align"
     YELLOW "Intent was back pain; case is F32.0 (Depression). Continue?"
        │
        ▼
  Yellow chip offers one-click swap to a same-division alternative
  (uses the Cleo nominator's ranked list).
  Clinician dismisses OR swaps OR signs as-is.

SIGN → finalJson freeze (unchanged)

POST-SIGN
  post-sign-artifacts worker fires (existing pipeline)
        │
        ▼
  biller-advisor runs (new step):
    inputs:  signed finalJson + case.primaryIcd + clinician.profession
    outputs: { verdict, findings[], suggestedActions[] }
  written to Note.billerAdvisoryJson
        │
        ▼
  If verdict !== 'OK':
    case-routing-panel renders <BillerAdvisoryCard>
    cases-panel on patient chart renders <BillerAdvisoryPip>
        │
        ▼
  Clinician picks one:
    ADDENDUM           → new note opens (signed note unchanged)
    OPEN_NEW_NEXT_VISIT → hint staged for next start-visit dialog
                          (the nominator surfaces it)
    MARK_CLEARED       → resolved + audit-logged with reason
```

### What stays the same

- `Note.finalJson` immutability (rule 3).
- `NoteStatus` enum (rule 2 — append only; this unit appends nothing).
- All existing brief, transcription, sign, and post-sign artifact pathways.
- The Cleo persona surface (Wave 8 Unit 42) — this unit consumes it, doesn't redefine it.
- Snapshot strip's viewer-driven shape (memory: `snapshot-viewer-lens`). Optional polish in PR3 adds a viewer-division filter on source notes; not a redesign.
- Follow-up extractor (it reads narrative; this unit doesn't change extraction logic, only where the rows land and who can see them).

### What's net-new

| Surface | What | PR |
|---|---|---|
| Prisma | `CaseManagement.division Division` (NOT NULL after backfill) | PR1 |
| Prisma | `FollowUp.division Division` (NOT NULL after backfill) | PR2 |
| Prisma | `Note.billerAdvisoryJson Json?` (nullable) | PR3 |
| Prisma | `IcdProfessionEligibility` seed table for biller verdicts | PR3 |
| Lib | `src/lib/case-access.ts` — `assertCanContinueCase` helper | PR1 |
| Service | `src/services/copilot/case-nominator.ts` — pre-visit ranking | PR1 |
| Service | `src/services/copilot/intent-case-fit.ts` — pre-sign comparison (rule-20 safe) | PR1 |
| Service | `src/services/copilot/biller-advisor.ts` — post-sign LLM audit | PR3 |
| API | `GET /api/copilot/case-suggestions` | PR1 |
| API | `POST /api/notes/[id]/biller-advisory/resolve` | PR3 |
| UI | `<CaseSuggestionBadge>` on start-visit dialog + cases panel | PR1 |
| UI | `<IntentCaseFitChip>` above sign button on review screen | PR1 |
| UI | `<BillerAdvisoryCard>` in case-routing-panel | PR3 |
| UI | `<BillerAdvisoryPip>` on cases-panel | PR3 |
| Worker | New `runBillerAdvisor` step in `post-sign-artifacts` | PR3 |
| Worker | Division filter on follow-up brief query | PR2 |
| Routes | `assertCanContinueCase` wired into accept/edit/continue endpoints | PR1 |
| Routes | Division guard on follow-up triage endpoint | PR2 |
| Feature flag | `cleo.caseRule.v1` gates UX surfaces only | PR1+PR3 |

## Implementation

### PR1 — Case division stamp + parallel cases + Cleo nominator + intent-fit chip

**Goal.** Cases get a division stamp at birth. Only same-division clinicians can write. Router proposes open-new (not cross-division attach) on shared ICDs. Cleo nominates pre-visit and nudges pre-sign.

**§A — Schema migration** (`prisma/migrations/<ts>_unit_49_case_division/`)

```sql
-- Step 1: add nullable
ALTER TABLE "CaseManagement" ADD COLUMN "division" "Division";

-- Step 2: backfill from opener (or department, or MULTI)
UPDATE "CaseManagement" c
SET    "division" = COALESCE(
         (SELECT u."division" FROM "OrgUser" u WHERE u."id" = c."openedByOrgUserId"),
         (SELECT d."division" FROM "Encounter" e
            JOIN "Department" d ON d."id" = e."departmentId"
           WHERE e."caseManagementId" = c."id"
           ORDER BY e."createdAt" ASC LIMIT 1),
         'MULTI'::"Division"
       );

-- Step 3: enforce NOT NULL
ALTER TABLE "CaseManagement" ALTER COLUMN "division" SET NOT NULL;

-- Step 4: index for the filter
CREATE INDEX "CaseManagement_orgId_patientId_division_status_idx"
  ON "CaseManagement" ("orgId", "patientId", "division", "status");
```

After running: `npx prisma db seed` (rule 4) and a manual `SELECT COUNT(*) WHERE division IS NULL` should return 0.

**§B — Access helper** (`src/lib/case-access.ts`)

```ts
import type { CaseManagement, OrgUser } from '@prisma/client';
export class CaseDivisionDeniedError extends Error {
  constructor(public readonly caseId: string, public readonly caseDivision: string, public readonly clinicianDivision: string) {
    super(`Clinician division ${clinicianDivision} cannot continue case ${caseId} (division ${caseDivision})`);
  }
}
export function assertCanContinueCase(
  c: Pick<CaseManagement, 'id' | 'division'>,
  clinician: Pick<OrgUser, 'division'>,
): void {
  if (c.division === 'MULTI') return;
  if (clinician.division === c.division) return;
  throw new CaseDivisionDeniedError(c.id, c.division, clinician.division);
}
```

API routes catch `CaseDivisionDeniedError` → 403 + `CASE_DIVISION_BLOCKED` audit row (orgId, clinicianOrgUserId, caseId, clinicianDivision, caseDivision).

**§C — Wire-in points**

- [src/app/api/notes/[id]/case-router/accept/route.ts:155](../../src/app/api/notes/[id]/case-router/accept/route.ts) — after auth check, before any write: `assertCanContinueCase(targetCase, clinician)`.
- [src/app/api/notes/[id]/case-router/accept/route.ts:241](../../src/app/api/notes/[id]/case-router/accept/route.ts) — set `division: clinician.division` on `CaseManagement.create`.
- [src/app/api/encounters/route.ts](../../src/app/api/encounters/route.ts) — set `division` on `PENDING_ROUTER` case creation.
- Edit-case route + continue-case routes — same helper.

**§D — Router scope** ([src/services/copilot/case-router.ts](../../src/services/copilot/case-router.ts))

`propose()` candidate scan: `where: { patientId, orgId, status: 'ACTIVE', OR: [{ division: clinician.division }, { division: 'MULTI' }] }`. If no same-division match → propose `open-new` (in clinician's division). Never propose cross-division `attach`.

**§E — Query filters** (silent, Base option 1)

- [src/app/(clinical)/review/[noteId]/page.tsx:153](../../src/app/(clinical)/review/[noteId]/page.tsx) — case picker query gets `division IN (viewerDivision, 'MULTI')`.
- [src/app/(clinical)/patients/[id]/page.tsx:80](../../src/app/(clinical)/patients/[id]/page.tsx) — cases panel query, same filter.
- [src/app/(clinical)/home/page.tsx](../../src/app/(clinical)/home/page.tsx) — recent cases, same filter.

**§F — Cleo case nominator** (Option I)

- New `src/services/copilot/case-nominator.ts` — pure ranker:
  - Inputs: `{ patientId, clinicianOrgUserId, intent? }`
  - Loads: clinician's division-scoped active cases for patient.
  - Scoring: `(intent ICD overlap × 3) + (recency in days⁻¹) + (recent activity in clinician's division × 2)`.
  - Output: `{ candidates: [{ caseId, score, reason }] }` sorted desc.
- New API `GET /api/copilot/case-suggestions?patientId=&intent=&clinicianOrgUserId=`.
- FE: start-visit dialog (find current implementation path; likely under `src/components/start-visit-dialog.tsx`) gains `<CaseSuggestionBadge>` on the top-scored case. Tooltip surfaces `reason`. Behind `cleo.caseRule.v1` flag.

**§G — Pre-sign intent-fit chip** (Option II)

- New `src/services/copilot/intent-case-fit.ts` — pure comparison:
  - Inputs: `Encounter.intentMeta`, `CaseManagement.primaryIcd`.
  - Output: `{ score: 'HIGH'|'MEDIUM'|'LOW', suggestion?: { caseId }, reason: string }`.
  - **Rule-20 safe.** Never touches `Note.draftJson` or any draft surface.
- FE: `<IntentCaseFitChip>` in [src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx](../../src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx) above the sign button. Behind `cleo.caseRule.v1` flag. Yellow chip offers a one-click swap that POSTs to the existing case-router/accept route — `assertCanContinueCase` enforces the rule on the swap too.

**§H — Tests**

- New: `test/lib/case-access.test.ts` (same-division pass, MULTI pass, mismatch 403, error class shape).
- New: `test/services/copilot/case-nominator.test.ts` (scoring matrix, division scoping, empty patient).
- New: `test/services/copilot/intent-case-fit.test.ts` (HIGH/MEDIUM/LOW thresholds, no-draft assertion).
- New: `test/api/copilot/case-suggestions.test.ts`.
- Updated: [test/api/case-router-accept.test.ts](../../test/api/case-router-accept.test.ts) — add division-mismatch 403 test + audit assertion.
- Updated: [test/lib/case-router/propose.test.ts](../../test/lib/case-router/propose.test.ts) — shared-ICD scenario yields open-new in clinician's division (never cross-division attach).
- Updated: seed factories — every `CaseManagement` in seeds gets explicit `division`.

**§I — Audit**

New audit action `CASE_DIVISION_BLOCKED` with metadata `{ caseId, clinicianDivision, caseDivision, route }`. Emitted from the `CaseDivisionDeniedError` catch path. Never wrapped in swallowing try-catch (rule 8).

**Estimated regression.** ~3%.

### PR2 — Follow-up division gate (rule-consistency)

**Goal.** Open follow-ups inherit the division of their origin note. The brief query, triage UI, and carry-over flow all respect viewer division.

**§A — Schema migration** (`prisma/migrations/<ts>_unit_49_followup_division/`)

```sql
ALTER TABLE "FollowUp" ADD COLUMN "division" "Division";

UPDATE "FollowUp" f
SET    "division" = (SELECT n."division" FROM "Note" n WHERE n."id" = f."originNoteId");

-- Backfill safety: any orphan rows (origin note deleted) → MULTI
UPDATE "FollowUp" SET "division" = 'MULTI' WHERE "division" IS NULL;

ALTER TABLE "FollowUp" ALTER COLUMN "division" SET NOT NULL;

CREATE INDEX "FollowUp_orgId_patientId_division_status_idx"
  ON "FollowUp" ("orgId", "patientId", "division", "status");
```

**§B — Create-time stamp** ([src/workers/note-brief/handler.ts:228-240](../../src/workers/note-brief/handler.ts:228))

Add `division: originNote.division` to the `FollowUp.create` payload.

**§C — Query filter** ([src/workers/note-brief/handler.ts:260-264](../../src/workers/note-brief/handler.ts:260))

```ts
findMany({
  where: { patientId, orgId, status: 'OPEN',
           division: { in: [viewerDivision, 'MULTI'] } },
})
```

Same change in any other site that fetches follow-ups for display.

**§D — Triage guard** ([src/app/api/follow-ups/[id]/route.ts:73-89](../../src/app/api/follow-ups/[id]/route.ts:73))

Before the `update` call, fetch the follow-up + the actor's `OrgUser.division`, then `if (followup.division !== 'MULTI' && followup.division !== clinician.division) → 403 + CASE_DIVISION_BLOCKED audit (actionType: 'followup-triage')`.

**§E — Tests**

- New: `test/api/follow-ups/division-guard.test.ts` — 403 on cross-division `MET / DROPPED / CARRIED`.
- New: `test/workers/note-brief/followup-division-filter.test.ts` — PT brief excludes BH follow-ups.
- Updated: any brief-shape regression test that seeds follow-ups without division.

**§F — Audit**

Same `CASE_DIVISION_BLOCKED` action with `route: 'followup-triage'` discriminator.

**Estimated regression.** ~2%.

### PR3 — Miss Cleo biller advisory + optional snapshot polish

**Goal.** Post-sign, Cleo audits narrative ↔ ICD ↔ profession against Medicare standards. Mismatches surface as a card with proposed corrective actions. Never modifies the signed note.

**§A — Schema migration** (`prisma/migrations/<ts>_unit_49_biller_advisory/`)

```sql
ALTER TABLE "Note" ADD COLUMN "billerAdvisoryJson" JSONB;

CREATE TABLE "IcdProfessionEligibility" (
  "code"       TEXT NOT NULL,
  "professions" "ProfessionType"[] NOT NULL,
  "notes"      TEXT,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("code")
);
```

Seed `IcdProfessionEligibility` with the top-50 ICDs by org volume (curated list — REHAB, MEDICAL, BH most common codes + their billing-eligible professions). Future admin UI for editing deferred.

**§B — Biller-advisor service** (`src/services/copilot/biller-advisor.ts`)

```ts
type BillerVerdict = 'OK' | 'NARRATIVE_MISMATCH' | 'PROFESSION_INELIGIBLE' | 'BOTH';
type SuggestedAction = 'ADDENDUM' | 'OPEN_NEW_NEXT_VISIT' | 'MARK_CLEARED';
type BillerAdvisory = {
  verdict: BillerVerdict;
  findings: Array<{ kind: string; detail: string }>;
  suggestedActions: SuggestedAction[];
  generatedAt: string;
  modelVersion: string;
};
async function runBillerAdvisor(input: {
  noteId: string; finalJson: unknown;
  caseIcd: string; clinicianProfession: ProfessionType;
}): Promise<BillerAdvisory>;
```

Uses [src/services/llm/](../../src/services/llm/) abstraction (rule 6). Prompt asks the model to:
1. Compare `finalJson` narrative against `caseIcd` (does the documentation support this code?).
2. Compare `caseIcd` against `IcdProfessionEligibility[caseIcd].professions` (is this profession allowed to bill this ICD under Medicare?).
3. Emit a verdict + structured findings.

JSON response parsed via [src/lib/llm/strip-json-fence.ts](../../src/lib/llm/strip-json-fence.ts) (D-W5-HARDENING-2 — Sonnet 4.5 wraps JSON in fences).

**§C — Worker step** ([src/workers/post-sign-artifacts/handler.ts](../../src/workers/post-sign-artifacts/handler.ts))

Add `runBillerAdvisor` after existing artifact steps. Failure: log + `BILLER_ADVISORY_FAILED` audit; never blocks the pipeline. On success: `Note.update({ billerAdvisoryJson })` + `BILLER_ADVISORY_GENERATED` audit.

**§D — Resolve endpoint** (`POST /api/notes/[id]/biller-advisory/resolve`)

```ts
body: { action: 'ADDENDUM' | 'OPEN_NEW_NEXT_VISIT' | 'MARK_CLEARED'; note?: string }
```

- `ADDENDUM` → returns redirect URL to a new note in addendum mode (existing flow).
- `OPEN_NEW_NEXT_VISIT` → writes a hint row consumed by the next start-visit-dialog (Cleo nominator surfaces the hint). Does **NOT** cross divisions — if the suggested better-fit ICD belongs to another division, the hint reads "route at intake to <division>".
- `MARK_CLEARED` → sets `billerAdvisoryJson.resolved = { by: clinicianOrgUserId, at, reason }` + audit.

**§E — UI**

- [src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx](../../src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx) — `<BillerAdvisoryCard>` when `note.billerAdvisoryJson?.verdict !== 'OK'` and not resolved. Action buttons confirm via `<AlertDialog>` (rule 22).
- [src/app/(clinical)/patients/[id]/_components/cases-panel.tsx](../../src/app/(clinical)/patients/[id]/_components/cases-panel.tsx) — `<BillerAdvisoryPip>` on the case card when any unresolved advisory exists for a note on that case.

Both behind `cleo.caseRule.v1` flag.

**§F — Optional snapshot polish (bundled here)**

[src/lib/snapshots/build-snapshot-strip.ts:233-265](../../src/lib/snapshots/build-snapshot-strip.ts:233) — `resolveCasesForSourceNotes` adds a viewer-division filter on the source-note traversal so a PT chart doesn't render MEDICAL case labels on measure cards. Coexists with the existing `viewerDivision`-driven measure ordering.

**§G — Tests**

- New: `test/services/copilot/biller-advisor.test.ts` — verdict matrix (OK / NARRATIVE_MISMATCH / PROFESSION_INELIGIBLE / BOTH), JSON parse failure handling.
- New: `test/workers/post-sign-artifacts/biller-advisor-step.test.ts` — happy path, failure isolation, audit emission.
- New: `test/api/notes/biller-advisory-resolve.test.ts` — all three action paths, audit assertions.
- New: `test/components/biller-advisory-card.test.tsx` — render gating + AlertDialog confirmation flow.
- Updated: snapshot regression tests for the source-note viewer-division filter.

**§H — Audit**

`BILLER_ADVISORY_GENERATED` (metadata: `noteId, verdict, findingCount`), `BILLER_ADVISORY_FAILED` (metadata: `noteId, errorMessage` truncated to 600 chars), `BILLER_ADVISORY_RESOLVED` (metadata: `noteId, action, resolvedByOrgUserId`). All emitted outside swallowing try-catch (rule 8).

**Estimated regression.** ~3%.

## Dependencies

- **Unit 02** — Encounter + EpisodeOfCare + Department + Patient. Division concept already lives on `OrgUser`, `Note`, `Department`, `EpisodeOfCare`.
- **Unit 06** — `NoteBrief` + `FollowUp` schema. PR2 extends `FollowUp`.
- **Unit 07** — Copilot beacon + cards. PR3's `<BillerAdvisoryCard>` uses the same source-pill discipline (rule 20: card cites `billerAdvisoryJson.modelVersion` + `generatedAt`).
- **Unit 27** — Ask-mode agent loop + LLM abstraction. PR3's `biller-advisor.ts` uses the same Sonnet 4.5 → Haiku 4.5 fallback pattern.
- **Unit 48** — `Encounter.intent` + `intentMeta`. PR1's pre-sign chip consumes `intentMeta` (structured) to stay rule-20 safe.

Hard order: **PR2 before PR3.** Cleo's biller advisor will reason about open follow-ups in scope; we don't want her reasoning across divisions before the filter exists.

## Verify when done

**PR1 (case division + parallel cases + nominator + chip).**
- [ ] Migration adds `CaseManagement.division`, backfills, enforces NOT NULL. Manual `SELECT COUNT(*) WHERE division IS NULL` = 0.
- [ ] PT cannot attach a visit to a MEDICAL case via `POST /api/notes/[id]/case-router/accept` (403 + `CASE_DIVISION_BLOCKED` audit row).
- [ ] Patient with both REHAB and MEDICAL M54.50 cases: PT sees only REHAB in case picker and cases panel.
- [ ] `case-router.propose()` for a shared ICD with no same-division case yields `open-new`, never `attach`.
- [ ] Start-visit dialog highlights one suggested case with a "why" tooltip (behind flag).
- [ ] Pre-sign intent-fit chip renders yellow when `intentMeta` ICD differs from `case.primaryIcd`; one-click swap routes via accept endpoint (behind flag).
- [ ] `npx prisma db seed` clean (rule 4).
- [ ] `npm run typecheck`, `npx eslint <touched files>`, `npx vitest run` all green.

**PR2 (follow-up division gate).**
- [ ] Migration adds `FollowUp.division`, backfills from `originNote.division`, enforces NOT NULL.
- [ ] PT signs REHAB note with 3 follow-ups → MEDICAL clinician opening the same patient sees 0 of them in the brief.
- [ ] Triage 403 fires on cross-division `MET / DROPPED / CARRIED` with `CASE_DIVISION_BLOCKED` audit row.
- [ ] Carried follow-up survives to next REHAB visit (same-division), but is hidden if next visit is BH or MEDICAL.

**PR3 (biller advisory).**
- [ ] PT signs a note documenting anxiety symptoms attached to an M54.50 case → `BILLER_ADVISORY_GENERATED` audit row within ~30s; `Note.billerAdvisoryJson.verdict === 'NARRATIVE_MISMATCH'`.
- [ ] `<BillerAdvisoryCard>` renders on review screen with `[Addendum]` `[Open new next visit]` `[Mark cleared]` buttons (behind flag).
- [ ] `OPEN_NEW_NEXT_VISIT` stages hint surfaced by Cleo nominator at next start-visit dialog.
- [ ] `ADDENDUM` opens a new note; signed `Note.finalJson` unchanged (rule 3 verification — snapshot diff).
- [ ] REHAB clinician submitting a profession-ineligible ICD → verdict `PROFESSION_INELIGIBLE`.
- [ ] Snapshot strip on a PT chart no longer labels measure cards with MEDICAL case ICDs.

**Cross-cutting three-lens.**
- *Clinician:* never blocked at moment of decision; pickers stay short (off-division hidden); biller advisory is post-sign, never mid-visit.
- *Compliance:* every cross-division attempt audit-logged; biller advisory `JSON` reconstructs AI reasoning; addendum-or-open-new respects rule 3 immutability.
- *Auditor:* `Case → division` immutable from creation; `FollowUp → division` derived from origin note + audit-trail; `BillerAdvisory → modelVersion + generatedAt + findings` queryable per note for MAC review.

## Out of scope (call out so future agents don't expand)

- Cross-division case re-routing (action: "move this case from MEDICAL to BH"). Forbidden under the rule. If clinically needed, the answer is "close this case + open new in target division" — manual, never AI-automated.
- Admin UI for editing `IcdProfessionEligibility` rows (PR3 ships a seed only; CRUD UI is a follow-on unit).
- Multi-division co-managed cases (`permittedDivisions: [REHAB, MEDICAL]` on a single case). Rejected at design time — dilutes the rule, complicates billing trail.
- Cleo-authored cross-division case mergers / sibling-linking UI (the prior turn's Option C). Deferred — parallel cases per division is the v1 compromise.
- Per-clinician biller-advisor tuning (override thresholds, opt out of profession check). Not v1.
- Auto-addendum (Cleo writes the addendum text). Forbidden — clinician authors all clinical text. v1 only opens the addendum draft, doesn't pre-fill.
- Push/email/SMS biller advisory notifications. v1 surfaces only in-app.

## Anti-patterns to avoid

- **Do not loosen the rule with a `permittedDivisions[]` array on `CaseManagement`.** It collapses to the same diluted gate. If a case spans divisions, the answer is two cases (parallel) or MULTI on the rare clinically-MULTI case.
- **Do not let Cleo modify `Note.finalJson` in the biller advisor.** Rule 3 holds; advisory writes only to `Note.billerAdvisoryJson` (the new column).
- **Do not auto-merge sibling cases across divisions.** Parallel cases stay parallel — that's the compromise per the design.
- **Do not block the clinician from signing if Cleo flags a mismatch.** Pre-sign chip is informative, not gating. Post-sign advisory proposes; clinician disposes.
- **Do not pre-fill addendum text from Cleo's reasoning.** Open the addendum draft; the clinician writes.
- **Do not use `if (clinician.role === ORG_ADMIN) bypass`** to circumvent the division gate. Org admins are not licensed to bill across divisions; their role is org config, not clinical write.
- **Do not skip the audit row** on a 403. The trail of denied attempts is the auditor's evidence the gate is active.
- **Do not query follow-ups without the division filter** anywhere in the codebase. If you need cross-division view (e.g., owner console), use an explicit `IS_PLATFORM_OWNER` admin gate, not a missing filter.

## Open questions (deferred — not blocking implementation)

1. **`IcdProfessionEligibility` source-of-truth.** Initial seed is curated from top-50 ICDs. Long-term: org admin edits? CMS regulatory feed? Decide at PR3 spec time or in a follow-on unit (~49.5).
2. **MULTI-division clinician permissions.** A clinician with `OrgUser.division = MULTI` can write to any case. Is this needed in v1? Memory says the platform is multi-discipline (REHAB / BH / MEDICAL). Default: yes, MULTI exists as an escape hatch but should be rarely granted. Confirm with user before seeding any MULTI clinicians outside of platform-owner contexts.
3. **Carry-over follow-ups across division change in same episode.** If an episode legitimately changes division mid-stream (rare; episode division override exists per Unit 11), what happens to OPEN follow-ups on the prior division? Default: they remain attached to their origin division (clinicians of the new division don't see them; clinicians of the old division still triage). Revisit if a clinical workflow surfaces a real complaint.
4. **Snapshot polish scope.** PR3 bundles the viewer-division source-note filter as polish. Could be split into its own ~0.5% PR if PR3's bundle exceeds the 4% regression ceiling at code review time.
5. **Owner-console exposure.** Should `/owner/audit` expose `CASE_DIVISION_BLOCKED` events for cross-org audit search (per Unit 33 scope)? Default: yes (PHI-free audit row); no schema change needed.

## Phasing

Each PR is independently mergeable and revertable. Sequencing constraints:

1. **PR1** lands first. Rule itself ships unflagged; Cleo UX surfaces flagged off in prod, on in staging for validation.
2. **PR2** lands second. Follow-up gate is rule-consistency, not UX — ships unflagged everywhere.
3. **PR3** lands third. Biller advisor flagged off in prod until verdict quality validated on a handful of staging signed notes.

After all three PRs:
- Flip `cleo.caseRule.v1` ON in staging → 3-day soak.
- Flip in prod → monitor `CASE_DIVISION_BLOCKED` and `BILLER_ADVISORY_GENERATED` audit volumes for anomalies.

Then (separate task; not part of Unit 49):
- Update [context/architecture.md](../architecture.md) Invariants with the two new invariants (#25 and #26).
- Update [context/progress-tracker.md](../progress-tracker.md) — move Unit 49 to Completed with date + PR links.
- Update [context/specs/00-build-plan.md](00-build-plan.md) — mark Unit 49 complete.
