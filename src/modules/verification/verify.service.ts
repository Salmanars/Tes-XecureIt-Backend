import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { HttpError } from "../../middlewares/error.middleware";
import { compareHashes, hashFile } from "../../utils/hash.util";
import { resolvePrivateFile } from "../../utils/storage.util";
import { recordAuditEntry } from "../audit/audit.service";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function verifyDocumentIntegrity(
  documentId: string,
  actorId: string,
  ipAddress?: string,
) {
  const { document, version, storedHash } = await prisma.$transaction(
    async (transaction) => {
      const currentDocument = await transaction.document.findUnique({
        where: { id: documentId },
        select: { id: true, storagePath: true },
      });
      if (!currentDocument) {
        throw new HttpError(404, "NOT_FOUND", "Document was not found");
      }

      const currentVersion = await transaction.documentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          hash: true,
          createdAt: true,
        },
      });
      if (!currentVersion) {
        throw new HttpError(409, "DOCUMENT_VERSION_MISSING", "Document has no version to verify");
      }

      const currentHashRecord = await transaction.hashRecord.findFirst({
        where: {
          documentId,
          documentVersionId: currentVersion.id,
          algorithm: "SHA-256",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { hash: true },
      });
      if (!currentHashRecord) {
        throw new HttpError(409, "HASH_RECORD_MISSING", "Document version has no stored integrity hash");
      }

      return {
        document: currentDocument,
        version: currentVersion,
        storedHash: currentHashRecord,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  let actualHash: string | null = null;
  let fileMissing = false;
  try {
    actualHash = await hashFile(resolvePrivateFile(document.storagePath));
  } catch (error) {
    if (isMissingFile(error)) {
      fileMissing = true;
    } else {
      throw error;
    }
  }

  const valid = actualHash !== null && compareHashes(actualHash, storedHash.hash);
  const status = fileMissing ? "FILE_MISSING" : valid ? "VALID" : "MISMATCH";

  await prisma.$transaction((transaction) =>
    recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: valid ? "DOCUMENT_VERIFICATION_PASSED" : "DOCUMENT_VERIFICATION_FAILED",
      ipAddress,
      details: {
        versionId: version.id,
        versionNumber: version.versionNumber,
        status,
        expectedHash: storedHash.hash,
        actualHash,
      },
    }),
  );

  return {
    valid,
    status,
    message: valid
      ? "Document integrity verified"
      : fileMissing
        ? "The current document file is missing"
        : "Document content does not match its stored SHA-256 hash",
    version: {
      id: version.id,
      number: version.versionNumber,
      createdAt: version.createdAt,
    },
    expectedHash: storedHash.hash,
    actualHash,
    verifiedAt: new Date(),
  };
}
