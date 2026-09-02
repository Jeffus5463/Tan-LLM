import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initializeDatabase } from "../src/database/initialize.js";

describe("initializeDatabase", () => {
  it("creates the database directory and applies migrations", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "tan-llm-database-"));

    const databasePath = join(temporaryDirectory, "data", "tan-llm.db");

    try {
      const database = initializeDatabase(databasePath);

      try {
        const chatTable = database
          .prepare<[], { name: string }>(
            `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name = 'chats'
          `,
          )
          .get();

        expect(existsSync(databasePath)).toBe(true);
        expect(chatTable).toEqual({
          name: "chats",
        });
      } finally {
        database.close();
      }
    } finally {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });
});
