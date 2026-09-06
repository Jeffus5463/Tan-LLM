import type { FastifyInstance } from "fastify";

import { createRequireSession } from "../auth/guard.js";
import type { ActiveGeneration } from "../generation/coordinator.js";

interface StatusRoutesOptions {
  username: string;
  ollamaBaseUrl: string;
  checkOllama: (baseUrl: string) => Promise<boolean>;
  getActiveGeneration: () => ActiveGeneration | null;
}

export function registerStatusRoutes(
  app: FastifyInstance,
  options: StatusRoutesOptions,
): void {
  const requireSession = createRequireSession(options.username);

  app.register(async (statusRoutes) => {
    statusRoutes.addHook("onRequest", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
    });

    statusRoutes.addHook("onRequest", requireSession);

    statusRoutes.get("/api/status", async () => {
      const ollamaAvailable = await options.checkOllama(options.ollamaBaseUrl);

      return {
        services: {
          ollama: ollamaAvailable ? "available" : "offline",
        },
        activeGeneration: options.getActiveGeneration(),
      };
    });
  });
}
