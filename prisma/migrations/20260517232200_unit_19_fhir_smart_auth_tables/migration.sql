-- Unit 19 — FHIR / SMART on FHIR auth foundations (Wave 4 / F1).
-- Four new tables. F1 actively writes only FhirIdentity + FhirLaunchState;
-- PatientFhirIdentity + FhirCachedResource schemas ship now so the lockfile
-- and Prisma client are stable for F2 / F3 (Units 20 / 21).

-- CreateTable
CREATE TABLE "FhirIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "ehrSystem" TEXT NOT NULL,
    "fhirBaseUrl" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3),
    "launchPatientFhirId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FhirIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientFhirIdentity" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ehrSystem" TEXT NOT NULL,
    "fhirPatientId" TEXT NOT NULL,
    "fhirIdentifier" TEXT,
    "matchConfidence" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByOrgUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientFhirIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FhirCachedResource" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "ehrSystem" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "fhirResourceId" TEXT NOT NULL,
    "resource" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sensitivityLevel" TEXT,

    CONSTRAINT "FhirCachedResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FhirLaunchState" (
    "state" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "iss" TEXT NOT NULL,
    "launchToken" TEXT,
    "codeVerifier" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "ehrSystem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FhirLaunchState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE UNIQUE INDEX "FhirIdentity_clinicianOrgUserId_ehrSystem_key" ON "FhirIdentity"("clinicianOrgUserId", "ehrSystem");

-- CreateIndex
CREATE INDEX "FhirIdentity_orgId_ehrSystem_idx" ON "FhirIdentity"("orgId", "ehrSystem");

-- CreateIndex
CREATE UNIQUE INDEX "PatientFhirIdentity_ehrSystem_fhirPatientId_key" ON "PatientFhirIdentity"("ehrSystem", "fhirPatientId");

-- CreateIndex
CREATE INDEX "PatientFhirIdentity_patientId_ehrSystem_idx" ON "PatientFhirIdentity"("patientId", "ehrSystem");

-- CreateIndex
CREATE UNIQUE INDEX "FhirCachedResource_ehrSystem_resourceType_fhirResourceId_key" ON "FhirCachedResource"("ehrSystem", "resourceType", "fhirResourceId");

-- CreateIndex
CREATE INDEX "FhirCachedResource_patientId_resourceType_fetchedAt_idx" ON "FhirCachedResource"("patientId", "resourceType", "fetchedAt");

-- CreateIndex
CREATE INDEX "FhirLaunchState_expiresAt_idx" ON "FhirLaunchState"("expiresAt");

-- AddForeignKey
ALTER TABLE "FhirIdentity" ADD CONSTRAINT "FhirIdentity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirIdentity" ADD CONSTRAINT "FhirIdentity_clinicianOrgUserId_fkey" FOREIGN KEY ("clinicianOrgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientFhirIdentity" ADD CONSTRAINT "PatientFhirIdentity_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirCachedResource" ADD CONSTRAINT "FhirCachedResource_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
