-- Unit 35: Per-org LLM cost rollup
-- Adds Organization.monthlyLlmBudgetUsd + new LlmCallLog (per-call)
-- and OrgLlmCostDaily (rollup cache) tables. LlmCallLog is PHI-free
-- by construction (model id + token counts + cost + caller-supplied
-- surface tag; never prompts or responses).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "monthlyLlmBudgetUsd" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "LlmCallLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "noteId" TEXT,
    "surface" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,4) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "stub" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallLog_orgId_createdAt_idx" ON "LlmCallLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCallLog_surface_idx" ON "LlmCallLog"("surface");

-- AddForeignKey
ALTER TABLE "LlmCallLog" ADD CONSTRAINT "LlmCallLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OrgLlmCostDaily" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "totalTokensIn" INTEGER NOT NULL DEFAULT 0,
    "totalTokensOut" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgLlmCostDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgLlmCostDaily_orgId_day_idx" ON "OrgLlmCostDaily"("orgId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "OrgLlmCostDaily_orgId_day_key" ON "OrgLlmCostDaily"("orgId", "day");

-- AddForeignKey
ALTER TABLE "OrgLlmCostDaily" ADD CONSTRAINT "OrgLlmCostDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
