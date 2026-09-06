import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getSession } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("preserves the server status and message for unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        }),
      ),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("reports invalid JSON instead of returning an unsafe value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 200,
      message: "The server returned invalid data.",
    });
  });

  it("normalizes network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );

    const error = await getSession().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 0,
      message: "The local service could not be reached.",
    });
  });
});
