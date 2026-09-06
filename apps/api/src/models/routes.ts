import type { FastifyInstance } from "fastify";

import { createRequireSession } from "../auth/guard.js";
import type { ModelConfig } from "./config.js";

interface ModelRoutesOptions extends ModelConfig {
  ollamaBaseUrl: string;
  listInstalledModels: (baseUrl: string) => Promise<readonly string[] | null>;
}

export function registerModelRoutes(
  app: FastifyInstance,
  options: ModelRoutesOptions & { username: string },
): void {
  const requireSession = createRequireSession(options.username);

  app.register(async (modelRoutes) => {
    modelRoutes.addHook("onRequest", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
    });

    modelRoutes.addHook("onRequest", requireSession);

    modelRoutes.get("/api/models", async (_request, reply) => {
      const installedModels = await options.listInstalledModels(
        options.ollamaBaseUrl,
      );

      if (!installedModels) {
        return reply.code(503).send({
          error: "Ollama unavailable",
        });
      }

      const installedModelNames = new Set(installedModels);
      const models = options.allowedModels.filter((model) =>
        installedModelNames.has(model),
      );

      return {
        defaultModel: models.includes(options.defaultModel)
          ? options.defaultModel
          : null,
        models,
      };
    });
  });
}
