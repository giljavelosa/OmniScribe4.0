-- Unit 48 PR5 — Visit-type intent nudge safety net.
--
-- Additive only: appends INTENT_PROPOSAL_MISSED to CleoNudgeKind so the
-- detector can upsert a new nudge variant when an Encounter has
-- intent=UNSPECIFIED AND the deterministic IntentProposer would propose
-- a SUPPORTED_INTENT_PAIRS pair with medium/high confidence.
--
-- Append-only per anti-regression rule 2 (NoteStatus discipline). Per
-- rule 4, `npx prisma db seed` is run after this migration applies (no
-- backfill required — INTENT_PROPOSAL_MISSED nudges are created lazily
-- by the detector on /prepare page load).
--
-- Spec: context/specs/48-pre-visit-brief-intent.md §K
-- Companion: src/services/copilot/detect-intent-missed-nudge.ts (PR5)

ALTER TYPE "CleoNudgeKind" ADD VALUE 'INTENT_PROPOSAL_MISSED';
