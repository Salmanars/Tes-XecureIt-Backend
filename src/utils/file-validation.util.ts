import { basename, extname } from "node:path";

export interface SupportedDocumentType {
  extension: ".pdf" | ".docx" | ".txt" | ".csv";
  mimeType: string;
}

const mimeTypesByExtension: Record<
  SupportedDocumentType["extension"],
  readonly string[]
> = {
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".txt": ["text/plain"],
  ".csv": ["text/csv", "application/csv"],
};

export function sanitizeOriginalFilename(filename: string): string {
  const safeName = basename(filename.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return safeName || "document";
}

export function getDeclaredDocumentType(
  filename: string,
  mimeType: string,
): SupportedDocumentType | null {
  const extension = extname(sanitizeOriginalFilename(filename)).toLowerCase();
  if (
    extension !== ".pdf" &&
    extension !== ".docx" &&
    extension !== ".txt" &&
    extension !== ".csv"
  ) {
    return null;
  }

  const allowedMimeTypes = mimeTypesByExtension[extension];
  if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
    return null;
  }

  return { extension, mimeType: mimeType.toLowerCase() };
}

function isValidText(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return !buffer.includes(0);
  } catch {
    return false;
  }
}

export function hasValidDocumentSignature(
  extension: SupportedDocumentType["extension"],
  buffer: Buffer,
): boolean {
  switch (extension) {
    case ".pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case ".docx":
      return (
        buffer.length >= 2 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer.includes(Buffer.from("[Content_Types].xml")) &&
        buffer.includes(Buffer.from("word/"))
      );
    case ".txt":
    case ".csv":
      return isValidText(buffer);
  }
}
