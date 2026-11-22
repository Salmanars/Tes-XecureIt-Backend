import { DocumentRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireDocumentRole } from "../../middlewares/rbac.middleware";
import { listAuditEntriesController } from "./audit.controller";

export const auditRouter = Router();

auditRouter.use(authenticate);
auditRouter.get(
  "/documents/:id/audit",
  requireDocumentRole(DocumentRole.VIEWER),
  listAuditEntriesController,
);
