import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChatRepository } from "../src/chats/repository.js";
import { initializeDatabase } from "../src/database/initialize.js";

const databases: ReturnType<typeof initializeDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createRepository(id = "11111111-1111-4111-8111-111111111111") {
  const database = initializeDatabase(":memory:");
  databases.push(database);

  return {
    database,
    repository: new ChatRepository(database, () => id),
  };
}

describe("ChatRepository", () => {
  it("creates, lists, updates, and deletes a chat", () => {
    const { repository } = createRepository();

    const created = repository.createChat({
      title: "New chat",
      model: "qwen3.5:4b",
    });

    expect(created).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "New chat",
      model: "qwen3.5:4b",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(repository.listChats()).toEqual([created]);

    const updated = repository.updateChat(created.id, {
      title: "Renamed chat",
      model: "qwen3.5:2b",
    });

    expect(updated).toEqual({
      ...created,
      title: "Renamed chat",
      model: "qwen3.5:2b",
      updatedAt: expect.any(String),
    });

    expect(repository.deleteChat(created.id)).toBe(true);
    expect(repository.getChat(created.id)).toBeNull();
    expect(repository.deleteChat(created.id)).toBe(false);
  });

  it("returns messages in sequence order", () => {
    const { database, repository } = createRepository();
    const chat = repository.createChat({
      title: "Ordered messages",
      model: "qwen3.5:4b",
    });

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
      chat.id,
      1,
      "assistant",
      "Hello there",
      "complete",
    );
    insertMessage.run(
      "33333333-3333-4333-8333-333333333333",
      chat.id,
      0,
      "user",
      "Hello",
      "complete",
    );

    expect(repository.getChat(chat.id)).toEqual({
      ...chat,
      messages: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          sequence: 0,
          role: "user",
          content: "Hello",
          status: "complete",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          sequence: 1,
          role: "assistant",
          content: "Hello there",
          status: "complete",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ],
    });
  });

  it("creates generation message pairs and excludes unfinished replies from context", () => {
    const { repository } = createRepository();
    const chat = repository.createChat({
      title: "Conversation context",
      model: "qwen3.5:4b",
    });

    repository.createGenerationMessages({
      chatId: chat.id,
      userMessageId: "22222222-2222-4222-8222-222222222222",
      assistantMessageId: "33333333-3333-4333-8333-333333333333",
      content: "First question",
    });
    repository.saveAssistantMessage(
      "33333333-3333-4333-8333-333333333333",
      "First answer",
      "complete",
    );
    repository.createGenerationMessages({
      chatId: chat.id,
      userMessageId: "44444444-4444-4444-8444-444444444444",
      assistantMessageId: "55555555-5555-4555-8555-555555555555",
      content: "Second question",
    });
    repository.saveAssistantMessage(
      "55555555-5555-4555-8555-555555555555",
      "Partial answer",
      "cancelled",
    );

    expect(repository.getContextMessages(chat.id)).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ]);
    expect(repository.getChat(chat.id)?.messages).toMatchObject([
      { sequence: 0, role: "user", status: "complete" },
      { sequence: 1, role: "assistant", status: "complete" },
      { sequence: 2, role: "user", status: "complete" },
      { sequence: 3, role: "assistant", status: "cancelled" },
    ]);
  });

  it("marks abandoned streaming responses interrupted", () => {
    const { repository } = createRepository();
    const chat = repository.createChat({
      title: "Interrupted response",
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

    expect(repository.markStreamingMessagesInterrupted()).toBe(1);
    expect(repository.markStreamingMessagesInterrupted()).toBe(0);
    expect(repository.getChat(chat.id)?.messages[1]).toMatchObject({
      content: "Saved partial response",
      status: "interrupted",
    });
  });

  it("preserves chats when the database is reopened", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "tan-llm-chats-"),
    );
    const databasePath = join(temporaryDirectory, "tan-llm.db");
    let database = initializeDatabase(databasePath);

    try {
      const repository = new ChatRepository(
        database,
        () => "11111111-1111-4111-8111-111111111111",
      );

      const created = repository.createChat({
        title: "Persistent chat",
        model: "qwen3.5:4b",
      });

      database.close();
      database = initializeDatabase(databasePath);

      const reopenedRepository = new ChatRepository(database);

      expect(reopenedRepository.getChat(created.id)).toEqual({
        ...created,
        messages: [],
      });
    } finally {
      if (database.open) {
        database.close();
      }

      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });
});
