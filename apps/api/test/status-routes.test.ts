import { Buffer } from "node:buffer";

import Fastify from "fastify";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { registerSession } from "../src/auth/session.js";
import type { ActiveGeneration } from "../src/generation/coordinator.js";
import { registerStatusRoutes } from "../src/status/routes.js";

interface TestAppOptions {
  checkOllama?: (baseUrl: string) => Promise<boolean>;
  getActiveGeneration?: () => ActiveGeneration | null;
}

function buildTestApp(options: TestAppOptions = {}) {
  const app = Fastify();

  registerSession(app, {
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  });

  app.post("/test/session", async (request) => {
    request.session.set("username", "owner");

    return {
      status: "created",
    };
  });

  registerStatusRoutes(app, {
    username: "owner",
    ollamaBaseUrl: "http://ollama:11434",
    checkOllama: options.checkOllama ?? (async () => true),
    getActiveGeneration: options.getActiveGeneration ?? (() => null),
  });

  onTestFinished(async () => {
    await app.close();
  });

  return app;
}

async function createSessionCookie(
  app: ReturnType<typeof buildTestApp>,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/test/session",
  });

  const cookie = response.cookies.find(
    (candidate) => candidate.name === "tan_llm_session",
  );

  if (!cookie) {
    throw new Error("Session cookie is missing.");
  }

  return cookie.value;
}

describe("GET /api/status", () => {
  it("rejects requests without an authenticated session", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: "Unauthorized",
    });
  });

  it("reports available Ollama and no active generation", async () => {
    const checkOllama = vi.fn(async () => true);
    const app = buildTestApp({ checkOllama });
    const cookie = await createSessionCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/status",
      cookies: {
        tan_llm_session: cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      services: {
        ollama: "available",
      },
      activeGeneration: null,
    });
    expect(checkOllama).toHaveBeenCalledOnce();
    expect(checkOllama).toHaveBeenCalledWith("http://ollama:11434");
  });

  it("reports offline Ollama and the active generation", async () => {
    const app = buildTestApp({
      checkOllama: async () => false,
      getActiveGeneration: () => ({
        chatId: "chat-1",
        messageId: "message-2",
      }),
    });
    const cookie = await createSessionCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/status",
      cookies: {
        tan_llm_session: cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      services: {
        ollama: "offline",
      },
      activeGeneration: {
        chatId: "chat-1",
        messageId: "message-2",
      },
    });
  });
});
