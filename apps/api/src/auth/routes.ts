import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

import type { AuthConfig } from "./config.js";
import { verifyPassword } from "./password.js";

interface LoginBody {
  username: string;
  password: string;
}

const loginBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["username", "password"],
  properties: {
    username: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    password: {
      type: "string",
      minLength: 1,
      maxLength: 1024,
    },
  },
} as const;

export function registerAuthRoutes(
  app: FastifyInstance,
  config: Pick<AuthConfig, "username" | "passwordHash">,
): void {
  app.register(async (authRoutes) => {
    authRoutes.addHook("onRequest", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
    });

    await authRoutes.register(rateLimit, {
      global: false,
    });

    authRoutes.post<{ Body: LoginBody }>(
      "/api/auth/login",
      {
        schema: {
          body: loginBodySchema,
        },
        config: {
          rateLimit: {
            max: 5,
            timeWindow: 15 * 60 * 1000,
          },
        },
      },
      async (request, reply) => {
        const usernameMatches = request.body.username === config.username;
        const passwordMatches = await verifyPassword(
          config.passwordHash,
          request.body.password,
        );

        if (!usernameMatches || !passwordMatches) {
          return reply.code(401).send({
            error: "Invalid credentials",
          });
        }

        request.session.regenerate();
        request.session.set("username", config.username);

        return {
          username: config.username,
        };
      },
    );

    authRoutes.get("/api/auth/session", async (request, reply) => {
      const username = request.session.get("username");

      if (username !== config.username) {
        return reply.code(401).send({
          error: "Unauthorized",
        });
      }

      return { username };
    });

    authRoutes.post("/api/auth/logout", async (request, reply) => {
      request.session.delete();

      return reply.code(204).send();
    });
  });
}
