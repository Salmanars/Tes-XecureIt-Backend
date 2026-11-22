import type { Request, Response } from "express";
import { HttpError } from "../../middlewares/error.middleware";
import { asyncHandler } from "../../utils/async-handler";
import {
  createDocument,
  createDocumentVersion,
  deleteDocument,
  getDocument,
  getDocumentDownload,
  listDocumentVersions,
  listDocuments,
  updateDocument,
  updateDocumentStatus,
} from "./doc.service";
import {
  createDocumentVersionSchema,
  createDocumentSchema,
  updateDocumentSchema,
  updateDocumentStatusSchema,
} from "./doc.schema";

function getUserId(request: Request): string {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }
  return request.user.id;
}

function getUpload(request: Request) {
  if (!request.file || !request.documentUpload) {
    throw new HttpError(400, "FILE_REQUIRED", "A validated file upload is required");
  }

  return {
    buffer: request.file.buffer,
    originalName: request.documentUpload.originalName,
    extension: request.documentUpload.extension,
    mimeType: request.documentUpload.mimeType,
  };
}

export const listDocumentsController = asyncHandler(async (request, response) => {
  const user = request.user;
  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }
  const documents = await listDocuments(user.id, user.role);
  response.status(200).json({ success: true, data: { documents } });
});

export const createDocumentController = asyncHandler(async (request, response) => {
  const input = createDocumentSchema.parse(request.body);
  const document = await createDocument(
    getUserId(request),
    input,
    getUpload(request),
    request.ip,
  );
  response.status(201).json({ success: true, data: { document } });
});

export const getDocumentController = asyncHandler(async (request, response) => {
  const document = await getDocument(request.params.id);
  response.status(200).json({ success: true, data: { document } });
});

export const updateDocumentController = asyncHandler(async (request, response) => {
  const input = updateDocumentSchema.parse(request.body);
  const document = await updateDocument(
    request.params.id,
    getUserId(request),
    input,
    request.ip,
  );
  response.status(200).json({ success: true, data: { document } });
});

export const updateDocumentStatusController = asyncHandler(async (request, response) => {
  const input = updateDocumentStatusSchema.parse(request.body);
  const document = await updateDocumentStatus(
    request.params.id,
    getUserId(request),
    input,
    request.ip,
  );
  response.status(200).json({ success: true, data: { document } });
});

export const deleteDocumentController = asyncHandler(async (request, response) => {
  const result = await deleteDocument(
    request.params.id,
    getUserId(request),
    request.ip,
  );
  response.status(200).json({ success: true, data: result });
});

export const createDocumentVersionController = asyncHandler(
  async (request, response) => {
    const result = await createDocumentVersion(
      request.params.id,
      getUserId(request),
      getUpload(request),
      createDocumentVersionSchema.parse(request.body).changeNote,
      request.ip,
    );
    response.status(201).json({ success: true, data: result });
  },
);

export const listDocumentVersionsController = asyncHandler(
  async (request, response) => {
    const versions = await listDocumentVersions(request.params.id);
    response.status(200).json({ success: true, data: { versions } });
  },
);

export const downloadDocumentController = asyncHandler(
  async (request: Request, response: Response, next) => {
    const documentAccess = request.documentAccess;
    if (!documentAccess) {
      throw new HttpError(500, "DOCUMENT_ACCESS_MISSING", "Document authorization was not completed");
    }
    const download = await getDocumentDownload(
      request.params.id,
      getUserId(request),
      documentAccess.role,
      request.ip,
    );

    response.setHeader("Content-Type", download.mimeType);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.attachment(download.filename);
    response.download(download.filePath, download.filename, (error) => {
      if (!error) {
        return;
      }

      if (response.headersSent) {
        response.destroy(error);
        return;
      }

      next(error);
    });
  },
);
