import { Buffer } from "node:buffer";

import Fastify from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";

import { registerSession } from "../src/auth/session.js";

function buildTestApp(cookieSecure = true) {
  const app = Fastify();

  registerSession(app, {
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure,
  });

  onTestFinished(async () => {
    await app.close();
  });

  app.post("/test/session", async (request) => {
    request.session.set("username", "owner");

    return { status: "created" };
  });

  app.get("/test/session", async (request) => {
    return {
      username: request.session.get("username") ?? null,
    };
  });

  return app;
}

describe("session cookies", () => {
  it("sets the required cookie attributes", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/test/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies[0]).toMatchObject({
      name: "tan_llm_session",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 86400,
    });
  });

  it("restores session data from a valid cookie", async () => {
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
      method: "GET",
      url: "/test/session",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ username: "owner" });
  });

  it("does not restore session data from a tampered cookie", async () => {
    const app = buildTestApp();

    const created = await app.inject({
      method: "POST",
      url: "/test/session",
    });

    const cookie = created.cookies[0];

    if (!cookie) {
      throw new Error("Session cookie is missing.");
    }

    const tamperedValue =
      (cookie.value.startsWith("A") ? "B" : "A") + cookie.value.slice(1);

    const response = await app.inject({
      method: "GET",
      url: "/test/session",
      cookies: {
        tan_llm_session: tamperedValue,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ username: null });
  });

  it("omits the Secure attribute when configured for local HTTP", async () => {
    const app = buildTestApp(false);

    const response = await app.inject({
      method: "POST",
      url: "/test/session",
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies[0]).toBeDefined();
    expect(response.cookies[0]?.secure).not.toBe(true);
  });
});
