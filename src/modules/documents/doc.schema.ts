import { z } from "zod";

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => value.title !== undefined || value.description !== undefined, {
    message: "At least one document field must be provided",
  });

export const updateDocumentStatusSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED", "REVOKED"]),
  statusNote: z.string().trim().max(1000).nullable().optional(),
});

export const createDocumentVersionSchema = z.object({
  changeNote: z.string().trim().max(500).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type UpdateDocumentStatusInput = z.infer<typeof updateDocumentStatusSchema>;
