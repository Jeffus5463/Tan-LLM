import type { FastifyReply, FastifyRequest } from "fastify";

export function createRequireSession(expectedUsername: string) {
  return async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const username = request.session.get("username");

    if (username !== expectedUsername) {
      return reply.code(401).send({
        error: "Unauthorized",
      });
    }
  };
}
