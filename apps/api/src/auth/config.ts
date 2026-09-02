import { Buffer } from "node:buffer";

import { verifyPassword } from "./password.js";

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionKey: Buffer;
  cookieSecure: boolean;
}

export async function loadAuthConfig(
  environment: NodeJS.ProcessEnv,
): Promise<AuthConfig> {
  const username = environment.AUTH_USERNAME?.trim();
  const passwordHash = environment.AUTH_PASSWORD_HASH?.trim();
  const sessionSecret = environment.SESSION_SECRET;
  const cookieSecure = environment.COOKIE_SECURE ?? "true";

  if (!username) {
    throw new Error("AUTH_USERNAME is required.");
  }

  if (!passwordHash || !passwordHash.startsWith("$argon2id$")) {
    throw new Error("AUTH_PASSWORD_HASH must be a valid Argon2id hash.");
  }

  if (!sessionSecret || !/^[0-9a-f]{64}$/i.test(sessionSecret)) {
    throw new Error(
      "SESSION_SECRET must contain exactly 64 hexadecimal characters.",
    );
  }

  if (cookieSecure !== "true" && cookieSecure !== "false") {
    throw new Error("COOKIE_SECURE must be either true or false.");
  }

  if (cookieSecure === "false" && environment.NODE_ENV !== "development") {
    throw new Error(
      "COOKIE_SECURE=false is allowed only when NODE_ENV=development.",
    );
  }

  try {
    // Exercise the parser and verification path to validate the stored hash.
    await verifyPassword(passwordHash, "");
  } catch {
    throw new Error("AUTH_PASSWORD_HASH must be a valid Argon2id hash.");
  }

  return {
    username,
    passwordHash,
    sessionKey: Buffer.from(sessionSecret, "hex"),
    cookieSecure: cookieSecure === "true",
  };
}
