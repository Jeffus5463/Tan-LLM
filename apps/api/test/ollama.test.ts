import { afterEach, describe, expect, it, vi } from "vitest";

import { isOllamaAvailable } from "../src/services/ollama.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isOllamaAvailable", () => {
  it("returns true when Ollama responds successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(isOllamaAvailable("http://ollama:11434")).resolves.toBe(true);
  });

  it("returns false when Ollama returns an error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 503,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(isOllamaAvailable("http://ollama:11434")).resolves.toBe(false);
  });

  it("returns false when Ollama cannot be reached", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(isOllamaAvailable("http://ollama:11434")).resolves.toBe(false);
  });
});
