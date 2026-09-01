import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

describe("GET /healthz", () => {
  it("returns the API health status", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
    });

    await app.close();
  });
});

describe("GET /readyz", () => {
  it("returns ready when Ollama is available", async () => {
    const app = buildApp({
      checkOllama: async () => true,
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

    await app.close();
  });

  it("returns unavailable when Ollama is offline", async () => {
    const app = buildApp({
      checkOllama: async () => false,
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

    await app.close();
  });
});
