import { randomUUID } from "node:crypto";

import type { ChatRepository } from "../chats/repository.js";
import type { GenerationCoordinator, GenerationLease } from "./coordinator.js";
import {
  trimConversationContext,
  type ConversationMessage,
} from "./context.js";
import type { StreamOllamaChat } from "./ollama.js";

const PARTIAL_SAVE_INTERVAL_MS = 1_000;

export type GenerationEvent =
  | { type: "token"; content: string }
  | { type: "completion"; messageId: string }
  | { type: "cancellation"; messageId: string }
  | { type: "error"; messageId: string; message: string };

export interface GenerationRun {
  userMessageId: string;
  assistantMessageId: string;
  events: AsyncIterable<GenerationEvent>;
}

export type StartGenerationResult =
  | { status: "not-found" }
  | { status: "model-not-allowed" }
  | { status: "busy" }
  | { status: "started"; run: GenerationRun };

interface GenerationServiceOptions {
  repository: ChatRepository;
  coordinator: GenerationCoordinator;
  allowedModels: readonly string[];
  ollamaBaseUrl: string;
  streamChat: StreamOllamaChat;
  createId?: () => string;
  clock?: () => number;
}

export class GenerationService {
  private readonly allowedModels: ReadonlySet<string>;
  private readonly createId: () => string;
  private readonly clock: () => number;

  constructor(private readonly options: GenerationServiceOptions) {
    this.allowedModels = new Set(options.allowedModels);
    this.createId = options.createId ?? randomUUID;
    this.clock = options.clock ?? Date.now;
  }

  start(
    chatId: string,
    content: string,
    signal: AbortSignal,
  ): StartGenerationResult {
    const chat = this.options.repository.getChatSummary(chatId);

    if (!chat) {
      return { status: "not-found" };
    }

    if (!this.allowedModels.has(chat.model)) {
      return { status: "model-not-allowed" };
    }

    const userMessageId = this.createId();
    const assistantMessageId = this.createId();
    const lease = this.options.coordinator.tryAcquire({
      chatId,
      messageId: assistantMessageId,
    });

    if (!lease) {
      return { status: "busy" };
    }

    let messages: ConversationMessage[];

    try {
      const previousMessages =
        this.options.repository.getContextMessages(chatId);

      this.options.repository.createGenerationMessages({
        chatId,
        userMessageId,
        assistantMessageId,
        content,
      });

      messages = trimConversationContext([
        ...previousMessages,
        {
          role: "user",
          content,
        },
      ]);
    } catch (error) {
      lease.release();
      throw error;
    }

    return {
      status: "started",
      run: {
        userMessageId,
        assistantMessageId,
        events: this.generate({
          model: chat.model,
          messages,
          assistantMessageId,
          lease,
          signal,
        }),
      },
    };
  }

  private async *generate(input: {
    model: string;
    messages: readonly ConversationMessage[];
    assistantMessageId: string;
    lease: GenerationLease;
    signal: AbortSignal;
  }): AsyncGenerator<GenerationEvent> {
    let content = "";
    let finalized = false;
    let lastSavedAt = this.clock();

    try {
      const chunks = this.options.streamChat({
        baseUrl: this.options.ollamaBaseUrl,
        model: input.model,
        messages: input.messages,
        signal: input.signal,
      });

      for await (const chunk of chunks) {
        content += chunk;

        const currentTime = this.clock();

        if (currentTime - lastSavedAt >= PARTIAL_SAVE_INTERVAL_MS) {
          this.options.repository.saveAssistantMessage(
            input.assistantMessageId,
            content,
            "streaming",
          );
          lastSavedAt = currentTime;
        }

        yield {
          type: "token",
          content: chunk,
        };
      }

      this.options.repository.saveAssistantMessage(
        input.assistantMessageId,
        content,
        "complete",
      );
      finalized = true;

      yield {
        type: "completion",
        messageId: input.assistantMessageId,
      };
    } catch {
      const cancelled = input.signal.aborted;

      this.options.repository.saveAssistantMessage(
        input.assistantMessageId,
        content,
        cancelled ? "cancelled" : "error",
      );
      finalized = true;

      if (cancelled) {
        yield {
          type: "cancellation",
          messageId: input.assistantMessageId,
        };
      } else {
        yield {
          type: "error",
          messageId: input.assistantMessageId,
          message: "Generation failed",
        };
      }
    } finally {
      try {
        if (!finalized) {
          this.options.repository.saveAssistantMessage(
            input.assistantMessageId,
            content,
            input.signal.aborted ? "cancelled" : "interrupted",
          );
        }
      } finally {
        input.lease.release();
      }
    }
  }
}
