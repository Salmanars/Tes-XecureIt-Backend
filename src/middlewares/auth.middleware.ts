import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { prisma } from "../config/database";
import { env } from "../config/env";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

interface AuthenticatedIdentity {
  id: string;
}

function isAuthPayload(
  payload: string | JwtPayload,
): payload is JwtPayload & { sub: string; email: string } {
  return (
    typeof payload !== "string" &&
    typeof payload.sub === "string" &&
    typeof payload.email === "string"
  );
}

function getBearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");
  return match?.[1];
}

function getAuthenticatedIdentity(
  token: string,
  documentId?: string,
  requireEventScope = false,
): AuthenticatedIdentity | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: "secure-doc-backend",
    });
    if (!isAuthPayload(payload)) {
      return null;
    }

    const purpose = payload.purpose;
    if (requireEventScope && purpose !== "document_events") {
      return null;
    }
    if (
      purpose !== undefined &&
      (purpose !== "document_events" || payload.documentId !== documentId)
    ) {
      return null;
    }

    return { id: payload.sub };
  } catch {
    return null;
  }
}

async function loadAuthenticatedUser(
  identity: AuthenticatedIdentity,
): Promise<AuthenticatedUser | null> {
  return prisma.user.findUnique({
    where: { id: identity.id },
    select: { id: true, email: true, role: true },
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const token = getBearerToken(request.header("authorization"));
  if (!token) {
    response.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Bearer token is required" },
    });
    return;
  }

  const identity = getAuthenticatedIdentity(token);
  if (!identity) {
    response.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Token is invalid or expired" },
    });
    return;
  }

  void loadAuthenticatedUser(identity)
    .then((user) => {
      if (!user) {
        response.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User account is no longer available" },
        });
        return;
      }
      request.user = user;
      next();
    })
    .catch(next);
}

export function authenticateEventStream(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Referrer-Policy", "no-referrer");

  const authorization = request.header("authorization");
  const queryToken = request.query.token;
  if (authorization && queryToken !== undefined) {
    response.status(400).json({
      success: false,
      error: {
        code: "AMBIGUOUS_AUTHENTICATION",
        message: "Use either the Authorization header or the event token",
      },
    });
    return;
  }

  const token = authorization
    ? getBearerToken(authorization)
    : typeof queryToken === "string" && queryToken.length <= 2048
      ? queryToken
      : undefined;
  if (!token) {
    response.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "A valid event stream token is required" },
    });
    return;
  }

  const identity = getAuthenticatedIdentity(
    token,
    request.params.id,
    !authorization,
  );
  if (!identity) {
    response.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Event stream token is invalid, expired, or scoped to another document",
      },
    });
    return;
  }

  void loadAuthenticatedUser(identity)
    .then((user) => {
      if (!user) {
        response.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User account is no longer available" },
        });
        return;
      }
      request.user = user;
      next();
    })
    .catch(next);
}

export function createEventStreamToken(
  user: AuthenticatedUser,
  documentId: string,
): string {
  return jwt.sign(
    { email: user.email, purpose: "document_events", documentId },
    env.JWT_SECRET,
    {
      subject: user.id,
      issuer: "secure-doc-backend",
      expiresIn: "5m",
    },
  );
}
