import { describe, expect, it } from "vitest";
import { DocumentRole, Role } from "@prisma/client";
import {
  assertCanManageAssignedRole,
  assertCanGrantRole,
  effectiveDocumentRole,
  mostPrivilegedRole,
  roleAtLeast,
} from "../src/utils/role-policy.util";
import {
  getDeclaredDocumentType,
  hasValidDocumentSignature,
  sanitizeOriginalFilename,
} from "../src/utils/file-validation.util";
import { scanBuffer } from "../src/utils/scanner.util";

describe("document role authorization", () => {
  it("allows read access at every role but limits editor and owner actions", () => {
    expect(roleAtLeast(DocumentRole.VIEWER, DocumentRole.VIEWER)).toBe(true);
    expect(roleAtLeast(DocumentRole.VIEWER, DocumentRole.EDITOR)).toBe(false);
    expect(roleAtLeast(DocumentRole.EDITOR, DocumentRole.EDITOR)).toBe(true);
    expect(roleAtLeast(DocumentRole.EDITOR, DocumentRole.OWNER)).toBe(false);
    expect(roleAtLeast(DocumentRole.OWNER, DocumentRole.OWNER)).toBe(true);
  });

  it("does not allow editors to assign owner access", () => {
    expect(() =>
      assertCanGrantRole(DocumentRole.EDITOR, DocumentRole.OWNER),
    ).toThrow("Only a document owner can assign the owner role");
    expect(() =>
      assertCanGrantRole(DocumentRole.EDITOR, DocumentRole.VIEWER),
    ).not.toThrow();
    expect(() =>
      assertCanManageAssignedRole(DocumentRole.EDITOR, DocumentRole.OWNER),
    ).toThrow("Only an owner can change another owner's role");
    expect(
      mostPrivilegedRole(DocumentRole.OWNER, DocumentRole.VIEWER),
    ).toBe(DocumentRole.OWNER);
  });

  it("limits document permissions to the lower of account and document roles", () => {
    expect(roleAtLeast(Role.VIEWER, DocumentRole.EDITOR)).toBe(false);
    expect(roleAtLeast(Role.EDITOR, DocumentRole.VIEWER)).toBe(true);
    expect(
      effectiveDocumentRole(Role.EDITOR, DocumentRole.OWNER),
    ).toBe(DocumentRole.EDITOR);
    expect(
      effectiveDocumentRole(Role.OWNER, DocumentRole.VIEWER),
    ).toBe(DocumentRole.VIEWER);
  });
});

describe("upload type validation", () => {
  it("requires a supported extension, MIME type, and matching signature", () => {
    const pdfType = getDeclaredDocumentType("report.pdf", "application/pdf");
    expect(pdfType).not.toBeNull();
    expect(hasValidDocumentSignature(".pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(hasValidDocumentSignature(".pdf", Buffer.from("MZ\x90\x00"))).toBe(false);
    expect(getDeclaredDocumentType("report.pdf", "text/plain")).toBeNull();
    expect(getDeclaredDocumentType("report.exe", "application/pdf")).toBeNull();
    expect(sanitizeOriginalFilename("../../private/report.pdf")).toBe("report.pdf");
  });

  it("validates DOCX archive markers and UTF-8 text files", () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("[Content_Types].xmlword/document.xml"),
    ]);
    expect(hasValidDocumentSignature(".docx", docx)).toBe(true);
    expect(hasValidDocumentSignature(".txt", Buffer.from("plain text\n"))).toBe(true);
    expect(hasValidDocumentSignature(".txt", Buffer.from([0x61, 0x00, 0x62]))).toBe(false);
    expect(hasValidDocumentSignature(".csv", Buffer.from([0xff, 0xfe, 0x00]))).toBe(false);
    expect(hasValidDocumentSignature(".docx", Buffer.from("PK without zip entries"))).toBe(false);
  });
});

describe("simulated document scanning", () => {
  it("marks ordinary document content clean", () => {
    expect(scanBuffer(Buffer.from("Quarterly report")).status).toBe("CLEAN");
  });

  it.each([
    ["EICAR", "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"],
    ["executable", "MZ\x90\x00"],
    ["embedded script", "<script>payload()</script>"],
  ])("detects the simulated %s signature", (_name, content) => {
    expect(scanBuffer(Buffer.from(content)).status).toBe("INFECTED");
  });
});
