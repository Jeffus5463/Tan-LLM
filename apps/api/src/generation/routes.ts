import type { ServerResponse } from "node:http";

import type { FastifyInstance } from "fastify";

import { createRequireSession } from "../auth/guard.js";
import type {
  GenerationEvent,
  GenerationService,
} from "./service.js";

interface ChatParams {
  chatId: string;
}

interface MessageBody {
  content: string;
}

interface GenerationRoutesOptions {
  username: string;
  generationService: GenerationService;
}

const chatIdSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chatId"],
  properties: {
    chatId: {
      type: "string",
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    },
  },
} as const;

const messageBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: {
      type: "string",
      minLength: 1,
      maxLength: 16_000,
      pattern: "\\S",
    },
  },
} as const;

function writeEvent(
  response: ServerResponse,
  event: GenerationEvent | {
    type: "start";
    chatId: string;
    userMessageId: string;
    messageId: string;
  },
): void {
  const { type, ...data } = event;

  if (!response.destroyed) {
    response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export function registerGenerationRoutes(
  app: FastifyInstance,
  options: GenerationRoutesOptions,
): void {
  const requireSession = createRequireSession(options.username);

  app.register(async (generationRoutes) => {
    generationRoutes.addHook("onRequest", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
    });

    generationRoutes.addHook("onRequest", requireSession);

    generationRoutes.post<{
      Params: ChatParams;
      Body: MessageBody;
    }>(
      "/api/chats/:chatId/messages",
      {
        schema: {
          params: chatIdSchema,
          body: messageBodySchema,
        },
      },
      async (request, reply) => {
        const abortController = new AbortController();
        const result = options.generationService.start(
          request.params.chatId,
          request.body.content.trim(),
          abortController.signal,
        );

        if (result.status === "not-found") {
          return reply.code(404).send({ error: "Chat not found" });
        }

        if (result.status === "model-not-allowed") {
          return reply.code(400).send({ error: "Model not allowed" });
        }

        if (result.status === "busy") {
          return reply.code(409).send({ error: "Generation in progress" });
        }

        let streamEnded = false;
        const handleClose = () => {
          if (!streamEnded) {
            abortController.abort();
          }
        };

        reply.hijack();
        reply.raw.once("close", handleClose);
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        writeEvent(reply.raw, {
          type: "start",
          chatId: request.params.chatId,
          userMessageId: result.run.userMessageId,
          messageId: result.run.assistantMessageId,
        });

        try {
          for await (const event of result.run.events) {
            writeEvent(reply.raw, event);
          }
        } finally {
          streamEnded = true;
          reply.raw.off("close", handleClose);

          if (!reply.raw.destroyed && !reply.raw.writableEnded) {
            reply.raw.end();
          }
        }
      },
    );
  });
}
