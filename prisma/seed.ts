import bcrypt from "bcryptjs";
import { readFile, writeFile } from "node:fs/promises";
import { DocumentRole, Role } from "@prisma/client";
import { env } from "../src/config/env";
import { prisma } from "../src/config/database";
import { hashBuffer } from "../src/utils/hash.util";
import type { SupportedDocumentType } from "../src/utils/file-validation.util";
import { resolvePrivateFile, storePrivateFile } from "../src/utils/storage.util";

const TEST_PASSWORD = "Password123!";
const BCRYPT_ROUNDS = 12;

const testAccounts = [
  { id: "seed-owner", name: "XecureIT", email: "xecureit@mail.com", role: Role.OWNER },
  { id: "seed-editor", name: "UNDIP Editor", email: "undip@mail.com", role: Role.EDITOR },
  { id: "seed-viewer", name: "Salman Arya Sandytia", email: "viewer.salman@mail.com", role: Role.VIEWER },
  { id: "seed-viewer-raka", name: "Raka Saputra", email: "viewer.raka@mail.com", role: Role.VIEWER },
  { id: "seed-viewer-sinta", name: "Sinta Maharani", email: "viewer.sinta@mail.com", role: Role.VIEWER },
] as const;

const removedEditorEmails = ["editor.arya@example.test", "editor.maya@example.test"];

const sampleDocuments = [
  {
    id: "seed-document-pending",
    title: "Dokumen Menunggu Verifikasi",
    status: "PENDING_VERIFICATION",
    statusNote: null,
    filename: "dokumen-menunggu.txt",
    content: "Contoh dokumen yang menunggu verifikasi Owner.\n",
    changeNote: "Versi awal untuk pemeriksaan Owner.",
    shareWithViewer: false,
  },
  {
    id: "seed-document-revision",
    title: "Dokumen Perlu Revisi",
    status: "REJECTED",
    statusNote: "Lengkapi tanggal dan tanda tangan sebelum dikirim ulang.",
    filename: "dokumen-revisi.txt",
    content: "Contoh dokumen yang dikembalikan untuk revisi.\n",
    changeNote: "Versi awal dokumen untuk direvisi.",
    shareWithViewer: false,
  },
  {
    id: "seed-document-verified",
    title: "Dokumen Terverifikasi",
    status: "VERIFIED",
    statusNote: "Dokumen telah diperiksa dan disetujui.",
    filename: "dokumen-terverifikasi.txt",
    content: "Contoh dokumen terverifikasi untuk akun Viewer.\n",
    changeNote: "Dokumen disetujui untuk dibagikan.",
    shareWithViewer: true,
  },
] as const;

const attachmentPath = process.env.SEED_DOCX_PATH;

async function seedTestData(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Test data must not be seeded in production");
  }

  for (const email of removedEditorEmails) {
    const legacyEditor = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        documents: { select: { id: true }, take: 1 },
        versions: { select: { id: true }, take: 1 },
        auditEntries: { select: { id: true }, take: 1 },
        sentInvitations: { select: { id: true }, take: 1 },
      },
    });
    if (!legacyEditor) continue;

    const hasLinkedRecords = Boolean(
      legacyEditor.documents.length ||
      legacyEditor.versions.length ||
      legacyEditor.auditEntries.length ||
      legacyEditor.sentInvitations.length,
    );
    if (hasLinkedRecords) {
      await prisma.user.update({
        where: { id: legacyEditor.id },
        data: { role: Role.VIEWER },
      });
      console.warn(`Demoted legacy seed account with linked data to VIEWER: ${email}`);
      continue;
    }

    await prisma.documentShare.deleteMany({ where: { userId: legacyEditor.id } });
    await prisma.user.delete({ where: { id: legacyEditor.id } });
    console.info(`Removed legacy seed editor: ${email}`);
  }

  const previousViewer = await prisma.user.findUnique({
    where: { email: "viewer@mail.com" },
    select: { id: true },
  });
  const salmanViewer = await prisma.user.findUnique({
    where: { email: "viewer.salman@mail.com" },
    select: { id: true },
  });
  if (previousViewer && !salmanViewer) {
    await prisma.user.update({
      where: { id: previousViewer.id },
      data: { name: "Salman Arya Sandytia", email: "viewer.salman@mail.com", role: Role.VIEWER },
    });
    console.info("Updated existing Viewer account to Salman Arya Sandytia");
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, BCRYPT_ROUNDS);
  const accounts = await Promise.all(
    testAccounts.map((account) =>
      prisma.user.upsert({
        where: { email: account.email },
        create: { ...account, passwordHash },
        update: { name: account.name, passwordHash, role: account.role },
      }),
    ),
  );
  const owner = accounts[0];
  const editors = accounts.filter((account) => account.role === Role.EDITOR);
  const viewers = accounts.filter((account) => account.role === Role.VIEWER);
  const documentsToSeed = attachmentPath
    ? [
        ...sampleDocuments,
        {
          id: "seed-document-attachment",
          title: "Ijazah DOCX untuk Pengujian",
          status: "PENDING_VERIFICATION" as const,
          statusNote: null,
          filename: "ijazah-untuk-pengujian.docx",
          content: await readFile(attachmentPath),
          changeNote: "Lampiran DOCX untuk menguji unggah, penyimpanan, dan verifikasi hash.",
          shareWithViewer: true,
          extension: ".docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ]
    : sampleDocuments;

  for (const [index, sample] of documentsToSeed.entries()) {
    const documentVersionId = `${sample.id}-v1`;
    const existingVersion = await prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: { documentId: sample.id, versionNumber: 1 },
      },
      select: { id: true, storagePath: true },
    });
    const content = Buffer.isBuffer(sample.content) ? sample.content : Buffer.from(sample.content, "utf8");
    const extension = ("extension" in sample ? sample.extension : ".txt") as SupportedDocumentType["extension"];
    const mimeType = "mimeType" in sample ? sample.mimeType : "text/plain";
    const storagePath = existingVersion?.storagePath ?? await storePrivateFile(content, extension);
    const digest = hashBuffer(content);
    const actualVersionId = existingVersion?.id ?? documentVersionId;
    if (existingVersion) {
      await writeFile(resolvePrivateFile(storagePath), content);
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.document.upsert({
        where: { id: sample.id },
        create: {
          id: sample.id,
          ownerId: owner.id,
          title: sample.title,
          status: sample.status,
          statusNote: sample.statusNote,
          filename: sample.filename,
          storagePath,
          mimeType,
          size: content.length,
        },
        update: {
          title: sample.title,
          status: sample.status,
          statusNote: sample.statusNote,
          filename: sample.filename,
          storagePath,
          mimeType,
          size: content.length,
        },
      });

      await transaction.documentVersion.upsert({
        where: {
          documentId_versionNumber: { documentId: sample.id, versionNumber: 1 },
        },
        create: {
          id: documentVersionId,
          documentId: sample.id,
          createdById: editors[0].id,
          versionNumber: 1,
          storagePath,
          hash: digest,
          scanStatus: "CLEAN",
          scanDetail: "Seeded local sample document",
          changeNote: sample.changeNote,
        },
        update: {
          hash: digest,
          scanStatus: "CLEAN",
          scanDetail: "Seeded local sample document",
          changeNote: sample.changeNote,
        },
      });

      const hashRecord = await transaction.hashRecord.findFirst({
        where: { documentId: sample.id, documentVersionId: actualVersionId, algorithm: "SHA-256" },
        select: { id: true },
      });
      if (hashRecord) {
        await transaction.hashRecord.update({
          where: { id: hashRecord.id },
          data: { hash: digest },
        });
      } else {
        await transaction.hashRecord.create({
          data: {
            documentId: sample.id,
            documentVersionId: actualVersionId,
            algorithm: "SHA-256",
            hash: digest,
          },
        });
      }

      for (const editor of editors) {
        await transaction.documentShare.upsert({
          where: { documentId_userId: { documentId: sample.id, userId: editor.id } },
          create: { documentId: sample.id, userId: editor.id, role: DocumentRole.EDITOR },
          update: { role: DocumentRole.EDITOR },
        });
      }

      if (sample.shareWithViewer) {
        for (const viewer of viewers) {
          await transaction.documentShare.upsert({
            where: { documentId_userId: { documentId: sample.id, userId: viewer.id } },
            create: { documentId: sample.id, userId: viewer.id, role: DocumentRole.VIEWER },
            update: { role: DocumentRole.VIEWER },
          });
        }
      }

      const auditId = `${sample.id}-seed-audit`;
      const existingAudit = await transaction.auditTrail.findUnique({ where: { id: auditId } });
      if (!existingAudit) {
        await transaction.auditTrail.create({
          data: {
            id: auditId,
            documentId: sample.id,
            actorId: owner.id,
            action: sample.status === "VERIFIED" ? "DOCUMENT_VERIFIED" : sample.status === "REJECTED" ? "DOCUMENT_REJECTED" : "DOCUMENT_CREATED",
            details: { source: "local seed", status: sample.status },
          },
        });
      }
    });

    console.info(`Seeded ${sample.title} (${index + 1}/${documentsToSeed.length})`);
  }

  console.info(`Seed accounts use password: ${TEST_PASSWORD}`);
  for (const account of testAccounts) {
    console.info(`  ${account.role}: ${account.email}`);
  }
}

seedTestData()
  .catch((error: unknown) => {
    console.error("Could not seed XecureIT local data", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
