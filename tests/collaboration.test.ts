import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/secure_doc_test";
  process.env.JWT_SECRET = "test-only-signing-secret";
});

vi.mock("../src/config/database", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "../src/config/database";
import {
  authenticateEventStream,
  createEventStreamToken,
} from "../src/middlewares/auth.middleware";
import {
  activeDocumentStreamCount,
  closeDocumentEventStreams,
  publishDocumentActivity,
  subscribeToDocumentEvents,
} from "../src/realtime/collaboration.gateway";
import { openApiDocument } from "../src/config/swagger";

class MockEventResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableNeedDrain = false;
  frames: string[] = [];

  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }

  end(frame?: string): this {
    if (frame) {
      this.frames.push(frame);
    }
    this.writableEnded = true;
    this.emit("close");
    return this;
  }
}

function makeRequest(documentId: string, token: string): Request {
  return {
    params: { id: documentId },
    query: { token },
    header: () => undefined,
  } as unknown as Request;
}

function makeAuthResponse() {
  const response = {
    headers: new Map<string, string>(),
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
}

describe("document collaboration events", () => {
  it("broadcasts presence and activity, then closes streams on document deletion", () => {
    const first = new MockEventResponse();
    const second = new MockEventResponse();
    const firstUser = { id: "user-1", name: "Ada" };
    const secondUser = { id: "user-2", name: "Grace" };

    const unsubscribeFirst = subscribeToDocumentEvents("doc-1", firstUser, first as unknown as Response);
    const unsubscribeSecond = subscribeToDocumentEvents("doc-1", secondUser, second as unknown as Response);
    publishDocumentActivity("doc-1", firstUser.id, "editing");

    expect(first.frames.join("")).toContain('"action":"opened"');
    expect(first.frames.join("")).toContain('"action":"editing"');
    expect(activeDocumentStreamCount("doc-1")).toBe(2);

    closeDocumentEventStreams("doc-1", firstUser.id);
    expect(first.writableEnded).toBe(true);
    expect(second.writableEnded).toBe(true);
    expect(first.frames.join("")).toContain('"action":"document.deleted"');
    expect(activeDocumentStreamCount("doc-1")).toBe(0);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("does not announce a user leaving until their final connection closes", () => {
    const first = new MockEventResponse();
    const second = new MockEventResponse();
    const observer = new MockEventResponse();
    const user = { id: "user-1", name: "Ada" };
    const other = { id: "user-2", name: "Grace" };

    const unsubscribeFirst = subscribeToDocumentEvents("doc-2", user, first as unknown as Response);
    const unsubscribeSecond = subscribeToDocumentEvents("doc-2", user, second as unknown as Response);
    const unsubscribeObserver = subscribeToDocumentEvents("doc-2", other, observer as unknown as Response);

    first.emit("close");
    expect(observer.frames.join("")).not.toContain('"action":"left"');
    second.emit("close");
    expect(observer.frames.join("")).toContain('"action":"left"');

    unsubscribeFirst();
    unsubscribeSecond();
    unsubscribeObserver();
  });

  it("accepts only document-scoped query tickets", async () => {
    const token = createEventStreamToken(
      { id: "user-1", email: "ada@example.com", role: Role.OWNER },
      "doc-1",
    );
    const next = vi.fn();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      role: Role.OWNER,
      passwordHash: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const matchingResponse = makeAuthResponse();
    const authenticated = new Promise<void>((resolve) => {
      const callback = () => {
        next();
        resolve();
      };
      authenticateEventStream(
        makeRequest("doc-1", token),
        matchingResponse as unknown as Response,
        callback,
      );
    });
    await authenticated;
    expect(next).toHaveBeenCalledOnce();

    const mismatchResponse = makeAuthResponse();
    const mismatchNext = vi.fn();
    authenticateEventStream(
      makeRequest("doc-2", token),
      mismatchResponse as unknown as Response,
      mismatchNext,
    );
    expect(mismatchResponse.statusCode).toBe(401);
    expect(mismatchNext).not.toHaveBeenCalled();

    const regularAccessToken = jwt.sign(
      { email: "ada@example.com" },
      process.env.JWT_SECRET as string,
      { subject: "user-1", issuer: "secure-doc-backend", expiresIn: "1h" },
    );
    const regularTokenResponse = makeAuthResponse();
    const regularTokenNext = vi.fn();
    authenticateEventStream(
      makeRequest("doc-1", regularAccessToken),
      regularTokenResponse as unknown as Response,
      regularTokenNext,
    );
    expect(regularTokenResponse.statusCode).toBe(401);
    expect(regularTokenNext).not.toHaveBeenCalled();
  });

  it("documents event stream, scoped ticket, and read-only audit endpoints", () => {
    expect(openApiDocument.paths["/documents/{id}/events"]).toHaveProperty("get");
    expect(openApiDocument.paths["/documents/{id}/events/token"]).toHaveProperty("post");
    expect(openApiDocument.paths["/documents/{id}/audit"]).toHaveProperty("get");
    expect(openApiDocument.paths["/documents/{id}/audit"]).not.toHaveProperty("delete");
  });
});
