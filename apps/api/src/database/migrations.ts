import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: string;
}

interface AppliedMigration {
  version: number;
  name: string;
}

export function runMigrations(
  database: Database.Database,
  migrations: readonly Migration[],
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  const findAppliedMigration = database.prepare<[number], AppliedMigration>(`
    SELECT version, name
    FROM schema_migrations
    WHERE version = ?
  `);

  const recordMigration = database.prepare<[number, string]>(`
    INSERT INTO schema_migrations (version, name)
    VALUES (?, ?)
  `);

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.up);
    recordMigration.run(migration.version, migration.name);
  });

  for (const migration of migrations) {
    const appliedMigration = findAppliedMigration.get(migration.version);

    if (appliedMigration) {
      if (appliedMigration.name !== migration.name) {
        throw new Error(
          `Migration ${migration.version} was previously applied as "${appliedMigration.name}".`,
        );
      }

      continue;
    }

    applyMigration(migration);
  }
}
