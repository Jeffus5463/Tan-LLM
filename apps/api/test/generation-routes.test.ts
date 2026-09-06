import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";

import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { buildApp } from "../src/app.js";
import type { AuthConfig } from "../src/auth/config.js";
import { hashPassword } from "../src/auth/password.js";
import { ChatRepository } from "../src/chats/repository.js";
import { initializeDatabase } from "../src/database/initialize.js";
import { GenerationCoordinator } from "../src/generation/coordinator.js";
import type { StreamOllamaChat } from "../src/generation/ollama.js";

const CHAT_ID = "11111111-1111-4111-8111-111111111111";

let authConfig: AuthConfig;

beforeAll(async () => {
  authConfig = {
    username: "owner",
    passwordHash: await hashPassword("test-password"),
    sessionKey: Buffer.alloc(32, 1),
    cookieSecure: true,
  };
});

interface TestAppOptions {
  database?: Database.Database;
  generationCoordinator?: GenerationCoordinator;
  streamChat?: StreamOllamaChat;
}

function buildGenerationTestApp(options: TestAppOptions = {}) {
  const database = options.database ?? initializeDatabase(":memory:");
  const generationCoordinator =
    options.generationCoordinator ?? new GenerationCoordinator();
  const streamChat: StreamOllamaChat =
    options.streamChat ??
    (async function* () {
      yield "Hello";
      yield " there";
    });
  const app = buildApp({
    authConfig,
    database,
    generationCoordinator,
    streamChat,
    modelConfig: {
      defaultModel: "qwen3.5:4b",
      allowedModels: ["qwen3.5:4b"],
    },
  });

  onTestFinished(async () => {
    await app.close();
  });

  return { app, database, generationCoordinator };
}

async function login(app: ReturnType<typeof buildGenerationTestApp>["app"]) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "owner",
      password: "test-password",
    },
  });
  const cookie = response.cookies.find(
    (candidate) => candidate.name === "tan_llm_session",
  );

  if (!cookie) {
    throw new Error("Session cookie is missing.");
  }

  return { tan_llm_session: cookie.value };
}

async function createChat(
  app: ReturnType<typeof buildGenerationTestApp>["app"],
  cookies: Awaited<ReturnType<typeof login>>,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/chats",
    cookies,
    payload: {},
  });

  return response.json().chat.id as string;
}

interface ServerSentEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseEvents(body: string): ServerSentEvent[] {
  return body
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (!eventLine || !dataLine) {
        throw new Error("Invalid server-sent event.");
      }

      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as Record<
          string,
          unknown
        >,
      };
    });
}

async function waitForActiveGeneration(
  coordinator: GenerationCoordinator,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (coordinator.getActiveGeneration()) {
      return;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("Generation did not become active.");
}

async function waitForMessageStatus(
  repository: ChatRepository,
  chatId: string,
  expectedStatus: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (repository.getChat(chatId)?.messages[1]?.status === expectedStatus) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Message did not become ${expectedStatus}.`);
}

describe("POST /api/chats/:chatId/messages", () => {
  it("requires authentication", async () => {
    const { app } = buildGenerationTestApp();

    const response = await app.inject({
      method: "POST",
      url: `/api/chats/${CHAT_ID}/messages`,
      payload: { content: "Hello" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("validates the prompt before starting generation", async () => {
    const { app } = buildGenerationTestApp();
    const cookies = await login(app);
    const chatId = await createChat(app, cookies);

    const blankResponse = await app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/messages`,
      cookies,
      payload: { content: "   " },
    });
    const longResponse = await app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/messages`,
      cookies,
      payload: { content: "x".repeat(16_001) },
    });
    const unexpectedResponse = await app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/messages`,
      cookies,
      payload: { content: "Hello", unexpected: true },
    });

    expect(blankResponse.statusCode).toBe(400);
    expect(longResponse.statusCode).toBe(400);
    expect(unexpectedResponse.statusCode).toBe(400);
  });

  it("returns 404 without storing messages for a missing chat", async () => {
    const { app, database } = buildGenerationTestApp();
    const cookies = await login(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/chats/${CHAT_ID}/messages`,
      cookies,
      payload: { content: "Hello" },
    });
    const messageCount = database
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM messages")
      .get()?.count;

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Chat not found" });
    expect(messageCount).toBe(0);
  });

  it("streams start, token, and completion events and stores the response", async () => {
    const { app } = buildGenerationTestApp();
    const cookies = await login(app);
    const chatId = await createChat(app, cookies);

    const response = await app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/messages`,
      cookies,
      payload: { content: "  Greet me  " },
    });
    const events = parseEvents(response.body);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    expect(events.map((event) => event.event)).toEqual([
      "start",
      "token",
      "token",
      "completion",
    ]);
    expect(events[0]?.data).toMatchObject({
      chatId,
      userMessageId: expect.any(String),
      messageId: expect.any(String),
    });
    expect(events[1]?.data).toEqual({ content: "Hello" });
    expect(events[2]?.data).toEqual({ content: " there" });

    const chatResponse = await app.inject({
      method: "GET",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(chatResponse.json().chat.messages).toMatchObject([
      { role: "user", content: "Greet me", status: "complete" },
      {
        role: "assistant",
        content: "Hello there",
        status: "complete",
      },
    ]);
  });

  it("returns an error event and stores an error when Ollama is unavailable", async () => {
    const streamChat: StreamOllamaChat = async function* () {
      throw new Error("offline");
    };
    const { app } = buildGenerationTestApp({ streamChat });
    const cookies = await login(app);
    const chatId = await createChat(app, cookies);

    const response = await app.inject({
      method: "POST",
      url: `/api/chats/${chatId}/messages`,
      cookies,
      payload: { content: "Hello" },
    });
    const events = parseEvents(response.body);

    expect(response.statusCode).toBe(200);
    expect(events.map((event) => event.event)).toEqual(["start", "error"]);
    expect(events[1]?.data).toMatchObject({
      messageId: expect.any(String),
      message: "Generation failed",
    });

    const chatResponse = await app.inject({
      method: "GET",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(chatResponse.json().chat.messages[1]).toMatchObject({
      content: "",
      status: "error",
    });
  });

  it("allows one active generation and stores nothing for a busy request", async () => {
    let finishGeneration: (() => void) | undefined;
    const generationCanFinish = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const streamChat: StreamOllamaChat = async function* () {
      yield "Working";
      await generationCanFinish;
      yield " done";
    };
    const generationCoordinator = new GenerationCoordinator();
    const { app, database } = buildGenerationTestApp({
      generationCoordinator,
      streamChat,
    });
    const cookies = await login(app);
    const firstChatId = await createChat(app, cookies);
    const secondChatId = await createChat(app, cookies);
    const firstResponsePromise = app.inject({
      method: "POST",
      url: `/api/chats/${firstChatId}/messages`,
      cookies,
      payload: { content: "First request" },
    });

    await waitForActiveGeneration(generationCoordinator);

    const secondResponse = await app.inject({
      method: "POST",
      url: `/api/chats/${secondChatId}/messages`,
      cookies,
      payload: { content: "Second request" },
    });
    const rejectedMessageCount = database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?",
      )
      .get(secondChatId)?.count;

    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toEqual({
      error: "Generation in progress",
    });
    expect(rejectedMessageCount).toBe(0);

    finishGeneration?.();
    const firstResponse = await firstResponsePromise;

    expect(firstResponse.statusCode).toBe(200);
    expect(parseEvents(firstResponse.body).at(-1)?.event).toBe("completion");
    expect(generationCoordinator.getActiveGeneration()).toBeNull();
  });

  it("cancels generation and preserves partial content when the client disconnects", async () => {
    const streamChat: StreamOllamaChat = async function* (request) {
      yield "Partial response";
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
    const { app, database, generationCoordinator } =
      buildGenerationTestApp({ streamChat });
    const cookies = await login(app);
    const chatId = await createChat(app, cookies);
    const repository = new ChatRepository(database);

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "owner",
        password: "test-password",
      }),
    });
    const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];

    if (!sessionCookie) {
      throw new Error("Session cookie is missing.");
    }

    const abortController = new AbortController();
    const response = await fetch(
      `${baseUrl}/api/chats/${chatId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ content: "Hello" }),
        signal: abortController.signal,
      },
    );

    expect(response.status).toBe(200);
    await response.body?.getReader().read();
    await waitForMessageStatus(repository, chatId, "streaming");

    abortController.abort();

    await waitForMessageStatus(repository, chatId, "cancelled");
    expect(repository.getChat(chatId)?.messages[1]).toMatchObject({
      content: "Partial response",
      status: "cancelled",
    });
    expect(generationCoordinator.getActiveGeneration()).toBeNull();
  });

  it("marks an abandoned streaming response interrupted during startup", async () => {
    const database = initializeDatabase(":memory:");
    const repository = new ChatRepository(database, () => CHAT_ID);
    const chat = repository.createChat({
      title: "Recovered chat",
      model: "qwen3.5:4b",
    });
    repository.createGenerationMessages({
      chatId: chat.id,
      userMessageId: "22222222-2222-4222-8222-222222222222",
      assistantMessageId: "33333333-3333-4333-8333-333333333333",
      content: "Continue",
    });
    repository.saveAssistantMessage(
      "33333333-3333-4333-8333-333333333333",
      "Saved partial response",
      "streaming",
    );
    const { app } = buildGenerationTestApp({ database });
    const cookies = await login(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/chats/${chat.id}`,
      cookies,
    });

    expect(response.json().chat.messages[1]).toMatchObject({
      content: "Saved partial response",
      status: "interrupted",
    });
  });
});
