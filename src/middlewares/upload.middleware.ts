import multer from "multer";
import type { Request, RequestHandler } from "express";
import { HttpError } from "./error.middleware";
import {
  getDeclaredDocumentType,
  hasValidDocumentSignature,
  sanitizeOriginalFilename,
  type SupportedDocumentType,
} from "../utils/file-validation.util";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

declare global {
  namespace Express {
    interface Request {
      documentUpload?: SupportedDocumentType & { originalName: string };
    }
  }
}

const multipartUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 4,
    fieldSize: 8 * 1024,
    parts: 5,
  },
  fileFilter: (_request, file, callback) => {
    if (!getDeclaredDocumentType(file.originalname, file.mimetype)) {
      callback(
        new HttpError(
          415,
          "UNSUPPORTED_FILE_TYPE",
          "Only PDF, DOCX, TXT, and CSV files with matching MIME types are accepted",
        ),
      );
      return;
    }

    callback(null, true);
  },
}).single("file");

export const documentUpload: RequestHandler = (
  request: Request,
  response,
  next,
) => {
  multipartUpload(request, response, (error) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      next(
        new HttpError(
          tooLarge ? 413 : 400,
          tooLarge ? "FILE_TOO_LARGE" : "INVALID_MULTIPART_UPLOAD",
          tooLarge
            ? "File size must not exceed 10 MB"
            : "The multipart upload could not be processed",
        ),
      );
      return;
    }

    if (error) {
      next(error);
      return;
    }

    const file = request.file;
    if (!file) {
      next(new HttpError(400, "FILE_REQUIRED", "A file must be uploaded in the file field"));
      return;
    }

    const fileType = getDeclaredDocumentType(file.originalname, file.mimetype);
    if (!fileType || !hasValidDocumentSignature(fileType.extension, file.buffer)) {
      next(
        new HttpError(
          415,
          "FILE_SIGNATURE_MISMATCH",
          "The file extension, MIME type, and file signature must match",
        ),
      );
      return;
    }

    request.documentUpload = {
      ...fileType,
      originalName: sanitizeOriginalFilename(file.originalname),
    };
    next();
  });
};
