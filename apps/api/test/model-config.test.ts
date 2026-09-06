import { describe, expect, it } from "vitest";

import { loadModelConfig } from "../src/models/config.js";

describe("loadModelConfig", () => {
  it("uses the default model when no settings are supplied", () => {
    expect(loadModelConfig({})).toEqual({
      defaultModel: "qwen3.5:4b",
      allowedModels: ["qwen3.5:4b"],
    });
  });

  it("includes the primary model and configured additional models", () => {
    expect(
      loadModelConfig({
        OLLAMA_MODEL: "qwen3.5:4b",
        OLLAMA_ALLOWED_MODELS: "qwen3.5:2b, llama3.2:3b",
      }),
    ).toEqual({
      defaultModel: "qwen3.5:4b",
      allowedModels: [
        "qwen3.5:4b",
        "qwen3.5:2b",
        "llama3.2:3b",
      ],
    });
  });

  it("trims names and removes duplicate allowlist entries", () => {
    expect(
      loadModelConfig({
        OLLAMA_MODEL: " qwen3.5:4b ",
        OLLAMA_ALLOWED_MODELS:
          "qwen3.5:4b, qwen3.5:2b, qwen3.5:2b,",
      }),
    ).toEqual({
      defaultModel: "qwen3.5:4b",
      allowedModels: ["qwen3.5:4b", "qwen3.5:2b"],
    });
  });
});
