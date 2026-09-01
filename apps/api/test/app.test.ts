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
