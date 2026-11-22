import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { HttpError } from "../../middlewares/error.middleware";
import { acceptPendingInvitationsForUser } from "../shares/share.service";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from "./auth.schema";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
};

function createAccessToken(user: Pick<PublicUser, "id" | "email">): string {
  return jwt.sign({ email: user.email }, env.JWT_SECRET, {
    subject: user.id,
    issuer: "secure-doc-backend",
    expiresIn: "1h",
  });
}

export async function register(input: RegisterInput): Promise<{
  user: PublicUser;
  token: string;
}> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (transaction) => {
    const createdUser = await transaction.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
      select: publicUserSelect,
    });
    await acceptPendingInvitationsForUser(transaction, createdUser);
    return createdUser;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { user, token: createAccessToken(user) };
}

export async function login(input: LoginInput): Promise<{
  user: PublicUser;
  token: string;
}> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...publicUserSelect, passwordHash: true },
  });

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  await prisma.$transaction((transaction) =>
    acceptPendingInvitationsForUser(transaction, user),
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const { passwordHash: _passwordHash, ...publicUser } = user;
  return { user: publicUser, token: createAccessToken(publicUser) };
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "User account is no longer available");
  }

  return user;
}

export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<{ user: PublicUser; token: string }> {
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!currentUser) {
    throw new HttpError(401, "UNAUTHORIZED", "User account is no longer available");
  }

  if (input.email && input.email !== currentUser.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingUser && existingUser.id !== userId) {
      throw new HttpError(409, "EMAIL_ALREADY_IN_USE", "Email address is already in use");
    }
  }

  let user: PublicUser;
  try {
    user = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name, email: input.email },
      select: publicUserSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(409, "EMAIL_ALREADY_IN_USE", "Email address is already in use");
    }
    throw error;
  }

  return { user, token: createAccessToken(user) };
}

export async function changeUserPassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<{ updated: true }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "User account is no longer available");
  }
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new HttpError(400, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return { updated: true };
}
