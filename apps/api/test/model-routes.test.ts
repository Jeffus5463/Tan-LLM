import { Buffer } from "node:buffer";

import Fastify from "fastify";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { registerSession } from "../src/auth/session.js";
import { registerModelRoutes } from "../src/models/routes.js";

interface TestAppOptions {
  installedModels?: readonly string[] | null;
}

function buildTestApp(options: TestAppOptions = {}) {
  const app = Fastify();

  registerSession(app, {
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  });

  app.post("/test/session", async (request) => {
    request.session.set("username", "owner");

    return { status: "created" };
  });

  const listInstalledModels = vi.fn(
    async () =>
      options.installedModels === undefined
        ? []
        : options.installedModels,
  );

  registerModelRoutes(app, {
    username: "owner",
    ollamaBaseUrl: "http://ollama:11434",
    defaultModel: "qwen3.5:4b",
    allowedModels: [
      "qwen3.5:4b",
      "qwen3.5:2b",
      "not-installed:1b",
    ],
    listInstalledModels,
  });

  onTestFinished(async () => {
    await app.close();
  });

  return { app, listInstalledModels };
}

async function createSessionCookie(
  app: ReturnType<typeof buildTestApp>["app"],
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

describe("GET /api/models", () => {
  it("rejects requests without an authenticated session", async () => {
    const { app, listInstalledModels } = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/models",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "Unauthorized" });
    expect(listInstalledModels).not.toHaveBeenCalled();
  });

  it("returns only configured models that are installed", async () => {
    const { app, listInstalledModels } = buildTestApp({
      installedModels: [
        "unconfigured:7b",
        "qwen3.5:2b",
        "qwen3.5:4b",
      ],
    });
    const cookie = await createSessionCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/models",
      cookies: {
        tan_llm_session: cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      defaultModel: "qwen3.5:4b",
      models: ["qwen3.5:4b", "qwen3.5:2b"],
    });
    expect(listInstalledModels).toHaveBeenCalledWith(
      "http://ollama:11434",
    );
  });

  it("returns a null default when the primary model is not installed", async () => {
    const { app } = buildTestApp({
      installedModels: ["qwen3.5:2b"],
    });
    const cookie = await createSessionCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/models",
      cookies: {
        tan_llm_session: cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      defaultModel: null,
      models: ["qwen3.5:2b"],
    });
  });

  it("returns unavailable when Ollama cannot list models", async () => {
    const { app } = buildTestApp({
      installedModels: null,
    });
    const cookie = await createSessionCookie(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/models",
      cookies: {
        tan_llm_session: cookie,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Ollama unavailable",
    });
  });
});
