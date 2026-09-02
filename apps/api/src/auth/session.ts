import secureSession from "@fastify/secure-session";
import type { FastifyInstance } from "fastify";

import type { AuthConfig } from "./config.js";

declare module "@fastify/secure-session" {
  interface SessionData {
    username: string;
  }
}

export function registerSession(
  app: FastifyInstance,
  config: Pick<AuthConfig, "sessionKey" | "cookieSecure">,
): void {
  const lifetimeSeconds = 24 * 60 * 60;

  app.register(secureSession, {
    cookieName: "tan_llm_session",
    key: config.sessionKey,
    expiry: lifetimeSeconds,
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      signed: true,
      maxAge: lifetimeSeconds,
    },
  });
}
