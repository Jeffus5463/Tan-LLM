import { describe, expect, it, onTestFinished, vi } from "vitest";

import { ChatRepository } from "../src/chats/repository.js";
import { initializeDatabase } from "../src/database/initialize.js";
import { GenerationCoordinator } from "../src/generation/coordinator.js";
import type {
  OllamaChatRequest,
  StreamOllamaChat,
} from "../src/generation/ollama.js";
import {
  GenerationService,
  type GenerationEvent,
} from "../src/generation/service.js";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";
const USER_MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const ASSISTANT_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";

interface TestServiceOptions {
  streamChat: StreamOllamaChat;
  model?: string;
  allowedModels?: readonly string[];
  clock?: () => number;
}

function buildTestService(options: TestServiceOptions) {
  const database = initializeDatabase(":memory:");
  const repository = new ChatRepository(database, () => CHAT_ID);
  const coordinator = new GenerationCoordinator();
  const identifiers = [USER_MESSAGE_ID, ASSISTANT_MESSAGE_ID];
  const chat = repository.createChat({
    title: "Test chat",
    model: options.model ?? "qwen3.5:4b",
  });
  const service = new GenerationService({
    repository,
    coordinator,
    allowedModels: options.allowedModels ?? ["qwen3.5:4b"],
    ollamaBaseUrl: "http://ollama:11434",
    streamChat: options.streamChat,
    createId: () => identifiers.shift() ?? crypto.randomUUID(),
    ...(options.clock ? { clock: options.clock } : {}),
  });

  onTestFinished(() => {
    database.close();
  });

  return { chat, coordinator, repository, service };
}

async function collect(
  events: AsyncIterable<GenerationEvent>,
): Promise<GenerationEvent[]> {
  const collected: GenerationEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("GenerationService", () => {
  it("streams a response, saves partial content, and completes the message", async () => {
    let receivedRequest: OllamaChatRequest | undefined;
    const streamChat: StreamOllamaChat = (request) => {
      receivedRequest = request;

      return (async function* () {
        yield "Hello";
        yield " there";
      })();
    };
    let time = -1_000;
    const { chat, coordinator, repository, service } = buildTestService({
      streamChat,
      clock: () => (time += 1_000),
    });
    const saveSpy = vi.spyOn(repository, "saveAssistantMessage");
    const signal = new AbortController().signal;
    const result = service.start(chat.id, "How are you?", signal);

    expect(result.status).toBe("started");

    if (result.status !== "started") {
      throw new Error("Generation did not start.");
    }

    await expect(collect(result.run.events)).resolves.toEqual([
      { type: "token", content: "Hello" },
      { type: "token", content: " there" },
      { type: "completion", messageId: ASSISTANT_MESSAGE_ID },
    ]);
    expect(receivedRequest).toEqual({
      baseUrl: "http://ollama:11434",
      model: "qwen3.5:4b",
      messages: [{ role: "user", content: "How are you?" }],
      signal,
    });
    expect(saveSpy).toHaveBeenCalledWith(
      ASSISTANT_MESSAGE_ID,
      "Hello",
      "streaming",
    );
    expect(saveSpy).toHaveBeenCalledWith(
      ASSISTANT_MESSAGE_ID,
      "Hello there",
      "complete",
    );
    expect(repository.getChat(chat.id)?.messages).toMatchObject([
      {
        id: USER_MESSAGE_ID,
        sequence: 0,
        role: "user",
        content: "How are you?",
        status: "complete",
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        sequence: 1,
        role: "assistant",
        content: "Hello there",
        status: "complete",
      },
    ]);
    expect(coordinator.getActiveGeneration()).toBeNull();
  });

  it("rejects a busy request before saving messages", () => {
    const streamChat: StreamOllamaChat = async function* () {
      yield "unused";
    };
    const { chat, coordinator, repository, service } = buildTestService({
      streamChat,
    });
    const lease = coordinator.tryAcquire({
      chatId: "another-chat",
      messageId: "another-message",
    });

    if (!lease) {
      throw new Error("The test lease was not acquired.");
    }

    expect(
      service.start(chat.id, "Do not save this", new AbortController().signal),
    ).toEqual({ status: "busy" });
    expect(repository.getChat(chat.id)?.messages).toEqual([]);

    lease.release();
  });

  it("rejects a chat whose model is no longer allowed", () => {
    const streamChat: StreamOllamaChat = async function* () {
      yield "unused";
    };
    const { chat, repository, service } = buildTestService({
      streamChat,
      model: "removed:latest",
    });

    expect(
      service.start(chat.id, "Hello", new AbortController().signal),
    ).toEqual({ status: "model-not-allowed" });
    expect(repository.getChat(chat.id)?.messages).toEqual([]);
  });

  it("stores an error and releases the generation slot when Ollama fails", async () => {
    const streamChat: StreamOllamaChat = async function* () {
      throw new Error("offline");
    };
    const { chat, coordinator, repository, service } = buildTestService({
      streamChat,
    });
    const result = service.start(
      chat.id,
      "Hello",
      new AbortController().signal,
    );

    if (result.status !== "started") {
      throw new Error("Generation did not start.");
    }

    await expect(collect(result.run.events)).resolves.toEqual([
      {
        type: "error",
        messageId: ASSISTANT_MESSAGE_ID,
        message: "Generation failed",
      },
    ]);
    expect(repository.getChat(chat.id)?.messages[1]).toMatchObject({
      content: "",
      status: "error",
    });
    expect(coordinator.getActiveGeneration()).toBeNull();
  });

  it("preserves partial content as cancelled when the request is aborted", async () => {
    const streamChat: StreamOllamaChat = async function* (request) {
      yield "Partial";
      await new Promise<void>((_resolve, reject) => {
        const rejectAbort = () => reject(new Error("aborted"));

        if (request.signal.aborted) {
          rejectAbort();
        } else {
          request.signal.addEventListener("abort", rejectAbort, {
            once: true,
          });
        }
      });
    };
    const { chat, coordinator, repository, service } = buildTestService({
      streamChat,
    });
    const abortController = new AbortController();
    const result = service.start(
      chat.id,
      "Hello",
      abortController.signal,
    );

    if (result.status !== "started") {
      throw new Error("Generation did not start.");
    }

    const iterator = result.run.events[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      value: { type: "token", content: "Partial" },
      done: false,
    });

    const cancellation = iterator.next();
    abortController.abort();

    await expect(cancellation).resolves.toEqual({
      value: {
        type: "cancellation",
        messageId: ASSISTANT_MESSAGE_ID,
      },
      done: false,
    });
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    expect(repository.getChat(chat.id)?.messages[1]).toMatchObject({
      content: "Partial",
      status: "cancelled",
    });
    expect(coordinator.getActiveGeneration()).toBeNull();
  });

  it("marks a response interrupted when its event consumer stops early", async () => {
    const streamChat: StreamOllamaChat = async function* () {
      yield "Partial";
      yield " response";
    };
    const { chat, coordinator, repository, service } = buildTestService({
      streamChat,
    });
    const result = service.start(
      chat.id,
      "Hello",
      new AbortController().signal,
    );

    if (result.status !== "started") {
      throw new Error("Generation did not start.");
    }

    const iterator = result.run.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();

    expect(repository.getChat(chat.id)?.messages[1]).toMatchObject({
      content: "Partial",
      status: "interrupted",
    });
    expect(coordinator.getActiveGeneration()).toBeNull();
  });
});
