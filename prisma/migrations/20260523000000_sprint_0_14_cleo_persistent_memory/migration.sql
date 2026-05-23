-- Sprint 0.14: Miss Cleo's persistent memory + "Cleo's read" chart card
--
-- Append-only per anti-regression rules 1, 2, 4. Migration is fully additive:
--   * `CopilotConversationMode` enum is brand new
--   * `CopilotPatientState` table is brand new (per patient × clinician memory)
--   * `CopilotConversation` table is brand new (one persistent thread per
--     patient × clinician × mode)
--   * `CopilotMessage` table is brand new (chat messages under a conversation)
-- No changes to existing tables.

-- ---------- enum ------------------------------------------------------------
CREATE TYPE "CopilotConversationMode" AS ENUM ('CHART', 'RESEARCH');

-- ---------- CopilotPatientState --------------------------------------------
CREATE TABLE "CopilotPatientState" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "caseAwarenessJson" JSONB NOT NULL,
    "observedPatternsJson" JSONB NOT NULL,
    "conversationFactsJson" JSONB NOT NULL,
    "lastRebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatorVersion" TEXT NOT NULL,

    CONSTRAINT "CopilotPatientState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CopilotPatientState_orgId_patientId_clinicianOrgUserId_key"
  ON "CopilotPatientState"("orgId", "patientId", "clinicianOrgUserId");
CREATE INDEX "CopilotPatientState_orgId_patientId_idx"
  ON "CopilotPatientState"("orgId", "patientId");
CREATE INDEX "CopilotPatientState_clinicianOrgUserId_lastRebuiltAt_idx"
  ON "CopilotPatientState"("clinicianOrgUserId", "lastRebuiltAt");

ALTER TABLE "CopilotPatientState"
  ADD CONSTRAINT "CopilotPatientState_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CopilotPatientState"
  ADD CONSTRAINT "CopilotPatientState_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CopilotPatientState"
  ADD CONSTRAINT "CopilotPatientState_clinicianOrgUserId_fkey"
  FOREIGN KEY ("clinicianOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- CopilotConversation --------------------------------------------
CREATE TABLE "CopilotConversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT,
    "clinicianOrgUserId" TEXT NOT NULL,
    "mode" "CopilotConversationMode" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personaVersion" TEXT NOT NULL,

    CONSTRAINT "CopilotConversation_pkey" PRIMARY KEY ("id")
);

-- Compound unique. Postgres treats NULL values in unique constraints as
-- distinct, so RESEARCH-mode rows (patientId=NULL) don't collide across
-- clinicians. A partial unique index below enforces the "one RESEARCH
-- thread per (org × clinician)" invariant the spec requires.
CREATE UNIQUE INDEX "CopilotConversation_orgId_patientId_clinicianOrgUserId_mode_key"
  ON "CopilotConversation"("orgId", "patientId", "clinicianOrgUserId", "mode");
CREATE UNIQUE INDEX "CopilotConversation_research_singleton_idx"
  ON "CopilotConversation"("orgId", "clinicianOrgUserId")
  WHERE "patientId" IS NULL AND "mode" = 'RESEARCH';
CREATE INDEX "CopilotConversation_orgId_clinicianOrgUserId_lastActivityAt_idx"
  ON "CopilotConversation"("orgId", "clinicianOrgUserId", "lastActivityAt");

ALTER TABLE "CopilotConversation"
  ADD CONSTRAINT "CopilotConversation_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CopilotConversation"
  ADD CONSTRAINT "CopilotConversation_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CopilotConversation"
  ADD CONSTRAINT "CopilotConversation_clinicianOrgUserId_fkey"
  FOREIGN KEY ("clinicianOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- CopilotMessage --------------------------------------------------
CREATE TABLE "CopilotMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourcesJson" JSONB,
    "toolCallsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CopilotMessage_conversationId_createdAt_idx"
  ON "CopilotMessage"("conversationId", "createdAt");

ALTER TABLE "CopilotMessage"
  ADD CONSTRAINT "CopilotMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "CopilotConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
