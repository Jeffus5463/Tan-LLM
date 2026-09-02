import { describe, expect, it } from "vitest";

import { openDatabase } from "../src/database/database.js";
import { runMigrations, type Migration } from "../src/database/migrations.js";

describe("runMigrations", () => {
  it("applies each migration only once", () => {
    const database = openDatabase(":memory:");

    const migrations: readonly Migration[] = [
      {
        version: 1,
        name: "create_examples",
        up: `
          CREATE TABLE examples (
            id TEXT PRIMARY KEY
          ) STRICT;
        `,
      },
    ];

    try {
      runMigrations(database, migrations);
      runMigrations(database, migrations);

      const table = database
        .prepare<[], { name: string }>(
          `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'examples'
        `,
        )
        .get();

      const appliedMigrations = database
        .prepare<[], { version: number; name: string }>(
          `
          SELECT version, name
          FROM schema_migrations
          ORDER BY version
        `,
        )
        .all();

      expect(table).toEqual({
        name: "examples",
      });

      expect(appliedMigrations).toEqual([
        {
          version: 1,
          name: "create_examples",
        },
      ]);
    } finally {
      database.close();
    }
  });
});
