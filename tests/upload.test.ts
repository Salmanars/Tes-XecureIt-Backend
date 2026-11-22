import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorMiddleware } from "../src/middlewares/error.middleware";
import { documentUpload } from "../src/middlewares/upload.middleware";

const testApp = express();
testApp.post("/upload", documentUpload, (_request, response) => {
  response.status(201).json({ success: true, data: { accepted: true } });
});
testApp.use(errorMiddleware);

let server: ReturnType<typeof testApp.listen>;

beforeAll(async () => {
  server = testApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function getUploadUrl(): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Upload test server is not listening on a TCP port");
  }
  return `http://127.0.0.1:${address.port}/upload`;
}

async function postFile(filename: string, mimeType: string, contents: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([contents], { type: mimeType }), filename);
  return fetch(getUploadUrl(), { method: "POST", body: form });
}

describe("private document upload middleware", () => {
  it("accepts files at the 10 MB limit and rejects larger files", async () => {
    const maxSize = 10 * 1024 * 1024;
    const validPdf = Buffer.alloc(maxSize);
    validPdf.write("%PDF-1.7");

    const accepted = await postFile("report.pdf", "application/pdf", validPdf);
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual({
      success: true,
      data: { accepted: true },
    });

    const tooLarge = Buffer.alloc(maxSize + 1);
    tooLarge.write("%PDF-1.7");
    const rejected = await postFile("large.pdf", "application/pdf", tooLarge);
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toMatchObject({
      success: false,
      error: { code: "FILE_TOO_LARGE" },
    });
  });

  it("rejects mismatched types and accepts EICAR for persisted scan status", async () => {
    const mismatchMime = await postFile(
      "document.pdf",
      "text/plain",
      Buffer.from("plain text"),
    );
    expect(mismatchMime.status).toBe(415);
    expect(await mismatchMime.json()).toMatchObject({
      success: false,
      error: { code: "UNSUPPORTED_FILE_TYPE" },
    });

    const fakePdf = await postFile(
      "document.pdf",
      "application/pdf",
      Buffer.from("plain text"),
    );
    expect(fakePdf.status).toBe(415);
    expect(await fakePdf.json()).toMatchObject({
      success: false,
      error: { code: "FILE_SIGNATURE_MISMATCH" },
    });

    const infectedContent = Buffer.from(
      "%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const infected = await postFile(
      "infected.pdf",
      "application/pdf",
      infectedContent,
    );
    expect(infected.status).toBe(201);
  });
});
