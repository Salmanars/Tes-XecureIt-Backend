import nodemailer from "nodemailer";
import { env } from "../config/env";

export async function sendInvitationEmail(input: {
  email: string;
  documentTitle: string;
  role: string;
  invitationUrl: string;
  expiresAt: Date;
}): Promise<void> {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    throw new Error("SMTP_HOST and SMTP_FROM must be configured to send invitations");
  }

  const auth =
    env.SMTP_USER && env.SMTP_PASS
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    const info = await transport.sendMail({
      from: env.SMTP_FROM,
      to: input.email,
      subject: "You have been invited to a document",
      text: [
        `You have been invited to access "${input.documentTitle}".`,
        `Permission: ${input.role.toLowerCase()}.`,
        `Claim the invitation: ${input.invitationUrl}`,
        `This invitation expires at ${input.expiresAt.toISOString()}.`,
      ].join("\n\n"),
    });

    if (!info.accepted.some((address) => address.toLowerCase() === input.email)) {
      throw new Error("SMTP server did not accept the invitation recipient");
    }
  } finally {
    transport.close();
  }
}
