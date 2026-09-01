const OLLAMA_HEALTH_TIMEOUT_MS = 3_000;

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
