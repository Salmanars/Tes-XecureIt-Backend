import { DocumentRole } from "@prisma/client";
import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireDocumentRole } from "../../middlewares/rbac.middleware";
import { verifyDocumentController } from "./verify.controller";

export const verificationRouter = Router();

verificationRouter.use(authenticate);
verificationRouter.get(
  "/documents/:id/verify",
  requireDocumentRole(DocumentRole.VIEWER),
  verifyDocumentController,
);
