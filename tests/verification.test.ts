import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashBuffer, hashFile, verifyFileHash, verifyHash } from "../src/utils/hash.util";
import { scanFile } from "../src/utils/scanner.util";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("SHA-256 document verification", () => {
  it("detects content changes and rejects malformed stored hashes", () => {
    const contents = Buffer.from("secure document");
    const hash = hashBuffer(contents);

    expect(hash).toBe("27400401c177a59ad774e180ca9299bf35c209bf277a63abb472e57e88fff2d9");
    expect(verifyHash(contents, hash)).toBe(true);
    expect(verifyHash(Buffer.from("modified document"), hash)).toBe(false);
    expect(verifyHash(contents, "not-a-hash")).toBe(false);
  });

  it("hashes files and verifies their stored digest", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "secure-doc-test-"));
    const filePath = join(temporaryDirectory, "document.txt");
    const contents = Buffer.from("file contents");
    await writeFile(filePath, contents);
    const hash = await hashFile(filePath);

    expect(await verifyFileHash(filePath, hash)).toBe(true);
    expect(await verifyFileHash(filePath, hashBuffer(Buffer.from("changed")))).toBe(false);
  });

  it("scans files as a stream and detects EICAR across chunk boundaries", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "secure-doc-scan-"));
    const filePath = join(temporaryDirectory, "infected.txt");
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    await writeFile(filePath, `${"a".repeat(64 * 1024 - 16)}${eicar}`);

    await expect(scanFile(filePath)).resolves.toMatchObject({
      status: "INFECTED",
      message: "EICAR test signature detected",
    });

    await writeFile(filePath, "ordinary text");
    await expect(scanFile(filePath)).resolves.toMatchObject({
      status: "CLEAN",
    });
  });
});
