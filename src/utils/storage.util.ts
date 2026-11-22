import { randomUUID } from "node:crypto";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { env } from "../config/env";
import { HttpError } from "../middlewares/error.middleware";
import type { SupportedDocumentType } from "./file-validation.util";

function getStorageRoot(): string {
  const root = resolve(env.STORAGE_DIR);
  const publicRoot = resolve(process.cwd(), "public");
  const relativeToPublic = relative(publicRoot, root);
  if (
    relativeToPublic === "" ||
    (relativeToPublic !== ".." &&
      !relativeToPublic.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToPublic))
  ) {
    throw new HttpError(
      500,
      "PUBLIC_STORAGE_FORBIDDEN",
      "Private document storage must not be inside the public directory",
    );
  }

  return root;
}

export async function storePrivateFile(
  buffer: Buffer,
  extension: SupportedDocumentType["extension"],
): Promise<string> {
  if (![".pdf", ".docx", ".txt", ".csv"].includes(extension)) {
    throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "Unsupported private file extension");
  }

  const root = getStorageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(root, 0o700);
  }

  const storageKey = `${randomUUID()}${extension}`;
  await writeFile(resolve(root, storageKey), buffer, {
    flag: "wx",
    mode: 0o600,
  });
  return storageKey;
}

export function resolvePrivateFile(storageKey: string): string {
  if (!/^[\da-f-]{36}\.(pdf|docx|txt|csv)$/i.test(storageKey)) {
    throw new HttpError(500, "INVALID_STORAGE_REFERENCE", "Stored file reference is invalid");
  }

  const root = getStorageRoot();
  const filePath = resolve(root, storageKey);
  const relativePath = relative(root, filePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new HttpError(500, "INVALID_STORAGE_REFERENCE", "Stored file reference is invalid");
  }

  return filePath;
}

export async function removePrivateFile(storageKey: string): Promise<void> {
  const filePath = resolvePrivateFile(storageKey);
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }
}
