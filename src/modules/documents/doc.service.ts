import { DocumentRole, Prisma, Role } from "@prisma/client";
import { stat } from "node:fs/promises";
import { prisma } from "../../config/database";
import { HttpError } from "../../middlewares/error.middleware";
import { effectiveDocumentRole } from "../../utils/role-policy.util";
import { recordAuditEntry } from "../audit/audit.service";
import { hashFile } from "../../utils/hash.util";
import { scanFile } from "../../utils/scanner.util";
import {
  removePrivateFile,
  resolvePrivateFile,
  storePrivateFile,
} from "../../utils/storage.util";
import {
  closeDocumentEventStreams,
  publishDocumentActivity,
} from "../../realtime/collaboration.gateway";
import type { SupportedDocumentType } from "../../utils/file-validation.util";
import type { CreateDocumentInput, UpdateDocumentInput, UpdateDocumentStatusInput } from "./doc.schema";

export interface DocumentUploadInput {
  buffer: Buffer;
  originalName: string;
  extension: SupportedDocumentType["extension"];
  mimeType: string;
}

type CreatedDocumentVersion = Prisma.DocumentVersionGetPayload<{
  select: {
    id: true;
    versionNumber: true;
    hash: true;
    scanStatus: true;
    scanDetail: true;
    changeNote: true;
    createdAt: true;
    createdById: true;
  };
}>;

const documentSummarySelect = {
  id: true,
  ownerId: true,
  title: true,
  description: true,
  status: true,
  statusNote: true,
  filename: true,
  mimeType: true,
  size: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { versions: true, shares: true } },
} as const;

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function removeStoredFileAfterFailure(
  storageKey: string,
  documentId?: string,
): Promise<void> {
  try {
    await removePrivateFile(storageKey);
  } catch (cleanupError) {
    console.error("Could not clean up an uncommitted private upload", {
      documentId,
      cleanupError,
    });
  }
}

export async function listDocuments(userId: string, userRole: Role) {
  const documents = await prisma.document.findMany({
    where: userRole === Role.OWNER
      ? {}
      : {
          OR: [
            { ownerId: userId },
            { shares: { some: { userId } } },
          ],
        },
    include: {
      shares: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { scanStatus: true },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });

  return documents.map(({ shares, versions, storagePath: _storagePath, ...document }) => ({
    ...document,
    scanStatus: versions[0]?.scanStatus,
    role: effectiveDocumentRole(
      userRole,
      userRole === Role.OWNER
        ? DocumentRole.OWNER
        : document.ownerId === userId
        ? DocumentRole.OWNER
        : (shares[0]?.role ?? DocumentRole.VIEWER),
    ),
  }));
}

export async function getDocument(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      ...documentSummarySelect,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { scanStatus: true },
      },
      owner: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!document) {
    throw new HttpError(404, "NOT_FOUND", "Document was not found");
  }

  const { versions, ...summary } = document;
  return { ...summary, scanStatus: versions[0]?.scanStatus };
}

export async function createDocument(
  ownerId: string,
  input: CreateDocumentInput,
  upload: DocumentUploadInput,
  ipAddress?: string,
) {
  const storagePath = await storePrivateFile(upload.buffer, upload.extension);
  const filePath = resolvePrivateFile(storagePath);

  try {
    const [digest, scanResult] = await Promise.all([
      hashFile(filePath),
      scanFile(filePath),
    ]);
    return await prisma.$transaction(async (transaction) => {
      const document = await transaction.document.create({
        data: {
          ownerId,
          title: input.title,
          description: input.description,
          filename: upload.originalName,
          storagePath,
          mimeType: upload.mimeType,
          size: upload.buffer.length,
        },
        select: documentSummarySelect,
      });
      const version = await transaction.documentVersion.create({
        data: {
          documentId: document.id,
          createdById: ownerId,
          versionNumber: 1,
          storagePath,
          hash: digest,
          scanStatus: scanResult.status,
          scanDetail: scanResult.message,
        },
      });
      await transaction.hashRecord.create({
        data: {
          documentId: document.id,
          documentVersionId: version.id,
          algorithm: "SHA-256",
          hash: digest,
        },
      });
      await recordAuditEntry(transaction, {
        documentId: document.id,
        actorId: ownerId,
        action: "DOCUMENT_FILE_SCANNED",
        ipAddress,
        details: {
          versionNumber: 1,
          status: scanResult.status,
          detail: scanResult.message,
        },
      });
      await recordAuditEntry(transaction, {
        documentId: document.id,
        actorId: ownerId,
        action: "DOCUMENT_CREATED",
        ipAddress,
        details: {
          filename: upload.originalName,
          versionNumber: 1,
          scanStatus: scanResult.status,
        },
      });

      return { ...document, scanStatus: scanResult.status };
    });
  } catch (error) {
    await removeStoredFileAfterFailure(storagePath);
    throw error;
  }
}

export async function updateDocument(
  documentId: string,
  actorId: string,
  input: UpdateDocumentInput,
  ipAddress?: string,
) {
  const document = await prisma.$transaction(async (transaction) => {
    const document = await transaction.document.update({
      where: { id: documentId },
      data: { title: input.title, description: input.description },
      select: documentSummarySelect,
    });
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_UPDATED",
      ipAddress,
      details: { fields: Object.keys(input) },
    });
    return document;
  });
  publishDocumentActivity(documentId, actorId, "document.updated");
  return document;
}

export async function updateDocumentStatus(
  documentId: string,
  actorId: string,
  input: UpdateDocumentStatusInput,
  ipAddress?: string,
) {
  const document = await prisma.$transaction(async (transaction) => {
    if (input.status === "VERIFIED") {
      const latestVersion = await transaction.documentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: "desc" },
        select: { scanStatus: true },
      });
      if (latestVersion?.scanStatus === "INFECTED") {
        throw new HttpError(409, "INFECTED_FILE", "An infected document version cannot be verified");
      }
    }
    const updated = await transaction.document.update({
      where: { id: documentId },
      data: { status: input.status, statusNote: input.statusNote ?? null },
      select: documentSummarySelect,
    });
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: `DOCUMENT_${input.status}`,
      ipAddress,
      details: { status: input.status, statusNote: input.statusNote ?? null },
    });
    return updated;
  });
  const activity = {
    VERIFIED: "document.verified",
    REJECTED: "document.rejected",
    REVOKED: "document.revoked",
  } as const;
  const activityAction = activity[input.status];
  publishDocumentActivity(documentId, actorId, activityAction);
  return document;
}

export async function createDocumentVersion(
  documentId: string,
  actorId: string,
  upload: DocumentUploadInput,
  changeNote?: string,
  ipAddress?: string,
) {
  const currentDocument = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  });
  if (!currentDocument) {
    throw new HttpError(404, "NOT_FOUND", "Document was not found");
  }

  const storagePath = await storePrivateFile(upload.buffer, upload.extension);
  const filePath = resolvePrivateFile(storagePath);

  let result: {
    document: Prisma.DocumentGetPayload<{ select: typeof documentSummarySelect }>;
    version: CreatedDocumentVersion;
  };
  try {
    const [digest, scanResult] = await Promise.all([
      hashFile(filePath),
      scanFile(filePath),
    ]);
    result = await prisma.$transaction(
      async (transaction) => {
        await transaction.document.update({
          where: { id: documentId },
          data: { status: "PENDING_VERIFICATION", statusNote: null },
          select: { id: true },
        });
        const latestVersion = await transaction.documentVersion.findFirst({
          where: { documentId },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });
        const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
        const version = await transaction.documentVersion.create({
          data: {
            documentId,
            createdById: actorId,
            versionNumber,
            storagePath,
            hash: digest,
            scanStatus: scanResult.status,
            scanDetail: scanResult.message,
            changeNote,
          },
          select: {
            id: true,
            versionNumber: true,
            hash: true,
            scanStatus: true,
            scanDetail: true,
            changeNote: true,
            createdAt: true,
            createdById: true,
          },
        });
        const document = await transaction.document.update({
          where: { id: documentId },
          data: {
            filename: upload.originalName,
            storagePath,
            mimeType: upload.mimeType,
            size: upload.buffer.length,
            status: "PENDING_VERIFICATION",
            statusNote: null,
          },
          select: documentSummarySelect,
        });
        await transaction.hashRecord.create({
          data: {
            documentId,
            documentVersionId: version.id,
            algorithm: "SHA-256",
            hash: digest,
          },
        });
        await recordAuditEntry(transaction, {
          documentId,
          actorId,
          action: "DOCUMENT_FILE_SCANNED",
          ipAddress,
          details: {
            versionNumber,
            status: scanResult.status,
            detail: scanResult.message,
          },
        });
        await recordAuditEntry(transaction, {
          documentId,
          actorId,
          action: "DOCUMENT_VERSION_CREATED",
          ipAddress,
          details: {
            versionId: version.id,
            versionNumber,
            scanStatus: scanResult.status,
          },
        });

        return { document, version };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    await removeStoredFileAfterFailure(storagePath, documentId);
    throw error;
  }

  publishDocumentActivity(documentId, actorId, "document.version.created");
  return result;
}

export async function listDocumentVersions(documentId: string) {
  return prisma.documentVersion.findMany({
    where: { documentId },
    select: {
      id: true,
      versionNumber: true,
      hash: true,
      changeNote: true,
      scanStatus: true,
      scanDetail: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { versionNumber: "desc" },
  });
}

export async function getDocumentDownload(
  documentId: string,
  actorId: string,
  actorRole: DocumentRole,
  ipAddress?: string,
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      status: true,
      filename: true,
      mimeType: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          storagePath: true,
          scanStatus: true,
          scanDetail: true,
        },
      },
    },
  });
  if (!document) {
    throw new HttpError(404, "NOT_FOUND", "Document was not found");
  }

  if (actorRole === DocumentRole.VIEWER && document.status !== "VERIFIED") {
    await prisma.$transaction((transaction) =>
      recordAuditEntry(transaction, {
        documentId,
        actorId,
        action: "DOCUMENT_DOWNLOAD_BLOCKED_UNAPPROVED",
        ipAddress,
        details: { status: document.status },
      }),
    );
    throw new HttpError(
      409,
      "DOCUMENT_NOT_APPROVED",
      "This document is not available to viewers until the owner approves it",
    );
  }

  const version = document.versions[0];
  if (!version) {
    throw new HttpError(409, "DOCUMENT_VERSION_MISSING", "Document has no version to download");
  }
  if (version.scanStatus === "INFECTED") {
    await prisma.$transaction((transaction) =>
      recordAuditEntry(transaction, {
        documentId,
        actorId,
        action: "DOCUMENT_DOWNLOAD_BLOCKED_INFECTED",
        ipAddress,
        details: { detail: version.scanDetail },
      }),
    );
    throw new HttpError(
      423,
      "INFECTED_FILE",
      "This document version is infected and cannot be downloaded",
    );
  }

  const filePath = resolvePrivateFile(version.storagePath);
  try {
    await stat(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new HttpError(404, "DOCUMENT_FILE_MISSING", "The private document file is missing");
    }
    throw error;
  }

  await prisma.$transaction((transaction) =>
    recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_DOWNLOAD_REQUESTED",
      ipAddress,
    }),
  );

  return { filePath, filename: document.filename, mimeType: document.mimeType };
}

export async function deleteDocument(
  documentId: string,
  actorId: string,
  ipAddress?: string,
) {
  const storageKeys = await prisma.$transaction(async (transaction) => {
    const document = await transaction.document.findUnique({
      where: { id: documentId },
      select: {
        storagePath: true,
        versions: { select: { storagePath: true } },
      },
    });
    if (!document) {
      throw new HttpError(404, "NOT_FOUND", "Document was not found");
    }

    const keys = [
      ...new Set([
        document.storagePath,
        ...document.versions.map((version) => version.storagePath),
      ]),
    ];
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_DELETED",
      ipAddress,
    });
    await transaction.document.delete({ where: { id: documentId } });
    return keys;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  closeDocumentEventStreams(documentId, actorId);

  let cleanupPending = false;
  for (const storageKey of storageKeys) {
    try {
      await removePrivateFile(storageKey);
    } catch (error) {
      cleanupPending = true;
      console.error("Could not remove a deleted document's private file", {
        documentId,
        error,
      });
    }
  }

  return { deleted: true, cleanupPending };
}
