import { describe, expect, it } from "vitest";

import { openDatabase } from "../src/database/database.js";

describe("openDatabase", () => {
  it("opens SQLite with foreign-key enforcement enabled", () => {
    const database = openDatabase(":memory:");

    try {
      expect(database.open).toBe(true);
      expect(
        database.pragma("foreign_keys", {
          simple: true,
        }),
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});
