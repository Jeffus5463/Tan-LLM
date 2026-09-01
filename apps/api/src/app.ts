import Fastify from "fastify";

import { isOllamaAvailable } from "./services/ollama.js";

interface BuildAppOptions {
  ollamaBaseUrl?: string;
  checkOllama?: (baseUrl: string) => Promise<boolean>;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  const ollamaBaseUrl =
    options.ollamaBaseUrl ??
    process.env.OLLAMA_BASE_URL ??
    "http://ollama:11434";

  const checkOllama = options.checkOllama ?? isOllamaAvailable;

  app.get("/healthz", async () => {
    return {
      status: "ok",
    };
  });

  app.get("/readyz", async (_request, reply) => {
    const ollamaAvailable = await checkOllama(ollamaBaseUrl);

    if (!ollamaAvailable) {
      return reply.code(503).send({
        status: "unavailable",
        services: {
          ollama: "offline",
        },
      });
    }

    return {
      status: "ready",
      services: {
        ollama: "available",
      },
    };
  });

  return app;
}
