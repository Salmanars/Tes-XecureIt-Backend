import { z } from "zod";

export const createShareSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
});

export const updateShareSchema = z.object({
  role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(256),
});

export const shareCandidatesQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export type CreateShareInput = z.infer<typeof createShareSchema>;
export type UpdateShareInput = z.infer<typeof updateShareSchema>;
