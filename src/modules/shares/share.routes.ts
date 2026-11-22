import { DocumentRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireDocumentRole } from "../../middlewares/rbac.middleware";
import {
  acceptInvitationController,
  createShareController,
  listInvitationsController,
  listSharesController,
  removeShareController,
  revokeInvitationController,
  searchShareCandidatesController,
  updateShareController,
} from "./share.controller";

export const shareRouter = Router();

shareRouter.use(authenticate);
shareRouter.post("/invitations/accept", acceptInvitationController);
shareRouter.post(
  "/documents/:id/shares",
  requireDocumentRole(DocumentRole.EDITOR),
  createShareController,
);
shareRouter.get(
  "/documents/:id/share-candidates",
  requireDocumentRole(DocumentRole.EDITOR),
  searchShareCandidatesController,
);
shareRouter.get(
  "/documents/:id/shares",
  requireDocumentRole(DocumentRole.EDITOR),
  listSharesController,
);
shareRouter.patch(
  "/documents/:id/shares/:shareId",
  requireDocumentRole(DocumentRole.EDITOR),
  updateShareController,
);
shareRouter.delete(
  "/documents/:id/shares/:shareId",
  requireDocumentRole(DocumentRole.EDITOR),
  removeShareController,
);
shareRouter.get(
  "/documents/:id/invitations",
  requireDocumentRole(DocumentRole.EDITOR),
  listInvitationsController,
);
shareRouter.delete(
  "/documents/:id/invitations/:invitationId",
  requireDocumentRole(DocumentRole.EDITOR),
  revokeInvitationController,
);
