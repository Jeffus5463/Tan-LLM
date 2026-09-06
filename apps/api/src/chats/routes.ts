import type { FastifyInstance } from "fastify";

import { createRequireSession } from "../auth/guard.js";
import type { GenerationCoordinator } from "../generation/coordinator.js";
import type { ModelConfig } from "../models/config.js";
import type { ChatRepository } from "./repository.js";

const DEFAULT_CHAT_TITLE = "New chat";

interface ChatParams {
  chatId: string;
}

interface CreateChatBody {
  title?: string;
  model?: string;
}

interface UpdateChatBody {
  title?: string;
  model?: string;
}

interface ChatRoutesOptions extends ModelConfig {
  username: string;
  repository: ChatRepository;
  generationCoordinator: GenerationCoordinator;
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

const titleSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "\\S",
} as const;

const modelSchema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const createChatBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: titleSchema,
    model: modelSchema,
  },
} as const;

const updateChatBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: titleSchema,
    model: modelSchema,
  },
} as const;

export function registerChatRoutes(
  app: FastifyInstance,
  options: ChatRoutesOptions,
): void {
  const requireSession = createRequireSession(options.username);
  const allowedModels = new Set(options.allowedModels);

  if (!allowedModels.has(options.defaultModel)) {
    throw new Error("The default model must be included in the allowlist.");
  }

  app.register(async (chatRoutes) => {
    chatRoutes.addHook("onRequest", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
    });

    chatRoutes.addHook("onRequest", requireSession);

    chatRoutes.get("/api/chats", async () => {
      return {
        chats: options.repository.listChats(),
      };
    });

    chatRoutes.post<{ Body: CreateChatBody }>(
      "/api/chats",
      {
        schema: {
          body: createChatBodySchema,
        },
      },
      async (request, reply) => {
        const title = request.body.title?.trim() ?? DEFAULT_CHAT_TITLE;
        const model = request.body.model?.trim() ?? options.defaultModel;

        if (!allowedModels.has(model)) {
          return reply.code(400).send({
            error: "Model not allowed",
          });
        }

        const chat = options.repository.createChat({ title, model });

        return reply.code(201).send({ chat });
      },
    );

    chatRoutes.get<{ Params: ChatParams }>(
      "/api/chats/:chatId",
      {
        schema: {
          params: chatIdSchema,
        },
      },
      async (request, reply) => {
        const chat = options.repository.getChat(request.params.chatId);

        if (!chat) {
          return reply.code(404).send({
            error: "Chat not found",
          });
        }

        return { chat };
      },
    );

    chatRoutes.patch<{
      Params: ChatParams;
      Body: UpdateChatBody;
    }>(
      "/api/chats/:chatId",
      {
        schema: {
          params: chatIdSchema,
          body: updateChatBodySchema,
        },
      },
      async (request, reply) => {
        const existingChat = options.repository.getChatSummary(
          request.params.chatId,
        );

        if (!existingChat) {
          return reply.code(404).send({
            error: "Chat not found",
          });
        }

        const title = request.body.title?.trim();
        const model = request.body.model?.trim();

        if (model && !allowedModels.has(model)) {
          return reply.code(400).send({
            error: "Model not allowed",
          });
        }

        if (
          model !== undefined &&
          options.generationCoordinator.isChatActive(request.params.chatId)
        ) {
          return reply.code(409).send({
            error: "Chat is currently generating",
          });
        }

        const chat = options.repository.updateChat(request.params.chatId, {
          ...(title !== undefined ? { title } : {}),
          ...(model !== undefined ? { model } : {}),
        });

        if (!chat) {
          return reply.code(404).send({
            error: "Chat not found",
          });
        }

        return { chat };
      },
    );

    chatRoutes.delete<{ Params: ChatParams }>(
      "/api/chats/:chatId",
      {
        schema: {
          params: chatIdSchema,
        },
      },
      async (request, reply) => {
        if (!options.repository.getChatSummary(request.params.chatId)) {
          return reply.code(404).send({
            error: "Chat not found",
          });
        }

        if (
          options.generationCoordinator.isChatActive(request.params.chatId)
        ) {
          return reply.code(409).send({
            error: "Chat is currently generating",
          });
        }

        options.repository.deleteChat(request.params.chatId);

        return reply.code(204).send();
      },
    );
  });
}
