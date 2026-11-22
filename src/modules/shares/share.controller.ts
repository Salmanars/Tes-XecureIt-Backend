import type { Request } from "express";
import { HttpError } from "../../middlewares/error.middleware";
import { asyncHandler } from "../../utils/async-handler";
import {
  acceptInvitation,
  createShareOrInvitation,
  listInvitations,
  listShares,
  removeShare,
  revokeInvitation,
  searchShareCandidates,
  updateShare,
} from "./share.service";
import {
  acceptInvitationSchema,
  createShareSchema,
  shareCandidatesQuerySchema,
  updateShareSchema,
} from "./share.schema";

function getActor(request: Request) {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }
  if (!request.documentAccess) {
    throw new HttpError(500, "DOCUMENT_ACCESS_MISSING", "Document authorization was not completed");
  }
  return {
    id: request.user.id,
    role: request.documentAccess.role,
  };
}

export const createShareController = asyncHandler(async (request, response) => {
  const actor = getActor(request);
  const result = await createShareOrInvitation(
    request.params.id,
    actor.id,
    actor.role,
    createShareSchema.parse(request.body),
    request.ip,
  );
  response
    .status(
      result.type === "INVITATION"
        ? 202
        : result.created
          ? 201
          : 200,
    )
    .json({ success: true, data: result });
});

export const listSharesController = asyncHandler(async (request, response) => {
  const shares = await listShares(request.params.id);
  response.status(200).json({ success: true, data: { shares } });
});

export const searchShareCandidatesController = asyncHandler(async (request, response) => {
  const { q } = shareCandidatesQuerySchema.parse(request.query);
  const users = await searchShareCandidates(request.params.id, q);
  response.status(200).json({ success: true, data: { users } });
});

export const updateShareController = asyncHandler(async (request, response) => {
  const actor = getActor(request);
  const share = await updateShare(
    request.params.id,
    request.params.shareId,
    actor.id,
    actor.role,
    updateShareSchema.parse(request.body),
    request.ip,
  );
  response.status(200).json({ success: true, data: { share } });
});

export const removeShareController = asyncHandler(async (request, response) => {
  const actor = getActor(request);
  const result = await removeShare(
    request.params.id,
    request.params.shareId,
    actor.id,
    actor.role,
    request.ip,
  );
  response.status(200).json({ success: true, data: result });
});

export const listInvitationsController = asyncHandler(async (request, response) => {
  const actor = getActor(request);
  const invitations = await listInvitations(
    request.params.id,
    actor.id,
    request.ip,
  );
  response.status(200).json({ success: true, data: { invitations } });
});

export const revokeInvitationController = asyncHandler(async (request, response) => {
  const actor = getActor(request);
  const result = await revokeInvitation(
    request.params.id,
    request.params.invitationId,
    actor.id,
    actor.role,
    request.ip,
  );
  response.status(200).json({ success: true, data: result });
});

export const acceptInvitationController = asyncHandler(async (request, response) => {
  if (!request.user) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
  }
  const { token } = acceptInvitationSchema.parse(request.body);
  const result = await acceptInvitation(request.user, token, request.ip);
  response.status(200).json({ success: true, data: result });
});
