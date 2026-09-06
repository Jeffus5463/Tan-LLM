import { Buffer } from "node:buffer";

import type Database from "better-sqlite3";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { buildApp } from "../src/app.js";
import type { AuthConfig } from "../src/auth/config.js";
import { hashPassword } from "../src/auth/password.js";
import { initializeDatabase } from "../src/database/initialize.js";
import { GenerationCoordinator } from "../src/generation/coordinator.js";

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
}

function buildChatTestApp(options: TestAppOptions = {}) {
  const database = options.database ?? initializeDatabase(":memory:");
  const generationCoordinator =
    options.generationCoordinator ?? new GenerationCoordinator();
  const app = buildApp({
    authConfig,
    database,
    generationCoordinator,
    modelConfig: {
      defaultModel: "qwen3.5:4b",
      allowedModels: ["qwen3.5:4b", "qwen3.5:2b"],
    },
  });

  onTestFinished(async () => {
    await app.close();
  });

  return { app, database, generationCoordinator };
}

async function login(app: ReturnType<typeof buildChatTestApp>["app"]) {
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

  return {
    tan_llm_session: cookie.value,
  };
}

async function createChat(
  app: ReturnType<typeof buildChatTestApp>["app"],
  cookies: Awaited<ReturnType<typeof login>>,
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/chats",
    cookies,
    payload,
  });
}

describe("shared chat routes", () => {
  it("requires authentication", async () => {
    const { app } = buildChatTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/chats",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("creates, lists, reads, updates, and deletes a shared chat", async () => {
    const { app } = buildChatTestApp();
    const cookies = await login(app);

    const createResponse = await createChat(app, cookies);

    expect(createResponse.statusCode).toBe(201);
    const createdChat = createResponse.json().chat;
    expect(createdChat).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      title: "New chat",
      model: "qwen3.5:4b",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/chats",
      cookies,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      chats: [createdChat],
    });

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/chats/${createdChat.id}`,
      cookies,
      payload: {
        title: "Household plans",
        model: "qwen3.5:2b",
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().chat).toMatchObject({
      id: createdChat.id,
      title: "Household plans",
      model: "qwen3.5:2b",
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/chats/${createdChat.id}`,
      cookies,
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().chat).toMatchObject({
      id: createdChat.id,
      title: "Household plans",
      model: "qwen3.5:2b",
      messages: [],
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/chats/${createdChat.id}`,
      cookies,
    });

    expect(deleteResponse.statusCode).toBe(204);

    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/chats/${createdChat.id}`,
      cookies,
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ error: "Chat not found" });
  });

  it("rejects models outside the configured allowlist", async () => {
    const { app } = buildChatTestApp();
    const cookies = await login(app);

    const createResponse = await createChat(app, cookies, {
      model: "unconfigured:7b",
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json()).toEqual({
      error: "Model not allowed",
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/chats",
      cookies,
    });

    expect(listResponse.json()).toEqual({ chats: [] });

    const allowedCreateResponse = await createChat(app, cookies);
    const chatId = allowedCreateResponse.json().chat.id as string;
    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/api/chats/${chatId}`,
      cookies,
      payload: {
        model: "unconfigured:7b",
      },
    });

    expect(patchResponse.statusCode).toBe(400);
    expect(patchResponse.json()).toEqual({
      error: "Model not allowed",
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(getResponse.json().chat.model).toBe("qwen3.5:4b");
  });

  it("rejects invalid request bodies", async () => {
    const { app } = buildChatTestApp();
    const cookies = await login(app);

    const unexpectedProperty = await createChat(app, cookies, {
      unexpected: true,
    });
    const blankTitle = await createChat(app, cookies, {
      title: "   ",
    });

    expect(unexpectedProperty.statusCode).toBe(400);
    expect(blankTitle.statusCode).toBe(400);
  });

  it("protects an active chat while allowing it to be renamed", async () => {
    const generationCoordinator = new GenerationCoordinator();
    const { app } = buildChatTestApp({ generationCoordinator });
    const cookies = await login(app);
    const createResponse = await createChat(app, cookies);
    const chatId = createResponse.json().chat.id as string;
    const lease = generationCoordinator.tryAcquire({
      chatId,
      messageId: "22222222-2222-4222-8222-222222222222",
    });

    if (!lease) {
      throw new Error("The generation lease was not acquired.");
    }

    const renameResponse = await app.inject({
      method: "PATCH",
      url: `/api/chats/${chatId}`,
      cookies,
      payload: {
        title: "Renamed while active",
      },
    });
    const modelResponse = await app.inject({
      method: "PATCH",
      url: `/api/chats/${chatId}`,
      cookies,
      payload: {
        model: "qwen3.5:2b",
      },
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json().chat.title).toBe("Renamed while active");
    expect(modelResponse.statusCode).toBe(409);
    expect(modelResponse.json()).toEqual({
      error: "Chat is currently generating",
    });
    expect(deleteResponse.statusCode).toBe(409);
    expect(deleteResponse.json()).toEqual({
      error: "Chat is currently generating",
    });

    lease.release();

    const releasedDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(releasedDeleteResponse.statusCode).toBe(204);
  });

  it("returns stored messages in conversation order", async () => {
    const { app, database } = buildChatTestApp();
    const cookies = await login(app);
    const createResponse = await createChat(app, cookies);
    const chatId = createResponse.json().chat.id as string;

    const insertMessage = database.prepare<
      [string, string, number, string, string, string]
    >(
      `
      INSERT INTO messages (
        id,
        chat_id,
        sequence,
        role,
        content,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    );

    insertMessage.run(
      "22222222-2222-4222-8222-222222222222",
      chatId,
      1,
      "assistant",
      "Second",
      "complete",
    );
    insertMessage.run(
      "33333333-3333-4333-8333-333333333333",
      chatId,
      0,
      "user",
      "First",
      "complete",
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/chats/${chatId}`,
      cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json().chat.messages.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(["First", "Second"]);
  });
});
