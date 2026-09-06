import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isOllamaAvailable,
  listInstalledModelNames,
} from "../src/services/ollama.js";

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

describe("listInstalledModelNames", () => {
  it("returns unique model names from Ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: "qwen3.5:4b" },
            { name: "qwen3.5:2b" },
            { name: "qwen3.5:4b" },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listInstalledModelNames("http://ollama:11434"),
    ).resolves.toEqual(["qwen3.5:4b", "qwen3.5:2b"]);
  });

  it("returns null when Ollama returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(
      listInstalledModelNames("http://ollama:11434"),
    ).resolves.toBeNull();
  });

  it("returns null when Ollama returns an invalid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ models: "invalid" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      ),
    );

    await expect(
      listInstalledModelNames("http://ollama:11434"),
    ).resolves.toBeNull();
  });
});
