-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByOrgUserId" TEXT;

-- RenameIndex
ALTER INDEX "ExternalContextDocumentPage_externalContextId_fileIndex_pageNum" RENAME TO "ExternalContextDocumentPage_externalContextId_fileIndex_pag_key";
