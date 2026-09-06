import { Buffer } from "node:buffer";

import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { buildApp } from "../src/app.js";
import type { AuthConfig } from "../src/auth/config.js";
import { hashPassword } from "../src/auth/password.js";
import { initializeDatabase } from "../src/database/initialize.js";
import { GenerationCoordinator } from "../src/generation/coordinator.js";

let authConfig: AuthConfig;

beforeAll(async () => {
  authConfig = {
    username: "owner",
    passwordHash: await hashPassword("test-password"),
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  };
});

describe("GET /healthz", () => {
  it("returns the API health status", async () => {
    const app = buildApp({ authConfig });

    onTestFinished(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
    });
  });
});

describe("GET /readyz", () => {
  it("returns ready when Ollama is available", async () => {
    const app = buildApp({
      authConfig,
      checkOllama: async () => true,
    });

    onTestFinished(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "GET",
      url: "/readyz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      services: {
        ollama: "available",
      },
    });
  });

  it("returns unavailable when Ollama is offline", async () => {
    const app = buildApp({
      authConfig,
      checkOllama: async () => false,
    });

    onTestFinished(async () => {
      await app.close();
    });

    const response = await app.inject({
      method: "GET",
      url: "/readyz",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      services: {
        ollama: "offline",
      },
    });
  });
});

describe("database lifecycle", () => {
  it("closes the database when the application closes", async () => {
    const database = initializeDatabase(":memory:");
    const app = buildApp({
      authConfig,
      database,
    });

    onTestFinished(async () => {
      await app.close();
    });

    expect(app.database).toBe(database);
    expect(database.open).toBe(true);

    await app.close();

    expect(database.open).toBe(false);
  });
});

describe("authentication integration", () => {
  it("creates and reads a session through the application", async () => {
    const app = buildApp({ authConfig });

    onTestFinished(async () => {
      await app.close();
    });

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(anonymousResponse.statusCode).toBe(401);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "owner",
        password: "test-password",
      },
    });

    expect(loginResponse.statusCode).toBe(200);

    const cookie = loginResponse.cookies.find(
      (cookie) => cookie.name === "tan_llm_session",
    );

    if (!cookie) {
      throw new Error("Session cookie is missing.");
    }

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({
      username: "owner",
    });
  });
});

describe("application status integration", () => {
  it("tracks the shared generation coordinator", async () => {
    const generationCoordinator = new GenerationCoordinator();
    const app = buildApp({
      authConfig,
      checkOllama: async () => true,
      generationCoordinator,
    });

    onTestFinished(async () => {
      await app.close();
    });

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(anonymousResponse.statusCode).toBe(401);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "owner",
        password: "test-password",
      },
    });

    const cookie = loginResponse.cookies.find(
      (candidate) => candidate.name === "tan_llm_session",
    );

    if (!cookie) {
      throw new Error("Session cookie is missing.");
    }

    const idleStatusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(idleStatusResponse.statusCode).toBe(200);
    expect(idleStatusResponse.headers["cache-control"]).toBe("no-store");
    expect(idleStatusResponse.json()).toEqual({
      services: {
        ollama: "available",
      },
      activeGeneration: null,
    });

    const lease = generationCoordinator.tryAcquire({
      chatId: "chat-1",
      messageId: "message-2",
    });

    if (!lease) {
      throw new Error("The generation lease was not acquired.");
    }

    const activeStatusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(activeStatusResponse.statusCode).toBe(200);
    expect(activeStatusResponse.json()).toEqual({
      services: {
        ollama: "available",
      },
      activeGeneration: {
        chatId: "chat-1",
        messageId: "message-2",
      },
    });

    lease.release();

    const releasedStatusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
      cookies: {
        tan_llm_session: cookie.value,
      },
    });

    expect(releasedStatusResponse.statusCode).toBe(200);
    expect(releasedStatusResponse.json()).toEqual({
      services: {
        ollama: "available",
      },
      activeGeneration: null,
    });
  });
});
