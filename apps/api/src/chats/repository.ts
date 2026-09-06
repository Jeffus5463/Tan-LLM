import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { ConversationMessage } from "../generation/context.js";

export interface ChatSummary {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status:
    | "streaming"
    | "complete"
    | "cancelled"
    | "interrupted"
    | "error";
  createdAt: string;
  updatedAt: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

interface ChatRow {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  status: ChatMessage["status"];
  created_at: string;
  updated_at: string;
}

interface CreateChatInput {
  title: string;
  model: string;
}

interface UpdateChatInput {
  title?: string;
  model?: string;
}

interface CreateGenerationMessagesInput {
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
}

function mapChat(row: ChatRow): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChatRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly createId: () => string = randomUUID,
  ) {}

  listChats(): ChatSummary[] {
    const rows = this.database
      .prepare<[], ChatRow>(
        `
        SELECT id, title, model, created_at, updated_at
        FROM chats
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `,
      )
      .all();

    return rows.map(mapChat);
  }

  createChat(input: CreateChatInput): ChatSummary {
    const id = this.createId();

    this.database
      .prepare<[string, string, string]>(
        `
        INSERT INTO chats (id, title, model)
        VALUES (?, ?, ?)
      `,
      )
      .run(id, input.title, input.model);

    const chat = this.getChatSummary(id);

    if (!chat) {
      throw new Error("Created chat could not be read.");
    }

    return chat;
  }

  getChatSummary(id: string): ChatSummary | null {
    const row = this.database
      .prepare<[string], ChatRow>(
        `
        SELECT id, title, model, created_at, updated_at
        FROM chats
        WHERE id = ?
      `,
      )
      .get(id);

    return row ? mapChat(row) : null;
  }

  getChat(id: string): ChatDetail | null {
    const chat = this.getChatSummary(id);

    if (!chat) {
      return null;
    }

    const messageRows = this.database
      .prepare<[string], MessageRow>(
        `
        SELECT
          id,
          sequence,
          role,
          content,
          status,
          created_at,
          updated_at
        FROM messages
        WHERE chat_id = ?
        ORDER BY sequence ASC
      `,
      )
      .all(id);

    return {
      ...chat,
      messages: messageRows.map(mapMessage),
    };
  }

  updateChat(id: string, input: UpdateChatInput): ChatSummary | null {
    const result = this.database
      .prepare<[string | null, string | null, string]>(
        `
        UPDATE chats
        SET
          title = COALESCE(?, title),
          model = COALESCE(?, model),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `,
      )
      .run(input.title ?? null, input.model ?? null, id);

    if (result.changes === 0) {
      return null;
    }

    return this.getChatSummary(id);
  }

  deleteChat(id: string): boolean {
    const result = this.database
      .prepare<[string]>("DELETE FROM chats WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }

  getContextMessages(chatId: string): ConversationMessage[] {
    return this.database
      .prepare<
        [string],
        ConversationMessage
      >(
        `
        SELECT role, content
        FROM messages
        WHERE chat_id = ?
          AND content <> ''
          AND (role = 'user' OR status = 'complete')
        ORDER BY sequence ASC
      `,
      )
      .all(chatId);
  }

  createGenerationMessages(input: CreateGenerationMessagesInput): void {
    const createMessages = this.database.transaction(() => {
      const sequenceRow = this.database
        .prepare<[string], { nextSequence: number }>(
          `
          SELECT COALESCE(MAX(sequence), -1) + 1 AS nextSequence
          FROM messages
          WHERE chat_id = ?
        `,
        )
        .get(input.chatId);

      const userSequence = sequenceRow?.nextSequence ?? 0;
      const insertMessage = this.database.prepare<
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
        input.userMessageId,
        input.chatId,
        userSequence,
        "user",
        input.content,
        "complete",
      );
      insertMessage.run(
        input.assistantMessageId,
        input.chatId,
        userSequence + 1,
        "assistant",
        "",
        "streaming",
      );

      this.touchChat(input.chatId);
    });

    createMessages.immediate();
  }

  saveAssistantMessage(
    messageId: string,
    content: string,
    status: ChatMessage["status"],
  ): void {
    const saveMessage = this.database.transaction(() => {
      const result = this.database
        .prepare<[string, string, string]>(
          `
          UPDATE messages
          SET
            content = ?,
            status = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND role = 'assistant'
        `,
        )
        .run(content, status, messageId);

      if (result.changes === 0) {
        throw new Error("Assistant message could not be updated.");
      }

      this.database
        .prepare<[string]>(
          `
          UPDATE chats
          SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = (
            SELECT chat_id
            FROM messages
            WHERE id = ?
          )
        `,
        )
        .run(messageId);
    });

    saveMessage.immediate();
  }

  markStreamingMessagesInterrupted(): number {
    const interruptMessages = this.database.transaction(() => {
      this.database
        .prepare(
          `
          UPDATE chats
          SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id IN (
            SELECT DISTINCT chat_id
            FROM messages
            WHERE status = 'streaming'
          )
        `,
        )
        .run();

      return this.database
        .prepare(
          `
          UPDATE messages
          SET
            status = 'interrupted',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE status = 'streaming'
        `,
        )
        .run().changes;
    });

    return interruptMessages.immediate();
  }

  private touchChat(chatId: string): void {
    this.database
      .prepare<[string]>(
        `
        UPDATE chats
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `,
      )
      .run(chatId);
  }
}
