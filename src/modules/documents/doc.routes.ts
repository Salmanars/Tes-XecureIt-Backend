import { DocumentRole, Role } from "@prisma/client";
import { Router } from "express";
import {
  authenticate,
  authenticateEventStream,
} from "../../middlewares/auth.middleware";
import {
  requireDocumentRole,
  requireUserRole,
} from "../../middlewares/rbac.middleware";
import { documentUpload } from "../../middlewares/upload.middleware";
import {
  createEventStreamTokenController,
  documentEventsController,
  publishDocumentActivityController,
} from "./events.controller";
import {
  createDocumentController,
  createDocumentVersionController,
  deleteDocumentController,
  downloadDocumentController,
  getDocumentController,
  listDocumentVersionsController,
  listDocumentsController,
  updateDocumentController,
  updateDocumentStatusController,
} from "./doc.controller";

export const docRouter = Router();

docRouter.get(
  "/:id/events",
  authenticateEventStream,
  requireDocumentRole(DocumentRole.VIEWER),
  documentEventsController,
);
docRouter.post(
  "/:id/events/token",
  authenticate,
  requireDocumentRole(DocumentRole.VIEWER),
  createEventStreamTokenController,
);
docRouter.post(
  "/:id/events",
  authenticate,
  requireDocumentRole(DocumentRole.VIEWER),
  publishDocumentActivityController,
);

docRouter.use(authenticate);
docRouter.get("/", listDocumentsController);
docRouter.post(
  "/",
  requireUserRole(Role.EDITOR),
  documentUpload,
  createDocumentController,
);
docRouter.get(
  "/:id/download",
  requireDocumentRole(DocumentRole.VIEWER),
  downloadDocumentController,
);
docRouter.get(
  "/:id/versions",
  requireDocumentRole(DocumentRole.VIEWER),
  listDocumentVersionsController,
);
docRouter.post(
  "/:id/versions",
  requireDocumentRole(DocumentRole.EDITOR),
  documentUpload,
  createDocumentVersionController,
);
docRouter.get(
  "/:id",
  requireDocumentRole(DocumentRole.VIEWER),
  getDocumentController,
);
docRouter.patch(
  "/:id/status",
  requireDocumentRole(DocumentRole.OWNER),
  updateDocumentStatusController,
);
docRouter.patch(
  "/:id",
  requireDocumentRole(DocumentRole.EDITOR),
  updateDocumentController,
);
docRouter.delete(
  "/:id",
  requireDocumentRole(DocumentRole.OWNER),
  deleteDocumentController,
);
