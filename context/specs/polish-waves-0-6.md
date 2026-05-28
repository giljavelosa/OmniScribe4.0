# Polish — Waves 0–6 (gate before Wave 7 & 8)

> **Status:** in progress (planning). Waves 7 (billing Unit 41) and 8 (Miss Cleo port) are **paused** until this checklist is materially complete. Units 01–37 shipped capability; this document tracks the gaps, stubs, and deferred polish that block production trust.

## Gate rule

Do **not** start Wave 7 Unit 41 or Wave 8 Unit 42+ until:
1. All **P0** items below are complete or explicitly accepted with documented reason.
2. **P1** items are complete OR scheduled as named polish PRs with owners.

Update `context/progress-tracker.md` Current Phase when the gate opens.

---

## Priority legend

| Tier | Meaning |
|------|---------|
| **P0** | Blocks production, compliance trust, or core clinical loop |
| **P1** | Daily clinician/admin friction; should ship before GA |
| **P2** | Quality polish; can ship post-GA if time-constrained |

---

## Wave 0 — Foundation (Units 01–05)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W0-01 | **Voice-ID / TitaNet** — replace skeleton worker | P0 | `voice-id.worker.ts` audits `VOICE_ID_SKIPPED` / `voice_profile_not_yet_implemented`. Needs `VoiceProfile` model + pgvector enrollment + post-transcription match. Architecture + Unit 04 spec describe target shape. |
| W0-02 | **Voice profile enrollment UI** — `/profile/voice` | P0 | Depends W0-01. BIPA consent versioning required before enrollment. |
| W0-03 | **Provider stub → real wiring checklist** | P1 | Document + verify env for production: Soniox BAA, Bedrock bearer, S3 bucket, Resend domain. `/owner/health` ◐ stub indicators must be green in prod. |
| W0-04 | **Soniox ephemeral key tier** | P2 | `POST /v1/auth/temporary-api-keys` returns 404 on current tier; long-lived key fallback works but loses 60s TTL (Unit 03 decision). Revisit when Soniox plan upgrades. |
| W0-05 | **Patient search pg_trgm** | P2 | Unit 02 deferred trigram index; `contains+insensitive` fine for demo scale. Swap when customer MRN volume warrants. |
| W0-06 | **TipTap review editor** | P2 | Unit 05/14 shipped `<Textarea>`. TipTap pays off when inline flag annotations need rich text — optional for GA. |
| W0-07 | **README + seed credentials accuracy** | P1 | README still lists `SUPER_ADMIN`; seed docs should match ORG_ADMIN consolidation. |

**Wave 0 exit:** Clinician can record → transcribe (real or configured Soniox) → generate (Bedrock) → sign with voice-ID best-effort or documented skip reason.

---

## Wave 1 — Copilot foundation (Units 06–09)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W1-01 | **System announcement banner render** | P1 | CRUD exists (Unit 09/33); banner across app for matching orgs + schedule window + dismissal store never shipped. |
| W1-02 | **Open question 1 — seed personas** | P2 | Confirm seed covers VIEWER, SITE_ADMIN, PLATFORM_OWNER for test matrix (likely already seeded — verify + close question). |

**Wave 1 exit:** Owner console operational; returning patients get brief + Watch v0; announcements visible to end users when published.

---

## Wave 2 — UX maturity (Units 10–14)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W2-01 | **Touch-target audit — 3 open findings** | P1 | `research-surface` SourceChip, `ImpersonationBanner` End button, `StatusBanner` close button. Run `npm run touch-audit`. |
| W2-02 | **iPad layout pass — clinical surfaces** | P1 | Unit 36 deferred per-surface fixes. Priority: `/home`, `/capture`, `/review`, `/prepare`. See `references/design-mockup-gap-analysis/`. |
| W2-03 | **iPad layout pass — admin surfaces** | P2 | Team/seats/billing tablet rhythm from gap analysis. |
| W2-04 | **Section accordion animation** | P2 | Unit 14 added data-state hooks; smooth keyframe polish optional. |

**Wave 2 exit:** Review/regenerate/diff flows stable on iPad; touch targets pass audit on clinical paths.

---

## Wave 3 — Telehealth (Units 15–18)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W3-01 | **Daily.co real SDK integration** | P0 | `daily.ts` stub throws on real-mode until `DAILY_API_KEY` set. Room create/destroy + iframe need live wiring. |
| W3-02 | **Patient audio track via Daily SDK** | P1 | Unit 17 ships clinician-only in stub; one-line swap at room shell when W3-01 lands. |
| W3-03 | **Schedule list "Start telehealth" CTA** | P1 | Clinicians must know `/telehealth/preflight/[scheduleId]` exists; add button on TELEHEALTH schedule rows. |
| W3-04 | **TitaNet on post-call review** | P1 | Ties to W0-01; relabel transcript speakers after voice-ID match. |
| W3-05 | **Telehealth E2E test path** | P2 | Magic link → waiting room → consent → room → end-call → processing documented in journeys/06. |

**Wave 3 exit:** TELEHEALTH visit type runnable end-to-end with real Daily.co in staging.

---

## Wave 4 — FHIR / EHR (Units 19–24)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W4-01 | **NextGen sandbox live config** | P1 | SMART OAuth works in stub; production needs real client ID/secret + redirect URI in Secrets Manager. |
| W4-02 | **Background FHIR staleness sweeper** | P1 | Sync is on-demand only; 7d stale threshold exists but no BullMQ refresher. |
| W4-03 | **CarePlan + Goal FHIR adapters** | P2 | Unit 21 locked 8 types; CarePlan/Goal deferred Wave 4.5. Ask mode v2 has forward-compatible empty tools. |
| W4-04 | **Pagination beyond 50/type** | P2 | Large charts may truncate. |
| W4-05 | **Per-org EHR onboarding UI** | P2 | `OrgEhrConnection` schema exists (Unit 24); env-driven NextGen only today. |
| W4-06 | **Epic / Cerner adapter wiring** | P2 | Registry shows `planned`; defer until customer demand. |

**Wave 4 exit:** One real NextGen sandbox org can link patient → sync → brief enrichment → provenance UI with fresh cache.

---

## Wave 5 — Copilot maturity (Units 25–31)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W5-01 | **Research mode — real PMC eutils** | P1 | Unit 29 stub-mode deterministic citations; replace with PubMed Central API when research tab used in prod. |
| W5-02 | **FHIR source pill → ProvenanceDrawer** | P2 | Unit 28 deferred deep-link on Ask-mode FHIR pills. |
| W5-03 | **Copilot chat persistence** | P2 | In-memory per session (Unit 27). DB persistence is Wave 8 Unit 47 — **do not pull forward** unless polish gate extends. |

**Wave 5 exit:** Chart + Research tabs trustworthy with configured Bedrock; Watch v2 triggers stable on capture.

---

## Wave 6 — Platform + polish (Units 32–37)

| ID | Item | Tier | Notes |
|----|------|------|-------|
| W6-01 | **PWA icon PNGs (192 + 512)** | P1 | `public/icons/README` only; manifest references missing binaries. |
| W6-02 | **Background OrgUsageDaily rollup** | P2 | On-demand + 60min cache (Unit 32); cron/BullMQ promotion when owner usage page is hot. |
| W6-03 | **Audit purge BullMQ scheduler** | P2 | CLI exists (Unit 34); scheduled job deferred. |
| W6-04 | **LLM cost metering coverage** | P2 | Unit 35 claims ~95% of token volume; audit remaining LLM call sites. |
| W6-05 | **Landing page depth** | P2 | Unit 37 minimal `/`; marketing surfaces deferred. |
| W6-06 | **Self-provisioned org BAA banner** | P1 | Unit 37 spec mentions "BAA pending" signal for signup orgs — verify UI exists. |

**Wave 6 exit:** PWA installable on iPad with real icons; owner/ops consoles usable for support.

---

## Cross-wave (infra — not Wave 7/8)

These support Waves 0–6 in production but are not feature units:

| ID | Item | Tier |
|----|------|------|
| X-01 | CDK compute stack (ECS/App Runner) | P0 for prod deploy |
| X-02 | GitHub Actions → AWS deploy pipeline | P0 |
| X-03 | CloudWatch dashboards + alarms | P1 |
| X-04 | CloudFront + WAF | P1 |

Track in progress tracker under GA-readiness; parallel to polish PRs where possible.

---

## Suggested polish sequence (sprints)

1. **Sprint 0 — Login & session trust (P0):** post-sign-in cookie race, onboarding-sites gate, home blank guard — spec in [`context/specs/sprint-0-login-first.md`](sprint-0-login-first.md) (the original D2 MFA redirect-loop item is moot — MFA removed in Sprint 0.20; login is email+password landing on `/home`)
2. **Sprint A — Trust & providers (P0):** W0-01/02, W3-01, W0-03, X-01/X-02 — spec in [`context/specs/sprint-a-fe-be.md`](sprint-a-fe-be.md)
3. **Sprint B — Clinical daily (P1):** W2-01/02, W3-02/03, W1-01, W6-01
4. **Sprint C — EHR + copilot stubs (P1):** W4-01/02, W5-01
5. **Sprint D — P2 backlog:** remaining items as capacity allows

---

## Verify when polish gate opens

- [ ] P0 table rows all ✅ or waived with architecture decision logged
- [ ] P1 table rows all ✅ or have open PR links in progress tracker
- [ ] `npm test` + `npm run build` + `npm run lint` green
- [ ] Journey 02 (typical visit) exercised on staging with real providers
- [ ] progress-tracker.md Current Phase updated: "Polish gate passed — Wave 7/8 unblocked"
