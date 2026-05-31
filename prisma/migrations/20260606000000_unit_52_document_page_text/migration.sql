-- Unit 52 follow-up — page-level verified document text.
-- Additive table. Original S3 document files remain retained; this stores the
-- searchable text layer per page so Cleo can retrieve page-specific source text.

CREATE TABLE "ExternalContextDocumentPage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "externalContextId" TEXT NOT NULL,
  "fileIndex" INTEGER NOT NULL DEFAULT 0,
  "pageNumber" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "textHash" TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalContextDocumentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalContextDocumentPage_externalContextId_fileIndex_pageNumber_key"
  ON "ExternalContextDocumentPage"("externalContextId", "fileIndex", "pageNumber");
CREATE INDEX "ExternalContextDocumentPage_externalContextId_pageNumber_idx"
  ON "ExternalContextDocumentPage"("externalContextId", "pageNumber");
CREATE INDEX "ExternalContextDocumentPage_orgId_idx"
  ON "ExternalContextDocumentPage"("orgId");

ALTER TABLE "ExternalContextDocumentPage"
  ADD CONSTRAINT "ExternalContextDocumentPage_externalContextId_fkey"
  FOREIGN KEY ("externalContextId") REFERENCES "ExternalContext"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
