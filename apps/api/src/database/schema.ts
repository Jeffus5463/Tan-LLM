import type { Migration } from "./migrations.js";

export const migrations = [
  {
    version: 1,
    name: "create_chats_and_messages",
    up: `
      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        updated_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ) STRICT;

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'streaming',
            'complete',
            'cancelled',
            'interrupted',
            'error'
          )
        ),
        created_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        updated_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        UNIQUE (chat_id, sequence)
      ) STRICT;

      CREATE INDEX chats_updated_at_index
        ON chats(updated_at DESC);
    `,
  },
] as const satisfies readonly Migration[];
