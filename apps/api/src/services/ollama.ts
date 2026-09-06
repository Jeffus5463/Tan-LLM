const OLLAMA_HEALTH_TIMEOUT_MS = 3_000;

interface OllamaTagsResponse {
  models: Array<{
    name: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOllamaTagsResponse(value: unknown): value is OllamaTagsResponse {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    return false;
  }

  return value.models.every(
    (model) => isRecord(model) && typeof model.name === "string",
  );
}

export async function isOllamaAvailable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/tags", baseUrl), {
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function listInstalledModelNames(
  baseUrl: string,
): Promise<string[] | null> {
  try {
    const response = await fetch(new URL("/api/tags", baseUrl), {
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();

    if (!isOllamaTagsResponse(payload)) {
      return null;
    }

    const modelNames = payload.models
      .map((model) => model.name.trim())
      .filter((model) => model.length > 0);

    return [...new Set(modelNames)];
  } catch {
    return null;
  }
}
