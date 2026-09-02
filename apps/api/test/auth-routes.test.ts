import { Buffer } from "node:buffer";

import Fastify from "fastify";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { registerAuthRoutes } from "../src/auth/routes.js";
import { registerSession } from "../src/auth/session.js";
import { hashPassword } from "../src/auth/password.js";

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("correct-password");
});

function buildTestApp(sessionUsername = "owner") {
  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });
  registerSession(app, {
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  });

  registerAuthRoutes(app, {
    username: "owner",
    passwordHash,
  });

  onTestFinished(async () => {
    await app.close();
  });

  app.post("/test/session", async (request) => {
    request.session.set("username", sessionUsername);

    return { status: "created" };
  });

  return app;
}

describe("GET /api/auth/session", () => {
  it("returns 401 when no session cookie is supplied", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    {
      username: "owner",
      statusCode: 200,
      body: { username: "owner" },
    },
    {
      username: "someone-else",
      statusCode: 401,
      body: { error: "Unauthorized" },
    },
  ])(
    "returns $statusCode for a session belonging to $username",
    async ({ username, statusCode, body }) => {
      const app = buildTestApp(username);

      const created = await app.inject({
        method: "POST",
        url: "/test/session",
      });

      const cookie = created.cookies[0];

      if (!cookie) {
        throw new Error("Session cookie is missing.");
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        cookies: {
          tan_llm_session: cookie.value,
        },
      });

      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual(body);
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );
});

describe("POST /api/auth/logout", () => {
  it("expires the current session cookie", async () => {
    const app = buildTestApp();

    const created = await app.inject({
      method: "POST",
      url: "/test/session",
    });

    const cookie = created.cookies[0];

    if (!cookie) {
      throw new Error("Session cookie is missing.");
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    const expiredCookie = response.cookies[0];

    if (!expiredCookie) {
      throw new Error("Expired session cookie is missing.");
    }

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(expiredCookie.name).toBe("tan_llm_session");
    expect(expiredCookie.maxAge).toBe(0);
    expect(expiredCookie.expires).toEqual(new Date(0));
  });
});

describe("POST /api/auth/login", () => {
  it("creates a session for valid credentials", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "owner",
        password: "correct-password",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ username: "owner" });
    expect(response.headers["cache-control"]).toBe("no-store");

    const cookie = response.cookies[0];

    if (!cookie) {
      throw new Error("Session cookie is missing.");
    }

    expect(cookie.name).toBe("tan_llm_session");

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({ username: "owner" });
  });

  it.each([
    {
      caseName: "incorrect password",
      username: "owner",
      password: "wrong-password",
    },
    {
      caseName: "unknown username",
      username: "someone-else",
      password: "correct-password",
    },
  ])(
    "returns the same error for an $caseName",
    async ({ username, password }) => {
      const app = buildTestApp();

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username,
          password,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: "Invalid credentials",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.cookies).toEqual([]);
    },
  );

  it.each([
    {
      caseName: "missing password",
      payload: {
        username: "owner",
      },
    },
    {
      caseName: "unexpected property",
      payload: {
        username: "owner",
        password: "correct-password",
        unexpected: true,
      },
    },
  ])("rejects a body with an $caseName", async ({ payload }) => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects the sixth login attempt within fifteen minutes", async () => {
    const app = buildTestApp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "owner",
          password: "wrong-password",
        },
      });

      expect(response.statusCode).toBe(401);
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "owner",
        password: "wrong-password",
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
    });
    expect(response.headers["retry-after"]).toBeDefined();
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
