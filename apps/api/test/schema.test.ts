import { describe, expect, it } from "vitest";

import { openDatabase } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrations.js";
import { migrations } from "../src/database/schema.js";

describe("database schema", () => {
  it("creates chat tables and cascades message deletion", () => {
    const database = openDatabase(":memory:");

    try {
      runMigrations(database, migrations);

      const tables = database
        .prepare<[], { name: string }>(
          `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('chats', 'messages')
          ORDER BY name
        `,
        )
        .all();

      expect(tables).toEqual([
        {
          name: "chats",
        },
        {
          name: "messages",
        },
      ]);

      database
        .prepare<[string, string, string]>(
          `
          INSERT INTO chats (id, title, model)
          VALUES (?, ?, ?)
        `,
        )
        .run("chat-1", "First chat", "qwen3.5:4b");

      database
        .prepare<[string, string, number, string, string, string]>(
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
        )
        .run("message-1", "chat-1", 0, "user", "Hello", "complete");

      database
        .prepare<[string]>("DELETE FROM chats WHERE id = ?")
        .run("chat-1");

      const messageCount = database
        .prepare<
          [],
          { count: number }
        >("SELECT COUNT(*) AS count FROM messages")
        .get();

      expect(messageCount).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });
});
