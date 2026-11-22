import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "../src/modules/auth/auth.schema";

describe("authentication input validation", () => {
  it("normalizes names and email addresses at registration", () => {
    expect(
      registerSchema.parse({
        name: " Ada Lovelace ",
        email: "ADA@example.com",
        password: "correct-horse",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
    });
  });

  it("rejects malformed credentials", () => {
    expect(() =>
      loginSchema.parse({ email: "not-an-email", password: "short" }),
    ).toThrow();
  });

  it("accepts both seeded test-account credentials", () => {
    expect(
      loginSchema.parse({
        email: "UNDIP@mail.com",
        password: "password",
      }),
    ).toEqual({
      email: "undip@mail.com",
      password: "password",
    });
    expect(
      loginSchema.parse({
        email: "xecureit@mail.com",
        password: "password",
      }),
    ).toEqual({
      email: "xecureit@mail.com",
      password: "password",
    });
    expect(
      loginSchema.parse({
        email: "viewer@mail.com",
        password: "password",
      }),
    ).toEqual({
      email: "viewer@mail.com",
      password: "password",
    });
  });

  it("validates partial profile updates and normalizes email", () => {
    expect(
      updateProfileSchema.parse({
        email: " ADA@EXAMPLE.COM ",
      }),
    ).toEqual({ email: "ada@example.com" });
    expect(() => updateProfileSchema.parse({})).toThrow();
    expect(() => updateProfileSchema.parse({ name: "  " })).toThrow();
  });

  it("requires a matching, changed password confirmation", () => {
    expect(
      changePasswordSchema.parse({
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "new-password",
      }),
    ).toEqual({
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    });
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: "old-password",
        newPassword: "new-password",
        confirmPassword: "different-password",
      }),
    ).toThrow();
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: "old-password",
        newPassword: "old-password",
        confirmPassword: "old-password",
      }),
    ).toThrow();
  });
});
