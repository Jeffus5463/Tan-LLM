const DEFAULT_MODEL = "qwen3.5:4b";

export interface ModelConfig {
  defaultModel: string;
  allowedModels: readonly string[];
}

function readModelNames(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

export function loadModelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const defaultModel = environment.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  const additionalModels = readModelNames(
    environment.OLLAMA_ALLOWED_MODELS,
  );

  return {
    defaultModel,
    allowedModels: [...new Set([defaultModel, ...additionalModels])],
  };
}
