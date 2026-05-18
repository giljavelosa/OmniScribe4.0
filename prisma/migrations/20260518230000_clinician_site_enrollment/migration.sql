-- Clinician multi-site enrollment.
-- Spec: context/specs/clinician-site-enrollment.md
--
-- Append-only (rule 1): one new table, two indexes, three FKs. No existing
-- tables touched. Org-wide roles (ORG_ADMIN, SUPER_ADMIN, PLATFORM_OWNER,
-- PLATFORM_OPS) implicitly cover every site via the authz layer and do NOT
-- need rows here.

-- CreateTable
CREATE TABLE "OrgUserSite" (
    "id" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "credentialNotes" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolledByOrgUserId" TEXT,

    CONSTRAINT "OrgUserSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgUserSite_siteId_idx" ON "OrgUserSite"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUserSite_orgUserId_siteId_key" ON "OrgUserSite"("orgUserId", "siteId");

-- AddForeignKey
ALTER TABLE "OrgUserSite"
  ADD CONSTRAINT "OrgUserSite_orgUserId_fkey"
  FOREIGN KEY ("orgUserId") REFERENCES "OrgUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUserSite"
  ADD CONSTRAINT "OrgUserSite_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUserSite"
  ADD CONSTRAINT "OrgUserSite_enrolledByOrgUserId_fkey"
  FOREIGN KEY ("enrolledByOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
