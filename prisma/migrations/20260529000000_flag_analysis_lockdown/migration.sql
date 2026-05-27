-- Sprint 0 — Flag-analysis lockdown.
--
-- Spec: context/specs/sprint-0-flag-analysis-lockdown.md
--
-- Three columns + one index. All additive (rule 1). No data loss; no enum
-- changes. The `claimSignature` backfill stamps a deterministic signature
-- on existing ReviewFlag rows so the post-deploy re-analyze path can
-- carry-forward decisions made before this migration shipped.

-- 1. Note: per-note analyzer-run counter + per-section content-hash snapshot.
--    runCount caps re-analysis at 2 (route refuses 409 past that).
--    sectionHashes powers the run #2 diff-skip AND the sign-time
--    `edited_since_analysis` attestation gate.
ALTER TABLE "Note"
  ADD COLUMN IF NOT EXISTS "flagAnalysisRunCount"      INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "flagAnalysisSectionHashes" JSONB;

-- 2. ReviewFlag: stable per-claim signature (sectionId + normalized claim).
--    Drives the carry-forward branch in the analyzer — when a re-analyze
--    emits a new flag whose signature matches a prior RESOLVED/DISMISSED
--    row, the new row is created already-resolved with
--    resolutionAction = 'CARRIED_FORWARD'.
ALTER TABLE "ReviewFlag"
  ADD COLUMN IF NOT EXISTS "claimSignature" TEXT;

-- Compound index for the (noteId, claimSignature) lookup in the analyzer.
CREATE INDEX IF NOT EXISTS "ReviewFlag_noteId_claimSignature_idx"
  ON "ReviewFlag" ("noteId", "claimSignature");

-- 3. Backfill claimSignature on existing rows so the carry-forward path
--    works from day one for notes that already have a decision history.
--    Normalize: lowercase → strip non-alphanumeric (keep whitespace) →
--    collapse whitespace to single space → trim. SHA-256 over
--    `sectionId || '|' || normalized_claim`.
--
--    Wrapped in DO-block so the migration succeeds even if pgcrypto's
--    `digest()` is not available on a given environment. Acceptable
--    fallback semantics: rows stay claimSignature = NULL and won't
--    participate in the next carry-forward; the first post-migration
--    analyzer run for that note will stamp signatures on all new flags
--    going forward. The application-side `signatureFor()` helper in
--    src/lib/notes/flag-analysis-state.ts is the canonical implementation;
--    SQL backfill is best-effort historical-data seeding only.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  UPDATE "ReviewFlag"
  SET "claimSignature" = encode(
    digest(
      "sectionId" || '|' || trim(
        regexp_replace(
          regexp_replace(lower("claim"), '[^a-z0-9\s]', '', 'g'),
          '\s+',
          ' ',
          'g'
        )
      ),
      'sha256'
    ),
    'hex'
  )
  WHERE "claimSignature" IS NULL;
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pgcrypto.digest() unavailable — skipping claimSignature backfill. Run scripts/backfill-flag-signatures.ts post-deploy if historical carry-forward matters.';
END$$;
