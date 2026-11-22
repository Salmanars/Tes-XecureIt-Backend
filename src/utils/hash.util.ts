import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function compareHashes(currentHash: string, storedHash: string): boolean {
  const normalizedCurrentHash = currentHash.trim().toLowerCase();
  const normalizedStoredHash = storedHash.trim().toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(normalizedCurrentHash) ||
    !/^[a-f0-9]{64}$/.test(normalizedStoredHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(normalizedCurrentHash, "hex"),
    Buffer.from(normalizedStoredHash, "hex"),
  );
}

export function verifyHash(buffer: Buffer, storedHash: string): boolean {
  return compareHashes(hashBuffer(buffer), storedHash);
}

export async function verifyFileHash(
  filePath: string,
  storedHash: string,
): Promise<boolean> {
  return compareHashes(await hashFile(filePath), storedHash);
}
