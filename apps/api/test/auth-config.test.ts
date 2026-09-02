import { beforeAll, describe, expect, it } from "vitest";

import { loadAuthConfig } from "../src/auth/config.js";
import { hashPassword } from "../src/auth/password.js";

describe("loadAuthConfig", () => {
  let environment: NodeJS.ProcessEnv;

  beforeAll(async () => {
    environment = {
      AUTH_USERNAME: "owner",
      AUTH_PASSWORD_HASH: await hashPassword("example-password-for-tests"),
      SESSION_SECRET: "ab".repeat(32),
    };
  });

  it("loads valid settings and defaults to secure cookies", async () => {
    const config = await loadAuthConfig(environment);

    expect(config.username).toBe("owner");
    expect(config.passwordHash).toBe(environment.AUTH_PASSWORD_HASH);
    expect(config.sessionKey).toEqual(Buffer.from("ab".repeat(32), "hex"));
    expect(config.cookieSecure).toBe(true);
  });

  it("allows disabling secure cookies in development", async () => {
    const config = await loadAuthConfig({
      ...environment,
      NODE_ENV: "development",
      COOKIE_SECURE: "false",
    });

    expect(config.cookieSecure).toBe(false);
  });

  it.each(["production", undefined])(
    "rejects insecure cookies when NODE_ENV is %s",
    async (nodeEnvironment) => {
      await expect(
        loadAuthConfig({
          ...environment,
          NODE_ENV: nodeEnvironment,
          COOKIE_SECURE: "false",
        }),
      ).rejects.toThrow(
        "COOKIE_SECURE=false is allowed only when NODE_ENV=development.",
      );
    },
  );

  it.each(["AUTH_USERNAME", "AUTH_PASSWORD_HASH", "SESSION_SECRET"])(
    "rejects a missing %s",
    async (key) => {
      await expect(
        loadAuthConfig({
          ...environment,
          [key]: undefined,
        }),
      ).rejects.toThrow(key);
    },
  );

  it("rejects a malformed Argon2id hash", async () => {
    await expect(
      loadAuthConfig({
        ...environment,
        AUTH_PASSWORD_HASH: "$argon2id$invalid",
      }),
    ).rejects.toThrow("AUTH_PASSWORD_HASH");
  });

  it("rejects a session key containing non-hexadecimal characters", async () => {
    await expect(
      loadAuthConfig({
        ...environment,
        SESSION_SECRET: "g".repeat(64),
      }),
    ).rejects.toThrow("SESSION_SECRET");
  });

  it("rejects an invalid cookie setting", async () => {
    await expect(
      loadAuthConfig({
        ...environment,
        COOKIE_SECURE: "yes",
      }),
    ).rejects.toThrow("COOKIE_SECURE");
  });
});
