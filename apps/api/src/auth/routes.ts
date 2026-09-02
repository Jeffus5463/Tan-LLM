import type { FastifyInstance } from "fastify";

import type { AuthConfig } from "./config.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  config: Pick<AuthConfig, "username">,
): void {
  app.get("/api/auth/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const username = request.session.get("username");

    if (username !== config.username) {
      return reply.code(401).send({
        error: "Unauthorized",
      });
    }

    return { username };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    request.session.delete();
    reply.header("Cache-Control", "no-store");

    return reply.code(204).send();
  });
}
