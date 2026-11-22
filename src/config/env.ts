import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envFilePath = resolve(__dirname, "../../.env");
dotenv.config({ path: envFilePath });

const isProduction = process.env.NODE_ENV === "production";

const optionalValue = z
  .string()
  .transform((value) => value.trim() || undefined)
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_RATE_LIMIT: z.coerce.number().int().min(1).default(isProduction ? 300 : 2000),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(isProduction ? 10 : 50),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z
    .string()
    .min(isProduction ? 32 : 1, "JWT_SECRET must be at least 32 characters in production")
    .default(isProduction ? "" : "development-only-secret-change-before-deploy"),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  STORAGE_DIR: z.string().min(1).default("./storage/private"),
  SMTP_HOST: optionalValue,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: optionalValue,
  SMTP_PASS: optionalValue,
  SMTP_FROM: optionalValue,
  APP_FRONTEND_URL: z.string().url().default("http://localhost:3000"),
}).superRefine((config, context) => {
  if (
    config.NODE_ENV === "production" &&
    !config.APP_FRONTEND_URL.startsWith("https://")
  ) {
    context.addIssue({
      code: "custom",
      path: ["APP_FRONTEND_URL"],
      message: "APP_FRONTEND_URL must use HTTPS in production",
    });
  }
  if (config.SMTP_HOST && !config.SMTP_FROM) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_FROM"],
      message: "SMTP_FROM is required when SMTP_HOST is configured",
    });
  }
  if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASS)) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_PASS"],
      message: "SMTP_USER and SMTP_PASS must be configured together",
    });
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => {
    const key = issue.path.join(".") || "environment";
    return `  - ${key}: ${issue.message}`;
  });
  const databaseUrlInvalid = parsedEnv.error.issues.some(
    (issue) => issue.path[0] === "DATABASE_URL",
  );
  const jwtSecretInvalid = parsedEnv.error.issues.some(
    (issue) => issue.path[0] === "JWT_SECRET",
  );
  const help = [
    `Backend environment configuration is invalid:`,
    ...issues,
    "",
    "Setup help:",
    ...(!existsSync(envFilePath)
      ? [`  No .env file was found at ${envFilePath}.`]
      : []),
    "  Copy .env.example to .env from the backend directory.",
    "  PowerShell: Copy-Item .env.example .env",
    "  CMD: copy .env.example .env",
    "  Linux/macOS: cp .env.example .env",
    ...(databaseUrlInvalid
      ? ["  Set DATABASE_URL to a valid PostgreSQL connection URL."]
      : []),
    ...(jwtSecretInvalid && isProduction
      ? ["  Set JWT_SECRET to a unique secret of at least 32 characters for production."]
      : []),
  ];

  throw new Error(help.join("\n"), { cause: parsedEnv.error });
}

export const env = parsedEnv.data;
