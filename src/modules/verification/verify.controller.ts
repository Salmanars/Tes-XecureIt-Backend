import type { Request } from "express";
import { HttpError } from "../../middlewares/error.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { verifyDocumentIntegrity } from "./verify.service";

export const verifyDocumentController = asyncHandler(async (request: Request, response) => {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }

  const result = await verifyDocumentIntegrity(
    request.params.id,
    request.user.id,
    request.ip,
  );
  response.status(200).json({ success: true, data: result });
});
