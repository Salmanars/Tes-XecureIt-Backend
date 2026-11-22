import { z } from "zod";
import type { Request } from "express";
import { prisma } from "../../config/database";
import { HttpError } from "../../middlewares/error.middleware";
import { createEventStreamToken } from "../../middlewares/auth.middleware";
import { roleAtLeast } from "../../middlewares/rbac.middleware";
import { asyncHandler } from "../../utils/async-handler";
import {
  publishDocumentActivity,
  subscribeToDocumentEvents,
} from "../../realtime/collaboration.gateway";
import { DocumentRole } from "@prisma/client";

const activitySchema = z.object({
  action: z.enum(["active", "editing"]),
});

function getUserId(request: Request): string {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }
  return request.user.id;
}

export const createEventStreamTokenController = asyncHandler(
  async (request, response) => {
    const user = request.user;
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const token = createEventStreamToken(user, request.params.id);
    response.setHeader("Cache-Control", "no-store, private");
    response.status(201).json({
      success: true,
      data: { token, tokenType: "Bearer", expiresInSeconds: 300 },
    });
  },
);

export const documentEventsController = asyncHandler(
  async (request, response) => {
    const userId = getUserId(request);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "User account is no longer available");
    }

    response.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.flushHeaders();
    response.write("retry: 5000\n\n");

    const unsubscribe = subscribeToDocumentEvents(
      request.params.id,
      user,
      response,
    );
    const cleanup = () => {
      request.off("aborted", cleanup);
      unsubscribe();
    };
    request.once("aborted", cleanup);
    response.once("close", cleanup);
  },
);

export const publishDocumentActivityController = asyncHandler(
  async (request, response) => {
    const actorId = getUserId(request);
    const { action } = activitySchema.parse(request.body);

    if (
      action === "editing" &&
      (!request.documentAccess ||
        !roleAtLeast(request.documentAccess.role, DocumentRole.EDITOR))
    ) {
      throw new HttpError(403, "FORBIDDEN", "Editor access is required to announce editing");
    }

    const user = await prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    if (!user) {
      throw new HttpError(401, "UNAUTHORIZED", "User account is no longer available");
    }

    publishDocumentActivity(
      request.params.id,
      actorId,
      action === "editing" ? "editing" : "active",
      user.name,
    );
    response.status(202).json({ success: true, data: { published: true } });
  },
);
