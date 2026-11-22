ALTER TABLE "documents"
ADD COLUMN "status_note" TEXT;

ALTER TABLE "document_versions"
ADD COLUMN "change_note" TEXT;
