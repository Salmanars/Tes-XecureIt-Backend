import { DocumentRole, Role } from "@prisma/client";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "../config/database";
import { HttpError } from "./error.middleware";
import {
  effectiveDocumentRole,
  roleAtLeast,
} from "../utils/role-policy.util";

export { roleAtLeast };

export interface DocumentAccess {
  documentId: string;
  ownerId: string;
  role: DocumentRole;
}

declare global {
  namespace Express {
    interface Request {
      documentAccess?: DocumentAccess;
    }
  }
}

export function requireUserRole(requiredRole: Role): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication is required" },
      });
      return;
    }

    if (!roleAtLeast(request.user.role, requiredRole)) {
      response.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Insufficient account permissions" },
      });
      return;
    }
    next();
  };
}

export function requireDocumentRole(
  requiredRole: DocumentRole,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication is required" },
      });
      return;
    }
    const user = request.user;

    const documentId = request.params.id;
    if (!documentId) {
      next(new HttpError(400, "DOCUMENT_ID_REQUIRED", "Document ID is required"));
      return;
    }

    void prisma.document
      .findUnique({
        where: { id: documentId },
        select: {
          id: true,
          ownerId: true,
          shares: {
            where: { userId: user.id },
            select: { role: true },
            take: 1,
          },
        },
      })
      .then((document) => {
        if (!document) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Document was not found" },
          });
          return;
        }

        const role =
          user.role === Role.OWNER
            ? DocumentRole.OWNER
            : document.ownerId === user.id
            ? DocumentRole.OWNER
            : document.shares[0]?.role;
        if (!role) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Document was not found" },
          });
          return;
        }

        if (
          !roleAtLeast(user.role, requiredRole) ||
          !roleAtLeast(role, requiredRole)
        ) {
          response.status(403).json({
            success: false,
            error: { code: "FORBIDDEN", message: "Insufficient document permissions" },
          });
          return;
        }

        request.documentAccess = {
          documentId: document.id,
          ownerId: document.ownerId,
          role: effectiveDocumentRole(user.role, role),
        };
        next();
      })
      .catch(next);
  };
}
