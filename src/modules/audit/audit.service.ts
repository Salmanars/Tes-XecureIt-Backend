import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";

type AuditWriter = Pick<Prisma.TransactionClient, "auditTrail">;

export interface AuditEntryInput {
  documentId: string;
  actorId?: string;
  action: string;
  ipAddress?: string;
  details?: Prisma.InputJsonValue;
}

export function recordAuditEntry(
  transaction: AuditWriter,
  input: AuditEntryInput,
) {
  return transaction.auditTrail.create({
    data: {
      documentId: input.documentId,
      actorId: input.actorId,
      action: input.action,
      ipAddress: input.ipAddress,
      details: input.details,
    },
  });
}

export async function listAuditEntries(
  documentId: string,
  page: number,
  pageSize: number,
) {
  const [entries, total] = await prisma.$transaction([
    prisma.auditTrail.findMany({
      where: { documentId },
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditTrail.count({ where: { documentId } }),
  ]);

  return {
    entries,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
