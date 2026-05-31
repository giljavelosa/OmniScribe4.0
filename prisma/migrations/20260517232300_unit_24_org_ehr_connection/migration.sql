-- Unit 24 / F6 — per-org EHR connection. Schema only in v1; no callers
-- read from this table yet. Wires in when the first customer demands
-- Epic / Cerner support. Credentials encrypted via the same AES-256-GCM
-- envelope as FhirIdentity tokens.

-- CreateTable
CREATE TABLE "OrgEhrConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ehrSystem" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "fhirBaseUrl" TEXT NOT NULL,
    "clientIdEnc" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEhrConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgEhrConnection_orgId_ehrSystem_key" ON "OrgEhrConnection"("orgId", "ehrSystem");

-- CreateIndex
CREATE INDEX "OrgEhrConnection_orgId_idx" ON "OrgEhrConnection"("orgId");

-- AddForeignKey
ALTER TABLE "OrgEhrConnection" ADD CONSTRAINT "OrgEhrConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
