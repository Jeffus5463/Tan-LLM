import { Buffer } from "node:buffer";

import Fastify from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";

import { createRequireSession } from "../src/auth/guard.js";
import { registerSession } from "../src/auth/session.js";

function buildTestApp(sessionUsername?: string) {
  const app = Fastify();

  registerSession(app, {
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  });

  app.post("/test/session", async (request) => {
    if (sessionUsername) {
      request.session.set("username", sessionUsername);
    }

    return { status: "created" };
  });

  app.get(
    "/protected",
    {
      onRequest: createRequireSession("owner"),
    },
    async (request) => {
      return {
        username: request.session.get("username"),
      };
    },
  );

  onTestFinished(async () => {
    await app.close();
  });

  return app;
}

async function requestProtected(sessionUsername?: string) {
  const app = buildTestApp(sessionUsername);

  if (!sessionUsername) {
    return app.inject({
      method: "GET",
      url: "/protected",
    });
  }

  const created = await app.inject({
    method: "POST",
    url: "/test/session",
  });

  const cookie = created.cookies[0];

  if (!cookie) {
    throw new Error("Session cookie is missing.");
  }

  return app.inject({
    method: "GET",
    url: "/protected",
    cookies: {
      tan_llm_session: cookie.value,
    },
  });
}

describe("createRequireSession", () => {
  it.each([
    {
      sessionUsername: undefined,
      statusCode: 401,
      body: { error: "Unauthorized" },
    },
    {
      sessionUsername: "someone-else",
      statusCode: 401,
      body: { error: "Unauthorized" },
    },
    {
      sessionUsername: "owner",
      statusCode: 200,
      body: { username: "owner" },
    },
  ])(
    "returns $statusCode for session username $sessionUsername",
    async ({ sessionUsername, statusCode, body }) => {
      const response = await requestProtected(sessionUsername);

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual(body);
    },
  );
});
