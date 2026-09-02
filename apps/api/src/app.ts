import type Database from "better-sqlite3";
import Fastify from "fastify";

import "./types/fastify.js";
import { initializeDatabase } from "./database/initialize.js";
import { isOllamaAvailable } from "./services/ollama.js";

interface BuildAppOptions {
  database?: Database.Database;
  ollamaBaseUrl?: string;
  checkOllama?: (baseUrl: string) => Promise<boolean>;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  const database =
    options.database ??
    initializeDatabase(process.env.DATABASE_PATH ?? ":memory:");

  const ollamaBaseUrl =
    options.ollamaBaseUrl ??
    process.env.OLLAMA_BASE_URL ??
    "http://ollama:11434";

  const checkOllama = options.checkOllama ?? isOllamaAvailable;

  app.decorate("database", database);

  app.addHook("onClose", async () => {
    if (app.database.open) {
      app.database.close();
    }
  });

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
