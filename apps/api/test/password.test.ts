import { beforeAll, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password hashing", () => {
  const password = "example-password-for-tests";
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });

  it("creates an Argon2id hash", () => {
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(passwordHash).not.toBe(password);
  });

  it("accepts the matching password", async () => {
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    await expect(
      verifyPassword(passwordHash, "incorrect-password"),
    ).resolves.toBe(false);
  });
});
