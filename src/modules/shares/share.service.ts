import { randomBytes } from "node:crypto";
import { DocumentRole, InvitationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { HttpError } from "../../middlewares/error.middleware";
import { hashBuffer } from "../../utils/hash.util";
import { sendInvitationEmail } from "../../utils/email.util";
import {
  assertCanGrantRole,
  assertCanManageAssignedRole,
  mostPrivilegedRole,
} from "../../utils/role-policy.util";
import { recordAuditEntry } from "../audit/audit.service";
import { closeUserDocumentEventStreams } from "../../realtime/collaboration.gateway";
import type { CreateShareInput, UpdateShareInput } from "./share.schema";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

async function revokePendingInvitations(
  transaction: Prisma.TransactionClient,
  documentId: string,
  email: string,
  actorId: string,
  ipAddress?: string,
): Promise<void> {
  const invitations = await transaction.documentInvitation.findMany({
    where: { documentId, email, status: InvitationStatus.PENDING },
    select: { id: true, expiresAt: true },
  });

  for (const invitation of invitations) {
    const expired = invitation.expiresAt <= new Date();
    const updated = await transaction.documentInvitation.updateMany({
      where: { id: invitation.id, status: InvitationStatus.PENDING },
      data: {
        status: expired ? InvitationStatus.EXPIRED : InvitationStatus.REVOKED,
      },
    });
    if (updated.count > 0) {
      await recordAuditEntry(transaction, {
        documentId,
        actorId,
        action: expired
          ? "DOCUMENT_INVITATION_EXPIRED"
          : "DOCUMENT_INVITATION_REVOKED",
        ipAddress,
        details: expired ? undefined : { reason: "direct_share" },
      });
    }
  }
}

export async function createShareOrInvitation(
  documentId: string,
  actorId: string,
  actorRole: DocumentRole,
  input: CreateShareInput,
  ipAddress?: string,
) {
  const role = input.role;
  assertCanGrantRole(actorRole, role);

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, ownerId: true, title: true },
  });
  if (!document) {
    throw new HttpError(404, "NOT_FOUND", "Document was not found");
  }

  const recipient = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (recipient) {
    if (recipient.id === document.ownerId) {
      throw new HttpError(409, "OWNER_ALREADY_HAS_ACCESS", "The document owner already has access");
    }

    return prisma.$transaction(async (transaction) => {
      await revokePendingInvitations(
        transaction,
        documentId,
        input.email,
        actorId,
        ipAddress,
      );
      const existing = await transaction.documentShare.findUnique({
        where: {
          documentId_userId: { documentId, userId: recipient.id },
        },
        select: { role: true },
      });
      if (existing) {
        assertCanManageAssignedRole(actorRole, existing.role);
      }
      const share = await transaction.documentShare.upsert({
        where: {
          documentId_userId: { documentId, userId: recipient.id },
        },
        create: { documentId, userId: recipient.id, role },
        update: { role },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      });
      await recordAuditEntry(transaction, {
        documentId,
        actorId,
        action: "DOCUMENT_SHARE_CREATED_OR_UPDATED",
        ipAddress,
        details: { email: input.email, role },
      });

      return { type: "SHARE" as const, created: !existing, share };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    throw new HttpError(
      503,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "SMTP_HOST and SMTP_FROM must be configured to invite an unregistered email",
    );
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashBuffer(Buffer.from(rawToken, "utf8"));
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  const invitation = await prisma.$transaction(async (transaction) => {
    await revokePendingInvitations(
      transaction,
      documentId,
      input.email,
      actorId,
      ipAddress,
    );
    const created = await transaction.documentInvitation.create({
      data: {
        documentId,
        email: input.email,
        role,
        invitedById: actorId,
        tokenHash,
        expiresAt,
      },
      select: {
        id: true,
        documentId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_INVITATION_CREATED",
      ipAddress,
      details: { email: input.email, role, expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  const invitationUrl = new URL("/invitations/accept", env.APP_FRONTEND_URL);
  invitationUrl.searchParams.set("token", rawToken);

  try {
    await sendInvitationEmail({
      email: input.email,
      documentTitle: document.title,
      role,
      invitationUrl: invitationUrl.toString(),
      expiresAt,
    });
  } catch (error) {
    try {
      await prisma.$transaction(async (transaction) => {
        const revoked = await transaction.documentInvitation.updateMany({
          where: {
            id: invitation.id,
            status: InvitationStatus.PENDING,
          },
          data: { status: InvitationStatus.REVOKED },
        });
        if (revoked.count > 0) {
          await recordAuditEntry(transaction, {
            documentId,
            actorId,
            action: "DOCUMENT_INVITATION_DELIVERY_FAILED",
            ipAddress,
            details: { invitationId: invitation.id },
          });
        }
      });
    } catch (revocationError) {
      console.error("Could not revoke an undelivered document invitation", {
        invitationId: invitation.id,
        revocationError,
      });
    }

    console.error("Could not deliver a document invitation", {
      invitationId: invitation.id,
      error,
    });
    throw new HttpError(
      502,
      "INVITATION_DELIVERY_FAILED",
      "The invitation could not be delivered",
    );
  }

  return { type: "INVITATION" as const, invitation };
}

export async function listShares(documentId: string) {
  return prisma.documentShare.findMany({
    where: { documentId },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function searchShareCandidates(documentId: string, search: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true },
  });
  if (!document) {
    throw new HttpError(404, "NOT_FOUND", "Document was not found");
  }

  return prisma.user.findMany({
    where: {
      id: { not: document.ownerId },
      shares: { none: { documentId } },
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 10,
  });
}

export async function updateShare(
  documentId: string,
  shareId: string,
  actorId: string,
  actorRole: DocumentRole,
  input: UpdateShareInput,
  ipAddress?: string,
) {
  const newRole = input.role;
  assertCanGrantRole(actorRole, newRole);
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.documentShare.findFirst({
      where: { id: shareId, documentId },
      select: { id: true, role: true, user: { select: { email: true } } },
    });
    if (!existing) {
      throw new HttpError(404, "SHARE_NOT_FOUND", "Document share was not found");
    }
    assertCanManageAssignedRole(actorRole, existing.role);

    const share = await transaction.documentShare.update({
      where: { id: shareId },
      data: { role: newRole },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_SHARE_ROLE_UPDATED",
      ipAddress,
      details: { email: existing.user.email, previousRole: existing.role, role: newRole },
    });
    return share;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function removeShare(
  documentId: string,
  shareId: string,
  actorId: string,
  actorRole: DocumentRole,
  ipAddress?: string,
) {
  const revokedUserId = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.documentShare.findFirst({
      where: { id: shareId, documentId },
      select: { id: true, role: true, user: { select: { id: true, email: true } } },
    });
    if (!existing) {
      throw new HttpError(404, "SHARE_NOT_FOUND", "Document share was not found");
    }
    assertCanManageAssignedRole(actorRole, existing.role);

    await transaction.documentShare.delete({ where: { id: shareId } });
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_SHARE_REVOKED",
      ipAddress,
      details: { email: existing.user.email, role: existing.role },
    });
    return existing.user.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  closeUserDocumentEventStreams(documentId, revokedUserId);
  return { revoked: true };
}

export async function listInvitations(
  documentId: string,
  actorId: string,
  ipAddress?: string,
) {
  return prisma.$transaction(async (transaction) => {
    const expiredInvitations = await transaction.documentInvitation.findMany({
      where: {
        documentId,
        status: InvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      select: { id: true, email: true },
    });
    for (const invitation of expiredInvitations) {
      const expired = await transaction.documentInvitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      if (expired.count > 0) {
        await recordAuditEntry(transaction, {
          documentId,
          actorId,
          action: "DOCUMENT_INVITATION_EXPIRED",
          ipAddress,
          details: { email: invitation.email },
        });
      }
    }

    return transaction.documentInvitation.findMany({
      where: { documentId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });
}

export async function revokeInvitation(
  documentId: string,
  invitationId: string,
  actorId: string,
  actorRole: DocumentRole,
  ipAddress?: string,
) {
  const invitation = await prisma.documentInvitation.findFirst({
    where: { id: invitationId, documentId },
    select: { id: true, email: true, role: true, status: true, expiresAt: true },
  });
  if (!invitation) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation was not found");
  }
  if (invitation.role === DocumentRole.OWNER && actorRole !== DocumentRole.OWNER) {
    throw new HttpError(403, "FORBIDDEN", "Only an owner can revoke an owner invitation");
  }
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new HttpError(409, "INVITATION_NOT_PENDING", "Only pending invitations can be revoked");
  }

  const now = new Date();
  if (invitation.expiresAt <= now) {
    await prisma.$transaction(async (transaction) => {
      const expired = await transaction.documentInvitation.updateMany({
        where: { id: invitationId, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      if (expired.count > 0) {
        await recordAuditEntry(transaction, {
          documentId,
          actorId,
          action: "DOCUMENT_INVITATION_EXPIRED",
          ipAddress,
          details: { email: invitation.email },
        });
      }
    });
    throw new HttpError(410, "INVITATION_EXPIRED", "Invitation has expired");
  }

  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.documentInvitation.updateMany({
      where: {
        id: invitationId,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: now },
      },
      data: { status: InvitationStatus.REVOKED },
    });
    if (updated.count === 0) {
      throw new HttpError(409, "INVITATION_NOT_PENDING", "Invitation is no longer pending");
    }
    await recordAuditEntry(transaction, {
      documentId,
      actorId,
      action: "DOCUMENT_INVITATION_REVOKED",
      ipAddress,
      details: { email: invitation.email },
    });
  });

  return { revoked: true };
}

export async function acceptPendingInvitationsForUser(
  transaction: Prisma.TransactionClient,
  user: { id: string; email: string },
): Promise<number> {
  const now = new Date();
  const invitations = await transaction.documentInvitation.findMany({
    where: { email: user.email, status: InvitationStatus.PENDING },
    include: { document: { select: { ownerId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let acceptedCount = 0;

  for (const invitation of invitations) {
    if (invitation.expiresAt <= now) {
      const expired = await transaction.documentInvitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      if (expired.count > 0) {
        await recordAuditEntry(transaction, {
          documentId: invitation.documentId,
          actorId: user.id,
          action: "DOCUMENT_INVITATION_EXPIRED",
          details: { email: user.email },
        });
      }
      continue;
    }

    const accepted = await transaction.documentInvitation.updateMany({
      where: {
        id: invitation.id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: now },
      },
      data: { status: InvitationStatus.ACCEPTED },
    });
    if (accepted.count === 0) {
      continue;
    }

    if (invitation.document.ownerId !== user.id) {
      const existing = await transaction.documentShare.findUnique({
        where: {
          documentId_userId: {
            documentId: invitation.documentId,
            userId: user.id,
          },
        },
        select: { role: true },
      });
      const role = existing
        ? mostPrivilegedRole(existing.role, invitation.role)
        : invitation.role;
      await transaction.documentShare.upsert({
        where: {
          documentId_userId: {
            documentId: invitation.documentId,
            userId: user.id,
          },
        },
        create: {
          documentId: invitation.documentId,
          userId: user.id,
          role,
        },
        update: { role },
      });
    }
    await recordAuditEntry(transaction, {
      documentId: invitation.documentId,
      actorId: user.id,
      action: "DOCUMENT_INVITATION_ACCEPTED",
      details: { role: invitation.role },
    });
    acceptedCount += 1;
  }

  return acceptedCount;
}

export async function acceptInvitation(
  user: { id: string; email: string },
  token: string,
  ipAddress?: string,
) {
  const tokenHash = hashBuffer(Buffer.from(token, "utf8"));
  const invitation = await prisma.documentInvitation.findUnique({
    where: { tokenHash },
    include: { document: { select: { ownerId: true } } },
  });
  if (!invitation) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation is invalid or no longer available");
  }
  if (invitation.email !== user.email) {
    throw new HttpError(403, "INVITATION_EMAIL_MISMATCH", "Sign in with the invited email address");
  }
  if (invitation.status !== InvitationStatus.PENDING) {
    throw new HttpError(409, "INVITATION_NOT_PENDING", "Invitation is no longer pending");
  }

  const now = new Date();
  if (invitation.expiresAt <= now) {
    await prisma.$transaction(async (transaction) => {
      const expired = await transaction.documentInvitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.EXPIRED },
      });
      if (expired.count > 0) {
        await recordAuditEntry(transaction, {
          documentId: invitation.documentId,
          actorId: user.id,
          action: "DOCUMENT_INVITATION_EXPIRED",
          ipAddress,
          details: { email: user.email },
        });
      }
    });
    throw new HttpError(410, "INVITATION_EXPIRED", "Invitation has expired");
  }

  return prisma.$transaction(async (transaction) => {
    const accepted = await transaction.documentInvitation.updateMany({
      where: {
        id: invitation.id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: now },
        email: user.email,
      },
      data: { status: InvitationStatus.ACCEPTED },
    });
    if (accepted.count === 0) {
      throw new HttpError(409, "INVITATION_NOT_PENDING", "Invitation is no longer pending");
    }

    let share = null;
    if (invitation.document.ownerId !== user.id) {
      const existing = await transaction.documentShare.findUnique({
        where: {
          documentId_userId: {
            documentId: invitation.documentId,
            userId: user.id,
          },
        },
        select: { role: true },
      });
      const role = existing
        ? mostPrivilegedRole(existing.role, invitation.role)
        : invitation.role;
      share = await transaction.documentShare.upsert({
        where: {
          documentId_userId: {
            documentId: invitation.documentId,
            userId: user.id,
          },
        },
        create: {
          documentId: invitation.documentId,
          userId: user.id,
          role,
        },
        update: { role },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      });
    }
    await recordAuditEntry(transaction, {
      documentId: invitation.documentId,
      actorId: user.id,
      action: "DOCUMENT_INVITATION_ACCEPTED",
      ipAddress,
      details: { role: invitation.role },
    });
    return { accepted: true, role: invitation.role, share };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
