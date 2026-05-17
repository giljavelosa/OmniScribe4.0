# Four pillars — UI, Admin, HIPAA (scribe scope), Commercial deploy

**Captured:** 2026-05-06  
**Purpose:** Single index for four parallel commitments Gil stated together. Detailed specs stay in the linked files below — this charter **does not** replace them.

---

## Pillar 1 — Implement clinical/product UI (mockup parity)

**Goal:** Close gaps in `design-mockup-gap-analysis/` vs `design-mockups-2026-05/` for **clinician-facing** flows (capture, prepare, review, drafts, home, patient detail, templates, auth, sign, flag review).

**Source of truth:** `design-mockup-gap-analysis/README.md` (coverage matrix + Phase 2+ candidate list, ordered by impact).

**Execution priority:** Documented in README § “Execution priority (2026-05-06)” — mockup backlog is the **primary UI backlog** until those rows are addressed.

**Relationship to RD-*:** `memory/commercial-launch-roadmap.md` bundles **design tokens** (RD-0b–e) and shared components **ahead of** heavy page replumbs; clinical mockup work can proceed **in parallel** or **after** tokens land — token reconciliation reduces rework when touching Tailwind arbitrary values vs mockup CSS vars.

**Does not include:** Team admin `(admin)/` or owner `/owner/` console visual overhaul — those are **Pillar 2** + RD-1–RD-4.

---

## Pillar 2 — Fix / uplift Team Admin + Platform (Owner / Ops) UI

**Goal:** Ship admin surfaces that match redesign specs **and** remove commercial blockers (MFA/password reset, sites CRUD, downstream BAA fields, auth-model hygiene).

**Sources of truth:**
- **Gap analysis (pixels):** `design-mockup-gap-analysis/admin.md`, `design-mockup-gap-analysis/owner.md`
- **Sequenced engineering plan:** `memory/commercial-launch-roadmap.md` — **RD-1** (team admin users + blockers), **RD-2** (sites), **RD-3** (other tenant admin), **RD-4** (owner console split + BAA schema + ops surfaces)
- **Evidence / blockers list:** `memory/commercial-readiness-backlog.md`, `audit-admin-state-of-play.md`

**Important:** Pillar 1 **does not** substitute for Pillar 2 — different routes, different mockups, different RD phases.

---

## Pillar 3 — HIPAA readiness audit (scribe-only; notes as anchor for goals / assist)

**Goal:** Evidence-backed assessment that **OmniScribe’s documentation / scribe capability** can be offered commercially under a **BAA** with covered entities — **not** full EHR replacement. Narrow scope per Gil: **generated notes as the primary artifact**; any **goal tracking** or **assist (“co‑pilot”)** behavior must stay inside the **same PHI boundary and safeguards** as the note pipeline (no shadow database of clinical goals unless architected and contracted).

### Engineering framing (not legal advice)

- **HIPAA compliance** is **organizational + technical**: BAAs (upstream vendors + downstream customers), risk analysis, policies, workforce training, breach process, BAART — **legal/compliance sign-off is required**; engineering supplies **controls mapping** and **evidence** (audit logs, encryption, access control, retention).
- **Scribe-only scope:** Audio → transcription (Soniox BAA path) → optional LLM note generation (Bedrock BAA path) → clinician review/sign → immutable `finalJson`. Aligns with existing rules: no auto-sign, audit logging, S3 soft-delete, etc. (`CLAUDE.md`, `.cursorrules`).
- **“Goals / co-pilot” from notes only:** Feasible as **product posture**: surface **extracted or summarized goals from draft/final note sections** for **review-time assist**, with clinician verification — **not** a separate ungoverned “Copilot” datastore. Anything **persisted** beyond the note record needs explicit schema, access control, and **minimum necessary** justification in the DPIA/SRA narrative.
- **Gap vs mockups:** `patient-detail.md` dashboard mockup assumes rich longitudinal clinical data (problems/meds/goals as **first-class** chart objects). A **notes-anchored** strategy **deliberately does not** deliver that mockup without additional schema + compliance review — document that tradeoff in any HIPAA packet.

**Suggested deliverables (when this pillar is activated):**
1. **Controls matrix** — → **`memory/hipaa-scribe-controls-matrix.md`** (living engineering ↔ compliance map; legal still signs off).
2. **Vendor BAAs** — checklist: AWS HIPAA-eligible services in use, Soniox flag + BAA on file, Bedrock path only (no raw Anthropic keys in prod). Already summarized in `commercial-readiness-backlog.md` § BAA layers.
3. **Customer BAA** — downstream fields on `Organization` + ops dashboard **BAA** dialog (implemented 2026-05-06).
4. **Penetration / SOC2** — out of scope here unless customer demands; note as sales dependency.

---

## Pillar 4 — Commercial deployment

**Goal:** Repeatable **production** deploy (e.g. Vercel + AWS per `CLAUDE.md`), secrets in Secrets Manager, **no** duplicate worker fleets on Redis, monitoring, and **go-live checklist** per customer.

**Sources:** `CLAUDE.md` (App Runner / ECS / RDS / ElastiCache / S3 / CloudFront), **`memory/commercial-deploy-checklist.md`** (go-live checklist), `memory/commercial-launch-roadmap.md` (workflow: PR review, Gil owns prod deploys), `memory/commercial-readiness-backlog.md` (blockers before first dollar).

**Depends on:** Pillar 2 **blockers** for first paying tenant (MFA/password reset, sites edit, BAA tracking); Pillar 3 **customer-specific** BAA execution; environment parity (workers + web).

---

## Suggested sequencing (high level)

| Order | Pillar | Rationale |
|------:|--------|-----------|
| 1 | **2 — Admin blockers** (subset of RD-1/RD-2 + BAA schema when ready) | Unlocks supportability and contracts without waiting on full pixel parity |
| 2 | **3 — HIPAA packet (draft)** | Parallel track; informs what you promise in BAA and marketing |
| 3 | **1 + 2 (UI)** | RD-0b–e tokens + mockup gaps + admin/owner redesign per roadmap |
| 4 | **4 — Commercial deploy** | After blockers + signed downstream BAA path for pilot customer |

Adjust if a pilot customer forces deploy before full mockup parity — **acceptable** if risks are documented.

---

## Corrections to informal language

- **“Co-pilot”** — Not a separate branded product in repo today; mean **AI-assisted documentation** (transcription + draft + flags + section regen) under existing safeguards.
- **Goal tracking** — Episode goals in **workers/prompts** support **generation**; **longitudinal goal UX** from **notes only** is a **narrower** product than full episode/FHIR dashboards — possible, but mockups that show full clinical dashboards would still **not** be satisfied without scope expansion.

---

## Files this charter points to (do not fork)

- `design-mockup-gap-analysis/README.md`
- `memory/commercial-launch-roadmap.md`
- `memory/commercial-readiness-backlog.md`
- `audit-admin-state-of-play.md`
