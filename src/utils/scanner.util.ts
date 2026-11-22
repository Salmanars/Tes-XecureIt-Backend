import { readFile } from "node:fs/promises";

export type ScanStatus = "CLEAN" | "INFECTED";

export interface ScanResult {
  status: ScanStatus;
  message: string;
}

const signatures: ReadonlyArray<{
  pattern: RegExp;
  message: string;
}> = [
  { pattern: /\$?X5O!P%@AP\[4\\PZX54\(P\^\)7CC\)7\}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H\+H\*/i, message: "EICAR test signature detected" },
  { pattern: /^MZ/, message: "Executable file signature detected" },
  { pattern: /<script\b[^>]*>[\s\S]*?<\/script\s*>/i, message: "Embedded script payload detected" },
  { pattern: /<\?php\b/i, message: "Server-side script payload detected" },
  { pattern: /^\s*#!\s*\/(?:usr\/)?bin\/(?:ba)?sh\b/m, message: "Executable shell script detected" },
  { pattern: /\b(?:powershell|pwsh)(?:\.exe)?\b.{0,80}\s-(?:enc|encodedcommand)\b/i, message: "Encoded PowerShell payload detected" },
];

export function scanBuffer(buffer: Buffer): ScanResult {
  const sample = buffer.toString("latin1");
  const signature = signatures.find(({ pattern }) => pattern.test(sample));

  if (signature) {
    return { status: "INFECTED", message: signature.message };
  }

  return {
    status: "CLEAN",
    message: "No known simulated threat signatures were detected",
  };
}

export async function scanFile(filePath: string): Promise<ScanResult> {
  return scanBuffer(await readFile(filePath));
}
